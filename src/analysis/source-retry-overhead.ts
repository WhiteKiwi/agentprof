import type { StoredSource } from "../db/source-store.js";
import type { NormalizedEvent } from "../normalize/types.js";
import { analyzeSourceRecovery } from "./source-recovery.js";
import type { RecoveryChain, RecoveryGroup, RecoveryPartition, SourceRecoveryAnalysis } from "./source-recovery.js";

type DurationExclusion = "missing_duration" | "invalid_duration" | "unknown_scope" | "estimated_timing" | "unknown_timing" | "unsupported_timing_representation" | "missing_timing_provenance";
type DurationScope = "process_runtime" | "invocation_latency";
type DurationEvidence = "source_reported" | "paired_timestamps";
type DurationReason = "incomplete_duration_coverage" | "incompatible_duration_cohorts" | "numeric_overflow" | "recovery_unavailable" | null;
type IntervalReason = "incompatible_interval_partitions" | "numeric_overflow" | "recovery_unavailable" | null;
export type RetryDurationCoverage = Readonly<{
  selectedN: number; measuredN: number; unavailableN: number;
  exclusions: Readonly<Partial<Record<DurationExclusion, number>>>;
}>;
export type RetryDurationMeasurement = Readonly<{
  durationScope: DurationScope; timingEvidence: DurationEvidence; n: number; sumMs: number | null; eventIds: readonly string[];
}>;
export type RetryDurationCohort = Readonly<{
  id: string; sessionId: string; durationScope: DurationScope; timingEvidence: DurationEvidence;
  n: number; sumMs: number | null; chainIds: readonly string[];
}>;
export type RetryIntervalPartition = Readonly<{
  id: string; sessionId: string; intervalScope: RecoveryChain["intervalScope"]; intervalTimingEvidence: RecoveryChain["intervalTimingEvidence"];
  failedAttemptN: number; chainIds: readonly string[]; retryOverheadMs: number | null; reason: "numeric_overflow" | null;
}>;
export type RetryOverheadChain = Readonly<{
  id: string; recoveryChainId: string; groupId: string; sessionId: string; turnId: string;
  intervalScope: RecoveryChain["intervalScope"]; intervalTimingEvidence: RecoveryChain["intervalTimingEvidence"];
  attemptCount: number; failedAttemptCount: number; resolved: boolean; terminalSuccessEventId: string | null;
  failedEventIds: readonly string[]; evidenceObservationIds: readonly string[];
  firstFailedResultAt: string; successfulResultAt: string | null;
  durationCoverage: RetryDurationCoverage; durationMeasurements: readonly RetryDurationMeasurement[];
  failedAttemptDurationSumMs: number | null; failedAttemptDurationSumReason: DurationReason; retryOverheadMs: number | null;
}>;
type RecoveryContext = Readonly<Pick<SourceRecoveryAnalysis, "summary" | "classification" | "inventory" | "inheritedProvenance" | "limitations"> & {
  blockedPartitions: readonly Pick<RecoveryPartition, "id" | "sessionId" | "status" | "reasons" | "candidateAttemptN" | "missingOperationEventIds" | "missingTurnEventIds" | "unassignedFailedEventIds" | "unresolvedProvenanceEventIds">[];
  unavailableGroups: readonly Pick<RecoveryGroup, "id" | "partitionId" | "turnId" | "reasons" | "attemptN" | "knownFailedAttemptN" | "blockedFailedEventIds" | "evidenceObservationIds">[];
}>;
type RecoveryMetadata = Pick<SourceRecoveryAnalysis, "sourceId" | "provider" | "parserVersion" | "normalizationVersion" | "keyVersion" | "revision" | "completedOffset" | "observedSize" | "availability" | "persistedScope" | "observationWindow" | "queryPeriod" | "crossSourceReconciled" | "aggregationReady" | "parserResumeReady" | "sourceFreshnessChecked" | "assessment" | "suppressionReason" | "recoveryAssessmentReason" | "capabilities">;
export type SourceRetryOverheadAnalysis = Readonly<RecoveryMetadata & {
  schema: "agentprof.source-retry-overhead/v1"; scope: "source_prefix"; metric: "retry_overhead"; version: "codex-same-turn-operation-v1";
  summaryScope: "admitted_recovery_chains";
  summary: Readonly<{
    chainN: number | null; resolvedChainN: number | null; unresolvedChainN: number | null; measuredChainN: number | null;
    failedAttemptN: number | null; measuredFailedAttemptN: number | null; unavailableDurationAttemptN: number | null;
    failedAttemptDurationSumMs: number | null; failedAttemptDurationSumReason: DurationReason;
    retryOverheadMs: number | null; retryOverheadReason: IntervalReason;
  }>;
  durationCoverage: RetryDurationCoverage | null; durationCohorts: readonly RetryDurationCohort[] | null;
  intervalPartitions: readonly RetryIntervalPartition[] | null; chains: readonly RetryOverheadChain[] | null;
  recoveryContext: RecoveryContext; limitations: readonly string[];
}>;

const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const validDuration = (n: number): boolean => Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER;
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function add<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const rows = map.get(key); if (rows) rows.push(value); else map.set(key, [value]);
}
function checkedDurationSum(rows: readonly NormalizedEvent[]): number | null {
  let total = 0;
  for (const e of [...rows].sort((a, b) => compare(a.id, b.id))) {
    if (e.durationMs! > Number.MAX_SAFE_INTEGER - total) return null;
    total += e.durationMs!; if (!validDuration(total)) return null;
  }
  return total;
}
function unionMs(intervals: readonly (readonly [number, number])[]): number | null {
  if (!intervals.length) return 0;
  const rows = [...intervals].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let [start, end] = rows[0]!, total = 0;
  const accumulate = (): boolean => {
    const duration = end - start;
    if (!Number.isSafeInteger(duration) || duration < 0 || duration > Number.MAX_SAFE_INTEGER - total) return false;
    total += duration; return Number.isSafeInteger(total);
  };
  for (const [nextStart, nextEnd] of rows.slice(1)) {
    if (nextStart <= end) { end = Math.max(end, nextEnd); continue; }
    if (!accumulate()) return null; start = nextStart; end = nextEnd;
  }
  return accumulate() ? total : null;
}

// Recovery already admits native terminal provenance and decisive structured or call/result/poll interval proof.
// Apply the unchanged native failed-duration contract only to that admitted subset; do not re-run admission.
function durationReason(e: NormalizedEvent): DurationExclusion | null {
  if (e.durationMs === null) return "missing_duration";
  if (!validDuration(e.durationMs)) return "invalid_duration";
  if (e.durationScope === "unknown") return "unknown_scope";
  if (e.timingEvidence === "estimated") return "estimated_timing";
  if (e.timingEvidence !== "source_reported" && e.timingEvidence !== "paired_timestamps") return "unknown_timing";
  if (e.timingEvidence === "source_reported") {
    if (e.sourceRef.recordType !== "event_msg" || !(e.kind === "shell" && e.durationScope === "process_runtime" || e.kind === "mcp" && e.durationScope === "invocation_latency")) return "unsupported_timing_representation";
  } else {
    if (e.durationScope !== "invocation_latency" || e.sourceRef.recordType !== "response_item") return "unsupported_timing_representation";
    if (Date.parse(e.endAt!) - Date.parse(e.startAt!) !== e.durationMs) return "missing_timing_provenance";
  }
  return null;
}
function durationTotal(coverage: RetryDurationCoverage, sums: readonly (number | null)[]): { value: number | null; reason: DurationReason } {
  if (coverage.unavailableN !== 0) return { value: null, reason: "incomplete_duration_coverage" };
  if (sums.length > 1) return { value: null, reason: "incompatible_duration_cohorts" };
  if (sums[0] === null) return { value: null, reason: "numeric_overflow" };
  return { value: sums[0] ?? 0, reason: null };
}

/** Pure selected-prefix failed contribution; Recovery supplies chain identity, admission and positioned interval proof once. */
export function analyzeSourceRetryOverhead(source: StoredSource): SourceRetryOverheadAnalysis {
  const recovery = analyzeSourceRecovery(source);
  const base = {
    schema: "agentprof.source-retry-overhead/v1" as const, scope: "source_prefix" as const, metric: "retry_overhead" as const, version: "codex-same-turn-operation-v1" as const,
    summaryScope: "admitted_recovery_chains" as const,
    sourceId: recovery.sourceId, provider: recovery.provider, parserVersion: recovery.parserVersion, normalizationVersion: recovery.normalizationVersion, keyVersion: recovery.keyVersion,
    revision: recovery.revision, completedOffset: recovery.completedOffset, observedSize: recovery.observedSize, availability: recovery.availability, persistedScope: recovery.persistedScope,
    observationWindow: recovery.observationWindow, queryPeriod: recovery.queryPeriod, crossSourceReconciled: recovery.crossSourceReconciled, aggregationReady: recovery.aggregationReady,
    parserResumeReady: recovery.parserResumeReady, sourceFreshnessChecked: recovery.sourceFreshnessChecked, assessment: recovery.assessment, suppressionReason: recovery.suppressionReason,
    recoveryAssessmentReason: recovery.recoveryAssessmentReason, capabilities: recovery.capabilities,
    recoveryContext: {
      summary: recovery.summary, classification: recovery.classification, inventory: recovery.inventory, inheritedProvenance: recovery.inheritedProvenance, limitations: recovery.limitations,
      blockedPartitions: recovery.partitions.filter(p => p.reasons.length > 0).map(p => ({ id: p.id, sessionId: p.sessionId, status: p.status, reasons: p.reasons, candidateAttemptN: p.candidateAttemptN,
        missingOperationEventIds: p.missingOperationEventIds, missingTurnEventIds: p.missingTurnEventIds, unassignedFailedEventIds: p.unassignedFailedEventIds, unresolvedProvenanceEventIds: p.unresolvedProvenanceEventIds })),
      unavailableGroups: recovery.groups.filter(g => g.status === "unavailable").map(g => ({ id: g.id, partitionId: g.partitionId, turnId: g.turnId, reasons: g.reasons, attemptN: g.attemptN,
        knownFailedAttemptN: g.knownFailedAttemptN, blockedFailedEventIds: g.blockedFailedEventIds, evidenceObservationIds: g.evidenceObservationIds }))
    },
    limitations: ["admitted_recovery_chains_only", "recorded_duration_not_interval_length", "failed_attempt_intervals_only", "success_duration_and_between_attempt_gaps_excluded", "unresolved_chains_retain_observed_failed_contribution", "necessary_retries_may_be_included", "no_waste_or_savings_inference"]
  };
  if (recovery.chains === null) return freeze({ ...base,
    summary: { chainN: null, resolvedChainN: null, unresolvedChainN: null, measuredChainN: null, failedAttemptN: null, measuredFailedAttemptN: null, unavailableDurationAttemptN: null,
      failedAttemptDurationSumMs: null, failedAttemptDurationSumReason: "recovery_unavailable", retryOverheadMs: null, retryOverheadReason: "recovery_unavailable" },
    durationCoverage: null, durationCohorts: null, intervalPartitions: null, chains: null
  });

  const events = new Map(source.events.map(e => [e.id, e]));
  const chains: RetryOverheadChain[] = [];
  const durationBuckets = new Map<string, { event: NormalizedEvent; chainId: string }[]>();
  const intervalBuckets = new Map<string, { chain: RetryOverheadChain; intervals: [number, number][] }[]>();
  const coverage = { selectedN: 0, measuredN: 0, unavailableN: 0, exclusions: {} as Partial<Record<DurationExclusion, number>> };
  for (const chain of recovery.chains) {
    const id = `retry-chain-${chains.length + 1}`, intervals: [number, number][] = [];
    const measured = new Map<string, NormalizedEvent[]>();
    const chainCoverage = { selectedN: chain.failedAttemptCount, measuredN: 0, unavailableN: 0, exclusions: {} as Partial<Record<DurationExclusion, number>> };
    for (const eventId of chain.failedEventIds) {
      const e = events.get(eventId)!;
      intervals.push([Date.parse(e.startAt!), Date.parse(e.endAt!)]);
      const reason = durationReason(e);
      if (reason !== null) { chainCoverage.unavailableN++; chainCoverage.exclusions[reason] = (chainCoverage.exclusions[reason] ?? 0) + 1; continue; }
      chainCoverage.measuredN++;
      add(measured, JSON.stringify([e.durationScope, e.timingEvidence]), e);
      add(durationBuckets, JSON.stringify([e.sessionId, e.durationScope, e.timingEvidence]), { event: e, chainId: id });
    }
    const durationMeasurements = [...measured].sort(([a], [b]) => compare(a, b)).map(([, samples]) => ({
      durationScope: samples[0]!.durationScope as DurationScope, timingEvidence: samples[0]!.timingEvidence as DurationEvidence,
      n: samples.length, sumMs: checkedDurationSum(samples), eventIds: samples.map(e => e.id).sort(compare)
    }));
    const duration = durationTotal(chainCoverage, durationMeasurements.map(m => m.sumMs));
    const retryChain: RetryOverheadChain = { id, recoveryChainId: chain.id, groupId: chain.groupId, sessionId: chain.sessionId, turnId: chain.turnId,
      intervalScope: chain.intervalScope, intervalTimingEvidence: chain.intervalTimingEvidence, attemptCount: chain.attemptCount, failedAttemptCount: chain.failedAttemptCount,
      resolved: chain.resolved, terminalSuccessEventId: chain.successfulEventId, failedEventIds: chain.failedEventIds, evidenceObservationIds: chain.evidenceObservationIds,
      firstFailedResultAt: chain.firstFailedResultAt, successfulResultAt: chain.successfulResultAt, durationCoverage: chainCoverage, durationMeasurements,
      failedAttemptDurationSumMs: duration.value, failedAttemptDurationSumReason: duration.reason, retryOverheadMs: unionMs(intervals) };
    chains.push(retryChain);
    add(intervalBuckets, JSON.stringify([chain.sessionId, chain.intervalScope, chain.intervalTimingEvidence]), { chain: retryChain, intervals });
    coverage.selectedN += chainCoverage.selectedN; coverage.measuredN += chainCoverage.measuredN; coverage.unavailableN += chainCoverage.unavailableN;
    for (const [reason, n] of Object.entries(chainCoverage.exclusions)) coverage.exclusions[reason as DurationExclusion] = (coverage.exclusions[reason as DurationExclusion] ?? 0) + n;
  }
  const durationCohorts = [...durationBuckets].sort(([a], [b]) => compare(a, b)).map(([, rows], i) => ({
    id: `duration-${i + 1}`, sessionId: rows[0]!.event.sessionId, durationScope: rows[0]!.event.durationScope as DurationScope, timingEvidence: rows[0]!.event.timingEvidence as DurationEvidence,
    n: rows.length, sumMs: checkedDurationSum(rows.map(r => r.event)), chainIds: [...new Set(rows.map(r => r.chainId))].sort(compare)
  }));
  const intervalPartitions = [...intervalBuckets].sort(([a], [b]) => compare(a, b)).map(([, rows], i) => {
    const first = rows[0]!.chain, retryOverheadMs = unionMs(rows.flatMap(r => r.intervals));
    return { id: `interval-${i + 1}`, sessionId: first.sessionId, intervalScope: first.intervalScope, intervalTimingEvidence: first.intervalTimingEvidence,
      failedAttemptN: rows.reduce((n, r) => n + r.chain.failedAttemptCount, 0), chainIds: rows.map(r => r.chain.id), retryOverheadMs, reason: retryOverheadMs === null ? "numeric_overflow" as const : null };
  });
  const duration = durationTotal(coverage, durationCohorts.map(c => c.sumMs));
  const overheadReason = intervalPartitions.length > 1 ? "incompatible_interval_partitions" : intervalPartitions[0]?.reason ?? null;
  return freeze({ ...base,
    summary: { chainN: chains.length, resolvedChainN: chains.filter(c => c.resolved).length, unresolvedChainN: chains.filter(c => !c.resolved).length,
      measuredChainN: chains.filter(c => c.retryOverheadMs !== null).length, failedAttemptN: coverage.selectedN, measuredFailedAttemptN: coverage.measuredN, unavailableDurationAttemptN: coverage.unavailableN,
      failedAttemptDurationSumMs: duration.value, failedAttemptDurationSumReason: duration.reason, retryOverheadMs: overheadReason !== null ? null : intervalPartitions[0]?.retryOverheadMs ?? 0, retryOverheadReason: overheadReason },
    durationCoverage: coverage, durationCohorts, intervalPartitions, chains
  });
}
