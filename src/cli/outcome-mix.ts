import type { SourceSummary } from "../analysis/source-summary.js";
import { context, finish, mix } from "./source-display.js";

export function formatOutcomeMix(s: SourceSummary): string {
  return finish([...context("AgentProf source-local execution outcome mix", s), ...mix("Outcome inventory", s.inventory.eventOutcomes), "Limits: Normalized inventory only; unknown is retained and non-success is not automatically failure. Complete machine-readable evidence remains available with --json."]);
}
