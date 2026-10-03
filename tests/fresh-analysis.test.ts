import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, symlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runFreshAnalysis, validateFreshAnalysisArguments, freshAnalysisExitCode, formatFreshAnalysis } from "../src/cli/fresh-analysis.js";
import type { FreshAnalysisArguments, FreshAnalysisCommand } from "../src/cli/fresh-analysis.js";
import * as scanner from "../src/cli/scan.js";
import * as stores from "../src/db/source-store.js";
import * as readOnly from "../src/db/read-only.js";
import * as history from "../src/analysis/source-history.js";
import * as patterns from "../src/analysis/source-patterns.js";
import * as native from "../src/analysis/source-failures.js";
import * as writer from "../src/report/write-output.js";
import { runPatternExport } from "../src/cli/pattern-export.js";
import { runHistoryExport } from "../src/cli/history-export.js";
import { bytes, id } from "./recovery-fixture.js";
import { freshFixture, appendExecution, window } from "./fresh-analysis-fixture.js";

const commands = ["patterns", "history"] as const;
afterEach(() => vi.restoreAllMocks());

describe("ordinary single-input fresh exports", () => {
  for (const command of commands) for (const provider of ["codex", "claude"] as const) {
    it(`${command}/${provider}: commit, pinned HTML parity, reuse and append`, async () => {
      const x = await freshFixture(command, provider);
      const first = await runFreshAnalysis(command, x.options);
      expect(first.report.status).toBe("published");
      expect(first.scan.counts).toMatchObject({ committed: 1, failed: 0, rejected: 0 });
      expect(first.generation?.revision).toBe(1);
      const html = await readFile(x.output, "utf8"), snapshot = await bytes(x.data);
      expect(html).not.toContain("FICTITIOUS_");
      expect(html).not.toContain(first.generation!.sourceId);
      expect((await stat(x.output)).mode & 0o777).toBe(0o600);
      const storedOutput = join(x.root, "stored.html");
      if (command === "patterns") await runPatternExport({ source: first.generation!.sourceId, dataDir: x.data, output: storedOutput });
      else await runHistoryExport({ source: [first.generation!.sourceId], dataDir: x.data, output: storedOutput, ...window });
      expect(await readFile(storedOutput, "utf8")).toBe(html);
      expect(await bytes(x.data)).toEqual(snapshot);
      const reused = await runFreshAnalysis(command, { ...x.options, output: join(x.root, "reuse.html") });
      expect(reused.generation).toEqual(first.generation);
      expect(reused.scan.counts).toMatchObject({ unchanged: 1, committed: 0 });
      expect(await bytes(x.data)).toEqual(snapshot);
      await appendExecution(x.input, provider);
      const appended = await runFreshAnalysis(command, { ...x.options, output: join(x.root, "append.html") });
      expect(appended.generation).toEqual({ sourceId: first.generation!.sourceId, revision: 2 });
      expect(appended.report.status).toBe("published");
      expect(appended.scan.counts.committed).toBe(1);
      expect(formatFreshAnalysis(appended, false)).toContain("revision=2");
      expect(JSON.parse(formatFreshAnalysis(appended, true))).toMatchObject({ command, result: { mode: "fresh_analysis_html" } });
    });
  }
  it.each(commands)("%s retains deliberately partial failed-call evidence without fabricating success", async command => {
    const x = await freshFixture(command, "codex", true), result = await runFreshAnalysis(command, x.options);
    expect(result.scan.status).toBe("partial");
    expect(result.scan.diagnostics.samples.some(d => d.code === "INSUFFICIENT_ERROR_EVIDENCE")).toBe(true);
    expect(result.report.status).toBe("published");
    expect(freshAnalysisExitCode(result)).toBe(1);
    expect(JSON.parse(formatFreshAnalysis(result, true)).ok).toBe(false);
    expect(await readFile(x.output, "utf8")).not.toContain("FICTITIOUS_");
  });
  it.each(commands)("%s reads one selected generation and invokes only its selected analyzer", async command => {
    const x = await freshFixture(command), collect = scanner.collectScan;
    const create = stores.createSourceStore;
    let read = vi.fn();
    vi.spyOn(scanner, "collectScan").mockImplementationOnce(async (...args) => {
      const receipt = await collect(...args);
      vi.spyOn(stores, "createSourceStore").mockImplementation((...storeArgs) => {
        const store = create(...storeArgs); read = vi.fn(store.readSource.bind(store));
        return { ...store, readSource: read };
      });
      return receipt;
    });
    const hs = vi.spyOn(history, "analyzeSelectedHistory"), ps = vi.spyOn(patterns, "analyzeSourcePatterns");
    const ns = vi.spyOn(native, "analyzeSourceFailures");
    const result = await runFreshAnalysis(command, x.options);
    expect(result.report.status).toBe("published");
    expect(read).toHaveBeenCalledTimes(1);
    expect(hs).toHaveBeenCalledTimes(command === "history" ? 1 : 0);
    expect(ps).toHaveBeenCalledTimes(command === "patterns" ? 1 : 0);
    expect(ns).toHaveBeenCalledTimes(1);
  });
});

describe("pre-collection validation", () => {
  const invalid: Record<string, unknown>[] = [
    { provider: undefined }, { provider: "other" }, { input: undefined }, { input: 42 }, { input: "" },
    { output: undefined }, { output: 42 }, { output: "result.json" }, { dataDir: 42 }, { json: 1 },
    { source: "" }, { source: id("source", "one") }, { source: [id("source", "one")] },
    { codexRoot: ["/FICTITIOUS_ROOT"] }, { claudeRoot: ["/FICTITIOUS_ROOT"] },
    { codexRoot: {} }, { claudeRoot: new Array(1) }, { from: "2026-02-30T00:00:00Z", to: window.to },
    { from: window.from, to: undefined }, { from: window.to, to: window.from },
  ];
  it.each(invalid)("rejects invalid fresh arguments before bootstrap: %j", async extra => {
    const x = await freshFixture(), collect = vi.spyOn(scanner, "collectScan");
    await expect(runFreshAnalysis("patterns", { ...x.options, ...extra } as FreshAnalysisArguments)).rejects.toBeDefined();
    expect(collect).not.toHaveBeenCalled(); expect(existsSync(x.data)).toBe(false); expect(existsSync(x.output)).toBe(false);
  });
  it("requires history period and preserves existing time-zone and exact session validation", async () => {
    const x = await freshFixture("history");
    for (const extra of [{ from: undefined }, { offset: "Asia/Seoul" }, { session: "bad" }]) {
      expect(() => validateFreshAnalysisArguments("history", { ...x.options, ...extra })).toThrow();
    }
    expect(validateFreshAnalysisArguments("history", { ...x.options, source: [], offset: "+09:00" }).query?.offsetMinutes).toBe(540);
    expect(() => validateFreshAnalysisArguments("patterns", { ...x.options, offset: "+09:00" })).toThrow();
    expect(existsSync(x.data)).toBe(false);
  });
  it.each(["missing", "directory", "compressed", "symlink", "ancestor"])("rejects %s input before bootstrap", async kind => {
    const x = await freshFixture(); let input = x.input;
    if (kind === "missing") input = join(x.root, "absent.jsonl");
    if (kind === "directory") { input = join(x.root, "dir.jsonl"); await mkdir(input); }
    if (kind === "compressed") input += ".gz";
    if (kind === "symlink") { input = join(x.root, "link.jsonl"); await symlink(x.input, input); }
    if (kind === "ancestor") { const link = join(x.root, "link"); await symlink(join(x.root, "inputs"), link); input = join(link, "session.jsonl"); }
    await expect(runFreshAnalysis("patterns", { ...x.options, input })).rejects.toBeDefined();
    expect(existsSync(x.data)).toBe(false); expect(existsSync(x.output)).toBe(false);
  });
  it.each(["existing", "private", "symlink", "ancestor", "missing-parent"])("rejects %s output before collection", async kind => {
    const x = await freshFixture(); let output = x.output;
    if (kind === "existing") await writeFile(output, "DO NOT REPLACE");
    if (kind === "private") output = join(x.data, "private.html");
    if (kind === "symlink") await symlink(x.input, output);
    if (kind === "ancestor") { const link = join(x.root, "link"); await symlink(join(x.root, "inputs"), link); output = join(link, "report.html"); }
    if (kind === "missing-parent") output = join(x.root, "absent", "report.html");
    const collect = vi.spyOn(scanner, "collectScan");
    await expect(runFreshAnalysis("patterns", { ...x.options, output })).rejects.toBeDefined();
    expect(collect).not.toHaveBeenCalled(); expect(existsSync(x.data)).toBe(false);
    if (kind === "existing") expect(await readFile(output, "utf8")).toBe("DO NOT REPLACE");
  });
});

describe("generation and publication failure boundaries", () => {
  it.each(commands)("%s refuses a changed revision rather than analyzing a convenient snapshot", async command => {
    const x = await freshFixture(command), collect = scanner.collectScan;
    vi.spyOn(scanner, "collectScan").mockImplementationOnce(async (...args) => {
      const receipt = await collect(...args);
      return { ...receipt, sources: receipt.sources.map(s => ({ ...s, committedRevision: s.committedRevision! + 1 })) };
    });
    const result = await runFreshAnalysis(command, x.options);
    expect(result.report).toMatchObject({ status: "failed", error: { code: "SOURCE_REVISION_CHANGED" } });
    expect(existsSync(x.output)).toBe(false); expect(freshAnalysisExitCode(result)).toBe(1);
  });
  it.each(["failed", "rejected", "stale", "truncated"])("%s collection never reads a previous generation", async kind => {
    const x = await freshFixture(); const first = await runFreshAnalysis("patterns", x.options), before = await bytes(x.data);
    const receipt = { ...first.scan, status: "partial" as const,
      discoveryTruncated: kind === "truncated",
      counts: { ...first.scan.counts, ...(kind !== "truncated" ? { [kind]: 1 } : {}) } };
    vi.spyOn(scanner, "collectScan").mockResolvedValueOnce(receipt);
    const read = vi.spyOn(readOnly, "withReadOnlyStore"), output = join(x.root, "should-not-exist.html");
    const result = await runFreshAnalysis("patterns", { ...x.options, output });
    expect(result.report).toEqual({ status: "skipped", reason: "scan_ineligible" });
    expect(read).not.toHaveBeenCalled(); expect(existsSync(output)).toBe(false); expect(await bytes(x.data)).toEqual(before);
  });
  it("refuses an inconsistent provider on the selected read snapshot", async () => {
    const x = await freshFixture(), collect = scanner.collectScan, create = stores.createSourceStore;
    vi.spyOn(scanner, "collectScan").mockImplementationOnce(async (...args) => {
      const receipt = await collect(...args);
      vi.spyOn(stores, "createSourceStore").mockImplementation((...params) => {
        const store = create(...params);
        return { ...store, readSource: (sourceId: string) => { const source = store.readSource(sourceId); return source === null ? null : { ...source, provider: "claude" as const }; } };
      });
      return receipt;
    });
    expect((await runFreshAnalysis("patterns", x.options)).report).toMatchObject({ status: "failed", error: { code: "SOURCE_REVISION_CHANGED" } });
    expect(existsSync(x.output)).toBe(false);
  });
  it("redacts unexpected analyzer exceptions while preserving the committed receipt", async () => {
    const x = await freshFixture();
    vi.spyOn(patterns, "analyzeSourcePatterns").mockImplementationOnce(() => { throw new Error("FICTITIOUS_PRIVATE_FAILURE"); });
    const result = await runFreshAnalysis("patterns", x.options);
    // The existing pinned read boundary maps unexpected callback errors to this safe code.
    // Preserve that contract rather than changing shared storage behavior for this workflow.
    expect(result.report).toMatchObject({ status: "failed", error: { code: "DATABASE_ACCESS_FAILED" } });
    expect(result.scan.counts.committed).toBe(1);
    expect(existsSync(x.output)).toBe(false);
    expect(formatFreshAnalysis(result, true) + formatFreshAnalysis(result, false)).not.toContain("FICTITIOUS_PRIVATE_FAILURE");
  });
  it("cleans its signal listener when collection throws", async () => {
    const x = await freshFixture(), before = process.listenerCount("SIGINT");
    vi.spyOn(scanner, "collectScan").mockRejectedValueOnce(new Error("synthetic collector failure"));
    await expect(runFreshAnalysis("patterns", x.options)).rejects.toThrow("synthetic collector failure");
    expect(process.listenerCount("SIGINT")).toBe(before);
  });
  it("skips export on a pre-aborted internal signal", async () => {
    const x = await freshFixture(), control = new AbortController(), before = process.listenerCount("SIGINT"); control.abort();
    const result = await runFreshAnalysis("patterns", x.options, { signal: control.signal });
    expect(result.report).toEqual({ status: "skipped", reason: "aborted" });
    expect(freshAnalysisExitCode(result)).toBe(130); expect(existsSync(x.output)).toBe(false);
    expect(process.listenerCount("SIGINT")).toBe(before);
  });
  it("keeps committed collection but skips publication when interrupted after analysis", async () => {
    const x = await freshFixture(), control = new AbortController(), analyze = patterns.analyzeSourcePatterns;
    vi.spyOn(patterns, "analyzeSourcePatterns").mockImplementationOnce((...args) => { const result = analyze(...args); control.abort(); return result; });
    const publish = vi.spyOn(writer, "writeReportOutput");
    const result = await runFreshAnalysis("patterns", x.options, { signal: control.signal });
    expect(result.scan.counts.committed).toBe(1); expect(result.report).toEqual({ status: "skipped", reason: "aborted" });
    expect(publish).not.toHaveBeenCalled(); expect(existsSync(x.output)).toBe(false);
  });
  it("preserves a published receipt when an abort occurs after the writer starts", async () => {
    const x = await freshFixture(), control = new AbortController(), write = writer.writeReportOutput;
    vi.spyOn(writer, "writeReportOutput").mockImplementationOnce(async (...args) => { const publication = await write(...args); control.abort(); return publication; });
    const result = await runFreshAnalysis("patterns", x.options, { signal: control.signal });
    expect(result.report.status).toBe("published"); expect(result.aborted).toBe(true);
    expect(freshAnalysisExitCode(result)).toBe(130); expect(existsSync(x.output)).toBe(true);
  });
  it("retains post-publication warnings rather than claiming no file was written", async () => {
    const x = await freshFixture(), write = writer.writeReportOutput;
    vi.spyOn(writer, "writeReportOutput").mockImplementationOnce(async (...args) => ({ ...await write(...args),
      status: "published_with_warning", durability: "unconfirmed", warnings: ["directory_sync_failed"] }));
    const result = await runFreshAnalysis("patterns", x.options);
    expect(result.report.status).toBe("published_with_warning"); expect(freshAnalysisExitCode(result)).toBe(1);
    expect(formatFreshAnalysis(result, false)).toContain("directory_sync_failed"); expect(existsSync(x.output)).toBe(true);
  });
});
