import { checkpointVersionSupported, hasUsageTiming } from "../parsers/capture.js";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Hash } from "node:crypto";
import { types } from "node:util";
import type { DatabaseSync } from "node:sqlite";
import type { IdentityContext } from "../normalize/identity.js";
import { ClaudeAdapter, createClaudeAdapter, DEFAULT_CLAUDE_LIMITS } from "../parsers/claude/index.js";
import { decodeClaudeCheckpoint, MAX_CLAUDE_CHECKPOINT_BYTES } from "../parsers/claude/checkpoint.js";
import { CodexAdapter, createCodexAdapter, DEFAULT_CODEX_LIMITS } from "../parsers/codex/index.js";
import { decodeCodexCheckpoint, MAX_CODEX_CHECKPOINT_BYTES } from "../parsers/codex/checkpoint.js";
import { SafeError } from "../privacy/diagnostics.js";
import { MAX_LINE_BYTES } from "../scanner/jsonl.js";
import { MAX_SOURCE_FILE_BYTES, MAX_SOURCE_RECORDS } from "../scanner/source-prefix.js";
import { encodeSourceSnapshot } from "./source-metric-validation.js";
import { validateCacheEvidence } from "./source-cache-validation.js";
import { relationshipCurrent } from "./source-relationship-validation.js";
import type { StoredSource } from "./source-store.js";
import { fields, HEADER_FIELDS, identity, integer, invalid, validateHeader } from "./source-validation.js";
import type { SourceHeaderInput } from "./source-validation.js";

export type SourceCheckpointCapture = Readonly<{ checkpoint: string; nextOrdinal: number; maxFileBytes: number; maxRecords: number; maxLineBytes: number }>;
export type SourceCheckpoint = SourceCheckpointCapture & Readonly<{ contractVersion: 1; checkpointBytes: number; adapterLimitsFingerprint: string; generationSeal: string }>;
export type SourcePredecessor = Readonly<{ checkpointSeal: string | null; generationDigest: string | null }>;
export type SourceIngestionCandidate = Readonly<{ source: StoredSource | null; checkpoint: SourceCheckpoint | null; predecessor: SourcePredecessor }>;
type EncodedSnapshot = ReturnType<typeof encodeSourceSnapshot>;
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
export function newProjection(): Hash { return createHash("sha256").update("agentprof.source-projection/v1\n"); }
export function projectionFrame(digest: Hash | undefined, kind: string, ordinal: string | number | null, id: string | null, json: string): void {
  digest?.update(JSON.stringify([kind, ordinal, id, json]) + "\n", "utf8");
}
/** Exact canonical strings used for insertion, streamed in the persisted order. */
export function encodedProjection(encoded: EncodedSnapshot): string {
  const digest = newProjection();
  for (const row of [...encoded.rows].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) projectionFrame(digest, "event", row.id, row.id, row.json);
  const compare = (a: { kind: string; ordinal: number }, b: { kind: string; ordinal: number }) => a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.ordinal - b.ordinal;
  for (const row of [...encoded.metrics.rows].sort(compare)) projectionFrame(digest, row.kind, row.ordinal, row.id, row.json);
  const r = encoded.relationships, e = r?.evidence;
  projectionFrame(digest, "relationship_header", null, null, JSON.stringify(r && e ? [e.contractVersion, e.capturePolicyVersion, e.status, e.status === "unavailable" ? e.reason : null, r.counts.metadata, r.counts.wrapper, r.counts.message, r.bytes] : null));
  if (r) for (const row of [...r.rows].sort(compare)) projectionFrame(digest, row.kind, row.ordinal, row.id, row.json);
  return digest.digest("hex");
}
type SourceProvider = SourceHeaderInput["provider"];
export function adapterLimitsFingerprint(provider: SourceProvider = "claude"): string {
  return provider === "codex" ? sha(JSON.stringify(["agentprof.codex-limits/v1", Object.entries(DEFAULT_CODEX_LIMITS)]))
    : sha(JSON.stringify(["agentprof.claude-limits/v1", Object.entries(DEFAULT_CLAUDE_LIMITS)]));
}
function checkpointMaximum(provider: SourceProvider): number { return provider === "codex" ? MAX_CODEX_CHECKPOINT_BYTES : MAX_CLAUDE_CHECKPOINT_BYTES; }
function compatibleParser(context: IdentityContext, provider: SourceProvider, version: number): boolean {
  if (!checkpointVersionSupported(provider, version)) return false;
  const mode = { usageTiming: hasUsageTiming(provider, version) };
  return (provider === "codex" ? createCodexAdapter(context, {}, mode) : createClaudeAdapter(context, {}, mode))
    .snapshot().capabilities.parserVersion === version;
}
function boundedInteger(value: unknown, maximum: number, minimum = 0): number {
  const result = integer(value, minimum);
  if (Object.is(result, -0) || result > maximum) invalid();
  return result;
}
function hex(value: unknown): string { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) invalid(); return value; }
export function validatePredecessor(value: unknown, keyId: string): SourcePredecessor {
  if (types.isProxy(value)) invalid();
  const v = fields(value, ["checkpointSeal", "generationDigest"]);
  const checkpointSeal = v["checkpointSeal"] === null ? null : identity(v["checkpointSeal"], "source", keyId);
  const generationDigest = v["generationDigest"] === null ? null : hex(v["generationDigest"]);
  if (generationDigest === null && checkpointSeal !== null) invalid();
  return Object.freeze({ checkpointSeal, generationDigest });
}
/** Reject executable envelope shells before an exported internal helper reads them. */
export function validateIngestionCandidate(value: unknown, keyId: string): SourceIngestionCandidate {
  const own = (input: unknown, names: readonly string[]) => { if (types.isProxy(input)) invalid(); return fields(input, names); };
  const v = own(value, ["source", "checkpoint", "predecessor"]);
  let source: StoredSource | null = null;
  if (v["source"] !== null) {
    const s = own(v["source"], [...HEADER_FIELDS, "revision", "availability", "events", "relationshipEvidence", "cacheEvidence", "evidence", "persistedScope", "aggregationReady", "parserResumeReady"]);
    const header: Record<string, unknown> = {};
    for (const name of HEADER_FIELDS) header[name] = s[name];
    validateHeader(header, keyId); boundedInteger(s["revision"], Number.MAX_SAFE_INTEGER, 1);
    if (s["availability"] !== "available" && s["availability"] !== "unavailable" || s["aggregationReady"] !== false || s["parserResumeReady"] !== false
      || s["persistedScope"] !== "events_only" && s["persistedScope"] !== "events_and_metric_evidence" || !Array.isArray(s["events"])
      || types.isProxy(s["events"]) || types.isProxy(s["evidence"]) || types.isProxy(s["relationshipEvidence"])) invalid();
    const cacheEvidence = s["cacheEvidence"] === null ? null : validateCacheEvidence(own(s["cacheEvidence"], ["contractVersion", "contentFingerprint"]), keyId);
    source = Object.freeze({ ...s, cacheEvidence }) as StoredSource;
  }
  let checkpoint: SourceCheckpoint | null = null;
  if (v["checkpoint"] !== null) {
    const c = own(v["checkpoint"], ["checkpoint", "nextOrdinal", "maxFileBytes", "maxRecords", "maxLineBytes", "contractVersion", "checkpointBytes", "adapterLimitsFingerprint", "generationSeal"]);
    if (source === null) invalid();
    const capture = captureFields({checkpoint:c["checkpoint"], nextOrdinal:c["nextOrdinal"], maxFileBytes:c["maxFileBytes"], maxRecords:c["maxRecords"], maxLineBytes:c["maxLineBytes"]}, source.provider);
    if (c["contractVersion"] !== 1 || c["checkpointBytes"] !== Buffer.byteLength(capture.checkpoint) || source === null) invalid();
    checkpoint = Object.freeze({...capture, contractVersion:1, checkpointBytes:Buffer.byteLength(capture.checkpoint), adapterLimitsFingerprint:hex(c["adapterLimitsFingerprint"]), generationSeal:identity(c["generationSeal"], "source", keyId)});
  }
  const predecessor = validatePredecessor(v["predecessor"], keyId);
  return Object.freeze({ source, checkpoint, predecessor });
}
export function generationObservation(source: StoredSource | null, projection: string | null): string | null {
  if (source === null) return null;
  return sha(JSON.stringify(["agentprof.source-generation-observation/v1", source.sourceId, source.provider, source.parserVersion, source.normalizationVersion,
    source.keyVersion, source.keyId, source.revision, source.availability, source.completedOffset, source.observedSize, source.boundaryFingerprint,
    source.cacheEvidence?.contractVersion ?? null, source.cacheEvidence?.contentFingerprint ?? null, projection]));
}
function captureFields(value: unknown, provider: SourceProvider): SourceCheckpointCapture {
  if (types.isProxy(value)) invalid();
  const v = fields(value, ["checkpoint", "nextOrdinal", "maxFileBytes", "maxRecords", "maxLineBytes"]);
  const checkpoint = v["checkpoint"], nextOrdinal = boundedInteger(v["nextOrdinal"], MAX_SOURCE_RECORDS), maxRecords = boundedInteger(v["maxRecords"], MAX_SOURCE_RECORDS, 1);
  if (typeof checkpoint !== "string" || checkpoint.length === 0 || Buffer.byteLength(checkpoint) > checkpointMaximum(provider) || nextOrdinal > maxRecords) invalid();
  return Object.freeze({ checkpoint, nextOrdinal, maxRecords, maxFileBytes: boundedInteger(v["maxFileBytes"], MAX_SOURCE_FILE_BYTES, 1), maxLineBytes: boundedInteger(v["maxLineBytes"], MAX_LINE_BYTES, 1) });
}
function requireGeneration(source: SourceHeaderInput, hasEvidence: boolean, cache: unknown, currentRelationships: boolean): void {
  if ((source.provider !== "claude" && source.provider !== "codex") || !hasEvidence || !cache || !currentRelationships) invalid();
}
/** Current-compatible tokens are decoded strictly and must project to this generation. */
export function restoreSourceCheckpoint(context: IdentityContext, source: SourceHeaderInput, capture: SourceCheckpointCapture, projection: string): ClaudeAdapter | CodexAdapter {
  const binding = { sourceId: source.sourceId, completedOffset: source.completedOffset, nextOrdinal: capture.nextOrdinal };
  if (!compatibleParser(context, source.provider, source.parserVersion)) invalid();
  const currentVersion = source.parserVersion, mode = { usageTiming: hasUsageTiming(source.provider, source.parserVersion) };
  const decoded = source.provider === "codex"
    ? decodeCodexCheckpoint(context, capture.checkpoint, binding, DEFAULT_CODEX_LIMITS, currentVersion)
    : decodeClaudeCheckpoint(context, capture.checkpoint, binding, DEFAULT_CLAUDE_LIMITS, currentVersion);
  const p = decoded.position;
  if (p.recordCount !== capture.nextOrdinal || (p.recordCount === 0 ? p.firstOrdinal !== null || p.lastOrdinal !== null || p.lastByteOffset !== null
    : p.firstOrdinal !== 0 || p.lastOrdinal !== capture.nextOrdinal - 1)) invalid();
  const restored = source.provider === "codex" ? CodexAdapter.restoreCheckpoint(context, capture.checkpoint, binding, {}, mode)
    : ClaudeAdapter.restoreCheckpoint(context, capture.checkpoint, binding, {}, mode);
  if (restored.status !== "restored") invalid();
  const snapshot = restored.adapter.snapshot();
  const encoded = encodeSourceSnapshot({ ...source, events: snapshot.events,
    evidence: { turns: snapshot.turns, usage: snapshot.usage, observations: snapshot.observations, diagnostics: snapshot.diagnostics, capabilities: snapshot.capabilities },
    relationshipEvidence: "wrappers" in snapshot
      ? { contractVersion: 1, capturePolicyVersion: 1, status: "captured", provider: "codex", metadata: snapshot.metadata, wrappers: snapshot.wrappers }
      : { contractVersion: 1, capturePolicyVersion: 1, status: "captured", provider: "claude", metadata: snapshot.metadata, messages: snapshot.messages } }, context.keyId);
  if (encodedProjection(encoded) !== projection) invalid();
  return restored.adapter;
}
function headerOnly(source: SourceHeaderInput): SourceHeaderInput {
  return { sourceId: source.sourceId, provider: source.provider, parserVersion: source.parserVersion, normalizationVersion: source.normalizationVersion,
    keyVersion: source.keyVersion, keyId: source.keyId, completedOffset: source.completedOffset, observedSize: source.observedSize, boundaryFingerprint: source.boundaryFingerprint };
}
export function validateCapture(value: unknown, encoded: EncodedSnapshot, context: IdentityContext): SourceCheckpointCapture {
  const h = encoded.header, capture = captureFields(value, h.provider);
  requireGeneration(h, true, encoded.cacheEvidence, relationshipCurrent(encoded.relationships?.evidence));
  if (!compatibleParser(context, h.provider, h.parserVersion) || h.observedSize > capture.maxFileBytes) invalid();
  restoreSourceCheckpoint(context, h, capture, encodedProjection(encoded));
  return capture;
}
export function generationSeal(context: IdentityContext, source: SourceHeaderInput, revision: number, proof: NonNullable<StoredSource["cacheEvidence"]>, capture: SourceCheckpointCapture, limits: string, projection: string): string {
  return context.fingerprint("source", [source.provider === "codex" ? "agentprof.codex-source-generation/v1" : "agentprof.claude-source-generation/v1", sha(JSON.stringify([1, source.sourceId, source.provider, source.parserVersion,
    source.normalizationVersion, source.keyVersion, source.keyId, revision, source.completedOffset, source.observedSize, source.boundaryFingerprint,
    proof.contractVersion, proof.contentFingerprint, capture.nextOrdinal, capture.maxFileBytes, capture.maxRecords, capture.maxLineBytes,
    Buffer.byteLength(capture.checkpoint), sha(capture.checkpoint), limits, projection]))]);
}
/** Called only within the source's pinned transaction, after bounded public-row validation. */
export function readCheckpoint(database: DatabaseSync, sourceId: string, source: StoredSource | null, projection: string | null, context: IdentityContext): SourceCheckpoint | null {
  const scalars = ["contract_version", "next_ordinal", "max_file_bytes", "max_records", "max_line_bytes", "checkpoint_bytes"].map(name => `CASE WHEN typeof(${name})='integer' THEN ${name} ELSE NULL END AS ${name}`);
  const rows = database.prepare(`SELECT ${scalars.join(",")},
    typeof(checkpoint_json) AS payload_type, length(CAST(checkpoint_json AS BLOB)) AS actual_bytes,
    CASE WHEN typeof(adapter_limits_fingerprint)='text' AND length(CAST(adapter_limits_fingerprint AS BLOB))=64 THEN adapter_limits_fingerprint ELSE NULL END AS adapter_limits_fingerprint,
    CASE WHEN typeof(generation_seal)='text' AND length(CAST(generation_seal AS BLOB))<=128 THEN generation_seal ELSE NULL END AS generation_seal
    FROM source_parser_checkpoints WHERE source_id=? LIMIT 2`).all(sourceId);
  if (rows.length === 0) return null;
  if (rows.length !== 1 || source === null || source.availability !== "available") invalid();
  requireGeneration(source, source.evidence !== null && source.persistedScope === "events_and_metric_evidence", source.cacheEvidence, relationshipCurrent(source.relationshipEvidence));
  const r = rows[0]!;
  if (r["contract_version"] !== 1 || r["payload_type"] !== "text") invalid();
  const checkpointBytes = boundedInteger(r["checkpoint_bytes"], checkpointMaximum(source.provider), 1);
  if (r["actual_bytes"] !== checkpointBytes) invalid();
  const nextOrdinal = boundedInteger(r["next_ordinal"], MAX_SOURCE_RECORDS), maxRecords = boundedInteger(r["max_records"], MAX_SOURCE_RECORDS, 1);
  const maxFileBytes = boundedInteger(r["max_file_bytes"], MAX_SOURCE_FILE_BYTES, 1), maxLineBytes = boundedInteger(r["max_line_bytes"], MAX_LINE_BYTES, 1);
  if (nextOrdinal > maxRecords || source.observedSize > maxFileBytes) invalid();
  const limits = hex(r["adapter_limits_fingerprint"]), seal = identity(r["generation_seal"], "source", context.keyId);
  // Never select the opaque token until both SQL type and actual UTF-8 size passed.
  const payload = database.prepare("SELECT checkpoint_json FROM source_parser_checkpoints WHERE source_id=? LIMIT 1").get(sourceId)?.["checkpoint_json"];
  const capture = captureFields({ checkpoint: payload, nextOrdinal, maxFileBytes, maxRecords, maxLineBytes }, source.provider);
  if (Buffer.byteLength(capture.checkpoint) !== checkpointBytes) invalid();
  const expected = generationSeal(context, source, source.revision, source.cacheEvidence!, capture, limits, projection!);
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(seal))) invalid();
  if (compatibleParser(context, source.provider, source.parserVersion) && limits === adapterLimitsFingerprint(source.provider)) {
    restoreSourceCheckpoint(context, headerOnly(source), capture, projection!);
  }
  return Object.freeze({ ...capture, contractVersion: 1, checkpointBytes, adapterLimitsFingerprint: limits, generationSeal: seal });
}
export function assertContext(context: IdentityContext, keyId: string): void {
  if (context.keyId !== keyId) throw new SafeError("INVALID_IDENTITY_KEY");
}
