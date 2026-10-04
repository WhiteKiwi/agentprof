import { DatabaseSync } from "node:sqlite";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createIdentityContext } from "../src/normalize/identity.js";
import { migrate, openDatabase, transaction } from "../src/db/database.js";
import { createDirectoryMembershipStore } from "../src/db/directory-membership.js";
import { retireDirectoryAbsences } from "../src/db/directory-retirement.js";
import { maintainDirectoryInTransaction } from "../src/db/directory-maintenance.js";
import { createSourceStore } from "../src/db/source-store.js";
import { withAuthenticatedStore, StoreOperationAborted } from "../src/db/read-only.js";
import { temporaryDirectory } from "./helpers.js";

const keyId = "c".repeat(32), secret = Buffer.alloc(32, 79), context = createIdentityContext(secret, keyId);
const rootId = context.fingerprint("source", ["FICTITIOUS_ROOT"]);
const oldBinding = context.fingerprint("content", ["FICTITIOUS_OLD"]), newBinding = context.fingerprint("content", ["FICTITIOUS_NEW"]);
const handles = new Set<DatabaseSync>();
afterEach(() => { for (const db of handles) { if (db.isTransaction) db.exec("ROLLBACK"); db.close(); } handles.clear(); });
function memory() { const db = new DatabaseSync(":memory:"); migrate(db); handles.add(db); return db; }
function capture(db: DatabaseSync, observed: { sourceId: string; sourceRevision: number }[] = [], id = rootId) {
  const store = createDirectoryMembershipStore(db, context);
  expect(store.capture({ rootId: id, provider: "codex", rootFingerprint: oldBinding, observed }, null).status).toBe("committed");
  return store;
}
function rows(db: DatabaseSync) {
  return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map(r => r.name as string).map(name => [name, db.prepare(`SELECT * FROM ${name} ORDER BY 1`).all()]);
}
async function disk() {
  const data = join(temporaryDirectory(), "private"), db = await openDatabase(data); handles.add(db);
  writeFileSync(join(data, "identity-key.json"), JSON.stringify({ keyVersion: 1, keyId, secret: secret.toString("hex") }), { mode: 0o600 });
  capture(db); return { data, db };
}
it("reseals only the empty root binding with monotonic revision and leaves sources/other roots intact", () => {
  const db = memory(), otherId = context.fingerprint("source", ["other"]), store = capture(db); capture(db, [], otherId);
  const before = rows(db), other = store.read(otherId);
  const next = transaction(db, () => store.rebindEmptyRootInTransaction(rootId, 1, newBinding));
  expect(next).toEqual({ rootId, provider: "codex", rootFingerprint: newBinding, revision: 2, members: [] });
  expect(store.read(rootId)).toEqual(next); expect(store.read(otherId)).toEqual(other);
  expect(rows(db).filter(([name]) => name !== "directory_membership_roots")).toEqual(before.filter(([name]) => name !== "directory_membership_roots"));
  expect(store.capture({ rootId, provider: "codex", rootFingerprint: oldBinding, observed: [] }, 1).status).toBe("stale");
  expect(store.capture({ rootId, provider: "codex", rootFingerprint: oldBinding, observed: [] }, 2)).toMatchObject({ status: "ineligible", reason: "root_changed" });
  expect(Object.isFrozen(next)).toBe(true);
});
it("same binding is an exact no-op", () => {
  const db = memory(), store = capture(db), before = rows(db);
  expect(transaction(db, () => store.rebindEmptyRootInTransaction(rootId, 1, oldBinding)).revision).toBe(1);
  expect(rows(db)).toEqual(before);
});
it.each(["no-transaction", "missing", "stale", "nonempty", "wrong-domain", "wrong-key", "bad-seal", "overflow"])("refuses %s without altering any rows", kind => {
  const db = memory(), sourceId = context.fingerprint("source", ["codex", "member"]);
  if (kind === "nonempty") createSourceStore(db, keyId).replaceSource({ sourceId, provider: "codex", parserVersion: 1, normalizationVersion: 1,
    keyVersion: 1, keyId, completedOffset: 0, observedSize: 0, boundaryFingerprint: null, events: [] }, null);
  const store = capture(db, kind === "nonempty" ? [{ sourceId, sourceRevision: 1 }] : []);
  let revision = 1;
  if (kind === "bad-seal") db.exec("UPDATE directory_membership_roots SET seal=root_fingerprint");
  if (kind === "overflow") {
    revision = Number.MAX_SAFE_INTEGER;
    const seal = context.fingerprint("content", ["directory_membership_v1", 1, 1, rootId, "codex", keyId, oldBinding, revision, []]);
    db.prepare("UPDATE directory_membership_roots SET revision=?,seal=?").run(revision, seal);
  }
  const before = rows(db);
  const selected = kind === "wrong-key" ? createDirectoryMembershipStore(db, createIdentityContext(Buffer.alloc(32, 8), keyId)) : store;
  const apply = () => selected.rebindEmptyRootInTransaction(kind === "missing" ? context.fingerprint("source", ["missing"]) : rootId,
    kind === "stale" ? 2 : revision, kind === "wrong-domain" ? rootId : newBinding);
  expect(() => kind === "no-transaction" ? apply() : transaction(db, apply)).toThrow(); expect(rows(db)).toEqual(before);
});
it("SQL trigger failure rolls back the authenticated update", () => {
  const db = memory(), store = capture(db), before = rows(db);
  db.exec("CREATE TRIGGER reject_rebind AFTER UPDATE OF root_fingerprint ON directory_membership_roots BEGIN SELECT RAISE(ABORT,'FICTITIOUS_ERROR'); END;");
  expect(() => transaction(db, () => store.rebindEmptyRootInTransaction(rootId, 1, newBinding))).toThrow(); expect(rows(db)).toEqual(before);
});
it("precommit verification runs after the update while rollback remains possible", async () => {
  const f = await disk(), before = rows(f.db), key = readFileSync(join(f.data, "identity-key.json")); let applied = false, guarded = false;
  await expect(withAuthenticatedStore(f.data, true, (db, ctx) => {
    const next = createDirectoryMembershipStore(db, ctx).rebindEmptyRootInTransaction(rootId, 1, newBinding); applied = next.revision === 2; return next.revision;
  }, undefined, async () => { guarded = true; expect(applied).toBe(true); throw new Error("FICTITIOUS_PATH_ERROR"); }))
    .rejects.toMatchObject({ code: "DATABASE_ACCESS_FAILED" });
  expect(guarded).toBe(true); expect(rows(f.db)).toEqual(before); expect(readFileSync(join(f.data, "identity-key.json"))).toEqual(key);
  expect(await withAuthenticatedStore(f.data, true, (db, ctx) => createDirectoryMembershipStore(db, ctx).rebindEmptyRootInTransaction(rootId, 1, newBinding).revision,
    undefined, () => undefined)).toBe(2);
});
it("observed cancellation after an async precommit guard rolls back", async () => {
  const f = await disk(), before = rows(f.db), abort = new AbortController();
  await expect(withAuthenticatedStore(f.data, true, (db, ctx) => createDirectoryMembershipStore(db, ctx).rebindEmptyRootInTransaction(rootId, 1, newBinding),
    abort.signal, async () => { await Promise.resolve(); abort.abort(); })).rejects.toBeInstanceOf(StoreOperationAborted);
  expect(rows(f.db)).toEqual(before);
});
it("invalid precommit callbacks and read-only guards are rejected before I/O", async () => {
  let called = false;
  const proxy = new Proxy(() => undefined, { apply() { called = true; } });
  for (const [writable, hook] of [[true, {}], [true, proxy], [false, () => undefined]] as const) {
    await expect(withAuthenticatedStore("/FICTITIOUS_MISSING", writable, () => 1, undefined, hook as any)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  }
  expect(called).toBe(false);
});

it("pre-rebind retirement and maintenance receipts cannot match the new generation", () => {
  const db = memory(), store = capture(db);
  transaction(db, () => store.rebindEmptyRootInTransaction(rootId, 1, newBinding));
  const before = rows(db);
  expect(retireDirectoryAbsences(db, context, { rootId, provider: "codex", rootFingerprint: oldBinding,
    membershipRevision: 1, observedSourceIds: [] })).toMatchObject({ status: "stale", reason: "membership_changed" });
  expect(transaction(db, () => maintainDirectoryInTransaction(db, context, rootId, "reset", 1))).toMatchObject({ status: "stale" });
  expect(rows(db)).toEqual(before);
});
