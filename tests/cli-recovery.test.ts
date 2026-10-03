import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { temporaryDirectory } from "./helpers.js";
import { bytes, stored, positive } from "./recovery-fixture.js";

const binary = fileURLToPath(new URL("../dist/agentprof.cjs", import.meta.url));
const full = `h1:${"a".repeat(32)}:source:${"b".repeat(64)}`;
function invoke(file: string, data: string, args: readonly string[]) {
  const r = spawnSync(process.execPath, [file, "--data-dir", data, ...args], { encoding: "utf8", env: { ...process.env, NODE_NO_WARNINGS: "1" } });
  expect(r.error).toBeUndefined(); expect(r.signal).toBeNull(); return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
const invalid = [[], ["--source", "bad"], ["--source", full, "--source", full], ["--list-sources"], ["--source", full, "--list-sources"], ["--source", full, "--failures"], ["--source", full, "--read-revisits"], ["--source", full, "--invocation-overlap"], ["--source", full, "--search-recurrence"], ["--source", full, "--recovery"], ["--source", full, "--codex-root", "FICTITIOUS_PRIVATE"], ["--source", full, "--claude-root", "FICTITIOUS_PRIVATE"], ["--source", full, "extra"], ["--source", full, "--last", "7d"]];
it.each(invalid.map(args => [args]))("rejects invalid built Recovery command before I/O: %j", args => {
  const data = join(temporaryDirectory(), "absent"), r = invoke(binary, data, ["--json", "stats", "--recovery", ...args]);
  expect(r.status).toBe(2); expect(r.stdout).toBe(""); expect(JSON.parse(r.stderr).error.code).toBe("INVALID_ARGUMENT"); expect(existsSync(data)).toBe(false); expect(r.stderr).not.toMatch(/FICTITIOUS_|SQLite/);
});
it("Recovery help/version and valid missing-store selection do not bootstrap storage", () => {
  const data = join(temporaryDirectory(), "absent");
  for (const args of [["--help"], ["--version"], ["stats", "--help"]]) { const r = invoke(binary, data, args); expect(r.status).toBe(0); expect(r.stderr).toBe(""); }
  expect(invoke(binary, data, ["stats", "--help"]).stdout).toContain("--recovery");
  const r = invoke(binary, data, ["--json", "stats", "--source", full, "--recovery"]); expect(r.status).toBe(2); expect(JSON.parse(r.stderr).error.code).toBe("STORE_NOT_FOUND"); expect(existsSync(data)).toBe(false);
});
it("actual built scan then raw-deleted Recovery emits 5000 ms and immutable human/JSON readback", async () => {
  const root = temporaryDirectory(), input = join(root, "input"), data = join(root, "data"); mkdirSync(input); writeFileSync(join(input, "synthetic.jsonl"), positive.map(r => JSON.stringify(r) + "\n").join(""));
  const scan = invoke(binary, data, ["scan", "--codex-root", input, "--json"]); expect([0, 1]).toContain(scan.status); expect(JSON.parse(scan.stdout).result.counts.committed).toBe(1);
  const source = JSON.parse(invoke(binary, data, ["stats", "--list-sources", "--json"]).stdout).result.catalogue.items[0].sourceId; unlinkSync(join(input, "synthetic.jsonl")); const before = await bytes(data);
  let json: string | null = null;
  for (const args of [["stats", "--source", source, "--recovery", "--json"], ["--json", "stats", "--recovery", "--source", source]]) {
    const r = invoke(binary, data, args); expect(r.status).toBe(0); expect(r.stderr).toBe(""); expect(JSON.parse(r.stdout).result).toMatchObject({ mode: "selected_source_recovery", analysis: { summary: { resolvedChains: 1, unresolvedChains: 0 }, chains: [{ recoveryElapsedMs: 5000 }] } }); if (json === null) json = r.stdout; else expect(r.stdout).toBe(json);
  }
  const human = invoke(binary, data, ["stats", "--source", source, "--recovery"]); expect(human.status).toBe(0); expect(human.stdout).toContain("recovery ms=5000"); expect(json! + human.stdout).not.toMatch(/FICTITIOUS_|operationKey|errorFingerprint|sourceRef/); expect(await bytes(data)).toEqual(before);
});
it.each(["scan", "insights", "report", "open"])("does not add --recovery to %s", command => {
  const data = join(temporaryDirectory(), "absent"), r = invoke(binary, data, ["--json", command, "--recovery"]); expect(r.status).toBe(2); expect(JSON.parse(r.stderr).error.code).toBe("INVALID_ARGUMENT"); expect(existsSync(data)).toBe(false);
});

const baseline = process.env["AGENTPROF_RECOVERY_BASELINE_BINARY"], installed = process.env["AGENTPROF_RECOVERY_INSTALLED_BINARY"];
describe.skipIf(!baseline)("authentic immediate-predecessor CLI compatibility", () => {
  it("preserves old commands/help and adds only the exact stats option/help rows", async () => {
    const x = await stored(), before = await bytes(x.data);
    for (const args of [["--version"], ["--help"], ["scan", "--help"], ["insights", "--help"], ["report", "--help"], ["open", "--help"]]) expect(invoke(binary, x.data, args)).toEqual(invoke(baseline!, x.data, args));
    for (const args of [["stats", "--list-sources"], ["stats", "--source", x.sourceId], ["insights", "--source", x.sourceId], ...["--failures", "--read-revisits", "--invocation-overlap", "--search-recurrence"].map(flag => ["stats", "--source", x.sourceId, flag])]) for (const format of [[], ["--json"]]) expect(invoke(binary, x.data, [...args, ...format])).toEqual(invoke(baseline!, x.data, [...args, ...format]));
    const oldHelp = invoke(baseline!, x.data, ["stats", "--help"]), currentHelp = invoke(binary, x.data, ["stats", "--help"]);
    const option = "  --recovery            show observed same-turn Codex failure-to-success time\n";
    const note = "--recovery requires --source and excludes other stats modes; Codex same-turn operation only; observed recovery, no retry-loop or savings claim.\n";
    expect(currentHelp.status).toBe(0); expect(currentHelp.stderr).toBe(""); expect(currentHelp.stdout.split(option)).toHaveLength(2); expect(currentHelp.stdout.split(note)).toHaveLength(2); expect(oldHelp.stdout).not.toContain("--recovery"); expect(currentHelp.stdout.replace(option, "").replace(note, "")).toBe(oldHelp.stdout);
    expect(await bytes(x.data)).toEqual(before);
  });
  it("preserves actual stored report bytes and opening validation", async () => {
    const x = await stored(), output = join(x.root, "report.html"), before = await bytes(x.data);
    for (const format of [[], ["--json"]]) {
      const args = ["report", "--source", x.sourceId, "--output", output, ...format], old = invoke(baseline!, x.data, args); expect(old.status).toBe(0); const html = readFileSync(output); unlinkSync(output);
      expect(invoke(binary, x.data, args)).toEqual(old); expect(readFileSync(output)).toEqual(html); unlinkSync(output);
    }
    for (const format of [[], ["--json"]]) expect(invoke(binary, x.data, ["open", join(x.root, "absent.html"), ...format])).toEqual(invoke(baseline!, x.data, ["open", join(x.root, "absent.html"), ...format]));
    expect(await bytes(x.data)).toEqual(before);
  });
});
describe.skipIf(!installed)("scripts-disabled installed Recovery artifact", () => {
  it("matches built human/JSON against the same raw-deleted immutable source", async () => {
    const x = await stored(), before = await bytes(x.data); for (const format of [[], ["--json"]]) expect(invoke(installed!, x.data, ["stats", "--source", x.sourceId, "--recovery", ...format])).toEqual(invoke(binary, x.data, ["stats", "--source", x.sourceId, "--recovery", ...format])); expect(await bytes(x.data)).toEqual(before);
  });
});
