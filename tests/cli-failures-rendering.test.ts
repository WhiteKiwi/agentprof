import { expect, it } from "vitest";
import { formatSourceFailures } from "../src/cli/failures.js";
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
const prose=(s:string)=>s.replace(/\s+/g,' ');
const bounded=(text:string,ordinary=false)=>{expect(Buffer.byteLength(text)).toBeLessThanOrEqual(ordinary?6144:65536);expect(text.split('\n').length-1).toBeLessThanOrEqual(ordinary?45:400);};
it('bounds ordinary 2/5 output with timing/exclusions and full JSON evidence',()=>{
  const events=[event('a',{durationMs:0.5}),event('b',{durationMs:null,timingEvidence:'unknown',durationScope:'unknown'}),...Array.from({length:3},(_,i)=>event(`s${i}`,{status:'completed',executionOutcome:'success'})),event('u',{status:'unknown'})];
  const a=analyzeSourceFailures(source(events)),text=formatSourceFailures(a);bounded(text,true);
  for(const value of ['confirmed failed 2 / admitted terminal 5','completed=3','excluded unknown status=1','measured 1 / confirmed failed 2','sum=0.5 ms','mean=0.5 ms','p95=0.5 ms','low-N=true','missing_duration=1','Assessment=partial','generic Codex nonzero exits','npm test exit 2','Raw inventory (not confirmed counts)','display cohorts do not establish same task or error','mandatory full validation','security/build/regression','none, worse, noisy and incomparable','not run an experiment'])expect(prose(text)).toContain(value);
  for(const c of a.cohorts!)for(const ref of [...c.eventIds,...c.evidenceObservationIds]){expect(text).not.toContain(ref);expect(JSON.stringify(a)).toContain(ref);}
  expect(text).toContain('events shown=0/2; omitted=2; observations shown=0/2; omitted=2');
  for(const label of ['Quality guardrail:','Optional matched experiment:','Necessary-failure counterexample:'])expect(text.split(label).length-1).toBe(1);
  expect(text).not.toMatch(/FICTITIOUS_|sourceRef|errorFingerprint|operationKey|\u001b/);expect(text.endsWith('\n')).toBe(true);
});
it('distinguishes zero, null, source suppression and unresolved denominator',()=>{
  expect(formatSourceFailures(analyzeSourceFailures(source([event('s',{status:'completed',executionOutcome:'success'})])))).toContain('confirmed failed 0 / admitted terminal 1');
  const e=event('a'),missing=analyzeSourceFailures({...source([e]),evidence:null}),text=formatSourceFailures(missing);expect(text).toContain('cohorts unknown');expect(text).toContain('suppression=evidence_absent');expect(text).toContain('confirmed failed unknown / admitted terminal unknown');
  const unresolved=formatSourceFailures(analyzeSourceFailures(source([e],[])));expect(unresolved).toContain('provenance_unresolved');expect(unresolved).toContain('unresolved=1');expect(unresolved).not.toContain(e.id);
  expect(formatSourceFailures(analyzeSourceFailures(source([event('zero',{durationMs:0})])))).toContain('sum=0 ms; mean=0 ms');
});
it('renders supplied statistics without recalculating; overflow and untimed remain unknown',()=>{
  const a=analyzeSourceFailures(source([event('a')])),c=a.cohorts![0]!,m=c.measurements[0]!;const text=formatSourceFailures({...a,cohorts:[{...c,measurements:[{...m,sumMs:123.125,meanMs:999.5,p95Ms:777}]}]});expect(prose(text)).toContain('sum=123.125 ms; mean=999.5 ms');expect(text).toContain('p95=777 ms');
  const overflow=formatSourceFailures(analyzeSourceFailures(source([event('a',{durationMs:Number.MAX_SAFE_INTEGER}),event('b',{durationMs:1})])));expect(prose(overflow)).toContain('sum=unknown ms; mean=unknown ms');expect(overflow).toContain('numeric_overflow');
  expect(formatSourceFailures(analyzeSourceFailures(source([event('none',{durationMs:null})])))).toContain('duration unknown, not 0 ms');
});
it('retains Claude and coarse-family safeguards',()=>{
  const e=event('claude',{provider:'claude',toolName:'Bash',durationMs:null,timingEvidence:'unknown',durationScope:'unknown',sourceRef:{...event('claude').sourceRef,recordType:'user'}});expect(formatSourceFailures(analyzeSourceFailures(source([e])))).toContain('duration unknown, not 0 ms');
  const mcp=event('mcp',{kind:'mcp',category:'mcp',toolName:'mcp',commandPattern:null,durationScope:'invocation_latency'}),text=formatSourceFailures(analyzeSourceFailures(source([mcp])));expect(text).toContain('coarse_tool_family');expect(prose(text)).toContain('identify coarse MCP/browser invocations');
});
it('valid maximum shapes obey explicit caps while JSON keeps 4096 rows and 8192 proof IDs',()=>{
  const rows=Array.from({length:4096},(_,i)=>event(`a${i}`,{sessionId:identity.fingerprint('session',[i]),commandPattern:safePattern(i)}));const header=source(rows);for(const e of rows)validateEvent(e,header);
  const a=analyzeSourceFailures(header);let reads=0;const cohorts=new Proxy(a.cohorts!,{get(t,k,r){if(typeof k==='string'&&/^\d+$/.test(k))reads++;return Reflect.get(t,k,r);}});const text=formatSourceFailures({...a,cohorts});bounded(text);expect(text).toContain('Sessions shown=6/4096; omitted=4090');expect(text).toContain('cohorts shown=6/4096; omitted=4090');expect((text.match(/confirmed failed 1 \/ admitted terminal 1/g)??[])).toHaveLength(6);expect(reads).toBeLessThanOrEqual(8192);expect(text).not.toContain('cohort-4096');expect(text.split('Quality guardrail:')).toHaveLength(2);
  const pairedRows=rows.map(e=>({...e,startAt:'2026-09-20T00:00:00.000Z',endAt:'2026-09-20T00:00:00.004Z',durationScope:'invocation_latency' as const,timingEvidence:'paired_timestamps' as const,sourceRef:{...e.sourceRef,recordType:'response_item' as const}}));const b=analyzeSourceFailures(source(pairedRows,pairedRows.flatMap(paired)));const rendered=formatSourceFailures(b);bounded(rendered);expect(b.cohorts!.reduce((n,c)=>n+c.evidenceObservationIds.length,0)).toBe(8192);expect(JSON.stringify(b)).toContain(b.cohorts![4095]!.evidenceObservationIds[1]!);expect(rendered).not.toContain(b.cohorts![4095]!.evidenceObservationIds[1]!);
  const single=analyzeSourceFailures(source(rows.map(e=>({...e,sessionId:rows[0]!.sessionId}))));const brief=formatSourceFailures(single);bounded(brief);expect(brief).toContain('Failure cohorts shown=3/4096; omitted=4093');expect(brief).toContain('cohorts shown=3/4096; omitted=4093');
});
it('accounts exactly for clipped validated patterns and preserves full JSON',()=>{
  const pattern='rg '+Array.from({length:2048},()=> '--ignore-case').join(' '),e=event('long',{commandPattern:pattern});validateEvent(e,source([e]));const a=analyzeSourceFailures(source([e])),text=formatSourceFailures(a);bounded(text);expect(prose(text)).toContain(`pattern characters shown=80/${pattern.length}; omitted=${pattern.length-80}`);expect(text).not.toContain(pattern);expect(JSON.stringify(a)).toContain(pattern);expect(formatSourceFailures(a)).toBe(text);expect(Object.isFrozen(a)).toBe(true);
});
it('measurement selection is first three in supplied deterministic order with exact omission count',()=>{
  const a=analyzeSourceFailures(source([event('a')])),c=a.cohorts![0]!,m=c.measurements[0]!;const text=formatSourceFailures({...a,cohorts:[{...c,measurements:Array.from({length:6},(_,i)=>({...m,id:`m${i}`}))}]});bounded(text);expect(text).toContain('Measurements shown=3/6; omitted=3');expect(text).toContain('m0 ');expect(text).toContain('m2 ');expect(text).not.toContain('m3 ');
});
it('combined maximum displayed dimensions, long safe labels and overflow retain fixed byte/line ceilings',()=>{
  const rows: NormalizedEvent[]=[];
  for(let session=0;session<6;session++)for(let group=0;group<4;group++)for(const scope of ['process_runtime','invocation_latency','item_lifecycle'] as const)for(let sample=0;sample<2;sample++){
    const e=event(`${session}-${group}-${scope}-${sample}`,{provider:'claude',toolName:'Bash',sessionId:identity.fingerprint('session',[session]),commandPattern:safePattern(group)+' '+Array.from({length:2048},()=> '--ignore-case').join(' '),durationScope:scope,durationMs:sample===0?Number.MAX_SAFE_INTEGER:1});rows.push({...e,sourceRef:{...e.sourceRef,fileId:identity.fingerprint('source',['claude','failure-source']),recordType:'user'}});
  }
  const s=source(rows);for(const e of rows)validateEvent(e,s);const a=analyzeSourceFailures(s),text=formatSourceFailures(a);bounded(text);expect(a.cohorts).toHaveLength(24);expect(text).toContain('cohorts shown=18/24; omitted=6');expect(text.match(/numeric_overflow:/g)).toHaveLength(54);expect(text.match(/pattern characters shown=80/g)).toHaveLength(18);expect(text.split('Quality guardrail:')).toHaveLength(2);
});
