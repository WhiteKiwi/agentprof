import { types } from "node:util";
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
  if (typeof value !== "number" || !Number.isSafeInteger(value) || Object.is(value, -0) || value < 1 || value > ceiling) throw new SafeError("INVALID_ARGUMENT");
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
    const boundary = new ObservedBoundary();
    let checkpoint: Extract<JsonLineEntry, { kind: "checkpoint" }> | undefined, records = 0;
    for await (const entry of readJsonLinesFromFile(handle, observedSize, { maxLineBytes: selected.maxLineBytes, chunkBytes: selected.chunkBytes, sourceAlias: "source-1" }, signal,
      bytes => { writer?.update(bytes); boundary.update(bytes); })) {
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
    if (boundary.completedOffset !== completedOffset) return changed();
    const boundaryFingerprint = boundary.fingerprint(context);
    try {
      await assertNoSymlink(path);
      const finalPath = await lstat(path, { bigint: true });
      const finalHandle = await handle.stat({ bigint: true });
      if (!sameFile(opening, finalPath) || !sameFile(opening, finalHandle)) return changed();
    } catch { return changed(); }
    return Object.freeze({ status: "observed", completedOffset, observedSize, pendingBytes: checkpoint.pendingBytes, records, boundaryFingerprint });
  }
}

/** The raw observer owns copies: reader buffers are reused after each callback. */
class ObservedBoundary {
  #tail: Buffer = Buffer.alloc(0);
  #complete: Buffer = Buffer.alloc(0);
  #position = 0;
  completedOffset = 0;
  update(bytes: Uint8Array): void {
    const chunk = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const window = Buffer.concat([this.#tail, chunk]); // <= 4096 + one bounded reader chunk
    const lf = chunk.lastIndexOf(0x0a);
    if (lf !== -1) {
      const end = this.#tail.length + lf + 1;
      this.#complete = Buffer.from(window.subarray(Math.max(0, end - 4096), end));
      this.completedOffset = this.#position + lf + 1;
    }
    this.#tail = Buffer.from(window.subarray(Math.max(0, window.length - 4096)));
    this.#position += chunk.length;
  }
  fingerprint(context: IdentityContext): string | null {
    return this.completedOffset === 0 ? null : context.fingerprint("content", ["source_boundary_v1", this.completedOffset, this.#complete.toString("base64")]);
  }
}

export type SourceSuffixCandidate = ProofContract & Readonly<{
  observedSize: number; completedOffset: number; boundaryFingerprint: string | null; contentFingerprint: string;
  nextOrdinal: number; maxFileBytes: number; maxRecords: number; maxLineBytes: number;
}>;
export type SourceSuffixResult = ProvenSourcePrefixResult | Readonly<{ status: "mismatch" }> | Readonly<{ status: "corrupt_checkpoint" }>;

function validateSuffixCandidate(value: unknown, context: IdentityContext): SourceSuffixCandidate {
  if (types.isProxy(value)) throw new SafeError("INVALID_ARGUMENT");
  const names = ["sourceId", "provider", "parserVersion", "observedSize", "completedOffset", "boundaryFingerprint", "contentFingerprint", "nextOrdinal", "maxFileBytes", "maxRecords", "maxLineBytes"];
  const v = ownInput(value, names);
  if (Object.keys(v).length !== names.length || (v["provider"] !== "claude" && v["provider"] !== "codex")) throw new SafeError("INVALID_ARGUMENT");
  const fingerprint = (input: unknown, domain: string) => typeof input === "string" && input.length === `h1:${context.keyId}:${domain}:`.length + 64
    && input.startsWith(`h1:${context.keyId}:${domain}:`) && /^[a-f0-9]{64}$/.test(input.slice(-64));
  if (!fingerprint(v["sourceId"], "source") || !fingerprint(v["contentFingerprint"], "content")
    || v["boundaryFingerprint"] !== null && !fingerprint(v["boundaryFingerprint"], "content")) throw new SafeError("INVALID_ARGUMENT");
  for (const name of ["parserVersion", "observedSize", "completedOffset", "nextOrdinal", "maxFileBytes", "maxRecords", "maxLineBytes"]) {
    const n = v[name];
    if (typeof n !== "number" || !Number.isSafeInteger(n) || Object.is(n, -0) || n < (["observedSize", "completedOffset", "nextOrdinal"].includes(name) ? 0 : 1)) throw new SafeError("INVALID_ARGUMENT");
  }
  const result = v as unknown as SourceSuffixCandidate;
  sourcePrefixOptions({ maxFileBytes:result.maxFileBytes, maxRecords:result.maxRecords, maxLineBytes:result.maxLineBytes });
  if (result.observedSize > result.maxFileBytes || result.completedOffset > result.observedSize || result.nextOrdinal > result.maxRecords) throw new SafeError("INVALID_ARGUMENT");
  return Object.freeze(result);
}

/** Verify old bytes and decode the suffix on one owned descriptor; no later proof read. */
export async function readSourceSuffixWithProof(path: string, context: IdentityContext, candidate: SourceSuffixCandidate,
  consume: (entry: RecordEntry) => boolean | Promise<boolean>, options: SourcePrefixOptions = {}): Promise<SourceSuffixResult> {
  candidate = validateSuffixCandidate(candidate, context);
  validSourcePath(path); path = resolve(path);
  const selected = sourcePrefixOptions(options), signal = selected.signal;
  if (typeof consume !== "function" || !Number.isSafeInteger(candidate.observedSize) || candidate.observedSize < 0
    || !Number.isSafeInteger(candidate.completedOffset) || candidate.completedOffset < 0 || candidate.completedOffset > candidate.observedSize
    || !Number.isSafeInteger(candidate.nextOrdinal) || candidate.nextOrdinal < 0 || candidate.nextOrdinal > selected.maxRecords) throw new SafeError("INVALID_ARGUMENT");
  if (signal?.aborted) return Object.freeze({ status: "aborted" });
  let file: FileHandle | undefined, oldWriter: SourceFileProofWriter | undefined, writer: SourceFileProofWriter | undefined;
  let result: SourceSuffixResult;
  try {
    await assertNoSymlink(path);
    const beforeOpen = await lstat(path, { bigint: true });
    if (!beforeOpen.isFile()) throw new SafeError("INPUT_ACCESS_FAILED");
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opening = await file.stat({ bigint: true });
    if (!sameFile(beforeOpen, opening)) result = changed();
    else if (opening.size < 0n || opening.size > BigInt(selected.maxFileBytes)) result = rejected("file_limit");
    else {
      result = await observe(file, opening);
      // Stable mismatches must also satisfy the final observation before replay is allowed.
      try {
        await assertNoSymlink(path);
        const named = await lstat(path, { bigint: true }), handled = await file.stat({ bigint: true });
        if (!sameFile(opening, named) || !sameFile(opening, handled)) result = changed();
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
    if (result.status === "observed" && writer) return Object.freeze({ ...result, contentFingerprint: writer.finish() });
    return result;
  } finally { oldWriter?.discard(); writer?.discard(); }

  async function observe(handle: FileHandle, opening: BigIntStats): Promise<SourceSuffixResult> {
    const observedSize = Number(opening.size);
    if (observedSize < candidate.observedSize) return Object.freeze({ status: "mismatch" });
    const contract = { sourceId: candidate.sourceId, provider: candidate.provider, parserVersion: candidate.parserVersion };
    oldWriter = context.startSourceFileProof({ ...contract, maxFileBytes: candidate.maxFileBytes, maxRecords: candidate.maxRecords, maxLineBytes: candidate.maxLineBytes, observedSize: candidate.observedSize });
    writer = context.startSourceFileProof({ ...contract, maxFileBytes: selected.maxFileBytes, maxRecords: selected.maxRecords, maxLineBytes: selected.maxLineBytes, observedSize });
    const bytes = Buffer.allocUnsafe(selected.chunkBytes), boundary = new ObservedBoundary();
    let received = 0;
    while (received < candidate.observedSize) {
      if (signal?.aborted) return Object.freeze({ status: "aborted" });
      const read = await handle.read(bytes, 0, Math.min(bytes.length, candidate.observedSize - received), received);
      if (read.bytesRead === 0) return changed();
      const observed = bytes.subarray(0, read.bytesRead);
      oldWriter.update(observed);
      // Re-read the old incomplete tail through the decoder rather than pre-hashing it.
      const completed = observed.subarray(0, Math.max(0, Math.min(read.bytesRead, candidate.completedOffset - received)));
      if (completed.length > 0) { writer.update(completed); boundary.update(completed); }
      received += read.bytesRead;
    }
    if (oldWriter.finish() !== candidate.contentFingerprint) return Object.freeze({ status: "mismatch" });
    if (boundary.completedOffset !== candidate.completedOffset || boundary.fingerprint(context) !== candidate.boundaryFingerprint) return Object.freeze({ status: "corrupt_checkpoint" });
    let checkpoint: Extract<JsonLineEntry, { kind: "checkpoint" }> | undefined, records = candidate.nextOrdinal;
    for await (const entry of readJsonLinesFromFile(handle, observedSize, { startOffset: candidate.completedOffset, maxLineBytes: selected.maxLineBytes, chunkBytes: selected.chunkBytes, sourceAlias: "source-1" }, signal,
      chunk => { writer!.update(chunk); boundary.update(chunk); })) {
      if (signal?.aborted) return Object.freeze({ status: "aborted" });
      if (entry.kind === "diagnostic") return rejected(entry.diagnostic.code === "INPUT_CHANGED" ? "input_changed" : "reader_error", entry.diagnostic);
      if (entry.kind === "checkpoint") checkpoint = entry;
      else {
        if (++records > selected.maxRecords) return rejected("record_limit");
        if (!await consume(entry)) return rejected("consumer_stopped");
      }
    }
    if (!checkpoint || checkpoint.bytesRead !== observedSize - candidate.completedOffset || checkpoint.nextOffset + checkpoint.pendingBytes !== observedSize || boundary.completedOffset !== checkpoint.nextOffset) return changed();
    // Finish only after descriptor cleanup. This field is replaced before exposure.
    return Object.freeze({ status: "observed", completedOffset: checkpoint.nextOffset, observedSize, pendingBytes: checkpoint.pendingBytes,
      records, boundaryFingerprint: boundary.fingerprint(context), contentFingerprint: "" });
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
