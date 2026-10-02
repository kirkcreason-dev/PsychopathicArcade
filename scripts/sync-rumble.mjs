import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const path=root+'public/game.html';let html=await fs.readFile(path,'utf8');const before=html;
for(const [file,label,anchor] of [['rumble.css','STYLE','</style>'],['rumble.html','SCREEN','  <!-- ================= CHICKEN HUNTIN ================= -->'],['rumble.js','GAME','/* CLAW CATALOG START */'],['ladder.css','LADDER STYLE','</style>'],['ladder.html','LADDER SCREEN','  <!-- ================= CHICKEN HUNTIN ================= -->'],['duels.js','DUELS GAME','/* CLAW CATALOG START */'],['duels.css','DUELS STYLE','</style>']]){
  const content=(await fs.readFile(root+'games/'+file,'utf8')).trim();const isHTML=file.endsWith('.html');
  const start=isHTML?'<!-- RUMBLE '+label+' START -->':'/* RUMBLE '+label+' START */',end=isHTML?'<!-- RUMBLE '+label+' END -->':'/* RUMBLE '+label+' END */';
  const block=start+'\n'+content+'\n'+end;
  if(html.includes(start)){const a=html.indexOf(start),b=html.indexOf(end,a);if(b<0)throw new Error('Missing rumble marker');html=html.slice(0,a)+block+html.slice(b+end.length);}
  else{if(!html.includes(anchor))throw new Error('Missing integration anchor');html=html.replace(anchor,()=>block+'\n'+anchor);}
}
if(process.argv.includes('--check')){if(html!==before)throw new Error('Run node scripts/sync-rumble.mjs to synchronize the standalone game.');console.log('Rumble source matches standalone game.');}
else await fs.writeFile(path,html);
