import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fileSystem from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { appendFile, mkdir, readFile, rename, stat, symlink, truncate, unlink, utimes, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createIdentityContext } from "../src/normalize/identity.js";
import { MAX_LINE_BYTES, READER_CHUNK_BYTES } from "../src/scanner/jsonl.js";
import { MAX_SOURCE_FILE_BYTES, MAX_SOURCE_RECORDS, readSourcePrefix } from "../src/scanner/source-prefix.js";
import { temporaryDirectory } from "./helpers.js";

const context = createIdentityContext(new Uint8Array(32).fill(31), "3".repeat(32));
const accept = () => true;
async function source(bytes: string | Uint8Array) {
  const path = join(temporaryDirectory(), "FICTITIOUS_PRIVATE_SOURCE.jsonl");
  await writeFile(path, bytes);
  return path;
}
function boundary(bytes: Buffer, offset = bytes.length) {
  return offset === 0 ? null : context.fingerprint("content", ["source_boundary_v1", offset, bytes.subarray(Math.max(0, offset - 4096), offset).toString("base64")]);
}

describe("bounded completed-prefix observation", () => {
  it.each([Buffer.alloc(0), Buffer.from('{"unfinished":"FICTITIOUS_RAW'), Buffer.from([0xe2, 0x82])])("keeps an empty or unfinished prefix outside the boundary (%j)", async (bytes) => {
    let consumed = 0;
    const result = await readSourcePrefix(await source(bytes), context, () => { consumed++; return true; }, { chunkBytes: 1 });
    expect(result).toEqual({ status: "observed", completedOffset: 0, observedSize: bytes.length, pendingBytes: bytes.length, records: 0, boundaryFingerprint: null });
    expect(consumed).toBe(0);
  });

  it("counts physical BOM, CRLF and multibyte bytes while deferring an incomplete UTF-8 tail", async () => {
    const first = Buffer.from('\uFEFF{"word":"한글"}\r\n'), second = Buffer.from('["é",3]\n');
    const bytes = Buffer.concat([first, second, Buffer.from('{"tail":"'), Buffer.from([0xf0, 0x9f])]);
    const entries: unknown[] = [];
    const result = await readSourcePrefix(await source(bytes), context, async (entry) => { entries.push(entry); return true; }, { chunkBytes: 1 });
    const completedOffset = first.length + second.length;
    expect(entries).toEqual([
      { kind: "record", value: { word: "한글" }, byteOffset: 0, nextOffset: first.length },
      { kind: "record", value: ["é", 3], byteOffset: first.length, nextOffset: completedOffset },
    ]);
    expect(result).toEqual({ status: "observed", completedOffset, observedSize: bytes.length, pendingBytes: bytes.length - completedOffset, records: 2, boundaryFingerprint: boundary(bytes, completedOffset) });
  });

  it("fingerprints exactly the trailing 4096 completed bytes, excluding the pending tail", async () => {
    const completed = Buffer.from(JSON.stringify({ value: `FICTITIOUS_RAW_BOUNDARY_${"한".repeat(1800)}` }) + "\n");
    const bytes = Buffer.concat([completed, Buffer.from('FICTITIOUS_PENDING_TAIL')]);
    const path = await source(bytes);
    const result = await readSourcePrefix(path, context, accept, { chunkBytes: 7 });
    expect(result).toMatchObject({ status: "observed", completedOffset: completed.length, records: 1, boundaryFingerprint: boundary(completed) });
    expect(JSON.stringify(result)).not.toContain("FICTITIOUS_");
    expect(JSON.stringify(result)).not.toContain(path);
    expect(JSON.stringify(result)).not.toContain(createHash("sha256").update(completed.subarray(-4096)).digest("hex"));
    expect(JSON.stringify(result)).not.toContain(completed.subarray(-4096).toString("base64"));
  });

  it.each([
    [Buffer.from('{}\nFICTITIOUS_INVALID_JSON\n{}\n'), "INVALID_JSON", undefined],
    [Buffer.concat([Buffer.from('{}\n"'), Buffer.from([0xc3, 0x28]), Buffer.from('"\n{}\n')]), "INVALID_UTF8", undefined],
    [Buffer.from('{}\n"123456789"\n{}\n'), "RECORD_TOO_LARGE", 8],
  ] as const)("rejects complete reader diagnostics without exposing input (%s)", async (bytes, code, maxLineBytes) => {
    const seen: unknown[] = [];
    const result = await readSourcePrefix(await source(bytes), context, (entry) => { seen.push(entry.value); return true; }, { chunkBytes: 2, ...(maxLineBytes === undefined ? {} : { maxLineBytes }) });
    expect(result).toMatchObject({ status: "rejected", reason: "reader_error", diagnostic: { code, byteOffset: 3 } });
    expect(seen).toEqual([{}]);
    expect(JSON.stringify(result)).not.toContain("FICTITIOUS_");
  });

  it("honors exact file and record limits and rejects the first excess record", async () => {
    const path = await source('{}\n{}\n');
    expect(await readSourcePrefix(path, context, accept, { maxFileBytes: 6, maxRecords: 2 })).toMatchObject({ status: "observed", records: 2 });
    let seen = 0;
    expect(await readSourcePrefix(path, context, () => { seen++; return true; }, { maxFileBytes: 5 })).toMatchObject({ status: "rejected", reason: "file_limit" });
    expect(seen).toBe(0);
    expect(await readSourcePrefix(path, context, () => { seen++; return true; }, { maxRecords: 1 })).toMatchObject({ status: "rejected", reason: "record_limit" });
    expect(seen).toBe(1);
    await truncate(path, MAX_SOURCE_FILE_BYTES + 1);
    expect(await readSourcePrefix(path, context, accept)).toMatchObject({ status: "rejected", reason: "file_limit" });
  });

  it("rejects invalid or raised bounds before calling the consumer", async () => {
    const path = await source('{}\n');
    let calls = 0;
    const invalid = [
      { maxFileBytes: MAX_SOURCE_FILE_BYTES + 1 }, { maxFileBytes: -1 }, { maxFileBytes: NaN },
      { maxRecords: MAX_SOURCE_RECORDS + 1 }, { maxRecords: -1 }, { maxRecords: 1.5 },
      { maxLineBytes: MAX_LINE_BYTES + 1 }, { maxLineBytes: 0 },
      { chunkBytes: READER_CHUNK_BYTES + 1 }, { chunkBytes: 0 }, { signal: {} },
    ];
    for (const options of invalid) {
      await expect(readSourcePrefix(path, context, () => { calls++; return true; }, options as Parameters<typeof readSourcePrefix>[3])).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    }
    expect(calls).toBe(0);
  });

  it("stops once the consumer declines, safely contains exceptions, and observes cancellation", async () => {
    const path = await source('{}\n{}\n');
    let calls = 0;
    expect(await readSourcePrefix(path, context, async () => { calls++; return false; })).toMatchObject({ status: "rejected", reason: "consumer_stopped" });
    expect(calls).toBe(1);
    const failure = await readSourcePrefix(path, context, () => { throw new Error(`FICTITIOUS_CONSUMER_SECRET ${path}`); });
    expect(failure).toMatchObject({ status: "rejected" });
    expect(JSON.stringify(failure)).not.toContain("FICTITIOUS_");
    expect(JSON.stringify(failure)).not.toContain(path);
    const before = new AbortController(); before.abort();
    expect(await readSourcePrefix(path, context, () => { calls++; return true; }, { signal: before.signal })).toEqual({ status: "aborted" });
    expect(calls).toBe(1);
    const during = new AbortController();
    expect(await readSourcePrefix(path, context, async () => { during.abort(); return true; }, { signal: during.signal })).toEqual({ status: "aborted" });
    // A subsequent real read verifies an early exit did not leave the path unusable.
    expect(await readSourcePrefix(path, context, accept)).toMatchObject({ status: "observed", records: 2 });
  });
});

describe("observed file-generation stability", () => {
  it.each(["append", "truncate", "rewrite", "replace", "unlink", "symlink"] as const)("rejects a deterministic %s during a record callback", async (mutation) => {
    const original = '{"value":1}\n{"value":2}\n';
    const path = await source(original);
    let changed = false;
    const result = await readSourcePrefix(path, context, async () => {
      if (!changed) {
        changed = true;
        if (mutation === "append") await appendFile(path, '{"tail":');
        else if (mutation === "truncate") await truncate(path, 0);
        else if (mutation === "rewrite") {
          const prior = await stat(path);
          await writeFile(path, original.replace('"value":1', '"value":9'));
          await utimes(path, prior.atime, new Date(prior.mtimeMs + 10000));
        } else if (mutation === "unlink") await unlink(path);
        else {
          const replacement = `${path}.replacement`;
          await writeFile(replacement, original);
          if (mutation === "replace") await rename(replacement, path);
          else { await unlink(path); await symlink(replacement, path); }
        }
      }
      return true;
    }, { chunkBytes: 5 });
    expect(changed).toBe(true);
    expect(result).toMatchObject({ status: "rejected", reason: "input_changed" });
    expect(JSON.stringify(result)).not.toContain(path);
  });

  it("rejects a newly symlinked ancestor even when it still resolves to the same file", async () => {
    const root = temporaryDirectory(), original = join(root, "input"), moved = join(root, "moved");
    await mkdir(original);
    const path = join(original, "source.jsonl"); await writeFile(path, '{}\n');
    const result = await readSourcePrefix(path, context, async () => {
      await rename(original, moved); await symlink(moved, original, "dir"); return true;
    });
    expect(result).toMatchObject({ status: "rejected", reason: "input_changed" });
  });

  it("rejects inaccessible, symbolic and nonregular inputs with safe diagnostics", async () => {
    const root = temporaryDirectory(), path = join(root, "FICTITIOUS_LINK");
    const regular = await source('{}\n'); await symlink(regular, path);
    for (const input of [path, root, join(root, "FICTITIOUS_MISSING")]) {
      const result = await readSourcePrefix(input, context, accept);
      expect(result).toMatchObject({ status: "rejected", reason: "reader_error" });
      expect(JSON.stringify(result)).not.toContain(input);
    }
    const fifo = join(root, "FICTITIOUS_FIFO");
    execFileSync("mkfifo", [fifo]);
    expect(await readSourcePrefix(fifo, context, accept)).toMatchObject({ status: "rejected", reason: "reader_error" });
    expect(await readFile(regular, "utf8")).toBe('{}\n');
  }, 2000);
});

describe("file descriptor ownership", () => {
  it("closes every owned descriptor before observed, rejected or aborted results resolve", async () => {
    const path = await source('{}\n{}\n'), invalid = await source('FICTITIOUS_INVALID\n');
    const opening = fileSystem.open, handles: FileHandle[] = [];
    const spy = vi.spyOn(fileSystem, "open").mockImplementation(async (...args) => {
      const handle = await opening(...args); handles.push(handle); return handle;
    });
    syncBuiltinESMExports();
    try {
      const controller = new AbortController();
      const attempts = [
        () => readSourcePrefix(path, context, accept),
        () => readSourcePrefix(path, context, () => false),
        () => readSourcePrefix(path, context, () => { throw new Error("FICTITIOUS_CONSUMER_ERROR"); }),
        () => readSourcePrefix(invalid, context, accept),
        () => readSourcePrefix(path, context, accept, { maxFileBytes: 1 }),
        () => readSourcePrefix(path, context, () => { controller.abort(); return true; }, { signal: controller.signal }),
      ];
      for (const attempt of attempts) {
        const previous = handles.length; await attempt();
        expect(handles.length).toBe(previous + 1);
        await expect(handles.at(-1)!.stat()).rejects.toMatchObject({ code: "EBADF" });
      }
    } finally { spy.mockRestore(); syncBuiltinESMExports(); for (const handle of handles) await handle.close(); }
  });
});
