import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
const current = fileURLToPath(new URL("../dist/agentprof.cjs", import.meta.url));
const oracle = fileURLToPath(new URL("./report-open-cli-oracle.mjs", import.meta.url));
const baseline = process.env.AGENTPROF_REPORT_OPEN_BASELINE_BINARY;
const installed = process.env.AGENTPROF_REPORT_OPEN_INSTALLED_BINARY;
// Root qualification MUST enable both variables; ordinary aggregate accurately reports skips.
it.skipIf(process.platform !== "linux" || !baseline)("controlled-shim built and installed report-open oracle preserves dependency baseline", () => {
  const args = [oracle, current, baseline!, ...(installed ? [installed] : [])];
  const result = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 75000,
    env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=512 --disable-warning=ExperimentalWarning" } });
  expect(result.error).toBeUndefined(); expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toMatchObject({ status: "PASS", installed: !!installed,
    realGUI: "NOT RUN", storeUnchanged: true });
}, 80000);
