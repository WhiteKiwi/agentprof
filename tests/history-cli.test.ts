import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { runHistory, validateHistoryArguments, formatHistoryResult } from "../src/cli/history.js";
import { runScan } from "../src/cli/scan.js";
import { withReadOnlyStore } from "../src/db/read-only.js";
import * as stores from "../src/db/source-store.js";
import * as native from "../src/analysis/source-failures.js";
import { stored, bytes, id, positive } from "./recovery-fixture.js";
import { temporaryDirectory } from "./helpers.js";

const period = { from: "2026-10-03T00:00:00Z", to: "2026-10-04T00:00:00Z" };
const binary = resolve("dist/agentprof.cjs");
function cli(args: string[]) {
  return spawnSync(process.execPath, [binary, ...args], { encoding: "utf8", timeout: 15000,
    env: { ...process.env, NODE_NO_WARNINGS: "1" } });
}
async function selectedCopies() {
  const x = await stored(), input = join(x.root, "copies");
  await mkdir(input);
  for (const name of ["live.jsonl", "archive.jsonl"]) await writeFile(join(input, name), x.raw);
  const scan = await runScan({ dataDir: x.data, codexRoot: [input] });
  expect(scan.counts.committed).toBe(2);
  const ids = await withReadOnlyStore(x.data, (db, key) => stores.createSourceStore(db, key).listSources().items.map(s => s.sourceId));
  await rm(input, { recursive: true });
  return { ...x, ids };
}
const claude = [0, 1].flatMap(i => [
  { type: "assistant", uuid: `a${i}`, timestamp: `2026-10-03T00:00:0${i * 2}.000Z`,
    sessionId: "FICTITIOUS_HISTORY_CLAUDE", cwd: "/FICTITIOUS_HISTORY_ROOT", version: "2.1.241", isSidechain: false,
    message: { id: `m${i}`, role: "assistant", content: [{ type: "tool_use", id: `t${i}`, name: "Read", input: { file_path: "/FICTITIOUS_HISTORY_ROOT/a.ts" } }] } },
  { type: "user", uuid: `u${i}`, timestamp: `2026-10-03T00:00:0${i * 2 + 1}.000Z`,
    sessionId: "FICTITIOUS_HISTORY_CLAUDE", isSidechain: false,
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: `t${i}`, is_error: false, content: "FICTITIOUS_HISTORY_CONTENT" }] } },
]);

describe("read-only history integration", () => {
  it.each([["codex", positive], ["claude", claude]] as const)("reads actual raw-deleted %s inputs and preserves private bytes", async (provider, records) => {
    const x = await stored(records, provider), before = await bytes(x.data);
    const a = await runHistory({ ...period, dataDir: x.data, source: [x.sourceId] });
    expect(a.reconciliation.counts.admittedExecutions).toBe(2);
    expect(a.days).toHaveLength(1); expect(a.days[0]).toMatchObject({ toolBusyMs: 2000, terminalCompletions: 2, provider });
    expect(a.days[0]!.failedN).toBe(provider === "codex" ? 1 : 0);
    expect(JSON.parse(formatHistoryResult(a, true)).result).toEqual(a);
    expect(formatHistoryResult(a, true) + formatHistoryResult(a, false)).not.toMatch(/FICTITIOUS_|operationKey|sourceRef|errorFingerprint/);
    expect(await bytes(x.data)).toEqual(before);
  });
  it("deduplicates three real persisted file copies without hidden source discovery", async () => {
    const x = await selectedCopies(), before = await bytes(x.data), original = stores.createSourceStore;
    let reads = 0, listCalls = 0;
    const spy = vi.spyOn(stores, "createSourceStore").mockImplementation((db, key) => {
      const store = original(db, key);
      return { ...store, readSource(sourceId) { reads++; expect(db.isTransaction).toBe(true); return store.readSource(sourceId); },
        listSources() { listCalls++; throw Error("history must not discover sources"); } };
    });
    const admission = vi.spyOn(native, "analyzeSourceFailures");
    try {
      const a = await runHistory({ ...period, dataDir: x.data, source: x.ids });
      expect(reads).toBe(3); expect(listCalls).toBe(0); expect(admission).toHaveBeenCalledTimes(3);
      expect(a.reconciliation.counts).toMatchObject({ eventCopies: 6, canonicalExecutions: 2, duplicateCopies: 4, admittedExecutions: 2 });
      expect(a.days[0]).toMatchObject({ terminalCompletions: 2, failedN: 1, toolBusyMs: 2000 });
      expect(a.reconciliation.executions.every(e => e.copies.length === 3 && e.copies.every(c => c.proofIds.length === 2))).toBe(true);
    } finally { spy.mockRestore(); admission.mockRestore(); }
    expect(await bytes(x.data)).toEqual(before);
  });
  it("filters daily rows by exact session without shrinking reconciliation", async () => {
    const x = await stored(), options = { ...period, dataDir: x.data, source: [x.sourceId] };
    const a = await runHistory({ ...options, session: x.source.events[0]!.sessionId });
    expect(a.days[0]!.terminalCompletions).toBe(2);
    const empty = await runHistory({ ...options, session: id("session", "unseen") });
    expect(empty.days).toEqual([]); expect(empty.reconciliation.counts.admittedExecutions).toBe(2);
  });
  it("rejects absent or wrong-key source/session without changing data", async () => {
    const x = await stored(), before = await bytes(x.data);
    await expect(runHistory({ ...period, dataDir: x.data, source: [id("source", "missing")] })).rejects.toMatchObject({ code: "SOURCE_NOT_FOUND" });
    const wrong = x.sourceId.replace(":" + "6".repeat(32) + ":", ":" + "7".repeat(32) + ":");
    await expect(runHistory({ ...period, dataDir: x.data, source: [wrong] })).rejects.toMatchObject({ code: "INVALID_IDENTITY_KEY" });
    const wrongSession = x.source.events[0]!.sessionId.replace(":" + "6".repeat(32) + ":", ":" + "7".repeat(32) + ":");
    await expect(runHistory({ ...period, dataDir: x.data, source: [x.sourceId], session: wrongSession })).rejects.toMatchObject({ code: "INVALID_IDENTITY_KEY" });
    expect(await bytes(x.data)).toEqual(before);
  });
  it("rejects a valid query for an absent store without bootstrapping it", async () => {
    const data = join(temporaryDirectory(), "absent");
    await expect(runHistory({ ...period, dataDir: data, source: [id("source", "a")] })).rejects.toThrow();
    expect(existsSync(data)).toBe(false);
  });
  it.each([
    {}, { source: [] }, { source: "bad" }, { source: ["bad"] }, { source: [id("source", "a"), id("source", "a")] },
    { from: undefined }, { to: undefined }, { offset: "Asia/Seoul" }, { session: "bad" }, { json: 1 },
    { codexRoot: ["/FICTITIOUS_ROOT"] }, { claudeRoot: ["/FICTITIOUS_ROOT"] }, { dataDir: 42 },
    { source: Array.from({ length: 17 }, (_, n) => id("source", String(n))) },
  ])("rejects invalid options before I/O: %s", bad => {
    const data = join(temporaryDirectory(), "absent");
    const options = Object.keys(bad).length === 0 ? {} : { ...period, dataDir: data, source: [id("source", "a")], ...bad };
    expect(() => validateHistoryArguments(options as never)).toThrow(); expect(existsSync(data)).toBe(false);
  });
  it("built history CLI emits structured data and rejects duplicate/extra/unknown flags", async () => {
    const x = await stored(), before = await bytes(x.data);
    const args = ["history", "--source", x.sourceId, "--data-dir", x.data, "--from", period.from, "--to", period.to, "--json"];
    const ok = cli(args); expect(ok.status, ok.stderr).toBe(0);
    expect(JSON.parse(ok.stdout).result.days[0].terminalCompletions).toBe(2);
    for (const suffix of [["--from", period.from], ["--to", period.to], ["--source", x.sourceId], ["--unknown"], ["extra"],
      ["--codex-root", "/FICTITIOUS_ROOT"], ["--offset", "+09:00", "--offset", "+09:00"],
      ["--session", x.source.events[0]!.sessionId, "--session", x.source.events[0]!.sessionId], ["--data-dir", x.data], ["--json"]]) {
      const bad = cli([...args, ...suffix]); expect(bad.status, JSON.stringify(suffix) + bad.stderr).toBe(2);
      expect(bad.stdout).toBe(""); expect(JSON.parse(bad.stderr).error.code).toBe("INVALID_ARGUMENT");
    }
    expect(await bytes(x.data)).toEqual(before);
  });
  it("help is storage-free and repeated distinct sources work through the real binary", async () => {
    const x = await selectedCopies(), before = await bytes(x.data);
    const run = cli(["history", ...x.ids.flatMap(s => ["--source", s]), "--data-dir", x.data,
      "--from", period.from, "--to", period.to, "--offset", "+09:00", "--json"]);
    expect(run.status, run.stderr).toBe(0); expect(JSON.parse(run.stdout).result.reconciliation.counts.duplicateCopies).toBe(4);
    const data = join(x.root, "absent"), help = cli(["--data-dir", data, "history", "--help"]);
    expect(help.status).toBe(0); expect(help.stdout).toContain("--offset"); expect(existsSync(data)).toBe(false);
    expect(await bytes(x.data)).toEqual(before);
  });
  it("loads modules outside the synchronous pinned callback and does not edit old handlers", () => {
    const code = readFileSync(resolve("src/cli/history.ts"), "utf8");
    const callback = code.slice(code.indexOf("return withReadOnlyStore"), code.indexOf("const value ="));
    expect(callback).not.toMatch(/\bawait\b/); expect(callback).not.toContain("listSources(");
    expect(readFileSync(resolve("src/cli/main.ts"), "utf8")).toContain("registerHistoryCommand(program);");
  });
});
