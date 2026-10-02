import { DatabaseSync } from "node:sqlite";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../src/db/database.js";
import { createSourceStore } from "../src/db/source-store.js";
import type { SourceInput } from "../src/db/source-store.js";
import { MAX_SOURCE_EVENTS } from "../src/db/source-validation.js";
import { normalizeEvent } from "../src/normalize/event.js";
import { createIdentityContext } from "../src/normalize/identity.js";
import { createCodexAdapter } from "../src/parsers/codex/index.js";
import { createClaudeAdapter } from "../src/parsers/claude/index.js";
import { safeErrorEnvelope } from "../src/privacy/diagnostics.js";
import { readJsonLines } from "../src/scanner/jsonl.js";
import { temporaryDirectory } from "./helpers.js";

const context = createIdentityContext(new Uint8Array(32).fill(17), "1".repeat(32));
const sourceId = (name = "source-a", provider = "codex") => context.fingerprint("source", [provider, name]);
function contribution(name = "source-a", ids = ["event-a"], extra: Record<string, unknown> = {}): SourceInput {
  const events = ids.map((id, i) => normalizeEvent({ provider: "codex", eventIdentity: id, sessionIdentity: "synthetic-session", turnIdentity: "synthetic-turn",
    projectIdentity: "FICTITIOUS_PROJECT_SECRET", kind: "shell", toolName: "exec_command", command: "rg absent src", status: "completed", statusEvidence: "explicit", exitCode: 0,
    startAt: "2026-09-01T00:00:00.000Z", endAt: "2026-09-01T00:00:01.000Z", durationMs: 1000, timingEvidence: "source_reported", durationScope: "process_runtime",
    intervalTimingEvidence: "paired_timestamps", intervalScope: "item_lifecycle", sourceRef: { fileIdentity: name, byteOffset: i, recordType: "event_msg" }, ...extra }, context).event!);
  return { sourceId: sourceId(name), provider: "codex", parserVersion: 1, normalizationVersion: 1, keyVersion: 1, keyId: context.keyId,
    completedOffset: 10000, observedSize: 10003, boundaryFingerprint: context.fingerprint("content", ["synthetic-boundary", name, 10000]), events };
}
function memory() { const db = new DatabaseSync(":memory:"); migrate(db); return db; }
function createV1(db: DatabaseSync) {
  db.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY) STRICT; CREATE TABLE settings (key TEXT PRIMARY KEY CHECK(key IN ('normalization_version','key_version')), value INTEGER NOT NULL) STRICT; INSERT INTO schema_migrations VALUES (1); INSERT INTO settings VALUES ('normalization_version',1),('key_version',1); PRAGMA user_version = 1;");
}
function storedRows(db: DatabaseSync) {
  return { headers: db.prepare("SELECT * FROM source_event_headers ORDER BY source_id").all(), events: db.prepare("SELECT * FROM source_event_contributions ORDER BY source_id,event_id").all(), identity: db.prepare("SELECT * FROM source_store_identity").all() };
}

describe("source-store migration", () => {
  it("creates 0→4, upgrades 1→4 preserving settings and unrelated data, and reopens idempotently", () => {
    for (const existing of [false, true]) {
      const db = new DatabaseSync(":memory:");
      try {
        if (existing) createV1(db);
        db.exec("CREATE TABLE preserved (value INTEGER); INSERT INTO preserved VALUES (42)");
        migrate(db); migrate(db);
        expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 5 });
        expect(db.prepare("SELECT version FROM schema_migrations ORDER BY version").all()).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }]);
        expect(db.prepare("SELECT * FROM settings ORDER BY key").all()).toEqual([{ key: "key_version", value: 1 }, { key: "normalization_version", value: 1 }]);
        expect(db.prepare("SELECT value FROM preserved").get()).toEqual({ value: 42 });
      } finally { db.close(); }
    }
  });
  it.each([0, 1])("observes a peer-completed %i→4 migration after acquiring its lock", (version) => {
    const path = join(temporaryDirectory(), "interleaved.sqlite");
    const first = new DatabaseSync(path), peer = new DatabaseSync(path);
    const exec = first.exec.bind(first);
    let peerMigrations = 0;
    try {
      if (version === 1) createV1(first);
      first.exec("CREATE TABLE preserved (value INTEGER); INSERT INTO preserved VALUES (42)");
      // Interpose only this connection's lock acquisition; both connections execute real SQLite.
      first.exec = (sql) => {
        if (sql === "BEGIN IMMEDIATE" && peerMigrations === 0) {
          peerMigrations++;
          migrate(peer);
        }
        exec(sql);
      };
      let failureCode: string | null = null;
      try { migrate(first); } catch (error) { failureCode = safeErrorEnvelope(error).error.code; }
      expect(peerMigrations).toBe(1);
      for (const db of [first, peer]) {
        expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 5 });
        expect(db.prepare("SELECT version FROM schema_migrations ORDER BY version").all()).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }]);
        expect(db.prepare("SELECT * FROM settings ORDER BY key").all()).toEqual([{ key: "key_version", value: 1 }, { key: "normalization_version", value: 1 }]);
        expect(db.prepare("SELECT value FROM preserved").get()).toEqual({ value: 42 });
        expect(storedRows(db)).toEqual({ headers: [], events: [], identity: [] });
      }
      expect(failureCode).toBeNull();
    } finally { first.exec = exec; first.close(); peer.close(); }
  });
  it.each([0, 1, 5])("leaves caller-owned work active when schema %i migration cannot begin", (version) => {
    const db = new DatabaseSync(":memory:");
    try {
      if (version === 1) createV1(db);
      if (version === 5) migrate(db);
      db.exec("CREATE TABLE caller_owned (value INTEGER); BEGIN IMMEDIATE; INSERT INTO caller_owned VALUES (9)");
      const schema = db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY name").all();
      expect(() => migrate(db)).toThrowError(expect.objectContaining({ code: "DATABASE_MIGRATION_FAILED" }));
      expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: version });
      expect(db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY name").all()).toEqual(schema);
      db.exec("COMMIT");
      expect(db.prepare("SELECT value FROM caller_owned").get()).toEqual({ value: 9 });
    } finally { db.close(); }
  });
  it("rolls back failed 1→4 DDL and rejects unsupported settings, future or invalid versions", () => {
    const db = new DatabaseSync(":memory:");
    try {
      createV1(db);
      db.exec("CREATE TABLE source_event_contributions (sentinel INTEGER); INSERT INTO source_event_contributions VALUES (7)");
      expect(() => migrate(db)).toThrowError(expect.objectContaining({ code: "DATABASE_MIGRATION_FAILED" }));
      expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 1 });
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name='source_event_headers'").get()).toBeUndefined();
      expect(db.prepare("SELECT * FROM source_event_contributions").all()).toEqual([{ sentinel: 7 }]);
      db.exec("DROP TABLE source_event_contributions; UPDATE settings SET value=2 WHERE key='normalization_version'");
      expect(() => migrate(db)).toThrowError(expect.objectContaining({ code: "DATABASE_MIGRATION_FAILED" }));
      expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 1 });
      const schema = db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY name").all();
      const settings = db.prepare("SELECT * FROM settings ORDER BY key").all();
      db.exec("PRAGMA user_version = 99");
      expect(() => migrate(db)).toThrowError(expect.objectContaining({ code: "DATABASE_SCHEMA_TOO_NEW" }));
      expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 99 });
      expect(db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY name").all()).toEqual(schema);
      expect(db.prepare("SELECT * FROM settings ORDER BY key").all()).toEqual(settings);
      db.exec("BEGIN IMMEDIATE; COMMIT; PRAGMA user_version = -1");
      expect(() => migrate(db)).toThrowError(expect.objectContaining({ code: "DATABASE_MIGRATION_FAILED" }));
      expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: -1 });
      expect(db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY name").all()).toEqual(schema);
      expect(db.prepare("SELECT * FROM settings ORDER BY key").all()).toEqual(settings);
      db.exec("BEGIN IMMEDIATE; COMMIT");
    } finally { db.close(); }
  });
});

describe("atomic source contribution lifecycle", () => {
  it("persists pending→terminal updates/checkpoints together, orders readback, and reopens", async () => {
    const directory = join(temporaryDirectory(), "store");
    let db = await openDatabase(directory);
    const pending = contribution("source-a", ["event-b", "event-a"], { status: "pending" });
    try {
      const store = createSourceStore(db, context.keyId);
      expect(store.readSource(pending.sourceId)).toBeNull();
      expect(store.replaceSource(pending, null)).toEqual({ status: "committed", revision: 1 });
      const terminal = contribution("source-a", ["event-b", "event-a"]);
      expect(store.replaceSource({ ...terminal, completedOffset: 20000, observedSize: 20009 }, 1)).toEqual({ status: "committed", revision: 2 });
      const result = store.readSource(pending.sourceId)!;
      expect(result).toMatchObject({ revision: 2, completedOffset: 20000, observedSize: 20009, aggregationReady: false, parserResumeReady: false });
      expect(result.events).toEqual([...terminal.events].sort((a,b) => a.id.localeCompare(b.id)));
      db.close(); db = await openDatabase(directory);
      expect(createSourceStore(db, context.keyId).readSource(pending.sourceId)).toEqual(result);
      expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.events[0]!.sourceRef)).toBe(true);
    } finally { db.close(); }
  });
  it("rejects stale writers on separate connections without advancing any contribution or checkpoint", async () => {
    const directory = join(temporaryDirectory(), "store"), a = await openDatabase(directory), b = await openDatabase(directory);
    try {
      const one = createSourceStore(a, context.keyId), two = createSourceStore(b, context.keyId), input = contribution();
      expect(one.replaceSource(input, null)).toEqual({ status: "committed", revision: 1 });
      const staleRevision = two.readSource(input.sourceId)!.revision;
      expect(one.replaceSource({ ...input, completedOffset: 20000, observedSize: 20000 }, 1)).toEqual({ status: "committed", revision: 2 });
      const before = storedRows(a);
      expect(two.replaceSource({ ...input, events: [] }, staleRevision)).toEqual({ status: "stale", actualRevision: 2 });
      expect(two.replaceSource(input, null)).toEqual({ status: "stale", actualRevision: 2 });
      expect(storedRows(b)).toEqual(before);
    } finally { a.close(); b.close(); }
  });
  it("preserves canonical variants across sources and retains missing-source history until explicit replacement", () => {
    const db = memory();
    try {
      const store = createSourceStore(db, context.keyId), a = contribution("source-a"), b = contribution("source-b", ["event-a"], { status: "failed", exitCode: 2 });
      expect(a.events[0]!.id).toBe(b.events[0]!.id);
      store.replaceSource(a, null); store.replaceSource(b, null);
      expect(store.markUnavailable(a.sourceId, 1)).toEqual({ status: "committed", revision: 2 });
      expect(store.readSource(a.sourceId)).toMatchObject({ availability: "unavailable", events: a.events, completedOffset: a.completedOffset });
      expect(store.replaceSource({ ...a, parserVersion: 2, completedOffset: 0, observedSize: 0, boundaryFingerprint: null, events: [] }, 2)).toEqual({ status: "committed", revision: 3 });
      expect(store.readSource(a.sourceId)).toMatchObject({ revision: 3, availability: "available", events: [], parserVersion: 2 });
      expect(store.readSource(b.sourceId)!.events).toEqual(b.events);
      expect(store.replaceSource(a, 1)).toEqual({ status: "stale", actualRevision: 3 });
      expect(store.markUnavailable(sourceId("absent"), 1)).toEqual({ status: "stale", actualRevision: null });
    } finally { db.close(); }
  });
  it("rolls back header/events/key binding when SQL fails halfway through replacement", () => {
    const db = memory();
    try {
      const store = createSourceStore(db, context.keyId), input = contribution();
      store.replaceSource(input, null);
      const before = storedRows(db);
      db.exec("CREATE TRIGGER fail_second BEFORE INSERT ON source_event_contributions WHEN (SELECT count(*) FROM source_event_contributions WHERE source_id=NEW.source_id) = 1 BEGIN SELECT RAISE(ABORT, 'FICTITIOUS_DATABASE_SENTINEL'); END");
      let caught;
      try { store.replaceSource({ ...contribution("source-a", ["one", "two", "three"]), completedOffset: 20000, observedSize: 20000 }, 1); } catch(error) { caught = error; }
      expect(safeErrorEnvelope(caught).error.code).toBe("DATABASE_TRANSACTION_FAILED");
      expect(JSON.stringify(safeErrorEnvelope(caught))).not.toContain("FICTITIOUS_");
      expect(storedRows(db)).toEqual(before);
    } finally { db.close(); }
    const fresh = memory();
    try {
      fresh.exec("CREATE TRIGGER fail_all BEFORE INSERT ON source_event_contributions BEGIN SELECT RAISE(ABORT, 'synthetic'); END");
      expect(() => createSourceStore(fresh, context.keyId).replaceSource(contribution(), null)).toThrow();
      expect(storedRows(fresh)).toEqual({ headers: [], events: [], identity: [] });
    } finally { fresh.close(); }
  });
  it("rolls back detected abort before commit and leaves caller-owned transactions alone", () => {
    const db = memory();
    try {
      const store = createSourceStore(db, context.keyId), input = contribution();
      store.replaceSource(input, null); const before = storedRows(db);
      const already = new AbortController(); already.abort();
      expect(store.replaceSource(input, 1, already.signal)).toEqual({ status: "aborted" });
      const during = new AbortController();
      // Test-only SQLite callback deterministically delivers abort inside synchronous work.
      db.function("test_abort", () => { during.abort(); return 0; });
      db.exec("CREATE TRIGGER abort_write AFTER INSERT ON source_event_contributions BEGIN SELECT test_abort(); END");
      expect(store.replaceSource(input, 1, during.signal)).toEqual({ status: "aborted" });
      expect(storedRows(db)).toEqual(before);
      db.exec("DROP TRIGGER abort_write; BEGIN IMMEDIATE; CREATE TABLE caller_owned (value INTEGER); INSERT INTO caller_owned VALUES(9)");
      expect(() => store.replaceSource(input, 1)).toThrowError(expect.objectContaining({ code: "DATABASE_TRANSACTION_FAILED" }));
      db.exec("COMMIT");
      expect(db.prepare("SELECT value FROM caller_owned").get()).toEqual({ value: 9 });
      expect(storedRows(db)).toEqual(before);
    } finally { db.close(); }
  });
});

describe("storage privacy and bounded validation", () => {
  it("rejects raw fields, accessors/toJSON/prototypes and unsafe display strings without invoking them", () => {
    const db = memory(); let called = 0;
    try {
      const store = createSourceStore(db, context.keyId), input = contribution();
      const getter = { ...input.events[0] };
      Object.defineProperty(getter, "toolName", { get() { called++; return "FICTITIOUS_SECRET"; } });
      const invalidEvents = [getter, { ...input.events[0], raw: "FICTITIOUS_SECRET" }, { ...input.events[0], toJSON() { called++; return "FICTITIOUS_SECRET"; } },
        { ...input.events[0], toolName: "FICTITIOUS_SECRET" }, { ...input.events[0], commandPattern: "npm test FICTITIOUS_SECRET" },
        Object.assign(Object.create({ hidden: "FICTITIOUS_SECRET" }), input.events[0]), { ...input.events[0], sourceRef: { ...input.events[0]!.sourceRef, raw: "FICTITIOUS_SECRET" } }];
      for (const event of invalidEvents) expect(() => store.replaceSource({ ...input, events: [event] } as SourceInput, null)).toThrowError(expect.objectContaining({ code: "INVALID_RECORD" }));
      expect(called).toBe(0); expect(storedRows(db)).toEqual({ headers: [], events: [], identity: [] });
      store.replaceSource(input, null);
      expect(JSON.stringify(storedRows(db))).not.toContain("FICTITIOUS_");
    } finally { db.close(); }
  });
  it("rejects mixed keys/domains, versions, duplicate IDs, invalid finite fields, offsets and boundaries atomically", () => {
    const db = memory();
    try {
      const store = createSourceStore(db, context.keyId), input = contribution(); store.replaceSource(input, null); const before = storedRows(db);
      const changes = [{ normalizationVersion: 2 }, { keyVersion: 2 }, { keyId: "2".repeat(32) }, { parserVersion: 0 }, { completedOffset: NaN },
        { observedSize: Infinity }, { completedOffset: input.observedSize + 1 }, { boundaryFingerprint: null }, { sourceId: input.events[0]!.id }];
      for (const change of changes) expect(() => store.replaceSource({ ...input, ...change } as SourceInput, 1)).toThrow();
      const eventChanges = [{ keyId: "2".repeat(32) }, { id: input.events[0]!.sessionId }, { durationMs: NaN }, { exitCode: 2147483648 },
        { startAt: "2026-02-30T00:00:00.000Z" }, { lookupRange: { startLine: 3, endLine: 1 } }, { provider: "claude" },
        { sourceRef: { ...input.events[0]!.sourceRef, byteOffset: input.completedOffset } }, { sourceRef: { ...input.events[0]!.sourceRef, fileId: sourceId("other") } }];
      for (const change of eventChanges) expect(() => store.replaceSource({ ...input, events: [{ ...input.events[0], ...change }] } as SourceInput, 1)).toThrow();
      expect(() => store.replaceSource({ ...input, events: [input.events[0]!, input.events[0]!] }, 1)).toThrow();
      expect(storedRows(db)).toEqual(before);
      const otherContext = createIdentityContext(new Uint8Array(32).fill(8), "2".repeat(32));
      const other = { ...input, sourceId: otherContext.fingerprint("source", ["codex", "other"]), keyId: otherContext.keyId, completedOffset: 0, observedSize: 0, boundaryFingerprint: null, events: [] };
      expect(() => createSourceStore(db, otherContext.keyId).replaceSource(other, null)).toThrowError(expect.objectContaining({ code: "INVALID_IDENTITY_KEY" }));
      expect(storedRows(db)).toEqual(before);
    } finally { db.close(); }
  });
  it("rejects event-count, per-event and total-byte excess before any write", () => {
    const db = memory();
    try {
      const store = createSourceStore(db, context.keyId), input = contribution();
      expect(() => store.replaceSource({ ...input, events: Array(MAX_SOURCE_EVENTS + 1).fill(input.events[0]) }, null)).toThrowError(expect.objectContaining({ code: "STATE_LIMIT" }));
      expect(() => store.replaceSource({ ...input, events: [{ ...input.events[0]!, commandPattern: "rg" + " --json".repeat(10_000) }] }, null)).toThrowError(expect.objectContaining({ code: "STATE_LIMIT" }));
      const large = Array.from({ length: 600 }, (_, i) => ({ ...input.events[0]!, id: context.fingerprint("event", [i]), commandPattern: "rg" + " --json".repeat(5000) }));
      expect(() => store.replaceSource({ ...input, events: large }, null)).toThrowError(expect.objectContaining({ code: "STATE_LIMIT" }));
      expect(storedRows(db)).toEqual({ headers: [], events: [], identity: [] });
    } finally { db.close(); }
  });
  it("rejects same-scope timing conflicts while preserving distinct scopes and millisecond rounding", () => {
    const db = memory();
    try {
      const store = createSourceStore(db, context.keyId), input = contribution();
      const timed = { ...input.events[0]!, intervalScope: "process_runtime" as const };
      store.replaceSource({ ...input, events: [timed] }, null);
      const before = storedRows(db);
      expect(() => store.replaceSource({ ...input, events: [{ ...timed, durationMs: 2000 }] }, 1)).toThrowError(expect.objectContaining({ code: "INVALID_RECORD" }));
      expect(storedRows(db)).toEqual(before);
      expect(store.replaceSource({ ...input, events: [{ ...timed, durationMs: 999 }] }, 1)).toEqual({ status: "committed", revision: 2 });
      expect(store.replaceSource({ ...input, events: [{ ...timed, durationMs: 2000, intervalScope: "item_lifecycle" }] }, 2)).toEqual({ status: "committed", revision: 3 });
    } finally { db.close(); }
  });
  it("stops oversized corrupted readback and releases its read snapshot for another writer", async () => {
    const directory = join(temporaryDirectory(), "corrupt-read"), db = await openDatabase(directory), other = await openDatabase(directory);
    try {
      const store = createSourceStore(db, context.keyId), input = contribution();
      store.replaceSource(input, null);
      db.exec("BEGIN IMMEDIATE; DELETE FROM source_event_contributions; UPDATE source_event_headers SET event_count=600,event_bytes=1");
      const insert = db.prepare("INSERT INTO source_event_contributions VALUES (?, ?, ?)");
      for (let i = 0; i < 600; i++) {
        const event = { ...input.events[0]!, id: context.fingerprint("event", [i]), commandPattern: "rg" + " --json".repeat(5000) };
        insert.run(input.sourceId, event.id, JSON.stringify(event));
      }
      db.exec("COMMIT");
      expect(() => store.readSource(input.sourceId)).toThrowError(expect.objectContaining({ code: "DATABASE_ACCESS_FAILED" }));
      expect(createSourceStore(other, context.keyId).markUnavailable(input.sourceId, 1)).toEqual({ status: "committed", revision: 2 });
    } finally { db.close(); other.close(); }
  });
  it("fails closed on corrupted readback and revision overflow", () => {
    const db = memory();
    try {
      const store = createSourceStore(db, context.keyId), input = contribution(); store.replaceSource(input, null);
      db.prepare("UPDATE source_event_headers SET revision=?").run(Number.MAX_SAFE_INTEGER);
      const before = storedRows(db);
      expect(() => store.replaceSource(input, Number.MAX_SAFE_INTEGER)).toThrow();
      expect(storedRows(db)).toEqual(before);
      db.exec("UPDATE source_event_contributions SET event_json='{}'");
      expect(() => store.readSource(input.sourceId)).toThrowError(expect.objectContaining({ code: "DATABASE_ACCESS_FAILED" }));
    } finally { db.close(); }
  });
});

it("round-trips actual single-source Codex and Claude fixture events exactly after reopen", async () => {
  const fixtures = fileURLToPath(new URL("fixtures/providers/", import.meta.url));
  const files = (await readdir(fixtures)).filter((name) => /^(codex|claude)-.*\.jsonl$/.test(name)).sort();
  const directory = join(temporaryDirectory(), "adapter-store");
  let db = await openDatabase(directory); let eventCount = 0;
  const expected = new Map<string, SourceInput>();
  try {
    const store = createSourceStore(db, context.keyId);
    for (const name of files) {
      const provider = name.startsWith("codex") ? "codex" : "claude";
      const adapter = provider === "codex" ? createCodexAdapter(context) : createClaudeAdapter(context);
      const bytes = await readFile(join(fixtures, name)); let completedOffset = 0, ordinal = 0;
      for await (const entry of readJsonLines(join(fixtures, name))) {
        if (entry.kind === "record") adapter.ingest(entry.value, { fileIdentity: name, byteOffset: entry.byteOffset, ordinal: ordinal++ });
        if (entry.kind === "checkpoint") completedOffset = entry.nextOffset;
      }
      const snapshot = adapter.snapshot(); expect(snapshot.capabilities.stateLimited).toBe(false);
      const input: SourceInput = { sourceId: sourceId(name, provider), provider, parserVersion: 1, normalizationVersion: 1, keyVersion: 1, keyId: context.keyId,
        completedOffset, observedSize: bytes.length, boundaryFingerprint: completedOffset === 0 ? null : context.fingerprint("content", ["fixture-prefix", name, bytes.subarray(0, completedOffset).toString("base64")]), events: snapshot.events };
      store.replaceSource(input, null); expected.set(input.sourceId, input); eventCount += input.events.length;
    }
    expect(files.length).toBeGreaterThanOrEqual(10); expect(eventCount).toBeGreaterThan(20);
    db.close(); db = await openDatabase(directory);
    for (const [id, input] of expected) {
      const actual = createSourceStore(db, context.keyId).readSource(id)!;
      expect(actual.events).toEqual([...input.events].sort((a,b) => a.id.localeCompare(b.id)));
      expect(actual.completedOffset).toBe(input.completedOffset); expect(actual.boundaryFingerprint).toBe(input.boundaryFingerprint);
      expect(JSON.stringify(actual)).not.toContain("FICTITIOUS_");
    }
  } finally { db.close(); }
});
