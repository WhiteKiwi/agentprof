import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { SafeError, safeErrorEnvelope } from "../privacy/diagnostics.js";
import { assertNoSymlink, fileCode } from "../privacy/paths.js";
import type { Provider } from "../privacy/paths.js";
import { identity } from "../db/source-validation.js";
import { collectScan, formatScanResult, validateCliPath } from "./scan.js";
import type { ScanResult } from "../scanner/scan-run.js";
import { selectFreshReportGeneration } from "./report-fresh.js";
import { validateHistoryArguments } from "./history.js";
import { validatePatternArguments } from "./patterns.js";
import { HistoryQueryError } from "../analysis/history-query.js";
import type { HistoryQuery } from "../analysis/history-query.js";
import type { PatternPeriod } from "../analysis/pattern-intervals.js";
import { validateReportPath, writeReportOutput } from "../report/write-output.js";
import type { Publication } from "../report/write-output.js";

export type FreshAnalysisCommand = "history" | "patterns";
export type FreshAnalysisArguments = Readonly<{
  provider?: string; input?: string; output?: string; dataDir?: string;
  source?: string | readonly string[]; from?: string; to?: string;
  offset?: string; session?: string; json?: boolean;
  codexRoot?: readonly string[]; claudeRoot?: readonly string[];
}>;
type Generation = NonNullable<ReturnType<typeof selectFreshReportGeneration>>;
type Prepared = Readonly<{
  command: FreshAnalysisCommand; provider: Provider; input: string; output: string; directory: string;
  query: HistoryQuery | null; period: PatternPeriod | null;
}>;
type FreshPublication = Publication & Readonly<{
  sourceId: string; revision: number; analysisAssessment: string;
}>;
type ReportOutcome = FreshPublication
  | Readonly<{ status: "skipped"; reason: "aborted" | "scan_ineligible" }>
  | Readonly<{ status: "failed"; error: ReturnType<typeof safeErrorEnvelope>["error"] }>;
export type FreshAnalysisResult = Readonly<{
  mode: "fresh_analysis_html"; command: FreshAnalysisCommand; provider: Provider;
  scan: ScanResult; generation: Generation | null; report: ReportOutcome; aborted: boolean;
}>;

// Only a syntactic stand-in for existing pure argument validators. Never read or emitted.
const VALIDATION_SOURCE = `h1:${"0".repeat(32)}:source:${"0".repeat(64)}`;
const emptyRoots = (value: unknown): boolean => value === undefined || Array.isArray(value) && value.length === 0;
const within = (parent: string, child: string): boolean => {
  const path = relative(parent, child);
  return path === "" || path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
};

/** Pure checks first, including period semantics and rejection of selection mixtures. */
export function validateFreshAnalysisArguments(command: FreshAnalysisCommand, options: FreshAnalysisArguments): Prepared {
  if ((command !== "history" && command !== "patterns")
    || (options.provider !== "codex" && options.provider !== "claude")
    || typeof options.input !== "string" || typeof options.output !== "string"
    || options.dataDir !== undefined && typeof options.dataDir !== "string"
    || options.json !== undefined && typeof options.json !== "boolean"
    || !emptyRoots(options.codexRoot) || !emptyRoots(options.claudeRoot)
    || options.source !== undefined && !(command === "history" && Array.isArray(options.source) && options.source.length === 0)
    || command === "patterns" && (options.offset !== undefined || options.session !== undefined)) throw new SafeError("INVALID_ARGUMENT");
  validateCliPath(options.input);
  validateReportPath(options.input);
  const input = resolve(options.input), output = resolve(validateReportPath(options.output));
  if (/\.jsonl\.(?:gz|zst|zip|bz2|xz)$/i.test(input)) throw new SafeError("UNSUPPORTED_COMPRESSION");
  if (!input.endsWith(".jsonl") || !/\.(html|htm)$/i.test(output)
    || /[\uD800-\uDFFF]/u.test(input + output)) throw new SafeError("INVALID_ARGUMENT");
  const selection = { dataDir: options.dataDir, from: options.from, to: options.to };
  let directory: string, query: HistoryQuery | null = null, period: PatternPeriod | null = null;
  if (command === "history") {
    const checked = validateHistoryArguments({ ...selection, source: [VALIDATION_SOURCE], offset: options.offset, session: options.session });
    directory = resolve(validateReportPath(checked.directory)); query = checked.query;
  } else {
    const checked = validatePatternArguments({ ...selection, source: VALIDATION_SOURCE });
    directory = resolve(validateReportPath(checked.directory)); period = checked.period;
  }
  if (within(directory, output)) throw new SafeError("REPORT_OUTPUT_UNSAFE");
  return Object.freeze({ command, provider: options.provider, input, output, directory, query, period });
}

/** Preflight does not create the store or any output; publication repeats these safety checks. */
async function preflight(prepared: Prepared): Promise<void> {
  if (process.platform !== "linux" && process.platform !== "darwin") throw new SafeError("UNSUPPORTED_PLATFORM");
  try {
    await assertNoSymlink(prepared.input);
    const info = await lstat(prepared.input);
    if (!info.isFile() || info.isSymbolicLink()) throw new SafeError("INVALID_ARGUMENT");
  } catch (error) {
    if (error instanceof SafeError) throw error;
    throw new SafeError(fileCode(error) === "ENOENT" ? "INPUT_ROOT_MISSING" : "INPUT_ACCESS_FAILED");
  }
  try {
    const parent = dirname(prepared.output);
    await assertNoSymlink(parent);
    const info = await lstat(parent);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(parent) !== parent) throw new SafeError("REPORT_OUTPUT_UNSAFE");
    try { await lstat(prepared.output); }
    catch (error) { if (fileCode(error) === "ENOENT") return; throw error; }
    throw new SafeError("REPORT_OUTPUT_UNSAFE");
  } catch { throw new SafeError("REPORT_OUTPUT_UNSAFE"); }
}

/** Select and analyze once inside the same read transaction; modules load before entering it. */
async function renderGeneration(prepared: Prepared, generation: Generation): Promise<Readonly<{ html: string; assessment: string }>> {
  const { withReadOnlyStore } = await import("../db/read-only.js");
  const { createSourceStore } = await import("../db/source-store.js");
  const history = prepared.command === "history" ? await import("../analysis/source-history.js") : null;
  const patterns = prepared.command === "patterns" ? await import("../analysis/source-patterns.js") : null;
  const historyPage = prepared.command === "history" ? await import("../report/history-page.js") : null;
  const patternPage = prepared.command === "patterns" ? await import("../report/pattern-page.js") : null;
  return withReadOnlyStore(prepared.directory, (db, key) => {
    try {
      identity(generation.sourceId, "source", key);
      if (prepared.query?.sessionId != null) identity(prepared.query.sessionId, "session", key);
    } catch { throw new SafeError("INVALID_IDENTITY_KEY"); }
    const source = createSourceStore(db, key).readSource(generation.sourceId);
    if (source === null) throw new SafeError("SOURCE_NOT_FOUND");
    if (source.revision !== generation.revision || source.provider !== prepared.provider) throw new SafeError("SOURCE_REVISION_CHANGED");
    if (history !== null && historyPage !== null && prepared.query !== null) {
      try {
        const analysis = history.analyzeSelectedHistory([source], prepared.query);
        return Object.freeze({ html: historyPage.renderHistoryPage(analysis), assessment: analysis.assessment });
      } catch (error) {
        if (error instanceof HistoryQueryError) throw new SafeError("INVALID_ARGUMENT");
        throw error;
      }
    }
    if (patterns === null || patternPage === null) throw new SafeError("INTERNAL_ERROR");
    const analysis = patterns.analyzeSourcePatterns(source, prepared.period);
    return Object.freeze({ html: patternPage.renderPatternPage(analysis), assessment: analysis.assessment });
  });
}

/** Explicit collection is the only write to storage. Aborts never trigger stale fallback or retries. */
export async function runFreshAnalysis(
  command: FreshAnalysisCommand, options: FreshAnalysisArguments, internal: Readonly<{ signal?: AbortSignal }> = {},
): Promise<FreshAnalysisResult> {
  const prepared = validateFreshAnalysisArguments(command, options);
  await preflight(prepared);
  const controller = new AbortController(), interrupt = () => controller.abort();
  process.on("SIGINT", interrupt);
  internal.signal?.addEventListener("abort", interrupt, { once: true });
  if (internal.signal?.aborted) controller.abort();
  try {
    const scan = await collectScan(prepared.directory, [{ provider: prepared.provider, path: prepared.input }], controller.signal);
    const generation = selectFreshReportGeneration(scan, prepared.provider);
    let report: ReportOutcome;
    if (controller.signal.aborted || scan.status === "aborted") report = Object.freeze({ status: "skipped", reason: "aborted" });
    else if (generation === null) report = Object.freeze({ status: "skipped", reason: "scan_ineligible" });
    else {
      try {
        const rendered = await renderGeneration(prepared, generation);
        if (controller.signal.aborted) report = Object.freeze({ status: "skipped", reason: "aborted" });
        else {
          const publication = await writeReportOutput({ output: prepared.output, dataDirectory: prepared.directory, html: rendered.html });
          report = Object.freeze({ ...publication, sourceId: generation.sourceId, revision: generation.revision, analysisAssessment: rendered.assessment });
        }
      } catch (error) { report = Object.freeze({ status: "failed", error: Object.freeze(safeErrorEnvelope(error).error) }); }
    }
    return Object.freeze({ mode: "fresh_analysis_html", command, provider: prepared.provider, scan, generation, report,
      aborted: controller.signal.aborted || scan.status === "aborted" });
  } finally {
    process.removeListener("SIGINT", interrupt);
    internal.signal?.removeEventListener("abort", interrupt);
  }
}
export function freshAnalysisExitCode(result: FreshAnalysisResult): 0 | 1 | 130 {
  if (result.aborted) return 130;
  return result.scan.status === "completed" && result.report.status === "published" ? 0 : 1;
}
export function formatFreshAnalysis(result: FreshAnalysisResult, json: boolean): string {
  if (json) return JSON.stringify({ schema: "agentprof.cli/v1", ok: freshAnalysisExitCode(result) === 0, command: result.command, result }) + "\n";
  const r = result.report;
  const detail = r.status === "skipped" ? `Export skipped: ${r.reason}.\n`
    : r.status === "failed" ? `Export failed: ${r.error.message}\n`
    : [`Export: ${r.status}; assessment=${r.analysisAssessment}`, `Output: ${r.output}`,
      `Generation: ${r.sourceId}; revision=${r.revision}; bytes=${r.bytes}`,
      `Target=${r.targetVerification}; durability=${r.durability}; cleanup=${r.cleanup}`,
      `Warnings: ${r.warnings.join(", ") || "none"}`, ""].join("\n");
  return `AgentProf fresh ${result.command} export${result.aborted ? " (aborted)" : ""}\n`
    + formatScanResult(result.scan, false) + detail
    + "Only the generation selected by this explicit scan was used; no ongoing freshness, complete-history or savings claim.\n";
}
