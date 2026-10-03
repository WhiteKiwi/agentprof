import type { SourceSummary } from "../analysis/source-summary.js";
import { bounded, context, finish, omission } from "./source-display.js";

function shapeDetails(s: SourceSummary): string[] {
  if (s.capabilities === null) return ["Shape coverage: unavailable"];
  const all = s.capabilities.observedShapes, rows = bounded(all, x => x);
  return [omission("Observed shapes", rows.length, all.length), ...rows.map(x => `shape: ${x}`)];
}

export function formatShapeCoverage(s: SourceSummary): string {
  return finish([...context("AgentProf source-local observed shape coverage", s), ...shapeDetails(s), "Limits: Observed source-prefix shapes only; no provider-wide feature coverage. Complete machine-readable evidence remains available with --json."]);
}
