import {readFileSync,writeFileSync} from 'node:fs';
const source=new URL('../data/claw-roster.json',import.meta.url);
const game=new URL('../public/game.html',import.meta.url);
const catalog=JSON.parse(readFileSync(source,'utf8'));
const ids=new Set(),names=new Set();
for(const r of catalog.roster){
  if(!r.id||!r.name||ids.has(r.id)||names.has(r.name)||r.items?.length!==5||new Set(r.items.map(i=>i.kind)).size!==5)throw Error('Invalid five-item roster set: '+r.name);
  for(const i of r.items)if(!i.name||!i.kind)throw Error('Missing item in '+r.name);
  ids.add(r.id);names.add(r.name);
}
const start='/* CLAW CATALOG START */',end='/* CLAW CATALOG END */';
const block=start+'\nconst CLAW_CATALOG = '+JSON.stringify(catalog).replaceAll('<','\\u003c')+';\n'+end;
const html=readFileSync(game,'utf8');
if(!html.includes(start)||!html.includes(end))throw Error('Missing claw catalog markers');
const next=html.slice(0,html.indexOf(start))+block+html.slice(html.indexOf(end)+end.length);
if(process.argv.includes('--check')){if(next!==html)throw Error('Claw catalog changed. Run node scripts/sync-claw-catalog.mjs');}
else writeFileSync(game,next);
console.log(`Claw catalog: ${ids.size} roster sets, ${ids.size*5} collectibles.`);
