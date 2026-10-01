import { mkdir, writeFile, rm, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { analyzeSourceFailures } from "../src/analysis/source-failures.js";
import { openDatabase } from "../src/db/database.js";
import { createSourceStore } from "../src/db/source-store.js";
import { loadOrCreateIdentityContext } from "../src/normalize/identity.js";
import { runScan } from "../src/cli/scan.js";
import { temporaryDirectory } from "./helpers.js";
// Frozen ordinary inputs and statuses were independently observed before analyzer implementation.
const epoch=Date.UTC(2026,8,20), at=ms=>new Date(epoch+ms).toISOString();
const record=(payload,ms=0,type='response_item')=>({timestamp:at(ms),type,payload});
const metadata=()=>record({id:'failure-research',cwd:'/FICTITIOUS_PRIVATE_PROBE'},0,'session_meta');
const item=(id,command,status,exit_code,duration)=>record({type:'item_completed',thread_id:'failure-research',started_at_ms:epoch,completed_at_ms:epoch+20,item:{type:'CommandExecution',id,source:'unified_exec_startup',command,status,exit_code,...(duration===null?{}:{duration:{secs:0,nanos:duration*1e6}}),output:'FICTITIOUS_PRIVATE_PROBE'}},20,'event_msg');
const call=(id,cmd,ms=0)=>record({type:'function_call',call_id:id,name:'exec_command',arguments:JSON.stringify({cmd})},ms);
const result=(id,output,ms=4)=>record({type:'function_call_output',call_id:id,output},ms);
const cc=(id,ms=0,input={command:'npm test'})=>({type:'assistant',uuid:`call-${id}`,sessionId:'failure-research',isSidechain:false,cwd:'/FICTITIOUS_PRIVATE_PROBE',timestamp:at(ms),message:{id:`message-${id}`,role:'assistant',content:[{type:'tool_use',id,name:'Bash',input}]}});
const cr=(id,is_error,ms=4,extra={})=>({type:'user',uuid:`result-${id}`,sessionId:'failure-research',isSidechain:false,timestamp:at(ms),message:{role:'user',content:[{type:'tool_result',tool_use_id:id,is_error,content:'FICTITIOUS_PRIVATE_PROBE'}]},...extra});
const noTime=x=>{const {timestamp,...rest}=x;return rest};
const fixtures=[
{name:'claude-reversed',provider:'claude',expected:{completed:0,failed:1,pending:0,unknown:0,cancelled:0},records:[cc('a',10),cr('a',true,1)]},
{name:'codex-change-detected',provider:'codex',expected:{completed:1,failed:0,pending:0,unknown:0,cancelled:0},records:[metadata(),item('a','git diff --exit-code','failed',1,4)]},
{name:'codex-five',provider:'codex',expected:{completed:3,failed:2,pending:0,unknown:0,cancelled:0},records:[metadata(),item('a','rg broken src','failed',2,4),item('b','rg broken src','failed',2,null),item('c','rg absent src','failed',1,8),item('d','npm test','completed',0,0),item('e','cargo build','completed',0,20)]},
{name:'codex-untimed',provider:'codex',expected:{completed:0,failed:1,pending:0,unknown:0,cancelled:0},records:[metadata(),noTime(call('a','rg broken src')),noTime(result('a',{exit_code:2,output:'FICTITIOUS_PRIVATE_PROBE'}))]},
{name:'codex-unknowns',provider:'codex',expected:{completed:0,failed:0,pending:0,unknown:3,cancelled:0},records:[metadata(),item('a','npm test','failed',2,4),item('b','rg x src && npm test','failed',1,4),item('c','rg x src','completed',2,4)]},
{name:'codex-polls',provider:'codex',expected:{completed:0,failed:1,pending:1,unknown:0,cancelled:0},records:[metadata(),call('a','rg broken src'),result('a',{session_id:101},1),record({type:'function_call',call_id:'pa',name:'write_stdin',arguments:JSON.stringify({session_id:101,chars:''})},2),result('pa',{exit_code:2},4),call('b','rg broken src'),result('b',{session_id:102},1),record({type:'function_call',call_id:'pb',name:'write_stdin',arguments:JSON.stringify({session_id:102,chars:''})},2),result('pb',{session_id:102},4)]},
{name:'claude-untimed',provider:'claude',expected:{completed:1,failed:1,pending:0,unknown:0,cancelled:0},records:[noTime(cc('a')),noTime(cr('a',true)),cc('b'),cr('b',false)]},
{name:'claude-background',provider:'claude',expected:{completed:0,failed:0,pending:1,unknown:0,cancelled:0},records:[cc('a',0,{command:'npm test',run_in_background:true}),cr('a',false,1,{toolUseResult:{backgroundTaskId:'background-1',stdout:'FICTITIOUS_PRIVATE_PROBE'}})]},
{name:'claude-conflict',provider:'claude',expected:{completed:0,failed:0,pending:0,unknown:1,cancelled:0},records:[cc('a'),cr('a',true),{...cr('a',false,5),uuid:'second-result'}]},
{name:'codex-structured-priority',provider:'codex',expected:{completed:0,failed:1,pending:0,unknown:0,cancelled:0},records:[metadata(),call('a','rg broken src'),item('a','rg broken src','failed',2,4),result('a',{exit_code:0},10)]},
{name:'codex-mcp-error',provider:'codex',expected:{completed:0,failed:1,pending:0,unknown:0,cancelled:0},records:[metadata(),record({type:'function_call',call_id:'a',name:'mcp__example__tool',arguments:'{}'}),result('a',{isError:true,content:[{type:'text',text:'FICTITIOUS_PRIVATE_PROBE'}]})]}
];

async function fixture(f: typeof fixtures[number]) {
 const root=temporaryDirectory(),input=join(root,'input'),data=join(root,'data'),path=join(input,'synthetic.jsonl');
 await mkdir(input);await writeFile(path,f.records.map(x=>JSON.stringify(x)).join('\n')+'\n');
 const args={dataDir:data,codexRoot:f.provider==='codex'?[input]:[],claudeRoot:f.provider==='claude'?[input]:[]};
 const scan=await runScan(args);expect(scan.counts.committed).toBe(1);
 const identity=await loadOrCreateIdentityContext(data);let db=await openDatabase(data);const store=createSourceStore(db,identity.keyId);const id=store.listSources().items[0]!.sourceId;db.close();
 db=await openDatabase(data);const saved=createSourceStore(db,identity.keyId).readSource(id)!;db.close();
 return {data,input,path,args,saved,identity,id};
}
async function bytes(data:string) { const values=[];for(const name of (await readdir(data)).sort())values.push([name,await readFile(join(data,name))]);return values; }
it.each(fixtures)('ordinary $name survives scan/store/reopen with frozen status expectations',async f=>{
 const x=await fixture(f);const inventory={completed:0,failed:0,pending:0,unknown:0,cancelled:0};for(const e of x.saved.events)inventory[e.status]++;
 expect(inventory).toEqual(f.expected);expect(x.saved.events.filter(e=>e.status==='failed').every(e=>e.errorFingerprint===null)).toBe(true);
 const r=analyzeSourceFailures(x.saved);expect(r.provenance.unresolvedEvents).toBe(0);expect(r.suppressionReason).toBeNull();
 expect(r.eligibility.admittedTerminalCalls).toBe(f.expected.completed+f.expected.failed);
 if(f.expected.failed>0)expect(r.cohorts!.reduce((n,c)=>n+c.failedN,0)).toBe(f.expected.failed);
 if(f.name==='codex-five')expect(r.partitions[0]).toMatchObject({terminalN:5,failedN:2,completedN:3});
 if(f.name==='codex-five')expect(r.cohorts![0]).toMatchObject({failedN:2,timing:{measuredN:1},measurements:[{n:1,sumMs:4}]});
 if(f.name==='codex-untimed'||f.name==='claude-untimed')expect(r.cohorts![0]).toMatchObject({failedN:1,timing:{measuredN:0},measurements:[]});
 if(f.name==='codex-unknowns')expect(r).toMatchObject({assessment:'no_eligible_events',cohorts:null,eligibility:{exclusions:{unknown_status:3}}});
 const before=await bytes(x.data),frozen=JSON.stringify(x.saved);expect(analyzeSourceFailures(x.saved)).toEqual(r);expect(await bytes(x.data)).toEqual(before);expect(JSON.stringify(x.saved)).toBe(frozen);
 expect(JSON.stringify(r)).not.toMatch(/FICTITIOUS_|sourceRef|operationKey|errorFingerprint|boundaryFingerprint|synthetic.jsonl/);
 const repeat=await runScan(x.args);expect(repeat.counts.unchanged).toBe(1);
 let db=await openDatabase(x.data);expect(createSourceStore(db,x.identity.keyId).readSource(x.id)!.revision).toBe(x.saved.revision);db.close();
 await writeFile(x.path,f.records.map(z=>JSON.stringify(z)+' ').join('\n')+'\n');await runScan(x.args);
 db=await openDatabase(x.data);const revised=createSourceStore(db,x.identity.keyId).readSource(x.id)!;db.close();expect(revised.revision).toBe(x.saved.revision+1);expect(analyzeSourceFailures(revised).inventory).toEqual(r.inventory);
 await rm(x.input,{recursive:true});db=await openDatabase(x.data);expect(analyzeSourceFailures(createSourceStore(db,x.identity.keyId).readSource(x.id)!)).toEqual(analyzeSourceFailures(revised));db.close();
});
it('removing one decisive ordinary status proof suppresses complete compatible denominator after store round trip',async()=>{
 const f=fixtures.find(f=>f.name==='codex-five')!,x=await fixture(f),failed=x.saved.events.find(e=>e.status==='failed'&&e.durationMs===null)!;
 let db=await openDatabase(x.data);const store=createSourceStore(db,x.identity.keyId);expect(store.replaceSourceSnapshot({sourceId:x.saved.sourceId,provider:x.saved.provider,parserVersion:1,normalizationVersion:1,keyVersion:1,keyId:x.identity.keyId,completedOffset:x.saved.completedOffset,observedSize:x.saved.observedSize,boundaryFingerprint:x.saved.boundaryFingerprint,events:x.saved.events,evidence:{...x.saved.evidence!,observations:x.saved.evidence!.observations.filter(o=>o.eventId!==failed.id)}},x.saved.revision).status).toBe('committed');db.close();
 db=await openDatabase(x.data);const saved=createSourceStore(db,x.identity.keyId).readSource(x.id)!;db.close();expect(analyzeSourceFailures(saved)).toMatchObject({cohorts:null,inventory:{eventStatuses:{failed:2,completed:3}},partitions:[{terminalN:null,failedN:null,unresolvedEventIds:[failed.id]}],eligibility:{exclusions:{provenance_unresolved_partition:5}}});
});
it('Claude sidechain stays separate and repeated same source rows do not multiply failures',async()=>{
 const records=[cc('a'),cr('a',true),{...cc('b'),isSidechain:true,agentId:'side'},{...cr('b',true),isSidechain:true,agentId:'side'}];const f={name:'sidechain',provider:'claude',expected:{failed:2,completed:0,unknown:0,pending:0,cancelled:0},records:[...records,...records]};const x=await fixture(f);const r=analyzeSourceFailures(x.saved);expect(r.partitions).toHaveLength(2);expect(r.partitions.every(p=>p.terminalN===1&&p.failedN===1)).toBe(true);
});
