import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { disk, bytes, window } from "./usage-timing-fixture.js";
import { temporaryDirectory } from "./helpers.js";

it("scripts-disabled installed package captures and reports both providers' dated token evidence", async () => {
  const root = temporaryDirectory(), project = resolve("."), prefix = join(root, "prefix"), cache = join(root, "cache");
  const env = { ...process.env, NODE_NO_WARNINGS: "1" };
  const npm = (args: string[], cwd = root) => {
    const r = spawnSync("npm", ["--cache", cache, "--ignore-scripts", ...args], { cwd, env, encoding: "utf8", timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    expect(r.status, r.stdout + r.stderr).toBe(0); return r.stdout;
  };
  const packed = JSON.parse(npm(["pack", "--json", "--pack-destination", root], project))[0];
  expect(packed.files.every((f: { path: string }) => /^(dist\/|package\.json$|README\.md$|LICENSE)/.test(f.path))).toBe(true);
  npm(["install", "--global", "--prefix", prefix, "--no-audit", "--no-fund", join(root, packed.filename)]);
  const name = JSON.parse(await readFile(join(project, "package.json"), "utf8")).name;
  const built = join(project, "dist", "agentprof.cjs"), installed = join(prefix, "lib", "node_modules", name, "dist", "agentprof.cjs");
  const invoke = (binary: string, args: string[]) => spawnSync(process.execPath, [binary, ...args], { cwd: root, env, encoding: "utf8", timeout: 15000, maxBuffer: 16 * 1024 * 1024 });
  for (const provider of ["codex", "claude"] as const) {
    const x = await disk(provider);
    const scan = invoke(installed, ["scan", "--usage-timing", `--${provider}-root`, x.path, "--data-dir", x.data, "--json"]);
    // Ordinary Claude usage remains provisional / partial under the unchanged adapter contract.
  expect(scan.status, scan.stdout + scan.stderr).toBe(provider === "codex" ? 0 : 1);
    const source = JSON.parse(scan.stdout).result.sources[0].sourceId;
    await rm(x.inputRoot, { recursive: true }); const before = await bytes(x.data);
    const args = ["history", "--tokens", "--source", source, "--data-dir", x.data, "--from", window.from, "--to", window.to, "--offset", window.offset];
    for (const tail of [[], ["--json"]]) {
      const a = invoke(installed, [...args, ...tail]), b = invoke(built, [...args, ...tail]);
      expect(a.status, a.stderr).toBe(0); expect(a.stdout).toBe(b.stdout); expect(a.status).toBe(b.status);
    }
    const result = JSON.parse(invoke(installed, [...args, "--json"]).stdout).result;
    expect(result.days.map((d: { counts: { total: number } }) => d.counts.total)).toEqual(provider === "codex" ? [110, 120] : [160, 170]);
    expect(result.inventory).toMatchObject(provider === "codex" ? { datedFinalResponses: 2, datedProvisionalResponses: 0 } : { datedFinalResponses: 0, datedProvisionalResponses: 2 });
    const output = join(x.root, "installed.html"), compare = join(x.root, "built.html");
    const a = invoke(installed, [...args, "--output", output, "--json"]), b = invoke(built, [...args, "--output", compare, "--json"]);
    expect(a.status, a.stderr).toBe(0); expect(b.status, b.stderr).toBe(0);
    const receipt = JSON.parse(a.stdout), comparator = JSON.parse(b.stdout); comparator.result.publication.output = output;
    expect(receipt).toEqual(comparator);
    expect(await readFile(output, "utf8")).toBe(await readFile(compare, "utf8"));
    expect((await stat(output)).mode & 0o777).toBe(0o600); expect(await bytes(x.data)).toEqual(before);
  }
}, 60000);
