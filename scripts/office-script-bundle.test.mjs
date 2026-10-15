import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Script} from 'node:vm';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {buildOfficeScriptBundle,readOfficeScriptOrder,OFFICE_SCRIPT_BUNDLE_PATH,OFFICE_SCRIPT_BUNDLE_MAX_BYTES} from './office-script-bundle.mjs';
import {planOfficePackage,writeOfficePackage,runCli} from './package-office.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const prefix='/api/office/runtime/';
const names=['seat-exit-v1.js','nearby-recovery-v1.js'];
const allowedPaths=new Set(names);
const indexFor=order=>'<html><head></head><body><script>before();aureonOfficeCrmRuntime.start('+
  JSON.stringify(order.map(name=>prefix+name))+');after();</script></body></html>';
const source=(name,text)=>({path:name,text,sourceBytes:Buffer.byteLength(text),sourceSha256:hash(text),
  bytes:Buffer.byteLength(text),sha256:hash(text)});
const scripts=()=>[source(names[0],"globalThis.trace=['first']"),source(names[1],"(function(){globalThis.trace.push('second')})()")];
const build=overrides=>buildOfficeScriptBundle({index:indexFor(names),scripts:scripts(),allowedPaths,...overrides});

test('bundle preserves order, ASI boundaries and one external script entry',()=>{
  const result=build({scripts:scripts().reverse()});
  assert.ok(result.text.startsWith(';\n/* seat-exit-v1.js */\n'));
  assert.equal(result.metadata.inputScriptCount,2);
  assert.equal(result.metadata.entryScriptCount,1);
  assert.equal(result.record.generated,true);
  assert.equal(result.record.virtual,undefined);
  assert.equal(result.record.outputSha256,hash(result.text));
  assert.equal(result.record.bytes,Buffer.byteLength(result.text));


  assert.ok(result.index.includes('aureonOfficeCrmRuntime.start(["'+prefix+OFFICE_SCRIPT_BUNDLE_PATH+'"]);'));
  assert.ok(result.index.includes('before();')&&result.index.includes('after();'));
  const fixtureContext={};
  new Script(result.text).runInNewContext(fixtureContext); // Synthetic fixture only; never a real office script.
  assert.deepEqual(Array.from(fixtureContext.trace),['first','second']);
});

test('compiles without executing input and produces deterministic metadata',()=>{
  const input=[source(names[0],"throw Error('compile only')"),source(names[1],"globalThis.unused=true;")];
  const first=build({scripts:input}),second=build({scripts:input.reverse()});
  assert.equal(first.text,second.text);
  assert.deepEqual(first.record,second.record);
  assert.equal(JSON.stringify(first.metadata).includes('compile only'),false);
  assert.deepEqual(first.metadata.inputs.map(record=>record.path),names);
});

test('UTF-8 byte cap reserves 4 KiB raw below 12 MiB for the JSON envelope',()=>{
  assert.equal(OFFICE_SCRIPT_BUNDLE_MAX_BYTES,12*1024*1024-4096);
  const maximumEnvelope=JSON.stringify({data:'A'.repeat(4*Math.ceil(OFFICE_SCRIPT_BUNDLE_MAX_BYTES/3)),metadata:'x'.repeat(4096)});
  assert.ok(Buffer.byteLength(maximumEnvelope)<=16*1024*1024);
  const unicode=[source(names[0],"globalThis.word='ação';"),source(names[1],"globalThis.done=true;")];
  const result=build({scripts:unicode});
  assert.ok(result.text.length<result.record.bytes);
  assert.throws(()=>build({scripts:unicode,maxBytes:result.record.bytes-1}),/byte cap/);
  assert.equal(build({scripts:unicode,maxBytes:result.record.bytes}).record.bytes,result.record.bytes);
  for(const maxBytes of [0,-1,1.5,NaN,OFFICE_SCRIPT_BUNDLE_MAX_BYTES+1])
    assert.throws(()=>build({maxBytes}),/invalid byte cap/);
  const huge=source(names[0],'/*'+'x'.repeat(OFFICE_SCRIPT_BUNDLE_MAX_BYTES)+'*/');
  assert.throws(()=>build({scripts:[huge,scripts()[1]]}),/byte cap/);
});

test('requires exactly one JSON start call and reviewed unique URLs',()=>{
  for(const index of [
    '<html></html>',
    indexFor(names)+indexFor(names),
    indexFor(names).replace('start([','start(/*not JSON*/['),
    indexFor(names).replace(JSON.stringify(prefix+names[0]),'window.chosen'),
    indexFor([names[0],names[0]]),
    indexFor([]),
    indexFor(['../secret.js']),
    indexFor(['unreviewed.js']),
    indexFor([OFFICE_SCRIPT_BUNDLE_PATH]),
    indexFor(names).replace(prefix+names[0],'https://foreign.invalid/a.js'),
    indexFor(names).replace(prefix+names[0],prefix+'%2e%2e/secret.js'),
  ]) assert.throws(()=>build({index}),/start|JSON|script|URL/);
});

test('rejects missing, duplicate, unreferenced or tampered script records',()=>{
  const cases=[
    [],[scripts()[0]],[scripts()[0],scripts()[0]],
    [...scripts(),source('third.js','globalThis.bad=true')],
    [{...scripts()[0],sha256:'0'.repeat(64)},scripts()[1]],
    [{...scripts()[0],bytes:1},scripts()[1]],
    [{...scripts()[0],sourceSha256:'invalid'},scripts()[1]],
    [{...scripts()[0],text:'\ud800',bytes:3,sha256:hash(Buffer.from('\ud800'))},scripts()[1]],
  ];
  for(const records of cases)assert.throws(()=>build({scripts:records}),/script|hash|size/);
});

test('compilation rejects new lexical collisions and syntax errors without wrapping sources',()=>{
  assert.throws(()=>build({scripts:[source(names[0],'const collision=1;'),source(names[1],'const collision=2;')]}),/syntax/);
  assert.throws(()=>build({scripts:[source(names[0],'function broken( {'),scripts()[1]]}),/syntax/);
});

async function fixture(t,extra={}) {
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'aureon-office-bundle-'));
  t.after(async()=>{
    const resolved=path.resolve(temporary),parent=path.resolve(os.tmpdir());
    assert.equal(path.dirname(resolved),parent);
    assert.ok(path.basename(resolved).startsWith('aureon-office-bundle-'));
    assert.equal((await fs.lstat(resolved)).isSymbolicLink(),false);
    await fs.rm(resolved,{recursive:true,force:true});
  });
  const sourceRoot=path.join(temporary,'source'),destination=path.join(temporary,'runtime');
  await fs.mkdir(sourceRoot);
  const files={
    'index.html':'<html><head><link rel="stylesheet" href="/style.css"></head><body>'+
      '<script src="/seat-exit-v1.js"></script><script src="/nearby-recovery-v1.js"></script></body></html>',
    'style.css':'body{color:#fff}',
    'seat-exit-v1.js':"window.fixtureOrder=['first']",
    'nearby-recovery-v1.js':"(function(){window.fixtureOrder.push('second')})();",
    ...extra,
  };
  for(const [name,text]of Object.entries(files))await fs.writeFile(path.join(sourceRoot,name),text);
  return{source:sourceRoot,destination,optimizeInlineImages:false,files};
}

test('package default leaves the index/order unchanged and generates nothing',async t=>{
  const f=await fixture(t);
  const plan=await planOfficePackage(f);
  assert.equal(plan.bundleScripts,false);
  assert.equal(plan.scriptBundle,null);
  assert.equal(plan.generatedFileCount,0);
  assert.equal(plan.entryScriptCount,2);
  assert.equal(plan.files.some(file=>file.generated),false);
  await assert.rejects(fs.stat(f.destination),{code:'ENOENT'});
});

test('opt-in package plans metadata only and writes a regenerated, hashed new bundle',async t=>{
  const f=await fixture(t);
  const original=await fs.readFile(path.join(f.source,'index.html'));
  const plan=await planOfficePackage({...f,bundleScripts:true});
  assert.equal(plan.bundleScripts,true);
  assert.equal(plan.scriptCount,2); // Selected source entries, kept for provenance.
  assert.equal(plan.entryScriptCount,1);
  assert.equal(plan.generatedFileCount,1);
  assert.equal(plan.sourceFileCount,4);
  assert.equal(plan.virtualAssetCount,0);
  assert.equal(plan.fileCount,5);
  assert.equal(plan.files.filter(file=>file.generated).length,1);
  assert.equal(plan.files.find(file=>file.generated).virtual,undefined);
  assert.equal(JSON.stringify(plan).includes("window.fixtureOrder"),false);
  await assert.rejects(fs.stat(f.destination),{code:'ENOENT'});
  await assert.rejects(fs.stat(path.join(f.source,OFFICE_SCRIPT_BUNDLE_PATH)),{code:'ENOENT'});
  const manifest=await writeOfficePackage({...f,bundleScripts:true});
  const writtenIndex=await fs.readFile(path.join(f.destination,'index.html'),'utf8');
  const generated=manifest.files.find(file=>file.generated);
  const bytes=await fs.readFile(path.join(f.destination,generated.path));
  assert.equal(generated.sha256,hash(bytes));
  assert.equal(generated.bytes,bytes.length);
  assert.equal(generated.virtual,undefined);
  assert.equal(generated.sourceSha256,undefined);
  assert.deepEqual(generated.inputs.map(record=>record.path),names);
  for(const input of generated.inputs){
    assert.equal(input.sourceSha256,hash(await fs.readFile(path.join(f.source,input.path))));
    assert.equal(input.sha256,hash(await fs.readFile(path.join(f.destination,input.path))));
  }
  assert.ok(writtenIndex.includes('aureonOfficeCrmRuntime.start(["'+prefix+OFFICE_SCRIPT_BUNDLE_PATH+'"]);'));
  assert.ok(writtenIndex.includes('await loadScript(src)'));
  assert.equal(writtenIndex.includes('window.fetch='),false);
  assert.equal(writtenIndex.includes('createObjectURL'),false);
  assert.equal(manifest.readyToServe,false);
  assert.equal(manifest.identityEnabled,false);
  assert.equal(manifest.apiEnabled,false);
  assert.deepEqual(await fs.readFile(path.join(f.source,'index.html')),original);
  await assert.rejects(writeOfficePackage({...f,bundleScripts:true}),/destination already exists/);
});

test('CLI opts in explicitly and rejects duplicate flags or non-boolean API values',async t=>{
  const f=await fixture(t);
  const plan=await runCli(['--source',f.source,'--dest',f.destination,'--bundle-scripts'],{optimizeInlineImages:false});
  assert.equal(plan.bundleScripts,true);
  assert.equal(plan.entryScriptCount,1);
  assert.equal(plan.mode,'dry-run');
  assert.equal((await runCli(['--help'])).scriptBundlingDefault,false);
  await assert.rejects(runCli(['--source',f.source,'--dest',f.destination,'--bundle-scripts','--bundle-scripts'],{optimizeInlineImages:false}),/duplicate/);
  await assert.rejects(planOfficePackage({...f,bundleScripts:'true'}),/must be boolean/);
});

test('known dependencies not in the index cannot be appended in a guessed order',async t=>{
  const f=await fixture(t,{
    'index.html':'<html><head></head><body><script src="/seat-exit-v1.js"></script></body></html>',
    'seat-exit-v1.js':"import('/nearby-recovery-v1.js');",
  });
  await assert.rejects(planOfficePackage({...f,bundleScripts:true}),/unreferenced/);
  await assert.rejects(fs.stat(f.destination),{code:'ENOENT'});
});

test('frozen v4 scripts compile in memory only and preserve their source hashes',async t=>{
  const root=fileURLToPath(new URL('../.office-test/runtime-candidate-v4/',import.meta.url));
  let manifest;
  try{manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));}
  catch(error){if(error.code==='ENOENT'){t.skip('local frozen runtime fixture is absent');return;}throw error;}
  const index=await fs.readFile(path.join(root,'index.html'),'utf8');
  const allowed=new Set(manifest.files.filter(record=>/^[a-zA-Z0-9_-]+\.js$/.test(record.path)).map(record=>record.path));
  const {order}=readOfficeScriptOrder(index,allowed);
  assert.equal(order.length,62);
  const inputs=[];
  for(const name of order){
    const record=manifest.files.find(file=>file.path===name),bytes=await fs.readFile(path.join(root,name));
    assert.equal(hash(bytes),record.sha256);
    inputs.push({path:name,text:bytes.toString('utf8'),sourceBytes:record.sourceBytes,
      sourceSha256:record.sourceSha256,bytes:bytes.length,sha256:record.sha256});
  }
  const result=buildOfficeScriptBundle({index,scripts:inputs,allowedPaths:allowed});
  assert.equal(result.metadata.inputScriptCount,62);
  assert.ok(result.record.bytes<=OFFICE_SCRIPT_BUNDLE_MAX_BYTES);
  assert.equal(result.record.bytes,6_266_871);
  assert.equal(result.record.outputSha256,'6a94f9e7dbb12ada273b513eb25db2c02541416b8af20122a4f329c71b6b3c92');
});
