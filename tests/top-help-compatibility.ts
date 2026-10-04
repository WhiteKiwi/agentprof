import assert from "node:assert/strict";
import { types } from "node:util";

export interface TopHelpReceipt { status: number | null; stdout: string; stderr: string }

const usage = "Usage: agentprof [options] [command]\n";
const commands = "Commands:\n";
const history = "  history [options]          Reconcile explicit stored sources and show dated\n"
  + "                             native-call intervals (read-only)\n";
const directory = "  directory [options]        Inspect or explicitly maintain one stored directory\n"
  + "                             membership\n";
const report = "  report [options]           ";

function assertReceipt(value: unknown, name: string): asserts value is TopHelpReceipt {
  assert.ok(value !== null && typeof value === "object", `${name} must be an ordinary receipt`);
  // Reject even revoked proxies before reflection could invoke a trap.
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
  // Type checks precede value assertions so malformed opaque fields are never inspected.
  assert.equal(typeof value.status, "number", `${name} status must be a number`);
  assert.equal(typeof value.stdout, "string", `${name} stdout must be a string`);
  assert.equal(typeof value.stderr, "string", `${name} stderr must be a string`);
  assert.equal(value.status, 0, `${name} must succeed`);
  assert.equal(value.stderr, "", `${name} stderr must be empty`);
  assert.ok(value.stdout.length > 0 && !value.stdout.includes("\r") && value.stdout.endsWith("\n"), `${name} help must preserve LF newlines`);
}

function assertOnce(stdout: string, literal: string): void {
  assert.equal(stdout.split(literal).length, 2, "Expected one exact top-help component");
}

/** Accept only the mandatory 121-byte directory command addition to historical top help. */
export function assertTopHelpDirectoryDelta(current: unknown, historical: unknown): void {
  assertReceipt(current, "current");
  assertReceipt(historical, "historical");
  for (const receipt of [current, historical]) {
    assert.ok(receipt.stdout.startsWith(usage), "Top help must retain the exact Usage prefix");
    for (const anchor of [usage, commands, history, report]) assertOnce(receipt.stdout, anchor);
    assert.ok(receipt.stdout.indexOf(history) > receipt.stdout.indexOf(commands), "History must remain in the Commands section");
    assert.ok(receipt.stdout.indexOf(report) > receipt.stdout.indexOf(commands), "Report must remain in the Commands section");
  }
  for (const marker of ["  directory [options]", "Inspect or explicitly maintain one stored directory", "\n                             membership\n"]) {
    assert.ok(!historical.stdout.includes(marker), "Historical top help already contains a directory addition");
  }
  assertOnce(current.stdout, directory);
  assertOnce(current.stdout, history + directory + report);
  assertOnce(historical.stdout, history + report);
  assert.equal(directory.split("\n").length - 1, 2);
  assert.equal(Buffer.byteLength(directory, "utf8"), 121);
  assert.equal(Buffer.byteLength(current.stdout, "utf8") - Buffer.byteLength(historical.stdout, "utf8"), 121);
  const normalized = { status: current.status, stdout: current.stdout.replace(directory, ""), stderr: current.stderr };
  assert.deepEqual(normalized, historical);
}
