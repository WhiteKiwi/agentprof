import { describe, expect, it } from "vitest";
import { formatStatsResult } from "../src/cli/stats.js";
import type { StatsResult } from "../src/cli/stats.js";
import type { SourceSummary, DurationCohort, UsageCohort } from "../src/analysis/source-summary.js";
// Exact saved envelope from the existing synthetic Codex provider fixture.
const captured = `{"schema":"agentprof.cli/v1","ok":true,"command":"stats","result":{"mode":"selected_source","sourceFreshnessChecked":false,"summary":{"schema":"agentprof.source-summary/v1","scope":"source_prefix","sourceId":"h1:b08e487d12c5b0ef35f88b73e1d27ec4:source:d61907659497ab83039dc81207ccef053bfe97c195342b64d8b5c9ee968e53fd","provider":"codex","revision":1,"completedOffset":3642,"observedSize":3642,"persistedScope":"events_and_metric_evidence","availability":"available","crossSourceReconciled":false,"aggregationReady":false,"parserResumeReady":false,"capabilities":{"parserVersion":1,"support":"shape_verified_only","coverage":"partial","unsupportedRecords":1,"ambiguousRecords":0,"stateLimited":false,"diagnosticsDropped":0,"provider":"codex","observedShapes":["code_wrapper","command_item","custom_call","mcp_item","response_usage","tool_result","turn"]},"suppressionReason":null,"limitations":["source_local_only","observed_eligible_subset","no_usage_population_denominator","no_interval_aggregation","partial_shape_coverage"],"inventory":{"events":2,"turns":1,"usage":3,"observations":11,"diagnostics":4,"eventStatuses":{"completed":2,"failed":0,"cancelled":0,"pending":0,"unknown":0},"eventOutcomes":{"success":1,"no_match":1,"change_detected":0,"error":0,"unknown":0},"usageSelections":{"eligible":1,"provisional":0,"snapshot_only":2,"conflicted":0,"invalid":0},"usageFinalities":{"source_terminal":1,"trusted_final":0,"trusted_partial":0,"unknown":2}},"durationEligibility":{"terminalCandidates":2,"included":2,"exclusions":{"source_suppressed":0,"cancelled":0,"pending":0,"unknown_status":0,"missing_duration":0,"invalid_duration":0,"unknown_scope":0,"estimated_timing":0,"unknown_timing":0}},"usageEligibility":{"observedResponses":1,"selectedRows":1,"deduplicatedRows":0,"excludedRows":2,"excludedResponseGroups":0,"exclusions":{"source_suppressed":0,"cumulative_snapshot":2,"unverified_snapshot":0,"non_response_usage":0,"duplicate_response_conflict":0,"invalid":0,"conflicted":0,"provisional":0,"snapshot_only":0,"unverified_finality":0,"missing_response_id":0,"incomplete_components":0,"unverified_mapping":0}},"durations":[{"sessionId":"h1:b08e487d12c5b0ef35f88b73e1d27ec4:session:d5b4306ed3f4157a6e5f5e9ff795a672723d7359035e98b2f07c7e2b5e06a1c5","category":"mcp","toolName":"mcp","commandPattern":null,"durationScope":"invocation_latency","timingEvidence":"source_reported","n":1,"sumMs":1400,"meanMs":1400,"maxMs":1400,"p50Ms":1400,"p95Ms":1400,"lowSampleP95":true,"eventIds":["h1:b08e487d12c5b0ef35f88b73e1d27ec4:event:90129ab8cc394239d0fe904a14e7a21d935a8206e10b36c791179c0113e8d5a6"],"limitations":[]},{"sessionId":"h1:b08e487d12c5b0ef35f88b73e1d27ec4:session:d5b4306ed3f4157a6e5f5e9ff795a672723d7359035e98b2f07c7e2b5e06a1c5","category":"search","toolName":"exec_command","commandPattern":"rg --glob <args>","durationScope":"process_runtime","timingEvidence":"source_reported","n":1,"sumMs":2250,"meanMs":2250,"maxMs":2250,"p50Ms":2250,"p95Ms":2250,"lowSampleP95":true,"eventIds":["h1:b08e487d12c5b0ef35f88b73e1d27ec4:event:cf9c42af891bd93bae2857033f2d9d74fa2d89ea4426e77d57b5bf48f9c4306c"],"limitations":[]}],"usage":[{"sessionId":"h1:b08e487d12c5b0ef35f88b73e1d27ec4:session:d5b4306ed3f4157a6e5f5e9ff795a672723d7359035e98b2f07c7e2b5e06a1c5","provider":"codex","mapping":"openai_responses","finality":"source_terminal","observedResponses":1,"usageIds":["h1:b08e487d12c5b0ef35f88b73e1d27ec4:event:0fced6c49fa858f482b6548f292e571ef485a53b3d484a678b4a84504082f94a"],"counts":{"input":80,"output":12,"total":92,"cachedInput":20,"cacheWriteInput":5,"reasoningOutput":4,"uncachedInput":null},"overflowComponents":[],"limitations":[]}]}}}` + "\n";
const original = JSON.parse(captured).result as Extract<StatsResult, { mode: "selected_source" }>;
const base = original.summary;
const duration = (extra: Partial<DurationCohort> = {}): DurationCohort => ({ ...base.durations![0]!, ...extra });
const usage = (extra: Partial<UsageCohort> = {}): UsageCohort => ({ ...base.usage![0]!, ...extra });
const result = (extra: Partial<SourceSummary> = {}): StatsResult => ({ ...original, summary: { ...base, ...extra } });
const human = (extra: Partial<SourceSummary> = {}) => formatStatsResult(result(extra), false);
function deepFreeze<T>(v: T): T { if (v && typeof v === "object") { Object.values(v).forEach(deepFreeze); Object.freeze(v); } return v; }
function rows(n: number, unknown = false): DurationCohort[] {
  return Array.from({ length: n }, (_, i) => duration({ category: "test", toolName: "exec_command", commandPattern: (unknown ? "git diff " : "npm test ") + "--quiet ".repeat(i) + "<target>", n: unknown ? 2 : 1, sumMs: unknown ? null : 100, meanMs: unknown ? null : 100, maxMs: unknown ? Number.MAX_SAFE_INTEGER : 100, p50Ms: unknown ? 1 : 100, p95Ms: unknown ? Number.MAX_SAFE_INTEGER : 100, eventIds: [`synthetic-${unknown ? "unknown" : "known"}-event-${i}`], limitations: unknown ? ["numeric_overflow"] : [] }));
}
function numericRows(text: string): string[][] {
  const rows: string[][] = []; let durationTable = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("row |")) { durationTable = true; continue; }
    if (durationTable && /^[-+]+$/.test(line)) continue;
    if (durationTable && /^(?:U?\d+)\s+\|/.test(line)) rows.push(line.split("|").map(c => c.trim()));
    else durationTable = false;
  }
  return rows;
}

describe("selected-source human tables", () => {
  it("preserves exact captured JSON bytes and frozen input", () => {
    deepFreeze(original); expect(formatStatsResult(original, true)).toBe(captured);
    const before = JSON.stringify(original); formatStatsResult(original, false);
    expect(JSON.stringify(original)).toBe(before);
  });
  it("renders the complete synthetic Codex example", () => { expect(formatStatsResult(original, false)).toMatchInlineSnapshot(`
    "AgentProf stored source-prefix stats
    Freshness and other-source conflicts were not checked.
    No global/session/history totals; no parser resume.
    Source: h1:b08e487d12c5b0ef35f88b73e1d27ec4:source:d61907659497ab83039dc81207ccef053bfe97c195342b64d8b5c9ee968e53fd
    Provider: codex | revision: 1 | prefix: 3642/3642 bytes
    Scope: source_prefix | availability: available
    Evidence: events_and_metric_evidence | suppression: none
    Coverage: partial; support: shape_verified_only

    Inventory
    events | turns | usage rows | observations | diagnostics
    -------+-------+------------+--------------+------------
    2      | 1     | 3          | 11           | 4
    Event status: completed=2; failed=0; cancelled=0; pending=0; unknown=0
    Event outcome: success=1; no_match=1; change_detected=0; error=0; unknown=0
    Usage selection: eligible=1; provisional=0; snapshot_only=2; conflicted=0; invalid=0
    Usage finality: source_terminal=1; trusted_final=0; trusted_partial=0; unknown=2

    Duration eligibility: 2 included; 2 terminal candidates
    Exclusions: none (unlisted reasons=0)
    Usage eligibility: 1 observed eligible final responses; 1 selected rows; 0 deduplicated rows; 2
    excluded rows; 0 excluded response groups
    Exclusions: cumulative_snapshot=2 (unlisted reasons=0)

    Recorded durations: sums may overlap; they are not elapsed/busy time, time shares, waste or savings.
    All duration columns use milliseconds. * = p95 has fewer than 20 observations.
    Duration partitions: 2; rankings are only within each partition.

    Session: h1:b08e487d12c5b0ef35f88b73e1d27ec4:session:d5b4306ed3f4157a6e5f5e9ff795a672723d7359035e98b2f07c7e2b5e06a1c5
    invocation_latency | source_reported
    Known sums: showing 1 of 1 cohorts; omitted=0; recorded duration sum descending
    row | n | sum ms | mean ms | max ms | p50 ms | p95 ms
    ----+---+--------+---------+--------+--------+-------
    1   | 1 | 1400   | 1400    | 1400   | 1400   | 1400*
    1: category=mcp; tool=mcp; pattern=unknown
    1 limitations: none
    Unknown sums: showing 0 of 0 cohorts; omitted=0; unranked
    process_runtime | source_reported
    Known sums: showing 1 of 1 cohorts; omitted=0; recorded duration sum descending
    row | n | sum ms | mean ms | max ms | p50 ms | p95 ms
    ----+---+--------+---------+--------+--------+-------
    1   | 1 | 2250   | 2250    | 2250   | 2250   | 2250*
    1: category=search; tool=exec_command; pattern=rg --glob <args>
    1 limitations: none
    Unknown sums: showing 0 of 0 cohorts; omitted=0; unranked

    Observed final-response usage: codex | openai_responses | source_terminal
    Observed responses: 1
    input | output | total | cached input | cache write | reasoning | uncached input
    ------+--------+-------+--------------+-------------+-----------+---------------
    80    | 12     | 92    | 20           | 5           | 4         | unknown
    Overflow: none
    Usage limitations: none
    Normalized input already includes cache components; do not add them again. Claude input is uncached
    + cache read + cache write. Codex reasoning output is a subset of output.

    Evidence and limits
    Support: shape_verified_only; coverage: partial; parser version: 1
    Unsupported records: 1; ambiguous records: 0; state limited: false; dropped diagnostics: 0
    Observed shapes: code_wrapper, command_item, custom_call, mcp_item, response_usage, tool_result,
    turn
    Limitations: source_local_only, observed_eligible_subset, no_usage_population_denominator,
    no_interval_aggregation, partial_shape_coverage
    All cohorts and contributing event/usage IDs are available with --json.
    crossSourceReconciled=false; aggregationReady=false; parserResumeReady=false
    "
  `); });
  it.each([0, 1, 10, 11])("caps each known/unknown bucket independently at %i cohorts", n => {
    const cohorts = rows(n), overflow = rows(n, true).map(c => ({ ...c, commandPattern: c.commandPattern!.replace("--quiet", "--verbose") }));
    const text = human({ durations: [...cohorts, ...overflow] });
    if (n === 0) expect(text).toContain("no eligible measured observations; totals unknown");
    else for (const label of ["Known", "Unknown"]) expect(text).toContain(`${label} sums: showing ${Math.min(10, n)} of ${n} cohorts; omitted=${Math.max(0, n - 10)}`);
    expect(numericRows(text).length).toBe(Math.min(10, n) * 2);
  });
  it("keeps overflow visible after eleven known cohorts and retains all IDs in JSON", () => {
    const cohorts = [...rows(11), duration({ sumMs: null, meanMs: null, n: 2, maxMs: Number.MAX_SAFE_INTEGER, p50Ms: 1, p95Ms: Number.MAX_SAFE_INTEGER, limitations: ["numeric_overflow"], commandPattern: "git diff <target>", eventIds: ["overflow-event"] })];
    const r = result({ durations: cohorts }); const text = formatStatsResult(r, false);
    expect(text).toContain("Known sums: showing 10 of 11 cohorts; omitted=1");
    expect(text).toContain("Unknown sums: showing 1 of 1 cohorts; omitted=0; unranked");
    expect(numericRows(text).at(-1)).toEqual(["U1", "2", "unknown", "unknown", "9007199254740991", "1", "9007199254740991*"]);
    expect(text).toContain("U1 limitations: numeric_overflow");
    for (const c of cohorts) for (const id of c.eventIds) { expect(text).not.toContain(id); expect(formatStatsResult(r, true)).toContain(id); }
    expect(JSON.parse(formatStatsResult(r, true)).result.summary.durations).toHaveLength(12);
  });
  it("orders known sums and tied cutoffs by complete identity without mutation or locale", () => {
    const cohorts = [...rows(11), duration({ sumMs: 999, commandPattern: "npm test <args>", toolName: null })];
    const input = deepFreeze(result({ durations: cohorts, usage: [usage({ finality: "trusted_final" }), usage()] }));
    const before = JSON.stringify(input); const text = formatStatsResult(input, false);
    expect(numericRows(text)[0]![2]).toBe("999");
    expect(text).toBe(human({ durations: [...cohorts].reverse(), usage: [...input.summary.usage!].reverse() }));
    expect(JSON.stringify(input)).toBe(before);
  });
  it("preserves full session, scope and evidence partitions without pooling or session caps", () => {
    const sessions = Array.from({ length: 12 }, (_, i) => "h1:" + "a".repeat(32) + ":session:" + i.toString(16).padStart(64, "0"));
    const cohorts = sessions.flatMap(sessionId => [duration({ sessionId, durationScope: "process_runtime" }), duration({ sessionId, durationScope: "invocation_latency" }), duration({ sessionId, durationScope: "invocation_latency", timingEvidence: "paired_timestamps" })]);
    const text = human({ durations: cohorts, usage: null });
    expect(text).toContain("Duration partitions: 36");
    for (const id of sessions) expect(text.split("Session: " + id)).toHaveLength(2);
    expect(numericRows(text)).toHaveLength(36);
    expect(text).toBe(human({ durations: cohorts.reverse(), usage: null }));
  });
  it("uses supplied low-sample flags, exact decimals and overlap sums without recomputation", () => {
    const cohorts = [duration({ commandPattern: "npm test <target>", n: 19, sumMs: 190, meanMs: 10, maxMs: 19, p50Ms: 10, p95Ms: 19, lowSampleP95: true }), duration({ commandPattern: "npm test --quiet <target>", n: 20, sumMs: 210, meanMs: 10.5, maxMs: 20, p50Ms: 10, p95Ms: 19, lowSampleP95: false }), duration({ commandPattern: "npm test --verbose <target>", sumMs: 0.30000000000000004, meanMs: 0.15000000000000002 }), duration({ commandPattern: "git diff <target>", n: 2, sumMs: 20000, meanMs: 10000, maxMs: 10000, p50Ms: 10000, p95Ms: 10000 })];
    const text = human({ durations: cohorts }); const rendered = numericRows(text);
    expect(rendered[0]).toEqual(["1", "2", "20000", "10000", "10000", "10000", "10000*"]);
    expect(rendered[1]).toEqual(["2", "20", "210", "10.5", "20", "10", "19"]);
    expect(rendered[2]).toEqual(["3", "19", "190", "10", "19", "10", "19*"]);
    expect(rendered[3]!.slice(2, 4)).toEqual(["0.30000000000000004", "0.15000000000000002"]);
    expect(rendered.flat()).not.toContain("15000");
  });
  it("preserves separate usage evidence, normalized cache counts and component overflow", () => {
    const groups = [usage(), usage({ finality: "trusted_final" }), usage({ sessionId: "synthetic-session-2", provider: "claude", mapping: "anthropic_messages", finality: "trusted_final", counts: { input: 150, output: 10, total: 160, cachedInput: 30, cacheWriteInput: 20, reasoningOutput: null, uncachedInput: 100 } }), usage({ sessionId: "synthetic-session-3", observedResponses: 2, counts: { input: null, output: 0, total: null, cachedInput: 0, cacheWriteInput: 0, reasoningOutput: 0, uncachedInput: null }, overflowComponents: ["input", "total"], limitations: ["numeric_overflow", "zero_or_source_default"] })];
    const text = human({ usage: groups });
    expect(text).toContain("codex | openai_responses | source_terminal"); expect(text).toContain("codex | openai_responses | trusted_final");
    expect(text).toContain("claude | anthropic_messages | trusted_final");
    expect(text).toMatch(/150\s+\| 10\s+\| 160\s+\| 30\s+\| 20\s+\| unknown\s+\| 100/);
    expect(text).toMatch(/unknown\s+\| 0\s+\| unknown\s+\| 0\s+\| 0\s+\| 0\s+\| unknown/);
    expect(text).toContain("Overflow: input, total"); expect(text).toContain("Usage limitations: numeric_overflow, zero_or_source_default");
    expect(text).toContain("Observed responses: 2");
    for (const c of groups) for (const id of c.usageIds) expect(text).not.toContain(id);
  });
  it.each(["source_unavailable", "evidence_absent", "state_limited", "ambiguous_origin"] as const)("preserves suppression %s and unknown inventory without false zeros", suppressionReason => {
    const text = human({ suppressionReason, durations: null, usage: null, capabilities: null, usageEligibility: null, inventory: { ...base.inventory, turns: null, usage: null, observations: null, diagnostics: null, usageSelections: null, usageFinalities: null } });
    expect(text).toContain("Duration partitions: unknown");
    expect(text).toContain(`Duration cohorts: unknown (suppressed: ${suppressionReason})`);
    expect(text).toContain(`Usage cohorts: unknown (suppressed: ${suppressionReason})`);
    expect(text).toContain("Usage selection: unknown"); expect(text).toContain("Usage finality: unknown");
    expect(text).toContain("Usage eligibility: unknown\nExclusions: unknown"); expect(text).toContain("Capabilities: unknown");
  });
  it("shows every inventory enum including zero and all nonzero exclusions in contract order", () => {
    const durationEligibility = { ...base.durationEligibility, exclusions: Object.fromEntries(Object.keys(base.durationEligibility.exclusions).map((k, i) => [k, i])) } as SourceSummary["durationEligibility"];
    const usageEligibility = { ...base.usageEligibility!, exclusions: Object.fromEntries(Object.keys(base.usageEligibility!.exclusions).map((k, i) => [k, i])) } as NonNullable<SourceSummary["usageEligibility"]>;
    const text = human({ durationEligibility, usageEligibility }).replaceAll("\n", " ");
    for (const map of [base.inventory.eventStatuses, base.inventory.eventOutcomes, base.inventory.usageSelections!, base.inventory.usageFinalities!]) for (const [k,v] of Object.entries(map)) expect(text).toContain(`${k}=${v}`);
    for (const map of [durationEligibility.exclusions, usageEligibility.exclusions]) for (const [k, v] of Object.entries(map)) if (v) expect(text).toContain(`${k}=${v}`);
    expect(text).toContain("unlisted reasons=0");
  });
  it("retains long distinguishing safe pattern suffixes without shortening identities", () => {
    const pattern = "npm test " + "--quiet ".repeat(45) + "--verbose <target>";
    const text = human({ durations: [duration({ commandPattern: pattern })] });
    expect(text.replaceAll("\n", " ")).toContain("pattern=" + pattern);
    expect(text).toContain(base.sourceId); expect(text).toContain(base.durations![0]!.sessionId);
    expect(text).not.toMatch(/\x1b|…/);
  });
  it("preserves observed zero and evidence warnings", () => {
    const text = human({ durations: [duration({ n: 1, sumMs: 0, meanMs: 0, maxMs: 0, p50Ms: 0, p95Ms: 0 })], usage: [usage({ counts: { input: 0, output: 0, total: 0, cachedInput: 0, cacheWriteInput: 0, reasoningOutput: 0, uncachedInput: null }, limitations: ["zero_or_source_default"] })] });
    expect(numericRows(text)[0]).toEqual(["1", "1", "0", "0", "0", "0", "0*"]);
    expect(text).toContain("Usage limitations: zero_or_source_default"); expect(text).toContain("Coverage: partial; support: shape_verified_only");
    expect(text).toContain("Unsupported records: 1; ambiguous records: 0; state limited: false; dropped diagnostics: 0");
    expect(text).toContain("crossSourceReconciled=false; aggregationReady=false; parserResumeReady=false");
  });
});

it("keeps list-sources human and JSON output byte-for-byte unchanged", () => {
  const r: StatsResult = { mode: "list_sources", catalogue: { schema: "agentprof.source-catalogue/v1", limit: 64, returnedCount: 0, truncated: false, selection: "source_id_order", snapshotConsistent: true, metadataOnly: true, sourceFreshnessChecked: false, crossSourceReconciled: false, aggregationReady: false, parserResumeReady: false, items: [] } };
  expect(formatStatsResult(r, false)).toBe("AgentProf stored source-prefix stats\nFreshness and other-source conflicts were not checked. No global/session/history totals; no parser resume.\nSource catalogue: 0 returned; limit 64; truncated=false; order=source_id_order\nSnapshot-consistent inventory metadata only; metric payloads not revalidated. A later selection may observe a different revision.\ncrossSourceReconciled=false; aggregationReady=false; parserResumeReady=false\n");
  expect(formatStatsResult(r, true)).toBe('{"schema":"agentprof.cli/v1","ok":true,"command":"stats","result":{"mode":"list_sources","catalogue":{"schema":"agentprof.source-catalogue/v1","limit":64,"returnedCount":0,"truncated":false,"selection":"source_id_order","snapshotConsistent":true,"metadataOnly":true,"sourceFreshnessChecked":false,"crossSourceReconciled":false,"aggregationReady":false,"parserResumeReady":false,"items":[]}}}\n');
});

it("keeps unknown-only cohorts visible and unranked", () => {
  const text = human({ durations: rows(11, true), usage: null });
  expect(text).toContain("Known sums: showing 0 of 0 cohorts; omitted=0");
  expect(text).toContain("Unknown sums: showing 10 of 11 cohorts; omitted=1; unranked");
  expect(numericRows(text)).toHaveLength(10);
});
it("preserves wide labels verbatim as a renderer-only robustness check", () => {
  // Current store validation uses a closed ASCII display vocabulary; this does
  // not claim native sources can introduce arbitrary labels or Unicode patterns.
  const pattern = "synthetic-wide-검증界 " + "字".repeat(140) + " distinguishing-suffix";
  const text = human({ durations: [duration({ commandPattern: pattern })], usage: null });
  expect(text.replaceAll("\n", " ")).toContain("pattern=" + pattern);
  expect(numericRows(text)[0]![2]).toBe("1400");
});

it("renders the complete provisional-only Claude example and preserves JSON bytes", () => {
  const capturedClaude = `{"schema":"agentprof.cli/v1","ok":true,"command":"stats","result":{"mode":"selected_source","sourceFreshnessChecked":false,"summary":{"schema":"agentprof.source-summary/v1","scope":"source_prefix","sourceId":"h1:b08e487d12c5b0ef35f88b73e1d27ec4:source:4db568843841f39c96aaa06af74176043b1fce73401d405590ffad8c9d717260","provider":"claude","revision":1,"completedOffset":6018,"observedSize":6018,"persistedScope":"events_and_metric_evidence","availability":"available","crossSourceReconciled":false,"aggregationReady":false,"parserResumeReady":false,"capabilities":{"parserVersion":1,"support":"shape_verified_only","coverage":"partial","unsupportedRecords":0,"ambiguousRecords":0,"stateLimited":false,"diagnosticsDropped":0,"provider":"claude","observedShapes":["background_acknowledgement","message_link","message_usage","tool_result","tool_use","turn_duration"]},"suppressionReason":null,"limitations":["source_local_only","observed_eligible_subset","no_usage_population_denominator","no_interval_aggregation","partial_shape_coverage"],"inventory":{"events":5,"turns":2,"usage":1,"observations":41,"diagnostics":8,"eventStatuses":{"completed":2,"failed":1,"cancelled":0,"pending":2,"unknown":0},"eventOutcomes":{"success":2,"no_match":0,"change_detected":0,"error":1,"unknown":2},"usageSelections":{"eligible":0,"provisional":1,"snapshot_only":0,"conflicted":0,"invalid":0},"usageFinalities":{"source_terminal":0,"trusted_final":0,"trusted_partial":0,"unknown":1}},"durationEligibility":{"terminalCandidates":3,"included":3,"exclusions":{"source_suppressed":0,"cancelled":0,"pending":2,"unknown_status":0,"missing_duration":0,"invalid_duration":0,"unknown_scope":0,"estimated_timing":0,"unknown_timing":0}},"usageEligibility":{"observedResponses":0,"selectedRows":0,"deduplicatedRows":0,"excludedRows":1,"excludedResponseGroups":0,"exclusions":{"source_suppressed":0,"cumulative_snapshot":0,"unverified_snapshot":0,"non_response_usage":0,"duplicate_response_conflict":0,"invalid":0,"conflicted":0,"provisional":1,"snapshot_only":0,"unverified_finality":0,"missing_response_id":0,"incomplete_components":0,"unverified_mapping":0}},"durations":[{"sessionId":"h1:b08e487d12c5b0ef35f88b73e1d27ec4:session:118871777964b6d39a314bb7f57d413905d25804c73a11a7038e89a2e681d5ba","category":"mcp","toolName":"mcp","commandPattern":null,"durationScope":"invocation_latency","timingEvidence":"paired_timestamps","n":1,"sumMs":2000,"meanMs":2000,"maxMs":2000,"p50Ms":2000,"p95Ms":2000,"lowSampleP95":true,"eventIds":["h1:b08e487d12c5b0ef35f88b73e1d27ec4:event:46c01a568a97d42ffb42966d51aae76dce2fee35ea03830508932cc4fb3cc4de"],"limitations":[]},{"sessionId":"h1:b08e487d12c5b0ef35f88b73e1d27ec4:session:6647f418c6d5df2a62d90b43cfc97a158a8e65bdcd927c117ba62e4595dc9793","category":"read","toolName":"Read","commandPattern":null,"durationScope":"invocation_latency","timingEvidence":"paired_timestamps","n":1,"sumMs":3000,"meanMs":3000,"maxMs":3000,"p50Ms":3000,"p95Ms":3000,"lowSampleP95":true,"eventIds":["h1:b08e487d12c5b0ef35f88b73e1d27ec4:event:8944b67337ebd38245759c5c72dff5bafaaa7e44845d98cc457d872d80a82798"],"limitations":[]},{"sessionId":"h1:b08e487d12c5b0ef35f88b73e1d27ec4:session:6647f418c6d5df2a62d90b43cfc97a158a8e65bdcd927c117ba62e4595dc9793","category":"search","toolName":"Bash","commandPattern":"rg <args>","durationScope":"invocation_latency","timingEvidence":"paired_timestamps","n":1,"sumMs":3000,"meanMs":3000,"maxMs":3000,"p50Ms":3000,"p95Ms":3000,"lowSampleP95":true,"eventIds":["h1:b08e487d12c5b0ef35f88b73e1d27ec4:event:1e986797b16f702ced451dc57962b728a7ce86cf68de365a3925e3f79dfa23c8"],"limitations":[]}],"usage":null}}}` + "\n";
  const r = JSON.parse(capturedClaude).result as StatsResult;
  expect(formatStatsResult(r, true)).toBe(capturedClaude);
  expect(formatStatsResult(r, false)).toMatchInlineSnapshot(`
    "AgentProf stored source-prefix stats
    Freshness and other-source conflicts were not checked.
    No global/session/history totals; no parser resume.
    Source: h1:b08e487d12c5b0ef35f88b73e1d27ec4:source:4db568843841f39c96aaa06af74176043b1fce73401d405590ffad8c9d717260
    Provider: claude | revision: 1 | prefix: 6018/6018 bytes
    Scope: source_prefix | availability: available
    Evidence: events_and_metric_evidence | suppression: none
    Coverage: partial; support: shape_verified_only

    Inventory
    events | turns | usage rows | observations | diagnostics
    -------+-------+------------+--------------+------------
    5      | 2     | 1          | 41           | 8
    Event status: completed=2; failed=1; cancelled=0; pending=2; unknown=0
    Event outcome: success=2; no_match=0; change_detected=0; error=1; unknown=2
    Usage selection: eligible=0; provisional=1; snapshot_only=0; conflicted=0; invalid=0
    Usage finality: source_terminal=0; trusted_final=0; trusted_partial=0; unknown=1

    Duration eligibility: 3 included; 3 terminal candidates
    Exclusions: pending=2 (unlisted reasons=0)
    Usage eligibility: 0 observed eligible final responses; 0 selected rows; 0 deduplicated rows; 1
    excluded rows; 0 excluded response groups
    Exclusions: provisional=1 (unlisted reasons=0)

    Recorded durations: sums may overlap; they are not elapsed/busy time, time shares, waste or savings.
    All duration columns use milliseconds. * = p95 has fewer than 20 observations.
    Duration partitions: 2; rankings are only within each partition.
    Usage cohorts: no eligible final-response observations; token totals unknown

    Session: h1:b08e487d12c5b0ef35f88b73e1d27ec4:session:118871777964b6d39a314bb7f57d413905d25804c73a11a7038e89a2e681d5ba
    invocation_latency | paired_timestamps
    Known sums: showing 1 of 1 cohorts; omitted=0; recorded duration sum descending
    row | n | sum ms | mean ms | max ms | p50 ms | p95 ms
    ----+---+--------+---------+--------+--------+-------
    1   | 1 | 2000   | 2000    | 2000   | 2000   | 2000*
    1: category=mcp; tool=mcp; pattern=unknown
    1 limitations: none
    Unknown sums: showing 0 of 0 cohorts; omitted=0; unranked

    Session: h1:b08e487d12c5b0ef35f88b73e1d27ec4:session:6647f418c6d5df2a62d90b43cfc97a158a8e65bdcd927c117ba62e4595dc9793
    invocation_latency | paired_timestamps
    Known sums: showing 2 of 2 cohorts; omitted=0; recorded duration sum descending
    row | n | sum ms | mean ms | max ms | p50 ms | p95 ms
    ----+---+--------+---------+--------+--------+-------
    1   | 1 | 3000   | 3000    | 3000   | 3000   | 3000*
    2   | 1 | 3000   | 3000    | 3000   | 3000   | 3000*
    1: category=read; tool=Read; pattern=unknown
    1 limitations: none
    2: category=search; tool=Bash; pattern=rg <args>
    2 limitations: none
    Unknown sums: showing 0 of 0 cohorts; omitted=0; unranked

    Evidence and limits
    Support: shape_verified_only; coverage: partial; parser version: 1
    Unsupported records: 0; ambiguous records: 0; state limited: false; dropped diagnostics: 0
    Observed shapes: background_acknowledgement, message_link, message_usage, tool_result, tool_use,
    turn_duration
    Limitations: source_local_only, observed_eligible_subset, no_usage_population_denominator,
    no_interval_aggregation, partial_shape_coverage
    All cohorts and contributing event/usage IDs are available with --json.
    crossSourceReconciled=false; aggregationReady=false; parserResumeReady=false
    "
  `);
});

it("renders the source cohort ceiling with linear session bucketing and no spread overflow", () => {
  let sessionReads = 0;
  const sessionId = (i: number) => "h1:" + "a".repeat(32) + ":session:" + i.toString(16).padStart(64, "0");
  const cohorts = Array.from({ length: 4096 }, (_, i) => ({
    ...duration({ commandPattern: "npm test " + "--quiet ".repeat(250) + "<target>" }),
    get sessionId() { sessionReads++; return sessionId(i); },
  }));
  const groups = Array.from({ length: 4096 }, (_, i) => ({
    ...usage(), get sessionId() { sessionReads++; return sessionId(i); },
  }));
  const text = human({ durations: cohorts, usage: groups });
  // Count identity access instead of asserting hardware-dependent elapsed time.
  // A per-session rescan would perform millions of these reads.
  expect(sessionReads).toBeLessThanOrEqual(4096 * 4);
  expect(text).toContain("Duration partitions: 4096");
  expect(text.split("Session: ")).toHaveLength(4097);
  expect(text.split("pattern=npm test")).toHaveLength(4097);
  expect(text.split("Observed final-response usage: ")).toHaveLength(4097);
  expect(text).toContain(sessionId(4095));
  expect(human({ durations: [...cohorts].reverse(), usage: [...groups].reverse() })).toBe(text);
});
