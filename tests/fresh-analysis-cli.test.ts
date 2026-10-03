import { existsSync } from "node:fs";
import { readFile, rm, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { runFreshAnalysis } from "../src/cli/fresh-analysis.js";
import { runPatterns, formatPatterns } from "../src/cli/patterns.js";
import { runHistory, formatHistoryResult } from "../src/cli/history.js";
import { freshFixture, window } from "./fresh-analysis-fixture.js";
import { bytes, id } from "./recovery-fixture.js";

const binary = resolve("dist/agentprof.cjs");
const env = { ...process.env, NODE_NO_WARNINGS: "1" };
const invoke = (args: string[], executable = binary, cwd = process.cwd()) => spawnSync(process.execPath, [executable, ...args], { encoding: "utf8", env, cwd, timeout: 20000 });
const range = ["--from", window.from, "--to", window.to];

describe("fresh analysis real CLI", () => {
  for (const command of ["patterns", "history"] as const) for (const provider of ["codex", "claude"] as const) {
    it(`${command}/${provider} publishes using only an explicit input and keeps stored mode read-only`, async () => {
      const x = await freshFixture(command, provider);
      const args = ["--data-dir", x.data, "--json", command, "--provider", provider, "--input", x.input, "--output", x.output, ...(command === "history" ? range : [])];
      const result = invoke(args), parsed = JSON.parse(result.stdout);
      expect(result.status, result.stdout + result.stderr).toBe(parsed.result.scan.status === "completed" ? 0 : 1);
      expect(parsed).toMatchObject({ command, result: { mode: "fresh_analysis_html", report: { status: "published" } } });
      expect(result.stdout).not.toContain(x.input);
      expect((await readFile(x.output, "utf8"))).not.toContain("FICTITIOUS_");
      const before = await bytes(x.data), source = parsed.result.generation.sourceId;
      await rm(x.input);
      for (const json of [false, true]) {
        const old = invoke([command, "--source", source, "--data-dir", x.data, ...(command === "history" ? range : []), ...(json ? ["--json"] : [])]);
        const expected = command === "patterns" ? formatPatterns(await runPatterns({ source, dataDir: x.data }), json)
          : formatHistoryResult(await runHistory({ source: [source], dataDir: x.data, ...window }), json);
        expect(old.status).toBe(0); expect(old.stdout).toBe(expected); expect(old.stderr).toBe("");
      }
      expect(await bytes(x.data)).toEqual(before);
    });
  }
  for (const command of ["patterns", "history"] as const) {
    it(`${command} rejects duplicates and mixed modes before storage access`, async () => {
      const x = await freshFixture(command);
      const base = [command, "--provider", "codex", "--input", x.input, "--output", x.output, "--data-dir", x.data, "--json", ...(command === "history" ? range : [])];
      for (const extra of [["--provider", "codex"], ["--input", x.input], ["--output", x.output], ["--source", id("source", "unselected")],
        ["--codex-root", x.root], ["--claude-root", x.root], ["--json"], ["--data-dir", x.data], ["extra"], ["--unknown"], ["--open"]]) {
        const result = invoke([...base, ...extra]);
        expect(result.status, JSON.stringify(extra) + result.stdout + result.stderr).toBe(2);
        expect(result.stdout).toBe(""); expect(JSON.parse(result.stderr).error.code).toBe("INVALID_ARGUMENT");
        expect(existsSync(x.data)).toBe(false); expect(existsSync(x.output)).toBe(false);
      }
    });
    it(`${command} help is storage-free and fresh input requires an output`, async () => {
      const x = await freshFixture(command), help = invoke([command, "--help", "--data-dir", x.data]);
      expect(help.status).toBe(0); expect(help.stdout).toContain("--provider"); expect(help.stdout).toContain("--input");
      const missing = invoke([command, "--provider", "codex", "--input", x.input, "--data-dir", x.data, "--json", ...(command === "history" ? range : [])]);
      expect(missing.status).toBe(2); expect(JSON.parse(missing.stderr).error.code).toBe("INVALID_ARGUMENT");
      expect(existsSync(x.data)).toBe(false);
    });
  }
});

it("script-disabled installed tarball preserves both fresh workflows and exact built receipts", async () => {
  const x = await freshFixture("patterns", "codex", true), prefix = join(x.root, "prefix"), execute = join(x.root, "execute");
  await mkdir(execute);
  const npm = (args: string[], cwd: string) => {
    const result = spawnSync("npm", args, { encoding: "utf8", cwd, env, timeout: 30000 });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    return result.stdout;
  };
  const packed = JSON.parse(npm(["pack", "--ignore-scripts", "--json", "--pack-destination", x.root], process.cwd()))[0];
  npm(["install", "--global", "--prefix", prefix, "--cache", join(x.root, "cache"), "--ignore-scripts", "--no-audit", "--no-fund", join(x.root, packed.filename)], execute);
  const installed = join(prefix, "bin", "agentprof");
  await runFreshAnalysis("patterns", x.options);
  await rm(x.output);
  for (const command of ["patterns", "history"] as const) {
    const args = [command, "--provider", "codex", "--input", x.input, "--output", x.output, "--data-dir", x.data, "--json", ...(command === "history" ? range : [])];
    const before = await bytes(x.data);
    const built = invoke(args, binary, execute), html = await readFile(x.output, "utf8");
    expect(built.status, built.stdout + built.stderr).toBe(1);
    expect(JSON.parse(built.stdout)).toMatchObject({ ok: false, result: { scan: { status: "partial" }, report: { status: "published" } } });
    await rm(x.output);
    const packedResult = invoke(args, installed, execute);
    expect(packedResult.status).toBe(built.status); expect(packedResult.stdout).toBe(built.stdout); expect(packedResult.stderr).toBe(built.stderr);
    expect(await readFile(x.output, "utf8")).toBe(html); expect(await bytes(x.data)).toEqual(before);
    await rm(x.output);
  }
}, 60000);
