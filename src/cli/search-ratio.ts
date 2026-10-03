import type { SourceSearchRecurrenceAnalysis } from "../analysis/source-search-recurrence.js";
import { bounded, counts, finish, omission, value } from "./source-display.js";
import { nativeContext } from "./source-native-context.js";
export function formatSearchRatio(a: SourceSearchRecurrenceAnalysis): string {
  const { unit: classificationUnit, ...classification } = a.searchClassification, { unit: admissionUnit, ...admission } = a.completedSearchAdmission, p = a.inheritedProvenance;
  const rows = bounded(a.partitions, p => p.sessionId);
  return finish([...nativeContext("AgentProf source-local search repeat ratio", a), `Classification (${classificationUnit}): ${counts(classification)}`, `Admission (${admissionUnit}): ${counts(admission)}`,
    `Native provenance: unresolved=${p.unresolvedEvents}; ${counts(p.failures)}; exclusions=${counts(p.exclusions)}`, omission("Partitions", rows.length, a.partitions.length),
    ...rows.map(p => `session=${p.sessionId}; status=${p.status}; reason=${p.reason ?? "none"}; ${`valid searches=${value(p.validSearchN)}; unique lookups=${value(p.uniqueLookupN)}; repeats=${value(p.repeatN)}; ratio=${value(p.repeatRatio)}`}`),
    "Limits: Exact normalized lookup recurrence only; not semantic similarity, equal results or waste. Complete partitions, coverage and contributing evidence remain available with --json."]);
}
