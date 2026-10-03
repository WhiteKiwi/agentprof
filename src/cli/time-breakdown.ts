import type { DurationCohort, SourceSummary } from "../analysis/source-summary.js";

const value=(n:number|null):string=>n===null?"unavailable":String(n);
const compare=(a:string,b:string):number=>a<b?-1:a>b?1:0;
const identity=(c:DurationCohort):string=>JSON.stringify([c.sessionId,c.durationScope,c.timingEvidence,c.category,c.toolName,c.commandPattern]);

export function formatSourceTimeBreakdown(s:SourceSummary):string{
 const e=s.durationEligibility;
 const lines=["AgentProf observed source-local time breakdown",`Source: ${s.sourceId}`,`${s.provider}; revision=${s.revision}; source bytes [0,${s.completedOffset})/${s.observedSize}; suppression=${s.suppressionReason??"none"}`,`Duration eligibility: terminal candidates=${e.terminalCandidates}; included=${e.included}`,`Exclusions: ${Object.entries(e.exclusions).map(([k,n])=>`${k}=${n}`).join("; ")}`,"Recorded duration sums may overlap. They are not elapsed time, busy time, time share, waste or savings."];
 if(!s.durations?.length)lines.push("Duration cohorts: unavailable; no eligible measured observations.");
 else{
  const partitions=new Map<string,DurationCohort[]>();
  for(const c of s.durations){const key=JSON.stringify([c.sessionId,c.durationScope,c.timingEvidence]);const rows=partitions.get(key);if(rows)rows.push(c);else partitions.set(key,[c]);}
  for(const [,rows] of [...partitions].sort(([a],[b])=>compare(a,b))){
   const first=rows[0]!;
   lines.push(`Session: ${first.sessionId}; scope=${first.durationScope}; evidence=${first.timingEvidence}; cohorts=${rows.length}`);
   for(const c of [...rows].sort((a,b)=>(b.sumMs??-1)-(a.sumMs??-1)||compare(identity(a),identity(b))))lines.push(`  category=${c.category}; tool=${c.toolName??"unknown"}; pattern=${c.commandPattern??"unknown"}; n=${c.n}; sum=${value(c.sumMs)} ms; mean=${value(c.meanMs)} ms; max=${c.maxMs} ms; p50=${c.p50Ms} ms; p95=${c.p95Ms} ms${c.lowSampleP95?" (low-N)":""}; limitations=${c.limitations.join(",")||"none"}`);
  }
 }
 lines.push("Limits: source-prefix recorded call durations only. Different scope/evidence partitions are not combined; overlapping calls can make sums exceed observed elapsed time.");
 return lines.join("\n")+"\n";
}
