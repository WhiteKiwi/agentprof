import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

const directories: string[] = [];
export function temporaryDirectory(): string {
  // /var is a platform symlink on macOS; use its physical path for strict input tests.
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "agentprof-test-")));
  directories.push(directory);
  return directory;
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
