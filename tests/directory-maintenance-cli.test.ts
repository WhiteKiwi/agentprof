import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { chmod, copyFile, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { runDirectoryMaintenance, validateDirectoryArguments } from "../src/cli/directory.js";
import { temporaryDirectory } from "./helpers.js";

const binary = fileURLToPath(new URL("../dist/agentprof.cjs", import.meta.url)), repo = fileURLToPath(new URL("../", import.meta.url));
const rootId = `h1:${"e".repeat(32)}:source:${"1".repeat(64)}`;
function run(args: string[], bin = binary, cwd?: string) {
  return spawnSync(process.execPath, [bin, ...args], { encoding: "utf8", timeout: 10000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, NODE_NO_WARNINGS: "1" }, ...(cwd ? { cwd } : {}) });
}
function currentSources(data: string) {
  const db = new DatabaseSync(join(data, "agentprof.sqlite"), { readOnly: true });
  try { return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map(row => row.name as string).filter(name => !name.startsWith("directory_membership_"))
    .map(name => [name, db.prepare(`SELECT * FROM ${name} ORDER BY 1`).all()]); }
  finally { db.close(); }
}
async function fixture(provider: "codex" | "claude", bin = binary) {
  const base = temporaryDirectory(), data = join(base, "private"), logs = join(base, "FICTITIOUS_LOGS"), file = join(logs, "FICTITIOUS_SESSION.jsonl");
  await mkdir(logs); await copyFile(new URL(`./fixtures/providers/${provider}-real-shapes.jsonl`, import.meta.url), file);
  const args = ["scan", "--enroll-directory", `--${provider}-root`, logs, "--data-dir", data, "--json"];
  const scanned = run(args, bin); expect([0, 1], scanned.stderr).toContain(scanned.status);
  const receipt = JSON.parse(scanned.stdout).result; expect(receipt.snapshot.members).toHaveLength(1);
  return { base, data, logs, file, args, id: receipt.snapshot.rootId as string, revision: receipt.snapshot.revision as number };
}

it.each([
  {}, { root: "FICTITIOUS_PATH" }, { root: rootId + "\n" }, { root: rootId, prune: true },
  { root: rootId, reset: true }, { root: rootId, prune: true, reset: true, expectedRevision: "1" },
  { root: rootId, expectedRevision: "1" }, { root: rootId, prune: true, expectedRevision: "0" },
  { root: rootId, prune: true, expectedRevision: "01" }, { root: rootId, prune: true, expectedRevision: "1e2" },
  { root: rootId, prune: true, expectedRevision: "1\n" }, { root: rootId, prune: true, expectedRevision: "9007199254740992" },
  { root: rootId, prune: "yes", expectedRevision: "1" }, { root: rootId, codexRoot: ["private-path"] },
  { root: rootId, dataDir: "  " }, { root: rootId, extra: 1 },
])("validates descriptor values without storage access: %j", options => {
  expect(() => validateDirectoryArguments(options as any)).toThrowError(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
});
it("rejects getters, proxies, inherited options and hidden array entries without evaluating them", () => {
  let called = false;
  for (const options of [new Proxy({}, { getPrototypeOf() { called = true; throw Error(); } }),
    Object.create({ root: rootId }), Object.defineProperty({}, "root", { get() { called = true; return rootId; } }),
    { root: rootId, codexRoot: Object.assign([], { hidden: "private" }) },
    { root: rootId, claudeRoot: new Proxy([], { get() { called = true; throw Error(); } }) }]) {
    expect(() => validateDirectoryArguments(options as any)).toThrow();
  }
  expect(called).toBe(false);
});
it.each([
  ["--root", rootId, "--prune"], ["--root", rootId, "--reset"],
  ["--root", rootId, "--root", rootId], ["--root", rootId, "--expected-revision", "1"],
  ["--root", rootId, "--reset", "--expected-revision", "1", "--expected-revision", "1"],
  ["--root", rootId, "--prune", "--reset", "--expected-revision", "1"],
  ["--root", rootId, "--prune", "--prune", "--expected-revision", "1"],
  ["--root", rootId, "--reset=true", "--expected-revision", "1"],
  ["--root", rootId, "--prune=false", "--expected-revision", "1"],
  ["--root", rootId, "--reset", "--expected-revision", "-1"],
  ["--root", rootId, "--unknown-secret"], ["--root", rootId, "FICTITIOUS_EXTRA"],
  ["--root", rootId, "--codex-root", "FICTITIOUS_LOGS"], ["--root", rootId, "--json"],
].map(args => ({ args })))("built CLI rejects invalid or duplicated flags before bootstrap: %j", ({ args: tail }) => {
  const data = join(temporaryDirectory(), "not-created");
  const r = run(["directory", ...tail, "--data-dir", data, "--json"]);
  expect(r.status, r.stdout).toBe(2); expect(r.stdout).toBe(""); expect(JSON.parse(r.stderr).error.code).toBe("INVALID_ARGUMENT");
  expect(existsSync(data)).toBe(false); expect(r.stderr).not.toMatch(/FICTITIOUS_|unknown-secret/);
});
it("help/version and valid missing-store read/write modes do not create data", () => {
  const data = join(temporaryDirectory(), "not-created");
  for (const args of [["directory", "--help"], ["--version"], ["--help"]]) {
    const r = run(["--data-dir", data, ...args]); expect(r.status).toBe(0); expect(r.stderr).toBe("");
  }
  for (const mode of [[], ["--reset", "--expected-revision", "1"], ["--prune", "--expected-revision", "1"]]) {
    const r = run(["directory", "--root", rootId, ...mode, "--data-dir", data, "--json"]);
    expect(r.status).toBe(2); expect(JSON.parse(r.stderr).error.code).toBe("STORE_NOT_FOUND");
  }
  expect(existsSync(data)).toBe(false);
});
it("pre-abort returns a truthful cancellation and removes owned listeners", async () => {
  const before = process.listenerCount("SIGINT"), c = new AbortController(); c.abort();
  const data = join(temporaryDirectory(), "not-created"), r = await runDirectoryMaintenance({ root: rootId, reset: true, expectedRevision: "1", dataDir: data }, c.signal);
  expect(r).toMatchObject({ status: "aborted", snapshot: null, removedSourceIds: [] });
  expect(process.listenerCount("SIGINT")).toBe(before); expect(existsSync(data)).toBe(false);
});
it.each(["codex", "claude"] as const)("%s full CLI inspection, pruning, reset and re-enrollment preserve source history", async provider => {
  const f = await fixture(provider), select = ["directory", "--root", f.id, "--data-dir", f.data, "--json"];
  const keyBefore = await readFile(join(f.data, "identity-key.json")), dbBefore = await readFile(join(f.data, "agentprof.sqlite"));
  const inspected = run(select); expect(inspected.status).toBe(0); expect(JSON.parse(inspected.stdout).result.status).toBe("inspected");
  expect(await readFile(join(f.data, "agentprof.sqlite"))).toEqual(dbBefore);
  await rm(f.file); const retire = run([...f.args, "--retire-missing"]); expect([0, 1], retire.stderr).toContain(retire.status);
  const beforePrune = currentSources(f.data), observed = JSON.parse(run(select).stdout).result;
  const prune = run([...select, "--prune", "--expected-revision", String(observed.snapshot.revision)]);
  expect(prune.status, prune.stderr).toBe(0); const pruned = JSON.parse(prune.stdout).result;
  expect(pruned.removedSourceIds).toHaveLength(1); expect(pruned.snapshot.members).toHaveLength(0);
  expect(currentSources(f.data)).toEqual(beforePrune);
  await copyFile(new URL(`./fixtures/providers/${provider}-real-shapes.jsonl`, import.meta.url), f.file);
  const restored = run(f.args); expect([0, 1], restored.stderr).toContain(restored.status);
  const beforeReset = currentSources(f.data), revision = JSON.parse(restored.stdout).result.snapshot.revision;
  const reset = run(["--json", "--data-dir", f.data, "directory", "--root", f.id, "--reset", "--expected-revision", String(revision)]);
  expect(reset.status, reset.stderr).toBe(0); expect(JSON.parse(reset.stdout).result).toMatchObject({ status: "committed", observationVetoesReleased: true, snapshot: { revision: revision + 1, members: [] } });
  expect(currentSources(f.data)).toEqual(beforeReset); expect(await readFile(join(f.data, "identity-key.json"))).toEqual(keyBefore);
  const stale = run([...select, "--reset", "--expected-revision", String(revision)]);
  expect(stale.status).toBe(1); expect(JSON.parse(stale.stdout)).toMatchObject({ ok: false, result: { status: "stale" } });
  const noop = run([...select, "--reset", "--expected-revision", String(revision + 1)]); expect(JSON.parse(noop.stdout).result.status).toBe("unchanged");
  const human = run(["directory", "--root", f.id, "--data-dir", f.data]); expect(human.stdout).toContain("Root binding");
  for (const output of [inspected.stdout, prune.stdout, reset.stdout, human.stdout]) expect(output).not.toMatch(/FICTITIOUS_|rootFingerprint|secret|seal/);
});
it.each(["old-schema", "future-schema", "journal", "wal", "shm", "bad-key", "permissions", "symlink"])("write mode preserves unsafe existing stores: %s", async kind => {
  const f = await fixture("codex"), path = join(f.data, "agentprof.sqlite"), keyPath = join(f.data, "identity-key.json");
  if (kind.endsWith("schema")) {
    const db = new DatabaseSync(path); db.exec(`PRAGMA user_version=${kind === "old-schema" ? 6 : 99}`); db.close();
  } else if (["journal", "wal", "shm"].includes(kind)) await writeFile(path + "-" + kind, "FICTITIOUS_SIDECAR", { mode: 0o600 });
  else if (kind === "bad-key") await writeFile(keyPath, "FICTITIOUS_BAD_KEY");
  else if (kind === "permissions") await chmod(path, 0o644);
  else { const copy = path + ".original"; await copyFile(path, copy); await rm(path); await symlink(copy, path); }
  const before = [readFileSync(path), readFileSync(keyPath)];
  const r = run(["directory", "--root", f.id, "--reset", "--expected-revision", "1", "--data-dir", f.data, "--json"]);
  expect(r.status).toBe(2); expect(r.stdout).toBe(""); expect(r.stderr).not.toContain("FICTITIOUS_");
  expect([readFileSync(path), readFileSync(keyPath)]).toEqual(before);
});
it("a concurrent process lock fails safely, then reset succeeds after the writer releases it", async () => {
  const f = await fixture("codex"), path = join(f.data, "agentprof.sqlite"), blocker = new DatabaseSync(path);
  const args = ["directory", "--root", f.id, "--reset", "--expected-revision", String(f.revision), "--data-dir", f.data, "--json"];
  const before = currentSources(f.data);
  try {
    blocker.exec("BEGIN IMMEDIATE"); const blocked = run(args);
    expect(blocked.status).toBe(2); expect(JSON.parse(blocked.stderr).error.code).toBe("DATABASE_ACCESS_FAILED");
    expect(blocker.isTransaction).toBe(true); blocker.exec("ROLLBACK");
    expect(currentSources(f.data)).toEqual(before); expect(run(args).status).toBe(0);
  } finally { if (blocker.isTransaction) blocker.exec("ROLLBACK"); blocker.close(); }
});
it("scripts-disabled installed package inspects and resets both providers outside the repository", async () => {
  const base = temporaryDirectory(), prefix = join(base, "install"), cache = join(base, "cache");
  const env = { ...process.env, npm_config_cache: cache, npm_config_audit: "false", npm_config_fund: "false" };
  const pack = spawnSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", base], { cwd: repo, env, encoding: "utf8", timeout: 30000 });
  expect(pack.status, pack.stderr).toBe(0); const tarball = join(base, JSON.parse(pack.stdout)[0].filename);
  const install = spawnSync("npm", ["install", "--global", "--prefix", prefix, "--ignore-scripts", "--no-audit", "--no-fund", tarball], { cwd: base, env, encoding: "utf8", timeout: 30000 });
  expect(install.status, install.stderr).toBe(0);
  const installed = resolve(prefix, "lib/node_modules/agentprof/dist/agentprof.cjs"); expect(existsSync(installed)).toBe(true);
  expect(await readFile(resolve(prefix, "lib/node_modules/agentprof/dist/cli/directory.js"))).toEqual(await readFile(new URL("../dist/cli/directory.js", import.meta.url)));
  for (const provider of ["codex", "claude"] as const) {
    const f = await fixture(provider, installed), args = ["directory", "--root", f.id, "--data-dir", f.data, "--json"];
    const built = run(args), packed = run(args, installed, base); expect(packed.status).toBe(0); expect(packed.stdout).toBe(built.stdout);
    const before = currentSources(f.data), reset = run([...args, "--reset", "--expected-revision", String(f.revision)], installed, base);
    expect(reset.status, reset.stderr).toBe(0); expect(JSON.parse(reset.stdout).result.snapshot.members).toHaveLength(0); expect(currentSources(f.data)).toEqual(before);
  }
}, 60000);
