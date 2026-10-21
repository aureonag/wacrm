import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {harness,expectLive,expectStoppedOnce} from './fixtures/office-call-harness.mjs';

const require=createRequire(import.meta.url),{createInterfaceService}=require('../src/lib/office/runtime/vendor/interface-api.cjs');
const source=fs.readFileSync(new URL('./runtime/replica-calls-proximity.js',import.meta.url),'utf8');
const settle=()=>new Promise(setImmediate);
const identity=id=>({user:{id,profileId:id,name:id},role:'agent',capabilities:{}});
const meeting=(id,members)=>({id,name:id,type:'meeting',members,owner:members[0],started:1000,requests:[]});
const posts=h=>h.apiCalls.filter(call=>call.endpoint==='call-session'&&call.body!==undefined);
const grants=h=>h.apiCalls.filter(call=>call.endpoint==='call-session'&&call.body===undefined);

async function clientFixture({ambient=false}={}){
 let clock=1000;
 const self=identity('fixture-user'),remote=identity('remote');
 const core=createInterfaceService({now:()=>clock});
 const leases=new Map(),request=(who,method,path,body={},query={})=>{const lease=leases.get(who.user.id),fields=lease?{spatialInstanceId:lease.instanceId,spatialVersion:lease.expectedVersion}:{};return core.requestAsCrm(who,method,path,method==='POST'?{...body,...fields}:body,method==='GET'?{...query,...fields}:query);};
 for(const who of [self,remote]){await request(who,'GET','/state');if(ambient){const instanceId='fixture-tab-'+who.user.id,result=await request(who,'POST','/spatial-presence',{x:who===self?200:300,y:400,instanceId,expectedVersion:0,takeControl:true});leases.set(who.user.id,{instanceId,expectedVersion:result.control.version});}}
 let room=null;
 if(!ambient){room=(await request(self,'POST','/meetings',{name:'Fixture',type:'meeting'})).meeting;await request(remote,'POST','/meeting-action',{id:room.id,action:'join'});room=structuredClone((await request(self,'GET','/state')).meetings.find(m=>m.id===room.id));}
 await request(remote,'POST','/call-session',{meeting:ambient?(await request(remote,'GET','/proximity')).room.id:room.id});
 const h=harness(source,{allowPeers:true});h.window.aureonReplicaUI.state.view='chat';h.window.aureonReplicaUI.state.data.capabilities={proximityAudio:ambient};h.setMeeting(room);if(ambient)h.setSpatialLease(leases.get(self.user.id));
 let intercept=null;
 const normal=(endpoint,body,query)=>request(self,body===undefined?'GET':'POST','/'+endpoint,body||{},query||{});
 h.setApi((endpoint,body,query)=>intercept?intercept(endpoint,body,query,normal):normal(endpoint,body,query));
 return {h,core,self,remote,room,normal,request,setIntercept:value=>intercept=value,async advance(ms){const until=clock+ms;while(clock<until){const step=Math.min(5000,until-clock);clock+=step;h.advance(step);if(ambient){for(const who of [self,remote]){const lease=leases.get(who.user.id);await request(who,'POST','/spatial-presence',{x:who===self?200:300,y:400,...lease,takeControl:false});}}}}};
}

test('hung proximity and signals reads abort at10s, release polling and recover without stopping capture',async()=>{
 for(const endpoint of ['proximity','signals']){
  const f=await clientFixture({ambient:endpoint==='proximity'});let finish,once=true;
  f.setIntercept((name,body,query,normal)=>name===endpoint&&once?(once=false,new Promise(resolve=>{finish=resolve;})):normal(name,body,query));
  const first=f.h.tickPending();await settle();const request=f.h.apiCalls.find(call=>call.endpoint===endpoint);assert.ok(request.signal);assert.equal(request.signal.aborted,false);
  const count=f.h.apiCalls.length;await f.h.tick();assert.equal(f.h.apiCalls.length,count);
  await f.advance(9999);await settle();assert.equal(request.signal.aborted,false);await f.advance(1);await first;assert.equal(request.signal.aborted,true);assert.equal(f.h.pendingSignalDeadlines(),0);expectLive(f.h);
  await f.h.tick();assert.equal(f.h.apiCalls.filter(call=>call.endpoint===endpoint).length,2);assert.equal(posts(f.h).length,1);assert.equal(f.h.connections.length,1);expectLive(f.h);
  const after=f.h.apiCalls.length;finish(endpoint==='proximity'?{room:null}:{members:[],roster:{},signals:[],cursor:999});await settle();assert.equal(f.h.apiCalls.length,after);assert.equal(f.h.connections[0].closeCalls,0);await f.h.ended();
 }
});

test('a lost creation POST response retries one known grant and returns the same call rather than replacing it',async()=>{
 const f=await clientFixture();let finish,first=true,created;
 f.setIntercept(async(name,body,query,normal)=>{const result=await normal(name,body,query);if(name==='call-session'&&body!==undefined&&first){first=false;created=result;return new Promise(resolve=>{finish=resolve;});}return result;});
 const pending=f.h.tickPending();await settle();assert.equal(posts(f.h).length,1);assert.ok(created.callId);f.advance(10000);await pending;expectLive(f.h);
 await f.h.tick();assert.equal(grants(f.h).length,1);assert.equal(posts(f.h).length,2);assert.equal(posts(f.h)[0].body.requestId,posts(f.h)[1].body.requestId);
 assert.equal(f.core.ephemeral().callSessions.find(([key])=>key.endsWith(':fixture-user'))[1].id,created.callId);assert.equal(f.h.apiCalls.find(call=>call.endpoint==='signals').query.call,created.callId);
 finish(created);await settle();await f.h.tick();assert.equal(posts(f.h).length,2);assert.equal(f.h.connections.length,1);expectLive(f.h);await f.h.ended();
});

test('malformed grant responses pause, while malformed POST responses retain the known idempotent grant',async()=>{
 for(const stage of ['grant','post']){
  const f=await clientFixture();let first=true,committed;
  f.setIntercept(async(name,body,query,normal)=>{const result=await normal(name,body,query);if(name==='call-session'&&(stage==='grant'?body===undefined:body!==undefined)&&first){first=false;committed=result;return {};}return result;});
  await f.h.tick();assert.ok(committed);
  if(stage==='grant'){assert.ok(f.h.notice());assert.match(f.h.notice().children[1].textContent,/resposta.*não chegou/);expectStoppedOnce(f.h);const count=f.h.apiCalls.length;await f.h.tick();assert.equal(f.h.apiCalls.length,count);assert.equal(posts(f.h).length,0);}
  else{expectLive(f.h);await f.h.tick();assert.equal(grants(f.h).length,1);assert.equal(posts(f.h).length,2);assert.equal(posts(f.h)[0].body.requestId,posts(f.h)[1].body.requestId);assert.equal(f.h.apiCalls.find(call=>call.endpoint==='signals').query.call,committed.callId);expectLive(f.h);}
  await f.h.ended();
 }
});

test('an unconfirmed grant read pauses truthfully and only explicit resume can acquire another version',async()=>{
 const f=await clientFixture();let finish,first=true;
 f.setIntercept(async(name,body,query,normal)=>{const result=await normal(name,body,query);if(name==='call-session'&&body===undefined&&first){first=false;return new Promise(resolve=>{finish=resolve;});}return result;});
 const pending=f.h.tickPending();await settle();const newer=await f.request(f.self,'POST','/call-session',{meeting:f.room.id});f.advance(10000);await pending;expectStoppedOnce(f.h);assert.ok(f.h.notice());assert.match(f.h.notice().children[1].textContent,/resposta.*não chegou/);assert.doesNotMatch(f.h.notice().children[1].textContent,/substituída/);
 const requests=f.h.apiCalls.length;for(let i=0;i<10;i++)await f.h.tick();assert.equal(f.h.apiCalls.length,requests);assert.equal(posts(f.h).length,0);
 finish({requestId:'obsolete-grant'});await settle();assert.equal(posts(f.h).length,0);assert.equal(f.core.ephemeral().callSessions.find(([key])=>key.endsWith(':fixture-user'))[1].id,newer.callId);await f.h.resume();assert.equal(grants(f.h).length,2);assert.equal(posts(f.h).length,1);assert.equal(f.h.notice()?.isConnected||false,false);expectStoppedOnce(f.h);await f.h.ended();
});

test('an expired lost POST cannot silently take over a newer tab even after the grant cache was pruned',async()=>{
 const f=await clientFixture();let finish,first=true,old;
 f.setIntercept(async(name,body,query,normal)=>{const result=await normal(name,body,query);if(name==='call-session'&&body!==undefined&&first){first=false;old=result;return new Promise(resolve=>{finish=resolve;});}return result;});
 const pending=f.h.tickPending();await settle();const newer=await f.request(f.self,'POST','/call-session',{meeting:f.room.id});assert.notEqual(newer.callId,old.callId);
 f.advance(60001);await pending;await f.h.tick();assert.ok(f.h.notice());assert.match(f.h.notice().children[1].textContent,/prazo.*expirou/);expectStoppedOnce(f.h);
 const count=f.h.apiCalls.length;await f.h.tick();assert.equal(f.h.apiCalls.length,count);assert.equal(grants(f.h).length,1);assert.equal(f.core.ephemeral().callSessions.find(([key])=>key.endsWith(':fixture-user'))[1].id,newer.callId);
 finish(old);await settle();assert.equal(grants(f.h).length,1);await f.h.resume();assert.equal(grants(f.h).length,2);assert.equal(posts(f.h).length,3);expectStoppedOnce(f.h);await f.h.ended();
});

test('session end and room departure abort in-flight reads/creation and ignore late completions',async()=>{
 for(const stage of ['grant','post','signals'])for(const ending of ['ended','leave']){
  const f=await clientFixture();let finish;
  f.setIntercept((name,body,query,normal)=>name===(stage==='signals'?'signals':'call-session')&&(stage!=='post'||body!==undefined)?new Promise(resolve=>{finish=resolve;}):normal(name,body,query));
  const pending=f.h.tickPending();await settle();const request=f.h.apiCalls.at(-1);assert.ok(request.signal);
  if(ending==='ended')await f.h.ended();else{f.h.setMeeting(null);await f.h.state();}await pending;assert.equal(request.signal.aborted,true);expectStoppedOnce(f.h);
  const count=f.h.apiCalls.length;finish(stage==='grant'?{requestId:'obsolete-request'}:stage==='post'?{callId:'obsolete-call'}:{members:[],roster:{},signals:[],cursor:0});await settle();await f.h.tick();assert.equal(f.h.apiCalls.length,count);expectStoppedOnce(f.h);assert.equal(f.h.pendingSignalDeadlines(),0);
 }
});

test('changing the active room aborts an old creation and retains capture for the new room',async()=>{
 const f=await clientFixture();let finish,first=true;
 f.setIntercept((name,body,query,normal)=>name==='call-session'&&body!==undefined&&first?(first=false,new Promise(resolve=>{finish=resolve;})):normal(name,body,query));
 const pending=f.h.tickPending();await settle();const oldRequest=posts(f.h)[0];
 const second=meeting('replacement-room',['fixture-user']);f.h.setMeeting(second);await f.h.state();await pending;assert.equal(oldRequest.signal.aborted,true);expectLive(f.h);
 // The fake second room is not admitted by the real service: no obsolete call
 // response may bypass that server decision or start signaling in it.
 finish({callId:'obsolete-call'});await settle();assert.equal(f.h.apiCalls.filter(call=>call.endpoint==='signals').length,0);await f.h.ended();
});

function backendFixture(){
 let clock=1000;const core=createInterfaceService({now:()=>clock,snapshot:{meetings:[meeting('room-a',['a','b']),meeting('room-b',['a','b'])]}});
 const request=(who,method,path,body={},query={})=>core.requestAsCrm(identity(who),method,path,body,query);
 const grant=(who='a',room='room-a')=>request(who,'GET','/call-session',{}, {meeting:room});
 const create=(requestId,who='a',room='room-a')=>request(who,'POST','/call-session',{meeting:room,...(requestId===undefined?{}:{requestId})});
 return {core,request,grant,create,advance:ms=>clock+=ms};
}

test('creation grants replay only the still-current result and preserve legacy replacement behavior',async()=>{
 const f=backendFixture(),grant=await f.grant(),first=await f.create(grant.requestId);
 assert.deepEqual(await f.create(grant.requestId),first);const legacy=await f.create();assert.notEqual(legacy.callId,first.callId);
 await assert.rejects(f.create(grant.requestId),{status:409,code:'OFFICE_CALL_SESSION_REPLACED'});assert.equal(f.core.ephemeral().callSessions.find(([key])=>key==='room-a:a')[1].id,legacy.callId);
 const fresh=await f.grant(),second=await f.create(fresh.requestId);assert.notEqual(second.callId,legacy.callId);assert.deepEqual(await f.create(fresh.requestId),second);
});

test('grants bind identity, room and current version; a delayed unused grant cannot replace a newer call',async()=>{
 const f=backendFixture(),grant=await f.grant();
 await assert.rejects(f.create(grant.requestId,'b'),{status:403});await assert.rejects(f.create(grant.requestId,'a','room-b'),{status:403});
 const otherTenant=backendFixture();await assert.rejects(otherTenant.create(grant.requestId),{status:409,code:'OFFICE_CALL_SESSION_MISSING'});
 const newer=await f.create();await assert.rejects(f.create(grant.requestId),{status:409,code:'OFFICE_CALL_SESSION_REPLACED'});assert.equal(f.core.ephemeral().callSessions.find(([key])=>key==='room-a:a')[1].id,newer.callId);
});

test('expired and evicted grants fail closed and the transient cache stays bounded',async()=>{
 const f=backendFixture(),old=await f.grant();await f.create(old.requestId);f.advance(60000);
 await assert.rejects(f.create(old.requestId),{status:409,code:'OFFICE_CALL_SESSION_MISSING'});assert.equal(f.core.ephemeral().callGrants.length,0);
 const evicted=await f.grant();for(let i=0;i<1024;i++)await f.grant();assert.equal(f.core.ephemeral().callGrants.length,1024);await assert.rejects(f.create(evicted.requestId),{status:409,code:'OFFICE_CALL_SESSION_MISSING'});
 for(const value of ['',null,[],{},'x'.repeat(81),'space forbidden'])await assert.rejects(f.create(value),{status:400});
});

test('leaving, offline and completed meetings cannot revive an old creation grant',async()=>{
 for(const action of ['leave','offline','complete']){
  const f=backendFixture(),grant=await f.grant();await f.create(grant.requestId);
  if(action==='leave'){await f.request('a','POST','/meeting-action',{id:'room-a',action:'leave'});await assert.rejects(f.create(grant.requestId),{status:403});
    // Re-admit through the snapshot to prove the old grant remains invalid even
    // after membership becomes valid again; no new creation can resurrect it.
    const snapshot=f.core.snapshot();snapshot.meetings.find(m=>m.id==='room-a').members.push('a');const restored=createInterfaceService({snapshot,ephemeral:f.core.ephemeral(),now:()=>1000});
    await assert.rejects(restored.requestAsCrm(identity('a'),'POST','/call-session',{meeting:'room-a',requestId:grant.requestId}),{status:409,code:'OFFICE_CALL_SESSION_REPLACED'});
  }else if(action==='offline'){await f.request('a','POST','/presence',{status:'offline'});await f.request('a','POST','/presence',{status:'online'});await assert.rejects(f.create(grant.requestId),{status:409,code:'OFFICE_CALL_SESSION_REPLACED'});}
  else{const snapshot=f.core.snapshot();Object.assign(snapshot.meetings.find(m=>m.id==='room-a'),{type:'focused',duration:1,started:0});const restored=createInterfaceService({snapshot,ephemeral:f.core.ephemeral(),now:()=>60000});await assert.rejects(restored.requestAsCrm(identity('a'),'POST','/call-session',{meeting:'room-a',requestId:grant.requestId}),{status:403});}
 }
});
