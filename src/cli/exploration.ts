import type { SourceExplorationAnalysis } from "../analysis/source-exploration.js";
const value = (n: number | null): string => n === null ? "unavailable" : String(n);

export function formatSourceExploration(a: SourceExplorationAnalysis): string {
  const rows = a.partitions.slice(0, 6), cards = a.candidates?.slice(0, 6) ?? [];
  const lines = ["AgentProf observed exploration patterns (informational)", `Source: ${a.sourceId}`,
    `Provider=${a.provider}; parser=${a.parserVersion}; revision=${a.revision}; prefix=${a.completedOffset}/${a.observedSize} bytes`,
    `Assessment=${a.assessment}; suppression=${a.suppressionReason ?? "none"}; fullHistory=false; sourceFreshnessChecked=false`,
    `Rule=${a.ruleId}/${a.ruleVersion}; closed window=${a.thresholds.windowMs} ms; lookups>=${a.thresholds.minimumLookups}; repeated search>=${a.thresholds.minimumRepeatedSearch}; mutations<=${a.thresholds.maximumMutations}`,
    `Coverage=${a.capabilities?.coverage ?? "unknown"}; unsupported=${value(a.capabilities?.unsupportedRecords ?? null)}; unresolved native events=${a.inheritedProvenance.unresolvedEvents}`,
    `Partitions: shown=${rows.length}/${a.partitions.length}; omitted=${a.partitions.length - rows.length}`];
  for (const p of rows) lines.push(`${p.id}: session=${p.sessionId}; status=${p.status}`,
    `  lookups: completed=${p.observedCompletedLookupN}; positioned=${p.positionedLookupN}; excluded=${p.excludedLookupN}; mutations=${p.mutationN}; opaque=${p.opaqueN}`,
    `  evaluated endpoints=${value(p.windowEndpointsEvaluated)}; numeric-qualified=${value(p.numericQualifiedWindows)}; opaque-blocked=${value(p.opaqueBlockedWindows)}; unresolved=${p.unresolvedEventIds.length}; reasons=${p.reasons.join(",") || "none"}`);
  lines.push(`Candidates: ${a.candidates === null ? "unavailable; not zero findings" : `shown=${cards.length}/${a.candidates.length}; omitted=${a.candidates.length - cards.length}`}`);
  for (const c of cards) lines.push(`${c.id}: ${c.partitionId}; severity=${c.severity}; [${c.window.startInclusive}, ${c.window.endInclusive}]`,
    `  lookups=${c.lookupN}; largest repeated search=${c.largestRepeatedSearchN}; mutations=${c.mutationN}; selected events=${c.evidenceEventIds.length}; decisive proofs=${c.evidenceObservationIds.length}; included in waste=0`);
  lines.push(`Meaning: ${a.guidance.meaning}`, `Necessary-work counterexample: ${a.guidance.necessaryWorkCounterexample}`,
    `Investigative action: ${a.guidance.investigativeAction}`, `Matched experiment: ${a.guidance.matchedExperiment}`,
    `Quality guardrail: ${a.guidance.qualityGuardrail}`, ...a.guidance.limitations.map(s => `Limit: ${s}`),
    "Complete selected native event/proof references: --json. No candidate is not proof of efficient work.");
  return lines.join("\n") + "\n";
}
