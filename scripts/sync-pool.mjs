import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const file=root+'public/game.html';let html=await fs.readFile(file,'utf8');const before=html;
for(const [name,label,anchor] of [['pool.css','STYLE','</style>'],['pool-card.html','CARD','      <button class="game-card" id="cardLW"'],['pool.html','SCREEN','  <!-- ================= CHICKEN HUNTIN ================= -->'],['pool-physics.js','PHYSICS','/* CLAW CATALOG START */'],['pool-rules.js','RULES','/* CLAW CATALOG START */'],['pool-ai.js','AI','/* CLAW CATALOG START */'],['pool-renderer.js','RENDERER','/* CLAW CATALOG START */'],['pool.js','GAME','/* CLAW CATALOG START */']]){
  const content=(await fs.readFile(root+'games/'+name,'utf8')).trim(),isHTML=name.endsWith('.html');
  const start=isHTML?'<!-- POOL '+label+' START -->':'/* POOL '+label+' START */',end=isHTML?'<!-- POOL '+label+' END -->':'/* POOL '+label+' END */';
  const block=start+'\n'+content+'\n'+end;
  if(html.includes(start)){const a=html.indexOf(start),b=html.indexOf(end,a);if(b<0)throw new Error('Missing pool marker: '+label);html=html.slice(0,a)+block+html.slice(b+end.length);}
  else{if(!html.includes(anchor))throw new Error('Missing pool anchor: '+label);html=html.replace(anchor,()=>block+'\n'+anchor);}
}
if(process.argv.includes('--check')){if(html!==before)throw new Error('Run node scripts/sync-pool.mjs to synchronize Juggalo Pool.');console.log('Pool sources match standalone game.');}
else await fs.writeFile(file,html);
