import { describe, expect, it } from "vitest";
import { analyzeSelectedHistory } from "../src/analysis/source-history.js";
import { reconcileHistorySources } from "../src/analysis/history-reconcile.js";
import { HISTORY_DAY_MS, HistoryQueryError, parseHistoryQuery } from "../src/analysis/history-query.js";
import { formatHistoryResult } from "../src/cli/history.js";
import { event, id, source, success, paired } from "./recovery-fixture.js";
import type { StoredSource } from "../src/db/source-store.js";

const t = Date.parse("2026-10-03T00:00:00Z");
const q = parseHistoryQuery({ from: "2026-10-03T00:00:00Z", to: "2026-10-04T00:00:00Z" });
function archive(s: StoredSource, name = "archive"): StoredSource {
  const events = s.events.map(e => ({ ...e, sourceRef: { ...e.sourceRef, byteOffset: e.sourceRef.byteOffset + 1000 } }));
  return { ...source(events), sourceId: id("source", name), revision: 9 };
}
describe("selected-source reconciliation", () => {
  it("counts relocated copies once and retains every copy/proof receipt", () => {
    const original = source([event("one", t, t + 1000)]), copy = archive(original), before = JSON.stringify([original, copy]);
    const a = analyzeSelectedHistory([original, copy], q);
    expect(a.reconciliation.counts).toMatchObject({ eventCopies: 2, canonicalExecutions: 1, duplicateCopies: 1, admittedExecutions: 1 });
    expect(a.days[0]).toMatchObject({ terminalCompletions: 1, failedN: 1, toolBusyMs: 1000 });
    expect(a.reconciliation.executions[0]!.copies).toHaveLength(2);
    expect(a.reconciliation.executions[0]!.copies.every(c => c.proofIds.length === 1)).toBe(true);
    expect(JSON.stringify([original, copy])).toBe(before); expect(Object.isFrozen(a.days)).toBe(true);
    expect(analyzeSelectedHistory([copy, original], q)).toEqual(a);
  });
  it.each(["duration", "status", "session", "contract"] as const)("withholds %s conflicts without choosing the newer source", kind => {
    const original = source([event("one", t, t + 1000)]), copy = archive(original), e = copy.events[0]!;
    const changed = kind === "contract" ? { ...copy, parserVersion: 77 } : { ...copy,
      events: [{ ...e, ...(kind === "duration" ? { durationMs: 21 } : kind === "status" ? success : { sessionId: id("session", "another") }) }] };
    const a = analyzeSelectedHistory([original, changed], q);
    expect(a.reconciliation.counts.conflictingExecutions).toBe(1); expect(a.days).toEqual([]);
    expect(a.reconciliation.executions[0]!.reasons).toContain("semantic_or_contract_conflict");
  });
  it.each(["missing_proof", "unavailable"])("does not rescue a %s copy with a convenient admitted copy", kind => {
    const original = source([event("one", t, t + 1000)]), copy = archive(original);
    const changed = kind === "unavailable" ? { ...copy, availability: "unavailable" as const }
      : { ...copy, evidence: { ...copy.evidence!, observations: [] } };
    const a = analyzeSelectedHistory([original, changed], q);
    expect(a.reconciliation.executions[0]!.state).toBe("conflict"); expect(a.days).toEqual([]);
    expect(a.reconciliation.executions[0]!.reasons).toContain("copy_admission_disagreement");
  });
  it("keeps different canonical IDs and different sessions distinct", () => {
    const a = analyzeSelectedHistory([source([event("one", t, t + 1000), event("two", t, t + 1000,
      { sessionId: id("session", "second") })])], q);
    expect(a.reconciliation.counts.admittedExecutions).toBe(2); expect(a.days).toHaveLength(2);
    expect(a.days.map(d => d.toolBusyMs)).toEqual([1000, 1000]);
    const filtered = analyzeSelectedHistory([source([event("one", t, t + 1000), event("two", t, t + 1000,
      { sessionId: id("session", "second") })])], { ...q, sessionId: id("session", "second") });
    expect(filtered.days).toHaveLength(1); expect(filtered.reconciliation.counts.canonicalExecutions).toBe(2);
  });
  it("keeps missing or estimated position unknown, never zero-filled", () => {
    const a = analyzeSelectedHistory([source([event("missing", t, t + 1000, { startAt: null }),
      event("estimated", t, t + 1000, { intervalTimingEvidence: "estimated" })])], q);
    expect(a.reconciliation.counts.unpositionedExecutions).toBe(2); expect(a.days).toEqual([]); expect(a.assessment).toBe("partial");
  });
  it("rejects duplicated selections, mixed installation keys and oversized inputs", () => {
    const original = source(), copy = archive(original);
    expect(() => reconcileHistorySources([])).toThrow(HistoryQueryError);
    expect(() => reconcileHistorySources([original, original])).toThrow(HistoryQueryError);
    expect(() => reconcileHistorySources([original, { ...copy, keyId: "1".repeat(32) }])).toThrow(HistoryQueryError);
    expect(() => reconcileHistorySources(Array.from({ length: 17 }, (_, n) => archive(original, String(n))))).toThrow(HistoryQueryError);
    const many = Array.from({ length: 4096 }, (_, n) => event(`e${n}`, t, t + 1));
    expect(() => reconcileHistorySources([source(many), { ...source([event("extra", t, t + 1)]), sourceId: id("source", "extra") }])).toThrow(HistoryQueryError);
  });
  it("does not emit fingerprints, sourceRef, raw text or comparison signatures", () => {
    const s = source([event("private", t, t + 1000)]), a = analyzeSelectedHistory([s], q);
    const output = formatHistoryResult(a, true) + formatHistoryResult(a, false);
    expect(output).not.toMatch(/FICTITIOUS_|operationKey|errorFingerprint|sourceRef|signature/);
    expect(output).not.toContain(s.events[0]!.operationKey!);
    expect(JSON.parse(formatHistoryResult(a, true)).result).toEqual(a);
  });
});

describe("dated native interval projections", () => {
  it("separates sum20/union15 and exclusive/concurrent category time", () => {
    const a = analyzeSelectedHistory([source([event("a", t, t + 10000, { category: "test" }),
      event("b", t + 5000, t + 15000, { ...success, category: "build" })])], q);
    expect(a.days[0]).toMatchObject({ intervalLengthSumMs: 20000, toolBusyMs: 15000,
      concurrentCallsMs: 5000, concurrentCategoriesMs: 5000, exclusiveCategoryMs: { test: 5000, build: 5000 },
      terminalCompletions: 2, failedN: 1, completedN: 1 });
  });
  it("splits +09:00 midnight time and counts completion once", () => {
    const midnight = Date.parse("2026-10-03T15:00:00Z");
    const a = analyzeSelectedHistory([source([event("night", midnight - 1000, midnight + 2000)])], { ...q, offsetMinutes: 540 });
    expect(a.days.map(d => [d.date, d.toolBusyMs, d.terminalCompletions])).toEqual([["2026-10-03", 1000, 0], ["2026-10-04", 2000, 1]]);
  });
  it("a completion exactly at midnight belongs to the next day with measured zero time", () => {
    const midnight = t + HISTORY_DAY_MS;
    const a = analyzeSelectedHistory([source([event("edge", midnight - 1000, midnight)])], { ...q, endMs: midnight + 1000 });
    expect(a.days.map(d => [d.toolBusyMs, d.terminalCompletions])).toEqual([[1000, 0], [0, 1]]);
  });
  it("clips query contributions without counting an outside completion", () => {
    const a = analyzeSelectedHistory([source([event("span", t - 1000, t + 10000)])], { ...q, endMs: t + 5000 });
    expect(a.days[0]).toMatchObject({ toolBusyMs: 5000, terminalCompletions: 0 });
  });
  it("counts a verified zero-duration call at from, excluding to", () => {
    const a = analyzeSelectedHistory([source([event("from", t, t), event("to", t + 5000, t + 5000)])], { ...q, endMs: t + 5000 });
    expect(a.days).toHaveLength(1); expect(a.days[0]).toMatchObject({ toolBusyMs: 0, terminalCompletions: 1 });
  });
  it("does not mix evidence scopes or fill gap days", () => {
    const events = [event("structured", t, t + 1000), paired(event("paired", t, t + 1000)), event("later", t + 2 * HISTORY_DAY_MS, t + 2 * HISTORY_DAY_MS + 1000)];
    const a = analyzeSelectedHistory([source(events)], { ...q, endMs: t + 3 * HISTORY_DAY_MS });
    expect(a.days).toHaveLength(3); expect(a.days.map(d => d.date)).not.toContain("2026-10-04");
    expect(new Set(a.days.map(d => d.intervalScope)).size).toBe(2);
  });
  it("refuses excessive daily memberships instead of clipping evidence", () => {
    const events = Array.from({ length: 128 }, (_, n) => event(`long-${n}`, t, t + 360 * HISTORY_DAY_MS));
    expect(() => analyzeSelectedHistory([source(events)], { ...q, endMs: t + 360 * HISTORY_DAY_MS })).toThrow(HistoryQueryError);
  });
  it("bounds human output with exact omissions while JSON retains all executions", () => {
    const a = analyzeSelectedHistory([source(Array.from({ length: 12 }, (_, n) => event(`session-${n}`, t, t + 1000,
      { sessionId: id("session", `s${n}`) })))], q);
    const human = formatHistoryResult(a, false);
    expect(human).toContain("shown=8/12; omitted=4"); expect(a.days).toHaveLength(12);
    expect(Buffer.byteLength(human)).toBeLessThan(32768); expect(human.split("\n").length).toBeLessThan(160);
  });
  it("matches a deterministic independent millisecond-grid oracle for 200 populations", () => {
    let seed = 419; const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
    const start = Date.parse("2026-10-03T23:59:59.950Z");
    for (let run = 0; run < 200; run++) {
      const ranges = Array.from({ length: 1 + random() % 8 }, (_, i) => { const s = random() % 100;
        return { s, e: Math.min(100, s + random() % 30), category: i % 2 ? "build" as const : "test" as const }; });
      const lower = random() % 20, upper = 80 + random() % 21;
      const events = ranges.map((r, i) => event(`oracle-${i}`, start + r.s, start + r.e, { category: r.category }));
      const a = analyzeSelectedHistory([source(events)], { ...q, startMs: start + lower, endMs: start + upper });
      const expectedDates = new Set<string>();
      for (let n = lower; n < upper; n++) if (ranges.some(r => r.s <= n && n < r.e)) expectedDates.add(new Date(start + n).toISOString().slice(0, 10));
      for (const r of ranges) if (r.e >= lower && r.e < upper) expectedDates.add(new Date(start + r.e).toISOString().slice(0, 10));
      expect(a.days.map(d => d.date)).toEqual([...expectedDates].sort());
      for (const d of a.days) {
        let busy = 0, sum = 0, concurrent = 0, multiCategory = 0;
        for (let n = lower; n < upper; n++) {
          if (new Date(start + n).toISOString().slice(0, 10) !== d.date) continue;
          const active = ranges.filter(r => r.s <= n && n < r.e);
          sum += active.length; if (active.length) busy++; if (active.length > 1) concurrent++;
          if (new Set(active.map(r => r.category)).size > 1) multiCategory++;
        }
        const terminalN = ranges.filter(r => r.e >= lower && r.e < upper && new Date(start + r.e).toISOString().slice(0, 10) === d.date).length;
        expect([d.toolBusyMs, d.intervalLengthSumMs, d.concurrentCallsMs, d.concurrentCategoriesMs, d.terminalCompletions])
          .toEqual([busy, sum, concurrent, multiCategory, terminalN]);
      }
      expect(a.days.reduce((n, d) => n + d.terminalCompletions, 0)).toBe(ranges.filter(r => r.e >= lower && r.e < upper).length);
    }
  });
});
