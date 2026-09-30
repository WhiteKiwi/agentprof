import { chmod, copyFile, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const metadata = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
await rm(new URL("dist/", root), { recursive: true, force: true });
execFileSync(process.execPath, [fileURLToPath(new URL("node_modules/typescript/bin/tsc", root)), "-p", "tsconfig.json"], { cwd: fileURLToPath(root), stdio: "inherit" });
await copyFile(new URL("bin/agentprof.cjs", root), new URL("dist/agentprof.cjs", root));
await chmod(fileURLToPath(new URL("dist/agentprof.cjs", root)), 0o755);
await writeFile(new URL("dist/cli/version.js", root), `export const VERSION = ${JSON.stringify(metadata.version)};\n`);
