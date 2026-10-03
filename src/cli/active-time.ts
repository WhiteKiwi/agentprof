import type { SourceActiveTimeAnalysis } from "../analysis/source-active-time.js";
const value = (n: number | null): string => n === null ? "unavailable" : String(n);
const references = (ids: readonly string[]): string => `${ids.slice(0, 2).join(", ") || "none"}; omitted=${Math.max(0, ids.length - 2)}`;
export function formatSourceActiveTime(a: SourceActiveTimeAnalysis): string {
  const capabilities = a.capabilities;
  const lines = ["AgentProf observed source-local Active Time", `Source: ${a.sourceId}`,
    `${a.provider}; parser=${a.parserVersion}; normalization=${a.normalizationVersion}; key=${a.keyVersion}; revision=${a.revision}; source bytes [0,${a.completedOffset})/${a.observedSize}`,
    `Availability=${a.availability}; evidence=${a.persistedScope}; suppression=${a.suppressionReason ?? "none"}`,
    `Assessment=${a.assessment}; reason=${a.activeTimeAssessmentReason ?? "none"}; eligible turns=${value(a.summary.eligibleTurns)}; excluded=${value(a.summary.excludedTurns)}; partitions=${value(a.summary.partitions)}`,
    `Capabilities: provider=${capabilities?.provider ?? "unknown"}; parser=${capabilities?.parserVersion ?? "unknown"}; support=${capabilities?.support ?? "unknown"}; coverage=${capabilities?.coverage ?? "unknown"}`,
    `Capabilities: unsupported=${capabilities?.unsupportedRecords ?? "unknown"}; ambiguous=${capabilities?.ambiguousRecords ?? "unknown"}; stateLimited=${capabilities?.stateLimited ?? "unknown"}; droppedDiagnostics=${capabilities?.diagnosticsDropped ?? "unknown"}`,
    `Observed shapes: ${capabilities?.observedShapes.join(", ") || "unknown"}`,
    `Inventory: ${Object.entries(a.inventory).filter(([, n]) => n === null || typeof n === "number").map(([k, n]) => `${k}=${value(n as number | null)}`).join("; ")}`,
    `Exclusions: ${a.exclusions === null ? "unavailable" : Object.entries(a.exclusions).map(([k, n]) => `${k}=${n}`).join("; ")}`,
    "Active Time is the union of positioned turn intervals. Observed span includes gaps; Active Time does not."];
  if (a.partitions === null) lines.push(`Partition detail: unavailable (${a.activeTimeAssessmentReason})`);
  else {
    lines.push(`Partition detail: shown=${Math.min(6, a.partitions.length)}; omitted=${Math.max(0, a.partitions.length - 6)}`);
    for (const p of a.partitions.slice(0, 6)) {
      const proofIds = [...new Set(p.turnEvidence.flatMap(t => t.evidenceObservationIds))].sort();
      lines.push(`${p.id}: session=${p.sessionId}; ${p.intervalScope}/${p.intervalTimingEvidence}; turns=${p.turnN}; active=${value(p.activeTimeMs)} ms (${p.activeTimeReason ?? "none"}); span=${value(p.observedSpanMs)} ms (${p.observedSpanReason ?? "none"})`,
        `  Turn IDs: ${references(p.turnIds)}`, `  Observation IDs: ${references(proofIds)}`);
    }
  }
  lines.push(`Window=${a.observationWindow.unit}[${a.observationWindow.startInclusive},${a.observationWindow.endExclusive}); queryPeriod=${a.queryPeriod}; sourceFreshnessChecked=${a.sourceFreshnessChecked}; crossSourceReconciled=${a.crossSourceReconciled}; aggregationReady=${a.aggregationReady}; parserResumeReady=${a.parserResumeReady}`,
    `Limits: ${a.limitations.join("; ")}`, "Complete admitted turn endpoints, proof IDs and excluded-turn reasons are available with --json.");
  return lines.join("\n") + "\n";
}
