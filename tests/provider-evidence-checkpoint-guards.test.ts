import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { CodexAdapter } from "../src/parsers/codex/index.js";
import { ClaudeAdapter } from "../src/parsers/claude/index.js";
import { adapter, context, feed, codexRows, claudeRows, claudePair, readRoot, patchRoot, filePath, errorText } from "./provider-evidence-fixture.js";

function token(provider: "codex" | "claude", mode: "legacy" | "timing" | "patterns" = "patterns", rows?: unknown[]) {
  const all = rows ?? (provider === "codex" ? codexRows() : claudeRows()), a = adapter(provider, mode), size = feed(a, all);
  const binding = { sourceId: context.fingerprint("source", [provider, "FICTITIOUS_USAGE_FILE"]), completedOffset: size, nextOrdinal: all.length };
  const result = a.exportCheckpoint(binding); expect(result.status).toBe("captured");
  if (result.status !== "captured") throw Error("uncaptured checkpoint");
  return { binding, checkpoint: result.checkpoint };
}
function signed(checkpoint: string, mutate: (payload: any) => void) {
  const outer = JSON.parse(checkpoint), payload = JSON.parse(outer.payload); mutate(payload); outer.payload = JSON.stringify(payload);
  outer.tag = context.fingerprint("source", [outer.schema, createHash("sha256").update(outer.payload).digest("hex")]);
  return JSON.stringify(outer);
}
for (const provider of ["codex", "claude"] as const) {
  const Type = provider === "codex" ? CodexAdapter : ClaudeAdapter;
  it(`${provider} cannot relabel timestamp-only state to the richer evidence codec`, () => {
    const x = token(provider, "timing");
    const changed = signed(x.checkpoint, p => { p.parserVersion = provider === "codex" ? 3 : 4; });
    expect(Type.restoreCheckpoint(context, changed, x.binding, {}, { patternEvidence: true }).status).toBe("rejected");
  });
  for (const mutation of ["missing-policy", "wrong-policy", "extra-field", "future-version", "complete-invented", "scope-invented", "error-on-success"]) {
    it(`${provider} refuses re-signed ${mutation} without weakening old or new codecs`, () => {
      const x = token(provider), changed = signed(x.checkpoint, p => {
        const e = p.state.events[0][1].event;
        if (mutation === "missing-policy") delete p.patternEvidencePolicyVersion;
        if (mutation === "wrong-policy") p.patternEvidencePolicyVersion = 2;
        if (mutation === "extra-field") p.state.events[0][1].raw = "FICTITIOUS_SECRET";
        if (mutation === "future-version") p.parserVersion = 99;
        if (mutation === "complete-invented") { e.contentState = "complete"; e.contentFingerprint = context.fingerprint("content", ["fake"]); }
        if (mutation === "scope-invented") e.validationScope = "full";
        if (mutation === "error-on-success") { e.status = "completed"; e.executionOutcome = "success"; e.errorFingerprint = context.fingerprint("error", ["fake"]); }
      });
      expect(Type.restoreCheckpoint(context, changed, x.binding, {}, { patternEvidence: true }).status).toBe("rejected");
    });
  }
}
it.each(["path", "range", "content", "lookup", "raw", "wrong-tool"])("Claude rejects inconsistent result/event %s proof", mutation => {
  const x = token("claude"), changed = signed(x.checkpoint, p => {
    const row = p.state.events.find(([, v]: any) => v.event.kind === "file_read")[1];
    if (mutation === "path") row.result.fileEvidence.fileFingerprint = context.fingerprint("file", ["other"]);
    if (mutation === "range") row.result.fileEvidence.range.startLine = 0;
    if (mutation === "content") row.event.contentFingerprint = context.fingerprint("content", ["other"]);
    if (mutation === "lookup") row.event.lookupKey = context.fingerprint("lookup", ["other"]);
    if (mutation === "raw") row.result.fileEvidence.raw = "FICTITIOUS_RAW";
    if (mutation === "wrong-tool") { row.event.kind = "shell"; row.event.toolName = "Bash"; }
  });
  expect(ClaudeAdapter.restoreCheckpoint(context, changed, x.binding, {}, { patternEvidence: true }).status).toBe("rejected");
});
it("conflicting deferred Read metadata remains resumable but cannot produce a complete read", () => {
  const [call, result] = claudePair("r", "Read", { file_path: filePath }, "presentation", false, readRoot());
  const changed = structuredClone(result); changed.uuid = "changed"; changed.toolUseResult.file.content = "gamma\ndelta\n";
  const x = token("claude", "patterns", [result, changed]);
  const restored = ClaudeAdapter.restoreCheckpoint(context, x.checkpoint, x.binding, {}, { patternEvidence: true });
  expect(restored.status).toBe("restored"); if (restored.status !== "restored") throw Error("not restored");
  feed(restored.adapter, [call], "FICTITIOUS_USAGE_FILE", x.binding.completedOffset, 2);
  expect(restored.adapter.snapshot().events[0]).toMatchObject({ status: "unknown", contentFingerprint: null, lookupKey: null });
});
it("conflicting deferred error text remains resumable and cannot yield a confirmed signature", () => {
  const [call, result] = claudePair("e", "Bash", undefined, errorText, true);
  const changed = structuredClone(result); changed.uuid = "changed"; changed.message.content[0].content = "other observed error";
  const x = token("claude", "patterns", [result, changed]);
  const restored = ClaudeAdapter.restoreCheckpoint(context, x.checkpoint, x.binding, {}, { patternEvidence: true });
  expect(restored.status).toBe("restored"); if (restored.status !== "restored") throw Error("not restored");
  feed(restored.adapter, [call], "FICTITIOUS_USAGE_FILE", x.binding.completedOffset, 2);
  expect(restored.adapter.snapshot().events[0]).toMatchObject({ status: "unknown", errorFingerprint: null });
});

it("different valid patches with identical visible result text cannot be mistaken for a replay", () => {
  const [call, result] = claudePair("edit-conflict", "Edit", { file_path: filePath, old_string: "alpha", new_string: "beta" }, "success", false, patchRoot());
  const changed = structuredClone(result); changed.uuid = "changed-patch";
  changed.toolUseResult.structuredPatch[0].lines = ["-alpha", "+gamma"];
  const x = token("claude", "patterns", [call, result, changed]);
  const restored = ClaudeAdapter.restoreCheckpoint(context, x.checkpoint, x.binding, {}, { patternEvidence: true });
  expect(restored.status).toBe("restored"); if (restored.status !== "restored") throw Error("not restored");
  expect(restored.adapter.snapshot().events[0]).toMatchObject({ status: "unknown", changeState: "unknown", errorFingerprint: null });
});
it.each(["missing", "wrong-domain", "missing-on-read"])("Claude refuses a re-signed %s patch identity", mutation => {
  const x = token("claude"), changed = signed(x.checkpoint, p => {
    const row = p.state.events.find(([, v]: any) => v.event.kind === (mutation === "missing-on-read" ? "file_read" : "file_edit"))[1];
    if (mutation === "wrong-domain") row.result.fileEvidence.mutationFingerprint = context.fingerprint("file", ["wrong"]);
    else delete row.result.fileEvidence.mutationFingerprint;
  });
  expect(ClaudeAdapter.restoreCheckpoint(context, changed, x.binding, {}, { patternEvidence: true }).status).toBe("rejected");
});
