/* eslint-disable @typescript-eslint/no-require-imports -- Private CommonJS compatibility boundary. */
'use strict';
const zlib=require('node:zlib');
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}
function validatePortrait(value){
 const invalid=()=>{const error=Error('Use um retrato PNG de até 128 por 128 pixels.');error.status=400;throw error};
 if(value==='')return '';
 if(typeof value!=='string'||value.length>32000||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value))invalid();
 const encoded=value.slice(22),bytes=Buffer.from(encoded,'base64');
 if(bytes.toString('base64')!==encoded||bytes.length<45||!bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))invalid();
 let offset=8,width,height,channels,ended=false,palette=false,idat=[];
 while(offset<bytes.length){
  if(offset+12>bytes.length)invalid();const size=bytes.readUInt32BE(offset),end=offset+12+size;
  if(end>bytes.length)invalid();const kind=bytes.toString('ascii',offset+4,offset+8),data=bytes.subarray(offset+8,end-4);
  if(crc32(bytes.subarray(offset+4,end-4))!==bytes.readUInt32BE(end-4))invalid();
  if(offset===8&&kind!=='IHDR')invalid();
  if(kind==='IHDR'){
   if(width!==undefined||size!==13)invalid();width=data.readUInt32BE(0);height=data.readUInt32BE(4);channels={0:1,2:3,3:1,4:2,6:4}[data[9]];
   if(!width||!height||width>128||height>128||data[8]!==8||!channels||data[10]||data[11]||data[12])invalid();
  }else if(kind==='IDAT')idat.push(data);
  else if(kind==='PLTE'){if(!size||size%3||size>768)invalid();palette=true}
  else if(kind==='IEND'){if(size||end!==bytes.length)invalid();ended=true}
  else if(!(kind.charCodeAt(0)&32))invalid();
  offset=end;
 }
 if(!ended||!idat.length||(bytes[25]===3&&!palette))invalid();
 const expected=(width*channels+1)*height;let raw;
 try{raw=zlib.inflateSync(Buffer.concat(idat),{maxOutputLength:expected})}catch{invalid()}
 if(raw.length!==expected)invalid();for(let row=0;row<height;row++)if(raw[row*(width*channels+1)]>4)invalid();
 return value;
}
module.exports={validatePortrait};
