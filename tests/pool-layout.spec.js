import {test,expect} from '@playwright/test';

test.use({isMobile:true,hasTouch:true,deviceScaleFactor:3});

async function open(page,embedded=false){
  let surface=page;
  if(embedded){
    // Match the fixed blob iframe used by the production mobile loader.
    await page.route('**/pool-phone-host',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>html,body{margin:0;height:100%;overflow:hidden}iframe{position:fixed;inset:0;width:100%;height:100dvh;border:0}</style><iframe title="Arcade"></iframe><script>fetch('/game.html').then(r=>r.text()).then(html=>document.querySelector('iframe').src=URL.createObjectURL(new Blob([html],{type:'text/html'})))</script>`}));
    const loaded=page.waitForEvent('framenavigated',{predicate:f=>f.url().startsWith('blob:')});
    await page.goto('/pool-phone-host');surface=await loaded;
  }else await page.goto('/game.html');
  await surface.waitForFunction(()=>window.ARCADE?.POOL);
  await surface.evaluate(()=>{ARCADE.Sound.on=false;ARCADE.showScreen('pool');});
  await surface.locator('#plMode').selectOption('local');
  // Arriving from instructions must not leave an active rack scrolled off screen.
  await surface.locator('#plInstructions').scrollIntoViewIfNeeded();
  await surface.locator('#plStartBtn').click();
  await expect(surface.locator('#plSetup')).toBeHidden();
  return surface;
}
async function inView(surface,width,height){
  const ids=['plCanvas','plPower','plShootBtn','plAimLeft','plAimRight','plGuide','plPauseBtn','plNewBtn','plNetBtn','plHomeBtn'];
  if(await surface.locator('#plPocketCall').isVisible())ids.push('plPocketButtons');
  // Check the actual clickable centers, not visibility alone: hidden overflow
  // and overlapping controls can both leave Playwright's visible flag true.
  const boxes=await surface.evaluate(ids=>ids.map(id=>{
    const e=document.getElementById(id),r=e.getBoundingClientRect();
    const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    return{id,x:r.x,y:r.y,width:r.width,height:r.height,hittable:hit===e||e.contains(hit)};
  }),ids);
  for(const b of boxes){
    expect(b.width,b.id).toBeGreaterThan(0);expect(b.height,b.id).toBeGreaterThan(0);
    expect(b.x,b.id).toBeGreaterThanOrEqual(0);expect(b.y,b.id).toBeGreaterThanOrEqual(0);
    expect(b.x+b.width,b.id).toBeLessThanOrEqual(width+1);expect(b.y+b.height,b.id).toBeLessThanOrEqual(height+1);
    expect(b.hittable,b.id).toBe(true);
  }
  const table=boxes.find(b=>b.id==='plCanvas'),shoot=boxes.find(b=>b.id==='plShootBtn');
  expect(table.height,'non-collapsed playing surface').toBeGreaterThanOrEqual(240);
  expect(shoot.x>=table.x+table.width-1||shoot.y>=table.y+table.height-1,'shoot control is outside the table').toBe(true);
  const world=await surface.evaluate(()=>{const g=ARCADE.POOL;return{a:g.debug.project(70,85),b:g.debug.project(930,515)}});
  expect(Math.min(Math.abs(world.a.x-world.b.x),Math.abs(world.a.y-world.b.y)),'painted cloth remains usable').toBeGreaterThan(120);
  expect(await surface.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
}
async function tapAim(page,surface){
  const target=await surface.evaluate(()=>{const g=ARCADE.POOL,c=g.state.balls.find(b=>b.id===0),p=g.debug.project(600,350);return{...p,expected:Math.atan2(350-c.y,600-c.x),inverse:g.debug.point(p.x,p.y)}});
  expect(target.inverse.x).toBeCloseTo(600,6);expect(target.inverse.y).toBeCloseTo(350,6);
  await page.touchscreen.tap(target.x,target.y);
  expect(await surface.evaluate(()=>ARCADE.POOL.aim.angle)).toBeCloseTo(target.expected,1);
  const before=await surface.evaluate(()=>ARCADE.POOL.aim.angle);
  await surface.locator('#plAimRight').tap();
  expect(await surface.evaluate(()=>ARCADE.POOL.aim.angle)).toBeGreaterThan(before);
}
async function eight(surface){
  await surface.evaluate(()=>{const g=ARCADE.POOL;g.state.break=false;g.state.groups=['solids','stripes'];g.state.balls.forEach(b=>{if(b.id>=1&&b.id<=7)b.pocketed=true});g.aim.called=null;g.pause(true);g.pause(false);});
  await expect(surface.locator('#plPocketCall')).toBeVisible();
  await expect(surface.locator('#plShootBtn')).toBeDisabled();
}
async function overlays(surface){
  await surface.locator('#plPauseBtn').tap();await expect(surface.locator('#plPause')).toBeVisible();
  await surface.locator('#plResumeBtn').tap();await expect(surface.locator('#plPause')).toBeHidden();
  await surface.evaluate(()=>{const g=ARCADE.POOL;Object.assign(g.state,{mode:'over',winner:0,resultSaved:false,notice:'Player one pockets the called eight. The rack is complete.'});g.debug.complete();});
  await expect(surface.locator('#plOver')).toBeVisible();
  await surface.locator('#plAgainBtn').tap();
  await expect(surface.locator('#plOver')).toBeHidden();
  expect(await surface.evaluate(()=>ARCADE.POOL.state.mode)).toBe('aiming');
}

for(const [width,height]of[[320,568],[390,664],[844,390],[667,375]]){
  for(const embedded of[false,true])test(`${embedded?'embedded':'standalone'} pool keeps the table and all actions reachable at ${width}×${height}`,async({page})=>{
    await page.setViewportSize({width,height});const surface=await open(page,embedded);
    await inView(surface,width,height);await tapAim(page,surface);await eight(surface);await inView(surface,width,height);
    // Every pocket can be called from its visible button; no neighboring control steals the tap.
    for(let i=0;i<6;i++){await surface.locator(`[data-pl-pocket="${i}"]`).tap();expect(await surface.evaluate(()=>ARCADE.POOL.aim.called)).toBe(i);}
    await expect(surface.locator('#plShootBtn')).toBeEnabled();
    await overlays(surface);await inView(surface,width,height);
    await surface.locator('#plHomeBtn').tap();await expect(surface.locator('#menuScreen')).toBeVisible();
    expect(await surface.evaluate(()=>document.body.classList.contains('pool-selected'))).toBe(false);
  });
}
test('embedded pool preserves aim mapping and reachable controls through phone rotation and browser-chrome resizing',async({page})=>{
  await page.setViewportSize({width:390,height:664});const surface=await open(page,true);
  for(const [width,height]of[[844,390],[667,375],[320,568],[390,664]]){
    await page.setViewportSize({width,height});
    // ResizeObserver and orientation events run on the following rendering frame.
    await surface.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await inView(surface,width,height);await tapAim(page,surface);
  }
  await eight(surface);await page.setViewportSize({width:844,height:390});
  await surface.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await inView(surface,844,390);await surface.locator('[data-pl-pocket="3"]').tap();
  expect(await surface.evaluate(()=>ARCADE.POOL.aim.called)).toBe(3);
});

test.describe('desktop table',()=>{
  test.use({isMobile:false,hasTouch:false,deviceScaleFactor:1});
  for(const [width,height]of[[1440,1000],[1280,720]])test(`setup and active rack fit the desktop at ${width}×${height}`,async({page})=>{
    await page.setViewportSize({width,height});await page.goto('/game.html');await page.waitForFunction(()=>window.ARCADE?.POOL);
    await page.evaluate(()=>{ARCADE.Sound.on=false;ARCADE.showScreen('pool');});
    const setup=await page.locator('#plStartBtn').boundingBox();expect(setup.y+setup.height).toBeLessThan(height);
    await page.locator('#plMode').selectOption('local');await page.locator('#plStartBtn').click();
    const stage=await page.locator('#plStage').boundingBox();expect(stage.width).toBeGreaterThan(750);
    if(height<850){await inView(page,width,height);await eight(page);await inView(page,width,height);}
    const blank=await page.evaluate(()=>document.querySelector('.pl-machine').getBoundingClientRect().bottom-document.querySelector('.pl-footer').getBoundingClientRect().bottom);
    expect(blank,'machine does not stretch to the sidebar height').toBeLessThan(3);
    await page.locator('#plPauseBtn').click();await page.locator('#plResumeBtn').click();
    expect(await page.evaluate(()=>ARCADE.POOL.state.mode)).toBe('aiming');
  });
});
