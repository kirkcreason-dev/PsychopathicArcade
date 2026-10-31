import { test, expect } from '@playwright/test';

for(const game of ['ttt','chess','checkers','faygo','memory','j31','hockey']){
  test(`online ${game}: two real peers connect and share moves`,async({browser,browserName,baseURL})=>{
    const host=await browser.newPage(), join=await browser.newPage();const errors=[];
    try{
      for(const page of [host,join]){
        page.on('pageerror',e=>errors.push(e.message));
        await page.goto(baseURL+'/game.html');
        await page.waitForFunction(()=>window.ARCADE);
        await page.evaluate(browserName=>{
          ARCADE.Sound.on=false;ARCADE.T.scale=.02;
          let seed=982451653;
          Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
          if(browserName==='chromium'){
            const RTC=window.RTCPeerConnection;
            window.RTCPeerConnection=class extends RTC{constructor(){super({iceServers:[]});}};
          }
        },browserName);
      }
      const offer=await host.evaluate(async game=>{ARCADE.NET.state.game=game;return ARCADE.NET.hostCreate();},game);
      const answer=await join.evaluate(offer=>ARCADE.NET.joinAccept(offer),offer);
      await host.evaluate(answer=>ARCADE.NET.hostConnect(answer),answer);
      for(const page of [host,join])await page.waitForFunction(()=>ARCADE.NET.state.session);
      if(game==='ttt'){
        for(const page of [host,join])await page.waitForFunction(()=>ARCADE.TTT.state.state==='playing');
        await host.evaluate(()=>ARCADE.TTT.humanCell(0));
        await join.waitForFunction(()=>ARCADE.TTT.state.board[0]==='X');
        await join.evaluate(()=>ARCADE.TTT.humanCell(4));
        await host.waitForFunction(()=>ARCADE.TTT.state.board[4]==='O');
      }else if(game==='chess'){
        await host.evaluate(()=>{ARCADE.CHESS.clickSq('e2');ARCADE.CHESS.clickSq('e4');});
        await join.waitForFunction(()=>ARCADE.CHESS.game.turn()==='b');
        await join.evaluate(()=>{ARCADE.CHESS.clickSq('e7');ARCADE.CHESS.clickSq('e5');});
        await host.waitForFunction(()=>ARCADE.CHESS.game.history().length===2);
        expect(await host.evaluate(()=>ARCADE.CHESS.game.fen())).toBe(await join.evaluate(()=>ARCADE.CHESS.game.fen()));
      }else if(game==='checkers'){
        for(const [page,other,color] of [[host,join,'A'],[join,host,'B']]){
          const before=await page.evaluate(()=>ARCADE.CHECKERS.state.moveCount);
          await page.evaluate(color=>{const g=ARCADE.CHECKERS,m=g.allMoves(g.board,color)[0];g.clickSq(...m.from);g.clickSq(...m.path.at(-1));},color);
          await other.waitForFunction(before=>ARCADE.CHECKERS.state.moveCount>before,before);
        }
        const position=p=>p.evaluate(()=>ARCADE.CHECKERS.board.map(v=>v?{c:v.c,k:v.k}:null));
        expect(await position(host)).toEqual(await position(join));
      }else if(game==='faygo'){
        await host.evaluate(()=>ARCADE.FAYGO.humanDrop(0));
        await join.waitForFunction(()=>ARCADE.FAYGO.state.turn===2);
        await join.evaluate(()=>ARCADE.FAYGO.humanDrop(1));
        await host.waitForFunction(()=>ARCADE.FAYGO.grid[5][1]===2);
      }else if(game==='memory'){
        await join.waitForFunction(()=>ARCADE.MEMORY.state.mode==='2p' && ARCADE.MEMORY.deck.length===16);
        expect(await host.evaluate(()=>ARCADE.MEMORY.debug.reveal())).toEqual(await join.evaluate(()=>ARCADE.MEMORY.debug.reveal()));
        await host.evaluate(()=>{const g=ARCADE.MEMORY;g.humanFlip(0);g.humanFlip(g.deck.findIndex(c=>c.f!==g.deck[0].f));});
        for(const page of [host,join])await page.waitForFunction(()=>ARCADE.MEMORY.state.turn===2 && !ARCADE.MEMORY.state.lock);
        await join.evaluate(()=>{const g=ARCADE.MEMORY;g.humanFlip(0);g.humanFlip(g.deck.findIndex((c,i)=>i>0&&c.f===g.deck[0].f));});
        await host.waitForFunction(()=>ARCADE.MEMORY.state.found===1);
      }else if(game==='j31'){
        await join.waitForFunction(()=>ARCADE.J31.state.viewOnly && ARCADE.J31.state.players[0].hand.length===3);
        expect(await join.evaluate(()=>ARCADE.J31.state.turn)).toBe(1);
        await host.locator('#j31Stock').click();
        await host.evaluate(()=>ARCADE.J31.discard(0));
        await join.waitForFunction(()=>ARCADE.J31.state.turn===0);
        await join.locator('#j31Stock').click();
        await host.waitForFunction(()=>ARCADE.J31.state.players[1].hand.length===4);
        await join.evaluate(()=>ARCADE.NET.report('j31',{a:'i',t:'discard',i:0}));
        await host.waitForFunction(()=>ARCADE.J31.state.turn===0);
        expect(await host.evaluate(()=>ARCADE.J31.state.players[1].hand)).toEqual(await join.evaluate(()=>ARCADE.J31.state.players[0].hand));
      }else{
        await join.evaluate(()=>ARCADE.NET.report('hockey',{k:'pad',x:130,y:200}));
        await host.waitForFunction(()=>ARCADE.AIRHOCKEY.state.pads[1].x===130);
        await host.evaluate(()=>{const g=ARCADE.AIRHOCKEY;g.state.serveT=0;g.debug.setPuck(0,g.debug.W/2,g.debug.RINK.t-20,0,-400);});
        await join.waitForFunction(()=>ARCADE.AIRHOCKEY.state.score[1]===1);
      }
      expect(errors).toEqual([]);
    }finally{await host.close();await join.close();}
  });
}

for(const game of ['rumble','ladder','shooter','chicken','claw'])test(`online ${game}: ready, shared round, pause, rematch and disconnect`,async({browser,baseURL})=>{
  const host=await browser.newPage(),join=await browser.newPage(),errors=[];const wrestling=['rumble','ladder'].includes(game),module={rumble:'RUMBLE',ladder:'LADDER',shooter:'SHOOTER',chicken:'CHICKEN',claw:'CLAW'}[game],pfx={rumble:'ru',ladder:'lw'}[game];
  try{
    for(const page of [host,join]){page.on('pageerror',e=>errors.push(e.message));await page.goto(baseURL+'/game.html');await page.waitForFunction(()=>window.ARCADE);await page.evaluate(()=>{ARCADE.Sound.on=false;const RTC=window.RTCPeerConnection;window.RTCPeerConnection=class extends RTC{constructor(){super({iceServers:[]});}};});}
    const offer=await host.evaluate(async g=>{ARCADE.NET.state.game=g;return ARCADE.NET.hostCreate();},game),answer=await join.evaluate(o=>ARCADE.NET.joinAccept(o),offer);await host.evaluate(a=>ARCADE.NET.hostConnect(a),answer);
    for(const page of [host,join])await page.waitForFunction(()=>ARCADE.NET.state.session);
    if(wrestling){await host.locator('#'+pfx+'Roster').selectOption('big-foot');await join.locator('#'+pfx+'Roster').selectOption('big-foot');}
    const ready=async p=>p.locator(wrestling?'#'+pfx+'StartBtn':'#duelReady').click();await ready(host);expect(await host.evaluate(m=>ARCADE[m].state.mode,module)).not.toBe('playing');await ready(join);
    for(const page of [host,join])await page.waitForFunction(m=>ARCADE[m].state.mode==='playing',module);
    if(game==='ladder'){
      for(const page of [host,join])await page.evaluate(()=>{window.ladderReports=[];window.__arcSend=d=>{if(d.ev==='ladder')window.ladderReports.push(d);};});
      for(const page of [host,join]){await expect(page.locator('#lwCountdown')).toBeVisible();expect(await page.evaluate(()=>ARCADE.LADDER.state.elapsed)).toBe(0);}
      const positions=await host.evaluate(()=>ARCADE.LADDER.state.fighters.map(f=>[f.x,f.y]));await host.waitForTimeout(150);
      expect(await host.evaluate(()=>ARCADE.LADDER.state.fighters.map(f=>[f.x,f.y]))).toEqual(positions);
      for(const page of [host,join])await page.waitForFunction(()=>ARCADE.LADDER.state.countdown===0);
    }
    if(wrestling){
      for(const page of [host,join])expect(await page.evaluate(m=>ARCADE[m].state.fighters.map(f=>f.id),module)).toEqual(['big-foot','big-foot']);
      expect(await join.evaluate(m=>ARCADE[m].player().uid,module)).toBe('p2');await join.locator('#'+pfx+'Canvas').press('ArrowLeft');await join.evaluate(m=>{const c=document.getElementById(m==='RUMBLE'?'ruCanvas':'lwCanvas');c.focus();c.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));},module);await host.waitForFunction(m=>ARCADE[m].state.fighters[1].x<300,module);await join.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowLeft',bubbles:true})));
    }else if(game==='claw')expect(await host.evaluate(()=>ARCADE.CLAW.state.prizes.map(p=>p.item.id))).toEqual(await join.evaluate(()=>ARCADE.CLAW.state.prizes.map(p=>p.item.id)));
    await join.evaluate(({m,w})=>w?ARCADE[m].pause(true):ARCADE.DUELS.pause(true),{m:module,w:wrestling});for(const page of [host,join])await page.waitForFunction(m=>ARCADE[m].state.mode==='paused',module);
    await host.evaluate(({m,w})=>w?ARCADE[m].pause(true):ARCADE.DUELS.pause(true),{m:module,w:wrestling});
    if(wrestling)await expect(host.locator('#'+pfx+'RestartBtn')).toBeHidden();
    const elapsed=await host.evaluate(m=>ARCADE[m].state.elapsed??ARCADE[m].state.clock??ARCADE[m].state.time,module);await host.waitForTimeout(150);expect(await host.evaluate(m=>ARCADE[m].state.elapsed??ARCADE[m].state.clock??ARCADE[m].state.time,module)).toBe(elapsed);
    await join.evaluate(({m,w})=>w?ARCADE[m].pause():ARCADE.DUELS.pause(false),{m:module,w:wrestling});await host.waitForTimeout(100);expect(await host.evaluate(m=>ARCADE[m].state.mode,module)).toBe('paused');await host.evaluate(({m,w})=>w?ARCADE[m].pause():ARCADE.DUELS.pause(false),{m:module,w:wrestling});for(const page of [host,join])await page.waitForFunction(m=>ARCADE[m].state.mode==='playing',module);
    if(wrestling){await host.evaluate(({m,g})=>{const a=ARCADE[m],s=a.state,p=s.fighters[0],v=s.fighters[1];for(const f of s.fighters)Object.assign(f,{action:null,stun:0,cool:0,invuln:0,guardOn:false});if(g==='rumble'){Object.assign(p,{x:80,y:280,hp:20});Object.assign(v,{x:120,y:280});}else{Object.assign(s.ladder,{x:240,y:365,open:true,carrier:null});Object.assign(v,{climbing:true,climb:1,climbSide:1,pulls:3,ladderMisses:2,ladderFalls:1,ladderTips:3});s.elapsed=-1.3/4.1+Math.PI/4.1+.18;}}, {m:module,g:game});await join.evaluate(({m,g})=>{if(g==='ladder'){const n=ARCADE[m].netState();ARCADE.NET.push(g,{k:'input',round:n.round,seq:++n.inputSeq,x:0,y:0,action:'throw',grabAt:(Math.PI-1.3)/4.1});}else ARCADE[m].act('throw');},{m:module,g:game});for(const page of [host,join])await page.waitForFunction(m=>ARCADE[m].state.mode==='over',module);expect(await join.evaluate(m=>ARCADE[m].state.won,module)).toBe(true);expect(await host.evaluate(m=>ARCADE[m].state.won,module)).toBe(false);if(game==='ladder'){const results=await Promise.all([host,join].map(page=>page.evaluate(()=>window.ladderReports)));expect(results[0]).toHaveLength(1);expect(results[1]).toHaveLength(1);expect(results[0][0]).toMatchObject({won:false,online:true,misses:0,falls:0,tips:0});expect(results[1][0]).toMatchObject({won:true,online:true,grabs:4,misses:2,falls:1,tips:3,roster:'big-foot'});}await Promise.all([join.locator('#'+pfx+'AgainBtn').click(),host.locator('#'+pfx+'AgainBtn').click()]);
    }else{
      await host.evaluate(m=>{ARCADE[m].state.score=300;},module);await join.waitForFunction(()=>ARCADE.DUELS.state().peerScore===300);await host.evaluate(m=>{ARCADE[m].state.score=100;},module);await join.waitForFunction(()=>ARCADE.DUELS.state().peerScore===100);
      for(const [page,score] of [[host,100],[join,200]])await page.evaluate(({m,score})=>{ARCADE[m].pause(true);ARCADE[m].state.mode='over';ARCADE[m].state.score=score;},{m:module,score});for(const page of [host,join])await page.waitForFunction(()=>ARCADE.DUELS.state().phase==='over');await expect(join.locator('#duelTitle')).toHaveText('YOU WIN THE SHOWDOWN');await Promise.all([join.locator('#duelAgain').click(),host.locator('#duelAgain').click()]);for(const page of [host,join])await page.waitForFunction(()=>ARCADE.DUELS.state().phase==='lobby');await Promise.all([ready(host),ready(join)]);
    }
    for(const page of [host,join])await page.waitForFunction(m=>ARCADE[m].state.mode==='playing',module);
    await join.evaluate(()=>ARCADE.NET.leave());await host.waitForFunction(()=>!ARCADE.NET.state.session);expect(await host.evaluate(({m,w})=>w?ARCADE[m].netState():ARCADE.DUELS.state(),{m:module,w:wrestling})).toBe(null);expect(errors).toEqual([]);
  }finally{await host.close();await join.close();}
});

test('online pool: ready, authorized shots, placement, called eight, pause and rematch',async({browser,baseURL})=>{
  test.setTimeout(75000);
  const host=await browser.newPage(),join=await browser.newPage(),errors=[];
  const waitBoth=async predicate=>{for(const page of [host,join])await page.waitForFunction(predicate);};
  const settle=async()=>host.evaluate(()=>{const g=ARCADE.POOL;g.debug.stop();for(let i=0;i<1200&&g.state.mode==='rolling';i++)g.step(.05);g.draw();return{mode:g.state.mode,turn:g.state.turn,shots:g.state.stats.map(s=>s.shots)};});
  const table=page=>page.evaluate(()=>{const s=ARCADE.POOL.state;return{mode:s.mode,turn:s.turn,groups:s.groups,break:s.break,ballInHand:s.ballInHand,winner:s.winner,scores:s.scores,stats:s.stats,balls:s.balls.map(b=>({id:b.id,x:b.x,y:b.y,vx:b.vx,vy:b.vy,pocketed:b.pocketed}))};});
  try{
    for(const page of [host,join]){
      page.on('pageerror',e=>errors.push(e.message));await page.goto(baseURL+'/game.html');await page.waitForFunction(()=>window.ARCADE?.POOL);
      await page.evaluate(()=>{ARCADE.Sound.on=false;const RTC=window.RTCPeerConnection;window.RTCPeerConnection=class extends RTC{constructor(){super({iceServers:[]});}};});
    }
    const records=await Promise.all([host,join].map(page=>page.evaluate(()=>({wins:ARCADE.POOL.state.wins,best:ARCADE.POOL.state.best}))));
    const offer=await host.evaluate(()=>{ARCADE.NET.state.game='pool';return ARCADE.NET.hostCreate();});
    const answer=await join.evaluate(offer=>ARCADE.NET.joinAccept(offer),offer);await host.evaluate(answer=>ARCADE.NET.hostConnect(answer),answer);
    await waitBoth(()=>ARCADE.NET.state.session&&ARCADE.POOL.netState()?.phase==='lobby');
    await host.locator('#plStartBtn').click();expect(await host.evaluate(()=>ARCADE.POOL.state.mode)).toBe('ready');
    await join.locator('#plStartBtn').click();await waitBoth(()=>ARCADE.POOL.state.mode==='aiming'&&ARCADE.POOL.netState().round===1);
    expect(await table(host)).toEqual(await table(join));
    expect(await join.evaluate(()=>ARCADE.POOL.shoot({angle:0,power:1}))).toBe(false);

    // The host's legitimate break is simulated once and reaches both peers.
    expect(await host.evaluate(()=>ARCADE.POOL.shoot({angle:.004,power:1}))).toBe(true);
    await join.waitForFunction(()=>ARCADE.POOL.state.mode==='rolling');
    expect(await settle()).toMatchObject({mode:'aiming',turn:1,shots:[1,0]});
    await join.waitForFunction(()=>ARCADE.POOL.state.mode==='aiming'&&ARCADE.POOL.state.turn===1&&ARCADE.POOL.state.stats[0].shots===1);
    expect(await table(host)).toEqual(await table(join));

    // Missing/null shot fields must not borrow the host's current aim defaults.
    const before=await table(host),remoteRequest=await host.evaluate(()=>ARCADE.POOL.netState().remoteRequest);
    await join.evaluate(()=>{const n=ARCADE.POOL.netState();for(const payload of [{},{angle:null,power:.5,calledPocket:null},{angle:0,power:2,calledPocket:null},{angle:0,power:.5,calledPocket:'1'}])ARCADE.NET.push('pool',{k:'shot',round:n.round,request:n.requests+1,...payload});});
    await host.waitForTimeout(120);expect(await table(host)).toEqual(before);expect(await host.evaluate(()=>ARCADE.POOL.netState().remoteRequest)).toBe(remoteRequest);

    // Malformed snapshots cannot crash the guest or change local CPU records.
    await host.evaluate(()=>{
      const g=ARCADE.POOL,n=g.netState(),s=g.state;
      const state={mode:s.mode,playMode:'online',balls:s.balls.map(b=>({id:b.id,x:b.x,y:b.y,vx:b.vx,vy:b.vy,pocketed:b.pocketed})),turn:s.turn,groups:s.groups,break:s.break,scores:s.scores,stats:s.stats,calledPocket:s.calledPocket,ballInHand:s.ballInHand,winner:s.winner,notice:s.notice,seed:s.seed,elapsed:s.elapsed,resumeMode:s.resumeMode||null};
      const send=state=>ARCADE.NET.push('pool',{k:'frame',round:n.round,seq:++n.tx,state,pauses:n.pauses});
      send({...state,balls:state.balls.map((b,i)=>i===4?null:b)});
      send({...state,mode:'over',winner:0,playMode:'cpu'});
      send({...state,wins:900,best:999999,resultSaved:true,saved:true});
    });
    await join.waitForTimeout(120);
    expect(await join.evaluate(()=>({wins:ARCADE.POOL.state.wins,best:ARCADE.POOL.state.best}))).toEqual(records[1]);
    expect(await join.evaluate(()=>({mode:ARCADE.POOL.state.playMode,saved:ARCADE.POOL.state.saved,resultSaved:ARCADE.POOL.state.resultSaved}))).toEqual({mode:'online',saved:false,resultSaved:false});

    // Both players can hold a pause; releasing one must not resume the other.
    await join.evaluate(()=>ARCADE.POOL.pause(true));await waitBoth(()=>ARCADE.POOL.state.mode==='paused');
    await host.evaluate(()=>ARCADE.POOL.pause(true));
    expect(await join.evaluate(()=>ARCADE.POOL.shoot({angle:0,power:.5}))).toBe(false);
    const paused=await table(host);await host.waitForTimeout(100);expect(await table(host)).toEqual(paused);
    await join.evaluate(()=>ARCADE.POOL.pause(false));await host.waitForTimeout(100);expect(await host.evaluate(()=>ARCADE.POOL.state.mode)).toBe('paused');
    await host.evaluate(()=>ARCADE.POOL.pause(false));await waitBoth(()=>ARCADE.POOL.state.mode==='aiming');

    // A short miss gives host placement; a second miss gives guest placement.
    expect(await join.evaluate(()=>ARCADE.POOL.shoot({angle:Math.PI,power:.05}))).toBe(true);
    await host.waitForFunction(()=>ARCADE.POOL.state.mode==='rolling');await settle();
    await waitBoth(()=>ARCADE.POOL.state.mode==='aiming'&&ARCADE.POOL.state.turn===0&&ARCADE.POOL.state.ballInHand);
    expect(await host.evaluate(()=>ARCADE.POOL.place(400,400))).toBe(true);
    await join.waitForFunction(()=>!ARCADE.POOL.state.ballInHand&&ARCADE.POOL.state.balls.find(b=>b.id===0).x===400);
    expect(await host.evaluate(()=>ARCADE.POOL.shoot({angle:Math.PI,power:.05}))).toBe(true);await settle();
    await waitBoth(()=>ARCADE.POOL.state.mode==='aiming'&&ARCADE.POOL.state.turn===1&&ARCADE.POOL.state.ballInHand);
    expect(await join.evaluate(()=>ARCADE.POOL.place(70,85))).toBe(false);
    expect(await join.evaluate(()=>ARCADE.POOL.place(450,400))).toBe(true);
    await waitBoth(()=>!ARCADE.POOL.state.ballInHand&&ARCADE.POOL.state.balls.find(b=>b.id===0).x===450);
    expect(await table(host)).toEqual(await table(join));

    // The called-eight decision is still made from actual host-side physics.
    await host.evaluate(()=>{
      const g=ARCADE.POOL,s=g.state;g.debug.stop();
      for(const b of s.balls)Object.assign(b,{pocketed:b.id!==0&&b.id!==8,vx:0,vy:0});
      Object.assign(s.balls.find(b=>b.id===0),{x:500,y:300});Object.assign(s.balls.find(b=>b.id===8),{x:500,y:190});
      Object.assign(s,{mode:'aiming',groups:['solids','stripes'],turn:1,break:false,ballInHand:false,calledPocket:null,winner:null,notice:'Call your eight.'});
      g.pause(true);g.pause(false);
    });
    await join.waitForFunction(()=>ARCADE.POOL.state.mode==='aiming'&&ARCADE.POOL.rules.eligible8(ARCADE.POOL.state,1));
    expect(await join.evaluate(()=>ARCADE.POOL.shoot({angle:-Math.PI/2,power:.3}))).toBe(false);
    await join.locator('[data-pl-pocket="1"]').click();
    expect(await join.evaluate(()=>ARCADE.POOL.shoot({angle:-Math.PI/2,power:.3}))).toBe(true);
    await host.waitForFunction(()=>ARCADE.POOL.state.mode==='rolling');await settle();await waitBoth(()=>ARCADE.POOL.state.mode==='over');
    expect(await host.evaluate(()=>ARCADE.POOL.state.winner)).toBe(1);expect(await table(host)).toEqual(await table(join));
    await expect(join.locator('#plResultTitle')).toHaveText('THE TABLE IS YOURS');await expect(join.locator('#plSaveBtn')).toBeHidden();
    for(let i=0;i<2;i++)expect(await [host,join][i].evaluate(()=>({wins:ARCADE.POOL.state.wins,best:ARCADE.POOL.state.best}))).toEqual(records[i]);
    await join.locator('#plAgainBtn').click();expect(await join.evaluate(()=>ARCADE.POOL.state.mode)).toBe('over');
    await host.locator('#plAgainBtn').click();await waitBoth(()=>ARCADE.POOL.state.mode==='aiming'&&ARCADE.POOL.netState().round===2);
    expect(await join.evaluate(()=>ARCADE.POOL.state.turn)).toBe(1);expect(await table(host)).toEqual(await table(join));
    await join.evaluate(()=>ARCADE.NET.leave());await host.waitForFunction(()=>!ARCADE.NET.state.session&&ARCADE.POOL.netState()===null);
    expect(await host.evaluate(()=>ARCADE.POOL.state.mode)).toBe('ready');expect(errors).toEqual([]);
  }finally{await host.close();await join.close();}
});
