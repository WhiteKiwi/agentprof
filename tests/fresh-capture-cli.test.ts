import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { withReadOnlyStore } from "../src/db/read-only.js";
import { createSourceStore } from "../src/db/source-store.js";
import { disk, bytes, records, window, context } from "./usage-timing-fixture.js";
import { codexRows, claudeRows } from "./provider-evidence-fixture.js";
import { temporaryDirectory } from "./helpers.js";

const binary = resolve("dist/agentprof.cjs"), env = { ...process.env, NODE_NO_WARNINGS: "1" };
const range = ["--from", window.from, "--to", window.to, "--offset", window.offset];
function invoke(args: string[], executable = binary, cwd = process.cwd()) {
  return spawnSync(process.execPath, [executable, ...args], { encoding: "utf8", env, cwd, timeout: 20000, maxBuffer: 16 * 1024 * 1024 });
}
const read = (data: string, id: string) => withReadOnlyStore(data, (db, key) => createSourceStore(db, key).readSource(id)!);
const providers = ["codex", "claude"] as const;

for (const command of ["report", "patterns", "history"] as const) for (const provider of providers) {
  it(`${command}/${provider}: real binary uses explicit pattern capture and raw-deleted stored output remains readable`, async () => {
    const x = await disk(provider, (provider === "codex" ? codexRows() : claudeRows()) as never), output = join(x.root, "fresh.html");
    const extra = command === "report" ? ["--unified"] : command === "history" ? range : [];
    const r = invoke(["--json", command, "--pattern-evidence", "--usage-timing", "--provider", provider, "--input", x.path, "--data-dir", x.data, "--output", output, ...extra]);
    expect([0, 1], r.stdout + r.stderr).toContain(r.status); const parsed = JSON.parse(r.stdout).result;
    expect(parsed.report.status).toBe("published"); expect(r.stderr).toBe("");
    expect((await read(x.data, x.sourceId)).parserVersion).toBe(provider === "codex" ? 3 : 4);
    expect(await readFile(output, "utf8")).not.toMatch(/FICTITIOUS_|h1:|<script/i);
    await rm(x.inputRoot, { recursive: true }); const before = await bytes(x.data), stored = join(x.root, "stored.html");
    const a = invoke([command, "--source", x.sourceId, "--data-dir", x.data, "--output", stored, ...extra, "--json"]);
    expect(a.status, a.stdout + a.stderr).toBe(0); expect(await readFile(stored, "utf8")).toBe(await readFile(output, "utf8"));
    expect(await bytes(x.data)).toEqual(before);
  });
}
for (const provider of providers) for (const flag of ["--usage-timing", "--pattern-evidence"]) {
  it(`${provider}/${flag}: real binary exports fresh daily tokens with explicit mode in its receipt`, async () => {
    const x = await disk(provider), output = join(x.root, "tokens.html");
    const a = invoke(["history", "--tokens", flag, "--provider", provider, "--input", x.path, "--output", output, "--data-dir", x.data, "--json", ...range]);
    expect(a.status, a.stdout + a.stderr).toBe(provider === "codex" ? 0 : 1);
    expect(JSON.parse(a.stdout)).toMatchObject({ command: "history", result: { analysisMode: "tokens", report: { status: "published" } } });
    expect(await readFile(output, "utf8")).not.toMatch(/FICTITIOUS_|h1:|<script/i);
    expect((await stat(output)).mode & 0o777).toBe(0o600);
  });
}
for (const command of ["report", "patterns", "history"] as const) {
  for (const flag of ["--usage-timing", "--pattern-evidence"]) {
    it(`${command}/${flag}: refuses capture on stored mode, duplicate flags and mixed modes before storage`, async () => {
      const root = temporaryDirectory(), data = join(root, "not-created"), output = join(root, "out.html");
      const base = [command, flag, "--output", output, "--data-dir", data, "--json", ...(command === "history" ? range : [])];
      for (const extra of [[], ["--source", context.fingerprint("source", ["absent"])], ["--provider", "codex", "--input", "absent.jsonl", flag],
        ["--provider", "codex", "--input", "absent.jsonl", "--source", context.fingerprint("source", ["absent"])], ["--provider", "codex", "--input", "absent.jsonl", "--json"]]) {
        const r = invoke([...base, ...extra]); expect(r.status, r.stdout + r.stderr).toBe(2);
        expect(r.stdout).toBe(""); expect(JSON.parse(r.stderr).error.code).toBe("INVALID_ARGUMENT");
        expect(existsSync(data)).toBe(false); expect(existsSync(output)).toBe(false);
      }
    });
  }
}
it("fresh token history refuses missing capture, duplicate selection, malformed calendar and incomplete fresh options", () => {
  const root = temporaryDirectory(), data = join(root, "missing"), output = join(root, "t.html");
  const common = ["history", "--tokens", "--output", output, "--data-dir", data, "--json", ...range];
  for (const extra of [
    ["--provider", "codex", "--input", "absent.jsonl"],
    ["--usage-timing", "--provider", "codex"], ["--usage-timing", "--input", "absent.jsonl"],
    ["--usage-timing", "--provider", "codex", "--input", "absent.jsonl", "--tokens"],
    ["--usage-timing", "--provider", "codex", "--input", "absent.jsonl", "--from", "2026-02-30T00:00:00Z"],
  ]) {
    const r = invoke([...common, ...extra]); expect(r.status, r.stdout + r.stderr).toBe(2);
    expect(r.stdout).toBe(""); expect(JSON.parse(r.stderr).error.code).toBe("INVALID_ARGUMENT"); expect(existsSync(data)).toBe(false);
  }
});
it("help exposes explicit capture without creating a store", () => {
  const root = temporaryDirectory(), data = join(root, "missing");
  for (const command of ["history", "patterns", "report"]) {
    const r = invoke([command, "--help", "--data-dir", data]); expect(r.status).toBe(0);
    expect(r.stdout).toContain("--usage-timing"); expect(r.stdout).toContain("--pattern-evidence");
  }
  expect(existsSync(data)).toBe(false);
});

it("scripts-disabled installed package preserves both providers' fresh capture and token workflows", async () => {
  const root = temporaryDirectory(), prefix = join(root, "prefix"), execute = join(root, "outside-repo"); await mkdir(execute);
  const npm = (args: string[], cwd: string) => {
    const r = spawnSync("npm", args, { encoding: "utf8", env, cwd, timeout: 30000 });
    expect(r.status, r.stdout + r.stderr).toBe(0); return r.stdout;
  };
  const pack = JSON.parse(npm(["pack", "--ignore-scripts", "--json", "--pack-destination", root], process.cwd()))[0];
  npm(["install", "--global", "--prefix", prefix, "--cache", join(root, "cache"), "--ignore-scripts", "--no-audit", "--no-fund", join(root, pack.filename)], execute);
  const installed = join(prefix, "bin", "agentprof");
  for (const provider of providers) for (const command of ["report", "patterns", "history"]) {
    const rows = command === "history" ? records(provider) : provider === "codex" ? codexRows() : claudeRows();
    const x = await disk(provider, rows as never), output = join(x.root, "out.html");
    const extra = command === "history" ? ["--tokens", ...range] : command === "report" ? ["--unified"] : [];
    const args = [command, "--pattern-evidence", "--provider", provider, "--input", x.path, "--output", output, "--data-dir", x.data, "--json", ...extra];
    // Seed one generation so both compared invocations have the same unchanged scan receipt.
    const first = invoke(args); expect([0, 1], first.stdout + first.stderr).toContain(first.status); await rm(output);
    const before = await bytes(x.data), a = invoke(args, binary, execute), html = await readFile(output, "utf8"); await rm(output);
    const b = invoke(args, installed, execute);
    expect(b.status, b.stdout + b.stderr).toBe(a.status); expect(b.stdout).toBe(a.stdout); expect(b.stderr).toBe(a.stderr);
    expect(await readFile(output, "utf8")).toBe(html); expect(await bytes(x.data)).toEqual(before);
    expect(html).not.toMatch(/FICTITIOUS_|h1:|<script/i);
  }
}, 60000);
