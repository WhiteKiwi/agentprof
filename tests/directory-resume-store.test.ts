import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import { createIdentityContext, loadOrCreateIdentityContext } from "../src/normalize/identity.js";
import { migrate, openDatabase } from "../src/db/database.js";
import { createDirectoryMembershipStore } from "../src/db/directory-membership.js";
import { createDirectoryResumeStore } from "../src/db/directory-resume.js";
import type { DirectoryResumeInput } from "../src/db/directory-resume.js";
import { createSourceStore } from "../src/db/source-store.js";
import { StoreOperationAborted, withAuthenticatedStore, withReadOnlyStore } from "../src/db/read-only.js";
import { temporaryDirectory } from "./helpers.js";

const key = "a".repeat(32), context = createIdentityContext(Buffer.alloc(32, 37), key);
const handles = new Set<DatabaseSync>();
afterEach(() => { for (const db of handles) db.close(); handles.clear(); });
function memory() { const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true }); migrate(db); handles.add(db); return db; }
function input(n = 0, c = context): DirectoryResumeInput {
  return { rootId: c.fingerprint("source", ["FICTITIOUS_DIRECTORY", n]), provider: "codex",
    rootFingerprint: c.fingerprint("content", ["physical", n]), membershipRevision: null, captureMode: "default",
    censusCount: 65, censusFingerprint: c.fingerprint("content", ["census", n]), nextOffset: 16,
    prefixFingerprint: c.fingerprint("content", ["prefix", 16, n]) };
}
function snapshot(db: DatabaseSync, includeCursor = true) {
  return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all()
    .filter(x => includeCursor || x.name !== "directory_batch_resume")
    .map(x => [x.name, db.prepare(`SELECT * FROM "${x.name}" ORDER BY 1`).all()]);
}

it.each(["codex", "claude"] as const)("round-trips immutable %s hints across all three capture modes", provider => {
  const db = memory(), store = createDirectoryResumeStore(db, context);
  for (const [index, captureMode] of (["default", "timing", "pattern"] as const).entries()) {
    const v = { ...input(index), provider, captureMode };
    expect(store.read(v.rootId)).toBeNull();
    const saved = store.save(v, null); expect(saved.status).toBe("committed");
    expect(store.read(v.rootId)).toEqual(saved.cursor); expect(saved.cursor).toMatchObject(v);
    expect(saved.cursor?.contractVersion).toBe(1); expect(saved.cursor?.keyId).toBe(key);
    expect(Object.isFrozen(saved.cursor)).toBe(true); expect(Object.isFrozen(saved)).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(saved.cursor))).toBeLessThan(2048);
  }
  expect(JSON.stringify(snapshot(db))).not.toContain("FICTITIOUS_DIRECTORY");
});

it("only advances the same envelope with the original CAS seal and preserves no-op bytes", () => {
  const db = memory(), store = createDirectoryResumeStore(db, context), v = input();
  const first = store.save(v, null).cursor!; const initial = snapshot(db);
  expect(store.save(v, null)).toMatchObject({ status: "stale", reason: "cursor_changed" });
  expect(store.save(v, first.seal)).toMatchObject({ status: "unchanged", cursor: first });
  expect(snapshot(db)).toEqual(initial);
  const next = { ...v, nextOffset: 32, prefixFingerprint: context.fingerprint("content", ["prefix", 32]) };
  const second = store.save(next, first.seal).cursor!; expect(second.nextOffset).toBe(32); expect(second.seal).not.toBe(first.seal);
  const stable = snapshot(db);
  expect(store.save({ ...next, nextOffset: 48 }, first.seal)).toMatchObject({ status: "stale", reason: "cursor_changed" });
  expect(store.remove(v.rootId, first.seal)).toMatchObject({ status: "stale", reason: "cursor_changed" });
  expect(store.save(v, second.seal)).toMatchObject({ status: "ineligible", reason: "offset_regression" });
  expect(store.save({ ...next, prefixFingerprint: v.prefixFingerprint }, second.seal)).toMatchObject({ status: "ineligible", reason: "prefix_changed" });
  expect(snapshot(db)).toEqual(stable);
  const terminal = store.save({ ...next, nextOffset: 65 }, second.seal).cursor!; expect(terminal.nextOffset).toBe(65);
  expect(store.remove(v.rootId, terminal.seal).status).toBe("committed");
  const removed = snapshot(db); expect(store.remove(v.rootId, null).status).toBe("unchanged"); expect(snapshot(db)).toEqual(removed);
  expect(store.remove(v.rootId, terminal.seal).status).toBe("stale");
});

it.each([
  ["provider", "claude"], ["captureMode", "timing"], ["censusCount", 80],
  ["rootFingerprint", context.fingerprint("content", ["other-root"])],
  ["censusFingerprint", context.fingerprint("content", ["other-census"])],
])("refuses an in-place envelope replacement: %s", (field, value) => {
  const db = memory(), store = createDirectoryResumeStore(db, context), v = input();
  const saved = store.save(v, null).cursor!, before = snapshot(db);
  expect(store.save({ ...v, [field]: value } as DirectoryResumeInput, saved.seal)).toMatchObject({ status: "ineligible", reason: "envelope_changed" });
  expect(snapshot(db)).toEqual(before);
});

it("rejects membership/root drift at save while allowing conditional removal of authentic stale hints", () => {
  const db = memory(), roots = createDirectoryMembershipStore(db, context), store = createDirectoryResumeStore(db, context), v = input();
  const saved = store.save(v, null).cursor!;
  roots.capture({ rootId: v.rootId, provider: v.provider, rootFingerprint: v.rootFingerprint, observed: [] }, null);
  const before = snapshot(db);
  expect(store.read(v.rootId)).toEqual(saved); // Authentication is deliberately not freshness.
  expect(store.save({ ...v, nextOffset: 32 }, saved.seal)).toMatchObject({ status: "stale", reason: "membership_changed" });
  expect(snapshot(db)).toEqual(before);
  expect(store.remove(v.rootId, saved.seal).status).toBe("committed");
  expect(store.save({ ...v, membershipRevision: 1, rootFingerprint: context.fingerprint("content", ["wrong"]) }, null))
    .toMatchObject({ status: "ineligible", reason: "root_changed" });
  expect(store.save({ ...v, membershipRevision: 1, provider: "claude" }, null)).toMatchObject({ status: "ineligible", reason: "root_changed" });
  const known = store.save({ ...v, membershipRevision: 1 }, null).cursor!; expect(known.membershipRevision).toBe(1);
  db.exec("BEGIN IMMEDIATE"); roots.rebindEmptyRootInTransaction(v.rootId, 1, context.fingerprint("content", ["replacement"])); db.exec("COMMIT");
  expect(store.save({ ...v, membershipRevision: 1, nextOffset: 32 }, known.seal)).toMatchObject({ status: "stale", reason: "membership_changed" });
  expect(store.remove(v.rootId, known.seal).status).toBe("committed");
});

it.each([
  ["missing", (v: any) => { delete v.nextOffset; return v; }], ["extra", (v: any) => ({ ...v, path: "RAW_SECRET_PATH" })],
  ["accessor", (v: any) => Object.defineProperty(v, "nextOffset", { get() { throw Error("GETTER_EXECUTED"); } })],
  ["proxy", (v: any) => new Proxy(v, { ownKeys() { throw Error("PROXY_EXECUTED"); } })],
  ["non-enumerable", (v: any) => Object.defineProperty(v, "nextOffset", { enumerable: false })],
  ["prototype", (v: any) => Object.assign(Object.create({ inherited: 1 }), v)],
  ["symbol", (v: any) => Object.assign(v, { [Symbol("hidden")]: true })],
  ...[0, -1, 1.5, 4097, NaN, Infinity, "65", null, undefined].map(x => [`census:${String(x)}`, (v: any) => ({ ...v, censusCount: x })]),
  ...[0, -16, 15, 17, 64.5, 66, Number.MAX_SAFE_INTEGER + 1, null].map(x => [`offset:${x}`, (v: any) => ({ ...v, nextOffset: x })]),
  ...[0, -1, 1.5, "1", undefined, Number.MAX_SAFE_INTEGER + 1].map(x => [`revision:${String(x)}`, (v: any) => ({ ...v, membershipRevision: x })]),
  ["mode", (v: any) => ({ ...v, captureMode: "other" })], ["provider", (v: any) => ({ ...v, provider: "other" })],
  ["root-domain", (v: any) => ({ ...v, rootId: v.censusFingerprint })],
  ["prefix-domain", (v: any) => ({ ...v, prefixFingerprint: v.rootId })],
  ["oversize", (v: any) => ({ ...v, censusFingerprint: "x".repeat(1024 * 1024) })],
] as const)("rejects hostile input %s before any mutation", (_name, transform) => {
  const db = memory(), store = createDirectoryResumeStore(db, context), before = snapshot(db);
  expect(() => store.save(transform(input()), null)).toThrowError(expect.objectContaining({ code: "INVALID_RECORD" }));
  expect(snapshot(db)).toEqual(before);
});

it.each([
  "provider='claude'", "contract_version=2", "key_id='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'",
  "root_fingerprint=prefix_fingerprint", "membership_revision=1", "capture_mode='timing'", "census_count=80", "next_offset=32",
  "census_fingerprint=prefix_fingerprint", "prefix_fingerprint=census_fingerprint", "seal=prefix_fingerprint",
  "membership_revision='wrong'", "membership_revision=0", "census_count=0", "next_offset=15",
  "root_fingerprint=zeroblob(1048576)", "capture_mode=printf('%1048576s','x')",
])("refuses tampered stored column without resealing/deleting: %s", assignment => {
  const db = memory(), store = createDirectoryResumeStore(db, context), v = input(), saved = store.save(v, null).cursor!;
  // A deliberately malformed, non-STRICT table exercises application validation too.
  db.exec("ALTER TABLE directory_batch_resume RENAME TO old_resume; CREATE TABLE directory_batch_resume AS SELECT * FROM old_resume; DROP TABLE old_resume;");
  db.exec(`UPDATE directory_batch_resume SET ${assignment}`); const before = snapshot(db);
  for (const call of [() => store.read(v.rootId), () => store.save(v, saved.seal), () => store.remove(v.rootId, saved.seal)]) {
    expect(call).toThrowError(expect.objectContaining({ code: "DATABASE_ACCESS_FAILED" }));
  }
  expect(snapshot(db)).toEqual(before);
});

it("does not mistake duplicate rows or a renamed root for an authenticated record", () => {
  const db = memory(), store = createDirectoryResumeStore(db, context), v = input(); store.save(v, null);
  db.exec("ALTER TABLE directory_batch_resume RENAME TO old_resume; CREATE TABLE directory_batch_resume AS SELECT * FROM old_resume; INSERT INTO directory_batch_resume SELECT * FROM old_resume; DROP TABLE old_resume;");
  expect(() => store.read(v.rootId)).toThrowError(expect.objectContaining({ code: "DATABASE_ACCESS_FAILED" }));
  db.exec("DELETE FROM directory_batch_resume WHERE rowid=2");
  const other = input(10); db.prepare("UPDATE directory_batch_resume SET root_id=?").run(other.rootId);
  expect(() => store.read(other.rootId)).toThrowError(expect.objectContaining({ code: "DATABASE_ACCESS_FAILED" }));
});

it("refuses wrong keys/secrets and resume-only orphans at every writing boundary", async () => {
  const data = join(temporaryDirectory(), "data"), c = await loadOrCreateIdentityContext(data), db = await openDatabase(data); handles.add(db);
  const v = input(0, c), store = createDirectoryResumeStore(db, c), saved = store.save(v, null).cursor!;
  const other = createIdentityContext(Buffer.alloc(32, 72), "b".repeat(32));
  expect(() => createDirectoryResumeStore(db, other).read(input(0, other).rootId)).toThrowError(expect.objectContaining({ code: "INVALID_IDENTITY_KEY" }));
  expect(() => createDirectoryResumeStore(db, createIdentityContext(Buffer.alloc(32, 72), c.keyId)).read(v.rootId)).toThrowError(expect.objectContaining({ code: "DATABASE_ACCESS_FAILED" }));
  db.exec("PRAGMA foreign_keys=OFF; DELETE FROM source_store_identity;"); const before = snapshot(db);
  expect(() => store.read(v.rootId)).toThrowError(expect.objectContaining({ code: "INVALID_IDENTITY_KEY" }));
  expect(() => store.save(v, saved.seal)).toThrowError(expect.objectContaining({ code: "INVALID_IDENTITY_KEY" }));
  expect(() => store.remove(v.rootId, saved.seal)).toThrowError(expect.objectContaining({ code: "INVALID_IDENTITY_KEY" }));
  expect(() => createDirectoryMembershipStore(db, c).capture({ rootId: v.rootId, provider: v.provider, rootFingerprint: v.rootFingerprint, observed: [] }, null)).toThrow();
  expect(() => createSourceStore(db, c.keyId).replaceSource({ sourceId: c.fingerprint("source", ["log"]), provider: "codex", parserVersion: 1, normalizationVersion: 1, keyVersion: 1, keyId: c.keyId, completedOffset: 0, observedSize: 0, boundaryFingerprint: null, events: [] }, null)).toThrowError(expect.objectContaining({ code: "INVALID_IDENTITY_KEY" }));
  expect(() => createSourceStore(db, c.keyId).readSourceForIngestion(v.rootId, c)).toThrow();
  expect(snapshot(db)).toEqual(before);
  db.close(); handles.delete(db);
  const bytes = readFileSync(join(data, "agentprof.sqlite"));
  await expect(withReadOnlyStore(data, () => 1)).rejects.toMatchObject({ code: "INVALID_IDENTITY_KEY" });
  expect(readFileSync(join(data, "agentprof.sqlite"))).toEqual(bytes);
});

it("bounds the complete table at64 roots without evicting other hints", () => {
  const db = memory(), store = createDirectoryResumeStore(db, context);
  for (let n = 0; n < 64; n++) expect(store.save(input(n), null).status).toBe("committed");
  const before = snapshot(db);
  expect(store.save(input(64), null)).toMatchObject({ status: "ineligible", reason: "cursor_limit" }); expect(snapshot(db)).toEqual(before);
  const prior = store.read(input(0).rootId)!;
  expect(store.save({ ...input(0), nextOffset: 32 }, prior.seal).status).toBe("committed");
  expect(store.remove(input(1).rootId, store.read(input(1).rootId)!.seal).status).toBe("committed");
  expect(store.save(input(64), null).status).toBe("committed");
});

it("admits exact4096 boundaries and terminal short pages but never an empty-run cursor", () => {
  const db = memory(), store = createDirectoryResumeStore(db, context);
  for (const [n, count, offset] of [[0, 4096, 4096], [1, 4096, 4080], [2, 1, 1], [3, 65, 65]]) {
    expect(store.save({ ...input(n!), censusCount: count!, nextOffset: offset! }, null).status).toBe("committed");
  }
});

it("preserves source payloads, membership, caches/checkpoints and key through a real reopen", async () => {
  const data = join(temporaryDirectory(), "data"), c = await loadOrCreateIdentityContext(data), db = await openDatabase(data); handles.add(db);
  const v = input(0, c), sourceId = c.fingerprint("source", ["FICTITIOUS_LOG"]);
  createSourceStore(db, c.keyId).replaceSource({ sourceId, provider: "codex", parserVersion: 1, normalizationVersion: 1, keyVersion: 1, keyId: c.keyId, completedOffset: 0, observedSize: 0, boundaryFingerprint: null, events: [] }, null);
  createDirectoryMembershipStore(db, c).capture({ rootId: v.rootId, provider: v.provider, rootFingerprint: v.rootFingerprint, observed: [{ sourceId, sourceRevision: 1 }] }, null);
  const before = snapshot(db, false), keyBefore = readFileSync(join(data, "identity-key.json"));
  const record = createDirectoryResumeStore(db, c).save({ ...v, membershipRevision: 1 }, null).cursor!;
  db.close(); handles.delete(db);
  const again = await openDatabase(data); handles.add(again); const store = createDirectoryResumeStore(again, c);
  expect(store.read(v.rootId)).toEqual(record); expect(snapshot(again, false)).toEqual(before);
  expect(store.remove(v.rootId, record.seal).status).toBe("committed");
  expect(snapshot(again, false)).toEqual(before); expect(readFileSync(join(data, "identity-key.json"))).toEqual(keyBefore);
});

it("preserves caller-owned transactions and invalidates only within an explicit caller snapshot", () => {
  const db = memory(), store = createDirectoryResumeStore(db, context), v = input(), saved = store.save(v, null).cursor!;
  expect(() => store.removeInTransaction(v.rootId, saved.seal)).toThrowError(expect.objectContaining({ code: "DATABASE_TRANSACTION_FAILED" }));
  db.exec("BEGIN IMMEDIATE");
  for (const call of [() => store.read(v.rootId), () => store.save(v, saved.seal), () => store.remove(v.rootId, saved.seal)]) {
    expect(call).toThrowError(expect.objectContaining({ code: "DATABASE_TRANSACTION_FAILED" })); expect(db.isTransaction).toBe(true);
  }
  expect(store.removeInTransaction(v.rootId, saved.seal).status).toBe("committed"); expect(db.isTransaction).toBe(true);
  db.exec("ROLLBACK"); expect(store.read(v.rootId)).toEqual(saved);
});

it.each(["save", "remove"] as const)("rolls back %s on SQL failure, cancellation and COMMIT failure", action => {
  const db = memory(), store = createDirectoryResumeStore(db, context), v = input(), saved = store.save(v, null).cursor!;
  for (const failure of ["sql", "abort", "commit"] as const) {
    const before = snapshot(db), controller = new AbortController(), prepare = db.prepare.bind(db), exec = db.exec.bind(db);
    db.prepare = ((sql: string) => {
      const statement = prepare(sql);
      if (sql.startsWith(action === "save" ? "INSERT INTO directory_batch_resume" : "DELETE FROM directory_batch_resume")) {
        const run = statement.run.bind(statement);
        statement.run = ((...args: any[]) => { const value = run(...args); if (failure === "sql") throw Error("PRIVATE_ERROR"); if (failure === "abort") controller.abort(); return value; }) as any;
      }
      return statement;
    }) as any;
    if (failure === "commit") db.exec = ((sql: string) => { if (sql === "COMMIT") throw Error("PRIVATE_COMMIT"); return exec(sql); }) as any;
    try {
      const call = () => action === "save" ? store.save({ ...v, nextOffset: 32 }, saved.seal, controller.signal) : store.remove(v.rootId, saved.seal, controller.signal);
      if (failure === "abort") expect(call).toThrowError(StoreOperationAborted);
      else expect(call).toThrowError(expect.objectContaining({ code: "DATABASE_ACCESS_FAILED" }));
    } finally { db.prepare = prepare; db.exec = exec; }
    expect(db.isTransaction).toBe(false); expect(snapshot(db)).toEqual(before);
  }
});

it("rejects invalid tokens/signals and pre-aborts without beginning a transaction", () => {
  const db = memory(), store = createDirectoryResumeStore(db, context), v = input(), before = snapshot(db);
  expect(() => store.save(v, "raw-token")).toThrow(); expect(() => store.remove(v.rootId, undefined as any)).toThrow();
  expect(() => store.save(v, null, new Proxy(new AbortController().signal, {}))).toThrowError(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
  expect(() => store.save(v, null, {} as any)).toThrowError(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
  const controller = new AbortController(); controller.abort();
  expect(() => store.save(v, null, controller.signal)).toThrowError(StoreOperationAborted);
  expect(() => store.remove(v.rootId, null, controller.signal)).toThrowError(StoreOperationAborted);
  expect(snapshot(db)).toEqual(before);
});

it("a second connection cannot save or delete an obsolete cursor", async () => {
  const data = join(temporaryDirectory(), "data"), c = await loadOrCreateIdentityContext(data), a = await openDatabase(data), b = await openDatabase(data);
  handles.add(a); handles.add(b); const first = createDirectoryResumeStore(a, c), second = createDirectoryResumeStore(b, c), v = input(0, c);
  const prior = first.save(v, null).cursor!;
  const next = second.save({ ...v, nextOffset: 32 }, prior.seal).cursor!;
  expect(first.save({ ...v, nextOffset: 48 }, prior.seal).status).toBe("stale");
  expect(first.remove(v.rootId, prior.seal).status).toBe("stale"); expect(first.read(v.rootId)).toEqual(next);
});

it("authenticated write wrapper can atomically invalidate while read-only use cannot mutate", async () => {
  const data = join(temporaryDirectory(), "data"), c = await loadOrCreateIdentityContext(data), db = await openDatabase(data); const v = input(0, c);
  const saved = createDirectoryResumeStore(db, c).save(v, null).cursor!; db.close();
  const before = readFileSync(join(data, "agentprof.sqlite"));
  await expect(withAuthenticatedStore(data, false, (d, ctx) => createDirectoryResumeStore(d, ctx).removeInTransaction(v.rootId, saved.seal))).rejects.toMatchObject({ code: "DATABASE_ACCESS_FAILED" });
  expect(readFileSync(join(data, "agentprof.sqlite"))).toEqual(before);
  const value = await withAuthenticatedStore(data, true, (d, ctx) => createDirectoryResumeStore(d, ctx).removeInTransaction(v.rootId, saved.seal));
  expect(value.status).toBe("committed");
});

it("refuses a corrupt over-cap catalogue rather than silently admitting one selected row", () => {
  const db = memory(), store = createDirectoryResumeStore(db, context);
  for (let n = 0; n < 64; n++) store.save(input(n), null);
  const record = store.read(input(0).rootId)!;
  db.prepare("INSERT INTO directory_batch_resume SELECT ?,provider,contract_version,key_id,root_fingerprint,membership_revision,capture_mode,census_count,census_fingerprint,next_offset,prefix_fingerprint,seal FROM directory_batch_resume LIMIT 1").run(input(64).rootId);
  const before = snapshot(db);
  expect(() => store.read(record.rootId)).toThrowError(expect.objectContaining({ code: "DATABASE_ACCESS_FAILED" }));
  expect(() => store.remove(record.rootId, record.seal)).toThrowError(expect.objectContaining({ code: "DATABASE_ACCESS_FAILED" }));
  expect(snapshot(db)).toEqual(before);
});
