/* eslint-disable @typescript-eslint/no-require-imports -- Private CommonJS compatibility boundary. */
// Private CRM adaptation of the approved office service. Never serve this file as an asset.
const crypto = require('node:crypto');
const spotifyLinks = require('./spotify-links.js');
const {validatePortrait}=require('./avatar-portrait.cjs');
const {publicAvatarAppearance}=require('./avatar-appearance.cjs');
const {proximityRoom}=require('./proximity-core.cjs');
const {normalizeZone}=require('./profile-details-core.js');
const {createSpatialPresence}=require('./spatial-presence-core.cjs');
const {readClientState,patchClientState}=require('../client-state.cjs');
const {isOfficeMap}=require('../map.cjs');
const {normalizeOfficeCallConflict,officeCallConflictMessage}=require('../call-conflicts.cjs');

function createInterfaceService({snapshot = null, ephemeral = null, revision = 0, approvedMap, now = () => Date.now()}) {
  const id = () => crypto.randomUUID();
  const seed = () => ({version:1, users:[], channels:[
    {id:'general',name:'general',description:'Avisos e conversas do escritório',private:false,members:[]},
    {id:'social',name:'social',description:'Conversas e encontros da equipe',private:false,members:[]}
  ], messages:[], events:[], activity:[], meetings:[], revision:0});
  const state = structuredClone({...seed(), ...(snapshot || {}), revision});
  delete state.sessions;
  let dirty = false, signals = structuredClone(ephemeral?.signals || []), signalSequence = ephemeral?.signalSequence || 0;
  if (!Object.hasOwn(state,'officeMap') && approvedMap !== undefined) {state.officeMap=structuredClone(approvedMap);dirty=true;}
  const callSessions = new Map(structuredClone(ephemeral?.callSessions || []));
  const spatialPresence = createSpatialPresence({now, initialState:structuredClone(ephemeral?.spatial || null)});
  const fail = (status, message, code) => {const safeCode=normalizeOfficeCallConflict(status,code);const error = new Error(officeCallConflictMessage(safeCode)||message); error.status = status;if(safeCode)error.code=safeCode; throw error;};
  const text = (value, limit, required = true) => {
    if(typeof value !== 'string' || value.length > limit || (required && !value.trim())) fail(400,'Confira os campos informados.');
    return value.trim();
  };

  const richContent = value => {
    if(value==null)return null;if(!Array.isArray(value))fail(400,'Formato da mensagem inválido.');let count=0,size=0;
    const clean=(node,depth)=>{if(++count>2000||depth>12||!node||typeof node!=='object'||Array.isArray(node))fail(400,'Formatação da mensagem inválida.');if(node.type==='text'){if(typeof node.text!=='string')fail(400,'Texto inválido.');size+=node.text.length;if(size>8000)fail(400,'A mensagem é muito longa.');return {type:'text',text:node.text};}
      if(!['p','strong','em','s','code','pre','blockquote','ul','ol','li','br','a'].includes(node.type))fail(400,'Formatação não reconhecida.');const result={type:node.type};if(node.type==='a'){let url;try{url=new URL(node.href)}catch{fail(400,'Confira o endereço do link.');}if(!['http:','https:'].includes(url.protocol)||url.username||url.password||node.href.length>2000)fail(400,'Use um link http ou https sem credenciais.');result.href=url.href;}if(node.type!=='br'){if(!Array.isArray(node.children))fail(400,'Conteúdo inválido.');result.children=node.children.map(n=>clean(n,depth+1));}return result;};return value.map(node=>clean(node,0));
  };
  const richPlain = content => content.map(node=>node.type==='text'?node.text:node.type==='br'?'\n':richPlain(node.children||[])+(['p','pre','blockquote','li'].includes(node.type)?'\n':'')).join('');
  const trustedUser = identity => {
    let u=state.users.find(p=>p.id===identity.user.id);
    if(!u){u={id:identity.user.id,status:'online',lastSeen:now(),bio:'',statusText:'',avatarUrl:''};state.users.push(u);}
    u.name=identity.user.name;u.profileId=identity.user.profileId;u.profilePhotoUrl=identity.user.avatarUrl||'';
    u.role=identity.role;u.crmCapabilities={...identity.capabilities};delete u.archived;
    return u;
  };
  const disconnectCalls = uid => {for(const key of callSessions.keys())if(key.endsWith(':'+uid))callSessions.delete(key);signals=signals.filter(s=>s.from!==uid&&s.to!==uid);};
  const appearance = u => {try{return publicAvatarAppearance(readClientState(state,u.id));}catch{return publicAvatarAppearance();}};
  const publicUser = u => {const spatialPosition=spatialPresence.snapshot(u);return {id:u.id,name:u.name,bio:u.bio||'',status:u.status||'online',statusText:u.statusText||'',presenceVersion:u.presenceVersion||0,lastSeen:u.lastSeen,avatarUrl:u.avatarUrl||'',avatarAppearance:appearance(u),profilePhotoUrl:u.profilePhotoUrl||'',timeZone:u.timeZone||'',role:u.role,preferences:u.preferences||{},...(spatialPosition?{spatialPosition}:{})};};
  const canChannel = (u,c) => c && (!c.private || c.members.includes(u.id));
  const conversation = (u,key) => {
    if(typeof key !== 'string') fail(400,'Escolha uma conversa.');
    if(key.startsWith('channel:')) {
      const c=state.channels.find(c=>c.id===key.slice(8)); if(!canChannel(u,c)) fail(403,'Você não participa desse canal.');
      return {key,recipients:c.private?c.members:state.users.map(u=>u.id)};
    }

    if(key.startsWith('meeting:')) {
      const m=state.meetings.find(m=>m.id===key.slice(8)&&!m.ended);
      if(!m||!m.members.includes(u.id))fail(403,'Entre na reunião para acessar essa conversa.');
      return {key,recipients:m.members};
    }
    if(key.startsWith('dm:')) {

      const other=state.users.find(p=>p.id===key.slice(3)); if(!other) fail(404,'Pessoa não encontrada.');
      const members=[...new Set([u.id,other.id])].sort();return {key:'direct:'+members.join(':'),recipients:members};
    }
    fail(400,'Conversa inválida.');
  };

  const meetingPhase = m => {
    const elapsed=Math.max(0,(m.paused||now())-m.started-(m.offset||0));
    if(m.type==='freeform'||m.type==='meeting')return {phase:m.type,remaining:null,elapsed,cycle:1,paused:!!m.paused};
    if(m.type==='focused')return {phase:elapsed>=m.duration*60000?'completed':'focus',remaining:Math.max(0,m.duration*60000-elapsed),elapsed,cycle:1,paused:!!m.paused};
    const focus=(m.focusMinutes||25)*60000,pause=(m.breakMinutes||5)*60000,cycles=m.cycles||2;
    let rest=elapsed;
    for(let cycle=1;cycle<=cycles;cycle++){if(rest<focus)return {phase:'focus',remaining:focus-rest,elapsed,cycle,paused:!!m.paused};rest-=focus;if(cycle<cycles){if(rest<pause)return {phase:'break',remaining:pause-rest,elapsed,cycle,paused:!!m.paused};rest-=pause;}}
    return {phase:'completed',remaining:0,elapsed,cycle:cycles,paused:!!m.paused};
  };
  const proximity = u => proximityRoom(u,{users:state.users,meetings:state.meetings,snapshot:spatialPresence.snapshot,phase:meetingPhase,now:now()});
  const callRoom=(u,room)=>{const explicit=state.meetings.find(m=>m.id===room&&!m.ended);if(explicit)return explicit;const nearby=proximity(u);return nearby?.id===room?nearby:null;};
  const publicMeeting = (u,m) => ({...m,...meetingPhase(m),requests:(m.owner===u.id?m.requests:m.requests.filter(r=>r.userId===u.id)).map(r=>({...r,state:r.state==='pending'&&r.time<now()-120000?'expired':r.state}))});
  const hasActiveMeeting = (userId,exceptId) => state.meetings.some(m=>m.id!==exceptId&&!m.ended&&m.members.includes(userId)&&meetingPhase(m).phase!=='completed');
  const messageAccess = (u,m) => {

    if(!m) fail(404,'Mensagem não encontrada.');
    if(m.conversation.startsWith('channel:')||m.conversation.startsWith('meeting:')) conversation(u,m.conversation);
    else if(!m.recipients.includes(u.id)) fail(403,'Esta conversa é privada.');
  };
  const activity = (kind,actor,recipients,data) => state.activity.push({id:id(),kind,actor:actor.id,recipients:[...new Set(recipients)].filter(i=>i!==actor.id),time:now(),readBy:[],...data});
  async function save(){dirty=true;}

  async function dispatch(identity,method,pathname,body={},query={}) {
    const u=trustedUser(identity);
    if(method==='GET' && pathname==='/bootstrap') {
      if(!isOfficeMap(state.officeMap))fail(503,'Mapa indisponível.');
      return {map:structuredClone(state.officeMap),clientState:readClientState(state,u.id)};
    }
    if(method==='GET' && pathname==='/client-state')return {clientState:readClientState(state,u.id)};
    if(method==='POST' && pathname==='/client-state')return {clientState:patchClientState(state,u.id,body)};
    if(method==='GET' && pathname==='/state') return {revision:state.revision,user:{...publicUser(u),unreadMessages:u.unreadMessages||[],unreadConversations:[...new Set(state.messages.filter(m=>(u.unreadMessages||[]).includes(m.id)&&!m.deleted).map(m=>m.conversation))]},historyUsers:state.users.filter(p=>p.archived).map(publicUser),users:state.users.filter(p=>!p.archived).map(p=>({...publicUser(p),status:p.lastSeen<now()-45000?'offline':p.status})),channels:state.channels.filter(c=>canChannel(u,c)),events:state.events.filter(e=>!e.deleted),activity:state.activity.filter(a=>a.recipients.includes(u.id)).slice(-200),meetings:state.meetings.filter(m=>!m.ended).map(m=>publicMeeting(u,m)),authentication:'crm',capabilities:{...identity.capabilities,profileDetails:true,avatarSync:true,spatialPresence:true,spatialSnapshots:true,spatialOwnership:true,proximityAudio:true}};
    if(method==='GET' && pathname==='/spatial-state') {
      const users=state.users.flatMap(p=>{const spatialPosition=spatialPresence.snapshot(p);if(!spatialPosition||p.lastSeen<now()-45000)return [];return [{id:p.id,name:p.name,status:p.status,avatarUrl:p.avatarUrl||'',avatarAppearance:appearance(p),spatialPosition}];});
      return {userId:u.id,serverTime:now(),users};
    }
    if(method==='GET' && pathname==='/proximity')return {room:proximity(u)};
    if(method==='GET' && pathname==='/spatial-control') return spatialPresence.control(u);
    if(method==='POST' && pathname==='/spatial-presence') {
      if(body.clear===true){spatialPresence.clear(u,body);return {position:null,control:spatialPresence.control(u)};}
      const position=spatialPresence.publish(u,{x:body.x,y:body.y},body);u.lastSeen=now();return {position,control:spatialPresence.control(u)};
    }
    if(method==='POST' && pathname==='/heartbeat') {u.lastSeen=now();return {user:publicUser(u)};}
    if(method==='POST' && pathname==='/presence') {
      if(!['online','busy','away','offline'].includes(body.status))fail(400,'Status inválido.');
      if(body.expectedPresenceVersion!==undefined){if(!Number.isInteger(body.expectedPresenceVersion)||body.expectedPresenceVersion<0)fail(400,'Versão de status inválida.');if(body.expectedPresenceVersion!==(u.presenceVersion||0))fail(409,'O status foi atualizado em outra guia.');}
      const statusText=text(body.statusText||'',120,false);const changed=u.status!==body.status || u.statusText!==statusText;u.status=body.status;u.statusText=statusText;u.lastSeen=now();if(!['online','busy','away'].includes(u.status))spatialPresence.remove(u.id);if(u.status==='offline')disconnectCalls(u.id);
      if(changed){u.presenceVersion=(u.presenceVersion||0)+1;await save();}return {user:publicUser(u)};
    }
    if(method==='POST' && pathname==='/profile') {
      const name=u.name,bio=text(body.bio||'',500,false);
      let timeZone=u.timeZone||'',profilePhotoUrl=u.profilePhotoUrl||'';
      if(Object.hasOwn(body,'timeZone')){try{timeZone=normalizeZone(body.timeZone);}catch(error){fail(400,error.message);}}
      // CRM name and profile photo are read-only here; office biography/time zone remain editable.
      u.name=name;u.bio=bio;u.timeZone=timeZone;u.profilePhotoUrl=profilePhotoUrl;await save();return {user:publicUser(u)};
    }
    if(method==='POST' && pathname==='/avatar') {
      const avatarUrl=validatePortrait(body.avatarUrl);if(avatarUrl!==(u.avatarUrl||'')){u.avatarUrl=avatarUrl;await save();}return {user:publicUser(u)};
    }
    if(method==='POST' && pathname==='/channels') {
      const name=text(body.name,60).replace(/^#/,'');if(state.channels.some(c=>c.name.toLowerCase()===name.toLowerCase()))fail(409,'Já existe um canal com esse nome.');
      const members=Array.isArray(body.members)?body.members.filter(i=>state.users.some(u=>u.id===i)):[];
      const c={id:id(),name,description:text(body.description||'',300,false),private:!!body.private,members:[...new Set([u.id,...members])],owner:u.id};state.channels.push(c);await save();return {channel:c};
    }
    if(method==='GET' && pathname==='/messages') {
      const c=conversation(u,query.conversation);return {messages:state.messages.filter(m=>m.conversation===c.key&&!m.deleted).slice(-500)};
    }
    if(method==='POST' && pathname==='/messages') {
      if(u.status==='offline')fail(409,'Entre no escritório para enviar mensagens.');
      const c=conversation(u,body.conversation),rich=richContent(body.rich),value=text(rich?richPlain(rich):body.text,8000),parent=body.parent||null;
      if(typeof body.alsoSend!=='undefined'&&typeof body.alsoSend!=='boolean')fail(400,'Opção de resposta inválida.');
      if(parent){const m=state.messages.find(m=>m.id===parent&&!m.deleted);messageAccess(u,m);if(m.conversation!==c.key)fail(400,'A resposta precisa pertencer à mesma conversa.');if(m.parent)fail(400,'Responda ao início da conversa.');}
      const m={id:id(),conversation:c.key,recipients:c.recipients,author:u.id,text:value,rich,time:now(),parent,alsoSend:!!(parent&&body.alsoSend),subscribers:parent?[]:[u.id],reactions:{},edited:false};state.messages.push(m);const rootMessage=parent&&state.messages.find(r=>r.id===parent);if(rootMessage){const inherited=rootMessage.subscribers??[rootMessage.author,...state.messages.filter(r=>r.parent===parent&&r.id!==m.id).map(r=>r.author)];rootMessage.subscribers=[...new Set([...inherited,...((rootMessage.mutedSubscribers||[]).includes(u.id)?[]:[u.id])])];}const recipients=rootMessage&&!m.alsoSend?rootMessage.subscribers.filter(i=>c.recipients.includes(i)):c.recipients;activity('message',u,recipients,{messageId:m.id,conversation:m.conversation,parent,text:value.slice(0,180)});await save();return {message:m};
    }
    if(method==='POST' && pathname==='/message-subscription') {
      const m=state.messages.find(m=>m.id===body.id&&!m.deleted);messageAccess(u,m);const rootMessage=m.parent?state.messages.find(r=>r.id===m.parent&&!r.deleted):m;messageAccess(u,rootMessage);
      if(typeof body.subscribed!=='boolean')fail(400,'Escolha se quer receber notificações.');const subscribers=rootMessage.subscribers??[rootMessage.author,...state.messages.filter(r=>r.parent===rootMessage.id).map(r=>r.author)];rootMessage.subscribers=body.subscribed?[...new Set([...subscribers,u.id])]:subscribers.filter(i=>i!==u.id);rootMessage.mutedSubscribers=body.subscribed?(rootMessage.mutedSubscribers||[]).filter(i=>i!==u.id):[...new Set([...(rootMessage.mutedSubscribers||[]),u.id])];await save();return {subscribed:body.subscribed};
    }
    if(method==='POST' && pathname==='/message-unread') {
      const m=state.messages.find(m=>m.id===body.id&&!m.deleted);messageAccess(u,m);u.unreadMessages=[...new Set([...(u.unreadMessages||[]),m.id])];for(const a of state.activity)if(a.messageId===m.id&&a.recipients.includes(u.id))a.readBy=a.readBy.filter(i=>i!==u.id);await save();return {ok:true};
    }
    if(method==='POST' && pathname==='/message-read') {
      const c=conversation(u,body.conversation);u.unreadMessages=(u.unreadMessages||[]).filter(i=>!state.messages.some(m=>m.id===i&&m.conversation===c.key));for(const a of state.activity)if(a.conversation===c.key&&a.recipients.includes(u.id)&&!a.readBy.includes(u.id))a.readBy.push(u.id);await save();return {ok:true};
    }
    if(method==='POST' && pathname==='/message-edit') {
      const m=state.messages.find(m=>m.id===body.id&&!m.deleted);messageAccess(u,m);if(m.author!==u.id)fail(403,'Você pode editar somente suas mensagens.');const rich=richContent(body.rich),value=text(rich?richPlain(rich):body.text,8000);m.text=value;m.rich=rich;m.edited=true;await save();return {message:m};
    }
    if(method==='POST' && pathname==='/message-delete') {
      const m=state.messages.find(m=>m.id===body.id);messageAccess(u,m);if(m.author!==u.id)fail(403,'Você pode excluir somente suas mensagens.');m.deleted=now();await save();return {restorable:true};
    }
    if(method==='POST' && pathname==='/message-restore') {
      const m=state.messages.find(m=>m.id===body.id);messageAccess(u,m);if(m.author!==u.id)fail(403,'Você pode restaurar somente suas mensagens.');delete m.deleted;await save();return {message:m};
    }
    if(method==='POST' && pathname==='/reaction') {
      const m=state.messages.find(m=>m.id===body.id&&!m.deleted);messageAccess(u,m);const emoji=text(body.emoji,16);if(!['👍','❤️','😂','🎉','👀','✅','🙌','🔥'].includes(emoji))fail(400,'Reação inválida.');
      const list=m.reactions[emoji]||[];m.reactions[emoji]=list.includes(u.id)?list.filter(i=>i!==u.id):[...list,u.id];await save();return {message:m};
    }
    if(method==='POST' && pathname==='/read') {for(const a of state.activity)if(a.recipients.includes(u.id)&&(!body.id||body.id===a.id)&&(!body.conversation||body.conversation===a.conversation)&&!a.readBy.includes(u.id))a.readBy.push(u.id);await save();return {ok:true};}
    if(method==='POST' && pathname==='/preferences') {const allowed=['weekends','notifications','sound','reducedMotion','clock24','noiseSuppression','autoGainControl','echoCancellation','autoMute','videoHD','hideSelf','autoLowerHand','screenHD','autoMeetingView','calendarReminder','calendarReminderStart','calendarSound','muteMeetingNotifications','muteMeetingSounds'];const updated={...(u.preferences||{})};for(const key of allowed)if(typeof body[key]==='boolean')updated[key]=body[key];for(const [key,options] of Object.entries({theme:['light','dark','system'],weekStart:['sunday','monday'],chatNotify:['all','direct','none'],chatSound:['all','direct','none'],performance:['quality','balanced','efficient']}))if(body[key]!==undefined){if(!options.includes(body[key]))fail(400,'Preferência inválida.');updated[key]=body[key];}if(body.volume!==undefined){const volume=Number(body.volume);if(!Number.isFinite(volume)||volume<0||volume>1)fail(400,'Volume inválido.');updated.volume=volume;}u.preferences=updated;await save();return {user:publicUser(u)};}
    if(method==='POST' && pathname==='/events') {
      const title=text(body.title,160),start=new Date(body.start).getTime(),end=new Date(body.end).getTime();
      if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)fail(400,'O fim precisa ser posterior ao início.');
      const e={id:id(),owner:u.id,title,start,end,description:text(body.description||'',2000,false),location:text(body.location||'',200,false)};state.events.push(e);activity('event',u,state.users.map(u=>u.id),{eventId:e.id,text:title});await save();return {event:e};
    }
    if(method==='POST' && pathname==='/event-edit') {const e=state.events.find(e=>e.id===body.id&&!e.deleted);if(!e)fail(404,'Evento não encontrado.');if(e.owner!==u.id)fail(403,'Você pode editar somente seus eventos.');const start=new Date(body.start).getTime(),end=new Date(body.end).getTime();if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)fail(400,'O fim precisa ser posterior ao início.');Object.assign(e,{title:text(body.title,160),start,end,description:text(body.description||'',2000,false),location:text(body.location||'',200,false)});await save();return {event:e};}
    if(method==='POST' && pathname==='/event-notes') {const e=state.events.find(e=>e.id===body.id&&!e.deleted);if(!e)fail(404,'Evento não encontrado.');e.notes=text(body.notes||'',10000,false);e.notesAuthor=u.id;await save();return {event:e};}
    if(method==='POST' && pathname==='/event-delete') {const e=state.events.find(e=>e.id===body.id);if(!e)fail(404,'Evento não encontrado.');if(e.owner!==u.id)fail(403,'Você pode remover somente seus eventos.');e.deleted=now();await save();return {restorable:true};}
    if(method==='POST' && pathname==='/event-restore') {const e=state.events.find(e=>e.id===body.id);if(!e)fail(404,'Evento não encontrado.');if(e.owner!==u.id)fail(403,'Você pode restaurar somente seus eventos.');delete e.deleted;await save();return {event:e};}
    if(method==='POST' && pathname==='/meetings') {
      if(hasActiveMeeting(u.id))fail(409,'Saia da sessão atual antes de iniciar outra.');
      const notifyMode=body.notifyMode===undefined?'none':body.notifyMode;if(!['none','available'].includes(notifyMode))fail(400,'Escolha uma opção válida de aviso.');
      const m={id:id(),name:text(body.name,120),owner:u.id,private:!!body.private,notifyMode,members:[u.id],requests:[],type:['focused','pomodoro','freeform','meeting'].includes(body.type)?body.type:'meeting',duration:Math.max(1,Math.min(180,Number(body.duration)||60)),started:now(),jamUrl:text(body.jamUrl||'',500,false),location:text(body.location||'',120,false),topic:text(body.topic||'',200,false),focusMinutes:Math.max(1,Math.min(90,Number(body.focusMinutes)||25)),breakMinutes:Math.max(1,Math.min(30,Number(body.breakMinutes)||5)),cycles:Math.max(1,Math.min(8,Math.floor(Number(body.cycles)||2))),offset:0};
      try{m.jamUrl=spotifyLinks.invitation(m.jamUrl)}catch(error){fail(400,error.message)}
      state.meetings.push(m);if(notifyMode==='available'){const recipients=state.users.filter(p=>!p.archived&&p.id!==u.id&&p.status==='online'&&p.lastSeen>=now()-45000&&!hasActiveMeeting(p.id)).map(p=>p.id);if(recipients.length)activity('coworking',u,recipients,{meetingId:m.id,conversation:'meeting:'+m.id,text:u.name+' iniciou '+m.name+(m.topic?' · '+m.topic:'')});}await save();return {meeting:publicMeeting(u,m)};
    }

    if(method==='POST' && pathname==='/meeting-hand') {
      const m=state.meetings.find(m=>m.id===body.id&&!m.ended);if(!m||!m.members.includes(u.id))fail(403,'Entre na reunião para levantar a mão.');
      if(typeof body.raised!=='boolean')fail(400,'Estado de mão inválido.');m.hands={...(m.hands||{}),[u.id]:body.raised};await save();return {ok:true};
    }
    if(method==='POST' && pathname==='/call-session') {if(u.status==='offline')fail(403,'Entre no escritório para participar da chamada.');const m=callRoom(u,body.meeting);if(!m||!m.members.includes(u.id))fail(403,'Você não participa dessa chamada.');const call={id:id(),lastSeen:now()};callSessions.set(m.id+':'+u.id,call);return {callId:call.id};}
    if(method==='GET' && pathname==='/signals') {
      if(u.status==='offline')fail(403,'Entre no escritório para participar da chamada.');
      const m=callRoom(u,query.meeting);if(!m||!m.members.includes(u.id))fail(403,'Você não participa dessa chamada.');
      const call=callSessions.get(m.id+':'+u.id);if(!call)fail(409,'A chamada foi reiniciada.','OFFICE_CALL_SESSION_MISSING');if(call.id!==query.call)fail(409,'A chamada foi reiniciada.','OFFICE_CALL_SESSION_REPLACED');call.lastSeen=now();const roster=Object.fromEntries(m.members.map(uid=>[uid,callSessions.get(m.id+':'+uid)]).filter(([uid,c])=>c&&c.lastSeen>now()-45000&&state.users.some(p=>p.id===uid&&!p.archived&&p.status!=='offline')).map(([uid,c])=>[uid,c.id]));signals=signals.filter(s=>s.time>now()-90000);return {signals:signals.filter(s=>s.meeting===m.id&&s.to===u.id&&s.toCall===call.id&&m.members.includes(s.from)&&s.sequence>(Number(query.after)||0)),cursor:signalSequence,members:m.members,roster};
    }
    if(method==='POST' && pathname==='/signal') {
      if(u.status==='offline'||!state.users.some(p=>p.id===body.to&&!p.archived&&p.status!=='offline'))fail(403,'Sinalização exige participantes conectados ao escritório.');
      const m=callRoom(u,body.meeting);if(!m||!m.members.includes(u.id)||!m.members.includes(body.to)||body.to===u.id)fail(403,'Sinalização permitida somente entre participantes.');
      const caller=callSessions.get(m.id+':'+u.id),recipient=callSessions.get(m.id+':'+body.to);if(!caller)fail(409,'A chamada foi reiniciada.','OFFICE_CALL_SESSION_MISSING');if(caller.id!==body.call)fail(409,'A chamada foi reiniciada.','OFFICE_CALL_SESSION_REPLACED');if(!recipient||recipient.id!==body.toCall)fail(409,'A chamada foi reiniciada.','OFFICE_SIGNAL_RECIPIENT_STALE');
      const signal=body.signal;if(!signal||!['offer','answer','candidate','renegotiate'].includes(signal.type))fail(400,'Sinal inválido.');
      let safe;
      if(signal.type==='renegotiate')safe={type:'renegotiate',...(signal.iceRestart===true?{iceRestart:true}:{})};
      else if(signal.type==='candidate'){const c=signal.candidate;if(!c||typeof c.candidate!=='string'||c.candidate.length>3000)fail(400,'Candidato inválido.');safe={type:'candidate',candidate:{candidate:c.candidate,sdpMid:typeof c.sdpMid==='string'?c.sdpMid:null,sdpMLineIndex:Number.isInteger(c.sdpMLineIndex)?c.sdpMLineIndex:null,usernameFragment:typeof c.usernameFragment==='string'?c.usernameFragment:null}};}
      else {if(typeof signal.sdp!=='string'||signal.sdp.length>32000)fail(400,'Descrição inválida.');safe={type:signal.type,sdp:signal.sdp};}
      signals=signals.filter(s=>s.time>now()-90000);signals.push({sequence:++signalSequence,meeting:m.id,to:body.to,toCall:recipient.id,from:u.id,fromCall:caller.id,time:now(),signal:safe});if(signals.length>2000)signals=signals.slice(-2000);return {ok:true};
    }
    if(method==='POST' && pathname==='/meeting-action') {

      const m=state.meetings.find(m=>m.id===body.id&&!m.ended);if(!m)fail(404,'Reunião encerrada.');
      if(body.action==='join') {if(hasActiveMeeting(u.id,m.id))fail(409,'Saia da sessão atual antes de entrar em outra.');if(m.private&&!m.members.includes(u.id)){if(!m.requests.some(r=>r.userId===u.id&&r.state==='pending'&&r.time>=now()-120000))m.requests.push({userId:u.id,state:'pending',time:now()});}else if(!m.members.includes(u.id))m.members.push(u.id);}
      else if(body.action==='cancel'){m.requests=m.requests.filter(r=>r.userId!==u.id);}
      else if(body.action==='leave'){m.members=m.members.filter(i=>i!==u.id);if(m.hands)delete m.hands[u.id];if(m.owner===u.id){if(m.members.length)m.owner=m.members[0];else m.ended=now();}}
      else if(['lock','unlock','approve','reject','end','pause','resume','next'].includes(body.action)){if(m.owner!==u.id)fail(403,'Somente quem conduz a reunião pode fazer isso.');if(body.action==='lock')m.private=true;if(body.action==='unlock')m.private=false;if(body.action==='end')m.ended=now();if(body.action==='pause'&&!m.paused)m.paused=now();if(body.action==='resume'&&m.paused){m.offset=(m.offset||0)+now()-m.paused;delete m.paused;}if(body.action==='next'){const phase=meetingPhase(m);if(phase.remaining===null||phase.phase==='completed')fail(400,'Não há outra etapa.');m.started-=phase.remaining;}if(['approve','reject'].includes(body.action)){const r=m.requests.find(r=>r.userId===body.userId&&r.state==='pending'&&r.time>=now()-120000);if(!r)fail(404,'Pedido não encontrado.');if(body.action==='approve'&&hasActiveMeeting(r.userId,m.id))fail(409,'Essa pessoa precisa sair da sessão atual antes de entrar aqui.');r.state=body.action==='approve'?'approved':'rejected';if(r.state==='approved'&&!m.members.includes(r.userId))m.members.push(r.userId);}}
      else fail(400,'Ação inválida.');await save();return {meeting:publicMeeting(u,m)};
    }
    fail(404,'Função não encontrada.');
  }
  return {
    requestAsCrm:dispatch,
    snapshot:()=>structuredClone(state),
    applyLastSeenOverlay:entries=>{for(const [uid,time] of entries){const user=state.users.find(item=>item.id===uid);if(user&&Number.isFinite(time))user.lastSeen=Math.max(Number.isFinite(user.lastSeen)?user.lastSeen:0,time);}},
    isDirty:()=>dirty,
    ephemeral:()=>structuredClone({signals,signalSequence,callSessions:[...callSessions],spatial:spatialPresence.exportState()})
  };
}
module.exports={createInterfaceService};
