import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { planOfficePackage, writeOfficePackage, runCli as productionCli, planOfficeInlineAssets, writeOfficeInlineAsset } from './package-office.mjs';
import { extractOfficeInlinePng } from './office-inline-assets.mjs';
const runCli=args=>productionCli(args,{optimizeInlineImages:false});

const legacyCrmProfile="// Use the authenticated CRM profile, never a copied password.\n(()=>{\n const note=document.createElement('div');note.className='crm-identity-state';note.textContent='Conectando ao perfil do CRM…';document.querySelector('.people-sidebar').append(note);\n let identity=null;\n function apply(){\n  if(!identity)return;\n  for(const avatar of document.querySelectorAll('.self-avatar')){\n   if(identity.avatarUrl&&!avatar.querySelector('img.crm-profile-photo')){\n    const img=document.createElement('img');img.className='crm-profile-photo';img.src=identity.avatarUrl;img.alt=identity.name||'Sua foto';img.onerror=()=>img.remove();avatar.replaceChildren(img);\n   }\n  }\n  for(const node of document.querySelectorAll('.profile-copy b,.person-row:has(.self-avatar) b'))node.textContent=identity.name||'Você';\n  for(const node of document.querySelectorAll('[data-person=\"AL\"] text'))if(node.textContent==='Allan Giro')node.textContent=identity.name||'Você';\n }\n async function connect(){\n  try{\n   const response=await fetch('http://localhost:3000/api/office/profile',{credentials:'include',cache:'no-store'});\n   if(!response.ok)throw Error('login');\n   identity=await response.json();window.aureonCrmIdentity=Object.freeze(identity);\n   note.textContent='Conta vinculada ao CRM';note.classList.add('connected');apply();\n  }catch{\n   identity=null;delete window.aureonCrmIdentity;for(const photo of document.querySelectorAll('.crm-profile-photo'))photo.remove();\n   note.classList.remove('connected');note.replaceChildren();\n   const link=document.createElement('a');link.href='http://localhost:3000/login';link.target='_blank';link.rel='noopener';link.textContent='Entrar no CRM para vincular minha conta';\n   note.append(link);\n  }\n }\n const observer=new MutationObserver(()=>{observer.disconnect();apply();observer.observe(document.querySelector('.people-sidebar'),{childList:true,subtree:true})});\n observer.observe(document.querySelector('.people-sidebar'),{childList:true,subtree:true});\n window.addEventListener('focus',connect);connect();setInterval(apply,500);\n})();\n\n// Unified open operational floor;\n";

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 17]);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aureon-office-package-'));
  t.after(async () => {
    const target = path.resolve(root);
    const temporaryRoot = path.resolve(os.tmpdir());
    assert.equal(path.dirname(target), temporaryRoot, "fixture cleanup must stay directly inside the OS temporary directory");
    assert.ok(path.basename(target).startsWith("aureon-office-package-"));
    assert.equal((await fs.lstat(target)).isSymbolicLink(), false);
    await fs.rm(target, { recursive: true, force: true });
  });
  const source = path.join(root, 'source');
  const destination = path.join(root, '.office-runtime');
  const files = {
    'index.html': '<!doctype html><html><head><link rel="stylesheet" href="/style.css"></head><body><img src="/assets/gather/catalog/improved/table-v2.png"><script src="/app.js"></script><script src="gather-library-data.js"></script></body></html>',
    'style.css': 'body{font-family:Segoe UI,Arial,sans-serif}',
    'app.js': legacyCrmProfile+"let stored=JSON.parse(localStorage.getItem('aurion-office-v1')),defaults=[];\nlet objects=Array.isArray(stored?.objects)?stored.objects:[],floor=stored.floor,editing=false,placing=null,selected=null,drag=null;\nfunction render(){globalThis.drawn=JSON.parse(JSON.stringify({objects,floor}));}\nfunction save(){}\nfunction editor(open){editing=open;return open;}\n(()=>{const key='aureon-office-construction-v1';let items=JSON.parse(localStorage.getItem(key)),active=false,start=null,movingWindow=null;const windowEdit={hidden:false},input={replaceChildren(){}};function officeStopMovement(){}\nfunction render(){globalThis.built=JSON.parse(JSON.stringify(items));}\nfunction save(){localStorage.setItem(key,JSON.stringify(items));render()}\nfunction setActive(value){\n  active=value;start=null;movingWindow=null;windowEdit.hidden=true;input.replaceChildren();officeStopMovement();editor(false);editing=active;\n}\nitems.push({id:'migration-wall'});render();})();\n\nlet myStatus='online',lastActivity=Date.now(),autoAway=false;\nfunction renderPeople(){}function syncRoom(){}\n ['pointerdown','keydown'].forEach(type=>document.addEventListener(type,()=>{lastActivity=Date.now();if(autoAway){myStatus='online';autoAway=false;renderPeople();syncRoom()}},{passive:true}));\n setInterval(()=>{if(myStatus==='online'&&Date.now()-lastActivity>300000){myStatus='away';autoAway=true;renderPeople();syncRoom()}},15000);\nwindow.aureonInterfaceBridge={pause:()=>officeStopMovement(),getPresence:()=>myStatus};\n\nfunction actionFor(o){return o.action;}\nfunction openObject(o,arrived=false){const action=actionFor(o);if(!action)return;if(!arrived)window.aureonCancelSeatApproach?.();globalThis.enteredObjectActions.push(action);if(action==='Abrir estação')toast('Estação atualizada.');}\nfunction soundDb(){return indexedDB.open('aureon-personal-sounds-v1',1);}\nobjects.push({id:'migration-object'});globalThis.tryEdit=()=>{objects.push({id:'changed'});save();};\n\nconst bamboo=\"assets/bambu-vaso-preto-v1/frente.png\";",
    'gather-library-data.js': 'window.aureonGatherLibraryData={"items":[{"original":"/assets/gather/catalog/originals/table.png","improved":"/assets/gather/catalog/improved/table-v2.png","qualitySource":"private audit/LEIA-ME.md is provenance, not a dependency"}]};',
    'assets/bambu-vaso-preto-v1/frente.png': PNG,
    'assets/gather/catalog/originals/table.png': PNG,
    'assets/gather/catalog/improved/table-v2.png': Buffer.concat([PNG, Buffer.from('approved-image')]),
    '.env': 'SECRET_MUST_NOT_BE_READ_OR_COPIED=private',
    '.aureon-local/state.json': '{"private":true}',
    'server.cjs': 'throw new Error("server must never run")',
    'auditoria-personagem-2026-10-08/backup.js': 'private evidence',
    'assets/gather/catalog/improved/rejected-unreferenced.png': Buffer.from('not selected'),
    ...overrides,
  };
  for (const [name, bytes] of Object.entries(files)) {
    const file = path.join(source, ...name.split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, bytes);
  }
  return { root, source, destination, files, optimizeInlineImages:false };
}
test('dry-run discovers reviewed dependencies without creating output or including private neighbors', async t => {
  const f = await fixture(t);
  const plan = await planOfficePackage(f);
  assert.deepEqual(plan.files.map(x => x.path).sort(), [
    'index.html', 'app.js', 'style.css', 'gather-library-data.js',
    'assets/bambu-vaso-preto-v1/frente.png', 'assets/gather/catalog/originals/table.png',
    'assets/gather/catalog/improved/table-v2.png',
  ].sort());
  assert.equal(plan.scriptCount, 2);
  assert.equal(plan.stylesheetCount, 1);
  assert.equal(plan.assetsReadForHashing, false);
  assert.equal(plan.identityEnabled, false);
  assert.equal(plan.apiEnabled, false);
  assert.equal(plan.readyToServe, false);
  await assert.rejects(fs.stat(f.destination), { code: 'ENOENT' });
});
test('write preserves source, script order and image bytes; index and manifest hashes are verifiable', async t => {
  const f = await fixture(t);
  const before = await fs.readFile(path.join(f.source, 'index.html'));
  const result = await writeOfficePackage(f);
  const index = await fs.readFile(path.join(f.destination, 'index.html'), 'utf8');
  assert.ok(index.includes('<head><base href="/api/office/runtime/">'));
  assert.ok(index.includes('href="/api/office/runtime/style.css"'));
  assert.ok(index.includes('src="/api/office/runtime/assets/gather/catalog/improved/table-v2.png"'));
  assert.ok(index.includes('["/api/office/runtime/app.js","/api/office/runtime/gather-library-data.js"]'));
  assert.ok(index.includes('const localStorage=aureonOfficeCrmRuntime.localStorage'));
  assert.equal((index.match(/<script src=/g)||[]).length,0);
  assert.deepEqual(await fs.readFile(path.join(f.source, 'index.html')), before);
  for (const record of result.files) {
    const actual = await fs.readFile(path.join(f.destination, ...record.path.split('/')));
    assert.equal(record.bytes, actual.length);
    assert.equal(record.sha256, sha(actual));
    const original = await fs.readFile(path.join(f.source, ...record.path.split('/')));
    assert.equal(record.sourceSha256, sha(original));
    if (!['index.html', 'app.js', 'gather-library-data.js'].includes(record.path)) assert.deepEqual(actual, original);
    else assert.equal(record.transformed, true);
  }
  const copiedLibrary = await fs.readFile(path.join(f.destination, 'gather-library-data.js'), 'utf8');
  assert.ok(copiedLibrary.includes('/api/office/runtime/assets/gather/catalog/improved/table-v2.png'));
  assert.ok(copiedLibrary.includes('private audit/LEIA-ME.md is provenance, not a dependency'));
  assert.equal(await fs.readFile(path.join(f.source, 'gather-library-data.js'), 'utf8'), f.files['gather-library-data.js']);
  const manifest = JSON.parse(await fs.readFile(path.join(f.destination, 'manifest.json'), 'utf8'));
  assert.equal(manifest.prefixAdapterVersion, 1);
  assert.ok(manifest.adaptedFiles.some(file => file.path === 'gather-library-data.js'));
  assert.equal(manifest.readyToServe, false);
  assert.equal(manifest.apiEnabled, false);
  assert.equal(manifest.identityEnabled, false);
  assert.ok(manifest.adaptations.some(x => x.paths.includes('replica-avatar-sync.js')));
  assert.ok(!index.includes('window.fetch='));
  await assert.rejects(fs.stat(path.join(f.destination, '.env')), { code: 'ENOENT' });
  await assert.rejects(writeOfficePackage(f), /destination already exists/);
});
test('native sprite graph is parsed as JSON data without evaluating source code', async t => {
  const f = await fixture(t, {
    'index.html': '<html><head></head><body><script src="gather-avatar-native-library.js"></script></body></html>',
    'gather-avatar-native-library.js': "(()=>{'use strict';const manifest=fetch('/assets/gather/avatar/native-library-manifest.json');function image(path){const img={};img.src='/'+path;return img;}})();",
    'assets/gather/avatar/native-library-manifest.json': '{"categories":[{"items":[{"thumbnailPath":"assets/gather/avatar/catalog/model.png","variants":[{"files":{"essentials":{"path":"assets/gather/avatar/native-library/piece-essentials.png"}}}]}]}]}',
    'assets/gather/avatar/catalog/model.png': PNG,
    'assets/gather/avatar/native-library/piece-essentials.png': PNG,
  });
  const plan = await planOfficePackage(f);
  assert.equal(plan.assetCount, 3);
  assert.ok(plan.files.some(x => x.path.endsWith('/piece-essentials.png')));
});
test('unreviewed index scripts and stylesheet origins fail closed', async t => {
  for (const tag of ['<script src=private.js></script>', '<iframe src="private.html"></iframe>', '<script src="server.cjs"></script>', '<script src="surprise.js"></script>',
    '<link rel="stylesheet" href="https://example.invalid/styles.css">']) {
    const f = await fixture(t, { 'index.html': '<html><head>'+tag+'</head></html>' });
    await assert.rejects(planOfficePackage(f), /allowlist|unsafe dependency|unquoted dependency|unreviewed embedded/);
    await assert.rejects(fs.stat(f.destination), { code: 'ENOENT' });
  }
});
test('traversal, encoded traversal, private files and unknown dynamic prefixes are rejected', async t => {
  for (const asset of ['assets/../.env', '/assets/%2e%2e/.env', 'assets/gather/catalog/improved/../../server.cjs',
    'assets/new-family/', 'assets/gather/avatar/catalog/.env']) {
    const f = await fixture(t, { 'app.js': 'const asset='+JSON.stringify(asset)+';' });
    await assert.rejects(planOfficePackage(f), /allowlist|unsafe dependency/);
  }
});
test('missing approved assets fail before creating any destination', async t => {
  const f = await fixture(t, { 'style.css': 'body{background:url("assets/gather/catalog/improved/not-present.png")}' });
  await assert.rejects(writeOfficePackage(f), { code: 'ENOENT' });
  await assert.rejects(fs.stat(f.destination), { code: 'ENOENT' });
});
test('destination cannot overlap source or sit in public, including case variants', async t => {
  const f = await fixture(t);
  for (const destination of [f.source, path.join(f.source, 'output'), f.root,
    path.join(f.root, 'public', 'office'), path.join(f.root, 'PuBlIc', 'office')])
    await assert.rejects(planOfficePackage({ source: f.source, destination }), /overlap|outside public/);
});
test('symlinked assets cannot smuggle files outside the allowlist', async t => {
  const f = await fixture(t);
  const asset = path.join(f.source, 'assets', 'bambu-vaso-preto-v1', 'frente.png');
  await fs.unlink(asset);
  try { await fs.symlink(path.join(f.source, '.env'), asset, 'file'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('OS disallows fixture symlinks: '+error.code); return; }
    throw error;
  }
  await assert.rejects(planOfficePackage(f), /regular public file|symlink/);
});
test('JSON data wrappers cannot execute a second statement', async t => {
  const f = await fixture(t, { 'gather-library-data.js': 'window.aureonGatherLibraryData={}; process.exit(10);' });
  await assert.rejects(planOfficePackage(f), /invalid JSON data/);
});
test('CSS imports and unreviewed JS imports require explicit review', async t => {
  for (const overrides of [{ 'style.css': '@import "external.css";' },
    { 'app.js': 'import("./unreviewed-module.js");' },
    { 'app.js': 'fetch("/server.cjs");' },
    { 'style.css': 'body{background:url("/assets/private/logo.svg")}' }]) {
    const f = await fixture(t, overrides);
    await assert.rejects(planOfficePackage(f), /unreviewed CSS import|outside allowlist/);
  }
});
test('CLI defaults to dry-run and requires explicit destination and write mode', async t => {
  const f = await fixture(t);
  const result = await runCli(['--source', f.source, '--dest', f.destination]);
  assert.equal(result.mode, 'dry-run');
  await assert.rejects(fs.stat(f.destination), { code: 'ENOENT' });
  await assert.rejects(runCli(['--source', f.source]), /--source and --dest are required/);
  await assert.rejects(runCli(['--source', f.source, '--dest', f.destination, '--write', '--dry-run']), /choose exactly one mode/);
  await assert.rejects(runCli(['--source', f.source, '--dest', f.destination, '--force']), /unknown argument/);
});

test('production CLI pins inline extraction while fixture opt-out stays explicit and unverified', async t => {
 const f=await fixture(t);
 await assert.rejects(productionCli(['--source',f.source,'--dest',f.destination]),/SHA|hash/i);
 const plan=await planOfficePackage(f);
 assert.equal(plan.inlineOptimized,false);assert.equal(plan.inlineOptimization,null);
 assert.equal(plan.virtualAssetCount,0);assert.equal(plan.readyToServe,false);
 await assert.rejects(planOfficePackage({...f,optimizeInlineImages:'false'}),/must be boolean/);
 await assert.rejects(fs.stat(f.destination),{code:'ENOENT'});
});
test('extracted PNG metadata contains no buffers and writer preserves exact pixels without overwriting', async t => {
 const f=await fixture(t),literal='data:image/png;base64,'+PNG.toString('base64');
 const text='const first='+JSON.stringify(literal)+';const duplicate='+JSON.stringify(literal)+';';
 const extraction=extractOfficeInlinePng(text,{expectedSha256:sha(text),expectedCount:2});
 assert.equal(extraction.occurrences,2);assert.equal(extraction.assets.length,1);
 const records=planOfficeInlineAssets(extraction,sha(text)),record=records[0];
 assert.equal(record.path,'assets/inline-png/'+sha(PNG)+'.png');
 assert.equal(record.sourceOrigin,'app.js');assert.equal(record.sourceSha256,sha(text));
 assert.equal(record.bytes,PNG.length);assert.equal(record.outputSha256,sha(PNG));
 const encoded=JSON.stringify(records);assert.ok(!encoded.includes('"type":"Buffer"'));assert.ok(!encoded.includes(PNG.toString('base64')));
 const result=await writeOfficeInlineAsset(f.destination,record,extraction.assets[0].bytes);
 assert.deepEqual(await fs.readFile(path.join(f.destination,...record.path.split('/'))),PNG);
 assert.equal(result.sha256,sha(PNG));assert.equal(result.sourceSha256,sha(text));
 assert.equal(result.transformed,false);assert.equal(result.extracted,true);
 await assert.rejects(writeOfficeInlineAsset(f.destination,record,PNG),{code:'EEXIST'});
 const damaged=Buffer.from(PNG);damaged[damaged.length-1]^=1;
 await assert.rejects(writeOfficeInlineAsset(f.destination,record,damaged),/changed after planning/);
 await assert.rejects(writeOfficeInlineAsset(f.destination,{...record,path:'../escape.png'},PNG),/changed after planning/);
 assert.throws(()=>planOfficeInlineAssets({...extraction,assets:[...extraction.assets,...extraction.assets]},sha(text)),/invalid or duplicate/);
});
