import { EventEmitter } from "node:events";
import { constants, mkdtempSync, realpathSync, writeFileSync, mkdirSync, symlinkSync, readFileSync, statSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { runOpen, formatOpenResult } from "../src/cli/open.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("node:fs/promises", async importOriginal => ({ ...await importOriginal<typeof import("node:fs/promises")>() }));
const privateText = "FICTITIOUS_OPEN_SECRET_$(touch never-create)";
const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
class Helper extends EventEmitter { unref = vi.fn(); kill = vi.fn(); }
let root: string, file: string, helper: Helper;
const platform = (value: string) => Object.defineProperty(process, "platform", { configurable: true, value });
const expectCode = (promise: Promise<unknown>, code: string) => expect(promise).rejects.toMatchObject({ code });
async function spawned() {
  // Promise-only flushing cannot progress actual async fs. waitFor runs without creating native helpers.
  await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
}
beforeEach(() => {
  root = mkdtempSync(join(realpathSync(tmpdir()), "agentprof-open-")); file = join(root, "report.html"); writeFileSync(file, "<!doctype html><title>Synthetic</title>");
  helper = new Helper(); vi.mocked(spawn).mockReturnValue(helper as unknown as ReturnType<typeof spawn>);
  platform("linux"); vi.stubEnv("DISPLAY", ":99"); vi.stubEnv("WAYLAND_DISPLAY", "");
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.mocked(spawn).mockReset(); vi.unstubAllEnvs(); Object.defineProperty(process, "platform", platformDescriptor); rmSync(root, { recursive: true, force: true }); });

it.each(["report.html", "report.HTM", "한글 space.html", "-option.html", "quote'\";$()`(x)#?%23.html"])("passes %s as one literal canonical argv", async name => {
  const path = join(root, name); writeFileSync(path, "synthetic"); const pending = runOpen({ file: path }); await spawned();
  expect(vi.mocked(spawn).mock.calls[0]).toEqual(["xdg-open", [realpathSync(path)], expect.objectContaining({ shell: false, stdio: "ignore" })]);
  helper.emit("exit", 0, null); const result = await pending; expect(result).toEqual({ status: "accepted", opener: "xdg-open", browserVerified: false });
  expect(formatOpenResult(result, true)).toBe(JSON.stringify({ schema: "agentprof.cli/v1", ok: true, command: "open", result }) + "\n");
  expect(formatOpenResult(result, false)).not.toContain(path); expect(formatOpenResult(result, false)).toContain("not verified");
  helper.emit("close", 0, null); expect(helper.kill).not.toHaveBeenCalled();
});
it("uses fixed macOS helper without launching a GUI", async () => {
  platform("darwin"); vi.stubEnv("DISPLAY", ""); const pending = runOpen({ file }); await spawned();
  expect(vi.mocked(spawn).mock.calls[0]).toEqual(["/usr/bin/open", [file], expect.objectContaining({ shell: false, stdio: "ignore" })]);
  helper.emit("exit", 0, null); await pending; helper.emit("close", 0, null);
});
it.each(["", " ", "https://a/report.html", "file:///tmp/report.html", "data:text/html,x", "custom:report.html", "//host/report.html", "\\\\host\\report.html", "C:\\report.html", "a\u0000.html", "a\t.html", "a\n.html", "a\r.html", "a\u001b.html", "a\u007f.html", "a\u0085.html", "a\ud800.html", "a\udc00.html", "é".repeat(2046) + ".html"])("rejects lexical input before filesystem I/O", async bad => {
  const rp = vi.spyOn(fs, "realpath"), st = vi.spyOn(fs, "stat"), op = vi.spyOn(fs, "open");
  await expectCode(runOpen({ file: bad }), "INVALID_ARGUMENT"); expect(rp).not.toHaveBeenCalled(); expect(st).not.toHaveBeenCalled(); expect(op).not.toHaveBeenCalled(); expect(spawn).not.toHaveBeenCalled();
});
it("allows a 4096-byte lexical path to proceed to unavailable-file classification", async () => {
  await expectCode(runOpen({ file: "/" + "a".repeat(4090) + ".html" }), "OPEN_FILE_UNAVAILABLE"); expect(spawn).not.toHaveBeenCalled();
});
it.each(["report.txt", "report.html.exe"])("rejects unsupported requested suffix before fs", async suffix => {
  const rp = vi.spyOn(fs, "realpath"); await expectCode(runOpen({ file: join(root, suffix) }), "OPEN_FILE_UNSAFE"); expect(rp).not.toHaveBeenCalled(); expect(spawn).not.toHaveBeenCalled();
});
it("accepts leaf and ancestor symlinks using canonical target", async () => {
  const actual = join(root, "actual"); mkdirSync(actual); const target = join(actual, "target.html"); writeFileSync(target, "synthetic");
  symlinkSync(actual, join(root, "alias")); symlinkSync(target, join(actual, "leaf.html")); const pending = runOpen({ file: join(root, "alias", "leaf.html") }); await spawned();
  expect(vi.mocked(spawn).mock.calls[0]?.[1]).toEqual([target]); helper.emit("exit", 0, null); await pending; helper.emit("close", 0, null);
});
it("rejects canonical non-HTML target and invalid canonical controls", async () => {
  const target = join(root, "target.txt"); writeFileSync(target, "synthetic"); const link = join(root, "alias.html"); symlinkSync(target, link);
  await expectCode(runOpen({ file: link }), "OPEN_FILE_UNSAFE"); vi.spyOn(fs, "realpath").mockResolvedValue("/control\n.html");
  await expectCode(runOpen({ file }), "OPEN_FILE_UNSAFE"); expect(spawn).not.toHaveBeenCalled();
});
it("rejects missing, dangling, and directory targets before spawn", async () => {
  await expectCode(runOpen({ file: join(root, "missing.html") }), "OPEN_FILE_UNAVAILABLE"); const dangling = join(root, "dangling.html"); symlinkSync(join(root, "absent.html"), dangling);
  await expectCode(runOpen({ file: dangling }), "OPEN_FILE_UNAVAILABLE"); const dir = join(root, "directory.html"); mkdirSync(dir); const op = vi.spyOn(fs, "open");
  await expectCode(runOpen({ file: dir }), "OPEN_FILE_UNSAFE"); expect(op).not.toHaveBeenCalled(); expect(spawn).not.toHaveBeenCalled();
});
it.each(["fstat throws", "fstat nonregular", "close throws"])("closes descriptor on %s and never launches", async mode => {
  const close = vi.fn(async () => { if (mode === "close throws") throw Error(privateText); });
  const stat = vi.fn(async () => { if (mode === "fstat throws") throw Error(privateText); return { isFile: () => mode !== "fstat nonregular" }; });
  vi.spyOn(fs, "open").mockResolvedValue({ stat, close } as unknown as Awaited<ReturnType<typeof fs.open>>);
  await expectCode(runOpen({ file }), mode === "fstat nonregular" ? "OPEN_FILE_UNSAFE" : "OPEN_FILE_UNAVAILABLE"); expect(close).toHaveBeenCalledTimes(1); expect(spawn).not.toHaveBeenCalled();
});
it("maps filesystem permission failure to fixed unavailable", async () => {
  vi.spyOn(fs, "open").mockRejectedValue(Object.assign(Error(privateText), { code: "EACCES" })); await expectCode(runOpen({ file }), "OPEN_FILE_UNAVAILABLE"); expect(spawn).not.toHaveBeenCalled();
});
it.each(["DISPLAY", "WAYLAND_DISPLAY"])("permits %s alone", async key => {
  vi.stubEnv("DISPLAY", ""); vi.stubEnv("WAYLAND_DISPLAY", ""); vi.stubEnv(key, "display"); const pending = runOpen({ file }); await spawned(); helper.emit("exit", 0, null); await pending; helper.emit("close", 0, null);
});
it("maps headless Linux and unsupported platform without spawning", async () => {
  vi.stubEnv("DISPLAY", "  "); vi.stubEnv("WAYLAND_DISPLAY", ""); await expectCode(runOpen({ file }), "OPEN_OPENER_UNAVAILABLE"); platform("win32"); await expectCode(runOpen({ file }), "UNSUPPORTED_PLATFORM"); expect(spawn).not.toHaveBeenCalled();
});
it.each(["ENOENT", "EACCES", "EOTHER"])("maps spawn error %s and tolerates error→close without exit", async code => {
  const pending = expectCode(runOpen({ file }), code === "EOTHER" ? "OPEN_FAILED" : "OPEN_OPENER_UNAVAILABLE"); await spawned(); helper.emit("error", Object.assign(Error(privateText), { code })); await pending;
  expect(() => helper.emit("error", Error(privateText))).not.toThrow(); helper.emit("close", null, null); expect(helper.listenerCount("error")).toBe(0); expect(helper.kill).not.toHaveBeenCalled();
});
it("maps synchronous spawn exception", async () => {
  vi.mocked(spawn).mockImplementation(() => { throw Error(privateText); }); await expectCode(runOpen({ file }), "OPEN_FAILED");
});
it.each([1, 2, 3, 4, 5])("maps nonzero exit%d", async code => {
  const pending = expectCode(runOpen({ file }), "OPEN_FAILED"); await spawned(); helper.emit("exit", code, null); await pending; helper.emit("close", code, null);
});
it("maps signal exit", async () => { const pending = expectCode(runOpen({ file }), "OPEN_FAILED"); await spawned(); helper.emit("exit", null, "SIGTERM"); await pending; helper.emit("close", null, "SIGTERM"); });
it("does not accept spawn-only, times out once, never kills and safely consumes late events", async () => {
  let now = 0; vi.spyOn(performance, "now").mockImplementation(() => now);
  // Capture the production deadline while leaving actual fs scheduling intact.
  const set = vi.spyOn(globalThis, "setTimeout"); const pending = expectCode(runOpen({ file }), "OPEN_TIMEOUT"); await spawned();
  const deadline = set.mock.calls.find(call => call[1] === 5000); expect(deadline).toBeDefined(); helper.emit("spawn");
  now = 5000; (deadline![0] as () => void)(); await pending; expect(helper.unref).toHaveBeenCalledTimes(1); expect(helper.kill).not.toHaveBeenCalled();
  helper.emit("exit", 0, null); expect(() => helper.emit("error", Error(privateText))).not.toThrow(); helper.emit("close", 0, null);
  expect(helper.listenerCount("error")).toBe(0); expect(helper.listenerCount("exit")).toBe(0);
});
it("checks elapsed monotonic time at zero exit, not only timer dispatch", async () => {
  let now = 0; vi.spyOn(performance, "now").mockImplementation(() => now); const pending = expectCode(runOpen({ file }), "OPEN_TIMEOUT"); await spawned(); now = 5000; helper.emit("exit", 0, null); await pending; helper.emit("close", 0, null); expect(helper.kill).not.toHaveBeenCalled();
});
it("ignores globals without touching store/key or modifying selected HTML", async () => {
  const data = join(root, "private"); mkdirSync(data); writeFileSync(join(data, "identity-key.json"), privateText); writeFileSync(join(data, "store.sqlite"), privateText);
  const before = { bytes: readFileSync(file), stat: statSync(file), entries: readdirSync(data), key: readFileSync(join(data, "identity-key.json")) };
  const rp = vi.spyOn(fs, "realpath"), op = vi.spyOn(fs, "open"), rd = vi.spyOn(fs, "readFile");
  const pending = runOpen({ file, dataDir: data, codexRoot: [join(root, "raw")], claudeRoot: [join(root, "raw")] }); await spawned(); helper.emit("exit", 0, null); await pending; helper.emit("close", 0, null);
  expect(rp.mock.calls.every(call => call[0] === file)).toBe(true); expect(op.mock.calls.every(call => call[0] === file)).toBe(true); expect(rd).not.toHaveBeenCalled();
  expect(readFileSync(file)).toEqual(before.bytes); expect(statSync(file).mtimeMs).toBe(before.stat.mtimeMs); expect(statSync(file).mode).toBe(before.stat.mode); expect(readdirSync(data)).toEqual(before.entries); expect(readFileSync(join(data, "identity-key.json"))).toEqual(before.key);
});

it("rejects an absolute-resolution overflow before fs", async () => {
 const rp = vi.spyOn(fs, "realpath"); await expectCode(runOpen({ file: "a".repeat(4091) + ".html" }), "INVALID_ARGUMENT"); expect(rp).not.toHaveBeenCalled(); expect(spawn).not.toHaveBeenCalled();
});
it("uses read-only and nonblocking descriptor flags", async () => {
 const op = vi.spyOn(fs, "open"); const pending = runOpen({ file }); await spawned(); const flags = op.mock.calls[0]?.[1]; expect(typeof flags).toBe("number");
 expect((flags as number) & (constants.O_WRONLY | constants.O_RDWR | constants.O_CREAT | constants.O_TRUNC | constants.O_APPEND)).toBe(0); expect((flags as number) & constants.O_NONBLOCK).toBe(constants.O_NONBLOCK);
 helper.emit("exit", 0, null); await pending; helper.emit("close", 0, null);
});
it.each(["throws", "nonregular"])("close failure overrides fstat %s", async mode => {
 const close = vi.fn(async () => { throw Error(privateText); }); const stat = vi.fn(async () => { if(mode === "throws") throw Error(privateText); return { isFile: () => false }; });
 vi.spyOn(fs, "open").mockResolvedValue({ stat, close } as unknown as Awaited<ReturnType<typeof fs.open>>); await expectCode(runOpen({ file }), "OPEN_FILE_UNAVAILABLE"); expect(close).toHaveBeenCalledTimes(1); expect(spawn).not.toHaveBeenCalled();
});
it.each(["socket", "device", "fifo"])("rejects mocked %s metadata before descriptor acquisition", async () => {
 vi.spyOn(fs, "stat").mockResolvedValue({ isFile: () => false } as Awaited<ReturnType<typeof fs.stat>>); const op = vi.spyOn(fs, "open"); await expectCode(runOpen({ file }), "OPEN_FILE_UNSAFE"); expect(op).not.toHaveBeenCalled(); expect(spawn).not.toHaveBeenCalled();
});
it.each(["success", "error", "timeout"])("clears owned timer and listeners on %s", async mode => {
 let now = 0; vi.spyOn(performance, "now").mockImplementation(() => now); const set = vi.spyOn(globalThis, "setTimeout"), clear = vi.spyOn(globalThis, "clearTimeout");
 const result = runOpen({ file }); const checked = mode === "success" ? result : expectCode(result, mode === "error" ? "OPEN_FAILED" : "OPEN_TIMEOUT"); await spawned();
 const index = set.mock.calls.findIndex(call => call[1] === 5000); expect(index).toBeGreaterThanOrEqual(0); const handle = set.mock.results[index]!.value;
 if (mode === "success") helper.emit("exit", 0, null); else if (mode === "error") helper.emit("error", Error(privateText)); else { now = 5000; (set.mock.calls[index]![0] as () => void)(); }
 await checked; expect(clear).toHaveBeenCalledWith(handle); if (mode === "timeout") expect(helper.unref).toHaveBeenCalledTimes(1);
 expect(() => helper.emit("error", Error(privateText))).not.toThrow(); helper.emit("close", null, null); for(const event of ["close", "error", "exit"]) expect(helper.listenerCount(event)).toBe(0); expect(helper.kill).not.toHaveBeenCalled();
});

// Independent source-review regression: delayed timer dispatch cannot extend acknowledgement.
it.each(["ENOENT", "EACCES", "EOTHER"])("expired %s error settles timeout before timer dispatch", async code => {
  let now = 0; vi.spyOn(performance, "now").mockImplementation(() => now);
  const pending = expectCode(runOpen({ file }), "OPEN_TIMEOUT"); await spawned(); now = 5000;
  helper.emit("error", Object.assign(Error(privateText), { code })); await pending;
  expect(helper.unref).toHaveBeenCalledTimes(1); expect(helper.kill).not.toHaveBeenCalled();
  helper.emit("close", null, null); expect(helper.listenerCount("error")).toBe(0);
});
it("spawn throw after monotonic deadline settles timeout", async () => {
  let now = 0; vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.mocked(spawn).mockImplementation(() => { now = 5000; throw Object.assign(Error(privateText), { code: "ENOENT" }); });
  await expectCode(runOpen({ file }), "OPEN_TIMEOUT");
});
