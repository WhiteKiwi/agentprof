import type { SourceInvocationOverlapAnalysis } from "../analysis/source-invocation-overlap.js";
const value = (n: number | null) => n === null ? "null" : String(n);
const counts = (row: Readonly<Record<string, number>>) => Object.entries(row).map(([key, n]) => `${key}=${n}`).join("; ");
/** Fixed human row cap only; JSON and analysis retain every bounded partition/reference. */
export function formatSourceInvocationOverlap(a: SourceInvocationOverlapAnalysis): string {
  const sessions = a.partitions.slice(0, 6);
  const lines = [
    "AgentProf observed source-local invocation interval union", `Source: ${a.sourceId}`,
    `${a.provider}; revision=${a.revision}; source bytes [0,${a.completedOffset})/${a.observedSize}; availability=${a.availability}; ${a.persistedScope}`,
    `Assessment=${a.assessment}; suppression=${a.suppressionReason ?? "none"}; parser/normalization/key=${a.parserVersion}/${a.normalizationVersion}/${a.keyVersion}`,
    `Support=${a.capabilities?.support ?? "unknown"}; coverage=${a.capabilities?.coverage ?? "unknown"}; query period=null; prefix is not a complete history or date range`,
    `Inventory: events=${a.inventory.events}; ${counts(a.inventory.eventStatuses)}`,
    `Inherited admission: tentative=${a.inheritedAdmission.tentativeTerminalCalls}; admitted=${a.inheritedAdmission.admittedTerminalCalls}; exclusions: ${counts(a.inheritedAdmission.exclusions)}`,
    `Inherited provenance: unresolved=${a.inheritedProvenance.unresolvedEvents}; ${counts(a.inheritedProvenance.failures)}`,
    `Sessions shown=${sessions.length}/${a.partitions.length}; omitted=${a.partitions.length - sessions.length}; order is deterministic, not ranking or chronology`,
    "Coverage completeness is relative to admitted terminals only; capabilities and inherited exclusions are separate. Complete inventory/proofs: --json",
  ];
  for (const p of sessions) lines.push(`${p.id} session: ${p.sessionId}`,
    `  ${p.status}; reason=${p.reason ?? "none"}; ${p.intervalScope}/${p.intervalTimingEvidence}; unit=${p.unit}`,
    `  Coverage: admitted=${p.coverage.admittedTerminalN}; positioned=${p.coverage.positionedN}; excluded=${p.coverage.excludedN}; unsafe differences=${p.coverage.unsafeDifferenceN}; complete=${p.coverage.complete}`,
    `  Interval exclusions: ${counts(p.coverage.exclusions)}`,
    `  Length sum=${value(p.intervalLengthSumMs)} ms; union=${value(p.intervalUnionMs)} ms; excess=sum-union=${value(p.excessMs)} ms`,
    `  Evidence IDs not displayed: contributing events=${p.contributingEventIds.length}; observations=${p.evidenceObservationIds.length}; see --json`);
  lines.push(`Meaning: ${a.guidance.meaning}`, `Limits: ${a.guidance.limitations.join(" ")}`,
    `Necessary-overlap counterexample: ${a.guidance.necessaryOverlapCounterexample}`, `Investigative action: ${a.guidance.investigativeAction}`,
    `Optional matched experiment: ${a.guidance.matchedExperiment}`, `Quality guardrail: ${a.guidance.qualityGuardrail}`,
    `Complete omitted evidence: --json. crossSourceReconciled=${a.crossSourceReconciled}; aggregationReady=${a.aggregationReady}; parserResumeReady=${a.parserResumeReady}; sourceFreshnessChecked=${a.sourceFreshnessChecked}`);
  return lines.join("\n") + "\n";
}
