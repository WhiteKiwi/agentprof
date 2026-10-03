import type { DurationCohort, SourceSummary } from "../analysis/source-summary.js";

const compare=(a:string,b:string):number=>a<b?-1:a>b?1:0;
const value=(n:number|null):string=>n===null?"unavailable":String(n);
const key=(c:DurationCohort):string=>JSON.stringify([c.sessionId,c.durationScope,c.timingEvidence,c.category,c.toolName,c.commandPattern]);

export function formatSourceLatency(s:SourceSummary):string{
 const e=s.durationEligibility;
 const lines=["AgentProf observed source-local tool latency",`Source: ${s.sourceId}`,`${s.provider}; revision=${s.revision}; source bytes [0,${s.completedOffset})/${s.observedSize}; suppression=${s.suppressionReason??"none"}`,`Eligibility: terminal candidates=${e.terminalCandidates}; included=${e.included}`,`Exclusions: ${Object.entries(e.exclusions).map(([k,n])=>`${k}=${n}`).join("; ")}`,"p50/p95 are existing nearest-rank cohort quantiles. p95 with n < 20 is marked low-N."];
 if(!s.durations?.length)lines.push("Latency cohorts: unavailable; no eligible measured observations.");
 else{
  const partitions=new Map<string,DurationCohort[]>();
  for(const c of s.durations){const id=JSON.stringify([c.sessionId,c.durationScope,c.timingEvidence]);const rows=partitions.get(id);if(rows)rows.push(c);else partitions.set(id,[c]);}
  for(const [,rows] of [...partitions].sort(([a],[b])=>compare(a,b))){
   const first=rows[0]!;
   lines.push(`Session: ${first.sessionId}; scope=${first.durationScope}; evidence=${first.timingEvidence}; cohorts=${rows.length}`);
   for(const c of [...rows].sort((a,b)=>b.p95Ms-a.p95Ms||compare(key(a),key(b))))lines.push(`  category=${c.category}; tool=${c.toolName??"unknown"}; pattern=${c.commandPattern??"unknown"}; n=${c.n}; mean=${value(c.meanMs)} ms; max=${c.maxMs} ms; p50=${c.p50Ms} ms; p95=${c.p95Ms} ms; low-N=${c.lowSampleP95}; limitations=${c.limitations.join(",")||"none"}`);
  }
 }
 lines.push("Limits: recorded eligible call durations only. Different duration scope/timing evidence partitions are not combined; cohort p95 values are not aggregated into a global p95 and do not prove a performance problem.");
 return lines.join("\n")+"\n";
}
