/* eslint-disable @typescript-eslint/no-require-imports -- Private CommonJS compatibility boundary. */
'use strict';
const {resolve}=require('./spatial-room-core.js');
const regions=[
 {name:'Recepção',x:848,y:1152,w:688,h:548},
 {name:'Operacional',x:80,y:100,w:2240,h:620},
 {name:'Operacional',x:80,y:100,w:2240,h:620,mergedInto:1},
 {name:'Sala de reunião',x:80,y:816,w:592,h:368},
 {name:'Reunião privativa 1',x:1744,y:816,w:288,h:368},
 {name:'Reunião privativa 2',x:2032,y:816,w:288,h:368},
 {name:'Café',x:1744,y:1344,w:576,h:356},
 {name:'Área pública',x:-1400,y:-1400,w:5200,h:4600,fallback:true},
 {name:'Sala de reunião 2',x:80,y:1184,w:592,h:516}
];
function validPoint(p){return p&&typeof p==='object'&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=-1400&&p.x<3800&&p.y>=-1400&&p.y<3200;}
function publicPose(value){
 if(value===undefined)return null;
 if(!value||typeof value!=='object'||Array.isArray(value)||!['down','up','left','right'].includes(value.facing)||typeof value.seated!=='boolean'||value.layout!==undefined&&!['','cafe-sofa-v1','cafe-armchair-back-v1','cafe-dining-back-v1'].includes(value.layout)){const error=Error('Pose virtual inválida.');error.status=400;throw error;}
 return {facing:value.facing,seated:value.seated,layout:value.seated?(value.layout||''):''};
}
function areaForPosition(point){if(!validPoint(point))return null;const id=resolve(regions,point);return id<0?null:{areaId:id,areaName:regions[id].name,floorId:'office-1'};}
function createSpatialPresence({now=()=>Date.now(),ttlMs=20000,leaseMs=7000,initialState=null}={}){
 if(!Number.isFinite(ttlMs)||ttlMs<=0||!Number.isFinite(leaseMs)||leaseMs<=0||leaseMs>ttlMs)throw new Error('Prazo de presença espacial inválido.');
 const records=new Map(initialState?.records||[]),leases=new Map(initialState?.leases||[]),versions=new Map(initialState?.versions||[]),active=u=>u&&typeof u.id==='string'&&u.id.length>0&&!u.archived&&['online','busy','away'].includes(u.status);
 const fail=(status,message)=>{const error=Error(message);error.status=status;throw error;},version=id=>versions.get(id)||0;
 const liveLease=(id,time)=>{const lease=leases.get(id);return lease&&time>=lease.started&&time<lease.until?lease:null;};
 function remove(id){const had=records.has(id)||leases.has(id);records.delete(id);leases.delete(id);if(had)versions.set(id,version(id)+1);}
 function options(id,value={}){
  const instance=value.instanceId;
  if(instance!==undefined&&(typeof instance!=='string'||!/^[-A-Za-z0-9_]{8,80}$/.test(instance)))fail(400,'Instância de posição inválida.');
  if(value.takeControl!==undefined&&typeof value.takeControl!=='boolean')fail(400,'Controle de posição inválido.');
  if(!instance){if(value.takeControl||value.expectedVersion!==undefined)fail(400,'Identifique a guia para assumir a posição.');return {instance:null,takeControl:false};}
  if(!Number.isSafeInteger(value.expectedVersion)||value.expectedVersion<0)fail(400,'Versão de posição inválida.');
  if(value.expectedVersion!==version(id))fail(409,'A posição mudou de guia. Clique no mapa para retomar.');
  return {instance,takeControl:value.takeControl===true};
 }
 function publish(user,point,value){
  if(!active(user))fail(403,'Entre no escritório para compartilhar sua posição.');
  const area=areaForPosition(point);if(!area)fail(400,'Posição virtual inválida.');
  const pose=publicPose(value?.pose),time=now(),choice=options(user.id,value),lease=liveLease(user.id,time);
  if(lease&&lease.instance!==choice.instance&&!choice.takeControl)fail(409,'Esta posição está sendo controlada por outra guia.');
  if(choice.instance){if(choice.takeControl||!lease||lease.instance!==choice.instance)versions.set(user.id,version(user.id)+1);leases.set(user.id,{instance:choice.instance,started:time,until:time+leaseMs});}
  else leases.delete(user.id);
  const record={x:point.x,y:point.y,...area,updatedAt:time,...(pose?{pose}:{})};records.set(user.id,record);return structuredClone(record);
 }
 function snapshot(user){
  const record=records.get(user?.id),age=record?now()-record.updatedAt:0;
  if(!active(user)||!record||age<0||age>=ttlMs){if(user?.id)remove(user.id);return null;}
  return structuredClone(record);
 }
 function control(user){snapshot(user);const lease=liveLease(user?.id,now());return {version:version(user?.id),active:!!lease,leaseExpiresAt:lease?.until||null};}
 function clear(user,value){const choice=options(user.id,value),lease=liveLease(user.id,now());if(lease&&lease.instance!==choice.instance)fail(409,'Outra guia controla a posição atual.');remove(user.id);}
 return {publish,snapshot,remove,control,clear,exportState:()=>structuredClone({records:[...records],leases:[...leases],versions:[...versions]})};
}
module.exports={createSpatialPresence,areaForPosition};
