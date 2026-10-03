import type { SelectedUsageHistory } from "../analysis/usage-history.js";
import { USAGE_TOKEN_FIELDS } from "../analysis/usage-history.js";
import { evidenceAlias, evidenceAliases, evidencePage, evidenceTable, htmlText, omissions } from "./evidence-page.js";

/** A bounded text/table projection of the exact analysis, with report-local aliases only. */
export function renderUsageHistoryPage(a: SelectedUsageHistory): string {
  const sourceAliases = evidenceAliases(a.sources.map(s => s.sourceId), "source");
  const sessions = evidenceAliases(a.responses.map(r => r.sessionId), "session");
  const days = a.days.slice(0, 64), responses = a.responses.slice(0, 24);
  const sourceRows = a.sources.map(s => [evidenceAlias(sourceAliases, s.sourceId), s.provider, s.revision, s.parserVersion,
    `${s.completedOffset}/${s.observedSize}`, s.availability, s.timingCapture ? "captured" : "legacy / not captured",
    s.parserCoverage, s.unsupportedRecords, s.suppressionReason ?? "none", s.usageRows, s.observationRows]);
  const body = `<section class="panel"><h2>Selection and coverage</h2><p>${htmlText(a.query.startInclusive)} to ${htmlText(a.query.endExclusive)} [start,end); fixed offset ${htmlText(a.query.offset)}.</p><p>Assessment: ${htmlText(a.assessment)}. ${a.query.sessionId === null ? "All selected sessions" : "One explicitly selected session"}. No daily zero-fill.</p>`
    + evidenceTable("usage-inventory", "Prefix inventory and dated response populations", ["Measure", "Count"], [
      ["Stored usage row copies", a.inventory.usageCopies], ["Stored observation row copies", a.inventory.observationCopies],
      ["Response identity groups", a.inventory.responseGroups], ["Equal duplicate copies removed", a.inventory.duplicateCopies],
      ["Excluded usage row copies", a.inventory.excludedCopies], ["Dated final-eligible responses", a.inventory.datedFinalResponses],
      ["Dated provisional responses (not final usage)", a.inventory.datedProvisionalResponses], ["Undated response groups", a.inventory.undatedResponses],
      ["Response groups outside query window", a.inventory.outsideWindowResponses]])
    + evidenceTable("usage-sources", "Selected stored source generations", ["Source", "Provider", "Revision", "Parser", "Bytes", "Availability", "Usage timestamps", "Coverage", "Unsupported records", "Suppression", "Usage rows", "Observations"], sourceRows)
    + evidenceTable("usage-exclusions", "Excluded row copies by reason; not token counts", ["Reason", "Copies"], Object.entries(a.inventory.exclusions)) + `</section>`
    + `<section class="panel"><h2>Daily response-token evidence</h2><p>Final and provisional populations are separate. Provisional values are unverified response observations, not final or billed token use. Cached input and reasoning output must not be added to total again.</p>`
    + (days.length ? "" : `<p>No dateable response evidence in this window. This does not prove zero token use.</p>`)
    + omissions("Daily partitions", days.length, a.days.length)
    + evidenceTable("usage-days", "Observed-record days; separate session, provider, mapping and finality", ["Day", "Session", "Provider", "Population", "Mapping", "Finality", "Responses", ...USAGE_TOKEN_FIELDS, "Overflow components"],
      days.map(d => [d.date, evidenceAlias(sessions, d.sessionId), d.provider, d.selection === "final" ? "final-eligible subset" : "provisional observations", d.mapping, d.finality,
        d.responseN, ...USAGE_TOKEN_FIELDS.map(k => d.counts[k]), d.overflowComponents.join(", ") || "none"])) + `</section>`
    + `<section class="panel"><h2>Response evidence</h2><p>Earliest known matching record timestamps are observation times, not completion dates. Missing-time witnesses remain visible. Counts and complete proof identities are available through --tokens --json without --output.</p>`
    + omissions("Response groups", responses.length, a.responses.length)
    + evidenceTable("usage-responses", "Bounded response receipts; no persistent identifiers", ["Response", "Session", "Provider", "Population", "State", "Reason", "Observed timestamp", "Copies", "Matching observations", "Missing timestamp observations"],
      responses.map(r => [r.ref, evidenceAlias(sessions, r.sessionId), r.provider, r.selection, r.state, r.reason ?? "none", r.observedAt,
        r.copies.length, r.matchingObservationN, r.missingTimestampN])) + `</section>`;
  return evidencePage("Daily token evidence", "Versioned usage observations, with finality and time coverage preserved.", body, a.limitations);
}
