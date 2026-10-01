import type { ClaudeCounts, ClaudeUsage } from "./types.js";
import { field, integer, object } from "./fields.js";

export function tokenCounts(value: unknown): Readonly<{ counts: ClaudeCounts; status: ClaudeUsage["countStatus"] }> {
  let invalid = !object(value);
  let partial = false;
  const component = (key: string) => {
    const raw = field(value, key);
    if (raw === undefined || raw === null) { partial = true; return null; }
    const number = integer(raw);
    if (number === null) invalid = true;
    return number;
  };
  const uncachedInput = component("input_tokens");
  const output = component("output_tokens");
  const cachedInput = component("cache_read_input_tokens");
  const cacheWriteInput = component("cache_creation_input_tokens");
  let input: number | null = null;
  let total: number | null = null;
  if (uncachedInput !== null && cachedInput !== null && cacheWriteInput !== null) {
    const sum = uncachedInput + cachedInput + cacheWriteInput;
    if (Number.isSafeInteger(sum)) input = sum;
    else invalid = true;
  }
  if (input !== null && output !== null) {
    const sum = input + output;
    if (Number.isSafeInteger(sum)) total = sum;
    else invalid = true;
  }
  // TTL creation buckets and unverified thinking details are not additional tokens.
  return Object.freeze({ counts: Object.freeze({ input, uncachedInput, output, cachedInput, cacheWriteInput, reasoningOutput: null, total }), status: invalid ? "invalid" : partial ? "partial" : "complete" });
}
export function sameCounts(a: ClaudeCounts | null, b: ClaudeCounts | null): boolean { return JSON.stringify(a) === JSON.stringify(b); }
export function stopReason(value: unknown): ClaudeUsage["stopReason"] { return value === null || value === undefined ? null : value === "tool_use" || value === "end_turn" ? value : "unknown"; }
