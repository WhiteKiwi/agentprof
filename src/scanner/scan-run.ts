import { captureMode } from "../parsers/capture.js";
import { adapterLimitsFingerprint } from "../db/source-checkpoint-validation.js";
import { relationshipCurrent, relationshipFingerprint } from "../db/source-relationship-validation.js";
import { resolve } from "node:path";
import type { createSourceStore, SourceCacheToken, StoredSource, SourceIngestionCandidate } from "../db/source-store.js";
import type { IdentityContext } from "../normalize/identity.js";
import { createCodexAdapter } from "../parsers/codex/index.js";
import { createClaudeAdapter } from "../parsers/claude/index.js";
import { diagnostic, SafeError, safeErrorEnvelope } from "../privacy/diagnostics.js";
import type { DiagnosticCode, SafeDiagnostic } from "../privacy/diagnostics.js";
import type { InputRoot } from "../privacy/paths.js";
import { discoverSources } from "./discovery.js";
import { ingestSourceFile, ingestSourceFileFromCheckpoint } from "./source-ingest.js";
import type { SourceIngestResult } from "./source-ingest.js";
import { ownInput, probeSourceFile, sourcePrefixOptions, validSourcePath } from "./source-prefix.js";

export const SCAN_LIMITS = Object.freeze({ roots: 16, sources: 64, directories: 256, entries: 4096, fileBytes: 16 * 1024 * 1024, records: 32768, diagnostics: 256 });
export type ScanOptions = Readonly<{
  maxSources?: number; maxDirectories?: number; maxEntries?: number; maxFileBytes?: number;
  maxRecords?: number; maxDiagnostics?: number; maxLineBytes?: number; chunkBytes?: number; signal?: AbortSignal; usageTiming?: boolean; patternEvidence?: boolean;
}>;
export type ScanSourceOutcome = Readonly<{
  sourceId: string; sourceAlias: string; provider: InputRoot["provider"];
  status: SourceIngestResult["status"] | "unchanged" | "failed";
  revisionRead: boolean; expectedRevision: number | null; committedRevision: number | null; reusedRevision: number | null; staleActualRevision: number | null;
  rejectionReason: Extract<SourceIngestResult, { status: "rejected" }>["reason"] | null;
  errorCode: DiagnosticCode | null;
  ingestionScope: SourceIngestResult["persistedScope"] | null;
  capabilities: SourceIngestResult["capabilities"] | null;
}>;
export type ScanResult = Readonly<{
  status: "completed" | "partial" | "aborted";
  stopReason: "aborted" | "storage_failure" | "discovery_limit" | null;
  discoveryTruncated: boolean;
  sources: readonly ScanSourceOutcome[];
  counts: Readonly<{ discovered: number; attempted: number; committed: number; unchanged: number; rejected: number; stale: number; failed: number; aborted: number; duplicates: number }>;
  diagnostics: Readonly<{ observedCount: number; adapterDroppedCount: number; sampleDroppedCount: number; samples: readonly SafeDiagnostic[] }>;
  aggregationReady: false; parserResumeReady: false;
}>;
function ceiling(value: unknown, maximum: number, zero = false): number {
  if (value === undefined) return maximum;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < (zero ? 0 : 1) || value > maximum) throw new SafeError("INVALID_ARGUMENT");
  return value;
}
function explicitRoots(value: readonly InputRoot[]): readonly InputRoot[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < 1 || value.length > SCAN_LIMITS.roots) throw new SafeError("INVALID_ARGUMENT");
  const entries = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(entries).length !== value.length + 1) throw new SafeError("INVALID_ARGUMENT");
  const result: InputRoot[] = [], seen = new Set<string>();
  for (let i = 0; i < value.length; i++) {
    const descriptor = entries[String(i)];
    if (!descriptor || !("value" in descriptor)) throw new SafeError("INVALID_ARGUMENT");
    const root = ownInput(descriptor.value, ["provider", "path"]), provider = root["provider"];
    if (provider !== "codex" && provider !== "claude") throw new SafeError("INVALID_ARGUMENT");
    validSourcePath(root["path"]);
    const path = resolve(root["path"]), key = JSON.stringify([provider, path]);
    if (!seen.has(key)) { seen.add(key); result.push(Object.freeze({ provider, path })); }
  }
  return Object.freeze(result);
}

// Retain only the small validated candidate, releasing initial event/metric payload arrays.
function cacheCandidate(source: StoredSource | null, context: IdentityContext, parserVersion: number): SourceCacheToken | null {
  if (!source || !relationshipCurrent(source.relationshipEvidence) || !source.cacheEvidence || !source.evidence || source.availability !== "available" || source.persistedScope !== "events_and_metric_evidence"
    || source.parserVersion !== parserVersion || source.normalizationVersion !== context.normalizationVersion || source.keyVersion !== context.keyVersion || source.keyId !== context.keyId
    || source.evidence.capabilities.stateLimited || source.evidence.capabilities.diagnosticsDropped !== 0) return null;
  return Object.freeze({ sourceId: source.sourceId, provider: source.provider, revision: source.revision, parserVersion: source.parserVersion,
    normalizationVersion: source.normalizationVersion, keyVersion: source.keyVersion, keyId: source.keyId, completedOffset: source.completedOffset,
    observedSize: source.observedSize, boundaryFingerprint: source.boundaryFingerprint, cacheEvidence: source.cacheEvidence, relationshipFingerprint: relationshipFingerprint(source.relationshipEvidence)! });
}

/** Bounded serial coordination only. Source commits are independent, never a whole-run transaction. */
export async function scanSources(store: ReturnType<typeof createSourceStore>, context: IdentityContext, roots: readonly InputRoot[], options: ScanOptions = {}): Promise<ScanResult> {
  const selectedRoots = explicitRoots(roots);
  const v = ownInput(options, ["maxSources", "maxDirectories", "maxEntries", "maxFileBytes", "maxRecords", "maxDiagnostics", "maxLineBytes", "chunkBytes", "signal", "usageTiming", "patternEvidence"]);
  const mode = captureMode({ ...(v["usageTiming"] === undefined ? {} : { usageTiming: v["usageTiming"] as boolean }), ...(v["patternEvidence"] === undefined ? {} : { patternEvidence: v["patternEvidence"] as boolean }) });
  const maxSources = ceiling(v["maxSources"], SCAN_LIMITS.sources), maxDirectories = ceiling(v["maxDirectories"], SCAN_LIMITS.directories), maxEntries = ceiling(v["maxEntries"], SCAN_LIMITS.entries);
  const maxDiagnostics = ceiling(v["maxDiagnostics"], SCAN_LIMITS.diagnostics, true);
  const prefix = sourcePrefixOptions({ maxFileBytes: ceiling(v["maxFileBytes"], SCAN_LIMITS.fileBytes), maxRecords: ceiling(v["maxRecords"], SCAN_LIMITS.records),
    maxLineBytes: v["maxLineBytes"], chunkBytes: v["chunkBytes"], signal: v["signal"] });
  const { signal } = prefix;
  const outcomes: ScanSourceOutcome[] = [], seen = new Set<string>(), samples: SafeDiagnostic[] = [];
  const counts = { discovered: 0, attempted: 0, committed: 0, unchanged: 0, rejected: 0, stale: 0, failed: 0, aborted: 0, duplicates: 0 };
  let observedCount = 0, adapterDroppedCount = 0, yieldedEntries = 0, partial = false, aborted = false, discoveryTruncated = false;
  let stopReason: ScanResult["stopReason"] = null;
  const record = (value: SafeDiagnostic, alias?: string) => {
    observedCount++;
    if (samples.length < maxDiagnostics) samples.push(Object.freeze({ code: value.code, severity: value.severity, sourceAlias: alias ?? value.sourceAlias, byteOffset: value.byteOffset }));
  };
  if (signal?.aborted) { aborted = true; stopReason = "aborted"; }
  else for await (const entry of discoverSources(selectedRoots, { maxFiles: maxSources, maxDirectories, maxEntries })) {
    if (signal?.aborted) { aborted = true; stopReason = "aborted"; break; }
    if (++yieldedEntries > maxEntries) {
      // Discovery can yield immediate symlink diagnostics outside its node counter.
      // Account for the one observed overflow entry, but never start its ingestion.
      if (entry.kind === "diagnostic") record(entry.diagnostic); else counts.discovered++;
      if (entry.kind !== "diagnostic" || entry.diagnostic.code !== "DISCOVERY_LIMIT") record(diagnostic("DISCOVERY_LIMIT"));
      partial = true; discoveryTruncated = true; stopReason = "discovery_limit"; break;
    }
    if (entry.kind === "diagnostic") {
      record(entry.diagnostic); partial = true;
      if (entry.diagnostic.code === "DISCOVERY_LIMIT") { discoveryTruncated = true; stopReason = "discovery_limit"; }
      continue;
    }
    counts.discovered++;
    const source = entry.source, path = resolve(source.path), sourceId = context.fingerprint("source", [source.provider, path]);
    if (seen.has(sourceId)) { counts.duplicates++; continue; }
    seen.add(sourceId); counts.attempted++;
    let expectedRevision: number | null = null, revisionRead = false;
    const common = { sourceId, sourceAlias: source.sourceAlias, provider: source.provider };
    try {
      let candidate: SourceCacheToken | null, ingestionCandidate: SourceIngestionCandidate | undefined;
      const currentParserVersion = (source.provider === "codex" ? createCodexAdapter(context, {}, mode) : createClaudeAdapter(context, {}, mode)).snapshot().capabilities.parserVersion;
      {
        ingestionCandidate = store.readSourceForIngestion(sourceId, context);
        const stored = ingestionCandidate ? ingestionCandidate.source : store.readSource(sourceId);
        expectedRevision = stored?.revision ?? null; revisionRead = true;
        candidate = cacheCandidate(stored, context, currentParserVersion);
        const checkpoint = ingestionCandidate?.checkpoint;
        // File proofs bind scanner options, but not the adapter's private limits.
        // Authenticate first in readSourceForIngestion; incompatibility then replays.
        if (checkpoint && (checkpoint.adapterLimitsFingerprint !== adapterLimitsFingerprint(source.provider)
          || checkpoint.maxFileBytes !== prefix.maxFileBytes || checkpoint.maxRecords !== prefix.maxRecords
          || checkpoint.maxLineBytes !== prefix.maxLineBytes)) candidate = null;
      }
      if (candidate) {
        const probe = await probeSourceFile(path, context, { sourceId, provider: source.provider, parserVersion: currentParserVersion,
          observedSize: candidate.observedSize, contentFingerprint: candidate.cacheEvidence.contentFingerprint },
          { maxFileBytes: prefix.maxFileBytes, maxRecords: prefix.maxRecords, maxLineBytes: prefix.maxLineBytes, chunkBytes: prefix.chunkBytes, ...(signal === undefined ? {} : { signal }) });
        if (probe.status !== "mismatch") {
          // Final successful generation confirmation is synchronous; no await before recording it.
          const confirmed = probe.status === "matched" ? (ingestionCandidate
            ? store.confirmUnchangedSourceWithCheckpoint(candidate, ingestionCandidate.predecessor, context, signal)
            : store.confirmUnchangedSource(candidate, signal)) : probe;
          const capabilities = confirmed.status === "unchanged" ? confirmed.capabilities : null;
          if (confirmed.status === "unchanged") for (const value of confirmed.diagnostics) record(value, source.sourceAlias);
          if (confirmed.status === "rejected" && confirmed.diagnostic) record(confirmed.diagnostic, source.sourceAlias);
          counts[confirmed.status]++;
          outcomes.push(Object.freeze({ ...common, revisionRead, expectedRevision, status: confirmed.status, committedRevision: null,
            reusedRevision: confirmed.status === "unchanged" ? confirmed.reusedRevision : null,
            staleActualRevision: confirmed.status === "stale" ? confirmed.actualRevision : null,
            rejectionReason: confirmed.status === "rejected" ? confirmed.reason : null, errorCode: null,
            ingestionScope: confirmed.status === "unchanged" ? "events_and_metric_evidence" : null, capabilities }));
          if (confirmed.status !== "unchanged" || capabilities?.coverage === "partial") partial = true;
          if (confirmed.status === "aborted" || signal?.aborted) { aborted = true; stopReason = "aborted"; break; }
          continue;
        }
      }
      const input = { path, provider: source.provider, expectedRevision, ...(mode.usageTiming ? mode : {}),
        maxFileBytes: prefix.maxFileBytes, maxRecords: prefix.maxRecords, maxLineBytes: prefix.maxLineBytes, chunkBytes: prefix.chunkBytes,
        ...(signal === undefined ? {} : { signal }) };
      const result = ingestionCandidate ? await ingestSourceFileFromCheckpoint(store, context, input, ingestionCandidate) : await ingestSourceFile(store, context, input);
      for (const value of [...result.diagnostics, ...result.readerDiagnostics]) record(value, source.sourceAlias);
      adapterDroppedCount += result.capabilities.diagnosticsDropped;
      counts[result.status]++;
      outcomes.push(Object.freeze({ ...common, revisionRead, expectedRevision, status: result.status,
        reusedRevision: null, committedRevision: result.status === "committed" ? result.revision : null, staleActualRevision: result.status === "stale" ? result.actualRevision : null,
        rejectionReason: result.status === "rejected" ? result.reason : null, errorCode: null, ingestionScope: result.persistedScope, capabilities: result.capabilities }));
      if (result.status !== "committed" || result.capabilities.coverage === "partial" || result.capabilities.stateLimited || result.capabilities.diagnosticsDropped > 0) partial = true;
      if (result.status === "aborted" || signal?.aborted) { aborted = true; stopReason = "aborted"; break; }
    } catch (error) {
      const code = safeErrorEnvelope(error).error.code;
      record(diagnostic(code, source.sourceAlias)); partial = true; counts.failed++;
      outcomes.push(Object.freeze({ ...common, revisionRead, expectedRevision, status: "failed", committedRevision: null, reusedRevision: null, staleActualRevision: null,
        rejectionReason: null, errorCode: code, ingestionScope: null, capabilities: null }));
      if (signal?.aborted) { aborted = true; stopReason = "aborted"; break; }
      if (!revisionRead || code.startsWith("DATABASE_") || code === "INVALID_IDENTITY_KEY" || code === "INTERNAL_ERROR") { stopReason = "storage_failure"; break; }
    }
  }
  if (signal?.aborted && !aborted) { aborted = true; stopReason = "aborted"; }
  return Object.freeze({ status: aborted ? "aborted" : partial ? "partial" : "completed", stopReason, discoveryTruncated, sources: Object.freeze(outcomes), counts: Object.freeze(counts),
    diagnostics: Object.freeze({ observedCount, adapterDroppedCount, sampleDroppedCount: observedCount - samples.length, samples: Object.freeze(samples) }), aggregationReady: false, parserResumeReady: false });
}
