import {test,expect} from '@playwright/test';

test.use({isMobile:true,hasTouch:true,deviceScaleFactor:3});

// The production loader uses a fixed, full-viewport blob iframe. Exercise that
// layout with a short phone viewport, not just a tall standalone document.
async function embedded(page){
  await page.route('**/phone-host',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>html,body{margin:0;height:100%;overflow:hidden}iframe{position:fixed;inset:0;width:100%;height:100dvh;border:0}</style><iframe title="Arcade" hidden></iframe><script>fetch('/game.html').then(r=>r.text()).then(html=>{const iframe=document.querySelector('iframe');iframe.onload=()=>{iframe.hidden=false;iframe.focus();};iframe.src=URL.createObjectURL(new Blob([html],{type:'text/html'}))})</script>`}));
  const loaded=page.waitForEvent('framenavigated',{predicate:frame=>frame.url().startsWith('blob:')});
  await page.goto('/phone-host');
  const frame=await loaded;
  await frame.waitForFunction(()=>window.ARCADE);
  await frame.evaluate(()=>{ARCADE.Sound.on=false;ARCADE.showScreen('ladder');});
  return frame;
}
async function controlsInView(frame,width,height){
  // Bounds alone also pass for a collapsed, zero-height canvas.
  const ring=await frame.locator('#lwCanvas').boundingBox();
  const landscape=width>height;
  expect(ring.height,'visible arena height').toBeGreaterThanOrEqual(landscape?160:220);
  expect(Math.min(ring.width,ring.height*480/460),'painted arena width').toBeGreaterThanOrEqual(160);
  const stick=await frame.locator('#lwStick').boundingBox(),actions=await frame.locator('.lw-actions').boundingBox();
  expect(stick.width).toBeGreaterThanOrEqual(100);
  expect(stick.x+stick.width,'separate thumb controls').toBeLessThanOrEqual(actions.x);
  expect(stick.y+stick.height/2,'stick within lower thumb reach').toBeGreaterThan(height*.6);
  if(landscape){
    expect(stick.x+stick.width).toBeLessThanOrEqual(ring.x);
    expect(actions.x).toBeGreaterThanOrEqual(ring.x+ring.width);
    expect(actions.y+actions.height/2).toBeGreaterThan(height*.6);
  }else expect(stick.y).toBeGreaterThanOrEqual(ring.y+ring.height);

  for(const id of ['lwCanvas','lwStick','lwHitBtn','lwThrowBtn','lwGuardBtn','lwFinisherBtn','lwPauseBtn','lwHomeBtn']){
    const b=await frame.locator('#'+id).boundingBox();
    expect(b.x,id).toBeGreaterThanOrEqual(0);expect(b.y,id).toBeGreaterThanOrEqual(0);
    expect(b.x+b.width,id).toBeLessThanOrEqual(width);expect(b.y+b.height,id).toBeLessThanOrEqual(height);
  }
  for(const selector of ['#lwSoundBtn img','#lwScreen .lb-mini img']){
    const image=frame.locator(selector),b=await image.boundingBox(),button=await image.evaluate(el=>{const r=el.parentElement.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom};});
    expect(b.x).toBeGreaterThanOrEqual(button.x);expect(b.y).toBeGreaterThanOrEqual(button.y);
    expect(b.x+b.width).toBeLessThanOrEqual(button.right);expect(b.y+b.height).toBeLessThanOrEqual(button.bottom);
  }
  expect(await frame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
}
for(const [width,height] of [[320,568],[390,580],[390,664],[430,740],[568,320],[667,375],[844,390],[932,430]])test(`embedded match keeps the ring and controls visible at ${width}×${height}`,async({page})=>{
  await page.setViewportSize({width,height});const frame=await embedded(page);
  await frame.addStyleTag({content:'#lwScreen *{font-family:Arial,sans-serif!important}'});
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
  await page.setViewportSize({width:844,height:390});await controlsInView(frame,844,390);
  await page.setViewportSize({width:390,height:580});await controlsInView(frame,390,580);
  await frame.evaluate(()=>{const g=ARCADE.LADDER;g.pause(true);g.state.mode='playing';g.state.countdown=0;g.state.elapsed=119.99;g.step(.05);});
  await expect(frame.locator('#lwOver')).toBeVisible();await frame.locator('#lwAgainBtn').click();
  await expect(frame.locator('#lwCountdown')).toBeVisible();await controlsInView(frame,390,580);
});
test('short portrait keeps a real arena and lets players scroll to the controls',async({page,browserName})=>{
  await page.setViewportSize({width:390,height:440});const frame=await embedded(page);
  await frame.locator('#lwStartBtn').click();await expect(frame.locator('#lwCountdown')).toBeVisible();
  const ring=await frame.locator('#lwCanvas').boundingBox();expect(ring.height).toBeGreaterThanOrEqual(220);
  expect(await frame.locator('#lwScreen').evaluate(el=>el.scrollHeight>el.clientHeight&&getComputedStyle(el).overflowY==='auto')).toBe(true);
  // Swipe over the ring itself, not an invisible scrollbar or a DOM scroll.
  if(browserName==='chromium'){
    const input=await page.context().newCDPSession(page);
    await input.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:195,y:300}]});
    for(let y=280;y>=100;y-=20){await input.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:195,y}]});await page.waitForTimeout(16);}
    await input.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await input.detach();
  }else{
    // Mobile WebKit has no wheel/swipe injection API; verify its scroll container and reachable controls.
    await frame.locator('#lwHomeBtn').scrollIntoViewIfNeeded();
  }
  await expect.poll(()=>frame.locator('#lwScreen').evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
  await frame.locator('#lwHomeBtn').scrollIntoViewIfNeeded();
  const home=await frame.locator('#lwHomeBtn').boundingBox();expect(home.y+home.height).toBeLessThanOrEqual(440);
  await frame.locator('#lwHomeBtn').click();await expect(frame.locator('#menuScreen')).toBeVisible();
});
test('notch and home-indicator space leave both thumbs and the arena unobstructed',async({page})=>{
  await page.setViewportSize({width:844,height:390});const frame=await embedded(page);
  // Emulate the reserved insets; headless browsers report zero safe-area env values.
  await frame.addStyleTag({content:'#lwScreen.lw-match{padding:0 44px 21px}'});
  await frame.locator('#lwStartBtn').click();await expect(frame.locator('#lwCountdown')).toBeVisible();
  await controlsInView(frame,844,390);
  for(const id of ['lwStick','lwHitBtn','lwThrowBtn','lwFinisherBtn']){
    const b=await frame.locator('#'+id).boundingBox();expect(b.x).toBeGreaterThanOrEqual(44);expect(b.x+b.width).toBeLessThanOrEqual(800);expect(b.y+b.height).toBeLessThanOrEqual(369);
  }
});
test('landscape stick receives a drag at its visible position and releases cleanly',async({page})=>{
  await page.setViewportSize({width:844,height:390});const frame=await embedded(page);
  await frame.locator('#lwStartBtn').click();await expect(frame.locator('#lwCountdown')).toBeHidden({timeout:10000});
  await frame.evaluate(()=>{for(const f of ARCADE.LADDER.state.fighters)if(!f.player)f.stun=999;});
  const b=await frame.locator('#lwStick').boundingBox(),x=await frame.evaluate(()=>ARCADE.LADDER.player().x);
  await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width-5,b.y+b.height/2);
  await expect.poll(()=>frame.evaluate(()=>ARCADE.LADDER.player().x)).toBeGreaterThan(x+8);await page.mouse.up();
  const stopped=await frame.evaluate(()=>ARCADE.LADDER.player().x);await page.waitForTimeout(150);
  expect(await frame.evaluate(()=>ARCADE.LADDER.player().x)).toBeCloseTo(stopped,0);
});
test('opening three-count freezes rivals, actions and clock; pause preserves it',async({page})=>{
  const frame=await embedded(page);await frame.locator('#lwStartBtn').click();await expect(frame.locator('#lwCountdown')).toBeVisible();
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
for(const id of ['caleb-konley','sally-boy','facade','matt-cross','vincenzo','2-tuff-tony','willie-mack'])test(`${id} faces movement through every run frame in both wrestling games`,async({page})=>{
  const frame=await embedded(page);
  const samples=await frame.evaluate(async id=>{
    const results=[];
    for(const [name,prefix] of [['ladder','lw'],['rumble','ru']]){
      ARCADE.showScreen(name);const g=name==='ladder'?ARCADE.LADDER:ARCADE.RUMBLE;
      document.querySelector('#'+prefix+'Roster').value=id;await g.start();g.pause(true);
      const p=g.player(),art=g.roster.find(f=>f.id===id),ctx=document.querySelector('#'+prefix+'Canvas').getContext('2d'),draw=ctx.drawImage;
      let seen;
      ctx.drawImage=function(image,...args){if(image.src===art.src)seen={scale:this.getTransform().a,rect:args.slice(0,4)};return draw.call(this,image,...args);};
      try{
        for(const facing of [-1,1])for(const animation of ['walk','idle','light']){
          const frames=art.animations[animation];
          for(let i=0;i<frames.length;i++){
            Object.assign(p,{walk:animation==='walk',age:(i+.1)/9,action:animation==='light'?{kind:'light',t:(i+.1)/frames.length,duration:1}:null,facing});
            seen=null;g.draw();const f=frames[i];results.push({game:name,animation,index:i,facing,seen,rect:[f.x,f.y,f.w,f.h]});
          }
        }
      }finally{ctx.drawImage=draw;}
    }
    return results;
  },id);
  expect(samples.filter(s=>s.animation==='walk')).toHaveLength(['2-tuff-tony','willie-mack'].includes(id)?20:24);
  for(const sample of samples){
    expect(sample.seen,`${sample.game} ${sample.animation}`).not.toBeNull();
    expect(sample.seen.rect).toEqual(sample.rect);
    // Preserve the reviewed run flips and Willie’s existing three mirrored strike frames.
    const mirrored=sample.animation==='walk'&&(!['2-tuff-tony','willie-mack'].includes(id)||sample.index===4)||id==='willie-mack'&&sample.animation==='light'&&sample.index<3;
    expect(Math.sign(sample.seen.scale),JSON.stringify({id,...sample})).toBe(mirrored?-sample.facing:sample.facing);
  }
});
