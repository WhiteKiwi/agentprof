import { hasUsageTiming, nativeVersionSupported } from "../parsers/capture.js";
import { encodeRelationships } from "./source-relationship-validation.js";
import type { EncodedRelationships, RelationshipEvidence } from "./source-relationship-validation.js";
import type { NormalizedTurn, ParserCapabilities, ParserSourceRef, SourceObservation, TokenCounts, UsageObservation } from "../parsers/types.js";
import type { ClaudeCapabilities, ClaudeCounts, ClaudeSourceObservation, ClaudeTurn, ClaudeUsage } from "../parsers/claude/types.js";
import { MESSAGES, SafeError } from "../privacy/diagnostics.js";
import type { DiagnosticCode, SafeDiagnostic } from "../privacy/diagnostics.js";
import { array, choice, encodeSource, fields, HEADER_FIELDS, identity, integer, invalid, nullableIdentity, number, timestamp } from "./source-validation.js";
import type { EncodedSource, SourceHeaderInput, SourceInput } from "./source-validation.js";

import { validateCacheEvidence } from "./source-cache-validation.js";
import type { SourceCacheEvidence } from "./source-cache-validation.js";

export const MAX_METRIC_ROW_BYTES = 64 * 1024;
export const MAX_SOURCE_METRIC_BYTES = 16 * 1024 * 1024;
export const METRIC_LIMITS = Object.freeze({ turn: 4096, usage: 4096, observation: 8192, diagnostic: 8192, capabilities: 1 });
export const MAX_SOURCE_METRIC_ROWS = 24577;
export type MetricKind = keyof typeof METRIC_LIMITS;
export type MetricEvidence = Readonly<{
  turns: readonly (NormalizedTurn | ClaudeTurn)[];
  usage: readonly (UsageObservation | ClaudeUsage)[];
  observations: readonly (SourceObservation | ClaudeSourceObservation)[];
  diagnostics: readonly SafeDiagnostic[];
  capabilities: ParserCapabilities | ClaudeCapabilities;
}>;
export type SourceSnapshotInput = SourceInput & Readonly<{ evidence: MetricEvidence; cacheEvidence?: SourceCacheEvidence | null; relationshipEvidence?: RelationshipEvidence | null }>;
export type MetricRow = Readonly<{ kind: MetricKind; ordinal: number; id: string | null; json: string }>;
export type EncodedMetrics = Readonly<{ rows: readonly MetricRow[]; bytes: number; counts: Readonly<Record<MetricKind, number>> }>;
type Header = SourceHeaderInput;
const TIMING = ["source_reported", "paired_timestamps", "estimated", "unknown"] as const;
const COUNT_FIELDS = ["input", "output", "cachedInput", "cacheWriteInput", "reasoningOutput", "total"] as const;
const COUNTS_STATUS = ["complete", "partial", "invalid"] as const;
function bool(value: unknown): boolean { if (typeof value !== "boolean") invalid(); return value; }
function nullOnly(value: unknown): null { if (value !== null) invalid(); return null; }
function count(value: unknown): number | null { return value === null ? null : integer(value); }
function words<T extends string>(value: unknown, choices: readonly T[]): readonly T[] {
  const result = array(value, choices.length).map((v) => choice(v, choices));
  if (new Set(result).size !== result.length) invalid();
  return Object.freeze(result);
}
function ref(value: unknown, h: Header): ParserSourceRef {
  const v = fields(value, ["fileId", "byteOffset"]), byteOffset = integer(v["byteOffset"]);
  if (identity(v["fileId"], "source", h.keyId) !== h.sourceId || byteOffset >= h.completedOffset) invalid();
  return Object.freeze({ fileId: h.sourceId, byteOffset });
}
function counts(value: unknown, provider: Header["provider"]): TokenCounts | ClaudeCounts | null {
  if (value === null) return null;
  const v = fields(value, provider === "codex" ? COUNT_FIELDS : [...COUNT_FIELDS, "uncachedInput"]);
  const common = { input: count(v["input"]), output: count(v["output"]), cachedInput: count(v["cachedInput"]), cacheWriteInput: count(v["cacheWriteInput"]), total: count(v["total"]) };
  return Object.freeze(provider === "codex" ? { ...common, reasoningOutput: count(v["reasoningOutput"]) }
    : { ...common, uncachedInput: count(v["uncachedInput"]), reasoningOutput: nullOnly(v["reasoningOutput"]) });
}
function countSemantics(value: TokenCounts | ClaudeCounts | null, provider: Header["provider"], mapping: string, status: string): void {
  if (value === null) return; // Conflicted selections retain the original count status.
  if (status === "complete" && Object.entries(value).some(([key, n]) => n === null && !(provider === "claude" && key === "reasoningOutput"))) invalid();
  if (provider === "codex" && mapping === "unknown") { if (value.total !== null || status === "complete") invalid(); return; }
  if (value.total !== null && (value.input === null || value.output === null || !Number.isSafeInteger(value.input + value.output) || value.total !== value.input + value.output)) invalid();
  if (provider === "codex") {
    if (value.input !== null && (value.cachedInput !== null && value.cachedInput > value.input || value.cacheWriteInput !== null && value.cacheWriteInput > value.input)) invalid();
    if (value.input !== null && value.cachedInput !== null && value.cacheWriteInput !== null && (!Number.isSafeInteger(value.cachedInput + value.cacheWriteInput) || value.cachedInput + value.cacheWriteInput > value.input)) invalid();
    if (value.output !== null && value.reasoningOutput !== null && value.reasoningOutput > value.output) invalid();
  } else {
    const c = value as ClaudeCounts;
    if (c.input !== null && (c.uncachedInput === null || c.cachedInput === null || c.cacheWriteInput === null || !Number.isSafeInteger(c.uncachedInput + c.cachedInput + c.cacheWriteInput) || c.input !== c.uncachedInput + c.cachedInput + c.cacheWriteInput)) invalid();
  }
}
const TURN_FIELDS = ["id", "sessionId", "provider", "startAt", "endAt", "intervalTimingEvidence", "intervalScope", "durationMs", "timingEvidence", "durationScope", "status", "sourceRef"] as const;
export function validateTurn(value: unknown, h: Header): NormalizedTurn | ClaudeTurn {
  const v = fields(value, [...TURN_FIELDS, ...(h.provider === "codex" ? ["startTimingEvidence", "endTimingEvidence"] : ["observedAt", "selection"])]);
  if (v["provider"] !== h.provider) invalid();
  const base = { id: identity(v["id"], "turn", h.keyId), sessionId: identity(v["sessionId"], "session", h.keyId), durationMs: number(v["durationMs"]), sourceRef: ref(v["sourceRef"], h) };
  if (h.provider === "claude") {
    const result: ClaudeTurn = Object.freeze({ ...base, provider: "claude", startAt: nullOnly(v["startAt"]), endAt: nullOnly(v["endAt"]),
      observedAt: timestamp(v["observedAt"]), intervalTimingEvidence: choice(v["intervalTimingEvidence"], ["unknown"]), intervalScope: choice(v["intervalScope"], ["unknown"]),
      timingEvidence: choice(v["timingEvidence"], TIMING), durationScope: choice(v["durationScope"], ["unknown"]), status: choice(v["status"], ["unknown"]),
      selection: choice(v["selection"], ["duration_only", "invalid", "conflicted"]) });
    if (result.durationMs === null ? result.timingEvidence !== "unknown" || result.selection === "duration_only" : result.timingEvidence !== "source_reported" || result.selection !== "duration_only") invalid();
    return result;
  }
  const result: NormalizedTurn = Object.freeze({ ...base, provider: "codex", startAt: timestamp(v["startAt"]), endAt: timestamp(v["endAt"]),
    startTimingEvidence: choice(v["startTimingEvidence"], TIMING), endTimingEvidence: choice(v["endTimingEvidence"], TIMING),
    intervalTimingEvidence: choice(v["intervalTimingEvidence"], TIMING), intervalScope: choice(v["intervalScope"], ["turn_wall", "observed_turn", "unknown"]),
    timingEvidence: choice(v["timingEvidence"], TIMING), durationScope: choice(v["durationScope"], ["turn_elapsed", "unknown"]),
    status: choice(v["status"], ["completed", "cancelled", "pending", "unknown"]) });
  if (result.startAt !== null && result.endAt !== null && Date.parse(result.endAt) < Date.parse(result.startAt)) invalid();
  if (result.startAt === null && result.startTimingEvidence !== "unknown" || result.endAt === null && result.endTimingEvidence !== "unknown") invalid();
  if (result.durationMs === null ? result.timingEvidence !== "unknown" || result.durationScope !== "unknown" : result.timingEvidence !== "source_reported" || result.durationScope !== "turn_elapsed") invalid();
  if (result.intervalScope === "unknown" ? result.intervalTimingEvidence !== "unknown" : result.startAt === null || result.endAt === null || result.intervalTimingEvidence === "unknown") invalid();
  // Monotonic duration and wall endpoints are different scopes; never reconcile them.
  return result;
}
const USAGE_FIELDS = ["id", "sessionId", "turnId", "responseId", "provider", "source", "counts", "scope", "selection", "finality", "countStatus", "mapping", "limitations", "toolEventId", "phase", "sourceRef"] as const;
export function validateUsage(value: unknown, h: Header): UsageObservation | ClaudeUsage {
  const v = fields(value, h.provider === "codex" ? USAGE_FIELDS : [...USAGE_FIELDS, "stopReason", "terminalCandidate"]);
  if (v["provider"] !== h.provider) invalid();
  const base = { id: identity(v["id"], "event", h.keyId), sessionId: identity(v["sessionId"], "session", h.keyId),
    responseId: nullableIdentity(v["responseId"], "event", h.keyId), countStatus: choice(v["countStatus"], COUNTS_STATUS),
    toolEventId: nullOnly(v["toolEventId"]), phase: choice(v["phase"], ["unknown"]), sourceRef: ref(v["sourceRef"], h) };
  if (h.provider === "claude") {
    const result: ClaudeUsage = Object.freeze({ ...base, provider: "claude", turnId: nullOnly(v["turnId"]), source: choice(v["source"], ["message_usage"]), scope: choice(v["scope"], ["response_snapshot"]),
      counts: counts(v["counts"], "claude") as ClaudeCounts | null, mapping: choice(v["mapping"], ["anthropic_messages"]),
      selection: choice(v["selection"], ["provisional", "eligible", "conflicted", "invalid"]), finality: choice(v["finality"], ["unknown", "trusted_partial", "trusted_final"]),
      stopReason: v["stopReason"] === null ? null : choice(v["stopReason"], ["end_turn", "tool_use", "unknown"]), terminalCandidate: bool(v["terminalCandidate"]),
      limitations: words(v["limitations"], ["unknown_finality", "partial_counts", "invalid_counts", "missing_response_id", "ambiguous_origin", "conflict", "unknown_source_order"]) });
    if (result.terminalCandidate !== (result.stopReason === "end_turn" || result.stopReason === "tool_use")) invalid();
    if (result.selection === "eligible" && (result.finality !== "trusted_final" || result.countStatus !== "complete" || result.responseId === null || result.counts === null)) invalid();
    if (result.selection === "conflicted" && result.counts !== null) invalid();
    countSemantics(result.counts, "claude", result.mapping, result.countStatus);
    return result;
  }
  const result: UsageObservation = Object.freeze({ ...base, provider: "codex", turnId: nullableIdentity(v["turnId"], "turn", h.keyId),
    source: choice(v["source"], ["response_usage", "turn_snapshot", "thread_snapshot", "token_count_total", "token_count_last"]),
    counts: counts(v["counts"], "codex") as TokenCounts | null, scope: choice(v["scope"], ["response_increment", "turn_cumulative", "thread_cumulative", "unverified_snapshot"]),
    selection: choice(v["selection"], ["eligible", "provisional", "snapshot_only", "conflicted", "invalid"]),
    finality: choice(v["finality"], ["source_terminal", "trusted_final", "trusted_partial", "unknown"]), mapping: choice(v["mapping"], ["openai_responses", "unknown"]),
    limitations: words(v["limitations"], ["unknown_finality", "ambiguous_origin", "partial_counts", "invalid_counts", "missing_response_id", "conflict", "snapshot_only", "zero_or_source_default"]) });
  const scope = { response_usage: "response_increment", turn_snapshot: "turn_cumulative", thread_snapshot: "thread_cumulative", token_count_total: "thread_cumulative", token_count_last: "unverified_snapshot" } as const;
  if (result.scope !== scope[result.source]) invalid();
  if (result.source !== "response_usage" && (result.finality !== "unknown" || !["snapshot_only", "conflicted", "invalid"].includes(result.selection))) invalid();
  if (result.selection === "eligible" && (result.source !== "response_usage" || !["source_terminal", "trusted_final"].includes(result.finality) || result.mapping !== "openai_responses" || result.responseId === null || result.counts?.input == null || result.counts.output === null)) invalid();
  if (result.selection === "conflicted" && result.counts !== null || result.mapping === "unknown" && result.counts?.total != null) invalid();
  countSemantics(result.counts, "codex", result.mapping, result.countStatus);
  return result;
}
export function validateObservation(value: unknown, h: Header): SourceObservation | ClaudeSourceObservation {
  const timed = hasUsageTiming(h.provider, h.parserVersion);
  const v = fields(value, ["id", "eventId", "turnId", "usageId", "representation", "origin", "observedUsage", "sourceRef", ...(timed ? ["usageObservedAt"] : []), ...(h.provider === "codex" ? ["transportStatus"] : ["sessionId", "messageId", "observedResult"])]);
  const usageObservedAt = timed ? timestamp(v["usageObservedAt"]) : null;
  if (timed && v["representation"] !== "usage" && usageObservedAt !== null) invalid();
  const base = { ...(timed ? { usageObservedAt } : {}), id: identity(v["id"], "source", h.keyId), eventId: nullableIdentity(v["eventId"], "event", h.keyId), turnId: nullableIdentity(v["turnId"], "turn", h.keyId),
    usageId: nullableIdentity(v["usageId"], "event", h.keyId), origin: choice(v["origin"], ["ordinary", "ambiguous", "trusted_copied"]), sourceRef: ref(v["sourceRef"], h) };
  if (h.provider === "codex") {
    let observedUsage: SourceObservation["observedUsage"] = null;
    if (v["observedUsage"] !== null) {
      const u = fields(v["observedUsage"], ["counts", "finality", "countStatus", "mapping"]);
      observedUsage = Object.freeze({ counts: counts(u["counts"], "codex") as TokenCounts | null, finality: choice(u["finality"], ["source_terminal", "trusted_final", "trusted_partial", "unknown"]),
        countStatus: choice(u["countStatus"], COUNTS_STATUS), mapping: choice(u["mapping"], ["openai_responses", "unknown"]) });
      countSemantics(observedUsage.counts, "codex", observedUsage.mapping, observedUsage.countStatus);
    }
    return Object.freeze({ ...base, representation: choice(v["representation"], ["call", "result", "structured", "poll", "wrapper", "turn", "usage", "metadata", "provenance", "unsupported"]),
      transportStatus: choice(v["transportStatus"], ["completed", "failed", "cancelled", "pending", "unknown"]), observedUsage });
  }
  let observedUsage: ClaudeSourceObservation["observedUsage"] = null, observedResult: ClaudeSourceObservation["observedResult"] = null;
  if (v["observedUsage"] !== null) {
    const u = fields(v["observedUsage"], ["counts", "finality", "countStatus", "mapping", "stopReason"]), checked = counts(u["counts"], "claude");
    if (checked === null) invalid();
    observedUsage = Object.freeze({ counts: checked as ClaudeCounts, finality: choice(u["finality"], ["unknown", "trusted_partial", "trusted_final"]), countStatus: choice(u["countStatus"], COUNTS_STATUS),
      mapping: choice(u["mapping"], ["anthropic_messages"]), stopReason: u["stopReason"] === null ? null : choice(u["stopReason"], ["end_turn", "tool_use", "unknown"]) });
    countSemantics(observedUsage.counts, "claude", observedUsage.mapping, observedUsage.countStatus);
  }
  if (v["observedResult"] !== null) {
    const r = fields(v["observedResult"], ["isError", "completionKind", "unassignedAcknowledgement", "observedAt", "acknowledgementLatencyMs", "durationMs", "durationScope"]);
    observedResult = Object.freeze({ isError: r["isError"] === null ? null : bool(r["isError"]), completionKind: choice(r["completionKind"], ["invocation_result", "background_acknowledgement", "unknown"]),
      unassignedAcknowledgement: bool(r["unassignedAcknowledgement"]), observedAt: timestamp(r["observedAt"]), acknowledgementLatencyMs: number(r["acknowledgementLatencyMs"]), durationMs: number(r["durationMs"]),
      durationScope: choice(r["durationScope"], ["invocation_latency", "process_runtime", "item_lifecycle", "unknown"]) });
  }
  return Object.freeze({ ...base, sessionId: nullableIdentity(v["sessionId"], "session", h.keyId), messageId: nullableIdentity(v["messageId"], "event", h.keyId),
    representation: choice(v["representation"], ["call", "result", "message", "usage", "turn", "metadata", "provenance", "unsupported"]), observedUsage, observedResult });
}
export function validateCapabilities(value: unknown, h: Header): ParserCapabilities | ClaudeCapabilities {
  const v = fields(value, ["provider", "parserVersion", "support", "coverage", "observedShapes", "unsupportedRecords", "ambiguousRecords", "stateLimited", "diagnosticsDropped"]);
  if (v["provider"] !== h.provider || v["parserVersion"] !== h.parserVersion
    || !nativeVersionSupported(h.provider, h.parserVersion)) invalid();
  const base = { parserVersion: h.parserVersion as 1 | 2 | 3 | 4, support: choice(v["support"], ["shape_verified_only"]), coverage: choice(v["coverage"], ["recognized_shapes", "partial"]),
    unsupportedRecords: integer(v["unsupportedRecords"]), ambiguousRecords: integer(v["ambiguousRecords"]), stateLimited: bool(v["stateLimited"]), diagnosticsDropped: integer(v["diagnosticsDropped"]) };
  return Object.freeze(h.provider === "codex" ? { ...base, parserVersion: h.parserVersion as 1 | 2 | 3, provider: "codex", observedShapes: words(v["observedShapes"], ["command_item", "mcp_item", "function_call", "custom_call", "tool_result", "poll", "code_wrapper", "turn", "response_usage", "token_snapshot"]) }
    : { ...base, provider: "claude", observedShapes: words(v["observedShapes"], ["tool_use", "tool_result", "message_link", "message_usage", "background_acknowledgement", "turn_duration"]) });
}
export function validateDiagnostic(value: unknown, h: Header): SafeDiagnostic {
  const v = fields(value, ["code", "severity", "sourceAlias", "byteOffset"]), code = v["code"], sourceAlias = v["sourceAlias"], byteOffset = count(v["byteOffset"]);
  if (typeof code !== "string" || !Object.hasOwn(MESSAGES, code)) invalid();
  if (sourceAlias !== null && (typeof sourceAlias !== "string" || !/^source-[0-9]{1,12}$/.test(sourceAlias))) invalid();
  if (byteOffset !== null && byteOffset >= h.completedOffset) invalid();
  return Object.freeze({ code: code as DiagnosticCode, sourceAlias, byteOffset, severity: choice(v["severity"], ["info", "warning", "error"]) });
}
export const METRIC_VALIDATORS = Object.freeze({ turn: validateTurn, usage: validateUsage, observation: validateObservation, diagnostic: validateDiagnostic, capabilities: validateCapabilities });
export function metricKind(value: unknown): MetricKind { return choice(value, ["turn", "usage", "observation", "diagnostic", "capabilities"]); }
export function encodeMetrics(value: unknown, h: Header): EncodedMetrics {
  const v = fields(value, ["turns", "usage", "observations", "diagnostics", "capabilities"]);
  const sets = { turn: array(v["turns"], METRIC_LIMITS.turn), usage: array(v["usage"], METRIC_LIMITS.usage), observation: array(v["observations"], METRIC_LIMITS.observation), diagnostic: array(v["diagnostics"], METRIC_LIMITS.diagnostic), capabilities: [v["capabilities"]] };
  const rows: MetricRow[] = [], counts = { turn: 0, usage: 0, observation: 0, diagnostic: 0, capabilities: 0 };
  let bytes = 0;
  for (const kind of Object.keys(sets) as MetricKind[]) {
    const seen = new Set<string>();
    for (const raw of sets[kind]) {
      const item = METRIC_VALIDATORS[kind](raw, h), id = "id" in item ? item.id : null;
      if (id !== null) { if (seen.has(id)) invalid(); seen.add(id); }
      const json = JSON.stringify(item), size = Buffer.byteLength(json);
      if (size > MAX_METRIC_ROW_BYTES || bytes + size > MAX_SOURCE_METRIC_BYTES) throw new SafeError("STATE_LIMIT");
      bytes += size; rows.push({ kind, ordinal: counts[kind]++, id, json });
    }
  }
  return { rows, bytes, counts };
}
export function encodeSourceSnapshot(value: unknown, keyId: string): EncodedSource & Readonly<{ metrics: EncodedMetrics; cacheEvidence: SourceCacheEvidence | null; relationships: EncodedRelationships | null }> {
  const hasCache = value !== null && typeof value === "object" && Object.hasOwn(value, "cacheEvidence");
  const hasRelationships = value !== null && typeof value === "object" && Object.hasOwn(value, "relationshipEvidence");
  const v = fields(value, [...HEADER_FIELDS, "events", "evidence", ...(hasCache ? ["cacheEvidence"] : []), ...(hasRelationships ? ["relationshipEvidence"] : [])]), source: Record<string, unknown> = {};
  for (const key of [...HEADER_FIELDS, "events"]) source[key] = v[key];
  const encoded = encodeSource(source, keyId);
  return { ...encoded, metrics: encodeMetrics(v["evidence"], encoded.header), relationships: encodeRelationships(v["relationshipEvidence"], encoded.header), cacheEvidence: !hasCache || v["cacheEvidence"] === null ? null : validateCacheEvidence(v["cacheEvidence"], keyId) };
}
