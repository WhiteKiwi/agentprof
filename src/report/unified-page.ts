import { SafeError } from "../privacy/diagnostics.js";
import { UNIFIED_LIMITS as L } from "./unified-model.js";
import type { UnifiedSourceReport } from "./unified-model.js";
import { renderActiveTimeSection } from "./active-time-section.js";
import { renderExplorationSection } from "./exploration-section.js";
import { renderPatternSections } from "./pattern-page.js";
import { evidenceAlias, evidenceAliases, evidenceBar, evidenceLink, evidencePage, evidenceTable, htmlText, numericText, omissions } from "./evidence-page.js";

const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const ordered = <T extends { id: string }>(rows: readonly T[]): T[] => [...rows].sort((a, b) => compare(a.id, b.id));
const number = numericText;
const text = htmlText;
const pair = (a: number | null, b: number | null) => `${number(a)} / ${number(b)}`;
function reasons(values: readonly string[]): string {
  return values.length ? `<p class="notice">${values.map(text).join(" · ")}</p>` : "";
}
function safeguards(counterexample: string, investigation: string, experiment: string, quality: string): string {
  return `<dl><dt>Necessary-work counterexample</dt><dd>${text(counterexample)}</dd><dt>Investigate</dt><dd>${text(investigation)}</dd><dt>Matched experiment — suggested, not executed</dt><dd>${text(experiment)}</dd><dt>Quality guardrail</dt><dd>${text(quality)}</dd></dl>`;
}
function countTable(id: string, caption: string, values: Readonly<Record<string, number | null>>): string {
  return evidenceTable(id, caption, ["Population / reason", "Count"], Object.entries(values).sort(([a], [b]) => compare(a, b)).map(([key, n]) => [key, number(n)]));
}

/** Owned internal model only. Every dynamic cell is escaped and no persistent identity is serialized. */
export function renderUnifiedSourceReport(m: UnifiedSourceReport): string {
  if (m.schema !== "agentprof.unified-source-report/v1" || m.eventIds.length > 4096 || m.sessionIds.length > 12288
    || m.timeline.length > L.timeline) throw new SafeError("INVALID_ARGUMENT");
  for (const field of ["parserVersion", "normalizationVersion", "keyVersion"] as const) {
    if (m.activeTime[field] !== m[field]) throw new SafeError("INVALID_RECORD");
  }
  if (m.exploration.parserVersion !== m.parserVersion) throw new SafeError("INVALID_RECORD");
  for (const part of [m.summary, m.slow, m.commands, m.failures, m.recovery, m.retry, m.reads, m.searches, m.patterns, m.exploration, m.activeTime]) {
    if (part.sourceId !== m.sourceId || part.provider !== m.provider || part.revision !== m.revision
      || part.completedOffset !== m.completedOffset || part.observedSize !== m.observedSize) throw new SafeError("INVALID_RECORD");
  }
  const sessionAliases = evidenceAliases(m.sessionIds, "session"), eventAliases = evidenceAliases(m.eventIds, "event");
  const session = (id: string) => evidenceAlias(sessionAliases, id);
  const sections = [["unified-summary", "Overview"], ["unified-active-time", "Active Time"], ["unified-commands", "Time and commands"], ["unified-tokens", "Tokens"],
    ["unified-failures", "Failures"], ["unified-retry", "Retry and recovery"], ["unified-reads", "Read and search"],
    ["unified-slow", "Slow Tool"], ["unified-exploration", "Exploration"], ["unified-timeline", "Intervals"], ["rules", "Patterns and validation"]] as const;
  const body = [`<nav aria-label="Unified report sections">${sections.map(([id, label]) => evidenceLink(id, label)).join(" ")}</nav>`,
    `<section class="panel" id="unified-summary"><h2>One stored source generation</h2><dl><dt>Source</dt><dd>source-1 · ${text(m.provider)}</dd><dt>Revision / parser</dt><dd>${m.revision} / ${m.parserVersion}</dd><dt>Stored byte prefix / observed size</dt><dd>[0, ${m.completedOffset}) / ${m.observedSize}</dd><dt>Availability</dt><dd>${text(m.summary.availability)}</dd></dl><p>All sections were computed from the same pinned stored generation. Source freshness and cross-source reconciliation are not checked. Scope is the stored prefix, not complete account history.</p>`,
    `<div class="timeline-metrics"><article><p class="metric">${m.summary.inventory.events}</p><p>Stored events</p></article><article><p class="metric">${m.failures.eligibility.admittedTerminalCalls}</p><p>Admitted native terminal calls</p></article><article><p class="metric">${number(m.summary.usageEligibility?.observedResponses ?? null)}</p><p>Eligible final response-usage observations</p></article></div>`,
    countTable("unified-inventory", "Stored inventory — not eligible statistical populations", { events: m.summary.inventory.events, turns: m.summary.inventory.turns, usage: m.summary.inventory.usage, observations: m.summary.inventory.observations, diagnostics: m.summary.inventory.diagnostics }),
    evidenceTable("unified-assessments", "Separate domain assessments; unavailable is not zero", ["Domain", "Assessment", "Suppression / reason"], [
      ["Summary", m.summary.suppressionReason === null ? "observed_eligible_subset" : "suppressed", m.summary.suppressionReason ?? "none"],
      ["Active Time", m.activeTime.assessment, `assessment reason: ${m.activeTime.activeTimeAssessmentReason ?? "none"}; suppression: ${m.activeTime.suppressionReason ?? "none"}`],
      ...([["Native failure", m.failures], ["Slow Tool", m.slow], ["Recovery", m.recovery], ["Retry overhead", m.retry], ["Read revisits", m.reads], ["Search recurrence", m.searches], ["Patterns", m.patterns], ["Exploration", m.exploration]] as const).map(([label, a]) => [label, a.assessment, a.suppressionReason ?? "none"]),
    ]), `</section>`, renderActiveTimeSection(m.activeTime, sessionAliases), `<section id="unified-commands"><h2>Time and command measurements</h2><p>Recorded durations and positioned interval unions have different scopes. Neither implies model/network latency, critical path, avoidable time or a global elapsed-time total. Command shares use the full native partition denominator before any display cap.</p>`,
    countTable("unified-duration-coverage", "Recorded-duration admission and exclusions", { included: m.summary.durationEligibility.included, terminalCandidates: m.summary.durationEligibility.terminalCandidates, ...m.summary.durationEligibility.exclusions })];
  const durations = m.summary.durations ?? [], shownDurations = durations.slice(0, L.rows);
  body.push(omissions("Duration cohorts", shownDurations.length, durations.length),
    evidenceTable("unified-durations", "Source-summary compatible recorded durations in ms", ["Session", "Category / safe pattern", "Scope / evidence", "N", "Sum", "Mean", "Maximum", "p50", "p95", "Qualification"], shownDurations.map(p => [session(p.sessionId), `${p.category} / ${p.commandPattern ?? p.toolName ?? "unavailable"}`, `${p.durationScope} / ${p.timingEvidence}`, p.n, number(p.sumMs), number(p.meanMs), p.maxMs, p.p50Ms, p.p95Ms, `${p.lowSampleP95 ? "low-sample p95" : "p95 sample threshold met"}; ${p.limitations.join(",") || "none"}`])));
  if (m.summary.durations === null) body.push(`<p>No eligible duration cohorts. See source suppression and exclusion counts; this is not a measured zero.</p>`);
  const commands = ordered(m.commands.partitions).slice(0, L.partitions);
  body.push(`<p>Native command detail: ${text(m.commands.state)}.</p>`, omissions("Native command partitions", commands.length, m.commands.partitions.length));
  commands.forEach((p, i) => {
    const groups = p.groups?.slice(0, L.rows) ?? [], calls = p.calls?.slice(0, L.rows) ?? [];
    body.push(`<article class="panel"><h3>${text(session(p.sessionId))} · ${text(p.durationScope)} / ${text(p.timingEvidence)}</h3><p>Status=${text(p.status)}; full eligible N=${p.denominatorN}; full denominator=${number(p.denominatorSumMs)} ms.</p>`,
      omissions("Native command groups", groups.length, p.groups?.length ?? 0),
      evidenceTable(`unified-command-${i}`, "Native groups — independent shares of the same full partition", ["Group", "Category / safe pattern", "N", "Sum ms", "Share (0–1)"], groups.map(g => [g.ordinal, `${g.group.category} / ${g.group.commandPattern ?? g.group.toolName ?? "unavailable"}`, g.n, g.sumMs, number(g.share)])),
      omissions("Longest native calls", calls.length, p.calls?.length ?? 0),
      evidenceTable(`unified-calls-${i}`, "Longest native calls within this duration partition", ["Call ordinal", "Group ordinal", "Status", "Duration ms"], calls.map(c => [c.ordinal, c.groupOrdinal, c.status, c.durationMs])),
      p.groups === null ? `<p>Native details unavailable for this partition, not zero groups.</p>` : "", `</article>`);
  });
  body.push(`</section><section id="unified-tokens"><h2>Eligible token observations</h2><p>Only the original summary's eligible, response-deduplicated final usage is shown. Provisional usage and cumulative snapshots are excluded. Dates cannot be assigned without usage timestamp evidence: daily tokens are unavailable here. No cost or tool-level token attribution is inferred.</p>`);
  const usageEligibility = m.summary.usageEligibility;
  if (usageEligibility !== null) body.push(countTable("unified-usage-coverage", "Response-usage selection and exclusion populations", { observedResponses: usageEligibility.observedResponses, selectedRows: usageEligibility.selectedRows, deduplicatedRows: usageEligibility.deduplicatedRows, excludedRows: usageEligibility.excludedRows, excludedResponseGroups: usageEligibility.excludedResponseGroups }), countTable("unified-usage-exclusions", "Usage exclusion reasons", usageEligibility.exclusions));
  else body.push(`<p>Usage evidence absent.</p>`);
  const usage = m.summary.usage ?? [], shownUsage = usage.slice(0, L.rows);
  body.push(omissions("Eligible usage cohorts", shownUsage.length, usage.length));
  shownUsage.forEach((p, i) => body.push(`<article class="panel"><h3>${text(session(p.sessionId))} · ${text(p.provider)}</h3><p>Mapping=${text(p.mapping)}; finality=${text(p.finality)}; observed eligible responses=${p.observedResponses}.</p><p>${p.provider === "codex" ? "Cached input is a subset of input; reasoning output is a subset of output. Do not add those subsets again." : "Input includes uncached input, cache-read input and cache-write input under the stored Anthropic mapping. Reasoning output is not a separately measured component."}</p>`,
    countTable(`unified-usage-${i}`, "Token counts — null stays unavailable and provider components remain distinct", p.counts), reasons([...p.limitations, ...p.overflowComponents.map(x => `overflow: ${x}`)]), `</article>`));
  if (m.summary.usage === null) body.push(`<p>No eligible final response-usage cohort. This is not zero token use.</p>`);
  body.push(`</section><section id="unified-failures"><h2>Native failure evidence</h2><p>Classification and confirmed failure counts are separate from timing coverage or retry identity.</p>`,
    countTable("unified-failure-admission", "Native terminal admission and exclusions", { tentativeTerminalCalls: m.failures.eligibility.tentativeTerminalCalls, admittedTerminalCalls: m.failures.eligibility.admittedTerminalCalls, unresolvedProvenance: m.failures.provenance.unresolvedEvents, ...m.failures.eligibility.exclusions }));
  const failurePartitions = ordered(m.failures.partitions).slice(0, L.partitions);
  body.push(omissions("Failure partitions", failurePartitions.length, m.failures.partitions.length),
    evidenceTable("unified-failure-partitions", "Confirmed native terminal populations", ["Session", "State", "Terminal N", "Completed N", "Failed N"], failurePartitions.map(p => [session(p.sessionId), p.status, number(p.terminalN), number(p.completedN), number(p.failedN)])));
  const failureCohorts = ordered(m.failures.cohorts ?? []).slice(0, L.rows);
  body.push(omissions("Failure cohorts", failureCohorts.length, m.failures.cohorts?.length ?? 0), evidenceTable("unified-failure-cohorts", "Coarse failure groups — not identical errors or proven retry chains", ["Session", "Safe group", "Failed N", "Missing operation identity", "Missing error identity"], failureCohorts.map(p => [session(p.sessionId), `${p.group.category} / ${p.group.commandPattern ?? p.group.toolName ?? "unavailable"}`, p.failedN, p.missingOperationIdentityN, p.missingErrorIdentityN])),
    safeguards(m.failures.guidance.necessaryFailureCounterexample, m.failures.guidance.investigativeAction, m.failures.guidance.matchedExperiment, m.failures.guidance.qualityGuardrail), reasons(m.failures.limitations));
  const retry = m.retry, recovery = m.recovery;
  body.push(`</section><section id="unified-retry"><h2>Retry contribution and observed recovery</h2><p>Only admitted same-turn, same-operation recovery chains contribute. Successful-attempt duration and gaps between attempts do not count as retry overhead. Observed failure-to-success elapsed time is different from failed-attempt duration or occupied interval union.</p>`,
    evidenceTable("unified-retry-summary", "Admitted recovery-chain populations and distinct measurements", ["Measurement", "Value"], [
      ["Chains / resolved / unresolved", `${number(retry.summary.chainN)} / ${number(retry.summary.resolvedChainN)} / ${number(retry.summary.unresolvedChainN)}`],
      ["Measured failed attempts / all failed attempts", pair(retry.summary.measuredFailedAttemptN, retry.summary.failedAttemptN)],
      ["Failed-attempt recorded-duration sum ms", number(retry.summary.failedAttemptDurationSumMs)], ["Duration-sum reason", retry.summary.failedAttemptDurationSumReason ?? "none"],
      ["Compatible failed-attempt interval union ms", number(retry.summary.retryOverheadMs)], ["Interval-union reason", retry.summary.retryOverheadReason ?? "none"],
    ]));
  if (retry.durationCoverage !== null) body.push(countTable("unified-retry-duration-coverage", "Admitted failed-attempt duration coverage and exact exclusion counts", {
    selectedN: retry.durationCoverage.selectedN, measuredN: retry.durationCoverage.measuredN, unavailableN: retry.durationCoverage.unavailableN, ...retry.durationCoverage.exclusions }));
  const recoveryPartitions = ordered(recovery.partitions).slice(0, L.partitions);
  body.push(omissions("Recovery partitions", recoveryPartitions.length, recovery.partitions.length), evidenceTable("unified-recovery-partitions", "Recovery partition eligibility and blocked evidence", ["Session", "State", "Candidates", "Missing operation", "Missing turn", "Unresolved provenance", "Reasons"], recoveryPartitions.map(p => [session(p.sessionId), p.status, p.candidateAttemptN, p.missingOperationEventIds.length, p.missingTurnEventIds.length, p.unresolvedProvenanceEventIds.length, p.reasons.join(", ") || "none"])));
  const unavailableGroups = recovery.groups.filter(g => g.status === "unavailable"), shownGroups = ordered(unavailableGroups).slice(0, L.rows);
  const recoverySessions = new Map(recovery.partitions.map(p => [p.id, p.sessionId]));
  body.push(omissions("Unavailable recovery groups", shownGroups.length, unavailableGroups.length), evidenceTable("unified-recovery-blocked", "Blocked groups; reasons do not prove a retry chain", ["Session", "Attempts", "Known failed attempts", "Reasons"], shownGroups.map(g => {
    const sid = recoverySessions.get(g.partitionId); if (sid === undefined) throw new SafeError("INVALID_RECORD");
    return [session(sid), g.attemptN, g.knownFailedAttemptN, g.reasons.join(", ") || "none"];
  })));
  const retryPartitions = ordered(retry.intervalPartitions ?? []).slice(0, L.partitions);
  body.push(omissions("Retry interval partitions", retryPartitions.length, retry.intervalPartitions?.length ?? 0), evidenceTable("unified-retry-partitions", "Independent compatible failed-attempt interval unions", ["Session", "Scope / evidence", "Failed attempts", "Union ms", "Reason"], retryPartitions.map(p => [session(p.sessionId), `${p.intervalScope} / ${p.intervalTimingEvidence}`, p.failedAttemptN, number(p.retryOverheadMs), p.reason ?? "none"])));
  const durationCohorts = ordered(retry.durationCohorts ?? []).slice(0, L.partitions);
  body.push(omissions("Retry recorded-duration cohorts", durationCohorts.length, retry.durationCohorts?.length ?? 0), evidenceTable("unified-retry-durations", "Independent recorded-duration sums; not interval unions", ["Session", "Scope / evidence", "Measured attempts", "Sum ms"], durationCohorts.map(p => [session(p.sessionId), `${p.durationScope} / ${p.timingEvidence}`, p.n, number(p.sumMs)])),
    countTable("unified-recovery-coverage", "Recovery eligibility and blocked populations", recovery.summary), reasons([...(recovery.recoveryAssessmentReason === null ? [] : [recovery.recoveryAssessmentReason]), ...recovery.limitations, ...retry.limitations]));
  const chains = ordered(recovery.chains ?? []).slice(0, L.chains);
  body.push(omissions("Recovery chains", chains.length, recovery.chains?.length ?? 0), evidenceTable("unified-recovery-chains", "Observed failure-result to success-result elapsed time; UTC boundaries", ["Session", "Scope / evidence", "Failed attempts", "Resolved", "First failed result", "Successful result", "Elapsed ms"], chains.map(c => [session(c.sessionId), `${c.intervalScope} / ${c.intervalTimingEvidence}`, c.failedAttemptCount, String(c.resolved), c.firstFailedResultAt, c.successfulResultAt, number(c.recoveryElapsedMs)])));
  body.push(`</section><section id="unified-reads"><h2>Read revisits and search recurrence</h2><p>Request recurrence is not proof of unchanged content, unnecessary work or exploration thrashing. Provider support and unresolved identities remain explicit.</p>`);
  const reads = ordered(m.reads.partitions).slice(0, L.partitions), searches = ordered(m.searches.partitions).slice(0, L.partitions);
  body.push(omissions("Read partitions", reads.length, m.reads.partitions.length), evidenceTable("unified-read-partitions", "Completed native file revisit populations", ["Session", "State / reason", "Valid reads", "Unique files", "Revisits", "Ratio (0–1)", "Missing identity"], reads.map(p => [session(p.sessionId), `${p.status} / ${p.reason ?? "none"}`, number(p.validReadN), number(p.uniqueFileN), number(p.revisitN), number(p.revisitRatio), p.missingFileIdentityN])),
    safeguards(m.reads.guidance.necessaryRereadCounterexample, m.reads.guidance.investigativeAction, m.reads.guidance.matchedExperiment, m.reads.guidance.qualityGuardrail), reasons(m.reads.guidance.limitations),
    omissions("Search partitions", searches.length, m.searches.partitions.length), evidenceTable("unified-search-partitions", "Exact native search-request recurrence; not equal results", ["Session", "State / reason", "Valid searches", "Unique lookups", "Repeats", "Ratio (0–1)", "Missing identity"], searches.map(p => [session(p.sessionId), `${p.status} / ${p.reason ?? "none"}`, number(p.validSearchN), number(p.uniqueLookupN), number(p.repeatN), number(p.repeatRatio), p.missingLookupN])),
    safeguards(m.searches.guidance.necessaryRecurrenceCounterexample, m.searches.guidance.investigativeAction, m.searches.guidance.matchedExperiment, m.searches.guidance.qualityGuardrail), reasons(m.searches.guidance.limitations));
  body.push(`</section><section id="unified-slow"><h2>Slow Tool candidates</h2><p>Large recorded-duration share is not waste. The original rule's support, sample thresholds and compatible denominators apply independently of the pattern section.</p>`,
    evidenceTable("unified-slow-thresholds", "Literal Slow Tool thresholds", ["Condition", "Value"], [["Minimum timed calls", m.slow.thresholds.minimumTimedCalls], ["Minimum duration share (0–1)", m.slow.thresholds.minimumDurationShare], ["Low-sample p95 below", m.slow.thresholds.p95LowSampleBelow]]));
  body.push(countTable("unified-slow-coverage", "Native recorded-duration admission and exclusions", { tentativeTimedCalls: m.slow.eligibility.tentativeTimedCalls, admittedTimedCalls: m.slow.eligibility.admittedTimedCalls, unresolvedProvenance: m.slow.provenance.unresolvedEvents, ...m.slow.eligibility.exclusions }), reasons([...(m.slow.candidateAssessmentReason === null ? [] : [m.slow.candidateAssessmentReason]), ...m.slow.limitations]));
  const slow = ordered(m.slow.candidates ?? []).slice(0, L.candidates);
  body.push(omissions("Slow Tool candidates", slow.length, m.slow.candidates?.length ?? 0));
  slow.forEach((c, i) => body.push(`<article class="card"><h3>slow-${i + 1} · ${text(session(c.sessionId))} · ${text(c.group.category)}</h3><p>Rule=${text(c.ruleId)} / ${text(c.ruleVersion)}; pattern=${text(c.confidence.pattern)}; avoidability=${text(c.confidence.avoidableWork)}; root cause=${text(c.confidence.rootCause)}; effect=${text(c.confidence.effect)}; scope=${text(c.durationScope)} / ${text(c.timingEvidence)}.</p>`,
    evidenceTable(`unified-slow-${i}`, "Original candidate duration and full native denominator", ["Measurement", "Value"], [["Safe pattern", c.group.commandPattern ?? c.group.toolName], ["Candidate N / denominator N", pair(c.n, c.denominatorN)], ["Candidate ms / denominator ms", pair(c.sumMs, c.denominatorSumMs)], ["Share (0–1)", c.observedEligibleNativeToolDurationShare], ["p50 / p95 ms", pair(c.p50Ms, c.p95Ms)], ["Low-sample p95", String(c.lowSampleP95)]]),
    evidenceBar(c.sumMs, c.denominatorSumMs), safeguards(c.necessaryWorkCounterexample, c.investigativeAction, c.matchedExperiment, c.qualityGuardrail), reasons(c.limitations), `</article>`));
  body.push(`</section>`, renderExplorationSection(m.exploration, { sessionAliases, eventAliases }));
  body.push(`<section id="unified-timeline"><h2>Observed invocation intervals</h2><p>Earliest positioned events admitted by the pattern-time authority. Different sessions/scopes/evidence are not added or causally ordered. Tied timestamps do not establish causality, critical path or savings.</p>`,
    m.timelineSuppressed ? `<p class="notice">Interval analysis suppressed; no measured zero timeline.</p>` : "",
    omissions("Earliest admitted intervals", m.timeline.length, m.positionedEventN),
    evidenceTable("unified-intervals", "Bounded interval table — UTC; not an inferred execution trace", ["Event alias", "Session", "Category", "Status", "Start UTC", "End UTC", "Scope / evidence"], m.timeline.map(e => [evidenceAlias(eventAliases, e.id), session(e.sessionId), e.category, e.status, e.startAt, e.endAt, `${e.intervalScope} / ${e.intervalTimingEvidence}`])),
    `</section><section class="notice"><h2>Pattern and validation detail</h2><p>The following four-rule section keeps its full original evidence qualifications. Slow Tool and informational exploration are shown separately above; neither adds events to Detected Waste. Read/search recurrence is not a substitute for that diagnostic. All session/event aliases keep the same meaning throughout this report.</p></section>`,
    renderPatternSections(m.patterns, { sessionAliases, eventAliases, embedded: true }));
  const limits = ["Single pinned source generation; no implicit source discovery or current-file freshness claim.",
    "Display limits are not new statistical populations. Complete evidence is available from the corresponding stats, insights and patterns --json commands.",
    "Daily token dates, provider error/content/change/validation-scope expansion and source deletion/move reconciliation are not introduced by this layout.",
    ...m.summary.limitations.map(x => `Summary: ${x}`), ...m.patterns.limitations.map(x => `Patterns: ${x}`)];
  return evidencePage("Unified source evidence", "Time, tokens, native failure and retry observations, plus evidence-gated patterns and validation from one stored generation.", body.join(""), limits, "For complete machine-readable evidence, use the corresponding stats, insights or patterns commands with --json.");
}
