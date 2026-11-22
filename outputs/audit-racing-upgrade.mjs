import {chromium,webkit} from '@playwright/test';
import fs from 'node:fs/promises';
const results=[];
for(const [name,type]of[['chrome',chromium],['webkit',webkit]]){
  const browser=await type.launch(name==='chrome'?{channel:'chrome'}:{});
  const page=await browser.newPage({viewport:{width:390,height:740},deviceScaleFactor:2});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const opened=Date.now();await page.goto('http://127.0.0.1:5180/game.html');await page.waitForFunction(()=>window.RACING_READY);
  const loadMs=Date.now()-opened;
  await page.evaluate(async()=>{
    ARCADE.Sound.on=false;window.trackDrawSamples=[];
    const create=RACING_RENDERER.create;RACING_RENDERER.create=(...args)=>{const r=create(...args),draw=r.draw;r.draw=(...a)=>{const start=performance.now();draw(...a);trackDrawSamples.push(performance.now()-start);};return r;};
    ARCADE.showScreen('racing');await ARCADE.RACING.loadAssets();ARCADE.RACING.start();
  });
  for(const [zone,target]of[['detroit',600],['carnival',5600],['arena',10600]]){
    await page.evaluate(target=>{for(let i=0;i<1600&&ARCADE.RACING.state.racers[0].z<target;i++){const s=ARCADE.RACING.state;ARCADE.RACING.debug.advance(.1,RACING_RULES.aiInput(s,0));}trackDrawSamples.length=0;},target);
    await page.waitForTimeout(3000);
    results.push({browser:name,zone,loadMs,errors:[...errors],...await page.evaluate(()=>{const a=trackDrawSamples.slice(3).sort((a,b)=>a-b);return{samples:a.length,drawMeanMs:a.reduce((s,n)=>s+n,0)/a.length,drawP95Ms:a[Math.floor(a.length*.95)],drawMaxMs:a.at(-1),phase:ARCADE.RACING.state.phase};})});
    await page.screenshot({path:`outputs/racing-upgrade-${name}-${zone}.png`});
  }
  await browser.close();
}
const report={scope:'Local headless desktop browsers with a390×740 @2x viewport; not a physical-phone benchmark.',results};
await fs.writeFile('outputs/racing-upgrade-rendering.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
