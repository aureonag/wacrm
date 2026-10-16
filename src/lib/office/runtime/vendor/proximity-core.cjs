'use strict';
// Pair membership is calculated from fresh server-owned virtual positions, never request claims.
function proximityRoom(user,{users,meetings,snapshot,phase,now,radius=180}){
 const joined=id=>meetings.some(m=>!m.ended&&phase(m).phase!=='completed'&&m.members.includes(id));
 const active=u=>u&&!u.archived&&u.status!=='offline'&&u.lastSeen>=now-45000&&!joined(u.id);
 if(!active(user))return null;const position=snapshot(user);if(!position)return null;
 const peers=users.filter(other=>other.id!==user.id&&active(other)).filter(other=>{const p=snapshot(other);return p&&p.floorId===position.floorId&&p.areaId===position.areaId&&Math.hypot(p.x-position.x,p.y-position.y)<=radius;});
 return {id:'proximity:'+position.floorId+':'+position.areaId,name:'Conversa por proximidade',type:'proximity',phase:'proximity',area:position.areaName,members:[user.id,...peers.map(p=>p.id)].sort(),radius,hands:{},private:false};
}
module.exports={proximityRoom};
