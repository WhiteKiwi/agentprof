import { describe, it, expect } from "vitest";
import { CodexAdapter } from "../src/parsers/codex/index.js";
import { ClaudeAdapter } from "../src/parsers/claude/index.js";
import { analyzeSourcePatterns } from "../src/analysis/source-patterns.js";
import { adapter, snapshot, codexRows, claudeRows, claudePair, readRoot, patchRoot, filePath, context, feed, errorText } from "./provider-evidence-fixture.js";

describe("ordinary versioned pattern evidence", () => {
  it("Codex keeps actual semantic failures, enables retry evidence, and preserves unknown content", () => {
    const { source } = snapshot("codex");
    expect(source.parserVersion).toBe(3);
    expect(source.events.map(e => e.status)).toEqual(["failed", "failed", "failed"]);
    expect(new Set(source.events.map(e => e.errorFingerprint)).size).toBe(1);
    expect(source.events[0].errorFingerprint).not.toBeNull();
    expect(source.events.every(e => e.contentFingerprint === null && e.contentState === "unknown")).toBe(true);
    const a = analyzeSourcePatterns(source);
    expect(a.candidates.filter(c => c.ruleId === "retry-loop")).toHaveLength(1);
    expect(a.candidates[0].occurrences).toBe(3);
    expect(JSON.stringify(source)).not.toContain("FICTITIOUS_");
  });
  it.each([0, 1])("Codex exit %d never becomes an observed error", code => {
    const { source } = snapshot("codex", codexRows(undefined, code));
    expect(source.events.every(e => e.errorFingerprint === null && e.status === "completed")).toBe(true);
  });
  it("Claude captures explicit text errors including ordinary string toolUseResult without complete-output inference", () => {
    const { source } = snapshot("claude", claudePair("e", "Bash", undefined, errorText, true, errorText));
    expect(source.parserVersion).toBe(4); expect(source.events[0].errorFingerprint).not.toBeNull();
    expect(source.events[0].contentState).toBe("unknown"); expect(source.events[0].contentFingerprint).toBeNull();
  });
  it("Claude applies structured read and edit data only to the matching successful call", () => {
    const { source } = snapshot("claude");
    const read = source.events.find(e => e.kind === "file_read")!, edit = source.events.find(e => e.kind === "file_edit")!;
    expect(read.lookupRange).toEqual({ startLine: 1, endLine: 2 });
    expect(read.contentState).toBe("complete"); expect(read.lookupKey).not.toBeNull(); expect(read.changeState).toBe("unknown");
    expect(edit.changeState).toBe("changed");
    expect(source.events.every(e => e.validationScope === "unknown")).toBe(true);
    expect(analyzeSourcePatterns(source).candidates.filter(c => c.ruleId === "context-churn")).toHaveLength(0);
  });
  it.each(["path", "tool", "failure", "truncated", "missing-version"])("does not borrow invalid structured Read evidence: %s", kind => {
    const pair = claudePair("r", kind === "tool" ? "Bash" : "Read", { file_path: filePath }, "text", kind === "failure", readRoot("alpha\nbeta\n", kind === "path" ? "/other" : filePath));
    if (kind === "truncated") pair[1].toolUseResult.truncated = true;
    if (kind === "missing-version") delete pair[1].version;
    const e = snapshot("claude", pair).source.events[0];
    expect(e.lookupRange).toBeNull(); expect(e.contentFingerprint).toBeNull(); expect(e.changeState).toBe("unknown");
  });
  it("conflicting root metadata clears formerly valid Read evidence", () => {
    const rows = claudePair("r", "Read", { file_path: filePath }, "same presentation", false, readRoot());
    const conflict = structuredClone(rows[1]); conflict.uuid = "second-result"; conflict.toolUseResult.file.content = "gamma\ndelta\n";
    const s = snapshot("claude", [...rows, conflict]).source;
    expect(s.events[0].status).toBe("unknown"); expect(s.events[0].lookupKey).toBeNull(); expect(s.events[0].contentFingerprint).toBeNull();
  });
  it("result-before-call retains exact safe Read evidence through pairing", () => {
    const [call, result] = claudePair("r", "Read", { file_path: filePath }, "read body", false, readRoot());
    const s = snapshot("claude", [result, call]).source;
    expect(s.events[0].contentState).toBe("complete"); expect(s.events[0].lookupRange).toEqual({ startLine: 1, endLine: 2 });
  });
  it.each(["codex", "claude"] as const)("%s explicit false mode preserves legacy public and retained state", provider => {
    const rows = provider === "codex" ? codexRows() : claudeRows();
    const a = adapter(provider, "legacy"), b = provider === "codex" ? new CodexAdapter(context, {}, { patternEvidence: false }) : new ClaudeAdapter(context, {}, { patternEvidence: false });
    feed(a, rows); feed(b, rows); expect(b.snapshot()).toEqual(a.snapshot()); expect(b.inspectRetainedState()).toEqual(a.inspectRetainedState());
    expect(a.snapshot().events.every(e => e.errorFingerprint === null && e.contentFingerprint === null && e.changeState === "unknown")).toBe(true);
  });
});

describe("exact new checkpoint contracts at every LF", () => {
  for (const provider of ["codex", "claude"] as const) {
    const rows = provider === "codex" ? codexRows() : claudeRows();
    for (let split = 0; split <= rows.length; split++) it(`${provider} new evidence split ${split} round trips and refuses old codecs`, () => {
      const a = adapter(provider), size = feed(a, rows.slice(0, split));
      const binding = { sourceId: context.fingerprint("source", [provider, "FICTITIOUS_USAGE_FILE"]), completedOffset: size, nextOrdinal: split };
      const checkpoint = a.exportCheckpoint(binding);
      expect(checkpoint.status).toBe("captured"); if (checkpoint.status !== "captured") throw Error("no checkpoint");
      const Type = provider === "codex" ? CodexAdapter : ClaudeAdapter;
      expect(Type.restoreCheckpoint(context, checkpoint.checkpoint, binding, {}, { usageTiming: true }).status).toBe("rejected");
      const restored = Type.restoreCheckpoint(context, checkpoint.checkpoint, binding, {}, { patternEvidence: true });
      expect(restored.status).toBe("restored"); if (restored.status !== "restored") throw Error("not restored");
      feed(restored.adapter, rows.slice(split), "FICTITIOUS_USAGE_FILE", size, split);
      const full = adapter(provider); feed(full, rows);
      expect(restored.adapter.snapshot()).toEqual(full.snapshot());
      expect(checkpoint.checkpoint).not.toContain("FICTITIOUS_");
    });
  }
});

it("Codex structured aggregated output is observed error evidence, not a complete transcript", () => {
  const base = codexRows().slice(0, 2);
  const structured = { type: "event_msg", timestamp: "2026-10-03T10:00:02Z", payload: { type: "item_completed", thread_id: "FICTITIOUS_SESSION", turn_id: "FICTITIOUS_TURN",
    started_at_ms: Date.parse("2026-10-03T10:00:01Z"), completed_at_ms: Date.parse("2026-10-03T10:00:02Z"),
    item: { type: "CommandExecution", id: "structured", source: "unified_exec_startup", command: "rg FICTITIOUS_QUERY src", status: "failed", exit_code: 2, aggregated_output: errorText } } };
  const e = snapshot("codex", [...base, structured]).source.events[0];
  expect(e.errorFingerprint).not.toBeNull(); expect(e.contentState).toBe("unknown");
  const conflict = structuredClone(structured); (conflict.payload.item as any).output = "different observed error";
  expect(snapshot("codex", [...base, conflict]).source.events[0].errorFingerprint).toBeNull();
});
it.each([true, false])("Codex MCP isError=%s preserves native status and only identifies errors", isError => {
  const base = codexRows().slice(0, 2);
  const rows = [...base,
    { type: "response_item", timestamp: "2026-10-03T10:00:01Z", payload: { type: "function_call", call_id: "mcp-one", name: "mcp__synthetic__lookup", arguments: "{}" } },
    { type: "response_item", timestamp: "2026-10-03T10:00:02Z", payload: { type: "function_call_output", call_id: "mcp-one", output: { isError, content: [{ type: "text", text: errorText }] } } },
  ];
  const e = snapshot("codex", rows).source.events[0];
  expect(e.status).toBe(isError ? "failed" : "completed"); expect(e.errorFingerprint === null).toBe(!isError); expect(e.contentFingerprint).toBeNull();
});
it("Claude multi-result root metadata is not assigned to either call", () => {
  const [one, first] = claudePair("first", "Read", { file_path: filePath }, "read", false, readRoot());
  const [two, second] = claudePair("second", "Read", { file_path: filePath }, "read", false, readRoot());
  first.message.content.push(second.message.content[0]);
  expect(snapshot("claude", [one, two, first]).source.events.every(e => e.contentFingerprint === null && e.lookupRange === null)).toBe(true);
});
it("ordinary Claude main and sidechain streams can identify repeated observed errors without merging streams", () => {
  const rows = [...claudePair("a"), ...claudePair("b", "Bash", undefined, errorText, true, undefined, "FICTITIOUS_SESSION", 4)];
  const side = claudePair("c", "Bash", undefined, errorText, true, undefined, "FICTITIOUS_SESSION", 8);
  for (const r of side) { r.isSidechain = true; r.agentId = "FICTITIOUS_AGENT"; }
  const s = snapshot("claude", [...rows, ...side]).source;
  const a = analyzeSourcePatterns(s);
  expect(a.suppressionReason).toBeNull();
  expect(new Set(s.events.map(e => e.sessionId)).size).toBe(2);
  expect(a.candidates.some(c => c.ruleId === "repeated-error")).toBe(true);
});
