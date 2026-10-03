import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, writeFile, readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { positive, result, bytes } from "./recovery-fixture.js";
import { temporaryDirectory } from "./helpers.js";

it("installed scripts-disabled history export preserves duplicate/conflict arithmetic, HTML and private bytes", async () => {
  const root = temporaryDirectory(), project = resolve("."), prefix = join(root, "prefix"), cache = join(root, "cache");
  const env = { ...process.env, NODE_NO_WARNINGS: "1" };
  const npm = (args: string[], cwd = root) => {
    const child = spawnSync("npm", ["--cache", cache, "--ignore-scripts", ...args], { cwd, env, encoding: "utf8", timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    expect(child.status, child.stdout + child.stderr).toBe(0); return child.stdout;
  };
  const packed = JSON.parse(npm(["pack", "--json", "--pack-destination", root], project))[0];
  expect(packed.files.every((f: { path: string }) => /^(dist\/|package\.json$|README\.md$|LICENSE)/.test(f.path))).toBe(true);
  npm(["install", "--global", "--prefix", prefix, "--no-audit", "--no-fund", join(root, packed.filename)]);
  const name = JSON.parse(readFileSync(join(project, "package.json"), "utf8")).name;
  const installed = join(prefix, "lib", "node_modules", name, "dist", "agentprof.cjs"), current = join(project, "dist", "agentprof.cjs");
  const invoke = (binary: string, args: string[]) => spawnSync(process.execPath, [binary, ...args], { cwd: root, env, encoding: "utf8", timeout: 15000, maxBuffer: 16 * 1024 * 1024 });
  for (const conflicting of [false, true]) {
    const area = join(root, conflicting ? "conflict" : "same"), input = join(area, "input"), data = join(area, "data");
    await mkdir(input, { recursive: true });
    const stringify = (rows: readonly unknown[]) => rows.map(r => JSON.stringify(r) + "\n").join("");
    await writeFile(join(input, "live.jsonl"), stringify(positive));
    await writeFile(join(input, "copy.jsonl"), stringify(conflicting ? positive.map((r, i) => i === 3 ? result("failure", 1000, 0) : r) : positive));
    const scan = invoke(installed, ["scan", "--codex-root", input, "--data-dir", data, "--json"]);
    expect(scan.status, scan.stdout + scan.stderr).toBe(1);
    expect(JSON.parse(scan.stdout).result).toMatchObject({ status: "partial", counts: { committed: 2, failed: 0, rejected: 0 } });
    const catalogue = invoke(installed, ["stats", "--list-sources", "--data-dir", data, "--json"]);
    expect(catalogue.status, catalogue.stderr).toBe(0);
    const ids = JSON.parse(catalogue.stdout).result.catalogue.items.map((s: { sourceId: string }) => s.sourceId);
    expect(ids).toHaveLength(2); await rm(input, { recursive: true }); const before = await bytes(data);
    const args = ["history", ...ids.flatMap((id: string) => ["--source", id]), "--from", "2026-10-03T00:00:00Z", "--to", "2026-10-04T00:00:00Z", "--data-dir", data];
    const observed = invoke(installed, [...args, "--json"]); expect(observed.status, observed.stderr).toBe(0);
    expect(JSON.parse(observed.stdout).result.reconciliation.counts).toMatchObject({ canonicalExecutions: 2, duplicateCopies: 2, conflictingExecutions: conflicting ? 1 : 0, admittedExecutions: conflicting ? 1 : 2 });
    const builtOutput = join(area, "built.html"), installedOutput = join(area, "installed.html");
    const built = invoke(current, [...args, "--output", builtOutput, "--json"]), exported = invoke(installed, [...args, "--output", installedOutput, "--json"]);
    expect(built.status, built.stderr).toBe(0); expect(exported.status, exported.stderr).toBe(0);
    const receipt = JSON.parse(exported.stdout); expect(receipt).toMatchObject({ command: "history", ok: true, result: { mode: "history_html", selectedSources: 2, dailyPartitions: 1, publication: { published: true, targetVerification: "verified" } } });
    const html = await readFile(installedOutput, "utf8"); expect(html).toBe(await readFile(builtOutput, "utf8"));
    expect(html).toContain(`${conflicting ? 1000 : 2000} / 86400000 ms`);
    if (conflicting) expect(html).toContain("semantic_or_contract_conflict");
    expect(html).not.toMatch(/h1:|FICTITIOUS_/); expect(html).not.toContain(data);
    expect((await stat(installedOutput)).mode & 0o777).toBe(0o600); expect(await bytes(data)).toEqual(before);
  }
}, 60000);
