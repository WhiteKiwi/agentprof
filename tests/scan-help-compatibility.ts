import assert from "node:assert/strict";
import { types } from "node:util";

export interface ScanHelpReceipt { status: number | null; stdout: string; stderr: string }

const option = "  --enroll-directory  scan exactly one explicit directory and retain\n"
  + "                      authenticated membership observations\n";
const help = "  -h, --help          display help for command\n";
const warning = "Missing/unreadable parents and symlinks are not deletion evidence. No automatic directory pruning or inferred moves.\n";
const noteOne = "--enroll-directory requires exactly one explicit provider directory and excludes --reconcile.\n";
const noteTwo = "Membership not_observed is not deletion evidence; the original source data remains.\n";
const notes = noteOne + noteTwo;
const retirementOption = "  --retire-missing    with --enroll-directory, guard and mark absent members\n"
  + "                      unavailable without deleting history\n";
const retirementFooter = "--retire-missing requires --enroll-directory; complete census, current revisions and all-root guards precede retirement. History is retained; no move identity is inferred.\n";

function assertReceipt(value: unknown, name: string): asserts value is ScanHelpReceipt {
  assert.ok(value !== null && typeof value === "object", `${name} must be an ordinary receipt`);
  // Detect proxies before any reflective operation can invoke a trap.
  assert.ok(!types.isProxy(value), `${name} must not be a proxy`);
  assert.ok(Object.getPrototypeOf(value) === Object.prototype, `${name} must be an ordinary receipt`);
  const keys = Reflect.ownKeys(value);
  assert.equal(keys.length, 3, `${name} must have exactly three own fields`);
  assert.ok(keys.every(key => typeof key === "string"), `${name} field names must be strings`);
  assert.deepEqual(keys.sort(), ["status", "stderr", "stdout"], `${name} must have exactly three own fields`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const field of ["status", "stdout", "stderr"]) {
    const descriptor = descriptors[field];
    assert.ok(descriptor && "value" in descriptor && descriptor.enumerable, `${name}.${field} must be an enumerable data field`);
  }
  assert.equal(typeof value.status, "number", `${name} status must be a number`);
  assert.equal(typeof value.stderr, "string", `${name} stderr must be a string`);
  assert.equal(typeof value.stdout, "string", `${name} stdout must be a string`);
  assert.equal(value.status, 0, `${name} must succeed`);
  assert.equal(value.stderr, "", `${name} stderr must be empty`);
  assert.ok(!value.stdout.includes("\r") && value.stdout.endsWith("\n"), `${name} help must preserve LF newlines`);
}

function assertOnce(stdout: string, literal: string): void {
  assert.equal(stdout.split(literal).length, 2, "Expected one exact help component");
}

/** Accept only the declared enrollment (307 bytes) and retirement (308 bytes) additions. */
export function assertScanHelpEnrollmentDelta(current: unknown, historical: unknown): void {
  assertReceipt(current, "current");
  assertReceipt(historical, "historical");
  for (const marker of ["--retire-missing", "unavailable without deleting history", "all-root guards precede retirement", "no move identity is inferred"]) {
    assert.ok(!historical.stdout.includes(marker), "Historical help already contains a retirement addition");
  }
  assertOnce(current.stdout, retirementOption);
  assertOnce(current.stdout, retirementFooter);
  assertOnce(current.stdout, option + retirementOption + help);
  assertOnce(current.stdout, warning + notes + retirementFooter);
  assert.ok(current.stdout.endsWith(warning + notes + retirementFooter), "Retirement must follow the unchanged warning and enrollment notes as the final line");
  assert.equal((retirementOption + retirementFooter).split("\n").length - 1, 3);
  assert.equal(Buffer.byteLength(retirementOption + retirementFooter, "utf8"), 308);
  assert.equal(Buffer.byteLength(current.stdout, "utf8") - Buffer.byteLength(historical.stdout, "utf8"), 615);
  // Remove only the mandatory exact retirement components in a fresh local receipt.
  const enrollmentCurrent = {
    status: current.status,
    stdout: current.stdout.replace(retirementOption, "").slice(0, -retirementFooter.length),
    stderr: current.stderr,
  };
  assert.equal(Buffer.byteLength(current.stdout, "utf8") - Buffer.byteLength(enrollmentCurrent.stdout, "utf8"), 308);
  for (const marker of ["--enroll-directory", "authenticated membership observations", "Membership not_observed"]) {
    assert.ok(!historical.stdout.includes(marker), "Historical help already contains an enrollment addition");
  }
  assertOnce(historical.stdout, help);
  assertOnce(enrollmentCurrent.stdout, help);
  assertOnce(enrollmentCurrent.stdout, option);
  assertOnce(enrollmentCurrent.stdout, option + help);
  assertOnce(enrollmentCurrent.stdout, noteOne);
  assertOnce(enrollmentCurrent.stdout, noteTwo);
  assert.ok(historical.stdout.endsWith(warning), "Historical warning must remain the final line");
  assert.ok(enrollmentCurrent.stdout.endsWith(warning + notes), "Enrollment notes must follow the unchanged final warning in order");
  assert.equal(Buffer.byteLength(option + notes, "utf8"), 307);
  assert.equal(Buffer.byteLength(enrollmentCurrent.stdout, "utf8") - Buffer.byteLength(historical.stdout, "utf8"), 307);
  const stdout = enrollmentCurrent.stdout.replace(option, "").slice(0, -notes.length);
  assert.deepEqual({ status: enrollmentCurrent.status, stdout, stderr: enrollmentCurrent.stderr }, historical);
}
