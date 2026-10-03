import { SafeError } from "../privacy/diagnostics.js";
import { renderHistoryPage } from "../report/history-page.js";
import { validateReportPath, writeReportOutput } from "../report/write-output.js";
import { runHistory, validateHistoryArguments } from "./history.js";
import type { HistoryArguments } from "./history.js";

export type HistoryExportArguments = HistoryArguments & Readonly<{ output?: string }>;
export function validateHistoryExportArguments(options: HistoryExportArguments): Readonly<{ output: string; directory: string }> {
  if (typeof options.output !== "string" || !/\.(html|htm)$/i.test(options.output)) throw new SafeError("INVALID_ARGUMENT");
  const output = validateReportPath(options.output);
  const { directory } = validateHistoryArguments(options);
  return Object.freeze({ output, directory });
}
/** The existing history command owns the single pinned analysis. Only the output file is new. */
export async function runHistoryExport(options: HistoryExportArguments) {
  const { output, directory } = validateHistoryExportArguments(options);
  const analysis = await runHistory(options);
  const html = renderHistoryPage(analysis);
  const publication = await writeReportOutput({ output, dataDirectory: directory, html });
  return Object.freeze({ mode: "history_html" as const, analysisAssessment: analysis.assessment,
    selectedSources: analysis.reconciliation.sources.length, dailyPartitions: analysis.days.length, publication });
}
export type HistoryExportResult = Awaited<ReturnType<typeof runHistoryExport>>;
export function historyExportExitCode(result: HistoryExportResult): number {
  return result.publication.status === "published" ? 0 : 1;
}
export function formatHistoryExport(result: HistoryExportResult, json: boolean): string {
  if (json) return JSON.stringify({ schema: "agentprof.cli/v1", ok: historyExportExitCode(result) === 0, command: "history", result }) + "\n";
  const p = result.publication;
  return ["AgentProf history HTML export", `Publication: ${p.status}; assessment=${result.analysisAssessment}`,
    `Output: ${p.output}`, `Bytes: ${p.bytes}; sources=${result.selectedSources}; daily partitions=${result.dailyPartitions}`,
    `Target verification=${p.targetVerification}; durability=${p.durability}; cleanup=${p.cleanup}`,
    `Warnings: ${p.warnings.join(", ") || "none"}`,
    "No raw logs, persistent identities, browser opening, source freshness check or complete-history claim.", ""].join("\n");
}
