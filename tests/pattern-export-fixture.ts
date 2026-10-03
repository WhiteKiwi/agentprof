import type { NormalizedEvent } from "../src/normalize/types.js";
import type { StoredSource, MetricEvidence } from "../src/db/source-store.js";
import { event, id, source, success, epoch } from "./recovery-fixture.js";

/** Positive kernel controls, not an ordinary provider-support claim. */
export const failed = (name: string, start: number, end: number, extra: Partial<NormalizedEvent> = {}) => event(name, epoch + start, epoch + end, { errorClass: "process_exit", errorFingerprint: id("error", "shared"), ...extra });
export const edited = (name: string, start: number, end: number, extra: Partial<NormalizedEvent> = {}) => event(name, epoch + start, epoch + end, { ...success, kind: "file_edit", category: "edit", toolName: "apply_patch", errorClass: null, errorFingerprint: null, ...extra });
export const validated = (name: string, start: number, end: number, passes = true, extra: Partial<NormalizedEvent> = {}) => event(name, epoch + start, epoch + end, { ...(passes ? success : {}), category: "test", operationKey: id("operation", "test"), validationScope: "targeted", errorFingerprint: passes ? null : id("error", "validation"), ...extra });
export function syntheticContextSource(): StoredSource {
  const events = Array.from({ length: 4 }, (_, i) => event(`context-${i}`, epoch + i * 3000, epoch + i * 3000 + 2000, {
    ...success, provider: "claude", kind: "file_read", category: "read", toolName: "Read", turnId: null,
    lookupKey: id("lookup", "same"), lookupRange: { startLine: 1, endLine: 10 }, contentFingerprint: id("content", "same"), contentState: "complete", changeState: "unchanged",
    errorClass: null, errorFingerprint: null, intervalScope: "invocation_latency", intervalTimingEvidence: "paired_timestamps", durationMs: 2000, durationScope: "invocation_latency", timingEvidence: "paired_timestamps",
  })).map(e => ({ ...e, sourceRef: { ...e.sourceRef, recordType: "user" as const } }));
  const observations: MetricEvidence["observations"] = events.flatMap(e => {
    const base = { eventId: e.id, sessionId: e.sessionId, turnId: null, messageId: null, usageId: null, origin: "ordinary" as const, observedUsage: null };
    return [{ ...base, id: id("source", `call-${e.id}`), representation: "call" as const, observedResult: null, sourceRef: { fileId: e.sourceRef.fileId, byteOffset: e.sourceRef.byteOffset - 1 } },
      { ...base, id: id("source", `result-${e.id}`), representation: "result" as const, observedResult: { isError: false, completionKind: "invocation_result" as const, unassignedAcknowledgement: false, observedAt: e.endAt, acknowledgementLatencyMs: null, durationMs: null, durationScope: "unknown" as const }, sourceRef: { fileId: e.sourceRef.fileId, byteOffset: e.sourceRef.byteOffset } }];
  });
  const s = source(events, observations);
  return { ...s, provider: "claude", parserVersion: 2, evidence: { ...s.evidence!, observations, capabilities: { provider: "claude", parserVersion: 2, support: "shape_verified_only", coverage: "recognized_shapes", observedShapes: ["tool_use", "tool_result"], unsupportedRecords: 0, ambiguousRecords: 0, stateLimited: false, diagnosticsDropped: 0 } } };
}
/** Ordinary parser input; intentionally has no validation-scope or error/content identity upgrade. */
export function ordinaryClaudeCycle() {
  return ["Edit", "Bash", "Bash"].flatMap((name, i) => [
    { type: "assistant", uuid: `a-${i}`, timestamp: `2026-10-03T00:00:0${i * 2}.000Z`, sessionId: "FICTITIOUS_PATTERN_EXPORT", cwd: "/FICTITIOUS_PATTERN_EXPORT_ROOT", version: "2.1.241", isSidechain: false,
      message: { id: `m-${i}`, role: "assistant", content: [{ type: "tool_use", id: `t-${i}`, name, input: name === "Edit" ? { file_path: "/FICTITIOUS_PATTERN_EXPORT_ROOT/a.ts", old_string: "FICTITIOUS_OLD", new_string: "FICTITIOUS_NEW" } : { command: "npm test" } }] } },
    { type: "user", uuid: `u-${i}`, timestamp: `2026-10-03T00:00:0${i * 2 + 1}.000Z`, sessionId: "FICTITIOUS_PATTERN_EXPORT", isSidechain: false,
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: `t-${i}`, is_error: false, content: "FICTITIOUS_OUTPUT" }] } },
  ]);
}
