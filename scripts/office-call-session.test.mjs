import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createOfficeCallSession} from './office-call-session.mjs';

function fixture() {
  const listeners = new Map();
  class Node {
    constructor(tag) { this.tagName=tag; this.children=[]; this.parent=null; this.attributes={}; this.textContent=''; }
    get isConnected() { return this.parent === true || !!this.parent?.isConnected; }
    append(...nodes) { for(const node of nodes){node.remove();node.parent=this;this.children.push(node);} }
    remove() { if(this.parent?.children)this.parent.children=this.parent.children.filter(node=>node!==this);this.parent=null; }
    setAttribute(key,value) { this.attributes[key]=value; }
    addEventListener(type,callback) { this[type]=callback; }
    focus() { document.activeElement=this; }
  }
  const document={createElement:tag=>new Node(tag),head:new Node('head'),body:new Node('body')};
  document.head.parent=true;document.body.parent=true;
  const window={
    addEventListener(type,listener){const set=listeners.get(type)||new Set();set.add(listener);listeners.set(type,set);},
    removeEventListener(type,listener){listeners.get(type)?.delete(listener);},
  };
  const context={active:true,selfId:'self',status:'online',meeting:{id:'room',phase:'active',members:['self','remote']},generation:1,roomId:'room',callId:'call-1'};
  let stopped=0, reconnected=0, complete;
  const factory=vm.runInNewContext('('+createOfficeCallSession.toString()+')');
  const controller=factory({window,document,getContext:()=>context,disconnect(){stopped++;context.generation++;context.callId=null;context.roomId=null;},
    reconnect(){reconnected++;return new Promise(resolve=>{complete=resolve;});}});
  const replaced={status:409,code:'OFFICE_CALL_SESSION_REPLACED'};
  return {controller,context,document,listeners,replaced,get stopped(){return stopped;},get reconnected(){return reconnected;},finish(){complete();},
    notice:()=>document.body.children.find(node=>node.id==='aureonCallPaused')};
}

test('serialized controller is lazy and pauses only a current own-session replacement',()=>{
  const f=fixture(), token=f.controller.capture(); assert.equal(f.document.body.children.length,0);
  for(const error of [{status:409},{status:409,code:'OFFICE_CALL_SESSION_MISSING'},{status:409,code:'OFFICE_SIGNAL_RECIPIENT_STALE'},{status:403,code:f.replaced.code}]) {
    assert.equal(f.controller.handle(error,token),false); assert.equal(f.controller.canRun(),true);
  }
  assert.equal(f.controller.handle(f.replaced,token),true); assert.equal(f.stopped,1); assert.equal(f.controller.isPaused(),true);
  assert.equal(f.controller.capture(),null); assert.equal(f.controller.canRun(),false);
  assert.match(f.notice().children[0].textContent,/Chamada pausada/);
  assert.equal(f.notice().children[2].textContent,'Retomar chamada aqui');
  for(let i=0;i<8;i++){f.controller.handle(f.replaced,token);f.controller.render();}
  assert.equal(f.stopped,1); assert.equal(f.document.body.children.length,1);
});

test('late replacement errors are consumed without pausing a newer generation, room or call',()=>{
  for(const key of ['generation','roomId','callId']) {
    const f=fixture(), token=f.controller.capture(); f.context[key]=key==='generation'?2:'new-'+key;
    assert.equal(f.controller.handle(f.replaced,token),true); assert.equal(f.stopped,0); assert.equal(f.controller.isPaused(),false);
  }
});

test('an asynchronous replacement announces its notice without stealing focus from the chat',()=>{
  const f=fixture(), chat={tagName:'TEXTAREA'};f.document.activeElement=chat;
  f.controller.handle(f.replaced,f.controller.capture());
  assert.equal(f.document.activeElement,chat);assert.equal(f.notice().attributes.role,'status');
  f.controller.render();assert.equal(f.document.activeElement,chat);
});

test('membership/room refresh cannot release the latch; explicit resume is guarded and deduplicated without starting devices',async()=>{
  const f=fixture();f.controller.handle(f.replaced,f.controller.capture());
  f.context.meeting={id:'other-room',phase:'active',members:['self']};f.controller.render();assert.equal(f.controller.canRun(),false);
  for(const change of [()=>{f.context.active=false;},()=>{f.context.status='offline';},()=>{f.context.meeting.members=[];}]) {
    f.context.active=true;f.context.status='online';f.context.meeting.members=['self'];change();
    assert.equal(await f.controller.resume(),false);assert.equal(f.reconnected,0);
  }
  f.context.active=true;f.context.status='online';f.context.meeting.members=['self'];
  const first=f.controller.resume();assert.equal(f.reconnected,1);assert.equal(await f.controller.resume(),false);
  f.finish();assert.equal(await first,true);assert.equal(f.stopped,1);assert.equal(f.controller.canRun(),true);assert.equal(f.notice(),undefined);
});

test('paused controls cannot reactivate capture, while unrelated actions and normal outside-call controls are untouched',()=>{
  const f=fixture();
  const event={target:{closest:()=>({id:'mic'})},preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};
  for(const listener of f.listeners.get('click'))listener(event);assert.equal(event.prevented,undefined);
  f.controller.handle(f.replaced,f.controller.capture());
  for(const listener of f.listeners.get('click'))listener(event);assert.equal(event.prevented,true);assert.equal(event.stopped,true);
  const unrelated={target:{closest:()=>null},preventDefault(){throw Error('unrelated action blocked');}};
  for(const listener of f.listeners.get('click'))listener(unrelated);
  assert.equal(f.reconnected,0);assert.equal(f.stopped,1);
});

test('dispose removes guards and UI and makes late replacement/resume callbacks inert',async()=>{
  const f=fixture();f.controller.handle(f.replaced,f.controller.capture());const pending=f.controller.resume();
  f.controller.dispose();f.controller.dispose();f.finish();assert.equal(await pending,false);
  assert.equal(f.controller.canRun(),false);assert.equal(await f.controller.resume(),false);
  assert.equal(f.document.body.children.length,0);assert.equal(f.document.head.children.length,0);
  for(const set of f.listeners.values())assert.equal(set.size,0);
  f.controller.handle(f.replaced,{generation:1,roomId:'room',callId:'call-1'});assert.equal(f.stopped,1);
});
