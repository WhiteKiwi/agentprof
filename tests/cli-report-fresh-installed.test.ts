import { spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
const built = fileURLToPath(new URL("../dist/agentprof.cjs", import.meta.url));
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/providers/${name}`, import.meta.url));
for (const [label, binary] of [["built", built], ["installed", process.env.AGENTPROF_FRESH_INSTALLED_BINARY]] as const) {
  describe.skipIf(process.platform !== "linux" || !binary)(`${label} explicit fresh CLI (controlled opener; no browser)`, () => {
    it("validates all selection modes before bootstrap and emits only safe errors", () => {
      const root = mkdtempSync(join(realpathSync(tmpdir()), "agentprof-fresh-flags-"));
      try {
        const input = join(root, "PRIVATE_INPUT.jsonl"), data = join(root, "absent"), output = join(root, "out.html"); writeFileSync(input, "{}\n");
        const dir = join(root, "dir.jsonl"), link = join(root, "link.jsonl"); mkdirSync(dir); symlinkSync(input, link);
        const source = `h1:${"a".repeat(32)}:source:${"b".repeat(64)}`;
        const base = ["report", "--provider", "claude", "--input", input, "--output", output];
        const cases = [
          [...base, "--data-dir", data], [...base, "--json"], [...base, "--source", source], [...base, "--provider", "codex"], [...base, "--input", input], [...base, "--output", output], [...base, "--open", "--open"], [...base, "--open=false"], [...base, "extra"], [...base, "--unknown"], [...base, "--codex-root", "PRIVATE_ROOT"], [...base, "--claude-root", "PRIVATE_ROOT"],
          ["report", "--provider", "claude", "--output", output], ["report", "--input", input, "--output", output], ["report", "--provider", "claude", "--input", input],
          ...[dir, link, join(root, "missing.jsonl"), "PRIVATE_INPUT.jsonl.gz", "PRIVATE_INPUT.txt", "", "\nPRIVATE_INPUT.jsonl"].map(path => ["report", "--provider", "claude", "--input", path, "--output", output]),
          ["report", "--provider", "unknown", "--input", input, "--output", output], [...base.slice(0, -1), "bad.txt", "--open"],
        ];
        for (const args of cases) {
          const result = spawnSync(process.execPath, [binary!, ...args, "--data-dir", data, "--json"], { encoding: "utf8", timeout: 10000, env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=512 --disable-warning=ExperimentalWarning" } });
          expect(result.error).toBeUndefined(); expect(result.status, JSON.stringify({ args, result })).toBe(2); expect(result.stdout).toBe("");
          expect(JSON.parse(result.stderr)).toMatchObject({ schema: "agentprof.cli/v1", ok: false, error: { code: expect.any(String) } });
          expect(result.stderr).not.toMatch(/PRIVATE_INPUT|PRIVATE_ROOT/); expect(existsSync(data)).toBe(false); expect(existsSync(output)).toBe(false);
        }
      } finally { rmSync(root, { recursive: true, force: true }); }
    }, 60000);
    it("completed Codex explicit input succeeds without a separate scan command", () => {
      const root = mkdtempSync(join(realpathSync(tmpdir()), "agentprof-fresh-codex-"));
      try {
        const input = join(root, "PRIVATE_CODEX_INPUT.jsonl"), output = join(root, "out.html"), data = join(root, "private");
        const rows = [{ timestamp: "2026-09-01T00:00:00.000Z", type: "session_meta", payload: { id: "fresh-codex", cwd: "/PRIVATE_CODEX_INPUT" } },
          { timestamp: "2026-09-01T00:00:01.000Z", type: "event_msg", payload: { type: "item_completed", thread_id: "fresh-codex", item: { type: "CommandExecution", id: "fresh-command", source: "unified_exec_startup", command: "npm test", status: "completed", exit_code: 0, duration: { secs: 1, nanos: 0 }, output: "PRIVATE_CODEX_OUTPUT" } } }];
        writeFileSync(input, rows.map(row => JSON.stringify(row)).join("\n") + "\n");
        const result = spawnSync(process.execPath, [binary!, "--json", "--data-dir", data, "report", "--provider", "codex", "--input", input, "--output", output], { encoding: "utf8", timeout: 10000, env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=512 --disable-warning=ExperimentalWarning" } });
        expect(result.error).toBeUndefined(); expect(result.status, result.stdout + result.stderr).toBe(0); expect(result.stderr).toBe("");
        expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, result: { provider: "codex", scan: { status: "completed", counts: { committed: 1 } }, report: { revision: 1, published: true } } });
        const html = readFileSync(output, "utf8"); expect(html).toContain("process_runtime"); expect(html + result.stdout).not.toMatch(/PRIVATE_CODEX/);
      } finally { rmSync(root, { recursive: true, force: true }); }
    }, 15000);
    it("reports real partial generations, preserves omitted roots, rejects stale fallback, and retains opener failures", () => {
      const root = mkdtempSync(join(realpathSync(tmpdir()), "agentprof-fresh-cli-"));
      try {
        const home = join(root, "HOME_PRIVATE"), omitted = join(home, ".codex", "sessions"), data = join(root, "private"), bin = join(root, "bin"), record = join(root, "open-record"), input = join(root, "PRIVATE_INPUT.jsonl");
        mkdirSync(omitted, { recursive: true }); mkdirSync(bin); writeFileSync(join(omitted, "secret.jsonl"), "OMITTED_PROVIDER_SENTINEL", { mode: 0o600 });
        const omittedBefore = { bytes: readFileSync(join(omitted, "secret.jsonl")), mode: statSync(join(omitted, "secret.jsonl")).mode, names: readdirSync(omitted) };
        copyFileSync(fixture("claude-real-shapes.jsonl"), input);
        const shim = join(bin, "xdg-open");
        function setShim(code: number) { writeFileSync(shim, `#!${process.execPath}\nconst f=require('node:fs');f.appendFileSync(process.env.OPEN_RECORD,JSON.stringify(process.argv.slice(2))+'\\n');process.stdout.write('CHILD_PRIVATE');process.stderr.write('CHILD_PRIVATE');process.exit(${code});\n`); chmodSync(shim, 0o755); }
        setShim(0);
        const env = { ...process.env, HOME: home, DISPLAY: ":99", WAYLAND_DISPLAY: "", PATH: bin, OPEN_RECORD: record, NODE_OPTIONS: "--max-old-space-size=512 --disable-warning=ExperimentalWarning" };
        const invoke = (output: string, extra: string[] = [], json = true) => spawnSync(process.execPath, [binary!, "report", "--provider", "claude", "--input", input, "--output", output, "--data-dir", data, ...(json ? ["--json"] : []), ...extra], { encoding: "utf8", timeout: 10000, env });
        const first = join(root, "first.html"), a = invoke(first, ["--open"]); expect(a.error).toBeUndefined(); expect(a.status).toBe(1); expect(a.stderr).toBe("");
        const one = JSON.parse(a.stdout); expect(one.ok).toBe(false); expect(one.result).toMatchObject({ mode: "fresh_input", scan: { status: "partial", counts: { committed: 1 } }, report: { revision: 1, published: true, open: { status: "accepted", browserVerified: false } } });
        expect(readFileSync(record, "utf8").trim().split("\n")).toEqual([JSON.stringify([first])]);
        const second = join(root, "second.html"), b = invoke(second); expect(b.status).toBe(1); expect(b.stderr).toBe("");
        expect(JSON.parse(b.stdout).result).toMatchObject({ scan: { counts: { unchanged: 1 } }, report: { revision: 1 } }); expect(readFileSync(second)).toEqual(readFileSync(first));
        const human = invoke(join(root, "human.html"), [], false); expect(human.status).toBe(1); expect(human.stdout).toContain("Scan: partial"); expect(human.stdout).toContain("INSUFFICIENT_LOOKUP_EVIDENCE");
        setShim(7); const failed = invoke(join(root, "failed-open.html"), ["--open"]); expect(failed.status).toBe(1); expect(failed.stderr).toBe(""); expect(JSON.parse(failed.stdout).result.report).toMatchObject({ revision: 1, published: true, open: { status: "failed", error: { code: "OPEN_FAILED" } } });
        const count = readFileSync(record, "utf8").trim().split("\n").length;
        appendFileSync(input, "INVALID_RAW_SENTINEL\n"); const rejectedOutput = join(root, "rejected.html"), rejected = invoke(rejectedOutput, ["--open"]);
        expect(rejected.status).toBe(1); expect(rejected.stderr).toBe(""); expect(JSON.parse(rejected.stdout).result).toMatchObject({ scan: { counts: { rejected: 1 } }, report: { status: "skipped", reason: "scan_ineligible" } }); expect(existsSync(rejectedOutput)).toBe(false); expect(readFileSync(record, "utf8").trim().split("\n")).toHaveLength(count);
        const visible = a.stdout + b.stdout + human.stdout + failed.stdout + rejected.stdout + readFileSync(first, "utf8");
        expect(visible).not.toMatch(/FICTITIOUS_|PRIVATE_INPUT|OMITTED_PROVIDER_SENTINEL|INVALID_RAW_SENTINEL|CHILD_PRIVATE|HOME_PRIVATE/);
        expect({ bytes: readFileSync(join(omitted, "secret.jsonl")), mode: statSync(join(omitted, "secret.jsonl")).mode, names: readdirSync(omitted) }).toEqual(omittedBefore);
      } finally { rmSync(root, { recursive: true, force: true }); }
    }, 60000);
  });
}
