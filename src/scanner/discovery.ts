import { lstat, opendir } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { diagnostic, SafeError } from "../privacy/diagnostics.js";
import type { SafeDiagnostic } from "../privacy/diagnostics.js";
import { assertNoSymlink, fileCode } from "../privacy/paths.js";
import type { InputRoot, Provider } from "../privacy/paths.js";

export type DiscoveredSource = Readonly<{ provider: Provider; path: string; sourceAlias: string }>;
export type DiscoveryEntry = Readonly<{ kind: "source"; source: DiscoveredSource }> | Readonly<{ kind: "diagnostic"; diagnostic: SafeDiagnostic }>;
export type DiscoveryLimits = Readonly<{ maxFiles?: number; maxDirectories?: number; maxEntries?: number }>;

// Actual paths in these local manifest entries must not enter shared envelopes.
export async function* discoverSources(roots: readonly InputRoot[], limits: DiscoveryLimits = {}): AsyncGenerator<DiscoveryEntry> {
  const maxFiles = limits.maxFiles ?? 100_000;
  const maxDirectories = limits.maxDirectories ?? 10_000;
  const maxEntries = limits.maxEntries ?? 1_000_000;
  if (![maxFiles, maxDirectories, maxEntries].every((value) => Number.isSafeInteger(value) && value > 0)) throw new SafeError("INVALID_ARGUMENT");
  let files = 0;
  let directories = 0;
  let entries = 0;
  const seen = new Set<string>();
  for (const root of roots) {
    const stack = [root.path];
    while (stack.length > 0) {
      const path = stack.pop()!;
      if (seen.has(path)) continue;
      seen.add(path);
      if (++entries > maxEntries) { yield { kind: "diagnostic", diagnostic: diagnostic("DISCOVERY_LIMIT") }; return; }
      try {
        await assertNoSymlink(path);
        const stat = await lstat(path);
        if (stat.isSymbolicLink()) { yield { kind: "diagnostic", diagnostic: diagnostic("SYMLINK_SKIPPED") }; continue; }
        if (stat.isDirectory()) {
          if (++directories > maxDirectories) { yield { kind: "diagnostic", diagnostic: diagnostic("DISCOVERY_LIMIT") }; return; }
          const directory = await opendir(path);
          for await (const entry of directory) {
            if (entry.isSymbolicLink()) { yield { kind: "diagnostic", diagnostic: diagnostic("SYMLINK_SKIPPED") }; continue; }
            if (stack.length + entries >= maxEntries) { yield { kind: "diagnostic", diagnostic: diagnostic("DISCOVERY_LIMIT") }; return; }
            stack.push(join(path, entry.name));
          }
        } else if (stat.isFile()) {
          if (/\.jsonl\.(gz|zst|zip|bz2|xz)$/i.test(path)) {
            yield { kind: "diagnostic", diagnostic: diagnostic("UNSUPPORTED_COMPRESSION") };
          } else if (path.endsWith(".jsonl")) {
            const matchingProviders = new Set(roots.filter((candidate) => {
              const relation = relative(candidate.path, path);
              return relation === "" || (!relation.startsWith("../") && relation !== ".." && !isAbsolute(relation));
            }).map((candidate) => candidate.provider));
            if (matchingProviders.size > 1) { yield { kind: "diagnostic", diagnostic: diagnostic("AMBIGUOUS_INPUT_PROVIDER") }; continue; }
            if (++files > maxFiles) { yield { kind: "diagnostic", diagnostic: diagnostic("DISCOVERY_LIMIT") }; return; }
            yield { kind: "source", source: { provider: root.provider, path, sourceAlias: `source-${files}` } };
          }
        }
      } catch (error) {
        const code = error instanceof SafeError && error.code === "UNSAFE_DATA_PATH" ? "SYMLINK_SKIPPED"
          : fileCode(error) === "ENOENT" ? "INPUT_ROOT_MISSING" : "INPUT_ACCESS_FAILED";
        yield { kind: "diagnostic", diagnostic: diagnostic(code) };
      }
    }
  }
}
