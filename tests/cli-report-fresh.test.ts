import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, existsSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ scan: vi.fn(), report: vi.fn(), open: vi.fn() }));
vi.mock("../src/cli/scan.js", async original => ({ ...await original<typeof import("../src/cli/scan.js")>(), collectScan: m.scan }));
vi.mock("../src/cli/report.js", async original => ({ ...await original<typeof import("../src/cli/report.js")>(), runReport: m.report }));
vi.mock("../src/cli/open.js", () => ({ runOpen: m.open }));
import { runFreshReport, formatFreshReportResult, freshReportExitCode } from "../src/cli/report-fresh.js";
import { SafeError } from "../src/privacy/diagnostics.js";
const id = `h1:${"a".repeat(32)}:source:${"b".repeat(64)}`;
function scan(status = "completed") { return { status, stopReason: null, discoveryTruncated: false,
  counts: { discovered: 1, attempted: 1, committed: 1, unchanged: 0, rejected: 0, stale: 0, failed: 0, aborted: 0, duplicates: 0 },
  sources: [{ sourceId: id, sourceAlias: "source-1", provider: "claude", status: "committed", revisionRead: true, expectedRevision: null, committedRevision: 7, reusedRevision: null, staleActualRevision: null, rejectionReason: null, errorCode: null, ingestionScope: "events_and_metric_evidence", capabilities: null }],
  diagnostics: { observedCount: 1, adapterDroppedCount: 2, sampleDroppedCount: 3, samples: [{ code: "INSUFFICIENT_LOOKUP_EVIDENCE", severity: "warning", sourceAlias: "source-1", byteOffset: 0 }] }, aggregationReady: false, parserResumeReady: false }; }
let root: string, args: { provider: string; input: string; output: string; dataDir: string }, publication: object, listeners: number;
beforeEach(() => {
  root = mkdtempSync(join(realpathSync(tmpdir()), "agentprof-fresh-unit-")); args = { provider: "claude", input: join(root, "PRIVATE_INPUT.jsonl"), output: join(root, "out.html"), dataDir: join(root, "private") };
  writeFileSync(args.input, "{}\n"); listeners = process.listenerCount("SIGINT");
  publication = { mode: "selected_source", sourceId: id, revision: 7, output: args.output, published: true, bytes: 123, durability: "synced", cleanup: "removed", targetVerification: "verified", status: "published", warnings: [] };
  m.scan.mockReset().mockResolvedValue(scan()); m.report.mockReset().mockResolvedValue(publication); m.open.mockReset().mockResolvedValue({ status: "accepted", opener: "xdg-open", browserVerified: false });
});
afterEach(() => { expect(process.listenerCount("SIGINT")).toBe(listeners); rmSync(root, { recursive: true, force: true }); });
describe("fresh scan/report/open orchestration", () => {
  it.each([false, true])("calls each requested phase once using only the returned generation, open=%s", async open => {
    const result = await runFreshReport({ ...args, open });
    expect(m.scan).toHaveBeenCalledExactlyOnceWith(args.dataDir, [{ provider: "claude", path: args.input }], expect.any(AbortSignal));
    expect(m.report).toHaveBeenCalledExactlyOnceWith({ dataDir: args.dataDir, source: id, output: args.output }, { expectedRevision: 7 });
    expect(m.scan.mock.invocationCallOrder[0]).toBeLessThan(m.report.mock.invocationCallOrder[0]!);
    expect(m.open).toHaveBeenCalledTimes(open ? 1 : 0);
    if (open) expect(m.report.mock.invocationCallOrder[0]).toBeLessThan(m.open.mock.invocationCallOrder[0]!);
    expect(freshReportExitCode(result)).toBe(0); expect(JSON.parse(formatFreshReportResult(result, true)).ok).toBe(true);
  });
  it.each([false, true])("preserves partial scan diagnostics and reused generation with open=%s", async open => {
    const receipt = scan("partial"); receipt.sources[0] = { ...receipt.sources[0]!, status: "unchanged", committedRevision: null, reusedRevision: 7 } as any;
    receipt.counts.committed = 0; receipt.counts.unchanged = 1; m.scan.mockResolvedValue(receipt);
    const result = await runFreshReport({ ...args, open });
    expect(result.scan).toBe(receipt); expect(freshReportExitCode(result)).toBe(1);
    expect(m.report.mock.calls[0]?.[1]).toEqual({ expectedRevision: 7 });
    expect(formatFreshReportResult(result, false)).toContain("adapter-dropped=2 sample-dropped=3");
    expect(JSON.parse(formatFreshReportResult(result, true)).ok).toBe(false);
  });
  it.each(["aborted", "discovery_limit", "storage_failure", "empty", "multiple", "duplicate", "rejected", "stale", "failed", "revision"])("retains scan receipt and skips both later phases: %s", async failure => {
    const receipt = scan("partial");
    if (["aborted", "discovery_limit", "storage_failure"].includes(failure)) receipt.stopReason = failure as any;
    if (failure === "aborted") receipt.status = "aborted";
    if (failure === "empty") receipt.sources = [];
    if (failure === "multiple") receipt.sources.push(receipt.sources[0]!);
    if (failure === "duplicate") receipt.counts.duplicates = 1;
    if (["rejected", "stale", "failed"].includes(failure)) receipt.sources[0]!.status = failure;
    if (failure === "revision") receipt.sources[0]!.committedRevision = null as any;
    m.scan.mockResolvedValue(receipt); const result = await runFreshReport({ ...args, open: true });
    expect(result.scan).toBe(receipt); expect(result.report.status).toBe("skipped"); expect(m.report).not.toHaveBeenCalled(); expect(m.open).not.toHaveBeenCalled();
    expect(freshReportExitCode(result)).toBe(failure === "aborted" ? 130 : 1);
  });
  it("abort immediately after scan keeps its commits and prevents report", async () => {
    m.scan.mockImplementation(async () => { process.emit("SIGINT"); return scan(); });
    const result = await runFreshReport({ ...args, open: true });
    expect(result.scan.counts.committed).toBe(1); expect(result.report).toEqual({ status: "skipped", reason: "aborted" }); expect(freshReportExitCode(result)).toBe(130);
    expect(m.report).not.toHaveBeenCalled(); expect(m.open).not.toHaveBeenCalled();
  });
  it.each([false, true])("abort during pending publication preserves every publication field, warning=%s", async warning => {
    const receipt = warning ? { ...publication, status: "published_with_warning", durability: "unsupported", cleanup: "unconfirmed", targetVerification: "unconfirmed", warnings: ["target_verification_failed"] } : publication;
    m.report.mockImplementation(async () => { process.emit("SIGINT"); return receipt; });
    const result = await runFreshReport({ ...args, open: true });
    expect(result.report).toEqual({ ...receipt, open: { status: "skipped", reason: "aborted", browserVerified: false } });
    expect(m.open).not.toHaveBeenCalled(); expect(freshReportExitCode(result)).toBe(130); expect(formatFreshReportResult(result, false)).toContain("workflow was aborted");
  });
  it("abort during report without open retains publication and exits 130", async () => {
    m.report.mockImplementation(async () => { process.emit("SIGINT"); return publication; });
    const result = await runFreshReport(args); expect(result.report).toEqual(publication); expect(freshReportExitCode(result)).toBe(130); expect(m.open).not.toHaveBeenCalled();
  });
  it.each(["accepted", "failed", "timeout"])("abort after opener starts retains actual %s outcome without retry", async status => {
    m.open.mockImplementation(async () => { process.emit("SIGINT"); if (status !== "accepted") throw new SafeError(status === "timeout" ? "OPEN_TIMEOUT" : "OPEN_FAILED"); return { status: "accepted", opener: "xdg-open", browserVerified: false }; });
    const result = await runFreshReport({ ...args, open: true });
    expect(result.report).toMatchObject({ ...publication, open: { status: status === "accepted" ? "accepted" : "failed" } });
    expect(m.open).toHaveBeenCalledOnce(); expect(freshReportExitCode(result)).toBe(130);
  });
  it.each(["SOURCE_REVISION_CHANGED", "REPORT_OUTPUT_UNSAFE", "raw"])("report failure %s stays one safe receipt after scan effects", async code => {
    m.report.mockRejectedValue(code === "raw" ? new Error("SECRET_RAW_PRIVATE_INPUT") : new SafeError(code as any));
    const result = await runFreshReport({ ...args, open: true });
    expect(result.scan.counts.committed).toBe(1); expect(result.report).toMatchObject({ status: "failed", error: { code: code === "raw" ? "INTERNAL_ERROR" : code } });
    const visible = formatFreshReportResult(result, true) + formatFreshReportResult(result, false);
    expect(visible).not.toContain("SECRET_RAW_PRIVATE_INPUT"); expect(m.open).not.toHaveBeenCalled(); expect(freshReportExitCode(result)).toBe(1);
  });
  it.each(["verified", "unconfirmed"])("partial plus publication warning retains %s target policy and exit 1", async targetVerification => {
    m.scan.mockResolvedValue(scan("partial")); const receipt = { ...publication, status: "published_with_warning", durability: "unsupported", warnings: ["directory_sync_unsupported"], targetVerification };
    m.report.mockResolvedValue(receipt); const result = await runFreshReport({ ...args, open: true });
    expect(result.report).toMatchObject(receipt); expect(freshReportExitCode(result)).toBe(1); expect(m.open).toHaveBeenCalledTimes(targetVerification === "verified" ? 1 : 0);
  });
  it("bootstrap failure preserves error boundary and removes owned signal listener", async () => {
    m.scan.mockRejectedValue(new SafeError("DATA_ACCESS_FAILED")); await expect(runFreshReport(args)).rejects.toMatchObject({ code: "DATA_ACCESS_FAILED" }); expect(m.report).not.toHaveBeenCalled();
  });
  it("rejects invalid combinations and stable unsafe inputs before collection/bootstrap", async () => {
    const dir = join(root, "directory.jsonl"); mkdirSync(dir); const link = join(root, "link.jsonl"); symlinkSync(args.input, link);
    for (const patch of [{ provider: "other" }, { provider: undefined }, { input: undefined }, { output: undefined }, { source: id }, { codexRoot: ["omitted"] }, { claudeRoot: ["omitted"] }, { input: dir }, { input: link }, { input: "x.jsonl.gz" }, { input: "x.txt" }, { input: "" }, { output: "x\n.html" }, { output: "x.txt", open: true }]) {
      await expect(runFreshReport({ ...args, ...patch } as any)).rejects.toBeInstanceOf(SafeError);
    }
    expect(m.scan).not.toHaveBeenCalled(); expect(existsSync(args.dataDir)).toBe(false);
  });
});
