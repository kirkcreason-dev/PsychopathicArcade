import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome'}),report=[];
for(const [name,width,height] of [['desktop',1280,800],['phone',390,740],['landscape',844,390]]){
  const page=await browser.newPage({viewport:{width,height}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:5180/game.html');await page.waitForFunction(()=>window.RACING_READY);
  await page.evaluate(async()=>{ARCADE.Sound.on=false;ARCADE.showScreen('racing');await ARCADE.RACING.loadAssets();});
  await page.screenshot({path:'outputs/racing-'+name+'-selection.png'});
  await page.locator('#rcStartBtn').click();
  await page.evaluate(()=>{for(let i=0;i<600;i++){const s=ARCADE.RACING.state;ARCADE.RACING.debug.advance(1/60,RACING_RULES.aiInput(s,0));}});
  await page.waitForTimeout(150);await page.screenshot({path:'outputs/racing-'+name+'-race.png'});
  report.push({name,width,height,errors,layout:await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth,canvas:(()=>{const r=document.getElementById('rcCanvas').getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};})(),time:ARCADE.RACING.state.time}))});await page.close();
}
await browser.close();await fs.writeFile('outputs/racing-visual-audit.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
