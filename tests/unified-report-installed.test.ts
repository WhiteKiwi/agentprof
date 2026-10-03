import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { temporaryDirectory } from "./helpers.js";
import { positive, bytes } from "./recovery-fixture.js";
import { ordinaryClaudeCycle } from "./pattern-export-fixture.js";

it("scripts-disabled installed unified reports match the built binary for both providers and fresh/source modes", async () => {
  const root = temporaryDirectory(), project = resolve("."), prefix = join(root, "prefix");
  const env = { ...process.env, NODE_NO_WARNINGS: "1" };
  const npm = (args: string[], cwd = root) => {
    const result = spawnSync("npm", ["--cache", join(root, "cache"), "--ignore-scripts", ...args], { cwd, env, encoding: "utf8", timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    expect(result.status, result.stdout + result.stderr).toBe(0); return result.stdout;
  };
  const pack = JSON.parse(npm(["pack", "--json", "--pack-destination", root], project))[0];
  expect(pack.files.some((f: { path: string }) => f.path === "dist/report/unified-page.js")).toBe(true);
  expect(pack.files.every((f: { path: string }) => /^(dist\/|package\.json$|README\.md$|LICENSE)/.test(f.path))).toBe(true);
  npm(["install", "--global", "--prefix", prefix, "--no-audit", "--no-fund", join(root, pack.filename)]);
  const name = JSON.parse(await readFile(join(project, "package.json"), "utf8")).name;
  const installed = join(prefix, "lib", "node_modules", name, "dist", "agentprof.cjs"), built = join(project, "dist", "agentprof.cjs");
  const invoke = (binary: string, args: string[]) => spawnSync(process.execPath, [binary, ...args], { cwd: root, env, encoding: "utf8", timeout: 15000, maxBuffer: 16 * 1024 * 1024 });
  for (const provider of ["codex", "claude"] as const) {
    const area = join(root, provider), input = join(area, "session.jsonl"), data = join(area, "private");
    await mkdir(area); await writeFile(input, (provider === "codex" ? positive : ordinaryClaudeCycle()).map(r => JSON.stringify(r) + "\n").join(""));
    const freshOutput = join(area, "fresh.html");
    const fresh = invoke(installed, ["report", "--unified", "--provider", provider, "--input", input, "--data-dir", data, "--output", freshOutput, "--json"]);
    expect(fresh.status, fresh.stderr).toBe(provider === "codex" ? 1 : 0);
    const freshReceipt = JSON.parse(fresh.stdout).result;
    expect(freshReceipt.report).toMatchObject({ layout: "unified", published: true, revision: 1 });
    expect(freshReceipt.scan.counts).toMatchObject({ committed: 1, rejected: 0, failed: 0 });
    await rm(input); const before = await bytes(data), source = freshReceipt.report.sourceId;
    const outputs = [join(area, "installed.html"), join(area, "built.html")];
    const results = [installed, built].map((binary, i) => invoke(binary, ["report", "--source", source, "--unified", "--data-dir", data, "--output", outputs[i]!, "--json"]));
    for (const result of results) expect(result.status, result.stdout + result.stderr).toBe(0);
    const receipts = results.map(result => JSON.parse(result.stdout));
    expect({ ...receipts[0].result, output: "<output>" }).toEqual({ ...receipts[1].result, output: "<output>" });
    const html = await readFile(outputs[0]!, "utf8");
    expect(html).toBe(await readFile(outputs[1]!, "utf8")); expect(html).toBe(await readFile(freshOutput, "utf8"));
    expect(html).not.toMatch(/FICTITIOUS_|h1:[a-f0-9]{32}:/); expect(html).not.toContain(data); expect(html).not.toContain(input);
    expect(html).toContain("Unified source evidence");
    if (provider === "claude") expect(html).toContain("First-pass / first-terminal</th><td>1 / 1</td>");
    else expect(html).toContain("missing_error_identity");
    expect((await stat(outputs[0]!)).mode & 0o777).toBe(0o600);
    expect(await bytes(data)).toEqual(before);
    const refusal = invoke(installed, ["report", "--unified", "--source", source, "--data-dir", data, "--output", outputs[0]!, "--json"]);
    expect(refusal.status).toBe(2); expect(JSON.parse(refusal.stderr).error.code).toBe("REPORT_OUTPUT_UNSAFE");
    expect(await readFile(outputs[0]!, "utf8")).toBe(html); expect(await bytes(data)).toEqual(before);
    const old = invoke(installed, ["report", "--source", source, "--data-dir", data, "--output", join(area, "old.html"), "--json"]);
    expect(old.status, old.stderr).toBe(0); expect(JSON.parse(old.stdout).result).not.toHaveProperty("layout");
  }
}, 60000);
