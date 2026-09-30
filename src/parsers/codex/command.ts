import { classifyCommand } from "../../normalize/command.js";
import type { CommandClassification } from "../../normalize/command.js";
import type { IdentityContext } from "../../normalize/identity.js";
import type { ExecutionOutcome, ExecutionStatus } from "../../normalize/types.js";
import { field, jsonObject, text } from "./fields.js";

export type ExitPolicy = "rg" | "git_diff" | "unknown";
export type SafeCommand = CommandClassification & Readonly<{ transport: "string" | "argv" | "shell_lc" | "unsupported" }>;
const SHELLS = new Set(["sh", "bash", "zsh", "/bin/sh", "/bin/bash", "/bin/zsh", "/usr/bin/sh", "/usr/bin/bash", "/usr/bin/zsh"]);
export function supportedShell(value: unknown): boolean { return typeof value === "string" && SHELLS.has(value); }

export function command(input: unknown, context: IdentityContext, project: string | null): SafeCommand {
  if (Array.isArray(input) && input.length === 3 && input.every((part) => typeof part === "string") && SHELLS.has(input[0] as string) && input[1] === "-lc") {
    const classified = classifyCommand(input[2], context, "codex", project);
    return Object.freeze({ ...classified,
      // The keyed inner argv and exact transport both affect operation equality.
      operationKey: classified.operationKey === null ? null : context.fingerprint("operation", ["codex", "shell_lc", project, input[0] as string, input[1] as string, classified.operationKey]),
      transport: "shell_lc" });
  }
  if (Array.isArray(input) && (SHELLS.has(input[0] as string) || input.some((part) => part === "-lc"))) {
    return Object.freeze({ commandPattern: "shell <complex>", operationKey: null, program: null, category: "other", safeSimple: false, exitCodePolicy: "unknown", transport: "unsupported" });
  }
  const classified = classifyCommand(input, context, "codex", project);
  return Object.freeze({ ...classified, operationKey: classified.operationKey === null ? null : context.fingerprint("operation", ["codex", typeof input === "string" ? "string" : "argv", classified.operationKey]), transport: typeof input === "string" ? "string" : "argv" });
}

export function semanticExit(code: number | null, policy: ExitPolicy): Readonly<{ status: ExecutionStatus; outcome: ExecutionOutcome }> {
  if (code === 0) return { status: "completed", outcome: "success" };
  if (code === 1 && policy === "rg") return { status: "completed", outcome: "no_match" };
  if (code === 1 && policy === "git_diff") return { status: "completed", outcome: "change_detected" };
  if (code !== null && code >= 2 && policy !== "unknown") return { status: "failed", outcome: "error" };
  return { status: "unknown", outcome: "unknown" };
}

export function toolKind(name: unknown, namespace: unknown): "exec" | "poll" | "patch" | "mcp" | "wrapper" | "unknown" {
  const n = text(name, 4096);
  const ns = text(namespace, 4096);
  if (n === "exec" && (ns === null || ns === "functions")) return "wrapper";
  if (ns === null || ns === "functions") {
    if (n === "exec_command") return "exec";
    if (n === "write_stdin") return "poll";
    if (n === "apply_patch") return "patch";
  }
  if (ns !== null && /^mcp[._]/.test(ns) && n !== null) return "mcp";
  if (n !== null && /^mcp__[^_].*__[^_].*/.test(n)) return "mcp";
  return "unknown";
}
export function argumentsObject(payload: unknown): Record<string, unknown> | null {
  return jsonObject(field(payload, "arguments"));
}
