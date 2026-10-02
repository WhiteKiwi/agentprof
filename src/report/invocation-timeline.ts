import type { StoredSource } from "../db/source-store.js";
import type { NormalizedEvent } from "../normalize/types.js";
import type { InvocationOverlapPartition, SourceInvocationOverlapAnalysis } from "../analysis/source-invocation-overlap.js";
import type { NativeCommandIdentity } from "./command-breakdown.js";
import { BREAKDOWN_HEADER_FIELDS } from "./command-breakdown.js";
import { SafeError } from "../privacy/diagnostics.js";
export const TIMELINE_HEADER_FIELDS = BREAKDOWN_HEADER_FIELDS;
export type TimelineHeader = Readonly<Pick<SourceInvocationOverlapAnalysis, typeof TIMELINE_HEADER_FIELDS[number] | "assessment" | "suppressionReason">>;
export type TimelineCount = Readonly<{total:number;shown:number;omitted:number}>;
export type TimelineRow = Readonly<{ordinal:number;group:NativeCommandIdentity;status:"completed"|"failed";startOffsetMs:number;endOffsetMs:number;intervalLengthMs:number}>;
export type TimelineDisplayReason = Exclude<InvocationOverlapPartition["reason"],null>|"unsafe_axis_span";
export type TimelinePartition = Readonly<Omit<InvocationOverlapPartition,"contributingEventIds"|"evidenceObservationIds"> & {
 display:Readonly<{state:"available"|"unavailable";reason:TimelineDisplayReason|null;axisSpanMs:number|null;rows:readonly TimelineRow[]|null;counts:TimelineCount}>;
}>;
export type SourceInvocationTimeline = TimelineHeader & Readonly<{schema:"agentprof.source-invocation-timeline/v1";partitions:readonly TimelinePartition[]}>;
function invalid():never{throw new SafeError("INVALID_RECORD");}
function limit():never{throw new SafeError("REPORT_LIMIT");}
const safe=(n:number)=>Number.isSafeInteger(n)&&n>=0;
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
const count=(total:number,shown:number):TimelineCount=>({total,shown,omitted:total-shown});
function freeze<T>(v:T):T{if(v!==null&&typeof v==="object"){for(const c of Object.values(v))freeze(c);Object.freeze(v);}return v;}
function identity(e:NormalizedEvent):NativeCommandIdentity{
 const p=e.commandPattern;if(p!==null&&/[\u0000-\u001f\u007f-\u009f]/u.test(p))limit();
 return {kind:e.kind,category:e.category,toolName:e.toolName,commandPattern:p!==null&&Buffer.byteLength(p)>512?"safe pattern omitted (display limit)":p};
}
/** Consistency join only. The unchanged analyzer owns admission and S/U/excess.
 * No provenance, admission or interval-union algorithm is duplicated here. */
export function buildSourceInvocationTimeline(source:StoredSource,overlap:SourceInvocationOverlapAnalysis):SourceInvocationTimeline{
 for(const f of TIMELINE_HEADER_FIELDS)if(source[f]!==overlap[f])invalid();
 if(source.events.length>4096||overlap.partitions.length>4096||(source.evidence?.observations.length??0)>8192)limit();
 const events=new Map<string,NormalizedEvent>(),sessions=new Set<string>();
 for(const e of source.events){if(events.has(e.id))invalid();events.set(e.id,e);sessions.add(e.sessionId);}
 const used=new Set<string>(),ids=new Set<string>(),partitionSessions=new Set<string>();let memberships=0;
 const partitions:TimelinePartition[]=overlap.partitions.map(p=>{
  memberships+=p.contributingEventIds.length;if(memberships>4096)limit();
  if(ids.has(p.id)||partitionSessions.has(p.sessionId)||!sessions.has(p.sessionId))invalid();ids.add(p.id);partitionSessions.add(p.sessionId);
  if(p.intervalScope!=="invocation_latency"||p.intervalTimingEvidence!=="paired_timestamps"||p.unit!=="ms"||p.coverage.positionedN!==p.contributingEventIds.length)invalid();
  const positioned=p.contributingEventIds.map(id=>{
   const e=events.get(id);if(!e||used.has(id)||e.sessionId!==p.sessionId||e.provider!==source.provider||(e.status!=="completed"&&e.status!=="failed")||e.intervalScope!=="invocation_latency"||e.intervalTimingEvidence!=="paired_timestamps"||e.startAt===null||e.endAt===null)invalid();used.add(id);
   const start=Date.parse(e.startAt),end=Date.parse(e.endAt);if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||end<start)invalid();return {event:e,start,end,length:end-start};
  });
  if(positioned.filter(r=>!safe(r.length)).length!==p.coverage.unsafeDifferenceN)invalid();
  const head={id:p.id,sessionId:p.sessionId,intervalScope:p.intervalScope,intervalTimingEvidence:p.intervalTimingEvidence,unit:p.unit,status:p.status,reason:p.reason,coverage:{...p.coverage,exclusions:{...p.coverage.exclusions}},intervalLengthSumMs:p.intervalLengthSumMs,intervalUnionMs:p.intervalUnionMs,excessMs:p.excessMs};
  const unavailable=(reason:TimelineDisplayReason):TimelinePartition=>({...head,display:{state:"unavailable",reason,axisSpanMs:null,rows:null,counts:count(positioned.length,0)}});
  if(overlap.suppressionReason!==null||p.status==="unavailable"){if(p.status!=="unavailable"||p.reason===null)invalid();return unavailable(p.reason);}
  if(source.provider!=="claude"||positioned.length===0||positioned.some(r=>!safe(r.length)))invalid();
  positioned.sort((a,b)=>a.start-b.start||a.end-b.end||compare(a.event.id,b.event.id));
  const origin=positioned[0]!.start,span=Math.max(...positioned.map(r=>r.end))-origin;
  if(!safe(span)||positioned.some(r=>!safe(r.start-origin)||!safe(r.end-origin)))return unavailable("unsafe_axis_span");
  const rows:TimelineRow[]=positioned.slice(0,20).map((r,i)=>({ordinal:i+1,group:identity(r.event),status:r.event.status as "completed"|"failed",startOffsetMs:r.start-origin,endOffsetMs:r.end-origin,intervalLengthMs:r.length}));
  return {...head,display:{state:"available",reason:null,axisSpanMs:span,rows,counts:count(positioned.length,rows.length)}};
 });
 const header=Object.fromEntries(TIMELINE_HEADER_FIELDS.map(f=>[f,overlap[f]])) as Pick<TimelineHeader,typeof TIMELINE_HEADER_FIELDS[number]>;
 const result:SourceInvocationTimeline={schema:"agentprof.source-invocation-timeline/v1",...header,assessment:overlap.assessment,suppressionReason:overlap.suppressionReason,partitions};
 try{validateInvocationTimeline(result);}catch{invalid();}return freeze(result);
}
// Exact owned-data checks guard model and standalone renderer entry points.
type Check=(value:unknown)=>void;
const object=(shape:Record<string,Check>):Check=>v=>{
 if(v===null||typeof v!=="object"||![Object.prototype,null].includes(Object.getPrototypeOf(v)))limit();const ds=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(ds);if(keys.length!==Object.keys(shape).length)limit();
 for(const k of keys){if(typeof k!=="string"||!Object.hasOwn(shape,k))limit();const d=ds[k]!;if(!("value"in d))limit();shape[k]!(d.value);}
};
const array=(check:Check,max:number):Check=>v=>{if(!Array.isArray(v)||v.length>max)limit();const ds=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(ds).length!==v.length+1)limit();for(let i=0;i<v.length;i++){const d=ds[String(i)];if(!d||!("value"in d))limit();check(d.value);}};
const text=(max:number):Check=>v=>{if(typeof v!=="string"||Buffer.byteLength(v)>max||/[\u0000-\u001f\u007f-\u009f]/u.test(v))limit();};
const word=(...values:readonly(string|null)[]):Check=>v=>{if(!values.includes(v as string|null))limit();};
const integer:Check=v=>{if(typeof v!=="number"||!safe(v))limit();};
const nullable=(check:Check):Check=>v=>{if(v!==null)check(v);};
const boolean:Check=v=>{if(typeof v!=="boolean")limit();};
const fields=(names:string,check:Check)=>Object.fromEntries(names.split(" ").map(k=>[k,check]));
const id=(domain:string):Check=>v=>{text(160)(v);if(!new RegExp(`^h1:[a-f0-9]{32}:${domain}:[a-f0-9]{64}$`).test(v as string))limit();};
const reasons=["source_suppressed","unsupported_provider","provenance_unresolved","no_eligible_terminal_events","no_positioned_intervals","unsafe_endpoint_difference","unsafe_interval_sum","unsafe_union","unsafe_excess"] as const;
const countCheck=object(fields("total shown omitted",integer));
const groupCheck=object({kind:word("model","shell","file_read","file_write","file_edit","search","mcp","browser","skill","subagent","other"),category:word("model","test","build","search","read","write","edit","mcp","browser","skill","subagent","other"),toolName:nullable(word("Bash","Read","Write","Edit","Grep","Glob","exec_command","write_stdin","apply_patch","mcp","browser","other")),commandPattern:nullable(text(512))});
const rowCheck=object({ordinal:integer,group:groupCheck,status:word("completed","failed"),...fields("startOffsetMs endOffsetMs intervalLengthMs",integer)});
const partitionCheck=object({id:text(96),sessionId:id("session"),intervalScope:word("invocation_latency"),intervalTimingEvidence:word("paired_timestamps"),unit:word("ms"),status:word("evaluated","partial","unavailable"),reason:word(null,...reasons),coverage:object({...fields("admittedTerminalN positionedN excludedN unsafeDifferenceN",integer),complete:boolean,exclusions:object(fields("missing_boundary invalid_boundary unsupported_scope unsupported_evidence result_boundary_mismatch",integer))}),...fields("intervalLengthSumMs intervalUnionMs excessMs",nullable(integer)),display:object({state:word("available","unavailable"),reason:word(null,...reasons,"unsafe_axis_span"),axisSpanMs:nullable(integer),rows:nullable(array(rowCheck,20)),counts:countCheck})});
const headerShape:Record<string,Check>={sourceId:id("source"),provider:word("claude","codex"),parserVersion:integer,normalizationVersion:v=>{if(v!==1)limit();},keyVersion:v=>{if(v!==1)limit();},...fields("revision completedOffset observedSize",integer),persistedScope:word("events_only","events_and_metric_evidence"),availability:word("available","unavailable"),assessment:word("suppressed","unavailable","partial","evaluated"),suppressionReason:word(null,"source_unavailable","evidence_absent","state_limited","ambiguous_origin","unsupported_contract","unresolved_execution_relation","unsupported_provider")};
export function validateTimelinePartition(p:TimelinePartition):void{
 partitionCheck(p);const c=p.coverage,d=p.display,available=p.status!=="unavailable";
 if(c.admittedTerminalN>4096||c.positionedN+c.excludedN!==c.admittedTerminalN||c.unsafeDifferenceN>c.positionedN||Object.values(c.exclusions).reduce((a,b)=>a+b,0)!==c.excludedN||c.complete!==(available&&c.excludedN===0))limit();
 if(available){if(p.reason!==null||c.positionedN===0||c.unsafeDifferenceN!==0||p.intervalLengthSumMs===null||p.intervalUnionMs===null||p.excessMs===null||p.intervalUnionMs>p.intervalLengthSumMs||p.excessMs!==p.intervalLengthSumMs-p.intervalUnionMs||(p.status==="partial")!==(c.excludedN>0))limit();}
 else if(p.reason===null||p.intervalLengthSumMs!==null||p.intervalUnionMs!==null||p.excessMs!==null)limit();
 if(d.counts.total!==c.positionedN||d.counts.shown+d.counts.omitted!==d.counts.total)limit();
 if(d.state==="unavailable"){if(d.rows!==null||d.axisSpanMs!==null||d.counts.shown!==0||d.reason!==(available?"unsafe_axis_span":p.reason))limit();return;}
 if(!available||d.reason!==null||d.rows===null||d.axisSpanMs===null||d.rows.length!==Math.min(20,c.positionedN)||d.counts.shown!==d.rows.length)limit();
 const rows=d.rows,span=d.axisSpanMs;if(p.intervalUnionMs!>span||rows[0]!.startOffsetMs!==0)limit();
 for(const[i,r]of rows.entries()){const prior=rows[i-1];if(r.ordinal!==i+1||r.endOffsetMs<r.startOffsetMs||r.endOffsetMs>span||r.intervalLengthMs!==r.endOffsetMs-r.startOffsetMs||r.intervalLengthMs>p.intervalLengthSumMs!||prior&&(r.startOffsetMs<prior.startOffsetMs||r.startOffsetMs===prior.startOffsetMs&&r.endOffsetMs<prior.endOffsetMs))limit();}
 if(d.counts.omitted===0&&Math.max(...rows.map(r=>r.endOffsetMs))!==span)limit();
}
/** Validate full projection, or a selected projection with explicit session accounting. */
function checkTimeline(t:SourceInvocationTimeline,selected:boolean):void{
 object({schema:word("agentprof.source-invocation-timeline/v1"),...headerShape,partitions:array(partitionCheck,selected?6:4096)})(t);
 if(t.completedOffset>t.observedSize||(t.assessment==="suppressed")!==(t.suppressionReason!==null)||t.provider==="codex"&&t.suppressionReason===null)limit();
 const ids=new Set<string>(),sessions=new Set<string>();let total=0;
 for(const p of t.partitions){validateTimelinePartition(p);if(ids.has(p.id)||sessions.has(p.sessionId)||t.suppressionReason!==null&&p.status!=="unavailable")limit();ids.add(p.id);sessions.add(p.sessionId);total+=p.coverage.admittedTerminalN;if(total>4096)limit();}
 if(t.assessment==="evaluated"&&t.partitions.some(p=>p.status!=="evaluated")||t.assessment==="unavailable"&&t.partitions.some(p=>p.status!=="unavailable"))limit();
 if(!selected&&t.suppressionReason===null){const eligible=t.partitions.filter(p=>p.status!=="unavailable"),expected=eligible.length===0?"unavailable":t.partitions.some(p=>p.status!=="evaluated")?"partial":"evaluated";if(t.assessment!==expected)limit();}
}

export function validateInvocationTimeline(t:SourceInvocationTimeline):void{checkTimeline(t,false);}
export function validateSelectedInvocationTimeline(t:SourceInvocationTimeline):void{checkTimeline(t,true);}
