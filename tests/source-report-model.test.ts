import { describe, expect, it } from "vitest";
import { buildSourceReportModel } from "../src/report/source-model.js";
import { summarizeSource } from "../src/analysis/source-summary.js";
import { analyzeSourceSlowTool } from "../src/analysis/source-slow-tool.js";
import type { MetricEvidence, StoredSource } from "../src/db/source-store.js";
import type { NormalizedEvent } from "../src/normalize/types.js";
import { normalizeEvent } from "../src/normalize/event.js";
import { createIdentityContext } from "../src/normalize/identity.js";
import type { SourceObservation } from "../src/parsers/types.js";
import type { ClaudeSourceObservation } from "../src/parsers/claude/types.js";

const identity = createIdentityContext(new Uint8Array(32).fill(77), "a".repeat(32));
const sourceId = identity.fingerprint("source", ["codex", "synthetic-slow-tool"]);
const otherSession = identity.fingerprint("session", ["other"]);
const id = (value: string) => identity.fingerprint("event", ["synthetic-slow", value]);
function event(name: string, extra: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return { ...normalizeEvent({ provider: "codex", eventIdentity: name, sessionIdentity: "synthetic-slow", kind: "shell", toolName: "exec_command", command: "npm test SYNTHETIC_SECRET_TARGET",
    status: "completed", statusEvidence: "explicit", exitCode: 0, durationMs: 4, timingEvidence: "source_reported", durationScope: "process_runtime",
    sourceRef: { fileIdentity: "synthetic-slow-tool", byteOffset: 10, recordType: "event_msg" } }, identity).event!, ...extra };
}
function codexObservation(e: NormalizedEvent, name = e.id, extra: Partial<SourceObservation> = {}): SourceObservation {
  return { id: id(`observation-${name}`), eventId: e.id, turnId: null, usageId: null, representation: "structured", origin: "ordinary", transportStatus: "completed", observedUsage: null,
    sourceRef: { fileId: e.sourceRef.fileId, byteOffset: e.sourceRef.byteOffset }, ...extra };
}
function claudeObservations(e: NormalizedEvent): ClaudeSourceObservation[] {
  const base = { sessionId: e.sessionId, eventId: e.id, messageId: null, usageId: null, turnId: null, origin: "ordinary" as const, observedUsage: null };
  return [{ ...base, id: id(`call-${e.id}`), representation: "call", sourceRef: { fileId: e.sourceRef.fileId, byteOffset: 2 }, observedResult: null },
    { ...base, id: id(`result-${e.id}`), representation: "result", sourceRef: { fileId: e.sourceRef.fileId, byteOffset: e.sourceRef.byteOffset },
      observedResult: { isError: e.status === "failed", completionKind: "invocation_result", unassignedAcknowledgement: false, observedAt: e.endAt,
        acknowledgementLatencyMs: null, durationMs: e.timingEvidence === "source_reported" ? e.durationMs : null, durationScope: e.timingEvidence === "source_reported" ? e.durationScope : "unknown" } }];
}
function source(events: NormalizedEvent[] = [], observations?: MetricEvidence["observations"]): StoredSource {
  const provider = events[0]?.provider ?? "codex";
  return { sourceId, provider, parserVersion: 1, normalizationVersion: 1, keyVersion: 1, keyId: identity.keyId, revision: 3, availability: "available",
    completedOffset: 10000, observedSize: 10005, boundaryFingerprint: identity.fingerprint("content", ["boundary"]), cacheEvidence: null, events,
    persistedScope: "events_and_metric_evidence", aggregationReady: false, parserResumeReady: false,
    evidence: { turns: [], usage: [], observations: observations ?? events.flatMap(e => provider === "claude" ? claudeObservations(e) : [codexObservation(e)]), diagnostics: [],
      capabilities: { provider, parserVersion: 1, support: "shape_verified_only", coverage: "recognized_shapes", observedShapes: [], unsupportedRecords: 0, ambiguousRecords: 0, stateLimited: false, diagnosticsDropped: 0 } } };
}
function group(n = 5, extra: Partial<NormalizedEvent> = {}, prefix = "a"): NormalizedEvent[] {
  return Array.from({ length: n }, (_, i) => event(`${prefix}-${i}`, extra));
}

function model(s: StoredSource) { return buildSourceReportModel(summarizeSource(s), analyzeSourceSlowTool(s)); }
it("projects exact known values without evidence identifiers or private fields", () => {
 const s=source([...group(),event("other",{category:"build",commandPattern:"cargo build",durationMs:80})]),before=JSON.stringify(s),m=model(s);
 expect(m.summary.durations!.find(d=>d.n===5)).toMatchObject({n:5,sumMs:20,meanMs:4,maxMs:4,p50Ms:4,p95Ms:4,lowSampleP95:true});
 expect(m.slowTool.candidates).toHaveLength(1);expect(m.slowTool.candidates![0]).toMatchObject({n:5,sumMs:20,denominatorN:6,denominatorSumMs:100,observedEligibleNativeToolDurationShare:0.2,evidenceEventCount:5,includedEventCount:0});
 expect(JSON.stringify(m)).not.toMatch(/eventIds|sourceRef|boundaryFingerprint|keyId|cacheEvidence|SYNTHETIC_SECRET/);expect(JSON.stringify(s)).toBe(before);expect(Object.isFrozen(m)).toBe(true);
});
it("keeps zero, fractional, overflow and unavailable assessments distinct",()=>{
 const zero=model(source(group(5,{durationMs:0})));expect(zero.summary.durations![0]!.sumMs).toBe(0);expect(zero.slowTool.candidates).toEqual([]);expect(zero.slowTool.partitions[0]!.status).toBe("zero_denominator");
 const fraction=model(source(group(5,{durationMs:0.125})));expect(fraction.summary.durations![0]).toMatchObject({sumMs:0.625,meanMs:0.125});
 const overflow=model(source(group(5,{durationMs:Number.MAX_SAFE_INTEGER})));expect(overflow.summary.durations![0]!.sumMs).toBeNull();expect(overflow.slowTool.candidates).toBeNull();expect(overflow.slowTool.partitions[0]!.status).toBe("numeric_overflow");
 const absent=model({...source(group()),evidence:null});expect(absent.summary.suppressionReason).toBe("evidence_absent");expect(absent.slowTool.candidates).toBeNull();expect(absent.selection.candidates).toBeNull();
});
it("retains summary observations when stricter native provenance is unresolved",()=>{
 const rows=group(),s=source(rows,rows.slice(1).map(e=>codexObservation(e))),m=model(s);expect(m.summary.suppressionReason).toBeNull();expect(m.summary.durations![0]!.sumMs).toBe(20);expect(m.slowTool.suppressionReason).toBeNull();expect(m.slowTool.partitions[0]!.status).toBe("identity_unresolved");expect(m.slowTool.candidates).toBeNull();
});
it("selects six lexical sessions without changing source eligibility or denominators",()=>{
 const sessions=Array.from({length:7},(_,i)=>identity.fingerprint("session",["bounded",i])).sort(),rows=sessions.flatMap((sessionId,i)=>group(5,{sessionId},`s${i}`)),m=model(source(rows));
 expect(m.selection.shownSessionIds).toEqual(sessions.slice(0,6));expect(m.selection.sessions).toEqual({total:7,shown:6,omitted:1});expect(m.selection.candidates).toEqual({total:7,shown:6,omitted:1});expect(m.summary.durationEligibility.included).toBe(35);expect(m.slowTool.eligibility.admittedTimedCalls).toBe(35);expect(m.slowTool.candidates!.every(c=>c.denominatorN===5&&c.denominatorSumMs===20)).toBe(true);
});
it("caps known and overflow cohort rows separately with deterministic tie ordering",()=>{
 const patterns=Array.from({length:11},(_,i)=>`npm test ${"--verbose ".repeat(i)}<target>`),rows=patterns.flatMap((commandPattern,i)=>[...group(5,{commandPattern,durationMs:4},`k${i}`),...group(5,{commandPattern:commandPattern.replace("test","run"),durationMs:Number.MAX_SAFE_INTEGER},`u${i}`)]),s=source(rows),m=model(s),again=model({...s,events:[...s.events].reverse()});
 expect(m.selection.durations).toEqual({total:22,shown:20,omitted:2});expect(m.summary.durations!.filter(d=>d.sumMs!==null)).toHaveLength(10);expect(m.summary.durations!.filter(d=>d.sumMs===null)).toHaveLength(10);expect(m).toEqual(again);
});
it("does not silently truncate safeguards and substitutes only overlong safe pattern labels",()=>{
 const s=source(group(5,{commandPattern:`npm test ${"--verbose ".repeat(100)}<target>`})),summary=summarizeSource(s),slow=analyzeSourceSlowTool(s),m=buildSourceReportModel(summary,slow);
 expect(m.summary.durations![0]!.commandPattern).toBe("safe pattern omitted (display limit)");expect(m.slowTool.candidates![0]!.group.commandPattern).toBe("safe pattern omitted (display limit)");
 const bad=structuredClone(slow);(bad.candidates![0]! as {matchedExperiment:string}).matchedExperiment="a".repeat(2049);expect(()=>buildSourceReportModel(summary,bad)).toThrow();
});
it("rejects mismatched generation inputs rather than splicing views",()=>{
 const s=source(group());expect(()=>buildSourceReportModel(summarizeSource(s),{...analyzeSourceSlowTool(s),revision:4})).toThrow();
});
it("uses the union including usage-only and SlowTool-only sessions and bounds timing partitions",()=>{
 const sessions=Array.from({length:7},(_,i)=>identity.fingerprint("session",["union",i])).sort();
 const rows=sessions.flatMap((sessionId,i)=>group(5,{sessionId},`union${i}`));
 for(const durationScope of ["invocation_latency","process_runtime","item_lifecycle"] as const)for(const timingEvidence of ["source_reported","paired_timestamps"] as const)rows.push(...group(5,{sessionId:sessions[2]!,durationScope,timingEvidence},`${durationScope}${timingEvidence}`));
 const input=source(rows),summary=structuredClone(summarizeSource(input)),slow=structuredClone(analyzeSourceSlowTool(input));
 const controlledSummary={...summary,durations:summary.durations!.filter(d=>d.sessionId!==sessions[0]&&d.sessionId!==sessions[1]),usage:[{sessionId:sessions[0]!,provider:"codex" as const,mapping:"openai_responses" as const,finality:"trusted_final" as const,observedResponses:1,usageIds:[],counts:{input:10,output:2,total:12,cachedInput:3,cacheWriteInput:null,reasoningOutput:1,uncachedInput:7},overflowComponents:[],limitations:[]}]};
 const controlledSlow={...slow,partitions:slow.partitions.filter(p=>p.sessionId!==sessions[0]),candidates:slow.candidates!.filter(c=>c.sessionId!==sessions[0])};
 const m=buildSourceReportModel(controlledSummary,controlledSlow);expect(m.selection.shownSessionIds).toEqual(sessions.slice(0,6));expect(m.selection.sessions).toEqual({total:7,shown:6,omitted:1});expect(m.summary.usage![0]!.counts).toEqual(controlledSummary.usage[0]!.counts);expect(m.selection.sessionCounts.find(s=>s.sessionId===sessions[2])!.partitions).toEqual({total:6,shown:4,omitted:2});expect(m.slowTool.partitions.some(p=>p.sessionId===sessions[1])).toBe(true);expect(m.summary.durations!.some(d=>d.sessionId===sessions[1])).toBe(false);
});
it("caps cards at ten in context order and keeps native denominators unchanged",()=>{
 const sessions=Array.from({length:3},(_,i)=>identity.fingerprint("session",["cards",i])).sort(),patterns=["npm test","npm run build","cargo build","git status"];
 const rows=sessions.flatMap((sessionId,i)=>patterns.flatMap((commandPattern,j)=>group(5,{sessionId,commandPattern},`card${i}-${j}`))),m=model(source(rows));
 expect(m.selection.candidates).toEqual({total:12,shown:10,omitted:2});expect(m.slowTool.candidates!.every(c=>c.denominatorN===20&&c.denominatorSumMs===80&&c.observedEligibleNativeToolDurationShare===0.25)).toBe(true);expect(m.slowTool.candidates!.map(c=>c.sessionId)).toEqual([...Array(4).fill(sessions[0]),...Array(4).fill(sessions[1]),...Array(2).fill(sessions[2])]);
});
it("retains final-response usage nulls, cache subsets, finality exclusions and overflow components",()=>{
 const sessionId=identity.fingerprint("session",["usage-model"]);
 const usage=(name:string,extra:Partial<import("../src/parsers/types.js").UsageObservation>={}):import("../src/parsers/types.js").UsageObservation=>({id:identity.fingerprint("event",["u",name]),sessionId,responseId:identity.fingerprint("event",["r",name]),turnId:null,provider:"codex",source:"response_usage",scope:"response_increment",counts:{input:100,output:20,total:120,cachedInput:40,cacheWriteInput:0,reasoningOutput:5},mapping:"openai_responses",finality:"source_terminal",selection:"eligible",countStatus:"complete",limitations:[],toolEventId:null,phase:"unknown",sourceRef:{fileId:sourceId,byteOffset:1},...extra});
 const input=source(),withUsage=(rows:MetricEvidence["usage"])=>({...input,evidence:{...input.evidence!,usage:rows}});
 const m=model(withUsage([usage("a"),usage("partial",{finality:"trusted_partial"}),usage("provisional",{selection:"provisional"}),usage("null",{counts:null})]));
 expect(m.summary.usage![0]).toMatchObject({observedResponses:1,mapping:"openai_responses",finality:"source_terminal",counts:{input:100,output:20,total:120,cachedInput:40,cacheWriteInput:0,reasoningOutput:5,uncachedInput:null}});expect(m.summary.usageEligibility!.exclusions).toMatchObject({unverified_finality:1,provisional:1,incomplete_components:1});
 const unknown=model(withUsage([usage("a"),usage("b",{counts:{input:100,output:20,total:120,cachedInput:null,cacheWriteInput:null,reasoningOutput:null}})]));expect(unknown.summary.usage![0]!.counts).toMatchObject({input:200,output:40,total:240,cachedInput:null,cacheWriteInput:null,reasoningOutput:null});
 const overflow=model(withUsage([usage("big",{counts:{input:Number.MAX_SAFE_INTEGER,output:0,total:Number.MAX_SAFE_INTEGER,cachedInput:0,cacheWriteInput:0,reasoningOutput:0}}),usage("one",{counts:{input:1,output:0,total:1,cachedInput:0,cacheWriteInput:0,reasoningOutput:0}})]));expect(overflow.summary.usage![0]).toMatchObject({counts:{input:null,output:0,total:null,cachedInput:0},overflowComponents:["input","total"],limitations:["numeric_overflow"]});
});
