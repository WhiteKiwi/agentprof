// Independent pre-implementation contract freeze v2. Synthetic data only.
// This is expected RED on the unchanged base: the proposed feature modules do not exist.
import { describe, expect, it } from "vitest";
import { encodeSourceSnapshot } from "../src/db/source-metric-validation.js";
import type { StoredSource, MetricEvidence } from "../src/db/source-store.js";
import type { NormalizedEvent } from "../src/normalize/types.js";
import { analyzeSourceInvocationOverlap } from "../src/analysis/source-invocation-overlap.js";
import { analyzeSourceSlowTool } from "../src/analysis/source-slow-tool.js";
import { summarizeSource } from "../src/analysis/source-summary.js";
import { buildSourceCommandBreakdown } from "../src/report/command-breakdown.js";
import { buildSourceReportModel } from "../src/report/source-model.js";
import { renderSourceReport } from "../src/report/render.js";
// Dynamic loading lets the unchanged upstream fixture controls execute independently.
const feature = () => { const path="../src/report/invocation-timeline.js"; return import(path); };
const rendering = () => { const path="../src/report/render-invocation-timeline.js"; return import(path); };
const keyId = "c".repeat(32);
const id = (kind: string, i: number) => `h1:${keyId}:${kind}:${i.toString(16).padStart(64,"0")}`;
const sourceId=id("source",1), epoch=Date.UTC(2026,9,2), at=(ms:number)=>new Date(epoch+ms).toISOString();
function event(i:number,start:number,end:number,patch:Partial<NormalizedEvent>={}):NormalizedEvent {
 return {normalizationVersion:1,keyVersion:1,keyId,id:id("event",i),sessionId:id("session",1),turnId:null,parentEventId:null,provider:"claude",kind:"file_read",category:"read",toolName:"Read",commandPattern:null,operationKey:null,fileFingerprint:null,lookupKey:null,lookupRange:null,contentFingerprint:null,contentState:"unknown",changeState:"unknown",validationScope:"unknown",startAt:at(start),endAt:at(end),intervalTimingEvidence:"paired_timestamps",intervalScope:"invocation_latency",durationMs:end-start,timingEvidence:"paired_timestamps",durationScope:"invocation_latency",status:"completed",executionOutcome:"unknown",exitCode:null,errorFingerprint:null,errorClass:null,sourceRef:{fileId:sourceId,byteOffset:i*10,recordType:"user"},...patch};
}
function observations(e:NormalizedEvent):MetricEvidence["observations"] {
 const k=Number.parseInt(e.id.slice(-5),16), base={eventId:e.id,sessionId:e.sessionId,messageId:null,usageId:null,turnId:null,origin:"ordinary" as const,observedUsage:null};
 return [{...base,id:id("source",10000+k),representation:"call",observedResult:null,sourceRef:{fileId:sourceId,byteOffset:e.sourceRef.byteOffset-1}},
 {...base,id:id("source",20000+k),representation:"result",sourceRef:{fileId:sourceId,byteOffset:e.sourceRef.byteOffset},observedResult:{isError:e.status==="failed",completionKind:"invocation_result",unassignedAcknowledgement:false,observedAt:e.endAt,acknowledgementLatencyMs:null,durationMs:null,durationScope:"unknown"}}];
}
function source(events:readonly NormalizedEvent[]):StoredSource {
 const s:StoredSource={sourceId,provider:"claude",parserVersion:1,normalizationVersion:1,keyVersion:1,keyId,revision:3,availability:"available",completedOffset:100000,observedSize:100005,boundaryFingerprint:id("content",1),cacheEvidence:null,relationshipEvidence:null,events,persistedScope:"events_and_metric_evidence",aggregationReady:false,parserResumeReady:false,evidence:{turns:[],usage:[],observations:events.flatMap(observations),diagnostics:[],capabilities:{provider:"claude",parserVersion:1,support:"shape_verified_only",coverage:"recognized_shapes",observedShapes:[],unsupportedRecords:0,ambiguousRecords:0,stateLimited:false,diagnosticsDropped:0}}};
 const {revision,availability,persistedScope,aggregationReady,parserResumeReady,...input}=s; encodeSourceSnapshot(input,keyId);return s;
}
const pairs=(p:any)=>p.display.rows?.map((r:any)=>[r.ordinal,r.startOffsetMs,r.endOffsetMs,r.intervalLengthMs]);
const metrics=(p:any)=>[p.intervalLengthSumMs,p.intervalUnionMs,p.excessMs];
async function project(s:StoredSource,overlap=analyzeSourceInvocationOverlap(s)) {
 const {buildSourceInvocationTimeline}=await feature(); return buildSourceInvocationTimeline(s,overlap);
}
async function report(s:StoredSource) {
 const timeline=await project(s),slow=analyzeSourceSlowTool(s);
 return buildSourceReportModel(summarizeSource(s),slow,buildSourceCommandBreakdown(s,slow),timeline);
}
function freezeCheck(v:unknown):void{if(v!==null&&typeof v==="object"){expect(Object.isFrozen(v)).toBe(true);Object.values(v).forEach(freezeCheck);}}
function attrs(html:string,cls:string){return [...html.matchAll(new RegExp(`<[^>]+class="${cls}"[^>]*>`,'g'))].map(m=>Object.fromEntries([...m[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(x=>[x[1],x[2]])));}

it("upstream fixture control: validated synthetic ordinary overlap gives literal 20/15/5 seconds",()=>{
 const s=source([event(1,0,10000),event(2,5000,15000)]),p=analyzeSourceInvocationOverlap(s).partitions[0]!;
 expect(metrics(p)).toEqual([20000,15000,5000]);expect(p.coverage).toMatchObject({admittedTerminalN:2,positionedN:2,complete:true});
});
it("upstream fixture control: independent interval position survives null duration",()=>{
 const s=source([event(1,0,10000,{durationMs:null,durationScope:"unknown",timingEvidence:"unknown"})]);
 expect(analyzeSourceInvocationOverlap(s).partitions[0]).toMatchObject({status:"evaluated",intervalUnionMs:10000});expect(summarizeSource(s).durations).toBeNull();
});

describe("frozen literal geometry",()=>{
 it.each([
  ["overlap",[[0,10000],[5000,15000]],[20000,15000,5000],15000,[[1,0,10000,10000],[2,5000,15000,10000]]],
  ["touching",[[0,10000],[10000,20000]],[20000,20000,0],20000,[[1,0,10000,10000],[2,10000,20000,10000]]],
  ["nested",[[0,10000],[2000,8000]],[16000,10000,6000],10000,[[1,0,10000,10000],[2,2000,8000,6000]]],
  ["disjoint",[[0,10000],[20000,30000]],[20000,20000,0],30000,[[1,0,10000,10000],[2,20000,30000,10000]]],
  ["three-identical",[[0,10000],[0,10000],[0,10000]],[30000,10000,20000],10000,[[1,0,10000,10000],[2,0,10000,10000],[3,0,10000,10000]]],
  ["zero",[[5000,5000]],[0,0,0],0,[[1,0,0,0]]],
  ["nonzero-offset-zero-point",[[1000,5000],[3000,3000]],[4000,4000,0],4000,[[1,0,4000,4000],[2,2000,2000,0]]],
 ] as const)("%s",async(_name,intervals,expected,span,rows)=>{
  const s=source(intervals.map(([a,b],i)=>event(i+1,a,b))),before=JSON.stringify(s),t=await project(s),p=t.partitions[0]!;
  expect(metrics(p)).toEqual(expected);expect(p.display).toMatchObject({state:"available",reason:null,axisSpanMs:span});expect(pairs(p)).toEqual(rows);expect(p.coverage).toMatchObject({positionedN:intervals.length,admittedTerminalN:intervals.length,complete:true});expect(JSON.stringify(s)).toBe(before);expect(Object.isFrozen(s)).toBe(false);freezeCheck(t);
 });
 it("caps lanes after full axis and metric computation",async()=>{
  const s=source([...Array.from({length:20},(_,i)=>event(i+1,i,i+1)),event(21,1000,1010)]),p=(await project(s)).partitions[0]!;
  expect(metrics(p)).toEqual([30,30,0]);expect(p.display.axisSpanMs).toBe(1010);expect(p.display.counts).toEqual({total:21,shown:20,omitted:1});expect(p.display.rows).toHaveLength(20);expect(p.display.rows.at(-1)).toMatchObject({ordinal:20,startOffsetMs:19,endOffsetMs:20});expect(p.coverage).toMatchObject({positionedN:21,admittedTerminalN:21});
 });
 it("uses internal event ID tie order without rendering IDs; permutation preserves aliases",async()=>{
  const s=source([event(3,0,10000,{toolName:"Glob",kind:"search",category:"search"}),event(1,0,10000,{toolName:"Read"}),event(2,0,10000,{toolName:"Grep",kind:"search",category:"search"})]);
  const t=await project(s),other={...s,events:[...s.events].reverse(),evidence:{...s.evidence!,observations:[...s.evidence!.observations].reverse()}};
  expect(await project(other)).toEqual(t);expect(t.partitions[0]!.display.rows!.map((r:any)=>[r.ordinal,r.group.toolName])).toEqual([[1,"Read"],[2,"Grep"],[3,"Glob"]]);
  const {renderSourceInvocationTimeline}=await rendering(),html=renderSourceInvocationTimeline(t.partitions[0]!,1);for(const e of s.events){expect(html).not.toContain(e.id);expect(html).not.toContain(e.startAt!);}
 });
});

it("keeps native partial coverage independent of render omissions",async()=>{
 const untimed=event(2,0,0,{startAt:null,endAt:null,intervalScope:"unknown",intervalTimingEvidence:"unknown",durationMs:null,durationScope:"unknown",timingEvidence:"unknown"}),s=source([event(1,0,10000),untimed]),p=(await project(s)).partitions[0]!;
 expect(p.status).toBe("partial");expect(p.reason).toBeNull();expect(metrics(p)).toEqual([10000,10000,0]);expect(p.coverage).toMatchObject({positionedN:1,admittedTerminalN:2,excludedN:1,complete:false});expect(p.display.counts).toEqual({total:1,shown:1,omitted:0});
});
it("retains native evaluated metrics and coverage when axis span alone is unsafe",async()=>{
 const s=source([event(1,0,1,{startAt:new Date(-8e15).toISOString(),endAt:new Date(-8e15+1).toISOString()}),event(2,0,1,{startAt:new Date(8e15-1).toISOString(),endAt:new Date(8e15).toISOString()})]);
 const native=analyzeSourceInvocationOverlap(s),p=(await project(s,native)).partitions[0]!;
 expect(p.status).toBe("evaluated");expect(p.reason).toBeNull();expect(metrics(p)).toEqual([2,2,0]);expect(p.coverage).toEqual(native.partitions[0]!.coverage);expect(p.display).toMatchObject({state:"unavailable",reason:"unsafe_axis_span",axisSpanMs:null,rows:null});
 const {renderSourceInvocationTimeline}=await rendering();expect(renderSourceInvocationTimeline(p,1)).not.toContain("<svg");
});
it("never grants geometry from nonempty IDs in a suppressed native DTO",async()=>{
 const s=source([event(1,0,10000),event(2,5000,15000)]),native=analyzeSourceInvocationOverlap(s),blocked={...s,availability:"unavailable" as const};
 // Synthetic guard input, explicitly not a claim that raw ordinary source suppression produces this membership.
 const overlap={...native,availability:"unavailable" as const,assessment:"suppressed" as const,suppressionReason:"source_unavailable" as const,partitions:native.partitions.map(p=>({...p,status:"unavailable" as const,reason:"source_suppressed" as const,coverage:{...p.coverage,complete:false},intervalLengthSumMs:null,intervalUnionMs:null,excessMs:null}))};
 expect(overlap.partitions[0]!.contributingEventIds).toHaveLength(2);const t=await project(blocked,overlap),p=t.partitions[0]!;
 expect(t.assessment).toBe("suppressed");expect(t.suppressionReason).toBe("source_unavailable");expect(p.status).toBe("unavailable");expect(p.reason).toBe("source_suppressed");expect(metrics(p)).toEqual([null,null,null]);expect(p.coverage).toEqual(overlap.partitions[0]!.coverage);expect(p.coverage.complete).toBe(false);expect(p.display.rows).toBeNull();
 const {renderSourceInvocationTimeline}=await rendering();expect(renderSourceInvocationTimeline(p,1)).not.toContain("<svg");
});
it.each([false,true])("preserves Codex native suppression and evidence-absence precedence (%s)",async(absent)=>{
 const empty=source([]),s={...empty,provider:"codex" as const,evidence:absent?null:{...empty.evidence!,capabilities:{...empty.evidence!.capabilities,provider:"codex" as const}}},native=analyzeSourceInvocationOverlap(s),t=await project(s,native);
 expect(t.assessment).toBe("suppressed");expect(t.suppressionReason).toBe(absent?"evidence_absent":"unsupported_provider");expect(t.partitions).toEqual([]);
 const model=await report(s),html=renderSourceReport(model);expect(model.selection.sessions.total).toBe(0);expect(html).toContain('id="invocation-timeline-notice"');expect(html).toContain(absent?"evidence_absent":"unsupported_provider");
});
it("selects six of seven sessions from the full union including a timeline-only session",async()=>{
 const s=source(Array.from({length:7},(_,i)=>event(i+1,0,10,{sessionId:id("session",i+1),...(i===0?{durationMs:null,durationScope:"unknown" as const,timingEvidence:"unknown" as const}:{})}))),model=await report(s);
 // Synthetic multi-session stored model only, not a raw multi-root provider-support assertion.
 expect(model.selection.sessions).toEqual({total:7,shown:6,omitted:1});expect(model.selection.shownSessionIds).toEqual([1,2,3,4,5,6].map(i=>id("session",i)));expect(model.invocationTimeline.partitions.map((p:any)=>p.sessionId)).toEqual([1,2,3,4,5,6].map(i=>id("session",i)));expect(model.invocationTimeline.selection.sessions).toEqual({total:7,shown:6,omitted:1});
});
it("independently verifies normalized SVG coordinates rather than copying helper arithmetic",async()=>{
 const p=(await project(source([event(1,0,10000),event(2,5000,15000)]))).partitions[0]!,{renderSourceInvocationTimeline}=await rendering(),html=renderSourceInvocationTimeline(p,1),bars=attrs(html,"invocation-interval");
 expect(bars).toHaveLength(2);expect(Number(bars[0]!.x)).toBeCloseTo(0,8);expect(Number(bars[0]!.width)).toBeCloseTo(666.6666666666666,8);expect(Number(bars[1]!.x)).toBeCloseTo(333.3333333333333,8);expect(Number(bars[1]!.width)).toBeCloseTo(666.6666666666666,8);expect(html).toContain('viewBox="0 0 1000 ');expect(html).toContain("<table");expect(html).toContain("15000");
});
it("renders a nonzero-offset zero point without inventing duration",async()=>{
 const p=(await project(source([event(1,1000,5000),event(2,3000,3000)]))).partitions[0]!,{renderSourceInvocationTimeline}=await rendering(),html=renderSourceInvocationTimeline(p,1),points=attrs(html,"invocation-zero-point");expect(points).toHaveLength(1);expect(Number(points[0]!.cx)).toBe(500);expect(p.display.rows![1]).toMatchObject({intervalLengthMs:0,startOffsetMs:2000,endOffsetMs:2000});
});
it("keeps gap attribution unavailable while permitting honest negative disclaimers",async()=>{
 const p=(await project(source([event(1,0,10000),event(2,20000,30000)]))).partitions[0]!,{renderSourceInvocationTimeline}=await rendering(),html=renderSourceInvocationTimeline(p,1);
 expect(html).toMatch(/unattributed/i);expect(html).toMatch(/not.*(?:Active Time|API|savings)|(?:Active Time|API|savings).*not/i);
 for(const forbidden of [/API latency\s*:\s*\d/i,/LLM latency\s*:\s*\d/i,/User wait\s*:\s*\d/i,/Savings\s*:\s*\d/i,/Active Time\s*:\s*\d/i])expect(html).not.toMatch(forbidden);
});
it("escapes every visible text context and retains source CSP with no executable markup",async()=>{
 const marker='Read <script>alert("TIMELINE_SENTINEL")</script> & \'quoted\'',s=source([event(1,0,10,{kind:"shell",category:"test",toolName:"Bash",commandPattern:"npm test <target>"})]);
 expect(()=>source([event(1,0,10,{toolName:marker})])).toThrow();const model=await report(s),html=renderSourceReport(model);
 expect(html).toContain("npm test &lt;target&gt;");expect(html).not.toContain('<script>alert("TIMELINE_SENTINEL")');expect(html).not.toMatch(/\bon(?:click|load|error)=/i);expect(html).toContain("default-src 'none'");expect(html).not.toContain(s.events[0]!.startAt!);expect(Buffer.byteLength(html)).toBeLessThanOrEqual(1048576);
});
it("rejects generation and membership mismatches without re-analyzing",async()=>{
 const s=source([event(1,0,10)]),native=analyzeSourceInvocationOverlap(s),{buildSourceInvocationTimeline}=await feature();
 expect(()=>buildSourceInvocationTimeline({...s,revision:s.revision+1},native)).toThrow();expect(()=>buildSourceInvocationTimeline(s,{...native,partitions:native.partitions.map(p=>({...p,contributingEventIds:[id("event",999)]}))})).toThrow();
});

// Coordinator-approved fixture-only amendment: kind/category must match native tools.
it("upstream tie fixture admits the three independently expected identities",()=>{
 const s=source([event(3,0,10000,{toolName:"Glob",kind:"search",category:"search"}),event(1,0,10000,{toolName:"Read"}),event(2,0,10000,{toolName:"Grep",kind:"search",category:"search"})]);
 const native=analyzeSourceInvocationOverlap(s),p=native.partitions[0]!;
 expect(p.contributingEventIds).toEqual([1,2,3].map(i=>id("event",i)));
 expect(p.coverage).toMatchObject({admittedTerminalN:3,positionedN:3,excludedN:0,complete:true});
 expect([p.intervalLengthSumMs,p.intervalUnionMs,p.excessMs]).toEqual([30000,10000,20000]);
});
