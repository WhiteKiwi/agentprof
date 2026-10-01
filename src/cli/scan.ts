import { resolve } from "node:path";
import { SafeError } from "../privacy/diagnostics.js";
import { resolvePaths } from "../privacy/paths.js";
import type { InputRoot } from "../privacy/paths.js";
import { SCAN_LIMITS, scanSources } from "../scanner/scan-run.js";
import type { ScanResult } from "../scanner/scan-run.js";
import { validSourcePath } from "../scanner/source-prefix.js";

export type ScanArguments = Readonly<{ dataDir?: string; codexRoot: readonly string[]; claudeRoot: readonly string[] }>;

export function validateCliPath(path: string): string {
  validSourcePath(path);
  if (!path.trim()) throw new SafeError("INVALID_ARGUMENT");
  return path;
}

export function validateScanArguments(options: ScanArguments): { dataDir: string; roots: InputRoot[] } {
  const roots: InputRoot[] = [
    ...options.codexRoot.map((path) => ({ provider: "codex" as const, path })),
    ...options.claudeRoot.map((path) => ({ provider: "claude" as const, path })),
  ];
  if (roots.length === 0 || roots.length > SCAN_LIMITS.roots) throw new SafeError("INVALID_ARGUMENT");
  for (const path of [...roots.map((root) => root.path), ...(options.dataDir === undefined ? [] : [options.dataDir])]) {
    validateCliPath(path);
  }
  // Only use the existing data-directory convention. Never select default input roots.
  const explicitPath = roots[0]!.path;
  const { dataDir } = resolvePaths({
    ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
    // These nonempty resolver slots suppress unrelated default-provider config.
    // Their inputRoots result is discarded, not used to select either provider.
    codexRoots: [explicitPath], claudeRoots: [explicitPath],
  });
  validSourcePath(dataDir);
  const selected = roots.map((root) => ({ ...root, path: resolve(root.path) }));
  for (const root of selected) validSourcePath(root.path);
  return { dataDir, roots: selected };
}

export function abortedBeforeScan(): ScanResult {
  return {
    status: "aborted", stopReason: "aborted", discoveryTruncated: false, sources: [],
    counts: { discovered: 0, attempted: 0, committed: 0, rejected: 0, stale: 0, failed: 0, aborted: 0, duplicates: 0 },
    diagnostics: { observedCount: 0, adapterDroppedCount: 0, sampleDroppedCount: 0, samples: [] },
    aggregationReady: false, parserResumeReady: false,
  };
}

/** The caller validates before this asynchronous, storage-owning boundary. */
export async function collectScan(dataDir: string, roots: readonly InputRoot[], signal: AbortSignal): Promise<ScanResult> {
  if (signal.aborted) return abortedBeforeScan();
  const { loadOrCreateIdentityContext } = await import("../normalize/identity.js");
  if (signal.aborted) return abortedBeforeScan();
  const context = await loadOrCreateIdentityContext(dataDir);
  if (signal.aborted) return abortedBeforeScan();
  const { openDatabase } = await import("../db/database.js");
  if (signal.aborted) return abortedBeforeScan();
  const database = await openDatabase(dataDir);
  try {
    if (signal.aborted) return abortedBeforeScan();
    const { createSourceStore } = await import("../db/source-store.js");
    if (signal.aborted) return abortedBeforeScan();
    const store = createSourceStore(database, context.keyId);
    if (signal.aborted) return abortedBeforeScan();
    return await scanSources(store, context, roots, { signal });
  } finally {
    database.close();
  }
}

export async function runScan(options: ScanArguments): Promise<ScanResult> {
  const { dataDir, roots } = validateScanArguments(options);
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on("SIGINT", interrupt);
  try {
    return await collectScan(dataDir, roots, controller.signal);
  } finally {
    process.removeListener("SIGINT", interrupt);
  }
}

export function formatScanResult(result: ScanResult, json: boolean): string {
  if (json) return JSON.stringify({ schema: "agentprof.cli/v1", ok: result.status === "completed", command: "scan", result }) + "\n";
  const c = result.counts, d = result.diagnostics;
  const lines = [
    `Scan: ${result.status} (bounded collection)`,
    `Sources: discovered=${c.discovered} attempted=${c.attempted} committed=${c.committed} rejected=${c.rejected} stale=${c.stale} failed=${c.failed} aborted=${c.aborted} duplicates=${c.duplicates}`,
    `Stop reason: ${result.stopReason ?? "none"}; discovery truncated=${result.discoveryTruncated}`,
    `Diagnostics: observed=${d.observedCount} adapter-dropped=${d.adapterDroppedCount} sample-dropped=${d.sampleDroppedCount}`,
    "Aggregation: unsupported; parser resume: unsupported. Earlier source commits are retained.",
  ];
  for (const source of result.sources) {
    lines.push(`${source.sourceAlias}: ${source.status}${source.rejectionReason ? ` (${source.rejectionReason})` : ""}${source.errorCode ? ` (${source.errorCode})` : ""}`);
  }
  for (const sample of d.samples) lines.push(`Diagnostic: ${sample.sourceAlias ?? "scan"} ${sample.code}`);
  return lines.join("\n") + "\n";
}
