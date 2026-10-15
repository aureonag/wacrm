#!/usr/bin/env node
/**
 * Build a guarded, CRM-integrated office bundle outside Next's public directory.
 * Default mode is read-only. Examples (the destination must not exist):
 *   node scripts/package-office.mjs --source ../aurion-escritorio-local --dest .office-runtime --dry-run
 *   node scripts/package-office.mjs --source ../aurion-escritorio-local --dest .office-runtime --write
 *
 * This does not install a route, authenticate a user, enable office APIs, migrate
 * the approved browser map, or intercept global fetch/Image. Copy-time path and
 * portrait adapters are explicit and guarded; no original sources change. The CRM
 * must serve the bundle behind its own authenticated, same-origin route AFTER
 * the explicit adaptations listed in manifest.json. Never publish this folder
 * wholesale or add an alias for the original source directory.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { adaptOfficeRuntime, ADAPTER_VERSION, OFFICE_RUNTIME_ADAPTERS } from './office-runtime-adapters.mjs';
import { adaptOfficeCrm, CRM_BOOTSTRAP_VERSION } from './office-crm-bootstrap.mjs';
import { extractOfficeInlinePng } from './office-inline-assets.mjs';
import { buildOfficeScriptBundle, OFFICE_SCRIPT_BUNDLE_PATH } from './office-script-bundle.mjs';

export const RUNTIME_BASE = '/api/office/runtime/';
export const PUBLIC_ENTRIES = Object.freeze([
  'style.css', 'replica-ui.css', 'gather-avatar-catalog.css',
  'seat-exit-v1.js', 'nearby-recovery-v1.js', 'replica-input.js',
  'gather-avatar-data.js', 'gather-avatar-catalog-core.js',
  'gather-avatar-native-library-core.js', 'gather-avatar-native-library.js',
  'gather-avatar-catalog.js', 'spatial-room-core.js', 'identity-name-core.js',
  'celebration-core.js', 'avatar-hit-mask-core.js', 'app.js', 'replica-decor.js',
  'gather-library-data.js', 'replica-library.js', 'external-object-core.js',
  'replica-external-objects.js', 'github-dock-core.js', 'replica-github-dock.js',
  'furniture-color-core.js', 'replica-variants.js', 'replica-orientations.js',
  'replica-avatar.js', 'replica-richtext.js', 'replica-presence-core.js',
  'replica-status-text.js', 'profile-details-core.js', 'replica-ui.js',
  'replica-profile-details.js', 'replica-avatar-sync.js', 'replica-spotify.js',
  'spotify-links.js', 'calendar-layout-core.js', 'replica-pages.js',
  'replica-profile-calendar.js', 'replica-profile-context.js', 'replica-settings.js',
  'coworking-options.js', 'replica-meetings.js', 'replica-people.js',
  'spatial-publisher-core.js', 'spatial-control-core.js', 'replica-spatial-presence.js',
  'spatial-scene-core.js', 'replica-spatial-scene.js', 'spatial-receiver-core.js',
  'replica-spatial-receiver.js', 'replica-calls.js', 'decorator-drag-core.js',
  'decorator-drag-anchor.js', 'seat-library-approach.js',
  'gather-avatar-native-scene-core.js', 'gather-avatar-native-scene.js',
  'wall-mask-geometry.js', 'wall-mask-depth.js', 'gather-avatar-native-nameplate.js',
  'desk-navigation-core.js', 'replica-desk-navigation.js', 'smart-object-core.js',
  'smart-object-art-core.js', 'replica-smart-objects.js',
]);
const ENTRY_SET = new Set(PUBLIC_ENTRIES);
const NATIVE_MANIFEST = 'assets/gather/avatar/native-library-manifest.json';
const DATA_SCRIPTS = new Map([
  ['gather-library-data.js', 'aureonGatherLibraryData'],
  ['gather-avatar-data.js', 'aureonGatherAvatarCatalog'],
]);
const SOUNDS = new Set([
  'desmotivado.ogg', 'allan.ogg', 'o-interessante.ogg', 'o-os-cara.ogg',
  'me-mata.ogg', 'del-valle.ogg', 'fia-da-puta-oce.ogg', 'japao.ogg',
  'pix.mp3', 'rimshot.mp3', 'sad-trombone.mp3', 'crickets.mp3',
]);
const DIRECTIONS = '(?:frente|costas|esquerda|direita)';
const ASSET_RULES = [
  /^assets\/gather\/catalog\/(?:originals|improved)\/[a-zA-Z0-9_-]+\.png$/,
  /^assets\/gather\/catalog\/smart-states\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\.png$/,
  /^assets\/gather\/catalog\/e5fed724-ad75-48aa-9f5b-255ada0e2d59\.png$/,
  /^assets\/gather\/avatar\/(?:catalog|native-library|reference-sheets)\/[a-zA-Z0-9_-]+\.png$/,
  /^assets\/gather\/avatar\/avatar-exportado-gather\.png$/,
  /^assets\/gather\/(?:edit-profile|decorate-desk|get-started)\.png$/,
  new RegExp(`^assets/gamer-v2/computador-${DIRECTIONS}\\.png$`),
  new RegExp(`^assets/bambu-vaso-preto-v1/${DIRECTIONS}\\.png$`),
  /^assets\/npc-recepcionista-v1\/sprites-v[23]\/[a-zA-Z0-9_-]+\.png$/,
  /^assets\/inline-png\/[0-9a-f]{64}\.png$/,
];
// These existing consumers construct names at runtime. Review new prefixes;
// never turn this into a recursive copy of assets/ or arbitrary source paths.
const DYNAMIC_PREFIXES = new Map([
  ['gather-avatar-native-library-core.js', new Set(['assets/gather/avatar/reference-sheets/'])],
  ['replica-ui.js', new Set(['assets/gather/'])],
  ['replica-avatar-sync.js', new Set(['assets/'])],
]);

export const ADAPTATIONS = Object.freeze([
  { paths: ['/assets/', 'replica-library.js', 'gather-library-data.js',
    'gather-avatar-native-library.js', 'gather-avatar-native-scene.js'],
    required: 'Copy-time adapters prefix the reviewed asset URLs and native loaders; browser validation of the copied frontend is still required.' },
  { paths: ['replica-avatar-sync.js'],
    required: 'Copy-time portrait validation accepts only PNG images under same-origin /api/office/runtime/assets/. Original SVG/data-PNG and publisher checks are preserved; browser validation remains pending.' },
  { paths: ['/api/interface/', '/api/avatar-composition/', '/api/smart-objects/',
    'replica-ui.js', 'replica-smart-objects.js'],
    required: 'Implement scoped CRM-backed APIs and verified CRM-session identity. window.aureonCrmIdentity is not authentication. No new office signup/session fallback may authorize access.' },
  { paths: ['replica-spotify.js', '/spotify/callback'],
    required: 'Keep Spotify disabled until its server integration and callback/origin configuration are adapted; no credentials are packaged.' },
  { paths: ['aurion-office-v1', 'app.js', 'index.html'],
    required: 'Export and validate an approved complete map seed for the CRM origin. Localhost browser storage and migration flags are not transferred by this package. Review the existing 127.0.0.1-to-localhost redirect.' },
  { paths: ['index.html', 'replica-calls.js'],
    required: 'Validate same-origin iframe isolation, CRM CSP/inline scripts and media permissions. Audio/video, proximity, multiuser authorization and UI fidelity are not certified by packaging tests.' },
]);

function reject(message) { throw new Error(`Office package: ${message}`); }
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function inside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}
function relativeName(raw) {
  if (typeof raw !== 'string' || !raw || /[\\%?#\x00-\x20:]/.test(raw) || raw.startsWith('//'))
    reject(`unsafe dependency path ${JSON.stringify(raw)}`);
  const rel = raw.replace(/^\//, '').replace(/^\.\//, '');
  if (!rel || rel.split('/').some(s => !s || s.startsWith('.') ||
    /^(?:public|server|api|qa|audit|backups?)$/i.test(s) ||
    /^(?:auditoria|\.env|\.aureon-local)/i.test(s)))
    reject(`dependency outside allowlist: ${raw}`);
  return rel;
}
function allowedAsset(raw) {
  const rel = relativeName(raw);
  if (rel === NATIVE_MANIFEST || ASSET_RULES.some(r => r.test(rel)) ||
      (rel.startsWith('assets/sounds/') && SOUNDS.has(rel.slice('assets/sounds/'.length)))) return rel;
  reject(`asset outside allowlist: ${raw}`);
}
async function noSymlinkAncestors(absolute) {
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const info = await fs.lstat(current).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!info) break;
    if (info.isSymbolicLink()) reject(`symlink/junction is not allowed: ${current}`);
  }
}
async function validateLocations(source, destination) {
  if (!source || !destination) reject('--source and --dest are required');
  const src = path.resolve(source);
  const dest = path.resolve(destination);
  const segments = dest.split(/[\\/]/).filter(Boolean);
  if (dest === path.parse(dest).root || segments.some(s =>
    /^(?:public|\.git|\.env(?:\..*)?|\.aureon-local)$/i.test(s)))
    reject('destination must be an explicit new directory outside public and private directories');
  if (inside(src, dest) || inside(dest, src)) reject('source and destination must not overlap');
  await noSymlinkAncestors(src);
  await noSymlinkAncestors(dest);
  if (!(await fs.stat(src)).isDirectory()) reject('source must be a directory');
  const exists = await fs.lstat(dest).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
  if (exists) reject('destination already exists; choose a new directory (nothing is overwritten)');
  if (!(await fs.stat(path.dirname(dest))).isDirectory()) reject('destination parent must already exist');
  return { source: src, destination: dest };
}
function parseDataScript(text, globalName, file) {
  // Parse data, not JavaScript: no eval/vm/import of the source application.
  const clean = text.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, '').trim();
  const prefix = new RegExp(`^window\\.${globalName}\\s*=\\s*`);
  if (!prefix.test(clean)) reject(`unexpected JSON data wrapper in ${file}`);
  try { return JSON.parse(clean.replace(prefix, '').replace(/;\s*$/, '')); }
  catch { reject(`invalid JSON data in ${file}`); }
}
function collectDataAssets(value, add) {
  if (Array.isArray(value)) { for (const item of value) collectDataAssets(item, add); return; }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (['original', 'improved', 'path', 'thumbnailPath'].includes(key) && typeof item === 'string') add(item);
    else if (item && typeof item === 'object') collectDataAssets(item, add);
  }
}
function inspectText(file, text, addAsset, addEntry) {
  // Complete literal asset paths and the three explicitly reviewed prefixes.
  // A new dynamic asset expression is rejected instead of silently omitted.
  const literals = /["'`]((?:\/|\.\.\/|\.\/)?assets\/[^"'`\r\n<>]*)["'`]/g;
  for (const match of text.matchAll(literals)) {
    const raw = match[1];
    const normalized = raw.replace(/^\//, '');
    if (DYNAMIC_PREFIXES.get(file)?.has(normalized)) continue;
    addAsset(raw);
  }
  for (const match of text.matchAll(/(?:import\s*\(\s*|from\s+|require\s*\(\s*|importScripts\s*\(\s*)["']([^"']+)["']/g))
    addEntry(match[1]);
  for (const match of text.matchAll(new RegExp("[\"']((?:/|[.][.]/|[.]/)[a-zA-Z0-9_./-]+[.](?:js|css|cjs|json|png|mp3|ogg|woff2?))[\"']", "g"))) {
    const raw = match[1];
    if (raw.startsWith("/api/")) continue; // API endpoints are never static package files
    const local = raw.startsWith("/") ? raw.slice(1) : raw;
    if (local.startsWith("assets/")) addAsset(raw);
    else addEntry(raw);
  }
  if (file.endsWith('.css')) {
    for (const match of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)/gi)) {
      const url = match[1] ?? match[2] ?? match[3];
      if (url.startsWith('data:') || url.startsWith('#')) continue;
      addAsset(url);
    }
    if (/@import\b/i.test(text)) reject(`unreviewed CSS import in ${file}`);
  }
}
function transformIndex(html, addEntry, addAsset) {
  if (!/<head(?:\s[^>]*)?>/i.test(html) || !/<\/head\s*>/i.test(html)) reject('index.html needs a head');
  if (/<base\b/i.test(html)) reject('index.html already has a base; review it explicitly');
  if (new RegExp("<(?:iframe|object|embed)(?:[ >])", "i").test(html)) reject("unreviewed embedded dependency in index.html");
  for (const tag of html.match(/<(?:script|link|img|source|audio|video|image)[^>]*>/gi) || []) {
    if (tag.toLowerCase().includes("srcset=")) reject("unreviewed srcset dependency in index.html");
    for (const attribute of tag.matchAll(new RegExp("[ \t\n\r](?:src|href|poster)[ \t\n\r]*=[ \t\n\r]*([^ \t\n\r>]+)", "gi")))
      if (!["\"", "'"].includes(attribute[1][0])) reject("unquoted dependency in index.html");
  }
  const result = html.replace(/<(script|link|img|source|audio|video|image)\b[^>]*>/gi, tag =>
    tag.replace(/\b(src|href|poster)\s*=\s*(["'])([^"']*)\2/gi, (attribute, key, quote, raw) => {
      if (/^(?:data:|#)/i.test(raw)) return attribute;
      const rel = relativeName(raw);
      if (ENTRY_SET.has(rel)) addEntry(raw);
      else addAsset(raw);
      return `${key}=${quote}${raw.startsWith('/') ? RUNTIME_BASE + rel : raw}${quote}`;
    }));
  return result.replace(/<head(?:\s[^>]*)?>/i, opening =>
    `${opening}<base href="${RUNTIME_BASE}"><!-- Aureon CRM pilot package: backend/session, approved map and functional browser validation required; see manifest.json. -->`);
}


/** Public metadata only. Never return Buffers/base64 from the package plan. */
export function planOfficeInlineAssets(extraction,sourceSha256){
 if(!/^[0-9a-f]{64}$/.test(sourceSha256))reject('invalid inline PNG source hash');
 const seen=new Set();
 return extraction.assets.map(asset=>{
  const expectedPath='assets/inline-png/'+asset.sha256+'.png';
  if(asset.path!==expectedPath||!Buffer.isBuffer(asset.bytes)||sha256(asset.bytes)!==asset.sha256||seen.has(asset.path))reject('invalid or duplicate extracted PNG');
  allowedAsset(asset.path);seen.add(asset.path);
  return {path:asset.path,bytes:asset.bytes.length,outputBytes:asset.bytes.length,outputSha256:asset.sha256,
   virtual:true,extracted:true,sourceOrigin:'app.js',sourceSha256,sourceEncoding:'data:image/png;base64'};
 });
}
export async function writeOfficeInlineAsset(destination,record,bytes){
 if(!record.virtual||record.sourceOrigin!=='app.js'||record.path!=='assets/inline-png/'+record.outputSha256+'.png'||
  !Buffer.isBuffer(bytes)||bytes.length!==record.bytes||sha256(bytes)!==record.outputSha256)reject('virtual PNG changed after planning');
 const root=path.resolve(destination),target=path.join(root,...allowedAsset(record.path).split('/'));
 if(!inside(root,target))reject('virtual PNG destination escape');
 await noSymlinkAncestors(path.dirname(target));
 await fs.mkdir(path.dirname(target),{recursive:true});
 await fs.writeFile(target,bytes,{flag:'wx'});
 return {path:record.path,bytes:bytes.length,sha256:record.outputSha256,virtual:true,extracted:true,
  sourceOrigin:record.sourceOrigin,sourceSha256:record.sourceSha256,sourceEncoding:record.sourceEncoding,
  transformed:false,adapterRules:[{rule:'byte-exact-inline-png-extraction',occurrences:1}],preservedMetadataPaths:[]};
}
function transformEntry(entry,text,inline){
 const prefixed=adaptOfficeRuntime(entry,inline?inline.text:text);
 const crm=adaptOfficeCrm(entry,prefixed.text);
 return {...prefixed,text:crm.text,changes:[...(inline?[{rule:'byte-exact-inline-png-extraction',occurrences:inline.occurrences}]:[]),...prefixed.changes,...crm.changes]};
}

/** Plan only: reads public text/metadata and decodes pinned inline PNGs; never reads physical PNG bytes. */
export async function planOfficePackage({ source, destination, optimizeInlineImages = true, bundleScripts = false }) {
  if(typeof optimizeInlineImages!=='boolean')reject('optimizeInlineImages must be boolean');
  if(typeof bundleScripts!=='boolean')reject('bundleScripts must be boolean');
  const locations = await validateLocations(source, destination);
  const selected = new Map();
  const virtualAssets = new Map();let inlineOptimization = null;
  const bundleInputs=[];let scriptBundle=null;
  const entries = new Set();
  const pendingAssets = new Set();
  const checkedDirs = new Set();
  async function checkFile(rel) {
    const absolute = path.join(locations.source, ...rel.split('/'));
    if (!inside(locations.source, absolute)) reject(`source escape: ${rel}`);
    const directory = path.dirname(absolute);
    if (!checkedDirs.has(directory)) { await noSymlinkAncestors(directory); checkedDirs.add(directory); }
    const info = await fs.lstat(absolute);
    if (!info.isFile() || info.isSymbolicLink()) reject(`not a regular public file: ${rel}`);
    return { path: rel, bytes: info.size, mtimeMs: info.mtimeMs };
  }
  function addAsset(raw) { pendingAssets.add(allowedAsset(raw)); }
  function addEntry(raw) {
    const rel = relativeName(raw);
    if (!ENTRY_SET.has(rel)) reject(`script/style outside allowlist: ${raw}`);
    entries.add(rel);
  }
  const indexInfo = await checkFile('index.html');
  const indexBytes = await fs.readFile(path.join(locations.source, 'index.html'));
  const indexCrm = adaptOfficeCrm('index.html', transformIndex(indexBytes.toString('utf8'), addEntry, addAsset));
  let outputIndex = indexCrm.text;
  selected.set('index.html', { ...indexInfo, outputBytes: Buffer.byteLength(outputIndex),
    sourceSha256: sha256(indexBytes), outputSha256: sha256(Buffer.from(outputIndex)),
    adapterRules: [{ rule: 'html-runtime-base', occurrences: 1 }, ...indexCrm.changes] });
  // Set iteration also visits newly found static dependencies.
  for (const entry of entries) {
    const info = await checkFile(entry);
    const text = await fs.readFile(path.join(locations.source, entry), 'utf8');
    const inline = entry === 'app.js' && optimizeInlineImages ? extractOfficeInlinePng(text,{embedNativePreloads:bundleScripts}) : null;
    if(inline){const sourceSha=sha256(Buffer.from(text));
      const records=planOfficeInlineAssets(inline,sourceSha);
      for(const record of records)virtualAssets.set(record.path,record);
      inlineOptimization={extractor:'extractOfficeInlinePng',occurrences:inline.occurrences,uniqueAssets:records.length,
        pngBytes:records.reduce((sum,file)=>sum+file.bytes,0),inputAppBytes:inline.inputBytes,optimizedAppBytes:inline.outputBytes,
        sourceSha256:sourceSha,byteExact:true,embeddedNativePreloads:inline.embeddedNativePreloads??null};}
    if (DATA_SCRIPTS.has(entry)) collectDataAssets(parseDataScript(text, DATA_SCRIPTS.get(entry), entry), addAsset);
    else inspectText(entry, text, addAsset, addEntry);
    const adapted = transformEntry(entry,text,inline);
    if(bundleScripts&&entry.endsWith('.js'))bundleInputs.push({path:entry,text:adapted.text,sourceBytes:info.bytes,
      sourceSha256:sha256(Buffer.from(text)),bytes:Buffer.byteLength(adapted.text),sha256:sha256(Buffer.from(adapted.text))});
    selected.set(entry, { ...info, outputBytes: Buffer.byteLength(adapted.text),
      sourceSha256: sha256(Buffer.from(text)), outputSha256: sha256(Buffer.from(adapted.text)),
      adapterRules: adapted.changes, preservedMetadataPaths: adapted.preservedMetadataPaths || [] });
  }
  if(bundleScripts){
    const bundle=buildOfficeScriptBundle({index:outputIndex,scripts:bundleInputs,
      allowedPaths:new Set(PUBLIC_ENTRIES.filter(file=>file.endsWith('.js')))});
    outputIndex=bundle.index;scriptBundle=bundle.metadata;
    const indexRecord=selected.get('index.html');
    selected.set('index.html',{...indexRecord,outputBytes:Buffer.byteLength(outputIndex),outputSha256:sha256(Buffer.from(outputIndex)),
      adapterRules:[...indexRecord.adapterRules,{rule:'ordered-script-bundle-index',occurrences:1}]});
    if(selected.has(bundle.record.path))reject('generated bundle collision');
    selected.set(bundle.record.path,bundle.record);
  }
  // Known dynamic UI image names, not a wildcard copy of assets/gather/.
  if (entries.has('replica-ui.js'))
    for (const name of ['edit-profile', 'decorate-desk', 'get-started']) addAsset(`assets/gather/${name}.png`);
  // Runtime template composes four computer directions from one model prefix.
  if ([...pendingAssets].some(p => p.startsWith('assets/gamer-v2/')))
    for (const direction of ['frente', 'costas', 'esquerda', 'direita']) addAsset(`assets/gamer-v2/computador-${direction}.png`);
  if (entries.has('gather-avatar-native-library-core.js')) {
    const directory = 'assets/gather/avatar/reference-sheets';
    await noSymlinkAncestors(path.join(locations.source, ...directory.split('/')));
    for (const item of await fs.readdir(path.join(locations.source, ...directory.split('/')), { withFileTypes: true }))
      if (item.name.endsWith('.png')) addAsset(`${directory}/${item.name}`);
  }
  // Native sprite graph comes from the public JSON manifest; never load cache.
  if (pendingAssets.has(NATIVE_MANIFEST)) {
    await checkFile(NATIVE_MANIFEST);
    const nativeText = await fs.readFile(path.join(locations.source, ...NATIVE_MANIFEST.split('/')), 'utf8');
    let native;
    try { native = JSON.parse(nativeText); } catch { reject('invalid native avatar manifest JSON'); }
    collectDataAssets(native, addAsset);
  }
  for (const asset of [...pendingAssets].sort()) selected.set(asset, await checkFile(asset));
  for (const [asset,record] of virtualAssets){if(selected.has(asset))reject('virtual/physical asset collision: '+asset);selected.set(asset,record);}
  const files = [...selected.values()].sort((a, b) => a.path.localeCompare(b.path, 'en'));
  return {
    version: 1, mode: 'dry-run', ...locations, runtimeBase: RUNTIME_BASE,
    visualOnly: false, stage: 'crm-integrated-unverified', readyToServe: false, identityEnabled: false, apiEnabled: false,
    crmBootstrapVersion: CRM_BOOTSTRAP_VERSION, crmSessionRequired: true, mapReadOnly: true, mapaReadOnly: true, spotifyEnabled: false,
    sourceMutated: false, assetsReadForHashing: false, inlineImagesDecodedAndHashed: !!inlineOptimization,
    scriptCount: [...entries].filter(f => f.endsWith('.js')).length,
    entryScriptCount:scriptBundle?1:[...entries].filter(f=>f.endsWith('.js')).length,
    bundleScripts,scriptBundle,generatedFileCount:scriptBundle?1:0,
    stylesheetCount: [...entries].filter(f => f.endsWith('.css')).length,
    inlineOptimized: !!inlineOptimization, inlineOptimization,
    sourceFileCount: files.filter(file=>!file.virtual&&!file.generated).length, virtualAssetCount: virtualAssets.size,
    assetCount: pendingAssets.size + virtualAssets.size, fileCount: files.length,
    sourceBytes: files.filter(file=>!file.virtual&&!file.generated).reduce((sum, f) => sum + f.bytes, 0),
    outputBytes: files.reduce((sum, f) => sum + (f.outputBytes ?? f.bytes), 0),
    files, prefixAdapterVersion: ADAPTER_VERSION, prefixAdapterDefinitions: OFFICE_RUNTIME_ADAPTERS,
    adaptedFiles: files.filter(file => file.adapterRules?.length).map(file => ({ path: file.path, rules: file.adapterRules,
      preservedMetadataPaths: file.preservedMetadataPaths || [] })),
    adaptations: ADAPTATIONS,
    exclusions: ['server/API modules', 'QA/audit/backups', '.env', '.aureon-local',
      'credentials', 'unreferenced assets', 'browser storage / approved map seed'],
  };
}

async function regenerateOfficeScriptBundle(plan,regeneratedInline,rawApp) {
  const readSource=async record=>{
    const filename=path.join(plan.source,...record.path.split('/'));
    await noSymlinkAncestors(filename);
    const info=await fs.stat(filename);
    if(!info.isFile()||info.size!==record.bytes||info.mtimeMs!==record.mtimeMs)
      reject('bundle source changed after planning: '+record.path);
    const bytes=record.path==='app.js'&&rawApp?rawApp:await fs.readFile(filename);
    if(sha256(bytes)!==record.sourceSha256)reject('bundle source SHA changed after planning: '+record.path);
    return bytes;
  };
  const indexRecord=plan.files.find(file=>file.path==='index.html');
  const sourceIndex=await readSource(indexRecord);
  const adaptedIndex=adaptOfficeCrm('index.html',transformIndex(sourceIndex.toString('utf8'),()=>{},()=>{})).text;
  const scripts=[];
  for(const input of plan.scriptBundle.inputs){
    const record=plan.files.find(file=>file.path===input.path);
    if(!record||record.generated||record.virtual||!ENTRY_SET.has(record.path)||!record.path.endsWith('.js'))
      reject('invalid generated bundle source');
    const sourceBytes=await readSource(record);
    const adapted=transformEntry(record.path,sourceBytes.toString('utf8'),record.path==='app.js'?regeneratedInline:null);
    scripts.push({path:record.path,text:adapted.text,sourceBytes:sourceBytes.length,
      sourceSha256:sha256(sourceBytes),bytes:Buffer.byteLength(adapted.text),sha256:sha256(Buffer.from(adapted.text))});
  }
  const bundle=buildOfficeScriptBundle({index:adaptedIndex,scripts,
    allowedPaths:new Set(PUBLIC_ENTRIES.filter(file=>file.endsWith('.js')))});
  const generated=plan.files.find(file=>file.generated);
  if(JSON.stringify(bundle.record)!==JSON.stringify(generated)||JSON.stringify(bundle.metadata)!==JSON.stringify(plan.scriptBundle)||
    sha256(Buffer.from(bundle.index))!==indexRecord.outputSha256)
    reject('generated bundle changed after planning');
  return bundle;
}

/** Re-plan before writing; creates a NEW directory and never overwrites it. */
export async function writeOfficePackage({ source, destination, optimizeInlineImages = true, bundleScripts = false }) {
  const plan = await planOfficePackage({ source, destination, optimizeInlineImages, bundleScripts });
  await validateLocations(source, destination);
  let regeneratedInline = null, rawApp = null;
  if(plan.inlineOptimized){rawApp=await fs.readFile(path.join(plan.source,'app.js'));
    if(sha256(rawApp)!==plan.inlineOptimization.sourceSha256)reject('inline PNG source changed after planning');
    regeneratedInline=extractOfficeInlinePng(rawApp,{embedNativePreloads:bundleScripts});
    const regenerated=planOfficeInlineAssets(regeneratedInline,sha256(rawApp)).sort((a,b)=>a.path.localeCompare(b.path,'en'));
    const planned=plan.files.filter(file=>file.virtual===true&&file.generated!==true);
    if(JSON.stringify(regenerated)!==JSON.stringify(planned))reject('extracted PNG graph changed after planning');}
  const inlineByPath=new Map(regeneratedInline?.assets.map(asset=>[asset.path,asset.bytes])||[]);
  const regeneratedBundle=plan.bundleScripts?await regenerateOfficeScriptBundle(plan,regeneratedInline,rawApp):null;
  await fs.mkdir(plan.destination); // no recursive parents; an existing destination is an error
  const records = [];
  for (const record of plan.files) {
    if(record.generated){
      if(record.virtual||record.path!==OFFICE_SCRIPT_BUNDLE_PATH||!regeneratedBundle||record.outputSha256!==regeneratedBundle.metadata.sha256)
        reject('invalid generated bundle write');
      const bytes=Buffer.from(regeneratedBundle.text,'utf8');
      if(bytes.length!==record.outputBytes||sha256(bytes)!==record.outputSha256)reject('generated bundle bytes changed');
      await fs.writeFile(path.join(plan.destination,OFFICE_SCRIPT_BUNDLE_PATH),bytes,{flag:'wx'});
      records.push({path:record.path,bytes:bytes.length,sha256:sha256(bytes),generated:true,generator:record.generator,
        inputs:record.inputs,transformed:true,adapterRules:record.adapterRules,preservedMetadataPaths:[]});
      continue;
    }
    if(record.virtual){records.push(await writeOfficeInlineAsset(plan.destination,record,inlineByPath.get(record.path)));continue;}
    const sourceFile = path.join(plan.source, ...record.path.split('/'));
    await noSymlinkAncestors(sourceFile);
    const stat = await fs.stat(sourceFile);
    if (!stat.isFile() || stat.size !== record.bytes || stat.mtimeMs !== record.mtimeMs)
      reject(`source changed while packaging: ${record.path}; incomplete output must not be served`);
    const sourceBytes = record.path === 'app.js' && rawApp ? rawApp : await fs.readFile(sourceFile);
    if(record.sourceSha256&&sha256(sourceBytes)!==record.sourceSha256)reject('source SHA changed after planning: '+record.path);
    const bytes = record.path === 'index.html'
      ? Buffer.from(regeneratedBundle?regeneratedBundle.index:adaptOfficeCrm('index.html', transformIndex(sourceBytes.toString('utf8'), () => {}, () => {})).text)
      : ENTRY_SET.has(record.path) ? Buffer.from(transformEntry(record.path,sourceBytes.toString('utf8'),record.path==='app.js'?regeneratedInline:null).text) : sourceBytes;
    if (record.outputSha256 && sha256(bytes) !== record.outputSha256)
      reject('transformation changed after planning: ' + record.path);
    const destinationFile = path.join(plan.destination, ...record.path.split('/'));
    await fs.mkdir(path.dirname(destinationFile), { recursive: true });
    await fs.writeFile(destinationFile, bytes, { flag: 'wx' });
    records.push({ path: record.path, bytes: bytes.length, sha256: sha256(bytes),
      sourceBytes: sourceBytes.length, sourceSha256: sha256(sourceBytes),
      transformed: !bytes.equals(sourceBytes), adapterRules: record.adapterRules || [],
      preservedMetadataPaths: record.preservedMetadataPaths || [] });
  }
  const summary = {...plan};
  delete summary.files;
  const manifest = { ...summary, mode: 'written', generatedAt: new Date().toISOString(),
    assetsReadForHashing: true, files: records };
  // The manifest deliberately does not hash itself. Its presence marks completion,
  // not authorization to publish: readyToServe, API and identity remain false.
  await fs.writeFile(path.join(plan.destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return manifest;
}

export async function runCli(args, { optimizeInlineImages = true } = {}) {
  if (args.includes('--help')) {
    return { usage: 'node scripts/package-office.mjs --source DIR --dest NEW_DIR [--bundle-scripts] [--dry-run | --write]',
      defaultMode: 'dry-run', inlineOptimizationDefault: true, scriptBundlingDefault:false, visualOnly: false, readyToServe: false };
  }
  const options = {};
  let mode;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run' || arg === '--write') {
      if (mode) reject('choose exactly one mode');
      mode = arg;
    } else if(arg==='--bundle-scripts'){
      if(options.bundleScripts!==undefined)reject('duplicate --bundle-scripts');
      options.bundleScripts=true;
    } else if (arg === '--source' || arg === '--dest') {
      const key = arg === '--source' ? 'source' : 'destination';
      if (options[key] || !args[i + 1] || args[i + 1].startsWith('--')) reject(`invalid ${arg}`);
      options[key] = args[++i];
    } else reject(`unknown argument ${arg}`);
  }
  return mode === '--write' ? writeOfficePackage({...options,optimizeInlineImages}) : planOfficePackage({...options,optimizeInlineImages});
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await runCli(process.argv.slice(2)), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
