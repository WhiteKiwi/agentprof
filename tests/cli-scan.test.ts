import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/cli/main.js";
import { abortedBeforeScan, collectScan, formatScanResult, runScan, validateScanArguments } from "../src/cli/scan.js";
import * as identity from "../src/normalize/identity.js";
import * as databaseModule from "../src/db/database.js";
import * as storeModule from "../src/db/source-store.js";
import * as scanner from "../src/scanner/scan-run.js";
import { SafeError } from "../src/privacy/diagnostics.js";
import { temporaryDirectory } from "./helpers.js";

const rootDir = fileURLToPath(new URL("../", import.meta.url));
const binary = join(rootDir, "dist/agentprof.cjs");
const fixture = (name = "codex-legacy.jsonl") => join(rootDir, "tests/fixtures/providers", name);
afterEach(() => { vi.restoreAllMocks(); process.exitCode = 0; });
function workspace() {
  const root = temporaryDirectory(), input = join(root, "synthetic input"), data = join(root, "private data"), home = join(root, "home"), xdg = join(root, "xdg");
  mkdirSync(input); mkdirSync(home); mkdirSync(xdg);
  return { root, input, data, home, xdg };
}
function cli(w: ReturnType<typeof workspace>, args: string[], program = binary) {
  return spawnSync(process.execPath, [program, ...args], {
    cwd: w.root, env: { ...process.env, HOME: w.home, XDG_DATA_HOME: w.xdg, CLAUDE_CONFIG_DIR: join(w.home, "claude-config") }, encoding: "utf8",
  });
}
function scan(w: ReturnType<typeof workspace>, args: string[] = []) {
  return cli(w, ["--json", "--data-dir", w.data, "scan", "--codex-root", w.input, ...args]);
}
function result(output: ReturnType<typeof cli>) { return JSON.parse(output.stdout).result as scanner.ScanResult; }
async function stored(w: ReturnType<typeof workspace>, sourceId: string) {
  const context = await identity.loadOrCreateIdentityContext(w.data), db = await databaseModule.openDatabase(w.data);
  try { return storeModule.createSourceStore(db, context.keyId).readSource(sourceId); } finally { db.close(); }
}
function appError(output: ReturnType<typeof cli>) {
  // Runtime-specific SQLite warnings are separate from the app-generated JSON line.
  return JSON.parse(output.stderr.split("\n").find((line) => line.startsWith('{"schema":'))!);
}

describe("built bounded scan CLI", () => {
  it.each([
    [], ["--codex-root", ""], ["--codex-root", "  "], ["--claude-root", "\rprivate"], ["--codex-root", "private\npath"],
    ["--codex-root", ".", "--data-dir", "  "], ["--codex-root", ".", "--data-dir", "private\npath"],
    ["--codex-root", ".", "--data-dir", "  ", "--data-dir", "valid"],
    ["--codex-root", ".", "--data-dir", "x".repeat(4097)],
    ["--codex-root", "x".repeat(4097)], Array.from({ length: 17 }, () => ["--codex-root", "."]).flat(),
    [...Array.from({ length: 8 }, () => ["--codex-root", "."]).flat(), ...Array.from({ length: 9 }, () => ["--claude-root", "."]).flat()],
    ["--codex-root", ".", "--unknown-private-argument"], ["--codex-root"],
  ].map((args) => [args]))("rejects invalid argv before private filesystem/SQLite effects: %j", (args) => {
    const w = workspace(), output = cli(w, ["--json", "--data-dir", w.data, "scan", ...args]);
    expect(output.status).toBe(2); expect(output.stdout).toBe("");
    expect(appError(output).error.code).toBe("INVALID_ARGUMENT");
    expect(output.stderr).not.toMatch(/SQLite|private\npath|unknown-private-argument/);
    expect(existsSync(w.data)).toBe(false); expect(existsSync(join(w.xdg, "agentprof"))).toBe(false);
  });
  it("rejects NUL and overlong resolved paths in-process before bootstrap", async () => {
    const w = workspace(); const load = vi.spyOn(identity, "loadOrCreateIdentityContext");
    for (const path of ["\0", "\n", "\r"]) {
      expect(() => validateScanArguments({ dataDir: w.data, codexRoot: [path], claudeRoot: [] })).toThrowError(new SafeError("INVALID_ARGUMENT"));
      expect(() => validateScanArguments({ dataDir: path, codexRoot: [w.input], claudeRoot: [] })).toThrowError(new SafeError("INVALID_ARGUMENT"));
    }
    expect(() => validateScanArguments({ dataDir: w.data, codexRoot: ["a".repeat(4096)], claudeRoot: [] })).toThrow();
    expect(load).not.toHaveBeenCalled(); expect(existsSync(w.data)).toBe(false);
  });
  it("accepts flags before/after scan, relative paths and the 16-root ceiling", () => {
    const w = workspace(); copyFileSync(fixture(), join(w.input, "a.jsonl"));
    const before = cli(w, ["--json", "--data-dir", relative(w.root, w.data), "--codex-root", relative(w.root, w.input), "scan"]);
    expect(before.status).toBe(0); expect(result(before).counts.committed).toBe(1);
    const after = cli(w, ["scan", "--json", "--data-dir", w.data, ...Array.from({ length: 16 }, () => ["--codex-root", w.input]).flat()]);
    expect(after.status).toBe(0); expect(result(after).sources[0]).toMatchObject({ status: "unchanged", expectedRevision: 1, committedRevision: null, reusedRevision: 1 });
    expect(result(after).counts.unchanged).toBe(1);
  });
  it("uses only explicit provider roots, preserving omitted-provider sentinel directories", () => {
    const w = workspace();
    for (const path of [join(w.home, ".codex/sessions"), join(w.home, ".codex/archived_sessions"), join(w.home, "claude-config/projects")]) {
      mkdirSync(path, { recursive: true }); writeFileSync(join(path, "never-read.jsonl"), "FICTITIOUS_OMITTED_ROOT\n");
    }
    expect(result(scan(w)).counts.discovered).toBe(0);
    const claudeOnly = cli(w, ["scan", "--claude-root", w.input, "--data-dir", w.data, "--json"]);
    expect(claudeOnly.status).toBe(0); expect(result(claudeOnly).counts.discovered).toBe(0);
  });
  it("ignores malformed config for an omitted provider", () => {
    const w = workspace();
    const output = spawnSync(process.execPath, [binary, "scan", "--json", "--codex-root", w.input, "--data-dir", w.data], { cwd: w.root, env: { ...process.env, HOME: w.home, XDG_DATA_HOME: w.xdg, CLAUDE_CONFIG_DIR: "FICTITIOUS_OMITTED\nCONFIG" }, encoding: "utf8" });
    expect(output.status).toBe(0); expect(result(output).counts.discovered).toBe(0);
    expect(output.stdout + output.stderr).not.toContain("FICTITIOUS_");
  });
  it("uses established XDG data location only when no override is supplied", () => {
    const w = workspace(); const output = cli(w, ["scan", "--codex-root", w.input, "--json"]);
    expect(output.status).toBe(0); expect(existsSync(join(w.xdg, "agentprof/identity-key.json"))).toBe(true);
    expect(existsSync(w.data)).toBe(false);
  });
  it("persists both providers with unchanged evidence and no raw output", async () => {
    const w = workspace(), claude = join(w.root, "claude"); mkdirSync(claude);
    copyFileSync(fixture(), join(w.input, "a.jsonl")); copyFileSync(fixture("claude-real-shapes.jsonl"), join(claude, "b.jsonl"));
    const output = scan(w, ["--claude-root", claude]); const r = result(output);
    expect(output.status).toBe(1); expect(JSON.parse(output.stdout)).toMatchObject({ schema: "agentprof.cli/v1", ok: false, command: "scan" });
    expect(r).toMatchObject({ status: "partial", aggregationReady: false, parserResumeReady: false, counts: { committed: 2, failed: 0 } });
    for (const s of r.sources) {
      const source = await stored(w, s.sourceId);
      expect(source!.revision).toBe(1); expect(source!.evidence!.capabilities).toEqual(s.capabilities);
      expect(source!.events.length).toBeGreaterThan(0);
      expect(JSON.stringify(source)).not.toContain("FICTITIOUS_");
    }
    expect(output.stdout + output.stderr).not.toContain(w.root); expect(output.stdout + output.stderr).not.toContain("FICTITIOUS_");
  });
  it("reuses repeats and reparses append/rewrite without duplicate contributions or lost prior generations", async () => {
    const w = workspace(), path = join(w.input, "a.jsonl"); copyFileSync(fixture(), path);
    const first = result(scan(w)).sources[0]!; const original = await stored(w, first.sourceId);
    const again = result(scan(w)).sources[0]!;
    expect(again).toMatchObject({ sourceId: first.sourceId, expectedRevision: 1, committedRevision: null, reusedRevision: 1 });
    expect((await stored(w, first.sourceId))!.events).toEqual(original!.events);
    appendFileSync(path, JSON.stringify({ type: "response_item", timestamp: "2026-09-01T00:00:12.000Z", payload: { type: "function_call_output", call_id: "pending1", output: { exit_code: 0, text: "FICTITIOUS_OUTPUT" } } }) + "\n");
    expect(result(scan(w)).sources[0]!.committedRevision).toBe(2);
    const updated = await stored(w, first.sourceId);
    const pendingId = original!.events.find((event) => event.status === "pending")!.id;
    expect(updated!.events.find((event) => event.id === pendingId)!.status).toBe("completed");
    writeFileSync(path, "bad line FICTITIOUS_PRIVATE\n");
    const rejected = scan(w); expect(rejected.status).toBe(1); expect(result(rejected).counts.rejected).toBe(1);
    expect(await stored(w, first.sourceId)).toEqual(updated);
    const replacement = join(w.root, "replacement"); writeFileSync(replacement, ""); renameSync(replacement, path);
    expect(result(scan(w)).sources[0]).toMatchObject({ sourceId: first.sourceId, expectedRevision: 2, committedRevision: 3 });
    expect((await stored(w, first.sourceId))!.events).toEqual([]);
  });
  it("deduplicates nested roots and returns truthful missing/ambiguous/compressed/limited results", async () => {
    const w = workspace(), nested = join(w.input, "nested"); mkdirSync(nested); copyFileSync(fixture(), join(nested, "a.jsonl"));
    const normal = result(scan(w, ["--codex-root", nested])); expect(normal.counts.committed).toBe(1);
    const missing = scan(w, ["--claude-root", join(w.root, "missing")]); expect(missing.status).toBe(1);
    expect(result(missing).diagnostics.samples.some((s) => s.code === "INPUT_ROOT_MISSING")).toBe(true);
    const ambiguous = scan(w, ["--claude-root", w.input]); expect(ambiguous.status).toBe(1);
    expect(result(ambiguous).counts.committed).toBe(0);
    writeFileSync(join(w.input, "compressed.jsonl.gz"), "synthetic");
    const compressed = scan(w); expect(compressed.status).toBe(1); expect(result(compressed).diagnostics.samples.some((s) => s.code === "UNSUPPORTED_COMPRESSION")).toBe(true);
    const sourceId = normal.sources[0]!.sourceId, previous = await stored(w, sourceId);
    writeFileSync(join(nested, "a.jsonl"), " ".repeat(scanner.SCAN_LIMITS.fileBytes + 1));
    const limited = scan(w); expect(limited.status).toBe(1); expect(result(limited).sources[0]!.rejectionReason).toBe("file_limit");
    expect(await stored(w, sourceId)).toEqual(previous);
  });
  it("bounds sources and stops a long record stream at the tighter adapter state limit while retaining good source commits", async () => {
    const w = workspace();
    for (let i = 0; i < 65; i++) writeFileSync(join(w.input, `${i}.jsonl`), "");
    const bounded = scan(w); expect(bounded.status).toBe(1);
    expect(result(bounded)).toMatchObject({ discoveryTruncated: true, stopReason: "discovery_limit", counts: { committed: 64 } });
    const another = workspace(); copyFileSync(fixture(), join(another.input, "good.jsonl"));
    writeFileSync(join(another.input, "malformed.jsonl"), "FICTITIOUS_MALFORMED\n");
    writeFileSync(join(another.input, "records.jsonl"), (JSON.stringify({ type: "session_meta", payload: { id: "synthetic-record-limit", cli_version: "synthetic" } }) + "\n").repeat(scanner.SCAN_LIMITS.records + 1));
    const partial = scan(another); expect(partial.status).toBe(1);
    expect(result(partial).counts).toMatchObject({ committed: 1, rejected: 2 });
    expect(result(partial).sources.some((source) => source.rejectionReason === "state_limit")).toBe(true);
    const good = result(partial).sources.find((source) => source.status === "committed")!;
    expect((await stored(another, good.sourceId))!.events.length).toBeGreaterThan(0);
    expect(partial.stdout + partial.stderr).not.toContain("FICTITIOUS_");
  });
  it("keeps human counts consistent with JSON and labels unsupported aggregation", () => {
    const w = workspace(); copyFileSync(fixture(), join(w.input, "a.jsonl"));
    scan(w); // Warm both output modes against the same unchanged generation.
    const json = scan(w), human = cli(w, ["scan", "--codex-root", w.input, "--data-dir", w.data]);
    expect(human.status).toBe(json.status);
    for (const [key, count] of Object.entries(result(json).counts)) expect(human.stdout).toContain(`${key}=${count}`);
    expect(human.stdout).toContain("Aggregation: unsupported; parser resume: unsupported");
    expect(human.stdout).not.toContain(w.root); expect(human.stdout).not.toContain("FICTITIOUS_");
  });
  it("retains private key/DB safe errors and never automatically repairs existing files", () => {
    for (const mode of ["invalid-key", "unsafe-key", "corrupt-db", "future-db", "unsafe-db", "symlink-dir"] as const) {
      const w = workspace(); mkdirSync(w.data); const key = join(w.data, "identity-key.json"), db = join(w.data, "agentprof.sqlite");
      let protectedPath: string;
      if (mode === "invalid-key" || mode === "unsafe-key") { writeFileSync(key, "FICTITIOUS_KEY_SECRET", { mode: mode === "invalid-key" ? 0o600 : 0o644 }); protectedPath = key; }
      else if (mode === "future-db") { const database = new DatabaseSync(db); database.exec("PRAGMA user_version=999"); database.close(); chmodSync(db, 0o600); protectedPath = db; }
      else if (mode === "symlink-dir") { const link = join(w.root, "symlink"); symlinkSync(w.data, link); w.data = link; protectedPath = join(w.root, "marker"); writeFileSync(protectedPath, "unchanged"); }
      else { writeFileSync(db, "FICTITIOUS_DB_SECRET", { mode: mode === "unsafe-db" ? 0o644 : 0o600 }); protectedPath = db; }
      const bytes = readFileSync(protectedPath); const output = scan(w);
      expect(output.status).toBe(2); expect(output.stdout).toBe("");
      expect(appError(output).error.code).toBe({ "invalid-key": "INVALID_IDENTITY_KEY", "unsafe-key": "UNSAFE_PRIVATE_FILE", "corrupt-db": "DATABASE_ACCESS_FAILED", "future-db": "DATABASE_SCHEMA_TOO_NEW", "unsafe-db": "DATABASE_ACCESS_FAILED", "symlink-dir": "UNSAFE_DATA_PATH" }[mode]);
      expect(readFileSync(protectedPath)).toEqual(bytes); expect(output.stderr).not.toContain("FICTITIOUS_"); expect(output.stderr).not.toContain(w.root);
    }
  });
  it("rejects a changed installation key without replacing earlier source contributions", async () => {
    const w = workspace(); copyFileSync(fixture(), join(w.input, "a.jsonl")); const source = result(scan(w)).sources[0]!;
    const dbBefore = readFileSync(join(w.data, "agentprof.sqlite"));
    const other = workspace(); scan(other); copyFileSync(join(other.data, "identity-key.json"), join(w.data, "identity-key.json"));
    const output = scan(w); expect(output.status).toBe(1); expect(result(output)).toMatchObject({ status: "partial", stopReason: "storage_failure" });
    expect(result(output).sources[0]!.errorCode).toBe("INVALID_IDENTITY_KEY");
    expect(readFileSync(join(w.data, "agentprof.sqlite"))).toEqual(dbBefore); expect(source.committedRevision).toBe(1);
  });
});

describe("controlled startup, signals and safe error contracts", () => {
  it("returns a shape-checked zero-work abort before any bootstrap effects", async () => {
    const w = workspace(), controller = new AbortController(); controller.abort();
    const load = vi.spyOn(identity, "loadOrCreateIdentityContext"), open = vi.spyOn(databaseModule, "openDatabase");
    expect(await collectScan(w.data, [{ provider: "codex", path: w.input }], controller.signal)).toEqual(abortedBeforeScan());
    expect(load).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled(); expect(existsSync(w.data)).toBe(false);
  });
  it("observes immediate SIGINT before bootstrap and removes only its own listener", async () => {
    const w = workspace(), other = vi.fn(); process.on("SIGINT", other); const before = process.listeners("SIGINT");
    const on = process.on.bind(process); const spy = vi.spyOn(process, "on").mockImplementation(((event: string, listener: (...args: unknown[]) => void) => {
      on(event, listener); if (event === "SIGINT") process.emit("SIGINT"); return process;
    }) as typeof process.on);
    try { expect(await runScan({ dataDir: w.data, codexRoot: [w.input], claudeRoot: [] })).toEqual(abortedBeforeScan()); }
    finally { spy.mockRestore(); expect(process.listeners("SIGINT")).toEqual(before); process.removeListener("SIGINT", other); }
    expect(other).toHaveBeenCalledOnce(); expect(existsSync(w.data)).toBe(false);
  });
  it("stops after identity startup cancellation without opening DB", async () => {
    const w = workspace(), controller = new AbortController(), actual = identity.loadOrCreateIdentityContext;
    vi.spyOn(identity, "loadOrCreateIdentityContext").mockImplementation(async (data) => { const context = await actual(data); controller.abort(); return context; });
    const open = vi.spyOn(databaseModule, "openDatabase");
    expect(await collectScan(w.data, [{ provider: "codex", path: w.input }], controller.signal)).toEqual(abortedBeforeScan());
    expect(open).not.toHaveBeenCalled(); expect(existsSync(join(w.data, "identity-key.json"))).toBe(true); expect(existsSync(join(w.data, "agentprof.sqlite"))).toBe(false);
  });
  it("closes an opened database after cancellation before store/scan", async () => {
    const w = workspace(), controller = new AbortController(), actual = databaseModule.openDatabase; let db: DatabaseSync | undefined;
    vi.spyOn(databaseModule, "openDatabase").mockImplementation(async (data) => { db = await actual(data); controller.abort(); return db; });
    const create = vi.spyOn(storeModule, "createSourceStore"), scanSpy = vi.spyOn(scanner, "scanSources");
    expect(await collectScan(w.data, [{ provider: "codex", path: w.input }], controller.signal)).toEqual(abortedBeforeScan());
    expect(create).not.toHaveBeenCalled(); expect(scanSpy).not.toHaveBeenCalled(); expect(() => db!.prepare("SELECT 1")).toThrow();
  });
  it("preserves the actual scan result after cancellation and closes DB on throws", async () => {
    const w = workspace(), actual = databaseModule.openDatabase; let db: DatabaseSync | undefined;
    vi.spyOn(databaseModule, "openDatabase").mockImplementation(async (data) => { db = await actual(data); return db; });
    const returned = { ...abortedBeforeScan(), counts: { ...abortedBeforeScan().counts, committed: 1, attempted: 1, discovered: 1 } };
    vi.spyOn(scanner, "scanSources").mockImplementation(async (_store, _context, _roots, options) => {
      expect(options!.signal!.aborted).toBe(false); process.emit("SIGINT"); process.emit("SIGINT"); expect(options!.signal!.aborted).toBe(true); return returned;
    });
    const before = process.listeners("SIGINT");
    expect(await runScan({ dataDir: w.data, codexRoot: [w.input], claudeRoot: [] })).toBe(returned);
    expect(process.listeners("SIGINT")).toEqual(before); expect(() => db!.prepare("SELECT 1")).toThrow();
    vi.mocked(scanner.scanSources).mockRejectedValue(new Error("FICTITIOUS_EXCEPTION"));
    await expect(runScan({ dataDir: w.data, codexRoot: [w.input], claudeRoot: [] })).rejects.toThrow("FICTITIOUS_EXCEPTION");
    expect(process.listeners("SIGINT")).toEqual(before); expect(() => db!.prepare("SELECT 1")).toThrow();
  });
  it("keeps safe codes, treats unknown handler failures as INTERNAL_ERROR, and retains exit2", async () => {
    const w = workspace(), err = vi.spyOn(process.stderr, "write").mockImplementation(() => true), out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const load = vi.spyOn(identity, "loadOrCreateIdentityContext");
    for (const error of [new SafeError("INVALID_IDENTITY_KEY"), new Error("FICTITIOUS_EXCEPTION_SECRET")]) {
      load.mockRejectedValue(error); err.mockClear();
      await run(["node", "agentprof", "scan", "--json", "--codex-root", w.input, "--data-dir", w.data]);
      expect(process.exitCode).toBe(2); expect(err).toHaveBeenCalledOnce();
      expect(JSON.parse(String(err.mock.calls[0]![0])).error.code).toBe(error instanceof SafeError ? error.code : "INTERNAL_ERROR");
      expect(String(err.mock.calls[0]![0])).not.toContain("FICTITIOUS_"); expect(out).not.toHaveBeenCalled();
    }
  });
  it("maps actual returned storage_failure to partial exit1 and abort to exit130 once", async () => {
    const w = workspace(), out = vi.spyOn(process.stdout, "write").mockImplementation(() => true), err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    for (const status of ["partial", "aborted"] as const) {
      const returned: scanner.ScanResult = { ...abortedBeforeScan(), status, stopReason: status === "partial" ? "storage_failure" : "aborted" };
      vi.spyOn(scanner, "scanSources").mockResolvedValue(returned); out.mockClear();
      await run(["node", "agentprof", "scan", "--json", "--codex-root", w.input, "--data-dir", w.data]);
      expect(process.exitCode).toBe(status === "partial" ? 1 : 130); expect(out).toHaveBeenCalledOnce(); expect(err).not.toHaveBeenCalled();
      expect(JSON.parse(String(out.mock.calls[0]![0]))).toMatchObject({ ok: false, result: returned });
    }
  });
  it("repeated in-process completed calls do not leak signal listeners", async () => {
    const w = workspace(), before = process.listeners("SIGINT");
    for (let i = 0; i < 3; i++) { const r = await runScan({ dataDir: w.data, codexRoot: [w.input], claudeRoot: [] }); expect(r.status).toBe("completed"); expect(process.listeners("SIGINT")).toEqual(before); }
    expect(formatScanResult(abortedBeforeScan(), false)).toContain("Scan: aborted");
  });
});

describe("real process interruption and packed artifact", () => {
  it("cooperatively handles real repeated SIGINT after a committed source and permits a rescan", async () => {
    const w = workspace();
    // Directory ordering is unspecified. Pause the second source open, whatever its name.
    copyFileSync(fixture(), join(w.input, "a.jsonl")); copyFileSync(fixture(), join(w.input, "b.jsonl"));
    const preload = join(w.root, "controlled-open.mjs");
    writeFileSync(preload, `import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
const original = fs.open; let sourceOpens = 0;
fs.open = async function(path, ...args) {
  if (typeof path === 'string' && path.endsWith('.jsonl') && ++sourceOpens === 2) {
    await new Promise(resolve => { process.once('message', resolve); process.send({ ready: true }); });
  }
  return original.call(this, path, ...args);
};
syncBuiltinESMExports();
let interrupts = 0;
process.on('SIGINT', () => { process.send({ interrupt: ++interrupts }); });
process.on('beforeExit', () => { if (process.connected) process.disconnect(); });
`);
    const child = spawn(process.execPath, ["--import", preload, binary, "scan", "--json", "--data-dir", w.data, "--codex-root", w.input], {
      cwd: w.root, env: { ...process.env, HOME: w.home, XDG_DATA_HOME: w.xdg }, stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    let stdout = "", stderr = ""; child.stdout!.on("data", (data) => { stdout += data; }); child.stderr!.on("data", (data) => { stderr += data; });
    const exited = once(child, "exit");
    const next = () => once(child, "message");
    // A watchdog is only a deadlock failure guard; readiness is an explicit IPC barrier.
    const watchdog = setTimeout(() => child.kill("SIGKILL"), 15000);
    try {
      expect((await next())[0]).toEqual({ ready: true });
      const firstSignal = next(); child.kill("SIGINT"); expect((await firstSignal)[0]).toEqual({ interrupt: 1 });
      const secondSignal = next(); child.kill("SIGINT"); expect((await secondSignal)[0]).toEqual({ interrupt: 2 });
      child.send({ release: true }); child.disconnect();
      const [code, signal] = await exited; expect(signal).toBe(null); expect(code).toBe(130);
      const envelope = JSON.parse(stdout); expect(envelope.ok).toBe(false);
      expect(envelope.result).toMatchObject({ status: "aborted", stopReason: "aborted", counts: { committed: 1, aborted: 1, attempted: 2 } });
      expect(stdout + stderr).not.toContain(w.root); expect(stdout + stderr).not.toContain("FICTITIOUS_");
      const committed = envelope.result.sources.find((source: scanner.ScanSourceOutcome) => source.status === "committed");
      expect((await stored(w, committed.sourceId))!.revision).toBe(1);
      const retry = scan(w); expect(retry.status).toBe(0); expect(result(retry).counts).toMatchObject({ committed: 1, unchanged: 1 });
    } finally { clearTimeout(watchdog); if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
  }, 20000);

  it("runs a synthetic scan from an isolated script-disabled packed installation", () => {
    const w = workspace(); copyFileSync(fixture(), join(w.input, "a.jsonl"));
    const env = { ...process.env, PATH: dirname(process.execPath) + ":" + process.env.PATH, HOME: w.home, XDG_DATA_HOME: w.xdg };
    const pack = spawnSync("npm", ["--cache", join(w.root, "cache"), "pack", "--ignore-scripts", "--json", "--pack-destination", w.root], { cwd: rootDir, env, encoding: "utf8" });
    expect(pack.status, pack.stderr).toBe(0);
    const archive = join(w.root, JSON.parse(pack.stdout)[0].filename), prefix = join(w.root, "prefix");
    const install = spawnSync("npm", ["install", "--prefix", prefix, "--cache", join(w.root, "cache"), "--ignore-scripts", "--no-audit", "--no-fund", archive], { cwd: w.root, env, encoding: "utf8", timeout: 60000 });
    expect(install.status, install.stderr).toBe(0);
    const output = cli(w, ["scan", "--json", "--data-dir", w.data, "--codex-root", w.input], join(prefix, "node_modules/agentprof/dist/agentprof.cjs"));
    expect(output.status, output.stderr).toBe(0); expect(result(output).counts.committed).toBe(1);
    expect(existsSync(join(w.data, "agentprof.sqlite"))).toBe(true);
  }, 70000);
});
