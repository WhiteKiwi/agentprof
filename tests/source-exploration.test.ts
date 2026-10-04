import { describe, expect, it, vi } from "vitest";
import { analyzeSourceExploration as analyze } from "../src/analysis/source-exploration.js";
import * as overlap from "../src/analysis/source-invocation-overlap.js";
import { event, source, validated, lookups, mutation, opaque, observations, at, id } from "./exploration-fixture.js";
import { snapshot, claudePair } from "./provider-evidence-fixture.js";
import type { StoredSource } from "../src/db/source-store.js";
import type { NormalizedEvent } from "../src/normalize/types.js";
function frozen(v: unknown): void { if (v !== null && typeof v === "object") { expect(Object.isFrozen(v)).toBe(true); Object.values(v).forEach(frozen); } }
function checked(s: StoredSource) {
  const before = JSON.stringify(s), a = analyze(s);
  expect(JSON.stringify(s)).toBe(before); expect(a.includedEventIds).toEqual([]); frozen(a);
  const emitted = JSON.stringify(a);
  for (const e of s.events) for (const key of [e.lookupKey, e.operationKey, e.fileFingerprint, e.contentFingerprint]) if (key) expect(emitted).not.toContain(key);
  for (const c of a.candidates ?? []) {
    expect(c.includedEventIds).toEqual([]); expect(c.severity).toBe("INFO");
    expect(new Set(c.evidenceEventIds).size).toBe(c.evidenceEventIds.length);
    expect(c.evidenceObservationIds).toHaveLength(c.evidenceEventIds.length * 2);
    for (const proof of c.evidenceObservationIds) {
      const o = s.evidence!.observations.find(o => o.id === proof)!;
      expect(c.evidenceEventIds).toContain(o.eventId); expect(o.sessionId).toBe(c.sessionId);
      expect(["call", "result"]).toContain(o.representation); expect(o.origin).toBe("ordinary");
    }
  }
  return a;
}
describe("closed-window thresholds and counterexamples", () => {
  it.each([[20,5,1,true],[19,5,1,false],[20,4,1,false],[20,5,2,false],[20,5,0,true]])("lookups=%i repeat=%i edits=%i", (n,r,m,yes) => {
    const s = validated(source([...lookups(n,r), ...Array.from({length:m},(_,i)=>mutation(`edit${i}`))]));
    const a = checked(s); expect(a.candidates?.length).toBe(yes ? 1 : 0);
    if (yes) expect(a.candidates![0]).toMatchObject({lookupN:n,mutationN:m,largestRepeatedSearchN:r});
  });
  it.each([600000,600001])("closed endpoint difference %i ms", gap => {
    const rows = lookups().map((e,i)=>({...e,startAt:at(i===0?-1:gap-1),endAt:at(i===0?0:gap)}));
    expect(checked(validated(source(rows))).candidates?.length).toBe(gap===600000?1:0);
  });
  it("processes entire ties and emits only the first qualified endpoint", () => {
    const rows = lookups(60,5).map((e,i)=>({...e,startAt:at(0),endAt:at(i<30?1000:2000)}));
    const s=validated(source(rows)),a=checked(s),c=a.candidates![0]!;
    expect(c.lookupN).toBe(30); expect(c.window.endInclusive).toBe(at(1000));
    expect(c.window.startInclusive).toBe(at(1000-600000)); expect(a.partitions[0]!.windowEndpointsEvaluated).toBe(1);
    expect(analyze({...s,events:[...s.events].reverse(),evidence:{...s.evidence!,observations:[...s.evidence!.observations].reverse()}})).toEqual(a);
  });
  it.each([["touch-left",-600000,-580000,0],["before-left",-600000,-580001,1],["touch-right",20000,21000,0],["after-right",20001,21000,1],["spans",-800000,800000,0],["zero-right",20000,20000,0]] as const)("opaque %s",(_label,start,end,n)=>{
    const a=checked(validated(source([...lookups(),opaque("block",start,end)]))); expect(a.candidates?.length).toBe(n);
    if(!n) expect(a.partitions[0]).toMatchObject({status:"blocked",numericQualifiedWindows:1,opaqueBlockedWindows:1});
  });
  it.each(["completed","failed"] as const)("%s edits intersect by intervals, not completion buckets",status=>{
    const a=checked(validated(source([...lookups(),mutation("one",-700000,700000,{status}),mutation("two",-800000,800000,{status})])));
    expect(a.candidates).toEqual([]); expect(a.partitions[0]!.numericQualifiedWindows).toBe(0);
  });
  it("counts Write as a mutation and does not count Read identities as repeated searches",()=>{
    const write=mutation("write",0,21000,{kind:"file_write",category:"write",toolName:"Write"});
    expect(checked(validated(source([...lookups(),write]))).candidates![0]!.mutationN).toBe(1);
    const reads=lookups().map(e=>({...e,kind:"file_read" as const,category:"read" as const,toolName:"Read"}));
    expect(checked(validated(source(reads))).candidates).toEqual([]);
  });
  it("ignores pure model inventory without assuming an unrecognized tool is harmless",()=>{
    const model=event("model",10000,"A",{kind:"model",category:"model",toolName:null,startAt:null,endAt:null});
    expect(checked(source([...lookups(),model])).candidates).toHaveLength(1);
    expect(checked(source([...lookups(),{...model,toolName:"CUSTOM"}])).candidates).toBeNull();
  });
});
describe("conservative evidence gates",()=>{
  it.each(["pending","cancelled","unknown"] as const)("unresolved %s mutation dominates low sample",status=>{
    const a=checked(source([event("only"),mutation("pending",0,20000,{status})]));
    expect(a).toMatchObject({assessment:"unavailable",candidates:null}); expect(a.partitions[0]!.reasons).toContain("incomplete_mutation");
    expect(a.partitions[0]!.windowEndpointsEvaluated).toBeNull();
  });
  it.each(["pending","cancelled","unknown"] as const)("unresolved %s opaque action blocks",status=>{
    expect(checked(source([...lookups(),opaque("opaque",0,21000,{status})])).assessment).toBe("unavailable");
  });
  it.each([{startAt:null},{endAt:null},{intervalScope:"unknown",intervalTimingEvidence:"unknown"},{intervalTimingEvidence:"estimated"},{lookupKey:null},{startAt:"invalid"}] as Partial<NormalizedEvent>[])("never hides incomplete completed lookups %j",extra=>{
    const rows=lookups(); rows[0]={...rows[0]!,...extra};
    const a=checked(source(rows)); expect(a.assessment).toBe("unavailable"); expect(a.candidates).toBeNull();
  });
  it.each([{category:"write"},{kind:"other"},{toolName:"CUSTOM"}] as Partial<NormalizedEvent>[])("inconsistent native tuple %j is not admitted",extra=>{
    const rows=lookups();rows[0]={...rows[0]!,...extra};
    expect(checked(source(rows)).partitions[0]!.reasons).toContain("inconsistent_lookup_class");
  });
  it("does not substitute duration or use missing/contradictory/foreign result evidence",()=>{
    for(const mode of ["absent","contradictory","foreign","boundary"]) {
      const rows=lookups(),first=rows[0]!;
      const obs=rows.flatMap(observations).flatMap(o=>o.eventId!==first.id||o.representation!=="result"?[o]:mode==="absent"?[]:[{...o,
        ...(mode==="foreign"?{sessionId:id("session","foreign")}:{observedResult:{...o.observedResult!,...(mode==="boundary"?{observedAt:at(123456)}:{isError:true})}})}]);
      expect(checked(source(rows,obs)).candidates).toBeNull();
    }
  });
  it("decisive ordinary pairs exclude replay and unrelated observations",()=>{
    const rows=lookups(),first=rows[0]!,obs=rows.flatMap(observations);
    const old={...obs[1]!,id:id("source","nondeterminative-replay"),sourceRef:{...obs[1]!.sourceRef,byteOffset:12}};
    const a=checked(validated(source(rows,[...obs,old]))); expect(a.candidates![0]!.evidenceObservationIds).not.toContain(old.id);
  });
  it.each(["source_unavailable","evidence_absent","state_limited","ambiguous","dropped","unsupported_records","future","claude1","codex"])("source gate %s dominates",mode=>{
    const s=source(lookups());let changed:StoredSource=s;
    if(mode==="source_unavailable")changed={...s,availability:"unavailable"};
    else if(mode==="evidence_absent")changed={...s,evidence:null};
    else if(mode==="codex")changed={...s,provider:"codex"};
    else if(mode==="future"||mode==="claude1")changed={...s,parserVersion:mode==="future"?99:1};
    else changed={...s,evidence:{...s.evidence!,capabilities:{...s.evidence!.capabilities,
      ...(mode==="state_limited"?{stateLimited:true}:mode==="ambiguous"?{ambiguousRecords:1}:mode==="dropped"?{diagnosticsDropped:1}:{unsupportedRecords:1})}}};
    expect(checked(changed)).toMatchObject({assessment:"suppressed",candidates:null});
  });
  it("retains partial coverage and different session states without pooling",()=>{
    const good=lookups(),bad=lookups(3).map(e=>({...e,id:id("source",e.id),sessionId:id("session","other"),lookupKey:null}));
    const a=checked(source([...good,...bad]));expect(a.assessment).toBe("partial");expect(a.candidates).toHaveLength(1);
    const s=source(good);expect(checked({...s,evidence:{...s.evidence!,capabilities:{...s.evidence!.capabilities,coverage:"partial"}}})).toMatchObject({assessment:"partial"});
  });
  it("empty and insufficient are descriptive, not unknown-zero replacements",()=>{
    expect(checked(source())).toMatchObject({assessment:"empty",candidates:[],partitions:[]});
    expect(checked(source(lookups(19))).partitions[0]).toMatchObject({status:"insufficient",windowEndpointsEvaluated:0,numericQualifiedWindows:0});
  });
  it("reuses the unchanged overlap authority exactly once",()=>{
    const spy=vi.spyOn(overlap,"analyzeSourceInvocationOverlap");try{analyze(source(lookups()));expect(spy).toHaveBeenCalledTimes(1);}finally{spy.mockRestore();}
  });
  it.each(["legacy","timing","patterns"] as const)("ordinary Claude %s capture supports the exact current version",mode=>{
    const rows=Array.from({length:20},(_,i)=>claudePair(`q${i}`,"Grep",{pattern:i<5?"FICTITIOUS_REPEAT":`FICTITIOUS_${i}`,path:"src"},"FICTITIOUS_RESULT",false,undefined,"FICTITIOUS_SESSION",i*3)).flat();
    const s=snapshot("claude",rows,mode).source,a=checked(s);
    expect(a.candidates).toHaveLength(1);expect(a.parserVersion).toBe(mode==="legacy"?2:mode==="timing"?3:4);
  });
  it("bounds source materialization and rejects duplicate identities",()=>{
    const e=event("one");expect(()=>analyze(source(Array(4097).fill(e)))).toThrow(/limit/);
    expect(()=>analyze(source([e,e]))).toThrow(/duplicate/);
  });
});
it("matches a separate brute-force oracle over 180 varied window populations",()=>{
  let seed=831;const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
  for(let trial=0;trial<180;trial++) {
    const rows=Array.from({length:20+Math.floor(rand()*55)},(_,i)=>event(`q${i}`,Math.floor(rand()*16)*100000,`k${Math.floor(rand()*6)}`));
    const edits=Array.from({length:Math.floor(rand()*5)},(_,i)=>{const a=Math.floor(rand()*15)*100000;return mutation(`m${i}`,a,a+Math.floor(rand()*8)*100000)});
    const opaqueRows=Array.from({length:Math.floor(rand()*4)},(_,i)=>{const a=Math.floor(rand()*15)*100000;return opaque(`o${i}`,a,a+Math.floor(rand()*8)*100000)});
    let expected:string|null=null;
    for(const right of [...new Set(rows.map(e=>Date.parse(e.endAt!)))].sort((a,b)=>a-b)) {
      const left=right-600000,win=rows.filter(e=>Date.parse(e.endAt!)>=left&&Date.parse(e.endAt!)<=right);
      const frequencies=new Map<string,number>();for(const e of win)frequencies.set(e.lookupKey!,1+(frequencies.get(e.lookupKey!)??0));
      if(win.length>=20&&Math.max(0,...frequencies.values())>=5&&edits.filter(e=>Date.parse(e.startAt!)<=right&&Date.parse(e.endAt!)>=left).length<=1
        &&opaqueRows.every(e=>Date.parse(e.startAt!)>right||Date.parse(e.endAt!)<left)){expected=new Date(right).toISOString();break;}
    }
    const a=analyze(source([...rows,...edits,...opaqueRows]));expect(a.candidates?.[0]?.window.endInclusive??null).toBe(expected);
  }
});
