import { expect, it } from "vitest";
import { analyzeSourceExploration } from "../src/analysis/source-exploration.js";
import { formatSourceExploration } from "../src/cli/exploration.js";
import { formatInsightsResult } from "../src/cli/insights.js";
import { event, source, validated, id } from "./exploration-fixture.js";

it.each(["tied","unique","many-sessions","many-candidates","missing"] as const)("complete maximum %s output retains evidence with bounded human detail",shape=>{
  const n=shape==="many-candidates"?4000:4096;
  const rows=Array.from({length:n},(_,i)=>event(`e${i}`,1000,shape==="unique"?`key${i}`:"same",{
    ...(shape==="many-sessions"?{sessionId:id("session",String(i))}:shape==="many-candidates"?{sessionId:id("session",String(Math.floor(i/20)))}:{}),
    ...(shape==="missing"?{lookupKey:null}:{})}));
  const s=validated(source(rows)),a=analyzeSourceExploration(s),human=formatSourceExploration(a),json=formatInsightsResult({mode:"selected_source_exploration",analysis:a},true);
  expect(Buffer.byteLength(human)).toBeLessThanOrEqual(32768);expect(human.split("\n").length).toBeLessThanOrEqual(160);
  expect(Buffer.byteLength(json)).toBeLessThanOrEqual(8*1024*1024);
  expect(JSON.parse(json).result.analysis).toEqual(a);
  expect(human).toContain(`shown=${Math.min(6,a.partitions.length)}/${a.partitions.length}; omitted=${Math.max(0,a.partitions.length-6)}`);
  if(shape==="tied") {expect(a.candidates![0]!.lookupEventIds).toHaveLength(4096);expect(a.candidates![0]!.evidenceObservationIds).toHaveLength(8192);}
  if(shape==="many-candidates")expect(a.candidates).toHaveLength(200);
  if(shape==="many-sessions")expect(a.partitions).toHaveLength(4096);
  if(shape==="missing")expect(a.candidates).toBeNull();
  for(const name of ["Necessary-work counterexample:","Investigative action:","Matched experiment:","Quality guardrail:"])expect(human.split(name)).toHaveLength(2);
  console.log(`EXPLORATION_BOUND ${shape}: human=${Buffer.byteLength(human)} json=${Buffer.byteLength(json)}`);
});
it("refuses oversized JSON instead of silently clipping its evidence",()=>{
  const a=analyzeSourceExploration(source());
  expect(()=>formatInsightsResult({mode:"selected_source_exploration",analysis:{...a,sourceId:"x".repeat(8*1024*1024)}},true)).toThrow();
});
it("ordinary positive and empty preserve safeguards and unavailable is not zero",()=>{
  const a=analyzeSourceExploration(source(Array.from({length:20},(_,i)=>event(`q${i}`,1000))));
  const text=formatSourceExploration(a);expect(text.split("\n").length).toBeLessThanOrEqual(40);expect(Buffer.byteLength(text)).toBeLessThanOrEqual(5120);
  expect(text).toContain("informational");expect(text).toContain("included in waste=0");
  const empty=formatSourceExploration(analyzeSourceExploration(source()));expect(empty).toContain("shown=0/0");
  const unavailable=formatSourceExploration(analyzeSourceExploration({...source(),availability:"unavailable"}));expect(unavailable).toContain("unavailable; not zero findings");
});
