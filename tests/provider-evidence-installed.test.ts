import { spawnSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { temporaryDirectory } from "./helpers.js";
import { disk, bytes, codexRows, claudeRows } from "./provider-evidence-fixture.js";

it("scripts-disabled installed package preserves both providers' enriched evidence and raw-deleted pattern HTML", async () => {
  const root = temporaryDirectory(), project = resolve("."), prefix = join(root, "prefix"), cache = join(root, "cache");
  const env = { ...process.env, NODE_NO_WARNINGS: "1" };
  const npm = (args: string[], cwd = root) => {
    const r = spawnSync("npm", ["--cache", cache, "--ignore-scripts", ...args], { cwd, env, encoding: "utf8", timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    expect(r.status, r.stdout + r.stderr).toBe(0); return r.stdout;
  };
  const packed = JSON.parse(npm(["pack", "--json", "--pack-destination", root], project))[0];
  expect(packed.files.every((f: { path: string }) => /^(dist\/|package\.json$|README\.md$|LICENSE)/.test(f.path))).toBe(true);
  npm(["install", "--global", "--prefix", prefix, "--no-audit", "--no-fund", join(root, packed.filename)]);
  const built = join(project, "dist", "agentprof.cjs"), installed = join(prefix, "lib", "node_modules", "agentprof", "dist", "agentprof.cjs");
  const invoke = (binary: string, args: string[]) => spawnSync(process.execPath, [binary, ...args], { cwd: root, env, encoding: "utf8", timeout: 15000, maxBuffer: 16 * 1024 * 1024 });
  for (const provider of ["codex", "claude"] as const) {
    const x = await disk(provider, (provider === "codex" ? codexRows() : claudeRows()) as never);
    const scan = invoke(installed, ["scan", "--pattern-evidence", `--${provider}-root`, x.path, "--data-dir", x.data, "--json"]);
    expect([0, 1], scan.stdout + scan.stderr).toContain(scan.status); expect(JSON.parse(scan.stdout).result.counts.committed).toBe(1);
    await rm(x.inputRoot, { recursive: true }); const before = await bytes(x.data);
    const args = ["patterns", "--source", x.sourceId, "--data-dir", x.data];
    for (const tail of [[], ["--json"]]) {
      const a = invoke(installed, [...args, ...tail]), b = invoke(built, [...args, ...tail]);
      expect(a.status, a.stderr).toBe(0); expect(a.stdout).toBe(b.stdout); expect(a.stdout).not.toContain("FICTITIOUS_");
    }
    const result = JSON.parse(invoke(installed, [...args, "--json"]).stdout).result;
    expect(result.parserVersion).toBe(provider === "codex" ? 3 : 4);
    if (provider === "codex") expect(result.candidates.some((c: { ruleId: string }) => c.ruleId === "retry-loop")).toBe(true);
    const a = join(x.root, "installed.html"), b = join(x.root, "built.html");
    expect(invoke(installed, [...args, "--output", a, "--json"]).status).toBe(0);
    expect(invoke(built, [...args, "--output", b, "--json"]).status).toBe(0);
    expect(await readFile(a, "utf8")).toBe(await readFile(b, "utf8"));
    expect(await bytes(x.data)).toEqual(before);
  }
}, 60000);
