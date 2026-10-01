// Parsed JSON only. Accessor properties are omitted on API candidates.
export function field(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}
export function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
export function text(value: unknown, limit = 1_048_576): string | null { return typeof value === "string" && value.length > 0 && value.length <= limit ? value : null; }
export function integer(value: unknown): number | null { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null; }
export function milliseconds(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : null; }
export function utc(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  try { const normalized = new Date(parsed).toISOString(); return normalized.slice(0, 19) === value.slice(0, 19) ? normalized : null; } catch { return null; }
}
export function elapsed(start: string | null, end: string | null): number | null { return start === null || end === null ? null : milliseconds(Date.parse(end) - Date.parse(start)); }
export function canonical(value: unknown, depth = 0, budget = { nodes: 0 }): string | null {
  if (depth > 32 || ++budget.nodes > 8192) return null;
  if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return JSON.stringify(value);
  if (typeof value === "string") return Buffer.byteLength(value) <= 1_048_576 ? JSON.stringify(value) : null;
  if (Array.isArray(value)) {
    if (value.length > 8192) return null;
    const parts = value.map((part) => canonical(part, depth + 1, budget));
    if (parts.some((part) => part === null)) return null;
    const encoded = `[${parts.join(",")}]`; return Buffer.byteLength(encoded) <= 1_048_576 ? encoded : null;
  }
  if (!object(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.length > 4096) return null;
  const parts: string[] = [];
  for (const key of keys) {
    const entry = field(value, key);
    if (entry === undefined) continue;
    const part = canonical(entry, depth + 1, budget);
    if (part === null) return null;
    parts.push(`${JSON.stringify(key)}:${part}`);
  }
  const encoded = `{${parts.join(",")}}`; return Buffer.byteLength(encoded) <= 1_048_576 ? encoded : null;
}
