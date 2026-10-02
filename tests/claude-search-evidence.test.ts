import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createIdentityContext } from "../src/normalize/identity.js";
import { createClaudeAdapter } from "../src/parsers/claude/index.js";

// Frozen against parser-v1 before production changes. These expected literals use
// independently framed Node HMAC, not the future extraction helper/normalizer.
const secret = Buffer.alloc(32, 41), keyId = "4".repeat(32);
const identity = createIdentityContext(secret, keyId);
const project = "/FICTITIOUS_SEARCH_ROOT", fileIdentity = "/FICTITIOUS_SEARCH_SOURCE";
const query = "FICTITIOUS_QUERY_A", version = "2.1.241";
const key = (digest: string) => `h1:${keyId}:lookup:${digest}`;
const expected = {
  grepA: key("c92b499ca84056568193bb51e225959fe4a2a5d8f8fe9723348c13d53decd28e"),
  grepB: key("0e9ee2232b890fc4e540bf81a566067471e43660da916cf7350aa78480cd3b5c"),
  globA: key("c77f6b521c4da92d16b382380e202f7997575d5d5282de25dd1231d78de8ff31"),
  omitted: key("f919de92191df982b547bc3f5890d0ed847048f3359af51d91a13ae053b33dc8"),
  withOptions: key("3db6f9466ced6d41965b4a46346b6169e5baca10bd9f79d8112f1165663cef28"),
  version: key("f8ccc5146ead2fb97f7c5d8fbe8ef68b833a078eb5ccb7e6485ce83f6208436d"),
} as const;
const hmac = (domain: string, ...parts: unknown[]) => `h1:${keyId}:${domain}:${createHmac("sha256", secret).update(JSON.stringify([1, 1, domain, ...parts])).digest("hex")}`;
function call(id = "call", args: Record<string, unknown> = { pattern: query, path: "src" }, name = "Grep", extra: Record<string, unknown> = {}) {
  return { type: "assistant", uuid: `uuid-${id}`, sessionId: "FICTITIOUS_SEARCH_SESSION", isSidechain: false, cwd: project, version,
    timestamp: "2026-09-01T00:00:00.000Z", message: { id: `response-${id}`, role: "assistant", content: [{ type: "tool_use", id, name, input: args }] }, ...extra };
}
function result(id = "call", isError = false, extra: Record<string, unknown> = {}) {
  return { type: "user", uuid: `result-${id}`, sessionId: "FICTITIOUS_SEARCH_SESSION", isSidechain: false,
    timestamp: "2026-09-01T00:00:04.000Z", parentUuid: `uuid-${id}`, sourceToolAssistantUUID: `uuid-${id}`,
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: isError, content: "FICTITIOUS_SEARCH_RESULT_SENTINEL" }] }, ...extra };
}
function feed(records: readonly unknown[]) {
  const adapter = createClaudeAdapter(identity); let offset = 0;
  records.forEach((record, ordinal) => { adapter.ingest(record, { fileIdentity, ordinal, byteOffset: offset, sourceAlias: "source-1" }); offset += Buffer.byteLength(JSON.stringify(record) + "\n"); });
  return adapter;
}
function event(record = call()) { return feed([record, result()]).snapshot().events[0]!; }

describe("ordinary direct Claude search request identity", () => {
  it("freezes six independently framed exact-key oracles before implementation", () => {
    const p = hmac("file", "claude_project", project);
    const independent = (tool: string, q: string, root: readonly string[], options: string, v = version) =>
      hmac("lookup", "search", "claude", p, q, JSON.stringify(root), ["claude_native_search/v1", tool, v, options]);
    expect(independent("Grep", query, ["explicit_path", "src"], "{}")).toBe(expected.grepA);
    expect(independent("Grep", "FICTITIOUS_QUERY_B", ["explicit_path", "src"], "{}")).toBe(expected.grepB);
    expect(independent("Glob", query, ["explicit_path", "src"], "{}")).toBe(expected.globA);
    expect(independent("Grep", query, ["record_cwd"], "{}")).toBe(expected.omitted);
    expect(independent("Grep", query, ["explicit_path", "src"], '{"-i":false,"glob":"*.ts","multiline":false,"output_mode":"files_with_matches"}')).toBe(expected.withOptions);
    expect(independent("Grep", query, ["explicit_path", "src"], "{}", "2.1.242")).toBe(expected.version);
  });

  it("ordinary completed Grep A has the frozen key and no content or savings proof", () => {
    expect(event()).toMatchObject({ lookupKey: expected.grepA, kind: "search", category: "search", toolName: "Grep",
      status: "completed", durationMs: 4000, timingEvidence: "paired_timestamps", durationScope: "invocation_latency",
      contentFingerprint: null, contentState: "unknown", changeState: "unknown", lookupRange: null, fileFingerprint: null });
  });

  it("reordered keys compare equally while separate invocation IDs remain distinct", () => {
    const adapter = feed([call("a"), result("a"), call("b", { path: "src", pattern: query }), result("b")]);
    expect(adapter.snapshot().events.map(row => row.lookupKey)).toEqual([expected.grepA, expected.grepA]);
    expect(new Set(adapter.snapshot().events.map(row => row.id)).size).toBe(2);
  });

  it("keeps independently frozen query/tool/root/options/version distinctions", () => {
    expect(event(call("call", { pattern: "FICTITIOUS_QUERY_B", path: "src" })).lookupKey).toBe(expected.grepB);
    expect(event(call("call", { pattern: query, path: "src" }, "Glob")).lookupKey).toBe(expected.globA);
    expect(event(call("call", { pattern: query })).lookupKey).toBe(expected.omitted);
    expect(event(call("call", { multiline: false, output_mode: "files_with_matches", path: "src", pattern: query, glob: "*.ts", "-i": false })).lookupKey).toBe(expected.withOptions);
    expect(event(call("call", undefined, "Grep", { version: "2.1.242" })).lookupKey).toBe(expected.version);
  });

  it("does not normalize option omission, root spelling, query text or project context", () => {
    const variants = [
      call(), call("call", { pattern: query }),
      ...[".", project, "./src", "SRC", "/src", "src/../src"].map(path => call("call", { pattern: query, path })),
      ...[{ "-i": false }, { "-i": true }, { multiline: false }, { multiline: true }, { output_mode: "files_with_matches" }, { output_mode: "content" }, { output_mode: "count" }, { glob: "*.ts" }].map(options => call("call", { pattern: query, path: "src", ...options })),
      call("call", undefined, "Grep", { cwd: project + "2" }),
      ...[query.toLowerCase(), query + " ", "é", "e\u0301"].map(pattern => call("call", { pattern, path: "src" })),
    ];
    const keys = variants.map(row => event(row).lookupKey);
    expect(keys.every(value => value !== null)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each([
    ["missing version", { version: undefined }], ["null version", { version: null }], ["numeric version", { version: 2 }], ["empty version", { version: "" }],
    ["missing cwd", { cwd: undefined }], ["null cwd", { cwd: null }], ["empty cwd", { cwd: "" }],
  ])("keeps %s evidence unknown without dropping the invocation", (_name, extra) => {
    expect(event(call("call", undefined, "Grep", extra))).toMatchObject({ lookupKey: null, status: "completed" });
  });

  it.each([
    { pattern: query, path: "src", unknown_option: "FICTITIOUS_UNKNOWN_SECRET" },
    { pattern: query, path: "src", head_limit: 10 }, { pattern: query, path: null }, { pattern: "", path: "src" },
    { pattern: query, path: "" }, { pattern: query, path: "src\0bad" }, { pattern: "bad\0pattern", path: "src" },
    { pattern: query, "-i": "false" }, { pattern: query, multiline: 0 }, { pattern: query, glob: "" },
    { pattern: query, output_mode: "unknown" }, { pattern: query, output_mode: null },
  ])("leaves malformed/unsupported input %# unkeyed", args => {
    expect(event(call("call", args))).toMatchObject({ lookupKey: null, status: "completed" });
  });

  it("does not key Grep-only options as Glob or treat shell/custom tools as native search", () => {
    expect(event(call("call", { pattern: query, "-i": true }, "Glob")).lookupKey).toBeNull();
    for (const name of ["Bash", "grep", "mcp__secret__Grep", "WebSearch"]) expect(event(call("call", { pattern: query, path: "src" }, name)).lookupKey).toBeNull();
  });

  it("keeps requested identity independent from success, pending, result order and result metadata", () => {
    expect(feed([call()]).snapshot().events[0]).toMatchObject({ lookupKey: expected.grepA, status: "pending", durationMs: null });
    expect(feed([call(), result("call", true)]).snapshot().events[0]).toMatchObject({ lookupKey: expected.grepA, status: "failed" });
    expect(feed([result(), call()]).snapshot().events[0]).toMatchObject({ lookupKey: expected.grepA, status: "completed", durationMs: 4000 });
    expect(feed([call(), result("call", false, { cwd: project + "OTHER", version: "99.0.0" })]).snapshot().events[0]).toMatchObject({ lookupKey: expected.grepA, status: "completed" });
  });

  it("preserves exact call replay but does not enrich initially absent project/version", () => {
    const same = feed([call(), result(), call(), result()]).snapshot();
    expect(same.events).toHaveLength(1); expect(same.events[0]!.lookupKey).toBe(expected.grepA);
    expect(feed([call("call", undefined, "Grep", { cwd: undefined }), result(), call()]).snapshot().events[0]).toMatchObject({ lookupKey: null, status: "completed", durationMs: 4000, timingEvidence: "paired_timestamps" });
    expect(feed([call("call", undefined, "Grep", { version: undefined }), result(), call()]).snapshot().events[0]!.lookupKey).toBeNull();
  });

  it("clears lookup on conflicting same-call version or input", () => {
    for (const changed of [call("call", undefined, "Grep", { version: "2.1.242" }), call("call", { pattern: "FICTITIOUS_QUERY_B", path: "src" })]) {
      const adapter = feed([call(), result(), changed]);
      expect(adapter.snapshot().events).toHaveLength(1);
      expect(adapter.snapshot().events[0]).toMatchObject({ lookupKey: null, status: "unknown" });
      expect(adapter.snapshot().diagnostics.some(row => row.code === "INCONSISTENT_REPLAY")).toBe(true);
    }
  });

  it("does not retain evidence when unsupported replay properties canonicalize away", () => {
    let accessorCalls = 0;
    const variants: Record<string, unknown>[] = [];
    variants.push({ pattern: query, path: "src", unknown_option: undefined });
    const accessor = { pattern: query, path: "src" };
    Object.defineProperty(accessor, "unknown_option", { enumerable: true, get() { accessorCalls++; return "FICTITIOUS_ACCESSOR_SECRET"; } });
    variants.push(accessor);
    const hidden = { pattern: query, path: "src" };
    Object.defineProperty(hidden, "unknown_option", { value: "FICTITIOUS_HIDDEN_SECRET", enumerable: false });
    variants.push(hidden);
    const symbolic = { pattern: query, path: "src" };
    Object.defineProperty(symbolic, Symbol("FICTITIOUS_SYMBOL_SECRET"), { value: "FICTITIOUS_SYMBOL_VALUE", enumerable: true });
    variants.push(symbolic);
    for (const args of variants) {
      const adapter = feed([call(), result()]);
      // Intentionally direct API input: do not JSON.stringify accessors merely to
      // calculate a synthetic source offset. No raw-data getter is invoked here.
      adapter.ingest(call("call", args), { fileIdentity, ordinal: 2, byteOffset: 4000, sourceAlias: "source-1" });
      expect(adapter.snapshot().events).toHaveLength(1);
      expect(adapter.snapshot().events[0]).toMatchObject({ lookupKey: null, kind: "other", category: "other", toolName: "other",
        operationKey: null, fileFingerprint: null, status: "unknown", executionOutcome: "unknown", durationMs: null,
        timingEvidence: "unknown", durationScope: "unknown", intervalTimingEvidence: "unknown", intervalScope: "unknown" });
      expect(adapter.snapshot().diagnostics.some(row => row.code === "INCONSISTENT_REPLAY")).toBe(true);
    }
    expect(accessorCalls).toBe(0);
  });

  it("propagates an assistant UUID conflict when the original tool block is omitted", () => {
    const missingCall = { ...call(), message: { id: "response-call", role: "assistant", content: [{ type: "text", text: "FICTITIOUS_CONFLICTING_MESSAGE" }] } };
    const adapter = feed([call(), result()]);
    const source = { fileIdentity, ordinal: 2, byteOffset: Buffer.byteLength(JSON.stringify(call()) + "\n" + JSON.stringify(result()) + "\n"), sourceAlias: "source-1" };
    const batch = adapter.ingest(missingCall, source);
    expect(batch.events).toHaveLength(1);
    expect(batch.events[0]?.id).toBe(adapter.snapshot().events[0]?.id);
    expect(batch.events[0]).toMatchObject({ lookupKey: null, status: "unknown", durationMs: null });
    expect(adapter.snapshot().events).toHaveLength(1);
    expect(adapter.snapshot().events[0]).toMatchObject({ lookupKey: null, status: "unknown", durationMs: null, intervalScope: "unknown" });
    expect(adapter.snapshot().messages.find(row => row.kind === "assistant")?.conflicted).toBe(true);
    const before = adapter.snapshot();
    adapter.ingest(missingCall, source);
    expect(adapter.snapshot()).toEqual(before);
  });

  it("preserves an SDK/API invocation when new lookup framing exceeds its unchanged budget", () => {
    // API-only: the full physical JSONL line exceeds the reader's 1 MiB limit,
    // while the existing canonical args/message and base digest remain valid.
    const args = { pattern: "x", path: '"'.repeat(524088) }, longVersion = "v".repeat(4096);
    const record = call("call", args, "Grep", { version: longVersion });
    const frame = JSON.stringify([1, 1, "lookup", "search", "claude", hmac("file", "claude_project", project), "x",
      JSON.stringify(["explicit_path", args.path]), ["claude_native_search/v1", "Grep", longVersion, "{}"]]);
    expect(Buffer.byteLength(JSON.stringify(args))).toBe(1048201);
    expect(Buffer.byteLength(frame)).toBe(2100662);
    expect(Buffer.byteLength(JSON.stringify(record))).toBeGreaterThan(1048576);
    const adapter = createClaudeAdapter(identity);
    adapter.ingest(record, { fileIdentity, ordinal: 0, byteOffset: 0 });
    expect(adapter.snapshot().events).toHaveLength(1);
    expect(adapter.snapshot().events[0]).toMatchObject({ lookupKey: null, kind: "search", toolName: "Grep", status: "pending" });
    expect(adapter.snapshot().events[0]!.operationKey).not.toBeNull();
  });

  it("keeps raw synthetic request/result/ID/version/root material out of retained state", () => {
    const adapter = feed([call(), result()]);
    const encoded = JSON.stringify(adapter.inspectRetainedState());
    for (const sentinel of [project, fileIdentity, query, "FICTITIOUS_SEARCH_SESSION", "FICTITIOUS_SEARCH_RESULT_SENTINEL", version]) expect(encoded).not.toContain(sentinel);
  });
});

// Additional helper-only boundary cases frozen before implementation. The original
// 32 tests and their literal classifications above remain byte-for-byte intact.
describe("descriptor-safe finite native lookup extraction", () => {
  it("rejects proxy/accessor/prototype/symbol/hidden shapes without invoking hooks", async () => {
    const { extractClaudeSearch } = await import("../src/parsers/claude/search.js");
    let touched = 0;
    const accessor = { pattern: query }; Object.defineProperty(accessor, "path", { enumerable: true, get() { touched++; return "src"; } });
    const hidden = { pattern: query }; Object.defineProperty(hidden, "path", { value: "src" });
    const symbolic = { pattern: query, [Symbol("FICTITIOUS_SECRET")]: true };
    const proxy = new Proxy({}, { getPrototypeOf() { touched++; throw Error("secret"); }, ownKeys() { touched++; throw Error("secret"); }, get() { touched++; throw Error("secret"); } });
    const inherited = Object.create({ path: "src" }); inherited.pattern = query;
    for (const input of [proxy, accessor, hidden, symbolic, inherited, [], null, { pattern: query, toJSON() { touched++; return {}; } }]) {
      expect(extractClaudeSearch("Grep", input, version, "project")).toBeNull();
    }
    expect(touched).toBe(0);
  });
  it("enforces exact key and UTF-8/canonical/frame budgets and keeps inert text literal", async () => {
    const { extractClaudeSearch } = await import("../src/parsers/claude/search.js");
    const valid = { pattern: "$(FICTITIOUS_COMMAND);(a+)+$", path: "src", glob: "*.ts", output_mode: "content", "-i": false, multiline: true };
    expect(extractClaudeSearch("Grep", valid, version, "project")).toEqual({ searchQuery: valid.pattern, searchRoot: '["explicit_path","src"]', searchOptions: ["claude_native_search/v1", "Grep", version, '{"-i":false,"glob":"*.ts","multiline":true,"output_mode":"content"}'] });
    expect(extractClaudeSearch("Grep", { ...valid, head_limit: 1 }, version, "project")).toBeNull();
    expect(extractClaudeSearch("Glob", { pattern: "x", path: "src", glob: "*.ts" }, version, "project")).toBeNull();
    expect(extractClaudeSearch("Grep", { pattern: "x".repeat(1_048_562) }, version, "project")).not.toBeNull();
    expect(extractClaudeSearch("Grep", { pattern: "x".repeat(1_048_563) }, version, "project")).toBeNull();
    expect(extractClaudeSearch("Grep", { pattern: "도".repeat(349526) }, version, "project")).toBeNull();
    expect(extractClaudeSearch("Grep", { pattern: "x" }, "v".repeat(4096), "project")).not.toBeNull();
    expect(extractClaudeSearch("Grep", { pattern: "x" }, "v".repeat(4097), "project")).toBeNull();
    for (const input of [{ pattern: "x", path: undefined }, { pattern: "x", glob: null }, { pattern: "x", "-i": undefined }, { pattern: "x", multiline: null }]) expect(extractClaudeSearch("Grep", input, version, "project")).toBeNull();
  });
  it("retains source-order authority for earlier call representations without wall-clock minimization", () => {
    const adapter = createClaudeAdapter(identity);
    adapter.ingest(call("call", undefined, "Grep", { timestamp: "2026-09-01T00:00:01.000Z" }), { fileIdentity, ordinal: 2, byteOffset: 1000 });
    adapter.ingest(result(), { fileIdentity, ordinal: 3, byteOffset: 1500 });
    adapter.ingest(call(), { fileIdentity, ordinal: 0, byteOffset: 0 });
    expect(adapter.snapshot().events[0]).toMatchObject({ lookupKey: expected.grepA, startAt: "2026-09-01T00:00:00.000Z", durationMs: 4000, status: "completed" });
  });
});

// Independent review regression amendment, frozen before the source-order fix.
describe("earlier authoritative project presence", () => {
  it.each([
    { label: "later missing to earlier known", laterCwd: undefined, earlierCwd: project, lookupKey: expected.grepA },
    { label: "later known to earlier missing", laterCwd: project, earlierCwd: undefined, lookupKey: null },
  ])("preserves $label without a fabricated replay conflict", ({ laterCwd, earlierCwd, lookupKey }) => {
    const adapter = createClaudeAdapter(identity);
    const later = call("call", undefined, "Grep", { cwd: laterCwd, timestamp: "2026-09-01T00:00:01.000Z" });
    const earlier = call("call", undefined, "Grep", { cwd: earlierCwd });
    adapter.ingest(later, { fileIdentity, ordinal: 2, byteOffset: 1000 });
    adapter.ingest(result(), { fileIdentity, ordinal: 3, byteOffset: 1500 });
    adapter.ingest(earlier, { fileIdentity, ordinal: 0, byteOffset: 0 });
    const snapshot = adapter.snapshot(), selected = snapshot.events[0]!;
    expect(snapshot.events).toHaveLength(1);
    expect(selected).toMatchObject({ lookupKey, kind: "search", category: "search", toolName: "Grep", status: "completed",
      startAt: "2026-09-01T00:00:00.000Z", durationMs: 4000, timingEvidence: "paired_timestamps", durationScope: "invocation_latency" });
    expect(selected.operationKey === null).toBe(earlierCwd === undefined);
    expect(snapshot.diagnostics.some(row => row.code === "REORDERED_RECORD")).toBe(true);
    expect(snapshot.diagnostics.some(row => row.code === "INCONSISTENT_REPLAY")).toBe(false);
    adapter.ingest(later, { fileIdentity, ordinal: 4, byteOffset: 2000 });
    expect(adapter.snapshot().events[0]).toEqual(selected);
    expect(adapter.snapshot().diagnostics.some(row => row.code === "INCONSISTENT_REPLAY")).toBe(false);
  });
});
