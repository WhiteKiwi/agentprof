import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { chmod, copyFile, mkdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { runDirectoryScan } from "../src/cli/directory-scan.js";
import { runDirectoryMaintenance } from "../src/cli/directory.js";
import { runDirectoryRebind, validateDirectoryRebindArguments, formatDirectoryRebind } from "../src/cli/directory-rebind.js";
import { withAuthenticatedStore } from "../src/db/read-only.js";
import { createDirectoryMembershipStore } from "../src/db/directory-membership.js";
import * as census from "../src/scanner/directory-census.js";
import { temporaryDirectory } from "./helpers.js";

const binary = fileURLToPath(new URL("../dist/agentprof.cjs", import.meta.url)), repo = fileURLToPath(new URL("../", import.meta.url));
const id = `h1:${"a".repeat(32)}:source:${"b".repeat(64)}`;
const valid = { root: id, rebind: true, path: "FICTITIOUS_PATH", expectedRevision: "1" };
afterEach(() => vi.restoreAllMocks());
const run = (args: string[], bin = binary, cwd?: string) => spawnSync(process.execPath, [bin, ...args], {
  encoding: "utf8", timeout: 10000, maxBuffer: 1024 * 1024, env: { ...process.env, NODE_NO_WARNINGS: "1" }, ...(cwd ? { cwd } : {}),
});
function sources(data: string) {
  const db = new DatabaseSync(join(data, "agentprof.sqlite"), { readOnly: true });
  try { return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map(r => r.name as string).filter(name => !name.startsWith("directory_membership_"))
    .map(name => [name, db.prepare(`SELECT * FROM ${name} ORDER BY 1`).all()]); } finally { db.close(); }
}
async function setup(provider: "codex" | "claude", capture: "default" | "timing" | "pattern" = "default") {
  const base = temporaryDirectory(), data = join(base, "private"), path = join(base, "FICTITIOUS_LOGS");
  await mkdir(path); await copyFile(new URL(`./fixtures/providers/${provider}-real-shapes.jsonl`, import.meta.url), join(path, "session.jsonl"));
  const scan = { enrollDirectory: true, codexRoot: provider === "codex" ? [path] : [], claudeRoot: provider === "claude" ? [path] : [], dataDir: data,
    ...(capture === "timing" ? { usageTiming: true } : capture === "pattern" ? { patternEvidence: true } : {}) };
  const enrolled = await runDirectoryScan(scan); expect(enrolled.snapshot?.members).toHaveLength(1);
  const root = enrolled.snapshot!.rootId;
  const args = { root, rebind: true, path, expectedRevision: String(enrolled.snapshot!.revision), dataDir: data };
  return { base, data, path, scan, args, root };
}
async function replacement(f: Awaited<ReturnType<typeof setup>>) {
  const reset = await runDirectoryMaintenance({ root: f.root, reset: true, expectedRevision: f.args.expectedRevision, dataDir: f.data });
  expect(reset.status).toBe("committed"); f.args.expectedRevision = String(reset.snapshot!.revision);
  await rename(f.path, f.path + "-old"); await mkdir(f.path);
  await copyFile(join(f.path + "-old", "session.jsonl"), join(f.path, "session.jsonl"));
}
it.each([
  {}, { ...valid, rebind: false }, { ...valid, path: undefined }, { ...valid, expectedRevision: undefined },
  { ...valid, expectedRevision: "01" }, { ...valid, expectedRevision: "9007199254740992" },
  { ...valid, reset: true }, { ...valid, prune: true }, { ...valid, reset: undefined }, { ...valid, prune: undefined }, { ...valid, path: " " }, { ...valid, extra: true },
  { ...valid, prune: "yes" }, { ...valid, codexRoot: ["private"] }, { ...valid, root: id + "\n" },
])("rejects invalid rebind options before I/O: %j", options => {
  expect(() => validateDirectoryRebindArguments(options as any)).toThrowError(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
});
it("does not evaluate proxy/getter/hidden/inherited options", () => {
  let called = false;
  for (const options of [new Proxy(valid, { getPrototypeOf() { called = true; throw Error(); } }), Object.create(valid),
    Object.defineProperty({ ...valid }, "path", { get() { called = true; return "private"; } }),
    Object.defineProperty({ ...valid }, "hidden", { value: true })]) expect(() => validateDirectoryRebindArguments(options as any)).toThrow();
  expect(called).toBe(false);
});
const providerCaptures = (['codex', 'claude'] as const).flatMap(provider =>
  (['default', 'timing', 'pattern'] as const).map(capture => ({ provider, capture })));
it.each(providerCaptures)(
  "$provider/$capture reset -> physical replacement -> rebind -> re-enroll preserves source history", async ({ provider, capture }) => {
  const f = await setup(provider, capture), key = readFileSync(join(f.data, "identity-key.json"));
  const blocked = await runDirectoryRebind(f.args); expect(blocked).toMatchObject({ status: "ineligible", reason: "membership_not_empty", memberCount: 1 });
  await replacement(f);
  const before = sources(f.data), rejected = await runDirectoryScan(f.scan);
  expect(rejected.enrollment?.membership).toMatchObject({ status: "ineligible", reason: "root_changed" });
  const result = await runDirectoryRebind(f.args); expect(result).toMatchObject({ status: "committed", previousRevision: 2, revision: 3, bindingChanged: true, sourcesChanged: false, inputScanned: false });
  expect(sources(f.data)).toEqual(before); expect(readFileSync(join(f.data, "identity-key.json"))).toEqual(key);
  expect((await runDirectoryRebind(f.args)).status).toBe("stale");
  f.args.expectedRevision = "3"; const db = readFileSync(join(f.data, "agentprof.sqlite"));
  expect((await runDirectoryRebind(f.args)).status).toBe("unchanged"); expect(readFileSync(join(f.data, "agentprof.sqlite"))).toEqual(db);
  const reenrolled = await runDirectoryScan(f.scan); expect(reenrolled.snapshot).toMatchObject({ revision: 4, counts: { observed: 1 } });
  for (const json of [false, true]) expect(formatDirectoryRebind(result, json)).not.toMatch(/FICTITIOUS_|rootFingerprint|secret|seal/);
});
it.each(["missing", "file", "symlink", "different-path"])("refuses %s filesystem target without changing store", async kind => {
  const f = await setup("codex"); await replacement(f);
  if (kind === "missing") await rm(f.path, { recursive: true });
  if (kind === "file") { await rm(f.path, { recursive: true }); await writeFile(f.path, "FICTITIOUS_CONTENT"); }
  if (kind === "symlink") { await rm(f.path, { recursive: true }); await symlink(f.path + "-old", f.path); }
  if (kind === "different-path") f.args.path = f.path + "-old";
  const before = readFileSync(join(f.data, "agentprof.sqlite")), result = await runDirectoryRebind(f.args);
  expect(result.status).toBe("ineligible"); expect(result.reason).toBe(kind === "different-path" ? "path_mismatch" : kind === "symlink" || kind === "file" ? "unsafe_entry" : "access_failed");
  expect(readFileSync(join(f.data, "agentprof.sqlite"))).toEqual(before);
});
it("pre-abort preserves absent store and removes owned listeners", async () => {
  const c = new AbortController(); c.abort(); const dataDir = join(temporaryDirectory(), "absent"), before = process.listenerCount("SIGINT");
  expect(await runDirectoryRebind({ ...valid, dataDir }, c.signal)).toMatchObject({ status: "aborted", revision: null, bindingChanged: false });
  expect(existsSync(dataDir)).toBe(false); expect(process.listenerCount("SIGINT")).toBe(before);
});
it("a filesystem swap during final verification rolls back the already-written binding", async () => {
  const f = await setup("codex"); await replacement(f); const original = census.openDirectoryLease, before = readFileSync(join(f.data, "agentprof.sqlite"));
  vi.spyOn(census, "openDirectoryLease").mockImplementation(async path => {
    const lease = await original(path);
    return { ...lease, async verify() { await rename(path, path + "-race"); await mkdir(path); await lease.verify(); } };
  });
  await expect(runDirectoryRebind(f.args)).rejects.toMatchObject({ code: "INPUT_ACCESS_FAILED" });
  expect(readFileSync(join(f.data, "agentprof.sqlite"))).toEqual(before);
});
it("lease close failure occurs before commit and preserves the old binding", async () => {
  const f = await setup("codex"); await replacement(f); const original = census.openDirectoryLease, before = readFileSync(join(f.data, "agentprof.sqlite"));
  vi.spyOn(census, "openDirectoryLease").mockImplementation(async path => {
    const lease = await original(path); let count = 0;
    return { ...lease, async close() { if (++count === 1) throw new Error("FICTITIOUS_CLOSE"); await lease.close(); } };
  });
  await expect(runDirectoryRebind(f.args)).rejects.toMatchObject({ code: "INPUT_ACCESS_FAILED" });
  expect(readFileSync(join(f.data, "agentprof.sqlite"))).toEqual(before);
});
it("a newer authenticated membership between read and write is retained", async () => {
  const f = await setup("codex"); await replacement(f); const original = census.openDirectoryLease;
  vi.spyOn(census, "openDirectoryLease").mockImplementation(async path => {
    const lease = await original(path);
    await withAuthenticatedStore(f.data, true, (db, ctx) => createDirectoryMembershipStore(db, ctx)
      .rebindEmptyRootInTransaction(f.root, 2, ctx.fingerprint("content", ["FICTITIOUS_NEWER"])));
    return lease;
  });
  expect(await runDirectoryRebind(f.args)).toMatchObject({ status: "stale", revision: 3, bindingChanged: false });
  expect((await runDirectoryMaintenance({ root: f.root, dataDir: f.data })).snapshot!.revision).toBe(3);
});
it.each([
  ["--root", id, "--rebind"], ["--root", id, "--path", "private"],
  ["--root", id, "--rebind", "--path", "private", "--expected-revision", "1", "--reset"],
  ["--root", id, "--rebind", "--path", "private", "--expected-revision", "1", "--prune"],
  ["--root", id, "--rebind", "--rebind", "--path", "private", "--expected-revision", "1"],
  ["--root", id, "--rebind=true", "--path", "private", "--expected-revision", "1"],
  ["--root", id, "--rebind", "--path", "private", "--path", "private", "--expected-revision", "1"],
].map(args => ({ args })))('built CLI rejects invalid mode/flags: $args', ({ args }) => {
  const data = join(temporaryDirectory(), "absent"), r = run(["directory", ...args, "--data-dir", data, "--json"]);
  expect(r.status).toBe(2); expect(r.stdout).toBe(""); expect(JSON.parse(r.stderr).error.code).toBe("INVALID_ARGUMENT"); expect(existsSync(data)).toBe(false);
});
it("actual built CLI returns structured success/stale and keeps legacy inspect/reset working", async () => {
  const f = await setup("claude"); await replacement(f);
  const args = ["--json", "--data-dir", f.data, "directory", "--root", f.root, "--rebind", "--path", f.path, "--expected-revision", "2"];
  const first = run(args); expect(first.status, first.stderr).toBe(0); expect(JSON.parse(first.stdout)).toMatchObject({ ok: true, result: { status: "committed", revision: 3 } });
  expect(JSON.parse(run(args).stdout)).toMatchObject({ ok: false, result: { status: "stale" } });
  expect(run(["directory", "--root", f.root, "--data-dir", f.data]).stdout).toContain("Directory inspect: inspected");
  const help = run(["directory", "--help"]); expect(help.status).toBe(0); expect(help.stdout).toContain("--rebind"); expect(help.stdout).toContain("--path");
});
it("scripts-disabled installed artifact rebinds both providers without changing source history", async () => {
  const base = temporaryDirectory(), prefix = join(base, "install"), env = { ...process.env, npm_config_cache: join(base, "cache"), npm_config_audit: "false", npm_config_fund: "false" };
  const pack = spawnSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", base], { cwd: repo, env, encoding: "utf8", timeout: 30000 });
  expect(pack.status, pack.stderr).toBe(0);
  const install = spawnSync("npm", ["install", "--global", "--prefix", prefix, "--ignore-scripts", "--no-audit", "--no-fund", join(base, JSON.parse(pack.stdout)[0].filename)], { cwd: base, env, encoding: "utf8", timeout: 30000 });
  expect(install.status, install.stderr).toBe(0); const installed = resolve(prefix, "lib/node_modules/agentprof/dist/agentprof.cjs");
  expect(readFileSync(resolve(prefix, "lib/node_modules/agentprof/dist/cli/directory-rebind.js"))).toEqual(readFileSync(new URL("../dist/cli/directory-rebind.js", import.meta.url)));
  for (const provider of ["codex", "claude"] as const) {
    const f = await setup(provider); await replacement(f); const before = sources(f.data), key = readFileSync(join(f.data, "identity-key.json"));
    const args = ["directory", "--root", f.root, "--rebind", "--path", f.path, "--expected-revision", "2", "--data-dir", f.data, "--json"];
    const output = run(args, installed, base); expect(output.status, output.stderr).toBe(0); expect(JSON.parse(output.stdout).result.status).toBe("committed");
    expect(sources(f.data)).toEqual(before); expect(readFileSync(join(f.data, "identity-key.json"))).toEqual(key);
    args[args.indexOf("--expected-revision") + 1] = "3"; expect(run(args, installed, base).stdout).toEqual(run(args).stdout);
  }
}, 60000);

it.each(["old-schema", "future-schema", "journal", "wal", "shm", "bad-key", "permissions", "symlink"])("rebind refuses unsafe existing store: %s", async kind => {
  const f = await setup("codex"); await replacement(f);
  const path = join(f.data, "agentprof.sqlite"), keyPath = join(f.data, "identity-key.json");
  if (kind.endsWith("schema")) {
    const db = new DatabaseSync(path); db.exec(`PRAGMA user_version=${kind === "old-schema" ? 6 : 99}`); db.close();
  } else if (["journal", "wal", "shm"].includes(kind)) await writeFile(path + "-" + kind, "FICTITIOUS_SIDECAR", { mode: 0o600 });
  else if (kind === "bad-key") await writeFile(keyPath, "FICTITIOUS_BAD_KEY");
  else if (kind === "permissions") await chmod(path, 0o644);
  else { const copy = path + ".original"; await copyFile(path, copy); await rm(path); await symlink(copy, path); }
  const before = [readFileSync(path), readFileSync(keyPath)];
  const r = run(["directory", "--root", f.root, "--rebind", "--path", f.path, "--expected-revision", "2", "--data-dir", f.data, "--json"]);
  expect(r.status).toBe(2); expect(r.stdout).toBe(""); expect(r.stderr).not.toContain("FICTITIOUS_");
  expect([readFileSync(path), readFileSync(keyPath)]).toEqual(before);
});
it("missing store is not bootstrapped and an unknown root never touches its input path", async () => {
  const dataDir = join(temporaryDirectory(), "absent");
  await expect(runDirectoryRebind({ ...valid, dataDir })).rejects.toMatchObject({ code: "STORE_NOT_FOUND" });
  expect(existsSync(dataDir)).toBe(false);
  const f = await setup("codex"), unknown = await withAuthenticatedStore(f.data, false, (_db, ctx) => ctx.fingerprint("source", ["FICTITIOUS_UNKNOWN"]));
  const lease = vi.spyOn(census, "openDirectoryLease"), before = readFileSync(join(f.data, "agentprof.sqlite"));
  expect(await runDirectoryRebind({ ...f.args, root: unknown })).toMatchObject({ status: "not_found", revision: null, memberCount: null });
  expect(lease).not.toHaveBeenCalled(); expect(readFileSync(join(f.data, "agentprof.sqlite"))).toEqual(before);
});
it("a competing process write lock refuses rebind, then permits a safe retry", async () => {
  const f = await setup("codex"); await replacement(f);
  const path = join(f.data, "agentprof.sqlite"), blocker = new DatabaseSync(path), before = sources(f.data);
  const args = ["directory", "--root", f.root, "--rebind", "--path", f.path, "--expected-revision", "2", "--data-dir", f.data, "--json"];
  try {
    blocker.exec("BEGIN IMMEDIATE"); const blocked = run(args);
    expect(blocked.status).toBe(2); expect(JSON.parse(blocked.stderr).error.code).toBe("DATABASE_ACCESS_FAILED");
    expect(blocker.isTransaction).toBe(true); blocker.exec("ROLLBACK");
    expect(sources(f.data)).toEqual(before); expect(run(args).status).toBe(0);
  } finally { if (blocker.isTransaction) blocker.exec("ROLLBACK"); blocker.close(); }
});
it("cancellation during final real-lease verification rolls back and cleans up", async () => {
  const f = await setup("codex"); await replacement(f);
  const original = census.openDirectoryLease, abort = new AbortController(), before = readFileSync(join(f.data, "agentprof.sqlite"));
  let closed = false; const listeners = process.listenerCount("SIGINT");
  vi.spyOn(census, "openDirectoryLease").mockImplementation(async path => {
    const lease = await original(path);
    return { ...lease, async verify() { await lease.verify(); abort.abort(); }, async close() { await lease.close(); closed = true; } };
  });
  expect(await runDirectoryRebind(f.args, abort.signal)).toMatchObject({ status: "aborted", bindingChanged: false, revision: null });
  expect(closed).toBe(true); expect(process.listenerCount("SIGINT")).toBe(listeners);
  expect(readFileSync(join(f.data, "agentprof.sqlite"))).toEqual(before);
});
