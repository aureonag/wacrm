/* Persistent remote bodies, using each user's public visual recipe and approved art. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.aureonSpatialScene=api;if(root.document&&root.aureonReplicaUI&&root.aureonSpatialSceneCore)api.install(root);})(typeof window==='object'?window:{},function(){
 'use strict';
 function install(win){
  const U=win.aureonReplicaUI,reducedMotion=win.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true,scene=win.aureonSpatialSceneCore.createScene({durationMs:reducedMotion?0:500}),nodes=new Map(),ns='http://www.w3.org/2000/svg',outfits=new Map(),loads=new Set();let sequence=0,request=null,closed=false,libraryPromise=null,libraryAttempts=0,libraryRetryAt=0,libraryCancel=null,activeOutfits=new Set(),outfitQueue=[];
  const defaults={skin:'#f8d2b3',hair:'#343038',facial:'#343038',shirt:'#45434e',pants:'#5268d6',shoes:'#292530',hairStyle:'short',beardStyle:'full'};
  const make=(tag,attrs,parent)=>{const node=win.document.createElementNS(ns,tag);for(const [key,value]of Object.entries(attrs))node.setAttribute(key,value);parent.append(node);return node;};
  const localPath=path=>{if(typeof path!=='string')throw Error('Invalid image');if(/^assets\/[A-Za-z0-9_/-]+\.png$/.test(path)&&!path.includes('..'))return (win.aureonOfficeBootstrap?'/api/office/runtime/':'/')+path;const match=/^api\/avatar-composition\/(essentials|extras)\/([0-9a-f.-]+)\.png$/.exec(path);if(match&&match[2].split('.').every(id=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)))return (win.aureonOfficeBootstrap?'/api/office/':'/api/')+'avatar-composition/'+match[1]+'/'+match[2]+'.png';throw Error('Invalid image');};
  const currentOutfit=entry=>!closed&&outfits.get(entry.key)===entry;
  function releaseLoad(entry,cancel){const load=entry.load;if(!load)return;entry.load=null;loads.delete(load);win.clearTimeout(load.timer);load.image.onload=null;load.image.onerror=null;if(cancel)load.image.removeAttribute('src');}
  function discardOutfit(entry){releaseLoad(entry,true);entry.sheet=null;entry.frames.clear();entry.queued=false;}
  // Live recipes are pinned. The limit applies only to reusable departed outfits.
  function pruneOutfits(){let inactive=outfits.size-activeOutfits.size;for(const [key,entry]of outfits){if(inactive<=32)break;if(!activeOutfits.has(entry)){outfits.delete(key);discardOutfit(entry);inactive--;}}outfitQueue=outfitQueue.filter(entry=>currentOutfit(entry)&&entry.queued);}
  function queueOutfit(entry){if(!entry.outfit||entry.ready||entry.queued||entry.load||entry.attempts>=3||entry.failed&&win.performance.now()<entry.retryAt)return;entry.queued=true;outfitQueue.push(entry);}
  function pumpOutfits(){if(closed)return;while(loads.size<6&&outfitQueue.length){const entry=outfitQueue.shift();entry.queued=false;if(!currentOutfit(entry)||!activeOutfits.has(entry))continue;
    const image=new win.Image(),load={image,timer:null};entry.load=load;entry.attempts++;entry.failed=false;loads.add(load);
    const finish=ok=>{if(!currentOutfit(entry)||entry.load!==load)return;const valid=ok&&image.naturalWidth===entry.outfit.files.essentials.width&&image.naturalHeight===entry.outfit.files.essentials.height;releaseLoad(entry,!valid);entry.ready=valid;entry.failed=!valid;if(valid)entry.sheet=image;else entry.retryAt=win.performance.now()+(entry.attempts===1?1000:4000);pumpOutfits();};
    image.onload=()=>finish(true);image.onerror=()=>finish(false);load.timer=win.setTimeout(()=>finish(false),15000);try{image.src=entry.path;}catch{finish(false);}
   }}
  function readLibrary(){if(libraryPromise)return libraryPromise;libraryAttempts++;const controller=new win.AbortController();libraryPromise=new Promise((resolve,reject)=>{let done=false,timer;
    const finish=(error,library)=>{if(done)return;done=true;win.clearTimeout(timer);libraryCancel=null;if(error){controller.abort();libraryPromise=null;libraryRetryAt=win.performance.now()+(libraryAttempts===1?1000:4000);reject(error);}else resolve(library);};
    libraryCancel=()=>finish(Error('Library cancelled'));timer=win.setTimeout(()=>finish(Error('Library timed out')),15000);
    Promise.resolve().then(()=>win.fetch((win.aureonOfficeBootstrap?'/api/office/runtime/':'/')+'assets/gather/avatar/native-library-manifest.json',{signal:controller.signal})).then(r=>{if(!r.ok)throw Error('Library unavailable');return r.json();}).then(library=>finish(null,library),error=>finish(error));
   });return libraryPromise;}
  function prepareOutfit(entry,selection){if(entry.outfit||entry.libraryPending||entry.attempts>=3||!libraryPromise&&(libraryAttempts>=3||win.performance.now()<libraryRetryAt))return;entry.libraryPending=true;
   readLibrary().then(library=>{if(!currentOutfit(entry))return;entry.libraryPending=false;try{const outfit=win.aureonGatherNativeLibrary.outfit(library,selection),path=localPath(outfit.files.essentials.path);entry.library=library;entry.outfit=outfit;entry.path=path;queueOutfit(entry);pumpOutfits();}catch{entry.failed=true;entry.attempts=3;}},()=>{if(currentOutfit(entry)){entry.libraryPending=false;entry.failed=true;}});
  }
  function nativeOutfit(selection){const key=JSON.stringify(selection);let entry=outfits.get(key);if(entry){outfits.delete(key);outfits.set(key,entry);}else{entry={key,ready:false,failed:false,frames:new Map(),load:null,queued:false,attempts:0,retryAt:0,libraryPending:false};outfits.set(key,entry);}activeOutfits.add(entry);prepareOutfit(entry,selection);queueOutfit(entry);return entry;
  }
  function bodyImage(value,actor){
   if(value.appearance?.native&&win.aureonGatherAvatarSelection&&win.aureonGatherNativeLibrary&&win.aureonGatherSceneFrames){const selection=actor.nativeSelection||(actor.nativeSelection=win.aureonGatherAvatarSelection.sanitize(win.aureonGatherAvatarCatalog,value.appearance.native)),entry=nativeOutfit(selection);if(entry.ready){const pose=win.aureonGatherSceneFrames.pose(entry.library,{facing:value.facing,moving:!reducedMotion&&value.moving,seated:value.seated,layout:value.layout},reducedMotion?(value.seated?1e6:0):value.moving?value.motionElapsed:value.poseElapsed);let uri=entry.frames.get(pose.frame);if(!uri){const rect=win.aureonGatherNativeLibrary.frameRect(entry.outfit.files.essentials,pose.frame),canvas=win.document.createElement('canvas');canvas.width=32;canvas.height=64;const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.drawImage(entry.sheet,rect.x,rect.y,32,64,0,0,32,64);uri=canvas.toDataURL('image/png');entry.frames.set(pose.frame,uri);}return {uri,...pose.geometry,kind:'native',animation:pose.animation,frame:pose.frame};}}
   const options={...defaults,...value.appearance?.legacy},frame=!reducedMotion&&value.moving?Math.floor(value.motionElapsed/100)%6:null,uri=win.aureonAvatarCompositor?.composeRemote?.(value.facing,options,frame);return uri?{uri,x:-20-1/3,y:-79-1/3,width:122/3,height:257/3,kind:'approved',animation:frame===null?'idle':'walk',frame}:null;
  }
  function create(){
   const node=win.document.createElementNS(ns,'g');node.setAttribute('data-person','remote-'+(++sequence));node.setAttribute('data-spatial-remote','true');node.setAttribute('pointer-events','none');node.setAttribute('role','img');
   make('ellipse',{cx:0,cy:0,rx:16,ry:5,fill:'#11152455'},node);
   const fallback=make('g',{'data-remote-body-fallback':'true'},node);make('rect',{x:-11,y:-34,width:10,height:31,fill:'#5268d6'},fallback);make('rect',{x:1,y:-34,width:10,height:31,fill:'#5268d6'},fallback);make('rect',{x:-15,y:-57,width:30,height:30,rx:3,fill:'#45434e'},fallback);make('rect',{x:-13,y:-77,width:26,height:25,rx:4,fill:'#f8d2b3'},fallback);make('rect',{x:-14,y:-79,width:28,height:9,fill:'#343038'},fallback);
   const image=make('image',{'data-remote-avatar':'true',visibility:'hidden',preserveAspectRatio:'none',style:'image-rendering:auto'},node);
   const plate=make('rect',{x:-40,y:-108,width:80,height:21,rx:5,fill:'#242329'},node);
   const label=make('text',{x:0,y:-94,'text-anchor':'middle','font-size':11,'font-family':'Arial, sans-serif',fill:'#f4f2f7'},node);
   const status=make('circle',{cx:-34,cy:-98,r:4,fill:'#65c59c'},node);
   return {node,image,fallback,status,plate,label,signature:null,position:null,bodySignature:null,geometrySignature:null,appearanceSignature:null,nativeSelection:null};
  }
  function draw(time){
   if(closed)return;const map=win.document.getElementById('office'),values=scene.frame(time),live=new Set(values.map(value=>value.id));let depthChanged=false;activeOutfits=new Set();
   for(const [id,entry]of nodes)if(!live.has(id)){entry.node.remove();nodes.delete(id);depthChanged=true;}
   if(map)for(const value of values){
    let entry=nodes.get(value.id);if(!entry){entry=create();nodes.set(value.id,entry);}
    if(entry.node.parentNode!==map){map.append(entry.node);depthChanged=true;}
    const position=value.x+','+value.y;if(entry.position!==position){entry.node.setAttribute('transform','translate('+value.x+','+value.y+')');entry.node.setAttribute('data-foot-x',value.x);entry.node.setAttribute('data-foot-y',value.y);entry.position=position;depthChanged=true;}
    const appearanceSignature=JSON.stringify(value.appearance);if(entry.appearanceSignature!==appearanceSignature){entry.image.setAttribute('visibility','hidden');entry.fallback.setAttribute('visibility','visible');entry.bodySignature=null;entry.appearanceSignature=appearanceSignature;entry.nativeSelection=null;}
    // One bad/unavailable appearance must not stop every colleague's animation loop.
    let body=null;try{body=bodyImage(value,entry);entry.node.removeAttribute('data-remote-body-error');}catch{entry.node.setAttribute('data-remote-body-error','unavailable');}
    const geometrySignature=body&&[body.x,body.y,body.width,body.height].join(',');if(body&&(entry.bodySignature!==body.uri||entry.geometrySignature!==geometrySignature)){for(const key of ['x','y','width','height'])entry.image.setAttribute(key,body[key]);entry.image.setAttribute('href',body.uri);entry.image.setAttribute('visibility','visible');entry.fallback.setAttribute('visibility','hidden');entry.node.setAttribute('data-remote-body',body.kind);entry.bodySignature=body.uri;entry.geometrySignature=geometrySignature;}
    entry.node.setAttribute('data-facing',value.facing);entry.node.setAttribute('data-moving',String(value.moving));entry.node.setAttribute('data-seated',String(value.seated));if(body){entry.node.setAttribute('data-remote-animation',body.animation);entry.node.setAttribute('data-remote-frame',String(body.frame??''));}
    const signature=JSON.stringify([value.name,value.status,value.areaName,value.seated]);if(entry.signature!==signature){entry.label.textContent=value.name;entry.status.setAttribute('fill',value.status==='busy'?'#dd6f77':value.status==='away'?'#e0b94f':'#65c59c');entry.node.setAttribute('aria-label',value.name+' · '+({busy:'Ocupado',away:'Ausente'}[value.status]||'Disponível')+(value.areaName?' · '+value.areaName:'')+(value.seated?' · Sentado':''));const width=Math.max(80,Array.from(value.name).length*7+30);entry.plate.setAttribute('x',-width/2);entry.plate.setAttribute('width',width);entry.status.setAttribute('cx',-width/2+9);entry.signature=signature;}
   }
   pruneOutfits();pumpOutfits();if(depthChanged)win.aureonRefreshSpatialDepth?.();request=win.requestAnimationFrame(draw);
  }
  let seenUser=null;
  const update=()=>{const data=U.state.data;if(data?.capabilities?.spatialSnapshots===true){if(seenUser!==data.user?.id){scene.observe({...data,users:[]},win.performance.now());seenUser=data.user?.id;}return;}seenUser=data?.user?.id;scene.observe(data,win.performance.now());};
  const spatialUpdate=event=>{const data=event.detail;if(data?.user?.id!==U.state.data?.user?.id||U.state.data?.capabilities?.spatialSnapshots!==true)return;seenUser=data.user.id;scene.observe(data,win.performance.now());};
  win.addEventListener('aureon-interface-state',update);win.addEventListener('aureon-spatial-state',spatialUpdate);update();request=win.requestAnimationFrame(draw);
  const stop=()=>{closed=true;win.cancelAnimationFrame(request);win.removeEventListener('aureon-interface-state',update);win.removeEventListener('aureon-spatial-state',spatialUpdate);win.removeEventListener('pagehide',stop);libraryCancel?.();for(const entry of nodes.values())entry.node.remove();nodes.clear();for(const entry of outfits.values())discardOutfit(entry);outfits.clear();activeOutfits.clear();outfitQueue=[];};win.addEventListener('pagehide',stop,{once:true});return {stop};
 }
 return {install};
});
