import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "../src/db/database.js";
import { createSourceStore } from "../src/db/source-store.js";
import type { SourceSnapshotInput, StoredSource, SourceCacheToken } from "../src/db/source-store.js";
import { encodeRelationships, MAX_SOURCE_RELATIONSHIP_BYTES, relationshipFingerprint } from "../src/db/source-relationship-validation.js";
import type { RelationshipEvidence } from "../src/db/source-relationship-validation.js";
import { createIdentityContext } from "../src/normalize/identity.js";
import { createCodexAdapter } from "../src/parsers/codex/index.js";
import { createClaudeAdapter } from "../src/parsers/claude/index.js";
import { HEADER_FIELDS } from "../src/db/source-validation.js";

const context = createIdentityContext(Buffer.alloc(32, 91), "d".repeat(32));
const id = (domain: "source" | "session" | "event" | "content", value: string | number) => context.fingerprint(domain, ["relationship-test", value]);
const dbs: DatabaseSync[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });
function memory() { const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true }); migrate(db); dbs.push(db); return db; }
function input(provider: "codex" | "claude" = "codex"): SourceSnapshotInput {
  const s = provider === "codex" ? createCodexAdapter(context).snapshot() : createClaudeAdapter(context).snapshot();
  return { sourceId: id("source", provider), provider, parserVersion: 1, normalizationVersion: 1, keyVersion: 1, keyId: context.keyId, completedOffset: 1, observedSize: 1, boundaryFingerprint: id("content", "boundary"), events: [],
    evidence: { turns: s.turns, usage: s.usage, observations: s.observations, diagnostics: s.diagnostics, capabilities: s.capabilities }, cacheEvidence: { contractVersion: 1, contentFingerprint: id("content", "file") } };
}
function captured(v: SourceSnapshotInput): RelationshipEvidence {
  const sourceRef = { fileId: v.sourceId, byteOffset: 0 }, sessionId = id("session", "root");
  return v.provider === "codex" ? { contractVersion: 1, capturePolicyVersion: 1, status: "captured", provider: "codex", metadata: [{ id: id("source", "metadata"), ownerSessionId: sessionId, declaredSessionId: id("session", "declared"), versionFingerprint: id("source", "version"), forkParentId: id("session", "absent-parent"), origin: "ambiguous", sourceRef }],
    wrappers: [{ id: id("event", "wrapper"), sessionId, kind: "code_wrapper", callSeen: true, resultSeen: true, relationship: "trusted_fixture", childEventIds: [id("event", "absent-child")], sourceRef }] }
    : { contractVersion: 1, capturePolicyVersion: 1, status: "captured", provider: "claude", metadata: [{ id: id("source", "metadata"), ownerRootSessionId: sessionId, declaredRootSessionId: null, sessionId: null, agentId: null, isSidechain: null, versionFingerprint: null, declarationFingerprint: null, origin: "trusted_copied", sourceRef }],
      messages: [{ id: id("event", "message"), sessionId, kind: "user", parentMessageId: id("event", "parent"), sourceToolAssistantMessageId: id("event", "assistant"), responseId: null, conflicted: true, sourceRef }] };
}
function token(s: StoredSource): SourceCacheToken { return { ...Object.fromEntries(HEADER_FIELDS.map(k => [k, s[k]])), revision: s.revision, cacheEvidence: s.cacheEvidence!, relationshipFingerprint: relationshipFingerprint(s.relationshipEvidence)! } as SourceCacheToken; }
const tables = ["settings", "source_store_identity", "source_event_headers", "source_event_contributions", "source_metric_headers", "source_metric_contributions", "source_cache_evidence", "source_relationship_headers", "source_relationship_contributions"];
function rows(db: DatabaseSync) { return Object.fromEntries(tables.map(t => [t, db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()])); }
function snapshot(v = input()): SourceSnapshotInput { return { ...v, relationshipEvidence: captured(v) }; }

it.each(["codex", "claude"] as const)("round trips exact %s relationship observations including dangling nodes and immutable arrays", provider => {
  const db = memory(), store = createSourceStore(db, context.keyId), v = snapshot(input(provider));
  expect(store.replaceSourceSnapshot(v, null)).toEqual({ status: "committed", revision: 1 });
  const s = store.readSource(v.sourceId)!;
  expect(s.relationshipEvidence).toEqual(v.relationshipEvidence); expect(s.evidence).toEqual(v.evidence); expect(s.events).toEqual(v.events);
  expect(Object.isFrozen(s.relationshipEvidence)).toBe(true);
  if (s.relationshipEvidence?.status === "captured") { expect(Object.isFrozen(s.relationshipEvidence.metadata)).toBe(true); expect(Object.isFrozen(s.relationshipEvidence.metadata[0])).toBe(true); }
  expect(store.confirmUnchangedSource(token(s)).status).toBe("unchanged");
});
it("keeps historical null, captured empty and unavailable distinct", () => {
  const db = memory(), store = createSourceStore(db, context.keyId), v = input(); store.replaceSourceSnapshot(v, null);
  expect(store.readSource(v.sourceId)!.relationshipEvidence).toBeNull();
  const empty = { contractVersion: 1, capturePolicyVersion: 1, status: "captured", provider: "codex", metadata: [], wrappers: [] } as const;
  store.replaceSourceSnapshot({ ...v, relationshipEvidence: empty }, 1); expect(store.readSource(v.sourceId)!.relationshipEvidence).toEqual(empty);
  const unavailable = { contractVersion: 1, capturePolicyVersion: 1, status: "unavailable", provider: "codex", reason: "relationship_budget_exceeded" } as const;
  store.replaceSourceSnapshot({ ...v, relationshipEvidence: unavailable }, 2); const s = store.readSource(v.sourceId)!;
  expect(s.relationshipEvidence).toEqual(unavailable); expect(store.confirmUnchangedSource(token(s)).status).toBe("unchanged");
  expect(db.prepare("SELECT * FROM source_relationship_contributions").all()).toEqual([]);
});
it("clears relationships on missing snapshot input and legacy replacement, retains on markUnavailable", () => {
  const db = memory(), store = createSourceStore(db, context.keyId), v = snapshot(); store.replaceSourceSnapshot(v, null);
  const before = store.readSource(v.sourceId)!; store.markUnavailable(v.sourceId, 1);
  expect(store.readSource(v.sourceId)).toEqual({ ...before, revision: 2, availability: "unavailable", cacheEvidence: null });
  const { relationshipEvidence: _r, ...without } = v; store.replaceSourceSnapshot(without, 2); expect(store.readSource(v.sourceId)!.relationshipEvidence).toBeNull();
  store.replaceSourceSnapshot(v, 3); const { evidence: _e, cacheEvidence: _c, ...legacy } = without; store.replaceSource(legacy, 4);
  expect(store.readSource(v.sourceId)).toMatchObject({ evidence: null, relationshipEvidence: null, cacheEvidence: null });
});
it.each([false, true])("atomically rolls back SQL failure and cancellation including first key binding (existing=%s)", existing => {
  const db = memory(), store = createSourceStore(db, context.keyId), v = snapshot(); if (existing) store.replaceSourceSnapshot(v, null);
  const before = rows(db), expected = existing ? 1 : null;
  db.exec("CREATE TRIGGER fail_relationship BEFORE INSERT ON source_relationship_contributions BEGIN SELECT RAISE(ABORT,'PRIVATE_SENTINEL'); END");
  expect(() => store.replaceSourceSnapshot(v, expected)).toThrowError(expect.objectContaining({ code: "DATABASE_TRANSACTION_FAILED" })); expect(rows(db)).toEqual(before);
  db.exec("DROP TRIGGER fail_relationship"); const abort = new AbortController(); db.function("cancel_relationship", () => { abort.abort(); return 0; });
  db.exec("CREATE TRIGGER cancel_relationship AFTER INSERT ON source_relationship_contributions BEGIN SELECT cancel_relationship(); END");
  expect(store.replaceSourceSnapshot(v, expected, abort.signal)).toEqual({ status: "aborted" }); expect(rows(db)).toEqual(before);
});
it("retains original CAS and independent same-ID source contributions", () => {
  const db = memory(), store = createSourceStore(db, context.keyId), v = snapshot(); store.replaceSourceSnapshot(v, null); const before = rows(db);
  expect(store.replaceSourceSnapshot(v, null)).toEqual({ status: "stale", actualRevision: 1 }); expect(rows(db)).toEqual(before);
  const other = { ...input(), sourceId: id("source", "other") }; store.replaceSourceSnapshot(snapshot(other), null);
  expect(store.readSource(v.sourceId)!.relationshipEvidence).not.toBeNull(); expect(store.readSource(other.sourceId)!.relationshipEvidence).not.toBeNull();
});

const malformed: [string, (x: any) => void][] = [
  ["extra root", x => x.extra = true], ["wrong provider", x => x.provider = "claude"], ["future contract", x => x.contractVersion = 2], ["write policy mismatch", x => x.capturePolicyVersion = 2],
  ["wrong metadata domain", x => x.metadata[0].id = id("event", "metadata")], ["wrong key", x => x.metadata[0].ownerSessionId = x.metadata[0].ownerSessionId.replace(context.keyId, "a".repeat(32))],
  ["wrong source", x => x.metadata[0].sourceRef.fileId = id("source", "other")], ["offset boundary", x => x.metadata[0].sourceRef.byteOffset = 1], ["negative offset", x => x.metadata[0].sourceRef.byteOffset = -1],
  ["extra row field", x => x.metadata[0].raw = "PRIVATE_SENTINEL"], ["raw declaration", x => x.metadata[0].declaredSessionId = "PRIVATE_SENTINEL"], ["invalid origin", x => x.metadata[0].origin = "inferred"],
  ["wrapper boolean", x => x.wrappers[0].callSeen = 1], ["wrapper kind", x => x.wrappers[0].kind = "execution"], ["wrapper relationship", x => x.wrappers[0].relationship = "inferred"],
  ["child domain", x => x.wrappers[0].childEventIds[0] = id("session", "child")], ["duplicate child", x => x.wrappers[0].childEventIds.push(x.wrappers[0].childEventIds[0])],
  ["duplicate metadata", x => x.metadata.push(x.metadata[0])], ["duplicate wrapper", x => x.wrappers.push(x.wrappers[0])], ["symbol", x => x[Symbol("secret")] = true],
  ["toJSON", x => x.toJSON = () => ({})], ["prototype", x => Object.setPrototypeOf(x.metadata[0], { raw: true })], ["array extra", x => x.metadata.extra = true], ["array hole", x => delete x.metadata[0]],
];
it.each(malformed)("rejects %s without storing it", (_name, mutate) => {
  const db = memory(), store = createSourceStore(db, context.keyId), v = snapshot(), e = structuredClone(v.relationshipEvidence); mutate(e);
  const before = rows(db); expect(() => store.replaceSourceSnapshot({ ...v, relationshipEvidence: e }, null)).toThrowError(expect.objectContaining({ code: "INVALID_RECORD" })); expect(rows(db)).toEqual(before);
});
it.each(["status", "metadata", "row", "array", "child"])("rejects %s accessors without invoking them", target => {
  const v = snapshot(), e = structuredClone(v.relationshipEvidence) as any; let calls = 0;
  const [o, k] = target === "status" ? [e, "status"] : target === "metadata" ? [e, "metadata"] : target === "row" ? [e.metadata[0], "id"] : target === "child" ? [e.wrappers[0], "childEventIds"] : [e.metadata, "0"];
  Object.defineProperty(o, k, { get() { calls++; return "PRIVATE_SENTINEL"; }, enumerable: true });
  expect(() => encodeRelationships(e, v)).toThrow(); expect(calls).toBe(0);
});
it.each(["metadata count", "wrapper count", "wrapper links", "row bytes", "total bytes", "message count", "message edges"])("records complete unavailability for %s without rejecting accepted old evidence", kind => {
  const db = memory(), store = createSourceStore(db, context.keyId), v = input(kind.startsWith("message") ? "claude" : "codex"), e = structuredClone(captured(v)) as any;
  if (kind === "metadata count") e.metadata = Array.from({ length: 8193 }, (_, i) => ({ ...e.metadata[0], id: id("source", i) }));
  if (kind === "wrapper count") e.wrappers = Array.from({ length: 4097 }, (_, i) => ({ ...e.wrappers[0], id: id("event", i), childEventIds: [] }));
  if (kind === "wrapper links") e.wrappers[0].childEventIds = Array.from({ length: 1025 }, (_, i) => id("event", i));
  if (kind === "row bytes") e.wrappers[0].childEventIds = Array.from({ length: 1024 }, (_, i) => id("event", i));
  if (kind === "total bytes") e.metadata = Array.from({ length: 8192 }, (_, i) => ({ ...e.metadata[0], id: id("source", i) }));
  if (kind === "message count") e.messages = Array.from({ length: 8193 }, (_, i) => ({ ...e.messages[0], id: id("event", i), parentMessageId: null, sourceToolAssistantMessageId: null }));
  if (kind === "message edges") e.messages = Array.from({ length: 4097 }, (_, i) => ({ ...e.messages[0], id: id("event", i) }));
  expect(store.replaceSourceSnapshot({ ...v, relationshipEvidence: e }, null)).toEqual({ status: "committed", revision: 1 });
  const s = store.readSource(v.sourceId)!; expect(s.relationshipEvidence).toEqual({ contractVersion: 1, capturePolicyVersion: 1, status: "unavailable", provider: v.provider, reason: "relationship_budget_exceeded" });
  expect(s.evidence).toEqual(v.evidence); expect(s.events).toEqual(v.events); expect(db.prepare("SELECT count(*) AS n FROM source_relationship_contributions").get()).toEqual({ n: 0 });
  expect(store.confirmUnchangedSource(token(s)).status).toBe("unchanged");
});

const corruptions = [
  "UPDATE source_relationship_headers SET metadata_count=0", "UPDATE source_relationship_headers SET relationship_bytes=relationship_bytes+1",
  "UPDATE source_relationship_headers SET capture_policy_version=0", "UPDATE source_relationship_headers SET contract_version=2", "UPDATE source_relationship_headers SET status='other'",
  "UPDATE source_relationship_headers SET reason='PRIVATE_SENTINEL'", "UPDATE source_relationship_headers SET status='unavailable',reason='relationship_budget_exceeded'",
  "DELETE FROM source_relationship_headers", "UPDATE source_relationship_contributions SET ordinal=7 WHERE kind='metadata'", "UPDATE source_relationship_contributions SET kind='message' WHERE kind='wrapper'",
  "UPDATE source_relationship_contributions SET row_id='private' WHERE kind='metadata'", "UPDATE source_relationship_contributions SET row_json='{}' WHERE kind='metadata'",
];
it.each(corruptions)("fails safely for relationship corruption: %s", sql => {
  const db = memory(), store = createSourceStore(db, context.keyId), v = snapshot(); store.replaceSourceSnapshot(v, null); const t = token(store.readSource(v.sourceId)!);
  db.exec("PRAGMA ignore_check_constraints=ON; PRAGMA foreign_keys=OFF"); db.exec(sql);
  expect(() => store.readSource(v.sourceId)).toThrowError(expect.objectContaining({ code: "DATABASE_ACCESS_FAILED" })); expect(db.isTransaction).toBe(false);
  expect(() => store.confirmUnchangedSource(t)).toThrowError(expect.objectContaining({ code: "DATABASE_ACCESS_FAILED" })); expect(db.isTransaction).toBe(false);
});
it("binds valid relationships to the candidate even when a corrupt writer leaves revision unchanged", () => {
  const db = memory(), store = createSourceStore(db, context.keyId), v = snapshot(); store.replaceSourceSnapshot(v, null); const t = token(store.readSource(v.sourceId)!);
  db.exec("UPDATE source_relationship_headers SET capture_policy_version=2");
  expect(store.readSource(v.sourceId)!.relationshipEvidence?.capturePolicyVersion).toBe(2);
  expect(() => store.confirmUnchangedSource(t)).toThrowError(expect.objectContaining({ code: "DATABASE_ACCESS_FAILED" }));
});
it.each(["bytes", "count", "id", "kind", "duplicate header"])("preflights hostile %s before ordered payload consumption", corruption => {
  const db = memory(), store = createSourceStore(db, context.keyId), v = snapshot(); store.replaceSourceSnapshot(v, null);
  db.exec("PRAGMA foreign_keys=OFF; PRAGMA ignore_check_constraints=ON");
  if (corruption === "bytes") db.prepare("UPDATE source_relationship_contributions SET row_json=? WHERE kind='metadata'").run(" ".repeat(MAX_SOURCE_RELATIONSHIP_BYTES + 1));
  if (corruption === "id") db.prepare("UPDATE source_relationship_contributions SET row_id=? WHERE kind='metadata'").run("x".repeat(129));
  if (corruption === "kind") db.exec("UPDATE source_relationship_contributions SET kind='unknown_unknown' WHERE kind='metadata'");
  if (corruption === "duplicate header") db.exec("ALTER TABLE source_relationship_headers RENAME TO old_header; CREATE TABLE source_relationship_headers AS SELECT * FROM old_header; INSERT INTO source_relationship_headers SELECT * FROM old_header");
  if (corruption === "count") db.exec("ALTER TABLE source_relationship_contributions RENAME TO old_rows; CREATE TABLE source_relationship_contributions AS SELECT * FROM old_rows; INSERT INTO source_relationship_contributions SELECT * FROM old_rows");
  const prepare = db.prepare.bind(db); let consumed = false;
  db.prepare = ((sql: string) => { if (sql.includes("SELECT kind,ordinal,row_id,row_json")) consumed = true; return prepare(sql); }) as typeof db.prepare;
  expect(() => store.readSource(v.sourceId)).toThrow(); expect(consumed).toBe(false); expect(db.isTransaction).toBe(false); db.prepare = prepare;
});
it("closes ordered cursor on corrupt row and preserves caller-owned transaction", () => {
  const db = memory(), store = createSourceStore(db, context.keyId), v = snapshot(); store.replaceSourceSnapshot(v, null);
  const old = db.prepare("SELECT row_json FROM source_relationship_contributions WHERE kind='metadata'").get()!["row_json"] as string;
  const changed = old.replace('"ambiguous"', '"bad_value"'); expect(Buffer.byteLength(changed)).toBe(Buffer.byteLength(old));
  db.prepare("UPDATE source_relationship_contributions SET row_json=? WHERE kind='metadata'").run(changed);
  db.exec("CREATE TABLE caller(x); BEGIN; INSERT INTO caller VALUES(7)");
  expect(() => store.readSource(v.sourceId)).toThrow(); expect(db.isTransaction).toBe(true); db.exec("COMMIT");
  expect(db.prepare("SELECT * FROM caller").all()).toEqual([{ x: 7 }]); db.exec("DROP TABLE source_relationship_contributions");
});

it("captures the inclusive aggregate link ceiling and makes one excess link unavailable", () => {
  const v = input(), e = structuredClone(captured(v)) as any;
  e.wrappers = [0, 1].map(n => ({ ...e.wrappers[0], id: id("event", `wrapper-${n}`), childEventIds: Array.from({ length: 512 }, (_, i) => id("event", n * 512 + i)) }));
  expect(encodeRelationships(e, v)?.evidence.status).toBe("captured");
  e.wrappers[1].childEventIds.push(id("event", 1024)); expect(encodeRelationships(e, v)?.evidence.status).toBe("unavailable");
});
it.each(["message domain", "response domain", "nullable bool", "nullable identity", "declaration", "conflicted", "extra"])("rejects malformed Claude %s", change => {
  const v = input("claude"), e = structuredClone(captured(v)) as any;
  if (change === "message domain") e.messages[0].id = id("source", "bad");
  if (change === "response domain") e.messages[0].responseId = id("session", "bad");
  if (change === "nullable bool") e.metadata[0].isSidechain = 1;
  if (change === "nullable identity") e.metadata[0].agentId = "raw-agent";
  if (change === "declaration") e.metadata[0].declarationFingerprint = id("source", "bad");
  if (change === "conflicted") e.messages[0].conflicted = "true";
  if (change === "extra") e.messages[0].rawMessage = "PRIVATE_SENTINEL";
  expect(() => encodeRelationships(e, v)).toThrowError(expect.objectContaining({ code: "INVALID_RECORD" }));
});
it("rejects a valid-shape substituted graph with the same revision at final confirmation", () => {
  const db = memory(), store = createSourceStore(db, context.keyId), v = snapshot(); store.replaceSourceSnapshot(v, null); const t = token(store.readSource(v.sourceId)!);
  const old = db.prepare("SELECT row_json FROM source_relationship_contributions WHERE kind='wrapper'").get()!["row_json"] as string;
  const changed = old.replace(id("event", "absent-child"), id("event", "substituted-child")); expect(changed.length).toBe(old.length);
  db.prepare("UPDATE source_relationship_contributions SET row_json=? WHERE kind='wrapper'").run(changed);
  expect(store.readSource(v.sourceId)!.revision).toBe(1);
  expect(() => store.confirmUnchangedSource(t)).toThrowError(expect.objectContaining({ code: "DATABASE_ACCESS_FAILED" }));
});
