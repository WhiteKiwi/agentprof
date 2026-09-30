// Input is parsed JSON. Read only own data fields, not accessor properties.
export function field(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}
export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function text(value: unknown, limit = 1_048_576): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= limit ? value : null;
}
export function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : null;
}
export function exitCode(value: unknown): number | null { return integer(value, -2_147_483_648, 2_147_483_647); }
export function jsonObject(value: unknown): Record<string, unknown> | null {
  if (object(value)) return value;
  if (typeof value !== "string" || value.length > 1_048_576) return null;
  try { const parsed: unknown = JSON.parse(value); return object(parsed) ? parsed : null; } catch { return null; }
}
export function utc(value: unknown): string | null {
  if (typeof value === "string") {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return null;
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return null;
    try { const normalized = new Date(parsed).toISOString(); return normalized.slice(0, 19) === value.slice(0, 19) ? normalized : null; } catch { return null; }
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) return null;
  try { return new Date(value).toISOString(); } catch { return null; }
}
export function epochSeconds(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER / 1000 ? utc(value * 1000) : null;
}
export function milliseconds(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : null;
}
export function rustDuration(value: unknown): number | null {
  const secs = integer(field(value, "secs"));
  const nanos = integer(field(value, "nanos"), 0, 999_999_999);
  if (secs === null || nanos === null) return null;
  return milliseconds(secs * 1000 + nanos / 1_000_000);
}
export function elapsed(start: string | null, end: string | null): number | null {
  return start === null || end === null ? null : milliseconds(Date.parse(end) - Date.parse(start));
}
