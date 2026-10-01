import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
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
  // Exercise the installed tarball against synthetic fixtures only; raw logs remain excluded from the package.
  const data = join(temporary, "private-stats"), codex = join(temporary, "codex"), claude = join(temporary, "claude");
  mkdirSync(codex); mkdirSync(claude);
  for (const provider of ["codex", "claude"]) copyFileSync(join(root, "tests/fixtures/providers", `${provider}-real-shapes.jsonl`), join(temporary, provider, "synthetic.jsonl"));
  const installed = join(prefix, "bin", "agentprof");
  const scan = spawnSync(installed, ["scan", "--codex-root", codex, "--claude-root", claude, "--data-dir", data, "--json"], { cwd: execute, env: environment, encoding: "utf8" });
  assert.equal(scan.status, 1); assert.equal(JSON.parse(scan.stdout).result.counts.committed, 2);
  rmSync(codex, { recursive: true }); rmSync(claude, { recursive: true });
  const snapshot = () => readdirSync(data).sort().map(name => ({ name, bytes: readFileSync(join(data, name)), mode: statSync(join(data, name)).mode }));
  const before = snapshot();
  const stats = args => JSON.parse(execFileSync(installed, ["--data-dir", data, "stats", ...args, "--json"], { cwd: execute, env: environment, encoding: "utf8" }));
  const catalogue = stats(["--list-sources"]).result.catalogue;
  assert.equal(catalogue.returnedCount, 2); assert.equal(catalogue.truncated, false);
  for (const item of catalogue.items) {
    const selected = stats(["--source", item.sourceId]).result.summary;
    assert.equal(selected.sourceId, item.sourceId); assert.equal(selected.revision, item.revision); assert.equal(selected.scope, "source_prefix");
    assert.equal(selected.crossSourceReconciled, false);
    if (item.provider === "codex") assert.equal(selected.usage[0].counts.total, 92);
    else assert.equal(selected.usage, null);
  }
  assert.deepEqual(snapshot(), before);
  console.log(JSON.stringify({ status: "PASS", node: process.versions.node, platform: process.platform, arch: process.arch, artifactFiles: packed.files.length, tarballNpmExec: "help/version passed", isolatedGlobalInstall: "help/version passed", installScripts: "disabled", packedReadOnlyStats: "synthetic scan/list/select and unchanged store passed", published: false }));
} finally { rmSync(temporary, { recursive: true, force: true }); }
