import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {harness,expectLive,expectStoppedOnce} from './fixtures/office-call-harness.mjs';
const source=fs.readFileSync(new URL('./runtime/replica-calls-proximity.js',import.meta.url),'utf8');
const SELF='fixture-user';
function setup(remote='remote'){
 const h=harness(source,{allowPeers:true});let delivered=[],signalHandler=null,remoteCall='remote-call-1';
 h.window.aureonReplicaUI.state.view='chat';
 h.setMeeting({id:'fixture-meeting',type:'meeting',phase:'active',members:[SELF,remote],hands:{}});
 h.setApi((endpoint,body,query,normal)=>endpoint==='signals'?{members:[SELF,remote],roster:{[SELF]:query.call,[remote]:remoteCall},signals:delivered.splice(0),cursor:0}:endpoint==='signal'&&signalHandler?signalHandler(body.signal):normal(endpoint,body,query));
 return {h,deliver:signal=>delivered.push({meeting:'fixture-meeting',from:remote,fromCall:remoteCall,signal}),onSignal:handler=>{signalHandler=handler;},setRemoteCall:value=>{remoteCall=value;}};
}
const settle=()=>new Promise(setImmediate);
function fail(pc){pc.connectionState='failed';pc.iceConnectionState='failed';pc.oniceconnectionstatechange();pc.onconnectionstatechange();}

test('failed offerer restarts ICE on the same peer and call while preserving enabled devices',async()=>{
 const {h}=setup();await h.tick();const pc=h.connections[0];fail(pc);await settle();
 assert.equal(pc.restartCalls,1);assert.equal(pc.closeCalls,0);assert.equal(h.connections.length,1);
 assert.equal(h.apiCalls.filter(call=>call.endpoint==='call-session').length,1);
 assert.ok(h.apiCalls.some(call=>call.endpoint==='signal'&&call.body.signal.type==='offer'));
 expectLive(h);
});
test('repeated failure events and ticks back off to at most one attempt each thirty seconds',async()=>{
 const {h}=setup(),offers=()=>h.apiCalls.filter(call=>call.endpoint==='signal'&&call.body.signal.type==='offer').length;await h.tick();const pc=h.connections[0];fail(pc);await settle();
 for(let i=0;i<10;i++){fail(pc);await h.tick();}assert.equal(offers(),1);
 h.advance(3000);await h.tick();assert.equal(offers(),2);
 h.advance(10000);await h.tick();assert.equal(offers(),3);
 h.advance(29999);await h.tick();assert.equal(offers(),3);
 h.advance(1);await h.tick();assert.equal(offers(),4);assert.equal(pc.restartCalls,1);assert.equal(pc.localDescriptionCalls.length,1);expectLive(h);
});
test('short disconnections recover naturally; sustained disconnection can restart without replacing streams',async()=>{
 const {h}=setup();await h.tick();const pc=h.connections[0];pc.connectionState='disconnected';pc.iceConnectionState='disconnected';pc.onconnectionstatechange();
 h.advance(7999);await h.tick();assert.equal(pc.restartCalls,0);
 pc.connectionState='connected';pc.iceConnectionState='connected';pc.onconnectionstatechange();
 h.advance(10000);await h.tick();assert.equal(pc.restartCalls,0);
 pc.connectionState='disconnected';pc.iceConnectionState='disconnected';pc.onconnectionstatechange();
 h.advance(8000);await h.tick();assert.equal(pc.restartCalls,1);expectLive(h);
});
test('answerer requests a restart from the sole offerer, including a request when that offerer still looks connected',async()=>{
 const answer=setup('aaa');await answer.h.tick();const pc=answer.h.connections[0];fail(pc);await settle();
 assert.equal(pc.restartCalls,0);
 assert.ok(answer.h.apiCalls.some(call=>call.endpoint==='signal'&&call.body.signal.type==='renegotiate'&&call.body.signal.iceRestart===true));
 const offer=setup();await offer.h.tick();offer.deliver({type:'renegotiate',iceRestart:true});await offer.h.tick();
 assert.equal(offer.h.connections[0].restartCalls,1);expectLive(offer.h);expectLive(answer.h);
});
test('reconnected peers reset recovery backoff for a later, independent failure',async()=>{
 const {h,deliver}=setup();await h.tick();const pc=h.connections[0];fail(pc);await settle();
 deliver({type:'answer',sdp:'first-restart-answer'});await h.tick();assert.equal(pc.signalingState,'stable');
 pc.connectionState='connected';pc.iceConnectionState='connected';pc.onconnectionstatechange();await settle();
 fail(pc);await settle();assert.equal(pc.restartCalls,2);expectLive(h);
});
test('a transient restart-offer delivery failure retries the identical pending SDP without a second local description',async()=>{
 const {h,deliver,onSignal}=setup();let offers=0;onSignal(signal=>{if(signal.type==='offer'&&++offers===1)throw Object.assign(Error('temporary signaling outage'),{status:503});return {};});
 await h.tick();const pc=h.connections[0];fail(pc);await settle();assert.equal(pc.signalingState,'have-local-offer');assert.equal(offers,1);
 h.advance(2999);await h.tick();assert.equal(offers,1);h.advance(1);await h.tick();assert.equal(offers,2);
 const sent=h.apiCalls.filter(call=>call.endpoint==='signal'&&call.body.signal.type==='offer');assert.equal(sent[0].body.signal.sdp,sent[1].body.signal.sdp);assert.equal(pc.localDescriptionCalls.length,1);assert.equal(pc.restartCalls,1);assert.equal(pc.closeCalls,0);
 deliver({type:'answer',sdp:'recovered-answer'});await h.tick();assert.equal(pc.signalingState,'stable');pc.connectionState='connected';pc.iceConnectionState='connected';pc.onconnectionstatechange();h.advance(30000);await h.tick();assert.equal(offers,2);
 assert.equal(h.apiCalls.filter(call=>call.endpoint==='call-session').length,1);expectLive(h);
});
test('pending offer retries keep exponential backoff and serialize concurrent recovery events',async()=>{
 const {h,onSignal}=setup();let offers=0,complete;onSignal(signal=>{if(signal.type!=='offer')return {};offers++;if(offers<3)throw Object.assign(Error('still unavailable'),{status:503});return new Promise(resolve=>{complete=resolve;});});
 await h.tick();const pc=h.connections[0];fail(pc);await settle();h.advance(3000);await h.tick();assert.equal(offers,2);h.advance(9999);await h.tick();assert.equal(offers,2);
 h.advance(1);const pending=h.tickPending();await settle();assert.equal(offers,3);fail(pc);await pc.onnegotiationneeded();await h.tick();assert.equal(offers,3);assert.equal(pc.localDescriptionCalls.length,1);
 complete({});await pending;expectLive(h);assert.equal(pc.closeCalls,0);
});
test('an answer applied before an ambiguous failed POST response invalidates the old offer retry',async()=>{
 const {h,deliver,onSignal}=setup();let rejectOffer,offers=0;onSignal(signal=>{if(signal.type==='offer'){offers++;return new Promise((resolve,reject)=>{rejectOffer=reject;});}return {};});
 await h.tick();const pc=h.connections[0];fail(pc);await settle();deliver({type:'answer',sdp:'already-delivered-answer'});await h.tick();assert.equal(pc.signalingState,'stable');pc.connectionState='connected';pc.iceConnectionState='connected';pc.onconnectionstatechange();
 rejectOffer(Object.assign(Error('response lost after delivery'),{status:503}));await settle();h.advance(30000);await h.tick();assert.equal(offers,1);assert.equal(pc.localDescriptionCalls.length,1);assert.equal(pc.closeCalls,0);expectLive(h);
 deliver({type:'answer',sdp:'already-delivered-answer'});await h.tick();assert.equal(pc.remoteDescriptionCalls.length,1);assert.equal(h.warnings.length,1);
});

test('an answer already fetched by the poll is applied before starting any due offer replay',async()=>{
 const {h,deliver,onSignal}=setup();let offers=0;onSignal(signal=>{if(signal.type==='offer'){offers++;if(offers>1)return new Promise(()=>{});}return {};});
 await h.tick();const pc=h.connections[0];fail(pc);await settle();assert.equal(offers,1);h.advance(3000);
 deliver({type:'answer',sdp:'already-fetched-answer'});pc.connectionState='connected';pc.iceConnectionState='connected';await h.tick();
 assert.equal(pc.signalingState,'stable');assert.equal(pc.remoteDescriptionCalls.length,1);assert.equal(offers,1);const polls=h.apiCalls.filter(call=>call.endpoint==='signals').length;
 await h.tick();assert.equal(h.apiCalls.filter(call=>call.endpoint==='signals').length,polls+1);assert.equal(offers,1);expectLive(h);
});

test('a pending offer replay cannot block later polls from receiving its answer or preserve obsolete retries',async()=>{
 const {h,deliver,onSignal}=setup();let offers=0,complete;onSignal(signal=>signal.type==='offer'&&++offers===2?new Promise(resolve=>{complete=resolve;}):{});
 await h.tick();const pc=h.connections[0];fail(pc);await settle();h.advance(3000);await h.tick();assert.equal(offers,2);assert.equal(typeof complete,'function');assert.equal(pc.signalingState,'have-local-offer');
 const polls=h.apiCalls.filter(call=>call.endpoint==='signals').length;deliver({type:'answer',sdp:'answer-while-replay-pending'});pc.connectionState='connected';pc.iceConnectionState='connected';await h.tick();
 assert.equal(h.apiCalls.filter(call=>call.endpoint==='signals').length,polls+1);assert.equal(pc.signalingState,'stable');assert.equal(pc.remoteDescriptionCalls.length,1);assert.equal(pc.localDescriptionCalls.length,1);expectLive(h);
 complete({});await settle();h.advance(30000);await h.tick();assert.equal(offers,2);assert.equal(pc.closeCalls,0);assert.equal(h.apiCalls.filter(call=>call.endpoint==='call-session').length,1);expectLive(h);
});

test('a restart request followed by an answer in the same poll cannot block behind the replay POST',async()=>{
 const {h,deliver,onSignal}=setup();let offers=0,complete;onSignal(signal=>signal.type==='offer'&&++offers===2?new Promise(resolve=>{complete=resolve;}):{});
 await h.tick();const pc=h.connections[0];fail(pc);await settle();h.advance(3000);deliver({type:'renegotiate',iceRestart:true});deliver({type:'answer',sdp:'answer-after-restart-request'});await h.tick();
 assert.equal(offers,2);assert.equal(typeof complete,'function');assert.equal(pc.signalingState,'stable');assert.equal(pc.remoteDescriptionCalls.length,1);const polls=h.apiCalls.filter(call=>call.endpoint==='signals').length;
 pc.connectionState='connected';pc.iceConnectionState='connected';await h.tick();assert.equal(h.apiCalls.filter(call=>call.endpoint==='signals').length,polls+1);expectLive(h);
 complete({});await settle();h.advance(30000);await h.tick();assert.equal(offers,2);assert.equal(pc.closeCalls,0);expectLive(h);
});

test('pending first and duplicate answer POSTs never hold polling or reapply the same descriptions',async()=>{
 const {h,deliver,onSignal}=setup('aaa'),pending=[];let answers=0;onSignal(signal=>signal.type==='answer'?(answers++,new Promise(resolve=>pending.push(resolve))):{});
 await h.tick();const pc=h.connections[0],offer={type:'offer',sdp:'incoming-offer'};deliver(offer);await h.tick();assert.equal(answers,1);assert.equal(pc.signalingState,'stable');const polls=h.apiCalls.filter(call=>call.endpoint==='signals').length;
 await h.tick();deliver(offer);await h.tick();assert.equal(answers,2);assert.equal(h.apiCalls.filter(call=>call.endpoint==='signals').length,polls+2);assert.equal(pc.remoteDescriptionCalls.length,1);assert.equal(pc.localDescriptionCalls.length,1);expectLive(h);
 for(const finish of pending)finish({});await settle();await h.tick();assert.equal(answers,2);assert.equal(pc.closeCalls,0);expectLive(h);
});

test('session termination makes detached answer, offer and recovery completions inert',async()=>{
 for(const branch of ['answer','offer','renegotiate']){
  const {h,deliver,onSignal}=setup(branch==='answer'?'aaa':'remote');let rejectPost;onSignal(signal=>['answer','offer'].includes(signal.type)?new Promise((resolve,reject)=>{rejectPost=reject;}):{});
  await h.tick();const pc=h.connections[0];if(branch==='answer'){deliver({type:'offer',sdp:'pending-answer'});await h.tick();}else if(branch==='offer'){await pc.onnegotiationneeded();await settle();}else{deliver({type:'renegotiate',iceRestart:true});await h.tick();await settle();}
  assert.equal(typeof rejectPost,'function');await h.ended();const requests=h.apiCalls.length,warnings=h.warnings.length;assert.equal(pc.closeCalls,1);expectStoppedOnce(h);
  rejectPost(Object.assign(Error('obsolete signaling timeout'),{status:503}));await settle();h.advance(30000);await h.tick();assert.equal(h.apiCalls.length,requests);assert.equal(h.warnings.length,warnings);assert.equal(h.connections.length,1);expectStoppedOnce(h);
 }
});
test('an acknowledged offer recovers a failed or lost answer by replaying the same descriptions without applying them twice',async()=>{
 for(const failureStatus of [503,null]){
  const offerer=setup(),answerer=setup('aaa');let answerAttempts=0;
  offerer.onSignal(signal=>{if(signal.type==='offer')answerer.deliver(signal);return {};});
  answerer.onSignal(signal=>{if(signal.type==='answer'){if(++answerAttempts===1){if(failureStatus)throw Object.assign(Error('answer POST unavailable'),{status:failureStatus});return {};}offerer.deliver(signal);}return {};});
  await offerer.h.tick();await answerer.h.tick();const offerPc=offerer.h.connections[0],answerPc=answerer.h.connections[0];fail(offerPc);await settle();await answerer.h.tick();
  assert.equal(offerPc.signalingState,'have-local-offer');assert.equal(answerPc.signalingState,'stable');assert.equal(answerAttempts,1);
  offerer.h.advance(3000);await offerer.h.tick();await answerer.h.tick();await offerer.h.tick();assert.equal(answerAttempts,2);assert.equal(offerPc.signalingState,'stable');
  assert.equal(offerPc.localDescriptionCalls.length,1);assert.equal(offerPc.remoteDescriptionCalls.length,1);assert.equal(answerPc.remoteDescriptionCalls.length,1);assert.equal(answerPc.localDescriptionCalls.length,1);
  const offers=offerer.h.apiCalls.filter(call=>call.endpoint==='signal'&&call.body.signal.type==='offer'),answers=answerer.h.apiCalls.filter(call=>call.endpoint==='signal'&&call.body.signal.type==='answer');assert.equal(offers.length,2);assert.equal(offers[0].body.signal.sdp,offers[1].body.signal.sdp);assert.equal(answers[0].body.signal.sdp,answers[1].body.signal.sdp);expectLive(offerer.h);expectLive(answerer.h);
 }
});
test('retryable delivery errors include network failures, timeout and rate limiting, but not rejected SDP',async()=>{
 for(const status of [undefined,408,429,400]){
  const {h,onSignal}=setup();let offers=0;onSignal(signal=>{if(signal.type==='offer'){offers++;throw Object.assign(Error('delivery failure'),status===undefined?{}:{status});}return {};});
  await h.tick();const pc=h.connections[0];fail(pc);await settle();h.advance(3000);await h.tick();assert.equal(offers,status===400?1:2);assert.equal(pc.localDescriptionCalls.length,1);expectLive(h);
 }
});
test('failed initial offer delivery retries even when the peer is new or still reports connected',async()=>{
 for(const connectionState of ['new','connected']){
  const {h,deliver,onSignal}=setup();let offers=0;onSignal(signal=>{if(signal.type==='offer'&&++offers===1)throw Object.assign(Error('initial delivery outage'),{status:503});return {};});
  await h.tick();const pc=h.connections[0];pc.connectionState=connectionState;pc.iceConnectionState=connectionState;pc.onnegotiationneeded();await settle();assert.equal(offers,1);assert.equal(pc.signalingState,'have-local-offer');
  h.advance(2999);await h.tick();assert.equal(offers,1);h.advance(1);await h.tick();assert.equal(offers,2);assert.equal(pc.restartCalls,0);assert.equal(pc.localDescriptionCalls.length,1);
  deliver({type:'answer',sdp:'initial-answer'});await h.tick();assert.equal(pc.signalingState,'stable');expectLive(h);
 }
});
test('a late failed offer from an obsolete peer or own call cannot affect the replacement',async()=>{
 for(const replacement of ['remote','own']){
  const {h,onSignal,setRemoteCall}=setup();let rejectOffer;onSignal(signal=>signal.type==='offer'?new Promise((resolve,reject)=>{rejectOffer=reject;}):{});
  await h.tick();const old=h.connections[0];fail(old);await settle();
  if(replacement==='remote'){setRemoteCall('remote-call-2');await h.tick();}
  else{h.failApi(409);await h.tick();h.failApi(null);await h.tick();}
  assert.equal(old.closeCalls,1);assert.equal(h.connections.length,2);rejectOffer(Object.assign(Error('obsolete failure'),{status:503}));await settle();h.advance(30000);await h.tick();
  assert.equal(h.apiCalls.filter(call=>call.endpoint==='signal'&&call.body.signal.type==='offer').length,1);assert.equal(h.warnings.length,0);assert.equal(h.connections[1].closeCalls,0);expectLive(h);
 }
});
test('a session replacement discovered during an offer retry still stops capture and requires explicit resume',async()=>{
 const {h,onSignal}=setup();let offers=0;onSignal(signal=>{if(signal.type==='offer'){if(++offers===1)throw Object.assign(Error('temporary outage'),{status:503});throw Object.assign(Error('own call replaced'),{status:409,code:'OFFICE_CALL_SESSION_REPLACED'});}return {};});
 await h.tick();const pc=h.connections[0];fail(pc);await settle();h.advance(3000);await h.tick();assert.equal(offers,2);assert.equal(pc.closeCalls,1);assert.ok(h.notice());expectStoppedOnce(h);
 const count=h.apiCalls.length;h.advance(30000);await h.tick();assert.equal(h.apiCalls.length,count);expectStoppedOnce(h);
});
test('a replaced local SDP or departed session can never replay an obsolete failed offer',async()=>{
 for(const invalidate of ['description','leave','ended']){
  const {h,onSignal}=setup();let offers=0;onSignal(signal=>{if(signal.type==='offer'){offers++;throw Object.assign(Error('temporary outage'),{status:503});}return {};});
  await h.tick();const pc=h.connections[0];fail(pc);await settle();
  if(invalidate==='description')pc.localDescription={type:'offer',sdp:'different-local-sdp'};
  else if(invalidate==='leave'){h.setMeeting(null);await h.state();}else await h.ended();
  h.advance(30000);await h.tick();assert.equal(offers,1);assert.equal(pc.localDescriptionCalls.length,1);if(invalidate==='description')expectLive(h);else expectStoppedOnce(h);
 }
});
test('stale connection events after departure or session termination cannot reconnect or capture',async()=>{
 for(const terminate of ['leave','ended']){
  const {h}=setup();await h.tick();const pc=h.connections[0];
  if(terminate==='leave'){h.setMeeting(null);await h.state();}else await h.ended();
  const requests=h.apiCalls.length;fail(pc);await settle();await h.tick();
  assert.equal(pc.restartCalls,0);assert.equal(h.apiCalls.length,requests);expectStoppedOnce(h);
 }
});
test('restart requests retain server membership checks and only accept a literal true restart flag',async()=>{
 const require=createRequire(import.meta.url),{createInterfaceService}=require('../src/lib/office/runtime/vendor/interface-api.cjs');
 const service=createInterfaceService({now:()=>1000}),a={user:{id:'a',profileId:'a',name:'A'},role:'agent',capabilities:{}},b={user:{id:'b',profileId:'b',name:'B'},role:'agent',capabilities:{}};
 const request=(who,method,path,body={},query={})=>service.requestAsCrm(who,method,path,body,query);
 for(const who of [a,b]){await request(who,'GET','/state');await request(who,'POST','/spatial-presence',{x:who===a?200:300,y:400});}
 const room=(await request(a,'GET','/proximity')).room,ca=await request(a,'POST','/call-session',{meeting:room.id}),cb=await request(b,'POST','/call-session',{meeting:room.id});
 for(const flag of [true,'true',false])await request(a,'POST','/signal',{meeting:room.id,call:ca.callId,to:'b',toCall:cb.callId,signal:{type:'renegotiate',iceRestart:flag,privateData:'discard'}});
 const received=await request(b,'GET','/signals',{}, {meeting:room.id,call:cb.callId,after:0});
 assert.deepEqual(received.signals.map(event=>event.signal),[{type:'renegotiate',iceRestart:true},{type:'renegotiate'},{type:'renegotiate'}]);
 await request(a,'POST','/spatial-presence',{x:900,y:400});
 await assert.rejects(request(a,'POST','/signal',{meeting:room.id,call:ca.callId,to:'b',toCall:cb.callId,signal:{type:'renegotiate',iceRestart:true}}),{status:403});
});
