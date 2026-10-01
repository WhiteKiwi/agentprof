import { constants } from "node:fs";
import { createHmac, createSecretKey, randomBytes } from "node:crypto";
import type { Hmac } from "node:crypto";
import { types } from "node:util";
import { link, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { SafeError } from "../privacy/diagnostics.js";
import { ensurePrivateDirectory, fileCode, openPrivateFile } from "../privacy/paths.js";

export const NORMALIZATION_VERSION = 1;
export const KEY_VERSION = 1;
const typedArrayByteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteLength")!.get!;
const MAX_IDENTITY_BYTES = 2 * 1024 * 1024;
const DOMAINS = new Set(["event", "session", "turn", "source", "operation", "lookup", "file", "content", "error"]);

export type IdentityDomain = "event" | "session" | "turn" | "source" | "operation" | "lookup" | "file" | "content" | "error";
export type IdentityPart = string | number | boolean | null | readonly IdentityPart[];
export type SourceFileProofInput = Readonly<{
  sourceId: string; provider: "codex" | "claude"; parserVersion: number;
  maxFileBytes: number; maxRecords: number; maxLineBytes: number; observedSize: number;
}>;
export type SourceFileProofWriter = Readonly<{ update(bytes: Uint8Array): void; finish(): string; discard(): void }>;
export type IdentityContext = Readonly<{
  normalizationVersion: 1;
  keyVersion: 1;
  keyId: string;
  startSourceFileProof(input: SourceFileProofInput): SourceFileProofWriter;
  fingerprint(domain: IdentityDomain, parts: readonly IdentityPart[]): string;
}>;

function validPart(part: IdentityPart, depth = 0): boolean {
  if (depth > 32) return false;
  return part === null || typeof part === "string" || typeof part === "boolean" || (typeof part === "number" && Number.isFinite(part))
    || (Array.isArray(part) && part.every((value) => validPart(value, depth + 1)));
}

// Reuse the private key representation; every fingerprint still computes its own HMAC.
export function createIdentityContext(secret: Uint8Array, keyId: string): IdentityContext {
  if (secret.byteLength !== 32 || !/^[a-f0-9]{32}$/.test(keyId)) throw new SafeError("INVALID_IDENTITY_KEY");
  const key = createSecretKey(Buffer.from(secret));
  return Object.freeze({
    normalizationVersion: NORMALIZATION_VERSION,
    keyVersion: KEY_VERSION,
    keyId,
    startSourceFileProof(input: SourceFileProofInput): SourceFileProofWriter {
      const names = ["sourceId", "provider", "parserVersion", "maxFileBytes", "maxRecords", "maxLineBytes", "observedSize"];
      if (input === null || typeof input !== "object" || types.isProxy(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new SafeError("INVALID_RECORD");
      const descriptors = Object.getOwnPropertyDescriptors(input), value: Record<string, unknown> = Object.create(null);
      if (Reflect.ownKeys(descriptors).length !== names.length) throw new SafeError("INVALID_RECORD");
      for (const name of names) {
        const descriptor = descriptors[name as keyof SourceFileProofInput];
        if (!descriptor || !("value" in descriptor)) throw new SafeError("INVALID_RECORD");
        value[name] = descriptor.value;
      }
      const bounded = (name: string, minimum: number, maximum: number): number => {
        const n = value[name];
        if (typeof n !== "number" || !Number.isSafeInteger(n) || n < minimum || n > maximum) throw new SafeError("INVALID_RECORD");
        return n;
      };
      const prefix = `h1:${keyId}:source:`, sourceId = value["sourceId"], provider = value["provider"];
      if (typeof sourceId !== "string" || sourceId.length !== prefix.length + 64 || !sourceId.startsWith(prefix) || !/^[a-f0-9]{64}$/.test(sourceId.slice(prefix.length))
        || (provider !== "codex" && provider !== "claude")) throw new SafeError("INVALID_RECORD");
      const parserVersion = bounded("parserVersion", 1, Number.MAX_SAFE_INTEGER), maxFileBytes = bounded("maxFileBytes", 1, 64 * 1024 * 1024);
      const maxRecords = bounded("maxRecords", 1, 32768), maxLineBytes = bounded("maxLineBytes", 1, 1024 * 1024), observedSize = bounded("observedSize", 0, maxFileBytes);
      const header = Buffer.from(JSON.stringify([NORMALIZATION_VERSION, KEY_VERSION, "content", "source_file_bytes_v1", sourceId, provider, parserVersion, 1, maxFileBytes, maxRecords, maxLineBytes, observedSize]), "utf8");
      if (header.byteLength > 1024) throw new SafeError("IDENTITY_INPUT_TOO_LARGE");
      const length = Buffer.alloc(4); length.writeUInt32BE(header.byteLength);
      let hmac: Hmac | null = createHmac("sha256", key).update("agentprof.source-file-proof/v1\0").update(length).update(header), received = 0;
      return Object.freeze({
        update(bytes: Uint8Array): void {
          if (hmac === null || !types.isUint8Array(bytes)) throw new SafeError("INVALID_RECORD");
          const size: number = typedArrayByteLength.call(bytes);
          if (size > observedSize - received) throw new SafeError("INVALID_RECORD");
          hmac.update(bytes); received += size;
        },
        finish(): string {
          if (hmac === null) throw new SafeError("INVALID_RECORD");
          const current = hmac; hmac = null;
          if (received !== observedSize) throw new SafeError("INVALID_RECORD");
          return `h1:${keyId}:content:${current.digest("hex")}`;
        },
        discard(): void { hmac = null; },
      });
    },
    fingerprint(domain: IdentityDomain, parts: readonly IdentityPart[]): string {
      if (!DOMAINS.has(domain) || !parts.every((part) => validPart(part))) throw new SafeError("INVALID_RECORD");
      const value = JSON.stringify([NORMALIZATION_VERSION, KEY_VERSION, domain, ...parts]);
      if (Buffer.byteLength(value) > MAX_IDENTITY_BYTES) throw new SafeError("IDENTITY_INPUT_TOO_LARGE");
      return `h1:${keyId}:${domain}:${createHmac("sha256", key).update(value).digest("hex")}`;
    },
  });
}

export function comparableIdentities(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return false;
  const pattern = /^h1:([a-f0-9]{32}):(event|session|turn|source|operation|lookup|file|content|error):[a-f0-9]{64}$/;
  const a = pattern.exec(left);
  const b = pattern.exec(right);
  return a !== null && b !== null && a[1] === b[1] && a[2] === b[2];
}

/** Shared serialized key contract; never creates or repairs a key. */
export function parseIdentityKey(text: string): Readonly<{ keyId: string; secret: string }> {
  try {
    const raw: unknown = JSON.parse(text);
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new SafeError("INVALID_IDENTITY_KEY");
    const value = raw as { keyVersion?: unknown; keyId?: unknown; secret?: unknown };
    if (value.keyVersion !== KEY_VERSION || typeof value.keyId !== "string" || !/^[a-f0-9]{32}$/.test(value.keyId)
      || typeof value.secret !== "string" || !/^[a-f0-9]{64}$/.test(value.secret)) throw new SafeError("INVALID_IDENTITY_KEY");
    return Object.freeze({ keyId: value.keyId, secret: value.secret });
  } catch { throw new SafeError("INVALID_IDENTITY_KEY"); }
}

export async function loadOrCreateIdentityContext(dataDir: string): Promise<IdentityContext> {
  const directory = await ensurePrivateDirectory(dataDir);
  const destination = join(directory, "identity-key.json");
  const temporary = join(directory, `.identity-key-${randomBytes(16).toString("hex")}.tmp`);
  const payload = JSON.stringify({ keyVersion: KEY_VERSION, keyId: randomBytes(16).toString("hex"), secret: randomBytes(32).toString("hex") }) + "\n";
  // Write and sync a complete temporary file, then atomically install without replacing another writer.
  let temporaryCreated = false;
  try {
    const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    temporaryCreated = true;
    try { await file.writeFile(payload, "utf8"); await file.sync(); } finally { await file.close(); }
    try { await link(temporary, destination); } catch (error) { if (fileCode(error) !== "EEXIST") throw error; }
  } catch (error) {
    if (error instanceof SafeError) throw error;
    throw new SafeError("UNSAFE_PRIVATE_FILE");
  } finally {
    if (temporaryCreated) await unlink(temporary).catch(() => undefined);
  }

  const file = await openPrivateFile(destination);
  try {
    if ((await file.stat()).size > 1024) throw new SafeError("INVALID_IDENTITY_KEY");
    const value = parseIdentityKey(await file.readFile("utf8"));
    return createIdentityContext(Buffer.from(value.secret, "hex"), value.keyId);
  } catch (error) {
    if (error instanceof SafeError) throw error;
    throw new SafeError("INVALID_IDENTITY_KEY");
  } finally { await file.close(); }
}
