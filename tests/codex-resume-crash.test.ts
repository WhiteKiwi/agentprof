import { spawnSync } from "node:child_process";
import { appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../src/db/database.js";
import { createSourceStore } from "../src/db/source-store.js";
import { ingestSourceFile } from "../src/scanner/source-ingest.js";
import { scanSources } from "../src/scanner/scan-run.js";
import { temporaryDirectory } from "./helpers.js";

import { keyId,context,wrappers as records,encode as lines,cold } from "./codex-resume-fixture.js";
const databases = new Set<DatabaseSync>();
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
function reference(path: string) { return cold(lines(records),path).snapshot; }
// Test-only child wrappers inject process death around the REAL synchronous SQL
// COMMIT after real INSERT execution. No production interruption hook is added.
const child = `
import { writeSync } from "node:fs";
const args = JSON.parse(process.argv[1]);
const { openDatabase } = await import(args.dist + "db/database.js");
const { createSourceStore } = await import(args.dist + "db/source-store.js");
const { createIdentityContext } = await import(args.dist + "normalize/identity.js");
const { CodexAdapter } = await import(args.dist + "parsers/codex/index.js");
const ingest = await import(args.dist + "scanner/source-ingest.js");
const context = createIdentityContext(Buffer.alloc(32,37), "7".repeat(32));
const db = await openDatabase(args.data), store = createSourceStore(db, context.keyId);
if (typeof store.readSourceForIngestion !== "function" || typeof ingest.ingestSourceFileFromCheckpoint !== "function") throw Error("MISSING_FROZEN_CHECKPOINT_API");
const id = context.fingerprint("source", ["codex", args.path]);
const candidate = store.readSourceForIngestion(id, context);
if (args.unavailable) CodexAdapter.prototype.exportCheckpoint = () => ({status:"unavailable", reason:"checkpoint_budget"});
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
await ingest.ingestSourceFileFromCheckpoint(store,context,{path:args.path,provider:"codex",expectedRevision:candidate.source?.revision??null,maxFileBytes:args.maxFileBytes},candidate);
throw Error("NO_REQUESTED_CRASH");
`;

describe("real process interruption and restart", () => {
  it.each([
    { phase: "before_commit", existing: true, unavailable: false },
    { phase: "after_commit", existing: true, unavailable: false },
    { phase: "before_commit", existing: false, unavailable: false },
    { phase: "after_commit", existing: false, unavailable: false },
    { phase: "before_commit", existing: true, unavailable: true },
    { phase: "after_commit", existing: true, unavailable: true },
  ])("atomic recovery after $phase existing=$existing unavailable=$unavailable", async options => {
    const root = temporaryDirectory(), input = join(root, "input"), data = join(root, "data");
    const { mkdir } = await import("node:fs/promises"); await mkdir(input);
    const path = join(input, "source.jsonl"), all = lines(records), expected = reference(path), id = context.fingerprint("source", ["codex", path]);
    await writeFile(path, options.existing ? lines(records.slice(0,2)) : all);
    let db = await opened(data); let store: any = createSourceStore(db, keyId);
    expect(typeof store.readSourceForIngestion, "missing readSourceForIngestion API").toBe("function");
    if (options.existing) expect(await ingestSourceFile(store, context, { path, provider: "codex", expectedRevision: null, maxFileBytes })).toMatchObject({ status:"committed", revision:1 });
    if (options.existing) expect(store.readSourceForIngestion(id, context).checkpoint, "MISSING_CODEX_DURABLE_CAPTURE").not.toBeNull();
    const before = allRows(db), beforeSource = store.readSource(id); close(db);
    if (options.existing) await appendFile(path, lines(records.slice(2)));
    const killed = spawnSync(process.execPath, ["--input-type=module", "--eval", child, JSON.stringify({ ...options, dist, path, data, maxFileBytes })], { encoding:"utf8", timeout:10_000, killSignal:"SIGKILL", env:{...process.env,NODE_NO_WARNINGS:"1"} });
    expect(killed.error).toBeUndefined(); expect(killed.status).toBeNull(); expect(killed.signal).toBe("SIGKILL");
    expect(killed.stdout).toContain("PHASE source-staged\n"); expect(killed.stdout).toContain(`PHASE ${options.phase === "before_commit" ? "before-commit" : "after-commit"}\n`);
    if (!options.unavailable) expect(killed.stdout).toContain("PHASE checkpoint-staged\n");
    expect(killed.stderr).toBe("");
    db = await opened(data); store = createSourceStore(db, keyId);
    if (options.phase === "before_commit") { expect(allRows(db)).toEqual(before); expect(store.readSource(id)).toEqual(beforeSource); }
    else {
      const recovered = store.readSourceForIngestion(id, context); expect(recovered.source.revision).toBe(options.existing ? 2 : 1); if (options.unavailable) expect(recovered.checkpoint).toBeNull(); else expect(recovered.checkpoint.nextOrdinal).toBe(records.length);
      expect(recovered.source.events).toEqual([...expected.events].sort((a,b)=>a.id.localeCompare(b.id)));
      expect(recovered.source.relationshipEvidence).toEqual({contractVersion:1,capturePolicyVersion:1,status:"captured",provider:"codex",metadata:expected.metadata,wrappers:expected.wrappers});
    }
    const resumed = await scanSources(store, context, [{provider:"codex",path:input}], {maxFileBytes});
    expect(resumed.counts).toMatchObject(options.phase === "before_commit" ? { committed:1, unchanged:0 } : { committed:0, unchanged:1 });
    const saved = store.readSource(id); expect(saved.revision).toBe(options.existing ? 2 : 1); expect(saved.events).toEqual([...expected.events].sort((a,b)=>a.id.localeCompare(b.id)));
    expect(saved.evidence).toEqual({turns:expected.turns,usage:expected.usage,observations:expected.observations,diagnostics:expected.diagnostics,capabilities:expected.capabilities});
    expect(expected.metadata.length).toBeGreaterThan(0);expect(expected.wrappers).toHaveLength(1);expect(expected.wrappers[0]).toMatchObject({callSeen:true,resultSeen:true});
    expect(saved.relationshipEvidence).toEqual({contractVersion:1,capturePolicyVersion:1,status:"captured",provider:"codex",metadata:expected.metadata,wrappers:expected.wrappers});
    const complete = allRows(db); expect((await scanSources(store, context, [{provider:"codex",path:input}], {maxFileBytes})).counts).toMatchObject({committed:0,unchanged:1}); expect(allRows(db)).toEqual(complete);
  });
});
