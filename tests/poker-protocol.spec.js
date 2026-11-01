import {test,expect} from '@playwright/test';

// Deterministically control packet delivery around reconnect and hand boundaries.
// Actual WebRTC connection coverage lives in poker-online.spec.js.
async function table(browser,baseURL){
  const host=await browser.newPage(),join=await browser.newPage(),errors=[];
  for(const [page,role] of [[host,'host'],[join,'join']]){
    page.on('pageerror',error=>errors.push(error.message));await page.goto(baseURL+'/game.html');await page.waitForFunction(()=>window.ARCADE?.POKER);
    await page.evaluate(role=>{
      ARCADE.Sound.on=false;window.protocolPackets=[];
      ARCADE.NET.push=(game,packet)=>{if(game==='poker')protocolPackets.push(JSON.parse(JSON.stringify(packet)));};
      ARCADE.NET.debug.fakeSession('poker',role);ARCADE.showScreen('poker');ARCADE.POKER.netStart(role);
    },role);
  }
  const take=page=>page.evaluate(()=>protocolPackets.splice(0));
  const deliver=(page,packet)=>page.evaluate(packet=>ARCADE.POKER.netApply(packet),packet);
  const pump=async()=>{
    for(let round=0;round<25;round++){
      const a=await take(host),b=await take(join);if(!a.length&&!b.length)return;
      for(const packet of a)await deliver(join,packet);for(const packet of b)await deliver(host,packet);
    }
    throw new Error('Poker packet exchange did not settle.');
  };
  await pump();await host.evaluate(()=>ARCADE.POKER.ready());await join.evaluate(()=>ARCADE.POKER.ready());await pump();
  for(const page of [host,join])expect(await page.evaluate(()=>ARCADE.POKER.state.stage)).toBe('preflop');
  const close=async()=>{try{expect(errors).toEqual([]);}finally{await host.close();await join.close();}};
  return{host,join,take,deliver,pump,close};
}

test('reconnect requires a fresh snapshot barrier and rejects an old guest resume',async({browser,baseURL})=>{
  const t=await table(browser,baseURL),{host,join}=t;
  try{
    await join.evaluate(()=>ARCADE.POKER.pause(true));await t.pump();
    await join.evaluate(()=>ARCADE.POKER.pause(false));const oldResume=(await t.take(join)).find(p=>p.k==='pause');expect(oldResume.paused).toBe(false);
    const initial=await host.evaluate(()=>({revision:ARCADE.POKER.state.revision,stacks:ARCADE.POKER.state.players.map(p=>p.stack)}));
    for(const page of [host,join])await page.evaluate(()=>ARCADE.POKER.netConnection('disconnected'));
    await host.evaluate(()=>ARCADE.POKER.netConnection('connected'));await join.evaluate(()=>ARCADE.POKER.netConnection('connected'));
    // The host's first reconnect snapshot predates the guest's fresh barrier.
    for(const packet of await t.take(host))await t.deliver(join,packet);
    expect(await join.evaluate(()=>ARCADE.POKER.netState().synced)).toBe(false);await expect(join.locator('#pkResumeBtn')).toBeDisabled();
    await t.deliver(host,oldResume);expect(await host.evaluate(()=>ARCADE.POKER.netState().pauses)).toEqual([true,true]);
    await t.pump();expect(await join.evaluate(()=>ARCADE.POKER.netState().synced)).toBe(true);
    expect(await join.evaluate(()=>ARCADE.POKER.netState().epoch)).toBeGreaterThan(oldResume.epoch);
    await host.evaluate(()=>ARCADE.POKER.pause(false));await t.pump();
    await t.deliver(host,oldResume);await t.pump();
    for(const page of [host,join])expect(await page.evaluate(()=>({paused:ARCADE.POKER.state.paused,pauses:ARCADE.POKER.netState().pauses}))).toEqual({paused:true,pauses:[false,true]});
    await join.evaluate(()=>ARCADE.POKER.pause(false));await t.pump();
    for(const page of [host,join])expect(await page.evaluate(()=>({paused:ARCADE.POKER.state.paused,revision:ARCADE.POKER.state.revision,stacks:ARCADE.POKER.state.players.map(p=>p.stack)}))).toEqual({paused:false,...initial});
  }finally{await t.close();}
});

test('impossible street, bet and pot snapshots never replace the guest’s valid table',async({browser,baseURL})=>{
  const t=await table(browser,baseURL),{host,join}=t;
  try{
    await host.evaluate(()=>{ARCADE.POKER.pause(true);ARCADE.POKER.pause(false);});
    const correct=(await t.take(host)).at(-1);
    const corruptions=[
      s=>{s.view.stage='flop';s.view.board=[];},
      s=>{s.view.currentBet=2000;},
      s=>{s.view.players[0].contributed++;},
      s=>{s.view.players[0].bet=s.view.players[0].contributed+1;},
      s=>{s.view.players[1]=null;},
      s=>{s.view.bigBlind=0;},
    ];
    for(let i=0;i<corruptions.length;i++){
      const bad=structuredClone(correct);bad.seq+=100+i;corruptions[i](bad);
      const result=await join.evaluate(packet=>{const g=ARCADE.POKER,before=JSON.stringify(g.state),seq=g.netState().rx;g.netApply(packet);return{same:JSON.stringify(g.state)===before,sameSequence:g.netState().rx===seq};},bad);
      expect(result).toEqual({same:true,sameSequence:true});
    }
    await t.deliver(join,correct);expect(await join.evaluate(()=>ARCADE.POKER.netState().rx)).toBe(correct.seq);
    expect(await join.evaluate(()=>({stage:ARCADE.POKER.state.stage,board:ARCADE.POKER.state.board,currentBet:ARCADE.POKER.state.currentBet}))).toEqual({stage:'preflop',board:[],currentBet:20});
  }finally{await t.close();}
});

test('invalid payout or winner claims are rejected before a valid hand result is displayed',async({browser,baseURL})=>{
  const t=await table(browser,baseURL),{host,join}=t;
  try{
    expect(await host.evaluate(()=>ARCADE.POKER.act({type:'fold'}))).toBe(true);
    const correct=(await t.take(host)).at(-1);expect(correct.view.result.kind).toBe('fold');
    for(const mutate of [p=>{p.view.result.payouts[1]++;},p=>{p.view.result.handWinner=0;},p=>{p.view.matchWinner=1;}]){
      const bad=structuredClone(correct);bad.seq+=100;mutate(bad);
      const before=await join.evaluate(()=>JSON.stringify(ARCADE.POKER.state));await t.deliver(join,bad);expect(await join.evaluate(()=>JSON.stringify(ARCADE.POKER.state))).toBe(before);
    }
    await t.deliver(join,correct);expect(await join.evaluate(()=>({stage:ARCADE.POKER.state.stage,winner:ARCADE.POKER.state.result.handWinner,matchWinner:ARCADE.POKER.state.matchWinner}))).toEqual({stage:'over',winner:1,matchWinner:null});
    await expect(join.locator('#pkResultTitle')).toHaveText('YOU TAKE THE POT');
  }finally{await t.close();}
});

test('a pause in flight when the hand ends cannot leave the next hand secretly paused',async({browser,baseURL})=>{
  const t=await table(browser,baseURL),{host,join}=t;
  try{
    await join.evaluate(()=>ARCADE.POKER.pause(true));const latePause=(await t.take(join)).find(p=>p.k==='pause');
    expect(await host.evaluate(()=>ARCADE.POKER.act({type:'fold'}))).toBe(true);
    for(const packet of await t.take(host))await t.deliver(join,packet);
    expect(await join.evaluate(()=>ARCADE.POKER.state.mode)).toBe('hand-over');
    await t.deliver(host,latePause);await t.pump();
    expect(await join.evaluate(()=>ARCADE.POKER.netState().pending)).toBeNull();
    await host.evaluate(()=>ARCADE.POKER.ready());await join.evaluate(()=>ARCADE.POKER.ready());await t.pump();
    for(const page of [host,join])expect(await page.evaluate(()=>({hand:ARCADE.POKER.state.handNo,stage:ARCADE.POKER.state.stage,paused:ARCADE.POKER.state.paused,pauses:ARCADE.POKER.netState().pauses}))).toEqual({hand:2,stage:'preflop',paused:false,pauses:[false,false]});
    expect(await join.evaluate(()=>ARCADE.POKER.debug.humanTurn())).toBe(true);
    expect(await join.evaluate(()=>ARCADE.POKER.act({type:'call'}))).toBe(true);await t.pump();
    expect(await host.evaluate(()=>({turn:ARCADE.POKER.state.turn,stage:ARCADE.POKER.state.stage,pot:ARCADE.POKER.state.pot}))).toEqual({turn:0,stage:'preflop',pot:40});
  }finally{await t.close();}
});
