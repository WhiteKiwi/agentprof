import type { SourceSummary } from "../analysis/source-summary.js";
import { context, counts, durationContext, finish } from "./source-display.js";

export function formatSourceExecutionStatus(s: SourceSummary): string {
  return finish([...context("AgentProf source-local execution status", s), ...durationContext(s), `Statuses: ${counts(s.inventory.eventStatuses)}`, `Outcomes: ${counts(s.inventory.eventOutcomes)}`, "Limits: Inventory statuses are not confirmed native failure denominators; no failure rate is inferred. Complete machine-readable evidence remains available with --json."]);
}
