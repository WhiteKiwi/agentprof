import { appendFile, copyFile, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db/database.js";
import { createIdentityContext } from "../src/normalize/identity.js";
import { createSourceStore } from "../src/db/source-store.js";
import { createDirectoryMembershipStore } from "../src/db/directory-membership.js";
import { enrollDirectory } from "../src/scanner/directory-enrollment.js";
import * as scans from "../src/scanner/scan-run.js";
import { temporaryDirectory } from "./helpers.js";
vi.mock("node:fs/promises", async importOriginal => ({ ...await importOriginal<typeof import("node:fs/promises")>() }));

const context = createIdentityContext(Buffer.alloc(32, 83), "a".repeat(32)), dbs = new Set<any>();
afterEach(() => { vi.restoreAllMocks(); for (const db of dbs) db.close(); dbs.clear(); });
async function fixture(provider: "codex" | "claude" = "codex", empty = false) {
  const base = temporaryDirectory(), path = join(base, "FICTITIOUS_DIRECTORY_SENTINEL"), data = join(base, "private"); await mkdir(path);
  const source = join(path, "FICTITIOUS_MEMBER_SENTINEL.jsonl"); if (!empty) await copyFile(fileURLToPath(new URL(`./fixtures/providers/${provider}-real-shapes.jsonl`, import.meta.url)), source);
  const db = await openDatabase(data); dbs.add(db); const root = { provider, path }, store = createDirectoryMembershipStore(db, context);
  return { db, data, root, source, store, rootId: context.fingerprint("source", ["directory_root_v1", provider, path]) };
}
const rawMembership = (db: any) => ["directory_membership_roots", "directory_membership_members"].map(table => db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all());
const sourceRows = (db: any) => ["source_event_headers", "source_event_contributions", "source_metric_headers", "source_metric_contributions", "source_cache_evidence", "source_parser_checkpoints", "source_relationship_headers", "source_relationship_contributions"].map(table => db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all());

it.each(["codex", "claude"] as const)("enrolls real %s scans, keeps omitted members and preserves all source data", async provider => {
  const f = await fixture(provider), first = await enrollDirectory(f.db, context, f.root);
  expect(first.scan!.counts.committed).toBe(1); expect(first.membership).toMatchObject({ status: "committed", revision: 1 });
  const old = f.store.read(f.rootId)!; expect(old.members).toHaveLength(1); expect(old.members[0]!.observation).toBe("observed");
  const second = await enrollDirectory(f.db, context, f.root); expect(second.scan!.counts.unchanged).toBe(1); expect(second.membership.status).toBe("unchanged");
  const sourceBefore = sourceRows(f.db); await rm(f.source); const missing = await enrollDirectory(f.db, context, f.root);
  expect(missing.membership).toMatchObject({ status: "committed", revision: 2 }); expect(f.store.read(f.rootId)!.members).toEqual([{ ...old.members[0], observation: "not_observed" }]); expect(sourceRows(f.db)).toEqual(sourceBefore);
  await copyFile(fileURLToPath(new URL(`./fixtures/providers/${provider}-real-shapes.jsonl`, import.meta.url)), f.source);
  expect((await enrollDirectory(f.db, context, f.root)).membership.status).toBe("committed"); expect(f.store.read(f.rootId)!.members[0]!.observation).toBe("observed");
  await appendFile(f.source, JSON.stringify({ type: "FICTITIOUS_APPEND_UNKNOWN_RECORD" }) + "\n"); const changed = await enrollDirectory(f.db, context, f.root); expect(changed.membership.status).toBe("committed"); expect(f.store.read(f.rootId)!.members[0]!.sourceRevision).toBe(2);
  expect(first.directoryReconciled).toBe(false); expect(first.membershipCaptureChangesSourceAvailability).toBe(false);
  expect(JSON.stringify(first)).not.toMatch(/FICTITIOUS_DIRECTORY_SENTINEL|FICTITIOUS_MEMBER_SENTINEL|rootFingerprint/);
  expect((await readFile(join(f.data, "agentprof.sqlite"))).includes(Buffer.from("FICTITIOUS_DIRECTORY_SENTINEL"))).toBe(false);
});

it.each(["codex", "claude"] as const)("keeps exact %s capture modes and partial provider coverage", async provider => {
  const f = await fixture(provider);
  for (const [capture, version] of [[{}, provider === "codex" ? 1 : 2], [{ usageTiming: true }, provider === "codex" ? 2 : 3], [{ patternEvidence: true }, provider === "codex" ? 3 : 4]] as const) {
    const r = await enrollDirectory(f.db, context, f.root, capture); expect(r.membership.status).toBe("committed");
    const source = createSourceStore(f.db, context.keyId).readSource(r.scan!.sources[0]!.sourceId)!; expect(source.parserVersion).toBe(version);
    if (source.evidence!.capabilities.coverage === "partial") expect(r.scan!.status).toBe("partial");
  }
});

it("handles empty/nested enrollment and independent overlapping root observations", async () => {
  const f = await fixture("codex", true); expect((await enrollDirectory(f.db, context, f.root)).membership).toMatchObject({ status: "committed", memberCount: 0 });
  const nested = join(f.root.path, "nested"); await mkdir(nested); await writeFile(join(nested, "session.jsonl"), "");
  const full = await enrollDirectory(f.db, context, f.root); expect(full.membership).toMatchObject({ status: "committed", memberCount: 1 });
  const child = await enrollDirectory(f.db, context, { provider: "codex", path: nested }); expect(child.membership.status).toBe("committed");
  expect(f.db.prepare("SELECT count(*) AS n FROM directory_membership_roots").get()!.n).toBe(2); expect(f.db.prepare("SELECT count(*) AS n FROM directory_membership_members").get()!.n).toBe(2);
});

it.each(["compressed", "symlink", "many_sources", "missing_root", "replaced_root"])("preserves enrolled membership on %s", async kind => {
  const f = await fixture(); await enrollDirectory(f.db, context, f.root); const old = rawMembership(f.db);
  if (kind === "compressed") await writeFile(join(f.root.path, "unsupported.jsonl.gz"), "");
  if (kind === "symlink") await symlink(f.source, join(f.root.path, "alias.jsonl"));
  if (kind === "many_sources") for (let i = 0; i < 64; i++) await writeFile(join(f.root.path, `extra-${i}.jsonl`), "");
  if (kind === "missing_root") await rm(f.root.path, { recursive: true });
  if (kind === "replaced_root") { await rename(f.root.path, f.root.path + "-old"); await mkdir(f.root.path); }
  const r = await enrollDirectory(f.db, context, f.root); expect(r.membership.status).toBe("ineligible"); expect(r.scan).toBeNull(); expect(rawMembership(f.db)).toEqual(old);
  if (kind === "many_sources") expect(r.membership.reason).toBe("limit");
});

it.each(["add", "remove", "replace_directory"])("rejects real %s between census snapshots, retaining earlier legitimate scan commits", async change => {
  const f = await fixture(); await enrollDirectory(f.db, context, f.root); const old = rawMembership(f.db), original = scans.scanSources;
  const nested = join(f.root.path, "nested"); await mkdir(nested);
  vi.spyOn(scans, "scanSources").mockImplementation(async (...args) => { const r = await original(...args); if (change === "add") await writeFile(join(f.root.path, "new.jsonl"), ""); else if (change === "remove") await rm(f.source); else { await rename(nested, nested + "-old"); await mkdir(nested); } return r; });
  const r = await enrollDirectory(f.db, context, f.root); expect(r.scan).not.toBeNull(); expect(r.membership).toMatchObject({ status: "ineligible", reason: "census_changed" }); expect(rawMembership(f.db)).toEqual(old);
});

it("rejects current 65-file census before scan and preserves the exact root 64 case", async () => {
  const f = await fixture("codex", true); for (let i = 0; i < 64; i++) await writeFile(join(f.root.path, `file-${i}.jsonl`), "");
  expect((await enrollDirectory(f.db, context, f.root)).membership).toMatchObject({ status: "committed", memberCount: 64 }); const before = rawMembership(f.db);
  await writeFile(join(f.root.path, "file-64.jsonl"), ""); expect((await enrollDirectory(f.db, context, f.root)).membership).toMatchObject({ status: "ineligible", reason: "limit" }); expect(rawMembership(f.db)).toEqual(before);
});

it("aborts before and during scan and validates options without invoking getters", async () => {
  const f = await fixture(), controller = new AbortController(); controller.abort();
  expect((await enrollDirectory(f.db, context, f.root, { signal: controller.signal })).membership.status).toBe("aborted"); expect(f.store.read(f.rootId)).toBeNull();
  const getter = vi.fn(() => true), options = Object.defineProperty({}, "patternEvidence", { enumerable: true, get: getter });
  await expect(enrollDirectory(f.db, context, f.root, options)).rejects.toThrow(); expect(getter).not.toHaveBeenCalled();
  for (const options of [{ usageTiming: "yes" }, { extra: 1 }, new Proxy({}, {})]) await expect(enrollDirectory(f.db, context, f.root, options as never)).rejects.toThrow();
  const middle = new AbortController(), original = scans.scanSources; vi.spyOn(scans, "scanSources").mockImplementation(async (...args) => { const r = await original(...args); middle.abort(); return r; });
  expect((await enrollDirectory(f.db, context, f.root, { signal: middle.signal })).membership.status).toBe("aborted"); expect(f.store.read(f.rootId)).toBeNull(); expect(f.db.prepare("SELECT count(*) AS n FROM source_event_headers").get()!.n).toBe(1);
});

it("refuses membership advancement after a malformed appended JSONL line", async () => {
  const f = await fixture(); await enrollDirectory(f.db, context, f.root); const before = rawMembership(f.db);
  await appendFile(f.source, "\n"); const r = await enrollDirectory(f.db, context, f.root);
  expect(r.scan!.sources[0]!.status).toBe("rejected"); expect(r.membership).toMatchObject({ status: "ineligible", reason: "scan_incomplete" }); expect(rawMembership(f.db)).toEqual(before);
});

it("sanitizes a final root-close failure and preserves membership after real scanning", async () => {
  const f = await fixture(); await enrollDirectory(f.db, context, f.root); const before = rawMembership(f.db), original = fs.open;
  let opens = 0, failed = false;
  vi.spyOn(fs, "open").mockImplementation(async (...args: any[]) => {
    const handle = await (original as any)(...args);
    if (++opens === 1) { const close = handle.close.bind(handle); handle.close = async () => { if (!failed) { failed = true; throw Error("FICTITIOUS_CLOSE_PRIVATE_SENTINEL"); } await close(); }; }
    return handle;
  });
  const r = await enrollDirectory(f.db, context, f.root); expect(failed).toBe(true); expect(r.scan).not.toBeNull();
  expect(r.membership).toMatchObject({ status: "ineligible", reason: "access_failed" }); expect(rawMembership(f.db)).toEqual(before); expect(JSON.stringify(r)).not.toContain("FICTITIOUS_CLOSE_PRIVATE_SENTINEL");
});

it("reports a capture-only availability guarantee while the normal scanner restores an unavailable source", async () => {
  const f = await fixture(); const first = await enrollDirectory(f.db, context, f.root), id = first.scan!.sources[0]!.sourceId, sources = createSourceStore(f.db, context.keyId);
  expect(sources.markUnavailable(id, 1)).toMatchObject({ status: "committed", revision: 2 }); expect(sources.readSource(id)!.availability).toBe("unavailable");
  const restored = await enrollDirectory(f.db, context, f.root); expect(sources.readSource(id)).toMatchObject({ availability: "available", revision: 3 });
  expect(restored.membershipCaptureChangesSourceAvailability).toBe(false); expect(restored.directoryReconciled).toBe(false); expect(f.store.read(f.rootId)!.members[0]!.sourceRevision).toBe(3);
});
