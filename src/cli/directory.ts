import type { Command } from "commander";
import { types } from "node:util";
import { SafeError } from "../privacy/diagnostics.js";
import { resolveDataDirectory } from "../privacy/paths.js";
import { validateCliPath } from "./scan.js";
import type { DirectoryMaintenanceAction, DirectoryMaintenanceResult } from "../db/directory-maintenance.js";

export type DirectoryArguments = Readonly<{
  root?: string; prune?: boolean; reset?: boolean; expectedRevision?: string;
  dataDir?: string; json?: boolean; codexRoot?: readonly string[]; claudeRoot?: readonly string[];
}>;
const invalid = (): never => { throw new SafeError("INVALID_ARGUMENT"); };
export function validateDirectoryArguments(options: DirectoryArguments): Readonly<{
  rootId: string; action: DirectoryMaintenanceAction; expectedRevision: number | null; dataDir: string;
}> {
  if (!options || typeof options !== "object" || types.isProxy(options)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(options))) return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(options), values: Record<string, unknown> = Object.create(null);
  for (const name of Reflect.ownKeys(descriptors)) {
    if (typeof name !== "string" || !["root", "prune", "reset", "expectedRevision", "dataDir", "json", "codexRoot", "claudeRoot"].includes(name)) return invalid();
    const field = descriptors[name as keyof DirectoryArguments]!;
    if (!("value" in field) || !field.enumerable) return invalid();
    values[name] = field.value;
    if (["prune", "reset", "json"].includes(name) && typeof field.value !== "boolean") return invalid();
    if (["root", "expectedRevision", "dataDir"].includes(name) && typeof field.value !== "string") return invalid();
    if (["codexRoot", "claudeRoot"].includes(name)) {
      const array = field.value;
      if (types.isProxy(array) || !Array.isArray(array) || Object.getPrototypeOf(array) !== Array.prototype
        || array.length !== 0 || Reflect.ownKeys(array).length !== 1) return invalid();
    }
  }
  const rootId = values["root"];
  if (typeof rootId !== "string" || rootId.length !== 107 || !/^h1:[a-f0-9]{32}:source:[a-f0-9]{64}$/.test(rootId)) return invalid();
  if (values["prune"] === true && values["reset"] === true) return invalid();
  const action = values["reset"] === true ? "reset" : values["prune"] === true ? "prune" : "inspect";
  const expected = values["expectedRevision"];
  let expectedRevision: number | null = null;
  if (action === "inspect") { if (expected !== undefined) return invalid(); }
  else {
    if (typeof expected !== "string" || !/^[1-9][0-9]{0,15}$/.test(expected)) return invalid();
    expectedRevision = Number(expected);
    if (!Number.isSafeInteger(expectedRevision) || String(expectedRevision) !== expected) return invalid();
  }
  const dataDir = values["dataDir"];
  if (dataDir !== undefined) validateCliPath(dataDir as string);
  return Object.freeze({ rootId, action, expectedRevision,
    dataDir: resolveDataDirectory(dataDir === undefined ? {} : { dataDir: dataDir as string }) });
}

export async function runDirectoryMaintenance(options: DirectoryArguments, signal?: AbortSignal): Promise<DirectoryMaintenanceResult> {
  const selected = validateDirectoryArguments(options);
  if (signal !== undefined && (types.isProxy(signal) || !(signal instanceof AbortSignal))) return invalid();
  const controller = new AbortController(), interrupt = () => controller.abort();
  process.on("SIGINT", interrupt);
  signal?.addEventListener("abort", interrupt, { once: true });
  if (signal?.aborted) interrupt();
  try {
    const { withAuthenticatedStore, StoreOperationAborted } = await import("../db/read-only.js");
    const { maintainDirectoryInTransaction, abortedDirectoryMaintenance } = await import("../db/directory-maintenance.js");
    try {
      return await withAuthenticatedStore(selected.dataDir, selected.action !== "inspect", (database, context) =>
        maintainDirectoryInTransaction(database, context, selected.rootId, selected.action, selected.expectedRevision, controller.signal), controller.signal);
    } catch (error) {
      if (error instanceof StoreOperationAborted) return abortedDirectoryMaintenance(selected.rootId, selected.action, selected.expectedRevision);
      throw error;
    }
  } finally {
    process.removeListener("SIGINT", interrupt);
    signal?.removeEventListener("abort", interrupt);
  }
}

export function directoryMaintenanceExitCode(value: DirectoryMaintenanceResult): number {
  return ["inspected", "committed", "unchanged"].includes(value.status) ? 0 : value.status === "aborted" ? 130 : 1;
}
export function formatDirectoryMaintenance(value: DirectoryMaintenanceResult, json: boolean): string {
  if (json) {
    const output = JSON.stringify({ schema: "agentprof.cli/v1", ok: directoryMaintenanceExitCode(value) === 0, command: "directory", result: value }) + "\n";
    if (Buffer.byteLength(output) > 8 * 1024 * 1024) throw new SafeError("REPORT_LIMIT");
    return output;
  }
  const s = value.snapshot, removed = value.removedSourceIds;
  const lines = [`Directory ${value.action}: ${value.status}`, `Root: ${value.rootId}`,
    `Revision: expected=${value.expectedRevision ?? "not required"}; before=${value.previousRevision ?? "unavailable"}; after=${s?.revision ?? "unavailable"}`];
  if (s) {
    lines.push(`Members: total=${s.counts.total}; observed=${s.counts.observed}; not_observed=${s.counts.notObserved}`,
      `Member detail: shown=${Math.min(12, s.members.length)}/${s.members.length}; omitted=${Math.max(0, s.members.length - 12)}`);
    for (const m of s.members.slice(0, 12)) lines.push(`${m.sourceId}: ${m.observation}; last observed source revision=${m.sourceRevision}`);
  } else lines.push("Membership: unavailable.");
  lines.push(`Removed membership entries: total=${removed.length}; shown=${Math.min(12, removed.length)}; omitted=${Math.max(0, removed.length - 12)}`);
  for (const id of removed.slice(0, 12)) lines.push(`Removed: ${id}`);
  lines.push(`This root's observed vetoes released=${value.observationVetoesReleased}.`,
    "Limits: only membership changes; source evidence, cache/checkpoints and key files remain unchanged. Root binding/revision anchor remains. Reset releases this root's observation vetoes for future explicit retirement; it does not prove deletion or a move.");
  const output = lines.join("\n") + "\n";
  if (Buffer.byteLength(output) > 32 * 1024) throw new SafeError("REPORT_LIMIT");
  return output;
}

export function registerDirectoryCommand(program: Command): void {
  let dataFlags = 0, jsonFlags = 0;
  program.on("option:data-dir", () => { dataFlags++; });
  program.on("option:json", () => { jsonFlags++; });
  const command = program.command("directory").description("Inspect or explicitly maintain one stored directory membership")
    .option("--root <full-root-id>", "exact root ID returned by scan --enroll-directory")
    .option("--prune", "remove only not-observed members whose current source is unavailable")
    .option("--reset", "clear this root's members and release its future retirement vetoes; preserve all sources")
    .option("--rebind", "accept a replacement physical directory at the same path; requires empty membership")
    .option("--path <directory>", "same logical directory path; only for --rebind")
    .option("--expected-revision <revision>", "exact inspected membership revision; required for prune/reset/rebind")
    .allowExcessArguments(false)
    .addHelpText("after", "\nNo input scanning, store creation/migration or source deletion. Default is read-only inspection.\nPrune/reset are mutually exclusive and require the exact inspected revision.\nReset retains the root binding and revision anchor; later explicit scans can re-enroll files.\nReset releases this root's observed vetoes on later --retire-missing operations.\nRebind requires empty membership and --path at the same logical location; it does not scan or reset.\nRoot-slot reclamation and whole-history pruning are not supported.");
  for (const name of ["root", "prune", "reset", "expected-revision", "rebind", "path"]) {
    let count = 0;
    command.on(`option:${name}`, () => { if (++count > 1) invalid(); });
  }
  command.action(async () => {
    if (dataFlags > 1 || jsonFlags > 1 || command.args.length !== 0) return invalid();
    const options = { ...program.opts(), ...command.opts() } as DirectoryArguments;
    if (command.opts()["rebind"] === true) {
      const { runDirectoryRebind, formatDirectoryRebind, directoryRebindExitCode } = await import("./directory-rebind.js");
      const result = await runDirectoryRebind(options);
      process.stdout.write(formatDirectoryRebind(result, options.json === true));
      process.exitCode = directoryRebindExitCode(result);
      return;
    }
    const result = await runDirectoryMaintenance(options);
    process.stdout.write(formatDirectoryMaintenance(result, options.json === true));
    process.exitCode = directoryMaintenanceExitCode(result);
  });
}
