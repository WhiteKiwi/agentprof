import type { createSourceStore } from "../db/source-store.js";
import type { IdentityContext } from "../normalize/identity.js";
import type { InputRoot } from "../privacy/paths.js";
import { SafeError, safeErrorEnvelope } from "../privacy/diagnostics.js";
import type { DiagnosticCode } from "../privacy/diagnostics.js";
import { scanSources, SCAN_LIMITS } from "./scan-run.js";
import type { ScanResult } from "./scan-run.js";
import { inspectLifecyclePath, sameLifecycleParent } from "./lifecycle-path.js";
import type { LifecyclePathState } from "./lifecycle-path.js";

export type PreparedLifecycleFile = InputRoot & Readonly<{ observation: LifecyclePathState }>;
export type LifecycleOutcome = Readonly<{
  sourceId: string; sourceAlias: string; provider: InputRoot["provider"];
  status: "collected" | "collection_ineligible" | "marked_unavailable" | "already_unavailable" | "not_stored" | "changed_during_check" | "stale" | "failed" | "skipped";
  revisionBefore: number | null; revisionAfter: number | null;
  reason: "reappeared" | "parent_changed" | "collection_stopped" | "aborted" | null;
  errorCode: DiagnosticCode | null;
}>;
export type SourceLifecycleResult = Readonly<{
  mode: "explicit_source_lifecycle"; status: "completed" | "partial" | "aborted";
  scan: ScanResult | null; files: readonly LifecycleOutcome[];
  selectedInputs: number; unprocessedInputs: number;
  liveSources: readonly Readonly<{ sourceId: string; provider: InputRoot["provider"]; revision: number }>[];
  counts: Readonly<{ collected: number; markedUnavailable: number; alreadyUnavailable: number; notStored: number; incomplete: number }>;
  retainedPayloads: true; directoryReconciliation: false; fullHistory: false;
  limitations: readonly string[];
}>;
const complete = new Set<LifecycleOutcome["status"]>(["collected", "marked_unavailable", "already_unavailable", "not_stored"]);
function finish(selectedInputs: number, files: readonly LifecycleOutcome[], scan: ScanResult | null, aborted: boolean): SourceLifecycleResult {
  const liveSources = (scan?.sources ?? []).flatMap(s => {
    const revision = s.status === "committed" ? s.committedRevision : s.status === "unchanged" ? s.reusedRevision : null;
    return revision === null ? [] : [Object.freeze({ sourceId: s.sourceId, provider: s.provider, revision })];
  });
  const incomplete = files.filter(s => !complete.has(s.status)).length;
  return Object.freeze({ mode: "explicit_source_lifecycle", status: aborted ? "aborted" : incomplete || scan?.status === "partial" ? "partial" : "completed",
    scan, files: Object.freeze([...files]), selectedInputs, unprocessedInputs: selectedInputs - files.length,
    liveSources: Object.freeze(liveSources), counts: Object.freeze({ collected: files.filter(s => s.status === "collected").length,
      markedUnavailable: files.filter(s => s.status === "marked_unavailable").length,
      alreadyUnavailable: files.filter(s => s.status === "already_unavailable").length,
      notStored: files.filter(s => s.status === "not_stored").length, incomplete }),
    retainedPayloads: true, directoryReconciliation: false, fullHistory: false,
    limitations: Object.freeze([
      "Only explicitly selected file paths were checked. Directory membership and unselected stored sources were not inferred.",
      "Unavailable source payloads remain stored; obsolete cache/checkpoints are invalidated. No records were deleted by retirement.",
      "Live source IDs describe successful collection receipts, not ongoing freshness or complete history.",
      "A move creates a separate source identity. Existing history requires explicit selection and retains its copy-conflict rules.",
      "Stable trusted ancestors are required. Filesystem observations and SQLite updates are not one atomic transaction.",
    ]) });
}
export function abortedSourceLifecycle(selectedInputs: number): SourceLifecycleResult {
  return finish(selectedInputs, [], null, true);
}

/** Internal coordinator: caller has preflighted all bounded explicit files before bootstrap. */
export async function reconcileSourceFiles(store: ReturnType<typeof createSourceStore>, context: IdentityContext,
  selected: readonly PreparedLifecycleFile[], signal: AbortSignal, usageTiming: boolean, patternEvidence = false): Promise<SourceLifecycleResult> {
  if (selected.length < 1 || selected.length > SCAN_LIMITS.roots || !(signal instanceof AbortSignal) || typeof usageTiming !== "boolean" || typeof patternEvidence !== "boolean") throw new SafeError("INVALID_ARGUMENT");
  if (signal.aborted) return abortedSourceLifecycle(selected.length);
  // Authenticate missing generations before any live-file writes. Retain no payload arrays.
  const files = selected.map((file, index) => {
    const sourceId = context.fingerprint("source", [file.provider, file.path]);
    const candidate = file.observation.presence === "missing" ? store.readSourceForIngestion(sourceId, context) : null;
    if (candidate?.source && candidate.source.provider !== file.provider) throw new SafeError("DATABASE_ACCESS_FAILED");
    return { file, sourceId, sourceAlias: `input-${index + 1}`, revision: candidate?.source?.revision ?? null,
      availability: candidate?.source?.availability ?? null, predecessor: candidate?.predecessor ?? null };
  });
  const live = files.filter(f => f.file.observation.presence === "present").map(f => ({ provider: f.file.provider, path: f.file.path }));
  const scan = live.length && !signal.aborted ? await scanSources(store, context, live, { signal, ...(usageTiming ? { usageTiming } : {}), ...(patternEvidence ? { patternEvidence } : {}) }) : null;
  const collected = new Map((scan?.sources ?? []).map(s => [s.sourceId, s]));
  const outcomes: LifecycleOutcome[] = [];
  let storageStopped = scan?.stopReason === "storage_failure";
  for (const selectedFile of files) {
    const { file, sourceId, sourceAlias, revision } = selectedFile;
    const common = { sourceId, sourceAlias, provider: file.provider, revisionBefore: revision,
      revisionAfter: null, reason: null, errorCode: null };
    if (file.observation.presence === "present") {
      const observed = collected.get(sourceId);
      if (!observed) outcomes.push(Object.freeze({ ...common, status: "skipped", reason: signal.aborted ? "aborted" : "collection_stopped" }));
      else outcomes.push(Object.freeze({ ...common,
        status: observed.status === "committed" || observed.status === "unchanged" ? "collected" : "collection_ineligible",
        revisionBefore: observed.expectedRevision, revisionAfter: observed.committedRevision ?? observed.reusedRevision,
        errorCode: observed.errorCode }));
      continue;
    }
    if (signal.aborted || storageStopped || scan?.stopReason != null) {
      outcomes.push(Object.freeze({ ...common, status: "skipped", reason: signal.aborted ? "aborted" : "collection_stopped" })); continue;
    }
    try {
      const now = await inspectLifecyclePath(file.path);
      if (signal.aborted) { outcomes.push(Object.freeze({ ...common, status: "skipped", reason: "aborted" })); continue; }
      if (now.presence === "present" || !sameLifecycleParent(now.parent, file.observation.parent)) {
        outcomes.push(Object.freeze({ ...common, status: "changed_during_check", reason: now.presence === "present" ? "reappeared" : "parent_changed" })); continue;
      }
      const current = store.readSourceForIngestion(sourceId, context);
      if ((current.source?.revision ?? null) !== revision) {
        outcomes.push(Object.freeze({ ...common, status: "stale", revisionAfter: current.source?.revision ?? null })); continue;
      }
      if (current.predecessor.generationDigest !== selectedFile.predecessor?.generationDigest
        || current.predecessor.checkpointSeal !== selectedFile.predecessor?.checkpointSeal) throw new SafeError("DATABASE_ACCESS_FAILED");
      if (current.source === null) { outcomes.push(Object.freeze({ ...common, status: "not_stored" })); continue; }
      if (current.source.provider !== file.provider) throw new SafeError("DATABASE_ACCESS_FAILED");
      if (current.source.availability === "unavailable") {
        outcomes.push(Object.freeze({ ...common, status: "already_unavailable", revisionAfter: current.source.revision })); continue;
      }
      // No await between final authenticated read and the existing revision-guarded write.
      const written = store.markUnavailable(sourceId, revision!, signal);
      outcomes.push(Object.freeze({ ...common,
        status: written.status === "committed" ? "marked_unavailable" : written.status === "stale" ? "stale" : "skipped",
        revisionAfter: written.status === "committed" ? written.revision : written.status === "stale" ? written.actualRevision : null,
        reason: written.status === "aborted" ? "aborted" : null }));
    } catch (error) {
      const code = safeErrorEnvelope(error).error.code;
      outcomes.push(Object.freeze({ ...common, status: "failed", errorCode: code }));
      if (code.startsWith("DATABASE_") || code === "INVALID_IDENTITY_KEY" || code === "INTERNAL_ERROR") storageStopped = true;
    }
  }
  return finish(selected.length, outcomes, scan, signal.aborted || scan?.status === "aborted");
}
