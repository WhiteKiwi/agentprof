import { existsSync, readFileSync } from "node:fs";
import { rm, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { runScan } from "../src/cli/scan.js";
import { runInsights, formatInsightsResult } from "../src/cli/insights.js";
import { disk, bytes, claudePair } from "./provider-evidence-fixture.js";
import { temporaryDirectory } from "./helpers.js";
const binary=resolve("dist/agentprof.cjs"),env={...process.env,NODE_NO_WARNINGS:"1"};
const invoke=(args:string[],file=binary,cwd=process.cwd())=>{
  const r=spawnSync(process.execPath,[file,...args],{cwd,env,encoding:"utf8",timeout:20000,maxBuffer:16*1024*1024});
  return {status:r.status,stdout:r.stdout,stderr:r.stderr};
};
const rows=()=>Array.from({length:20},(_,i)=>claudePair(`q${i}`,"Grep",{pattern:i<5?"FICTITIOUS_REPEAT":`FICTITIOUS_${i}`,path:"src"},"FICTITIOUS_RESULT",false,undefined,"FICTITIOUS_SESSION",i*3)).flat();
it.each([[],["--usage-timing"],["--pattern-evidence"]].map(flags=>({flags})))("real capture $flags yields one informational candidate after raw deletion",async ({flags})=>{
  const x=await disk("claude",rows());const scan=invoke(["scan","--claude-root",x.path,"--data-dir",x.data,"--json",...flags]);
  const receipt=JSON.parse(scan.stdout);expect(receipt.result.counts.committed).toBe(1);expect(scan.status).toBe(receipt.result.status==="completed"?0:1);
  await rm(x.inputRoot,{recursive:true});const before=await bytes(x.data),args=["insights","--source",x.sourceId,"--exploration","--data-dir",x.data];
  const expected=await runInsights({source:x.sourceId,dataDir:x.data,exploration:true});
  for(const json of [false,true]){
    const r=invoke([...args,...(json?["--json"]:[])]);expect(r.status,r.stderr).toBe(0);expect(r.stderr).toBe("");expect(r.stdout).toBe(formatInsightsResult(expected,json));
    expect(r.stdout).not.toMatch(/FICTITIOUS_|lookupKey|operationKey/);
  }
  expect(expected.mode).toBe("selected_source_exploration");expect(expected.analysis.candidates).toHaveLength(1);expect(await bytes(x.data)).toEqual(before);
});
it.each([["--exploration"],["--exploration=true"],["--unknown"],["--read-revisits"],["extra"],["--source","bad"],["--json"],["--claude-root","somewhere"]].map(extra=>({extra})))("rejects duplicate or unsupported exploration args $extra before I/O",({extra})=>{
  const data=join(temporaryDirectory(),"absent"),source=`h1:${"7".repeat(32)}:source:${"1".repeat(64)}`;
  const r=invoke(["insights","--source",source,"--exploration","--data-dir",data,"--json",...extra]);
  expect(r.status).toBe(2);expect(r.stdout).toBe("");expect(JSON.parse(r.stderr).error.code).toBe("INVALID_ARGUMENT");expect(existsSync(data)).toBe(false);
});
it("help and missing-source selection do not create private files",()=>{
  const data=join(temporaryDirectory(),"absent");const help=invoke(["insights","--help","--data-dir",data]);expect(help.status).toBe(0);expect(help.stdout).toContain("--exploration");
  const missing=invoke(["insights","--exploration","--data-dir",data,"--json"]);expect(missing.status).toBe(2);expect(JSON.parse(missing.stderr).error.code).toBe("INSIGHTS_SELECTION_REQUIRED");expect(existsSync(data)).toBe(false);
});
it("wrong-key and missing-source reads fail safely without changing the store",async()=>{
  const x=await disk("claude",rows());await runScan(x.options);const before=await bytes(x.data);
  for(const key of ["6".repeat(32),x.sourceId.split(":")[1]!]){
    const r=invoke(["insights","--source",`h1:${key}:source:${"0".repeat(64)}`,"--exploration","--data-dir",x.data,"--json"]);
    expect(r.status).toBe(2);expect(JSON.parse(r.stderr).error.code).toBe(key==="6".repeat(32)?"INVALID_IDENTITY_KEY":"SOURCE_NOT_FOUND");expect(r.stdout).toBe("");
  }
  expect(await bytes(x.data)).toEqual(before);
});
it("scripts-disabled installed artifact preserves exploration and legacy insights outside the repository",async()=>{
  const root=temporaryDirectory(),prefix=join(root,"prefix"),execute=join(root,"execute"),cache=join(root,"cache");await mkdir(execute);
  const npm=(args:string[],cwd=execute)=>{const p=spawnSync("npm",["--cache",cache,"--ignore-scripts",...args],{cwd,env,encoding:"utf8",timeout:30000,maxBuffer:16*1024*1024});expect(p.status,p.stdout+p.stderr).toBe(0);return p.stdout;};
  const packed=JSON.parse(npm(["pack","--json","--pack-destination",root],process.cwd()))[0];
  expect(packed.files.every((f:{path:string})=>/^(dist\/|package\.json$|README\.md$|LICENSE)/.test(f.path))).toBe(true);
  npm(["install","--global","--prefix",prefix,"--no-audit","--no-fund",join(root,packed.filename)]);
  const name=JSON.parse(readFileSync("package.json","utf8")).name,installed=join(prefix,"lib","node_modules",name,"dist","agentprof.cjs");
  for(const capture of [[],["--usage-timing"],["--pattern-evidence"]]){
    const x=await disk("claude",rows()),scan=invoke(["scan","--claude-root",x.path,"--data-dir",x.data,"--json",...capture],installed,execute);
    expect(JSON.parse(scan.stdout).result.counts.committed).toBe(1);await rm(x.inputRoot,{recursive:true});const before=await bytes(x.data);
    for(const flags of [[],["--json"],["--exploration"],["--exploration","--json"]]){
      const args=["insights","--source",x.sourceId,"--data-dir",x.data,...flags],built=invoke(args,binary,execute),actual=invoke(args,installed,execute);
      expect(actual).toEqual(built);expect(actual.status,actual.stderr).toBe(0);
      if(flags.includes("--exploration")&&flags.includes("--json"))expect(JSON.parse(actual.stdout).result.analysis.candidates).toHaveLength(1);
    }
    expect(await bytes(x.data)).toEqual(before);
  }
},60000);
