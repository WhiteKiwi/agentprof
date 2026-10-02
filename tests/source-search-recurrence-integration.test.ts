import { readFile,readdir,stat,writeFile,rm } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { describe,expect,it,vi } from "vitest";
import { stored,four,call,result,keyId,secret } from "./search-recurrence-fixture.js";
import { runStats,formatStatsResult } from "../src/cli/stats.js";
import * as analyzer from "../src/analysis/source-search-recurrence.js";
import * as stores from "../src/db/source-store.js";
import { openDatabase } from "../src/db/database.js";
import { HEADER_FIELDS } from "../src/db/source-validation.js";
async function prepare(records: readonly unknown[]=four) {
 const x=await stored(records); await writeFile(join(x.data,"identity-key.json"),JSON.stringify({keyVersion:1,keyId,secret:secret.toString("hex")})+"\n",{mode:0o600}); await rm(x.path); return x;
}
const snapshot=async(data:string)=>Promise.all((await readdir(data)).sort().map(async name=>({name,mode:(await stat(join(data,name))).mode,sha256:createHash("sha256").update(await readFile(join(data,name))).digest("hex")})));
async function run(x:Awaited<ReturnType<typeof prepare>>) {const r=await runStats({dataDir:x.data,source:x.source.sourceId,searchRecurrence:true});expect(r.mode).toBe("selected_source_search_recurrence");if(r.mode!=="selected_source_search_recurrence")throw Error("wrong mode");return r;}
describe("actual raw adapter through persisted read-only stats",()=>{
 it("after raw deletion returns exact four-call result and unchanged private files",async()=>{
  const x=await prepare(),before=await snapshot(x.data),r=await run(x);
  expect(r.analysis.partitions[0]).toMatchObject({validSearchN:4,uniqueLookupN:2,repeatN:2,repeatRatio:0.5});
  expect(r.analysis).toMatchObject({sourceId:x.source.sourceId,revision:1,parserVersion:2,completedOffset:Buffer.byteLength(x.raw),observedSize:Buffer.byteLength(x.raw),sourceFreshnessChecked:false,crossSourceReconciled:false,aggregationReady:false,parserResumeReady:false});
  expect(JSON.parse(formatStatsResult(r,true)).result).toEqual(r);expect(formatStatsResult(r,false)).toContain("N=4; U=2; repeats=2; ratio=0.5 (2/4)");
  for(const text of [formatStatsResult(r,true),formatStatsResult(r,false)]){expect(text).not.toMatch(/FICTITIOUS_|lookupKey|operationKey|sourceRef|searchQuery|searchRoot|searchOptions/);for(const e of x.admitted)expect(text).not.toContain(e.lookupKey!);}
  expect(await snapshot(x.data)).toEqual(before);
 });
 it("one pinned read and one analyzer invocation with exact source generation",async()=>{
  const x=await prepare(),original=stores.createSourceStore;let reads=0;
  const storeSpy=vi.spyOn(stores,"createSourceStore").mockImplementation((db,key)=>{const store=original(db,key);return{...store,readSource(id){reads++;expect(db.isTransaction).toBe(true);expect(id).toBe(x.source.sourceId);return store.readSource(id);},listSources(){throw Error("unexpected list");}};});
  const analysisSpy=vi.spyOn(analyzer,"analyzeSourceSearchRecurrence");
  try{const r=await run(x);expect(reads).toBe(1);expect(analysisSpy).toHaveBeenCalledTimes(1);expect(analysisSpy.mock.calls[0]![0].revision).toBe(r.analysis.revision);}finally{storeSpy.mockRestore();analysisSpy.mockRestore();}
 });
 it.each(["missing-version","missing-project"])("mixed %s remains wholly unknown in real storage",async shape=>{
  const records=shape==="missing-project"?[call("missing",undefined,{}, {cwd:undefined}),result("missing"),call("known"),result("known")]:[call("known"),result("known"),call("missing",undefined,{}, {version:undefined}),result("missing")];
  const r=await run(await prepare(records));expect(r.analysis.partitions[0]).toMatchObject({candidateSearchN:2,missingLookupN:1,validSearchN:null,uniqueLookupN:null,repeatN:null,repeatRatio:null,cohorts:null});
 });
 it("historical parser1 remains readable without migration or metric inference",async()=>{
  const x=await prepare(),db=await openDatabase(x.data),store=stores.createSourceStore(db,keyId);
  const input={...Object.fromEntries(HEADER_FIELDS.map(k=>[k,x.source[k]])),parserVersion:1,events:x.source.events.map(e=>({...e,lookupKey:null})),evidence:{...x.source.evidence!,capabilities:{...x.source.evidence!.capabilities,parserVersion:1}},relationshipEvidence:x.source.relationshipEvidence};
  try{expect(store.replaceSourceSnapshot(input as never,1).status).toBe("committed");}finally{db.close();}
  const before=await snapshot(x.data),r=await run(x);expect(r.analysis).toMatchObject({parserVersion:1,suppressionReason:"unsupported_metric_contract"});expect(r.analysis.partitions[0]!.repeatRatio).toBeNull();
  const ordinary=await runStats({dataDir:x.data,source:x.source.sourceId});expect(ordinary.mode).toBe("selected_source");expect(await snapshot(x.data)).toEqual(before);
 });
 it("wrong key and missing identity preserve store and permit later success",async()=>{
  const x=await prepare(),before=await snapshot(x.data);
  for(const [id,code] of [[x.source.sourceId.replace(keyId,"9".repeat(32)),"INVALID_IDENTITY_KEY"],[`h1:${keyId}:source:${"0".repeat(64)}`,"SOURCE_NOT_FOUND"]])await expect(runStats({dataDir:x.data,source:id,searchRecurrence:true})).rejects.toMatchObject({code});
  expect(await snapshot(x.data)).toEqual(before);await run(x);expect(await snapshot(x.data)).toEqual(before);
 });
 it("existing modes never call the new metric analyzer",async()=>{
  const x=await prepare(),spy=vi.spyOn(analyzer,"analyzeSourceSearchRecurrence").mockImplementation(()=>{throw Error("not selected");});
  try{for(const selection of [{source:x.source.sourceId},{listSources:true},{source:x.source.sourceId,failures:true},{source:x.source.sourceId,readRevisits:true},{source:x.source.sourceId,invocationOverlap:true}])await runStats({dataDir:x.data,...selection});expect(spy).not.toHaveBeenCalled();}finally{spy.mockRestore();}
 });
});
