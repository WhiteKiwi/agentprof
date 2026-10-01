import type { EventKind } from "../../normalize/types.js";

export function tool(name: unknown): Readonly<{ kind: EventKind; name: string; callKind: "bash" | "agent" | "tool" }> {
  if (name === "Bash") return { kind: "shell", name: "Bash", callKind: "bash" };
  if (name === "Read") return { kind: "file_read", name: "Read", callKind: "tool" };
  if (name === "Write") return { kind: "file_write", name: "Write", callKind: "tool" };
  if (name === "Edit" || name === "MultiEdit") return { kind: "file_edit", name: "Edit", callKind: "tool" };
  if (name === "Grep" || name === "Glob") return { kind: "search", name: name, callKind: "tool" };
  if (name === "Agent" || name === "Task") return { kind: "subagent", name: "other", callKind: "agent" };
  if (name === "Skill") return { kind: "skill", name: "other", callKind: "tool" };
  if (name === "WebFetch" || name === "WebSearch") return { kind: "browser", name: "browser", callKind: "tool" };
  if (typeof name === "string" && name.startsWith("mcp__")) return { kind: "mcp", name: "mcp", callKind: "tool" };
  return { kind: "other", name: "other", callKind: "tool" };
}
