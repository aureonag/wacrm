/* One focused interaction claims the virtual position; existing owners may keep it alive in background. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.aureonSpatialPresence=api;if(root.document&&root.aureonReplicaUI&&root.aureonSpatialPublisherCore)api.install(root);})(typeof window==='object'?window:{},function(){
 'use strict';
 function install(win){
  const U=win.aureonReplicaUI,instanceId=win.crypto?.randomUUID?.(),ownedMode=()=>U.state.data?.capabilities?.spatialOwnership===true;
  let closed=false,lease=null,leaseUser=null,diagnosticUser=null,publications=0,lastPublication=null,publicationError=null,publicationResult='waiting',received=null;
  const syncDiagnosticUser=uid=>{if(diagnosticUser!==uid){diagnosticUser=uid;publications=0;lastPublication=null;publicationError=null;publicationResult='waiting';received=null;}};
  const statusCode=value=>Number.isInteger(value)&&value>=400&&value<=599?String(value):'network-or-timeout';
  const elapsed=value=>value===null?null:Math.max(0,Math.floor(win.performance.now()-value));
  function showDiagnostics(ownerState){try{
   const map=win.document.getElementById('office');if(!map)return;
   const report={publicationResult,publicationAge:elapsed(lastPublication),publicationError:publicationError||'none',publications,ownership:ownerState,
    receiverResult:received?.result||'waiting',receiverAge:elapsed(received?.at??null),receiverError:received?.error||'none',snapshots:received?.count||0,
    ownPosition:received?.ownPosition===true?'present':received?.ownPosition===false?'absent':'unknown',peers:Number.isInteger(received?.peers)?received.peers:0};
   for(const [key,value]of Object.entries(report)){const attribute='data-spatial-diagnostic-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()),text=value===null?'unknown':String(value);if(map.getAttribute(attribute)!==text)map.setAttribute(attribute,text);}
   let box=win.document.getElementById('officeSpatialDiagnostics');if(!box){box=win.document.createElement('details');box.id='officeSpatialDiagnostics';box.setAttribute('aria-label','Conexão do mapa');box.style.cssText='position:absolute;left:16px;bottom:78px;z-index:34;max-width:min(380px,calc(100% - 96px));padding:8px 10px;border:1px solid var(--crm-border,#555);border-radius:8px;background:var(--crm-card,#292a2c);color:var(--crm-text,#eee);font:12px Arial,sans-serif';const summary=win.document.createElement('summary');summary.textContent='Conexão do mapa';box.append(summary);for(const name of ['publication','receiver','positions']){const line=win.document.createElement('div');line.setAttribute('data-spatial-diagnostic-line',name);line.style.cssText='margin-top:6px;line-height:1.4';box.append(line);}map.parentElement.append(box);}
   if(box.parentElement!==map.parentElement)map.parentElement.append(box);box.hidden=U.state.view!=='office';
   const age=ms=>ms===null?'ainda sem confirmação':ms>=20000?'última confirmação há '+Math.floor(ms/1000)+' s':'confirmada há '+Math.floor(ms/1000)+' s';
   const ownership={controlled:'controle nesta guia',conflict:'outra guia assumiu a posição; clique no mapa para retomar',available:'aguardando assumir a posição',paused:'guia sem controle ativo',unavailable:'controle indisponível'}[ownerState]||'aguardando controle';
   box.querySelector('[data-spatial-diagnostic-line="publication"]').textContent='Sua atualização: '+age(report.publicationAge)+' · '+ownership+(publicationError?' · falha '+publicationError:'')+'.';
   box.querySelector('[data-spatial-diagnostic-line="receiver"]').textContent='Recebimento: '+age(report.receiverAge)+(received?.error?' · falha '+received.error:'')+'.';
   box.querySelector('[data-spatial-diagnostic-line="positions"]').textContent=report.receiverAge===null?'Aguardando posições do servidor.':report.receiverAge>=20000?'As posições recebidas estão antigas; aguardando nova atualização.':report.ownPosition==='absent'?'Sua posição não veio na última atualização; '+report.peers+' colega(s) com posição recente.':'Sua posição '+(report.ownPosition==='present'?'presente':'ainda não confirmada')+'; '+report.peers+' colega(s) com posição recente.';
  }catch{/* Diagnostics must never interrupt position publication. */}}
  const onDiagnostics=event=>{const value=event.detail;if(closed||!value||!['waiting','received','error','inactive','pending','throttled','stale'].includes(value.result))return;syncDiagnosticUser(U.state.data?.user?.id);received={result:value.result,at:Number.isFinite(value.at)&&value.at>=0?value.at:null,error:value.error==='none'?null:/^(?:[45][0-9]{2}|network-or-timeout)$/.test(value.error)?value.error:null,count:Number.isSafeInteger(value.count)&&value.count>=0?value.count:0,ownPosition:typeof value.ownPosition==='boolean'?value.ownPosition:null,peers:Number.isSafeInteger(value.peers)&&value.peers>=0?value.peers:0};};
  win.addEventListener('aureon-spatial-diagnostics',onDiagnostics);
  const focused=()=>win.document.visibilityState!=='hidden'&&win.document.hasFocus()&&U.state.view==='office';
  const control=instanceId&&win.aureonSpatialControlCore?win.aureonSpatialControlCore.createControl({instanceId,readContext:()=>({userId:U.state.data?.user?.id,active:ownedMode()&&['online','busy','away'].includes(U.state.data?.user?.status),focused:focused()}),load:signal=>U.api('spatial-control',undefined,undefined,signal),send:(body,signal)=>U.api('spatial-presence',body,undefined,signal)}):null;
  const publisher=win.aureonSpatialPublisherCore.createPublisher({readState:()=>({...U.state.data,active:!ownedMode()||!!control&&!control.isSuspended()&&(control.owns()||focused())}),readPosition:()=>win.aureonReadSpatialPosition?.(),post:async point=>{if(!ownedMode())return U.api('spatial-presence',point);const uid=U.state.data?.user?.id;try{const result=await control.publish(point);if(!closed&&uid===U.state.data?.user?.id&&control.owns()&&!control.isSuspended()){lease={instanceId,expectedVersion:result.control.version};leaseUser=uid;}return result;}catch(error){lease=null;leaseUser=null;throw error;}}});
  const readLease=()=>!closed&&ownedMode()&&['online','busy','away'].includes(U.state.data?.user?.status)&&leaseUser===U.state.data?.user?.id&&control?.owns()&&!control.isSuspended()&&lease?{...lease}:null;
  win.aureonReadSpatialLease=readLease;
  const claim=force=>{if(ownedMode()&&focused()&&control?.requestClaim(force)){lease=null;leaseUser=null;publisher.invalidate();}};
  const onFocus=e=>{if(e.isTrusted)claim(true);};
  const onPointer=e=>{if(e.isTrusted&&e.target?.closest?.('#office'))claim(false);};
  const onKey=e=>{if(e.isTrusted&&['arrowup','arrowdown','arrowleft','arrowright','w','a','s','d'].includes((e.key||'').toLowerCase())&&!e.target?.closest?.('input,textarea,select,[contenteditable=true]'))claim(false);};
  win.addEventListener('focus',onFocus);win.document.addEventListener('pointerdown',onPointer);win.addEventListener('keydown',onKey);
  let previousUser=null,previousMode=false,previousActive=false;
  const tick=async()=>{const data=U.state.data,map=win.document.getElementById('office'),mode=ownedMode(),uid=data?.user?.id,activeStatus=['online','busy','away'].includes(data?.user?.status);
   if(uid!==previousUser||mode!==previousMode||activeStatus!==previousActive){control?.pause();lease=null;leaseUser=null;publisher.invalidate();previousUser=uid;previousMode=mode;previousActive=activeStatus;}
   syncDiagnosticUser(uid);
   const supported=data?.capabilities?.spatialPresence===true,value=supported?'available':'unavailable';if(map&&map.getAttribute('data-spatial-service')!==value)map.setAttribute('data-spatial-service',value);
   const ownerState=!mode?'unavailable':!control?'unavailable':control.isSuspended()?'conflict':control.owns()?'controlled':focused()?'available':'paused';if(map&&map.getAttribute('data-spatial-ownership')!==ownerState)map.setAttribute('data-spatial-ownership',ownerState);
   const result=await publisher.tick();if(closed||uid!==U.state.data?.user?.id)return;
   if(result.sent){publications++;lastPublication=win.performance.now();publicationError=null;publicationResult='sent';}else if(result.reason==='error'){publicationError=statusCode(result.status);publicationResult='error';}else if(['inactive','invalid','pending'].includes(result.reason))publicationResult=result.reason;
   const currentOwner=!mode?'unavailable':!control?'unavailable':control.isSuspended()?'conflict':control.owns()?'controlled':focused()?'available':'paused';showDiagnostics(currentOwner);
  };
  const timer=win.setInterval(()=>tick().catch(()=>{}),200);
  const stop=()=>{closed=true;lease=null;leaseUser=null;win.clearInterval(timer);control?.pause();win.removeEventListener('focus',onFocus);win.document.removeEventListener('pointerdown',onPointer);win.removeEventListener('keydown',onKey);win.removeEventListener('aureon-spatial-diagnostics',onDiagnostics);win.document.getElementById('officeSpatialDiagnostics')?.remove();};
  win.addEventListener('pagehide',stop,{once:true});return {stop};
 }
 return {install};
});
