import { spawnSync } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { expect, it } from "vitest";
import { bytes, positive } from "./recovery-fixture.js";
import { temporaryDirectory } from "./helpers.js";

it("installed script-disabled tarball preserves history JSON/human and real copy conflicts", async () => {
  const root = temporaryDirectory(), work = join(root, "work"), prefix = join(root, "prefix"), cache = join(root, "cache");
  await mkdir(work);
  const env = { ...process.env, PATH: dirname(process.execPath) + ":" + process.env.PATH, NODE_NO_WARNINGS: "1" };
  function npm(args: string[], cwd = work) {
    const r = spawnSync("npm", args, { cwd, env, encoding: "utf8", timeout: 30000 });
    expect(r.status, r.stdout + r.stderr).toBe(0); return r.stdout;
  }
  const packed = JSON.parse(npm(["pack", "--ignore-scripts", "--json", "--pack-destination", root], resolve(".")))[0];
  expect(packed.files.some((f: { path: string }) => f.path === "dist/cli/history.js")).toBe(true);
  expect(packed.files.every((f: { path: string }) => !/^(src|tests)\/|\.(ts|jsonl|sqlite)$/.test(f.path))).toBe(true);
  npm(["install", "--global", "--prefix", prefix, "--cache", cache, "--ignore-scripts", "--no-audit", "--no-fund", join(root, packed.filename)]);
  const installed = join(prefix, "bin", "agentprof"), built = resolve("dist/agentprof.cjs");
  function invoke(binary: string, args: string[]) {
    return spawnSync(process.execPath, [binary, ...args], { cwd: work, env, encoding: "utf8", timeout: 15000 });
  }
  for (const conflict of [false, true]) {
    const input = join(root, conflict ? "conflict-input" : "copy-input"), data = join(root, conflict ? "conflict-data" : "copy-data");
    await mkdir(input);
    const raw = positive.map(r => JSON.stringify(r)).join("\n") + "\n";
    const changed = conflict ? raw.replace('"exit_code":2', '"exit_code":0') : raw;
    await writeFile(join(input, "live.jsonl"), raw); await writeFile(join(input, "archive.jsonl"), changed);
    const scan = invoke(installed, ["scan", "--codex-root", input, "--data-dir", data, "--json"]);
    expect(scan.status, scan.stdout + scan.stderr).toBe(0); expect(JSON.parse(scan.stdout).result.counts.committed).toBe(2);
    const catalogue = invoke(installed, ["stats", "--list-sources", "--data-dir", data, "--json"]);
    expect(catalogue.status).toBe(0);
    const ids: string[] = JSON.parse(catalogue.stdout).result.catalogue.items.map((s: { sourceId: string }) => s.sourceId);
    await rm(input, { recursive: true }); const before = await bytes(data);
    const args = ["history", ...ids.flatMap(id => ["--source", id]), "--from", "2026-10-03T00:00:00Z", "--to", "2026-10-04T00:00:00Z", "--offset", "+09:00", "--data-dir", data];
    for (const json of [false, true]) {
      const selected = json ? [...args, "--json"] : args, a = invoke(installed, selected), b = invoke(built, selected);
      expect(a.status, a.stderr).toBe(0); expect(a.stdout).toBe(b.stdout); expect(a.stderr).toBe(b.stderr);
      expect(a.stdout).not.toMatch(/FICTITIOUS_|operationKey|errorFingerprint|sourceRef/);
      if (json) {
        const result = JSON.parse(a.stdout).result;
        expect(result.reconciliation.counts).toMatchObject({ eventCopies: 4, canonicalExecutions: 2,
          conflictingExecutions: conflict ? 1 : 0, admittedExecutions: conflict ? 1 : 2 });
        expect(result.days[0].terminalCompletions).toBe(conflict ? 1 : 2);
        expect(result.days[0].toolBusyMs).toBe(conflict ? 1000 : 2000);
      }
    }
    const bad = invoke(installed, [...args, "--source", ids[0]!, "--json"]);
    expect(bad.status).toBe(2); expect(bad.stdout).toBe(""); expect(JSON.parse(bad.stderr).error.code).toBe("INVALID_ARGUMENT");
    expect(await bytes(data)).toEqual(before);
  }
}, 60000);
