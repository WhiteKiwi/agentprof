// Planning artifact only. NOT RUN. Proposed destination: tests/source-report-command-breakdown-cli.test.ts
import { createHmac, createHash } from "node:crypto";
import { mkdtemp, realpath, mkdir, writeFile, readFile, readdir, stat, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { runReport, formatReportResult } from "../src/cli/report.js";
import { runScan } from "../src/cli/scan.js";
import { openDatabase } from "../src/db/database.js";
import * as storeModule from "../src/db/source-store.js";
import * as summaryModule from "../src/analysis/source-summary.js";
import * as slowModule from "../src/analysis/source-slow-tool.js";
import * as breakdownModule from "../src/report/command-breakdown.js";
import { buildSourceReportModel } from "../src/report/source-model.js";

const sentinel = "FICTITIOUS_COMMAND_BREAKDOWN_PRIVATE_<script>window.pwned=1</script>";
const epoch = Date.UTC(2026, 8, 20), at = (ms: number) => new Date(epoch + ms).toISOString();
function records(provider: "codex" | "claude") {
  if (provider === "codex") return [
    { timestamp: at(0), type: "session_meta", payload: { id: "command-breakdown-synthetic", cwd: `/${sentinel}` } },
    ...Array.from({ length: 6 }, (_, i) => ({
      timestamp: at(1000), type: "event_msg", payload: {
        type: "item_completed", thread_id: "command-breakdown-synthetic", started_at_ms: epoch, completed_at_ms: epoch + 1000,
        item: { type: "CommandExecution", id: `call-${i}`, source: "unified_exec_startup",
          command: i < 5 ? `npm test '${sentinel}-${i}'` : "cargo build", status: "completed", exit_code: 0,
          duration: { secs: 0, nanos: (i < 5 ? 4 : 80) * 1e6 }, output: sentinel },
      },
    })),
  ];
  return Array.from({ length: 6 }, (_, i) => [
    { type: "assistant", uuid: `call-${i}`, sessionId: "command-breakdown-synthetic", isSidechain: false,
      timestamp: at(0), cwd: `/${sentinel}`, message: { id: `response-${i}`, role: "assistant",
        content: [{ type: "tool_use", id: `tool-${i}`, name: "Bash", input: { command: i < 5 ? `npm test '${sentinel}-${i}'` : "cargo build" } }] } },
    { type: "user", uuid: `result-${i}`, sessionId: "command-breakdown-synthetic", isSidechain: false,
      timestamp: at(i < 5 ? 4 : 80), message: { role: "user",
        content: [{ type: "tool_result", tool_use_id: `tool-${i}`, is_error: false, content: sentinel }] } },
  ]).flat();
}
async function snapshot(dir: string) {
  return Promise.all((await readdir(dir)).sort().map(async name => ({
    name, sha256: createHash("sha256").update(await readFile(join(dir, name))).digest("hex"),
    mode: (await stat(join(dir, name))).mode,
  })));
}
async function fixture(provider: "codex" | "claude") {
  const root = await mkdtemp(join(await realpath(tmpdir()), "agentprof-native-breakdown-"));
  const data = join(root, "data"), input = join(root, "input"), output = join(root, "report.html");
  try {
    await mkdir(input);
    const path = join(input, "synthetic.jsonl");
    await writeFile(path, records(provider).map(row => JSON.stringify(row)).join("\n") + "\n");
    const scan = await runScan({ dataDir: data, codexRoot: provider === "codex" ? [input] : [], claudeRoot: provider === "claude" ? [input] : [] });
    expect(scan.counts.committed).toBe(1);
    const key = JSON.parse(await readFile(join(data, "identity-key.json"), "utf8"));
    // Independently framed source identity, not a production helper-derived expectation.
    const sourceId = `h1:${key.keyId}:source:` + createHmac("sha256", Buffer.from(key.secret, "hex"))
      .update(JSON.stringify([1, 1, "source", provider, path])).digest("hex");
    const db = await openDatabase(data);
    let saved: NonNullable<ReturnType<ReturnType<typeof storeModule.createSourceStore>["readSource"]>>;
    try { saved = storeModule.createSourceStore(db, key.keyId).readSource(sourceId)!; } finally { db.close(); }
    expect(saved!.events).toHaveLength(6);
    expect(saved!.events.map(row => row.durationMs).sort((a, b) => a! - b!)).toEqual([4, 4, 4, 4, 4, 80]);
    const tests = saved!.events.filter(row => row.category === "test" && row.commandPattern === "npm test <target>");
    const builds = saved!.events.filter(row => row.category === "build" && row.commandPattern === "cargo build");
    expect(tests).toHaveLength(5); expect(tests.every(row => row.durationMs === 4)).toBe(true);
    expect(builds).toHaveLength(1); expect(builds[0]!.durationMs).toBe(80);
    expect(saved!.events.every(row => row.timingEvidence === (provider === "codex" ? "source_reported" : "paired_timestamps"))).toBe(true);
    expect(saved!.events.every(row => row.durationScope === (provider === "codex" ? "process_runtime" : "invocation_latency"))).toBe(true);
    await rm(input, { recursive: true });
    return { root, data, output, sourceId, saved: saved!, key };
  } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
}
function table(html: string, caption: string) {
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/g)].map(match => match[0]);
  const match = tables.find(value => value.match(/<caption\b[^>]*>([^<]*)<\/caption>/)?.[1] === `${caption} · ms`);
  expect(match, `missing ${caption}`).toBeDefined();
  return match!;
}

it.each(["codex", "claude"] as const)("%s ordinary stored generation yields the independent one-off-build oracle after input deletion", async provider => {
  const f = await fixture(provider);
  try {
    const summary = summaryModule.summarizeSource(f.saved), slow = slowModule.analyzeSourceSlowTool(f.saved);
    const originalSummary = JSON.stringify(summary), originalSlow = JSON.stringify(slow);
    expect(slow.partitions[0]).toMatchObject({ status: "evaluated", denominatorN: 6, denominatorSumMs: 100 });
    expect(slow.candidates).toHaveLength(1);
    expect(slow.candidates![0]).toMatchObject({ n: 5, sumMs: 20, observedEligibleNativeToolDurationShare: 0.2 });
    const breakdown = breakdownModule.buildSourceCommandBreakdown(f.saved, slow);
    expect(breakdown.partitions[0]!.groups!.map(row => [row.n, row.sumMs, row.share])).toEqual([[1, 80, 0.8], [5, 20, 0.2]]);
    expect(breakdown.partitions[0]!.calls!.map(row => row.durationMs)).toEqual([80, 4, 4, 4, 4, 4]);
    buildSourceReportModel(summary, slow, breakdown);
    expect(JSON.stringify(summary)).toBe(originalSummary); expect(JSON.stringify(slow)).toBe(originalSlow);
    const before = await snapshot(f.data), receipt = await runReport({ dataDir: f.data, source: f.sourceId, output: f.output });
    const html = await readFile(f.output, "utf8"), shares = table(html, "Native command duration shares"), calls = table(html, "Slowest recorded calls");
    expect(shares).toContain("cargo build"); expect(shares).toContain("80 / 100 ms");
    expect(shares).toContain("20 / 100 ms"); expect(shares).toContain("80.0%"); expect(shares).toContain("20.0%");
    expect(calls).toContain("cargo build"); expect(calls).toContain("80");
    const firstCall = calls.match(/<tbody>\s*(<tr\b[\s\S]*?<\/tr>)/)![1]!;
    expect(firstCall).toContain("cargo build");
    expect(html).not.toMatch(/FICTITIOUS_|window\.pwned|synthetic\.jsonl|sourceRef|eventIds|boundaryFingerprint|cacheEvidence|<script\b|\sstyle\s*=/i);
    for (const e of f.saved.events) expect(html).not.toContain(e.id);
    expect(html).not.toContain(f.key.secret); expect(html).not.toContain(f.data);
    expect(html).toContain(provider === "codex" ? "process_runtime" : "invocation_latency");
    expect(Buffer.byteLength(html)).toBeLessThanOrEqual(1048576);
    expect((await stat(f.output)).mode & 0o777).toBe(0o600);
    expect(await snapshot(f.data)).toEqual(before);
    const again = join(f.root, "again.html"); await runReport({ dataDir: f.data, source: f.sourceId, output: again });
    expect(await readFile(again, "utf8")).toBe(html);
    expect(JSON.parse(formatReportResult(receipt, true))).toEqual({ schema: "agentprof.cli/v1", ok: true, command: "report", result: receipt });
    expect(Object.keys(receipt).sort()).not.toContain("commandBreakdown");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

it("joins one source and one unchanged SlowTool result inside the existing pinned transaction", async () => {
  const f = await fixture("codex"), originals = {
    store: storeModule.createSourceStore, summary: summaryModule.summarizeSource,
    slow: slowModule.analyzeSourceSlowTool, breakdown: breakdownModule.buildSourceCommandBreakdown,
  };
  let reads = 0, summaries = 0, rules = 0, joins = 0;
  let selected: unknown, measured: unknown, inTransaction: (() => boolean) | undefined;
  const store = vi.spyOn(storeModule, "createSourceStore").mockImplementation((db, key) => {
    const value = originals.store(db, key); inTransaction = () => db.isTransaction;
    return { ...value, listSources() { throw new Error("unexpected listing"); }, readSource(sourceId) {
      reads++; expect(db.isTransaction).toBe(true); selected = value.readSource(sourceId);
      return selected as ReturnType<typeof value.readSource>;
    } };
  });
  const summary = vi.spyOn(summaryModule, "summarizeSource").mockImplementation(s => {
    summaries++; expect(s).toBe(selected); expect(inTransaction!()).toBe(true); return originals.summary(s);
  });
  const slow = vi.spyOn(slowModule, "analyzeSourceSlowTool").mockImplementation(s => {
    rules++; expect(s).toBe(selected); expect(inTransaction!()).toBe(true); const result = originals.slow(s); measured = result; return result;
  });
  const breakdown = vi.spyOn(breakdownModule, "buildSourceCommandBreakdown").mockImplementation((s, a) => {
    joins++; expect(s).toBe(selected); expect(a).toBe(measured); expect(inTransaction!()).toBe(true); return originals.breakdown(s, a);
  });
  try {
    await runReport({ dataDir: f.data, source: f.sourceId, output: f.output });
    expect([reads, summaries, rules, joins]).toEqual([1, 1, 1, 1]);
  } finally {
    store.mockRestore(); summary.mockRestore(); slow.mockRestore(); breakdown.mockRestore();
    await rm(f.root, { recursive: true, force: true });
  }
});

it("stays truthful for actual event-only storage instead of rendering a healthy zero", async () => {
  const f = await fixture("codex");
  try {
    const { revision, availability, persistedScope, aggregationReady, parserResumeReady, evidence, cacheEvidence, relationshipEvidence, ...input } = f.saved;
    const db = await openDatabase(f.data);
    try { expect(storeModule.createSourceStore(db, f.key.keyId).replaceSource(input, revision).status).toBe("committed"); }
    finally { db.close(); }
    const before = await snapshot(f.data); await runReport({ dataDir: f.data, source: f.sourceId, output: f.output });
    const html = await readFile(f.output, "utf8");
    expect(html).toContain("evidence_absent"); expect(html).toContain("unavailable");
    expect(html).not.toMatch(/0 native calls|0 native groups|no bottleneck|healthy/i);
    expect(await snapshot(f.data)).toEqual(before);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

const installed = process.env.AGENTPROF_REPORT_INSTALLED_BINARY;
const current = fileURLToPath(new URL("../dist/agentprof.cjs", import.meta.url));
const invoke = (binary: string, args: string[]) => spawnSync(process.execPath, [binary, ...args], {
  encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=512 --disable-warning=ExperimentalWarning" },
});
it.skipIf(!installed)("current packed-installed CLI emits identical native-share HTML from the same stored generation", async () => {
  const f = await fixture("codex");
  try {
    const before = await snapshot(f.data), args = ["report", "--source", f.sourceId, "--output", f.output, "--data-dir", f.data, "--json"];
    const local = invoke(current, args); expect(local.status, local.stderr).toBe(0);
    const html = await readFile(f.output, "utf8"), mode = (await stat(f.output)).mode;
    table(html, "Native command duration shares");
    await rm(f.output);
    const packed = invoke(installed!, args);
    expect(packed).toMatchObject({ status: local.status, stdout: local.stdout, stderr: local.stderr });
    expect(await readFile(f.output, "utf8")).toBe(html); expect((await stat(f.output)).mode).toBe(mode);
    expect(await snapshot(f.data)).toEqual(before);
    expect(html).toContain("80 / 100 ms"); expect(html).toContain("80.0%");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
