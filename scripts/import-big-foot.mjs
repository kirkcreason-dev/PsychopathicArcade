// Pack reviewed transparent poses supplied for Big Foot into the shared roster.
// Image preparation is separate; this only crops, scales and packs those assets.
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';

const root=fileURLToPath(new URL('../',import.meta.url));
const directory=path.join(root,'assets/rumble');
const spec=JSON.parse(await fs.readFile(path.join(directory,'big-foot-source/frames.json'),'utf8'));
const images={};
for(const sheet of Object.keys(spec.scales))images[sheet]='data:image/png;base64,'+(await fs.readFile(path.join(directory,'big-foot-source',sheet+'.png'))).toString('base64');
const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser=await chromium.launch(existsSync(chrome)?{executablePath:chrome}:{});
let packed;
try{
  const page=await browser.newPage();
  packed=await page.evaluate(async({spec,images})=>{
    const sheets={};
    for(const [key,url] of Object.entries(images)){const im=new Image();im.src=url;await im.decode();sheets[key]=im;}
    const frames={},draws=[];let x=0,y=0,rowH=0;
    for(const [key,f] of Object.entries(spec.frames)){
      const [left,top,right,bottom]=f.rect,sw=right-left,sh=bottom-top,scale=spec.scales[f.sheet];
      const source=sheets[f.sheet];
      if(left<0||top<0||right>source.width||bottom>source.height||sw<=0||sh<=0)throw new Error('Invalid reviewed rectangle: '+key);
      const w=Math.ceil(sw*scale),h=Math.ceil(sh*scale),pad=4;
      if(x+w+pad*2>1024){x=0;y+=rowH;rowH=0;}
      const frame={x:x+pad,y:y+pad,w,h,anchorX:(f.anchor[0]-left)*w/sw,anchorY:(f.anchor[1]-top)*h/sh,...(f.flipX?{flipX:true}:{})};
      frames[key]=frame;draws.push({source,left,top,sw,sh,frame});x+=w+pad*2;rowH=Math.max(rowH,h+pad*2);
    }
    const c=document.createElement('canvas');c.width=1024;c.height=y+rowH;
    const ctx=c.getContext('2d');ctx.imageSmoothingQuality='high';
    for(const {source,left,top,sw,sh,frame:f} of draws)ctx.drawImage(source,left,top,sw,sh,f.x,f.y,f.w,f.h);
    const animations=Object.fromEntries(Object.entries(spec.animations).map(([key,ids])=>[key,ids.map(id=>{
      if(!frames[id])throw new Error('Unknown pose: '+id);return frames[id];
    })]));
    return {width:c.width,height:c.height,animations,url:c.toDataURL('image/webp',.93)};
  },{spec,images});
}finally{await browser.close();}
const {url,...atlas}=packed;
const fighter={...spec.fighter,...atlas};
await fs.writeFile(path.join(directory,'big-foot.webp'),Buffer.from(url.split(',')[1],'base64'));
await fs.writeFile(path.join(directory,'additional-roster.json'),JSON.stringify([fighter],null,2)+'\n');
const manifestPath=path.join(directory,'manifest.json');
const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
manifest.roster=[...manifest.roster.filter(f=>f.id!==fighter.id),fighter];
manifest.additionalSource='Big Foot: artwork supplied by the owner, prepared as transparent poses';
await fs.writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
console.log(`Packed Big Foot: ${Object.keys(spec.frames).length} poses, ${Math.round(url.length*.75/1024)} KB. Run import-rumble.mjs --embed next.`);
