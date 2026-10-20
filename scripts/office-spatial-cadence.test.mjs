import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {createScene}=require('./runtime/spatial-scene-core.js');
// Exact receiver published in218, independent of local release folders.
const {createReceiver}=require('./fixtures/spatial-receiver-218.cjs');
assert.equal(createHash('sha256').update(fs.readFileSync(new URL('./fixtures/spatial-receiver-218.cjs',import.meta.url),'utf8').replace(/\r\n/g,'\n')).digest('hex'),'860415917ed4072261636cbcbf7752a3eb36790c488a0a54ed2e4be8c85081a8');

const state=(x,updatedAt,pose={facing:'right',seated:false,layout:''})=>({capabilities:{spatialPresence:true},user:{id:'self'},users:[{id:'remote',name:'Bruno',status:'online',spatialPosition:{x,y:200,floorId:'office-1',updatedAt,pose}}]});

for(const speed of [160,440])test(`sustained ${speed}px/s motion follows the real200ms timer and500ms receiver gate without periodic stops or running snaps`,async()=>{
 let now=0;const scene=createScene({durationMs:500}),arrivals=[];
 const receiver=createReceiver({readState:()=>({capabilities:{spatialPresence:true,spatialSnapshots:true},user:{id:'self'}}),now:()=>now,request:async()=>({userId:'self',serverTime:100000+now,users:state(100+speed*now/1000,100000+now).users}),onSnapshot:snapshot=>{arrivals.push(now);scene.observe(snapshot,now);},schedule:()=>0,unschedule:()=>{}});
 let previous=null;
 for(now=0;now<=4200;now+=50){
  if(now%200===0)await receiver.tick();
  const frame=scene.frame(now)[0];
  if(now>=650){
   assert.equal(frame.moving,true,`walking at${now}ms`);
   assert.equal(frame.motionElapsed,now-600,'continuous animation phase');
   assert.ok(Math.abs(frame.x-(100+speed*(now-600)/1000))<1e-7,'one sample of bounded interpolation delay');
   assert.ok(Math.abs(frame.x-previous.x-speed*.05)<1e-7,'no jump between adjacent frames');
  }
  assert.ok(frame.x<=100+speed*now/1000,'never extrapolate past the last position');
  previous=frame;
 }
 assert.deepEqual(arrivals,[0,600,1200,1800,2400,3000,3600,4200]);
 // Once the sender stops, one last repeated sample must not prolong movement.
 now=4800;scene.observe(state(100+speed*4.2,104200),now);
 assert.equal(scene.frame(4800)[0].moving,false);
 receiver.stop();
});

test('a delayed drawing does not turn valid running samples into teleports, and late arrivals catch up within one second',()=>{
 const scene=createScene({durationMs:500});scene.observe(state(100,100000),0);
 scene.observe(state(364,100600),600);assert.equal(scene.frame(800)[0].x,188);
 // Arrival jitter: new server sample is600ms newer, only400ms after arrival.
 scene.observe(state(628,101200),1000);assert.equal(scene.frame(1000)[0].x,276);
 assert.equal(scene.frame(1000)[0].moving,true);
 scene.observe(state(892,101800),2400);assert.equal(scene.frame(2400)[0].x,628);
 assert.equal(scene.frame(3399)[0].moving,true);assert.equal(scene.frame(3400)[0].moving,false);
 assert.equal(scene.frame(3400)[0].x,892);
});

test('an impossible jump and a long-disconnected relocation still snap instead of interpolating across the office',()=>{
 const scene=createScene({durationMs:500});scene.observe(state(100,100000),0);
 scene.observe(state(800,100600),600);assert.equal(scene.frame(600)[0].x,800);assert.equal(scene.frame(600)[0].moving,false);
 scene.observe(state(2000,110000),10000);assert.equal(scene.frame(10000)[0].x,2000);assert.equal(scene.frame(10000)[0].moving,false);
});

test('cadence adaptation retains seated poses, bounds, identity, stale exclusion and reduced motion',()=>{
 const scene=createScene({durationMs:500}),seat={facing:'up',seated:true,layout:'cafe-dining-back-v1'};
 scene.observe(state(100,100000),0);scene.observe(state(196,100600,seat),600);
 assert.equal(scene.frame(700)[0].seated,true);assert.equal(scene.frame(700)[0].layout,seat.layout);assert.equal(scene.frame(700)[0].moving,false);
 scene.observe(state(4000,101200),1200);assert.deepEqual(scene.frame(1200),[]);
 scene.observe(state(100,101800),1800);scene.observe({...state(200,102400),user:{id:'new-self'}},2400);
 assert.equal(scene.frame(2400)[0].x,200,'new identity cannot continue prior interpolation');
 assert.deepEqual(scene.frame(22400),[]);
 const reduced=createScene({durationMs:0});reduced.observe(state(100,100000),0);reduced.observe(state(364,100600),600);
 assert.equal(reduced.frame(600)[0].x,364);assert.equal(reduced.frame(600)[0].moving,false);
});
