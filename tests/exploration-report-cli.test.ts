import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { runScan } from "../src/cli/scan.js";
import { runReport } from "../src/cli/report.js";
import { runFreshReport } from "../src/cli/report-fresh.js";
import { buildUnifiedSourceReport } from "../src/report/unified-model.js";
import { renderUnifiedSourceReport } from "../src/report/unified-page.js";
import * as sourceStore from "../src/db/source-store.js";
import * as engine from "../src/analysis/source-exploration.js";
import { disk, bytes, claudePair, codexRows } from "./provider-evidence-fixture.js";
import { temporaryDirectory } from "./helpers.js";
const binary = resolve("dist/agentprof.cjs"), env = { ...process.env, NODE_NO_WARNINGS: "1" };
const invoke = (args: string[], file = binary, cwd = process.cwd()) => {
  const r = spawnSync(process.execPath, [file, ...args], { cwd, env, encoding: "utf8", timeout: 20000, maxBuffer: 16 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};
const rows = () => Array.from({ length: 20 }, (_, i) => claudePair(`q${i}`, "Grep", { pattern: i < 5 ? "FICTITIOUS_REPEAT" : `FICTITIOUS_QUERY_${i}`, path: "src" }, "FICTITIOUS_RESULT", false, undefined, "FICTITIOUS_SESSION", i * 3)).flat();
const captures = [{ name: "ordinary", options: {}, flags: [] }, { name: "timing", options: { usageTiming: true }, flags: ["--usage-timing"] }, { name: "pattern", options: { patternEvidence: true }, flags: ["--pattern-evidence"] }];
afterEach(() => vi.restoreAllMocks());

it.each(captures)("$name stored report uses one pinned read/one exploration analysis after raw deletion", async capture => {
  const x = await disk("claude", rows()); await runScan({ ...x.options, ...capture.options });
  await rm(x.inputRoot, { recursive: true }); const before = await bytes(x.data), original = sourceStore.createSourceStore;
  let reads = 0;
  vi.spyOn(sourceStore, "createSourceStore").mockImplementation((...args) => {
    expect(args[0].prepare("PRAGMA query_only").get()!.query_only).toBe(1);
    const store = original(...args);
    return { ...store, readSource: (id: string) => { reads++; return store.readSource(id); } };
  });
  const analyze = vi.spyOn(engine, "analyzeSourceExploration"), output = join(x.root, "unified.html");
  const result = await runReport({ unified: true, source: x.sourceId, dataDir: x.data, output });
  expect(reads).toBe(1); expect(analyze).toHaveBeenCalledTimes(1);
  const analysis = analyze.mock.results[0]!.value; expect(analysis.candidates).toHaveLength(1); expect(analysis.candidates[0].severity).toBe("INFO");
  const html = await readFile(output, "utf8"); expect(html).toContain("Completed native lookups</th><td>20");
  expect(html).toContain("Largest repeated exact search</th><td>5"); expect(html).not.toMatch(/FICTITIOUS_|h1:|<script/);
  expect(result).toMatchObject({ layout: "unified", revision: 1, status: "published" });
  expect(await bytes(x.data)).toEqual(before); expect((await stat(output)).mode & 0o777).toBe(0o600);
  // No additional disk read: the analyzer spy records the already-pinned source used by report.
  expect(html).toBe(renderUnifiedSourceReport(buildUnifiedSourceReport(analyze.mock.calls[0]![0])));
});
it.each(captures)("$name fresh capture and stored raw-deleted HTML/insights agree through the real binary", async capture => {
  const x = await disk("claude", rows()), fresh = join(x.root, "fresh.html"), stored = join(x.root, "stored.html");
  const result = invoke(["report", "--unified", "--provider", "claude", "--input", x.path, "--data-dir", x.data, "--output", fresh, "--json", ...capture.flags]);
  expect([0, 1], result.stdout + result.stderr).toContain(result.status);
  const receipt = JSON.parse(result.stdout); expect(receipt.result.report).toMatchObject({ layout: "unified", published: true, revision: 1 });
  await rm(x.inputRoot, { recursive: true }); const before = await bytes(x.data);
  const queried = invoke(["report", "--unified", "--source", x.sourceId, "--data-dir", x.data, "--output", stored, "--json"]);
  expect(queried.status, queried.stderr).toBe(0); expect(await readFile(stored, "utf8")).toBe(await readFile(fresh, "utf8"));
  const insight = invoke(["insights", "--source", x.sourceId, "--data-dir", x.data, "--exploration", "--json"]);
  expect(insight.status, insight.stderr).toBe(0); const a = JSON.parse(insight.stdout).result.analysis;
  expect(a.candidates).toHaveLength(1); const c = a.candidates[0];
  const html = await readFile(stored, "utf8");
  for (const [label, value] of [["Completed native lookups", c.lookupN], ["Largest repeated exact search", c.largestRepeatedSearchN], ["Intersecting Edit/Write", c.mutationN], ["Owned call/result proof count", c.evidenceObservationIds.length]]) expect(html).toContain(`${label}</th><td>${value}`);
  expect(await bytes(x.data)).toEqual(before);
});
it("non-unified absent/false remains the legacy layout and does not run exploration", async () => {
  const x = await disk("claude", rows()); await runScan(x.options);
  const spy = vi.spyOn(engine, "analyzeSourceExploration");
  const a = await runReport({ source: x.sourceId, dataDir: x.data, output: join(x.root, "old.html") });
  const b = await runReport({ unified: false, source: x.sourceId, dataDir: x.data, output: join(x.root, "false.html") });
  expect(spy).not.toHaveBeenCalled(); expect(b).not.toHaveProperty("layout");
  expect(await readFile(a.output, "utf8")).toBe(await readFile(b.output, "utf8"));
  expect(await readFile(a.output, "utf8")).not.toContain('id="unified-exploration"');
});
it("preserves revision refusal and output collision after exploration integration", async () => {
  const x = await disk("claude", rows()); await runScan(x.options); const before = await bytes(x.data), output = join(x.root, "out.html");
  await expect(runReport({ unified: true, source: x.sourceId, dataDir: x.data, output }, { expectedRevision: 2 })).rejects.toMatchObject({ code: "SOURCE_REVISION_CHANGED" });
  expect(existsSync(output)).toBe(false);
  await runReport({ unified: true, source: x.sourceId, dataDir: x.data, output }); const html = await readFile(output, "utf8");
  await expect(runReport({ unified: true, source: x.sourceId, dataDir: x.data, output })).rejects.toMatchObject({ code: "REPORT_OUTPUT_UNSAFE" });
  expect(await readFile(output, "utf8")).toBe(html); expect(await bytes(x.data)).toEqual(before);
});
it("fresh Codex report shows unsupported exploration rather than a healthy zero", async () => {
  const x = await disk("codex", codexRows()); const output = join(x.root, "codex.html");
  await runFreshReport({ unified: true, provider: "codex", input: x.path, dataDir: x.data, output, patternEvidence: true });
  const html = await readFile(output, "utf8"); expect(html).toContain("unsupported_provider"); expect(html).toContain("Exploration candidates unavailable; not zero findings");
  expect(html).toContain("Candidate windows</th><td>Unavailable"); expect(html).not.toMatch(/FICTITIOUS_|h1:|<script/);
});
it("scripts-disabled installed reports preserve both providers/captures and original commands", async () => {
  const root = temporaryDirectory(), prefix = join(root, "prefix"), outside = join(root, "outside"); await mkdir(outside);
  const npm = (args: string[], cwd = outside) => {
    const r = spawnSync("npm", ["--cache", join(root, "cache"), "--ignore-scripts", ...args], { cwd, env, encoding: "utf8", timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    expect(r.status, r.stdout + r.stderr).toBe(0); return r.stdout;
  };
  const pack = JSON.parse(npm(["pack", "--json", "--pack-destination", root], process.cwd()))[0];
  expect(pack.files.some((f: { path: string }) => f.path === "dist/report/exploration-section.js")).toBe(true);
  expect(pack.files.every((f: { path: string }) => /^(dist\/|package\.json$|README\.md$|LICENSE)/.test(f.path))).toBe(true);
  npm(["install", "--global", "--prefix", prefix, "--no-audit", "--no-fund", join(root, pack.filename)]);
  const name = JSON.parse(readFileSync("package.json", "utf8")).name, installed = join(prefix, "lib", "node_modules", name, "dist", "agentprof.cjs");
  for (const provider of ["claude", "codex"] as const) for (const capture of captures) {
    const x = await disk(provider, provider === "claude" ? rows() : codexRows()), output = join(x.root, "report.html");
    const fresh = invoke(["report", "--unified", "--provider", provider, "--input", x.path, "--data-dir", x.data, "--output", output, "--json", ...capture.flags], installed, outside);
    expect([0, 1], fresh.stdout + fresh.stderr).toContain(fresh.status); expect(JSON.parse(fresh.stdout).result.report.published).toBe(true);
    const html = await readFile(output, "utf8"); await rm(output); await rm(x.inputRoot, { recursive: true }); const before = await bytes(x.data);
    const args = ["report", "--unified", "--source", x.sourceId, "--data-dir", x.data, "--output", output, "--json"];
    const built = invoke(args, binary, outside); expect(built.status, built.stderr).toBe(0); expect(await readFile(output, "utf8")).toBe(html); await rm(output);
    const actual = invoke(args, installed, outside); expect(actual).toEqual(built); expect(await readFile(output, "utf8")).toBe(html);
    const base = ["insights", "--source", x.sourceId, "--data-dir", x.data, "--json"];
    for (const extra of [[], ["--exploration"]]) expect(invoke([...base, ...extra], installed, outside)).toEqual(invoke([...base, ...extra], binary, outside));
    expect(await bytes(x.data)).toEqual(before); expect(html).not.toMatch(/FICTITIOUS_|h1:|<script/);
  }
}, 60000);
