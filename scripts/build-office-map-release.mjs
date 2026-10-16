import fs from 'node:fs/promises';
import {join,resolve,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {Script} from 'node:vm';
import {adaptOfficeMapViewport} from './office-map-viewport-patch.mjs';
import {createOfficeCrmRuntime} from './office-crm-bootstrap.mjs';
import {buildOfficeScriptBundle} from './office-script-bundle.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=(ok,message)=>{if(!ok)throw Error(message);};
const BASE_PIN='7bf3e163a9cb9aa0756cea29067a6297b9058078b2af51f110676ca2f0dc1e96';
export async function buildOfficeMapRelease(basePath,destination){
 const base=resolve(basePath),dest=resolve(destination),rel=relative(base,dest);need(rel!==''&&(isAbsolute(rel)||rel==='..'||rel.startsWith('..\\')||rel.startsWith('../')),'Destination must be outside the frozen base');
 const raw=await fs.readFile(join(base,'manifest.json'));need(sha(raw)===BASE_PIN,'Frozen v15 manifest mismatch');
 const manifest=JSON.parse(raw),records=new Map(manifest.files.map(row=>[row.path,row]));
 need(records.size===8495&&manifest.fileCount===8495&&manifest.scriptBundle.inputs.length===62,'Frozen runtime shape mismatch');
 async function read(name){need(records.has(name)&&/^[a-zA-Z0-9_./-]+$/.test(name)&&!name.split('/').includes('..'),'Unreviewed path');const row=records.get(name),path=join(base,name),stat=await fs.lstat(path);need(stat.isFile()&&!stat.isSymbolicLink(),'Nonregular input');const bytes=await fs.readFile(path);need(bytes.length===row.bytes&&sha(bytes)===row.sha256,'Input mismatch: '+name);return bytes;}
 const patch=adaptOfficeMapViewport((await read('app.js')).toString('utf8'));
 const priorIndex=(await read('index.html')).toString('utf8');
 const factoryMarker='const aureonOfficeCrmRuntime=(',start=priorIndex.indexOf(factoryMarker)+factoryMarker.length,end=priorIndex.indexOf(')({window,document,fetch:',start);
 need(start>=factoryMarker.length&&end>start&&priorIndex.split(factoryMarker).length===2,'Factory boundary mismatch');
 const factory=priorIndex.slice(start,end),expected=factory.replace("   ready=true;show('ready','');post('aureon-office-ready');return true;","   ready=true;show('ready','');\n   win.aureonMapNavigation?.refreshViewport?.();\n   post('aureon-office-ready');return true;");
 need(expected!==factory&&expected===createOfficeCrmRuntime.toString(),'Bootstrap delta exceeds visible map refresh');
 let index=priorIndex.slice(0,start)+expected+priorIndex.slice(end);
 const oldStart='aureonOfficeCrmRuntime.start(["/api/office/runtime/office-scripts-bundle.js"]);';
 need(index.split(oldStart).length===2,'Bundled start mismatch');
 index=index.replace(oldStart,'aureonOfficeCrmRuntime.start('+JSON.stringify(manifest.scriptBundle.inputs.map(x=>'/api/office/runtime/'+x.path))+');');
 const scripts=[];
 for(const input of manifest.scriptBundle.inputs){const record=records.get(input.path),text=input.path==='app.js'?patch.text:(await read(input.path)).toString('utf8');need(record.sourceSha256===input.sourceSha256&&record.sha256===input.sha256,'Input graph mismatch');scripts.push({...input,text,bytes:Buffer.byteLength(text),sha256:sha(text)});}
 const bundle=buildOfficeScriptBundle({index,scripts,allowedPaths:new Set(records.keys())});
 const overrides=new Map([['app.js',Buffer.from(patch.text)],['index.html',Buffer.from(bundle.index)],['office-scripts-bundle.js',Buffer.from(bundle.text)]]);
 for(const [,bytes]of overrides)new Script(bytes.toString('utf8').startsWith('<!')?'':bytes.toString('utf8'));
 const next=structuredClone(manifest);next.destination=dest;next.generatedAt=new Date().toISOString();next.scriptBundle=bundle.metadata;
 next.viewportRelease212={baseManifestSha256:BASE_PIN,changes:patch.changes,bootstrap:'refresh positive map dimensions after reveal',excludedLocalCamera209:true};
 for(const record of next.files){const bytes=overrides.get(record.path);if(bytes){record.bytes=bytes.length;record.sha256=sha(bytes);if(record.path==='office-scripts-bundle.js')Object.assign(record,bundle.record,{sha256:sha(bytes)});else record.adapterRules.push(...(record.path==='app.js'?patch.changes:[{rule:'map-refresh-after-bootstrap-reveal',occurrences:1}]));} }
 for(const row of next.adaptedFiles){const record=next.files.find(file=>file.path===row.path);if(overrides.has(row.path))row.rules=record.adapterRules;}
 next.outputBytes=next.files.reduce((sum,row)=>sum+row.bytes,0);
 await fs.mkdir(dest,{recursive:false});
 for(const record of next.files){const bytes=overrides.get(record.path)||await read(record.path);need(bytes.length===record.bytes&&sha(bytes)===record.sha256,'Target mismatch');await fs.mkdir(dirname(join(dest,record.path)),{recursive:true});await fs.writeFile(join(dest,record.path),bytes,{flag:'wx'});}
 const targetRaw=Buffer.from(JSON.stringify(next,null,2)+'\n');await fs.writeFile(join(dest,'manifest.json'),targetRaw,{flag:'wx'});
 const changed=next.files.filter(row=>row.sha256!==records.get(row.path).sha256).map(row=>({path:row.path,bytes:row.bytes,sha256:row.sha256}));need(changed.length===3,'Unexpected payload delta');
 return{stage:212,classification:'C_FULL_HASHED_OFFLINE_PACKAGE',baseManifestSha256:BASE_PIN,manifestSha256:sha(targetRaw),fileCount:8495,unchangedFiles:8492,changed,payloadBytes:next.outputBytes,excludedCamera209:true,destination:dest,productionApplied:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const [base,dest]=process.argv.slice(2);if(!base||!dest)throw Error('Use: node scripts/build-office-map-release.mjs BASE DEST');const report=await buildOfficeMapRelease(base,dest);console.log(JSON.stringify(report,null,2));}
