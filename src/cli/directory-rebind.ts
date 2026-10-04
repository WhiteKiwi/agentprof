import { resolve } from "node:path";
import { types } from "node:util";
import { SafeError } from "../privacy/diagnostics.js";
import { validateCliPath } from "./scan.js";
import { validateDirectoryArguments } from "./directory.js";
import type { DirectoryArguments } from "./directory.js";
import type { DirectoryMembership } from "../db/directory-membership.js";

export type DirectoryRebindArguments = DirectoryArguments & Readonly<{ rebind?: boolean; path?: string }>;
export type DirectoryRebindResult = Readonly<{
  schema: "agentprof.directory-rebind/v1";
  action: "rebind";
  rootId: string;
  status: "committed" | "unchanged" | "stale" | "not_found" | "ineligible" | "aborted";
  reason: "membership_changed" | "membership_not_empty" | "path_mismatch" | "access_failed" | "unsafe_entry" | "changed" | "aborted" | null;
  expectedRevision: number;
  previousRevision: number | null;
  revision: number | null;
  memberCount: number | null;
  bindingChanged: boolean;
  sourcesChanged: false;
  rootAnchorRetained: true;
  inputScanned: false;
}>;
const invalid = (): never => { throw new SafeError("INVALID_ARGUMENT"); };

/** Reuse maintenance's root/revision/global validation without executing reset. */
export function validateDirectoryRebindArguments(options: DirectoryRebindArguments) {
  if (!options || typeof options !== "object" || types.isProxy(options)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(options))) return invalid();
  const fields = Object.getOwnPropertyDescriptors(options), values: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(fields)) {
    if (typeof key !== "string") return invalid();
    const field = fields[key as keyof DirectoryRebindArguments]!;
    if (!("value" in field) || !field.enumerable) return invalid();
    values[key] = field.value;
  }
  if (values["rebind"] !== true || typeof values["path"] !== "string"
    || Object.hasOwn(values, "prune") && values["prune"] !== false
    || Object.hasOwn(values, "reset") && values["reset"] !== false) return invalid();
  const path = values["path"];
  validateCliPath(path);
  delete values["rebind"]; delete values["path"];
  const selected = validateDirectoryArguments({ ...values, reset: true });
  return Object.freeze({ rootId: selected.rootId, expectedRevision: selected.expectedRevision!, dataDir: selected.dataDir, path: resolve(path) });
}

/** Rebind only an authenticated empty membership at its exact logical provider/path. */
export async function runDirectoryRebind(options: DirectoryRebindArguments, signal?: AbortSignal): Promise<DirectoryRebindResult> {
  const selected = validateDirectoryRebindArguments(options);
  if (signal !== undefined && (types.isProxy(signal) || !(signal instanceof AbortSignal))) return invalid();
  const controller = new AbortController(), interrupt = () => controller.abort();
  process.on("SIGINT", interrupt);
  signal?.addEventListener("abort", interrupt, { once: true });
  if (signal?.aborted) interrupt();
  const finish = (status: DirectoryRebindResult["status"], reason: DirectoryRebindResult["reason"],
    prior: DirectoryMembership | null = null, revision = prior?.revision ?? null): DirectoryRebindResult => Object.freeze({
    schema: "agentprof.directory-rebind/v1", action: "rebind", rootId: selected.rootId, status, reason,
    expectedRevision: selected.expectedRevision, previousRevision: prior?.revision ?? null, revision,
    memberCount: prior?.members.length ?? null, bindingChanged: status === "committed",
    sourcesChanged: false, rootAnchorRetained: true, inputScanned: false,
  });
  let lease: Awaited<ReturnType<typeof import("../scanner/directory-census.js").openDirectoryLease>> | undefined;
  try {
    if (controller.signal.aborted) return finish("aborted", "aborted");
    const { withAuthenticatedStore, StoreOperationAborted } = await import("../db/read-only.js");
    const { createDirectoryMembershipStore } = await import("../db/directory-membership.js");
    const { CensusFailure, openDirectoryLease } = await import("../scanner/directory-census.js");
    const gate = (prior: DirectoryMembership | null): DirectoryRebindResult | null => {
      if (!prior) return finish("not_found", null);
      if (prior.revision !== selected.expectedRevision) return finish("stale", "membership_changed", prior);
      if (prior.members.length !== 0) return finish("ineligible", "membership_not_empty", prior);
      return null;
    };
    try {
      // Read eligibility first: no filesystem scan, creation or mutation on an invalid selection.
      const early = await withAuthenticatedStore(selected.dataDir, false, (database, context) => {
        const prior = createDirectoryMembershipStore(database, context).readInTransaction(selected.rootId);
        const blocked = gate(prior);
        if (blocked) return blocked;
        return context.fingerprint("source", ["directory_root_v1", prior!.provider, selected.path]) === selected.rootId
          ? null : finish("ineligible", "path_mismatch", prior);
      }, controller.signal);
      if (early) return early;
      if (controller.signal.aborted) return finish("aborted", "aborted");
      lease = await openDirectoryLease(selected.path);
      const owned = lease;
      return await withAuthenticatedStore(selected.dataDir, true, (database, context) => {
        const memberships = createDirectoryMembershipStore(database, context), prior = memberships.readInTransaction(selected.rootId);
        const blocked = gate(prior);
        if (blocked) return blocked;
        if (context.fingerprint("source", ["directory_root_v1", prior!.provider, selected.path]) !== selected.rootId)
          return finish("ineligible", "path_mismatch", prior);
        const p = owned.identity;
        const fingerprint = context.fingerprint("content", ["directory_physical_root_v1", p.dev, p.ino, p.mode, p.uid]);
        const next = memberships.rebindEmptyRootInTransaction(selected.rootId, selected.expectedRevision, fingerprint);
        return finish(next.revision === prior!.revision ? "unchanged" : "committed", null, prior, next.revision);
      }, controller.signal, async () => {
        // Verify and close before COMMIT, so a changed target or close failure rolls back.
        try { await owned.verify(); await owned.close(); lease = undefined; }
        catch { throw new SafeError("INPUT_ACCESS_FAILED"); }
      });
    } catch (error) {
      if (error instanceof StoreOperationAborted) return finish("aborted", "aborted");
      if (error instanceof CensusFailure) return finish("ineligible", error.reason === "unsafe_entry" ? "unsafe_entry" : error.reason === "changed" ? "changed" : "access_failed");
      throw error;
    }
  } finally {
    process.removeListener("SIGINT", interrupt);
    signal?.removeEventListener("abort", interrupt);
    if (lease) try { await lease.close(); } catch { throw new SafeError("INPUT_ACCESS_FAILED"); }
  }
}

export function directoryRebindExitCode(value: DirectoryRebindResult): number {
  return value.status === "committed" || value.status === "unchanged" ? 0 : value.status === "aborted" ? 130 : 1;
}
export function formatDirectoryRebind(value: DirectoryRebindResult, json: boolean): string {
  if (json) return JSON.stringify({ schema: "agentprof.cli/v1", ok: directoryRebindExitCode(value) === 0, command: "directory", result: value }) + "\n";
  return [`Directory rebind: ${value.status}; reason=${value.reason ?? "none"}`, `Root: ${value.rootId}`,
    `Revision: expected=${value.expectedRevision}; before=${value.previousRevision ?? "unavailable"}; after=${value.revision ?? "unavailable"}`,
    `Members=${value.memberCount ?? "unavailable"}; binding changed=${value.bindingChanged}.`,
    "Limits: only an empty root's physical binding can change. Source history, availability, cache/checkpoints, other roots and key files are preserved. No input scan, automatic reset or inferred move; explicitly enroll again to collect the replacement directory.",
  ].join("\n") + "\n";
}
