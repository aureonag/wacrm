import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {Script} from 'node:vm';
import {buildOfficeScriptBundle} from './office-script-bundle.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const NETWORK_STABILITY_BASE_MANIFEST_SHA256 = '3e6c00cee22577ecd0110d1169c07075451b7cd1feddaa9d18ff8fe23e3cb7af';
export const NETWORK_STABILITY_PRESERVED_SHA256 = Object.freeze({
  'index.html': '2cb65e1a7caab13c6515879c2ad562508359f71aa0b0a5fd64b0954a929d5a45',
});
export const NETWORK_STABILITY_BASE_UI_SHA256 = 'b97a175d05d61a9cc8a45888fc24d526d7579b34089f865ee020cabebdfed161';
export const NETWORK_STABILITY_UI_ERROR_REPLACEMENT = Object.freeze([
  "(endpoint==='signals'&&body===undefined||endpoint==='signal'&&body!==undefined)",
  "(endpoint==='signals'&&body===undefined||['signal','call-session'].includes(endpoint)&&body!==undefined)",
]);
const crmReturn = "const rail=document.querySelector('.rail'),brand=el('a','r-brand','au');brand.href='/dashboard';brand.target='_top';brand.title='Voltar ao CRM';brand.setAttribute('aria-label','Voltar ao CRM');Object.assign(brand.style,{color:'inherit',textDecoration:'none'});rail.prepend(brand);";
export const NETWORK_STABILITY_SOURCE_FILES = Object.freeze({
  'replica-calls.js': 'replica-calls-proximity.js',
  'spatial-scene-core.js': 'spatial-scene-core.js',
});
const replacementPaths = Object.freeze(['replica-ui.js', ...Object.keys(NETWORK_STABILITY_SOURCE_FILES)].sort());
const changedPaths = Object.freeze(['office-scripts-bundle.js', ...replacementPaths].sort());

/** Keep only the known signaling code for call-session409 as well as signals. */
export function patchNetworkStabilityUi(source) {
  if (typeof source !== 'string' || hash(source) !== NETWORK_STABILITY_BASE_UI_SHA256) throw Error('Published v27 UI hash mismatch');
  if (source.split(NETWORK_STABILITY_UI_ERROR_REPLACEMENT[0]).length !== 2 || source.split(crmReturn).length !== 2) throw Error('Frozen UI signaling/CRM return anchor mismatch');
  const next = source.replace(...NETWORK_STABILITY_UI_ERROR_REPLACEMENT);
  if (next.split(crmReturn).length !== 2) throw Error('Unexpected CRM return control delta');
  return next;
}

function validateManifest(manifest) {
  if (manifest.version !== 1 || manifest.crmBootstrapVersion !== 1 || manifest.crmSessionRequired !== true ||
    manifest.mapReadOnly !== true || manifest.runtimeBase !== '/api/office/runtime/' || manifest.sourceMutated !== false ||
    manifest.fileCount !== 8495 || !Array.isArray(manifest.files) || manifest.files.length !== 8495 ||
    manifest.scriptBundle?.version !== 1 || manifest.scriptBundle.path !== 'office-scripts-bundle.js' ||
    manifest.scriptBundle.inputScriptCount !== 62 || manifest.scriptBundle.entryScriptCount !== 1 ||
    !Array.isArray(manifest.scriptBundle.inputs) || manifest.scriptBundle.inputs.length !== 62) throw Error('Published v27 runtime contract mismatch');
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
  for (const [name, sha256] of Object.entries(NETWORK_STABILITY_PRESERVED_SHA256)) {
    if (records.get(name)?.sha256 !== sha256) throw Error('Preserved v27 payload mismatch: ' + name);
  }
  if (records.get('replica-ui.js')?.sha256 !== NETWORK_STABILITY_BASE_UI_SHA256) throw Error('Published v27 UI record mismatch');
  if (manifest.scriptBundle.outputIndexSha256 !== NETWORK_STABILITY_PRESERVED_SHA256['index.html'] ||
    Object.keys(NETWORK_STABILITY_SOURCE_FILES).some(name => !inputs.has(name)) || !inputs.has('replica-ui.js')) throw Error('Frozen script/index contract mismatch');
  return records;
}

/** Syntax-only rebuild, exposed for small synthetic fixtures; no office code runs. */
export async function rebuildNetworkStabilityBundle(manifest, indexRaw, checked, replacements) {
  if (!Buffer.isBuffer(indexRaw) || typeof checked !== 'function' || !(replacements instanceof Map) ||
    JSON.stringify([...replacements.keys()].sort()) !== JSON.stringify(replacementPaths)) throw Error('Network stability replacement allowlist mismatch');
  const overrides = new Map();
  for (const [name, bytes] of replacements) {
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > 64 * 1024 * 1024 ||
      !Buffer.from(bytes.toString('utf8')).equals(bytes)) throw Error('Invalid network stability source: ' + name);
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

/** Derive one NEW v28 directory only after verifying every frozen v27 payload. */
export async function buildNetworkStabilityRelease(base, destination) {
  base = path.resolve(base); destination = path.resolve(destination);
  if (destination === base || destination.startsWith(base + path.sep)) throw Error('Frozen input cannot be changed');
  const realBase = await fs.realpath(base), destinationParent = await fs.realpath(path.dirname(destination));
  const realDestination = path.join(destinationParent, path.basename(destination));
  if (realDestination === realBase || realDestination.startsWith(realBase + path.sep)) throw Error('Frozen input cannot be changed through an alias');
  try { await fs.lstat(destination); throw Error('New release destination already exists'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const raw = await fs.readFile(path.join(base, 'manifest.json'));
  if (hash(raw) !== NETWORK_STABILITY_BASE_MANIFEST_SHA256) throw Error('Published v27 manifest mismatch');
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
  // No destination exists until all8495 source files and the manifest are proven.
  let baseBytesHashed = 0;
  for (const row of old.files) baseBytesHashed += (await checked(row.path)).length;
  if (baseBytesHashed !== old.outputBytes || hash(await fs.readFile(path.join(base, 'manifest.json'))) !== hash(raw)) throw Error('Frozen input changed during preflight');
  const replacements = new Map();
  for (const [name, source] of Object.entries(NETWORK_STABILITY_SOURCE_FILES)) {
    replacements.set(name, await fs.readFile(new URL('./runtime/' + source, import.meta.url)));
  }
  const oldUi = await checked('replica-ui.js');
  replacements.set('replica-ui.js', Buffer.from(patchNetworkStabilityUi(oldUi.toString('utf8'))));
  const indexRaw = await checked('index.html');
  const {overrides, bundle} = await rebuildNetworkStabilityBundle(old, indexRaw, checked, replacements);
  const next = structuredClone(old);
  next.destination = destination; next.generatedAt = new Date().toISOString(); next.scriptBundle = bundle.metadata;
  next.networkStabilityRelease219 = {
    baseManifestSha256: hash(raw), sourceFiles: {...NETWORK_STABILITY_SOURCE_FILES},
    boundedCallRequests: true, idempotentSessionRetry: true, remoteMotionCadence: true,
    indexUnchanged: true, crmReturnControlUnchanged: true, callSessionConflictCodePreserved: true, assetsChanged: 0,
  };
  for (const row of next.files) {
    const bytes = overrides.get(row.path);
    if (!bytes) continue;
    row.bytes = bytes.length; row.sha256 = hash(bytes);
    if (row.path === 'office-scripts-bundle.js') Object.assign(row, bundle.record);
    else (row.adapterRules ??= []).push({rule: 'network-and-motion-stability-219', occurrences: 1});
  }
  const changed = next.files.filter(row => row.sha256 !== records.get(row.path).sha256);
  if (JSON.stringify(changed.map(row => row.path).sort()) !== JSON.stringify(changedPaths)) throw Error('Unexpected network stability payload delta');
  for (const [name, sha256] of Object.entries(NETWORK_STABILITY_PRESERVED_SHA256)) {
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
    baseFilesHashed: records.size, baseBytesHashed, pngFilesChanged: 0, indexChanged: false, crmReturnUiChanged: true, crmReturnControlChanged: false,
    changed: changed.map(({path, sha256, bytes}) => ({path, sha256, bytes}))};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) throw Error('Pass the frozen v27 directory and one new destination.');
  console.log(JSON.stringify(await buildNetworkStabilityRelease(process.argv[2], process.argv[3]), null, 2));
}
