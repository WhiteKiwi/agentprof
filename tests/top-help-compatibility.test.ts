import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { temporaryDirectory } from "./helpers.js";
import { assertTopHelpDirectoryDelta } from "./top-help-compatibility.js";
import type { TopHelpReceipt } from "./top-help-compatibility.js";

const provenance = {
  repository: "WhiteKiwi/agentprof",
  sourceCommit: "4890723842cdb9d22a19da3f05f90aa5d9278807",
  actualMainCommit: "d1b84f166eb33f11d5b7a22ca407dbf14226fd24",
  tree: "97d7bc1105ccdefe0bff75a26b69ab47d10e6dbb",
  command: ["--help"],
  helpWidthColumns: 80,
  commanderVersion: "15.0.0",
  entrySha256: "2d48dfa2052410a14310d61e9f6e6f705d6e4627106f48cef80a32f48143a3e8",
  cliMainSha256: "3ebd63280f2a9686babf911fcb334b99aa1a7c80fcd7e73177b12c6261f35925",
  compiledManifestSha256: "664ec770127006bfef1e8230daad079370a86dd90163b0554092171d2cbb7aff",
  compiledManifestDigestEncoding: "UTF-8 compact JSON of relative-path/hash map, keys sorted, no trailing newline",
  compiledManifestEntries: 134,
  stdoutSha256: "6fb0d3740a4836abed7bf677c2e81870ba6ae45d43a25cd038930fdb60cd89f2",
  stdoutBytes: 1677,
  fixtureIs: "Inert exact genuine installed D1 top-help capture; not a recreated historical binary or a replacement for any named optional baseline.",
};
type Fixture = { schemaVersion: number; provenance: typeof provenance; receipt: TopHelpReceipt };
const fixturePath = fileURLToPath(new URL("./fixtures/cli/top-help-d1.json", import.meta.url));
const fixtureBytes = readFileSync(fixturePath);
const fixture = JSON.parse(fixtureBytes.toString("utf8")) as Fixture;
const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
function assertGenuineFixture(value: Fixture): void {
  assert.deepEqual(Object.keys(value).sort(), ["provenance", "receipt", "schemaVersion"]);
  assert.equal(value.schemaVersion, 1);
  assert.deepEqual(value.provenance, provenance);
  assert.equal(typeof value.receipt.stdout, "string");
  assert.deepEqual(value.receipt, { status: 0, stdout: value.receipt.stdout, stderr: "" });
  assert.equal(Buffer.byteLength(value.receipt.stdout, "utf8"), provenance.stdoutBytes);
  assert.equal(hash(value.receipt.stdout), provenance.stdoutSha256);
}

// Independent exact literals are exercised against real compiled top help and inert genuine D1.
const historyFirst = "  history [options]          Reconcile explicit stored sources and show dated\n";
const historyContinuation = "                             native-call intervals (read-only)\n";
const history = historyFirst + historyContinuation;
const directoryFirst = "  directory [options]        Inspect or explicitly maintain one stored directory\n";
const directoryContinuation = "                             membership\n";
const directory = directoryFirst + directoryContinuation;
const reportPrefix = "  report [options]           ";
const report = reportPrefix + "Write a new offline HTML report from one stored\n"
  + "                             source or explicit input file\n";
const help = "  help [command]             display help for command\n";
const optionHelp = "  -h, --help                 display help for command\n";
let current: TopHelpReceipt;
let absent: string;
let serialized: string[];
let descriptors: PropertyDescriptorMap[];

beforeAll(() => {
  assertGenuineFixture(fixture);
  absent = join(temporaryDirectory(), "must-not-create");
  const binary = fileURLToPath(new URL("../dist/agentprof.cjs", import.meta.url));
  const result = spawnSync(process.execPath, [binary, "--data-dir", absent, "--help"], {
    encoding: "utf8", env: { ...process.env, NODE_NO_WARNINGS: "1" }, timeout: 15000,
  });
  expect(result.error).toBeUndefined(); expect(result.signal).toBeNull();
  current = Object.freeze({ status: result.status, stdout: result.stdout, stderr: result.stderr });
  Object.freeze(fixture.receipt);
  serialized = [current, fixture.receipt].map(value => JSON.stringify(value));
  descriptors = [current, fixture.receipt].map(value => Object.getOwnPropertyDescriptors(value));
});
afterAll(() => {
  expect([current, fixture.receipt].map(value => JSON.stringify(value))).toEqual(serialized);
  expect([current, fixture.receipt].map(value => Object.getOwnPropertyDescriptors(value))).toEqual(descriptors);
  expect(readFileSync(fixturePath)).toEqual(fixtureBytes);
  expect(existsSync(absent)).toBe(false);
});

it("pins exact genuine D1 top help and independently authenticated full134 context rather than the shared launcher alone", () => {
  assertGenuineFixture(fixture);
  expect(fixtureBytes.toString("utf8")).not.toMatch(/\/Users\/|\/Volumes\/|\/home\/|file:\/\//);
  expect(fixture.receipt.stdout.split("\n")).toHaveLength(33);
});
it("accepts only mandatory two-row121-byte directory help in the actual built receipt without mutating frozen inputs or storage", () => {
  expect(current.status).toBe(0); expect(current.stderr).toBe("");
  expect(Buffer.byteLength(current.stdout, "utf8")).toBe(1798);
  expect(current.stdout.split("\n")).toHaveLength(35);
  expect(current.stdout).not.toContain(absent);
  expect(current.stdout).not.toMatch(/\/Users\/|\/Volumes\/|file:\/\/|PRIVATE_.*SENTINEL/);
  expect(existsSync(absent)).toBe(false);
  assertTopHelpDirectoryDelta(current, fixture.receipt);
  expect([current, fixture.receipt].map(value => JSON.stringify(value))).toEqual(serialized);
  expect([current, fixture.receipt].map(value => Object.getOwnPropertyDescriptors(value))).toEqual(descriptors);
});

const stdoutMutations: [string, (stdout: string) => string][] = [
  ["missing both rows", s => s.replace(directory, "")],
  ["missing directory term row", s => s.replace(directoryFirst, "")],
  ["missing directory continuation", s => s.replace(directoryContinuation, "")],
  ["duplicate directory block", s => s.replace(directory, directory + directory)],
  ["duplicate directory term row", s => s.replace(directoryFirst, directoryFirst + directoryFirst)],
  ["duplicate directory continuation", s => s.replace(directoryContinuation, directoryContinuation + directoryContinuation)],
  ["directory term typo", s => s.replace(directoryFirst, directoryFirst.replace("directory [options]", "directories [options]"))],
  ["directory description typo", s => s.replace("Inspect or explicitly maintain one stored directory", "Inspect and automatically maintain all stored directories")],
  ["directory continuation typo", s => s.replace(directoryContinuation, directoryContinuation.replace("membership", "memberships"))],
  ["directory padding", s => s.replace("directory [options]        Inspect", "directory [options]       Inspect")],
  ["directory indentation", s => s.replace(directoryFirst, directoryFirst.slice(1))],
  ["directory continuation indentation", s => s.replace(directoryContinuation, directoryContinuation.slice(1))],
  ["directory term trailing space", s => s.replace(directoryFirst, directoryFirst.slice(0, -1) + " \n")],
  ["directory continuation trailing space", s => s.replace(directoryContinuation, directoryContinuation.slice(0, -1) + " \n")],
  ["merged directory rows", s => s.replace(directory, directoryFirst.trimEnd() + " membership\n")],
  ["rewrapped directory description", s => s.replace("one stored directory\n", "one stored\n                             directory\n")],
  ["inserted directory row", s => s.replace(directoryFirst, directoryFirst + "                             undeclared policy\n")],
  ["directory CRLF", s => s.replace(directory, directory.replaceAll("\n", "\r\n"))],
  ["embedded directory carriage return", s => s.replace("explicitly maintain", "explicitly\rmaintain")],
  ["whole CRLF", s => s.replaceAll("\n", "\r\n")],
  ["missing final LF", s => s.slice(0, -1)],
  ["extra final LF", s => s + "\n"],
  ["directory before history", s => s.replace(history + directory, directory + history)],
  ["directory inside history", s => s.replace(history + directory, historyFirst + directory + historyContinuation)],
  ["directory after report", s => s.replace(directory + report, report + directory)],
  ["directory before Commands", s => s.replace(directory, "").replace("Commands:\n", directory + "Commands:\n")],
  ["directory after help command", s => s.replace(directory, "").replace(help, help + directory)],
  ["directory after help option", s => s.replace(directory, "").replace(optionHelp, optionHelp + directory)],
  ["gap before directory", s => s.replace(history + directory, history + "\n" + directory)],
  ["gap after directory", s => s.replace(directory + reportPrefix, directory + "\n" + reportPrefix)],
  ["duplicate history", s => s.replace(history, history + history)],
  ["duplicate history continuation", s => s.replace(historyContinuation, historyContinuation + historyContinuation)],
  ["duplicate report", s => s.replace(report, report + report)],
  ["duplicate help command", s => s.replace(help, help + help)],
  ["duplicate help option", s => s.replace(optionHelp, optionHelp + optionHelp)],
  ["duplicate Commands heading", s => s.replace("Commands:\n", "Commands:\nCommands:\n")],
  ["unrelated Usage", s => s.replace("Usage: agentprof", "Usage: agenttrace")],
  ["unrelated development description", s => s.replace("aggregation is pending", "aggregation is complete")],
  ["unrelated Options heading", s => s.replace("Options:\n", "Arguments:\n")],
  ["unrelated Commands heading", s => s.replace("Commands:\n", "Subcommands:\n")],
  ["unrelated json option", s => s.replace("emit structured results and errors", "emit arbitrary private data")],
  ["unrelated root option", s => s.replace("replace Codex input roots", "discover Codex input roots")],
  ["unrelated root default", s => s.replace("                             []", "                             [default]")],
  ["unrelated source bound", s => s.replace("list up to 64", "list up to 65")],
  ["unrelated history text", s => s.replace("native-call intervals (read-only)", "native-call intervals (mutable)")],
  ["unrelated report description", s => s.replace("source or explicit input file", "source prefix")],
  ["unrelated report padding", s => s.replace(reportPrefix, reportPrefix.slice(0, -1))],
  ["unrelated open description", s => s.replace("trusted local HTML file", "untrusted local HTML file")],
  ["unrelated help command text", s => s.replace(help, help.replace("display help", "hide help"))],
  ["extra global option", s => s.replace(optionHelp, "  --extra                   undeclared option\n" + optionHelp)],
  ["extra command", s => s.replace(help, "  archive                   undeclared command\n" + help)],
  ["extra output footer", s => s + "Undeclared output.\n"],
  ["future command", s => s.replace(help, "  project                   future project workflow\n" + help)],
  ["undeclared directory variant", s => s.replace(directoryFirst, directoryFirst.replace("directory [options]", "directory-reset [options]"))],
  ["private absolute path", s => s.replace(directory, directory + "/Users/PRIVATE_PATH_SENTINEL/source.jsonl\n")],
  ["private content", s => s.replace(directory, directory + "PRIVATE_CONTENT_SENTINEL\n")],
];
it.each(stdoutMutations)("rejects current top-help drift: %s", (name, change) => {
  const stdout = change(current.stdout);
  expect(stdout).not.toBe(current.stdout);
  if (name === "missing both rows") expect({ ...current, stdout }).toEqual(fixture.receipt);
  expect(() => assertTopHelpDirectoryDelta({ ...current, stdout }, fixture.receipt)).toThrow();
});

it.each([
  ["directory block", (s: string) => s.replace(history, history + directory)],
  ["directory term row", (s: string) => s.replace(history, history + directoryFirst)],
  ["directory continuation", (s: string) => s + directoryContinuation],
  ["directory marker", (s: string) => s + "  directory [options]\n"],
  ["changed history", (s: string) => s.replace("native-call intervals (read-only)", "native-call intervals (mutable)")],
  ["changed old description", (s: string) => s.replace("aggregation is pending", "aggregation is complete")],
  ["private output", (s: string) => s + "PRIVATE_CONTENT_SENTINEL\n"],
] as const)("rejects corrupted historical top help: %s", (_name, change) => {
  const stdout = change(fixture.receipt.stdout);
  expect(stdout).not.toBe(fixture.receipt.stdout);
  expect(() => assertTopHelpDirectoryDelta(current, { ...fixture.receipt, stdout })).toThrow();
});

const malformed: [string, (good: TopHelpReceipt) => unknown][] = [
  ["null", () => null], ["undefined", () => undefined], ["string", () => "receipt"],
  ["number", () => 0], ["boolean", () => false], ["array", good => [good]],
  ["function", good => Object.assign(() => {}, good)],
  ["class instance", good => Object.assign(new (class Receipt {})(), good)],
  ["foreign prototype", good => Object.assign(new Date(0), good)],
  ["null prototype", good => Object.assign(Object.create(null), good)],
  ["nonzero status", good => ({ ...good, status: 1 })],
  ["negative status", good => ({ ...good, status: -1 })],
  ["null status", good => ({ ...good, status: null })],
  ["string status", good => ({ ...good, status: "0" })],
  ["boolean status", good => ({ ...good, status: false })],
  ["NaN status", good => ({ ...good, status: NaN })],
  ["negative zero status", good => ({ ...good, status: -0 })],
  ["missing status", good => ({ stdout: good.stdout, stderr: good.stderr })],
  ["missing stdout", good => ({ status: good.status, stderr: good.stderr })],
  ["missing stderr", good => ({ status: good.status, stdout: good.stdout })],
  ["null stdout", good => ({ ...good, stdout: null })],
  ["numeric stdout", good => ({ ...good, stdout: 1 })],
  ["buffer stdout", good => ({ ...good, stdout: Buffer.from(good.stdout) })],
  ["empty stdout", good => ({ ...good, stdout: "" })],
  ["nonempty stderr", good => ({ ...good, stderr: "warning" })],
  ["newline stderr", good => ({ ...good, stderr: "\n" })],
  ["null stderr", good => ({ ...good, stderr: null })],
  ["numeric stderr", good => ({ ...good, stderr: 0 })],
  ["extra field", good => ({ ...good, signal: null })],
  ["symbol field", good => ({ ...good, [Symbol("extra")]: true })],
  ["nonenumerable stdout", good => Object.defineProperty({ ...good }, "stdout", { enumerable: false })],
  ["inherited stdout", good => Object.assign(Object.create({ stdout: good.stdout }), { status: good.status, stderr: good.stderr })],
];
it.each(malformed)("rejects malformed original receipts on either side: %s", (_name, change) => {
  expect(() => assertTopHelpDirectoryDelta(change(current), fixture.receipt)).toThrow();
  expect(() => assertTopHelpDirectoryDelta(current, change(fixture.receipt))).toThrow();
});
it.each(["status", "stdout", "stderr"])("rejects the %s accessor on either side without evaluation", field => {
  let reads = 0;
  const bad = Object.defineProperty({ ...current }, field, { enumerable: true, get() { reads++; throw new Error("Getter evaluated"); } });
  const before = Object.getOwnPropertyDescriptors(bad);
  expect(() => assertTopHelpDirectoryDelta(bad, fixture.receipt)).toThrow();
  expect(() => assertTopHelpDirectoryDelta(current, bad)).toThrow();
  expect(reads).toBe(0); expect(Object.getOwnPropertyDescriptors(bad)).toEqual(before);
});
it("rejects ordinary and revoked proxies on either side before invoking traps", () => {
  let traps = 0;
  const trap = () => { traps++; throw new Error("Proxy trap evaluated"); };
  const proxy = new Proxy({ ...current }, { get: trap, getPrototypeOf: trap, ownKeys: trap, getOwnPropertyDescriptor: trap });
  const revoked = Proxy.revocable({ ...current }, {}); revoked.revoke();
  for (const bad of [proxy, revoked.proxy]) {
    expect(() => assertTopHelpDirectoryDelta(bad, fixture.receipt)).toThrow();
    expect(() => assertTopHelpDirectoryDelta(current, bad)).toThrow();
  }
  expect(traps).toBe(0);
});
it("rejects opaque original field values without inspecting custom getters or proxy traps", () => {
  let reads = 0;
  const opaque = Object.defineProperty({}, Symbol.for("nodejs.util.inspect.custom"), {
    get() { reads++; throw new Error("Malformed field inspected"); },
  });
  const proxy = new Proxy({}, { get() { reads++; throw new Error("Malformed field trap evaluated"); } });
  for (const field of ["status", "stdout", "stderr"]) for (const value of [opaque, proxy]) {
    expect(() => assertTopHelpDirectoryDelta({ ...current, [field]: value }, fixture.receipt)).toThrow();
    expect(() => assertTopHelpDirectoryDelta(current, { ...fixture.receipt, [field]: value })).toThrow();
  }
  expect(reads).toBe(0);
});

describe("genuine inert top fixture integrity", () => {
  it.each([
    ["stdout", (f: Fixture) => { f.receipt.stdout += "Extra.\n"; }],
    ["receipt status", (f: Fixture) => { f.receipt.status = 1; }],
    ["receipt stderr", (f: Fixture) => { f.receipt.stderr = "warning"; }],
    ["receipt extra field", (f: Fixture) => { Object.assign(f.receipt, { signal: null }); }],
    ["source commit", (f: Fixture) => { f.provenance.sourceCommit = "0".repeat(40); }],
    ["actual main commit", (f: Fixture) => { f.provenance.actualMainCommit = "0".repeat(40); }],
    ["source tree", (f: Fixture) => { f.provenance.tree = "0".repeat(40); }],
    ["repository", (f: Fixture) => { f.provenance.repository = "OTHER/repository"; }],
    ["command", (f: Fixture) => { f.provenance.command = ["scan", "--help"]; }],
    ["help width", (f: Fixture) => { f.provenance.helpWidthColumns = 81; }],
    ["Commander context", (f: Fixture) => { f.provenance.commanderVersion = "15.0.1"; }],
    ["bootstrap hash", (f: Fixture) => { f.provenance.entrySha256 = "0".repeat(64); }],
    ["native CLI hash", (f: Fixture) => { f.provenance.cliMainSha256 = "0".repeat(64); }],
    ["compiled manifest hash", (f: Fixture) => { f.provenance.compiledManifestSha256 = "0".repeat(64); }],
    ["compiled manifest encoding", (f: Fixture) => { f.provenance.compiledManifestDigestEncoding += " with newline"; }],
    ["compiled manifest count", (f: Fixture) => { f.provenance.compiledManifestEntries = 133; }],
    ["stdout hash", (f: Fixture) => { f.provenance.stdoutSha256 = "0".repeat(64); }],
    ["stdout length", (f: Fixture) => { f.provenance.stdoutBytes = 1676; }],
    ["fixture schema", (f: Fixture) => { f.schemaVersion = 2; }],
    ["schema type", (f: Fixture) => { Object.assign(f, { schemaVersion: "1" }); }],
    ["extra top field", (f: Fixture) => { Object.assign(f, { extra: true }); }],
    ["missing receipt", (f: Fixture) => { Reflect.deleteProperty(f, "receipt"); }],
    ["missing native CLI context", (f: Fixture) => { Reflect.deleteProperty(f.provenance, "cliMainSha256"); }],
    ["missing full manifest context", (f: Fixture) => { Reflect.deleteProperty(f.provenance, "compiledManifestSha256"); }],
    ["scan receipt substitution", (f: Fixture) => { f.receipt = JSON.parse(readFileSync(new URL("./fixtures/cli/scan-help-d1.json", import.meta.url), "utf8")).receipt; }],
    ["private path metadata", (f: Fixture) => { Object.assign(f.provenance, { binary: "/Users/PRIVATE_PATH_SENTINEL/agentprof.cjs" }); }],
    ["native baseline alias", (f: Fixture) => { f.provenance.fixtureIs = "Alias for an unavailable older native baseline"; }],
  ] as const)("rejects altered top fixture %s", (_name, change) => {
    const altered = structuredClone(fixture); change(altered);
    expect(altered).not.toEqual(fixture);
    expect(() => assertGenuineFixture(altered)).toThrow();
  });
});
