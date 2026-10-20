(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.aureonSpatialReceiverCore=api;})(typeof window!=='undefined'?window:this,function(){
 'use strict';
 function createReceiver({readState,request,onSnapshot,now=()=>Date.now(),intervalMs=500,timeoutMs=3000,makeController=()=>new AbortController(),schedule=setTimeout,unschedule=clearTimeout}){
  if(!Number.isFinite(intervalMs)||intervalMs<500||!Number.isFinite(timeoutMs)||timeoutMs<=0)throw Error('Intervalo de consulta inválido.');
  let inflight=false,lastAttempt=-Infinity,nextAttempt=0,controller=null,identity=null,generation=0,closed=false;
  const eligible=s=>!closed&&s?.capabilities?.spatialPresence===true&&s.capabilities.spatialSnapshots===true&&typeof s.user?.id==='string'&&s.user.id&&s.visible!==false&&s.view!=='hidden';
  function reset(){generation++;controller?.abort();identity=null;lastAttempt=-Infinity;nextAttempt=0;}
  async function tick(){
   const state=readState();if(!eligible(state)){if(identity!==null||controller)reset();return {received:false,reason:'inactive'};}
   if(identity!==state.user.id){reset();identity=state.user.id;}
   if(inflight)return {received:false,reason:'pending'};
   const time=now();if(time<nextAttempt||time-lastAttempt<intervalMs)return {received:false,reason:'throttled'};
   inflight=true;lastAttempt=time;const uid=identity,version=generation,active=makeController();controller=active;const timer=schedule(()=>active.abort(),timeoutMs);
   try{
    const snapshot=await request(active.signal),current=readState();
    if(!eligible(current)||current.user.id!==uid||version!==generation||active.signal.aborted)return {received:false,reason:'stale'};
    if(snapshot?.userId!==uid||!Array.isArray(snapshot.users)||!Number.isFinite(snapshot.serverTime))throw Error('Posições indisponíveis.');
    onSnapshot({capabilities:{spatialPresence:true},user:{id:uid},users:snapshot.users});nextAttempt=0;return {received:true};
   }catch(error){if(version===generation)nextAttempt=now()+2000;return {received:false,reason:'error',status:error?.status||null};}
   finally{unschedule(timer);if(controller===active)controller=null;inflight=false;}
  }
  function stop(){closed=true;reset();}
  return {tick,stop};
 }
 return {createReceiver};
});
