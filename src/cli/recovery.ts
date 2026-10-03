import type { SourceRecoveryAnalysis } from "../analysis/source-recovery.js";

const value = (n: number | null): string => n === null ? "unavailable" : String(n);
const shown = (n: number, total: number): string => `shown=${n}/${total}; omitted=${total - n}`;

/** Display caps apply only here; JSON preserves every admitted group, chain and proof. */
export function formatSourceRecovery(a: SourceRecoveryAnalysis): string {
  const sessions = a.partitions.slice(0, 6), groups = a.groups.slice(0, 6), chains = a.chains?.slice(0, 6) ?? [], distributions = a.distributions?.slice(0, 6) ?? [];
  const partitions = new Map(a.partitions.map(p => [p.id, p]));
  const lines = ["AgentProf observed source-local recovery time", `Source: ${a.sourceId}`,
    `${a.provider}; revision=${a.revision}; source bytes [0,${a.completedOffset})/${a.observedSize}; availability=${a.availability}`,
    `Assessment=${a.assessment}; suppression=${a.suppressionReason ?? "none"}; reason=${a.recoveryAssessmentReason ?? "none"}`,
    `Support=${a.capabilities?.support ?? "unknown"}; coverage=${a.capabilities?.coverage ?? "unknown"}; parser/normalization/key=${a.parserVersion}/${a.normalizationVersion}/${a.keyVersion}`,
    `Attempts: candidates=${a.classification.candidateAttempts}; model excluded=${a.classification.modelExcluded}; other classes excluded=${a.classification.unsupportedClassExcluded}`,
    `Known failed attempts=${a.summary.knownFailedAttempts}; blocked known failures=${a.summary.unavailableKnownFailedAttempts}`,
    `Groups: evaluated=${a.summary.evaluatedGroups}; unavailable=${a.summary.unavailableGroups}; unavailable sessions=${a.summary.unavailableSessions}`,
    `Chains: resolved=${value(a.summary.resolvedChains)}; unresolved=${value(a.summary.unresolvedChains)}`,
    "Recovery ms = successful result time - first failed result time. Unresolved endpoints and elapsed stay null.",
    "Snapshot-local aliases use deterministic display order, not ranking. Complete evidence and session reasons: --json.",
    `Sessions ${shown(sessions.length, a.partitions.length)}`];
  for (const p of sessions) lines.push(`${p.id}: ${p.sessionId}; ${p.status}; reasons=${p.reasons.join(", ") || "none"}`,
    `  Candidate attempts=${p.candidateAttemptN}; groups=${p.groupIds.length}; missing operation=${p.missingOperationEventIds.length}; missing turn=${p.missingTurnEventIds.length}; unresolved provenance=${p.unresolvedProvenanceEventIds.length}`);
  lines.push(`Operation groups ${shown(groups.length, a.groups.length)}`);
  for (const g of groups) {
    const p = partitions.get(g.partitionId)!;
    lines.push(`${g.id}: ${g.status}; reasons=${g.reasons.join(", ") || "none"}`,
      `  Session ${p.sessionId}; session reasons=${p.reasons.join(", ") || "none"}`,
      `  Turn ${g.turnId}; ${g.operationClass?.kind ?? "unknown"}/${g.operationClass?.toolName ?? "unknown"}; attempts=${g.attemptN}; known failures=${g.knownFailedAttemptN}`,
      `  ${g.intervalScope ?? "unknown"}/${g.intervalTimingEvidence ?? "unknown"}; resolved=${value(g.resolvedChainN)}; unresolved=${value(g.unresolvedChainN)}; outside successes=${value(g.successesOutsideChains)}`);
  }
  lines.push(`Chains ${a.chains === null ? "unavailable; shown=0; total=unknown; omitted=unknown" : shown(chains.length, a.chains.length)}`);
  for (const c of chains) lines.push(`${c.id} / ${c.groupId}: ${c.resolved ? "resolved" : "unresolved"}; failures=${c.failedAttemptCount}; attempts=${c.attemptCount}; recovery ms=${c.recoveryElapsedMs ?? "null"}`,
    `  First failed result=${c.firstFailedResultAt}; successful result=${c.successfulResultAt ?? "null"}; ${c.intervalScope}/${c.intervalTimingEvidence}`);
  lines.push(`Resolved-only distributions ${a.distributions === null ? "unavailable; shown=0; total=unknown; omitted=unknown" : shown(distributions.length, a.distributions.length)}`);
  for (const d of distributions) lines.push(`${d.id}: session=${d.sessionId}; ${d.intervalScope}/${d.intervalTimingEvidence}`,
    `  Resolved n=${d.n}; median/p50 ms=${d.p50Ms}; p95 ms=${d.p95Ms}; min/max ms=${d.minMs}/${d.maxMs}; low-sample p95=${d.lowSampleP95} (n < 20)`);
  lines.push("Limits: One stored source prefix and exact Codex turn/operation subset; no freshness or other-source checks. Recovery may include other work or waiting. Unavailable groups are not unresolved chains; resolved-only distributions exclude unresolved and unavailable work. Native records do not prove physical execution, equal errors, Retry Loop, runtime, causation, waste or savings. Generic Codex nonzero status may be unknown; Claude recovery is unsupported. Preserve required work, validation and success criteria.",
    `crossSourceReconciled=${a.crossSourceReconciled}; aggregationReady=${a.aggregationReady}; parserResumeReady=${a.parserResumeReady}; sourceFreshnessChecked=${a.sourceFreshnessChecked}`);
  return lines.join("\n") + "\n";
}
