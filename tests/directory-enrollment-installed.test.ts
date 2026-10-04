import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { temporaryDirectory } from "./helpers.js";

it("ships the enrollment API in a scripts-disabled installed package and preserves built/installed CLI and stored observations", async () => {
  const temporary = temporaryDirectory(), project = resolve("."), prefix = join(temporary, "prefix"), cache = join(temporary, "cache"), env = { ...process.env, NODE_NO_WARNINGS: "1" };
  const invoke = (command: string, args: string[], cwd = temporary) => { const r = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout: 30000, maxBuffer: 16 * 1024 * 1024 }); expect(r.status, r.stderr).toBe(0); return r.stdout; };
  const packed = JSON.parse(invoke("npm", ["--cache", cache, "pack", "--ignore-scripts", "--json", "--pack-destination", temporary], project))[0];
  for (const path of ["dist/db/directory-membership.js", "dist/scanner/directory-census.js", "dist/scanner/directory-enrollment.js"]) expect(packed.files.some((f: { path: string }) => f.path === path)).toBe(true);
  invoke("npm", ["--cache", cache, "install", "--ignore-scripts", "--global", "--prefix", prefix, "--no-audit", "--no-fund", join(temporary, packed.filename)]);
  const installed = join(prefix, "lib/node_modules/agentprof/dist"), built = join(project, "dist");
  async function verify(directory = "") { for (const e of await readdir(join(built, directory), { withFileTypes: true })) { const path = join(directory, e.name); if (e.isDirectory()) await verify(path); else expect((await readFile(join(installed, path))).equals(await readFile(join(built, path)))).toBe(true); } }
  await verify();
  for (const args of [["--version"], ["--help"], ["scan", "--help"], ["insights", "--help"]]) expect(invoke(process.execPath, [join(installed, "agentprof.cjs"), ...args])).toBe(invoke(process.execPath, [join(built, "agentprof.cjs"), ...args]));
  for (const provider of ["codex", "claude"]) {
    const path = join(temporary, provider), data = join(temporary, `${provider}-data`); await mkdir(path);
    await copyFile(fileURLToPath(new URL(`./fixtures/providers/${provider}-real-shapes.jsonl`, import.meta.url)), join(path, "synthetic.jsonl"));
    const program = `const a=JSON.parse(process.argv[1]);const {openDatabase}=await import(a.dist+'db/database.js');const {createIdentityContext}=await import(a.dist+'normalize/identity.js');const {enrollDirectory}=await import(a.dist+'scanner/directory-enrollment.js');const db=await openDatabase(a.data);try{const r=await enrollDirectory(db,createIdentityContext(Buffer.alloc(32,83),'a'.repeat(32)),{provider:a.provider,path:a.path},{patternEvidence:true});process.stdout.write(JSON.stringify(r));}finally{db.close();}`;
    const run = (dist: string) => invoke(process.execPath, ["--input-type=module", "-e", program, JSON.stringify({ dist: pathToFileURL(dist + "/").href, data, path, provider })]);
    expect(JSON.parse(run(installed)).membership.status).toBe("committed");
    const before = await readFile(join(data, "agentprof.sqlite")); const expected = run(built), actual = run(installed);
    expect(actual).toBe(expected); expect(JSON.parse(actual).membership.status).toBe("unchanged"); expect((await readFile(join(data, "agentprof.sqlite"))).equals(before)).toBe(true);
    expect(actual).not.toMatch(/FICTITIOUS_|synthetic\.jsonl|rootFingerprint/);
  }
}, 60000);
