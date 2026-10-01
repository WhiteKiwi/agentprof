import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
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
  // Verify the newly activated command through the installed package, against synthetic data only.
  const insightsData = join(temporary, "private-insights"), insightsRoot = join(temporary, "insights-input");
  mkdirSync(insightsRoot);
  const epoch = Date.UTC(2026, 8, 20), timestamp = new Date(epoch).toISOString();
  const records = [{ timestamp, type: "session_meta", payload: { id: "synthetic-insights" } }];
  for (let i = 0; i < 6; i++) records.push({ timestamp, type: "event_msg", payload: { type: "item_completed", thread_id: "synthetic-insights", started_at_ms: epoch, completed_at_ms: epoch + 1000,
    item: { type: "CommandExecution", id: `call-${i}`, source: "unified_exec_startup", command: i < 5 ? "npm test synthetic" : "cargo build", status: "completed", exit_code: 0, duration: { secs: 0, nanos: (i < 5 ? 4 : 80) * 1e6 } } } });
  writeFileSync(join(insightsRoot, "positive.jsonl"), records.map(r => JSON.stringify(r)).join("\n") + "\n");
  copyFileSync(join(root, "tests/fixtures/providers/codex-fork.jsonl"), join(insightsRoot, "suppressed.jsonl"));
  const insightScan = spawnSync(installed, ["scan", "--codex-root", insightsRoot, "--data-dir", insightsData, "--json"], { cwd: execute, env: environment, encoding: "utf8" });
  assert.equal(insightScan.status, 1); assert.equal(JSON.parse(insightScan.stdout).result.counts.committed, 2);
  rmSync(insightsRoot, { recursive: true });
  const insightSnapshot = () => readdirSync(insightsData).sort().map(name => ({ name, bytes: readFileSync(join(insightsData, name)), mode: statSync(join(insightsData, name)).mode }));
  const insightBefore = insightSnapshot();
  const invoke = args => execFileSync(installed, args, { cwd: execute, env: environment, encoding: "utf8" });
  const insightItems = JSON.parse(invoke(["stats", "--list-sources", "--data-dir", insightsData, "--json"])).result.catalogue.items;
  let positive = 0, suppressed = 0;
  for (const item of insightItems) {
    const args = ["insights", "--source", item.sourceId, "--data-dir", insightsData];
    const json = invoke([...args, "--json"]), human = invoke(args), parsed = JSON.parse(json);
    assert.equal(json, execFileSync(process.execPath, [join(root, "dist/agentprof.cjs"), ...args, "--json"], { env: environment, encoding: "utf8" }));
    assert.equal(human, execFileSync(process.execPath, [join(root, "dist/agentprof.cjs"), ...args], { env: environment, encoding: "utf8" }));
    assert.equal(parsed.ok, true); assert.equal(parsed.command, "insights"); assert.equal(parsed.result.mode, "selected_source");
    const a = parsed.result.analysis; assert.equal(a.sourceId, item.sourceId); assert.equal(a.revision, item.revision); assert.equal(a.sourceFreshnessChecked, false);
    if (a.candidates === null) { suppressed++; assert.equal(a.suppressionReason, "ambiguous_origin"); assert(human.includes("ambiguous_origin")); }
    else {
      positive++; assert.equal(a.candidates.length, 1); assert.equal(a.candidates[0].observedEligibleNativeToolDurationShare, 0.2);
      assert.equal(a.candidates[0].denominatorN, 6); assert.equal(a.candidates[0].denominatorSumMs, 100);
      assert(human.includes("Quality guardrail:")); assert(human.includes("Necessary-work counterexample:")); assert.equal(a.candidates[0].evidenceEventIds.length, 5);
    }
    assert(!/FICTITIOUS_|positive\.jsonl|suppressed\.jsonl|boundaryFingerprint|sourceRef|secret/.test(json + human));
  }
  assert.equal(positive, 1); assert.equal(suppressed, 1); assert.deepEqual(insightSnapshot(), insightBefore);
  const absent = join(temporary, "absent-insights");
  const selection = spawnSync(installed, ["insights", "--json", "--data-dir", absent], { env: environment, encoding: "utf8" });
  assert.equal(selection.status, 2); assert.equal(selection.stdout, ""); assert.equal(JSON.parse(selection.stderr).error.code, "INSIGHTS_SELECTION_REQUIRED");
  assert(invoke(["insights", "--help", "--data-dir", absent]).includes("--source")); assert(!existsSync(absent));
  console.log(JSON.stringify({ status: "PASS", node: process.versions.node, platform: process.platform, arch: process.arch, artifactFiles: packed.files.length, tarballNpmExec: "help/version passed", isolatedGlobalInstall: "help/version passed", installScripts: "disabled", packedReadOnlyStats: "synthetic scan/list/select and unchanged store passed", packedReadOnlyInsights: "positive/suppressed exact JSON/human parity, selection/help and unchanged store passed", published: false }));
} finally { rmSync(temporary, { recursive: true, force: true }); }
