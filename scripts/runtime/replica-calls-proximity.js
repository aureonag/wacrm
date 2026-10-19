
/* CRM-scoped WebRTC calls with STUN and bounded ICE-restart backoff. */
(() => {
 'use strict';
 const U=window.aureonReplicaUI,{state,api,el,button,toast,person}=U;
 const peers=new Map();let roomId=null,callId=null,signalCursor=0,ticking=false,wasJoined=false,generation=0;
 let nearbyRoom=null,roomKind=null;
 const explicitMeeting=()=>window.aureonReplicaMeetings?.active();
 const meeting=()=>state.data?.user.status==='offline'?null:explicitMeeting()||nearbyRoom;
 async function refreshProximity(){
  if(explicitMeeting()||state.data?.capabilities?.proximityAudio!==true){nearbyRoom=null;return;}
  const office=document.getElementById('office');if(state.data?.capabilities?.spatialOwnership===true&&office?.getAttribute('data-spatial-ownership')!=='controlled'){nearbyRoom=null;return;}
  const user=state.data?.user?.id,result=await api('proximity');if(state.data?.user?.id!==user||explicitMeeting()||!window.aureonOfficeBootstrap.active)return;nearbyRoom=result.room;
 }
 function clearProximity(){nearbyRoom=null;document.getElementById('replicaProximity')?.remove();}
 let testAudio=null,testContext=null;
 const callSession=(function createOfficeCallSession(env) {
  const win = env.window, doc = env.document;
  let paused = false, disposed = false, resuming = false, notice = null, style = null, resumeButton = null;
  function context() { try { return env.getContext(); } catch { return null; } }
  function admitted(value) {
    return value?.active === true && value.selfId && value.status !== 'offline' && value.meeting?.phase !== 'completed'
      && Array.isArray(value.meeting?.members) && value.meeting.members.includes(value.selfId);
  }
  function capture() {
    const value = context();
    return !disposed && !paused && admitted(value) && value.roomId === value.meeting.id && value.callId
      ? {generation:value.generation, roomId:value.roomId, callId:value.callId} : null;
  }
  function isCurrent(token) {
    const value = capture();
    return !!token && !!value && token.generation === value.generation && token.roomId === value.roomId && token.callId === value.callId;
  }
  function render() {
    if (disposed || !paused) { notice?.remove(); return; }
    if (!notice) {
      style = doc.createElement('style');
      style.textContent = '.aureon-call-paused{position:fixed;top:16px;right:16px;z-index:95;width:min(420px,calc(100% - 32px));box-sizing:border-box;padding:16px;border:1px solid var(--crm-border,#454545);border-radius:12px;background:var(--crm-card,#292a2c);color:var(--crm-text,#e0e0e0);font:inherit;box-shadow:0 4px 18px #0003}.aureon-call-paused strong{display:block;font-size:14px}.aureon-call-paused p{font-size:12px;line-height:1.5;margin:8px 0 12px;color:var(--crm-muted,#b9bcc4)}.aureon-call-paused button{font:inherit;font-size:12px;padding:8px 12px;border:1px solid #75608f;border-radius:8px;background:#47316d;color:#f0f1f6}.aureon-call-paused button:focus-visible{outline:2px solid #bfa5ff;outline-offset:3px}.aureon-call-paused button:disabled{opacity:.6;cursor:default}';
      (doc.head || doc.body).append(style);
      notice = doc.createElement('aside'); notice.className = 'aureon-call-paused'; notice.id = 'aureonCallPaused';
      notice.setAttribute('role', 'status');
      const title = doc.createElement('strong'); title.textContent = 'Chamada pausada nesta guia';
      const help = doc.createElement('p'); help.textContent = 'A sessão desta chamada foi substituída. Retome aqui se quiser continuar nesta guia. Depois, ligue seus dispositivos quando quiser.';
      resumeButton = doc.createElement('button'); resumeButton.type = 'button'; resumeButton.textContent = 'Retomar chamada aqui';
      resumeButton.addEventListener('click', () => { void resume(); });
      notice.append(title, help, resumeButton);
    }
    resumeButton.disabled = resuming || !admitted(context());
    if (!notice.isConnected) doc.body.append(notice);
  }
  function handle(error, token) {
    if (error?.status !== 409 || error.code !== 'OFFICE_CALL_SESSION_REPLACED') return false;
    // Even an obsolete replacement error is consumed; it must not reset the new call.
    if (!isCurrent(token)) return true;
    paused = true;
    env.disconnect();
    render();
    return true;
  }
  async function resume() {
    if (disposed || !paused || resuming || !admitted(context())) return false;
    resuming = true; paused = false; render();
    try { await env.reconnect(); return !disposed && !paused; }
    catch { return false; }
    finally { resuming = false; render(); }
  }
  function blockCapture(event) {
    if (disposed || !paused || !event.target?.closest?.('#mic,#camera,#screen,#micSettings,#cameraSettings,#devicePopover')) return;
    event.preventDefault(); event.stopImmediatePropagation(); render(); resumeButton?.focus();
  }
  win.addEventListener('click', blockCapture, true);
  win.addEventListener('change', blockCapture, true);
  function dispose() {
    if (disposed) return;
    disposed = true;
    win.removeEventListener?.('click', blockCapture, true); win.removeEventListener?.('change', blockCapture, true);
    notice?.remove(); style?.remove();
  }
  return {capture, isCurrent, handle, render, resume, dispose, isPaused:()=>paused, canRun:()=>!disposed && !paused};
})({window,document,getContext:()=>({active:window.aureonOfficeBootstrap.active,selfId:state.data?.user?.id,status:state.data?.user?.status,meeting:meeting(),generation,roomId,callId}),disconnect:()=>disconnectSession(),reconnect:()=>tick()});
 const mediaSources=(function createOfficeMediaSources(env) {
  const listeners = new Set();
  let revision = 0;
  let cleared = false;
  let notifying = false;
  const empty = () => Object.freeze({
    revision,
    sessionId: null,
    participants: Object.freeze([]),
    sources: Object.freeze([]),
  });
  let snapshot = empty();
  let publishedRevision = revision;

  function text(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  function avatar(value) {
    if (typeof value !== 'string' || /[\\\s%?#]/.test(value)) return null;
    const origin = env.window.location?.origin;
    if (!origin || value.split('/').some(part => part === '.' || part === '..')) return null;
    try {
      const url = new URL(value, origin);
      if (url.origin !== origin || url.username || url.password || url.search || url.hash) return null;
      if (!/^\/api\/office\/runtime\/assets\/[a-zA-Z0-9_./-]+\.png$/.test(url.pathname)) return null;
      if (url.pathname.split('/').some((part, index) => index > 0 && !part)) return null;
      return url.pathname;
    } catch {
      return null;
    }
  }

  function usable(stream) {
    return !!stream && typeof stream.getVideoTracks === 'function'
      && stream.getVideoTracks().some(track => track?.readyState === 'live' && !track.muted);
  }

  function read() {
    const win = env.window;
    const self = env.getState()?.data?.user;
    const selfId = text(self?.id);
    if (win.aureonOfficeBootstrap?.active !== true || !selfId || self.status === 'offline') return null;
    const meeting = env.getMeeting();
    const sessionId = text(meeting?.id);
    if (!sessionId || meeting.phase === 'completed' || !Array.isArray(meeting.members)
      || !meeting.members.includes(selfId)) return null;

    const participants = [];
    const sources = [];
    const members = new Set(meeting.members.filter(id => text(id) === id));
    const currentRoom = env.getRoomId() === sessionId && !!text(env.getCallId());
    for (const id of members) {
      const isSelf = id === selfId;
      const details = env.person(id) || (isSelf ? self : null);
      const name = text(details?.name) || (isSelf ? 'Você' : 'Participante');
      participants.push({id, name, isSelf, avatarUrl: avatar(details?.avatarUrl)});
      const peer = !isSelf && currentRoom ? env.getPeer(id) : null;
      const admittedPeer = peer && peer.id === id && !!text(peer.callId) ? peer : null;
      const screen = isSelf ? win.aureonScreenStream?.() : admittedPeer?.screen;
      const camera = isSelf
        ? self.preferences?.hideSelf === true ? null : win.aureonCameraStream?.()
        : admittedPeer?.camera;
      for (const [kind, stream] of [['screen', screen], ['camera', camera]]) {
        if (usable(stream)) sources.push({
          id: sessionId + ':' + id + ':' + kind,
          kind,
          participantId: id,
          label: (kind === 'screen' ? 'Tela de ' : 'Câmera de ') + name,
          isSelf,
          stream,
        });
      }
    }
    return {sessionId, participants, sources};
  }

  function same(next) {
    if (!next) return snapshot.sessionId === null;
    if (snapshot.sessionId !== next.sessionId || snapshot.participants.length !== next.participants.length
      || snapshot.sources.length !== next.sources.length) return false;
    return next.participants.every((person, index) => {
      const previous = snapshot.participants[index];
      return person.id === previous.id && person.name === previous.name
        && person.isSelf === previous.isSelf && person.avatarUrl === previous.avatarUrl;
    }) && next.sources.every((source, index) => {
      const previous = snapshot.sources[index];
      return source.id === previous.id && source.label === previous.label
        && source.isSelf === previous.isSelf && source.stream === previous.stream;
    });
  }

  function replace(next) {
    if (same(next)) return snapshot;
    revision += 1;
    snapshot = next ? Object.freeze({
      revision,
      sessionId: next.sessionId,
      participants: Object.freeze(next.participants.map(person => Object.freeze(person))),
      sources: Object.freeze(next.sources.map(source => Object.freeze(source))),
    }) : empty();
    return snapshot;
  }

  function getSnapshot() {
    if (cleared) return snapshot;
    try {
      return replace(read());
    } catch {
      // Unavailable state, metadata, or tracks cannot retain authorized media.
      return replace(null);
    }
  }

  function notify() {
    if (notifying || publishedRevision === snapshot.revision) return;
    publishedRevision = snapshot.revision;
    notifying = true;
    try {
      for (const listener of [...listeners]) {
        if (!listeners.has(listener)) continue;
        try { listener(); } catch { /* A consumer cannot break calls or another consumer. */ }
      }
    } finally {
      notifying = false;
    }
  }

  function publish() {
    cleared = false;
    getSnapshot();
    notify();
    return snapshot;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('A media source subscriber must be a function');
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function clear() {
    // Explicit publish reopens this presentation cache for the next calls update.
    // No stream, track, or meeting state is owned or modified by this bridge.
    cleared = true;
    replace(null);
    notify();
    return snapshot;
  }

  return Object.freeze({getSnapshot, subscribe, publish, clear});
})({window,getState:()=>state,getMeeting:()=>callSession.canRun()?meeting():null,getPeer:id=>peers.get(id),getRoomId:()=>roomId,getCallId:()=>callId,person});
 function clearDepartedMedia(){const m=callSession.canRun()?meeting():null,self=state.data?.user?.id;for(const tile of document.querySelectorAll('#replicaMedia .r-screen-tile,#replicaMedia .r-video-tile')){const id=tile.dataset.screen||tile.dataset.user;if(!window.aureonOfficeBootstrap.active||!m?.members.includes(id)||id!==self&&(roomId!==m.id||!callId||!peers.has(id))){for(const video of tile.querySelectorAll('video')){video.pause();video.srcObject=null;}tile.remove();}}}
 function detachPeerWork(peer,token,work){void work.catch(error=>{if(callSession.isCurrent(token)&&peers.get(peer.id)===peer)callError(error);});}
 const iceFragments=sdp=>[...new Set((sdp||'').match(/^a=ice-ufrag:[^\s]+/gm)?.map(line=>line.slice(12)).filter(fragment=>fragment.length<=256)||[])].slice(0,16);
 function safeCandidate(value){if(!value||typeof value.candidate!=='string'||value.candidate.length>3000||value.sdpMid!=null&&(typeof value.sdpMid!=='string'||value.sdpMid.length>256)||value.usernameFragment!=null&&(typeof value.usernameFragment!=='string'||value.usernameFragment.length>256))return null;return {candidate:value.candidate,sdpMid:value.sdpMid??null,sdpMLineIndex:Number.isInteger(value.sdpMLineIndex)&&value.sdpMLineIndex>=0&&value.sdpMLineIndex<=65535?value.sdpMLineIndex:null,usernameFragment:value.usernameFragment??null};}
 function localSdp(pc){const sdp=pc.localDescription?.sdp;if(typeof sdp!=='string'||sdp.length>32000)throw Object.assign(Error('Descrição de chamada inválida.'),{status:400});return sdp;}
 const candidateFragment=candidate=>candidate.usernameFragment||candidate.candidate?.match(/(?:^|\s)ufrag\s+(\S+)/)?.[1]||null;
 function queueCandidate(peer,candidate){if(peer.pending.length>=128)peer.pending.shift();peer.pending.push(candidate);}
 function updateRemoteIce(peer){const next=iceFragments(peer.pc.remoteDescription?.sdp);peer.retiredRemoteIce=[...new Set([...peer.retiredRemoteIce,...peer.remoteIce.filter(fragment=>!next.includes(fragment))])].slice(-16);peer.remoteIce=next;}
 function retryableOffer(peer){const pending=peer.pendingOffer,pc=peer.pc;return pending?.retry&&callSession.isCurrent(pending.token)&&peers.get(peer.id)===peer&&pending.descriptionGeneration===peer.localDescriptionGeneration&&pc.signalingState==='have-local-offer'&&pc.localDescription?.type==='offer'?pending:null;}
 function retainOffer(peer,pending,retry){if(peer.pendingOffer!==pending)return;pending.retry=retry;if(!retryableOffer(peer))peer.pendingOffer=null;else peer.recoveryAfter=Math.max(peer.recoveryAfter,Date.now()+3000);}
 async function offer(peer,retry=false){
   const token=callSession.capture(),pc=peer.pc;if(!callSession.isCurrent(token)||peers.get(peer.id)!==peer)return;
   if(peer.makingOffer){if(!retry)peer.needsNegotiation=true;return;}
   let pending=retry?retryableOffer(peer):null;if(retry&&!pending)return;
   if(!retry&&pc.signalingState!=='stable'){peer.needsNegotiation=true;return;}
   peer.makingOffer=true;if(!retry)peer.needsNegotiation=false;
   try{
     if(!pending){const descriptionGeneration=++peer.localDescriptionGeneration;peer.cachedAnswer=null;await pc.setLocalDescription();if(!callSession.isCurrent(token)||peers.get(peer.id)!==peer||peer.localDescriptionGeneration!==descriptionGeneration)return;pending={token,sdp:localSdp(pc),descriptionGeneration,retry:false};peer.pendingOffer=pending;}
     // Keep the existing offer until its answer arrives, even after a successful
     // POST: the answer itself can be lost. Never apply a second local offer in
     // have-local-offer, where restarting ICE cannot negotiate yet either.
     pending.retry=false;await send(peer.id,{type:'offer',sdp:pending.sdp},peer,pending.token);
     retainOffer(peer,pending,true);
   }catch(error){
     if(callSession.isCurrent(token)&&peers.get(peer.id)===peer){
       const transient=!Number.isFinite(error?.status)||error.status===0||error.status===408||error.status===429||error.status>=500&&error.status<600;
       if(pending)retainOffer(peer,pending,transient);
       callError(error);
     }
   }finally{peer.makingOffer=false;}
 }

 function streams(){return [testAudio?.getAudioTracks()[0]||window.aureonAudioStream?.()?.getAudioTracks()[0]||null,window.aureonCameraStream?.()?.getVideoTracks()[0]||null,window.aureonScreenStream?.()?.getVideoTracks()[0]||null].map(t=>t?.readyState==='live'?t:null);}
 async function send(to,signal,expectedPeer=peers.get(to),token=callSession.capture()){const peer=peers.get(to);if(!peer||peer!==expectedPeer||!callSession.isCurrent(token))return;const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),10000);try{await api('signal',{meeting:token.roomId,call:token.callId,to,toCall:peer.callId,signal},undefined,controller.signal);}catch(error){if(!callSession.isCurrent(token)||peers.get(to)!==peer)return;if(callSession.handle(error,token))return;if(error.status===409&&error.code==='OFFICE_SIGNAL_RECIPIENT_STALE'){closePeer(to);return;}if(controller.signal.aborted&&!error.status)throw Object.assign(Error('O envio da chamada demorou. Tentando novamente.'),{status:408});throw error;}finally{clearTimeout(deadline);}}
 async function recoverPeer(peer,requested=false){
   const token=callSession.capture();if(!callSession.isCurrent(token)||peers.get(peer.id)!==peer||!meeting()?.members.includes(peer.id))return;
   const pc=peer.pc,now=Date.now(),pending=retryableOffer(peer),failed=pc.connectionState==='failed'||pc.iceConnectionState==='failed',disconnected=pc.connectionState==='disconnected'||pc.iceConnectionState==='disconnected';
   if(pc.connectionState==='closed')return;
   if(!requested&&!pending){
     if(!failed&&!disconnected){
       if(pc.connectionState==='connected'&&peer.recoveryState!=='connected'){peer.recoveryAttempts=0;peer.recoveryAfter=0;}
       peer.recoveryState=pc.connectionState;peer.disconnectedAt=null;return;
     }
     peer.recoveryState=failed?'failed':'disconnected';
     if(disconnected&&!failed){if(peer.disconnectedAt===null)peer.disconnectedAt=now;if(now-peer.disconnectedAt<8000)return;}
   }
   if(now<peer.recoveryAfter)return;
   peer.recoveryAttempts++;peer.recoveryAfter=now+[3000,10000,30000][Math.min(peer.recoveryAttempts-1,2)];
   // Only the deterministic offerer restarts ICE, so simultaneous failures cannot create offer glare.
   if(peer.initiator){if(pending)await offer(peer,true);else pc.restartIce();}else await send(peer.id,{type:'renegotiate',iceRestart:true},peer,token);
 }
 function createPeer(id,remoteCall){
   const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]}),peer={id,callId:remoteCall,pc,pending:[],remoteIce:[],retiredRemoteIce:[],pendingOffer:null,localDescriptionGeneration:0,remoteDescriptionGeneration:0,remoteOffer:null,remoteAnswer:null,cachedAnswer:null,makingOffer:false,ignoreOffer:false,settingAnswer:false,polite:state.data.user.id>id,audio:new MediaStream(),camera:new MediaStream(),screen:new MediaStream(),channel:null,recoveryAttempts:0,recoveryAfter:0,recoveryState:'new',disconnectedAt:null};
   peers.set(id,peer);peer.initiator=state.data.user.id<id;peer.slots=peer.initiator?['audio','video','video'].map(kind=>pc.addTransceiver(kind,{direction:'sendrecv'})):[];
   pc.onicecandidate=e=>{if(e.candidate)send(id,{type:'candidate',candidate:e.candidate.toJSON()},peer).catch(()=>{});};
   pc.onconnectionstatechange=()=>{recoverPeer(peer).catch(callError);renderMedia();};
   pc.oniceconnectionstatechange=()=>{recoverPeer(peer).catch(callError);renderMedia();};
   pc.ontrack=e=>{
     const index=pc.getTransceivers().indexOf(e.transceiver),target=e.track.kind==='audio'?peer.audio:(e.transceiver.mid==='2'?peer.screen:peer.camera);if(!target.getTracks().includes(e.track))target.addTrack(e.track);
     e.track.onunmute=()=>renderMedia();e.track.onmute=()=>renderMedia();e.track.onended=()=>renderMedia();renderMedia();
   };
   function channelEvents(channel){peer.channel=channel;channel.onopen=()=>renderMedia();channel.onclose=()=>renderMedia();channel.onmessage=e=>{
     if(!meeting()?.members.includes(id))return;
     try{const packet=JSON.parse(e.data);if(packet.type==='reaction'&&['👍','❤️','😂','🎉','👀','✅','🙌','🔥'].includes(packet.emoji))showReaction(id,packet.emoji);}catch{}
   };}
   pc.ondatachannel=e=>channelEvents(e.channel);
   if(state.data.user.id<id)channelEvents(pc.createDataChannel('aureon-room'));
   pc.onnegotiationneeded=()=>{const token=callSession.capture();detachPeerWork(peer,token,peer.initiator?offer(peer):send(peer.id,{type:'renegotiate'},peer,token));};
   updateTracks(peer);return peer;
 }
 async function updateTracks(peer){
   const tracks=streams();for(let i=0;i<tracks.length;i++){if(!callSession.canRun()||peers.get(peer.id)!==peer)return;const sender=peer.slots[i]?.sender;if(!sender)continue;if(sender.track!==tracks[i])try{sender.setStreams(...(tracks[i]?[new MediaStream([tracks[i]])]:[]));await sender.replaceTrack(tracks[i]);}catch(error){callError(error)}}
 }
 async function receive(event){
   const token=callSession.capture();if(!callSession.isCurrent(token))return;
   if(!meeting()?.members.includes(event.from)||event.meeting!==roomId)return;
   const peer=peers.get(event.from);if(!peer||peer.callId!==event.fromCall)return;const pc=peer.pc,signal=event.signal;
   if(signal.type==='candidate'){if(peer.ignoreOffer)return;const candidate=safeCandidate(signal.candidate);if(!candidate)return;const fragment=candidateFragment(candidate);if(fragment&&peer.retiredRemoteIce.includes(fragment)&&!peer.remoteIce.includes(fragment))return;if(!pc.remoteDescription||pc.signalingState==='have-local-offer'||fragment&&peer.remoteIce.length&&!peer.remoteIce.includes(fragment))queueCandidate(peer,candidate);else try{await pc.addIceCandidate(candidate)}catch(error){if(!peer.ignoreOffer)callError(error)}return;}
   if(signal.type==='renegotiate'){if(peer.initiator)detachPeerWork(peer,token,signal.iceRestart===true?recoverPeer(peer,true):offer(peer));return;}
   // ICE gathering and addIceCandidate mutate the browser's description SDP.
   // Identify our negotiation by its generations and the original wire strings.
   const cached=peer.cachedAnswer;
   if(signal.type==='offer'&&!peer.initiator&&pc.signalingState==='stable'&&peer.remoteOffer===signal.sdp&&cached&&callSession.isCurrent(cached.token)&&cached.localGeneration===peer.localDescriptionGeneration&&cached.remoteGeneration===peer.remoteDescriptionGeneration&&pc.remoteDescription?.type==='offer'&&pc.localDescription?.type==='answer'){detachPeerWork(peer,token,send(peer.id,{type:'answer',sdp:cached.sdp},peer,token));return;}
   if(signal.type==='answer'&&pc.signalingState==='stable'&&pc.remoteDescription?.type==='answer'&&peer.remoteAnswer===signal.sdp)return;
   await pc.setRemoteDescription({type:signal.type,sdp:signal.sdp});if(!callSession.isCurrent(token)||peers.get(peer.id)!==peer)return;
   const remoteGeneration=++peer.remoteDescriptionGeneration;peer.cachedAnswer=null;updateRemoteIce(peer);
   if(signal.type==='answer'){peer.pendingOffer=null;peer.remoteAnswer=signal.sdp;peer.remoteOffer=null;}else{peer.remoteOffer=signal.sdp;peer.remoteAnswer=null;}
   if(!peer.initiator){peer.slots=pc.getTransceivers().slice(0,3);for(const slot of peer.slots)slot.direction='sendrecv';await updateTracks(peer);}
   for(const candidate of peer.pending.splice(0)){const fragment=candidateFragment(candidate);if(fragment&&peer.remoteIce.length&&!peer.remoteIce.includes(fragment))continue;try{await pc.addIceCandidate(candidate)}catch{}}
   if(signal.type==='offer'){const localGeneration=++peer.localDescriptionGeneration;await pc.setLocalDescription();if(!callSession.isCurrent(token)||peers.get(peer.id)!==peer||peer.localDescriptionGeneration!==localGeneration||peer.remoteDescriptionGeneration!==remoteGeneration)return;const sdp=localSdp(pc);peer.cachedAnswer={token,sdp,localGeneration,remoteGeneration};detachPeerWork(peer,token,send(peer.id,{type:'answer',sdp},peer,token));}
   if(peer.initiator&&peer.needsNegotiation&&pc.signalingState==='stable')detachPeerWork(peer,token,offer(peer));

 }

 let lastDiagnostics=[];
 async function diagnostics(){
   lastDiagnostics=[];
   for(const peer of peers.values()){
     const report=await peer.pc.getStats(),traffic=[];
     report.forEach(r=>{if(r.type==='outbound-rtp'||r.type==='inbound-rtp')traffic.push({direction:r.type,kind:r.kind,bytes:r.bytesSent??r.bytesReceived??0,packets:r.packetsSent??r.packetsReceived??0,frames:r.framesDecoded??r.framesEncoded??0});});
     lastDiagnostics.push({person:person(peer.id).name,connection:peer.pc.connectionState,ice:peer.pc.iceConnectionState,recoveryAttempts:peer.recoveryAttempts,audioCapture:streams()[0]?.readyState||'off',audioSource:testAudio?'sinal de teste':'microfone',audioContext:testContext?.state||null,cameraCapture:streams()[1]?.readyState||'off',senders:peer.pc.getTransceivers().map(t=>({mid:t.mid,direction:t.currentDirection,track:t.sender.track?.kind||null,live:t.sender.track?.readyState||null})),incomingAudio:peer.audio.getAudioTracks().map(t=>({live:t.readyState,muted:t.muted})),incomingVideo:peer.camera.getVideoTracks().length,traffic});
   }
 }

 async function testTransmission(){
   if(!callSession.canRun())return;
   if(testAudio){toast('Um som de teste já está em execução.');return;}
   testContext=new(window.AudioContext||window.webkitAudioContext)();const destination=testContext.createMediaStreamDestination(),oscillator=testContext.createOscillator(),gain=testContext.createGain();
   oscillator.frequency.value=523;gain.gain.value=.025;oscillator.connect(gain);gain.connect(destination);testAudio=destination.stream;const transmissionAudio=testAudio,transmissionContext=testContext;testContext.resume();oscillator.start();
   toast('Transmitindo um som de teste por 8 segundos.');for(const peer of peers.values())await updateTracks(peer);
   setTimeout(()=>{const current=testAudio===transmissionAudio&&testContext===transmissionContext;try{oscillator.stop();}catch{}for(const track of transmissionAudio.getTracks())try{track.stop();}catch{}try{transmissionContext.close()?.catch?.(()=>{});}catch{}if(testAudio===transmissionAudio)testAudio=null;if(testContext===transmissionContext)testContext=null;if(current&&callSession.canRun())for(const peer of peers.values())updateTracks(peer);},8000);
 }
 function closePeer(id){const peer=peers.get(id);if(!peer)return;peer.channel?.close();peer.pc.close();peers.delete(id);clearDepartedMedia();mediaSources.publish();}
 function closeAll(){generation++;for(const id of peers.keys())closePeer(id);roomId=null;callId=null;roomKind=null;signalCursor=0;mediaSources.clear();document.getElementById('replicaMedia')?.remove();document.getElementById('replicaCallAudio')?.remove();}
 function disconnectSession(){ticking=false;for(const name of ['aureonStopMicrophone','aureonStopCamera','aureonStopScreen'])try{window[name]?.()?.catch?.(()=>{});}catch{}try{for(const track of testAudio?.getTracks()||[])try{track.stop();}catch{}}catch{}testAudio=null;try{testContext?.close()?.catch?.(()=>{});}catch{}testContext=null;wasJoined=false;closeAll();}
 async function tick(){
   if(!callSession.canRun()){if(callSession.isPaused()&&streams().some(Boolean))disconnectSession();callSession.render();return;}
   if(ticking||!state.data||!window.aureonOfficeBootstrap.active)return;
   const run={};ticking=run;let epoch=generation,token=null;
   try{
     await refreshProximity();if(!window.aureonOfficeBootstrap.active)return;const m=meeting();if(!m){if(roomKind==='proximity'){wasJoined=false;closeAll();}else if(wasJoined)disconnectSession();renderProximity();return;}
     // A failed creation leaves no call token. Retry it without stopping enabled devices.
     wasJoined=true;if(roomId!==m.id||!callId){closeAll();roomId=m.id;roomKind=m.type;epoch=generation;const created=await api('call-session',{meeting:roomId});if(generation!==epoch||!callSession.canRun())return;if(meeting()?.id!==m.id){disconnectSession();return;}callId=created.callId;}
     token=callSession.capture();if(!callSession.isCurrent(token))return;
     const data=await api('signals',undefined,{meeting:roomId,call:callId,after:signalCursor});
     if(generation!==epoch||!callSession.isCurrent(token))return;
     m.members=data.members;const roster=data.roster||{};
     for(const id of peers.keys())if(!m.members.includes(id)||peers.get(id).callId!==roster[id])closePeer(id);
     for(const id of m.members)if(id!==state.data.user.id&&roster[id]&&!peers.has(id))createPeer(id,roster[id]);
     for(const peer of peers.values())await updateTracks(peer);
     if(generation!==epoch||!callSession.isCurrent(token))return;
     for(const event of data.signals)try{await receive(event);}catch(error){callError(error);}
     if(generation!==epoch||!callSession.isCurrent(token))return;
     // Apply queued answers before retrying their offers. A slow signaling POST
     // must not hold this poll open or prevent later answers from being read.
     for(const peer of peers.values())detachPeerWork(peer,token,recoverPeer(peer));
     signalCursor=data.cursor;await diagnostics();if(generation===epoch&&callSession.canRun())renderMedia();
   }catch(error){if(generation!==epoch)return;if(callSession.handle(error,token))return;if(error.status===401||error.status===403&&roomKind!=='proximity'){disconnectSession();}else if(error.status===403){wasJoined=false;closeAll();}else if(error.status===409){closeAll();}else callError(error);}finally{if(ticking===run)ticking=false;}
 }
 function renderProximity(){
  let area=document.getElementById('replicaProximity');if(explicitMeeting()||state.view!=='office'||!nearbyRoom||!window.aureonOfficeBootstrap.active){area?.remove();return;}
  if(!area){area=el('aside');area.id='replicaProximity';area.setAttribute('aria-label','Áudio por proximidade');area.style.cssText='position:absolute;left:16px;top:62px;z-index:35;max-width:min(380px,calc(100% - 96px));padding:10px 12px;border:1px solid var(--crm-border,#555);border-radius:10px;background:var(--crm-card,#292a2c);color:var(--crm-text,#eee);font:12px Arial,sans-serif';area.append(el('strong'),el('div'));const activate=button('Ativar áudio',async()=>{for(const audio of document.querySelectorAll('#replicaCallAudio audio'))try{await audio.play();delete audio.dataset.blocked;}catch{}renderProximity();});activate.dataset.proximityAudio='true';area.append(activate);const details=el('details');details.append(el('summary','','Detalhes da conexão'),button('Testar transmissão de áudio',()=>testTransmission()),el('pre'));details.querySelector('pre').style.cssText='max-height:160px;overflow:auto;max-width:340px;white-space:pre-wrap';area.append(details);document.getElementById('office').parentElement.append(area);}
  const ids=nearbyRoom.members.filter(id=>id!==state.data.user.id);area.querySelector('strong').textContent='Conversa por proximidade';area.querySelector('div').textContent=ids.length?'Próximos: '+ids.map(id=>person(id).name).join(', '):'Nenhuma pessoa no alcance da voz';area.querySelector('[data-proximity-audio]').hidden=!document.querySelector('#replicaCallAudio audio[data-blocked]');area.querySelector('pre').textContent=JSON.stringify(lastDiagnostics,null,2);
 }
 let lastError='';
 function callError(error){const label=error?.message||'Não foi possível estabelecer a chamada.';if(label===lastError)return;lastError=label;console.warn('Aureon: negociação da chamada pendente — '+label);const status=document.getElementById('replicaCallStatus');if(status)status.textContent='Conexão de mídia pendente';}
 function mediaState(peer){return peer?.pc.connectionState==='connected'?'Conectado':peer?.pc.connectionState==='failed'?'Não conectado':peer?.pc.connectionState==='disconnected'?'Reconectando…':'Conectando…';}
 function renderMedia(){
   renderProximity();clearDepartedMedia();mediaSources.publish();if(!callSession.canRun()){callSession.render();return;}const m=meeting();if(!m)return;
   let audioContainer=document.getElementById('replicaCallAudio');if(!audioContainer){audioContainer=el('div');audioContainer.id='replicaCallAudio';audioContainer.hidden=true;document.body.append(audioContainer);}
   for(const old of audioContainer.querySelectorAll('audio'))if(!peers.has(old.dataset.peer))old.remove();
   for(const peer of peers.values()){
     let audio=audioContainer.querySelector('[data-peer="'+peer.id+'"]');if(!audio){audio=el('audio');audio.autoplay=true;audio.dataset.peer=peer.id;audioContainer.append(audio);}const signature=peer.callId+':'+peer.audio.getAudioTracks().map(t=>t.id+':'+t.muted+':'+t.readyState).join(',');if(audio.dataset.streamSignature!==signature){audio.dataset.streamSignature=signature;audio.srcObject=null;audio.srcObject=peer.audio;audio.play().then(()=>{delete audio.dataset.blocked}).catch(()=>{audio.dataset.blocked='true'});}
   }
   if(state.view!=='cowork')return;
   const summary=document.querySelector('.r-session-summary');if(!summary)return;
   let area=document.getElementById('replicaMedia');if(!area){area=el('section','r-call-media');area.id='replicaMedia';
     const bar=el('div','r-call-tools');const status=el('span','r-call-status','Chamada da sessão');status.id='replicaCallStatus';
     bar.append(status,button('Microfone',()=>document.getElementById('mic').click()),button('Câmera',()=>document.getElementById('camera').click()),button('Compartilhar',()=>document.getElementById('screen').click()),button('Ativar áudio',async()=>{let blocked=false;for(const audio of audioContainer.querySelectorAll('audio'))try{await audio.play()}catch(error){if(error.name!=='AbortError')blocked=true}toast(blocked?'Clique novamente para permitir o áudio da chamada.':'Áudio da chamada ativado.');}));
     const hands=button('',()=>toggleHand());hands.id='replicaCallHand';bar.append(hands);
     const react=el('div','r-call-reactions');for(const emoji of ['👍','❤️','😂','🎉'])react.append(button(emoji,()=>broadcastReaction(emoji)));area.append(bar,el('div','r-call-grid'),react);summary.append(area);
   }
   let details=document.getElementById('replicaConnectionDetails');if(!details){details=el('details','r-call-diagnostics');details.id='replicaConnectionDetails';details.append(el('summary','','Detalhes da conexão'),button('Testar transmissão de áudio',()=>testTransmission()),el('pre'));area.append(details)}details.querySelector('pre').textContent=JSON.stringify(lastDiagnostics,null,2);
   for(const [label,key] of [['Microfone','mic'],['Câmera','camera'],['Compartilhar','screen']]){const control=Array.from(area.querySelectorAll('.r-call-tools button')).find(b=>b.textContent===label),original=document.getElementById(key);if(control&&original){control.disabled=original.disabled;control.setAttribute('aria-pressed',original.getAttribute('aria-pressed')||'false');control.title=original.title||label}}
   const hand=document.getElementById('replicaCallHand');hand.textContent=m.hands?.[state.data.user.id]?'Abaixar mão':'Levantar mão';hand.setAttribute('aria-pressed',String(!!m.hands?.[state.data.user.id]));
   const grid=area.querySelector('.r-call-grid');for(const old of grid.querySelectorAll('.r-video-tile'))if(!m.members.includes(old.dataset.user))old.remove();
   for(const id of m.members){
     let tile=grid.querySelector('[data-user="'+id+'"]');const isSelf=id===state.data.user.id,peer=peers.get(id);if(!tile){tile=el('div','r-video-tile');tile.dataset.user=id;const video=el('video');video.autoplay=true;video.playsInline=true;video.muted=true;video.setAttribute('aria-label','Vídeo de '+person(id).name);const placeholder=el('div','r-video-placeholder');placeholder.append(U.face(person(id)));const label=el('div','r-video-label');label.append(el('span'),el('small'));tile.append(video,placeholder,label);grid.append(tile);}
     const video=tile.querySelector('video'),stream=isSelf?window.aureonCameraStream?.():peer?.camera;
     if(video.srcObject!==stream){video.srcObject=stream||null;if(stream)video.play().catch(()=>{});}
     const ready=!!stream?.getVideoTracks().some(t=>t.readyState==='live'&&!t.muted)&&video.readyState>=2&&video.videoWidth>0;
     tile.classList.toggle('has-video',ready);tile.hidden=isSelf&&state.data.user.preferences?.hideSelf===true;
     tile.querySelector('.r-video-label span').textContent=(m.hands?.[id]?'✋ ':'')+person(id).name+(isSelf?' (você)':'');
     tile.querySelector('.r-video-label small').textContent=isSelf?'Você':person(id).status==='offline'?'Offline':mediaState(peer);
   }
   for(const id of m.members){
     const stream=id===state.data.user.id?window.aureonScreenStream?.():peers.get(id)?.screen;
     let tile=area.querySelector('[data-screen="'+id+'"]');
     const ready=stream?.getVideoTracks().some(t=>t.readyState==='live'&&!t.muted);
     if(!ready){tile?.remove();continue;}
     if(!tile){tile=el('div','r-screen-tile');tile.dataset.screen=id;const title=el('small','','Tela de '+person(id).name),video=el('video');video.autoplay=true;video.muted=true;video.playsInline=true;video.setAttribute('aria-label','Tela compartilhada por '+person(id).name);video.onloadeddata=()=>renderMedia();tile.append(title,video);area.append(tile);}const video=tile.querySelector('video');if(video.srcObject!==stream){video.srcObject=stream;video.play().catch(()=>{});}tile.hidden=video.readyState<2||video.videoWidth===0;
   }
 }
 async function toggleHand(){const m=meeting();if(!m)return;await api('meeting-hand',{id:m.id,raised:!m.hands?.[state.data.user.id]});await U.refresh(true);}
 function showReaction(id,emoji){
   const tile=document.querySelector('.r-video-tile[data-user="'+id+'"]');if(!tile)return;
   let label=tile.querySelector('.r-video-reaction');if(!label){label=el('span','r-video-reaction');tile.append(label)}label.textContent=emoji;
   label.setAttribute('aria-label',person(id).name+' reagiu '+emoji);clearTimeout(label.hideTimer);label.hideTimer=setTimeout(()=>label.remove(),5000);
 }
 function broadcastReaction(emoji){const m=meeting();if(!m)return;showReaction(state.data.user.id,emoji);for(const peer of peers.values())if(peer.channel?.readyState==='open')peer.channel.send(JSON.stringify({type:'reaction',emoji}));}
 window.addEventListener('aureon-interface-state',()=>{clearDepartedMedia();mediaSources.publish();callSession.render();if(state.data?.user?.status==='offline'||!window.aureonOfficeBootstrap.active){clearProximity();disconnectSession();}else if(!explicitMeeting()&&wasJoined&&roomKind!=='proximity')disconnectSession();tick()});
 setInterval(tick,1000);
 const observer=new MutationObserver(()=>{if(state.view==='cowork'&&meeting()&&document.querySelector('.r-session-summary')&&!document.getElementById('replicaMedia'))renderMedia();});observer.observe(U.center,{childList:true,subtree:true});
 const originalLevel=window.aureonUpdateMicLevel;let lowering=false;
 window.aureonUpdateMicLevel=level=>{originalLevel?.(level);const m=meeting();if(level>.018&&m?.hands?.[state.data.user.id]&&state.data.user.preferences?.autoLowerHand!==false&&!lowering){lowering=true;api('meeting-hand',{id:m.id,raised:false}).then(()=>U.refresh(true)).catch(()=>{}).finally(()=>lowering=false);}};
 window.addEventListener('pagehide',()=>{callSession.dispose();disconnectSession();});
 window.addEventListener('aureon-office-session-ended',()=>{callSession.dispose();disconnectSession();});window.aureonReplicaCalls={broadcastReaction,toggleHand,disconnectSession,media:mediaSources};
})();
