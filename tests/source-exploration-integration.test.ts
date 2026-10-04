import { rm } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { runInsights, formatInsightsResult, validateInsightsArguments } from "../src/cli/insights.js";
import * as storeModule from "../src/db/source-store.js";
import * as slow from "../src/analysis/source-slow-tool.js";
import * as exploration from "../src/analysis/source-exploration.js";
import * as overlap from "../src/analysis/source-invocation-overlap.js";
import { withReadOnlyStore } from "../src/db/read-only.js";
import { runScan } from "../src/cli/scan.js";
import { disk, bytes, claudePair } from "./provider-evidence-fixture.js";
const ordinaryRows=()=>Array.from({length:20},(_,i)=>claudePair(`q${i}`,"Grep",{pattern:i<5?"FICTITIOUS_REPEAT":`FICTITIOUS_${i}`,path:"src"},"FICTITIOUS_RESULT",false,undefined,"FICTITIOUS_SESSION",i*3)).flat();

describe("one-generation exploration selection",()=>{
  it.each([{}, {usageTiming:true},{patternEvidence:true}])("stored ordinary capture %j remains raw-deleted and read-only",async capture=>{
    const x=await disk("claude",ordinaryRows());await runScan({...x.options,...capture});await rm(x.inputRoot,{recursive:true});const before=await bytes(x.data);
    const expected=await withReadOnlyStore(x.data,(db,key)=>exploration.analyzeSourceExploration(storeModule.createSourceStore(db,key).readSource(x.sourceId)!));
    const r=await runInsights({dataDir:x.data,source:x.sourceId,exploration:true});expect(r).toEqual({mode:"selected_source_exploration",analysis:expected});
    expect(JSON.parse(formatInsightsResult(r,true)).result).toEqual(r);expect(formatInsightsResult(r,false)).toContain("Candidates: shown=1/1");expect(await bytes(x.data)).toEqual(before);
  });
  it("reads the selected source once in the existing transaction and never runs Slow Tool",async()=>{
    const x=await disk("claude",ordinaryRows());await runScan(x.options);
    const original=storeModule.createSourceStore,reads=vi.fn();
    const store=vi.spyOn(storeModule,"createSourceStore").mockImplementation((db,key)=>{const s=original(db,key);return {...s,readSource:(id:string)=>{expect(db.isTransaction).toBe(true);reads(id);return s.readSource(id);}};});
    const ex=vi.spyOn(exploration,"analyzeSourceExploration"),ol=vi.spyOn(overlap,"analyzeSourceInvocationOverlap"),sl=vi.spyOn(slow,"analyzeSourceSlowTool");
    try{await runInsights({source:x.sourceId,dataDir:x.data,exploration:true});expect(reads).toHaveBeenCalledTimes(1);expect(ex).toHaveBeenCalledTimes(1);expect(ol).toHaveBeenCalledTimes(1);expect(sl).not.toHaveBeenCalled();}
    finally{store.mockRestore();ex.mockRestore();ol.mockRestore();sl.mockRestore();}
  });
  it("absent/false options retain native Slow Tool JSON and human bytes with no exploration call",async()=>{
    const x=await disk("claude",ordinaryRows());await runScan(x.options);const before=await bytes(x.data);
    const expected=await withReadOnlyStore(x.data,(db,key)=>({mode:"selected_source" as const,analysis:slow.analyzeSourceSlowTool(storeModule.createSourceStore(db,key).readSource(x.sourceId)!)}));
    const ex=vi.spyOn(exploration,"analyzeSourceExploration");
    try{for(const extra of [{},{exploration:false}]){const r=await runInsights({source:x.sourceId,dataDir:x.data,...extra});expect(r).toEqual(expected);for(const json of [true,false])expect(formatInsightsResult(r,json)).toBe(formatInsightsResult(expected,json));}expect(ex).not.toHaveBeenCalled();}
    finally{ex.mockRestore();}expect(await bytes(x.data)).toEqual(before);
  });
  it.each([undefined,null,0,1,"true",[],{}])("rejects exploration value %j before any store read",value=>{
    expect(()=>validateInsightsArguments({exploration:value} as never)).toThrowError(expect.objectContaining({code:"INVALID_ARGUMENT"}));
  });
  it("missing source keeps the existing error",()=>{expect(()=>validateInsightsArguments({exploration:true})).toThrowError(expect.objectContaining({code:"INSIGHTS_SELECTION_REQUIRED"}));});
});

it("rejects an exploration accessor without executing it",()=>{const getter=vi.fn(()=>true);const options=Object.defineProperty({},"exploration",{get:getter,enumerable:true});expect(()=>validateInsightsArguments(options)).toThrow();expect(getter).not.toHaveBeenCalled();});
