import type { SourceActiveTimeAnalysis } from "../analysis/source-active-time.js";
import { SafeError } from "../privacy/diagnostics.js";
import { evidenceAlias, evidenceTable, htmlText as text, numericText as number, omissions } from "./evidence-page.js";

export const ACTIVE_TIME_REPORT_LIMITS = Object.freeze({ partitions: 12 });

/** Count-only presentation of the complete owned native result, without new timing admission.
 * Validate every session reference and count the full population before limiting displayed rows. */
export function renderActiveTimeSection(a: SourceActiveTimeAnalysis, sessionAliases: ReadonlyMap<string, string>): string {
  if (a.schema !== "agentprof.source-active-time/v1" || a.metric !== "active_time"
    || a.version !== "codex-positioned-turn-v1" || (a.partitions?.length ?? 0) > 4096) throw new SafeError("INVALID_RECORD");
  const session = (id: string) => evidenceAlias(sessionAliases, id);
  const allProofs = new Set<string>(), proofCounts = new Map<string, number>();
  let unionOverflow = 0, spanOverflow = 0;
  for (const p of a.partitions ?? []) {
    session(p.sessionId);
    const proofs = new Set<string>();
    for (const turn of p.turnEvidence) for (const id of turn.evidenceObservationIds) { proofs.add(id); allProofs.add(id); }
    proofCounts.set(p.id, proofs.size);
    if (p.activeTimeReason === "numeric_overflow") unionOverflow++;
    if (p.observedSpanReason === "numeric_overflow") spanOverflow++;
  }
  const c = a.capabilities;
  const body = [`<section id="unified-active-time"><h2>Observed turn Active Time</h2>`,
    `<p>Assessment=${text(a.assessment)}; assessment reason=${text(a.activeTimeAssessmentReason ?? "none")}; suppression=${text(a.suppressionReason ?? "none")}.</p>`,
    `<p>Native turn interval union excludes gaps; observed span includes gaps. Completed and cancelled observed turns can include waiting. Sessions and interval contracts stay separate. Neither measurement is CPU time, task elapsed time, productivity, waste or savings. Recorded turn duration does not supply interval endpoints.</p>`,
    evidenceTable("unified-active-time-context", "Native Active Time source and capability context", ["Context", "Value"], [
      ["Provider / parser", `${a.provider} / ${number(a.parserVersion)}`],
      ["Normalization / key version", `${number(a.normalizationVersion)} / ${number(a.keyVersion)}`],
      ["Metric / version / scope", `${a.metric} / ${a.version} / ${a.scope}`],
      ["Availability / persisted scope", `${a.availability} / ${a.persistedScope}`],
      ["Observation window", `${a.observationWindow.unit}: [${number(a.observationWindow.startInclusive)}, ${number(a.observationWindow.endExclusive)})`],
      ["Query period", a.queryPeriod],
      ["Source freshness checked", String(a.sourceFreshnessChecked)],
      ["Cross-source reconciled", String(a.crossSourceReconciled)],
      ["Aggregation ready", String(a.aggregationReady)], ["Parser resume ready", String(a.parserResumeReady)],
      ["Capability provider / parser", c === null ? null : `${c.provider} / ${number(c.parserVersion)}`],
      ["Capability support / coverage", c === null ? null : `${c.support} / ${c.coverage}`],
      ["Observed shapes", c === null ? null : c.observedShapes.join(", ") || "none"],
      ["Unsupported records", number(c?.unsupportedRecords ?? null)], ["Ambiguous records", number(c?.ambiguousRecords ?? null)],
      ["State limited", c === null ? null : String(c.stateLimited)], ["Dropped diagnostics", number(c?.diagnosticsDropped ?? null)],
    ]),
    evidenceTable("unified-active-time-population", "Full native Active Time population — before display limits", ["Population", "Count"], [
      ["Admitted turns", number(a.summary.eligibleTurns)], ["Excluded turns", number(a.summary.excludedTurns)],
      ["Compatible partitions", number(a.summary.partitions)],
      ["Distinct corroborating observations", number(a.partitions === null ? null : allProofs.size)],
    ]),
    evidenceTable("unified-active-time-arithmetic", "Full-population arithmetic qualifications — partition counts can overlap", ["Qualification", "Partitions"], [
      ["Active Time union numeric_overflow", number(a.partitions === null ? null : unionOverflow)],
      ["Observed span numeric_overflow", number(a.partitions === null ? null : spanOverflow)],
    ]),
  ];
  if (a.exclusions === null) body.push(`<p>Native turn exclusions unavailable; no zero exclusion counts are inferred.</p>`);
  else body.push(evidenceTable("unified-active-time-exclusions", "Native primary exclusion reasons — one reason per excluded turn", ["Reason", "Turns"],
    Object.entries(a.exclusions).map(([reason, count]) => [reason, number(count)])));
  if (a.partitions === null) body.push(`<p class="notice">Active Time partitions unavailable; not zero observed time. See native assessment and reasons above.</p>`);
  else {
    const shown = a.partitions.slice(0, ACTIVE_TIME_REPORT_LIMITS.partitions);
    body.push(omissions("Active Time partitions", shown.length, a.partitions.length),
      evidenceTable("unified-active-time-partitions", "Native turn intervals — independent compatible partitions, milliseconds", ["Session", "Interval scope / evidence", "Admitted turns", "Distinct corroborating observations", "Active Time union ms", "Union reason", "Observed span ms", "Span reason"],
        shown.map(p => [session(p.sessionId), `${p.intervalScope} / ${p.intervalTimingEvidence}`, number(p.turnN), number(proofCounts.get(p.id)!),
          number(p.activeTimeMs), p.activeTimeReason ?? "none", number(p.observedSpanMs), p.observedSpanReason ?? "none"])));
    if (a.partitions.length === 0) body.push(`<p>No supported turn intervals were admitted. An empty partition list is not a measured Active Time zero.</p>`);
  }
  body.push(...a.limitations.map(value => `<p class="notice">${text(value)}</p>`),
    `<p>Complete admitted turn endpoints, terminal statuses, proof identities and excluded-turn membership: <code>agentprof stats --source FULL_SOURCE_ID --active-time --json</code>. This count-only summary does not embed individual turn or proof identities; partition display limits do not truncate the native evidence.</p></section>`);
  return body.join("");
}
