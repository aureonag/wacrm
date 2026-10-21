import assert from 'node:assert/strict';
import vm from 'node:vm';
const SELF='fixture-user';
function harness(source,{allowPeers=false,testTone=false,audioTests=false,ownership=null}={}){
 const events=new Map(),intervals=[],apiCalls=[],levels=[],warnings=[];
 let activeMeeting=null,apiStatus=null,apiCode=null,serial=0,responder=null,remoteCall='remote-call-1',clock=1000,spatialOwnership=ownership,spatialLease={instanceId:'fixture-tab-0001',expectedVersion:1};
 const connections=[],audioContexts=[],toneTimers=[],signalDeadlines=new Map();let timerSerial=0;
 const track=kind=>({kind,readyState:'live',enabled:true,stopCalls:0,stop(){this.stopCalls++;this.readyState='ended';this.enabled=false;}});
 const tracks={mic:track('audio'),camera:track('video'),screen:track('video')};
 const stream=track=>({getTracks:()=>[track],getAudioTracks:()=>track.kind==='audio'?[track]:[],getVideoTracks:()=>track.kind==='video'?[track]:[]});
 class Element{
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.style={};this.parent=null;this.listeners=new Map();}
  get isConnected(){return this.parent===true||!!this.parent?.isConnected;}
  append(...children){for(const child of children){child.parent=this;this.children.push(child);}}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;}
  querySelectorAll(){return [];}
  querySelector(){return null;}
  setAttribute(name,value){this[name]=value;}
  addEventListener(type,listener){this.listeners.set(type,listener);}
  focus(){document.activeElement=this;}
  play(){return Promise.resolve();}
  click(){this.listeners.get('click')?.();}
 }
 const body=new Element('body'),head=new Element('head'),tiles=[];body.parent=true;head.parent=true;
 function find(node,id){if(node.id===id)return node;for(const child of node.children){const found=find(child,id);if(found)return found;}return null;}
 const document={body,head,createElement:tag=>new Element(tag),getElementById:id=>id==='office'&&spatialOwnership!==null?{getAttribute:()=>spatialOwnership}:find(body,id),querySelector:()=>null,querySelectorAll:()=>tiles.filter(tile=>!tile.removed)};
 const state={view:'office',data:{user:{id:SELF,status:'online',preferences:{}}}};
 const normal=(endpoint,body,query)=>{
  if(endpoint==='call-session')return body===undefined?{requestId:'fixture-grant-'+(++serial)}:{callId:'fixture-call-'+(++serial)};
  if(endpoint==='signals')return {members:[...activeMeeting.members],roster:{[SELF]:query.call,...(activeMeeting.members.includes('remote')?{remote:remoteCall}:{})},signals:[],cursor:0};
  return {};
 };
 const api=async(endpoint,body,query,signal)=>{
  apiCalls.push({endpoint,body,query,signal});
  if(apiStatus!==null)throw Object.assign(Error('fixture request denied'),{status:apiStatus,code:apiCode});
  const result=responder?responder(endpoint,body,query,normal):normal(endpoint,body,query);
  if(!signal)return result;
  return new Promise((resolve,reject)=>{const abort=()=>{cleanup();reject(Object.assign(Error('The operation was aborted'),{name:'AbortError'}));},cleanup=()=>signal.removeEventListener('abort',abort);if(signal.aborted){abort();return;}signal.addEventListener('abort',abort,{once:true});Promise.resolve(result).then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});});
 };
 const window={
  aureonReplicaUI:{state,api,center:new Element(),el:tag=>new Element(tag),button:()=>new Element('button'),toast(){},person:id=>({id,name:'Fixture'}),refresh:async()=>{}},
  aureonReplicaMeetings:{active:()=>activeMeeting},aureonOfficeBootstrap:{active:true},
  aureonReadSpatialLease:()=>spatialLease&&{...spatialLease},
  aureonAudioStream:()=>stream(tracks.mic),aureonCameraStream:()=>stream(tracks.camera),aureonScreenStream:()=>stream(tracks.screen),
  aureonStopMicrophone:()=>tracks.mic.stop(),aureonStopCamera:()=>tracks.camera.stop(),aureonStopScreen:()=>tracks.screen.stop(),
  aureonUpdateMicLevel:level=>levels.push(level),
  addEventListener(type,listener){const list=events.get(type)||[];list.push(listener);events.set(type,list);},
  removeEventListener(type,listener){events.set(type,(events.get(type)||[]).filter(item=>item!==listener));},
 };
 class FakeStream{
  constructor(items=[]){if(!allowPeers)throw Error('Real media construction is forbidden in this fixture');this.items=items;}
  getTracks(){return this.items;}getVideoTracks(){return this.items.filter(item=>item.kind==='video');}getAudioTracks(){return this.items.filter(item=>item.kind==='audio');}addTrack(item){this.items.push(item);}
 }
 class FakePeer{
  constructor(){if(!allowPeers)throw Error('Peer networking is forbidden in this fixture');this.slots=[];this.signalingState='stable';this.connectionState='connected';this.iceConnectionState='connected';this.localDescription={type:'offer',sdp:'v=0\r\na=ice-ufrag:initial-local\r\n'};this.remoteDescription={type:'answer',sdp:'v=0\r\na=ice-ufrag:initial-remote\r\n'};this.localDescriptionCalls=[];this.remoteDescriptionCalls=[];this.iceCandidateCalls=[];this.descriptionSerial=0;this.closeCalls=0;this.restartCalls=0;connections.push(this);}
  addTransceiver(){const sender={track:null,setStreams(){},async replaceTrack(item){this.track=item;}};const slot={sender,direction:'sendrecv',mid:String(this.slots.length)};this.slots.push(slot);return slot;}
  getTransceivers(){return this.slots;}createDataChannel(){return {readyState:'open',close(){},send(){}};}
  async setLocalDescription(){const type=this.signalingState==='have-remote-offer'?'answer':'offer';if(type==='offer'&&this.signalingState!=='stable')throw Error('Invalid local offer state: '+this.signalingState);this.localDescription={type,sdp:'v=0\r\no=- 1 '+(++this.descriptionSerial)+' IN IP4 0.0.0.0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:0\r\na=ice-ufrag:fake-'+type+'-'+this.descriptionSerial+'\r\n'};this.localDescriptionCalls.push({...this.localDescription});this.signalingState=type==='offer'?'have-local-offer':'stable';}
  async setRemoteDescription(value){if(value.type==='answer'&&this.signalingState!=='have-local-offer')throw Error('Invalid remote answer state: '+this.signalingState);if(value.type==='offer'&&!['stable','have-remote-offer'].includes(this.signalingState))throw Error('Invalid remote offer state: '+this.signalingState);this.remoteDescription={...value};this.remoteDescriptionCalls.push({...value});this.signalingState=value.type==='offer'?'have-remote-offer':'stable';}
  appendCandidate(description,candidate){if(description)description.sdp=description.sdp.replace(/\r?\n$/,'')+'\r\na='+(candidate||'end-of-candidates')+'\r\n';}
  gatherCandidate(candidate='candidate:1 1 UDP 1 192.0.2.1 1234 typ host'){this.appendCandidate(this.localDescription,candidate);}
  async addIceCandidate(candidate){this.iceCandidateCalls.push({...candidate});if(!this.remoteDescription)throw Object.assign(Error('No remote description'),{name:'InvalidStateError'});const fragments=this.remoteDescription.sdp.match(/^a=ice-ufrag:[^\s]+/gm)?.map(line=>line.slice(12))||[];if(candidate.usernameFragment&&!fragments.includes(candidate.usernameFragment))throw Object.assign(Error('ICE usernameFragment mismatch'),{name:'OperationError'});this.appendCandidate(this.remoteDescription,candidate.candidate);}
  async getStats(){return new Map();}
  restartIce(){this.restartCalls++;if(this.signalingState==='stable')Promise.resolve().then(()=>{if(this.signalingState==='stable')return this.onnegotiationneeded?.();});}
  close(){this.closeCalls++;this.connectionState='closed';this.signalingState='closed';}
 }
 const tone=track('audio'),toneContext={closeCalls:0,close(){this.closeCalls++;return Promise.resolve();}};
 class FakeAudioContext{
  constructor(){if(!audioTests)throw Error('Audio generation forbidden');this.track=track('audio');this.closeCalls=0;this.state='running';audioContexts.push(this);}
  createMediaStreamDestination(){return {stream:stream(this.track)};}
  createOscillator(){return {frequency:{value:0},connect(){},start(){},stop(){}};}
  createGain(){return {gain:{value:0},connect(){}};}resume(){return Promise.resolve();}close(){this.closeCalls++;this.state='closed';return Promise.resolve();}
 }
 window.AudioContext=FakeAudioContext;
 const sandbox={window,document,console:{warn:(...args)=>warnings.push(args)},
  setInterval(callback,ms){intervals.push({callback,ms});return intervals.length;},clearInterval(){},
  setTimeout(callback,ms){const id=++timerSerial;if(ms===10000){signalDeadlines.set(id,{callback,due:clock+ms});return id;}if(!audioTests||ms!==8000)throw Error('Unexpected timer/device transmission in this fixture');toneTimers.push(callback);return id;},clearTimeout(id){signalDeadlines.delete(id);},AbortController,
  Date:class extends Date{static now(){return clock;}},MutationObserver:class{observe(){}},
  RTCPeerConnection:FakePeer,MediaStream:FakeStream,fakeTestAudio:stream(tone),fakeTestContext:toneContext,
 };
 if(testTone)source=source.replace('let testAudio=null,testContext=null;','let testAudio=globalThis.fakeTestAudio,testContext=globalThis.fakeTestContext;');
 if(audioTests)source=source.replace(' function closePeer(id){',' globalThis.fixtureTestTransmission=testTransmission;\n function closePeer(id){');
 new vm.Script(source,{filename:'reviewed-replica-calls.js'}).runInNewContext(sandbox,{timeout:1000,contextCodeGeneration:{strings:false,wasm:false}});
 assert.equal(intervals.length,1);assert.equal(intervals[0].ms,1000);
 return {window,tracks,apiCalls,levels,warnings,connections,tone,toneContext,audioContexts,transmit:()=>sandbox.fixtureTestTransmission(),fireTone:index=>toneTimers[index](),
  addTile(id,kind='screen'){const video={srcObject:stream(tracks.screen),pauseCalls:0,pause(){this.pauseCalls++;}};const tile={dataset:{[kind==='screen'?'screen':'user']:id},removed:false,querySelectorAll:()=>[video],remove(){this.removed=true;}};tiles.push(tile);return {tile,video};},
  setMeeting(value){activeMeeting=value;},setSpatialLease(value){spatialLease=value&&{...value};},setSpatialOwnership(value){spatialOwnership=value;},failApi(status,code=null){apiStatus=status;apiCode=code;},setApi(callback){responder=callback;},setRemoteCall(value){remoteCall=value;},
  advance(ms){clock+=ms;for(const [id,timer]of [...signalDeadlines])if(timer.due<=clock){signalDeadlines.delete(id);timer.callback();}},pendingSignalDeadlines:()=>signalDeadlines.size,
  notice:()=>find(body,'aureonCallPaused'),
  async resume(){find(body,'aureonCallPaused')?.children[2].click();await new Promise(setImmediate);},
  tickPending(){return intervals[0].callback();},
  async tick(){await intervals[0].callback();await new Promise(setImmediate);},
  async state(){for(const listener of events.get('aureon-interface-state')||[])listener({type:'aureon-interface-state'});await new Promise(setImmediate);},
  async ended(){for(const listener of events.get('aureon-office-session-ended')||[])listener({type:'aureon-office-session-ended'});await new Promise(setImmediate);},
  async pagehide(){for(const listener of events.get('pagehide')||[])listener({type:'pagehide'});await new Promise(setImmediate);},
  speak(level){window.aureonUpdateMicLevel(level);},
 };
}
function expectLive(h){for(const track of Object.values(h.tracks)){assert.equal(track.readyState,'live');assert.equal(track.enabled,true);assert.equal(track.stopCalls,0);}}
function expectStoppedOnce(h){for(const track of Object.values(h.tracks)){assert.equal(track.readyState,'ended');assert.equal(track.enabled,false);assert.equal(track.stopCalls,1);}}
function selfMeeting(){return {id:'fixture-meeting',members:[SELF],hands:{}};}


export {harness,expectLive,expectStoppedOnce};
