import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createIdentityContext } from "../src/normalize/identity.js";
import { createClaudeAdapter } from "../src/parsers/claude/index.js";
import type { StoredSource } from "../src/db/source-store.js";
import { analyzeSourceInvocationOverlap } from "../src/analysis/source-invocation-overlap.js";
import { buildSourceInvocationTimeline } from "../src/report/invocation-timeline.js";
import { buildSourceReportModel } from "../src/report/source-model.js";
import { buildSourceCommandBreakdown } from "../src/report/command-breakdown.js";
import { summarizeSource } from "../src/analysis/source-summary.js";
import { analyzeSourceSlowTool } from "../src/analysis/source-slow-tool.js";
import { renderSourceReport } from "../src/report/render.js";
import { REPORT_CSS } from "../src/report/styles.js";
const rendering=()=>{const path="../src/report/render-invocation-timeline.js";return import(path);};
const identity=createIdentityContext(Buffer.alloc(32,61),"d".repeat(32)),file="/SYNTHETIC_TIMELINE_INPUT.jsonl";
function fixture(intervals:readonly (readonly [number,number,boolean?])[]=[[0,10],[5,15,true]]):StoredSource{
 const adapter=createClaudeAdapter(identity);let ordinal=0;
 intervals.forEach(([start,end,error],i)=>{
  const base={sessionId:"SYNTHETIC_SESSION",cwd:"/SYNTHETIC_PROJECT",isSidechain:false};
  const records=[{...base,type:"assistant",uuid:`call-${i}`,timestamp:new Date(start).toISOString(),message:{id:`message-${i}`,role:"assistant",content:[{type:"tool_use",id:`tool-${i}`,name:"Bash",input:{command:"npm test PRIVATE_SENTINEL"}}]}},{...base,type:"user",uuid:`result-${i}`,timestamp:new Date(end).toISOString(),message:{role:"user",content:[{type:"tool_result",tool_use_id:`tool-${i}`,is_error:!!error,content:"PRIVATE_SENTINEL"}]}}];
  for(const r of records){adapter.ingest(r,{fileIdentity:file,sourceAlias:"source-1",byteOffset:ordinal*1000,ordinal});ordinal++;}
 });
 const snap=adapter.snapshot();return {sourceId:identity.fingerprint("source",["claude",file]),provider:"claude",parserVersion:2,normalizationVersion:1,keyVersion:1,keyId:identity.keyId,revision:1,availability:"available",completedOffset:100000,observedSize:100000,boundaryFingerprint:identity.fingerprint("content",["boundary"]),cacheEvidence:null,relationshipEvidence:null,persistedScope:"events_and_metric_evidence",aggregationReady:false,parserResumeReady:false,events:snap.events,evidence:{turns:snap.turns,usage:snap.usage,observations:snap.observations,diagnostics:snap.diagnostics,capabilities:snap.capabilities}};
}
function model(s=fixture()){const slow=analyzeSourceSlowTool(s);return buildSourceReportModel(summarizeSource(s),slow,buildSourceCommandBreakdown(s,slow),buildSourceInvocationTimeline(s,analyzeSourceInvocationOverlap(s)));}
const clone=<T>(v:T)=>structuredClone(v) as any;
describe("independent projection rejection matrix",()=>{
 it("has a real ordinary adapter control with literal 20/15/5 milliseconds",()=>{const s=fixture(),p=analyzeSourceInvocationOverlap(s).partitions[0]!;expect(p).toMatchObject({intervalLengthSumMs:20,intervalUnionMs:15,excessMs:5});expect(s.evidence!.observations.every(o=>o.origin==="ordinary")).toBe(true);});
 it.each(["sourceId","provider","parserVersion","normalizationVersion","keyVersion","revision","completedOffset","observedSize","persistedScope","availability"])("rejects header mismatch %s",field=>{const s=fixture(),native=clone(analyzeSourceInvocationOverlap(s));native[field]=native[field]==="claude"?"codex":typeof native[field]==="number"?native[field]+1:"mismatch";expect(()=>buildSourceInvocationTimeline(s,native)).toThrow();});
 it.each(["duplicate event","missing event","cross session","duplicate partition","duplicate session","wrong status","wrong scope","wrong evidence","bad boundary","wrong positioned count","wrong coverage arithmetic","wrong complete","wrong native metrics","wrong assessment"])("rejects %s",kind=>{
  const s=clone(fixture()),native=clone(analyzeSourceInvocationOverlap(s)),p=native.partitions[0],e=s.events[0];
  if(kind==="duplicate event")p.contributingEventIds.push(p.contributingEventIds[0]);
  if(kind==="missing event")p.contributingEventIds[0]=identity.fingerprint("event",["missing"]);
  if(kind==="cross session")e.sessionId=identity.fingerprint("session",["another"]);
  if(kind==="duplicate partition")native.partitions.push(clone(p));
  if(kind==="duplicate session")native.partitions.push({...clone(p),id:"another-partition"});
  if(kind==="wrong status")e.status="pending";
  if(kind==="wrong scope")e.intervalScope="process_runtime";
  if(kind==="wrong evidence")e.intervalTimingEvidence="source_reported";
  if(kind==="bad boundary")e.endAt="not a timestamp";
  if(kind==="wrong positioned count")p.coverage.positionedN++;
  if(kind==="wrong coverage arithmetic")p.coverage.excludedN++;
  if(kind==="wrong complete")p.coverage.complete=false;
  if(kind==="wrong native metrics")p.excessMs=99;
  if(kind==="wrong assessment")native.assessment="unavailable";
  expect(()=>buildSourceInvocationTimeline(s,native)).toThrow();
 });
 it("rejects 4097 events and 8193 observations before joining",()=>{const s=fixture(),n=analyzeSourceInvocationOverlap(s);expect(()=>buildSourceInvocationTimeline({...s,events:Array(4097).fill(s.events[0])},n)).toThrow();expect(()=>buildSourceInvocationTimeline({...s,evidence:{...s.evidence!,observations:Array(8193).fill(s.evidence!.observations[0])}},n)).toThrow();});
 it("requires the fourth timeline argument and rejects expanded owned model shapes",()=>{const s=fixture(),slow=analyzeSourceSlowTool(s);expect(()=>buildSourceReportModel(summarizeSource(s),slow,buildSourceCommandBreakdown(s,slow),undefined as any)).toThrow();const m=clone(model(s));m.invocationTimeline.rawEventId="PRIVATE_SENTINEL";expect(()=>renderSourceReport(m)).toThrow();});
 it.each(["offset","length","ordinal","count","state","group","extra"])("rejects invalid selected row %s before SVG",kind=>{const m=clone(model()),p=m.invocationTimeline.partitions[0],r=p.display.rows[0];if(kind==="offset")r.startOffsetMs=NaN;if(kind==="length")r.intervalLengthMs++;if(kind==="ordinal")r.ordinal=0;if(kind==="count")p.display.counts.total++;if(kind==="state")p.display.state="unavailable";if(kind==="group")r.group.toolName='<svg onload="alert(1)">';if(kind==="extra")r.rawTimestamp="PRIVATE_SENTINEL";expect(()=>renderSourceReport(m)).toThrow();});
});
describe("timeline rendering acceptance",()=>{
 it("uses local accessible unique SVG/table IDs, focus regions, and semantic metric lists",async()=>{const {renderSourceInvocationTimeline}=await rendering(),s=fixture(),p=buildSourceInvocationTimeline(s,analyzeSourceInvocationOverlap(s)).partitions[0]!,html=renderSourceInvocationTimeline(p,1);expect(html).toContain('tabindex="0"');expect(html).toContain('role="region"');expect(html).toMatch(/<svg[^>]+role="img"[^>]+aria-labelledby=/);expect(html).toMatch(/<dl[^>]*>\s*<div><dt>/);expect(html).toContain('scope="col"');expect(html).toContain("failed");const ids=[...html.matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]);expect(new Set(ids).size).toBe(ids.length);for(const m of html.matchAll(/aria-labelledby="([^"]+)"/g))for(const id of m[1]!.split(" "))expect(ids).toContain(id);});
 it("uses shape and text for failure and warns about subpixel positive intervals without widening",async()=>{const {renderSourceInvocationTimeline}=await rendering(),s=fixture([[0,1000000],[999999,1000000,true]]),p=buildSourceInvocationTimeline(s,analyzeSourceInvocationOverlap(s)).partitions[0]!,html=renderSourceInvocationTimeline(p,1);expect(html).toMatch(/scale|resolution/i);expect(html).toMatch(/failed/i);expect(html).toMatch(/stroke-dasharray=|<path[^>]+invocation-failed/);const bars=[...html.matchAll(/class="invocation-interval"[^>]+width="([^"]+)"/g)];expect(Number(bars[1]![1])).toBeCloseTo(0.001,12);});
 it("preserves exact partial and unknown coverage messages",async()=>{const {renderSourceInvocationTimeline}=await rendering(),s=clone(fixture());s.events=s.events.map((e:any)=>({...e,startAt:null,endAt:null,intervalScope:"unknown",intervalTimingEvidence:"unknown"}));const p=buildSourceInvocationTimeline(s,analyzeSourceInvocationOverlap(s)).partitions[0]!,html=renderSourceInvocationTimeline(p,1);expect(html).toContain("no_positioned_intervals");expect(html).not.toContain("<svg");expect(html).not.toContain("100%");});
 it("retains source notice outside zero-session map and recomputes exact CSP style hash",()=>{const s={...fixture([]),evidence:null},html=renderSourceReport(model(s)),hash=createHash("sha256").update(REPORT_CSS).digest("base64");expect(html).toContain('id="invocation-timeline-notice"');expect(html).toContain("evidence_absent");expect(html).toContain(`style-src 'sha256-${hash}'`);expect(html).not.toMatch(/PRIVATE_SENTINEL|<script|onload=/);});
 it("rejects invalid direct rendering input before emitting unsafe coordinates or text",async()=>{const {renderSourceInvocationTimeline}=await rendering(),s=fixture(),p=clone(buildSourceInvocationTimeline(s,analyzeSourceInvocationOverlap(s)).partitions[0]!);p.display.rows[0].startOffsetMs=Infinity;expect(()=>renderSourceInvocationTimeline(p,1)).toThrow();p.display.rows[0].startOffsetMs=0;expect(()=>renderSourceInvocationTimeline(p,NaN)).toThrow();});
});

it.each([false,true])("rejects timeline symbol descriptors without invoking hooks (%s)",accessor=>{
 const m=clone(model());let invoked=0;
 Object.defineProperty(m.invocationTimeline,Symbol("extra"),accessor?{get(){invoked++;return "PRIVATE_SENTINEL";},enumerable:true}:{value:"PRIVATE_SENTINEL",enumerable:true});
 expect(()=>renderSourceReport(m)).toThrow();expect(invoked).toBe(0);
});

// Structural combined ceiling, not an ordinary multi-session provider-support claim.
function maximumTimelineCombinedModel() {
  const m = clone(model(fixture(Array.from({length:6},(_,i)=>[i,i+1] as const))));
  const summaryRow = structuredClone(m.summary.durations![0]!);
  const nativePartition = structuredClone(m.slowTool.partitions[0]!);
  const card = structuredClone(m.slowTool.candidates![0]!);
  const context = structuredClone(m.commandBreakdown.contexts[0]!);
  const originalGroup = structuredClone(context.groups![0]!);
  const originalCall = structuredClone(context.calls![0]!);
  const sessions: string[] = Array.from({ length: 6 }, (_, i) => identity.fingerprint("session", ["timeline-ceiling",i+1]));
  const shapes = [
    ["invocation_latency", "paired_timestamps"], ["invocation_latency", "source_reported"],
    ["item_lifecycle", "paired_timestamps"], ["process_runtime", "source_reported"],
  ] as const;
  const count = (total: number, shown = total) => ({ total, shown, omitted: total - shown });
  const positionedSource=fixture(Array.from({length:20},(_,i)=>[i,i+1] as const));
  const positioned=buildSourceInvocationTimeline(positionedSource,analyzeSourceInvocationOverlap(positionedSource)).partitions[0]!;
  m.invocationTimeline.partitions=sessions.map((sid,i)=>({...clone(positioned),id:`partition-${i+1}`,sessionId:sid,display:{...clone(positioned.display),rows:positioned.display.rows!.map(r=>({...clone(r),group:{...clone(r.group),commandPattern:"x".repeat(512)}}))}}));
  m.invocationTimeline.selection.sessions=count(6);
  m.selection.shownSessionIds = sessions; m.selection.sessionCounts = []; m.selection.partitionCounts = [];
  m.summary.durations = []; m.summary.usage = []; m.slowTool.partitions = []; m.slowTool.candidates = [];
  m.commandBreakdown.contexts = [];
  m.commandBreakdown.state = "details_available";
  for (const [si, sid] of sessions.entries()) {
    m.selection.sessionCounts.push({ sessionId: sid, partitions: count(4), usage: count(4) });
    for (const [pi, [durationScope, timingEvidence]] of shapes.entries()) {
      const index = si * 4 + pi, partitionId = `partition-${index + 1}`;
      const fields = { sessionId: sid, durationScope, timingEvidence };
      m.slowTool.partitions.push({ ...nativePartition, ...fields, id: partitionId, denominatorN: 50, denominatorSumMs: 500, tentativeTimedCalls: 50, evidenceEventCount: 50 });
      m.selection.partitionCounts.push({ ...fields, known: count(10), unknown: count(10), candidates: count(index < 10 ? 1 : 0) });
      for (let i = 0; i < 20; i++) m.summary.durations.push({
        ...summaryRow, ...fields, commandPattern: `npm test ${"--verbose ".repeat(i)}<target>`,
        n: 5, sumMs: i < 10 ? 20 : null, meanMs: i < 10 ? 4 : null, maxMs: 4, p50Ms: 4, p95Ms: 4,
        limitations: i < 10 ? [] : ["numeric_overflow"],
      });
      const groups = Array.from({ length: 10 }, (_, gi) => {
        const sumMs = gi === 0 ? 100 : gi === 1 ? 80 : 40;
        return { ...originalGroup, ordinal: gi + 1,
          group: { kind: "shell" as const, category: index === 23 ? "build" as const : "test" as const, toolName: "exec_command",
            commandPattern: index === 23 ? `cargo build ${"--verbose ".repeat(gi + 1)}<target>` : `npm test ${"--verbose ".repeat(gi)}<target>` },
          n: 5, sumMs, share: sumMs / 500,
        };
      });
      const calls = Array.from({ length: 10 }, (_, i) => ({
        ...originalCall, ordinal: i + 1, groupOrdinal: i < 5 ? 1 : 2,
        group: structuredClone(groups[i < 5 ? 0 : 1]!.group), durationMs: i < 5 ? 20 : 16,
      }));
      m.commandBreakdown.contexts.push({
        ...context, ...fields, displayPartitionId: partitionId, nativePartitionId: partitionId,
        state: "evaluated", denominatorN: 50, denominatorSumMs: 500, groups, calls,
        counts: { groups: count(10), calls: count(50, 10) },
      });
      if (index < 10) m.slowTool.candidates.push({
        ...card, ...fields, id: `candidate-${index + 1}`, partitionId, group: groups[0]!.group,
        n: 5, sumMs: 100, meanMs: 20, maxMs: 20, p50Ms: 20, p95Ms: 20,
        denominatorN: 50, denominatorSumMs: 500, observedEligibleNativeToolDurationShare: 0.2,
      });
    }
    for (let i = 0; i < 4; i++) m.summary.usage.push({
      sessionId: sid, provider: "codex", mapping: i < 2 ? "openai_responses" : "anthropic_messages",
      finality: i % 2 ? "trusted_final" : "source_terminal", observedResponses: 1,
      counts: { input: 10, output: 2, total: 12, cachedInput: 3, cacheWriteInput: 0, reasoningOutput: null, uncachedInput: null },
      overflowComponents: [], limitations: [], evidenceUsageCount: 1,
    });
  }
  m.selection.sessions = count(6); m.selection.partitions = count(24); m.selection.durations = count(480);
  m.selection.usage = count(24); m.selection.candidates = count(10);
  m.commandBreakdown.selection = {
    eligiblePartitions: count(24), unavailablePartitions: count(0), missingNativeContexts: count(0),
    groups: count(240), calls: count(1200, 240), totalsScope: "eligible_detail_partitions_only",
  };
  return m;
}

it("retains every combined structural ceiling including six by twenty exact timeline rows",()=>{
 const m=maximumTimelineCombinedModel(),html=renderSourceReport(m),bytes=Buffer.byteLength(html);
 expect(m.summary.durations).toHaveLength(480);expect(m.summary.usage).toHaveLength(24);expect(m.slowTool.candidates).toHaveLength(10);
 expect(m.commandBreakdown.contexts.flatMap((p:any)=>p.groups)).toHaveLength(240);expect(m.commandBreakdown.contexts.flatMap((p:any)=>p.calls)).toHaveLength(240);
 expect(m.invocationTimeline.partitions).toHaveLength(6);expect(m.invocationTimeline.partitions.flatMap((p:any)=>p.display.rows)).toHaveLength(120);
 expect([...html.matchAll(/class="invocation-interval"/g)].length).toBe(120);expect([...html.matchAll(/<caption[^>]*>Exact observed invocation offsets/g)].length).toBe(6);
 expect(bytes).toBeLessThanOrEqual(1048576);console.info(`TIMELINE_COMBINED_BYTES=${bytes}`);
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);expect(new Set(ids).size).toBe(ids.length);
 for(const match of html.matchAll(/aria-labelledby="([^"]+)"/g))for(const id of match[1]!.split(" "))expect(ids).toContain(id);
 expect(html).toContain('id="invocation-timeline-6"');expect(html).toContain('id="partition-24"');expect(html).toContain('id="card-10"');
});
it("rejects combined escaped timeline output beyond the unchanged one MiB hard ceiling",()=>{
 const m=maximumTimelineCombinedModel();for(const p of m.invocationTimeline.partitions)for(const r of p.display.rows)r.group.commandPattern="&".repeat(512);
 for(const r of m.summary.durations)r.commandPattern="&".repeat(512);
 for(const r of m.summary.usage)r.limitations=Array(64).fill("&".repeat(128));
 expect(()=>renderSourceReport(m)).toThrowError(expect.objectContaining({code:"REPORT_LIMIT"}));
});
