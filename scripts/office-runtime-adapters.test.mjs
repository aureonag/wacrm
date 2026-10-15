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
test('unmodified modules and relative asset paths stay byte-identical; inventory covers ten reviewed files',()=>{
 const source="const image='assets/bambu-vaso-preto-v1/frente.png';const cache='aurion-office-v1';";
 assert.deepEqual(adaptOfficeRuntime('app.js',source),{text:source,changed:false,changes:[]});
 assert.equal(new Set(OFFICE_RUNTIME_ADAPTERS.map(x=>x.file)).size,10);
 assert.ok(OFFICE_RUNTIME_ADAPTERS.every(x=>x.guards.length&&x.changes.length));
});

// Byte-exact reviewed replica-library.js source; DOM effects below run only in a fixture.
const LIBRARY_SOURCE_FIXTURE=String.raw`/* Gather catalog collected through the rendered UI; approved native furniture stays available. */
(()=>{'use strict';const data=window.aureonGatherLibraryData,panel=document.getElementById('inspector'),catalog=document.getElementById('catalog'),search=document.querySelector('input[aria-label="Buscar objetos"]'),select=document.querySelector('select[aria-label="Categoria dos móveis"]');if(!data||!panel||!catalog||!search||!select)return;
const models=new Map(data.items.map(x=>[x.key,x]));const nativeTiles=[...catalog.querySelectorAll('button')].filter(b=>!models.has(b.dataset.type));for(const b of catalog.querySelectorAll('button'))if(models.has(b.dataset.type))b.remove();
const mountArt=(host,m,w,h,x=0,y=0)=>{const frame=m.improved&&m.improvedFrame;const svg=frame?document.createElementNS(NS,'svg'):null;const image=document.createElementNS(NS,'image');if(svg){const original=m.originalVisibleFrame||{x:0,y:0,width:m.width,height:m.height};for(const[k,v]of Object.entries({x:x+w*original.x/m.width,y:y+h*original.y/m.height,width:w*original.width/m.width,height:h*original.height/m.height,viewBox:[frame.x,frame.y,frame.width,frame.height].join(' '),'preserveAspectRatio':'none','aria-hidden':'true'}))svg.setAttribute(k,v);host.append(svg);}for(const[k,v]of Object.entries({href:m.improved||m.original,x:svg?0:x,y:svg?0:y,width:svg?frame.imageWidth:w,height:svg?frame.imageHeight:h,'data-gather-asset':m.id,'preserveAspectRatio':'xMidYMid meet',style:'image-rendering:'+(m.improved?'auto':'pixelated')}))image.setAttribute(k,v);(svg||host).append(image);return image;};
const thumbnail=(m,size=84)=>{if(!m.improvedFrame){const img=document.createElement('img');img.src=m.improved||m.original;img.loading='lazy';img.decoding='async';img.alt='';if(m.improved)img.style.imageRendering='auto';return img;}const svg=document.createElementNS(NS,'svg');svg.setAttribute('viewBox','0 0 '+size+' '+size);svg.setAttribute('aria-hidden','true');svg.classList.add('r-library-thumbnail');const scale=size/Math.max(m.width,m.height),w=m.width*scale,h=m.height*scale;mountArt(svg,m,w,h,(size-w)/2,(size-h)/2);return svg;};window.aureonGatherCatalogThumbnail=thumbnail;
const oriented=(m,o)=>{const view=m.orientations?.[o?.direction||0]?{...m,...m.orientations[o?.direction||0]}:m;const def=o&&window.aureonSmartObjects?.definition(o.type);const sprite=def&&window.aureonSmartObjectArt?.sprite?.(def.preset,window.aureonSmartObjects.read(o));return sprite?{...view,...sprite}:view;};
const loadedViews=new Map();const preloadViews=m=>{if(!m.orientations||loadedViews.has(m.id))return;loadedViews.set(m.id,Object.values(m.orientations).map(view=>{const image=new Image();image.decoding='async';image.src=view.improved||view.original;return image;}));};
const shape=objectShape;objectShape=function(g,key,options){const model=models.get(key);if(!model)return shape(g,key,options);preloadViews(model);const view=oriented(model,options?.object),w=view.width*2,h=view.height*2,y=model.orientations?model.height-h:-h/2;const image=mountArt(g,view,w,h,-w/2,y);image.setAttribute('data-direction',String(options?.object?.direction||0));const hit=document.createElementNS(NS,'rect');for(const[k,v]of Object.entries({x:-w/2,y,width:w,height:h,fill:'transparent','pointer-events':'all','data-gather-hit':key}))hit.setAttribute(k,v);g.append(hit);};
const collision=officeFurnitureCollisionBox;officeFurnitureCollisionBox=function(o){const m=models.get(o.type);if(!m)return collision(o);if(m.behavior==='decoration')return null;const view=oriented(m,o);return [view.width,view.height/2,view.height];};
const previousRender=render;render=function(){for(const o of objects){const m=models.get(o.type);if(m)o.label=m.label;}document.getElementById('office').classList.toggle('r-library-editing',!!editing);previousRender();};
const nativeBar=panel.querySelector('.r-decor-category-bar'),gatherBar=document.createElement('div');gatherBar.className='r-decor-category-bar r-gather-categories';gatherBar.setAttribute('role','toolbar');gatherBar.setAttribute('aria-label','Categorias Gather');const switcher=document.createElement('div');switcher.className='r-library-switch';switcher.setAttribute('role','group');switcher.setAttribute('aria-label','Biblioteca de móveis');let activeLibrary='gather',activeCategory=0;const gatherTabs=[];const sourceButtons=[];
const filter=()=>{const q=search.value.trim().toLocaleLowerCase('pt-BR');for(const b of nativeTiles)b.hidden=activeLibrary!=='aureon'||!(select.value==='Todos'||select.value===b.dataset.category)||!b.textContent.toLocaleLowerCase('pt-BR').includes(q);for(const b of catalog.querySelectorAll('[data-gather-library]'))b.hidden=activeLibrary!=='gather'||(!q&&Number(b.dataset.gatherCategory)!==activeCategory)||!b.textContent.toLocaleLowerCase('pt-BR').includes(q);for(const b of gatherTabs){b.disabled=!!q;b.setAttribute('aria-pressed',String(Number(b.dataset.gatherCategory)===activeCategory));}nativeBar.hidden=activeLibrary!=='aureon';gatherBar.hidden=activeLibrary!=='gather';for(const b of sourceButtons)b.setAttribute('aria-pressed',String(b.dataset.library===activeLibrary));};
for(const [key,label]of [['gather','Gather'],['aureon','Aureon']]){const b=document.createElement('button');b.type='button';b.dataset.library=key;b.textContent=label;b.onclick=()=>{activeLibrary=key;search.value='';filter();catalog.scrollTop=0;};sourceButtons.push(b);switcher.append(b);}
for(const c of data.categories){const b=document.createElement('button');b.type='button';b.dataset.gatherCategory=c.id;b.title=c.label;b.setAttribute('aria-label','Categoria Gather '+c.label);b.innerHTML=c.iconSvg.replace(/color="var\([^"]+\)"/g,'');b.onclick=()=>{activeCategory=c.id;catalog.scrollTop=0;filter();};gatherTabs.push(b);gatherBar.append(b);}
for(const m of data.items){const b=document.createElement('button');b.className='furniture-tile';b.dataset.type=m.key;b.dataset.gatherLibrary='true';b.dataset.gatherCategory=m.category;b.dataset.category=data.categories.find(c=>c.id===m.category).label;b.setAttribute('aria-label','Adicionar '+m.label);b.title=m.label;const span=document.createElement('span');span.textContent=m.label;b.append(thumbnail(m),span);b.onclick=()=>{placing=m.key;catalog.querySelectorAll('button').forEach(x=>x.classList.toggle('selected',x===b));document.getElementById('mapHelp').textContent='Clique no piso para colocar: '+m.label;};catalog.append(b);}
nativeBar.before(switcher,gatherBar);search.oninput=filter;select.addEventListener('change',filter);filter();render();})();
`;

class CatalogElement {
 constructor(tag,stats){this.tagName=tag.toUpperCase();this.stats=stats;this.children=[];this.dataset={};this.attributes={};this.style={};this.hidden=false;this.value='';this._text='';this.classList={add(){},toggle(){}};}
 append(...children){for(const child of children){child.parentNode=this;this.children.push(child);}}
 before(){}
 remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);}
 setAttribute(name,value){this.attributes[name]=String(value);if(name==='href')this.stats.hrefAssignments.push(String(value));}
 addEventListener(){}
 get textContent(){return this._text+this.children.map(child=>child.textContent||'').join('');}
 set textContent(value){this._text=String(value);this.children=[];}
 set src(value){this.attributes.src=String(value);this.stats.imgAssignments.push(String(value));}
 querySelectorAll(selector){const matches=node=>selector==='button'?node.tagName==='BUTTON':selector==='image'?node.tagName==='IMAGE':selector==='img'?node.tagName==='IMG':selector==='[data-gather-library]'?Object.hasOwn(node.dataset,'gatherLibrary'):false;const result=[];const visit=node=>{for(const child of node.children){if(matches(child))result.push(child);visit(child);}};visit(this);return result;}
}
function catalogContext(pilot){
 const stats={hrefAssignments:[],imgAssignments:[],renderCalls:0,nativeShapes:0},make=tag=>new CatalogElement(tag,stats);
 const panel=make('aside'),catalog=make('div'),search=make('input'),select=make('select'),office=make('svg'),nativeBar=make('nav');select.value='Todos';
 const nativeTile=make('button');nativeTile.dataset.type='native-desk';nativeTile.dataset.category='Mesas';nativeTile.textContent='Native desk';catalog.append(nativeTile);
 panel.querySelector=selector=>selector==='.r-decor-category-bar'?nativeBar:null;
 const items=Array.from({length:740},(_,i)=>({id:'model-'+i,key:'gather-model-'+i,label:'Model '+i,category:0,width:32,height:24,improved:BASE+'assets/catalog/model-'+i+'.png',original:BASE+'assets/catalog/original-'+i+'.png',...(i<735?{improvedFrame:{x:0,y:0,width:32,height:24,imageWidth:32,imageHeight:24}}:{})}));
 const window={aureonGatherLibraryData:{items,categories:[{id:0,label:'Mesas',iconSvg:'<svg></svg>'}]},...(pilot===undefined?{}:{aureonOfficeBootstrap:{mapReadOnly:pilot}})};
 const document={getElementById:id=>({inspector:panel,catalog,office})[id],querySelector:selector=>selector==='input[aria-label="Buscar objetos"]'?search:selector==='select[aria-label="Categoria dos móveis"]'?select:null,createElement:make,createElementNS:(_ns,tag)=>make(tag)};
 const objects=[{id:11,type:items[0].key,x:224,y:400,label:items[0].label},{id:12,type:'native-desk',x:500,y:520,label:'Native desk'}];
 const originalObjects=JSON.stringify(objects),context=vm.createContext({window,document,objects,editing:false,placing:null,NS:'http://www.w3.org/2000/svg',Image:class{constructor(){throw Error('Unexpected orientation preload in this fixture');}},officeFurnitureCollisionBox:()=>[9,8,7],objectShape:()=>{stats.nativeShapes++;}});
 context.render=()=>{stats.renderCalls++;office.children=[];for(const object of objects){const group=make('g');office.append(group);context.objectShape(group,object.type,{object});}};
 new vm.Script(adaptOfficeRuntime('replica-library.js',LIBRARY_SOURCE_FIXTURE).text).runInContext(context,{timeout:1000});
 return {stats,context,office,catalog,objects,originalObjects,nativeTile};
}
test('read-only CRM pilot creates none of 735 SVG thumbnails or 740 catalog tiles, while map shapes still render',()=>{
 const result=catalogContext(true);
 assert.equal(result.catalog.querySelectorAll('[data-gather-library]').length,0);
 assert.equal(result.catalog.querySelectorAll('image').length,0);
 assert.equal(result.catalog.querySelectorAll('img').length,0);
 assert.equal(result.stats.imgAssignments.length,0);
 assert.deepEqual(result.stats.hrefAssignments,[BASE+'assets/catalog/model-0.png']);
 assert.equal(result.stats.renderCalls,1);assert.equal(result.stats.nativeShapes,1);
 assert.equal(result.office.querySelectorAll('image').length,1);
 assert.equal(JSON.stringify(result.objects),result.originalObjects);
 assert.equal(typeof result.context.window.aureonGatherCatalogThumbnail,'function');
 assert.ok(result.catalog.children.includes(result.nativeTile));
 const fallback=result.context.officeFurnitureCollisionBox({type:'native-desk'});assert.deepEqual(fallback,[9,8,7]);
});
test('catalog behavior without CRM or with readOnly false remains unchanged, including 735 SVG and five lazy image thumbnails',()=>{
 for(const pilot of [undefined,false]){
  const result=catalogContext(pilot);
  assert.equal(result.catalog.querySelectorAll('[data-gather-library]').length,740);
  assert.equal(result.catalog.querySelectorAll('image').length,735);
  assert.equal(result.catalog.querySelectorAll('img').length,5);
  assert.equal(result.stats.imgAssignments.length,5);
  assert.equal(result.stats.hrefAssignments.length,736); // Catalog735 plus the imported map object1.
  assert.equal(result.stats.renderCalls,1);assert.equal(result.stats.nativeShapes,1);
  assert.equal(JSON.stringify(result.objects),result.originalObjects);
 }
});
test('read-only catalog adapter rejects missing, duplicate and already-adapted render/catalog boundaries',()=>{
 const source=LIBRARY_SOURCE_FIXTURE,once=adaptOfficeRuntime('replica-library.js',source);
 assert.equal(once.changed,true);assert.deepEqual(once.changes,[{rule:'pilot-readonly-catalog-no-thumbnails',occurrences:1}]);
 assert.throws(()=>adaptOfficeRuntime('replica-library.js',source.replace('const previousRender=render;','const previousRender=changedRender;')),/content guard/);
 assert.throws(()=>adaptOfficeRuntime('replica-library.js',source+source),/content guard/);
 assert.throws(()=>adaptOfficeRuntime('replica-library.js',once.text),/content guard/);
});
