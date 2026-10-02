import { createHash, timingSafeEqual } from "node:crypto";
import { types } from "node:util";
import type { IdentityContext } from "../../normalize/identity.js";
import type { DurationScope, NormalizedEvent } from "../../normalize/types.js";
import { diagnostic, MESSAGES } from "../../privacy/diagnostics.js";
import type { SafeDiagnostic } from "../../privacy/diagnostics.js";
import type { ParserSourceRef } from "../types.js";
import type { ClaudeCheckpointBinding, ClaudeCheckpointExport, ClaudeLimits, ClaudeMessageLink, ClaudeMetadata, ClaudeShape, ClaudeSourceObservation, ClaudeTurn, ClaudeUsage } from "./types.js";

export const MAX_CLAUDE_CHECKPOINT_BYTES = 4 * 1024 * 1024;
const MAX_ROW_BYTES = 64 * 1024, MAX_DEPTH = 16, MAX_NODES = 4 * 1024 * 1024;
const SCHEMA = "agentprof.claude-checkpoint/v1";
export type Position = Readonly<{ fileId: string; ordinal: number; sourceRef: ParserSourceRef; sourceAlias: string | null }>;
export type SourceState = { ownerRootSessionId: string | null; ambiguous: boolean };
export type StreamState = Readonly<{ rootSessionId: string; agentId: string | null; isSidechain: boolean; projectId: string | null }>;
export type SafeResult = Readonly<{
  digest: string; at: string | null; position: Position; isError: boolean | null;
  backgroundTaskId: string | null; asyncLaunched: boolean; unassignedAcknowledgement: boolean; contentFingerprint: string | null;
  contentState: "complete" | "truncated" | "unknown"; errorFingerprint: string | null;
  directDurationMs: number | null; directDurationScope: DurationScope; conflicted: boolean;
}>;
export type ExecutionState = {
  event: NormalizedEvent; callDigest: string; inputDigest: string; callProjectId: string | null; position: Position; callMessageId: string | null;
  callKind: "bash" | "agent" | "tool"; backgroundRequested: boolean; result: SafeResult | null; conflicted: boolean;
};
export type UsageOrder = Readonly<{ fileId: string; ordinal: number; group: string | null; order: number | null }>;
export type MessageState = Readonly<{ link: ClaudeMessageLink; digest: string }>;
export type CheckpointPosition = Readonly<{ firstOrdinal: number | null; lastOrdinal: number | null; lastByteOffset: number | null; recordCount: number }>;
type Maps = {
  sources: SourceState; streams: StreamState; events: ExecutionState; turns: ClaudeTurn; usage: ClaudeUsage;
  usageOrders: UsageOrder; messages: MessageState; deferredResults: SafeResult; observations: ClaudeSourceObservation;
  metadata: ClaudeMetadata; diagnostics: SafeDiagnostic;
};
type Sets = { uuidReplays: string; resultReplays: string; usageProofReplays: string; shapes: ClaudeShape };
type Counters = { messageEdges: number; partial: boolean; limited: boolean; unsupported: number; ambiguous: number; diagnosticsDropped: number };
export type CheckpointState = { [K in keyof Maps]: ReadonlyMap<string, Maps[K]> } & { [K in keyof Sets]: ReadonlySet<Sets[K]> } & Counters;
export type DecodedCheckpoint = { position: CheckpointPosition; state: { [K in keyof Maps]: [string, Maps[K]][] } & { [K in keyof Sets]: Sets[K][] } & Counters };
const MAP_KEYS = ["sources", "streams", "events", "turns", "usage", "usageOrders", "messages", "deferredResults", "observations", "metadata", "diagnostics"] as const;
const SET_KEYS = ["uuidReplays", "resultReplays", "usageProofReplays", "shapes"] as const;
const COUNTER_KEYS = ["messageEdges", "partial", "limited", "unsupported", "ambiguous", "diagnosticsDropped"] as const;
const LIMIT_KEYS = ["sources", "streams", "events", "turns", "usage", "messageLinks", "deferredResults", "resultReplays", "usageOrders", "usageProofReplays", "observations", "metadata", "diagnostics"] as const;
class InvalidCheckpoint extends Error {}
class CheckpointBudget extends Error {}
function invalid(): never { throw new InvalidCheckpoint(); }
function budget(): never { throw new CheckpointBudget(); }
type Obj = Record<string, unknown>;
type Validator = (value: unknown) => void;
function fields(value: unknown, names: readonly string[]): Obj {
  if (value === null || typeof value !== "object" || types.isProxy(value) || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const d = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(d).length !== names.length) invalid();
  const result: Obj = Object.create(null);
  for (const name of names) {
    const entry = d[name];
    if (!entry || !("value" in entry)) invalid();
    result[name] = entry.value;
  }
  return result;
}
function integer(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) invalid(); return value; }
function bool(value: unknown): void { if (typeof value !== "boolean") invalid(); }
function nil(value: unknown): void { if (value !== null) invalid(); }
function fixed(expected: unknown): Validator { return value => { if (value !== expected) invalid(); }; }
function choice(...values: readonly unknown[]): Validator { return value => { if (!values.includes(value)) invalid(); }; }
function nullable(check: Validator): Validator { return value => { if (value !== null) check(value); }; }
function duration(value: unknown): void { if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER || Object.is(value, -0)) invalid(); }
function timestamp(value: unknown): void {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) invalid();
}
function shape(value: unknown, schema: Record<string, Validator>): Obj {
  const object = fields(value, Object.keys(schema));
  for (const [name, validate] of Object.entries(schema)) validate(object[name]);
  return object;
}
function array(value: unknown, maximum: number): unknown[] { if (!Array.isArray(value) || value.length > maximum) invalid(); return value; }
function words(...options: string[]): Validator { return value => { const list = array(value, options.length); if (new Set(list).size !== list.length) invalid(); for (const item of list) choice(...options)(item); }; }
function identity(keyId: string, domain: string): Validator {
  const prefix = `h1:${keyId}:${domain}:`;
  return value => { if (typeof value !== "string" || value.length !== prefix.length + 64 || !value.startsWith(prefix) || !/^[a-f0-9]{64}$/.test(value.slice(prefix.length))) invalid(); };
}
export function checkpointBinding(value: unknown, context: IdentityContext): ClaudeCheckpointBinding {
  const v = fields(value, ["sourceId", "completedOffset", "nextOrdinal"]);
  identity(context.keyId, "source")(v.sourceId);
  return { sourceId: v.sourceId as string, completedOffset: integer(v.completedOffset), nextOrdinal: integer(v.nextOrdinal) };
}
export function checkpointBudget(value: unknown): number {
  if (value === undefined) return MAX_CLAUDE_CHECKPOINT_BYTES;
  if (value === null || typeof value !== "object" || types.isProxy(value)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length === 0 && Object.getPrototypeOf(value) === Object.prototype) return MAX_CLAUDE_CHECKPOINT_BYTES;
  const v = fields(value, ["maxBytes"]);
  const size = integer(v.maxBytes);
  if (size < 1 || size > MAX_CLAUDE_CHECKPOINT_BYTES) invalid();
  return size;
}
function depthPreflight(text: string): void {
  let depth = 0, quoted = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; }
    else if (c === '"') quoted = true;
    else if (c === "{" || c === "[") { if (++depth > MAX_DEPTH) invalid(); }
    else if (c === "}" || c === "]") { if (--depth < 0) invalid(); }
  }
  if (quoted || escaped || depth !== 0) invalid();
}
function parse(text: unknown): unknown {
  if (typeof text !== "string" || text.length > MAX_CLAUDE_CHECKPOINT_BYTES || Buffer.byteLength(text) > MAX_CLAUDE_CHECKPOINT_BYTES) invalid();
  depthPreflight(text);
  const value: unknown = JSON.parse(text);
  const stack: unknown[] = [value]; let nodes = 0;
  while (stack.length) {
    const v = stack.pop();
    if (++nodes > MAX_NODES) invalid();
    if (v !== null && typeof v === "object") {
      if (Array.isArray(v)) for (const child of v) stack.push(child);
      else for (const [key, child] of Object.entries(v)) { if (++nodes > MAX_NODES || key === "__proto__" || key === "constructor" || key === "prototype") invalid(); stack.push(child); }
    } else if (typeof v === "number" && (!Number.isFinite(v) || Object.is(v, -0))) invalid();
  }
  // Canonical-only opaque tokens: duplicates, whitespace and alternate numeric spellings reject.
  if (JSON.stringify(value) !== text) invalid();
  return value;
}
function tag(context: IdentityContext, payload: string): string {
  return context.fingerprint("source", [SCHEMA, createHash("sha256").update(payload, "utf8").digest("hex")]);
}
/** Serialize data descriptors only; never call a retained value's conversion hooks. */
function rowJson(value: unknown): string {
  const chunks: string[] = []; let bytes = 0, nodes = 0;
  const append = (text: string) => { const size = Buffer.byteLength(text); if (size > MAX_ROW_BYTES - bytes) budget(); bytes += size; chunks.push(text); };
  const write = (v: unknown, depth: number): void => {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) invalid();
    if (v === null || typeof v === "boolean") { append(JSON.stringify(v)); return; }
    if (typeof v === "number") { if (!Number.isFinite(v) || Object.is(v, -0)) invalid(); append(JSON.stringify(v)); return; }
    if (typeof v === "string") { if (v.length > MAX_ROW_BYTES || Buffer.byteLength(v) > MAX_ROW_BYTES) budget(); append(JSON.stringify(v)); return; }
    if (typeof v !== "object" || types.isProxy(v)) invalid();
    const prototype = Object.getPrototypeOf(v), isArray = Array.isArray(v);
    if (isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) invalid();
    const descriptors = Object.getOwnPropertyDescriptors(v), names = Reflect.ownKeys(descriptors);
    if (names.some(name => typeof name !== "string")) invalid();
    if (isArray) {
      const length = descriptors.length; if (!length || !("value" in length)) invalid();
      const count = integer(length.value); if (names.length !== count + 1 || count > MAX_ROW_BYTES) invalid();
      append("[");
      for (let i = 0; i < count; i++) { const d = descriptors[String(i)]; if (!d || !("value" in d)) invalid(); if (i) append(","); write(d.value, depth + 1); }
      append("]");
    } else {
      append("{"); let first = true;
      for (const name of names as string[]) {
        const d = descriptors[name]!; if (!("value" in d) || !d.enumerable || ["__proto__", "constructor", "prototype"].includes(name)) invalid();
        if (!first) append(","); first = false; append(JSON.stringify(name)); append(":"); write(d.value, depth + 1);
      }
      append("}");
    }
  };
  write(value, 1); return chunks.join("");
}
const PROGRAMS = new Set(["npm", "npx", "rg", "git", "node", "python", "python3", "pytest", "cargo", "go", "xcodebuild", "cat", "sed", "ls", "find", "head", "tail", "other"]);
const SUBCOMMANDS = new Set(["test", "run", "ci", "install", "build", "check", "fmt", "lint", "status", "diff", "show", "log", "rev-parse"]);
const FLAGS = new Set(["--runInBand", "--watch", "--glob", "--type", "--fixed-strings", "--ignore-case", "--files", "--no-ignore", "--hidden", "--json", "--verbose", "--quiet", "--all", "--workspace", "--filter", "--no-cache", "--nocapture", "--only-testing", "--scheme", "--configuration", "--testPathPattern", "--exit-code", "-n", "-l", "-i", "-F", "-g", "-e", "-x", "-q"]);
function command(value: unknown): void {
  if (value === null || value === "shell <complex>") return;
  if (typeof value !== "string" || Buffer.byteLength(value) > MAX_ROW_BYTES) invalid();
  const tokens = value.split(" "); if (!PROGRAMS.has(tokens[0]!)) invalid();
  let i = 1; if (["npm", "npx", "git", "cargo", "go"].includes(tokens[0]!) && SUBCOMMANDS.has(tokens[i]!)) i++;
  for (; i < tokens.length; i++) if (!FLAGS.has(tokens[i]!) && !(i === tokens.length - 1 && ["<target>", "<args>"].includes(tokens[i]!))) invalid();
}
function validate(value: unknown, context: IdentityContext, binding: ClaudeCheckpointBinding, limits: ClaudeLimits, parserVersion: number): DecodedCheckpoint {
  const h = fields(value, ["schemaVersion", "provider", "parserVersion", "normalizationVersion", "keyVersion", "keyId", "sourceId", "completedOffset", "nextOrdinal", "limits", "position", "state"]);
  for (const [key, expected] of Object.entries({ schemaVersion: 1, provider: "claude", parserVersion, normalizationVersion: context.normalizationVersion, keyVersion: context.keyVersion, keyId: context.keyId, ...binding })) if (h[key] !== expected) invalid();
  const storedLimits = fields(h.limits, LIMIT_KEYS); for (const key of LIMIT_KEYS) if (storedLimits[key] !== limits[key]) invalid();
  const p = shape(h.position, { firstOrdinal: nullable(integer), lastOrdinal: nullable(integer), lastByteOffset: nullable(integer), recordCount: integer }) as unknown as CheckpointPosition;
  if (p.recordCount === 0) { if (p.firstOrdinal !== null || p.lastOrdinal !== null || p.lastByteOffset !== null || binding.completedOffset !== 0) invalid(); }
  else {
    if (p.firstOrdinal === null || p.lastOrdinal === null || p.lastByteOffset === null || p.lastOrdinal < p.firstOrdinal || p.lastByteOffset >= binding.completedOffset) invalid();
    if (!Number.isSafeInteger(p.lastOrdinal + 1) || p.lastOrdinal + 1 !== binding.nextOrdinal || !Number.isSafeInteger(p.lastOrdinal - p.firstOrdinal + 1) || p.recordCount !== p.lastOrdinal - p.firstOrdinal + 1) invalid();
  }
  const s = fields(h.state, [...MAP_KEYS, ...SET_KEYS, ...COUNTER_KEYS]);
  const id = (domain: string) => identity(context.keyId, domain), nid = (domain: string) => nullable(id(domain));
  const alias: Validator = value => { if (value !== null && (typeof value !== "string" || !/^source-[0-9]{1,12}$/.test(value))) invalid(); };
  const offset: Validator = value => { const n = integer(value); if (p.lastByteOffset === null || n > p.lastByteOffset || n >= binding.completedOffset) invalid(); };
  const ordinal: Validator = value => { const n = integer(value); if (p.firstOrdinal === null || p.lastOrdinal === null || n < p.firstOrdinal || n > p.lastOrdinal) invalid(); };
  const ref: Validator = value => { shape(value, { fileId: fixed(binding.sourceId), byteOffset: offset }); };
  const position: Validator = value => { shape(value, { fileId: fixed(binding.sourceId), ordinal, sourceRef: ref, sourceAlias: alias }); };
  const source: Validator = value => { shape(value, { ownerRootSessionId: nid("session"), ambiguous: bool }); };
  const stream: Validator = value => { const v = shape(value, { rootSessionId: id("session"), agentId: nid("session"), isSidechain: bool, projectId: nid("file") }); if (v.isSidechain === (v.agentId === null)) invalid(); };
  const result: Validator = value => { shape(value, {
    digest: id("event"), at: nullable(timestamp), position, isError: nullable(bool), backgroundTaskId: nid("event"),
    asyncLaunched: bool, unassignedAcknowledgement: bool, contentFingerprint: nil, contentState: choice("truncated", "unknown"),
    errorFingerprint: nil, directDurationMs: nil, directDurationScope: fixed("unknown"), conflicted: bool,
  }); };
  const event: Validator = value => {
    const v = shape(value, {
      normalizationVersion: fixed(context.normalizationVersion), keyVersion: fixed(context.keyVersion), keyId: fixed(context.keyId),
      id: id("event"), sessionId: id("session"), turnId: nil, parentEventId: nil, provider: fixed("claude"),
      kind: choice("model","shell","file_read","file_write","file_edit","search","mcp","browser","skill","subagent","other"),
      category: choice("model","test","build","search","read","write","edit","mcp","browser","skill","subagent","other"),
      toolName: nullable(choice("Bash","Read","Write","Edit","Grep","Glob","exec_command","write_stdin","apply_patch","mcp","browser","other")),
      commandPattern: command, operationKey: nid("operation"), fileFingerprint: nid("file"), lookupKey: nid("lookup"), lookupRange: nil,
      contentFingerprint: nil, contentState: choice("truncated","unknown"), changeState: fixed("unknown"), validationScope: fixed("unknown"),
      startAt: nullable(timestamp), endAt: nullable(timestamp), intervalTimingEvidence: choice("unknown","paired_timestamps"),
      intervalScope: choice("unknown","invocation_latency"), durationMs: nullable(duration), timingEvidence: choice("unknown","paired_timestamps"),
      durationScope: choice("unknown","invocation_latency"), status: choice("completed","failed","pending","unknown"),
      executionOutcome: choice("success","error","unknown"), exitCode: nil, errorFingerprint: nil, errorClass: nullable(fixed("tool_error")),
      sourceRef: value => { shape(value, { fileId: fixed(binding.sourceId), byteOffset: offset, recordType: choice("assistant","user") }); },
    });
    const elapsed = v.startAt === null || v.endAt === null ? null : Date.parse(v.endAt as string) - Date.parse(v.startAt as string);
    if (v.durationMs === null ? v.timingEvidence !== "unknown" || v.durationScope !== "unknown" : v.timingEvidence !== "paired_timestamps" || v.durationScope !== "invocation_latency" || elapsed !== v.durationMs) invalid();
    if (v.intervalScope === "unknown" ? v.intervalTimingEvidence !== "unknown" : v.intervalTimingEvidence !== "paired_timestamps" || elapsed === null || elapsed < 0) invalid();
    if (v.status === "pending" && (v.endAt !== null || v.durationMs !== null || v.intervalScope !== "unknown")) invalid();
    if (v.executionOutcome !== (v.status === "completed" ? "success" : v.status === "failed" ? "error" : "unknown")) invalid();
    if (v.errorClass !== (v.status === "failed" ? "tool_error" : null)) invalid();
  };
  const execution: Validator = value => {
    const v = shape(value, { event, callDigest: id("event"), inputDigest: id("event"), callProjectId: nid("file"), position, callMessageId: nid("event"), callKind: choice("bash","agent","tool"), backgroundRequested: bool, result: nullable(result), conflicted: bool });
    const e = v.event as Obj;
    if (e.lookupKey !== null && (e.kind !== "search" || e.category !== "search" || !["Grep", "Glob"].includes(e.toolName as string)
      || v.callKind !== "tool" || v.callProjectId === null || v.conflicted || v.backgroundRequested
      || e.commandPattern !== null || e.fileFingerprint !== null || e.lookupRange !== null
      || v.result !== null && (v.result as Obj).conflicted)) invalid();
  };
  const turn: Validator = value => {
    const v = shape(value, { id: id("turn"), sessionId: id("session"), provider: fixed("claude"), observedAt: nullable(timestamp), startAt: nil, endAt: nil,
      intervalScope: fixed("unknown"), intervalTimingEvidence: fixed("unknown"), durationMs: nullable(duration), timingEvidence: choice("source_reported","unknown"),
      durationScope: fixed("unknown"), status: fixed("unknown"), selection: choice("duration_only","invalid","conflicted"), sourceRef: ref });
    if (v.durationMs === null ? v.timingEvidence !== "unknown" || v.selection === "duration_only" : v.timingEvidence !== "source_reported" || v.selection !== "duration_only") invalid();
  };
  const count: Validator = value => {
    const v = shape(value, { input: nullable(integer), uncachedInput: nullable(integer), output: nullable(integer), cachedInput: nullable(integer), cacheWriteInput: nullable(integer), reasoningOutput: nil, total: nullable(integer) });
    if (v.input !== null) { if ([v.uncachedInput,v.cachedInput,v.cacheWriteInput].includes(null)) invalid(); const n = (v.uncachedInput as number)+(v.cachedInput as number)+(v.cacheWriteInput as number); if (!Number.isSafeInteger(n) || n !== v.input) invalid(); }
    if (v.total !== null) { if (v.input === null || v.output === null) invalid(); const n=(v.input as number)+(v.output as number); if (!Number.isSafeInteger(n)||n!==v.total) invalid(); }
  };
  const countStatus = choice("complete","partial","invalid"), stop = nullable(choice("end_turn","tool_use","unknown"));
  const countConsistency = (v: Obj) => { if (v.countStatus === "complete" && v.counts !== null && Object.entries(v.counts as Obj).some(([k,n])=>k!=="reasoningOutput"&&n===null)) invalid(); };
  const usage: Validator = value => {
    const v = shape(value, { id:id("event"), sessionId:id("session"), responseId:nid("event"), provider:fixed("claude"), source:fixed("message_usage"), scope:fixed("response_snapshot"),
      counts:nullable(count), countStatus, mapping:fixed("anthropic_messages"), finality:fixed("unknown"), selection:choice("provisional","conflicted","invalid"),
      stopReason:stop, terminalCandidate:bool, limitations:words("unknown_finality","partial_counts","invalid_counts","missing_response_id","ambiguous_origin","conflict","unknown_source_order"),
      turnId:nil, toolEventId:nil, phase:fixed("unknown"), sourceRef:ref });
    countConsistency(v);
    if (v.terminalCandidate !== (v.stopReason==="end_turn"||v.stopReason==="tool_use") || v.selection==="conflicted"&&v.counts!==null) invalid();
  };
  const order: Validator = value => { shape(value, { fileId:fixed(binding.sourceId), ordinal, group:nil, order:nil }); };
  const link: Validator = value => { shape(value, { id:id("event"), sessionId:id("session"), kind:choice("assistant","user","system"), parentMessageId:nid("event"), sourceToolAssistantMessageId:nid("event"), responseId:nid("event"), conflicted:bool, sourceRef:ref }); };
  const message: Validator = value => { shape(value,{ link, digest:id("event") }); };
  const metadata: Validator = value => { shape(value,{ id:id("source"), ownerRootSessionId:nid("session"), declaredRootSessionId:nid("session"), sessionId:nid("session"), agentId:nid("session"), isSidechain:nullable(bool), versionFingerprint:nid("source"), declarationFingerprint:nid("session"), origin:choice("ordinary","ambiguous"), sourceRef:ref }); };
  const observedUsage: Validator = value => { const v=shape(value,{counts:count,countStatus,finality:fixed("unknown"),stopReason:stop,mapping:fixed("anthropic_messages")}); countConsistency(v); };
  const observedResult: Validator = value => { shape(value,{isError:nullable(bool),completionKind:choice("invocation_result","background_acknowledgement","unknown"),unassignedAcknowledgement:bool,observedAt:nullable(timestamp),acknowledgementLatencyMs:nullable(duration),durationMs:nil,durationScope:fixed("unknown")}); };
  const observation: Validator = value => { shape(value,{id:id("source"),sessionId:nid("session"),eventId:nid("event"),messageId:nid("event"),usageId:nid("event"),turnId:nid("turn"),representation:choice("call","result","message","usage","turn","metadata","provenance","unsupported"),origin:choice("ordinary","ambiguous"),observedUsage:nullable(observedUsage),observedResult:nullable(observedResult),sourceRef:ref}); };
  const diag: Validator = value => {
    const v=shape(value,{code:choice(...Object.keys(MESSAGES)),severity:choice("info","warning","error"),sourceAlias:alias,byteOffset:nullable(offset)});
    if (v.severity !== diagnostic(v.code as SafeDiagnostic["code"]).severity) invalid();
  };
  const validators: Record<keyof Maps, Validator> = { sources:source,streams:stream,events:execution,turns:turn,usage,usageOrders:order,messages:message,deferredResults:result,observations:observation,metadata,diagnostics:diag };
  const caps: Record<keyof Maps,number> = { sources:Math.min(1,limits.sources),streams:limits.streams,events:limits.events,turns:limits.turns,usage:limits.usage,usageOrders:limits.usageOrders,messages:limits.messageLinks,deferredResults:limits.deferredResults,observations:limits.observations,metadata:limits.metadata,diagnostics:limits.diagnostics };
  const keys = Object.create(null) as Record<keyof Maps, Set<string>>;
  for (const name of MAP_KEYS) {
    keys[name]=new Set();
    for (const entry of array(s[name],caps[name])) {
      const row=array(entry,2); if(row.length!==2||typeof row[0]!=="string"||keys[name].has(row[0])) invalid();
      if(Buffer.byteLength(JSON.stringify(row))>MAX_ROW_BYTES) invalid();
      const key=row[0]; keys[name].add(key); validators[name](row[1]); const v=row[1] as Obj;
      if(name==="diagnostics") {
        const suffix=`:${v.byteOffset??"none"}:${v.code}`;
        if(key!==binding.sourceId+suffix&&key!=="none"+suffix) invalid();
      } else {
        id(name==="sources"||name==="observations"||name==="metadata"?"source":name==="streams"?"session":name==="turns"?"turn":"event")(key);
        if(name==="sources"&&key!==binding.sourceId) invalid();
        if(name==="streams"&&v.isSidechain===false&&v.rootSessionId!==key) invalid();
        const embedded=name==="events"?(v.event as Obj).id:name==="messages"?(v.link as Obj).id:v.id;
        if(embedded!==undefined&&embedded!==key) invalid();
      }
    }
  }
  for (const name of SET_KEYS) {
    const cap=name==="shapes"?6:name==="usageProofReplays"?0:name==="uuidReplays"?limits.messageLinks:limits.resultReplays;
    const values=array(s[name],cap); if(new Set(values).size!==values.length) invalid();
    for(const v of values) if(name==="shapes") choice("tool_use","tool_result","message_link","message_usage","background_acknowledgement","turn_duration")(v); else id("event")(v);
  }
  for(const name of COUNTER_KEYS) if(name==="partial"||name==="limited") bool(s[name]); else integer(s[name]);
  const pairs=(name:keyof Maps)=>s[name] as [string,Obj][];
  for(const name of ["events","turns","usage","messages"] as const) for(const [,v] of pairs(name)) {
    const row=name==="events"?v.event as Obj:name==="messages"?v.link as Obj:v;
    if(!keys.streams.has(row.sessionId as string)) invalid();
  }
  // A re-signed token cannot hide a linked message conflict by clearing only
  // execution.conflicted. Missing optional message links remain representable.
  const messages = new Map(pairs("messages"));
  for (const [, execution] of pairs("events")) if ((execution.event as Obj).lookupKey !== null && execution.callMessageId !== null) {
    const message = messages.get(execution.callMessageId as string);
    if (message && (message.link as Obj).conflicted) invalid();
  }
  if(keys.usage.size!==keys.usageOrders.size||[...keys.usage].some(key=>!keys.usageOrders.has(key))) invalid();
  if([...keys.deferredResults].some(key=>keys.events.has(key))) invalid();
  let edges=0; for(const [,v] of pairs("messages")) { const l=v.link as Obj; edges+=Number(l.parentMessageId!==null)+Number(l.sourceToolAssistantMessageId!==null); }
  if(edges!==s.messageEdges||edges>limits.messageLinks||(s.unsupported as number)>keys.observations.size||(s.ambiguous as number)>keys.observations.size) invalid();
  if(s.limited&&!s.partial||(s.diagnosticsDropped as number)>0&&(!s.limited||!s.partial)) invalid();
  if(p.recordCount===0 && (MAP_KEYS.some(name=>keys[name].size>0)||SET_KEYS.some(name=>(s[name] as unknown[]).length>0)||COUNTER_KEYS.some(name=>s[name]!==0&&s[name]!==false))) invalid();
  // Parsed JSON is already exclusively owned. Freeze safe values but leave two private mutable states owned by the adapter.
  const freeze=(value:unknown):void=>{if(value!==null&&typeof value==="object"){for(const child of Object.values(value))freeze(child);Object.freeze(value);}};
  for(const name of MAP_KEYS) for(const [,v] of pairs(name)) {
    if(name==="sources") continue;
    if(name==="events") for(const child of Object.values(v)) freeze(child);
    else freeze(v);
  }
  return { position:Object.freeze(p), state:s as unknown as DecodedCheckpoint["state"] };
}

export function encodeClaudeCheckpoint(context: IdentityContext, binding: ClaudeCheckpointBinding, limits: ClaudeLimits, parserVersion: number, position: CheckpointPosition, state: CheckpointState, maximum: number): ClaudeCheckpointExport {
  try {
    const header={schemaVersion:1,provider:"claude",parserVersion,normalizationVersion:context.normalizationVersion,keyVersion:context.keyVersion,keyId:context.keyId,...binding,limits,position};
    const pieces:string[]=[]; let escapedBytes=0;
    const overhead=Buffer.byteLength(JSON.stringify({schema:SCHEMA,payload:"",tag:`h1:${context.keyId}:source:${"0".repeat(64)}`}));
    const append=(part:string)=>{const size=Buffer.byteLength(JSON.stringify(part))-2;if(size>maximum-overhead-escapedBytes)budget();escapedBytes+=size;pieces.push(part);};
    append(rowJson(header).slice(0,-1)+',"state":{');
    let first=true;
    for(const name of [...MAP_KEYS,...SET_KEYS]) {
      append((first?"":",")+JSON.stringify(name)+":[");first=false;let rowFirst=true;
      const values:Iterable<unknown>=state[name];
      for(const value of values) {
        const row=rowJson(value);
        append((rowFirst?"":",")+row);rowFirst=false;
      }
      append("]");
    }
    for(const name of COUNTER_KEYS)append(","+JSON.stringify(name)+":"+JSON.stringify(state[name]));
    append("}}");
    const payload=pieces.join("");
    validate(parse(payload),context,binding,limits,parserVersion);
    const checkpoint=JSON.stringify({schema:SCHEMA,payload,tag:tag(context,payload)});
    if(Buffer.byteLength(checkpoint)>maximum)budget();
    return Object.freeze({status:"captured",checkpoint});
  } catch(error) { return Object.freeze({status:"unavailable",reason:error instanceof CheckpointBudget?"checkpoint_budget":"unsupported_state"}); }
}
export function decodeClaudeCheckpoint(context:IdentityContext,encoded:unknown,binding:ClaudeCheckpointBinding,limits:ClaudeLimits,parserVersion:number):DecodedCheckpoint {
  const parsed=parse(encoded);
  const outer=fields(parsed,["schema","payload","tag"]);
  if(Object.keys(parsed as object).join(",")!=="schema,payload,tag")invalid();
  if(outer.schema!==SCHEMA||typeof outer.payload!=="string"||typeof outer.tag!=="string")invalid();
  identity(context.keyId,"source")(outer.tag);
  const expected=tag(context,outer.payload);
  if(expected.length!==outer.tag.length||!timingSafeEqual(Buffer.from(expected),Buffer.from(outer.tag)))invalid();
  return validate(parse(outer.payload),context,binding,limits,parserVersion);
}
