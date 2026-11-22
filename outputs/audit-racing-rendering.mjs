import {chromium,webkit} from '@playwright/test';
import fs from 'node:fs/promises';
const report=[];
for(const [name,type]of[['chrome',chromium],['webkit',webkit]]){
  const browser=await type.launch(name==='chrome'?{channel:'chrome'}:{}),page=await browser.newPage({viewport:{width:390,height:740},deviceScaleFactor:2});
  await page.goto('http://127.0.0.1:5180/game.html');await page.waitForFunction(()=>window.RACING_READY);
  await page.evaluate(async()=>{
    ARCADE.Sound.on=false;window.drawSamples=[];window.frameSamples=[];let previous=0;
    const create=RACING_RENDERER.create;RACING_RENDERER.create=(...args)=>{const r=create(...args),draw=r.draw;r.draw=(...a)=>{const start=performance.now();draw(...a);drawSamples.push(performance.now()-start);if(previous)frameSamples.push(start-previous);previous=start;};return r;};
    ARCADE.showScreen('racing');await ARCADE.RACING.loadAssets();ARCADE.RACING.start();for(let i=0;i<13;i++)ARCADE.RACING.debug.advance(.25);drawSamples.length=0;frameSamples.length=0;
  });
  await page.waitForTimeout(4500);
  report.push({browser:name,viewport:'390×740 @2x',...await page.evaluate(()=>{const summarize=a=>{a=a.slice(3).sort((a,b)=>a-b);return{samples:a.length,meanMs:a.reduce((a,b)=>a+b,0)/a.length,p95Ms:a[Math.floor(a.length*.95)],maxMs:a.at(-1)};};return{drawing:summarize(drawSamples),frames:summarize(frameSamples),phase:ARCADE.RACING.state.phase};})});
  await browser.close();
}
const output={scope:'Local headless desktop browser measurements using a phone-sized viewport; not physical phone or cross-network performance.',results:report};
await fs.writeFile('outputs/racing-rendering-audit.json',JSON.stringify(output,null,2));console.log(JSON.stringify(output));
