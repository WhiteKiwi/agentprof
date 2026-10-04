import type { SourceExplorationAnalysis } from "../analysis/source-exploration.js";
import { SafeError } from "../privacy/diagnostics.js";
import { evidenceAlias, evidenceTable, htmlText as text, numericText as number, omissions } from "./evidence-page.js";

export const EXPLORATION_REPORT_LIMITS = Object.freeze({ partitions: 12, candidates: 12, groups: 12, events: 12 });
export type ExplorationReportAliases = Readonly<{
  sessionAliases: ReadonlyMap<string, string>;
  eventAliases: ReadonlyMap<string, string>;
}>;
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

/** Render only an owned native analysis. Stable identities are map keys, never serialized.
 * Display caps do not change the native candidate population or its empty waste membership. */
export function renderExplorationSection(a: SourceExplorationAnalysis, aliases: ExplorationReportAliases): string {
  if (a.schema !== "agentprof.source-exploration/v1" || a.partitions.length > 4096
    || (a.candidates?.length ?? 0) > 4096 || a.includedEventIds.length !== 0) throw new SafeError("INVALID_RECORD");
  const session = (id: string) => evidenceAlias(aliases.sessionAliases, id);
  const event = (id: string) => evidenceAlias(aliases.eventAliases, id);
  const states = new Map<string, number>(), reasons = new Map<string, number>();
  for (const p of a.partitions) {
    session(p.sessionId);
    states.set(p.status, (states.get(p.status) ?? 0) + 1);
    for (const reason of p.reasons) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  // Validate references even for cards omitted from display; no unknown identity is printed as a fallback.
  for (const c of a.candidates ?? []) {
    session(c.sessionId);
    if (c.severity !== "INFO" || c.includedEventIds.length !== 0) throw new SafeError("INVALID_RECORD");
    for (const id of c.evidenceEventIds) event(id);
  }
  const L = EXPLORATION_REPORT_LIMITS;
  const partitions = [...a.partitions].sort((x, y) => compare(x.id, y.id)).slice(0, L.partitions);
  const candidates = [...(a.candidates ?? [])].sort((x, y) => compare(x.id, y.id)).slice(0, L.candidates);
  const body = [`<section id="unified-exploration"><h2>Exploration patterns — informational only</h2>`,
    `<p>Assessment=${text(a.assessment)}; suppression=${text(a.suppressionReason ?? "none")}; rule=${text(a.ruleId)} / ${text(a.ruleVersion)}.</p>`,
    `<p>${text(a.guidance.meaning)} No exploration events or time are added to Detected Waste. An empty candidate list does not establish efficient work.</p>`,
    evidenceTable("unified-exploration-thresholds", "Native exploration thresholds — closed trailing windows", ["Condition", "Value"], [
      ["Window width ms (both endpoints included)", number(a.thresholds.windowMs)],
      ["Minimum completed native lookups", number(a.thresholds.minimumLookups)],
      ["Minimum same exact native search invocations", number(a.thresholds.minimumRepeatedSearch)],
      ["Maximum intersecting Edit/Write invocations", number(a.thresholds.maximumMutations)],
      ["Intersecting opaque actions allowed", 0],
    ]),
    evidenceTable("unified-exploration-population", "Full exploration population — before display limits", ["Population", "Count"], [
      ["Session partitions", a.partitions.length], ["Candidate windows", number(a.candidates === null ? null : a.candidates.length)],
      ...[...states].sort(([x], [y]) => compare(x, y)).map(([state, n]) => [`Session state: ${state}`, n]),
    ]),
    evidenceTable("unified-exploration-reasons", "Reason counts across all session partitions — reasons can overlap", ["Reason", "Session partitions"],
      [...reasons].sort(([x], [y]) => compare(x, y))),
    omissions("Exploration partitions", partitions.length, a.partitions.length),
    evidenceTable("unified-exploration-partitions", "Exploration eligibility and evaluated window counts", ["Session", "State", "Completed lookups", "Positioned lookups", "Excluded lookups", "Edit/Write", "Opaque", "Unresolved events", "Evaluated endpoints", "Numeric-qualified windows", "Opaque-blocked windows", "Reasons"],
      partitions.map(p => [session(p.sessionId), p.status, p.observedCompletedLookupN, p.positionedLookupN, p.excludedLookupN, p.mutationN, p.opaqueN, p.unresolvedEventIds.length,
        number(p.windowEndpointsEvaluated), number(p.numericQualifiedWindows), number(p.opaqueBlockedWindows), p.reasons.join(", ") || "none"])),
  ];
  body.push(`<p>Window counters stop at the first selected candidate in each session, or cover all endpoints when no candidate is selected. Unavailable counters remain unavailable.</p>`);
  if (a.candidates === null) body.push(`<p class="notice">Exploration candidates unavailable; not zero findings. See the native assessment and reasons above.</p>`);
  else body.push(omissions("Exploration candidates", candidates.length, a.candidates.length));
  candidates.forEach((c, i) => {
    const groups = c.repeatedSearchGroups.slice(0, L.groups), events = c.evidenceEventIds.slice(0, L.events);
    body.push(`<article class="card"><h3>exploration-${i + 1} · ${text(session(c.sessionId))} · INFO</h3>`,
      evidenceTable(`unified-exploration-window-${i}`, "First qualifying window in this session — UTC; not elapsed or wasted time", ["Measurement", "Value"], [
        ["Start inclusive UTC", c.window.startInclusive], ["End inclusive UTC", c.window.endInclusive], ["Fixed window width ms", c.window.widthMs],
        ["Completed native lookups", c.lookupN], ["Largest repeated exact search", c.largestRepeatedSearchN], ["Intersecting Edit/Write", c.mutationN],
        ["Selected event evidence count", c.evidenceEventIds.length], ["Owned call/result proof count", c.evidenceObservationIds.length],
      ]),
      omissions("Repeated search groups", groups.length, c.repeatedSearchGroups.length),
      evidenceTable(`unified-exploration-groups-${i}`, "Exact repeated-request groups — aliases local to this candidate; not equal results", ["Group alias", "Invocation count"],
        groups.map((g, j) => [`search-${j + 1}`, g.invocationN])),
      omissions("Selected exploration event evidence", events.length, c.evidenceEventIds.length),
      `<p class="evidence-links">Report-local event aliases: ${events.map(id => text(event(id))).join(", ") || "none"}.</p></article>`);
  });
  const g = a.guidance;
  body.push(`<dl><dt>Necessary-work counterexample</dt><dd>${text(g.necessaryWorkCounterexample)}</dd><dt>Investigate</dt><dd>${text(g.investigativeAction)}</dd><dt>Matched experiment — suggested, not executed</dt><dd>${text(g.matchedExperiment)}</dd><dt>Quality guardrail</dt><dd>${text(g.qualityGuardrail)}</dd></dl>`,
    ...g.limitations.map(value => `<p class="notice">${text(value)}</p>`),
    `<p>Complete exploration events and supporting proofs: <code>agentprof insights --source FULL_SOURCE_ID --exploration --json</code>. HTML display limits do not truncate that command's evidence.</p></section>`);
  return body.join("");
}
