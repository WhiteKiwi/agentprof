import { constants } from "node:fs";
import type { BigIntStats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { resolve } from "node:path";
import type { IdentityContext, SourceFileProofWriter } from "../normalize/identity.js";
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
type ProofContract = Readonly<{ sourceId: string; provider: "codex" | "claude"; parserVersion: number }>;
export type ProvenSourcePrefixResult = (Extract<SourcePrefixResult, { status: "observed" }> & Readonly<{ contentFingerprint: string }>) | Exclude<SourcePrefixResult, { status: "observed" }>;
export type SourceProbeResult = Readonly<{ status: "matched" }> | Readonly<{ status: "mismatch" }> | Exclude<SourcePrefixResult, { status: "observed" }>;
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
const rejected = (reason: Extract<SourcePrefixResult, { status: "rejected" }>["reason"], value: SafeDiagnostic | null = null): Extract<SourcePrefixResult, { status: "rejected" }> => Object.freeze({ status: "rejected", reason, diagnostic: value });
const changed = () => rejected("input_changed", diagnostic("INPUT_CHANGED", "source-1"));

/** Observe one bounded completed prefix. This is not a filesystem snapshot or a resume token. */
export async function readSourcePrefix(path: string, context: IdentityContext, consume: (entry: RecordEntry) => boolean | Promise<boolean>, options: SourcePrefixOptions = {}): Promise<SourcePrefixResult> {
  return readPrefix(path, context, consume, options);
}

/** Internal ingestion path. Its proof observes the parsing read, never a later reread. */
export async function readSourcePrefixWithProof(path: string, context: IdentityContext, contract: ProofContract, consume: (entry: RecordEntry) => boolean | Promise<boolean>, options: SourcePrefixOptions = {}): Promise<ProvenSourcePrefixResult> {
  return readPrefix(path, context, consume, options, contract) as Promise<ProvenSourcePrefixResult>;
}

async function readPrefix(path: string, context: IdentityContext, consume: (entry: RecordEntry) => boolean | Promise<boolean>, options: SourcePrefixOptions, contract?: ProofContract): Promise<SourcePrefixResult | ProvenSourcePrefixResult> {
  validSourcePath(path);
  path = resolve(path);
  if (typeof consume !== "function") throw new SafeError("INVALID_ARGUMENT");
  const selected = sourcePrefixOptions(options), signal = selected.signal;
  if (signal?.aborted) return Object.freeze({ status: "aborted" });
  let file: FileHandle | undefined;
  let writer: SourceFileProofWriter | undefined;
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
  try {
    if (signal?.aborted) return Object.freeze({ status: "aborted" });
    if (result.status === "observed" && writer) return Object.freeze({ ...result, contentFingerprint: writer.finish() });
    return result;
  } finally { writer?.discard(); }

  async function observe(handle: FileHandle, opening: BigIntStats): Promise<SourcePrefixResult> {
    const observedSize = Number(opening.size);
    if (contract) writer = context.startSourceFileProof({ ...contract, maxFileBytes: selected.maxFileBytes, maxRecords: selected.maxRecords, maxLineBytes: selected.maxLineBytes, observedSize });
    let checkpoint: Extract<JsonLineEntry, { kind: "checkpoint" }> | undefined, records = 0;
    for await (const entry of readJsonLinesFromFile(handle, observedSize, { maxLineBytes: selected.maxLineBytes, chunkBytes: selected.chunkBytes, sourceAlias: "source-1" }, signal, writer?.update)) {
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

/** Read all bounded current bytes without decoding. A match is only a file observation. */
export async function probeSourceFile(path: string, context: IdentityContext, candidate: ProofContract & Readonly<{ observedSize: number; contentFingerprint: string }>, options: SourcePrefixOptions = {}): Promise<SourceProbeResult> {
  validSourcePath(path); path = resolve(path);
  const selected = sourcePrefixOptions(options), signal = selected.signal;
  if (signal?.aborted) return Object.freeze({ status: "aborted" });
  let file: FileHandle | undefined, writer: SourceFileProofWriter | undefined, complete = false;
  let result: SourceProbeResult;
  try {
    await assertNoSymlink(path);
    const beforeOpen = await lstat(path, { bigint: true });
    if (!beforeOpen.isFile()) throw new SafeError("INPUT_ACCESS_FAILED");
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opening = await file.stat({ bigint: true });
    if (!sameFile(beforeOpen, opening)) result = changed();
    else if (opening.size < 0n || opening.size > BigInt(selected.maxFileBytes)) result = rejected("file_limit");
    else {
      result = Object.freeze({ status: "mismatch" });
      if (opening.size === BigInt(candidate.observedSize)) {
        writer = context.startSourceFileProof({ sourceId: candidate.sourceId, provider: candidate.provider, parserVersion: candidate.parserVersion,
          maxFileBytes: selected.maxFileBytes, maxRecords: selected.maxRecords, maxLineBytes: selected.maxLineBytes, observedSize: candidate.observedSize });
        const bytes = Buffer.allocUnsafe(selected.chunkBytes); let received = 0;
        while (received < candidate.observedSize) {
          if (signal?.aborted) break;
          const read = await file.read(bytes, 0, Math.min(bytes.length, candidate.observedSize - received), received);
          if (read.bytesRead === 0) { result = changed(); break; }
          writer.update(bytes.subarray(0, read.bytesRead)); received += read.bytesRead;
        }
        if (received === candidate.observedSize && !signal?.aborted) complete = true;
      }
      // Check even an immediate size-mismatch miss, before handing off to reparse.
      try {
        await assertNoSymlink(path);
        const finalPath = await lstat(path, { bigint: true }), finalHandle = await file.stat({ bigint: true });
        if (!sameFile(opening, finalPath) || !sameFile(opening, finalHandle)) result = changed();
      } catch { result = changed(); }
    }
  } catch (error) {
    const code = error instanceof SafeError && error.code === "UNSAFE_DATA_PATH" ? "SYMLINK_SKIPPED" : "INPUT_ACCESS_FAILED";
    result = rejected("reader_error", diagnostic(code, "source-1"));
  } finally {
    if (file) try { await file.close(); } catch { result = rejected("reader_error", diagnostic("INPUT_ACCESS_FAILED", "source-1")); }
  }
  try {
    if (signal?.aborted) return Object.freeze({ status: "aborted" });
    if (result.status === "mismatch" && complete && writer) return Object.freeze({ status: writer.finish() === candidate.contentFingerprint ? "matched" : "mismatch" });
    return result;
  } finally { writer?.discard(); }
}
