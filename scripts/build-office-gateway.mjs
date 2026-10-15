#!/usr/bin/env node
/** Offline, explicit allowlist. Transpiles syntax only; full CRM typecheck is a separate check. */
import * as fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { builtinModules, createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url), ts = require("typescript");
const DEFAULT_SOURCE = fileURLToPath(new URL("../", import.meta.url));
export const OFFICE_GATEWAY_BUILD_FILES = Object.freeze([
  "src/lib/auth/roles.ts",
  "src/lib/office/gateway/contracts.ts", "src/lib/office/gateway/protocol.ts",
  "src/lib/office/gateway/store-callback.ts", "src/lib/office/gateway/node-server.ts",
  "src/lib/office/runtime/assets.ts", "src/lib/office/runtime/avatar-composition.ts",
  "src/lib/office/runtime/service.cjs", "src/lib/office/runtime/map.cjs", "src/lib/office/runtime/client-state.cjs",
  "src/lib/office/runtime/vendor/interface-api.cjs", "src/lib/office/runtime/vendor/spotify-links.js",
  "src/lib/office/runtime/vendor/avatar-portrait.cjs", "src/lib/office/runtime/vendor/profile-details-core.js",
  "src/lib/office/runtime/vendor/spatial-presence-core.cjs", "src/lib/office/runtime/vendor/spatial-room-core.js",
  "src/lib/office/runtime/seeds/approved-map.json", "scripts/start-office-gateway.mjs",
]);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const outputPath = name => name === "scripts/start-office-gateway.mjs" ? "start.mjs" : name.slice(4).replace(/\.ts$/, ".js");
const builtins = new Set(builtinModules.flatMap(name => [name, "node:" + name]));
function fail(message) { throw Error("Office gateway build: " + message); }
async function noSymlinkAncestors(absolute) {
  const parsed = path.parse(absolute); let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part); const info = await fs.lstat(current).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (!info) break; if (info.isSymbolicLink()) fail("symlink/junction path is forbidden");
  }
}
async function locations(sourceRoot, destination) {
  if (typeof sourceRoot !== "string" || typeof destination !== "string" || !destination) fail("source and explicit destination required");
  const source = path.resolve(sourceRoot), dest = path.resolve(destination);
  if (dest === source || dest === path.parse(dest).root || dest.split(/[\\/]/).some(part => /^(?:public|public_html|\.git|node_modules|\.env(?:\..*)?|\.aureon-local)$/i.test(part))) fail("unsafe destination");
  await noSymlinkAncestors(source); await noSymlinkAncestors(dest);
  if (!(await fs.stat(source)).isDirectory() || !(await fs.stat(path.dirname(dest))).isDirectory()) fail("directories must exist");
  if (await fs.lstat(dest).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; })) fail("destination already exists; never overwrite a build");
  return { source, dest };
}
function inspectEdges(name, text, allowed) {
  if (name.endsWith(".json")) return [];
  const tree = ts.createSourceFile(name, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS), edges = [];
  if (tree.parseDiagnostics.length) fail("invalid emitted JavaScript: " + name);
  function edge(request) {
    if (builtins.has(request)) { edges.push({ from: name, request, builtin: true }); return; }
    if (!request.startsWith("./") && !request.startsWith("../")) fail("external dependency forbidden: " + request);
    let resolved = path.posix.normalize(path.posix.join(path.posix.dirname(name), request));
    if (!path.posix.extname(resolved)) resolved += ".js";
    if (!allowed.has(resolved)) fail("unlisted module edge: " + name + " -> " + request);
    edges.push({ from: name, request, to: resolved });
  }
  function visit(node) {
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require")) {
      if (node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0])) fail("dynamic module loading forbidden: " + name);
      edge(node.arguments[0].text);
    }
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) && node.moduleSpecifier) {
      if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) fail("invalid module import");
      edge(node.moduleSpecifier.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree); return edges;
}
export async function buildOfficeGateway({ sourceRoot = DEFAULT_SOURCE, destination, write = false } = {}) {
  if (typeof write !== "boolean") fail("invalid write option");
  const { source, dest } = await locations(sourceRoot, destination);
  const outputs = [], allowed = new Set(OFFICE_GATEWAY_BUILD_FILES.map(outputPath));
  for (const name of OFFICE_GATEWAY_BUILD_FILES) {
    const absolute = path.join(source, ...name.split("/")); await noSymlinkAncestors(absolute);
    const info = await fs.stat(absolute); if (!info.isFile() || info.size > 4 * 1024 * 1024) fail("invalid source file: " + name);
    const input = await fs.readFile(absolute), text = new TextDecoder("utf-8", { fatal: true }).decode(input);
    let bytes = input;
    if (name.endsWith(".ts")) {
      const result = ts.transpileModule(text, { fileName: name, reportDiagnostics: true,
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, sourceMap: false, declaration: false } });
      if (result.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error)) fail("transpile diagnostic: " + name);
      bytes = Buffer.from(result.outputText, "utf8");
    } else if (name.endsWith(".json")) {
      const seed = JSON.parse(text);
      if (seed.version !== 2 || !seed.map || !Array.isArray(seed.map.objects) || !Array.isArray(seed.map.construction)) fail("invalid approved map seed");
    }
    outputs.push({ source: name, path: outputPath(name), sourceSha256: hash(input), sha256: hash(bytes), bytes: bytes.length, content: bytes });
  }
  const moduleEdges = outputs.flatMap(file => inspectEdges(file.path, file.content.toString("utf8"), allowed));
  const records = outputs.map(file => ({ source: file.source, path: file.path, sourceSha256: file.sourceSha256, sha256: file.sha256, bytes: file.bytes }));
  const summary = { version: 1, target: "node20", format: "commonjs", mode: write ? "written" : "dry-run", sourceRoot: source, destination: dest,
    typecheckPerformed: false, configRead: false, databaseAccess: false, assetBundleIncluded: false, runtimePackageRequiredSeparately: true,
    nodeModulesRequiredAtRuntime: false, files: records, moduleEdges };
  if (write) {
    // Re-read only the exact allowlist; reject drift before creating any output.
    for (const file of outputs) if (hash(await fs.readFile(path.join(source, file.source))) !== file.sourceSha256) fail("source changed during build");
    await fs.mkdir(dest);
    for (const file of outputs) { const target = path.join(dest, file.path); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, file.content, { flag: "wx" }); }
    await fs.writeFile(path.join(dest, "package.json"), JSON.stringify({ private: true, type: "commonjs", engines: { node: ">=20" } }, null, 2) + "\n", { flag: "wx" });
    await fs.writeFile(path.join(dest, "gateway-build.json"), JSON.stringify({ ...summary, generatedAt: new Date().toISOString() }, null, 2) + "\n", { flag: "wx" });
  }
  return summary;
}
export async function runGatewayBuildCli(args) {
  let destination, write = false, mode;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dest" && destination === undefined && args[i + 1] && !args[i + 1].startsWith("--")) destination = args[++i];
    else if ((args[i] === "--write" || args[i] === "--dry-run") && mode === undefined) { mode = args[i]; write = mode === "--write"; }
    else fail("usage: --dest NEW_DIRECTORY [--dry-run | --write]");
  }
  return buildOfficeGateway({ destination, write });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runGatewayBuildCli(process.argv.slice(2)).then(result => console.log(JSON.stringify({ ...result, files: result.files.length, moduleEdges: result.moduleEdges.length }, null, 2)))
    .catch(() => { console.error("Office gateway build failed. Review the explicit inputs and new destination."); process.exitCode = 1; });
}
