import fs from 'node:fs/promises';
const file=new URL('../public/game.html',import.meta.url);
let html=await fs.readFile(file,'utf8');const before=html;
for(const [name,label,anchor]of[
  ['road-riot.css','STYLE','</style>'],
  ['road-riot-card.html','CARD','<!-- RACING CARD START -->'],
  ['road-riot.html','SCREEN','<!-- RACING SCREEN START -->'],
  ['road-riot-rules.js','RULES','/* CLAW CATALOG START */'],
  ['road-riot.js','GAME','/* CLAW CATALOG START */']
]){
  const content=(await fs.readFile(new URL('../games/'+name,import.meta.url),'utf8')).trim(),markup=name.endsWith('.html');
  const start=markup?'<!-- ROAD RIOT '+label+' START -->':'/* ROAD RIOT '+label+' START */',end=markup?'<!-- ROAD RIOT '+label+' END -->':'/* ROAD RIOT '+label+' END */';
  const block=start+'\n'+content+'\n'+end;
  if(html.includes(start)){const a=html.indexOf(start),b=html.indexOf(end,a);if(b<0)throw Error('Missing Road Riot end '+label);html=html.slice(0,a)+block+html.slice(b+end.length);}
  else{if(!html.includes(anchor))throw Error('Missing Road Riot anchor '+label);html=html.replace(anchor,()=>block+'\n'+anchor);}
}
if(process.argv.includes('--check')){if(html!==before)throw Error('Run node scripts/sync-road-riot.mjs to synchronize Road Riot.');console.log('Road Riot sources match standalone game.');}
else await fs.writeFile(file,html);
