import { constants } from "node:fs";
import type { BigIntStats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { resolve } from "node:path";
import type { IdentityContext } from "../normalize/identity.js";
import { diagnostic, SafeError } from "../privacy/diagnostics.js";
import type { SafeDiagnostic } from "../privacy/diagnostics.js";
import { assertNoSymlink } from "../privacy/paths.js";
import { MAX_LINE_BYTES, READER_CHUNK_BYTES, readJsonLinesFromFile } from "./jsonl.js";
import type { JsonLineEntry } from "./jsonl.js";

export const MAX_SOURCE_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_SOURCE_RECORDS = 32768;
export type SourcePrefixOptions = Readonly<{
  maxFileBytes?: number; maxRecords?: number; maxLineBytes?: number; chunkBytes?: number; signal?: AbortSignal;
}>;
export type SourcePrefixResult = Readonly<
  { status: "observed"; completedOffset: number; observedSize: number; pendingBytes: number; records: number; boundaryFingerprint: string | null }
  | { status: "aborted" }
  | { status: "rejected"; reason: "file_limit" | "record_limit" | "reader_error" | "input_changed" | "consumer_stopped"; diagnostic: SafeDiagnostic | null }
>;
type RecordEntry = Extract<JsonLineEntry, { kind: "record" }>;

/** Read only known own data properties; API options cannot add fixture evidence or accessors. */
export function ownInput(value: unknown, names: readonly string[]): Record<string, unknown> {
  try {
    if (value === null || typeof value !== "object" || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw new SafeError("INVALID_ARGUMENT");
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const name of Reflect.ownKeys(value)) {
      if (typeof name !== "string" || !names.includes(name)) throw new SafeError("INVALID_ARGUMENT");
      const property = Object.getOwnPropertyDescriptor(value, name);
      if (!property || !("value" in property)) throw new SafeError("INVALID_ARGUMENT");
      result[name] = property.value as unknown;
    }
    return result;
  } catch { throw new SafeError("INVALID_ARGUMENT"); }
}
function limit(value: unknown, ceiling: number): number {
  if (value === undefined) return ceiling;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > ceiling) throw new SafeError("INVALID_ARGUMENT");
  return value;
}
export function sourcePrefixOptions(value: unknown): Required<Omit<SourcePrefixOptions, "signal">> & { signal: AbortSignal | undefined } {
  const options = ownInput(value, ["maxFileBytes", "maxRecords", "maxLineBytes", "chunkBytes", "signal"]);
  const signal = options["signal"];
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new SafeError("INVALID_ARGUMENT");
  return { maxFileBytes: limit(options["maxFileBytes"], MAX_SOURCE_FILE_BYTES), maxRecords: limit(options["maxRecords"], MAX_SOURCE_RECORDS),
    maxLineBytes: limit(options["maxLineBytes"], MAX_LINE_BYTES), chunkBytes: limit(options["chunkBytes"], READER_CHUNK_BYTES), signal };
}
export function validSourcePath(path: unknown): asserts path is string {
  if (typeof path !== "string" || path.length === 0 || Buffer.byteLength(path) > 4096 || /[\0\r\n]/.test(path)) throw new SafeError("INVALID_ARGUMENT");
}
function sameFile(a: BigIntStats, b: BigIntStats): boolean {
  return b.isFile() && a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
const rejected = (reason: Extract<SourcePrefixResult, { status: "rejected" }>["reason"], value: SafeDiagnostic | null = null): SourcePrefixResult => Object.freeze({ status: "rejected", reason, diagnostic: value });
const changed = () => rejected("input_changed", diagnostic("INPUT_CHANGED", "source-1"));

/** Observe one bounded completed prefix. This is not a filesystem snapshot or a resume token. */
export async function readSourcePrefix(path: string, context: IdentityContext, consume: (entry: RecordEntry) => boolean | Promise<boolean>, options: SourcePrefixOptions = {}): Promise<SourcePrefixResult> {
  validSourcePath(path);
  path = resolve(path);
  if (typeof consume !== "function") throw new SafeError("INVALID_ARGUMENT");
  const selected = sourcePrefixOptions(options), signal = selected.signal;
  if (signal?.aborted) return Object.freeze({ status: "aborted" });
  let file: FileHandle | undefined;
  let result: SourcePrefixResult;
  try {
    await assertNoSymlink(path);
    const beforeOpen = await lstat(path, { bigint: true });
    if (!beforeOpen.isFile()) throw new SafeError("INPUT_ACCESS_FAILED");
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opening = await file.stat({ bigint: true });
    if (!sameFile(beforeOpen, opening)) result = changed();
    else if (opening.size < 0n || opening.size > BigInt(selected.maxFileBytes)) result = rejected("file_limit");
    else result = await observe(file, opening);
  } catch (error) {
    const code = error instanceof SafeError && error.code === "UNSAFE_DATA_PATH" ? "SYMLINK_SKIPPED" : "INPUT_ACCESS_FAILED";
    result = rejected("reader_error", diagnostic(code, "source-1"));
  } finally {
    // Cleanup finishes before the caller can mutate SQLite; a close error is never post-commit.
    if (file) try { await file.close(); } catch { result = rejected("reader_error", diagnostic("INPUT_ACCESS_FAILED", "source-1")); }
  }
  return signal?.aborted ? Object.freeze({ status: "aborted" }) : result;

  async function observe(handle: FileHandle, opening: BigIntStats): Promise<SourcePrefixResult> {
    const observedSize = Number(opening.size);
    let checkpoint: Extract<JsonLineEntry, { kind: "checkpoint" }> | undefined, records = 0;
    for await (const entry of readJsonLinesFromFile(handle, observedSize, { maxLineBytes: selected.maxLineBytes, chunkBytes: selected.chunkBytes, sourceAlias: "source-1" }, signal)) {
      if (signal?.aborted) return Object.freeze({ status: "aborted" });
      if (entry.kind === "diagnostic") return rejected(entry.diagnostic.code === "INPUT_CHANGED" ? "input_changed" : "reader_error", entry.diagnostic);
      if (entry.kind === "checkpoint") checkpoint = entry;
      else {
        if (++records > selected.maxRecords) return rejected("record_limit");
        if (!await consume(entry)) return rejected("consumer_stopped");
      }
    }
    if (!checkpoint || checkpoint.bytesRead !== observedSize || checkpoint.nextOffset + checkpoint.pendingBytes !== observedSize) return changed();
    const completedOffset = checkpoint.nextOffset;
    let boundaryFingerprint: string | null = null;
    if (completedOffset > 0) {
      const boundary = Buffer.alloc(Math.min(4096, completedOffset));
      let received = 0;
      while (received < boundary.length) {
        if (signal?.aborted) return Object.freeze({ status: "aborted" });
        const read = await handle.read(boundary, received, boundary.length - received, completedOffset - boundary.length + received);
        if (read.bytesRead === 0) return changed();
        received += read.bytesRead;
      }
      if (boundary.at(-1) !== 0x0a) return changed();
      boundaryFingerprint = context.fingerprint("content", ["source_boundary_v1", completedOffset, boundary.toString("base64")]);
    }
    try {
      await assertNoSymlink(path);
      const finalPath = await lstat(path, { bigint: true });
      const finalHandle = await handle.stat({ bigint: true });
      if (!sameFile(opening, finalPath) || !sameFile(opening, finalHandle)) return changed();
    } catch { return changed(); }
    return Object.freeze({ status: "observed", completedOffset, observedSize, pendingBytes: checkpoint.pendingBytes, records, boundaryFingerprint });
  }
}
