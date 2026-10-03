import { appendFile, readFile, rm } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexAdapter } from "../src/parsers/codex/index.js";
import { ClaudeAdapter } from "../src/parsers/claude/index.js";
import { validateCaptureOptions } from "../src/parsers/capture.js";
import { openDatabase } from "../src/db/database.js";
import { createSourceStore } from "../src/db/source-store.js";
import { runScan } from "../src/cli/scan.js";
import { withReadOnlyStore } from "../src/db/read-only.js";
import { adapter, at, afterMidnight, context, records, record, feed, input, stored, memory, disk, bytes, encode, keyId } from "./usage-timing-fixture.js";
const providers = ["codex", "claude"] as const;
afterEach(() => vi.restoreAllMocks());

describe("timestamp-only parser versions", () => {
  it.each(providers)("%s retains all legacy semantics and exposes only safe usage record timestamps", provider => {
    const timed = input(provider), legacy = input(provider, records(provider), "FICTITIOUS_USAGE_FILE", false);
    expect(timed.parserVersion).toBe(provider === "codex" ? 2 : 3);
    expect(timed.events).toEqual(legacy.events);
    expect(timed.evidence.usage).toEqual(legacy.evidence.usage);
    expect(timed.evidence.turns).toEqual(legacy.evidence.turns);
    expect(timed.evidence.diagnostics).toEqual(legacy.evidence.diagnostics);
    expect(timed.evidence.observations.map(({ usageObservedAt: _, ...o }) => o)).toEqual(legacy.evidence.observations);
    expect(timed.evidence.observations.filter(o => o.representation === "usage").map(o => o.usageObservedAt)).toEqual([at, afterMidnight]);
    expect(timed.evidence.observations.filter(o => o.representation !== "usage").every(o => o.usageObservedAt === null)).toBe(true);
    expect(stored(timed).evidence!.observations).toEqual(timed.evidence.observations);
    expect(JSON.stringify(stored(timed))).not.toContain("FICTITIOUS_");
  });
  for (const provider of providers) it.each([null, "invalid", "2026-02-30T00:00:00Z", {}, 1e30])(`${provider} does not fabricate a date from invalid timestamp %j`, time => {
    const base = provider === "codex" ? [records(provider)[0]] : [];
    const s = input(provider, [...base, record(provider, "response", time)]);
    expect(s.evidence.observations.filter(o => o.representation === "usage").map(o => o.usageObservedAt)).toEqual([null]);
    expect(s.evidence.usage[0]!.selection).toBe(provider === "codex" ? "eligible" : "provisional");
  });
  it.each(providers)("%s missing timestamp remains null without neighboring metadata/mtime fallback", provider => {
    const rows = records(provider); const r = record(provider) as Record<string, unknown>; delete r.timestamp;
    rows[rows.length - 1] = r as never;
    const s = input(provider, rows);
    expect(s.evidence.observations.filter(o => o.representation === "usage").at(-1)!.usageObservedAt).toBeNull();
  });
  it.each([null, 1, { usageTiming: undefined }, { usageTiming: "yes" }, { raw: "FICTITIOUS_SECRET" }, Object.defineProperty({}, "usageTiming", { get: () => { throw Error("getter executed"); }, enumerable: true }), new Proxy({}, {})])("rejects invalid capture options without executable property access", value => {
    expect(() => validateCaptureOptions(value as never)).toThrow();
  });
});

describe("authenticated codec splits and strict version boundaries", () => {
  for (const provider of providers) for (let split = 0; split <= records(provider).length; split++) it(`${provider} split ${split} restores full timestamp and legacy meaning`, () => {
    const all = records(provider), prefix = all.slice(0, split), a = adapter(provider), size = feed(a, prefix);
    const binding = { sourceId: context.fingerprint("source", [provider, "FICTITIOUS_USAGE_FILE"]), completedOffset: size, nextOrdinal: split };
    const captured = a.exportCheckpoint(binding); expect(captured.status).toBe("captured");
    if (captured.status !== "captured") throw new Error("capture missing");
    const Type = provider === "codex" ? CodexAdapter : ClaudeAdapter;
    expect(Type.restoreCheckpoint(context, captured.checkpoint, binding).status).toBe("rejected");
    const resumed = Type.restoreCheckpoint(context, captured.checkpoint, binding, {}, { usageTiming: true }); expect(resumed.status).toBe("restored");
    if (resumed.status !== "restored") throw new Error("restore missing");
    feed(resumed.adapter, all.slice(split), "FICTITIOUS_USAGE_FILE", size, split);
    const cold = adapter(provider); feed(cold, all);
    expect(resumed.adapter.snapshot()).toEqual(cold.snapshot());
    expect(captured.checkpoint).not.toContain("FICTITIOUS_");
  });
  it.each(providers)("%s cannot restore a legacy checkpoint as timestamp-captured evidence", provider => {
    const a = adapter(provider, false), size = feed(a, records(provider));
    const binding = { sourceId: context.fingerprint("source", [provider, "FICTITIOUS_USAGE_FILE"]), completedOffset: size, nextOrdinal: records(provider).length };
    const captured = a.exportCheckpoint(binding); expect(captured.status).toBe("captured"); if (captured.status !== "captured") return;
    const Type = provider === "codex" ? CodexAdapter : ClaudeAdapter;
    expect(Type.restoreCheckpoint(context, captured.checkpoint, binding, {}, { usageTiming: true }).status).toBe("rejected");
  });
  for (const provider of providers) it.each(["missing", "extra", "wrong-type", "nonusage-time"])(`${provider} rejects %s timestamp row before writes`, mode => {
    const x = input(provider), { store } = memory(); store.replaceSourceSnapshot(x, null); const before = store.readSource(x.sourceId);
    const bad = structuredClone(x) as any, rows = bad.evidence.observations;
    const o = rows.find((r: any) => mode === "nonusage-time" ? r.representation !== "usage" : r.representation === "usage");
    if (mode === "missing") delete o.usageObservedAt;
    if (mode === "extra") o.raw = "FICTITIOUS_SECRET";
    if (mode === "wrong-type") o.usageObservedAt = 42;
    if (mode === "nonusage-time") o.usageObservedAt = at;
    expect(() => store.replaceSourceSnapshot(bad, 1)).toThrow(); expect(store.readSource(x.sourceId)).toEqual(before);
  });
});

describe("real scan/store/reopen lifecycle for both modes", () => {
  it.each(providers)("%s upgrades by full replay, reuses, resumes append and can explicitly downgrade", async provider => {
    const x = await disk(provider); const original = await readFile(x.path);
    expect((await runScan(x.options)).counts.committed).toBe(1);
    const Type = provider === "codex" ? CodexAdapter : ClaudeAdapter, ingest = vi.spyOn(Type.prototype, "ingest");
    const timed = await runScan({ ...x.options, usageTiming: true }); expect(timed.sources[0]!.committedRevision).toBe(2);
    expect(ingest).toHaveBeenCalledTimes(records(provider).length); ingest.mockClear();
    const previous = await bytes(x.data);
    const reused = await runScan({ ...x.options, usageTiming: true }); expect(reused.counts.unchanged).toBe(1); expect(reused.sources[0]!.reusedRevision).toBe(2);
    expect(ingest).not.toHaveBeenCalled(); expect(await bytes(x.data)).toEqual(previous);
    await appendFile(x.path, encode([record(provider, "response-three", "2026-10-04T01:00:00.000Z", 30)]));
    const appended = await runScan({ ...x.options, usageTiming: true }); expect(appended.sources[0]!.committedRevision).toBe(3); expect(ingest).toHaveBeenCalledTimes(1);
    const selected = await withReadOnlyStore(x.data, (db, key) => createSourceStore(db, key).readSource(x.sourceId)!);
    expect(selected.evidence!.observations.filter(o => o.representation === "usage").map(o => o.usageObservedAt)).toEqual([at, afterMidnight, "2026-10-04T01:00:00.000Z"]);
    expect(selected.evidence!.usage).toHaveLength(3);
    ingest.mockClear();
    const downgraded = await runScan(x.options); expect(downgraded.sources[0]!.committedRevision).toBe(4); expect(ingest).toHaveBeenCalledTimes(records(provider).length + 1);
    const legacy = await withReadOnlyStore(x.data, (db, key) => createSourceStore(db, key).readSource(x.sourceId)!);
    expect(legacy.parserVersion).toBe(provider === "codex" ? 1 : 2);
    expect(legacy.evidence!.observations.every(o => !Object.hasOwn(o, "usageObservedAt"))).toBe(true);
    expect((await readFile(x.path)).subarray(0, original.length)).toEqual(original);
  });
  it.each(providers)("%s authenticates timestamp rows against the saved checkpoint and refuses tampering", async provider => {
    const x = await disk(provider); await runScan({ ...x.options, usageTiming: true });
    const db = await openDatabase(x.data), store = createSourceStore(db, keyId);
    try {
      expect(store.readSourceForIngestion(x.sourceId, context).checkpoint).not.toBeNull();
      const r = db.prepare("SELECT ordinal,row_json FROM source_metric_contributions WHERE source_id=? AND kind='observation' AND row_json LIKE '%14:59:59%' LIMIT 1").get(x.sourceId)!;
      const text = String(r.row_json).replace("14:59:59", "14:59:58");
      db.prepare("UPDATE source_metric_contributions SET row_json=? WHERE source_id=? AND kind='observation' AND ordinal=?").run(text, x.sourceId, r.ordinal!);
      expect(() => store.readSourceForIngestion(x.sourceId, context)).toThrow();
    } finally { db.close(); }
    const before = await bytes(x.data); const result = await runScan({ ...x.options, usageTiming: true });
    expect(result.counts.failed).toBe(1); expect(result.counts.committed).toBe(0); expect(await bytes(x.data)).toEqual(before);
    await rm(x.inputRoot, { recursive: true });
  });
});

it.each(providers)("%s rejects nonempty legacy observations relabeled as timestamp-enabled", provider => {
  const x = input(provider, records(provider), "FICTITIOUS_USAGE_FILE", false), { store } = memory();
  const version = provider === "codex" ? 2 : 3;
  store.replaceSourceSnapshot(x, null); const before = store.readSource(x.sourceId);
  expect(() => store.replaceSourceSnapshot({ ...x, parserVersion: version, evidence: { ...x.evidence, capabilities: { ...x.evidence.capabilities, parserVersion: version } } } as never, 1)).toThrow();
  expect(store.readSource(x.sourceId)).toEqual(before);
});
it.each(providers)("%s accepts a genuine empty timing-enabled generation", provider => {
  const x = input(provider, []), s = stored(x);
  expect(s.parserVersion).toBe(provider === "codex" ? 2 : 3);
  expect(s.evidence!.observations).toEqual([]);
});
