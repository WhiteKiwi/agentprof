import { evidenceOmitted, observedErrorFingerprint } from "../pattern-evidence.js";
import type { IdentityContext } from "../../normalize/identity.js";
import { exitCode, field, integer, jsonObject, object, text } from "./fields.js";

export type SafeOutput = Readonly<{
  exitCode: number | null;
  processKey: string | null;
  running: boolean;
  cancelled: boolean;
  isError: boolean | null;
  contentFingerprint: string | null;
  errorFingerprint: string | null;
  contentState: "complete" | "truncated" | "unknown";
  metadataVerified: boolean;
  invalidMetadata: boolean;
}>;

export function processKey(value: unknown, streamId: string, context: IdentityContext): string | null {
  const id = typeof value === "string" ? text(value, 4096) : integer(value) === null ? null : String(value);
  return id === null ? null : context.fingerprint("event", ["codex", streamId, "process", id]);
}

// The whole body is keyed while it is in this record; no body text enters pairing state.
function content(output: unknown, context: IdentityContext, verifiedComplete: boolean): Pick<SafeOutput, "contentFingerprint" | "contentState"> {
  if (!verifiedComplete) return { contentFingerprint: null, contentState: "unknown" };
  if (typeof output === "string") return { contentFingerprint: context.fingerprint("content", [output]), contentState: "complete" };
  if (Array.isArray(output) && output.length <= 4096) {
    const blocks: string[] = [];
    let complete = true;
    for (const block of output) {
      const type = field(block, "type");
      if (type === "text" || type === "input_text") {
        const value = field(block, "text");
        if (typeof value !== "string") complete = false;
        else blocks.push(value);
      } else complete = false; // Images/unknown blocks are neither text nor complete text evidence.
    }
    return { contentFingerprint: complete ? context.fingerprint("content", [blocks]) : null, contentState: complete ? "complete" : "unknown" };
  }
  return { contentFingerprint: null, contentState: "unknown" };
}

// Strict direct unified-exec prefix. Everything after Output: is opaque.
function directHeader(value: string): Record<string, unknown> | null {
  const boundary = value.indexOf("\nOutput:\n");
  const emptyBoundary = value.endsWith("\nOutput:") ? value.length - "\nOutput:".length : -1;
  const end = boundary >= 0 ? boundary : emptyBoundary;
  if (end < 0 || end > 8192) return null;
  const lines = value.slice(0, end).split("\n");
  let cursor = 0;
  const result: Record<string, unknown> = {};
  if (/^Chunk ID: [A-Za-z0-9_-]{1,128}$/.test(lines[cursor] ?? "")) cursor++;
  if (!/^Wall time: (?:\d+(?:\.\d+)?) seconds$/.test(lines[cursor] ?? "")) return null;
  cursor++;
  const exited = /^Process exited with code (-?\d+)$/.exec(lines[cursor] ?? "");
  if (exited) { result.exit_code = Number(exited[1]); cursor++; }
  const running = /^Process running with session ID ([A-Za-z0-9_-]{1,128})$/.exec(lines[cursor] ?? "");
  if (running) { result.session_id = running[1]; result.running = true; cursor++; }
  if (/^Original token count: \d+$/.test(lines[cursor] ?? "")) cursor++;
  if (cursor !== lines.length || (exited !== null && running !== null)) return null;
  result.output = boundary >= 0 ? value.slice(boundary + "\nOutput:\n".length) : "";
  return result;
}

export function readOutput(input: unknown, streamId: string, context: IdentityContext, mode: "exec" | "mcp" | "other", verifiedComplete = false, patternEvidence = false): SafeOutput {
  // Only an exec result's root object/whole text block can carry exec metadata.
  let envelope: Record<string, unknown> | null = object(input) ? input : null;
  let rawContent = input;
  if (mode === "exec") {
    if (typeof input === "string") envelope = jsonObject(input) ?? directHeader(input);
    else if (Array.isArray(input) && input.length === 1 && ["text", "input_text"].includes(field(input[0], "type") as string)) {
      const value = field(input[0], "text");
      if (typeof value === "string") envelope = jsonObject(value) ?? directHeader(value);
    }
    if (envelope !== null) rawContent = field(envelope, "output") ?? field(envelope, "text");
  } else if (envelope !== null) rawContent = field(envelope, "content") ?? field(envelope, "output") ?? field(envelope, "text");
  const rawExit = mode === "exec" ? field(envelope, "exit_code") : undefined;
  const code = exitCode(rawExit);
  const process = mode === "exec" ? processKey(field(envelope, "session_id"), streamId, context) : null;
  const running = mode === "exec" && (field(envelope, "running") === true || (process !== null && code === null));
  const isError = mode === "mcp" && typeof field(envelope, "isError") === "boolean" ? field(envelope, "isError") as boolean : null;
  const truncated = field(envelope, "truncated") === true || field(envelope, "content_state") === "truncated"
    || (typeof rawContent === "string" && /^Warning: truncated output/.test(rawContent));
  const observed = truncated ? { contentFingerprint: null, contentState: "truncated" as const } : content(rawContent, context, verifiedComplete);
  const invalidMetadata = rawExit !== undefined && code === null || (field(envelope, "session_id") !== undefined && process === null && mode === "exec") || (running && code !== null);
  return Object.freeze({ exitCode: code, processKey: process, running,
    cancelled: mode === "exec" && field(envelope, "status") === "cancelled",
    isError, ...observed,
    errorFingerprint: patternEvidence && !invalidMetadata && !running && field(envelope, "status") !== "cancelled" && !truncated && !evidenceOmitted(envelope)
      && (mode === "mcp" && isError === true || mode === "exec" && code !== null && code !== 0)
      ? observedErrorFingerprint(context, "codex", mode === "exec" ? "process_exit" : "tool_error", rawContent, mode === "exec" ? code : null)
      : isError === true && observed.contentFingerprint !== null ? context.fingerprint("error", ["tool_error", observed.contentFingerprint]) : null,
    metadataVerified: mode === "exec" ? envelope !== null && (code !== null || process !== null || field(envelope, "status") === "cancelled") : isError !== null,
    invalidMetadata });
}
