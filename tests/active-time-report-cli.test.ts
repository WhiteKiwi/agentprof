import { existsSync } from "node:fs";
import { readFile, rm, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runScan } from "../src/cli/scan.js";
import { runReport } from "../src/cli/report.js";
import { buildUnifiedSourceReport } from "../src/report/unified-model.js";
import { renderUnifiedSourceReport } from "../src/report/unified-page.js";
import { withReadOnlyStore } from "../src/db/read-only.js";
import * as stores from "../src/db/source-store.js";
import * as active from "../src/analysis/source-active-time.js";
import { disk, bytes, claudePair } from "./provider-evidence-fixture.js";
import { at, positive, pairedPositive, record, meta, wall } from "./active-time-fixture.js";
import { temporaryDirectory } from "./helpers.js";

const binary = resolve("dist/agentprof.cjs"), baseline = process.env["AGENTPROF_ACTIVE_TIME_REPORT_BASELINE_BINARY"], installed = process.env["AGENTPROF_ACTIVE_TIME_REPORT_INSTALLED_BINARY"];
const invoke = (args: readonly string[], file = binary, cwd = process.cwd()) => {
  const r = spawnSync(process.execPath, [file, ...args], { cwd, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf8", timeout: 20000, maxBuffer: 16 * 1024 * 1024 });
  expect(r.error).toBeUndefined(); expect(r.signal).toBeNull(); return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};
const captures = [
  { name: "ordinary", options: {}, flags: [], version: 1 },
  { name: "timing", options: { usageTiming: true }, flags: ["--usage-timing"], version: 2 },
  { name: "pattern", options: { patternEvidence: true }, flags: ["--pattern-evidence"], version: 3 },
];
const claude = () => [
  ...Array.from({ length: 20 }, (_, i) => claudePair(`q${i}`, "Grep", { pattern: i < 5 ? "FICTITIOUS_REPEAT" : `FICTITIOUS_QUERY_${i}`, path: "src" }, "FICTITIOUS_RESULT", false, undefined, "FICTITIOUS_SESSION", i * 3)).flat(),
  { type: "system", subtype: "turn_duration", uuid: "FICTITIOUS_DURATION_UUID", sessionId: "FICTITIOUS_SESSION", version: "2.1.63", timestamp: at(100000), durationMs: 8150 },
];
const examples = [
  { name: "wall", provider: "codex" as const, rows: () => positive, union: 15000, span: 15000, turns: 2, proofs: 2 },
  { name: "paired", provider: "codex" as const, rows: () => pairedPositive, union: 25000, span: 110000, turns: 3, proofs: 6 },
  { name: "Claude duration and exploration", provider: "claude" as const, rows: claude, union: null, span: null, turns: null, proofs: null },
];
const matrix = captures.flatMap(capture => examples.map(example => ({ name: `${capture.name} ${example.name}`, capture, example })));
const section = (html: string, id = "unified-active-time") => html.match(new RegExp(`<section id="${id}">([\\s\\S]*?)<\\/section>`))![1]!;
const read = (x: Awaited<ReturnType<typeof disk>>) => withReadOnlyStore(x.data, (db, key) => stores.createSourceStore(db, key).readSource(x.sourceId)!);
afterEach(() => vi.restoreAllMocks());

it.each(matrix)("$name stored report makes one pinned read and one native call after raw deletion", async ({ capture, example }) => {
  const x = await disk(example.provider, example.rows()); await runScan({ ...x.options, ...capture.options });
  const snapshot = await read(x); await rm(x.inputRoot, { recursive: true }); const before = await bytes(x.data), original = stores.createSourceStore;
  let reads = 0;
  vi.spyOn(stores, "createSourceStore").mockImplementation((db, key) => {
    const store = original(db, key); return { ...store, readSource: (id: string) => {
      reads++; expect(db.isTransaction).toBe(true); expect(db.prepare("PRAGMA query_only").get()!.query_only).toBe(1);
      expect(id).toBe(x.sourceId); return store.readSource(id);
    }, listSources() { throw Error("unexpected source discovery"); } };
  });
  const spy = vi.spyOn(active, "analyzeSourceActiveTime"), output = join(x.root, "report.html");
  const receipt = await runReport({ unified: true, source: x.sourceId, dataDir: x.data, output });
  expect(reads).toBe(1); expect(spy).toHaveBeenCalledExactlyOnceWith(snapshot);
  const a = spy.mock.results[0]!.value as active.SourceActiveTimeAnalysis, html = await readFile(output, "utf8"), body = section(html);
  expect(a.parserVersion).toBe(capture.version + (example.provider === "claude" ? 1 : 0));
  expect(a.summary.eligibleTurns).toBe(example.turns);
  if (example.provider === "codex") {
    expect(a.partitions).toMatchObject([{ activeTimeMs: example.union, observedSpanMs: example.span, turnN: example.turns }]);
    expect(body).toContain(`Distinct corroborating observations</th><td>${example.proofs}`);
    expect(body).toContain(`<td>${example.union}</td><td>none</td><td>${example.span}</td><td>none</td>`);
    expect(section(html, "unified-exploration")).toContain("unsupported_provider");
  } else {
    expect(snapshot.evidence!.turns).toHaveLength(1); expect(a.activeTimeAssessmentReason).toBe("unsupported_provider");
    expect(body).toContain("Active Time partitions unavailable"); expect(body).not.toContain("Active Time partitions: shown=0/0");
    expect(section(html, "unified-exploration")).toContain("Exploration candidates: shown=1/1; omitted=0");
  }
  expect(receipt).toMatchObject({ layout: "unified", revision: 1, status: "published" });
  expect(before.map(x => x.name)).toEqual(["agentprof.sqlite", "identity-key.json"]);
  expect(before.every(x => (x.mode & 0o777) === 0o600)).toBe(true); expect(await bytes(x.data)).toEqual(before);
  expect((await stat(output)).mode & 0o777).toBe(0o600); expect(html).not.toMatch(/FICTITIOUS_|h1:|<script|sourceRef|byteOffset/);
  spy.mockRestore(); expect(html).toBe(renderUnifiedSourceReport(buildUnifiedSourceReport(snapshot)));
});
it.each(matrix)("$name built fresh/stored raw-deleted HTML agrees with unchanged Active Time JSON", async ({ capture, example }) => {
  const x = await disk(example.provider, example.rows()), fresh = join(x.root, "fresh.html"), stored = join(x.root, "stored.html");
  const r = invoke(["report", "--unified", "--provider", example.provider, "--input", x.path, "--data-dir", x.data, "--output", fresh, "--json", ...capture.flags]);
  expect([0, 1], r.stdout + r.stderr).toContain(r.status); const receipt = JSON.parse(r.stdout).result;
  expect(r.status).toBe(receipt.scan.status === "partial" ? 1 : 0); expect(receipt.report).toMatchObject({ layout: "unified", published: true, revision: 1 });
  const source = await read(x); await rm(x.inputRoot, { recursive: true }); const before = await bytes(x.data);
  expect(invoke(["report", "--unified", "--source", x.sourceId, "--data-dir", x.data, "--output", stored, "--json"]).status).toBe(0);
  const json = invoke(["stats", "--source", x.sourceId, "--data-dir", x.data, "--active-time", "--json"]);
  expect(json.status).toBe(0); const a = JSON.parse(json.stdout).result.analysis;
  expect(a).toEqual(active.analyzeSourceActiveTime(source)); expect(a.summary.eligibleTurns).toBe(example.turns);
  expect(a.parserVersion).toBe(capture.version + (example.provider === "claude" ? 1 : 0));
  expect(await readFile(stored, "utf8")).toBe(await readFile(fresh, "utf8"));
  expect(await readFile(stored, "utf8")).toBe(renderUnifiedSourceReport(buildUnifiedSourceReport(source)));
  expect(await bytes(x.data)).toEqual(before);
});
it.each([
  { name: "partial shape", rows: [...positive, record({ type: "FICTITIOUS_UNSUPPORTED" }, 20000)], reason: "partial_shape_coverage", union: 15000 },
  { name: "genuine zero", rows: [meta(), wall("zero", 0, 0)], reason: null, union: 0 },
])("fresh $name retains scan exit, assessment reason and zero distinction", async example => {
  const x = await disk("codex", example.rows), output = join(x.root, "out.html");
  const r = invoke(["report", "--unified", "--provider", "codex", "--input", x.path, "--data-dir", x.data, "--output", output, "--json"]);
  expect([0, 1]).toContain(r.status); const result = JSON.parse(r.stdout).result;
  expect(r.status).toBe(result.scan.status === "partial" ? 1 : 0); expect(result.report.published).toBe(true);
  const a = active.analyzeSourceActiveTime(await read(x)); expect(a.activeTimeAssessmentReason).toBe(example.reason); expect(a.partitions![0]!.activeTimeMs).toBe(example.union);
  const body = section(await readFile(output, "utf8")); expect(body).toContain(`assessment reason=${example.reason ?? "none"}`);
  expect(body).toContain(`<td>${example.union}</td><td>none</td>`);
});
it("non-unified absent and false never call Active Time", async () => {
  const x = await disk("codex", positive); await runScan(x.options);
  const spy = vi.spyOn(active, "analyzeSourceActiveTime").mockImplementation(() => { throw Error("not selected"); });
  const first = join(x.root, "default.html"), second = join(x.root, "false.html");
  await runReport({ source: x.sourceId, dataDir: x.data, output: first });
  const result = await runReport({ unified: false, source: x.sourceId, dataDir: x.data, output: second });
  expect(spy).not.toHaveBeenCalled(); expect(result).not.toHaveProperty("layout");
  expect(await readFile(first, "utf8")).toBe(await readFile(second, "utf8")); expect(await readFile(first, "utf8")).not.toContain('id="unified-active-time"');
});
it("refuses stale revision before analysis/publication and collision without overwriting", async () => {
  const x = await disk("codex", positive); await runScan(x.options); await rm(x.inputRoot, { recursive: true });
  const before = await bytes(x.data), output = join(x.root, "out.html"), spy = vi.spyOn(active, "analyzeSourceActiveTime");
  await expect(runReport({ unified: true, source: x.sourceId, dataDir: x.data, output }, { expectedRevision: 2 })).rejects.toMatchObject({ code: "SOURCE_REVISION_CHANGED" });
  expect(spy).not.toHaveBeenCalled(); expect(existsSync(output)).toBe(false);
  await runReport({ unified: true, source: x.sourceId, dataDir: x.data, output }); const content = await readFile(output);
  await expect(runReport({ unified: true, source: x.sourceId, dataDir: x.data, output })).rejects.toMatchObject({ code: "REPORT_OUTPUT_UNSAFE" });
  expect(await readFile(output)).toEqual(content); expect(await bytes(x.data)).toEqual(before);
});
const statsFlags = ["search-recurrence", "recovery", "retry-overhead", "active-time", "tokens", "latency", "tool-busy", "cache-share", "execution-status", "duration-coverage", "usage-coverage", "read-ratio", "search-ratio", "overlap-summary", "cache-write-share", "reasoning-share", "outcome-mix", "timing-evidence", "duration-scope", "usage-finality", "capabilities", "status-mix", "usage-selection", "diagnostics", "shape-coverage", "duration-exclusions", "usage-exclusions", "cache-components", "output-composition", "inventory", "readiness", "time-breakdown", "invocation-overlap", "read-revisits", "failures", "recovery-distribution", "retry-resolution", "failure-admission", "failure-timing", "read-identity", "search-identity", "boundary-coverage", "slow-candidates", "slow-coverage", "token-completeness"];
describe.skipIf(!baseline)("genuine PR154 immediate report predecessor", () => {
  it.each(examples)("$name preserves all old command bytes and default reports", async example => {
    const x = await disk(example.provider, example.rows()); await runScan({ ...x.options, patternEvidence: true }); await rm(x.inputRoot, { recursive: true }); const before = await bytes(x.data);
    for (const command of [[], ["scan"], ["stats"], ["insights"], ["patterns"], ["report"], ["open"], ["history"], ["reconcile"]]) {
      const args = [...command, "--help"]; expect(invoke(args)).toEqual(invoke(args, baseline!));
    }
    expect(invoke(["--version"])).toEqual(invoke(["--version"], baseline!));
    const common = ["--source", x.sourceId, "--data-dir", x.data];
    for (const args of [["stats", "--list-sources", "--data-dir", x.data], ["stats", ...common], ...statsFlags.map(flag => ["stats", ...common, `--${flag}`]), ["insights", ...common], ["insights", ...common, "--exploration"], ["patterns", ...common]]) {
      for (const format of [[], ["--json"]]) expect(invoke([...args, ...format])).toEqual(invoke([...args, ...format], baseline!));
    }
    const output = join(x.root, "default.html");
    for (const format of [[], ["--json"]]) {
      const args = ["report", ...common, "--output", output, ...format], prior = invoke(args, baseline!); expect(prior.status).toBe(0);
      const html = await readFile(output), mode = (await stat(output)).mode; await rm(output);
      expect(invoke(args)).toEqual(prior); expect(await readFile(output)).toEqual(html); expect((await stat(output)).mode).toBe(mode); await rm(output);
    }
    expect(await bytes(x.data)).toEqual(before);
  }, 60000);
  it.each(examples)("$name gap control lacks Active Time but its full exploration section remains identical", async example => {
    const x = await disk(example.provider, example.rows()); await runScan(x.options); await rm(x.inputRoot, { recursive: true });
    const output = join(x.root, "unified.html"), args = ["report", "--unified", "--source", x.sourceId, "--data-dir", x.data, "--output", output, "--json"];
    expect(invoke(args, baseline!).status).toBe(0); const old = await readFile(output, "utf8"); await rm(output);
    expect(old).not.toContain('id="unified-active-time"'); expect(invoke(args).status).toBe(0);
    const current = await readFile(output, "utf8"); expect(current).toContain('id="unified-active-time"');
    expect(section(current, "unified-exploration")).toBe(section(old, "unified-exploration"));
  });
  it("keeps invalid selection refusals storage-free and byte-identical", () => {
    const data = join(temporaryDirectory(), "absent"), output = join(dirname(data), "new.html");
    for (const args of [["report", "--unified"], ["report", "--unified", "--source", "bad", "--output", output], ["report", "--unified", "--provider", "bad", "--input", "absent.jsonl", "--output", output], ["report", "--unified", "--provider", "codex", "--input", "absent.jsonl", "--output", output, "--usage-timing", "--pattern-evidence"]]) {
      const selected = [...args, "--data-dir", data, "--json"], current = invoke(selected); expect(current).toEqual(invoke(selected, baseline!)); expect(current.status).toBe(2);
      expect(existsSync(data)).toBe(false); expect(existsSync(output)).toBe(false);
    }
  });
});
describe.skipIf(!installed)("actual scripts-disabled installed Active Time report", () => {
  it.each(matrix)("$name includes the module and preserves fresh/stored/native results outside source", async ({ capture, example }) => {
    const outside = temporaryDirectory(); expect(resolve(installed!)).not.toBe(binary);
    expect(await readFile(join(dirname(installed!), "report", "active-time-section.js"))).toEqual(await readFile("dist/report/active-time-section.js"));
    const x = await disk(example.provider, example.rows()), output = join(x.root, "report.html");
    const fresh = invoke(["report", "--unified", "--provider", example.provider, "--input", x.path, "--data-dir", x.data, "--output", output, "--json", ...capture.flags], installed!, outside);
    expect([0, 1], fresh.stdout + fresh.stderr).toContain(fresh.status); expect(JSON.parse(fresh.stdout).result.report.published).toBe(true);
    const html = await readFile(output, "utf8"); await rm(output); await rm(x.inputRoot, { recursive: true }); const before = await bytes(x.data);
    const args = ["report", "--unified", "--source", x.sourceId, "--data-dir", x.data, "--output", output, "--json"], built = invoke(args, binary, outside);
    expect(built.status).toBe(0); expect(await readFile(output, "utf8")).toBe(html); await rm(output);
    expect(invoke(args, installed!, outside)).toEqual(built); expect(await readFile(output, "utf8")).toBe(html);
    for (const format of [[], ["--json"]]) expect(invoke(["stats", "--source", x.sourceId, "--data-dir", x.data, "--active-time", ...format], installed!, outside)).toEqual(invoke(["stats", "--source", x.sourceId, "--data-dir", x.data, "--active-time", ...format], binary, outside));
    expect(await bytes(x.data)).toEqual(before); expect(html).not.toMatch(/FICTITIOUS_|h1:|<script/);
  });
});
