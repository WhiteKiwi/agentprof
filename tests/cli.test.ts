import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { temporaryDirectory } from "./helpers.js";

const binary = fileURLToPath(new URL("../dist/agentprof.cjs", import.meta.url));
function run(args: string[], extraEnv: Record<string, string> = {}) {
  return spawnSync(process.execPath, [binary, ...args], { env: { ...process.env, ...extraEnv }, encoding: "utf8" });
}

it("runs built help/version without creating private data or importing SQLite", () => {
  const data = join(temporaryDirectory(), "must-not-create");
  const version = run(["--version"], { XDG_DATA_HOME: data });
  expect(version.status).toBe(0);
  expect(version.stdout.trim()).toBe("0.1.0-dev.0");
  expect(version.stderr).toBe("");
  const help = run(["--data-dir", data, "--help"]);
  expect(help.status).toBe(0); expect(help.stdout).toContain("Usage: agentprof");
  expect(help.stderr).toBe(""); expect(existsSync(data)).toBe(false);
});
it.each(["stats", "insights", "report", "open"])("returns honest pending command errors: %s", (command) => {
  const args = command === "open" ? [command, "FICTITIOUS_AGENTPROF_ARG_SENTINEL.html"] : [command];
  const data = join(temporaryDirectory(), "must-not-create");
  const result = run([...args, "--json", "--data-dir", data]);
  expect(existsSync(data)).toBe(false);
  expect(result.stderr).not.toContain("SQLite");
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  expect(JSON.parse(result.stderr).error.code).toBe("NOT_IMPLEMENTED");
  expect(result.stderr).not.toContain("FICTITIOUS_AGENTPROF_ARG_SENTINEL");
});
it("redacts raw unknown options/arguments and retains one structured error envelope", () => {
  const result = run(["--json", "--FICTITIOUS_AGENTPROF_ARG_SENTINEL"]);
  expect(result.status).toBe(2);
  const envelope = JSON.parse(result.stderr);
  expect(envelope).toMatchObject({ schema: "agentprof.cli/v1", ok: false, error: { code: "INVALID_ARGUMENT" } });
  expect(result.stderr).not.toContain("FICTITIOUS_AGENTPROF_ARG_SENTINEL");
});
it("parses source overrides/report flags while preserving the unimplemented boundary", () => {
  const result = run(["--codex-root", "/FICTITIOUS_AGENTPROF_PROJECT", "--codex-root", "/other", "--claude-root", "/third", "report", "--last", "7d", "--output", "FICTITIOUS_AGENTPROF_ARG_SENTINEL.html", "--open", "--json"]);
  expect(result.status).toBe(2);
  expect(JSON.parse(result.stderr).error.code).toBe("NOT_IMPLEMENTED");
  expect(result.stderr).not.toContain("FICTITIOUS_AGENTPROF_PROJECT");
});
