import type { SourceSummary } from "../analysis/source-summary.js";
import { context, finish, mix, usageContext } from "./source-display.js";

export function formatUsageFinality(s: SourceSummary): string {
  return finish([...context("AgentProf source-local usage finality mix", s), ...usageContext(s), ...mix("Usage finality inventory", s.inventory.usageFinalities), "Limits: Inventory finality only; provisional or unknown rows are not promoted to final token totals. Complete machine-readable evidence remains available with --json."]);
}
