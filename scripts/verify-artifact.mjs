import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const metadata = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const temporary = realpathSync(mkdtempSync(join(tmpdir(), "agentprof-artifact-")));
const environment = { ...process.env, PATH: dirname(process.execPath) + ":" + process.env.PATH };
const npm = (args, cwd = temporary) => execFileSync("npm", args, { cwd, env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
try {
  const packed = JSON.parse(npm(["pack", "--ignore-scripts", "--json", "--pack-destination", temporary], root))[0];
  assert(packed.files.some((entry) => entry.path === "dist/agentprof.cjs" && entry.mode === 0o755));
  for (const entry of packed.files) {
    assert(/^(dist\/|package\.json$|README\.md$|LICENSE(?:\..*)?$)/.test(entry.path), `Unexpected artifact path: ${entry.path}`);
    assert(!/\.(ts|map|jsonl|png|sqlite)$/.test(entry.path));
  }
  const archive = join(temporary, packed.filename);
  const extracted = join(temporary, "extracted"); mkdirSync(extracted);
  execFileSync("tar", ["-xzf", archive, "-C", extracted]);
  function inspect(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) inspect(path);
      else assert(!readFileSync(path, "utf8").includes("FICTITIOUS_AGENTPROF_"), "Fixture sentinel found in artifact");
    }
  }
  inspect(join(extracted, "package"));
  const cache = join(temporary, "cache");
  const prefix = join(temporary, "prefix");
  const execute = join(temporary, "execute"); mkdirSync(execute);
  const output = npm(["--cache", cache, "--ignore-scripts", "exec", "--yes", "--package", archive, "--", "agentprof", "--version"], execute).trim();
  assert.equal(output, metadata.version);
  const help = npm(["--cache", cache, "--ignore-scripts", "exec", "--yes", "--package", archive, "--", "agentprof", "--help"], execute);
  assert(help.includes("Usage: agentprof"));
  assert(help.includes("not implemented yet"));
  npm(["install", "--global", "--prefix", prefix, "--cache", cache, "--ignore-scripts", "--no-audit", "--no-fund", archive], execute);
  const globalVersion = execFileSync(join(prefix, "bin", "agentprof"), ["--version"], { cwd: execute, env: environment, encoding: "utf8" }).trim();
  assert.equal(globalVersion, metadata.version);
  const globalHelp = execFileSync(join(prefix, "bin", "agentprof"), ["--help"], { cwd: execute, env: environment, encoding: "utf8" });
  assert(globalHelp.includes("Usage: agentprof"));
  console.log(JSON.stringify({ status: "PASS", node: process.versions.node, platform: process.platform, arch: process.arch, artifactFiles: packed.files.length, tarballNpmExec: "help/version passed", isolatedGlobalInstall: "help/version passed", installScripts: "disabled", published: false }));
} finally { rmSync(temporary, { recursive: true, force: true }); }
