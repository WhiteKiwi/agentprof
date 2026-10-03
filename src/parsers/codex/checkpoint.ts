import { createHash, timingSafeEqual } from "node:crypto";
import { types } from "node:util";
import type { IdentityContext } from "../../normalize/identity.js";
import { diagnostic, MESSAGES } from "../../privacy/diagnostics.js";
import type { SafeDiagnostic } from "../../privacy/diagnostics.js";
import type { CodexLimits } from "../types.js";
import type { CheckpointMaps, CheckpointPosition, CheckpointState, CodexCheckpointBinding, CodexCheckpointExport, DecodedCheckpoint } from "./checkpoint-types.js";

export const MAX_CODEX_CHECKPOINT_BYTES = 4 * 1024 * 1024;
const MAX_ROW_BYTES = 64 * 1024, MAX_DEPTH = 16, MAX_NODES = 4 * 1024 * 1024;
const SCHEMA = "agentprof.codex-checkpoint/v1";
const MAP_KEYS = ["sources", "streams", "events", "pendingResults", "processes", "polls", "turns", "usage", "usageOrder", "lastSnapshots", "wrappers", "metadata", "observations", "diagnostics"] as const;
const SET_KEYS = ["unsupportedCalls", "resultReplays", "shapes"] as const;
const COUNTER_KEYS = ["wrapperChildLinks", "partial", "limited", "unsupported", "ambiguous", "diagnosticsDropped"] as const;
const LIMIT_KEYS = ["events", "turns", "usage", "sources", "streams", "links", "observations", "metadata", "diagnostics"] as const;
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
    if (!entry || !("value" in entry) || !entry.enumerable) invalid();
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
  if (typeof value !== "string" || !/^(?:\d{4}|[+-]\d{6})-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) invalid();
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
export function checkpointBinding(value: unknown, context: IdentityContext): CodexCheckpointBinding {
  const v = fields(value, ["sourceId", "completedOffset", "nextOrdinal"]);
  identity(context.keyId, "source")(v.sourceId);
  return { sourceId: v.sourceId as string, completedOffset: integer(v.completedOffset), nextOrdinal: integer(v.nextOrdinal) };
}
export function checkpointBudget(value: unknown): number {
  if (value === undefined) return MAX_CODEX_CHECKPOINT_BYTES;
  if (value === null || typeof value !== "object" || types.isProxy(value)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length === 0 && [Object.prototype, null].includes(Object.getPrototypeOf(value))) return MAX_CODEX_CHECKPOINT_BYTES;
  const v = fields(value, ["maxBytes"]);
  const size = integer(v.maxBytes);
  if (size < 1 || size > MAX_CODEX_CHECKPOINT_BYTES) invalid();
  return size;
}
function collectionCaps(limits: CodexLimits): Record<keyof CheckpointMaps | typeof SET_KEYS[number], number> {
  return {
    sources: Math.min(1, limits.sources), streams: limits.streams, events: limits.events, pendingResults: limits.events,
    processes: limits.links, polls: limits.links, turns: limits.turns, usage: limits.usage, usageOrder: 0,
    lastSnapshots: limits.usage, wrappers: limits.events, metadata: limits.metadata, observations: limits.observations, diagnostics: limits.diagnostics,
    unsupportedCalls: limits.events, resultReplays: limits.observations, shapes: 10,
  };
}
const PAYLOAD_KEYS = ["schemaVersion", "provider", "parserVersion", "normalizationVersion", "keyVersion", "keyId", "sourceId", "completedOffset", "nextOrdinal", "limits", "position", "state"] as const;
/** Check the grammar and allocation budgets without constructing a payload graph.
 * Only bounded individual property names are decoded during this pass. Row spans
 * and collection counts use the authenticated caller limits before JSON.parse.
 */
function lexicalPreflight(text: string, limits?: CodexLimits): void {
  let cursor = 0, nodes = 0;
  const caps = limits === undefined ? null : collectionCaps(limits);
  const space = () => { while (cursor < text.length && [32, 9, 10, 13].includes(text.charCodeAt(cursor))) cursor++; };
  const string = () => {
    if (text[cursor++] !== '"') invalid();
    while (cursor < text.length) {
      const code = text.charCodeAt(cursor++);
      if (code === 34) return;
      if (code < 32) invalid();
      if (code === 92) {
        const escape = text[cursor++];
        if (escape === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(cursor, cursor + 4))) invalid();
          cursor += 4;
        } else if (escape === undefined || !['"', "\\", "/", "b", "f", "n", "r", "t"].includes(escape)) invalid();
      }
    }
    invalid();
  };
  type Role = "root" | "state" | "envelope_value" | "value";
  const read = (depth: number, role: Role = "value", cap?: number): void => {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) invalid();
    space();
    const c = text[cursor];
    if ((role === "root" || role === "state") && c !== "{" || role === "envelope_value" && c !== '"' || cap !== undefined && c !== "[") invalid();
    if (c === '"') { string(); return; }
    if (c === "{") {
      cursor++; space(); const names = new Set<string>();
      if (text[cursor] === "}") { cursor++; return; }
      while (true) {
        space(); const start = cursor; string();
        if (++nodes > MAX_NODES || cursor - start > MAX_ROW_BYTES) invalid();
        const name = JSON.parse(text.slice(start, cursor)) as string;
        if (["__proto__", "constructor", "prototype"].includes(name) || names.has(name)) invalid();
        names.add(name);
        if (role === "root" && !(caps === null ? ["schema", "payload", "tag"] : PAYLOAD_KEYS as readonly string[]).includes(name)) invalid();
        if (role === "state" && ![...MAP_KEYS, ...SET_KEYS, ...COUNTER_KEYS].includes(name as typeof MAP_KEYS[number])) invalid();
        space(); if (text[cursor++] !== ":") invalid();
        const nextRole = role === "root" ? caps === null ? "envelope_value" : name === "state" ? "state" : "value" : "value";
        const nextCap = role === "state" && caps !== null && Object.hasOwn(caps, name) ? caps[name as keyof typeof caps] : undefined;
        read(depth + 1, nextRole, nextCap); space();
        if (text[cursor] === "}") { cursor++; return; }
        if (text[cursor++] !== ",") invalid();
      }
    }
    if (c === "[") {
      cursor++; space(); let count = 0;
      if (text[cursor] === "]") { cursor++; return; }
      while (true) {
        if (cap !== undefined && ++count > cap) invalid();
        space(); const start = cursor; read(depth + 1);
        if (cap !== undefined && Buffer.byteLength(text.slice(start, cursor)) > MAX_ROW_BYTES) invalid();
        space(); if (text[cursor] === "]") { cursor++; return; }
        if (text[cursor++] !== ",") invalid();
      }
    }
    for (const literal of ["true", "false", "null"]) if (text.startsWith(literal, cursor)) { cursor += literal.length; return; }
    const start = cursor;
    while (cursor < text.length && "0123456789+-.eE".includes(text[cursor]!)) cursor++;
    const token = text.slice(start, cursor);
    if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token) || !Number.isFinite(Number(token)) || Object.is(Number(token), -0)) invalid();
  };
  read(1, "root"); space(); if (cursor !== text.length) invalid();
}
function parse(text: unknown, limits?: CodexLimits): unknown {
  if (typeof text !== "string" || text.length > MAX_CODEX_CHECKPOINT_BYTES || Buffer.byteLength(text) > MAX_CODEX_CHECKPOINT_BYTES) invalid();
  lexicalPreflight(text, limits);
  const value: unknown = JSON.parse(text);
  // Canonical-only opaque tokens: whitespace and alternate numeric spellings reject.
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

/** This guard precedes the legacy constructor's spread. Never enumerate a proxy. */
export function checkpointLimits(value: unknown, defaults: CodexLimits): CodexLimits {
  if (value === undefined) return { ...defaults };
  if (value === null || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const selected = { ...defaults };
  for (const name of Reflect.ownKeys(descriptors)) {
    if (typeof name !== "string" || !LIMIT_KEYS.includes(name as keyof CodexLimits)) invalid();
    const d = descriptors[name]!;
    if (!("value" in d) || !d.enumerable) invalid();
    const n = integer(d.value);
    if (n < 1 || n > 1_000_000) invalid();
    selected[name as keyof CodexLimits] = n;
  }
  return selected;
}

function validate(value: unknown, context: IdentityContext, binding: CodexCheckpointBinding, limits: CodexLimits, parserVersion: number): DecodedCheckpoint {
  const h = fields(value, ["schemaVersion", "provider", "parserVersion", "normalizationVersion", "keyVersion", "keyId", "sourceId", "completedOffset", "nextOrdinal", "limits", "position", "state"]);
  for (const [key, expected] of Object.entries({ schemaVersion: 1, provider: "codex", parserVersion, normalizationVersion: context.normalizationVersion, keyVersion: context.keyVersion, keyId: context.keyId, ...binding })) if (h[key] !== expected) invalid();
  const storedLimits = fields(h.limits, LIMIT_KEYS);
  for (const key of LIMIT_KEYS) if (storedLimits[key] !== limits[key]) invalid();
  const p = shape(h.position, { firstOrdinal: nullable(integer), lastOrdinal: nullable(integer), lastByteOffset: nullable(integer), recordCount: integer }) as unknown as CheckpointPosition;
  if (p.recordCount === 0) {
    if (p.firstOrdinal !== null || p.lastOrdinal !== null || p.lastByteOffset !== null || binding.completedOffset !== 0) invalid();
  } else {
    if (p.firstOrdinal === null || p.lastOrdinal === null || p.lastByteOffset === null || p.lastOrdinal < p.firstOrdinal || p.lastByteOffset >= binding.completedOffset) invalid();
    if (!Number.isSafeInteger(p.lastOrdinal + 1) || p.lastOrdinal + 1 !== binding.nextOrdinal
      || !Number.isSafeInteger(p.lastOrdinal - p.firstOrdinal + 1) || p.recordCount !== p.lastOrdinal - p.firstOrdinal + 1) invalid();
  }
  const s = fields(h.state, [...MAP_KEYS, ...SET_KEYS, ...COUNTER_KEYS]);
  const id = (domain: string) => identity(context.keyId, domain), nid = (domain: string) => nullable(id(domain));
  const alias: Validator = v => { if (v !== null && (typeof v !== "string" || !/^source-[0-9]{1,12}$/.test(v))) invalid(); };
  const offset: Validator = v => { const n = integer(v); if (p.lastByteOffset === null || n > p.lastByteOffset || n >= binding.completedOffset) invalid(); };
  const ref: Validator = v => { shape(v, { fileId: fixed(binding.sourceId), byteOffset: offset }); };
  const exit: Validator = v => { if (typeof v !== "number" || !Number.isInteger(v) || v < -2_147_483_648 || v > 2_147_483_647 || Object.is(v, -0)) invalid(); };
  const source: Validator = v => { shape(v, { ownerId: nid("session"), activeTurnId: nid("turn"), ambiguous: bool, nativeUsageVerified: bool }); };
  const stream: Validator = v => { shape(v, { projectId: nid("file"), versionFingerprint: nid("source"), forkParentId: nid("session") }); };
  const output = (mode: "exec" | "mcp" | "other"): Validator => value => {
    const v = shape(value, {
      exitCode: mode === "exec" ? nullable(exit) : nil, processKey: mode === "exec" ? nid("event") : nil,
      running: mode === "exec" ? bool : fixed(false), cancelled: mode === "exec" ? bool : fixed(false),
      isError: mode === "mcp" ? nullable(bool) : nil, contentFingerprint: nil, errorFingerprint: nil,
      contentState: choice("unknown", "truncated"), metadataVerified: bool, invalidMetadata: mode === "exec" ? bool : fixed(false),
    });
    if (v.metadataVerified !== (mode === "exec" ? v.exitCode !== null || v.processKey !== null || v.cancelled : mode === "mcp" && v.isError !== null)) invalid();
    if (mode === "exec" && v.running && v.exitCode !== null && !v.invalidMetadata) invalid();
  };
  const result: Validator = v => { shape(v, { exec: output("exec"), mcp: output("mcp"), other: output("other"), at: nullable(timestamp), sourceRef: ref, digest: id("event"), conflicted: bool }); };
  const evidence = choice("source_reported", "paired_timestamps", "unknown");
  const event: Validator = value => {
    const v = shape(value, {
      normalizationVersion: fixed(context.normalizationVersion), keyVersion: fixed(context.keyVersion), keyId: fixed(context.keyId),
      id: id("event"), sessionId: id("session"), turnId: nid("turn"), parentEventId: nil, provider: fixed("codex"),
      kind: choice("shell", "mcp", "file_edit"), category: choice("test", "build", "search", "read", "other", "mcp", "edit"),
      toolName: choice("exec_command", "mcp", "apply_patch"), commandPattern: command, operationKey: nid("operation"),
      fileFingerprint: nid("file"), lookupKey: nil, lookupRange: nil, contentFingerprint: nil, contentState: choice("unknown", "truncated"),
      changeState: fixed("unknown"), validationScope: fixed("unknown"), startAt: nullable(timestamp), endAt: nullable(timestamp),
      intervalTimingEvidence: evidence, intervalScope: choice("unknown", "item_lifecycle", "invocation_latency"),
      durationMs: nullable(duration), timingEvidence: evidence, durationScope: choice("unknown", "process_runtime", "invocation_latency"),
      status: choice("completed", "failed", "cancelled", "pending", "unknown"), executionOutcome: choice("success", "no_match", "change_detected", "error", "unknown"),
      exitCode: nullable(exit), errorFingerprint: nil, errorClass: nullable(choice("process_exit", "tool_error")),
      sourceRef: v => { shape(v, { fileId: fixed(binding.sourceId), byteOffset: offset, recordType: choice("response_item", "event_msg") }); },
    });
    const elapsed = v.startAt === null || v.endAt === null ? null : Date.parse(v.endAt as string) - Date.parse(v.startAt as string);
    if (v.durationMs === null ? v.timingEvidence !== "unknown" || v.durationScope !== "unknown" : v.timingEvidence === "unknown" || v.durationScope === "unknown") invalid();
    if (v.timingEvidence === "paired_timestamps" && (v.durationScope !== "invocation_latency" || elapsed !== v.durationMs)) invalid();
    if (v.intervalScope === "unknown" ? v.intervalTimingEvidence !== "unknown" : elapsed === null || elapsed < 0
      || v.intervalTimingEvidence !== (v.intervalScope === "item_lifecycle" ? "source_reported" : "paired_timestamps")) invalid();
    if (v.status === "pending" && (v.endAt !== null || v.durationMs !== null || v.intervalScope !== "unknown")) invalid();
    if (v.kind === "shell" ? v.toolName !== "exec_command" : v.kind === "mcp" ? v.toolName !== "mcp" : v.toolName !== "apply_patch") invalid();
    if (v.kind !== "shell" && v.exitCode !== null) invalid();
    if (v.errorClass !== (v.status === "failed" ? v.kind === "shell" ? "process_exit" : "tool_error" : null)) invalid();
  };
  const execution: Validator = value => {
    const v = shape(value, { event, policy: choice("rg", "git_diff", "unknown"), mode: choice("exec", "mcp", "patch"), callSeen: bool,
      callOperationKey: nid("operation"), structured: bool, conflicted: bool, result: nullable(result), structuredDigest: nid("event") });
    const e = v.event as Obj;
    if (!v.callSeen && (!v.structured || v.callOperationKey !== null) || v.structured !== (v.structuredDigest !== null)) invalid();
    if (e.kind !== (v.mode === "exec" ? "shell" : v.mode === "mcp" ? "mcp" : "file_edit")) invalid();
    if (v.conflicted && (e.status !== "unknown" || e.durationMs !== null || e.intervalScope !== "unknown" || e.executionOutcome !== "unknown" || e.exitCode !== null)) invalid();
    if (!v.structured && v.callOperationKey !== e.operationKey) invalid();
    if (!v.structured && (e.timingEvidence === "source_reported" || e.intervalScope === "item_lifecycle" || e.durationScope === "process_runtime")) invalid();
  };
  const turn: Validator = value => {
    const v = shape(value, { id: id("turn"), sessionId: id("session"), provider: fixed("codex"), startAt: nullable(timestamp), endAt: nullable(timestamp),
      startTimingEvidence: evidence, endTimingEvidence: evidence, intervalTimingEvidence: evidence, intervalScope: choice("turn_wall", "observed_turn", "unknown"),
      durationMs: nullable(duration), timingEvidence: choice("source_reported", "unknown"), durationScope: choice("turn_elapsed", "unknown"),
      status: choice("completed", "cancelled", "pending", "unknown"), sourceRef: ref });
    if (v.durationMs === null ? v.timingEvidence !== "unknown" || v.durationScope !== "unknown" : v.timingEvidence !== "source_reported" || v.durationScope !== "turn_elapsed") invalid();
    if (v.startAt === null && v.startTimingEvidence !== "unknown" || v.endAt === null && v.endTimingEvidence !== "unknown") invalid();
    if (v.intervalScope === "unknown") { if (v.intervalTimingEvidence !== "unknown") invalid(); }
    else {
      const required = v.intervalScope === "turn_wall" ? "source_reported" : "paired_timestamps";
      if (v.startAt === null || v.endAt === null || Date.parse(v.endAt as string) < Date.parse(v.startAt as string)
        || v.startTimingEvidence !== required || v.endTimingEvidence !== required || v.intervalTimingEvidence !== required) invalid();
    }
  };
  const count: Validator = v => {
    shape(v, { input: nullable(integer), output: nullable(integer), cachedInput: nullable(integer), cacheWriteInput: nullable(integer), reasoningOutput: nullable(integer), total: nullable(integer) });
    // Replay equality serializes constructor counts; inspect the original own-key order.
    if (Object.keys(v as object).join(",") !== "input,output,cachedInput,cacheWriteInput,reasoningOutput,total") invalid();
  };
  const countConsistency = (counts: unknown, mapping: unknown, status?: unknown): void => {
    if (counts === null) { if (status === "complete" || status === "partial") invalid(); return; }
    const v = counts as Obj;
    if (status === "complete" && Object.values(v).includes(null)) invalid();
    if (mapping === "unknown") { if (v.total !== null || status === "complete") invalid(); return; }
    if (v.input !== null) {
      for (const name of ["cachedInput", "cacheWriteInput"]) if (v[name] !== null && (v[name] as number) > (v.input as number)) invalid();
      if (v.cachedInput !== null && v.cacheWriteInput !== null) { const sum = (v.cachedInput as number) + (v.cacheWriteInput as number); if (!Number.isSafeInteger(sum) || sum > (v.input as number)) invalid(); }
    }
    if (v.output !== null && v.reasoningOutput !== null && (v.reasoningOutput as number) > (v.output as number)) invalid();
    if (v.total !== null) {
      if (v.input === null || v.output === null) invalid();
      const sum = (v.input as number) + (v.output as number);
      if (!Number.isSafeInteger(sum) || sum !== v.total) invalid();
    }
  };
  const countStatus = choice("complete", "partial", "invalid"), mapping = choice("openai_responses", "unknown"), finality = choice("source_terminal", "unknown");
  const usage: Validator = value => {
    const v = shape(value, { id: id("event"), sessionId: id("session"), turnId: nid("turn"), responseId: nid("event"), provider: fixed("codex"),
      source: choice("response_usage", "turn_snapshot", "thread_snapshot", "token_count_total", "token_count_last"), counts: nullable(count),
      scope: choice("response_increment", "turn_cumulative", "thread_cumulative", "unverified_snapshot"), selection: choice("eligible", "provisional", "snapshot_only", "conflicted", "invalid"),
      finality, countStatus, mapping, limitations: words("unknown_finality", "ambiguous_origin", "partial_counts", "invalid_counts", "missing_response_id", "conflict", "snapshot_only", "zero_or_source_default"),
      toolEventId: nil, phase: fixed("unknown"), sourceRef: ref });
    // Conflict clears the chosen counts but retains the last observation's count status.
    if (v.selection === "conflicted") { if (v.counts !== null || !(v.limitations as string[]).includes("conflict")) invalid(); }
    else countConsistency(v.counts, v.mapping, v.countStatus);
    if (v.finality === "source_terminal" && v.mapping !== "openai_responses") invalid();
    const response = v.source === "response_usage";
    const scope = response ? "response_increment" : v.source === "turn_snapshot" ? "turn_cumulative" : v.source === "token_count_last" ? "unverified_snapshot" : "thread_cumulative";
    if (v.scope !== scope) invalid();
    if (!response && (v.finality !== "unknown" || !["snapshot_only", "invalid", "conflicted"].includes(v.selection as string))) invalid();
    if (response && v.selection === "snapshot_only") invalid();
    if (v.selection === "eligible" && (v.finality !== "source_terminal" || v.responseId === null || v.countStatus === "invalid" || v.counts === null
      || (v.counts as Obj).input === null || (v.counts as Obj).output === null || (v.limitations as string[]).includes("ambiguous_origin"))) invalid();
    if (v.source === "thread_snapshot" && v.turnId !== null || ["token_count_total", "token_count_last"].includes(v.source as string) && (v.turnId !== null || v.responseId !== null)) invalid();
  };
  const lastSnapshot: Validator = value => { const v = shape(value, { counts: count, at: nullable(timestamp) }); countConsistency(v.counts, "openai_responses"); };
  const wrapper: Validator = value => { shape(value, { id: id("event"), sessionId: id("session"), kind: fixed("code_wrapper"), callSeen: bool, resultSeen: bool,
    relationship: fixed("unknown"), childEventIds: v => { array(v, 0); }, sourceRef: ref }); };
  const metadata: Validator = value => { shape(value, { id: id("source"), ownerSessionId: id("session"), declaredSessionId: id("session"), versionFingerprint: nid("source"), forkParentId: nid("session"), origin: choice("ordinary", "ambiguous"), sourceRef: ref }); };
  const observedUsage: Validator = value => {
    const v = shape(value, { counts: nullable(count), finality, countStatus, mapping });
    countConsistency(v.counts, v.mapping, v.countStatus);
    if (v.finality === "source_terminal" && v.mapping !== "openai_responses") invalid();
  };
  const observation: Validator = value => { const v = shape(value, { ...(parserVersion === 2 ? { usageObservedAt: nullable(timestamp) } : {}), id: id("source"), eventId: nid("event"), turnId: nid("turn"), usageId: nid("event"),
    representation: choice("call", "result", "structured", "poll", "wrapper", "turn", "usage", "metadata", "provenance", "unsupported"),
    origin: choice("ordinary", "ambiguous"), transportStatus: choice("completed", "failed", "cancelled", "pending", "unknown"), observedUsage: nullable(observedUsage), sourceRef: ref });
    if (parserVersion === 2 && v.representation !== "usage" && v.usageObservedAt !== null) invalid();
    if (v.origin === "ambiguous" && v.observedUsage !== null && (v.observedUsage as Obj).finality === "source_terminal") invalid();
  };
  const diag: Validator = value => {
    const v = shape(value, { code: choice(...Object.keys(MESSAGES)), severity: choice("info", "warning", "error"), sourceAlias: alias, byteOffset: nullable(offset) });
    if (v.severity !== diagnostic(v.code as SafeDiagnostic["code"]).severity) invalid();
  };
  const validators: Record<keyof CheckpointMaps, Validator> = {
    sources: source, streams: stream, events: execution, pendingResults: result, processes: nid("event"), polls: id("event"),
    turns: turn, usage, usageOrder: () => invalid(), lastSnapshots: lastSnapshot, wrappers: wrapper, metadata, observations: observation, diagnostics: diag,
  };
  const caps = collectionCaps(limits);
  const keys = Object.create(null) as Record<keyof CheckpointMaps, Set<string>>;
  for (const name of MAP_KEYS) {
    keys[name] = new Set();
    for (const entry of array(s[name], caps[name])) {
      const row = array(entry, 2);
      if (row.length !== 2 || typeof row[0] !== "string" || keys[name].has(row[0])) invalid();
      if (Buffer.byteLength(JSON.stringify(row)) > MAX_ROW_BYTES) invalid();
      const key = row[0]; keys[name].add(key); validators[name](row[1]);
      const v = row[1] as Obj;
      if (name === "diagnostics") {
        const expected = `${v.byteOffset === null ? "none" : binding.sourceId}:${v.byteOffset ?? "none"}:${v.code}`;
        if (key !== expected) invalid();
      } else {
        id(name === "sources" || name === "observations" || name === "metadata" ? "source" : name === "streams" ? "session" : name === "turns" ? "turn" : "event")(key);
        if (name === "sources" && key !== binding.sourceId) invalid();
        if (name === "events" && (v.event as Obj).id !== key) invalid();
        if (["turns", "usage", "wrappers", "metadata", "observations"].includes(name) && v.id !== key) invalid();
      }
    }
  }
  for (const name of SET_KEYS) {
    const values = array(s[name], name === "shapes" ? 10 : name === "unsupportedCalls" ? limits.events : limits.observations);
    if (new Set(values).size !== values.length) invalid();
    for (const v of values) {
      if (name === "shapes") choice("command_item", "mcp_item", "function_call", "custom_call", "tool_result", "poll", "code_wrapper", "turn", "response_usage", "token_snapshot")(v);
      else id("event")(v);
    }
  }
  for (const name of COUNTER_KEYS) if (name === "partial" || name === "limited") bool(s[name]); else integer(s[name]);
  const pairs = (name: keyof CheckpointMaps) => s[name] as [string, Obj][];
  for (const name of ["events", "turns", "usage", "wrappers"] as const) for (const [, v] of pairs(name)) {
    const row = name === "events" ? v.event as Obj : v;
    if (!keys.streams.has(row.sessionId as string)) invalid();
  }
  for (const [, eventId] of s.processes as [string, string | null][]) if (eventId !== null && !keys.events.has(eventId)) invalid();
  if (keys.sources.size === 0 && (MAP_KEYS.some(name => name !== "diagnostics" && keys[name].size > 0)
    || SET_KEYS.some(name => (s[name] as unknown[]).length > 0))) invalid();
  if (keys.sources.size === 0) for (const [, v] of pairs("diagnostics")) {
    if (v.code !== "INVALID_RECORD" || v.byteOffset !== null || v.sourceAlias !== null) invalid();
  }
  // Poll processes, source owners/active turns and provider observations may dangle at admission limits.
  // Events/polls/pendingResults, events/unsupportedCalls and events/wrappers can legitimately overlap.
  if (s.wrapperChildLinks !== 0 || (s.unsupported as number) > keys.observations.size || (s.ambiguous as number) > keys.observations.size) invalid();
  if (s.limited && !s.partial || (s.diagnosticsDropped as number) > 0 && (!s.limited || !s.partial)) invalid();
  if (p.recordCount === 0 && (MAP_KEYS.some(name => keys[name].size > 0) || SET_KEYS.some(name => (s[name] as unknown[]).length > 0)
    || COUNTER_KEYS.some(name => s[name] !== 0 && s[name] !== false))) invalid();
  const freeze = (v: unknown): void => { if (v !== null && typeof v === "object") { for (const child of Object.values(v)) freeze(child); Object.freeze(v); } };
  for (const name of MAP_KEYS) for (const [, v] of pairs(name)) {
    // The decoder owns all parsed data. Only these three adapter-private state families remain mutable.
    if (name === "sources" || name === "streams") continue;
    if (name === "events") for (const child of Object.values(v)) freeze(child);
    else freeze(v);
  }
  return { position: Object.freeze(p), state: s as unknown as DecodedCheckpoint["state"] };
}

export function encodeCodexCheckpoint(context: IdentityContext, binding: CodexCheckpointBinding, limits: CodexLimits, parserVersion: number, position: CheckpointPosition, state: CheckpointState, maximum: number): CodexCheckpointExport {
  try {
    const header={schemaVersion:1,provider:"codex",parserVersion,normalizationVersion:context.normalizationVersion,keyVersion:context.keyVersion,keyId:context.keyId,...binding,limits,position};
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
    validate(parse(payload,limits),context,binding,limits,parserVersion);
    const checkpoint=JSON.stringify({schema:SCHEMA,payload,tag:tag(context,payload)});
    if(Buffer.byteLength(checkpoint)>maximum)budget();
    return Object.freeze({status:"captured",checkpoint});
  } catch(error) { return Object.freeze({status:"unavailable",reason:error instanceof CheckpointBudget?"checkpoint_budget":"unsupported_state"}); }
}
export function decodeCodexCheckpoint(context:IdentityContext,encoded:unknown,binding:CodexCheckpointBinding,limits:CodexLimits,parserVersion:number):DecodedCheckpoint {
  const parsed=parse(encoded);
  const outer=fields(parsed,["schema","payload","tag"]);
  if(Object.keys(parsed as object).join(",")!=="schema,payload,tag")invalid();
  if(outer.schema!==SCHEMA||typeof outer.payload!=="string"||typeof outer.tag!=="string")invalid();
  identity(context.keyId,"source")(outer.tag);
  const expected=tag(context,outer.payload);
  if(expected.length!==outer.tag.length||!timingSafeEqual(Buffer.from(expected),Buffer.from(outer.tag)))invalid();
  return validate(parse(outer.payload,limits),context,binding,limits,parserVersion);
}
