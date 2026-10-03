import type { SourceActiveTimeAnalysis } from "../analysis/source-active-time.js";
const value=(n:number|null)=>n===null?"unavailable":String(n);
export function formatSourceActiveTime(a:SourceActiveTimeAnalysis):string{
 const lines=["AgentProf observed source-local Active Time",`Source: ${a.sourceId}`,`${a.provider}; revision=${a.revision}; source bytes [0,${a.completedOffset})/${a.observedSize}`,`Assessment=${a.assessment}; eligible turns=${a.summary.eligibleTurns}; excluded=${a.summary.excludedTurns}; partitions=${a.summary.partitions}`,`Exclusions: ${Object.entries(a.exclusions).map(([k,n])=>`${k}=${n}`).join("; ")}`,"Active Time is the union of positioned turn intervals. Observed span includes gaps; Active Time does not."];
 for(const p of a.partitions??[])lines.push(`${p.id}: session=${p.sessionId}; ${p.intervalScope}/${p.intervalTimingEvidence}; turns=${p.turnN}; active=${value(p.activeTimeMs)} ms; span=${value(p.observedSpanMs)} ms`);
 lines.push("Limits: source-prefix observed turn time only; not CPU time, task elapsed, wall-clock productivity, waste or savings. Different scope/evidence partitions are not combined.");
 return lines.join("\n")+"\n";
}
