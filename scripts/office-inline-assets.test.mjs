import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as fs from 'node:fs/promises';
import {deflateSync} from 'node:zlib';
import {
  extractOfficeInlinePng, OFFICE_INLINE_SOURCE_SHA256, OFFICE_INLINE_PNG_COUNT, OFFICE_INLINE_URL_PREFIX,
} from './office-inline-assets.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type), result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0); name.copy(result, 4); data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), result.length - 4);
  return result;
}
function png(red, green, blue) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from([0, red, green, blue, 255]))), chunk('IEND', Buffer.alloc(0)),
  ]);
}
const a = png(255, 0, 0), b = png(0, 0, 255);
const uri = bytes => 'data:image/png;base64,' + bytes.toString('base64');
const options = (source, count) => ({expectedSha256: hash(Buffer.from(source)), expectedCount: count});

test('extracts byte-identical PNGs, deduplicates by binary SHA and uses only the fixed private prefix', () => {
  const source = 'const views=[' + JSON.stringify(uri(a)) + ',' + JSON.stringify(uri(b)) + ',' + JSON.stringify(uri(a)) + '];';
  const result = extractOfficeInlinePng(source, options(source, 3));
  assert.equal(result.occurrences, 3);
  assert.equal(result.assets.length, 2);
  assert.deepEqual(result.assets.map(asset => asset.bytes), [a, b]);
  for (const asset of result.assets) {
    assert.match(asset.path, /^assets\/inline-png\/[0-9a-f]{64}\.png$/);
    assert.equal(asset.sha256, hash(asset.bytes));
    assert.ok(result.text.includes(OFFICE_INLINE_URL_PREFIX + asset.sha256 + '.png'));
  }
  assert.equal(result.inputBytes, Buffer.byteLength(source));
  assert.equal(result.outputBytes, Buffer.byteLength(result.text));
  assert.equal(result.text.split(OFFICE_INLINE_URL_PREFIX).length - 1, 3);
});

test('preserves every character outside URI intervals, including Unicode, quotes and map geometry', () => {
  const source = '// direção e café ☕\nconst note="preservar";const o={x:224,y:400,uri:' + JSON.stringify(uri(a)) + '};\n// fim\n';
  const expected = '// direção e café ☕\nconst note="preservar";const o={x:224,y:400,uri:"' +
    OFFICE_INLINE_URL_PREFIX + hash(a) + '.png"};\n// fim\n';
  assert.equal(extractOfficeInlinePng(source, options(source, 1)).text, expected);
});

test('checks the source hash before scanning or decoding untrusted content', () => {
  const source = 'const broken="data:image/png;base64,not!base64";';
  assert.throws(() => extractOfficeInlinePng(source), /source SHA-256 mismatch/);
  assert.throws(() => extractOfficeInlinePng(source, {...options(source, 1), expectedSha256: '0'.repeat(64)}), /SHA-256 mismatch/);
});

test('refuses count drift and invalid options instead of producing partial assets', () => {
  const source = 'const image=' + JSON.stringify(uri(a)) + ';';
  assert.throws(() => extractOfficeInlinePng(source, options(source, 2)), /occurrence count mismatch/);
  assert.throws(() => extractOfficeInlinePng(source, {...options(source, 1), expectedCount: -1}), /invalid expected occurrence/);
  assert.throws(() => extractOfficeInlinePng(source, {...options(source, 1), expectedSha256: '*'}), /invalid expected SHA/);
  assert.throws(() => extractOfficeInlinePng(42), /expected UTF-8/);
});

test('rejects noncanonical base64, invalid signatures and unreviewed literal contexts', () => {
  const examples = [
    ['const a="data:image/png;base64,AA!A";', /invalid PNG base64/],
    ['const a="data:image/png;base64,' + a.toString('base64').replace(/=+$/, '') + '";', /non-canonical/],
    ['const a="data:image/png;base64,' + Buffer.from('not PNG').toString('base64') + '";', /PNG signature/],
    ["const a='" + uri(a) + "';", /double-quoted/],
    ['const a=\\"' + uri(a) + '\\";', /escaped PNG literal/],
  ];
  for (const [source, error] of examples) {
    assert.throws(() => extractOfficeInlinePng(source, options(source, 1)), error);
  }
});

test('accepts a reviewed zero-image source unchanged and detaches output image bytes', () => {
  const empty = 'const count=0;\n';
  const noImages = extractOfficeInlinePng(empty, options(empty, 0));
  assert.equal(noImages.text, empty); assert.deepEqual(noImages.assets, []);
  const source = Buffer.from('const image=' + JSON.stringify(uri(a)) + ';');
  const result = extractOfficeInlinePng(source, options(source, 1));
  source.fill(0);
  assert.deepEqual(result.assets[0].bytes, a);
});

test('rejects invalid UTF-8 even with an explicitly matching fixture hash', () => {
  const source = Buffer.from([255, 254, 34]);
  assert.throws(() => extractOfficeInlinePng(source, {expectedSha256: hash(source), expectedCount: 0}), /canonical UTF-8/);
});

test('approved local source: 350 occurrences / 305 unique PNGs; reversible and source remains unchanged', async t => {
  const sourcePath = new URL('../../aurion-escritorio-local/app.js', import.meta.url);
  let source;
  try { source = await fs.readFile(sourcePath); }
  catch (error) { if (error.code === 'ENOENT') { t.skip('Approved local source is unavailable in this checkout'); return; } throw error; }
  assert.equal(hash(source), OFFICE_INLINE_SOURCE_SHA256);
  const before = await fs.stat(sourcePath);
  const result = extractOfficeInlinePng(source);
  assert.equal(result.occurrences, OFFICE_INLINE_PNG_COUNT);
  assert.equal(result.occurrences, 350); assert.equal(result.assets.length, 305);
  assert.equal(result.inputBytes, 58326589); assert.equal(result.outputBytes, 4698809);
  assert.equal(result.assets.reduce((sum, asset) => sum + asset.bytes.length, 0), 36966225);
  const byHash = new Map(result.assets.map(asset => [asset.sha256, asset]));
  const restored = result.text.replace(/\/api\/office\/runtime\/assets\/inline-png\/([0-9a-f]{64})\.png/g, (_url, sha) => {
    const asset = byHash.get(sha); assert.ok(asset); assert.equal(hash(asset.bytes), sha);
    return uri(asset.bytes);
  });
  assert.deepEqual(Buffer.from(restored), source);
  const after = await fs.stat(sourcePath);
  assert.equal(after.size, before.size); assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(hash(await fs.readFile(sourcePath)), OFFICE_INLINE_SOURCE_SHA256);
});
