import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import { createIdentityContext } from "../src/normalize/identity.js";
import { migrate, openDatabase } from "../src/db/database.js";
import { createSourceStore } from "../src/db/source-store.js";
import { createDirectoryMembershipStore, DIRECTORY_MEMBERSHIP_LIMITS } from "../src/db/directory-membership.js";
import { withReadOnlyStore } from "../src/db/read-only.js";
import { temporaryDirectory } from "./helpers.js";

const keyId = "8".repeat(32), secret = Buffer.alloc(32, 73), context = createIdentityContext(secret, keyId);
const rootId = context.fingerprint("source", ["directory_root_v1", "codex", "FICTITIOUS_ROOT"]), rootFingerprint = context.fingerprint("content", ["directory_physical_root_v1", 1, 2, 3, 4]);
const handles = new Set<DatabaseSync>();
afterEach(() => { for (const db of handles) db.close(); handles.clear(); });
function memory() { const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true }); handles.add(db); migrate(db); return db; }
function add(db: DatabaseSync, n: number, expected: number | null = null) { const sourceId = context.fingerprint("source", ["codex", `FICTITIOUS_PATH_${n}`]); const out = createSourceStore(db, keyId).replaceSource({ sourceId, provider: "codex", parserVersion: 1, normalizationVersion: 1, keyVersion: 1, keyId, completedOffset: 0, observedSize: 0, boundaryFingerprint: null, events: [] }, expected); expect(out.status).toBe("committed"); return { sourceId, sourceRevision: out.revision }; }
const input = (observed: any[] = []) => ({ rootId, rootFingerprint, provider: "codex" as const, observed });
const snapshot = (db: DatabaseSync) => ["source_store_identity", "source_event_headers", "directory_membership_roots", "directory_membership_members"].map(t => db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all());

it("binds empty roots, preserves not-observed history, reobserves and returns immutable unchanged snapshots", () => {
  const db = memory(), store = createDirectoryMembershipStore(db, context);
  expect(store.read(rootId)).toBeNull(); expect(store.capture(input(), null)).toMatchObject({ status: "committed", revision: 1, memberCount: 0 });
  expect(db.prepare("SELECT key_id FROM source_store_identity").get()).toEqual({ key_id: keyId });
  const a = add(db, 1); expect(store.capture(input([a]), 1)).toMatchObject({ status: "committed", revision: 2 });
  const sourceBefore = createSourceStore(db, keyId).readSource(a.sourceId);
  expect(store.capture(input(), 2)).toMatchObject({ status: "committed", revision: 3 });
  expect(store.read(rootId)!.members).toEqual([{ ...a, observation: "not_observed" }]);
  expect(createSourceStore(db, keyId).readSource(a.sourceId)).toEqual(sourceBefore);
  expect(store.capture(input([a]), 3)).toMatchObject({ status: "committed", revision: 4 });
  const before = snapshot(db); expect(store.capture(input([a]), 4)).toMatchObject({ status: "unchanged", revision: 4 }); expect(snapshot(db)).toEqual(before);
  const value = store.read(rootId)!; expect(Object.isFrozen(value)).toBe(true); expect(Object.isFrozen(value.members)).toBe(true); expect(Object.isFrozen(value.members[0])).toBe(true);
  expect(JSON.stringify(snapshot(db))).not.toMatch(/FICTITIOUS_|directory_physical_root_v1/);
});

it("grows across 64 full scanner batches to exactly 4096 and rejects 4097 without evicting history", () => {
  const db = memory(), store = createDirectoryMembershipStore(db, context); let revision: number | null = null;
  for (let batch = 0; batch < 64; batch++) {
    const observed = Array.from({ length: 64 }, (_, i) => add(db, batch * 64 + i));
    const out = store.capture(input(observed), revision); expect(out.status).toBe("committed"); revision = out.revision;
  }
  const full = store.read(rootId)!; expect(full.members).toHaveLength(4096); expect(full.members.filter(m => m.observation === "observed")).toHaveLength(64);
  const bytes = db.prepare("SELECT manifest_bytes FROM directory_membership_roots").get()!.manifest_bytes;
  expect(bytes).toBeLessThanOrEqual(DIRECTORY_MEMBERSHIP_LIMITS.bytes);
  const next = add(db, 4096), before = snapshot(db);
  expect(store.capture(input([next]), revision)).toMatchObject({ status: "ineligible", reason: "membership_limit" }); expect(snapshot(db)).toEqual(before);
});

it.each([
  (x: any) => ({ ...x, extra: 1 }),
  (x: any) => Object.defineProperty(x, "rootId", { get() { throw Error("getter executed"); } }),
  (x: any) => new Proxy(x, {}),
  (x: any) => ({ ...x, observed: new Array(1) }),
  (x: any) => ({ ...x, observed: new Proxy([], {}) }),
  (x: any) => ({ ...x, provider: "other" }),
  (x: any) => ({ ...x, rootId: "FICTITIOUS_RAW_PATH" }),
  (x: any) => ({ ...x, rootFingerprint: rootId }),
  (x: any) => ({ ...x, observed: [{ sourceId: rootId, sourceRevision: 0 }] }),
  (x: any) => ({ ...x, observed: Array.from({ length: 65 }, () => ({ sourceId: rootId, sourceRevision: 1 })) }),
  (x: any) => ({ ...x, observed: [{ sourceId: rootId, sourceRevision: 1 }, { sourceId: rootId, sourceRevision: 1 }] }),
])("rejects hostile capture shape before mutating", transform => {
  const db = memory(), store = createDirectoryMembershipStore(db, context), before = snapshot(db);
  expect(() => store.capture(transform(input()), null)).toThrow(); expect(snapshot(db)).toEqual(before);
});

it.each([
  "UPDATE directory_membership_roots SET revision=revision+1",
  "UPDATE directory_membership_roots SET provider='claude'",
  "UPDATE directory_membership_roots SET root_fingerprint=seal",
  "UPDATE directory_membership_roots SET member_count=0",
  "UPDATE directory_membership_roots SET manifest_bytes=2",
  "UPDATE directory_membership_members SET source_revision=2",
  "UPDATE directory_membership_members SET observation='not_observed'",
  "DELETE FROM directory_membership_members",
])("refuses corrupted membership without resealing: %s", sql => {
  const db = memory(), store = createDirectoryMembershipStore(db, context), a = add(db, 1); store.capture(input([a]), null); db.exec(sql); const before = snapshot(db);
  expect(() => store.read(rootId)).toThrowError(expect.objectContaining({ code: "DATABASE_ACCESS_FAILED" }));
  expect(() => store.capture(input([a]), 1)).toThrow(); expect(snapshot(db)).toEqual(before);
});

it("guards wrong secret/key, source-generation races, root substitution and original membership CAS", () => {
  const db = memory(), store = createDirectoryMembershipStore(db, context), a = add(db, 1); store.capture(input([a]), null); const before = snapshot(db);
  expect(() => createDirectoryMembershipStore(db, createIdentityContext(Buffer.alloc(32, 74), keyId)).read(rootId)).toThrow();
  const other = createIdentityContext(secret, "9".repeat(32)); expect(() => createDirectoryMembershipStore(db, other).read(other.fingerprint("source", ["root"]))).toThrowError(expect.objectContaining({ code: "INVALID_IDENTITY_KEY" }));
  expect(store.capture({ ...input([a]), rootFingerprint: context.fingerprint("content", ["changed"]) }, 1)).toMatchObject({ status: "ineligible", reason: "root_changed" });
  expect(store.capture(input([a]), null)).toMatchObject({ status: "stale", reason: "membership_changed" }); expect(snapshot(db)).toEqual(before);
  add(db, 1, 1); const newer = snapshot(db); expect(store.capture(input([a]), 1)).toMatchObject({ status: "stale", reason: "source_changed" }); expect(snapshot(db)).toEqual(newer);
});

it("aborts and rolls back an interrupted replacement without harming caller transactions", () => {
  const db = memory(), store = createDirectoryMembershipStore(db, context), a = add(db, 1); store.capture(input([a]), null); const b = add(db, 2), before = snapshot(db), controller = new AbortController();
  const prepare = db.prepare.bind(db); db.prepare = ((sql: string) => { const s = prepare(sql); if (sql.startsWith("INSERT INTO directory_membership_members")) { const run = s.run.bind(s); s.run = ((...args: any[]) => { const r = run(...args); controller.abort(); return r; }) as any; } return s; }) as any;
  try { expect(store.capture(input([a, b]), 1, controller.signal).status).toBe("aborted"); } finally { db.prepare = prepare; }
  expect(snapshot(db)).toEqual(before); db.exec("BEGIN IMMEDIATE"); expect(() => store.capture(input(), 1)).toThrowError(expect.objectContaining({ code: "DATABASE_TRANSACTION_FAILED" })); expect(db.isTransaction).toBe(true); db.exec("ROLLBACK");
});

it("migrates authentic schema6, preserves sources, refuses old read-only and rolls DDL conflicts back", async () => {
  const data = join(temporaryDirectory(), "data"), db = await openDatabase(data); handles.add(db); const a = add(db, 1);
  db.exec("DROP TABLE directory_membership_members; DROP TABLE directory_membership_roots; DELETE FROM schema_migrations WHERE version=7; PRAGMA user_version=6");
  const old = createSourceStore(db, keyId).readSource(a.sourceId); db.close(); handles.delete(db);
  writeFileSync(join(data, "identity-key.json"), JSON.stringify({ keyVersion: 1, keyId, secret: secret.toString("hex") }), { mode: 0o600 });
  const bytes = readFileSync(join(data, "agentprof.sqlite")); await expect(withReadOnlyStore(data, () => 1)).rejects.toMatchObject({ code: "DATABASE_SCHEMA_INCOMPATIBLE" }); expect(readFileSync(join(data, "agentprof.sqlite"))).toEqual(bytes);
  const next = await openDatabase(data); handles.add(next); expect(createSourceStore(next, keyId).readSource(a.sourceId)).toEqual(old); migrate(next); expect(next.prepare("PRAGMA user_version").get()!.user_version).toBe(7);
  next.exec("DROP TABLE directory_membership_members; DROP TABLE directory_membership_roots; DELETE FROM schema_migrations WHERE version=7; PRAGMA user_version=6; CREATE TABLE directory_membership_members(sentinel)");
  const schema = next.prepare("SELECT * FROM sqlite_schema ORDER BY name").all(); expect(() => migrate(next)).toThrow(); expect(next.prepare("SELECT * FROM sqlite_schema ORDER BY name").all()).toEqual(schema); expect(next.prepare("PRAGMA user_version").get()!.user_version).toBe(6);
});

it("authenticates durable restart and a separate-process winner makes stale capture non-writing", async () => {
  const data = join(temporaryDirectory(), "data"), db = await openDatabase(data); handles.add(db); const a = add(db, 1), store = createDirectoryMembershipStore(db, context); store.capture(input([a]), null);
  const module = new URL("../dist/db/directory-membership.js", import.meta.url).href, identity = new URL("../dist/normalize/identity.js", import.meta.url).href;
  const script = `import {DatabaseSync} from 'node:sqlite';import{createDirectoryMembershipStore}from${JSON.stringify(module)};import{createIdentityContext}from${JSON.stringify(identity)};const db=new DatabaseSync(process.argv[1]);try{const c=createIdentityContext(Buffer.alloc(32,73),${JSON.stringify(keyId)});const s=createDirectoryMembershipStore(db,c);const old=s.read(${JSON.stringify(rootId)});if(old.revision!==1)throw Error('old');const out=s.capture(${JSON.stringify(input())},1);if(out.status!=='committed')throw Error('winner');}finally{db.close();}`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script, join(data, "agentprof.sqlite")], { encoding: "utf8" }); expect(child.status, child.stderr).toBe(0);
  expect(store.read(rootId)!.members[0]!.observation).toBe("not_observed"); const before = readFileSync(join(data, "agentprof.sqlite")); expect(store.capture(input([a]), 1).status).toBe("stale"); expect(readFileSync(join(data, "agentprof.sqlite")).equals(before)).toBe(true);
});

it.each(["before_commit", "after_commit"])("recovers an actual process crash %s to one complete manifest", async phase => {
  const data = join(temporaryDirectory(), "data"), db = await openDatabase(data); const a = add(db, 1); createDirectoryMembershipStore(db, context).capture(input([a]), null); db.close();
  const module = new URL("../dist/db/directory-membership.js", import.meta.url).href, identity = new URL("../dist/normalize/identity.js", import.meta.url).href;
  const script = `import{DatabaseSync}from'node:sqlite';import{createDirectoryMembershipStore}from${JSON.stringify(module)};import{createIdentityContext}from${JSON.stringify(identity)};const db=new DatabaseSync(process.argv[1]);const c=createIdentityContext(Buffer.alloc(32,73),${JSON.stringify(keyId)});const prepare=db.prepare.bind(db),exec=db.exec.bind(db);${phase === "before_commit" ? `db.prepare=sql=>{const s=prepare(sql);if(sql.startsWith('INSERT INTO directory_membership_members')){const run=s.run.bind(s);s.run=(...args)=>{run(...args);process.kill(process.pid,'SIGKILL');};}return s;};` : `db.exec=sql=>{exec(sql);if(sql==='COMMIT')process.kill(process.pid,'SIGKILL');};`}createDirectoryMembershipStore(db,c).capture(${JSON.stringify(input())},1);process.exit(91);`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script, join(data, "agentprof.sqlite")], { encoding: "utf8" }); expect(child.signal, child.stderr).toBe("SIGKILL");
  const recovered = await openDatabase(data); handles.add(recovered); const value = createDirectoryMembershipStore(recovered, context).read(rootId)!;
  expect(value.revision).toBe(phase === "before_commit" ? 1 : 2); expect(value.members).toEqual([{ ...a, observation: phase === "before_commit" ? "observed" : "not_observed" }]);
  expect(createSourceStore(recovered, keyId).readSource(a.sourceId)!.availability).toBe("available");
});

it("bounds malformed stored fields before materialization and refuses orphan membership on read-only access", async () => {
  const data = join(temporaryDirectory(), "data"), db = await openDatabase(data); handles.add(db); const store = createDirectoryMembershipStore(db, context); store.capture(input(), null);
  db.exec("PRAGMA ignore_check_constraints=ON"); db.prepare("UPDATE directory_membership_roots SET seal=?").run("x".repeat(2 * 1024 * 1024));
  expect(() => store.read(rootId)).toThrowError(expect.objectContaining({ code: "DATABASE_ACCESS_FAILED" }));
  db.exec("PRAGMA foreign_keys=OFF; DELETE FROM source_store_identity"); db.close(); handles.delete(db);
  writeFileSync(join(data, "identity-key.json"), JSON.stringify({ keyVersion: 1, keyId, secret: secret.toString("hex") }), { mode: 0o600 });
  const before = readFileSync(join(data, "agentprof.sqlite")); await expect(withReadOnlyStore(data, () => 1)).rejects.toMatchObject({ code: "INVALID_IDENTITY_KEY" }); expect(readFileSync(join(data, "agentprof.sqlite")).equals(before)).toBe(true);
});
