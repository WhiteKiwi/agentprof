import { types } from "node:util";
import type { DirectoryRetirementResult } from "../db/directory-retirement.js";
import { captureMode } from "../parsers/capture.js";
import type { CaptureMode } from "../parsers/capture.js";
import type { DirectoryMember, DirectoryMembership } from "../db/directory-membership.js";
import type { DirectoryEnrollmentResult } from "../scanner/directory-enrollment.js";
import type { InputRoot } from "../privacy/paths.js";
import { SafeError } from "../privacy/diagnostics.js";
import { validateScanArguments } from "./scan.js";
import type { ScanArguments } from "./scan.js";

export type DirectoryScanArguments = ScanArguments & Readonly<{
  enrollDirectory: boolean;
  retireMissing?: boolean;
  batchDirectory?: boolean;
  reconcile?: boolean;
  json?: boolean;
}>;
export type DirectorySnapshot = Readonly<{
  rootId: string;
  provider: "codex" | "claude";
  revision: number;
  counts: Readonly<{ total: number; observed: number; notObserved: number }>;
  members: readonly DirectoryMember[];
}>;
export type DirectoryScanResult = Readonly<{
  schema: "agentprof.directory-scan/v1";
  status: "completed" | "partial" | "ineligible" | "stale" | "aborted";
  reason: string | null;
  provider: "codex" | "claude";
  enrollment: DirectoryEnrollmentResult | null;
  snapshot: DirectorySnapshot | null;
  retirement?: DirectoryRetirementResult;
}>;
const invalid = (): never => { throw new SafeError("INVALID_ARGUMENT"); };

/** Do not evaluate getters, proxies, sparse arrays or inherited option values. */
function pathArray(value: unknown): string[] {
  if (types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return invalid();
  const fields = Object.getOwnPropertyDescriptors(value as object), length = fields["length"]?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > 1 || Reflect.ownKeys(fields).length !== length + 1) return invalid();
  const result: string[] = [];
  for (let index = 0; index < length; index++) {
    const field = fields[String(index)];
    if (!field || !("value" in field) || !field.enumerable || typeof field.value !== "string") return invalid();
    result.push(field.value);
  }
  return result;
}

export function validateDirectoryScanArguments(value: DirectoryScanArguments): Readonly<{ dataDir: string; root: InputRoot; capture: CaptureMode; retireMissing: boolean; batchDirectory?: true }> {
  if (value === null || typeof value !== "object" || types.isProxy(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
  const fields = Object.getOwnPropertyDescriptors(value);
  const allowed = ["dataDir", "codexRoot", "claudeRoot", "usageTiming", "patternEvidence", "enrollDirectory", "retireMissing", "batchDirectory", "reconcile", "json"];
  for (const name of Reflect.ownKeys(fields)) {
    if (typeof name !== "string" || !allowed.includes(name)) return invalid();
    const field = fields[name]!;
    if (!("value" in field) || !field.enumerable) return invalid();
    if (["usageTiming", "patternEvidence", "enrollDirectory", "retireMissing", "batchDirectory", "reconcile", "json"].includes(name) && typeof field.value !== "boolean") return invalid();
    if (name === "dataDir" && typeof field.value !== "string") return invalid();
  }
  if (fields["enrollDirectory"]?.value !== true || fields["reconcile"]?.value === true) return invalid();
  const codexRoot = pathArray(fields["codexRoot"]?.value), claudeRoot = pathArray(fields["claudeRoot"]?.value);
  if (codexRoot.length + claudeRoot.length !== 1) return invalid();
  const capture = captureMode({
    ...(fields["usageTiming"] === undefined ? {} : { usageTiming: fields["usageTiming"]!.value as boolean }),
    ...(fields["patternEvidence"] === undefined ? {} : { patternEvidence: fields["patternEvidence"]!.value as boolean }),
  });
  const selected = validateScanArguments({ codexRoot, claudeRoot,
    ...(fields["dataDir"] === undefined ? {} : { dataDir: fields["dataDir"]!.value as string }),
    ...capture,
  });
  return Object.freeze({ dataDir: selected.dataDir, root: Object.freeze(selected.roots[0]!), capture, retireMissing: fields["retireMissing"]?.value === true, ...(fields["batchDirectory"]?.value === true ? { batchDirectory: true as const } : {}) });
}

const result = (
  provider: DirectoryScanResult["provider"], status: DirectoryScanResult["status"], reason: string | null,
  enrollment: DirectoryEnrollmentResult | null = null, snapshot: DirectorySnapshot | null = null,
): DirectoryScanResult => Object.freeze({ schema: "agentprof.directory-scan/v1", provider, status, reason, enrollment, snapshot });

/** A different post-capture snapshot must never replace the revision we just observed. */
export function projectDirectoryEnrollment(enrollment: DirectoryEnrollmentResult, membership: DirectoryMembership | null): DirectoryScanResult {
  const native = enrollment.membership;
  if (native.status === "aborted" || enrollment.scan?.status === "aborted") return result(enrollment.provider, "aborted", "aborted", enrollment);
  if (native.status !== "committed" && native.status !== "unchanged") return result(enrollment.provider, native.status, native.reason, enrollment);
  if (membership === null || membership.rootId !== enrollment.rootId || membership.provider !== enrollment.provider
    || membership.revision !== native.revision || membership.members.length !== native.memberCount) {
    return result(enrollment.provider, "stale", "membership_changed", enrollment);
  }
  // Strip the physical root fingerprint and keep only authenticated public fields.
  const members = Object.freeze(membership.members.map(member => Object.freeze({
    sourceId: member.sourceId, sourceRevision: member.sourceRevision, observation: member.observation,
  })));
  const observed = members.filter(member => member.observation === "observed").length;
  const snapshot: DirectorySnapshot = Object.freeze({ rootId: membership.rootId, provider: membership.provider, revision: membership.revision,
    counts: Object.freeze({ total: members.length, observed, notObserved: members.length - observed }), members });
  const completed = enrollment.scan?.status === "completed";
  return result(enrollment.provider, completed ? "completed" : "partial", completed ? null : "scan_warning", enrollment, snapshot);
}

/** Explicit mutation boundary; regular scan and file reconciliation never call this. */
export async function runDirectoryScan(options: DirectoryScanArguments, signal?: AbortSignal): Promise<DirectoryScanResult> {
  const { dataDir, root, capture, retireMissing, batchDirectory = false } = validateDirectoryScanArguments(options);
  if (signal !== undefined && (types.isProxy(signal) || !(signal instanceof AbortSignal))) return invalid();
  const controller = new AbortController(), interrupt = () => controller.abort();
  process.on("SIGINT", interrupt);
  signal?.addEventListener("abort", interrupt, { once: true });
  if (signal?.aborted) interrupt();
  const aborted = () => result(root.provider, "aborted", "aborted");
  try {
    if (controller.signal.aborted) return aborted();
    const { censusDirectory, censusDirectoryBatched, openDirectoryLease, CensusFailure } = await import("../scanner/directory-census.js");
    if (controller.signal.aborted) return aborted();
    // Refuse bad or incomplete roots before creating a private data directory.
    // The native enrollment repeats these checks; preflight is not authority.
    try {
      const lease = await openDirectoryLease(root.path);
      try { await (batchDirectory ? censusDirectoryBatched : censusDirectory)(root.path, controller.signal); await lease.verify(); }
      finally { await lease.close(); }
    } catch (error) {
      if (controller.signal.aborted) return aborted();
      if (error instanceof CensusFailure) return result(root.provider, "ineligible", error.reason);
      throw new SafeError("INPUT_ACCESS_FAILED");
    }
    if (controller.signal.aborted) return aborted();
    const { loadOrCreateIdentityContext } = await import("../normalize/identity.js");
    if (controller.signal.aborted) return aborted();
    const context = await loadOrCreateIdentityContext(dataDir);
    if (controller.signal.aborted) return aborted();
    const { openDatabase } = await import("../db/database.js");
    if (controller.signal.aborted) return aborted();
    const database = await openDatabase(dataDir);
    try {
      if (controller.signal.aborted) return aborted();
      const { enrollDirectory } = await import("../scanner/directory-enrollment.js");
      const { createDirectoryMembershipStore } = await import("../db/directory-membership.js");
      if (controller.signal.aborted) return aborted();
      const enrollment = await enrollDirectory(database, context, root, { signal: controller.signal, ...capture, ...(batchDirectory ? { batchDirectory: true } : {}) });
      const retirement = retireMissing
        ? await (await import("../scanner/directory-reconciliation.js")).reconcileDirectoryAbsence(database, context, root, enrollment, controller.signal, batchDirectory)
        : undefined;
      // No await between reading the current authenticated snapshot and comparison.
      const membership = enrollment.membership.status === "committed" || enrollment.membership.status === "unchanged"
        ? createDirectoryMembershipStore(database, context).read(enrollment.rootId) : null;
      const projected = projectDirectoryEnrollment(enrollment, membership);
      if (retirement === undefined) return projected;
      const usable = projected.status === "completed" || projected.status === "partial";
      return Object.freeze({ ...projected, retirement,
        status: usable && retirement.status !== "completed" ? retirement.status : projected.status,
        reason: usable && retirement.status !== "completed" ? retirement.reason : projected.reason });
    } finally {
      try { database.close(); } catch { throw new SafeError("DATABASE_ACCESS_FAILED"); }
    }
  } catch (error) {
    if (error instanceof SafeError) throw error;
    throw new SafeError("INTERNAL_ERROR");
  } finally {
    process.removeListener("SIGINT", interrupt);
    signal?.removeEventListener("abort", interrupt);
  }
}

export function directoryScanExitCode(value: DirectoryScanResult): number {
  return value.status === "completed" ? 0 : value.status === "aborted" ? 130 : 1;
}

export function formatDirectoryScan(value: DirectoryScanResult, json: boolean): string {
  if (json) {
    const output = JSON.stringify({ schema: "agentprof.cli/v1", ok: value.status === "completed", command: "scan", result: value }) + "\n";
    if (Buffer.byteLength(output) > 8 * 1024 * 1024) throw new SafeError("REPORT_LIMIT");
    return output;
  }
  const receipt = value.enrollment, snapshot = value.snapshot, scan = receipt?.scan;
  const lines = [
    `Directory enrollment: ${value.status}; provider=${value.provider}; reason=${value.reason ?? "none"}`,
    `Root: ${receipt?.rootId ?? "unavailable before enrollment"}`,
    `Membership: ${receipt?.membership.status ?? "not attempted"}; snapshot revision=${snapshot?.revision ?? "unavailable"}`,
  ];
  if (scan) lines.push(`Scan: ${scan.status}; discovered=${scan.counts.discovered}; committed=${scan.counts.committed}; unchanged=${scan.counts.unchanged}; rejected=${scan.counts.rejected}; failed=${scan.counts.failed}; stale=${scan.counts.stale}`,
    `Scan stop=${scan.stopReason ?? "none"}; truncated=${scan.discoveryTruncated}; diagnostics observed=${scan.diagnostics.observedCount}; adapter-dropped=${scan.diagnostics.adapterDroppedCount}; sample-dropped=${scan.diagnostics.sampleDroppedCount}`);
  if (snapshot) {
    const shown = snapshot.members.slice(0, 12), total = snapshot.members.length;
    lines.push(`Members: total=${snapshot.counts.total}; observed=${snapshot.counts.observed}; not_observed=${snapshot.counts.notObserved}`,
      `Member detail: shown=${shown.length}/${total}; omitted=${total - shown.length}`);
    for (const member of shown) lines.push(`${member.sourceId}: ${member.observation}; last observed source revision=${member.sourceRevision}`);
  } else lines.push("Member detail: unavailable; no different revision was substituted.");
  if (value.retirement !== undefined) {
    const r = value.retirement, c = r.counts, shown = r.entries.slice(0, 12);
    lines.push(`Retirement: ${r.status}; reason=${r.reason ?? "none"}; checked roots=${r.checkedRoots ?? "unavailable"}`);
    if (c) lines.push(`Missing=${c.missing}; marked unavailable=${c.markedUnavailable}; already unavailable=${c.alreadyUnavailable}; retained=${c.retained}`,
      `Retirement detail: shown=${shown.length}/${r.entries.length}; omitted=${r.entries.length - shown.length}`);
    else lines.push("Retirement counts: unavailable; no partial batch was reported as successful.");
    for (const entry of shown) lines.push(`${entry.sourceId}: ${entry.status}; last observed=${entry.lastObservedRevision}; current=${entry.revisionAfter ?? "unavailable"}; reason=${entry.reason ?? "none"}; blocking roots=${entry.blockingRoots}`);
    lines.push("Opt-in retirement retains event/metric/relationship history and invalidates obsolete cache/checkpoints. Other-root observations veto retirement until explicitly rescanned. Filesystem and database are not an atomic snapshot.");
  }
  lines.push("Limits: not_observed means absent from the completed census, not proven deletion or relocation. Membership capture does not retire sources; earlier scanner commits may remain on failure. No automatic pruning or move inference.");
  const output = lines.join("\n") + "\n";
  if (Buffer.byteLength(output) > 32 * 1024) throw new SafeError("REPORT_LIMIT");
  return output;
}
