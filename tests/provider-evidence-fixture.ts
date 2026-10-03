import { createCodexAdapter } from "../src/parsers/codex/index.js";
import { createClaudeAdapter } from "../src/parsers/claude/index.js";
import { context, feed, encode, disk, bytes, memory, keyId } from "./usage-timing-fixture.js";
export { context, feed, encode, disk, bytes, memory, keyId };
export type Provider = "codex" | "claude";
export const start = Date.parse("2026-10-03T10:00:00Z"), time = (n: number) => new Date(start + n * 1000).toISOString();
export const errorText = "FICTITIOUS_PERMISSION_ERROR: denied target alpha";
export const cwd = "/FICTITIOUS_PROJECT", filePath = "/FICTITIOUS_PROJECT/file.ts";
export function adapter(provider: Provider, mode: "legacy" | "timing" | "patterns" = "patterns") {
  const options = mode === "patterns" ? { patternEvidence: true } : mode === "timing" ? { usageTiming: true } : {};
  return provider === "codex" ? createCodexAdapter(context, {}, options) : createClaudeAdapter(context, {}, options);
}
export function codexRows(session = "FICTITIOUS_SESSION", code = 2, output: unknown = errorText): unknown[] {
  const rows: unknown[] = [
    { type: "session_meta", timestamp: time(0), payload: { id: session, cwd, cli_version: "0.159.0" } },
    { type: "turn_context", timestamp: time(0), payload: { turn_id: "FICTITIOUS_TURN" } },
  ];
  for (let i = 0; i < 3; i++) rows.push(
    { type: "response_item", timestamp: time(i * 3 + 1), payload: { type: "function_call", name: "exec_command", call_id: `e-${i}`, arguments: JSON.stringify({ cmd: "rg FICTITIOUS_QUERY src" }) } },
    { type: "response_item", timestamp: time(i * 3 + 2), payload: { type: "function_call_output", call_id: `e-${i}`, output: { exit_code: code, output } } },
  );
  return rows;
}
export function claudePair(id = "one", name = "Bash", args: Record<string, unknown> = { command: "rg FICTITIOUS_QUERY src" },
  body: unknown = errorText, isError = true, root?: unknown, session = "FICTITIOUS_SESSION", tick = 0): [any, any] {
  const base = { sessionId: session, cwd, version: "2.1.63", isSidechain: false };
  return [
    { ...base, type: "assistant", uuid: `call-${id}`, timestamp: time(tick + 1), message: { id: `message-${id}`, role: "assistant", content: [{ type: "tool_use", id, name, input: args }] } },
    { ...base, type: "user", uuid: `result-${id}`, parentUuid: `call-${id}`, sourceToolAssistantUUID: `call-${id}`, timestamp: time(tick + 2),
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: body, is_error: isError }] }, ...(root === undefined ? {} : { toolUseResult: root }) },
  ];
}
export function readRoot(content = "alpha\nbeta\n", path = filePath) {
  return { type: "text", file: { filePath: path, content, startLine: 1, numLines: 2, totalLines: 2 } };
}
export function patchRoot(path = filePath) {
  return { filePath: path, originalFile: "FICTITIOUS_BEFORE", structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-alpha", "+beta"] }] };
}
export function claudeRows(): unknown[] {
  return [...claudePair("read", "Read", { file_path: filePath }, "1 alpha\n2 beta", false, readRoot()),
    ...claudePair("edit", "Edit", { file_path: filePath, old_string: "alpha", new_string: "beta" }, "success", false, patchRoot(), "FICTITIOUS_SESSION", 3),
    ...claudePair("error", "Bash", undefined, errorText, true, errorText, "FICTITIOUS_SESSION", 6)];
}
export function snapshot(provider: Provider, rows = provider === "codex" ? codexRows() : claudeRows(), mode: "legacy" | "timing" | "patterns" = "patterns") {
  const a = adapter(provider, mode), size = feed(a, rows), s = a.snapshot();
  const source = { sourceId: context.fingerprint("source", [provider, "FICTITIOUS_USAGE_FILE"]), provider, parserVersion: s.capabilities.parserVersion,
    normalizationVersion: 1 as const, keyVersion: 1 as const, keyId, completedOffset: size, observedSize: size,
    boundaryFingerprint: size ? context.fingerprint("content", ["FICTITIOUS_BOUNDARY", size]) : null, events: s.events,
    evidence: { turns: s.turns, usage: s.usage, observations: s.observations, diagnostics: s.diagnostics, capabilities: s.capabilities },
    relationshipEvidence: "wrappers" in s ? { contractVersion: 1 as const, capturePolicyVersion: 1 as const, status: "captured" as const, provider: "codex" as const, metadata: s.metadata, wrappers: s.wrappers }
      : { contractVersion: 1 as const, capturePolicyVersion: 1 as const, status: "captured" as const, provider: "claude" as const, metadata: s.metadata, messages: s.messages },
  };
  const { store } = memory(); store.replaceSourceSnapshot(source, null);
  return { adapter: a, source: store.readSource(source.sourceId)!, size };
}
