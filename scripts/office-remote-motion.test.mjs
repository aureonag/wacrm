import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {remoteMotionPatch,REMOTE_MOTION_BASE_APP_SHA256,REMOTE_MOTION_REPLACEMENTS} from './office-remote-motion-patch.mjs';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url),{createScene}=require('./runtime/spatial-scene-core.js'),{createPublisher}=require('./runtime/spatial-publisher-core.js'),{install}=require('./runtime/replica-spatial-scene.js'),{createCrmInterfaceService}=require('../src/lib/office/runtime/service.cjs'),{createSpatialPresence}=require('../src/lib/office/runtime/vendor/spatial-presence-core.cjs');

const account='11111111-1111-4111-8111-111111111111',uidA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',uidB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const identity=(id,accountId=account)=>({accountId,user:{id,profileId:'profile-'+id,name:id===uidA?'Ana':'Bruno',avatarUrl:null},role:'agent',capabilities:{canDecorate:false,canManageMembers:false}});
function memoryStore(){const records=new Map();let writes=0;return {get writes(){return writes;},async load(id){return structuredClone(records.get(id)||{revision:0,snapshot:null});},async compareAndSwap(id,revision,snapshot){if((records.get(id)?.revision||0)!==revision)return false;records.set(id,{revision:revision+1,snapshot:structuredClone(snapshot)});writes++;return true;}};}

test('publisher sends a pose change at rest and the authenticated runtime exposes only that user in that tenant',async()=>{
 let now=1000;const store=memoryStore(),service=createCrmInterfaceService({store,now:()=>now}),a=identity(uidA),b=identity(uidB),foreign=identity(uidB,'22222222-2222-4222-8222-222222222222'),send=(who,method,path,body={})=>service.requestAsCrm(who,method,path,body);
 const state=await send(a,'GET','/state');await send(b,'GET','/state');await send(foreign,'GET','/state');let version=(await send(a,'GET','/spatial-control')).version,position={x:224,y:368,pose:{facing:'up',seated:false,layout:''}};
 const publisher=createPublisher({now:()=>now,readState:()=>state,readPosition:()=>position,post:async point=>{const result=await send(a,'POST','/spatial-presence',{...point,instanceId:'fixture-tab-a',expectedVersion:version,takeControl:version===0,userId:uidB,accountId:foreign.accountId});version=result.control.version;return result;}});
 const beforeWrites=store.writes;assert.equal((await publisher.tick()).sent,true);now+=200;position={...position,pose:{facing:'left',seated:true,layout:'cafe-sofa-v1',private:'NEVER_PUBLIC'}};assert.equal((await publisher.tick()).sent,true);assert.equal(store.writes,beforeWrites);
 const snapshot=await send(b,'GET','/spatial-state'),remote=snapshot.users.find(user=>user.id===uidA);assert.deepEqual(remote.spatialPosition.pose,{facing:'left',seated:true,layout:'cafe-sofa-v1'});assert.ok(!snapshot.users.some(user=>user.id===uidB));assert.ok(!JSON.stringify(snapshot).includes('NEVER_PUBLIC'));assert.deepEqual((await send(foreign,'GET','/spatial-state')).users,[]);
 const scene=createScene();scene.observe({capabilities:{spatialPresence:true},user:{id:uidB},users:snapshot.users},0);assert.equal(scene.frame(0)[0].seated,true);assert.equal(scene.frame(0)[0].facing,'left');
 remote.spatialPosition.pose.facing='right';assert.equal((await send(b,'GET','/spatial-state')).users[0].spatialPosition.pose.facing,'left');
 await assert.rejects(send(a,'POST','/spatial-presence',{...position,instanceId:'fixture-tab-stolen',expectedVersion:version,takeControl:false}),{status:409});
 await assert.rejects(send(a,'POST','/spatial-presence',{...position,pose:{facing:'sideways',seated:true},instanceId:'fixture-tab-a',expectedVersion:version}),{status:400});
 now+=20000;assert.deepEqual((await send(b,'GET','/spatial-state')).users,[]);
});

test('pose validation cannot extend leases or retain unbounded private metadata',()=>{
 let now=1000;const presence=createSpatialPresence({now:()=>now}),actor={id:'a',status:'online'},options={instanceId:'fixture-owner',expectedVersion:0,takeControl:true,pose:{facing:'up',seated:true,layout:'cafe-armchair-back-v1',private:'SECRET'}};
 const result=presence.publish(actor,{x:224,y:368},options);assert.deepEqual(result.pose,{facing:'up',seated:true,layout:'cafe-armchair-back-v1'});result.pose.facing='left';assert.equal(presence.snapshot(actor).pose.facing,'up');const lease=presence.control(actor),version=lease.version;
 for(const invalid of [null,[],{facing:'up',seated:'true'},{facing:'diagonal',seated:false},{facing:'up',seated:true,layout:'x'.repeat(100000)}])assert.throws(()=>presence.publish(actor,{x:224,y:368},{...options,expectedVersion:version,takeControl:false,pose:invalid}),{status:400});
 assert.deepEqual(presence.control(actor),lease);now+=200;const standing=presence.publish(actor,{x:224,y:368},{...options,expectedVersion:version,takeControl:false,pose:{facing:'right',seated:false,layout:'cafe-armchair-back-v1'}});assert.deepEqual(standing.pose,{facing:'right',seated:false,layout:''});assert.ok(!JSON.stringify(presence.exportState()).includes('SECRET'));
});

class Element{
 constructor(tag){this.tagName=tag;this.attributes=new Map();this.children=[];this.parentNode=null;this.textContent='';}
 setAttribute(key,value){this.attributes.set(key,String(value));}getAttribute(key){return this.attributes.get(key)??null;}removeAttribute(key){this.attributes.delete(key);}
 append(node){node.remove();this.children.push(node);node.parentNode=this;}remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(child=>child!==this);this.parentNode=null;}}
}
function fixture({reduced=false,native=false}={}){
 let now=0,nextId=0;const map=new Element('svg'),handlers=new Map(),callbacks=new Map(),compositions=[],poses=[],fetches=[];
 const data={capabilities:{spatialPresence:true},user:{id:'self'},users:[]},win={aureonOfficeBootstrap:{},aureonReplicaUI:{state:{data}},aureonSpatialSceneCore:{createScene},performance:{now:()=>now},matchMedia:()=>({matches:reduced}),aureonAvatarCompositor:{composeRemote:(facing,options,frame)=>{compositions.push({facing,options,frame});if(options.shirt==='#badbad')throw Error('Bad appearance');return 'data:image/png;base64,'+Buffer.from(facing+options.shirt+frame).toString('base64');}},document:{getElementById:id=>id==='office'?map:null,createElementNS:(_,tag)=>new Element(tag),createElement:()=>{let index=0;return {getContext:()=>({drawImage:(_,x)=>{index=x;}}),toDataURL:()=> 'data:image/png;base64,'+Buffer.from(String(index)).toString('base64')};}},addEventListener:(type,fn)=>{if(!handlers.has(type))handlers.set(type,new Set());handlers.get(type).add(fn);},removeEventListener:(type,fn)=>handlers.get(type)?.delete(fn),requestAnimationFrame:fn=>{callbacks.set(++nextId,fn);return nextId;},cancelAnimationFrame:id=>callbacks.delete(id)};
 if(native){win.fetch=async path=>{fetches.push(path);return {ok:true,json:async()=>({animations:[]})};};win.Image=class{naturalWidth=2304;naturalHeight=64;set src(value){fetches.push(value);queueMicrotask(()=>this.onload());}};win.aureonGatherAvatarCatalog={};win.aureonGatherAvatarSelection={sanitize:(_,plan)=>plan};win.aureonGatherNativeLibrary={outfit:()=>({files:{essentials:{width:2304,height:64,path:'assets/gather/avatar/reference-sheets/observed-outfit-1-essentials.png'}}}),frameRect:(_,frame)=>({x:frame*32,y:0})};win.aureonGatherSceneFrames={pose:(_,state,elapsed)=>{poses.push({state:{...state},elapsed});return {frame:state.seated?10:state.moving?1+Math.floor(elapsed/100)%6:0,animation:state.seated?'idle-sit-'+state.facing:state.moving?'walk-'+state.facing:'idle-'+state.facing,geometry:{x:-32,y:state.seated?-100:-82,width:64,height:128}};}};}
 const api=install(win),emit=type=>{for(const fn of handlers.get(type)||[])fn({detail:win.aureonReplicaUI.state.data});};
 return {win,map,compositions,poses,fetches,api,observe(users,time=now){now=time;data.users=users;emit('aureon-interface-state');},snapshot(users,id='self'){for(const fn of handlers.get('aureon-spatial-state')||[])fn({detail:{capabilities:{spatialPresence:true},user:{id},users}});},frame(time){now=time;const pending=[...callbacks.values()];callbacks.clear();for(const fn of pending)fn(time);},node(id='remote'){return map.children.find(node=>node.getAttribute('aria-label')?.startsWith(id==='remote'?'Bruno':'Other'));},image(node){return node.children.find(child=>child.getAttribute('data-remote-avatar')==='true');},pending:()=>callbacks.size};
}
const user=(x=100,extra={})=>({id:'remote',name:'Bruno',status:'online',spatialPosition:{x,y:200,floorId:'office-1',updatedAt:1,...extra}});

test('remote bodies animate without replacing their SVG nodes and isolate a failed appearance',()=>{
 const h=fixture();h.observe([user()],0);h.frame(0);const node=h.node(),image=h.image(node);h.observe([user(140,{updatedAt:2})],100);h.frame(200);const first=image.getAttribute('href');h.frame(300);assert.notEqual(image.getAttribute('href'),first);assert.equal(h.node(),node);assert.equal(h.image(node),image);assert.equal(node.getAttribute('data-moving'),'true');h.frame(600);assert.equal(node.getAttribute('data-moving'),'false');assert.equal(h.compositions.at(-1).frame,null);
 h.observe([{...user(140,{updatedAt:3}),avatarAppearance:{legacy:{shirt:'#badbad'}}},{...user(160),id:'other',name:'Other'}],700);h.frame(700);assert.equal(node.getAttribute('data-remote-body-error'),'unavailable');assert.equal(image.getAttribute('visibility'),'hidden');assert.equal(h.image(h.node('other')).getAttribute('visibility'),'visible');assert.equal(h.pending(),1);
 h.api.stop();assert.equal(h.map.children.length,0);assert.equal(h.pending(),0);
});
test('reduced motion uses still frames and applies position changes without interpolation',()=>{
 const h=fixture({reduced:true});h.observe([user()],0);h.frame(0);h.observe([user(140,{updatedAt:2})],100);h.frame(100);assert.equal(h.node().getAttribute('transform'),'translate(140,200)');assert.equal(h.node().getAttribute('data-moving'),'false');assert.ok(h.compositions.every(call=>call.frame===null));h.api.stop();
});
test('snapshot mode accepts only the current identity and does not erase bodies on ordinary roster refresh',()=>{
 const h=fixture();h.win.aureonReplicaUI.state.data.capabilities.spatialSnapshots=true;h.observe([user()],0);h.frame(0);assert.equal(h.map.children.length,0);
 h.snapshot([user()],'other-login');h.frame(10);assert.equal(h.map.children.length,0);h.snapshot([user()]);h.frame(20);const node=h.node();assert.ok(node);
 h.observe([],30);h.frame(30);assert.equal(h.node(),node);h.win.aureonReplicaUI.state.data.user.id='new-login';h.observe([],40);h.frame(40);assert.equal(h.map.children.length,0);h.snapshot([user()],'self');h.frame(50);assert.equal(h.map.children.length,0);h.api.stop();
});
test('native recipes use existing authored walking and explicit seat frames through local assets',async()=>{
 const h=fixture({native:true}),nativeUser=(x,extra)=>({...user(x,extra),avatarAppearance:{native:{pieces:{}}}});h.observe([nativeUser(100)],0);h.frame(0);await new Promise(setImmediate);h.frame(10);const node=h.node(),image=h.image(node);assert.equal(node.getAttribute('data-remote-body'),'native');
 h.observe([nativeUser(140,{updatedAt:2})],100);h.frame(220);assert.equal(h.poses.at(-1).state.moving,true);assert.equal(node.getAttribute('data-remote-animation'),'walk-right');
 h.observe([nativeUser(140,{updatedAt:3,pose:{facing:'up',seated:true,layout:'cafe-dining-back-v1'}})],300);h.frame(400);assert.equal(h.poses.at(-1).state.seated,true);assert.equal(h.poses.at(-1).state.layout,'cafe-dining-back-v1');assert.equal(node.getAttribute('data-moving'),'false');assert.equal(image.getAttribute('y'),'-100');assert.equal(h.node(),node);assert.equal(h.image(node),image);assert.ok(h.fetches.every(path=>path.startsWith('/api/office/runtime/')));h.api.stop();
});

const frozen=new URL('../.office-test/runtime-candidate-v21/app.js',import.meta.url);
test('reviewed frozen app exposes only visual pose and existing walking frames without changing any approved art',{skip:!fs.existsSync(frozen)},()=>{
 const source=fs.readFileSync(frozen,'utf8');assert.equal(createHash('sha256').update(source).digest('hex'),REMOTE_MOTION_BASE_APP_SHA256);const patched=remoteMotionPatch(source);assert.throws(()=>remoteMotionPatch(source+' '),/Unknown approved/);
 let restored=patched;for(const [before,after]of REMOTE_MOTION_REPLACEMENTS)restored=restored.replace(after,before);assert.equal(restored,source);
 const pngs=value=>[...value.matchAll(/data:image\/png;base64,[A-Za-z0-9+/=]+/g)].map(match=>match[0]);assert.deepEqual(pngs(patched),pngs(source));
 const start=patched.indexOf('window.aureonReadSpatialPosition='),end=patched.indexOf('\n\n// Keep remote markers',start),attributes={'data-foot-x':'224','data-foot-y':'368','data-facing':'up','data-seated':'true','data-seated-layout':'cafe-armchair-back-v1'},env={window:{},$:()=>({querySelector:()=>({getAttribute:key=>attributes[key]??null})})};vm.runInNewContext(patched.slice(start,end),env);assert.deepEqual(JSON.parse(JSON.stringify(env.window.aureonReadSpatialPosition())),{x:224,y:368,pose:{facing:'up',seated:true,layout:'cafe-armchair-back-v1'}});
});
