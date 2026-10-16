'use strict';
// Only the visual recipe is public; device choices and other preferences stay private.
const colors=['skin','hair','facial','shirt','pants','shoes'];
const styles=['skinStyle','hairStyle','beardStyle','topStyle','bottomStyle','shoeStyle','hatStyle','glassesStyle','otherStyle','costumeStyle'];
function publicAvatarAppearance(entries={}){
 let saved={},native=null;try{saved=JSON.parse(entries['aureon-avatar-v1']||'{}');}catch{}
 const legacy={};if(saved&&typeof saved==='object'&&!Array.isArray(saved)){
  for(const key of colors)if(typeof saved[key]==='string'&&/^#[0-9a-f]{6}$/i.test(saved[key]))legacy[key]=saved[key];
  for(const key of styles)if(typeof saved[key]==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(saved[key]))legacy[key]=saved[key];
 }
 try{const value=JSON.parse(entries['aureon-gather-avatar-applied-v1']||'null');if(value&&typeof value==='object'&&!Array.isArray(value)){
  const clean={version:1,pieces:{},colors:{}};
  for(const type of ['pieces','colors'])if(value[type]&&typeof value[type]==='object'&&!Array.isArray(value[type]))for(const [key,item]of Object.entries(value[type]).slice(0,20))if(/^\d{1,3}$/.test(key)&&((typeof item==='string'&&/^[A-Za-z0-9#_.:/-]{1,100}$/.test(item))||(Number.isInteger(item)&&item>=0&&item<100000)))clean[type][key]=item;
  if(Array.isArray(value.omitted))clean.omitted=value.omitted.filter(v=>Number.isInteger(v)&&v>0&&v<1000).slice(0,20);native=clean;
 }}catch{}
 return {version:1,legacy,...(native?{native}:{})};
}
module.exports={publicAvatarAppearance};
