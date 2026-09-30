import { chmod, lstat, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadOrCreateIdentityContext } from "../src/normalize/identity.js";
import { ensurePrivateDirectory, resolvePaths } from "../src/privacy/paths.js";
import { temporaryDirectory } from "./helpers.js";

describe("private local paths and identity keys", () => {
  it("resolves provider defaults and explicit overrides without reading sources", () => {
    const paths = resolvePaths({ home: "/synthetic-home", env: { XDG_DATA_HOME: "/synthetic-data", CLAUDE_CONFIG_DIR: "/synthetic-claude" } });
    expect(paths.dataDir).toBe("/synthetic-data/agentprof");
    expect(paths.inputRoots.map((r) => r.path)).toEqual(["/synthetic-home/.codex/sessions", "/synthetic-home/.codex/archived_sessions", "/synthetic-claude/projects"]);
    expect(resolvePaths({ home: "/synthetic-home", env: { XDG_DATA_HOME: "relative" } }).dataDir).toBe("/synthetic-home/.local/share/agentprof");
    expect(resolvePaths({ dataDir: "/override", codexRoots: ["/one", "/two"], claudeRoots: ["/three"], env: {} }).inputRoots.map((r) => r.path)).toEqual(["/one", "/two", "/three"]);
  });
  it("creates one stable key during competing initializations and private permissions", async () => {
    const directory = join(temporaryDirectory(), "data");
    const contexts = await Promise.all(Array.from({ length: 8 }, () => loadOrCreateIdentityContext(directory)));
    expect(new Set(contexts.map((c) => c.fingerprint("operation", ["synthetic"]))).size).toBe(1);
    expect((await lstat(directory)).mode & 0o777).toBe(0o700);
    expect((await lstat(join(directory, "identity-key.json"))).mode & 0o777).toBe(0o600);
    expect(await readdir(directory)).toEqual(["identity-key.json"]);
    const saved = await readFile(join(directory, "identity-key.json"), "utf8");
    const again = await loadOrCreateIdentityContext(directory);
    expect(again.keyId).toBe(contexts[0]?.keyId);
    expect(await readFile(join(directory, "identity-key.json"), "utf8")).toBe(saved);
  });
  it("rejects private-file symlinks and invalid keys without replacing them", async () => {
    const root = temporaryDirectory();
    const directory = join(root, "data");
    await ensurePrivateDirectory(directory);
    const target = join(root, "outside");
    await writeFile(target, "FICTITIOUS_KEY_SENTINEL", { mode: 0o600 });
    await symlink(target, join(directory, "identity-key.json"));
    await expect(loadOrCreateIdentityContext(directory)).rejects.toMatchObject({ code: "UNSAFE_PRIVATE_FILE" });
    expect(await readFile(target, "utf8")).toBe("FICTITIOUS_KEY_SENTINEL");
    const bad = join(root, "bad");
    await ensurePrivateDirectory(bad);
    await writeFile(join(bad, "identity-key.json"), "invalid synthetic key", { mode: 0o600 });
    await expect(loadOrCreateIdentityContext(bad)).rejects.toMatchObject({ code: "INVALID_IDENTITY_KEY" });
    expect(await readFile(join(bad, "identity-key.json"), "utf8")).toBe("invalid synthetic key");
  });
  it("rejects broad key permissions and symlink data directories", async () => {
    const root = temporaryDirectory();
    const data = join(root, "data");
    await loadOrCreateIdentityContext(data);
    await chmod(join(data, "identity-key.json"), 0o644);
    await expect(loadOrCreateIdentityContext(data)).rejects.toMatchObject({ code: "UNSAFE_PRIVATE_FILE" });
    const link = join(root, "link");
    await symlink(data, link);
    await expect(ensurePrivateDirectory(link)).rejects.toMatchObject({ code: "UNSAFE_DATA_PATH" });
  });
});
