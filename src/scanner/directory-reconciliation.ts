import type { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import type { IdentityContext } from "../normalize/identity.js";
import { SafeError } from "../privacy/diagnostics.js";
import type { InputRoot } from "../privacy/paths.js";
import { createDirectoryMembershipStore } from "../db/directory-membership.js";
import { retireDirectoryAbsences, retireDirectoryBatchAbsences, unavailableDirectoryRetirement } from "../db/directory-retirement.js";
import type { DirectoryRetirementResult } from "../db/directory-retirement.js";
import type { DirectoryEnrollmentResult } from "./directory-enrollment.js";
import { censusDirectory, censusDirectoryBatched, openDirectoryLease, sameCensus, CensusFailure } from "./directory-census.js";

/** Follows successful enrollment; absence alone never bypasses native capture/receipt gates. */
export async function reconcileDirectoryAbsence(database: DatabaseSync, context: IdentityContext, root: InputRoot,
  enrollment: DirectoryEnrollmentResult, signal?: AbortSignal, batchDirectory = false): Promise<DirectoryRetirementResult> {
  if (typeof batchDirectory !== "boolean") throw new SafeError("INVALID_ARGUMENT");
  const census = batchDirectory ? censusDirectoryBatched : censusDirectory;
  const retire = batchDirectory ? retireDirectoryBatchAbsences : retireDirectoryAbsences;
  if (signal?.aborted) return unavailableDirectoryRetirement("aborted", "aborted");
  const receipt = enrollment.membership, path = resolve(root.path);
  const rootId = context.fingerprint("source", ["directory_root_v1", root.provider, path]);
  if ((receipt.status !== "committed" && receipt.status !== "unchanged") || rootId !== enrollment.rootId || root.provider !== enrollment.provider) {
    return unavailableDirectoryRetirement("ineligible", "enrollment_incomplete");
  }
  const snapshot = createDirectoryMembershipStore(database, context).read(rootId);
  if (!snapshot || snapshot.revision !== receipt.revision || snapshot.members.length !== receipt.memberCount) {
    return unavailableDirectoryRetirement("stale", "membership_changed");
  }
  let lease: Awaited<ReturnType<typeof openDirectoryLease>> | undefined;
  try {
    lease = await openDirectoryLease(path);
    const p = lease.identity, rootFingerprint = context.fingerprint("content", ["directory_physical_root_v1", p.dev, p.ino, p.mode, p.uid]);
    if (rootFingerprint !== snapshot.rootFingerprint) return unavailableDirectoryRetirement("ineligible", "root_changed");
    const before = await census(path, signal);
    await lease.verify();
    const after = await census(path, signal);
    await lease.verify();
    if (!sameCensus(before, after)) return unavailableDirectoryRetirement("ineligible", "census_changed");
    const observedSourceIds = after.paths.map(file => context.fingerprint("source", [root.provider, file]));
    // All handle failures precede retirement. No await between this close and the write transaction.
    await lease.close(); lease = undefined;
    return retire(database, context, { rootId, provider: root.provider, rootFingerprint,
      membershipRevision: snapshot.revision, observedSourceIds }, signal);
  } catch (error) {
    if (error instanceof CensusFailure) return unavailableDirectoryRetirement(error.reason === "aborted" ? "aborted" : "ineligible", error.reason);
    throw error;
  } finally { if (lease) try { await lease.close(); } catch { throw new SafeError("INPUT_ACCESS_FAILED"); } }
}
