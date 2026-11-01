import {test,expect} from '@playwright/test';
let errors;
test.beforeEach(async({page})=>{
  errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/game.html');await page.waitForFunction(()=>window.RACING_READY);await page.evaluate(()=>{ARCADE.Sound.on=false;ARCADE.showScreen('racing');});await page.waitForFunction(()=>ARCADE.RACING.state.loaded);
});
test.afterEach(()=>expect(errors).toEqual([]));

test('six complete rides select correctly and start behind a countdown',async({page})=>{
  await expect(page.locator('[data-racing-racer]')).toHaveCount(6);
  expect(await page.locator('[data-racing-racer] img').evaluateAll(imgs=>imgs.every(i=>i.complete&&i.naturalWidth===512))).toBe(true);
  await page.locator('[data-racing-racer="mad-man-pondo"]').click();await page.locator('#rcStartBtn').click();
  const s=await page.evaluate(()=>ARCADE.RACING.state);expect(s.racers[0].racerId).toBe('mad-man-pondo');expect(s.mode).toBe('countdown');expect(s.racers.filter(r=>r.human).every(r=>r.z===0)).toBe(true);expect(s.racers.every(r=>r.speed===0)).toBe(true);
  await expect(page.locator('#rcSetup')).toBeHidden();await page.waitForFunction(()=>ARCADE.RACING.state.phase==='racing');
  await page.keyboard.down('ArrowRight');await page.waitForTimeout(250);await page.keyboard.up('ArrowRight');
  expect(await page.evaluate(()=>ARCADE.RACING.state.racers[0].x)).toBeGreaterThan(s.racers[0].x);
});

test('two simultaneous touch controls release cleanly on cancellation and pause',async({page})=>{
  await page.locator('#rcStartBtn').click();await page.waitForFunction(()=>ARCADE.RACING.state.phase==='racing');
  await expect(page.locator('#rcBoostBtn')).toBeEnabled();await expect(page.locator('#rcLeftBtn')).toBeEnabled();
  const held=await page.evaluate(()=>{const b=document.querySelector('#rcBoostBtn'),l=document.querySelector('#rcLeftBtn');for(const [el,id] of [[b,41],[l,42]]){el.setPointerCapture=()=>{};el.dispatchEvent(new PointerEvent('pointerdown',{pointerId:id,bubbles:true}));}return ARCADE.RACING.debug.controls();});
  expect(held).toEqual({steer:-1,brake:false,boost:true});
  await page.locator('#rcLeftBtn').dispatchEvent('pointercancel',{pointerId:42});expect(await page.evaluate(()=>ARCADE.RACING.debug.controls().steer)).toBe(0);
  await page.evaluate(()=>ARCADE.RACING.pause(true));expect(await page.evaluate(()=>ARCADE.RACING.debug.controls())).toEqual({steer:0,brake:false,boost:false});
});

test('pause, navigation, and hidden tabs preserve the race position',async({page})=>{
  await page.locator('#rcStartBtn').click();await page.waitForFunction(()=>ARCADE.RACING.state.phase==='racing');
  await page.evaluate(()=>ARCADE.RACING.pause(true));const before=await page.evaluate(()=>ARCADE.RACING.state.racers.map(r=>r.z));await page.waitForTimeout(300);
  expect(await page.evaluate(()=>ARCADE.RACING.state.racers.map(r=>r.z))).toEqual(before);await expect(page.locator('#rcPause')).toBeVisible();
  await page.evaluate(()=>{ARCADE.showScreen('menu');ARCADE.showScreen('racing');});await expect(page.locator('#rcPause')).toBeVisible();
  expect(await page.evaluate(()=>ARCADE.RACING.state.racers.map(r=>r.z))).toEqual(before);
  await page.locator('#rcResumeBtn').click();await page.waitForFunction(z=>ARCADE.RACING.state.racers[0].z>z,before[0]);
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));expect(await page.evaluate(()=>ARCADE.RACING.state.mode)).toBe('paused');
});

test('complete solo race reaches results, records once and rematches from a clean grid',async({page})=>{
  await page.locator('#rcStartBtn').click();
  const result=await page.evaluate(()=>{
    const g=ARCADE.RACING;let n=0;
    while(g.state.phase!=='finished'&&n++<12000){const s=g.state;g.debug.advance(1/60,RACING_RULES.aiInput(s,0));}
    return{n,state:g.state};
  });
  expect(result.n).toBeLessThan(12000);expect(result.state.phase).toBe('finished');expect(result.state.racers[0].finishTime).toBeGreaterThan(45);expect(result.state.racers[0].finishTime).toBeLessThan(180);
  await expect(page.locator('#rcResult')).toBeVisible();await expect(page.locator('#rcPlacements li')).toHaveCount(6);await page.locator('#rcSaveBtn').click();
  await page.locator('#lbInitials').fill('JCW');await page.locator('#lbSaveBtn').click();expect(await page.evaluate(()=>ARCADE.LB.board('racing').length)).toBe(1);await page.locator('#lbClose').click();
  await page.locator('#rcAgainBtn').click();const s=await page.evaluate(()=>ARCADE.RACING.state);expect(s.phase).toBe('countdown');expect(s.racers.filter(r=>r.human).every(r=>r.z===0)).toBe(true);expect(s.racers.every(r=>r.speed===0&&r.tickets===0&&r.finishTime===null)).toBe(true);
});

test('bad local records normalize to finite nonnegative values',async({page})=>{
  await page.evaluate(()=>{localStorage.setItem('pa_racing_best',JSON.stringify('Infinity'));localStorage.setItem('pa_racing_wins',JSON.stringify(-5));});await page.reload();await page.waitForFunction(()=>window.RACING_READY);
  expect(await page.evaluate(()=>[ARCADE.RACING.state.best,ARCADE.RACING.state.wins])).toEqual([0,0]);
});

test('race meters follow the rider and pickups produce visible feedback',async({page})=>{
  await page.locator('#rcStartBtn').click();
  const result=await page.evaluate(()=>{const g=ARCADE.RACING;let pickup=null;
    for(let i=0;i<1800&&!pickup;i++){const s=g.state;g.debug.advance(1/60,RACING_RULES.aiInput(s,0));pickup=g.state.events.find(e=>e.racer===0&&e.type==='pickup');}
    return{pickup,state:g.state};
  });
  expect(result.pickup).not.toBeNull();await expect(page.locator('#rcFeedback')).toBeVisible();
  await expect(page.locator('#rcFeedback')).toContainText(/TICKET|BOOST REFILLED|REPAIRED|ALREADY FULL|ALREADY HEALTHY/);
  const readings=await page.evaluate(()=>{const s=ARCADE.RACING.state,p=s.racers[0];return{boost:+document.querySelector('#rcBoostMeter').value,health:+document.querySelector('#rcHealthMeter').value,progress:+document.querySelector('#rcProgress').value,expected:[p.boost,p.health,p.z/s.length*100]};});
  expect(Math.abs(readings.boost-readings.expected[0])).toBeLessThan(3);expect(Math.abs(readings.health-readings.expected[1])).toBeLessThan(1);expect(Math.abs(readings.progress-readings.expected[2])).toBeLessThan(2);
  await expect(page.locator('#rcLegLabel')).toHaveText('STOP 1 OF 3');
});

for(const [width,height] of [[390,740],[320,568],[844,390],[568,320],[1280,800]]){
  test(`race and touch controls fit together at ${width}x${height}`,async({page})=>{
    await page.setViewportSize({width,height});await page.locator('#rcStartBtn').click();await page.waitForTimeout(150);
    const result=await page.evaluate(()=>{const ids=['rcCanvas','rcLeftBtn','rcRightBtn','rcBrakeBtn','rcBoostBtn','rcPauseBtn','rcHomeBtn'];return{overflow:document.documentElement.scrollWidth>innerWidth+1,rects:ids.map(id=>{const r=document.getElementById(id).getBoundingClientRect();return{id,x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};})};});
    expect(result.overflow).toBe(false);for(const r of result.rects){expect(r.x,r.id).toBeGreaterThanOrEqual(-1);expect(r.y,r.id).toBeGreaterThanOrEqual(-1);expect(r.right,r.id).toBeLessThanOrEqual(width+1);expect(r.bottom,r.id).toBeLessThanOrEqual(height+1);expect(r.h,r.id).toBeGreaterThan(r.id==='rcCanvas'?120:30);}
    const a=result.rects.find(r=>r.id==='rcCanvas');for(const r of result.rects.filter(r=>r.id!=='rcCanvas'))expect(a.y+a.h<=r.y+1||a.x+a.w<=r.x+1||r.x+r.w<=a.x+1,r.id+' does not cover race').toBe(true);
  });
}
