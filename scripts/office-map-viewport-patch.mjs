import {createHash} from 'node:crypto';

export const OFFICE_MAP_VIEWPORT_BASE_SHA256='5fd770bc8b8221e747da976f9e8afbc0bdf908cf77ead84ad32a4ebbbcded78c';
const hash=text=>createHash('sha256').update(text).digest('hex');
const need=(ok,message)=>{if(!ok)throw Error('Office map viewport: '+message);};
function once(source,before,after){need(source.split(before).length===2,'anchor changed: '+before.slice(0,90));return source.replace(before,after);}

const FOLLOW_BEFORE="officeCameraFollow=function(p){if(overview)return;const view=$('office');const ratio=Math.max(1.2,view.parentElement.clientWidth/view.parentElement.clientHeight),width=1100/zoom,height=width/ratio;const x=Math.max(-1400,Math.min(W+1400-width,p.x-width/2)),y=Math.max(-1400,Math.min(H+1400-height,p.y-height/2));view.setAttribute('viewBox',x+' '+y+' '+width+' '+height)};";
const FOLLOW_AFTER="officeCameraFollow=function(p){if(overview)return;const view=$('office'),host=view.parentElement,cw=host.clientWidth,ch=host.clientHeight;if(![cw,ch,p?.x,p?.y].every(Number.isFinite)||cw<=0||ch<=0)return;if(!Number.isFinite(zoom)||zoom<=0)zoom=1;const ratio=Math.max(1.2,cw/ch),width=1100/zoom,height=width/ratio;const x=Math.max(-1400,Math.min(W+1400-width,p.x-width/2)),y=Math.max(-1400,Math.min(H+1400-height,p.y-height/2));if(![x,y,width,height].every(Number.isFinite)||width<=0||height<=0)return;const box=x+' '+y+' '+width+' '+height;if(view.getAttribute('viewBox')!==box)view.setAttribute('viewBox',box)};";
const READ_BEFORE="(function(){const s=$('office'),W=2400,H=1800;let manual=null;const read=()=>{const b=s.viewBox.baseVal;return {x:b.x,y:b.y,w:b.width,h:b.height}};";
const READ_AFTER=`(function(){const s=$('office'),W=2400,H=1800;let manual=null,lastValid=null;
 const valid=v=>v&&[v.x,v.y,v.w,v.h].every(Number.isFinite)&&v.w>0&&v.h>0;
 const visible=()=>[s.clientWidth,s.clientHeight].every(Number.isFinite)&&s.clientWidth>0&&s.clientHeight>0;
 const raw=()=>{const b=s.viewBox.baseVal;return {x:b.x,y:b.y,w:b.width,h:b.height}};
 function write(v){if(!valid(v)||!visible())return false;const box=[v.x,v.y,v.w,v.h].join(' ');if(s.getAttribute('viewBox')!==box)s.setAttribute('viewBox',box);lastValid={...v};return true;}
 function read(){let v=raw();if(valid(v)){lastValid={...v};return v;}const saved=valid(manual)?manual:lastValid;if(visible()){if(valid(saved))write(saved);else follow(position);v=raw();if(valid(v)){lastValid={...v};return v;}}return valid(saved)?{...saved}:{x:0,y:0,w:1100,h:1100/1.2};}`;
const APPLY_BEFORE="function apply(v){manual=clamp(v);s.setAttribute('viewBox',[manual.x,manual.y,manual.w,manual.h].join(' '));zoom=1100/manual.w;$('zoomLabel').textContent=Math.round(zoom*100)+'%'}";
const APPLY_AFTER="function apply(v){if(!valid(v)||!visible())return false;const next=clamp(v);if(!write(next))return false;manual=next;zoom=1100/manual.w;$('zoomLabel').textContent=Math.round(zoom*100)+'%';return true}";
const WRAP_BEFORE="const follow=officeCameraFollow;officeCameraFollow=function(p){if(manual){s.setAttribute('viewBox',[manual.x,manual.y,manual.w,manual.h].join(' '))}else follow(p)};";
const WRAP_AFTER="const follow=officeCameraFollow;officeCameraFollow=function(p){if(!visible())return;if(valid(manual))write(manual);else{manual=null;follow(p);const v=raw();if(valid(v))lastValid={...v}}};";
const SCALE_BEFORE="function scaleTo(value,clientX,clientY){const v=read(),next=Math.max(.12,Math.min(4,value));let fx=.5,fy=.5;if(clientX!=null){const p=s.createSVGPoint();p.x=clientX;p.y=clientY;const at=p.matrixTransform(s.getScreenCTM().inverse());fx=(at.x-v.x)/v.w;fy=(at.y-v.y)/v.h}const w=1100/next,h=w/(s.clientWidth/s.clientHeight);apply({x:v.x+v.w*fx-w*fx,y:v.y+v.h*fy-h*fy,w,h})}";
const SCALE_AFTER="function scaleTo(value,clientX,clientY){if(!visible()||!Number.isFinite(value)||value<=0)return false;const v=read(),next=Math.max(.12,Math.min(4,value));let fx=.5,fy=.5;if(clientX!=null){if(![clientX,clientY].every(Number.isFinite))return false;try{const matrix=s.getScreenCTM()?.inverse();if(!matrix||![matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f].every(Number.isFinite))return false;const p=s.createSVGPoint();p.x=clientX;p.y=clientY;const at=p.matrixTransform(matrix);fx=(at.x-v.x)/v.w;fy=(at.y-v.y)/v.h;if(![fx,fy].every(Number.isFinite))return false;}catch{return false;}}const w=1100/next,h=w/(s.clientWidth/s.clientHeight);return apply({x:v.x+v.w*fx-w*fx,y:v.y+v.h*fy-h*fy,w,h})}";
const API_BEFORE="window.aureonMapNavigation={read,center:(x,y)=>{const v=read();apply({...v,x:x-v.w/2,y:y-v.h/2})},pan:(v,dx,dy)=>apply({...v,x:v.x-dx,y:v.y-dy}),wheel:(x,y,dy)=>{const currentZoom=1100/read().w;scaleTo(currentZoom*Math.exp(-Math.max(-600,Math.min(600,dy))*.0012),x,y)}};";
const API_AFTER="window.aureonMapNavigation={read,refreshViewport:()=>{if(!visible())return false;officeCameraFollow(position);return valid(raw());},center:(x,y)=>{if(![x,y].every(Number.isFinite))return false;const v=read();return apply({...v,x:x-v.w/2,y:y-v.h/2})},pan:(v,dx,dy)=>valid(v)&&[dx,dy].every(Number.isFinite)?apply({...v,x:v.x-dx,y:v.y-dy}):false,wheel:(x,y,dy)=>{if(![x,y,dy].every(Number.isFinite)||!visible())return false;const currentZoom=1100/read().w;return scaleTo(currentZoom*Math.exp(-Math.max(-600,Math.min(600,dy))*.0012),x,y)}};";
const FULL_BEFORE="const ratio=s.clientWidth/s.clientHeight,w=Math.max(W,H*ratio),h=w/ratio;apply";
const FULL_AFTER="if(!visible())return;const ratio=s.clientWidth/s.clientHeight,w=Math.max(W,H*ratio),h=w/ratio;apply";
const GESTURE_BEFORE="const matrix=s.getScreenCTM().inverse();gesture={id:e.pointerId,x:e.clientX,y:e.clientY,matrix,view:api.read(),";
const GESTURE_AFTER="const view=api.read();let matrix;try{matrix=s.getScreenCTM()?.inverse();}catch{return;}if(!view||![view.x,view.y,view.w,view.h,e.clientX,e.clientY].every(Number.isFinite)||view.w<=0||view.h<=0||!matrix||![matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f].every(Number.isFinite))return;gesture={id:e.pointerId,x:e.clientX,y:e.clientY,matrix,view,";
const RULES=[['follow-visible-positive-layout',FOLLOW_BEFORE,FOLLOW_AFTER],['recover-invalid-camera',READ_BEFORE,READ_AFTER],['validate-manual-camera',APPLY_BEFORE,APPLY_AFTER],['retain-valid-manual-follow',WRAP_BEFORE,WRAP_AFTER],['validate-pointer-zoom',SCALE_BEFORE,SCALE_AFTER],['refresh-after-visibility',API_BEFORE,API_AFTER],['guard-hidden-overview',FULL_BEFORE,FULL_AFTER],['read-before-pointer-matrix',GESTURE_BEFORE,GESTURE_AFTER],['safe-recenter-zoom','zoom=Math.max(.65,Math.min(2,zoom));','zoom=Number.isFinite(zoom)&&zoom>0?Math.max(.65,Math.min(2,zoom)):1;']];

/** Only the published v15 runtime is accepted for release construction. */
export function adaptOfficeMapViewport(source,{verifyBase=true}={}){
 need(typeof source==='string','source must be text');
 if(verifyBase)need(hash(source)===OFFICE_MAP_VIEWPORT_BASE_SHA256,'published v15 source hash mismatch');
 let text=source;const changes=[];
 for(const[rule,before,after]of RULES){const count=rule==='safe-recenter-zoom'?2:1;need(text.split(before).length===count+1,'anchor count changed: '+rule);text=count===1?once(text,before,after):text.split(before).join(after);changes.push({rule,occurrences:count});}
 return{text,changes};
}
