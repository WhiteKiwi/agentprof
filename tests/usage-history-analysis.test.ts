import { describe, expect, it } from "vitest";
import { analyzeUsageHistory, USAGE_HISTORY_LIMITS, USAGE_TOKEN_FIELDS } from "../src/analysis/usage-history.js";
import { parseHistoryQuery } from "../src/analysis/history-query.js";
import { renderUsageHistoryPage } from "../src/report/usage-history-page.js";
import { formatUsageHistory } from "../src/cli/usage-history.js";
import { context, input, stored, records, record, at, afterMidnight, window, codexMeta, memory } from "./usage-timing-fixture.js";
const query = parseHistoryQuery(window);
const analyze = (...values: ReturnType<typeof stored>[]) => analyzeUsageHistory(values, query);
const clone = <T>(x: T): T => structuredClone(x);

it("uses independently calculated local-midnight arithmetic and separates provider/finality populations", () => {
  const codex = stored(input()), claude = stored(input("claude")), a = analyze(codex, claude);
  expect(a.days).toHaveLength(4);
  expect(a.days.filter(d => d.provider === "codex").map(d => ({ day: d.date, input: d.counts.input, output: d.counts.output, total: d.counts.total, final: d.selection }))).toEqual([
    { day: "2026-10-03", input: 100, output: 10, total: 110, final: "final" }, { day: "2026-10-04", input: 100, output: 20, total: 120, final: "final" }]);
  expect(a.days.filter(d => d.provider === "claude").map(d => ({ day: d.date, ...d.counts, final: d.selection }))).toEqual([
    { day: "2026-10-03", input: 150, uncachedInput: 100, cachedInput: 30, cacheWriteInput: 20, output: 10, total: 160, reasoningOutput: null, final: "provisional" },
    { day: "2026-10-04", input: 150, uncachedInput: 100, cachedInput: 30, cacheWriteInput: 20, output: 20, total: 170, reasoningOutput: null, final: "provisional" }]);
  expect(a.inventory).toMatchObject({ usageCopies: 4, responseGroups: 4, datedFinalResponses: 2, datedProvisionalResponses: 2, excludedCopies: 0 });
  expect(a.finalAndProvisionalCombined).toBe(false); expect(a.billedUsageClaim).toBe(false);
  expect(a.days.every(d => d.responseN === 1)).toBe(true); expect(a.assessment).toBe("partial");
});

for (const provider of ["codex", "claude"] as const) describe(`${provider} copied responses and missing time`, () => {
  it("deduplicates exact available response copies, not by filename, order or revision", () => {
    const first = stored(input(provider)), other = stored(input(provider, records(provider), "FICTITIOUS_COPY"));
    const a = analyze(first, { ...other, revision: 300 });
    expect(a.inventory).toMatchObject({ usageCopies: 4, responseGroups: 2, duplicateCopies: 2, excludedCopies: 0 });
    expect(a.days.map(d => d.counts.total)).toEqual(provider === "codex" ? [110, 120] : [160, 170]);
    expect(a.responses.every(r => r.copies.length === 2 && r.matchingObservationN === 2)).toBe(true);
    expect(analyze({ ...other, revision: 300 }, first)).toEqual(a);
  });
  it("withholds conflicting copies rather than selecting the latest or maximum", () => {
    const rows = records(provider); rows[rows.length - 1] = record(provider, "response-two", afterMidnight, 30) as never;
    const a = analyze(stored(input(provider)), { ...stored(input(provider, rows, "FICTITIOUS_CONFLICT")), revision: 999 });
    expect(a.inventory).toMatchObject({ usageCopies: 4, responseGroups: 2, duplicateCopies: 1, excludedCopies: 2, exclusions: { response_conflict: 2 } });
    expect(a.days).toHaveLength(1); expect(a.days[0]!.counts.total).toBe(provider === "codex" ? 110 : 160);
    expect(a.responses.filter(r => r.state === "excluded")).toHaveLength(1);
    expect(a.responses.find(r => r.state === "excluded")!.counts).toBeNull();
  });
  it("ignores unavailable copies for admission but retains their history and suppression inventory", () => {
    const current = stored(input(provider)), x = input(provider, records(provider), "FICTITIOUS_OLD"), { store } = memory();
    store.replaceSourceSnapshot(x, null); store.markUnavailable(x.sourceId, 1);
    const a = analyze(current, store.readSource(x.sourceId)!);
    expect(a.days.map(d => d.counts.total)).toEqual(provider === "codex" ? [110, 120] : [160, 170]);
    expect(a.inventory.exclusions.source_suppressed).toBe(2); expect(a.sources.some(s => s.availability === "unavailable")).toBe(true);
  });
  it("legacy timestamps stay undated and cannot create artificial zero-filled days", () => {
    const a = analyze(stored(input(provider, records(provider), "FICTITIOUS_LEGACY", false)));
    expect(a.days).toEqual([]); expect(a.inventory.undatedResponses).toBe(2); expect(a.assessment).toBe("not_evaluable");
    expect(a.sources[0]!.timingCapture).toBe(false); expect(a.responses.every(r => r.observedAt === null && r.date === null)).toBe(true);
  });
  it("uses matching known timestamp without hiding a legacy copy's missing-time witness", () => {
    const a = analyze(stored(input(provider)), stored(input(provider, records(provider), "FICTITIOUS_LEGACY", false)));
    expect(a.days).toHaveLength(2); expect(a.responses.every(r => r.missingTimestampN === 1)).toBe(true); expect(a.assessment).toBe("partial");
  });
  it("uses the earliest known matching timestamp even when a later replay is inside the query", () => {
    const rows = records(provider); rows[rows.length - 2] = record(provider, "response-one", "2026-10-02T12:00:00.000Z") as never;
    const a = analyze(stored(input(provider)), stored(input(provider, rows, "FICTITIOUS_EARLY_COPY")));
    expect(a.inventory.outsideWindowResponses).toBe(1); expect(a.days).toHaveLength(1); expect(a.days[0]!.date).toBe("2026-10-04");
  });
  it("preserves exact [from,to) boundaries and fixed offset without DST guesses", () => {
    const s = stored(input(provider));
    const before = analyzeUsageHistory([s], parseHistoryQuery({ from: at, to: afterMidnight, offset: "+09:00" }));
    expect(before.days).toHaveLength(1); expect(before.days[0]!.date).toBe("2026-10-03"); expect(before.inventory.outsideWindowResponses).toBe(1);
    const after = analyzeUsageHistory([s], parseHistoryQuery({ from: afterMidnight, to: "2026-10-03T15:00:01.000Z", offset: "+09:00" }));
    expect(after.days).toHaveLength(1); expect(after.days[0]!.date).toBe("2026-10-04");
    const utc = analyzeUsageHistory([s], parseHistoryQuery({ ...window, offset: "+00:00" }));
    expect(utc.days).toHaveLength(1); expect(utc.days[0]!.responseN).toBe(2);
  });
});

it("keeps cumulative thread/turn and unverified last snapshots out of response totals", () => {
  const response = record("codex") as any;
  response.payload.turn_token_usage = clone(response.payload.usage);
  response.payload.thread_token_usage = { ...response.payload.usage, input_tokens: 1000, total_tokens: 1010 };
  const token = { type: "event_msg", timestamp: afterMidnight, payload: { type: "token_count", info: { last_token_usage: clone(response.payload.usage) } } };
  const a = analyze(stored(input("codex", [codexMeta, response, token])));
  expect(a.inventory.exclusions).toMatchObject({ cumulative_snapshot: 2, unverified_snapshot: 1 });
  expect(a.days).toHaveLength(1); expect(a.days[0]!.counts.total).toBe(110); expect(a.inventory.usageCopies).toBe(4);
});

it.each(["ambiguous", "limited", "dropped", "absent"])("suppresses source %s without turning missing evidence into a healthy zero", kind => {
  const x = input(), e = clone(x.evidence) as any;
  if (kind === "ambiguous") { e.capabilities.ambiguousRecords = 1; e.capabilities.coverage = "partial"; }
  if (kind === "limited") { e.capabilities.stateLimited = true; e.capabilities.coverage = "partial"; }
  if (kind === "dropped") { e.capabilities.diagnosticsDropped = 1; e.capabilities.stateLimited = true; e.capabilities.coverage = "partial"; }
  let s = stored({ ...x, evidence: e });
  if (kind === "absent") { const { store } = memory(); const { evidence: _, ...base } = x; store.replaceSource(base, null); s = store.readSource(x.sourceId)!; }
  const a = analyze(s); expect(a.days).toEqual([]); expect(a.assessment).toBe("not_evaluable"); expect(a.sources[0]!.suppressionReason).not.toBeNull();
});

it.each(["missing", "copied", "wrong-counts", "wrong-finality"])("requires matching ordinary usage proof: %s", kind => {
  const x = input(), e = clone(x.evidence) as any;
  e.observations = e.observations.filter((o: any) => o.representation !== "usage" || o.usageId === e.usage[0].id);
  if (kind === "missing") e.observations = e.observations.filter((o: any) => o.representation !== "usage");
  for (const o of e.observations.filter((o: any) => o.representation === "usage")) {
    if (kind === "copied") o.origin = "trusted_copied";
    if (kind === "wrong-counts") { o.observedUsage = { ...o.observedUsage, counts: { ...o.observedUsage.counts, output: o.observedUsage.counts.output + 1, total: o.observedUsage.counts.total + 1 } }; }
    if (kind === "wrong-finality") o.observedUsage.finality = "unknown";
  }
  const a = analyze(stored({ ...x, evidence: e })); expect(a.days).toEqual([]); expect(a.inventory.excludedCopies).toBe(2);
  expect(a.inventory.exclusions[kind === "wrong-counts" ? "terminal_observation_conflict" : "missing_usage_proof"]).toBeGreaterThan(0);
});

it("retains missing response IDs as exclusions and null components without fake totals", () => {
  const noId = record("codex") as any; delete noId.payload.response_id;
  const partial = record("codex", "partial", at) as any; delete partial.payload.usage.input_tokens;
  const a = analyze(stored(input("codex", [codexMeta, noId, partial])));
  expect(a.inventory.exclusions.missing_response_id).toBe(1); expect(a.days[0]!.selection).toBe("provisional");
  expect(a.days[0]!.counts).toMatchObject({ input: null, output: 10, total: null });
});

it("zero tokens are observed zero, not unavailable; cache/reasoning components are not double-added", () => {
  const zero = record("codex", "zero", at, 0, { input_tokens: 0, total_tokens: 0, cached_input_tokens: 0, cache_write_input_tokens: 0, reasoning_output_tokens: 0 });
  const a = analyze(stored(input("codex", [codexMeta, zero])));
  expect(a.days[0]!.counts).toEqual({ input: 0, output: 0, total: 0, cachedInput: 0, cacheWriteInput: 0, reasoningOutput: 0, uncachedInput: null });
  expect(a.inventory.datedFinalResponses).toBe(1); expect(a.days[0]!.responseN).toBe(1);
});

it("uses safe integer sums and marks overflow without dropping other valid components", () => {
  const high = Number.MAX_SAFE_INTEGER - 10;
  const a = analyze(stored(input("codex", [codexMeta, record("codex", "one", at, 10, { input_tokens: high, total_tokens: Number.MAX_SAFE_INTEGER }),
    record("codex", "two", at, 10, { input_tokens: high, total_tokens: Number.MAX_SAFE_INTEGER })])));
  expect(a.days[0]!.counts).toMatchObject({ input: null, output: 20, total: null, cachedInput: 60 });
  expect(a.days[0]!.overflowComponents).toEqual(["input", "total"]); expect(a.assessment).toBe("partial");
});

it("does not mutate or freeze input objects, and remains invariant under input row order", () => {
  const original = stored(), mutable = clone(original), before = clone(mutable), a = analyze(mutable);
  expect(mutable).toEqual(before); expect(Object.isFrozen(mutable)).toBe(false); expect(Object.isFrozen(mutable.evidence!.usage[0])).toBe(false);
  (mutable.evidence!.usage as any[]).reverse(); (mutable.evidence!.observations as any[]).reverse();
  expect(analyze(mutable)).toEqual(a); expect(Object.isFrozen(a.days)).toBe(true); expect(Object.isFrozen(a.responses[0]!.copies)).toBe(true);
});

it("exact session selection does not accidentally include another stream", () => {
  const s = stored(), session = s.evidence!.usage[0]!.sessionId;
  expect(analyzeUsageHistory([s], { ...query, sessionId: session }).days).toEqual(analyze(s).days);
  const a = analyzeUsageHistory([s], { ...query, sessionId: context.fingerprint("session", ["FICTITIOUS_OTHER"]) });
  expect(a.days).toEqual([]); expect(a.inventory.exclusions.session_filter).toBe(2);
});

it("bounds selected sources and duplicate selections, rejects mixed installation keys", () => {
  const s = stored(); expect(() => analyze(s, s)).toThrow(); expect(() => analyzeUsageHistory([], query)).toThrow();
  expect(() => analyzeUsageHistory(Array.from({ length: 17 }, (_, i) => ({ ...s, sourceId: `id-${i}` })), query)).toThrow();
  expect(() => analyze(s, { ...s, sourceId: "other", keyId: "3".repeat(32) })).toThrow();
});

it("bounds aggregate usage/observation materialization and distinct response identities", () => {
  const s = stored(), many = clone(s) as any;
  many.evidence.usage = Array(USAGE_HISTORY_LIMITS.usageCopies + 1).fill(s.evidence!.usage[0]);
  expect(() => analyze(many)).toThrow();
  many.evidence.usage = []; many.evidence.observations = Array(USAGE_HISTORY_LIMITS.observationCopies + 1).fill(s.evidence!.observations[0]);
  expect(() => analyze(many)).toThrow();
});

it("handles maximum response population with complete proofs and bounded raw-free HTML", () => {
  const raw = [codexMeta, ...Array.from({ length: 4096 }, (_, i) => record("codex", `response-${i}`, at, 10))];
  const s = stored(input("codex", raw)), a = analyze(s), json = formatUsageHistory(a, true), html = renderUsageHistoryPage(a);
  expect(a.responses).toHaveLength(4096); expect(a.days[0]!.responseN).toBe(4096); expect(a.days[0]!.counts.total).toBe(450560);
  expect(a.days[0]!.responseRefs).toHaveLength(4096); expect(a.responses.every(r => r.copies[0]!.observationIds.length === 1)).toBe(true);
  expect(Buffer.byteLength(json)).toBeLessThan(USAGE_HISTORY_LIMITS.jsonBytes); expect(Buffer.byteLength(html)).toBeLessThan(1048576);
  expect(html).toContain("shown=24/4096; omitted=4072"); expect(html).not.toMatch(/h1:|FICTITIOUS_|<script|https?:\/\//);
  for (const k of USAGE_TOKEN_FIELDS) expect(html).toContain(k);
  expect(html).toContain("script-src &#39;none&#39;"); expect(html).toContain('scope="col"');
});

it("HTML escapes owned labels and exposes undated/zero/finality caveats", () => {
  const a = analyze(stored());
  const html = renderUsageHistoryPage({ ...a, limitations: ["<img src=x onerror=alert(1)>"] });
  expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;"); expect(html).not.toContain("<img");
  expect(html).toContain("not final or billed token use"); expect(html).not.toContain(a.sources[0]!.sourceId);
});
