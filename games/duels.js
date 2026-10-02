/* Shared-score versus rounds use the existing WebRTC rooms, not a second service. */
const DUELS=(()=>{
  const config={shooter:{prefix:'sh',title:'CARNIVAL CROSSFIRE',module:()=>SHOOTER},chicken:{prefix:'kh',title:'CHICKEN HUNTIN’',module:()=>CHICKEN},claw:{prefix:'cl',title:'CARNIVAL CLAW',module:()=>CLAW}};
  let S=null,timer=0;
  const gameModule=()=>config[S.game].module();
  const el=id=>document.getElementById('duel'+id);
  const active=game=>!!S&&S.game===game;
  function random(game){if(!active(game))return Math.random();S.rng=(Math.imul(S.rng,1664525)+1013904223)>>>0;return S.rng/4294967296;}
  function send(data){if(S)NET.push(S.game,{round:S.round,...data});}
  function showLobby(message){
    el('Modal').hidden=false;el('Resume').hidden=true;el('Title').textContent=config[S.game].title+' · VERSUS';el('Message').textContent=message;el('Ready').hidden=false;el('Ready').disabled=S.ready;el('Again').hidden=true;el('Save').hidden=true;el('Scores').hidden=true;
  }
  function start(game,role){
    end();config[game].module().pause(true);S={game,role,round:0,phase:'lobby',ready:false,peerReady:false,rng:1,score:0,peerScore:0,done:false,peerDone:false,seq:0,rx:0,pauses:[false,false],saved:false};
    el('Bar').hidden=false;document.getElementById(config[game].prefix+'Screen').prepend(el('Bar'));showLobby('Same round. Same starting setup. Highest score wins. Both players must be ready.');updateBar();timer=setInterval(tick,100);
  }
  function ready(){if(!S||S.phase!=='lobby'||S.ready)return;S.ready=true;el('Ready').disabled=true;el('Message').textContent='Ready. Waiting for your opponent…';send({k:'ready'});tryStart();}
  function tryStart(){
    if(!S||S.role!=='host'||!S.ready||!S.peerReady||S.phase!=='lobby')return;
    const seed=crypto.getRandomValues(new Uint32Array(1))[0]||1;S.round++;send({k:'begin',seed});begin(seed);
  }
  function begin(seed){
    S.rng=seed>>>0;S.phase='playing';S.score=0;S.peerScore=0;S.done=false;S.peerDone=false;S.seq=0;S.rx=0;S.pauses=[false,false];S.saved=false;
    el('Modal').hidden=true;gameModule().start(S.game==='claw'?'all':undefined);updateBar();
  }
  function updateBar(){if(!S)return;el('Mine').textContent=S.score.toLocaleString();el('Theirs').textContent=S.peerScore.toLocaleString();el('State').textContent=S.phase==='lobby'?'WAITING FOR BOTH PLAYERS':S.pauses.some(Boolean)?'MATCH PAUSED':S.done&&!S.peerDone?'OPPONENT STILL PLAYING':S.peerDone&&!S.done?'OPPONENT FINISHED':'HEAD TO HEAD';}
  function tick(){
    if(!S||S.phase!=='playing')return;const state=gameModule().state;
    if(state.mode==='paused'&&!S.pauses.some(Boolean))pause(true);
    if(state.mode==='playing'&&S.pauses.some(Boolean))gameModule().pause(true);
    S.score=Math.max(0,Math.round(Number(state.score)||0));S.done=S.done||state.mode==='over';
    send({k:'score',seq:++S.seq,score:S.score,done:S.done});updateBar();if(S.done&&S.peerDone)result();
  }
  function result(){
    if(!S||S.phase==='over')return;S.phase='over';el('Modal').hidden=false;el('Title').textContent=S.score>S.peerScore?'YOU WIN THE SHOWDOWN':S.score<S.peerScore?'THE HOMIE TAKES IT':'DEAD EVEN';el('Message').textContent='Your best score and any earned collectibles are saved on this device.';
    el('Resume').hidden=true;el('Ready').hidden=true;el('Again').hidden=false;el('Save').hidden=false;el('Save').disabled=S.saved||S.score<=0;el('Scores').hidden=false;el('FinalMine').textContent=S.score.toLocaleString();el('FinalTheirs').textContent=S.peerScore.toLocaleString();updateBar();
  }
  function pause(force){
    if(!S||S.phase!=='playing')return;const slot=S.role==='host'?0:1;S.pauses[slot]=force===true||!S.pauses[slot];send({k:'pause',paused:S.pauses[slot]});applyPause();
  }
  function applyPause(){
    if(!S)return;const m=gameModule(),paused=S.pauses.some(Boolean);if(paused)m.pause(true);else if(m.state.mode==='paused')m.pause();updateBar();
    if(paused){el('Modal').hidden=false;el('Title').textContent='MATCH PAUSED';el('Message').textContent='Both players must resume to continue this round.';el('Ready').hidden=true;el('Again').hidden=true;el('Save').hidden=true;el('Scores').hidden=true;el('Resume').hidden=false;el('Resume').disabled=!S.pauses[S.role==='host'?0:1];}
    else{el('Modal').hidden=true;el('Resume').hidden=true;}
  }
  function rematch(sendRequest=true){if(!S||!['over','lobby'].includes(S.phase))return;S.phase='lobby';S.ready=false;S.peerReady=false;S.done=false;S.peerDone=false;if(sendRequest)send({k:'rematch'});showLobby('Another round? Both players must be ready.');updateBar();}
  function apply(d){
    if(!S||!d||typeof d!=='object')return;
    if(d.k==='ready'&&S.phase==='lobby'){S.peerReady=true;tryStart();return;}
    if(d.k==='begin'&&S.role==='join'&&S.phase==='lobby'&&S.ready&&Number.isSafeInteger(d.round)&&d.round>S.round&&Number.isSafeInteger(d.seed)&&d.seed>0&&d.seed<=4294967295){S.round=d.round;begin(d.seed);return;}
    if(d.round!==S.round)return;
    if(d.k==='score'&&S.phase==='playing'&&!S.peerDone&&Number.isSafeInteger(d.seq)&&d.seq>S.rx&&Number.isSafeInteger(d.score)&&d.score>=0&&d.score<=1000000&&typeof d.done==='boolean'){
      // Bomb penalties may lower a live score; only a completed score is immutable.
      S.rx=d.seq;S.peerScore=d.score;S.peerDone=d.done;updateBar();if(S.done&&S.peerDone)result();
    }else if(d.k==='pause'&&S.phase==='playing'&&typeof d.paused==='boolean'){S.pauses[S.role==='host'?1:0]=d.paused;applyPause();}
    else if(d.k==='rematch'&&S.phase==='over')rematch(false);
  }
  function end(){if(!S)return;gameModule().pause(true);clearInterval(timer);timer=0;S=null;el('Modal').hidden=true;el('Bar').hidden=true;el('Resume').hidden=true;}
  function bind(){
    const shell=document.createElement('div');shell.innerHTML=`<div id="duelBar" class="duel-bar" hidden><span>YOU <b id="duelMine">0</b></span><small id="duelState">HEAD TO HEAD</small><span>HOMIE <b id="duelTheirs">0</b></span></div><div id="duelModal" class="duel-modal" hidden><div class="duel-panel"><span class="duel-kicker">PSYCHOPATHIC ARCADE · TWO PLAYERS</span><h2 id="duelTitle">VERSUS</h2><p id="duelMessage"></p><div id="duelScores" class="duel-scores" hidden><span>YOU<b id="duelFinalMine">0</b></span><span>HOMIE<b id="duelFinalTheirs">0</b></span></div><button id="duelReady">I’M READY</button><button id="duelResume" hidden>RESUME MY SIDE</button><button id="duelAgain" hidden>REMATCH</button><button id="duelSave" hidden>SAVE YOUR RECORD</button><button id="duelLeave" class="duel-secondary">LEAVE VERSUS</button></div></div>`;document.body.append(shell);
    el('Ready').onclick=ready;el('Resume').onclick=()=>pause(false);el('Again').onclick=()=>rematch();el('Leave').onclick=()=>NET.leave();
    el('Save').onclick=()=>{if(!S||S.saved||S.phase!=='over')return;S.saved=true;gameModule().state.saved=true;el('Save').disabled=true;el('Modal').hidden=true;LB.check(S.game,S.score,'Versus · '+S.peerScore+' opponent');};
    // Capture only round-management controls; normal game input stays with its game.
    document.addEventListener('click',e=>{
      if(!S||!e.target.closest('button'))return;const id=e.target.closest('button').id,p=config[S.game].prefix;
      if([p+'StartBtn',p+'AgainBtn',p+'RestartBtn'].includes(id)){e.preventDefault();e.stopImmediatePropagation();if(S.phase==='over')rematch();else if(S.phase==='lobby')ready();}
      if([p+'PauseBtn',p+'ResumeBtn'].includes(id)){e.preventDefault();e.stopImmediatePropagation();pause(false);}
      if(S.game==='claw'&&[p+'HuntBtn',p+'MixBtn'].includes(id)){e.preventDefault();e.stopImmediatePropagation();}
      if(S.game==='claw'&&id===p+'BookBtn'){pause(true);}
    },true);
    window.addEventListener('blur',()=>pause(true));document.addEventListener('visibilitychange',()=>{if(document.hidden)pause(true);});
  }
  return{bind,start,apply,end,active,random,pause,ready,rematch,state:()=>S};
})();
