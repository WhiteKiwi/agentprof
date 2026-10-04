import type { DatabaseSync } from "node:sqlite";
import { timingSafeEqual } from "node:crypto";
import { types } from "node:util";
import type { IdentityContext } from "../normalize/identity.js";
import { SafeError } from "../privacy/diagnostics.js";
import { array, choice, fields, identity, integer, keyId } from "./source-validation.js";

export const DIRECTORY_MEMBERSHIP_LIMITS = Object.freeze({ members: 4096, bytes: 1024 * 1024, observed: 64 });
export const DIRECTORY_CATALOGUE_LIMITS = Object.freeze({ roots: 64, members: 16384 });
export class DirectoryCatalogueLimit extends Error { constructor() { super("Directory membership catalogue exceeds reconciliation limits."); } }
export type DirectoryMember = Readonly<{ sourceId: string; sourceRevision: number; observation: "observed" | "not_observed" }>;
export type DirectoryMembership = Readonly<{ rootId: string; provider: "codex" | "claude"; rootFingerprint: string; revision: number; members: readonly DirectoryMember[] }>;
export type DirectoryCapture = Readonly<{ rootId: string; provider: "codex" | "claude"; rootFingerprint: string; observed: readonly Readonly<{ sourceId: string; sourceRevision: number }>[] }>;
export type DirectoryCaptureResult = Readonly<{ status: "committed" | "unchanged" | "stale" | "aborted" | "ineligible"; revision: number | null; reason: "root_changed" | "source_changed" | "membership_changed" | "membership_limit" | null; memberCount: number | null }>;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function plain(value: unknown, names: readonly string[]) { if (types.isProxy(value)) throw new SafeError("INVALID_RECORD"); return fields(value, names); }
function rows(value: unknown, limit: number): unknown[] { if (types.isProxy(value)) throw new SafeError("INVALID_RECORD"); return array(value, limit); }
function manifest(members: readonly DirectoryMember[]) { return members.map(m => [m.sourceId, m.sourceRevision, m.observation] as const); }
function bytes(members: readonly DirectoryMember[]) { return Buffer.byteLength(JSON.stringify(manifest(members))); }
function sealed(context: IdentityContext, m: DirectoryMembership): string {
  return context.fingerprint("content", ["directory_membership_v1", 1, 1, m.rootId, m.provider, context.keyId, m.rootFingerprint, m.revision, manifest(m.members)]);
}
const text = (name: string, limit: number) => `CASE WHEN typeof(${name})='text' AND length(CAST(${name} AS BLOB))<=${limit} THEN ${name} ELSE NULL END AS ${name}`;
const number = (name: string) => `CASE WHEN typeof(${name})='integer' THEN ${name} ELSE NULL END AS ${name}`;
const result = (status: DirectoryCaptureResult["status"], revision: number | null, reason: DirectoryCaptureResult["reason"] = null, memberCount: number | null = null): DirectoryCaptureResult => Object.freeze({ status, revision, reason, memberCount });

/** Authenticated observations only. This store never retires or edits a source. */
export function createDirectoryMembershipStore(database: DatabaseSync, context: IdentityContext) {
  const key = keyId(context.keyId);
  function binding(): void {
    const found = database.prepare(`SELECT ${number("singleton")},${text("key_id", 32)} FROM source_store_identity LIMIT 2`).all();
    if (found.length > 1 || found.length === 1 && (found[0]!["singleton"] !== 1 || found[0]!["key_id"] !== key)) throw new SafeError("INVALID_IDENTITY_KEY");
    if (!found.length && ["source_event_headers", "directory_membership_roots", "directory_membership_members"].some(table => database.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get() !== undefined)) throw new SafeError("INVALID_IDENTITY_KEY");
  }
  function pinned(rootId: string): DirectoryMembership | null {
    binding();
    const headers = database.prepare(`SELECT ${text("root_id", 128)},${text("provider", 6)},${number("contract_version")},${text("key_id", 32)},${text("root_fingerprint", 128)},${number("revision")},${number("member_count")},${number("manifest_bytes")},${text("seal", 128)} FROM directory_membership_roots WHERE root_id=? LIMIT 2`).all(rootId);
    // Bound both row count and SQL string sizes before admitting values to JS.
    const stored = database.prepare(`SELECT ${text("source_id", 128)},${number("source_revision")},${text("observation", 12)} FROM directory_membership_members WHERE root_id=? LIMIT 4097`).all(rootId);
    if (!headers.length) { if (stored.length) throw new Error(); return null; }
    if (headers.length !== 1 || stored.length > DIRECTORY_MEMBERSHIP_LIMITS.members) throw new Error();
    const h = headers[0]!;
    if (h["root_id"] !== rootId || h["key_id"] !== key || h["contract_version"] !== 1 || h["member_count"] !== stored.length) throw new Error();
    const unique = new Set<string>();
    const members = stored.map(row => {
      const sourceId = identity(row["source_id"], "source", key);
      if (unique.has(sourceId)) throw new Error(); unique.add(sourceId);
      return Object.freeze({ sourceId, sourceRevision: integer(row["source_revision"], 1), observation: choice(row["observation"], ["observed", "not_observed"] as const) });
    }).sort((a, b) => compare(a.sourceId, b.sourceId));
    if (bytes(members) > DIRECTORY_MEMBERSHIP_LIMITS.bytes || h["manifest_bytes"] !== bytes(members)) throw new Error();
    const m: DirectoryMembership = Object.freeze({ rootId, provider: choice(h["provider"], ["codex", "claude"] as const), rootFingerprint: identity(h["root_fingerprint"], "content", key), revision: integer(h["revision"], 1), members: Object.freeze(members) });
    const seal = identity(h["seal"], "content", key), expected = sealed(context, m);
    if (!timingSafeEqual(Buffer.from(seal), Buffer.from(expected))) throw new Error();
    return m;
  }
  function read(rootId: string): DirectoryMembership | null {
    identity(rootId, "source", key);
    if (database.isTransaction) throw new SafeError("DATABASE_TRANSACTION_FAILED");
    let began = false;
    try { database.exec("BEGIN"); began = true; const value = pinned(rootId); database.exec("COMMIT"); began = false; return value; }
    catch (error) { if (began) try { database.exec("ROLLBACK"); } catch { /* Owned read only. */ } if (error instanceof SafeError && error.code === "INVALID_IDENTITY_KEY") throw error; throw new SafeError("DATABASE_ACCESS_FAILED"); }
  }
  /** Internal composition: authenticate every bounded root inside the caller's transaction. */
  function readAllForMutation(): readonly DirectoryMembership[] {
    if (!database.isTransaction) throw new SafeError("DATABASE_TRANSACTION_FAILED");
    try {
      binding();
      const headers = database.prepare(`SELECT ${text("root_id", 128)} FROM directory_membership_roots ORDER BY root_id LIMIT 65`).all();
      if (headers.length > DIRECTORY_CATALOGUE_LIMITS.roots) throw new DirectoryCatalogueLimit();
      // Check orphan rows as well: otherwise an unanchored veto could be silently ignored.
      if (database.prepare("SELECT 1 FROM directory_membership_members m LEFT JOIN directory_membership_roots r ON r.root_id=m.root_id WHERE r.root_id IS NULL LIMIT 1").get()) throw new Error();
      const roots: DirectoryMembership[] = [];
      let members = 0;
      for (const header of headers) {
        const root = pinned(identity(header["root_id"], "source", key));
        if (root === null) throw new Error();
        members += root.members.length;
        if (members > DIRECTORY_CATALOGUE_LIMITS.members) throw new DirectoryCatalogueLimit();
        roots.push(root);
      }
      return Object.freeze(roots);
    } catch (error) {
      if (error instanceof DirectoryCatalogueLimit || error instanceof SafeError && error.code === "INVALID_IDENTITY_KEY") throw error;
      throw new SafeError("DATABASE_ACCESS_FAILED");
    }
  }
  function capture(input: DirectoryCapture, expectedRevision: number | null, signal?: AbortSignal): DirectoryCaptureResult {
    const v = plain(input, ["rootId", "provider", "rootFingerprint", "observed"]);
    const rootId = identity(v["rootId"], "source", key), provider = choice(v["provider"], ["codex", "claude"] as const), rootFingerprint = identity(v["rootFingerprint"], "content", key);
    const seen = new Set<string>();
    const observed = rows(v["observed"], DIRECTORY_MEMBERSHIP_LIMITS.observed).map(row => {
      const x = plain(row, ["sourceId", "sourceRevision"]), sourceId = identity(x["sourceId"], "source", key);
      if (seen.has(sourceId)) throw new SafeError("INVALID_RECORD"); seen.add(sourceId);
      return Object.freeze({ sourceId, sourceRevision: integer(x["sourceRevision"], 1), observation: "observed" as const });
    });
    const expected = expectedRevision === null ? null : integer(expectedRevision, 1);
    if (signal !== undefined && !(signal instanceof AbortSignal)) throw new SafeError("INVALID_ARGUMENT");
    if (database.isTransaction) throw new SafeError("DATABASE_TRANSACTION_FAILED");
    if (signal?.aborted) return result("aborted", null);
    let began = false, cancelled = false;
    const check = () => { if (signal?.aborted) { cancelled = true; throw new Error(); } };
    try {
      database.exec("BEGIN IMMEDIATE"); began = true;
      const prior = pinned(rootId);
      const finish = (value: DirectoryCaptureResult) => { check(); database.exec("COMMIT"); began = false; return value; };
      check();
      if ((prior?.revision ?? null) !== expected) return finish(result("stale", prior?.revision ?? null, "membership_changed"));
      if (prior && (prior.provider !== provider || prior.rootFingerprint !== rootFingerprint)) return finish(result("ineligible", prior.revision, "root_changed"));
      for (const member of observed) {
        const h = database.prepare(`SELECT ${text("provider", 6)},${text("key_id", 32)},${text("availability", 11)},${number("revision")} FROM source_event_headers WHERE source_id=? LIMIT 2`).all(member.sourceId);
        if (h.length !== 1 || h[0]!["provider"] !== provider || h[0]!["key_id"] !== key || h[0]!["availability"] !== "available" || h[0]!["revision"] !== member.sourceRevision) return finish(result("stale", prior?.revision ?? null, "source_changed"));
      }
      const union = new Map((prior?.members ?? []).map(m => [m.sourceId, Object.freeze({ ...m, observation: "not_observed" as DirectoryMember["observation"] })]));
      for (const member of observed) union.set(member.sourceId, member);
      if (union.size > DIRECTORY_MEMBERSHIP_LIMITS.members) return finish(result("ineligible", prior?.revision ?? null, "membership_limit"));
      const members = [...union.values()].sort((a, b) => compare(a.sourceId, b.sourceId)), size = bytes(members);
      if (size > DIRECTORY_MEMBERSHIP_LIMITS.bytes) return finish(result("ineligible", prior?.revision ?? null, "membership_limit"));
      if (prior && JSON.stringify(manifest(prior.members)) === JSON.stringify(manifest(members))) return finish(result("unchanged", prior.revision, null, members.length));
      const revision = integer((prior?.revision ?? 0) + 1, 1), m = { rootId, provider, rootFingerprint, revision, members };
      database.prepare("INSERT OR IGNORE INTO source_store_identity(singleton,key_id) VALUES(1,?)").run(key);
      database.prepare("INSERT INTO directory_membership_roots(root_id,provider,contract_version,key_id,root_fingerprint,revision,member_count,manifest_bytes,seal) VALUES(?,?,1,?,?,?,?,?,?) ON CONFLICT(root_id) DO UPDATE SET revision=excluded.revision,member_count=excluded.member_count,manifest_bytes=excluded.manifest_bytes,seal=excluded.seal")
        .run(rootId, provider, key, rootFingerprint, revision, members.length, size, sealed(context, m));
      database.prepare("DELETE FROM directory_membership_members WHERE root_id=?").run(rootId);
      const insert = database.prepare("INSERT INTO directory_membership_members(root_id,source_id,source_revision,observation) VALUES(?,?,?,?)");
      for (const member of members) { check(); insert.run(rootId, member.sourceId, member.sourceRevision, member.observation); }
      return finish(result("committed", revision, null, members.length));
    } catch (error) {
      if (began) try { database.exec("ROLLBACK"); } catch { /* Owned write only. */ }
      if (cancelled) return result("aborted", null);
      if (error instanceof SafeError && error.code === "INVALID_IDENTITY_KEY") throw error;
      throw new SafeError("DATABASE_ACCESS_FAILED");
    }
  }
  return Object.freeze({ read, capture, readAllForMutation });
}
