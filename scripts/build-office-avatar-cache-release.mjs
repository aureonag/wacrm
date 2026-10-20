import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {Script} from 'node:vm';
import {buildOfficeScriptBundle} from './office-script-bundle.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const AVATAR_CACHE_BASE_MANIFEST_SHA256 = '6b7e6325aae3523b2d130fce6dc891a4d828e7888946272d7eb7ebf18180775f';
export const AVATAR_CACHE_BASE_SCENE_SHA256 = '8c9fd13c8663f13446711e3db6574b2f7d01d059a3e5c7e7f1e1ee45bf5edd43';
export const AVATAR_CACHE_PRESERVED_SHA256 = Object.freeze({
  'app.js': '4e42afa52a3368b8d10e827aea7c2ce95e03f86cfe6db733a210ab050795a407',
  'index.html': '2cb65e1a7caab13c6515879c2ad562508359f71aa0b0a5fd64b0954a929d5a45',
  'replica-ui.js': '2ebac9104aeb0ce58c0bb486adcedcd431c501e8e6529e3d0abb8f9e9f976465',
  'replica-calls.js': '56861cadb86be065242cce0150a8056efd8df3533e019819d52de6193062c20e',
  'spatial-scene-core.js': '74e79cbbfe5966c4de0d3f03cddd08b9dcc15011540ac5210f2c856d5ab4c191',
  'spatial-publisher-core.js': 'ba2a9b7fe8477d180cbd04b139381f09be345b5d34b55b15e1c492d65f28cb76',
});
export const AVATAR_CACHE_SOURCE_FILES = Object.freeze({'replica-spatial-scene.js': 'replica-spatial-scene.js'});
const replacementPaths = Object.freeze(Object.keys(AVATAR_CACHE_SOURCE_FILES).sort());
const changedPaths = Object.freeze(['office-scripts-bundle.js', ...replacementPaths].sort());

function validateManifest(manifest) {
  if (manifest.version !== 1 || manifest.crmBootstrapVersion !== 1 || manifest.crmSessionRequired !== true ||
    manifest.mapReadOnly !== true || manifest.runtimeBase !== '/api/office/runtime/' || manifest.sourceMutated !== false ||
    manifest.fileCount !== 8495 || !Array.isArray(manifest.files) || manifest.files.length !== 8495 ||
    manifest.scriptBundle?.version !== 1 || manifest.scriptBundle.path !== 'office-scripts-bundle.js' ||
    manifest.scriptBundle.inputScriptCount !== 62 || manifest.scriptBundle.entryScriptCount !== 1 ||
    !Array.isArray(manifest.scriptBundle.inputs) || manifest.scriptBundle.inputs.length !== 62) throw Error('Published v29 runtime contract mismatch');
  const records = new Map(), folded = new Set();
  let total = 0;
  for (const row of manifest.files) {
    if (!row || typeof row.path !== 'string' || !/^[A-Za-z0-9_./-]{1,200}$/.test(row.path) ||
      row.path.split('/').some(part => !part || part === '.' || part === '..') || row.path === 'manifest.json' ||
      folded.has(row.path.toLowerCase()) || !Number.isSafeInteger(row.bytes) || row.bytes < 0 || row.bytes > 64 * 1024 * 1024 ||
      !/^[0-9a-f]{64}$/.test(row.sha256)) throw Error('Invalid frozen file record');
    records.set(row.path, row); folded.add(row.path.toLowerCase()); total += row.bytes;
  }
  if (!Number.isSafeInteger(total) || total !== manifest.outputBytes || total > 1024 * 1024 * 1024) throw Error('Frozen payload total mismatch');
  const inputs = new Set();
  for (const input of manifest.scriptBundle.inputs) {
    const record = records.get(input.path);
    if (!record || inputs.has(input.path) || input.path === 'office-scripts-bundle.js' ||
      input.bytes !== record.bytes || input.sha256 !== record.sha256) throw Error('Frozen bundle input record mismatch');
    inputs.add(input.path);
  }
  for (const [name, sha256] of Object.entries(AVATAR_CACHE_PRESERVED_SHA256)) {
    if (records.get(name)?.sha256 !== sha256) throw Error('Preserved v29 payload mismatch: ' + name);
  }
  if (records.get('replica-spatial-scene.js')?.sha256 !== AVATAR_CACHE_BASE_SCENE_SHA256) throw Error('Published v29 scene record mismatch');
  if (manifest.scriptBundle.outputIndexSha256 !== AVATAR_CACHE_PRESERVED_SHA256['index.html'] ||
    replacementPaths.some(name => !inputs.has(name))) throw Error('Frozen script/index contract mismatch');
  return records;
}

/** Syntax-only rebuild; the source code is compiled, never run by packaging. */
export async function rebuildAvatarCacheBundle(manifest, indexRaw, checked, replacements) {
  if (!Buffer.isBuffer(indexRaw) || typeof checked !== 'function' || !(replacements instanceof Map) ||
    JSON.stringify([...replacements.keys()].sort()) !== JSON.stringify(replacementPaths)) throw Error('Avatar cache replacement allowlist mismatch');
  const overrides = new Map();
  for (const [name, bytes] of replacements) {
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > 64 * 1024 * 1024 ||
      !Buffer.from(bytes.toString('utf8')).equals(bytes)) throw Error('Invalid avatar cache source: ' + name);
    new Script(bytes.toString('utf8'), {filename: name});
    overrides.set(name, Buffer.from(bytes));
  }
  let index = indexRaw.toString('utf8');
  const start = 'aureonOfficeCrmRuntime.start(["/api/office/runtime/office-scripts-bundle.js"]);';
  if (index.split(start).length !== 2) throw Error('Frozen bundle index anchor mismatch');
  index = index.replace(start, 'aureonOfficeCrmRuntime.start(' + JSON.stringify(manifest.scriptBundle.inputs.map(row => '/api/office/runtime/' + row.path)) + ');');
  const scripts = [];
  for (const input of manifest.scriptBundle.inputs) {
    const bytes = overrides.get(input.path) || await checked(input.path);
    scripts.push({...input, text: bytes.toString('utf8'), bytes: bytes.length, sha256: hash(bytes)});
  }
  const bundle = buildOfficeScriptBundle({index, scripts, allowedPaths: new Set(manifest.files.map(row => row.path))});
  if (!Buffer.from(bundle.index).equals(indexRaw)) throw Error('Unexpected index delta');
  overrides.set('office-scripts-bundle.js', Buffer.from(bundle.text));
  return {overrides, bundle};
}

/** Derive one NEW v30 directory only after verifying all8495 frozen v29 files. */
export async function buildAvatarCacheRelease(base, destination) {
  base = path.resolve(base); destination = path.resolve(destination);
  if (destination === base || destination.startsWith(base + path.sep)) throw Error('Frozen input cannot be changed');
  const realBase = await fs.realpath(base), destinationParent = await fs.realpath(path.dirname(destination));
  const realDestination = path.join(destinationParent, path.basename(destination));
  if (realDestination === realBase || realDestination.startsWith(realBase + path.sep)) throw Error('Frozen input cannot be changed through an alias');
  try { await fs.lstat(destination); throw Error('New release destination already exists'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const raw = await fs.readFile(path.join(base, 'manifest.json'));
  if (hash(raw) !== AVATAR_CACHE_BASE_MANIFEST_SHA256) throw Error('Published v29 manifest mismatch');
  const old = JSON.parse(raw), records = validateManifest(old);
  async function checked(name) {
    const record = records.get(name);
    if (!record) throw Error('Unlisted frozen file: ' + name);
    const filename = path.join(base, name), info = await fs.lstat(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== record.bytes) throw Error('Unsafe frozen file: ' + name);
    const bytes = await fs.readFile(filename);
    if (bytes.length !== record.bytes || hash(bytes) !== record.sha256) throw Error('Frozen file changed: ' + name);
    return bytes;
  }
  // Complete the source proof BEFORE creating any output directory or file.
  let baseBytesHashed = 0;
  for (const row of old.files) baseBytesHashed += (await checked(row.path)).length;
  if (baseBytesHashed !== old.outputBytes || hash(await fs.readFile(path.join(base, 'manifest.json'))) !== hash(raw)) throw Error('Frozen input changed during preflight');
  const replacements = new Map();
  for (const [name, source] of Object.entries(AVATAR_CACHE_SOURCE_FILES)) {
    replacements.set(name, await fs.readFile(new URL('./runtime/' + source, import.meta.url)));
  }
  const indexRaw = await checked('index.html');
  const {overrides, bundle} = await rebuildAvatarCacheBundle(old, indexRaw, checked, replacements);
  const next = structuredClone(old);
  next.destination = destination; next.generatedAt = new Date().toISOString(); next.scriptBundle = bundle.metadata;
  next.avatarCacheRelease220 = {
    baseManifestSha256: hash(raw), sourceFiles: {...AVATAR_CACHE_SOURCE_FILES},
    indexUnchanged: true, crmReturnControlUnchanged: true, callsUnchanged: true, spatialCoreUnchanged: true, assetsChanged: 0,
  };
  for (const row of next.files) {
    const bytes = overrides.get(row.path);
    if (!bytes) continue;
    row.bytes = bytes.length; row.sha256 = hash(bytes);
    if (row.path === 'office-scripts-bundle.js') Object.assign(row, bundle.record);
    else (row.adapterRules ??= []).push({rule: 'remote-avatar-cache-220', occurrences: 1});
  }
  const changed = next.files.filter(row => row.sha256 !== records.get(row.path).sha256);
  if (JSON.stringify(changed.map(row => row.path).sort()) !== JSON.stringify(changedPaths)) throw Error('Unexpected avatar cache payload delta');
  for (const [name, sha256] of Object.entries(AVATAR_CACHE_PRESERVED_SHA256)) {
    if (next.files.find(row => row.path === name)?.sha256 !== sha256 || overrides.has(name)) throw Error('Unexpected preserved payload delta: ' + name);
  }
  if (next.files.some(row => row.path.endsWith('.png') && row.sha256 !== records.get(row.path).sha256)) throw Error('Unexpected image delta');
  next.outputBytes = next.files.reduce((sum, row) => sum + row.bytes, 0);
  await fs.mkdir(destination, {recursive: false});
  for (const row of next.files) {
    const bytes = overrides.get(row.path) || await checked(row.path);
    await fs.mkdir(path.dirname(path.join(destination, row.path)), {recursive: true});
    await fs.writeFile(path.join(destination, row.path), bytes, {flag: 'wx'});
  }
  if (hash(await fs.readFile(path.join(base, 'manifest.json'))) !== hash(raw)) throw Error('Frozen manifest changed during write');
  const manifest = Buffer.from(JSON.stringify(next, null, 2) + '\n');
  await fs.writeFile(path.join(destination, 'manifest.json'), manifest, {flag: 'wx'});
  return {manifestSha256: hash(manifest), fileCount: next.fileCount, payloadBytes: next.outputBytes,
    baseFilesHashed: records.size, baseBytesHashed, pngFilesChanged: 0, indexChanged: false, crmReturnUiChanged: false, callsChanged: false, spatialCoreChanged: false,
    changed: changed.map(({path, sha256, bytes}) => ({path, sha256, bytes}))};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) throw Error('Pass the frozen v29 directory and one new destination.');
  console.log(JSON.stringify(await buildAvatarCacheRelease(process.argv[2], process.argv[3]), null, 2));
}
