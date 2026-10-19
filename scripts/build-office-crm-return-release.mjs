import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {Script} from 'node:vm';
import {buildOfficeScriptBundle} from './office-script-bundle.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const CRM_RETURN_BASE_MANIFEST_SHA256 = '4a962b7d094b442e5155bfbf58b0206004135143acadfe459eba4e078b3acf7e';
export const CRM_RETURN_BASE_UI_SHA256 = '9d2a80ae82d5abc137aa60d1599b5062eecfa5f5f3627502a6afd3252556044e';
export const CRM_RETURN_VISIBLE_REPLACEMENT = Object.freeze([
  "const rail=document.querySelector('.rail'),brand=el('div','r-brand','au');brand.title='Aureon';rail.prepend(brand);",
  "const rail=document.querySelector('.rail'),brand=el('a','r-brand','au');brand.href='/dashboard';brand.target='_top';brand.title='Voltar ao CRM';brand.setAttribute('aria-label','Voltar ao CRM');Object.assign(brand.style,{color:'inherit',textDecoration:'none'});rail.prepend(brand);",
]);

/** Patch only the reviewed visible brand; compile elsewhere, never execute UI. */
export function patchCrmReturnUi(source) {
  if (typeof source !== 'string' || hash(source) !== CRM_RETURN_BASE_UI_SHA256) throw Error('Published v26 UI hash mismatch');
  if (source.split(CRM_RETURN_VISIBLE_REPLACEMENT[0]).length !== 2) throw Error('Visible CRM return anchor mismatch');
  return source.replace(...CRM_RETURN_VISIBLE_REPLACEMENT);
}

function validateManifest(manifest) {
  if (manifest.version !== 1 || manifest.crmBootstrapVersion !== 1 || manifest.crmSessionRequired !== true ||
    manifest.mapReadOnly !== true || manifest.runtimeBase !== '/api/office/runtime/' || manifest.sourceMutated !== false ||
    manifest.fileCount !== 8495 || !Array.isArray(manifest.files) || manifest.files.length !== 8495 ||
    !Array.isArray(manifest.scriptBundle?.inputs) || manifest.scriptBundle.inputs.length !== 62) throw Error('Published v26 runtime contract mismatch');
  const records = new Map(), folded = new Set();
  let total = 0;
  for (const row of manifest.files) {
    if (!row || typeof row.path !== 'string' || !/^[A-Za-z0-9_./-]{1,200}$/.test(row.path) ||
      row.path.split('/').some(part => !part || part === '.' || part === '..') || row.path === 'manifest.json' ||
      folded.has(row.path.toLowerCase()) || !Number.isSafeInteger(row.bytes) || row.bytes < 0 || row.bytes > 64 * 1024 * 1024 ||
      !/^[0-9a-f]{64}$/.test(row.sha256)) throw Error('Invalid frozen file record');
    records.set(row.path, row); folded.add(row.path.toLowerCase()); total += row.bytes;
  }
  if (total !== manifest.outputBytes || total > 1024 * 1024 * 1024) throw Error('Frozen payload total mismatch');
  return records;
}

/** Derive a NEW v27 directory from all8495 verified frozen v26 payloads. */
export async function buildCrmReturnRelease(base, destination) {
  base = path.resolve(base); destination = path.resolve(destination);
  if (destination === base || destination.startsWith(base + path.sep)) throw Error('Frozen input cannot be changed');
  const realBase = await fs.realpath(base), destinationParent = await fs.realpath(path.dirname(destination));
  const realDestination = path.join(destinationParent, path.basename(destination));
  if (realDestination === realBase || realDestination.startsWith(realBase + path.sep)) throw Error('Frozen input cannot be changed through an alias');
  try { await fs.lstat(destination); throw Error('New release destination already exists'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const raw = await fs.readFile(path.join(base, 'manifest.json'));
  if (hash(raw) !== CRM_RETURN_BASE_MANIFEST_SHA256) throw Error('Published v26 manifest mismatch');
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
  // Complete the entire source proof BEFORE creating any output directory/file.
  let baseBytesHashed = 0;
  for (const row of old.files) baseBytesHashed += (await checked(row.path)).length;
  if (baseBytesHashed !== old.outputBytes || hash(await fs.readFile(path.join(base, 'manifest.json'))) !== hash(raw)) throw Error('Frozen input changed during preflight');
  const ui = Buffer.from(patchCrmReturnUi((await checked('replica-ui.js')).toString('utf8')));
  new Script(ui.toString('utf8'), {filename: 'replica-ui.js'});
  const overrides = new Map([['replica-ui.js', ui]]), indexRaw = await checked('index.html');
  let index = indexRaw.toString('utf8');
  const start = 'aureonOfficeCrmRuntime.start(["/api/office/runtime/office-scripts-bundle.js"]);';
  if (index.split(start).length !== 2) throw Error('Frozen bundle index anchor mismatch');
  index = index.replace(start, 'aureonOfficeCrmRuntime.start(' + JSON.stringify(old.scriptBundle.inputs.map(row => '/api/office/runtime/' + row.path)) + ');');
  const scripts = [];
  for (const input of old.scriptBundle.inputs) {
    const bytes = overrides.get(input.path) || await checked(input.path);
    scripts.push({...input, text: bytes.toString('utf8'), bytes: bytes.length, sha256: hash(bytes)});
  }
  const bundle = buildOfficeScriptBundle({index, scripts, allowedPaths: new Set(records.keys())});
  if (!Buffer.from(bundle.index).equals(indexRaw)) throw Error('Unexpected index delta');
  overrides.set('office-scripts-bundle.js', Buffer.from(bundle.text));
  const next = structuredClone(old);
  next.destination = destination; next.generatedAt = new Date().toISOString(); next.scriptBundle = bundle.metadata;
  next.crmReturnRelease218 = {baseManifestSha256: hash(raw), visibleRailBrandIsLink: true, destination: '/dashboard', target: '_top', assetsChanged: 0, indexUnchanged: true};
  for (const row of next.files) {
    const bytes = overrides.get(row.path);
    if (!bytes) continue;
    row.bytes = bytes.length; row.sha256 = hash(bytes);
    if (row.path === 'office-scripts-bundle.js') Object.assign(row, bundle.record);
    else (row.adapterRules ??= []).push({rule: 'visible-crm-return-218', occurrences: 1});
  }
  const changed = next.files.filter(row => row.sha256 !== records.get(row.path).sha256);
  if (JSON.stringify(changed.map(row => row.path).sort()) !== JSON.stringify(['office-scripts-bundle.js','replica-ui.js'])) throw Error('Unexpected CRM return payload delta');
  next.outputBytes = next.files.reduce((sum, row) => sum + row.bytes, 0);
  await fs.mkdir(destination, {recursive: false});
  for (const row of next.files) {
    const bytes = overrides.get(row.path) || await checked(row.path);
    await fs.mkdir(path.dirname(path.join(destination, row.path)), {recursive: true});
    await fs.writeFile(path.join(destination, row.path), bytes, {flag: 'wx'});
  }
  const manifest = Buffer.from(JSON.stringify(next, null, 2) + '\n');
  await fs.writeFile(path.join(destination, 'manifest.json'), manifest, {flag: 'wx'});
  return {manifestSha256: hash(manifest), fileCount: next.fileCount, payloadBytes: next.outputBytes, baseFilesHashed: records.size, baseBytesHashed, pngFilesChanged: 0, indexChanged: false, changed: changed.map(({path, sha256, bytes}) => ({path, sha256, bytes}))};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) throw Error('Pass the frozen v26 directory and one new destination.');
  console.log(JSON.stringify(await buildCrmReturnRelease(process.argv[2], process.argv[3]), null, 2));
}
