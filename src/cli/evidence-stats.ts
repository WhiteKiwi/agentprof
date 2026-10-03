import type { StoredSource } from "../db/source-store.js";
import { SafeError } from "../privacy/diagnostics.js";
import { buildSourceEvidenceView, orderedEvidenceRows } from "../analysis/source-evidence-views.js";
import type { EvidenceViewInput, EvidenceViewName, SourceEvidenceView } from "../analysis/source-evidence-views.js";

export const EVIDENCE_STATS_OPTIONS = [
  ["recoveryDistribution", "recovery-distribution", "resolved-only recovery quantiles"],
  ["retryResolution", "retry-resolution", "observed same-operation recovery-chain resolution"],
  ["failureAdmission", "failure-admission", "native terminal admission coverage"],
  ["failureTiming", "failure-timing", "confirmed failure timing coverage"],
  ["readIdentity", "read-identity", "admitted Read file-identity coverage"],
  ["searchIdentity", "search-identity", "admitted native search-identity coverage"],
  ["boundaryCoverage", "boundary-coverage", "native invocation boundary coverage"],
  ["slowCandidates", "slow-candidates", "native Slow Tool candidates and quality guardrails"],
  ["slowCoverage", "slow-coverage", "native Slow Tool partition admission coverage"],
  ["tokenCompleteness", "token-completeness", "provider-aware token-component presence"],
] as const satisfies readonly (readonly [string, EvidenceViewName, string])[];
export type EvidenceStatsKey = typeof EVIDENCE_STATS_OPTIONS[number][0];
export type EvidenceStatsOptions = Readonly<Partial<Record<EvidenceStatsKey, boolean>>>;
type NativeSelections = Readonly<{
  source?: string; listSources?: boolean; failures?: boolean; readRevisits?: boolean;
  invocationOverlap?: boolean; searchRecurrence?: boolean; recovery?: boolean;
}>;
export type EvidenceStatsResult = Readonly<{
  view: SourceEvidenceView;
  /** The original selected native result keeps its full structured proof inventory. */
  analysis: EvidenceViewInput["analysis"];
}>;

/** Runs before dynamic imports or any store/path access. False is equivalent to omission. */
export function validateEvidenceStatsOptions(options: EvidenceStatsOptions & NativeSelections): EvidenceViewName | null {
  let selected: EvidenceViewName | null = null;
  for (const [key, view] of EVIDENCE_STATS_OPTIONS) {
    const value = options[key];
    if (value !== undefined && typeof value !== "boolean") throw new SafeError("INVALID_ARGUMENT");
    if (value !== true) continue;
    if (selected !== null) throw new SafeError("INVALID_ARGUMENT");
    selected = view;
  }
  if (selected !== null && (options.source === undefined || options.listSources || options.failures || options.readRevisits
    || options.invocationOverlap || options.searchRecurrence || options.recovery)) throw new SafeError("INVALID_ARGUMENT");
  return selected;
}
function result(input: EvidenceViewInput): EvidenceStatsResult {
  return Object.freeze({ view: buildSourceEvidenceView(input), analysis: input.analysis });
}

/** Complete imports before entering the synchronous pinned read. The returned closure runs one analyzer once. */
export async function loadEvidenceStats(view: EvidenceViewName): Promise<(source: StoredSource) => EvidenceStatsResult> {
  switch (view) {
    case "recovery-distribution": case "retry-resolution": {
      const { analyzeSourceRecovery } = await import("../analysis/source-recovery.js");
      return source => result({ view, analysis: analyzeSourceRecovery(source) });
    }
    case "failure-admission": case "failure-timing": {
      const { analyzeSourceFailures } = await import("../analysis/source-failures.js");
      return source => result({ view, analysis: analyzeSourceFailures(source) });
    }
    case "read-identity": {
      const { analyzeSourceReadRevisits } = await import("../analysis/source-read-revisits.js");
      return source => result({ view, analysis: analyzeSourceReadRevisits(source) });
    }
    case "search-identity": {
      const { analyzeSourceSearchRecurrence } = await import("../analysis/source-search-recurrence.js");
      return source => result({ view, analysis: analyzeSourceSearchRecurrence(source) });
    }
    case "boundary-coverage": {
      const { analyzeSourceInvocationOverlap } = await import("../analysis/source-invocation-overlap.js");
      return source => result({ view, analysis: analyzeSourceInvocationOverlap(source) });
    }
    case "slow-candidates": case "slow-coverage": {
      const { analyzeSourceSlowTool } = await import("../analysis/source-slow-tool.js");
      return source => result({ view, analysis: analyzeSourceSlowTool(source) });
    }
    case "token-completeness": {
      const { summarizeSource } = await import("../analysis/source-summary.js");
      return source => result({ view, analysis: summarizeSource(source) });
    }
  }
}

function text(value: string | number | boolean | null): string {
  if (value === null) return "unavailable";
  const safe = String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
  return safe.length <= 400 ? safe : `${safe.slice(0, 400)} [characters omitted=${safe.length - 400}; see --json]`;
}
/** Presentation limits do not discard the structured analysis or projection in JSON. */
export function formatEvidenceStatsResult(r: EvidenceStatsResult): string {
  const a = r.view, all = orderedEvidenceRows(a), shown = all.slice(0, 8);
  const lines = [`AgentProf source-local ${a.view}`, `Source: ${a.sourceId}`,
    `${a.provider}; revision=${a.revision}; parser=${a.parserVersion ?? "unknown"}; source bytes [0,${a.completedOffset})/${a.observedSize}`,
    `Availability=${a.availability}; persisted scope=${a.persistedScope}; assessment=${a.assessment}; suppression=${a.suppressionReason ?? "none"}`];
  for (const [key, value] of Object.entries(a.summary)) lines.push(`${key}: ${text(value)}`);
  lines.push(a.rows === null ? "Rows: unavailable; shown=0; total/omitted unknown"
    : `Rows: shown=${shown.length}/${all.length}; omitted=${all.length - shown.length}; deterministic order, not ranking`);
  if (a.rows !== null && a.rows.length === 0) lines.push("No rows in the eligible stored subset; this does not establish absence in full history.");
  for (const p of shown) {
    lines.push(`${p.id}: session=${p.sessionId ?? "unavailable"}; state=${p.state}`);
    for (const [key, value] of Object.entries(p.values)) lines.push(`  ${key}: ${text(value)}`);
    for (const [key, value] of Object.entries(p.fractions)) lines.push(`  ${key}: ${text(value.numerator)}/${text(value.denominator)}; fraction=${text(value.value)} (1=100%)`);
    lines.push(`  Reasons: ${p.reasons.map(text).join("; ") || "none"}`);
  }
  lines.push(...a.limitations.map(value => `Limit: ${value}`),
    "Complete structured native analysis and evidence IDs: --json. No global totals, inferred root cause, waste or savings.");
  return lines.join("\n") + "\n";
}
