import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rm, writeFile, symlink, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { runScan } from "../src/cli/scan.js";
import { runUsageHistory, formatUsageHistory, exportUsageHistory, formatUsagePublication } from "../src/cli/usage-history.js";
import { runHistory, formatHistoryResult } from "../src/cli/history.js";
import { runHistoryExport } from "../src/cli/history-export.js";
import { analyzeUsageHistory } from "../src/analysis/usage-history.js";
import { parseHistoryQuery } from "../src/analysis/history-query.js";
import * as storeModule from "../src/db/source-store.js";
import * as readOnly from "../src/db/read-only.js";
import * as writer from "../src/report/write-output.js";
import { bytes, disk, window, context } from "./usage-timing-fixture.js";
import { temporaryDirectory } from "./helpers.js";

afterEach(() => vi.restoreAllMocks());
const current = resolve("dist/agentprof.cjs");
function cli(args: string[], cwd = resolve("."), binary = current) {
  return spawnSync(process.execPath, [binary, ...args], { cwd, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf8", timeout: 15000, maxBuffer: 16 * 1024 * 1024 });
}
const args = (source: string, data: string) => ["history", "--source", source, "--data-dir", data, "--from", window.from, "--to", window.to, "--offset", window.offset];

it.each(["codex", "claude"] as const)("%s real CLI captures dates then queries immutable stored JSON/human/HTML after raw deletion", async provider => {
  const x = await disk(provider);
  const scan = cli(["--data-dir", x.data, "scan", "--usage-timing", `--${provider}-root`, x.path, "--json"]);
  // Ordinary Claude usage remains provisional / partial under the unchanged adapter contract.
  expect(scan.status, scan.stdout + scan.stderr).toBe(provider === "codex" ? 0 : 1);
  const receipt = JSON.parse(scan.stdout).result;
  expect(receipt.counts).toMatchObject({ committed: 1, failed: 0 });
  const source = receipt.sources[0].sourceId;
  const baseline = await readOnly.withReadOnlyStore(x.data, (db, key) => storeModule.createSourceStore(db, key).readSource(source)!);
  expect(baseline.parserVersion).toBe(provider === "codex" ? 2 : 3);
  await rm(x.inputRoot, { recursive: true }); const before = await bytes(x.data);
  const expected = analyzeUsageHistory([baseline], parseHistoryQuery(window));
  const actual = cli([...args(source, x.data), "--tokens", "--json"]);
  expect(actual.status, actual.stderr).toBe(0);
  expect(JSON.parse(actual.stdout)).toEqual({ schema: "agentprof.cli/v1", ok: true, command: "history", mode: "tokens", result: expected });
  const human = cli([...args(source, x.data), "--tokens"]); expect(human.status, human.stderr).toBe(0);
  expect(human.stdout).toBe(formatUsageHistory(expected, false));
  expect(expected.days.map(d => d.counts.total)).toEqual(provider === "codex" ? [110, 120] : [160, 170]);
  expect(expected.days.every(d => d.selection === (provider === "codex" ? "final" : "provisional"))).toBe(true);
  const output = join(x.root, "tokens.html"), page = cli([...args(source, x.data), "--tokens", "--output", output, "--json"]);
  expect(page.status, page.stderr).toBe(0);
  expect(JSON.parse(page.stdout)).toMatchObject({ ok: true, command: "history", result: { mode: "usage_history_html", dailyPartitions: 2, publication: { status: "published", targetVerification: "verified" } } });
  expect(await readFile(output, "utf8")).not.toMatch(/h1:|FICTITIOUS_|<script/i);
  expect((await stat(output)).mode & 0o777).toBe(0o600);
  expect(await bytes(x.data)).toEqual(before);
  // Existing native-call modes retain exact DTOs/bytes rather than being relabeled token history.
  const selected = { dataDir: x.data, source: [source], ...window };
  const native = await runHistory(selected);
  expect(cli([...args(source, x.data), "--json"]).stdout).toBe(formatHistoryResult(native, true));
  expect(cli(args(source, x.data)).stdout).toBe(formatHistoryResult(native, false));
  const oldOutput = join(x.root, "old.html"), oldExpected = join(x.root, "expected-old.html");
  expect(cli([...args(source, x.data), "--output", oldOutput]).status).toBe(0);
  await runHistoryExport({ ...selected, output: oldExpected });
  expect(await readFile(oldOutput, "utf8")).toBe(await readFile(oldExpected, "utf8"));
  expect(await bytes(x.data)).toEqual(before);
});

it("each explicitly selected source is read once in one pinned transaction", async () => {
  const a = await disk(), b = await disk("claude");
  const first = await runScan({ ...a.options, usageTiming: true });
  const second = await runScan({ dataDir: a.data, codexRoot: [], claudeRoot: [b.path], usageTiming: true });
  const ids = [first.sources[0]!.sourceId, second.sources[0]!.sourceId];
  const create = storeModule.createSourceStore, reads: string[] = [];
  vi.spyOn(storeModule, "createSourceStore").mockImplementation((db, key) => {
    const store = create(db, key);
    return { ...store, readSource: id => { expect(db.isTransaction).toBe(true); reads.push(id); return store.readSource(id); } };
  });
  const transactions = vi.spyOn(readOnly, "withReadOnlyStore"), before = await bytes(a.data);
  const r = await runUsageHistory({ source: ids, dataDir: a.data, ...window });
  expect(r.days).toHaveLength(4); expect(reads).toEqual([...ids].sort()); expect(transactions).toHaveBeenCalledTimes(1);
  expect(await bytes(a.data)).toEqual(before);
});

it("legacy CLI input remains undated, never assigned the query day", async () => {
  const x = await disk(); const r = await runScan(x.options); const source = r.sources[0]!.sourceId;
  const result = cli([...args(source, x.data), "--tokens", "--json"]);
  expect(result.status).toBe(0); expect(JSON.parse(result.stdout).result).toMatchObject({ assessment: "not_evaluable", days: [], inventory: { undatedResponses: 2 } });
});

it.each(["duplicate", "roots", "provider", "input", "calendar", "output", "source", "globals", "unknown", "extra"])("rejects %s token CLI selection before creating storage", async kind => {
  const root = temporaryDirectory(), data = join(root, "missing-store"), source = context.fingerprint("source", ["missing"]);
  const additions: Record<string, string[]> = { duplicate: ["--tokens"], roots: ["--codex-root", root], provider: ["--provider", "codex"], input: ["--input", "secret.jsonl"], calendar: ["--from", "2026-02-30T00:00:00Z"], output: ["--output", join(root, "a.json")], source: ["--source", source], globals: ["--data-dir", data], unknown: ["--surprise"], extra: ["unexpected"] };
  const result = cli([...args(source, data), "--tokens", "--json", ...additions[kind]!]);
  expect(result.status, result.stdout + result.stderr).toBe(2); expect(result.stdout).toBe("");
  expect(JSON.parse(result.stderr).error.code).toBe("INVALID_ARGUMENT"); expect(existsSync(data)).toBe(false);
});

it("scan timestamp flag rejects duplicates before private bootstrap", () => {
  const root = temporaryDirectory(), data = join(root, "data");
  const result = cli(["scan", "--usage-timing", "--usage-timing", "--codex-root", root, "--data-dir", data, "--json"]);
  expect(result.status).toBe(2); expect(JSON.parse(result.stderr).error.code).toBe("INVALID_ARGUMENT"); expect(existsSync(data)).toBe(false);
});

it.each(["exists", "private", "symlink"])("protects %s output and leaves private store unchanged", async kind => {
  const x = await disk(), scan = await runScan({ ...x.options, usageTiming: true }), source = scan.sources[0]!.sourceId;
  const output = kind === "private" ? join(x.data, "tokens.html") : join(x.root, "tokens.html");
  if (kind === "exists") await writeFile(output, "KEEP");
  if (kind === "symlink") await symlink(x.path, output);
  const before = await bytes(x.data);
  await expect(exportUsageHistory({ source: [source], dataDir: x.data, ...window, output })).rejects.toMatchObject({ code: "REPORT_OUTPUT_UNSAFE" });
  expect(await bytes(x.data)).toEqual(before);
  if (kind === "exists") expect(await readFile(output, "utf8")).toBe("KEEP");
  if (kind === "private") expect(existsSync(output)).toBe(false);
});

it("retains actual publication and warning rather than claiming no output", async () => {
  const x = await disk(), scan = await runScan({ ...x.options, usageTiming: true });
  const write = writer.writeReportOutput;
  vi.spyOn(writer, "writeReportOutput").mockImplementationOnce(async p => ({ ...await write(p), status: "published_with_warning", durability: "unconfirmed", warnings: ["directory_sync_failed"] }));
  const output = join(x.root, "warning.html"), r = await exportUsageHistory({ dataDir: x.data, source: [scan.sources[0]!.sourceId], ...window, output });
  expect(r.publication.status).toBe("published_with_warning"); expect(existsSync(output)).toBe(true);
  expect(JSON.parse(formatUsagePublication(r, true))).toMatchObject({ ok: false, result: { publication: { published: true } } });
  expect(formatUsagePublication(r, false)).toContain("directory_sync_failed");
});

it("missing source and wrong key fail safely without writes", async () => {
  const x = await disk(), scan = await runScan({ ...x.options, usageTiming: true }), before = await bytes(x.data);
  for (const [source, code] of [[context.fingerprint("source", ["absent"]), "SOURCE_NOT_FOUND"], [scan.sources[0]!.sourceId.replace("9".repeat(32), "8".repeat(32)), "INVALID_IDENTITY_KEY"]]) {
    await expect(runUsageHistory({ source: [source!], dataDir: x.data, ...window })).rejects.toMatchObject({ code });
  }
  expect(await bytes(x.data)).toEqual(before);
});
