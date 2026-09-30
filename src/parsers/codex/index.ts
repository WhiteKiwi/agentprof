import { normalizeEvent } from "../../normalize/event.js";
import type { IdentityContext } from "../../normalize/identity.js";
import type { NormalizedEvent } from "../../normalize/types.js";
import { diagnostic, SafeError } from "../../privacy/diagnostics.js";
import type { DiagnosticCode, SafeDiagnostic } from "../../privacy/diagnostics.js";
import type { CodexBatch, CodexInputSource, CodexLimits, CodexShape, CodexSnapshot, MetadataSegment, NormalizedTurn, ParserCapabilities, ParserSourceRef, SourceObservation, TokenCounts, UsageObservation, WrapperRepresentation } from "../types.js";
import { argumentsObject, command, semanticExit, supportedShell, toolKind } from "./command.js";
import type { ExitPolicy } from "./command.js";
import { elapsed, epochSeconds, exitCode, field, integer, jsonObject, milliseconds, object, rustDuration, text, utc } from "./fields.js";
import { processKey, readOutput } from "./output.js";
import type { SafeOutput } from "./output.js";
import { decreased, sameCounts, tokenCounts } from "./usage.js";

export const DEFAULT_CODEX_LIMITS: CodexLimits = Object.freeze({ events: 4096, turns: 4096, usage: 4096, sources: 256, streams: 256, links: 1024, observations: 8192, metadata: 8192, diagnostics: 8192 });
type SourceState = { ownerId: string | null; activeTurnId: string | null; ambiguous: boolean; nativeUsageVerified: boolean };
type StreamState = { projectId: string | null; versionFingerprint: string | null; forkParentId: string | null };
type ExecutionState = { event: NormalizedEvent; policy: ExitPolicy; mode: "exec" | "mcp" | "patch"; callSeen: boolean; callOperationKey: string | null; structured: boolean; conflicted: boolean; result: SafeResult | null; structuredDigest: string | null };
type SafeResult = Readonly<{ exec: SafeOutput; mcp: SafeOutput; other: SafeOutput; at: string | null; sourceRef: ParserSourceRef; digest: string; conflicted: boolean }>;
type UsageOrder = Readonly<{ group: string; order: number }>;
type WorkBatch = { events: Map<string, NormalizedEvent>; turns: Map<string, NormalizedTurn>; usage: Map<string, UsageObservation>; observations: Map<string, SourceObservation>; diagnostics: SafeDiagnostic[] };
type Input = { source: CodexInputSource; fileId: string; sourceState: SourceState; sourceRef: ParserSourceRef; at: string | null; origin: SourceObservation["origin"]; completeOutput: boolean };

/** Raw provider IDs are accepted only transiently; all retained keys are locally keyed. */
export function codexStreamId(context: IdentityContext, rawThreadId: string): string { return context.fingerprint("session", ["codex", rawThreadId]); }
export function codexEventId(context: IdentityContext, streamId: string, rawItemId: string): string { return context.fingerprint("event", ["codex", streamId, rawItemId]); }
export function codexTurnId(context: IdentityContext, streamId: string, rawTurnId: string): string { return context.fingerprint("turn", ["codex", streamId, rawTurnId]); }

// Bound and canonicalize JSON arguments while the input record is present.
function canonical(value: unknown, depth = 0, budget = { nodes: 0 }): string | null {
  if (depth > 32 || ++budget.nodes > 8192) return null;
  if (value === null || typeof value === "boolean" || typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) return JSON.stringify(value);
  if (Array.isArray(value)) {
    const parts = value.map((part) => canonical(part, depth + 1, budget));
    return parts.some((part) => part === null) ? null : `[${parts.join(",")}]`;
  }
  if (!object(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.length > 4096) return null;
  const parts: string[] = [];
  for (const key of keys) {
    const valueAtKey = field(value, key);
    if (valueAtKey === undefined) continue;
    const part = canonical(valueAtKey, depth + 1, budget);
    if (part === null) return null;
    parts.push(`${JSON.stringify(key)}:${part}`);
  }
  const encoded = `{${parts.join(",")}}`;
  return Buffer.byteLength(encoded) <= 1_048_576 ? encoded : null;
}
function transportStatus(value: unknown): SourceObservation["transportStatus"] {
  return value === "completed" || value === "failed" || value === "cancelled" || value === "pending" ? value : "unknown";
}

export class CodexAdapter {
  readonly #context: IdentityContext;
  readonly #limits: CodexLimits;
  readonly #sources = new Map<string, SourceState>();
  readonly #streams = new Map<string, StreamState>();
  readonly #events = new Map<string, ExecutionState>();
  readonly #unsupportedCalls = new Set<string>();
  readonly #pendingResults = new Map<string, SafeResult>();
  readonly #resultReplays = new Set<string>();
  readonly #processes = new Map<string, string | null>();
  readonly #polls = new Map<string, string>();
  readonly #turns = new Map<string, NormalizedTurn>();
  readonly #usage = new Map<string, UsageObservation>();
  readonly #usageOrder = new Map<string, UsageOrder>();
  readonly #lastSnapshots = new Map<string, Readonly<{ counts: TokenCounts; at: string | null }>>();
  readonly #wrappers = new Map<string, WrapperRepresentation>();
  readonly #metadata = new Map<string, MetadataSegment>();
  readonly #observations = new Map<string, SourceObservation>();
  readonly #diagnostics = new Map<string, SafeDiagnostic>();
  readonly #shapes = new Set<CodexShape>();
  #partial = false;
  #limited = false;
  #unsupported = 0;
  #ambiguous = 0;
  #diagnosticsDropped = 0;
  #wrapperChildLinks = 0;

  constructor(context: IdentityContext, limits: Partial<CodexLimits> = {}) {
    this.#context = context;
    const selected = { ...DEFAULT_CODEX_LIMITS, ...limits };
    if (Object.keys(selected).some((key) => !Object.hasOwn(DEFAULT_CODEX_LIMITS, key)) || Object.values(selected).some((value) => !Number.isSafeInteger(value) || value < 1 || value > 1_000_000)) throw new SafeError("INVALID_ARGUMENT");
    this.#limits = Object.freeze(selected);
  }

  #capabilities(): ParserCapabilities {
    return Object.freeze({ provider: "codex", parserVersion: 1, support: "shape_verified_only", coverage: this.#partial ? "partial" : "recognized_shapes", observedShapes: Object.freeze([...this.#shapes].sort()), unsupportedRecords: this.#unsupported, ambiguousRecords: this.#ambiguous, stateLimited: this.#limited, diagnosticsDropped: this.#diagnosticsDropped });
  }
  #warn(code: DiagnosticCode, input: Input | null, batch: WorkBatch): void {
    this.#partial = true;
    const value = diagnostic(code, input?.source.sourceAlias ?? null, input?.sourceRef.byteOffset ?? null);
    const key = `${input?.fileId ?? "none"}:${value.byteOffset ?? "none"}:${code}`;
    if (this.#diagnostics.has(key)) return;
    if (this.#diagnostics.size >= this.#limits.diagnostics) {
      this.#limited = true;
      this.#diagnosticsDropped = Math.min(Number.MAX_SAFE_INTEGER, this.#diagnosticsDropped + 1);
      return;
    }
    this.#diagnostics.set(key, value); batch.diagnostics.push(value);
  }
  #room(size: number, limit: number, input: Input | null, batch: WorkBatch): boolean {
    if (size < limit) return true;
    this.#limited = true; this.#warn("STATE_LIMIT", input, batch); return false;
  }
  #stream(id: string, input: Input, batch: WorkBatch): StreamState | null {
    const existing = this.#streams.get(id);
    if (existing) return existing;
    if (!this.#room(this.#streams.size, this.#limits.streams, input, batch)) return null;
    const state: StreamState = { projectId: null, versionFingerprint: null, forkParentId: null };
    this.#streams.set(id, state); return state;
  }
  #observe(input: Input, batch: WorkBatch, representation: SourceObservation["representation"], eventId: string | null = null, turnId: string | null = null, usageId: string | null = null, status: unknown = null, observedUsage: SourceObservation["observedUsage"] = null): boolean {
    const id = this.#context.fingerprint("source", ["codex_observation", input.fileId, input.sourceRef.byteOffset, representation, eventId, turnId, usageId]);
    if (this.#observations.has(id)) return false;
    if (!this.#room(this.#observations.size, this.#limits.observations, input, batch)) return false;
    const observation: SourceObservation = Object.freeze({ id, eventId, turnId, usageId, representation, origin: input.origin, transportStatus: transportStatus(status), observedUsage, sourceRef: input.sourceRef });
    this.#observations.set(id, observation); batch.observations.set(id, observation);
    return true;
  }
  #unsupportedRecord(input: Input, batch: WorkBatch, eventId: string | null = null): void {
    this.#warn("UNSUPPORTED_RECORD", input, batch);
    if (this.#observe(input, batch, "unsupported", eventId)) this.#unsupported = Math.min(Number.MAX_SAFE_INTEGER, this.#unsupported + 1);
  }
  #rememberUnsupportedCall(id: string, input: Input, batch: WorkBatch): void {
    if (this.#unsupportedCalls.has(id) || this.#room(this.#unsupportedCalls.size, this.#limits.events, input, batch)) this.#unsupportedCalls.add(id);
    this.#pendingResults.delete(id);
  }

  ingest(record: unknown, source: CodexInputSource): CodexBatch {
    const batch: WorkBatch = { events: new Map(), turns: new Map(), usage: new Map(), observations: new Map(), diagnostics: [] };
    let input: Input | null = null;
    try {
      if (!object(record) || text(source.fileIdentity) === null || integer(source.byteOffset) === null || integer(source.ordinal) === null) {
        this.#warn("INVALID_RECORD", null, batch); return this.#finish(batch);
      }
      const fileId = this.#context.fingerprint("source", ["codex", source.fileIdentity]);
      const existing = this.#sources.get(fileId);
      if (!existing && !this.#room(this.#sources.size, this.#limits.sources, null, batch)) return this.#finish(batch);
      const sourceState = existing ?? { ownerId: null, activeTurnId: null, ambiguous: false, nativeUsageVerified: false };
      this.#sources.set(fileId, sourceState);
      const copied = source.trustedFixtureContext?.knownCopiedOrdinals?.includes(source.ordinal) === true;
      input = { source, fileId, sourceState, sourceRef: Object.freeze({ fileId, byteOffset: source.byteOffset }), at: utc(field(record, "timestamp")), origin: copied ? "trusted_copied" : sourceState.ambiguous ? "ambiguous" : "ordinary", completeOutput: source.trustedFixtureContext?.knownCompleteOutputOrdinals?.includes(source.ordinal) === true };
      const type = field(record, "type");
      const payload = field(record, "payload");
      if (!object(payload)) { this.#warn("INVALID_RECORD", input, batch); return this.#finish(batch); }
      if (type === "session_meta") this.#metadataRecord(payload, input, batch);
      else if (copied) this.#observe(input, batch, "unsupported");
      else {
        if (sourceState.ambiguous) this.#warn("AMBIGUOUS_ORIGIN", input, batch);
        if (type === "event_msg") this.#eventMessage(payload, input, batch);
        else if (type === "response_item") this.#response(payload, input, batch);
        else if (type === "token_usage_record") this.#responseUsage(payload, input, batch, true);
        else if (type === "turn_context") this.#turnContext(payload, input, batch);
        else this.#unsupportedRecord(input, batch);
      }
      if (input.origin === "ambiguous" && this.#observe(input, batch, "provenance")) this.#ambiguous = Math.min(Number.MAX_SAFE_INTEGER, this.#ambiguous + 1);
    } catch {
      // No provider text, thrown message, stack, path or arbitrary type escapes the API.
      this.#warn("INVALID_RECORD", input, batch);
    }
    return this.#finish(batch);
  }
  #finish(batch: WorkBatch): CodexBatch {
    return Object.freeze({ events: Object.freeze([...batch.events.values()]), turns: Object.freeze([...batch.turns.values()]), usage: Object.freeze([...batch.usage.values()]), observations: Object.freeze([...batch.observations.values()]), diagnostics: Object.freeze(batch.diagnostics), capabilities: this.#capabilities() });
  }
  snapshot(): CodexSnapshot {
    return Object.freeze({
      events: Object.freeze([...this.#events.values()].map((state) => state.event)),
      turns: Object.freeze([...this.#turns.values()]), usage: Object.freeze([...this.#usage.values()]),
      observations: Object.freeze([...this.#observations.values()]), diagnostics: Object.freeze([...this.#diagnostics.values()]),
      wrappers: Object.freeze([...this.#wrappers.values()]), metadata: Object.freeze([...this.#metadata.values()]),
      capabilities: this.#capabilities(),
      stateCounts: Object.freeze({ sources: this.#sources.size, streams: this.#streams.size, events: this.#events.size, wrappers: this.#wrappers.size, wrapperChildLinks: this.#wrapperChildLinks, unsupportedCalls: this.#unsupportedCalls.size, pendingResults: this.#pendingResults.size, resultReplays: this.#resultReplays.size, pollLinks: this.#polls.size, processLinks: this.#processes.size, turns: this.#turns.size, usage: this.#usage.size, usageOrders: this.#usageOrder.size, snapshotSeries: this.#lastSnapshots.size, observations: this.#observations.size, metadata: this.#metadata.size, diagnostics: this.#diagnostics.size }),
    });
  }
  /** Explicit safe state inspection for privacy/limit verification, not durable P4 state. */
  inspectRetainedState(): unknown {
    return Object.freeze({ snapshot: this.snapshot(), sources: Object.freeze([...this.#sources.values()].map((state) => Object.freeze({ ...state }))), streams: Object.freeze([...this.#streams.values()].map((state) => Object.freeze({ ...state }))), executionState: Object.freeze([...this.#events.values()].map((state) => Object.freeze({ ...state }))), unsupportedCalls: Object.freeze([...this.#unsupportedCalls]), pendingResults: Object.freeze([...this.#pendingResults.values()]), resultReplays: Object.freeze([...this.#resultReplays]), processLinks: Object.freeze([...this.#processes.entries()].map((entry) => Object.freeze(entry))), pollLinks: Object.freeze([...this.#polls.entries()].map((entry) => Object.freeze(entry))), usageOrders: Object.freeze([...this.#usageOrder.values()]), lastSnapshots: Object.freeze([...this.#lastSnapshots.values()]) });
  }

  #metadataRecord(payload: unknown, input: Input, batch: WorkBatch): void {
    const rawId = text(field(payload, "id"), 4096);
    if (rawId === null) { this.#warn("UNATTRIBUTED_RECORD", input, batch); return; }
    const declaredId = codexStreamId(this.#context, rawId);
    if (input.sourceState.ownerId === null) {
      input.sourceState.ownerId = declaredId;
      input.sourceState.nativeUsageVerified = ["0.153.4", "0.157.0", "0.159.0", "0.159.2"].includes(field(payload, "cli_version") as string);
    }
    const owner = input.sourceState.ownerId;
    const parent = text(field(payload, "forked_from_id"), 4096);
    const version = text(field(payload, "cli_version"), 4096);
    const versionFingerprint = version === null ? null : this.#context.fingerprint("source", ["codex_version", version]);
    const parentId = parent === null ? null : codexStreamId(this.#context, parent);
    if ((parent !== null || field(payload, "subagent_history_start_ordinal") !== undefined || owner !== declaredId) && input.source.trustedFixtureContext?.knownCopiedOrdinals === undefined) {
      input.sourceState.ambiguous = true; input.origin = "ambiguous"; this.#warn("AMBIGUOUS_ORIGIN", input, batch);
    }
    const stream = this.#stream(owner, input, batch);
    if (stream && owner === declaredId && input.origin !== "trusted_copied") {
      const cwd = text(field(payload, "cwd"));
      if (stream.projectId === null && cwd !== null) stream.projectId = this.#context.fingerprint("file", ["codex_project", cwd]);
      if (stream.versionFingerprint === null) stream.versionFingerprint = versionFingerprint;
      if (stream.forkParentId === null) stream.forkParentId = parentId;
    }
    const id = this.#context.fingerprint("source", ["codex_metadata", input.fileId, input.sourceRef.byteOffset]);
    if (!this.#metadata.has(id) && this.#room(this.#metadata.size, this.#limits.metadata, input, batch)) this.#metadata.set(id, Object.freeze({ id, ownerSessionId: owner, declaredSessionId: declaredId, versionFingerprint, forkParentId: parentId, origin: input.origin, sourceRef: input.sourceRef }));
    this.#observe(input, batch, "metadata");
  }
  #selectedStream(payload: unknown, input: Input, batch: WorkBatch): string | null {
    const raw = text(field(payload, "thread_id"), 4096);
    const id = raw === null ? input.sourceState.ownerId : codexStreamId(this.#context, raw);
    if (id === null) { this.#warn("UNATTRIBUTED_RECORD", input, batch); return null; }
    return this.#stream(id, input, batch) ? id : null;
  }
  #selectedTurn(payload: unknown, streamId: string, input: Input): string | null {
    const raw = text(field(payload, "turn_id"), 4096);
    return raw === null ? (streamId === input.sourceState.ownerId ? input.sourceState.activeTurnId : null) : codexTurnId(this.#context, streamId, raw);
  }
  #project(payload: unknown, streamId: string): string | null {
    const cwd = text(field(payload, "cwd"));
    return cwd === null ? this.#streams.get(streamId)?.projectId ?? null : this.#context.fingerprint("file", ["codex_project", cwd]);
  }
  #baseEvent(rawId: string, streamId: string, turnId: string | null, input: Input, batch: WorkBatch, options: Record<string, unknown>): NormalizedEvent | null {
    const normalized = normalizeEvent({ ...options, provider: "codex", eventIdentity: rawId, sessionIdentity: streamId, sourceRef: { fileIdentity: input.source.fileIdentity, byteOffset: input.sourceRef.byteOffset, recordType: options.recordType ?? "response_item" } }, this.#context);
    for (const warning of normalized.diagnostics) this.#warn(warning.code, input, batch);
    return normalized.event === null ? null : Object.freeze({ ...normalized.event, sessionId: streamId, turnId });
  }
  #emitEvent(state: ExecutionState, input: Input, batch: WorkBatch): void {
    this.#events.set(state.event.id, state); batch.events.set(state.event.id, state.event);
    if (state.event.status === "failed" && state.event.errorFingerprint === null) this.#warn("INSUFFICIENT_ERROR_EVIDENCE", input, batch);
  }
  #eventMessage(payload: unknown, input: Input, batch: WorkBatch): void {
    const type = field(payload, "type");
    if (type === "item_completed" || type === "item_started") this.#structured(payload, input, batch, type === "item_completed");
    else if (type === "task_started" || type === "task_complete" || type === "turn_aborted") this.#turn(payload, input, batch, type);
    else if (type === "token_usage_record") this.#responseUsage(payload, input, batch);
    else if (type === "token_count") this.#tokenSnapshot(payload, input, batch);
    else this.#unsupportedRecord(input, batch);
  }

  #structured(payload: unknown, input: Input, batch: WorkBatch, completed: boolean): void {
    const item = field(payload, "item");
    const type = field(item, "type");
    if (type !== "CommandExecution" && type !== "McpToolCall") { this.#unsupportedRecord(input, batch); return; }
    const rawId = text(field(item, "id"), 4096);
    const streamId = this.#selectedStream(payload, input, batch);
    if (rawId === null || streamId === null) { this.#warn("INVALID_RECORD", input, batch); return; }
    const id = codexEventId(this.#context, streamId, rawId);
    const prior = this.#events.get(id);
    if (!prior && !this.#room(this.#events.size, this.#limits.events, input, batch)) return;
    const turnId = this.#selectedTurn(payload, streamId, input);
    if (!completed && prior?.structured && prior.event.status !== "pending") { this.#observe(input, batch, "structured", id, turnId, null, field(item, "status")); return; }
    const project = this.#project(item, streamId);
    const shell = type === "CommandExecution";
    this.#shapes.add(shell ? "command_item" : "mcp_item");
    const classified = shell ? command(field(item, "command"), this.#context, project) : null;
    const args = shell ? null : canonical(field(item, "arguments"));
    const server = text(field(item, "server"), 4096);
    const tool = text(field(item, "tool"), 4096);
    const operationParts = !shell && server && tool && args !== null ? ["mcp", server, tool, args] : undefined;
    const rawDuration = field(item, "duration");
    let durationMs = completed ? rustDuration(rawDuration) : null;
    if (completed && rawDuration !== undefined && durationMs === null) this.#warn("INVALID_TIMING", input, batch);
    if (shell && field(item, "source") !== "unified_exec_startup" && !(typeof field(item, "command") === "string" && field(item, "source") === undefined)) {
      if (durationMs !== null) this.#warn("TIMING_SCOPE_UNKNOWN", input, batch);
      durationMs = null;
    }
    const result = shell ? readOutput({ output: field(item, "output") }, streamId, this.#context, "other", input.completeOutput) : readOutput(field(item, "result"), streamId, this.#context, "mcp", input.completeOutput);
    if (!shell && durationMs === 0 && !object(field(item, "result"))) {
      durationMs = null; this.#warn("TIMING_SCOPE_UNKNOWN", input, batch);
    }
    const rawStatus = field(item, "status");
    const code = shell && completed ? exitCode(field(item, "exit_code")) : null;
    if (shell && completed && field(item, "exit_code") !== undefined && code === null) this.#warn("INVALID_RECORD", input, batch);
    const outcome = semanticExit(code, classified?.exitCodePolicy ?? "unknown");
    let status: NormalizedEvent["status"] = completed ? shell ? outcome.status : result.isError === true ? "failed" : result.isError === false ? "completed" : rawStatus === "completed" ? "completed" : "unknown" : "pending";
    let executionOutcome: NormalizedEvent["executionOutcome"] = !completed ? "unknown" : shell ? outcome.outcome : result.isError === true ? "error" : result.isError === false ? "success" : "unknown";
    if (completed && rawStatus === "cancelled") { status = "cancelled"; executionOutcome = "unknown"; }
    else if (completed && rawStatus !== "completed" && rawStatus !== "failed") {
      status = "unknown"; executionOutcome = "unknown"; this.#warn("UNSUPPORTED_RECORD", input, batch);
    }
    const contradictory = shell ? (rawStatus === "completed" && code !== null && code !== 0) || (rawStatus === "failed" && code === 0)
      : (rawStatus === "completed" && result.isError === true) || (rawStatus === "failed" && result.isError === false);
    if (completed && contradictory) { status = "unknown"; executionOutcome = "unknown"; this.#warn("STATUS_CONFLICT", input, batch); }
    const startAt = utc(field(payload, "started_at_ms"));
    const endAt = completed ? utc(field(payload, "completed_at_ms")) : null;
    const commandInput = classified?.transport === "shell_lc" ? (field(item, "command") as string[])[2] : field(item, "command");
    let event = this.#baseEvent(rawId, streamId, turnId, input, batch, {
      kind: shell ? "shell" : "mcp", toolName: shell ? "exec_command" : "mcp", command: shell ? commandInput : undefined,
      projectIdentity: project, operationParts,
      startAt: field(payload, "started_at_ms"), endAt: completed ? field(payload, "completed_at_ms") : null,
      intervalTimingEvidence: completed && startAt && endAt ? "source_reported" : "unknown", intervalScope: "item_lifecycle",
      durationMs, timingEvidence: durationMs === null ? "unknown" : "source_reported", durationScope: shell ? "process_runtime" : "invocation_latency",
      status: completed ? "unknown" : "pending", statusEvidence: "explicit", recordType: "event_msg",
    });
    if (event === null) return;
    const errorFingerprint = status === "failed" ? shell && code !== null && result.contentFingerprint !== null
      ? this.#context.fingerprint("error", ["process_exit", code, result.contentFingerprint]) : result.errorFingerprint : null;
    event = Object.freeze({ ...event, id, commandPattern: classified?.commandPattern ?? null,
      operationKey: classified !== null ? classified.operationKey : event.operationKey ?? prior?.event.operationKey ?? null,
      category: classified?.category ?? event.category, status, executionOutcome, exitCode: code,
      contentFingerprint: result.contentFingerprint, contentState: result.contentState,
      errorFingerprint, errorClass: status === "failed" ? shell ? "process_exit" : "tool_error" : null,
    });
    // parsed_cmd describes a path/query, but has no verified read range/options/content.
    if (shell) {
      const parsed = field(item, "parsed_cmd");
      if (Array.isArray(parsed) && parsed.length === 1) {
        const lookupType = field(parsed[0], "type");
        const path = text(field(parsed[0], "path"));
        if ((lookupType === "read" || lookupType === "search") && path && project) {
          event = Object.freeze({ ...event, fileFingerprint: this.#context.fingerprint("file", ["codex", project, path]), contentFingerprint: null, contentState: "unknown" });
          this.#warn("INSUFFICIENT_LOOKUP_EVIDENCE", input, batch);
        }
      }
    }
    const digest = this.#context.fingerprint("event", ["codex_structured", canonical({ ...event, operationKey: classified?.operationKey ?? (operationParts && project ? this.#context.fingerprint("operation", ["codex", project, "mcp", operationParts]) : null), sourceRef: null }), this.#context.fingerprint("content", [canonical(shell ? field(item, "output") : field(item, "result"))])]);
    if (prior?.structured && prior.structuredDigest !== digest) {
      // A started item may be completed later. Two conflicting completions are not chosen.
      if (prior.event.status !== "pending") {
        this.#warn("INCONSISTENT_REPLAY", input, batch);
        const conflict: ExecutionState = { ...prior, conflicted: true, event: this.#conflictedEvent(prior.event) };
        this.#emitEvent(conflict, input, batch); this.#observe(input, batch, "structured", id, turnId, null, rawStatus); return;
      }
    }
    const state: ExecutionState = { event, policy: classified?.exitCodePolicy ?? prior?.policy ?? "unknown", mode: shell ? "exec" : "mcp", callSeen: prior?.callSeen ?? false, callOperationKey: prior?.callOperationKey ?? null, structured: true, conflicted: prior?.structured === true && prior.conflicted, result: prior?.result ?? null, structuredDigest: digest };
    if (state.conflicted) state.event = this.#conflictedEvent(event);
    this.#emitEvent(state, input, batch);
    if (shell) this.#linkProcess(processKey(field(item, "process_id"), streamId, this.#context), id, input, batch);
    const orphan = this.#pendingResults.get(id);
    if (orphan) { this.#pendingResults.delete(id); this.#applyResult(id, orphan, input, batch); }
    this.#observe(input, batch, "structured", id, turnId, null, rawStatus);
  }
  #conflictedEvent(event: NormalizedEvent): NormalizedEvent {
    return Object.freeze({ ...event, status: "unknown", executionOutcome: "unknown", exitCode: null, errorFingerprint: null, errorClass: null, durationMs: null, timingEvidence: "unknown", durationScope: "unknown", intervalScope: "unknown", intervalTimingEvidence: "unknown" });
  }
  #linkProcess(process: string | null, eventId: string, input: Input, batch: WorkBatch): void {
    if (process === null) return;
    const existing = this.#processes.get(process);
    if (this.#processes.has(process) && existing !== eventId) { this.#processes.set(process, null); this.#warn("UNSUPPORTED_RELATION", input, batch); return; }
    if (!this.#processes.has(process) && !this.#room(this.#processes.size, this.#limits.links, input, batch)) return;
    this.#processes.set(process, eventId);
    for (const [pollId, pollProcess] of this.#polls) {
      const waiting = this.#pendingResults.get(pollId);
      if (pollProcess === process && waiting) { this.#pendingResults.delete(pollId); this.#applyPoll(pollId, waiting, input, batch); }
    }
  }
  #response(payload: unknown, input: Input, batch: WorkBatch): void {
    const type = field(payload, "type");
    if (type === "function_call" || type === "custom_tool_call") this.#call(payload, input, batch, type === "custom_tool_call");
    else if (type === "function_call_output" || type === "custom_tool_call_output") this.#result(payload, input, batch);
    else this.#unsupportedRecord(input, batch);
  }
  #wrapper(id: string, streamId: string, rawId: string, input: Input, batch: WorkBatch, resultSeen: boolean): void {
    const prior = this.#wrappers.get(id);
    if (!prior && !this.#room(this.#wrappers.size, this.#limits.events, input, batch)) return;
    const relation = input.source.trustedFixtureContext?.wrapperRelations?.find((entry) => entry.wrapperCallId === rawId);
    let children: readonly string[] = prior?.childEventIds ?? [];
    let relationship: WrapperRepresentation["relationship"] = prior?.relationship ?? "unknown";
    if (relation) {
      const remaining = this.#limits.links - this.#wrapperChildLinks + (prior?.childEventIds.length ?? 0);
      if (relation.childItemIds.length > remaining) {
        this.#limited = true; this.#warn("STATE_LIMIT", input, batch); children = []; relationship = "unknown";
      } else if (relation.childItemIds.some((child) => text(child, 4096) === null)) {
        this.#warn("UNSUPPORTED_RELATION", input, batch); children = []; relationship = "unknown";
      } else {
        children = [...new Set(relation.childItemIds.map((child) => codexEventId(this.#context, streamId, child)))];
        relationship = "trusted_fixture";
      }
      this.#wrapperChildLinks += children.length - (prior?.childEventIds.length ?? 0);
    }
    this.#wrappers.set(id, Object.freeze({ id, sessionId: streamId, kind: "code_wrapper", callSeen: prior?.callSeen === true || !resultSeen, resultSeen: prior?.resultSeen === true || resultSeen, relationship, childEventIds: Object.freeze(children), sourceRef: input.sourceRef }));
    this.#shapes.add("code_wrapper");
    if (!relation && prior?.relationship !== "trusted_fixture") this.#warn("UNSUPPORTED_RELATION", input, batch);
    this.#observe(input, batch, "wrapper", id);
  }
  #call(payload: unknown, input: Input, batch: WorkBatch, custom: boolean): void {
    const rawId = text(field(payload, "call_id"), 4096);
    const streamId = this.#selectedStream(payload, input, batch);
    if (rawId === null || streamId === null) { this.#warn("INVALID_RECORD", input, batch); return; }
    this.#shapes.add(custom ? "custom_call" : "function_call");
    const id = codexEventId(this.#context, streamId, rawId);
    const kind = toolKind(field(payload, "name"), field(payload, "namespace"));
    if (kind === "wrapper") {
      this.#wrapper(id, streamId, rawId, input, batch, false);
      if (this.#pendingResults.delete(id)) this.#wrapper(id, streamId, rawId, input, batch, true);
      return;
    }
    const args = argumentsObject(payload);
    if (kind === "poll") {
      const process = processKey(field(args, "session_id"), streamId, this.#context);
      if (process === null || field(args, "chars") !== "") { this.#rememberUnsupportedCall(id, input, batch); this.#warn("UNSUPPORTED_RELATION", input, batch); this.#observe(input, batch, "poll", id); return; }
      if (!this.#polls.has(id) && !this.#room(this.#polls.size, this.#limits.links, input, batch)) return;
      this.#polls.set(id, process); this.#shapes.add("poll"); this.#observe(input, batch, "poll", this.#processes.get(process) ?? null);
      const orphan = this.#pendingResults.get(id);
      if (orphan) { this.#pendingResults.delete(id); this.#applyPoll(id, orphan, input, batch); }
      return;
    }
    if (kind === "unknown" || (custom && kind !== "patch") || (kind === "exec" && args === null)) { this.#rememberUnsupportedCall(id, input, batch); this.#unsupportedRecord(input, batch, id); return; }
    const prior = this.#events.get(id);
    if (!prior && !this.#room(this.#events.size, this.#limits.events, input, batch)) return;
    const turnId = this.#selectedTurn(payload, streamId, input);
    const workdir = kind === "exec" ? text(field(args, "workdir")) : null;
    const project = workdir === null ? this.#streams.get(streamId)?.projectId ?? null : this.#context.fingerprint("file", ["codex_project", workdir]);
    const rawCommand = kind === "exec" ? field(args, "cmd") : undefined;
    const shellParameter = field(args, "shell");
    const loginParameter = field(args, "login");
    const validContext = (shellParameter === undefined || supportedShell(shellParameter)) && (loginParameter === undefined || typeof loginParameter === "boolean");
    const classified = kind === "exec" ? command(validContext ? rawCommand : undefined, this.#context, project) : null;
    if (kind === "exec" && !validContext) this.#warn("UNSUPPORTED_COMMAND", input, batch);
    const rawArguments = custom ? text(field(payload, "input")) : args === null ? null : canonical(args);
    const name = text(field(payload, "name"), 4096);
    const namespace = text(field(payload, "namespace"), 4096);
    const operationParts = name && rawArguments !== null ? [namespace ?? "", name, rawArguments] : undefined;
    const commandInput = classified?.transport === "shell_lc" ? (rawCommand as string[])[2] : rawCommand;
    let event = this.#baseEvent(rawId, streamId, turnId, input, batch, { kind: kind === "mcp" ? "mcp" : kind === "patch" ? "file_edit" : "shell", toolName: kind === "mcp" ? "mcp" : kind === "patch" ? "apply_patch" : "exec_command", command: commandInput, operationParts, projectIdentity: project, startAt: input.at, status: "pending", statusEvidence: "explicit" });
    if (event === null) return;
    const operationKey = classified?.operationKey === null ? null : classified ? shellParameter !== undefined || loginParameter !== undefined ? this.#context.fingerprint("operation", ["codex_exec_call", classified.operationKey, text(shellParameter), typeof loginParameter === "boolean" ? loginParameter : null]) : classified.operationKey : event.operationKey;
    event = Object.freeze({ ...event, id, commandPattern: classified?.commandPattern ?? null, operationKey, category: classified?.category ?? event.category });
    const mode = kind === "exec" ? "exec" : kind === "mcp" ? "mcp" : "patch";
    if (prior?.callSeen && prior.callOperationKey !== event.operationKey) {
      this.#warn("INCONSISTENT_REPLAY", input, batch);
      if (!prior.structured) { prior.conflicted = true; prior.event = this.#conflictedEvent(prior.event); }
      this.#emitEvent(prior, input, batch);
    } else if (prior?.structured) {
      prior.callSeen = true;
      prior.callOperationKey = event.operationKey;
      if (prior.event.operationKey === null && event.operationKey !== null) prior.event = Object.freeze({ ...prior.event, operationKey: event.operationKey });
      this.#emitEvent(prior, input, batch);
    } else if (!prior?.callSeen) {
      const state: ExecutionState = { event, policy: classified?.exitCodePolicy ?? "unknown", mode, callSeen: true, callOperationKey: event.operationKey, structured: false, conflicted: false, result: null, structuredDigest: null };
      this.#emitEvent(state, input, batch);
      const orphan = this.#pendingResults.get(id);
      if (orphan) { this.#pendingResults.delete(id); this.#applyResult(id, orphan, input, batch); }
    }
    this.#observe(input, batch, "call", id, turnId);
  }
  #safeResult(payload: unknown, streamId: string, input: Input): SafeResult {
    const output = field(payload, "output");
    const exec = readOutput(output, streamId, this.#context, "exec", input.completeOutput);
    const mcp = readOutput(jsonObject(output) ?? output, streamId, this.#context, "mcp", input.completeOutput);
    const other = readOutput(output, streamId, this.#context, "other", input.completeOutput);
    // Opaque payload digest detects replay conflicts even when completeness is unknown.
    const encoded = canonical(output);
    if (encoded === null && output !== null) throw new SafeError("INVALID_RECORD");
    const outputDigest = this.#context.fingerprint("content", [encoded]);
    const digest = this.#context.fingerprint("event", ["codex_result", outputDigest, canonical({ exec, mcp, other })]);
    return Object.freeze({ exec, mcp, other, at: input.at, sourceRef: input.sourceRef, digest, conflicted: false });
  }
  #result(payload: unknown, input: Input, batch: WorkBatch): void {
    const rawId = text(field(payload, "call_id"), 4096);
    const streamId = this.#selectedStream(payload, input, batch);
    if (rawId === null || streamId === null) { this.#warn("INVALID_RECORD", input, batch); return; }
    this.#shapes.add("tool_result");
    const id = codexEventId(this.#context, streamId, rawId);
    if (this.#wrappers.has(id)) { this.#wrapper(id, streamId, rawId, input, batch, true); return; }
    if (this.#unsupportedCalls.has(id)) { this.#warn("UNSUPPORTED_RELATION", input, batch); this.#unsupportedRecord(input, batch, id); return; }
    const result = this.#safeResult(payload, streamId, input);
    const replay = this.#context.fingerprint("event", ["codex_result_replay", id, result.digest]);
    if (this.#resultReplays.has(replay)) { this.#observe(input, batch, "result", id); return; }
    if (!this.#room(this.#resultReplays.size, this.#limits.observations, input, batch)) return;
    this.#resultReplays.add(replay);
    if (this.#polls.has(id)) this.#applyPoll(id, result, input, batch);
    else if (this.#events.has(id)) this.#applyResult(id, result, input, batch);
    else {
      this.#warn("REORDERED_RECORD", input, batch);
      const prior = this.#pendingResults.get(id);
      if (prior && prior.digest !== result.digest) { this.#warn("INCONSISTENT_REPLAY", input, batch); this.#pendingResults.set(id, Object.freeze({ ...prior, conflicted: true })); }
      else if (!prior && this.#room(this.#pendingResults.size, this.#limits.events, input, batch)) this.#pendingResults.set(id, result);
    }
    this.#observe(input, batch, "result", id);
  }
  #applyPoll(id: string, result: SafeResult, input: Input, batch: WorkBatch): void {
    const process = this.#polls.get(id);
    const eventId = process === undefined ? undefined : this.#processes.get(process);
    if (eventId === undefined) {
      this.#warn("UNSUPPORTED_RELATION", input, batch);
      const prior = this.#pendingResults.get(id);
      if (prior && prior.digest !== result.digest) this.#pendingResults.set(id, Object.freeze({ ...prior, conflicted: true }));
      else if (!prior && this.#room(this.#pendingResults.size, this.#limits.events, input, batch)) this.#pendingResults.set(id, result);
      return;
    }
    if (eventId === null || (result.exec.processKey !== null && result.exec.processKey !== process)) { this.#warn("UNSUPPORTED_RELATION", input, batch); return; }
    this.#applyResult(eventId, result, input, batch);
    this.#observe(input, batch, "poll", eventId);
  }
  #applyResult(id: string, result: SafeResult, input: Input, batch: WorkBatch): void {
    const state = this.#events.get(id);
    if (!state) { this.#warn("UNSUPPORTED_RELATION", input, batch); return; }
    const output = state.mode === "exec" ? result.exec : state.mode === "mcp" ? result.mcp : result.other;
    if (output.invalidMetadata) this.#warn("INVALID_RECORD", input, batch);
    if (state.structured) {
      if ((output.exitCode !== null && state.event.exitCode !== null && output.exitCode !== state.event.exitCode) || (output.isError !== null && (output.isError && state.event.status === "completed" || !output.isError && state.event.status === "failed"))) this.#warn("STATUS_CONFLICT", input, batch);
      return;
    }
    if (result.conflicted) state.conflicted = true;
    if (state.result?.digest === result.digest) return;
    if ((state.result && !state.result.exec.running && state.mode === "exec") || (state.result && state.mode !== "exec")) {
      this.#warn("INCONSISTENT_REPLAY", input, batch); state.conflicted = true; state.event = this.#conflictedEvent(state.event); this.#emitEvent(state, input, batch); return;
    }
    state.result = result;
    if (state.conflicted) { state.event = this.#conflictedEvent(state.event); this.#emitEvent(state, input, batch); return; }
    const semantic = semanticExit(output.exitCode, state.policy);
    const status = state.mode === "exec" ? output.cancelled ? "cancelled" : output.running ? "pending" : output.metadataVerified ? semantic.status : "unknown"
      : state.mode === "mcp" ? output.isError === true ? "failed" : output.isError === false ? "completed" : "unknown" : "unknown";
    const endAt = status === "pending" ? null : result.at;
    const durationMs = status === "pending" ? null : elapsed(state.event.startAt, endAt);
    if (state.event.startAt && endAt && durationMs === null) this.#warn("INVALID_TIMING", input, batch);
    const failedFingerprint = status !== "failed" ? null : state.mode === "exec" && output.exitCode !== null && output.contentFingerprint !== null ? this.#context.fingerprint("error", ["process_exit", output.exitCode, output.contentFingerprint]) : output.errorFingerprint;
    state.event = Object.freeze({ ...state.event, endAt, durationMs, timingEvidence: durationMs === null ? "unknown" : "paired_timestamps", durationScope: durationMs === null ? "unknown" : "invocation_latency", intervalTimingEvidence: durationMs === null ? "unknown" : "paired_timestamps", intervalScope: durationMs === null ? "unknown" : "invocation_latency", status,
      executionOutcome: state.mode === "exec" ? status === "pending" || status === "cancelled" ? "unknown" : semantic.outcome : output.isError === true ? "error" : output.isError === false ? "success" : "unknown",
      exitCode: output.exitCode, contentFingerprint: output.contentFingerprint, contentState: output.contentState,
      errorFingerprint: failedFingerprint, errorClass: status === "failed" ? state.mode === "exec" ? "process_exit" : "tool_error" : null,
      sourceRef: Object.freeze({ ...result.sourceRef, recordType: "response_item" }),
    });
    this.#emitEvent(state, input, batch);
    // Apply the launch result before flushing a terminal poll that arrived earlier.
    if (state.mode === "exec") this.#linkProcess(output.processKey, id, input, batch);
  }

  #turnContext(payload: unknown, input: Input, batch: WorkBatch): void {
    const streamId = this.#selectedStream(payload, input, batch);
    const rawTurn = text(field(payload, "turn_id"), 4096);
    if (streamId === null || rawTurn === null) { this.#warn("INVALID_RECORD", input, batch); return; }
    if (streamId === input.sourceState.ownerId) input.sourceState.activeTurnId = codexTurnId(this.#context, streamId, rawTurn);
    const cwd = text(field(payload, "cwd"));
    const stream = this.#streams.get(streamId);
    if (cwd !== null && stream && stream.projectId === null) stream.projectId = this.#context.fingerprint("file", ["codex_project", cwd]);
    // Context is not a start boundary, model interval or usage attribution.
  }
  #turn(payload: unknown, input: Input, batch: WorkBatch, kind: "task_started" | "task_complete" | "turn_aborted"): void {
    const streamId = this.#selectedStream(payload, input, batch);
    const rawTurn = text(field(payload, "turn_id"), 4096);
    if (streamId === null || rawTurn === null) { this.#warn("INVALID_RECORD", input, batch); return; }
    const id = codexTurnId(this.#context, streamId, rawTurn);
    const prior = this.#turns.get(id);
    if (!prior && !this.#room(this.#turns.size, this.#limits.turns, input, batch)) return;
    this.#shapes.add("turn");
    if (streamId === input.sourceState.ownerId) input.sourceState.activeTurnId = id;
    const rawStart = field(payload, "started_at");
    const rawEnd = field(payload, "completed_at");
    let startAt = rawStart !== undefined ? epochSeconds(rawStart) : prior?.startAt ?? (kind === "task_started" ? input.at : null);
    let startTimingEvidence: NormalizedTurn["startTimingEvidence"] = rawStart !== undefined ? startAt === null ? "unknown" : "source_reported" : prior?.startTimingEvidence ?? (startAt === null ? "unknown" : "paired_timestamps");
    let endAt = kind === "task_started" ? prior?.endAt ?? null : rawEnd !== undefined ? epochSeconds(rawEnd) : input.at;
    let endTimingEvidence: NormalizedTurn["endTimingEvidence"] = kind === "task_started" ? prior?.endTimingEvidence ?? "unknown" : rawEnd !== undefined ? endAt === null ? "unknown" : "source_reported" : endAt === null ? "unknown" : "paired_timestamps";
    if ((rawStart !== undefined && startAt === null) || (rawEnd !== undefined && epochSeconds(rawEnd) === null)) this.#warn("INVALID_TIMING", input, batch);
    if (startAt && endAt && elapsed(startAt, endAt) === null) { this.#warn("INVALID_TIMING", input, batch); startAt = null; endAt = null; startTimingEvidence = "unknown"; endTimingEvidence = "unknown"; }
    let durationMs = kind === "task_started" ? prior?.durationMs ?? null : milliseconds(field(payload, "duration_ms"));
    if (kind !== "task_started" && field(payload, "duration_ms") !== undefined && durationMs === null) this.#warn("INVALID_TIMING", input, batch);
    let status: NormalizedTurn["status"] = kind === "task_started" ? prior?.status ?? "pending" : kind === "turn_aborted" ? "cancelled" : "completed";
    let conflict = false;
    if (prior && prior.status !== "pending" && kind !== "task_started") {
      conflict = prior.status !== status || (prior.durationMs !== null && durationMs !== null && prior.durationMs !== durationMs)
        || (prior.startTimingEvidence === "source_reported" && startTimingEvidence === "source_reported" && prior.startAt !== startAt)
        || (prior.endTimingEvidence === "source_reported" && endTimingEvidence === "source_reported" && prior.endAt !== endAt);
      if (conflict) { this.#warn("INCONSISTENT_REPLAY", input, batch); durationMs = null; startTimingEvidence = "unknown"; endTimingEvidence = "unknown"; status = "unknown"; }
    }
    const sameBoundaryEvidence = startTimingEvidence === endTimingEvidence && startTimingEvidence !== "unknown";
    const intervalKnown = !conflict && sameBoundaryEvidence && startAt !== null && endAt !== null;
    if (startAt !== null && endAt !== null && !sameBoundaryEvidence) this.#warn("TIMING_SCOPE_UNKNOWN", input, batch);
    const reportedInterval = intervalKnown && startTimingEvidence === "source_reported" && endTimingEvidence === "source_reported";
    // Monotonic elapsed duration is not equated with coarse UTC wall endpoints.
    const turn: NormalizedTurn = Object.freeze({ id, sessionId: streamId, provider: "codex", startAt, endAt, startTimingEvidence, endTimingEvidence,
      intervalTimingEvidence: intervalKnown ? reportedInterval ? "source_reported" : "paired_timestamps" : "unknown", intervalScope: intervalKnown ? reportedInterval ? "turn_wall" : "observed_turn" : "unknown",
      durationMs, timingEvidence: durationMs === null ? "unknown" : "source_reported", durationScope: durationMs === null ? "unknown" : "turn_elapsed", status, sourceRef: input.sourceRef });
    this.#turns.set(id, turn); batch.turns.set(id, turn); this.#observe(input, batch, "turn", null, id, null, status);
  }
  #responseUsage(payload: unknown, input: Input, batch: WorkBatch, native = false): void {
    const streamId = this.#selectedStream(payload, input, batch);
    if (streamId === null) return;
    const rawResponse = text(field(payload, "response_id"), 4096);
    const rawTurn = text(field(payload, "turn_id"), 4096);
    const responseId = rawResponse === null ? null : this.#context.fingerprint("event", ["codex", streamId, "response", rawResponse]);
    const turnId = rawTurn === null ? null : codexTurnId(this.#context, streamId, rawTurn);
    this.#shapes.add("response_usage");
    if (responseId === null) this.#warn("UNATTRIBUTED_RECORD", input, batch);
    const verifiedMapping = native && input.sourceState.nativeUsageVerified && streamId === input.sourceState.ownerId;
    this.#usageRecord(field(payload, "usage"), "response_usage", streamId, turnId, responseId, input, batch, verifiedMapping);
    if (field(payload, "turn_token_usage") !== undefined) this.#usageRecord(field(payload, "turn_token_usage"), "turn_snapshot", streamId, turnId, responseId, input, batch, verifiedMapping);
    if (field(payload, "thread_token_usage") !== undefined) this.#usageRecord(field(payload, "thread_token_usage"), "thread_snapshot", streamId, null, responseId, input, batch, verifiedMapping);
  }
  #tokenSnapshot(payload: unknown, input: Input, batch: WorkBatch): void {
    const streamId = this.#selectedStream(payload, input, batch);
    if (streamId === null) return;
    const info = field(payload, "info");
    if (!object(info)) { this.#warn("INVALID_USAGE", input, batch); return; }
    this.#shapes.add("token_snapshot");
    const verifiedMapping = input.sourceState.nativeUsageVerified && streamId === input.sourceState.ownerId;
    if (field(info, "total_token_usage") !== undefined) this.#usageRecord(field(info, "total_token_usage"), "token_count_total", streamId, null, null, input, batch, verifiedMapping);
    if (field(info, "last_token_usage") !== undefined) this.#usageRecord(field(info, "last_token_usage"), "token_count_last", streamId, null, null, input, batch, verifiedMapping);
  }
  #usageRecord(raw: unknown, source: UsageObservation["source"], streamId: string, turnId: string | null, responseId: string | null, input: Input, batch: WorkBatch, verifiedMapping = false): void {
    const response = source === "response_usage";
    const point = responseId ?? this.#context.fingerprint("source", ["codex_usage_point", streamId, input.at, input.at === null ? input.fileId : null, input.source.ordinal]);
    const id = this.#context.fingerprint("event", ["codex_usage", streamId, source, response ? null : turnId, point]);
    const prior = this.#usage.get(id);
    if (!prior && !this.#room(this.#usage.size, this.#limits.usage, input, batch)) return;
    const supplied = input.source.trustedFixtureContext?.usageEvidence?.find((entry) => entry.ordinal === input.source.ordinal);
    const trusted = supplied && integer(supplied.order) !== null && text(supplied.orderingGroup, 4096) !== null && supplied.mapping === "openai_responses" && (supplied.finality === "final" || supplied.finality === "partial") ? supplied : undefined;
    const mapping: UsageObservation["mapping"] = verifiedMapping || trusted ? "openai_responses" : "unknown";
    const checked = tokenCounts(raw, mapping);
    const counts = checked.counts;
    if (checked.status === "invalid") this.#warn("INVALID_USAGE", input, batch);
    const finality: UsageObservation["finality"] = !response ? "unknown" : verifiedMapping && input.origin === "ordinary" ? "source_terminal" : trusted?.finality === "final" ? "trusted_final" : trusted?.finality === "partial" ? "trusted_partial" : "unknown";
    const order: UsageOrder | null = trusted ? Object.freeze({ group: this.#context.fingerprint("source", ["codex_fixture_usage_order", trusted.orderingGroup]), order: trusted.order }) : null;
    const priorOrder = this.#usageOrder.get(id);
    const sameOrderGroup = order !== null && priorOrder !== undefined && order.group === priorOrder.group;
    const newer = sameOrderGroup && order.order > priorOrder.order;
    const older = sameOrderGroup && order.order < priorOrder.order;
    const final = finality === "source_terminal" || finality === "trusted_final";
    const priorFinal = prior?.finality === "source_terminal" || prior?.finality === "trusted_final";
    const changed = prior !== undefined && !sameCounts(prior.counts, counts);
    const acceptedUpdate = !priorFinal && newer && prior?.finality === "trusted_partial" && (finality === "trusted_partial" || finality === "trusted_final");
    const olderPartialReplay = finality === "trusted_partial" && older;
    const preserveFinal = priorFinal && !final && (!changed || olderPartialReplay);
    const preserve = preserveFinal || olderPartialReplay;
    if (olderPartialReplay) this.#warn("REORDERED_RECORD", input, batch);
    const conflict = prior?.selection === "conflicted" || (!preserve && changed && !acceptedUpdate) || (prior !== undefined && response && prior.turnId !== turnId);
    if (conflict) this.#warn(response ? "USAGE_CONFLICT" : "INCONSISTENT_REPLAY", input, batch);
    const scope = response ? "response_increment" : source === "turn_snapshot" ? "turn_cumulative" : source === "thread_snapshot" || source === "token_count_total" ? "thread_cumulative" : "unverified_snapshot";
    const limitations: UsageObservation["limitations"][number][] = [];
    if (!final && response) limitations.push("unknown_finality");
    if (input.origin === "ambiguous") limitations.push("ambiguous_origin");
    if (checked.status === "partial") limitations.push("partial_counts");
    if (checked.status === "invalid") limitations.push("invalid_counts");
    const essentialMissing = counts === null || counts.input === null || counts.output === null;
    if (essentialMissing && checked.status !== "invalid") this.#warn("INSUFFICIENT_USAGE", input, batch);
    if (response && responseId === null) limitations.push("missing_response_id");
    if (conflict) limitations.push("conflict");
    if (!response) limitations.push("snapshot_only");
    if (verifiedMapping && counts && Object.values(counts).some((value) => value === 0)) limitations.push("zero_or_source_default");
    const usage: UsageObservation = Object.freeze({ id, sessionId: streamId, turnId, responseId, provider: "codex", source, counts: conflict ? null : counts,
      scope, selection: conflict ? "conflicted" : checked.status === "invalid" || (response && responseId === null) ? "invalid" : !response ? "snapshot_only" : final && !essentialMissing && input.origin !== "ambiguous" ? "eligible" : "provisional",
      finality, countStatus: checked.status, mapping, limitations: Object.freeze(limitations), toolEventId: null, phase: "unknown", sourceRef: input.sourceRef });
    if ((!preserve || conflict) && (!prior || !sameCounts(prior.counts, usage.counts) || prior.selection !== usage.selection || prior.finality !== usage.finality || acceptedUpdate)) { this.#usage.set(id, usage); batch.usage.set(id, usage); if (order !== null) this.#usageOrder.set(id, order); }
    if (!response && source !== "token_count_last" && counts !== null && checked.status !== "invalid" && !conflict && !prior && verifiedMapping) {
      const key = this.#context.fingerprint("event", ["codex_snapshot_series", streamId, source, turnId]);
      const previous = this.#lastSnapshots.get(key);
      if (previous?.at !== null && previous?.at !== undefined && input.at !== null && Date.parse(input.at) < Date.parse(previous.at)) this.#warn("REORDERED_RECORD", input, batch);
      else {
        if (previous && input.at !== null && previous.at !== null && decreased(previous.counts, counts)) this.#warn("USAGE_RESET", input, batch);
        if (previous || this.#room(this.#lastSnapshots.size, this.#limits.usage, input, batch)) this.#lastSnapshots.set(key, Object.freeze({ counts, at: input.at }));
      }
    }
    this.#observe(input, batch, "usage", null, turnId, id, null, Object.freeze({ counts, finality, countStatus: checked.status, mapping }));
  }
}

export function createCodexAdapter(context: IdentityContext, limits: Partial<CodexLimits> = {}): CodexAdapter { return new CodexAdapter(context, limits); }
