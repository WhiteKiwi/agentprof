import { existsSync } from "node:fs";
import { readFile, writeFile, unlink, mkdir, copyFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { runScan, formatScanResult } from "../src/cli/scan.js";
import { runReconcileScan } from "../src/cli/reconcile-scan.js";
import { runStats, formatStatsResult } from "../src/cli/stats.js";
import { withReadOnlyStore } from "../src/db/read-only.js";
import { createSourceStore } from "../src/db/source-store.js";
import { freshFixture, window } from "./fresh-analysis-fixture.js";
import { bytes } from "./recovery-fixture.js";

const binary = resolve("dist/agentprof.cjs"), env = { ...process.env, NODE_NO_WARNINGS: "1" };
const invoke = (args: string[], executable = binary, cwd = process.cwd()) => spawnSync(process.execPath, [executable, ...args], {
  encoding: "utf8", env, cwd, timeout: 20000, maxBuffer: 2 * 1024 * 1024,
});
const providers = ["codex", "claude"] as const;

describe("explicit source lifecycle through the built CLI", () => {
  it.each(providers)("%s retains stored evidence on deletion and restores via the public flag", async provider => {
    const x = await freshFixture("patterns", provider), rootFlag = `--${provider}-root`, raw = await readFile(x.input, "utf8");
    const args = ["--json", "--data-dir", x.data, "scan", "--reconcile", rootFlag, x.input];
    const first = invoke(args), a = JSON.parse(first.stdout);
    expect(first.status, first.stderr + first.stdout).toBe(a.result.scan.status === "completed" ? 0 : 1);
    expect(a).toMatchObject({ schema: "agentprof.cli/v1", command: "scan", result: { mode: "explicit_source_lifecycle", counts: { collected: 1 } } });
    const sourceId = a.result.liveSources[0].sourceId;
    const original = await withReadOnlyStore(x.data, (db, key) => createSourceStore(db, key).readSource(sourceId)!);
    await unlink(x.input);
    const gone = invoke(["scan", "--reconcile", rootFlag, x.input, "--data-dir", x.data, "--json"]);
    expect(gone.status, gone.stdout + gone.stderr).toBe(0);
    expect(JSON.parse(gone.stdout)).toMatchObject({ ok: true, result: { scan: null, counts: { markedUnavailable: 1 }, liveSources: [] } });
    const retained = await withReadOnlyStore(x.data, (db, key) => createSourceStore(db, key).readSource(sourceId)!);
    expect(retained.availability).toBe("unavailable"); expect(retained.events).toEqual(original.events); expect(retained.evidence).toEqual(original.evidence);
    const before = await bytes(x.data);
    const oldStats = invoke(["stats", "--source", sourceId, "--data-dir", x.data, "--json"]);
    expect(oldStats.status).toBe(0);
    expect(oldStats.stdout).toBe(formatStatsResult(await runStats({ source: sourceId, dataDir: x.data }), true));
    expect(await bytes(x.data)).toEqual(before);
    const repeat = invoke(args); expect(repeat.status).toBe(0); expect(JSON.parse(repeat.stdout).result.counts.alreadyUnavailable).toBe(1);
    expect(await bytes(x.data)).toEqual(before);
    await writeFile(x.input, raw);
    const restored = invoke(args), restoredReceipt = JSON.parse(restored.stdout);
    expect(restoredReceipt.result.liveSources[0]).toMatchObject({ sourceId, revision: retained.revision + 1 });
    expect(restored.status).toBe(restoredReceipt.result.scan.status === "completed" ? 0 : 1);
    for (const output of [first.stdout, gone.stdout, repeat.stdout, restored.stdout]) {
      expect(output).not.toContain(x.input); expect(output).not.toContain("FICTITIOUS_");
    }
  });
  it.each(providers)("%s preserves the original no-flag scan JSON/human path", async provider => {
    const x = await freshFixture("patterns", provider);
    const options = { dataDir: x.data, codexRoot: provider === "codex" ? [x.input] : [], claudeRoot: provider === "claude" ? [x.input] : [] };
    await runScan(options);
    const expected = await runScan(options), before = await bytes(x.data);
    for (const json of [false, true]) {
      const actual = invoke(["scan", `--${provider}-root`, x.input, "--data-dir", x.data, ...(json ? ["--json"] : [])]);
      expect(actual.status).toBe(expected.status === "completed" ? 0 : 1); expect(actual.stdout).toBe(formatScanResult(expected, json));
      expect(actual.stderr).toBe("");
    }
    expect(await bytes(x.data)).toEqual(before);
  });
  it("rejects repeated/mixed/unknown arguments before bootstrap", async () => {
    const x = await freshFixture();
    const args = ["scan", "--reconcile", "--codex-root", x.input, "--data-dir", x.data, "--json"];
    for (const extra of [["--reconcile"], ["--json"], ["--data-dir", x.data], ["--codex-root", x.input], ["--claude-root", x.input],
      ["--usage-timing", "--usage-timing"], ["extra"], ["--unknown"], ["--open"]]) {
      const result = invoke([...args, ...extra]);
      expect(result.status, JSON.stringify(extra) + result.stdout + result.stderr).toBe(2); expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr).error.code).toBe("INVALID_ARGUMENT"); expect(existsSync(x.data)).toBe(false);
    }
    const directory = invoke(["scan", "--reconcile", "--codex-root", dirname(x.input), "--data-dir", x.data, "--json"]);
    expect(directory.status).toBe(2); expect(existsSync(x.data)).toBe(false);
  });
  it("help/version are storage-free and the reconciliation help names its file-only scope", async () => {
    const x = await freshFixture();
    const help = invoke(["--data-dir", x.data, "scan", "--help"]);
    expect(help.status).toBe(0); expect(help.stdout).toContain("--reconcile"); expect(help.stdout).toContain("not directories");
    expect(invoke(["--data-dir", x.data, "--version"]).status).toBe(0); expect(existsSync(x.data)).toBe(false);
    const missing = invoke(["scan", "--reconcile", "--data-dir", x.data, "--json"]);
    expect(missing.status).toBe(2); expect(existsSync(x.data)).toBe(false);
  });
  it.each(providers)("%s supports usage timing and preserves honest partial collection receipts", async provider => {
    const x = await freshFixture("patterns", provider, true);
    const result = invoke(["scan", "--reconcile", "--usage-timing", `--${provider}-root`, x.input, "--data-dir", x.data, "--json"]);
    const receipt = JSON.parse(result.stdout);
    expect(receipt.result.counts.collected).toBe(1);
    expect(receipt.result.scan.sources[0].capabilities.parserVersion).toBe(provider === "codex" ? 2 : 3);
    expect(result.status).toBe(receipt.result.scan.status === "partial" ? 1 : 0);
    if (provider === "codex") {
      expect(result.status).toBe(1); expect(receipt.ok).toBe(false);
      expect(receipt.result.scan.diagnostics.samples.some((d: { code: string }) => d.code === "INSUFFICIENT_ERROR_EVIDENCE")).toBe(true);
    }
  });
  it("the actual sixteen-file ceiling is bounded and a seventeenth file is rejected", async () => {
    const x = await freshFixture(), files: string[] = [x.input];
    for (let i = 1; i < 16; i++) { const file = join(dirname(x.input), `${i}.jsonl`); await copyFile(x.input, file); files.push(file); }
    const args = ["scan", "--reconcile", "--data-dir", x.data, "--json", ...files.flatMap(f => ["--codex-root", f])];
    const result = invoke(args); expect(result.status, result.stdout + result.stderr).toBe(0);
    const parsed = JSON.parse(result.stdout); expect(parsed.result.counts.collected).toBe(16); expect(parsed.result.files).toHaveLength(16);
    expect(Buffer.byteLength(result.stdout)).toBeLessThan(128 * 1024);
    const before = await bytes(x.data), rejected = invoke([...args, "--codex-root", join(dirname(x.input), "17.jsonl")]);
    expect(rejected.status).toBe(2); expect(await bytes(x.data)).toEqual(before);
  });
});

it("installed scripts-disabled lifecycle handles both providers and matches built receipts", async () => {
  const home = await freshFixture(), prefix = join(home.root, "prefix"), execute = join(home.root, "execute"); await mkdir(execute);
  const npm = (args: string[], cwd: string) => {
    const result = spawnSync("npm", args, { encoding: "utf8", cwd, env, timeout: 30000 });
    expect(result.status, result.stdout + result.stderr).toBe(0); return result.stdout;
  };
  const packed = JSON.parse(npm(["pack", "--ignore-scripts", "--json", "--pack-destination", home.root], process.cwd()))[0];
  npm(["install", "--global", "--prefix", prefix, "--cache", join(home.root, "cache"), "--ignore-scripts", "--no-audit", "--no-fund", join(home.root, packed.filename)], execute);
  const installed = join(prefix, "bin", "agentprof");
  for (const provider of providers) {
    const x = await freshFixture("patterns", provider), raw = await readFile(x.input, "utf8");
    const args = ["scan", "--reconcile", "--usage-timing", `--${provider}-root`, x.input, "--data-dir", x.data, "--json"];
    const created = invoke(args, installed, execute), first = JSON.parse(created.stdout);
    expect(first.result.counts.collected).toBe(1); expect(created.status).toBe(first.result.scan.status === "completed" ? 0 : 1);
    const before = await bytes(x.data);
    const installedReuse = invoke(args, installed, execute), builtReuse = invoke(args, binary, execute);
    expect(installedReuse.stdout).toBe(builtReuse.stdout); expect(installedReuse.status).toBe(builtReuse.status); expect(installedReuse.stderr).toBe(builtReuse.stderr);
    expect(await bytes(x.data)).toEqual(before);
    await unlink(x.input);
    const gone = invoke(args, installed, execute); expect(gone.status).toBe(0); expect(JSON.parse(gone.stdout).result.counts.markedUnavailable).toBe(1);
    const retained = await bytes(x.data);
    const again = invoke(args, installed, execute), builtAgain = invoke(args, binary, execute);
    expect(again.stdout).toBe(builtAgain.stdout); expect(again.status).toBe(builtAgain.status); expect(again.stderr).toBe(builtAgain.stderr);
    expect(await bytes(x.data)).toEqual(retained);
    await writeFile(x.input, raw);
    const restored = invoke(args, installed, execute), restoredReceipt = JSON.parse(restored.stdout);
    expect(restoredReceipt.result.liveSources[0].revision).toBe(first.result.liveSources[0].revision + 2);
    const source = restoredReceipt.result.liveSources[0].sourceId;
    await unlink(x.input);
    const snapshot = await bytes(x.data);
    const historyArgs = ["history", "--source", source, "--from", window.from, "--to", window.to, "--data-dir", x.data, "--json"];
    const installedHistory = invoke(historyArgs, installed, execute), builtHistory = invoke(historyArgs, binary, execute);
    expect(installedHistory.status).toBe(0); expect(installedHistory.stdout).toBe(builtHistory.stdout); expect(await bytes(x.data)).toEqual(snapshot);
    expect(again.stdout + restored.stdout + installedHistory.stdout).not.toContain("FICTITIOUS_");
    expect(again.stdout + restored.stdout).not.toContain(x.input);
  }
}, 60000);
