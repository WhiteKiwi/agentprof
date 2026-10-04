import { appendFile, copyFile, mkdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db/database.js";
import { createIdentityContext } from "../src/normalize/identity.js";
import { createSourceStore } from "../src/db/source-store.js";
import { createDirectoryMembershipStore } from "../src/db/directory-membership.js";
import { retireDirectoryAbsences } from "../src/db/directory-retirement.js";
import { enrollDirectory } from "../src/scanner/directory-enrollment.js";
import { reconcileDirectoryAbsence } from "../src/scanner/directory-reconciliation.js";
import * as census from "../src/scanner/directory-census.js";
import { temporaryDirectory } from "./helpers.js";
vi.mock("../src/scanner/directory-census.js", async original => ({ ...await original<typeof import("../src/scanner/directory-census.js")>() }));

const context = createIdentityContext(Buffer.alloc(32, 92), "b".repeat(32));
const open = new Set<DatabaseSync>();
afterEach(() => { vi.restoreAllMocks(); for (const db of open) db.close(); open.clear(); });
const fixturePath = (provider: string) => fileURLToPath(new URL(`./fixtures/providers/${provider}-real-shapes.jsonl`, import.meta.url));
async function fixture(provider: "codex" | "claude" = "codex", count = 1) {
  const base = temporaryDirectory(), root = { provider, path: join(base, "FICTITIOUS_ROOT") }, data = join(base, "private");
  await mkdir(root.path); const files: string[] = [];
  for (let i = 0; i < count; i++) { const path = join(root.path, `FICTITIOUS_LEAF_${i}.jsonl`); await copyFile(fixturePath(provider), path); files.push(path); }
  const db = await openDatabase(data); open.add(db);
  const sources = createSourceStore(db, context.keyId), memberships = createDirectoryMembershipStore(db, context);
  const rootId = context.fingerprint("source", ["directory_root_v1", provider, root.path]);
  const initial = await enrollDirectory(db, context, root);
  const ids = files.map(file => context.fingerprint("source", [provider, file]));
  return { db, sources, memberships, rootId, root, files, ids, initial, data };
}
function rows(db: DatabaseSync) {
  return ["source_event_headers", "source_event_contributions", "source_metric_headers", "source_metric_contributions", "source_cache_evidence", "source_parser_checkpoints", "source_relationship_headers", "source_relationship_contributions", "directory_membership_roots", "directory_membership_members"]
    .map(t => db.prepare(`SELECT * FROM ${t} ORDER BY 1,2`).all());
}
async function missing(f: Awaited<ReturnType<typeof fixture>>) {
  for (const file of f.files) await rm(file);
  return enrollDirectory(f.db, context, f.root);
}
function proof(f: Awaited<ReturnType<typeof fixture>>) {
  const m = f.memberships.read(f.rootId)!;
  return { rootId: m.rootId, provider: m.provider, rootFingerprint: m.rootFingerprint, membershipRevision: m.revision,
    observedSourceIds: m.members.filter(x => x.observation === "observed").map(x => x.sourceId) };
}

it.each(["codex", "claude"] as const)("retires absent %s history, repeats without writes, then restores through real enrollment", async provider => {
  const f = await fixture(provider), prior = f.sources.readSource(f.ids[0]!)!, receipt = await missing(f);
  const beforeMembership = f.memberships.read(f.rootId);
  const result = await reconcileDirectoryAbsence(f.db, context, f.root, receipt);
  expect(result).toMatchObject({ status: "completed", checkedRoots: 1, inferredMoves: false, retainedPayloads: true,
    counts: { missing: 1, markedUnavailable: 1, retained: 0, alreadyUnavailable: 0 } });
  const retired = f.sources.readSource(f.ids[0]!)!;
  expect(retired).toMatchObject({ availability: "unavailable", revision: 2, cacheEvidence: null });
  expect(retired.events).toEqual(prior.events); expect(retired.evidence).toEqual(prior.evidence); expect(retired.relationshipEvidence).toEqual(prior.relationshipEvidence);
  expect(f.db.prepare("SELECT 1 FROM source_parser_checkpoints").get()).toBeUndefined();
  expect(f.memberships.read(f.rootId)).toEqual(beforeMembership);
  const frozen = rows(f.db), again = await reconcileDirectoryAbsence(f.db, context, f.root, receipt);
  expect(again.counts).toMatchObject({ markedUnavailable: 0, alreadyUnavailable: 1 }); expect(rows(f.db)).toEqual(frozen);
  await copyFile(fixturePath(provider), f.files[0]!); const restored = await enrollDirectory(f.db, context, f.root);
  expect(f.sources.readSource(f.ids[0]!)).toMatchObject({ availability: "available", revision: 3 });
  expect((await reconcileDirectoryAbsence(f.db, context, f.root, restored)).counts?.missing).toBe(0);
  expect(JSON.stringify(result)).not.toMatch(/FICTITIOUS_|rootFingerprint|seal|private/);
});

it.each(["codex", "claude"] as const)("collects a renamed %s path without claiming a move relationship", async provider => {
  const f = await fixture(provider), next = join(f.root.path, "renamed.jsonl"); await rename(f.files[0]!, next);
  const enrolled = await enrollDirectory(f.db, context, f.root), r = await reconcileDirectoryAbsence(f.db, context, f.root, enrolled);
  expect(r.counts?.markedUnavailable).toBe(1); expect(r.inferredMoves).toBe(false);
  expect(f.sources.readSource(f.ids[0]!)!.availability).toBe("unavailable");
  const newId = context.fingerprint("source", [provider, next]); expect(newId).not.toBe(f.ids[0]);
  expect(f.sources.readSource(newId)!.availability).toBe("available");
});

it("retains a missing source observed by another root until that root is explicitly rescanned", async () => {
  const f = await fixture("codex", 0), child = { provider: "codex" as const, path: join(f.root.path, "nested") };
  await mkdir(child.path); const file = join(child.path, "session.jsonl"); await copyFile(fixturePath("codex"), file);
  const enrolledChild = await enrollDirectory(f.db, context, child); await enrollDirectory(f.db, context, f.root);
  const id = context.fingerprint("source", ["codex", file]); await rm(file);
  const parentMissing = await enrollDirectory(f.db, context, f.root);
  const r = await reconcileDirectoryAbsence(f.db, context, f.root, parentMissing);
  expect(r).toMatchObject({ status: "partial", checkedRoots: 2, counts: { retained: 1, markedUnavailable: 0 } });
  expect(r.entries[0]).toMatchObject({ reason: "other_root_observed", blockingRoots: 1 }); expect(f.sources.readSource(id)!.availability).toBe("available");
  await enrollDirectory(f.db, context, child);
  expect((await reconcileDirectoryAbsence(f.db, context, f.root, parentMissing)).counts?.markedUnavailable).toBe(1);
  expect((await reconcileDirectoryAbsence(f.db, context, child, enrolledChild)).status).toBe("stale");
});

it("retains independently rewritten missing generations rather than retiring a newer revision", async () => {
  const f = await fixture(), source = f.sources.readSource(f.ids[0]!)!, receipt = await missing(f);
  const { sourceId, provider, parserVersion, normalizationVersion, keyVersion, keyId, completedOffset, observedSize, boundaryFingerprint, events } = source;
  f.sources.replaceSource({ sourceId, provider, parserVersion, normalizationVersion, keyVersion, keyId, completedOffset, observedSize, boundaryFingerprint, events }, source.revision);
  const before = rows(f.db), r = await reconcileDirectoryAbsence(f.db, context, f.root, receipt);
  expect(r.entries[0]).toMatchObject({ status: "retained", reason: "source_changed", revisionAfter: 2 }); expect(rows(f.db)).toEqual(before);
});

it.each(["missing_root", "replaced_root", "symlink", "compressed", "new_file", "reappeared", "65_files"])("refuses %s after enrollment without retiring sources", async mode => {
  const f = await fixture(), receipt = await missing(f), before = rows(f.db);
  if (mode === "missing_root") await rm(f.root.path, { recursive: true });
  if (mode === "replaced_root") { await rename(f.root.path, f.root.path + "-old"); await mkdir(f.root.path); }
  if (mode === "symlink") await symlink(f.root.path, join(f.root.path, "alias"));
  if (mode === "compressed") await writeFile(join(f.root.path, "unknown.jsonl.gz"), "");
  if (mode === "new_file") await writeFile(join(f.root.path, "new.jsonl"), "");
  if (mode === "reappeared") await copyFile(fixturePath("codex"), f.files[0]!);
  if (mode === "65_files") for (let i = 0; i < 65; i++) await writeFile(join(f.root.path, `extra${i}.jsonl`), "");
  const r = await reconcileDirectoryAbsence(f.db, context, f.root, receipt);
  expect(["ineligible", "stale"]).toContain(r.status); expect(r.counts).toBeNull(); expect(rows(f.db)).toEqual(before);
});

it("rejects changed membership and observed-source revisions before any missing retirement", async () => {
  const f = await fixture("codex", 2); await rm(f.files[0]!); const receipt = await enrollDirectory(f.db, context, f.root);
  const expected = proof(f); f.sources.markUnavailable(f.ids[1]!, 1); const before = rows(f.db);
  expect(retireDirectoryAbsences(f.db, context, expected)).toMatchObject({ status: "stale", reason: "source_changed" }); expect(rows(f.db)).toEqual(before);
  await copyFile(fixturePath("codex"), f.files[0]!); await enrollDirectory(f.db, context, f.root);
  expect((await reconcileDirectoryAbsence(f.db, context, f.root, receipt)).reason).toBe("membership_changed");
});

it("detects a real file added between the two final census reads", async () => {
  const f = await fixture(), receipt = await missing(f), before = rows(f.db), original = census.censusDirectory;
  let called = 0;
  vi.spyOn(census, "censusDirectory").mockImplementation(async (...args) => { const r = await original(...args); if (++called === 1) await writeFile(join(f.root.path, "new.jsonl"), ""); return r; });
  expect((await reconcileDirectoryAbsence(f.db, context, f.root, receipt)).reason).toBe("census_changed"); expect(rows(f.db)).toEqual(before);
});

it("rolls the entire retirement batch back on a later SQL failure", async () => {
  const f = await fixture("codex", 3); await missing(f); const expected = proof(f), ids = [...f.ids].sort();
  f.db.exec(`CREATE TRIGGER fail_retirement BEFORE UPDATE ON source_event_headers WHEN NEW.source_id='${ids[1]}' BEGIN SELECT RAISE(ABORT,'FICTITIOUS_SQL_FAILURE'); END`);
  const before = rows(f.db); expect(() => retireDirectoryAbsences(f.db, context, expected)).toThrow(); expect(rows(f.db)).toEqual(before); expect(f.db.isTransaction).toBe(false);
});

it("rolls back an abort injected immediately after one actual SQLite write", async () => {
  const f = await fixture("codex", 2); await missing(f); const before = rows(f.db), controller = new AbortController();
  const prepare = f.db.prepare.bind(f.db);
  vi.spyOn(f.db, "prepare").mockImplementation(sql => {
    const statement = prepare(sql);
    if (sql.startsWith("UPDATE source_event_headers SET availability")) {
      const run = statement.run.bind(statement);
      vi.spyOn(statement, "run").mockImplementation((...args) => { const written = run(...args); controller.abort(); return written; });
    }
    return statement;
  });
  expect(retireDirectoryAbsences(f.db, context, proof(f), controller.signal)).toMatchObject({ status: "aborted", counts: null, entries: [] });
  expect(rows(f.db)).toEqual(before); expect(f.db.isTransaction).toBe(false);
});

it.each(["seal", "missing_member", "orphan", "checkpoint", "payload"])("rejects corrupt %s without any retirement", async kind => {
  const f = await fixture("codex", 2); await missing(f);
  if (kind === "seal") f.db.prepare("UPDATE directory_membership_roots SET seal=?").run(context.fingerprint("content", ["wrong-seal"]));
  if (kind === "missing_member") f.db.prepare("DELETE FROM directory_membership_members WHERE source_id=?").run(f.ids[1]!);
  if (kind === "orphan") { f.db.exec("PRAGMA foreign_keys=OFF"); f.db.prepare("INSERT INTO directory_membership_members(root_id,source_id,source_revision,observation) VALUES(?,?,1,'observed')").run(context.fingerprint("source", ["orphan"]), f.ids[0]!); f.db.exec("PRAGMA foreign_keys=ON"); }
  if (kind === "checkpoint") f.db.prepare("UPDATE source_parser_checkpoints SET generation_seal=? WHERE source_id=?").run(context.fingerprint("source", ["wrong-seal"]), f.ids[1]!);
  if (kind === "payload") f.db.prepare("UPDATE source_event_contributions SET event_json='{}' WHERE source_id=?").run(f.ids[1]!);
  const before = rows(f.db), expected = { rootId: f.rootId, provider: f.root.provider, rootFingerprint: context.fingerprint("content", ["irrelevant"]), membershipRevision: 2, observedSourceIds: [] };
  // Derive the expected physical root from the header for corruption tests; the store still must authenticate it.
  expected.rootFingerprint = f.db.prepare("SELECT root_fingerprint FROM directory_membership_roots WHERE root_id=?").get(f.rootId)!.root_fingerprint as string;
  expect(() => retireDirectoryAbsences(f.db, context, expected)).toThrow(); expect(rows(f.db)).toEqual(before);
});

it("keeps transaction ownership explicit and preserves the original fresh ingestion API", async () => {
  const f = await fixture();
  expect(() => f.memberships.readAllForMutation()).toThrow(); expect(() => f.sources.readSourceForMutation(f.ids[0]!, context)).toThrow();
  expect(() => f.sources.markUnavailableInTransaction(f.ids[0]!, 1, context)).toThrow();
  f.db.exec("BEGIN IMMEDIATE");
  try {
    expect(f.memberships.readAllForMutation()).toHaveLength(1); expect(f.sources.readSourceForMutation(f.ids[0]!, context).source?.revision).toBe(1);
    expect(() => f.sources.readSourceForIngestion(f.ids[0]!, context)).toThrow(); expect(() => f.memberships.read(f.rootId)).toThrow();
    expect(() => retireDirectoryAbsences(f.db, context, { rootId: f.rootId, provider: "codex", rootFingerprint: context.fingerprint("content", [1]), membershipRevision: 1, observedSourceIds: [] })).toThrow();
  } finally { f.db.exec("ROLLBACK"); }
});

it("refuses over-budget catalogues instead of dropping other-root vetoes", async () => {
  const f = await fixture(), receipt = await missing(f); void receipt;
  for (let i = 0; i < 63; i++) f.memberships.capture({ rootId: context.fingerprint("source", ["empty-root", i]), provider: "codex", rootFingerprint: context.fingerprint("content", ["physical", i]), observed: [] }, null);
  expect(retireDirectoryAbsences(f.db, context, proof(f)).checkedRoots).toBe(64);
  f.memberships.capture({ rootId: context.fingerprint("source", ["one-too-many"]), provider: "codex", rootFingerprint: context.fingerprint("content", ["one-too-many"]), observed: [] }, null);
  const before = rows(f.db); expect(retireDirectoryAbsences(f.db, context, proof(f))).toMatchObject({ status: "ineligible", reason: "catalogue_limit", counts: null }); expect(rows(f.db)).toEqual(before);
});

it("preserves unchanged store bytes on wrong keys, invalid proof, and pre-aborted input", async () => {
  const f = await fixture(), receipt = await missing(f), expected = proof(f), before = rows(f.db);
  const bad = createIdentityContext(Buffer.alloc(32, 94), context.keyId);
  expect(() => retireDirectoryAbsences(f.db, bad, expected)).toThrow();
  for (const change of [{ observedSourceIds: [f.ids[0], f.ids[0]] }, { membershipRevision: 0 }, { extra: 1 }]) expect(() => retireDirectoryAbsences(f.db, context, { ...expected, ...change } as never)).toThrow();
  const getter = vi.fn(); expect(() => retireDirectoryAbsences(f.db, context, Object.defineProperty({ ...expected }, "rootId", { get: getter }) as never)).toThrow(); expect(getter).not.toHaveBeenCalled();
  const abort = new AbortController(); abort.abort(); expect((await reconcileDirectoryAbsence(f.db, context, f.root, receipt, abort.signal)).status).toBe("aborted");
  expect(rows(f.db)).toEqual(before);
});

it.each(["codex", "claude"] as const)("rejects an incomplete %s collection before retirement", async provider => {
  const f = await fixture(provider, 2); await rm(f.files[0]!); await appendFile(f.files[1]!, "\n");
  const r = await enrollDirectory(f.db, context, f.root), before = rows(f.db);
  expect((await reconcileDirectoryAbsence(f.db, context, f.root, r)).reason).toBe("enrollment_incomplete"); expect(rows(f.db)).toEqual(before);
});

it("refuses a final handle-close error before any source retirement", async () => {
  const f = await fixture(), receipt = await missing(f), before = rows(f.db), original = census.openDirectoryLease;
  let opens = 0;
  vi.spyOn(census, "openDirectoryLease").mockImplementation(async (...args) => {
    const lease = await original(...args);
    if (++opens !== 1) return lease;
    return Object.freeze({ ...lease, async close() { await lease.close(); throw new census.CensusFailure("access_failed"); } });
  });
  await expect(reconcileDirectoryAbsence(f.db, context, f.root, receipt)).rejects.toMatchObject({ code: "INPUT_ACCESS_FAILED" });
  expect(rows(f.db)).toEqual(before);
});

it("checks 4096 missing members and the 16384 membership-reference boundary without truncation", async () => {
  const f = await fixture("codex", 0);
  const template = { provider: "codex" as const, parserVersion: 1, normalizationVersion: 1 as const, keyVersion: 1 as const, keyId: context.keyId,
    completedOffset: 0, observedSize: 0, boundaryFingerprint: null, events: [] };
  const members = Array.from({ length: 4096 }, (_, i) => ({ sourceId: context.fingerprint("source", ["bounded-fixture", i]), sourceRevision: 1, observation: "not_observed" as const }))
    .sort((a,b) => a.sourceId < b.sourceId ? -1 : 1);
  for (const member of members) f.sources.replaceSource({ ...template, sourceId: member.sourceId }, null);
  function storeRoot(rootId: string, rootFingerprint: string, revision: number) {
    const manifest = members.map(m => [m.sourceId, m.sourceRevision, m.observation]);
    const seal = context.fingerprint("content", ["directory_membership_v1", 1, 1, rootId, "codex", context.keyId, rootFingerprint, revision, manifest]);
    f.db.prepare("INSERT OR REPLACE INTO directory_membership_roots(root_id,provider,contract_version,key_id,root_fingerprint,revision,member_count,manifest_bytes,seal) VALUES(?,'codex',1,?,?,?,?,?,?)")
      .run(rootId, context.keyId, rootFingerprint, revision, members.length, Buffer.byteLength(JSON.stringify(manifest)), seal);
    const insert = f.db.prepare("INSERT INTO directory_membership_members(root_id,source_id,source_revision,observation) VALUES(?,?,1,'not_observed')");
    f.db.exec("BEGIN IMMEDIATE"); try { for (const member of members) insert.run(rootId, member.sourceId); f.db.exec("COMMIT"); } catch(e) { f.db.exec("ROLLBACK"); throw e; }
  }
  const rootFingerprint = f.memberships.read(f.rootId)!.rootFingerprint;
  storeRoot(f.rootId, rootFingerprint, 2);
  const expected = proof(f), retired = retireDirectoryAbsences(f.db, context, expected);
  expect(retired.entries).toHaveLength(4096); expect(retired.counts?.markedUnavailable).toBe(4096);
  for (let i = 0; i < 3; i++) storeRoot(context.fingerprint("source", ["large-root", i]), context.fingerprint("content", ["large-root", i]), 1);
  expect(retireDirectoryAbsences(f.db, context, expected)).toMatchObject({ status: "completed", checkedRoots: 4, counts: { alreadyUnavailable: 4096 } });
  storeRoot(context.fingerprint("source", ["large-root", 3]), context.fingerprint("content", ["large-root", 3]), 1);
  const before = rows(f.db); expect(retireDirectoryAbsences(f.db, context, expected)).toMatchObject({ status: "ineligible", reason: "catalogue_limit", counts: null }); expect(rows(f.db)).toEqual(before);
}, 30000);
