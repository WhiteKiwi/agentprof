from pathlib import Path
root=Path('.')
def change(path, a,b, n=1):
 p=root/path; s=p.read_text(); assert s.count(a)==n,(path,repr(a),s.count(a)); p.write_text(s.replace(a,b))
# Existing files only; the new helper and tests have already been published.
change('src/cli/report-fresh.ts','import { collectScan, formatScanResult, validateCliPath } from "./scan.js";', 'import { formatScanResult, validateCliPath } from "./scan.js";\nimport { collectFreshScan, freshCapture } from "./fresh-capture.js";\nimport type { CaptureMode, ParserCaptureOptions } from "../parsers/capture.js";')
change('src/cli/report-fresh.ts','ReportArguments & Readonly<{ provider?', 'ReportArguments & ParserCaptureOptions & Readonly<{ provider?')
change('src/cli/report-fresh.ts','Promise<{ provider: Provider; input: string; dataDir: string; output: string }> {','Promise<{ provider: Provider; input: string; dataDir: string; output: string; capture: CaptureMode }> {\n  const capture = freshCapture(options);')
change('src/cli/report-fresh.ts','return { provider: options.provider, input, dataDir, output: options.output };','return { provider: options.provider, input, dataDir, output: options.output, capture };')
change('src/cli/report-fresh.ts','await collectScan(prepared.dataDir, [{ provider: prepared.provider, path: prepared.input }], controller.signal);','await collectFreshScan(prepared.dataDir, [{ provider: prepared.provider, path: prepared.input }], controller.signal, prepared.capture);')
change('src/cli/fresh-analysis.ts','import { collectScan, formatScanResult, validateCliPath } from "./scan.js";', 'import { formatScanResult, validateCliPath } from "./scan.js";\nimport { collectFreshScan, freshCapture } from "./fresh-capture.js";\nimport type { CaptureMode, ParserCaptureOptions } from "../parsers/capture.js";')
change('src/cli/fresh-analysis.ts','export type FreshAnalysisArguments = Readonly<{','export type FreshAnalysisArguments = ParserCaptureOptions & Readonly<{')
change('src/cli/fresh-analysis.ts','offset?: string; session?: string; json?: boolean;','offset?: string; session?: string; json?: boolean; tokens?: boolean;')
change('src/cli/fresh-analysis.ts','query: HistoryQuery | null; period: PatternPeriod | null;','query: HistoryQuery | null; period: PatternPeriod | null; capture: CaptureMode; tokens: boolean;')
change('src/cli/fresh-analysis.ts','scan: ScanResult; generation: Generation | null; report: ReportOutcome; aborted: boolean;','scan: ScanResult; generation: Generation | null; report: ReportOutcome; aborted: boolean;\n  analysisMode?: "tokens";')
change('src/cli/fresh-analysis.ts','options: FreshAnalysisArguments): Prepared {','options: FreshAnalysisArguments): Prepared {\n  const capture = freshCapture(options);\n  if (options.tokens !== undefined && typeof options.tokens !== "boolean"\n    || options.tokens === true && (command !== "history" || !capture.usageTiming)) throw new SafeError("INVALID_ARGUMENT");')
change('src/cli/fresh-analysis.ts','return Object.freeze({ command, provider: options.provider, input, output, directory, query, period });','return Object.freeze({ command, provider: options.provider, input, output, directory, query, period, capture, tokens: options.tokens === true });')
change('src/cli/fresh-analysis.ts','const history = prepared.command === "history" ? await import','const history = prepared.command === "history" && !prepared.tokens ? await import')
change('src/cli/fresh-analysis.ts','const historyPage = prepared.command === "history" ? await import','const historyPage = prepared.command === "history" && !prepared.tokens ? await import')
change('src/cli/fresh-analysis.ts','  const patternPage = prepared.command === "patterns" ? await import("../report/pattern-page.js") : null;', '  const patternPage = prepared.command === "patterns" ? await import("../report/pattern-page.js") : null;\n  const usage = prepared.tokens ? await import("../analysis/usage-history.js") : null;\n  const usagePage = prepared.tokens ? await import("../report/usage-history-page.js") : null;')
change('src/cli/fresh-analysis.ts','    if (history !== null && historyPage !== null && prepared.query !== null) {','''    if (usage !== null && usagePage !== null && prepared.query !== null) {
      try {
        const analysis = usage.analyzeUsageHistory([source], prepared.query);
        return Object.freeze({ html: usagePage.renderUsageHistoryPage(analysis), assessment: analysis.assessment });
      } catch (error) {
        if (error instanceof HistoryQueryError) throw new SafeError("INVALID_ARGUMENT");
        throw error;
      }
    }
    if (history !== null && historyPage !== null && prepared.query !== null) {''')
change('src/cli/fresh-analysis.ts','await collectScan(prepared.directory, [{ provider: prepared.provider, path: prepared.input }], controller.signal);','await collectFreshScan(prepared.directory, [{ provider: prepared.provider, path: prepared.input }], controller.signal, prepared.capture);')
change('src/cli/fresh-analysis.ts','aborted: controller.signal.aborted || scan.status === "aborted" });','aborted: controller.signal.aborted || scan.status === "aborted", ...(prepared.tokens ? { analysisMode: "tokens" as const } : {}) });')
change('src/cli/fresh-analysis.ts','`AgentProf fresh ${result.command} export${result.aborted ? " (aborted)" : ""}\\n`','`AgentProf fresh ${result.command}${result.analysisMode === "tokens" ? " tokens" : ""} export${result.aborted ? " (aborted)" : ""}\\n`')
for file in ['history','patterns']:
 p=root/f'src/cli/{file}.ts'
 s=p.read_text(); marker='    .option("--provider <provider>", "fresh input provider: codex or claude; requires --input and --output")'
 assert s.count(marker)==1
 s=s.replace(marker,marker+'\n    .option("--usage-timing", "fresh input only: capture versioned usage record timestamps")\n    .option("--pattern-evidence", "fresh input only: capture supported error/file evidence; includes usage timing")')
 s=s.replace('"provider", "input", "tokens"]','"provider", "input", "tokens", "usage-timing", "pattern-evidence"]') if file=='history' else s.replace('"output", "provider", "input"]','"output", "provider", "input", "usage-timing", "pattern-evidence"]')
 s=s.replace('provider?: string; input?: string; tokens?: boolean','provider?: string; input?: string; tokens?: boolean; usageTiming?: boolean; patternEvidence?: boolean') if file=='history' else s.replace('provider?: string; input?: string }','provider?: string; input?: string; usageTiming?: boolean; patternEvidence?: boolean }')
 fresh_start='    if (options.provider !== undefined || options.input !== undefined) {'
 if file=='history':
  i=s.index(fresh_start); j=s.index('    if (options.output !== undefined)',i)
  fresh=s[i:j]; s=s[:i]+s[j:]
  marker='    if (options.tokens === true) {'
  assert s.count(marker)==1
  s=s.replace(marker, fresh+'    if (options.usageTiming !== undefined || options.patternEvidence !== undefined) throw new SafeError("INVALID_ARGUMENT");\n'+marker)
  s=s.replace('show daily final/provisional response-token evidence; stored sources only','show daily final/provisional response-token evidence')
  s=s.replace('--tokens is a separate stored-source query; collect timestamps with scan --usage-timing.', '--tokens uses stored sources or explicit fresh input with --usage-timing/--pattern-evidence; no implicit parser opt-in.')
 else:
  marker='    if (options.output !== undefined) {'
  s=s.replace(marker,'    if (options.usageTiming !== undefined || options.patternEvidence !== undefined) throw new SafeError("INVALID_ARGUMENT");\n'+marker)
 p.write_text(s)
change('src/cli/main.ts','    .option("--input <file>", "one explicit regular uncompressed .jsonl file")','''    .option("--input <file>", "one explicit regular uncompressed .jsonl file")
    .option("--usage-timing", "fresh input only: capture versioned usage record timestamps")
    .option("--pattern-evidence", "fresh input only: capture supported error/file evidence; includes usage timing")''')
change('src/cli/main.ts','["source", "output", "open", "provider", "input", "unified"]','["source", "output", "open", "provider", "input", "unified", "usage-timing", "pattern-evidence"]')
change('src/cli/main.ts','    if (options.open === true) {','    if (options.usageTiming !== undefined || options.patternEvidence !== undefined) throw new SafeError("INVALID_ARGUMENT");\n    if (options.open === true) {')
import subprocess
expected = {
 "src/cli/fresh-analysis.ts": "30a2c6de78a59633994441784caca728a0661fbf",
 "src/cli/fresh-capture.ts": "b5e680bbc75f1aec0bd7d19c5542d8afac39afe0",
 "src/cli/history.ts": "ea65de61c1ffb53b4bf5c751cbf5cec6f709b059",
 "src/cli/main.ts": "936f913f8002bac66a0a5439e68f4ef92ad606e3",
 "src/cli/patterns.ts": "4ab00f9188c6addae7060c84c434eb2d9041faa6",
 "src/cli/report-fresh.ts": "636f363927cfd82189eef3347b1a44eeda809973",
 "tests/fresh-capture-cli.test.ts": "57fb75d2c0bb3f0dd72f9b8950cde28c7c42ce06",
 "tests/fresh-capture-workflows.test.ts": "1ebc41922a77c6e66949d3191f8cb0d34d42e80f"
}
for path, sha in expected.items():
 actual = subprocess.check_output(['git', 'hash-object', path], text=True).strip()
 assert actual == sha, (path, actual, sha)
 print(path, actual)
changed = set(subprocess.check_output(['git','diff','--name-only'],text=True).splitlines())
assert changed <= set(expected), changed - set(expected)
