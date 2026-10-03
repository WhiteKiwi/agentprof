import { resolve } from "node:path";
import { SafeError } from "../privacy/diagnostics.js";
import { validateScanArguments, validateCliPath, formatScanResult } from "./scan.js";
import type { ScanArguments } from "./scan.js";
import { inspectLifecyclePath } from "../scanner/lifecycle-path.js";
import { abortedSourceLifecycle, reconcileSourceFiles } from "../scanner/source-lifecycle.js";
import type { PreparedLifecycleFile, SourceLifecycleResult } from "../scanner/source-lifecycle.js";

export type ReconcileScanArguments = ScanArguments & Readonly<{ reconcile?: boolean; json?: boolean }>;
function paths(value: unknown): asserts value is readonly string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 16) throw new SafeError("INVALID_ARGUMENT");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== value.length + 1) throw new SafeError("INVALID_ARGUMENT");
  for (let i = 0; i < value.length; i++) {
    const descriptor = descriptors[String(i)];
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") throw new SafeError("INVALID_ARGUMENT");
    validateCliPath(descriptor.value);
    if (/\.jsonl\.(?:gz|zst|zip|bz2|xz)$/i.test(descriptor.value)) throw new SafeError("UNSUPPORTED_COMPRESSION");
    if (!descriptor.value.endsWith(".jsonl")) throw new SafeError("INVALID_ARGUMENT");
  }
}
export function validateReconcileScanArguments(options: ReconcileScanArguments) {
  if (options.reconcile !== true || options.json !== undefined && typeof options.json !== "boolean"
    || options.dataDir !== undefined && typeof options.dataDir !== "string") throw new SafeError("INVALID_ARGUMENT");
  paths(options.codexRoot); paths(options.claudeRoot);
  const result = validateScanArguments(options);
  // One exact path can belong to only one provider; aliases and repeated roots are rejected.
  const seen = new Set<string>();
  for (const root of result.roots) {
    const path = resolve(root.path);
    if (seen.has(path)) throw new SafeError("INVALID_ARGUMENT");
    seen.add(path);
  }
  return result;
}

export async function runReconcileScan(options: ReconcileScanArguments, internal: Readonly<{ signal?: AbortSignal }> = {}): Promise<SourceLifecycleResult> {
  const { dataDir, roots } = validateReconcileScanArguments(options);
  if (internal.signal !== undefined && !(internal.signal instanceof AbortSignal)) throw new SafeError("INVALID_ARGUMENT");
  const controller = new AbortController(), interrupt = () => controller.abort();
  if (internal.signal?.aborted) controller.abort();
  internal.signal?.addEventListener("abort", interrupt, { once: true });
  process.on("SIGINT", interrupt);
  try {
    if (controller.signal.aborted) return abortedSourceLifecycle(roots.length);
    const files: PreparedLifecycleFile[] = [];
    // All selections are preflighted before any key/store is created or live source is collected.
    for (const root of roots) {
      files.push({ ...root, observation: await inspectLifecyclePath(root.path) });
      if (controller.signal.aborted) return abortedSourceLifecycle(roots.length);
    }
    const { loadOrCreateIdentityContext } = await import("../normalize/identity.js");
    if (controller.signal.aborted) return abortedSourceLifecycle(roots.length);
    const context = await loadOrCreateIdentityContext(dataDir);
    if (controller.signal.aborted) return abortedSourceLifecycle(roots.length);
    const { openDatabase } = await import("../db/database.js");
    const database = await openDatabase(dataDir);
    try {
      const { createSourceStore } = await import("../db/source-store.js");
      if (controller.signal.aborted) return abortedSourceLifecycle(roots.length);
      return await reconcileSourceFiles(createSourceStore(database, context.keyId), context, files, controller.signal, options.usageTiming === true, options.patternEvidence === true);
    } finally { database.close(); }
  } finally {
    process.removeListener("SIGINT", interrupt);
    internal.signal?.removeEventListener("abort", interrupt);
  }
}
export function reconcileScanExitCode(result: SourceLifecycleResult): 0 | 1 | 130 {
  return result.status === "aborted" ? 130 : result.status === "completed" ? 0 : 1;
}
export function formatReconcileScan(result: SourceLifecycleResult, json: boolean): string {
  if (json) return JSON.stringify({ schema: "agentprof.cli/v1", ok: result.status === "completed", command: "scan", result }) + "\n";
  const c = result.counts;
  const lines = ["AgentProf explicit source lifecycle scan", `Status=${result.status}; selected=${result.selectedInputs}; unprocessed=${result.unprocessedInputs}`,
    `Collected=${c.collected}; marked unavailable=${c.markedUnavailable}; already unavailable=${c.alreadyUnavailable}; not previously stored=${c.notStored}; incomplete=${c.incomplete}`];
  for (const f of result.files) lines.push(`${f.sourceAlias} (${f.provider}): ${f.status}; revision=${f.revisionBefore ?? "none"}->${f.revisionAfter ?? "unchanged/unknown"}; reason=${f.reason ?? "none"}; error=${f.errorCode ?? "none"}`);
  if (result.scan !== null) lines.push(formatScanResult(result.scan, false).trimEnd());
  else lines.push("No live-file collection was performed.");
  lines.push("Stored events and metric evidence are retained. Use JSON liveSources for explicit subsequent queries; directory-wide deletion/move detection is not performed.");
  return lines.join("\n") + "\n";
}
