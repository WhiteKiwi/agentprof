import { types } from "node:util";
import type { IdentityContext } from "../normalize/identity.js";

export const PATTERN_TEXT_BYTES = 65_536;
export const PATTERN_BLOCKS = 256;
/** Own-data-only helpers also reject proxies before reflection. */
export function evidenceObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !types.isProxy(value) && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
export function evidenceField(value: unknown, key: string): unknown {
  if (!evidenceObject(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor?.enumerable && "value" in descriptor ? descriptor.value : undefined;
}
export function evidenceArray(value: unknown, maximum: number): readonly unknown[] | null {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== value.length + 1) return null;
  const result: unknown[] = [];
  for (let i = 0; i < value.length; i++) {
    const d = descriptors[String(i)];
    if (!d || !d.enumerable || !("value" in d)) return null;
    result.push(d.value);
  }
  return result;
}
export function evidenceText(value: unknown): value is string {
  return typeof value === "string" && value.length <= PATTERN_TEXT_BYTES && Buffer.byteLength(value) <= PATTERN_TEXT_BYTES
    && !/[\uD800-\uDFFF]/u.test(value);
}
/** This is an omission guard, not a claim to detect every possible producer truncation. */
export function hasTruncationMarker(value: string): boolean {
  return /warning:\s*truncated|(?:output|content|response|lines?)\s+(?:was\s+)?truncated|truncated\s+(?:output|content|response)|\[.{0,32}(?:truncated|omitted).{0,32}\]|<persisted-output>/i.test(value);
}
export function evidenceOmitted(...values: readonly unknown[]): boolean {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (!evidenceObject(value)) return true;
    for (const key of ["truncated", "isTruncated", "interrupted", "isImage", "isAsync"]) {
      if (Object.hasOwn(value, key) && evidenceField(value, key) !== false) return true;
    }
    if (Object.hasOwn(value, "content_state") && evidenceField(value, "content_state") !== "complete") return true;
  }
  return false;
}
/** Exact recorded error text only, not full output, fuzzy similarity or root cause. */
export function observedErrorFingerprint(context: IdentityContext, provider: "codex" | "claude",
  errorClass: "process_exit" | "tool_error", body: unknown, code: number | null = null): string | null {
  if (errorClass === "process_exit" && (!Number.isSafeInteger(code) || code === 0 || code === null || code < -2_147_483_648 || code > 2_147_483_647)
    || errorClass === "tool_error" && code !== null) return null;
  let parts: string[];
  if (evidenceText(body)) parts = [body];
  else {
    const blocks = evidenceArray(body, PATTERN_BLOCKS);
    if (blocks === null || blocks.length === 0) return null;
    parts = [];
    for (const block of blocks) {
      if (!evidenceObject(block) || evidenceOmitted(block)) return null;
      const kind = evidenceField(block, "type"), text = evidenceField(block, "text");
      if ((kind !== "text" && kind !== "input_text") || !evidenceText(text)) return null;
      parts.push(text);
    }
  }
  let bytes = 0;
  for (const text of parts) {
    bytes += Buffer.byteLength(text);
    if (bytes > PATTERN_TEXT_BYTES || hasTruncationMarker(text)) return null;
  }
  if (!parts.some(text => text.trim().length > 0)) return null;
  return context.fingerprint("error", ["observed_error_text/v1", provider, errorClass, code, parts]);
}
