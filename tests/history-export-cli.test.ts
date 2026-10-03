import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runHistoryExport, formatHistoryExport, historyExportExitCode, validateHistoryExportArguments } from "../src/cli/history-export.js";
import type { HistoryExportArguments } from "../src/cli/history-export.js";
import * as history from "../src/cli/history.js";
import * as stores from "../src/db/source-store.js";
import * as writer from "../src/report/write-output.js";
import { renderHistoryPage } from "../src/report/history-page.js";
import { stored, bytes, id, positive } from "./recovery-fixture.js";
import { temporaryDirectory } from "./helpers.js";

const period = { from: "2026-10-03T00:00:00Z", to: "2026-10-04T00:00:00Z" };
const binary = resolve("dist/agentprof.cjs");
const cli = (args: string[]) => spawnSync(process.execPath, [binary, ...args], { encoding: "utf8", timeout: 15000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, NODE_NO_WARNINGS: "1" } });
const claude = [0, 1].flatMap(i => [
  { type: "assistant", uuid: `a${i}`, timestamp: `2026-10-03T00:00:0${i * 2}.000Z`, sessionId: "FICTITIOUS_EXPORT_CLAUDE", cwd: "/FICTITIOUS_EXPORT_ROOT", version: "2.1.241", isSidechain: false,
    message: { id: `m${i}`, role: "assistant", content: [{ type: "tool_use", id: `t${i}`, name: "Read", input: { file_path: "/FICTITIOUS_EXPORT_ROOT/a.ts" } }] } },
  { type: "user", uuid: `u${i}`, timestamp: `2026-10-03T00:00:0${i * 2 + 1}.000Z`, sessionId: "FICTITIOUS_EXPORT_CLAUDE", isSidechain: false,
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: `t${i}`, is_error: false, content: "FICTITIOUS_EXPORT_CONTENT" }] } },
]);
afterEach(() => vi.restoreAllMocks());
describe("history HTML export", () => {
  it.each([["codex", positive], ["claude", claude]] as const)("exports ordinary stored %s observations after raw deletion, with exactly one pinned read", async (provider, records) => {
    const x = await stored(records, provider), before = await bytes(x.data), output = join(x.root, "history.html");
    const original = stores.createSourceStore; let reads = 0;
    vi.spyOn(stores, "createSourceStore").mockImplementation((db, key) => {
      const store = original(db, key);
      return { ...store, readSource(sourceId) { reads++; expect(db.isTransaction).toBe(true); return store.readSource(sourceId); }, listSources() { throw Error("Unexpected source discovery"); } };
    });
    const run = vi.spyOn(history, "runHistory");
    const result = await runHistoryExport({ ...period, source: [x.sourceId], dataDir: x.data, output });
    expect(reads).toBe(1); expect(run).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ mode: "history_html", selectedSources: 1, dailyPartitions: 1, publication: { published: true, targetVerification: "verified", cleanup: "removed" } });
    const html = await readFile(output, "utf8");
    expect(html).toContain("2000 / 86400000 ms"); expect(html).not.toMatch(/h1:|FICTITIOUS_/); expect(html).not.toContain(x.data);
    expect(await bytes(x.data)).toEqual(before);
    expect(JSON.parse(formatHistoryExport(result, true)).result).toEqual(result);
  });
  it("never overwrites existing files or exports inside the private store", async () => {
    const x = await stored(), before = await bytes(x.data), output = join(x.root, "existing.html");
    await writeFile(output, "existing user file");
    const options = { ...period, source: [x.sourceId], dataDir: x.data };
    await expect(runHistoryExport({ ...options, output })).rejects.toThrow();
    expect(await readFile(output, "utf8")).toBe("existing user file");
    await expect(runHistoryExport({ ...options, output: join(x.data, "private.html") })).rejects.toThrow();
    expect(existsSync(join(x.data, "private.html"))).toBe(false); expect(await bytes(x.data)).toEqual(before);
  });
  it("does not follow or replace an existing output symlink", async () => {
    const x = await stored(), target = join(x.root, "target.txt"), output = join(x.root, "linked.html");
    await writeFile(target, "sentinel"); await symlink(target, output);
    await expect(runHistoryExport({ ...period, source: [x.sourceId], dataDir: x.data, output })).rejects.toThrow();
    expect(await readFile(target, "utf8")).toBe("sentinel");
  });
  it.each([undefined, "", "report.txt", "report.html\n", "\u0000.html", 42, null])("rejects invalid output %j before reading/creating a store", async output => {
    const root = temporaryDirectory(), data = join(root, "absent");
    const run = vi.spyOn(history, "runHistory");
    const options = { ...period, source: [id("source", "selected")], dataDir: data, output } as unknown as HistoryExportArguments;
    expect(() => validateHistoryExportArguments(options)).toThrow();
    await expect(runHistoryExport(options)).rejects.toThrow(); expect(run).not.toHaveBeenCalled(); expect(existsSync(data)).toBe(false);
  });
  it("preserves a post-publication warning as published and exit1", async () => {
    const x = await stored(), output = join(x.root, "warning.html");
    vi.spyOn(writer, "writeReportOutput").mockResolvedValue({ output, published: true, bytes: 100, status: "published_with_warning", targetVerification: "verified", durability: "unconfirmed", cleanup: "removed", warnings: ["directory_sync_failed"] });
    const result = await runHistoryExport({ ...period, source: [x.sourceId], dataDir: x.data, output });
    expect(historyExportExitCode(result)).toBe(1);
    expect(JSON.parse(formatHistoryExport(result, true))).toMatchObject({ ok: false, result: { publication: { published: true, warnings: ["directory_sync_failed"] } } });
    expect(formatHistoryExport(result, false)).toContain("published_with_warning");
  });
  it("uses the real binary and preserves original no-output JSON/human bytes", async () => {
    const x = await stored(), before = await bytes(x.data), output = join(x.root, "binary.html");
    const args = ["history", "--source", x.sourceId, "--from", period.from, "--to", period.to, "--data-dir", x.data];
    const a = await history.runHistory({ ...period, source: [x.sourceId], dataDir: x.data });
    for (const json of [false, true]) {
      const result = cli([...args, ...(json ? ["--json"] : [])]); expect(result.status, result.stderr).toBe(0); expect(result.stdout).toBe(history.formatHistoryResult(a, json));
    }
    const result = cli([...args, "--output", output, "--json"]);
    expect(result.status, result.stderr).toBe(0); expect(JSON.parse(result.stdout)).toMatchObject({ command: "history", ok: true, result: { mode: "history_html" } });
    expect(readFileSync(output, "utf8")).toBe(renderHistoryPage(a)); expect(await bytes(x.data)).toEqual(before);
    const again = cli([...args, "--output", output, "--json"]); expect(again.status).toBe(2); expect(again.stdout).toBe(""); expect(JSON.parse(again.stderr).error.code).toBe("REPORT_OUTPUT_UNSAFE");
  });
  it("rejects duplicate/unknown/extra/root options before creating files", () => {
    const root = temporaryDirectory(), data = join(root, "absent"), output = join(root, "new.html");
    const args = ["history", "--source", id("source", "selected"), "--from", period.from, "--to", period.to, "--data-dir", data, "--output", output, "--json"];
    for (const extra of [["--output", output], ["--open"], ["--unknown"], ["extra"], ["--codex-root", root], ["--data-dir", data]]) {
      const result = cli([...args, ...extra]); expect(result.status).toBe(2); expect(result.stdout).toBe(""); expect(JSON.parse(result.stderr).error.code).toBe("INVALID_ARGUMENT");
      expect(existsSync(data)).toBe(false); expect(existsSync(output)).toBe(false);
    }
    const help = cli(["history", "--help", "--data-dir", data]); expect(help.status).toBe(0); expect(help.stdout).toContain("--output"); expect(existsSync(data)).toBe(false);
  });
});
