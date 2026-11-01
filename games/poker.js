/* Big Money Rustlas Poker. Only the host owns the deck; clients receive a
 * recipient-specific view. This is a friendly P2P table, not a trusted casino. */
const POKER=(()=>{
  const R=POKER_RULES,$=id=>document.getElementById('pk'+id),store=gameStore('pa_poker_');
  const clone=o=>JSON.parse(JSON.stringify(o)),integer=(n,max=2000)=>Number.isSafeInteger(n)&&n>=0&&n<=max;
  const savedCount=(value,max)=>{const n=Number(value);return integer(n,max)?n:0;};
  const streets=['preflop','flop','turn','river'],seatOK=n=>n===0||n===1,cardOK=n=>integer(n,51);
  let match=R.create(),visible=R.view(match,0),N=null,active=false,cpuTimer=0,retryTimer=0,syncTimer=0,generation=0,raiseTo=40,shownRevision=-1;
  const U={playMode:'cpu',paused:false,ended:false,notice:'Take a seat to start a heads-up game.',saved:false,recorded:false,best:savedCount(store.get('best',0),1600),wins:savedCount(store.get('wins',0),1000000000)};
  const seat=()=>N?(N.role==='join'?1:0):U.playMode==='online'?visible.seat:0;
  const current=()=>match?R.view(match,seat()):clone(visible);
  function mode(){const s=current();return U.ended?'disconnected':U.paused?'paused':s.stage==='ready'?'ready':s.stage==='over'?(s.matchWinner===null?'hand-over':'over'):'playing';}
  const humanTurn=()=>active&&!U.ended&&!U.paused&&(!N||N.transport&&!N.pending&&N.synced)&&streets.includes(current().stage)&&current().turn===seat();
  const playerName=i=>i===seat()?'YOU':U.playMode==='cpu'?'THE SALOON DEALER':'YOUR HOMIE';
  function text(id,value){const el=$(id);if(el&&el.textContent!==String(value))el.textContent=String(value);}
  function clearCPU(){clearTimeout(cpuTimer);cpuTimer=0;generation++;}
  function clearNetworkTimers(){clearTimeout(retryTimer);clearTimeout(syncTimer);retryTimer=0;syncTimer=0;}
  function recordResult(){
    const s=current();if(U.recorded||s.matchWinner===null||U.playMode!=='cpu'||U.ended)return;
    U.recorded=true;if(s.matchWinner!==0)return;
    U.wins++;U.best=Math.max(U.best,1000+Math.max(0,60-s.handNo)*10);store.set('wins',U.wins);store.set('best',U.best);Sound.play('fanfare',.3);
  }
  function render(){
    if(!$('Screen'))return;const s=current(),own=seat(),opp=1-own,m=mode(),playing=m==='playing',can=humanTurn(),legal=R.legal(s,own);
    const highlights=s.result?.kind==='showdown'?s.result.winners.flatMap(i=>s.result.hands[i]?.best5||[]):[];
    if(s.revision!==shownRevision){shownRevision=s.revision;raiseTo=legal.minRaiseTo||s.bigBlind*2;}
    for(const [prefix,i] of [['Player',own],['Opp',opp]]){
      const p=s.players[i];text(prefix+'Name',playerName(i));text(prefix+'Stack',p.stack.toLocaleString());text(prefix+'Bet',p.bet.toLocaleString());text(prefix+'Action',p.lastAction||(s.turn===i&&playing?'AT THE TABLE':'WAITING'));
      $(prefix+'Dealer').hidden=s.dealer!==i;POKER_RENDERER.cards($(prefix+'Cards'),p.hand.length?p.hand:[null,null],{highlight:highlights});
      $(prefix+'Stack').closest('.pk-seat')?.classList.toggle('active',playing&&s.turn===i);
    }
    POKER_RENDERER.cards($('Board'),s.board,{slots:5,highlight:highlights});text('Pot',(s.stage==='over'?s.result.pot:s.pot).toLocaleString());
    text('Street',s.stage==='ready'?'THE SALOON IS OPEN':s.stage==='over'?'HAND '+s.handNo+' · COMPLETE':s.stage.toUpperCase()+' · BLINDS '+s.smallBlind+'/'+s.bigBlind);
    let notice=U.notice||s.notice;
    if(N&&!N.transport)notice='Connection interrupted. Your hand is paused while the table reconnects.';
    else if(N?.pending)notice='Sending your '+(N.pending.packet.k==='action'?'move':'request')+'…';
    else if(playing)notice=(s.turn===own?'YOUR TURN':'WAITING FOR '+playerName(opp))+' · '+(U.notice||s.notice);
    text('Status',notice);$('Screen').classList.toggle('pk-match',active&&s.stage!=='ready');document.body.classList.toggle('poker-match',active&&s.stage!=='ready');
    $('Setup').hidden=m!=='ready';$('Pause').hidden=m!=='paused';$('Result').hidden=!['hand-over','over','disconnected'].includes(m);
    text('StartBtn',N?'READY TO DEAL':'DEAL ME IN');$('StartBtn').disabled=!!N&&(!N.transport||!N.synced||N.ready[own]);
    text('ReadyNote',N?(N.ready[own]?'Ready. Waiting for your homie…':'Both players must be ready before the deal.'):'1,000 play chips each. Face the saloon dealer.');
    text('PauseNote',N?(!N.transport?'Reconnecting. Your cards and chips stay on this table.':'Both players must resume before anyone can act.'):'Your cards and chips are right where you left them.');
    $('ResumeBtn').disabled=!!N&&(!N.transport||!N.synced||!!N.pending);$('PauseBtn').disabled=!streets.includes(s.stage)||U.ended;text('PauseBtn',U.paused?'RESUME':'PAUSE');
    $('FoldBtn').disabled=!can||!legal.canFold;$('CallBtn').disabled=!can||!(legal.canCheck||legal.canCall);text('CallBtn',legal.canCheck?'CHECK':'CALL '+legal.callAmount);
    $('RaiseBtn').disabled=!can||!legal.canRaise;$('AllInBtn').disabled=!can||!legal.canAllIn;
    const min=legal.minRaiseTo||40,max=Math.max(min,legal.maxRaiseTo||min);raiseTo=Math.max(min,Math.min(max,Math.round(raiseTo)));
    $('RaiseAmount').min=min;$('RaiseAmount').max=max;$('RaiseAmount').value=raiseTo;$('RaiseAmount').disabled=!can||!legal.canRaise;
    text('RaiseValue',raiseTo.toLocaleString());text('RaiseBtn','RAISE TO '+raiseTo);
    for(const id of ['MinBtn','HalfPotBtn','PotBtn','AllInPreset'])$(id).disabled=!can||!legal.canRaise;
    if(['hand-over','over','disconnected'].includes(m)){
      const winner=s.matchWinner??s.result?.handWinner;
      text('ResultTitle',m==='disconnected'?'TABLE CLOSED':m==='over'?(winner===own?'YOU OWN THE SALOON':'YOUR RIVAL OWNS THE SALOON'):winner===null?'SPLIT POT':winner===own?'YOU TAKE THE POT':playerName(opp)+' TAKES THE POT');
      const result=s.result,award=result?(result.kind==='fold'?(result.handWinner===own?'You win':'Your rival wins')+' '+result.pot+' chips after a fold.':(result.handWinner===null?'SPLIT POT · '+result.hands[own].name:result.hands[result.handWinner].name)+' · You receive '+result.payouts[own]+' · Rival '+result.payouts[opp]):'';
      text('ResultDetail',m==='disconnected'?U.notice+' No win or record was awarded.':award+(m==='over'?' · '+s.handNo+' hands':''));
      $('NextBtn').hidden=m!=='hand-over';$('AgainBtn').hidden=m==='hand-over';
      text('NextBtn',N?.ready[own]?'WAITING FOR YOUR HOMIE…':'READY FOR NEXT HAND');text('AgainBtn',m==='disconnected'?'PLAY A NEW CPU MATCH':N?.ready[own]?'WAITING FOR YOUR HOMIE…':'BUY IN AGAIN · 1,000 CHIPS');
      $('NextBtn').disabled=!!N&&(!N.transport||N.ready[own]||!!N.pending);$('AgainBtn').disabled=!!N&&(!N.transport||N.ready[own]||!!N.pending);
    }
    const record=m==='over'&&U.playMode==='cpu'&&s.matchWinner===0;$('SaveBtn').hidden=!record;$('SaveBtn').disabled=U.saved;text('SaveBtn',U.saved?'RECORD SUBMITTED':'SAVE YOUR RECORD');
  }
  function afterMove(){
    U.notice='';visible=current();if(N){N.phase=match.stage==='over'?(match.matchWinner===null?'hand-over':'match-over'):'playing';if(N.phase!=='playing')N.ready=[false,false];}
    recordResult();render();scheduleCPU();
  }
  function deal(){
    if(!match||U.ended)return false;
    try{if(!R.startHand(match))return false;}catch(_e){U.notice='This browser could not shuffle securely. Try reopening the arcade in a current browser.';render();return false;}
    U.paused=false;U.notice='';shownRevision=-1;afterMove();Sound.play('move');return true;
  }
  function start(){
    if(N){ready();return;}
    clearCPU();clearNetworkTimers();match=R.create();Object.assign(U,{playMode:'cpu',paused:false,ended:false,notice:'',saved:false,recorded:false});deal();
  }
  function next(){if(N){ready();return;}if(!U.ended&&match?.stage==='over'&&match.matchWinner===null)deal();}
  function validAction(a){return a&&typeof a==='object'&&!Array.isArray(a)&&['fold','check','call','raise','allin'].includes(a.type)&&(a.type==='raise'?integer(a.amount)&&a.amount>0:a.amount===undefined);}
  function act(action){
    if(!humanTurn()||!validAction(action))return false;
    const a=action.type==='raise'?{type:'raise',amount:action.amount}:{type:action.type};
    if(N?.role==='join'){request('action',{action:a});return true;}
    if(!R.act(match,seat(),a))return false;Sound.play('move');afterMove();sendSnapshot();return true;
  }
  function cpuNow(){
    clearCPU();if(!active||U.playMode!=='cpu'||U.paused||U.ended||!match||!streets.includes(match.stage)||match.turn!==1)return false;
    const action=POKER_AI.choose(R.view(match,1),'normal');
    if(!action||!R.act(match,1,action)){U.notice='The dealer is thinking. Pause and resume to retry.';render();return false;}
    Sound.play('move');afterMove();return true;
  }
  function scheduleCPU(){clearCPU();if(!active||U.playMode!=='cpu'||U.paused||U.ended||!match||!streets.includes(match.stage)||match.turn!==1)return;const token=generation;cpuTimer=setTimeout(()=>{if(token===generation)cpuNow();},650);}
  function pause(value){
    const s=current();if(U.ended||!streets.includes(s.stage))return;const paused=typeof value==='boolean'?value:!U.paused;
    clearCPU();
    if(N){
      if(!N.transport){U.paused=true;render();return;}
      if(N.role==='join'){
        if(!N.synced){sync();return;}
        N.localPause=paused;if(paused)U.paused=true;
        request('pause',{paused},true);render();return;
      }
      N.pauses[0]=paused;U.paused=N.pauses.some(Boolean);sendSnapshot();
    }else U.paused=paused;
    U.notice='';render();if(!U.paused)scheduleCPU();
  }
  function enter(){active=true;document.body.classList.add('poker-selected');render();scheduleCPU();TICK.set('BIG MONEY RUSTLAS POKER — PLAY CHIPS. BIG BLUFFS.','HEADS-UP HOLD’EM');}
  function leave(){if(active&&!U.ended&&streets.includes(current().stage))pause(true);active=false;clearCPU();document.body.classList.remove('poker-selected','poker-match');$('Screen').classList.remove('pk-match');}
  function send(packet){if(N&&N.transport)NET.push('poker',{v:1,...packet});}
  function sendSnapshot(ack=N?.lastReply){
    if(N?.role!=='host'||!match)return;
    send({k:'snapshot',round:N.round,epoch:N.epoch,barrier:N.peerBarrier,seq:++N.tx,phase:N.phase,ready:N.ready.slice(),pauses:N.pauses.slice(),view:R.view(match,1),ack:ack?clone(ack):null});
  }
  function endUnresponsive(){
    if(!N)return;const reason='The other player stopped responding. Start a fresh invite to play again.';
    NET.leave();netEnd(reason);U.notice=reason;render();
  }
  function retryRequest(){
    clearTimeout(retryTimer);if(!N?.pending||!N.transport)return;
    const p=N.pending;if(p.attempts>=10){endUnresponsive();return;}
    p.attempts++;send(p.packet);retryTimer=setTimeout(retryRequest,1500);
  }
  function request(kind,payload={},urgent=false){
    if(N?.role!=='join'||!N.transport||N.pending&&!urgent)return false;
    const s=current(),packet={k:kind,round:N.round,epoch:N.epoch,handNo:s.handNo,revision:s.revision,seat:1,request:++N.requests,...payload};
    N.pending={packet,attempts:0};retryRequest();render();return true;
  }
  function sync(retries=0){
    clearTimeout(syncTimer);if(N?.role!=='join'||!N.transport)return;
    send({k:'sync',round:N.round,barrier:N.barrier});
    if(retries<8&&!N.synced)syncTimer=setTimeout(()=>sync(retries+1),1500);
    else if(!N.synced)endUnresponsive();
  }
  function ready(){
    if(!N||!N.transport||!N.synced||!['lobby','hand-over','match-over'].includes(N.phase)||N.ready[seat()]||N.pending)return false;
    if(N.role==='join')return request('ready');
    N.ready[0]=true;maybeDeal();sendSnapshot();render();return true;
  }
  function maybeDeal(){
    if(N?.role!=='host'||!N.ready.every(Boolean))return;
    if(['lobby','match-over'].includes(N.phase)){N.round++;match=R.create({dealer:(N.round-1)%2});U.saved=false;U.recorded=false;}
    N.ready=[false,false];N.pauses=[false,false];N.phase='playing';U.paused=false;deal();
  }
  function netStart(role){
    if(!['host','join'].includes(role))return;clearCPU();clearNetworkTimers();
    N={role,round:0,epoch:0,barrier:0,peerBarrier:0,awaitingBarrier:0,phase:'lobby',ready:[false,false],pauses:[false,false],transport:true,synced:role==='host',tx:0,rx:0,requests:0,lastRequest:0,lastReply:null,replies:[],pending:null,localPause:false};
    match=role==='host'?R.create():null;visible=R.view(R.create(),role==='host'?0:1);Object.assign(U,{playMode:'online',paused:false,ended:false,notice:'Both players ready up. No cards are dealt until both agree.',saved:false,recorded:false});shownRevision=-1;render();
    if(role==='host')sendSnapshot();else sync();
  }
  function cleanView(raw){
    if(!raw||typeof raw!=='object'||raw.seat!==1||!['ready',...streets,'over'].includes(raw.stage)||!integer(raw.handNo,100000)||!integer(raw.revision,10000000)||!seatOK(raw.dealer)||!(raw.turn===null||seatOK(raw.turn))||typeof raw.notice!=='string'||raw.notice.length>350||raw.totalChips!==2000)return null;
    if(streets.includes(raw.stage)!==seatOK(raw.turn)||!Array.isArray(raw.players)||raw.players.length!==2||!Array.isArray(raw.board)||!raw.board.every(cardOK)||![0,3,4,5].includes(raw.board.length))return null;
    for(const key of ['pot','smallBlind','bigBlind','currentBet','lastRaise'])if(!integer(raw[key]))return null;
    if(!Array.isArray(raw.raiseRights)||raw.raiseRights.length!==2||raw.raiseRights.some(b=>typeof b!=='boolean')||![null,0,1].includes(raw.matchWinner))return null;
    const cards=raw.board.slice(),show=raw.stage==='over'&&raw.result?.kind==='showdown';
    for(let i=0;i<2;i++){
      const p=raw.players[i];if(!p||typeof p!=='object'||!['stack','bet','contributed'].every(k=>integer(p[k]))||typeof p.folded!=='boolean'||typeof p.allIn!=='boolean'||typeof p.lastAction!=='string'||p.lastAction.length>100||!Array.isArray(p.hand)||p.hand.length!==(raw.stage==='ready'?0:2))return null;
      if(p.bet>p.contributed||p.allIn!==(p.stack===0))return null;
      if(i===1||show){if(!p.hand.every(cardOK))return null;cards.push(...p.hand);}else if(p.hand.some(c=>c!==null))return null;
    }
    if(new Set(cards).size!==cards.length||raw.pot+raw.players.reduce((sum,p)=>sum+p.stack,0)!==2000)return null;
    const blind=raw.handNo?Math.min(160,20*2**Math.floor((raw.handNo-1)/6)):20;
    if(raw.bigBlind!==blind||raw.smallBlind!==blind/2||raw.pot!==raw.players.reduce((sum,p)=>sum+p.contributed,0))return null;
    if(streets.includes(raw.stage)){
      if(raw.handNo<1||raw.board.length!==({preflop:0,flop:3,turn:4,river:5}[raw.stage])||raw.currentBet!==Math.max(...raw.players.map(p=>p.bet))||raw.players.some(p=>p.folded)||raw.players[raw.turn].stack===0)return null;
    }else if(raw.stage==='ready'&&(raw.handNo!==0||raw.revision!==0||raw.board.length||raw.pot||raw.players.some(p=>p.stack!==1000||p.bet||p.folded)))return null;
    if(raw.stage!=='over'&&(raw.result!==null||raw.matchWinner!==null))return null;
    if(raw.stage==='over'){
      const r=raw.result;if(!r||!['fold','showdown'].includes(r.kind)||![null,0,1].includes(r.handWinner)||!Array.isArray(r.winners)||!r.winners.length||r.winners.length>2||r.winners.some(i=>!seatOK(i))||new Set(r.winners).size!==r.winners.length||!integer(r.pot))return null;
      if(!['payouts','refunds'].every(k=>Array.isArray(r[k])&&r[k].length===2&&r[k].every(n=>integer(n)))||!Array.isArray(r.hands)||r.hands.length!==2)return null;
      for(const h of r.hands){if(r.kind==='fold'){if(h!==null)return null;}else if(!h||!integer(h.rank,8)||typeof h.name!=='string'||h.name.length>60||!Array.isArray(h.kickers)||h.kickers.length>5||h.kickers.some(n=>!integer(n,14)||n<2)||!Array.isArray(h.best5)||h.best5.length!==5||!h.best5.every(c=>cards.includes(c))||new Set(h.best5).size!==5)return null;}
      if(raw.pot||raw.currentBet||raw.players.some(p=>p.bet||p.contributed)||raw.raiseRights.some(Boolean)||r.handWinner!==(r.winners.length===1?r.winners[0]:null)||r.payouts.reduce((a,b)=>a+b,0)!==r.pot)return null;
      if(JSON.stringify(R.splitPot(r.pot,r.winners,raw.dealer))!==JSON.stringify(r.payouts))return null;
      const expectedWinner=raw.players[0].stack===0?1:raw.players[1].stack===0?0:null;if(raw.matchWinner!==expectedWinner)return null;
      if(r.kind==='fold'){if(r.winners.length!==1||!raw.players[1-r.winners[0]].folded||raw.players[r.winners[0]].folded)return null;}
      else{
        if(raw.board.length!==5||raw.players.some(p=>p.folded))return null;
        const evaluated=raw.players.map(p=>R.evaluate([...p.hand,...raw.board]));
        for(let i=0;i<2;i++)if(R.compare(evaluated[i],r.hands[i])!==0||r.hands[i].name!==evaluated[i].name||!r.hands[i].best5.every(c=>raw.players[i].hand.includes(c)||raw.board.includes(c))||R.compare(R.evaluate(r.hands[i].best5),evaluated[i])!==0)return null;
        const comparison=R.compare(evaluated[0],evaluated[1]),expected=comparison===0?[0,1]:[comparison>0?0:1];if(JSON.stringify(expected)!==JSON.stringify(r.winners))return null;
      }
    }
    const a=raw.lastAction;if(a!==null&&(!a||!seatOK(a.seat)||!['fold','check','call','raise'].includes(a.type)||!integer(a.amount)||!streets.includes(a.stage)))return null;
    try{
      const v=R.view(raw,1);
      if(v.result){const r=raw.result;v.result={kind:r.kind,handWinner:r.handWinner,winners:r.winners.slice(),payouts:r.payouts.slice(),pot:r.pot,refunds:r.refunds.slice(),hands:r.hands.map(h=>h?{rank:h.rank,kickers:h.kickers.slice(),name:h.name,best5:h.best5.slice()}:null)};}
      if(v.lastAction)v.lastAction={seat:a.seat,type:a.type,amount:a.amount,stage:a.stage};return v;
    }catch(_e){return null;}
  }
  function receiveSnapshot(d){
    if(!N||N.role!=='join'||!N.transport||!integer(d.epoch,1000000000)||d.epoch<N.epoch||!integer(d.barrier,1000000000)||d.barrier<N.awaitingBarrier||!integer(d.seq,1000000000)||d.seq===0||d.seq<=N.rx||!integer(d.round,1000000)||d.round<N.round||d.round>N.round+1)return;
    const v=cleanView(d.view);if(!v)return;
    const phase=v.stage==='ready'?'lobby':v.stage==='over'?(v.matchWinner===null?'hand-over':'match-over'):'playing';
    if(d.phase!==phase||!['ready','pauses'].every(k=>Array.isArray(d[k])&&d[k].length===2&&d[k].every(b=>typeof b==='boolean')))return;
    if(d.round===N.round&&(v.revision<visible.revision||v.handNo<visible.handNo||v.handNo>visible.handNo+1))return;
    if(d.round>N.round&&(!['lobby','match-over'].includes(N.phase)||v.handNo!==1))return;
    if(d.ack!==null&&(!d.ack||!integer(d.ack.id,1000000000)||typeof d.ack.accepted!=='boolean'||typeof d.ack.reason!=='string'||d.ack.reason.length>200))return;
    const newMatch=d.round>N.round,newConnection=d.epoch>N.epoch,newHand=v.handNo!==visible.handNo;N.round=d.round;N.epoch=d.epoch;N.rx=d.seq;N.phase=phase;N.ready=d.ready.slice();N.pauses=d.pauses.slice();N.synced=true;clearTimeout(syncTimer);
    if(newConnection){N.pending=null;N.localPause=false;clearTimeout(retryTimer);}
    if(N.pending&&d.ack?.id>=N.pending.packet.request){if(!d.ack.accepted){U.notice=d.ack.reason;if(N.pending.packet.k==='pause')N.localPause=false;}N.pending=null;clearTimeout(retryTimer);}
    if(newMatch||newHand||v.stage==='over')N.localPause=false;
    if(N.localPause){if(N.pauses[1])N.localPause=false;else N.pauses[1]=true;}
    visible=v;U.paused=streets.includes(v.stage)&&N.pauses.some(Boolean);if(!N.pending&&d.ack?.accepted)U.notice='';
    if(newMatch){U.saved=false;U.recorded=false;U.notice='';}render();
  }
  function reply(d,accepted,reason){
    const ack={id:d.request,accepted,reason};N.lastReply=ack;N.replies.push(ack);if(N.replies.length>32)N.replies.shift();sendSnapshot(ack);
  }
  function netApply(d){
    if(!N||!d||typeof d!=='object'||d.v!==1)return;
    if(N.role==='join'){if(d.k==='snapshot')receiveSnapshot(d);return;}
    if(d.k==='sync'){
      if(!integer(d.barrier,1000000000))return;
      // A reconnect sync establishes a new action epoch. Requests still queued
      // on the old connection cannot count as a fresh resume or poker action.
      if(d.barrier>N.peerBarrier){N.peerBarrier=d.barrier;N.epoch++;N.pauses=[true,true];U.paused=streets.includes(match.stage);render();}
      sendSnapshot();return;
    }
    if(!['action','ready','pause'].includes(d.k)||!integer(d.request,1000000000)||d.request===0)return;
    const cached=N.replies.find(r=>r.id===d.request);if(cached){sendSnapshot(cached);return;}
    if(d.request<=N.lastRequest){sendSnapshot({id:d.request,accepted:false,reason:'That request was already handled.'});return;}
    N.lastRequest=d.request;
    if(d.seat!==1||d.round!==N.round||d.epoch!==N.epoch||(d.k!=='pause'&&(d.handNo!==match.handNo||d.revision!==match.revision))){reply(d,false,'The table changed. Review the current hand and try again.');return;}
    if(!N.transport){reply(d,false,'The table is reconnecting.');return;}
    if(d.k==='pause'){
      if(typeof d.paused!=='boolean'||!streets.includes(match.stage)){reply(d,false,'This hand cannot be paused now.');return;}
      N.pauses[1]=d.paused;U.paused=N.pauses.some(Boolean);reply(d,true,'');render();return;
    }
    if(d.k==='ready'){
      if(!['lobby','hand-over','match-over'].includes(N.phase)||N.ready[1]){reply(d,false,'Wait for the next ready check.');return;}
      N.ready[1]=true;maybeDeal();reply(d,true,'');render();return;
    }
    if(N.phase!=='playing'||U.paused||N.pauses.some(Boolean)||match.turn!==1||!validAction(d.action)||!R.act(match,1,d.action)){reply(d,false,'That move is not legal on this turn.');return;}
    Sound.play('move');afterMove();reply(d,true,'');
  }
  function netConnection(status){
    if(!N||!['disconnected','connected'].includes(status))return;clearCPU();
    if(status==='disconnected'){
      if(N.role==='host'&&N.transport)N.epoch++;
      N.transport=false;N.synced=false;N.pending=null;N.localPause=false;N.pauses=[true,true];U.paused=streets.includes(current().stage);U.notice='Connection interrupted. Waiting up to 20 seconds to reconnect.';clearNetworkTimers();
    }else{
      if(N.role==='join'&&!N.transport){N.barrier++;N.awaitingBarrier=N.barrier;}
      N.transport=true;N.pauses=[true,true];U.paused=streets.includes(current().stage);U.notice='Connection restored. Both players must resume.';
      if(N.role==='host'){N.synced=true;sendSnapshot();}else sync();
    }
    render();
  }
  function netEnd(reason='The online table closed.'){
    if(!N)return;visible=current();match=null;clearCPU();clearNetworkTimers();N=null;Object.assign(U,{ended:true,paused:false,notice:String(reason||'The online table closed.').slice(0,200)});render();
  }
  function bind(){
    $('StartBtn').onclick=start;$('NextBtn').onclick=next;$('AgainBtn').onclick=()=>N?ready():start();
    $('FoldBtn').onclick=()=>act({type:'fold'});$('CallBtn').onclick=()=>act({type:R.legal(current(),seat()).canCheck?'check':'call'});
    $('RaiseBtn').onclick=()=>act({type:'raise',amount:raiseTo});$('AllInBtn').onclick=()=>act({type:'allin'});
    $('RaiseAmount').oninput=()=>{raiseTo=Number($('RaiseAmount').value);render();};
    const preset=kind=>{const s=current(),l=R.legal(s,seat());raiseTo=kind==='min'?l.minRaiseTo:kind==='all'?l.maxRaiseTo:s.currentBet+Math.max(s.bigBlind,Math.round((s.pot+l.toCall)*(kind==='half'?.5:1)));render();};
    $('MinBtn').onclick=()=>preset('min');$('HalfPotBtn').onclick=()=>preset('half');$('PotBtn').onclick=()=>preset('pot');$('AllInPreset').onclick=()=>preset('all');
    $('PauseBtn').onclick=()=>pause();$('ResumeBtn').onclick=()=>pause(false);$('HomeBtn').onclick=()=>showScreen('menu');$('SoundBtn').onclick=toggleSound;
    $('SaveBtn').onclick=()=>{const s=current();if(U.playMode!=='cpu'||U.ended||s.matchWinner!==0||U.saved)return;U.saved=true;LB.check('poker',1000+Math.max(0,60-s.handNo)*10,s.handNo+' hands · CPU match');render();};
    window.addEventListener('blur',()=>{if(active)pause(true);});document.addEventListener('visibilitychange',()=>{if(active&&document.hidden)pause(true);});
    document.addEventListener('keydown',e=>{if(!active||gameKeysBlocked(e)||e.target.closest('button,input,select,textarea'))return;if(e.key==='p'||e.key==='P'||e.key==='Escape'){e.preventDefault();pause();}});
    render();
  }
  return{bind,enter,leave,start,next,act,pause,ready,render,netStart,netApply,netConnection,netEnd,get state(){return{...current(),mode:mode(),playMode:U.playMode,paused:U.paused,ended:U.ended,notice:U.notice||current().notice,best:U.best,wins:U.wins,saved:U.saved};},netState:()=>N?clone({role:N.role,round:N.round,epoch:N.epoch,barrier:N.barrier,phase:N.phase,ready:N.ready,pauses:N.pauses,transport:N.transport,synced:N.synced,requests:N.requests,lastRequest:N.lastRequest,tx:N.tx,rx:N.rx,pending:N.pending}):null,debug:{cpuNow,humanTurn}};
})();
