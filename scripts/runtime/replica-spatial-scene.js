/* Persistent remote bodies, using each user's public visual recipe and approved art. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.aureonSpatialScene=api;if(root.document&&root.aureonReplicaUI&&root.aureonSpatialSceneCore)api.install(root);})(typeof window==='object'?window:{},function(){
 'use strict';
 function install(win){
  const U=win.aureonReplicaUI,scene=win.aureonSpatialSceneCore.createScene({durationMs:win.matchMedia?.('(prefers-reduced-motion: reduce)').matches?0:500}),nodes=new Map(),ns='http://www.w3.org/2000/svg',outfits=new Map();let sequence=0,request=null,closed=false,libraryPromise=null;
  const defaults={skin:'#f8d2b3',hair:'#343038',facial:'#343038',shirt:'#45434e',pants:'#5268d6',shoes:'#292530',hairStyle:'short',beardStyle:'full'};
  const make=(tag,attrs,parent)=>{const node=win.document.createElementNS(ns,tag);for(const [key,value]of Object.entries(attrs))node.setAttribute(key,value);parent.append(node);return node;};
  const localPath=path=>{if(typeof path!=='string')throw Error('Invalid image');if(/^assets\/[A-Za-z0-9_/-]+\.png$/.test(path)&&!path.includes('..'))return (win.aureonOfficeBootstrap?'/api/office/runtime/':'/')+path;const match=/^api\/avatar-composition\/(essentials|extras)\/([0-9a-f.-]+)\.png$/.exec(path);if(match&&match[2].split('.').every(id=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)))return (win.aureonOfficeBootstrap?'/api/office/':'/api/')+'avatar-composition/'+match[1]+'/'+match[2]+'.png';throw Error('Invalid image');};
  function nativeOutfit(plan){const key=JSON.stringify(plan);if(outfits.has(key))return outfits.get(key);const entry={ready:false,failed:false,frames:new Map()};outfits.set(key,entry);if(outfits.size>32)outfits.delete(outfits.keys().next().value);
   libraryPromise=libraryPromise||win.fetch((win.aureonOfficeBootstrap?'/api/office/runtime/':'/')+'assets/gather/avatar/native-library-manifest.json').then(r=>{if(!r.ok)throw Error('Library unavailable');return r.json();});
   libraryPromise.then(library=>{if(closed)return;const selection=win.aureonGatherAvatarSelection.sanitize(win.aureonGatherAvatarCatalog,plan),outfit=win.aureonGatherNativeLibrary.outfit(library,selection),image=new win.Image();entry.library=library;entry.outfit=outfit;image.onload=()=>{if(image.naturalWidth!==outfit.files.essentials.width||image.naturalHeight!==outfit.files.essentials.height){entry.failed=true;return;}entry.sheet=image;entry.ready=true;};image.onerror=()=>{entry.failed=true;};image.src=localPath(outfit.files.essentials.path);}).catch(()=>{entry.failed=true;});return entry;
  }
  function bodyImage(value){
   if(value.appearance?.native&&win.aureonGatherAvatarSelection&&win.aureonGatherNativeLibrary&&win.aureonGatherSceneFrames){const entry=nativeOutfit(value.appearance.native);if(entry.ready){const pose=win.aureonGatherSceneFrames.pose(entry.library,{facing:value.facing,moving:false,seated:false},0);let uri=entry.frames.get(pose.frame);if(!uri){const rect=win.aureonGatherNativeLibrary.frameRect(entry.outfit.files.essentials,pose.frame),canvas=win.document.createElement('canvas');canvas.width=32;canvas.height=64;const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.drawImage(entry.sheet,rect.x,rect.y,32,64,0,0,32,64);uri=canvas.toDataURL('image/png');entry.frames.set(pose.frame,uri);}return {uri,...pose.geometry,kind:'native'};}}
   const options={...defaults,...value.appearance?.legacy},uri=win.aureonAvatarCompositor?.composeRemote?.(value.facing,options);return uri?{uri,x:-20-1/3,y:-79-1/3,width:122/3,height:257/3,kind:'approved'}:null;
  }
  function create(){
   const node=win.document.createElementNS(ns,'g');node.setAttribute('data-person','remote-'+(++sequence));node.setAttribute('data-spatial-remote','true');node.setAttribute('pointer-events','none');node.setAttribute('role','img');
   make('ellipse',{cx:0,cy:0,rx:16,ry:5,fill:'#11152455'},node);
   const fallback=make('g',{'data-remote-body-fallback':'true'},node);make('rect',{x:-11,y:-34,width:10,height:31,fill:'#5268d6'},fallback);make('rect',{x:1,y:-34,width:10,height:31,fill:'#5268d6'},fallback);make('rect',{x:-15,y:-57,width:30,height:30,rx:3,fill:'#45434e'},fallback);make('rect',{x:-13,y:-77,width:26,height:25,rx:4,fill:'#f8d2b3'},fallback);make('rect',{x:-14,y:-79,width:28,height:9,fill:'#343038'},fallback);
   const image=make('image',{'data-remote-avatar':'true',visibility:'hidden',preserveAspectRatio:'none',style:'image-rendering:auto'},node);
   const plate=make('rect',{x:-40,y:-108,width:80,height:21,rx:5,fill:'#242329'},node);
   const label=make('text',{x:0,y:-94,'text-anchor':'middle','font-size':11,'font-family':'Arial, sans-serif',fill:'#f4f2f7'},node);
   const status=make('circle',{cx:-34,cy:-98,r:4,fill:'#65c59c'},node);
   return {node,image,fallback,status,plate,label,signature:null,position:null,bodySignature:null};
  }
  function draw(time){
   if(closed)return;const map=win.document.getElementById('office'),values=scene.frame(time),live=new Set(values.map(value=>value.id));let depthChanged=false;
   for(const [id,entry]of nodes)if(!live.has(id)){entry.node.remove();nodes.delete(id);depthChanged=true;}
   if(map)for(const value of values){
    let entry=nodes.get(value.id);if(!entry){entry=create();nodes.set(value.id,entry);}
    if(entry.node.parentNode!==map){map.append(entry.node);depthChanged=true;}
    const position=value.x+','+value.y;if(entry.position!==position){entry.node.setAttribute('transform','translate('+value.x+','+value.y+')');entry.node.setAttribute('data-foot-x',value.x);entry.node.setAttribute('data-foot-y',value.y);entry.position=position;depthChanged=true;}
    const body=bodyImage(value);if(body&&entry.bodySignature!==body.uri){for(const key of ['x','y','width','height'])entry.image.setAttribute(key,body[key]);entry.image.setAttribute('href',body.uri);entry.image.setAttribute('visibility','visible');entry.fallback.setAttribute('visibility','hidden');entry.node.setAttribute('data-remote-body',body.kind);entry.bodySignature=body.uri;}
    entry.node.setAttribute('data-facing',value.facing);
    const signature=JSON.stringify([value.name,value.status,value.areaName]);if(entry.signature!==signature){entry.label.textContent=value.name;entry.status.setAttribute('fill',value.status==='busy'?'#dd6f77':value.status==='away'?'#e0b94f':'#65c59c');entry.node.setAttribute('aria-label',value.name+' · '+({busy:'Ocupado',away:'Ausente'}[value.status]||'Disponível')+(value.areaName?' · '+value.areaName:''));const width=Math.max(80,Array.from(value.name).length*7+30);entry.plate.setAttribute('x',-width/2);entry.plate.setAttribute('width',width);entry.status.setAttribute('cx',-width/2+9);entry.signature=signature;}
   }
   if(depthChanged)win.aureonRefreshSpatialDepth?.();request=win.requestAnimationFrame(draw);
  }
  let seenUser=null;
  const update=()=>{const data=U.state.data;if(data?.capabilities?.spatialSnapshots===true){if(seenUser!==data.user?.id){scene.observe({...data,users:[]},win.performance.now());seenUser=data.user?.id;}return;}seenUser=data?.user?.id;scene.observe(data,win.performance.now());};
  const spatialUpdate=event=>{const data=event.detail;if(data?.user?.id!==U.state.data?.user?.id||U.state.data?.capabilities?.spatialSnapshots!==true)return;seenUser=data.user.id;scene.observe(data,win.performance.now());};
  win.addEventListener('aureon-interface-state',update);win.addEventListener('aureon-spatial-state',spatialUpdate);update();request=win.requestAnimationFrame(draw);
  const stop=()=>{closed=true;win.cancelAnimationFrame(request);win.removeEventListener('aureon-interface-state',update);win.removeEventListener('aureon-spatial-state',spatialUpdate);for(const entry of nodes.values())entry.node.remove();nodes.clear();};win.addEventListener('pagehide',stop,{once:true});return {stop};
 }
 return {install};
});
