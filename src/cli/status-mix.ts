import type { SourceSummary } from "../analysis/source-summary.js";
import { context, finish, mix } from "./source-display.js";

export function formatStatusMix(s: SourceSummary): string {
  return finish([...context("AgentProf source-local status mix", s), ...mix("Event status inventory mix", s.inventory.eventStatuses), "Limits: Normalized inventory statuses only; no native failure reclassification or failure rate. Complete machine-readable evidence remains available with --json."]);
}
