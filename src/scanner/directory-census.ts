import { constants } from "node:fs";
import type { Stats } from "node:fs";
import { access, lstat, open, opendir, realpath } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { SafeError } from "../privacy/diagnostics.js";
import { assertNoSymlink } from "../privacy/paths.js";
import { SCAN_LIMITS } from "./scan-run.js";

export type DirectoryIdentity = Readonly<{ dev: number; ino: number; mode: number; uid: number }>;
export type DirectoryCensus = Readonly<{ paths: readonly string[]; directories: ReadonlyMap<string, DirectoryIdentity> }>;
export type CensusReason = "limit" | "unsafe_entry" | "access_failed" | "changed" | "aborted";
export class CensusFailure extends Error { constructor(readonly reason: CensusReason) { super("Directory census was not eligible."); } }
export const sameDirectory = (a: DirectoryIdentity, b: DirectoryIdentity) => a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.uid === b.uid;
function identity(s: Stats): DirectoryIdentity {
  const values = { dev: s.dev, ino: s.ino, mode: s.mode, uid: s.uid };
  if (!s.isDirectory() || !Object.values(values).every(v => Number.isSafeInteger(v) && v >= 0)) throw new CensusFailure("unsafe_entry");
  return Object.freeze(values);
}
const check = (signal?: AbortSignal) => { if (signal?.aborted) throw new CensusFailure("aborted"); };
/** The returned handle is kept alive by the coordinator until its final checks. */
export async function openDirectoryLease(path: string): Promise<Readonly<{ identity: DirectoryIdentity; verify(): Promise<void>; close(): Promise<void> }>> {
  let file: FileHandle | undefined;
  try {
    await assertNoSymlink(path);
    const named = identity(await lstat(path));
    if (await realpath(path) !== path) throw new CensusFailure("unsafe_entry");
    file = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const owned = identity(await file.stat());
    if (!sameDirectory(named, owned)) throw new CensusFailure("changed");
    await access(path, constants.R_OK | constants.X_OK);
    const handle = file;
    return Object.freeze({ identity: owned,
      async verify() { try { await assertNoSymlink(path); if (await realpath(path) !== path || !sameDirectory(owned, identity(await lstat(path))) || !sameDirectory(owned, identity(await handle.stat()))) throw new CensusFailure("changed"); } catch (error) { if (error instanceof CensusFailure) throw error; throw new CensusFailure("changed"); } },
      async close() { try { await handle.close(); } catch { throw new CensusFailure("access_failed"); } },
    });
  } catch (error) { await file?.close().catch(() => undefined); if (error instanceof CensusFailure) throw error; if (error instanceof SafeError && error.code === "UNSAFE_DATA_PATH") throw new CensusFailure("unsafe_entry"); throw new CensusFailure("access_failed"); }
}

/** Paths/physical identities are transient local data, never a user-facing receipt. */
export async function censusDirectory(path: string, signal?: AbortSignal): Promise<DirectoryCensus> {
  const paths: string[] = [], directories = new Map<string, DirectoryIdentity>(), stack = [path];
  let entries = 1;
  try {
    while (stack.length) {
      check(signal);
      const current = stack.pop()!;
      if (directories.size >= SCAN_LIMITS.directories) throw new CensusFailure("limit");
      const lease = await openDirectoryLease(current);
      try {
        check(signal);
        directories.set(current, lease.identity);
        const directory = await opendir(current);
        for await (const entry of directory) {
          check(signal);
          if (++entries > SCAN_LIMITS.entries) throw new CensusFailure("limit");
          const child = join(current, entry.name), stat = await lstat(child);
          if (stat.isSymbolicLink()) throw new CensusFailure("unsafe_entry");
          if (stat.isDirectory()) stack.push(child);
          else if (!stat.isFile()) throw new CensusFailure("unsafe_entry");
          else if (/\.jsonl\.(gz|zst|zip|bz2|xz)$/i.test(child)) throw new CensusFailure("unsafe_entry");
          else if (child.endsWith(".jsonl")) { if (paths.length >= SCAN_LIMITS.sources) throw new CensusFailure("limit"); paths.push(child); }
        }
        await lease.verify(); check(signal);
      } finally { await lease.close(); }
    }
    paths.sort();
    return Object.freeze({ paths: Object.freeze(paths), directories });
  } catch (error) { if (error instanceof CensusFailure) throw error; throw new CensusFailure("access_failed"); }
}

export function sameCensus(a: DirectoryCensus, b: DirectoryCensus): boolean {
  return a.paths.length === b.paths.length && a.paths.every((path, i) => path === b.paths[i])
    && a.directories.size === b.directories.size && [...a.directories].every(([path, value]) => { const other = b.directories.get(path); return other !== undefined && sameDirectory(value, other); });
}
