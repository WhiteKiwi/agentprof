import type { NormalizedEvent } from "../src/normalize/types.js";
import type { SourceSnapshotInput, StoredSource } from "../src/db/source-store.js";
import { capabilities, id, input as tokensInput, keyId, sessionId, source as tokensSource, sourceId } from "./tokens-support.js";

export { binary, bytes, capabilities, id, invoke, keyId, persisted, read, scanned, sourceId } from "./tokens-support.js";
export const reasons = ["source_suppressed", "cancelled", "pending", "unknown_status", "missing_duration", "invalid_duration", "unknown_scope", "estimated_timing", "unknown_timing"] as const;

export function event(name = "ordinary", extra: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return { normalizationVersion: 1, keyVersion: 1, keyId, id: id("event", `time-${name}`), sessionId,
    turnId: null, parentEventId: null, provider: "codex", kind: "shell", category: "test", toolName: "exec_command", commandPattern: "npm test",
    operationKey: null, fileFingerprint: null, lookupKey: null, lookupRange: null, contentFingerprint: null, contentState: "unknown", changeState: "unknown", validationScope: "unknown",
    startAt: null, endAt: null, intervalTimingEvidence: "unknown", intervalScope: "unknown", durationMs: 1, timingEvidence: "source_reported", durationScope: "process_runtime",
    status: "completed", executionOutcome: "success", exitCode: 0, errorFingerprint: null, errorClass: null,
    sourceRef: { fileId: sourceId, byteOffset: 0, recordType: "event_msg" }, ...extra };
}
export function input(events: readonly NormalizedEvent[] = [event()], caps = capabilities): SourceSnapshotInput {
  return { ...tokensInput([], caps), events };
}
export function source(events: readonly NormalizedEvent[] = [event()], caps = capabilities): StoredSource {
  return { ...tokensSource([], caps), events };
}
export const distributions = () => [
  event("fraction-a", { durationMs: 0.1 }), event("fraction-b", { durationMs: 0.2 }),
  event("overflow-a", { category: "build", durationMs: Number.MAX_SAFE_INTEGER }), event("overflow-b", { category: "build" }),
  ...Array.from({ length: 19 }, (_, i) => event(`n19-${i}`, { category: "search", durationMs: i + 1 })),
  ...Array.from({ length: 20 }, (_, i) => event(`n20-${i}`, { category: "read", durationMs: i + 1 })),
  event("scope", { durationScope: "item_lifecycle", durationMs: 7 }), event("evidence", { timingEvidence: "paired_timestamps", durationMs: 9 }),
];
export function mixedBuckets(): NormalizedEvent[] {
  const known = [["npm test", 0], ["npm test --json", 9], ["npm test --verbose", 8], ["npm test --quiet", 8], ["npm test --watch", 7]] as const;
  const unknown = ["npm test --runInBand", "npm test --glob", "npm test --type", "npm test --files"];
  return [...known.map(([commandPattern, durationMs], i) => event(`known-${i}`, { commandPattern, durationMs })),
    ...unknown.flatMap((commandPattern, i) => [event(`unknown-max-${i}`, { commandPattern, durationMs: Number.MAX_SAFE_INTEGER }), event(`unknown-one-${i}`, { commandPattern })])];
}
export const commandFlags = ["--runInBand", "--watch", "--glob", "--type", "--fixed-strings", "--ignore-case", "--files", "--no-ignore", "--hidden", "--json", "--verbose", "--quiet"];
