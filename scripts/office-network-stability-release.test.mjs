import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Script} from 'node:vm';
import {NETWORK_STABILITY_BASE_MANIFEST_SHA256, NETWORK_STABILITY_BASE_UI_SHA256, NETWORK_STABILITY_PRESERVED_SHA256, NETWORK_STABILITY_SOURCE_FILES,
  NETWORK_STABILITY_UI_ERROR_REPLACEMENT, patchNetworkStabilityUi, rebuildNetworkStabilityBundle, buildNetworkStabilityRelease} from './build-office-network-stability-release.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const start = 'aureonOfficeCrmRuntime.start(["/api/office/runtime/office-scripts-bundle.js"]);';
function fixture() {
  const sources = new Map([
    ['replica-calls.js', Buffer.from('globalThis.calls = "old";')],
    ['spatial-scene-core.js', Buffer.from('globalThis.motion = "old";')],
    ['replica-ui.js', Buffer.from('globalThis.visibleCrmReturn = true;')],
  ]);
  const inputs = [...sources].map(([name, bytes]) => ({path: name, bytes: bytes.length, sha256: hash(bytes), sourceBytes: bytes.length, sourceSha256: hash(bytes)}));
  return {
    sources, manifest: {files: [...inputs, {path: 'office-scripts-bundle.js'}], scriptBundle: {inputs}},
    index: Buffer.from('<!doctype html><html><head></head><body><script>' + start + '</script></body></html>'),
    // A throw proves syntax compilation does not execute actual input code.
    replacements: new Map([
      ['replica-calls.js', Buffer.from('throw Error("do not execute calls");')],
      ['spatial-scene-core.js', Buffer.from('throw Error("do not execute scene");')],
      ['replica-ui.js', Buffer.from('globalThis.visibleCrmReturn = true; globalThis.callConflictCode = true;')],
    ]),
  };
}

test('the bundle changes only calls, spatial cadence and conflict UI; index and original inputs stay byte-identical', async () => {
  const f = fixture(), indexBefore = Buffer.from(f.index), uiBefore = Buffer.from(f.sources.get('replica-ui.js'));
  const result = await rebuildNetworkStabilityBundle(f.manifest, f.index, name => f.sources.get(name), f.replacements);
  assert.deepEqual([...result.overrides.keys()].sort(), ['office-scripts-bundle.js', 'replica-calls.js', 'replica-ui.js', 'spatial-scene-core.js']);
  assert.deepEqual(f.index, indexBefore); assert.deepEqual(Buffer.from(result.bundle.index), indexBefore);
  assert.deepEqual(f.sources.get('replica-ui.js'), uiBefore);
  assert.deepEqual(result.bundle.metadata.inputs.map(row => row.path), f.manifest.scriptBundle.inputs.map(row => row.path));
  for (const [name, bytes] of f.replacements) {
    assert.deepEqual(result.overrides.get(name), bytes);
    assert.equal(result.bundle.metadata.inputs.find(row => row.path === name).sha256, hash(bytes));
  }
  assert.ok(result.bundle.text.indexOf('do not execute calls') < result.bundle.text.indexOf('do not execute scene'));
});

test('extra or missing replacements, malformed UTF-8 and invalid JavaScript cannot enter a release', async () => {
  const f = fixture(), checked = name => f.sources.get(name);
  const extra = new Map(f.replacements); extra.set('app.js', Buffer.from('globalThis.bad=true;'));
  const missing = new Map(f.replacements); missing.delete('spatial-scene-core.js');
  for (const replacements of [extra, missing]) await assert.rejects(rebuildNetworkStabilityBundle(f.manifest, f.index, checked, replacements), /allowlist/);
  for (const bytes of [Buffer.alloc(0), Buffer.from([0xff]), Buffer.from('function broken( {')]) {
    const replacements = new Map(f.replacements); replacements.set('replica-calls.js', bytes);
    await assert.rejects(rebuildNetworkStabilityBundle(f.manifest, f.index, checked, replacements));
  }
});

test('a changed or repeated runtime start cannot silently alter the guarded index', async () => {
  const f = fixture();
  for (const index of [Buffer.from('<html></html>'), Buffer.concat([f.index, f.index]), Buffer.from(f.index.toString().replace(start, start.replace('start(', 'start( ')))]) {
    await assert.rejects(rebuildNetworkStabilityBundle(f.manifest, index, name => f.sources.get(name), f.replacements), /index anchor/);
  }
});

async function temporary(context) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'office-network-release-'));
  context.after(async () => {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('office-network-release-'));
    assert.equal((await fs.lstat(resolved)).isSymbolicLink(), false);
    await fs.rm(resolved, {recursive: true, force: true});
  });
  return directory;
}

test('a drifted manifest fails before output; a destination inside the frozen source is rejected', async context => {
  const directory = await temporary(context), base = path.join(directory, 'base'), destination = path.join(directory, 'new');
  await fs.mkdir(base); await fs.writeFile(path.join(base, 'manifest.json'), '{"fileCount":8495}\n', {flag: 'wx'});
  await assert.rejects(buildNetworkStabilityRelease(base, destination), /v27 manifest mismatch/);
  await assert.rejects(fs.lstat(destination), {code: 'ENOENT'});
  await assert.rejects(buildNetworkStabilityRelease(base, path.join(base, 'nested')), /Frozen input cannot be changed/);
});

test('an existing output directory and its contents are preserved', async context => {
  const directory = await temporary(context), base = path.join(directory, 'base'), destination = path.join(directory, 'existing');
  await fs.mkdir(base); await fs.mkdir(destination); await fs.writeFile(path.join(destination, 'keep.txt'), 'preserve', {flag: 'wx'});
  await assert.rejects(buildNetworkStabilityRelease(base, destination), /destination already exists/);
  assert.equal(await fs.readFile(path.join(destination, 'keep.txt'), 'utf8'), 'preserve');
  assert.deepEqual(await fs.readdir(destination), ['keep.txt']);
});

test('the UI patch admits call-session409 code without widening GET or other endpoint handling', () => {
  const evaluate = new Script(NETWORK_STABILITY_UI_ERROR_REPLACEMENT[1]);
  for (const [endpoint, body, expected] of [
    ['signals', undefined, true], ['signals', {}, false], ['signal', {}, true], ['signal', undefined, false],
    ['call-session', {}, true], ['call-session', undefined, false], ['settings', {}, false], ['leave', {}, false],
  ]) assert.equal(evaluate.runInNewContext({endpoint, body}), expected);
  assert.throws(() => patchNetworkStabilityUi(NETWORK_STABILITY_UI_ERROR_REPLACEMENT[0]), /v27 UI hash mismatch/);
});

test('published v27 pins preserve the approved index, return link and exact two source replacements', async context => {
  let raw;
  try {raw = await fs.readFile(new URL('../.office-test/runtime-candidate-v27/manifest.json', import.meta.url));}
  catch (error) {if (error.code === 'ENOENT') return context.skip('The reviewed private v27 runtime is not installed in this checkout.'); throw error;}
  assert.equal(hash(raw), NETWORK_STABILITY_BASE_MANIFEST_SHA256);
  const manifest = JSON.parse(raw);
  assert.equal(manifest.fileCount, 8495); assert.equal(manifest.scriptBundle.inputs.length, 62);
  for (const [name, expected] of Object.entries(NETWORK_STABILITY_PRESERVED_SHA256)) {
    assert.equal(manifest.files.find(row => row.path === name).sha256, expected);
    assert.equal(hash(await fs.readFile(new URL('../.office-test/runtime-candidate-v27/' + name, import.meta.url))), expected);
  }
  const ui = await fs.readFile(new URL('../.office-test/runtime-candidate-v27/replica-ui.js', import.meta.url), 'utf8');
  assert.equal(hash(ui), NETWORK_STABILITY_BASE_UI_SHA256);
  const changed = patchNetworkStabilityUi(ui);
  assert.equal(changed.replace(NETWORK_STABILITY_UI_ERROR_REPLACEMENT[1], NETWORK_STABILITY_UI_ERROR_REPLACEMENT[0]), ui);
  const returnLink = "brand.href='/dashboard';brand.target='_top';brand.title='Voltar ao CRM';brand.setAttribute('aria-label','Voltar ao CRM');";
  assert.equal(changed.split(returnLink).length, 2); assert.equal(ui.split(returnLink).length, 2);
  new Script(changed);
  assert.throws(() => patchNetworkStabilityUi(changed), /v27 UI hash mismatch/);
  assert.deepEqual({...NETWORK_STABILITY_SOURCE_FILES}, {'replica-calls.js': 'replica-calls-proximity.js', 'spatial-scene-core.js': 'spatial-scene-core.js'});
});
