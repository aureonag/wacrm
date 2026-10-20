import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {AVATAR_CACHE_BASE_MANIFEST_SHA256, AVATAR_CACHE_BASE_SCENE_SHA256, AVATAR_CACHE_PRESERVED_SHA256,
  AVATAR_CACHE_SOURCE_FILES, rebuildAvatarCacheBundle, buildAvatarCacheRelease} from './build-office-avatar-cache-release.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const start = 'aureonOfficeCrmRuntime.start(["/api/office/runtime/office-scripts-bundle.js"]);';
function fixture() {
  const sources = new Map([
    ['replica-ui.js', Buffer.from('globalThis.visibleCrmReturn = true;')],
    ['replica-spatial-scene.js', Buffer.from('globalThis.scene = "old";')],
    ['replica-calls.js', Buffer.from('globalThis.calls = "unchanged";')],
  ]);
  const inputs = [...sources].map(([name, bytes]) => ({path: name, bytes: bytes.length, sha256: hash(bytes), sourceBytes: bytes.length, sourceSha256: hash(bytes)}));
  return {
    sources, manifest: {files: [...inputs, {path: 'office-scripts-bundle.js'}], scriptBundle: {inputs}},
    index: Buffer.from('<!doctype html><html><head></head><body><script>' + start + '</script></body></html>'),
    // Throwing input proves packaging compiles the reviewed script without executing it.
    replacements: new Map([['replica-spatial-scene.js', Buffer.from('throw Error("do not execute scene");')]]),
  };
}

test('only the remote renderer and derived bundle change; index, CRM return and audio inputs remain identical', async () => {
  const f = fixture(), indexBefore = Buffer.from(f.index), originals = new Map([...f.sources].map(([name, bytes]) => [name, Buffer.from(bytes)]));
  const result = await rebuildAvatarCacheBundle(f.manifest, f.index, name => f.sources.get(name), f.replacements);
  assert.deepEqual([...result.overrides.keys()].sort(), ['office-scripts-bundle.js', 'replica-spatial-scene.js']);
  assert.deepEqual(f.index, indexBefore); assert.deepEqual(Buffer.from(result.bundle.index), indexBefore);
  assert.deepEqual(result.bundle.metadata.inputs.map(row => row.path), f.manifest.scriptBundle.inputs.map(row => row.path));
  for (const [name, bytes] of originals) {
    assert.deepEqual(f.sources.get(name), bytes);
    const expected = f.replacements.get(name) || bytes;
    assert.equal(result.bundle.metadata.inputs.find(row => row.path === name).sha256, hash(expected));
  }
  assert.ok(result.bundle.text.includes('do not execute scene'));
});

test('unlisted or missing sources, empty bytes, malformed UTF-8 and invalid JavaScript are rejected', async () => {
  const f = fixture(), checked = name => f.sources.get(name), extra = new Map(f.replacements);
  extra.set('replica-calls.js', Buffer.from('globalThis.unapproved=true;'));
  for (const replacements of [extra, new Map()]) await assert.rejects(rebuildAvatarCacheBundle(f.manifest, f.index, checked, replacements), /allowlist/);
  for (const bytes of [Buffer.alloc(0), Buffer.from([0xff]), Buffer.from('function broken( {')]) {
    await assert.rejects(rebuildAvatarCacheBundle(f.manifest, f.index, checked, new Map([['replica-spatial-scene.js', bytes]])));
  }
});

test('a changed or repeated runtime entry cannot silently alter the approved index', async () => {
  const f = fixture();
  for (const index of [Buffer.from('<html></html>'), Buffer.concat([f.index, f.index]), Buffer.from(f.index.toString().replace(start, start.replace('start(', 'start( ')))]) {
    await assert.rejects(rebuildAvatarCacheBundle(f.manifest, index, name => f.sources.get(name), f.replacements), /index anchor/);
  }
});

async function temporary(context) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'office-avatar-cache-release-'));
  context.after(async () => {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('office-avatar-cache-release-'));
    assert.equal((await fs.lstat(resolved)).isSymbolicLink(), false);
    await fs.rm(resolved, {recursive: true, force: true});
  });
  return directory;
}

test('unknown base bytes fail before creating output; nested frozen destinations are rejected', async context => {
  const directory = await temporary(context), base = path.join(directory, 'base'), destination = path.join(directory, 'new');
  await fs.mkdir(base); await fs.writeFile(path.join(base, 'manifest.json'), '{"fileCount":8495}\n', {flag: 'wx'});
  await assert.rejects(buildAvatarCacheRelease(base, destination), /v29 manifest mismatch/);
  await assert.rejects(fs.lstat(destination), {code: 'ENOENT'});
  await assert.rejects(buildAvatarCacheRelease(base, path.join(base, 'nested')), /Frozen input cannot be changed/);
});

test('an existing output directory and every original byte are preserved', async context => {
  const directory = await temporary(context), base = path.join(directory, 'base'), destination = path.join(directory, 'existing');
  await fs.mkdir(base); await fs.mkdir(destination); await fs.writeFile(path.join(destination, 'keep.txt'), 'preserve', {flag: 'wx'});
  await assert.rejects(buildAvatarCacheRelease(base, destination), /destination already exists/);
  assert.equal(await fs.readFile(path.join(destination, 'keep.txt'), 'utf8'), 'preserve');
  assert.deepEqual(await fs.readdir(destination), ['keep.txt']);
});

test('published v29 pins preserve entry, return, audio, spatial core and source allowlist', async context => {
  let raw;
  try {raw = await fs.readFile(new URL('../.office-test/runtime-candidate-v29/manifest.json', import.meta.url));}
  catch (error) {if (error.code === 'ENOENT') return context.skip('The reviewed private v29 runtime is not installed in this checkout.'); throw error;}
  assert.equal(hash(raw), AVATAR_CACHE_BASE_MANIFEST_SHA256);
  const manifest = JSON.parse(raw);
  assert.equal(manifest.fileCount, 8495); assert.equal(manifest.scriptBundle.inputs.length, 62);
  for (const [name, expected] of Object.entries(AVATAR_CACHE_PRESERVED_SHA256)) {
    assert.equal(manifest.files.find(row => row.path === name).sha256, expected);
    assert.equal(hash(await fs.readFile(new URL('../.office-test/runtime-candidate-v29/' + name, import.meta.url))), expected);
  }
  assert.equal(manifest.files.find(row => row.path === 'replica-spatial-scene.js').sha256, AVATAR_CACHE_BASE_SCENE_SHA256);
  assert.equal(hash(await fs.readFile(new URL('../.office-test/runtime-candidate-v29/replica-spatial-scene.js', import.meta.url))), AVATAR_CACHE_BASE_SCENE_SHA256);
  const ui = await fs.readFile(new URL('../.office-test/runtime-candidate-v29/replica-ui.js', import.meta.url), 'utf8');
  assert.equal(ui.split("brand.href='/dashboard';brand.target='_top';brand.title='Voltar ao CRM';brand.setAttribute('aria-label','Voltar ao CRM');").length, 2);
  assert.deepEqual({...AVATAR_CACHE_SOURCE_FILES}, {'replica-spatial-scene.js': 'replica-spatial-scene.js'});
});
