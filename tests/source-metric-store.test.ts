import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../src/db/database.js";
import { createSourceStore } from "../src/db/source-store.js";
import type { MetricEvidence, SourceInput, SourceSnapshotInput } from "../src/db/source-store.js";
import { encodeMetrics, MAX_SOURCE_METRIC_BYTES, METRIC_LIMITS } from "../src/db/source-metric-validation.js";
import { createIdentityContext } from "../src/normalize/identity.js";
import { createCodexAdapter } from "../src/parsers/codex/index.js";
import { createClaudeAdapter } from "../src/parsers/claude/index.js";
import type { TrustedFixtureContext } from "../src/parsers/types.js";
import { safeErrorEnvelope } from "../src/privacy/diagnostics.js";
import { temporaryDirectory } from "./helpers.js";

const context = createIdentityContext(new Uint8Array(32).fill(49), "5".repeat(32));
const fixtures = fileURLToPath(new URL("fixtures/providers/", import.meta.url));
const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function memory() { const db = new DatabaseSync(":memory:"); migrate(db); databases.push(db); return db; }
function rows(db: DatabaseSync) {
  return Object.fromEntries(["source_store_identity", "source_event_headers", "source_event_contributions", "source_metric_headers", "source_metric_contributions"]
    .map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}
function eventOnly(input: SourceSnapshotInput): SourceInput { const { evidence: _evidence, ...source } = input; return source; }
async function fixture(name = "codex-real-shapes.jsonl", fileIdentity = "FICTITIOUS_LOCAL_SOURCE", trusted?: TrustedFixtureContext): Promise<SourceSnapshotInput> {
  const provider = name.startsWith("codex") ? "codex" : "claude";
  const bytes = await readFile(join(fixtures, name));
  const adapter = provider === "codex" ? createCodexAdapter(context) : createClaudeAdapter(context);
  let start = 0, ordinal = 0;
  while (start < bytes.length) {
    const end = bytes.indexOf(10, start); if (end < 0) break;
    const source = { fileIdentity, byteOffset: start, ordinal: ordinal++, sourceAlias: "source-1" };
    const record = JSON.parse(bytes.subarray(start, end).toString("utf8"));
    if (provider === "codex") (adapter as ReturnType<typeof createCodexAdapter>).ingest(record, { ...source, ...(trusted ? { trustedFixtureContext: trusted } : {}) });
    else (adapter as ReturnType<typeof createClaudeAdapter>).ingest(record, source);
    start = end + 1;
  }
  const snapshot = adapter.snapshot();
  return { sourceId: context.fingerprint("source", [provider, fileIdentity]), provider, parserVersion: 1, normalizationVersion: 1, keyVersion: 1, keyId: context.keyId,
    completedOffset: start, observedSize: bytes.length, boundaryFingerprint: start ? context.fingerprint("content", ["synthetic-boundary", start]) : null,
    events: snapshot.events, evidence: { turns: snapshot.turns, usage: snapshot.usage, observations: snapshot.observations, diagnostics: snapshot.diagnostics, capabilities: snapshot.capabilities } };
}
function schemaTwo(db: DatabaseSync) {
  // Schema 2's tables remain unchanged. Remove later metric/cache extensions.
  db.exec("DROP TABLE source_parser_checkpoints; DROP TABLE source_relationship_contributions; DROP TABLE source_relationship_headers; DROP TABLE source_cache_evidence; DROP TABLE source_metric_contributions; DROP TABLE source_metric_headers; DELETE FROM schema_migrations WHERE version>=3; PRAGMA user_version=2");
}

describe("historical metric evidence and atomic migration", () => {
  it("keeps v2 source events/settings/revisions and absent evidence across migration and reopen", async () => {
    const dir = join(temporaryDirectory(), "v2"), input = await fixture();
    let db = await openDatabase(dir);
    try {
      createSourceStore(db, context.keyId).replaceSource(eventOnly(input), null);
      const prior = rows(db); schemaTwo(db);
      db.exec("CREATE TABLE unrelated(value INTEGER); INSERT INTO unrelated VALUES(42)");
      db.close(); db = await openDatabase(dir);
      const result = createSourceStore(db, context.keyId).readSource(input.sourceId)!;
      expect(result).toMatchObject({ revision: 1, evidence: null, persistedScope: "events_only", aggregationReady: false, parserResumeReady: false });
      expect(rows(db)).toEqual(prior);
      expect(db.prepare("SELECT * FROM settings ORDER BY key").all()).toEqual([{ key: "key_version", value: 1 }, { key: "normalization_version", value: 1 }]);
      expect(db.prepare("SELECT * FROM unrelated").get()).toEqual({ value: 42 });
      expect(db.prepare("SELECT version FROM schema_migrations ORDER BY version").all()).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }, { version: 6 }]);
    } finally { db.close(); }
  });
  it("serializes a peer-completed 2→5 migration before observing schema", async () => {
    const dir = join(temporaryDirectory(), "race"), first = await openDatabase(dir), peer = await openDatabase(dir);
    const exec = first.exec.bind(first); let interleaved = false;
    try {
      schemaTwo(first);
      first.exec = (sql) => { if (sql === "BEGIN IMMEDIATE" && !interleaved) { interleaved = true; migrate(peer); } exec(sql); };
      expect(() => migrate(first)).not.toThrow(); expect(interleaved).toBe(true);
      expect(first.prepare("PRAGMA user_version").get()).toEqual({ user_version: 6 });
      expect(first.prepare("SELECT * FROM source_metric_headers").all()).toEqual([]);
    } finally { first.exec = exec; first.close(); peer.close(); }
  });
  it("rolls back conflicting 2→5 DDL without modifying old generations", async () => {
    const db = memory(), input = await fixture(); createSourceStore(db, context.keyId).replaceSource(eventOnly(input), null); schemaTwo(db);
    db.exec("CREATE TABLE source_metric_contributions(sentinel INTEGER); INSERT INTO source_metric_contributions VALUES(7)");
    const before = db.prepare("SELECT * FROM source_event_headers").all();
    expect(() => migrate(db)).toThrowError(expect.objectContaining({ code: "DATABASE_MIGRATION_FAILED" }));
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 2 });
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name='source_metric_headers'").get()).toBeUndefined();
    expect(db.prepare("SELECT * FROM source_event_headers").all()).toEqual(before);
    expect(db.prepare("SELECT * FROM source_metric_contributions").all()).toEqual([{ sentinel: 7 }]);
  });
  it("does not roll back caller-owned schema 2 work or overwrite future schema", () => {
    const db = memory(); schemaTwo(db);
    db.exec("CREATE TABLE unrelated(value INTEGER); BEGIN IMMEDIATE; INSERT INTO unrelated VALUES(42)");
    expect(() => migrate(db)).toThrow(); db.exec("COMMIT");
    expect(db.prepare("SELECT * FROM unrelated").get()).toEqual({ value: 42 });
    db.exec("PRAGMA user_version=7"); const before = db.prepare("SELECT * FROM sqlite_schema ORDER BY name").all();
    expect(() => migrate(db)).toThrowError(expect.objectContaining({ code: "DATABASE_SCHEMA_TOO_NEW" }));
    expect(db.prepare("SELECT * FROM sqlite_schema ORDER BY name").all()).toEqual(before);
  });
  it("rejects a schema 2 database missing its migration marker without creating evidence tables", () => {
    const db = memory(); schemaTwo(db); db.exec("DELETE FROM schema_migrations WHERE version=2");
    expect(() => migrate(db)).toThrowError(expect.objectContaining({ code: "DATABASE_MIGRATION_FAILED" }));
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 2 });
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name='source_metric_headers'").get()).toBeUndefined();
  });
});

describe("metric semantics remain provider observations", () => {
  it("preserves final response once, historical observations and cumulative snapshots without summing", async () => {
    const trusted: TrustedFixtureContext = { usageEvidence: [1, 2, 3].map((ordinal) => ({ ordinal, finality: ordinal < 3 ? "partial" : "final", order: ordinal, orderingGroup: "synthetic-test-proof", mapping: "openai_responses" })) };
    const input = await fixture("codex-usage-replay.jsonl", "synthetic", trusted), db = memory(), store = createSourceStore(db, context.keyId);
    store.replaceSourceSnapshot(input, null); store.replaceSourceSnapshot(input, 1);
    const saved = store.readSource(input.sourceId)!.evidence!;
    expect(saved).toEqual(input.evidence);
    const response = saved.usage.filter((u) => u.source === "response_usage");
    expect(response).toHaveLength(1);
    expect(response[0]).toMatchObject({ selection: "eligible", finality: "trusted_final", counts: { output: 10, total: 110 } });
    expect(saved.observations.filter((o) => o.observedUsage !== null)).toHaveLength(6);
    expect(saved.usage.some((u) => u.scope === "thread_cumulative")).toBe(true);
    expect(saved.usage.some((u) => u.scope === "unverified_snapshot")).toBe(true);
  });
  it("preserves Claude cache partition, finality unknown and duration-only turns", async () => {
    const input = await fixture("claude-real-shapes.jsonl"), db = memory(), store = createSourceStore(db, context.keyId);
    store.replaceSourceSnapshot(input, null); const evidence = store.readSource(input.sourceId)!.evidence!;
    expect(evidence).toEqual(input.evidence);
    expect(evidence.usage[0]).toMatchObject({ finality: "unknown", selection: "provisional", counts: { input: 150, uncachedInput: 100, output: 10, cachedInput: 30, cacheWriteInput: 20, reasoningOutput: null, total: 160 } });
    expect(evidence.turns[0]).toMatchObject({ startAt: null, endAt: null, durationMs: 9000, durationScope: "unknown", intervalScope: "unknown", selection: "duration_only" });
    expect(evidence.observations.some((o) => "observedResult" in o && o.observedResult?.completionKind === "background_acknowledgement")).toBe(true);
    expect(JSON.stringify(rows(db))).not.toContain("FICTITIOUS_");
  });
  it("retains conflict/null/ambiguous evidence and ordered diagnostics without inventing zero or coverage", async () => {
    for (const name of ["codex-usage-replay.jsonl", "codex-fork.jsonl", "claude-fork.jsonl"]) {
      const input = await fixture(name), db = memory(), store = createSourceStore(db, context.keyId);
      store.replaceSourceSnapshot(input, null); const evidence = store.readSource(input.sourceId)!.evidence!;
      expect(evidence).toEqual(input.evidence);
      if (name.includes("usage")) expect(evidence.usage.some((u) => u.selection === "conflicted" && u.counts === null)).toBe(true);
      else expect(evidence.observations.some((o) => o.origin === "ambiguous")).toBe(true);
      expect(evidence.capabilities.coverage).toBe("partial");
    }
  });
  it("retains partial/invalid sanitized token components and explicit limited capabilities", async () => {
    const input = await fixture("claude-real-shapes.jsonl"), original = input.evidence.usage[0]!;
    const evidence: MetricEvidence = { ...input.evidence, usage: [{ ...original, counts: { input: null, uncachedInput: null, output: 2, cachedInput: 0, cacheWriteInput: null, reasoningOutput: null, total: null }, countStatus: "invalid", selection: "invalid", limitations: ["invalid_counts"] } as typeof original],
      capabilities: { ...input.evidence.capabilities, coverage: "partial", stateLimited: true, diagnosticsDropped: 2 } };
    const db = memory(), store = createSourceStore(db, context.keyId); store.replaceSourceSnapshot({ ...input, evidence }, null);
    expect(store.readSource(input.sourceId)!.evidence).toEqual(evidence);
  });
  it.each(["codex", "claude"] as const)("differentially stores actual %s adapter output for invalid, partial, zero and overflowing counts", async (provider) => {
    const invalid = [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "FICTITIOUS_TOKEN_SECRET", null, undefined];
    const keys = provider === "codex" ? ["input_tokens", "output_tokens", "cached_input_tokens", "cache_write_input_tokens", "reasoning_output_tokens", "total_tokens"] : ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"];
    const normal = provider === "codex" ? { input_tokens: 100, output_tokens: 10, cached_input_tokens: 40, cache_write_input_tokens: 60, reasoning_output_tokens: 4, total_tokens: 110 }
      : { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 30, cache_creation_input_tokens: 20 };
    const cases: unknown[] = [null, {}, Object.fromEntries(keys.map((key) => [key, 0])), ...keys.flatMap((key) => invalid.map((value) => ({ ...normal, [key]: value }))),
      { ...normal, input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 1 }, { ...normal, cached_input_tokens: 101, cache_read_input_tokens: Number.MAX_SAFE_INTEGER }, { ...normal, reasoning_output_tokens: 11 }];
    const base = await fixture(provider === "codex" ? "codex-real-shapes.jsonl" : "claude-real-shapes.jsonl");
    const db = memory(), store = createSourceStore(db, context.keyId);
    let revision: number | null = null;
    for (const raw of cases) {
      const adapter = provider === "codex" ? createCodexAdapter(context) : createClaudeAdapter(context);
      if (provider === "codex") {
        adapter.ingest({ type: "session_meta", payload: { id: "counts", cli_version: "0.159.0" } }, { fileIdentity: "FICTITIOUS_LOCAL_SOURCE", ordinal: 0, byteOffset: 0 });
        adapter.ingest({ type: "token_usage_record", payload: { thread_id: "counts", response_id: "response", usage: raw } }, { fileIdentity: "FICTITIOUS_LOCAL_SOURCE", ordinal: 1, byteOffset: 10 });
      } else adapter.ingest({ type: "assistant", sessionId: "counts", uuid: "uuid", message: { id: "response", role: "assistant", content: [], usage: raw } }, { fileIdentity: "FICTITIOUS_LOCAL_SOURCE", ordinal: 0, byteOffset: 0 });
      const snap = adapter.snapshot();
      const evidence = { turns: snap.turns, usage: snap.usage, observations: snap.observations, diagnostics: snap.diagnostics, capabilities: snap.capabilities };
      expect(snap.usage).toHaveLength(1);
      const result = store.replaceSourceSnapshot({ ...base, events: snap.events, evidence }, revision);
      expect(result.status).toBe("committed"); revision = revision === null ? 1 : revision + 1;
      expect(store.readSource(base.sourceId)!.evidence).toEqual(evidence);
      expect(JSON.stringify(rows(db))).not.toContain("FICTITIOUS_");
    }
    expect(cases.length).toBe(provider === "codex" ? 54 : 38);
  });
  it("keeps separate-source canonical variants and unavailable evidence; event-only writes clear it atomically", async () => {
    const a = await fixture("codex-real-shapes.jsonl", "source-a"), b = await fixture("codex-real-shapes.jsonl", "source-b"), db = memory(), store = createSourceStore(db, context.keyId);
    expect(a.evidence.usage[0]!.id).toBe(b.evidence.usage[0]!.id);
    store.replaceSourceSnapshot(a, null); store.replaceSourceSnapshot(b, null);
    store.markUnavailable(a.sourceId, 1);
    expect(store.readSource(a.sourceId)).toMatchObject({ availability: "unavailable", evidence: a.evidence, revision: 2 });
    store.replaceSource({ ...eventOnly(a), events: [], completedOffset: 0, observedSize: 0, boundaryFingerprint: null }, 2);
    expect(store.readSource(a.sourceId)).toMatchObject({ availability: "available", evidence: null, persistedScope: "events_only", revision: 3 });
    expect(db.prepare("SELECT * FROM source_metric_contributions WHERE source_id=?").all(a.sourceId)).toEqual([]);
    expect(store.readSource(b.sourceId)!.evidence).toEqual(b.evidence);
  });
});

describe("whole-generation rollback and consistent reads", () => {
  it.each([false, true])("rolls back failure after inserting metric rows (existing generation %s)", async (existing) => {
    const input = await fixture(), db = memory(), store = createSourceStore(db, context.keyId);
    if (existing) store.replaceSourceSnapshot(input, null);
    const before = rows(db);
    db.exec("CREATE TRIGGER reject_metric BEFORE INSERT ON source_metric_contributions WHEN NEW.kind='observation' BEGIN SELECT RAISE(ABORT, 'FICTITIOUS_SQL_SECRET'); END");
    expect(() => store.replaceSourceSnapshot({ ...input, completedOffset: input.completedOffset + 1, observedSize: input.observedSize + 1 }, existing ? 1 : null))
      .toThrowError(expect.objectContaining({ code: "DATABASE_TRANSACTION_FAILED" }));
    expect(rows(db)).toEqual(before);
  });
  it("rolls back cancellation in a metric insert and evidence deletion in event-only replacement", async () => {
    const input = await fixture(), db = memory(), store = createSourceStore(db, context.keyId); store.replaceSourceSnapshot(input, null); const before = rows(db);
    const controller = new AbortController(); db.function("abort_metric", () => { controller.abort(); return 0; });
    db.exec("CREATE TRIGGER cancel_metric AFTER INSERT ON source_metric_contributions BEGIN SELECT abort_metric(); END");
    expect(store.replaceSourceSnapshot(input, 1, controller.signal)).toEqual({ status: "aborted" }); expect(rows(db)).toEqual(before);
    db.exec("DROP TRIGGER cancel_metric; CREATE TRIGGER reject_delete AFTER DELETE ON source_metric_headers BEGIN SELECT RAISE(ABORT, 'FICTITIOUS_SQL_SECRET'); END");
    expect(() => store.replaceSource(eventOnly(input), 1)).toThrow(); expect(rows(db)).toEqual(before);
  });
  it("does not overwrite a peer revision or bind a wrong key", async () => {
    const input = await fixture(), dir = join(temporaryDirectory(), "cas"), db = await openDatabase(dir), peer = await openDatabase(dir);
    try {
      const a = createSourceStore(db, context.keyId), b = createSourceStore(peer, context.keyId); a.replaceSourceSnapshot(input, null);
      b.markUnavailable(input.sourceId, 1); const before = rows(db);
      expect(a.replaceSourceSnapshot(input, 1)).toEqual({ status: "stale", actualRevision: 2 }); expect(rows(db)).toEqual(before);
      const wrong = createSourceStore(db, "6".repeat(32));
      expect(() => wrong.replaceSourceSnapshot(input, 2)).toThrow(); expect(rows(db)).toEqual(before);
    } finally { db.close(); peer.close(); }
  });
  it("reads one generation while a real WAL peer replaces it between header and payload statements", async () => {
    const input = await fixture(), dir = join(temporaryDirectory(), "read"), db = await openDatabase(dir), peer = await openDatabase(dir);
    const prepare = db.prepare.bind(db); let interleaved = false;
    try {
      db.exec("PRAGMA journal_mode=WAL"); peer.exec("PRAGMA journal_mode=WAL");
      const store = createSourceStore(db, context.keyId), other = createSourceStore(peer, context.keyId); store.replaceSourceSnapshot(input, null);
      const before = store.readSource(input.sourceId);
      db.prepare = ((sql: string) => {
        const statement = prepare(sql);
        if (sql.startsWith("SELECT h.*")) {
          const get = statement.get.bind(statement);
          statement.get = ((...args: Parameters<typeof get>) => {
            const item = get(...args);
            if (!interleaved && item) { interleaved = true; other.replaceSource({ ...eventOnly(input), events: [] }, 1); }
            return item;
          }) as typeof statement.get;
        }
        return statement;
      }) as typeof db.prepare;
      expect(store.readSource(input.sourceId)).toEqual(before); expect(interleaved).toBe(true);
      expect(other.readSource(input.sourceId)).toMatchObject({ revision: 2, events: [], evidence: null });
    } finally { db.prepare = prepare; db.close(); peer.close(); }
  });
  it("never commits or rolls back a caller-owned read transaction on success or failure", async () => {
    const input = await fixture(), db = memory(), store = createSourceStore(db, context.keyId); store.replaceSourceSnapshot(input, null);
    db.exec("CREATE TABLE caller_owned(value INTEGER); BEGIN IMMEDIATE; INSERT INTO caller_owned VALUES(42)");
    expect(store.readSource(input.sourceId)!.evidence).toEqual(input.evidence); expect(db.isTransaction).toBe(true);
    db.exec("UPDATE source_metric_headers SET metric_bytes=1");
    expect(() => store.readSource(input.sourceId)).toThrowError(expect.objectContaining({ code: "DATABASE_ACCESS_FAILED" }));
    expect(db.isTransaction).toBe(true); db.exec("COMMIT");
    expect(db.prepare("SELECT * FROM caller_owned").get()).toEqual({ value: 42 });
    expect(db.prepare("SELECT metric_bytes FROM source_metric_headers").get()).toEqual({ metric_bytes: 1 });
  });
});

describe("strict privacy, finite fields and bounded materialization", () => {
  it("rejects getters, extra raw fields, prototypes and toJSON without executing them", async () => {
    const input = await fixture(), db = memory(), store = createSourceStore(db, context.keyId); let invoked = 0;
    const usage = input.evidence.usage[0]!, bad = [
      { ...usage, raw: "FICTITIOUS_SECRET" }, { ...usage, toJSON() { invoked++; return "FICTITIOUS_SECRET"; } },
      Object.defineProperty({ ...usage }, "counts", { get() { invoked++; return null; } }), Object.assign(Object.create({ hidden: true }), usage),
      { ...usage, sourceRef: { ...usage.sourceRef, path: "FICTITIOUS_SECRET" } }, { ...usage, counts: { ...usage.counts, secret: "FICTITIOUS_SECRET" } },
    ];
    for (const value of bad) expect(() => store.replaceSourceSnapshot({ ...input, evidence: { ...input.evidence, usage: [value] } } as SourceSnapshotInput, null)).toThrow();
    const sparse = Array(1); expect(() => store.replaceSourceSnapshot({ ...input, evidence: { ...input.evidence, turns: sparse } }, null)).toThrow();
    expect(invoked).toBe(0); expect(Object.values(rows(db)).every((v) => (v as unknown[]).length === 0)).toBe(true);
  });
  it("rejects foreign IDs/providers/versions, duplicate identities, unsafe diagnostics and invalid components", async () => {
    const input = await fixture(), db = memory(), store = createSourceStore(db, context.keyId); store.replaceSourceSnapshot(input, null); const before = rows(db);
    const usage = input.evidence.usage[0]!;
    const invalidUsages = [{ ...usage, id: usage.sessionId }, { ...usage, provider: "claude" }, { ...usage, sourceRef: { ...usage.sourceRef, fileId: context.fingerprint("source", ["foreign"]) } },
      { ...usage, sourceRef: { ...usage.sourceRef, byteOffset: input.completedOffset } }, { ...usage, phase: "validation" }, { ...usage, counts: { ...usage.counts, output: Infinity } },
      { ...usage, counts: { ...usage.counts, output: -1 } }, { ...usage, counts: { ...usage.counts, output: 0.5 } }, { ...usage, counts: { ...usage.counts, output: Number.MAX_SAFE_INTEGER + 1 } }];
    for (const value of invalidUsages) expect(() => store.replaceSourceSnapshot({ ...input, evidence: { ...input.evidence, usage: [value] } } as SourceSnapshotInput, 1)).toThrow();
    expect(() => store.replaceSourceSnapshot({ ...input, evidence: { ...input.evidence, usage: [usage, usage] } }, 1)).toThrow();
    for (const change of [{ code: "FICTITIOUS_SECRET" }, { message: "FICTITIOUS_SECRET" }, { sourceAlias: "/FICTITIOUS_SECRET" }, { byteOffset: input.completedOffset }, { severity: "FICTITIOUS_SECRET" }]) {
      expect(() => store.replaceSourceSnapshot({ ...input, evidence: { ...input.evidence, diagnostics: [{ code: "UNSUPPORTED_RECORD", severity: "warning", sourceAlias: null, byteOffset: null, ...change }] } } as SourceSnapshotInput, 1)).toThrow();
    }
    expect(() => store.replaceSourceSnapshot({ ...input, parserVersion: 2 }, 1)).toThrow();
    expect(rows(db)).toEqual(before);
  });
  it("checks verified count relationships without replacing missing or invalid values", async () => {
    for (const name of ["codex-real-shapes.jsonl", "claude-real-shapes.jsonl"]) {
      const input = await fixture(name), db = memory(), store = createSourceStore(db, context.keyId), usage = input.evidence.usage[0]!;
      store.replaceSourceSnapshot(input, null); const before = rows(db);
      expect(() => store.replaceSourceSnapshot({ ...input, evidence: { ...input.evidence, usage: [{ ...usage, counts: { ...usage.counts, total: 99999 } }] } } as SourceSnapshotInput, 1)).toThrow();
      if (input.provider === "codex") expect(() => store.replaceSourceSnapshot({ ...input, evidence: { ...input.evidence, usage: [{ ...usage, counts: { ...usage.counts, cachedInput: 99999 } }] } } as SourceSnapshotInput, 1)).toThrow();
      else expect(() => store.replaceSourceSnapshot({ ...input, evidence: { ...input.evidence, usage: [{ ...usage, counts: { ...usage.counts, uncachedInput: 99999 } }] } } as SourceSnapshotInput, 1)).toThrow();
      expect(rows(db)).toEqual(before);
    }
  });
  it("rejects invented Claude intervals and invalid Codex turn evidence while preserving old rows", async () => {
    for (const name of ["codex-real-shapes.jsonl", "claude-real-shapes.jsonl"]) {
      const input = await fixture(name), db = memory(), store = createSourceStore(db, context.keyId), turn = input.evidence.turns[0]!;
      store.replaceSourceSnapshot(input, null); const before = rows(db);
      const changes = [{ durationMs: NaN }, { durationMs: -1 }, { id: turn.sessionId }, { startAt: "private timestamp" }, { intervalScope: "invocation_latency" }];
      if (input.provider === "claude") changes.push({ startAt: "2026-09-01T00:00:00.000Z" });
      for (const change of changes) expect(() => store.replaceSourceSnapshot({ ...input, evidence: { ...input.evidence, turns: [{ ...turn, ...change }] } } as SourceSnapshotInput, 1)).toThrow();
      expect(rows(db)).toEqual(before);
    }
  });
  it.each(["turns", "usage", "observations", "diagnostics"] as const)("rejects excess %s count before reading array elements", async (key) => {
    const input = await fixture(), db = memory(), store = createSourceStore(db, context.keyId), maximum = key === "turns" || key === "usage" ? 4096 : 8192;
    let invoked = false; const value = Array(maximum + 1); Object.defineProperty(value, "0", { get() { invoked = true; return {}; } });
    expect(() => store.replaceSourceSnapshot({ ...input, evidence: { ...input.evidence, [key]: value } }, null)).toThrowError(expect.objectContaining({ code: "STATE_LIMIT" }));
    expect(invoked).toBe(false); expect(Object.values(rows(db)).every((v) => (v as unknown[]).length === 0)).toBe(true);
  });
  it("round-trips exactly 8192 ordered diagnostics and rejects aggregate metric bytes atomically", async () => {
    const input = await fixture(), db = memory(), store = createSourceStore(db, context.keyId);
    const diagnostics = Array.from({ length: METRIC_LIMITS.diagnostic }, (_, i) => ({ code: "UNSUPPORTED_RECORD" as const, severity: "warning" as const, sourceAlias: `source-${i}`, byteOffset: null }));
    store.replaceSourceSnapshot({ ...input, evidence: { ...input.evidence, diagnostics } }, null);
    expect(store.readSource(input.sourceId)!.evidence!.diagnostics).toEqual(diagnostics); const before = rows(db);
    const stress = await fixture("claude-real-shapes.jsonl", "byte-limit"), u = stress.evidence.usage[0]!, t = stress.evidence.turns[0]!;
    const o = { ...stress.evidence.observations.find((v) => v.observedUsage !== null)!,
      eventId: context.fingerprint("event", ["observed-event"]), turnId: context.fingerprint("turn", ["observed-turn"]),
      observedResult: { isError: false, completionKind: "invocation_result" as const, unassignedAcknowledgement: false,
        observedAt: "2026-09-01T00:00:00.000Z", acknowledgementLatencyMs: null, durationMs: 1000, durationScope: "invocation_latency" as const } };
    const usage = Array.from({ length: 4096 }, (_, i) => ({ ...u, id: context.fingerprint("event", ["u", i]) }));
    const turns = Array.from({ length: 4096 }, (_, i) => ({ ...t, id: context.fingerprint("turn", ["t", i]) }));
    const observations = Array.from({ length: 8192 }, (_, i) => ({ ...o, id: context.fingerprint("source", ["o", i]) }));
    const evidence = { ...stress.evidence, usage, turns, observations, diagnostics };
    const proposedBytes = [usage, turns, observations, diagnostics].flat().reduce((n, item) => n + Buffer.byteLength(JSON.stringify(item)), 0);
    expect(proposedBytes).toBeGreaterThan(MAX_SOURCE_METRIC_BYTES);
    expect(() => store.replaceSourceSnapshot({ ...stress, evidence }, null)).toThrowError(expect.objectContaining({ code: "STATE_LIMIT" }));
    expect(rows(db)).toEqual(before);
  });
  it.each(["payload", "ordinal", "bytes", "missing", "extra", "oversized"])("fails closed for corrupted %s and releases its read cursor", async (mode) => {
    const input = await fixture(), dir = join(temporaryDirectory(), "corrupt"), db = await openDatabase(dir), peer = await openDatabase(dir);
    try {
      const store = createSourceStore(db, context.keyId); store.replaceSourceSnapshot(input, null);
      if (mode === "payload") db.exec("UPDATE source_metric_contributions SET row_json='{}' WHERE kind='capabilities'");
      if (mode === "ordinal") db.exec("UPDATE source_metric_contributions SET ordinal=2 WHERE kind='capabilities'");
      if (mode === "bytes") db.exec("UPDATE source_metric_headers SET metric_bytes=1");
      if (mode === "missing") db.exec("DELETE FROM source_metric_contributions WHERE kind='capabilities'");
      if (mode === "extra") db.exec("INSERT INTO source_metric_contributions SELECT source_id,kind,1,row_id,row_json FROM source_metric_contributions WHERE kind='capabilities'");
      if (mode === "oversized") { db.exec("PRAGMA ignore_check_constraints=ON"); db.prepare("UPDATE source_metric_contributions SET row_json=? WHERE kind='capabilities'").run('"' + "FICTITIOUS_SECRET".repeat(5000) + '"'); }
      let caught: unknown; try { store.readSource(input.sourceId); } catch (error) { caught = error; }
      expect(safeErrorEnvelope(caught).error.code).toBe("DATABASE_ACCESS_FAILED"); expect(JSON.stringify(safeErrorEnvelope(caught))).not.toContain("FICTITIOUS_");
      expect(createSourceStore(peer, context.keyId).markUnavailable(input.sourceId, 1)).toEqual({ status: "committed", revision: 2 });
    } finally { db.close(); peer.close(); }
  });
  it("rejects hostile size metadata before any JSON payload query or SQLite payload sort", async () => {
    const input = await fixture(), db = memory(), store = createSourceStore(db, context.keyId); store.replaceSourceSnapshot(input, null);
    db.exec("PRAGMA ignore_check_constraints=ON");
    db.prepare("UPDATE source_metric_contributions SET row_json=? WHERE kind='capabilities'").run('"' + "x".repeat(128 * 1024) + '"');
    const prepare = db.prepare.bind(db); let payloadQueries = 0;
    try {
      db.prepare = ((sql: string) => { if (sql.startsWith("SELECT 1 AS row_group") || sql.startsWith("SELECT 2 AS row_group")) payloadQueries++; return prepare(sql); }) as typeof db.prepare;
      expect(() => store.readSource(input.sourceId)).toThrowError(expect.objectContaining({ code: "DATABASE_ACCESS_FAILED" }));
      expect(payloadQueries).toBe(0); expect(db.isTransaction).toBe(false);
    } finally { db.prepare = prepare; }
  });
  it("does not manufacture capabilities for an empty historical source, but stores actual empty evidence", async () => {
    const input = await fixture(), db = memory(), store = createSourceStore(db, context.keyId), adapter = createCodexAdapter(context), snapshot = adapter.snapshot();
    const empty: SourceSnapshotInput = { ...input, completedOffset: 0, observedSize: 0, boundaryFingerprint: null, events: [], evidence: { turns: [], usage: [], observations: [], diagnostics: [], capabilities: snapshot.capabilities } };
    store.replaceSource(eventOnly(empty), null); expect(store.readSource(input.sourceId)!.evidence).toBeNull();
    store.replaceSourceSnapshot(empty, 1); expect(store.readSource(input.sourceId)!.evidence).toEqual(empty.evidence);
    expect(encodeMetrics(empty.evidence, empty).counts).toEqual({ turn: 0, usage: 0, observation: 0, diagnostic: 0, capabilities: 1 });
  });
});
