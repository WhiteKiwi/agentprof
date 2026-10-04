import { Command, CommanderError } from "commander";
import { safeErrorEnvelope, SafeError } from "../privacy/diagnostics.js";
import { formatScanResult, runScan, validateCliPath } from "./scan.js";
import type { ScanArguments } from "./scan.js";
import { formatStatsResult, runStats, validateSourceSelection } from "./stats.js";
import type { StatsArguments } from "./stats.js";
import { formatInsightsResult, runInsights } from "./insights.js";
import type { InsightsArguments } from "./insights.js";
import { runReport, formatReportResult } from "./report.js";
import { runReportAndOpen, formatReportAndOpenResult, reportAndOpenExitCode } from "./report-open.js";
import { formatOpenResult, runOpen } from "./open.js";
import { runFreshReport, formatFreshReportResult, freshReportExitCode } from "./report-fresh.js";
import type { FreshReportArguments } from "./report-fresh.js";
import { VERSION } from "./version.js";
import { EVIDENCE_STATS_OPTIONS } from "./evidence-stats.js";
import { registerPatternCommand } from "./patterns.js";
import { registerHistoryCommand } from "./history.js";

function collect(value: string, previous: string[]): string[] {
  validateCliPath(value);
  return [...previous, value];
}

export async function run(argv: string[]): Promise<void> {
  const program = new Command();
  program.name("agentprof").description("Local agent profiling. Development build; bounded scan and selected-source stats/insights. Selected-source offline reports are supported; global aggregation is pending.")
    .version(VERSION)
    .option("--json", "emit structured results and errors")
    .option("--data-dir <directory>", "override local private data directory", validateCliPath)
    .option("--codex-root <directory>", "replace Codex input roots (repeatable)", collect, [])
    .option("--claude-root <directory>", "replace Claude input roots (repeatable)", collect, [])
    .exitOverride()
    .configureOutput({ writeErr: () => undefined });

  let reportDataFlags = 0, reportJsonFlags = 0;
  program.on("option:data-dir", () => { reportDataFlags++; });
  program.on("option:json", () => { reportJsonFlags++; });

  let usageTimingFlags = 0, patternEvidenceFlags = 0, reconcileFlags = 0;
  const scan = program.command("scan").option("--usage-timing", "opt into versioned record timestamps for history --tokens")
    .option("--pattern-evidence", "capture exact observed errors and supported structured file evidence; includes usage timing")
    .on("option:pattern-evidence", () => { if (++patternEvidenceFlags > 1) throw new SafeError("INVALID_ARGUMENT"); })
    .on("option:usage-timing", () => { if (++usageTimingFlags > 1) throw new SafeError("INVALID_ARGUMENT"); })
    .option("--reconcile", "collect explicit .jsonl files and retain proven missing sources as unavailable")
    .on("option:reconcile", () => { if (++reconcileFlags > 1) throw new SafeError("INVALID_ARGUMENT"); })
    .description("Collect explicit --codex-root/--claude-root inputs only (at least one required)")
    .addHelpText("after", "\nBounded scan: at most 16 roots, 64 sources, 256 directories, 4096 nodes and yielded entries,\n16 MiB/32768 records per source, 256 diagnostic samples. No aggregation or parser resume.\n--reconcile requires explicit .jsonl file roots, not directories. Only proven missing leaves are retired; stored evidence remains.\nMissing/unreadable parents and symlinks are not deletion evidence. No automatic directory pruning or inferred moves.")
    .action(async () => {
      const options = { ...program.opts(), ...scan.opts() } as ScanArguments & { json?: boolean; reconcile?: boolean };
      if (options.usageTiming && (reportDataFlags > 1 || reportJsonFlags > 1)) throw new SafeError("INVALID_ARGUMENT");
      if (options.reconcile === true) {
        if (reportDataFlags > 1 || reportJsonFlags > 1 || scan.args.length !== 0) throw new SafeError("INVALID_ARGUMENT");
        const { runReconcileScan, formatReconcileScan, reconcileScanExitCode } = await import("./reconcile-scan.js");
        const result = await runReconcileScan(options);
        process.stdout.write(formatReconcileScan(result, options.json === true));
        process.exitCode = reconcileScanExitCode(result);
        return;
      }
      const result = await runScan(options);
      process.stdout.write(formatScanResult(result, options.json === true));
      process.exitCode = result.status === "completed" ? 0 : result.status === "aborted" ? 130 : 1;
    });
  const stats = program.command("stats").description("Read one stored source prefix or list up to 64 sources (read-only)")
    .option("--list-sources", "list bounded stored source inventory")
    .option("--search-recurrence", "show completed Claude native search recurrence")
    .option("--recovery", "show observed same-turn Codex failure-to-success time")
    .option("--retry-overhead", "show observed failed-attempt retry overhead")
    .option("--active-time", "show observed Codex turn interval union and span")
    .option("--tokens", "show observed final-response token attribution")
    .option("--latency", "show admitted recorded tool latency quantiles")
    .option("--tool-busy", "show supported positioned terminal interval union")
    .option("--cache-share", "show observed cached-input share")
    .option("--execution-status", "show normalized execution status inventory")
    .option("--duration-coverage", "show stored duration eligibility counts")
    .option("--usage-coverage", "show stored response-usage eligibility counts")
    .option("--read-ratio", "show source-local read-ratio evidence")
    .option("--search-ratio", "show source-local search-ratio evidence")
    .option("--overlap-summary", "show source-local overlap-summary evidence")
    .option("--cache-write-share", "show source-local cache-write-share evidence")
    .option("--reasoning-share", "show source-local reasoning-share evidence")
    .option("--outcome-mix", "show source-local outcome-mix evidence")
    .option("--timing-evidence", "show source-local timing-evidence evidence")
    .option("--duration-scope", "show source-local duration-scope evidence")
    .option("--usage-finality", "show source-local usage-finality evidence")
    .option("--capabilities", "show source-local capabilities evidence")
    .option("--status-mix", "show source-local status-mix evidence")
    .option("--usage-selection", "show source-local usage-selection evidence")
    .option("--diagnostics", "show source-local diagnostics evidence")
    .option("--shape-coverage", "show source-local shape-coverage evidence")
    .option("--duration-exclusions", "show source-local duration-exclusions evidence")
    .option("--usage-exclusions", "show source-local usage-exclusions evidence")
    .option("--cache-components", "show source-local cache-components evidence")
    .option("--output-composition", "show source-local output-composition evidence")
    .option("--inventory", "show source-local inventory evidence")
    .option("--readiness", "show source-local readiness evidence")
    .option("--time-breakdown", "show recorded tool/command/category durations")
    .option("--invocation-overlap", "show observed Claude invocation interval union")
    .option("--read-revisits", "show completed Claude Read file revisits for one --source")
    .option("--failures", "show confirmed native failure evidence for one --source")
    .option("--source <id>", "select one full source ID from list/scan JSON", validateSourceSelection)
    .addHelpText("after", "\nExactly one selection mode is required. Existing private DELETE-mode store only; no scan or migration.\nNo --last, global totals, freshness check or cross-source reconciliation. Suppression and unknown values remain visible.\n--failures requires --source; status/timing coverage stay separate; generic Codex nonzero statuses may be unknown.\n--read-revisits requires --source and excludes --failures; Claude Read only, Codex unsupported; no same-content or waste claim.\n--invocation-overlap requires --source and excludes --failures/--read-revisits; Claude only, Codex unsupported; no runtime, active-time or savings claim.\n--search-recurrence requires --source and excludes --failures/--read-revisits/--invocation-overlap; Claude parser2 Grep/Glob only; exact request recurrence, not equal results or waste.\n--recovery requires --source and excludes other stats modes; Codex same-turn operation only; observed recovery, no retry-loop or savings claim.\n--retry-overhead requires --source and excludes other stats modes; failed-attempt intervals only; no waste or savings claim.\n--active-time requires --source and excludes other stats modes; Codex positioned turns only; union excludes gaps, span includes gaps.\n--tokens requires --source and excludes other stats modes; observed eligible final-response usage only; no cost, tool attribution or savings claim.\n--time-breakdown requires --source and excludes other stats modes; recorded duration sums may overlap and are not elapsed/busy time or savings.");
  for (const [, flag, description] of EVIDENCE_STATS_OPTIONS) {
    stats.option(`--${flag}`, description);
    let occurrences = 0;
    stats.on(`option:${flag}`, () => { if (++occurrences > 1) throw new SafeError("INVALID_ARGUMENT"); });
  }
  stats.addHelpText("after", "\nEvidence views require --source and exclude every other stats view. JSON retains native evidence and explicit fraction denominators.");
  let selections = 0;
  for (const flag of ["list-sources", "source"]) stats.on(`option:${flag}`, () => {
    if (++selections > 1) throw new SafeError("INVALID_ARGUMENT");
  });
  let timeBreakdownFlags = 0;
  stats.on("option:time-breakdown", () => { if (++timeBreakdownFlags > 1) throw new SafeError("INVALID_ARGUMENT"); });
  let tokenFlags = 0;
  stats.on("option:tokens", () => { if (++tokenFlags > 1) throw new SafeError("INVALID_ARGUMENT"); });
  let failureFlags = 0;
  stats.on("option:failures", () => { if (++failureFlags > 1) throw new SafeError("INVALID_ARGUMENT"); });
  let readRevisitFlags = 0;
  stats.on("option:read-revisits", () => { if (++readRevisitFlags > 1) throw new SafeError("INVALID_ARGUMENT"); });
  let invocationOverlapFlags = 0;
  stats.on("option:invocation-overlap", () => { if (++invocationOverlapFlags > 1) throw new SafeError("INVALID_ARGUMENT"); });
  let searchRecurrenceFlags = 0;
  stats.on("option:search-recurrence", () => { if (++searchRecurrenceFlags > 1) throw new SafeError("INVALID_ARGUMENT"); });
  let retryOverheadFlags = 0;
  stats.on("option:retry-overhead", () => { if (++retryOverheadFlags > 1) throw new SafeError("INVALID_ARGUMENT"); });
  let activeTimeFlags = 0;
  stats.on("option:active-time", () => { if (++activeTimeFlags > 1) throw new SafeError("INVALID_ARGUMENT"); });
  let recoveryFlags = 0;
  stats.on("option:recovery", () => { if (++recoveryFlags > 1) throw new SafeError("INVALID_ARGUMENT"); });
  let latencyFlags = 0;
  stats.on("option:latency", () => { if (++latencyFlags > 1) throw new SafeError("INVALID_ARGUMENT"); });
  let toolBusyFlags = 0;
  stats.on("option:tool-busy", () => { if (++toolBusyFlags > 1) throw new SafeError("INVALID_ARGUMENT"); });
  let cacheShareFlags = 0;
  stats.on("option:cache-share", () => { if (++cacheShareFlags > 1) throw new SafeError("INVALID_ARGUMENT"); });
  let executionStatusFlags = 0;
  stats.on("option:execution-status", () => { if (++executionStatusFlags > 1) throw new SafeError("INVALID_ARGUMENT"); });
  let durationCoverageFlags = 0;
  stats.on("option:duration-coverage", () => { if (++durationCoverageFlags > 1) throw new SafeError("INVALID_ARGUMENT"); });
  let usageCoverageFlags = 0;
  stats.on("option:usage-coverage", () => { if (++usageCoverageFlags > 1) throw new SafeError("INVALID_ARGUMENT"); });
  let readRatioFlags = 0;
  stats.on("option:read-ratio", () => { if (++readRatioFlags > 1) throw new SafeError("INVALID_ARGUMENT"); });
  let searchRatioFlags = 0;
  stats.on("option:search-ratio", () => { if (++searchRatioFlags > 1) throw new SafeError("INVALID_ARGUMENT"); });
  let overlapSummaryFlags = 0;
  stats.on("option:overlap-summary", () => { if (++overlapSummaryFlags > 1) throw new SafeError("INVALID_ARGUMENT"); });
  let cacheWriteShareFlags = 0;
  stats.on("option:cache-write-share", () => { if (++cacheWriteShareFlags > 1) throw new SafeError("INVALID_ARGUMENT"); });
  let reasoningShareFlags = 0;
  stats.on("option:reasoning-share", () => { if (++reasoningShareFlags > 1) throw new SafeError("INVALID_ARGUMENT"); });
  let outcomeMixFlags = 0;
  stats.on("option:outcome-mix", () => { if (++outcomeMixFlags > 1) throw new SafeError("INVALID_ARGUMENT"); });
  let timingEvidenceFlags = 0;
  stats.on("option:timing-evidence", () => { if (++timingEvidenceFlags > 1) throw new SafeError("INVALID_ARGUMENT"); });
  let durationScopeFlags = 0;
  stats.on("option:duration-scope", () => { if (++durationScopeFlags > 1) throw new SafeError("INVALID_ARGUMENT"); });
  let usageFinalityFlags = 0;
  stats.on("option:usage-finality", () => { if (++usageFinalityFlags > 1) throw new SafeError("INVALID_ARGUMENT"); });
  let capabilitiesFlags = 0;
  stats.on("option:capabilities", () => { if (++capabilitiesFlags > 1) throw new SafeError("INVALID_ARGUMENT"); });
  let statusMixFlags = 0;
  stats.on("option:status-mix", () => { if (++statusMixFlags > 1) throw new SafeError("INVALID_ARGUMENT"); });
  let usageSelectionFlags = 0;
  stats.on("option:usage-selection", () => { if (++usageSelectionFlags > 1) throw new SafeError("INVALID_ARGUMENT"); });
  let diagnosticsFlags = 0;
  stats.on("option:diagnostics", () => { if (++diagnosticsFlags > 1) throw new SafeError("INVALID_ARGUMENT"); });
  let shapeCoverageFlags = 0;
  stats.on("option:shape-coverage", () => { if (++shapeCoverageFlags > 1) throw new SafeError("INVALID_ARGUMENT"); });
  let durationExclusionsFlags = 0;
  stats.on("option:duration-exclusions", () => { if (++durationExclusionsFlags > 1) throw new SafeError("INVALID_ARGUMENT"); });
  let usageExclusionsFlags = 0;
  stats.on("option:usage-exclusions", () => { if (++usageExclusionsFlags > 1) throw new SafeError("INVALID_ARGUMENT"); });
  let cacheComponentsFlags = 0;
  stats.on("option:cache-components", () => { if (++cacheComponentsFlags > 1) throw new SafeError("INVALID_ARGUMENT"); });
  let outputCompositionFlags = 0;
  stats.on("option:output-composition", () => { if (++outputCompositionFlags > 1) throw new SafeError("INVALID_ARGUMENT"); });
  let inventoryFlags = 0;
  stats.on("option:inventory", () => { if (++inventoryFlags > 1) throw new SafeError("INVALID_ARGUMENT"); });
  let readinessFlags = 0;
  stats.on("option:readiness", () => { if (++readinessFlags > 1) throw new SafeError("INVALID_ARGUMENT"); });
  stats.action(async () => {
    const options = { ...program.opts(), ...stats.opts() } as StatsArguments & { json?: boolean };
    const result = await runStats(options);
    process.stdout.write(formatStatsResult(result, options.json === true));
    process.exitCode = 0;
  });
  const insights = program.command("insights").description("Read Slow Tool evidence from one stored source prefix (read-only)")
    .option("--source <id>", "select one full source ID from stats --list-sources or scan JSON", validateSourceSelection)
    .addHelpText("after", "\nExactly one --source is required. Existing private DELETE-mode store only; no scan or migration.\nNo --last, source listing, global totals, freshness check or cross-source reconciliation.\nSuppressed/partial evidence and necessary-work/quality safeguards remain visible; no savings claim.");
  let insightSelections = 0;
  insights.on("option:source", () => { if (++insightSelections > 1) throw new SafeError("INVALID_ARGUMENT"); });
  insights.action(async () => {
    const options = { ...program.opts(), ...insights.opts() } as InsightsArguments & { json?: boolean };
    const result = await runInsights(options);
    process.stdout.write(formatInsightsResult(result, options.json === true));
    process.exitCode = 0;
  });
  registerPatternCommand(program);
  registerHistoryCommand(program);
  const report = program.command("report").description("Write a new offline HTML report from one stored source or explicit input file")
    .option("--provider <provider>", "explicit input provider: claude or codex")
    .option("--input <file>", "one explicit regular uncompressed .jsonl file")
    .option("--usage-timing", "fresh input only: capture versioned usage record timestamps")
    .option("--pattern-evidence", "fresh input only: capture supported error/file evidence; includes usage timing")
    .allowExcessArguments(false)
    .option("--source <id>", "select one full source ID", validateSourceSelection)
    .option("--output <file>", "new output HTML file; existing files are never overwritten")
    .option("--open", "request the system opener after verified HTML publication")
    .option("--unified", "combine existing measurements and evidence-gated diagnostics in one source report")
    .addHelpText("after", "\nChoose --source or exactly --provider claude|codex --input FILE.jsonl; --output is required.\nStored --source reads the existing store; explicit input scans once then reports its exact generation.\nNo roots or --last. Partial evidence may report with exit 1; failed selection never opens old data.\nBounded source-prefix observations only; no global totals, freshness check or savings claim.\n--open requires local .html/.htm output and completed publication with a verified target.\nNative opening may create OS/browser history; helper acceptance does not verify browser rendering.\nTimeout may mean the file is already open; no automatic retry.");
  for (const name of ["source", "output", "open", "provider", "input", "unified", "usage-timing", "pattern-evidence"]) {
    let count = 0;
    report.on(`option:${name}`, () => { if (++count > 1) throw new SafeError("INVALID_ARGUMENT"); });
  }
  report.action(async () => {
    const options = { ...program.opts(), ...report.opts() } as FreshReportArguments & { json?: boolean };
    if (options.unified === true && (reportDataFlags > 1 || reportJsonFlags > 1)) throw new SafeError("INVALID_ARGUMENT");
    if (options.provider !== undefined || options.input !== undefined) {
      if (reportDataFlags > 1 || reportJsonFlags > 1) throw new SafeError("INVALID_ARGUMENT");
      const result = await runFreshReport(options);
      process.stdout.write(formatFreshReportResult(result, options.json === true));
      process.exitCode = freshReportExitCode(result);
      return;
    }
    if (options.usageTiming !== undefined || options.patternEvidence !== undefined) throw new SafeError("INVALID_ARGUMENT");
    if (options.open === true) {
      const result = await runReportAndOpen(options);
      process.stdout.write(formatReportAndOpenResult(result, options.json === true));
      process.exitCode = reportAndOpenExitCode(result);
      return;
    }
    const result = await runReport(options);
    process.stdout.write(formatReportResult(result, options.json === true));
    process.exitCode = result.status === "published" ? 0 : 1;
  });
  program.command("open").description("Request the system opener for one explicitly trusted local HTML file")
    .argument("<file>", "existing local .html/.htm file")
    .allowExcessArguments(false)
    .addHelpText("after", "\nmacOS/Linux only. Open explicitly trusted local files: selected HTML may run scripts or contact remote resources.\nCanonical symlink targets are used; native opening may create OS/browser history.\nNo scan, report generation, latest-file search or URLs. Global data/root options are validated but inert.\nA helper acknowledgement does not verify browser rendering. Timeout may mean the file is already open; no automatic retry.")
    .action(async (file: string) => {
      const options = program.opts<{ json?: boolean }>();
      const result = await runOpen({ file });
      process.stdout.write(formatOpenResult(result, options.json === true));
      process.exitCode = 0;
    });

  try {
    if (argv.length <= 2) {
      program.outputHelp();
      return;
    }
    await program.parseAsync(argv);
  } catch (error) {
    if (error instanceof CommanderError && (error.code === "commander.helpDisplayed" || error.code === "commander.version")) return;
    const safe = error instanceof SafeError ? error : new SafeError(error instanceof CommanderError ? "INVALID_ARGUMENT" : "INTERNAL_ERROR");
    const envelope = safeErrorEnvelope(safe);
    process.stderr.write(argv.includes("--json") ? JSON.stringify(envelope) + "\n" : `agentprof: ${envelope.error.message}\n`);
    process.exitCode = 2;
  }
}
