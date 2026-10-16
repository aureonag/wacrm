import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {createOfficeCrmRuntime,adaptOfficeCrm,bootstrapIndex,CLIENT_STATE_LIMITS,CLIENT_STATE_KEYS} from './office-crm-bootstrap.mjs';
const ACCOUNT='11111111-2222-4333-8444-555555555555',USER='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const identity={accountId:ACCOUNT,user:{id:USER,profileId:USER,name:'Membro teste'},capabilities:{canDecorate:false}};
const approved={objects:[{id:71,type:'desk',x:224,y:368,direction:3}],floor:'#a27f6b',construction:[{id:'wall1',type:'wall',a:{x:1,y:2},b:{x:3,y:4},brandLogo:true}]};
const clone=x=>structuredClone(x);
const response=(status,body)=>({status,ok:status>=200&&status<300,json:async()=>body,clone:()=>response(status,body)});
function harness(responder,document=null,loadScriptOverride,presentation){
 const calls=[],messages=[],loaded=[],stopped=[],logs=[],listeners=new Map(),registrations=[],timers=new Map(),timerDurations=new Map();let serial=0;
 const win={console:{error:(...args)=>logs.push(args)},location:{origin:'https://aureonag.com',href:'https://aureonag.com/api/office/runtime/'},parent:{postMessage:(...args)=>messages.push(args)},TextEncoder,AbortController,URL,
  setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,fn);timerDurations.set(id,ms);return id;},clearTimeout:id=>{timers.delete(id);timerDurations.delete(id);},
  CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},
  addEventListener:(type,fn,options)=>{registrations.push({type,fn,options});const list=listeners.get(type)||[];list.push(fn);listeners.set(type,list);},
  removeEventListener:(type,fn)=>listeners.set(type,(listeners.get(type)||[]).filter(listener=>listener!==fn)),
  dispatchEvent:event=>(listeners.get(event.type)||[]).forEach(fn=>fn(event)),
  aureonStopMicrophone:()=>stopped.push('mic'),aureonStopCamera:()=>stopped.push('camera'),aureonStopScreen:()=>stopped.push('screen'),
 };
 Object.defineProperty(win,'localStorage',{get(){throw Error('Actual localStorage must not be read');}});
 Object.defineProperty(win,'sessionStorage',{get(){throw Error('Actual sessionStorage must not be read');}});
 const fetch=async(url,options)=>{calls.push({url,options});return responder?responder(url,options):response(200,{identity:clone(identity),map:clone(approved),clientState:{}});};
 const loader=loadScriptOverride===null?{}:{loadScript:src=>{loaded.push(src);return loadScriptOverride?loadScriptOverride(src):Promise.resolve();}};
 const runtime=createOfficeCrmRuntime({window:win,document,fetch,TextEncoder,...loader,presentation},CLIENT_STATE_LIMITS);
 return {runtime,win,calls,messages,loaded,stopped,logs,listeners,registrations,timers,timerDurations};
}
test('context precedes modules; preferences and readonly full seed are isolated without actual browser storage',async()=>{
 const h=harness();
 await h.runtime.start(['/api/office/runtime/app.js']);
 assert.equal(h.calls[0].url,'/api/office/bootstrap');
 assert.equal(h.calls[0].options.credentials,'same-origin');
 assert.deepEqual(h.loaded,['/api/office/runtime/app.js']);
 assert.equal(h.runtime.ready,true);
 assert.equal(h.runtime.storageNamespace,'aureon-office:'+ACCOUNT+':'+USER+':');
 assert.deepEqual(JSON.parse(h.runtime.localStorage.getItem('aurion-office-v1')),{objects:approved.objects,floor:approved.floor});
 assert.deepEqual(JSON.parse(h.runtime.localStorage.getItem('aureon-office-construction-v1')),approved.construction);
 const seed=h.runtime.approvedMap();seed.objects[0].x=999;
 assert.equal(h.runtime.approvedMap().objects[0].x,224);
 h.runtime.localStorage.setItem('aurion-office-v1','{"objects":[]}');
 h.runtime.localStorage.removeItem('aureon-office-construction-v1');
 assert.equal(JSON.parse(h.runtime.localStorage.getItem('aurion-office-v1')).objects.length,1);
 assert.ok(h.runtime.localStorage.getItem('aureon-office-construction-v1'));
 assert.equal(h.messages.at(-1)[0].type,'aureon-office-ready');
});

test('presentation starts after modules and the authenticated interface, then closes on session expiry',async()=>{
 const order=[];
 const h=harness(undefined,null,()=>order.push('module'),{
  prepareInput(){order.push('prepare-input');},
  start(){assert.equal(h.runtime.active,true);order.push('presentation');},
  close(){order.push('closed');},
 });
 h.win.aureonReplicaUI={ready:Promise.resolve(),refresh:async()=>order.push('interface')};
 assert.equal(await h.runtime.start(['/api/office/runtime/app.js']),true);
 assert.deepEqual(order,['prepare-input','module','interface','presentation']);
 h.runtime.endSession(401);h.runtime.endSession(403);
 assert.deepEqual(order,['prepare-input','module','interface','presentation','closed']);
 assert.deepEqual(h.stopped,['mic','camera','screen']);
});

test('an unauthenticated office never installs presentation controls',async()=>{
 let starts=0,closes=0;
 const h=harness(()=>response(401,{}),null,undefined,{start(){starts++;},close(){closes++;}});
 assert.equal(await h.runtime.start(['/api/office/runtime/app.js']),false);
 assert.equal(starts,0);assert.equal(closes,1);assert.deepEqual(h.loaded,[]);
});
test('only the eight bounded preference keys are persisted; removals are tombstones and no tokens enter storage',async()=>{
 const h=harness((url)=>url==='/api/office/bootstrap'?response(200,{identity,map:approved,clientState:{'aureon-avatar-v1':'{"shirt":"#45434e"}','aureon-interface-session-principal':'secret','unknown':'x'}}):response(200,{clientState:{}}));
 await h.runtime.start([]);
 assert.equal(h.runtime.localStorage.getItem('aureon-avatar-v1'),'{"shirt":"#45434e"}');
 assert.equal(h.runtime.localStorage.getItem('aureon-interface-session-principal'),null);
 for(const key of ['aureon-interface-session','sb-auth-token','crm-user','supabase.session']){
  h.runtime.localStorage.setItem(key,'secret');h.runtime.sessionStorage.setItem(key,'secret');
  assert.equal(h.runtime.localStorage.getItem(key),null);assert.equal(h.runtime.sessionStorage.getItem(key),null);
 }
 h.runtime.localStorage.setItem('aureon-window-frame-v1','#294756');
 h.runtime.localStorage.setItem('aureon-gather-avatar-plan-v1','{"pieces":{}}');
 h.runtime.localStorage.setItem('aureon-office-before-v9','temporary migration');
 h.runtime.localStorage.setItem('aureon-interface-drafts-user','private draft in memory');
 h.runtime.sessionStorage.setItem('calendar-reminder','1');
 h.runtime.localStorage.removeItem('aureon-avatar-v1');
 assert.throws(()=>h.runtime.localStorage.setItem('aureon-window-frame-v1','red'),/inválida/);
 assert.throws(()=>h.runtime.localStorage.setItem('aureon-reactions-v1','[]'),/inválida/);
 assert.throws(()=>h.runtime.localStorage.setItem('aureon-camera-device','x'.repeat(1025)),/inválida/);
 assert.equal(await h.runtime.flush(),true);
 const call=h.calls.at(-1),entries=JSON.parse(call.options.body).entries;
 assert.deepEqual(entries,{'aureon-window-frame-v1':'#294756','aureon-gather-avatar-plan-v1':'{"pieces":{}}','aureon-avatar-v1':null});
 assert.equal(call.options.headers['X-Aureon-Office-Account'],ACCOUNT);
 assert.equal(call.options.headers['X-Aureon-Office-User'],USER);
 assert.equal(call.options.headers.Authorization,undefined);
 assert.equal(CLIENT_STATE_KEYS.length,8);
});
test('401/403 prevent all module loading; 503 reports unavailable without asserting an auth failure',async()=>{
 for(const status of [401,403,503]){
  const h=harness(()=>response(status,{error:'Unavailable',...(status===403?{code:'OFFICE_ACCESS_DENIED'}:{})}));
  assert.equal(await h.runtime.start(['/api/office/runtime/app.js']),false);
  assert.deepEqual(h.loaded,[]);
  const types=h.messages.map(m=>m[0].type);
  assert.deepEqual(types,[status===503?'aureon-office-unavailable':'aureon-office-session-ended']);
  assert.equal(h.runtime.active,false);
 }
});
test('an expired identity stops capture once, blocks controls and never retries as a named local session',async()=>{
 const h=harness();await h.runtime.start([]);
 h.runtime.endSession(401);h.runtime.endSession(403);
 assert.deepEqual(h.stopped,['mic','camera','screen']);
 assert.equal(h.messages.filter(m=>m[0].type==='aureon-office-session-ended').length,1);
 let prevented=0,stopped=0;
 for(const fn of h.listeners.get('click'))fn({preventDefault:()=>prevented++,stopImmediatePropagation:()=>stopped++});
 assert.equal(prevented,1);assert.equal(stopped,1);
 assert.throws(()=>h.runtime.headers(),error=>error.status===401);
 assert.equal(h.runtime.localStorage.getItem('aurion-office-v1'),null);
 assert.equal(await h.runtime.flush(),false);
});
test('preferences from two authenticated users never share memory or context headers',async()=>{
 const second=clone(identity);second.user.id='bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
 const one=harness(),two=harness(()=>response(200,{identity:second,map:approved,clientState:{}}));
 await one.runtime.start([]);await two.runtime.start([]);
 one.runtime.localStorage.setItem('aureon-camera-device','camera-one');
 assert.equal(two.runtime.localStorage.getItem('aureon-camera-device'),null);
 assert.notEqual(one.runtime.storageNamespace,two.runtime.storageNamespace);
 assert.equal(two.runtime.headers()['X-Aureon-Office-User'],second.user.id);
});
test('cookie identity mismatch during a preference write ends the old client; non-auth save failure does not',async()=>{
 for(const status of [403,503]){
  const h=harness(url=>url==='/api/office/bootstrap'?response(200,{identity,map:approved,clientState:{}}):response(status,status===403?{code:"OFFICE_ACCESS_DENIED"}:{}));
  await h.runtime.start([]);h.runtime.localStorage.setItem('aureon-window-frame-v1','#123456');
  assert.equal(await h.runtime.flush(),false);
  assert.equal(h.runtime.active,status===503);
  assert.equal(h.messages.some(m=>m[0].type==='aureon-office-session-ended'),status===403);
 }
});
const OLD_INIT="  async function init(){try{if(state.token){try{const data=await api('state');state.data=data;}catch(error){if(error.status===401){state.token='';sessionStorage.removeItem(sessionKey);localStorage.removeItem(sessionKey);}else throw error;}}if(!state.token){const session=window.aureonCrmIdentity?.userId?await api('session',{name:window.aureonCrmIdentity.name||'Allan Giro'}):await new Promise(resolve=>{modal('Boas-vindas ao Aureon',d=>{d.querySelector('header button').hidden=true;d.addEventListener('cancel',e=>e.preventDefault());d.append(el('p','r-help','Como você quer aparecer no escritório?'));const f=submitForm(d,'Entrar no escritório',async form=>{const session=await api('session',{name:form.elements.name.value});resolve(session)});f.querySelector('.r-dialog-actions button').hidden=true;const name=addField(f,'Seu nome','name');name.required=true;name.maxLength=80;name.placeholder='Digite seu nome';});});state.token=session.token;sessionStorage.setItem(sessionKey,state.token);localStorage.setItem(sessionKey,state.token);}loadDrafts();await refresh(true);await followMessageLink();await presenceSync.heartbeat();}catch(e){toast(e.message)}setInterval(async()=>{if(state.data){try{await presenceSync.heartbeat();await refresh();}catch{}}},5000);}";
const OLD_REDIRECT="/* The approved office is saved under localhost; use one local origin. */\nif(location.hostname === \"127.0.0.1\"){const officeUrl=new URL(location.href);officeUrl.hostname=\"localhost\";location.replace(officeUrl.href);}\n";
const uiFixture=()=>String.raw`(()=>{
  const browserProfile='principal',sessionKey='aureon-interface-session-principal';
  const state={data:null,token:sessionStorage.getItem(sessionKey)||localStorage.getItem(sessionKey)||(browserProfile==='principal'?sessionStorage.getItem('aureon-interface-session'):'')||''};
  let polling=false;
  async function api(endpoint,body,query,signal) {
    const url='/api/office/interface/'+endpoint+(query?'?'+new URLSearchParams(query):'');
    const response=await fetch(url,{method:body===undefined?'GET':'POST',...(signal?{signal}:{}),headers:{'Content-Type':'application/json',...(state.token?{Authorization:'Bearer '+state.token}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
    let result;try{result=await response.json()}catch{throw new Error('O serviço do escritório não está disponível.');}
    if(!response.ok){const error=new Error(result.error||'Falha');error.status=response.status;throw error;}return result;
  }
  async function refresh(){if(polling||!state.token)return;state.data=await api('state');}
  const loadDrafts=()=>{},followMessageLink=async()=>{},presenceSync={heartbeat:async()=>{}},toast=()=>{};
  window.aureonReplicaUI={state,api};
`+OLD_INIT+'\n  init();\n})();';
test('copied UI uses cookie context without signup/session or bearer, and rejects a changed user',async()=>{
 for(const changedUser of [false,true]){
  const calls=[],ended=[];
  const boot={active:true,identity,headers:()=>({'X-Aureon-Office-Account':ACCOUNT,'X-Aureon-Office-User':USER}),endSession:status=>{ended.push(status);boot.active=false;}};
  const win={aureonOfficeBootstrap:boot};
  const source=adaptOfficeCrm('replica-ui.js',uiFixture()).text;
  const context=vm.createContext({window:win,fetch:async(url,options)=>{calls.push({url,options});return response(200,{user:{id:changedUser?'different-user':USER}});},URLSearchParams,setInterval:()=>0});
  new vm.Script(source).runInContext(context);
  if(changedUser){await assert.rejects(win.aureonReplicaUI.ready,e=>e.status===403);assert.deepEqual(ended,[403]);}
  else{
   await win.aureonReplicaUI.ready;
   assert.equal(calls[0].url,'/api/office/interface/state');
   assert.equal(calls[0].options.credentials,'same-origin');
   assert.equal(calls[0].options.headers.Authorization,undefined);
   assert.equal(calls[0].options.headers['X-Aureon-Office-User'],USER);
   await assert.rejects(win.aureonReplicaUI.api('session',{name:'Fake Owner'}),e=>e.status===403);
  }
  assert.equal(source.includes('Boas-vindas ao Aureon'),false);
  assert.equal(source.includes("api('session'"),false);
  assert.equal(source.includes("Bearer "),false);
 }
});
test('index removes only the pinned localhost redirect and loads no original module before bootstrap',()=>{
 const original='<html><head><base href="/api/office/runtime/"><script>'+OLD_REDIRECT+'</script></head><body><script src="app.js"></script><script src="/api/office/runtime/replica-ui.js"></script></body></html>';
 const result=bootstrapIndex(original);
 const inline=[...result.text.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
 assert.equal(inline.length,1);new vm.Script(inline[0]);
 assert.equal(result.text.includes('location.replace'),false);
 assert.ok(inline[0].includes('const localStorage=aureonOfficeCrmRuntime.localStorage'));
 assert.ok(inline[0].includes('["/api/office/runtime/app.js","/api/office/runtime/replica-ui.js"]'));
 assert.equal((result.text.match(/<script src=/g)||[]).length,0);
 assert.throws(()=>bootstrapIndex(original.replace(OLD_REDIRECT,'alert("Unexpected");')),/unreviewed inline/);
 assert.throws(()=>adaptOfficeCrm('replica-ui.js',uiFixture().replace('Allan Giro','Changed Name')),/original init changed/);
});
const legacyCrmProfile="// Use the authenticated CRM profile, never a copied password.\n(()=>{\n const note=document.createElement('div');note.className='crm-identity-state';note.textContent='Conectando ao perfil do CRM…';document.querySelector('.people-sidebar').append(note);\n let identity=null;\n function apply(){\n  if(!identity)return;\n  for(const avatar of document.querySelectorAll('.self-avatar')){\n   if(identity.avatarUrl&&!avatar.querySelector('img.crm-profile-photo')){\n    const img=document.createElement('img');img.className='crm-profile-photo';img.src=identity.avatarUrl;img.alt=identity.name||'Sua foto';img.onerror=()=>img.remove();avatar.replaceChildren(img);\n   }\n  }\n  for(const node of document.querySelectorAll('.profile-copy b,.person-row:has(.self-avatar) b'))node.textContent=identity.name||'Você';\n  for(const node of document.querySelectorAll('[data-person=\"AL\"] text'))if(node.textContent==='Allan Giro')node.textContent=identity.name||'Você';\n }\n async function connect(){\n  try{\n   const response=await fetch('http://localhost:3000/api/office/profile',{credentials:'include',cache:'no-store'});\n   if(!response.ok)throw Error('login');\n   identity=await response.json();window.aureonCrmIdentity=Object.freeze(identity);\n   note.textContent='Conta vinculada ao CRM';note.classList.add('connected');apply();\n  }catch{\n   identity=null;delete window.aureonCrmIdentity;for(const photo of document.querySelectorAll('.crm-profile-photo'))photo.remove();\n   note.classList.remove('connected');note.replaceChildren();\n   const link=document.createElement('a');link.href='http://localhost:3000/login';link.target='_blank';link.rel='noopener';link.textContent='Entrar no CRM para vincular minha conta';\n   note.append(link);\n  }\n }\n const observer=new MutationObserver(()=>{observer.disconnect();apply();observer.observe(document.querySelector('.people-sidebar'),{childList:true,subtree:true})});\n observer.observe(document.querySelector('.people-sidebar'),{childList:true,subtree:true});\n window.addEventListener('focus',connect);connect();setInterval(apply,500);\n})();\n\n// Unified open operational floor;\n";

const appFixture=legacyCrmProfile+String.raw`let stored=JSON.parse(localStorage.getItem('aurion-office-v1')),defaults=[];
let objects=Array.isArray(stored?.objects)?stored.objects:[],floor=stored.floor,editing=false,placing=null,selected=null,drag=null;
function render(){globalThis.drawn=JSON.parse(JSON.stringify({objects,floor}));}
function save(){}
function editor(open){editing=open;return open;}
(()=>{const key='aureon-office-construction-v1';let items=JSON.parse(localStorage.getItem(key)),active=false,start=null,movingWindow=null;const windowEdit={hidden:false},input={replaceChildren(){}};function officeStopMovement(){}
function render(){globalThis.built=JSON.parse(JSON.stringify(items));}
function save(){localStorage.setItem(key,JSON.stringify(items));render()}
function setActive(value){
  active=value;start=null;movingWindow=null;windowEdit.hidden=true;input.replaceChildren();officeStopMovement();editor(false);editing=active;
}
items.push({id:'migration-wall'});render();})();

let myStatus='online',lastActivity=Date.now(),autoAway=false;
function renderPeople(){}function syncRoom(){}
 ['pointerdown','keydown'].forEach(type=>document.addEventListener(type,()=>{lastActivity=Date.now();if(autoAway){myStatus='online';autoAway=false;renderPeople();syncRoom()}},{passive:true}));
 setInterval(()=>{if(myStatus==='online'&&Date.now()-lastActivity>300000){myStatus='away';autoAway=true;renderPeople();syncRoom()}},15000);
window.aureonInterfaceBridge={pause:()=>officeStopMovement(),getPresence:()=>myStatus};

function actionFor(o){return o.action;}
function openObject(o,arrived=false){const action=actionFor(o);if(!action)return;if(!arrived)window.aureonCancelSeatApproach?.();globalThis.enteredObjectActions.push(action);if(action==='Abrir estação')toast('Estação atualizada.');}
function soundDb(){return indexedDB.open('aureon-personal-sounds-v1',1);}
objects.push({id:'migration-object'});globalThis.tryEdit=()=>{objects.push({id:'changed'});save();};
`;
test('copied app restores exact objects, directions and constructions after migrations and refuses map writes',()=>{
 const namespace='aureon-office:'+ACCOUNT+':'+USER+':';
 const boot={mapReadOnly:true,approvedMap:()=>clone(approved),storageNamespace:namespace};
 const values={'aurion-office-v1':JSON.stringify({objects:approved.objects,floor:approved.floor}),'aureon-office-construction-v1':JSON.stringify(approved.construction)};
 const window={aureonOfficeBootstrap:boot};
 const context=vm.createContext({window,localStorage:{getItem:key=>values[key]??null,setItem(){}},indexedDB:{open:(name,version)=>({name,version})},setInterval:()=>0});
 const output=adaptOfficeCrm('app.js',appFixture).text;new vm.Script(output).runInContext(context);
 assert.deepEqual(JSON.parse(JSON.stringify(context.drawn)),{objects:approved.objects,floor:approved.floor});
 assert.deepEqual(JSON.parse(JSON.stringify(context.built)),approved.construction);
 context.tryEdit();
 assert.deepEqual(JSON.parse(JSON.stringify(context.drawn)),{objects:approved.objects,floor:approved.floor});
 assert.equal(context.editor(true),false);
 assert.equal(context.soundDb().name,namespace+'personal-sounds-v1');
});
test('call disconnect stops captures even before wasJoined, and 401 is handled alongside 403',()=>{
 const source=String.raw`(()=>{let wasJoined=false,testAudio={getTracks:()=>[{stop:()=>globalThis.trackStopped++}]},testContext={close:()=>Promise.resolve()};function closeAll(){globalThis.closed++;}
function disconnectSession(){if(wasJoined){window.aureonStopMicrophone?.();window.aureonStopCamera?.();window.aureonStopScreen?.();}wasJoined=false;closeAll();}
async function tick(){if(ticking||!state.data)return;try{const m=meeting();if(!m){disconnectSession();return;}}catch(error){if(error.status===403){disconnectSession();}}}
window.addEventListener('aureon-interface-state',()=>{if(!meeting())disconnectSession();tick()});
function broadcastReaction(){}function toggleHand(){}
window.aureonReplicaCalls={broadcastReaction,toggleHand};})();`;
 const stopped=[],window={aureonOfficeBootstrap:{active:true},aureonStopMicrophone:()=>stopped.push('mic'),aureonStopCamera:()=>stopped.push('camera'),aureonStopScreen:()=>stopped.push('screen'),addEventListener(){}};
 const output=adaptOfficeCrm('replica-calls.js',source).text;
 const context=vm.createContext({window,closed:0,trackStopped:0});new vm.Script(output).runInContext(context);
 window.aureonReplicaCalls.disconnectSession();
 assert.deepEqual(stopped,['mic','camera','screen']);assert.equal(context.closed,1);assert.equal(context.trackStopped,1);
 assert.ok(output.includes('error.status===401||error.status===403'));
});

test('business 403 stays an operation error; only the explicit access-denied code ends the whole session',async()=>{
 let next=response(200,{user:{id:USER}});
 const ended=[],boot={active:true,identity,headers:()=>({'X-Aureon-Office-Account':ACCOUNT,'X-Aureon-Office-User':USER}),endSession:status=>{ended.push(status);boot.active=false;}};
 const window={aureonOfficeBootstrap:boot};
 const context=vm.createContext({window,fetch:async()=>next,URLSearchParams,setInterval:()=>0});
 new vm.Script(adaptOfficeCrm('replica-ui.js',uiFixture()).text).runInContext(context);
 await window.aureonReplicaUI.ready;
 next=response(403,{error:'Sala privada'});
 await assert.rejects(window.aureonReplicaUI.api('meeting-join',{id:'private'}),error=>error.status===403);
 assert.equal(boot.active,true);assert.deepEqual(ended,[]);
 next=response(403,{code:'OFFICE_ACCESS_DENIED'});
 await assert.rejects(window.aureonReplicaUI.api('presence',{}),error=>error.status===403);
 assert.equal(boot.active,false);assert.deepEqual(ended,[403]);
 const h=harness(()=>response(403,{error:'Business rejection without session code'}));
 await h.runtime.start([]);
 assert.equal(h.messages.at(-1)[0].type,'aureon-office-unavailable');
 assert.equal(h.messages.some(m=>m[0].type==='aureon-office-session-ended'),false);
});
test('profile name and photo are CRM-managed while bio and timezone remain editable in the save payload',async()=>{
 const source="async function submit(){const name='Changed',bio='Bio',timeZone='America/Sao_Paulo',photo='ignored';await U.api('profile',{name,bio,timeZone,profilePhotoUrl:photo});}const name={},input={},remove={},photoStatus={},photoTitle=null,preview=null,photoSection={append(){}};name.required=true;name.maxLength=80;photoSection.append(photoTitle,preview,input,remove,photoStatus);globalThis.fields={name,input,remove,photoStatus};";
 const calls=[],context=vm.createContext({U:{api:async(endpoint,body)=>calls.push({endpoint,body})}});
 const output=adaptOfficeCrm('replica-profile-details.js',source).text;
 new vm.Script(output).runInContext(context);await context.submit();
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{endpoint:'profile',body:{bio:'Bio',timeZone:'America/Sao_Paulo'}}]);
 assert.equal(context.fields.name.readOnly,true);
 assert.equal(context.fields.input.disabled,true);assert.equal(context.fields.remove.disabled,true);
 assert.match(context.fields.photoStatus.textContent,/gerenciados pelo CRM/);
});

function tinyDocument(){
 const nodes=new Map();
 const make=tag=>({tagName:tag,style:{},children:[],setAttribute(){},append(...children){this.children.push(...children);for(const child of children){child.parentNode=this;if(child.id)nodes.set(child.id,child);}},prepend(child){this.children.unshift(child);child.parentNode=this;if(child.id)nodes.set(child.id,child);},replaceChildren(...children){this.children=[];this.append(...children);},remove(){nodes.delete(this.id);if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(child=>child!==this);this.parentNode=null;}});
 return {documentElement:{dataset:{}},readyState:'complete',head:make('head'),body:make('body'),createElement:make,getElementById:id=>nodes.get(id)||null};
}
test('a failed preference save shows one retry notice, keeps the office usable and clears after success',async()=>{
 let saveStatus=503;const doc=tinyDocument();
 const h=harness(url=>url==='/api/office/bootstrap'?response(200,{identity,map:approved,clientState:{}}):response(saveStatus,{}),doc);
 await h.runtime.start([]);h.runtime.localStorage.setItem('aureon-window-frame-v1','#123456');
 assert.equal(await h.runtime.flush(),false);
 const notice=doc.getElementById('officeCrmPreferenceNotice');
 assert.ok(notice);assert.equal(h.runtime.active,true);
 assert.match(notice.children[0].textContent,/Preferências não salvas/);
 assert.equal(await h.runtime.flush(),false);
 assert.equal(doc.getElementById('officeCrmPreferenceNotice'),notice);
 saveStatus=200;await notice.children[1].onclick();
 assert.equal(doc.getElementById('officeCrmPreferenceNotice'),null);
 assert.equal(h.runtime.lastSaveError,null);
 assert.equal(h.messages.some(m=>m[0].type==='aureon-office-unavailable'),false);
});
test('bootstrap fetch deadline reports unavailable without a false session-expired message',async()=>{
 const h=harness((url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(Error('deadline'),{name:'AbortError'})))));
 const starting=h.runtime.start(['/api/office/runtime/app.js']);
 assert.equal(h.timers.size,1);
 [...h.timers.values()][0]();
 assert.equal(await starting,false);
 assert.deepEqual(h.loaded,[]);
 assert.deepEqual(h.messages.map(m=>m[0].type),['aureon-office-unavailable']);
 assert.equal(h.runtime.sessionStatus,null);
});

test('client-state deadline keeps preferences pending and the authenticated office active',async()=>{
 const h=harness((url,options)=>url==='/api/office/bootstrap'?response(200,{identity,map:approved,clientState:{}}):new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(Error('deadline'),{name:'AbortError'})))));
 await h.runtime.start([]);h.runtime.localStorage.setItem('aureon-window-frame-v1','#123456');
 const saving=h.runtime.flush();
 [...h.timers.values()].at(-1)();
 assert.equal(await saving,false);
 assert.equal(h.runtime.active,true);
 assert.match(h.runtime.lastSaveError,/demorou/);
 assert.equal(h.runtime.sessionStatus,null);
});

test('ready waits for all modules, initial UI and a final forced state refresh for late listeners',async()=>{
 const h=harness(),order=[];let resolveUi,resolveRefresh;
 const initial=new Promise(resolve=>{resolveUi=resolve;});
 h.win.aureonReplicaUI={ready:initial,refresh:async force=>{
  assert.equal(force,true);assert.equal(h.loaded.length,2);
  assert.equal(h.runtime.ready,false);order.push('forced-refresh');
  await new Promise(resolve=>{resolveRefresh=resolve;});
  h.win.dispatchEvent(new h.win.CustomEvent('aureon-interface-state',{detail:{user:{preferences:{theme:'dark'}}}}));
 }};
 let theme=null;
 h.win.addEventListener('aureon-interface-state',event=>{theme=event.detail.user.preferences.theme;});
 const starting=h.runtime.start(['/api/office/runtime/app.js','/api/office/runtime/replica-settings.js']);
 await new Promise(setImmediate);
 assert.deepEqual(h.loaded,['/api/office/runtime/app.js','/api/office/runtime/replica-settings.js']);
 assert.deepEqual(order,[]);assert.equal(h.runtime.ready,false);
 resolveUi();await new Promise(setImmediate);
 assert.deepEqual(order,['forced-refresh']);
 assert.equal(h.messages.some(message=>message[0].type==='aureon-office-ready'),false);
 resolveRefresh();assert.equal(await starting,true);
 assert.equal(theme,'dark');assert.equal(h.runtime.ready,true);
 assert.equal(h.messages.at(-1)[0].type,'aureon-office-ready');
});
test('auth expiry during the final state rendezvous never emits ready',async()=>{
 const h=harness();
 h.win.aureonReplicaUI={ready:Promise.resolve(),refresh:async()=>{h.runtime.endSession(401);throw Object.assign(Error('expired'),{status:401});}};
 assert.equal(await h.runtime.start([]),false);
 assert.equal(h.runtime.ready,false);
 assert.equal(h.messages.some(message=>message[0].type==='aureon-office-ready'),false);
});

test('legacy localhost CRM identity autostart is removed exactly once and cannot override bootstrap identity',()=>{
 const output=adaptOfficeCrm('app.js',appFixture);
 assert.equal(output.changes.filter(x=>x.rule==='remove-legacy-localhost-crm-identity').length,1);
 assert.equal(output.changes.find(x=>x.rule==='remove-legacy-localhost-crm-identity').occurrences,1);
 for(const forbidden of ['http://localhost:3000','crm-identity-state','delete window.aureonCrmIdentity',"window.addEventListener('focus',connect)","connect();setInterval(apply,500)"])
  assert.ok(!output.text.includes(forbidden),forbidden);
 assert.ok(output.text.includes('// Unified open operational floor;'));
 assert.throws(()=>adaptOfficeCrm('app.js',appFixture.replace('credentials:\'include\'','credentials:\'omit\'')),/legacy CRM identity block changed/);
 assert.throws(()=>adaptOfficeCrm('app.js',appFixture.replace(legacyCrmProfile,'')),/legacy CRM identity block changed/);
 assert.throws(()=>adaptOfficeCrm('app.js',legacyCrmProfile+appFixture),/legacy CRM identity block changed/);
 assert.throws(()=>adaptOfficeCrm('app.js',appFixture+'\nconst unreviewed="http://localhost:3000/login";'),/legacy CRM identity remained/);
});


async function activityHarness(){
 const h=harness(),intervals=[];let time=0,dialog=false,cancelled=0,renders=0,syncs=0;
 await h.runtime.start([]);
 const document={querySelector:()=>dialog?{}:null};
 const context=vm.createContext({window:h.win,document,localStorage:h.runtime.localStorage,indexedDB:{open(){}},Date:{now:()=>time},setInterval:fn=>{intervals.push(fn);return 0;}});
 new vm.Script(adaptOfficeCrm('app.js',appFixture).text).runInContext(context);
 new vm.Script("renderPeople=()=>globalThis.countRender();syncRoom=()=>globalThis.countSync();globalThis.probe={read:()=>({myStatus,lastActivity,autoAway}),set:(status,automatic=false)=>{myStatus=status;autoAway=automatic;},edit:value=>{editing=value;}};").runInContext(context);
 context.countRender=()=>renders++;context.countSync=()=>syncs++;
 h.win.aureonCancelSeatApproach=()=>cancelled++;
 return {...h,intervals,probe:context.probe,time:value=>{time=value;},dialog:value=>{dialog=value;},counts:()=>({cancelled,renders,syncs})};
}
function propagateCapturedInput(h,type,key='',typing=false){
 // A unit model of capture order, not a browser or a claim of trusted UI input.
 let halted=false;
 const event={type,key,target:{closest:()=>typing?{}:null},preventDefault(){},stopImmediatePropagation(){halted=true;}};
 for(const entry of h.registrations){
  if(entry.type!==type||!(entry.options===true||entry.options?.capture))continue;
  entry.fn(event);if(halted)break;
 }
 return halted;
}
test('early capture refreshes activity before later movement/seat stops propagation, without dispatching another event',async()=>{
 const h=await activityHarness();
 for(const type of ['keydown','pointerdown'])h.win.addEventListener(type,event=>event.stopImmediatePropagation(),true);
 for(const [type,key,time]of [['keydown','ArrowRight',299999],['pointerdown','',599998],['keydown','W',899997]]){
  h.time(time);assert.equal(propagateCapturedInput(h,type,key),true);
  assert.equal(h.probe.read().lastActivity,time);
  h.time(time+2);h.intervals.forEach(fn=>fn());
  assert.equal(h.probe.read().myStatus,'online');
 }
 h.time(1200000);h.intervals.forEach(fn=>fn());
 assert.equal(h.probe.read().autoAway,true);
 h.time(1200001);propagateCapturedInput(h,'keydown','ArrowLeft');
 assert.equal(h.probe.read().myStatus,'online');assert.equal(h.probe.read().autoAway,false);
 assert.equal(h.calls.length,1); // bootstrap only: no fake API activity/GET or publication.
 const activity=adaptOfficeCrm('app.js',appFixture).text;
 assert.ok(!activity.includes("document.addEventListener(type,()=>{lastActivity="));
 assert.ok(!activity.includes('dispatchEvent'));
});
test('accepted arrows/WASD and Escape cancel pending-seat through the bridge without consuming UI Escape',async()=>{
 const h=await activityHarness();
 const keys=['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','a','s','d','W','A','S','D','Escape'];
 for(const key of keys)assert.equal(propagateCapturedInput(h,'keydown',key),false);
 assert.equal(h.counts().cancelled,keys.length);
 propagateCapturedInput(h,'keydown','w',true);h.dialog(true);propagateCapturedInput(h,'keydown','ArrowDown');
 h.dialog(false);h.probe.edit(true);propagateCapturedInput(h,'keydown','A');
 assert.equal(h.counts().cancelled,keys.length);
 propagateCapturedInput(h,'keydown','Escape',true);
 assert.equal(h.counts().cancelled,keys.length+1);
});
test('manual status is preserved and ended/missing identity cannot update activity, auto-away, seat or synchronization',async()=>{
 const h=await activityHarness();
 h.probe.set('away');h.time(50);propagateCapturedInput(h,'keydown','w');
 assert.equal(h.probe.read().myStatus,'away');
 assert.equal(h.probe.read().lastActivity,50);
 assert.equal(h.counts().syncs,0);
 h.probe.set('away',true);
 const snapshot=JSON.parse(JSON.stringify(h.probe.read())),counts=h.counts();
 h.runtime.endSession(401);h.time(500000);propagateCapturedInput(h,'keydown','Escape');h.intervals.forEach(fn=>fn());
 assert.deepEqual(JSON.parse(JSON.stringify(h.probe.read())),snapshot);
 assert.deepEqual(h.counts(),counts);assert.equal(h.calls.length,1);
 const cold=harness();let recorded=0;cold.win.aureonInterfaceBridge={recordActivity:()=>recorded++};
 propagateCapturedInput(cold,'pointerdown');assert.equal(recorded,0);
});
test('activity/idle/bridge drift and duplicate anchors fail closed',()=>{
 for(const anchor of [" ['pointerdown','keydown'].forEach(type=>document.addEventListener(type,()=>{lastActivity=Date.now();if(autoAway){myStatus='online';autoAway=false;renderPeople();syncRoom()}},{passive:true}));"," setInterval(()=>{if(myStatus==='online'&&Date.now()-lastActivity>300000){myStatus='away';autoAway=true;renderPeople();syncRoom()}},15000);","window.aureonInterfaceBridge={pause:()=>officeStopMovement(),getPresence:"]){
  assert.throws(()=>adaptOfficeCrm('app.js',appFixture.replace(anchor,anchor+'/*drift*/').replace(anchor,anchor.slice(0,-1))),/expected 1 anchor/);
  assert.throws(()=>adaptOfficeCrm('app.js',appFixture+'\n'+anchor),/expected 1 anchor/);
 }
});

test('readonly pilot blocks only notes/station editors before writes and false success, preserving other object actions',()=>{
 const enteredObjectActions=[],toasts=[];let cancellations=0;
 const boot={active:true,identity,mapReadOnly:true,approvedMap:()=>clone(approved),storageNamespace:'fixture:'};
 const window={aureonOfficeBootstrap:boot,aureonCancelSeatApproach:()=>cancellations++};
 const values={'aurion-office-v1':JSON.stringify({objects:approved.objects,floor:approved.floor}),'aureon-office-construction-v1':JSON.stringify(approved.construction)};
 const context=vm.createContext({window,enteredObjectActions,toast:message=>toasts.push(message),localStorage:{getItem:key=>values[key]??null,setItem(){throw Error('Blocked editor must never write');}},indexedDB:{open(){}},setInterval:()=>0});
 const output=adaptOfficeCrm('app.js',appFixture).text;
 new vm.Script(output).runInContext(context);
 for(const action of ['Abrir anotações','Abrir estação']){
  context.openObject({action});context.openObject({action},true);
 }
 assert.deepEqual(enteredObjectActions,[]);assert.equal(cancellations,2);
 assert.equal(toasts.length,4);assert.ok(toasts.every(message=>message.includes('em preparação no piloto')));
 assert.ok(!toasts.includes('Estação atualizada.'));
 for(const action of ['Sentar','Celebrar conquista','Jogar','Tocar melodia','Abrir apresentação'])context.openObject({action});
 assert.deepEqual(enteredObjectActions,['Sentar','Celebrar conquista','Jogar','Tocar melodia','Abrir apresentação']);
 assert.equal(cancellations,7);
 assert.throws(()=>adaptOfficeCrm('app.js',appFixture.replace("function openObject(o,arrived=false){const action=actionFor(o);if(!action)return;if(!arrived)window.aureonCancelSeatApproach?.();",'function unexpectedObjectEditor(){')),/expected 1 anchor/);
 assert.throws(()=>adaptOfficeCrm('app.js',appFixture+'\n'+"function openObject(o,arrived=false){const action=actionFor(o);if(!action)return;if(!arrived)window.aureonCancelSeatApproach?.();"),/expected 1 anchor/);
});

function fireDeadline(h,milliseconds){
 const found=[...h.timerDurations].find(([,ms])=>ms===milliseconds);
 assert.ok(found,'Expected pending deadline '+milliseconds);
 const [id]=found,callback=h.timers.get(id);h.timers.delete(id);h.timerDurations.delete(id);callback();
}
function assertScriptFailure(h,doc){
 assert.equal(h.runtime.ready,false);assert.equal(h.runtime.active,false);
 assert.equal(doc.documentElement.dataset.officeCrm,'unavailable');
 assert.match(doc.getElementById('officeCrmStatus').textContent,/Tente novamente pelo CRM/);
 assert.deepEqual(h.messages.map(message=>message[0].type),['aureon-office-unavailable']);
 assert.deepEqual(h.stopped,['mic','camera','screen']);
 assert.equal(h.timers.size,0);assert.equal(h.timerDurations.size,0);
 assert.equal((h.listeners.get('error')||[]).length,0);
 let blocked=0;h.win.dispatchEvent({type:'click',preventDefault(){blocked++;},stopImmediatePropagation(){blocked++;}});
 assert.equal(blocked,2);
}
test('script fixture deadline stops the start after 45 seconds, never loads the next module or becomes ready on late completion',async()=>{
 let finishLate;const doc=tinyDocument(),h=harness(undefined,doc,()=>new Promise(resolve=>{finishLate=resolve;}));
 const starting=h.runtime.start(['/api/office/runtime/app.js','/api/office/runtime/next.js']);
 await new Promise(setImmediate);
 assert.deepEqual(h.loaded,['/api/office/runtime/app.js']);
 assert.deepEqual([...h.timerDurations.values()],[45000]);
 assert.equal(h.runtime.ready,false);
 fireDeadline(h,45000);assert.equal(await starting,false);assertScriptFailure(h,doc);
 assertSanitizedStartupLog(h,{stage:'scripts',cause:'timeout',status:0});
 finishLate();await new Promise(setImmediate);
 assert.deepEqual(h.loaded,['/api/office/runtime/app.js']);assertScriptFailure(h,doc);
});
test('native script deadline removes its node, listener, timer and callbacks; saved late callbacks cannot advance startup',async()=>{
 const doc=tinyDocument(),h=harness(undefined,doc,null);
 const starting=h.runtime.start(['/api/office/runtime/app.js','/api/office/runtime/next.js']);
 await new Promise(setImmediate);
 const script=doc.body.children.find(node=>node.tagName==='script');assert.ok(script);
 const lateLoad=script.onload,lateError=script.onerror;
 assert.equal(script.src,'/api/office/runtime/app.js');assert.equal(script.async,false);
 assert.equal((h.listeners.get('error')||[]).length,1);
 fireDeadline(h,45000);assert.equal(await starting,false);assertScriptFailure(h,doc);
 assert.equal(doc.body.children.includes(script),false);assert.equal(script.onload,null);assert.equal(script.onerror,null);
 lateLoad();lateError();await new Promise(setImmediate);assertScriptFailure(h,doc);
 assert.equal(doc.body.children.some(node=>node.tagName==='script'),false);
});
test('successful native script completion keeps the loaded node and clears only its temporary hooks and deadline',async()=>{
 const doc=tinyDocument(),h=harness(undefined,doc,null);
 const starting=h.runtime.start(['/api/office/runtime/app.js']);await new Promise(setImmediate);
 const script=doc.body.children.find(node=>node.tagName==='script');assert.ok(script);
 script.onload();assert.equal(await starting,true);
 assert.equal(h.runtime.ready,true);assert.equal(h.runtime.active,true);
 assert.equal(doc.body.children.includes(script),true);assert.equal(script.onload,null);assert.equal(script.onerror,null);
 assert.equal(h.timers.size,0);assert.equal(h.timerDurations.size,0);assert.equal((h.listeners.get('error')||[]).length,0);
 assert.deepEqual(h.stopped,[]);assert.deepEqual(h.messages.map(message=>message[0].type),['aureon-office-ready']);
});
test('script errors remove temporary native hooks, including matching runtime errors, without waiting for the deadline',async()=>{
 for(const kind of ['element','runtime']){
  const doc=tinyDocument(),h=harness(undefined,doc,null);
  const starting=h.runtime.start(['/api/office/runtime/app.js','/api/office/runtime/next.js']);await new Promise(setImmediate);
  const script=doc.body.children.find(node=>node.tagName==='script');
  h.win.dispatchEvent({type:'error',filename:'https://aureonag.com/unrelated.js'});
  assert.equal(h.runtime.active,true);assert.equal(h.timers.size,1);
  if(kind==='element')script.onerror();else h.win.dispatchEvent({type:'error',filename:'https://aureonag.com/api/office/runtime/app.js'});
  assert.equal(await starting,false);assertScriptFailure(h,doc);assert.equal(doc.body.children.includes(script),false);
  assertSanitizedStartupLog(h,{stage:'scripts',cause:kind==='element'?'load':'execution',status:0});
 }
});
test('fixture script rejection or synchronous failure clears its deadline without retrying or exposing technical errors',async()=>{
 for(const loader of [()=>Promise.reject(Error('private implementation detail')),()=>{throw Error('private implementation detail');}]){
  const doc=tinyDocument(),h=harness(undefined,doc,loader);
  assert.equal(await h.runtime.start(['/api/office/runtime/app.js','/api/office/runtime/next.js']),false);
  assert.deepEqual(h.loaded,['/api/office/runtime/app.js']);assertScriptFailure(h,doc);
  assert.ok(!doc.getElementById('officeCrmStatus').textContent.includes('private implementation detail'));
 }
});

function assertSanitizedStartupLog(h,expected){
 assert.equal(h.logs.length,1);assert.equal(h.logs[0].length,1);
 const prefix='Aureon office startup failed ',message=h.logs[0][0];
 assert.equal(typeof message,'string');assert.ok(message.startsWith(prefix));
 const diagnostic=JSON.parse(message.slice(prefix.length));
 assert.deepEqual(Object.keys(diagnostic).sort(),['cause','stage','status']);
 assert.deepEqual(diagnostic,expected);
 assert.ok(!JSON.stringify(h.logs).includes('INJECTED_SECRET'));
 assert.ok(!JSON.stringify(h.logs).includes(ACCOUNT));assert.ok(!JSON.stringify(h.logs).includes(USER));
}
test('bootstrap diagnostics log only a fixed stage/cause and allowlisted integer HTTP status, never response content',async()=>{
 for(const status of [400,401,403,404,405,409,413,415,429,503,418,500,599,'503',503.5,NaN]){
  const body={error:'INJECTED_SECRET body',stack:'INJECTED_SECRET stack',headers:{Cookie:'INJECTED_SECRET cookie'},identity:{id:'INJECTED_SECRET identity'},...(status===403?{code:'OFFICE_ACCESS_DENIED'}:{})};
  const h=harness(()=>response(status,body),tinyDocument());
  assert.equal(await h.runtime.start(['/api/office/runtime/app.js']),false);
  const allowed=Number.isInteger(status)&&[400,401,403,404,405,409,413,415,429,503].includes(status);
  assertSanitizedStartupLog(h,{stage:'bootstrap',cause:'unknown',status:allowed?status:0});
  assert.deepEqual(h.loaded,[]);
 }
});
test('startup diagnostics do not invoke status/message/stack/body/header getters or inherited metadata',async()=>{
 for(const mode of ['data','getter','inherited','proxy']){
  let sensitiveReads=0;
  const thrown=Object.create(mode==='inherited'?{status:503}:null);
  Object.defineProperty(thrown,'name',{value:'Error'});
  for(const key of ['message','stack','body','headers','cookies','identity','query','endpoint'])Object.defineProperty(thrown,key,{get(){sensitiveReads++;return 'INJECTED_SECRET '+key;}});
  if(mode==='data')Object.defineProperty(thrown,'status',{value:503});
  if(mode==='getter')Object.defineProperty(thrown,'status',{get(){sensitiveReads++;return 503;}});
  const error=mode==='proxy'?new Proxy(thrown,{getOwnPropertyDescriptor(){throw Error('INJECTED_SECRET trap');}}):thrown;
  const h=harness(()=>{throw error;},tinyDocument());
  assert.equal(await h.runtime.start([]),false);
  assertSanitizedStartupLog(h,{stage:'bootstrap',cause:'unknown',status:mode==='data'?503:0});
  assert.equal(sensitiveReads,0);
 }
});
test('interface ready and refresh rejection report interface stage without leaking the error object or a script cause',async()=>{
 for(const kind of ['ready','refresh']){
  const error=Object.assign(Error('INJECTED_SECRET message'),{status:503,body:'INJECTED_SECRET body',headers:{Cookie:'INJECTED_SECRET cookie'},identity});
  const doc=tinyDocument(),h=harness(undefined,doc);
  if(kind==='ready'){
   let rejectReady;const ready=new Promise((_resolve,reject)=>{rejectReady=reject;});h.win.aureonReplicaUI={ready};
   const starting=h.runtime.start(['/api/office/runtime/app.js']);await new Promise(setImmediate);rejectReady(error);
   assert.equal(await starting,false);
  }else{
   h.win.aureonReplicaUI={ready:Promise.resolve(),refresh:async()=>{throw error;}};
   assert.equal(await h.runtime.start(['/api/office/runtime/app.js']),false);
  }
  assertSanitizedStartupLog(h,{stage:'interface',cause:'unknown',status:503});
  assertScriptFailure(h,doc);
 }
});
test('a missing or throwing console cannot change the generic failure UI or media shutdown',async()=>{
 for(const mode of ['missing','throws']){
  const doc=tinyDocument(),h=harness(()=>response(503,{error:'INJECTED_SECRET'}),doc);
  h.win.console=mode==='missing'?undefined:{error(){throw Error('INJECTED_SECRET logger');}};
  assert.equal(await h.runtime.start(['/api/office/runtime/app.js']),false);
  assert.equal(h.runtime.active,false);assert.equal(h.runtime.ready,false);
  assert.deepEqual(h.stopped,['mic','camera','screen']);assert.deepEqual(h.messages.map(message=>message[0].type),['aureon-office-unavailable']);
  assert.match(doc.getElementById('officeCrmStatus').textContent,/temporariamente indisponível/);
  assert.ok(!doc.getElementById('officeCrmStatus').textContent.includes('INJECTED_SECRET'));
 }
});
