import type { SourceSummary } from "../analysis/source-summary.js";

const value = (n: number | null): string => n === null ? "unknown" : String(n);
const counts = (map: Readonly<Record<string, number>> | null): string => map === null ? "unknown"
  : Object.entries(map).map(([key, n]) => `${key}=${n}`).join("; ");

// Copy the pinned summary's context; this helper neither interprets nor mutates it.
export function sourceSummaryContext(s: SourceSummary): string[] {
  const inventory = s.inventory, capabilities = s.capabilities;
  const lines = [
    `Source: ${s.sourceId}`,
    `Provider: ${s.provider}; revision=${s.revision}; source bytes [0,${s.completedOffset})/${s.observedSize}`,
    `Scope: ${s.scope}; availability=${s.availability}; evidence=${s.persistedScope}; suppression=${s.suppressionReason ?? "none"}`,
    "sourceFreshnessChecked=false; crossSourceReconciled=false; aggregationReady=false; parserResumeReady=false",
    `Coverage: ${capabilities?.coverage ?? "unknown"}; support=${capabilities?.support ?? "unknown"}; parser version=${capabilities?.parserVersion ?? "unknown"}`,
    `Inventory: events=${inventory.events}; turns=${value(inventory.turns)}; stored usage rows=${value(inventory.usage)}; observations=${value(inventory.observations)}; diagnostics=${value(inventory.diagnostics)}`,
    `Event status inventory: ${counts(inventory.eventStatuses)}`,
    `Event outcome inventory: ${counts(inventory.eventOutcomes)}`,
    `Usage selection inventory: ${counts(inventory.usageSelections)}`,
    `Usage finality inventory: ${counts(inventory.usageFinalities)}`,
  ];
  if (capabilities === null) lines.push("Capabilities: unknown");
  else lines.push(
    `Capabilities: unsupported records=${capabilities.unsupportedRecords}; ambiguous records=${capabilities.ambiguousRecords}; state limited=${capabilities.stateLimited}; dropped diagnostics=${capabilities.diagnosticsDropped}`,
    `Observed shapes: ${capabilities.observedShapes.join(", ") || "none"}`,
  );
  lines.push(`Source limitations: ${s.limitations.join(", ") || "none"}`);
  return lines;
}
