/** Refreshed precode oracle, executed against local dependency tree 26922e5b.
 * Actual runReportAndOpen currently takes ONE argument; signal cases expose the
 * missing later fresh-input seam. The dependency implementation is unchanged.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ report: vi.fn(), open: vi.fn() }));
vi.mock("../src/cli/report.js", async original => ({
  ...await original<typeof import("../src/cli/report.js")>(), runReport: m.report,
}));
vi.mock("../src/cli/open.js", () => ({ runOpen: m.open }));
import { runReportAndOpen, formatReportAndOpenResult } from "../src/cli/report-open.js";
const args = Object.freeze({ source: `h1:${"a".repeat(32)}:source:${"b".repeat(64)}`, output: "/tmp/synthetic.html" });
const publication = Object.freeze({ mode: "selected_source", sourceId: args.source, revision: 7,
  output: args.output, published: true, bytes: 25, durability: "synced", cleanup: "removed",
  targetVerification: "verified", status: "published", warnings: Object.freeze([]) });
const accepted = Object.freeze({ status: "accepted", opener: "xdg-open", browserVerified: false });
const cancelled = Object.freeze({ status: "skipped", reason: "aborted", browserVerified: false });
beforeEach(() => { m.report.mockReset().mockResolvedValue(publication); m.open.mockReset().mockResolvedValue(accepted); });
describe("fresh-workflow signal checked after publication before opener", () => {
  it("human formatter distinguishes an aborted workflow from an unverified target", () => {
    const result = { ...publication, open: cancelled } as unknown as Parameters<typeof formatReportAndOpenResult>[0];
    const human = formatReportAndOpenResult(result, false);
    expect(human).toContain("AgentProf report published\n");
    expect(human).toContain("Output: /tmp/synthetic.html\n");
    expect(human).toContain("published: true");
    expect(human).toContain("Open request skipped: the workflow was aborted.");
    expect(human).not.toContain("the published target is unverified");
    expect(human).toContain("Browser rendering is not verified.");
    expect(m.report).not.toHaveBeenCalled(); expect(m.open).not.toHaveBeenCalled();
  });
  it.each([
    publication,
    { ...publication, status: "published_with_warning", durability: "unsupported", warnings: ["directory_sync_unsupported"] },
    { ...publication, status: "published_with_warning", targetVerification: "unconfirmed", warnings: ["target_verification_failed"] },
  ])("preserves a completed publication and skips opening on pending-publication abort", async receipt => {
    let release!: (value: typeof receipt) => void;
    let started!: () => void;
    const reportStarted = new Promise<void>(resolve => { started = resolve; });
    m.report.mockImplementation(() => { started(); return new Promise(resolve => { release = resolve; }); });
    const controller = new AbortController();
    const pending = runReportAndOpen(args, { expectedRevision: 7, signal: controller.signal });
    await reportStarted; expect(m.open).not.toHaveBeenCalled();
    controller.abort(); release(receipt);
    const result = await pending;
    expect(result).toEqual({ ...receipt, open: cancelled });
    expect(m.open).not.toHaveBeenCalled();
    expect(m.report).toHaveBeenCalledExactlyOnceWith(args, { expectedRevision: 7 });
    const json = JSON.parse(formatReportAndOpenResult(result, true));
    expect(json.ok).toBe(false); expect(json.result).toEqual(result);
    // Fresh wrapper exit 130 and listener cleanup are separate integration assertions.
  });
  it("does not cancel or retry an opener already invoked", async () => {
    let release!: (value: typeof accepted) => void;
    let started!: () => void;
    const openerStarted = new Promise<void>(resolve => { started = resolve; });
    m.open.mockImplementation(() => { started(); return new Promise(resolve => { release = resolve; }); });
    const controller = new AbortController();
    const pending = runReportAndOpen(args, { expectedRevision: 7, signal: controller.signal });
    await openerStarted; controller.abort(); release(accepted);
    expect(await pending).toEqual({ ...publication, open: accepted });
    expect(m.open).toHaveBeenCalledExactlyOnceWith({ file: publication.output });
  });
  it("keeps default stored-only behavior without the internal signal", async () => {
    expect(await runReportAndOpen(args)).toEqual({ ...publication, open: accepted });
    expect(m.report).toHaveBeenCalledExactlyOnceWith(args);
    expect(m.open).toHaveBeenCalledExactlyOnceWith({ file: publication.output });
  });
});
