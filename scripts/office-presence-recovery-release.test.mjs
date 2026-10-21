import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PRESENCE_RECOVERY_BASE_MANIFEST_SHA256, PRESENCE_RECOVERY_BASE_UI_SHA256, PRESENCE_RECOVERY_PRESERVED_SHA256,
  PRESENCE_RECOVERY_SOURCE_FILES, PRESENCE_RECOVERY_UI_PATCH, patchPresenceRecoveryUi, rebuildPresenceRecoveryBundle} from './build-office-presence-recovery-release.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const start='aureonOfficeCrmRuntime.start(["/api/office/runtime/office-scripts-bundle.js"]);';
function fixture(){
 const names=['replica-ui.js',...Object.keys(PRESENCE_RECOVERY_SOURCE_FILES)];
 const sources=new Map(names.map(name=>[name,Buffer.from('/* original '+name+' */')]));
 const inputs=[...sources].map(([path,b])=>({path,bytes:b.length,sha256:hash(b),sourceBytes:b.length,sourceSha256:hash(b)}));
 const replacements=new Map(names.map(n=>[n,Buffer.from('throw Error("packaging must never execute '+n+'");')]));
 return {sources,replacements,manifest:{files:[...inputs,{path:'office-scripts-bundle.js'}],scriptBundle:{inputs}},index:Buffer.from('<html><body><script>'+start+'</script></body></html>')};
}
test('222 packages five reviewed scripts, preserving entry bytes and bundle input order without execution',async()=>{
 const f=fixture(),before=Buffer.from(f.index),result=await rebuildPresenceRecoveryBundle(f.manifest,f.index,n=>f.sources.get(n),f.replacements);
 assert.deepEqual([...result.overrides.keys()].sort(),['office-scripts-bundle.js','replica-ui.js',...Object.keys(PRESENCE_RECOVERY_SOURCE_FILES)].sort());
 assert.deepEqual(Buffer.from(result.bundle.index),before);assert.deepEqual(f.index,before);
 assert.deepEqual(result.bundle.metadata.inputs.map(r=>r.path),f.manifest.scriptBundle.inputs.map(r=>r.path));
 assert.equal(result.bundle.metadata.inputs.find(r=>r.path==='replica-ui.js').sha256,hash(f.replacements.get('replica-ui.js')));
});
test('222 refuses unknown scripts, missing replacements, invalid UTF8 or malformed code',async()=>{
 const f=fixture(),extra=new Map(f.replacements);extra.set('app.js',Buffer.from('throw Error("unapproved")'));
 await assert.rejects(rebuildPresenceRecoveryBundle(f.manifest,f.index,n=>f.sources.get(n),extra),/allowlist/);
 await assert.rejects(rebuildPresenceRecoveryBundle(f.manifest,f.index,n=>f.sources.get(n),new Map()),/allowlist/);
 for(const bytes of [Buffer.from([255]),Buffer.from('function broken({'),Buffer.alloc(0)]){
  const replacements=new Map(f.replacements);replacements.set('replica-calls.js',bytes);
  await assert.rejects(rebuildPresenceRecoveryBundle(f.manifest,f.index,n=>f.sources.get(n),replacements));
 }
});
test('222 refuses a changed or repeated runtime entry',async()=>{
 const f=fixture();for(const index of [Buffer.from('<html></html>'),Buffer.concat([f.index,f.index])])
  await assert.rejects(rebuildPresenceRecoveryBundle(f.manifest,index,n=>f.sources.get(n),f.replacements),/index anchor/);
});
test('222 base pins preserve approved map, CRM return, avatar cache renderer and movement cores',async context=>{
 let raw;try{raw=await fs.readFile(new URL('../.office-test/runtime-candidate-v30/manifest.json',import.meta.url));}
 catch(e){if(e.code==='ENOENT')return context.skip('Private frozen v30 is absent in this checkout');throw e;}
 assert.equal(hash(raw),PRESENCE_RECOVERY_BASE_MANIFEST_SHA256);const m=JSON.parse(raw);
 assert.equal(m.fileCount,8495);assert.equal(m.scriptBundle.inputs.length,62);
 for(const [name,pin]of Object.entries(PRESENCE_RECOVERY_PRESERVED_SHA256)){
  assert.equal(m.files.find(r=>r.path===name).sha256,pin);
  assert.equal(hash(await fs.readFile(new URL('../.office-test/runtime-candidate-v30/'+name,import.meta.url))),pin);
 }
 const ui=await fs.readFile(new URL('../.office-test/runtime-candidate-v30/replica-ui.js',import.meta.url),'utf8');
 assert.equal(hash(ui),PRESENCE_RECOVERY_BASE_UI_SHA256);
 const changed=patchPresenceRecoveryUi(ui);assert.equal(changed,ui.replace(...PRESENCE_RECOVERY_UI_PATCH));
 assert.ok(changed.includes("brand.href='/dashboard';brand.target='_top';brand.title='Voltar ao CRM';brand.setAttribute('aria-label','Voltar ao CRM');"));
 assert.throws(()=>patchPresenceRecoveryUi(ui+' '),/UI hash/);
});
