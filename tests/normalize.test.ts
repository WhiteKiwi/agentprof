import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifyCommand } from "../src/normalize/command.js";
import { normalizeEvent } from "../src/normalize/event.js";
import { comparableIdentities, createIdentityContext } from "../src/normalize/identity.js";
import { diagnostic, safeErrorEnvelope, SafeError } from "../src/privacy/diagnostics.js";

const context = createIdentityContext(new Uint8Array(32).fill(7), "0".repeat(32));
const sentinel = "FICTITIOUS_AGENTPROF_ARG_SENTINEL";
function candidate(extra: object = {}) {
  return {
    provider: "codex", eventIdentity: "synthetic-event", sessionIdentity: "synthetic-session", turnIdentity: "synthetic-turn",
    projectIdentity: "/FICTITIOUS_AGENTPROF_PROJECT", kind: "shell", toolName: "exec_command", command: "npm test alpha",
    status: "completed", statusEvidence: "explicit", exitCode: 0,
    startAt: "2026-09-01T00:00:00.000Z", endAt: "2026-09-01T00:00:10.000Z",
    durationMs: 8000, timingEvidence: "source_reported", durationScope: "process_runtime",
    intervalTimingEvidence: "paired_timestamps", intervalScope: "item_lifecycle",
    sourceRef: { fileIdentity: "/FICTITIOUS_AGENTPROF_PROJECT/raw.jsonl", byteOffset: 10, recordType: "event_msg" }, ...extra,
  };
}

describe("inert command classification", () => {
  it("preserves targets and flags in identity while hiding all raw arguments", () => {
    const a = classifyCommand(`npm test ${sentinel} --runInBand`, context, "codex", "p1");
    const b = classifyCommand("npm test beta --runInBand", context, "codex", "p1");
    const c = classifyCommand(`npm test ${sentinel} --watch`, context, "codex", "p1");
    expect(a.operationKey).not.toEqual(b.operationKey);
    expect(a.operationKey).not.toEqual(c.operationKey);
    expect(classifyCommand(`npm   test '${sentinel}' --runInBand`, context, "codex", "p1").operationKey).toEqual(a.operationKey);
    expect(JSON.stringify(a)).not.toContain(sentinel);
  });
  it("preserves backslashes that a shell preserves inside double quotes", () => {
    const a = classifyCommand(String.raw`rg "x\q"`, context, "codex", "p1");
    const b = classifyCommand('rg "xq"', context, "codex", "p1");
    expect(a.safeSimple).toBe(true);
    expect(a.operationKey).not.toEqual(b.operationKey);
    expect(classifyCommand(String.raw`rg 'x\q'`, context, "codex", "p1").operationKey).toEqual(a.operationKey);
  });
  it.each([
    "rg value src && npm test", "rg value [ab]", "rg value src # commentary", "TOKEN=madeup npm test",
    "echo $(touch marker)", "echo `touch marker`", "cat <<EOF\nmadeup\nEOF", "rg \"unterminated",
    "node -e 'console.log(1)'", "node --eval=madeup", "python -c madeup", "bash -c madeup", "eval madeup",
  ])("rejects unsupported shell semantics without evaluation: %s", (command) => {
    const value = classifyCommand(command, context, "codex", "p1");
    expect(value.safeSimple).toBe(false);
    expect(value.operationKey).toBeNull();
    expect(value.commandPattern).toBe("shell <complex>");
  });
  it("hides URL queries, unknown programs, and flag values", () => {
    expect(JSON.stringify(classifyCommand([sentinel, `https://fixture.invalid/?token=${sentinel}`], context, "codex", "p1"))).not.toContain(sentinel);
    expect(classifyCommand(["rg", `--glob=${sentinel}`, sentinel], context, "codex", "p1").commandPattern).toBe("rg --glob <args>");
  });
});

describe("normalization privacy and evidence", () => {
  it("drops prompt/code/output/raw names/metadata without echoing synthetic secrets", () => {
    const sentinels = JSON.parse(readFileSync(new URL("fixtures/contracts/privacy.json", import.meta.url), "utf8")).sentinels as string[];
    const raw = candidate({
      command: `npm test ${sentinel}`, eventIdentity: sentinels[0], sessionIdentity: sentinels[1], parentEventIdentity: sentinels[2],
      toolName: sentinels[3], metadata: { secret: sentinels }, prompt: sentinels[0], code: sentinels[1], output: sentinels[6],
      category: sentinel, filePath: sentinels[7], errorMessage: sentinels[5], status: "failed", errorClass: "tool_error",
    });
    let getterCalled = false;
    Object.defineProperty(raw, "unknownGetter", { get() { getterCalled = true; throw new Error(sentinel); } });
    const result = normalizeEvent(raw, context);
    expect(result.event).not.toBeNull();
    expect(getterCalled).toBe(false);
    for (const forbidden of sentinels) expect(JSON.stringify(result)).not.toContain(forbidden);
    expect(result.event?.toolName).toBe("other");
    expect(result.event).not.toHaveProperty("metadata");
    expect(result.event).not.toHaveProperty("command");
    expect(Object.isFrozen(result.event)).toBe(true);
  });
  it("retains independently scoped source duration and lifecycle interval", () => {
    const { event, diagnostics } = normalizeEvent(candidate(), context);
    expect(event?.durationMs).toBe(8000);
    expect(event?.durationScope).toBe("process_runtime");
    expect(event?.intervalScope).toBe("item_lifecycle");
    expect(diagnostics.some((d) => d.code === "TIMING_CONFLICT")).toBe(false);
  });
  it("allows millisecond boundary rounding and retains authoritative source duration on larger conflict", () => {
    const rounded = normalizeEvent(candidate({ durationMs: 9999.252, intervalScope: "process_runtime" }), context);
    expect(rounded.event?.durationMs).toBe(9999.252);
    expect(rounded.event?.intervalScope).toBe("process_runtime");
    expect(rounded.diagnostics.some((d) => d.code === "TIMING_CONFLICT")).toBe(false);
    const conflicting = normalizeEvent(candidate({ intervalScope: "process_runtime" }), context);
    expect(conflicting.event?.durationMs).toBe(8000);
    expect(conflicting.event?.intervalScope).toBe("unknown");
    expect(conflicting.diagnostics.some((d) => d.code === "TIMING_CONFLICT")).toBe(true);
    const tied = normalizeEvent(candidate({ intervalScope: "process_runtime", intervalTimingEvidence: "source_reported" }), context);
    expect(tied.event?.durationMs).toBeNull();
    expect(tied.event?.timingEvidence).toBe("unknown");
    expect(tied.event?.intervalScope).toBe("unknown");
    expect(tied.event?.intervalTimingEvidence).toBe("unknown");
    expect(tied.diagnostics.some((d) => d.code === "TIMING_CONFLICT")).toBe(true);
  });
  it("keeps unknown, pending, and duration-only values separate from zero", () => {
    const pending = normalizeEvent(candidate({ status: "pending" }), context).event;
    expect(pending?.endAt).toBeNull(); expect(pending?.durationMs).toBeNull();
    const unknown = normalizeEvent(candidate({ durationMs: -2, startAt: null, endAt: null, status: undefined }), context).event;
    expect(unknown?.durationMs).toBeNull(); expect(unknown?.status).toBe("unknown");
    const only = normalizeEvent(candidate({ startAt: null, endAt: null }), context).event;
    expect(only?.durationMs).toBe(8000); expect(only?.intervalScope).toBe("unknown");
  });
  it("rejects reversed/invalid calendars without filling missing timing", () => {
    expect(normalizeEvent(candidate({ startAt: "2026-02-30T00:00:00.000Z" }), context).event?.startAt).toBeNull();
    const reverse = normalizeEvent(candidate({ endAt: "2026-08-31T00:00:00.000Z" }), context);
    expect(reverse.event?.startAt).toBeNull();
    expect(reverse.event?.endAt).toBeNull();
    expect(reverse.diagnostics.some((d) => d.code === "INVALID_TIMING")).toBe(true);
  });
  it.each([
    ["rg missing src", 1, "completed", "no_match"],
    ["rg missing src", 2, "failed", "error"],
    ["git diff --exit-code", 1, "completed", "change_detected"],
    ["git diff -- --exit-code", 1, "unknown", "unknown"],
    ["git diff --output --exit-code", 1, "unknown", "unknown"],
    ["git diff --src-prefix --exit-code", 1, "unknown", "unknown"],
    ["git diff --no-index alpha beta", 1, "unknown", "unknown"],
    ["rg missing src && npm test", 1, "unknown", "unknown"],
    ["madeup-program alpha", 1, "unknown", "unknown"],
  ])("uses parsed command exit policy instead of display: %s", (command, exitCode, status, outcome) => {
    const event = normalizeEvent(candidate({ command, exitCode, status: "failed", statusEvidence: "exit_code" }), context).event;
    expect(event?.status).toBe(status);
    expect(event?.executionOutcome).toBe(outcome);
  });
  it("preserves verified explicit statuses and does not infer a missing status", () => {
    expect(normalizeEvent(candidate({ command: "madeup-program", exitCode: 1, status: "failed" }), context).event?.status).toBe("failed");
    expect(normalizeEvent(candidate({ statusEvidence: undefined }), context).event?.status).toBe("unknown");
  });
  it("keeps stream identities distinct and rejects explicit cross-stream parent links", () => {
    const main = normalizeEvent(candidate(), context).event!;
    const child = normalizeEvent(candidate({ sessionIdentity: "synthetic-sidechain", parentEventIdentity: "synthetic-event", parentStreamIdentity: "synthetic-session" }), context);
    expect(child.event?.id).not.toEqual(main.id);
    expect(child.event?.parentEventId).toBeNull();
    expect(child.diagnostics.some((d) => d.code === "UNSUPPORTED_PARENT_RELATION")).toBe(true);
  });
  it("makes lookup/content/error identity before discarding raw, keeping range and changes distinct", () => {
    const raw = candidate({ kind: "file_read", command: undefined, operationParts: ["Read", "a.ts"], filePath: "a.ts", lookupRange: { startLine: 1, endLine: 10 }, observedContent: sentinel, contentState: "complete", changeState: "unchanged" });
    const a = normalizeEvent(raw, context).event!;
    const b = normalizeEvent({ ...raw, lookupRange: { startLine: 11, endLine: 20 } }, context).event!;
    const c = normalizeEvent({ ...raw, observedContent: "new synthetic content", changeState: "changed" }, context).event!;
    expect(a.fileFingerprint).toEqual(b.fileFingerprint);
    expect(a.lookupKey).not.toEqual(b.lookupKey);
    expect(a.contentFingerprint).not.toEqual(c.contentFingerprint);
    expect(JSON.stringify(a)).not.toContain(sentinel);
    expect(normalizeEvent({ ...raw, contentState: "truncated" }, context).event?.contentFingerprint).toBeNull();
    const error = candidate({ status: "failed", errorClass: "tool_error", errorCode: "SYNTHETIC_FAILURE", errorMessage: sentinel });
    expect(normalizeEvent(error, context).event?.errorFingerprint).not.toBeNull();
    expect(normalizeEvent(error, context).event?.errorFingerprint).not.toEqual(normalizeEvent({ ...error, errorMessage: sentinel + " changed" }, context).event?.errorFingerprint);
  });
  it("never emits original errors, paths, or invalid candidate fields in diagnostics", () => {
    expect(normalizeEvent({ provider: sentinel }, context)).toEqual({ event: null, diagnostics: [diagnostic("INVALID_RECORD")] });
    expect(JSON.stringify(safeErrorEnvelope(new Error(`/secret/${sentinel}`)))).not.toContain(sentinel);
    expect(diagnostic("INVALID_JSON", `/secret/${sentinel}`, -2)).toEqual({ code: "INVALID_JSON", severity: "warning", sourceAlias: null, byteOffset: null });
    expect(diagnostic(sentinel as never, "source-secret").code).toBe("INTERNAL_ERROR");
    expect(diagnostic("INVALID_JSON", "source-secret").sourceAlias).toBeNull();
    expect(safeErrorEnvelope(new SafeError(sentinel as never)).error.code).toBe("INTERNAL_ERROR");
  });
  it("separates key versions/domains and validates domains at runtime", () => {
    const a = context.fingerprint("operation", [sentinel]);
    const other = createIdentityContext(new Uint8Array(32).fill(8), "1".repeat(32)).fingerprint("operation", [sentinel]);
    expect(comparableIdentities(a, other)).toBe(false);
    expect(comparableIdentities(a, context.fingerprint("file", [sentinel]))).toBe(false);
    expect(comparableIdentities(a, context.fingerprint("operation", ["other"]))).toBe(true);
    expect(() => context.fingerprint(sentinel as never, [])).toThrow("required safe normalization");
    expect(JSON.stringify(context)).not.toContain("secret");
  });
});
