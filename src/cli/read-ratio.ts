import type { SourceReadRevisitAnalysis } from "../analysis/source-read-revisits.js";
import { bounded, counts, finish, omission, value } from "./source-display.js";
import { nativeContext, partitionReasons } from "./source-native-context.js";
export function formatReadRatio(a: SourceReadRevisitAnalysis): string {
  const { unit: classificationUnit, ...classification } = a.readClassification, { unit: admissionUnit, ...admission } = a.completedReadAdmission, p = a.inheritedProvenance;
  const rows = bounded(a.partitions, p => p.sessionId);
  return finish([...nativeContext("AgentProf source-local read revisit ratio", a), `Classification (${classificationUnit}): ${counts(classification)}`, `Admission (${admissionUnit}): ${counts(admission)}`,
    `Native provenance: unresolved=${p.unresolvedEvents}; ${counts(p.failures)}; exclusions=${counts(p.exclusions)}`, partitionReasons(a.partitions), omission("Partitions", rows.length, a.partitions.length),
    ...rows.map(p => `session=${p.sessionId}; status=${p.status}; reason=${p.reason ?? "none"}; ${`valid reads=${value(p.validReadN)}; unique files=${value(p.uniqueFileN)}; revisits=${value(p.revisitN)}; ratio=${value(p.revisitRatio)}`}`),
    "Limits: Same-file revisit is descriptive; not redundant content or waste. Complete partitions, coverage and contributing evidence remain available with --json."]);
}
