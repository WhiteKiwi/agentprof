import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { censusDirectory } from "../src/scanner/directory-census.js";
import { temporaryDirectory } from "./helpers.js";

it("counts unrelated files against the complete entry bound", async () => {
  const root = temporaryDirectory(); for (let i = 0; i < 4095; i++) await writeFile(join(root, `ignored-${i}.txt`), "");
  expect((await censusDirectory(root)).paths).toEqual([]); await writeFile(join(root, "overflow.txt"), ""); await expect(censusDirectory(root)).rejects.toMatchObject({ reason: "limit" });
});
it("bounds all traversed directories and refuses symlink ancestors", async () => {
  const root = temporaryDirectory(); for (let i = 0; i < 255; i++) await mkdir(join(root, `dir-${i}`));
  expect((await censusDirectory(root)).directories.size).toBe(256); await mkdir(join(root, "overflow")); await expect(censusDirectory(root)).rejects.toMatchObject({ reason: "limit" });
  const outside = temporaryDirectory(), alias = join(outside, "alias"); await symlink(root, alias); await expect(censusDirectory(alias)).rejects.toMatchObject({ reason: "unsafe_entry" });
});
it("cancels without returning a partial authoritative snapshot", async () => {
  const root = temporaryDirectory(), c = new AbortController(); c.abort(); await expect(censusDirectory(root, c.signal)).rejects.toMatchObject({ reason: "aborted" });
});
