import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { expect, it, vi } from "vitest";
import { runDirectoryScan, validateDirectoryScanArguments } from "../src/cli/directory-scan.js";
import { temporaryDirectory } from "./helpers.js";

const binary = resolve("dist/agentprof.cjs"), env = { ...process.env, NODE_NO_WARNINGS: "1" };
function invoke(args: string[], executable = binary) {
  return spawnSync(process.execPath, [executable, ...args], { env, encoding: "utf8", timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
}
async function fixture(provider: "codex" | "claude", count = 65) {
  const base = temporaryDirectory(), root = join(base, "FICTITIOUS_BATCH_ROOT"), data = join(base, "private"); await mkdir(root);
  const paths = Array.from({ length: count }, (_, i) => join(root, `FICTITIOUS_${String(i).padStart(4,"0")}.jsonl`));
  for (const path of paths) await writeFile(path, "");
  if (count) await copyFile(fileURLToPath(new URL(`./fixtures/providers/${provider}-real-shapes.jsonl`, import.meta.url)), paths[0]!);
  return { base, root, data, paths, args: ["scan", "--enroll-directory", `--${provider}-root`, root, "--data-dir", data, "--json"] };
}

it.each([
  ["--batch-directory"], ["--batch-directory", "--reconcile"],
  ["--enroll-directory", "--batch-directory", "--batch-directory"],
  ["--enroll-directory", "--batch-directory=true"], ["--enroll-directory", "--batch-directory=false"],
  ["--enroll-directory", "--batch-directory", "--reconcile"],
  ["--enroll-directory", "--batch-directory", "extra"],
  ["--enroll-directory", "--batch-directory", "--claude-root", "other"],
  ["--enroll-directory", "--batch-directory", "--codex-root", "other"],
  ["--enroll-directory", "--batch-directory", "--unknown"],
  ["--batch-directory", "--retire-missing"],
].map(flags => ({ flags })))("rejects malformed or mixed batch flags before I/O (%#)", ({ flags }) => {
  const base = temporaryDirectory(), data = join(base, "must-not-create");
  const r = invoke(["scan", "--codex-root", join(base, "missing"), "--data-dir", data, "--json", ...flags]);
  expect(r.status, r.stderr).toBe(2); expect(r.stdout).toBe("");
  expect(JSON.parse(r.stderr).error.code).toBe("INVALID_ARGUMENT"); expect(existsSync(data)).toBe(false);
});

it.each(["codex", "claude"] as const)("%s built CLI preserves all 65 records, warnings, capture modes and missing history", async provider => {
  const f = await fixture(provider);
  const ordinary = invoke(f.args); expect(ordinary.status).toBe(1); expect(JSON.parse(ordinary.stdout).result.reason).toBe("limit");
  expect(existsSync(f.data)).toBe(false);
  const first = invoke([...f.args, "--batch-directory"]);
  expect(first.status, first.stderr).toBe(1); expect(first.stderr).toBe("");
  const r = JSON.parse(first.stdout).result;
  expect(r.snapshot.counts).toEqual({ total: 65, observed: 65, notObserved: 0 });
  expect(r.enrollment.scan.counts.committed).toBe(65); expect(r).not.toHaveProperty("retirement");
  for (const flag of ["--usage-timing", "--pattern-evidence"]) {
    const captured = invoke([...f.args, "--batch-directory", flag]);
    expect(captured.status, captured.stderr).toBe(1);
    expect(JSON.parse(captured.stdout).result.enrollment.scan.counts.committed).toBe(65);
  }
  await rm(f.paths[0]!);
  const absent = invoke([...f.args, "--batch-directory", "--pattern-evidence"]), a = JSON.parse(absent.stdout).result;
  expect(a.snapshot.counts).toEqual({ total: 65, observed: 64, notObserved: 1 });
  const id = a.snapshot.members.find((m: any) => m.observation === "not_observed").sourceId;
  const stats = invoke(["stats", "--source", id, "--data-dir", f.data, "--json"]);
  expect(JSON.parse(stats.stdout).result.summary.availability).toBe("available");
  const human = invoke([...f.args.filter(x => x !== "--json"), "--batch-directory", "--pattern-evidence"]);
  expect(human.stdout).toContain("shown=12/65; omitted=53"); expect(human.stderr).toBe("");
  for (const output of [first, absent, human]) expect(output.stdout).not.toMatch(/FICTITIOUS_|rootFingerprint|"seal"/);
  expect(await readFile(join(f.data, "identity-key.json"))).toBeDefined();
}, 30000);

it.each(["codex", "claude"] as const)("%s batch retirement handles more than64 remaining files and restores a reappearing source", async provider => {
  const f = await fixture(provider, 66), args = [...f.args, "--batch-directory", "--retire-missing"];
  const first = invoke(args); expect(first.status, first.stderr).toBe(1);
  expect(JSON.parse(first.stdout).result.retirement).toMatchObject({ status: "completed", counts: { missing: 0 } });
  await rm(f.paths[0]!);
  const missing = invoke(args); expect(missing.stderr).toBe("");
  const r = JSON.parse(missing.stdout).result;
  expect(r.retirement).toMatchObject({ status: "completed", counts: { missing: 1, markedUnavailable: 1, retained: 0 } });
  expect(r.snapshot.counts.observed).toBe(65);
  const db = await readFile(join(f.data, "agentprof.sqlite")), key = await readFile(join(f.data, "identity-key.json"));
  const again = invoke(args); expect(JSON.parse(again.stdout).result.retirement.counts.alreadyUnavailable).toBe(1);
  expect(await readFile(join(f.data, "agentprof.sqlite"))).toEqual(db); expect(await readFile(join(f.data, "identity-key.json"))).toEqual(key);
  await copyFile(fileURLToPath(new URL(`./fixtures/providers/${provider}-real-shapes.jsonl`, import.meta.url)), f.paths[0]!);
  const restored = invoke(args); expect(JSON.parse(restored.stdout).result.snapshot.counts.observed).toBe(66);
  expect(JSON.parse(restored.stdout).result.retirement.counts.missing).toBe(0);
}, 30000);

it("keeps real overlapping-root vetoes when the parent has more than64 live files", async () => {
  const f = await fixture("codex", 65), nested = join(f.root, "nested"); await mkdir(nested);
  await writeFile(join(nested, "session.jsonl"), "");
  const child = ["scan", "--enroll-directory", "--codex-root", nested, "--data-dir", f.data, "--json"];
  invoke(child); invoke([...f.args, "--batch-directory"]); await rm(join(nested, "session.jsonl"));
  const veto = invoke([...f.args, "--batch-directory", "--retire-missing"]);
  expect(JSON.parse(veto.stdout).result.retirement.entries[0]).toMatchObject({ status: "retained", reason: "other_root_observed" });
  invoke(child);
  const retry = invoke([...f.args, "--batch-directory", "--retire-missing"]);
  expect(JSON.parse(retry.stdout).result.retirement.counts.markedUnavailable).toBe(1);
});

it("freezes the validated opt-in mode before awaits and rejects executable option shells", async () => {
  const f = await fixture("codex"), options = { codexRoot: [f.root], claudeRoot: [], dataDir: f.data, enrollDirectory: true, batchDirectory: true };
  expect(validateDirectoryScanArguments(options).batchDirectory).toBe(true);
  expect(validateDirectoryScanArguments({ ...options, batchDirectory: false })).not.toHaveProperty("batchDirectory");
  const running = runDirectoryScan(options); options.batchDirectory = false;
  expect((await running).snapshot!.counts.total).toBe(65);
  const getter = vi.fn(); expect(() => validateDirectoryScanArguments(Object.defineProperty({ ...options }, "batchDirectory", { get: getter }) as never)).toThrow();
  expect(getter).not.toHaveBeenCalled();
  for (const value of [undefined, null, 1, "yes"]) expect(() => validateDirectoryScanArguments({ ...options, batchDirectory: value } as never)).toThrow();
});

it("preflight and pre-aborted selection never bootstrap storage or leak signal listeners", async () => {
  const base = temporaryDirectory(), options = { codexRoot: [join(base, "absent")], claudeRoot: [], dataDir: join(base, "private"), enrollDirectory: true, batchDirectory: true };
  const n = process.listenerCount("SIGINT"), abort = new AbortController(); abort.abort();
  expect((await runDirectoryScan(options, abort.signal)).status).toBe("aborted");
  expect((await runDirectoryScan(options)).status).toBe("ineligible"); expect(existsSync(options.dataDir)).toBe(false);
  expect(process.listenerCount("SIGINT")).toBe(n);
});

it("adds exact bounded help without using the database and supports global option placement", async () => {
  const f = await fixture("codex", 0);
  const help = invoke(["scan", "--help", "--data-dir", f.data]); expect(help.status).toBe(0);
  expect(help.stdout).toContain("--batch-directory"); expect(help.stdout).toContain("16-file pages and one final complete membership capture");
  expect(existsSync(f.data)).toBe(false);
  const r = invoke(["--data-dir", f.data, "--json", "--codex-root", f.root, "scan", "--enroll-directory", "--batch-directory"]);
  expect(r.status, r.stderr).toBe(0); expect(JSON.parse(r.stdout).result.snapshot.counts.total).toBe(0);
});

it("scripts-disabled installed CLI preserves both providers' bounded batch receipts and stored bytes", async () => {
  const base = temporaryDirectory(), outside = join(base, "outside"), prefix = join(base, "prefix"); await mkdir(outside);
  const npm = (args: string[], cwd = outside) => {
    const r = spawnSync("npm", args, { cwd, env, encoding: "utf8", timeout: 30000 });
    expect(r.status, r.stdout + r.stderr).toBe(0); return r.stdout;
  };
  const archive = JSON.parse(npm(["pack", "--ignore-scripts", "--json", "--pack-destination", base], process.cwd()))[0];
  npm(["install", "--global", "--prefix", prefix, "--cache", join(base, "cache"), "--ignore-scripts", "--no-audit", "--no-fund", join(base, archive.filename)]);
  const installed = join(prefix, "bin", "agentprof");
  expect(await readFile(join(prefix, "lib/node_modules/agentprof/dist/scanner/directory-batches.js"))).toEqual(await readFile("dist/scanner/directory-batches.js"));
  for (const provider of ["codex", "claude"] as const) {
    const f = await fixture(provider, 66);
    const args = [...f.args, "--batch-directory", "--pattern-evidence", "--retire-missing"];
    invoke(args, installed);
    const state = [await readFile(join(f.data, "agentprof.sqlite")), await readFile(join(f.data, "identity-key.json"))];
    const a = invoke(args), b = invoke(args, installed);
    expect([b.status,b.stdout,b.stderr]).toEqual([a.status,a.stdout,a.stderr]);
    expect([await readFile(join(f.data, "agentprof.sqlite")), await readFile(join(f.data, "identity-key.json"))]).toEqual(state);
    await rm(f.paths[0]!);
    const absent = invoke(args, installed); expect(JSON.parse(absent.stdout).result.retirement.counts.markedUnavailable).toBe(1);
    const again = invoke(args), installedAgain = invoke(args, installed);
    expect(installedAgain.stdout).toBe(again.stdout); expect(installedAgain.status).toBe(again.status);
  }
}, 30000);
