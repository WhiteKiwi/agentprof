import type { DatabaseSync } from "node:sqlite";
import type { NormalizedEvent } from "../normalize/types.js";
import { SafeError } from "../privacy/diagnostics.js";
import { transaction } from "./database.js";
import { encodeSource, identity, integer, keyId as validateKeyId, MAX_EVENT_BYTES, MAX_SOURCE_EVENTS, MAX_SOURCE_EVENT_BYTES, validateEvent, validateHeader } from "./source-validation.js";
import type { SourceHeaderInput, SourceInput } from "./source-validation.js";
export type { SourceInput, SourceHeaderInput } from "./source-validation.js";

export type SourceWriteResult = Readonly<
  { status: "committed"; revision: number }
  | { status: "stale"; actualRevision: number | null }
  | { status: "aborted" }
>;
export type StoredSource = SourceHeaderInput & Readonly<{
  revision: number; availability: "available" | "unavailable";
  events: readonly NormalizedEvent[];
  aggregationReady: false; parserResumeReady: false;
}>;
function expected(value: number | null): number | null { return value === null ? null : integer(value, 1); }
function revision(value: unknown): number | null { return value === undefined ? null : integer(value, 1); }
function signalCheck(signal: AbortSignal | undefined): void {
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new SafeError("INVALID_ARGUMENT");
}

/** A bounded source-contribution store, not a durable parser or canonical aggregator. */
export function createSourceStore(database: DatabaseSync, key: string) {
  const keyId = validateKeyId(key);
  function write(signal: AbortSignal | undefined, operation: (checkAbort: () => void) => SourceWriteResult): SourceWriteResult {
    signalCheck(signal);
    if (signal?.aborted) return Object.freeze({ status: "aborted" });
    let aborted = false, keyMismatch = false;
    const checkAbort = () => {
      if (signal?.aborted) { aborted = true; throw new SafeError("DATABASE_TRANSACTION_FAILED"); }
    };
    try {
      return transaction(database, () => {
        const installed = database.prepare("SELECT key_id FROM source_store_identity WHERE singleton = 1").get()?.["key_id"];
        if (installed !== undefined && installed !== keyId) {
          keyMismatch = true;
          throw new SafeError("INVALID_IDENTITY_KEY");
        }
        checkAbort();
        const result = operation(checkAbort);
        checkAbort();
        return Object.freeze(result);
      });
    } catch (error) {
      if (aborted) return Object.freeze({ status: "aborted" });
      if (keyMismatch) throw new SafeError("INVALID_IDENTITY_KEY");
      throw error;
    }
  }
  function replaceSource(input: SourceInput, expectedRevision: number | null, signal?: AbortSignal): SourceWriteResult {
    const expectation = expected(expectedRevision);
    signalCheck(signal);
    if (signal?.aborted) return Object.freeze({ status: "aborted" });
    const { header: h, rows, bytes } = encodeSource(input, keyId);
    return write(signal, (checkAbort): SourceWriteResult => {
      const actual = revision(database.prepare("SELECT revision FROM source_event_headers WHERE source_id = ?").get(h.sourceId)?.["revision"]);
      if (actual !== expectation) return { status: "stale", actualRevision: actual };
      const next = integer((actual ?? 0) + 1, 1);
      database.prepare("INSERT OR IGNORE INTO source_store_identity(singleton, key_id) VALUES (1, ?)").run(keyId);
      // Existing header is retained throughout the replacement; dependent rows never dangle.
      database.prepare(`INSERT INTO source_event_headers
        (source_id, provider, parser_version, normalization_version, key_version, key_id, completed_offset, observed_size, boundary_fingerprint, revision, availability, event_count, event_bytes)
        VALUES (?, ?, ?, 1, 1, ?, ?, ?, ?, ?, 'available', ?, ?)
        ON CONFLICT(source_id) DO UPDATE SET provider=excluded.provider, parser_version=excluded.parser_version,
          completed_offset=excluded.completed_offset, observed_size=excluded.observed_size, boundary_fingerprint=excluded.boundary_fingerprint,
          revision=excluded.revision, availability='available', event_count=excluded.event_count, event_bytes=excluded.event_bytes`)
        .run(h.sourceId, h.provider, h.parserVersion, keyId, h.completedOffset, h.observedSize, h.boundaryFingerprint, next, rows.length, bytes);
      database.prepare("DELETE FROM source_event_contributions WHERE source_id = ?").run(h.sourceId);
      const insert = database.prepare("INSERT INTO source_event_contributions(source_id, event_id, event_json) VALUES (?, ?, ?)");
      for (const row of rows) { checkAbort(); insert.run(h.sourceId, row.id, row.json); }
      return { status: "committed", revision: next };
    });
  }
  function markUnavailable(sourceId: string, expectedRevision: number, signal?: AbortSignal): SourceWriteResult {
    identity(sourceId, "source", keyId);
    const expectation = integer(expectedRevision, 1);
    return write(signal, (): SourceWriteResult => {
      const actual = revision(database.prepare("SELECT revision FROM source_event_headers WHERE source_id = ?").get(sourceId)?.["revision"]);
      if (actual !== expectation) return { status: "stale", actualRevision: actual };
      const next = integer(actual + 1, 1);
      database.prepare("UPDATE source_event_headers SET availability = 'unavailable', revision = ? WHERE source_id = ?").run(next, sourceId);
      return { status: "committed", revision: next };
    });
  }
  function readSource(sourceId: string): StoredSource | null {
    identity(sourceId, "source", keyId);
    try {
      // One SQLite statement gives header and events from the same read snapshot.
      const cursor = database.prepare(`SELECT h.*, e.event_id, e.event_json
        FROM source_event_headers h LEFT JOIN source_event_contributions e ON e.source_id = h.source_id
        WHERE h.source_id = ? ORDER BY e.event_id LIMIT ?`).iterate(sourceId, MAX_SOURCE_EVENTS + 1);
      try {
        const firstResult = cursor.next();
        if (firstResult.done) return null;
        const first = firstResult.value;
        const header = validateHeader({ sourceId: first["source_id"], provider: first["provider"], parserVersion: first["parser_version"],
          normalizationVersion: first["normalization_version"], keyVersion: first["key_version"], keyId: first["key_id"],
          completedOffset: first["completed_offset"], observedSize: first["observed_size"], boundaryFingerprint: first["boundary_fingerprint"] }, keyId);
        const count = integer(first["event_count"]), recordedBytes = integer(first["event_bytes"]);
        if (count > MAX_SOURCE_EVENTS || recordedBytes > MAX_SOURCE_EVENT_BYTES || (first["availability"] !== "available" && first["availability"] !== "unavailable")) throw new Error();
        const events: NormalizedEvent[] = [];
        let bytes = 0;
        const append = (row: typeof first) => {
          if (row["event_id"] === null && count === 0) return;
          if (events.length >= MAX_SOURCE_EVENTS) throw new Error();
          const json = row["event_json"];
          if (typeof json !== "string" || Buffer.byteLength(json) > MAX_EVENT_BYTES) throw new Error();
          bytes += Buffer.byteLength(json);
          if (bytes > MAX_SOURCE_EVENT_BYTES) throw new Error();
          const event = validateEvent(JSON.parse(json) as unknown, header);
          if (event.id !== row["event_id"]) throw new Error();
          events.push(event);
        };
        append(first);
        for (const row of cursor) append(row);
        if (events.length !== count || bytes !== recordedBytes) throw new Error();
        return Object.freeze({ ...header, revision: integer(first["revision"], 1), availability: first["availability"], events: Object.freeze(events), aggregationReady: false, parserResumeReady: false });
      } finally { cursor.return?.(); }
    } catch { throw new SafeError("DATABASE_ACCESS_FAILED"); }
  }
  return Object.freeze({ replaceSource, markUnavailable, readSource });
}
