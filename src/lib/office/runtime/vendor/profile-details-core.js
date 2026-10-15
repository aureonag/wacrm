(function(host,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else host.aureonProfileDetailsCore=api;})(typeof window==='object'?window:globalThis,()=>{
 'use strict';
 function normalizeZone(value){if(value==='')return '';if(typeof value!=='string'||value.length>80||value.trim()!==value)throw Error('Fuso horário inválido.');try{new Intl.DateTimeFormat('pt-BR',{timeZone:value}).format(0);return value;}catch{throw Error('Fuso horário inválido.');}}
 function safeZone(value){try{return normalizeZone(value)||Intl.DateTimeFormat().resolvedOptions().timeZone;}catch{return Intl.DateTimeFormat().resolvedOptions().timeZone;}}
 function parts(timestamp,zone){const date=new Date(timestamp);if(!Number.isFinite(+date))throw Error('Data inválida.');const result={};for(const p of new Intl.DateTimeFormat('en-CA',{timeZone:safeZone(zone),year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date))if(p.type!=='literal')result[p.type]=p.value;return result;}
 function dayKey(timestamp,zone){const p=parts(timestamp,zone);return p.year+'-'+p.month+'-'+p.day;}
 function minutes(timestamp,zone){const p=parts(timestamp,zone);return Number(p.hour)*60+Number(p.minute);}
 function formatClock(timestamp,zone){return new Intl.DateTimeFormat('pt-BR',{timeZone:safeZone(zone),hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(timestamp));}
 function dayBounds(timestamp,zone){const time=+new Date(timestamp),key=dayKey(time,zone);function boundary(after){let low=time-172800000,high=time+172800000;while(low<high){const mid=Math.floor((low+high)/2),dateKey=dayKey(mid,zone);if(after?dateKey>key:dateKey>=key)high=mid;else low=mid+1;}return low;}return {start:boundary(false),end:boundary(true),key};}
 function zones(current=''){const result=new Set(['UTC']);try{for(const zone of Intl.supportedValuesOf('timeZone'))result.add(zone);}catch{for(const zone of ['America/Sao_Paulo','America/New_York','Europe/London','Asia/Tokyo'])result.add(zone);}try{if(normalizeZone(current))result.add(current);}catch{}return [...result].sort();}
 function zoneLabel(zone,timestamp=Date.now()){const normalized=safeZone(zone);let offset='';try{offset=new Intl.DateTimeFormat('en',{timeZone:normalized,timeZoneName:'shortOffset'}).formatToParts(timestamp).find(p=>p.type==='timeZoneName').value.replace('GMT','UTC');}catch{}return '('+offset+') '+normalized;}
 function profilePhoto(person){return typeof person?.profilePhotoUrl==='string'&&/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(person.profilePhotoUrl)&&person.profilePhotoUrl.length<=32000?person.profilePhotoUrl:'';}
 return {normalizeZone,safeZone,parts,dayKey,minutes,formatClock,dayBounds,zones,zoneLabel,profilePhoto};
});
