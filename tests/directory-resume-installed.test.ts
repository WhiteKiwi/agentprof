import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { temporaryDirectory } from "./helpers.js";
const root = fileURLToPath(new URL("../", import.meta.url));
const env = { ...process.env, PATH: dirname(process.execPath) + ":" + process.env.PATH, NODE_OPTIONS: "--no-warnings" };
let installed: string, packageDirectory: string;
afterAll(() => { if (packageDirectory) rmSync(packageDirectory, { recursive: true, force: true }); });
// This package is installed and exercised, never published. All inputs are synthetic.
beforeAll(() => {
  const directory = packageDirectory = realpathSync(mkdtempSync(join(tmpdir(), "agentprof-resume-package-"))), prefix = join(directory, "prefix"), cache = join(directory, "cache");
  const npm = (args: string[]) => execFileSync("npm", args, { cwd: root, env, encoding: "utf8", timeout: 30000 });
  const packed = JSON.parse(npm(["pack", "--ignore-scripts", "--json", "--pack-destination", directory]))[0];
  npm(["install", "--global", "--prefix", prefix, "--cache", cache, "--ignore-scripts", "--no-audit", "--no-fund", join(directory, packed.filename)]);
  installed = join(prefix, "lib/node_modules/agentprof/dist");
  expect(readFileSync(join(installed, "db/directory-resume.js"))).toEqual(readFileSync(join(root, "dist/db/directory-resume.js")));
}, 40000);

const probe = `
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const [dist,data,provider] = process.argv.slice(1);
const load = path => import(pathToFileURL(dist+"/"+path));
const {loadOrCreateIdentityContext} = await load("normalize/identity.js");
const {openDatabase} = await load("db/database.js");
const {createDirectoryResumeStore} = await load("db/directory-resume.js");
const {createDirectoryMembershipStore} = await load("db/directory-membership.js");
const c = await loadOrCreateIdentityContext(data), key = readFileSync(data+"/identity-key.json"), db = await openDatabase(data);
try {
 const rootId=c.fingerprint("source",["SYNTHETIC_ROOT"]),rootFingerprint=c.fingerprint("content",["root"]);
 const roots=createDirectoryMembershipStore(db,c);
 roots.capture({rootId,provider,rootFingerprint,observed:[]},null);
 const tables=db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name!='directory_batch_resume' ORDER BY name").all();
 const rows=()=>tables.map(({name})=>[name,db.prepare('SELECT * FROM "'+name+'" ORDER BY rowid').all()]);
 const before=JSON.stringify(rows()), store=createDirectoryResumeStore(db,c);
 const value={rootId,provider,rootFingerprint,membershipRevision:1,captureMode:"pattern",censusCount:1,nextOffset:1,censusFingerprint:c.fingerprint("content",["census"]),prefixFingerprint:c.fingerprint("content",["prefix"])};
 const saved=store.save(value,null);
 if(saved.status!=="committed"||JSON.stringify(saved.cursor)!==JSON.stringify(store.read(rootId)))throw Error("roundtrip");
 if(store.save(value,saved.cursor.seal).status!=="unchanged")throw Error("idempotence");
 if(store.remove(rootId,saved.cursor.seal).status!=="committed"||store.read(rootId)!==null)throw Error("remove");
 if(JSON.stringify(rows())!==before||!readFileSync(data+"/identity-key.json").equals(key))throw Error("preservation");
 process.stdout.write(JSON.stringify({provider,schema:db.prepare("PRAGMA user_version").get().user_version,roundtrip:true,preserved:true}));
}finally{db.close();}`;

it.each(["codex", "claude"] as const)("scripts-disabled installed %s resume store preserves native source history", provider => {
  // Only case-specific data is removed by temporaryDirectory's afterEach cleanup.
  const directory = temporaryDirectory(), data = join(directory, "data"), logs = join(directory, "logs"); mkdirSync(logs);
  copyFileSync(join(root, "tests/fixtures/providers", provider + "-real-shapes.jsonl"), join(logs, "input.jsonl"));
  const scan = spawnSync(process.execPath, [join(installed, "agentprof.cjs"), "scan", "--" + provider + "-root", logs, "--data-dir", data, "--json"], { env, encoding: "utf8", timeout: 15000 });
  expect(scan.status).toBe(1); expect(JSON.parse(scan.stdout).result.counts.committed).toBe(1); rmSync(logs, { recursive: true });
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", probe, installed, data, provider], { env, encoding: "utf8", timeout: 15000 });
  expect(result.status, result.stderr).toBe(0); expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toEqual({ provider, schema: 8, roundtrip: true, preserved: true });
  const read = spawnSync(process.execPath, [join(installed, "agentprof.cjs"), "stats", "--list-sources", "--data-dir", data, "--json"], { env, encoding: "utf8" });
  expect(read.status).toBe(0); expect(JSON.parse(read.stdout).result.catalogue.returnedCount).toBe(1);
}, 30000);
