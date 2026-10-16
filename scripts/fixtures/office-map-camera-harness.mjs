import assert from 'node:assert/strict';
import vm from 'node:vm';
export function blocks(source){
 const take=(a,b)=>{const start=source.indexOf(a),end=source.indexOf(b,start);assert.ok(start>=0&&end>start);return source.slice(start,end);};
 const follow=take('officeCameraFollow=function(p){if(overview)return;','zoomTo=function(v){overview');
 const navigation=take('// Pan and pointer-anchored zoom for the complete local office.','// Hand-drawn SVG pixel artwork.');
 const gestures=take('// Map gestures run before avatar movement and furniture actions.','let officeLeaveSeat=');
 const stop=source.match(/officeStopMovement=function\(\)\{[^}]*\};/)?.[0];assert.ok(stop);
 const cancel=source.match(/window\.aureonCancelSeatApproach=\(\)=>\{[^}]*\};/)?.[0];assert.ok(cancel);
 return{follow,navigation,gestures,stop,cancel};
}
export function mapHarness(source,{width=1049,height=1049,view={x:0,y:0,w:1222.2222222222222,h:1018.5185185185185},position={x:1192,y:329}}={}){
 const events=new Map(),attrs=new Map(),writes=[],captured=new Set(),tools=[],styles=[];
 const classes=()=>({toggle(){},add(){},remove(){}});
 const host={clientWidth:width,clientHeight:height,classList:classes()};
 const svg={parentElement:host,clientWidth:width,clientHeight:height,style:{},classList:classes(),viewBox:{baseVal:{x:view.x,y:view.y,width:view.w,height:view.h}},contains:target=>target===svg,closest:()=>null,
 getAttribute:name=>attrs.get(name)??null,setAttribute(name,value){attrs.set(name,String(value));if(name==='viewBox'){writes.push(String(value));const [x,y,w,h]=String(value).split(' ').map(Number);if([x,y,w,h].every(Number.isFinite)&&w>0&&h>0)Object.assign(this.viewBox.baseVal,{x,y,width:w,height:h});else Object.assign(this.viewBox.baseVal,{x:0,y:0,width:0,height:0});}},
 setPointerCapture:id=>captured.add(id),hasPointerCapture:id=>captured.has(id),releasePointerCapture:id=>captured.delete(id),dispatchEvent(){},
 getScreenCTM(){const b=this.viewBox.baseVal;return{inverse:()=>b.width>0&&b.height>0&&this.clientWidth>0&&this.clientHeight>0?{a:b.width/this.clientWidth,b:0,c:0,d:b.height/this.clientHeight,e:b.x,f:b.y}:{a:1,b:0,c:0,d:1,e:0,f:0}};},
 createSVGPoint(){return{x:0,y:0,matrixTransform(m){return{x:this.x*m.a+this.y*m.c+m.e,y:this.x*m.b+this.y*m.d+m.f};}};}};
 svg.setAttribute('viewBox',[view.x,view.y,view.w,view.h].join(' '));writes.length=0;
 const full={onclick:null},zoomLabel={textContent:'90%'},help={textContent:''};
 const document={getElementById:id=>id==='office'?svg:null,querySelector:selector=>selector==='.map-viewport'?host:selector==='.map-tools'?{prepend:n=>tools.push(n)}:selector.includes('Ver escritório inteiro')?full:null,createElement:tag=>({tagName:tag.toUpperCase(),textContent:'',setAttribute(){},onclick:null}),head:{append:node=>styles.push(node)}};
 const window={addEventListener(type,fn){const list=events.get(type)||[];list.push(fn);events.set(type,list);}};
 const context={window,document,$:id=>id==='office'?svg:id==='zoomLabel'?zoomLabel:id==='mapHelp'?help:null,fixturePosition:position,PointerEvent:class{constructor(type,options){this.type=type;Object.assign(this,options);}}};
 vm.createContext(context);const b=blocks(source);
 const boot="let zoom=.9,zoomTo=()=>{},overview=false,W=2400,H=1800,position=fixturePosition,editing=false,placing=null,officeCameraFollow=()=>{},officeStopMovement=()=>{},route=[],routeRun=false,shiftHeld=false,pressed=new Set(),walking=false,pendingSeat=null;function setRoom(){}function editor(){}\n";
 vm.runInContext(boot+b.stop+'\n'+b.cancel+'\n'+b.follow+'\n'+b.navigation+'\n'+b.gestures+'\nglobalThis.fixtureFollow=()=>officeCameraFollow(position);globalThis.fixtureZoom=value=>zoomTo(value);',context,{timeout:1000});
 const emit=(type,values={})=>{const e={target:svg,pointerId:1,button:0,clientX:100,clientY:100,pointerType:'mouse',stopImmediatePropagation(){this.stopped=true;},preventDefault(){this.prevented=true;},...values};for(const fn of events.get(type)||[]){fn(e);if(e.stopped)break;}return e;};
 return{api:window.aureonMapNavigation,svg,host,writes,tools,zoomLabel,full,position,follow:()=>context.fixtureFollow(),zoom:value=>context.fixtureZoom(value),emit,setSize(w,h){host.clientWidth=svg.clientWidth=w;host.clientHeight=svg.clientHeight=h;},raw:()=>svg.getAttribute('viewBox'),valid:()=>{const values=String(svg.getAttribute('viewBox')).split(' ').map(Number);return values.length===4&&values.every(Number.isFinite)&&values[2]>0&&values[3]>0;},drag(dx,dy){emit('pointerdown');emit('pointermove',{clientX:100+dx,clientY:100+dy});emit('pointerup',{clientX:100+dx,clientY:100+dy});}};
}
// Invalid SVG baseVal zero fallback and CTM are explicit models, not browser measurements.
