import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{createControl}=require('./runtime/spatial-control-core.js'),{createPublisher}=require('./runtime/spatial-publisher-core.js'),{createSpatialPresence}=require('../src/lib/office/runtime/vendor/spatial-presence-core.cjs'),{proximityRoom}=require('../src/lib/office/runtime/vendor/proximity-core.cjs'),{createScene}=require('./runtime/spatial-scene-core.js');
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function clock(){let now=0,sequence=0;const timers=new Map();return {now:()=>now,set:value=>{now=value;},schedule:(fn,delay)=>{timers.set(++sequence,{at:now+delay,fn});return sequence;},unschedule:id=>timers.delete(id),delay:delay=>new Promise(resolve=>{timers.set(++sequence,{at:now+delay,fn:resolve});}),async advance(ms){const target=now+ms;for(;;){await flush();const next=[...timers].filter(([,value])=>value.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();}now=target;await flush();},pending:()=>timers.size};}
function fixture(factory=createControl){
 const time=clock(),presence=createSpatialPresence({now:time.now}),user={id:'person-a',status:'online',lastSeen:0},other={id:'person-b',status:'online',lastSeen:0},events=[],context={userId:user.id,active:true,focused:true};let mode='normal',expireOnce=false;
 const load=async()=>{if(mode==='load-failure')throw Object.assign(Error('Fictional unavailable'),{status:503});const value=presence.control(user);events.push({type:'load',at:time.now(),...value});return value;};
 const send=async body=>{
  events.push({type:'send',at:time.now(),expectedVersion:body.expectedVersion,takeControl:body.takeControl});
  if(mode==='send-failure')throw Object.assign(Error('Fictional unavailable'),{status:503});
  if(mode==='expire-between'&&!expireOnce){expireOnce=true;await time.delay(1001);presence.publish(other,{x:140,y:200});other.lastSeen=time.now();events.push({type:'snapshot-eviction',at:time.now(),position:presence.snapshot(user),control:presence.control(user)});}
  const position=presence.publish(user,body,body);user.lastSeen=time.now();return {position,control:presence.control(user)};
 };
 const control=factory({instanceId:'single-active-tab',readContext:()=>context,load,send,schedule:time.schedule,unschedule:time.unschedule});
 const publisher=createPublisher({now:time.now,readState:()=>({capabilities:{spatialPresence:true},user,active:!control.isSuspended()&&(control.owns()||context.focused)}),readPosition:()=>({x:100,y:200}),post:point=>control.publish(point)});
 return {time,presence,user,other,context,events,control,publisher,mode:value=>{mode=value;},room:()=>proximityRoom(user,{users:[user,other],meetings:[],snapshot:presence.snapshot,phase:()=>({phase:'freeform'}),now:time.now()})};
}
async function expiredCas(factory){
 const h=fixture(factory);assert.equal((await h.publisher.tick()).sent,true);h.time.set(17000);h.mode('send-failure');assert.equal((await h.publisher.tick()).reason,'error');h.time.set(19000);h.mode('expire-between');const pending=h.publisher.tick();await flush();await h.time.advance(1001);return {h,result:await pending};
}

test('a single focused owner automatically recovers the real TTL-between-GET-and-POST CAS conflict',async()=>{
 const {h,result}=await expiredCas(createControl);assert.equal(result.sent,true);assert.equal(h.control.owns(),true);assert.equal(h.control.isSuspended(),false);assert.equal(result.result.control.version,3);
 assert.deepEqual(h.presence.snapshot(h.user),result.result.position);assert.deepEqual(h.room().members,['person-a','person-b']);
 assert.deepEqual(h.events.filter(event=>event.type==='send').map(event=>event.takeControl),[true,false,false,false]);
 assert.equal(h.events.filter(event=>event.type==='snapshot-eviction')[0].position,null);
 assert.equal(h.control.readLease().leaseExpiresAt,27001);assert.equal(h.time.pending(),0);
});

const frozen=new URL('../.office-test/runtime-candidate-v30/spatial-control-core.js',import.meta.url);
test('the same real-module scenario reproduces the published baseline suspension and absence',{skip:!fs.existsSync(frozen)},async()=>{
 assert.equal(createHash('sha256').update(fs.readFileSync(frozen)).digest('hex'),'35a97580b5336e7bc6d28b05dba3066d159abc713c2cc59dee1e76caa696c0ad');
 const baseline=require(frozen.pathname.startsWith('/')&&process.platform==='win32'?frozen.pathname.slice(1):frozen.pathname).createControl;
 const {h,result}=await expiredCas(baseline);assert.deepEqual({sent:result.sent,status:result.status},{sent:false,status:409});assert.equal(h.control.owns(),false);assert.equal(h.control.isSuspended(),true);assert.equal(h.presence.snapshot(h.user),null);assert.equal(h.room(),null);
 h.time.set(22001);h.mode('normal');assert.equal((await h.publisher.tick()).reason,'inactive');assert.equal(h.events.filter(event=>event.type==='send').length,3);
});

test('an expired7s lease alone can renew normally and does not erase a20s position',async()=>{
 const h=fixture();await h.publisher.tick();h.time.set(7900);assert.equal(h.presence.control(h.user).active,false);assert.ok(h.presence.snapshot(h.user));
 const result=await h.publisher.tick();assert.equal(result.sent,true);assert.equal(result.result.control.version,2);assert.equal(h.control.isSuspended(),false);assert.ok(h.presence.snapshot(h.user));
});

test('an active lease belonging to another tab is never taken by automatic conflict recovery',async()=>{
 const h=fixture();await h.publisher.tick();const otherBody={instanceId:'other-active-tab',expectedVersion:1,takeControl:true};h.time.set(1000);h.presence.publish(h.user,{x:500,y:300},otherBody);
 await assert.rejects(h.control.publish({x:100,y:200}),{status:409});assert.equal(h.control.isSuspended(),true);assert.equal(h.presence.snapshot(h.user).x,500);assert.equal(h.events.filter(event=>event.type==='send').length,2);
 assert.equal(h.control.requestClaim(false),true);const fresh=await h.control.publish({x:120,y:200});assert.equal(fresh.position.x,120);assert.equal(h.events.at(-1).takeControl,true,'a fresh trusted interaction still authorizes takeover');
});

test('an uncertain first response never reuses old takeover intent on an automatic retry',async()=>{
 const time=clock(),presence=createSpatialPresence({now:time.now}),user={id:'a',status:'online'},sends=[];let fail=true;
 const control=createControl({instanceId:'our-active-tab',readContext:()=>({userId:'a',active:true,focused:true}),schedule:time.schedule,unschedule:time.unschedule,load:async()=>presence.control(user),send:async body=>{sends.push(body);if(fail){fail=false;presence.publish(user,{x:500,y:200},{instanceId:'other-active-tab',expectedVersion:0,takeControl:true});throw Object.assign(Error('Lost reply'),{status:503});}return {position:presence.publish(user,body,body),control:presence.control(user)};}});
 await assert.rejects(control.publish({x:100,y:200}),{status:503});await assert.rejects(control.publish({x:100,y:200}),{status:409});assert.deepEqual(sends.map(body=>body.takeControl),[true,false]);assert.equal(presence.snapshot(user).x,500);assert.equal(control.isSuspended(),true);
});

test('another tab winning after the empty-lease check is protected by the recovery CAS',async()=>{
 const time=clock(),presence=createSpatialPresence({now:time.now}),user={id:'a',status:'online'},sends=[];presence.publish(user,{x:100,y:200},{instanceId:'our-active-tab',expectedVersion:0,takeControl:true});time.set(8000);
 const control=createControl({instanceId:'our-active-tab',readContext:()=>({userId:'a',active:true,focused:true}),schedule:time.schedule,unschedule:time.unschedule,load:async()=>presence.control(user),send:async body=>{sends.push(body);if(sends.length===1)presence.remove(user.id);else presence.publish(user,{x:500,y:200},{instanceId:'other-active-tab',expectedVersion:2,takeControl:true});return {position:presence.publish(user,body,body),control:presence.control(user)};}});
 await assert.rejects(control.publish({x:120,y:200}),{status:409});assert.deepEqual(sends.map(body=>body.takeControl),[true,false]);assert.equal(sends.length,2);assert.equal(presence.snapshot(user).x,500);assert.equal(presence.control(user).version,3);assert.equal(control.isSuspended(),true);
});

test('becoming offline while the409 control check is pending never sends a recovery position',async()=>{
 const time=clock(),context={userId:'a',active:true,focused:true};let loads=0,sends=0;const control=createControl({instanceId:'our-active-tab',readContext:()=>context,schedule:time.schedule,unschedule:time.unschedule,load:async()=>{if(++loads===2)context.active=false;return {version:loads,active:false};},send:async()=>{sends++;throw Object.assign(Error('Version changed'),{status:409});}});
 await assert.rejects(control.publish({x:100,y:200}),{status:409});assert.equal(sends,1);assert.equal(control.owns(),false);assert.equal(control.isSuspended(),false);assert.equal(time.pending(),0);
});

test('one3s deadline bounds the entire GET/POST operation even if a dependency ignores abort',async()=>{
 const time=clock();let sends=0;const control=createControl({instanceId:'single-active-tab',readContext:()=>({userId:'a',active:true,focused:true}),schedule:time.schedule,unschedule:time.unschedule,load:async()=>{await time.delay(1700);return {version:0,active:false};},send:async()=>{sends++;await time.delay(1700);return {control:{version:1,active:true,leaseExpiresAt:10400}};}});
 const pending=control.publish({x:100,y:200});const rejected=assert.rejects(pending,{status:408});await time.advance(3000);await rejected;assert.equal(sends,1);assert.equal(control.owns(),false);assert.equal(control.isSuspended(),false);
 await time.advance(400);assert.equal(control.owns(),false);assert.equal(control.readLease().leaseExpiresAt,null);assert.equal(time.pending(),0);
});

test('a late old publish cannot replace a newer explicit claim or suspend its ownership',async()=>{
 const time=clock();let firstResolve,sendCount=0;const control=createControl({instanceId:'single-active-tab',readContext:()=>({userId:'a',active:true,focused:true}),schedule:time.schedule,unschedule:time.unschedule,load:async()=>({version:0,active:false}),send:async()=>{if(++sendCount===1)return new Promise(resolve=>{firstResolve=resolve;});return {control:{version:2,active:true,leaseExpiresAt:7000}};}});
 const old=control.publish({x:100,y:200});const rejected=assert.rejects(old,{status:408});await flush();control.requestClaim(true);const current=await control.publish({x:120,y:200});await rejected;firstResolve({control:{version:1,active:true,leaseExpiresAt:7000}});await flush();assert.equal(current.control.version,2);assert.deepEqual(control.readLease(),{owned:true,leaseExpiresAt:7000,suspended:false});
});

test('identity or offline changes during a response cannot grant or poison the next identity',async()=>{
 for(const change of ['identity','offline']){const time=clock(),context={userId:'a',active:true,focused:true};let finish;const control=createControl({instanceId:'single-active-tab',readContext:()=>context,schedule:time.schedule,unschedule:time.unschedule,load:async()=>({version:0,active:false}),send:()=>new Promise(resolve=>{finish=resolve;})});const pending=control.publish({x:100,y:200}),rejected=assert.rejects(pending,{status:409});await flush();if(change==='identity')context.userId='b';else context.active=false;finish({control:{version:1,active:true,leaseExpiresAt:7000}});await rejected;assert.equal(control.owns(),false);assert.equal(control.isSuspended(),false);}
});

test('a transient absent snapshot removes a remote body immediately, while a later valid sample recreates it',()=>{
 const scene=createScene({durationMs:500}),state={capabilities:{spatialPresence:true},user:{id:'self'},users:[{id:'other',name:'Other',status:'online',spatialPosition:{x:100,y:200,floorId:'office-1',updatedAt:1}}]};scene.observe(state,0);assert.equal(scene.frame(0).length,1);scene.observe({...state,users:[]},600);assert.equal(scene.frame(600).length,0);scene.observe(state,1200);assert.equal(scene.frame(1200).length,1);
});
