import { createHmac } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalizeEvent } from "../src/normalize/event.js";
import { createIdentityContext } from "../src/normalize/identity.js";
import type { IdentityContext, IdentityDomain, IdentityPart } from "../src/normalize/identity.js";
import { createCodexAdapter } from "../src/parsers/codex/index.js";
import { SafeError } from "../src/privacy/diagnostics.js";
import { readJsonLines } from "../src/scanner/jsonl.js";

const domains: IdentityDomain[] = ["event", "session", "turn", "source", "operation", "lookup", "file", "content", "error"];
const keyId = "0".repeat(32);
const secret = () => new Uint8Array(32).fill(7);

// Frozen behavior reference from baa384f. Do not share production validation helpers:
// a future contract change must update the reference deliberately, not silently.
function bufferReference(secret: Uint8Array, keyId: string): IdentityContext {
  if (secret.byteLength !== 32 || !/^[a-f0-9]{32}$/.test(keyId)) throw new SafeError("INVALID_IDENTITY_KEY");
  const key = Buffer.from(secret);
  const valid = (part: IdentityPart, depth = 0): boolean => depth <= 32 && (
    part === null || typeof part === "string" || typeof part === "boolean" ||
    (typeof part === "number" && Number.isFinite(part)) ||
    (Array.isArray(part) && part.every((value) => valid(value, depth + 1)))
  );
  return Object.freeze({ normalizationVersion: 1, keyVersion: 1, keyId,
    fingerprint(domain: IdentityDomain, parts: readonly IdentityPart[]) {
      if (!domains.includes(domain) || !parts.every((part) => valid(part))) throw new SafeError("INVALID_RECORD");
      const value = JSON.stringify([1, 1, domain, ...parts]);
      if (Buffer.byteLength(value) > 2 * 1024 * 1024) throw new SafeError("IDENTITY_INPUT_TOO_LARGE");
      return `h1:${keyId}:${domain}:${createHmac("sha256", key).update(value).digest("hex")}`;
    },
  });
}
function outcome(call: () => unknown): unknown {
  try { return { value: call() }; }
  catch (error) { return error instanceof SafeError ? { code: error.code } : { name: (error as Error).name }; }
}
const optimized = createIdentityContext(secret(), keyId);
const baseline = bufferReference(secret(), keyId);

function expectParity(domain: IdentityDomain, parts: readonly IdentityPart[]) {
  expect(outcome(() => optimized.fingerprint(domain, parts))).toEqual(outcome(() => baseline.fingerprint(domain, parts)));
}

describe("identity key representation compatibility", () => {
  it("matches independent Python hashlib/hmac SHA-256 vectors", () => {
    // Python: hmac.new(bytes([7])*32, json.dumps([1,1,domain,*parts],
    // ensure_ascii=False,separators=(',',':')).encode(), hashlib.sha256).hexdigest().
    const vectors: [IdentityDomain, IdentityPart[], string][] = [
      ["event", ["fixture", null, true, false, 42], "870f04dda42b9ac9049ff614ec317ec11b316483aae311031bbfe9be0edc910f"],
      ["operation", ["codex", "project", ["npm", "test", "alpha"]], "2a75c156e72a4228093d9f9927337b8dbc1c22e0c1558ff3ce15c6d25ea1a019"],
      ["content", ["", "한글", "😀", "é"], "4345f0a3a09fe0e7db82cbbc6578acca3f81d49dbd774d54147ff0a0e9efbf01"],
    ];
    for (const [domain, parts, digest] of vectors) expect(optimized.fingerprint(domain, parts)).toBe(`h1:${keyId}:${domain}:${digest}`);
  });

  it("preserves all domains, canonical primitive/array encoding and Unicode", () => {
    const cases: IdentityPart[][] = [[], [null, true, false, 0, -0, 1.25, Number.MAX_SAFE_INTEGER, 1e-7, 1e21],
      ["", "\u0000\n\r\t\"\\", "한글", "😀", "\ud800", "\udfff", "é", "é"],
      [["nested", [false, [7, null]]]], new Array(3)];
    for (const domain of domains) for (const parts of cases) expectParity(domain, parts);
    expect(new Set(domains.map((domain) => optimized.fingerprint(domain, ["same"])))).toHaveLength(domains.length);
    expect(optimized.fingerprint("content", ["é"])).not.toBe(optimized.fingerprint("content", ["é"]));
  });

  it("copies exactly the supplied key view and never exposes it on the context", () => {
    const backing = new Uint8Array(96).fill(99);
    backing.fill(7, 32, 64);
    const context = createIdentityContext(backing.subarray(32, 64), keyId);
    const before = baseline.fingerprint("event", ["private"]);
    backing.fill(0);
    expect(context.fingerprint("event", ["private"])).toBe(before);
    expect(Object.isFrozen(context)).toBe(true);
    expect(Reflect.ownKeys(context).sort()).toEqual(["fingerprint", "keyId", "keyVersion", "normalizationVersion", "startSourceFileProof"]);
    expect(JSON.stringify(context)).toBe(JSON.stringify({ normalizationVersion: 1, keyVersion: 1, keyId }));
  });

  it("retains key validation and safe error codes", () => {
    for (const size of [0, 31, 33, 64]) {
      const key = new Uint8Array(size);
      expect(outcome(() => createIdentityContext(key, keyId))).toEqual({ code: "INVALID_IDENTITY_KEY" });
      expect(outcome(() => createIdentityContext(key, keyId))).toEqual(outcome(() => bufferReference(key, keyId)));
    }
    for (const id of ["", "a".repeat(31), "a".repeat(33), "A".repeat(32), "g".repeat(32), `${keyId}\n`]) {
      expect(outcome(() => createIdentityContext(secret(), id))).toEqual({ code: "INVALID_IDENTITY_KEY" });
      expect(outcome(() => createIdentityContext(secret(), id))).toEqual(outcome(() => bufferReference(secret(), id)));
    }
  });

  it("preserves rejection of invalid parts/domains and exact recursion boundaries", () => {
    for (const value of [NaN, Infinity, -Infinity, undefined, {}, () => 1, Symbol("synthetic"), 1n]) {
      const parts = [value] as IdentityPart[];
      expect(outcome(() => optimized.fingerprint("event", parts))).toEqual({ code: "INVALID_RECORD" });
      expectParity("event", parts);
    }
    expectParity("not-a-domain" as IdentityDomain, []);
    expect(outcome(() => optimized.fingerprint("not-a-domain" as IdentityDomain, []))).toEqual({ code: "INVALID_RECORD" });
    let value: IdentityPart = "leaf";
    for (let depth = 0; depth <= 33; depth++) {
      expectParity("event", [value]);
      if (depth === 32) expect(outcome(() => optimized.fingerprint("event", [value]))).toHaveProperty("value");
      if (depth === 33) expect(outcome(() => optimized.fingerprint("event", [value]))).toEqual({ code: "INVALID_RECORD" });
      value = [value];
    }
  });

  it("enforces the UTF-8 encoded 2 MiB boundary, including multibyte input", () => {
    const limit = 2 * 1024 * 1024;
    const overhead = Buffer.byteLength(JSON.stringify([1, 1, "content", ""]));
    const ascii = "x".repeat(limit - overhead);
    const multibyte = "한".repeat(Math.floor((limit - overhead) / 3)) + "x".repeat((limit - overhead) % 3);
    for (const text of [ascii, multibyte]) {
      expect(Buffer.byteLength(JSON.stringify([1, 1, "content", text]))).toBe(limit);
      expectParity("content", [text]);
      expect(outcome(() => optimized.fingerprint("content", [text]))).toHaveProperty("value");
      expectParity("content", [text + "x"]);
      expect(outcome(() => optimized.fingerprint("content", [text + "x"]))).toEqual({ code: "IDENTITY_INPUT_TOO_LARGE" });
    }
  });

  it("keeps independent key contexts and 20,000 repeated/alternating calls deterministic", () => {
    const keys = [secret(), new Uint8Array(32).fill(8), secret()];
    const ids = [keyId, keyId, "1".repeat(32)];
    const actual = keys.map((key, i) => createIdentityContext(key, ids[i]!));
    const expected = keys.map((key, i) => bufferReference(key, ids[i]!));
    expect(actual[0]!.fingerprint("event", ["same"])).not.toBe(actual[1]!.fingerprint("event", ["same"]));
    expect(actual[0]!.fingerprint("event", ["same"])).not.toBe(actual[2]!.fingerprint("event", ["same"]));
    for (let i = 0; i < 20_000; i++) {
      const index = i % actual.length;
      const domain = domains[i % domains.length]!;
      const parts: IdentityPart[] = [i % 1000, `synthetic-${i % 137}`, [true, null, i / 7]];
      expect(actual[index]!.fingerprint(domain, parts)).toBe(expected[index]!.fingerprint(domain, parts));
    }
  });

  it("preserves normalized events, diagnostics, timing/status and privacy", () => {
    for (const provider of ["codex", "claude"]) for (const status of ["completed", "failed", "cancelled", "pending", "unknown"]) {
      for (const command of ["rg absent src", "npm test target", "echo $(never_execute)", ["git", "diff", "--exit-code"]]) {
        for (const durationMs of [null, 0, 1000, -1, Infinity]) {
          const input = { provider, status, statusEvidence: "explicit", eventIdentity: "synthetic-event", sessionIdentity: "synthetic-session",
            projectIdentity: "FICTITIOUS_PROJECT_SENTINEL", turnIdentity: "synthetic-turn", kind: "shell", toolName: "exec_command", command,
            startAt: "2026-09-01T00:00:00Z", endAt: "2026-09-01T00:00:01Z", durationMs,
            timingEvidence: "source_reported", durationScope: "process_runtime", intervalTimingEvidence: "paired_timestamps", intervalScope: "item_lifecycle",
            errorMessage: "FICTITIOUS_ERROR_SENTINEL", errorClass: "tool_error", exitCode: status === "failed" ? 2 : 0,
            sourceRef: { fileIdentity: "synthetic-file", byteOffset: 10, recordType: "synthetic" } };
          const actual = normalizeEvent(input, optimized);
          expect(actual).toEqual(normalizeEvent(input, baseline));
          expect(JSON.stringify(actual)).not.toContain("FICTITIOUS_");
        }
      }
    }
  });

  it("keeps every existing Codex fixture batch and retained snapshot identical through replay", async () => {
    const directory = fileURLToPath(new URL("fixtures/providers/", import.meta.url));
    const files = readdirSync(directory).filter((file) => file.startsWith("codex-") && file.endsWith(".jsonl")).sort();
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const actual = createCodexAdapter(optimized);
      const expected = createCodexAdapter(baseline);
      const before = readFileSync(`${directory}/${file}`);
      for (let replay = 0; replay < 2; replay++) {
        let ordinal = 0;
        for await (const entry of readJsonLines(`${directory}/${file}`)) if (entry.kind === "record") {
          const source = { fileIdentity: file, byteOffset: entry.byteOffset, ordinal: ordinal++, sourceAlias: "source-1" };
          expect(actual.ingest(entry.value, source)).toEqual(expected.ingest(entry.value, source));
        }
        expect(actual.snapshot()).toEqual(expected.snapshot());
        expect(actual.inspectRetainedState()).toEqual(expected.inspectRetainedState());
      }
      expect(readFileSync(`${directory}/${file}`)).toEqual(before);
    }
  });
});
