(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.aureonSpatialPublisherCore=api;})(typeof window!=='undefined'?window:this,function(){'use strict';
 function createPublisher({readState,readPosition,post,now=()=>Date.now(),intervalMs=200,heartbeatMs=5000}){
  let busy=false,lastUser=null,lastPoint=null,lastSent=-Infinity,nextAttempt=0;
  const eligible=s=>s?.capabilities?.spatialPresence===true&&s.user?.id&&s.active!==false&&['online','busy','away'].includes(s.user.status);
  const normalize=p=>{if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x< -1400||p.x>=3800||p.y< -1400||p.y>=3200)return null;const value={x:p.x,y:p.y};if(p.pose&&['down','up','left','right'].includes(p.pose.facing)&&typeof p.pose.seated==='boolean')value.pose={facing:p.pose.facing,seated:p.pose.seated,layout:p.pose.seated&&['cafe-sofa-v1','cafe-armchair-back-v1','cafe-dining-back-v1'].includes(p.pose.layout)?p.pose.layout:''};return value;};
  async function tick(){
   const state=readState();if(!eligible(state)){lastUser=null;lastPoint=null;lastSent=-Infinity;return {sent:false,reason:'inactive'};}
   if(busy)return {sent:false,reason:'pending'};const point=normalize(readPosition());if(!point)return {sent:false,reason:'invalid'};
   const time=now(),uid=state.user.id,signature=JSON.stringify(point),changed=uid!==lastUser||signature!==lastPoint;
   if(time<nextAttempt||time-lastSent<(changed?intervalMs:heartbeatMs))return {sent:false,reason:'throttled'};
   busy=true;try{const result=await post(point);const current=readState();if(eligible(current)&&current.user.id===uid){lastUser=uid;lastPoint=signature;lastSent=now();nextAttempt=0;}return {sent:true,result};}
   catch(error){nextAttempt=now()+2000;return {sent:false,reason:'error',status:error?.status||null};}finally{busy=false;}
  }
  function invalidate(){lastUser=null;lastPoint=null;lastSent=-Infinity;nextAttempt=0;}
  return {tick,invalidate};
 }
 return {createPublisher};
});
