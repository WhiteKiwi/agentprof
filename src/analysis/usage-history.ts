import type { StoredSource, MetricEvidence } from "../db/source-store.js";
import { hasUsageTiming, nativeVersionSupported } from "../parsers/capture.js";
import { summarizeSource } from "./source-summary.js";
import { HISTORY_LIMITS, HistoryQueryError, historyOffsetLabel, validateHistoryQuery } from "./history-query.js";
import type { HistoryQuery } from "./history-query.js";

type Usage = MetricEvidence["usage"][number];
type Observation = MetricEvidence["observations"][number];
export const USAGE_HISTORY_LIMITS = Object.freeze({ sources: 16, usageCopies: 16_384, observationCopies: 32_768, responses: 4096, jsonBytes: 8 * 1024 * 1024 });
export const USAGE_TOKEN_FIELDS = ["input", "output", "total", "cachedInput", "cacheWriteInput", "reasoningOutput", "uncachedInput"] as const;
export type UsageTokenField = typeof USAGE_TOKEN_FIELDS[number];
type Counts = Readonly<Record<UsageTokenField, number | null>>;
export type UsageDisposition = "final" | "provisional";
export type UsageExclusion = "source_suppressed" | "session_filter" | "cumulative_snapshot" | "unverified_snapshot" | "non_response_usage"
  | "missing_response_id" | "response_conflict" | "invalid" | "conflicted" | "unverified_selection" | "unverified_mapping"
  | "ambiguous_origin" | "missing_usage_proof" | "terminal_observation_conflict";
export type UsageSourceReceipt = Readonly<{
  sourceId: string; provider: Usage["provider"]; revision: number; parserVersion: number;
  completedOffset: number; observedSize: number; availability: StoredSource["availability"];
  timingCapture: boolean; parserCoverage: MetricEvidence["capabilities"]["coverage"] | null; unsupportedRecords: number | null; suppressionReason: string | null; usageRows: number | null; observationRows: number | null;
}>;
export type UsageCopyReceipt = Readonly<{ sourceId: string; usageId: string; observationIds: readonly string[] }>;
export type UsageResponseReceipt = Readonly<{
  ref: string; provider: Usage["provider"]; sessionId: string; responseId: string;
  selection: UsageDisposition | null; countStatus: Usage["countStatus"]; mapping: Usage["mapping"]; finality: Usage["finality"];
  state: "dated" | "undated" | "outside_window" | "excluded"; reason: UsageExclusion | null;
  observedAt: string | null; date: string | null; matchingObservationN: number; missingTimestampN: number;
  counts: Counts | null; copies: readonly UsageCopyReceipt[];
}>;
export type UsageDay = Readonly<{
  date: string; provider: Usage["provider"]; sessionId: string; selection: UsageDisposition;
  mapping: Usage["mapping"]; finality: Usage["finality"]; responseN: number;
  responseRefs: readonly string[]; counts: Counts; overflowComponents: readonly UsageTokenField[];
}>;
export type SelectedUsageHistory = Readonly<{
  schema: "agentprof.selected-usage-history/v1"; assessment: "available" | "partial" | "not_evaluable";
  query: Readonly<{ startInclusive: string; endExclusive: string; offset: string; sessionId: string | null }>;
  timeBasis: "earliest_known_matching_record_timestamp"; fullHistory: false; sourceFreshnessChecked: false;
  finalAndProvisionalCombined: false; billedUsageClaim: false;
  sources: readonly UsageSourceReceipt[]; responses: readonly UsageResponseReceipt[]; days: readonly UsageDay[];
  inventory: Readonly<{ usageCopies: number; observationCopies: number; responseGroups: number; duplicateCopies: number;
    excludedCopies: number; datedFinalResponses: number; datedProvisionalResponses: number; undatedResponses: number;
    outsideWindowResponses: number; exclusions: Readonly<Record<UsageExclusion, number>> }>;
  limitations: readonly string[];
}>;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const v of Object.values(value)) freeze(v); Object.freeze(value); }
  return value;
}
function components(c: NonNullable<Usage["counts"]>): Counts {
  return Object.fromEntries(USAGE_TOKEN_FIELDS.map(k => [k, k === "uncachedInput" ? "uncachedInput" in c ? c.uncachedInput : null : c[k]])) as Counts;
}
function payload(u: Usage): string {
  const counts = u.counts === null ? null : components(u.counts);
  return JSON.stringify([u.provider, u.sessionId, u.responseId, u.turnId, u.source, u.scope, u.selection, u.finality,
    u.mapping, u.countStatus, counts === null ? null : USAGE_TOKEN_FIELDS.map(k => counts[k]),
    [...u.limitations].sort(compare), "stopReason" in u ? u.stopReason : null, "terminalCandidate" in u ? u.terminalCandidate : null]);
}
function selection(u: Usage, finalEligible: boolean): UsageDisposition | UsageExclusion {
  if (u.selection === "invalid" || u.countStatus === "invalid") return "invalid";
  if (u.selection === "conflicted") return "conflicted";
  if (u.limitations.includes("ambiguous_origin")) return "ambiguous_origin";
  if (u.counts === null) return "invalid";
  if (u.mapping !== (u.provider === "codex" ? "openai_responses" : "anthropic_messages")) return "unverified_mapping";
  if (u.selection === "eligible" && finalEligible) return "final";
  if (u.selection === "provisional") return "provisional";
  return "unverified_selection";
}
function isResponse(u: Usage): UsageExclusion | null {
  if (u.scope === "turn_cumulative" || u.scope === "thread_cumulative") return "cumulative_snapshot";
  if (u.scope === "unverified_snapshot") return "unverified_snapshot";
  if (u.provider === "codex" ? u.source !== "response_usage" || u.scope !== "response_increment"
    : u.source !== "message_usage" || u.scope !== "response_snapshot") return "non_response_usage";
  return u.responseId === null ? "missing_response_id" : null;
}
function sameUsageObservation(u: Usage, o: Observation): boolean {
  const v = o.observedUsage;
  if (v === null || v.counts === null || u.counts === null) return false;
  const observed = components(v.counts), selected = components(u.counts);
  return v.mapping === u.mapping && v.finality === u.finality
    && v.countStatus === u.countStatus && USAGE_TOKEN_FIELDS.every(k => observed[k] === selected[k])
    && (!("stopReason" in u) || "stopReason" in v && v.stopReason === u.stopReason);
}
function dateable(at: string | null | undefined): at is string {
  return typeof at === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(at)
    && at >= "0001-01-01T00:00:00.000Z" && at <= "9999-12-31T23:59:59.999Z"
    && Number.isSafeInteger(Date.parse(at)) && new Date(at).toISOString() === at;
}
type Copy = { sourceId: string; u: Usage; eligible: boolean; observations: readonly Observation[] };

/** Internal API: inputs must be validated, same-key readSource results from one pinned transaction. */
export function analyzeUsageHistory(sources: readonly StoredSource[], query: HistoryQuery): SelectedUsageHistory {
  validateHistoryQuery(query);
  if (!Array.isArray(sources) || sources.length < 1 || sources.length > USAGE_HISTORY_LIMITS.sources
    || new Set(sources.map(s => s.sourceId)).size !== sources.length || new Set(sources.map(s => s.keyId)).size !== 1) throw new HistoryQueryError();
  let usageCopies = 0, observationCopies = 0, eventCopies = 0;
  for (const s of sources) {
    usageCopies += s.evidence?.usage.length ?? 0; observationCopies += s.evidence?.observations.length ?? 0; eventCopies += s.events.length;
    if (usageCopies > USAGE_HISTORY_LIMITS.usageCopies || observationCopies > USAGE_HISTORY_LIMITS.observationCopies || eventCopies > HISTORY_LIMITS.eventCopies) throw new HistoryQueryError();
  }
  const exclusions: Record<UsageExclusion, number> = { source_suppressed: 0, session_filter: 0, cumulative_snapshot: 0, unverified_snapshot: 0,
    non_response_usage: 0, missing_response_id: 0, response_conflict: 0, invalid: 0, conflicted: 0, unverified_selection: 0,
    unverified_mapping: 0, ambiguous_origin: 0, missing_usage_proof: 0, terminal_observation_conflict: 0 };
  const receipts: UsageSourceReceipt[] = [], groups = new Map<string, Copy[]>();
  let excludedCopies = 0;
  const exclude = (reason: UsageExclusion, n: number) => { exclusions[reason] += n; excludedCopies += n; };
  for (const s of [...sources].sort((a, b) => compare(a.sourceId, b.sourceId))) {
    const summary = summarizeSource(s), e = s.evidence;
    const suppression = summary.suppressionReason ?? (!nativeVersionSupported(s.provider, s.parserVersion)
      || e?.capabilities.provider !== s.provider || e.capabilities.parserVersion !== s.parserVersion ? "unsupported_contract" : null);
    receipts.push({ sourceId: s.sourceId, provider: s.provider, revision: s.revision, parserVersion: s.parserVersion,
      completedOffset: s.completedOffset, observedSize: s.observedSize, availability: s.availability,
      timingCapture: hasUsageTiming(s.provider, s.parserVersion), parserCoverage: e?.capabilities.coverage ?? null, unsupportedRecords: e?.capabilities.unsupportedRecords ?? null, suppressionReason: suppression,
      usageRows: e?.usage.length ?? null, observationRows: e?.observations.length ?? null });
    if (suppression !== null) { exclude("source_suppressed", e?.usage.length ?? 0); continue; }
    const eligible = new Set(summary.usage?.flatMap(c => c.usageIds) ?? []);
    const observations = new Map<string, Observation[]>();
    for (const o of e!.observations) if (o.representation === "usage" && o.usageId !== null) {
      const list = observations.get(o.usageId); if (list) list.push(o); else observations.set(o.usageId, [o]);
    }
    for (const u of e!.usage) {
      if (query.sessionId !== null && u.sessionId !== query.sessionId) { exclude("session_filter", 1); continue; }
      const reason = isResponse(u);
      if (reason !== null) { exclude(reason, 1); continue; }
      const key = JSON.stringify([u.provider, u.sessionId, u.responseId]);
      const copy: Copy = { sourceId: s.sourceId, u, eligible: eligible.has(u.id), observations: observations.get(u.id) ?? [] };
      const list = groups.get(key);
      if (list) list.push(copy);
      else { if (groups.size >= USAGE_HISTORY_LIMITS.responses) throw new HistoryQueryError(); groups.set(key, [copy]); }
    }
  }
  const responses: UsageResponseReceipt[] = [], partitions = new Map<string, UsageResponseReceipt[]>();
  let duplicateCopies = 0, datedFinalResponses = 0, datedProvisionalResponses = 0, undatedResponses = 0, outsideWindowResponses = 0;
  for (const [, unsorted] of [...groups].sort(([a], [b]) => compare(a, b))) {
    const copies = [...unsorted].sort((a, b) => compare(a.sourceId, b.sourceId) || compare(a.u.id, b.u.id)), first = copies[0]!.u;
    const ref = `response-${responses.length + 1}`;
    let reason: UsageExclusion | null = new Set(copies.map(c => payload(c.u))).size > 1 ? "response_conflict" : null;
    const disposition = selection(first, copies.some(c => c.eligible));
    if (reason === null && disposition !== "final" && disposition !== "provisional") reason = disposition;
    const matched: Observation[] = [];
    if (reason === null) {
      for (const copy of copies) for (const o of copy.observations) {
        if (o.origin !== "ordinary") continue;
        if (sameUsageObservation(copy.u, o)) matched.push(o);
        else if (o.observedUsage && ["source_terminal", "trusted_final"].includes(o.observedUsage.finality)) reason = "terminal_observation_conflict";
      }
      if (!matched.length && reason === null) reason = "missing_usage_proof";
    }
    const times = matched.map(o => o.usageObservedAt).filter(dateable).sort(compare), observedAt = times[0] ?? null;
    const selected = reason === null && (disposition === "final" || disposition === "provisional") ? disposition : null;
    const ms = observedAt === null ? null : Date.parse(observedAt);
    const state = reason !== null ? "excluded" : ms === null ? "undated" : ms < query.startMs || ms >= query.endMs ? "outside_window" : "dated";
    // Calendar offset is applied only in-range; validateHistoryQuery bounds shifted endpoints.
    const date = state === "dated" ? new Date(ms! + query.offsetMinutes * 60_000).toISOString().slice(0, 10) : null;
    const receipt: UsageResponseReceipt = { ref, provider: first.provider, sessionId: first.sessionId, responseId: first.responseId!,
      selection: selected, countStatus: first.countStatus, mapping: first.mapping, finality: first.finality, state, reason, observedAt: reason === null ? observedAt : null, date,
      matchingObservationN: matched.length, missingTimestampN: matched.length - times.length,
      counts: reason === null && first.counts !== null ? components(first.counts) : null,
      copies: copies.map(c => ({ sourceId: c.sourceId, usageId: c.u.id, observationIds: c.observations.map(o => o.id).sort(compare) })) };
    responses.push(receipt);
    if (reason !== null) { exclude(reason, copies.length); continue; }
    duplicateCopies += copies.length - 1;
    if (state === "undated") { undatedResponses++; continue; }
    if (state === "outside_window") { outsideWindowResponses++; continue; }
    if (selected === "final") datedFinalResponses++; else datedProvisionalResponses++;
    const key = JSON.stringify([date, receipt.provider, receipt.sessionId, selected, receipt.mapping, receipt.finality]);
    const list = partitions.get(key); if (list) list.push(receipt); else partitions.set(key, [receipt]);
  }
  const days: UsageDay[] = [...partitions].sort(([a], [b]) => compare(a, b)).map(([, rows]) => {
    const first = rows[0]!, overflowComponents: UsageTokenField[] = [];
    const counts = Object.fromEntries(USAGE_TOKEN_FIELDS.map(k => {
      let total = 0;
      for (const r of rows) {
        const n = r.counts![k];
        if (n === null) return [k, null];
        if (!Number.isSafeInteger(n) || n < 0 || n > Number.MAX_SAFE_INTEGER - total) { overflowComponents.push(k); return [k, null]; }
        total += n;
      }
      return [k, total];
    })) as Counts;
    return { date: first.date!, provider: first.provider, sessionId: first.sessionId, selection: first.selection!,
      mapping: first.mapping, finality: first.finality, responseN: rows.length, responseRefs: rows.map(r => r.ref), counts, overflowComponents };
  });
  const assessment = !days.length ? "not_evaluable" : excludedCopies > 0 || undatedResponses > 0 || datedProvisionalResponses > 0
    || receipts.some(s => s.suppressionReason !== null || s.parserCoverage === "partial") || days.some(d => d.overflowComponents.length > 0)
    || responses.some(r => r.missingTimestampN > 0 || r.countStatus === "partial") ? "partial" : "available";
  return freeze({ schema: "agentprof.selected-usage-history/v1", assessment,
    query: { startInclusive: new Date(query.startMs).toISOString(), endExclusive: new Date(query.endMs).toISOString(), offset: historyOffsetLabel(query.offsetMinutes), sessionId: query.sessionId },
    timeBasis: "earliest_known_matching_record_timestamp", fullHistory: false, sourceFreshnessChecked: false,
    finalAndProvisionalCombined: false, billedUsageClaim: false, sources: receipts, responses, days,
    inventory: { usageCopies, observationCopies, responseGroups: groups.size, duplicateCopies, excludedCopies, datedFinalResponses,
      datedProvisionalResponses, undatedResponses, outsideWindowResponses, exclusions },
    limitations: ["Explicit stored source prefixes only; no full-history or input freshness check.",
      "Days use the earliest known ordinary record timestamp matching each selected response; not billing dates or response completion times.",
      "Final-eligible and provisional-response partitions are never combined. Provisional responses are unverified observations, not final token usage.",
      "Cumulative and unverified snapshots are excluded, never summed or differenced into response increments.",
      "Equal response copies count once; conflicting evidence is withheld, not resolved using recency or a maximum.",
      "Missing timestamps have no day. Empty periods are not proof of zero activity; unobserved days are not zero-filled.",
      "Cache-read/write and reasoning counts are components under provider mappings, not additions to total tokens.",
      "No tool/phase attribution, monetary cost, billed-usage, avoidability or savings claim."] });
}
