import { test, expect } from '@playwright/test';

const games = [
  ['ladder','cardLW','lwScreen'],
  ['rumble','cardRU','ruScreen'],
  ['chicken','cardKH','khScreen'],
  ['claw','cardCL','clScreen'],
  ['shooter','cardSH','shScreen'],
  ['ttt','cardTTT','tttScreen'], ['chess','cardChess','chessScreen'],
  ['checkers','cardCheckers','checkersScreen'], ['faygo','cardFaygo','faygoScreen'],
  ['pinball','cardPinball','pinballScreen'], ['bj','cardBJ','bjScreen'],
  ['memory','cardMM','mmScreen'], ['camper','cardGC','gcScreen'],
  ['solitaire','cardSO','soScreen'], ['j31','cardJ31','j31Screen'], ['hockey','cardAH','ahScreen'],
];
let errors;
test.beforeEach(async ({page}) => {
  errors=[];
  page.on('pageerror', error=>errors.push(error.message));
  await page.goto('/game.html');
  await page.waitForFunction(()=>window.ARCADE);
  await page.evaluate(()=>{ ARCADE.Sound.on=false; ARCADE.T.scale=.02; });
});
test.afterEach(()=>expect(errors).toEqual([]));

for (const width of [1440, 390, 320]) {
  test(`all sixteen games open and fit at ${width}px`, async ({page})=>{
    await page.setViewportSize({width, height:900});
    for(const [name, card, screen] of games){
      await page.locator('#'+card).click();
      await expect(page.locator('#'+screen)).toBeVisible();
      await expect(page.locator('.screen:visible')).toHaveCount(1);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name).toBe(true);
      await page.evaluate(()=>ARCADE.showScreen('menu'));
    }
  });
}
test('production entry embeds the arcade with a title and permits zoom',async({page})=>{
  await page.goto('/');
  await expect(page.locator('iframe')).toHaveAttribute('title', /Psychopathic Arcade/);
  await expect(page.frameLocator('iframe').locator('#menuScreen')).toBeVisible();
  expect(await page.locator('meta[name="viewport"]').getAttribute('content')).not.toContain('user-scalable=no');
});

test('tic tac slam restart cancels the old pinfall and intro',async({page})=>{
  await page.evaluate(()=>{ARCADE.showScreen('ttt'); ARCADE.TTT.setMode('2p');});
  await page.waitForFunction(()=>ARCADE.TTT.state.state==='playing');
  await page.evaluate(()=>{
    const g=ARCADE.TTT;
    [0,3,1,4,2].forEach(g.place);
    g.newMatch(); g.newMatch();
  });
  await page.waitForFunction(()=>ARCADE.TTT.state.state==='playing');
  await page.waitForTimeout(180);
  expect(await page.evaluate(()=>({board:ARCADE.TTT.state.board,scores:ARCADE.TTT.state.scores})))
    .toEqual({board:Array(9).fill(''),scores:{X:0,O:0,D:0}});
  await expect(page.locator('#victory')).toBeHidden();
  await expect(page.locator('#introOverlay')).toBeHidden();
});
test('champion tic tac slam cannot lose from any legal human line',async({page})=>{
  const losses=await page.evaluate(()=>{
    const g=ARCADE.TTT; g.state.diff='champion'; let losses=0;
    function walk(board){
      const w=g.winner(board); if(w){if(w.side==='X') losses++; return;}
      for(let i=0;i<9;i++)if(!board[i]){
        const b=board.slice(); b[i]='X'; const win=g.winner(b);
        if(win){if(win.side==='X') losses++; continue;}
        g.state.board=b; const move=g.cpuPick(); b[move]='O'; walk(b);
      }
    }
    walk(Array(9).fill('')); return losses;
  });
  expect(losses).toBe(0);
});
for(const game of ['ttt','chess','checkers','faygo']){
  test(`${game}: switching to local play cancels a pending CPU move`,async({page})=>{
    await page.evaluate(game=>ARCADE.showScreen(game),game);
    if(game==='ttt') await page.waitForFunction(()=>ARCADE.TTT.state.state==='playing');
    const before=await page.evaluate(game=>{
      ARCADE.T.scale=.2;
      if(game==='ttt'){const g=ARCADE.TTT;g.place(0);g.setMode('2p');return JSON.stringify(g.state.board);}
      if(game==='chess'){const g=ARCADE.CHESS;g.exec({from:'e2',to:'e4'});g.setMode('2p');return g.game.fen();}
      if(game==='checkers'){const g=ARCADE.CHECKERS;g.exec(g.allMoves(g.board,'A')[0]);g.setMode('2p');return JSON.stringify(g.board);}
      const g=ARCADE.FAYGO;g.doDrop(0);g.setMode('2p');return JSON.stringify(g.grid);
    },game);
    await page.waitForTimeout(350);
    const after=await page.evaluate(game=>{
      if(game==='ttt')return JSON.stringify(ARCADE.TTT.state.board);
      if(game==='chess')return ARCADE.CHESS.game.fen();
      if(game==='checkers')return JSON.stringify(ARCADE.CHECKERS.board);
      return JSON.stringify(ARCADE.FAYGO.grid);
    },game);
    expect(after).toBe(before);
  });
}

test('chess: legal rules include castling, en passant and promotion',async({page})=>{
  const result=await page.evaluate(()=>{
    const g=ARCADE.CHESS.game;
    g.load('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const castle=g.move('O-O');
    g.load('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
    const ep=g.move('exd6'); const captured=g.get('d5');
    g.load('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
    const promotion=g.move({from:'a7',to:'a8',promotion:'n'});
    return {castle:castle.flags,ep:ep.flags,captured,promotion:promotion.promotion};
  });
  expect(result).toEqual({castle:'k',ep:'e',captured:null,promotion:'n'});
});
test('chess: restart cancels a delayed checkmate overlay',async({page})=>{
  await page.evaluate(()=>{
    ARCADE.showScreen('chess');const g=ARCADE.CHESS;g.setMode('2p');
    for(const [from,to] of [['f2','f3'],['e7','e5'],['g2','g4'],['d8','h4']])g.exec({from,to});
    g.newGame();
  });
  await page.waitForTimeout(200);
  await expect(page.locator('#chVictory')).toBeHidden();
  expect(await page.evaluate(()=>ARCADE.CHESS.game.history())).toEqual([]);
});
test('chess: a cancelled search cannot change the new board',async({page})=>{
  await page.evaluate(()=>{
    ARCADE.showScreen('chess'); const g=ARCADE.CHESS;g.setMode('2p');
    g.exec({from:'e2',to:'e4'});g.exec({from:'e7',to:'e5'});
    ARCADE.T.scale=1;
    window.searchDone=g.searchBest(3000);
    setTimeout(()=>g.newGame(),0);
  });
  await page.evaluate(()=>window.searchDone);
  expect(await page.evaluate(()=>ARCADE.CHESS.game.fen())).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
});
test('chess: new game closes promotion without applying an old move',async({page})=>{
  await page.evaluate(()=>{
    ARCADE.showScreen('chess'); const g=ARCADE.CHESS;g.setMode('2p');
    g.game.load('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
    g.clickSq('a7');g.clickSq('a8');
  });
  await expect(page.locator('#promoModal')).toBeVisible();
  await page.evaluate(()=>ARCADE.CHESS.newGame());
  await expect(page.locator('#promoModal')).toBeHidden();
  expect(await page.evaluate(()=>ARCADE.CHESS.game.history())).toEqual([]);
});

test('checkers: multi-jump locks input, can be undone and preserves pieces',async({page})=>{
  const data=await page.evaluate(()=>{
    ARCADE.showScreen('checkers');const g=ARCADE.CHECKERS;g.setMode('2p');
    const b=Array(64).fill(null);b[40]={c:'A',k:false,art:0};b[33]={c:'B',k:false,art:0};b[19]={c:'B',k:false,art:0};b[1]={c:'B',k:false,art:0};
    g.state.board=b;g.render();const moves=g.allMoves(b,'A');
    g.exec(moves[0]); const locked=g.state.state;
    g.exec(moves[0]); g.undo();
    return {locked,captures:moves[0].caps.length};
  });
  expect(data).toEqual({locked:'moving',captures:2});
  await page.waitForTimeout(120);
  expect(await page.evaluate(()=>({count:ARCADE.CHECKERS.board.filter(Boolean).length,state:ARCADE.CHECKERS.state.state})))
    .toEqual({count:4,state:'playing'});
});
test('checkers: serialized online moves still promote a man',async({page})=>{
  expect(await page.evaluate(async()=>{
    ARCADE.showScreen('checkers');const g=ARCADE.CHECKERS;g.setMode('2p');
    g.state.board=Array(64).fill(null);g.state.board[17]={c:'A',k:false,art:0};g.state.board[10]={c:'B',k:false,art:0};
    const m=g.allMoves(g.board,'A')[0];await g.exec({from:m.from,path:m.path,caps:m.caps});
    return g.board[m.path.at(-1)[0]*8+m.path.at(-1)[1]].k;
  })).toBe(true);
});
test('faygo: full columns do not cancel the speed timer',async({page})=>{
  await page.evaluate(()=>{
    ARCADE.showScreen('faygo');const g=ARCADE.FAYGO;g.setMode('2p');g.setGmode('speed');g.newMatch();
    const b=Array.from({length:6},()=>Array(8).fill(0));for(let r=0;r<6;r++)b[r][0]=r%2+1;
    g.debug.set(b);g.doDrop(0);
  });
  await expect(page.locator('#fgTimer')).toBeVisible();
  await page.waitForTimeout(170);
  expect(await page.evaluate(()=>ARCADE.FAYGO.state.timerV)).toBeLessThan(6);
});
test('faygo: a mode change starts a consistent round and cancels a win',async({page})=>{
  await page.evaluate(()=>{
    ARCADE.showScreen('faygo');const g=ARCADE.FAYGO;g.setMode('2p');
    [0,1,0,1,0,1,0].forEach(g.doDrop);g.setGmode('party');
  });
  await page.waitForTimeout(160);
  await expect(page.locator('#fgVictory')).toBeHidden();
  expect(await page.evaluate(()=>({pieces:ARCADE.FAYGO.grid.flat().filter(Boolean).length,powers:ARCADE.FAYGO.state.pow[1]})))
    .toEqual({pieces:0,powers:{bomb:true,wild:true}});
});

test('blackjack: jokers and aces choose the highest legal total',async({page})=>{
  const values=await page.evaluate(()=>[
    ['A','10','JOKER'],['A','A','JOKER'],['10','10','JOKER'],['K','Q','2'],['A','A','9'],['JOKER','JOKER'],
  ].map(hand=>ARCADE.BLACKJACK.totals(hand.map(r=>({r,s:'h',joker:r==='JOKER'}))).total));
  expect(values).toEqual([21,21,21,22,21,21]);
});
test('blackjack: repeated stand settles a round only once',async({page})=>{
  await page.evaluate(async()=>{
    ARCADE.showScreen('bj');const g=ARCADE.BLACKJACK;g.newGame();
    g.state.shoe=Array.from({length:20},(_,i)=>({r:i===19?'10':i===18?'10':i===17?'9':i===16?'7':'2',s:'h',joker:false}));
    await g.deal();g.stand();g.stand();g.stand();
  });
  await page.waitForFunction(()=>ARCADE.BLACKJACK.state.state==='idle');
  expect(await page.evaluate(()=>ARCADE.BLACKJACK.state.points)).toBe(1250);
});
test('blackjack: restart during hole-card reveal cannot award an old result',async({page})=>{
  await page.evaluate(async()=>{
    ARCADE.showScreen('bj'); const g=ARCADE.BLACKJACK;g.newGame();
    g.state.shoe=Array.from({length:20},(_,i)=>({r:i>=16?'10':'K',s:'h',joker:false}));
    await g.deal();ARCADE.T.scale=.2;g.hit();
    setTimeout(()=>g.newGame(),110);
  });
  await page.waitForTimeout(350);
  expect(await page.evaluate(()=>({points:ARCADE.BLACKJACK.state.points,state:ARCADE.BLACKJACK.state.state})))
    .toEqual({points:1000,state:'idle'});
});

test('pinball: restart cancels an outstanding ball bonus',async({page})=>{
  await page.evaluate(()=>{
    ARCADE.showScreen('pinball');const g=ARCADE.PINBALL;g.startGame(1);g.setActive(false);
    g.state.save.on=false;g.state.bonusUnits=8;g.debug.setBall(245,910,0,100);g.step(.02);
    g.startGame(1);
  });
  await page.waitForTimeout(200);
  expect(await page.evaluate(()=>({score:ARCADE.PINBALL.state.score,ball:ARCADE.PINBALL.state.cur.ball})))
    .toEqual({score:[0,0],ball:1});
});
test('pinball: losing keyboard focus releases held controls',async({page})=>{
  await page.evaluate(()=>ARCADE.showScreen('pinball'));
  await page.locator('#pbStartBtn').click();
  await page.keyboard.down('ArrowLeft'); await page.keyboard.down('Space');
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  expect(await page.evaluate(()=>({left:ARCADE.PINBALL.state.flippers.L.pressed,charge:ARCADE.PINBALL.state.charging})))
    .toEqual({left:false,charge:false});
  await page.keyboard.up('ArrowLeft');await page.keyboard.up('Space');
});
test('air hockey: returning from the menu resumes the match',async({page})=>{
  await page.evaluate(()=>ARCADE.showScreen('hockey'));
  await page.locator('#ahStartBtn').click();
  await page.waitForTimeout(80);
  const elapsed=await page.evaluate(()=>{const t=ARCADE.AIRHOCKEY.state.elapsed; ARCADE.showScreen('menu'); return t;});
  await page.waitForTimeout(80);
  expect(await page.evaluate(()=>ARCADE.AIRHOCKEY.state.elapsed)).toBe(elapsed);
  await page.evaluate(()=>ARCADE.showScreen('hockey'));
  await expect.poll(()=>page.evaluate(()=>ARCADE.AIRHOCKEY.state.elapsed)).toBeGreaterThan(elapsed);
});
test('air hockey: a goal increments one score and serves a new puck',async({page})=>{
  const result=await page.evaluate(()=>{
    ARCADE.showScreen('hockey');const g=ARCADE.AIRHOCKEY;g.start();g.leave();g.state.paused=false;g.state.serveT=0;
    g.debug.setPuck(0,g.debug.W/2,g.debug.RINK.t-20,0,-400);g.step(.016);
    return {score:g.state.score,pucks:g.state.pucks.length};
  });
  expect(result).toEqual({score:[1,0],pucks:1});
});
test('camper: pause freezes simulation and resume preserves the run',async({page})=>{
  await page.evaluate(()=>ARCADE.showScreen('camper'));
  await page.locator('#gcStartBtn').click();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('p');
  const distance=await page.evaluate(()=>ARCADE.CAMPER.state.dist);
  await page.waitForTimeout(100);
  expect(await page.evaluate(()=>ARCADE.CAMPER.state.dist)).toBe(distance);
  await page.locator('#gcResumeBtn').click();
  await expect.poll(()=>page.evaluate(()=>ARCADE.CAMPER.state.dist)).toBeGreaterThan(distance);
  expect(await page.evaluate(()=>ARCADE.CAMPER.state.lane)).toBe(0);
});

test('solitaire: moving to a foundation and undoing restores the bankroll',async({page})=>{
  const result=await page.evaluate(()=>{
    ARCADE.showScreen('solitaire');const g=ARCADE.SOLITAIRE;const initial=g.state.vegas;
    g.debug.set({stock:[],waste:[{r:'A',s:'h'}],tab:[[],[],[],[],[],[],[]],found:{h:[],d:[],c:[],s:[]}});
    g.moveTo({k:'waste'},{k:'found',suit:'h'});g.undo();
    return {bank:g.state.vegas,initial,waste:g.state.waste,foundation:g.state.found.h,moves:g.state.moves};
  });
  expect(result.bank).toBe(result.initial);expect(result.waste).toEqual([{r:'A',s:'h'}]);expect(result.foundation).toEqual([]);expect(result.moves).toBe(0);
});
test('solitaire: face-down cards and moves during autocomplete are rejected',async({page})=>{
  const results=await page.evaluate(()=>{
    ARCADE.showScreen('solitaire');const g=ARCADE.SOLITAIRE;
    g.debug.set({tab:[[{card:{r:'K',s:'h'},up:false}],[],[],[],[],[],[]]});
    const down=g.moveTo({k:'tab',col:0,idx:0},{k:'tab',col:1});
    g.state.state='auto';g.state.waste=[{r:'A',s:'h'}];
    const busy=g.moveTo({k:'waste'},{k:'found',suit:'h'});return {down,busy};
  });
  expect(results).toEqual({down:false,busy:false});
});
for(const [game,key] of [['memory','MEMORY'],['solitaire','SOLITAIRE']]){
  test(`${game}: elapsed time excludes time spent in the menu`,async({page})=>{
    await page.evaluate(game=>ARCADE.showScreen(game),game);await page.waitForTimeout(80);
    const elapsed=await page.evaluate(key=>{ARCADE.showScreen('menu');return ARCADE[key].state.elapsed;},key);
    await page.waitForTimeout(650);
    expect(await page.evaluate(key=>ARCADE[key].state.elapsed,key)).toBe(elapsed);
    await page.evaluate(game=>ARCADE.showScreen(game),game);
    await expect.poll(()=>page.evaluate(key=>ARCADE[key].state.elapsed,key)).toBeGreaterThan(elapsed);
  });
}
test('memory: complete a solo level and advance to a larger board',async({page})=>{
  await page.evaluate(async()=>{
    ARCADE.showScreen('memory');const g=ARCADE.MEMORY;
    const pairs={};g.deck.forEach((c,i)=>(pairs[c.f]??=[]).push(i));
    for(const pair of Object.values(pairs)){await g.flip(pair[0]);await g.flip(pair[1]);}
  });
  await expect(page.locator('#mmVictory')).toBeVisible();
  await page.locator('#mmNextBtn').click();
  expect(await page.evaluate(()=>({level:ARCADE.MEMORY.state.level,cards:ARCADE.MEMORY.deck.length}))).toEqual({level:1,cards:16});
});
test('memory: restarting a mismatch never changes the new deck',async({page})=>{
  await page.evaluate(()=>{
    ARCADE.showScreen('memory');const g=ARCADE.MEMORY;
    g.flip(0);g.flip(g.deck.findIndex(c=>c.f!==g.deck[0].f));g.newGame();
  });
  await page.waitForTimeout(150);
  expect(await page.evaluate(()=>({up:ARCADE.MEMORY.state.up,moves:ARCADE.MEMORY.state.moves,lock:ARCADE.MEMORY.state.lock})))
    .toEqual({up:[],moves:0,lock:false});
});
test('31: suit totals and three of a kind use the documented values',async({page})=>{
  expect(await page.evaluate(()=>[
    [],[{r:'A',s:'h'},{r:'K',s:'h'},{r:'Q',s:'h'}],
    [{r:'7',s:'h'},{r:'7',s:'d'},{r:'7',s:'c'}],
    [{r:'A',s:'h'},{r:'K',s:'s'},{r:'Q',s:'s'}],
  ].map(ARCADE.J31.handValue))).toEqual([0,31,30.5,20]);
});
test('31: restart cancels a delayed blitz settlement',async({page})=>{
  await page.evaluate(()=>{
    ARCADE.showScreen('j31');const g=ARCADE.J31;g.state.token++;
    g.debug.setTurn(0);g.state.state='playing';g.state.phase='discard';
    g.state.players[0].hand=[{r:'A',s:'h'},{r:'K',s:'h'},{r:'Q',s:'h'},{r:'2',s:'s'}];
    g.discard(3);g.newTable();g.state.token++; // hold CPU actions while checking the new deal
  });
  await page.waitForTimeout(200);
  expect(await page.evaluate(()=>ARCADE.J31.state.players.map(p=>p.lives))).toEqual([3,3,3]);
  await expect(page.locator('#j31Showdown')).toBeHidden();
});
test('31: out-of-turn and showdown inputs cannot change hands',async({page})=>{
  expect(await page.evaluate(()=>{
    ARCADE.showScreen('j31');const g=ARCADE.J31;g.state.token++;g.debug.setTurn(0);
    const wrong=g.drawFrom('stock',1);g.state.state='showdown';
    return [wrong,g.drawFrom('stock'),g.knock()];
  })).toEqual([false,false,false]);
});
test('stored scores with invalid types do not crash any game or records',async({page})=>{
  await page.evaluate(()=>{
    for(const [key,value] of Object.entries({pa_lb:{ttt:'broken',chess:[null,{v:null}]},pa_bj_points:null,pa_bj_high:'oops',pa_bj_badges:[],pa_mm_best:{},pa_gc_best:'oops',pa_ah_streak:null,pa_ah_puck:'missing',pa_so_draw:99,pa_so_best:null,pa_j31_streak0:[]}))localStorage.setItem(key,JSON.stringify(value));
  });
  await page.reload();await page.waitForFunction(()=>window.ARCADE);
  await page.evaluate(()=>{
    ARCADE.Sound.on=false;
    for(const name of ['bj','memory','camper','hockey','solitaire','j31'])ARCADE.showScreen(name);
    ARCADE.LB.show('ttt');
  });
  await expect(page.locator('#lbModal')).toBeVisible();
  expect(await page.evaluate(()=>ARCADE.SOLITAIRE.state.draw)).toBe(3);
});
test('keyboard shortcuts do not play behind a help dialog',async({page})=>{
  await page.evaluate(()=>ARCADE.showScreen('solitaire'));
  await page.locator('#soHowBtn').click();
  const before=await page.evaluate(()=>ARCADE.SOLITAIRE.state.moves);
  await page.keyboard.press('Space');await page.keyboard.press('n');
  expect(await page.evaluate(()=>ARCADE.SOLITAIRE.state.moves)).toBe(before);
  await expect(page.locator('#soHow')).toBeVisible();
});

test('phone runner controls stay beside the playfield and on screen',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>ARCADE.showScreen('camper'));
  await expect(page.locator('#gcMid #gcTouch')).toBeVisible();
  const bounds=await page.locator('#gcTouch').boundingBox();
  expect(bounds.y+bounds.height).toBeLessThan(844);
  await page.setViewportSize({width:1440,height:1000});
  await expect(page.locator('#gcScreen > .ctl-row #gcTouch')).toBeVisible();
});
test('badge notification stays hidden until a badge is earned',async({page})=>{
  await expect(page.locator('#bjBadgeToast')).toBeHidden();
});
test('mute preference survives a reload and labels reflect the setting',async({page})=>{
  await page.evaluate(()=>{ARCADE.showScreen('solitaire');ARCADE.Sound.on=true;});
  await page.locator('#soSoundBtn').click();
  await expect(page.locator('#soSoundBtn')).toHaveAttribute('aria-label','Enable sound');
  await page.reload();await page.waitForFunction(()=>window.ARCADE);
  expect(await page.evaluate(()=>ARCADE.Sound.on)).toBe(false);
});
test('solitaire: stock can be activated with Enter',async({page})=>{
  await page.evaluate(()=>ARCADE.showScreen('solitaire'));
  await page.locator('#soBoard [data-slot="stock"]').focus();await page.keyboard.press('Enter');
  expect(await page.evaluate(()=>ARCADE.SOLITAIRE.state.waste.length)).toBe(3);
});
test('online packets cannot move the local player or leave input blocked',async({page})=>{
  expect(await page.evaluate(()=>{
    ARCADE.showScreen('faygo');const g=ARCADE.FAYGO;g.setMode('2p');
    ARCADE.NET.debug.fakeSession('faygo','host');
    ARCADE.NET.debug.handle({t:'mv',g:'faygo',d:{c:0}});
    const pieces=g.grid.flat().filter(Boolean).length;
    const applying=ARCADE.NET.state.applying;
    ARCADE.NET.debug.endFake();return {pieces,applying};
  })).toEqual({pieces:0,applying:false});
});
