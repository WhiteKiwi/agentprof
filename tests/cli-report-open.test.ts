/** Proposed executable tests: copy into qualified composed checkout/tests only after root approval.
 * Future workflow exports: runReportAndOpen, formatReportAndOpenResult, reportAndOpenExitCode.
 * Missing-feature red executed against composed foundation; production workflow does not yet exist.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ report: vi.fn(), open: vi.fn() }));
vi.mock("../src/cli/report.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/cli/report.js")>(), runReport: mocks.report,
}));
vi.mock("../src/cli/open.js", () => ({ runOpen: mocks.open }));
import { SafeError } from "../src/privacy/diagnostics.js";
import { runReportAndOpen, formatReportAndOpenResult, reportAndOpenExitCode } from "../src/cli/report-open.js";
const source = `h1:${"a".repeat(32)}:source:${"b".repeat(64)}`;
const publication = Object.freeze({ mode: "selected_source", sourceId: source, revision: 7,
  output: "/tmp/report with spaces.html", published: true, bytes: 201, durability: "synced",
  cleanup: "removed", targetVerification: "verified", status: "published", warnings: Object.freeze([]) });
// Syntactically valid synthetic identity; no real store or user data.
// Real CLI tests must also use scan-generated identities and verify key binding.
const args = Object.freeze({ source, output: "relative.html" });
const accepted = Object.freeze({ status: "accepted", opener: "xdg-open", browserVerified: false });
// Independently spell the established human receipt; never derive expected bytes from production formatter.
function expectHumanReceipt(result: Awaited<ReturnType<typeof runReportAndOpen>>) {
  const prefix = `AgentProf report ${result.status}\nOutput: ${result.output}\nSource: ${result.sourceId} | revision: ${result.revision}\nBytes: ${result.bytes} | published: true | target: ${result.targetVerification}\nDurability: ${result.durability} | temporary cleanup: ${result.cleanup}\nWarnings: ${result.warnings.join(", ") || "none"}\n`;
  const human = formatReportAndOpenResult(result, false);
  expect(human.slice(0, prefix.length)).toBe(prefix);
  expect(human.toLowerCase()).toContain("browser rendering is not verified");
  expect(human.match(/AgentProf report /g)).toHaveLength(1);
  return human;
}
beforeEach(() => { mocks.report.mockReset().mockResolvedValue(publication); mocks.open.mockReset().mockResolvedValue(accepted); });
describe("stored-source report publication then explicit opening", () => {
  it.each([
    [{ output: "relative.html" }, "REPORT_SELECTION_REQUIRED"],
    [{ source }, "REPORT_SELECTION_REQUIRED"],
    [{ source: "invalid", output: "relative.html" }, "INVALID_ARGUMENT"],
    [{ source, output: "relative.txt" }, "OPEN_FILE_UNSAFE"],
    [{ source, output: "relative.html", codexRoot: ["/tmp/input"] }, "INVALID_ARGUMENT"],
    [{ source, output: "relative.html", claudeRoot: ["/tmp/input"] }, "INVALID_ARGUMENT"],
    [{ output: "relative.txt" }, "OPEN_FILE_UNSAFE"],
    [{ source, output: "bad\\uD800.html".replace("\\uD800", String.fromCharCode(0xD800)) }, "INVALID_ARGUMENT"],
  ] as const)("rejects invalid opt-in arguments before report I/O: %j", async (options, code) => {
    await expect(runReportAndOpen(options)).rejects.toMatchObject({ code });
    expect(mocks.report).not.toHaveBeenCalled(); expect(mocks.open).not.toHaveBeenCalled();
  });
  it("waits for completed publication and opens its exact canonical output once", async () => {
    let release!: (value: typeof publication) => void;
    mocks.report.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const pending = runReportAndOpen(args);
    await Promise.resolve(); expect(mocks.open).not.toHaveBeenCalled();
    release(publication); const result = await pending; expectHumanReceipt(result);
    expect(mocks.report).toHaveBeenCalledExactlyOnceWith(args);
    expect(mocks.open).toHaveBeenCalledExactlyOnceWith({ file: publication.output });
    expect(result).toEqual({ ...publication, open: accepted });
    expect(reportAndOpenExitCode(result)).toBe(0);
  });
  it("propagates prepublication failure without opening", async () => {
    const error = new SafeError("REPORT_OUTPUT_UNSAFE"); mocks.report.mockRejectedValue(error);
    await expect(runReportAndOpen(args)).rejects.toBe(error);
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it.each([
    ["temporary_cleanup_failed", "synced", "retained"],
    ["directory_sync_unsupported", "unsupported", "removed"],
    ["directory_sync_failed", "unconfirmed", "removed"],
    ["directory_close_failed", "synced", "removed"],
  ])("opens verified publication with %s but retains warning outcome", async (warning, durability, cleanup) => {
    const receipt = Object.freeze({ ...publication, status: "published_with_warning", durability, cleanup, warnings: Object.freeze([warning]) });
    mocks.report.mockResolvedValue(receipt);
    const result = await runReportAndOpen(args); expectHumanReceipt(result);
    expect(result).toEqual({ ...receipt, open: accepted });
    expect(mocks.open).toHaveBeenCalledExactlyOnceWith({ file: publication.output });
    expect(reportAndOpenExitCode(result)).toBe(1);
    expect(JSON.parse(formatReportAndOpenResult(result, true)).ok).toBe(false);
  });
  it.each([
    ["temporary_cleanup_failed", "synced", "retained"],
    ["directory_sync_unsupported", "unsupported", "removed"],
    ["directory_sync_failed", "unconfirmed", "removed"],
    ["directory_close_failed", "synced", "removed"],
  ])("retains writer warning %s together with failed or timed-out opening", async (warning, durability, cleanup) => {
    const receipt = Object.freeze({ ...publication, status: "published_with_warning", durability, cleanup, warnings: Object.freeze([warning]) });
    for (const [code, message] of [
      ["OPEN_FAILED", "The system did not accept the open request. Open the selected HTML file manually."],
      ["OPEN_TIMEOUT", "Could not confirm the open request before the timeout; the file may already be open."],
    ] as const) {
      mocks.report.mockReset().mockResolvedValue(receipt); mocks.open.mockReset().mockRejectedValue(new SafeError(code));
      const result = await runReportAndOpen(args); const human = expectHumanReceipt(result);
      expect(result).toEqual({ ...receipt, open: { status: "failed", error: { code, message }, browserVerified: false } });
      expect(JSON.parse(formatReportAndOpenResult(result, true))).toEqual({ schema: "agentprof.cli/v1", ok: false, command: "report", result });
      expect(reportAndOpenExitCode(result)).toBe(1);
      expect(human).toContain(message);
      expect(mocks.report).toHaveBeenCalledTimes(1); expect(mocks.open).toHaveBeenCalledExactlyOnceWith({ file: receipt.output });
    }
  });
  it("never opens an unverified published target and keeps its actual receipt", async () => {
    const receipt = Object.freeze({ ...publication, targetVerification: "unconfirmed", status: "published_with_warning", warnings: Object.freeze(["target_verification_failed"]) });
    mocks.report.mockResolvedValue(receipt); const result = await runReportAndOpen(args); expectHumanReceipt(result);
    expect(mocks.open).not.toHaveBeenCalled();
    expect(result).toEqual({ ...receipt, open: { status: "skipped", reason: "target_unverified", browserVerified: false } });
    expect(reportAndOpenExitCode(result)).toBe(1);
  });
  it.each(["OPEN_FILE_UNSAFE", "OPEN_FILE_UNAVAILABLE", "OPEN_OPENER_UNAVAILABLE", "OPEN_FAILED", "OPEN_TIMEOUT", "UNSUPPORTED_PLATFORM"] as const)("retains publication on %s, with no retry", async code => {
    const error = new SafeError(code); mocks.open.mockRejectedValue(error);
    const result = await runReportAndOpen(args); expectHumanReceipt(result);
    expect(result).toEqual({ ...publication, open: { status: "failed", error: { code, message: error.message }, browserVerified: false } });
    expect(mocks.open).toHaveBeenCalledTimes(1); expect(mocks.report).toHaveBeenCalledTimes(1);
    expect(reportAndOpenExitCode(result)).toBe(1);
    const json = formatReportAndOpenResult(result, true);
    expect(json.split("\n")).toHaveLength(2);
    expect(JSON.parse(json)).toEqual({ schema: "agentprof.cli/v1", ok: false, command: "report", result });
    const human = formatReportAndOpenResult(result, false);
    expect(human).toContain(publication.output); expect(human).toContain("published: true");
    if (code === "OPEN_TIMEOUT") expect(human).toContain("may already be open");
  });
  it.each(["mutated_safe_error", "forged_plain_object"])("never serializes supplied error.message from %s", async kind => {
    const error = kind === "mutated_safe_error" ? new SafeError("OPEN_FAILED") : { code: "OPEN_FAILED", message: "PRIVATE_ERROR_SENTINEL" };
    error.message = "PRIVATE_ERROR_SENTINEL";
    mocks.open.mockRejectedValue(error);
    const result = await runReportAndOpen(args); expectHumanReceipt(result);
    expect(result.open).toEqual({ status: "failed", error: kind === "mutated_safe_error"
      ? { code: "OPEN_FAILED", message: "The system did not accept the open request. Open the selected HTML file manually." }
      : { code: "INTERNAL_ERROR", message: "The operation could not be completed." }, browserVerified: false });
    for (const json of [true, false]) expect(formatReportAndOpenResult(result, json)).not.toContain("PRIVATE_ERROR_SENTINEL");
    expect(result.output).toBe(publication.output); expect(result.published).toBe(true);
  });
  it("sanitizes unexpected postpublication failures without losing output", async () => {
    mocks.open.mockRejectedValue(new Error("PRIVATE_RAW_SENTINEL /private/sensitive/path"));
    const result = await runReportAndOpen(args); expectHumanReceipt(result);
    expect(result.published).toBe(true); expect(result.output).toBe(publication.output);
    expect(result.open).toEqual({ status: "failed", error: { code: "INTERNAL_ERROR", message: "The operation could not be completed." }, browserVerified: false });
    expect(formatReportAndOpenResult(result, true)).not.toContain("PRIVATE_RAW_SENTINEL");
    expect(formatReportAndOpenResult(result, false)).not.toContain("PRIVATE_RAW_SENTINEL");
  });
});
