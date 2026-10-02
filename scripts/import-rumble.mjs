// Repack the reviewed Lunacy Unlocked v0.7.0 frame rectangles, never a guessed grid.
// Run once with its dist/assets directory, then --embed needs only committed files.
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
const root=fileURLToPath(new URL('../',import.meta.url));
const directory=path.join(root,'assets/rumble');
const manifestPath=path.join(directory,'manifest.json');
const animations=['idle','walk','light','heavy','hurt','lift','throw','down','victory'];
if(process.argv[2] && !['--embed','--check'].includes(process.argv[2])){
  const source=JSON.parse(await fs.readFile(path.join(directory,'source-roster.json'),'utf8'));
  const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browser=await chromium.launch(existsSync(chrome)?{executablePath:chrome}:{});
  const roster=[];
  try{
    const page=await browser.newPage();
    for(const fighter of source){
      const bytes=await fs.readFile(path.join(process.argv[2],fighter.id+'.png'));
      const result=await page.evaluate(async({fighter,animations,url})=>{
        const source=new Image();source.src=url;await source.decode();
        const scale=.64,pad=4,frames=[],lookup=new Map(),anims={};
        let x=0,y=0,rowH=0;
        for(const anim of animations){
          anims[anim]=(fighter.animations[anim]||fighter.animations.idle).map(f=>{
            const key=[f.x,f.y,f.w,f.h].join(':');let p=lookup.get(key);
            if(!p){
              const w=Math.ceil(f.w*scale),h=Math.ceil(f.h*scale);
              if(x+w+pad*2>1024){x=0;y+=rowH;rowH=0;}
              p={x:x+pad,y:y+pad,w,h,source:f};frames.push(p);lookup.set(key,p);
              x+=w+pad*2;rowH=Math.max(rowH,h+pad*2);
            }
            return {x:p.x,y:p.y,w:p.w,h:p.h,anchorX:(f.anchorX??f.w/2)*p.w/f.w,anchorY:(f.anchorY??f.h)*p.h/f.h,...(f.flipX?{flipX:true}:{}),...(f.drawScale?{drawScale:f.drawScale}:{})};
          });
        }
        const c=document.createElement('canvas');c.width=1024;c.height=y+rowH;
        const ctx=c.getContext('2d');ctx.imageSmoothingQuality='high';
        for(const f of frames){const s=f.source;if(s.x<0||s.y<0||s.x+s.w>source.width||s.y+s.h>source.height)throw new Error('Invalid reviewed rectangle');ctx.drawImage(source,s.x,s.y,s.w,s.h,f.x,f.y,f.w,f.h);}
        return {animations:anims,width:c.width,height:c.height,url:c.toDataURL('image/webp',.93),frames:frames.length};
      },{fighter,animations,url:'data:image/png;base64,'+bytes.toString('base64')});
      await fs.writeFile(path.join(directory,fighter.id+'.webp'),Buffer.from(result.url.split(',')[1],'base64'));
      const {id,name,style,color,power,speed,toughness,finisher}=fighter;
      roster.push({id,name,style,color,power,speed,toughness,finisher,animations:result.animations,width:result.width,height:result.height});
      console.log(`${name}: ${result.frames} reviewed frames, ${Math.round(result.url.length*.75/1024)} KB`);
    }
  }finally{await browser.close();}
  await fs.writeFile(manifestPath,JSON.stringify({source:'Lunacy Unlocked v0.7.0',scale:.64,roster},null,2)+'\n');
}
const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
for(const f of manifest.roster)f.src='data:image/webp;base64,'+(await fs.readFile(path.join(directory,f.id+'.webp'))).toString('base64');
const file=path.join(root,'public/game.html');let html=await fs.readFile(file,'utf8');const before=html;
const block='/* RUMBLE ART START */\nconst RUMBLE_ART = '+JSON.stringify(manifest)+';\n/* RUMBLE ART END */';
if(html.includes('/* RUMBLE ART START */'))html=html.replace(/\/\* RUMBLE ART START \*\/[\s\S]*?\/\* RUMBLE ART END \*\//,()=>block);
else html=html.replace('/* CLAW CATALOG START */',()=>block+'\n\n/* CLAW CATALOG START */');
if(process.argv.includes('--check')){if(html!==before)throw new Error('Run node scripts/import-rumble.mjs --embed to synchronize artwork.');console.log('22 wrestler atlases match the standalone game.');}
else{await fs.writeFile(file,html);console.log('Embedded 22 transparent wrestler atlases.');}
