import { createHash, createHmac } from 'node:crypto';
import { appendFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { openDatabase } from '../src/db/database.js';
import { createSourceStore } from '../src/db/source-store.js';
import { createIdentityContext } from '../src/normalize/identity.js';
import { ClaudeAdapter, createClaudeAdapter } from '../src/parsers/claude/index.js';
import { scanSources } from '../src/scanner/scan-run.js';
import { temporaryDirectory } from './helpers.js';
const secret=Buffer.alloc(32,41),keyId='4'.repeat(32),context=createIdentityContext(secret,keyId);
const hash=(domain:string,...parts:unknown[])=>`h1:${keyId}:${domain}:${createHmac('sha256',secret).update(JSON.stringify([1,1,domain,...parts])).digest('hex')}`;
const expectedKey=`h1:${keyId}:lookup:c92b499ca84056568193bb51e225959fe4a2a5d8f8fe9723348c13d53decd28e`;
const call=(id='call')=>({type:'assistant',uuid:`uuid-${id}`,sessionId:'FICTITIOUS_SEARCH_SESSION',isSidechain:false,cwd:'/FICTITIOUS_SEARCH_ROOT',version:'2.1.241',timestamp:'2026-09-01T00:00:00.000Z',message:{id:`response-${id}`,role:'assistant',content:[{type:'tool_use',id,name:'Grep',input:{pattern:'FICTITIOUS_QUERY_A',path:'src'}}]}});
const result=(id='call')=>({type:'user',uuid:`result-${id}`,sessionId:'FICTITIOUS_SEARCH_SESSION',isSidechain:false,timestamp:'2026-09-01T00:00:04.000Z',parentUuid:`uuid-${id}`,message:{role:'user',content:[{type:'tool_result',tool_use_id:id,is_error:false,content:'FICTITIOUS_SEARCH_RESULT_SENTINEL'}]}});
const bytes=(records:unknown[])=>records.map(x=>JSON.stringify(x)+'\n').join('');
afterEach(()=>vi.restoreAllMocks());
// Immutable PR40-emitted row strings. No parser-v1 reconstruction, relabeling,
// checkpoint signing, historical executable, network or current-adapter seed.
const fixtureHashes: Record<string, string> = {"linux": "79b514678401595e667bea26729d7e9ac0575d0abd46cbfb4050910a21dc3f36", "darwin": "5a9281172ff9cf7d554ca15eb132c6f6c2539dee76a1964657996a177c00bfa3"};
const platform = process.platform;
if (!(platform in fixtureHashes)) throw Error('This fixture supports AgentProf Linux and macOS only');
const historicalText = readFileSync(new URL(`./fixtures/claude-search-resume/${platform}-schema6-v1.json`, import.meta.url), 'utf8');
expect(createHash('sha256').update(historicalText).digest('hex')).toBe(fixtureHashes[platform]);
const historical = JSON.parse(historicalText);
let ownsFixtureRoot = false;
beforeAll(async () => {
  // Exclusive mkdir is the lock. An existing path causes a loud failure; never
  // reuse, remove, follow or overwrite a directory this invocation did not own.
  await mkdir(historical.sourceRoot, { mode: 0o700 });
  ownsFixtureRoot = true;
});
afterAll(async () => {
  if (ownsFixtureRoot) await rm(historical.sourceRoot, { recursive: true });
});
async function fixture() {
  const root = historical.sourceRoot as string, path = historical.path as string;
  const data = temporaryDirectory(), raw = bytes([call(), result()]);
  expect(Buffer.byteLength(raw)).toBe(historical.rawBytes);
  expect(createHash('sha256').update(raw).digest('hex')).toBe(historical.rawSha256);
  await writeFile(path, raw, { mode: 0o600 });
  const db = await openDatabase(data);
  try {
    const tables = ['source_store_identity', 'source_event_headers', 'source_event_contributions', 'source_metric_headers', 'source_metric_contributions', 'source_relationship_headers', 'source_relationship_contributions', 'source_cache_evidence', 'source_parser_checkpoints'];
    expect(Object.keys(historical.rows)).toEqual(tables);
    db.exec('BEGIN IMMEDIATE');
    for (const table of tables) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name as string);
      for (const row of historical.rows[table]) {
        expect(Object.keys(row)).toEqual(columns);
        db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...columns.map(column => row[column]));
      }
    }
    db.exec('COMMIT');
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 6 });
    const store = createSourceStore(db, keyId), seeded = store.readSourceForIngestion(historical.sourceId, context);
    expect(seeded.source).toMatchObject({ parserVersion: 1, revision: 1 });
    expect(seeded.checkpoint).not.toBeNull();
    return { root, path, data, db, id: historical.sourceId as string };
  } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); db.close(); throw error; }
}
const rows=(db:Awaited<ReturnType<typeof openDatabase>>)=>Object.fromEntries(['source_event_headers','source_event_contributions','source_metric_headers','source_metric_contributions','source_relationship_headers','source_relationship_contributions','source_cache_evidence','source_parser_checkpoints'].map(t=>[t,db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
function semantic(saved:any,records:unknown[],path:string){const cold=createClaudeAdapter(context);let offset=0;records.forEach((r,ordinal)=>{cold.ingest(r,{fileIdentity:path,sourceAlias:'source-1',byteOffset:offset,ordinal});offset+=Buffer.byteLength(bytes([r]));});const s=cold.snapshot();expect(saved.events).toEqual([...s.events].sort((a,b)=>a.id.localeCompare(b.id)));expect(saved.evidence).toEqual({turns:s.turns,usage:s.usage,observations:s.observations,diagnostics:s.diagnostics,capabilities:s.capabilities});expect(saved.relationshipEvidence).toMatchObject({metadata:s.metadata,messages:s.messages});expect(saved).toMatchObject({parserVersion:2,completedOffset:offset,observedSize:offset,aggregationReady:false,parserResumeReady:false});const stream=hash('session','claude','FICTITIOUS_SEARCH_SESSION',null);for(const id of ['call',...(records.length>2?['second']:[])]){expect(saved.events.find((e:any)=>e.id===hash('event','claude',stream,id))).toMatchObject({lookupKey:expectedKey,status:records.length===3&&id==='second'?'pending':'completed',...(records.length===3&&id==='second'?{}:{durationMs:4000,intervalTimingEvidence:'paired_timestamps',intervalScope:'invocation_latency'}),contentFingerprint:null,contentState:'unknown',lookupRange:null,changeState:'unknown'});}}
it('genuine schema6 parser1 generation upgrades once, reopens unchanged, then resumes two suffixes',async()=>{
 const f=await fixture();let db=f.db;
 try{let store={...createSourceStore(db,keyId)};const old=store.readSourceForIngestion(f.id,context);expect(old.source.parserVersion).toBe(1);expect(old.checkpoint).not.toBeNull();expect(old.source.events[0]!.lookupKey).toBeNull();const spy=vi.spyOn(ClaudeAdapter.prototype,'ingest'),writer=vi.spyOn(store,'replaceSourceSnapshotWithCheckpoint'),restore=vi.spyOn(ClaudeAdapter,'restoreCheckpoint');
 expect((await scanSources(store,context,[{provider:'claude',path:f.root}])).sources[0]).toMatchObject({status:'committed',expectedRevision:1,committedRevision:2});expect(spy).toHaveBeenCalledTimes(2);expect(writer.mock.calls[0]![3]).toBe(1);expect(writer.mock.calls[0]![4]).toEqual(old.predecessor);expect(restore.mock.calls.every(([,token])=>JSON.parse(JSON.parse(token).payload).parserVersion===2)).toBe(true);spy.mockRestore();writer.mockRestore();restore.mockRestore();semantic(store.readSource(f.id),[call(),result()],f.path);const before=rows(db);db.close();db=await openDatabase(f.data);store=createSourceStore(db,keyId);
 const unchanged=vi.spyOn(ClaudeAdapter.prototype,'ingest');expect((await scanSources(store,context,[{provider:'claude',path:f.root}])).sources[0]).toMatchObject({status:'unchanged',expectedRevision:2,reusedRevision:2});expect(unchanged).not.toHaveBeenCalled();expect(rows(db)).toEqual(before);unchanged.mockRestore();
 const records:unknown[]=[call(),result()];for(const [i,next] of [call('second'),result('second')].entries()){const prior=store.readSourceForIngestion(f.id,context);await appendFile(f.path,bytes([next]));records.push(next);const suffix=vi.spyOn(ClaudeAdapter.prototype,'ingest');expect((await scanSources(store,context,[{provider:'claude',path:f.root}])).sources[0]).toMatchObject({status:'committed',expectedRevision:2+i,committedRevision:3+i});expect(suffix).toHaveBeenCalledTimes(1);expect(suffix.mock.calls[0]![1]).toMatchObject({byteOffset:prior.source.observedSize,ordinal:2+i});suffix.mockRestore();semantic(store.readSource(f.id),records,f.path);expect(store.readSourceForIngestion(f.id,context).checkpoint!.nextOrdinal).toBe(3+i);db.close();db=await openDatabase(f.data);store=createSourceStore(db,keyId);}
 expect(JSON.stringify(rows(db))).not.toMatch(/FICTITIOUS_|source\.jsonl/);
 }finally{db.close();}
});
it('corrupt old generation seal hard-fails before parser-version fallback without writes',async()=>{const f=await fixture();try{f.db.prepare('UPDATE source_parser_checkpoints SET generation_seal=?').run(hash('source','bad-seal'));const before=rows(f.db),spy=vi.spyOn(ClaudeAdapter.prototype,'ingest');const scan=await scanSources(createSourceStore(f.db,keyId),context,[{provider:'claude',path:f.root}]);expect(scan.sources[0]!.status).toBe('failed');expect(spy).not.toHaveBeenCalled();expect(rows(f.db)).toEqual(before);}finally{f.db.close();}});
it('real peer replacement wins and original version fallback CAS cannot overwrite it',async()=>{const f=await fixture(),peer=await openDatabase(f.data);try{const store={...createSourceStore(f.db,keyId)},other=createSourceStore(peer,keyId),write=store.replaceSourceSnapshotWithCheckpoint;let winner:any;const spy=vi.spyOn(store,'replaceSourceSnapshotWithCheckpoint').mockImplementation((...args)=>{expect(args[3]).toBe(1);expect(other.replaceSourceSnapshotWithCheckpoint(...args)).toMatchObject({status:'committed',revision:2});winner=rows(peer);return write(...args);});expect((await scanSources(store,context,[{provider:'claude',path:f.root}])).sources[0]).toMatchObject({status:'stale',expectedRevision:1});expect(spy).toHaveBeenCalledTimes(1);expect(rows(f.db)).toEqual(winner);}finally{peer.close();f.db.close();}});
