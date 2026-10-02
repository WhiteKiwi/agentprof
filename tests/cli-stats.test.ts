import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { temporaryDirectory } from "./helpers.js";
import { runStats, formatStatsResult } from "../src/cli/stats.js";
import { openDatabase } from "../src/db/database.js";
import { createSourceStore } from "../src/db/source-store.js";
import { loadOrCreateIdentityContext } from "../src/normalize/identity.js";
import { summarizeSource } from "../src/analysis/source-summary.js";
const binary=fileURLToPath(new URL('../dist/agentprof.cjs',import.meta.url));
const full='h1:'+ 'a'.repeat(32)+':source:'+ 'b'.repeat(64);
const run=(args:string[])=>spawnSync(process.execPath,[binary,...args],{encoding:'utf8',env:{...process.env,CLAUDE_CONFIG_DIR:'\nINVALID_UNRELATED'}});
function bytes(dir:string){return readdirSync(dir).sort().map(name=>({name,bytes:readFileSync(join(dir,name)),mode:statSync(join(dir,name)).mode}));}
it.each([
 ['stats'],['stats','--source','bad'],['stats','--last','7d'],['stats','--list-sources','--source',full],['stats','--source',full,'--source',full],['stats','--list-sources','--list-sources'],['stats','--list-sources','--codex-root','RAW_PRIVATE_SENTINEL'],['--claude-root','RAW_PRIVATE_SENTINEL','stats','--list-sources'],['stats','--source',full.slice(0,-1)],['stats','--source',full.replace(':source:',':event:')],
])('rejects invalid selection before I/O: %j',args=>{
 const dir=join(temporaryDirectory(),'must-not-create');const r=run(['--json','--data-dir',dir,...args]);expect(r.status).toBe(2);expect(r.stdout).toBe('');expect(existsSync(dir)).toBe(false);expect(r.stderr).not.toMatch(/RAW_PRIVATE_SENTINEL|ExperimentalWarning/);expect(JSON.parse(r.stderr).error.code).toBe(args.length===1?'STATS_SELECTION_REQUIRED':'INVALID_ARGUMENT');
});
it('stats help is storage-free and communicates supported scope',()=>{const dir=join(temporaryDirectory(),'missing');const r=run(['stats','--help','--data-dir',dir]);expect(r.status).toBe(0);expect(r.stdout).toContain('Exactly one');expect(r.stdout).toContain('DELETE');expect(existsSync(dir)).toBe(false);});
it('absent store produces a fixed error without creating it',()=>{const dir=join(temporaryDirectory(),'missing');const r=run(['stats','--list-sources','--data-dir',dir,'--json']);expect(r.status).toBe(2);expect(JSON.parse(r.stderr).error.code).toBe('STORE_NOT_FOUND');expect(existsSync(dir)).toBe(false);});
it('scans two synthetic providers then lists/selects exact summaries without input roots or mutation',async()=>{
 const root=temporaryDirectory(), data=join(root,'data'); const roots=[];
 for(const provider of ['codex','claude']){const path=join(root,provider);await mkdir(path);await copyFile(fileURLToPath(new URL(`fixtures/providers/${provider}-real-shapes.jsonl`,import.meta.url)),join(path,'synthetic.jsonl'));roots.push('--'+provider+'-root',path);}
 const scanned=run(['scan',...roots,'--data-dir',data,'--json']);expect(scanned.status).toBe(1);expect(JSON.parse(scanned.stdout).result.counts.committed).toBe(2);
 // Removing synthetic inputs proves stats does not reopen them.
 await rm(join(root,'codex'),{recursive:true});await rm(join(root,'claude'),{recursive:true});
 const context=await loadOrCreateIdentityContext(data);const db=await openDatabase(data);const store=createSourceStore(db,context.keyId);
 const expected=store.listSources().items.map(i=>summarizeSource(store.readSource(i.sourceId)!));db.close();const before=bytes(data);
 for(const args of [['--data-dir',data,'--json','stats','--list-sources'],['stats','--list-sources','--json','--data-dir',data]]){const r=run(args);expect(r.status).toBe(0);const c=JSON.parse(r.stdout).result.catalogue;expect(c.returnedCount).toBe(2);expect(c.truncated).toBe(false);}
 for(const summary of expected){const r=run(['stats','--source',summary.sourceId,'--data-dir',data,'--json']);expect(r.status).toBe(0);const result=JSON.parse(r.stdout).result;expect(result.summary).toEqual(summary);expect(result.sourceFreshnessChecked).toBe(false);
  const human=run(['--data-dir',data,'stats','--source',summary.sourceId]);expect(human.status).toBe(0);expect(human.stdout).toBe(formatStatsResult(result,false));expect(human.stdout).toContain('Freshness and other-source conflicts were not checked');
  if(summary.provider==='claude'){expect(summary.usage).toBeNull();expect(human.stdout).toContain('no eligible final-response observations');expect(human.stdout).not.toContain('(suppressed');}else expect(summary.usage![0]!.counts.total).toBe(92);
  expect(r.stdout+human.stdout).not.toMatch(/FICTITIOUS_|synthetic.jsonl|boundaryFingerprint|secret/);
 }
 expect(bytes(data)).toEqual(before);
});
it('distinguishes missing from empty and unavailable sources, preserving actual revision',async()=>{
 const data=temporaryDirectory();const ctx=await loadOrCreateIdentityContext(data);const db=await openDatabase(data);const store=createSourceStore(db,ctx.keyId);const id=ctx.fingerprint('source',['empty']);
 const input={sourceId:id,provider:'codex' as const,parserVersion:1,normalizationVersion:1 as const,keyVersion:1 as const,keyId:ctx.keyId,completedOffset:0,observedSize:0,boundaryFingerprint:null,events:[]};
 db.close();await expect(runStats({dataDir:data,source:id})).rejects.toMatchObject({code:'SOURCE_NOT_FOUND'});
 const writer=await openDatabase(data);const s=createSourceStore(writer,ctx.keyId);s.replaceSource(input,null);writer.close();
 const result=await runStats({dataDir:data,source:id});expect(result.mode).toBe('selected_source');if(result.mode==='selected_source'){expect(result.summary).toMatchObject({revision:1,suppressionReason:'evidence_absent',durations:null,usage:null});expect(formatStatsResult(result,false)).toContain('suppressed: evidence_absent');}
 const w=await openDatabase(data);createSourceStore(w,ctx.keyId).markUnavailable(id,1);w.close();const again=await runStats({dataDir:data,source:id});if(again.mode==='selected_source')expect(again.summary).toMatchObject({revision:2,suppressionReason:'source_unavailable'});
});
it('keeps archive/live copies separate and repeated scans retain metrics and the reused revision',async()=>{
 const root=temporaryDirectory(),data=join(root,'data'),input=join(root,'input');await mkdir(input);
 const fixture=fileURLToPath(new URL('fixtures/providers/codex-real-shapes.jsonl',import.meta.url));
 await copyFile(fixture,join(input,'live.jsonl'));await copyFile(fixture,join(input,'archive.jsonl'));
 const args=['scan','--codex-root',input,'--data-dir',data,'--json'];
 const first=run(args);expect(JSON.parse(first.stdout).result.counts.committed).toBe(2);
 const list=await runStats({dataDir:data,listSources:true});if(list.mode!=='list_sources')throw Error();
 const originals=[];
 for(const item of list.catalogue.items){const r=await runStats({dataDir:data,source:item.sourceId});if(r.mode!=='selected_source')throw Error();expect(r.summary.revision).toBe(1);expect(r.summary.usage![0]!.counts.total).toBe(92);originals.push(r.summary);}
 expect(originals[0]!.sourceId).not.toBe(originals[1]!.sourceId);
 const again=run(args);expect(JSON.parse(again.stdout).result.counts.unchanged).toBe(2);
 for(const summary of originals){const r=await runStats({dataDir:data,source:summary.sourceId});if(r.mode!=='selected_source')throw Error();expect(r.summary).toEqual(summary);}
});
it('labels healthy empty and actual zero cohorts consistently with JSON',async()=>{
 const root=temporaryDirectory(),data=join(root,'data'),inputRoot=join(root,'input');await mkdir(inputRoot);
 await copyFile(fileURLToPath(new URL('fixtures/providers/codex-real-shapes.jsonl',import.meta.url)),join(inputRoot,'synthetic.jsonl'));
 run(['scan','--codex-root',inputRoot,'--data-dir',data,'--json']);
 const ctx=await loadOrCreateIdentityContext(data),db=await openDatabase(data),store=createSourceStore(db,ctx.keyId);
 const id=store.listSources().items[0]!.sourceId,saved=store.readSource(id)!;
 const {revision,availability,persistedScope,aggregationReady,parserResumeReady,...input}=saved;
 const zero={...input,events:input.events.map(e=>({...e,durationMs:e.durationMs===null?null:0})),evidence:{...input.evidence!,usage:input.evidence!.usage.map(u=>({...u,counts:u.counts===null?null:Object.fromEntries(Object.entries(u.counts).map(([k,v])=>[k,v===null?null:0]))}))}};
 expect(store.replaceSourceSnapshot(zero as typeof input,revision).status).toBe('committed');db.close();
 const zeroResult=await runStats({dataDir:data,source:id});if(zeroResult.mode!=='selected_source')throw Error();
 expect(zeroResult.summary.usage![0]!.counts.total).toBe(0);expect(zeroResult.summary.durations![0]!.sumMs).toBe(0);
 const human=run(['stats','--source',id,'--data-dir',data]);expect(human.stdout).toBe(formatStatsResult(zeroResult,false));expect(human.stdout).toMatch(/1\s+\| 1\s+\| 0\s+\| 0\s+\| 0\s+\| 0\s+\| 0\*/);expect(human.stdout).toMatch(/0\s+\| 0\s+\| 0\s+\| 0\s+\| 0\s+\| 0\s+\| unknown/);expect(human.stdout).not.toContain('(suppressed');
 const {createCodexAdapter}=await import('../src/parsers/codex/index.js');const empty=createCodexAdapter(ctx).snapshot();
 const writer=await openDatabase(data);createSourceStore(writer,ctx.keyId).replaceSourceSnapshot({...input,relationshipEvidence:null,completedOffset:0,observedSize:0,boundaryFingerprint:null,events:[],evidence:{turns:empty.turns,usage:empty.usage,observations:empty.observations,diagnostics:empty.diagnostics,capabilities:empty.capabilities}},2);writer.close();
 const result=await runStats({dataDir:data,source:id});if(result.mode!=='selected_source')throw Error();expect(result.summary.suppressionReason).toBeNull();expect(result.summary.durations).toBeNull();expect(result.summary.usage).toBeNull();
 const text=run(['stats','--source',id,'--data-dir',data]);expect(text.stdout).toBe(formatStatsResult(result,false));expect(text.stdout).toContain('no eligible measured observations; totals unknown');expect(text.stdout).toContain('no eligible final-response observations; token totals unknown');expect(text.stdout).not.toContain('(suppressed');
 const json=run(['stats','--source',id,'--data-dir',data,'--json']);expect(JSON.parse(json.stdout).result).toEqual(result);
});
