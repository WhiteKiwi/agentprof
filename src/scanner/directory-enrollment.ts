import type { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { types } from "node:util";
import type { IdentityContext } from "../normalize/identity.js";
import { captureMode } from "../parsers/capture.js";
import { SafeError } from "../privacy/diagnostics.js";
import type { InputRoot } from "../privacy/paths.js";
import { choice, fields } from "../db/source-validation.js";
import { createDirectoryMembershipStore } from "../db/directory-membership.js";
import type { DirectoryCaptureResult } from "../db/directory-membership.js";
import { createSourceStore } from "../db/source-store.js";
import { CensusFailure, censusDirectory, openDirectoryLease, sameCensus } from "./directory-census.js";
import { scanSources } from "./scan-run.js";
import type { ScanResult } from "./scan-run.js";
import { validSourcePath } from "./source-prefix.js";

export type DirectoryEnrollmentOptions = Readonly<{ signal?: AbortSignal; usageTiming?: boolean; patternEvidence?: boolean }>;
export type DirectoryEnrollmentResult = Readonly<{ mode: "directory_enrollment"; rootId: string; provider: "codex" | "claude"; scan: ScanResult | null; membership: DirectoryCaptureResult | Readonly<{ status: "ineligible" | "aborted"; reason: string }>; membershipCaptureChangesSourceAvailability: false; directoryReconciled: false }>;
/** Internal opt-in API. Complete membership observations are not retirement authority. */
export async function enrollDirectory(database: DatabaseSync, context: IdentityContext, root: InputRoot, options: DirectoryEnrollmentOptions = {}): Promise<DirectoryEnrollmentResult> {
  if (types.isProxy(root) || types.isProxy(options)) throw new SafeError("INVALID_ARGUMENT");
  const input = fields(root, ["provider", "path"]), provider = choice(input["provider"], ["codex", "claude"] as const);
  validSourcePath(input["path"] as string);
  const path = resolve(input["path"] as string);
  const names = Object.keys(Object.getOwnPropertyDescriptors(options));
  if (names.some(n => !["signal", "usageTiming", "patternEvidence"].includes(n))) throw new SafeError("INVALID_ARGUMENT");
  const v = fields(options, names), signal = v["signal"] as AbortSignal | undefined;
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new SafeError("INVALID_ARGUMENT");
  const mode = captureMode({ ...(v["usageTiming"] === undefined ? {} : { usageTiming: v["usageTiming"] as boolean }), ...(v["patternEvidence"] === undefined ? {} : { patternEvidence: v["patternEvidence"] as boolean }) });
  if (database.isTransaction) throw new SafeError("DATABASE_TRANSACTION_FAILED");
  const rootId = context.fingerprint("source", ["directory_root_v1", provider, path]);
  let scan: ScanResult | null = null;
  const finish = (membership: DirectoryEnrollmentResult["membership"]): DirectoryEnrollmentResult => Object.freeze({ mode: "directory_enrollment", rootId, provider, scan, membership: Object.freeze(membership), membershipCaptureChangesSourceAvailability: false, directoryReconciled: false });
  if (signal?.aborted) return finish({ status: "aborted", reason: "aborted" });
  const memberships = createDirectoryMembershipStore(database, context), prior = memberships.read(rootId);
  let lease: Awaited<ReturnType<typeof openDirectoryLease>> | undefined;
  try {
    lease = await openDirectoryLease(path);
    const p = lease.identity, rootFingerprint = context.fingerprint("content", ["directory_physical_root_v1", p.dev, p.ino, p.mode, p.uid]);
    if (prior && (prior.provider !== provider || prior.rootFingerprint !== rootFingerprint)) return finish({ status: "ineligible", reason: "root_changed" });
    const before = await censusDirectory(path, signal);
    await lease.verify();
    scan = await scanSources(createSourceStore(database, context.keyId), context, [{ provider, path }], { ...(signal === undefined ? {} : { signal }), ...(mode.usageTiming ? mode : {}) });
    if (signal?.aborted || scan.status === "aborted") return finish({ status: "aborted", reason: "aborted" });
    if (scan.stopReason !== null || scan.discoveryTruncated) return finish({ status: "ineligible", reason: "scan_incomplete" });
    const after = await censusDirectory(path, signal);
    await lease.verify();
    if (!sameCensus(before, after)) return finish({ status: "ineligible", reason: "census_changed" });
    const selected = new Set(before.paths.map(file => context.fingerprint("source", [provider, file])));
    const observed: { sourceId: string; sourceRevision: number }[] = [];
    for (const source of scan.sources) {
      const revision = source.status === "committed" ? source.committedRevision : source.status === "unchanged" ? source.reusedRevision : null;
      if (!selected.delete(source.sourceId) || source.provider !== provider || revision === null || !Number.isSafeInteger(revision) || revision < 1) return finish({ status: "ineligible", reason: "scan_incomplete" });
      observed.push({ sourceId: source.sourceId, sourceRevision: revision });
    }
    if (selected.size !== 0) return finish({ status: "ineligible", reason: "scan_incomplete" });
    // Fail before capture if closing the last owned handle fails.
    await lease.close(); lease = undefined;
    // No asynchronous gap after the completed filesystem checks/close and synchronous CAS.
    const membership = memberships.capture({ rootId, provider, rootFingerprint, observed }, prior?.revision ?? null, signal);
    return finish(membership);
  } catch (error) {
    if (error instanceof CensusFailure) return finish({ status: error.reason === "aborted" ? "aborted" : "ineligible", reason: error.reason });
    throw error;
  } finally { if (lease) try { await lease.close(); } catch { throw new SafeError("INPUT_ACCESS_FAILED"); } }
}
