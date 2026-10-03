import { constants } from "node:fs";
import type { Stats } from "node:fs";
import { access, lstat, open, realpath } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { SafeError } from "../privacy/diagnostics.js";
import { assertNoSymlink, fileCode } from "../privacy/paths.js";
import { validSourcePath } from "./source-prefix.js";

export type LifecycleParent = Readonly<{ dev: number; ino: number; mode: number; uid: number }>;
export type LifecyclePathState = Readonly<{ presence: "present" | "missing"; parent: LifecycleParent }>;
const parentIdentity = (s: Stats): LifecycleParent => Object.freeze({ dev: s.dev, ino: s.ino, mode: s.mode, uid: s.uid });
export function sameLifecycleParent(a: LifecycleParent, b: LifecycleParent): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.uid === b.uid;
}

/** Only a missing leaf under a readable, stable directory is absence evidence.
 * Stable trusted ancestors are required: filesystem and SQLite are not one transaction.
 */
export async function inspectLifecyclePath(input: string): Promise<LifecyclePathState> {
  validSourcePath(input);
  const path = resolve(input), parent = dirname(path);
  let directory: FileHandle | undefined;
  try {
    await assertNoSymlink(parent);
    const named = await lstat(parent);
    if (!named.isDirectory() || named.isSymbolicLink() || await realpath(parent) !== parent) throw new SafeError("INPUT_ACCESS_FAILED");
    directory = await open(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const owned = await directory.stat();
    if (!owned.isDirectory() || !sameLifecycleParent(named, owned)) throw new SafeError("INPUT_ACCESS_FAILED");
    await access(parent, constants.R_OK | constants.X_OK);
    let presence: LifecyclePathState["presence"];
    try {
      const leaf = await lstat(path);
      if (!leaf.isFile() || leaf.isSymbolicLink()) throw new SafeError("INPUT_ACCESS_FAILED");
      presence = "present";
    } catch (error) {
      if (fileCode(error) !== "ENOENT") throw error;
      presence = "missing";
    }
    await assertNoSymlink(parent);
    const after = await lstat(parent);
    if (!after.isDirectory() || after.isSymbolicLink() || !sameLifecycleParent(owned, after)
      || !sameLifecycleParent(owned, await directory.stat()) || await realpath(parent) !== parent) throw new SafeError("INPUT_ACCESS_FAILED");
    return Object.freeze({ presence, parent: parentIdentity(owned) });
  } catch (error) {
    if (error instanceof SafeError) throw error;
    throw new SafeError("INPUT_ACCESS_FAILED");
  } finally {
    if (directory !== undefined) {
      try { await directory.close(); } catch { throw new SafeError("INPUT_ACCESS_FAILED"); }
    }
  }
}
