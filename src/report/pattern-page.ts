import type { SourcePatternAnalysis } from "../analysis/source-patterns.js";
import { PATTERN_RULES } from "../analysis/pattern-rules.js";
import { SafeError } from "../privacy/diagnostics.js";
import { evidenceAlias, evidenceAliases, evidenceBar, evidenceLink, evidencePage, evidenceTable, htmlText, numericText, omissions } from "./evidence-page.js";

export const PATTERN_PAGE_LIMITS = Object.freeze({ partitions: 12, candidates: 12, cycles: 16, members: 12, witnesses: 16, reasons: 32 });
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const pair = (n: number | null, d: number | null): string => `${numericText(n)} / ${numericText(d)}`;
function reasonText(reasons: readonly string[]): string {
  const ordered = [...reasons].sort(compare), shown = ordered.slice(0, PATTERN_PAGE_LIMITS.reasons);
  return `${shown.map(r => `<p>${htmlText(r)}</p>`).join("") || "<p>None recorded.</p>"}${omissions("Reasons", shown.length, ordered.length)}`;
}
/** SourcePatternAnalysis is the unchanged analyzer's owned DTO, not user-supplied HTML/JSON. */
export type PatternSectionOptions = Readonly<{
  sessionAliases?: ReadonlyMap<string, string>; eventAliases?: ReadonlyMap<string, string>; embedded?: boolean;
}>;
export function renderPatternSections(a: SourcePatternAnalysis, options: PatternSectionOptions = {}): string {
  if (a.schema !== "agentprof.source-patterns/v1" || a.candidates.length > 4096 || a.rules.length !== PATTERN_RULES.length
    || new Set(a.rules.map(r => r.ruleId)).size !== PATTERN_RULES.length) throw new SafeError("INVALID_ARGUMENT");
  const candidateIndex = new Map(a.candidates.map(c => [c.id, c]));
  if (candidateIndex.size !== a.candidates.length) throw new SafeError("INVALID_ARGUMENT");
  const candidates = [...a.candidates].sort((x, y) => compare(x.ruleId, y.ruleId) || compare(x.id, y.id)).slice(0, PATTERN_PAGE_LIMITS.candidates);
  const cycles = [...a.editValidation.cycles].sort((x, y) => compare(x.firstValidationAt, y.firstValidationAt) || compare(x.id, y.id)).slice(0, PATTERN_PAGE_LIMITS.cycles);
  const cycleIndex = new Map(a.editValidation.cycles.map(c => [c.id, c]));
  const candidateAliases = evidenceAliases(candidateIndex.keys(), "candidate"), cycleAliases = evidenceAliases(cycleIndex.keys(), "cycle");
  const shownCandidates = new Set(candidates.map(c => c.id)), shownCycles = new Set(cycles.map(c => c.id));
  const sessionAliases = options.sessionAliases ?? evidenceAliases([
    ...a.editValidation.partitions.map(p => p.sessionId), ...(a.timePartitions ?? []).map(p => p.sessionId),
    ...a.candidates.flatMap(c => c.sessionIds), ...a.editValidation.cycles.map(c => c.sessionId),
  ], "session");
  const eventAliases = options.eventAliases ?? evidenceAliases([
    ...candidates.flatMap(c => [...c.evidenceEventIds, ...c.includedEventIds, ...c.untimedContributionEventIds,
      ...c.windowWitnesses.flatMap(w => [w.firstEventId, w.lastEventId])]),
    ...cycles.flatMap(c => [...c.editEventIds, ...c.validationEventIds, c.firstValidationEventId, ...(c.successfulValidationEventId === null ? [] : [c.successfulValidationEventId])]),
  ], "event");
  const time = [...(a.timePartitions ?? [])].sort((x, y) => compare(JSON.stringify([x.sessionId, x.intervalScope, x.intervalTimingEvidence]), JSON.stringify([y.sessionId, y.intervalScope, y.intervalTimingEvidence]))).slice(0, PATTERN_PAGE_LIMITS.partitions);
  const validationPartitions = [...a.editValidation.partitions].sort((x, y) => compare(x.sessionId, y.sessionId)).slice(0, PATTERN_PAGE_LIMITS.partitions);
  const exclusionCounts = new Map<string, number>();
  for (const item of a.coverage.positionExclusions) exclusionCounts.set(item.reason, (exclusionCounts.get(item.reason) ?? 0) + 1);
  const exclusionRows = [...exclusionCounts].sort(([x], [y]) => compare(x, y)).slice(0, PATTERN_PAGE_LIMITS.reasons);
  const body: string[] = [
    `<nav aria-label="Report sections">${evidenceLink("selection", "Context")}${evidenceLink("rules", "Rule assessments")}${evidenceLink("time", "Compatible time")}${evidenceLink("validation", "Edit and validation")}${evidenceLink("candidates", "Candidates")}</nav>`,
    `<section id="selection" class="panel"><h2>Source and observation context</h2><dl><dt>Source</dt><dd>source-1 · ${htmlText(a.provider)}</dd><dt>Revision / parser</dt><dd>${a.revision} / ${a.parserVersion}</dd><dt>Stored byte prefix / observed size</dt><dd>[0, ${a.completedOffset}) / ${a.observedSize}</dd><dt>Availability / persisted scope</dt><dd>${htmlText(a.availability)} / ${htmlText(a.persistedScope)}</dd><dt>Assessment / suppression</dt><dd class="state">${htmlText(a.assessment)} / ${htmlText(a.suppressionReason ?? "none")}</dd><dt>Time-contribution period in UTC</dt><dd>${a.queryPeriod === null ? "Stored positioned prefix; no explicit time clip" : `[${htmlText(a.queryPeriod.startAt)}, ${htmlText(a.queryPeriod.endAt)})`}</dd></dl><p>Cycle counts and first-pass ratios below describe the stored prefix, not the time-contribution period. Rule qualification windows remain separate from clipping. No freshness check or cross-source reconciliation.</p>`,
    evidenceTable("coverage", "Stored-prefix admission and position coverage", ["Population", "Observations"], [["Stored events", a.coverage.storedEventN], ["Admitted native terminal events", a.coverage.nativeTerminalN], ["Positioned events", a.coverage.positionedN], ["Unresolved provenance", a.coverage.unresolvedProvenanceN], ["Excluded positions", a.coverage.positionExclusions.length]]),
    evidenceTable("positions", "Recorded position exclusion reasons", ["Reason", "Events"], exclusionRows), omissions("Position reason rows", exclusionRows.length, exclusionCounts.size),
    `</section><section id="rules"><h2>Evidence-gated rule assessments</h2><p>Missing evidence, suppression and no candidate have different meanings. None establishes efficient work. This report does not add ordinary provider evidence capture.</p>`,
  ];
  for (const name of PATTERN_RULES) {
    const r = a.rules.find(r => r.ruleId === name);
    if (r === undefined || r.candidateIds.some(id => !candidateIndex.has(id))) throw new SafeError("INVALID_ARGUMENT");
    const linked = [...r.candidateIds].sort(compare).filter(id => shownCandidates.has(id));
    body.push(`<article id="rule-${name}" class="panel"><h3>${name}</h3><p class="state">${htmlText(r.status)}</p><p>Version: ${htmlText(r.version)}</p>`,
      evidenceTable(`rule-${name}-thresholds`, "Literal qualification thresholds and eligibility", ["Condition", "Value"], [["Minimum occurrences", r.thresholds.minimumOccurrences], ["Window ms", r.thresholds.windowMs === null ? "No fixed window" : r.thresholds.windowMs], ["Minimum session identities", r.thresholds.minimumSessions], ["Eligible events", r.eligibleEventN], ["Missing-evidence events", r.missingEvidenceEventIds.length], ["Blocked sessions", r.blockedSessionIds.length], ["Candidates", r.candidateIds.length]]),
      reasonText(r.reasons), omissions("Candidate links", linked.length, r.candidateIds.length),
      `<p>${linked.map(id => evidenceLink(evidenceAlias(candidateAliases, id), evidenceAlias(candidateAliases, id))).join(" ") || "No candidate detail links in this display."}</p></article>`);
  }
  body.push(`<div class="notice"><h3>${options.embedded === true ? "Diagnoses outside this pattern section" : "Diagnoses outside this report"}</h3>${a.omittedDiagnoses.map(d => `<p>${htmlText(d)}</p>`).join("")}</div></section><section id="time"><h2>Compatible observed time</h2><p>Meaning: ${htmlText(a.patternTimeMeaning)}. Pattern-associated time is not avoidable time, savings or productivity. Different sessions/scopes/evidence are not summed. Per-rule unions may overlap.</p>`,
    omissions("Time partitions", time.length, a.timePartitions?.length ?? 0));
  if (a.timePartitions === null) body.push(`<p class="notice">Time analysis is suppressed; there is no measured zero total.</p>`);
  else if (time.length === 0) body.push(`<p>No positioned intervals selected. A complete-history zero is not established.</p>`);
  time.forEach((p, i) => {
    const alias = `time-${i + 1}`;
    body.push(`<article class="panel" id="${alias}"><h3>${htmlText(evidenceAlias(sessionAliases, p.sessionId))} · ${htmlText(p.intervalScope)} / ${htmlText(p.intervalTimingEvidence)}</h3><p>Qualified observed subset only: ${p.qualifiedSubsetOnly}. Arithmetic overflow: ${p.arithmeticOverflow}.</p>`,
      evidenceTable(`${alias}-values`, "Compatible interval measurements in ms, not process-duration sums or saved time", ["Measurement", "ms"], [
        ["Interval length sum", numericText(p.intervalLengthSumMs)], ["Busy union", numericText(p.toolBusyMs)], ["Concurrent calls", numericText(p.concurrentCallsMs)], ["Concurrent categories", numericText(p.concurrentCategoriesMs)],
        ...Object.entries(p.perRuleMs).sort(([x], [y]) => compare(x, y)).map(([rule, value]) => [rule, numericText(value)]),
        ["Pattern-associated union", numericText(p.patternAssociatedMs)], ["Multiple-rule time", numericText(p.multipleRulesMs)], ["Multiplicity-weighted rule overlap excess", numericText(p.ruleOverlapExcessMs)],
      ]),
      `<p>Observed pattern union / same-partition busy union: ${pair(p.patternAssociatedMs, p.toolBusyMs)} ms. This ratio is not a savings estimate.</p>${evidenceBar(p.patternAssociatedMs, p.toolBusyMs)}`,
      evidenceTable(`${alias}-categories`, "Exclusive categories; concurrent category time is separate", ["Category", "ms"], Object.entries(p.exclusiveCategoryMs).sort(([x], [y]) => compare(x, y)).map(([category, value]) => [category, numericText(value)])),
      `<p>Positioned executions in partition: ${p.positionedEventIds.length}; contributing executions: ${p.contributingEventIds.length}. Full memberships remain in CLI JSON.</p></article>`);
  });
  body.push(`</section><section id="validation"><h2>Observed edit → validation</h2><p>Ordered observations, not causal proof or changed-file/test coverage. These are stored-prefix populations, not query-period counts. Unknown validation scope does not mean full validation.</p>`,
    omissions("Validation partitions", validationPartitions.length, a.editValidation.partitions.length));
  validationPartitions.forEach((p, i) => body.push(`<article class="panel"><h3>${htmlText(evidenceAlias(sessionAliases, p.sessionId))} · ${htmlText(p.status)}</h3>`,
    evidenceTable(`validation-${i + 1}`, "Exact first-result and known-first-scope denominators", ["Metric", "Value"], [["Observed cycles", p.cycleN], ["First-pass / first-terminal", pair(p.firstPassN, p.firstTerminalN)], ["First-pass ratio (0–1)", numericText(p.firstPassValidationRate)], ["Full first validation / known first scope", pair(p.fullScopeN, p.scopeKnownN)], ["Full-validation ratio (0–1)", numericText(p.fullValidationRatio)], ["Validation without observed edit", p.withoutObservedEditN], ["Edits awaiting validation", p.awaitingValidationEditN]]),
    reasonText(p.reasons), `</article>`));
  body.push(omissions("Earliest observed cycles", cycles.length, a.editValidation.cycles.length));
  for (const c of cycles) {
    const alias = evidenceAlias(cycleAliases, c.id), edits = c.editEventIds.slice(0, PATTERN_PAGE_LIMITS.members), validations = c.validationEventIds.slice(0, PATTERN_PAGE_LIMITS.members);
    body.push(`<details class="panel" id="${alias}"><summary>${alias} · ${htmlText(evidenceAlias(sessionAliases, c.sessionId))} · first ${htmlText(c.firstResult)}</summary><p>First validation: ${htmlText(c.firstValidationAt)}; declared scope=${htmlText(c.firstValidationScope)}; resolved=${c.resolved}. Changed files/lines: Unavailable.</p><p>Decisive first event: ${htmlText(evidenceAlias(eventAliases, c.firstValidationEventId))}; observed successful event: ${c.successfulValidationEventId === null ? "None observed" : htmlText(evidenceAlias(eventAliases, c.successfulValidationEventId))}; proof references=${c.evidenceObservationIds.length}.</p>`,
      omissions("Edit event aliases", edits.length, c.editEventIds.length), omissions("Validation event aliases", validations.length, c.validationEventIds.length),
      evidenceTable(`${alias}-events`, "Ordered edit and validation member aliases", ["Role", "Event"], [...edits.map(id => ["Edit", evidenceAlias(eventAliases, id)]), ...validations.map(id => ["Validation", evidenceAlias(eventAliases, id)])]), `</details>`);
  }
  body.push(`</section><section id="candidates"><h2>Pattern candidates and safeguards</h2>`, omissions("Candidate details", candidates.length, a.candidates.length));
  if (candidates.length === 0) body.push(`<p class="notice">No displayed candidates. Inspect the assessment above: missing evidence or suppressed analysis is not a negative diagnosis.</p>`);
  for (const c of candidates) {
    const alias = evidenceAlias(candidateAliases, c.id), included = new Set(c.includedEventIds), untimed = new Set(c.untimedContributionEventIds);
    const members = c.evidenceEventIds.slice(0, PATTERN_PAGE_LIMITS.members), witnesses = c.windowWitnesses.slice(0, PATTERN_PAGE_LIMITS.witnesses);
    const linkedCycles = [...c.relatedCycleIds].sort(compare).filter(id => shownCycles.has(id));
    const sessions = [...c.sessionIds].sort(compare).slice(0, PATTERN_PAGE_LIMITS.members);
    body.push(`<article class="card" id="${alias}"><h3>${alias} · ${htmlText(c.ruleId)}</h3><p>${evidenceLink(`rule-${c.ruleId}`, "Rule assessment and thresholds")}<span class="badge">${htmlText(c.severity)}</span>Version: ${htmlText(c.ruleVersion)}</p>`,
      evidenceTable(`${alias}-counts`, "Candidate evidence and pre-clipping contribution populations", ["Population", "Count"], [["Occurrences", c.occurrences], ["Evidence events", c.evidenceEventIds.length], ["Included contribution events", c.includedEventIds.length], ["Positioned contributions before query clipping", c.timedContributionN], ["Untimed contributions", c.untimedContributionEventIds.length], ["Proof references", c.evidenceObservationIds.length]]),
      `<p>Session aliases: ${sessions.map(id => htmlText(evidenceAlias(sessionAliases, id))).join(", ") || "None"}.</p>`, omissions("Candidate sessions", sessions.length, c.sessionIds.length),
      `<dl><dt>Necessary-work counterexample</dt><dd>${htmlText(c.necessaryWorkCounterexample)}</dd><dt>Investigation</dt><dd>${htmlText(c.investigativeAction)}</dd><dt>Matched experiment — suggested, not executed</dt><dd>${htmlText(c.matchedExperiment)}</dd><dt>Quality guardrail</dt><dd>${htmlText(c.qualityGuardrail)}</dd></dl><p>Avoidability=${htmlText(c.avoidability)}; root cause=${htmlText(c.rootCause)}; improvement=${htmlText(c.improvement)}.</p><details><summary>Candidate evidence roles and qualification windows</summary>`,
      omissions("Candidate evidence aliases", members.length, c.evidenceEventIds.length),
      evidenceTable(`${alias}-events`, "Evidence is distinct from time contribution; aliases are report-local", ["Event", "Included", "Positioned contribution"], members.map(id => [evidenceAlias(eventAliases, id), String(included.has(id)), included.has(id) ? String(!untimed.has(id)) : "Not a contribution"])),
      omissions("Qualification witnesses", witnesses.length, c.windowWitnesses.length),
      evidenceTable(`${alias}-witnesses`, "Unclipped qualification witnesses; UTC endpoints", ["First event", "Last event", "From UTC", "To UTC", "Occurrences"], witnesses.map(w => [evidenceAlias(eventAliases, w.firstEventId), evidenceAlias(eventAliases, w.lastEventId), new Date(w.startMs).toISOString(), new Date(w.endMs).toISOString(), w.count])),
      omissions("Related cycle links", linkedCycles.length, c.relatedCycleIds.length),
      `<p>${linkedCycles.map(id => evidenceLink(evidenceAlias(cycleAliases, id), evidenceAlias(cycleAliases, id))).join(" ") || "No displayed related cycles."}</p></details></article>`);
  }
  body.push(`</section>`);
  return body.join("");
}
export function renderPatternPage(a: SourcePatternAnalysis): string {
  return evidencePage("Observed patterns and validation", "Rule evidence, compatible pattern time and ordered edit-validation cycles from one stored source generation.", renderPatternSections(a), a.limitations);
}
