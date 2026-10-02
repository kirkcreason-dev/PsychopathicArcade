import {test, expect} from '@playwright/test';
let errors;

test.beforeEach(async({page})=>{
  errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/game.html');
  await page.waitForFunction(()=>window.ARCADE);
  await page.evaluate(()=>{ ARCADE.Sound.on=false; ARCADE.showScreen('camper'); });
});
test.afterEach(()=>expect(errors).toEqual([]));

async function frozenRun(page){
  await page.evaluate(()=>{
    const g=ARCADE.CAMPER; g.start(); g.leave();
    Object.assign(g.state,{paused:false,nextObs:1e6,nextItem:1e6,nextPow:1e6,nextDecor:1e6});
    document.querySelector('#gcPause').hidden=true;
  });
}

test('the welcome gate does not freeze the animation after 380 metres, even offline',async({page,context})=>{
  await page.setViewportSize({width:390,height:844});
  await context.setOffline(true);
  await page.locator('#gcStartBtn').click();
  await page.evaluate(()=>{
    const s=ARCADE.CAMPER.state;
    Object.assign(s,{dist:379.9,nextDecor:0});
    s.powers.hatchet=999;
  });
  await expect.poll(()=>page.evaluate(()=>ARCADE.CAMPER.state.dist)).toBeGreaterThan(405);
  expect(errors).toEqual([]);
});

test('an extended offline run renders repeated gates, pickups and the score',async({page,context})=>{
  await frozenRun(page);
  await context.setOffline(true);
  // Start the first gate so its embedded sprite decodes before accelerated play.
  await page.evaluate(()=>{
    const g=ARCADE.CAMPER;
    Object.assign(g.state,{dist:379.9,nextDecor:0,nextObs:0,nextItem:0,nextPow:0});
    for(let i=0;i<20;i++) g.step(.05);
    g.draw();
  });
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const result=await page.evaluate(()=>{
    const g=ARCADE.CAMPER;
    let gates=0,previous=g.state.lastGate;
    for(let i=0;i<3600;i++){
      g.state.powers.hatchet=999;
      g.step(.05);
      // Sample rendering every 300ms of simulated time. Every gate stays in
      // view for several seconds; drawing 3,600 queued frames only saturates
      // software-rendered WebKit on CI without adding coverage.
      if(i%6===0) g.draw();
      if(g.state.lastGate!==previous){ gates++;previous=g.state.lastGate; }
    }
    return {state:g.state.state,dist:g.state.dist,score:g.state.score,gates};
  });
  expect(result.state).toBe('run');
  expect(result.dist).toBeGreaterThan(3500);
  expect(result.score).toBeGreaterThan(0);
  expect(result.gates).toBeGreaterThanOrEqual(7);
});

test('a cleared obstacle cannot hit behind the runner after landing',async({page})=>{
  await frozenRun(page);
  const result=await page.evaluate(()=>{
    const g=ARCADE.CAMPER;
    Object.assign(g.state,{jumpT:.45,dist:1800,speed:26});
    const obstacle={key:'log',lane:1,z:.1,def:{j:1,s:0,img:'gc_ob_log',name:'LOG'}};
    g.debug.spawn(obstacle); g.step(.01);
    const cleared=g.state.hearts;
    g.state.jumpT=-1; g.step(.01);
    return {cleared,after:g.state.hearts,resolved:obstacle.resolved};
  });
  expect(result).toEqual({cleared:3,after:3,resolved:true});
});

test('fatal collision stops scoring and item collection immediately',async({page})=>{
  await frozenRun(page);
  const result=await page.evaluate(()=>{
    const g=ARCADE.CAMPER; g.state.hearts=1;
    g.debug.spawn({key:'tent',lane:1,z:.05,def:{j:0,s:0,img:'gc_ob_tent1',name:'TENT'}});
    const item={kind:'fay',img:'mm_card_riddlebox',lane:1,z:.05,taken:false};
    g.debug.item(item);g.step(.02);
    return {state:g.state.state,taken:item.taken,score:Math.round(g.state.score),display:Number(document.querySelector('#gcOverScore').textContent.replaceAll(',',''))};
  });
  expect(result.state).toBe('over'); expect(result.taken).toBe(false); expect(result.score).toBe(result.display);
});

test('generated rows always leave a reachable lane and recovery time',async({page})=>{
  await frozenRun(page);
  const failures=await page.evaluate(()=>{
    const g=ARCADE.CAMPER, failures=[]; let seed=47;
    const random=Math.random; Math.random=()=>{ seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296; };
    try {
      for(let i=0;i<600;i++){
        g.state.dist=i*10;g.state.speed=Math.min(26,11+i/13);g.state.obs=[];g.state.items=[];
        const before=g.state.safeLane;g.debug.spawnRow();
        if(g.state.obs.length>2 || g.state.obs.some(o=>o.lane===g.state.safeLane) ||
          Math.abs(g.state.safeLane-before)>1 || g.state.nextObs/g.state.speed<1.1) failures.push(i);
      }
    } finally { Math.random=random; }
    return failures;
  });
  expect(failures).toEqual([]);
});

test('swipe responds before release and changes only one lane',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.locator('#gcStartBtn').click();
  const rect=await page.locator('#gcCanvas').boundingBox();
  const x=rect.x+rect.width/2,y=rect.y+rect.height*.6;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x-45,y);
  expect(await page.evaluate(()=>ARCADE.CAMPER.state.lane)).toBe(0);
  await page.mouse.move(x+70,y);await page.mouse.up();
  expect(await page.evaluate(()=>ARCADE.CAMPER.state.lane)).toBe(0);
});

test('touch control responds on press and cancelled swipes do nothing',async({page})=>{
  await page.locator('#gcStartBtn').click();
  await page.locator('#gcRightBtn').scrollIntoViewIfNeeded();
  const box=await page.locator('#gcRightBtn').boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  expect(await page.evaluate(()=>ARCADE.CAMPER.state.lane)).toBe(2);await page.mouse.up();
  await page.locator('#gcCanvas').scrollIntoViewIfNeeded();
  const canvas=await page.locator('#gcCanvas').boundingBox();
  const x=canvas.x+canvas.width/2,y=canvas.y+canvas.height*.6;
  await page.mouse.move(x,y);await page.mouse.down();
  await page.locator('#gcCanvas').dispatchEvent('pointercancel',{pointerId:1});
  await page.mouse.move(x-55,y);await page.mouse.up();
  expect(await page.evaluate(()=>ARCADE.CAMPER.state.lane)).toBe(2);
});

test('late action is buffered and blur pauses without losing progress',async({page})=>{
  await frozenRun(page);
  const result=await page.evaluate(()=>{
    const g=ARCADE.CAMPER;g.state.slideT=.77;g.jump();g.step(.04);
    const jumped=g.state.jumpT>=0;window.dispatchEvent(new Event('blur'));
    const distance=g.state.dist;g.step(.05);
    return {jumped,paused:g.state.paused,frozen:g.state.dist===distance};
  });
  expect(result).toEqual({jumped:true,paused:true,frozen:true});
  await expect(page.locator('#gcPause')).toBeVisible();
});

test('repaired selection and play sprites decode with transparent sampling margins',async({page})=>{
  const result=await page.evaluate(async()=>{
    const keys=['gc_appicon','gc_logo','gc_ob_cart1','gc_ob_porta1','gc_ob_cooler3','gc_pu_shield','ah_puck1','ah_puck2','ah_puck3','ck_a0','ck_b7'];
    const failures=[];
    for(const key of keys){
      const im=new Image();im.src=ARCADE.ASSETS.img[key];await im.decode();
      const c=document.createElement('canvas');c.width=im.naturalWidth;c.height=im.naturalHeight;
      const ctx=c.getContext('2d');ctx.drawImage(im,0,0);const d=ctx.getImageData(0,0,c.width,c.height).data;
      if(c.width<40 || c.height<40) failures.push(key+':too small');
      for(let x=0;x<c.width;x++) if(d[x*4+3] || d[((c.height-1)*c.width+x)*4+3]) failures.push(key+':vertical cut');
      for(let y=0;y<c.height;y++) if(d[(y*c.width)*4+3] || d[(y*c.width+c.width-1)*4+3]) failures.push(key+':horizontal cut');
    }
    return failures;
  });
  expect(result).toEqual([]);
});
