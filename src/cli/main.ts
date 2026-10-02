import { Command, CommanderError } from "commander";
import { safeErrorEnvelope, SafeError } from "../privacy/diagnostics.js";
import { formatScanResult, runScan, validateCliPath } from "./scan.js";
import type { ScanArguments } from "./scan.js";
import { formatStatsResult, runStats, validateSourceSelection } from "./stats.js";
import type { StatsArguments } from "./stats.js";
import { formatInsightsResult, runInsights } from "./insights.js";
import type { InsightsArguments } from "./insights.js";
import { runReport, formatReportResult } from "./report.js";
import type { ReportArguments } from "./report.js";
import { VERSION } from "./version.js";

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

  const pending = () => { throw new SafeError("NOT_IMPLEMENTED"); };
  program.command("scan").description("Collect explicit --codex-root/--claude-root inputs only (at least one required)")
    .addHelpText("after", "\nBounded scan: at most 16 roots, 64 sources, 256 directories, 4096 nodes and yielded entries,\n16 MiB/32768 records per source, 256 diagnostic samples. No aggregation or parser resume.")
    .action(async () => {
      const options = program.opts<ScanArguments & { json?: boolean }>();
      const result = await runScan(options);
      process.stdout.write(formatScanResult(result, options.json === true));
      process.exitCode = result.status === "completed" ? 0 : result.status === "aborted" ? 130 : 1;
    });
  const stats = program.command("stats").description("Read one stored source prefix or list up to 64 sources (read-only)")
    .option("--list-sources", "list bounded stored source inventory")
    .option("--search-recurrence", "show completed Claude native search recurrence")
    .option("--invocation-overlap", "show observed Claude invocation interval union")
    .option("--read-revisits", "show completed Claude Read file revisits for one --source")
    .option("--failures", "show confirmed native failure evidence for one --source")
    .option("--source <id>", "select one full source ID from list/scan JSON", validateSourceSelection)
    .addHelpText("after", "\nExactly one selection mode is required. Existing private DELETE-mode store only; no scan or migration.\nNo --last, global totals, freshness check or cross-source reconciliation. Suppression and unknown values remain visible.\n--failures requires --source; status/timing coverage stay separate; generic Codex nonzero statuses may be unknown.\n--read-revisits requires --source and excludes --failures; Claude Read only, Codex unsupported; no same-content or waste claim.\n--invocation-overlap requires --source and excludes --failures/--read-revisits; Claude only, Codex unsupported; no runtime, active-time or savings claim.\n--search-recurrence requires --source and excludes --failures/--read-revisits/--invocation-overlap; Claude parser2 Grep/Glob only; exact request recurrence, not equal results or waste.");
  let selections = 0;
  for (const flag of ["list-sources", "source"]) stats.on(`option:${flag}`, () => {
    if (++selections > 1) throw new SafeError("INVALID_ARGUMENT");
  });
  let failureFlags = 0;
  stats.on("option:failures", () => { if (++failureFlags > 1) throw new SafeError("INVALID_ARGUMENT"); });
  let readRevisitFlags = 0;
  stats.on("option:read-revisits", () => { if (++readRevisitFlags > 1) throw new SafeError("INVALID_ARGUMENT"); });
  let invocationOverlapFlags = 0;
  stats.on("option:invocation-overlap", () => { if (++invocationOverlapFlags > 1) throw new SafeError("INVALID_ARGUMENT"); });
  let searchRecurrenceFlags = 0;
  stats.on("option:search-recurrence", () => { if (++searchRecurrenceFlags > 1) throw new SafeError("INVALID_ARGUMENT"); });
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
  const report = program.command("report").description("Write a new offline HTML report from one stored source prefix")
    .option("--source <id>", "select one full source ID", validateSourceSelection)
    .option("--output <file>", "new output HTML file; existing files are never overwritten")
    .addHelpText("after", "\nBoth --source and --output are required. Read-only existing store; no scan, roots, --last or --open.\nBounded source-prefix observations only; no global totals, freshness check or savings claim.");
  for (const name of ["source", "output"]) {
    let count = 0;
    report.on(`option:${name}`, () => { if (++count > 1) throw new SafeError("INVALID_ARGUMENT"); });
  }
  report.action(async () => {
    const options = { ...program.opts(), ...report.opts() } as ReportArguments & { json?: boolean };
    const result = await runReport(options);
    process.stdout.write(formatReportResult(result, options.json === true));
    process.exitCode = result.status === "published" ? 0 : 1;
  });
  program.command("open").description("Open a generated report (not implemented yet)")
    .argument("<file>", "generated HTML file").action(pending);

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
