import { appendFile, copyFile, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db/database.js";
import { createIdentityContext } from "../src/normalize/identity.js";
import { createSourceStore } from "../src/db/source-store.js";
import { createDirectoryMembershipStore } from "../src/db/directory-membership.js";
import { retireDirectoryAbsences, retireDirectoryBatchAbsences } from "../src/db/directory-retirement.js";
import { enrollDirectory } from "../src/scanner/directory-enrollment.js";
import { scanDirectoryPages } from "../src/scanner/directory-batches.js";
import { censusDirectory, censusDirectoryBatched, DIRECTORY_BATCH_LIMITS } from "../src/scanner/directory-census.js";
import { reconcileDirectoryAbsence } from "../src/scanner/directory-reconciliation.js";
import { formatDirectoryScan, projectDirectoryEnrollment } from "../src/cli/directory-scan.js";
import * as scans from "../src/scanner/scan-run.js";
import { temporaryDirectory } from "./helpers.js";

const context = createIdentityContext(Buffer.alloc(32, 107), "c".repeat(32));
const connections = new Set<DatabaseSync>();
afterEach(() => { vi.restoreAllMocks(); for (const db of connections) db.close(); connections.clear(); });
const fixturePath = (provider: string) => fileURLToPath(new URL(`./fixtures/providers/${provider}-real-shapes.jsonl`, import.meta.url));
async function fixture(provider: "codex" | "claude" = "codex", count = 65, populated = false) {
  const base = temporaryDirectory(), root = { provider, path: join(base, "FICTITIOUS_BATCH_ROOT") };
  await mkdir(root.path);
  const paths = Array.from({ length: count }, (_, i) => join(root.path, `FICTITIOUS_${String(i).padStart(4, "0")}.jsonl`));
  for (const path of paths) { if (populated) await copyFile(fixturePath(provider), path); else await writeFile(path, ""); }
  const db = await openDatabase(join(base, "private")); connections.add(db);
  const memberships = createDirectoryMembershipStore(db, context), sources = createSourceStore(db, context.keyId);
  const rootId = context.fingerprint("source", ["directory_root_v1", provider, root.path]);
  return { base, root, paths, db, memberships, sources, rootId };
}
const memberRows = (db: DatabaseSync) => ["directory_membership_roots", "directory_membership_members"].map(t => db.prepare(`SELECT * FROM ${t} ORDER BY 1,2`).all());
const sourceRows = (db: DatabaseSync) => ["source_event_headers", "source_event_contributions", "source_metric_headers", "source_metric_contributions", "source_cache_evidence", "source_parser_checkpoints", "source_relationship_headers", "source_relationship_contributions"].map(t => db.prepare(`SELECT * FROM ${t} ORDER BY 1,2`).all());
const collect = (f: Awaited<ReturnType<typeof fixture>>, extras = {}) => enrollDirectory(f.db, context, f.root, { batchDirectory: true, ...extras });

it.each(["codex", "claude"] as const)("pages 65 real %s inputs, retaining versions, aliases, warnings and exact source evidence", async provider => {
  const f = await fixture(provider, 65, true), original = scans.scanSources;
  const spy = vi.spyOn(scans, "scanSources");
  for (const [mode, version] of [[{}, provider === "codex" ? 1 : 2], [{ usageTiming: true }, provider === "codex" ? 2 : 3], [{ patternEvidence: true }, provider === "codex" ? 3 : 4]] as const) {
    spy.mockClear(); spy.mockImplementation(original);
    const r = await collect(f, mode);
    expect(r.membership).toMatchObject({ status: "committed", memberCount: 65 });
    expect(r.scan!.counts).toMatchObject({ discovered: 65, attempted: 65, committed: 65, failed: 0, rejected: 0 });
    expect(r.scan!.status).toBe("partial"); // Real fixture coverage warnings stay visible.
    expect(spy.mock.calls.map(call => call[2].length)).toEqual([16, 16, 16, 16, 1]);
    expect(r.scan!.sources.map(s => s.sourceAlias)).toEqual(Array.from({ length: 65 }, (_, i) => `source-${i + 1}`));
    for (const source of r.scan!.sources) expect(f.sources.readSource(source.sourceId)!.parserVersion).toBe(version);
    const before = sourceRows(f.db), again = await collect(f, mode);
    expect(again.membership.status).toBe("unchanged"); expect(again.scan!.counts.unchanged).toBe(65);
    expect(sourceRows(f.db)).toEqual(before);
    const output = formatDirectoryScan(projectDirectoryEnrollment(again, f.memberships.read(f.rootId)), true);
    expect(JSON.parse(output).result.snapshot.members).toHaveLength(65);
    expect(output).not.toMatch(/FICTITIOUS_|rootFingerprint|"seal"/);
  }
  expect(scans.SCAN_LIMITS.sources).toBe(64); expect(scans.SCAN_LIMITS.roots).toBe(16);
}, 30000);

it("retains the ordinary 64/65 boundary and false/absent option equality", async () => {
  const f = await fixture("codex", 64);
  const plain = await enrollDirectory(f.db, context, f.root);
  expect(plain.membership).toMatchObject({ status: "committed", memberCount: 64 });
  const a = await enrollDirectory(f.db, context, f.root), b = await enrollDirectory(f.db, context, f.root, { batchDirectory: false });
  expect(b).toEqual(a);
  await writeFile(join(f.root.path, "extra.jsonl"), ""); const before = memberRows(f.db);
  const old = await enrollDirectory(f.db, context, f.root);
  expect(old).toMatchObject({ scan: null, membership: { status: "ineligible", reason: "limit" } });
  expect(memberRows(f.db)).toEqual(before);
  expect((await collect(f)).membership).toMatchObject({ status: "committed", memberCount: 65 });
});

it("captures empty and nested directories once, then preserves absence history and reappearance", async () => {
  const f = await fixture("claude", 0), spy = vi.spyOn(scans, "scanSources");
  expect((await collect(f)).membership).toMatchObject({ status: "committed", memberCount: 0 });
  expect(spy).not.toHaveBeenCalled();
  const nested = join(f.root.path, "nested"); await mkdir(nested);
  for (let i = 0; i < 70; i++) await writeFile(join(nested, `${i}.jsonl`), "");
  const first = await collect(f), before = sourceRows(f.db);
  expect(first.membership).toMatchObject({ status: "committed", memberCount: 70 });
  await rm(join(nested, "1.jsonl"));
  const absent = await collect(f); expect(absent.membership.status).toBe("committed");
  expect(f.memberships.read(f.rootId)!.members.filter(m => m.observation === "not_observed")).toHaveLength(1);
  expect(sourceRows(f.db)).toEqual(before);
  await writeFile(join(nested, "1.jsonl"), ""); expect((await collect(f)).membership.status).toBe("committed");
  expect(f.memberships.read(f.rootId)!.members.every(m => m.observation === "observed")).toBe(true);
});

it.each(["add", "remove", "replace_directory"] as const)("rejects %s between pages without replacing prior membership", async kind => {
  const f = await fixture(), original = scans.scanSources; await collect(f); const prior = memberRows(f.db);
  const nested = join(f.root.path, "nested"); await mkdir(nested); let calls = 0;
  vi.spyOn(scans, "scanSources").mockImplementation(async (...args) => {
    const r = await original(...args);
    if (++calls === 1) {
      if (kind === "add") await writeFile(join(f.root.path, "new.jsonl"), "");
      else if (kind === "remove") await rm(f.paths[0]!);
      else { await rename(nested, nested + "-old"); await mkdir(nested); }
    }
    return r;
  });
  expect((await collect(f)).membership).toMatchObject({ status: "ineligible", reason: "census_changed" });
  expect(memberRows(f.db)).toEqual(prior);
});

it("stops at a rejected middle page, retaining earlier commits and the full prior membership", async () => {
  const f = await fixture(); await collect(f); const prior = memberRows(f.db);
  await writeFile(f.paths[16]!, "\n"); // An invalid complete record cannot be silently excluded.
  const spy = vi.spyOn(scans, "scanSources"), r = await collect(f);
  expect(r.membership).toMatchObject({ status: "ineligible", reason: "scan_incomplete" });
  expect(r.scan!.counts.rejected).toBe(1); expect(spy).toHaveBeenCalledTimes(2);
  expect(memberRows(f.db)).toEqual(prior); expect(f.db.prepare("SELECT count(*) n FROM source_event_headers").get()!.n).toBe(65);
});

it.each([1, 5])("aborts after page %i without a membership commit or losing completed source commits", async page => {
  const f = await fixture(), original = scans.scanSources, controller = new AbortController(); let calls = 0;
  vi.spyOn(scans, "scanSources").mockImplementation(async (...args) => { const r = await original(...args); if (++calls === page) controller.abort(); return r; });
  const r = await collect(f, { signal: controller.signal });
  expect(r.membership.status).toBe("aborted"); expect(r.scan!.status).toBe("aborted");
  expect(f.memberships.read(f.rootId)).toBeNull(); expect(r.scan!.sources).toHaveLength(page === 1 ? 16 : 65);
  expect(f.db.prepare("SELECT count(*) n FROM source_event_headers").get()!.n).toBe(page === 1 ? 16 : 65);
});

it("rejects an earlier page's independently changed generation at final capture", async () => {
  const f = await fixture(), original = scans.scanSources; let calls = 0, id = "";
  vi.spyOn(scans, "scanSources").mockImplementation(async (...args) => {
    const r = await original(...args);
    if (++calls === 1) id = r.sources[0]!.sourceId;
    if (calls === 5) f.sources.markUnavailable(id, 1);
    return r;
  });
  expect((await collect(f)).membership).toMatchObject({ status: "stale", reason: "source_changed" });
  expect(f.memberships.read(f.rootId)).toBeNull(); expect(f.sources.readSource(id)).toMatchObject({ availability: "unavailable", revision: 2 });
});

it("rejects a competing membership revision rather than overwriting it", async () => {
  const f = await fixture(), original = scans.scanSources; await collect(f); const initial = f.memberships.read(f.rootId)!; let calls = 0;
  const spy = vi.spyOn(scans, "scanSources");
  spy.mockImplementation(async (...args) => {
    const r = await original(...args);
    if (++calls === 1) f.memberships.capture({ rootId: initial.rootId, provider: initial.provider, rootFingerprint: initial.rootFingerprint, observed: [] }, initial.revision);
    return r;
  });
  expect((await collect(f)).membership).toMatchObject({ status: "stale", reason: "membership_changed" });
  expect(f.memberships.read(f.rootId)!.members.every(m => m.observation === "not_observed")).toBe(true);
});

it("bounds diagnostic samples globally and remaps their page-local aliases", async () => {
  const f = await fixture("codex", 80, true);
  for (const path of f.paths) await appendFile(path, Array.from({ length: 10 }, () => JSON.stringify({ type: "FICTITIOUS_UNKNOWN" })).join("\n") + "\n");
  const r = await collect(f), d = r.scan!.diagnostics;
  expect(r.membership.status).toBe("committed"); expect(r.scan!.status).toBe("partial");
  expect(d.observedCount).toBeGreaterThan(256); expect(d.samples).toHaveLength(256);
  expect(d.sampleDroppedCount).toBe(d.observedCount - 256);
  expect(new Set(d.samples.map(s => s.sourceAlias)).size).toBeGreaterThan(16);
  for (const sample of d.samples) if (sample.sourceAlias) expect(r.scan!.sources.some(s => s.sourceAlias === sample.sourceAlias)).toBe(true);
  expect(JSON.stringify(r)).not.toContain("FICTITIOUS_");
});

it("expands retirement proof bounds without relaxing the ordinary proof API or cross-root veto", async () => {
  const f = await fixture("codex", 66); await collect(f);
  const other = { provider: "codex" as const, path: f.base };
  // A second real enrolled root would contain the private DB; use a validated independent stored observation.
  const snapshot = f.memberships.read(f.rootId)!, missingId = snapshot.members[0]!.sourceId;
  const otherId = context.fingerprint("source", ["directory_root_v1", other.provider, other.path]);
  f.memberships.capture({ rootId: otherId, provider: "codex", rootFingerprint: context.fingerprint("content", ["other"]), observed: [{ sourceId: missingId, sourceRevision: 1 }] }, null);
  const file = f.paths.find(p => context.fingerprint("source", ["codex", p]) === missingId)!; await rm(file);
  const receipt = await collect(f), root = f.memberships.read(f.rootId)!;
  const proof = { rootId: root.rootId, provider: root.provider, rootFingerprint: root.rootFingerprint, membershipRevision: root.revision, observedSourceIds: root.members.filter(m => m.observation === "observed").map(m => m.sourceId) };
  expect(proof.observedSourceIds).toHaveLength(65);
  expect(() => retireDirectoryAbsences(f.db, context, proof)).toThrow();
  expect(retireDirectoryBatchAbsences(f.db, context, proof)).toMatchObject({ status: "partial", counts: { retained: 1, markedUnavailable: 0 } });
  expect((await reconcileDirectoryAbsence(f.db, context, f.root, receipt, undefined, true)).entries[0]).toMatchObject({ reason: "other_root_observed" });
  f.memberships.capture({ rootId: otherId, provider: "codex", rootFingerprint: context.fingerprint("content", ["other"]), observed: [] }, 1);
  expect((await reconcileDirectoryAbsence(f.db, context, f.root, receipt, undefined, true)).counts?.markedUnavailable).toBe(1);
  const before = sourceRows(f.db);
  expect((await reconcileDirectoryAbsence(f.db, context, f.root, receipt, undefined, true)).counts?.alreadyUnavailable).toBe(1);
  expect(sourceRows(f.db)).toEqual(before);
});

it.each([undefined, null, 1, "yes"])("rejects an explicitly invalid batch option %j without I/O", async value => {
  const f = await fixture("codex", 0), spy = vi.spyOn(scans, "scanSources");
  await expect(collect(f, { batchDirectory: value })).rejects.toThrow(); expect(spy).not.toHaveBeenCalled(); expect(f.memberships.read(f.rootId)).toBeNull();
});

it("refuses proxy/getter/duplicate/unsorted batch paths without invoking user code", async () => {
  const f = await fixture("codex", 2), getter = vi.fn(), spy = vi.spyOn(scans, "scanSources");
  for (const paths of [new Proxy(f.paths, {}), [f.paths[0], f.paths[0]], [...f.paths].reverse(), Object.defineProperty([], "0", { get: getter })]) {
    await expect(scanDirectoryPages(f.sources, context, "codex", paths as never)).rejects.toThrow();
  }
  await expect(scanDirectoryPages(f.sources, context, "codex", [], Object.defineProperty({}, "patternEvidence", { get: getter, enumerable: true }) as never)).rejects.toThrow();
  expect(getter).not.toHaveBeenCalled(); expect(spy).not.toHaveBeenCalled();
});

it.each(["symlink", "compressed"])("expanded census still refuses %s entries", async kind => {
  const f = await fixture();
  if (kind === "symlink") await symlink(f.paths[0]!, join(f.root.path, "alias.jsonl"));
  else await writeFile(join(f.root.path, "unsupported.jsonl.gz"), "");
  await expect(censusDirectoryBatched(f.root.path)).rejects.toMatchObject({ reason: "unsafe_entry" });
  expect((await collect(f)).membership.status).toBe("ineligible"); expect(f.db.prepare("SELECT count(*) n FROM source_event_headers").get()!.n).toBe(0);
});

it("uses complete expanded 4096/4097 file and 16384 entry boundaries without truncation", async () => {
  const f = await fixture("codex", 4096);
  expect((await censusDirectoryBatched(f.root.path)).paths).toHaveLength(4096);
  await expect(censusDirectory(f.root.path)).rejects.toMatchObject({ reason: "limit" });
  const extra = join(f.root.path, "extra.jsonl"); await writeFile(extra, "");
  await expect(censusDirectoryBatched(f.root.path)).rejects.toMatchObject({ reason: "limit" });
  await rm(extra);
  // Includes the root itself: 4096 selected + 12287 unrelated + root = 16384.
  for (let i = 0; i < 12287; i++) await writeFile(join(f.root.path, `other-${i}.txt`), "");
  expect((await censusDirectoryBatched(f.root.path)).paths).toHaveLength(4096);
  await writeFile(join(f.root.path, "overflow.txt"), "");
  await expect(censusDirectoryBatched(f.root.path)).rejects.toMatchObject({ reason: "limit" });
  expect(f.memberships.read(f.rootId)).toBeNull(); expect(DIRECTORY_BATCH_LIMITS.sources).toBe(4096);
}, 30000);

it("retains the 256-directory boundary in expanded mode", async () => {
  const f = await fixture("codex", 0);
  for (let i = 0; i < 255; i++) await mkdir(join(f.root.path, String(i)));
  expect((await censusDirectoryBatched(f.root.path)).directories.size).toBe(256);
  await mkdir(join(f.root.path, "overflow"));
  await expect(censusDirectoryBatched(f.root.path)).rejects.toMatchObject({ reason: "limit" });
});

it("captures exactly 4096 authenticated members, rejects 4097, stale evidence and tampering atomically", async () => {
  const f = await fixture("codex", 0), template = { provider: "codex" as const, parserVersion: 1, normalizationVersion: 1 as const, keyVersion: 1 as const, keyId: context.keyId, completedOffset: 0, observedSize: 0, boundaryFingerprint: null, events: [] };
  const observed = Array.from({ length: 4096 }, (_, i) => ({ sourceId: context.fingerprint("source", ["batch-bound", i]), sourceRevision: 1 }));
  for (const m of observed) f.sources.replaceSource({ ...template, sourceId: m.sourceId }, null);
  const input = { rootId: f.rootId, provider: "codex" as const, rootFingerprint: context.fingerprint("content", ["batch-root"]), observed };
  expect(() => f.memberships.capture(input, null)).toThrow();
  expect(f.memberships.captureCompleteBatch(input, null)).toMatchObject({ status: "committed", memberCount: 4096, revision: 1 });
  const before = memberRows(f.db);
  expect(f.memberships.captureCompleteBatch(input, 1)).toMatchObject({ status: "unchanged", revision: 1 });
  expect(() => f.memberships.captureCompleteBatch({ ...input, observed: [...observed, { sourceId: context.fingerprint("source", ["extra"]), sourceRevision: 1 }] }, 1)).toThrow();
  expect(f.memberships.captureCompleteBatch({ ...input, observed: observed.map((m,i) => ({ ...m, sourceRevision: i === 0 ? 2 : 1 })) }, 1)).toMatchObject({ status: "stale", reason: "source_changed" });
  expect(memberRows(f.db)).toEqual(before);
  const wrong = createIdentityContext(Buffer.alloc(32, 108), context.keyId);
  expect(() => createDirectoryMembershipStore(f.db, wrong).captureCompleteBatch(input, 1)).toThrow();
  expect(memberRows(f.db)).toEqual(before);
  f.db.exec("CREATE TRIGGER fail_batch BEFORE INSERT ON directory_membership_members BEGIN SELECT RAISE(ABORT, 'fixture'); END");
  expect(() => f.memberships.captureCompleteBatch({ ...input, observed: [] }, 1)).toThrow();
  expect(memberRows(f.db)).toEqual(before);
}, 30000);

it("runs a full 4096-file directory through 256 native pages and one final membership capture", async () => {
  const f = await fixture("codex", 4096), spy = vi.spyOn(scans, "scanSources");
  const r = await collect(f);
  expect(r.membership).toMatchObject({ status: "committed", memberCount: 4096, revision: 1 });
  expect(spy).toHaveBeenCalledTimes(256);
  expect(r.scan!.counts).toMatchObject({ discovered: 4096, committed: 4096, rejected: 0, failed: 0, stale: 0 });
  expect(new Set(r.scan!.sources.map(s => s.sourceAlias)).size).toBe(4096);
  const view = projectDirectoryEnrollment(r, f.memberships.read(f.rootId)), json = formatDirectoryScan(view, true), human = formatDirectoryScan(view, false);
  expect(JSON.parse(json).result.snapshot.members).toHaveLength(4096);
  expect(human).toContain("shown=12/4096; omitted=4084"); expect(Buffer.byteLength(json)).toBeLessThan(8 * 1024 * 1024);
  expect(json + human).not.toMatch(/FICTITIOUS_|rootFingerprint|"seal"/);
}, 60000);
