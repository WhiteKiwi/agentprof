import { describe, it, expect } from "vitest";
import { observedErrorFingerprint, evidenceOmitted, PATTERN_TEXT_BYTES } from "../src/parsers/pattern-evidence.js";
import { extractClaudeFileEvidence } from "../src/parsers/claude/pattern-evidence.js";
import { readOutput } from "../src/parsers/codex/output.js";
import { captureMode, captureForVersion } from "../src/parsers/capture.js";
import { context, errorText, readRoot, patchRoot } from "./provider-evidence-fixture.js";
const project = context.fingerprint("file", ["FICTITIOUS_PROJECT"]);

describe("bounded exact observed error identities", () => {
  it("matches an independently framed HMAC and preserves text/block/code/provider distinctions", () => {
    const fp = observedErrorFingerprint(context, "codex", "process_exit", errorText, 2);
    expect(fp).toBe(context.fingerprint("error", ["observed_error_text/v1", "codex", "process_exit", 2, [errorText]]));
    expect(observedErrorFingerprint(context, "codex", "process_exit", [{ type: "text", text: errorText }], 2)).toBe(fp);
    expect(observedErrorFingerprint(context, "codex", "process_exit", errorText, 3)).not.toBe(fp);
    expect(observedErrorFingerprint(context, "claude", "tool_error", errorText)).not.toBe(fp);
    expect(observedErrorFingerprint(context, "claude", "tool_error", [{ type: "text", text: "a" }, { type: "text", text: "b" }]))
      .not.toBe(observedErrorFingerprint(context, "claude", "tool_error", "ab"));
    expect(fp).not.toContain("FICTITIOUS");
  });
  it.each([null, 12, {}, "", " \n", [], [{ type: "image", data: "x" }], [{ type: "text", text: 2 }], new Array(1), "x".repeat(PATTERN_TEXT_BYTES + 1), "界".repeat(22_000), "\ud800", "Warning: truncated output", "prefix\n[20 lines omitted]\nsuffix", "<persisted-output>...", [{ type: "text", text: "x", truncated: true }]])("rejects unqualified observed body %#", body => {
    expect(observedErrorFingerprint(context, "claude", "tool_error", body)).toBeNull();
  });
  it("does not execute accessors or proxy traps", () => {
    const bad = Object.defineProperty({ type: "text" }, "text", { enumerable: true, get() { throw Error("executed"); } });
    const proxy = new Proxy({}, { getPrototypeOf() { throw Error("executed"); } });
    expect(observedErrorFingerprint(context, "claude", "tool_error", [bad])).toBeNull();
    expect(observedErrorFingerprint(context, "claude", "tool_error", [proxy])).toBeNull();
    expect(() => captureMode(proxy)).toThrow();
  });
  it("admits the exact UTF-8 cap without claiming complete content", () => {
    const output = readOutput({ exit_code: 2, output: "x".repeat(PATTERN_TEXT_BYTES) }, "s", context, "exec", false, true);
    expect(output.errorFingerprint).not.toBeNull();
    expect(output.contentFingerprint).toBeNull(); expect(output.contentState).toBe("unknown");
    expect(evidenceOmitted({ truncated: false })).toBe(false);
    expect(evidenceOmitted({ truncated: "false" })).toBe(true);
  });
  it.each([{ exit_code: 0 }, { exit_code: 2, running: true }, { exit_code: 2, status: "cancelled" }, { exit_code: 2, truncated: true }, { exit_code: "2" }])("does not identify a nonterminal/nonerror envelope %j", extra => {
    expect(readOutput({ output: errorText, ...extra }, "s", context, "exec", false, true).errorFingerprint).toBeNull();
  });
});

describe("strict structured file-result projection", () => {
  it("retains only a hashed path, counted returned range and hashed content", () => {
    const e = extractClaudeFileEvidence(readRoot(), "2.1.63", project, context)!;
    expect(e.kind).toBe("read"); expect(e.range).toEqual({ startLine: 1, endLine: 2 });
    expect(e.contentFingerprint).toBe(context.fingerprint("content", ["claude_read_range/v1", "alpha\nbeta\n"]));
    expect(JSON.stringify(e)).not.toMatch(/FICTITIOUS|alpha|beta/);
    expect(Object.isFrozen(e.range)).toBe(true);
  });
  it.each([{ numLines: 3 }, { startLine: 0 }, { totalLines: 1 }, { numLines: 0 }, { numLines: 1.5 }, { startLine: Number.MAX_SAFE_INTEGER }, { content: "Warning: truncated output" }, { content: "x".repeat(65537) }, { filePath: "bad\npath" }, { truncated: true }])("withholds inconsistent read metadata %j", extra => {
    const root = readRoot(); expect(extractClaudeFileEvidence({ ...root, file: { ...root.file, ...extra } }, "2.1.63", project, context)).toBeNull();
  });
  it("does not guess unsupported version/project/type or image content", () => {
    expect(extractClaudeFileEvidence(readRoot(), undefined, project, context)).toBeNull();
    expect(extractClaudeFileEvidence(readRoot(), "3.0.0", project, context)).toBeNull();
    expect(extractClaudeFileEvidence(readRoot(), "2.1.63", null, context)).toBeNull();
    expect(extractClaudeFileEvidence({ ...readRoot(), type: "image" }, "2.1.63", project, context)).toBeNull();
  });
  it("accepts a counted patch but not a success string or a no-op hunk", () => {
    expect(extractClaudeFileEvidence(patchRoot(), "2.1.63", project, context)?.kind).toBe("mutation");
    expect(extractClaudeFileEvidence("success", "2.1.63", project, context)).toBeNull();
    const root = patchRoot(); root.structuredPatch[0].lines = ["-alpha", "+alpha"];
    expect(extractClaudeFileEvidence(root, "2.1.63", project, context)).toBeNull();
  });
  it.each([{ oldLines: 2 }, { newLines: 0 }, { oldStart: -1 }, { lines: ["invalid"] }, { lines: ["-a", "+b", " extra"] }])("withholds malformed patch %j", extra => {
    const root = patchRoot(); expect(extractClaudeFileEvidence({ ...root, structuredPatch: [{ ...root.structuredPatch[0], ...extra }] }, "2.1.63", project, context)).toBeNull();
  });
  it("strictly validates both new booleans and exact version restore options", () => {
    expect(captureMode({ patternEvidence: true, usageTiming: false })).toEqual({ usageTiming: true, patternEvidence: true });
    expect(captureForVersion("claude", 4)).toEqual({ usageTiming: true, patternEvidence: true });
    for (const mode of [{ patternEvidence: "yes" }, { patternEvidence: undefined }, { extra: true }]) expect(() => captureMode(mode as never)).toThrow();
  });
});

it("hashes the validated patch fields without retaining raw patch lines", () => {
  const result = extractClaudeFileEvidence(patchRoot(), "2.1.63", project, context)!;
  expect(result.mutationFingerprint).toBe(context.fingerprint("content", ["claude_structured_patch/v1", [[1, 1, 1, 1, ["-alpha", "+beta"]]]]));
  expect(result.contentFingerprint).toBeNull();
  const changed = patchRoot(); changed.structuredPatch[0].lines = ["-alpha", "+gamma"];
  expect(extractClaudeFileEvidence(changed, "2.1.63", project, context)?.mutationFingerprint).not.toBe(result.mutationFingerprint);
  expect(JSON.stringify(result)).not.toContain("alpha");
});
it.each([{ status: "failed" }, { success: false }, { isAsync: true }])("rejects contradicted structured patch %j", extra => {
  expect(extractClaudeFileEvidence({ ...patchRoot(), ...extra }, "2.1.63", project, context)).toBeNull();
});
