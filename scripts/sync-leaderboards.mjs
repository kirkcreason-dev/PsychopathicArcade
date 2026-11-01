import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),file=root+'public/game.html';
let html=await fs.readFile(file,'utf8');const before=html;
for(const[name,label,oldStart,oldEnd,inclusive]of[
  ['leaderboards.css','STYLE','#recordsBtn{','.text-btn.net-btn{',false],
  ['leaderboards.html','MODAL','  <div id="lbModal"','  <div class="wire-divider"',false],
  ['leaderboards.js','CLIENT','const LB = (()=>{','window.LB_READY = true;',true],
]){
  const isHTML=name.endsWith('.html'),start=isHTML?'<!-- LEADERBOARDS '+label+' START -->':'/* LEADERBOARDS '+label+' START */',end=isHTML?'<!-- LEADERBOARDS '+label+' END -->':'/* LEADERBOARDS '+label+' END */';
  const content=(await fs.readFile(root+'games/'+name,'utf8')).trim(),block=start+'\n'+content+'\n'+end;
  let a=html.indexOf(start),b;
  if(a>=0){b=html.indexOf(end,a);if(b<0)throw new Error('Missing leaderboard marker '+label);b+=end.length;}
  else{a=html.indexOf(oldStart);if(a<0)throw new Error('Missing leaderboard anchor '+label);b=html.indexOf(oldEnd,a);if(b<0)throw new Error('Missing leaderboard end '+label);if(inclusive)b+=oldEnd.length;}
  html=html.slice(0,a)+block+(isHTML?'\n\n':'\n')+html.slice(b).replace(/^\n*/,'');
}
if(process.argv.includes('--check')){if(html!==before)throw new Error('Run node scripts/sync-leaderboards.mjs to synchronize leaderboard sources.');console.log('Leaderboard sources match standalone game.');}
else await fs.writeFile(file,html);
