import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Script} from 'node:vm';
import {buildOfficeScriptBundle} from './office-script-bundle.mjs';
import {remoteMotionPatch} from './office-remote-motion-patch.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const READY_BASE_MANIFEST_SHA256='b103319a10cf73a8e0b78a306f7c14240ad0c9a0c2359ad89fe3f30046773f71';
export const CRM_RETURN_REPLACEMENT=Object.freeze([
 '<div class="brand">a<span>u</span></div>',
 '<a class="brand" href="/dashboard" target="_top" title="Voltar ao CRM" aria-label="Voltar ao CRM" style="color:inherit;text-decoration:none">a<span>u</span></a>',
]);
const canonicalFiles={
 'replica-calls.js':'replica-calls-proximity.js',
 'spatial-publisher-core.js':'spatial-publisher-core.js',
 'spatial-scene-core.js':'spatial-scene-core.js',
 'replica-spatial-scene.js':'replica-spatial-scene.js',
};
export async function buildReadyRelease(base,destination){
 base=path.resolve(base);destination=path.resolve(destination);
 if(destination===base||destination.startsWith(base+path.sep))throw Error('Frozen input cannot be changed');
 const raw=await fs.readFile(path.join(base,'manifest.json'));if(hash(raw)!==READY_BASE_MANIFEST_SHA256)throw Error('Published v21 manifest mismatch');
 const old=JSON.parse(raw),records=new Map(old.files.map(record=>[record.path,record]));
 async function checked(name){const record=records.get(name),bytes=await fs.readFile(path.join(base,name));if(!record||bytes.length!==record.bytes||hash(bytes)!==record.sha256)throw Error('Frozen file changed: '+name);return bytes;}
 const overrides=new Map();
 for(const [output,source]of Object.entries(canonicalFiles)){if(!records.has(output))throw Error('Unlisted runtime output');const bytes=await fs.readFile(new URL('./runtime/'+source,import.meta.url));new Script(bytes.toString('utf8'));overrides.set(output,bytes);}
 const app=Buffer.from(remoteMotionPatch((await checked('app.js')).toString('utf8')));new Script(app.toString('utf8'));overrides.set('app.js',app);
 let index=(await checked('index.html')).toString('utf8');
 if(index.split(CRM_RETURN_REPLACEMENT[0]).length!==2)throw Error('CRM return anchor mismatch');index=index.replace(...CRM_RETURN_REPLACEMENT);
 const bundledStart='aureonOfficeCrmRuntime.start(["/api/office/runtime/office-scripts-bundle.js"]);';
 if(index.split(bundledStart).length!==2)throw Error('Bundle anchor mismatch');
 index=index.replace(bundledStart,'aureonOfficeCrmRuntime.start('+JSON.stringify(old.scriptBundle.inputs.map(input=>'/api/office/runtime/'+input.path))+');');
 const scripts=[];
 for(const input of old.scriptBundle.inputs){const bytes=overrides.get(input.path)||await checked(input.path);scripts.push({...input,text:bytes.toString('utf8'),bytes:bytes.length,sha256:hash(bytes)});}
 const bundle=buildOfficeScriptBundle({index,scripts,allowedPaths:new Set(records.keys())});new Script(bundle.text);
 overrides.set('office-scripts-bundle.js',Buffer.from(bundle.text));overrides.set('index.html',Buffer.from(bundle.index));
 const next=structuredClone(old);next.destination=destination;next.generatedAt=new Date().toISOString();next.scriptBundle=bundle.metadata;
 next.readyRelease217={baseManifestSha256:hash(raw),crmReturnLink:true,remotePoseAndMotion:true,iceRestartBackoff:true,iceOfferRetry:true,assetsChanged:0,humanMultiComputerTestPending:true};
 for(const record of next.files){const bytes=overrides.get(record.path);if(!bytes)continue;record.bytes=bytes.length;record.sha256=hash(bytes);if(record.path==='office-scripts-bundle.js')Object.assign(record,bundle.record);else(record.adapterRules??=[]).push({rule:'office-ready-217',occurrences:1});}
 next.outputBytes=next.files.reduce((sum,record)=>sum+record.bytes,0);
 await fs.mkdir(destination,{recursive:false});
 for(const record of next.files){const bytes=overrides.get(record.path)||await checked(record.path);await fs.mkdir(path.dirname(path.join(destination,record.path)),{recursive:true});await fs.writeFile(path.join(destination,record.path),bytes,{flag:'wx'});}
 const manifest=Buffer.from(JSON.stringify(next,null,2)+'\n');await fs.writeFile(path.join(destination,'manifest.json'),manifest,{flag:'wx'});
 return {manifestSha256:hash(manifest),fileCount:next.fileCount,payloadBytes:next.outputBytes,changed:next.files.filter(record=>record.sha256!==records.get(record.path).sha256).map(({path,sha256,bytes})=>({path,sha256,bytes}))};
}
if(process.argv[2])console.log(JSON.stringify(await buildReadyRelease(process.argv[2],process.argv[3]),null,2));
