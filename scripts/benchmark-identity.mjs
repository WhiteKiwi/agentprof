// Focused synthetic steady-state fingerprint benchmark; not a scanner benchmark.
// Run after npm run build. No user data or identity key files are read.
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { availableParallelism, cpus, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import { createIdentityContext } from "../dist/normalize/identity.js";
import { SafeError } from "../dist/privacy/diagnostics.js";

const DOMAINS = new Set(["event", "session", "turn", "source", "operation", "lookup", "file", "content", "error"]);
const KEY_ID = "0".repeat(32);
// Previous implementation at baa384f, retaining its full validation/encoding path.
function bufferReference(secret, keyId) {
  if (secret.byteLength !== 32 || !/^[a-f0-9]{32}$/.test(keyId)) throw new SafeError("INVALID_IDENTITY_KEY");
  const key = Buffer.from(secret);
  function validPart(part, depth = 0) {
    if (depth > 32) return false;
    return part === null || typeof part === "string" || typeof part === "boolean" || (typeof part === "number" && Number.isFinite(part))
      || (Array.isArray(part) && part.every((value) => validPart(value, depth + 1)));
  }
  return Object.freeze({ normalizationVersion: 1, keyVersion: 1, keyId,
    fingerprint(domain, parts) {
      if (!DOMAINS.has(domain) || !parts.every((part) => validPart(part))) throw new SafeError("INVALID_RECORD");
      const value = JSON.stringify([1, 1, domain, ...parts]);
      if (Buffer.byteLength(value) > 2 * 1024 * 1024) throw new SafeError("IDENTITY_INPUT_TOO_LARGE");
      return `h1:${keyId}:${domain}:${createHmac("sha256", key).update(value).digest("hex")}`;
    },
  });
}
const calls = 50_000;
const warmupCalls = 5_000;
const trials = 6;
const domains = [...DOMAINS];
const inputs = Array.from({ length: 1000 }, (_, i) => ({
  domain: domains[i % domains.length],
  parts: ["synthetic", i, `target-${i}`, ["한글", true, null, i / 7]],
}));
const contexts = {
  buffer: bufferReference(new Uint8Array(32).fill(7), KEY_ID),
  keyObject: createIdentityContext(new Uint8Array(32).fill(7), KEY_ID),
};
for (const { domain, parts } of inputs) assert.equal(contexts.buffer.fingerprint(domain, parts), contexts.keyObject.fingerprint(domain, parts));
function run(context, count) {
  const digest = createHash("sha256");
  for (let i = 0; i < count; i++) {
    const { domain, parts } = inputs[i % inputs.length];
    digest.update(context.fingerprint(domain, parts));
  }
  return digest.digest("hex");
}
for (const context of Object.values(contexts)) run(context, warmupCalls);
const measurements = [];
let expected;
for (let trial = 0; trial < trials; trial++) {
  const order = trial % 2 === 0 ? ["buffer", "keyObject"] : ["keyObject", "buffer"];
  for (const implementation of order) {
    const started = performance.now();
    const digest = run(contexts[implementation], calls);
    const elapsedMs = performance.now() - started;
    expected ??= digest;
    assert.equal(digest, expected);
    measurements.push({ trial: trial + 1, implementation, elapsedMs });
  }
}
const summary = Object.fromEntries(Object.keys(contexts).map((implementation) => {
  const values = measurements.filter((row) => row.implementation === implementation).map((row) => row.elapsedMs).sort((a, b) => a - b);
  return [implementation, { medianMs: (values[2] + values[3]) / 2, minMs: values[0], maxMs: values.at(-1) }];
}));
console.log(JSON.stringify({
  benchmark: "synthetic-identity-steady-state-v1", sourceBaseline: "baa384f779d5eab6d31a6c7099372f19a1d98496",
  callsPerTrial: calls, warmupCallsPerImplementation: warmupCalls, trialsPerImplementation: trials,
  uniqueSyntheticInputs: inputs.length, order: "alternating paired trials in one process",
  measured: "fingerprint validation, JSON encoding, SHA-256 HMAC, formatting, loop and output checksum",
  excluded: "module startup, context construction, disk I/O, parser, database, scanner, worker scheduling",
  environment: { node: process.version, openssl: process.versions.openssl, platform: process.platform, arch: process.arch,
    cpuModel: cpus()[0]?.model ?? "unknown", availableParallelism: availableParallelism(), reportedRamBytes: totalmem(), isolatedHost: false },
  correctness: { allTrialsEqual: true, sha256: expected }, measurements, summary,
}, null, 2));
