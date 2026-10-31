import {test,expect} from '@playwright/test';

let errors;
test.beforeEach(async({page})=>{
  errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/game.html');await page.waitForFunction(()=>window.ARCADE?.POOL);
  await page.evaluate(()=>{ARCADE.Sound.on=false;});await page.locator('#cardPool').click();
});
test.afterEach(()=>expect(errors).toEqual([]));

async function start(page,mode='local'){
  await page.locator('#plMode').selectOption(mode);await page.locator('#plStartBtn').click();
  await expect(page.locator('#plSetup')).toBeHidden();
  expect(await page.evaluate(()=>ARCADE.POOL.state.mode)).toBe('aiming');
}
// Arrange a readable late-rack position; shots, collisions, rules and results
// still run through the production controller and physical table simulation.
async function table(page,{balls=[[0,500,360],[1,500,240],[8,800,350],[9,850,250]],turn=0,groups=['solids','stripes'],ballInHand=false}={}){
  await page.evaluate(({balls,turn,groups,ballInHand})=>{
    const g=ARCADE.POOL,s=g.state;g.debug.stop();
    for(const b of s.balls){const p=balls.find(v=>v[0]===b.id);Object.assign(b,{pocketed:!p,vx:0,vy:0,...(p?{x:p[1],y:p[2]}:{})});}
    Object.assign(s,{mode:'aiming',turn,groups,break:false,ballInHand,calledPocket:null,winner:null,shot:null,notice:'Test rack ready.',resultSaved:false,saved:false});
    Object.assign(g.aim,{angle:-Math.PI/2,power:.18,called:null,placement:ballInHand?{x:285,y:300,valid:g.physics.validPlacement(s.balls,285,300)}:null});
    g.pause(true);g.pause(false);g.draw();
  },{balls,turn,groups,ballInHand});
}
async function clickTable(page,x,y){const p=await page.evaluate(({x,y})=>ARCADE.POOL.debug.project(x,y),{x,y});await page.mouse.click(p.x,p.y);}
async function power(page,value){await page.locator('#plPower').evaluate((el,value)=>{el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));},value);}
async function settle(page){
  return page.evaluate(()=>{
    const g=ARCADE.POOL;g.debug.stop();for(let i=0;i<700&&g.state.mode==='rolling';i++)g.step(.05);
    return {mode:g.state.mode,turn:g.state.turn,balls:g.state.balls.map(b=>({...b})),scores:g.state.scores.slice(),stats:JSON.parse(JSON.stringify(g.state.stats)),winner:g.state.winner,ballInHand:g.state.ballInHand};
  });
}
async function humanMiss(page){await table(page,{balls:[[0,500,360],[1,800,350],[8,800,410],[9,500,240]]});await page.evaluate(()=>ARCADE.POOL.shoot({angle:Math.PI,power:.05}));return settle(page);}

test('real table aiming, fine controls and a physical pot keep the local player shooting',async({page})=>{
  await start(page);await table(page);await clickTable(page,500,160);
  const before=await page.evaluate(()=>ARCADE.POOL.aim.angle);
  await page.locator('#plAimRight').click();expect(await page.evaluate(()=>ARCADE.POOL.aim.angle)).toBeGreaterThan(before);
  await page.locator('#plAimLeft').click();await page.locator('#plCanvas').focus();
  await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('Shift+ArrowLeft');
  expect(await page.evaluate(()=>ARCADE.POOL.aim.angle)).toBeCloseTo(before,10);
  await power(page,18);await page.locator('#plShootBtn').click();
  expect(await page.evaluate(()=>ARCADE.POOL.state.mode)).toBe('rolling');
  const s=await settle(page);expect(s.mode).toBe('aiming');expect(s.turn).toBe(0);expect(s.scores[0]).toBe(100);expect(s.stats[0].pots).toBe(1);
  expect(s.balls.find(b=>b.id===1).pocketed).toBe(true);await expect(page.locator('#plPocketCall')).toBeVisible();
});

test('the CPU takes its own legal shot after a human foul',async({page})=>{
  await start(page,'cpu');const miss=await humanMiss(page);expect(miss.turn).toBe(1);expect(miss.ballInHand).toBe(true);expect(miss.stats[0].fouls).toBe(1);
  await page.waitForFunction(()=>ARCADE.POOL.state.turn===1&&ARCADE.POOL.state.mode==='rolling');
  const s=await settle(page);expect(s.stats[1].shots).toBe(1);expect(s.stats[1].pots).toBeGreaterThan(0);expect(s.ballInHand).toBe(false);
  expect(s.balls.find(b=>b.id===9).pocketed).toBe(true);expect(s.scores[1]).toBeGreaterThan(0);
});

test('pause freezes a moving shot and resume preserves its eventual result',async({page})=>{
  await start(page);await table(page);await page.locator('#plShootBtn').click();
  await page.locator('#plPauseBtn').click();await expect(page.locator('#plPause')).toBeVisible();
  const frozen=await page.evaluate(()=>JSON.stringify({balls:ARCADE.POOL.state.balls,elapsed:ARCADE.POOL.state.elapsed,shot:ARCADE.POOL.state.shot}));
  await page.waitForTimeout(180);expect(await page.evaluate(()=>JSON.stringify({balls:ARCADE.POOL.state.balls,elapsed:ARCADE.POOL.state.elapsed,shot:ARCADE.POOL.state.shot}))).toBe(frozen);
  await page.locator('#plResumeBtn').click();const s=await settle(page);expect(s.stats[0].shots).toBe(1);expect(s.stats[0].pots).toBe(1);
});

test('leaving the arcade cancels a pending CPU turn until the paused rack is resumed',async({page})=>{
  await start(page,'cpu');await humanMiss(page);await page.locator('#plHomeBtn').click();
  await expect(page.locator('#menuScreen')).toBeVisible();expect(await page.evaluate(()=>ARCADE.POOL.state.mode)).toBe('paused');
  const frozen=await page.evaluate(()=>JSON.stringify(ARCADE.POOL.state.balls));await page.waitForTimeout(800);
  expect(await page.evaluate(()=>JSON.stringify(ARCADE.POOL.state.balls))).toBe(frozen);expect(await page.evaluate(()=>ARCADE.POOL.state.stats[1].shots)).toBe(0);
  await page.locator('#cardPool').click();await expect(page.locator('#plPause')).toBeVisible();
  await page.locator('#plResumeBtn').click();await page.waitForFunction(()=>ARCADE.POOL.state.mode==='rolling'&&ARCADE.POOL.state.turn===1);
  expect((await settle(page)).stats[1].shots).toBe(1);
});

test('choosing a practice rack invalidates the previous pending CPU action',async({page})=>{
  await start(page,'cpu');await humanMiss(page);await page.locator('#plPauseBtn').click();await page.locator('#plChooseBtn').click();
  await start(page,'practice');const fresh=await page.evaluate(()=>JSON.stringify(ARCADE.POOL.state.balls));await page.waitForTimeout(800);
  expect(await page.evaluate(()=>({mode:ARCADE.POOL.state.mode,playMode:ARCADE.POOL.state.playMode,shots:ARCADE.POOL.state.stats.map(s=>s.shots)}))).toEqual({mode:'aiming',playMode:'practice',shots:[0,0]});
  expect(await page.evaluate(()=>JSON.stringify(ARCADE.POOL.state.balls))).toBe(fresh);
});

test('ball in hand rejects overlap and supports pointer placement plus keyboard adjustment',async({page})=>{
  await start(page);await table(page,{ballInHand:true});
  await clickTable(page,500,240);await expect(page.locator('#plPlaceBtn')).toBeDisabled();
  expect(await page.evaluate(()=>ARCADE.POOL.state.ballInHand)).toBe(true);
  await clickTable(page,350,350);await expect(page.locator('#plPlaceBtn')).toBeEnabled();
  const before=await page.evaluate(()=>ARCADE.POOL.aim.placement.x);await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(()=>ARCADE.POOL.aim.placement.x)).toBeGreaterThan(before);await page.keyboard.press('Enter');
  expect(await page.evaluate(()=>ARCADE.POOL.state.ballInHand)).toBe(false);await expect(page.locator('#plPlaceBtn')).toBeHidden();
  expect(await page.evaluate(()=>{const g=ARCADE.POOL,c=g.state.balls.find(b=>b.id===0);return g.physics.validPlacement(g.state.balls,c.x,c.y);})).toBe(true);
});

test('the called eight completes a CPU win and saves exactly one persistent local record',async({page})=>{
  await start(page,'cpu');await table(page,{balls:[[0,500,360],[8,500,240],[9,850,250]]});
  await expect(page.locator('#plShootBtn')).toBeDisabled();await page.locator('[data-pl-pocket="1"]').click();
  await expect(page.locator('[data-pl-pocket="1"]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#plShootBtn')).toBeEnabled();
  await clickTable(page,500,160);await page.keyboard.press('Space');const s=await settle(page);
  expect(s.mode).toBe('over');expect(s.winner).toBe(0);expect(s.scores[0]).toBe(1000);
  await expect(page.locator('#plResultTitle')).toHaveText('YOU OWN THE TABLE');await expect(page.locator('#plSaveBtn')).toBeVisible();
  await page.locator('#plSaveBtn').click();await page.locator('#lbInitials').fill('WHO');await page.locator('#lbSaveBtn').click();await page.locator('#lbClose').click();
  await expect(page.locator('#plSaveBtn')).toBeDisabled();expect(await page.evaluate(()=>ARCADE.LB.board('pool').map(e=>({name:e.name,v:e.v})))).toEqual([{name:'WHO',v:1000}]);
  await page.reload();await page.waitForFunction(()=>window.ARCADE?.POOL);
  expect(await page.evaluate(()=>({wins:ARCADE.POOL.state.wins,best:ARCADE.POOL.state.best,records:ARCADE.LB.board('pool').length}))).toEqual({wins:1,best:1000,records:1});
});

for(const failure of ['early eight','wrong called pocket'])test(`${failure} gives the opponent the rack without a CPU record`,async({page})=>{
  await start(page,'cpu');await table(page,{balls:[[0,500,360],[8,500,240],[9,850,250],...(failure==='early eight'?[[1,750,400]]:[])]});
  if(failure==='wrong called pocket')await page.locator('[data-pl-pocket="0"]').click();
  await page.locator('#plShootBtn').click();const s=await settle(page);
  expect(s.mode).toBe('over');expect(s.winner).toBe(1);await expect(page.locator('#plSaveBtn')).toBeHidden();
  await expect(page.locator('#plResultDetail')).toContainText(failure==='early eight'?'TOO EARLY':'WRONG POCKET');
  expect(await page.evaluate(()=>({wins:ARCADE.POOL.state.wins,records:ARCADE.LB.board('pool').length}))).toEqual({wins:0,records:0});
});

for(const mode of ['local','practice'])test(`${mode} completes a real rack without entering CPU records`,async({page})=>{
  await start(page,mode);await table(page,{balls:[[0,500,360],[8,500,240],...(mode==='local'?[[9,850,250]]:[])]});
  if(mode==='local')await page.locator('[data-pl-pocket="1"]').click();
  else{
    await page.evaluate(()=>{ARCADE.POOL.aim.angle=0;});await clickTable(page,500,85);
    // WebKit quantizes native pointer coordinates to CSS pixels; the aim should
    // still point at the pocket, within one degree, rather than consuming a call.
    expect(Math.abs(await page.evaluate(()=>ARCADE.POOL.aim.angle)+Math.PI/2)).toBeLessThan(Math.PI/180);
    await expect(page.locator('#plPocketCall')).toBeHidden();
  }
  await page.locator('#plShootBtn').click();const s=await settle(page);expect(s.mode).toBe('over');expect(s.winner).toBe(mode==='practice'?null:0);
  await expect(page.locator('#plSaveBtn')).toBeHidden();expect(await page.evaluate(()=>({wins:ARCADE.POOL.state.wins,records:ARCADE.LB.board('pool').length}))).toEqual({wins:0,records:0});
  await page.locator('#plAgainBtn').click();expect(await page.evaluate(()=>({mode:ARCADE.POOL.state.mode,playMode:ARCADE.POOL.state.playMode,potted:ARCADE.POOL.state.balls.filter(b=>b.pocketed).length,scores:ARCADE.POOL.state.scores}))).toEqual({mode:'aiming',playMode:mode,potted:0,scores:[0,0]});
});

test('embedded table remains playable offline with browser storage unavailable',async({page,context})=>{
  await page.addInitScript(()=>{for(const key of ['getItem','setItem','removeItem'])Storage.prototype[key]=()=>{throw new Error('Storage blocked for test');};});
  await page.reload();await page.waitForFunction(()=>window.ARCADE?.POOL);await page.evaluate(()=>{ARCADE.Sound.on=false;});await page.locator('#cardPool').click();
  await context.setOffline(true);await start(page,'practice');await table(page);await page.locator('#plShootBtn').click();
  const s=await settle(page);expect(s.balls.find(b=>b.id===1).pocketed).toBe(true);expect(s.scores[0]).toBe(100);
  await page.locator('#plGuide').uncheck();await page.locator('#plPauseBtn').click();await expect(page.locator('#plPause')).toBeVisible();
});
