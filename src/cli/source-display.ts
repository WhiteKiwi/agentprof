import type { SourceSummary, UsageCohort } from "../analysis/source-summary.js";
import { sourceSummaryContext } from "./source-summary-context.js";

export const detailLimit = 6;
export const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
export const value = (n: number | null): string => n === null ? "unavailable" : String(n);
export const counts = (map: Readonly<Record<string, number>> | null): string => map === null ? "unavailable" : Object.entries(map).map(([key, n]) => `${key}=${n}`).join("; ");
export const ratio = (n: number | null, d: number | null): string => n === null || d === null || d <= 0 ? "unavailable" : String(n / d);
export const finish = (lines: readonly string[]): string => lines.join("\n") + "\n";
export const omission = (label: string, shown: number, total: number): string => `${label}: showing ${shown} of ${total}; omitted=${total - shown}`;
export function bounded<T>(rows: readonly T[], identity: (row: T) => string): T[] {
  return [...rows].sort((a, b) => compare(identity(a), identity(b))).slice(0, detailLimit);
}
export function context(title: string, s: SourceSummary): string[] { return [title, ...sourceSummaryContext(s), `Stored event inventory state: ${s.inventory.events === 0 ? "present_empty" : "observed_prefix"}`, `Stored usage inventory state: ${usageState(s)}`]; }
export function durationState(s: SourceSummary): string {
  return s.suppressionReason !== null ? `suppressed (${s.suppressionReason})` : s.inventory.events === 0 ? "present_empty" : s.durations === null ? "no_eligible_observations" : "eligible_observed_subset";
}
export function usageState(s: SourceSummary): string {
  return s.suppressionReason !== null ? `suppressed (${s.suppressionReason})` : s.inventory.usage === null ? "evidence_absent" : s.inventory.usage === 0 ? "present_empty" : s.usage === null ? "no_eligible_observations" : "eligible_observed_subset";
}
export function durationContext(s: SourceSummary): string[] {
  const e = s.durationEligibility;
  return [`Duration state: ${durationState(s)}; terminal candidates=${e.terminalCandidates}; included=${e.included}`, `Duration exclusions: ${counts(e.exclusions)}`];
}
export function usageContext(s: SourceSummary): string[] {
  const e = s.usageEligibility;
  return [`Usage state: ${usageState(s)}`, e === null ? "Usage eligibility: unavailable" : `Usage eligibility: observed responses=${e.observedResponses}; selected rows=${e.selectedRows}; deduplicated rows=${e.deduplicatedRows}; excluded rows=${e.excludedRows}; conflicted response groups=${e.excludedResponseGroups}`, `Usage exclusions: ${counts(e?.exclusions ?? null)}`];
}
export function usageDetails(s: SourceSummary, render: (c: UsageCohort) => string): string[] {
  const all = s.usage ?? [], rows = bounded(all, c => JSON.stringify([c.sessionId, c.provider, c.mapping, c.finality]));
  return [...usageContext(s), omission("Usage cohorts", rows.length, all.length), ...rows.map(c => `session=${c.sessionId}; provider=${c.provider}; mapping=${c.mapping}; finality=${c.finality}; responses=${c.observedResponses}; ${render(c)}; overflow=${c.overflowComponents.join(",") || "none"}; limitations=${c.limitations.join(",") || "none"}`)];
}
export function mix(label: string, map: Readonly<Record<string, number>> | null): string[] {
  if (map === null) return [`${label}: unavailable`];
  const total = Object.values(map).reduce((a, b) => a + b, 0);
  return [`${label}: population=${total}`, ...Object.entries(map).map(([key, n]) => `${key}: n=${n}; share=${ratio(n, total)}`)];
}
