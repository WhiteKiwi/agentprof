import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertScanHelpEnrollmentDelta } from "./scan-help-compatibility.js";
import { assertTopHelpDirectoryDelta } from "./top-help-compatibility.js";
import { temporaryDirectory } from "./helpers.js";
import { bytes, maximumSource, meta, pairedPositive, persisted, positive, stored, wall } from "./active-time-fixture.js";

const binary = fileURLToPath(new URL("../dist/agentprof.cjs", import.meta.url));
const full = `h1:${"a".repeat(32)}:source:${"b".repeat(64)}`;
function invoke(file: string, data: string, args: readonly string[]) {
  const r = spawnSync(process.execPath, [file, "--data-dir", data, ...args], { encoding: "utf8", timeout: 20000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, NODE_NO_WARNINGS: "1" } });
  expect(r.error).toBeUndefined(); expect(r.signal).toBeNull(); return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
const invalid = [[], ["--source", "bad"], ["--source", full, "--source", full], ["--list-sources"], ["--source", full, "--list-sources"], ...["--failures", "--read-revisits", "--invocation-overlap", "--search-recurrence", "--recovery", "--retry-overhead", "--active-time"].map(flag => ["--source", full, flag]), ["--source", full, "--codex-root", "FICTITIOUS_PRIVATE"], ["--source", full, "--claude-root", "FICTITIOUS_PRIVATE"], ["--source", full, "extra"], ["--source", full, "--last", "7d"], ["--source", full, "--active-time=true"], ["--source", full, "--active-time=false"]];
it.each(invalid.map(args => [args]))("invalid active command rejects before storage: %j", args => {
  const data = join(temporaryDirectory(), "absent"), r = invoke(binary, data, ["--json", "stats", "--active-time", ...args]); expect(r.status).toBe(2); expect(r.stdout).toBe(""); expect(JSON.parse(r.stderr).error.code).toBe("INVALID_ARGUMENT"); expect(existsSync(data)).toBe(false); expect(r.stderr).not.toMatch(/FICTITIOUS_|SQLite/);
});
it("help/version and valid missing-store active mode never initialize storage", () => {
  const data = join(temporaryDirectory(), "absent"); for (const args of [["--help"], ["--version"], ["stats", "--help"]]) { const r = invoke(binary, data, args); expect(r.status).toBe(0); expect(r.stderr).toBe(""); }
  const r = invoke(binary, data, ["--json", "stats", "--source", full, "--active-time"]); expect(r.status).toBe(2); expect(JSON.parse(r.stderr).error.code).toBe("STORE_NOT_FOUND"); expect(existsSync(data)).toBe(false);
});
it.each(["scan", "insights", "report", "open"])("active option is not added to %s", command => { const data = join(temporaryDirectory(), "absent"), r = invoke(binary, data, ["--json", command, "--active-time"]); expect(r.status).toBe(2); expect(JSON.parse(r.stderr).error.code).toBe("INVALID_ARGUMENT"); expect(existsSync(data)).toBe(false); });
it("built scan uses native wall boundaries instead of independent duration after raw deletion", async () => {
  const root = temporaryDirectory(), input = join(root, "input"), data = join(root, "data"), raw = join(input, "synthetic.jsonl"); mkdirSync(input); writeFileSync(raw, positive.map(r => JSON.stringify(r) + "\n").join(""));
  const scan = invoke(binary, data, ["scan", "--codex-root", input, "--json"]); expect([0, 1]).toContain(scan.status); expect(JSON.parse(scan.stdout).result.counts.committed).toBe(1);
  const source = JSON.parse(invoke(binary, data, ["stats", "--list-sources", "--json"]).stdout).result.catalogue.items[0].sourceId; unlinkSync(raw); const before = await bytes(data); expect(before.map(f => f.name)).toEqual(["agentprof.sqlite", "identity-key.json"]); expect(before.every(f => (f.mode & 0o777) === 0o600)).toBe(true);
  let json = ""; for (const args of [["stats", "--source", source, "--active-time", "--json"], ["--json", "stats", "--active-time", "--source", source]]) {
    const r = invoke(binary, data, args); expect(r.status).toBe(0); expect(r.stderr).toBe(""); const a = JSON.parse(r.stdout).result.analysis; expect(a).toMatchObject({ assessment: "evaluated", summary: { eligibleTurns: 2 }, partitions: [{ activeTimeMs: 15000, observedSpanMs: 15000 }] }); expect(a.partitions[0].turnEvidence).toHaveLength(2); if (json) expect(r.stdout).toBe(json); else json = r.stdout;
  }
  const human = invoke(binary, data, ["stats", "--source", source, "--active-time"]); expect(human.status).toBe(0); expect(human.stdout).toContain("active=15000 ms"); expect(json + human.stdout).not.toMatch(/FICTITIOUS_|sourceRef|commandPattern|secret|synthetic.jsonl/); expect(await bytes(data)).toEqual(before);
});
it("built native paired cancellation distinguishes union from gap-containing span", async () => {
  const x = await stored(pairedPositive), before = await bytes(x.data), r = invoke(binary, x.data, ["--json", "stats", "--source", x.sourceId, "--active-time"]); expect(r.status).toBe(0); expect(JSON.parse(r.stdout).result.analysis.partitions).toMatchObject([{ activeTimeMs: 25000, observedSpanMs: 110000, turnN: 3 }]); expect(await bytes(x.data)).toEqual(before);
});
it("maximum actual persisted 4096 turns/8192 proofs retain complete built CLI output and exact display omissions", async () => {
  const x = await persisted(maximumSource()), before = await bytes(x.data), r = invoke(binary, x.data, ["--json", "stats", "--source", x.sourceId, "--active-time"]), human = invoke(binary, x.data, ["stats", "--source", x.sourceId, "--active-time"]);
  expect(r.status).toBe(0); expect(r.stderr).toBe(""); expect(human.status).toBe(0); expect(human.stderr).toBe(""); const a = JSON.parse(r.stdout).result.analysis;
  expect(a.summary).toEqual({ eligibleTurns: 4096, excludedTurns: 0, partitions: 4096 }); expect(a.partitions.flatMap((p: { turnEvidence: { evidenceObservationIds: string[] }[] }) => p.turnEvidence.flatMap(t => t.evidenceObservationIds))).toHaveLength(8192);
  expect(Buffer.byteLength(r.stdout)).toBeLessThan(8 * 1024 * 1024); expect(Buffer.byteLength(human.stdout)).toBeLessThan(32 * 1024); expect(human.stdout.trimEnd().split("\n").length).toBeLessThan(160); expect(human.stdout).toContain("Partition detail: shown=6; omitted=4090"); expect(await bytes(x.data)).toEqual(before);
}, 30000);
it("one large partition reports exact turn and proof omissions after complete union", async () => {
  const x = await stored([meta(), ...Array.from({ length: 7 }, (_, i) => wall(`wall-${i}`, i * 1000, i * 1000 + 2000))]), r = invoke(binary, x.data, ["stats", "--source", x.sourceId, "--active-time"]); expect(r.status).toBe(0); expect(r.stdout).toContain("active=8000 ms"); expect(r.stdout).toMatch(/Turn IDs:.*omitted=5/); expect(r.stdout).toMatch(/Observation IDs:.*omitted=5/);
});
const baseline = process.env["AGENTPROF_ACTIVE_TIME_BASELINE_BINARY"], installed = process.env["AGENTPROF_ACTIVE_TIME_INSTALLED_BINARY"];
describe.skipIf(!baseline)("authentic immediate PR57 predecessor compatibility", () => {
  it("preserves older commands/modes and removes only two exact active help rows", async () => {
    const x = await stored(), before = await bytes(x.data);
    for (const args of [["--version"], ["--help"], ["scan", "--help"], ["insights", "--help"], ["report", "--help"], ["open", "--help"]]) {
      if (args[0] === "--help") assertTopHelpDirectoryDelta(invoke(binary, x.data, args), invoke(baseline!, x.data, args));
      else if (args[0] === "scan") assertScanHelpEnrollmentDelta(invoke(binary, x.data, args), invoke(baseline!, x.data, args));
      else expect(invoke(binary, x.data, args)).toEqual(invoke(baseline!, x.data, args));
    }
    for (const args of [["stats", "--list-sources"], ["stats", "--source", x.sourceId], ["insights", "--source", x.sourceId], ...["--failures", "--read-revisits", "--invocation-overlap", "--search-recurrence", "--recovery", "--retry-overhead"].map(flag => ["stats", "--source", x.sourceId, flag])]) for (const format of [[], ["--json"]]) expect(invoke(binary, x.data, [...args, ...format])).toEqual(invoke(baseline!, x.data, [...args, ...format]));
    const old = invoke(baseline!, x.data, ["stats", "--help"]), current = invoke(binary, x.data, ["stats", "--help"]);
    const option = "  --active-time         show observed Codex turn interval union and span\n", note = "--active-time requires --source and excludes other stats modes; Codex positioned turns only; union excludes gaps, span includes gaps.\n";
    expect(current.status).toBe(0); expect(current.stderr).toBe(""); expect(current.stdout.split(option)).toHaveLength(2); expect(current.stdout.split(note)).toHaveLength(2); expect(old.stdout).not.toContain("--active-time"); expect(current.stdout.replace(option, "").replace(note, "")).toBe(old.stdout); expect(await bytes(x.data)).toEqual(before);
  });
  it("preserves stored report bytes/modes and open validation", async () => {
    const x = await stored(), output = join(x.root, "report.html"), before = await bytes(x.data);
    for (const format of [[], ["--json"]]) { const args = ["report", "--source", x.sourceId, "--output", output, ...format], old = invoke(baseline!, x.data, args); expect(old.status).toBe(0); const html = readFileSync(output), mode = statSync(output).mode; expect(mode & 0o777).toBe(0o600); unlinkSync(output); expect(invoke(binary, x.data, args)).toEqual(old); expect(readFileSync(output)).toEqual(html); expect(statSync(output).mode).toBe(mode); unlinkSync(output); }
    for (const format of [[], ["--json"]]) expect(invoke(binary, x.data, ["open", join(x.root, "absent.html"), ...format])).toEqual(invoke(baseline!, x.data, ["open", join(x.root, "absent.html"), ...format])); expect(await bytes(x.data)).toEqual(before);
  });
});
describe.skipIf(!installed)("scripts-disabled installed Active Time artifact", () => {
  it("matches built wall/paired human/JSON on raw-deleted immutable sources", async () => {
    for (const records of [positive, pairedPositive]) { const x = await stored(records), before = await bytes(x.data); for (const format of [[], ["--json"]]) expect(invoke(installed!, x.data, ["stats", "--source", x.sourceId, "--active-time", ...format])).toEqual(invoke(binary, x.data, ["stats", "--source", x.sourceId, "--active-time", ...format])); expect(await bytes(x.data)).toEqual(before); }
  });
});
