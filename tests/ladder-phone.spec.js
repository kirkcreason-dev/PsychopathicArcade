import {test,expect} from '@playwright/test';

// The production loader uses a fixed, full-viewport blob iframe. Exercise that
// layout with a short phone viewport, not just a tall standalone document.
async function embedded(page){
  await page.route('**/phone-host',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>html,body{margin:0;height:100%;overflow:hidden}iframe{position:fixed;inset:0;width:100%;height:100dvh;border:0}</style><iframe title="Arcade"></iframe><script>fetch('/game.html').then(r=>r.text()).then(html=>{document.querySelector('iframe').src=URL.createObjectURL(new Blob([html],{type:'text/html'}))})</script>`}));
  const loaded=page.waitForEvent('framenavigated',{predicate:frame=>frame.url().startsWith('blob:')});
  await page.goto('/phone-host');
  const frame=await loaded;
  await frame.waitForFunction(()=>window.ARCADE);
  await frame.evaluate(()=>{ARCADE.Sound.on=false;ARCADE.showScreen('ladder');});
  return frame;
}
async function controlsInView(frame,width,height){
  for(const id of ['lwCanvas','lwStick','lwHitBtn','lwThrowBtn','lwGuardBtn','lwFinisherBtn','lwPauseBtn','lwHomeBtn']){
    const b=await frame.locator('#'+id).boundingBox();
    expect(b.x,id).toBeGreaterThanOrEqual(0);expect(b.y,id).toBeGreaterThanOrEqual(0);
    expect(b.x+b.width,id).toBeLessThanOrEqual(width);expect(b.y+b.height,id).toBeLessThanOrEqual(height);
  }
  if(height<500)for(const selector of ['#lwSoundBtn img','#lwScreen .lb-mini img']){
    const image=frame.locator(selector),b=await image.boundingBox(),button=await image.evaluate(el=>{const r=el.parentElement.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom};});
    expect(b.x).toBeGreaterThanOrEqual(button.x);expect(b.y).toBeGreaterThanOrEqual(button.y);
    expect(b.x+b.width).toBeLessThanOrEqual(button.right);expect(b.y+b.height).toBeLessThanOrEqual(button.bottom);
  }
  expect(await frame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
}
for(const [width,height] of [[320,568],[390,664],[430,740],[667,375],[844,390]])test(`embedded match keeps the ring and controls visible at ${width}×${height}`,async({page})=>{
  await page.setViewportSize({width,height});const frame=await embedded(page);
  if(height<500)await frame.addStyleTag({content:'#lwScreen *{font-family:Arial,sans-serif!important}'});
  // Reproduce a player arriving with the instructions scrolled into view.
  await frame.locator('#lwInstructions').scrollIntoViewIfNeeded();
  await frame.locator('#lwStartBtn').click();await expect(frame.locator('#lwCountdown')).toBeVisible();
  await controlsInView(frame,width,height);
  await frame.locator('#lwPauseBtn').click();await expect(frame.locator('#lwPause')).toBeVisible();
  await controlsInView(frame,width,height);
  await frame.locator('#lwHomeBtn').click();await expect(frame.locator('#menuScreen')).toBeVisible();
  expect(await frame.evaluate(()=>getComputedStyle(document.body).overflow)).not.toBe('hidden');
});
test('phone chrome resizing and rematches keep all controls in view',async({page})=>{
  await page.setViewportSize({width:390,height:740});const frame=await embedded(page);
  await frame.locator('#lwStartBtn').click();await expect(frame.locator('#lwSetup')).toBeHidden();
  await page.setViewportSize({width:390,height:580});await controlsInView(frame,390,580);
  await frame.evaluate(()=>{const g=ARCADE.LADDER;g.pause(true);g.state.mode='playing';g.state.countdown=0;g.state.elapsed=119.99;g.step(.05);});
  await expect(frame.locator('#lwOver')).toBeVisible();await frame.locator('#lwAgainBtn').click();
  await expect(frame.locator('#lwCountdown')).toBeVisible();await controlsInView(frame,390,580);
});
test('opening three-count freezes rivals, actions and clock; pause preserves it',async({page})=>{
  const frame=await embedded(page);await frame.locator('#lwStartBtn').click();
  await frame.evaluate(()=>ARCADE.LADDER.pause(true));
  const before=await frame.evaluate(()=>JSON.stringify(ARCADE.LADDER.state));await page.waitForTimeout(150);
  expect(await frame.evaluate(()=>JSON.stringify(ARCADE.LADDER.state))).toBe(before);
  const r=await frame.evaluate(()=>{const g=ARCADE.LADDER,s=g.state;s.mode='playing';s.countdown=3;const positions=()=>s.fighters.map(f=>[f.x,f.y,f.hp,f.climb]);const before=positions();const action=g.act('throw');for(let i=0;i<40;i++)g.step(.05);const waiting={positions:positions(),elapsed:s.elapsed,time:s.time,carrier:s.ladder.carrier,count:s.countdown};for(let i=0;i<42;i++)g.step(.05);return{before,action,waiting,after:positions(),elapsed:s.elapsed};});
  expect(r.action).toBe(false);expect(r.waiting.positions).toEqual(r.before);expect(r.waiting.elapsed).toBe(0);expect(r.waiting.time).toBe(120);expect(r.waiting.carrier).toBeNull();expect(r.waiting.count).toBeCloseTo(1);expect(r.after).not.toEqual(r.before);expect(r.elapsed).toBeGreaterThan(0);
});
test('Tony reaches his prone frame quickly and stays down until recovery',async({page})=>{
  const frame=await embedded(page);
  const r=await frame.evaluate(async()=>{const g=ARCADE.LADDER;document.querySelector('#lwRoster').value='2-tuff-tony';await g.start();g.pause(true);g.state.mode='playing';g.state.countdown=0;const p=g.player();for(const f of g.state.fighters)if(!f.player)f.stun=999;Object.assign(p,{action:{kind:'down',t:0,duration:7},stun:7,hp:1});const art=g.roster.find(f=>f.id===p.id),frames=art.animations.down,c=document.querySelector('#lwCanvas').getContext('2d'),draw=c.drawImage,seen=[];c.drawImage=function(image,...args){if(image.src===art.src)seen.push(args.slice(0,4));return draw.call(this,image,...args);};const samples=[];for(let i=0;i<130;i++){g.step(.05);if([9,39,119].includes(i)){g.draw();samples.push(seen.at(-1));}}const down=p.action?.kind;for(let i=0;i<12;i++)g.step(.05);c.drawImage=draw;const last=frames.at(-1);return{samples,expected:[last.x,last.y,last.w,last.h],down,recovered:p.action===null,hp:p.hp};});
  for(const sample of r.samples)expect(sample).toEqual(r.expected);expect(r.down).toBe('down');expect(r.recovered).toBe(true);expect(r.hp).toBeGreaterThanOrEqual(55);
});
test('Caleb running frames face his movement in both wrestling games',async({page})=>{
  const frame=await embedded(page);
  const r=await frame.evaluate(async()=>{const results=[];for(const [name,prefix] of [['ladder','lw'],['rumble','ru']]){ARCADE.showScreen(name);const g=name==='ladder'?ARCADE.LADDER:ARCADE.RUMBLE;document.querySelector('#'+prefix+'Roster').value='caleb-konley';await g.start();g.pause(true);const p=g.player(),art=g.roster.find(f=>f.id===p.id),c=document.querySelector('#'+prefix+'Canvas').getContext('2d'),draw=c.drawImage;let transform;for(const facing of [-1,1])for(let i=0;i<art.animations.walk.length;i++){Object.assign(p,{walk:true,age:(i+.1)/9,action:null,facing});c.drawImage=function(image,...args){if(image.src===art.src)transform=this.getTransform().a;return draw.call(this,image,...args);};g.draw();results.push({facing,scale:transform});}c.drawImage=draw;}return results;});
  // The reviewed source run frames face left, so rightward motion needs a mirror.
  expect(r).toHaveLength(24);for(const draw of r)expect(Math.sign(draw.scale)).toBe(-draw.facing);
});
