import { Command, CommanderError } from "commander";
import { safeErrorEnvelope, SafeError } from "../privacy/diagnostics.js";
import { VERSION } from "./version.js";

function collect(value: string, previous: string[]): string[] {
  if (!value.trim()) throw new SafeError("INVALID_ARGUMENT");
  return [...previous, value];
}

export async function run(argv: string[]): Promise<void> {
  const program = new Command();
  program.name("agentprof").description("Local agent profiling. Foundation development build; analysis commands are pending.")
    .version(VERSION)
    .option("--json", "emit structured errors")
    .option("--data-dir <directory>", "override local private data directory")
    .option("--codex-root <directory>", "replace Codex input roots (repeatable)", collect, [])
    .option("--claude-root <directory>", "replace Claude input roots (repeatable)", collect, [])
    .exitOverride()
    .configureOutput({ writeErr: () => undefined });

  const pending = () => { throw new SafeError("NOT_IMPLEMENTED"); };
  program.command("scan").description("Collect logs (not implemented yet)").action(pending);
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
    const safe = error instanceof SafeError ? error : new SafeError("INVALID_ARGUMENT");
    const envelope = safeErrorEnvelope(safe);
    process.stderr.write(argv.includes("--json") ? JSON.stringify(envelope) + "\n" : `agentprof: ${envelope.error.message}\n`);
    process.exitCode = 2;
  }
}
