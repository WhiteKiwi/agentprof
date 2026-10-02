import { types } from "node:util";
import { KEY_VERSION, NORMALIZATION_VERSION } from "../../normalize/identity.js";

const MAX_INPUT_BYTES = 1_048_576;
const MAX_LOOKUP_BYTES = 2 * 1024 * 1024;
// Every current file identity is 105 unescaped ASCII bytes. This value is
// length-only budget padding, never returned, fingerprinted or retained.
const LOOKUP_FRAME_PROJECT = "x".repeat(105);
const GREP_KEYS = ["pattern", "path", "glob", "output_mode", "-i", "multiline"];
const GLOB_KEYS = ["pattern", "path"];
type SearchFields = Readonly<{ searchQuery: string; searchRoot: string; searchOptions: readonly string[] }>;

/** Transient own-data extraction only. Never retain or execute provider strings. */
export function extractClaudeSearch(name: unknown, input: unknown, version: unknown, _project?: string | null): SearchFields | null {
  if ((name !== "Grep" && name !== "Glob")
    || typeof version !== "string" || version.length === 0 || version.length > 4096
    || input === null || typeof input !== "object" || types.isProxy(input) || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return null;
  const allowed = name === "Grep" ? GREP_KEYS : GLOB_KEYS;
  const names = Reflect.ownKeys(input);
  if (names.length > allowed.length || !names.includes("pattern")) return null;
  const values: Record<string, string | boolean> = Object.create(null);
  for (const key of names) {
    if (typeof key !== "string" || !allowed.includes(key)) return null;
    const d = Object.getOwnPropertyDescriptor(input, key)!;
    if (!("value" in d) || !d.enumerable) return null;
    const value: unknown = d.value;
    if (key === "-i" || key === "multiline") { if (typeof value !== "boolean") return null; }
    else if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value) > MAX_INPUT_BYTES
      || (key === "pattern" || key === "path") && value.includes("\0")
      || key === "output_mode" && !["content", "files_with_matches", "count"].includes(value)) return null;
    values[key] = value as string | boolean;
  }
  const sorted = Object.keys(values).sort();
  const encoded = `{${sorted.map(key => `${JSON.stringify(key)}:${JSON.stringify(values[key])}`).join(",")}}`;
  if (Buffer.byteLength(encoded) > MAX_INPUT_BYTES) return null;
  const options = `{${sorted.filter(key => key !== "pattern" && key !== "path").map(key => `${JSON.stringify(key)}:${JSON.stringify(values[key])}`).join(",")}}`;
  const searchQuery = values["pattern"] as string;
  const searchRoot = JSON.stringify(Object.hasOwn(values, "path") ? ["explicit_path", values["path"]] : ["record_cwd"]);
  const searchOptions = Object.freeze(["claude_native_search/v1", name, version, options]);
  // Nested JSON escaping can exceed the shared identity budget even when the
  // ordinary canonical input fits. Omit lookup evidence, not the invocation.
  const frame = JSON.stringify([NORMALIZATION_VERSION, KEY_VERSION, "lookup", "search", "claude", LOOKUP_FRAME_PROJECT, searchQuery, searchRoot, searchOptions]);
  if (Buffer.byteLength(frame) > MAX_LOOKUP_BYTES) return null;
  return Object.freeze({ searchQuery, searchRoot, searchOptions });
}
