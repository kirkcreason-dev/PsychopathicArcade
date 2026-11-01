import {test,expect} from '@playwright/test';

async function pagesFor(browser,baseURL){
  const pages=[await browser.newPage(),await browser.newPage()],errors=[];
  for(const page of pages){
    page.on('pageerror',e=>errors.push(e.message));await page.goto(baseURL+'/game.html');await page.waitForFunction(()=>window.POKER_READY);
    await page.evaluate(()=>{ARCADE.Sound.on=false;const RTC=window.RTCPeerConnection;window.RTCPeerConnection=class extends RTC{constructor(){super({iceServers:[]});}};ARCADE.showScreen('poker');
      const push=ARCADE.NET.push;window.pokerPackets=[];window.rawPokerPush=push;window.mutateNextPoker=null;
      ARCADE.NET.push=(game,data)=>{if(game==='poker'){pokerPackets.push(JSON.parse(JSON.stringify(data)));if(data.k==='pause'&&window.dropNextPokerPause){window.dropNextPokerPause=false;window.delayedPokerPause=JSON.parse(JSON.stringify(data));return;}if(data.k==='action'&&mutateNextPoker){const change=mutateNextPoker;mutateNextPoker=null;window.changedPokerPacket=JSON.parse(JSON.stringify(data));if(change==='drop')return;if(change==='stale')data={...data,revision:data.revision-1};if(change==='seat')data={...data,seat:0};}}return push(game,data);};
    });
  }
  return{host:pages[0],join:pages[1],pages,errors};
}
async function manualConnect(host,join){
  const offer=await host.evaluate(()=>{ARCADE.NET.state.game='poker';return ARCADE.NET.hostCreate();});const answer=await join.evaluate(offer=>ARCADE.NET.joinAccept(offer),offer);await host.evaluate(answer=>ARCADE.NET.hostConnect(answer),answer);
  for(const page of [host,join])await page.waitForFunction(()=>ARCADE.NET.state.session&&ARCADE.POKER.netState()?.synced);
}
async function readyPair(host,join,button='pkStartBtn'){
  await host.locator('#'+button).click();await join.locator('#'+button).click();
  for(const page of [host,join])await page.waitForFunction(()=>ARCADE.POKER.state.mode==='playing'&&!ARCADE.POKER.netState().pending);
}
function publicTable(page){return page.evaluate(()=>{const s=ARCADE.POKER.state;return{stage:s.stage,turn:s.turn,board:s.board,pot:s.pot,handNo:s.handNo,revision:s.revision,players:s.players.map(p=>({stack:p.stack,bet:p.bet,folded:p.folded,allIn:p.allIn})),winner:s.matchWinner};});}

test('manual poker answer remains usable after more than fifteen seconds of copying',async({browser,baseURL})=>{
  const{host,join,pages,errors}=await pagesFor(browser,baseURL);
  try{
    const offer=await host.evaluate(()=>{ARCADE.NET.state.game='poker';return ARCADE.NET.hostCreate();});
    await join.clock.install();const answer=await join.evaluate(offer=>ARCADE.NET.joinAccept(offer),offer);await join.clock.fastForward(20000);
    expect(await join.evaluate(()=>!!ARCADE.NET.state.pc)).toBe(true);await host.evaluate(answer=>ARCADE.NET.hostConnect(answer),answer);
    for(const page of pages)await page.waitForFunction(()=>ARCADE.NET.state.session&&ARCADE.POKER.netState()?.synced);
    await readyPair(host,join);expect(await publicTable(host)).toEqual(await publicTable(join));expect(errors).toEqual([]);
  }finally{for(const page of pages)await page.close();}
});

test('poker peers keep hidden hands private and recover dropped, stale and duplicate moves',async({browser,baseURL})=>{
  test.setTimeout(60000);const{host,join,pages,errors}=await pagesFor(browser,baseURL);
  try{
    await manualConnect(host,join);await host.locator('#pkStartBtn').click();expect(await host.evaluate(()=>ARCADE.POKER.state.stage)).toBe('ready');await join.locator('#pkStartBtn').click();
    for(const page of pages)await page.waitForFunction(()=>ARCADE.POKER.state.mode==='playing'&&!ARCADE.POKER.netState().pending);
    for(const page of pages){const s=await page.evaluate(()=>ARCADE.POKER.state);expect(s.players[1-s.seat].hand).toEqual([null,null]);expect(s.players[s.seat].hand.every(Number.isInteger)).toBe(true);await expect(page.locator('#pkOppCards .pk-back')).toHaveCount(2);}
    const outgoing=await host.evaluate(()=>pokerPackets.filter(p=>p.k==='snapshot').at(-1));expect(outgoing.view.seat).toBe(1);expect(outgoing.view.players[0].hand).toEqual([null,null]);
    expect(JSON.stringify(outgoing)).not.toMatch(/"(?:deck|deckIndex|burned|rng|seed)"/);expect(await publicTable(host)).toEqual(await publicTable(join));
    const validTable=await publicTable(join);
    await host.evaluate(()=>{const original=pokerPackets.filter(p=>p.k==='snapshot').at(-1);for(const view of [{...original.view,stage:'flop',board:[],turn:1,currentBet:2000},{...original.view,players:[null,original.view.players[1]]}])rawPokerPush('poker',{...original,seq:original.seq+1,view});});
    await join.waitForTimeout(80);expect(await publicTable(join)).toEqual(validTable);
    expect(await join.evaluate(()=>ARCADE.POKER.act({type:'fold'}))).toBe(false);
    await host.locator('#pkCallBtn').click();await join.waitForFunction(()=>ARCADE.POKER.state.turn===1);
    const revision=await host.evaluate(()=>ARCADE.POKER.state.revision);
    await join.evaluate(()=>{mutateNextPoker='drop';ARCADE.POKER.act({type:'check'});});expect(await join.evaluate(()=>!!ARCADE.POKER.netState().pending)).toBe(true);
    await host.waitForFunction(revision=>ARCADE.POKER.state.revision>revision,revision);await join.waitForFunction(()=>!ARCADE.POKER.netState().pending);
    expect(await publicTable(host)).toEqual(await publicTable(join));
    const afterRetry=await host.evaluate(()=>ARCADE.POKER.state.revision);await join.evaluate(()=>rawPokerPush('poker',changedPokerPacket));await host.waitForTimeout(80);expect(await host.evaluate(()=>ARCADE.POKER.state.revision)).toBe(afterRetry);
    // Guest acts first after the flop. Reject two malformed versions, then accept.
    for(const change of ['stale','seat']){
      await join.evaluate(change=>{mutateNextPoker=change;ARCADE.POKER.act({type:'check'});},change);await join.waitForFunction(()=>!ARCADE.POKER.netState().pending);
      expect(await host.evaluate(()=>ARCADE.POKER.state.revision)).toBe(afterRetry);await expect(join.locator('#pkCallBtn')).toBeEnabled();
    }
    await join.locator('#pkCallBtn').click();await host.waitForFunction(()=>ARCADE.POKER.state.turn===0);
    // A pause travelling as the hand ends must not stick to the following hand.
    await join.evaluate(()=>{window.dropNextPokerPause=true;ARCADE.POKER.pause(true);});await host.locator('#pkFoldBtn').click();
    for(const page of pages)await page.waitForFunction(()=>ARCADE.POKER.state.mode==='hand-over');
    await join.evaluate(()=>rawPokerPush('poker',delayedPokerPause));await join.waitForFunction(()=>!ARCADE.POKER.netState().pending);
    expect(await publicTable(host)).toEqual(await publicTable(join));for(const page of pages)await expect(page.locator('#pkOppCards .pk-back')).toHaveCount(2);
    await readyPair(host,join,'pkNextBtn');expect(await host.evaluate(()=>ARCADE.POKER.state.dealer)).toBe(1);
    expect(errors).toEqual([]);
  }finally{for(const page of pages)await page.close();}
});

test('poker peers finish matches, ready for rematches, pause together and abort disconnects',async({browser,baseURL})=>{
  test.setTimeout(60000);const{host,join,pages,errors}=await pagesFor(browser,baseURL);
  try{
    await manualConnect(host,join);await readyPair(host,join);
    await join.evaluate(()=>ARCADE.POKER.pause(true));for(const page of pages)await page.waitForFunction(()=>ARCADE.POKER.state.mode==='paused');
    await host.evaluate(()=>ARCADE.POKER.pause(true));await join.evaluate(()=>ARCADE.POKER.pause(false));await host.waitForTimeout(80);expect(await host.evaluate(()=>ARCADE.POKER.state.mode)).toBe('paused');
    await host.evaluate(()=>ARCADE.POKER.pause(false));for(const page of pages)await page.waitForFunction(()=>ARCADE.POKER.state.mode==='playing');
    for(let hand=0;hand<6;hand++){
      const turn=await host.evaluate(()=>ARCADE.POKER.state.turn),actor=pages[turn],other=pages[1-turn];
      await actor.locator('#pkAllInBtn').click();await other.waitForFunction(()=>ARCADE.POKER.state.turn===ARCADE.POKER.state.seat);await other.locator('#pkCallBtn').click();
      for(const page of pages)await page.waitForFunction(()=>ARCADE.POKER.state.stage==='over');
      if(await host.evaluate(()=>ARCADE.POKER.state.matchWinner!==null))break;await readyPair(host,join,'pkNextBtn');
    }
    expect(await host.evaluate(()=>ARCADE.POKER.state.matchWinner)).not.toBeNull();expect(await publicTable(host)).toEqual(await publicTable(join));
    for(const page of pages){await expect(page.locator('#pkSaveBtn')).toBeHidden();const s=await page.evaluate(()=>ARCADE.POKER.state);expect(s.wins).toBe(0);expect(s.players.map(p=>p.stack).sort((a,b)=>a-b)).toEqual([0,2000]);await expect(page.locator('#pkOppCards .pk-back')).toHaveCount(0);}
    await host.locator('#pkAgainBtn').click();expect(await host.evaluate(()=>ARCADE.POKER.state.mode)).toBe('over');await join.locator('#pkAgainBtn').click();
    for(const page of pages)await page.waitForFunction(()=>ARCADE.POKER.netState().round===2&&ARCADE.POKER.state.mode==='playing');
    expect(await host.evaluate(()=>ARCADE.POKER.state.dealer)).toBe(1);
    // A brief transport interruption freezes the table and needs both resumes.
    await join.evaluate(()=>{window.dropNextPokerPause=true;ARCADE.POKER.pause(false);});
    for(const page of pages)await page.evaluate(()=>ARCADE.POKER.netConnection('disconnected'));
    expect(await join.evaluate(()=>ARCADE.POKER.act({type:'fold'}))).toBe(false);
    for(const page of pages)await page.evaluate(()=>ARCADE.POKER.netConnection('connected'));
    for(const page of pages)await page.waitForFunction(()=>ARCADE.POKER.state.mode==='paused'&&ARCADE.POKER.netState().synced);
    await host.evaluate(()=>ARCADE.POKER.pause(false));await join.evaluate(()=>rawPokerPush('poker',delayedPokerPause));await host.waitForTimeout(80);
    expect(await host.evaluate(()=>ARCADE.POKER.state.mode)).toBe('paused');
    await join.evaluate(()=>ARCADE.POKER.pause(false));for(const page of pages)await page.waitForFunction(()=>ARCADE.POKER.state.mode==='playing');
    const before=await publicTable(host);await join.evaluate(()=>ARCADE.NET.leave());await host.waitForFunction(()=>!ARCADE.NET.state.session&&ARCADE.POKER.state.mode==='disconnected');
    const after=await publicTable(host);expect(after.players).toEqual(before.players);expect(after.winner).toBeNull();await expect(host.locator('#pkResultTitle')).toHaveText('TABLE CLOSED');expect(errors).toEqual([]);
  }finally{for(const page of pages)await page.close();}
});

test('RUSTLAS room codes complete automatic broker signaling with real local peers',async({browser,baseURL})=>{
  test.setTimeout(60000);const{host,join,pages,errors}=await pagesFor(browser,baseURL),retained=new Map(),subscribers=new Map();
  try{
    for(const page of pages){
      await page.exposeFunction('pokerBroker',async({op,topic,payload,retain})=>{
        if(op==='sub'){
          if(!subscribers.has(topic))subscribers.set(topic,new Set());subscribers.get(topic).add(page);
          if(retained.has(topic))await page.evaluate(({topic,payload})=>window.deliverPokerBroker(topic,payload),{topic,payload:retained.get(topic)});
        }else if(op==='unsub')subscribers.get(topic)?.delete(page);
        else if(op==='close'){for(const clients of subscribers.values())clients.delete(page);}
        else if(op==='pub'){
          if(retain){if(payload)retained.set(topic,payload);else retained.delete(topic);}
          for(const target of subscribers.get(topic)||[])if(!target.isClosed())await target.evaluate(({topic,payload})=>window.deliverPokerBroker(topic,payload),{topic,payload});
        }
      });
      await page.evaluate(()=>{
        const m=ARCADE.NET.mqtt,subs=new Map();window.deliverPokerBroker=(topic,payload)=>{for(const fn of subs.get(topic)||[])fn(payload,topic);};
        m.connect=async()=>{m.ready=true;};m.sub=(topic,fn)=>{if(!subs.has(topic))subs.set(topic,[]);subs.get(topic).push(fn);void pokerBroker({op:'sub',topic});};
        m.unsub=topic=>{subs.delete(topic);void pokerBroker({op:'unsub',topic});};m.pub=(topic,payload,retain)=>{if(m.ready)void pokerBroker({op:'pub',topic,payload,retain});};m.close=()=>{m.ready=false;subs.clear();void pokerBroker({op:'close'});};
      });
    }
    await host.locator('#pkNetBtn').click();await host.locator('#netRoomBtn').click();await expect(host.locator('#netRoomCode')).toHaveText(/^RUSTLAS-\d{6}$/);const code=await host.locator('#netRoomCode').textContent();
    await join.locator('#pkNetBtn').click();await join.locator('#netRoomIn').fill(code);await join.locator('#netJoinRoomBtn').click();
    for(const page of pages)await page.waitForFunction(()=>ARCADE.NET.state.session&&ARCADE.POKER.netState()?.synced);
    await readyPair(host,join);await host.locator('#pkCallBtn').click();await join.waitForFunction(()=>ARCADE.POKER.state.turn===1);await join.locator('#pkCallBtn').click();
    for(const page of pages)await page.waitForFunction(()=>ARCADE.POKER.state.stage==='flop');expect(await publicTable(host)).toEqual(await publicTable(join));expect(errors).toEqual([]);
  }finally{for(const page of pages)await page.close();}
});
