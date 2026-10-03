import { buildSourceInvocationTimeline } from "../src/report/invocation-timeline.js";
import { analyzeSourceInvocationOverlap } from "../src/analysis/source-invocation-overlap.js";
import { buildSourceCommandBreakdown } from "../src/report/command-breakdown.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { buildSourceReportModel } from "../src/report/source-model.js";
import { renderSourceReport } from "../src/report/render.js";
import { summarizeSource } from "../src/analysis/source-summary.js";
import { analyzeSourceSlowTool } from "../src/analysis/source-slow-tool.js";
import { normalizeEvent } from "../src/normalize/event.js";
import { createIdentityContext } from "../src/normalize/identity.js";
import type { StoredSource } from "../src/db/source-store.js";
const context=createIdentityContext(new Uint8Array(32).fill(11),"1".repeat(32));
function model(){
 const events=Array.from({length:6},(_,i)=>normalizeEvent({provider:"codex",eventIdentity:`e${i}`,sessionIdentity:"render",kind:"shell",toolName:"exec_command",command:i<5?"npm test safe":"cargo build",status:"completed",statusEvidence:"explicit",exitCode:0,durationMs:i<5?4:80,timingEvidence:"source_reported",durationScope:"process_runtime",sourceRef:{fileIdentity:"render",byteOffset:10+i,recordType:"event_msg"}},context).event!);
 const source:StoredSource={sourceId:events[0]!.sourceRef.fileId,provider:"codex",parserVersion:1,normalizationVersion:1,keyVersion:1,keyId:context.keyId,revision:1,availability:"available",completedOffset:10000,observedSize:10005,boundaryFingerprint:context.fingerprint("content",["b"]),cacheEvidence:null,events,persistedScope:"events_and_metric_evidence",aggregationReady:false,parserResumeReady:false,evidence:{turns:[],usage:[],diagnostics:[],observations:events.map(e=>({id:context.fingerprint("source",["obs",e.id]),eventId:e.id,turnId:null,usageId:null,representation:"structured",origin:"ordinary",transportStatus:"completed",observedUsage:null,sourceRef:{fileId:e.sourceRef.fileId,byteOffset:e.sourceRef.byteOffset}})),capabilities:{provider:"codex",parserVersion:1,support:"shape_verified_only",coverage:"recognized_shapes",observedShapes:[],unsupportedRecords:0,ambiguousRecords:0,stateLimited:false,diagnosticsDropped:0}}};
 const slow=analyzeSourceSlowTool(source); return buildSourceReportModel(summarizeSource(source),slow,buildSourceCommandBreakdown(source,slow),buildSourceInvocationTimeline(source,analyzeSourceInvocationOverlap(source)));
}
it("renders deterministic semantic HTML with exact static CSS hash and no dynamic style",()=>{
 const m=model(),html=renderSourceReport(m);expect(renderSourceReport(m)).toBe(html);expect(Buffer.byteLength(html)).toBeLessThanOrEqual(1048576);
 const css=html.match(/<style>([\s\S]*?)<\/style>/)![1]!,hash=createHash("sha256").update(css).digest("base64");expect(html).toContain(`sha256-${hash}`);expect(html).toContain("default-src");expect(html).toContain("base-uri");expect(html).toContain("form-action");
 expect(html).not.toMatch(/<script|<iframe|<object|<embed|<link|<img|\sstyle\s*=|\son[a-z]+\s*=|unsafe-inline|javascript:|https?:\/\//i);expect(html).toMatch(/<table\b/);expect(html).toMatch(/<th\b/);expect(html).toMatch(/<svg\b/);expect(html).toMatch(/<details\b/);expect(html).toMatch(/<summary\b/);expect(html).toContain("@media print");expect(html).toContain("prefers-color-scheme");
 for(const match of html.matchAll(/<(?:rect|line|path)\b[^>]*>/g))expect(match[0]).not.toMatch(/style=|on[a-z]+=/);
});
it("uses unique generated anchors and links every displayed card to retained context",()=>{
 const html=renderSourceReport(model()),ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);expect(new Set(ids).size).toBe(ids.length);for(const m of html.matchAll(/href="#([^"]+)"/g))expect(ids).toContain(m[1]);expect(ids.length).toBeGreaterThan(3);expect(ids.every(id=>!/h1:/.test(id!))).toBe(true);
});
it("preserves exact candidate values, limitations and safeguard paragraphs",()=>{
 const m=model(),html=renderSourceReport(m),c=m.slowTool.candidates![0]!;expect(html).toContain("0.2");expect(html).toContain("20");expect(html).toContain("100");expect(html).toContain("process_runtime");expect(html).toContain("source_reported");for(const key of ["necessaryWorkCounterexample","investigativeAction","matchedExperiment","qualityGuardrail"] as const)expect(html).toContain(c[key]);expect(html).toContain("not_waste_or_predicted_savings");expect(html).toContain("Kind: shell · category: test");
});
it("rejects accessors and unknown model fields without invoking getters",()=>{
 const m=model(),extra={...m,hiddenRaw:"RAW_SECRET"};expect(()=>renderSourceReport(extra)).toThrow();let calls=0;const attack={...m};Object.defineProperty(attack,"summary",{enumerable:true,get(){calls++;return m.summary;}});expect(()=>renderSourceReport(attack)).toThrow();expect(calls).toBe(0);
});
it("escapes allowed text contexts rather than allowing markup or URLs to become active",()=>{
 const m=structuredClone(model());(m.slowTool.candidates![0]! as {necessaryWorkCounterexample:string}).necessaryWorkCounterexample='</details><svg onload="alert(1)"><script>alert(2)</script> https://invalid.example/';
 const html=renderSourceReport(m);expect(html).toContain("&lt;/details&gt;");expect(html).toContain("&lt;svg");expect(html).not.toContain('<svg onload=');expect(html).not.toContain('<script>');expect(html).not.toContain('href="https://invalid.example/');
});
it("matches the accepted semantic design tokens without editing the design source",()=>{
 const css=readFileSync(new URL("../design/tokens.css",import.meta.url),"utf8"),html=renderSourceReport(model());for(const color of ["#111315","#191c20","#23272d","#f5f6f7","#b2b8c2","#ff8a3d","#ffab73","#c3acf2","#171a1e","#944200"]){expect(css.toLowerCase()).toContain(color);expect(html.toLowerCase()).toContain(color);}
});
it("rejects misplaced known fields, invalid enums, fractional counts and oversized arrays",()=>{
 for(const mutate of [
  (m:ReturnType<typeof model>)=>Object.assign(m.summary.inventory,{sourceId:m.summary.sourceId}),
  (m:ReturnType<typeof model>)=>Object.assign(m.summary,{provider:"<script>"}),
  (m:ReturnType<typeof model>)=>Object.assign(m.summary.inventory,{events:0.5}),
  (m:ReturnType<typeof model>)=>Object.assign(m.selection,{shownSessionIds:Array(7).fill(m.selection.shownSessionIds[0])}),
 ]){const m=structuredClone(model());mutate(m);expect(()=>renderSourceReport(m)).toThrow();}
});
it("gives every internal context link a44px target through the global anchor rule",()=>{
 const html=renderSourceReport(model());expect(html).toMatch(/a\{[^}]*min-height:44px[^}]*\}/);expect(html).toContain('href="#partition-1"');expect(html).toContain('href="#source-overview"');
});
type Mutable<T> = T extends readonly (infer U)[] ? Mutable<U>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
function maximumModel() {
 const m=structuredClone(model()) as Mutable<ReturnType<typeof model>>,baseRow=structuredClone(m.summary.durations![0]!),basePartition=structuredClone(m.slowTool.partitions[0]!),baseCard=structuredClone(m.slowTool.candidates![0]!);
 const baseContext=structuredClone(m.commandBreakdown.contexts[0]!);m.commandBreakdown.contexts=[];
 const sessions=Array.from({length:6},(_,i)=>context.fingerprint("session",["max",i])).sort(),shapes=[['invocation_latency','paired_timestamps'],['invocation_latency','source_reported'],['item_lifecycle','paired_timestamps'],['process_runtime','source_reported']] as const;
 m.invocationTimeline.partitions=[];m.invocationTimeline.selection.sessions={total:0,shown:0,omitted:0};
 m.selection.shownSessionIds=sessions;m.selection.sessionCounts=[];m.selection.partitionCounts=[];m.summary.durations=[];m.summary.usage=[];m.slowTool.partitions=[];m.slowTool.candidates=[];
 for(const [si,sessionId]of sessions.entries()){
  m.selection.sessionCounts.push({sessionId,partitions:{total:4,shown:4,omitted:0},usage:{total:4,shown:4,omitted:0}});
  for(const [pi,[durationScope,timingEvidence]]of shapes.entries()){
   const index=si*4+pi,id=`partition-${index+1}`,fields={sessionId,durationScope,timingEvidence};m.slowTool.partitions.push({...basePartition,...fields,id});
   m.commandBreakdown.contexts.push({...structuredClone(baseContext),...fields,displayPartitionId:id,nativePartitionId:id});
   m.selection.partitionCounts.push({...fields,known:{total:10,shown:10,omitted:0},unknown:{total:10,shown:10,omitted:0},candidates:{total:index<10?1:0,shown:index<10?1:0,omitted:0}});
   for(let i=0;i<20;i++)m.summary.durations.push({...baseRow,...fields,commandPattern:`npm test --verbose ${i} <target>`,sumMs:i<10?20:null,meanMs:i<10?4:null,limitations:i<10?[]:["numeric_overflow"]});
   if(index<10)m.slowTool.candidates.push({...baseCard,...fields,id:`candidate-${index+1}`,partitionId:id});
  }
  for(let i=0;i<4;i++)m.summary.usage.push({sessionId,provider:"codex",mapping:i<2?"openai_responses":"anthropic_messages",finality:i%2?"trusted_final":"source_terminal",observedResponses:1,counts:{input:10,output:2,total:12,cachedInput:3,cacheWriteInput:0,reasoningOutput:null,uncachedInput:null},overflowComponents:[],limitations:[],evidenceUsageCount:1});
 }
 m.selection.sessions={total:6,shown:6,omitted:0};m.selection.partitions={total:24,shown:24,omitted:0};m.selection.durations={total:480,shown:480,omitted:0};m.selection.usage={total:24,shown:24,omitted:0};m.selection.candidates={total:10,shown:10,omitted:0};m.commandBreakdown.selection={eligiblePartitions:{total:24,shown:24,omitted:0},unavailablePartitions:{total:0,shown:0,omitted:0},missingNativeContexts:{total:0,shown:0,omitted:0},groups:{total:48,shown:48,omitted:0},calls:{total:144,shown:144,omitted:0},totalsScope:"eligible_detail_partitions_only"};return m;
}
it("renders every exact structural ceiling with bounded final bytes and all anchors resolving",()=>{
 const m=maximumModel(),html=renderSourceReport(m);expect(Buffer.byteLength(html)).toBeLessThanOrEqual(1048576);expect(m.summary.durations).toHaveLength(480);expect(m.summary.usage).toHaveLength(24);expect(m.slowTool.candidates).toHaveLength(10);expect(html).toContain('id="session-6"');expect(html).toContain('id="partition-24"');expect(html).toContain('id="card-10"');const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);for(const ref of html.matchAll(/href="#([^"]+)"/g))expect(ids).toContain(ref[1]);
});
it("rejects escaped output above1MiB even when each field and collection satisfies its bound",()=>{
 const m=maximumModel();for(const row of m.summary.durations!)row.commandPattern="&".repeat(512);for(const row of m.summary.usage!)row.limitations=Array(64).fill("&".repeat(128));expect(()=>renderSourceReport(m)).toThrowError(expect.objectContaining({code:"REPORT_LIMIT"}));
});

// PR39 accessibility amendment: additive static regressions; browser behavior is not asserted.
it("gives every bounded table a focusable region labelled by its unique caption",()=>{
 for(const [m,expectedTables] of [[model(),3],[maximumModel(),120]] as const){
  const html=renderSourceReport(m),ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]!);
  expect(new Set(ids).size).toBe(ids.length);
  const wrappers=[...html.matchAll(/<div\b([^>]*\bclass="table-wrap"[^>]*)>\s*<table>\s*<caption\b([^>]*)>([\s\S]*?)<\/caption>/g)];
  expect(wrappers).toHaveLength(expectedTables);
  expect([...html.matchAll(/<table\b/g)]).toHaveLength(expectedTables);
  const labels:string[]=[];
  for(const [,attributes,captionAttributes,captionText]of wrappers){
   expect(attributes).toMatch(/\btabindex="0"/);
   expect(attributes).toMatch(/\brole="region"/);
   const label=attributes!.match(/\baria-labelledby="([^"\s]+)"/)?.[1];
   expect(label).toBeDefined();
   expect(captionAttributes!.match(/\bid="([^"]+)"/)?.[1]).toBe(label);
   expect(captionText!.trim().length).toBeGreaterThan(0);
   expect(ids.filter(id=>id===label)).toHaveLength(1);labels.push(label!);
  }
  expect(new Set(labels).size).toBe(labels.length);
 }
});
it("styles table keyboard focus without weakening the static CSP or overflow contract",()=>{
 const html=renderSourceReport(model()),css=html.match(/<style>([\s\S]*?)<\/style>/)![1]!;
 const focusRules=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([,selector])=>selector!.split(',').some(s=>s.trim()==='.table-wrap:focus-visible'));
 expect(focusRules).toHaveLength(1);
 expect(focusRules[0]![2]).toMatch(/outline:\s*3px solid var\(--observed\)/);
 expect(focusRules[0]![2]).toMatch(/outline-offset:\s*4px/);
 expect(css).toMatch(/\.table-wrap\{[^}]*overflow-x:auto/);
 expect(html).toContain(`style-src 'sha256-${createHash('sha256').update(css).digest('base64')}'`);
 expect(html).not.toMatch(/unsafe-inline|\sstyle\s*=|\son[a-z]+\s*=|<script/i);
});
it("keeps SlowTool metric terms and auxiliary text in valid description-list groups",()=>{
 for(const m of [model(),maximumModel()]){
  const html=renderSourceReport(m),stack:string[]=[],voids=new Set(['meta','link','br','hr','img','input','area','base','col','embed','param','source','track','wbr']);
  for(const token of html.matchAll(/<(\/)?([a-z][a-z0-9]*)\b[^>]*>/gi)){
   const tag=token[2]!.toLowerCase();
   if(token[1]){expect(stack.pop()).toBe(tag);continue;}
   if(tag==='dt'||tag==='dd')expect(stack.at(-1)==='dl'||(stack.at(-1)==='div'&&stack.at(-2)==='dl')).toBe(true);
   if(!voids.has(tag)&&!token[0].endsWith('/>'))stack.push(tag);
  }
  expect(stack).toHaveLength(0);
  const cards=[...html.matchAll(/<article class="card"[^>]*>([\s\S]*?)<\/article>/g)];
  expect(cards).toHaveLength(m.slowTool.candidates!.length);
  for(const [i,card]of cards.entries()){
   const c=m.slowTool.candidates![i]!,pair=card[1]!.match(/<dl class="pair">([\s\S]*?)<\/dl>/)?.[1];
   expect(pair).toBeDefined();
   const groups=[...pair!.matchAll(/<div><dt>([^<]*)<\/dt><dd\b[^>]*>([\s\S]*?)<\/dd><\/div>/g)];
   expect(groups).toHaveLength(2);expect(groups.map(g=>g[0]).join('')).toBe(pair);
   expect(groups[0]![1]).toBe('Observed group recorded duration');
   expect(groups[0]![2]).toContain(`${c.sumMs} ms`);expect(groups[0]![2]).toContain(`<p>${c.n} calls · mean ${c.meanMs} ms</p>`);
   expect(groups[1]![1]).toBe('Admitted compatible duration fraction');
   expect(groups[1]![2]).toContain(String(c.observedEligibleNativeToolDurationShare));
   expect(groups[1]![2]).toContain(`<p>${c.sumMs} / ${c.denominatorSumMs} ms · denominator ${c.denominatorN} calls</p>`);
  }
 }
});
