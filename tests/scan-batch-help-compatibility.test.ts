import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { temporaryDirectory } from "./helpers.js";
import { assertScanHelpEnrollmentDelta } from "./scan-help-compatibility.js";
import type { ScanHelpReceipt } from "./scan-help-compatibility.js";

// Independent literals; the helper's constants are not the expected oracle.
const batchFirst = "  --batch-directory   with --enroll-directory, collect up to 4096 files in\n";
const batchContinuation = "                      bounded pages\n";
const batchOption = batchFirst + batchContinuation;
const batchFooter = "--batch-directory requires --enroll-directory: up to 4096 files, 256 directories, 16384 entries; 16-file pages and one final complete membership capture.\n";
const enrollment = "  --enroll-directory  scan exactly one explicit directory and retain\n                      authenticated membership observations\n";
const retirement = "  --retire-missing    with --enroll-directory, guard and mark absent members\n                      unavailable without deleting history\n";
const retirementFooter = "--retire-missing requires --enroll-directory; complete census, current revisions and all-root guards precede retirement. History is retained; no move identity is inferred.\n";
const help = "  -h, --help          display help for command\n";
const warning = "Missing/unreadable parents and symlinks are not deletion evidence. No automatic directory pruning or inferred moves.\n";
const fixturePath = fileURLToPath(new URL("./fixtures/cli/scan-help-d1.json", import.meta.url));
const fixtureBytes = readFileSync(fixturePath);
const fixture = JSON.parse(fixtureBytes.toString("utf8"));
const historical = Object.freeze(fixture.receipt) as ScanHelpReceipt;
let current: ScanHelpReceipt, absent: string, snapshot: string;

beforeAll(() => {
  expect(Buffer.byteLength(historical.stdout)).toBe(941);
  expect(createHash("sha256").update(historical.stdout).digest("hex")).toBe("db2d8022616f7065dec0964f1028cb22509335afd2b73ff955150ff9b91d72e2");
  absent = join(temporaryDirectory(), "must-not-create");
  const binary = fileURLToPath(new URL("../dist/agentprof.cjs", import.meta.url));
  const actual = spawnSync(process.execPath, [binary, "--data-dir", absent, "scan", "--help"], { encoding: "utf8", env: { ...process.env, NODE_NO_WARNINGS: "1" }, timeout: 15000 });
  expect(actual.error).toBeUndefined(); expect(actual.signal).toBeNull();
  current = Object.freeze({ status: actual.status, stdout: actual.stdout, stderr: actual.stderr });
  // Every negative runs only after real compiled help satisfies the comparator.
  assertScanHelpEnrollmentDelta(current, historical);
  snapshot = JSON.stringify({ current, historical });
});
afterAll(() => {
  expect(JSON.stringify({ current, historical })).toBe(snapshot);
  expect(readFileSync(fixturePath)).toEqual(fixtureBytes); expect(existsSync(absent)).toBe(false);
});
const replaceOne = (stdout: string, original: string, replacement: string) => {
  expect(stdout.split(original).length - 1).toBe(1);
  const changed = stdout.replace(original, replacement); expect(changed).not.toBe(stdout); return changed;
};
const stripBatch = (stdout: string) => stdout.replace(batchOption, "").slice(0, -batchFooter.length);

it("real compiled help has the exact mandatory111+154 byte layer over the unchanged615 receipt", () => {
  expect(Buffer.byteLength(batchOption)).toBe(111); expect(Buffer.byteLength(batchFooter)).toBe(154);
  expect((batchOption + batchFooter).split("\n").length - 1).toBe(3);
  expect(batchFirst.indexOf("with --enroll-directory")).toBe(22); expect(batchContinuation.indexOf("bounded pages")).toBe(22);
  expect(batchFirst.trimEnd().length).toBeLessThanOrEqual(80);
  expect(Buffer.byteLength(current.stdout)).toBe(1821); expect(Buffer.byteLength(stripBatch(current.stdout))).toBe(1556);
  expect(Buffer.byteLength(current.stdout) - Buffer.byteLength(historical.stdout)).toBe(880);
  expect(historical.stdout).toContain("4096"); expect(historical.stdout).toContain("256 directories");
  expect(current.stdout).not.toMatch(/\/Users\/|\/Volumes\/|\/home\/|file:\/\/|PRIVATE_.*SENTINEL/);
  assertScanHelpEnrollmentDelta(current, historical);
});
it("old615 current help cannot bypass mandatory batch admission", () => {
  const stdout = stripBatch(current.stdout); expect(stdout).not.toBe(current.stdout);
  expect(Buffer.byteLength(stdout) - Buffer.byteLength(historical.stdout)).toBe(615);
  expect(() => assertScanHelpEnrollmentDelta({ ...current, stdout }, historical)).toThrow();
});

const batchMutations: readonly (readonly [string, (s: string) => string])[] = [
  ["missing both components", s => replaceOne(replaceOne(s, batchOption, ""), batchFooter, "")],
  ["missing option", s => replaceOne(s, batchOption, "")],
  ["missing first option line", s => replaceOne(s, batchFirst, "")],
  ["missing continuation", s => replaceOne(s, batchContinuation, "")],
  ["missing footer", s => replaceOne(s, batchFooter, "")],
  ["duplicate option", s => replaceOne(s, batchOption, batchOption + batchOption)],
  ["duplicate first line", s => replaceOne(s, batchFirst, batchFirst + batchFirst)],
  ["duplicate continuation", s => replaceOne(s, batchContinuation, batchContinuation + batchContinuation)],
  ["duplicate footer", s => replaceOne(s, batchFooter, batchFooter + batchFooter)],
  ["flag typo", s => replaceOne(s, batchFirst, batchFirst.replace("--batch-directory", "--batch-directories"))],
  ["description typo", s => replaceOne(s, batchFirst, batchFirst.replace("collect up to", "collect at least"))],
  ["continuation typo", s => replaceOne(s, batchContinuation, batchContinuation.replace("bounded", "unbounded"))],
  ["footer enrollment condition", s => replaceOne(s, batchFooter, batchFooter.replace("requires --enroll-directory", "excludes --enroll-directory"))],
  ["file bound", s => replaceOne(s, batchFooter, batchFooter.replace("4096 files", "4097 files"))],
  ["directory bound", s => replaceOne(s, batchFooter, batchFooter.replace("256 directories", "257 directories"))],
  ["entry bound", s => replaceOne(s, batchFooter, batchFooter.replace("16384 entries", "16385 entries"))],
  ["page bound", s => replaceOne(s, batchFooter, batchFooter.replace("16-file pages", "17-file pages"))],
  ["final complete capture", s => replaceOne(s, batchFooter, batchFooter.replace("one final complete membership capture", "one partial membership capture"))],
  ["option before enrollment", s => replaceOne(s, enrollment + retirement + batchOption, batchOption + enrollment + retirement)],
  ["option before retirement", s => replaceOne(s, retirement + batchOption, batchOption + retirement)],
  ["option after help", s => replaceOne(s, batchOption + help, help + batchOption)],
  ["option before Options", s => replaceOne(replaceOne(s, batchOption, ""), "Options:\n", batchOption + "Options:\n")],
  ["option inside retirement", s => replaceOne(s, retirement + batchOption, retirement.replace("                      unavailable", batchOption + "                      unavailable"))],
  ["gap before option", s => replaceOne(s, retirement + batchOption, retirement + "\n" + batchOption)],
  ["gap after option", s => replaceOne(s, batchOption + help, batchOption + "\n" + help)],
  ["footer before retirement", s => replaceOne(s, retirementFooter + batchFooter, batchFooter + retirementFooter)],
  ["footer before warning", s => replaceOne(replaceOne(s, batchFooter, ""), warning, batchFooter + warning)],
  ["footer before heading", s => replaceOne(replaceOne(s, batchFooter, ""), "Usage:", batchFooter + "Usage:")],
  ["gap before footer", s => replaceOne(s, retirementFooter + batchFooter, retirementFooter + "\n" + batchFooter)],
  ["text after footer", s => s + "INERT_UNDECLARED_OUTPUT\n"],
  ["footer without LF", s => replaceOne(s, batchFooter, batchFooter.slice(0, -1))],
  ["extra final LF", s => s + "\n"],
  ["option leading space", s => replaceOne(s, batchFirst, " " + batchFirst)],
  ["option flag padding", s => replaceOne(s, batchFirst, batchFirst.replace("--batch-directory   with", "--batch-directory  with"))],
  ["continuation column", s => replaceOne(s, batchContinuation, batchContinuation.slice(1))],
  ["option trailing space", s => replaceOne(s, batchFirst, batchFirst.slice(0, -1) + " \n")],
  ["continuation trailing space", s => replaceOne(s, batchContinuation, batchContinuation.slice(0, -1) + " \n")],
  ["footer leading space", s => replaceOne(s, batchFooter, " " + batchFooter)],
  ["footer trailing space", s => replaceOne(s, batchFooter, batchFooter.slice(0, -1) + " \n")],
  ["merged option rows", s => replaceOne(s, batchOption, batchFirst.trimEnd() + " " + batchContinuation.trimStart())],
  ["rewrapped option", s => replaceOne(s, batchFirst, batchFirst.replace("4096 files in\n", "4096\n                      files in\n"))],
  ["option tab padding", s => replaceOne(s, batchFirst, batchFirst.replace("   with", "\twith"))],
  ["batch option CRLF", s => replaceOne(s, batchOption, batchOption.replaceAll("\n", "\r\n"))],
  ["batch footer CRLF", s => replaceOne(s, batchFooter, batchFooter.replace("\n", "\r\n"))],
  ["embedded CR", s => replaceOne(s, batchContinuation, batchContinuation.replace("bounded", "bound\red"))],
  ["unknown adjacent option", s => replaceOne(s, batchOption, batchOption + "  --batch-future      undeclared option\n")],
];
it.each(batchMutations)("strict batch help rejects %s", (_name, change) => {
  const stdout = change(current.stdout); expect(stdout).not.toBe(current.stdout);
  expect(() => assertScanHelpEnrollmentDelta({ ...current, stdout }, historical)).toThrow();
});

it.each([batchOption, batchFirst, batchContinuation, batchFooter, "--batch-directory\n", "with --enroll-directory, collect up to 4096 files in\n", "up to 4096 files, 256 directories, 16384 entries\n", "16-file pages\n", "one final complete membership capture\n"])("historical batch-family marker must be absent: %s", marker => {
  const stdout = historical.stdout + marker; expect(stdout).not.toBe(historical.stdout);
  expect(() => assertScanHelpEnrollmentDelta(current, { ...historical, stdout })).toThrow();
});

const residualMutations: readonly (readonly [string, string, string])[] = [
  ["heading", "Usage: agentprof scan", "Usage: agentprof collect"],
  ["provider root", "explicit --codex-root/--claude-root inputs only", "implicit provider roots"],
  ["legacy source bound", "64 sources", "65 sources"],
  ["original option", "includes usage timing", "excludes usage timing"],
  ["original help", help, help.replace("display help", "hide help")],
  ["original warning", "No automatic directory pruning", "Automatic directory pruning"],
  ["private path", "Options:\n", "Options:\n/Users/PRIVATE_PATH_SENTINEL/inert.jsonl\n"],
  ["private content", "Options:\n", "Options:\nPRIVATE_CONTENT_SENTINEL\n"],
  ["unknown UTF8 text", "Options:\n", "Options:\n관찰 🥝 — unrelated\n"],
];
it.each(residualMutations)("full residual receipt rejects unrelated %s while exact batch survives", (_name, original, replacement) => {
  const stdout = replaceOne(current.stdout, original, replacement);
  for (const component of [batchOption, batchFooter]) expect(stdout.split(component).length - 1).toBe(1);
  expect(stdout.endsWith(batchFooter)).toBe(true);
  expect(() => assertScanHelpEnrollmentDelta({ ...current, stdout }, historical)).toThrow();
});

it.each([
  ["nonzero status", (good: ScanHelpReceipt) => ({ ...good, status: 1 })],
  ["nonempty stderr", (good: ScanHelpReceipt) => ({ ...good, stderr: "inert warning\n" })],
  ["extra own field", (good: ScanHelpReceipt) => ({ ...good, inert: true })],
  ["nonstring stdout", (good: ScanHelpReceipt) => ({ ...good, stdout: Buffer.from(good.stdout) })],
] as const)("outer batch admission rejects representative malformed receipt: %s", (_name, change) => {
  expect(() => assertScanHelpEnrollmentDelta(change(current), historical)).toThrow();
  expect(() => assertScanHelpEnrollmentDelta(current, change(historical))).toThrow();
});
it.each(["status", "stdout", "stderr"])("both receipts are validated before batch substring access: %s getter", field => {
  let reads = 0;
  const malformed = (good: ScanHelpReceipt) => Object.defineProperty({ ...good }, field, { enumerable: true, get() { reads++; throw Error("inert getter evaluated"); } });
  const badCurrent = malformed(current), badHistorical = malformed(historical);
  const snapshots = [Object.getOwnPropertyDescriptors(badCurrent), Object.getOwnPropertyDescriptors(badHistorical)];
  expect(() => assertScanHelpEnrollmentDelta(badCurrent, historical)).toThrow();
  expect(() => assertScanHelpEnrollmentDelta(current, badHistorical)).toThrow();
  expect(reads).toBe(0); expect([Object.getOwnPropertyDescriptors(badCurrent), Object.getOwnPropertyDescriptors(badHistorical)]).toEqual(snapshots);
});
it.each(["ordinary", "revoked"] as const)("outer receipt validation rejects %s proxies on both sides without traps", kind => {
  let traps = 0; const trap = () => { traps++; throw Error("inert proxy trap evaluated"); };
  const ordinary = new Proxy({ ...current }, { get: trap, getPrototypeOf: trap, ownKeys: trap, getOwnPropertyDescriptor: trap });
  const revoked = Proxy.revocable({ ...current }, {}); revoked.revoke(); const bad = kind === "ordinary" ? ordinary : revoked.proxy;
  expect(() => assertScanHelpEnrollmentDelta(bad, historical)).toThrow(); expect(() => assertScanHelpEnrollmentDelta(current, bad)).toThrow();
  expect(traps).toBe(0);
});
it.each(["status", "stdout", "stderr"])("outer receipt validation rejects opaque %s without inspecting fields", field => {
  let reads = 0; const opaque = Object.defineProperty({}, Symbol.for("nodejs.util.inspect.custom"), { get() { reads++; throw Error("inert inspect getter evaluated"); } });
  const proxy = new Proxy({}, { get() { reads++; throw Error("inert opaque trap evaluated"); } });
  for (const value of [opaque, proxy]) {
    expect(() => assertScanHelpEnrollmentDelta({ ...current, [field]: value }, historical)).toThrow();
    expect(() => assertScanHelpEnrollmentDelta(current, { ...historical, [field]: value })).toThrow();
  }
  expect(reads).toBe(0);
});
it("both frozen receipts keep every original property descriptor and complete bytes", () => {
  const descriptors = [Object.getOwnPropertyDescriptors(current), Object.getOwnPropertyDescriptors(historical)];
  assertScanHelpEnrollmentDelta(current, historical);
  expect(JSON.stringify({ current, historical })).toBe(snapshot);
  expect([Object.getOwnPropertyDescriptors(current), Object.getOwnPropertyDescriptors(historical)]).toEqual(descriptors);
  expect(existsSync(absent)).toBe(false);
});
