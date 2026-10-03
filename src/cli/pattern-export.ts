import { SafeError } from "../privacy/diagnostics.js";
import { renderPatternPage } from "../report/pattern-page.js";
import { validateReportPath, writeReportOutput } from "../report/write-output.js";
import { runPatterns, validatePatternArguments } from "./patterns.js";
import type { PatternArguments } from "./patterns.js";

export type PatternExportArguments = PatternArguments & Readonly<{ output?: string; json?: boolean }>;
export function validatePatternExportArguments(options: PatternExportArguments): Readonly<{ output: string; directory: string }> {
  if (typeof options.output !== "string" || !/\.(html|htm)$/i.test(options.output)
    || options.json !== undefined && typeof options.json !== "boolean"
    || options.dataDir !== undefined && typeof options.dataDir !== "string"
    || options.codexRoot !== undefined && (!Array.isArray(options.codexRoot) || options.codexRoot.length !== 0)
    || options.claudeRoot !== undefined && (!Array.isArray(options.claudeRoot) || options.claudeRoot.length !== 0)) throw new SafeError("INVALID_ARGUMENT");
  const output = validateReportPath(options.output);
  const { directory } = validatePatternArguments(options);
  return Object.freeze({ output, directory });
}
export async function runPatternExport(options: PatternExportArguments) {
  const { output, directory } = validatePatternExportArguments(options);
  const analysis = await runPatterns(options);
  const publication = await writeReportOutput({ output, dataDirectory: directory, html: renderPatternPage(analysis) });
  return Object.freeze({ mode: "patterns_html" as const, analysisAssessment: analysis.assessment,
    candidates: analysis.candidates.length, cycles: analysis.editValidation.cycles.length, publication });
}
export type PatternExportResult = Awaited<ReturnType<typeof runPatternExport>>;
export function patternExportExitCode(result: PatternExportResult): number {
  return result.publication.status === "published" ? 0 : 1;
}
export function formatPatternExport(result: PatternExportResult, json: boolean): string {
  if (json) return JSON.stringify({ schema: "agentprof.cli/v1", ok: patternExportExitCode(result) === 0, command: "patterns", result }) + "\n";
  const p = result.publication;
  return ["AgentProf patterns HTML export", `Publication: ${p.status}; assessment=${result.analysisAssessment}`,
    `Output: ${p.output}`, `Bytes: ${p.bytes}; candidates=${result.candidates}; cycles=${result.cycles}`,
    `Target verification=${p.targetVerification}; durability=${p.durability}; cleanup=${p.cleanup}`,
    `Warnings: ${p.warnings.join(", ") || "none"}`,
    "Publication does not establish avoidability, complete provider support, browser verification or savings.", ""].join("\n");
}
