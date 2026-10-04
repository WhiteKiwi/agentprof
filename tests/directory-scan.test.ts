import { copyFile, mkdir, rename, rm, symlink, writeFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getEventListeners } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { createIdentityContext, loadOrCreateIdentityContext } from "../src/normalize/identity.js";
import { openDatabase } from "../src/db/database.js";
import { createSourceStore } from "../src/db/source-store.js";
import { createDirectoryMembershipStore } from "../src/db/directory-membership.js";
import { runDirectoryScan, validateDirectoryScanArguments, projectDirectoryEnrollment, formatDirectoryScan, directoryScanExitCode } from "../src/cli/directory-scan.js";
import type { DirectoryScanArguments } from "../src/cli/directory-scan.js";
import type { DirectoryEnrollmentResult } from "../src/scanner/directory-enrollment.js";
import { abortedBeforeScan } from "../src/cli/scan.js";
import * as census from "../src/scanner/directory-census.js";
import * as enrollment from "../src/scanner/directory-enrollment.js";
import * as scans from "../src/scanner/scan-run.js";
import * as identity from "../src/normalize/identity.js";
import { temporaryDirectory } from "./helpers.js";

vi.mock("../src/scanner/directory-census.js", async original => ({ ...await original<typeof import("../src/scanner/directory-census.js")>() }));
vi.mock("../src/scanner/directory-enrollment.js", async original => ({ ...await original<typeof import("../src/scanner/directory-enrollment.js")>() }));
vi.mock("../src/scanner/scan-run.js", async original => ({ ...await original<typeof import("../src/scanner/scan-run.js")>() }));
vi.mock("../src/normalize/identity.js", async original => ({ ...await original<typeof import("../src/normalize/identity.js")>() }));
afterEach(() => vi.restoreAllMocks());

const valid = (): DirectoryScanArguments => ({ dataDir: "/tmp/unused-directory-cli-data", codexRoot: ["./one-explicit-root"], claudeRoot: [], enrollDirectory: true });
const providerFixture = (provider: string) => fileURLToPath(new URL(`./fixtures/providers/${provider}-real-shapes.jsonl`, import.meta.url));
async function fixture(provider: "codex" | "claude" = "codex", empty = false) {
  const base = temporaryDirectory(), root = join(base, "FICTITIOUS_DIRECTORY_CLI_PRIVATE"), dataDir = join(base, "data");
  await mkdir(root);
  const file = join(root, "FICTITIOUS_MEMBER_CLI_PRIVATE.jsonl");
  if (!empty) await copyFile(providerFixture(provider), file);
  const options: DirectoryScanArguments = { dataDir, codexRoot: provider === "codex" ? [root] : [], claudeRoot: provider === "claude" ? [root] : [], enrollDirectory: true };
  return { base, root, file, dataDir, options };
}
async function stored(f: Awaited<ReturnType<typeof fixture>>, rootId: string) {
  const context = await loadOrCreateIdentityContext(f.dataDir), db = await openDatabase(f.dataDir);
  try {
    return { membership: createDirectoryMembershipStore(db, context).read(rootId), headers: db.prepare("SELECT source_id,revision,availability FROM source_event_headers ORDER BY source_id").all() };
  } finally { db.close(); }
}

it.each([
  null, undefined, [], new Proxy({}, {}), Object.create({ enrollDirectory: true }),
  { ...valid(), enrollDirectory: false }, { ...valid(), enrollDirectory: undefined }, { ...valid(), reconcile: true },
  { ...valid(), usageTiming: "yes" }, { ...valid(), patternEvidence: 1 }, { ...valid(), json: 1 },
  { ...valid(), codexRoot: [] }, { ...valid(), codexRoot: ["a", "b"] }, { ...valid(), claudeRoot: ["b"] },
  { ...valid(), codexRoot: "a" }, { ...valid(), codexRoot: [null] }, { ...valid(), codexRoot: new Array(1) },
  { ...valid(), codexRoot: new Proxy(["a"], {}) }, { ...valid(), dataDir: null },
  { ...valid(), codexRoot: ["  "] }, { ...valid(), dataDir: "\0" }, { ...valid(), extra: true },
  { ...valid(), [Symbol("private")]: true },
])("rejects malformed input without bootstrap (%#)", async options => {
  const bootstrap = vi.spyOn(identity, "loadOrCreateIdentityContext");
  await expect(runDirectoryScan(options as never)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  expect(bootstrap).not.toHaveBeenCalled();
});

it("does not evaluate option or array getters and non-enumerable values", async () => {
  const getter = vi.fn(() => "FICTITIOUS_GETTER_SECRET");
  const a = Object.defineProperty(valid(), "dataDir", { enumerable: true, get: getter });
  const roots = Object.defineProperty(["a"], "0", { enumerable: true, get: getter });
  const hidden = Object.defineProperty(valid(), "json", { value: true });
  for (const options of [a, { ...valid(), codexRoot: roots }, hidden]) await expect(runDirectoryScan(options)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  expect(getter).not.toHaveBeenCalled();
});

it("keeps explicit provider selection and normal capture implications", () => {
  expect(validateDirectoryScanArguments(valid()).root).toMatchObject({ provider: "codex" });
  const claude = validateDirectoryScanArguments({ ...valid(), codexRoot: [], claudeRoot: ["./only-claude"], patternEvidence: true });
  expect(claude.root.provider).toBe("claude"); expect(claude.capture).toEqual({ usageTiming: true, patternEvidence: true });
  expect(Object.isFrozen(claude)).toBe(true);
});

it.each(["missing", "file", "root_symlink", "nested_symlink", "compressed", "too_many"])("rejects %s before creating private storage", async kind => {
  const f = await fixture("codex", true);
  if (kind === "missing") await rm(f.root, { recursive: true });
  if (kind === "file") { await rm(f.root, { recursive: true }); await writeFile(f.root, ""); }
  if (kind === "root_symlink") { await rename(f.root, f.root + "-original"); await symlink(f.root + "-original", f.root); }
  if (kind === "nested_symlink") await symlink(f.root, join(f.root, "nested"));
  if (kind === "compressed") await writeFile(join(f.root, "archive.jsonl.gz"), "");
  if (kind === "too_many") for (let i = 0; i < 65; i++) await writeFile(join(f.root, `${i}.jsonl`), "");
  const r = await runDirectoryScan(f.options);
  expect(r.status).toBe("ineligible"); expect(r.enrollment).toBeNull(); expect(r.snapshot).toBeNull();
  expect(existsSync(f.dataDir)).toBe(false); expect(directoryScanExitCode(r)).toBe(1);
  expect(formatDirectoryScan(r, true)).not.toContain(f.root);
});

it.each(["codex", "claude"] as const)("persists %s observed/missing/reappearing files across reopen without retiring sources", async provider => {
  const f = await fixture(provider);
  const first = await runDirectoryScan(f.options);
  expect(first.status).toBe("partial"); expect(first.reason).toBe("scan_warning");
  expect(first.enrollment!.membership).toMatchObject({ status: "committed", revision: 1 });
  expect(first.snapshot!.counts).toEqual({ total: 1, observed: 1, notObserved: 0 });
  expect(first.snapshot!.members[0]!.sourceRevision).toBe(1);
  const original = await stored(f, first.snapshot!.rootId);
  expect((await runDirectoryScan(f.options)).enrollment!.membership.status).toBe("unchanged");
  await rm(f.file);
  const missing = await runDirectoryScan(f.options);
  expect(missing.status).toBe("completed"); expect(directoryScanExitCode(missing)).toBe(0);
  expect(missing.snapshot!.counts).toEqual({ total: 1, observed: 0, notObserved: 1 });
  expect(missing.snapshot!.revision).toBe(2);
  expect((await stored(f, first.snapshot!.rootId)).headers).toEqual(original.headers);
  await copyFile(providerFixture(provider), f.file);
  const back = await runDirectoryScan(f.options);
  expect(back.snapshot!.members).toEqual(first.snapshot!.members); expect(back.snapshot!.revision).toBe(3);
  await appendFile(f.file, JSON.stringify({ type: "unknown-synthetic-record" }) + "\n");
  const updated = await runDirectoryScan(f.options); expect(updated.snapshot!.members[0]!.sourceRevision).toBe(2);
  expect(updated.enrollment!.membershipCaptureChangesSourceAvailability).toBe(false);
  expect(updated.enrollment!.directoryReconciled).toBe(false);
  for (const json of [true, false]) expect(formatDirectoryScan(updated, json)).not.toMatch(/FICTITIOUS_|rootFingerprint|directory_physical_root|"seal"/);
});

it.each(["codex", "claude"] as const)("preserves %s parser versions in all three capture modes", async provider => {
  const f = await fixture(provider);
  for (const [flags, version] of [[{}, provider === "codex" ? 1 : 2], [{ usageTiming: true }, provider === "codex" ? 2 : 3], [{ patternEvidence: true }, provider === "codex" ? 3 : 4]] as const) {
    const r = await runDirectoryScan({ ...f.options, ...flags }), context = await loadOrCreateIdentityContext(f.dataDir), db = await openDatabase(f.dataDir);
    try { expect(createSourceStore(db, context.keyId).readSource(r.snapshot!.members[0]!.sourceId)!.parserVersion).toBe(version); }
    finally { db.close(); }
    expect(r.status).toBe("partial"); expect(r.snapshot).not.toBeNull();
  }
});

it("retains an authenticated empty root and enrolls nested sources", async () => {
  const f = await fixture("codex", true), first = await runDirectoryScan(f.options);
  expect(first.status).toBe("completed"); expect(first.snapshot!.counts.total).toBe(0);
  await mkdir(join(f.root, "child")); await writeFile(join(f.root, "child", "empty.jsonl"), "");
  const second = await runDirectoryScan(f.options); expect(second.snapshot!.counts.observed).toBe(1);
});

it("preserves membership and source revision after a rejected append", async () => {
  const f = await fixture(), first = await runDirectoryScan(f.options), before = await stored(f, first.snapshot!.rootId);
  await appendFile(f.file, "\n"); const failed = await runDirectoryScan(f.options);
  expect(failed.status).toBe("ineligible"); expect(failed.reason).toBe("scan_incomplete"); expect(failed.snapshot).toBeNull();
  expect(failed.enrollment!.scan!.counts.rejected).toBe(1); expect(await stored(f, first.snapshot!.rootId)).toEqual(before);
});

it("rejects replaced directory identity after safe preflight", async () => {
  const f = await fixture(), first = await runDirectoryScan(f.options), before = await stored(f, first.snapshot!.rootId);
  await rename(f.root, f.root + "-old"); await mkdir(f.root);
  expect(await runDirectoryScan(f.options)).toMatchObject({ status: "ineligible", reason: "root_changed", snapshot: null });
  expect(await stored(f, first.snapshot!.rootId)).toEqual(before);
});

it("does not substitute a newer real membership committed after enrollment", async () => {
  const f = await fixture(), original = enrollment.enrollDirectory;
  vi.spyOn(enrollment, "enrollDirectory").mockImplementation(async (...args) => {
    const r = await original(...args), [database, context] = args;
    const store = createDirectoryMembershipStore(database, context), current = store.read(r.rootId)!;
    expect(store.capture({ rootId: current.rootId, rootFingerprint: current.rootFingerprint, provider: current.provider, observed: [] }, current.revision).status).toBe("committed");
    return r;
  });
  const r = await runDirectoryScan(f.options);
  expect(r).toMatchObject({ status: "stale", reason: "membership_changed", snapshot: null });
  expect(r.enrollment!.membership).toMatchObject({ status: "committed", revision: 1 });
  expect((await stored(f, r.enrollment!.rootId)).membership!.revision).toBe(2);
});

it("fails safely on corrupt membership after native capture and closes the database", async () => {
  const f = await fixture(), original = enrollment.enrollDirectory;
  vi.spyOn(enrollment, "enrollDirectory").mockImplementation(async (...args) => {
    const r = await original(...args); args[0].prepare("UPDATE directory_membership_roots SET seal=? WHERE root_id=?").run("FICTITIOUS_SEAL_SECRET", r.rootId); return r;
  });
  await expect(runDirectoryScan(f.options)).rejects.toMatchObject({ code: "DATABASE_ACCESS_FAILED" });
  const db = await openDatabase(f.dataDir); expect(db.isTransaction).toBe(false); db.close();
});

it("cleans process and caller signal listeners on pre-abort, validation and preflight failure", async () => {
  const f = await fixture("codex", true), controller = new AbortController(), before = process.listenerCount("SIGINT"); controller.abort();
  expect(await runDirectoryScan(f.options, controller.signal)).toMatchObject({ status: "aborted", enrollment: null });
  expect(existsSync(f.dataDir)).toBe(false); expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  await expect(runDirectoryScan(f.options, {} as AbortSignal)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  await rm(f.root, { recursive: true }); await runDirectoryScan(f.options);
  expect(process.listenerCount("SIGINT")).toBe(before);
});

it("sanitizes preflight close errors without bootstrapping", async () => {
  const f = await fixture("codex", true), original = census.openDirectoryLease;
  vi.spyOn(census, "openDirectoryLease").mockImplementation(async path => {
    const real = await original(path); return { ...real, async close() { await real.close(); throw Error("FICTITIOUS_CLOSE_SECRET"); } };
  });
  await expect(runDirectoryScan(f.options)).rejects.toMatchObject({ code: "INPUT_ACCESS_FAILED" });
  expect(existsSync(f.dataDir)).toBe(false);
});

it("preserves native abort receipt after real source commits without final membership", async () => {
  const f = await fixture(), original = scans.scanSources, before = process.listenerCount("SIGINT"), controller = new AbortController();
  vi.spyOn(scans, "scanSources").mockImplementation(async (...args) => {
    const r = await original(...args); controller.abort(); return r;
  });
  const r = await runDirectoryScan(f.options, controller.signal);
  expect(directoryScanExitCode(r)).toBe(130); expect(r.snapshot).toBeNull();
  expect(r.enrollment!.membership.status).toBe("aborted"); expect(r.enrollment!.scan!.counts.committed).toBe(1);
  expect((await stored(f, r.enrollment!.rootId)).membership).toBeNull();
  expect(process.listenerCount("SIGINT")).toBe(before); expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
});

const ctx = createIdentityContext(Buffer.alloc(32, 61), "b".repeat(32));
function receipt(n = 1) {
  const rootId = ctx.fingerprint("source", ["root"]), rootFingerprint = ctx.fingerprint("content", ["physical"]);
  const members = Array.from({ length: n }, (_, i) => ({ sourceId: ctx.fingerprint("source", [i]), sourceRevision: 2, observation: i % 2 ? "observed" as const : "not_observed" as const }));
  const membership = { rootId, rootFingerprint, provider: "codex" as const, revision: 4, members };
  const native: DirectoryEnrollmentResult = { mode: "directory_enrollment", rootId, provider: "codex", membership: { status: "committed", revision: 4, memberCount: n, reason: null }, scan: { ...abortedBeforeScan(), status: "completed", stopReason: null }, directoryReconciled: false, membershipCaptureChangesSourceAvailability: false };
  return { membership, native };
}
it.each(["missing", "revision", "count", "provider", "root"])("rejects %s snapshot mismatch without substituting newer data", key => {
  const { native, membership } = receipt();
  const bad = key === "missing" ? null : { ...membership, ...(key === "revision" ? { revision: 5 } : key === "count" ? { members: [] } : key === "provider" ? { provider: "claude" as const } : { rootId: ctx.fingerprint("source", ["other"]) }) };
  expect(projectDirectoryEnrollment(native, bad)).toMatchObject({ status: "stale", reason: "membership_changed", snapshot: null, enrollment: native });
});

it("keeps all 4096 members in JSON and counts before bounded human detail, without root fingerprint", () => {
  const { native, membership } = receipt(4096), r = projectDirectoryEnrollment(native, membership);
  const json = formatDirectoryScan(r, true), human = formatDirectoryScan(r, false);
  expect(JSON.parse(json).result.snapshot.members).toHaveLength(4096);
  expect(r.snapshot!.counts).toEqual({ total: 4096, observed: 2048, notObserved: 2048 });
  expect(human).toContain("shown=12/4096; omitted=4084"); expect(Buffer.byteLength(human)).toBeLessThan(32768);
  expect(Buffer.byteLength(json)).toBeLessThan(8388608); expect(json).not.toContain(membership.rootFingerprint);
  expect(Object.isFrozen(r.snapshot!.members[0])).toBe(true); expect(Object.isFrozen(r.snapshot!.members)).toBe(true);
  expect(r.snapshot!.members).not.toBe(membership.members);
});

it("enforces final output caps rather than dropping evidence", () => {
  const { native, membership } = receipt(); const r = projectDirectoryEnrollment(native, membership);
  expect(() => formatDirectoryScan({ ...r, reason: "x".repeat(8 * 1024 * 1024) }, true)).toThrow();
  expect(() => formatDirectoryScan({ ...r, reason: "x".repeat(32 * 1024) }, false)).toThrow();
});

it("reports ineligible and stale native capture without claiming a snapshot", () => {
  const { native, membership } = receipt();
  for (const status of ["stale", "ineligible"] as const) {
    const r = projectDirectoryEnrollment({ ...native, membership: { status, revision: 3, reason: "source_changed", memberCount: null } }, membership);
    expect(r.status).toBe(status); expect(r.snapshot).toBeNull(); expect(directoryScanExitCode(r)).toBe(1);
  }
});
