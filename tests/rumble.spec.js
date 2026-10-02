import {test,expect} from '@playwright/test';
let errors;
test.beforeEach(async({page})=>{errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/game.html');await page.waitForFunction(()=>window.ARCADE);await page.evaluate(()=>{ARCADE.Sound.on=false;ARCADE.showScreen('rumble');});});
test.afterEach(()=>expect(errors).toEqual([]));
async function controlled(page){await page.evaluate(async()=>{
  const g=ARCADE.RUMBLE;await g.start();g.pause(true);g.state.mode='playing';g.state.nextIn=999;
  window.advance=seconds=>{for(let t=0;t<seconds-.00001;t+=.05)g.step(.05);};
  window.duel=(hp=100,x=270,y=265)=>{const s=g.state,p=g.player(),v=s.fighters.find(f=>!f.player);s.fighters=[p,v];s.labels=[];Object.assign(p,{x:220,y:265,hp:100,invuln:0,action:null,cool:0,stun:0,grabbed:null,out:false});Object.assign(v,{x,y,hp,invuln:0,action:null,cool:0,stun:0,grabbed:null,out:false,age:2,aiWait:999,think:999,target:p.id});return v;};
});}
for(const width of [320,390,1440])test(`roster, pause and result panels fit at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  for(const id of ['ruSetup','ruPause','ruOver']){
    if(id==='ruPause')await page.evaluate(async()=>{await ARCADE.RUMBLE.start();ARCADE.RUMBLE.pause(true);});
    if(id==='ruOver')await page.evaluate(()=>{const g=ARCADE.RUMBLE;g.state.mode='playing';g.state.queue=[];g.state.fighters=[g.player()];g.step(.05);});
    await expect(page.locator('#'+id)).toBeVisible();expect(await page.locator('#'+id).evaluate(el=>{const a=el.getBoundingClientRect(),b=el.firstElementChild.getBoundingClientRect();return b.top>=a.top-1&&b.bottom<=a.bottom+1&&b.left>=a.left&&b.right<=a.right;}),id).toBe(true);
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
test('22 original wrestlers decode offline with intact alpha gutters and bounded cache',async({page,context})=>{
  await context.setOffline(true);const r=await page.evaluate(async()=>{const g=ARCADE.RUMBLE;let frames=0,valid=true,clear=true,maxCache=0;
    for(const f of g.roster){const im=await g.load(f.id);valid&&=im.width===f.width&&im.height===f.height;const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(im,0,0);
      for(const list of Object.values(f.animations))for(const a of list){frames++;valid&&=a.x>=4&&a.y>=4&&a.x+a.w+4<=im.width&&a.y+a.h+4<=im.height&&Number.isFinite(a.anchorX)&&Number.isFinite(a.anchorY);clear&&=ctx.getImageData(a.x-2,a.y-2,1,1).data[3]===0;}
      maxCache=Math.max(maxCache,g.cacheSize());
    }return{names:g.roster.length,ids:new Set(g.roster.map(r=>r.id)).size,frames,valid,clear,maxCache};});
  expect(r.names).toBe(22);expect(r.ids).toBe(22);expect(r.frames).toBeGreaterThan(650);expect(r.valid).toBe(true);expect(r.clear).toBe(true);expect(r.maxCache).toBeLessThanOrEqual(6);
});
test('selection starts the right wrestler and unique complete 22-person field',async({page})=>{
  await page.locator('#ruRoster').selectOption('dani-mo');await page.locator('#ruSize').selectOption('22');await page.locator('#ruStartBtn').click();await expect(page.locator('#ruSetup')).toBeHidden();
  const r=await page.evaluate(()=>{const g=ARCADE.RUMBLE,s=g.state;return {player:g.player().id,total:s.total,ids:new Set([...s.fighters.map(f=>f.id),...s.queue]).size,active:s.fighters.length,queue:s.queue.length};});expect(r).toEqual({player:'dani-mo',total:22,ids:22,active:3,queue:19});
});
test('strike windup lands once, builds charge and cannot hurt distant rivals',async({page})=>{
  await controlled(page);const r=await page.evaluate(()=>{const g=ARCADE.RUMBLE,v=duel();g.act('hit');g.act('hit');advance(.1);const before=v.hp;advance(.1);const hit=v.hp;advance(.2);const after=v.hp,score=g.state.score;advance(.1);v.x=405;g.act('hit');advance(.5);return{before,hit,after,score,finalScore:g.state.score,charge:g.state.charge};});expect(r.before).toBe(100);expect(r.hit).toBeLessThan(100);expect(r.after).toBe(r.hit);expect(r.score).toBe(25);expect(r.finalScore).toBe(25);expect(r.charge).toBe(13);
});
test('healthy throws shove; weakened rope throws eliminate exactly once',async({page})=>{
  await controlled(page);const r=await page.evaluate(()=>{const g=ARCADE.RUMBLE,v=duel(),p=g.player();g.act('throw');advance(.85);const shove={out:v.out,hp:v.hp,y:v.y};advance(.6);v.hp=30;v.action=null;v.stun=0;p.x=v.x-35;p.y=v.y;g.act('throw');advance(.5);const once={out:v.out,kills:g.state.kills,score:g.state.score};advance(.7);return{shove,once,after:g.state.kills,free:!v.grabbed};});expect(r.shove.out).toBe(false);expect(r.shove.hp).toBe(88);expect(r.shove.y).toBe(337);expect(r.once).toEqual({out:true,kills:1,score:500});expect(r.after).toBe(1);expect(r.free).toBe(true);
});
test('weak rivals away from ropes are shoved before they can be eliminated',async({page})=>{
  await controlled(page);const r=await page.evaluate(()=>{const g=ARCADE.RUMBLE,v=duel(20,250,260);g.act('throw');advance(.85);return{out:v.out,kills:g.state.kills,near:g.edge(v).d};});expect(r.out).toBe(false);expect(r.kills).toBe(0);expect(r.near).toBeLessThanOrEqual(48);
});
test('guard resists throws, drains under pressure and recovers when released',async({page})=>{
  await controlled(page);const r=await page.evaluate(()=>{const g=ARCADE.RUMBLE,v=duel(20);v.guardOn=true;const started=g.act('throw'),blocked=v.guard;v.guardOn=false;advance(.1);return{started,blocked,recovered:v.guard,grabbed:v.grabbed};});expect(r.started).toBe(false);expect(r.blocked).toBe(70);expect(r.recovered).toBeGreaterThan(70);expect(r.grabbed).toBe(null);
  await page.evaluate(()=>{ARCADE.RUMBLE.pause(true);});await page.locator('#ruResumeBtn').click();await page.keyboard.down('l');await expect.poll(()=>page.evaluate(()=>ARCADE.RUMBLE.player().guard)).toBeLessThan(96);await page.keyboard.up('l');const value=await page.evaluate(()=>ARCADE.RUMBLE.player().guard);await expect.poll(()=>page.evaluate(()=>ARCADE.RUMBLE.player().guard)).toBeGreaterThan(value);
});
test('charged finisher hits nearby opponents once and cannot be spammed',async({page})=>{
  await controlled(page);const r=await page.evaluate(()=>{const g=ARCADE.RUMBLE,v=duel();const empty=g.act('finish');g.state.charge=100;const ready=g.act('finish'),again=g.act('finish');advance(.35);const hp=v.hp,score=g.state.score;advance(.4);return{empty,ready,again,hp,after:v.hp,score,charge:g.state.charge};});expect(r.empty).toBe(false);expect(r.ready).toBe(true);expect(r.again).toBe(false);expect(r.hp).toBe(56);expect(r.after).toBe(56);expect(r.score).toBe(25);expect(r.charge).toBe(13);
});
test('interrupting a grapple releases its victim instead of freezing either wrestler',async({page})=>{
  await controlled(page);const r=await page.evaluate(()=>{const g=ARCADE.RUMBLE,s=g.state,p=g.player(),rival=s.fighters.find(f=>!f.player),third=s.fighters.find(f=>f!==p&&f!==rival);for(const f of s.fighters){f.invuln=0;f.aiWait=999;f.think=999;f.action=null;f.stun=0;f.cool=0;}Object.assign(p,{x:200,y:280});Object.assign(rival,{x:240,y:280});Object.assign(third,{x:145,y:280});g.act('throw',p);const victim=p.action.target;g.act('hit',third);advance(.35);return{freed:!s.fighters.find(f=>f.id===victim).grabbed,attacker:p.action?.kind};});expect(r.freed).toBe(true);expect(r.attacker).toBe('hurt');
});
test('new entries wait for a space; an empty ring does not award an early victory',async({page})=>{
  await controlled(page);const r=await page.evaluate(async()=>{const g=ARCADE.RUMBLE,s=g.state;await g.load(s.queue[0]);s.nextIn=0;advance(.05);const full=s.fighters.filter(f=>!f.out).length,entered=s.entered;s.nextIn=0;advance(.1);const capped=s.entered;s.fighters=[g.player()];s.nextIn=1;advance(.2);const mode=s.mode;await g.load(s.queue[0]);advance(1);return{full,entered,capped,mode,after:s.entered};});expect(r.full).toBe(4);expect(r.capped).toBe(r.entered);expect(r.mode).toBe('playing');expect(r.after).toBe(r.entered+1);
});
test('player elimination ends once; replay resets locks, scoring, input and queue',async({page})=>{
  await controlled(page);await page.evaluate(()=>{const g=ARCADE.RUMBLE,v=duel(),p=g.player();Object.assign(p,{hp:20,x:80,y:280});Object.assign(v,{x:116,y:280});g.act('throw',v);advance(1.5);});await expect(page.locator('#ruOver')).toBeVisible();expect(await page.evaluate(()=>ARCADE.RUMBLE.state.won)).toBe(false);
  await page.locator('#ruAgainBtn').click();await expect(page.locator('#ruOver')).toBeHidden();expect(await page.evaluate(()=>({score:ARCADE.RUMBLE.state.score,kills:ARCADE.RUMBLE.state.kills,entered:ARCADE.RUMBLE.state.entered,locks:ARCADE.RUMBLE.state.fighters.some(f=>f.grabbed||f.out)}))).toEqual({score:0,kills:0,entered:3,locks:false});
});
test('complete win persists once and record submission remains optional',async({page})=>{
  await controlled(page);await page.evaluate(()=>{const g=ARCADE.RUMBLE,s=g.state;s.score=500;s.kills=1;s.queue=[];s.fighters=[g.player()];advance(.5);});await expect(page.locator('#ruOver')).toBeVisible();await expect(page.locator('#lbModal')).toBeHidden();expect(await page.evaluate(()=>({score:ARCADE.RUMBLE.state.score,wins:ARCADE.RUMBLE.state.wins}))).toEqual({score:2500,wins:1});
  await page.locator('#ruSaveBtn').click();await page.locator('#lbInitials').fill('JCW');await page.locator('#lbSaveBtn').click();await page.locator('#lbClose').click();await expect(page.locator('#ruSaveBtn')).toBeDisabled();await page.reload();await page.evaluate(()=>ARCADE.showScreen('rumble'));await expect(page.locator('#ruBest')).toHaveText('2,500');await expect(page.locator('#ruCareer')).toHaveText('1 career win');expect(await page.evaluate(()=>ARCADE.LB.board('rumble').length)).toBe(1);
});
test('blur, records and leaving freeze the match without leaking held movement',async({page})=>{
  await page.locator('#ruStartBtn').click();await expect(page.locator('#ruSetup')).toBeHidden();await page.keyboard.down('ArrowLeft');await expect.poll(()=>page.evaluate(()=>ARCADE.RUMBLE.player().x)).toBeLessThan(220);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.keyboard.up('ArrowLeft');const before=await page.evaluate(()=>JSON.stringify(ARCADE.RUMBLE.state));await page.waitForTimeout(120);expect(await page.evaluate(()=>JSON.stringify(ARCADE.RUMBLE.state))).toBe(before);
  await page.locator('#ruResumeBtn').click();await page.locator('#ruScreen .lb-mini').click();await expect(page.locator('#ruPause')).toBeVisible();await page.locator('#lbClose').click();await page.locator('#ruHomeBtn').click();await page.locator('#cardRU').click();await expect(page.locator('#ruPause')).toBeVisible();
});
test('all touch controls fit the phone and cancelled stick input stops movement',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.locator('#ruStartBtn').click();await expect(page.locator('#ruSetup')).toBeHidden();for(const id of ['ruCanvas','ruStick','ruHitBtn','ruThrowBtn','ruGuardBtn','ruPauseBtn','ruHomeBtn']){const b=await page.locator('#'+id).boundingBox();expect(b.y).toBeGreaterThanOrEqual(0);expect(b.y+b.height,id).toBeLessThanOrEqual(844);}
  const box=await page.locator('#ruStick').boundingBox();await page.mouse.move(box.x+box.width-7,box.y+box.height/2);await page.mouse.down();await expect.poll(()=>page.evaluate(()=>ARCADE.RUMBLE.player().x)).toBeGreaterThan(235);await page.locator('#ruStick').dispatchEvent('pointercancel',{pointerId:1});await page.mouse.up();const x=await page.evaluate(()=>ARCADE.RUMBLE.player().x);await page.waitForTimeout(120);expect(await page.evaluate(()=>ARCADE.RUMBLE.player().x)).toBeCloseTo(x,1);
});
test('menu navigation cancels late image loading and retry survives decode failure',async({page})=>{
  const r=await page.evaluate(async()=>{const g=ARCADE.RUMBLE,original=Image.prototype.decode;Image.prototype.decode=()=>Promise.reject(new Error('Test decode failure'));document.querySelector('#ruRoster').value='kongo-kong';await g.start();const failed=g.state.mode;Image.prototype.decode=original;const pending=g.start();ARCADE.showScreen('menu');await pending;return{failed,after:g.state.mode,hidden:document.querySelector('#ruScreen').hidden};});expect(r).toEqual({failed:'ready',after:'ready',hidden:true});
  await page.locator('#cardRU').click();await page.locator('#ruStartBtn').click();await expect(page.locator('#ruSetup')).toBeHidden();
});
test('offline simulation stays bounded, responsive and respects wall-clock clamping',async({page,context})=>{
  await page.locator('#ruStartBtn').click();await expect(page.locator('#ruSetup')).toBeHidden();await context.setOffline(true);const r=await page.evaluate(async()=>{const g=ARCADE.RUMBLE,s=g.state;g.pause(true);s.mode='playing';let maxActive=0,maxLabels=0,finite=true,seen=new Set(s.fighters.map(f=>f.id));const elapsed=s.elapsed;g.step(1000);const clamped=s.elapsed-elapsed;
    for(let i=0;i<4000&&s.mode==='playing';i++){const p=g.player();p.invuln=10;if(i%20===0&&s.queue[0])await g.load(s.queue[0]);g.step(.05);maxActive=Math.max(maxActive,s.fighters.filter(f=>!f.out).length);maxLabels=Math.max(maxLabels,s.labels.length);s.fighters.forEach(f=>{seen.add(f.id);finite&&=Number.isFinite(f.x)&&Number.isFinite(f.y)&&f.hp>0;});if(i%80===0)g.draw();}return{maxActive,maxLabels,finite,clamped,seen:seen.size,cache:g.cacheSize()};});expect(r.maxActive).toBeLessThanOrEqual(4);expect(r.maxLabels).toBeLessThanOrEqual(12);expect(r.finite).toBe(true);expect(r.clamped).toBeCloseTo(.05);expect(r.seen).toBeGreaterThanOrEqual(4);expect(r.cache).toBeLessThanOrEqual(6);
});
test('blocked storage cannot break a win or replay',async({page})=>{
  await controlled(page);await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw new Error('Blocked');};const g=ARCADE.RUMBLE;g.state.queue=[];g.state.fighters=[g.player()];advance(.1);});await expect(page.locator('#ruOver')).toBeVisible();await page.locator('#ruAgainBtn').click();await expect(page.locator('#ruOver')).toBeHidden();
});
for(const size of [12,22])test(`${size}-entrant tournament reaches the last elimination and one championship`,async({page,context})=>{
  await page.locator('#ruSize').selectOption(String(size));await controlled(page);await context.setOffline(true);
  const r=await page.evaluate(async()=>{const g=ARCADE.RUMBLE,s=g.state;let maxActive=0,maxCache=0;const seen=new Set(s.fighters.map(f=>f.id));
    for(let turn=0;turn<70&&s.mode==='playing';turn++){
      if(s.queue[0])await g.load(s.queue[0]);
      const p=g.player(),v=s.fighters.find(f=>!f.player&&!f.out);
      for(const f of s.fighters)if(!f.out){Object.assign(f,{action:null,grabbed:null,cool:0,invuln:0,guardOn:false,age:2,stun:f.player?0:3,x:380,y:320});}
      if(v){Object.assign(v,{x:110,y:196,hp:30});Object.assign(p,{x:145,y:213});g.act('throw');advance(1.3);}else{s.nextIn=0;advance(.1);}
      s.fighters.forEach(f=>seen.add(f.id));maxActive=Math.max(maxActive,s.fighters.filter(f=>!f.out).length);maxCache=Math.max(maxCache,g.cacheSize());g.draw();
    }
    const score=s.score;advance(1);return{mode:s.mode,won:s.won,kills:s.kills,total:s.total,seen:seen.size,entered:s.entered,wins:s.wins,maxActive,maxCache,score,after:s.score};
  });expect(r.mode).toBe('over');expect(r.won).toBe(true);expect(r.kills).toBe(size-1);expect(r.total).toBe(size);expect(r.seen).toBe(size);expect(r.entered).toBe(size);expect(r.wins).toBe(1);expect(r.maxActive).toBeLessThanOrEqual(4);expect(r.maxCache).toBeLessThanOrEqual(6);expect(r.after).toBe(r.score);
});
test('touch action buttons trigger one attack per tap',async({page,browser})=>{
  const context=await browser.newContext({hasTouch:true,viewport:{width:390,height:844}}),phone=await context.newPage();phone.on('pageerror',e=>errors.push(e.message));await phone.goto('/game.html');await phone.waitForFunction(()=>window.ARCADE);await phone.evaluate(()=>{ARCADE.Sound.on=false;ARCADE.showScreen('rumble');});await phone.locator('#ruStartBtn').tap();await expect(phone.locator('#ruSetup')).toBeHidden();
  await phone.evaluate(()=>{const g=ARCADE.RUMBLE,p=g.player(),v=g.state.fighters.find(f=>!f.player);g.state.fighters=[p,v];g.state.nextIn=999;Object.assign(p,{x:200,y:280,invuln:0});Object.assign(v,{x:245,y:280,invuln:0,age:2,stun:3,aiWait:999});});await phone.locator('#ruHitBtn').tap();await expect.poll(()=>phone.evaluate(()=>ARCADE.RUMBLE.state.score)).toBe(25);await phone.waitForTimeout(500);expect(await phone.evaluate(()=>ARCADE.RUMBLE.state.score)).toBe(25);await context.close();
});
test('a quick keyboard tap attacks immediately even between animation frames',async({page})=>{
  await controlled(page);const r=await page.evaluate(()=>{const g=ARCADE.RUMBLE;duel();const c=document.querySelector('#ruCanvas');c.focus();c.dispatchEvent(new KeyboardEvent('keydown',{key:'j',bubbles:true}));c.dispatchEvent(new KeyboardEvent('keyup',{key:'j',bubbles:true}));const began=g.player().action?.kind;advance(.5);return{began,score:g.state.score};});expect(r).toEqual({began:'light',score:25});
});
test('opening rivals fight each other and give the player room to learn the controls',async({page})=>{
  await controlled(page);const r=await page.evaluate(()=>{const g=ARCADE.RUMBLE;advance(6);return{hp:g.player().hp,rivals:g.state.fighters.filter(f=>!f.player).map(f=>f.hp),mode:g.state.mode};});expect(r.hp).toBe(100);expect(r.rivals.some(hp=>hp<100)).toBe(true);expect(r.mode).toBe('playing');
});

test('coach explains range, weakening, whipping and an available ring out',async({page})=>{await controlled(page);await page.evaluate(()=>{duel(100,400,265);ARCADE.RUMBLE.step(.05);});await expect(page.locator('#ruCoach')).toContainText('Move to the pink target');await page.evaluate(()=>{duel(100);ARCADE.RUMBLE.step(.05);});await expect(page.locator('#ruCoach')).toContainText('STRIKE');await page.evaluate(()=>{duel(25);ARCADE.RUMBLE.step(.05);});await expect(page.locator('#ruCoach')).toContainText('WHIP');await page.evaluate(()=>{const v=duel(25,85,280);Object.assign(ARCADE.RUMBLE.player(),{x:125,y:280});v.stun=2;ARCADE.RUMBLE.step(.05);});await expect(page.locator('#ruThrowBtn')).toContainText('TOSS OUT');await expect(page.locator('#ruTarget')).toContainText('25 HP');});
test('Irish whip travels smoothly to the ropes and leaves time for a follow-up',async({page})=>{await controlled(page);const r=await page.evaluate(()=>{const g=ARCADE.RUMBLE,v=duel();g.act('throw');advance(.5);const first=v.y;advance(.1);const middle=v.y;advance(.3);return{first,middle,end:v.y,stun:v.stun};});expect(r.first).toBeGreaterThan(265);expect(r.middle).toBeGreaterThan(r.first);expect(r.middle).toBeLessThan(337);expect(r.end).toBe(337);expect(r.stun).toBeGreaterThan(.5);});

test('narrow setup and result panels fit with a wider fallback font',async({page})=>{await page.setViewportSize({width:320,height:844});await page.addStyleTag({content:'#ruScreen *{font-family:Arial,sans-serif!important}'});for(const id of ['ruSetup','ruOver']){if(id==='ruOver')await page.evaluate(async()=>{const g=ARCADE.RUMBLE;await g.start();g.pause(true);g.state.mode='playing';g.state.queue=[];g.state.fighters=[g.player()];g.step(.05);});await expect(page.locator('#'+id)).toBeVisible();const sizes=await page.locator('#'+id).evaluate(el=>({outer:el.clientHeight,inner:el.firstElementChild.getBoundingClientRect().height}));expect(sizes.inner,id).toBeLessThanOrEqual(sizes.outer);}});
