import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { SafeError } from "../privacy/diagnostics.js";
import type { DiagnosticCode } from "../privacy/diagnostics.js";

export type OpenArguments = Readonly<{
  file: string;
  dataDir?: string;
  codexRoot?: readonly string[];
  claudeRoot?: readonly string[];
}>;
export type OpenResult = Readonly<{
  status: "accepted";
  opener: "open" | "xdg-open";
  browserVerified: false;
}>;

const DEADLINE_MS = 5000;
function validPath(path: string): boolean {
  return path.trim().length > 0 && Buffer.byteLength(path, "utf8") <= 4096
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(path)
    && !/[\uD800-\uDFFF]/u.test(path);
}
function htmlPath(path: string): boolean { return /\.(?:html|htm)$/i.test(path); }

async function readableTarget(path: string): Promise<string> {
  let canonical: string;
  try { canonical = await realpath(path); }
  catch { throw new SafeError("OPEN_FILE_UNAVAILABLE"); }
  if (!validPath(canonical) || !htmlPath(canonical)) throw new SafeError("OPEN_FILE_UNSAFE");
  let regular: boolean;
  try { regular = (await stat(canonical)).isFile(); }
  catch { throw new SafeError("OPEN_FILE_UNAVAILABLE"); }
  if (!regular) throw new SafeError("OPEN_FILE_UNSAFE");
  let descriptor;
  try { descriptor = await open(canonical, constants.O_RDONLY | constants.O_NONBLOCK); }
  catch { throw new SafeError("OPEN_FILE_UNAVAILABLE"); }
  let failure: DiagnosticCode | undefined;
  try { if (!(await descriptor.stat()).isFile()) failure = "OPEN_FILE_UNSAFE"; }
  catch { failure = "OPEN_FILE_UNAVAILABLE"; }
  try { await descriptor.close(); }
  catch { failure = "OPEN_FILE_UNAVAILABLE"; }
  if (failure !== undefined) throw new SafeError(failure);
  return canonical;
}

function spawnFailure(error: unknown): DiagnosticCode {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "EACCES" ? "OPEN_OPENER_UNAVAILABLE" : "OPEN_FAILED";
}

function requestOpen(path: string, opener: OpenResult["opener"]): Promise<OpenResult> {
  return new Promise((accept, reject) => {
    let helper: ChildProcess | undefined;
    let settled = false;
    // Keep one owned, inert error handler until close even after settlement.
    const onError = (error: Error) => finish(spawnFailure(error));
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      finish(code === 0 && signal === null ? undefined : "OPEN_FAILED");
    };
    const onClose = () => {
      if (!settled) finish("OPEN_FAILED");
      helper?.removeListener("exit", onExit);
      helper?.removeListener("error", onError);
      helper?.removeListener("close", onClose);
    };
    const finish = (failure?: DiagnosticCode) => {
      if (settled) return;
      // A delayed deadline callback must not extend any first terminal outcome.
      if (performance.now() - started >= DEADLINE_MS) failure = "OPEN_TIMEOUT";
      settled = true;
      clearTimeout(deadline);
      helper?.removeListener("exit", onExit);
      if (failure === "OPEN_TIMEOUT") helper?.unref();
      if (failure !== undefined) reject(new SafeError(failure));
      else accept(Object.freeze({ status: "accepted", opener, browserVerified: false }));
    };
    const deadline = setTimeout(() => finish("OPEN_TIMEOUT"), DEADLINE_MS);
    const started = performance.now();
    try {
      helper = spawn(opener === "open" ? "/usr/bin/open" : "xdg-open", [path], { shell: false, stdio: "ignore" });
      helper.on("error", onError);
      helper.on("exit", onExit);
      helper.on("close", onClose);
    } catch (error) { finish(spawnFailure(error)); }
  });
}

export async function runOpen(options: OpenArguments): Promise<OpenResult> {
  const file = options.file;
  if (typeof file !== "string" || !validPath(file) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(file)
    || file.startsWith("//") || file.startsWith("\\\\")) throw new SafeError("INVALID_ARGUMENT");
  const absolute = resolve(file);
  if (!validPath(absolute)) throw new SafeError("INVALID_ARGUMENT");
  if (!htmlPath(file)) throw new SafeError("OPEN_FILE_UNSAFE");
  if (process.platform !== "darwin" && process.platform !== "linux") throw new SafeError("UNSUPPORTED_PLATFORM");
  const canonical = await readableTarget(absolute);
  if (process.platform === "linux" && !process.env.DISPLAY?.trim() && !process.env.WAYLAND_DISPLAY?.trim()) {
    throw new SafeError("OPEN_OPENER_UNAVAILABLE");
  }
  return requestOpen(canonical, process.platform === "darwin" ? "open" : "xdg-open");
}

export function formatOpenResult(result: OpenResult, json: boolean): string {
  if (json) return JSON.stringify({ schema: "agentprof.cli/v1", ok: true, command: "open", result }) + "\n";
  return "The system opener accepted the request; browser rendering is not verified.\n";
}
