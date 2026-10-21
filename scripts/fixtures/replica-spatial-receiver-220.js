/* Poll positions separately; never replace users, chat or meeting state. */
(()=>{'use strict';const U=window.aureonReplicaUI,core=window.aureonSpatialReceiverCore;if(!U||!core)return;
 const receiver=core.createReceiver({readState:()=>({...U.state.data,visible:document.visibilityState!=='hidden',view:U.state.view==='office'?'office':'hidden'}),now:()=>performance.now(),request:signal=>U.api('spatial-state',undefined,undefined,signal),onSnapshot:snapshot=>window.dispatchEvent(new CustomEvent('aureon-spatial-state',{detail:snapshot}))});
 const tick=async()=>{const map=document.getElementById('office'),supported=U.state.data?.capabilities?.spatialSnapshots===true,value=!supported?'unavailable':document.visibilityState==='hidden'||U.state.view!=='office'?'paused':'available';if(map&&map.getAttribute('data-spatial-receiver')!==value)map.setAttribute('data-spatial-receiver',value);await receiver.tick();};
 const timer=setInterval(()=>tick().catch(()=>{}),200);window.addEventListener('pagehide',()=>{clearInterval(timer);receiver.stop();},{once:true});
})();
