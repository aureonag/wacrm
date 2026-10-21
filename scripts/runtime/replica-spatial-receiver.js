/* Poll positions separately; never replace users, chat or meeting state. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.aureonSpatialReceiver=api;if(root.document&&root.aureonReplicaUI&&root.aureonSpatialReceiverCore)api.install(root);})(typeof window==='object'?window:{},function(){
 'use strict';
 function install(win){
  const U=win.aureonReplicaUI,core=win.aureonSpatialReceiverCore;if(!U||!core)return;
  let closed=false,identity=null,lastSuccess=null,lastError=null,count=0,ownPosition=null,peers=0;
  const valid=user=>{const point=user?.spatialPosition;return user&&typeof user.id==='string'&&user.id&&!user.archived&&['online','busy','away'].includes(user.status)&&point&&point.floorId==='office-1'&&Number.isFinite(point.x)&&point.x>=-1400&&point.x<3800&&Number.isFinite(point.y)&&point.y>=-1400&&point.y<3200&&Number.isFinite(point.updatedAt)&&point.updatedAt>=0;};
  const report=result=>{if(closed)return;try{win.dispatchEvent(new win.CustomEvent('aureon-spatial-diagnostics',{detail:{result,at:lastSuccess,error:lastError||'none',count,ownPosition,peers}}));}catch{/* Diagnostics never affect polling. */}};
  const receiver=core.createReceiver({readState:()=>({...U.state.data,visible:win.document.visibilityState!=='hidden',view:U.state.view==='office'?'office':'hidden'}),now:()=>win.performance.now(),request:signal=>U.api('spatial-state',undefined,undefined,signal),onSnapshot:snapshot=>{
   if(closed)return;lastSuccess=win.performance.now();lastError=null;count++;const users=new Map(snapshot.users.filter(valid).map(user=>[user.id,user]));ownPosition=users.has(snapshot.user.id);peers=users.size-(ownPosition?1:0);
   win.dispatchEvent(new win.CustomEvent('aureon-spatial-state',{detail:snapshot}));report('received');
  }});
  const tick=async()=>{if(closed)return;const uid=U.state.data?.user?.id;if(identity!==uid){identity=uid;lastSuccess=null;lastError=null;count=0;ownPosition=null;peers=0;}const map=win.document.getElementById('office'),supported=U.state.data?.capabilities?.spatialSnapshots===true,value=!supported?'unavailable':win.document.visibilityState==='hidden'||U.state.view!=='office'?'paused':'available';if(map&&map.getAttribute('data-spatial-receiver')!==value)map.setAttribute('data-spatial-receiver',value);const result=await receiver.tick();if(closed)return;if(result.reason==='error')lastError=Number.isInteger(result.status)&&result.status>=400&&result.status<=599?String(result.status):'network-or-timeout';report(result.received?'received':result.reason);};
  const timer=win.setInterval(()=>tick().catch(()=>{}),200),stop=()=>{closed=true;win.clearInterval(timer);receiver.stop();};win.addEventListener('pagehide',stop,{once:true});return {stop};
 }
 return {install};
});
