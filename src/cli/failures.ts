import type { FailureCohort, SourceFailureAnalysis } from "../analysis/source-failures.js";
const CAPS = { sessions: 6, cohorts: 3, measurements: 3, patternCharacters: 80 } as const;
const value = (n: number | null): string => n === null ? "unknown" : String(n);
const counts = (map: Readonly<Record<string, number>>): string => Object.entries(map).map(([k,n]) => `${k}=${n}`).join("; ");
const exclusions = (map: Readonly<Record<string, number>>): string => (Object.entries(map).filter(([,n]) => n !== 0).map(([k,n]) => `${k}=${n}`).join("; ") || "none") + " (unlisted=0)";
function wrap(line: string): string[] {
  const lines: string[] = [];
  while (line.length > 120) {
    let at = line.lastIndexOf(" ", 120); if (at < 1) at = line.indexOf(" ", 120); if (at < 1) break;
    lines.push(line.slice(0, at)); line = line.slice(at + 1);
  }
  lines.push(line); return lines;
}
const displayCount = (shown: number, total: number) => `shown=${shown}/${total}; omitted=${total-shown}`;
function pattern(value: string | null): string {
  if (value === null) return "unknown";
  // The validated stored safe-pattern vocabulary is ASCII. No raw command is accepted here.
  const shown = Math.min(value.length, CAPS.patternCharacters);
  return value.slice(0,shown) + (shown < value.length ? `... [pattern characters ${displayCount(shown,value.length)}]` : "");
}
/** Bounded human presentation only. Analysis and JSON retain every row and reference. */
export function formatSourceFailures(a: SourceFailureAnalysis): string {
  const lines: string[] = [];
  const add = (line: string) => { for (const part of wrap(line)) lines.push(part); };
  const buckets = new Map<string, FailureCohort[]>();
  for (const c of a.cohorts ?? []) { const rows=buckets.get(c.partitionId); if (rows) rows.push(c); else buckets.set(c.partitionId,[c]); }
  const shownPartitions=a.partitions.slice(0,CAPS.sessions);
  let shownCohorts=0;
  for (const p of shownPartitions) shownCohorts += Math.min(buckets.get(p.id)?.length ?? 0,CAPS.cohorts);
  add("AgentProf confirmed source-local failure evidence"); add(`Source: ${a.sourceId}`);
  add(`${a.provider}; revision=${a.revision}; source bytes [0,${a.completedOffset})/${a.observedSize}; availability=${a.availability}; ${a.persistedScope}`);
  add(`Assessment=${a.assessment}; suppression=${a.suppressionReason ?? "none"}; reason=${a.failureAssessmentReason ?? "none"}; coverage=${a.capabilities?.coverage ?? "unknown"}`);
  add(`Parser/normalization/key=${a.parserVersion}/${a.normalizationVersion}/${a.keyVersion}; support=${a.capabilities?.support ?? "unknown"}; no freshness or cross-source check`);
  add("Coverage warning: generic Codex nonzero exits (e.g. npm test exit 2) may be unknown. Counts are admitted subsets, not an overall failure rate.");
  add(`Raw inventory (not confirmed counts): events=${a.inventory.events}; ${counts(a.inventory.eventStatuses)}`);
  add(`Status eligibility: tentative=${a.eligibility.tentativeTerminalCalls}; admitted=${a.eligibility.admittedTerminalCalls}; exclusions: ${exclusions(a.eligibility.exclusions)}`);
  add(`Unresolved provenance=${a.provenance.unresolvedEvents}; ${counts(a.provenance.failures)}; full inventory/capabilities in --json`);
  add(`Sessions ${displayCount(shownPartitions.length,a.partitions.length)}; cohorts ${a.cohorts === null ? "unknown" : displayCount(shownCohorts,a.cohorts.length)}; deterministic order, not ranking; full evidence: --json`);
  for (const p of shownPartitions) {
    add(`${p.id} session: ${p.sessionId}`);
    add(`  ${p.status}: confirmed failed ${value(p.failedN)} / admitted terminal ${value(p.terminalN)}; completed=${value(p.completedN)}; excluded unknown status=${p.exclusions.unknown_status}`);
    add(`  Exclusions: ${exclusions(p.exclusions)}; unresolved=${p.unresolvedEventIds.length}`);
    const all=buckets.get(p.id) ?? [], selected=all.slice(0,CAPS.cohorts);
    add(`  Failure cohorts ${displayCount(selected.length,all.length)}${p.status !== "evaluated" ? " (assessment unavailable)" : ""}`);
    for (const c of selected) {
      add(`  ${c.id}: ${c.group.kind}/${c.group.category}/${c.group.toolName ?? "unknown"}; pattern=${pattern(c.group.commandPattern)}; ${c.grouping}`);
      add(`  Failed=${c.failedN}; missing operation/error identity=${c.missingOperationIdentityN}/${c.missingErrorIdentityN}; measured ${c.timing.measuredN} / confirmed failed ${c.failedN}`);
      add(`  Timing exclusions: ${exclusions(c.timing.exclusions)}`);
      add(`  Proof IDs: events ${displayCount(0,c.eventIds.length)}; observations ${displayCount(0,c.evidenceObservationIds.length)}; see --json`);
      const measurements=c.measurements.slice(0,CAPS.measurements);
      add(`  Measurements ${displayCount(measurements.length,c.measurements.length)}${c.measurements.length === 0 ? "; duration unknown, not 0 ms" : ""}`);
      for (const m of measurements) {
        add(`  ${m.id} ${m.durationScope}/${m.timingEvidence}/${m.measurementBasis}: n=${m.n}/${m.confirmedFailedN}; sum=${value(m.sumMs)} ms; mean=${value(m.meanMs)} ms; max=${m.maxMs} ms; p50=${m.p50Ms} ms; p95=${m.p95Ms} ms; low-N=${m.lowSampleP95}`);
        if (m.limitations.includes("numeric_overflow")) add("  numeric_overflow: sum/mean unknown; count and quantiles retained");
        if (m.limitations.includes("claude_direct_duration_synthetic_contract_only")) add("  Claude direct duration: synthetic contract only; no empirical support promotion");
      }
    }
  }
  add("Limits: source-prefix admitted native records only; excluded unknowns do not prove failure absence. Safe/coarse display cohorts do not establish same task or error. Recorded sums may overlap; no elapsed/busy time, retries, waste or savings inferred.");
  add(`Necessary-failure counterexample: ${a.guidance.necessaryFailureCounterexample}`);
  add(`Investigative action: ${a.guidance.investigativeAction}`);
  add(`Optional matched experiment: ${a.guidance.matchedExperiment}`);
  add(`Quality guardrail: ${a.guidance.qualityGuardrail}`);
  add(`Complete data and omitted evidence: --json. crossSourceReconciled=${a.crossSourceReconciled}; aggregationReady=${a.aggregationReady}; parserResumeReady=${a.parserResumeReady}; sourceFreshnessChecked=${a.sourceFreshnessChecked}`);
  return lines.join("\n") + "\n";
}
