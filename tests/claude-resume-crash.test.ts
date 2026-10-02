import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../src/db/database.js";
import { createSourceStore } from "../src/db/source-store.js";
import { createIdentityContext } from "../src/normalize/identity.js";
import { createClaudeAdapter } from "../src/parsers/claude/index.js";
import { ingestSourceFile } from "../src/scanner/source-ingest.js";
import { scanSources } from "../src/scanner/scan-run.js";
import { temporaryDirectory } from "./helpers.js";

const secret = Buffer.alloc(32, 23), keyId = "2".repeat(32), context = createIdentityContext(secret, keyId), databases = new Set<DatabaseSync>();
const hmac = (domain: string, ...parts: unknown[]) => `h1:${keyId}:${domain}:${createHmac("sha256", secret).update(JSON.stringify([1, 1, domain, ...parts])).digest("hex")}`;
const records = [
  { type: "assistant", uuid: "call", sessionId: "FICTITIOUS_CRASH_SESSION", timestamp: "2026-09-01T00:00:00.000Z", message: { id: "response", role: "assistant", content: [{ type: "tool_use", id: "FICTITIOUS_CRASH_CALL", name: "Bash", input: { command: "npm test FICTITIOUS_CRASH_COMMAND" } }] } },
  { type: "user", uuid: "result", sessionId: "FICTITIOUS_CRASH_SESSION", parentUuid: "call", timestamp: "2026-09-01T00:00:04.000Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "FICTITIOUS_CRASH_CALL", is_error: false, content: "FICTITIOUS_CRASH_OUTPUT" }] } },
];
const lines = (values: readonly unknown[]) => Buffer.from(values.map(v => JSON.stringify(v) + "\n").join(""));
const maxFileBytes = 16 * 1024 * 1024;
const dist = new URL("../dist/", import.meta.url).href;
async function opened(data: string) { const db = await openDatabase(data); databases.add(db); return db; }
function close(db: DatabaseSync) { db.close(); databases.delete(db); }
afterEach(() => { for (const db of databases) { try { db.close(); } catch {} } databases.clear(); });
function allRows(db: DatabaseSync) {
  const result: Record<string, unknown> = {};
  for (const table of ["source_store_identity", "source_event_headers", "source_event_contributions", "source_metric_headers", "source_metric_contributions", "source_cache_evidence", "source_relationship_headers", "source_relationship_contributions", "source_parser_checkpoints"]) result[table] = db.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all();
  return result;
}
function reference(path: string) {
  const adapter = createClaudeAdapter(context); let byteOffset = 0;
  records.forEach((value, ordinal) => { adapter.ingest(value, { fileIdentity: path, sourceAlias: "source-1", byteOffset, ordinal }); byteOffset += lines([value]).length; });
  const snapshot = adapter.snapshot(), stream = hmac("session", "claude", "FICTITIOUS_CRASH_SESSION", null);
  expect(snapshot.events).toHaveLength(1); expect(snapshot.events[0]).toMatchObject({ id: hmac("event", "claude", stream, "FICTITIOUS_CRASH_CALL"), status: "completed", durationMs: 4000, durationScope: "invocation_latency", timingEvidence: "paired_timestamps" });
  return snapshot;
}
// Test-only child wrappers inject process death around the REAL synchronous SQL
// COMMIT after real INSERT execution. No production interruption hook is added.
const child = `
import { writeSync } from "node:fs";
const args = JSON.parse(process.argv[1]);
const { openDatabase } = await import(args.dist + "db/database.js");
const { createSourceStore } = await import(args.dist + "db/source-store.js");
const { createIdentityContext } = await import(args.dist + "normalize/identity.js");
const { ClaudeAdapter } = await import(args.dist + "parsers/claude/index.js");
const ingest = await import(args.dist + "scanner/source-ingest.js");
const context = createIdentityContext(Buffer.alloc(32,23), "2".repeat(32));
const db = await openDatabase(args.data), store = createSourceStore(db, context.keyId);
if (typeof store.readSourceForIngestion !== "function" || typeof ingest.ingestSourceFileFromCheckpoint !== "function") throw Error("MISSING_FROZEN_CHECKPOINT_API");
const id = context.fingerprint("source", ["claude", args.path]);
const candidate = store.readSourceForIngestion(id, context);
if (args.unavailable) ClaudeAdapter.prototype.exportCheckpoint = () => ({status:"unavailable", reason:"checkpoint_budget"});
let sourceStaged = false, checkpointStaged = false;
const prepare = db.prepare.bind(db), exec = db.exec.bind(db);
db.prepare = sql => {
  const statement = prepare(sql);
  if (!/INSERT(?: OR [A-Z]+)? INTO source_(?:event_headers|parser_checkpoints)\\b/i.test(sql)) return statement;
  return new Proxy(statement, { get(target, property) {
    if (property === "run") return (...values) => {
      const value = target.run(...values);
      if (/source_event_headers\\b/i.test(sql)) { sourceStaged=true; writeSync(1,"PHASE source-staged\\n"); }
      if (/source_parser_checkpoints\\b/i.test(sql)) { checkpointStaged=true; writeSync(1,"PHASE checkpoint-staged\\n"); }
      return value;
    };
    const value = Reflect.get(target,property); return typeof value === "function" ? value.bind(target) : value;
  }});
};
db.exec = sql => {
  if (sql === "COMMIT" && sourceStaged) {
    if (!args.unavailable && !checkpointStaged) throw Error("CHECKPOINT_NOT_STAGED_BEFORE_COMMIT");
    if (args.phase === "before_commit") { writeSync(1,"PHASE before-commit\\n"); process.kill(process.pid,"SIGKILL"); }
    const value = exec(sql); writeSync(1,"PHASE after-commit\\n"); process.kill(process.pid,"SIGKILL"); return value;
  }
  return exec(sql);
};
await ingest.ingestSourceFileFromCheckpoint(store,context,{path:args.path,provider:"claude",expectedRevision:candidate.source?.revision??null,maxFileBytes:args.maxFileBytes},candidate);
throw Error("NO_REQUESTED_CRASH");
`;

describe("real process interruption and restart", () => {
  it.each([
    { phase: "before_commit", existing: true, unavailable: false },
    { phase: "after_commit", existing: true, unavailable: false },
    { phase: "before_commit", existing: false, unavailable: false },
    { phase: "after_commit", existing: false, unavailable: false },
    { phase: "before_commit", existing: true, unavailable: true },
  ])("atomic recovery after $phase existing=$existing unavailable=$unavailable", async options => {
    const root = temporaryDirectory(), input = join(root, "input"), data = join(root, "data");
    const { mkdir } = await import("node:fs/promises"); await mkdir(input);
    const path = join(input, "source.jsonl"), all = lines(records), expected = reference(path), id = context.fingerprint("source", ["claude", path]);
    await writeFile(path, options.existing ? lines(records.slice(0,1)) : all);
    let db = await opened(data); let store: any = createSourceStore(db, keyId);
    expect(typeof store.readSourceForIngestion, "missing readSourceForIngestion API").toBe("function");
    if (options.existing) expect(await ingestSourceFile(store, context, { path, provider: "claude", expectedRevision: null, maxFileBytes })).toMatchObject({ status:"committed", revision:1 });
    const before = allRows(db), beforeSource = store.readSource(id); close(db);
    if (options.existing) await appendFile(path, lines(records.slice(1)));
    const killed = spawnSync(process.execPath, ["--input-type=module", "--eval", child, JSON.stringify({ ...options, dist, path, data, maxFileBytes })], { encoding:"utf8", timeout:10_000, killSignal:"SIGKILL", env:{...process.env,NODE_NO_WARNINGS:"1"} });
    expect(killed.error).toBeUndefined(); expect(killed.status).toBeNull(); expect(killed.signal).toBe("SIGKILL");
    expect(killed.stdout).toContain("PHASE source-staged\n"); expect(killed.stdout).toContain(`PHASE ${options.phase === "before_commit" ? "before-commit" : "after-commit"}\n`);
    if (!options.unavailable) expect(killed.stdout).toContain("PHASE checkpoint-staged\n");
    expect(killed.stderr).toBe("");
    db = await opened(data); store = createSourceStore(db, keyId);
    if (options.phase === "before_commit") { expect(allRows(db)).toEqual(before); expect(store.readSource(id)).toEqual(beforeSource); }
    else {
      const recovered = store.readSourceForIngestion(id, context); expect(recovered.source.revision).toBe(options.existing ? 2 : 1); expect(recovered.checkpoint.nextOrdinal).toBe(2);
      expect(recovered.source.events).toEqual([...expected.events].sort((a,b)=>a.id.localeCompare(b.id)));
    }
    const resumed = await scanSources(store, context, [{provider:"claude",path:input}], {maxFileBytes});
    expect(resumed.counts).toMatchObject(options.phase === "before_commit" ? { committed:1, unchanged:0 } : { committed:0, unchanged:1 });
    const saved = store.readSource(id); expect(saved.revision).toBe(options.existing ? 2 : 1); expect(saved.events).toEqual([...expected.events].sort((a,b)=>a.id.localeCompare(b.id)));
    expect(saved.evidence).toEqual({turns:expected.turns,usage:expected.usage,observations:expected.observations,diagnostics:expected.diagnostics,capabilities:expected.capabilities});
    const complete = allRows(db); expect((await scanSources(store, context, [{provider:"claude",path:input}], {maxFileBytes})).counts).toMatchObject({committed:0,unchanged:1}); expect(allRows(db)).toEqual(complete);
  });
});
