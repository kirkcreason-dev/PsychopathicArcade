import{test,expect}from'@playwright/test';

test.use({isMobile:true,hasTouch:true,deviceScaleFactor:3});

async function open(page,embedded=false){
  let surface=page;
  if(embedded){
    await page.route('**/poker-phone-host',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>html,body{margin:0;height:100%;overflow:hidden}iframe{position:fixed;inset:0;width:100%;height:100dvh;border:0}</style><iframe title="Arcade"></iframe><script>fetch('/game.html').then(r=>r.text()).then(html=>document.querySelector('iframe').src=URL.createObjectURL(new Blob([html],{type:'text/html'})))</script>`}));
    const loaded=page.waitForEvent('framenavigated',{predicate:f=>f.url().startsWith('blob:')});await page.goto('/poker-phone-host');surface=await loaded;
  }else await page.goto('/game.html');
  await surface.waitForFunction(()=>window.ARCADE?.POKER);
  await surface.evaluate(()=>{ARCADE.Sound.on=false;ARCADE.showScreen('poker');});
  return surface;
}
async function visibleTargets(surface,selectors,width,height){
  const targets=await surface.evaluate(selectors=>selectors.flatMap(selector=>Array.from(document.querySelectorAll(selector),el=>{
    const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    return{selector,label:el.getAttribute('aria-label')||el.id,x:r.x,y:r.y,width:r.width,height:r.height,hittable:hit===el||el.contains(hit)};
  })),selectors);
  for(const t of targets){
    expect(t.width,t.label).toBeGreaterThan(0);expect(t.height,t.label).toBeGreaterThan(0);
    expect(t.x,t.label).toBeGreaterThanOrEqual(0);expect(t.y,t.label).toBeGreaterThanOrEqual(0);
    expect(t.x+t.width,t.label).toBeLessThanOrEqual(width+1);expect(t.y+t.height,t.label).toBeLessThanOrEqual(height+1);
    expect(t.hittable,t.label).toBe(true);
  }
  return targets;
}
async function inView(surface,width,height){
  const targets=await visibleTargets(surface,['#pkBoard .pk-card','#pkPlayerCards .pk-card','#pkOppCards .pk-card','#pkFoldBtn','#pkCallBtn','#pkRaiseBtn','#pkAllInBtn','#pkMinBtn','#pkHalfPotBtn','#pkPotBtn','#pkAllInPreset','#pkRaiseAmount','#pkPauseBtn','#pkNetBtn','#pkHomeBtn'],width,height);
  for(const id of['pkFoldBtn','pkCallBtn','pkRaiseBtn','pkAllInBtn'])expect(targets.find(t=>t.label===id).height,'safe primary touch target').toBeGreaterThanOrEqual(44);
  for(const id of['pkMinBtn','pkHalfPotBtn','pkPotBtn','pkAllInPreset'])expect(targets.find(t=>t.label===id).height,'reachable preset touch target').toBeGreaterThanOrEqual(width<=900?32:28);
  await expect(surface.locator('#pkBoard .pk-card')).toHaveCount(5);
  const regions=await surface.evaluate(()=>['pkBoard','pkPlayerCards','pkOppCards'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return{id,top:r.top,bottom:r.bottom,left:r.left,right:r.right}}));
  const [board,player,opponent]=regions;expect(board.top,'board below opponent cards').toBeGreaterThanOrEqual(opponent.bottom-1);expect(player.top,'private cards below board').toBeGreaterThanOrEqual(board.bottom-1);
  expect(await surface.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
}
async function connectionBar(surface){
  await surface.evaluate(()=>{document.getElementById('netPill').hidden=false;document.getElementById('netPillTxt').textContent='ONLINE — BIG MONEY RUSTLAS POKER — YOU ARE PLAYER TWO';});
}
async function playToShowdown(surface){
  const result=await surface.evaluate(()=>{
    const g=ARCADE.POKER;let moves=0;
    // Play a real CPU hand without folding. The deck, AI, betting and showdown
    // are production paths; no card or result values are patched into the UI.
    while(g.state.stage!=='over'&&moves++<40){
      if(g.state.turn===0){const legal=POKER_RULES.legal(g.state,0);g.act({type:legal.canCheck?'check':'call'});}
      else g.debug.cpuNow();
    }
    return{kind:g.state.result?.kind,stage:g.state.stage,cards:g.state.board.length};
  });
  expect(result).toEqual({kind:'showdown',stage:'over',cards:5});
}

for(const[width,height]of[[320,568],[390,664],[667,375],[844,390]]){
  for(const embedded of[false,true])test(`${embedded?'embedded':'standalone'} saloon setup and controls fit ${width}×${height}`,async({page})=>{
    await page.setViewportSize({width,height});const surface=await open(page,embedded);
    await visibleTargets(surface,['#pkStartBtn','#pkNetBtn','#pkHomeBtn'],width,height);
    await surface.locator('#pkStartBtn').tap();await expect(surface.locator('#pkSetup')).toBeHidden();await inView(surface,width,height);
    await connectionBar(surface);await inView(surface,width,height);await visibleTargets(surface,['#netPill','#netHangup'],width,height);
    await surface.locator('#pkPotBtn').tap();const potRaise=Number((await surface.locator('#pkRaiseValue').textContent()).replaceAll(',',''));
    await surface.locator('#pkMinBtn').tap();expect(Number((await surface.locator('#pkRaiseValue').textContent()).replaceAll(',',''))).toBeLessThan(potRaise);
    await surface.locator('#pkPauseBtn').tap();await expect(surface.locator('#pkPause')).toBeVisible();await visibleTargets(surface,['#pkResumeBtn','#pkHomeBtn'],width,height);
    await surface.locator('#pkResumeBtn').tap();await expect(surface.locator('#pkPause')).toBeHidden();
    await surface.locator('#pkFoldBtn').tap();await expect(surface.locator('#pkResult')).toBeVisible();
    await visibleTargets(surface,['#pkNextBtn','#pkBoard .pk-card','#pkPlayerCards .pk-card','#pkOppCards .pk-card'],width,height);
    await expect(surface.locator('#pkOppCards .pk-back')).toHaveCount(2);
    await surface.locator('#pkNextBtn').tap();await expect(surface.locator('#pkResult')).toBeHidden();
    await surface.evaluate(()=>{document.getElementById('netPill').hidden=true;});await surface.locator('#pkHomeBtn').tap();await expect(surface.locator('#menuScreen')).toBeVisible();
    expect(await surface.evaluate(()=>document.body.classList.contains('poker-selected'))).toBe(false);
  });
  test(`showdown leaves all nine cards readable beside its result at ${width}×${height}`,async({page})=>{
    await page.setViewportSize({width,height});const surface=await open(page,true);await surface.locator('#pkStartBtn').tap();await connectionBar(surface);await playToShowdown(surface);
    await expect(surface.locator('#pkResult')).toBeVisible();await expect(surface.locator('#pkBoard .pk-card:not(.pk-slot)')).toHaveCount(5);await expect(surface.locator('#pkOppCards .pk-back')).toHaveCount(0);
    const cards=await visibleTargets(surface,['#pkBoard .pk-card','#pkPlayerCards .pk-card','#pkOppCards .pk-card'],width,height);expect(cards).toHaveLength(9);
    for(const card of cards)expect(card.width,'readable card width').toBeGreaterThanOrEqual(35);
    await visibleTargets(surface,[(await surface.locator('#pkNextBtn').isVisible())?'#pkNextBtn':'#pkAgainBtn'],width,height);
    await expect(surface.locator('#pkResultDetail')).not.toBeEmpty();
    const marked=await surface.evaluate(()=>{
      const s=ARCADE.POKER.state,suits=['clubs','diamonds','hearts','spades'];
      const expected=[...new Set(s.result.winners.flatMap(i=>s.result.hands[i].best5))].sort((a,b)=>a-b);
      const actual=Array.from(document.querySelectorAll('#pkStage .pk-winning'),el=>suits.indexOf(el.dataset.suit)*13+(({A:14,K:13,Q:12,J:11})[el.dataset.rank]||Number(el.dataset.rank))-2).sort((a,b)=>a-b);
      return{expected,actual};
    });
    expect(marked.actual,'only the winning five-card combination is highlighted').toEqual(marked.expected);
  });
}

test('a seated player can rotate an embedded saloon without losing cards or action controls',async({page})=>{
  await page.setViewportSize({width:390,height:664});const surface=await open(page,true);await surface.locator('#pkStartBtn').tap();await connectionBar(surface);
  const hand=await surface.locator('#pkPlayerCards').getAttribute('data-pk-cards');
  for(const[width,height]of[[844,390],[320,568],[667,375],[390,664]]){
    await page.setViewportSize({width,height});await inView(surface,width,height);expect(await surface.locator('#pkPlayerCards').getAttribute('data-pk-cards')).toBe(hand);
    await surface.locator('#pkPotBtn').tap();await surface.locator('#pkMinBtn').tap();
  }
});

test.describe('desktop saloon',()=>{
  test.use({isMobile:false,hasTouch:false,deviceScaleFactor:1});
  for(const[width,height]of[[1280,720],[1440,1000]])test(`desktop setup, betting and showdown fit ${width}×${height}`,async({page})=>{
    await page.setViewportSize({width,height});const surface=await open(page);await visibleTargets(surface,['#pkStartBtn','#pkNetBtn','#pkHomeBtn'],width,height);
    await surface.locator('#pkStartBtn').click();await inView(surface,width,height);await connectionBar(surface);await inView(surface,width,height);
    await playToShowdown(surface);await visibleTargets(surface,['#pkBoard .pk-card','#pkPlayerCards .pk-card','#pkOppCards .pk-card'],width,height);
    await visibleTargets(surface,[(await surface.locator('#pkNextBtn').isVisible())?'#pkNextBtn':'#pkAgainBtn'],width,height);
  });
});
