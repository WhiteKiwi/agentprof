import type { SourceSummary } from "../analysis/source-summary.js";
import { context, finish } from "./source-display.js";

export function formatCapabilitySummary(s: SourceSummary): string {
  return finish([...context("AgentProf source-local parser capability summary", s), `Observed shape n=${s.capabilities?.observedShapes.length ?? "unavailable"}`, "Limits: Recognized source-prefix evidence only; no provider-wide support or product completeness claim. Complete machine-readable evidence remains available with --json."]);
}
