import { types } from "node:util";
import { SafeError } from "../privacy/diagnostics.js";

/** New evidence capture implies timing, but never upgrades usage finality. */
export type ParserCaptureOptions = Readonly<{ usageTiming?: boolean; patternEvidence?: boolean }>;
export type CaptureMode = Readonly<{ usageTiming: boolean; patternEvidence: boolean }>;
export function captureMode(value: ParserCaptureOptions = {}): CaptureMode {
  if (value === null || typeof value !== "object" || types.isProxy(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new SafeError("INVALID_ARGUMENT");
  const fields = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(fields);
  if (keys.length > 2) throw new SafeError("INVALID_ARGUMENT");
  for (const key of keys) {
    if (key !== "usageTiming" && key !== "patternEvidence") throw new SafeError("INVALID_ARGUMENT");
    const field = fields[key];
    if (!field || !("value" in field) || !field.enumerable || typeof field.value !== "boolean") throw new SafeError("INVALID_ARGUMENT");
  }
  const patternEvidence = fields["patternEvidence"]?.value === true;
  return Object.freeze({ usageTiming: patternEvidence || fields["usageTiming"]?.value === true, patternEvidence });
}
/** Kept for existing SDK callers. */
export function validateCaptureOptions(value: ParserCaptureOptions = {}): boolean { return captureMode(value).usageTiming; }
export function hasPatternEvidence(provider: "codex" | "claude", version: number): boolean {
  return provider === "codex" ? version === 3 : version === 4;
}
export function hasUsageTiming(provider: "codex" | "claude", version: number): boolean {
  return hasPatternEvidence(provider, version) || (provider === "codex" ? version === 2 : version === 3);
}
export function captureForVersion(provider: "codex" | "claude", version: number): ParserCaptureOptions {
  return { usageTiming: hasUsageTiming(provider, version), ...(hasPatternEvidence(provider, version) ? { patternEvidence: true } : {}) };
}
/** Only these exact codec versions can be restored; Claude1 stays history-only. */
export function checkpointVersionSupported(provider: "codex" | "claude", version: number): boolean {
  return hasPatternEvidence(provider, version) || (provider === "codex" ? version === 1 || version === 2 : version === 2 || version === 3);
}
export function nativeVersionSupported(provider: "codex" | "claude", version: number): boolean {
  return checkpointVersionSupported(provider, version) || provider === "claude" && version === 1;
}
