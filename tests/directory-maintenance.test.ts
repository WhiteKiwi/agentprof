import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import { createIdentityContext } from "../src/normalize/identity.js";
import { migrate, openDatabase, transaction } from "../src/db/database.js";
import { createSourceStore } from "../src/db/source-store.js";
import { createDirectoryMembershipStore } from "../src/db/directory-membership.js";
import { maintainDirectoryInTransaction } from "../src/db/directory-maintenance.js";
import { withAuthenticatedStore, StoreOperationAborted } from "../src/db/read-only.js";
import { formatDirectoryMaintenance } from "../src/cli/directory.js";
import { enrollDirectory } from "../src/scanner/directory-enrollment.js";
import { reconcileDirectoryAbsence } from "../src/scanner/directory-reconciliation.js";
import { temporaryDirectory } from "./helpers.js";

const keyId = "e".repeat(32), secret = Buffer.alloc(32, 109), context = createIdentityContext(secret, keyId);
const rootId = context.fingerprint("source", ["FICTITIOUS_ROOT"]), rootFingerprint = context.fingerprint("content", ["FICTITIOUS_PHYSICAL_ROOT"]);
const handles = new Set<DatabaseSync>();
afterEach(() => { for (const db of handles) { if (db.isTransaction) db.exec("ROLLBACK"); db.close(); } handles.clear(); });
function memory() { const db = new DatabaseSync(":memory:"); migrate(db); handles.add(db); return db; }
function source(db: DatabaseSync, n: number) {
  const sourceId = context.fingerprint("source", ["codex", n]);
  const out = createSourceStore(db, keyId).replaceSource({ sourceId, provider: "codex", parserVersion: 1,
    normalizationVersion: 1, keyVersion: 1, keyId, completedOffset: 0, observedSize: 0, boundaryFingerprint: null, events: [] }, null);
  if (out.status !== "committed") throw Error("fixture");
  return { sourceId, sourceRevision: out.revision };
}
const input = (observed: any[] = [], id = rootId) => ({ rootId: id, provider: "codex" as const, rootFingerprint, observed });
function rows(db: DatabaseSync, membership = true) {
  const names = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => r.name as string);
  return names.filter(t => membership || !t.startsWith("directory_membership_")).map(t => [t, db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()]);
}
function maintain(db: DatabaseSync, action: "inspect" | "reset" | "prune", revision: number | null, id = rootId, signal?: AbortSignal) {
  return transaction(db, () => maintainDirectoryInTransaction(db, context, id, action, revision, signal));
}
async function disk(count = 2) {
  const data = join(temporaryDirectory(), "private"), db = await openDatabase(data); handles.add(db);
  writeFileSync(join(data, "identity-key.json"), JSON.stringify({ keyVersion: 1, keyId, secret: secret.toString("hex") }), { mode: 0o600 });
  const members = Array.from({ length: count }, (_, i) => source(db, i));
  createDirectoryMembershipStore(db, context).capture(input(members), null);
  return { data, db, members };
}

it("inspects immutable authenticated membership without leaking the root fingerprint or mutating any row", () => {
  const db = memory(), a = source(db, 1), store = createDirectoryMembershipStore(db, context); store.capture(input([a]), null);
  const before = rows(db), r = maintain(db, "inspect", null);
  expect(r).toMatchObject({ status: "inspected", previousRevision: 1, snapshot: { provider: "codex", revision: 1, counts: { total: 1, observed: 1, notObserved: 0 } }, sourcesChanged: false });
  expect(Object.isFrozen(r.snapshot!.members[0])).toBe(true); expect(Object.isFrozen(r.snapshot!.members)).toBe(true);
  expect(rows(db)).toEqual(before); expect(JSON.stringify(r)).not.toMatch(/rootFingerprint|FICTITIOUS_|seal|secret/);
});
it("reset retains the root anchor, releases only its vetoes and rejects old receipts after re-enrollment", () => {
  const db = memory(), a = source(db, 1), b = source(db, 2), store = createDirectoryMembershipStore(db, context);
  store.capture(input([a, b]), null); const otherId = context.fingerprint("source", ["other-root"]); store.capture(input([a], otherId), null);
  const originalOther = store.read(otherId), sourceRows = rows(db, false), r = maintain(db, "reset", 1);
  expect(r).toMatchObject({ status: "committed", previousRevision: 1, observationVetoesReleased: true, snapshot: { revision: 2, members: [], counts: { total: 0 } } });
  expect(store.read(rootId)).toMatchObject({ rootFingerprint, revision: 2, members: [] });
  expect(store.read(otherId)).toEqual(originalOther); expect(rows(db, false)).toEqual(sourceRows);
  const before = rows(db); expect(maintain(db, "reset", 1).status).toBe("stale"); expect(rows(db)).toEqual(before);
  expect(store.capture(input([a]), 1).status).toBe("stale"); expect(store.capture(input([a]), 2)).toMatchObject({ status: "committed", revision: 3 });
  expect(maintain(db, "reset", 1).status).toBe("stale"); expect(maintain(db, "reset", 2).status).toBe("stale");
});
it("prunes only not-observed unavailable sources and leaves observed and still-available members", () => {
  const db = memory(), [a, b, c] = [source(db, 1), source(db, 2), source(db, 3)], store = createDirectoryMembershipStore(db, context);
  store.capture(input([a, b, c]), null); store.capture(input([a]), 1);
  const sources = createSourceStore(db, keyId); sources.markUnavailable(a.sourceId, 1); sources.markUnavailable(b.sourceId, 1);
  const before = rows(db, false), r = maintain(db, "prune", 2);
  expect(r).toMatchObject({ status: "committed", removedSourceIds: [b.sourceId], observationVetoesReleased: false, snapshot: { revision: 3, counts: { total: 2, observed: 1, notObserved: 1 } } });
  expect(rows(db, false)).toEqual(before); expect(store.read(rootId)!.members.map(m => m.sourceId).sort()).toEqual([a.sourceId, c.sourceId].sort());
});
it.each(["reset", "prune"] as const)("empty %s is a byte-for-byte no-op and an absent root is not initialized", action => {
  const db = memory(), store = createDirectoryMembershipStore(db, context); const emptyBefore = rows(db);
  expect(maintain(db, action, 1).status).toBe("not_found"); expect(rows(db)).toEqual(emptyBefore);
  store.capture(input(), null); const before = rows(db); expect(maintain(db, action, 1).status).toBe("unchanged"); expect(rows(db)).toEqual(before);
});
it("retains a not-stored source instead of inventing unavailable evidence", () => {
  const db = memory(), a = source(db, 1), store = createDirectoryMembershipStore(db, context);
  store.capture(input([a]), null); store.capture(input(), 1); db.prepare("DELETE FROM source_event_headers WHERE source_id=?").run(a.sourceId);
  const before = rows(db); expect(maintain(db, "prune", 2).status).toBe("unchanged"); expect(rows(db)).toEqual(before);
});
it.each([
  "UPDATE directory_membership_roots SET revision=revision+1",
  "UPDATE directory_membership_roots SET member_count=0",
  "UPDATE directory_membership_roots SET seal=root_fingerprint",
  "DELETE FROM directory_membership_members",
  "PRAGMA foreign_keys=OFF; DELETE FROM directory_membership_roots; PRAGMA foreign_keys=ON",
])("refuses corrupt membership without reset repair: %s", sql => {
  const db = memory(), a = source(db, 1); createDirectoryMembershipStore(db, context).capture(input([a]), null); db.exec(sql); const before = rows(db);
  expect(() => maintain(db, "reset", 1)).toThrow(); expect(rows(db)).toEqual(before);
});
it("refuses a wrong key/secret and malformed source state without erasing evidence", () => {
  const db = memory(), a = source(db, 1), store = createDirectoryMembershipStore(db, context);
  store.capture(input([a]), null); store.capture(input(), 1); const before = rows(db);
  expect(() => transaction(db, () => maintainDirectoryInTransaction(db, createIdentityContext(Buffer.alloc(32, 110), keyId), rootId, "reset", 2))).toThrow();
  expect(rows(db)).toEqual(before);
  db.exec("PRAGMA ignore_check_constraints=ON");
  db.prepare("UPDATE source_event_headers SET availability='broken' WHERE source_id=?").run(a.sourceId);
  db.exec("PRAGMA ignore_check_constraints=OFF"); const corrupt = rows(db);
  expect(() => maintain(db, "prune", 2)).toThrow(); expect(rows(db)).toEqual(corrupt);
});
it("does not own nested transactions and removal helper rejects unknown/duplicate identities", () => {
  const db = memory(), a = source(db, 1), b = source(db, 2), store = createDirectoryMembershipStore(db, context); store.capture(input([a]), null);
  expect(() => maintainDirectoryInTransaction(db, context, rootId, "reset", 1)).toThrowError(expect.objectContaining({ code: "DATABASE_TRANSACTION_FAILED" }));
  const before = rows(db); db.exec("BEGIN IMMEDIATE");
  expect(() => store.removeMembersInTransaction(rootId, 1, [b.sourceId])).toThrow();
  expect(() => store.removeMembersInTransaction(rootId, 1, [a.sourceId, a.sourceId])).toThrow();
  expect(() => store.removeMembersInTransaction(rootId, 1, new Proxy([], {}))).toThrow();
  expect(db.isTransaction).toBe(true); db.exec("ROLLBACK"); expect(rows(db)).toEqual(before);
});
it.each(["error", "abort"] as const)("rolls back an entire reset after a real first deletion: %s", async kind => {
  const f = await disk(), before = rows(f.db), controller = new AbortController();
  await expect(withAuthenticatedStore(f.data, true, db => {
    const prepare = db.prepare.bind(db); let deleted = false;
    db.prepare = ((sql: string) => { const s = prepare(sql); if (sql.startsWith("DELETE FROM directory_membership_members")) {
      const run = s.run.bind(s); s.run = ((...args: any[]) => { const value = run(...args); if (!deleted) { deleted = true;
        if (kind === "error") throw Error("FICTITIOUS_PRIVATE_FAILURE"); controller.abort(); } return value; }) as any;
    } return s; }) as any;
    return maintainDirectoryInTransaction(db, context, rootId, "reset", 1, controller.signal);
  }, controller.signal)).rejects.toBeInstanceOf(kind === "abort" ? StoreOperationAborted : Error);
  expect(rows(f.db)).toEqual(before); expect(createDirectoryMembershipStore(f.db, context).read(rootId)!.members).toHaveLength(2);
});
it("rejects pre-abort and async callbacks without creating a store", async () => {
  const data = join(temporaryDirectory(), "absent"), controller = new AbortController(); controller.abort();
  await expect(withAuthenticatedStore(data, true, () => 1, controller.signal)).rejects.toBeInstanceOf(StoreOperationAborted);
  await expect(withAuthenticatedStore(data, true, async () => 1)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
});
it("rejects promises and callback errors after writes with full transaction rollback", async () => {
  const f = await disk(), before = rows(f.db);
  await expect(withAuthenticatedStore(f.data, true, db => { maintainDirectoryInTransaction(db, context, rootId, "reset", 1); return Promise.resolve(1); })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  expect(rows(f.db)).toEqual(before);
  await expect(withAuthenticatedStore(f.data, true, db => { maintainDirectoryInTransaction(db, context, rootId, "reset", 1); throw Error("FICTITIOUS_PRIVATE_SENTINEL"); })).rejects.toMatchObject({ code: "DATABASE_ACCESS_FAILED" });
  expect(rows(f.db)).toEqual(before);
});
it("read-only authenticated access refuses mutations and reads leave DB/key bytes untouched", async () => {
  const f = await disk(), paths = ["agentprof.sqlite", "identity-key.json"].map(p => join(f.data, p)), before = paths.map(p => readFileSync(p));
  const r = await withAuthenticatedStore(f.data, false, (db, c) => maintainDirectoryInTransaction(db, c, rootId, "inspect", null));
  expect(r.status).toBe("inspected");
  await expect(withAuthenticatedStore(f.data, false, (db, c) => maintainDirectoryInTransaction(db, c, rootId, "reset", 1))).rejects.toMatchObject({ code: "DATABASE_ACCESS_FAILED" });
  expect(paths.map(p => readFileSync(p))).toEqual(before);
});
it("another process commits a reset first; stale retries preserve its generation", async () => {
  const f = await disk(), module = new URL("../dist/cli/directory.js", import.meta.url).href;
  const script = `import{runDirectoryMaintenance}from${JSON.stringify(module)};const r=await runDirectoryMaintenance(${JSON.stringify({dataDir:f.data,root:rootId,reset:true,expectedRevision:"1"})});if(r.status!=="committed")throw Error('winner');`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 10000 });
  expect(child.status, child.stderr).toBe(0); const before = rows(f.db);
  const loser = await withAuthenticatedStore(f.data, true, (db, c) => maintainDirectoryInTransaction(db, c, rootId, "reset", 1));
  expect(loser).toMatchObject({ status: "stale", snapshot: { revision: 2, members: [] } }); expect(rows(f.db)).toEqual(before);
});
it.each(["codex", "claude"] as const)("real %s reset releases one cross-root veto without touching source data or checkpoints", async provider => {
  const base = temporaryDirectory(), parent = { provider, path: join(base, "logs") }, child = { provider, path: join(base, "logs", "nested") };
  await mkdir(child.path, { recursive: true }); const file = join(child.path, "session.jsonl");
  await copyFile(new URL(`./fixtures/providers/${provider}-real-shapes.jsonl`, import.meta.url), file);
  const db = await openDatabase(join(base, "private")); handles.add(db);
  const childReceipt = await enrollDirectory(db, context, child); await enrollDirectory(db, context, parent);
  const sourceBefore = rows(db, false); await rm(file); const parentReceipt = await enrollDirectory(db, context, parent);
  expect((await reconcileDirectoryAbsence(db, context, parent, parentReceipt)).counts?.retained).toBe(1);
  const beforeReset = rows(db, false);
  const reset = transaction(db, () => maintainDirectoryInTransaction(db, context, childReceipt.rootId, "reset", childReceipt.membership.revision!));
  expect(reset.observationVetoesReleased).toBe(true); expect(rows(db, false)).toEqual(beforeReset); expect(beforeReset).toEqual(sourceBefore);
  expect((await reconcileDirectoryAbsence(db, context, parent, parentReceipt)).counts?.markedUnavailable).toBe(1);
});
it("frees the 4096-member capacity, retains complete JSON and reports exact human omissions", () => {
  const db = memory(), store = createDirectoryMembershipStore(db, context); let revision: number | null = null;
  for (let batch = 0; batch < 64; batch++) {
    const r = store.capture(input(Array.from({ length: 64 }, (_, n) => source(db, batch * 64 + n))), revision); revision = r.revision;
  }
  const originalSources = rows(db, false), inspect = maintain(db, "inspect", null);
  expect(inspect.snapshot!.members).toHaveLength(4096);
  expect(formatDirectoryMaintenance(inspect, false)).toContain("shown=12/4096; omitted=4084");
  expect(JSON.parse(formatDirectoryMaintenance(inspect, true)).result.snapshot.members).toHaveLength(4096);
  const r = maintain(db, "reset", revision);
  expect(r.removedSourceIds).toHaveLength(4096); expect(r.snapshot!.members).toHaveLength(0);
  expect(formatDirectoryMaintenance(r, false)).toContain("total=4096; shown=12; omitted=4084");
  expect(JSON.parse(formatDirectoryMaintenance(r, true)).result.removedSourceIds).toHaveLength(4096);
  expect(rows(db, false)).toEqual(originalSources); expect(store.capture(input([source(db, 5000)]), r.snapshot!.revision).status).toBe("committed");
});

it("rejects a revision overflow before removing any member or rolling the anchor back to one", () => {
  const db = memory(), a = source(db, 1), store = createDirectoryMembershipStore(db, context); store.capture(input([a]), null);
  const prior = store.read(rootId)!, revision = Number.MAX_SAFE_INTEGER;
  const seal = context.fingerprint("content", ["directory_membership_v1", 1, 1, rootId, "codex", keyId, rootFingerprint, revision,
    prior.members.map(m => [m.sourceId, m.sourceRevision, m.observation])]);
  db.prepare("UPDATE directory_membership_roots SET revision=?,seal=? WHERE root_id=?").run(revision, seal, rootId);
  const before = rows(db); expect(() => maintain(db, "reset", revision)).toThrow(); expect(rows(db)).toEqual(before);
});
it("observes cancellation during the final asynchronous path checks and rolls back the pending reset", async () => {
  const f = await disk(), before = rows(f.db), controller = new AbortController();
  await expect(withAuthenticatedStore(f.data, true, db => {
    const result = maintainDirectoryInTransaction(db, context, rootId, "reset", 1);
    queueMicrotask(() => controller.abort());
    return result;
  }, controller.signal)).rejects.toBeInstanceOf(StoreOperationAborted);
  expect(rows(f.db)).toEqual(before);
});
it("an existing empty-root reset remains byte-identical for the database and key", async () => {
  const f = await disk(0), paths = ["agentprof.sqlite", "identity-key.json"].map(p => join(f.data, p)), before = paths.map(p => readFileSync(p));
  const result = await withAuthenticatedStore(f.data, true, (db, c) => maintainDirectoryInTransaction(db, c, rootId, "reset", 1));
  expect(result.status).toBe("unchanged"); expect(paths.map(p => readFileSync(p))).toEqual(before);
});
