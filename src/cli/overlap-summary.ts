import type { SourceInvocationOverlapAnalysis } from "../analysis/source-invocation-overlap.js";
import { bounded, counts, finish, omission, value } from "./source-display.js";
import { nativeContext } from "./source-native-context.js";
export function formatOverlapSummary(a: SourceInvocationOverlapAnalysis): string {
  const p = a.inheritedProvenance, rows = bounded(a.partitions, p => JSON.stringify([p.sessionId, p.intervalScope, p.intervalTimingEvidence]));
  return finish([...nativeContext("AgentProf source-local invocation overlap summary", a), `Native admission: tentative=${a.inheritedAdmission.tentativeTerminalCalls}; admitted=${a.inheritedAdmission.admittedTerminalCalls}; ${counts(a.inheritedAdmission.exclusions)}`,
    `Native provenance: unresolved=${p.unresolvedEvents}; ${counts(p.failures)}`, omission("Partitions", rows.length, a.partitions.length),
    ...rows.flatMap(p => [`session=${p.sessionId}; ${p.intervalScope}/${p.intervalTimingEvidence}; status=${p.status}; reason=${p.reason ?? "none"}; positioned=${p.coverage.positionedN}/${p.coverage.admittedTerminalN}; interval sum=${value(p.intervalLengthSumMs)} ms; union=${value(p.intervalUnionMs)} ms; excess=${value(p.excessMs)} ms`,
      `Coverage: excluded=${p.coverage.excludedN}; unsafe difference=${p.coverage.unsafeDifferenceN}; complete=${p.coverage.complete}; ${counts(p.coverage.exclusions)}`]),
    "Limits: excess is multiplicity-weighted overlap, not concurrent wall time, waste or savings. Complete source-wide admission and partition reasons remain available with --json."]);
}
