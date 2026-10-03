import type { SourceToolBusyAnalysis } from "../analysis/source-tool-busy.js";
import { bounded, counts, finish, omission, value } from "./source-display.js";
import { nativeContext, partitionReasons } from "./source-native-context.js";
export function formatSourceToolBusy(a: SourceToolBusyAnalysis): string {
  const p = a.inheritedProvenance, e = a.intervalEligibility;
  const rows = bounded(a.partitions, p => JSON.stringify([p.sessionId, p.intervalScope, p.intervalTimingEvidence]));
  return finish([...nativeContext("AgentProf observed source-local tool busy time", a), `Excluded raw events=${a.excluded}; admitted native terminal=${a.inheritedAdmission.admittedTerminalCalls}; tentative terminal=${a.inheritedAdmission.tentativeTerminalCalls}`,
    `Native exclusions: ${counts(a.inheritedAdmission.exclusions)}`, `Native provenance: unresolved=${p.unresolvedEvents}; ${counts(p.failures)}`,
    `Interval eligibility: admitted=${e.admittedTerminalN}; positioned=${e.positionedN}; excluded=${e.excludedN}; ${counts(e.exclusions)}`,
    partitionReasons(a.partitions), omission("Tool-busy partitions", rows.length, a.partitions.length), ...rows.flatMap(p => [`session=${p.sessionId}; ${p.intervalScope}/${p.intervalTimingEvidence}; status=${p.status}; reason=${p.reason ?? "none"}; n=${p.eventN}; duration sum=${value(p.durationSumMs)} ms; busy union=${value(p.toolBusyMs)} ms`,
      `Coverage: admitted=${p.coverage.admittedTerminalN}; positioned=${p.coverage.positionedN}; excluded=${p.coverage.excludedN}; unsafe difference=${p.coverage.unsafeDifferenceN}; complete=${p.coverage.complete}; ${counts(p.coverage.exclusions)}`]),
    "Limits: supported positioned terminal interval union only; no pooled union, CPU time, task elapsed, waste or savings. Complete partitions and contributing proof/event IDs remain available with --json."]);
}
