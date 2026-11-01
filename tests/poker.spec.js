import {test,expect} from '@playwright/test';
let errors;
test.beforeEach(async({page})=>{
  errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{let seed=731;crypto.getRandomValues=values=>{for(let i=0;i<values.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;values[i]=seed;}return values;};});
  await page.goto('/game.html');await page.waitForFunction(()=>window.POKER_READY);await page.evaluate(()=>{ARCADE.Sound.on=false;ARCADE.showScreen('poker');});
});
test.afterEach(()=>expect(errors).toEqual([]));

test('CPU deal exposes only your cards, conserves chips, and protects its state getter',async({page})=>{
  await page.locator('#pkStartBtn').click();await expect(page.locator('#pkSetup')).toBeHidden();
  await expect(page.locator('#pkPlayerCards .pk-card:not(.pk-back)')).toHaveCount(2);await expect(page.locator('#pkOppCards .pk-back')).toHaveCount(2);
  const result=await page.evaluate(()=>{const g=ARCADE.POKER,s=g.state,keys=[];const visit=o=>{if(o&&typeof o==='object')for(const [k,v]of Object.entries(o)){keys.push(k);visit(v);}};visit(s);s.players[0].stack=999999;s.players[1].hand=[1,2];return{state:g.state,privateKeys:keys.filter(k=>['deck','deckIndex','burned','rng','seed','pending'].includes(k))};});
  expect(result.privateKeys).toEqual([]);expect(result.state.players[1].hand).toEqual([null,null]);expect(result.state.players[0].stack).toBe(990);expect(result.state.pot).toBe(30);expect(result.state.turn).toBe(0);
  await expect(page.locator('#pkCallBtn')).toHaveText('CALL 10');await expect(page.locator('#pkRaiseBtn')).toHaveText('RAISE TO 40');
});

test('fold keeps opponent cards private and the next button changes the dealer',async({page})=>{
  await page.locator('#pkStartBtn').click();await page.locator('#pkFoldBtn').click();await expect(page.locator('#pkResult')).toBeVisible();
  expect(await page.evaluate(()=>ARCADE.POKER.state.result.kind)).toBe('fold');await expect(page.locator('#pkOppCards .pk-back')).toHaveCount(2);
  await page.locator('#pkNextBtn').click();await page.evaluate(()=>ARCADE.POKER.pause(true));
  const s=await page.evaluate(()=>ARCADE.POKER.state);expect(s.handNo).toBe(2);expect(s.dealer).toBe(1);expect(s.players.reduce((sum,p)=>sum+p.stack,0)+s.pot).toBe(2000);
});

test('raise control means total street bet and rejects illegal moves',async({page})=>{
  await page.locator('#pkStartBtn').click();await page.locator('#pkRaiseAmount').evaluate(el=>{el.value='120';el.dispatchEvent(new Event('input',{bubbles:true}));});await expect(page.locator('#pkRaiseBtn')).toHaveText('RAISE TO 120');
  const illegal=await page.evaluate(()=>{const g=ARCADE.POKER,before=g.state.revision;return{check:g.act({type:'check'}),raise:g.act({type:'raise',amount:21}),before,after:g.state.revision};});
  expect(illegal.check).toBe(false);expect(illegal.raise).toBe(false);expect(illegal.after).toBe(illegal.before);
  await page.locator('#pkRaiseBtn').click();await page.evaluate(()=>ARCADE.POKER.pause(true));
  const s=await page.evaluate(()=>ARCADE.POKER.state);expect(s.players[0].bet).toBe(120);expect(s.players[0].stack).toBe(880);expect(s.pot+s.players.reduce((n,p)=>n+p.stack,0)).toBe(2000);
});

test('pause and navigation cancel CPU work without losing the current hand',async({page})=>{
  await page.locator('#pkStartBtn').click();await page.evaluate(()=>{ARCADE.POKER.act({type:'call'});ARCADE.POKER.pause(true);});const revision=await page.evaluate(()=>ARCADE.POKER.state.revision);
  await page.waitForTimeout(750);expect(await page.evaluate(()=>ARCADE.POKER.state.revision)).toBe(revision);await expect(page.locator('#pkPause')).toBeVisible();
  await page.locator('#pkResumeBtn').click();await page.waitForFunction(revision=>ARCADE.POKER.state.revision>revision,revision);
  await page.evaluate(()=>{ARCADE.showScreen('menu');});const saved=await page.evaluate(()=>ARCADE.POKER.state);await page.waitForTimeout(750);
  expect(await page.evaluate(()=>ARCADE.POKER.state.revision)).toBe(saved.revision);await page.evaluate(()=>ARCADE.showScreen('poker'));await expect(page.locator('#pkPause')).toBeVisible();
});

test('a full CPU match reaches a real winner and records only human victories',async({page})=>{
  test.setTimeout(45000);await page.locator('#pkStartBtn').click();
  const outcome=await page.evaluate(()=>{
    const g=ARCADE.POKER;let actions=0;
    for(;actions<600&&g.state.matchWinner===null;actions++){
      const s=g.state;if(s.stage==='over'){g.next();continue;}if(s.turn===1){g.debug.cpuNow();continue;}
      const legal=POKER_RULES.legal(s,0);g.act({type:legal.canAllIn?'allin':legal.canCall?'call':'check'});
    }
    return{actions,state:g.state};
  });
  expect(outcome.actions).toBeLessThan(600);expect([0,1]).toContain(outcome.state.matchWinner);expect(outcome.state.players.map(p=>p.stack).sort((a,b)=>a-b)).toEqual([0,2000]);
  await expect(page.locator('#pkResult')).toBeVisible();
  if(outcome.state.matchWinner===0){await expect(page.locator('#pkSaveBtn')).toBeVisible();await page.locator('#pkSaveBtn').click();await page.locator('#lbInitials').fill('BMR');await page.locator('#lbSaveBtn').click();expect(await page.evaluate(()=>ARCADE.LB.board('poker').length)).toBe(1);}
  else{await expect(page.locator('#pkSaveBtn')).toBeHidden();expect(outcome.state.wins).toBe(0);}
});

test('a dropped online table stays closed until an explicit fresh game',async({page})=>{
  await page.evaluate(()=>{const g=ARCADE.POKER;g.netStart('join');g.netEnd('Connection lost.');});
  await expect(page.locator('#pkResultTitle')).toHaveText('TABLE CLOSED');await expect(page.locator('#pkResultDetail')).toContainText('No win or record');
  expect(await page.evaluate(()=>({mode:ARCADE.POKER.state.mode,playMode:ARCADE.POKER.state.playMode,winner:ARCADE.POKER.state.matchWinner}))).toEqual({mode:'disconnected',playMode:'online',winner:null});
  await page.locator('#pkAgainBtn').click();expect(await page.evaluate(()=>ARCADE.POKER.state.playMode)).toBe('cpu');await expect(page.locator('#pkResult')).toBeHidden();
});

test('corrupt local record values normalize to finite whole numbers',async({page})=>{
  await page.evaluate(()=>{localStorage.setItem('pa_poker_best',JSON.stringify('Infinity'));localStorage.setItem('pa_poker_wins',JSON.stringify(2.5));});
  await page.reload();await page.waitForFunction(()=>window.POKER_READY);expect(await page.evaluate(()=>({best:ARCADE.POKER.state.best,wins:ARCADE.POKER.state.wins}))).toEqual({best:0,wins:0});
});
