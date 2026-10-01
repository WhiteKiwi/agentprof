import { constants } from "node:fs";
import { open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { TextDecoder } from "node:util";
import { diagnostic, SafeError } from "../privacy/diagnostics.js";
import type { SafeDiagnostic } from "../privacy/diagnostics.js";
import { assertNoSymlink } from "../privacy/paths.js";

export const MAX_LINE_BYTES = 1024 * 1024;
export const READER_CHUNK_BYTES = 64 * 1024;
export type JsonLineEntry =
  | Readonly<{ kind: "record"; value: unknown; byteOffset: number; nextOffset: number }>
  | Readonly<{ kind: "diagnostic"; diagnostic: SafeDiagnostic; nextOffset: number }>
  | Readonly<{ kind: "checkpoint"; nextOffset: number; pendingBytes: number; bytesRead: number }>;
export type ReaderOptions = Readonly<{ startOffset?: number; maxLineBytes?: number; chunkBytes?: number; sourceAlias?: string }>;

export async function* readJsonLines(path: string, options: ReaderOptions = {}): AsyncGenerator<JsonLineEntry> {
  const startOffset = options.startOffset ?? 0;
  const maxLineBytes = options.maxLineBytes ?? MAX_LINE_BYTES;
  const chunkBytes = options.chunkBytes ?? READER_CHUNK_BYTES;
  if (!Number.isSafeInteger(startOffset) || startOffset < 0 || !Number.isSafeInteger(maxLineBytes) || maxLineBytes <= 0 || maxLineBytes > MAX_LINE_BYTES || !Number.isSafeInteger(chunkBytes) || chunkBytes <= 0 || chunkBytes > READER_CHUNK_BYTES) throw new SafeError("INVALID_ARGUMENT");
  let file;
  let snapshotSize = 0;
  try {
    await assertNoSymlink(path);
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    snapshotSize = stat.size;
    if (!stat.isFile()) throw new SafeError("INPUT_ACCESS_FAILED");
    if (startOffset > stat.size) throw new SafeError("INVALID_OFFSET");
    if (startOffset > 0) {
      const previous = Buffer.alloc(1);
      await file.read(previous, 0, 1, startOffset - 1);
      if (previous[0] !== 0x0a) throw new SafeError("INVALID_OFFSET");
    }
  } catch (error) {
    if (file) await file.close();
    const code = error instanceof SafeError && error.code === "INVALID_OFFSET" ? "INVALID_OFFSET"
      : error instanceof SafeError && error.code === "UNSAFE_DATA_PATH" ? "SYMLINK_SKIPPED" : "INPUT_ACCESS_FAILED";
    yield { kind: "diagnostic", diagnostic: diagnostic(code, options.sourceAlias ?? null, startOffset), nextOffset: startOffset };
    return;
  }

  try { yield* readJsonLinesFromFile(file, snapshotSize, options); }
  finally { await file.close(); }
}

/** Internal same-descriptor decoder; the caller owns and closes the handle. */
export async function* readJsonLinesFromFile(file: FileHandle, snapshotSize: number, options: ReaderOptions = {}, signal?: AbortSignal, observeRaw?: (bytes: Uint8Array) => void): AsyncGenerator<JsonLineEntry> {
  const startOffset = options.startOffset ?? 0;
  const maxLineBytes = options.maxLineBytes ?? MAX_LINE_BYTES;
  const chunkBytes = options.chunkBytes ?? READER_CHUNK_BYTES;
  if (!Number.isSafeInteger(snapshotSize) || snapshotSize < 0 || !Number.isSafeInteger(startOffset) || startOffset < 0 || startOffset > snapshotSize
    || !Number.isSafeInteger(maxLineBytes) || maxLineBytes <= 0 || maxLineBytes > MAX_LINE_BYTES
    || !Number.isSafeInteger(chunkBytes) || chunkBytes <= 0 || chunkBytes > READER_CHUNK_BYTES) throw new SafeError("INVALID_ARGUMENT");
  if (startOffset === snapshotSize) {
    yield { kind: "checkpoint", nextOffset: startOffset, pendingBytes: 0, bytesRead: 0 };
    return;
  }

  // A fixed byte buffer bounds retained line bytes; oversized lines never accumulate.
  const line = Buffer.allocUnsafe(maxLineBytes);
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const readBuffer = Buffer.allocUnsafe(chunkBytes);
  let readOffset = startOffset;
  let cursor = startOffset;
  let lineStart = startOffset;
  let completeOffset = startOffset;
  let lineBytes = 0;
  let oversize = false;
  try {
    while (readOffset < snapshotSize) {
      if (signal?.aborted) throw new SafeError("INPUT_ACCESS_FAILED");
      const { bytesRead } = await file.read(readBuffer, 0, Math.min(chunkBytes, snapshotSize - readOffset), readOffset);
      if (bytesRead === 0) break;
      readOffset += bytesRead;
      const chunk = readBuffer.subarray(0, bytesRead);
      observeRaw?.(chunk); // Synchronous observer sees the exact bytes decoded below.
      let from = 0;
      while (from < chunk.length) {
        if (signal?.aborted) throw new SafeError("INPUT_ACCESS_FAILED");
        const newline = chunk.indexOf(0x0a, from);
        const until = newline === -1 ? chunk.length : newline;
        const length = until - from;
        if (lineBytes + length > maxLineBytes) oversize = true;
        if (!oversize && length > 0) chunk.copy(line, lineBytes, from, until);
        lineBytes += length;
        cursor += length;
        if (newline === -1) break;
        cursor++;
        completeOffset = cursor;
        if (oversize) {
          yield { kind: "diagnostic", diagnostic: diagnostic("RECORD_TOO_LARGE", options.sourceAlias ?? null, lineStart), nextOffset: cursor };
        } else {
          let decoded: string | null = null;
          try {
            const parseLength = lineBytes > 0 && line[lineBytes - 1] === 0x0d ? lineBytes - 1 : lineBytes;
            decoded = decoder.decode(line.subarray(0, parseLength));
            if (lineStart === 0 && decoded.startsWith("\uFEFF")) decoded = decoded.slice(1);
          } catch {
            yield { kind: "diagnostic", diagnostic: diagnostic("INVALID_UTF8", options.sourceAlias ?? null, lineStart), nextOffset: cursor };
          }
          if (decoded !== null) {
            let value: unknown;
            let valid = true;
            try { value = JSON.parse(decoded); } catch { valid = false; }
            if (valid) yield { kind: "record", value, byteOffset: lineStart, nextOffset: cursor };
            else yield { kind: "diagnostic", diagnostic: diagnostic("INVALID_JSON", options.sourceAlias ?? null, lineStart), nextOffset: cursor };
          }
        }
        lineStart = cursor;
        lineBytes = 0;
        oversize = false;
        from = newline + 1;
      }
    }
    if (cursor < snapshotSize) yield { kind: "diagnostic", diagnostic: diagnostic("INPUT_CHANGED", options.sourceAlias ?? null, completeOffset), nextOffset: completeOffset };
    yield { kind: "checkpoint", nextOffset: completeOffset, pendingBytes: cursor - completeOffset, bytesRead: cursor - startOffset };
  } catch {
    yield { kind: "diagnostic", diagnostic: diagnostic("INPUT_ACCESS_FAILED", options.sourceAlias ?? null, completeOffset), nextOffset: completeOffset };
  }
}
