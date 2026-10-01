import { resolve } from "node:path";
import type { createSourceStore } from "../db/source-store.js";
import type { IdentityContext } from "../normalize/identity.js";
import { createCodexAdapter } from "../parsers/codex/index.js";
import { createClaudeAdapter } from "../parsers/claude/index.js";
import type { ParserCapabilities } from "../parsers/types.js";
import type { ClaudeCapabilities } from "../parsers/claude/types.js";
import { SafeError } from "../privacy/diagnostics.js";
import type { SafeDiagnostic } from "../privacy/diagnostics.js";
import { ownInput, readSourcePrefixWithProof, sourcePrefixOptions, validSourcePath } from "./source-prefix.js";
import type { SourcePrefixOptions } from "./source-prefix.js";

export type SourceIngestInput = SourcePrefixOptions & Readonly<{ path: string; provider: "codex" | "claude"; expectedRevision: number | null }>;
type IngestEvidence = Readonly<{
  sourceId: string; persistedScope: "events_and_metric_evidence"; aggregationReady: false; parserResumeReady: false;
  capabilities: ParserCapabilities | ClaudeCapabilities; diagnostics: readonly SafeDiagnostic[]; readerDiagnostics: readonly SafeDiagnostic[];
}>;
export type SourceIngestResult = IngestEvidence & Readonly<
  { status: "committed"; revision: number } | { status: "stale"; actualRevision: number | null }
  | { status: "aborted" } | { status: "rejected"; reason: "file_limit" | "record_limit" | "reader_error" | "input_changed" | "consumer_stopped" | "state_limit" }
>;

/** Internal bounded ingestion. Always reparse; evidence is stored without becoming aggregation-ready. */
export async function ingestSourceFile(store: ReturnType<typeof createSourceStore>, context: IdentityContext, input: SourceIngestInput): Promise<SourceIngestResult> {
  const value = ownInput(input, ["path", "provider", "expectedRevision", "maxFileBytes", "maxRecords", "maxLineBytes", "chunkBytes", "signal"]);
  const path = value["path"], provider = value["provider"], expectedRevision = value["expectedRevision"];
  validSourcePath(path);
  if (provider !== "codex" && provider !== "claude") throw new SafeError("INVALID_ARGUMENT");
  if (expectedRevision !== null && (typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) throw new SafeError("INVALID_ARGUMENT");
  const { maxFileBytes, maxRecords, maxLineBytes, chunkBytes, signal } = sourcePrefixOptions({ maxFileBytes: value["maxFileBytes"], maxRecords: value["maxRecords"], maxLineBytes: value["maxLineBytes"], chunkBytes: value["chunkBytes"], signal: value["signal"] });
  const options: SourcePrefixOptions = { maxFileBytes, maxRecords, maxLineBytes, chunkBytes, ...(signal === undefined ? {} : { signal }) };
  const fileIdentity = resolve(path), sourceId = context.fingerprint("source", [provider, fileIdentity]);
  const adapter = provider === "codex" ? createCodexAdapter(context) : createClaudeAdapter(context);
  let ordinal = 0;
  const prefix = await readSourcePrefixWithProof(fileIdentity, context, { sourceId, provider, parserVersion: adapter.snapshot().capabilities.parserVersion }, (entry) => {
    const batch = adapter.ingest(entry.value, { fileIdentity, sourceAlias: "source-1", byteOffset: entry.byteOffset, ordinal: ordinal++ });
    return !batch.capabilities.stateLimited && batch.capabilities.diagnosticsDropped === 0;
  }, options);
  const snapshot = adapter.snapshot();
  const evidence: IngestEvidence = Object.freeze({ sourceId, persistedScope: "events_and_metric_evidence", aggregationReady: false, parserResumeReady: false,
    capabilities: snapshot.capabilities, diagnostics: snapshot.diagnostics,
    readerDiagnostics: Object.freeze(prefix.status === "rejected" && prefix.diagnostic ? [prefix.diagnostic] : []) });
  if (signal?.aborted || prefix.status === "aborted") return Object.freeze({ ...evidence, status: "aborted" });
  if (snapshot.capabilities.stateLimited || snapshot.capabilities.diagnosticsDropped > 0) return Object.freeze({ ...evidence, status: "rejected", reason: "state_limit" });
  if (prefix.status === "rejected") return Object.freeze({ ...evidence, status: "rejected", reason: prefix.reason });
  const result = store.replaceSourceSnapshot({ sourceId, provider, parserVersion: snapshot.capabilities.parserVersion,
    normalizationVersion: context.normalizationVersion, keyVersion: context.keyVersion, keyId: context.keyId,
    completedOffset: prefix.completedOffset, observedSize: prefix.observedSize, boundaryFingerprint: prefix.boundaryFingerprint,
    cacheEvidence: { contractVersion: 1, contentFingerprint: prefix.contentFingerprint },
    events: snapshot.events, evidence: { turns: snapshot.turns, usage: snapshot.usage, observations: snapshot.observations,
      diagnostics: snapshot.diagnostics, capabilities: snapshot.capabilities } }, expectedRevision, signal);
  return Object.freeze({ ...evidence, ...result });
}
