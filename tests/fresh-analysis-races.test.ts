import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import * as scanner from "../src/cli/scan.js";
import { runFreshAnalysis } from "../src/cli/fresh-analysis.js";
import { withReadOnlyStore } from "../src/db/read-only.js";
import { createSourceStore } from "../src/db/source-store.js";
import { freshFixture, appendExecution } from "./fresh-analysis-fixture.js";
import { bytes } from "./recovery-fixture.js";

afterEach(() => vi.restoreAllMocks());
it.each(["history", "patterns"] as const)("%s refuses a real second source commit between scan and analysis", async command => {
  const x = await freshFixture(command), collect = scanner.collectScan;
  let laterBytes: Awaited<ReturnType<typeof bytes>> = [];
  vi.spyOn(scanner, "collectScan").mockImplementationOnce(async (...args) => {
    const first = await collect(...args);
    await appendExecution(x.input, x.provider);
    const second = await collect(...args);
    expect(first.sources[0]!.committedRevision).toBe(1);
    expect(second.sources[0]!.committedRevision).toBe(2);
    laterBytes = await bytes(x.data);
    return first;
  });
  const result = await runFreshAnalysis(command, x.options);
  expect(result.generation?.revision).toBe(1);
  expect(result.report).toMatchObject({ status: "failed", error: { code: "SOURCE_REVISION_CHANGED" } });
  expect(existsSync(x.output)).toBe(false);
  expect(await bytes(x.data)).toEqual(laterBytes);
  const revision = await withReadOnlyStore(x.data, (db, key) => createSourceStore(db, key).readSource(result.generation!.sourceId)!.revision);
  expect(revision).toBe(2);
});
it("an output created after preflight cannot be overwritten and retains the scan receipt", async () => {
  const x = await freshFixture(), collect = scanner.collectScan;
  vi.spyOn(scanner, "collectScan").mockImplementationOnce(async (...args) => {
    const receipt = await collect(...args);
    await writeFile(x.output, "EXISTING USER FILE");
    return receipt;
  });
  const result = await runFreshAnalysis("patterns", x.options);
  expect(result.report).toMatchObject({ status: "failed", error: { code: "REPORT_OUTPUT_UNSAFE" } });
  expect(result.scan.counts.committed).toBe(1);
  expect(await readFile(x.output, "utf8")).toBe("EXISTING USER FILE");
});
