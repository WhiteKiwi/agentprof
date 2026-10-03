import type { StoredSource } from "../db/source-store.js";
import type { NormalizedTurn } from "../parsers/types.js";

export type ActiveTimePartition = Readonly<{
  id: string;
  sessionId: string;
  intervalScope: "turn_wall" | "observed_turn";
  intervalTimingEvidence: "source_reported" | "paired_timestamps" | "estimated";
  turnN: number;
  activeTimeMs: number | null;
  observedSpanMs: number | null;
  turnIds: readonly string[];
}>;

export type SourceActiveTimeAnalysis = Readonly<{
  schema: "agentprof.source-active-time/v1";
  scope: "source_prefix";
  metric: "active_time";
  sourceId: string;
  provider: StoredSource["provider"];
  parserVersion: number;
  revision: number;
  completedOffset: number;
  observedSize: number;
  assessment: "evaluated" | "partial" | "unavailable" | "no_eligible_turns";
  summary: Readonly<{ eligibleTurns: number; excludedTurns: number; partitions: number }>;
  exclusions: Readonly<{ unsupportedProvider: number; pending: number; missingBoundaries: number; unknownInterval: number; invalidBoundaries: number }>;
  partitions: readonly ActiveTimePartition[] | null;
  limitations: readonly string[];
}>;

const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const add = (a: number, b: number): number | null => Number.isSafeInteger(a + b) ? a + b : null;

function union(rows: readonly Readonly<{ start: number; end: number }>[]): number | null {
  if (!rows.length) return 0;
  const sorted = [...rows].sort((a,b) => a.start-b.start || a.end-b.end);
  let start=sorted[0]!.start,end=sorted[0]!.end,total=0;
  for(let i=1;i<sorted.length;i++){const row=sorted[i]!;if(row.start<=end){if(row.end>end)end=row.end;continue;}const next=add(total,end-start);if(next===null)return null;total=next;start=row.start;end=row.end;}
  return add(total,end-start);
}

/** Pure source-prefix Active Time. Duration-only turns are never converted into intervals. */
export function analyzeSourceActiveTime(source: StoredSource): SourceActiveTimeAnalysis {
  const exclusions={unsupportedProvider:0,pending:0,missingBoundaries:0,unknownInterval:0,invalidBoundaries:0};
  if(source.provider!=="codex") {
    exclusions.unsupportedProvider=source.evidence?.turns.length ?? 0;
    return Object.freeze({schema:"agentprof.source-active-time/v1",scope:"source_prefix",metric:"active_time",sourceId:source.sourceId,provider:source.provider,parserVersion:source.parserVersion,revision:source.revision,completedOffset:source.completedOffset,observedSize:source.observedSize,assessment:"unavailable",summary:Object.freeze({eligibleTurns:0,excludedTurns:exclusions.unsupportedProvider,partitions:0}),exclusions:Object.freeze(exclusions),partitions:null,limitations:Object.freeze(["claude_duration_only_turns_are_not_positioned","no_interval_inference_from_duration"])});
  }
  const turns=(source.evidence?.turns ?? []) as readonly NormalizedTurn[];
  const buckets=new Map<string,{sessionId:string;scope:"turn_wall"|"observed_turn";evidence:"source_reported"|"paired_timestamps"|"estimated";rows:{turn:NormalizedTurn;start:number;end:number}[]}>();
  let eligible=0;
  for(const turn of turns){
    if(turn.status==="pending"){exclusions.pending++;continue;}
    if(turn.startAt===null||turn.endAt===null){exclusions.missingBoundaries++;continue;}
    if(turn.intervalScope==="unknown"||turn.intervalTimingEvidence==="unknown"){exclusions.unknownInterval++;continue;}
    const start=Date.parse(turn.startAt),end=Date.parse(turn.endAt);
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||end<start){exclusions.invalidBoundaries++;continue;}
    const evidence=turn.intervalTimingEvidence;
    if(evidence!=="source_reported"&&evidence!=="paired_timestamps"&&evidence!=="estimated"){exclusions.unknownInterval++;continue;}
    const key=JSON.stringify([turn.sessionId,turn.intervalScope,evidence]);
    let bucket=buckets.get(key);if(!bucket){bucket={sessionId:turn.sessionId,scope:turn.intervalScope,evidence,rows:[]};buckets.set(key,bucket);}
    bucket.rows.push({turn,start,end});eligible++;
  }
  const partitions:ActiveTimePartition[]=[];
  for(const [,bucket] of [...buckets].sort(([a],[b])=>compare(a,b))){
    const starts=bucket.rows.map(r=>r.start),ends=bucket.rows.map(r=>r.end);
    const min=Math.min(...starts),max=Math.max(...ends),span=Number.isSafeInteger(max-min)?max-min:null;
    partitions.push(Object.freeze({id:`active-${partitions.length+1}`,sessionId:bucket.sessionId,intervalScope:bucket.scope,intervalTimingEvidence:bucket.evidence,turnN:bucket.rows.length,activeTimeMs:union(bucket.rows),observedSpanMs:span,turnIds:Object.freeze(bucket.rows.map(r=>r.turn.id).sort(compare))}));
  }
  const excluded=Object.values(exclusions).reduce((a,b)=>a+b,0);
  return Object.freeze({schema:"agentprof.source-active-time/v1",scope:"source_prefix",metric:"active_time",sourceId:source.sourceId,provider:source.provider,parserVersion:source.parserVersion,revision:source.revision,completedOffset:source.completedOffset,observedSize:source.observedSize,assessment:eligible===0?"no_eligible_turns":excluded?"partial":"evaluated",summary:Object.freeze({eligibleTurns:eligible,excludedTurns:excluded,partitions:partitions.length}),exclusions:Object.freeze(exclusions),partitions:Object.freeze(partitions),limitations:Object.freeze(["observed_turn_elapsed_not_cpu_time","gaps_are_excluded_from_active_time_but_included_in_observed_span","partitions_with_different_scope_or_timing_evidence_are_not_combined","no_task_elapsed_or_savings_inference"])});
}
