import { captureMode } from "../parsers/capture.js";
import type { CaptureMode, ParserCaptureOptions } from "../parsers/capture.js";
import type { InputRoot } from "../privacy/paths.js";
import { collectScan } from "./scan.js";

/** Pick only capture policy fields without invoking accessors; the parser owns validation. */
export function freshCapture(options: ParserCaptureOptions): CaptureMode {
  const descriptors = Object.getOwnPropertyDescriptors(options);
  const selected = {};
  for (const key of ["usageTiming", "patternEvidence"] as const) {
    const descriptor = descriptors[key];
    if (descriptor !== undefined) Object.defineProperty(selected, key, descriptor);
  }
  return captureMode(selected);
}

/** Retain the exact legacy three-argument collection path when capture is not enabled. */
export function collectFreshScan(directory: string, roots: readonly InputRoot[], signal: AbortSignal, capture: CaptureMode) {
  if (capture.patternEvidence) return collectScan(directory, roots, signal, { patternEvidence: true });
  if (capture.usageTiming) return collectScan(directory, roots, signal, { usageTiming: true });
  return collectScan(directory, roots, signal);
}
