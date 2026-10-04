import type { DatabaseSync } from "node:sqlite";
import { timingSafeEqual } from "node:crypto";
import { types } from "node:util";
import type { IdentityContext } from "../normalize/identity.js";
import { SafeError } from "../privacy/diagnostics.js";
import { DATABASE_SCHEMA_VERSION } from "./database.js";
import { createDirectoryMembershipStore } from "./directory-membership.js";
import { StoreOperationAborted } from "./read-only.js";
import { choice, fields, identity, integer, keyId } from "./source-validation.js";

export const DIRECTORY_RESUME_LIMITS = Object.freeze({ roots: 64, sources: 4096, page: 16 });
export type DirectoryResumeInput = Readonly<{
  rootId: string;
  provider: "codex" | "claude";
  rootFingerprint: string;
  membershipRevision: number | null;
  captureMode: "default" | "timing" | "pattern";
  censusCount: number;
  censusFingerprint: string;
  nextOffset: number;
  prefixFingerprint: string;
}>;
export type DirectoryResumeRecord = DirectoryResumeInput & Readonly<{ contractVersion: 1; keyId: string; seal: string }>;
export type DirectoryResumeWriteResult = Readonly<{
  status: "committed" | "unchanged" | "stale" | "ineligible";
  reason: "cursor_changed" | "membership_changed" | "root_changed" | "envelope_changed" | "offset_regression" | "prefix_changed" | "cursor_limit" | null;
  cursor: DirectoryResumeRecord | null;
}>;
const INPUT_FIELDS = ["rootId", "provider", "rootFingerprint", "membershipRevision", "captureMode", "censusCount", "censusFingerprint", "nextOffset", "prefixFingerprint"] as const;
const ENVELOPE_FIELDS = ["rootId", "provider", "rootFingerprint", "membershipRevision", "captureMode", "censusCount", "censusFingerprint"] as const;
const text = (name: string, maximum = 128) => `CASE WHEN typeof(${name})='text' AND length(CAST(${name} AS BLOB))<=${maximum} THEN ${name} ELSE NULL END AS ${name}`;
const number = (name: string) => `CASE WHEN typeof(${name})='integer' THEN ${name} ELSE NULL END AS ${name}`;
const outcome = (status: DirectoryResumeWriteResult["status"], reason: DirectoryResumeWriteResult["reason"] = null,
  cursor: DirectoryResumeRecord | null = null): DirectoryResumeWriteResult => Object.freeze({ status, reason, cursor });

function validateInput(value: unknown, key: string): DirectoryResumeInput {
  if (types.isProxy(value)) throw new SafeError("INVALID_RECORD");
  const v = fields(value, INPUT_FIELDS);
  if (INPUT_FIELDS.some(name => !Object.getOwnPropertyDescriptor(value, name)?.enumerable)) throw new SafeError("INVALID_RECORD");
  const count = integer(v["censusCount"], 1), offset = integer(v["nextOffset"], 1);
  if (count > DIRECTORY_RESUME_LIMITS.sources || offset > count || offset !== count && offset % DIRECTORY_RESUME_LIMITS.page !== 0) throw new SafeError("INVALID_RECORD");
  return Object.freeze({
    rootId: identity(v["rootId"], "source", key), provider: choice(v["provider"], ["codex", "claude"] as const),
    rootFingerprint: identity(v["rootFingerprint"], "content", key),
    membershipRevision: v["membershipRevision"] === null ? null : integer(v["membershipRevision"], 1),
    captureMode: choice(v["captureMode"], ["default", "timing", "pattern"] as const),
    censusCount: count, censusFingerprint: identity(v["censusFingerprint"], "content", key), nextOffset: offset,
    prefixFingerprint: identity(v["prefixFingerprint"], "content", key),
  });
}

/** Authenticated hints only. A reader must separately prove census/content/prefix freshness before skipping. */
export function createDirectoryResumeStore(database: DatabaseSync, context: IdentityContext) {
  const key = keyId(context.keyId);
  const memberships = createDirectoryMembershipStore(database, context);
  const seal = (value: DirectoryResumeInput): string => context.fingerprint("content", [
    "directory_batch_resume_v1", 1, key, ...INPUT_FIELDS.map(name => value[name]),
  ]);
  const token = (value: string | null): string | null => value === null ? null : identity(value, "content", key);

  function checkSchemaAndBinding(): void {
    if (database.prepare("PRAGMA user_version").get()?.["user_version"] !== DATABASE_SCHEMA_VERSION) throw new SafeError("DATABASE_SCHEMA_INCOMPATIBLE");
    const markers = database.prepare(`SELECT ${number("version")} FROM schema_migrations ORDER BY version LIMIT 9`).all();
    if (markers.length !== DATABASE_SCHEMA_VERSION || markers.some((row, i) => row["version"] !== i + 1)) throw new SafeError("DATABASE_SCHEMA_INCOMPATIBLE");
    if (database.prepare("SELECT 1 FROM directory_batch_resume LIMIT 65").all().length > DIRECTORY_RESUME_LIMITS.roots) throw new SafeError("DATABASE_ACCESS_FAILED");
    const bindings = database.prepare(`SELECT ${number("singleton")},${text("key_id", 32)} FROM source_store_identity LIMIT 2`).all();
    if (bindings.length > 1 || bindings.length === 1 && (bindings[0]!["singleton"] !== 1 || bindings[0]!["key_id"] !== key)) throw new SafeError("INVALID_IDENTITY_KEY");
    if (!bindings.length && ["source_event_headers", "directory_membership_roots", "directory_membership_members", "directory_batch_resume"]
      .some(table => database.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get() !== undefined)) throw new SafeError("INVALID_IDENTITY_KEY");
  }

  function pinned(rootId: string): DirectoryResumeRecord | null {
    const rows = database.prepare(`SELECT ${text("root_id")},${text("provider", 6)},${number("contract_version")},${text("key_id", 32)},
      ${text("root_fingerprint")},${number("membership_revision")},(membership_revision IS NULL) AS membership_is_null,
      ${text("capture_mode", 7)},${number("census_count")},${text("census_fingerprint")},${number("next_offset")},
      ${text("prefix_fingerprint")},${text("seal")} FROM directory_batch_resume WHERE root_id=? LIMIT 2`).all(rootId);
    if (rows.length === 0) return null;
    if (rows.length !== 1) throw new SafeError("DATABASE_ACCESS_FAILED");
    const row = rows[0]!;
    if (row["root_id"] !== rootId || row["contract_version"] !== 1 || row["key_id"] !== key
      || row["membership_is_null"] !== 1 && row["membership_revision"] === null) throw new SafeError("DATABASE_ACCESS_FAILED");
    const value = validateInput({ rootId: row["root_id"], provider: row["provider"], rootFingerprint: row["root_fingerprint"],
      membershipRevision: row["membership_revision"], captureMode: row["capture_mode"], censusCount: row["census_count"],
      censusFingerprint: row["census_fingerprint"], nextOffset: row["next_offset"], prefixFingerprint: row["prefix_fingerprint"] }, key);
    const storedSeal = identity(row["seal"], "content", key), expectedSeal = seal(value);
    if (!timingSafeEqual(Buffer.from(storedSeal), Buffer.from(expectedSeal))) throw new SafeError("DATABASE_ACCESS_FAILED");
    return Object.freeze({ ...value, contractVersion: 1, keyId: key, seal: storedSeal });
  }

  function safe<T>(operation: () => T): T {
    try { return operation(); }
    catch (error) {
      if (error instanceof StoreOperationAborted || error instanceof SafeError
        && ["INVALID_IDENTITY_KEY", "DATABASE_SCHEMA_INCOMPATIBLE", "DATABASE_TRANSACTION_FAILED"].includes(error.code)) throw error;
      throw new SafeError("DATABASE_ACCESS_FAILED");
    }
  }
  function owned<T>(writable: boolean, operation: () => T, signal?: AbortSignal): T {
    if (signal !== undefined && (types.isProxy(signal) || !(signal instanceof AbortSignal))) throw new SafeError("INVALID_ARGUMENT");
    if (database.isTransaction) throw new SafeError("DATABASE_TRANSACTION_FAILED");
    const check = () => { if (signal?.aborted) throw new StoreOperationAborted(); };
    check();
    return safe(() => {
      let began = false;
      try {
        database.exec(writable ? "BEGIN IMMEDIATE" : "BEGIN"); began = true;
        checkSchemaAndBinding(); check();
        const value = operation();
        check(); database.exec("COMMIT"); began = false;
        return value;
      } catch (error) {
        if (began) try { database.exec("ROLLBACK"); } catch { /* Only our transaction. */ }
        throw error;
      }
    });
  }

  function read(rootId: string): DirectoryResumeRecord | null {
    identity(rootId, "source", key);
    return owned(false, () => pinned(rootId));
  }
  function save(input: DirectoryResumeInput, expectedSeal: string | null, signal?: AbortSignal): DirectoryResumeWriteResult {
    const value = validateInput(input, key), expected = token(expectedSeal);
    return owned(true, () => {
      const prior = pinned(value.rootId);
      if ((prior?.seal ?? null) !== expected) return outcome("stale", "cursor_changed");
      const root = memberships.readInTransaction(value.rootId);
      if ((root?.revision ?? null) !== value.membershipRevision) return outcome("stale", "membership_changed");
      if (root && (root.provider !== value.provider || root.rootFingerprint !== value.rootFingerprint)) return outcome("ineligible", "root_changed");
      if (prior) {
        if (ENVELOPE_FIELDS.some(name => prior[name] !== value[name])) return outcome("ineligible", "envelope_changed");
        if (value.nextOffset < prior.nextOffset) return outcome("ineligible", "offset_regression");
        if (value.nextOffset === prior.nextOffset) return prior.prefixFingerprint === value.prefixFingerprint
          ? outcome("unchanged", null, prior) : outcome("ineligible", "prefix_changed");
      } else if (database.prepare("SELECT 1 FROM directory_batch_resume LIMIT 64").all().length >= DIRECTORY_RESUME_LIMITS.roots) {
        return outcome("ineligible", "cursor_limit");
      }
      const sealed = seal(value);
      database.prepare("INSERT OR IGNORE INTO source_store_identity(singleton,key_id) VALUES (1,?)").run(key);
      const write = database.prepare(`INSERT INTO directory_batch_resume
        (root_id,provider,contract_version,key_id,root_fingerprint,membership_revision,capture_mode,census_count,census_fingerprint,next_offset,prefix_fingerprint,seal)
        VALUES (?,?,1,?,?,?,?,?,?,?,?,?) ON CONFLICT(root_id) DO UPDATE SET next_offset=excluded.next_offset,
        prefix_fingerprint=excluded.prefix_fingerprint,seal=excluded.seal WHERE directory_batch_resume.seal=?`)
        .run(value.rootId, value.provider, key, value.rootFingerprint, value.membershipRevision, value.captureMode,
          value.censusCount, value.censusFingerprint, value.nextOffset, value.prefixFingerprint, sealed, expected);
      if (write.changes !== 1) throw new SafeError("DATABASE_TRANSACTION_FAILED");
      const verified = pinned(value.rootId);
      if (verified?.seal !== sealed) throw new SafeError("DATABASE_ACCESS_FAILED");
      return outcome("committed", null, verified);
    }, signal);
  }

  /** Caller owns rollback. Never commits, authenticates even a now-stale hint, and requires its exact seal. */
  function removeInTransaction(rootId: string, expectedSeal: string | null): DirectoryResumeWriteResult {
    identity(rootId, "source", key); const expected = token(expectedSeal);
    if (!database.isTransaction) throw new SafeError("DATABASE_TRANSACTION_FAILED");
    return safe(() => {
      checkSchemaAndBinding();
      const prior = pinned(rootId);
      if ((prior?.seal ?? null) !== expected) return outcome("stale", "cursor_changed");
      if (prior === null) return outcome("unchanged");
      const removed = database.prepare("DELETE FROM directory_batch_resume WHERE root_id=? AND seal=?").run(rootId, expected);
      if (removed.changes !== 1 || pinned(rootId) !== null) throw new SafeError("DATABASE_TRANSACTION_FAILED");
      return outcome("committed");
    });
  }
  function remove(rootId: string, expectedSeal: string | null, signal?: AbortSignal): DirectoryResumeWriteResult {
    identity(rootId, "source", key); const expected = token(expectedSeal);
    return owned(true, () => removeInTransaction(rootId, expected), signal);
  }
  return Object.freeze({ read, save, remove, removeInTransaction });
}
