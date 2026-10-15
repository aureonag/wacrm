import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {adaptOfficeRuntime,officeRuntimeFileUrl,officeRuntimePortraitUrl,OFFICE_RUNTIME_ADAPTERS} from './office-runtime-adapters.mjs';

const UUID='11111111-2222-4333-8444-555555555555';
const BASE='/api/office/runtime/';
function run(source,extra={}){
 const context=vm.createContext({...extra});
 new vm.Script(source).runInContext(context,{timeout:1000});
 return context;
}
test('interface and smart-object requests use scoped API URLs while bootstrap bytes stay intact',()=>{
 const bootstrap='function bootstrap(){return "UNCHANGED_IDENTITY_IMPLEMENTATION";}';
 const source="'use strict';"+bootstrap+"function request(endpoint){const url='/api/interface/'+endpoint;return fetch(url);}const card='/assets/gather/';globalThis.call=request;globalThis.card=card;";
 const result=adaptOfficeRuntime('replica-ui.js',source);
 assert.ok(result.text.includes(bootstrap));
 const urls=[],context=run(result.text,{fetch:url=>urls.push(url)});
 context.call('bootstrap');assert.deepEqual(urls,['/api/office/interface/bootstrap']);
 assert.equal(context.card,BASE+'assets/gather/');
 const smart="globalThis.send=action=>fetch('/api/smart-objects/'+action);globalThis.event=id=>location.origin+'/api/smart-objects/events/'+id;";
 const output=run(adaptOfficeRuntime('replica-smart-objects.js',smart).text,{fetch:url=>url,location:{origin:'https://aureonag.com'}});
 assert.equal(output.send('state'),'/api/office/smart-objects/state');
 assert.equal(output.event('object-id'),'https://aureonag.com/api/office/smart-objects/events/object-id');
});
test('model/orientation metadata is preserved while only original/improved paths change',()=>{
 const input={label:'Approved chair',frame:{x:38,y:80,width:964,height:1382},items:[{original:'/assets/gather/catalog/originals/chair.png',improved:'/assets/gather/catalog/improved/chair-v2.png',source:'https://static.gather.town/image.png',previousCandidate:'/assets/gather/catalog/improved/old-rejected.png',orientations:{1:{original:'/assets/gather/catalog/originals/back.png'}}}],evidence:'audit/report.md'};
 const source='window.aureonGatherLibraryData='+JSON.stringify(input)+';';
 const result=adaptOfficeRuntime('gather-library-data.js',source);
 const context=run(result.text,{window:{}});
 const output=JSON.parse(JSON.stringify(context.window.aureonGatherLibraryData));
 const expected=structuredClone(input);
 expected.items[0].original=BASE+'assets/gather/catalog/originals/chair.png';
 expected.items[0].improved=BASE+'assets/gather/catalog/improved/chair-v2.png';
 expected.items[0].orientations[1].original=BASE+'assets/gather/catalog/originals/back.png';
 assert.deepEqual(output,expected);
 assert.equal(result.changes[0].occurrences,3);
 assert.equal(result.preservedMetadataPaths.length,1);
 assert.equal(result.preservedMetadataPaths[0].field,"items[0].previousCandidate");
 assert.equal(source,'window.aureonGatherLibraryData='+JSON.stringify(input)+';');
 assert.deepEqual(adaptOfficeRuntime('gather-library-data.js',source),result);
});
test('native loaders resolve manifest, cached pieces and generated composition paths without global hooks',()=>{
 for(const file of ['gather-avatar-native-library.js','gather-avatar-native-scene.js']){
  const assignment=file==='gather-avatar-native-library.js'?"img.src='/'+path;":"img.src='/'+file.path;";
  const args=file==='gather-avatar-native-library.js'?'path':'file';
  const source="(()=>{'use strict';const manifest=fetch('/assets/gather/avatar/native-library-manifest.json');globalThis.load=function("+args+"){const img={};"+assignment+"return img.src;};})();";
  const result=adaptOfficeRuntime(file,source),requests=[];
  const context=run(result.text,{fetch:url=>requests.push(url)});
  const invoke=path=>file==='gather-avatar-native-library.js'?context.load(path):context.load({path});
  assert.deepEqual(requests,[BASE+'assets/gather/avatar/native-library-manifest.json']);
  assert.equal(invoke('assets/gather/avatar/native-library/piece-essentials.png'),BASE+'assets/gather/avatar/native-library/piece-essentials.png');
  assert.equal(invoke('api/avatar-composition/extras/'+UUID+'.png'),'/api/office/avatar-composition/extras/'+UUID+'.png');
  assert.equal(context.officeRuntimeFileUrl,undefined);
  assert.equal(context.Image,undefined);
  assert.throws(()=>invoke('../.env'),/inválido/);
 }
});
test('native URL resolver rejects traversal, encoded paths, external origins and unreviewed endpoints',()=>{
 assert.equal(officeRuntimeFileUrl('/assets/gather/avatar/catalog/model.png'),BASE+'assets/gather/avatar/catalog/model.png');
 assert.equal(officeRuntimeFileUrl('api/avatar-composition/essentials/'+UUID+'.'+UUID+'.png'),'/api/office/avatar-composition/essentials/'+UUID+'.'+UUID+'.png');
 for(const path of ['assets/../secret.png','assets/.hidden/secret.png','assets/%2e%2e/secret.png','//evil.invalid/p.png','https://evil.invalid/a.png','api/interface/profile','api/avatar-composition/extras/not-a-recipe.png','assets/p.svg','assets/p.png?key=secret','assets/p.png#fragment'])
  assert.throws(()=>officeRuntimeFileUrl(path),/inválido/);
});
test('copied portrait validator accepts only same-origin runtime PNGs',()=>{
 const source="(()=>{'use strict';globalThis.validate=(href,win)=>{const url=new win.URL(href,win.location.href);if(url.origin!==win.location.origin||!url.pathname.startsWith('/assets/'))throw Error('Imagem de retrato inválida.');return url.href;};})();";
 const output=run(adaptOfficeRuntime('replica-avatar-sync.js',source).text);
 const location={origin:'https://aureonag.com',href:'https://aureonag.com/api/office/runtime/'},win={URL,location};
 const valid='https://aureonag.com'+BASE+'assets/gather/avatar/catalog/model.png';
 assert.equal(output.validate(valid,win),valid);
 assert.equal(officeRuntimePortraitUrl(new URL(valid),location),true);
 for(const href of ['https://evil.invalid'+BASE+'assets/model.png','/assets/model.png','/api/office/interface/model.png',BASE+'assets/model.svg',BASE+'assets/model.png?token=x',BASE+'assets/model.png#x',BASE+'assets/%2fprivate.png',BASE+'assets/../private.png']){
  assert.equal(officeRuntimePortraitUrl(new URL(href,location.href),location),false);
  assert.throws(()=>output.validate(href,win),/inválida/);
 }
 assert.equal(output.officeRuntimePortraitUrl,undefined);
});
test('avatar thumbnail, legacy decor and six smart-state images use the runtime prefix',()=>{
 const thumbnail="globalThis.art=item=>{const image={};image.src = '/' + item.path;return image.src;};";
 const context=run(adaptOfficeRuntime('gather-avatar-catalog.js',thumbnail).text);
 assert.equal(context.art({path:'assets/gather/avatar/catalog/model.png'}),BASE+'assets/gather/avatar/catalog/model.png');
 const decor="const asset='/assets/gather/catalog/e5fed724-ad75-48aa-9f5b-255ada0e2d59.png';";
 assert.ok(adaptOfficeRuntime('replica-decor.js',decor).text.includes(BASE+'assets/gather/catalog/'));
 const sprites='const sprites='+JSON.stringify(Array.from({length:6},(_,i)=>'/assets/gather/catalog/improved/state-'+i+'.png'))+';';
 const adapted=adaptOfficeRuntime('smart-object-art-core.js',sprites);
 assert.equal(adapted.changes[0].occurrences,6);
 assert.equal((adapted.text.match(/api\/office\/runtime\/assets/g)||[]).length,6);
});
test('content drift and duplicate adaptation fail closed instead of silently missing paths',()=>{
 const ui="const base='/api/interface/';const cards='/assets/gather/';";
 assert.throws(()=>adaptOfficeRuntime('replica-ui.js',ui.replace('/api/interface/','/api/interface-v2/')),/content guard/);
 assert.throws(()=>adaptOfficeRuntime('replica-ui.js',ui+ui),/content guard/);
 const once=adaptOfficeRuntime('replica-ui.js',ui).text;
 assert.throws(()=>adaptOfficeRuntime('replica-ui.js',once),/content guard/);
 assert.throws(()=>adaptOfficeRuntime('new-module.js',"fetch('/assets/new.png')"),/unadapted/);
 assert.throws(()=>adaptOfficeRuntime('new-module.js',"fetch('/api/unreviewed/')"),/unadapted/);
 assert.throws(()=>adaptOfficeRuntime('gather-library-data.js','window.aureonGatherLibraryData={"items":[{"improved":"/assets/a.png","unknown":"/assets/b.png"}]};'),/unreviewed root asset field/);
 assert.throws(()=>adaptOfficeRuntime('gather-library-data.js','window.aureonGatherLibraryData={};danger();'),/invalid JSON/);
 assert.throws(()=>adaptOfficeRuntime('gather-library-data.js','window.aureonGatherLibraryData={"items":[{"improved":"/assets/../secret.png"}]};'),/unsafe asset/);
});
test('unmodified modules and relative asset paths stay byte-identical; inventory covers nine reviewed files',()=>{
 const source="const image='assets/bambu-vaso-preto-v1/frente.png';const cache='aurion-office-v1';";
 assert.deepEqual(adaptOfficeRuntime('app.js',source),{text:source,changed:false,changes:[]});
 assert.equal(new Set(OFFICE_RUNTIME_ADAPTERS.map(x=>x.file)).size,9);
 assert.ok(OFFICE_RUNTIME_ADAPTERS.every(x=>x.guards.length&&x.changes.length));
});
