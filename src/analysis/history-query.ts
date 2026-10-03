export const HISTORY_DAY_MS = 86_400_000;
export const HISTORY_LIMITS = Object.freeze({ sources: 16, eventCopies: 16_384, observationCopies: 32_768,
  canonicalExecutions: 4_096, dailyMemberships: 32_768, periodDays: 366, jsonBytes: 8 * 1024 * 1024 });
const FIRST = Date.parse("0001-01-01T00:00:00.000Z"), LAST = Date.parse("9999-12-31T23:59:59.999Z");
export class HistoryQueryError extends Error {
  constructor() { super("invalid_or_oversized_history_query"); this.name = "HistoryQueryError"; }
}
export type HistoryWindowOptions = Readonly<{ from?: string; to?: string; offset?: string; session?: string }>;
export type HistoryQuery = Readonly<{ startMs: number; endMs: number; offsetMinutes: number; sessionId: string | null }>;
function utc(value: string | undefined): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) throw new HistoryQueryError();
  const n = Date.parse(value), canonical = value.includes(".") ? value : value.slice(0, -1) + ".000Z";
  if (!Number.isSafeInteger(n) || n < FIRST || n > LAST || new Date(n).toISOString() !== canonical) throw new HistoryQueryError();
  return n;
}
export function validateHistoryQuery(q: HistoryQuery): void {
  const shiftedStart = q.startMs + q.offsetMinutes * 60_000, shiftedEnd = q.endMs + q.offsetMinutes * 60_000;
  if (!Number.isSafeInteger(q.startMs) || !Number.isSafeInteger(q.endMs) || q.startMs < FIRST || q.endMs > LAST
    || q.endMs <= q.startMs || q.endMs - q.startMs > HISTORY_LIMITS.periodDays * HISTORY_DAY_MS
    || !Number.isInteger(q.offsetMinutes) || Math.abs(q.offsetMinutes) > 840
    || shiftedStart < FIRST || shiftedEnd > LAST
    || q.sessionId !== null && (typeof q.sessionId !== "string" || q.sessionId.length === 0 || q.sessionId.length > 256)) throw new HistoryQueryError();
}
export function parseHistoryQuery(options: HistoryWindowOptions): HistoryQuery {
  const offset = options.offset === undefined ? "+00:00" : options.offset;
  if (typeof offset !== "string" || !/^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(offset) || offset === "-00:00") throw new HistoryQueryError();
  const minutes = Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4));
  const q = { startMs: utc(options.from), endMs: utc(options.to),
    offsetMinutes: offset[0] === "-" ? -minutes : minutes, sessionId: options.session === undefined ? null : options.session };
  validateHistoryQuery(q);
  return Object.freeze(q);
}
export function historyOffsetLabel(minutes: number): string {
  const n = Math.abs(minutes);
  return `${minutes < 0 ? "-" : "+"}${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}
