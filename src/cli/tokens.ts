import type { SourceSummary, UsageCohort } from "../analysis/source-summary.js";

const value = (n: number | null): string => n === null ? "unknown" : String(n);
const counts = (map: Readonly<Record<string, number>> | null): string => map === null ? "unknown"
  : Object.entries(map).map(([key, n]) => `${key}=${n}`).join("; ");
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const identity = (c: UsageCohort): string => JSON.stringify([c.sessionId, c.provider, c.mapping, c.finality]);

// Describe the unchanged summary's evidence, never a usage-population estimate.
function assessment(s: SourceSummary): string {
  if (s.suppressionReason !== null) return `unavailable (${s.suppressionReason})`;
  if (s.inventory.usage === 0) return "present_empty";
  if (s.usageEligibility!.observedResponses === 0) return "no_eligible_responses";
  return "eligible_observed_subset";
}

export function formatSourceTokens(s: SourceSummary): string {
  const inventory = s.inventory, capabilities = s.capabilities, e = s.usageEligibility;
  const lines = [
    "AgentProf observed source-local token attribution",
    `Source: ${s.sourceId}`,
    `Provider: ${s.provider}; revision=${s.revision}; source bytes [0,${s.completedOffset})/${s.observedSize}`,
    `Scope: ${s.scope}; availability=${s.availability}; evidence=${s.persistedScope}; suppression=${s.suppressionReason ?? "none"}`,
    "sourceFreshnessChecked=false; crossSourceReconciled=false; aggregationReady=false; parserResumeReady=false",
    `Token evidence: ${assessment(s)}`,
    `Coverage: ${capabilities?.coverage ?? "unknown"}; support=${capabilities?.support ?? "unknown"}; parser version=${capabilities?.parserVersion ?? "unknown"}`,
    `Inventory: events=${inventory.events}; turns=${value(inventory.turns)}; stored usage rows=${value(inventory.usage)}; observations=${value(inventory.observations)}; diagnostics=${value(inventory.diagnostics)}`,
    `Usage selection inventory: ${counts(inventory.usageSelections)}`,
    `Usage finality inventory: ${counts(inventory.usageFinalities)}`,
  ];
  if (capabilities === null) lines.push("Capabilities: unknown");
  else lines.push(
    `Capabilities: unsupported records=${capabilities.unsupportedRecords}; ambiguous records=${capabilities.ambiguousRecords}; state limited=${capabilities.stateLimited}; dropped diagnostics=${capabilities.diagnosticsDropped}`,
    `Observed shapes: ${capabilities.observedShapes.join(", ") || "none"}`,
  );
  lines.push(`Source limitations: ${s.limitations.join(", ") || "none"}`);
  if (e === null) lines.push("Usage eligibility: unknown", "Exclusions: unknown");
  else lines.push(
    `Usage eligibility: observed responses=${e.observedResponses}; selected rows=${e.selectedRows}; deduplicated rows=${e.deduplicatedRows}; excluded rows=${e.excludedRows}; excluded response groups=${e.excludedResponseGroups}`,
    `Exclusions: ${counts(e.exclusions)}`,
  );
  // Source-wide counters and reasons precede presentation-only detail clipping.
  if (s.suppressionReason !== null) lines.push("Token cohort detail: unknown (source suppressed)");
  else {
    const cohorts = [...s.usage ?? []].sort((a, b) => compare(identity(a), identity(b))), shown = cohorts.slice(0, 6);
    lines.push(`Token cohort detail: shown=${shown.length}; total=${cohorts.length}; omitted=${cohorts.length - shown.length}; identity order, no ranking`);
    if (!shown.length) lines.push("Token totals: unknown; no eligible final-response observations.");
    for (const c of shown) lines.push(
      `Session: ${c.sessionId}; provider=${c.provider}; mapping=${c.mapping}; finality=${c.finality}; observed responses=${c.observedResponses}`,
      `  input=${value(c.counts.input)}; output=${value(c.counts.output)}; total=${value(c.counts.total)}; cached input=${value(c.counts.cachedInput)}; cache write=${value(c.counts.cacheWriteInput)}; reasoning output=${value(c.counts.reasoningOutput)}; uncached input=${value(c.counts.uncachedInput)}`,
      `  overflow=${c.overflowComponents.join(", ") || "none"}; limitations=${c.limitations.join(", ") || "none"}`,
    );
  }
  lines.push(
    "Semantics: Codex cached input is a subset of input and is not added again. Claude normalized input includes uncached + cache read + cache write. Reasoning output is not added again to output.",
    "Limits: observed eligible final-response usage only; not account/session total, current context size, per-tool attribution, price, waste or savings. Unknown components remain unknown; selected zero does not establish no model responses occurred.",
    "All cohorts, components and contributing usage IDs are available with --json.",
  );
  return lines.join("\n") + "\n";
}
