import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { expect, it, vi } from "vitest";
import { runDirectoryScan, validateDirectoryScanArguments, formatDirectoryScan } from "../src/cli/directory-scan.js";
import { temporaryDirectory } from "./helpers.js";

const binary = resolve("dist/agentprof.cjs"), env = { ...process.env, NODE_NO_WARNINGS: "1" };
function invoke(args: string[], executable = binary) {
  return spawnSync(process.execPath, [executable, ...args], { env, encoding: "utf8", timeout: 20000, maxBuffer: 16 * 1024 * 1024 });
}
async function fixture(provider: "codex" | "claude", mode: string[] = []) {
  const base = temporaryDirectory(), root = join(base, "FICTITIOUS_ROOT"), data = join(base, "private"); await mkdir(root);
  const source = join(root, "FICTITIOUS_SESSION.jsonl"); await copyFile(fileURLToPath(new URL(`./fixtures/providers/${provider}-real-shapes.jsonl`, import.meta.url)), source);
  return { base, root, data, source, args: ["scan", "--enroll-directory", `--${provider}-root`, root, "--data-dir", data, "--json", ...mode] };
}
it.each([
  ["--retire-missing"], ["--retire-missing", "--reconcile"],
  ["--enroll-directory", "--retire-missing", "--retire-missing"], ["--enroll-directory", "--retire-missing=true"],
  ["--enroll-directory", "--retire-missing", "--reconcile"], ["--enroll-directory", "--retire-missing", "extra"],
  ["--enroll-directory", "--retire-missing", "--claude-root", "other"],
].map(flags => ({ flags })))("rejects invalid retirement selection before I/O (%#)", ({ flags }) => {
  const base = temporaryDirectory(), data = join(base, "must-not-create");
  const r = invoke(["scan", "--codex-root", join(base, "missing"), "--data-dir", data, "--json", ...flags]);
  expect(r.status, r.stderr).toBe(2); expect(r.stdout).toBe(""); expect(JSON.parse(r.stderr).error.code).toBe("INVALID_ARGUMENT"); expect(existsSync(data)).toBe(false);
});
it.each(["codex", "claude"] as const)("%s real CLI retains history, repeats idempotently, then restores a reappeared log", async provider => {
  const f = await fixture(provider), first = invoke([...f.args, "--retire-missing"]);
  expect(first.status, first.stderr).toBe(1); // Existing fixture coverage warning is not suppressed.
  expect(first.stderr).toBe(""); const one = JSON.parse(first.stdout).result, id = one.snapshot.members[0].sourceId;
  expect(one.retirement).toMatchObject({ status: "completed", counts: { missing: 0 } });
  await rm(f.source); const absent = invoke([...f.args, "--retire-missing"]);
  expect(absent.status, absent.stderr).toBe(0); expect(JSON.parse(absent.stdout).result.retirement.counts.markedUnavailable).toBe(1);
  const db = await readFile(join(f.data, "agentprof.sqlite")), key = await readFile(join(f.data, "identity-key.json"));
  const repeated = invoke([...f.args, "--retire-missing"]); expect(repeated.status).toBe(0);
  expect(JSON.parse(repeated.stdout).result.retirement.counts.alreadyUnavailable).toBe(1);
  expect(await readFile(join(f.data, "agentprof.sqlite"))).toEqual(db); expect(await readFile(join(f.data, "identity-key.json"))).toEqual(key);
  const stats = invoke(["stats", "--source", id, "--data-dir", f.data, "--json"]);
  expect(JSON.parse(stats.stdout).result.summary.availability).toBe("unavailable");
  const human = invoke([...f.args.filter(x => x !== "--json"), "--retire-missing"]);
  expect(human.stdout).toContain("already unavailable=1"); expect(human.stdout).toContain("retains event/metric/relationship history");
  await copyFile(fileURLToPath(new URL(`./fixtures/providers/${provider}-real-shapes.jsonl`, import.meta.url)), f.source);
  const restored = invoke([...f.args, "--retire-missing"]); expect(restored.status).toBe(1);
  expect(JSON.parse(restored.stdout).result.snapshot.members[0].sourceRevision).toBe(3);
  for (const r of [first, absent, repeated, restored]) expect(r.stdout).not.toMatch(/FICTITIOUS_|rootFingerprint|"seal"/);
});
it.each(["codex", "claude"] as const)("%s keeps no-flag enrollment non-retiring and accepts both capture modes", async provider => {
  const f = await fixture(provider); const plain = invoke(f.args); expect(JSON.parse(plain.stdout).result).not.toHaveProperty("retirement");
  for (const mode of ["--usage-timing", "--pattern-evidence"]) {
    const r = invoke([...f.args, "--retire-missing", mode]); expect(r.status).toBe(1); expect(JSON.parse(r.stdout).result.retirement.status).toBe("completed");
  }
  await rm(f.source); const absent = invoke(f.args), result = JSON.parse(absent.stdout).result;
  expect(result).not.toHaveProperty("retirement");
  const stats = invoke(["stats", "--source", result.snapshot.members[0].sourceId, "--data-dir", f.data, "--json"]);
  expect(JSON.parse(stats.stdout).result.summary.availability).toBe("available");
});
it("preserves cross-root vetoes in the actual binary", async () => {
  const f = await fixture("codex"), child = join(f.root, "nested"); await mkdir(child); const next = join(child, "session.jsonl"); await rename(f.source, next);
  const childArgs = [...f.args]; childArgs[childArgs.indexOf(f.root)] = child;
  invoke(childArgs); invoke(f.args); await rm(next);
  const r = invoke([...f.args, "--retire-missing"]); expect(r.status).toBe(1);
  expect(JSON.parse(r.stdout).result.retirement.entries[0]).toMatchObject({ status: "retained", reason: "other_root_observed" });
  invoke(childArgs); const retry = invoke([...f.args, "--retire-missing"]); expect(retry.status).toBe(0); expect(JSON.parse(retry.stdout).result.retirement.counts.markedUnavailable).toBe(1);
});
it("freezes retirement mode before asynchronous work and validates executable option shells", async () => {
  const base = temporaryDirectory(), path = join(base, "root"); await mkdir(path);
  const options = { codexRoot: [path], claudeRoot: [], dataDir: join(base, "data"), enrollDirectory: true, retireMissing: true };
  const frozen = validateDirectoryScanArguments(options); expect(frozen.retireMissing).toBe(true);
  const pending = runDirectoryScan(options); options.retireMissing = false;
  expect((await pending).retirement?.status).toBe("completed");
  const getter = vi.fn(); expect(() => validateDirectoryScanArguments(Object.defineProperty({ ...options }, "retireMissing", { get: getter }) as never)).toThrow(); expect(getter).not.toHaveBeenCalled();
  for (const value of ["yes", 1, null, undefined]) expect(() => validateDirectoryScanArguments({ ...options, retireMissing: value } as never)).toThrow();
});
it("keeps full JSON and bounds human retirement details with exact omissions", () => {
  const entries = Array.from({ length: 4096 }, (_, i) => ({ sourceId: `source-${i}`, lastObservedRevision: 1, revisionAfter: 2, status: "marked_unavailable" as const, reason: null, blockingRoots: 0 }));
  const r = { schema: "agentprof.directory-scan/v1" as const, status: "completed" as const, reason: null, provider: "codex" as const, enrollment: null, snapshot: null,
    retirement: { schema: "agentprof.directory-retirement/v1" as const, status: "completed" as const, reason: null, membershipRevision: 2, checkedRoots: 1, entries,
      counts: { missing: 4096, markedUnavailable: 4096, alreadyUnavailable: 0, retained: 0 }, retainedPayloads: true as const, inferredMoves: false as const } };
  const json = formatDirectoryScan(r, true), human = formatDirectoryScan(r, false);
  expect(JSON.parse(json).result.retirement.entries).toHaveLength(4096); expect(human).toContain("shown=12/4096; omitted=4084");
  expect(Buffer.byteLength(human)).toBeLessThan(32768); expect(Buffer.byteLength(json)).toBeLessThan(8 * 1024 * 1024);
});
it("does not bootstrap storage for a missing retirement root and cleans pre-aborted listeners", async () => {
  const base = temporaryDirectory(), options = { codexRoot: [join(base, "missing")], claudeRoot: [], dataDir: join(base, "private"), enrollDirectory: true, retireMissing: true };
  const before = process.listenerCount("SIGINT"), controller = new AbortController(); controller.abort();
  expect((await runDirectoryScan(options, controller.signal)).status).toBe("aborted"); expect(process.listenerCount("SIGINT")).toBe(before);
  expect((await runDirectoryScan(options)).status).toBe("ineligible"); expect(existsSync(options.dataDir)).toBe(false);
});

it("installed scripts-disabled package retires/restores both providers and matches built receipts", async () => {
  const root = temporaryDirectory(), prefix = join(root, "prefix"), outside = join(root, "outside"); await mkdir(outside);
  const npm = (args: string[], cwd = outside) => {
    const r = spawnSync("npm", args, { cwd, env, encoding: "utf8", timeout: 30000 });
    expect(r.status, r.stdout + r.stderr).toBe(0); return r.stdout;
  };
  const packed = JSON.parse(npm(["pack", "--ignore-scripts", "--json", "--pack-destination", root], process.cwd()))[0];
  npm(["install", "--global", "--prefix", prefix, "--cache", join(root, "cache"), "--ignore-scripts", "--no-audit", "--no-fund", join(root, packed.filename)]);
  const installed = join(prefix, "bin", "agentprof");
  for (const provider of ["codex", "claude"] as const) {
    const f = await fixture(provider);
    for (const capture of [[], ["--usage-timing"], ["--pattern-evidence"]]) {
      const args = [...f.args, "--retire-missing", ...capture]; invoke(args);
      const a = invoke(args), b = invoke(args, installed);
      expect(b.status).toBe(a.status); expect(b.stdout).toBe(a.stdout); expect(b.stderr).toBe(a.stderr);
    }
    await rm(f.source); const absent = invoke([...f.args, "--retire-missing"], installed);
    expect(absent.status, absent.stderr).toBe(0); expect(JSON.parse(absent.stdout).result.retirement.counts.markedUnavailable).toBe(1);
    const args = [...f.args, "--retire-missing"], a = invoke(args), b = invoke(args, installed);
    expect(b.stdout).toBe(a.stdout); expect(b.status).toBe(a.status);
    await copyFile(fileURLToPath(new URL(`./fixtures/providers/${provider}-real-shapes.jsonl`, import.meta.url)), f.source);
    expect(JSON.parse(invoke(args, installed).stdout).result.snapshot.counts.observed).toBe(1);
  }
}, 30000);
