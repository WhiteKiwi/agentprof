/** Refreshed precode oracle, executed against local dependency tree 26922e5b.
 * Actual runReport currently takes ONE argument; second-argument tests expose the
 * missing future revision guard. No real DB/files/opener in this unit suite.
 * This unit seam does not replace the later real two-connection concurrency test.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ snapshot: vi.fn(), read: vi.fn(), summary: vi.fn(),
  slow: vi.fn(), overlap: vi.fn(), commands: vi.fn(), timeline: vi.fn(), model: vi.fn(),
  render: vi.fn(), write: vi.fn() }));
vi.mock("../src/db/read-only.js", () => ({ withReadOnlyStore: m.snapshot }));
vi.mock("../src/db/source-store.js", () => ({ createSourceStore: () => ({ readSource: m.read }) }));
vi.mock("../src/analysis/source-summary.js", () => ({ summarizeSource: m.summary }));
vi.mock("../src/analysis/source-slow-tool.js", () => ({ analyzeSourceSlowTool: m.slow }));
vi.mock("../src/analysis/source-invocation-overlap.js", () => ({ analyzeSourceInvocationOverlap: m.overlap }));
vi.mock("../src/report/command-breakdown.js", () => ({ buildSourceCommandBreakdown: m.commands }));
vi.mock("../src/report/invocation-timeline.js", () => ({ buildSourceInvocationTimeline: m.timeline }));
vi.mock("../src/report/source-model.js", () => ({ buildSourceReportModel: m.model }));
vi.mock("../src/report/render.js", () => ({ renderSourceReport: m.render }));
vi.mock("../src/report/write-output.js", async original => ({
  ...await original<typeof import("../src/report/write-output.js")>(), writeReportOutput: m.write,
}));
import { runReport } from "../src/cli/report.js";
const key = "a".repeat(32), sourceId = `h1:${key}:source:${"b".repeat(64)}`;
const args = Object.freeze({ dataDir: "/tmp/synthetic-private", source: sourceId, output: "/tmp/synthetic.html" });
const publication = Object.freeze({ published: true, status: "published", output: args.output,
  bytes: 25, durability: "synced", cleanup: "removed", targetVerification: "verified", warnings: [] });
const stored = (revision: number) => Object.freeze({ sourceId, revision });
beforeEach(() => {
  for (const mock of Object.values(m)) mock.mockReset();
  m.snapshot.mockImplementation(async (_directory, operation) => operation({}, key));
  m.read.mockReturnValue(stored(7));
  m.summary.mockImplementation(value => value);
  m.model.mockImplementation(summary => ({ summary }));
  m.render.mockReturnValue("<html>synthetic</html>"); m.write.mockResolvedValue(publication);
});
describe("exact generation inside the report snapshot", () => {
  it.each([0, -0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1,
    "7", null, 7n, new Number(7), [], {}].map(value => ({ value })))("rejects non-positive-safe-integer revision before store I/O: $value", async ({ value }) => {
    await expect(runReport(args, { expectedRevision: value as number })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(m.snapshot).not.toHaveBeenCalled(); expect(m.write).not.toHaveBeenCalled();
  });
  it.each([1, 7, Number.MAX_SAFE_INTEGER])("accepts an exact positive safe revision %s", async revision => {
    const source = stored(revision); m.read.mockReturnValue(source);
    const result = await runReport(args, { expectedRevision: revision });
    expect(result).toEqual({ mode: "selected_source", sourceId, revision, ...publication });
    expect(m.snapshot).toHaveBeenCalledOnce(); expect(m.read).toHaveBeenCalledExactlyOnceWith(sourceId);
    expect(m.summary).toHaveBeenCalledExactlyOnceWith(source); expect(m.write).toHaveBeenCalledOnce();
  });
  it.each([6, 8])("rejects replacement rather than reporting a different revision %s", async actual => {
    m.read.mockReturnValue(stored(actual));
    await expect(runReport(args, { expectedRevision: 7 })).rejects.toMatchObject({ code: "SOURCE_REVISION_CHANGED" });
    expect(m.read).toHaveBeenCalledOnce(); expect(m.summary).not.toHaveBeenCalled();
    expect(m.model).not.toHaveBeenCalled(); expect(m.render).not.toHaveBeenCalled(); expect(m.write).not.toHaveBeenCalled();
  });
  it("does not fall back when the selected source disappears", async () => {
    m.read.mockReturnValue(null);
    await expect(runReport(args, { expectedRevision: 7 })).rejects.toMatchObject({ code: "SOURCE_NOT_FOUND" });
    expect(m.write).not.toHaveBeenCalled();
  });
  it("keeps one captured generation when a later read would differ", async () => {
    m.read.mockReturnValueOnce(stored(7)).mockReturnValue(stored(8));
    const result = await runReport(args, { expectedRevision: 7 });
    expect(result.revision).toBe(7); expect(m.read).toHaveBeenCalledOnce();
  });
  it("preserves omitted/undefined internal-option behavior", async () => {
    const original = await runReport(args);
    expect(await runReport(args, {})).toEqual(original);
    expect(await runReport(args, { expectedRevision: undefined } as unknown as { expectedRevision?: number })).toEqual(original);
  });
});
