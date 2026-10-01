import { afterEach, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db/database.js";
import { createSourceStore } from "../src/db/source-store.js";
import { createIdentityContext } from "../src/normalize/identity.js";
import { temporaryDirectory } from "./helpers.js";
const context = createIdentityContext(new Uint8Array(32).fill(3), "3".repeat(32));
const input = (n: number) => ({ sourceId: context.fingerprint("source", [n]), provider: "codex" as const, parserVersion: 1, normalizationVersion: 1 as const, keyVersion: 1 as const, keyId: context.keyId, completedOffset: 0, observedSize: 0, boundaryFingerprint: null, events: [] });
afterEach(() => vi.restoreAllMocks());
it.each([0,1,64,65])("bounds catalogue of %s sources", async n => {
 const db = await openDatabase(temporaryDirectory());
 try {
  const store = createSourceStore(db, context.keyId); const ids = [];
  for(let i=0;i<n;i++){const row=input(i);ids.push(row.sourceId);store.replaceSource(row,null);}
  const result=store.listSources(); expect(result.returnedCount).toBe(Math.min(n,64)); expect(result.truncated).toBe(n>64);
  expect(result.items.map(r=>r.sourceId)).toEqual(ids.sort().slice(0,64)); expect(result).toMatchObject({metadataOnly:true,snapshotConsistent:true,crossSourceReconciled:false,aggregationReady:false,parserResumeReady:false});
  expect(Object.isFrozen(result.items)).toBe(true);if(n)expect(Object.isFrozen(result.items[0]!.storedCounts)).toBe(true);
  expect(db.isTransaction).toBe(false);
 }finally{db.close();}
});
it("uses indexed bounded headers without reading metric/event payloads or a temp sort",async()=>{
 const db=await openDatabase(temporaryDirectory());
 try{
 const store=createSourceStore(db,context.keyId);store.replaceSource(input(1),null);
 const original=db.prepare.bind(db), statements:string[]=[];vi.spyOn(db,'prepare').mockImplementation((sql)=>{statements.push(sql);return original(sql);});
 store.listSources(); expect(statements).toHaveLength(1);const sql=statements[0]!;expect(sql).toContain('LIMIT 65');expect(sql).not.toMatch(/source_(?:event|metric)_contributions|count\(\*\)/);
 const plan=original('EXPLAIN QUERY PLAN '+sql).all();expect(JSON.stringify(plan)).not.toMatch(/TEMP B-TREE/);expect(JSON.stringify(plan)).toMatch(/INDEX/);
 }finally{db.close();}
});
it("keeps caller transactions on success and corrupt returned metadata failure",async()=>{
 const db=await openDatabase(temporaryDirectory());
 try{const store=createSourceStore(db,context.keyId);store.replaceSource(input(1),null);db.exec('BEGIN');store.listSources();expect(db.isTransaction).toBe(true);db.exec('PRAGMA ignore_check_constraints=ON; UPDATE source_event_headers SET event_count=4097');expect(()=>store.listSources()).toThrow();expect(db.isTransaction).toBe(true);db.exec('ROLLBACK');expect(store.listSources().items[0]!.storedCounts.events).toBe(0);
 }finally{db.close();}
});
it.each(["source_id", "provider", "key_id", "boundary_fingerprint", "availability"])("rejects oversized %s header before returning it",async column=>{
 const db=await openDatabase(temporaryDirectory());
 try{const store=createSourceStore(db,context.keyId);store.replaceSource(input(1),null);db.exec('PRAGMA ignore_check_constraints=ON; PRAGMA foreign_keys=OFF');db.prepare(`UPDATE source_event_headers SET ${column}=?`).run('FICTITIOUS_RAW_SENTINEL'.repeat(10000));expect(()=>store.listSources()).toThrow();expect(db.isTransaction).toBe(false);
 }finally{db.close();}
});
it("validates metric descriptors and keeps metadata scope distinct",async()=>{
 const db=await openDatabase(temporaryDirectory());
 try{const store=createSourceStore(db,context.keyId);const row=input(1);store.replaceSource(row,null);
 db.prepare('INSERT INTO source_metric_headers VALUES (?,1,0,0,0,0,0)').run(row.sourceId);
 expect(store.listSources().items[0]).toMatchObject({persistedScope:'events_and_metric_evidence',storedCounts:{events:0,turns:0,usage:0}});
 // Header presence is not evidence of valid payloads; selected read performs that validation.
 expect(()=>store.readSource(row.sourceId)).toThrow();
 db.exec('PRAGMA ignore_check_constraints=ON; UPDATE source_metric_headers SET turn_count=4097');expect(()=>store.listSources()).toThrow();
 }finally{db.close();}
});
it.each(['source_event_headers','source_metric_headers'])('rejects recreated %s without its canonical index',async table=>{
 const db=await openDatabase(temporaryDirectory());
 try{const store=createSourceStore(db,context.keyId);store.replaceSource(input(1),null);db.exec(`PRAGMA foreign_keys=OFF; CREATE TABLE unindexed AS SELECT * FROM ${table}; DROP TABLE ${table}; ALTER TABLE unindexed RENAME TO ${table}`);expect(()=>store.listSources()).toThrowError(expect.objectContaining({code:'DATABASE_ACCESS_FAILED'}));expect(db.isTransaction).toBe(false);
 }finally{db.close();}
});
