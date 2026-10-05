/* ================= GAME 15 — JCW RUMBLE ================= */
function createWrestlingGame(ladderMode=false){
  const game=ladderMode?'ladder':'rumble',prefix=ladderMode?'lw':'ru';
  const $=selector=>document.querySelector(selector.replaceAll('#ru','#'+prefix));
  const $$=selector=>[...document.querySelectorAll(selector.includes('#')?selector.replaceAll('#ru','#'+prefix):'#'+prefix+'Screen '+selector)];
  const W=480,H=ladderMode?460:420,FONT='Impact,"Arial Black",sans-serif',B=ladderMode?{left:72,right:408,top:282,bottom:407}:{left:72,right:408,top:185,bottom:337};
  const roster=RUMBLE_ART.roster,byId=Object.fromEntries(roster.map(r=>[r.id,r])),store=gameStore('pa_'+prefix+'_');
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const S={mode:'ready',fighters:[],queue:[],entered:0,total:12,elapsed:0,nextIn:8,score:0,kills:0,chain:0,lastKill:-99,labels:[],banner:'',bannerTime:0,selected:byId[store.get('selected','violent-j')]?store.get('selected','violent-j'):'violent-j',best:Math.max(0,store.get('best',0)),wins:Math.max(0,store.get('wins',0)),charge:0,saved:false,won:false,error:'',time:120,countdown:0,ladder:null,winner:null};
  let loadingIds=new Set(),N=null;
  const art=new Map(),held=new Set(),guards=new Set();
  let arenaImage=null,arenaPromise=null;
  function loadArena(){if(!arenaPromise){arenaImage=new Image();arenaImage.src=LADDER_BACKDROP;arenaPromise=arenaImage.decode().then(()=>makeScenery()).catch(e=>{arenaPromise=null;throw e;});}return arenaPromise;}
  let canvas,ctx,scenery,active=false,raf=0,last=0,generation=0,portraitGeneration=0,stickId=null,stick={x:0,y:0},hudKey='';
  const player=()=>S.fighters.find(f=>f.player);
  const alive=()=>S.fighters.filter(f=>!f.out);
  function text(id,v){const e=$('#'+id);if(e.textContent!==String(v))e.textContent=String(v);}
  function status(s){text('ruStatus',s);}
  function announce(s){S.banner=s;S.bannerTime=2;status(s);}
  function cleanCache(){
    const keep=new Set([...loadingIds,...S.fighters.map(f=>f.id),...S.queue.slice(0,1),S.selected]);
    for(const [id,item] of art){if(art.size<=6)break;if(!keep.has(id)&&item.image)art.delete(id);}
  }
  function load(id){
    if(art.has(id))return art.get(id).promise;
    const image=new Image(),entry={image:null,promise:null};
    entry.promise=(async()=>{image.src=byId[id].src;await image.decode();entry.image=image;cleanCache();return image;})();
    art.set(id,entry);cleanCache();entry.promise.catch(()=>{if(art.get(id)===entry)art.delete(id);});return entry.promise;
  }
  function prefetch(){
    const id=S.queue[0],token=generation;if(!id||art.has(id))return;
    load(id).catch(()=>{if(token!==generation||S.mode!=='playing')return;S.error='Wrestler artwork could not be decoded. Resume to retry.';pause(true);});
  }
  function clearInput(){held.clear();guards.clear();stick={x:0,y:0};stickId=null;$('#ruStickNub').style.transform='';$('#ruGuardBtn').setAttribute('aria-pressed','false');}
  function stop(){cancelAnimationFrame(raf);raf=0;last=0;clearInput();}
  function loop(now){raf=0;if(!active||S.mode!=='playing')return;const dt=last?Math.min(.05,Math.max(0,(now-last)/1000)):0;last=now;step(dt);draw();if(S.mode==='playing')raf=requestAnimationFrame(loop);}
  function run(){if(active&&S.mode==='playing'&&!raf){last=0;raf=requestAnimationFrame(loop);}}
  function overlays(){
    if(ladderMode){const match=active&&!['ready','loading'].includes(S.mode);$('#ruScreen').classList.toggle('lw-match',match);document.body.classList.toggle('ladder-match',match);}

    $('#ruRestartBtn').hidden=!!N;$('#ruSetup').hidden=!['ready','loading'].includes(S.mode);$('#ruPause').hidden=S.mode!=='paused';$('#ruOver').hidden=S.mode!=='over';
    $('#ruStartBtn').disabled=S.mode==='loading'||!!N?.localReady;$('#ruRoster').disabled=S.mode==='loading'||!!N?.localReady;$('#ruSize').disabled=S.mode==='loading'||!!N;
    $('#ruPauseBtn').disabled=!['playing','paused'].includes(S.mode);text('ruPauseBtn',S.mode==='paused'?'RESUME':'PAUSE');text('ruPauseNote',S.error||'Your match is paused.');
    for(const id of ['ruHitBtn','ruThrowBtn','ruGuardBtn'])$('#'+id).disabled=S.mode!=='playing';
  }
  function hud(){
    if(ladderMode){$('#ruCountdown').hidden=S.countdown<=0||S.mode!=='playing';text('ruCount',Math.ceil(S.countdown));}
    coach();const p=player(),hp=p?Math.ceil(p.hp):100,guard=p?Math.floor(p.guard):100;
    const key=[S.mode,S.score,S.kills,S.total,S.entered,alive().length,S.best,hp,guard,Math.floor(S.charge),S.wins,Math.ceil(S.time),p?.climbing,p?.climb>=1,S.ladder?.carrier,S.ladder?.open,p&&Math.abs(p.x-240)<=28&&Math.abs(p.y-365)<=28].join('|');if(key===hudKey)return;hudKey=key;
    text('ruScore',S.score.toLocaleString());text('ruKills',S.kills);text('ruRemaining',ladderMode?Math.ceil(S.time):S.queue.length+alive().length||S.total);text('ruBest',S.best.toLocaleString());text('ruHealth',hp);text('ruGuard',guard);
    $('#ruHealthFill').style.width=hp+'%';$('#ruHealthFill').style.background=hp<=35?'#ff5b99':'#d1fa61';
    $('#ruFinisherFill').style.width=S.charge+'%';$('#ruFinisherBtn').classList.toggle('ready',S.charge>=100);$('#ruFinisherBtn').disabled=S.mode!=='playing'||S.charge<100;
    text('ruFinisherText',S.charge>=100?'UNLEASH FINISHER · F':'FINISHER · '+Math.floor(S.charge)+'%');text('ruCareer',S.wins+' career '+(S.wins===1?'win':'wins'));
    if(ladderMode){$('#ruThrowBtn').classList.toggle('lw-set-ready',!!p&&S.ladder?.carrier===p.uid&&Math.abs(p.x-240)<=28&&Math.abs(p.y-365)<=28);$('#ruThrowBtn').firstChild.textContent=p?.climbing?(p.climb>=1?'GRAB':'CLIMBING'):p&&S.ladder?.carrier===p.uid?(Math.abs(p.x-240)<=28&&Math.abs(p.y-365)<=28?'SET HERE':'SET'):S.ladder?.open&&aligned()?'CLIMB':'LADDER';}
  }
  function targetFor(f){
    const locked=S.fighters.find(v=>v.uid===f?.action?.target&&!v.out);
    return locked||nearest(f);
  }
  function coach(){
    if(ladderMode)return;const p=player(),v=p&&!p.out?targetFor(p):null;
    const near=!!v&&distance(p,v)<=68,weak=!!v&&v.hp<=35,ropes=!!v&&edge(v).d<=48,out=near&&weak&&ropes;
    text('ruTarget',v?byId[v.id].name.toUpperCase()+' · '+Math.ceil(v.hp)+' HP':'LAST WRESTLER STANDING WINS');
    text('ruCoach',!p?'STRIKE → WHIP TO ROPES → TOSS OUT':p.out?'Over the ropes — you’re eliminated.':!v?'Stay in the ring. The next entrant is on the way.':p.hp<=35&&edge(p).d<=48?'DANGER · Move away from the ropes. Hold GUARD to resist a throw.':!near?'Move to the pink target. Strike and whip work at close range.':v.guardOn?'They’re guarding. Reposition and strike when their guard drops.':out?'TOSS OUT is ready! Press K or the green button.':weak?'They’re hurt. WHIP them to the ropes, then follow up.':'STRIKE to lower their health. Pink health means they can be tossed out.');
    $('#ruThrowBtn').firstChild.textContent=out?'TOSS OUT':'WHIP';$('#ruThrowBtn').classList.toggle('ru-toss-ready',out);
    $('#ruTarget').classList.toggle('ready',out);
  }
  function fighter(id,isPlayer,x,y){return {id,uid:id,score:0,kills:0,charge:0,human:false,player:isPlayer,x,y,facing:isPlayer?1:-1,hp:100,guard:100,guardOn:false,age:0,walk:false,cool:0,stun:0,invuln:1.1,lastHit:-10,action:null,grabbed:null,out:false,outTime:0,climbing:false,climb:0,pulls:0,misses:0,ladderMisses:0,ladderFalls:0,ladderTips:0,fallTime:0,fallHeight:0,think:Math.random()*.5,target:null,aiWait:.8+Math.random()*.7};}
  function distance(a,b){return Math.hypot(a.x-b.x,(a.y-b.y)*1.35,ladderMode?((a.climb||0)-(b.climb||0))*174:0);}
  function nearest(f){return alive().filter(v=>v!==f&&!v.grabbed).sort((a,b)=>distance(f,a)-distance(f,b))[0];}
  function edge(f){return [{axis:'x',sign:-1,at:B.left,d:f.x-B.left},{axis:'x',sign:1,at:B.right,d:B.right-f.x},{axis:'y',sign:-1,at:B.top,d:f.y-B.top},{axis:'y',sign:1,at:B.bottom,d:B.bottom-f.y}].sort((a,b)=>a.d-b.d)[0];}
  function isHuman(f){return !!(f?.player||f?.human);}
  function award(f,points=0,charge=0,kill=0){
    if(!isHuman(f))return;
    f.score=(f.score||0)+points;f.charge=clamp((f.charge||0)+charge,0,100);f.kills=(f.kills||0)+kill;
    if(f===player()){S.score+=points;S.charge=clamp(S.charge+charge,0,100);S.kills+=kill;f.score=S.score;f.charge=S.charge;f.kills=S.kills;}
  }
  function netStart(role){
    stop();generation++;choose();N={role,phase:'lobby',round:0,localReady:false,peerReady:false,peerFighter:null,loaded:false,peerLoaded:false,tx:0,rx:0,clock:0,inputSeq:0,inputRx:0,remote:{x:0,y:0,hit:false,guard:false},remoteAge:0,pauses:[false,false],resultSaved:false};
    S.mode='ready';text('ruStartBtn','READY FOR VERSUS');text('ruLoadStatus','Choose a wrestler. Both players must be ready.');$('#ruSize').disabled=true;overlays();$('#ruSize').disabled=true;
  }
  function netReady(){
    if(!N)return;if(N.phase==='over'){netLobby(true);}
    if(N.phase!=='lobby'||N.localReady)return;S.selected=$('#ruRoster').value;N.localReady=true;$('#ruRoster').disabled=true;$('#ruStartBtn').disabled=true;text('ruLoadStatus','Ready. Waiting for the other player…');NET.push(game,{k:'ready',fighter:S.selected});maybeNetSetup();
  }
  function maybeNetSetup(){
    if(!N||N.role!=='host'||!N.localReady||!N.peerReady||N.phase!=='lobby')return;
    N.round++;N.phase='loading';N.loaded=false;N.peerLoaded=false;N.tx=0;N.rx=0;N.inputRx=0;N.resultSaved=false;const cfg={k:'setup',round:N.round,fighters:[S.selected,N.peerFighter]};NET.push(game,cfg);initNetMatch(cfg);
  }
  async function initNetMatch(cfg){
    const match=N,token=++generation;stop();S.mode='loading';text('ruLoadStatus','Loading both wrestlers…');overlays();loadingIds=new Set(cfg.fighters);
    try{await Promise.all([loadArena(),...cfg.fighters.map(load)]);}catch(_e){if(N===match){NET.leave();status('Artwork could not load. Please create a new match.');}return;}
    if(N!==match||generation!==token)return;
    Object.assign(S,{mode:'netwait',fighters:cfg.fighters.map((id,i)=>Object.assign(fighter(id,N.role==='host'?i===0:i===1,ladderMode?(i?330:150):(i?310:170),ladderMode?365:280),{uid:'p'+(i+1),human:true,score:0,kills:0,charge:0})),queue:[],entered:2,total:2,score:0,kills:0,charge:0,elapsed:0,time:120,countdown:ladderMode?3:0,nextIn:999,labels:[],banner:'',bannerTime:0,saved:false,won:false,error:'',winner:null,winnerUid:null,ladder:ladderMode?{x:240,y:365,open:false,carrier:null,tilt:0}:null});
    loadingIds.clear();text('ruSaveBtn','SAVE YOUR RECORD');N.loaded=true;N.pauses=[false,false];N.resultSaved=false;overlays();hud();draw();
    if(N.role==='join')NET.push(game,{k:'loaded',round:N.round});else maybeNetGo();
  }
  function maybeNetGo(){if(!N||N.role!=='host'||!N.loaded||!N.peerLoaded)return;N.phase='playing';S.mode='playing';announce('VERSUS · BOTH WRESTLERS READY');NET.push(game,{k:'go',round:N.round});overlays();hud();canvas.focus({preventScroll:true});run();sendFrame();}
  function netLobby(send){
    if(!N)return;const match=N,peerReady=N.phase==='over'&&N.rematchRequested&&N.peerReady;stop();generation++;N=null;choose();N=match;N.phase='lobby';N.localReady=false;N.peerReady=!!peerReady;N.loaded=false;N.peerLoaded=false;N.resultSaved=false;N.remote={x:0,y:0,hit:false,guard:false};
    text('ruStartBtn','READY FOR VERSUS');text('ruLoadStatus','Choose a wrestler for the rematch.');$('#ruSize').disabled=true;if(send)NET.push(game,{k:'lobby',round:N.round});
  }
  function netEnd(){if(!N)return;N=null;generation++;stop();choose();text('ruStartBtn',ladderMode?'CHASE THE GOLD':'RING THE BELL');$('#ruRoster').disabled=false;$('#ruSize').disabled=false;status('Online match ended. You can play solo or invite a friend.');}
  function controlVector(){let x=stick.x+(held.has('right')?1:0)-(held.has('left')?1:0),y=stick.y+(held.has('down')?1:0)-(held.has('up')?1:0);const len=Math.hypot(x,y);if(len>1){x/=len;y/=len;}return{x,y,hit:held.has('hit'),guard:guards.size>0};}
  function netInput(action){if(!N||N.phase!=='playing'||S.mode!=='playing')return;NET.push(game,{k:'input',round:N.round,seq:++N.inputSeq,...controlVector(),...(action?{action,...(ladderMode&&action==='throw'?{grabAt:S.elapsed}:{})}:{})});}
  function netTick(dt){
    if(!N||N.phase!=='playing')return false;N.clock+=dt;
    if(N.role==='join'){if(N.clock>=.05){N.clock=0;netInput();}return true;}
    N.remoteAge+=dt;if(N.remoteAge>.35)N.remote={x:0,y:0,hit:false,guard:false};return false;
  }
  function sendFrame(){
    if(!N||N.role!=='host'||!N.loaded||!N.peerLoaded)return;
    NET.push(game,{k:'frame',round:N.round,seq:++N.tx,mode:S.mode,elapsed:S.elapsed,time:S.time,countdown:S.countdown,total:2,fighters:S.fighters,ladder:S.ladder,winner:S.winner,winnerUid:S.winnerUid,banner:S.banner,bannerTime:S.bannerTime,pauses:N.pauses});
  }
  function netPause(force){
    if(!N||!['playing','paused'].includes(S.mode))return;
    const slot=N.role==='host'?0:1,paused=force===true||!N.pauses[slot];N.pauses[slot]=paused;clearInput();
    if(N.role==='join'){NET.push(game,{k:'pause',round:N.round,paused});if(paused){S.mode='paused';stop();overlays();}else text('ruPauseNote','Waiting for both players to resume…');}
    else applyNetPause();
  }
  function applyNetPause(){
    if(!N)return;const paused=N.pauses.some(Boolean);S.mode=paused?'paused':'playing';if(paused)stop();else{canvas.focus({preventScroll:true});run();}overlays();hud();draw();text('ruPauseNote',paused?'Both players must resume before the match continues.':'Your match is ready.');sendFrame();
  }
  function validFighter(f){
    if(!f||!byId[f.id]||!['p1','p2'].includes(f.uid))return false;
    if(!['x','y','hp','guard','age','cool','stun','invuln','outTime','climb','fallTime','score','kills','charge','ladderMisses','ladderFalls','ladderTips'].every(k=>Number.isFinite(f[k])))return false;
    if(Math.abs(f.x)>1000||Math.abs(f.y)>1000||f.hp<0||f.hp>100||f.score<0||f.score>1000000||f.climb<0||f.climb>1)return false;
    if(f.action&&(!['light','heavy','hurt','throw','tip','down'].includes(f.action.kind)||!Number.isFinite(f.action.t)||!Number.isFinite(f.action.duration)||f.action.duration<=0))return false;
    if(f.out&&(!f.exit||!Number.isFinite(f.exit.x)||!Number.isFinite(f.exit.y)||!['x','y'].includes(f.exit.axis)||![-1,1].includes(f.exit.sign)))return false;
    return true;
  }
  function netApply(d){
    if(!N||!d||typeof d!=='object')return;
    if(d.k==='ready'&&(N.phase==='lobby'||N.phase==='over'&&N.rematchRequested)&&byId[d.fighter]){N.peerReady=true;N.peerFighter=d.fighter;maybeNetSetup();return;}
    if(d.k==='setup'&&N.role==='join'&&N.localReady&&['lobby','over'].includes(N.phase)&&Number.isSafeInteger(d.round)&&d.round>N.round&&Array.isArray(d.fighters)&&d.fighters.length===2&&d.fighters.every(id=>byId[id])&&d.fighters[1]===S.selected){N.round=d.round;N.phase='loading';N.rx=0;N.inputSeq=0;initNetMatch(d);return;}
    if(d.round!==N.round)return;
    if(d.k==='loaded'&&N.role==='host'&&N.phase==='loading'){N.peerLoaded=true;maybeNetGo();return;}
    if(d.k==='go'&&N.role==='join'&&N.loaded&&N.phase==='loading'){N.phase='playing';S.mode='playing';overlays();hud();canvas.focus({preventScroll:true});run();netInput();return;}
    if(d.k==='input'&&N.role==='host'&&N.phase==='playing'&&S.mode==='playing'&&Number.isSafeInteger(d.seq)&&d.seq>N.inputRx&&Number.isFinite(d.x)&&Number.isFinite(d.y)&&Math.abs(d.x)<=1&&Math.abs(d.y)<=1){N.inputRx=d.seq;N.remoteAge=0;N.remote={x:d.x,y:d.y,hit:d.hit===true,guard:d.guard===true};if(['hit','throw','finish'].includes(d.action))act(d.action,S.fighters.find(f=>f.uid==='p2'),Number.isFinite(d.grabAt)&&Math.abs(S.elapsed-d.grabAt)<=.3?d.grabAt:S.elapsed);return;}
    if(d.k==='pause'&&N.role==='host'&&typeof d.paused==='boolean'&&N.phase==='playing'){N.pauses[1]=d.paused;applyNetPause();return;}
    if(d.k==='lobby'&&N.phase==='over'){N.rematchRequested=true;status('Your opponent wants a rematch. Run it back when you’re ready.');return;}
    if(d.k!=='frame'||N.role!=='join'||!['playing','over'].includes(N.phase)||!Number.isSafeInteger(d.seq)||d.seq<=N.rx)return;
    if(!['playing','paused','over'].includes(d.mode)||!Number.isFinite(d.elapsed)||d.elapsed<0||!Number.isFinite(d.time)||!Array.isArray(d.fighters)||d.fighters.length!==2||!d.fighters.every(validFighter)||new Set(d.fighters.map(f=>f.uid)).size!==2)return;
    if(ladderMode&&(!d.ladder||!Number.isFinite(d.ladder.x)||!Number.isFinite(d.ladder.y)||typeof d.ladder.open!=='boolean'||d.ladder.carrier&&!['p1','p2'].includes(d.ladder.carrier)))return;
    const resuming=S.mode==='paused'&&d.mode==='playing';N.rx=d.seq;S.mode=d.mode;if(resuming)canvas.focus({preventScroll:true});S.fighters=d.fighters.map(f=>({...f,player:f.uid==='p2',human:true}));S.elapsed=d.elapsed;S.countdown=clamp(Number(d.countdown)||0,0,3);S.time=clamp(d.time,0,120);S.ladder=d.ladder;S.winner=byId[d.winner]?d.winner:null;S.winnerUid=['p1','p2'].includes(d.winnerUid)?d.winnerUid:null;
    S.banner=typeof d.banner==='string'?d.banner.slice(0,100):'';S.bannerTime=clamp(Number(d.bannerTime)||0,0,3);if(Array.isArray(d.pauses)&&d.pauses.length===2)N.pauses=d.pauses.map(v=>v===true);
    const p=player();S.score=p.score;S.kills=p.kills;S.charge=p.charge;
    if(S.mode==='over'&&!N.resultSaved){N.resultSaved=true;N.phase='over';N.peerReady=false;N.localReady=false;N.rematchRequested=false;S.won=S.winnerUid==='p2';S.best=Math.max(S.best,S.score);store.set('best',S.best);if(S.won){S.wins++;store.set('wins',S.wins);}stop();presentResult();}
    else if(S.mode==='paused')stop();else run();overlays();hud();draw();
  }

  function ladderNear(f){return Math.hypot(f.x-S.ladder.x,(f.y-S.ladder.y)*1.2)<62;}
  function aligned(){return Math.abs(S.ladder.x-240)<=28&&Math.abs(S.ladder.y-365)<=28;}
  function fall(f){
    if(!f.climbing)return;f.ladderFalls++;f.fallHeight=f.climb*174;f.fallTime=.55;f.climbing=false;f.climb=0;f.misses=0;f.stun=1.65;f.hp=Math.max(1,f.hp-25);f.action={kind:'hurt',t:0,duration:1.65};label(f,'KNOCKED DOWN','#ff8db6');
  }
  function tip(f){
    const victims=S.fighters.filter(v=>v!==f&&v.climbing);if(!victims.length||!ladderNear(f))return false;
    victims.forEach(fall);f.ladderTips++;S.ladder.tilt=.8;S.ladder.open=false;S.ladder.x=clamp(S.ladder.x+(f.x<S.ladder.x?22:-22),90,390);label(f,'TIMBER!','#ffe29d');award(f,100);Sound.play('hit');return true;
  }
  function ladderAction(f,attemptAt=S.elapsed){
    const l=S.ladder;if(f.climbing){
      if(f.climb<1){if(f.player)status('Keep climbing. Move down to descend.');return false;}
      const needle=grabNeedle(f,attemptAt);f.cool=.4;
      if(needle>=.38&&needle<=.64){f.pulls++;f.misses=0;label(f,f.pulls+' / 4','#e0ff9e');if(isHuman(f)){award(f,250);f.kills=f.pulls;if(f===player())S.kills=f.pulls;}Sound.play('bell');if(f.pulls>=4){S.winner=f.id;S.winnerUid=f.uid;finish(f===player());}}
      else{f.misses++;f.ladderMisses++;label(f,'SLIPPED!','#ff9dc4');if(f.misses>=2)fall(f);else if(f.player)status('One more miss and you fall. Aim for green.');}
      return true;
    }
    if(l.carrier===f.uid){l.carrier=null;l.open=true;l.x=f.x;l.y=f.y;if(Math.abs(l.x-240)<=28)l.x=240;if(Math.abs(l.y-365)<=28)l.y=365;f.cool=.3;label(f,aligned()?'LINED UP':'MOVE TO THE GLOW',aligned()?'#dfff95':'#ffd999');return true;}
    if(l.carrier||!ladderNear(f)){if(f.player)status('Move closer to the ladder.');return false;}
    if(l.open&&aligned()){
      if(S.fighters.filter(v=>v.climbing).length>=2){if(f.player)status('Both sides are occupied. Tip the ladder to clear it.');return false;}
      const other=S.fighters.find(v=>v.climbing);f.climbSide=other?-other.climbSide:f.x<l.x?-1:1;f.x=l.x+f.climbSide*19;f.y=l.y;f.climbing=true;f.climb=0;f.cool=.25;f.misses=0;f.facing=-f.climbSide;if(f.player)status('CLIMBING · Reach the top, then time your grabs.');return true;
    }
    if(S.fighters.some(v=>v.climbing))return false;l.carrier=f.uid;l.open=false;f.cool=.3;if(f.player)status('Carry the ladder to the glowing centre mark.');return true;
  }
  function grabNeedle(f,at=S.elapsed){return (Math.sin(at*4.1+(N?(f.uid==='p1'?0:1.3):(f.player?0:1.3)))+1)/2;}
  function aiLadder(f,dt){
    const l=S.ladder,p=player(),climber=S.fighters.find(v=>v!==f&&v.climbing);
    if(f.climbing){if(f.climb>=1&&f.cool<=0&&grabNeedle(f)>.42&&grabNeedle(f)<.6)ladderAction(f);return;}
    let tx=l.x,ty=l.y;
    if(l.carrier===f.uid){tx=240;ty=365;}
    else if(l.carrier){const carrier=S.fighters.find(v=>v.uid===l.carrier);if(carrier){tx=carrier.x;ty=carrier.y;}}
    const close=nearest(f);f.aiWait=Math.max(0,f.aiWait-dt);
    if(close&&distance(f,close)<60&&!close.climbing&&f.aiWait<=0&&(l.carrier&&l.carrier!==f.uid||close.player&&close.action||f.hp<40)){act('hit',f);f.aiWait=.8;return;}
    if(climber&&ladderNear(f)){if(f.aiWait<=0){act('hit',f);f.aiWait=1.4;}return;}
    const dx=tx-f.x,dy=ty-f.y,len=Math.hypot(dx,dy);
    if(len>(l.carrier===f.uid?12:34)){const speed=byId[f.id].speed*(l.carrier===f.uid?49:68);f.x+=dx/len*speed*dt;f.y+=dy/len*speed*dt;f.walk=true;if(Math.abs(dx)>3)f.facing=Math.sign(dx);}
    else if(f.cool<=0)ladderAction(f);
    // A nearby rival stays in play; nobody targets an unrelated canvas position.
    if(p&&p.out)f.target=null;
  }
  function paintBelt(c,x,y,scale=1){
    c.save();c.translate(x,y);c.scale(scale,scale);c.lineJoin='round';c.fillStyle='#19121b';c.strokeStyle='#edc374';c.lineWidth=1.8;c.beginPath();c.roundRect(-48,-13,96,27,7);c.fill();c.stroke();
    const gold=c.createLinearGradient(-25,-20,25,24);gold.addColorStop(0,'#fff0b4');gold.addColorStop(.25,'#c28b31');gold.addColorStop(.5,'#ffe7a1');gold.addColorStop(1,'#8a5627');
    c.fillStyle=gold;c.strokeStyle='#fee7af';for(const xx of [-34,34]){c.beginPath();c.roundRect(xx-7,-9,14,19,3);c.fill();c.stroke();}path(c,[[-21,-19],[21,-19],[27,0],[15,23],[-15,23],[-27,0]],gold,'#ffebae');oval(c,0,0,15,14,'#35203b','#ddbb67');c.fillStyle='#ffe99f';c.font='10px '+FONT;c.textAlign='center';c.fillText('JCW',0,3);c.font='5px '+FONT;c.fillText('LADDER WARS',0,16);for(const xx of [-43,43])for(const yy of [-5,5])oval(c,xx,yy,1.2,1.2,'#f0cd88');c.restore();
  }
  function makeLadderScenery(){
    scenery=document.createElement('canvas');scenery.width=W*2;scenery.height=H*2;const c=scenery.getContext('2d');c.scale(2,2);c.fillStyle='#100a17';c.fillRect(0,0,W,H);
    if(arenaImage?.complete&&arenaImage.naturalWidth){const sw=arenaImage.height*W/H;c.drawImage(arenaImage,(arenaImage.width-sw)/2,0,sw,arenaImage.height,0,0,W,H);}
    const shade=c.createLinearGradient(0,160,0,H);shade.addColorStop(0,'#0c071422');shade.addColorStop(1,'#0c0714bb');c.fillStyle=shade;c.fillRect(0,150,W,H-150);
    c.textAlign='center';c.font='9px '+FONT;c.fillStyle='#dbc48b';c.fillText('JUGGALO CHAMPIONSHIP WRESTLING',240,21);
    for(let x=44;x<440;x+=25){c.strokeStyle='#726b77';c.lineWidth=2;path(c,[[x,37],[x+25,51],[x,51],[x+25,37]],null,'#6d6371');}path(c,[[38,37],[442,37],[442,52],[38,52],[38,37]],null,'#a69598');
    path(c,[[43,270],[437,270],[455,423],[25,423]],'#382940','#be9c67');path(c,[[25,423],[455,423],[450,451],[30,451]],'#170e23','#8e633e');
    const mat=c.createLinearGradient(0,273,0,424);mat.addColorStop(0,'#635767');mat.addColorStop(.5,'#9e8c92');mat.addColorStop(1,'#675362');path(c,[[52,274],[428,274],[445,418],[35,418]],mat);
    c.save();c.translate(240,353);c.scale(1,.48);oval(c,0,0,82,82,'#59405b','#cbb685');c.font='50px '+FONT;c.fillStyle='#cfb994';c.fillText('JCW',0,8);c.font='13px '+FONT;c.fillText('CLIMB THROUGH THE CHAOS',0,34);c.restore();
    c.font='19px '+FONT;c.fillStyle='#edd492';c.fillText('L A D D E R   W A R S',240,444);
    c.lineWidth=2.5;for(let i=0;i<3;i++)path(c,[[43,217+i*22],[437,217+i*22]],null,i===0?'#dfd6a6':'#bc518c');
    for(const x of [43,437]){c.fillStyle='#21152a';c.fillRect(x-4,198,8,80);for(let i=0;i<3;i++){c.fillStyle=i===0?'#cfb57c':'#692e50';c.fillRect(x-9,211+i*22,18,12);}}
  }
  function paintLadder(c){
    const l=S.ladder;if(!l)return;
    c.save();oval(c,240,365,36,10,'#c5fc431c','#d6ef8399');c.setLineDash([4,4]);oval(c,240,365,29,8,null,'#d6ef83');c.setLineDash([]);
    let x=l.x,y=l.y;if(l.carrier){const f=S.fighters.find(v=>v.uid===l.carrier);if(f){x=f.x+f.facing*22;y=f.y-12;}}
    c.translate(x,y);if(l.tilt>0)c.rotate(Math.sin(l.tilt*8)*.3);else if(l.carrier)c.rotate(-.18);const height=l.open?174:85,spread=l.open?27:11;
    oval(c,0,3,spread+12,7,'#0f091857');c.lineCap='round';c.lineWidth=6;path(c,[[-spread,0],[-13,-height],[13,-height],[spread,0]],null,'#302938');c.lineWidth=3;path(c,[[-spread,0],[-13,-height],[13,-height],[spread,0]],null,'#d2d5ce');
    c.lineWidth=4;for(let yy=15;yy<height;yy+=19){const w=spread-(spread-13)*yy/height;path(c,[[-w,-yy],[w,-yy]],null,'#30303d');c.lineWidth=2;path(c,[[-w,-yy-1],[w,-yy-1]],null,'#e6ded1');c.lineWidth=4;}
    c.fillStyle='#d9b769';c.fillRect(-16,-height-4,32,5);c.fillStyle='#201526';c.fillRect(-spread-3,-2,9,5);c.fillRect(spread-5,-2,9,5);c.restore();
    c.save();const swing=Math.sin(S.elapsed*1.5)*2;c.strokeStyle='#b8a48c';c.lineWidth=2;path(c,[[240,52],[240+swing,98]],null,'#b8a48c');for(let yy=56;yy<96;yy+=6)oval(c,240+swing*(yy-52)/46,yy,2,3,null,'#d4bc85');paintBelt(c,240+swing,119,1.03);c.restore();
    const p=player();if(p?.climbing&&p.climb>=1){const needle=grabNeedle(p);c.fillStyle='#130c1bee';c.fillRect(130,157,220,43);c.fillStyle='#c7c0c9';c.font='10px '+FONT;c.textAlign='center';c.fillText('TIME YOUR GRAB · '+p.pulls+' / 4',240,171);c.fillStyle='#5b344d';c.fillRect(149,181,182,7);c.fillStyle='#d1ed6b';c.fillRect(149+182*.38,180,182*.26,9);path(c,[[149+182*needle,177],[145+182*needle,190],[153+182*needle,190]],'#fff1bf');}
  }
  function frontRopes(){
    const back=ladderMode?217:120,front=ladderMode?354:294,post=ladderMode?334:274,bottom=ladderMode?423:366;
    ctx.lineWidth=3;for(let i=0;i<3;i++){path(ctx,[[ladderMode?43:40,back+i*22],[24,front+i*22]],null,'#c59eb7');path(ctx,[[ladderMode?437:440,back+i*22],[456,front+i*22]],null,'#c59eb7');ctx.globalAlpha=.6;path(ctx,[[24,front+i*22],[456,front+i*22]],null,i===0?'#d6d395':'#ce5d99');ctx.globalAlpha=1;}
    for(const x of [24,456]){ctx.fillStyle='#18131f';ctx.fillRect(x-5,post,10,bottom-post);for(let i=0;i<3;i++){ctx.fillStyle=i===0?'#c5b576':'#733356';ctx.fillRect(x-11,front-7+i*22,22,12);}}
  }

  function confine(f){f.x=clamp(f.x,B.left,B.right);f.y=clamp(f.y,B.top,B.bottom);}
  function label(f,value,color='#d9ff83'){S.labels.push({x:f.x,y:f.y-90,value,color,t:.85});if(S.labels.length>12)S.labels.shift();}
  function cancelMove(f){if(f.action?.target){const v=S.fighters.find(v=>v.uid===f.action.target);if(v?.grabbed===f.uid)v.grabbed=null;}f.action=null;}
  function damage(v,amount,from,push=0){
    if(v.out||v.invuln>0||v.grabbed)return false;
    if(v.guardOn&&v.guard>=12){v.guard=Math.max(0,v.guard-24);label(v,'BLOCK','#aeb9ff');v.hp=Math.max(1,v.hp-amount*.1);v.lastHit=S.elapsed;return false;}
    cancelMove(v);if(ladderMode&&S.ladder.carrier===v.uid){S.ladder.carrier=null;S.ladder.x=v.x;S.ladder.y=v.y;}if(ladderMode&&v.climbing)fall(v);v.hp=Math.max(1,v.hp-amount);v.lastHit=S.elapsed;v.stun=.24;v.action={kind:'hurt',t:0,duration:.32};if(ladderMode&&v.hp<=1){v.stun=7;v.action={kind:'down',t:0,duration:7};label(v,'DOWN!','#ffe2a1');}
    if(push){const e=edge(v);v[e.axis]+=e.sign*push;confine(v);}
    label(v,'−'+Math.round(amount),'#fff0cc');if(isHuman(from)){award(from,25,13);Sound.play('hit');}return true;
  }
  function act(kind,f=player(),attemptAt=S.elapsed){
    if(S.countdown>0)return false;
    if(N?.role==='join'){if(['hit','throw','finish'].includes(kind)&&S.mode==='playing')netInput(kind);return false;}
    if(S.mode!=='playing'||!f||f.out||f.grabbed||f.stun>0||f.action||f.cool>0)return false;
    if(ladderMode&&kind==='throw')return ladderAction(f,attemptAt);
    if(ladderMode&&kind==='hit'&&!f.climbing&&S.fighters.some(v=>v!==f&&v.climbing)&&ladderNear(f)){f.action={kind:'tip',t:0,duration:.65,hit:false};f.cool=.8;return true;}
    if(kind==='finish'){
      if(!isHuman(f)||(f===player()?S.charge:f.charge)<100)return false;if(f===player())S.charge=0;f.charge=0;f.guardOn=false;f.action={kind:'heavy',t:0,duration:.72,hit:false};f.invuln=.75;f.cool=.85;announce(byId[f.id].name.toUpperCase()+' · FINISHER!');return true;
    }
    if(!['hit','throw'].includes(kind))return false;
    const v=targetFor(f);f.guardOn=false;
    if(v&&Math.abs(v.x-f.x)>2)f.facing=Math.sign(v.x-f.x);
    if(kind==='throw'){
      if(!v||distance(f,v)>68){if(f.player)status('Get closer to grab an opponent.');return false;}
      if(v.invuln>0){if(f.player)status('Let the new entrant get into the ring.');return false;}
      if(v.guardOn&&v.guard>=12){v.guard=Math.max(0,v.guard-30);f.cool=.55;label(v,'RESISTED','#aeb9ff');return false;}
      const e=edge(v),ringOut=v.hp<=35&&e.d<=48;
      cancelMove(v);v.whip=null;v.grabbed=f.uid;f.action={kind:'throw',t:0,duration:.85,hit:false,target:v.uid,edge:e,ringOut};f.cool=.95;
      if(f.player)status(ringOut?'OVER THE ROPES!':'IRISH WHIP · Follow them to the ropes, then strike or toss out.');
    }else{f.action={kind:'light',t:0,duration:isHuman(f)?.4:.65,hit:false,target:v?.uid};f.cool=isHuman(f)?.43:.9;}
    return true;
  }
  function eliminate(v,from,e){
    if(v.out)return;cancelMove(v);v.grabbed=null;v.out=true;v.outTime=0;v.exit={x:v.x,y:v.y,axis:e.axis,sign:e.sign};
    label(v,'OUT!','#ff78bd');
    if(isHuman(from)){const chain=S.elapsed-(from.lastKill??-99)<=12?(from.chain||0)+1:1;from.chain=chain;from.lastKill=S.elapsed;if(from===player()){S.chain=chain;S.lastKill=S.elapsed;}const points=500+Math.min(4,chain-1)*100;award(from,points,20,1);announce(byId[v.id].name.toUpperCase()+' OUT · +'+points);Sound.play('bell');}
    else announce(byId[v.id].name.toUpperCase()+' ELIMINATED');
    S.nextIn=Math.min(S.nextIn,2.2);
  }
  function resolve(f){
    const a=f.action;if(!a||a.hit||a.t<(a.kind==='throw'?.46:a.kind==='heavy'?.3:isHuman(f)?.13:.3))return;a.hit=true;
    if(a.kind==='tip'){tip(f);}
    else if(a.kind==='light'){
      const v=S.fighters.find(v=>v.uid===a.target);if(v&&!v.out&&distance(f,v)<=76)damage(v,(isHuman(f)?27:14)*byId[f.id].power/byId[v.id].toughness,f,8);
    }else if(a.kind==='heavy'){
      for(const v of alive())if(v!==f&&distance(f,v)<125)damage(v,44,f,65);
      label(f,'FINISHER!','#ffe185');Sound.play('launch');
    }else if(a.kind==='throw'){
      const v=S.fighters.find(v=>v.uid===a.target);if(!v||v.out||v.grabbed!==f.uid)return;
      v.grabbed=null;
      if(a.ringOut)eliminate(v,f,a.edge);
      else{v.hp=Math.max(1,v.hp-12);v.lastHit=S.elapsed;v.whip={x:v.x,y:v.y,toX:clamp(v.x+(a.edge.axis==='x'?a.edge.sign*72:0),B.left,B.right),toY:clamp(v.y+(a.edge.axis==='y'?a.edge.sign*72:0),B.top,B.bottom),t:0};v.stun=1.15;v.action={kind:'hurt',t:0,duration:1.15};label(v,'IRISH WHIP','#f5d984');}
    }
  }
  function spawn(){
    if(!S.queue.length||alive().length>=4)return false;const id=S.queue[0];if(!art.get(id)?.image){prefetch();return false;}
    S.queue.shift();S.entered++;const side=S.entered%2;const opening=S.entered<=3;const f=fighter(id,false,opening?265+(S.entered-2)*70:side?380:100,opening?210:205+Math.random()*78);S.fighters.push(f);S.nextIn=8;announce('ENTRANT '+S.entered+' / '+S.total+' · '+byId[id].name.toUpperCase());prefetch();return true;
  }
  function ai(f,dt){
    if(ladderMode){aiLadder(f,dt);return;}
    f.think-=dt;f.aiWait=Math.max(0,f.aiWait-dt);
    if(f.think<=0||!S.fighters.some(v=>v.uid===f.target&&!v.out&&!v.grabbed)){f.target=nearest(f)?.uid;f.think=.6;}
    const v=S.fighters.find(v=>v.uid===f.target);if(!v||v.out||v.grabbed)return;
    const dist=distance(f,v);if(Math.abs(v.x-f.x)>3)f.facing=Math.sign(v.x-f.x);
    f.guardOn=!!(v.action?.kind==='light'&&v.action.t<.25&&f.guard>35&&f.age%3<.65&&dist<85);
    if(dist>52){const dx=v.x-f.x,dy=v.y-f.y,len=Math.hypot(dx,dy)||1,speed=70*byId[f.id].speed*(f.guardOn?.4:1);f.x+=dx/len*speed*dt;f.y+=dy/len*speed*dt*.8;f.walk=true;}
    else if(f.aiWait<=0&&!f.guardOn){const needsThrow=v.hp<=35||v.hp<65&&f.age%4<1.4;act(needsThrow?'throw':'hit',f);f.aiWait=.35+Math.random()*.55;}
  }
  function step(dt){
    if(S.mode!=='playing'||!Number.isFinite(dt)||dt<=0)return;dt=Math.min(dt,.05);if(netTick(dt))return;
    // The match clock and every fighter stay still until the same opening bell.
    if(S.countdown>0){S.countdown=Math.max(0,S.countdown-dt);if(S.countdown===0){announce('GO! · CHASE THE GOLD');Sound.play('bell');}hud();if(N?.role==='host'&&N.clock>=.05){N.clock=0;sendFrame();}return;}
    S.elapsed+=dt;S.nextIn=Math.max(0,S.nextIn-dt);S.bannerTime=Math.max(0,S.bannerTime-dt);
    S.labels.forEach(l=>{l.t-=dt;l.y-=18*dt;});S.labels=S.labels.filter(l=>l.t>0);
    const p=player();
    if(ladderMode){S.time=Math.max(0,120-S.elapsed);S.ladder.tilt=Math.max(0,S.ladder.tilt-dt);}
    for(const f of S.fighters){
      f.age+=dt;f.walk=false;if(f.whip){const w=f.whip;w.t=Math.min(.32,w.t+dt);const t=1-(1-w.t/.32)**2;f.x=w.x+(w.toX-w.x)*t;f.y=w.y+(w.toY-w.y)*t;if(w.t>=.32)f.whip=null;}f.fallTime=Math.max(0,f.fallTime-dt);
      if(f.out){f.outTime+=dt;continue;}
      f.cool=Math.max(0,f.cool-dt);f.stun=Math.max(0,f.stun-dt);f.invuln=Math.max(0,f.invuln-dt);
      if(f.action){f.action.t+=dt;resolve(f);if(f.action&&f.action.t>=f.action.duration){if(f.action.kind==='down')f.hp=55;cancelMove(f);}}
      f.guardOn=false;
      if(f.grabbed||f.action||f.stun>0)continue;
      if(ladderMode&&f.climbing){if((f===player()&&(held.has('down')||stick.y>.5))||(f.human&&f!==player()&&N?.remote.y>.5)){f.climb=Math.max(0,f.climb-dt*.8);if(f.climb<=0){f.climbing=false;f.x+=f.climbSide*23;f.cool=.3;}}else f.climb=Math.min(1,f.climb+dt*.34*byId[f.id].speed);if(!isHuman(f))aiLadder(f,dt);continue;}
      if(isHuman(f)){
        const input=f===player()?controlVector():N?.remote||{x:0,y:0,hit:false,guard:false};f.guardOn=input.guard&&f.guard>=8;
        let dx=input.x,dy=input.y;const len=Math.hypot(dx,dy);if(len>1){dx/=len;dy/=len;}
        const speed=123*byId[f.id].speed*(f.guardOn?.48:1)*(ladderMode&&S.ladder.carrier===f.uid?.6:1);f.x+=dx*speed*dt;f.y+=dy*speed*.8*dt;f.walk=Math.hypot(dx,dy)>.12;if(Math.abs(dx)>.1)f.facing=Math.sign(dx);
        if(input.hit&&!f.guardOn)act('hit',f);
      }else ai(f,dt);
      f.guard=clamp(f.guard+(f.guardOn?-30:22)*dt,0,100);
      if(S.elapsed-f.lastHit>5)f.hp=Math.min(f.hp+dt*1.2,100);
      confine(f);
    }
    const fighters=alive();
    for(let i=0;i<fighters.length;i++)for(let j=i+1;j<fighters.length;j++){
      const a=fighters[i],b=fighters[j];if(a.climbing||b.climbing||a.grabbed||b.grabbed||a.action?.kind==='throw'||b.action?.kind==='throw')continue;
      const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);if(len<25){const ux=len?dx/len:1,uy=len?dy/len:0,amount=(25-len)/2;a.x-=ux*amount;a.y-=uy*amount;b.x+=ux*amount;b.y+=uy*amount;confine(a);confine(b);}
    }
    S.fighters=S.fighters.filter(f=>!f.out||f.player||f.outTime<1.25);
    if(p?.out&&p.outTime>=.85){finish(false);return;}
    if(ladderMode){if(S.time<=0)finish(false);}else if(S.nextIn<=0)spawn();
    if(!ladderMode&&p&&!p.out&&S.queue.length===0&&alive().length===1)finish(true);
    if(S.elapsed%1<dt)cleanCache();hud();if(N?.role==='host'&&N.clock>=.05){N.clock=0;sendFrame();}
  }
  async function start(){
    if(N){netReady();return;}
    stop();const token=++generation;S.mode='loading';S.error='';text('ruLoadStatus','Getting your wrestlers ready…');overlays();
    S.selected=$('#ruRoster').value;S.total=ladderMode?(Number($('#ruSize').value)===4?4:2):(Number($('#ruSize').value)===12?12:roster.length);store.set('selected',S.selected);
    const ids=roster.filter(r=>r.id!==S.selected).map(r=>r.id);for(let i=ids.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[ids[i],ids[j]]=[ids[j],ids[i]];}
    const queue=ids.slice(0,S.total-1);loadingIds=new Set([S.selected,...queue.slice(0,ladderMode?3:2)]);
    try{await Promise.all([loadArena(),...[S.selected,...queue.slice(0,ladderMode?3:2)].map(load)]);}catch(_e){if(token!==generation)return;S.mode='ready';text('ruLoadStatus','Artwork could not load. Tap Ring the Bell to retry.');overlays();return;}
    if(token!==generation||!active)return;
    Object.assign(S,{mode:'playing',fighters:[fighter(S.selected,true,ladderMode?150:230,ladderMode?370:280)],queue,entered:1,elapsed:0,nextIn:8,score:0,kills:0,chain:0,lastKill:-99,charge:0,labels:[],banner:'',bannerTime:0,saved:false,won:false,error:'',time:120,countdown:ladderMode?3:0,ladder:ladderMode?{x:180,y:370,open:false,carrier:null,tilt:0}:null,winner:null});
    if(ladderMode){while(S.queue.length){const id=S.queue.shift();S.fighters.push(fighter(id,false,330+(S.entered%2)*30,310+(S.entered%3)*25));S.entered++;}announce('CHASE THE GOLD · SET THE LADDER IN THE GLOW');}else{spawn();spawn();announce('RING THE BELL · LAST LUNATIC STANDING');}loadingIds.clear();text('ruLoadStatus','');$('#ruSaveBtn').disabled=false;text('ruSaveBtn','SAVE YOUR RECORD');overlays();hud();draw();window.scrollTo(0,0);canvas.focus({preventScroll:true});Sound.play('bell');run();
  }
  function finish(won){
    if(S.mode!=='playing')return;S.mode='over';S.won=won;if(N){if(!S.winnerUid&&!ladderMode)S.winnerUid=S.fighters.find(f=>!f.out)?.uid||null;const winner=S.fighters.find(f=>f.uid===S.winnerUid);if(winner)award(winner,2000+(ladderMode?Math.ceil(S.time)*10:0));N.phase='over';N.peerReady=false;N.localReady=false;N.rematchRequested=false;}else if(won)award(player(),2000+(ladderMode?Math.ceil(S.time)*10:0));if(won){S.wins++;store.set('wins',S.wins);}S.best=Math.max(S.best,S.score);store.set('best',S.best);stop();presentResult();if(N)sendFrame();
  }
  function presentResult(){
    const won=S.won;
    text('ruResultKicker',won?(ladderMode?'LADDER WARS CHAMPION':'JCW RUMBLE CHAMPION'):(ladderMode?'THE GOLD GOT AWAY':'OVER THE ROPES'));text('ruResultTitle',won?(ladderMode?'YOU OWN THE GOLD.':'LAST LUNATIC STANDING'):'GET BACK IN THERE.');text('ruFinalScore',S.score.toLocaleString());text('ruResultDetail',S.kills+(ladderMode?' belt grabs · ':' eliminations · ')+Math.floor(S.elapsed/60)+':'+String(Math.floor(S.elapsed%60)).padStart(2,'0')+(ladderMode?' elapsed · '+(S.winner?byId[S.winner].name+' claimed the belt':'Time expired'):' survived · '+S.total+' entrants'));
    $('#ruSaveBtn').disabled=S.score<=0;overlays();hud();status(ladderMode?(won?'You claimed the gold. Champion!':'The belt got away. Your best score is saved.'):(won?'You cleared the whole field. Champion!':'You were eliminated. Your best score is saved.'));$('#ruAgainBtn').focus({preventScroll:true});Sound.play(won?'fanfare':'bell');
    const p=player();
    try{window.__arcSend&&window.__arcSend({ev:game,score:S.score,kills:S.kills,won,roster:S.selected,entrants:S.total,...(ladderMode?{
      resultId:crypto.randomUUID(),grabs:p.pulls,misses:p.ladderMisses,falls:p.ladderFalls,tips:p.ladderTips,elapsed:S.elapsed,online:!!N
    }:{})});}catch(_e){}
  }
  function pause(force){
    if(N){netPause(force);return;}
    if(S.mode==='playing'){S.mode='paused';stop();}
    else if(S.mode==='paused'&&force!==true){S.error='';S.mode='playing';prefetch();run();canvas.focus({preventScroll:true});}else return;
    overlays();hud();draw();
  }
  function choose(){if(N){if(['over','lobby'].includes(N.phase))netLobby(true);return;}stop();generation++;S.mode='ready';S.fighters=[];S.queue=[];S.score=0;S.kills=0;S.charge=0;S.error='';S.bannerTime=0;text('ruLoadStatus','');overlays();hud();portrait();draw();}
  function leave(){if(S.mode==='loading'){generation++;S.mode='ready';text('ruLoadStatus','');}pause(true);active=false;stop();if(ladderMode){$('#ruScreen').classList.remove('lw-match');document.body.classList.remove('ladder-match');}}
  function enter(){active=true;resize();overlays();hud();portrait();draw();TICK.set(ladderMode?'LADDER WARS — CLIMB THROUGH THE CHAOS. CLAIM THE GOLD.':'JCW RUMBLE — OVER THE ROPES. LAST LUNATIC STANDING.','LUNACY UNLOCKED');}
  function resize(){const dpr=Math.min(devicePixelRatio||1,2);canvas.width=W*dpr;canvas.height=H*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);draw();}
  function oval(c,x,y,rx,ry,fill,stroke){c.beginPath();c.ellipse(x,y,rx,ry,0,0,Math.PI*2);if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.stroke();}}
  function path(c,points,fill,stroke){c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));if(fill){c.closePath();c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.stroke();}}
  function makeScenery(){
    if(ladderMode){makeLadderScenery();return;}
    scenery=document.createElement('canvas');scenery.width=W*2;scenery.height=H*2;const c=scenery.getContext('2d');c.scale(2,2);
    const bg=c.createLinearGradient(0,0,0,H);bg.addColorStop(0,'#100b1c');bg.addColorStop(.4,'#38213b');bg.addColorStop(1,'#080910');c.fillStyle=bg;c.fillRect(0,0,W,H);if(arenaImage?.complete&&arenaImage.naturalWidth){c.drawImage(arenaImage,0,0,W,320);c.fillStyle='#0d071657';c.fillRect(0,0,W,320);}
    for(let i=0;i<35;i++){const x=(i*67)%480,y=52+(i*19)%103;c.fillStyle=i%3?'#251c32':'#453246';c.fillRect(x-8,y+6,16,25);oval(c,x,y,6,7,c.fillStyle);}
    for(const x of [30,450]){path(c,[[x,0],[x-90,175],[x+100,175]],'#a5da3820');c.fillStyle='#e4ff87';c.fillRect(x-12,12,24,6);}
    c.textAlign='center';c.font='14px '+FONT;c.fillStyle='#d6d2c0';c.fillText('JUGGALO CHAMPIONSHIP WRESTLING',240,28);c.font='43px '+FONT;c.fillStyle='#c9f96b';c.fillText('RUMBLE',240,71);c.fillStyle='#cd5b9c';c.font='10px '+FONT;c.fillText('LUNACY UNLOCKED  /  NO ONE LEAVES QUIETLY',240,89);
    path(c,[[40,172],[440,172],[456,365],[24,365]],'#5c4b66','#b09aa9');path(c,[[24,365],[456,365],[448,400],[32,400]],'#1b1325','#a2527e');
    const mat=c.createLinearGradient(0,175,0,365);mat.addColorStop(0,'#6a596e');mat.addColorStop(1,'#897988');c.fillStyle=mat;c.fillRect(50,176,380,180);
    c.save();c.translate(240,278);c.scale(1,.55);oval(c,0,0,91,91,'#4a3a54','#bbae97');c.fillStyle='#b6d585';c.font='62px '+FONT;c.fillText('JCW',0,16);c.fillStyle='#c5b7c5';c.font='15px '+FONT;c.fillText('LAST LUNATIC STANDING',0,44);c.restore();
    c.font='22px '+FONT;c.fillStyle='#d5fb79';c.fillText('PSYCHOPATHIC ARCADE',240,390);
    c.lineWidth=3;for(let i=0;i<3;i++)path(c,[[40,120+i*21],[440,120+i*21]],null,i===0?'#d8f795':'#c95496');
    for(const x of [40,440]){c.fillStyle='#141321';c.fillRect(x-5,101,10,87);for(let i=0;i<3;i++){c.fillStyle=i===0?'#adc851':'#69294d';c.fillRect(x-10,115+i*21,20,12);}}
  }
  function sprite(c,id,anim,index,x,y,scale=1,facing=1,rotation=0){
    const image=art.get(id)?.image;if(!image)return false;const frames=byId[id].animations[anim]||byId[id].animations.idle,f=frames[Math.min(index,frames.length-1)]||frames[0];
    c.save();c.translate(x,y);c.rotate(rotation);c.scale(facing*scale,scale);if(f.flipX)c.scale(-1,1);if(f.drawScale)c.scale(f.drawScale,f.drawScale);
    c.drawImage(image,f.x,f.y,f.w,f.h,-f.anchorX,-f.anchorY,f.w,f.h);c.restore();return true;
  }
  async function portrait(){
    const id=S.selected,token=++portraitGeneration;text('ruStyle',byId[id].style+' · '+(byId[id].finisher||'Signature finisher'));$('#ruPortrait').setAttribute('aria-label',byId[id].name);
    const c=$('#ruPortrait').getContext('2d');c.clearRect(0,0,180,240);
    try{await load(id);}catch(_e){if(token===portraitGeneration)text('ruLoadStatus','Tap Ring the Bell to retry loading the artwork.');return;}if(token!==portraitGeneration)return;
    oval(c,90,224,51,9,'#0007');sprite(c,id,'idle',0,90,222,1.45,1);if(S.mode==='ready')draw();
  }
  function draw(){
    if(!ctx)return;ctx.clearRect(0,0,W,H);ctx.drawImage(scenery,0,0,W,H);if(ladderMode)paintLadder(ctx);
    const p=player(),target=p&&!p.out?targetFor(p):null;
    for(const f of [...S.fighters].sort((a,b)=>a.y-b.y)){
      if(f.out&&f.outTime>1.2)continue;
      const a=f.action,frames=byId[f.id].animations;let anim=a?(a.kind==='tip'?'heavy':a.kind):f.walk?'walk':'idle',ix=0,x=f.x,y=f.y,rotation=0;
      if(anim==='throw'){anim=a.t<.46?'lift':'throw';const progress=a.t<.46?a.t/.46:(a.t-.46)/.39;ix=Math.floor(clamp(progress,0,.99)*frames[anim].length);}
      // Landing is a quick animation; hold the final prone frame during recovery.
      else if(a)ix=Math.floor(clamp(a.t/(a.kind==='down'?.3:a.duration),0,.99)*frames[anim].length);
      else if(f.walk)ix=Math.floor(f.age*9)%frames.walk.length;
      if(ladderMode&&f.climbing){y-=f.climb*174;anim='climb';ix=Math.floor(f.age*6)%frames.climb.length;}
      if(ladderMode&&f.fallTime>0){y-=f.fallHeight*(f.fallTime/.55);rotation=f.climbSide*.5;}
      if(S.won&&f.player){anim='victory';ix=Math.min(Math.floor(f.age*5)%frames.victory.length,frames.victory.length-1);}
      if(f.grabbed){const owner=S.fighters.find(v=>v.uid===f.grabbed);if(owner){x=owner.x+owner.facing*19;y=owner.y-45;rotation=owner.facing*-.9;anim='hurt';ix=0;}}
      if(f.out){const t=clamp(f.outTime/1.1,0,1);x=f.exit.x+(f.exit.axis==='x'?f.exit.sign*100*t:0);y=f.exit.y+(f.exit.axis==='y'?f.exit.sign*72*t:18*t)-Math.sin(t*Math.PI)*65;rotation=f.exit.sign*t*2.8;anim='hurt';ix=0;ctx.globalAlpha=1-t;}
      const scale=ladderMode?.67:.61+(f.y-B.top)/900;
      if(!f.out){oval(ctx,x,f.y,f.player?25:21,f.player?8:6,'#100b2477',f.player?'#d1ff68':f===target?'#ff70b6':null);}
      sprite(ctx,f.id,anim,ix,x,y,scale,f.facing,rotation);ctx.globalAlpha=1;
      if(!f.out){
        const head=y-(ladderMode?104:106);ctx.textAlign='center';ctx.font='9px '+FONT;ctx.fillStyle=f.player?'#defd93':'#fff1ea';ctx.fillText((f.player?'YOU · ':'')+byId[f.id].name.toUpperCase(),f.x,head);
        ctx.fillStyle='#211323';ctx.fillRect(f.x-22,head+5,44,4);ctx.fillStyle=f.hp<=35?'#ff69a8':f.player?'#c5f876':'#e8b387';ctx.fillRect(f.x-22,head+5,44*f.hp/100,4);
        if(f.guardOn){ctx.strokeStyle='#a6b4f3';ctx.lineWidth=2;ctx.beginPath();ctx.arc(f.x,f.y-46,37,-2.6,.6);ctx.stroke();}
        if(!ladderMode&&f.hp<=35&&edge(f).d<=48){ctx.fillStyle='#d6ff72';ctx.font='15px '+FONT;ctx.fillText('TOSS OUT ↓',f.x,f.y+18);}
        if(a?.kind==='light'&&!a.hit&&!f.player){ctx.fillStyle='#ffce7b';ctx.font='20px '+FONT;ctx.fillText('!',f.x+29,f.y-77);}
      }
    }
    if(!ladderMode&&target&&!target.out){
      const near=distance(p,target)<=68,e=edge(target);ctx.save();ctx.strokeStyle=near?'#f8badc':'#ef78bd';ctx.lineWidth=2;ctx.setLineDash([4,4]);oval(ctx,target.x,target.y,27,9,null,ctx.strokeStyle);ctx.setLineDash([]);
      path(ctx,[[target.x-5,target.y+19],[target.x,target.y+13],[target.x+5,target.y+19]],null,'#ffd0e9');
      if(target.hp<=35){const x=e.axis==='x'?e.at:target.x,y=e.axis==='y'?e.at:target.y;ctx.strokeStyle='#deff78';ctx.lineWidth=4;path(ctx,e.axis==='x'?[[x,y-16],[x,y+16]]:[[x-22,y],[x+22,y]],null,'#deff78');}ctx.restore();
    }
    frontRopes();
    for(const l of S.labels){ctx.globalAlpha=Math.min(1,l.t*3);ctx.font='16px '+FONT;ctx.textAlign='center';ctx.lineWidth=3;ctx.strokeStyle='#17101c';ctx.strokeText(l.value,l.x,l.y);ctx.fillStyle=l.color;ctx.fillText(l.value,l.x,l.y);}ctx.globalAlpha=1;
    if(S.mode==='playing'||S.mode==='paused'){
      ctx.fillStyle='#120e1ded';ctx.fillRect(60,ladderMode?235:100,360,26);ctx.fillStyle=S.bannerTime>0?'#edfab5':'#d6bcda';ctx.font='12px '+FONT;ctx.textAlign='center';
      const next=S.queue.length?(alive().length>=4?'RING FULL · NEXT ENTRANT WAITING':'NEXT ENTRANT IN '+Math.ceil(S.nextIn)+'s'):'FINAL FIELD · CLEAR THE RING';ctx.fillText(S.bannerTime>0?S.banner:ladderMode?'CLAIM THE BELT · '+Math.ceil(S.time)+'s REMAINING':next,240,ladderMode?253:118,345);
    }
  }
  function movePointer(e){const r=$('#ruStick').getBoundingClientRect(),x=(e.clientX-r.left-r.width/2)/35,y=(e.clientY-r.top-r.height/2)/35,len=Math.hypot(x,y);stick=len>.12?{x:x/Math.max(1,len),y:y/Math.max(1,len)}:{x:0,y:0};$('#ruStickNub').style.transform=`translate(${stick.x*22}px,${stick.y*22}px)`;}
  function bindHold(id,on,off){const el=$('#'+id);el.addEventListener('pointerdown',e=>{if(e.button!==0||S.mode!=='playing')return;e.preventDefault();el.setPointerCapture(e.pointerId);on('p'+e.pointerId);});for(const event of ['pointerup','pointercancel','lostpointercapture'])el.addEventListener(event,e=>off('p'+e.pointerId));}
  function bind(){
    canvas=$('#ruCanvas');ctx=canvas.getContext('2d');makeScenery();resize();loadArena().then(draw).catch(()=>{});
    for(const r of roster){const o=document.createElement('option');o.value=r.id;o.textContent=r.name;$('#ruRoster').appendChild(o);}$('#ruRoster').value=S.selected;
    $('#ruRoster').onchange=()=>{S.selected=$('#ruRoster').value;store.set('selected',S.selected);portrait();};
    $('#ruStartBtn').onclick=start;$('#ruAgainBtn').onclick=start;$('#ruRestartBtn').onclick=choose;$('#ruChooseBtn').onclick=choose;$('#ruPauseBtn').onclick=()=>pause();$('#ruResumeBtn').onclick=()=>pause();$('#ruHomeBtn').onclick=()=>showScreen('menu');$('#ruSoundBtn').onclick=toggleSound;
    $('#ruFinisherBtn').onclick=()=>{act('finish');canvas.focus({preventScroll:true});};$('#ruSaveBtn').onclick=()=>{if(S.mode!=='over'||S.saved||S.score<=0)return;S.saved=true;$('#ruSaveBtn').disabled=true;text('ruSaveBtn','RECORD SUBMITTED');LB.check(game,S.score,S.kills+(ladderMode?' belt grabs · ':' eliminations · ')+(S.won?'Champion':byId[S.selected].name));};
    bindHold('ruHitBtn',()=>{held.add('hit');act('hit');},()=>held.delete('hit'));
    bindHold('ruThrowBtn',()=>act('throw'),()=>{});
    bindHold('ruGuardBtn',key=>{guards.add(key);$('#ruGuardBtn').setAttribute('aria-pressed','true');},key=>{guards.delete(key);$('#ruGuardBtn').setAttribute('aria-pressed',String(guards.size>0));});
    $('#ruHitBtn').onclick=e=>{if(e.detail===0)act('hit');};$('#ruThrowBtn').onclick=e=>{if(e.detail===0)act('throw');};$('#ruGuardBtn').onclick=e=>{if(e.detail===0){guards.has('toggle')?guards.delete('toggle'):guards.add('toggle');$('#ruGuardBtn').setAttribute('aria-pressed',String(guards.size>0));}};
    const stickEl=$('#ruStick');stickEl.addEventListener('pointerdown',e=>{if(e.button!==0||stickId!==null||S.mode!=='playing')return;e.preventDefault();stickId=e.pointerId;stickEl.setPointerCapture(e.pointerId);movePointer(e);});stickEl.addEventListener('pointermove',e=>{if(e.pointerId===stickId)movePointer(e);});
    for(const type of ['pointerup','pointercancel','lostpointercapture'])stickEl.addEventListener(type,e=>{if(e.pointerId!==stickId)return;stickId=null;stick={x:0,y:0};$('#ruStickNub').style.transform='';});
    for(const el of $$('[data-'+prefix+'-dir]')){el.onkeydown=e=>{if([' ','Enter'].includes(e.key)&&S.mode==='playing'){e.preventDefault();held.add(el.dataset[prefix+'Dir']);}};el.onkeyup=e=>{if([' ','Enter'].includes(e.key)){e.preventDefault();held.delete(el.dataset[prefix+'Dir']);}};el.onblur=()=>held.delete(el.dataset[prefix+'Dir']);}
    const keys={ArrowLeft:'left',a:'left',ArrowRight:'right',d:'right',ArrowUp:'up',w:'up',ArrowDown:'down',s:'down',j:'hit',' ':'hit'};
    window.addEventListener('keydown',e=>{
      if(!active||gameKeysBlocked(e)||e.target.closest('button,select,input,textarea'))return;const k=e.key.length===1?e.key.toLowerCase():e.key;
      if(k==='p'||k==='Escape'){e.preventDefault();if(!e.repeat)pause();return;}if(S.mode!=='playing')return;
      if(keys[k]){e.preventDefault();held.add(keys[k]);if(keys[k]==='hit'&&!e.repeat)act('hit');}else if(k==='Shift'||k==='l'){e.preventDefault();guards.add(k);}else if(k==='k'||k==='f'){e.preventDefault();if(!e.repeat)act(k==='k'?'throw':'finish');}
    });
    window.addEventListener('keyup',e=>{const k=e.key.length===1?e.key.toLowerCase():e.key;if(keys[k])held.delete(keys[k]);guards.delete(k);});
    window.addEventListener('blur',()=>pause(true));document.addEventListener('visibilitychange',()=>{if(document.hidden)pause(true);});window.addEventListener('resize',()=>{if(active)resize();});
    // Menu art reuses whole reviewed frames, including their transparent margins.
    Promise.all([loadArena(),load('violent-j'),load('dani-mo')]).then(()=>{const c=$('#ruMenuArt').getContext('2d');c.drawImage(scenery,0,0,400,300);sprite(c,'violent-j','idle',0,145,255,1.23,1);sprite(c,'dani-mo','idle',0,267,255,1.23,-1);}).catch(()=>{});
    hud();overlays();
  }
  return {bind,enter,leave,start,pause,choose,step,draw,act,state:S,roster,player,edge,distance,load,ladderAction,grabNeedle,aligned,netStart,netApply,netEnd,netState:()=>N,cacheSize:()=>art.size};
}
const RUMBLE=createWrestlingGame();
const LADDER=createWrestlingGame(true);
