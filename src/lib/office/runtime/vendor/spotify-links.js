/* Shared validation; an accepted URL is not proof of a live Jam invitation. */
(function(root){
 'use strict';
 const message='Use o convite do Spotify Jam, copiado em Convidar → Compartilhar link.';
 function invitation(value){
   if(typeof value!=='string'||value.length>500)throw new Error(message);
   const raw=value.trim();if(!raw)return '';
   if(/[\u0000-\u0020\\]/.test(raw))throw new Error(message);
   let url;try{url=new URL(raw)}catch{throw new Error(message)}
   if(url.protocol!=='https:'||!['open.spotify.com','spotify.link'].includes(url.hostname)||url.username||url.password||url.port)throw new Error(message);
   const parts=url.pathname.split('/').filter(Boolean);
   if(!parts.length||parts.some(p=>/^(track|album|artist|playlist|episode|show|search|user)$/i.test(p)))throw new Error(message);
   return url.href;
 }
 const api={invitation,message};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.aureonSpotifyLinks=api;
})(typeof window==='object'?window:null);
