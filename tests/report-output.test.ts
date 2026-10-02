import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeReportOutput } from "../src/report/write-output.js";
vi.mock("node:fs/promises", async importOriginal => ({ ...await importOriginal<typeof import("node:fs/promises")>() }));
let root: string;
beforeEach(async () => { root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), "agentprof-report-output-")); });
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true }); });
const html = "<!doctype html><html><head><title>AgentProf</title></head><body>Measured π</body></html>";
async function setup() { const dataDirectory = join(root, "private"); await fs.mkdir(dataDirectory, { mode: 0o700 }); return { output: join(root, "report.html"), dataDirectory, html }; }
async function entries() { return (await fs.readdir(root)).sort(); }
function fail(code = "EIO") { return Object.assign(new Error("FICTITIOUS_PRIVATE_ERROR_PATH"), { code }); }
function handleWith(handle: Awaited<ReturnType<typeof fs.open>>, overrides: Record<string, unknown>) {
  return new Proxy(handle, { get(target, key) { if (typeof key === "string" && key in overrides) return overrides[key]; const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value; } });
}
describe("new-file publication", () => {
  it("publishes exact bytes, mode0600 and no temporary entry", async () => {
    const args = await setup(), result = await writeReportOutput(args);
    expect(result).toMatchObject({ output: args.output, published: true, bytes: Buffer.byteLength(html), cleanup: "removed", targetVerification: "verified", status: "published", warnings: [] });
    expect(result.durability).toBe("synced"); expect(await fs.readFile(args.output, "utf8")).toBe(html);
    expect((await fs.stat(args.output)).mode & 0o777).toBe(0o600); expect(await entries()).toEqual(["private", "report.html"]);
  });
  it.each(["file", "symlink", "directory"] as const)("never replaces an existing %s", async kind => {
    const args = await setup(), original = join(root, "original"); await fs.writeFile(original, "original bytes", { mode: 0o640 });
    if (kind === "file") await fs.writeFile(args.output, "keep", { mode: 0o640 });
    if (kind === "symlink") await fs.symlink(original, args.output);
    if (kind === "directory") await fs.mkdir(args.output);
    const before = await fs.lstat(args.output); await expect(writeReportOutput(args)).rejects.toMatchObject({ code: "REPORT_OUTPUT_UNSAFE" });
    const after = await fs.lstat(args.output); expect([after.dev, after.ino, after.mode]).toEqual([before.dev, before.ino, before.mode]);
    expect(await fs.readFile(original, "utf8")).toBe("original bytes"); if (kind === "file") expect(await fs.readFile(args.output, "utf8")).toBe("keep");
  });
  it("rejects missing or symlinked parent and private-data containment without mkdir", async () => {
    const args = await setup(), alias = join(root, "alias"); await fs.symlink(args.dataDirectory, alias);
    for (const output of [join(root, "absent", "x.html"), join(alias, "x.html"), join(args.dataDirectory, "x.html"), args.dataDirectory]) await expect(writeReportOutput({ ...args, output })).rejects.toMatchObject({ code: "REPORT_OUTPUT_UNSAFE" });
    expect(await fs.readdir(args.dataDirectory)).toEqual([]); expect(await entries()).toEqual(["alias", "private"]);
  });
  it.each(["\u0000", "\t", "\n", "\r", "\u001b", "\u007f", "\u0085"])("rejects terminal control %j before opening", async control => {
    const args = await setup(), open = vi.spyOn(fs, "open"); await expect(writeReportOutput({ ...args, output: join(root, `bad${control}.html`) })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" }); expect(open).not.toHaveBeenCalled();
  });
  it("rejects UTF8 overflow before opening and leaves an ordinary Unicode name valid", async () => {
    const args = await setup(), open = vi.spyOn(fs, "open"); await expect(writeReportOutput({ ...args, html: "é".repeat(524289) })).rejects.toMatchObject({ code: "REPORT_LIMIT" }); expect(open).not.toHaveBeenCalled(); open.mockRestore();
    const result = await writeReportOutput({ ...args, output: join(root, "측정 report.html") }); expect(result.published).toBe(true);
  });
  it("loses a concurrent target race without replacing competitor bytes or mode", async () => {
    const args = await setup(), realLink = fs.link.bind(fs); vi.spyOn(fs, "link").mockImplementation(async (from, to) => { await fs.writeFile(to, "concurrent owner", { mode: 0o644, flag: "wx" }); return realLink(from, to); });
    await expect(writeReportOutput(args)).rejects.toMatchObject({ code: "REPORT_OUTPUT_UNSAFE" }); expect(await fs.readFile(args.output, "utf8")).toBe("concurrent owner"); expect((await fs.stat(args.output)).mode & 0o777).toBe(0o644); expect(await entries()).toEqual(["private", "report.html"]);
  });
  it("does not weaken atomicity when hard links are unsupported", async () => {
    const args = await setup(), rename = vi.spyOn(fs, "rename"); vi.spyOn(fs, "link").mockRejectedValue(fail("EOPNOTSUPP"));
    await expect(writeReportOutput(args)).rejects.toMatchObject({ code: "REPORT_OUTPUT_FAILED" }); expect(rename).not.toHaveBeenCalled(); expect(await entries()).toEqual(["private"]);
  });
  it("retains unowned temporary collision entries", async () => {
    const args = await setup(), realOpen = fs.open.bind(fs); let collision: string | null = null;
    vi.spyOn(fs, "open").mockImplementation(async (path, flags, mode) => {
      if (typeof flags === "number" && (flags & constants.O_EXCL) && collision === null) { collision = String(path); await fs.writeFile(path, "not owned", { flag: "wx" }); throw fail("EEXIST"); }
      return realOpen(path, flags, mode);
    });
    try { await writeReportOutput(args); } catch (error) { expect(error).toMatchObject({ code: "REPORT_OUTPUT_FAILED" }); }
    expect(collision).not.toBeNull(); expect(await fs.readFile(collision!, "utf8")).toBe("not owned");
  });
});
describe("prelink failures and postlink truthful outcomes", () => {
  it.each(["write", "sync", "close"] as const)("prelink %s failure cannot publish a partial target", async phase => {
    const args = await setup(), realOpen = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementation(async (path, flags, mode) => {
      const handle = await realOpen(path, flags, mode); if (String(path) === root) return handle;
      let thrown = false;
      return handleWith(handle, { [phase]: async (...params: unknown[]) => { if (!thrown) { thrown = true; if (phase === "close") await handle.close(); throw fail(); } return (handle[phase] as (...args: unknown[]) => unknown).apply(handle, params); } });
    });
    await expect(writeReportOutput(args)).rejects.toMatchObject({ code: "REPORT_OUTPUT_FAILED" }); await expect(fs.lstat(args.output)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await entries()).toEqual(["private"]);
  });
  it("completes short writes instead of silently publishing a prefix", async () => {
    const args = await setup(), realOpen = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementation(async (path, flags, mode) => {
      const handle = await realOpen(path, flags, mode); if (String(path) === root) return handle;
      return handleWith(handle, { write: async (buffer: Uint8Array, offset: number, length: number, position: number) => handle.write(buffer, offset, Math.min(length, 7), position) });
    });
    expect((await writeReportOutput(args)).published).toBe(true); expect(await fs.readFile(args.output, "utf8")).toBe(html);
  });
  it("postlink temporary cleanup failure remains published and retains owned temp", async () => {
    const args = await setup(), realUnlink = fs.unlink.bind(fs); vi.spyOn(fs, "unlink").mockImplementation(async path => { if (dirname(String(path)) === root && basename(String(path)) !== "report.html") throw fail(); return realUnlink(path); });
    const result = await writeReportOutput(args); expect(result).toMatchObject({ published: true, cleanup: "retained", status: "published_with_warning" }); expect(result.warnings).toContain("temporary_cleanup_failed"); expect(await fs.readFile(args.output, "utf8")).toBe(html); expect((await entries()).length).toBe(3);
  });
  it.each(["open", "sync", "close", "unsupported"] as const)("postlink directory %s failure never becomes unpublished", async phase => {
    const args = await setup(), realOpen = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementation(async (path, flags, mode) => {
      if (String(path) !== root) return realOpen(path, flags, mode);
      if (phase === "open") throw fail(); const handle = await realOpen(path, flags, mode);
      if (phase === "close") return handleWith(handle, { close: async () => { await handle.close(); throw fail(); } });
      return handleWith(handle, { sync: async () => { throw fail(phase === "unsupported" ? "EINVAL" : "EIO"); } });
    });
    const result = await writeReportOutput(args); expect(result).toMatchObject({ published: true, cleanup: "removed", status: "published_with_warning" }); expect(result.durability).toBe(phase === "unsupported" ? "unsupported" : phase === "close" ? "synced" : "unconfirmed"); expect(result.warnings.length).toBeGreaterThan(0); expect(await fs.readFile(args.output, "utf8")).toBe(html);
  });
});
it("postlink target verification failure stays published without deleting the destination", async () => {
 const args=await setup(),realLink=fs.link.bind(fs),realLstat=fs.lstat.bind(fs);let linked=false;
 vi.spyOn(fs,"link").mockImplementation(async(from,to)=>{await realLink(from,to);linked=true;});
 vi.spyOn(fs,"lstat").mockImplementation(((path: Parameters<typeof fs.lstat>[0], options?: Parameters<typeof fs.lstat>[1])=>{if(linked&&String(path)===args.output)return Promise.reject(fail());return realLstat(path,options as never);}) as typeof fs.lstat);
 const result=await writeReportOutput(args);expect(result).toMatchObject({published:true,targetVerification:"unconfirmed",status:"published_with_warning"});expect(result.warnings).toContain("target_verification_failed");expect(await fs.readFile(args.output,"utf8")).toBe(html);
});
it("zero-length writes fail closed instead of looping or publishing",async()=>{
 const args=await setup(),realOpen=fs.open.bind(fs);vi.spyOn(fs,"open").mockImplementation(async(path,flags,mode)=>{const handle=await realOpen(path,flags,mode);return handleWith(handle,{write:async()=>({bytesWritten:0,buffer:Buffer.alloc(0)})});});
 await expect(writeReportOutput(args)).rejects.toMatchObject({code:"REPORT_OUTPUT_FAILED"});expect(await entries()).toEqual(["private"]);
});
it("a changed parent identity before link fails without publishing",async()=>{
 const args=await setup(),realOpen=fs.open.bind(fs),realLstat=fs.lstat.bind(fs);let opened=false;
 vi.spyOn(fs,"open").mockImplementation(async(path,flags,mode)=>{const h=await realOpen(path,flags,mode);if(typeof flags==="number"&&(flags&constants.O_EXCL))opened=true;return h;});
 vi.spyOn(fs,"lstat").mockImplementation((async(path:Parameters<typeof fs.lstat>[0],options?:Parameters<typeof fs.lstat>[1])=>{const st=await realLstat(path,options as never);if(opened&&String(path)===root)return Object.assign(Object.create(Object.getPrototypeOf(st)),st,{ino:Number(st.ino)+1});return st;}) as typeof fs.lstat);
 await expect(writeReportOutput(args)).rejects.toMatchObject({code:"REPORT_OUTPUT_UNSAFE"});expect(await entries()).toEqual(["private"]);
});
it("a replaced temporary inode is never linked or removed as owned",async()=>{
 const args=await setup(),realOpen=fs.open.bind(fs);let swapped=false,temporary="";
 vi.spyOn(fs,"open").mockImplementation(async(path,flags,mode)=>{const h=await realOpen(path,flags,mode);if(typeof flags!=="number"||!(flags&constants.O_EXCL))return h;temporary=String(path);return handleWith(h,{close:async()=>{await h.close();if(!swapped){swapped=true;await fs.rename(temporary,temporary+".original");await fs.writeFile(temporary,"other owner",{flag:"wx"});}}});});
 await expect(writeReportOutput(args)).rejects.toMatchObject({code:"REPORT_OUTPUT_CLEANUP_FAILED"});expect(await fs.readFile(temporary,"utf8")).toBe("other owner");await expect(fs.lstat(args.output)).rejects.toMatchObject({code:"ENOENT"});
});
it("prelink cleanup failure has its distinct code and cannot claim publication",async()=>{
 const args=await setup();vi.spyOn(fs,"link").mockRejectedValue(fail());vi.spyOn(fs,"unlink").mockRejectedValue(fail());
 await expect(writeReportOutput(args)).rejects.toMatchObject({code:"REPORT_OUTPUT_CLEANUP_FAILED"});await expect(fs.lstat(args.output)).rejects.toMatchObject({code:"ENOENT"});expect((await entries()).length).toBe(2);
});
