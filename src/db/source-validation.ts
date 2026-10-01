import type { NormalizedEvent } from "../normalize/types.js";
import { SafeError } from "../privacy/diagnostics.js";

export const MAX_SOURCE_EVENTS = 4096;
export const MAX_EVENT_BYTES = 64 * 1024;
export const MAX_SOURCE_EVENT_BYTES = 16 * 1024 * 1024;
export type SourceInput = Readonly<{
  sourceId: string; provider: "codex" | "claude"; parserVersion: number;
  normalizationVersion: 1; keyVersion: 1; keyId: string;
  completedOffset: number; observedSize: number; boundaryFingerprint: string | null;
  events: readonly NormalizedEvent[];
}>;
export type SourceHeaderInput = Omit<SourceInput, "events">;
export type EncodedSource = Readonly<{ header: SourceHeaderInput; rows: readonly Readonly<{ id: string; json: string }>[]; bytes: number }>;

export function invalid(): never { throw new SafeError("INVALID_RECORD"); }
export function integer(value: unknown, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) invalid();
  return value;
}
export function number(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) invalid();
  return value;
}
export function choice<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== "string" || !values.includes(value as T)) invalid();
  return value as T;
}
export function keyId(value: unknown): string {
  if (typeof value !== "string" || value.length !== 32 || !/^[a-f0-9]{32}$/.test(value)) invalid();
  return value;
}
export function identity(value: unknown, domain: string, key: string): string {
  const prefix = `h1:${key}:${domain}:`;
  if (typeof value !== "string" || value.length !== prefix.length + 64 || !value.startsWith(prefix) || !/^[a-f0-9]{64}$/.test(value.slice(prefix.length))) invalid();
  return value;
}
export function nullableIdentity(value: unknown, domain: string, key: string): string | null {
  return value === null ? null : identity(value, domain, key);
}
export function fields(value: unknown, names: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== names.length) invalid();
  const result: Record<string, unknown> = Object.create(null);
  for (const name of names) {
    const descriptor = descriptors[name];
    if (!descriptor || !("value" in descriptor)) invalid();
    result[name] = descriptor.value;
  }
  return result;
}
export function array(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) invalid();
  if (value.length > maximum) throw new SafeError("STATE_LIMIT");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== value.length + 1) invalid();
  const result: unknown[] = [];
  for (let i = 0; i < value.length; i++) {
    const descriptor = descriptors[String(i)];
    if (!descriptor || !("value" in descriptor)) invalid();
    result.push(descriptor.value);
  }
  return result;
}
export function timestamp(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 27) invalid();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) invalid();
  return value;
}
const TOOLS = ["Bash", "Read", "Write", "Edit", "Grep", "Glob", "exec_command", "write_stdin", "apply_patch", "mcp", "browser", "other"] as const;
// Closed display vocabulary for normalization v1; never permit arbitrary argv here.
const PROGRAMS = new Set(["npm", "npx", "rg", "git", "node", "python", "python3", "pytest", "cargo", "go", "xcodebuild", "cat", "sed", "ls", "find", "head", "tail", "other"]);
const SUBCOMMANDS = new Set(["test", "run", "ci", "install", "build", "check", "fmt", "lint", "status", "diff", "show", "log", "rev-parse"]);
const FLAGS = new Set(["--runInBand", "--watch", "--glob", "--type", "--fixed-strings", "--ignore-case", "--files", "--no-ignore", "--hidden", "--json", "--verbose", "--quiet", "--all", "--workspace", "--filter", "--no-cache", "--nocapture", "--only-testing", "--scheme", "--configuration", "--testPathPattern", "--exit-code", "-n", "-l", "-i", "-F", "-g", "-e", "-x", "-q"]);
function commandPattern(value: unknown): string | null {
  if (value === null || value === "shell <complex>") return value;
  if (typeof value !== "string") invalid();
  if (value.length > MAX_EVENT_BYTES) throw new SafeError("STATE_LIMIT");
  const tokens = value.split(" ");
  if (!PROGRAMS.has(tokens[0]!)) invalid();
  let index = 1;
  if (["npm", "npx", "git", "cargo", "go"].includes(tokens[0]!) && SUBCOMMANDS.has(tokens[index]!)) index++;
  for (; index < tokens.length; index++) {
    if (FLAGS.has(tokens[index]!)) continue;
    if (index === tokens.length - 1 && ["<target>", "<args>"].includes(tokens[index]!)) continue;
    invalid();
  }
  return value;
}
const TIMING = ["source_reported", "paired_timestamps", "estimated", "unknown"] as const;
const SCOPES = ["invocation_latency", "process_runtime", "item_lifecycle", "unknown"] as const;
const EVENT_FIELDS = ["normalizationVersion", "keyVersion", "keyId", "id", "sessionId", "turnId", "parentEventId", "provider", "kind", "category", "toolName", "commandPattern", "operationKey", "fileFingerprint", "lookupKey", "lookupRange", "contentFingerprint", "contentState", "changeState", "validationScope", "startAt", "endAt", "intervalTimingEvidence", "intervalScope", "durationMs", "timingEvidence", "durationScope", "status", "executionOutcome", "exitCode", "errorFingerprint", "errorClass", "sourceRef"] as const;

export function validateEvent(value: unknown, header: SourceHeaderInput): NormalizedEvent {
  const v = fields(value, EVENT_FIELDS);
  if (v["normalizationVersion"] !== 1 || v["keyVersion"] !== 1 || v["keyId"] !== header.keyId || v["provider"] !== header.provider) invalid();
  const ref = fields(v["sourceRef"], ["fileId", "byteOffset", "recordType"]);
  if (identity(ref["fileId"], "source", header.keyId) !== header.sourceId || integer(ref["byteOffset"]) >= header.completedOffset) invalid();
  let range = null;
  if (v["lookupRange"] !== null) {
    const r = fields(v["lookupRange"], ["startLine", "endLine"]);
    range = Object.freeze({ startLine: integer(r["startLine"], 1), endLine: integer(r["endLine"], 1) });
    if (range.endLine < range.startLine) invalid();
  }
  const startAt = timestamp(v["startAt"]), endAt = timestamp(v["endAt"]);
  if (startAt !== null && endAt !== null && Date.parse(endAt) < Date.parse(startAt)) invalid();
  const event: NormalizedEvent = Object.freeze({
    normalizationVersion: 1, keyVersion: 1, keyId: header.keyId,
    id: identity(v["id"], "event", header.keyId), sessionId: identity(v["sessionId"], "session", header.keyId),
    turnId: nullableIdentity(v["turnId"], "turn", header.keyId), parentEventId: nullableIdentity(v["parentEventId"], "event", header.keyId),
    provider: header.provider,
    kind: choice(v["kind"], ["model", "shell", "file_read", "file_write", "file_edit", "search", "mcp", "browser", "skill", "subagent", "other"]),
    category: choice(v["category"], ["model", "test", "build", "search", "read", "write", "edit", "mcp", "browser", "skill", "subagent", "other"]),
    toolName: v["toolName"] === null ? null : choice(v["toolName"], TOOLS), commandPattern: commandPattern(v["commandPattern"]),
    operationKey: nullableIdentity(v["operationKey"], "operation", header.keyId), fileFingerprint: nullableIdentity(v["fileFingerprint"], "file", header.keyId),
    lookupKey: nullableIdentity(v["lookupKey"], "lookup", header.keyId), lookupRange: range,
    contentFingerprint: nullableIdentity(v["contentFingerprint"], "content", header.keyId),
    contentState: choice(v["contentState"], ["complete", "truncated", "unknown"]), changeState: choice(v["changeState"], ["unchanged", "changed", "unknown"]),
    validationScope: choice(v["validationScope"], ["full", "targeted", "incremental", "unknown"]), startAt, endAt,
    intervalTimingEvidence: choice(v["intervalTimingEvidence"], TIMING), intervalScope: choice(v["intervalScope"], SCOPES),
    durationMs: number(v["durationMs"]), timingEvidence: choice(v["timingEvidence"], TIMING), durationScope: choice(v["durationScope"], SCOPES),
    status: choice(v["status"], ["completed", "failed", "cancelled", "pending", "unknown"]),
    executionOutcome: choice(v["executionOutcome"], ["success", "no_match", "change_detected", "error", "unknown"]),
    exitCode: v["exitCode"] === null ? null : integer(v["exitCode"], -2147483648),
    errorFingerprint: nullableIdentity(v["errorFingerprint"], "error", header.keyId),
    errorClass: v["errorClass"] === null ? null : choice(v["errorClass"], ["process_exit", "tool_error", "timeout", "other"]),
    sourceRef: Object.freeze({ fileId: header.sourceId, byteOffset: integer(ref["byteOffset"]), recordType: choice(ref["recordType"], ["response_item", "event_msg", "assistant", "user", "system", "unknown"]) }),
  });
  if (event.exitCode !== null && event.exitCode > 2147483647) invalid();
  if (event.durationMs === null ? event.timingEvidence !== "unknown" || event.durationScope !== "unknown" : event.timingEvidence === "unknown" || event.durationScope === "unknown") invalid();
  if (event.intervalScope === "unknown" ? event.intervalTimingEvidence !== "unknown" : event.intervalTimingEvidence === "unknown" || startAt === null || endAt === null) invalid();
  if (event.durationMs !== null && startAt !== null && endAt !== null && event.durationScope === event.intervalScope
    && Math.abs(event.durationMs - (Date.parse(endAt) - Date.parse(startAt))) > 1) invalid();
  if (event.status === "pending" && (endAt !== null || event.durationMs !== null || event.intervalScope !== "unknown")) invalid();
  if (event.contentFingerprint !== null && event.contentState !== "complete") invalid();
  return event;
}
export const HEADER_FIELDS = ["sourceId", "provider", "parserVersion", "normalizationVersion", "keyVersion", "keyId", "completedOffset", "observedSize", "boundaryFingerprint"] as const;
export function validateHeader(value: unknown, expectedKey: string): SourceHeaderInput {
  const v = fields(value, HEADER_FIELDS);
  if (v["keyId"] !== expectedKey || v["normalizationVersion"] !== 1 || v["keyVersion"] !== 1) invalid();
  const completedOffset = integer(v["completedOffset"]), observedSize = integer(v["observedSize"]);
  if (completedOffset > observedSize) invalid();
  const boundaryFingerprint = nullableIdentity(v["boundaryFingerprint"], "content", expectedKey);
  if ((completedOffset === 0) !== (boundaryFingerprint === null)) invalid();
  return Object.freeze({ sourceId: identity(v["sourceId"], "source", expectedKey), provider: choice(v["provider"], ["codex", "claude"]), parserVersion: integer(v["parserVersion"], 1),
    normalizationVersion: 1, keyVersion: 1, keyId: expectedKey, completedOffset, observedSize, boundaryFingerprint });
}
export function encodeSource(value: unknown, expectedKey: string): EncodedSource {
  const input = fields(value, [...HEADER_FIELDS, "events"]);
  const headerValues: Record<string, unknown> = {};
  for (const name of HEADER_FIELDS) headerValues[name] = input[name];
  const header = validateHeader(headerValues, expectedKey);
  const rows: { id: string; json: string }[] = [], seen = new Set<string>();
  let bytes = 0;
  for (const raw of array(input["events"], MAX_SOURCE_EVENTS)) {
    const event = validateEvent(raw, header);
    if (seen.has(event.id)) invalid();
    seen.add(event.id);
    const json = JSON.stringify(event), size = Buffer.byteLength(json);
    bytes += size;
    if (size > MAX_EVENT_BYTES || bytes > MAX_SOURCE_EVENT_BYTES) throw new SafeError("STATE_LIMIT");
    rows.push({ id: event.id, json });
  }
  return { header, rows, bytes };
}
