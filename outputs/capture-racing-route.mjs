import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome'}),page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith('http://127.0.0.1:5180'))requests.push(r.url());});
await page.goto('http://127.0.0.1:5180/game.html');await page.waitForFunction(()=>window.RACING_READY);
await page.evaluate(async()=>{ARCADE.Sound.on=false;ARCADE.showScreen('racing');await ARCADE.RACING.loadAssets();ARCADE.RACING.choose('dani-mo');ARCADE.RACING.start();});
for(const[name,target]of[['carnival',5350],['arena',10500]]){
  await page.evaluate(target=>{for(let i=0;i<900&&ARCADE.RACING.state.racers[0].z<target;i++){const s=ARCADE.RACING.state;ARCADE.RACING.debug.advance(.1,RACING_RULES.aiInput(s,0));}},target);
  await page.waitForTimeout(750);await page.screenshot({path:'outputs/racing-'+name+'-race.png'});
}
await page.evaluate(()=>{for(let i=0;i<1800&&ARCADE.RACING.state.phase!=='finished';i++){const s=ARCADE.RACING.state;ARCADE.RACING.debug.advance(.1,RACING_RULES.aiInput(s,0));}});
await page.screenshot({path:'outputs/racing-finish.png'});
const state=await page.evaluate(()=>ARCADE.RACING.state);await fs.writeFile('outputs/racing-route-audit.json',JSON.stringify({errors,externalRequests:requests,phase:state.phase,time:state.time,racers:state.racers.map(r=>({name:r.racerId,time:r.finishTime,dnf:r.dnf,tickets:r.tickets}))},null,2));
await browser.close();console.log(JSON.stringify({errors,requests,phase:state.phase,time:state.time}));
