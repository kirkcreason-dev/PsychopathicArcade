import {test,expect} from '@playwright/test';

for(const [game,module,prefix] of [['rumble','RUMBLE','ru'],['ladder','LADDER','lw']]){
  test.describe(`Big Foot in ${game}`,()=>{
    let errors;
    test.beforeEach(async({page})=>{
      errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto('/game.html');await page.waitForFunction(()=>window.ARCADE);
      await page.evaluate(game=>{ARCADE.Sound.on=false;ARCADE.showScreen(game);},game);
      await page.locator('#'+prefix+'Roster').selectOption('big-foot');
    });
    test.afterEach(()=>expect(errors).toEqual([]));

    test('selection persists and all reviewed moves face correctly offline',async({page,context})=>{
      await page.reload();await page.waitForFunction(()=>window.ARCADE);
      await page.evaluate(game=>{ARCADE.Sound.on=false;ARCADE.showScreen(game);},game);
      await expect(page.locator('#'+prefix+'Roster')).toHaveValue('big-foot');
      await expect(page.locator('#'+prefix+'Style')).toContainText('ONE-HANDED CHOKESLAM');
      await context.setOffline(true);
      const samples=await page.evaluate(async({module,prefix})=>{
        const g=ARCADE[module];await g.start();g.pause(true);
        const p=g.player(),art=g.roster.find(f=>f.id===p.id),ctx=document.querySelector('#'+prefix+'Canvas').getContext('2d'),draw=ctx.drawImage;
        g.state.fighters=[p];let seen;const results=[];
        ctx.drawImage=function(image,...args){if(image.src===art.src)seen={scale:this.getTransform().a,rect:args.slice(0,4),dest:args.slice(4)};return draw.call(this,image,...args);};
        try{
          for(const facing of [-1,1])for(const animation of ['idle','walk','light','heavy','down','climb','victory']){
            if(animation==='climb'&&module!=='LADDER')continue;
            const frames=art.animations[animation];
            for(let i=0;i<frames.length;i++){
              g.state.won=animation==='victory';
              Object.assign(p,{walk:animation==='walk',age:(i+.1)/(animation==='climb'?6:9),climbing:animation==='climb',climb:animation==='climb'?.6:0,action:['light','heavy','down'].includes(animation)?{kind:animation,t:(i+.1)/frames.length*(animation==='down'?.3:1),duration:1}:null,facing});
              seen=null;g.draw();const f=frames[i];results.push({animation,index:i,facing,seen,rect:[f.x,f.y,f.w,f.h],anchorY:f.anchorY});
            }
          }
        }finally{ctx.drawImage=draw;}
        return results;
      },{module,prefix});
      expect(samples.filter(s=>s.animation==='walk')).toHaveLength(12);
      for(const s of samples){
        expect(s.seen,JSON.stringify(s)).not.toBeNull();expect(s.seen.rect).toEqual(s.rect);
        const mirrored=s.animation==='light'&&[2,3].includes(s.index);
        expect(Math.sign(s.seen.scale)).toBe(mirrored?-s.facing:s.facing);
        // Feet stay at the fighter's ground position, independent of pose height.
        expect(s.seen.dest[1]+s.seen.dest[3]).toBeLessThan(2);
      }
      const prone=samples.find(s=>s.animation==='down'&&s.index===2);
      expect(prone.rect[2]).toBeGreaterThan(prone.rect[3]*3);
    });

    test('kick and chokeslam land once and respect charge and range',async({page})=>{
      const r=await page.evaluate(async module=>{
        const g=ARCADE[module];await g.start();g.pause(true);g.state.mode='playing';g.state.countdown=0;g.state.nextIn=999;
        const p=g.player(),v=g.state.fighters.find(f=>!f.player);g.state.fighters=[p,v];
        const reset=()=>{Object.assign(p,{x:220,y:300,hp:100,invuln:0,stun:0,cool:0,action:null});Object.assign(v,{x:260,y:300,hp:100,invuln:0,stun:0,cool:0,action:null,aiWait:999,think:999,guardOn:false,age:2});};
        const advance=n=>{for(let i=0;i<n;i++)g.step(.05);};
        reset();g.act('hit');advance(2);const windup=v.hp;advance(2);const hit=v.hp;advance(7);const afterKick=v.hp;
        reset();g.state.charge=100;const finish=g.act('finish'),repeat=g.act('finish');advance(7);const slammed=v.hp;advance(8);const afterSlam=v.hp;
        reset();v.x=405;g.state.charge=100;g.act('finish');advance(16);
        return{windup,hit,afterKick,finish,repeat,slammed,afterSlam,distant:v.hp,charge:g.state.charge};
      },module);
      expect(r.windup).toBe(100);expect(r.hit).toBeLessThan(100);expect(r.afterKick).toBe(r.hit);
      expect(r.finish).toBe(true);expect(r.repeat).toBe(false);expect(r.slammed).toBeLessThan(r.hit);expect(r.afterSlam).toBe(r.slammed);expect(r.distant).toBe(100);expect(r.charge).toBe(0);
    });

    test('health bar stays above his head at the front of the ring',async({page})=>{
      const positions=await page.evaluate(async({module,prefix})=>{
        const g=ARCADE[module];await g.start();g.pause(true);const p=g.player(),art=g.roster.find(f=>f.id===p.id);
        g.state.fighters=[p];Object.assign(p,{x:240,y:module==='LADDER'?407:337});
        const ctx=document.getElementById(prefix+'Canvas').getContext('2d'),draw=ctx.drawImage,rect=ctx.fillRect,positions={};
        ctx.drawImage=function(image,...args){if(image.src===art.src)positions.top=this.getTransform().transformPoint({x:args[4],y:args[5]}).y;return draw.call(this,image,...args);};
        ctx.fillRect=function(x,y,w,h){if(x===p.x-22&&w===44&&h===4)positions.barBottom=y+h;return rect.call(this,x,y,w,h);};
        try{g.draw();}finally{ctx.drawImage=draw;ctx.fillRect=rect;}
        return positions;
      },{module,prefix});
      expect(positions.top-positions.barBottom).toBeGreaterThanOrEqual(3);
    });

    test('completes a solo match, saves a record and replays as Big Foot',async({page,context})=>{
      if(game==='rumble')await page.locator('#ruSize').selectOption('22');
      await context.setOffline(true);
      const result=await page.evaluate(async({module,game})=>{
        const g=ARCADE[module];await g.start();g.pause(true);g.state.mode='playing';g.state.countdown=0;
        const s=g.state,p=g.player(),allIds=[...s.fighters.map(f=>f.id),...s.queue];
        const advance=n=>{for(let i=0;i<n;i++)g.step(.05);};
        for(const f of s.fighters)if(!f.player)f.stun=999;
        if(game==='ladder'){
          g.act('throw');p.x=240;p.y=365;advance(7);g.act('throw');advance(7);g.act('throw');advance(100);
          for(let i=0;i<4;i++){p.cool=0;s.elapsed=0;g.act('throw');}
        }else{
          s.queue=[];s.fighters=[p];s.kills=21;s.score=10500;g.step(.05);
        }
        return{allIds,won:s.won,mode:s.mode,score:s.score,wins:s.wins,id:p.id};
      },{module,game});
      expect(result.id).toBe('big-foot');expect(result.won).toBe(true);expect(result.mode).toBe('over');expect(result.wins).toBe(1);expect(result.score).toBeGreaterThan(3000);
      if(game==='rumble'){expect(result.allIds).toHaveLength(22);expect(new Set(result.allIds).size).toBe(22);}
      await page.locator('#'+prefix+'SaveBtn').click();await page.locator('#lbInitials').fill('BIG');await page.locator('#lbSaveBtn').click();await page.locator('#lbClose').click();
      expect(await page.evaluate(game=>ARCADE.LB.board(game).length,game)).toBe(1);
      await page.locator('#'+prefix+'AgainBtn').click();await expect(page.locator('#'+prefix+'Setup')).toBeHidden();
      expect(await page.evaluate(module=>({id:ARCADE[module].player().id,score:ARCADE[module].state.score}),module)).toEqual({id:'big-foot',score:0});
    });
  });
}
