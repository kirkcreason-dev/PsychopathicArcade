import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),file=root+'public/game.html';
let html=await fs.readFile(file,'utf8');const before=html;
const parts=[
  ['racing.css','STYLE','</style>'],
  ['racing-card.html','CARD','<!-- POKER CARD START -->'],
  ['racing.html','SCREEN','<!-- POKER SCREEN START -->'],
  ['racing-assets.js','ASSETS','/* CLAW CATALOG START */'],
  ['racing-rules.js','RULES','/* CLAW CATALOG START */'],
  ['racing-renderer.js','RENDERER','/* CLAW CATALOG START */'],
  ['racing.js','GAME','/* CLAW CATALOG START */'],
  ['racing-music-data.js','MUSIC DATA','/* RACING GAME START */'],
  ['racing-music.js','MUSIC','/* RACING GAME START */'],
  ['racing-party.css','PARTY STYLE','</style>'],
  ['racing-party.html','PARTY SCREEN','<!-- POKER SCREEN START -->'],
  ['racing-party.js','PARTY','/* RACING GAME START */'],
  ['racing-multi.js','MULTI','/* RACING GAME START */']
];
for(const[name,label,anchor]of parts){
  const content=(await fs.readFile(root+'games/'+name,'utf8')).trim(),isHTML=name.endsWith('.html');
  const start=isHTML?'<!-- RACING '+label+' START -->':'/* RACING '+label+' START */';
  const end=isHTML?'<!-- RACING '+label+' END -->':'/* RACING '+label+' END */',block=start+'\n'+content+'\n'+end;
  if(html.includes(start)){const a=html.indexOf(start),b=html.indexOf(end,a);if(b<0)throw Error('Missing racing end '+label);html=html.slice(0,a)+block+html.slice(b+end.length);}
  else{if(!html.includes(anchor))throw Error('Missing racing anchor '+label);html=html.replace(anchor,()=>block+'\n'+anchor);}
}
if(process.argv.includes('--check')){if(html!==before)throw Error('Run node scripts/sync-racing.mjs to synchronize Road to the Show.');console.log('Racing sources match standalone game.');}
else await fs.writeFile(file,html);
