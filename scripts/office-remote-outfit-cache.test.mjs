import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';

const require=createRequire(import.meta.url);
const {createScene}=require('./runtime/spatial-scene-core.js');
const {install}=require(process.env.OFFICE_REMOTE_RENDERER?path.resolve(process.env.OFFICE_REMOTE_RENDERER):'./runtime/replica-spatial-scene.js');
class Element{
 constructor(tag){this.tagName=tag;this.attributes=new Map();this.children=[];this.parentNode=null;}
 setAttribute(key,value){this.attributes.set(key,String(value));}getAttribute(key){return this.attributes.get(key)??null;}removeAttribute(key){this.attributes.delete(key);}
 append(node){node.remove();this.children.push(node);node.parentNode=this;}remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(child=>child!==this);this.parentNode=null;}}
}
const flush=()=>new Promise(setImmediate);
function fixture({deferLibrary=false,failLibrary=false,reduced=false}={}){
 let now=0,next=0,resolveLibrary,inflight=0,maxInflight=0,libraryCount=0;const map=new Element('svg'),handlers=new Map(),frames=new Map(),timers=new Map(),images=[],fetches=[],poses=[],sanitized=[];
 const libraryReady=deferLibrary?new Promise(resolve=>{resolveLibrary=resolve;}):Promise.resolve();
 const data={capabilities:{spatialPresence:true},user:{id:'self'},users:[]};
 const win={aureonOfficeBootstrap:{},aureonReplicaUI:{state:{data}},aureonSpatialSceneCore:{createScene},performance:{now:()=>now},matchMedia:()=>({matches:reduced}),
  document:{getElementById:id=>id==='office'?map:null,createElementNS:(_,tag)=>new Element(tag),createElement:()=>{let frame;return {getContext:()=>({drawImage:(_,x)=>{frame=x;}}),toDataURL:()=>`data:image/png;base64,${Buffer.from(String(frame)).toString('base64')}`};}},
  addEventListener:(type,fn)=>{if(!handlers.has(type))handlers.set(type,new Set());handlers.get(type).add(fn);},removeEventListener:(type,fn)=>handlers.get(type)?.delete(fn),requestAnimationFrame:fn=>{frames.set(++next,fn);return next;},cancelAnimationFrame:id=>frames.delete(id),setTimeout:(fn,ms)=>{timers.set(++next,{at:now+ms,fn});return next;},clearTimeout:id=>timers.delete(id),AbortController,
  aureonAvatarCompositor:{composeRemote:()=> 'data:image/png;base64,ZmFsbGJhY2s='},aureonGatherAvatarCatalog:{},
  aureonGatherAvatarSelection:{sanitize:(_,plan)=>{sanitized.push(plan);return {version:1,pieces:{0:plan.pieces?.[0]||'default'},colors:{0:'blue'}};}},
  aureonGatherNativeLibrary:{outfit:(_,plan)=>({files:{essentials:{width:2304,height:64,path:plan.pieces[0]==='badpath'?'../unsafe.png':`assets/gather/avatar/${plan.pieces[0]}.png`}}}),frameRect:(_,frame)=>({x:frame*32,y:0})},
  aureonGatherSceneFrames:{pose:(_,state)=>{poses.push(state);return {frame:state.seated?10:state.moving?1:0,animation:state.seated?'sit':state.moving?'walk':'idle',geometry:{x:-32,y:-82,width:64,height:128}};}},
  fetch:async (url,options)=>{fetches.push({url,signal:options?.signal});const attempt=++libraryCount;await libraryReady;return {ok:!(typeof failLibrary==='number'?attempt<=failLibrary:failLibrary),json:async()=>({})};},
  Image:class{constructor(){this.naturalWidth=2304;this.naturalHeight=64;this.active=false;images.push(this);}set src(value){this.path=value;this.active=true;inflight++;maxInflight=Math.max(maxInflight,inflight);}complete(){if(this.active){this.active=false;inflight--;}}removeAttribute(key){if(key==='src')this.complete();}load(){this.complete();this.onload?.();}fail(){this.complete();this.onerror?.();}}
 };
 const api=install(win);
 function advance(ms){const target=now+ms;for(;;){const nextTimer=[...timers].filter(([,timer])=>timer.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!nextTimer)break;now=nextTimer[1].at;timers.delete(nextTimer[0]);nextTimer[1].fn();}now=target;}
 return {api,win,map,images,fetches,poses,sanitized,advance,maxInflight:()=>maxInflight,inflight:()=>inflight,timers:()=>timers.size,resolveLibrary:()=>resolveLibrary?.(),observe(users){data.users=users;for(const fn of handlers.get('aureon-interface-state')||[])fn();},frame(ms=100){advance(ms);const callbacks=[...frames.values()];frames.clear();for(const fn of callbacks)fn(now);},node:id=>map.children.find(node=>node.getAttribute('aria-label')?.startsWith(id+' ·')),native:()=>map.children.filter(node=>node.getAttribute('data-remote-body')==='native').length,fallback:()=>map.children.filter(node=>node.getAttribute('data-remote-body')==='approved').length,pendingFrames:()=>frames.size,loadAll:()=>{for(let i=0;i<images.length;i++)images[i].load();}};
}
const user=(id,recipe,extra={})=>({id,name:id,status:'online',avatarAppearance:{native:{pieces:{0:recipe},...extra}},spatialPosition:{x:100,y:200,floorId:'office-1',updatedAt:1}});
const users=(count,start=0)=>Array.from({length:count},(_,i)=>user('person'+(start+i),'outfit'+(start+i)));
async function display(h,people){h.observe(people);h.frame();await flush();h.loadAll();h.frame();}

for(const count of [32,33,64])test(`${count} simultaneous native recipes remain visible and load once across repeated frames`,async()=>{
 const h=fixture();await display(h,users(count));assert.equal(h.native(),count);assert.equal(h.fallback(),0);
 for(let i=0;i<5;i++){h.frame();await flush();h.loadAll();}
 assert.equal(h.native(),count);assert.equal(h.images.length,count,'no live recipe is evicted or loaded again');assert.equal(h.fetches.length,1,'one shared library load');assert.ok(h.maxInflight()<=6,'composition requests stay below the server pending limit');h.api.stop();
});

test('departures keep only32 inactive recipes, preserve live users, and reuse the most recent departed recipes',async()=>{
 const h=fixture();await display(h,users(64));const survivor=h.node('person0');
 await display(h,[user('person0','outfit0')]);assert.equal(h.native(),1);assert.equal(h.node('person0'),survivor);
 await display(h,[user('person0','outfit0'),user('recent','outfit63')]);assert.equal(h.images.length,64,'recent inactive outfit is reused');
 await display(h,[user('person0','outfit0'),user('recent','outfit63'),user('evicted','outfit1')]);assert.equal(h.images.length,65,'old inactive outfit is evicted, active outfit is retained');assert.equal(h.native(),3);h.api.stop();
});

test('repeated replacements and exits never reload a surviving live recipe or retain the entire departed history',async()=>{
 const h=fixture();await display(h,[user('anchor','anchor')]);const anchor=h.node('anchor');
 for(let group=0;group<4;group++)await display(h,[user('anchor','anchor'),...users(40,group*40)]);
 assert.equal(h.images.filter(image=>image.path.endsWith('/anchor.png')).length,1);assert.equal(h.node('anchor'),anchor);assert.equal(h.native(),41);
 await display(h,[user('anchor','anchor'),user('old','outfit0')]);assert.equal(h.images.filter(image=>image.path.endsWith('/outfit0.png')).length,2,'departed history is bounded');h.api.stop();
});

test('different users and raw metadata aliases share one sanitized visual recipe',async()=>{
 const h=fixture();await display(h,[user('Ana','same',{ignored:'one'}),user('Bruno','same',{ignored:'two'})]);assert.equal(h.native(),2);assert.equal(h.images.length,1);
 const nodes=[h.node('Ana'),h.node('Bruno')];for(let i=0;i<5;i++)h.frame();assert.equal(h.images.length,1);assert.equal(h.sanitized.length,2,'sanitize only when that actor appearance changes');
 h.observe([user('Ana','same',{ignored:'new'}),user('Bruno','same',{ignored:'two'})]);h.frame();await flush();assert.equal(h.images.length,1);assert.equal(h.node('Ana'),nodes[0]);assert.equal(h.node('Bruno'),nodes[1]);h.api.stop();
});

test('pending live loads survive churn while removed pending recipes cannot start orphan image loads',async()=>{
 const h=fixture({deferLibrary:true});h.observe(users(64));h.frame();h.observe([user('person0','outfit0')]);h.frame();h.resolveLibrary();await flush();
 assert.equal(h.images.length,1,'only the live recipe starts network work');h.loadAll();h.frame();assert.equal(h.native(),1);
 await display(h,[user('person0','outfit0'),user('recent','outfit63')]);assert.equal(h.images.length,2);assert.equal(h.native(),2);h.api.stop();
});

test('failed images and invalid paths keep a visible fallback without frame-by-frame retry storms',async()=>{
 const h=fixture();h.observe([user('bad','outfitBad'),user('unsafe','badpath'),user('good','outfitGood')]);h.frame();await flush();
 h.images.find(image=>image.path?.endsWith('/outfitBad.png')).fail();h.images.find(image=>image.path?.endsWith('/outfitGood.png')).load();
 for(let i=0;i<5;i++){h.frame();await flush();}assert.equal(h.native(),1);assert.equal(h.fallback(),2);assert.equal(h.images.length,2,'unsafe path never creates a network image');assert.equal(h.pendingFrames(),1);h.api.stop();
});

test('a failed shared library retains fallbacks and does not repeatedly fetch while users stay live',async()=>{
 const h=fixture({failLibrary:true});h.observe(users(64));for(let i=0;i<5;i++){h.frame();await flush();}assert.equal(h.fallback(),64);assert.equal(h.fetches.length,1);assert.equal(h.images.length,0);h.api.stop();
});

test('a transient image failure recovers after backoff without starving other queued colleagues',async()=>{
 const h=fixture();h.observe(users(64));h.frame();await flush();assert.equal(h.images.length,6);h.images[0].fail();
 h.loadAll();h.frame();assert.equal(h.native(),63);assert.equal(h.images.length,64);h.frame(1000);assert.equal(h.images.length,65);h.loadAll();h.frame();assert.equal(h.native(),64);assert.ok(h.maxInflight()<=6);h.api.stop();
});

test('wrong dimensions and repeated failures keep the fallback after at most3 attempts',async()=>{
 const h=fixture();h.observe([user('bad','bad')]);h.frame();await flush();h.images[0].naturalWidth=1;h.images[0].load();
 h.frame(1000);assert.equal(h.images.length,2);h.images[1].fail();h.frame(4000);assert.equal(h.images.length,3);h.images[2].fail();h.frame(4000);assert.equal(h.images.length,3);assert.equal(h.fallback(),1);assert.equal(h.inflight(),0);h.api.stop();
});

test('six hung images time out and release capacity for later users and bounded retries',async()=>{
 const h=fixture();h.observe(users(10));h.frame();await flush();const stale=h.images.map(image=>image.onload);assert.equal(h.inflight(),6);
 h.advance(15000);assert.equal(h.images.length,10);assert.equal(h.inflight(),4);assert.ok(h.images.slice(0,6).every(image=>image.onload===null&&image.onerror===null));
 stale.forEach(fn=>fn?.());assert.equal(h.inflight(),4,'late timeout completions cannot release a newer load');h.loadAll();h.frame(0);assert.equal(h.native(),4);
 h.frame(1000);h.loadAll();h.frame();assert.equal(h.native(),10);assert.equal(h.images.length,16);assert.ok(h.maxInflight()<=6);h.api.stop();
});

test('a transient shared manifest failure retries once for all live users and then resolves their outfits',async()=>{
 const h=fixture({failLibrary:1});h.observe(users(64));h.frame();await flush();assert.equal(h.fallback(),64);assert.equal(h.fetches.length,1);
 h.frame(1000);await flush();h.loadAll();h.frame();assert.equal(h.fetches.length,2);assert.equal(h.native(),64);assert.equal(h.images.length,64);assert.ok(h.maxInflight()<=6);h.api.stop();
});

test('a hung manifest is aborted at its deadline and cannot poison the next shared attempt',async()=>{
 const h=fixture({deferLibrary:true});h.observe(users(33));h.frame();await flush();assert.equal(h.fetches.length,1);h.advance(15000);await flush();assert.equal(h.fetches[0].signal?.aborted,true);
 h.frame(1000);await flush();assert.equal(h.fetches.length,2);h.resolveLibrary();await flush();h.loadAll();h.frame();assert.equal(h.native(),33);assert.equal(h.images.length,33);h.api.stop();
});

test('persistent manifest errors stop after3 shared attempts while every user keeps a body',async()=>{
 const h=fixture({failLibrary:true});h.observe(users(64));h.frame();await flush();h.frame(1000);await flush();h.frame(4000);await flush();h.frame(4000);await flush();
 assert.equal(h.fetches.length,3);assert.equal(h.images.length,0);assert.equal(h.fallback(),64);assert.equal(h.timers(),0);h.api.stop();
});

test('stop releases image callbacks, pending library work and all remote SVG nodes',async()=>{
 const h=fixture();h.observe(users(33));h.frame();await flush();const callbacks=h.images.map(image=>image.onload);h.api.stop();
 assert.equal(h.map.children.length,0);assert.equal(h.pendingFrames(),0);assert.equal(h.timers(),0);assert.equal(h.inflight(),0);assert.ok(h.images.every(image=>image.onload===null&&image.onerror===null));
 callbacks.forEach(fn=>fn?.());h.frame();assert.equal(h.map.children.length,0);assert.equal(h.pendingFrames(),0);
 const pending=fixture({deferLibrary:true});pending.observe(users(33));pending.frame();await flush();pending.api.stop();assert.equal(pending.fetches[0].signal?.aborted,true);assert.equal(pending.timers(),0);pending.resolveLibrary();await flush();assert.equal(pending.images.length,0);assert.equal(pending.map.children.length,0);
});

test('cache sharing preserves reduced motion, explicit seated pose and stable remote image nodes',async()=>{
 const h=fixture({reduced:true}),people=[user('Ana','same'),user('Bruno','same')];await display(h,people);const node=h.node('Ana'),image=node.children.find(child=>child.getAttribute('data-remote-avatar')==='true');
 people[0].spatialPosition={...people[0].spatialPosition,x:140,updatedAt:2,pose:{facing:'left',seated:true,layout:'cafe-sofa-v1'}};h.observe(people);h.frame();
 assert.equal(h.node('Ana'),node);assert.equal(node.children.find(child=>child.getAttribute('data-remote-avatar')==='true'),image);assert.equal(node.getAttribute('transform'),'translate(140,200)');assert.equal(node.getAttribute('data-moving'),'false');assert.equal(node.getAttribute('data-seated'),'true');assert.equal(h.images.length,1);assert.equal(h.poses.at(-2).facing,'left');assert.equal(h.poses.at(-2).layout,'cafe-sofa-v1');h.api.stop();
});
