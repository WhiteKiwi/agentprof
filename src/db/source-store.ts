import type { DatabaseSync } from "node:sqlite";
import type { NormalizedEvent } from "../normalize/types.js";
import { SafeError } from "../privacy/diagnostics.js";
import { transaction } from "./database.js";
import { encodeSource, identity, integer, keyId as validateKeyId, MAX_EVENT_BYTES, MAX_SOURCE_EVENTS, MAX_SOURCE_EVENT_BYTES, validateEvent, validateHeader } from "./source-validation.js";
import type { EncodedSource, SourceHeaderInput, SourceInput } from "./source-validation.js";
import { encodeSourceSnapshot, MAX_METRIC_ROW_BYTES, MAX_SOURCE_METRIC_BYTES, MAX_SOURCE_METRIC_ROWS, METRIC_LIMITS, METRIC_VALIDATORS, metricKind } from "./source-metric-validation.js";
import type { EncodedMetrics, MetricEvidence, MetricKind, SourceSnapshotInput } from "./source-metric-validation.js";
export type { SourceInput, SourceHeaderInput } from "./source-validation.js";
export type { SourceSnapshotInput, MetricEvidence } from "./source-metric-validation.js";

export type SourceWriteResult = Readonly<
  { status: "committed"; revision: number }
  | { status: "stale"; actualRevision: number | null }
  | { status: "aborted" }
>;
export type StoredSource = SourceHeaderInput & Readonly<{
  revision: number; availability: "available" | "unavailable";
  events: readonly NormalizedEvent[];
  evidence: MetricEvidence | null; persistedScope: "events_only" | "events_and_metric_evidence";
  aggregationReady: false; parserResumeReady: false;
}>;
export type SourceCatalogueItem = Readonly<{
  sourceId: string; provider: "codex" | "claude"; revision: number;
  completedOffset: number; observedSize: number; availability: "available" | "unavailable";
  persistedScope: "events_only" | "events_and_metric_evidence";
  storedCounts: Readonly<{ events: number; turns: number | null; usage: number | null; observations: number | null; diagnostics: number | null }>;
}>;
export type SourceCatalogue = Readonly<{
  schema: "agentprof.source-catalogue/v1"; limit: 64; returnedCount: number; truncated: boolean;
  selection: "source_id_order"; snapshotConsistent: true; metadataOnly: true;
  sourceFreshnessChecked: false; crossSourceReconciled: false; aggregationReady: false; parserResumeReady: false;
  items: readonly SourceCatalogueItem[];
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
    return replaceEncoded({ header: h, rows, bytes }, null, expectation, signal);
  }
  function replaceSourceSnapshot(input: SourceSnapshotInput, expectedRevision: number | null, signal?: AbortSignal): SourceWriteResult {
    const expectation = expected(expectedRevision);
    signalCheck(signal);
    if (signal?.aborted) return Object.freeze({ status: "aborted" });
    const encoded = encodeSourceSnapshot(input, keyId);
    return replaceEncoded(encoded, encoded.metrics, expectation, signal);
  }
  function replaceEncoded({ header: h, rows, bytes }: EncodedSource, metrics: EncodedMetrics | null, expectation: number | null, signal?: AbortSignal): SourceWriteResult {
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
      database.prepare("DELETE FROM source_metric_contributions WHERE source_id = ?").run(h.sourceId);
      database.prepare("DELETE FROM source_metric_headers WHERE source_id = ?").run(h.sourceId);
      const insert = database.prepare("INSERT INTO source_event_contributions(source_id, event_id, event_json) VALUES (?, ?, ?)");
      for (const row of rows) { checkAbort(); insert.run(h.sourceId, row.id, row.json); }
      if (metrics !== null) {
        const c = metrics.counts;
        database.prepare("INSERT INTO source_metric_headers(source_id, contract_version, turn_count, usage_count, observation_count, diagnostic_count, metric_bytes) VALUES (?, 1, ?, ?, ?, ?, ?)")
          .run(h.sourceId, c.turn, c.usage, c.observation, c.diagnostic, metrics.bytes);
        const insertMetric = database.prepare("INSERT INTO source_metric_contributions(source_id, kind, ordinal, row_id, row_json) VALUES (?, ?, ?, ?, ?)");
        for (const row of metrics.rows) { checkAbort(); insertMetric.run(h.sourceId, row.kind, row.ordinal, row.id, row.json); }
      }
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
      return readGeneration(sourceId);
    } catch { throw new SafeError("DATABASE_ACCESS_FAILED"); }
  }
  function readGeneration(sourceId: string): StoredSource | null {
    let began = false;
    try {
      if (!database.isTransaction) { database.exec("BEGIN"); began = true; }
      const result = readPinned(sourceId);
      if (began) database.exec("COMMIT");
      return result;
    } catch (error) {
      if (began) try { database.exec("ROLLBACK"); } catch { /* Do not touch caller-owned transactions. */ }
      throw error;
    }
  }
  function readPinned(sourceId: string): StoredSource | null {
    const first = database.prepare(`SELECT h.*, m.contract_version, m.turn_count, m.usage_count, m.observation_count, m.diagnostic_count, m.metric_bytes
      FROM source_event_headers h LEFT JOIN source_metric_headers m ON m.source_id = h.source_id WHERE h.source_id = ?`).get(sourceId);
    if (first === undefined) return null;
    const header = validateHeader({ sourceId: first["source_id"], provider: first["provider"], parserVersion: first["parser_version"],
      normalizationVersion: first["normalization_version"], keyVersion: first["key_version"], keyId: first["key_id"],
      completedOffset: first["completed_offset"], observedSize: first["observed_size"], boundaryFingerprint: first["boundary_fingerprint"] }, keyId);
    const count = integer(first["event_count"]), recordedBytes = integer(first["event_bytes"]);
    if (count > MAX_SOURCE_EVENTS || recordedBytes > MAX_SOURCE_EVENT_BYTES || (first["availability"] !== "available" && first["availability"] !== "unavailable")) throw new Error();
    const hasMetrics = first["contract_version"] !== null;
    if (hasMetrics && first["contract_version"] !== 1) throw new Error();
    const expectedCounts = { turn: 0, usage: 0, observation: 0, diagnostic: 0, capabilities: hasMetrics ? 1 : 0 };
    for (const kind of ["turn", "usage", "observation", "diagnostic"] as const) {
      if (hasMetrics) { expectedCounts[kind] = integer(first[`${kind}_count`]); if (expectedCounts[kind] > METRIC_LIMITS[kind]) throw new Error(); }
      else if (first[`${kind}_count`] !== null) throw new Error();
    }
    const recordedMetricBytes = hasMetrics ? integer(first["metric_bytes"]) : 0;
    if (recordedMetricBytes > MAX_SOURCE_METRIC_BYTES || !hasMetrics && first["metric_bytes"] !== null) throw new Error();
    // Preflight actual sizes inside this pinned snapshot before any payload sort.
    // Bounded subqueries expose only lengths/counts, never JSON payloads.
    const eventBudget = database.prepare(`SELECT count(*) AS n, coalesce(sum(bytes),0) AS bytes, coalesce(max(bytes),0) AS largest, coalesce(max(id_length),0) AS id_length
      FROM (SELECT length(CAST(event_json AS BLOB)) AS bytes, length(event_id) AS id_length FROM source_event_contributions WHERE source_id=? LIMIT ?)`)
      .get(sourceId, MAX_SOURCE_EVENTS + 1)!;
    const metricBudget = database.prepare(`SELECT count(*) AS n, coalesce(sum(bytes),0) AS bytes, coalesce(max(bytes),0) AS largest, coalesce(max(id_length),0) AS id_length, coalesce(max(kind_length),0) AS kind_length
      FROM (SELECT length(CAST(row_json AS BLOB)) AS bytes, length(row_id) AS id_length, length(kind) AS kind_length FROM source_metric_contributions WHERE source_id=? LIMIT ?)`)
      .get(sourceId, MAX_SOURCE_METRIC_ROWS + 1)!;
    const metricCount = Object.values(expectedCounts).reduce((sum, n) => sum + n, 0);
    if (integer(eventBudget["n"]) !== count || integer(eventBudget["bytes"]) !== recordedBytes || integer(eventBudget["largest"]) > MAX_EVENT_BYTES || integer(eventBudget["id_length"]) > 128
      || integer(metricBudget["n"]) !== metricCount || integer(metricBudget["bytes"]) !== recordedMetricBytes || integer(metricBudget["largest"]) > MAX_METRIC_ROW_BYTES || integer(metricBudget["id_length"]) > 128 || integer(metricBudget["kind_length"]) > 12) throw new Error();
    const events: NormalizedEvent[] = [];
    const turns: (MetricEvidence["turns"][number])[] = [], usage: (MetricEvidence["usage"][number])[] = [], observations: (MetricEvidence["observations"][number])[] = [], diagnostics: (MetricEvidence["diagnostics"][number])[] = [];
    let capabilities: MetricEvidence["capabilities"] | null = null;
    const actualCounts = { turn: 0, usage: 0, observation: 0, diagnostic: 0, capabilities: 0 };
    const seen = new Set<string>();
    let bytes = 0, metricBytes = 0;
    const append = (row: typeof first) => {
      const json = row["row_json"];
      if (typeof json !== "string") throw new Error();
      const size = Buffer.byteLength(json);
      if (row["row_group"] === 1) {
        if (events.length >= count || size > MAX_EVENT_BYTES || bytes + size > MAX_SOURCE_EVENT_BYTES) throw new Error();
        bytes += size;
        const event = validateEvent(JSON.parse(json) as unknown, header);
        if (event.id !== row["row_id"] || seen.has(`event:${event.id}`)) throw new Error();
        seen.add(`event:${event.id}`); events.push(event); return;
      }
      if (row["row_group"] !== 2 || !hasMetrics || size > MAX_METRIC_ROW_BYTES || metricBytes + size > MAX_SOURCE_METRIC_BYTES) throw new Error();
      const kind = metricKind(row["kind"]);
      if (actualCounts[kind] >= expectedCounts[kind] || integer(row["ordinal"]) !== actualCounts[kind]) throw new Error();
      const item = METRIC_VALIDATORS[kind](JSON.parse(json) as unknown, header), id = "id" in item ? item.id : null;
      if (id !== row["row_id"]) throw new Error();
      if (id !== null) { const key = `${kind}:${id}`; if (seen.has(key)) throw new Error(); seen.add(key); }
      metricBytes += size; actualCounts[kind]++;
      switch (kind) {
        case "turn": turns.push(item as typeof turns[number]); break;
        case "usage": usage.push(item as typeof usage[number]); break;
        case "observation": observations.push(item as typeof observations[number]); break;
        case "diagnostic": diagnostics.push(item as typeof diagnostics[number]); break;
        case "capabilities": capabilities = item as MetricEvidence["capabilities"]; break;
      }
    };
    const eventCursor = database.prepare("SELECT 1 AS row_group, event_id AS row_id, event_json AS row_json FROM source_event_contributions WHERE source_id=? ORDER BY event_id LIMIT ?").iterate(sourceId, MAX_SOURCE_EVENTS + 1);
    try { for (const row of eventCursor) append(row); } finally { eventCursor.return?.(); }
    const metricCursor = database.prepare("SELECT 2 AS row_group, kind, ordinal, row_id, row_json FROM source_metric_contributions WHERE source_id=? ORDER BY kind,ordinal LIMIT ?").iterate(sourceId, MAX_SOURCE_METRIC_ROWS + 1);
    try { for (const row of metricCursor) append(row); } finally { metricCursor.return?.(); }
    if (events.length !== count || bytes !== recordedBytes || metricBytes !== recordedMetricBytes
      || (Object.keys(expectedCounts) as MetricKind[]).some((kind) => expectedCounts[kind] !== actualCounts[kind])) throw new Error();
    const evidence: MetricEvidence | null = hasMetrics ? Object.freeze({ turns: Object.freeze(turns), usage: Object.freeze(usage), observations: Object.freeze(observations), diagnostics: Object.freeze(diagnostics), capabilities: capabilities! }) : null;
    return Object.freeze({ ...header, revision: integer(first["revision"], 1), availability: first["availability"], events: Object.freeze(events), evidence,
      persistedScope: evidence === null ? "events_only" : "events_and_metric_evidence", aggregationReady: false, parserResumeReady: false });
  }
  function listSources(): SourceCatalogue {
    let began = false;
    try {
      if (!database.isTransaction) { database.exec("BEGIN"); began = true; }
      // CASE bounds bytes before exposing fields to JS; malformed headers never materialize unbounded text.
      const text = (column: string, maximum: number, alias: string) =>
        `CASE WHEN typeof(${column})='text' AND length(CAST(${column} AS BLOB))<=${maximum} THEN ${column} ELSE NULL END AS ${alias}`;
      const number = (column: string, alias: string) => `CASE WHEN typeof(${column})='integer' THEN ${column} ELSE NULL END AS ${alias}`;
      const columns = [
        text("h.source_id", 128, "source_id"), text("h.provider", 6, "provider"), text("h.key_id", 32, "key_id"),
        text("h.boundary_fingerprint", 128, "boundary_fingerprint"),
        // Distinguish a genuine null fingerprint from an invalid/oversized value masked by CASE.
        "(h.boundary_fingerprint IS NULL OR (typeof(h.boundary_fingerprint)='text' AND length(CAST(h.boundary_fingerprint AS BLOB))<=128)) AS fingerprint_valid",
        text("h.availability", 11, "availability"),
        ...["parser_version", "normalization_version", "key_version", "completed_offset", "observed_size", "revision", "event_count", "event_bytes"].map(c => number(`h.${c}`, c)),
        "(m.source_id IS NOT NULL) AS has_metrics",
        ...["contract_version", "turn_count", "usage_count", "observation_count", "diagnostic_count", "metric_bytes"].map(c => number(`m.${c}`, c)),
      ];
      const rows = database.prepare(`SELECT ${columns.join(",")} FROM source_event_headers h INDEXED BY sqlite_autoindex_source_event_headers_1 LEFT JOIN source_metric_headers m INDEXED BY sqlite_autoindex_source_metric_headers_1 ON m.source_id=h.source_id ORDER BY h.source_id COLLATE BINARY LIMIT 65`).all();
      const items = rows.slice(0, 64).map(row => {
        if (row["fingerprint_valid"] !== 1) throw new Error();
        const h = validateHeader({ sourceId: row["source_id"], provider: row["provider"], parserVersion: row["parser_version"],
          normalizationVersion: row["normalization_version"], keyVersion: row["key_version"], keyId: row["key_id"],
          completedOffset: row["completed_offset"], observedSize: row["observed_size"], boundaryFingerprint: row["boundary_fingerprint"] }, keyId);
        const events = integer(row["event_count"]), bytes = integer(row["event_bytes"]);
        if (events > MAX_SOURCE_EVENTS || bytes > MAX_SOURCE_EVENT_BYTES || !["available", "unavailable"].includes(row["availability"] as string)) throw new Error();
        const hasMetrics = row["has_metrics"] === 1;
        if (hasMetrics && (row["contract_version"] !== 1 || integer(row["metric_bytes"]) > MAX_SOURCE_METRIC_BYTES)) throw new Error();
        const counts: Record<"turn" | "usage" | "observation" | "diagnostic", number | null> = { turn: null, usage: null, observation: null, diagnostic: null };
        if (hasMetrics) for (const kind of ["turn", "usage", "observation", "diagnostic"] as const) {
          counts[kind] = integer(row[`${kind}_count`]); if (counts[kind]! > METRIC_LIMITS[kind]) throw new Error();
        }
        return Object.freeze({ sourceId: h.sourceId, provider: h.provider, revision: integer(row["revision"], 1),
          completedOffset: h.completedOffset, observedSize: h.observedSize, availability: row["availability"] as "available" | "unavailable",
          persistedScope: hasMetrics ? "events_and_metric_evidence" as const : "events_only" as const,
          storedCounts: Object.freeze({ events, turns: counts.turn, usage: counts.usage, observations: counts.observation, diagnostics: counts.diagnostic }) });
      });
      if (began) database.exec("COMMIT");
      return Object.freeze({ schema: "agentprof.source-catalogue/v1", limit: 64, returnedCount: items.length, truncated: rows.length > 64,
        selection: "source_id_order", snapshotConsistent: true, metadataOnly: true, sourceFreshnessChecked: false,
        crossSourceReconciled: false, aggregationReady: false, parserResumeReady: false, items: Object.freeze(items) });
    } catch {
      if (began) try { database.exec("ROLLBACK"); } catch { /* Do not touch caller-owned transactions. */ }
      throw new SafeError("DATABASE_ACCESS_FAILED");
    }
  }
  return Object.freeze({ replaceSource, replaceSourceSnapshot, markUnavailable, readSource, listSources });
}
