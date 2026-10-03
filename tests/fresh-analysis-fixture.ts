import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { temporaryDirectory } from "./helpers.js";
import { meta, turn, call, result, at } from "./recovery-fixture.js";
import type { FreshAnalysisArguments, FreshAnalysisCommand } from "../src/cli/fresh-analysis.js";

export const window = { from: "2026-10-03T00:00:00Z", to: "2026-10-04T00:00:00Z" };
export function claudePair(id: string, start: number, failed = false) {
  return [
    { type: "assistant", uuid: `assistant-${id}`, sessionId: "FICTITIOUS_FRESH_SESSION", cwd: "/FICTITIOUS_FRESH_ROOT", timestamp: at(start),
      message: { role: "assistant", content: [{ type: "tool_use", id, name: "Bash", input: { command: "npm test FICTITIOUS_FRESH_SECRET" } }] } },
    { type: "user", uuid: `user-${id}`, sessionId: "FICTITIOUS_FRESH_SESSION", cwd: "/FICTITIOUS_FRESH_ROOT", timestamp: at(start + 1000),
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: failed, content: "FICTITIOUS_FRESH_SECRET" }] } },
  ];
}
export function records(provider: "codex" | "claude", failed = false): readonly unknown[] {
  return provider === "codex" ? [meta(), turn(), call("one", 0), result("one", 1000, failed ? 2 : 0)] : claudePair("one", 0, failed);
}
export async function freshFixture(command: FreshAnalysisCommand = "patterns", provider: "codex" | "claude" = "codex", failed = false) {
  const root = temporaryDirectory(), directory = join(root, "inputs");
  await mkdir(directory);
  const input = join(directory, "session.jsonl"), data = join(root, "data"), output = join(root, "fresh.html");
  await writeFile(input, records(provider, failed).map(r => JSON.stringify(r)).join("\n") + "\n");
  const options: FreshAnalysisArguments = { provider, input, output, dataDir: data, ...(command === "history" ? window : {}) };
  return { root, input, data, output, options, provider, command };
}
export async function appendExecution(input: string, provider: "codex" | "claude") {
  const rows = provider === "codex" ? [call("two", 2000), result("two", 3000)] : claudePair("two", 2000);
  await appendFile(input, rows.map(r => JSON.stringify(r)).join("\n") + "\n");
}
