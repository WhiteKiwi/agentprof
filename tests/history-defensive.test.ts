import { join } from "node:path";
import { existsSync } from "node:fs";
import { expect, it } from "vitest";
import { SafeError } from "../src/privacy/diagnostics.js";
import { validateHistoryArguments, formatHistoryResult } from "../src/cli/history.js";
import { analyzeSelectedHistory } from "../src/analysis/source-history.js";
import { HISTORY_DAY_MS, HISTORY_LIMITS, parseHistoryQuery } from "../src/analysis/history-query.js";
import { event, id, source } from "./recovery-fixture.js";
import { temporaryDirectory } from "./helpers.js";

const period = { from: "2026-10-03T00:00:00Z", to: "2026-10-04T00:00:00Z" };
it.each([1, 2])("rejects sparse source arrays of length %s before store access", length => {
  const sources = new Array<string>(length);
  if (length > 1) sources[0] = id("source", "one");
  const dataDir = join(temporaryDirectory(), "absent");
  expect(() => validateHistoryArguments({ ...period, source: sources, dataDir })).toThrowError(new SafeError("INVALID_ARGUMENT"));
  expect(existsSync(dataDir)).toBe(false);
});
it("splits a half-hour negative offset at its actual local midnight", () => {
  const midnight = Date.parse("2026-10-03T03:30:00Z");
  const q = parseHistoryQuery({ ...period, offset: "-03:30" });
  const a = analyzeSelectedHistory([source([event("negative-midnight", midnight - 1000, midnight + 2000)])], q);
  expect(a.days.map(d => [d.date, d.toolBusyMs, d.terminalCompletions]))
    .toEqual([["2026-10-02", 1000, 0], ["2026-10-03", 2000, 1]]);
});
it("refuses over-8-MiB JSON from real bounded analysis instead of clipping its proofs", () => {
  const t = Date.parse(period.from), q = { ...parseHistoryQuery(period), endMs: t + 20 * HISTORY_DAY_MS };
  const es = Array.from({ length: 1000 }, (_, n) => event(`json-limit-${n}`, t, q.endMs,
    { sessionId: id("session", `limit-session-${n}`) }));
  const a = analyzeSelectedHistory([source(es)], q);
  expect(a.reconciliation.counts.admittedExecutions).toBe(1000);
  expect(a.days).toHaveLength(20000);
  expect(a.reconciliation.executions.every(e => e.copies[0]!.proofIds.length === 1)).toBe(true);
  const bytes = Buffer.byteLength(JSON.stringify({ schema: "agentprof.cli/v1", ok: true, command: "history", result: a }) + "\n");
  expect(bytes).toBeGreaterThan(HISTORY_LIMITS.jsonBytes);
  expect(() => formatHistoryResult(a, true)).toThrowError(new SafeError("INVALID_ARGUMENT"));
  const human = formatHistoryResult(a, false);
  expect(human).toContain("shown=8/20000; omitted=19992");
  expect(Buffer.byteLength(human)).toBeLessThan(32768);
  expect(human.split("\n").length).toBeLessThan(160);
  expect(a.days).toHaveLength(20000);
}, 15000);
