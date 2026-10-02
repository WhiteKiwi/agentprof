import { deepStrictEqual, strictEqual, ok } from "node:assert/strict";

type ProcessResult = Readonly<{ status: number | null; stdout: string; stderr: string }>;
type View = "scan" | "list" | "summary" | "insights" | "failures" | "read_revisits";
type JsonObject = Record<string, unknown>;
type JsonPath = readonly (string | number)[];

function object(value: unknown): JsonObject {
  ok(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as JsonObject;
}
function selection(args: readonly string[]): { view: View; json: boolean } {
  const json = args.at(-1) === "--json", command = json ? args.slice(0, -1) : args;
  ok(!command.includes("--json"));
  if (command.length === 3 && command[0] === "scan" && command[1] === "--claude-root" && command[2]) return { view: "scan", json };
  if (command.length === 2 && command[0] === "stats" && command[1] === "--list-sources") return { view: "list", json };
  if (command.length === 3 && command[1] === "--source" && command[2]) {
    if (command[0] === "stats") return { view: "summary", json };
    if (command[0] === "insights") return { view: "insights", json };
  }
  if (command.length === 4 && command[0] === "stats") {
    const flag = command[1] === "--source" && command[2] ? command[3]
      : command[2] === "--source" && command[3] ? command[1] : null;
    if (flag === "--failures") return { view: "failures", json };
    if (flag === "--read-revisits") return { view: "read_revisits", json };
  }
  throw new Error("Unrecognized historical CLI parity selection");
}
// Enumerate historical version locations without changing values or reading candidate JSON.
function versionPaths(value: unknown, path: JsonPath = []): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => versionPaths(item, [...path, index]));
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) => [
    ...(key === "parserVersion" ? [JSON.stringify([...path, key])] : []),
    ...versionPaths(item, [...path, key]),
  ]);
}
function promote(value: JsonObject): void {
  strictEqual(value["provider"], "claude");
  strictEqual(value["parserVersion"], 1);
  value["parserVersion"] = 2;
}
function expectedJson(stdout: string, view: View): string {
  const envelope = object(JSON.parse(stdout));
  // Reserialization must not launder whitespace, duplicate keys, escapes or key ordering.
  strictEqual(JSON.stringify(envelope) + "\n", stdout);
  strictEqual(envelope["schema"], "agentprof.cli/v1");
  strictEqual(envelope["command"], view === "scan" ? "scan" : view === "insights" ? "insights" : "stats");
  const result = object(envelope["result"]), paths: JsonPath[] = [];
  const capabilityPath = (prefix: JsonPath) => paths.push([...prefix, "capabilities", "parserVersion"]);
  if (view === "scan") {
    const sources = result["sources"];
    ok(Array.isArray(sources)); strictEqual(sources.length, 1);
    const source = object(sources[0]); strictEqual(source["provider"], "claude");
    capabilityPath(["result", "sources", 0]);
  } else if (view === "list") {
    strictEqual(result["mode"], "list_sources");
    strictEqual(object(result["catalogue"])["schema"], "agentprof.source-catalogue/v1");
  } else if (view === "summary") {
    strictEqual(result["mode"], "selected_source");
    const summary = object(result["summary"]);
    strictEqual(summary["schema"], "agentprof.source-summary/v1"); strictEqual(summary["provider"], "claude");
    capabilityPath(["result", "summary"]);
  } else {
    const mode = view === "insights" ? "selected_source" : view === "failures" ? "selected_source_failures" : "selected_source_read_revisits";
    const schema = view === "insights" ? "agentprof.source-slow-tool/v1" : view === "failures" ? "agentprof.source-failures/v1" : "agentprof.source-read-revisits/v1";
    strictEqual(result["mode"], mode); strictEqual(object(result["analysis"])["schema"], schema);
    paths.push(["result", "analysis", "parserVersion"]); capabilityPath(["result", "analysis"]);
  }
  // A new version-bearing location needs a new reviewed exception, including in list output.
  deepStrictEqual(versionPaths(envelope).sort(), paths.map(path => JSON.stringify(path)).sort());
  if (view === "scan") promote(object(object((result["sources"] as unknown[])[0])["capabilities"]));
  else if (view === "summary") promote(object(object(result["summary"])["capabilities"]));
  else if (view !== "list") {
    const analysis = object(result["analysis"]);
    promote(analysis); promote(object(analysis["capabilities"]));
  }
  return JSON.stringify(envelope) + "\n";
}
function versionLine(stdout: string, line: RegExp): string {
  const matches = [...stdout.matchAll(line)]; strictEqual(matches.length, 1);
  const match = matches[0]!;
  return stdout.slice(0, match.index) + match[1] + "2" + (match[2] ?? "") + stdout.slice(match.index + match[0].length);
}
function expectedHuman(stdout: string, view: View): string {
  if (view === "scan" || view === "list") return stdout;
  const titles = { summary: "AgentProf stored source-prefix stats", insights: "AgentProf stored source-prefix insights",
    failures: "AgentProf confirmed source-local failure evidence", read_revisits: "AgentProf completed source-local Read revisits" };
  ok(stdout.startsWith(titles[view] + "\n"));
  if (view === "summary") return versionLine(stdout, /^(Support: shape_verified_only; coverage: (?:recognized_shapes|partial); parser version: )1$/gm);
  if (view === "insights") {
    const primary = versionLine(stdout, /^(Versions: parser=)1(; normalization=1; key=1)$/gm);
    return versionLine(primary, /^(Support: shape_verified_only; coverage: (?:recognized_shapes|partial); capability parser version=)1$/gm);
  }
  if (view === "failures") return versionLine(stdout, /^(Parser\/normalization\/key=)1(\/1\/1; support=shape_verified_only; no freshness or cross-source check)$/gm);
  return versionLine(stdout, /^(Assessment=(?:suppressed|unavailable|partial|evaluated); suppression=[a-z_]+; parser\/normalization\/key=)1(\/1\/1)$/gm);
}

/** Fresh Claude fixtures may change only these historical 1 -> 2 version fields/lines. */
export function assertFreshParserVersionParity(provider: "codex" | "claude", args: readonly string[], current: ProcessResult, historical: ProcessResult): void {
  if (provider === "codex") { deepStrictEqual(current, historical); return; }
  const { view, json } = selection(args);
  const stdout = json ? expectedJson(historical.stdout, view) : expectedHuman(historical.stdout, view);
  deepStrictEqual(current, { ...historical, stdout });
}
