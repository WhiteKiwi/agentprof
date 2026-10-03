import { adapterLimitsFingerprint, validateIngestionCandidate, validatePredecessor } from "../db/source-checkpoint-validation.js";
import { resolve } from "node:path";
import type { createSourceStore, SourceIngestionCandidate, SourceSnapshotInput } from "../db/source-store.js";
import type { IdentityContext } from "../normalize/identity.js";
import { CodexAdapter, createCodexAdapter } from "../parsers/codex/index.js";
import { ClaudeAdapter, createClaudeAdapter } from "../parsers/claude/index.js";
import type { ParserCapabilities } from "../parsers/types.js";
import type { ClaudeCapabilities } from "../parsers/claude/types.js";
import { SafeError } from "../privacy/diagnostics.js";
import type { SafeDiagnostic } from "../privacy/diagnostics.js";
import { ownInput, readSourcePrefixWithProof, readSourceSuffixWithProof, sourcePrefixOptions, validSourcePath } from "./source-prefix.js";
import type { ProvenSourcePrefixResult, SourcePrefixOptions } from "./source-prefix.js";

export type SourceIngestInput = SourcePrefixOptions & Readonly<{ path: string; provider: "codex" | "claude"; expectedRevision: number | null }>;
type IngestEvidence = Readonly<{
  sourceId: string; persistedScope: "events_and_metric_evidence"; aggregationReady: false; parserResumeReady: false;
  capabilities: ParserCapabilities | ClaudeCapabilities; diagnostics: readonly SafeDiagnostic[]; readerDiagnostics: readonly SafeDiagnostic[];
}>;
export type SourceIngestResult = IngestEvidence & Readonly<
  { status: "committed"; revision: number } | { status: "stale"; actualRevision: number | null }
  | { status: "aborted" } | { status: "rejected"; reason: "file_limit" | "record_limit" | "reader_error" | "input_changed" | "consumer_stopped" | "state_limit" }
>;

/** Explicit byte-zero ingestion; ordinary providers capture optional durable state. */
export async function ingestSourceFile(store: ReturnType<typeof createSourceStore>, context: IdentityContext, input: SourceIngestInput): Promise<SourceIngestResult> {
  return ingest(store, context, input);
}
/** Every candidate-derived path retains its original revision and predecessor. */
export async function ingestSourceFileFromCheckpoint(store: ReturnType<typeof createSourceStore>, context: IdentityContext, input: SourceIngestInput, candidate: SourceIngestionCandidate): Promise<SourceIngestResult> {
  return ingest(store, context, input, validateIngestionCandidate(candidate, context.keyId));
}
async function ingest(store: ReturnType<typeof createSourceStore>, context: IdentityContext, input: SourceIngestInput, candidate?: SourceIngestionCandidate): Promise<SourceIngestResult> {
  const value = ownInput(input, ["path", "provider", "expectedRevision", "maxFileBytes", "maxRecords", "maxLineBytes", "chunkBytes", "signal"]);
  const path = value["path"], provider = value["provider"], expectedRevision = value["expectedRevision"];
  validSourcePath(path);
  if (provider !== "codex" && provider !== "claude") throw new SafeError("INVALID_ARGUMENT");
  if (expectedRevision !== null && (typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) throw new SafeError("INVALID_ARGUMENT");
  const { maxFileBytes, maxRecords, maxLineBytes, chunkBytes, signal } = sourcePrefixOptions({ maxFileBytes: value["maxFileBytes"], maxRecords: value["maxRecords"], maxLineBytes: value["maxLineBytes"], chunkBytes: value["chunkBytes"], signal: value["signal"] });
  const options: SourcePrefixOptions = { maxFileBytes, maxRecords, maxLineBytes, chunkBytes, ...(signal === undefined ? {} : { signal }) };
  const fileIdentity = resolve(path), sourceId = context.fingerprint("source", [provider, fileIdentity]);
  let adapter = provider === "codex" ? createCodexAdapter(context) : createClaudeAdapter(context);
  const parserVersion = adapter.snapshot().capabilities.parserVersion;
  if (candidate !== undefined) {
    if (candidate.source !== null && (candidate.source.sourceId !== sourceId || candidate.source.provider !== provider
      || candidate.source.keyId !== context.keyId || candidate.source.revision !== expectedRevision)
      || candidate.source === null && expectedRevision !== null) throw new SafeError("INVALID_ARGUMENT");
    validatePredecessor(candidate.predecessor, context.keyId);
    if ((candidate.source === null) !== (candidate.predecessor.generationDigest === null)
      || candidate.predecessor.checkpointSeal !== (candidate.checkpoint?.generationSeal ?? null)) throw new SafeError("INVALID_ARGUMENT");
  }
  let ordinal = 0;
  const consume = (entry: { value: unknown; byteOffset: number }) => {
    const batch = adapter.ingest(entry.value, { fileIdentity, sourceAlias: "source-1", byteOffset: entry.byteOffset, ordinal: ordinal++ });
    return !batch.capabilities.stateLimited && batch.capabilities.diagnosticsDropped === 0;
  };
  const contract = { sourceId, provider, parserVersion } as const, old = candidate?.source, checkpoint = candidate?.checkpoint;
  let prefix: ProvenSourcePrefixResult;
  if (old && checkpoint && old.parserVersion === parserVersion && checkpoint.adapterLimitsFingerprint === adapterLimitsFingerprint(provider)
    && checkpoint.maxFileBytes === maxFileBytes && checkpoint.maxRecords === maxRecords && checkpoint.maxLineBytes === maxLineBytes) {
    if (old.cacheEvidence === null || old.availability !== "available") throw new SafeError("DATABASE_ACCESS_FAILED");
    const binding = { sourceId, completedOffset: old.completedOffset, nextOrdinal: checkpoint.nextOrdinal };
    const restored = provider === "codex" ? CodexAdapter.restoreCheckpoint(context, checkpoint.checkpoint, binding)
      : ClaudeAdapter.restoreCheckpoint(context, checkpoint.checkpoint, binding);
    if (restored.status !== "restored") throw new SafeError("DATABASE_ACCESS_FAILED");
    adapter = restored.adapter; ordinal = checkpoint.nextOrdinal;
    const suffix = await readSourceSuffixWithProof(fileIdentity, context, { ...contract, completedOffset: old.completedOffset, observedSize: old.observedSize,
      boundaryFingerprint: old.boundaryFingerprint, contentFingerprint: old.cacheEvidence.contentFingerprint, nextOrdinal: checkpoint.nextOrdinal,
      maxFileBytes: checkpoint.maxFileBytes, maxRecords: checkpoint.maxRecords, maxLineBytes: checkpoint.maxLineBytes }, consume, options);
    if (suffix.status === "corrupt_checkpoint") throw new SafeError("DATABASE_ACCESS_FAILED");
    if (suffix.status === "mismatch") {
      adapter = provider === "codex" ? createCodexAdapter(context) : createClaudeAdapter(context); ordinal = 0;
      prefix = await readSourcePrefixWithProof(fileIdentity, context, contract, consume, options);
    } else prefix = suffix;
  } else prefix = await readSourcePrefixWithProof(fileIdentity, context, contract, consume, options);
  const snapshot = adapter.snapshot();
  const evidence: IngestEvidence = Object.freeze({ sourceId, persistedScope: "events_and_metric_evidence", aggregationReady: false, parserResumeReady: false,
    capabilities: snapshot.capabilities, diagnostics: snapshot.diagnostics,
    readerDiagnostics: Object.freeze(prefix.status === "rejected" && prefix.diagnostic ? [prefix.diagnostic] : []) });
  if (signal?.aborted || prefix.status === "aborted") return Object.freeze({ ...evidence, status: "aborted" });
  if (snapshot.capabilities.stateLimited || snapshot.capabilities.diagnosticsDropped > 0) return Object.freeze({ ...evidence, status: "rejected", reason: "state_limit" });
  if (prefix.status === "rejected") return Object.freeze({ ...evidence, status: "rejected", reason: prefix.reason });
  const sourceInput: SourceSnapshotInput = { sourceId, provider, parserVersion: snapshot.capabilities.parserVersion,
    normalizationVersion: context.normalizationVersion, keyVersion: context.keyVersion, keyId: context.keyId,
    completedOffset: prefix.completedOffset, observedSize: prefix.observedSize, boundaryFingerprint: prefix.boundaryFingerprint,
    cacheEvidence: { contractVersion: 1 as const, contentFingerprint: prefix.contentFingerprint },
    relationshipEvidence: "wrappers" in snapshot
      ? { contractVersion: 1 as const, capturePolicyVersion: 1, status: "captured" as const, provider: "codex" as const, metadata: snapshot.metadata, wrappers: snapshot.wrappers }
      : { contractVersion: 1 as const, capturePolicyVersion: 1, status: "captured" as const, provider: "claude" as const, metadata: snapshot.metadata, messages: snapshot.messages },
    events: snapshot.events, evidence: { turns: snapshot.turns, usage: snapshot.usage, observations: snapshot.observations,
      diagnostics: snapshot.diagnostics, capabilities: snapshot.capabilities } };
  const exported = adapter.exportCheckpoint({ sourceId, completedOffset: prefix.completedOffset, nextOrdinal: ordinal });
  const capture = exported.status === "captured" ? { checkpoint: exported.checkpoint, nextOrdinal: ordinal, maxFileBytes, maxRecords, maxLineBytes } : null;
  // Optional capture failure never bypasses the originally observed generation CAS.
  const result = store.replaceSourceSnapshotWithCheckpoint(sourceInput, capture, context, expectedRevision, candidate?.predecessor, signal);
  return Object.freeze({ ...evidence, ...result });
}
