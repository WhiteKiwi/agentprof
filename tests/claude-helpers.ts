import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { createIdentityContext } from "../src/normalize/identity.js";
import { claudeEventId, claudeStreamId } from "../src/parsers/claude/index.js";
import type { ClaudeAdapter } from "../src/parsers/claude/index.js";
import type { ClaudeInputSource, ClaudeTrustedFixtureContext } from "../src/parsers/claude/types.js";
import { readJsonLines } from "../src/scanner/jsonl.js";

export const context = createIdentityContext(new Uint8Array(32).fill(23), "2".repeat(32));
export const directory = fileURLToPath(new URL("./fixtures/providers/", import.meta.url));
export const session = "fictitious-claude-stream";
export const stream = claudeStreamId(context, session);
export const at = (seconds = 0) => new Date(Date.parse("2026-09-01T00:00:00Z") + seconds * 1000).toISOString();
export const source = (ordinal: number, fileIdentity = "fictitious-source", trustedFixtureContext?: ClaudeTrustedFixtureContext): ClaudeInputSource => ({ fileIdentity, ordinal, byteOffset: ordinal * 100, sourceAlias: "source-1", ...(trustedFixtureContext ? { trustedFixtureContext } : {}) });
export const usage = (output = 6) => ({ input_tokens: 100, output_tokens: output, cache_read_input_tokens: 30, cache_creation_input_tokens: 20 });
export const callBlock = (id = "call", name = "Bash", input: Record<string, unknown> = { command: "npm test fictitious-target" }) => ({ type: "tool_use", id, name, input });
export function resultBlock(id = "call", isError?: boolean, content: unknown = "fictitious output") {
  const selected = arguments.length < 2 ? false : isError;
  return { type: "tool_result", tool_use_id: id, ...(selected === undefined ? {} : { is_error: selected }), content };
}
export const assistant = (uuid = "call-uuid", seconds = 0, content: unknown[] = [callBlock()], extra: Record<string, unknown> = {}) => ({ type: "assistant", uuid, timestamp: at(seconds), sessionId: session, isSidechain: false, message: { id: "response", role: "assistant", content }, ...extra });
export const user = (uuid = "result-uuid", seconds = 4, content: unknown[] = [resultBlock()], extra: Record<string, unknown> = {}) => ({ type: "user", uuid, timestamp: at(seconds), sessionId: session, isSidechain: false, parentUuid: "call-uuid", sourceToolAssistantUUID: "call-uuid", message: { role: "user", content }, ...extra });
export const usageRecord = (uuid: string, output: number, seconds = 0, extra: Record<string, unknown> = {}) => assistant(uuid, seconds, [], { message: { id: "response", role: "assistant", content: [], usage: usage(output) }, ...extra });
export const event = (adapter: ClaudeAdapter, id = "call", streamId = stream) => adapter.snapshot().events.find((value) => value.id === claudeEventId(context, streamId, id))!;
export const codes = (adapter: ClaudeAdapter) => adapter.snapshot().diagnostics.map((value) => value.code);
export const proof = (entries: readonly Readonly<{ ordinal: number; finality: "partial" | "final"; order: number }>[] , group = "fictitious-order"): ClaudeTrustedFixtureContext => ({ usageEvidence: entries.map((value) => ({ ...value, messageId: "response", orderingGroup: group, mapping: "anthropic_messages" })) });

export async function feed(adapter: ClaudeAdapter, filename: string, fileIdentity = filename, trustedFixtureContext?: ClaudeTrustedFixtureContext) {
  const path = `${directory}/${filename}`;
  const before = createHash("sha256").update(await readFile(path)).digest("hex");
  let ordinal = 1;
  for await (const entry of readJsonLines(path)) {
    expect(entry.kind).not.toBe("diagnostic");
    if (entry.kind === "record") adapter.ingest(entry.value, { fileIdentity, ordinal: ordinal++, byteOffset: entry.byteOffset, sourceAlias: "source-1", ...(trustedFixtureContext ? { trustedFixtureContext } : {}) });
  }
  expect(createHash("sha256").update(await readFile(path)).digest("hex")).toBe(before);
}
