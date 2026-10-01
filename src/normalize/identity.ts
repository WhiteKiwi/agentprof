import { constants } from "node:fs";
import { createHmac, createSecretKey, randomBytes } from "node:crypto";
import { link, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { SafeError } from "../privacy/diagnostics.js";
import { ensurePrivateDirectory, fileCode, openPrivateFile } from "../privacy/paths.js";

export const NORMALIZATION_VERSION = 1;
export const KEY_VERSION = 1;
const MAX_IDENTITY_BYTES = 2 * 1024 * 1024;
const DOMAINS = new Set(["event", "session", "turn", "source", "operation", "lookup", "file", "content", "error"]);

export type IdentityDomain = "event" | "session" | "turn" | "source" | "operation" | "lookup" | "file" | "content" | "error";
export type IdentityPart = string | number | boolean | null | readonly IdentityPart[];
export type IdentityContext = Readonly<{
  normalizationVersion: 1;
  keyVersion: 1;
  keyId: string;
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
    const raw: unknown = JSON.parse(await file.readFile("utf8"));
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new SafeError("INVALID_IDENTITY_KEY");
    const value = raw as { keyVersion?: unknown; keyId?: unknown; secret?: unknown };
    if (value.keyVersion !== KEY_VERSION || typeof value.keyId !== "string" || typeof value.secret !== "string" || !/^[a-f0-9]{64}$/.test(value.secret)) {
      throw new SafeError("INVALID_IDENTITY_KEY");
    }
    return createIdentityContext(Buffer.from(value.secret, "hex"), value.keyId);
  } catch (error) {
    if (error instanceof SafeError) throw error;
    throw new SafeError("INVALID_IDENTITY_KEY");
  } finally { await file.close(); }
}
