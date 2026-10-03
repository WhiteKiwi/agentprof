import type { SourceSummary } from "../analysis/source-summary.js";
import { context, finish, value } from "./source-display.js";

export function formatDiagnosticInventory(s: SourceSummary): string {
  return finish([...context("AgentProf source-local diagnostic inventory", s), `Stored diagnostics=${value(s.inventory.diagnostics)}`, "Limits: Parser evidence and limits are not application defect counts. Complete machine-readable evidence remains available with --json."]);
}
