import type { TokenCounts } from "../types.js";
import { field, integer, object } from "./fields.js";

export type CheckedCounts = Readonly<{ counts: TokenCounts | null; status: "complete" | "partial" | "invalid" }>;
export function tokenCounts(value: unknown, mapping: "openai_responses" | "unknown"): CheckedCounts {
  if (!object(value)) return { counts: null, status: "invalid" };
  let invalid = false;
  let partial = mapping === "unknown";
  const component = (key: string) => {
    const raw = field(value, key);
    if (raw === undefined || raw === null) { partial = true; return null; }
    const result = integer(raw);
    if (result === null) invalid = true;
    return result;
  };
  const input = component("input_tokens");
  const output = component("output_tokens");
  let cachedInput = component("cached_input_tokens");
  let cacheWriteInput = component("cache_write_input_tokens");
  let reasoningOutput = component("reasoning_output_tokens");
  let total = component("total_tokens");
  if (mapping === "openai_responses") {
    if (input !== null && cachedInput !== null && cachedInput > input) { invalid = true; cachedInput = null; }
    if (input !== null && cacheWriteInput !== null && cacheWriteInput > input) { invalid = true; cacheWriteInput = null; }
    if (input !== null && cachedInput !== null && cacheWriteInput !== null && (!Number.isSafeInteger(cachedInput + cacheWriteInput) || cachedInput + cacheWriteInput > input)) { invalid = true; cachedInput = null; cacheWriteInput = null; }
    if (output !== null && reasoningOutput !== null && reasoningOutput > output) { invalid = true; reasoningOutput = null; }
    if (input !== null && output !== null && (!Number.isSafeInteger(input + output) || (total !== null && total !== input + output))) { invalid = true; total = null; }
    if (input === null || output === null) total = null;
  } else total = null;
  return Object.freeze({ counts: Object.freeze({ input, output, cachedInput, cacheWriteInput, reasoningOutput, total }), status: invalid ? "invalid" : partial ? "partial" : "complete" });
}
export function sameCounts(a: TokenCounts | null, b: TokenCounts | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
export function decreased(a: TokenCounts, b: TokenCounts): boolean {
  return (a.input !== null && b.input !== null && b.input < a.input) || (a.output !== null && b.output !== null && b.output < a.output) || (a.total !== null && b.total !== null && b.total < a.total);
}
