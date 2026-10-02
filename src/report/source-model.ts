import { TIMELINE_HEADER_FIELDS, validateInvocationTimeline, validateSelectedInvocationTimeline } from "./invocation-timeline.js";
import type { SourceInvocationTimeline } from "./invocation-timeline.js";
import type { SourceSummary, DurationCohort, UsageCohort } from "../analysis/source-summary.js";
import type { SourceSlowToolAnalysis, SourceSlowToolCandidate, SlowToolPartition } from "../analysis/source-slow-tool.js";
import { SafeError } from "../privacy/diagnostics.js";
import { BREAKDOWN_HEADER_FIELDS, commandDetailState } from "./command-breakdown.js";
import type { CommandBreakdownHeader, DetailState, NativeCommandGroup, NativeCommandCall, SourceCommandBreakdown } from "./command-breakdown.js";
export type Count = Readonly<{ total:number; shown:number; omitted:number }>;
export type BreakdownContext = Readonly<{
 displayPartitionId:string; nativePartitionId:string|null;
 sessionId:string; durationScope:SlowToolPartition["durationScope"]; timingEvidence:SlowToolPartition["timingEvidence"];
 state:"source_suppressed"|"no_native_partition"|SlowToolPartition["status"];
 denominatorN:number|null; denominatorSumMs:number|null;
 groups:readonly NativeCommandGroup[]|null; calls:readonly NativeCommandCall[]|null;
 counts:Readonly<{groups:Count|null;calls:Count|null}>;
}>;
type BreakdownSelection = Readonly<{
 eligiblePartitions:Count|null;unavailablePartitions:Count|null;missingNativeContexts:Count|null;
 groups:Count|null;calls:Count|null;totalsScope:"eligible_detail_partitions_only";
}>;
type ReportCommandBreakdown = CommandBreakdownHeader & Readonly<{
 schema:"agentprof.source-command-breakdown/v1";state:DetailState;contexts:readonly BreakdownContext[];selection:BreakdownSelection;
}>;
type Duration = Omit<DurationCohort,"eventIds"> & { evidenceEventCount:number };
type Usage = Omit<UsageCohort,"usageIds"> & { evidenceUsageCount:number };
type Partition = Omit<SlowToolPartition,"eventIds"|"unresolvedEventIds"> & { evidenceEventCount:number; unresolvedEventCount:number };
type Candidate = Omit<SourceSlowToolCandidate,"evidenceEventIds"|"evidenceObservationIds"|"includedEventIds"> & { evidenceEventCount:number; evidenceObservationCount:number; includedEventCount:number };
export type SourceReportModel = Readonly<{
 schema:"agentprof.source-report/v3";
 commandBreakdown:ReportCommandBreakdown;
 invocationTimeline:SourceInvocationTimeline & Readonly<{selection:Readonly<{sessions:Count}>}>;
 summary:Omit<SourceSummary,"durations"|"usage"> & {durations:readonly Duration[]|null;usage:readonly Usage[]|null};
 slowTool:Omit<SourceSlowToolAnalysis,"partitions"|"candidates"> & {partitions:readonly Partition[];candidates:readonly Candidate[]|null};
 selection:{sessions:Count;partitions:Count;durations:Count;usage:Count;candidates:Count|null;shownSessionIds:readonly string[];sessionCounts:readonly {sessionId:string;partitions:Count;usage:Count}[];partitionCounts:readonly {sessionId:string;durationScope:string;timingEvidence:string;known:Count;unknown:Count;candidates:Count|null}[]};
}>;
const cmp=(a:string,b:string)=>a<b?-1:a>b?1:0;
const key=(p:{sessionId:string;durationScope:string;timingEvidence:string})=>JSON.stringify([p.sessionId,p.durationScope,p.timingEvidence]);
const count=(total:number,shown:number):Count=>({total,shown,omitted:total-shown});
const limit=()=>{throw new SafeError("REPORT_LIMIT");};
function text(value:string,max:number):string { if(Buffer.byteLength(value)>max || /[\u0000-\u001f\u007f-\u009f]/u.test(value))limit();return value; }
function pattern(value:string|null):string|null {return value===null?null:Buffer.byteLength(value)>512?"safe pattern omitted (display limit)":text(value,512);}
function owned<T>(value:T):T {if(value!==null&&typeof value==="object"){if(Array.isArray(value))return value.map(v=>owned(v)) as T;return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,owned(v)])) as T;}return value;}
function pick<T extends object,K extends keyof T>(obj:T,keys:readonly K[]):Pick<T,K>{return Object.fromEntries(keys.map(k=>[k,owned(obj[k])])) as Pick<T,K>;}
function freeze<T>(v:T):T{if(v!==null&&typeof v==="object"){for(const c of Object.values(v))freeze(c);Object.freeze(v);}return v;}
function labels(values:readonly string[],size=128){if(values.length>64)limit();for(const s of values)text(s,size);}
const nullableOrder=(a:string|null,b:string|null)=>a===null?(b===null?0:-1):b===null?1:cmp(a,b);
const rowOrder=(a:DurationCohort,b:DurationCohort)=> (b.sumMs??0)-(a.sumMs??0)||cmp(a.category,b.category)||nullableOrder(a.toolName,b.toolName)||nullableOrder(a.commandPattern,b.commandPattern);
/** Internal projection of unchanged analyzers and their native-detail join from one validated read. */
export function buildSourceReportModel(summary:SourceSummary,slow:SourceSlowToolAnalysis,breakdown:SourceCommandBreakdown,timeline:SourceInvocationTimeline):SourceReportModel {
 validateInvocationTimeline(timeline);
 for(const field of TIMELINE_HEADER_FIELDS)if(timeline[field]!==slow[field])throw new SafeError("INVALID_RECORD");
 for(const field of ["sourceId","provider","revision","completedOffset","observedSize","availability","persistedScope"] as const)if(summary[field]!==slow[field])throw new SafeError("INVALID_RECORD");
 for(const field of [...BREAKDOWN_HEADER_FIELDS,"assessment","suppressionReason"] as const)if(breakdown[field]!==slow[field])throw new SafeError("INVALID_RECORD");
 if(breakdown.partitions.length>4096)limit();
 if(breakdown.partitions.length!==slow.partitions.length||breakdown.state!==commandDetailState(slow.suppressionReason,slow.partitions))throw new SafeError("INVALID_RECORD");
 for(const [i,p]of breakdown.partitions.entries())for(const field of ["id","sessionId","durationScope","timingEvidence","status","denominatorN","denominatorSumMs"] as const)if(p[field]!==slow.partitions[i]![field])throw new SafeError("INVALID_RECORD");
 text(summary.sourceId,160);if((summary.durations?.length??0)>4096||(summary.usage?.length??0)>4096||slow.partitions.length>4096||(slow.candidates?.length??0)>4096)limit();
 const durations=summary.durations??[],usage=summary.usage??[],candidates=slow.candidates??[];
 const sessionIds=[...new Set([...durations,...usage,...slow.partitions,...timeline.partitions].map(x=>text(x.sessionId,160)))].sort(cmp),shownSessionIds=sessionIds.slice(0,6),shownSet=new Set(shownSessionIds);
 const allKeys=new Map<string,{sessionId:string;durationScope:string;timingEvidence:string}>();for(const row of [...durations,...slow.partitions])allKeys.set(key(row),pick(row,["sessionId","durationScope","timingEvidence"]));
 const partitionKeys=new Set<string>(),sessionCounts:SourceReportModel["selection"]["sessionCounts"][number][]=[],selectedUsage:UsageCohort[]=[];
 for(const sessionId of shownSessionIds){const partitions=[...allKeys.entries()].filter(([,p])=>p.sessionId===sessionId).sort((a,b)=>cmp(a[0],b[0]));for(const [k] of partitions.slice(0,4))partitionKeys.add(k);const rows=usage.filter(u=>u.sessionId===sessionId).sort((a,b)=>cmp(JSON.stringify([a.provider,a.mapping,a.finality]),JSON.stringify([b.provider,b.mapping,b.finality])));selectedUsage.push(...rows.slice(0,4));sessionCounts.push({sessionId,partitions:count(partitions.length,Math.min(4,partitions.length)),usage:count(rows.length,Math.min(4,rows.length))});}
 const selectedDurations:DurationCohort[]=[],selectedCards:SourceSlowToolCandidate[]=[],partitionCounts:SourceReportModel["selection"]["partitionCounts"][number][]=[];
 const ids=new Map(slow.partitions.map(p=>[p.id,p]));for(const c of candidates){const p=ids.get(c.partitionId);if(!p||key(p)!==key(c))throw new SafeError("INVALID_RECORD");}
 for(const k of partitionKeys){const p=allKeys.get(k)!,rows=durations.filter(d=>key(d)===k),known=rows.filter(d=>d.sumMs!==null).sort(rowOrder),unknown=rows.filter(d=>d.sumMs===null).sort(rowOrder),cards=candidates.filter(c=>key(c)===k),shownCards=cards.slice(0,Math.max(0,10-selectedCards.length));selectedDurations.push(...known.slice(0,10),...unknown.slice(0,10));selectedCards.push(...shownCards);partitionCounts.push({...p,known:count(known.length,Math.min(10,known.length)),unknown:count(unknown.length,Math.min(10,unknown.length)),candidates:slow.candidates===null?null:count(cards.length,shownCards.length)});}
 const summaryHead=pick(summary,["schema","scope","sourceId","provider","revision","completedOffset","observedSize","persistedScope","availability","crossSourceReconciled","aggregationReady","parserResumeReady","capabilities","suppressionReason","limitations","inventory","durationEligibility","usageEligibility"]);
 const slowHead=pick(slow,["schema","scope","sourceId","provider","parserVersion","normalizationVersion","keyVersion","revision","completedOffset","observedSize","persistedScope","availability","observationWindow","queryPeriod","crossSourceReconciled","aggregationReady","parserResumeReady","sourceFreshnessChecked","ruleId","ruleVersion","thresholds","assessment","suppressionReason","candidateAssessmentReason","capabilities","limitations","inventory","eligibility","provenance","observationInventory"]);
 for(const c of [summary.capabilities,slow.capabilities])if(c)labels(c.observedShapes);labels(summary.limitations);labels(slow.limitations);
 const nativeByTuple=new Map(breakdown.partitions.map(p=>[key(p),p]));
 const suppressed=breakdown.state==="suppressed";
 const contexts:BreakdownContext[]=partitionCounts.map((p,i)=>{
  const native=nativeByTuple.get(key(p)),base={displayPartitionId:`partition-${i+1}`,sessionId:p.sessionId,durationScope:p.durationScope as SlowToolPartition["durationScope"],timingEvidence:p.timingEvidence as SlowToolPartition["timingEvidence"]};
  if(suppressed||!native)return {...base,nativePartitionId:null,state:suppressed?"source_suppressed":"no_native_partition",denominatorN:null,denominatorSumMs:null,groups:null,calls:null,counts:{groups:null,calls:null}};
  const safeGroup=(g:NativeCommandGroup["group"])=>({...pick(g,["kind","category","toolName"]),commandPattern:pattern(g.commandPattern)});
  return {...base,nativePartitionId:native.id,state:native.status,denominatorN:native.denominatorN,denominatorSumMs:native.denominatorSumMs,
   groups:native.groups===null?null:native.groups.slice(0,10).map(g=>({...pick(g,["ordinal","n","sumMs","share"]),group:safeGroup(g.group)})),
   calls:native.calls===null?null:native.calls.slice(0,10).map(c=>({...pick(c,["ordinal","groupOrdinal","status","durationMs"]),group:safeGroup(c.group)})),
   counts:{groups:native.groups===null?null:count(native.groups.length,Math.min(10,native.groups.length)),calls:native.calls===null?null:count(native.calls.length,Math.min(10,native.calls.length))}};
 });
 const eligible=breakdown.partitions.filter(p=>p.status==="evaluated"||p.status==="zero_denominator"),unavailable=breakdown.partitions.filter(p=>p.status==="identity_unresolved"||p.status==="numeric_overflow");
 const missing=[...allKeys.keys()].filter(k=>!nativeByTuple.has(k));
 const detailSelection:BreakdownSelection=suppressed?{eligiblePartitions:null,unavailablePartitions:null,missingNativeContexts:null,groups:null,calls:null,totalsScope:"eligible_detail_partitions_only"}:{
  eligiblePartitions:count(eligible.length,eligible.filter(p=>partitionKeys.has(key(p))).length),unavailablePartitions:count(unavailable.length,unavailable.filter(p=>partitionKeys.has(key(p))).length),
  missingNativeContexts:count(missing.length,missing.filter(k=>partitionKeys.has(k)).length),
  groups:breakdown.state==="details_unavailable"?null:count(eligible.reduce((n,p)=>n+p.groups!.length,0),contexts.reduce((n,p)=>n+(p.groups?.length??0),0)),
  calls:breakdown.state==="details_unavailable"?null:count(eligible.reduce((n,p)=>n+p.calls!.length,0),contexts.reduce((n,p)=>n+(p.calls?.length??0),0)),totalsScope:"eligible_detail_partitions_only"};
 const commandBreakdown:ReportCommandBreakdown={...pick(breakdown,["schema",...BREAKDOWN_HEADER_FIELDS,"assessment","suppressionReason","state"]),contexts,selection:detailSelection};
 const result:SourceReportModel={schema:"agentprof.source-report/v3",commandBreakdown,invocationTimeline:{...owned(timeline),partitions:owned(timeline.partitions.filter(p=>shownSet.has(p.sessionId))),selection:{sessions:count(timeline.partitions.length,timeline.partitions.filter(p=>shownSet.has(p.sessionId)).length)}},summary:{...summaryHead,durations:summary.durations===null?null:selectedDurations.map(d=>{labels(d.limitations);return {...pick(d,["sessionId","category","toolName","durationScope","timingEvidence","n","sumMs","meanMs","maxMs","p50Ms","p95Ms","lowSampleP95","limitations"]),commandPattern:pattern(d.commandPattern),evidenceEventCount:d.eventIds.length};}),usage:summary.usage===null?null:selectedUsage.map(u=>{labels(u.limitations);return {...pick(u,["sessionId","provider","mapping","finality","observedResponses","counts","overflowComponents","limitations"]),evidenceUsageCount:u.usageIds.length};})},slowTool:{...slowHead,partitions:slow.partitions.filter(p=>shownSet.has(p.sessionId)&&partitionKeys.has(key(p))).map(p=>({...pick(p,["id","sessionId","durationScope","timingEvidence","status","tentativeTimedCalls","denominatorN","denominatorSumMs","unit"]),evidenceEventCount:p.eventIds.length,unresolvedEventCount:p.unresolvedEventIds.length})),candidates:slow.candidates===null?null:selectedCards.map(c=>{labels(c.limitations);for(const field of ["necessaryWorkCounterexample","investigativeAction","matchedExperiment","qualityGuardrail"] as const)text(c[field],2048);return {...pick(c,["id","ruleId","ruleVersion","severity","thresholds","partitionId","observationWindowRef","sourceContextRef","sessionId","grouping","durationScope","timingEvidence","measurementBasis","n","sumMs","meanMs","maxMs","p50Ms","p95Ms","lowSampleP95","denominatorN","denominatorSumMs","unit","observedEligibleNativeToolDurationShare","confidence","limitations","necessaryWorkCounterexample","investigativeAction","matchedExperiment","qualityGuardrail"]),group:{...pick(c.group,["kind","category","toolName"]),commandPattern:pattern(c.group.commandPattern)},evidenceEventCount:c.evidenceEventIds.length,evidenceObservationCount:c.evidenceObservationIds.length,includedEventCount:c.includedEventIds.length};})},selection:{sessions:count(sessionIds.length,shownSessionIds.length),partitions:count(allKeys.size,partitionKeys.size),durations:count(durations.length,selectedDurations.length),usage:count(usage.length,selectedUsage.length),candidates:slow.candidates===null?null:count(candidates.length,selectedCards.length),shownSessionIds,sessionCounts,partitionCounts}};
 validateReportModel(result);return freeze(result);
}
type Check=(value:unknown)=>void;
const exact=(value:unknown)=>{if(value===null||typeof value!=="object"||![Object.prototype,null].includes(Object.getPrototypeOf(value)))limit();return Object.getOwnPropertyDescriptors(value);};
const object=(shape:Record<string,Check>):Check=>value=>{const ds=exact(value),keys=Reflect.ownKeys(ds);if(keys.length!==Object.keys(shape).length)limit();for(const k of keys){if(typeof k!=="string"||!Object.hasOwn(shape,k))limit();const d=ds[k as string]!;if(!("value"in d))limit();shape[k as string]!(d.value);}};
const array=(check:Check,max:number):Check=>value=>{if(!Array.isArray(value)||value.length>max)limit();const ds=Object.getOwnPropertyDescriptors(value);if(Reflect.ownKeys(ds).length!==(value as unknown[]).length+1)limit();for(let i=0;i<(value as unknown[]).length;i++){const d=ds[String(i)];if(!d||!("value"in d))limit();check(d!.value);}};
const nullable=(check:Check):Check=>value=>{if(value!==null)check(value);};
const literal=(expected:unknown):Check=>value=>{if(value!==expected)limit();};
const word=(...values:string[]):Check=>value=>{if(typeof value!=="string"||!values.includes(value))limit();text(value as string,96);};
const string=(max:number):Check=>value=>{if(typeof value!=="string")limit();text(value as string,max);};
const numeric:Check=value=>{if(typeof value!=="number"||!Number.isFinite(value)||value<0||value>Number.MAX_SAFE_INTEGER)limit();};
const integer:Check=value=>{numeric(value);if(!Number.isSafeInteger(value))limit();};
const boolean:Check=value=>{if(typeof value!=="boolean")limit();};
const fields=(names:string,check:Check)=>Object.fromEntries(names.split(" ").map(k=>[k,check]));
const id=(domain:string):Check=>value=>{string(160)(value);if(!new RegExp(`^h1:[a-f0-9]{32}:${domain}:[a-f0-9]{64}$`).test(value as string))limit();};
const provider=word("codex","claude"),scope=word("invocation_latency","process_runtime","item_lifecycle"),timing=word("source_reported","paired_timestamps"),tool=nullable(word("Bash","Read","Write","Edit","Grep","Glob","exec_command","write_stdin","apply_patch","mcp","browser","other")),category=word("model","test","build","search","read","write","edit","mcp","browser","skill","subagent","other");
const timingFields={sessionId:id("session"),durationScope:scope,timingEvidence:timing};
const countCheck=object(fields("total shown omitted",integer));
const countsCheck=object(fields("input output total cachedInput cacheWriteInput reasoningOutput uncachedInput",nullable(integer)));
const capabilityCheck=object({provider,parserVersion:integer,support:word("shape_verified_only"),coverage:word("recognized_shapes","partial"),observedShapes:array(word("command_item","mcp_item","function_call","custom_call","tool_result","poll","code_wrapper","turn","response_usage","token_snapshot","tool_use","message_link","message_usage","background_acknowledgement","turn_duration"),64),unsupportedRecords:integer,ambiguousRecords:integer,stateLimited:boolean,diagnosticsDropped:integer});
const inventoryFields={events:integer,...fields("turns usage observations diagnostics",nullable(integer)),eventStatuses:object(fields("completed failed cancelled pending unknown",integer)),eventOutcomes:object(fields("success no_match change_detected error unknown",integer))};
const durationExclusions="source_suppressed cancelled pending unknown_status missing_duration invalid_duration unknown_scope estimated_timing unknown_timing";
const sourceFields={scope:literal("source_prefix"),sourceId:id("source"),provider,revision:integer,completedOffset:integer,observedSize:integer,persistedScope:word("events_only","events_and_metric_evidence"),availability:word("available","unavailable"),crossSourceReconciled:literal(false),aggregationReady:literal(false),parserResumeReady:literal(false),capabilities:nullable(capabilityCheck)};
const limitations=array(string(128),64),statsFields={n:integer,sumMs:nullable(numeric),meanMs:nullable(numeric),maxMs:numeric,p50Ms:numeric,p95Ms:numeric,lowSampleP95:boolean};
const summaryCheck=object({...sourceFields,schema:literal("agentprof.source-summary/v1"),suppressionReason:nullable(word("source_unavailable","evidence_absent","state_limited","ambiguous_origin")),limitations,inventory:object({...inventoryFields,usageSelections:nullable(object(fields("eligible provisional snapshot_only conflicted invalid",integer))),usageFinalities:nullable(object(fields("source_terminal trusted_final trusted_partial unknown",integer)))}),durationEligibility:object({terminalCandidates:integer,included:integer,exclusions:object(fields(durationExclusions,integer))}),usageEligibility:nullable(object({...fields("observedResponses selectedRows deduplicatedRows excludedRows excludedResponseGroups",integer),exclusions:object(fields("source_suppressed cumulative_snapshot unverified_snapshot non_response_usage duplicate_response_conflict invalid conflicted provisional snapshot_only unverified_finality missing_response_id incomplete_components unverified_mapping",integer))})),durations:nullable(array(object({...timingFields,category,toolName:tool,commandPattern:nullable(string(512)),...statsFields,limitations:array(literal("numeric_overflow"),1),evidenceEventCount:integer}),480)),usage:nullable(array(object({sessionId:id("session"),provider,mapping:word("openai_responses","anthropic_messages"),finality:word("source_terminal","trusted_final"),observedResponses:integer,counts:countsCheck,overflowComponents:array(word("input","output","total","cachedInput","cacheWriteInput","reasoningOutput","uncachedInput"),7),limitations,evidenceUsageCount:integer}),24))});
const thresholdsCheck=object({minimumTimedCalls:literal(5),minimumDurationShare:literal(0.2),p95LowSampleBelow:literal(20)});
const partitionCheck=object({...timingFields,id:string(96),status:word("evaluated","zero_denominator","numeric_overflow","identity_unresolved"),tentativeTimedCalls:integer,denominatorN:nullable(integer),denominatorSumMs:nullable(numeric),unit:literal("ms"),evidenceEventCount:integer,unresolvedEventCount:integer});
const candidateCheck=object({...timingFields,id:string(96),ruleId:literal("slow-tool"),ruleVersion:literal("source-prefix-v1"),severity:literal("NOTICE"),thresholds:thresholdsCheck,partitionId:string(96),observationWindowRef:literal("source.observationWindow"),sourceContextRef:literal("source"),group:object({kind:word("model","shell","file_read","file_write","file_edit","search","mcp","browser","skill","subagent","other"),category,toolName:tool,commandPattern:nullable(string(512))}),grouping:word("coarse_tool_family","safe_display_cohort"),measurementBasis:word("direct","observed"),...statsFields,sumMs:numeric,meanMs:numeric,denominatorN:integer,denominatorSumMs:numeric,unit:literal("ms"),observedEligibleNativeToolDurationShare:value=>{numeric(value);if((value as number)>1)limit();},...fields("evidenceEventCount evidenceObservationCount includedEventCount",integer),confidence:object({pattern:literal("candidate"),avoidableWork:literal("unestablished"),rootCause:literal("unestablished"),effect:literal("unestablished")}),limitations,...fields("necessaryWorkCounterexample investigativeAction matchedExperiment qualityGuardrail",string(2048))});
const slowCheck=object({...sourceFields,schema:literal("agentprof.source-slow-tool/v1"),parserVersion:integer,normalizationVersion:literal(1),keyVersion:literal(1),observationWindow:object({unit:literal("source_bytes"),startInclusive:literal(0),endExclusive:integer}),queryPeriod:literal(null),sourceFreshnessChecked:literal(false),ruleId:literal("slow-tool"),ruleVersion:literal("source-prefix-v1"),thresholds:thresholdsCheck,assessment:word("suppressed","no_eligible_events","evaluated","partial"),suppressionReason:nullable(word("source_unavailable","evidence_absent","state_limited","ambiguous_origin","unsupported_contract","unresolved_execution_relation")),candidateAssessmentReason:nullable(word("source_suppressed","no_eligible_events","no_evaluable_partition")),limitations,inventory:object(inventoryFields),eligibility:object({tentativeTimedCalls:integer,admittedTimedCalls:integer,exclusions:object(fields(durationExclusions+" model unsupported_call_class inconsistent_category identity_unresolved_partition",integer))}),provenance:object({unresolvedEvents:integer,failures:object(fields("contradictory_provenance missing_provenance unsupported_timing_representation",integer))}),observationInventory:object(fields("knownWrapperIds linkedExecutionObservations orphanEventReferences unlinkedObservations",integer)),partitions:array(partitionCheck,24),candidates:nullable(array(candidateCheck,10))});
const selectionCheck=object({...fields("sessions partitions durations usage",countCheck),candidates:nullable(countCheck),shownSessionIds:array(id("session"),6),sessionCounts:array(object({sessionId:id("session"),partitions:countCheck,usage:countCheck}),6),partitionCounts:array(object({...timingFields,known:countCheck,unknown:countCheck,candidates:nullable(countCheck)}),24)});
const nativeGroupIdentity=object({kind:word("model","shell","file_read","file_write","file_edit","search","mcp","browser","skill","subagent","other"),category,toolName:tool,commandPattern:nullable(string(512))});
const fraction:Check=value=>{numeric(value);if((value as number)>1)limit();};
const nativeGroupCheck=object({ordinal:integer,group:nativeGroupIdentity,n:integer,sumMs:numeric,share:nullable(fraction)});
const nativeCallCheck=object({ordinal:integer,groupOrdinal:integer,group:nativeGroupIdentity,status:word("completed","failed"),durationMs:numeric});
const breakdownContextCheck=object({...timingFields,displayPartitionId:string(96),nativePartitionId:nullable(string(96)),state:word("source_suppressed","no_native_partition","evaluated","zero_denominator","identity_unresolved","numeric_overflow"),denominatorN:nullable(integer),denominatorSumMs:nullable(numeric),groups:nullable(array(nativeGroupCheck,10)),calls:nullable(array(nativeCallCheck,10)),counts:object({groups:nullable(countCheck),calls:nullable(countCheck)})});
const breakdownCheck=object({schema:literal("agentprof.source-command-breakdown/v1"),sourceId:id("source"),provider,parserVersion:integer,normalizationVersion:literal(1),keyVersion:literal(1),revision:integer,completedOffset:integer,observedSize:integer,persistedScope:word("events_only","events_and_metric_evidence"),availability:word("available","unavailable"),assessment:word("suppressed","no_eligible_events","evaluated","partial"),suppressionReason:nullable(word("source_unavailable","evidence_absent","state_limited","ambiguous_origin","unsupported_contract","unresolved_execution_relation")),state:word("suppressed","no_native_partitions","details_available","details_partial","details_unavailable"),contexts:array(breakdownContextCheck,24),selection:object({...fields("eligiblePartitions unavailablePartitions missingNativeContexts groups calls",nullable(countCheck)),totalsScope:literal("eligible_detail_partitions_only")})});
/** Internal owned-model validation; not an arbitrary Proxy inspection API. */
export function validateReportModel(model:SourceReportModel):void {
 object({schema:literal("agentprof.source-report/v3"),summary:summaryCheck,slowTool:slowCheck,selection:selectionCheck,commandBreakdown:breakdownCheck,invocationTimeline:value=>{
  const ds=exact(value);if(Reflect.ownKeys(ds).some(k=>typeof k!=="string"))limit();const selection=ds.selection;if(!selection||!("value"in selection))limit();
  object({sessions:countCheck})(selection!.value);
  const projection=Object.fromEntries(Object.entries(ds).filter(([k])=>k!=="selection").map(([k,d])=>{if(!("value"in d))limit();return [k,d.value];}));
  validateSelectedInvocationTimeline(projection as SourceInvocationTimeline);
 }})(model);
 const t=model.invocationTimeline,ts=t.selection.sessions;
 for(const field of TIMELINE_HEADER_FIELDS)if(t[field]!==model.slowTool[field])limit();
 if(ts.shown!==t.partitions.length||ts.total>4096||ts.shown+ts.omitted!==ts.total||t.partitions.some(p=>!model.selection.shownSessionIds.includes(p.sessionId)))limit();
 if(model.selection.sessions.shown!==model.selection.shownSessionIds.length||model.selection.sessions.shown+model.selection.sessions.omitted!==model.selection.sessions.total||new Set(model.selection.shownSessionIds).size!==model.selection.shownSessionIds.length)limit();
 const b=model.commandBreakdown;
 for(const field of [...BREAKDOWN_HEADER_FIELDS,"assessment","suppressionReason"] as const)if(b[field]!==model.slowTool[field])limit();
 if(b.contexts.length!==model.selection.partitionCounts.length)limit();
 const validCount=(c:Count|null,shown?:number)=>{if(c!==null&&(c.shown+c.omitted!==c.total||shown!==undefined&&c.shown!==shown))limit();};
 const suppressed=b.state==="suppressed";
 if(suppressed!==(b.suppressionReason!==null))limit();
 for(const [i,c]of b.contexts.entries()){
  if(c.displayPartitionId!==`partition-${i+1}`||key(c)!==key(model.selection.partitionCounts[i]!))limit();
  const native=model.slowTool.partitions.find(p=>key(p)===key(c));
  if(suppressed||!native){
   if(c.state!==(suppressed?"source_suppressed":"no_native_partition")||c.nativePartitionId!==null||c.denominatorN!==null||c.denominatorSumMs!==null)limit();
  }else if(c.nativePartitionId!==native.id||c.state!==native.status||c.denominatorN!==native.denominatorN||c.denominatorSumMs!==native.denominatorSumMs)limit();
  const eligible=c.state==="evaluated"||c.state==="zero_denominator";
  if(!eligible){if(c.groups!==null||c.calls!==null||c.counts.groups!==null||c.counts.calls!==null)limit();continue;}
  if(c.groups===null||c.calls===null||c.counts.groups===null||c.counts.calls===null||c.denominatorN===null||c.denominatorSumMs===null)limit();
  const groups=c.groups!,calls=c.calls!,denominator=c.denominatorSumMs!;
  validCount(c.counts.groups,groups.length);validCount(c.counts.calls,calls.length);
  if(c.counts.calls!.total!==c.denominatorN||c.counts.groups!.total>c.denominatorN!||(c.state==="zero_denominator")!==(denominator===0))limit();
  const groupIds=new Set<number>(),callIds=new Set<number>();
  for(const g of groups){if(g.ordinal<1||groupIds.has(g.ordinal)||g.ordinal>c.counts.groups!.total||g.n<1||g.n>c.denominatorN!||g.sumMs>denominator||g.share!==(denominator===0?null:g.sumMs/denominator))limit();groupIds.add(g.ordinal);}
  for(const call of calls){if(call.ordinal<1||callIds.has(call.ordinal)||call.ordinal>c.denominatorN!||call.groupOrdinal<1||call.groupOrdinal>c.counts.groups!.total||call.durationMs>denominator)limit();callIds.add(call.ordinal);}
 }
 for(const field of ["eligiblePartitions","unavailablePartitions","missingNativeContexts","groups","calls"] as const){const c=b.selection[field];validCount(c);if(suppressed&&c!==null)limit();}
 if(!suppressed){
  const shownEligible=b.contexts.filter(c=>c.groups!==null).length,shownUnavailable=b.contexts.filter(c=>c.state==="numeric_overflow"||c.state==="identity_unresolved").length;
  if(b.selection.eligiblePartitions===null||b.selection.unavailablePartitions===null||b.selection.missingNativeContexts===null)limit();
  validCount(b.selection.eligiblePartitions,shownEligible);validCount(b.selection.unavailablePartitions,shownUnavailable);validCount(b.selection.missingNativeContexts,b.contexts.filter(c=>c.state==="no_native_partition").length);
  const eligible=b.selection.eligiblePartitions!.total,unavailable=b.selection.unavailablePartitions!.total;
  const expected=eligible>0?(unavailable>0?"details_partial":"details_available"):(unavailable>0?"details_unavailable":"no_native_partitions");
  if(b.state!==expected)limit();
  if(b.state==="details_unavailable"){if(b.selection.groups!==null||b.selection.calls!==null)limit();}
  else {if(b.selection.groups===null||b.selection.calls===null)limit();validCount(b.selection.groups,b.contexts.reduce((n,c)=>n+(c.groups?.length??0),0));validCount(b.selection.calls,b.contexts.reduce((n,c)=>n+(c.calls?.length??0),0));}
 }
}
