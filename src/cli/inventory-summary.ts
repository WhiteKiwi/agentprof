import type { SourceSummary } from "../analysis/source-summary.js";
import { context, finish } from "./source-display.js";

export function formatInventorySummary(s: SourceSummary): string {
  return finish([...context("AgentProf source-local inventory summary", s), `Inventory scope=${s.persistedScope}; availability=${s.availability}`, "Limits: Bounded stored source-prefix inventory only; no full history or global totals. Complete machine-readable evidence remains available with --json."]);
}
