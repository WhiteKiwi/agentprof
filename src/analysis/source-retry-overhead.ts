import type { StoredSource } from "../db/source-store.js";
import { analyzeSourceRecovery } from "./source-recovery.js";
import type { RecoveryChain, SourceRecoveryAnalysis } from "./source-recovery.js";

export type RetryOverheadChain = Readonly<{
  id: string;
  recoveryChainId: string;
  groupId: string;
  sessionId: string;
  turnId: string;
  intervalScope: RecoveryChain["intervalScope"];
  intervalTimingEvidence: RecoveryChain["intervalTimingEvidence"];
  attemptCount: number;
  failedAttemptCount: number;
  resolved: boolean;
  terminalSuccessEventId: string | null;
  failedEventIds: readonly string[];
  failedAttemptDurationSumMs: number | null;
  retryOverheadMs: number | null;
}>;

export type SourceRetryOverheadAnalysis = Readonly<{
  schema: "agentprof.source-retry-overhead/v1";
  scope: "source_prefix";
  metric: "retry_overhead";
  version: "codex-same-turn-operation-v1";
  sourceId: string;
  provider: StoredSource["provider"];
  parserVersion: number;
  revision: number;
  completedOffset: number;
  observedSize: number;
  assessment: SourceRecoveryAnalysis["assessment"];
  suppressionReason: SourceRecoveryAnalysis["suppressionReason"];
  recoveryAssessmentReason: SourceRecoveryAnalysis["recoveryAssessmentReason"];
  summary: Readonly<{
    chainN: number | null;
    resolvedChainN: number | null;
    unresolvedChainN: number | null;
    measuredChainN: number | null;
    failedAttemptN: number | null;
    failedAttemptDurationSumMs: number | null;
    retryOverheadMs: number | null;
  }>;
  chains: readonly RetryOverheadChain[] | null;
  limitations: readonly string[];
}>;

const safeAdd = (a: number, b: number): number | null => {
  const value = a + b;
  return Number.isSafeInteger(value) ? value : null;
};

function unionMs(intervals: readonly (readonly [number, number])[]): number | null {
  if (!intervals.length) return 0;
  const rows = [...intervals].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let start = rows[0]![0], end = rows[0]![1], total = 0;
  for (let i = 1; i < rows.length; i++) {
    const [nextStart, nextEnd] = rows[i]!;
    if (nextStart <= end) { if (nextEnd > end) end = nextEnd; continue; }
    const added = safeAdd(total, end - start); if (added === null) return null;
    total = added; start = nextStart; end = nextEnd;
  }
  return safeAdd(total, end - start);
}

/** Source-local retry overhead derived only from Recovery Time's admitted same-operation chains. */
export function analyzeSourceRetryOverhead(source: StoredSource): SourceRetryOverheadAnalysis {
  const recovery = analyzeSourceRecovery(source);
  if (recovery.chains === null) return Object.freeze({
    schema: "agentprof.source-retry-overhead/v1", scope: "source_prefix", metric: "retry_overhead", version: "codex-same-turn-operation-v1",
    sourceId: source.sourceId, provider: source.provider, parserVersion: source.parserVersion, revision: source.revision,
    completedOffset: source.completedOffset, observedSize: source.observedSize, assessment: recovery.assessment,
    suppressionReason: recovery.suppressionReason, recoveryAssessmentReason: recovery.recoveryAssessmentReason,
    summary: Object.freeze({ chainN: null, resolvedChainN: null, unresolvedChainN: null, measuredChainN: null, failedAttemptN: null, failedAttemptDurationSumMs: null, retryOverheadMs: null }),
    chains: null,
    limitations: Object.freeze(["recovery_chain_evidence_unavailable", "no_waste_or_savings_inference"])
  });

  const events = new Map(source.events.map(event => [event.id, event]));
  const chains: RetryOverheadChain[] = [];
  let totalFailedN = 0, totalDuration = 0, totalOverhead = 0, measuredN = 0;
  let aggregateDurationKnown = true, aggregateOverheadKnown = true;

  for (const chain of recovery.chains) {
    const intervals: [number, number][] = [];
    let durationSum = 0, durationKnown = true;
    for (const id of chain.failedEventIds) {
      const event = events.get(id);
      if (event === undefined || event.startAt === null || event.endAt === null) { durationKnown = false; continue; }
      const start = Date.parse(event.startAt), end = Date.parse(event.endAt);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) { durationKnown = false; continue; }
      const next = safeAdd(durationSum, end - start);
      if (next === null) durationKnown = false; else durationSum = next;
      intervals.push([start, end]);
    }
    const overhead = durationKnown && intervals.length === chain.failedAttemptCount ? unionMs(intervals) : null;
    const failedAttemptDurationSumMs = durationKnown && intervals.length === chain.failedAttemptCount ? durationSum : null;
    if (failedAttemptDurationSumMs === null) aggregateDurationKnown = false;
    else { const next = safeAdd(totalDuration, failedAttemptDurationSumMs); if (next === null) aggregateDurationKnown = false; else totalDuration = next; }
    if (overhead === null) aggregateOverheadKnown = false;
    else { measuredN++; const next = safeAdd(totalOverhead, overhead); if (next === null) aggregateOverheadKnown = false; else totalOverhead = next; }
    totalFailedN += chain.failedAttemptCount;
    chains.push(Object.freeze({
      id: `retry-chain-${chains.length + 1}`, recoveryChainId: chain.id, groupId: chain.groupId, sessionId: chain.sessionId, turnId: chain.turnId,
      intervalScope: chain.intervalScope, intervalTimingEvidence: chain.intervalTimingEvidence,
      attemptCount: chain.attemptCount, failedAttemptCount: chain.failedAttemptCount, resolved: chain.resolved,
      terminalSuccessEventId: chain.successfulEventId, failedEventIds: chain.failedEventIds,
      failedAttemptDurationSumMs, retryOverheadMs: overhead
    }));
  }

  return Object.freeze({
    schema: "agentprof.source-retry-overhead/v1", scope: "source_prefix", metric: "retry_overhead", version: "codex-same-turn-operation-v1",
    sourceId: source.sourceId, provider: source.provider, parserVersion: source.parserVersion, revision: source.revision,
    completedOffset: source.completedOffset, observedSize: source.observedSize, assessment: recovery.assessment,
    suppressionReason: recovery.suppressionReason, recoveryAssessmentReason: recovery.recoveryAssessmentReason,
    summary: Object.freeze({
      chainN: chains.length,
      resolvedChainN: chains.filter(chain => chain.resolved).length,
      unresolvedChainN: chains.filter(chain => !chain.resolved).length,
      measuredChainN: measuredN,
      failedAttemptN: totalFailedN,
      failedAttemptDurationSumMs: aggregateDurationKnown ? totalDuration : null,
      retryOverheadMs: aggregateOverheadKnown ? totalOverhead : null
    }),
    chains: Object.freeze(chains),
    limitations: Object.freeze([
      "failed_attempt_intervals_only",
      "success_duration_and_between_attempt_gaps_excluded",
      "unresolved_chains_retain_observed_failed_contribution",
      "necessary_retries_may_be_included",
      "no_waste_or_savings_inference"
    ])
  });
}
