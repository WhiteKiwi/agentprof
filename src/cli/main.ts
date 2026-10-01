import { Command, CommanderError } from "commander";
import { safeErrorEnvelope, SafeError } from "../privacy/diagnostics.js";
import { formatScanResult, runScan, validateCliPath } from "./scan.js";
import type { ScanArguments } from "./scan.js";
import { VERSION } from "./version.js";

function collect(value: string, previous: string[]): string[] {
  validateCliPath(value);
  return [...previous, value];
}

export async function run(argv: string[]): Promise<void> {
  const program = new Command();
  program.name("agentprof").description("Local agent profiling. Development build; bounded explicit-root scan. Aggregation and reports are pending.")
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
  program.command("stats").description("Read aggregate statistics (not implemented yet)")
    .option("--last <period>", "selected period, for example 7d").action(pending);
  program.command("insights").description("Read diagnostics (not implemented yet)")
    .option("--last <period>", "selected period, for example 7d").action(pending);
  program.command("report").description("Generate an offline HTML report (not implemented yet)")
    .option("--last <period>", "selected period, for example 7d")
    .option("--output <file>", "output HTML file")
    .option("--open", "open the generated file").action(pending);
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
