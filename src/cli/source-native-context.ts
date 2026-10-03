import type { SourceFailureAnalysis } from "../analysis/source-failures.js";
import { counts, value } from "./source-display.js";

type Context = Pick<SourceFailureAnalysis, "sourceId" | "provider" | "revision" | "completedOffset" | "observedSize" | "scope" | "availability" | "persistedScope" | "capabilities"> & { assessment: string; suppressionReason: string | null; inventory: Pick<SourceFailureAnalysis["inventory"], "events" | "turns" | "usage" | "observations" | "diagnostics" | "eventStatuses"> };
export function nativeContext(title: string, a: Context): string[] {
  const i = a.inventory, c = a.capabilities;
  return [title, `Source: ${a.sourceId}; provider=${a.provider}; revision=${a.revision}; source bytes [0,${a.completedOffset})/${a.observedSize}`,
    `Scope: ${a.scope}; availability=${a.availability}; evidence=${a.persistedScope}; assessment=${a.assessment}; suppression=${a.suppressionReason ?? "none"}`,
    "sourceFreshnessChecked=false; crossSourceReconciled=false; aggregationReady=false; parserResumeReady=false",
    `Inventory: events=${i.events}; turns=${value(i.turns)}; stored usage rows=${value(i.usage)}; observations=${value(i.observations)}; diagnostics=${value(i.diagnostics)}`,
    `Event status inventory: ${counts(i.eventStatuses)}`,
    c === null ? "Capabilities: unavailable" : `Capabilities: parser version=${c.parserVersion}; support=${c.support}; coverage=${c.coverage}; unsupported records=${c.unsupportedRecords}; ambiguous records=${c.ambiguousRecords}; state limited=${c.stateLimited}; dropped diagnostics=${c.diagnosticsDropped}`,
    `Observed shapes: ${c?.observedShapes.join(",") || "none"}`];
}
