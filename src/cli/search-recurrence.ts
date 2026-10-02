import type { SourceSearchRecurrenceAnalysis } from "../analysis/source-search-recurrence.js";
const value = (n: number | null) => n === null ? "null" : String(n);
const shown = (n: number, total: number) => `shown=${n}/${total}; omitted=${total - n}`;
const counts = (row: Readonly<Record<string, number>>) => Object.entries(row).map(([name, n]) => `${name}=${n}`).join("; ");
/** Human-only fixed row caps. Complete JSON and analysis are never truncated. */
export function formatSourceSearchRecurrence(a: SourceSearchRecurrenceAnalysis): string {
  const sessions = a.partitions.slice(0, 6);
  let totalCohorts = 0, displayedCohorts = 0, unavailableSessions = 0;
  for (const p of a.partitions) { if (p.cohorts === null) unavailableSessions++; else totalCohorts += p.cohorts.length; }
  for (const p of sessions) displayedCohorts += Math.min(p.cohorts?.length ?? 0, 10);
  const { unit: rawUnit, ...raw } = a.searchClassification;
  const { unit: admissionUnit, ...admission } = a.completedSearchAdmission;
  const lines = [
    "AgentProf completed source-local native search recurrence", `Source: ${a.sourceId}`,
    `${a.provider}; revision=${a.revision}; source bytes [0,${a.completedOffset})/${a.observedSize}; availability=${a.availability}; ${a.persistedScope}`,
    `Assessment=${a.assessment}; suppression=${a.suppressionReason ?? "none"}; parser/normalization/key=${a.parserVersion}/${a.normalizationVersion}/${a.keyVersion}`,
    `Support=${a.capabilities?.support ?? "unknown"}; coverage=${a.capabilities?.coverage ?? "unknown"}; query period=null; source prefix is not a date range or complete history`,
    `Raw inventory: events=${a.inventory.events}; ${counts(a.inventory.eventStatuses)}`,
    `Search classification (${rawUnit}): ${counts(raw)}`,
    `Completed admission (${admissionUnit}): ${counts(admission)}; missingLookup is a subset of admitted`,
    `Inherited provenance (${a.inheritedProvenance.unit}): unresolved=${a.inheritedProvenance.unresolvedEvents}; ${counts(a.inheritedProvenance.failures)}; exclusions=${counts(a.inheritedProvenance.exclusions)}`,
    `Sessions ${shown(sessions.length, a.partitions.length)}; search cohorts ${shown(displayedCohorts, totalCohorts)}; unavailable-session cohorts=null (${unavailableSessions} sessions)`,
    "Order is deterministic, not ranking or chronology; search aliases are snapshot-local; complete inventory/capabilities/proof arrays: --json",
  ];
  for (const p of sessions) {
    lines.push(`${p.id} session: ${p.sessionId}`,
      `  ${p.status}; reason=${p.reason ?? "none"}; raw search statuses: ${counts(p.rawSearchStatuses)}`,
      `  Candidates=${p.candidateSearchN}; missing identity=${p.missingLookupN}; N=${value(p.validSearchN)}; U=${value(p.uniqueLookupN)}; repeats=${value(p.repeatN)}; ratio=${value(p.repeatRatio)} (${value(p.repeatN)}/${value(p.validSearchN)})`,
      `  Proof IDs not displayed: candidates=${p.candidateEventIds.length}; missing identity=${p.missingLookupEventIds.length}; see --json`);
    const cohorts = p.cohorts?.slice(0, 10) ?? [];
    lines.push(`  Search cohorts ${p.cohorts === null ? "null; shown=0; total=unknown; omitted=unknown" : shown(cohorts.length, p.cohorts.length)}`);
    for (const c of cohorts) lines.push(`  ${c.id}: invocations=${c.invocationN}; repeats=${c.repeatN}; proof IDs not displayed: events=${c.eventIds.length}; observations=${c.evidenceObservationIds.length}; see --json`);
  }
  lines.push(`Meaning: ${a.guidance.meaning}`, `Limits: ${a.guidance.limitations.join(" ")}`,
    `Necessary-recurrence counterexample: ${a.guidance.necessaryRecurrenceCounterexample}`, `Investigative action: ${a.guidance.investigativeAction}`,
    `Optional matched experiment: ${a.guidance.matchedExperiment}`, `Quality guardrail: ${a.guidance.qualityGuardrail}`,
    `Complete data and omitted evidence: --json. crossSourceReconciled=${a.crossSourceReconciled}; aggregationReady=${a.aggregationReady}; parserResumeReady=${a.parserResumeReady}; sourceFreshnessChecked=${a.sourceFreshnessChecked}`);
  return lines.join("\n") + "\n";
}
