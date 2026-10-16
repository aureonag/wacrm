import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {Script} from 'node:vm';
import {mapHarness} from './fixtures/office-map-camera-harness.mjs';
import {adaptOfficeMapViewport} from './office-map-viewport-patch.mjs';
// Exact map blocks from app.js before212 (whole-file SHA03ac5c4a...78286).
// SVG geometry below is a model; real browser verification is separate.
const before=fs.readFileSync(new URL('./fixtures/office-map-before212.js',import.meta.url),'utf8');
const {text:source}=adaptOfficeMapViewport(before,{verifyBase:false});
test('release patch rejects unknown whole-file source and changed anchors',()=>{assert.throws(()=>adaptOfficeMapViewport(before),/hash mismatch/);assert.throws(()=>adaptOfficeMapViewport(before.replace('function apply(v)','function different(v)'),{verifyBase:false}),/anchor count/);new Script(source);});
test('hidden follow and zoom never replace the last finite camera',()=>{const h=mapHarness(source),prior=h.raw();h.setSize(0,0);h.follow();h.zoom(1);h.full.onclick();assert.equal(h.api.refreshViewport(),false);assert.equal(h.raw(),prior);assert.equal(h.writes.length,0);});
test('reveal refresh calculates a positive camera before first drag',()=>{const h=mapHarness(source,{width:0,height:0});h.follow();h.setSize(1049,1049);assert.equal(h.api.refreshViewport(),true);h.drag(8,12);assert.equal(h.valid(),true);const manual=h.raw();h.position.x+=80;h.follow();assert.equal(h.raw(),manual);});
test('invalid SVG camera recovers before drag matrix is captured',()=>{const h=mapHarness(source);h.svg.setAttribute('viewBox','580 NaN 1222 NaN');h.drag(8,12);assert.equal(h.valid(),true);const v=h.api.read();assert.ok(Math.abs(v.w-1222.2222222222222)<1e-8);assert.ok(v.x<580.8888888888889);});
test('malformed manual dimensions and deltas cannot poison the camera',()=>{const h=mapHarness(source),prior=h.raw();for(const v of [{x:0,y:0,w:0,h:0},{x:NaN,y:0,w:100,h:100}])assert.equal(h.api.pan(v,1,1),false);for(const n of [NaN,Infinity]){h.api.pan(h.api.read(),n,1);h.api.center(n,2);h.api.wheel(1,2,n);h.zoom(n);}assert.equal(h.raw(),prior);assert.equal(h.writes.length,0);});
test('resize refresh preserves manual position and later zoom uses current ratio',()=>{const h=mapHarness(source);h.drag(20,12);const prior=h.raw();h.setSize(1600,900);assert.equal(h.api.refreshViewport(),true);assert.equal(h.raw(),prior);h.zoom(1.2);const v=h.api.read();assert.ok(Math.abs(v.w/v.h-1600/900)<1e-12);assert.equal(h.valid(),true);});
test('hidden manual camera is retained and recenter restores follow',()=>{const h=mapHarness(source);h.drag(20,12);const prior=h.raw();h.setSize(0,0);h.follow();h.api.pan(h.api.read(),20,20);assert.equal(h.raw(),prior);h.setSize(1000,800);h.api.refreshViewport();assert.equal(h.raw(),prior);h.tools[0].onclick();assert.notEqual(h.raw(),prior);assert.equal(h.valid(),true);});
test('singular or absent screen matrix cancels pointer operation safely',()=>{for(const matrix of [null,{inverse(){throw Error('singular');}},{inverse:()=>({a:NaN,b:0,c:0,d:1,e:0,f:0})}]){const h=mapHarness(source),prior=h.raw();h.svg.getScreenCTM=()=>matrix;h.drag(20,20);h.api.wheel(1,2,10);assert.equal(h.raw(),prior);}});
test('click retains dispatch and drag retains pointer capture cleanup',()=>{const h=mapHarness(source);let replay=0;h.svg.dispatchEvent=()=>replay++;h.emit('pointerdown');h.emit('pointerup');assert.equal(replay,1);h.drag(20,20);assert.equal(replay,1);assert.equal(h.svg.hasPointerCapture(1),false);assert.equal(h.valid(),true);});
