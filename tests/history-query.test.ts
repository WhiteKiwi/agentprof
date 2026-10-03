import { describe, expect, it } from "vitest";
import { HISTORY_DAY_MS, HistoryQueryError, parseHistoryQuery, validateHistoryQuery, historyOffsetLabel } from "../src/analysis/history-query.js";

const period = { from: "2026-10-03T00:00:00Z", to: "2026-10-04T00:00:00Z" };
describe("explicit history period", () => {
  it.each(["+00:00", "+09:00", "-03:30", "+14:00", "-14:00"])("round-trips fixed offset %s", offset => {
    const q = parseHistoryQuery({ ...period, offset });
    expect(historyOffsetLabel(q.offsetMinutes)).toBe(offset); expect(q.endMs - q.startMs).toBe(HISTORY_DAY_MS);
    expect(Object.isFrozen(q)).toBe(true);
  });
  it.each([
    {}, { from: period.from }, { to: period.to }, { ...period, from: "2026-02-30T00:00:00Z" },
    { ...period, from: "2026-02-29T00:00:00Z" }, { ...period, from: "2026-10-03" },
    { ...period, from: "2026-10-03T00:00:00+00:00" }, { ...period, from: "2026-10-03T24:00:00Z" },
    { ...period, from: "2026-10-03T00:00:60Z" }, { ...period, from: "0000-10-03T00:00:00Z" },
    { ...period, to: period.from }, { ...period, to: "2026-10-02T00:00:00Z" },
    { ...period, offset: "+14:01" }, { ...period, offset: "-14:01" }, { ...period, offset: "Z" },
    { ...period, offset: "Asia/Seoul" }, { ...period, offset: "-00:00" }, { ...period, offset: "+09:60" },
    { ...period, offset: "+9:00" }, { ...period, session: "" },
  ])("rejects invalid calendar/range/offset input %#", options => {
    expect(() => parseHistoryQuery(options)).toThrow(HistoryQueryError);
  });
  it("accepts leap dates, milliseconds and exactly 366 days", () => {
    const q = parseHistoryQuery({ from: "2024-02-29T00:00:00.123Z", to: "2025-03-01T00:00:00.123Z" });
    expect(q.endMs - q.startMs).toBe(366 * HISTORY_DAY_MS);
    expect(() => validateHistoryQuery({ ...q, endMs: q.endMs + 1 })).toThrow(HistoryQueryError);
  });
  it("rejects shifted date bounds and unsafe internal values", () => {
    expect(() => parseHistoryQuery({ from: "0001-01-01T00:00:00Z", to: "0001-01-02T00:00:00Z", offset: "-01:00" })).toThrow();
    const q = parseHistoryQuery(period);
    for (const bad of [NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER]) expect(() => validateHistoryQuery({ ...q, startMs: bad })).toThrow();
    expect(() => validateHistoryQuery({ ...q, offsetMinutes: 0.5 })).toThrow();
  });
});
