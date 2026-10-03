import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, writeFile, readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { positive, bytes } from "./recovery-fixture.js";
import { ordinaryClaudeCycle } from "./pattern-export-fixture.js";
import { temporaryDirectory } from "./helpers.js";

it("installed scripts-disabled patterns export matches built HTML for ordinary Codex/Claude after raw deletion", async () => {
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
  for (const provider of ["codex", "claude"] as const) {
    const area = join(root, provider), input = join(area, "input"), data = join(area, "data");
    await mkdir(input, { recursive: true });
    await writeFile(join(input, "synthetic.jsonl"), (provider === "codex" ? positive : ordinaryClaudeCycle()).map(r => JSON.stringify(r) + "\n").join(""));
    const scan = invoke(installed, ["scan", `--${provider}-root`, input, "--data-dir", data, "--json"]);
    const scanResult = JSON.parse(scan.stdout).result;
    expect(["completed", "partial"]).toContain(scanResult.status); expect(scan.status, scan.stdout + scan.stderr).toBe(scanResult.status === "completed" ? 0 : 1);
    expect(scanResult.counts).toMatchObject({ committed: 1, failed: 0, rejected: 0, aborted: 0 });
    if (provider === "codex") { expect(scan.status).toBe(1); expect(scanResult.diagnostics.samples.some((d: { code: string }) => d.code === "INSUFFICIENT_ERROR_EVIDENCE")).toBe(true); }
    const catalogue = invoke(installed, ["stats", "--list-sources", "--data-dir", data, "--json"]);
    expect(catalogue.status, catalogue.stderr).toBe(0); const sourceId = JSON.parse(catalogue.stdout).result.catalogue.items[0].sourceId;
    await rm(input, { recursive: true }); const before = await bytes(data);
    const args = ["patterns", "--source", sourceId, "--data-dir", data, "--from", "2026-10-03T00:00:00Z", "--to", "2026-10-03T00:00:10Z"];
    for (const json of [false, true]) {
      const suffix = json ? ["--json"] : [], actual = invoke(installed, [...args, ...suffix]), expected = invoke(current, [...args, ...suffix]);
      expect(actual.status, actual.stderr).toBe(0); expect(actual.stdout).toBe(expected.stdout);
    }
    const builtFile = join(area, "built.html"), installedFile = join(area, "installed.html");
    const built = invoke(current, [...args, "--output", builtFile, "--json"]), actual = invoke(installed, [...args, "--output", installedFile, "--json"]);
    expect(built.status, built.stderr).toBe(0); expect(actual.status, actual.stderr).toBe(0);
    const receipt = JSON.parse(actual.stdout); expect(receipt).toMatchObject({ ok: true, command: "patterns", result: { mode: "patterns_html", candidates: 0, cycles: provider === "claude" ? 1 : 0, publication: { published: true, targetVerification: "verified" } } });
    const html = await readFile(installedFile, "utf8"); expect(html).toBe(await readFile(builtFile, "utf8"));
    expect(html).not.toMatch(/h1:|FICTITIOUS_/); expect(html).not.toContain(data); expect(html).toContain("2026-10-03T00:00:10.000Z");
    if (provider === "claude") { expect(html).toContain("declared scope=unknown"); expect(html).toContain("First-pass / first-terminal</th><td>1 / 1</td>"); }
    else expect(html).toContain("missing_error_identity");
    expect((await stat(installedFile)).mode & 0o777).toBe(0o600); expect(await bytes(data)).toEqual(before);
    const refused = invoke(installed, [...args, "--output", installedFile, "--json"]);
    expect(refused.status).toBe(2); expect(JSON.parse(refused.stderr).error.code).toBe("REPORT_OUTPUT_UNSAFE"); expect(await readFile(installedFile, "utf8")).toBe(html);
  }
}, 60000);
