import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {harness} from './fixtures/office-call-harness.mjs';
const require=createRequire(import.meta.url),{createInterfaceService}=require('../src/lib/office/runtime/vendor/interface-api.cjs');
const source=fs.readFileSync(new URL('./runtime/replica-calls-proximity.js',import.meta.url),'utf8');
const identity=id=>({user:{id,profileId:id,name:id},role:'agent',capabilities:{}});
const fields=lease=>({spatialInstanceId:lease.instanceId,spatialVersion:lease.expectedVersion});
const replaced={status:409,code:'OFFICE_CALL_SESSION_REPLACED'};
const posts=h=>h.apiCalls.filter(call=>call.endpoint==='call-session'&&call.body!==undefined);
async function fixture(){
 let now=1000;const core=createInterfaceService({now:()=>now}),self=identity('fixture-user'),other=identity('remote');
 const request=(who,method,path,body={},query={})=>core.requestAsCrm(who,method,path,body,query);
 for(const who of [self,other])await request(who,'GET','/state');
 async function claim(who,instanceId){const current=await request(who,'GET','/spatial-control'),result=await request(who,'POST','/spatial-presence',{x:who===self?200:300,y:400,instanceId,expectedVersion:current.version,takeControl:true});return {instanceId,expectedVersion:result.control.version};}
 const old=await claim(self,'older-tab-0001'),remote=await claim(other,'remote-tab-0001'),room=(await request(self,'GET','/proximity')).room.id;
 const grant=(who,lease)=>request(who,'GET','/call-session',{}, {meeting:room,...fields(lease)});
 const create=async(who,lease)=>{const value=await grant(who,lease);return request(who,'POST','/call-session',{meeting:room,requestId:value.requestId,...fields(lease)});};
 function client(lease,{micOff=false,intercept}={}){const h=harness(source,{allowPeers:true,ownership:'controlled'});h.setSpatialLease(lease);h.window.aureonReplicaUI.state.view='chat';h.window.aureonReplicaUI.state.data.capabilities={proximityAudio:true,spatialOwnership:true};h.window.aureonCameraStream=()=>null;h.window.aureonScreenStream=()=>null;if(micOff)h.window.aureonAudioStream=()=>null;const normal=(endpoint,body,query)=>request(self,body===undefined?'GET':'POST','/'+endpoint,body||{},query||{});h.setApi((endpoint,body,query)=>intercept?intercept(endpoint,body,query,normal):normal(endpoint,body,query));return h;}
 return {core,self,other,old,remote,room,request,claim,grant,create,client,advance:ms=>{now+=ms;}};
}

test('a stale muted tab cannot replace the live call after another tab takes the spatial lease',async()=>{
 const f=await fixture(),current=await f.claim(f.self,'active-tab-0002'),active=f.client(current),idle=f.client(f.old,{micOff:true});
 await active.tick();const call=active.apiCalls.find(r=>r.endpoint==='signals').query.call;
 await idle.tick();assert.equal(posts(idle).length,0,'stale grant is denied before creation');assert.ok(idle.notice()?.isConnected);
 assert.equal(f.core.ephemeral().callSessions.find(([key])=>key.endsWith(':fixture-user'))[1].id,call);
 await active.tick();assert.equal(active.notice()?.isConnected||false,false);assert.equal(active.tracks.mic.stopCalls,0);assert.equal(active.tracks.mic.readyState,'live');
 await idle.pagehide();await active.tick();assert.equal(active.tracks.mic.stopCalls,0);await active.ended();
});

test('proximity grants bind the current instance and version and cannot replay across a lease takeover',async()=>{
 const f=await fixture(),oldGrant=await f.grant(f.self,f.old),fresh=await f.claim(f.self,'active-tab-0002');
 await assert.rejects(f.grant(f.self,f.old),replaced);
 await assert.rejects(f.grant(f.self,{...fresh,instanceId:'foreign-tab-0003'}),replaced);
 await assert.rejects(f.request(f.self,'POST','/call-session',{meeting:f.room,requestId:oldGrant.requestId,...fields(fresh)}),replaced);
 await assert.rejects(f.request(f.self,'POST','/call-session',{meeting:f.room,requestId:oldGrant.requestId,...fields(f.old)}),replaced);
 const grant=await f.grant(f.self,fresh),first=await f.request(f.self,'POST','/call-session',{meeting:f.room,requestId:grant.requestId,...fields(fresh)});
 assert.deepEqual(await f.request(f.self,'POST','/call-session',{meeting:f.room,requestId:grant.requestId,...fields(fresh)}),first,'a current retry stays idempotent');
 assert.deepEqual((await f.request(f.self,'GET','/spatial-control')).version,fresh.expectedVersion);
});

test('same-tab lease version refresh reconnects without pausing or stopping the microphone',async()=>{
 const f=await fixture(),h=f.client(f.old);await h.tick();const first=posts(h)[0].body;
 const refreshed=await f.claim(f.self,f.old.instanceId);assert.ok(refreshed.expectedVersion>f.old.expectedVersion);h.setSpatialLease(refreshed);await h.tick();
 assert.equal(posts(h).length,2);assert.equal(posts(h)[1].body.spatialVersion,refreshed.expectedVersion);assert.notEqual(posts(h)[1].body.requestId,first.requestId);
 assert.equal(h.tracks.mic.stopCalls,0);assert.equal(h.tracks.mic.readyState,'live');assert.equal(h.notice()?.isConnected||false,false);await h.ended();
});

test('ordinary5s heartbeats keep the same call across repeated1s call polls',async()=>{
 const f=await fixture(),h=f.client(f.old);await h.tick();const first=h.apiCalls.find(call=>call.endpoint==='signals').query.call;
 for(let elapsed=1000;elapsed<=20000;elapsed+=1000){f.advance(1000);h.advance(1000);if(elapsed%5000===0){const renewed=await f.request(f.self,'POST','/spatial-presence',{x:200,y:400,...f.old,takeControl:false});assert.equal(renewed.control.version,f.old.expectedVersion);}await h.tick();}
 assert.equal(posts(h).length,1);assert.equal(h.apiCalls.filter(call=>call.endpoint==='signals').at(-1).query.call,first);assert.equal(h.tracks.mic.stopCalls,0);assert.equal(h.notice()?.isConnected||false,false);await h.ended();
});

test('same-tab refresh during a pending grant ignores the obsolete result without muting devices',async()=>{
 const f=await fixture();let finish,once=true;
 const h=f.client(f.old,{intercept:async(name,body,query,normal)=>{const result=await normal(name,body,query);if(name==='call-session'&&body===undefined&&once){once=false;return new Promise(resolve=>{finish=()=>resolve(result);});}return result;}});
 const pending=h.tickPending();await new Promise(setImmediate);const refreshed=await f.claim(f.self,f.old.instanceId);h.setSpatialLease(refreshed);finish();await pending;
 assert.equal(posts(h).length,0);assert.equal(h.tracks.mic.stopCalls,0);await h.tick();assert.equal(posts(h).length,1);assert.equal(posts(h)[0].body.spatialVersion,refreshed.expectedVersion);assert.equal(h.notice()?.isConnected||false,false);await h.ended();
});

test('same-tab refresh while a creation response is pending cannot install that obsolete call',async()=>{
 const f=await fixture();let finish,once=true;
 const h=f.client(f.old,{intercept:async(name,body,query,normal)=>{const result=await normal(name,body,query);if(name==='call-session'&&body!==undefined&&once){once=false;return new Promise(resolve=>{finish=()=>resolve(result);});}return result;}});
 const pending=h.tickPending();await new Promise(setImmediate);const refreshed=await f.claim(f.self,f.old.instanceId);h.setSpatialLease(refreshed);finish();await pending;
 assert.equal(h.apiCalls.filter(c=>c.endpoint==='signals').length,0);assert.equal(h.tracks.mic.stopCalls,0);await h.tick();assert.equal(posts(h).length,2);assert.equal(h.apiCalls.filter(c=>c.endpoint==='signals').length,1);assert.equal(h.notice()?.isConnected||false,false);await h.ended();
});

test('a muted current owner may receive a proximity call and create its peer without a live capture',async()=>{
 const f=await fixture();await f.create(f.other,f.remote);const h=f.client(f.old,{micOff:true});await h.tick();
 assert.equal(posts(h).length,1);assert.equal(h.connections.length,1);assert.equal(h.connections[0].getTransceivers()[0].sender.track,null);assert.equal(h.notice()?.isConnected||false,false);await h.ended();
});

test('stale sessions cannot poll or signal and are removed from the peer roster after takeover',async()=>{
 const f=await fixture(),a=await f.create(f.self,f.old),b=await f.create(f.other,f.remote),fresh=await f.claim(f.self,'active-tab-0002');
 await assert.rejects(f.request(f.self,'GET','/signals',{}, {meeting:f.room,call:a.callId,...fields(f.old)}),replaced);
 await assert.rejects(f.request(f.self,'POST','/signal',{meeting:f.room,call:a.callId,to:'remote',toCall:b.callId,signal:{type:'renegotiate'},...fields(f.old)}),replaced);
 const snapshot=await f.request(f.other,'GET','/signals',{}, {meeting:f.room,call:b.callId,...fields(f.remote)});assert.equal(snapshot.roster['fixture-user'],undefined);
 await assert.rejects(f.request(f.other,'POST','/signal',{meeting:f.room,call:b.callId,to:'fixture-user',toCall:a.callId,signal:{type:'renegotiate'},...fields(f.remote)}),{status:409,code:'OFFICE_SIGNAL_RECIPIENT_STALE'});
 const newer=await f.create(f.self,fresh);assert.notEqual(newer.callId,a.callId);
});

test('expired spatial leases fail closed and public control does not expose the owner instance',async()=>{
 const f=await fixture(),grant=await f.grant(f.self,f.old);assert.equal(JSON.stringify(await f.request(f.self,'GET','/spatial-control')).includes(f.old.instanceId),false);f.advance(7000);
 await assert.rejects(f.request(f.self,'POST','/call-session',{meeting:f.room,requestId:grant.requestId,...fields(f.old)}),{status:403});
});

test('one-tab lease expiry preserves capture and resumes transport automatically when position renews',async()=>{
 const f=await fixture(),h=f.client(f.old);await h.tick();const oldCall=h.apiCalls.find(call=>call.endpoint==='signals').query.call;f.advance(7000);
 await h.tick();assert.equal(h.notice()?.isConnected||false,false);assert.equal(h.tracks.mic.stopCalls,0);assert.equal(h.tracks.mic.readyState,'live');
 const attempts=posts(h).length;await h.tick();assert.equal(posts(h).length,attempts,'no creation is admitted without a live lease');assert.equal(h.tracks.mic.stopCalls,0);
 const renewed=await f.claim(f.self,f.old.instanceId);h.setSpatialLease(renewed);await h.tick();assert.equal(posts(h).length,attempts+1);assert.notEqual(h.apiCalls.filter(call=>call.endpoint==='signals').at(-1).query.call,oldCall);assert.equal(h.notice()?.isConnected||false,false);assert.equal(h.tracks.mic.stopCalls,0);await h.ended();
});

test('same-instance version lag is temporary and cannot stop capture before the getter catches up',async()=>{
 const f=await fixture(),h=f.client(f.old);await h.tick();const renewed=await f.claim(f.self,f.old.instanceId);
 await assert.rejects(f.grant(f.self,f.old),{status:403});await h.tick();assert.equal(h.notice()?.isConnected||false,false);assert.equal(h.tracks.mic.stopCalls,0);
 h.setSpatialLease(renewed);await h.tick();assert.equal(posts(h).length,2);assert.equal(h.tracks.mic.stopCalls,0);await h.ended();
});

test('explicit meetings keep their existing grants and session semantics without any spatial lease',async()=>{
 const f=await fixture(),room=(await f.request(f.self,'POST','/meetings',{name:'Explicit meeting',type:'meeting'})).meeting;
 const grant=await f.request(f.self,'GET','/call-session',{}, {meeting:room.id}),first=await f.request(f.self,'POST','/call-session',{meeting:room.id,requestId:grant.requestId});
 assert.deepEqual(await f.request(f.self,'POST','/call-session',{meeting:room.id,requestId:grant.requestId}),first);
 assert.equal((await f.request(f.self,'GET','/signals',{}, {meeting:room.id,call:first.callId})).roster['fixture-user'],first.callId);
});
