import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { temporaryDirectory } from "./helpers.js";
import { assertScanHelpEnrollmentDelta } from "./scan-help-compatibility.js";
import type { ScanHelpReceipt } from "./scan-help-compatibility.js";

const provenance = {
  repository: "WhiteKiwi/agentprof",
  sourceCommit: "4890723842cdb9d22a19da3f05f90aa5d9278807",
  actualMainCommit: "d1b84f166eb33f11d5b7a22ca407dbf14226fd24",
  tree: "97d7bc1105ccdefe0bff75a26b69ab47d10e6dbb",
  command: ["scan", "--help"],
  helpWidthColumns: 80,
  commanderVersion: "15.0.0",
  entrySha256: "2d48dfa2052410a14310d61e9f6e6f705d6e4627106f48cef80a32f48143a3e8",
  cliMainSha256: "3ebd63280f2a9686babf911fcb334b99aa1a7c80fcd7e73177b12c6261f35925",
  compiledManifestSha256: "664ec770127006bfef1e8230daad079370a86dd90163b0554092171d2cbb7aff",
  compiledManifestDigestEncoding: "UTF-8 compact JSON of relative-path/hash map, keys sorted, no trailing newline",
  compiledManifestEntries: 134,
  stdoutSha256: "db2d8022616f7065dec0964f1028cb22509335afd2b73ff955150ff9b91d72e2",
  stdoutBytes: 941,
  fixtureIs: "Inert exact genuine installed D1 help capture; not a recreated historical binary or a replacement for any named optional baseline.",
};
type Fixture = { schemaVersion: number; provenance: typeof provenance; receipt: ScanHelpReceipt };
const fixturePath = fileURLToPath(new URL("./fixtures/cli/scan-help-d1.json", import.meta.url));
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

// Independent literals are checked against one real compiled receipt, never a synthetic old binary.
const optionFirst = "  --enroll-directory  scan exactly one explicit directory and retain\n";
const optionContinuation = "                      authenticated membership observations\n";
const option = optionFirst + optionContinuation;
const help = "  -h, --help          display help for command\n";
const warning = "Missing/unreadable parents and symlinks are not deletion evidence. No automatic directory pruning or inferred moves.\n";
const noteOne = "--enroll-directory requires exactly one explicit provider directory and excludes --reconcile.\n";
const noteTwo = "Membership not_observed is not deletion evidence; the original source data remains.\n";
const notes = noteOne + noteTwo;
let current: ScanHelpReceipt;
let absent: string;
let frozenCurrent: string;
let frozenHistorical: string;

beforeAll(() => {
  assertGenuineFixture(fixture);
  absent = join(temporaryDirectory(), "must-not-create");
  const binary = fileURLToPath(new URL("../dist/agentprof.cjs", import.meta.url));
  const result = spawnSync(process.execPath, [binary, "--data-dir", absent, "scan", "--help"], {
    encoding: "utf8", env: { ...process.env, NODE_NO_WARNINGS: "1" }, timeout: 15000,
  });
  current = Object.freeze({ status: result.status, stdout: result.stdout, stderr: result.stderr });
  Object.freeze(fixture.receipt);
  frozenCurrent = JSON.stringify(current);
  frozenHistorical = JSON.stringify(fixture.receipt);
});
afterAll(() => {
  expect(JSON.stringify(current)).toBe(frozenCurrent);
  expect(JSON.stringify(fixture.receipt)).toBe(frozenHistorical);
  expect(readFileSync(fixturePath)).toEqual(fixtureBytes);
  expect(existsSync(absent)).toBe(false);
});

it("pins the inert genuine D1 receipt and independently authenticated full-context provenance", () => {
  assertGenuineFixture(fixture);
  expect(fixtureBytes.toString("utf8")).not.toMatch(/\/Users\/|\/Volumes\/|\/home\/|file:\/\//);
});
it("accepts only the declared delta in actual compiled help and leaves both frozen receipts and storage untouched", () => {
  expect(existsSync(absent)).toBe(false);
  assertScanHelpEnrollmentDelta(current, fixture.receipt);
  expect(JSON.stringify(current)).toBe(frozenCurrent);
  expect(JSON.stringify(fixture.receipt)).toBe(frozenHistorical);
});

const stdoutMutations: [string, (stdout: string) => string][] = [
  ["missing option block", s => s.replace(option, "")],
  ["missing first option line", s => s.replace(optionFirst, "")],
  ["missing continuation", s => s.replace(optionContinuation, "")],
  ["missing first note", s => s.replace(noteOne, "")],
  ["missing second note", s => s.replace(noteTwo, "")],
  ["duplicate option block", s => s.replace(option, option + option)],
  ["duplicate first option line", s => s.replace(optionFirst, optionFirst + optionFirst)],
  ["duplicate continuation", s => s.replace(optionContinuation, optionContinuation + optionContinuation)],
  ["duplicate first note", s => s.replace(noteOne, noteOne + noteOne)],
  ["duplicate second note", s => s.replace(noteTwo, noteTwo + noteTwo)],
  ["duplicate existing help row", s => s.replace(help, help + help)],
  ["option flag typo", s => s.replace("  --enroll-directory", "  --enrol-directory")],
  ["option description typo", s => s.replace("scan exactly one explicit directory and retain", "scan any explicit directory and retain")],
  ["continuation typo", s => s.replace("authenticated membership observations", "unauthenticated membership observations")],
  ["first note typo", s => s.replace("excludes --reconcile", "includes --reconcile")],
  ["second note typo", s => s.replace("is not deletion evidence", "is deletion evidence")],
  ["option indentation", s => s.replace(optionFirst, " " + optionFirst)],
  ["option padding", s => s.replace("--enroll-directory  scan", "--enroll-directory   scan")],
  ["continuation indentation", s => s.replace(optionContinuation, optionContinuation.slice(1))],
  ["first note leading space", s => s.replace(noteOne, " " + noteOne)],
  ["first note trailing space", s => s.replace(noteOne, noteOne.slice(0, -1) + " \n")],
  ["second note leading space", s => s.replace(noteTwo, " " + noteTwo)],
  ["second note trailing space", s => s.replace(noteTwo, noteTwo.slice(0, -1) + " \n")],
  ["CRLF replacement", s => s.replaceAll("\n", "\r\n")],
  ["stray carriage return", s => s.replace(optionFirst, optionFirst.slice(0, -1) + "\r\n")],
  ["missing final LF", s => s.slice(0, -1)],
  ["extra final LF", s => s + "\n"],
  ["option after help", s => s.replace(option + help, help + option)],
  ["option before Options", s => s.replace(option, "").replace("Options:\n", option + "Options:\n")],
  ["option separated from help", s => s.replace(option + help, option + "\n" + help)],
  ["reordered notes", s => s.replace(notes, noteTwo + noteOne)],
  ["notes before unchanged warning", s => s.replace(warning + notes, notes + warning)],
  ["text after final notes", s => s + "Additional output.\n"],
  ["unrelated heading", s => s.replace("Usage: agentprof scan", "Usage: agentprof collect")],
  ["unrelated input description", s => s.replace("(at least one required)", "(all optional)")],
  ["unrelated bound", s => s.replace("64 sources", "65 sources")],
  ["unrelated existing option", s => s.replace("includes usage timing", "excludes usage timing")],
  ["unrelated existing help text", s => s.replace(help, help.replace("display help", "hide help"))],
  ["unrelated warning", s => s.replace("No automatic directory pruning", "Automatic directory pruning")],
  ["unrelated new option", s => s.replace(help, "  --extra             unrelated option\n" + help)],
  ["unrelated extra heading", s => s.replace("Options:\n", "Extra:\nOptions:\n")],
  ["unplanned retirement option", s => s.replace(help, "  --retire-directory  retire absent members\n" + help)],
  ["unplanned directory command", s => s.replace("Options:\n", "Commands:\n  directory  manage directories\nOptions:\n")],
];
it.each(stdoutMutations)("rejects current help drift: %s", (_name, change) => {
  const stdout = change(current.stdout);
  expect(stdout).not.toBe(current.stdout);
  expect(() => assertScanHelpEnrollmentDelta({ ...current, stdout }, fixture.receipt)).toThrow();
});

it.each([
  ["changed heading", (s: string) => s.replace("Usage: agentprof scan", "Usage: agentprof collect")],
  ["changed old warning", (s: string) => s.replace("No automatic directory pruning", "Automatic directory pruning")],
  ["enrollment option", (s: string) => s.replace(help, option + help)],
  ["enrollment continuation", (s: string) => s + optionContinuation],
  ["first enrollment note", (s: string) => s + noteOne],
  ["second enrollment note", (s: string) => s + noteTwo],
] as const)("rejects corrupted historical input: %s", (_name, change) => {
  const stdout = change(fixture.receipt.stdout);
  expect(stdout).not.toBe(fixture.receipt.stdout);
  expect(() => assertScanHelpEnrollmentDelta(current, { ...fixture.receipt, stdout })).toThrow();
});

const malformed: [string, (good: ScanHelpReceipt) => unknown][] = [
  ["null", () => null], ["undefined", () => undefined], ["string", () => "receipt"],
  ["array", good => [good]], ["function", good => Object.assign(() => {}, good)],
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
it.each(malformed)("rejects malformed receipts on either side: %s", (_name, change) => {
  expect(() => assertScanHelpEnrollmentDelta(change(current), fixture.receipt)).toThrow();
  expect(() => assertScanHelpEnrollmentDelta(current, change(fixture.receipt))).toThrow();
});
it.each(["status", "stdout", "stderr"])("rejects the %s accessor without evaluating it on either side", field => {
  let reads = 0;
  const bad = Object.defineProperty({ ...current }, field, { enumerable: true, get() { reads++; throw new Error("Getter evaluated"); } });
  const descriptors = Object.getOwnPropertyDescriptors(bad);
  expect(() => assertScanHelpEnrollmentDelta(bad, fixture.receipt)).toThrow();
  expect(() => assertScanHelpEnrollmentDelta(current, bad)).toThrow();
  expect(reads).toBe(0);
  expect(Object.getOwnPropertyDescriptors(bad)).toEqual(descriptors);
});
it("rejects ordinary and revoked proxies without invoking traps on either side", () => {
  let traps = 0;
  const trap = () => { traps++; throw new Error("Proxy trap evaluated"); };
  const proxy = new Proxy({ ...current }, { get: trap, getPrototypeOf: trap, ownKeys: trap, getOwnPropertyDescriptor: trap });
  const revoked = Proxy.revocable({ ...current }, {}); revoked.revoke();
  for (const bad of [proxy, revoked.proxy]) {
    expect(() => assertScanHelpEnrollmentDelta(bad, fixture.receipt)).toThrow();
    expect(() => assertScanHelpEnrollmentDelta(current, bad)).toThrow();
  }
  expect(traps).toBe(0);
});

it("rejects opaque field values without inspecting getters or proxy traps", () => {
  let reads = 0;
  const opaque = Object.defineProperty({}, Symbol.for("nodejs.util.inspect.custom"), {
    get() { reads++; throw new Error("Malformed field inspected"); },
  });
  const proxy = new Proxy({}, { get() { reads++; throw new Error("Malformed field trap evaluated"); } });
  for (const field of ["status", "stdout", "stderr"]) for (const value of [opaque, proxy]) {
    expect(() => assertScanHelpEnrollmentDelta({ ...current, [field]: value }, fixture.receipt)).toThrow();
    expect(() => assertScanHelpEnrollmentDelta(current, { ...fixture.receipt, [field]: value })).toThrow();
  }
  expect(reads).toBe(0);
});

describe("genuine inert fixture integrity", () => {
  it.each([
    ["stdout", (f: Fixture) => { f.receipt.stdout += "Extra.\n"; }],
    ["receipt status", (f: Fixture) => { f.receipt.status = 1; }],
    ["receipt stderr", (f: Fixture) => { f.receipt.stderr = "warning"; }],
    ["source commit", (f: Fixture) => { f.provenance.sourceCommit = "0".repeat(40); }],
    ["actual main commit", (f: Fixture) => { f.provenance.actualMainCommit = "0".repeat(40); }],
    ["source tree", (f: Fixture) => { f.provenance.tree = "0".repeat(40); }],
    ["command", (f: Fixture) => { f.provenance.command.push("--retire-directory"); }],
    ["help width", (f: Fixture) => { f.provenance.helpWidthColumns = 81; }],
    ["Commander context", (f: Fixture) => { f.provenance.commanderVersion = "15.0.1"; }],
    ["bootstrap hash", (f: Fixture) => { f.provenance.entrySha256 = "0".repeat(64); }],
    ["CLI context hash", (f: Fixture) => { f.provenance.cliMainSha256 = "0".repeat(64); }],
    ["compiled map hash", (f: Fixture) => { f.provenance.compiledManifestSha256 = "0".repeat(64); }],
    ["compiled map encoding", (f: Fixture) => { f.provenance.compiledManifestDigestEncoding += " with newline"; }],
    ["compiled map count", (f: Fixture) => { f.provenance.compiledManifestEntries = 133; }],
    ["stdout hash", (f: Fixture) => { f.provenance.stdoutSha256 = "0".repeat(64); }],
    ["stdout length", (f: Fixture) => { f.provenance.stdoutBytes = 940; }],
    ["fixture scope", (f: Fixture) => { f.provenance.fixtureIs = "Replacement historical executable"; }],
    ["fixture schema", (f: Fixture) => { f.schemaVersion = 2; }],
    ["private path", (f: Fixture) => { Object.assign(f.provenance, { binary: "/Users/PRIVATE_PATH_SENTINEL/agentprof.cjs" }); }],
  ] as const)("rejects altered fixture %s", (_name, change) => {
    const altered = structuredClone(fixture); change(altered);
    expect(altered).not.toEqual(fixture);
    expect(() => assertGenuineFixture(altered)).toThrow();
  });
});
