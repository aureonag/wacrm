/* One focused interaction claims the virtual position; existing owners may keep it alive in background. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.aureonSpatialPresence=api;if(root.document&&root.aureonReplicaUI&&root.aureonSpatialPublisherCore)api.install(root);})(typeof window==='object'?window:{},function(){
 'use strict';
 function install(win){
  const U=win.aureonReplicaUI,instanceId=win.crypto?.randomUUID?.(),ownedMode=()=>U.state.data?.capabilities?.spatialOwnership===true;
  const focused=()=>win.document.visibilityState!=='hidden'&&win.document.hasFocus()&&U.state.view==='office';
  const control=instanceId&&win.aureonSpatialControlCore?win.aureonSpatialControlCore.createControl({instanceId,readContext:()=>({userId:U.state.data?.user?.id,active:ownedMode()&&['online','busy','away'].includes(U.state.data?.user?.status),focused:focused()}),load:signal=>U.api('spatial-control',undefined,undefined,signal),send:(body,signal)=>U.api('spatial-presence',body,undefined,signal)}):null;
  const publisher=win.aureonSpatialPublisherCore.createPublisher({readState:()=>({...U.state.data,active:!ownedMode()||!!control&&!control.isSuspended()&&(control.owns()||focused())}),readPosition:()=>win.aureonReadSpatialPosition?.(),post:point=>ownedMode()?control.publish(point):U.api('spatial-presence',point)});
  const claim=force=>{if(ownedMode()&&focused()&&control?.requestClaim(force))publisher.invalidate();};
  const onFocus=e=>{if(e.isTrusted)claim(true);};
  const onPointer=e=>{if(e.isTrusted&&e.target?.closest?.('#office'))claim(false);};
  const onKey=e=>{if(e.isTrusted&&['arrowup','arrowdown','arrowleft','arrowright','w','a','s','d'].includes((e.key||'').toLowerCase())&&!e.target?.closest?.('input,textarea,select,[contenteditable=true]'))claim(false);};
  win.addEventListener('focus',onFocus);win.document.addEventListener('pointerdown',onPointer);win.addEventListener('keydown',onKey);
  let previousUser=null,previousMode=false,previousActive=false;
  const tick=async()=>{const data=U.state.data,map=win.document.getElementById('office'),mode=ownedMode(),uid=data?.user?.id,activeStatus=['online','busy','away'].includes(data?.user?.status);
   if(uid!==previousUser||mode!==previousMode||activeStatus!==previousActive){control?.pause();publisher.invalidate();previousUser=uid;previousMode=mode;previousActive=activeStatus;}
   const supported=data?.capabilities?.spatialPresence===true,value=supported?'available':'unavailable';if(map&&map.getAttribute('data-spatial-service')!==value)map.setAttribute('data-spatial-service',value);
   const ownerState=!mode?'unavailable':!control?'unavailable':control.isSuspended()?'conflict':control.owns()?'controlled':focused()?'available':'paused';if(map&&map.getAttribute('data-spatial-ownership')!==ownerState)map.setAttribute('data-spatial-ownership',ownerState);
   await publisher.tick();
  };
  const timer=win.setInterval(()=>tick().catch(()=>{}),200);
  const stop=()=>{win.clearInterval(timer);control?.pause();win.removeEventListener('focus',onFocus);win.document.removeEventListener('pointerdown',onPointer);win.removeEventListener('keydown',onKey);};
  win.addEventListener('pagehide',stop,{once:true});return {stop};
 }
 return {install};
});
