import { validateCaptureOptions } from "../capture.js";
import type { ParserCaptureOptions } from "../capture.js";
import { types } from "node:util";
import { checkpointBinding, checkpointBudget, decodeClaudeCheckpoint, encodeClaudeCheckpoint } from "./checkpoint.js";
import type { CheckpointPosition, ExecutionState, MessageState, Position, SafeResult, SourceState, StreamState, UsageOrder } from "./checkpoint.js";
import type { ClaudeCheckpointBinding, ClaudeCheckpointExport, ClaudeCheckpointOptions, ClaudeCheckpointUnavailableReason } from "./types.js";
import { normalizeEvent } from "../../normalize/event.js";
import type { IdentityContext } from "../../normalize/identity.js";
import type { DurationScope, NormalizedEvent } from "../../normalize/types.js";
import { diagnostic, SafeError } from "../../privacy/diagnostics.js";
import type { DiagnosticCode, SafeDiagnostic } from "../../privacy/diagnostics.js";
import type { ParserSourceRef } from "../types.js";
import { canonical, elapsed, field, integer, milliseconds, object, text, utc } from "./fields.js";
import { tool } from "./tools.js";
import { extractClaudeSearch } from "./search.js";
import { sameCounts, stopReason, tokenCounts } from "./usage.js";
import type { ClaudeBatch, ClaudeCapabilities, ClaudeInputSource, ClaudeLimits, ClaudeMessageLink, ClaudeMetadata, ClaudeResultObservation, ClaudeShape, ClaudeSnapshot, ClaudeSourceObservation, ClaudeTurn, ClaudeUsage } from "./types.js";

export const DEFAULT_CLAUDE_LIMITS: ClaudeLimits = Object.freeze({ sources: 256, streams: 256, events: 4096, turns: 4096, usage: 4096, messageLinks: 8192, deferredResults: 4096, resultReplays: 4096, usageOrders: 4096, usageProofReplays: 4096, observations: 8192, metadata: 8192, diagnostics: 8192 });

export function claudeStreamId(context: IdentityContext, rawSessionId: string, rawAgentId: string | null = null): string { return context.fingerprint("session", ["claude", rawSessionId, rawAgentId]); }
export function claudeEventId(context: IdentityContext, streamId: string, rawToolUseId: string): string { return context.fingerprint("event", ["claude", streamId, rawToolUseId]); }
export function claudeMessageId(context: IdentityContext, streamId: string, rawUuid: string): string { return context.fingerprint("event", ["claude", streamId, "uuid", rawUuid]); }
export function claudeResponseId(context: IdentityContext, streamId: string, rawMessageId: string): string { return context.fingerprint("event", ["claude", streamId, "response", rawMessageId]); }
export function claudeUsageId(context: IdentityContext, streamId: string, rawMessageId: string): string { return context.fingerprint("event", ["claude", streamId, "usage", rawMessageId]); }
export function claudeTurnId(context: IdentityContext, streamId: string, rawUuid: string): string { return context.fingerprint("turn", ["claude", streamId, rawUuid]); }

type Input = { source: ClaudeInputSource; fileId: string; sourceState: SourceState; sourceRef: ParserSourceRef; at: string | null; projectId: string | null; declarationFingerprint: string | null; origin: ClaudeSourceObservation["origin"]; streamId: string | null; messageId: string | null; semanticReplayId: string | null; replay: boolean };
type WorkBatch = { events: Map<string, NormalizedEvent>; turns: Map<string, ClaudeTurn>; usage: Map<string, ClaudeUsage>; observations: Map<string, ClaudeSourceObservation>; diagnostics: SafeDiagnostic[] };

export class ClaudeAdapter {
  readonly #context: IdentityContext;
  readonly #limits: ClaudeLimits;
  readonly #usageTiming: boolean;
  readonly #sources = new Map<string, SourceState>();
  readonly #streams = new Map<string, StreamState>();
  readonly #events = new Map<string, ExecutionState>();
  readonly #turns = new Map<string, ClaudeTurn>();
  readonly #usage = new Map<string, ClaudeUsage>();
  readonly #usageOrders = new Map<string, UsageOrder>();
  readonly #usageProofReplays = new Set<string>();
  readonly #messages = new Map<string, MessageState>();
  readonly #uuidReplays = new Set<string>();
  readonly #deferredResults = new Map<string, SafeResult>();
  readonly #resultReplays = new Set<string>();
  readonly #observations = new Map<string, ClaudeSourceObservation>();
  readonly #metadata = new Map<string, ClaudeMetadata>();
  readonly #diagnostics = new Map<string, SafeDiagnostic>();
  readonly #shapes = new Set<ClaudeShape>();
  #messageEdges = 0;
  #partial = false;
  #limited = false;
  #unsupported = 0;
  #ambiguous = 0;
  #diagnosticsDropped = 0;
  #checkpointPosition: CheckpointPosition = { firstOrdinal: null, lastOrdinal: null, lastByteOffset: null, recordCount: 0 };
  #checkpointSourceId: string | null = null;
  #checkpointUnavailable: ClaudeCheckpointUnavailableReason | null = null;
  #continuation: ClaudeCheckpointBinding | null = null;

  constructor(context: IdentityContext, limits: Partial<ClaudeLimits> = {}, capture: ParserCaptureOptions = {}) {
    this.#usageTiming = validateCaptureOptions(capture);
    const selected = { ...DEFAULT_CLAUDE_LIMITS, ...limits };
    if (Object.keys(selected).some((key) => !Object.hasOwn(DEFAULT_CLAUDE_LIMITS, key)) || Object.values(selected).some((value) => !Number.isSafeInteger(value) || value < 1 || value > 1_000_000)) throw new SafeError("INVALID_ARGUMENT");
    this.#context = context; this.#limits = Object.freeze(selected);
  }
  #capabilities(): ClaudeCapabilities {
    return Object.freeze({ provider: "claude", parserVersion: this.#usageTiming ? 3 : 2, support: "shape_verified_only", coverage: this.#partial ? "partial" : "recognized_shapes", observedShapes: Object.freeze([...this.#shapes].sort()), unsupportedRecords: this.#unsupported, ambiguousRecords: this.#ambiguous, stateLimited: this.#limited, diagnosticsDropped: this.#diagnosticsDropped });
  }
  #warn(code: DiagnosticCode, input: Input | null, batch: WorkBatch, position: Position | null = null): void {
    this.#partial = true;
    const value = diagnostic(code, position ? position.sourceAlias : input?.source.sourceAlias ?? null, position?.sourceRef.byteOffset ?? input?.sourceRef.byteOffset ?? null);
    const key = `${position?.fileId ?? input?.fileId ?? "none"}:${value.byteOffset ?? "none"}:${code}`;
    if (this.#diagnostics.has(key)) return;
    if (this.#diagnostics.size >= this.#limits.diagnostics) { this.#limited = true; this.#diagnosticsDropped = Math.min(Number.MAX_SAFE_INTEGER, this.#diagnosticsDropped + 1); return; }
    this.#diagnostics.set(key, value); batch.diagnostics.push(value);
  }
  #room(size: number, limit: number, input: Input | null, batch: WorkBatch): boolean {
    if (size < limit) return true;
    this.#limited = true; this.#warn("STATE_LIMIT", input, batch); return false;
  }
  #observe(input: Input, batch: WorkBatch, representation: ClaudeSourceObservation["representation"], eventId: string | null = null, usageId: string | null = null, turnId: string | null = null, observedUsage: ClaudeSourceObservation["observedUsage"] = null, observedResult: ClaudeResultObservation | null = null): boolean {
    const id = this.#context.fingerprint("source", ["claude_observation", input.fileId, input.sourceRef.byteOffset, representation, eventId, usageId, turnId]);
    if (this.#observations.has(id)) return false;
    if (!this.#room(this.#observations.size, this.#limits.observations, input, batch)) return false;
    const value: ClaudeSourceObservation = Object.freeze({ ...(this.#usageTiming ? { usageObservedAt: representation === "usage" ? input.at : null } : {}), id, sessionId: input.streamId, messageId: input.messageId, eventId, usageId, turnId, representation, origin: input.origin, observedUsage, observedResult, sourceRef: input.sourceRef });
    this.#observations.set(id, value); batch.observations.set(id, value); return true;
  }
  #unsupportedRecord(input: Input, batch: WorkBatch): void {
    this.#warn("UNSUPPORTED_RECORD", input, batch);
    if (this.#observe(input, batch, "unsupported")) this.#unsupported = Math.min(Number.MAX_SAFE_INTEGER, this.#unsupported + 1);
  }
  #finish(batch: WorkBatch): ClaudeBatch {
    return Object.freeze({ events: Object.freeze([...batch.events.values()]), turns: Object.freeze([...batch.turns.values()]), usage: Object.freeze([...batch.usage.values()]), observations: Object.freeze([...batch.observations.values()]), diagnostics: Object.freeze(batch.diagnostics), capabilities: this.#capabilities() });
  }
  snapshot(): ClaudeSnapshot {
    return Object.freeze({
      events: Object.freeze([...this.#events.values()].map((state) => state.event)), turns: Object.freeze([...this.#turns.values()]), usage: Object.freeze([...this.#usage.values()]),
      observations: Object.freeze([...this.#observations.values()]), diagnostics: Object.freeze([...this.#diagnostics.values()]), messages: Object.freeze([...this.#messages.values()].map((state) => state.link)), metadata: Object.freeze([...this.#metadata.values()]), capabilities: this.#capabilities(),
      stateCounts: Object.freeze({ sources: this.#sources.size, streams: this.#streams.size, events: this.#events.size, turns: this.#turns.size, usage: this.#usage.size, messageLinks: this.#messages.size, messageEdges: this.#messageEdges, uuidReplays: this.#uuidReplays.size, deferredResults: this.#deferredResults.size, resultReplays: this.#resultReplays.size, usageOrders: this.#usageOrders.size, usageProofReplays: this.#usageProofReplays.size, observations: this.#observations.size, metadata: this.#metadata.size, diagnostics: this.#diagnostics.size, shapes: this.#shapes.size }),
    });
  }
  inspectRetainedState(): unknown {
    return Object.freeze({ snapshot: this.snapshot(), sources: Object.freeze([...this.#sources.entries()].map(([id, state]) => Object.freeze({ id, ...state }))), streams: Object.freeze([...this.#streams.entries()].map(([id, state]) => Object.freeze({ id, ...state }))), executionState: Object.freeze([...this.#events.values()].map((state) => Object.freeze({ ...state }))), messages: Object.freeze([...this.#messages.values()]), uuidReplays: Object.freeze([...this.#uuidReplays]), deferredResults: Object.freeze([...this.#deferredResults.entries()].map(([id, result]) => Object.freeze({ id, ...result }))), resultReplays: Object.freeze([...this.#resultReplays]), usageOrders: Object.freeze([...this.#usageOrders.entries()].map(([id, order]) => Object.freeze({ id, ...order }))), usageProofReplays: Object.freeze([...this.#usageProofReplays]) });
  }


  /** Adapter-only state token. A caller boundary is not proof of file bytes or an LF. */
  exportCheckpoint(binding: ClaudeCheckpointBinding, options: ClaudeCheckpointOptions = {}): ClaudeCheckpointExport {
    if (this.#checkpointUnavailable) return Object.freeze({ status: "unavailable", reason: this.#checkpointUnavailable });
    try {
      const checked = checkpointBinding(binding, this.#context), maximum = checkpointBudget(options), p = this.#checkpointPosition;
      if (this.#checkpointSourceId !== null && checked.sourceId !== this.#checkpointSourceId
        || p.recordCount === 0 && checked.completedOffset !== 0
        || p.recordCount > 0 && (p.lastOrdinal === null || p.lastByteOffset === null || !Number.isSafeInteger(p.lastOrdinal + 1)
          || checked.nextOrdinal !== p.lastOrdinal + 1 || checked.completedOffset <= p.lastByteOffset)
        || this.#continuation !== null && (checked.sourceId !== this.#continuation.sourceId || checked.nextOrdinal !== this.#continuation.nextOrdinal
          || checked.completedOffset !== this.#continuation.completedOffset)) return Object.freeze({ status: "unavailable", reason: "incompatible_binding" });
      return encodeClaudeCheckpoint(this.#context, checked, this.#limits, this.#capabilities().parserVersion, p, {
        sources: this.#sources, streams: this.#streams, events: this.#events, turns: this.#turns, usage: this.#usage,
        usageOrders: this.#usageOrders, messages: this.#messages, deferredResults: this.#deferredResults,
        observations: this.#observations, metadata: this.#metadata, diagnostics: this.#diagnostics,
        uuidReplays: this.#uuidReplays, resultReplays: this.#resultReplays, usageProofReplays: this.#usageProofReplays, shapes: this.#shapes,
        messageEdges: this.#messageEdges, partial: this.#partial, limited: this.#limited, unsupported: this.#unsupported,
        ambiguous: this.#ambiguous, diagnosticsDropped: this.#diagnosticsDropped,
      }, maximum);
    } catch { return Object.freeze({ status: "unavailable", reason: "incompatible_binding" }); }
  }
  /** Validate first, then expose one fresh owned instance. No existing adapter is mutated. */
  static restoreCheckpoint(context: IdentityContext, encoded: unknown, expectedBinding: ClaudeCheckpointBinding, limits: Partial<ClaudeLimits> = {}, capture: ParserCaptureOptions = {}):
    Readonly<{ status: "restored"; adapter: ClaudeAdapter } | { status: "rejected"; reason: "invalid_checkpoint" }> {
    try {
      const adapter = new ClaudeAdapter(context, limits, capture), binding = checkpointBinding(expectedBinding, context);
      const decoded = decodeClaudeCheckpoint(context, encoded, binding, adapter.#limits, adapter.#capabilities().parserVersion), s = decoded.state;
      for (const [key, value] of s.sources) adapter.#sources.set(key, value);
      for (const [key, value] of s.streams) adapter.#streams.set(key, value);
      for (const [key, value] of s.events) adapter.#events.set(key, value);
      for (const [key, value] of s.turns) adapter.#turns.set(key, value);
      for (const [key, value] of s.usage) adapter.#usage.set(key, value);
      for (const [key, value] of s.usageOrders) adapter.#usageOrders.set(key, value);
      for (const [key, value] of s.messages) adapter.#messages.set(key, value);
      for (const [key, value] of s.deferredResults) adapter.#deferredResults.set(key, value);
      for (const [key, value] of s.observations) adapter.#observations.set(key, value);
      for (const [key, value] of s.metadata) adapter.#metadata.set(key, value);
      for (const [key, value] of s.diagnostics) adapter.#diagnostics.set(key, value);
      for (const value of s.uuidReplays) adapter.#uuidReplays.add(value);
      for (const value of s.resultReplays) adapter.#resultReplays.add(value);
      for (const value of s.usageProofReplays) adapter.#usageProofReplays.add(value);
      for (const value of s.shapes) adapter.#shapes.add(value);
      adapter.#messageEdges = s.messageEdges; adapter.#partial = s.partial; adapter.#limited = s.limited;
      adapter.#unsupported = s.unsupported; adapter.#ambiguous = s.ambiguous; adapter.#diagnosticsDropped = s.diagnosticsDropped;
      adapter.#checkpointPosition = decoded.position; adapter.#checkpointSourceId = binding.sourceId; adapter.#continuation = binding;
      return Object.freeze({ status: "restored", adapter });
    } catch { return Object.freeze({ status: "rejected", reason: "invalid_checkpoint" }); }
  }
  #trackCheckpoint(source: ClaudeInputSource): void {
    if (this.#checkpointUnavailable) return;
    try {
      if (source === null || typeof source !== "object" || types.isProxy(source)) throw new Error();
      const descriptors = Object.getOwnPropertyDescriptors(source);
      const reachable = (name: string): PropertyDescriptor | undefined => {
        let current: object | null = source;
        for (let depth = 0; current !== null && depth < 16; depth++) {
          if (types.isProxy(current)) throw new Error();
          const descriptor = Object.getOwnPropertyDescriptor(current, name);
          if (descriptor) return descriptor;
          current = Object.getPrototypeOf(current) as object | null;
        }
        if (current !== null) throw new Error();
        return undefined;
      };
      if (reachable("trustedFixtureContext")) { this.#checkpointUnavailable = "unsupported_state"; return; }
      const alias = reachable("sourceAlias");
      if (alias && (!("value" in alias) || alias.value !== undefined && alias.value !== null && typeof alias.value !== "string")) {
        this.#checkpointUnavailable = "unsupported_state"; return;
      }
      for (const name of ["fileIdentity", "byteOffset", "ordinal"]) if (!descriptors[name] || !("value" in descriptors[name])) throw new Error();
      const fileIdentity = text(descriptors.fileIdentity!.value), byteOffset = integer(descriptors.byteOffset!.value), ordinal = integer(descriptors.ordinal!.value);
      if (fileIdentity === null || byteOffset === null || ordinal === null || Object.is(byteOffset, -0) || Object.is(ordinal, -0)) throw new Error();
      const sourceId = this.#context.fingerprint("source", ["claude", fileIdentity]), p = this.#checkpointPosition;
      if (this.#checkpointSourceId !== null && this.#checkpointSourceId !== sourceId) { this.#checkpointUnavailable = "unsupported_state"; return; }
      if (this.#continuation !== null && (ordinal !== this.#continuation.nextOrdinal || byteOffset < this.#continuation.completedOffset)) throw new Error();
      if (p.recordCount > 0 && (p.lastOrdinal === null || p.lastByteOffset === null || !Number.isSafeInteger(p.lastOrdinal + 1)
        || ordinal !== p.lastOrdinal + 1 || byteOffset <= p.lastByteOffset)) throw new Error();
      if (!Number.isSafeInteger(p.recordCount + 1)) throw new Error();
      this.#checkpointSourceId = sourceId;
      this.#checkpointPosition = { firstOrdinal: p.firstOrdinal ?? ordinal, lastOrdinal: ordinal, lastByteOffset: byteOffset, recordCount: p.recordCount + 1 };
      this.#continuation = null;
    } catch { this.#checkpointUnavailable = "unsafe_positions"; }
  }

  ingest(record: unknown, source: ClaudeInputSource): ClaudeBatch {
    this.#trackCheckpoint(source);
    const batch: WorkBatch = { events: new Map(), turns: new Map(), usage: new Map(), observations: new Map(), diagnostics: [] };
    let input: Input | null = null;
    try {
      if (!object(record) || text(source.fileIdentity) === null || integer(source.byteOffset) === null || integer(source.ordinal) === null) { this.#warn("INVALID_RECORD", null, batch); return this.#finish(batch); }
      const fileId = this.#context.fingerprint("source", ["claude", source.fileIdentity]);
      const priorSource = this.#sources.get(fileId);
      if (!priorSource && !this.#room(this.#sources.size, this.#limits.sources, null, batch)) return this.#finish(batch);
      const sourceState = priorSource ?? { ownerRootSessionId: null, ambiguous: false };
      this.#sources.set(fileId, sourceState);
      const copied = source.trustedFixtureContext?.knownCopiedOrdinals?.includes(source.ordinal) === true;
      const cwd = text(field(record, "cwd"));
      const declaration = canonical(Object.fromEntries(["sessionId", "isSidechain", "agentId"].map((key) => [key, [field(record, key) !== undefined, field(record, key) ?? null]])));
      const declarationFingerprint = declaration === null ? null : this.#context.fingerprint("session", ["claude_declaration", declaration]);
      const retainedMetadata = this.#metadata.get(this.#context.fingerprint("source", ["claude_metadata", fileId, source.byteOffset]));
      const sameDeclaration = retainedMetadata !== undefined && declarationFingerprint !== null && declarationFingerprint === retainedMetadata.declarationFingerprint;
      input = { source, fileId, sourceState, sourceRef: Object.freeze({ fileId, byteOffset: source.byteOffset }), at: utc(field(record, "timestamp")), projectId: cwd === null ? null : this.#context.fingerprint("file", ["claude_project", cwd]), declarationFingerprint, origin: copied ? "trusted_copied" : sameDeclaration ? retainedMetadata.origin : sourceState.ambiguous ? "ambiguous" : "ordinary", streamId: null, messageId: null, semanticReplayId: null, replay: false };
      if (declarationFingerprint === null) this.#warn("INVALID_RECORD", input, batch);
      if (retainedMetadata && !sameDeclaration) { input.origin = "ambiguous"; this.#warn("INCONSISTENT_REPLAY", input, batch); }
      if (field(record, "timestamp") !== undefined && input.at === null) this.#warn("INVALID_TIMING", input, batch);
      this.#selectStream(record, input, batch);
      this.#metadataRecord(record, input, batch);
      if (input.origin === "trusted_copied") { this.#observe(input, batch, "provenance"); return this.#finish(batch); }
      if (input.origin === "ambiguous") {
        this.#warn("AMBIGUOUS_ORIGIN", input, batch);
        if (this.#observe(input, batch, "provenance")) this.#ambiguous = Math.min(Number.MAX_SAFE_INTEGER, this.#ambiguous + 1);
      }
      const type = field(record, "type");
      if (type !== "assistant" && type !== "user" && type !== "system") { this.#unsupportedRecord(input, batch); return this.#finish(batch); }
      if (input.streamId === null) { this.#warn("UNATTRIBUTED_RECORD", input, batch); this.#observe(input, batch, "unsupported"); return this.#finish(batch); }
      if (!this.#messageRecord(record, input, batch, type)) return this.#finish(batch);
      if (type === "system") {
        if (field(record, "subtype") === "turn_duration") this.#turn(record, input, batch);
        return this.#finish(batch);
      }
      const message = field(record, "message");
      if (!object(message)) { this.#warn("INVALID_RECORD", input, batch); return this.#finish(batch); }
      const role = field(message, "role");
      if (role !== undefined && role !== type) { this.#warn("INVALID_RECORD", input, batch); return this.#finish(batch); }
      const content = field(message, "content");
      if (Array.isArray(content)) {
        if (content.length > 4096) { this.#limited = true; this.#warn("STATE_LIMIT", input, batch); return this.#finish(batch); }
        const results = content.filter((entry) => field(entry, "type") === "tool_result").length;
        for (const entry of content) {
          const blockType = field(entry, "type");
          if (type === "assistant" && blockType === "tool_use") this.#call(entry, record, input, batch);
          else if (type === "user" && blockType === "tool_result") this.#result(entry, record, input, batch, results === 1);
          else if (!["text", "thinking", "redacted_thinking", "image"].includes(blockType as string)) this.#unsupportedRecord(input, batch);
        }
      } else if (typeof content !== "string") this.#warn("INVALID_RECORD", input, batch);
      if (type === "assistant" && field(message, "usage") !== undefined) this.#messageUsage(message, input, batch);
    } catch {
      // Provider text and exception message/stack never escape the adapter.
      this.#warn("INVALID_RECORD", input, batch);
    }
    return this.#finish(batch);
  }

  #selectStream(record: unknown, input: Input, batch: WorkBatch): void {
    const rawSession = text(field(record, "sessionId"), 4096);
    const owner = text(input.source.trustedFixtureContext?.ownerSessionId, 4096);
    const declaredRoot = rawSession === null ? null : claudeStreamId(this.#context, rawSession);
    const requestedOwner = owner === null ? declaredRoot : claudeStreamId(this.#context, owner);
    if (input.sourceState.ownerRootSessionId === null && requestedOwner !== null) input.sourceState.ownerRootSessionId = requestedOwner;
    if (input.origin !== "trusted_copied" && ((declaredRoot !== null && input.sourceState.ownerRootSessionId !== declaredRoot) || field(record, "forkedFromSessionId") !== undefined && input.source.trustedFixtureContext?.knownCopiedOrdinals === undefined)) {
      input.sourceState.ambiguous = true; input.origin = "ambiguous";
    }
    if (rawSession === null) return;
    const sidechain = field(record, "isSidechain");
    if (sidechain !== undefined && typeof sidechain !== "boolean") { this.#warn("INVALID_RECORD", input, batch); return; }
    if (sidechain !== true && field(record, "agentId") !== undefined) { this.#warn("UNATTRIBUTED_RECORD", input, batch); return; }
    const rawAgent = sidechain === true ? text(field(record, "agentId"), 4096) : null;
    if (sidechain === true && rawAgent === null) { this.#warn("UNATTRIBUTED_RECORD", input, batch); return; }
    const id = claudeStreamId(this.#context, rawSession, rawAgent);
    if (input.origin === "trusted_copied") { input.streamId = id; return; }
    const prior = this.#streams.get(id);
    if (!prior && !this.#room(this.#streams.size, this.#limits.streams, input, batch)) return;
    const projectId = input.projectId ?? prior?.projectId ?? null;
    this.#streams.set(id, Object.freeze({ rootSessionId: declaredRoot!, agentId: rawAgent === null ? null : this.#context.fingerprint("session", ["claude_agent", rawSession, rawAgent]), isSidechain: sidechain === true, projectId }));
    input.streamId = id;
  }
  #metadataRecord(record: unknown, input: Input, batch: WorkBatch): void {
    const id = this.#context.fingerprint("source", ["claude_metadata", input.fileId, input.sourceRef.byteOffset]);
    if (this.#metadata.has(id) || !this.#room(this.#metadata.size, this.#limits.metadata, input, batch)) return;
    const session = text(field(record, "sessionId"), 4096);
    const version = text(field(record, "version"), 4096);
    const stream = input.streamId === null ? null : this.#streams.get(input.streamId);
    this.#metadata.set(id, Object.freeze({ id, ownerRootSessionId: input.sourceState.ownerRootSessionId, declaredRootSessionId: session === null ? null : claudeStreamId(this.#context, session), sessionId: input.streamId, agentId: stream?.agentId ?? null, isSidechain: stream?.isSidechain ?? null, versionFingerprint: version === null ? null : this.#context.fingerprint("source", ["claude_version", version]), declarationFingerprint: input.declarationFingerprint, origin: input.origin, sourceRef: input.sourceRef }));
    this.#observe(input, batch, "metadata");
  }
  #messageRecord(record: unknown, input: Input, batch: WorkBatch, kind: ClaudeMessageLink["kind"]): boolean {
    const rawUuid = text(field(record, "uuid"), 4096);
    if (rawUuid === null) { this.#warn("UNATTRIBUTED_RECORD", input, batch); return true; }
    const streamId = input.streamId!;
    const id = claudeMessageId(this.#context, streamId, rawUuid);
    input.messageId = id;
    const parent = text(field(record, "parentUuid"), 4096);
    const sourceAssistant = text(field(record, "sourceToolAssistantUUID"), 4096);
    const rawResponse = kind === "assistant" ? text(field(field(record, "message"), "id"), 4096) : null;
    const parentMessageId = parent === null ? null : claudeMessageId(this.#context, streamId, parent);
    const sourceToolAssistantMessageId = sourceAssistant === null ? null : claudeMessageId(this.#context, streamId, sourceAssistant);
    const encoded = canonical({ kind, parentMessageId, sourceToolAssistantMessageId, responseId: rawResponse, content: field(field(record, "message"), "content") ?? null, durationMs: kind === "system" ? field(record, "durationMs") ?? null : null });
    if (encoded === null) { this.#warn("INVALID_RECORD", input, batch); return false; }
    const digest = this.#context.fingerprint("event", ["claude_message", encoded]);
    const prior = this.#messages.get(id);
    if (!prior && !this.#room(this.#messages.size, this.#limits.messageLinks, input, batch)) return false;
    if (!prior) {
      const edges = Number(parentMessageId !== null) + Number(sourceToolAssistantMessageId !== null);
      const fits = this.#messageEdges + edges <= this.#limits.messageLinks;
      if (!fits) { this.#limited = true; this.#warn("STATE_LIMIT", input, batch); }
      const link: ClaudeMessageLink = Object.freeze({ id, sessionId: streamId, kind, parentMessageId: fits ? parentMessageId : null, sourceToolAssistantMessageId: fits ? sourceToolAssistantMessageId : null, responseId: rawResponse === null ? null : claudeResponseId(this.#context, streamId, rawResponse), conflicted: false, sourceRef: input.sourceRef });
      this.#messages.set(id, Object.freeze({ link, digest }));
      if (fits) this.#messageEdges += edges;
    } else if (prior.digest !== digest) {
      this.#warn("INCONSISTENT_REPLAY", input, batch);
      this.#messages.set(id, Object.freeze({ ...prior, link: Object.freeze({ ...prior.link, conflicted: true }) }));
      // A conflicting UUID can omit the original tool block. Refresh matching
      // retained native searches once, without a new index or retained state.
      if (!prior.link.conflicted) for (const state of this.#events.values()) {
        if (state.callMessageId === id && state.event.kind === "search" && (state.event.toolName === "Grep" || state.event.toolName === "Glob")) {
          state.conflicted = true; this.#refreshEvent(state, input, batch);
        }
      }
    }
    const usage = canonical(field(field(record, "message"), "usage") ?? null);
    const replay = this.#context.fingerprint("event", ["claude_uuid_replay", id, digest, usage, stopReason(field(field(record, "message"), "stop_reason"))]);
    input.semanticReplayId = replay;
    input.replay = this.#uuidReplays.has(replay);
    if (!input.replay && !this.#room(this.#uuidReplays.size, this.#limits.messageLinks, input, batch)) return false;
    this.#uuidReplays.add(replay); this.#shapes.add("message_link"); this.#observe(input, batch, "message");
    return true;
  }

  #emitEvent(state: ExecutionState, input: Input, batch: WorkBatch): void {
    this.#events.set(state.event.id, state); batch.events.set(state.event.id, state.event);
    if (state.event.status === "failed" && state.event.errorFingerprint === null) this.#warn("INSUFFICIENT_ERROR_EVIDENCE", input, batch, state.result?.position ?? null);
  }
  #position(input: Input): Position { return Object.freeze({ fileId: input.fileId, ordinal: input.source.ordinal, sourceRef: input.sourceRef, sourceAlias: diagnostic("INVALID_RECORD", input.source.sourceAlias ?? null).sourceAlias }); }
  #call(block: unknown, record: unknown, input: Input, batch: WorkBatch): void {
    const rawId = text(field(block, "id"), 4096);
    const rawName = text(field(block, "name"), 4096);
    const args = field(block, "input");
    const encoded = canonical(args);
    if (rawId === null || rawName === null || !object(args) || encoded === null) { this.#warn("INVALID_RECORD", input, batch); return; }
    const streamId = input.streamId!;
    const id = claudeEventId(this.#context, streamId, rawId);
    const prior = this.#events.get(id);
    if (!prior && !this.#room(this.#events.size, this.#limits.events, input, batch)) return;
    const classified = tool(rawName);
    const earlier = prior?.position.fileId === input.fileId && input.source.ordinal < prior.position.ordinal;
    const project = prior && !earlier ? prior.callProjectId : input.projectId;
    const baseInputDigest = this.#context.fingerprint("event", ["claude_call_input", rawName, encoded]);
    const nativeSearch = rawName === "Grep" || rawName === "Glob";
    const version = nativeSearch ? text(field(record, "version"), 4096) : null;
    const search = nativeSearch ? extractClaudeSearch(rawName, args, version) : null;
    // Compose bounded opaque evidence, never re-escape a near-budget raw input.
    const inputDigest = nativeSearch ? this.#context.fingerprint("event", ["claude_native_search_replay/v1", baseInputDigest,
      version === null ? "absent_or_invalid" : this.#context.fingerprint("source", ["claude_version", version]), search === null ? "rejected" : "eligible"]) : baseInputDigest;
    const normalized = normalizeEvent({ provider: "claude", eventIdentity: rawId, sessionIdentity: streamId, kind: classified.kind, toolName: classified.name,
      command: classified.callKind === "bash" ? field(args, "command") : undefined,
      operationParts: ["claude_tool", rawName, encoded], projectIdentity: project, ...search,
      filePath: ["file_read", "file_write", "file_edit"].includes(classified.kind) ? field(args, "file_path") : undefined,
      startAt: input.at, status: "pending", statusEvidence: "explicit",
      sourceRef: { fileIdentity: input.source.fileIdentity, byteOffset: input.sourceRef.byteOffset, recordType: "assistant" },
    }, this.#context);
    for (const warning of normalized.diagnostics) this.#warn(warning.code, input, batch);
    if (normalized.event === null) return;
    const callDigest = this.#context.fingerprint("event", ["claude_call", inputDigest, project]);
    const operationKey = classified.callKind === "bash" && normalized.event.operationKey !== null ? this.#context.fingerprint("operation", ["claude_bash", normalized.event.operationKey, encoded]) : normalized.event.operationKey;
    const candidate: NormalizedEvent = Object.freeze({ ...normalized.event, id, sessionId: streamId, parentEventId: null, turnId: null, operationKey });
    let state: ExecutionState;
    if (!prior) state = { event: candidate, callDigest, inputDigest, callProjectId: project, position: this.#position(input), callMessageId: input.messageId, callKind: classified.callKind, backgroundRequested: field(args, "run_in_background") === true, result: null, conflicted: false };
    else {
      state = prior;
      if (prior.inputDigest !== inputDigest || prior.callProjectId !== null && input.projectId !== null && prior.callProjectId !== input.projectId) {
        this.#warn("INCONSISTENT_REPLAY", input, batch); state.conflicted = true;
        state.event = Object.freeze({ ...state.event, kind: "other", category: "other", toolName: "other", commandPattern: null, operationKey: null, lookupKey: null, fileFingerprint: null });
      } else if (earlier) {
        // Source order is an authority within one file. Wall-clock minima are not.
        state.position = this.#position(input); state.callMessageId = input.messageId; state.callDigest = callDigest; state.callProjectId = project;
        state.event = state.conflicted ? Object.freeze({ ...state.event, startAt: candidate.startAt, sourceRef: candidate.sourceRef }) : candidate;
        this.#warn("REORDERED_RECORD", input, batch);
      }
    }
    this.#events.set(id, state);
    if (input.messageId !== null && this.#messages.get(input.messageId)?.link.conflicted) state.conflicted = true;
    const deferred = this.#deferredResults.get(id);
    if (deferred) { this.#deferredResults.delete(id); this.#applyResult(state, deferred, input, batch); }
    else this.#refreshEvent(state, input, batch);
    this.#shapes.add("tool_use"); this.#observe(input, batch, "call", id);
  }
  #safeResult(block: unknown, record: unknown, rawId: string, input: Input, batch: WorkBatch, singleResult: boolean): SafeResult | null {
    const body = field(block, "content");
    const encoded = canonical(body ?? null);
    if (encoded === null) { this.#warn("INVALID_RECORD", input, batch); return null; }
    const rawError = field(block, "is_error");
    const isError = typeof rawError === "boolean" ? rawError : null;
    if (rawError !== undefined && typeof rawError !== "boolean") this.#warn("INVALID_RECORD", input, batch);
    const fullRootResult = field(record, "toolUseResult");
    const rootResult = singleResult ? fullRootResult : null;
    const rawBackground = text(field(rootResult, "backgroundTaskId"), 4096);
    const backgroundTaskId = rawBackground === null ? null : this.#context.fingerprint("event", ["claude_background", input.streamId, rawBackground]);
    const asyncLaunched = field(rootResult, "isAsync") === true && field(rootResult, "status") === "async_launched";
    const unassignedAcknowledgement = !singleResult && (field(fullRootResult, "backgroundTaskId") !== undefined || field(fullRootResult, "isAsync") === true);
    if (unassignedAcknowledgement) this.#warn("UNSUPPORTED_RELATION", input, batch);
    const complete = input.source.trustedFixtureContext?.completeResults?.some((entry) => entry.ordinal === input.source.ordinal && entry.toolUseId === rawId) === true;
    const truncated = field(block, "truncated") === true || field(fullRootResult, "truncated") === true || (typeof body === "string" && /^Warning: truncated output/.test(body));
    const textOnly = typeof body === "string" || Array.isArray(body) && body.every((entry) => ["text", "input_text"].includes(field(entry, "type") as string) && typeof field(entry, "text") === "string");
    const contentState = truncated ? "truncated" : complete && textOnly ? "complete" : "unknown";
    const contentFingerprint = contentState === "complete" ? this.#context.fingerprint("content", ["claude_result_content", encoded]) : null;
    const hasErrorText = typeof body === "string" ? body.trim().length > 0 : Array.isArray(body) && body.some((entry) => typeof field(entry, "text") === "string" && (field(entry, "text") as string).trim().length > 0);
    const errorFingerprint = isError === true && contentFingerprint !== null && hasErrorText ? this.#context.fingerprint("error", ["claude", "tool_error", contentFingerprint]) : null;
    const timing = input.source.trustedFixtureContext?.toolTimings?.find((entry) => entry.ordinal === input.source.ordinal && entry.toolUseId === rawId);
    const scoped = timing?.source === "tool_use_result_duration_ms" && ["process_runtime", "invocation_latency", "item_lifecycle"].includes(timing.durationScope);
    const rawDuration = field(field(record, "toolUseResult"), "durationMs");
    const directDurationMs = scoped ? milliseconds(rawDuration) : null;
    const directDurationScope: DurationScope = directDurationMs === null ? "unknown" : timing!.durationScope;
    if (scoped && directDurationMs === null) this.#warn("INVALID_TIMING", input, batch);
    else if (!scoped && rawDuration !== undefined) this.#warn("TIMING_SCOPE_UNKNOWN", input, batch);
    const digest = this.#context.fingerprint("event", ["claude_result", encoded, isError, backgroundTaskId, asyncLaunched, unassignedAcknowledgement, directDurationMs, directDurationScope]);
    return Object.freeze({ digest, at: input.at, position: this.#position(input), isError, backgroundTaskId, asyncLaunched, unassignedAcknowledgement, contentFingerprint, contentState, errorFingerprint, directDurationMs, directDurationScope, conflicted: false });
  }
  #result(block: unknown, record: unknown, input: Input, batch: WorkBatch, singleResult: boolean): void {
    const rawId = text(field(block, "tool_use_id"), 4096);
    if (rawId === null) { this.#warn("INVALID_RECORD", input, batch); return; }
    const id = claudeEventId(this.#context, input.streamId!, rawId);
    const result = this.#safeResult(block, record, rawId, input, batch, singleResult);
    if (result === null) return;
    const replay = this.#context.fingerprint("event", ["claude_result_replay", id, result.digest]);
    if (!this.#resultReplays.has(replay) && !this.#room(this.#resultReplays.size, this.#limits.resultReplays, input, batch)) return;
    this.#resultReplays.add(replay);
    const state = this.#events.get(id);
    if (state) this.#applyResult(state, result, input, batch);
    else {
      const prior = this.#deferredResults.get(id);
      if (!prior && !this.#room(this.#deferredResults.size, this.#limits.deferredResults, input, batch)) return;
      if (prior && prior.digest !== result.digest) { this.#warn("INCONSISTENT_REPLAY", input, batch); this.#deferredResults.set(id, Object.freeze({ ...prior, conflicted: true })); }
      else if (!prior || prior.position.fileId === result.position.fileId && result.position.ordinal < prior.position.ordinal) this.#deferredResults.set(id, result);
      this.#warn("REORDERED_RECORD", input, batch);
    }
    this.#shapes.add("tool_result"); this.#observe(input, batch, "result", id, null, null, null, this.#resultObservation(state, result));
  }
  #applyResult(state: ExecutionState, result: SafeResult, input: Input, batch: WorkBatch): void {
    const prior = state.result;
    if (result.conflicted || prior && prior.digest !== result.digest) { state.conflicted = true; this.#warn("INCONSISTENT_REPLAY", input, batch); }
    if (!prior || prior.digest === result.digest && prior.position.fileId === result.position.fileId && result.position.ordinal < prior.position.ordinal) state.result = result;
    this.#refreshEvent(state, input, batch);
  }
  #completionKind(state: ExecutionState | undefined, result: SafeResult): ClaudeResultObservation["completionKind"] {
    if (!state || result.unassignedAcknowledgement) return "unknown";
    if (this.#matchedBackground(state, result) && result.isError !== true) return "background_acknowledgement";
    if (result.backgroundTaskId !== null || result.asyncLaunched) return "unknown";
    return "invocation_result";
  }
  #matchedBackground(state: ExecutionState, result: SafeResult): boolean {
    return state.callKind === "bash" && state.backgroundRequested && result.backgroundTaskId !== null || state.callKind === "agent" && result.asyncLaunched;
  }
  #resultObservation(state: ExecutionState | undefined, result: SafeResult): ClaudeResultObservation {
    const completionKind = this.#completionKind(state, result);
    return Object.freeze({ isError: result.isError, completionKind, unassignedAcknowledgement: result.unassignedAcknowledgement, observedAt: result.at, acknowledgementLatencyMs: completionKind === "background_acknowledgement" ? elapsed(state?.event.startAt ?? null, result.at) : null, durationMs: result.directDurationMs, durationScope: result.directDurationScope });
  }
  #refreshEvent(state: ExecutionState, input: Input, batch: WorkBatch): void {
    const result = state.result;
    if (!result) {
      if (state.conflicted) state.event = Object.freeze({ ...state.event, lookupKey: null, status: "unknown", executionOutcome: "unknown", endAt: null, durationMs: null, timingEvidence: "unknown", durationScope: "unknown", intervalScope: "unknown", intervalTimingEvidence: "unknown" });
      this.#emitEvent(state, input, batch); return;
    }
    const completion = this.#completionKind(state, result);
    const pending = completion === "background_acknowledgement";
    if (pending) this.#shapes.add("background_acknowledgement");
    if (this.#matchedBackground(state, result) && result.isError === true) this.#warn("STATUS_CONFLICT", input, batch, result.position);
    else if (completion === "unknown") this.#warn("UNSUPPORTED_RELATION", input, batch, result.position);
    const status = state.conflicted ? "unknown" : pending ? "pending" : completion === "unknown" ? "unknown" : result.isError === true ? "failed" : result.isError === false ? "completed" : "unknown";
    if (status === "unknown") this.#partial = true;
    let endAt = pending || completion === "unknown" ? null : result.at;
    let paired = elapsed(state.event.startAt, endAt);
    if (state.event.startAt !== null && endAt !== null && paired === null) { this.#warn("INVALID_TIMING", input, batch, result.position); endAt = null; }
    let durationMs = pending || completion === "unknown" ? null : result.directDurationMs ?? paired;
    let timingEvidence: NormalizedEvent["timingEvidence"] = durationMs === null ? "unknown" : result.directDurationMs !== null ? "source_reported" : "paired_timestamps";
    let durationScope: DurationScope = durationMs === null ? "unknown" : result.directDurationMs !== null ? result.directDurationScope : "invocation_latency";
    let intervalScope: DurationScope = paired === null ? "unknown" : "invocation_latency";
    let intervalTimingEvidence: NormalizedEvent["intervalTimingEvidence"] = paired === null ? "unknown" : "paired_timestamps";
    if (durationMs !== null && paired !== null && durationScope === intervalScope && Math.abs(durationMs - paired) > 1) { this.#warn("TIMING_CONFLICT", input, batch, result.position); intervalScope = "unknown"; intervalTimingEvidence = "unknown"; }
    if (state.conflicted) { durationMs = null; timingEvidence = "unknown"; durationScope = "unknown"; intervalScope = "unknown"; intervalTimingEvidence = "unknown"; }
    state.event = Object.freeze({ ...state.event, lookupKey: state.conflicted ? null : state.event.lookupKey, endAt, durationMs, timingEvidence, durationScope, intervalScope, intervalTimingEvidence, status, executionOutcome: status === "completed" ? "success" : status === "failed" ? "error" : "unknown", exitCode: null,
      contentFingerprint: state.conflicted ? null : result.contentFingerprint, contentState: state.conflicted ? "unknown" : result.contentState, errorFingerprint: status === "failed" ? result.errorFingerprint : null, errorClass: status === "failed" ? "tool_error" : null,
      sourceRef: Object.freeze({ ...result.position.sourceRef, recordType: "user" }),
    });
    this.#emitEvent(state, input, batch);
    const observationId = this.#context.fingerprint("source", ["claude_observation", result.position.fileId, result.position.sourceRef.byteOffset, "result", state.event.id, null, null]);
    const original = this.#observations.get(observationId);
    if (original) {
      const updated: ClaudeSourceObservation = Object.freeze({ ...original, observedResult: this.#resultObservation(state, result) });
      this.#observations.set(observationId, updated); batch.observations.set(observationId, updated);
    }
  }
  #turn(record: unknown, input: Input, batch: WorkBatch): void {
    const uuid = text(field(record, "uuid"), 4096);
    if (uuid === null) { this.#warn("UNATTRIBUTED_RECORD", input, batch); return; }
    const id = claudeTurnId(this.#context, input.streamId!, uuid);
    const prior = this.#turns.get(id);
    if (!prior && !this.#room(this.#turns.size, this.#limits.turns, input, batch)) return;
    const duration = integer(field(record, "durationMs"));
    const conflicted = prior?.selection === "conflicted" || prior !== undefined && prior.durationMs !== duration;
    if (duration === null) this.#warn("INVALID_TIMING", input, batch);
    if (conflicted) this.#warn("INCONSISTENT_REPLAY", input, batch);
    this.#warn("TIMING_SCOPE_UNKNOWN", input, batch);
    const turn: ClaudeTurn = Object.freeze({ id, sessionId: input.streamId!, provider: "claude", observedAt: prior?.observedAt ?? input.at, startAt: null, endAt: null, intervalScope: "unknown", intervalTimingEvidence: "unknown", durationMs: conflicted ? null : duration, timingEvidence: duration === null || conflicted ? "unknown" : "source_reported", durationScope: "unknown", status: "unknown", selection: conflicted ? "conflicted" : duration === null ? "invalid" : "duration_only", sourceRef: prior?.sourceRef ?? input.sourceRef });
    this.#turns.set(id, turn); batch.turns.set(id, turn); this.#shapes.add("turn_duration"); this.#observe(input, batch, "turn", null, null, id);
  }
  #messageUsage(message: unknown, input: Input, batch: WorkBatch): void {
    const streamId = input.streamId!;
    const rawResponse = text(field(message, "id"), 4096);
    const responseId = rawResponse === null ? null : claudeResponseId(this.#context, streamId, rawResponse);
    const id = rawResponse === null ? this.#context.fingerprint("event", ["claude_missing_usage_id", streamId, input.messageId, input.messageId === null ? input.fileId : null, input.messageId === null ? input.sourceRef.byteOffset : null]) : claudeUsageId(this.#context, streamId, rawResponse);
    const checked = tokenCounts(field(message, "usage"));
    if (checked.status === "invalid") this.#warn("INVALID_USAGE", input, batch);
    if (checked.status === "partial") this.#warn("INSUFFICIENT_USAGE", input, batch);
    if (rawResponse === null) this.#warn("UNATTRIBUTED_RECORD", input, batch);
    const supplied = input.source.trustedFixtureContext?.usageEvidence?.find((entry) => entry.ordinal === input.source.ordinal && entry.messageId === rawResponse);
    const trusted = supplied && integer(supplied.order) !== null && text(supplied.orderingGroup, 4096) !== null && supplied.mapping === "anthropic_messages" && (supplied.finality === "partial" || supplied.finality === "final") ? supplied : undefined;
    const finality: ClaudeUsage["finality"] = trusted?.finality === "final" ? "trusted_final" : trusted?.finality === "partial" ? "trusted_partial" : "unknown";
    const reason = stopReason(field(message, "stop_reason"));
    const terminalCandidate = reason === "end_turn" || reason === "tool_use";
    const observedUsage: NonNullable<ClaudeSourceObservation["observedUsage"]> = Object.freeze({ counts: checked.counts, countStatus: checked.status, finality, stopReason: reason, mapping: "anthropic_messages" });
    this.#shapes.add("message_usage");
    this.#observe(input, batch, "usage", null, id, null, observedUsage);
    const prior = this.#usage.get(id);
    if (trusted) {
      const proofReplay = this.#context.fingerprint("event", ["claude_usage_proof", id, input.semanticReplayId, input.semanticReplayId === null ? canonical(field(message, "usage")) : null, finality, trusted.orderingGroup, trusted.order]);
      if (this.#usageProofReplays.has(proofReplay) && prior) return;
      if (!this.#usageProofReplays.has(proofReplay) && !this.#room(this.#usageProofReplays.size, this.#limits.usageProofReplays, input, batch)) return;
      this.#usageProofReplays.add(proofReplay);
    } else if (input.replay && prior) return;
    if (!prior && (!this.#room(this.#usage.size, this.#limits.usage, input, batch) || !this.#room(this.#usageOrders.size, this.#limits.usageOrders, input, batch))) return;
    const order: UsageOrder = Object.freeze({ fileId: input.fileId, ordinal: input.source.ordinal, group: trusted ? this.#context.fingerprint("source", ["claude_fixture_usage_order", trusted.orderingGroup]) : null, order: trusted?.order ?? null });
    const previousOrder = this.#usageOrders.get(id);
    const trustedComparable = previousOrder?.group !== null && previousOrder?.group !== undefined && order.group !== null && previousOrder.group === order.group;
    const sameFile = previousOrder?.fileId === order.fileId;
    const comparable = trustedComparable || sameFile;
    const comparison = !previousOrder || !comparable ? 0 : trustedComparable ? Math.sign(order.order! - previousOrder.order!) : Math.sign(order.ordinal - previousOrder.ordinal);
    const changed = prior !== undefined && !sameCounts(prior.counts, checked.counts);
    const final = finality === "trusted_final";
    const priorFinal = prior?.finality === "trusted_final";
    const earlierReplay = comparable && comparison < 0 && !final;
    const preserveFinal = priorFinal && !final && (!changed || trustedComparable && earlierReplay);
    const preserve = earlierReplay || preserveFinal;
    if (earlierReplay) this.#warn("REORDERED_RECORD", input, batch);
    const advancing = comparison > 0 && !priorFinal;
    const messageConflict = input.messageId !== null && this.#messages.get(input.messageId)?.link.conflicted === true;
    const conflict = prior?.selection === "conflicted" || messageConflict || !preserve && changed && !advancing;
    if (conflict) this.#warn("USAGE_CONFLICT", input, batch);
    const limitations: ClaudeUsage["limitations"][number][] = [];
    if (finality !== "trusted_final") { limitations.push("unknown_finality"); this.#partial = true; }
    if (checked.status === "partial") limitations.push("partial_counts");
    if (checked.status === "invalid") limitations.push("invalid_counts");
    if (responseId === null) limitations.push("missing_response_id");
    if (input.origin === "ambiguous") limitations.push("ambiguous_origin");
    if (conflict) limitations.push("conflict");
    if (changed && !comparable) limitations.push("unknown_source_order");
    const usage: ClaudeUsage = Object.freeze({ id, sessionId: streamId, responseId, provider: "claude", source: "message_usage", scope: "response_snapshot", counts: conflict ? null : checked.counts, countStatus: checked.status, mapping: "anthropic_messages", finality,
      selection: conflict ? "conflicted" : checked.status === "invalid" || responseId === null ? "invalid" : final && checked.status === "complete" && input.origin === "ordinary" ? "eligible" : "provisional",
      stopReason: reason, terminalCandidate, limitations: Object.freeze(limitations), turnId: null, toolEventId: null, phase: "unknown", sourceRef: input.sourceRef,
    });
    if (!preserve || conflict) {
      if (!prior || changed || usage.selection !== prior.selection || usage.finality !== prior.finality || reason !== prior.stopReason || comparison > 0) { this.#usage.set(id, usage); batch.usage.set(id, usage); }
      if (!previousOrder || comparison > 0) this.#usageOrders.set(id, order);
    }
  }
}

export function createClaudeAdapter(context: IdentityContext, limits: Partial<ClaudeLimits> = {}, capture: ParserCaptureOptions = {}): ClaudeAdapter { return new ClaudeAdapter(context, limits, capture); }
