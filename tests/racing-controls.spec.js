import {test,expect} from '@playwright/test';

let errors;
async function enter(page) {
  await page.goto('/game.html');await page.waitForFunction(()=>window.RACING_READY);
  await page.evaluate(()=>{ARCADE.Sound.on=false;ARCADE.showScreen('racing');});
  await page.waitForFunction(()=>ARCADE.RACING.state.loaded);
}
async function finishSolo(page,brake=false) {
  return page.evaluate(braking=>{
    const g=ARCADE.RACING;let n=0;
    while(g.state.phase!=='finished'&&n++<2000) {
      const s=g.state;g.debug.advance(.1,braking?{steer:0,brake:true,boost:false}:RACING_RULES.aiInput(s,0));
    }
    return g.state;
  },brake);
}
test.beforeEach(async({page})=>{errors=[];page.on('pageerror',e=>errors.push(e.message));await enter(page);});
test.afterEach(()=>expect(errors).toEqual([]));

test('focused start and result buttons retain native Space activation',async({page})=>{
  await page.locator('#rcStartBtn').focus();await page.keyboard.press('Space');
  expect(await page.evaluate(()=>ARCADE.RACING.state.started)).toBe(true);
  const finished=await finishSolo(page);expect(finished.phase).toBe('finished');
  await page.locator('#rcSaveBtn').focus();await page.keyboard.press('Space');await expect(page.locator('#lbModal')).toBeVisible();
  // Racing shortcuts must not replace the modal's keyboard interaction.
  await page.locator('#lbClose').focus();await page.keyboard.press('Space');await expect(page.locator('#lbModal')).toBeHidden();
  await page.locator('#rcAgainBtn').focus();await page.keyboard.press('Space');
  expect(await page.evaluate(()=>ARCADE.RACING.state.mode)).toBe('countdown');
  expect(await page.evaluate(()=>ARCADE.RACING.debug.controls())).toEqual({steer:0,brake:false,boost:false});
});

test('keyboard and pointer holds clear on blur and never leak across arcade navigation',async({page})=>{
  await page.locator('#rcStartBtn').click();
  await page.evaluate(()=>{for(let i=0;i<32;i++)ARCADE.RACING.debug.advance(.1,{steer:0});});
  await page.locator('#rcCanvas').click();await page.keyboard.down('ArrowRight');await page.keyboard.down('Shift');
  await page.evaluate(()=>{const b=document.querySelector('#rcLeftBtn');b.setPointerCapture=()=>{};b.dispatchEvent(new PointerEvent('pointerdown',{pointerId:77,bubbles:true}));});
  expect(await page.evaluate(()=>ARCADE.RACING.debug.controls())).toEqual({steer:0,brake:false,boost:true});
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  expect(await page.evaluate(()=>ARCADE.RACING.debug.controls())).toEqual({steer:0,brake:false,boost:false});
  const positions=await page.evaluate(()=>ARCADE.RACING.state.racers.map(r=>r.z));
  await page.waitForTimeout(150);expect(await page.evaluate(()=>ARCADE.RACING.state.racers.map(r=>r.z))).toEqual(positions);
  await page.keyboard.up('ArrowRight');await page.keyboard.up('Shift');
  await page.locator('#rcResumeBtn').focus();await page.keyboard.press('Space');
  expect(await page.evaluate(()=>ARCADE.RACING.state.mode)).toBe('racing');
  await page.keyboard.down('ArrowLeft');await page.evaluate(()=>{ARCADE.showScreen('menu');ARCADE.showScreen('racing');});
  expect(await page.evaluate(()=>ARCADE.RACING.state.mode)).toBe('paused');
  expect(await page.evaluate(()=>ARCADE.RACING.debug.controls())).toEqual({steer:0,brake:false,boost:false});
  await page.keyboard.up('ArrowLeft');
});

test('a finished solo race records once and lets the player change rides without reloading',async({page})=>{
  const initial=await page.evaluate(()=>({best:ARCADE.RACING.state.best,wins:ARCADE.RACING.state.wins}));
  await page.locator('#rcStartBtn').click();const finished=await finishSolo(page);
  const place=await page.evaluate(()=>RACING_RULES.standings(ARCADE.RACING.state)[0].id);
  expect(finished.wins).toBe(initial.wins+(place===0?1:0));expect(finished.best).toBeGreaterThanOrEqual(initial.best);
  const records={best:finished.best,wins:finished.wins};
  await page.evaluate(()=>{for(let i=0;i<10;i++)ARCADE.RACING.debug.advance(.1,{});ARCADE.showScreen('menu');ARCADE.showScreen('racing');});
  await page.waitForTimeout(200);
  expect(await page.evaluate(()=>({best:ARCADE.RACING.state.best,wins:ARCADE.RACING.state.wins}))).toEqual(records);
  await page.locator('#rcChangeBtn').click();await expect(page.locator('#rcSetup')).toBeVisible();
  await page.locator('[data-racing-racer="big-foot"]').click();await page.locator('#rcStartBtn').click();
  expect(await page.evaluate(()=>ARCADE.RACING.state.racers[0].racerId)).toBe('big-foot');
  expect(await page.evaluate(()=>({best:ARCADE.RACING.state.best,wins:ARCADE.RACING.state.wins}))).toEqual(records);
});

test('offline play with blocked storage reaches an honest time-limit result and can restart',async({page,context})=>{
  await page.addInitScript(()=>{
    Storage.prototype.getItem=function(){throw new DOMException('Storage disabled','SecurityError');};
    Storage.prototype.setItem=function(){throw new DOMException('Storage disabled','SecurityError');};
  });
  await enter(page);await context.setOffline(true);
  await page.locator('#rcStartBtn').click();const finished=await finishSolo(page,true);
  expect(finished.phase).toBe('finished');expect(finished.timedOut).toBe(true);expect(finished.racers[0].dnf).toBe(true);
  expect(finished.wins).toBe(0);await expect(page.locator('#rcResultDetail')).toContainText('TIME LIMIT');
  expect(finished.best).toBeGreaterThan(0);await page.locator('#rcAgainBtn').click();
  expect(await page.evaluate(()=>ARCADE.RACING.state.mode)).toBe('countdown');
  expect(await page.evaluate(()=>ARCADE.RACING.state.racers.every(r=>r.finishTime===null&&!r.dnf))).toBe(true);
});

test('new game records remain local when the arcade is embedded',async({page})=>{
  await page.goto('/');await page.evaluate(()=>{window.hostRecordMessages=[];window.addEventListener('message',e=>{if(e.data?.type==='jcw-arcade'&&['racing','poker'].includes(e.data.g))hostRecordMessages.push(e.data);});});
  const frame=page.frames().find(f=>f.url().endsWith('/game.html'));await frame.waitForFunction(()=>window.RACING_READY);
  await frame.evaluate(()=>{ARCADE.Sound.on=false;ARCADE.LB.check('racing',100,'local racing');ARCADE.LB.check('poker',100,'local poker');});
  await page.waitForTimeout(100);expect(await page.evaluate(()=>hostRecordMessages)).toEqual([]);
  await expect(page.frameLocator('iframe').locator('#lbModal')).toBeVisible();
});
