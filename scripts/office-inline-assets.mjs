import {createHash} from 'node:crypto';

export const OFFICE_INLINE_SOURCE_SHA256 = '8246f010c4d23e5d57567162ea470dc7d204d4b2e0c9c802ad62f64113cadc50';
export const OFFICE_INLINE_PNG_COUNT = 350;
export const OFFICE_INLINE_URL_PREFIX = '/api/office/runtime/assets/inline-png/';
const DATA_PREFIX = 'data:image/png;base64,';
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error('Office inline PNG: ' + message); };

/**
 * Pure copy-time extraction. No file I/O, app execution or PNG codec.
 * Only reviewed, unescaped, double-quoted URI contents are replaced.
 * PNG compressed bytes are copied unchanged; base64 round-trip is validation only.
 */
export function extractOfficeInlinePng(source, {
  expectedSha256 = OFFICE_INLINE_SOURCE_SHA256,
  expectedCount = OFFICE_INLINE_PNG_COUNT,
} = {}) {
  if (typeof source !== 'string' && !Buffer.isBuffer(source)) fail('expected UTF-8 source text or Buffer');
  if (typeof expectedSha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(expectedSha256)) fail('invalid expected SHA-256');
  if (!Number.isSafeInteger(expectedCount) || expectedCount < 0) fail('invalid expected occurrence count');
  const input = Buffer.isBuffer(source) ? source : Buffer.from(source, 'utf8');
  // Authenticate the exact source before searching, decoding or allocating assets.
  if (hash(input) !== expectedSha256.toLowerCase()) fail('source SHA-256 mismatch; review the source before extracting');
  const original = input.toString('utf8');
  if (!Buffer.from(original, 'utf8').equals(input) || (typeof source === 'string' && original !== source)) {
    fail('source is not canonical UTF-8 text');
  }

  const assets = [], byHash = new Map(), chunks = [];
  let search = 0, previousEnd = 0, occurrences = 0;
  for (;;) {
    const start = original.indexOf(DATA_PREFIX, search);
    if (start < 0) break;
    if (original[start - 1] !== '"') fail('PNG URI is not a reviewed double-quoted literal');
    let slashes = 0;
    for (let i = start - 2; i >= 0 && original[i] === '\\'; i--) slashes++;
    if (slashes % 2) fail('escaped PNG literal needs an explicit adapter');
    const end = original.indexOf('"', start + DATA_PREFIX.length);
    if (end < 0) fail('unterminated PNG URI literal');
    const payload = original.slice(start + DATA_PREFIX.length, end);
    if (!payload || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) fail('invalid PNG base64 payload');
    const bytes = Buffer.from(payload, 'base64');
    if (bytes.toString('base64') !== payload) fail('non-canonical PNG base64 payload');
    if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      fail('decoded image does not have the PNG signature');
    }
    const sha256 = hash(bytes);
    const existing = byHash.get(sha256);
    if (existing && !existing.bytes.equals(bytes)) fail('PNG hash collision');
    if (!existing) {
      const asset = {path: 'assets/inline-png/' + sha256 + '.png', bytes, sha256};
      byHash.set(sha256, asset);
      assets.push(asset);
    }
    chunks.push(original.slice(previousEnd, start), OFFICE_INLINE_URL_PREFIX + sha256 + '.png');
    previousEnd = end;
    search = end + 1;
    occurrences++;
  }
  if (occurrences !== expectedCount) fail('PNG occurrence count mismatch: expected ' + expectedCount + ', found ' + occurrences);
  chunks.push(original.slice(previousEnd));
  const text = chunks.join('');
  return {text, assets, occurrences, inputBytes: input.length, outputBytes: Buffer.byteLength(text, 'utf8')};
}
