import {createHash} from 'node:crypto';
import {Script} from 'node:vm';

export const OFFICE_SCRIPT_BUNDLE_VERSION = 1;
export const OFFICE_SCRIPT_BUNDLE_PATH = 'office-scripts-bundle.js';
// Leave 4 KiB raw headroom so base64 plus the JSON envelope stays below 16 MiB.
export const OFFICE_SCRIPT_BUNDLE_MAX_BYTES = 12 * 1024 * 1024 - 4096;
const PREFIX = '/api/office/runtime/';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => {throw new Error('Office script bundle: ' + message);};
const validHash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

/** Parse only the reviewed JSON argument; never evaluate HTML/legacy JavaScript. */
export function readOfficeScriptOrder(index, allowedPaths) {
  if(typeof index !== 'string' || !(allowedPaths instanceof Set)) fail('invalid index/allowlist');
  const calls = [...index.matchAll(/\baureonOfficeCrmRuntime\.start\(\s*(\[[^\]]*\])\s*\);/g)];
  const markers = [...index.matchAll(/\baureonOfficeCrmRuntime\.start\s*\(/g)];
  if(calls.length !== 1 || markers.length !== 1) fail('expected exactly one guarded start(JSON array) call');
  let urls;
  try {urls = JSON.parse(calls[0][1]);} catch {fail('script order must be a JSON array');}
  if(!Array.isArray(urls) || urls.length < 1 || urls.length > 62) fail('invalid script count');
  const order = [], seen = new Set();
  for(const url of urls){
    if(typeof url !== 'string' || !/^\/api\/office\/runtime\/[a-zA-Z0-9_-]+\.js$/.test(url)) fail('invalid script URL');
    const name = url.slice(PREFIX.length);
    if(!allowedPaths.has(name) || name === OFFICE_SCRIPT_BUNDLE_PATH || seen.has(name)) fail('unreviewed or duplicate script');
    seen.add(name);order.push(name);
  }
  return {order, start:calls[0].index, end:calls[0].index+calls[0][0].length};
}

/**
 * Pure guarded concatenation of already adapted scripts. The index keeps its
 * existing script.src/CSP loader; only its one JSON argument changes. vm.Script
 * compiles syntax only. No input script is run, wrapped, eval'ed or minified.
 */
export function buildOfficeScriptBundle({index,scripts,allowedPaths,maxBytes=OFFICE_SCRIPT_BUNDLE_MAX_BYTES}) {
  if(!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > OFFICE_SCRIPT_BUNDLE_MAX_BYTES) fail('invalid byte cap');
  if(!Array.isArray(scripts)) fail('scripts must be records');
  const parsed = readOfficeScriptOrder(index,allowedPaths);
  const byPath = new Map();
  for(const source of scripts){
    if(!source || typeof source !== 'object' || !parsed.order.includes(source.path) || byPath.has(source.path) ||
      typeof source.text !== 'string' || !validHash(source.sourceSha256) || !validHash(source.sha256) ||
      !Number.isSafeInteger(source.sourceBytes) || source.sourceBytes < 0 ||
      !Number.isSafeInteger(source.bytes) || source.bytes < 0) fail('invalid or unreferenced script record');
    const bytes=Buffer.from(source.text,'utf8');
    if(bytes.toString('utf8') !== source.text || bytes.length !== source.bytes || hash(bytes) !== source.sha256) fail('adapted source hash/size mismatch');
    byPath.set(source.path,source);
  }
  if(byPath.size !== parsed.order.length) fail('missing indexed script');
  const chunks=[],inputs=[];let size=0;
  for(const name of parsed.order){
    const source=byPath.get(name);
    const delimiter=';\n/* '+name+' */\n';
    const chunk=delimiter+source.text+'\n';
    size+=Buffer.byteLength(chunk,'utf8');
    if(size>maxBytes) fail('generated script exceeds reserved transport byte cap');
    chunks.push(chunk);
    inputs.push({path:name,sourceBytes:source.sourceBytes,sourceSha256:source.sourceSha256,
      bytes:source.bytes,sha256:source.sha256});
  }
  const text=chunks.join('');
  try {new Script(text,{filename:OFFICE_SCRIPT_BUNDLE_PATH});}
  catch {fail('combined script syntax is invalid; review source boundaries');}
  const nextIndex=index.slice(0,parsed.start)+'aureonOfficeCrmRuntime.start('+
    JSON.stringify([PREFIX+OFFICE_SCRIPT_BUNDLE_PATH])+');'+index.slice(parsed.end);
  const sha256=hash(Buffer.from(text,'utf8'));
  const metadata={version:OFFICE_SCRIPT_BUNDLE_VERSION,path:OFFICE_SCRIPT_BUNDLE_PATH,
    inputScriptCount:inputs.length,entryScriptCount:1,bytes:size,sha256,
    inputIndexSha256:hash(Buffer.from(index,'utf8')),outputIndexSha256:hash(Buffer.from(nextIndex,'utf8')),
    inputs};
  const record={path:OFFICE_SCRIPT_BUNDLE_PATH,bytes:size,outputBytes:size,outputSha256:sha256,
    generated:true,generator:'ordered-script-bundle-v1',inputs,
    adapterRules:[{rule:'ordered-script-bundle',occurrences:inputs.length}],preservedMetadataPaths:[]};
  return {text,index:nextIndex,metadata,record};
}
