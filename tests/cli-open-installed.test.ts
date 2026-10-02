import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
const current = fileURLToPath(new URL("../dist/agentprof.cjs", import.meta.url));
const installed = process.env.AGENTPROF_OPEN_INSTALLED_BINARY;
const actualLinux = process.platform === "linux";
function fixture(mode: "zero" | "nonzero" | "timeout" | "missing") {
 const root = mkdtempSync(join(realpathSync(tmpdir()), "agentprof-open-cli-")), bin = join(root, "bin"), file = join(root, "private $()';` 한글#?%.html"), receipt = join(root, "receipt.json"), data = join(root, "private-data");
 mkdirSync(bin); mkdirSync(data); writeFileSync(join(data, "identity-key.json"), "FICTITIOUS_KEY"); writeFileSync(join(data, "store.sqlite"), "FICTITIOUS_STORE"); writeFileSync(file, "<!doctype html><title>Synthetic</title>");
 if (mode !== "missing") writeFileSync(join(bin, "xdg-open"), `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.OPEN_RECEIPT,JSON.stringify(process.argv.slice(2)));\nprocess.stdout.write('FICTITIOUS_CHILD_SECRET'); process.stderr.write('FICTITIOUS_CHILD_SECRET');\n${mode === "timeout" ? "setTimeout(()=>process.exit(0),12000).unref();setTimeout(()=>{},11900);" : `process.exit(${mode === "zero" ? 0 : 4});`}\n`, { mode: 0o755 });
 const invoke = (binary: string, args: string[]) => spawnSync(process.execPath, [binary, ...args], { encoding: "utf8", timeout: 9000, killSignal: "SIGKILL", env: { ...process.env, PATH: bin, DISPLAY: ":99", WAYLAND_DISPLAY: "", OPEN_RECEIPT: receipt } });
 return { root, bin, file, receipt, data, invoke };
}
it.skipIf(!actualLinux)("built CLI accepts literal argv and harmless globals before/after without private reads or writes", () => {
 const f = fixture("zero"); try {
  const before = { html: readFileSync(f.file), mode: statSync(f.file).mode, key: readFileSync(join(f.data, "identity-key.json")), entries: readdirSync(f.data) };
  for (const args of [["--data-dir", f.data, "--codex-root", "/FICTITIOUS_RAW", "--json", "open", f.file], ["open", f.file, "--data-dir", f.data, "--claude-root", "/FICTITIOUS_RAW", "--json"]]) {
   const result = f.invoke(current, args); expect(result.error).toBeUndefined(); expect(result.status).toBe(0); expect(result.stderr).toBe(""); expect(JSON.parse(result.stdout)).toEqual({ schema: "agentprof.cli/v1", ok: true, command: "open", result: { status: "accepted", opener: "xdg-open", browserVerified: false } }); expect(JSON.parse(readFileSync(f.receipt, "utf8"))).toEqual([f.file]); expect(result.stdout).not.toContain("FICTITIOUS"); expect(result.stdout).not.toContain(f.file);
  }
  expect(readFileSync(f.file)).toEqual(before.html); expect(statSync(f.file).mode).toBe(before.mode); expect(readdirSync(f.data)).toEqual(before.entries); expect(readFileSync(join(f.data, "identity-key.json"))).toEqual(before.key);
  const dash = join(f.root, "-dash.html"); writeFileSync(dash, "synthetic"); const result = spawnSync(process.execPath, [current, "--json", "open", "--", "-dash.html"], { cwd: dirname(dash), encoding: "utf8", timeout: 9000, env: { ...process.env, PATH: f.bin, DISPLAY: ":99", OPEN_RECEIPT: f.receipt } }); expect(result.status).toBe(0); expect(JSON.parse(readFileSync(f.receipt, "utf8"))).toEqual([dash]);
 } finally { rmSync(f.root, { recursive: true, force: true }); }
});
it.skipIf(!actualLinux).each([["nonzero", "OPEN_FAILED"], ["missing", "OPEN_OPENER_UNAVAILABLE"], ["timeout", "OPEN_TIMEOUT"]] as const)("built CLI %s helper exits finitely with safe %s", (mode, code) => {
 const f = fixture(mode); try { const start = performance.now(), result = f.invoke(current, ["--json", "open", f.file]); const elapsed = performance.now() - start;
  expect(result.error).toBeUndefined(); expect(result.status).toBe(2); expect(result.stdout).toBe(""); expect(JSON.parse(result.stderr)).toMatchObject({ schema: "agentprof.cli/v1", ok: false, error: { code } }); expect(result.stderr).not.toMatch(/FICTITIOUS|private|xdg-open/); expect(elapsed).toBeLessThan(8500); if (mode === "timeout") { expect(elapsed).toBeGreaterThanOrEqual(4900); expect(result.stderr).toContain("may already be open"); }
 } finally { rmSync(f.root, { recursive: true, force: true }); }
}, 12000);
it("invalid open arguments and help never invoke a real native helper on any OS", () => {
 const f = fixture("zero"); try {
  const nonexistent = join(f.root, "must-not-exist.html");
  for (const args of [["open"], ["open", nonexistent, "extra"], ["open", nonexistent, "--unknown"], ["open", "https://example.invalid/report.html"], ["open", nonexistent, "--data-dir", "\n"], ["open", nonexistent, "--codex-root", "\n"]]) {
   const result = f.invoke(current, ["--json", ...args]); expect(result.status).toBe(2); expect(result.stdout).toBe(""); expect(JSON.parse(result.stderr).error.code).toBe("INVALID_ARGUMENT"); expect(existsSync(f.receipt)).toBe(false);
  }
  const help = f.invoke(current, ["open", "--help"]); expect(help.status).toBe(0); expect(help.stderr).toBe(""); expect(help.stdout).not.toContain("not implemented"); expect(help.stdout).toMatch(/trusted/i); expect(existsSync(f.receipt)).toBe(false);
 } finally { rmSync(f.root, { recursive: true, force: true }); }
});
it.skipIf(!actualLinux || !installed)("installed script-disabled artifact matches built opener receipt without GUI launch", () => {
 const f = fixture("zero"); try { const args = ["--json", "open", f.file], local = f.invoke(current, args), packed = f.invoke(installed!, args); expect(local.status).toBe(0); expect(packed).toMatchObject({ status: local.status, stdout: local.stdout, stderr: local.stderr }); expect(JSON.parse(readFileSync(f.receipt, "utf8"))).toEqual([f.file]); } finally { rmSync(f.root, { recursive: true, force: true }); }
});

it.skipIf(!actualLinux)("rejects a real FIFO without invoking helper or blocking", () => {
 const f = fixture("zero"); try { const fifo = join(f.root, "pipe.html"); execFileSync("mkfifo", [fifo]); const result = f.invoke(current, ["--json", "open", fifo]); expect(result.error).toBeUndefined(); expect(result.status).toBe(2); expect(JSON.parse(result.stderr).error.code).toBe("OPEN_FILE_UNSAFE"); expect(existsSync(f.receipt)).toBe(false); } finally { rmSync(f.root, { recursive: true, force: true }); }
});
