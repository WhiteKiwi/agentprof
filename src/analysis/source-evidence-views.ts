import type { SourceRecoveryAnalysis } from "./source-recovery.js";
import type { SourceFailureAnalysis } from "./source-failures.js";
import type { SourceReadRevisitAnalysis } from "./source-read-revisits.js";
import type { SourceSearchRecurrenceAnalysis } from "./source-search-recurrence.js";
import type { SourceInvocationOverlapAnalysis } from "./source-invocation-overlap.js";
import type { SourceSlowToolAnalysis } from "./source-slow-tool.js";
import type { SourceSummary } from "./source-summary.js";

export type EvidenceViewInput =
  | Readonly<{ view: "recovery-distribution" | "retry-resolution"; analysis: SourceRecoveryAnalysis }>
  | Readonly<{ view: "failure-admission" | "failure-timing"; analysis: SourceFailureAnalysis }>
  | Readonly<{ view: "read-identity"; analysis: SourceReadRevisitAnalysis }>
  | Readonly<{ view: "search-identity"; analysis: SourceSearchRecurrenceAnalysis }>
  | Readonly<{ view: "boundary-coverage"; analysis: SourceInvocationOverlapAnalysis }>
  | Readonly<{ view: "slow-candidates" | "slow-coverage"; analysis: SourceSlowToolAnalysis }>
  | Readonly<{ view: "token-completeness"; analysis: SourceSummary }>;
export type EvidenceViewName = EvidenceViewInput["view"];
export type EvidenceFraction = Readonly<{ numerator: number | null; denominator: number | null; value: number | null }>;
type Cell = string | number | boolean | null;
export type EvidenceViewRow = Readonly<{
  id: string; sessionId: string | null; state: string;
  values: Readonly<Record<string, Cell>>; fractions: Readonly<Record<string, EvidenceFraction>>;
  reasons: readonly string[];
}>;
export type SourceEvidenceView = Readonly<{
  schema: "agentprof.source-evidence-view/v1"; view: EvidenceViewName; scope: "source_prefix";
  sourceId: string; provider: "codex" | "claude"; revision: number; parserVersion: number | null;
  completedOffset: number; observedSize: number; availability: string; persistedScope: string;
  assessment: string; suppressionReason: string | null;
  sourceFreshnessChecked: false; crossSourceReconciled: false; aggregationReady: false;
  summary: Readonly<Record<string, Cell>>; rows: readonly EvidenceViewRow[] | null;
  limitations: readonly string[];
}>;

const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const count = (n: number | null): n is number => n !== null && Number.isSafeInteger(n) && n >= 0;
/** Null denominators and unavailable assessments are not zero coverage. */
export function evidenceFraction(n: number | null, d: number | null, available = true): EvidenceFraction {
  return Object.freeze({ numerator: n, denominator: d,
    value: available && count(n) && count(d) && d > 0 && n <= d ? n / d : null });
}
function sum(a: number | null, b: number | null): number | null {
  return count(a) && count(b) && Number.isSafeInteger(a + b) ? a + b : null;
}
function ownedFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) ownedFreeze(child);
    Object.freeze(value);
  }
  return value;
}
function row(id: string, sessionId: string | null, state: string, values: Record<string, Cell>,
  fractions: Record<string, EvidenceFraction> = {}, reasons: readonly string[] = []): EvidenceViewRow {
  return { id, sessionId, state, values, fractions, reasons: [...reasons] };
}
function exclusionReasons(reasons: Readonly<Record<string, number>>): string[] {
  return Object.entries(reasons).filter(([, n]) => n > 0).map(([key, n]) => `${key}=${n}`);
}

/** Projections of already validated native analyses; never reads raw logs or invents an analysis. */
export function buildSourceEvidenceView(input: EvidenceViewInput): SourceEvidenceView {
  const a = input.analysis;
  let rows: EvidenceViewRow[] | null = [], summary: Record<string, Cell> = {};
  const limitations = ["Stored source-prefix evidence only; no freshness or cross-source reconciliation.",
    "Fractions retain numerator/denominator; unavailable or zero denominators produce null, not zero."];
  switch (input.view) {
    case "recovery-distribution": {
      const r = input.analysis;
      summary = { resolvedChains: r.summary.resolvedChains, unresolvedChains: r.summary.unresolvedChains,
        unavailableGroups: r.summary.unavailableGroups };
      rows = r.distributions === null ? null : r.distributions.map(d => row(d.id, d.sessionId, "evaluated",
        { intervalScope: d.intervalScope, intervalTimingEvidence: d.intervalTimingEvidence, n: d.n,
          minMs: d.minMs, p50Ms: d.p50Ms, p95Ms: d.p95Ms, maxMs: d.maxMs, lowSampleP95: d.lowSampleP95 }));
      limitations.push("Native nearest-rank quantiles of resolved chains only; not an estimated population median. Unresolved endpoints stay null.");
      break;
    }
    case "retry-resolution": {
      const r = input.analysis, sessions = new Map(r.partitions.map(p => [p.id, p.sessionId]));
      rows = r.groups.map(g => row(g.id, sessions.get(g.partitionId) ?? null, g.status,
        { turnId: g.turnId, resolvedChains: g.resolvedChainN, unresolvedChains: g.unresolvedChainN,
          knownFailedAttempts: g.knownFailedAttemptN },
        { observedResolution: evidenceFraction(g.resolvedChainN, sum(g.resolvedChainN, g.unresolvedChainN), g.status === "evaluated") }, g.reasons));
      limitations.push("Observed same-operation recovery chains, not a Retry Loop diagnosis, future success probability, or cross-group failure rate.");
      break;
    }
    case "failure-admission": {
      const r = input.analysis;
      rows = r.partitions.map(p => row(p.id, p.sessionId, p.status,
        { tentativeTerminalCalls: p.tentativeTerminalCalls, admittedTerminalCalls: p.terminalN,
          confirmedFailed: p.failedN, excludedUnknownStatus: p.exclusions.unknown_status,
          unresolvedProvenance: p.unresolvedEventIds.length },
        { admission: evidenceFraction(p.terminalN, p.tentativeTerminalCalls, p.status === "evaluated") }, exclusionReasons(p.exclusions)));
      limitations.push("Admission among tentative native terminals, not overall failure rate. Generic Codex nonzero exits may remain unknown.");
      break;
    }
    case "failure-timing": {
      const r = input.analysis;
      rows = r.cohorts === null ? null : r.cohorts.map(c => row(c.id, c.sessionId, "evaluated",
        { confirmedFailed: c.failedN, measuredFailed: c.timing.measuredN,
          missingOperationIdentity: c.missingOperationIdentityN, missingErrorIdentity: c.missingErrorIdentityN },
        { timing: evidenceFraction(c.timing.measuredN, c.failedN) }, exclusionReasons(c.timing.exclusions)));
      limitations.push("Untimed failures remain failures, not zero-duration executions. Timing and error-identity coverage are different dimensions.");
      break;
    }
    case "read-identity": {
      rows = input.analysis.partitions.map(p => row(p.id, p.sessionId, p.status,
        { candidateReads: p.candidateReadN, missingFileIdentity: p.missingFileIdentityN },
        { identity: evidenceFraction(p.candidateReadN - p.missingFileIdentityN, p.candidateReadN,
          p.status === "evaluated" || p.reason === "identity_unresolved") }, p.reason === null ? [] : [p.reason]));
      limitations.push("File-identity presence among admitted completed Read calls, not equal content, unnecessary rereads or recall.");
      break;
    }
    case "search-identity": {
      rows = input.analysis.partitions.map(p => row(p.id, p.sessionId, p.status,
        { candidateSearches: p.candidateSearchN, missingLookupIdentity: p.missingLookupN },
        { identity: evidenceFraction(p.candidateSearchN - p.missingLookupN, p.candidateSearchN,
          p.status === "evaluated" || p.reason === "identity_unresolved") }, p.reason === null ? [] : [p.reason]));
      limitations.push("Exact native lookup-identity presence, not semantic search coverage, equal results or unnecessary repetition.");
      break;
    }
    case "boundary-coverage": {
      rows = input.analysis.partitions.map(p => row(p.id, p.sessionId, p.status,
        { intervalScope: p.intervalScope, intervalTimingEvidence: p.intervalTimingEvidence,
          positioned: p.coverage.positionedN, admittedTerminals: p.coverage.admittedTerminalN,
          excluded: p.coverage.excludedN, complete: p.coverage.complete },
        { boundaries: evidenceFraction(p.coverage.positionedN, p.coverage.admittedTerminalN,
          p.status === "evaluated" || p.status === "partial") },
        [...(p.reason === null ? [] : [p.reason]), ...exclusionReasons(p.coverage.exclusions)]));
      limitations.push("Positioned invocation-boundary coverage, not wall-time occupancy, history completeness or a session-duration denominator.");
      break;
    }
    case "slow-candidates": {
      const r = input.analysis;
      summary = { candidateCount: r.candidates === null ? null : r.candidates.length,
        ruleId: r.ruleId, ruleVersion: r.ruleVersion, minimumTimedCalls: r.thresholds.minimumTimedCalls,
        minimumDurationShare: r.thresholds.minimumDurationShare };
      rows = r.candidates === null ? null : r.candidates.map(c => row(c.id, c.sessionId, "candidate",
        { partitionId: c.partitionId, durationScope: c.durationScope, timingEvidence: c.timingEvidence,
          category: c.group.category, tool: c.group.toolName, commandPattern: c.group.commandPattern,
          n: c.n, sumMs: c.sumMs, p95Ms: c.p95Ms, lowSampleP95: c.lowSampleP95,
          denominatorN: c.denominatorN, denominatorSumMs: c.denominatorSumMs,
          observedDurationShare: c.observedEligibleNativeToolDurationShare,
          avoidableWork: c.confidence.avoidableWork, rootCause: c.confidence.rootCause,
          effect: c.confidence.effect, necessaryWorkCounterexample: c.necessaryWorkCounterexample,
          investigativeAction: c.investigativeAction, matchedExperiment: c.matchedExperiment,
          qualityGuardrail: c.qualityGuardrail }, {}, c.limitations));
      limitations.push("Keep the native candidate denominator and quality guardrail. Slow Tool alone is not Detected Waste or proven savings.");
      break;
    }
    case "slow-coverage": {
      rows = input.analysis.partitions.map(p => row(p.id, p.sessionId, p.status,
        { durationScope: p.durationScope, timingEvidence: p.timingEvidence,
          tentativeTimedCalls: p.tentativeTimedCalls, admittedTimedCalls: p.denominatorN,
          denominatorSumMs: p.denominatorSumMs, unresolvedEvents: p.unresolvedEventIds.length },
        { admission: evidenceFraction(p.denominatorN, p.tentativeTimedCalls, p.status !== "identity_unresolved") }));
      limitations.push("Native rule-input coverage, not a performance score. Time-sum overflow does not manufacture a measured time.");
      break;
    }
    case "token-completeness": {
      rows = input.analysis.usage === null ? null : input.analysis.usage.map((c, i) => {
        const applicable = c.provider === "codex"
          ? ["input", "output", "total", "cachedInput", "cacheWriteInput", "reasoningOutput"] as const
          : ["input", "output", "total", "cachedInput", "cacheWriteInput", "uncachedInput"] as const;
        const missing = applicable.filter(key => c.counts[key] === null), known = applicable.length - missing.length;
        return row(`usage-${i + 1}`, c.sessionId, "eligible_cohort",
          { provider: c.provider, mapping: c.mapping, finality: c.finality, observedResponses: c.observedResponses,
            knownApplicableComponents: known, applicableComponents: applicable.length,
            missingApplicableComponents: missing.join(", "),
            inapplicableComponent: c.provider === "codex" ? "uncachedInput" : "reasoningOutput",
            overflowComponents: c.overflowComponents.join(", ") },
          { componentPresence: evidenceFraction(known, applicable.length) }, c.limitations);
      });
      limitations.push("Component presence in eligible usage cohorts, not total response/model/billing coverage. Provider-inapplicable fields are excluded from the denominator.");
      break;
    }
  }
  if (a.suppressionReason !== null) rows = null;
  if (rows !== null && rows.length > 4096) throw new RangeError("source_evidence_view_limit_exceeded");
  const assessment = "assessment" in a ? a.assessment
    : a.suppressionReason !== null ? "suppressed" : a.usage === null ? "no_eligible_events" : "evaluated";
  return ownedFreeze({ schema: "agentprof.source-evidence-view/v1", view: input.view, scope: "source_prefix",
    sourceId: a.sourceId, provider: a.provider, revision: a.revision,
    parserVersion: a.capabilities?.parserVersion ?? null, completedOffset: a.completedOffset, observedSize: a.observedSize,
    availability: a.availability, persistedScope: a.persistedScope, assessment, suppressionReason: a.suppressionReason,
    sourceFreshnessChecked: false, crossSourceReconciled: false, aggregationReady: false,
    summary, rows, limitations });
}

/** Rendering order is deterministic without relying on the machine locale. */
export function orderedEvidenceRows(view: SourceEvidenceView): readonly EvidenceViewRow[] {
  return [...(view.rows ?? [])].sort((a, b) => compare(a.sessionId ?? "", b.sessionId ?? "") || compare(a.id, b.id));
}
