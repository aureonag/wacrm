import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { planOfficeRelease, packageOfficeRelease, runOfficeReleaseCli } from "./package-office-release.mjs";
const execute = promisify(execFile), hash = bytes => createHash("sha256").update(bytes).digest("hex");
const pythonExecutable = process.env.AUREON_RELEASE_PYTHON;
const packageBytes = Buffer.from(JSON.stringify({ private: true, type: "commonjs", engines: { node: ">=20" } }, null, 2) + "\n");
async function fixture(t, runtimePath = "app.js") {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), "aureon-office-release-"));
 t.after(async () => { const absolute = path.resolve(root); assert.equal(path.dirname(absolute), path.resolve(os.tmpdir()));
  assert.match(path.basename(absolute), /^aureon-office-release-/); assert.equal((await fs.lstat(absolute)).isSymbolicLink(), false); await fs.rm(absolute, { recursive: true }); });
 const runtimeDirectory = path.join(root, "runtime-input"), gatewayDirectory = path.join(root, "gateway-input");
 await fs.mkdir(runtimeDirectory); await fs.mkdir(gatewayDirectory);
 const app = Buffer.from("/* fixture only */"), start = Buffer.from("/* inert fixture entrypoint */"), docker = Buffer.from("# fictional draft\nFROM node:20-alpine\n");
 const runtime = { version: 1, mode: "written", crmBootstrapVersion: 1, crmSessionRequired: true, fileCount: 1,
  files: [{ path: runtimePath, bytes: app.length, sha256: hash(app) }] };
 const gateway = { version: 1, mode: "written", target: "node20", format: "commonjs", nodeModulesRequiredAtRuntime: false,
  files: [{ path: "start.mjs", bytes: start.length, sha256: hash(start) }] };
 const runtimeRaw = Buffer.from(JSON.stringify(runtime)), gatewayRaw = Buffer.from(JSON.stringify(gateway));
 await fs.writeFile(path.join(runtimeDirectory, "manifest.json"), runtimeRaw); await fs.writeFile(path.join(runtimeDirectory, "app.js"), app);
 await fs.writeFile(path.join(gatewayDirectory, "gateway-build.json"), gatewayRaw); await fs.writeFile(path.join(gatewayDirectory, "start.mjs"), start); await fs.writeFile(path.join(gatewayDirectory, "package.json"), packageBytes);
 const dockerfile = path.join(root, "Dockerfile.draft"); await fs.writeFile(dockerfile, docker);
 // Private neighbors must never be read or included; the plan uses only manifested names.
 await fs.writeFile(path.join(runtimeDirectory, ".env"), "DO_NOT_READ=fixture"); await fs.writeFile(path.join(gatewayDirectory, "logs.txt"), "DO_NOT_INCLUDE");
 return { root, runtimeDirectory, gatewayDirectory, dockerfile, destination: path.join(root, "one.tar.gz"), pythonExecutable,
  pins: { runtimeManifestSha256: hash(runtimeRaw), gatewayManifestSha256: hash(gatewayRaw), dockerfileSha256: hash(docker), runtimeFiles: 1, gatewayFiles: 1 }, gatewayPaths: ["start.mjs"] };
}
test("plan is a deterministic closed file list; only three archive roots and no private neighbors", async t => {
 const f = await fixture(t), plan = await packageOfficeRelease(f);
 assert.equal(plan.mode, "dry-run"); assert.equal(plan.reviewedProductionPins, false);
 assert.deepEqual(plan.entries.map(entry => entry.name), ["Dockerfile", "gateway-build/gateway-build.json", "gateway-build/package.json", "gateway-build/start.mjs", "runtime/app.js", "runtime/manifest.json"]);
 assert.deepEqual(plan.directories, ["gateway-build/", "runtime/"]); assert.ok(plan.entries.every(entry => entry.mode === 0o644));
 await assert.rejects(fs.stat(f.destination), { code: "ENOENT" });
});
test("rejects content drift, wrong self pins and unexpected gateway records before creating output", async t => {
 const f = await fixture(t); await fs.appendFile(path.join(f.runtimeDirectory, "app.js"), "drift");
 await assert.rejects(packageOfficeRelease({ ...f, write: true }), /drift/); await assert.rejects(fs.stat(f.destination), { code: "ENOENT" });
 const other = await fixture(t);
 await assert.rejects(planOfficeRelease({ ...other, pins: { ...other.pins, runtimeManifestSha256: "0".repeat(64) } }), /hash drift/);
 await assert.rejects(planOfficeRelease({ ...other, gatewayPaths: ["extra.js"] }), /allowlist drift/);
});
test("refuses traversal, absolute/encoded/hidden names and non-USTAR basenames", async t => {
 for (const name of ["../private.txt", "/absolute.png", "C:/private.png", "assets/%2e%2e/private.png", ".env", "a".repeat(101)]) {
  const f = await fixture(t, name); await assert.rejects(planOfficeRelease(f), /unsafe archive name|cannot fit USTAR/);
  await assert.rejects(fs.stat(f.destination), { code: "ENOENT" });
 }
});
test("never overwrites destinations or permits in-source output/CLI pin bypass", async t => {
 const f = await fixture(t); await fs.writeFile(f.destination, "preserve");
 await assert.rejects(packageOfficeRelease({ ...f, write: true }), /destination exists/); assert.equal(await fs.readFile(f.destination, "utf8"), "preserve");
 await assert.rejects(planOfficeRelease({ ...f, destination: path.join(f.runtimeDirectory, "inside.tar.gz") }), /overlaps input/);
 await assert.rejects(runOfficeReleaseCli(["--pins", "forged"]), /invalid CLI/);
});
test("stdlib Python writes deterministic USTAR/gzip with readable modes and no filesystem extraction", { skip: !pythonExecutable }, async t => {
 const f = await fixture(t);
 // Creation and modification differ on purpose: Windows path/handle ctime is inconsistent.
 await fs.utimes(path.join(f.runtimeDirectory, "app.js"), new Date("2000-01-01T00:00:00Z"), new Date("2000-01-01T00:00:00Z"));
 const first = await packageOfficeRelease({ ...f, write: true });
 const second = await packageOfficeRelease({ ...f, destination: path.join(f.root, "two.tar.gz"), write: true });
 assert.equal(first.archiveSha256, second.archiveSha256); assert.equal(first.fileCount, 6); assert.equal(first.entryCount, 8);
 assert.equal(first.archiveRoundTripHashesExact, true); assert.equal(first.sourceHashesBeforeAndAfterExact, true); assert.equal(first.transferPerformed, false); assert.equal(first.extractionPerformed, false);
 const code = "import tarfile,json,sys; t=tarfile.open(sys.argv[1],'r:gz'); print(json.dumps([{'name':m.name,'mode':m.mode,'uid':m.uid,'gid':m.gid,'mtime':m.mtime,'directory':m.isdir(),'regular':m.isfile()} for m in t.getmembers()])); t.close()";
 const inspected = await execute(pythonExecutable, ["-I", "-S", "-c", code, f.destination], { windowsHide: true });
 const members = JSON.parse(inspected.stdout); assert.equal(members.length, 8);
 assert.ok(members.every(member => (member.directory || member.regular) && member.mode === (member.directory ? 0o755 : 0o644) && member.uid === 0 && member.gid === 0 && member.mtime === 0));
 assert.ok(members.every(member => ["Dockerfile", "gateway-build", "runtime"].includes(member.name.split("/")[0])));
 await assert.rejects(packageOfficeRelease({ ...f, write: true }), /destination exists/);
});
