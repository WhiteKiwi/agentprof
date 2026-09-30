import { createHash } from "node:crypto";
import { appendFile, readFile, symlink, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverSources } from "../src/scanner/discovery.js";
import { MAX_LINE_BYTES, readJsonLines } from "../src/scanner/jsonl.js";
import type { JsonLineEntry } from "../src/scanner/jsonl.js";
import { temporaryDirectory } from "./helpers.js";

async function collect(path: string, options: Parameters<typeof readJsonLines>[1] = {}): Promise<JsonLineEntry[]> {
  const entries: JsonLineEntry[] = [];
  for await (const entry of readJsonLines(path, options)) entries.push(entry);
  return entries;
}
const checksum = (value: Buffer) => createHash("sha256").update(value).digest("hex");

describe("bounded read-only JSONL", () => {
  it("counts BOM/CRLF/UTF-8 physical offsets and resumes a partial UTF-8/JSON tail", async () => {
    const path = join(temporaryDirectory(), "synthetic.jsonl");
    const first = Buffer.from('\uFEFF{"a":"도"}\r\n{"b":2}\n');
    expect(first.length).toBe(24);
    const partial = Buffer.concat([Buffer.from('{"p":"'), Buffer.from("도").subarray(0, 1)]);
    await writeFile(path, Buffer.concat([first, partial]));
    const before = checksum(await readFile(path));
    const initial = await collect(path, { chunkBytes: 2 });
    expect(initial[0]).toEqual({ kind: "record", value: { a: "도" }, byteOffset: 0, nextOffset: 16 });
    expect(initial[1]).toEqual({ kind: "record", value: { b: 2 }, byteOffset: 16, nextOffset: 24 });
    expect(initial[2]).toEqual({ kind: "checkpoint", nextOffset: 24, pendingBytes: 7, bytesRead: 31 });
    expect(checksum(await readFile(path))).toBe(before);
    await appendFile(path, Buffer.concat([Buffer.from("도").subarray(1), Buffer.from('"}\n')]));
    expect(await collect(path, { startOffset: 24, chunkBytes: 1 })).toEqual([
      { kind: "record", value: { p: "도" }, byteOffset: 24, nextOffset: 36 },
      { kind: "checkpoint", nextOffset: 36, pendingBytes: 0, bytesRead: 12 },
    ]);
  });
  it("defers a complete JSON tail without newline and returns an empty-file checkpoint", async () => {
    const root = temporaryDirectory();
    const path = join(root, "tail.jsonl");
    await writeFile(path, '{"x":1}');
    expect(await collect(path)).toEqual([{ kind: "checkpoint", nextOffset: 0, pendingBytes: 7, bytesRead: 7 }]);
    await appendFile(path, "\n");
    expect((await collect(path))[0]).toEqual({ kind: "record", value: { x: 1 }, byteOffset: 0, nextOffset: 8 });
    await writeFile(join(root, "empty.jsonl"), "");
    expect(await collect(join(root, "empty.jsonl"))).toEqual([{ kind: "checkpoint", nextOffset: 0, pendingBytes: 0, bytesRead: 0 }]);
  });
  it("accepts exactly1MiB raw bytes and skips1byte excess without losing the next line", async () => {
    const path = join(temporaryDirectory(), "bounded.jsonl");
    const exact = JSON.stringify({ x: "a".repeat(MAX_LINE_BYTES - 8) });
    const excess = JSON.stringify({ x: "a".repeat(MAX_LINE_BYTES - 7) });
    expect(Buffer.byteLength(exact)).toBe(MAX_LINE_BYTES);
    await writeFile(path, exact + "\n" + excess + '\n{"ok":true}\n');
    const result = await collect(path);
    expect(result[0]?.kind).toBe("record");
    expect(result[1]).toMatchObject({ kind: "diagnostic", diagnostic: { code: "RECORD_TOO_LARGE", byteOffset: MAX_LINE_BYTES + 1 }, nextOffset: 2 * MAX_LINE_BYTES + 3 });
    expect(result[2]).toMatchObject({ kind: "record", value: { ok: true }, byteOffset: 2 * MAX_LINE_BYTES + 3 });
  });
  it("counts CR and BOM toward the raw byte limit", async () => {
    const path = join(temporaryDirectory(), "cr-bom.jsonl");
    await writeFile(path, Buffer.from('\uFEFF{"x":1}\r\n{"x":1}\r\n'));
    const result = await collect(path, { maxLineBytes: 8, chunkBytes: 3 });
    expect(result[0]).toMatchObject({ kind: "diagnostic", diagnostic: { code: "RECORD_TOO_LARGE" } });
    expect(result[1]).toEqual({ kind: "record", value: { x: 1 }, byteOffset: 12, nextOffset: 21 });
  });
  it("redacts malformed complete lines and invalid UTF-8", async () => {
    const path = join(temporaryDirectory(), "bad.jsonl");
    await writeFile(path, Buffer.concat([Buffer.from("FICTITIOUS_AGENTPROF_ERROR_SENTINEL\n"), Buffer.from([0xff, 0x0a]), Buffer.from('{"ok":1}\n')]));
    const result = await collect(path, { sourceAlias: "source-1" });
    expect(result[0]).toMatchObject({ kind: "diagnostic", diagnostic: { code: "INVALID_JSON", sourceAlias: "source-1" } });
    expect(result[1]).toMatchObject({ kind: "diagnostic", diagnostic: { code: "INVALID_UTF8" } });
    expect(JSON.stringify(result)).not.toContain("FICTITIOUS_AGENTPROF_ERROR_SENTINEL");
  });
  it("freezes opening size while append is consumed on the next scan", async () => {
    const path = join(temporaryDirectory(), "live.jsonl");
    await writeFile(path, '{"a":1}\n{"b":2}\n');
    const reader = readJsonLines(path, { chunkBytes: 1 });
    expect((await reader.next()).value).toMatchObject({ kind: "record", value: { a: 1 } });
    await appendFile(path, '{"c":3}\n');
    const remaining: JsonLineEntry[] = [];
    for await (const entry of reader) remaining.push(entry);
    expect(remaining).toEqual([
      { kind: "record", value: { b: 2 }, byteOffset: 8, nextOffset: 16 },
      { kind: "checkpoint", nextOffset: 16, pendingBytes: 0, bytesRead: 16 },
    ]);
    expect((await collect(path, { startOffset: 16 }))[0]).toMatchObject({ kind: "record", value: { c: 3 } });
  });
  it("diagnoses a truncate during iteration and rejects invalid line offsets/symlinks", async () => {
    const root = temporaryDirectory();
    const path = join(root, "truncate.jsonl");
    await writeFile(path, '{"a":1}\n{"b":2}\n' + " ".repeat(10000));
    const reader = readJsonLines(path, { chunkBytes: 1 });
    await reader.next();
    await truncate(path, 8);
    const remaining: JsonLineEntry[] = [];
    for await (const entry of reader) remaining.push(entry);
    expect(remaining.some((entry) => entry.kind === "diagnostic" && entry.diagnostic.code === "INPUT_CHANGED")).toBe(true);
    expect((await collect(path, { startOffset: 1 }))[0]).toMatchObject({ kind: "diagnostic", diagnostic: { code: "INVALID_OFFSET" } });
    const linked = join(root, "symlink.jsonl");
    await symlink(path, linked);
    expect((await collect(linked))[0]).toMatchObject({ kind: "diagnostic", diagnostic: { code: "SYMLINK_SKIPPED" } });
  });
});

describe("bounded source discovery", () => {
  it("returns empty/missing roots and ignores root-external symlinks with safe diagnostics", async () => {
    const root = temporaryDirectory();
    const outside = join(temporaryDirectory(), "outside.jsonl");
    await writeFile(outside, "FICTITIOUS_AGENTPROF_OUTPUT_SENTINEL");
    await symlink(outside, join(root, "linked.jsonl"));
    await writeFile(join(root, "compressed.jsonl.gz"), "synthetic");
    await writeFile(join(root, "inside.jsonl"), "{}\n");
    const result = [];
    for await (const entry of discoverSources([{ provider: "codex", path: root }, { provider: "claude", path: join(root, "missing") }])) result.push(entry);
    expect(result.filter((entry) => entry.kind === "source")).toHaveLength(1);
    expect(result.filter((entry) => entry.kind === "diagnostic").map((entry) => entry.diagnostic.code)).toEqual(expect.arrayContaining(["SYMLINK_SKIPPED", "UNSUPPORTED_COMPRESSION", "INPUT_ROOT_MISSING"]));
    expect(JSON.stringify(result.filter((entry) => entry.kind === "diagnostic"))).not.toContain(root);
  });
  it("bounds discovery and skips ambiguous provider mapping", async () => {
    const root = temporaryDirectory();
    await writeFile(join(root, "a.jsonl"), "{}\n");
    await writeFile(join(root, "b.jsonl"), "{}\n");
    const bounded = [];
    for await (const entry of discoverSources([{ provider: "codex", path: root }], { maxFiles: 1 })) bounded.push(entry);
    expect(bounded.filter((entry) => entry.kind === "source")).toHaveLength(1);
    expect(bounded.at(-1)).toMatchObject({ kind: "diagnostic", diagnostic: { code: "DISCOVERY_LIMIT" } });
    const ambiguous = [];
    for await (const entry of discoverSources([{ provider: "codex", path: root }, { provider: "claude", path: root }])) ambiguous.push(entry);
    expect(ambiguous.filter((entry) => entry.kind === "source")).toHaveLength(0);
    expect(ambiguous.some((entry) => entry.kind === "diagnostic" && entry.diagnostic.code === "AMBIGUOUS_INPUT_PROVIDER")).toBe(true);
  });
});
