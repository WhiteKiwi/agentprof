import { createHash, createHmac } from "node:crypto";
import { readFile, writeFile, mkdir, rm, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { expect, it, vi } from "vitest";
import { temporaryDirectory } from "./helpers.js";
import { runScan } from "../src/cli/scan.js";
import { runReport } from "../src/cli/report.js";
import { runStats } from "../src/cli/stats.js";
import { runInsights } from "../src/cli/insights.js";
import { openDatabase } from "../src/db/database.js";
import * as stores from "../src/db/source-store.js";
import * as overlap from "../src/analysis/source-invocation-overlap.js";
import * as timeline from "../src/report/invocation-timeline.js";
const sentinel="SYNTHETIC_TIMELINE_PRIVATE_<script>alert(1)</script>",epoch=Date.UTC(2026,9,2),at=(ms:number)=>new Date(epoch+ms).toISOString();
async function snapshot(data:string){return Promise.all((await readdir(data)).sort().map(async name=>({name,hash:createHash("sha256").update(await readFile(join(data,name))).digest("hex"),mode:(await stat(join(data,name))).mode})));}
async function fixture(provider:"claude"|"codex"="claude"){
 const root=temporaryDirectory(),input=join(root,"input"),data=join(root,"data"),path=join(input,"synthetic.jsonl"),output=join(root,"report.html");await mkdir(input);
 const records=provider==="claude"?[[0,10000],[5000,15000]].flatMap(([start,end],i)=>[
  {type:"assistant",uuid:`call-${i}`,sessionId:"SYNTHETIC_TIMELINE",cwd:`/${sentinel}`,isSidechain:false,timestamp:at(start!),message:{id:`response-${i}`,role:"assistant",content:[{type:"tool_use",id:`tool-${i}`,name:"Bash",input:{command:`npm test '${sentinel}'`}}]}},
  {type:"user",uuid:`result-${i}`,sessionId:"SYNTHETIC_TIMELINE",isSidechain:false,timestamp:at(end!),message:{role:"user",content:[{type:"tool_result",tool_use_id:`tool-${i}`,is_error:i===1,content:sentinel}]}}
 ]):[{timestamp:at(0),type:"session_meta",payload:{id:"SYNTHETIC_TIMELINE",cwd:`/${sentinel}`}},{timestamp:at(10000),type:"event_msg",payload:{type:"item_completed",thread_id:"SYNTHETIC_TIMELINE",item:{type:"CommandExecution",id:"one",source:"unified_exec_startup",command:`npm test '${sentinel}'`,status:"completed",exit_code:0,duration:{secs:10,nanos:0},output:sentinel}}}];
 await writeFile(path,records.map(r=>JSON.stringify(r)).join("\n")+"\n");const scan=await runScan({dataDir:data,codexRoot:provider==="codex"?[input]:[],claudeRoot:provider==="claude"?[input]:[]});expect(scan.counts.committed).toBe(1);
 const key=JSON.parse(await readFile(join(data,"identity-key.json"),"utf8")),sourceId=`h1:${key.keyId}:source:`+createHmac("sha256",Buffer.from(key.secret,"hex")).update(JSON.stringify([1,1,"source",provider,path])).digest("hex");
 const db=await openDatabase(data);let saved:NonNullable<ReturnType<ReturnType<typeof stores.createSourceStore>["readSource"]>>;
 try{saved=stores.createSourceStore(db,key.keyId).readSource(sourceId)!;}finally{db.close();}
 expect(saved!.parserVersion).toBe(provider==="claude"?2:1);return {root,input,data,path,output,sourceId,key,saved:saved!};
}
it("renders literal ordinary raw overlap after deletion with unchanged store, stats and insights",async()=>{
 const f=await fixture(),native=overlap.analyzeSourceInvocationOverlap(f.saved);expect(native.partitions[0]).toMatchObject({intervalLengthSumMs:20000,intervalUnionMs:15000,excessMs:5000});
 const before=await snapshot(f.data),stats=await runStats({dataDir:f.data,source:f.sourceId,invocationOverlap:true}),insights=await runInsights({dataDir:f.data,source:f.sourceId});
 await runReport({dataDir:f.data,source:f.sourceId,output:f.output});const html=await readFile(f.output,"utf8");await rm(f.input,{recursive:true});await runReport({dataDir:f.data,source:f.sourceId,output:join(f.root,"again.html")});expect(await readFile(join(f.root,"again.html"),"utf8")).toBe(html);
 expect(html).toContain("20000 ms");expect(html).toContain("15000 ms");expect(html).toContain("5000 ms");expect(html).toContain("failed");expect(html).toContain('class="invocation-interval"');expect(html).not.toContain(sentinel);expect(html).not.toContain(f.key.secret);expect(html).not.toContain(f.path);for(const e of f.saved.events){expect(html).not.toContain(e.id);expect(html).not.toContain(e.startAt!);}
 expect((await stat(f.output)).mode&0o777).toBe(0o600);expect(await snapshot(f.data)).toEqual(before);expect((await readdir(f.data)).some(n=>/-journal$|-wal$|-shm$/.test(n))).toBe(false);expect(await runStats({dataDir:f.data,source:f.sourceId,invocationOverlap:true})).toEqual(stats);expect(await runInsights({dataDir:f.data,source:f.sourceId})).toEqual(insights);
});
it("runs one overlap analysis and join on the exact single pinned source generation",async()=>{
 const f=await fixture(),originalStore=stores.createSourceStore,originalAnalysis=overlap.analyzeSourceInvocationOverlap,originalJoin=timeline.buildSourceInvocationTimeline;let reads=0,analyses=0,joins=0,selected:unknown,measured:unknown,inTransaction:()=>boolean=()=>false;
 const storeSpy=vi.spyOn(stores,"createSourceStore").mockImplementation((db,key)=>{const value=originalStore(db,key);inTransaction=()=>db.isTransaction;return {...value,readSource(id){reads++;expect(inTransaction()).toBe(true);selected=value.readSource(id);return selected as ReturnType<typeof value.readSource>;},listSources(){throw new Error("unexpected catalogue");}};});
 const analysisSpy=vi.spyOn(overlap,"analyzeSourceInvocationOverlap").mockImplementation(source=>{analyses++;expect(source).toBe(selected);expect(inTransaction()).toBe(true);measured=originalAnalysis(source);return measured as ReturnType<typeof originalAnalysis>;});
 const joinSpy=vi.spyOn(timeline,"buildSourceInvocationTimeline").mockImplementation((source,analysis)=>{joins++;expect(source).toBe(selected);expect(analysis).toBe(measured);expect(inTransaction()).toBe(true);return originalJoin(source,analysis);});
 try{await runReport({dataDir:f.data,source:f.sourceId,output:f.output});expect([reads,analyses,joins]).toEqual([1,1,1]);}finally{storeSpy.mockRestore();analysisSpy.mockRestore();joinSpy.mockRestore();}
});
it("keeps Codex suppressed and does not draw its process durations as invocations",async()=>{const f=await fixture("codex");await runReport({dataDir:f.data,source:f.sourceId,output:f.output});const html=await readFile(f.output,"utf8");expect(html).toContain("unsupported_provider");expect(html).toContain('id="invocation-timeline-notice"');expect(html).not.toContain('class="invocation-chart"');expect(html).toContain("process_runtime");});
it("preserves no-overwrite publication and validates selection before any store read",async()=>{
 const f=await fixture(),before=await snapshot(f.data);await writeFile(f.output,"EXISTING_SYNTHETIC_OUTPUT");await expect(runReport({dataDir:f.data,source:f.sourceId,output:f.output})).rejects.toMatchObject({code:"REPORT_OUTPUT_UNSAFE"});expect(await readFile(f.output,"utf8")).toBe("EXISTING_SYNTHETIC_OUTPUT");
 const spy=vi.spyOn(stores,"createSourceStore");try{await expect(runReport({dataDir:f.data,source:"malformed",output:join(f.root,"invalid.html")})).rejects.toMatchObject({code:"INVALID_ARGUMENT"});expect(spy).not.toHaveBeenCalled();}finally{spy.mockRestore();}expect(await snapshot(f.data)).toEqual(before);
});
const installed=process.env.AGENTPROF_REPORT_INSTALLED_BINARY,current=fileURLToPath(new URL("../dist/agentprof.cjs",import.meta.url));
const invoke=(binary:string,args:string[])=>spawnSync(process.execPath,[binary,...args],{encoding:"utf8",env:{...process.env,NODE_OPTIONS:"--max-old-space-size=512 --disable-warning=ExperimentalWarning"}});
it.skipIf(!installed).each(["claude","codex"] as const)("packed-installed %s report matches current bytes and preserves neighboring command output",async provider=>{
 const f=await fixture(provider);await rm(f.input,{recursive:true});const before=await snapshot(f.data),args=["report","--source",f.sourceId,"--output",f.output,"--data-dir",f.data,"--json"],local=invoke(current,args);expect(local.status,local.stderr).toBe(0);const html=await readFile(f.output,"utf8");await rm(f.output);const packed=invoke(installed!,args);expect(packed).toMatchObject({status:local.status,stdout:local.stdout,stderr:local.stderr});expect(await readFile(f.output,"utf8")).toBe(html);
 for(const command of [["stats"],["stats","--invocation-overlap"],["insights"]]){const params=[...command,"--source",f.sourceId,"--data-dir",f.data,"--json"],a=invoke(current,params),b=invoke(installed!,params);expect(b).toMatchObject({status:a.status,stdout:a.stdout,stderr:a.stderr});expect(a.status).toBe(0);}expect(await snapshot(f.data)).toEqual(before);
});
