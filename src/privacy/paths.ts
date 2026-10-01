import { constants } from "node:fs";
import { chmod, lstat, mkdir, open } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { SafeError } from "./diagnostics.js";

export type Provider = "codex" | "claude";
export type InputRoot = Readonly<{ provider: Provider; path: string }>;
export type PathOptions = Readonly<{
  dataDir?: string;
  codexRoots?: readonly string[];
  claudeRoots?: readonly string[];
  home?: string;
  env?: Readonly<Record<string, string | undefined>>;
}>;

/** Resolve only data storage; never resolve provider log roots. */
export function resolveDataDirectory(options: Pick<PathOptions, "dataDir" | "home" | "env"> = {}): string {
  const home = options.home ?? homedir();
  const xdg = (options.env ?? process.env)["XDG_DATA_HOME"];
  const path = options.dataDir ?? join(xdg && isAbsolute(xdg) ? xdg : join(home, ".local", "share"), "agentprof");
  if (!path.length || /[\0\r\n]/.test(path)) throw new SafeError("INVALID_ARGUMENT");
  return resolve(path);
}

export async function validateExistingPrivateDirectory(path: string): Promise<string> {
  const directory = resolve(path);
  await assertNoSymlink(directory);
  try {
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700
      || (process.getuid && stat.uid !== process.getuid())) throw new SafeError("UNSAFE_PRIVATE_FILE");
    return directory;
  } catch (error) {
    if (fileCode(error) === "ENOENT") throw new SafeError("STORE_NOT_FOUND");
    if (error instanceof SafeError) throw error;
    throw new SafeError("DATA_ACCESS_FAILED");
  }
}

export function resolvePaths(options: PathOptions = {}) {
  const home = options.home ?? homedir();
  const env = options.env ?? process.env;
  const dataDir = resolveDataDirectory(options);
  const codex = options.codexRoots?.length ? options.codexRoots : [join(home, ".codex", "sessions"), join(home, ".codex", "archived_sessions")];
  const claude = options.claudeRoots?.length ? options.claudeRoots : [join(env["CLAUDE_CONFIG_DIR"] || join(home, ".claude"), "projects")];
  for (const path of [dataDir, ...codex, ...claude]) {
    if (path.length === 0 || /[\0\r\n]/.test(path)) throw new SafeError("INVALID_ARGUMENT");
  }
  return {
    dataDir: resolve(dataDir),
    inputRoots: [
      ...codex.map((path) => ({ provider: "codex" as const, path: resolve(path) })),
      ...claude.map((path) => ({ provider: "claude" as const, path: resolve(path) })),
    ] as readonly InputRoot[],
  };
}

function fileCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

// Check every existing component, including the root passed by the caller.
export async function assertNoSymlink(path: string): Promise<void> {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let current = root;
  for (const component of absolute.slice(root.length).split("/").filter(Boolean)) {
    current = join(current, component);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new SafeError("UNSAFE_DATA_PATH");
    } catch (error) {
      if (fileCode(error) === "ENOENT") return;
      if (error instanceof SafeError) throw error;
      throw new SafeError("DATA_ACCESS_FAILED");
    }
  }
}

export async function ensurePrivateDirectory(path: string): Promise<string> {
  const directory = resolve(path);
  await assertNoSymlink(directory);
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await assertNoSymlink(directory);
    const stat = await lstat(directory);
    if (!stat.isDirectory() || (process.getuid && stat.uid !== process.getuid())) throw new SafeError("UNSAFE_DATA_PATH");
    await chmod(directory, 0o700);
    const protectedStat = await lstat(directory);
    if (protectedStat.isSymbolicLink() || (protectedStat.mode & 0o777) !== 0o700) throw new SafeError("DATA_PERMISSION_FAILED");
    return directory;
  } catch (error) {
    if (error instanceof SafeError) throw error;
    throw new SafeError("DATA_PERMISSION_FAILED");
  }
}

export async function openPrivateFile(path: string) {
  await assertNoSymlink(dirname(path));
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || (process.getuid && stat.uid !== process.getuid())) {
      await file.close();
      throw new SafeError("UNSAFE_PRIVATE_FILE");
    }
    return file;
  } catch (error) {
    if (error instanceof SafeError) throw error;
    throw new SafeError("UNSAFE_PRIVATE_FILE");
  }
}

export { fileCode };
