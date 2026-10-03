import type { IdentityContext, IdentityPart } from "../../normalize/identity.js";
import { evidenceArray, evidenceField as field, evidenceObject, evidenceOmitted, evidenceText, hasTruncationMarker, PATTERN_TEXT_BYTES } from "../pattern-evidence.js";

export type ClaudeFileEvidence = Readonly<{
  kind: "read" | "mutation";
  fileFingerprint: string;
  contentFingerprint: string | null;
  mutationFingerprint: string | null;
  range: Readonly<{ startLine: number; endLine: number }> | null;
}>;
const integer = (v: unknown, minimum = 0): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= minimum && !Object.is(v, -0);

/** A counted structured patch proves a reported delta, not project-wide validation. */
function changedPatch(value: unknown, context: IdentityContext): string | null {
  const patches = evidenceArray(value, 256);
  if (patches === null || patches.length === 0) return null;
  let bytes = 0, changed = false, oldEnd = -1, newEnd = -1;
  const fingerprintParts: IdentityPart[] = [];
  for (const patch of patches) {
    if (!evidenceObject(patch)) return null;
    const os = field(patch, "oldStart"), ns = field(patch, "newStart"), on = field(patch, "oldLines"), nn = field(patch, "newLines");
    if (!integer(os) || !integer(ns) || !integer(on) || !integer(nn)
      || !Number.isSafeInteger(os + on) || !Number.isSafeInteger(ns + nn)
      || os < oldEnd || ns < newEnd || on > 0 && os === 0 || nn > 0 && ns === 0) return null;
    const lines = evidenceArray(field(patch, "lines"), 4096);
    if (lines === null) return null;
    const removed: string[] = [], added: string[] = [];
    let oldN = 0, newN = 0;
    for (const line of lines) {
      if (!evidenceText(line) || (bytes += Buffer.byteLength(line)) > PATTERN_TEXT_BYTES || hasTruncationMarker(line)) return null;
      if (line === "\\ No newline at end of file") continue;
      if (line.startsWith(" ")) { oldN++; newN++; }
      else if (line.startsWith("-")) { oldN++; removed.push(line.slice(1)); }
      else if (line.startsWith("+")) { newN++; added.push(line.slice(1)); }
      else return null;
    }
    if (oldN !== on || newN !== nn) return null;
    if (JSON.stringify(removed) !== JSON.stringify(added)) changed = true;
    fingerprintParts.push([os, on, ns, nn, lines as string[]]);
    oldEnd = os + on; newEnd = ns + nn;
  }
  return changed ? context.fingerprint("content", ["claude_structured_patch/v1", fingerprintParts]) : null;
}
/** Only hashed result metadata is returned; caller must match it to the actual tool call. */
export function extractClaudeFileEvidence(root: unknown, version: unknown, project: string | null,
  context: IdentityContext): ClaudeFileEvidence | null {
  if (project === null || typeof version !== "string" || !/^2\.\d{1,6}\.\d{1,6}$/.test(version)
    || !evidenceObject(root) || evidenceOmitted(root)
    || field(root, "backgroundTaskId") !== undefined || field(root, "isAsync") === true
    || Object.hasOwn(root, "status") && !["completed", "success"].includes(field(root, "status") as string)
    || Object.hasOwn(root, "success") && field(root, "success") !== true) return null;
  const file = field(root, "file");
  if (field(root, "type") === "text") {
    if (!evidenceObject(file) || evidenceOmitted(file)) return null;
    const path = field(file, "filePath"), text = field(file, "content");
    const start = field(file, "startLine"), n = field(file, "numLines"), total = field(file, "totalLines");
    if (typeof path !== "string" || !path || path.length > 4096 || /[\0\r\n]/.test(path)
      || !evidenceText(text) || hasTruncationMarker(text)
      || !integer(start, 1) || !integer(n, 1) || !integer(total, 1)
      || !Number.isSafeInteger(start + n - 1) || start + n - 1 > total) return null;
    // The producer supplies range counts. A missing/extra line cannot be called complete.
    const lineN = text.length === 0 ? 0 : text.split("\n").length - Number(text.endsWith("\n"));
    if (lineN !== n) return null;
    return Object.freeze({ kind: "read", fileFingerprint: context.fingerprint("file", ["claude", project, path]),
      contentFingerprint: context.fingerprint("content", ["claude_read_range/v1", text]), mutationFingerprint: null,
      range: Object.freeze({ startLine: start, endLine: start + n - 1 }) });
  }
  const path = field(root, "filePath");
  if (typeof path !== "string" || !path || path.length > 4096 || /[\0\r\n]/.test(path) ) return null;
  const mutationFingerprint = changedPatch(field(root, "structuredPatch"), context);
  if (mutationFingerprint === null) return null;
  return Object.freeze({ kind: "mutation", fileFingerprint: context.fingerprint("file", ["claude", project, path]), contentFingerprint: null, mutationFingerprint, range: null });
}
