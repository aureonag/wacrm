function officeResolveWallDepth(){
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
 const defs=s.querySelector('defs'),liveClips=new Set();for(const person of nodes.filter(n=>n.hasAttribute('data-person'))){const t=person.getAttribute('transform')?.match(/translate\(\s*([\d.-]+)[, ]+([\d.-]+)/);if(!t)continue;const px=+t[1],py=+t[2];let ceiling=Infinity;for(const wall of walls){if(!wall.dataset.wallOcclusion)continue;const[x,top,width,baseline]=wall.dataset.wallOcclusion.split(',').map(Number);if(px>x-16&&px<x+width+16&&Number(person.dataset.footY||py)<baseline&&Number(person.dataset.footY||py)>top-60)ceiling=Math.min(ceiling,top);}
  if(ceiling<Infinity&&defs){const id='wall-person-clip-'+person.dataset.person;liveClips.add(id);let clip=defs.querySelector('[id="'+id+'"]');if(!clip){clip=el('clipPath',{id,clipPathUnits:'userSpaceOnUse','data-wall-person-clip':'true'},defs);rect(clip,-5000,-5000,10000,5000+ceiling-py,'white');}else{const r=clip.querySelector('rect'),height=String(5000+ceiling-py);if(r.getAttribute('height')!==height)r.setAttribute('height',height);}const value='url(#'+id+')';if(person.getAttribute('clip-path')!==value)person.setAttribute('clip-path',value);
  }else if(person.hasAttribute('clip-path'))person.removeAttribute('clip-path');
 }
 defs?.querySelectorAll('[data-wall-person-clip]').forEach(clip=>{if(!liveClips.has(clip.id))clip.remove();});
}