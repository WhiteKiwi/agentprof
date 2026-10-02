import { createHash } from "node:crypto";
import type { MetadataSegment, WrapperRepresentation, ParserSourceRef } from "../parsers/types.js";
import type { ClaudeMetadata, ClaudeMessageLink } from "../parsers/claude/types.js";
import { array, choice, fields, identity, integer, invalid, nullableIdentity } from "./source-validation.js";
import type { SourceHeaderInput } from "./source-validation.js";

export const RELATIONSHIP_CONTRACT_VERSION = 1;
export const RELATIONSHIP_CAPTURE_POLICY_VERSION = 1;
export const MAX_RELATIONSHIP_ROW_BYTES = 64 * 1024;
export const MAX_SOURCE_RELATIONSHIP_BYTES = 4 * 1024 * 1024;
export const RELATIONSHIP_LIMITS = Object.freeze({ metadata: 8192, wrapper: 4096, message: 8192 });
export const MAX_SOURCE_RELATIONSHIP_ROWS = 16384;
export type RelationshipKind = keyof typeof RELATIONSHIP_LIMITS;
type Versions = Readonly<{ contractVersion: 1; capturePolicyVersion: number }>;
export type RelationshipEvidence = Versions & Readonly<
  { status: "captured"; provider: "codex"; metadata: readonly MetadataSegment[]; wrappers: readonly WrapperRepresentation[] }
  | { status: "captured"; provider: "claude"; metadata: readonly ClaudeMetadata[]; messages: readonly ClaudeMessageLink[] }
  | { status: "unavailable"; provider: "codex" | "claude"; reason: "relationship_budget_exceeded" }
>;
export type RelationshipRow = Readonly<{ kind: RelationshipKind; ordinal: number; id: string; json: string }>;
export type EncodedRelationships = Readonly<{ evidence: RelationshipEvidence; rows: readonly RelationshipRow[]; counts: Readonly<Record<RelationshipKind, number>>; bytes: number }>;
const ORIGINS = ["ordinary", "ambiguous", "trusted_copied"] as const;
function bool(v: unknown): boolean { if (typeof v !== "boolean") invalid(); return v; }
function ref(value: unknown, h: SourceHeaderInput): ParserSourceRef {
  const v = fields(value, ["fileId", "byteOffset"]), byteOffset = integer(v["byteOffset"]);
  if (identity(v["fileId"], "source", h.keyId) !== h.sourceId || byteOffset >= h.completedOffset) invalid();
  return Object.freeze({ fileId: h.sourceId, byteOffset });
}
export function validateRelationshipRow(kind: RelationshipKind, value: unknown, h: SourceHeaderInput): MetadataSegment | ClaudeMetadata | WrapperRepresentation | ClaudeMessageLink {
  if (kind === "metadata") {
    const common = ["id", "versionFingerprint", "origin", "sourceRef"];
    const v = fields(value, [...common, ...(h.provider === "codex" ? ["ownerSessionId", "declaredSessionId", "forkParentId"] : ["ownerRootSessionId", "declaredRootSessionId", "sessionId", "agentId", "isSidechain", "declarationFingerprint"])]);
    const base = { id: identity(v["id"], "source", h.keyId), versionFingerprint: nullableIdentity(v["versionFingerprint"], "source", h.keyId), origin: choice(v["origin"], ORIGINS), sourceRef: ref(v["sourceRef"], h) };
    return Object.freeze(h.provider === "codex" ? { ...base, ownerSessionId: identity(v["ownerSessionId"], "session", h.keyId), declaredSessionId: identity(v["declaredSessionId"], "session", h.keyId), forkParentId: nullableIdentity(v["forkParentId"], "session", h.keyId) }
      : { ...base, ownerRootSessionId: nullableIdentity(v["ownerRootSessionId"], "session", h.keyId), declaredRootSessionId: nullableIdentity(v["declaredRootSessionId"], "session", h.keyId), sessionId: nullableIdentity(v["sessionId"], "session", h.keyId), agentId: nullableIdentity(v["agentId"], "session", h.keyId), isSidechain: v["isSidechain"] === null ? null : bool(v["isSidechain"]), declarationFingerprint: nullableIdentity(v["declarationFingerprint"], "session", h.keyId) });
  }
  if (kind === "wrapper" && h.provider === "codex") {
    const v = fields(value, ["id", "sessionId", "kind", "callSeen", "resultSeen", "relationship", "childEventIds", "sourceRef"]);
    const children = array(v["childEventIds"], 1024).map(id => identity(id, "event", h.keyId));
    if (new Set(children).size !== children.length) invalid();
    return Object.freeze({ id: identity(v["id"], "event", h.keyId), sessionId: identity(v["sessionId"], "session", h.keyId), kind: choice(v["kind"], ["code_wrapper"]), callSeen: bool(v["callSeen"]), resultSeen: bool(v["resultSeen"]), relationship: choice(v["relationship"], ["trusted_fixture", "unknown"]), childEventIds: Object.freeze(children), sourceRef: ref(v["sourceRef"], h) });
  }
  if (kind === "message" && h.provider === "claude") {
    const v = fields(value, ["id", "sessionId", "kind", "parentMessageId", "sourceToolAssistantMessageId", "responseId", "conflicted", "sourceRef"]);
    return Object.freeze({ id: identity(v["id"], "event", h.keyId), sessionId: identity(v["sessionId"], "session", h.keyId), kind: choice(v["kind"], ["assistant", "user", "system"]), parentMessageId: nullableIdentity(v["parentMessageId"], "event", h.keyId), sourceToolAssistantMessageId: nullableIdentity(v["sourceToolAssistantMessageId"], "event", h.keyId), responseId: nullableIdentity(v["responseId"], "event", h.keyId), conflicted: bool(v["conflicted"]), sourceRef: ref(v["sourceRef"], h) });
  }
  return invalid();
}
// Budget preflight inspects the ordinary array's length descriptor before traversing its entries.
// Supported inputs are adapter data and parsed JSON, not hostile executable Proxy objects.
function length(value: unknown): number {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) invalid();
  const d = Object.getOwnPropertyDescriptor(value, "length");
  if (!d || !("value" in d)) invalid();
  return integer(d.value);
}
export function relationshipCurrent(value: RelationshipEvidence | null | undefined): boolean {
  return value?.contractVersion === RELATIONSHIP_CONTRACT_VERSION && value.capturePolicyVersion === RELATIONSHIP_CAPTURE_POLICY_VERSION;
}
export function encodeRelationships(value: unknown, h: SourceHeaderInput): EncodedRelationships | null {
  if (value === undefined || value === null) return null;
  // Read status through a descriptor without evaluating user accessors.
  const descriptor = typeof value === "object" ? Object.getOwnPropertyDescriptor(value, "status") : undefined;
  if (!descriptor || !("value" in descriptor)) invalid();
  const status = choice(descriptor.value, ["captured", "unavailable"]), secondary = h.provider === "codex" ? "wrappers" : "messages";
  const v = fields(value, ["contractVersion", "capturePolicyVersion", "status", "provider", ...(status === "captured" ? ["metadata", secondary] : ["reason"])]);
  if (v["contractVersion"] !== 1 || v["capturePolicyVersion"] !== 1 || v["provider"] !== h.provider) invalid();
  const unavailable = (): EncodedRelationships => Object.freeze({ evidence: Object.freeze({ contractVersion: 1, capturePolicyVersion: 1, status: "unavailable", provider: h.provider, reason: "relationship_budget_exceeded" }), rows: Object.freeze([]), counts: Object.freeze({ metadata: 0, wrapper: 0, message: 0 }), bytes: 0 });
  if (status === "unavailable") { if (v["reason"] !== "relationship_budget_exceeded") invalid(); return unavailable(); }
  const secondaryKind = h.provider === "codex" ? "wrapper" : "message";
  if (length(v["metadata"]) > RELATIONSHIP_LIMITS.metadata || length(v[secondary]) > RELATIONSHIP_LIMITS[secondaryKind]) return unavailable();
  const sets = { metadata: array(v["metadata"], RELATIONSHIP_LIMITS.metadata), [secondaryKind]: array(v[secondary], RELATIONSHIP_LIMITS[secondaryKind]) };
  const rows: RelationshipRow[] = [], counts = { metadata: 0, wrapper: 0, message: 0 }, metadata: (MetadataSegment | ClaudeMetadata)[] = [], wrappers: WrapperRepresentation[] = [], messages: ClaudeMessageLink[] = [];
  let bytes = 0, links = 0;
  for (const kind of ["metadata", secondaryKind] as const) {
    const seen = new Set<string>();
    for (const raw of sets[kind]!) {
      if (kind === "wrapper") {
        const d = raw !== null && typeof raw === "object" ? Object.getOwnPropertyDescriptor(raw, "childEventIds") : undefined;
        if (!d || !("value" in d)) invalid();
        if (length(d.value) > 1024 - links) return unavailable();
      }
      const item = validateRelationshipRow(kind, raw, h);
      if (seen.has(item.id)) invalid(); seen.add(item.id);
      if (kind === "wrapper") links += (item as WrapperRepresentation).childEventIds.length;
      if (kind === "message") { const m = item as ClaudeMessageLink; links += Number(m.parentMessageId !== null) + Number(m.sourceToolAssistantMessageId !== null); if (links > 8192) return unavailable(); }
      const json = JSON.stringify(item), size = Buffer.byteLength(json);
      if (size > MAX_RELATIONSHIP_ROW_BYTES || bytes + size > MAX_SOURCE_RELATIONSHIP_BYTES) return unavailable();
      bytes += size; rows.push(Object.freeze({ kind, ordinal: counts[kind]++, id: item.id, json }));
      if (kind === "metadata") metadata.push(item as MetadataSegment | ClaudeMetadata); else if (kind === "wrapper") wrappers.push(item as WrapperRepresentation); else messages.push(item as ClaudeMessageLink);
    }
  }
  const evidence: RelationshipEvidence = h.provider === "codex" ? Object.freeze({ contractVersion: 1, capturePolicyVersion: 1, status: "captured", provider: "codex", metadata: Object.freeze(metadata as MetadataSegment[]), wrappers: Object.freeze(wrappers) })
    : Object.freeze({ contractVersion: 1, capturePolicyVersion: 1, status: "captured", provider: "claude", metadata: Object.freeze(metadata as ClaudeMetadata[]), messages: Object.freeze(messages) });
  return Object.freeze({ evidence, rows: Object.freeze(rows), counts: Object.freeze(counts), bytes });
}

/** Bounded in-memory cache token binding; source-file proof contract is unchanged. */
export function relationshipFingerprint(value: RelationshipEvidence | null | undefined): string | null {
  if (!value) return null;
  const hash = createHash("sha256");
  hash.update(JSON.stringify([value.contractVersion, value.capturePolicyVersion, value.status, value.provider]));
  if (value.status === "unavailable") hash.update(JSON.stringify(value.reason));
  else {
    for (const row of value.metadata) hash.update(JSON.stringify(row)).update("\0");
    hash.update("\u0001");
    for (const row of value.provider === "codex" ? value.wrappers : value.messages) hash.update(JSON.stringify(row)).update("\0");
  }
  return hash.digest("hex");
}
