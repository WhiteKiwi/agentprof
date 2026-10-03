/** Refreshed precode oracle on local dependency tree 26922e5b. Collection fails
 * specifically because report-fresh.ts is absent; no selector cases ran.
 * Future pure selection seam:
 * selectFreshReportGeneration(scan, provider) -> {sourceId, revision} | null.
 * Null means the wrapper retains the scan receipt and skips reporting.
 * Tests deliberately supply impossible receipts to exercise fail-closed routing.
 */
import { describe, expect, it } from "vitest";
import type { ScanResult } from "../src/scanner/scan-run.js";
import { selectFreshReportGeneration } from "../src/cli/report-fresh.js";
const sourceId = `h1:${"a".repeat(32)}:source:${"b".repeat(64)}`;
const outcome = Object.freeze({ sourceId, sourceAlias: "source-1", provider: "claude",
  status: "committed", revisionRead: true, expectedRevision: null, committedRevision: 7,
  reusedRevision: null, staleActualRevision: null, rejectionReason: null, errorCode: null,
  ingestionScope: "events_and_metric_evidence", capabilities: null });
const counts = Object.freeze({ discovered: 1, attempted: 1, committed: 1, unchanged: 0,
  rejected: 0, stale: 0, failed: 0, aborted: 0, duplicates: 0 });
function receipt(top: Record<string, unknown> = {}, source: Record<string, unknown> = {}, tally: Record<string, unknown> = {}): ScanResult {
  return { status: "completed", stopReason: null, discoveryTruncated: false,
    sources: [{ ...outcome, ...source }], counts: { ...counts, ...tally },
    diagnostics: { observedCount: 0, adapterDroppedCount: 0, sampleDroppedCount: 0, samples: [] },
    aggregationReady: false, parserResumeReady: false, ...top } as unknown as ScanResult;
}
describe("one successful exact fresh scan generation", () => {
  it.each(["completed", "partial"])("accepts the selected committed generation with %s scan status", status => {
    expect(selectFreshReportGeneration(receipt({ status }), "claude")).toEqual({ sourceId, revision: 7 });
  });
  it("accepts only the reused revision on an unchanged outcome", () => {
    const scan = receipt({ status: "partial" }, { status: "unchanged", committedRevision: null, reusedRevision: 7 }, { committed: 0, unchanged: 1 });
    expect(selectFreshReportGeneration(scan, "claude")).toEqual({ sourceId, revision: 7 });
  });
  it.each([0, -0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, null, "7"])("rejects invalid committed/reused token %s", revision => {
    expect(selectFreshReportGeneration(receipt({}, { committedRevision: revision }), "claude")).toBeNull();
    expect(selectFreshReportGeneration(receipt({}, { status: "unchanged", committedRevision: null, reusedRevision: revision }, { committed: 0, unchanged: 1 }), "claude")).toBeNull();
  });
  it.each([
    { committedRevision: 7, reusedRevision: 7 },
    { committedRevision: null, reusedRevision: null },
    { status: "unchanged", committedRevision: 7, reusedRevision: null },
    { status: "stale", committedRevision: 7 },
    { status: "rejected", committedRevision: 7, rejectionReason: "state_limit" },
    { provider: "codex" },
  ])("rejects contradictory or unsuccessful source outcome %j", source => {
    expect(selectFreshReportGeneration(receipt({}, source), "claude")).toBeNull();
  });
  it.each([
    { committed: 0 }, { committed: 2 }, { unchanged: 1 }, { discovered: 0 },
    { discovered: 2 }, { attempted: 0 }, { attempted: 2 }, { duplicates: 1 },
    { rejected: 1 }, { stale: 1 }, { failed: 1 }, { aborted: 1 },
  ])("rejects failure, cardinality and status/count disagreements %j", tally => {
    expect(selectFreshReportGeneration(receipt({}, {}, tally), "claude")).toBeNull();
  });
  it.each([
    { status: "aborted" }, { stopReason: "aborted" }, { stopReason: "storage_failure" },
    { stopReason: "discovery_limit" }, { discoveryTruncated: true },
    { sources: [] }, { sources: [outcome, outcome] },
  ])("rejects stopped or ambiguous scan receipt %j", top => {
    expect(selectFreshReportGeneration(receipt(top), "claude")).toBeNull();
  });
});
