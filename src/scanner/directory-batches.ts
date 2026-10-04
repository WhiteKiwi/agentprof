import { resolve } from "node:path";
import { types } from "node:util";
import { array, choice, fields } from "../db/source-validation.js";
import type { IdentityContext } from "../normalize/identity.js";
import { captureMode } from "../parsers/capture.js";
import { SafeError } from "../privacy/diagnostics.js";
import type { SafeDiagnostic } from "../privacy/diagnostics.js";
import type { InputRoot } from "../privacy/paths.js";
import { DIRECTORY_BATCH_LIMITS } from "./directory-census.js";
import { scanSources, SCAN_LIMITS } from "./scan-run.js";
import type { ScanResult, ScanSourceOutcome } from "./scan-run.js";
import { validSourcePath } from "./source-prefix.js";

type BatchOptions = Readonly<{ signal?: AbortSignal; usageTiming?: boolean; patternEvidence?: boolean }>;

/** Serial, bounded native scanner reuse. Only the outer coordinator captures membership. */
export async function scanDirectoryPages(store: Parameters<typeof scanSources>[0], context: IdentityContext,
  provider: InputRoot["provider"], paths: readonly string[], options: BatchOptions = {}): Promise<ScanResult> {
  choice(provider, ["codex", "claude"] as const);
  if (types.isProxy(paths) || types.isProxy(options)) throw new SafeError("INVALID_ARGUMENT");
  const selected = array(paths, DIRECTORY_BATCH_LIMITS.sources).map(value => {
    validSourcePath(value);
    if (typeof value !== "string" || resolve(value) !== value || !value.endsWith(".jsonl")) throw new SafeError("INVALID_ARGUMENT");
    return value;
  });
  if (selected.some((path, i) => i > 0 && selected[i - 1]! >= path)) throw new SafeError("INVALID_ARGUMENT");
  const names = Object.keys(Object.getOwnPropertyDescriptors(options));
  if (names.some(name => !["signal", "usageTiming", "patternEvidence"].includes(name))) throw new SafeError("INVALID_ARGUMENT");
  const values = fields(options, names), signal = values["signal"] as AbortSignal | undefined;
  if (signal !== undefined && (types.isProxy(signal) || !(signal instanceof AbortSignal))) throw new SafeError("INVALID_ARGUMENT");
  const mode = captureMode({ ...(values["usageTiming"] === undefined ? {} : { usageTiming: values["usageTiming"] as boolean }),
    ...(values["patternEvidence"] === undefined ? {} : { patternEvidence: values["patternEvidence"] as boolean }) });
  const sources: ScanSourceOutcome[] = [], samples: SafeDiagnostic[] = [];
  const counts = { discovered: 0, attempted: 0, committed: 0, unchanged: 0, rejected: 0, stale: 0, failed: 0, aborted: 0, duplicates: 0 };
  let status: ScanResult["status"] = "completed", stopReason: ScanResult["stopReason"] = null;
  let discoveryTruncated = false, observedCount = 0, adapterDroppedCount = 0;
  for (let offset = 0; offset < selected.length; offset += DIRECTORY_BATCH_LIMITS.page) {
    if (signal?.aborted) { status = "aborted"; stopReason = "aborted"; break; }
    const pagePaths = selected.slice(offset, offset + DIRECTORY_BATCH_LIMITS.page);
    const page = await scanSources(store, context, pagePaths.map(path => ({ provider, path })), {
      ...mode, ...(signal === undefined ? {} : { signal }),
      // A path changing into a directory must not expand this page beyond its admitted budget.
      maxSources: pagePaths.length,
    });
    const aliases = new Map<string, string>();
    for (const source of page.sources) {
      const alias = `source-${sources.length + 1}`;
      aliases.set(source.sourceAlias, alias);
      sources.push(Object.freeze({ ...source, sourceAlias: alias }));
    }
    for (const key of Object.keys(counts) as (keyof typeof counts)[]) counts[key] += page.counts[key];
    observedCount += page.diagnostics.observedCount;
    adapterDroppedCount += page.diagnostics.adapterDroppedCount;
    for (const sample of page.diagnostics.samples) {
      if (samples.length === SCAN_LIMITS.diagnostics) break;
      samples.push(Object.freeze({ ...sample, sourceAlias: sample.sourceAlias === null ? null : aliases.get(sample.sourceAlias) ?? null }));
    }
    discoveryTruncated ||= page.discoveryTruncated;
    if (page.status !== "completed") status = page.status;
    stopReason = page.stopReason;
    const expected = new Set(pagePaths.map(path => context.fingerprint("source", [provider, path])));
    const complete = page.sources.every(source => source.provider === provider && expected.delete(source.sourceId)
      && (source.status === "committed" || source.status === "unchanged")) && expected.size === 0;
    if (!complete || stopReason !== null || discoveryTruncated || page.status === "aborted") {
      if (status === "completed") status = "partial";
      break;
    }
  }
  if (signal?.aborted) { status = "aborted"; stopReason = "aborted"; }
  return Object.freeze({ status, stopReason, discoveryTruncated, sources: Object.freeze(sources), counts: Object.freeze(counts),
    diagnostics: Object.freeze({ observedCount, adapterDroppedCount, sampleDroppedCount: observedCount - samples.length, samples: Object.freeze(samples) }),
    aggregationReady: false, parserResumeReady: false });
}
