import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Script} from 'node:vm';
import {remoteAvatarCompositor} from './office-remote-avatar-patch.mjs';
import {buildOfficeScriptBundle} from './office-script-bundle.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function buildPresenceRelease(base,dest){
 base=path.resolve(base);dest=path.resolve(dest);if(dest===base||dest.startsWith(base+path.sep))throw Error('Frozen input cannot be changed');
 const raw=await fs.readFile(path.join(base,'manifest.json'));if(hash(raw)!=='30d47d3a8e8860ba60d73edf3ff7834ada7dca050a313591f62c3e3ec1c608fc')throw Error('v16 manifest mismatch');const old=JSON.parse(raw),records=new Map(old.files.map(f=>[f.path,f]));
 async function checked(name){const r=records.get(name);if(!r)throw Error('Unknown runtime path');const b=await fs.readFile(path.join(base,name));if(hash(b)!==r.sha256||b.length!==r.bytes)throw Error('Changed frozen file '+name);return b;}
 const overrides=new Map([['app.js',Buffer.from(remoteAvatarCompositor((await checked('app.js')).toString('utf8')))]]);
 for(const name of ['replica-spatial-scene.js','spatial-scene-core.js','spatial-publisher-core.js','replica-spatial-presence.js']){const b=await fs.readFile(new URL('./runtime/'+name,import.meta.url));new Script(b.toString('utf8'));overrides.set(name,b);}
 let index=(await checked('index.html')).toString('utf8');const start='aureonOfficeCrmRuntime.start(["/api/office/runtime/office-scripts-bundle.js"]);';if(index.split(start).length!==2)throw Error('Bundle start mismatch');index=index.replace(start,'aureonOfficeCrmRuntime.start('+JSON.stringify(old.scriptBundle.inputs.map(x=>'/api/office/runtime/'+x.path))+');');
 const scripts=[];for(const input of old.scriptBundle.inputs){const b=overrides.get(input.path)||await checked(input.path);scripts.push({...input,text:b.toString('utf8'),bytes:b.length,sha256:hash(b)});}const bundle=buildOfficeScriptBundle({index,scripts,allowedPaths:new Set(records.keys())});overrides.set('index.html',Buffer.from(bundle.index));overrides.set('office-scripts-bundle.js',Buffer.from(bundle.text));new Script(bundle.text);
 const next=structuredClone(old);next.destination=dest;next.generatedAt=new Date().toISOString();next.scriptBundle=bundle.metadata;next.presenceRelease213={baseManifestSha256:hash(raw),remoteBodies:true,awayUsersVisible:true,approvedLocalAppearancePreserved:true};
 for(const row of next.files){const b=overrides.get(row.path);if(b){row.bytes=b.length;row.sha256=hash(b);if(row.path==='office-scripts-bundle.js')Object.assign(row,bundle.record);else row.adapterRules=[...(row.adapterRules||[]),{rule:'remote-body-and-away-presence-213',occurrences:1}];}}
 next.outputBytes=next.files.reduce((sum,row)=>sum+row.bytes,0);await fs.mkdir(dest,{recursive:false});
 for(const row of next.files){const b=overrides.get(row.path)||await checked(row.path);await fs.mkdir(path.dirname(path.join(dest,row.path)),{recursive:true});await fs.writeFile(path.join(dest,row.path),b,{flag:'wx'});}
 const nextRaw=Buffer.from(JSON.stringify(next,null,2)+'\n');await fs.writeFile(path.join(dest,'manifest.json'),nextRaw,{flag:'wx'});return {manifestSha256:hash(nextRaw),fileCount:next.fileCount,payloadBytes:next.outputBytes,changed:next.files.filter(f=>f.sha256!==records.get(f.path).sha256).map(f=>({path:f.path,sha256:f.sha256,bytes:f.bytes}))};
}
if(process.argv[2])console.log(JSON.stringify(await buildPresenceRelease(process.argv[2],process.argv[3]),null,2));
