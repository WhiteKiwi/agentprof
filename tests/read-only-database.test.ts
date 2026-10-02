import { afterEach, describe, expect, it, vi } from "vitest";
import * as fsPromises from "node:fs/promises";
import { chmod, mkdtemp, realpath, readFile, readdir, rm, writeFile, lstat, rename, symlink, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { loadOrCreateIdentityContext } from "../src/normalize/identity.js";
import { openDatabase } from "../src/db/database.js";
import { withReadOnlyStore } from "../src/db/read-only.js";
import { createSourceStore } from "../src/db/source-store.js";
vi.mock("node:fs/promises", async (original) => { const actual = await original<typeof import("node:fs/promises")>(); return { ...actual, open: vi.fn(actual.open) }; });
const dirs: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "agentprof-readonly-"))); dirs.push(dir);
  const context = await loadOrCreateIdentityContext(dir), db = await openDatabase(dir);
  const sourceId = context.fingerprint("source", ["synthetic"]);
  const input = { sourceId, provider: "codex" as const, parserVersion: 1, normalizationVersion: 1 as const, keyVersion: 1 as const, keyId: context.keyId, completedOffset: 0, observedSize: 0, boundaryFingerprint: null, events: [] };
  return { dir, context, db, sourceId, input };
}
async function snapshot(dir: string) {
  const names = (await readdir(dir)).sort();
  return Promise.all(names.map(async name => ({ name, bytes: await readFile(join(dir, name)), mode: (await lstat(join(dir, name))).mode })));
}
describe("existing-store read-only safety", () => {
  it("reads empty and populated stores without mutation and closes owned transactions/connections", async () => {
    const f = await fixture(); f.db.close(); const before = await snapshot(f.dir);
    let held: DatabaseSync | undefined;
    expect(await withReadOnlyStore(f.dir, (db, key) => { held = db; expect(db.isTransaction).toBe(true); expect(key).toBe(f.context.keyId); return createSourceStore(db, key).readSource(f.sourceId); })).toBeNull();
    expect(() => held!.prepare("SELECT 1")).toThrow(); expect(await snapshot(f.dir)).toEqual(before);
    const writer = await openDatabase(f.dir); createSourceStore(writer, f.context.keyId).replaceSource(f.input, null); writer.close();
    const populated = await snapshot(f.dir);
    expect(await withReadOnlyStore(f.dir, (db, key) => createSourceStore(db, key).readSource(f.sourceId)?.revision)).toBe(1);
    expect(await snapshot(f.dir)).toEqual(populated);
  });
  it("rejects writes and callback errors without mutation; then permits reopen", async () => {
    const f = await fixture(); f.db.close(); const before = await snapshot(f.dir);
    await expect(withReadOnlyStore(f.dir, db => db.exec("CREATE TABLE forbidden(x)"))).rejects.toMatchObject({ code: "DATABASE_ACCESS_FAILED" });
    await expect(withReadOnlyStore(f.dir, () => { throw Error("RAW_PRIVATE_SENTINEL"); })).rejects.toMatchObject({ code: "DATABASE_ACCESS_FAILED" });
    await expect(withReadOnlyStore(f.dir, async () => 1)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(await snapshot(f.dir)).toEqual(before);
    expect(await withReadOnlyStore(f.dir, () => 1)).toBe(1);
  });
  it.each(["directory", "identity-key.json", "agentprof.sqlite"])("does not create absent %s", async missing => {
    const f = await fixture(); f.db.close();
    const target = missing === "directory" ? join(f.dir, "missing") : f.dir;
    if (missing !== "directory") await rm(join(f.dir, missing));
    const before = await snapshot(f.dir);
    await expect(withReadOnlyStore(target, () => 1)).rejects.toMatchObject({ code: "STORE_NOT_FOUND" });
    expect(await snapshot(f.dir)).toEqual(before);
  });
  it.each(["bad-json", "oversize", "version", "key-id", "secret"])("rejects %s key without repair", async variant => {
    const f = await fixture(); f.db.close(); const path = join(f.dir, "identity-key.json");
    const key = JSON.parse(await readFile(path, "utf8"));
    if (variant === "version") key.keyVersion = 2;
    if (variant === "key-id") key.keyId = "wrong";
    if (variant === "secret") key.secret = "wrong";
    await writeFile(path, variant === "bad-json" ? "{" : variant === "oversize" ? " ".repeat(1025) : JSON.stringify(key));
    const before = await snapshot(f.dir);
    await expect(withReadOnlyStore(f.dir, () => 1)).rejects.toMatchObject({ code: "INVALID_IDENTITY_KEY" });
    expect(await snapshot(f.dir)).toEqual(before);
  });
  it.each([0, 2, 3, 4, 6])("rejects schema %s without migration", async version => {
    const f = await fixture(); f.db.exec(`PRAGMA user_version=${version}`); f.db.close(); const before = await snapshot(f.dir);
    await expect(withReadOnlyStore(f.dir, () => 1)).rejects.toMatchObject({ code: "DATABASE_SCHEMA_INCOMPATIBLE" }); expect(await snapshot(f.dir)).toEqual(before);
  });
  it.each(["DELETE FROM schema_migrations WHERE version=2", "UPDATE settings SET value=2", "DROP TABLE settings"])("rejects malformed schema/settings", async sql => {
    const f = await fixture(); f.db.exec(sql); f.db.close(); const before = await snapshot(f.dir);
    await expect(withReadOnlyStore(f.dir, () => 1)).rejects.toThrow(); expect(await snapshot(f.dir)).toEqual(before);
  });
  it.each(["text", "blob"])("bounds corrupt settings %s values before materialization", async kind => {
    const f = await fixture();
    f.db.exec("ALTER TABLE settings RENAME TO original_settings; CREATE TABLE settings(key TEXT PRIMARY KEY, value); INSERT INTO settings SELECT * FROM original_settings; DROP TABLE original_settings");
    f.db.prepare("UPDATE settings SET value=? WHERE key='key_version'").run(kind === "text" ? "PRIVATE_SENTINEL".repeat(4096) : Buffer.alloc(65536, 65));
    f.db.close(); const before = await snapshot(f.dir);
    const original = DatabaseSync.prototype.prepare, statements: string[] = [];
    vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (this: DatabaseSync, sql: string) { statements.push(sql); return original.call(this, sql); });
    let invoked = false;
    await expect(withReadOnlyStore(f.dir, () => { invoked = true; })).rejects.toMatchObject({ code: "DATABASE_SCHEMA_INCOMPATIBLE" });
    expect(invoked).toBe(false); expect(statements.find(sql => sql.includes("FROM settings"))).toContain("CASE WHEN typeof(value)='integer' THEN value ELSE NULL END AS value");
    expect(await snapshot(f.dir)).toEqual(before);
  });
  it("rejects mismatched and missing installed key on populated store", async () => {
    const f = await fixture(); createSourceStore(f.db, f.context.keyId).replaceSource(f.input, null); f.db.exec("PRAGMA foreign_keys=OFF; UPDATE source_store_identity SET key_id='00000000000000000000000000000000'"); f.db.close();
    await expect(withReadOnlyStore(f.dir, () => 1)).rejects.toMatchObject({ code: "INVALID_IDENTITY_KEY" });
    const db = new DatabaseSync(join(f.dir, "agentprof.sqlite")); db.exec("PRAGMA foreign_keys=OFF; DELETE FROM source_store_identity"); db.close();
    await expect(withReadOnlyStore(f.dir, () => 1)).rejects.toMatchObject({ code: "INVALID_IDENTITY_KEY" });
  });
  it.each(["-journal", "-wal", "-shm"])("rejects existing %s without touching it", async suffix => {
    const f = await fixture(); f.db.close(); await writeFile(join(f.dir, "agentprof.sqlite" + suffix), "sentinel"); const before = await snapshot(f.dir);
    await expect(withReadOnlyStore(f.dir, () => 1)).rejects.toMatchObject({ code: "DATABASE_MODE_UNSUPPORTED" }); expect(await snapshot(f.dir)).toEqual(before);
  });
  it("rejects WAL header even after clean checkpoint removes sidecars", async () => {
    const f = await fixture(); f.db.exec("PRAGMA journal_mode=WAL"); f.db.close(); const before = await snapshot(f.dir);
    await expect(withReadOnlyStore(f.dir, () => 1)).rejects.toMatchObject({ code: "DATABASE_MODE_UNSUPPORTED" }); expect(await snapshot(f.dir)).toEqual(before);
  });
  it.each(["directory", "key", "database"])("rejects unsafe %s mode without chmod", async kind => {
    const f = await fixture(); f.db.close(); const path = kind === "directory" ? f.dir : join(f.dir, kind === "key" ? "identity-key.json" : "agentprof.sqlite"); await chmod(path, 0o755);
    await expect(withReadOnlyStore(f.dir, () => 1)).rejects.toMatchObject({ code: "UNSAFE_PRIVATE_FILE" }); expect((await lstat(path)).mode & 0o777).toBe(0o755);
  });
  it.each(["fifo", "symlink", "directory"])("rejects pre-open %s substitution without blocking", async kind => {
    const f = await fixture(); f.db.close(); const path = join(f.dir, "identity-key.json"); await rename(path, path + ".original");
    if (kind === "fifo") execFileSync("mkfifo", ["-m", "600", path]);
    if (kind === "symlink") await symlink(path + ".original", path);
    if (kind === "directory") await mkdir(path, { mode: 0o700 });
    await expect(withReadOnlyStore(f.dir, () => 1)).rejects.toMatchObject({ code: "UNSAFE_PRIVATE_FILE" });
  });
  it("bounds repeated short key reads and detects the overflow byte", async () => {
    const f = await fixture(); f.db.close(); const path = join(f.dir, "identity-key.json");
    const handle = await fsPromises.open(path, "r"), prototype = Object.getPrototypeOf(handle), original = prototype.read;
    await handle.close();
    const reads: number[] = [];
    vi.spyOn(prototype, "read").mockImplementation(function (this: unknown, buffer: Buffer, offset: number, length: number, position: number) {
      if (buffer.length === 1025) { reads.push(position); return original.call(this, buffer, offset, Math.min(length, 17), position); }
      return original.call(this, buffer, offset, length, position);
    });
    expect(await withReadOnlyStore(f.dir, () => 1)).toBe(1); expect(reads.length).toBeGreaterThan(1);
    await writeFile(path, (await readFile(path, "utf8")) + " ".repeat(1100));
    await expect(withReadOnlyStore(f.dir, () => 1)).rejects.toMatchObject({ code: "INVALID_IDENTITY_KEY" });
    expect(Math.max(...reads)).toBeLessThan(1025);
  });
  it.each(["fifo", "symlink", "directory"])("rejects a deterministic just-before-open %s swap", async kind => {
    const f = await fixture(); f.db.close(); const path = join(f.dir, "identity-key.json");
    const original = (await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")).open; let swapped = false;
    vi.spyOn(fsPromises, "open").mockImplementation(async (...args) => {
      if (args[0] === path && !swapped) {
        swapped = true; await rename(path, path + ".original");
        if (kind === "fifo") execFileSync("mkfifo", ["-m", "600", path]);
        else if (kind === "symlink") await symlink(path + ".original", path);
        else await mkdir(path, { mode: 0o700 });
      }
      return original(...args);
    });
    await expect(withReadOnlyStore(f.dir, () => 1)).rejects.toMatchObject({ code: "UNSAFE_PRIVATE_FILE" }); expect(swapped).toBe(true);
  });
  it("observes one generation while a normal DELETE writer is pending", async () => {
    const f = await fixture(); const store = createSourceStore(f.db, f.context.keyId); store.replaceSource(f.input, null); f.db.close();
    const peer = new DatabaseSync(join(f.dir, "agentprof.sqlite"), { timeout: 1 });
    try {
      expect(await withReadOnlyStore(f.dir, (db, key) => {
        const reader = createSourceStore(db, key); const first = reader.readSource(f.sourceId);
        peer.exec("BEGIN IMMEDIATE; UPDATE source_event_headers SET revision=2");
        expect(() => peer.exec("COMMIT")).toThrow();
        expect(reader.readSource(f.sourceId)?.revision).toBe(first?.revision);
        peer.exec("ROLLBACK"); return first?.revision;
      })).toBe(1);
    } finally { peer.close(); }
  });
});

it.each([3, 4])("rejects actual historical schema%i without writes, then reads explicitly migrated schema5 with absent relationships", async version => {
  const f = await fixture(); createSourceStore(f.db, f.context.keyId).replaceSource(f.input, null);
  f.db.exec("DROP TABLE source_relationship_contributions; DROP TABLE source_relationship_headers; DELETE FROM schema_migrations WHERE version=5; PRAGMA user_version=4");
  if (version === 3) f.db.exec("DROP TABLE source_cache_evidence; DELETE FROM schema_migrations WHERE version=4; PRAGMA user_version=3");
  f.db.close(); const before = await snapshot(f.dir);
  await expect(withReadOnlyStore(f.dir, () => 1)).rejects.toMatchObject({ code: "DATABASE_SCHEMA_INCOMPATIBLE" }); expect(await snapshot(f.dir)).toEqual(before);
  const writer = await openDatabase(f.dir); writer.close(); const migrated = await snapshot(f.dir);
  const saved = await withReadOnlyStore(f.dir, (db, key) => { const store = createSourceStore(db, key); expect(store.listSources().returnedCount).toBe(1); return store.readSource(f.sourceId); });
  expect(saved).toMatchObject({ revision: 1, evidence: null, cacheEvidence: null, relationshipEvidence: null }); expect(await snapshot(f.dir)).toEqual(migrated);
});
