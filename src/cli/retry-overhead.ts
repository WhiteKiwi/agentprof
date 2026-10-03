import type { SourceRetryOverheadAnalysis } from "../analysis/source-retry-overhead.js";

const value = (n: number | null): string => n === null ? "unavailable" : String(n);
const shown = (n: number, total: number): string => `shown=${n}/${total}; omitted=${total - n}`;
const counts = (rows: Readonly<Record<string, number | undefined>>): string => Object.entries(rows).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([reason, n]) => `${reason}=${n}`).join(", ") || "none";
const references = (rows: readonly string[]): string => `${shown(Math.min(rows.length, 2), rows.length)}; ${rows.slice(0, 2).join(", ") || "none"}`;

export function formatSourceRetryOverhead(a: SourceRetryOverheadAnalysis): string {
  const chains = a.chains?.slice(0, 6) ?? [], durations = a.durationCohorts?.slice(0, 6) ?? [], intervals = a.intervalPartitions?.slice(0, 6) ?? [];
  const context = a.recoveryContext, sessions = context.blockedPartitions.slice(0, 6), groups = context.unavailableGroups.slice(0, 6);
  const lines = [
    "AgentProf observed source-local retry overhead",
    `Source: ${a.sourceId}`,
    `${a.provider}; revision=${a.revision}; source bytes [0,${a.completedOffset})/${a.observedSize}; parser=${a.parserVersion}; normalization=${a.normalizationVersion}; key=${a.keyVersion}`,
    `Availability=${a.availability}; persisted=${a.persistedScope}; support=${a.capabilities?.support ?? "unknown"}; coverage=${a.capabilities?.coverage ?? "unknown"}; unsupported records=${a.capabilities?.unsupportedRecords ?? "unknown"}`,
    `Assessment=${a.assessment}; suppression=${a.suppressionReason ?? "none"}; recovery reason=${a.recoveryAssessmentReason ?? "none"}`,
    `Readiness: aggregation=${a.aggregationReady}; parser resume=${a.parserResumeReady}; freshness checked=${a.sourceFreshnessChecked}; cross-source reconciled=${a.crossSourceReconciled}; query period=none`,
    `Admitted chains: total=${value(a.summary.chainN)}; resolved=${value(a.summary.resolvedChainN)}; unresolved=${value(a.summary.unresolvedChainN)}; measured intervals=${value(a.summary.measuredChainN)}`,
    `Admitted failed attempts=${value(a.summary.failedAttemptN)}; measured durations=${value(a.summary.measuredFailedAttemptN)}; unavailable durations=${value(a.summary.unavailableDurationAttemptN)}`,
    `Admitted failed duration sum=${value(a.summary.failedAttemptDurationSumMs)} ms; reason=${a.summary.failedAttemptDurationSumReason ?? "none"}; retry overhead union=${value(a.summary.retryOverheadMs)} ms; reason=${a.summary.retryOverheadReason ?? "none"}`,
    `Duration exclusions: ${a.durationCoverage === null ? "unavailable" : counts(a.durationCoverage.exclusions)} (unlisted reasons=0)`,
    `Recovery context: evaluated groups=${context.summary.evaluatedGroups}; unavailable groups=${context.summary.unavailableGroups}; unavailable sessions=${context.summary.unavailableSessions}; known failures=${context.summary.knownFailedAttempts}; blocked known failures=${context.summary.unavailableKnownFailedAttempts}; unresolved provenance=${context.inheritedProvenance.unresolvedEvents}`,
    `Recovery classification: candidate attempts=${context.classification.candidateAttempts}; models excluded=${context.classification.modelExcluded}; unsupported classes excluded=${context.classification.unsupportedClassExcluded}`,
    "Values describe admitted Recovery chains only. Stored failed duration and interval union are separate; success duration and gaps are excluded.",
    `Duration cohorts: ${a.durationCohorts === null ? "unavailable" : shown(durations.length, a.durationCohorts.length)}`
  ];
  for (const c of durations) lines.push(
    `${c.id}: session=${c.sessionId}; ${c.durationScope}/${c.timingEvidence}; measured=${c.n}; sum=${value(c.sumMs)} ms${c.sumMs === null ? "; numeric_overflow" : ""}`,
    `  Chains: ${references(c.chainIds)}`
  );
  lines.push(`Interval partitions: ${a.intervalPartitions === null ? "unavailable" : shown(intervals.length, a.intervalPartitions.length)}`);
  for (const p of intervals) lines.push(
    `${p.id}: session=${p.sessionId}; ${p.intervalScope}/${p.intervalTimingEvidence}; failed=${p.failedAttemptN}; union=${value(p.retryOverheadMs)} ms; reason=${p.reason ?? "none"}`,
    `  Chains: ${references(p.chainIds)}`
  );
  lines.push(`Chain detail: ${a.chains === null ? "unavailable" : shown(chains.length, a.chains.length)}`);
  for (const c of chains) lines.push(
    `${c.id}: recovery=${c.recoveryChainId}; group=${c.groupId}; session=${c.sessionId}; turn=${c.turnId}; resolved=${c.resolved}; attempts=${c.attemptCount}; failed=${c.failedAttemptCount}`,
    `  Failed sum=${value(c.failedAttemptDurationSumMs)} ms; reason=${c.failedAttemptDurationSumReason ?? "none"}; durations=${c.durationCoverage.measuredN}/${c.durationCoverage.selectedN}; exclusions=${counts(c.durationCoverage.exclusions)}; overhead=${value(c.retryOverheadMs)} ms; ${c.intervalScope}/${c.intervalTimingEvidence}; success=${c.terminalSuccessEventId ?? "none"}`,
    `  Failed events: ${references(c.failedEventIds)}`,
    `  Proof observations: ${references(c.evidenceObservationIds)}`
  );
  lines.push(`Blocked sessions: ${shown(sessions.length, context.blockedPartitions.length)}`);
  for (const p of sessions) lines.push(
    `${p.id}: session=${p.sessionId}; status=${p.status}; candidates=${p.candidateAttemptN}; reasons=${p.reasons.join(", ")}`,
    `  Missing operation=${p.missingOperationEventIds.length}; missing turn=${p.missingTurnEventIds.length}; unassigned failed events: ${references(p.unassignedFailedEventIds)}; unresolved provenance events: ${references(p.unresolvedProvenanceEventIds)}`
  );
  lines.push(`Unavailable groups: ${shown(groups.length, context.unavailableGroups.length)}`);
  for (const g of groups) lines.push(
    `${g.id}: partition=${g.partitionId}; turn=${g.turnId}; attempts=${g.attemptN}; known failures=${g.knownFailedAttemptN}; reasons=${g.reasons.join(", ")}`,
    `  Blocked failed events: ${references(g.blockedFailedEventIds)}; proof observations: ${references(g.evidenceObservationIds)}`
  );
  lines.push(`Inherited limits: ${context.limitations.join(", ")}`);
  lines.push("Limits: observed source-prefix subset only; unresolved chains keep observed failure contribution. Necessary retries may be included. No waste, avoidability, root-cause or savings claim.");
  return lines.join("\n") + "\n";
}
