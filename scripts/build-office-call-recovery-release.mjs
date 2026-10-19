import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Script} from 'node:vm';
import {buildOfficeScriptBundle} from './office-script-bundle.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const BASE_SHA = 'aa7ea771c0236d49001936b7e1fe74afdbf10104b47056e550aad61966138392';

// Derive from the published, frozen runtime; never repack unpublished prototype changes.
export async function buildCallRecoveryRelease(base, destination) {
  base = path.resolve(base);
  destination = path.resolve(destination);
  if (destination === base || destination.startsWith(base + path.sep)) throw Error('Frozen input cannot be changed');
  const raw = await fs.readFile(path.join(base, 'manifest.json'));
  if (hash(raw) !== BASE_SHA) throw Error('Published v20 manifest mismatch');
  const old = JSON.parse(raw);
  const records = new Map(old.files.map(record => [record.path, record]));
  async function checked(name) {
    const record = records.get(name);
    const bytes = await fs.readFile(path.join(base, name));
    if (!record || bytes.length !== record.bytes || hash(bytes) !== record.sha256) throw Error('Frozen file changed: ' + name);
    return bytes;
  }
  const calls = await fs.readFile(new URL('./runtime/replica-calls-proximity.js', import.meta.url));
  new Script(calls.toString('utf8'));
  const overrides = new Map([['replica-calls.js', calls]]);
  let index = (await checked('index.html')).toString('utf8');
  const start = 'aureonOfficeCrmRuntime.start(["/api/office/runtime/office-scripts-bundle.js"]);';
  if (index.split(start).length !== 2) throw Error('Bundle anchor mismatch');
  index = index.replace(start, 'aureonOfficeCrmRuntime.start(' + JSON.stringify(old.scriptBundle.inputs.map(input => '/api/office/runtime/' + input.path)) + ');');
  const scripts = [];
  for (const input of old.scriptBundle.inputs) {
    const bytes = overrides.get(input.path) || await checked(input.path);
    scripts.push({...input, text: bytes.toString('utf8'), bytes: bytes.length, sha256: hash(bytes)});
  }
  const bundle = buildOfficeScriptBundle({index, scripts, allowedPaths: new Set(records.keys())});
  overrides.set('office-scripts-bundle.js', Buffer.from(bundle.text));
  if (Buffer.from(bundle.index).compare(await checked('index.html')) !== 0) throw Error('Unexpected index delta');
  new Script(bundle.text);
  const next = structuredClone(old);
  next.destination = destination;
  next.generatedAt = new Date().toISOString();
  next.scriptBundle = bundle.metadata;
  next.callRecoveryRelease216 = {baseManifestSha256: BASE_SHA, transientSessionCreationRecovery: true, captureAndAuthorizationBoundariesPreserved: true};
  for (const record of next.files) {
    const bytes = overrides.get(record.path);
    if (!bytes) continue;
    record.bytes = bytes.length;
    record.sha256 = hash(bytes);
    if (record.path === 'office-scripts-bundle.js') Object.assign(record, bundle.record);
    else record.adapterRules.push({rule: 'call-recovery-216', occurrences: 1});
  }
  next.outputBytes = next.files.reduce((sum, record) => sum + record.bytes, 0);
  await fs.mkdir(destination, {recursive: false});
  for (const record of next.files) {
    const bytes = overrides.get(record.path) || await checked(record.path);
    await fs.mkdir(path.dirname(path.join(destination, record.path)), {recursive: true});
    await fs.writeFile(path.join(destination, record.path), bytes, {flag: 'wx'});
  }
  const manifest = Buffer.from(JSON.stringify(next, null, 2) + '\n');
  await fs.writeFile(path.join(destination, 'manifest.json'), manifest, {flag: 'wx'});
  return {manifestSha256: hash(manifest), fileCount: next.fileCount, payloadBytes: next.outputBytes, changed: next.files.filter(record => record.sha256 !== records.get(record.path).sha256).map(({path, sha256, bytes}) => ({path, sha256, bytes}))};
}

if (process.argv[2]) console.log(JSON.stringify(await buildCallRecoveryRelease(process.argv[2], process.argv[3]), null, 2));
