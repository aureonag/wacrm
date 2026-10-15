import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildOfficeGateway, OFFICE_GATEWAY_BUILD_FILES, runGatewayBuildCli } from "./build-office-gateway.mjs";
import { parseGatewayArguments } from "./start-office-gateway.mjs";
const repo = fileURLToPath(new URL("../", import.meta.url));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "aureon-gateway-build-"));
  t.after(async () => { const absolute = path.resolve(directory);
    assert.equal(path.dirname(absolute), path.resolve(os.tmpdir())); assert.match(path.basename(absolute), /^aureon-gateway-build-/);
    assert.equal((await fs.lstat(absolute)).isSymbolicLink(), false); await fs.rm(absolute, { recursive: true }); });
  return directory;
}
async function sourceFixture(t) {
  const root = await temporary(t), sourceRoot = path.join(root, "source"); await fs.mkdir(sourceRoot);
  for (const name of OFFICE_GATEWAY_BUILD_FILES) { const target = path.join(sourceRoot, name); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.copyFile(path.join(repo, name), target); }
  await fs.writeFile(path.join(sourceRoot, ".env"), "NEVER_READ=fixture");
  return { root, sourceRoot, destination: path.join(root, "output") };
}
test("offline dry-run has a closed allowlist, erased CRM type imports and no external runtime dependencies", async t => {
  const root = await temporary(t), destination = path.join(root, "output");
  const plan = await buildOfficeGateway({ destination });
  assert.equal(plan.mode, "dry-run"); assert.equal(plan.typecheckPerformed, false); assert.equal(plan.configRead, false);
  assert.equal(plan.nodeModulesRequiredAtRuntime, false); assert.equal(plan.assetBundleIncluded, false);
  assert.equal(plan.files.length, OFFICE_GATEWAY_BUILD_FILES.length);
  assert.ok(plan.files.every(file => !/\.test\.|access\.js|client\.js|backend-store|node_modules|\.env/.test(file.path)));
  assert.ok(plan.moduleEdges.every(edge => edge.builtin || plan.files.some(file => file.path === edge.to)));
  assert.ok(!plan.moduleEdges.some(edge => /supabase|next\/|access/.test(edge.request)));
  await assert.rejects(fs.stat(destination), { code: "ENOENT" });
});
test("writes standalone CommonJS owned bytes, validates hashes and loads the server without starting it", async t => {
  const f = await sourceFixture(t), before = new Map();
  for (const name of OFFICE_GATEWAY_BUILD_FILES) before.set(name, hash(await fs.readFile(path.join(f.sourceRoot, name))));
  const result = await buildOfficeGateway({ ...f, write: true });
  for (const record of result.files) { assert.equal(hash(await fs.readFile(path.join(f.destination, record.path))), record.sha256);
    assert.equal(hash(await fs.readFile(path.join(f.sourceRoot, record.source))), before.get(record.source)); }
  assert.equal(JSON.parse(await fs.readFile(path.join(f.destination, "package.json"), "utf8")).type, "commonjs");
  const manifest = JSON.parse(await fs.readFile(path.join(f.destination, "gateway-build.json"), "utf8"));
  assert.equal(manifest.target, "node20"); assert.equal(manifest.mode, "written");
  const requireBuilt = createRequire(path.join(f.destination, "package.json"));
  assert.equal(typeof requireBuilt("./lib/office/gateway/node-server.js").createOfficeGatewayServer, "function");
  assert.equal(typeof (await import(pathToFileURL(path.join(f.destination, "start.mjs")).href)).startOfficeGateway, "function");
  await assert.rejects(fs.stat(path.join(f.destination, "node_modules")), { code: "ENOENT" });
  await assert.rejects(fs.stat(path.join(f.destination, ".env")), { code: "ENOENT" });
  await assert.rejects(buildOfficeGateway({ ...f, write: true }), /already exists/);
});
test("rejects external, unknown and dynamic module edges before creating output", async t => {
  for (const statement of ['require("@supabase/supabase-js");', 'require("./not-allowed.js");', 'require(process.env.FORGED_MODULE);']) {
    const f = await sourceFixture(t); await fs.appendFile(path.join(f.sourceRoot, "src/lib/office/runtime/service.cjs"), "\n" + statement);
    await assert.rejects(buildOfficeGateway({ ...f, write: true }), /dependency forbidden|unlisted module edge|dynamic module loading/);
    await assert.rejects(fs.stat(f.destination), { code: "ENOENT" });
  }
});
test("refuses unsafe locations, unreviewed flags and malformed seed; CLI is dry-run by default", async t => {
  const f = await sourceFixture(t);
  for (const destination of [f.sourceRoot, path.join(f.root, "public", "out"), path.join(f.root, ".git", "out")]) await assert.rejects(buildOfficeGateway({ ...f, destination }), /unsafe destination/);
  await assert.rejects(runGatewayBuildCli(["--dest", f.destination, "--source", f.sourceRoot]), /usage/);
  await assert.rejects(runGatewayBuildCli(["--dest", f.destination, "--write", "--dry-run"]), /usage/);
  const plan = await runGatewayBuildCli(["--dest", f.destination]); assert.equal(plan.mode, "dry-run");
  await fs.writeFile(path.join(f.sourceRoot, "src/lib/office/runtime/seeds/approved-map.json"), '{"version":2,"map":{}}');
  await assert.rejects(buildOfficeGateway({ ...f, write: true }), /invalid approved map seed/);
  await assert.rejects(fs.stat(f.destination), { code: "ENOENT" });
});
test("entrypoint defaults to loopback4194; public bind requires an explicit future-container option", () => {
  assert.deepEqual(parseGatewayArguments([]), { host: "127.0.0.1", port: 4194 });
  assert.deepEqual(parseGatewayArguments(["--host", "0.0.0.0", "--allow-container-bind", "--port", "4194"]), { host: "0.0.0.0", port: 4194 });
  for (const args of [["--host", "0.0.0.0"], ["--host", "example.com"], ["--port", "80"], ["--port", "65536"], ["--port", "4194", "--port", "4195"], ["--secret", "fixture"]]) assert.throws(() => parseGatewayArguments(args));
});
