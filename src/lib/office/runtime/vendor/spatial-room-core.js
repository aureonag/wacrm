(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.aureonSpatialRoom=api;})(typeof window!=='undefined'?window:this,function(){'use strict';
 function resolve(rooms,point){
  if(!Array.isArray(rooms)||!Number.isFinite(point?.x)||!Number.isFinite(point?.y))return -1;
  const index=rooms.findIndex(room=>{
   if(!room||room.fallback||room.mergedInto!==undefined)return false;
   const bounds=room.spatialBounds??room;
   return ['x','y','w','h'].every(key=>Number.isFinite(bounds[key]))&&bounds.w>0&&bounds.h>0&&point.x>=bounds.x&&point.x<bounds.x+bounds.w&&point.y>=bounds.y&&point.y<bounds.y+bounds.h;
  });
  return index>=0?index:rooms.findIndex(room=>room?.fallback);
 }
 return {resolve};
});
