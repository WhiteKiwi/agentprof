import type { StoredSource, MetricEvidence } from "../db/source-store.js";
import type { NormalizedEvent } from "../normalize/types.js";

type Usage = MetricEvidence["usage"][number];
type Capabilities = MetricEvidence["capabilities"];
type Counts<K extends string> = Readonly<Record<K, number>>;
type Suppression = "source_unavailable" | "evidence_absent" | "state_limited" | "ambiguous_origin" | null;
type DurationReason = "source_suppressed" | "cancelled" | "pending" | "unknown_status" | "missing_duration" | "invalid_duration" | "unknown_scope" | "estimated_timing" | "unknown_timing";
type UsageReason = "source_suppressed" | "cumulative_snapshot" | "unverified_snapshot" | "non_response_usage" | "duplicate_response_conflict" | "invalid" | "conflicted" | "provisional" | "snapshot_only" | "unverified_finality" | "missing_response_id" | "incomplete_components" | "unverified_mapping";
type TokenField = "input" | "output" | "total" | "cachedInput" | "cacheWriteInput" | "reasoningOutput" | "uncachedInput";
export type DurationCohort = Readonly<{
  sessionId: string; category: NormalizedEvent["category"]; toolName: string | null; commandPattern: string | null;
  durationScope: NormalizedEvent["durationScope"]; timingEvidence: NormalizedEvent["timingEvidence"];
  n: number; sumMs: number | null; meanMs: number | null; maxMs: number; p50Ms: number; p95Ms: number;
  lowSampleP95: boolean; eventIds: readonly string[]; limitations: readonly "numeric_overflow"[];
}>;
export type UsageCohort = Readonly<{
  sessionId: string; provider: Usage["provider"]; mapping: Usage["mapping"]; finality: Usage["finality"];
  observedResponses: number; usageIds: readonly string[]; counts: Readonly<Record<TokenField, number | null>>;
  overflowComponents: readonly TokenField[]; limitations: readonly (Usage["limitations"][number] | "numeric_overflow")[];
}>;
export type SourceSummary = Readonly<{
  schema: "agentprof.source-summary/v1"; scope: "source_prefix";
  sourceId: string; provider: StoredSource["provider"]; revision: number; completedOffset: number; observedSize: number;
  persistedScope: StoredSource["persistedScope"]; availability: StoredSource["availability"];
  crossSourceReconciled: false; aggregationReady: false; parserResumeReady: false;
  capabilities: Capabilities | null; suppressionReason: Suppression;
  limitations: readonly ("source_local_only" | "observed_eligible_subset" | "no_usage_population_denominator" | "no_interval_aggregation" | "partial_shape_coverage")[];
  inventory: Readonly<{
    events: number; turns: number | null; usage: number | null; observations: number | null; diagnostics: number | null;
    eventStatuses: Counts<NormalizedEvent["status"]>; eventOutcomes: Counts<NormalizedEvent["executionOutcome"]>;
    usageSelections: Counts<Usage["selection"]> | null; usageFinalities: Counts<Usage["finality"]> | null;
  }>;
  durationEligibility: Readonly<{ terminalCandidates: number; included: number; exclusions: Counts<DurationReason> }>;
  usageEligibility: Readonly<{ observedResponses: number; selectedRows: number; deduplicatedRows: number; excludedRows: number; excludedResponseGroups: number; exclusions: Counts<UsageReason> }> | null;
  durations: readonly DurationCohort[] | null; usage: readonly UsageCohort[] | null;
}>;
const TOKEN_FIELDS: readonly TokenField[] = ["input", "output", "total", "cachedInput", "cacheWriteInput", "reasoningOutput", "uncachedInput"];
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const validNumber = (n: number | null): n is number => n !== null && Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER;
const validCount = (n: number | null): n is number => validNumber(n) && Number.isSafeInteger(n);
// Freeze only newly constructed output, never objects borrowed from the input.
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function checkedSum(values: readonly number[]): number | null {
  let result = 0;
  for (const n of values) {
    if (!validNumber(n) || n > Number.MAX_SAFE_INTEGER - result) return null;
    result += n;
    if (!validNumber(result)) return null;
  }
  return result;
}
function durationReason(e: NormalizedEvent): DurationReason | null {
  if (e.status === "pending" || e.status === "cancelled") return e.status;
  if (e.status !== "completed" && e.status !== "failed") return "unknown_status";
  if (e.durationMs === null) return "missing_duration";
  if (!validNumber(e.durationMs)) return "invalid_duration";
  if (e.durationScope === "unknown") return "unknown_scope";
  if (e.timingEvidence === "estimated") return "estimated_timing";
  if (e.timingEvidence !== "source_reported" && e.timingEvidence !== "paired_timestamps") return "unknown_timing";
  return null;
}
function durationKey(e: NormalizedEvent): string {
  return JSON.stringify([e.sessionId, e.category, e.toolName, e.commandPattern, e.durationScope, e.timingEvidence]);
}
function usageKey(u: Usage): string { return JSON.stringify([u.sessionId, u.provider, u.mapping, u.finality]); }
function snapshotReason(u: Usage): UsageReason | null {
  if (u.scope === "turn_cumulative" || u.scope === "thread_cumulative") return "cumulative_snapshot";
  if (u.scope === "unverified_snapshot") return "unverified_snapshot";
  if (u.provider === "codex" ? u.scope !== "response_increment" || u.source !== "response_usage" : u.scope !== "response_snapshot" || u.source !== "message_usage") return "non_response_usage";
  return null;
}
function usageReason(u: Usage): UsageReason | null {
  if (u.selection !== "eligible") return u.selection;
  if (u.finality !== "source_terminal" && u.finality !== "trusted_final") return "unverified_finality";
  if (u.responseId === null) return "missing_response_id";
  if (u.mapping !== (u.provider === "codex" ? "openai_responses" : "anthropic_messages")) return "unverified_mapping";
  if (u.countStatus !== "complete" || u.counts === null || !validCount(u.counts.input) || !validCount(u.counts.output) || !validCount(u.counts.total)) return "incomplete_components";
  return null;
}
// Field order is explicit so equivalent objects do not depend on property insertion order.
// Compare every semantic field, excluding only row ID and sourceRef. Limitations are a set.
function responsePayload(u: Usage): string {
  return JSON.stringify([u.sessionId, u.provider, u.responseId, u.turnId, u.source, u.scope, u.selection, u.finality, u.countStatus, u.mapping,
    u.counts === null ? null : TOKEN_FIELDS.map((key) => key === "uncachedInput" ? ("uncachedInput" in u.counts! ? u.counts.uncachedInput : null) : u.counts![key]),
    [...u.limitations].sort(compare), u.toolEventId, u.phase, "stopReason" in u ? u.stopReason : null, "terminalCandidate" in u ? u.terminalCandidate : null]);
}

/** Internal only: consume one validated createSourceStore(...).readSource result.
 * Not a validator for arbitrary JSON/objects. No I/O and no cross-source combining API.
 */
export function summarizeSource(source: StoredSource): SourceSummary {
  const evidence = source.evidence;
  // Defensive hard caps; callers cannot raise the persisted readSource ceilings.
  if (source.events.length > 4096 || evidence !== null && (evidence.turns.length > 4096 || evidence.usage.length > 4096 || evidence.observations.length > 8192 || evidence.diagnostics.length > 8192)) {
    throw new RangeError("source_summary_limit_exceeded");
  }
  const capabilities = evidence === null ? null : { ...evidence.capabilities, observedShapes: [...evidence.capabilities.observedShapes] } as Capabilities;
  const suppressionReason: Suppression = source.availability !== "available" ? "source_unavailable" : evidence === null ? "evidence_absent"
    : evidence.capabilities.stateLimited || evidence.capabilities.diagnosticsDropped > 0 ? "state_limited"
    : evidence.capabilities.ambiguousRecords > 0 || evidence.observations.some((o) => o.origin === "ambiguous") ? "ambiguous_origin" : null;
  const eventStatuses = { completed: 0, failed: 0, cancelled: 0, pending: 0, unknown: 0 };
  const eventOutcomes = { success: 0, no_match: 0, change_detected: 0, error: 0, unknown: 0 };
  const usageSelections = { eligible: 0, provisional: 0, snapshot_only: 0, conflicted: 0, invalid: 0 };
  const usageFinalities = { source_terminal: 0, trusted_final: 0, trusted_partial: 0, unknown: 0 };
  const durationEligibility = { terminalCandidates: 0, included: 0, exclusions: { source_suppressed: 0, cancelled: 0, pending: 0, unknown_status: 0, missing_duration: 0, invalid_duration: 0, unknown_scope: 0, estimated_timing: 0, unknown_timing: 0 } };
  const usageEligibility = { observedResponses: 0, selectedRows: 0, deduplicatedRows: 0, excludedRows: 0, excludedResponseGroups: 0,
    exclusions: { source_suppressed: 0, cumulative_snapshot: 0, unverified_snapshot: 0, non_response_usage: 0, duplicate_response_conflict: 0, invalid: 0, conflicted: 0, provisional: 0, snapshot_only: 0, unverified_finality: 0, missing_response_id: 0, incomplete_components: 0, unverified_mapping: 0 } };
  const durationGroups = new Map<string, NormalizedEvent[]>();
  for (const event of source.events) {
    eventStatuses[event.status]++; eventOutcomes[event.executionOutcome]++;
    if (event.status === "completed" || event.status === "failed") durationEligibility.terminalCandidates++;
    const reason = suppressionReason === null ? durationReason(event) : "source_suppressed";
    if (reason !== null) { durationEligibility.exclusions[reason]++; continue; }
    durationEligibility.included++;
    const key = durationKey(event), group = durationGroups.get(key);
    if (group) group.push(event); else durationGroups.set(key, [event]);
  }
  const durations: DurationCohort[] = [...durationGroups].sort(([a], [b]) => compare(a, b)).map(([, rows]) => {
    const ordered = [...rows].sort((a, b) => a.durationMs! - b.durationMs! || compare(a.id, b.id));
    const first = ordered[0]!, n = ordered.length, sumMs = checkedSum(ordered.map((r) => r.durationMs!));
    return { sessionId: first.sessionId, category: first.category, toolName: first.toolName, commandPattern: first.commandPattern,
      durationScope: first.durationScope, timingEvidence: first.timingEvidence, n, sumMs, meanMs: sumMs === null ? null : sumMs / n,
      maxMs: ordered[n - 1]!.durationMs!, p50Ms: ordered[Math.ceil(0.5 * n) - 1]!.durationMs!, p95Ms: ordered[Math.ceil(0.95 * n) - 1]!.durationMs!,
      lowSampleP95: n < 20, eventIds: rows.map((r) => r.id).sort(compare), limitations: sumMs === null ? ["numeric_overflow"] : [] };
  });
  const responses = new Map<string, { payload: string; rows: Usage[]; conflict: boolean }>();
  const usageGroups = new Map<string, Usage[]>();
  const exclude = (reason: UsageReason, count: number) => { usageEligibility.exclusions[reason] += count; usageEligibility.excludedRows += count; };
  const select = (u: Usage) => {
    const reason = usageReason(u);
    if (reason !== null) { exclude(reason, 1); return; }
    usageEligibility.observedResponses++; usageEligibility.selectedRows++;
    const key = usageKey(u), group = usageGroups.get(key);
    if (group) group.push(u); else usageGroups.set(key, [u]);
  };
  for (const row of evidence?.usage ?? []) {
    usageSelections[row.selection]++; usageFinalities[row.finality]++;
    const reason = suppressionReason !== null ? "source_suppressed" : snapshotReason(row);
    if (reason !== null) { exclude(reason, 1); continue; }
    if (row.responseId === null) { select(row); continue; }
    const key = JSON.stringify([row.provider, row.sessionId, row.responseId]), payload = responsePayload(row), group = responses.get(key);
    if (group) { group.rows.push(row); if (group.payload !== payload) group.conflict = true; }
    else responses.set(key, { payload, rows: [row], conflict: false });
  }
  for (const { rows, conflict } of responses.values()) {
    if (conflict) { usageEligibility.excludedResponseGroups++; exclude("duplicate_response_conflict", rows.length); }
    else { usageEligibility.deduplicatedRows += rows.length - 1; select(rows.reduce((a, b) => compare(a.id, b.id) <= 0 ? a : b)); }
  }
  const usage: UsageCohort[] = [...usageGroups].sort(([a], [b]) => compare(a, b)).map(([, rows]) => {
    rows.sort((a, b) => compare(a.id, b.id));
    const first = rows[0]!, overflowComponents: TokenField[] = [];
    const counts = Object.fromEntries(TOKEN_FIELDS.map((key) => {
      const values = rows.map((u) => key === "uncachedInput" ? (u.counts !== null && "uncachedInput" in u.counts ? u.counts.uncachedInput : null) : u.counts![key]);
      if (!values.every(validCount)) return [key, null];
      const sum = checkedSum(values); if (sum === null) overflowComponents.push(key);
      return [key, sum];
    })) as Record<TokenField, number | null>;
    const limitations: (Usage["limitations"][number] | "numeric_overflow")[] = [...new Set(rows.flatMap((u) => [...u.limitations]))];
    if (overflowComponents.length) limitations.push("numeric_overflow");
    return { sessionId: first.sessionId, provider: first.provider, mapping: first.mapping, finality: first.finality,
      observedResponses: rows.length, usageIds: rows.map((u) => u.id), counts, overflowComponents, limitations: limitations.sort(compare) };
  });
  return freeze({ schema: "agentprof.source-summary/v1", scope: "source_prefix", sourceId: source.sourceId, provider: source.provider,
    revision: source.revision, completedOffset: source.completedOffset, observedSize: source.observedSize, persistedScope: source.persistedScope, availability: source.availability,
    crossSourceReconciled: false, aggregationReady: false, parserResumeReady: false, capabilities, suppressionReason,
    limitations: ["source_local_only", "observed_eligible_subset", "no_usage_population_denominator", "no_interval_aggregation", ...(capabilities?.coverage === "partial" ? ["partial_shape_coverage" as const] : [])],
    inventory: { events: source.events.length, turns: evidence?.turns.length ?? null, usage: evidence?.usage.length ?? null, observations: evidence?.observations.length ?? null, diagnostics: evidence?.diagnostics.length ?? null,
      eventStatuses, eventOutcomes, usageSelections: evidence === null ? null : usageSelections, usageFinalities: evidence === null ? null : usageFinalities },
    durationEligibility, usageEligibility: evidence === null ? null : usageEligibility,
    durations: durations.length ? durations : null, usage: usage.length ? usage : null });
}
