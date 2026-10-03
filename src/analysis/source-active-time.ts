import type { StoredSource } from "../db/source-store.js";
import type { NormalizedTurn, SourceObservation } from "../parsers/types.js";
import { summarizeSource } from "./source-summary.js";
import type { SourceSummary } from "./source-summary.js";

type IntervalScope = "turn_wall" | "observed_turn";
type IntervalEvidence = "source_reported" | "paired_timestamps";
type Exclusion = "unsupportedProvider" | "pending" | "unknownStatus" | "missingBoundaries" | "unknownInterval" | "estimatedTiming" | "inconsistentInterval" | "invalidBoundaries" | "missingTerminalProof" | "contradictoryTerminalProof" | "missingPendingProof";
type ArithmeticReason = "numeric_overflow" | null;
export type ActiveTurnEvidence = Readonly<{
  turnId: string; status: "completed" | "cancelled"; startAt: string; endAt: string; evidenceObservationIds: readonly string[];
}>;
export type ActiveTimePartition = Readonly<{
  id: string; sessionId: string; intervalScope: IntervalScope; intervalTimingEvidence: IntervalEvidence;
  turnN: number; activeTimeMs: number | null; activeTimeReason: ArithmeticReason;
  observedSpanMs: number | null; observedSpanReason: ArithmeticReason;
  turnIds: readonly string[]; turnEvidence: readonly ActiveTurnEvidence[];
}>;
type Metadata = Pick<SourceSummary, "sourceId" | "provider" | "revision" | "completedOffset" | "observedSize" | "availability" | "persistedScope" | "crossSourceReconciled" | "aggregationReady" | "parserResumeReady" | "capabilities" | "suppressionReason" | "inventory">;
export type SourceActiveTimeAnalysis = Readonly<Metadata & {
  schema: "agentprof.source-active-time/v1"; scope: "source_prefix"; metric: "active_time"; version: "codex-positioned-turn-v1";
  parserVersion: number; normalizationVersion: number; keyVersion: number; sourceFreshnessChecked: false;
  observationWindow: Readonly<{ unit: "source_bytes"; startInclusive: 0; endExclusive: number }>; queryPeriod: null;
  assessment: "evaluated" | "partial" | "unavailable" | "no_eligible_turns";
  activeTimeAssessmentReason: SourceSummary["suppressionReason"] | "unsupported_provider" | "unsupported_parser_contract" | "no_supported_turn_intervals" | "partial_shape_coverage" | "excluded_turns";
  summary: Readonly<{ eligibleTurns: number | null; excludedTurns: number | null; partitions: number | null }>;
  exclusions: Readonly<Record<Exclusion, number>> | null;
  excludedTurnEvidence: readonly Readonly<{ turnId: string; reason: Exclusion }>[] | null;
  partitions: readonly ActiveTimePartition[] | null; limitations: readonly string[];
}>;

const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function union(rows: readonly Readonly<{ start: number; end: number }>[]): number | null {
  if (!rows.length) return 0;
  const sorted = [...rows].sort((a, b) => a.start - b.start || a.end - b.end);
  let start = sorted[0]!.start, end = sorted[0]!.end, total = 0;
  const accumulate = (): boolean => {
    const length = end - start;
    if (!Number.isSafeInteger(length) || length < 0 || length > Number.MAX_SAFE_INTEGER - total) return false;
    total += length; return Number.isSafeInteger(total);
  };
  for (const row of sorted.slice(1)) {
    if (row.start <= end) { end = Math.max(end, row.end); continue; }
    if (!accumulate()) return null; start = row.start; end = row.end;
  }
  return accumulate() ? total : null;
}
function intervalReason(turn: NormalizedTurn): Exclusion | null {
  if (turn.provider !== "codex") return "unsupportedProvider";
  if (turn.status === "pending") return "pending";
  if (turn.status !== "completed" && turn.status !== "cancelled") return "unknownStatus";
  if (turn.startAt === null || turn.endAt === null) return "missingBoundaries";
  if ([turn.startTimingEvidence, turn.endTimingEvidence, turn.intervalTimingEvidence].includes("estimated")) return "estimatedTiming";
  if (turn.intervalScope === "unknown" || turn.intervalTimingEvidence === "unknown") return "unknownInterval";
  const expected = turn.intervalScope === "turn_wall" ? "source_reported" : turn.intervalScope === "observed_turn" ? "paired_timestamps" : null;
  if (expected === null || turn.intervalTimingEvidence !== expected || turn.startTimingEvidence !== expected || turn.endTimingEvidence !== expected) return "inconsistentInterval";
  const start = Date.parse(turn.startAt), end = Date.parse(turn.endAt);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return "invalidBoundaries";
  return null;
}
function proof(turn: NormalizedTurn, observations: readonly SourceObservation[], sourceId: string): { reason: Exclusion | null; ids: string[] } {
  const turns = observations.filter(o => o.representation === "turn" && o.eventId === null && o.usageId === null);
  const terminal = turns.filter(o => ["completed", "cancelled", "failed"].includes(o.transportStatus));
  if (terminal.some(o => o.transportStatus !== turn.status)) return { reason: "contradictoryTerminalProof", ids: [] };
  const ordinary = terminal.filter(o => o.origin === "ordinary" && o.sourceRef.fileId === sourceId && o.sourceRef.fileId === turn.sourceRef.fileId);
  if (!ordinary.some(o => o.sourceRef.byteOffset === turn.sourceRef.byteOffset)) return { reason: "missingTerminalProof", ids: [] };
  const firstTerminal = Math.min(...ordinary.map(o => o.sourceRef.byteOffset));
  const pending = turns.filter(o => o.origin === "ordinary" && o.transportStatus === "pending" && o.sourceRef.fileId === sourceId && o.sourceRef.fileId === turn.sourceRef.fileId && o.sourceRef.byteOffset < firstTerminal);
  if (turn.intervalScope === "observed_turn" && !pending.length) return { reason: "missingPendingProof", ids: [] };
  return { reason: null, ids: [...new Set([...ordinary, ...pending].map(o => o.id))].sort(compare) };
}

/** Native turn endpoints supply positions; ordinary stored observations corroborate boundary representation, never timestamps. */
export function analyzeSourceActiveTime(source: StoredSource): SourceActiveTimeAnalysis {
  const inherited = summarizeSource(source);
  const base = {
    schema: "agentprof.source-active-time/v1" as const, scope: "source_prefix" as const, metric: "active_time" as const, version: "codex-positioned-turn-v1" as const,
    sourceId: inherited.sourceId, provider: inherited.provider, parserVersion: source.parserVersion, normalizationVersion: source.normalizationVersion, keyVersion: source.keyVersion,
    revision: inherited.revision, completedOffset: inherited.completedOffset, observedSize: inherited.observedSize, availability: inherited.availability, persistedScope: inherited.persistedScope,
    crossSourceReconciled: inherited.crossSourceReconciled, aggregationReady: inherited.aggregationReady, parserResumeReady: inherited.parserResumeReady, sourceFreshnessChecked: false as const,
    observationWindow: { unit: "source_bytes" as const, startInclusive: 0 as const, endExclusive: source.completedOffset }, queryPeriod: null, capabilities: inherited.capabilities, suppressionReason: inherited.suppressionReason, inventory: inherited.inventory,
    limitations: ["source_local_observed_subset_only", "native_endpoints_not_duration_inference", "ordinary_observations_have_no_timestamps", "observed_turn_elapsed_not_cpu_time", "gaps_excluded_from_union_but_included_in_span", "sessions_and_interval_contracts_not_combined", "no_task_elapsed_waste_or_savings_inference", ...(inherited.capabilities?.coverage === "partial" ? ["partial_shape_coverage"] : [])]
  };
  const unsupported = source.provider !== "codex" ? "unsupported_provider" as const
    : source.parserVersion !== 1 && source.parserVersion !== 2 || source.normalizationVersion !== 1 || source.keyVersion !== 1 || inherited.capabilities?.provider !== "codex" || inherited.capabilities.parserVersion !== source.parserVersion || inherited.capabilities.support !== "shape_verified_only" ? "unsupported_parser_contract" as const : null;
  const unavailable = inherited.suppressionReason ?? unsupported;
  if (unavailable !== null) return freeze({ ...base, assessment: "unavailable", activeTimeAssessmentReason: unavailable,
    summary: { eligibleTurns: null, excludedTurns: null, partitions: null }, exclusions: null, excludedTurnEvidence: null, partitions: null });

  const exclusions: Record<Exclusion, number> = { unsupportedProvider: 0, pending: 0, unknownStatus: 0, missingBoundaries: 0, unknownInterval: 0, estimatedTiming: 0, inconsistentInterval: 0, invalidBoundaries: 0, missingTerminalProof: 0, contradictoryTerminalProof: 0, missingPendingProof: 0 };
  const excludedTurnEvidence: { turnId: string; reason: Exclusion }[] = [];
  const byTurn = new Map<string, SourceObservation[]>();
  for (const observation of source.evidence!.observations as readonly SourceObservation[]) {
    if (observation.turnId === null) continue;
    const rows = byTurn.get(observation.turnId); if (rows) rows.push(observation); else byTurn.set(observation.turnId, [observation]);
  }
  const buckets = new Map<string, { sessionId: string; scope: IntervalScope; evidence: IntervalEvidence; rows: { turn: NormalizedTurn; start: number; end: number; proofIds: string[] }[] }>();
  let eligible = 0;
  for (const turn of [...source.evidence!.turns as readonly NormalizedTurn[]].sort((a, b) => compare(a.id, b.id))) {
    const boundaryReason = intervalReason(turn), corroboration = boundaryReason === null ? proof(turn, byTurn.get(turn.id) ?? [], source.sourceId) : { reason: boundaryReason, ids: [] };
    if (corroboration.reason !== null) { exclusions[corroboration.reason]++; excludedTurnEvidence.push({ turnId: turn.id, reason: corroboration.reason }); continue; }
    const key = JSON.stringify([turn.sessionId, turn.intervalScope, turn.intervalTimingEvidence]);
    let bucket = buckets.get(key);
    if (!bucket) { bucket = { sessionId: turn.sessionId, scope: turn.intervalScope as IntervalScope, evidence: turn.intervalTimingEvidence as IntervalEvidence, rows: [] }; buckets.set(key, bucket); }
    bucket.rows.push({ turn, start: Date.parse(turn.startAt!), end: Date.parse(turn.endAt!), proofIds: corroboration.ids }); eligible++;
  }
  const partitions: ActiveTimePartition[] = [...buckets].sort(([a], [b]) => compare(a, b)).map(([, bucket], i) => {
    const first = Math.min(...bucket.rows.map(r => r.start)), last = Math.max(...bucket.rows.map(r => r.end));
    const span = last - first, observedSpanMs = Number.isSafeInteger(span) && span >= 0 ? span : null, activeTimeMs = union(bucket.rows);
    return { id: `active-${i + 1}`, sessionId: bucket.sessionId, intervalScope: bucket.scope, intervalTimingEvidence: bucket.evidence, turnN: bucket.rows.length,
      activeTimeMs, activeTimeReason: activeTimeMs === null ? "numeric_overflow" : null, observedSpanMs, observedSpanReason: observedSpanMs === null ? "numeric_overflow" : null,
      turnIds: bucket.rows.map(r => r.turn.id), turnEvidence: bucket.rows.map(r => ({ turnId: r.turn.id, status: r.turn.status as "completed" | "cancelled", startAt: r.turn.startAt!, endAt: r.turn.endAt!, evidenceObservationIds: r.proofIds })) };
  });
  const partialShapes = inherited.capabilities!.coverage === "partial";
  return freeze({ ...base, assessment: eligible === 0 ? "no_eligible_turns" : partialShapes || excludedTurnEvidence.length ? "partial" : "evaluated",
    activeTimeAssessmentReason: eligible === 0 ? "no_supported_turn_intervals" : partialShapes ? "partial_shape_coverage" : excludedTurnEvidence.length ? "excluded_turns" : null,
    summary: { eligibleTurns: eligible, excludedTurns: excludedTurnEvidence.length, partitions: partitions.length }, exclusions, excludedTurnEvidence, partitions });
}
