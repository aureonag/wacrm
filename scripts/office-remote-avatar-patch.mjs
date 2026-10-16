import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
const sha=s=>createHash('sha256').update(s).digest('hex');
export function remoteAvatarCompositor(source){
 if(sha(source)!=='7773b2be7f55eb0159a5e64879169fc3a086d85823e541ea88ef9122e07247ab')throw Error('Unknown approved v16 app');
 const replacements=[
  ['[dir,frame,o.skin,o.hair,o.facial,o.shirt,o.pants,o.shoes]','[dir,frame,o.skin,o.hair,o.facial,o.shirt,o.pants,o.shoes,o.hairStyle,o.beardStyle]'],
  ["function nativeAvatarFrame(dir,o,frame=null){if(!nativeReady||o.hairStyle==='bald'||o.beardStyle==='none')return null;","function nativeAvatarFrame(dir,o,frame=null,remote=false){if(!nativeReady||!remote&&(o.hairStyle==='bald'||o.beardStyle==='none'))return null;"],
  ["draw(registeredMaster[dir].hair.uri,'hair',o.hair);if(dir!=='up')draw(registeredMaster[dir].beard.uri,'beard',o.facial);","if(o.hairStyle!=='bald')draw(registeredMaster[dir].hair.uri,'hair',o.hair);if(dir!=='up'&&o.beardStyle!=='none')draw(registeredMaster[dir].beard.uri,'beard',o.facial);"],
  ['compose:nativeAvatarFrame};','compose:nativeAvatarFrame,composeRemote:(dir,options)=>nativeAvatarFrame(dir,options,null,true)};']
 ];
 let text=source;for(const [before,after]of replacements){if(text.split(before).length!==2)throw Error('Compositor anchor mismatch');text=text.replace(before,after);}return text;
}
