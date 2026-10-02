import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const catalog=JSON.parse(readFileSync(new URL('../data/claw-roster.json',import.meta.url),'utf8'));
let errors;
test.beforeEach(async({page})=>{
  errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/game.html');await page.waitForFunction(()=>window.ARCADE);
  await page.evaluate(()=>{ARCADE.Sound.on=false;ARCADE.showScreen('claw');});
});
test.afterEach(()=>expect(errors).toEqual([]));
async function controlled(page,focus='dani-mo'){
  await page.evaluate(focus=>{
    const g=ARCADE.CLAW,s=g.state;g.start(focus);g.pause(true);s.mode='playing';document.querySelector('#clPause').hidden=true;g.step(.01);
    window.untilPhase=phase=>{for(let i=0;i<1000 && s.phase!==phase;i++){g.step(.025);if(i%8===0)g.draw();}if(s.phase!==phase)throw Error('Never reached '+phase+'; got '+s.phase);};
    window.clawWin=kind=>{
      const p=s.prizes.find(p=>!p.removed && (!kind||p.item.kind===kind));s.clock=0;s.x=p.x;g.act();untilPhase('grip');
      for(let i=0;i<60 && s.needle<.48;i++)g.step(.01);
      g.act();untilPhase('reward');return p.item.id;
    };
  },focus);
}

test('all 108 roster entries have five distinct, obtainable collectibles',async({page})=>{
  expect(catalog.roster).toHaveLength(108);
  const data=await page.evaluate(()=>{
    const g=ARCADE.CLAW,ids=new Set(g.items.map(i=>i.id));
    const sets=g.roster.map(r=>{g.start(r.id);g.pause(true);return {id:r.id,n:g.state.prizes.length,owners:[...new Set(g.state.prizes.map(p=>p.item.rosterId))],kinds:new Set(g.state.prizes.map(p=>p.item.kind)).size};});
    return {ids:ids.size,count:g.items.length,sets,missingArt:g.items.filter(i=>!g.artKinds.includes(i.kind)).map(i=>i.id),names:g.roster.map(r=>r.name)};
  });
  expect(data.ids).toBe(540);expect(data.count).toBe(540);expect(data.missingArt).toEqual([]);
  expect(data.names).toEqual(catalog.roster.map(r=>r.name));
  for(const set of data.sets){expect(set.n).toBe(5);expect(set.kinds).toBe(5);expect(set.owners).toEqual([set.id]);}
});

test('every collectible illustration decodes without external assets',async({page})=>{
  const failures=await page.evaluate(async()=>{
    const g=ARCADE.CLAW;const failed=[];
    // Decode in batches to avoid a 540-image memory spike on phones or CI.
    for(let i=0;i<g.items.length;i+=20){await Promise.all(g.items.slice(i,i+20).map(async item=>{const im=new Image();im.src=g.artURI(item);try{await im.decode();if(!im.naturalWidth)failed.push(item.id);}catch{failed.push(item.id);}}));}
    return failed;
  });
  expect(failures).toEqual([]);
});

for(const width of [320,390,1440]){
  test(`game, collection and all overlays fit at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:900});
    for(const overlay of ['clAttract','clPause','clOver']){
      if(overlay==='clPause')await page.evaluate(()=>{ARCADE.CLAW.start();ARCADE.CLAW.pause(true);});
      if(overlay==='clOver'){await controlled(page);await page.evaluate(()=>{const g=ARCADE.CLAW;g.state.drops=0;g.state.phase='reward';g.act();});}
      const fit=await page.locator('#'+overlay).evaluate(el=>{const a=el.getBoundingClientRect(),b=el.firstElementChild.getBoundingClientRect();return !el.hidden&&b.top>=a.top-1&&b.bottom<=a.bottom+1&&b.left>=a.left&&b.right<=a.right;});
      expect(fit,overlay).toBe(true);
    }
    await page.locator('#clRoster').selectOption('icp-founders');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  });
}

test('mixed load includes Dani Mo’s belt and Ring Rat’s pants',async({page})=>{
  await page.locator('#clStartBtn').click();
  const ids=await page.evaluate(()=>ARCADE.CLAW.state.prizes.map(p=>p.item.id));
  expect(ids).toContain('dani-mo:belt');expect(ids).toContain('the-ring-rat:pants');expect(new Set(ids).size).toBe(5);
});

test('a centred green-zone grab travels to the chute and awards exactly once',async({page})=>{
  await controlled(page);
  const result=await page.evaluate(()=>{
    const g=ARCADE.CLAW,s=g.state;clawWin('belt');
    g.step(.1);const before=s.score;g.act();g.act();g.act();
    return {before,score:s.score,wins:s.wins,perfects:s.perfects,owned:s.owned['dani-mo:belt'],drops:s.drops};
  });
  expect(result).toEqual({before:450,score:450,wins:1,perfects:1,owned:1,drops:3});
  await expect(page.locator('#clOwned')).toHaveText('1 / 540');
});

test('five perfect pulls complete a set, apply the advertised streak and finish offline',async({page,context})=>{
  await controlled(page);await context.setOffline(true);
  const r=await page.evaluate(()=>{
    const g=ARCADE.CLAW,s=g.state;
    for(const kind of ['belt','robe','boots','turnbuckle','poster']){clawWin(kind);g.act();}
    const score=s.score;for(let i=0;i<200;i++)g.step(.05);g.act();
    return {mode:s.mode,score,after:s.score,wins:s.wins,perfects:s.perfects,drops:s.drops,owned:Object.keys(s.owned).length};
  });
  expect(r).toEqual({mode:'over',score:1645,after:1645,wins:5,perfects:5,drops:0,owned:5});
  await expect(page.locator('#clSetProgress')).toContainText('SET COMPLETE');await expect(page.locator('#clOver')).toBeVisible();
  await expect(page.locator('#lbModal')).toBeHidden();await page.locator('#clAgainBtn').click();
  expect(await page.evaluate(()=>ARCADE.CLAW.state.score)).toBe(0);await expect(page.locator('#clOwned')).toHaveText('5 / 540');
});

test('empty drops, edge grips and bad timing cost one pull and never award a prize',async({page})=>{
  await controlled(page);
  const r=await page.evaluate(()=>{
    const g=ARCADE.CLAW,s=g.state;s.clock=0;s.x=182.5;g.act();untilPhase('reward');const empty=!s.target;g.act();
    s.clock=0;s.x=s.prizes[2].x+28;g.act();untilPhase('grip');s.needle=.5;g.act();untilPhase('reward');const edge=s.reason;g.act();
    s.clock=0;s.x=s.prizes[2].x;g.act();untilPhase('grip');s.needle=.95;g.act();untilPhase('reward');
    return {empty,edge,drops:s.drops,wins:s.wins,score:s.score,owned:Object.keys(s.owned).length};
  });
  expect(r).toEqual({empty:true,edge:'Centre the claw over the prize.',drops:2,wins:0,score:0,owned:0});
});

test('the grip timer expires safely and held Space cannot lock an accidental grip',async({page})=>{
  await controlled(page);
  await page.evaluate(()=>{const s=ARCADE.CLAW.state;s.clock=0;s.x=s.prizes[0].x;});
  await page.locator('#clCanvas').focus();await page.keyboard.down('Space');
  await page.evaluate(()=>untilPhase('grip'));await page.keyboard.down('Space');
  expect(await page.evaluate(()=>ARCADE.CLAW.state.phase)).toBe('grip');await page.keyboard.up('Space');
  await page.evaluate(()=>untilPhase('reward'));
  expect(await page.evaluate(()=>({score:ARCADE.CLAW.state.score,reason:ARCADE.CLAW.state.reason}))).toEqual({score:0,reason:'The grip timer ran out.'});
});

test('mobile dragging maps to the claw and a cancelled direction button releases movement',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.locator('#clStartBtn').click();
  const b=await page.locator('#clCanvas').boundingBox();
  await page.mouse.move(b.x+b.width*.5,b.y+b.height*.5);await page.mouse.down();await page.mouse.move(b.x+b.width*.8,b.y+b.height*.5);await page.mouse.up();
  expect(await page.evaluate(()=>ARCADE.CLAW.state.x)).toBeCloseTo(384,0);
  await page.locator('#clLeftBtn').dispatchEvent('pointerdown',{pointerId:1,button:0});
  await page.locator('#clLeftBtn').dispatchEvent('pointercancel',{pointerId:1,button:0});
  const x=await page.evaluate(()=>ARCADE.CLAW.state.x);await page.waitForTimeout(120);expect(await page.evaluate(()=>ARCADE.CLAW.state.x)).toBe(x);
});

test('pausing in a grab, leaving, and opening records preserve the pull and release held keys',async({page})=>{
  await page.locator('#clStartBtn').click();
  await page.evaluate(()=>{const g=ARCADE.CLAW;g.state.clock=0;g.state.x=g.state.prizes[1].x;g.act();});
  await expect.poll(()=>page.evaluate(()=>ARCADE.CLAW.state.phase)).toBe('grip');
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  const before=await page.evaluate(()=>JSON.stringify(ARCADE.CLAW.state));await page.waitForTimeout(120);
  expect(await page.evaluate(()=>JSON.stringify(ARCADE.CLAW.state))).toBe(before);
  await page.locator('#clHomeBtn').click();await page.locator('#cardCL').click();await expect(page.locator('#clPause')).toBeVisible();
  await page.locator('#clResumeBtn').click();await page.locator('#clScreen .lb-mini').click();await expect(page.locator('#clPause')).toBeVisible();
  await page.locator('#lbClose').click();await page.locator('#clResumeBtn').click();
  await expect.poll(()=>page.evaluate(()=>ARCADE.CLAW.state.phase)).toBe('reward');
});

test('restart during delivery cancels the old prize and award',async({page})=>{
  await controlled(page);
  const r=await page.evaluate(()=>{
    const g=ARCADE.CLAW,s=g.state;s.clock=0;s.x=s.prizes[0].x;g.act();untilPhase('grip');s.needle=.5;g.act();untilPhase('carry');
    g.start('the-ring-rat');g.pause(true);s.mode='playing';for(let i=0;i<200;i++)g.step(.05);
    return {score:s.score,owned:Object.keys(s.owned).length,wins:s.wins,drops:s.drops,owners:[...new Set(s.prizes.map(p=>p.item.rosterId))]};
  });
  expect(r).toEqual({score:0,owned:0,wins:0,drops:5,owners:['the-ring-rat']});
});

test('collection search, set hunting and no-results handling select exactly the intended five items',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.locator('#clSearch').fill('ring rat');await expect(page.locator('#clRoster option')).toHaveCount(1);
  await expect(page.locator('#clCollection .cl-prize')).toHaveCount(5);await page.locator('#clHuntBtn').click();
  expect(await page.evaluate(()=>ARCADE.CLAW.state.focus)).toBe('the-ring-rat');
  expect(await page.locator('#clActionBtn').evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight)).toBe(true);
  await page.locator('#clSearch').fill('no wrestler by this name');await expect(page.locator('#clHuntBtn')).toBeDisabled();await expect(page.locator('#clNoResults')).toBeVisible();
  await expect(page.locator('#clPause')).toBeVisible();
  await page.locator('#clSearch').fill('Dani');await page.locator('#clHuntBtn').click();expect(await page.evaluate(()=>ARCADE.CLAW.state.focus)).toBe('dani-mo');
});

test('prizes save immediately, duplicates count as copies, and a reload keeps the collection',async({page})=>{
  await controlled(page);await page.evaluate(()=>clawWin('belt'));await page.reload();await page.evaluate(()=>ARCADE.showScreen('claw'));
  await expect(page.locator('#clOwned')).toHaveText('1 / 540');await controlled(page);await page.evaluate(()=>clawWin('belt'));
  await expect(page.locator('#clOwned')).toHaveText('1 / 540');expect(await page.evaluate(()=>ARCADE.CLAW.state.owned['dani-mo:belt'])).toBe(2);
});

test('malformed and blocked storage cannot break prizes, replay or score submission',async({page})=>{
  await page.evaluate(()=>localStorage.setItem('pa_cl_collection','[1,2,3]'));await page.reload();await page.evaluate(()=>{ARCADE.showScreen('claw');ARCADE.Sound.on=false;Storage.prototype.setItem=()=>{throw Error('Blocked');};});
  await controlled(page);await page.evaluate(()=>{clawWin('belt');const g=ARCADE.CLAW;g.state.drops=0;g.act();});
  await page.locator('#clSaveBtn').click();await page.locator('#lbInitials').fill('CLW');await page.locator('#lbSaveBtn').click();await page.locator('#lbClose').click();
  await expect(page.locator('#clSaveBtn')).toBeDisabled();await page.locator('#clAgainBtn').click();await expect(page.locator('#clOwned')).toHaveText('1 / 540');
});


test('mixed restocks favor missing collectibles after the featured prizes are owned',async({page})=>{
  const ids=await page.evaluate(()=>{const g=ARCADE.CLAW;g.state.owned['dani-mo:belt']=1;g.state.owned['the-ring-rat:pants']=1;g.start('all');g.pause(true);return g.state.prizes.map(p=>p.item.id);});
  expect(ids).toHaveLength(5);expect(new Set(ids).size).toBe(5);expect(ids).not.toContain('dani-mo:belt');expect(ids).not.toContain('the-ring-rat:pants');
});
