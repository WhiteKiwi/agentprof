import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { SafeError, safeErrorEnvelope } from "../privacy/diagnostics.js";
import { assertNoSymlink, fileCode, resolveDataDirectory } from "../privacy/paths.js";
import type { Provider } from "../privacy/paths.js";
import type { ScanResult } from "../scanner/scan-run.js";
import { collectScan, formatScanResult, validateCliPath } from "./scan.js";
import { runReport, formatReportResult } from "./report.js";
import type { ReportArguments, ReportResult } from "./report.js";
import { runReportAndOpen, formatReportAndOpenResult, reportAndOpenExitCode } from "./report-open.js";
import type { ReportAndOpenResult } from "./report-open.js";
import { validateReportPath } from "../report/write-output.js";

export type FreshReportArguments = ReportArguments & Readonly<{ provider?: string; input?: string; open?: boolean }>;
type Generation = Readonly<{ sourceId: string; revision: number }>;
type ReportOutcome = ReportResult | ReportAndOpenResult
  | Readonly<{ status: "skipped"; reason: "scan_ineligible" | "aborted" }>
  | Readonly<{ status: "failed"; error: ReturnType<typeof safeErrorEnvelope>["error"] }>;
export type FreshReportResult = Readonly<{ mode: "fresh_input"; provider: Provider; scan: ScanResult; report: ReportOutcome; aborted: boolean }>;

/** Select only the single generation proven by this invocation's scan receipt. */
export function selectFreshReportGeneration(scan: ScanResult, provider: Provider): Generation | null {
  const c = scan.counts;
  if ((scan.status !== "completed" && scan.status !== "partial") || scan.stopReason !== null || scan.discoveryTruncated !== false
    || c.discovered !== 1 || c.attempted !== 1 || scan.sources.length !== 1
    || c.duplicates !== 0 || c.rejected !== 0 || c.stale !== 0 || c.failed !== 0 || c.aborted !== 0) return null;
  const source = scan.sources[0]!;
  if (source.provider !== provider) return null;
  let revision: number | null;
  if (source.status === "committed" && c.committed === 1 && c.unchanged === 0 && source.reusedRevision === null) revision = source.committedRevision;
  else if (source.status === "unchanged" && c.unchanged === 1 && c.committed === 0 && source.committedRevision === null) revision = source.reusedRevision;
  else return null;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision <= 0) return null;
  return Object.freeze({ sourceId: source.sourceId, revision });
}

/** All selection/path validation and stable-path preflight precede bootstrap. */
async function prepare(options: FreshReportArguments): Promise<{ provider: Provider; input: string; dataDir: string; output: string }> {
  if (options.source !== undefined || (options.codexRoot?.length ?? 0) || (options.claudeRoot?.length ?? 0)
    || (options.provider !== "claude" && options.provider !== "codex") || options.input === undefined || options.output === undefined) throw new SafeError("INVALID_ARGUMENT");
  validateCliPath(options.input);
  validateReportPath(options.output);
  if (options.dataDir !== undefined) { validateCliPath(options.dataDir); validateReportPath(options.dataDir); }
  if (options.open === true) {
    if (!/\.(?:html|htm)$/i.test(options.output)) throw new SafeError("OPEN_FILE_UNSAFE");
    if (/[\uD800-\uDFFF]/u.test(options.output)) throw new SafeError("INVALID_ARGUMENT");
  }
  const input = resolve(options.input);
  if (/\.jsonl\.(?:gz|zst|zip|bz2|xz)$/i.test(input)) throw new SafeError("UNSUPPORTED_COMPRESSION");
  if (!input.endsWith(".jsonl")) throw new SafeError("INVALID_ARGUMENT");
  const dataDir = validateReportPath(resolveDataDirectory(options.dataDir === undefined ? {} : { dataDir: options.dataDir }));
  try {
    await assertNoSymlink(input);
    const info = await lstat(input);
    if (!info.isFile() || info.isSymbolicLink()) throw new SafeError("INVALID_ARGUMENT");
  } catch (error) {
    if (error instanceof SafeError) throw error;
    throw new SafeError(fileCode(error) === "ENOENT" ? "INPUT_ROOT_MISSING" : "INPUT_ACCESS_FAILED");
  }
  return { provider: options.provider, input, dataDir, output: options.output };
}

export async function runFreshReport(options: FreshReportArguments): Promise<FreshReportResult> {
  const prepared = await prepare(options);
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on("SIGINT", interrupt);
  try {
    const scan = await collectScan(prepared.dataDir, [{ provider: prepared.provider, path: prepared.input }], controller.signal);
    let report: ReportOutcome;
    const generation = selectFreshReportGeneration(scan, prepared.provider);
    if (controller.signal.aborted || scan.status === "aborted") report = Object.freeze({ status: "skipped", reason: "aborted" });
    else if (generation === null) report = Object.freeze({ status: "skipped", reason: "scan_ineligible" });
    else {
      const selected = { dataDir: prepared.dataDir, source: generation.sourceId, output: prepared.output };
      try {
        report = options.open === true
          ? await runReportAndOpen(selected, { expectedRevision: generation.revision, signal: controller.signal })
          : await runReport(selected, { expectedRevision: generation.revision });
      } catch (error) { report = Object.freeze({ status: "failed", error: Object.freeze(safeErrorEnvelope(error).error) }); }
    }
    return Object.freeze({ mode: "fresh_input", provider: prepared.provider, scan, report, aborted: controller.signal.aborted || scan.status === "aborted" });
  } finally { process.removeListener("SIGINT", interrupt); }
}

export function freshReportExitCode(result: FreshReportResult): 0 | 1 | 130 {
  if (result.aborted) return 130;
  if (result.scan.status !== "completed" || result.report.status !== "published") return 1;
  return "open" in result.report ? reportAndOpenExitCode(result.report) : 0;
}
export function formatFreshReportResult(result: FreshReportResult, json: boolean): string {
  if (json) return JSON.stringify({ schema: "agentprof.cli/v1", ok: freshReportExitCode(result) === 0, command: "report", result }) + "\n";
  const report = result.report;
  const detail = report.status === "skipped" ? `Report skipped: ${report.reason === "aborted" ? "the workflow was aborted" : "the scan did not select one eligible generation"}.\n`
    : report.status === "failed" ? `Report failed: ${report.error.message}\n`
    : "open" in report ? formatReportAndOpenResult(report, false) : formatReportResult(report, false);
  return `AgentProf fresh input report${result.aborted ? " (aborted)" : ""}\n` + formatScanResult(result.scan, false) + detail;
}
