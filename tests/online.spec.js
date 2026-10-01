import { test, expect } from '@playwright/test';

for(const game of ['ttt','chess','checkers','faygo','memory','j31','hockey']){
  test(`online ${game}: two real peers connect and share moves`,async({browser,browserName})=>{
    const host=await browser.newPage(), join=await browser.newPage();const errors=[];
    try{
      for(const page of [host,join]){
        page.on('pageerror',e=>errors.push(e.message));
        await page.goto('http://127.0.0.1:4173/game.html');
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
