import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Script} from 'node:vm';
import {CRM_RETURN_BASE_UI_SHA256, CRM_RETURN_VISIBLE_REPLACEMENT, patchCrmReturnUi, buildCrmReturnRelease} from './build-office-crm-return-release.mjs';

test('the visible rail brand is a same-tab top-level CRM link with unchanged au text', () => {
  const children = [];
  const rail = {prepend(node) {children.unshift(node);}};
  const document = {
    querySelector(selector) {assert.equal(selector, '.rail'); return rail;},
    createElement(tag) {return {tagName: tag.toUpperCase(), attributes: {}, style: {}, hidden: false, setAttribute(name, value) {this.attributes[name] = value;}};},
  };
  const el = (tag, className, text) => Object.assign(document.createElement(tag), {className, textContent: text});
  // Execute the actual patch fragment against DOM primitives, not a copy of it.
  new Script(CRM_RETURN_VISIBLE_REPLACEMENT[1]).runInNewContext({document, el});
  assert.equal(children.length, 1);
  const brand = children[0];
  assert.equal(brand.tagName, 'A'); assert.equal(brand.className, 'r-brand'); assert.equal(brand.textContent, 'au');
  assert.equal(brand.href, '/dashboard'); assert.equal(brand.target, '_top'); assert.equal(brand.attributes['aria-label'], 'Voltar ao CRM');
  assert.equal(brand.title, 'Voltar ao CRM'); assert.equal(brand.style.color, 'inherit'); assert.equal(brand.style.textDecoration, 'none');
  assert.equal(brand.hidden, false); assert.notEqual(brand.style.display, 'none');
  assert.equal(brand.onclick, undefined, 'Native link navigation preserves browser keyboard/modifier semantics.');
});

test('unknown UI bytes are rejected even if the visible brand anchor exists', () => {
  assert.throws(() => patchCrmReturnUi(CRM_RETURN_VISIBLE_REPLACEMENT[0]), /v26 UI hash mismatch/);
  assert.throws(() => patchCrmReturnUi('/* drift */\n' + CRM_RETURN_VISIBLE_REPLACEMENT[0]), /v26 UI hash mismatch/);
});

test('reviewed frozen UI accepts one patch, compiles, and cannot be patched twice', async context => {
  let source;
  try {source = await fs.readFile(new URL('../.office-test/runtime-candidate-v26/replica-ui.js', import.meta.url), 'utf8');}
  catch (error) {if (error.code === 'ENOENT') return context.skip('The reviewed private v26 runtime is not installed in this checkout.'); throw error;}
  assert.equal(createHash('sha256').update(source).digest('hex'), CRM_RETURN_BASE_UI_SHA256);
  const changed = patchCrmReturnUi(source);
  assert.equal(source.split(CRM_RETURN_VISIBLE_REPLACEMENT[0]).length, 2);
  assert.equal(changed.split(CRM_RETURN_VISIBLE_REPLACEMENT[1]).length, 2);
  new Script(changed);
  assert.throws(() => patchCrmReturnUi(changed), /v26 UI hash mismatch/);
});

test('a drifted manifest fails before creating the new release', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'office-crm-return-'));
  try {
    const base = path.join(root, 'base'), destination = path.join(root, 'new');
    await fs.mkdir(base); await fs.writeFile(path.join(base, 'manifest.json'), '{"fileCount":8495}\n', {flag: 'wx'});
    await assert.rejects(buildCrmReturnRelease(base, destination), /v26 manifest mismatch/);
    await assert.rejects(fs.lstat(destination), {code: 'ENOENT'});
    await assert.rejects(buildCrmReturnRelease(base, path.join(base, 'nested')), /Frozen input cannot be changed/);
  } finally {
    const resolved = path.resolve(root);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('office-crm-return-'));
    await fs.rm(resolved, {recursive: true, force: true});
  }
});
