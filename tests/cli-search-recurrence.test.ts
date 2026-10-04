import { spawnSync } from "node:child_process";
import { existsSync,readFileSync,readdirSync,statSync,mkdirSync,writeFileSync,copyFileSync,rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe,expect,it } from "vitest";
import { temporaryDirectory } from "./helpers.js";
import { validateStatsArguments } from "../src/cli/stats.js";
const binary=fileURLToPath(new URL("../dist/agentprof.cjs",import.meta.url));
const full=`h1:${"a".repeat(32)}:source:${"b".repeat(64)}`;
const invoke=(file:string,data:string,args:readonly string[])=>{const r=spawnSync(process.execPath,[file,"--data-dir",data,...args],{encoding:"utf8",env:{...process.env,NODE_NO_WARNINGS:"1"}});expect(r.error).toBeUndefined();expect(r.signal).toBeNull();return{status:r.status,stdout:r.stdout,stderr:r.stderr};};
const bytes=(dir:string)=>readdirSync(dir).sort().map(name=>({name,mode:statSync(join(dir,name)).mode,bytes:readFileSync(join(dir,name))}));
const invalid=[[],["--source","bad"],["--source",full,"--source",full],["--list-sources"],["--source",full,"--list-sources"],["--source",full,"--failures"],["--source",full,"--read-revisits"],["--source",full,"--invocation-overlap"],["--source",full,"--search-recurrence"],["--source",full,"--codex-root","FICTITIOUS_PRIVATE"],["--source",full,"--claude-root","FICTITIOUS_PRIVATE"],["--source",full,"extra"],["--source",full,"--last","7d"]];
it.each(invalid.map(args => [args]))("rejects invalid recurrence options before I/O: %j",args=>{
 const dir=join(temporaryDirectory(),"must-not-exist"),r=invoke(binary,dir,["--json","stats","--search-recurrence",...args]);
 expect(r.status).toBe(2);expect(r.stdout).toBe("");expect(JSON.parse(r.stderr)).toMatchObject({schema:"agentprof.cli/v1",ok:false,error:{code:"INVALID_ARGUMENT"}});expect(existsSync(dir)).toBe(false);expect(r.stderr).not.toMatch(/FICTITIOUS_PRIVATE|SQLite/);
});
it.each([{listSources:true},{source:full,failures:true},{source:full,readRevisits:true},{source:full,invocationOverlap:true},{}])("direct argument validation rejects mode combination %j",other=>{
 const data=join(temporaryDirectory(),"absent");expect(()=>validateStatsArguments({dataDir:data,searchRecurrence:true,...other})).toThrow();expect(existsSync(data)).toBe(false);
});
it("valid recurrence selection never creates a missing store",()=>{
 const data=join(temporaryDirectory(),"absent"),r=invoke(binary,data,["stats","--search-recurrence","--source",full,"--json"]);
 expect(r.status).toBe(2);expect(JSON.parse(r.stderr).error.code).toBe("STORE_NOT_FOUND");expect(existsSync(data)).toBe(false);
});
function seed(root:string,name:string){const data=join(root,name);mkdirSync(data,{mode:0o700});writeFileSync(join(data,"identity-key.json"),JSON.stringify({keyVersion:1,keyId:"9".repeat(32),secret:"ab".repeat(32)})+"\n",{mode:0o600});return data;}
function rawFixture(root:string){const input=join(root,"input");mkdirSync(input);const records=[0,1,2,3].flatMap(i=>[
 {type:"assistant",uuid:`call-${i}`,sessionId:"FICTITIOUS_CLI_SESSION",cwd:"/FICTITIOUS_CLI_ROOT",version:"2.1.241",isSidechain:false,message:{id:`message-${i}`,role:"assistant",content:[{type:"tool_use",id:`tool-${i}`,name:"Grep",input:{pattern:i===2?"FICTITIOUS_B":"FICTITIOUS_A",path:"src"}}]}},
 {type:"user",uuid:`result-${i}`,sessionId:"FICTITIOUS_CLI_SESSION",isSidechain:false,message:{role:"user",content:[{type:"tool_result",tool_use_id:`tool-${i}`,is_error:false,content:"FICTITIOUS_RESULT"}]}}
]);writeFileSync(join(input,"synthetic.jsonl"),records.map(r=>JSON.stringify(r)+"\n").join(""));return input;}
function scanned(){const root=temporaryDirectory(),data=seed(root,"data"),input=rawFixture(root),scan=invoke(binary,data,["scan","--claude-root",input,"--json"]);expect([0,1]).toContain(scan.status);expect(JSON.parse(scan.stdout).result.counts.committed).toBe(1);const id=JSON.parse(invoke(binary,data,["stats","--list-sources","--json"]).stdout).result.catalogue.items[0].sourceId;rmSync(input,{recursive:true});return{root,data,id};}
it("actual binary yields independent four-call arithmetic after deleting raw input",()=>{
 const f=scanned(),before=bytes(f.data);let expected:string|null=null;
 for(const args of [["--json","stats","--source",f.id,"--search-recurrence"],["stats","--search-recurrence","--source",f.id,"--json"]]){
  const r=invoke(binary,f.data,args);expect(r.status).toBe(0);expect(r.stderr).toBe("");const parsed=JSON.parse(r.stdout);expect(parsed.result.mode).toBe("selected_source_search_recurrence");expect(parsed.result.analysis.partitions[0]).toMatchObject({validSearchN:4,uniqueLookupN:2,repeatN:2,repeatRatio:0.5});
  if(expected===null)expected=r.stdout;else expect(r.stdout).toBe(expected);expect(r.stdout).not.toMatch(/FICTITIOUS_|lookupKey|operationKey|searchQuery|searchRoot|sourceRef/);
 }
 const human=invoke(binary,f.data,["stats","--source",f.id,"--search-recurrence"]);expect(human.status).toBe(0);expect(human.stdout).toContain("N=4; U=2; repeats=2; ratio=0.5 (2/4)");expect(bytes(f.data)).toEqual(before);
});
const baseline=process.env["AGENTPROF_BASELINE_BINARY"],installed=process.env["AGENTPROF_INSTALLED_BINARY"];
const fixtureDirectory=fileURLToPath(new URL("./fixtures/providers/",import.meta.url));
const fixtureNames=readdirSync(fixtureDirectory).filter(n=>/^(claude|codex)-.*\.jsonl$/.test(n)).sort();
describe.skipIf(!baseline)("exact PR36 binary current-command parity (mandatory final optional-env gate)",()=>{
 it.each(fixtureNames)("preserves initial/reused scan and every current stats mode for %s",name=>{
  const root=temporaryDirectory(),old=seed(root,"old"),current=seed(root,"new"),input=join(root,"input");mkdirSync(input);copyFileSync(join(fixtureDirectory,name),join(input,"synthetic.jsonl"));const provider=name.startsWith("codex")?"codex":"claude",scan=["scan",`--${provider}-root`,input];
  expect(invoke(binary,current,[...scan,"--json"])).toEqual(invoke(baseline!,old,[...scan,"--json"]));
  const id=JSON.parse(invoke(binary,current,["stats","--list-sources","--json"]).stdout).result.catalogue.items[0].sourceId;
  const before=bytes(current),oldBefore=bytes(old);
  for(const args of [scan,["stats","--list-sources"],["stats","--source",id],["insights","--source",id],...["--failures","--read-revisits","--invocation-overlap"].map(flag=>["stats","--source",id,flag])])for(const format of [[],["--json"]])expect(invoke(binary,current,[...args,...format])).toEqual(invoke(baseline!,old,[...args,...format]));
  expect(bytes(current)).toEqual(before);expect(bytes(old)).toEqual(oldBefore);
 });
 it("preserves all help/version bytes except the frozen additive stats-help hunk",()=>{
  const data=join(temporaryDirectory(),"absent");for(const args of [["--version"],["scan","--help"],["insights","--help"]]){const current=invoke(binary,data,args);if(args[0]==="insights")current.stdout=current.stdout.replace(/^  --exploration  show informational native exploration patterns\n/m,"").replace(/\n--exploration selects bounded Claude parser2\/3\/4 observations; informational only, with unknown\/blocked states and no waste or savings claim\.\n$/,"");expect(current).toEqual(invoke(baseline!,data,args));}
  const pendingOpenHelp = `Usage: agentprof open [options] <file>

Open a generated report (not implemented yet)

Arguments:
  file        generated HTML file

Options:
  -h, --help  display help for command
`;
  const trustedOpenHelp = `Usage: agentprof open [options] <file>

Request the system opener for one explicitly trusted local HTML file

Arguments:
  file        existing local .html/.htm file

Options:
  -h, --help  display help for command

macOS/Linux only. Open explicitly trusted local files: selected HTML may run scripts or contact remote resources.
Canonical symlink targets are used; native opening may create OS/browser history.
No scan, report generation, latest-file search or URLs. Global data/root options are validated but inert.
A helper acknowledgement does not verify browser rendering. Timeout may mean the file is already open; no automatic retry.
`;
  const oldOpen=invoke(baseline!,data,["open","--help"]),currentOpen=invoke(binary,data,["open","--help"]);
  expect(oldOpen).toEqual({status:0,stdout:pendingOpenHelp,stderr:""});
  expect(currentOpen).toEqual({status:0,stdout:trustedOpenHelp,stderr:""});
  expect(oldOpen.stdout+currentOpen.stdout).not.toMatch(/FICTITIOUS_|SQLite/);
  expect(oldOpen.stdout+currentOpen.stdout).not.toContain(data);
  const oldTop=invoke(baseline!,data,["--help"]),currentTop=invoke(binary,data,["--help"]);
  expect(oldTop.status).toBe(0);expect(oldTop.stderr).toBe("");expect(currentTop.status).toBe(0);expect(currentTop.stderr).toBe("");
  const pendingOpenRow="  open <file>                Open a generated report (not implemented yet)\n";
  const trustedOpenRow="  open <file>                Request the system opener for one explicitly\n                             trusted local HTML file\n";
  expect(oldTop.stdout.split(pendingOpenRow)).toHaveLength(2);expect(currentTop.stdout.split(trustedOpenRow)).toHaveLength(2);
  expect(oldTop.stdout.split(trustedOpenRow)).toHaveLength(1);expect(currentTop.stdout.split(pendingOpenRow)).toHaveLength(1);
  const oldReportRow="  report [options]           Write a new offline HTML report from one stored\n                             source prefix\n";
  const newReportRow="  report [options]           Write a new offline HTML report from one stored\n                             source or explicit input file\n";
  expect(oldTop.stdout.split(oldReportRow)).toHaveLength(2);expect(oldTop.stdout.split(newReportRow)).toHaveLength(1);
  expect(currentTop.stdout.split(newReportRow)).toHaveLength(2);expect(currentTop.stdout.split(oldReportRow)).toHaveLength(1);
  expect(currentTop.stdout.replace(trustedOpenRow,pendingOpenRow).replace(newReportRow,oldReportRow)).toBe(oldTop.stdout);
  const old=invoke(baseline!,data,["stats","--help"]),current=invoke(binary,data,["stats","--help"]);expect(current.status).toBe(old.status);expect(current.stderr).toBe(old.stderr);
  const option="  --search-recurrence   show completed Claude native search recurrence\n";
  const note="--search-recurrence requires --source and excludes --failures/--read-revisits/--invocation-overlap; Claude parser2 Grep/Glob only; exact request recurrence, not equal results or waste.\n";
  expect(current.stdout.split(option)).toHaveLength(2);expect(current.stdout.split(note)).toHaveLength(2);expect(current.stdout.replace(option,"").replace(note,"")).toBe(old.stdout);expect(existsSync(data)).toBe(false);
 });
});
describe.skipIf(!installed)("script-disabled installed artifact recurrence parity (mandatory final optional-env gate)",()=>{
 it("matches direct binary human/JSON with deleted raw logs and unchanged storage",()=>{const f=scanned(),before=bytes(f.data);for(const format of [[],["--json"]]){const args=["stats","--source",f.id,"--search-recurrence",...format];expect(invoke(installed!,f.data,args)).toEqual(invoke(binary,f.data,args));}expect(bytes(f.data)).toEqual(before);});
});
