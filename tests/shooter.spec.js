import {test,expect} from '@playwright/test';
let errors;
test.beforeEach(async({page})=>{
  errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/game.html');await page.waitForFunction(()=>window.ARCADE);
  await page.evaluate(()=>{ARCADE.Sound.on=false;ARCADE.showScreen('shooter');});
});
test.afterEach(()=>expect(errors).toEqual([]));

async function controlledRound(page){
  await page.evaluate(()=>{
    const g=ARCADE.SHOOTER;g.start();g.pause(true);g.state.mode='playing';
    g.state.targets=[];g.state.spawnIn=999;
    window.target=(kind='joker',slot=4)=>{const t={kind,slot,age:0,life:10,r:38,phase:0,art:0};g.state.targets=[t];return g.position(t);};
    window.advance=seconds=>{for(let i=0;i<Math.ceil(seconds/.05);i++)g.step(.05);};
    window.fire=(kind='joker',offset=0)=>{const p=target(kind);g.shoot(p.x+offset,p.y);advance(.2);};
  });
}

for(const width of [320,390,1440]){
  test(`start, pause and result overlays fit the gallery at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:900});
    for(const [overlay,button] of [['shAttract','shStartBtn'],['shPause','shResumeBtn'],['shOver','shAgainBtn']]){
      if(overlay==='shPause')await page.evaluate(()=>{ARCADE.SHOOTER.start();ARCADE.SHOOTER.pause(true);});
      if(overlay==='shOver')await page.evaluate(()=>{ARCADE.SHOOTER.start();ARCADE.SHOOTER.state.time=.01;ARCADE.SHOOTER.step(.05);});
      await expect(page.locator('#'+button)).toBeVisible();
      const fit=await page.locator('#'+overlay).evaluate(el=>{const a=el.getBoundingClientRect(),b=el.firstElementChild.getBoundingClientRect();return b.top>=a.top-1 && b.bottom<=a.bottom+1 && b.left>=a.left && b.right<=a.right;});
      expect(fit,overlay).toBe(true);
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  });
}

test('touch coordinates hit the drawn centre exactly once on a scaled phone canvas',async({page,context})=>{
  await page.setViewportSize({width:390,height:844});
  await controlledRound(page);
  const p=await page.evaluate(()=>{document.querySelector('#shPause').hidden=true;return target();});
  const box=await page.locator('#shCanvas').boundingBox();
  await page.locator('#shCanvas').dispatchEvent('pointerdown',{clientX:box.x+p.x*box.width/480,clientY:box.y+p.y*box.height/500,pointerType:'touch',button:0,isPrimary:true});
  await page.locator('#shCanvas').dispatchEvent('click');
  expect(await page.evaluate(()=>({score:ARCADE.SHOOTER.state.score,ammo:ARCADE.SHOOTER.state.ammo,hits:ARCADE.SHOOTER.state.hits}))).toEqual({score:75,ammo:5,hits:1});
  await context.setOffline(true);
  await page.evaluate(()=>{ARCADE.SHOOTER.step(.05);ARCADE.SHOOTER.draw();});
});

test('edge hits, bullseyes, combo tiers, gold and bombs use the advertised scoring',async({page})=>{
  await controlledRound(page);
  const values=await page.evaluate(()=>{
    const s=ARCADE.SHOOTER.state,values=[];
    fire('joker',25);values.push(s.score); // 50
    fire();values.push(s.score); // 75
    fire('gold');values.push(s.score); // 175 × 2
    const time=s.time;fire('bomb');values.push(s.score,s.streak,Math.round((time-s.time)*10)/10,s.bullseyes,s.shots,s.hits);
    return values;
  });
  expect(values).toEqual([50,125,475,375,0,2.2,2,4,3]);
});

test('six shots auto-reload and do not allow firing through the reload or cooldown',async({page})=>{
  await controlledRound(page);
  const result=await page.evaluate(()=>{
    const g=ARCADE.SHOOTER,s=g.state;const p=target();g.shoot(p.x,p.y);g.shoot(p.x,p.y);advance(.2);
    for(let i=0;i<5;i++)fire();
    const empty={shots:s.shots,ammo:s.ammo,reloading:s.reload>0};
    fire();const blocked=s.shots;advance(1);fire();
    return {empty,blocked,after:{shots:s.shots,ammo:s.ammo}};
  });
  expect(result).toEqual({empty:{shots:6,ammo:0,reloading:true},blocked:6,after:{shots:7,ammo:5}});
});

test('eight clean hits trigger a finite frenzy with unlimited ammo and double points',async({page})=>{
  await controlledRound(page);
  const r=await page.evaluate(()=>{
    const s=ARCADE.SHOOTER.state;
    for(let i=0;i<8;i++){if(s.reload)advance(1);fire();}
    const active=s.frenzy>0,score=s.score;fire('gold');
    const bonus=s.score-score,ammo=s.ammo;
    advance(6);return {active,bonus,ammo,frenzy:s.frenzy,charge:s.charge,streak:s.streak};
  });
  expect(r).toEqual({active:true,bonus:1400,ammo:6,frenzy:0,charge:0,streak:9});
});

test('escaped scoring targets and misses break the streak; ignored bombs do not',async({page})=>{
  await controlledRound(page);
  const r=await page.evaluate(()=>{
    const g=ARCADE.SHOOTER,s=g.state;fire();target('bomb');s.targets[0].life=.01;advance(.05);const bomb=s.streak;
    target();s.targets[0].life=.01;advance(.05);const escape=s.streak;
    fire();g.shoot(5,80);const miss=s.streak;return {bomb,escape,miss,charge:s.charge};
  });
  expect(r).toEqual({bomb:1,escape:0,miss:0,charge:0});
});

test('pause, blur, menu and records freeze the entire round, then resume safely',async({page})=>{
  await page.locator('#shStartBtn').click();
  await page.evaluate(()=>{const g=ARCADE.SHOOTER;g.state.ammo=2;g.reload();window.dispatchEvent(new Event('blur'));});
  const paused=await page.evaluate(()=>JSON.stringify(ARCADE.SHOOTER.state));
  await page.waitForTimeout(160);
  expect(await page.evaluate(()=>JSON.stringify(ARCADE.SHOOTER.state))).toBe(paused);
  await page.locator('#shResumeBtn').click();
  await expect.poll(()=>page.evaluate(()=>ARCADE.SHOOTER.state.reload)).toBe(0);
  await page.locator('#shScreen .lb-mini').click();
  await expect(page.locator('#shPause')).toBeVisible();await page.locator('#lbClose').click();
  await page.locator('#shHomeBtn').click();await page.locator('#cardSH').click();
  await expect(page.locator('#shPause')).toBeVisible();
  await page.locator('#shResumeBtn').click();await expect.poll(()=>page.evaluate(()=>ARCADE.SHOOTER.state.time)).toBeLessThan(59);
});

test('keyboard aiming, reload and pause never leak held movement after focus loss',async({page})=>{
  await page.locator('#shStartBtn').click();await page.keyboard.down('ArrowRight');
  await expect.poll(()=>page.evaluate(()=>ARCADE.SHOOTER.state.aim.x)).toBeGreaterThan(250);
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.keyboard.up('ArrowRight');
  await page.locator('#shResumeBtn').click();const x=await page.evaluate(()=>ARCADE.SHOOTER.state.aim.x);
  await page.waitForTimeout(100);expect(await page.evaluate(()=>ARCADE.SHOOTER.state.aim.x)).toBe(x);
  await page.keyboard.press('Space');await page.keyboard.press('r');
  expect(await page.evaluate(()=>ARCADE.SHOOTER.state.reload)).toBeGreaterThan(0);
  await page.keyboard.press('p');await expect(page.locator('#shPause')).toBeVisible();
});

test('an offline round reaches all waves, renders every target type, and ends only once',async({page,context})=>{
  await page.locator('#shStartBtn').click();
  await context.setOffline(true);
  const r=await page.evaluate(()=>{
    const g=ARCADE.SHOOTER,s=g.state;g.pause(true);s.mode='playing';
    const waves=new Set(),kinds=new Set();let frenzy=false,maxTargets=0;
    for(let i=0;i<1250;i++){
      g.step(.05);waves.add(s.wave);maxTargets=Math.max(maxTargets,s.targets.length);
      s.targets.forEach(t=>kinds.add(t.kind));
      if(i%6===0)g.draw();
      const t=s.targets.find(t=>t.kind!=='bomb');if(t){const p=g.position(t);g.shoot(p.x,p.y);}
      if(s.frenzy>0)frenzy=true;
    }
    const score=s.score;g.step(.05);g.shoot(200,200);
    return {mode:s.mode,waves:[...waves],kinds:[...kinds].sort(),frenzy,maxTargets,score,after:s.score,particles:s.particles.length};
  });
  expect(r.mode).toBe('over');expect(r.waves).toEqual([1,2,3]);expect(r.kinds).toEqual(['bomb','gold','joker']);
  expect(r.frenzy).toBe(true);expect(r.maxTargets).toBeLessThanOrEqual(9);expect(r.particles).toBeLessThanOrEqual(90);expect(r.score).toBeGreaterThan(10000);expect(r.after).toBe(r.score);
  await expect(page.locator('#shOver')).toBeVisible();await expect(page.locator('#lbModal')).toBeHidden();
  await page.locator('#shAgainBtn').click();expect(await page.evaluate(()=>ARCADE.SHOOTER.state.score)).toBe(0);
});

test('best scores persist, records submit once, and restarting clears every old effect',async({page})=>{
  await controlledRound(page);
  await page.evaluate(()=>{fire();const g=ARCADE.SHOOTER;g.state.time=.01;g.step(.05);});
  await page.locator('#shSaveBtn').click();await expect(page.locator('#lbModal')).toBeVisible();
  await page.locator('#lbInitials').fill('ABC');await page.locator('#lbSaveBtn').click();await page.locator('#lbClose').click();
  await expect(page.locator('#shSaveBtn')).toBeDisabled();
  await page.locator('#shAgainBtn').click();
  expect(await page.evaluate(()=>({score:ARCADE.SHOOTER.state.score,streak:ARCADE.SHOOTER.state.streak,frenzy:ARCADE.SHOOTER.state.frenzy,labels:ARCADE.SHOOTER.state.labels.length}))).toEqual({score:0,streak:0,frenzy:0,labels:0});
  await page.reload();await page.evaluate(()=>ARCADE.showScreen('shooter'));
  await expect(page.locator('#shBest')).toHaveText('75');
  expect(await page.evaluate(()=>ARCADE.LB.board('shooter').length)).toBe(1);
});

test('blocked score storage does not stop a completed round or replay',async({page})=>{
  await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw new Error('Storage blocked');};const g=ARCADE.SHOOTER;g.start();g.state.time=.01;g.step(.05);});
  await expect(page.locator('#shOver')).toBeVisible();await page.locator('#shAgainBtn').click();
  await expect.poll(()=>page.evaluate(()=>ARCADE.SHOOTER.state.time)).toBeLessThan(60);
});
