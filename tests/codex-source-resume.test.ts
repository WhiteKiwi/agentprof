import { appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db/database.js";
import { createSourceStore } from "../src/db/source-store.js";
import { CodexAdapter } from "../src/parsers/codex/index.js";
import * as ingestion from "../src/scanner/source-ingest.js";
import { readSourcePrefixWithProof, readSourceSuffixWithProof, sourcePrefixOptions } from "../src/scanner/source-prefix.js";
import { scanSources } from "../src/scanner/scan-run.js";
import { temporaryDirectory } from "./helpers.js";
import { keyId,context,hmac,session,ordinary,wrappers,processes,replay,cumulative,encode,cold,allRows,call } from "./codex-resume-fixture.js";
afterEach(()=>vi.restoreAllMocks());
function projection(saved:any,expected:ReturnType<typeof cold>,size:number) {
 const s=expected.snapshot;
 expect(saved).toMatchObject({provider:"codex",completedOffset:expected.offset,observedSize:size,aggregationReady:false,parserResumeReady:false});
 expect(saved.events).toEqual([...s.events].sort((a,b)=>a.id.localeCompare(b.id)));
 expect(saved.evidence).toEqual({turns:s.turns,usage:s.usage,observations:s.observations,diagnostics:s.diagnostics,capabilities:s.capabilities});
 expect(saved.relationshipEvidence).toMatchObject({status:"captured",provider:"codex",metadata:s.metadata,wrappers:s.wrappers});expect(saved).not.toHaveProperty("checkpoint");
}
it("independent ordinary HMAC, terminal usage classification and no-match oracle",()=>{
 const s=cold(encode(ordinary),"/FICTITIOUS_SOURCE").snapshot,stream=hmac("session","codex",session),response=hmac("event","codex",stream,"response","r1");
 expect(s.events).toHaveLength(1);expect(s.events[0]).toMatchObject({id:hmac("event","codex",stream,"call"),sessionId:stream,status:"completed",executionOutcome:"no_match",exitCode:1,durationMs:4000,durationScope:"invocation_latency",timingEvidence:"paired_timestamps",contentFingerprint:null});
 expect(s.usage).toHaveLength(2);expect(s.usage[0]).toMatchObject({id:hmac("event","codex_usage",stream,"response_usage",null,response),responseId:response,scope:"response_increment",finality:"source_terminal",selection:"eligible",counts:{input:100,output:10,total:110,cachedInput:20,cacheWriteInput:5,reasoningOutput:2}});
 expect(s.usage[1]).toMatchObject({scope:"thread_cumulative",selection:"snapshot_only",counts:{total:220}});
});
it("independent process/poll replay and cumulative reset oracles",()=>{
 const p=cold(encode(processes),"/FICTITIOUS_SOURCE").snapshot;
 expect(p.events).toHaveLength(1);expect(p.events[0]).toMatchObject({status:"completed",exitCode:0,durationMs:4000});expect(p.stateCounts.pendingResults).toBe(0);
 const r=cold(encode(replay),"/FICTITIOUS_SOURCE").snapshot;expect(r.events).toHaveLength(1);expect(r.events[0]).toMatchObject({executionOutcome:"no_match",durationMs:4000});expect(r.usage).toHaveLength(2);
 const s=cold(encode(cumulative),"/FICTITIOUS_SOURCE").snapshot;expect(s.diagnostics.map(d=>d.code)).toEqual(["USAGE_RESET","REORDERED_RECORD"]);expect(s.usage.map(u=>u.counts!.total)).toEqual([110,165,88,77,110,55]);expect(s.usage.every(u=>u.selection==="snapshot_only")).toBe(true);
});
describe("persisted Codex suffix continuation",()=>{
 for(const [name,records] of [["ordinary",ordinary],["wrapper",wrappers],["process-poll",processes],["deferred-replay",replay],["cumulative-reset",cumulative]] as const) {
  it.each(Array.from({length:records.length+1},(_,i)=>i))(`${name} actual SQLite reopen split %i`,async split=>{
   const root=temporaryDirectory(),path=join(root,"input.jsonl"),data=join(root,"data"),all=encode(records),prefix=encode(records.slice(0,split)),expected=cold(all,path);
   await writeFile(path,prefix);let db=await openDatabase(data);
   try {const first=await ingestion.ingestSourceFile(createSourceStore(db,keyId),context,{path,provider:"codex",expectedRevision:null,chunkBytes:17});expect(first.status).toBe("committed");db.close();db=await openDatabase(data);
    const store=createSourceStore(db,keyId),candidate=store.readSourceForIngestion(first.sourceId,context);expect(candidate.checkpoint,"MISSING_CODEX_DURABLE_CAPTURE").not.toBeNull();expect(candidate.checkpoint!.nextOrdinal).toBe(split);
    await appendFile(path,all.subarray(prefix.length));const spy=vi.spyOn(CodexAdapter.prototype,"ingest");
    expect(await ingestion.ingestSourceFileFromCheckpoint(store,context,{path,provider:"codex",expectedRevision:1,chunkBytes:13},candidate)).toMatchObject({status:"committed",revision:2,aggregationReady:false,parserResumeReady:false});
    expect(spy).toHaveBeenCalledTimes(records.length-split);expect(spy.mock.calls.every(([,d])=>d.byteOffset>=prefix.length&&d.ordinal>=split)).toBe(true);projection(store.readSource(first.sourceId),expected,all.length);
    expect(store.readSourceForIngestion(first.sourceId,context).checkpoint!.nextOrdinal).toBe(records.length);expect(JSON.stringify(allRows(db))).not.toContain("FICTITIOUS_");
   }finally{db.close();}
  });
 }
});
it.each([1,7,19])("physical BOM/CRLF unfinished UTF8 tail resumes chunk %i",async chunkBytes=>{
 const root=temporaryDirectory(),path=join(root,"input.jsonl"),data=join(root,"data"),all=encode(ordinary,true,true),lead=all.indexOf(Buffer.from("한")),split=lead+1;expect(all[lead]).toBe(0xed);const expected=cold(all,path);
 await writeFile(path,all.subarray(0,split));let db=await openDatabase(data);
 try{const first=await ingestion.ingestSourceFile(createSourceStore(db,keyId),context,{path,provider:"codex",expectedRevision:null,chunkBytes});db.close();db=await openDatabase(data);const store=createSourceStore(db,keyId),candidate=store.readSourceForIngestion(first.sourceId,context);expect(candidate.checkpoint,"MISSING_CODEX_DURABLE_CAPTURE").not.toBeNull();expect(candidate.checkpoint!.nextOrdinal).toBe(2);await appendFile(path,all.subarray(split));const spy=vi.spyOn(CodexAdapter.prototype,"ingest");expect((await ingestion.ingestSourceFileFromCheckpoint(store,context,{path,provider:"codex",expectedRevision:1,chunkBytes},candidate)).status).toBe("committed");expect(spy).toHaveBeenCalledTimes(2);projection(store.readSource(first.sourceId),expected,all.length);}finally{db.close();}
});
it.each(["premature_lf","oversize_lf"])("physical tail %s rejects without generation change",async kind=>{
 const root=temporaryDirectory(),path=join(root,"input.jsonl"),all=encode(ordinary),lead=all.indexOf(Buffer.from("한"));
 await writeFile(path,kind==="premature_lf"?all.subarray(0,lead+1):Buffer.concat([encode([ordinary[0]]),Buffer.from('"'+"x".repeat(4096))]));const db=await openDatabase(join(root,"data"));
 try{const store=createSourceStore(db,keyId),first=await ingestion.ingestSourceFile(store,context,{path,provider:"codex",expectedRevision:null,maxLineBytes:4096}),candidate=store.readSourceForIngestion(first.sourceId,context);expect(candidate.checkpoint,"MISSING_CODEX_DURABLE_CAPTURE").not.toBeNull();const before=allRows(db);await appendFile(path,kind==="premature_lf"?"\n":'"\n');expect(await ingestion.ingestSourceFileFromCheckpoint(store,context,{path,provider:"codex",expectedRevision:1,maxLineBytes:4096,chunkBytes:1},candidate)).toMatchObject({status:"rejected",reason:"reader_error",readerDiagnostics:[{code:kind==="premature_lf"?"INVALID_UTF8":"RECORD_TOO_LARGE"}]});expect(allRows(db)).toEqual(before);}finally{db.close();}
});
it.each(["prefix_rewrite","tail_rewrite","truncate"])("stable %s safely replays from zero",async kind=>{
 const root=temporaryDirectory(),path=join(root,"input.jsonl"),prefix=Buffer.concat([encode(ordinary.slice(0,2)),Buffer.from('{"unfinished":')]);await writeFile(path,prefix);const db=await openDatabase(join(root,"data"));
 try{const store=createSourceStore(db,keyId),first=await ingestion.ingestSourceFile(store,context,{path,provider:"codex",expectedRevision:null}),candidate=store.readSourceForIngestion(first.sourceId,context);expect(candidate.checkpoint,"MISSING_CODEX_DURABLE_CAPTURE").not.toBeNull();const current=kind==="truncate"?encode([ordinary[0]]):kind==="prefix_rewrite"?encode([ordinary[0],call("exec_command","replacement"),...ordinary.slice(2)]):encode(ordinary),expected=cold(current,path);await writeFile(path,current);const spy=vi.spyOn(CodexAdapter.prototype,"ingest");expect((await ingestion.ingestSourceFileFromCheckpoint(store,context,{path,provider:"codex",expectedRevision:1},candidate)).status).toBe("committed");expect(spy).toHaveBeenCalledTimes(expected.ordinal);projection(store.readSource(first.sourceId),expected,current.length);}finally{db.close();}
});
it("scan routing appends by suffix then confirms unchanged without ingestion",async()=>{
 const root=temporaryDirectory(),path=join(root,"input.jsonl"),all=encode(ordinary),prefix=encode(ordinary.slice(0,2));await writeFile(path,prefix);const db=await openDatabase(join(root,"data"));
 try{const store=createSourceStore(db,keyId);expect((await scanSources(store,context,[{provider:"codex",path}],{})).counts.committed).toBe(1);await appendFile(path,all.subarray(prefix.length));const spy=vi.spyOn(CodexAdapter.prototype,"ingest");expect((await scanSources(store,context,[{provider:"codex",path}],{})).counts.committed).toBe(1);expect(spy).toHaveBeenCalledTimes(2);spy.mockClear();const before=allRows(db);expect((await scanSources(store,context,[{provider:"codex",path}],{})).counts.unchanged).toBe(1);expect(spy).not.toHaveBeenCalled();expect(allRows(db)).toEqual(before);}finally{db.close();}
});
it("three real close/reopen generations retain process links and replay suppression",async()=>{
 const root=temporaryDirectory(),path=join(root,"input.jsonl"),data=join(root,"data");await writeFile(path,encode(processes.slice(0,2)));let db=await openDatabase(data),count=2,revision=1;
 try{const first=await ingestion.ingestSourceFile(createSourceStore(db,keyId),context,{path,provider:"codex",expectedRevision:null});expect(first.status).toBe("committed");
  for(const end of [3,4,6]){db.close();db=await openDatabase(data);const store=createSourceStore(db,keyId),candidate=store.readSourceForIngestion(first.sourceId,context);expect(candidate.checkpoint,"MISSING_CODEX_DURABLE_CAPTURE").not.toBeNull();await appendFile(path,encode(processes.slice(count,end)));const expected=cold(encode(processes.slice(0,end)),path),spy=vi.spyOn(CodexAdapter.prototype,"ingest");try{expect(await ingestion.ingestSourceFileFromCheckpoint(store,context,{path,provider:"codex",expectedRevision:revision},candidate)).toMatchObject({status:"committed",revision:++revision});expect(spy).toHaveBeenCalledTimes(end-count);projection(store.readSource(first.sourceId),expected,encode(processes.slice(0,end)).length);}finally{spy.mockRestore();}count=end;}
 }finally{db.close();}
});

it("independent nonempty wrapper IDs and pending-to-complete state",()=>{
 const stream=hmac("session","codex",session),id=hmac("event","codex",stream,"wrapper"),pending=cold(encode(wrappers.slice(0,2)),"/FICTITIOUS_SOURCE").snapshot,complete=cold(encode(wrappers),"/FICTITIOUS_SOURCE").snapshot;
 expect(pending.wrappers).toHaveLength(1);expect(pending.wrappers[0]).toMatchObject({id,sessionId:stream,kind:"code_wrapper",callSeen:true,resultSeen:false,relationship:"unknown",childEventIds:[]});
 expect(complete.wrappers).toHaveLength(1);expect(complete.wrappers[0]).toMatchObject({id,sessionId:stream,kind:"code_wrapper",callSeen:true,resultSeen:true,relationship:"unknown",childEventIds:[]});expect(complete.stateCounts.wrappers).toBe(1);
});

// Direct reader allowlist regression: no store/checkpoint capture precondition.
it("direct source suffix accepts Codex and consumes only appended records",async()=>{
 const root=temporaryDirectory(),path=join(root,"input.jsonl"),prefix=encode(ordinary.slice(0,2)),all=encode(ordinary),options=sourcePrefixOptions({chunkBytes:7}),contract={sourceId:hmac("source","codex",path),provider:"codex" as const,parserVersion:cold(prefix,path).snapshot.capabilities.parserVersion};
 await writeFile(path,prefix);const old=await readSourcePrefixWithProof(path,context,contract,()=>true,options);expect(old.status).toBe("observed");if(old.status!=="observed")throw Error("PREFIX_FIXTURE_NOT_OBSERVED");
 const candidate={...contract,observedSize:old.observedSize,completedOffset:old.completedOffset,boundaryFingerprint:old.boundaryFingerprint,contentFingerprint:old.contentFingerprint,nextOrdinal:old.records,maxFileBytes:options.maxFileBytes,maxRecords:options.maxRecords,maxLineBytes:options.maxLineBytes};
 await appendFile(path,all.subarray(prefix.length));const consumed:any[]=[];const suffix=await readSourceSuffixWithProof(path,context,candidate,e=>{consumed.push(e);return true;},options);
 expect(suffix).toMatchObject({status:"observed",completedOffset:all.length,observedSize:all.length,pendingBytes:0,records:4});expect(consumed).toHaveLength(2);expect(consumed.map(e=>e.value)).toEqual(ordinary.slice(2));expect(consumed.map(e=>e.byteOffset)).toEqual([prefix.length,encode(ordinary.slice(0,3)).length]);
 const full=await readSourcePrefixWithProof(path,context,contract,()=>true,options);expect(suffix).toEqual(full);
});
it("direct source suffix rejects an unknown provider before consuming",async()=>{
 const root=temporaryDirectory(),path=join(root,"input.jsonl"),prefix=encode(ordinary.slice(0,2)),options=sourcePrefixOptions({}),contract={sourceId:hmac("source","codex",path),provider:"codex" as const,parserVersion:cold(prefix,path).snapshot.capabilities.parserVersion};await writeFile(path,prefix);const old=await readSourcePrefixWithProof(path,context,contract,()=>true,options);expect(old.status).toBe("observed");if(old.status!=="observed")throw Error("PREFIX_FIXTURE_NOT_OBSERVED");
 const consume=vi.fn(()=>true),candidate={...contract,provider:"unknown",observedSize:old.observedSize,completedOffset:old.completedOffset,boundaryFingerprint:old.boundaryFingerprint,contentFingerprint:old.contentFingerprint,nextOrdinal:old.records,maxFileBytes:options.maxFileBytes,maxRecords:options.maxRecords,maxLineBytes:options.maxLineBytes};
 await expect(readSourceSuffixWithProof(path,context,candidate as any,consume,options)).rejects.toMatchObject({code:"INVALID_ARGUMENT"});expect(consume).not.toHaveBeenCalled();
});
