import type { DatabaseSync } from "node:sqlite";
import { types } from "node:util";
import type { IdentityContext } from "../normalize/identity.js";
import { SafeError } from "../privacy/diagnostics.js";
import { choice, identity, integer } from "./source-validation.js";
import { createDirectoryMembershipStore } from "./directory-membership.js";
import type { DirectoryMember, DirectoryMembership } from "./directory-membership.js";
import { createSourceStore } from "./source-store.js";
import { StoreOperationAborted } from "./read-only.js";

export type DirectoryMaintenanceAction = "inspect" | "prune" | "reset";
export type DirectoryMaintenanceResult = Readonly<{
  schema: "agentprof.directory-maintenance/v1";
  action: DirectoryMaintenanceAction;
  rootId: string;
  status: "inspected" | "committed" | "unchanged" | "stale" | "not_found" | "aborted";
  expectedRevision: number | null;
  previousRevision: number | null;
  snapshot: Readonly<{
    provider: "codex" | "claude";
    revision: number;
    counts: Readonly<{ total: number; observed: number; notObserved: number }>;
    members: readonly DirectoryMember[];
  }> | null;
  removedSourceIds: readonly string[];
  sourcesChanged: false;
  rootAnchorRetained: true;
  observationVetoesReleased: boolean;
}>;

function snapshot(root: DirectoryMembership | null): DirectoryMaintenanceResult["snapshot"] {
  if (root === null) return null;
  const members = Object.freeze(root.members.map(member => Object.freeze({ ...member })));
  const observed = members.filter(member => member.observation === "observed").length;
  return Object.freeze({ provider: root.provider, revision: root.revision,
    counts: Object.freeze({ total: members.length, observed, notObserved: members.length - observed }), members });
}
export function abortedDirectoryMaintenance(rootId: string, action: DirectoryMaintenanceAction, expectedRevision: number | null): DirectoryMaintenanceResult {
  return Object.freeze({ schema: "agentprof.directory-maintenance/v1", action, rootId, status: "aborted", expectedRevision,
    previousRevision: null, snapshot: null, removedSourceIds: Object.freeze([]), sourcesChanged: false,
    rootAnchorRetained: true, observationVetoesReleased: false });
}

/** Caller owns the transaction; all reads and the removal/reseal share that snapshot. */
export function maintainDirectoryInTransaction(database: DatabaseSync, context: IdentityContext, rootId: string,
  action: DirectoryMaintenanceAction, expectedRevision: number | null, signal?: AbortSignal): DirectoryMaintenanceResult {
  identity(rootId, "source", context.keyId);
  choice(action, ["inspect", "prune", "reset"]);
  if (action === "inspect" ? expectedRevision !== null : expectedRevision === null) throw new SafeError("INVALID_ARGUMENT");
  if (expectedRevision !== null) integer(expectedRevision, 1);
  if (signal !== undefined && (types.isProxy(signal) || !(signal instanceof AbortSignal))) throw new SafeError("INVALID_ARGUMENT");
  const check = () => { if (signal?.aborted) throw new StoreOperationAborted(); };
  check();
  const memberships = createDirectoryMembershipStore(database, context);
  const prior = memberships.readInTransaction(rootId);
  const finish = (status: DirectoryMaintenanceResult["status"], current: DirectoryMembership | null,
    removed: readonly string[] = []): DirectoryMaintenanceResult => {
    check();
    return Object.freeze({ schema: "agentprof.directory-maintenance/v1", action, rootId, status, expectedRevision,
      previousRevision: prior?.revision ?? null, snapshot: snapshot(current), removedSourceIds: Object.freeze([...removed]),
      sourcesChanged: false, rootAnchorRetained: true,
      observationVetoesReleased: action === "reset" && removed.length > 0 && prior!.members.some(member => member.observation === "observed") });
  };
  if (prior === null) return finish("not_found", null);
  if (action === "inspect") return finish("inspected", prior);
  if (prior.revision !== expectedRevision) return finish("stale", prior);
  const removed: string[] = [];
  if (action === "reset") removed.push(...prior.members.map(member => member.sourceId));
  else {
    const sources = createSourceStore(database, context.keyId);
    for (const member of prior.members) {
      check();
      if (member.observation !== "not_observed") continue;
      const source = sources.readSourceForMutation(member.sourceId, context).source;
      if (source && source.provider !== prior.provider) throw new SafeError("DATABASE_ACCESS_FAILED");
      if (source?.availability === "unavailable") removed.push(member.sourceId);
    }
  }
  if (removed.length === 0) return finish("unchanged", prior);
  check();
  const current = memberships.removeMembersInTransaction(rootId, expectedRevision!, removed);
  return finish("committed", current, removed);
}
