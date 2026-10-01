import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { summarizeSource } from "../src/analysis/source-summary.js";
import { openDatabase } from "../src/db/database.js";
import { createSourceStore } from "../src/db/source-store.js";
import type { SourceSnapshotInput } from "../src/db/source-store.js";
import { createIdentityContext } from "../src/normalize/identity.js";
import { createCodexAdapter } from "../src/parsers/codex/index.js";
import { createClaudeAdapter } from "../src/parsers/claude/index.js";
import type { TrustedFixtureContext } from "../src/parsers/types.js";
import type { ClaudeTrustedFixtureContext } from "../src/parsers/claude/types.js";
import { temporaryDirectory } from "./helpers.js";

const context = createIdentityContext(new Uint8Array(32).fill(61), "6".repeat(32));
const fixtures = fileURLToPath(new URL("fixtures/providers/", import.meta.url));
async function fixture(name: string, fileIdentity = "SYNTHETIC_SOURCE_SUMMARY", trusted = false): Promise<SourceSnapshotInput> {
  const provider = name.startsWith("codex") ? "codex" : "claude", bytes = await readFile(join(fixtures, name));
  const codex = createCodexAdapter(context), claude = createClaudeAdapter(context);
  const codexProof: TrustedFixtureContext = { usageEvidence: [1, 2, 3].map((ordinal) => ({ ordinal, finality: ordinal === 3 ? "final" : "partial", order: ordinal, orderingGroup: "synthetic-summary-proof", mapping: "openai_responses" })) };
  const claudeProof: ClaudeTrustedFixtureContext = { usageEvidence: [0, 1, 2].map((ordinal) => ({ ordinal, messageId: "synthetic-p3-response", finality: ordinal === 2 ? "final" : "partial", order: ordinal, orderingGroup: "synthetic-summary-proof", mapping: "anthropic_messages" })) };
  let start = 0, ordinal = 0;
  while (start < bytes.length) {
    const end = bytes.indexOf(10, start); if (end < 0) break;
    const point = { fileIdentity, byteOffset: start, ordinal: ordinal++, sourceAlias: "source-1" }, record = JSON.parse(bytes.subarray(start, end).toString("utf8"));
    if (provider === "codex") codex.ingest(record, { ...point, ...(trusted ? { trustedFixtureContext: codexProof } : {}) });
    else claude.ingest(record, { ...point, ...(trusted ? { trustedFixtureContext: claudeProof } : {}) });
    start = end + 1;
  }
  const snapshot = (provider === "codex" ? codex : claude).snapshot();
  return { sourceId: context.fingerprint("source", [provider, fileIdentity]), provider, parserVersion: 1, normalizationVersion: 1, keyVersion: 1, keyId: context.keyId,
    completedOffset: start, observedSize: bytes.length, boundaryFingerprint: start ? context.fingerprint("content", ["synthetic-boundary", start]) : null,
    events: snapshot.events, evidence: { turns: snapshot.turns, usage: snapshot.usage, observations: snapshot.observations, diagnostics: snapshot.diagnostics, capabilities: snapshot.capabilities } };
}
async function fileBytes(directory: string): Promise<Record<string, Buffer>> {
  const files: Record<string, Buffer> = {};
  for (const name of (await readdir(directory)).sort()) files[name] = await readFile(join(directory, name));
  return files;
}

describe("validated persisted source summary", () => {
  it.each(["codex-real-shapes.jsonl", "claude-real-shapes.jsonl"])("summarizes %s after close/reopen without mutation or raw payload", async (name) => {
    const input = await fixture(name), directory = temporaryDirectory(), originalBytes = await readFile(join(fixtures, name));
    let db = await openDatabase(directory);
    try {
      expect(createSourceStore(db, context.keyId).replaceSourceSnapshot(input, null)).toEqual({ status: "committed", revision: 1 });
      db.close(); db = await openDatabase(directory);
      const store = createSourceStore(db, context.keyId), saved = store.readSource(input.sourceId)!;
      const before = await fileBytes(directory), serialized = JSON.stringify(saved), result = summarizeSource(saved);
      expect(await fileBytes(directory)).toEqual(before); expect(JSON.stringify(saved)).toBe(serialized);
      expect(store.readSource(input.sourceId)).toEqual(saved); expect(await readFile(join(fixtures, name))).toEqual(originalBytes);
      expect(result).toMatchObject({ revision: 1, completedOffset: input.completedOffset, observedSize: input.observedSize, persistedScope: "events_and_metric_evidence", suppressionReason: null, crossSourceReconciled: false, aggregationReady: false, parserResumeReady: false });
      expect(JSON.stringify(result)).not.toMatch(/FICTITIOUS_|SYNTHETIC_SOURCE_SUMMARY|sourceRef|boundaryFingerprint|instructions|stdout|https:\/\/fixture/);
      expect(result.inventory.events).toBe(input.events.length); expect(result.durations!.length).toBeGreaterThan(0);
      if (name.startsWith("codex")) {
        expect(result.usage![0]).toMatchObject({ finality: "source_terminal", observedResponses: 1, counts: { input: 80, output: 12, total: 92, cachedInput: 20 } });
        expect(result.inventory.eventOutcomes.no_match).toBe(1); expect(result.usageEligibility!.exclusions.cumulative_snapshot).toBe(2);
      } else {
        expect(result.usage).toBeNull(); expect(result.usageEligibility!.exclusions.provisional).toBeGreaterThan(0);
        expect(result.inventory.eventStatuses.pending).toBe(2); expect(result.durationEligibility.exclusions.pending).toBe(2);
      }
      expect(store.replaceSourceSnapshot(input, saved.revision)).toEqual({ status: "committed", revision: 2 });
      const again = summarizeSource(store.readSource(input.sourceId)!);
      expect({ ...again, revision: 1 }).toEqual(result);
    } finally { db.close(); }
  });
  it("selects trusted fixture partial-to-final usage once for both providers, without promoting real Claude finality", async () => {
    const db = await openDatabase(temporaryDirectory()), store = createSourceStore(db, context.keyId);
    try {
      for (const name of ["codex-usage-replay.jsonl", "claude-real-shapes.jsonl"]) {
        const input = await fixture(name, name, true); store.replaceSourceSnapshot(input, null);
        const result = summarizeSource(store.readSource(input.sourceId)!);
        expect(result.usageEligibility!.observedResponses).toBe(1);
        expect(result.usage![0]).toMatchObject({ finality: "trusted_final", observedResponses: 1, counts: { output: 10, total: name.startsWith("codex") ? 110 : 160 } });
        if (name.startsWith("codex")) expect(result.usageEligibility!.exclusions).toMatchObject({ cumulative_snapshot: 1, unverified_snapshot: 2 });
        else expect(result.usage![0]!.counts).toMatchObject({ input: 150, uncachedInput: 100, cachedInput: 30, cacheWriteInput: 20, reasoningOutput: null });
      }
    } finally { db.close(); }
  });
  it("does not reconcile source variants and preserves missing, historical and unavailable distinctions", async () => {
    const db = await openDatabase(temporaryDirectory()), store = createSourceStore(db, context.keyId);
    try {
      const a = await fixture("codex-real-shapes.jsonl", "source-a"), b = await fixture("codex-real-shapes.jsonl", "source-b");
      expect(store.readSource(a.sourceId)).toBeNull();
      store.replaceSourceSnapshot(a, null); store.replaceSourceSnapshot(b, null);
      const one = summarizeSource(store.readSource(a.sourceId)!), two = summarizeSource(store.readSource(b.sourceId)!);
      expect(one.sourceId).not.toBe(two.sourceId); expect(one.usage).toEqual(two.usage); expect(one.durations).toEqual(two.durations);
      store.markUnavailable(a.sourceId, 1);
      expect(summarizeSource(store.readSource(a.sourceId)!)).toMatchObject({ suppressionReason: "source_unavailable", durations: null, usage: null, revision: 2 });
      const { evidence: _omitted, ...eventOnly } = b; store.replaceSource(eventOnly, 1);
      expect(summarizeSource(store.readSource(b.sourceId)!)).toMatchObject({ suppressionReason: "evidence_absent", durations: null, usage: null, revision: 2 });
    } finally { db.close(); }
  });
  it("suppresses ambiguous persisted evidence and state-limited capabilities", async () => {
    const db = await openDatabase(temporaryDirectory()), store = createSourceStore(db, context.keyId);
    try {
      for (const name of ["codex-fork.jsonl", "claude-fork.jsonl"]) {
        const input = await fixture(name); store.replaceSourceSnapshot(input, null);
        expect(summarizeSource(store.readSource(input.sourceId)!)).toMatchObject({ suppressionReason: "ambiguous_origin", usage: null, durations: null });
      }
      const input = await fixture("codex-real-shapes.jsonl", "limited");
      store.replaceSourceSnapshot({ ...input, evidence: { ...input.evidence, capabilities: { ...input.evidence.capabilities, stateLimited: true } } }, null);
      expect(summarizeSource(store.readSource(input.sourceId)!)).toMatchObject({ suppressionReason: "state_limited", usage: null, durations: null });
    } finally { db.close(); }
  });
  it("reconciles duplicate responses across persisted row IDs before cohort partitioning", async () => {
    const db = await openDatabase(temporaryDirectory()), store = createSourceStore(db, context.keyId);
    try {
      const input = await fixture("codex-real-shapes.jsonl"), response = input.evidence.usage.find((u) => u.source === "response_usage")!;
      const duplicate = { ...response, id: context.fingerprint("event", ["duplicate-summary-row"]), sourceRef: { ...response.sourceRef, byteOffset: response.sourceRef.byteOffset + 1 } };
      const identical = { ...input, evidence: { ...input.evidence, usage: [response, duplicate] } };
      store.replaceSourceSnapshot(identical, null);
      const once = summarizeSource(store.readSource(input.sourceId)!);
      expect(once.usage![0]!.counts.total).toBe(92); expect(once.usageEligibility).toMatchObject({ observedResponses: 1, selectedRows: 1, deduplicatedRows: 1 });
      store.replaceSourceSnapshot({ ...identical, evidence: { ...identical.evidence, usage: [response, { ...duplicate, finality: "trusted_final" }] } }, 1);
      const conflict = summarizeSource(store.readSource(input.sourceId)!);
      expect(conflict.usage).toBeNull(); expect(conflict.usageEligibility).toMatchObject({ excludedRows: 2, excludedResponseGroups: 1, exclusions: { duplicate_response_conflict: 2 } });
    } finally { db.close(); }
  });
  it("does not weaken store validation to allow incomplete final components", async () => {
    const db = await openDatabase(temporaryDirectory()), store = createSourceStore(db, context.keyId);
    try {
      const input = await fixture("codex-real-shapes.jsonl"), response = input.evidence.usage.find((u) => u.source === "response_usage")!;
      expect(() => store.replaceSourceSnapshot({ ...input, evidence: { ...input.evidence, usage: [{ ...response, counts: { ...response.counts!, cachedInput: null } }] } }, null)).toThrow();
      const partial = { ...response, countStatus: "partial" as const, limitations: ["partial_counts" as const], counts: { ...response.counts!, cachedInput: null } };
      store.replaceSourceSnapshot({ ...input, evidence: { ...input.evidence, usage: [partial] } }, null);
      expect(summarizeSource(store.readSource(input.sourceId)!)).toMatchObject({ usage: null, usageEligibility: { exclusions: { incomplete_components: 1 } } });
    } finally { db.close(); }
  });
});
