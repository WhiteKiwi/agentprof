import type { SourceSummary } from "../analysis/source-summary.js";

const value=(n:number|null):string=>n===null?"unavailable":String(n);
const counts=(map:Readonly<Record<string,number>>):string=>Object.entries(map).map(([k,n])=>`${k}=${n}`).join("; ");

export function formatSourceTokens(s:SourceSummary):string{
 const lines=["AgentProf observed source-local token attribution",`Source: ${s.sourceId}`,`${s.provider}; revision=${s.revision}; source bytes [0,${s.completedOffset})/${s.observedSize}; suppression=${s.suppressionReason??"none"}`];
 const e=s.usageEligibility;
 if(e===null) lines.push("Usage eligibility: unavailable");
 else lines.push(`Usage eligibility: observed responses=${e.observedResponses}; selected rows=${e.selectedRows}; deduplicated rows=${e.deduplicatedRows}; excluded rows=${e.excludedRows}; excluded response groups=${e.excludedResponseGroups}`,`Exclusions: ${counts(e.exclusions)}`);
 if(!s.usage?.length) lines.push("Token cohorts: unavailable; no eligible final-response usage.");
 else for(const c of s.usage) lines.push(
   `Session: ${c.sessionId}; provider=${c.provider}; mapping=${c.mapping}; finality=${c.finality}; observed responses=${c.observedResponses}`,
   `  input=${value(c.counts.input)}; output=${value(c.counts.output)}; total=${value(c.counts.total)}; cached input=${value(c.counts.cachedInput)}; cache write=${value(c.counts.cacheWriteInput)}; reasoning output=${value(c.counts.reasoningOutput)}; uncached input=${value(c.counts.uncachedInput)}`,
   `  overflow=${c.overflowComponents.join(",")||"none"}; limitations=${c.limitations.join(",")||"none"}`
 );
 lines.push("Semantics: Codex cached input is a subset of input and is not added again. Claude normalized input includes uncached + cache read + cache write. Reasoning output is not added again to output.");
 lines.push("Limits: observed eligible final-response usage only; not account/session total, current context size, per-tool attribution, price, waste or savings. Missing components remain unavailable.");
 return lines.join("\n")+"\n";
}
