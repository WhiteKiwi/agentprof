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

/** Accept only PR156's declared 307-byte addition to genuine pre-enrollment help. */
export function assertScanHelpEnrollmentDelta(current: unknown, historical: unknown): void {
  assertReceipt(current, "current");
  assertReceipt(historical, "historical");
  for (const marker of ["--enroll-directory", "authenticated membership observations", "Membership not_observed"]) {
    assert.ok(!historical.stdout.includes(marker), "Historical help already contains an enrollment addition");
  }
  assertOnce(historical.stdout, help);
  assertOnce(current.stdout, help);
  assertOnce(current.stdout, option);
  assertOnce(current.stdout, option + help);
  assertOnce(current.stdout, noteOne);
  assertOnce(current.stdout, noteTwo);
  assert.ok(historical.stdout.endsWith(warning), "Historical warning must remain the final line");
  assert.ok(current.stdout.endsWith(warning + notes), "Enrollment notes must follow the unchanged final warning in order");
  assert.equal(Buffer.byteLength(option + notes, "utf8"), 307);
  assert.equal(Buffer.byteLength(current.stdout, "utf8") - Buffer.byteLength(historical.stdout, "utf8"), 307);
  const stdout = current.stdout.replace(option, "").slice(0, -notes.length);
  assert.deepEqual({ status: current.status, stdout, stderr: current.stderr }, historical);
}
