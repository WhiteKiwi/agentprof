import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { temporaryDirectory } from "./helpers.js";

const binary = resolve("dist/agentprof.cjs"), env = { ...process.env, NODE_NO_WARNINGS: "1" };
function invoke(args: string[], executable = binary, cwd = process.cwd()) {
  return spawnSync(process.execPath, [executable, ...args], { encoding: "utf8", env, cwd, timeout: 20000, maxBuffer: 16 * 1024 * 1024 });
}
async function fixture(provider: "codex" | "claude", empty = false) {
  const base = temporaryDirectory(), root = join(base, "FICTITIOUS_DIRECTORY_SENTINEL"), data = join(base, "private");
  await mkdir(root);
  const source = join(root, "FICTITIOUS_MEMBER_SENTINEL.jsonl");
  if (!empty) await copyFile(fileURLToPath(new URL(`./fixtures/providers/${provider}-real-shapes.jsonl`, import.meta.url)), source);
  return { base, root, data, source, args: ["scan", "--enroll-directory", `--${provider}-root`, root, "--data-dir", data, "--json"] };
}
async function bytes(path: string) {
  const entries = (await readdir(path)).sort();
  return Promise.all(entries.map(async name => ({ name, mode: (await stat(join(path, name))).mode & 0o777, bytes: await readFile(join(path, name)) })));
}

it.each([
  [], ["--codex-root", "one", "--claude-root", "two"], ["--codex-root", "one", "--codex-root", "one"],
  ["--codex-root", "one", "--enroll-directory"], ["--codex-root", "one", "--enroll-directory=true"],
  ["--codex-root", "one", "--reconcile"], ["--codex-root", "one", "extra"], ["--codex-root", "one", "--unknown"],
  ["--codex-root", "one", "--usage-timing", "--usage-timing"], ["--codex-root", "one", "--pattern-evidence", "--pattern-evidence"],
  ["--codex-root", "one", "--json"], ["--codex-root", "one", "--data-dir", "elsewhere"],
  ["--codex-root", ""], ["--claude-root", "   "],
].map(extra => ({ extra })))("rejects invalid public enrollment before store creation (%#)", ({ extra }) => {
  const base = temporaryDirectory(), data = join(base, "must-not-create");
  const r = invoke(["scan", "--enroll-directory", "--data-dir", data, "--json", ...extra], binary, base);
  expect(r.status, r.stdout + r.stderr).toBe(2); expect(r.stdout).toBe("");
  expect(JSON.parse(r.stderr).error.code).toBe("INVALID_ARGUMENT"); expect(existsSync(data)).toBe(false);
  expect(existsSync(join(base, "elsewhere"))).toBe(false);
});

it("reports missing-root failure as a bounded result without creating data", () => {
  const base = temporaryDirectory(), data = join(base, "private");
  const r = invoke(["scan", "--enroll-directory", "--codex-root", join(base, "FICTITIOUS_MISSING"), "--data-dir", data, "--json"]);
  expect(r.status).toBe(1); expect(r.stderr).toBe("");
  expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, command: "scan", result: { status: "ineligible", snapshot: null, enrollment: null } });
  expect(r.stdout).not.toContain("FICTITIOUS_MISSING"); expect(existsSync(data)).toBe(false);
});

it.each(["codex", "claude"] as const)("real %s CLI retains warnings, full member IDs, deletion history and restoration", async provider => {
  const f = await fixture(provider), first = invoke(f.args);
  expect(first.status, first.stdout + first.stderr).toBe(1); expect(first.stderr).toBe("");
  const r = JSON.parse(first.stdout).result;
  expect(r.enrollment.membership.status).toBe("committed"); expect(r.snapshot.counts).toEqual({ total: 1, observed: 1, notObserved: 0 });
  const repeated = invoke(f.args); expect(JSON.parse(repeated.stdout).result.enrollment.membership.status).toBe("unchanged");
  const before = await bytes(f.data), human = invoke(f.args.filter(arg => arg !== "--json"));
  expect(human.status).toBe(1); expect(human.stdout).toContain("observed=1; not_observed=0"); expect(await bytes(f.data)).toEqual(before);
  await rm(f.source); const absent = invoke(f.args);
  expect(absent.status, absent.stdout + absent.stderr).toBe(0);
  expect(JSON.parse(absent.stdout).result.snapshot.members).toEqual([{ ...r.snapshot.members[0], observation: "not_observed" }]);
  const afterMissing = await bytes(f.data);
  const selected = invoke(["stats", "--source", r.snapshot.members[0].sourceId, "--data-dir", f.data, "--json"]);
  expect(selected.status, selected.stdout + selected.stderr).toBe(0); expect(await bytes(f.data)).toEqual(afterMissing);
  expect(JSON.parse(selected.stdout).result.summary.availability).toBe("available");
  for (const out of [first.stdout, repeated.stdout, human.stdout, absent.stdout]) expect(out).not.toMatch(/FICTITIOUS_|rootFingerprint|"seal"/);
});

it.each(["codex", "claude"] as const)("accepts %s capture flags while leaving no-flag scan path unchanged", async provider => {
  const f = await fixture(provider);
  const plain = f.args.filter(arg => arg !== "--enroll-directory");
  const initial = invoke(plain); expect(JSON.parse(initial.stdout).result.schema).toBeUndefined();
  expect(JSON.parse(initial.stdout).result).not.toHaveProperty("snapshot");
  for (const [flags, version] of [[[], provider === "codex" ? 1 : 2], [["--usage-timing"], provider === "codex" ? 2 : 3], [["--pattern-evidence"], provider === "codex" ? 3 : 4]] as const) {
    const r = invoke([...f.args, ...flags]); expect(r.status, r.stdout + r.stderr).toBe(1);
    const id = JSON.parse(r.stdout).result.snapshot.members[0].sourceId;
    const stats = invoke(["stats", "--source", id, "--data-dir", f.data, "--json"]);
    expect(stats.status).toBe(0); expect(JSON.parse(stats.stdout).result.summary.capabilities.parserVersion).toBe(version);
  }
});

it("keeps global flag placement, empty-root zero and help/version storage-free", async () => {
  const f = await fixture("codex", true);
  const r = invoke(["--json", "--data-dir", f.data, "--codex-root", f.root, "scan", "--enroll-directory"]);
  expect(r.status, r.stdout + r.stderr).toBe(0); expect(JSON.parse(r.stdout).result.snapshot.counts.total).toBe(0);
  const absent = join(f.base, "never-created");
  for (const args of [["scan", "--help"], ["--help"], ["--version"]]) {
    const help = invoke(["--data-dir", absent, ...args]); expect(help.status).toBe(0);
    if (args[0] === "scan") expect(help.stdout).toContain("--enroll-directory");
  }
  expect(existsSync(absent)).toBe(false);
  const wrong = invoke(["stats", "--enroll-directory", "--json", "--data-dir", absent]); expect(wrong.status).toBe(2);
  expect(existsSync(absent)).toBe(false);
});

it("keeps all 64 real selected sources, clips only human member detail and refuses the 65th before mutation", async () => {
  const f = await fixture("codex", true);
  for (let i = 0; i < 64; i++) await writeFile(join(f.root, `${i}.jsonl`), "");
  const first = invoke(f.args); expect([0, 1], first.stderr).toContain(first.status);
  expect(JSON.parse(first.stdout).result.snapshot.members).toHaveLength(64);
  const human = invoke(f.args.filter(arg => arg !== "--json")); expect(human.stdout).toContain("shown=12/64; omitted=52");
  const before = await bytes(f.data); await writeFile(join(f.root, "65.jsonl"), "");
  const failed = invoke(f.args); expect(failed.status).toBe(1); expect(JSON.parse(failed.stdout).result).toMatchObject({ reason: "limit", enrollment: null });
  expect(await bytes(f.data)).toEqual(before);
});

it("returns safe storage errors rather than leaking an invalid identity file", async () => {
  const f = await fixture("codex", true); await mkdir(f.data, { mode: 0o700 });
  await writeFile(join(f.data, "identity-key.json"), "FICTITIOUS_BAD_KEY", { mode: 0o600 });
  const before = await bytes(f.data), r = invoke(f.args);
  expect(r.status).toBe(2); expect(r.stdout).toBe(""); expect(r.stderr).not.toContain("FICTITIOUS_BAD_KEY");
  expect(JSON.parse(r.stderr).error.code).toBe("INVALID_IDENTITY_KEY"); expect(await bytes(f.data)).toEqual(before);
});

it("script-disabled installed CLI matches built enrollment, missing observations and legacy scan outside the checkout", async () => {
  const root = temporaryDirectory(), prefix = join(root, "prefix"), outside = join(root, "outside"); await mkdir(outside);
  const npm = (args: string[], cwd: string) => {
    const p = spawnSync("npm", args, { cwd, env, encoding: "utf8", timeout: 30000 });
    expect(p.status, p.stdout + p.stderr).toBe(0); return p.stdout;
  };
  const pack = JSON.parse(npm(["pack", "--ignore-scripts", "--json", "--pack-destination", root], process.cwd()))[0];
  npm(["install", "--global", "--prefix", prefix, "--cache", join(root, "cache"), "--ignore-scripts", "--no-audit", "--no-fund", join(root, pack.filename)], outside);
  const installed = join(prefix, "bin", "agentprof");
  for (const provider of ["codex", "claude"] as const) {
    const f = await fixture(provider);
    for (const capture of [[], ["--usage-timing"], ["--pattern-evidence"]]) {
      const args = [...f.args, ...capture]; invoke(args); // Seed only; actual parity reads use the same unchanged revision.
      const before = await bytes(f.data), a = invoke(args, binary, outside), b = invoke(args, installed, outside);
      expect(b.status).toBe(a.status); expect(b.stdout).toBe(a.stdout); expect(b.stderr).toBe(a.stderr);
      expect(JSON.parse(b.stdout).result.enrollment.membership.status).toBe("unchanged"); expect(await bytes(f.data)).toEqual(before);
    }
    await rm(f.source); const missing = invoke(f.args, installed, outside); expect(missing.status).toBe(0);
    expect(JSON.parse(missing.stdout).result.snapshot.counts.notObserved).toBe(1);
    const plain = f.args.filter(arg => arg !== "--enroll-directory");
    expect(invoke(plain, installed, outside).stdout).toBe(invoke(plain, binary, outside).stdout);
  }
}, 30000);

it("handles a real SIGINT in the built directory module with exit130 and no leaked registration", async () => {
  const f = await fixture("codex", true);
  const script = `
    import { runDirectoryScan, formatDirectoryScan, directoryScanExitCode } from ${JSON.stringify(new URL("../dist/cli/directory-scan.js", import.meta.url).href)};
    const before = process.listenerCount("SIGINT");
    const pending = runDirectoryScan(JSON.parse(process.argv[1]));
    process.kill(process.pid, "SIGINT");
    const result = await pending;
    if (process.listenerCount("SIGINT") !== before) throw Error("listener leak");
    process.stdout.write(formatDirectoryScan(result, true)); process.exitCode = directoryScanExitCode(result);
  `;
  const args = { dataDir: f.data, codexRoot: [f.root], claudeRoot: [], enrollDirectory: true };
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script, JSON.stringify(args)], { encoding: "utf8", env, timeout: 10000 });
  expect(r.status, r.stdout + r.stderr).toBe(130); expect(r.signal).toBeNull();
  expect(JSON.parse(r.stdout).result.status).toBe("aborted"); expect(existsSync(f.data)).toBe(false);
});
