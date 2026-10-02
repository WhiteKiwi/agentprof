import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
const current=fileURLToPath(new URL("../dist/agentprof.cjs",import.meta.url)),installed=process.env.AGENTPROF_REPORT_INSTALLED_BINARY;
const invoke=(binary:string,args:string[])=>spawnSync(process.execPath,[binary,...args],{encoding:"utf8",env:{...process.env,NODE_OPTIONS:"--disable-warning=ExperimentalWarning"}});
it.skipIf(!installed)("packed script-disabled installed CLI preserves measured HTML and receipt after raw roots disappear",()=>{
 const root=mkdtempSync(join(tmpdir(),"agentprof-installed-report-")),input=join(root,"input"),data=join(root,"data"),output=join(root,"report.html");try{
 mkdirSync(input);const at=(ms:number)=>new Date(Date.UTC(2026,8,20)+ms).toISOString();const records=[{timestamp:at(0),type:"session_meta",payload:{id:"installed-report",cwd:"/FICTITIOUS_PRIVATE"}},...Array.from({length:6},(_,i)=>({timestamp:at(1000),type:"event_msg",payload:{type:"item_completed",thread_id:"installed-report",started_at_ms:Date.UTC(2026,8,20),completed_at_ms:Date.UTC(2026,8,20)+1000,item:{type:"CommandExecution",id:`call${i}`,source:"unified_exec_startup",command:i<5?"npm test FICTITIOUS_PRIVATE":"cargo build",status:"completed",exit_code:0,duration:{secs:0,nanos:(i<5?4:80)*1e6},output:"FICTITIOUS_PRIVATE"}}}))];
 writeFileSync(join(input,"synthetic.jsonl"),records.map(r=>JSON.stringify(r)).join("\n")+"\n");const scan=invoke(installed!,["scan","--codex-root",input,"--data-dir",data,"--json"]);expect(scan.status,scan.stdout+scan.stderr).toBe(0);expect(JSON.parse(scan.stdout).result.counts.committed).toBe(1);
 const source=JSON.parse(invoke(installed!,["stats","--list-sources","--data-dir",data,"--json"]).stdout).result.catalogue.items[0].sourceId;rmSync(input,{recursive:true});
 const snapshot=()=>readdirSync(data).sort().map(name=>({name,bytes:readFileSync(join(data,name)).toString("hex"),mode:statSync(join(data,name)).mode})),before=snapshot(),args=["report","--source",source,"--output",output,"--data-dir",data,"--json"];
 const local=invoke(current,args);expect(local.status).toBe(0);const html=readFileSync(output,"utf8"),mode=statSync(output).mode;rmSync(output);
 const packed=invoke(installed!,args);expect(packed).toMatchObject({status:local.status,stdout:local.stdout,stderr:local.stderr});expect(readFileSync(output,"utf8")).toBe(html);expect(statSync(output).mode).toBe(mode);expect(mode&0o777).toBe(0o600);expect(snapshot()).toEqual(before);expect(html).toContain("0.2");expect(html).not.toContain("FICTITIOUS_PRIVATE");
 }finally{rmSync(root,{recursive:true,force:true});}
});
it("built report rejects duplicate/conflicting/unsupported flags before storage access",()=>{
 const root=mkdtempSync(join(tmpdir(),"agentprof-report-args-")),data=join(root,"absent"),id=`h1:${"a".repeat(32)}:source:${"b".repeat(64)}`,out=join(root,"out.html");try{
 for(const extra of [["--source",id],["--output",out],["--last","7d"],["--open"],["--codex-root",root],["--claude-root",root],["extra"],["--unknown"]]){
 const result=invoke(current,["report","--source",id,"--output",out,"--data-dir",data,"--json",...extra]);expect(result.status).toBe(2);expect(result.stdout).toBe("");expect(JSON.parse(result.stderr).error.code).toBe("INVALID_ARGUMENT");expect(readdirSync(root)).toEqual([]);
 }
 const help=invoke(current,["report","--help","--data-dir",data]);expect(help.status).toBe(0);expect(help.stderr).toBe("");expect(help.stdout).toContain("--source");expect(help.stdout).toContain("--output");expect(help.stdout).not.toContain("not implemented");expect(readdirSync(root)).toEqual([]);
 }finally{rmSync(root,{recursive:true,force:true});}
});
