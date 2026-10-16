import {createHash} from 'node:crypto';
const sha=s=>createHash('sha256').update(s).digest('hex');
export function stabilizeOfficeMotion(source){
 if(sha(source)!=='51d14bdf392f540736be955b7c61efad9ddfebf5dbd352d3d74bc03ab5da7b50')throw Error('Unknown approved v18 app');
 let text=source;const blocks=[];const replace=(before,after)=>{if(text.split(before).length!==2)throw Error('Stability anchor mismatch: '+before.slice(0,80));blocks.push([before,after]);text=text.replace(before,after);};
 const start=text.indexOf(' function paintPlayer(){'),end=text.indexOf('\n function move(dx,dy)',start);if(start<0||end<start)throw Error('Player block');
 replace(text.slice(start,end),` let stablePlayerNode=null,stablePlayerPose='',stablePlayerOffset=0;
 window.addEventListener('aureon-avatar-frame-ready',()=>{stablePlayerPose='';paintPlayer();});
 window.addEventListener('aureon-native-scene-change',()=>{stablePlayerPose='';paintPlayer();});
 function paintPlayer(){
  officeCameraFollow(position);const s=$('office');s.dataset.motion=JSON.stringify(window.aureonMotionState());let mine=s.querySelector('[data-person="AL"]');
  const seated=!!window.aureonSeatState?.(),cart=usingCart(),pose=JSON.stringify([facing,walking,walking?Math.floor(walkPhase)%6:null,cart,seated,speaking?speaking+':'+Math.floor(performance.now()/80):false,avatarOptions,window.aureonCurrentDisplayName?.()]);
  if(!seated&&!cart&&mine&&mine===stablePlayerNode&&pose===stablePlayerPose){mine.setAttribute('transform','translate('+position.x+','+(position.y+stablePlayerOffset)+')');mine.dataset.footX=position.x;mine.dataset.footY=position.y;}
  else {mine?.remove();person(s,position.x,position.y,'AL','#45434e',true);mine=s.querySelector('[data-person="AL"]');stablePlayerNode=mine;stablePlayerPose=pose;const transform=mine?.getAttribute('transform')?.match(/translate\\(\\s*([\\d.-]+)[, ]+([\\d.-]+)/);stablePlayerOffset=transform?Number(transform[2])-position.y:0;}
  officeResolveWallDepth();s.dataset.playerPosition=JSON.stringify(position);
  if(zoom>1&&mine){const view=s.parentElement,v=view.getBoundingClientRect(),r=mine.getBoundingClientRect(),margin=70;if(r.left<v.left+margin)view.scrollLeft-=v.left+margin-r.left;else if(r.right>v.right-margin)view.scrollLeft+=r.right-v.right+margin;if(r.top<v.top+margin)view.scrollTop-=v.top+margin-r.top;else if(r.bottom>v.bottom-margin)view.scrollTop+=r.bottom-v.bottom+margin}
 }
`);
 replace("if(now-lastPaint>45){paintPlayer();if(speaking&&!$('inspector').hidden)avatarPreview();lastPaint=now}","paintPlayer();if(now-lastPaint>80){if(speaking&&!$('inspector').hidden)avatarPreview();lastPaint=now}");
 replace("img.onload=()=>{nativeImages.set(tinted,img);render();avatarPreview()}","img.onload=()=>{nativeImages.set(tinted,img);window.dispatchEvent(new Event('aureon-avatar-frame-ready'));}");
 const ds=text.indexOf('function officeResolveWallDepth(){'),de=text.indexOf('\n(()=>{const previous=render;',ds);if(ds<0||de<ds)throw Error('Depth block');
 replace(text.slice(ds,de),`function officeResolveWallDepth(){
 const s=$('office');if(!s)return;const walls=[...s.querySelectorAll('[data-construction-depth]')];for(const wall of walls)if(wall.parentNode!==s)s.append(wall);
 const nodes=[...s.querySelectorAll(':scope > .furniture,:scope > [data-person],:scope > [data-construction-depth]')],byId=new Map(objects.map(o=>[String(o.id),o])),weights=new Map(),surfaceChildren=new Map();
 for(const o of objects)if(o.surfaceId){const key=String(o.surfaceId),children=surfaceChildren.get(key)||[];children.push(o);surfaceChildren.set(key,children);}
 function objectDepth(o,seen=new Set()){
  if(!o||seen.has(o.id))return 0;seen.add(o.id);if(o.type==='quadro-postits-reuniao-v1')return 4000000+o.y;if(editing&&o.meetingSet)return 3000000+o.y;
  if(['rug','tapete-couro-vaca','tapete-cafe-claro-v1'].includes(o.type))return -1000;if(o.surfaceId){const children=surfaceChildren.get(String(o.surfaceId));return objectDepth(byId.get(String(o.surfaceId)),seen)+(children.length-children.indexOf(o))*.001;}
  if(window.aureonReceptionSeatedChair?.()===o.id||window.aureonSeatState?.()?.id===o.id)return o.y-1;if(o.type==='balcao-recepcao')return o.y+52;
  if(o.type.startsWith('computador')||o.type.startsWith('pc-')){const desk=objects.filter(d=>d.type.startsWith('mesa')&&Math.abs(d.x-o.x)<85&&Math.abs(d.y-o.y)<110).sort((a,b)=>Math.hypot(a.x-o.x,a.y-o.y)-Math.hypot(b.x-o.x,b.y-o.y))[0];return desk?desk.y+26:o.y+100;}return o.y+25;
 }
 for(const n of nodes)weights.set(n,n.hasAttribute('data-approved-tv')?2000000+Number(n.dataset.object||0)%1000:n.dataset.constructionDepth?+n.dataset.constructionDepth:n.hasAttribute('data-person')?+n.dataset.footY:objectDepth(byId.get(n.dataset.object)));
 nodes.sort((a,b)=>weights.get(a)-weights.get(b));const participants=new Set(nodes);let cursor=s.firstElementChild;for(const node of nodes){while(cursor&&!participants.has(cursor))cursor=cursor.nextElementSibling;if(cursor===node)cursor=cursor.nextElementSibling;else s.insertBefore(node,cursor);}
 const defs=s.querySelector('defs'),liveClips=new Set();for(const person of nodes.filter(n=>n.hasAttribute('data-person'))){const t=person.getAttribute('transform')?.match(/translate\\(\\s*([\\d.-]+)[, ]+([\\d.-]+)/);if(!t)continue;const px=+t[1],py=+t[2];let ceiling=Infinity;for(const wall of walls){if(!wall.dataset.wallOcclusion)continue;const[x,top,width,baseline]=wall.dataset.wallOcclusion.split(',').map(Number);if(px>x-16&&px<x+width+16&&Number(person.dataset.footY||py)<baseline&&Number(person.dataset.footY||py)>top-60)ceiling=Math.min(ceiling,top);}
  if(ceiling<Infinity&&defs){const id='wall-person-clip-'+person.dataset.person;liveClips.add(id);let clip=defs.querySelector('[id="'+id+'"]');if(!clip){clip=el('clipPath',{id,clipPathUnits:'userSpaceOnUse','data-wall-person-clip':'true'},defs);rect(clip,-5000,-5000,10000,5000+ceiling-py,'white');}else{const r=clip.querySelector('rect'),height=String(5000+ceiling-py);if(r.getAttribute('height')!==height)r.setAttribute('height',height);}const value='url(#'+id+')';if(person.getAttribute('clip-path')!==value)person.setAttribute('clip-path',value);
  }else if(person.hasAttribute('clip-path'))person.removeAttribute('clip-path');
 }
 defs?.querySelectorAll('[data-wall-person-clip]').forEach(clip=>{if(!liveClips.has(clip.id))clip.remove();});
}`);
 // These late historical overrides are now represented by the same stable ordering above.
 replace("for(const o of objects.filter(o=>o.surfaceId)){const parent=objects.find(p=>p.id===o.surfaceId),base=s.querySelector('[data-object=\"'+o.surfaceId+'\"]'),node=s.querySelector('[data-object=\"'+o.id+'\"]');if(parent&&base&&node){s.insertBefore(node,base.nextSibling);}}",'void s;');
 replace("for(const o of objects.filter(o=>keys[o.type]==='tapete')){const rug=document.querySelector('.furniture[data-object=\"'+o.id+'\"]');if(!rug)continue;const first=Array.from(rug.parentNode.children).find(n=>n!==rug&&(n.classList.contains('furniture')||n.hasAttribute('data-person')||n.hasAttribute('data-construction-depth')));if(first)rug.parentNode.insertBefore(rug,first);}",'');
 replace("for(const n of s.querySelectorAll(':scope > [data-approved-tv]'))s.append(n);",'void s;');
 replace("if(editing){const s=$('office');for(const o of objects.filter(o=>o.meetingSet).sort((a,b)=>a.y-b.y)){const n=s.querySelector('[data-object=\"'+o.id+'\"]');if(n)s.append(n);}}",'');
 replace("for(const n of document.querySelectorAll('#office [data-large-meeting=\"quadro-postits-reuniao-v1\"]')){const g=n.closest('.furniture');if(g)$('office').append(g);}",'');

 const npcStart=text.indexOf('function paint(now){const svg=$(\'office\');if(!svg||!chair()||!desk())return;'),npcEnd=text.indexOf('\nconst oldRender=render;',npcStart);if(npcStart<0||npcEnd<npcStart)throw Error('NPC paint boundary');
 replace(text.slice(npcStart,npcEnd),`const npcFramesReady=new Map();
function readyNpcFrame(item){let entry=npcFramesReady.get(item.href);if(entry)return entry;entry={ready:false,uri:null};npcFramesReady.set(item.href,entry);const img=new Image();img.onload=()=>{try{const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;canvas.getContext('2d').drawImage(img,0,0);entry.uri=canvas.toDataURL('image/png');entry.ready=true;paint(performance.now());}catch{entry.failed=true;}};img.onerror=()=>{entry.failed=true;};img.src=item.href;return entry;}
function paint(now){
 const svg=$('office');if(!svg||!chair()||!desk())return;const {action,index,item}=sprite();let root=svg.querySelector('[data-reception-npc]');if(!root){root=el('g',{'data-person':'reception-astronaut','data-reception-npc':'true','pointer-events':'none','aria-label':'Recepcionista da Aurion'},svg);el('image',{style:'image-rendering:pixelated'},root);}
 root.setAttribute('transform','translate('+state.position.x+','+state.position.y+')');root.dataset.footX=state.position.x;root.dataset.footY=state.position.y;root.dataset.phase=state.phase;root.dataset.direction=state.direction;
 const offset=['working','welcoming'].includes(state.phase)?17:state.phase==='wiping'?29:0,ready=readyNpcFrame(item),image=root.querySelector(':scope > image');
 if(ready.ready){const attrs={href:ready.uri,x:-item.anchorX,y:-item.footY+offset,width:item.width,height:item.height};for(const [key,value]of Object.entries(attrs))if(image.getAttribute(key)!==String(value))image.setAttribute(key,value);root._npcDisplayed={item,offset,uri:ready.uri};root.dataset.frame=index;}
 if(ready.failed)svg.dataset.npcSpriteError='true';const displayed=root._npcDisplayed||{item,offset,uri:null},visible=displayed.item;
 if(state.phase==='wiping'&&displayed.uri){let defs=svg.querySelector('defs');if(!defs)defs=el('defs',{},svg);let clip=defs.querySelector('#reception-cloth-clip');if(!clip){clip=el('clipPath',{id:'reception-cloth-clip',clipPathUnits:'userSpaceOnUse'},defs);rect(clip,0,0,1,1,'white');}const spriteTop=state.position.y-visible.footY+displayed.offset,rectNode=clip.querySelector('rect');for(const [key,value]of Object.entries({x:state.position.x-visible.anchorX,y:spriteTop+visible.height*.52,width:visible.width,height:visible.height*.30}))rectNode.setAttribute(key,value);
  let overlay=svg.querySelector('[data-reception-cloth]');if(!overlay){overlay=el('g',{'data-reception-cloth':'true','clip-path':'url(#reception-cloth-clip)','pointer-events':'none'},svg);el('image',{style:'image-rendering:pixelated'},overlay);}overlay.dataset.constructionDepth=desk().y+53;const overlayImage=overlay.querySelector('image');for(const [key,value]of Object.entries({href:displayed.uri,x:state.position.x-visible.anchorX,y:spriteTop,width:visible.width,height:visible.height}))if(overlayImage.getAttribute(key)!==String(value))overlayImage.setAttribute(key,value);
 }else{svg.querySelector('[data-reception-cloth]')?.remove();svg.querySelector('#reception-cloth-clip')?.remove();}
 const activeBubble=bubble&&now<bubble.until,bubbleKey=activeBubble?JSON.stringify(bubble.lines):'';let b=root.querySelector('[data-npc-bubble]');if(root._npcBubbleKey!==bubbleKey){b?.remove();b=null;root._npcBubbleKey=bubbleKey;if(activeBubble){b=el('g',{'data-npc-bubble':'true'},root);const lines=[];for(const text of bubble.lines){if(text.length>26){const words=text.split(' ');let line='';for(const word of words){if((line+' '+word).trim().length>26){lines.push(line);line=word}else line=(line+' '+word).trim()}if(line)lines.push(line)}else lines.push(text)}const height=lines.length*14+16;rect(b,0,0,Math.min(230,Math.max(130,Math.max(...lines.map(t=>t.length))*6.4+18)),height,'#fff5e5',7,'#29232f');for(let i=0;i<lines.length;i++)el('text',{x:9,y:18+i*14,fill:'#302836','font-size':11,'font-family':'Arial, sans-serif'},b,lines[i]);}}
 if(b)b.setAttribute('transform','translate(32,'+(-visible.footY+12)+')');
 svg.dataset.receptionState=JSON.stringify({...state,route:state.route.length,bubble:activeBubble?bubble.lines:null,bounds:bounds(),surface:state.phase==='wiping'?'table':state.phase==='sweeping'?'floor':null});officeResolveWallDepth();
}
`);
 replace('if(now-lastPaint>90){paint(now);lastPaint=now;}',"if(now-lastPaint>(state.phase==='walking'||state.phase==='sweeping'?16:90)){paint(now);lastPaint=now;}");

 replace("document.querySelectorAll('.channel').forEach((b,j)=>b.classList.toggle('active',i===j));render()}","document.querySelectorAll('.channel').forEach((b,j)=>b.classList.toggle('active',i===j));if(move)render()}");
 replace('oldSetRoom(i,moveToRoom);clearSpawn();render()','oldSetRoom(i,moveToRoom);if(moveToRoom){clearSpawn();render()}');
 return {text,blocks};
}
