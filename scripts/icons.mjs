import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
function crc32(b) { let c=0xffffffff; for(const v of b){ c^=v; for(let i=0;i<8;i++) c=(c>>>1)^((c&1)?0xedb88320:0); } return (c^0xffffffff)>>>0; }
function chunk(name,data){const type=Buffer.from(name),len=Buffer.alloc(4),crc=Buffer.alloc(4);len.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([type,data])));return Buffer.concat([len,type,data,crc]);}
for(const [name,size] of [['icon-192.png',192],['icon-512.png',512],['icon-maskable.png',512]]) {
 const raw=Buffer.alloc((size*3+1)*size);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const dx=x*64/size-32,dy=y*64/size-32,angle=35*Math.PI/180;
  const u=dx*Math.cos(angle)-dy*Math.sin(angle)+32,v=dx*Math.sin(angle)+dy*Math.cos(angle)+32;
  const mark=(u>=19&&u<25&&v>=29&&v<45)||(u>=29&&u<35&&v>=18&&v<46)||(u>=39&&u<45&&v>=18&&v<34);
  const i=y*(size*3+1)+1+x*3;raw[i]=mark?255:17;raw[i+1]=mark?99:18;raw[i+2]=mark?99:20;
 }
 const header=Buffer.alloc(13);header.writeUInt32BE(size);header.writeUInt32BE(size,4);header[8]=8;header[9]=2;
 writeFileSync(new URL('../public/'+name,import.meta.url),Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
}
