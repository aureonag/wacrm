/**
 * Copy-time URL adapters. Never evaluate the source app or intercept fetch/Image.
 * Content guards fail on missing/duplicate anchors and unhandled legacy paths.
 * These rewrites do not enable CRM identity, APIs or the approved map seed.
 */
export const OFFICE_RUNTIME_BASE='/api/office/runtime/';
export const OFFICE_INTERFACE_BASE='/api/office/interface/';
export const OFFICE_AVATAR_BASE='/api/office/avatar-composition/';
export const OFFICE_SMART_OBJECT_BASE='/api/office/smart-objects/';
export const ADAPTER_VERSION=1;
export const OFFICE_RUNTIME_ADAPTERS=Object.freeze([
 {file:'gather-library-data.js',guards:['JSON assignment','original/improved fields','at least one root asset'],changes:['Prefix image fields; preserve non-path data.']},
 {file:'smart-object-art-core.js',guards:['6 root asset literals'],changes:['Prefix six state sprites.']},
 {file:'replica-decor.js',guards:['1 exact image'],changes:['Prefix legacy computer image.']},
 {file:'replica-library.js',guards:['1 render/catalog boundary'],changes:['Skip catalog tile materialization only for the explicit read-only CRM pilot; keep map shapes/render.']},
 {file:'replica-ui.js',guards:['1 API base','1 UI image base'],changes:['Prefix URLs; leave bootstrap/identity untouched.']},
 {file:'gather-avatar-native-library.js',guards:['1 manifest fetch','1 image assignment','1 strict-mode scope'],changes:['Explicit native image/composition resolver.']},
 {file:'gather-avatar-native-scene.js',guards:['1 manifest fetch','1 image assignment','1 strict-mode scope'],changes:['Explicit native resolver; preserve compositor/cache/dimensions.']},
 {file:'gather-avatar-catalog.js',guards:['1 thumbnail assignment'],changes:['Prefix thumbnails; retain relative data paths.']},
 {file:'replica-avatar-sync.js',guards:['1 original same-origin validator','1 strict-mode scope'],changes:['Allow only runtime/assets same-origin PNGs; preserve SVG/data-PNG checks.']},
 {file:'replica-smart-objects.js',guards:['1 API base','1 event endpoint'],changes:['Prefix request/event URLs.']},
]);
function fail(file,reason){throw Error('Office adapter ['+file+']: '+reason);}
function replaceExact(file,text,before,after,expected=1){
 const found=text.split(before).length-1;
 if(found!==expected)fail(file,'content guard expected '+expected+' occurrence(s), found '+found+': '+before);
 return text.split(before).join(after);
}
function injectScoped(file,text,helper){return replaceExact(file,text,"'use strict';","'use strict';\n"+helper.toString()+'\n');}
/** Self-contained: inserted INSIDE each native loader, never as a global hook. */
export function officeRuntimeFileUrl(value){
 if(typeof value!=='string'||!value||/[%\\?#\s]/.test(value))throw Error('Caminho de imagem inválido.');
 const local=value.startsWith('/')?value.slice(1):value;
 if(local.split('/').some(part=>!part||part.startsWith('.')))throw Error('Caminho de imagem inválido.');
 if(/^assets\/[a-zA-Z0-9_./-]+\.png$/.test(local))return '/api/office/runtime/'+local;
 const match=/^api\/avatar-composition\/(essentials|extras)\/([0-9a-f.-]+)\.png$/.exec(local);
 if(match&&match[2].split('.').every(id=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)))
  return '/api/office/avatar-composition/'+match[1]+'/'+match[2]+'.png';
 throw Error('Caminho de imagem inválido.');
}
/** Self-contained: same-origin plus strict path/type checks, no /assets fallback. */
export function officeRuntimePortraitUrl(url,location){
 const prefix='/api/office/runtime/assets/';
 if(url.origin!==location.origin||url.search||url.hash||!url.pathname.startsWith(prefix))return false;
 const relative=url.pathname.slice(prefix.length);
 return /^[a-zA-Z0-9_./-]+\.png$/.test(relative)&&relative.split('/').every(part=>part&&!part.startsWith('.'));
}
function adaptLibraryData(file,text){
 const prefix='window.aureonGatherLibraryData=',trimmed=text.trim();
 if(!trimmed.startsWith(prefix)||!trimmed.endsWith(';'))fail(file,'unexpected JSON assignment');
 let data;try{data=JSON.parse(trimmed.slice(prefix.length,-1));}catch{fail(file,'invalid JSON assignment');}
 let changed=0;const preservedMetadataPaths=[];
 const knownHistory=field=>/^items\[\d+\]\.(?:generatedAlternative|previousCandidate|improvedPrevious)$/.test(field)||
  /^items\[\d+\]\.approvedOrientations\[\d+\]\.asset$/.test(field)||
  /^items\[\d+\]\.orientations\.\d+\.visualCorrection\.(?:selectedImage|previousSelectedV1\.path)$/.test(field);
 const visit=(value,parent='')=>{
  if(Array.isArray(value)){value.forEach((item,index)=>visit(item,parent+'['+index+']'));return;}
  if(!value||typeof value!=='object')return;
  for(const[key,item]of Object.entries(value)){
   const field=parent?parent+'.'+key:key;
   if(typeof item==='string'&&item.startsWith('/assets/')){
    if(!/^\/assets\/[a-zA-Z0-9_./-]+\.png$/.test(item)||item.split('/').some(part=>part==='.'||part==='..'))fail(file,'unsafe asset field');
    if(key==='original'||key==='improved'){value[key]=OFFICE_RUNTIME_BASE+item.slice(1);changed++;}
    else if(knownHistory(field))preservedMetadataPaths.push({field,path:item,reason:'Historical/provenance metadata; not consumed by the reviewed runtime. Preserved without adding rejected candidates to the package.'});
    else fail(file,'unreviewed root asset field: '+field);
   }else if(typeof item==='string'&&item.startsWith('/api/'))fail(file,'unreviewed API path in data: '+field);
   else if(item&&typeof item==='object')visit(item,field);
  }
 };
 visit(data);if(!changed)fail(file,'no root asset fields; review source or duplicate adaptation');
 return{text:prefix+JSON.stringify(data)+';\n',changed,preservedMetadataPaths};
}
/** Pure transformation: returns a new string; never writes original files. */
export function adaptOfficeRuntime(file,source){
 if(typeof source!=='string')fail(file,'text input required');
 let text=source;const changes=[];let preservedMetadataPaths=[];
 switch(file){
  case'gather-library-data.js':{const result=adaptLibraryData(file,text);text=result.text;preservedMetadataPaths=result.preservedMetadataPaths;changes.push({rule:'model-image-fields',occurrences:result.changed});break;}
  case'smart-object-art-core.js':
   text=replaceExact(file,text,'"/assets/','"'+OFFICE_RUNTIME_BASE+'assets/',6);changes.push({rule:'smart-state-sprites',occurrences:6});break;
  case'replica-decor.js':
   text=replaceExact(file,text,"'/assets/gather/catalog/e5fed724-ad75-48aa-9f5b-255ada0e2d59.png'","'"+OFFICE_RUNTIME_BASE+"assets/gather/catalog/e5fed724-ad75-48aa-9f5b-255ada0e2d59.png'");changes.push({rule:'legacy-computer-image',occurrences:1});break;
  case'replica-library.js':{
   const before="const previousRender=render;render=function(){for(const o of objects){const m=models.get(o.type);if(m)o.label=m.label;}document.getElementById('office').classList.toggle('r-library-editing',!!editing);previousRender();};\nconst nativeBar=panel.querySelector('.r-decor-category-bar'),gatherBar=document.createElement('div');";
   const after=before.replace('\nconst nativeBar=',"\nif(window.aureonOfficeBootstrap?.mapReadOnly===true){render();return;}\nconst nativeBar=");
   text=replaceExact(file,text,before,after);
   changes.push({rule:'pilot-readonly-catalog-no-thumbnails',occurrences:1});break;
  }
  case'replica-ui.js':
   text=replaceExact(file,text,"'/api/interface/'","'"+OFFICE_INTERFACE_BASE+"'");
   text=replaceExact(file,text,"'/assets/gather/'","'"+OFFICE_RUNTIME_BASE+"assets/gather/'");
   changes.push({rule:'interface-api-base',occurrences:1},{rule:'ui-card-assets',occurrences:1});break;
  case'gather-avatar-native-library.js':case'gather-avatar-native-scene.js':
   text=replaceExact(file,text,"fetch('/assets/gather/avatar/native-library-manifest.json')","fetch('"+OFFICE_RUNTIME_BASE+"assets/gather/avatar/native-library-manifest.json')");
   text=file==='gather-avatar-native-library.js'?replaceExact(file,text,"img.src='/'+path;",'img.src=officeRuntimeFileUrl(path);'):replaceExact(file,text,"img.src='/'+file.path;",'img.src=officeRuntimeFileUrl(file.path);');
   text=injectScoped(file,text,officeRuntimeFileUrl);changes.push({rule:'native-manifest-url',occurrences:1},{rule:'native-file-resolver',occurrences:1});break;
  case'gather-avatar-catalog.js':
   text=replaceExact(file,text,"image.src = '/' + item.path;","image.src = '"+OFFICE_RUNTIME_BASE+"' + item.path;");changes.push({rule:'avatar-thumbnail-url',occurrences:1});break;
  case'replica-avatar-sync.js':
   text=replaceExact(file,text,"url.origin!==win.location.origin||!url.pathname.startsWith('/assets/')",'!officeRuntimePortraitUrl(url,win.location)');
   text=injectScoped(file,text,officeRuntimePortraitUrl);changes.push({rule:'portrait-same-origin-runtime-png',occurrences:1});break;
  case'replica-smart-objects.js':
   text=replaceExact(file,text,"'/api/smart-objects/'","'"+OFFICE_SMART_OBJECT_BASE+"'");
   text=replaceExact(file,text,"'/api/smart-objects/events/'","'"+OFFICE_SMART_OBJECT_BASE+"events/'");
   changes.push({rule:'smart-object-api-base',occurrences:1},{rule:'smart-event-url',occurrences:1});break;
 }
 if(file!=='gather-library-data.js'&&/["'\x60]\/(?:assets\/|api\/(?!office\/))/.test(text))fail(file,'unadapted legacy absolute asset/API path remains');
 return{text,changed:text!==source,changes,...(preservedMetadataPaths.length?{preservedMetadataPaths}: {})};
}
