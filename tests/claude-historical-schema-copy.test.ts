import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { temporaryDirectory } from './helpers.js';
import { migrateHistoricalSchema5Copy } from './claude-historical-schema-copy.js';

const baseline = process.env['AGENTPROF_SCHEMA5_BASELINE_BINARY'];
const current = fileURLToPath(new URL('../dist/agentprof.cjs', import.meta.url));
function files(path: string) {
  return {mode:statSync(path).mode, files:readdirSync(path).sort().map(name => ({name, mode:statSync(join(path,name)).mode, bytes:readFileSync(join(path,name))}))};
}
function invoke(binary: string, data: string, args: string[]) {
  const result = spawnSync(process.execPath,[binary,'--data-dir',data,...args],{encoding:'utf8',env:{...process.env,NODE_NO_WARNINGS:'1'}});
  expect(result.error).toBeUndefined(); expect(result.signal).toBeNull();
  return {status:result.status,stdout:result.stdout,stderr:result.stderr};
}
it.skipIf(!baseline)('rejects authentic schema5 read-only, then explicitly migrates only a copy preserving parser1 and exact historical reads', async () => {
  const root=temporaryDirectory(), old=join(root,'old'), copy=join(root,'migrated-copy'), input=join(root,'input');
  mkdirSync(old,{mode:0o700}); mkdirSync(input);
  writeFileSync(join(old,'identity-key.json'),JSON.stringify({keyVersion:1,keyId:'9'.repeat(32),secret:'ab'.repeat(32)})+'\n',{mode:0o600});
  const raw=[
    {type:'assistant',uuid:'synthetic-call',sessionId:'synthetic-schema-copy',isSidechain:false,cwd:'/SYNTHETIC_SCHEMA_ROOT',timestamp:'2026-09-01T00:00:00.000Z',message:{id:'synthetic-response',role:'assistant',content:[{type:'tool_use',id:'synthetic-tool',name:'Read',input:{file_path:'synthetic.ts'}}]}},
    {type:'user',uuid:'synthetic-result',sessionId:'synthetic-schema-copy',isSidechain:false,timestamp:'2026-09-01T00:00:04.000Z',message:{role:'user',content:[{type:'tool_result',tool_use_id:'synthetic-tool',is_error:false,content:'SYNTHETIC_RESULT'}]}}
  ].map(x=>JSON.stringify(x)+'\n').join('');
  writeFileSync(join(input,'source.jsonl'),raw);
  const seeded=invoke(baseline!,old,['scan','--claude-root',input,'--json']); expect(seeded.status).toBe(1); expect(seeded.stderr).toBe('');
  const seededResult=JSON.parse(seeded.stdout);
  expect(seededResult).toMatchObject({ok:false,result:{status:'partial',stopReason:null,counts:{committed:1,rejected:0,stale:0,failed:0}}});
  expect(seededResult.result.sources).toEqual([expect.objectContaining({status:'committed',expectedRevision:null,committedRevision:1,capabilities:expect.objectContaining({provider:'claude',parserVersion:1,coverage:'partial'})})]);
  expect(seededResult.result.diagnostics).toEqual({observedCount:1,adapterDroppedCount:0,sampleDroppedCount:0,samples:[{code:'INSUFFICIENT_LOOKUP_EVIDENCE',severity:'warning',sourceAlias:'source-1',byteOffset:0}]});
  const prior=new DatabaseSync(join(old,'agentprof.sqlite'),{readOnly:true});
  let oldHeader: unknown, oldEvents: unknown;
  try {
    expect(prior.prepare('PRAGMA user_version').get()).toEqual({user_version:5});
    oldHeader=prior.prepare('SELECT * FROM source_event_headers').all(); oldEvents=prior.prepare('SELECT * FROM source_event_contributions').all();
    expect(oldHeader).toEqual([expect.objectContaining({parser_version:1,revision:1})]);
    expect(prior.prepare("SELECT name FROM sqlite_schema WHERE name='source_parser_checkpoints'").all()).toEqual([]);
  } finally {prior.close();}
  const sourceId=JSON.parse(invoke(baseline!,old,['stats','--list-sources','--json']).stdout).result.catalogue.items[0].sourceId;
  const selections=[['stats','--list-sources'],['stats','--source',sourceId],['insights','--source',sourceId],['stats','--source',sourceId,'--failures']];
  const frozen=files(old);
  for(const args of selections) {
    const rejected=invoke(current,old,[...args,'--json']);
    expect(rejected.status).toBe(2); expect(rejected.stdout).toBe('');
    expect(JSON.parse(rejected.stderr).error).toEqual({code:'DATABASE_SCHEMA_INCOMPATIBLE',message:'Read-only source commands require a compatible existing database. No migration was attempted.'});
    expect(files(old)).toEqual(frozen);
  }
  await migrateHistoricalSchema5Copy(old,copy);
  expect(files(old)).toEqual(frozen);
  const migrated=new DatabaseSync(join(copy,'agentprof.sqlite'),{readOnly:true});
  try {
    expect(migrated.prepare('PRAGMA user_version').get()).toEqual({user_version:7});
    expect(migrated.prepare('SELECT * FROM source_event_headers').all()).toEqual(oldHeader);
    expect(migrated.prepare('SELECT * FROM source_event_contributions').all()).toEqual(oldEvents);
    expect(migrated.prepare('SELECT * FROM source_parser_checkpoints').all()).toEqual([]);
  } finally {migrated.close();}
  const migratedFrozen=files(copy);
  for(const args of selections) for(const json of [[],['--json']]) expect(invoke(current,copy,[...args,...json])).toEqual(invoke(baseline!,old,[...args,...json]));
  expect(files(copy)).toEqual(migratedFrozen); expect(files(old)).toEqual(frozen);
},30_000);
