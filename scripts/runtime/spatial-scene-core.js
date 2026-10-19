(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.aureonSpatialSceneCore=api;})(typeof window!=='undefined'?window:this,function(){
 'use strict';
 const validPoint=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=-1400&&p.x<3800&&p.y>=-1400&&p.y<3200&&p.floorId==='office-1'&&Number.isFinite(p.updatedAt)&&p.updatedAt>=0;
 const portrait=value=>typeof value==='string'&&value.length<=32000&&/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)?value:'';
 const initials=name=>(name.match(/[\p{L}\p{N}]+/gu)||['?']).slice(0,2).map(word=>Array.from(word)[0]).join('').toLocaleUpperCase('pt-BR');
 const pose=value=>value&&['down','up','left','right'].includes(value.facing)&&typeof value.seated==='boolean'?{facing:value.facing,seated:value.seated,layout:value.seated&&['cafe-sofa-v1','cafe-armchair-back-v1','cafe-dining-back-v1'].includes(value.layout)?value.layout:''}:null;
 function createScene({durationMs=200,staleMs=20000}={}){
  if(!Number.isFinite(durationMs)||durationMs<0||!Number.isFinite(staleMs)||staleMs<=0)throw Error('Intervalo espacial inválido.');
  let records=new Map(),lastObserved=-Infinity,selfId=null;
  function point(record,time){const t=durationMs===0?1:Math.max(0,Math.min(1,(time-record.started)/durationMs));return {x:record.from.x+(record.to.x-record.from.x)*t,y:record.from.y+(record.to.y-record.from.y)*t};}
  function observe(state,time){
   if(!Number.isFinite(time))return;
   if(state?.capabilities?.spatialPresence!==true||typeof state.user?.id!=='string'||!state.user.id){records.clear();selfId=null;lastObserved=-Infinity;return;}
   if(selfId!==state.user.id||time<lastObserved)records.clear();
   selfId=state.user.id;lastObserved=time;const next=new Map();
   for(const user of Array.isArray(state.users)?state.users:[]){
    const p=user?.spatialPosition,id=user?.id;
    if(typeof id!=='string'||!id||id===selfId||next.has(id)||user.archived||!['online','busy','away'].includes(user.status)||!validPoint(p))continue;
    const old=records.get(id),name=typeof user.name==='string'&&user.name.trim()?user.name.trim().slice(0,80):'Pessoa';
    // A slower response must not rewind an avatar after a newer snapshot arrived.
    if(old&&p.updatedAt<old.updatedAt){next.set(id,old);continue;}
    // A repeated roster refresh must not restart an interpolation already in progress.
    const unchanged=old&&old.to.x===p.x&&old.to.y===p.y;
    const areaName=typeof p.areaName==='string'?p.areaName.slice(0,80):'',current=old?point(old,time):{x:p.x,y:p.y},snap=!old||Math.hypot(current.x-p.x,current.y-p.y)>120;
    const explicit=pose(p.pose),dx=p.x-(old?.to.x??p.x),dy=p.y-(old?.to.y??p.y),facing=explicit?.facing||(Math.abs(dx)+Math.abs(dy)<.25?(old?.facing||'down'):Math.abs(dx)>Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'down':'up')),seated=explicit?.seated===true,layout=explicit?.layout||'';
    const moving=durationMs>0&&!snap&&!seated&&Math.hypot(current.x-p.x,current.y-p.y)>=.25;
    const motionStarted=unchanged?old.motionStarted:moving&&old?.moving&&time<old.started+durationMs?old.motionStarted:time;
    const poseStarted=old&&old.facing===facing&&old.seated===seated&&old.layout===layout?old.poseStarted:time;
    next.set(id,{appearance:user.avatarAppearance&&typeof user.avatarAppearance==='object'?user.avatarAppearance:null,facing,seated,layout,poseStarted,id,name,initials:initials(name),portrait:portrait(user.avatarUrl),status:user.status,areaName,updatedAt:p.updatedAt,from:unchanged?old.from:snap?{x:p.x,y:p.y}:current,to:{x:p.x,y:p.y},started:unchanged?old.started:time,moving:seated?false:unchanged?old.moving:moving,motionStarted});
   }
   records=next;
  }
  function frame(time){
   if(!Number.isFinite(time)||time<lastObserved||time-lastObserved>=staleMs){records.clear();return [];}
   return Array.from(records.values(),record=>({id:record.id,name:record.name,initials:record.initials,portrait:record.portrait,status:record.status,areaName:record.areaName,appearance:record.appearance,facing:record.facing,seated:record.seated,layout:record.layout,moving:record.moving&&time<record.started+durationMs,motionElapsed:Math.max(0,time-record.motionStarted),poseElapsed:Math.max(0,time-record.poseStarted),...point(record,time)}));
  }
  return {observe,frame};
 }
 return {createScene};
});
