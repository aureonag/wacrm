(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.aureonSpatialControlCore=api;})(typeof window!=='undefined'?window:this,function(){
 'use strict';
 function createControl({instanceId,readContext,load,send,timeoutMs=3000,makeController=()=>new AbortController(),schedule=setTimeout,unschedule=clearTimeout}){
  if(typeof instanceId!=='string'||!/^[-A-Za-z0-9_]{8,80}$/.test(instanceId)||!Number.isFinite(timeoutMs)||timeoutMs<=0)throw Error('Controle de posição inválido.');
  let version=null,needsClaim=true,forceClaim=true,owned=false,suspended=false,generation=0,identity=null,active=null,leaseExpiresAt=null;
  const conflict=()=>Object.assign(Error('Clique no mapa para retomar sua posição.'),{status:409});
  const eligible=c=>c&&typeof c.userId==='string'&&c.userId&&c.active!==false;
  const current=(context,g,controller)=>{const next=readContext();return generation===g&&active===controller&&eligible(next)&&next.userId===context.userId&&(owned||next.focused===true)&&!controller.signal.aborted;};
  const validVersion=value=>Number.isSafeInteger(value?.version)&&value.version>=0;
  function requestClaim(force=false){if(!force&&((owned&&!suspended)||needsClaim&&!suspended))return false;generation++;active?.abort();version=null;needsClaim=true;forceClaim=true;owned=false;suspended=false;leaseExpiresAt=null;return true;}
  function pause(){generation++;active?.abort();version=null;needsClaim=true;forceClaim=true;owned=false;suspended=false;identity=null;leaseExpiresAt=null;}
  async function publish(point){
   const context={...readContext()};if(!eligible(context)||suspended||(!owned&&context.focused!==true))throw conflict();
   if(identity!==context.userId){pause();identity=context.userId;}
   const g=generation,controller=makeController();active=controller;let rejectAbort;
   const aborted=new Promise((resolve,reject)=>{rejectAbort=()=>reject(Object.assign(Error('A publicação da posição demorou. Tentando novamente.'),{status:408}));controller.signal.addEventListener('abort',rejectAbort,{once:true});});
   const timer=schedule(()=>controller.abort(),timeoutMs),run=operation=>Promise.race([Promise.resolve().then(operation),aborted]);
   const check=()=>{if(controller.signal.aborted)throw Object.assign(Error('A publicação da posição foi cancelada.'),{status:408});if(!current(context,g,controller))throw conflict();};
   try{
    if(needsClaim){if(context.focused!==true)throw conflict();const control=await run(()=>load(controller.signal));check();if(!validVersion(control))throw Error('Versão de posição indisponível.');version=control.version;}
    // A trusted claim authorizes one takeover attempt. Uncertain responses and
    // automatic retries must never turn that old intent into another takeover.
    const takeControl=needsClaim&&forceClaim;forceClaim=false;let result;
    try{result=await run(()=>send({...point,instanceId,expectedVersion:version,takeControl},controller.signal));}
    catch(error){
     if(error?.status!==409)throw error;check();
     if(readContext().focused!==true)throw error;
     const fresh=await run(()=>load(controller.signal));check();
     if(!validVersion(fresh))throw Error('Versão de posição indisponível.');
     if(fresh.active!==false)throw error;
     // TTL eviction can increment the CAS version between GET and POST even
     // with one tab. Retry once, only with no active lease, without takeover.
     version=fresh.version;result=await run(()=>send({...point,instanceId,expectedVersion:version,takeControl:false},controller.signal));
    }
    check();
    if(!validVersion(result?.control)||result.control.active!==true)throw Error('Controle de posição indisponível.');
    version=result.control.version;needsClaim=false;owned=true;leaseExpiresAt=Number.isFinite(result.control.leaseExpiresAt)?result.control.leaseExpiresAt:null;return result;
   }catch(error){if(generation===g&&active===controller){owned=false;version=null;needsClaim=true;leaseExpiresAt=null;const next=readContext();if(error?.status===409&&!controller.signal.aborted&&eligible(next)&&next.userId===context.userId)suspended=true;}throw error;}
   finally{unschedule(timer);controller.signal.removeEventListener('abort',rejectAbort);if(active===controller)active=null;}
  }
  return {publish,requestClaim,pause,isSuspended:()=>suspended,owns:()=>owned,readLease:()=>({owned,leaseExpiresAt,suspended})};
 }
 return {createControl};
});
