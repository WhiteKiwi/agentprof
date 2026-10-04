import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertScanHelpEnrollmentDelta } from "./scan-help-compatibility.js";
import { assertTopHelpDirectoryDelta } from "./top-help-compatibility.js";
import { temporaryDirectory } from "./helpers.js";
import { bytes, call, meta, output, positive, result, stored, structured, turn } from "./retry-overhead-fixture.js";

const binary = fileURLToPath(new URL("../dist/agentprof.cjs", import.meta.url));
const full = `h1:${"a".repeat(32)}:source:${"b".repeat(64)}`;
function invoke(file: string, data: string, args: readonly string[]) {
  const r = spawnSync(process.execPath, [file, "--data-dir", data, ...args], { encoding: "utf8", timeout: 10_000, env: { ...process.env, NODE_NO_WARNINGS: "1" } });
  expect(r.error).toBeUndefined(); expect(r.signal).toBeNull(); return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
const invalid = [[], ["--source", "bad"], ["--source", full, "--source", full], ["--list-sources"], ["--source", full, "--list-sources"], ...["--failures", "--read-revisits", "--invocation-overlap", "--search-recurrence", "--recovery", "--retry-overhead"].map(flag => ["--source", full, flag]), ["--source", full, "--codex-root", "FICTITIOUS_PRIVATE"], ["--source", full, "--claude-root", "FICTITIOUS_PRIVATE"], ["--source", full, "extra"], ["--source", full, "--last", "7d"], ["--source", full, "--retry-overhead=true"], ["--source", full, "--retry-overhead=false"]];
it.each(invalid.map(args => [args]))("rejects invalid built retry command before storage: %j", args => {
  const data = join(temporaryDirectory(), "absent"), r = invoke(binary, data, ["--json", "stats", "--retry-overhead", ...args]);
  expect(r.status).toBe(2); expect(r.stdout).toBe(""); expect(JSON.parse(r.stderr).error.code).toBe("INVALID_ARGUMENT"); expect(existsSync(data)).toBe(false); expect(r.stderr).not.toMatch(/FICTITIOUS_|SQLite/);
});
it("help/version and valid missing-store selection do not initialize storage", () => {
  const data = join(temporaryDirectory(), "absent");
  for (const args of [["--help"], ["--version"], ["stats", "--help"]]) { const r = invoke(binary, data, args); expect(r.status).toBe(0); expect(r.stderr).toBe(""); }
  const r = invoke(binary, data, ["--json", "stats", "--source", full, "--retry-overhead"]); expect(r.status).toBe(2); expect(JSON.parse(r.stderr).error.code).toBe("STORE_NOT_FOUND"); expect(existsSync(data)).toBe(false);
});
it.each([20, 1.5, null])("real built scan retains %s ms vs 1000 ms interval after raw deletion", async duration => {
  const root = temporaryDirectory(), input = join(root, "input"), data = join(root, "data"), raw = join(input, "synthetic.jsonl"); mkdirSync(input);
  writeFileSync(raw, [meta(), turn(), structured("failure", 0, 1000, 2, duration), structured("success", 5000, 6000)].map(r => JSON.stringify(r) + "\n").join(""));
  const scan = invoke(binary, data, ["scan", "--codex-root", input, "--json"]); expect([0, 1]).toContain(scan.status); expect(JSON.parse(scan.stdout).result.counts.committed).toBe(1);
  const source = JSON.parse(invoke(binary, data, ["stats", "--list-sources", "--json"]).stdout).result.catalogue.items[0].sourceId; unlinkSync(raw); const before = await bytes(data); expect(before.map(f => f.name)).toEqual(["agentprof.sqlite", "identity-key.json"]); expect(before.every(f => (f.mode & 0o777) === 0o600)).toBe(true);
  let json = "";
  for (const args of [["stats", "--source", source, "--retry-overhead", "--json"], ["--json", "stats", "--retry-overhead", "--source", source]]) {
    const r = invoke(binary, data, args); expect(r.status).toBe(0); expect(r.stderr).toBe(""); const a = JSON.parse(r.stdout).result.analysis;
    expect(a).toMatchObject({ summaryScope: "admitted_recovery_chains", sourceFreshnessChecked: false, summary: { resolvedChainN: 1, failedAttemptN: 1, failedAttemptDurationSumMs: duration, retryOverheadMs: 1000 } }); expect(a.chains[0].failedEventIds).toHaveLength(1); expect(a.chains[0].evidenceObservationIds).toHaveLength(2); if (json) expect(r.stdout).toBe(json); else json = r.stdout;
  }
  const human = invoke(binary, data, ["stats", "--source", source, "--retry-overhead"]); expect(human.status).toBe(0); expect(human.stderr).toBe(""); expect(human.stdout).toContain(`Admitted failed duration sum=${duration === null ? "unavailable" : duration} ms`); expect(human.stdout).toContain("retry overhead union=1000 ms"); expect(json + human.stdout).not.toMatch(/FICTITIOUS_|operationKey|errorFingerprint|sourceRef|synthetic.jsonl/); expect(await bytes(data)).toEqual(before);
});
it("built partial retry output exposes pending reason and blocked failure count", async () => {
  const x = await stored([...positive, call("blocked-f", 7000, "rg FICTITIOUS_BLOCKED src"), result("blocked-f", 8000, 2), call("blocked-p", 9000, "rg FICTITIOUS_BLOCKED src"), output("blocked-p", 9500, { session_id: 1042 })]), before = await bytes(x.data);
  const json = invoke(binary, x.data, ["--json", "stats", "--source", x.sourceId, "--retry-overhead"]), human = invoke(binary, x.data, ["stats", "--source", x.sourceId, "--retry-overhead"]);
  expect(json.status).toBe(0); expect(human.status).toBe(0); expect(JSON.parse(json.stdout).result.analysis.recoveryContext.summary).toMatchObject({ unavailableGroups: 1, unavailableKnownFailedAttempts: 1 }); expect(human.stdout).toContain("blocked known failures=1"); expect(human.stdout).toContain("pending_attempt"); expect(human.stdout).toContain("partial_shape_coverage"); expect(await bytes(x.data)).toEqual(before);
});
it.each(["scan", "insights", "report", "open"])("does not add retry selection to %s", command => {
  const data = join(temporaryDirectory(), "absent"), r = invoke(binary, data, ["--json", command, "--retry-overhead"]); expect(r.status).toBe(2); expect(JSON.parse(r.stderr).error.code).toBe("INVALID_ARGUMENT"); expect(existsSync(data)).toBe(false);
});

const baseline = process.env["AGENTPROF_RETRY_OVERHEAD_BASELINE_BINARY"], installed = process.env["AGENTPROF_RETRY_OVERHEAD_INSTALLED_BINARY"];
describe.skipIf(!baseline)("authentic current immediate-predecessor compatibility", () => {
  it("preserves all existing commands/modes and removes only two exact retry help rows", async () => {
    const x = await stored(), before = await bytes(x.data);
    for (const args of [["--version"], ["--help"], ["scan", "--help"], ["insights", "--help"], ["report", "--help"], ["open", "--help"]]) {
      if (args[0] === "--help") assertTopHelpDirectoryDelta(invoke(binary, x.data, args), invoke(baseline!, x.data, args));
      else if (args[0] === "scan") assertScanHelpEnrollmentDelta(invoke(binary, x.data, args), invoke(baseline!, x.data, args));
      else expect(invoke(binary, x.data, args)).toEqual(invoke(baseline!, x.data, args));
    }
    for (const args of [["stats", "--list-sources"], ["stats", "--source", x.sourceId], ["insights", "--source", x.sourceId], ...["--failures", "--read-revisits", "--invocation-overlap", "--search-recurrence", "--recovery"].map(flag => ["stats", "--source", x.sourceId, flag])]) for (const format of [[], ["--json"]]) expect(invoke(binary, x.data, [...args, ...format])).toEqual(invoke(baseline!, x.data, [...args, ...format]));
    const oldHelp = invoke(baseline!, x.data, ["stats", "--help"]), current = invoke(binary, x.data, ["stats", "--help"]);
    const option = "  --retry-overhead      show observed failed-attempt retry overhead\n", note = "--retry-overhead requires --source and excludes other stats modes; failed-attempt intervals only; no waste or savings claim.\n";
    expect(current.status).toBe(0); expect(current.stderr).toBe(""); expect(current.stdout.split(option)).toHaveLength(2); expect(current.stdout.split(note)).toHaveLength(2); expect(oldHelp.stdout).not.toContain("--retry-overhead"); expect(current.stdout.replace(option, "").replace(note, "")).toBe(oldHelp.stdout); expect(await bytes(x.data)).toEqual(before);
  });
  it("preserves actual stored report bytes/modes and opening validation", async () => {
    const x = await stored(), output = join(x.root, "report.html"), before = await bytes(x.data);
    for (const format of [[], ["--json"]]) {
      const args = ["report", "--source", x.sourceId, "--output", output, ...format], old = invoke(baseline!, x.data, args); expect(old.status).toBe(0); const html = readFileSync(output), mode = statSync(output).mode; expect(mode & 0o777).toBe(0o600); unlinkSync(output); expect(invoke(binary, x.data, args)).toEqual(old); expect(readFileSync(output)).toEqual(html); expect(statSync(output).mode).toBe(mode); unlinkSync(output);
    }
    for (const format of [[], ["--json"]]) expect(invoke(binary, x.data, ["open", join(x.root, "absent.html"), ...format])).toEqual(invoke(baseline!, x.data, ["open", join(x.root, "absent.html"), ...format])); expect(await bytes(x.data)).toEqual(before);
  });
});
describe.skipIf(!installed)("scripts-disabled installed retry artifact", () => {
  it("matches built human/JSON on a raw-deleted immutable source", async () => {
    const x = await stored(), before = await bytes(x.data); for (const format of [[], ["--json"]]) expect(invoke(installed!, x.data, ["stats", "--source", x.sourceId, "--retry-overhead", ...format])).toEqual(invoke(binary, x.data, ["stats", "--source", x.sourceId, "--retry-overhead", ...format])); expect(await bytes(x.data)).toEqual(before);
  });
});
