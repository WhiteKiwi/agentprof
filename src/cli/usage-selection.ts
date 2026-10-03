import type { SourceSummary } from "../analysis/source-summary.js";
import { context, finish, mix, usageContext } from "./source-display.js";

export function formatUsageSelection(s: SourceSummary): string {
  return finish([...context("AgentProf source-local usage selection mix", s), ...usageContext(s), ...mix("Usage selection inventory", s.inventory.usageSelections), "Limits: Stored selection evidence only; only eligible final responses feed token totals. Complete machine-readable evidence remains available with --json."]);
}
