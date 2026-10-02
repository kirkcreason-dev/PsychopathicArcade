import {test,expect} from '@playwright/test';
let errors;
test.beforeEach(async({page})=>{
  errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/game.html');await page.waitForFunction(()=>window.ARCADE);
  await page.evaluate(()=>{ARCADE.Sound.on=false;ARCADE.showScreen('chicken');});
});
test.afterEach(()=>expect(errors).toEqual([]));

async function controlledRound(page){
  await page.evaluate(()=>{
    const g=ARCADE.CHICKEN;g.start();g.pause(true);g.state.mode='playing';
    g.state.targets=[];g.state.spawnIn=999;
    window.target=(kind='chicken')=>{const t={kind,dir:1,y:290,flying:false,age:5,life:10,r:38,phase:0};g.state.targets=[t];return g.position(t);};
    window.advance=seconds=>{for(let i=0;i<Math.ceil(seconds/.05);i++)g.step(.05);};
    window.fire=(kind='chicken',offset=0)=>{const p=target(kind);g.shoot(p.x+offset,p.y);advance(.2);};
  });
}

for(const width of [320,390,1440]){
  test(`start, pause and result overlays fit the gallery at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:900});
    for(const [overlay,button] of [['khAttract','khStartBtn'],['khPause','khResumeBtn'],['khOver','khAgainBtn']]){
      if(overlay==='khPause')await page.evaluate(()=>{ARCADE.CHICKEN.start();ARCADE.CHICKEN.pause(true);});
      if(overlay==='khOver')await page.evaluate(()=>{ARCADE.CHICKEN.start();ARCADE.CHICKEN.state.time=.01;ARCADE.CHICKEN.step(.05);});
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
  const p=await page.evaluate(()=>{document.querySelector('#khPause').hidden=true;return target();});
  const box=await page.locator('#khCanvas').boundingBox();
  await page.locator('#khCanvas').dispatchEvent('pointerdown',{clientX:box.x+p.x*box.width/480,clientY:box.y+p.y*box.height/500,pointerType:'touch',button:0,isPrimary:true});
  await page.locator('#khCanvas').dispatchEvent('click');
  expect(await page.evaluate(()=>({score:ARCADE.CHICKEN.state.score,ammo:ARCADE.CHICKEN.state.ammo,hits:ARCADE.CHICKEN.state.hits}))).toEqual({score:75,ammo:5,hits:1});
  await context.setOffline(true);
  await page.evaluate(()=>{ARCADE.CHICKEN.step(.05);ARCADE.CHICKEN.draw();});
});

test('edge hits, bullseyes, combo tiers, gold and bombs use the advertised scoring',async({page})=>{
  await controlledRound(page);
  const values=await page.evaluate(()=>{
    const s=ARCADE.CHICKEN.state,values=[];
    fire('chicken',25);values.push(s.score); // 50
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
    const g=ARCADE.CHICKEN,s=g.state;const p=target();g.shoot(p.x,p.y);g.shoot(p.x,p.y);advance(.2);
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
    const s=ARCADE.CHICKEN.state;
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
    const g=ARCADE.CHICKEN,s=g.state;fire();target('bomb');s.targets[0].life=.01;advance(.05);const bomb=s.streak;
    target();s.targets[0].life=.01;advance(.05);const escape=s.streak;
    fire();g.shoot(5,80);const miss=s.streak;return {bomb,escape,miss,charge:s.charge};
  });
  expect(r).toEqual({bomb:1,escape:0,miss:0,charge:0});
});

test('pause, blur, menu and records freeze the entire round, then resume safely',async({page})=>{
  await page.locator('#khStartBtn').click();
  await page.evaluate(()=>{const g=ARCADE.CHICKEN;g.state.ammo=2;g.reload();window.dispatchEvent(new Event('blur'));});
  const paused=await page.evaluate(()=>JSON.stringify(ARCADE.CHICKEN.state));
  await page.waitForTimeout(160);
  expect(await page.evaluate(()=>JSON.stringify(ARCADE.CHICKEN.state))).toBe(paused);
  await page.locator('#khResumeBtn').click();
  await expect.poll(()=>page.evaluate(()=>ARCADE.CHICKEN.state.reload)).toBe(0);
  await page.locator('#khScreen .lb-mini').click();
  await expect(page.locator('#khPause')).toBeVisible();await page.locator('#lbClose').click();
  await page.locator('#khHomeBtn').click();await page.locator('#cardKH').click();
  await expect(page.locator('#khPause')).toBeVisible();
  await page.locator('#khResumeBtn').click();await expect.poll(()=>page.evaluate(()=>ARCADE.CHICKEN.state.time)).toBeLessThan(59);
});

test('keyboard aiming, reload and pause never leak held movement after focus loss',async({page})=>{
  await page.locator('#khStartBtn').click();await page.keyboard.down('ArrowRight');
  await expect.poll(()=>page.evaluate(()=>ARCADE.CHICKEN.state.aim.x)).toBeGreaterThan(250);
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.keyboard.up('ArrowRight');
  await page.locator('#khResumeBtn').click();const x=await page.evaluate(()=>ARCADE.CHICKEN.state.aim.x);
  await page.waitForTimeout(100);expect(await page.evaluate(()=>ARCADE.CHICKEN.state.aim.x)).toBe(x);
  await page.keyboard.press('Space');await page.keyboard.press('r');
  expect(await page.evaluate(()=>ARCADE.CHICKEN.state.reload)).toBeGreaterThan(0);
  await page.keyboard.press('p');await expect(page.locator('#khPause')).toBeVisible();
});

test('an offline round reaches all waves, renders every target type, and ends only once',async({page,context})=>{
  await page.locator('#khStartBtn').click();
  await context.setOffline(true);
  const r=await page.evaluate(()=>{
    const g=ARCADE.CHICKEN,s=g.state;g.pause(true);s.mode='playing';
    const waves=new Set(),kinds=new Set();let frenzy=false,maxTargets=0;
    for(let i=0;i<1450;i++){
      g.step(.05);waves.add(s.wave);maxTargets=Math.max(maxTargets,s.targets.length);
      s.targets.forEach(t=>kinds.add(t.kind));
      if(i%6===0)g.draw();
      const t=s.targets.find(t=>t.kind!=='bomb');if(t){const p=g.position(t);g.shoot(p.x,p.y);}
      if(s.frenzy>0)frenzy=true;
    }
    const score=s.score;g.step(.05);g.shoot(200,200);
    return {mode:s.mode,waves:[...waves],kinds:[...kinds].sort(),frenzy,maxTargets,score,after:s.score,particles:s.particles.length};
  });
  expect(r.mode).toBe('over');expect(r.waves).toEqual([1,2,3]);expect(r.kinds).toEqual(['bomb','chicken','gold']);
  expect(r.frenzy).toBe(true);expect(r.maxTargets).toBeLessThanOrEqual(6);expect(r.particles).toBeLessThanOrEqual(90);expect(r.score).toBeGreaterThan(10000);expect(r.after).toBe(r.score);
  await expect(page.locator('#khOver')).toBeVisible();await expect(page.locator('#lbModal')).toBeHidden();
  await page.locator('#khAgainBtn').click();expect(await page.evaluate(()=>ARCADE.CHICKEN.state.score)).toBe(0);
});

test('best scores persist, records submit once, and restarting clears every old effect',async({page})=>{
  await controlledRound(page);
  await page.evaluate(()=>{fire();const g=ARCADE.CHICKEN;g.state.time=.01;g.step(.05);});
  await page.locator('#khSaveBtn').click();await expect(page.locator('#lbModal')).toBeVisible();
  await page.locator('#lbInitials').fill('ABC');await page.locator('#lbSaveBtn').click();await page.locator('#lbClose').click();
  await expect(page.locator('#khSaveBtn')).toBeDisabled();
  await page.locator('#khAgainBtn').click();
  expect(await page.evaluate(()=>({score:ARCADE.CHICKEN.state.score,streak:ARCADE.CHICKEN.state.streak,frenzy:ARCADE.CHICKEN.state.frenzy,labels:ARCADE.CHICKEN.state.labels.length}))).toEqual({score:0,streak:0,frenzy:0,labels:0});
  await page.reload();await page.evaluate(()=>ARCADE.showScreen('chicken'));
  await expect(page.locator('#khBest')).toHaveText('75');
  expect(await page.evaluate(()=>ARCADE.LB.board('chicken').length)).toBe(1);
});

test('blocked score storage does not stop a completed round or replay',async({page})=>{
  await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw new Error('Storage blocked');};const g=ARCADE.CHICKEN;g.start();g.state.time=.01;g.step(.05);});
  await expect(page.locator('#khOver')).toBeVisible();await page.locator('#khAgainBtn').click();
  await expect.poll(()=>page.evaluate(()=>ARCADE.CHICKEN.state.time)).toBeLessThan(60);
});

test('golden birds add time only up to ten seconds and replay resets the allowance',async({page})=>{
  await controlledRound(page);
  const r=await page.evaluate(()=>{
    const g=ARCADE.CHICKEN,s=g.state;s.time=20;
    for(let i=0;i<8;i++){s.reload=0;s.ammo=6;fire('gold');}
    const result={bonus:s.bonusTime,golden:s.golden,time:Math.round(s.time*10)/10};
    g.start();return {...result,reset:s.bonusTime,resetGolden:s.golden};
  });
  expect(r).toEqual({bonus:10,golden:8,time:28.4,reset:0,resetGolden:0});
});

test('birds travel both directions without cropped bodies and crates hit only their visible box',async({page})=>{
  await controlledRound(page);
  const r=await page.evaluate(()=>{
    const g=ARCADE.CHICKEN,s=g.state;let inside=true;
    for(const dir of [-1,1])for(const flying of [true,false])for(let age=0;age<=4;age+=.05){
      const p=g.position({kind:'chicken',dir,flying,y:flying?167:412,phase:0,age,life:4});
      inside &&= p.x-42>=0 && p.x+42<=480 && p.y-44>=0 && p.y+30<461;
    }
    const p=target('bomb');s.score=200;g.shoot(p.x+35,p.y);const outside=s.score;
    advance(.2);const q=g.position(s.targets[0]);g.shoot(q.x+27,q.y);return {inside,outside,insideCrate:s.score};
  });
  expect(r).toEqual({inside:true,outside:200,insideCrate:100});
});

test('all game controls stay visible on a phone after starting or replaying',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.locator('#khStartBtn').click();
  for(const id of ['khCanvas','khReloadBtn','khPauseBtn','khHomeBtn']){
    const b=await page.locator('#'+id).boundingBox();expect(b.y).toBeGreaterThanOrEqual(0);expect(b.y+b.height,id).toBeLessThanOrEqual(844);
  }
  await page.evaluate(()=>{ARCADE.CHICKEN.state.time=.01;ARCADE.CHICKEN.step(.05);});
  await page.locator('#khAgainBtn').click();expect(await page.evaluate(()=>window.scrollY)).toBe(0);
});

test('blocked actions cannot fire after the round, during a modal, or while paused',async({page})=>{
  await page.locator('#khStartBtn').click();await page.locator('#khScreen .lb-mini').click();
  const shots=await page.evaluate(()=>ARCADE.CHICKEN.state.shots);await page.keyboard.press('Space');
  expect(await page.evaluate(()=>ARCADE.CHICKEN.state.shots)).toBe(shots);
  await page.locator('#lbClose').click();
  const r=await page.evaluate(()=>{const g=ARCADE.CHICKEN;g.shoot(240,290);g.step(100);return {shots:g.state.shots,time:g.state.time,mode:g.state.mode};});
  expect(r.shots).toBe(shots);expect(r.mode).toBe('paused');
  await page.locator('#khResumeBtn').click();
  await page.evaluate(()=>{const g=ARCADE.CHICKEN;g.state.time=.01;g.step(.05);g.shoot(240,290);g.step(100);});
  expect(await page.evaluate(()=>ARCADE.CHICKEN.state.shots)).toBe(shots);
});
