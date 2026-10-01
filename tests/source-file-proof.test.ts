import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createIdentityContext } from "../src/normalize/identity.js";
import type { SourceFileProofInput } from "../src/normalize/identity.js";
import { safeErrorEnvelope } from "../src/privacy/diagnostics.js";

const secret = Buffer.alloc(32, 37), context = createIdentityContext(secret, "a".repeat(32));
function input(size: number): SourceFileProofInput {
  return { sourceId: context.fingerprint("source", ["codex", "FICTITIOUS_PRIVATE_PATH"]), provider: "codex", parserVersion: 1,
    maxFileBytes: 64 * 1024 * 1024, maxRecords: 32768, maxLineBytes: 1024 * 1024, observedSize: size };
}
function proof(bytes: Uint8Array, options = input(bytes.byteLength), chunks = [bytes.byteLength]): string {
  const writer = context.startSourceFileProof(options); let at = 0;
  for (const size of chunks) { writer.update(bytes.subarray(at, at + size)); at += size; }
  return writer.finish();
}
describe("streaming whole-source HMAC framing", () => {
  it.each([Buffer.alloc(0), Buffer.from("\ufeff{\"a\":\"한글\"}\r\n{}\npartial"), Buffer.from([0xef, 0xbb, 0xbf, 0x0a, 0xf0, 0x9f])])("matches independent standard HMAC over exact framing and raw tails", bytes => {
    const v = input(bytes.length);
    const header = Buffer.from(JSON.stringify([1, 1, "content", "source_file_bytes_v1", v.sourceId, "codex", 1, 1, 67108864, 32768, 1048576, bytes.length]));
    const length = Buffer.alloc(4); length.writeUInt32BE(header.length);
    const oracle = createHmac("sha256", secret).update(Buffer.concat([Buffer.from("agentprof.source-file-proof/v1\0"), length, header, bytes])).digest("hex");
    expect(proof(bytes)).toBe(`h1:${context.keyId}:content:${oracle}`);
    expect(proof(bytes, v, Array(bytes.length).fill(1))).toBe(proof(bytes));
  });
  it("pins one independent golden vector and separates every interpretation identity", () => {
    const bytes = Buffer.from("{}\n"), v = input(3), original = proof(bytes);
    expect(original).toBe("h1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:content:4eeb234492a2840cf40ba1b23509a682608741903202058682c1495ee680129d");
    for (const change of [{ sourceId: context.fingerprint("source", ["codex", "other"]) }, { provider: "claude" }, { parserVersion: 2 }, { maxFileBytes: 16 * 1024 * 1024 }, { maxRecords: 1 }, { maxLineBytes: 100 }]) {
      expect(proof(bytes, { ...v, ...change } as SourceFileProofInput)).not.toBe(original);
    }
    const other = createIdentityContext(Buffer.alloc(32, 38), context.keyId), writer = other.startSourceFileProof(v); writer.update(bytes);
    expect(writer.finish()).not.toBe(original);
    expect(proof(Buffer.from("[]\n"))).not.toBe(original);
    expect(context.fingerprint("content", ["source_file_bytes_v1", v.sourceId, "codex", 1, 1, v.maxFileBytes, v.maxRecords, v.maxLineBytes, 3])).not.toBe(original);
  });
  it("consumes synchronously, permits zero chunks, rejects short/excess and closes writers", () => {
    const bytes = Buffer.from("{}\n"), wanted = proof(bytes), writer = context.startSourceFileProof(input(3));
    writer.update(Buffer.alloc(0)); writer.update(bytes); bytes.fill(0);
    expect(writer.finish()).toBe(wanted);
    expect(() => writer.finish()).toThrowError(expect.objectContaining({ code: "INVALID_RECORD" }));
    expect(() => writer.update(Buffer.alloc(0))).toThrow(); writer.discard(); writer.discard();
    const excess = context.startSourceFileProof(input(3)); expect(() => excess.update(Buffer.alloc(4))).toThrow(); excess.update(Buffer.from("{}\n")); expect(excess.finish()).toBe(wanted);
    const short = context.startSourceFileProof(input(1)); expect(() => short.finish()).toThrow(); expect(() => short.update(Buffer.alloc(1))).toThrow();
    const discarded = context.startSourceFileProof(input(0)); discarded.discard(); expect(() => discarded.finish()).toThrow();
    const invalid = context.startSourceFileProof(input(1)); expect(() => invalid.update("x" as never)).toThrow();
  });
  it("rejects non-data/extra/unsupported metadata without executing accessors or exposing it", () => {
    let calls = 0; const v = input(0);
    const getter = Object.defineProperty({ ...v }, "sourceId", { get() { calls++; return "FICTITIOUS_SECRET"; } });
    const values = [getter, { ...v, toJSON() { calls++; return "FICTITIOUS_SECRET"; } }, Object.assign(Object.create({}), v), null,
      { ...v, sourceId: `h1:${"b".repeat(32)}:source:${"c".repeat(64)}` }, { ...v, provider: "unknown" }, { ...v, parserVersion: 0 },
      { ...v, observedSize: -1 }, { ...v, observedSize: v.maxFileBytes + 1 }, ...["maxFileBytes", "maxRecords", "maxLineBytes"].flatMap(k => [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER].map(n => ({ ...v, [k]: n })))];
    for (const value of values) {
      let error: unknown; try { context.startSourceFileProof(value as never); } catch (e) { error = e; }
      expect(error).toMatchObject({ code: "INVALID_RECORD" }); expect(JSON.stringify(safeErrorEnvelope(error))).not.toContain("FICTITIOUS");
    }
    expect(calls).toBe(0);
    expect(() => context.fingerprint("content", ["x".repeat(2 * 1024 * 1024)])).toThrowError(expect.objectContaining({ code: "IDENTITY_INPUT_TOO_LARGE" }));
  });
});

it("counts intrinsic view bytes without invoking shadowed lengths and rejects metadata proxies before traps", () => {
  const bytes = Buffer.from("{}\n"), wanted = proof(bytes); let calls = 0;
  Object.defineProperty(bytes, "byteLength", { get() { calls++; throw Error("FICTITIOUS_SECRET"); } });
  const writer = context.startSourceFileProof(input(3)); writer.update(bytes); expect(writer.finish()).toBe(wanted); expect(calls).toBe(0);
  const excess = context.startSourceFileProof(input(0)); expect(() => excess.update(bytes)).toThrowError(expect.objectContaining({ code: "INVALID_RECORD" })); expect(excess.finish()).toBe(proof(Buffer.alloc(0)));
  const trapped = new Proxy(input(0), { getPrototypeOf() { calls++; throw Error("FICTITIOUS_SECRET"); } });
  const revoked = Proxy.revocable(input(0), {}); revoked.revoke();
  for (const value of [trapped, revoked.proxy]) expect(() => context.startSourceFileProof(value)).toThrowError(expect.objectContaining({ code: "INVALID_RECORD" }));
  expect(calls).toBe(0);
});
