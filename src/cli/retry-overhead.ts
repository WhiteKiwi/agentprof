import type { SourceRetryOverheadAnalysis } from "../analysis/source-retry-overhead.js";

const value = (n: number | null): string => n === null ? "unavailable" : String(n);
const shown = (n: number, total: number): string => `shown=${n}/${total}; omitted=${total - n}`;

export function formatSourceRetryOverhead(a: SourceRetryOverheadAnalysis): string {
  const chains = a.chains?.slice(0, 8) ?? [];
  const lines = [
    "AgentProf observed source-local retry overhead",
    `Source: ${a.sourceId}`,
    `${a.provider}; revision=${a.revision}; source bytes [0,${a.completedOffset})/${a.observedSize}`,
    `Assessment=${a.assessment}; suppression=${a.suppressionReason ?? "none"}; recovery reason=${a.recoveryAssessmentReason ?? "none"}`,
    `Chains: total=${value(a.summary.chainN)}; resolved=${value(a.summary.resolvedChainN)}; unresolved=${value(a.summary.unresolvedChainN)}; measured=${value(a.summary.measuredChainN)}`,
    `Failed attempts=${value(a.summary.failedAttemptN)}; failed duration sum=${value(a.summary.failedAttemptDurationSumMs)} ms; retry overhead union=${value(a.summary.retryOverheadMs)} ms`,
    "Retry overhead is the union of admitted failed-attempt intervals only. Success duration and gaps between attempts are excluded.",
    `Chain detail: ${a.chains === null ? "unavailable" : shown(chains.length, a.chains.length)}`
  ];
  for (const chain of chains) lines.push(
    `${chain.id}: session=${chain.sessionId}; turn=${chain.turnId}; resolved=${chain.resolved}; attempts=${chain.attemptCount}; failed=${chain.failedAttemptCount}; failed sum=${value(chain.failedAttemptDurationSumMs)} ms; overhead=${value(chain.retryOverheadMs)} ms; success=${chain.terminalSuccessEventId ?? "none"}`
  );
  lines.push("Limits: observed source-prefix evidence only; unresolved chains keep observed failure contribution. Necessary retries may be included. No waste, avoidability, root-cause or savings claim.");
  return lines.join("\n") + "\n";
}
