import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),presence=require('./runtime/replica-spatial-presence.js'),receiver=require('./runtime/replica-spatial-receiver.js'),publisherCore=require('./runtime/spatial-publisher-core.js');
const frozenReceiver=fs.readFileSync(new URL('./fixtures/replica-spatial-receiver-220.js',import.meta.url),'utf8');
const fixtureHash=createHash('sha256').update(frozenReceiver.replace(/\r\n/g,'\n')).digest('hex');
const plain=value=>JSON.parse(JSON.stringify(value));

class Node {
 constructor(tag){this.tagName=tag;this.children=[];this.parentElement=null;this.attrs={};this.style={};this.textContent='';this.id='';}
 setAttribute(name,value){this.attrs[name]=String(value);} getAttribute(name){return this.attrs[name]??null;}
 append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
 remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(node=>node!==this);this.parentElement=null;}
 all(){return [this,...this.children.flatMap(node=>node.all())];}
 querySelector(selector){const match=/^\[([^=]+)="([^"]+)"\]$/.exec(selector);return this.all().find(node=>match&&node.getAttribute(match[1])===match[2])||null;}
}
function harness(){
 let time=100000,focused=true,controlOwned=false,suspended=false,publishImpl=async()=>({control:{active:true,version:7}}),requestImpl=async()=>({userId:'self',serverTime:time,users:[]});
 const parent=new Node('div'),map=new Node('svg');map.id='office';parent.append(map);const listeners=new Map(),intervals=new Map(),events=[],apiCalls=[];let timerId=0;
 const document={visibilityState:'visible',hasFocus:()=>focused,getElementById:id=>parent.all().find(node=>node.id===id)||null,createElement:tag=>new Node(tag),addEventListener:(name,fn)=>listeners.set('doc:'+name,fn),removeEventListener:(name,fn)=>{if(listeners.get('doc:'+name)===fn)listeners.delete('doc:'+name);}};
 const U={state:{view:'office',data:{user:{id:'self',status:'away'},users:[],capabilities:{spatialPresence:true,spatialOwnership:true,spatialSnapshots:true}}},api:async(endpoint,body,query,signal)=>{apiCalls.push({endpoint,body,query,signal});return requestImpl(signal);}};
 let receiverOptions;const window={document,performance:{now:()=>time},crypto:{randomUUID:()=> 'own-instance-private'},aureonReplicaUI:U,aureonReadSpatialPosition:()=>({x:224,y:368}),
  CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},intervalMs:[],setInterval:(fn,ms)=>{window.intervalMs.push(ms);intervals.set(++timerId,fn);return timerId;},clearInterval:id=>intervals.delete(id),
  addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name);},dispatchEvent:event=>{events.push(event);listeners.get(event.type)?.(event);},
  aureonSpatialPublisherCore:{createPublisher:options=>publisherCore.createPublisher({...options,now:()=>time})},
  aureonSpatialControlCore:{createControl:()=>({owns:()=>controlOwned,isSuspended:()=>suspended,pause:()=>{controlOwned=false;suspended=false;},requestClaim:()=>{controlOwned=false;suspended=false;return true;},publish:async point=>{const result=await publishImpl(point);controlOwned=true;return result;}})},
  aureonSpatialReceiverCore:{createReceiver:options=>{receiverOptions=options;return {tick:async()=>{const s=options.readState();if(!s.visible||s.view==='hidden')return {received:false,reason:'inactive'};try{const snapshot=await options.request();options.onSnapshot({capabilities:{spatialPresence:true},user:{id:s.user.id},users:snapshot.users});return {received:true};}catch(error){return {received:false,reason:'error',status:error.status||null};}},stop:()=>{}};}}};
 return {window,U,map,parent,events,apiCalls,intervals,listeners,get receiverOptions(){return receiverOptions;},tick:async id=>{const fn=intervals.get(id);assert.ok(fn);await fn();},advance:ms=>time+=ms,setFocus:value=>focused=value,setOwned:value=>controlOwned=value,setSuspended:value=>suspended=value,setPublish:fn=>publishImpl=fn,setRequest:fn=>requestImpl=fn,serialize:()=>JSON.stringify(parent,(key,value)=>key==='parentElement'?undefined:value)};
}
const point=(id,x=224,extra={})=>({id,name:'Fictional person',status:'away',spatialPosition:{x,y:368,floorId:'office-1',updatedAt:100000},...extra});

test('diagnostics distinguish successful publication, absent own position and zero valid peers without exposing the lease or identity',async()=>{
 const h=harness(),p=presence.install(h.window);receiver.install(h.window);await h.tick(1);await h.tick(2);await h.tick(1);
 assert.equal(h.map.getAttribute('data-spatial-diagnostic-publications'),'1');assert.equal(h.map.getAttribute('data-spatial-diagnostic-snapshots'),'1');assert.equal(h.map.getAttribute('data-spatial-diagnostic-own-position'),'absent');assert.equal(h.map.getAttribute('data-spatial-diagnostic-peers'),'0');
 assert.match(h.parent.all().map(node=>node.textContent).join(' '),/Sua posição não veio/);assert.doesNotMatch(h.serialize(),/own-instance-private|expectedVersion|"self"/);
 assert.deepEqual(h.window.aureonReadSpatialLease(),{instanceId:'own-instance-private',expectedVersion:7});const copy=h.window.aureonReadSpatialLease();copy.expectedVersion=99;assert.equal(h.window.aureonReadSpatialLease().expectedVersion,7);p.stop();assert.equal(h.window.aureonReadSpatialLease(),null);
});
test('received peer counters match eligible point bounds/status and remain distinct from proximity membership',async()=>{
 const h=harness();presence.install(h.window);receiver.install(h.window);h.setRequest(async()=>({users:[point('self'),point('peer'),point('peer'),point('offline',224,{status:'offline'}),point('bad',99999),point('archived',224,{archived:true}),point('',224)]}));await h.tick(2);await h.tick(1);
 assert.equal(h.map.getAttribute('data-spatial-diagnostic-own-position'),'present');assert.equal(h.map.getAttribute('data-spatial-diagnostic-peers'),'1');assert.match(h.parent.all().map(node=>node.textContent).join(' '),/1 colega\(s\) com posição recente/);
});
test('receiver HTTP failures retain the last actual success, recover and visibly distinguish old positions',async()=>{
 const h=harness();presence.install(h.window);receiver.install(h.window);h.setRequest(async()=>({users:[point('self')]}));await h.tick(2);await h.tick(1);h.advance(21000);h.setRequest(async()=>{throw Object.assign(Error('private upstream detail'),{status:503});});await h.tick(2);await h.tick(1);
 assert.equal(h.map.getAttribute('data-spatial-diagnostic-receiver-error'),'503');assert.equal(h.map.getAttribute('data-spatial-diagnostic-receiver-age'),'21000');assert.match(h.parent.all().map(node=>node.textContent).join(' '),/posições recebidas estão antigas/);assert.doesNotMatch(h.serialize(),/private upstream detail/);
 h.setRequest(async()=>({users:[point('self')]}));await h.tick(2);await h.tick(1);assert.equal(h.map.getAttribute('data-spatial-diagnostic-receiver-error'),'none');assert.equal(h.map.getAttribute('data-spatial-diagnostic-receiver-age'),'0');
});
test('publication errors and ownership conflict clear the internal lease; a later successful claim restores it',async()=>{
 const h=harness();presence.install(h.window);await h.tick(1);assert.ok(h.window.aureonReadSpatialLease());h.advance(5000);h.setPublish(async()=>{h.setOwned(false);h.setSuspended(true);throw Object.assign(Error('private session identifier'),{status:409});});await h.tick(1);
 assert.equal(h.window.aureonReadSpatialLease(),null);assert.equal(h.map.getAttribute('data-spatial-diagnostic-publication-error'),'409');assert.match(h.parent.all().map(node=>node.textContent).join(' '),/outra guia assumiu/);assert.doesNotMatch(h.serialize(),/private session identifier/);
 h.listeners.get('focus')({isTrusted:true});h.setPublish(async()=>({control:{active:true,version:8}}));await h.tick(1);assert.equal(h.window.aureonReadSpatialLease().expectedVersion,8);
});
test('lease is unavailable after identity change, during a pending claim and after stop; late work cannot restore it',async()=>{
 const h=harness(),p=presence.install(h.window);await h.tick(1);h.U.state.data.user.id='other';assert.equal(h.window.aureonReadSpatialLease(),null);await h.tick(1);assert.ok(h.window.aureonReadSpatialLease());h.listeners.get('focus')({isTrusted:true});assert.equal(h.window.aureonReadSpatialLease(),null);
 let finish;h.setPublish(()=>new Promise(resolve=>finish=resolve));const pending=h.tick(1);await Promise.resolve();p.stop();finish({control:{active:true,version:9}});await pending;assert.equal(h.window.aureonReadSpatialLease(),null);assert.equal(h.window.document.getElementById('officeSpatialDiagnostics'),null);
});
test('hidden receiver uses the unchanged pause rule and does not claim successful observations',async()=>{
 const h=harness();presence.install(h.window);receiver.install(h.window);h.window.document.visibilityState='hidden';await h.tick(2);await h.tick(1);assert.equal(h.apiCalls.length,0);assert.equal(h.map.getAttribute('data-spatial-receiver'),'paused');assert.equal(h.map.getAttribute('data-spatial-diagnostic-snapshots'),'0');
});
test('offline status immediately hides the internal lease, without putting any lease identifier in diagnostic attributes',async()=>{
 const h=harness();presence.install(h.window);await h.tick(1);assert.ok(h.window.aureonReadSpatialLease());h.U.state.data.user.status='offline';assert.equal(h.window.aureonReadSpatialLease(),null);await h.tick(1);assert.equal(h.map.getAttribute('data-spatial-diagnostic-publication-result'),'inactive');assert.doesNotMatch(h.serialize(),/own-instance-private|expectedVersion/);
});
test('a stopped receiver cannot emit late snapshots or diagnostics',()=>{
 const h=harness(),installed=receiver.install(h.window);installed.stop();h.receiverOptions.onSnapshot({user:{id:'self'},users:[point('peer')]});assert.deepEqual(h.events,[]);assert.equal(h.intervals.size,0);
});
test('receiver adapter keeps the frozen v30 core contract, timer cadence, API arguments and emitted snapshot unchanged',async()=>{
 assert.equal(fixtureHash,'bd496f8924a89e906ddc4f2ee1bad6a0426c7f718a66efc35b961e9615d66c88');
 const before=harness();vm.runInNewContext(frozenReceiver,{window:before.window,document:before.window.document,performance:before.window.performance,CustomEvent:before.window.CustomEvent,setInterval:before.window.setInterval,clearInterval:before.window.clearInterval});
 const after=harness();receiver.install(after.window);assert.deepEqual(after.window.intervalMs,before.window.intervalMs);assert.deepEqual(after.window.intervalMs,[200]);assert.deepEqual(plain(after.receiverOptions.readState()),plain(before.receiverOptions.readState()));assert.equal(after.receiverOptions.now(),before.receiverOptions.now());
 const signal={signal:'fixture'};await before.receiverOptions.request(signal);await after.receiverOptions.request(signal);assert.deepEqual(after.apiCalls,before.apiCalls);
 const snapshot={capabilities:{spatialPresence:true},user:{id:'self'},users:[point('peer')]};before.receiverOptions.onSnapshot(snapshot);after.receiverOptions.onSnapshot(snapshot);assert.deepEqual(plain(after.events.filter(event=>event.type==='aureon-spatial-state')),plain(before.events.filter(event=>event.type==='aureon-spatial-state')));
});
