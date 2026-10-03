import { types } from "node:util";
import { SafeError } from "../privacy/diagnostics.js";

/** Capture adds observation metadata, never upgrades usage finality or count semantics. */
export type ParserCaptureOptions = Readonly<{ usageTiming?: boolean }>;
export function validateCaptureOptions(value: ParserCaptureOptions = {}): boolean {
  if (value === null || typeof value !== "object" || types.isProxy(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new SafeError("INVALID_ARGUMENT");
  const fields = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(fields);
  if (keys.length === 0) return false;
  const field = fields["usageTiming"];
  if (keys.length !== 1 || !field || !("value" in field) || !field.enumerable
    || typeof field.value !== "boolean") throw new SafeError("INVALID_ARGUMENT");
  return field.value;
}
export function hasUsageTiming(provider: "codex" | "claude", version: number): boolean {
  return provider === "codex" ? version === 2 : version === 3;
}
/** Only these same-codec versions can be restored; Claude1 stays history-only. */
export function checkpointVersionSupported(provider: "codex" | "claude", version: number): boolean {
  return provider === "codex" ? version === 1 || version === 2 : version === 2 || version === 3;
}
export function nativeVersionSupported(provider: "codex" | "claude", version: number): boolean {
  return checkpointVersionSupported(provider, version) || provider === "claude" && version === 1;
}
