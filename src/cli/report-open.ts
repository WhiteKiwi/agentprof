import { SafeError, safeErrorEnvelope } from "../privacy/diagnostics.js";
import type { DiagnosticCode } from "../privacy/diagnostics.js";
import { validateReportPath } from "../report/write-output.js";
import { validateSourceSelection } from "./stats.js";
import { runReport, formatReportResult } from "./report.js";
import type { ReportArguments, ReportResult } from "./report.js";
import { runOpen } from "./open.js";
import type { OpenResult } from "./open.js";

export type ReportOpenOutcome = OpenResult
  | Readonly<{ status: "skipped"; reason: "target_unverified" | "aborted"; browserVerified: false }>
  | Readonly<{ status: "failed"; error: Readonly<{ code: DiagnosticCode; message: string }>; browserVerified: false }>;
export type ReportAndOpenResult = ReportResult & Readonly<{ open: ReportOpenOutcome }>;

/** Keep validation before generation, including direct internal workflow calls. */
export type ReportOpenInternalOptions = Readonly<{ expectedRevision?: number; signal?: AbortSignal }>;
export async function runReportAndOpen(options: ReportArguments, internal: ReportOpenInternalOptions = {}): Promise<ReportAndOpenResult> {
  if ((options.codexRoot?.length ?? 0) || (options.claudeRoot?.length ?? 0)) throw new SafeError("INVALID_ARGUMENT");
  if (options.source !== undefined) validateSourceSelection(options.source);
  if (options.output !== undefined) validateReportPath(options.output);
  if (options.dataDir !== undefined) validateReportPath(options.dataDir);
  if (options.output !== undefined) {
    if (!/\.(?:html|htm)$/i.test(options.output)) throw new SafeError("OPEN_FILE_UNSAFE");
    if (/[\uD800-\uDFFF]/u.test(options.output)) throw new SafeError("INVALID_ARGUMENT");
  }
  if (options.source === undefined || options.output === undefined) throw new SafeError("REPORT_SELECTION_REQUIRED");

  // Generation failures remain prepublication failures; catch only opening errors.
  const publication = await (internal.expectedRevision === undefined ? runReport(options) : runReport(options, { expectedRevision: internal.expectedRevision }));
  let open: ReportOpenOutcome;
  if (internal.signal?.aborted) {
    open = Object.freeze({ status: "skipped", reason: "aborted", browserVerified: false });
  } else if (publication.published !== true || publication.targetVerification !== "verified") {
    open = Object.freeze({ status: "skipped", reason: "target_unverified", browserVerified: false });
  } else {
    try { open = await runOpen({ file: publication.output }); }
    catch (error) {
      open = Object.freeze({ status: "failed", error: Object.freeze(safeErrorEnvelope(error).error), browserVerified: false });
    }
  }
  return Object.freeze({ ...publication, open });
}

export function reportAndOpenExitCode(result: ReportAndOpenResult): 0 | 1 {
  return result.status === "published" && result.open.status === "accepted" ? 0 : 1;
}

export function formatReportAndOpenResult(result: ReportAndOpenResult, json: boolean): string {
  if (json) return JSON.stringify({ schema: "agentprof.cli/v1", ok: reportAndOpenExitCode(result) === 0, command: "report", result }) + "\n";
  const outcome = result.open.status === "accepted" ? `Open request accepted by ${result.open.opener}.`
    : result.open.status === "skipped" ? (result.open.reason === "aborted" ? "Open request skipped: the workflow was aborted." : "Open request skipped: the published target is unverified.")
    : `Open request failed: ${result.open.error.message}`;
  return formatReportResult(result, false) + `${outcome}\nBrowser rendering is not verified.\n`;
}
