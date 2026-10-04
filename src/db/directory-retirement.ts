import type { DatabaseSync } from "node:sqlite";
import { types } from "node:util";
import type { IdentityContext } from "../normalize/identity.js";
import { SafeError } from "../privacy/diagnostics.js";
import { array, choice, fields, identity, integer } from "./source-validation.js";
import { createDirectoryMembershipStore, DirectoryCatalogueLimit } from "./directory-membership.js";
import { createSourceStore } from "./source-store.js";

export type DirectoryAbsenceProof = Readonly<{
  rootId: string; provider: "codex" | "claude"; rootFingerprint: string;
  membershipRevision: number; observedSourceIds: readonly string[];
}>;
export type DirectoryRetirementEntry = Readonly<{
  sourceId: string; lastObservedRevision: number; revisionAfter: number | null;
  status: "marked_unavailable" | "already_unavailable" | "retained";
  reason: "other_root_observed" | "source_changed" | "not_stored" | null;
  blockingRoots: number;
}>;
export type DirectoryRetirementResult = Readonly<{
  schema: "agentprof.directory-retirement/v1";
  status: "completed" | "partial" | "stale" | "ineligible" | "aborted";
  reason: string | null;
  membershipRevision: number | null;
  checkedRoots: number | null;
  entries: readonly DirectoryRetirementEntry[];
  counts: Readonly<{ missing: number; markedUnavailable: number; alreadyUnavailable: number; retained: number }> | null;
  retainedPayloads: true; inferredMoves: false;
}>;
export function unavailableDirectoryRetirement(status: DirectoryRetirementResult["status"], reason: string): DirectoryRetirementResult {
  return Object.freeze({ schema: "agentprof.directory-retirement/v1", status, reason,
    membershipRevision: null, checkedRoots: null, entries: Object.freeze([]), counts: null,
    retainedPayloads: true, inferredMoves: false });
}
function proof(value: DirectoryAbsenceProof, key: string): DirectoryAbsenceProof {
  if (types.isProxy(value)) throw new SafeError("INVALID_ARGUMENT");
  const v = fields(value, ["rootId", "provider", "rootFingerprint", "membershipRevision", "observedSourceIds"]);
  if (types.isProxy(v["observedSourceIds"])) throw new SafeError("INVALID_ARGUMENT");
  const ids = array(v["observedSourceIds"], 64).map(id => identity(id, "source", key));
  if (new Set(ids).size !== ids.length) throw new SafeError("INVALID_ARGUMENT");
  return Object.freeze({ rootId: identity(v["rootId"], "source", key), provider: choice(v["provider"], ["codex", "claude"] as const),
    rootFingerprint: identity(v["rootFingerprint"], "content", key), membershipRevision: integer(v["membershipRevision"], 1),
    observedSourceIds: Object.freeze(ids.sort()) });
}
/** Internal coordinator input: a completed filesystem census, never a CLI-supplied proof. */
export function retireDirectoryAbsences(database: DatabaseSync, context: IdentityContext,
  input: DirectoryAbsenceProof, signal?: AbortSignal): DirectoryRetirementResult {
  const expected = proof(input, context.keyId);
  if (signal !== undefined && (types.isProxy(signal) || !(signal instanceof AbortSignal))) throw new SafeError("INVALID_ARGUMENT");
  if (database.isTransaction) throw new SafeError("DATABASE_TRANSACTION_FAILED");
  if (signal?.aborted) return unavailableDirectoryRetirement("aborted", "aborted");
  let began = false, cancelled = false;
  const check = () => { if (signal?.aborted) { cancelled = true; throw new Error(); } };
  try {
    database.exec("BEGIN IMMEDIATE"); began = true;
    const finish = (value: DirectoryRetirementResult) => { check(); database.exec("COMMIT"); began = false; return value; };
    const roots = createDirectoryMembershipStore(database, context).readAllForMutation();
    const root = roots.find(r => r.rootId === expected.rootId);
    if (!root || root.revision !== expected.membershipRevision) return finish(unavailableDirectoryRetirement("stale", "membership_changed"));
    if (root.provider !== expected.provider || root.rootFingerprint !== expected.rootFingerprint) return finish(unavailableDirectoryRetirement("ineligible", "root_changed"));
    const observed = root.members.filter(m => m.observation === "observed");
    if (observed.length !== expected.observedSourceIds.length || observed.some((m, i) => m.sourceId !== expected.observedSourceIds[i])) {
      return finish(unavailableDirectoryRetirement("stale", "census_changed"));
    }
    const sources = createSourceStore(database, context.keyId);
    // Check the successful live collection receipts before touching any missing generation.
    for (const member of observed) {
      check();
      const current = sources.readSourceForMutation(member.sourceId, context).source;
      if (!current || current.provider !== root.provider || current.revision !== member.sourceRevision || current.availability !== "available") {
        return finish(unavailableDirectoryRetirement("stale", "source_changed"));
      }
    }
    const vetoes = new Map<string, number>();
    for (const other of roots) if (other.rootId !== root.rootId) {
      for (const member of other.members) if (member.observation === "observed") vetoes.set(member.sourceId, (vetoes.get(member.sourceId) ?? 0) + 1);
    }
    const entries: DirectoryRetirementEntry[] = [];
    for (const member of root.members) {
      check();
      if (member.observation === "observed") continue;
      const blockingRoots = vetoes.get(member.sourceId) ?? 0;
      const current = sources.readSourceForMutation(member.sourceId, context).source;
      if (current && current.provider !== root.provider) throw new SafeError("DATABASE_ACCESS_FAILED");
      const common = { sourceId: member.sourceId, lastObservedRevision: member.sourceRevision, revisionAfter: current?.revision ?? null, blockingRoots };
      if (blockingRoots) entries.push(Object.freeze({ ...common, status: "retained", reason: "other_root_observed" }));
      else if (!current) entries.push(Object.freeze({ ...common, status: "retained", reason: "not_stored" }));
      else if (current.availability === "unavailable") entries.push(Object.freeze({ ...common, status: "already_unavailable", reason: null }));
      else if (current.revision !== member.sourceRevision) entries.push(Object.freeze({ ...common, status: "retained", reason: "source_changed" }));
      else {
        const written = sources.markUnavailableInTransaction(member.sourceId, member.sourceRevision, context);
        if (written.status !== "committed") throw new SafeError("DATABASE_TRANSACTION_FAILED");
        entries.push(Object.freeze({ ...common, revisionAfter: written.revision, status: "marked_unavailable", reason: null }));
      }
    }
    const counts = Object.freeze({ missing: entries.length,
      markedUnavailable: entries.filter(e => e.status === "marked_unavailable").length,
      alreadyUnavailable: entries.filter(e => e.status === "already_unavailable").length,
      retained: entries.filter(e => e.status === "retained").length });
    return finish(Object.freeze({ schema: "agentprof.directory-retirement/v1", status: counts.retained ? "partial" : "completed",
      reason: counts.retained ? "members_retained" : null, membershipRevision: root.revision, checkedRoots: roots.length,
      entries: Object.freeze(entries), counts, retainedPayloads: true, inferredMoves: false }));
  } catch (error) {
    if (began) try { database.exec("ROLLBACK"); } catch { /* Only this owned batch. */ }
    if (cancelled) return unavailableDirectoryRetirement("aborted", "aborted");
    if (error instanceof DirectoryCatalogueLimit) return unavailableDirectoryRetirement("ineligible", "catalogue_limit");
    if (error instanceof SafeError) throw error;
    throw new SafeError("DATABASE_ACCESS_FAILED");
  }
}
