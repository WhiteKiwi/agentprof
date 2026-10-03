import type { SourceReportModel } from "./source-model.js";

type Summary = SourceReportModel["summary"];
type Reason = keyof NonNullable<Summary["usageEligibility"]>["exclusions"];
const REASONS: readonly Reason[] = [
  "source_suppressed", "cumulative_snapshot", "unverified_snapshot", "non_response_usage",
  "duplicate_response_conflict", "invalid", "conflicted", "provisional", "snapshot_only",
  "unverified_finality", "missing_response_id", "incomplete_components", "unverified_mapping",
];
const count = (value: number | null | undefined): string => value == null ? "unknown" : String(value);

/** Render only the internally owned summary, after validateReportModel succeeds. */
export function renderTokenEvidence(summary: Summary): string {
  const inventory = summary.inventory.usage, usage = summary.usageEligibility, reason = summary.suppressionReason;
  const unavailable = reason === "source_unavailable" || reason === "evidence_absent" || inventory === null || usage === null;
  const suppressed = !unavailable && (reason === "state_limited" || reason === "ambiguous_origin");
  const state = unavailable ? "Usage evidence unavailable" : suppressed ? "Usage evidence suppressed"
    : inventory === 0 ? "No usage evidence rows stored" : usage!.selectedRows === 0 ? "No eligible observed responses" : "Eligible observed responses";
  const rows = [["Stored usage evidence rows", inventory], ["Selected evidence rows", usage?.selectedRows],
    ["Duplicate evidence rows", usage?.deduplicatedRows], ["Excluded evidence rows", usage?.excludedRows]] as const;
  const table = `<div class="table-wrap" tabindex="0" role="region" aria-labelledby="token-evidence-counts-caption"><table><caption id="token-evidence-counts-caption">Exact source-wide usage evidence row counts</caption><thead><tr><th scope="col">Evidence row disposition</th><th scope="col">Rows</th></tr></thead><tbody>${rows.map(([label, value]) => `<tr><th scope="row">${label}</th><td>${count(value)}</td></tr>`).join("")}</tbody></table></div>`;
  let graphic: string;
  if (inventory === null || usage === null) graphic = '<p class="context">Evidence-row disposition graphic unavailable: row counts are unknown.</p>';
  else if (inventory === 0) graphic = '<p class="context">Empty evidence-row disposition graphic: no usage evidence rows stored.</p>';
  else {
    const selected = 600 * usage.selectedRows / inventory, duplicate = 600 * usage.deduplicatedRows / inventory;
    graphic = `<svg class="token-evidence-bar" viewBox="0 0 600 16" role="img" aria-label="Source-wide evidence-row disposition: ${usage.selectedRows} selected rows, ${usage.deduplicatedRows} duplicate rows, ${usage.excludedRows} excluded rows; ${inventory} stored rows. Not token coverage."><rect class="token-evidence-selected" x="0" y="0" width="${selected}" height="16"></rect><rect class="token-evidence-duplicate" x="${selected}" y="0" width="${duplicate}" height="16"></rect><rect class="token-evidence-excluded" x="${selected + duplicate}" y="0" width="${600 * usage.excludedRows / inventory}" height="16"></rect></svg>`;
  }
  return `<section class="panel" id="token-evidence"><h3>Token evidence</h3><p class="state">${state}${reason === null ? "" : `: ${reason}`}</p><dl><div><dt>Eligible observed responses</dt><dd class="metric">${usage === null ? "unavailable" : usage.observedResponses}</dd></div></dl>${unavailable || suppressed ? '<p class="notice">Evidence is unavailable or suppressed. A recorded zero eligible count does not establish that no model responses occurred.</p>' : ""}${table}${graphic}<p class="context">Selected, duplicate and excluded evidence rows are source-wide dispositions, not token-population coverage or counts of uniquely lost responses. Exact table counts are authoritative. Tiny or zero segments are not enlarged.</p><h4>Source-wide exclusion reasons · evidence rows</h4><dl class="pair">${REASONS.map(r => `<div><dt>${r}</dt><dd>${count(usage?.exclusions[r])}</dd></div>`).join("")}</dl><dl><div><dt>Conflicting response groups</dt><dd>${count(usage?.excludedResponseGroups)} groups</dd></div></dl><p class="context">Conflicting groups are a separate diagnostic, not a fourth row segment. Identical ineligible rows can contribute duplicate evidence rows. These reasons are source-wide; no per-session exclusions are inferred.</p><p class="context">Counts cover the stored source prefix before session/cohort display caps. Cross-source reconciliation and complete-session coverage are unavailable. Recorded token components remain in compatible per-session provider/mapping/finality tables; cache and reasoning values are subsets. No source-wide token total, cost, savings, token rate, API latency or LLM wait is inferred.</p></section>`;
}
