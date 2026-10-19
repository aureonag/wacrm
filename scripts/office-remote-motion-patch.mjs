import {createHash} from 'node:crypto';

const hash=value=>createHash('sha256').update(value).digest('hex');
export const REMOTE_MOTION_BASE_APP_SHA256='a4a6149293f2c5515b4da6df5c190d27319514b7ef639cf8d545c4703071dd3e';
export const REMOTE_MOTION_REPLACEMENTS=Object.freeze([
  ['composeRemote:(dir,options)=>nativeAvatarFrame(dir,options,null,true)','composeRemote:(dir,options,frame=null)=>nativeAvatarFrame(dir,options,frame,true)'],
  ["return {x:Number(x),y:Number(y)};};\n\n// Keep remote markers", "return {x:Number(x),y:Number(y),pose:{facing:actor.getAttribute('data-facing')||'down',seated:actor.getAttribute('data-seated')==='true',layout:actor.getAttribute('data-seated-layout')||''}};};\n\n// Keep remote markers"]
 ].map(pair=>Object.freeze(pair)));

/** Adapt the reviewed v21 app; never run it or rewrite approved PNG data. */
export function remoteMotionPatch(source){
 if(hash(source)!==REMOTE_MOTION_BASE_APP_SHA256)throw Error('Unknown approved v21 app');
 let text=source;for(const [before,after]of REMOTE_MOTION_REPLACEMENTS){if(text.split(before).length!==2)throw Error('Remote motion anchor mismatch');text=text.replace(before,after);}return text;
}
