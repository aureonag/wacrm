import {createHash} from 'node:crypto';
import {createOfficePresentation} from './office-presentation.mjs';

export const CLIENT_STATE_LIMITS=Object.freeze({
 'aureon-avatar-v1':32768,'aureon-gather-avatar-plan-v1':16384,'aureon-gather-avatar-applied-v1':16384,
 'aureon-window-frame-v1':64,'aureon-camera-device':1024,'aureon-microphone-device':1024,
 'aureon-reactions-v1':8192,'aureon-soundboard-v1':8192,
});
export const CLIENT_STATE_KEYS=Object.freeze(Object.keys(CLIENT_STATE_LIMITS));
export const CRM_BOOTSTRAP_VERSION=1;

/** Self-contained browser factory, also exercised without a browser in tests. */
export function createOfficeCrmRuntime(env,limits){
 const win=env.window,doc=env.document,fetch=env.fetch;
 const encode=new (env.TextEncoder||win.TextEncoder)(),local=new Map(),session=new Map(),pending=new Map();
 let identity=null,map=null,active=false,started=false,ready=false,timer=null,flushing=null,lastSaveError=null,endedStatus=null,scriptFailureCause='unknown';
 const jsonKeys=new Set(Object.keys(limits).filter(k=>!['aureon-window-frame-v1','aureon-camera-device','aureon-microphone-device'].includes(k)));
 const clone=value=>JSON.parse(JSON.stringify(value));
 const bytes=value=>encode.encode(value).length;
 const denied=key=>/(?:token|session|password|credential|supabase|auth|crm)/i.test(key);
 const valid=(key,value)=>{
  if(!Object.hasOwn(limits,key)||typeof value!=='string'||bytes(value)>limits[key])return false;
  if(key==='aureon-window-frame-v1')return /^#[0-9a-f]{6}$/i.test(value);
  if(jsonKeys.has(key)){try{const parsed=JSON.parse(value);return !!parsed&&typeof parsed==='object'&&!Array.isArray(parsed);}catch{return false;}}
  return !/[\u0000-\u001f]/.test(value);
 };
 function post(type,status){try{if(win.parent&&win.parent!==win)win.parent.postMessage({type,...(status?{status}:{})},win.location.origin);}catch{}}
 function show(kind,text){
  if(!doc)return;
  doc.documentElement.dataset.officeCrm=kind;
  let style=doc.getElementById('officeCrmVisibility');
  if(!style){style=doc.createElement('style');style.id='officeCrmVisibility';style.textContent='html:not([data-office-crm="ready"]) body>:not(#officeCrmStatus){display:none!important}#officeCrmStatus{font:16px Segoe UI,Arial,sans-serif;padding:32px;color:#e8e8ed;background:#232428;min-height:100vh;box-sizing:border-box}html[data-office-crm="ready"] #officeCrmStatus{display:none!important}#inspector,#construction,#constructionPanel,#constructionInput,#customize{display:none!important}';doc.head.append(style);}
  if(!doc.body)return;
  let box=doc.getElementById('officeCrmStatus');
  if(!box){box=doc.createElement('div');box.id='officeCrmStatus';box.setAttribute('role','status');doc.body.prepend(box);}
  box.textContent=text||'';
 }
 function stopMedia(){
  try{env.presentation?.close?.();}catch{}
  for(const fn of ['aureonStopMicrophone','aureonStopCamera','aureonStopScreen'])try{const result=win[fn]?.();result?.catch?.(()=>{});}catch{}
  for(const fn of ['aureonAudioStream','aureonCameraStream','aureonScreenStream'])try{win[fn]?.()?.getTracks().forEach(track=>track.stop());}catch{}
  try{win.aureonReplicaCalls?.disconnectSession?.();}catch{}
 }
 function endSession(status){
  if(status!==401&&status!==403||endedStatus!==null)return;
  endedStatus=status;active=false;ready=false;pending.clear();local.clear();session.clear();
  if(timer)win.clearTimeout(timer);
  stopMedia();
  try{win.dispatchEvent(new win.CustomEvent('aureon-office-session-ended',{detail:{status}}));}catch{}
  show('expired','Sua sessão do escritório terminou. Volte ao CRM para entrar novamente.');
  post('aureon-office-session-ended',status);
 }
 function unavailable(){
  active=false;ready=false;stopMedia();show('unavailable','O escritório está temporariamente indisponível. Tente novamente pelo CRM.');
  post('aureon-office-unavailable');
 }

 function preferenceNotice(message){
  if(!doc?.body)return;
  let notice=doc.getElementById('officeCrmPreferenceNotice');
  if(!message){notice?.remove();return;}
  if(!notice){notice=doc.createElement('div');notice.id='officeCrmPreferenceNotice';notice.setAttribute('role','status');notice.style.cssText='position:fixed;right:20px;bottom:80px;z-index:20000;padding:12px;background:#292929;color:#fff;border:1px solid #777;border-radius:8px;font:14px Segoe UI,Arial,sans-serif';doc.body.append(notice);}
  notice.replaceChildren();
  const text=doc.createElement('span');text.textContent='Preferências não salvas. ';
  const retry=doc.createElement('button');retry.type='button';retry.textContent='Tentar novamente';retry.onclick=()=>flush();
  notice.append(text,retry);
 }
 async function fetchWithDeadline(url,options){
  const Controller=env.AbortController||win.AbortController;
  if(!Controller)return fetch(url,options);
  const controller=new Controller(),deadline=win.setTimeout(()=>controller.abort(),15000);
  try{return await fetch(url,{...options,signal:controller.signal});}
  catch(error){if(error?.name==='AbortError')throw Object.assign(Error('O serviço do escritório demorou para responder.'),{status:503});throw error;}
  finally{win.clearTimeout(deadline);}
 }

 function headers(){
  if(!active||!identity)throw Object.assign(Error('Escritório indisponível.'),{status:endedStatus||503});
  return {'X-Aureon-Office-Account':identity.accountId,'X-Aureon-Office-User':identity.user.id};
 }
 async function checked(response){
  if(response.status===401||response.status===403&&(await response.clone().json().catch(()=>({}))).code==='OFFICE_ACCESS_DENIED'){endSession(response.status);throw Object.assign(Error('Sessão do escritório encerrada.'),{status:response.status});}
  return response;
 }
 function queue(key,value){
  pending.set(key,value);
  if(timer)win.clearTimeout(timer);
  timer=win.setTimeout(()=>{timer=null;flush().catch(()=>{});},250);
 }
 async function flush(){
  if(flushing)return flushing;
  if(!active||!pending.size)return false;
  const entries=Object.fromEntries(pending);
  const request=(async()=>{
   try{
    const response=await checked(await fetchWithDeadline('/api/office/interface/client-state',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',...headers()},body:JSON.stringify({entries})}));
    if(!response.ok)throw Object.assign(Error('Não foi possível salvar suas preferências.'),{status:response.status});
    for(const[key,value]of Object.entries(entries))if(pending.get(key)===value)pending.delete(key);
    lastSaveError=null;preferenceNotice(null);return true;
   }catch(error){lastSaveError=error;if(active)preferenceNotice(error.message);return false;}
  })();
  flushing=request;
  try{return await request;}finally{if(flushing===request)flushing=null;if(active&&pending.size&&!lastSaveError)queueNext();}
 }
 function queueNext(){if(timer)win.clearTimeout(timer);timer=win.setTimeout(()=>{timer=null;flush().catch(()=>{});},250);}
 function facade(store,isLocal){
  return Object.freeze({
   get length(){return store.size;},
   key(index){return [...store.keys()][index]??null;},
   getItem(key){key=String(key);if(denied(key))return null;return store.get(key)??null;},
   setItem(key,value){
    key=String(key);value=String(value);
    if(!active||denied(key)||key.length>200)return;
    if(isLocal&&(key==='aurion-office-v1'||key==='aureon-office-construction-v1'))return;
    if(isLocal&&Object.hasOwn(limits,key)){if(!valid(key,value))throw Error('Preferência inválida.');store.set(key,value);queue(key,value);return;}
    if(bytes(value)>1048576)throw Error('Preferência temporária muito grande.');
    store.set(key,value);
   },
   removeItem(key){key=String(key);if(!active||denied(key)||isLocal&&(key==='aurion-office-v1'||key==='aureon-office-construction-v1'))return;store.delete(key);if(isLocal&&Object.hasOwn(limits,key))queue(key,null);},
   clear(){for(const key of [...store.keys()])this.removeItem(key);},
  });
 }
 const localStorage=facade(local,true),sessionStorage=facade(session,false);
 function reportStartupFailure(stage,error){
  let status=0;
  try{const value=Object.getOwnPropertyDescriptor(error,'status')?.value;if(Number.isInteger(value)&&[400,401,403,404,405,409,413,415,429,503].includes(value))status=value;}catch{}
  const safeStage=['bootstrap','scripts','interface'].includes(stage)?stage:'bootstrap';
  const cause=safeStage==='scripts'&&['timeout','load','execution'].includes(scriptFailureCause)?scriptFailureCause:'unknown';
  try{win.console?.error?.('Aureon office startup failed '+JSON.stringify({stage:safeStage,cause,status}));}catch{}
 }
 function loadScript(src){
  scriptFailureCause='unknown';
  return new Promise((resolve,reject)=>{
   let script=null,onError=null,deadline=null,settled=false;
   const cleanup=()=>{
    if(deadline!==null){win.clearTimeout(deadline);deadline=null;}
    if(onError)win.removeEventListener('error',onError);
    if(script){script.onload=null;script.onerror=null;}
   };
   const finish=error=>{
    if(settled)return;settled=true;cleanup();
    if(error){script?.remove();reject(error);}else resolve();
   };
   const failed=cause=>{if(settled)return;scriptFailureCause=cause;finish(Error('Não foi possível abrir o escritório. Tente novamente pelo CRM.'));};
   deadline=win.setTimeout(()=>failed('timeout'),45000);
   if(env.loadScript){
    try{Promise.resolve(env.loadScript(src)).then(()=>finish(),()=>failed('load'));}catch{failed('execution');}
    return;
   }
   try{
    script=doc.createElement('script');script.src=src;script.async=false;
    onError=event=>{if(event.filename===new win.URL(src,win.location.href).href)failed('execution');};
    win.addEventListener('error',onError);
    script.onload=()=>finish();script.onerror=()=>failed('load');doc.body.append(script);
   }catch{failed('load');}
  });
 }
 async function start(scripts){
  if(started)throw Error('Inicialização duplicada.');
  started=true;show('loading','Carregando seu escritório…');
  let stage='bootstrap';
  try{
   const response=await checked(await fetchWithDeadline('/api/office/bootstrap',{credentials:'same-origin',cache:'no-store'}));
   if(!response.ok)throw Object.assign(Error('Escritório indisponível.'),{status:response.status});
   const data=await response.json(),id=data?.identity;
   const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
   if(!id||!uuid.test(id.accountId)||!uuid.test(id.user?.id)||!Array.isArray(data.map?.objects)||data.map.objects.length>5000||typeof data.map.floor!=='string')throw Error('Contexto do escritório inválido.');
   if(data.map.construction!==undefined&&!Array.isArray(data.map.construction))throw Error('Construção inválida.');
   identity=clone(id);Object.freeze(identity.user);Object.freeze(identity);
   win.aureonCrmIdentity=Object.freeze({userId:identity.user.id,name:identity.user.name,accountId:identity.accountId});
   map=clone(data.map);active=true;
   local.set('aurion-office-v1',JSON.stringify({objects:map.objects,floor:map.floor}));
   if(map.construction)local.set('aureon-office-construction-v1',JSON.stringify(map.construction));
   for(const[key,value]of Object.entries(data.clientState||{}))if(valid(key,value))local.set(key,value);
   if(doc?.readyState==='loading')await new Promise(resolve=>doc.addEventListener('DOMContentLoaded',resolve,{once:true}));
   show('loading','Carregando seu escritório…');
   stage='scripts';
   env.presentation?.prepareInput?.();
   for(const src of scripts){
    if(!active)throw Object.assign(Error('Sessão encerrada.'),{status:401});
    if(!/^\/api\/office\/runtime\/[a-zA-Z0-9_-]+\.js$/.test(src))throw Error('Módulo inválido.');
    await loadScript(src);
   }
   stage='interface';
   if(win.aureonReplicaUI?.ready)await win.aureonReplicaUI.ready;
   if(!active)return false;
   if(win.aureonReplicaUI?.refresh)await win.aureonReplicaUI.refresh(true);
   if(!active)return false;
   env.presentation?.start?.();
   ready=true;show('ready','');post('aureon-office-ready');return true;
  }catch(error){reportStartupFailure(stage,error);if(endedStatus===null)unavailable();return false;}
 }
 const api=Object.freeze({start,localStorage,sessionStorage,headers,endSession,flush,
  get active(){return active;},get sessionStatus(){return endedStatus;},get ready(){return ready;},get identity(){return identity;},
  get storageNamespace(){return identity?'aureon-office:'+identity.accountId+':'+identity.user.id+':':'aureon-office:unavailable:';},
  get mapReadOnly(){return true;},approvedMap:()=>map?clone(map):null,
  get lastSaveError(){return lastSaveError?.message||null;},
 });
 win.aureonOfficeBootstrap=api;
 // Register before loading any module: later movement/seat handlers stop propagation.
 for(const type of ['pointerdown','keydown'])win.addEventListener?.(type,event=>{
  if(active&&identity)win.aureonInterfaceBridge?.recordActivity?.(event);
 },{capture:true,passive:true});
 for(const type of ['click','keydown','pointerdown','change'])win.addEventListener?.(type,event=>{if(started&&!active){event.preventDefault();event.stopImmediatePropagation();}},true);
 return api;
}

function guard(file,reason){throw Error('Office CRM ['+file+']: '+reason);}
function replace(file,text,before,after,count=1){const found=text.split(before).length-1;if(found!==count)guard(file,'expected '+count+' anchor(s), found '+found+': '+before.slice(0,100));return text.split(before).join(after);}
function hash(text){return createHash('sha256').update(text).digest('hex');}
export function bootstrapIndex(source){
 const scripts=[];let redirects=0;
 const html=source.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,(tag,attrs,body)=>{
  const src=/\bsrc=(["'])([^"']+)\1/.exec(attrs);
  if(src){
   if(body.trim()||/\b(?:async|defer|type)\b/.test(attrs))guard('index.html','unexpected script attributes/body');
   const name=src[2].startsWith('/api/office/runtime/')?src[2].slice('/api/office/runtime/'.length):src[2];
   if(!/^[a-zA-Z0-9_-]+\.js$/.test(name))guard('index.html','unexpected module URL');
   scripts.push('/api/office/runtime/'+name);return '';
  }
  if(hash(body)!=='93121a0c31ab1fb619bc68d72543aeec2a29862f6cb6eaaee9ff6a6c8db8e330')guard('index.html','unreviewed inline script');
  redirects++;return '';
 });
 if(redirects>1||!scripts.length)guard('index.html','missing/duplicate script list');
 if(!/<\/head>/i.test(html))guard('index.html','head missing');
 const code='\nconst aureonOfficePresentation=('+createOfficePresentation.toString()+')({window,document});\nconst aureonOfficeCrmRuntime=('+createOfficeCrmRuntime.toString()+')({window,document,fetch:window.fetch.bind(window),presentation:aureonOfficePresentation},'+JSON.stringify(CLIENT_STATE_LIMITS)+');\nconst localStorage=aureonOfficeCrmRuntime.localStorage;\nconst sessionStorage=aureonOfficeCrmRuntime.sessionStorage;\naureonOfficeCrmRuntime.start('+JSON.stringify(scripts)+');\n';
 return {text:html.replace(/<\/head>/i,'<script>'+code+'</script></head>'),changes:[{rule:'crm-bootstrap-before-modules',occurrences:scripts.length},{rule:'screen-presentation-mini-expanded-fullscreen',occurrences:1},{rule:'remove-localhost-redirect',occurrences:redirects}]};
}
export function adaptOfficeCrm(file,source){
 let text=source;const changes=[];
 if(file==='index.html')return bootstrapIndex(source);
 if(file==='replica-ui.js'){
  text=replace(file,text,"token:sessionStorage.getItem(sessionKey)||localStorage.getItem(sessionKey)||(browserProfile==='principal'?sessionStorage.getItem('aureon-interface-session'):'')||''","token:''");
  text=replace(file,text,"if(polling||!state.token)return;","if(polling||!window.aureonOfficeBootstrap.active)return;");
  text=replace(file,text,"headers:{'Content-Type':'application/json',...(state.token?{Authorization:'Bearer '+state.token}:{})}","credentials:'same-origin',headers:{'Content-Type':'application/json',...window.aureonOfficeBootstrap.headers()}");
  text=replace(file,text,"  async function api(endpoint,body,query,signal) {","  async function api(endpoint,body,query,signal) {\n    if(!window.aureonOfficeBootstrap.active)throw Object.assign(Error('Escritório indisponível.'),{status:window.aureonOfficeBootstrap.sessionStatus||503});if(endpoint==='session')throw Object.assign(Error('Cadastro local indisponível.'),{status:403});");
  text=replace(file,text,"    let result;try{result=await response.json()}","    if(response.status===401||response.status===403&&(await response.clone().json().catch(()=>({}))).code==='OFFICE_ACCESS_DENIED'){state.data=null;window.aureonOfficeBootstrap.endSession(response.status);throw Object.assign(Error('Sessão do escritório encerrada.'),{status:response.status});}\n    let result;try{result=await response.json()}");
  text=replace(file,text,"throw error;}return result;","throw error;}if(endpoint==='state'&&result?.user?.id!==window.aureonOfficeBootstrap.identity.user.id){state.data=null;window.aureonOfficeBootstrap.endSession(403);throw Object.assign(Error('O usuário do escritório mudou.'),{status:403});}return result;");
  const start=text.indexOf('  async function init(){'),end=text.indexOf('\n  init();',start),old=text.slice(start,end);
  if(start<0||end<0||hash(old)!=='be5bd550ea4643147f8682e448268055ccd0455e73bb6f28ea82d7564f8afd51')guard(file,'original init changed');
  const init="  async function init(){try{if(!window.aureonOfficeBootstrap.active)throw Object.assign(Error('Escritório indisponível.'),{status:window.aureonOfficeBootstrap.sessionStatus||503});await refresh(true);loadDrafts();await followMessageLink();await presenceSync.heartbeat();}catch(error){if(error.status===401||error.code==='OFFICE_ACCESS_DENIED')window.aureonOfficeBootstrap.endSession(error.status);else toast(error.message);throw error;}setInterval(async()=>{if(window.aureonOfficeBootstrap.active&&state.data){try{await presenceSync.heartbeat();await refresh();}catch{}}},5000);}";
  text=text.slice(0,start)+init+text.slice(end);
  text=replace(file,text,'\n  init();','\n  window.aureonReplicaUI.ready=init();window.aureonReplicaUI.ready.catch(()=>{});');

  if(text.includes('  function editProfile(){')){
   text=replace(file,text,"await api('profile',{name:form.elements.name.value,bio:form.elements.bio.value})","await api('profile',{bio:form.elements.bio.value})");
   text=replace(file,text,"addField(f,'Nome','name','text',state.data.user.name).required=true;","Object.assign(addField(f,'Nome','name','text',state.data.user.name),{required:true,readOnly:true});");
   text=replace(file,text,'O perfil desta sessão fica salvo neste escritório. A conta do CRM mantém sua própria identidade.','Nome e foto gerenciados pelo CRM.');
  }
  changes.push({rule:'crm-cookie-ui-init',occurrences:1});
 }
 if(file==='app.js'){
  const legacyStart='// Use the authenticated CRM profile, never a copied password.';
  const legacyEnd='// Unified open operational floor;';
  const start=text.indexOf(legacyStart),end=text.indexOf(legacyEnd,start);
  if(start<0||end<0||text.split(legacyStart).length!==2||text.split(legacyEnd).length!==2||
     hash(text.slice(start,end))!=='3611bec7f262acaeff7494082c5a9f615480d513b00512d0db09d20fcfd48dc5')
   guard(file,'legacy CRM identity block changed');
  text=text.slice(0,start)+text.slice(end);
  if(/http:\/\/localhost:3000|crm-identity-state|delete window\.aureonCrmIdentity|window\.aureonCrmIdentity=/.test(text))
   guard(file,'legacy CRM identity remained outside reviewed block');
  changes.push({rule:'remove-legacy-localhost-crm-identity',occurrences:1});
  text=replace(file,text," ['pointerdown','keydown'].forEach(type=>document.addEventListener(type,()=>{lastActivity=Date.now();if(autoAway){myStatus='online';autoAway=false;renderPeople();syncRoom()}},{passive:true}));","  function recordActivity(event){\n   if(!window.aureonOfficeBootstrap.active||!window.aureonOfficeBootstrap.identity)return;\n   lastActivity=Date.now();\n   if(event?.type==='keydown'&&(event.key==='Escape'||!editing&&!document.querySelector('dialog[open]')&&!event.target?.closest('input,textarea,select,[contenteditable=true]')&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','a','s','d','W','A','S','D'].includes(event.key)))window.aureonCancelSeatApproach?.();\n   if(autoAway){myStatus='online';autoAway=false;renderPeople();syncRoom()}\n  }");
  text=replace(file,text," setInterval(()=>{if(myStatus==='online'&&Date.now()-lastActivity>300000){myStatus='away';autoAway=true;renderPeople();syncRoom()}},15000);","  setInterval(()=>{if(window.aureonOfficeBootstrap.active&&window.aureonOfficeBootstrap.identity&&myStatus==='online'&&Date.now()-lastActivity>300000){myStatus='away';autoAway=true;renderPeople();syncRoom()}},15000);");
  text=replace(file,text,"window.aureonInterfaceBridge={pause:()=>officeStopMovement(),getPresence:","window.aureonInterfaceBridge={recordActivity,pause:()=>officeStopMovement(),getPresence:");
  changes.push({rule:'early-capture-real-input-activity-and-seat-cancel',occurrences:1});
  text=replace(file,text,"function openObject(o,arrived=false){const action=actionFor(o);if(!action)return;if(!arrived)window.aureonCancelSeatApproach?.();","function openObject(o,arrived=false){const action=actionFor(o);if(!action)return;if(!arrived)window.aureonCancelSeatApproach?.();if(action==='Abrir anotações'||action==='Abrir estação'){toast(action==='Abrir anotações'?'Anotações e desenhos do quadro estão em preparação no piloto.':'Personalização e anotações da estação estão em preparação no piloto.');return;}");
  changes.push({rule:'object-notes-and-station-editors-explicitly-unavailable',occurrences:1});
  if(!text.includes('let objects=Array.isArray(stored?.objects)?stored.objects:'))guard(file,'object state declaration changed');
  text=replace(file,text,'function editor(open){editing=open;','function editor(open){open=false;editing=false;');
  text=replace(file,text,'  active=value;start=null;movingWindow=null;','  active=false;value=false;start=null;movingWindow=null;');
  text=replace(file,text,"indexedDB.open('aureon-personal-sounds-v1',1)","indexedDB.open(window.aureonOfficeBootstrap.storageNamespace+'personal-sounds-v1',1)");
  text=replace(file,text,'function save(){localStorage.setItem(key,JSON.stringify(items));render()}','function save(){if(window.aureonOfficeBootstrap.mapReadOnly){const approved=window.aureonOfficeBootstrap.approvedMap().construction;if(approved)items=JSON.parse(JSON.stringify(approved));render();return;}localStorage.setItem(key,JSON.stringify(items));render()}\n window.aureonCrmRestoreConstruction=()=>{const approved=window.aureonOfficeBootstrap.approvedMap().construction;if(approved){items=JSON.parse(JSON.stringify(approved));render();}};');
  text+="\n/* CRM pilot: restore server seed after legacy migrations; map writes are disabled. */\n(()=>{const restore=()=>{const approved=window.aureonOfficeBootstrap.approvedMap();objects=approved.objects;floor=approved.floor;editing=false;placing=null;selected=null;drag=null;window.aureonCrmRestoreConstruction?.();render();};save=restore;restore();})();\n";
  changes.push({rule:'readonly-map-restore-after-migrations',occurrences:1},{rule:'scoped-personal-sounds-db',occurrences:1});
 }
 if(file==='replica-calls.js'){
  text=replace(file,text,'if(ticking||!state.data)return;','if(ticking||!state.data||!window.aureonOfficeBootstrap.active)return;');
  text=replace(file,text,'if(error.status===403){disconnectSession();}','if(error.status===401||error.status===403){disconnectSession();}');
  text=replace(file,text,'function disconnectSession(){if(wasJoined){window.aureonStopMicrophone?.();window.aureonStopCamera?.();window.aureonStopScreen?.();}wasJoined=false;closeAll();}','function disconnectSession(){window.aureonStopMicrophone?.();window.aureonStopCamera?.();window.aureonStopScreen?.();testAudio?.getTracks().forEach(track=>track.stop());testAudio=null;testContext?.close().catch(()=>{});testContext=null;wasJoined=false;closeAll();}');
  text=replace(file,text,'const m=meeting();if(!m){disconnectSession();return;}','const m=meeting();if(!m){if(wasJoined)disconnectSession();return;}');
  text=replace(file,text,"window.addEventListener('aureon-interface-state',()=>{if(!meeting())disconnectSession();tick()});","window.addEventListener('aureon-interface-state',()=>{if(!meeting()&&wasJoined)disconnectSession();tick()});");
  text=replace(file,text,'window.aureonReplicaCalls={broadcastReaction,toggleHand};',"window.addEventListener('aureon-office-session-ended',disconnectSession);window.aureonReplicaCalls={broadcastReaction,toggleHand,disconnectSession};");
  changes.push({rule:'disconnect-media-on-expired-crm-session',occurrences:1},{rule:'preserve-local-capture-outside-active-calls',occurrences:2});
 }
 if(file==='replica-spotify.js'){
  text=replace(file,text,'const U=window.aureonReplicaUI;if(!U)return;',"const U=window.aureonReplicaUI;if(!U)return;window.aureonSpotify={open:()=>U.toast('Spotify indisponível no piloto.'),render:()=>{}};return;");
  changes.push({rule:'spotify-explicitly-disabled-pilot',occurrences:1});
 }
 if(file==='replica-smart-objects.js'){
  text=replace(file,text,"const token = window.aureonReplicaUI?.state.token;","const token = window.aureonOfficeBootstrap.active;");
  text=replace(file,text,"headers:{'Content-Type':'application/json',Authorization:'Bearer '+token}","credentials:'same-origin',headers:{'Content-Type':'application/json',...window.aureonOfficeBootstrap.headers()}");
  text=replace(file,text,'    let result; try { result = await response.json(); }',"    if(response.status===401||response.status===403&&(await response.clone().json().catch(()=>({}))).code==='OFFICE_ACCESS_DENIED'){window.aureonOfficeBootstrap.endSession(response.status);throw Object.assign(Error('Sessão encerrada.'),{status:response.status});}\n    let result; try { result = await response.json(); }");
  changes.push({rule:'smart-cookie-transport-without-bearer',occurrences:1});
 }

 if(file==='replica-profile-details.js'){
  text=replace(file,text,"await U.api('profile',{name,bio,timeZone,profilePhotoUrl:photo})","await U.api('profile',{bio,timeZone})");
  text=replace(file,text,"name.required=true;name.maxLength=80;","name.required=true;name.readOnly=true;name.title='Nome e foto gerenciados pelo CRM';name.maxLength=80;");
  text=replace(file,text,'photoSection.append(photoTitle,preview,input,remove,photoStatus);',"input.disabled=true;input.hidden=true;remove.disabled=true;remove.hidden=true;photoStatus.textContent='Nome e foto gerenciados pelo CRM.';photoSection.append(photoTitle,preview,input,remove,photoStatus);");
  changes.push({rule:'crm-managed-name-photo-readonly',occurrences:1});
 }
 return{text,changes};
}
