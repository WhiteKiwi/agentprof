import { describe, expect, it } from "vitest";
import { analyzeSourceFailures } from "../src/analysis/source-failures.js";
import type { MetricEvidence, StoredSource } from "../src/db/source-store.js";
import type { NormalizedEvent } from "../src/normalize/types.js";
import { normalizeEvent } from "../src/normalize/event.js";
import { validateEvent } from "../src/db/source-validation.js";
import { createIdentityContext } from "../src/normalize/identity.js";
import type { SourceObservation } from "../src/parsers/types.js";
import type { ClaudeSourceObservation } from "../src/parsers/claude/types.js";

const safeFlags=["--ignore-case","--files","--hidden","--json","--quiet","--all","--no-ignore","--verbose","--fixed-strings","-n","-l","-F"];
const safePattern=(i:number)=>["rg",...safeFlags.filter((_,bit)=>(i & (1<<bit))!==0)].join(" ");
const identity = createIdentityContext(new Uint8Array(32).fill(71), "a".repeat(32));
const id = (s: string) => identity.fingerprint("event", [s]);
function event(name: string, extra: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return { ...normalizeEvent({ provider: "codex", eventIdentity: name, sessionIdentity: "failure-unit", kind: "shell", toolName: "exec_command", command: "rg FICTITIOUS_FAILURE_PRIVATE src", status: "failed", statusEvidence: "explicit", exitCode: 2, durationMs: 4, timingEvidence: "source_reported", durationScope: "process_runtime", sourceRef: { fileIdentity: "failure-source", byteOffset: 10, recordType: "event_msg" } }, identity).event!, status: "failed", executionOutcome: "error", ...extra };
}
function observation(e: NormalizedEvent, extra: Partial<SourceObservation> = {}): SourceObservation {
  return { id: id(`observation-${e.id}`), eventId: e.id, turnId: null, usageId: null, representation: "structured", origin: "ordinary", transportStatus: e.executionOutcome === "no_match" || e.executionOutcome === "change_detected" ? "failed" : e.status, observedUsage: null, sourceRef: { fileId: e.sourceRef.fileId, byteOffset: e.sourceRef.byteOffset }, ...extra };
}
function paired(e: NormalizedEvent): SourceObservation[] {
  return [observation(e, { id: id(`call-${e.id}`), representation: "call", transportStatus: "unknown", sourceRef: { fileId: e.sourceRef.fileId, byteOffset: 1 } }), observation(e, { representation: "result", transportStatus: "unknown" })];
}
function claude(e: NormalizedEvent): ClaudeSourceObservation[] {
  const base = { eventId: e.id, sessionId: e.sessionId, messageId: null, usageId: null, turnId: null, origin: "ordinary" as const, observedUsage: null };
  return [{ ...base, id: id(`call-${e.id}`), representation: "call", observedResult: null, sourceRef: { fileId: e.sourceRef.fileId, byteOffset: 1 } }, { ...base, id: id(`result-${e.id}`), representation: "result", sourceRef: { fileId: e.sourceRef.fileId, byteOffset: e.sourceRef.byteOffset }, observedResult: { isError: e.status === "failed", completionKind: "invocation_result", unassignedAcknowledgement: false, observedAt: e.endAt, acknowledgementLatencyMs: null, durationMs: e.timingEvidence === "source_reported" ? e.durationMs : null, durationScope: e.timingEvidence === "source_reported" ? e.durationScope : "unknown" } }];
}
function source(events: NormalizedEvent[] = [], observations?: MetricEvidence["observations"]): StoredSource {
  const provider = events[0]?.provider ?? "codex";
  return { sourceId: identity.fingerprint("source", [provider, "failure-source"]), provider, parserVersion: 1, normalizationVersion: 1, keyVersion: 1, keyId: identity.keyId, revision: 3, availability: "available", completedOffset: 1000, observedSize: 1005, boundaryFingerprint: identity.fingerprint("content", ["boundary"]), cacheEvidence: null, events, persistedScope: "events_and_metric_evidence", aggregationReady: false, parserResumeReady: false, evidence: { turns: [], usage: [], observations: observations ?? events.flatMap(e => provider === "claude" ? claude(e) : [observation(e)]), diagnostics: [], capabilities: { provider, parserVersion: 1, support: "shape_verified_only", coverage: "recognized_shapes", observedShapes: [], unsupportedRecords: 0, ambiguousRecords: 0, stateLimited: false, diagnosticsDropped: 0 } } };
}
function checked(s: StoredSource) {
  const r = analyzeSourceFailures(s);
  expect(r.eligibility.admittedTerminalCalls + Object.values(r.eligibility.exclusions).reduce((a,b) => a+b,0)).toBe(s.events.length);
  expect(r.provenance.unresolvedEvents).toBe(Object.values(r.provenance.failures).reduce((a,b) => a+b,0));
  for (const p of r.partitions) if (p.status === "evaluated") expect(p.failedN! + p.completedN!).toBe(p.terminalN);
  return r;
}
const response = (e: NormalizedEvent): NormalizedEvent => ({ ...e, sourceRef: { ...e.sourceRef, recordType: "response_item" }, timingEvidence: "paired_timestamps", durationScope: "invocation_latency", startAt: "2026-09-20T00:00:00.000Z", endAt: "2026-09-20T00:00:00.004Z" });
function deepFreeze<T>(v: T): T { if (v && typeof v === "object") { Object.values(v).forEach(deepFreeze); Object.freeze(v); } return v; }

describe("frozen independent status and timing oracles", () => {
  it("admits exactly two failed of five terminal including untimed/no-match and missing identity", () => {
    const rows = [event("f1", { operationKey: null, errorFingerprint: null }), event("f2", { durationMs: null, timingEvidence: "unknown", durationScope: "unknown" }), event("s1", { status: "completed", executionOutcome: "no_match" }), event("s2", { status: "completed", executionOutcome: "success", durationMs: 0 }), event("s3", { status: "completed", executionOutcome: "change_detected" })];
    const r = checked(source(rows));
    expect(r.partitions[0]).toMatchObject({ status: "evaluated", terminalN: 5, completedN: 3, failedN: 2, terminalEventIds: rows.map(e=>e.id).sort() });
    expect(r.cohorts).toHaveLength(1); expect(r.cohorts![0]).toMatchObject({ failedN: 2, missingErrorIdentityN: 2, timing: { measuredN: 1, exclusions: { missing_duration: 1 } } });
    expect(r.cohorts![0]!.measurements[0]).toMatchObject({ n: 1, confirmedFailedN: 2, sumMs: 4, meanMs: 4, maxMs: 4, p50Ms: 4, p95Ms: 4, lowSampleP95: true });
  });
  it("zero observed failures differs from absent and suppressed assessment", () => {
    expect(checked(source([event("s", { status: "completed", executionOutcome: "success" })]))).toMatchObject({ assessment: "evaluated", cohorts: [], partitions: [{ failedN: 0, terminalN: 1 }] });
    expect(checked(source())).toMatchObject({ assessment: "no_eligible_events", cohorts: null, partitions: [] });
    expect(checked({ ...source([event("s")]), evidence: null })).toMatchObject({ assessment: "suppressed", cohorts: null });
  });
  it("retains 0 and fractions while independently excluding untimed failures", () => {
    const r = checked(source([event("a", {durationMs:0}),event("b",{durationMs:0.5}),event("c",{durationMs:null})]));
    expect(r.cohorts![0]).toMatchObject({ failedN:3,timing:{measuredN:2},measurements:[{n:2,confirmedFailedN:3,sumMs:0.5,meanMs:0.25,maxMs:0.5,p50Ms:0,p95Ms:0.5}] });
  });
  it.each([1,19,20])("nearest rank and low sample n=%s", n => {
    const r=checked(source(Array.from({length:n},(_,i)=>event(`q${i}`,{durationMs:i+1}))));
    expect(r.cohorts![0]!.measurements[0]).toMatchObject({n,sumMs:n*(n+1)/2,meanMs:(n+1)/2,p50Ms:Math.ceil(n/2),p95Ms:Math.ceil(n*0.95),lowSampleP95:n<20});
  });
  it("overflow loses only sum and mean",()=>{
    const r=checked(source([event('a',{durationMs:Number.MAX_SAFE_INTEGER}),event('b',{durationMs:1})]));
    expect(r.partitions[0]!.failedN).toBe(2);expect(r.cohorts![0]!.measurements[0]).toMatchObject({n:2,sumMs:null,meanMs:null,maxMs:Number.MAX_SAFE_INTEGER,p50Ms:1,p95Ms:Number.MAX_SAFE_INTEGER});
  });
  it("separates source/session and direct/paired timing without copying denominators to cohorts",()=>{
    const a=event('a'), b=response(event('b')), c=event('c',{sessionId:id('session-two'),commandPattern:'rg --json <target>'});
    const r=checked(source([a,b,c],[observation(a),...paired(b),observation(c)]));expect(r.partitions).toHaveLength(2);expect(r.cohorts).toHaveLength(2);
    const cohort=r.cohorts!.find(x=>x.failedN===2)!;expect(cohort.measurements).toHaveLength(2);expect(cohort).not.toHaveProperty('terminalEventIds');
  });
  it("unknown native rows remain excluded beside confirmed subset denominator",()=>{
    const r=checked(source([event('f'),event('u',{status:'unknown'})]));expect(r.partitions[0]).toMatchObject({terminalN:1,failedN:1,exclusions:{unknown_status:1}});expect(r.assessment).toBe('partial');
    expect(checked(source([event('u',{status:'unknown'})])).partitions[0]).toMatchObject({status:'no_eligible_events',terminalN:null,failedN:null});
  });
});

describe("status provenance and whole-session suppression",()=>{
  it.each(['missing','origin','provider','position','representation','transport'])("rejects Codex %s without denominator shrink",mode=>{
    const a=event('a'),b=event('b');let obs: MetricEvidence['observations']=[observation(a),observation(b)];
    if(mode==='missing')obs=obs.slice(1);
    else obs=[observation(a,mode==='origin'?{origin:'trusted_copied'}:mode==='position'?{sourceRef:{fileId:a.sourceRef.fileId,byteOffset:999}}:mode==='representation'?{representation:'result'}:mode==='transport'?{transportStatus:'pending'}:{}),observation(b)];
    const base=source([a,b],obs);
    const r=checked(mode==='provider'?{...base,events:[{...a,provider:'claude'},b]}:base);
    expect(r.cohorts).toBeNull();expect(r.eligibility.admittedTerminalCalls).toBe(0);
    // Event provider mismatch is contradictory provenance under the unchanged source provider.
    expect(r.partitions.every(p=>p.terminalN===null)).toBe(true);
  });
  it("missing untimed native provenance suppresses whole session, not just timing",()=>{
    const rows=[event('a'),event('b',{durationMs:null}),event('other',{sessionId:id('other')})];
    const r=checked(source(rows,[observation(rows[0]!),observation(rows[2]!)]));
    expect(r.eligibility.exclusions.provenance_unresolved_partition).toBe(2);expect(r.eligibility.admittedTerminalCalls).toBe(1);expect(r.assessment).toBe('partial');expect(r.cohorts).toHaveLength(1);
  });
  it("ordinary Codex result/poll accepts unknown transport and requires call",()=>{
    const e=response(event('a',{durationMs:null})); const p=paired(e);
    expect(checked(source([e],p)).partitions[0]!.failedN).toBe(1);
    expect(checked(source([e],[p[1]!])).partitions[0]!.terminalN).toBeNull();
    expect(checked(source([e],[p[0]!,{...p[1]!,representation:'poll'}])).partitions[0]!.failedN).toBe(1);
  });
  it("structured precedence ignores nondecisive fallback status and missing duration",()=>{
    const e=event('a',{durationMs:null});expect(checked(source([e],[observation(e),...paired(e).map(o=>({...o,sourceRef:{...o.sourceRef,byteOffset:44}}))])).partitions[0]!.failedN).toBe(1);
  });
  it.each(['session','origin','isError','background','unassigned','missingCall','provider','position'])("Claude %s cannot admit convenient duplicate",mode=>{
    const e=event('a',{provider:'claude',toolName:'Bash',durationMs:null,timingEvidence:'unknown',durationScope:'unknown',endAt:null,sourceRef:{...event('a').sourceRef,recordType:'user'}});const obs=claude(e);const result=obs[1]!;
    let bad: MetricEvidence['observations']=mode==='missingCall'?[result]:mode==='provider'?[...obs,observation(e)]:[obs[0]!,result,{...result,id:id('bad'),...(mode==='session'?{sessionId:id('wrong')}:{}),...(mode==='origin'?{origin:'trusted_copied' as const}:{}),...(mode==='position'?{sourceRef:{...result.sourceRef,byteOffset:99}}:{}),observedResult:{...result.observedResult!,...(mode==='isError'?{isError:false}:{}),...(mode==='time'?{observedAt:'2026-01-01T00:00:00.000Z'}:{}),...(mode==='background'?{completionKind:'background_acknowledgement' as const}:{}),...(mode==='unassigned'?{unassignedAcknowledgement:true}:{})}}];
    if(mode==='position')bad=[obs[0]!,{...result,sourceRef:{...result.sourceRef,byteOffset:99}}];
    expect(checked(source([e],bad)).partitions[0]!.terminalN).toBeNull();
  });
  it("Claude null observedAt=endAt preserves untimed confirmed status",()=>{
    const e=event('a',{provider:'claude',toolName:'Bash',durationMs:null,timingEvidence:'unknown',durationScope:'unknown',endAt:null,sourceRef:{...event('a').sourceRef,recordType:'user'}});expect(checked(source([e])).cohorts![0]).toMatchObject({failedN:1,timing:{measuredN:0},measurements:[]});
  });
});

describe("suppression, exclusions, privacy and structural bounds",()=>{
  it.each(['unavailable','absent','limited','dropped','ambiguous','parser','parent','wrapper'])("source suppression %s",mode=>{
    const e=event('a'),s=source([e]);const r=checked({...s,availability:mode==='unavailable'?'unavailable':'available',parserVersion:mode==='parser'?2:1,events:mode==='parent'?[{...e,parentEventId:id('parent')}]:s.events,evidence:mode==='absent'?null:{...s.evidence!,capabilities:{...s.evidence!.capabilities,stateLimited:mode==='limited',diagnosticsDropped:mode==='dropped'?1:0,ambiguousRecords:mode==='ambiguous'?1:0},observations:mode==='wrapper'?[observation(e,{representation:'wrapper'})]:s.evidence!.observations}});expect(r.assessment).toBe('suppressed');expect(r.cohorts).toBeNull();expect(r.eligibility.exclusions.source_suppressed).toBe(1);
  });
  it.each([['model',{kind:'model',category:'model'}],['unsupported_call_class',{kind:'skill',category:'skill',toolName:'Skill'}],['inconsistent_category',{category:'edit'}],['cancelled',{status:'cancelled'}],['pending',{status:'pending'}],['unknown_status',{status:'unknown'}]] as const)('disjoint status exclusion %s',(reason,extra)=>{const r=checked(source([event('a',extra)]));expect(r.eligibility.exclusions[reason]).toBe(1);});
  it.each([['missing_duration',{durationMs:null}],['invalid_duration',{durationMs:-1}],['unknown_scope',{durationScope:'unknown'}],['estimated_timing',{timingEvidence:'estimated'}],['unknown_timing',{timingEvidence:'unknown'}],['unsupported_timing_representation',{durationScope:'item_lifecycle'}]] as const)('independent timing exclusion %s',(reason,extra)=>{const r=checked(source([event('a',extra)]));expect(r.partitions[0]!.failedN).toBe(1);expect(r.cohorts![0]!.timing.exclusions[reason]).toBe(1);});
  it("deep freeze, input permutation and no fingerprints/raw sentinel",()=>{
    const s=source([event('a'),event('b')]);const before=JSON.stringify(s);const r=checked(deepFreeze(s));expect(JSON.stringify(s)).toBe(before);expect(Object.isFrozen(r.cohorts![0]!.measurements)).toBe(true);expect(checked({...s,events:[...s.events].reverse(),evidence:{...s.evidence!,observations:[...s.evidence!.observations].reverse()}})).toEqual(r);expect(JSON.stringify(r)).not.toMatch(/FICTITIOUS_|boundaryFingerprint|operationKey|errorFingerprint|contentFingerprint|sourceRef/);
  });
  it("4096 cohorts and 8192 observations retain linear complete references",()=>{
    const rows=Array.from({length:4096},(_,i)=>response(event(`a${i}`,{commandPattern:safePattern(i)})));const header=source(rows);for(const e of rows)validateEvent(e,header);const r=checked(source(rows,rows.flatMap(paired)));expect(r.cohorts).toHaveLength(4096);expect(r.partitions[0]!.terminalN).toBe(4096);expect(r.cohorts!.reduce((n,c)=>n+c.evidenceObservationIds.length,0)).toBe(8192);expect(r.cohorts!.reduce((n,c)=>n+c.eventIds.length,0)).toBe(4096);
    expect(()=>analyzeSourceFailures(source([...rows,event('excess')]))).toThrow('source_failures_limit_exceeded');
    expect(()=>analyzeSourceFailures(source(rows,[...rows.flatMap(paired),observation(rows[0]!) ]))).toThrow('source_failures_limit_exceeded');
  });
});
it("source envelopes and safe display cohorts never imply shared identity", () => {
  const a=source([event('a'),event('b',{operationKey:null,errorFingerprint:id('known-error')})]);
  const one=checked(a),two=checked({...a,sourceId:identity.fingerprint('source',['other-source']),revision:9});
  expect(one.cohorts).toHaveLength(1);expect(one.cohorts![0]).toMatchObject({failedN:2,missingErrorIdentityN:1});expect(two.sourceId).not.toBe(one.sourceId);expect(two.revision).toBe(9);
  expect(two.cohorts).toEqual(one.cohorts);
});
it("unsupported/orphan wrapper inventory neither adds executions nor suppresses unrelated native rows",()=>{
  const e=event('a');const r=checked(source([e],[observation(e),observation(e,{id:id('wrapper'),eventId:id('not-stored'),representation:'wrapper'}),observation(e,{id:id('unlinked'),eventId:null,representation:'result'})]));
  expect(r.partitions[0]!.failedN).toBe(1);expect(r.observationInventory).toEqual({knownWrapperIds:1,linkedExecutionObservations:1,orphanEventReferences:1,unlinkedObservations:1});
});
it("paired/direct Claude timing remains independently provenance-qualified",()=>{
  const e=event('a',{provider:'claude',toolName:'Bash',durationScope:'invocation_latency',sourceRef:{...event('a').sourceRef,recordType:'user'}}),obs=claude(e);
  const r=checked(source([e],[obs[0]!,{...obs[1]!,observedResult:{...obs[1]!.observedResult!,durationMs:999}}]));expect(r.partitions[0]!.failedN).toBe(1);expect(r.cohorts![0]).toMatchObject({timing:{measuredN:0,exclusions:{missing_timing_provenance:1}}});
});
it("event-ID checked floating sums are invariant to input ordering",()=>{
  const rows=Array.from({length:5},(_,i)=>event(`sum${i}`)).sort((a,b)=>a.id<b.id?-1:1),values=[1e15,0.0625,0.0625,1,1];const input=rows.map((e,i)=>({...e,durationMs:values[i]!}));let sum=0;for(const n of values)sum+=n;
  expect(checked(source(input)).cohorts![0]!.measurements[0]!.sumMs).toBe(sum);expect(checked(source([...input].reverse()))).toEqual(checked(source(input)));
});
it.each([
  {status:'failed' as const,executionOutcome:'error' as const,transportStatus:'completed' as const},
  {status:'completed' as const,executionOutcome:'success' as const,transportStatus:'failed' as const},
])('rejects impossible structured status/transport tuple $status/$transportStatus', fields=>{
  const e=event('tuple',fields);const r=checked(source([e],[observation(e,{transportStatus:fields.transportStatus})]));expect(r.partitions[0]!.terminalN).toBeNull();expect(r.provenance.failures.contradictory_provenance).toBe(1);
});
it('keeps confirmed Claude status when ordinary reversed timestamps clear normalized endAt',()=>{
  const e=event('reversed',{provider:'claude',toolName:'Bash',startAt:'2026-09-20T00:00:00.010Z',endAt:null,durationMs:null,durationScope:'unknown',timingEvidence:'unknown',sourceRef:{...event('reversed').sourceRef,recordType:'user'}});const obs=claude(e);const r=checked(source([e],[obs[0]!,{...obs[1]!,observedResult:{...obs[1]!.observedResult!,observedAt:'2026-09-20T00:00:00.001Z'}}]));expect(r.partitions[0]!.failedN).toBe(1);expect(r.cohorts![0]!.timing.measuredN).toBe(0);
});
it.each(['no_match','change_detected'] as const)('structured %s allows failed transport only',executionOutcome=>{
  const e=event('semantic',{status:'completed',executionOutcome});expect(checked(source([e],[observation(e,{transportStatus:'failed'})])).partitions[0]!.completedN).toBe(1);expect(checked(source([e],[observation(e,{transportStatus:'completed'})])).partitions[0]!.terminalN).toBeNull();
});
it.each(['end','duration','observedAt'] as const)('Claude mismatched %s rejects timing without losing status',mode=>{
  const base=event('paired',{provider:'claude',toolName:'Bash',startAt:'2026-09-20T00:00:00.000Z',endAt:'2026-09-20T00:00:00.004Z',durationMs:4,durationScope:'invocation_latency',timingEvidence:'paired_timestamps',sourceRef:{...event('paired').sourceRef,recordType:'user'}});const obs=claude(base);const e={...base,...(mode==='end'?{endAt:null}:mode==='duration'?{durationMs:5}:{})};const r=checked(source([e],mode==='observedAt'?[obs[0]!,{...obs[1]!,observedResult:{...obs[1]!.observedResult!,observedAt:null}}]:obs));expect(r.partitions[0]!.failedN).toBe(1);expect(r.cohorts![0]!.timing.exclusions.missing_timing_provenance).toBe(1);
});
it.each([
  {status:'failed' as const,executionOutcome:'unknown' as const,transportStatus:'failed' as const},
  {status:'completed' as const,executionOutcome:'error' as const,transportStatus:'completed' as const},
])('rejects additional unreachable structured $status/$executionOutcome tuple',fields=>{
  const e=event('unreachable',fields);expect(checked(source([e],[observation(e,{transportStatus:fields.transportStatus})])).partitions[0]!.terminalN).toBeNull();
});
