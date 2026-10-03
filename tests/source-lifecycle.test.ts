import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, unlink, rename, rm, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runReconcileScan, validateReconcileScanArguments, formatReconcileScan, reconcileScanExitCode } from "../src/cli/reconcile-scan.js";
import type { ReconcileScanArguments } from "../src/cli/reconcile-scan.js";
import { runScan, abortedBeforeScan } from "../src/cli/scan.js";
import { withReadOnlyStore } from "../src/db/read-only.js";
import { openDatabase } from "../src/db/database.js";
import { loadOrCreateIdentityContext } from "../src/normalize/identity.js";
import { SafeError } from "../src/privacy/diagnostics.js";
import * as stores from "../src/db/source-store.js";
import * as pathProof from "../src/scanner/lifecycle-path.js";
import * as scanner from "../src/scanner/scan-run.js";
import { freshFixture, records, appendExecution, window } from "./fresh-analysis-fixture.js";
import { bytes } from "./recovery-fixture.js";
import { runHistory } from "../src/cli/history.js";

afterEach(() => vi.restoreAllMocks());
const providers = ["codex", "claude"] as const;
async function seed(provider: "codex" | "claude" = "codex", usageTiming = false) {
  const x = await freshFixture("patterns", provider);
  const options: ReconcileScanArguments = { dataDir: x.data, reconcile: true,
    codexRoot: provider === "codex" ? [x.input] : [], claudeRoot: provider === "claude" ? [x.input] : [], usageTiming };
  const first = await runScan(options);
  expect(first.counts.committed).toBe(1);
  const sourceId = first.sources[0]!.sourceId;
  const snapshot = await withReadOnlyStore(x.data, (db, key) => stores.createSourceStore(db, key).readSource(sourceId)!);
  return { ...x, options, sourceId, snapshot, raw: await readFile(x.input, "utf8") };
}
async function selected(data: string, sourceId: string) {
  return withReadOnlyStore(data, (db, key) => stores.createSourceStore(db, key).readSource(sourceId)!);
}

describe("explicit retained source lifecycle", () => {
  it.each(providers)("%s deletion, idempotent repeat, restoration and append", async provider => {
    const x = await seed(provider);
    await unlink(x.input);
    const gone = await runReconcileScan(x.options);
    expect(gone.status).toBe("completed"); expect(gone.scan).toBeNull();
    expect(gone.counts.markedUnavailable).toBe(1); expect(gone.liveSources).toEqual([]);
    const retained = await selected(x.data, x.sourceId);
    expect(retained).toMatchObject({ availability: "unavailable", revision: x.snapshot.revision + 1, cacheEvidence: null });
    expect(retained.events).toEqual(x.snapshot.events); expect(retained.evidence).toEqual(x.snapshot.evidence);
    expect(retained.relationshipEvidence).toEqual(x.snapshot.relationshipEvidence);
    const context = await loadOrCreateIdentityContext(x.data), db = await openDatabase(x.data);
    try { expect(stores.createSourceStore(db, context.keyId).readSourceForIngestion(x.sourceId, context).checkpoint).toBeNull(); }
    finally { db.close(); }
    const before = await bytes(x.data), again = await runReconcileScan(x.options);
    expect(again.counts.alreadyUnavailable).toBe(1); expect(again.counts.markedUnavailable).toBe(0);
    expect(await bytes(x.data)).toEqual(before);
    await writeFile(x.input, x.raw);
    const restored = await runReconcileScan(x.options);
    expect(restored.counts.collected).toBe(1);
    const available = await selected(x.data, x.sourceId);
    expect(available.availability).toBe("available"); expect(available.revision).toBe(retained.revision + 1);
    expect(available.events).toEqual(x.snapshot.events); expect(available.evidence).toEqual(x.snapshot.evidence);
    await appendExecution(x.input, provider);
    const appended = await runReconcileScan(x.options);
    expect(appended.liveSources[0]!.revision).toBe(available.revision + 1);
    expect((await selected(x.data, x.sourceId)).events.length).toBeGreaterThan(available.events.length);
  });
  it.each(providers)("%s explicit archive move retains old evidence and selects only the new live source", async provider => {
    const x = await seed(provider), archive = join(x.root, "archive"); await mkdir(archive);
    const target = join(archive, "moved.jsonl"); await rename(x.input, target);
    const options = { ...x.options, codexRoot: provider === "codex" ? [x.input, target] : [], claudeRoot: provider === "claude" ? [x.input, target] : [] };
    const result = await runReconcileScan(options);
    expect(result.counts).toMatchObject({ collected: 1, markedUnavailable: 1, incomplete: 0 });
    expect(result.liveSources).toHaveLength(1); expect(result.liveSources[0]!.sourceId).not.toBe(x.sourceId);
    const old = await selected(x.data, x.sourceId), moved = await selected(x.data, result.liveSources[0]!.sourceId);
    expect(old.availability).toBe("unavailable"); expect(old.events).toEqual(x.snapshot.events);
    expect(moved.availability).toBe("available");
    expect(moved.events.map(e => e.id)).toEqual(x.snapshot.events.map(e => e.id));
    const history = await runHistory({ source: result.liveSources.map(s => s.sourceId), dataDir: x.data, ...window });
    expect(history.days.reduce((n, day) => n + day.terminalCompletions, 0)).toBe(1);
    expect(JSON.stringify(result)).not.toContain(x.input); expect(JSON.stringify(result)).not.toContain(target);
    expect(formatReconcileScan(result, false)).not.toContain("FICTITIOUS_");
  });
  it.each(providers)("%s preserves ordinary scan receipts for present files", async provider => {
    const x = await seed(provider), expected = await runScan(x.options), before = await bytes(x.data);
    const result = await runReconcileScan(x.options);
    expect(result.scan).toEqual(expected); expect(result.counts.collected).toBe(1);
    expect(await bytes(x.data)).toEqual(before);
  });
  it.each(providers)("%s composes with versioned usage capture and restores the same mode", async provider => {
    const x = await seed(provider, true); expect(x.snapshot.parserVersion).toBe(provider === "codex" ? 2 : 3);
    await unlink(x.input); await runReconcileScan(x.options); await writeFile(x.input, x.raw);
    await runReconcileScan(x.options);
    expect((await selected(x.data, x.sourceId)).parserVersion).toBe(x.snapshot.parserVersion);
    expect((await runReconcileScan(x.options)).scan?.counts.unchanged).toBe(1);
  });
  it("does not invent an entry for a missing never-stored path", async () => {
    const x = await freshFixture(); await unlink(x.input);
    const result = await runReconcileScan({ reconcile: true, codexRoot: [x.input], claudeRoot: [], dataDir: x.data });
    expect(result.counts.notStored).toBe(1); expect(result.status).toBe("completed");
    expect(await withReadOnlyStore(x.data, (db, key) => stores.createSourceStore(db, key).listSources().returnedCount)).toBe(0);
  });
  it("never retires an unselected missing source", async () => {
    const x = await seed(), other = join(dirname(x.input), "other.jsonl"); await writeFile(other, x.raw);
    const receipt = await runScan({ dataDir: x.data, codexRoot: [other], claudeRoot: [] });
    await unlink(other); await unlink(x.input); await runReconcileScan(x.options);
    expect((await selected(x.data, receipt.sources[0]!.sourceId)).availability).toBe("available");
  });
});

describe("selection and filesystem safety", () => {
  const invalid: Record<string, unknown>[] = [
    { reconcile: false }, { reconcile: "yes" }, { json: 1 }, { dataDir: 7 }, { usageTiming: "yes" },
    { codexRoot: [] }, { codexRoot: {} }, { codexRoot: new Array(1) }, { claudeRoot: null },
    { codexRoot: [7] }, { codexRoot: [""] }, { codexRoot: ["invalid\n.jsonl"] },
    { codexRoot: ["session.jsonl.gz"] }, { codexRoot: ["session.txt"] },
    { codexRoot: Array.from({ length: 17 }, (_, i) => `${i}.jsonl`) },
  ];
  it.each(invalid)("rejects invalid input before private I/O: %j", async extra => {
    const x = await freshFixture();
    const options = { reconcile: true, codexRoot: [x.input], claudeRoot: [], dataDir: x.data, ...extra } as ReconcileScanArguments;
    await expect(runReconcileScan(options)).rejects.toBeDefined();
    expect(existsSync(x.data)).toBe(false);
  });
  it("rejects duplicate aliases, mixed providers and accessor arrays", async () => {
    const x = await freshFixture(), base = { reconcile: true, codexRoot: [x.input], claudeRoot: [], dataDir: x.data };
    for (const extra of [{ codexRoot: [x.input, join(dirname(x.input), "..", "inputs", "session.jsonl")] }, { claudeRoot: [x.input] }]) {
      expect(() => validateReconcileScanArguments({ ...base, ...extra })).toThrow();
    }
    const array = [x.input], getter = vi.fn(() => x.input); Object.defineProperty(array, "0", { get: getter });
    expect(() => validateReconcileScanArguments({ ...base, codexRoot: array })).toThrow(); expect(getter).not.toHaveBeenCalled();
    expect(existsSync(x.data)).toBe(false);
  });
  it.each(["directory", "leaf-symlink", "parent-symlink", "missing-parent"])("does not bootstrap or retire on %s", async kind => {
    const x = await freshFixture(); let input = x.input;
    if (kind === "directory") { input = join(x.root, "folder.jsonl"); await mkdir(input); }
    if (kind === "leaf-symlink") { input = join(x.root, "link.jsonl"); await symlink(x.input, input); }
    if (kind === "parent-symlink") { const dir = join(x.root, "link"); await symlink(dirname(x.input), dir); input = join(dir, "session.jsonl"); }
    if (kind === "missing-parent") input = join(x.root, "gone", "session.jsonl");
    await expect(runReconcileScan({ reconcile: true, codexRoot: [input], claudeRoot: [], dataDir: x.data })).rejects.toBeDefined();
    expect(existsSync(x.data)).toBe(false);
  });
  it("missing parent for an existing source preserves availability and private bytes", async () => {
    const x = await seed(); await rm(dirname(x.input), { recursive: true }); const before = await bytes(x.data);
    await expect(runReconcileScan(x.options)).rejects.toBeDefined();
    expect(await bytes(x.data)).toEqual(before); expect((await selected(x.data, x.sourceId)).availability).toBe("available");
  });
});

describe("post-preflight changes and generation guards", () => {
  it.each(["reappeared", "parent_changed", "access_failed"])("retains a source on %s", async kind => {
    const x = await seed(); await unlink(x.input); const before = await bytes(x.data);
    const inspect = pathProof.inspectLifecyclePath; let n = 0;
    vi.spyOn(pathProof, "inspectLifecyclePath").mockImplementation(async input => {
      if (input === x.input && ++n === 2) {
        if (kind === "reappeared") await writeFile(x.input, x.raw);
        if (kind === "parent_changed") { await rename(dirname(input), dirname(input) + "-old"); await mkdir(dirname(input)); }
        if (kind === "access_failed") throw new SafeError("INPUT_ACCESS_FAILED");
      }
      return inspect(input);
    });
    const result = await runReconcileScan(x.options);
    expect(result.status).toBe("partial"); expect(result.counts.markedUnavailable).toBe(0);
    expect(result.files[0]!.status).toBe(kind === "access_failed" ? "failed" : "changed_during_check");
    expect(await bytes(x.data)).toEqual(before);
  });
  it("observes a real intervening generation and does not retire it again", async () => {
    const x = await seed(); await unlink(x.input); const inspect = pathProof.inspectLifecyclePath; let n = 0;
    vi.spyOn(pathProof, "inspectLifecyclePath").mockImplementation(async input => {
      if (++n === 2) {
        const context = await loadOrCreateIdentityContext(x.data), db = await openDatabase(x.data);
        try { expect(stores.createSourceStore(db, context.keyId).markUnavailable(x.sourceId, x.snapshot.revision).status).toBe("committed"); }
        finally { db.close(); }
      }
      return inspect(input);
    });
    const result = await runReconcileScan(x.options);
    expect(result.files[0]).toMatchObject({ status: "stale", revisionBefore: 1, revisionAfter: 2 });
    expect((await selected(x.data, x.sourceId)).revision).toBe(2); expect(reconcileScanExitCode(result)).toBe(1);
  });
  it("the final CAS write refuses a newer revision after the last authenticated read", async () => {
    const x = await seed(); await unlink(x.input); const create = stores.createSourceStore;
    vi.spyOn(stores, "createSourceStore").mockImplementation((db, key) => {
      const store = create(db, key);
      return { ...store, markUnavailable: (sourceId, expectedRevision, signal) => {
        expect(store.markUnavailable(sourceId, expectedRevision).status).toBe("committed");
        return store.markUnavailable(sourceId, expectedRevision, signal);
      } };
    });
    const result = await runReconcileScan(x.options); expect(result.files[0]).toMatchObject({ status: "stale", revisionAfter: 2 });
    expect((await selected(x.data, x.sourceId)).revision).toBe(2);
  });
  it("does not remove a corrupt checkpoint while retiring a missing source", async () => {
    const x = await seed(); await unlink(x.input); const db = await openDatabase(x.data);
    try { expect(db.prepare("UPDATE source_parser_checkpoints SET checkpoint_json='{}' WHERE source_id=?").run(x.sourceId).changes).toBe(1); }
    finally { db.close(); }
    const before = await bytes(x.data);
    await expect(runReconcileScan(x.options)).rejects.toMatchObject({ code: "DATABASE_ACCESS_FAILED" });
    expect(await bytes(x.data)).toEqual(before);
  });
  it("does not reset a store when the installed key ID changes", async () => {
    const x = await seed(); await unlink(x.input); const path = join(x.data, "identity-key.json");
    const key = JSON.parse(await readFile(path, "utf8")); key.keyId = key.keyId === "e".repeat(32) ? "d".repeat(32) : "e".repeat(32);
    await writeFile(path, JSON.stringify(key) + "\n", { mode: 0o600 }); const before = await bytes(x.data);
    await expect(runReconcileScan(x.options)).rejects.toBeDefined(); expect(await bytes(x.data)).toEqual(before);
  });
  it("pre-abort creates no storage and removes only its listeners", async () => {
    const x = await freshFixture(), controller = new AbortController(); controller.abort();
    const listener = () => undefined; process.on("SIGINT", listener); const count = process.listenerCount("SIGINT");
    try {
      const result = await runReconcileScan({ reconcile: true, codexRoot: [x.input], claudeRoot: [], dataDir: x.data }, { signal: controller.signal });
      expect(reconcileScanExitCode(result)).toBe(130); expect(result.unprocessedInputs).toBe(1);
      expect(existsSync(x.data)).toBe(false); expect(process.listenerCount("SIGINT")).toBe(count);
    } finally { process.removeListener("SIGINT", listener); }
  });
  it("post-preflight abort retains the previous generation", async () => {
    const x = await seed(); await unlink(x.input); const before = await bytes(x.data), control = new AbortController();
    const inspect = pathProof.inspectLifecyclePath; let n = 0;
    vi.spyOn(pathProof, "inspectLifecyclePath").mockImplementation(async path => { const value = await inspect(path); if (++n === 2) control.abort(); return value; });
    const result = await runReconcileScan(x.options, { signal: control.signal });
    expect(result.status).toBe("aborted"); expect(result.files[0]!.status).toBe("skipped"); expect(await bytes(x.data)).toEqual(before);
  });
  it("a collection storage failure prevents missing-source retirement", async () => {
    const x = await seed(); await unlink(x.input); const live = join(dirname(x.input), "live.jsonl"); await writeFile(live, x.raw);
    const before = await bytes(x.data);
    vi.spyOn(scanner, "scanSources").mockResolvedValue({ ...abortedBeforeScan(), status: "partial", stopReason: "storage_failure" });
    const result = await runReconcileScan({ ...x.options, codexRoot: [x.input, live] });
    expect(result.status).toBe("partial"); expect(result.counts.markedUnavailable).toBe(0); expect(await bytes(x.data)).toEqual(before);
  });
});
