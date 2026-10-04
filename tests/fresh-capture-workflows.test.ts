import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { freshCapture } from "../src/cli/fresh-capture.js";
import { runFreshReport } from "../src/cli/report-fresh.js";
import { runFreshAnalysis, validateFreshAnalysisArguments, freshAnalysisExitCode, formatFreshAnalysis } from "../src/cli/fresh-analysis.js";
import { runReport } from "../src/cli/report.js";
import { runPatternExport } from "../src/cli/pattern-export.js";
import { runHistoryExport } from "../src/cli/history-export.js";
import { runUsageHistory, exportUsageHistory } from "../src/cli/usage-history.js";
import { withReadOnlyStore } from "../src/db/read-only.js";
import * as scanModule from "../src/cli/scan.js";
import * as sourceModule from "../src/db/source-store.js";
import * as nativeHistory from "../src/analysis/source-history.js";
import * as usageHistory from "../src/analysis/usage-history.js";
import * as patterns from "../src/analysis/source-patterns.js";
import * as writer from "../src/report/write-output.js";
import { disk, bytes, records, window } from "./usage-timing-fixture.js";
import { codexRows, claudeRows } from "./provider-evidence-fixture.js";
import { freshFixture } from "./fresh-analysis-fixture.js";

const providers = ["codex", "claude"] as const;
afterEach(() => vi.restoreAllMocks());
const read = (data: string, sourceId: string) => withReadOnlyStore(data, (db, key) => sourceModule.createSourceStore(db, key).readSource(sourceId)!);

it.each([
  [{}, { usageTiming: false, patternEvidence: false }],
  [{ usageTiming: false, patternEvidence: false }, { usageTiming: false, patternEvidence: false }],
  [{ usageTiming: true }, { usageTiming: true, patternEvidence: false }],
  [{ patternEvidence: true }, { usageTiming: true, patternEvidence: true }],
  [{ usageTiming: false, patternEvidence: true }, { usageTiming: true, patternEvidence: true }],
  [{ usageTiming: true, patternEvidence: true }, { usageTiming: true, patternEvidence: true }],
])("uses the existing capture policy for %j", (options, expected) => {
  expect(freshCapture(options)).toEqual(expected);
  expect(Object.isFrozen(freshCapture(options))).toBe(true);
});
for (const name of ["usageTiming", "patternEvidence"] as const) {
  it.each([undefined, null, 1, "true", {}, []])(`rejects present invalid ${name} before collection: %j`, async value => {
    const x = await freshFixture(), collect = vi.spyOn(scanModule, "collectScan");
    const options = { ...x.options, [name]: value } as never;
    await expect(runFreshAnalysis("patterns", options)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(runFreshReport(options)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(collect).not.toHaveBeenCalled(); expect(existsSync(x.data)).toBe(false);
  });
  it(`rejects ${name} accessors without executing them`, () => {
    const get = vi.fn(() => true), object = Object.defineProperty({}, name, { get, enumerable: true });
    expect(() => freshCapture(object)).toThrow(); expect(get).not.toHaveBeenCalled();
  });
}

for (const command of ["report", "unified", "patterns", "history"] as const) {
  for (const provider of providers) for (const mode of ["timing", "patterns"] as const) {
    it(`${command}/${provider}/${mode}: explicit capture, same-mode reuse, legacy restoration and stored HTML parity`, async () => {
      const x = await disk(provider, (provider === "codex" ? codexRows() : claudeRows()) as never);
      const capture = mode === "timing" ? { usageTiming: true } : { patternEvidence: true };
      const collect = vi.spyOn(scanModule, "collectScan");
      const options = { provider, input: x.path, dataDir: x.data, ...(command === "history" ? window : {}) };
      const execute = (output: string, policy = capture) => command === "report" || command === "unified"
        ? runFreshReport({ ...options, output, ...policy, unified: command === "unified" })
        : runFreshAnalysis(command, { ...options, output, ...policy });
      const output = join(x.root, "fresh.html"), r = await execute(output);
      expect(r.report.status).toBe("published");
      expect(collect).toHaveBeenCalledTimes(1); expect(collect.mock.calls[0]).toHaveLength(4);
      expect(collect.mock.calls[0]![3]).toEqual(capture);
      const enriched = await read(x.data, x.sourceId);
      expect(enriched.parserVersion).toBe(provider === "codex" ? (mode === "timing" ? 2 : 3) : (mode === "timing" ? 3 : 4));
      expect(enriched.events.some(e => e.errorFingerprint !== null)).toBe(mode === "patterns");
      const before = await bytes(x.data), expected = join(x.root, "stored.html");
      if (command === "report" || command === "unified") await runReport({ source: x.sourceId, dataDir: x.data, output: expected, unified: command === "unified" });
      else if (command === "patterns") await runPatternExport({ source: x.sourceId, dataDir: x.data, output: expected });
      else await runHistoryExport({ source: [x.sourceId], dataDir: x.data, output: expected, ...window });
      expect(await readFile(output, "utf8")).toBe(await readFile(expected, "utf8"));
      expect(await readFile(output, "utf8")).not.toMatch(/FICTITIOUS_|<script/i);
      // The existing legacy report intentionally displays a hashed source identity.
      if (command !== "report") expect(await readFile(output, "utf8")).not.toContain("h1:");
      const reused = await execute(join(x.root, "reused.html"));
      expect(reused.scan.counts.unchanged).toBe(1); expect(await bytes(x.data)).toEqual(before);
      const restored = await execute(join(x.root, "legacy.html"), {});
      expect(restored.scan.counts.committed).toBe(1);
      expect((await read(x.data, x.sourceId)).parserVersion).toBe(provider === "codex" ? 1 : 2);
      expect(collect.mock.calls.at(-1)).toHaveLength(3);
    });
  }
}

it("false capture choices preserve legacy collector arguments and byte-identical result shape", async () => {
  const x = await freshFixture(), collect = vi.spyOn(scanModule, "collectScan");
  await runFreshAnalysis("patterns", x.options);
  const output = join(x.root, "same.html"), fs = await import("node:fs/promises");
  const a = await runFreshAnalysis("patterns", { ...x.options, output });
  const html = await readFile(output, "utf8"), before = await bytes(x.data); await fs.rm(output);
  const b = await runFreshAnalysis("patterns", { ...x.options, output, usageTiming: false, patternEvidence: false, tokens: false });
  expect(formatFreshAnalysis(b, true)).toBe(formatFreshAnalysis(a, true));
  expect(formatFreshAnalysis(b, false)).toBe(formatFreshAnalysis(a, false));
  expect(await readFile(output, "utf8")).toBe(html); expect(await bytes(x.data)).toEqual(before);
  expect(collect.mock.calls.every(call => call.length === 3)).toBe(true);
  expect(a).not.toHaveProperty("analysisMode");
});

for (const provider of providers) for (const capture of [{ usageTiming: true }, { patternEvidence: true }]) {
  it(`${provider}/${JSON.stringify(capture)}: fresh tokens preserve dated values, provisional status and the stored export`, async () => {
    const x = await disk(provider), output = join(x.root, "fresh.html");
    const r = await runFreshAnalysis("history", { provider, input: x.path, dataDir: x.data, output, ...window, ...capture, tokens: true });
    expect(r.report.status).toBe("published"); expect(r.analysisMode).toBe("tokens");
    expect(formatFreshAnalysis(r, false)).toContain("history tokens export");
    expect(freshAnalysisExitCode(r)).toBe(provider === "codex" ? 0 : 1);
    const before = await bytes(x.data);
    const selected = { source: [x.sourceId], dataDir: x.data, ...window, tokens: true };
    const a = await runUsageHistory(selected);
    expect(a.days.map(d => d.counts.total)).toEqual(provider === "codex" ? [110, 120] : [160, 170]);
    expect(a.days.every(d => d.selection === (provider === "codex" ? "final" : "provisional"))).toBe(true);
    const expected = join(x.root, "stored.html"); await exportUsageHistory({ ...selected, output: expected });
    expect(await readFile(output, "utf8")).toBe(await readFile(expected, "utf8"));
    expect(await bytes(x.data)).toEqual(before);
  });
}
it.each([{}, { usageTiming: false }, { patternEvidence: false }, { usageTiming: false, patternEvidence: false }])("token mode requires explicit timestamp capture: %j", async capture => {
  const x = await freshFixture("history"), collect = vi.spyOn(scanModule, "collectScan");
  await expect(runFreshAnalysis("history", { ...x.options, ...capture, tokens: true })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  expect(collect).not.toHaveBeenCalled(); expect(existsSync(x.data)).toBe(false);
});
it("patterns rejects token selection and nonboolean token choices before I/O", async () => {
  const x = await freshFixture();
  for (const tokens of [true, null, 1, "true", {}]) {
    expect(() => validateFreshAnalysisArguments("patterns", { ...x.options, usageTiming: true, tokens: tokens as never })).toThrow();
  }
  expect(existsSync(x.data)).toBe(false);
});
it("fresh tokens read one pinned revision and run only the existing usage analyzer", async () => {
  const x = await disk(), collect = scanModule.collectScan, create = sourceModule.createSourceStore, reads = vi.fn();
  vi.spyOn(scanModule, "collectScan").mockImplementationOnce(async (...args) => {
    const receipt = await collect(...args);
    vi.spyOn(sourceModule, "createSourceStore").mockImplementation((db, key) => {
      const s = create(db, key);
      return { ...s, readSource: (id: string) => { expect(db.isTransaction).toBe(true); reads(id); return s.readSource(id); } };
    });
    return receipt;
  });
  const usage = vi.spyOn(usageHistory, "analyzeUsageHistory"), native = vi.spyOn(nativeHistory, "analyzeSelectedHistory"), pattern = vi.spyOn(patterns, "analyzeSourcePatterns");
  const r = await runFreshAnalysis("history", { provider: "codex", input: x.path, dataDir: x.data, output: join(x.root, "one.html"), ...window, usageTiming: true, tokens: true });
  expect(r.report.status).toBe("published"); expect(reads).toHaveBeenCalledTimes(1); expect(reads).toHaveBeenCalledWith(x.sourceId);
  expect(usage).toHaveBeenCalledTimes(1); expect(native).not.toHaveBeenCalled(); expect(pattern).not.toHaveBeenCalled();
});
it("a real subsequent capture-mode commit cannot substitute a different generation for token analysis", async () => {
  const x = await disk(), collect = scanModule.collectScan, analyze = vi.spyOn(usageHistory, "analyzeUsageHistory");
  vi.spyOn(scanModule, "collectScan").mockImplementationOnce(async (...args) => {
    const receipt = await collect(...args);
    await collect(args[0], args[1], args[2], { patternEvidence: true });
    return receipt;
  });
  const output = join(x.root, "stale.html"), r = await runFreshAnalysis("history", { provider: "codex", input: x.path, dataDir: x.data, output, ...window, usageTiming: true, tokens: true });
  expect(r.report).toMatchObject({ status: "failed", error: { code: "SOURCE_REVISION_CHANGED" } });
  expect(analyze).not.toHaveBeenCalled(); expect(existsSync(output)).toBe(false);
  expect((await read(x.data, x.sourceId)).parserVersion).toBe(3);
});
it("fresh token publication retains late warnings and provisional data without changing selection", async () => {
  const x = await disk("claude", records("claude")), write = writer.writeReportOutput;
  vi.spyOn(writer, "writeReportOutput").mockImplementationOnce(async options => ({ ...await write(options), status: "published_with_warning", warnings: ["directory_sync_failed"], durability: "unconfirmed" }));
  const output = join(x.root, "warn.html"), r = await runFreshAnalysis("history", { provider: "claude", input: x.path, dataDir: x.data, output, ...window, patternEvidence: true, tokens: true });
  expect(r.report).toMatchObject({ status: "published_with_warning", published: true }); expect(freshAnalysisExitCode(r)).toBe(1);
  expect(formatFreshAnalysis(r, false)).toContain("directory_sync_failed"); expect(existsSync(output)).toBe(true);
});
