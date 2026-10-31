/* GAME 17 — Juggalo Pool. The host alone resolves online shots. */
const POOL=(()=>{
  const P=POOL_PHYSICS,R=POOL_RULES,store=gameStore('pa_pool_'),$=id=>document.getElementById('pl'+id);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),copy=v=>JSON.parse(JSON.stringify(v));
  const freshStats=()=>({shots:0,pots:0,fouls:0,run:0,bestRun:0});
  const validMode=v=>['cpu','local','practice'].includes(v)?v:'cpu';
  const validDiff=v=>['easy','normal','hard'].includes(v)?v:'normal';
  const S={mode:'ready',playMode:validMode(store.get('mode','cpu')),difficulty:validDiff(store.get('difficulty','normal')),balls:P.rack(17),turn:0,groups:[null,null],break:true,scores:[0,0],stats:[freshStats(),freshStats()],calledPocket:null,ballInHand:false,winner:null,notice:'A clean break. A wicked finish.',shot:null,elapsed:0,seed:17,best:Math.max(0,store.get('best',0)),wins:Math.max(0,store.get('wins',0)),saved:false,resultSaved:false};
  const A={angle:0,power:.65,called:null,placement:null,guide:store.get('guide',true)};
  let canvas,view,menuView,active=false,raf=0,last=0,cpuTimer=0,generation=0,pointer=null,settled=0,N=null,resizeObserver=null,netClock=0,guestPrevious=null,guestAt=0,hudKey='';
  const side=()=>N?(N.role==='host'?0:1):S.playMode==='local'?S.turn:0;
  const humanTurn=()=>S.mode==='aiming'&&!(N&&N.pending)&&S.turn===side()&&!(S.playMode==='cpu'&&S.turn===1);
  const name=i=>S.playMode==='practice'?'PRACTICE':N?(i===side()?'YOU':'YOUR HOMIE'):S.playMode==='local'?'PLAYER '+(i+1):i===0?'YOU':({easy:'THE ROOKIE',normal:'THE JUGGALO',hard:'THE HUSTLER'}[S.difficulty]);
  function text(id,value){const el=$(id);if(el.textContent!==String(value))el.textContent=String(value);}
  function stop(){cancelAnimationFrame(raf);raf=0;last=0;clearTimeout(cpuTimer);cpuTimer=0;pointer=null;}
  function cancelWork(){generation++;stop();}
  function run(){if(active&&S.mode==='rolling'&&!raf){last=0;raf=requestAnimationFrame(loop);}}
  function loop(now){raf=0;if(!active||S.mode!=='rolling')return;const dt=last?Math.min(.05,(now-last)/1000):0;last=now;step(dt);draw(now);if(S.mode==='rolling')raf=requestAnimationFrame(loop);}
  function audio(kind){
    if(!Sound.on)return;const c=Sound.ensure();if(!c)return;
    try{const o=c.createOscillator(),g=c.createGain(),t=c.currentTime;o.type=kind==='pot'?'sine':'triangle';o.frequency.setValueAtTime(kind==='pot'?230:kind==='shot'?1100:850,t);o.frequency.exponentialRampToValueAtTime(kind==='pot'?65:350,t+.06);g.gain.setValueAtTime(kind==='pot'?.22:.12,t);g.gain.exponentialRampToValueAtTime(.001,t+.09);o.connect(g);g.connect(Sound.master);o.start(t);o.stop(t+.1);}catch(_e){}
  }
  function renderMenu(){if(!menuView)return;const el=$('MenuArt'),r=el.getBoundingClientRect();menuView.resize(r.width||400,r.height||220,false);menuView.draw({balls:P.rack(17),mode:'ready',turn:0,groups:[null,null]},{aiming:true,angle:0,power:.65,guide:true});}
  function resize(){
    if(!view)return;const r=$('Stage').getBoundingClientRect(),portrait=matchMedia('(max-width:900px) and (orientation:portrait)').matches;view.resize(Math.max(1,r.width),Math.max(1,r.height),portrait);draw();
  }
  function layout(){
    const match=active&&S.mode!=='ready';$('Screen').classList.toggle('pl-match',match);document.body.classList.toggle('pool-match',match);
    $('Setup').hidden=S.mode!=='ready';$('Pause').hidden=S.mode!=='paused';$('Over').hidden=S.mode!=='over';
    $('Mode').disabled=!!N;$('Difficulty').disabled=!!N;$('DifficultyWrap').hidden=S.playMode!=='cpu'||!!N;
    $('ChooseBtn').hidden=!!N;$('OverChooseBtn').hidden=!!N;$('NewBtn').disabled=!!N;
    $('StartBtn').disabled=Boolean(N?.ready[side()]);text('StartBtn',N?'READY TO BREAK':'RACK ’EM UP');
    text('ReadyNote',N?(N.ready[side()]?'Ready. Waiting for your homie…':'Both players ready up before the break.'):'Aim on the table. Set power. Shoot.');
    $('PauseBtn').disabled=['ready','over'].includes(S.mode);text('PauseBtn',S.mode==='paused'?'RESUME':'PAUSE');
    text('PauseNote',N?'Both players must resume before the next shot.':'Your shot can wait.');
    const eligibleRecord=S.mode==='over'&&S.playMode==='cpu'&&S.winner===0;
    $('SaveBtn').hidden=!eligibleRecord;$('SaveBtn').disabled=S.saved;
    text('SaveBtn',S.saved?'RECORD SUBMITTED':'SAVE YOUR RECORD');
    $('AgainBtn').disabled=Boolean(N?.ready[side()]&&N.phase==='over');text('AgainBtn',N?.ready[side()]?'WAITING FOR YOUR HOMIE…':'RUN IT BACK');
    resize();
  }
  function draw(now=performance.now()){
    if(!view||!active)return;
    let shown=S;
    if(N?.role==='join'&&S.mode==='rolling'&&guestPrevious){const t=clamp((now-guestAt)/70,0,1);shown={...S,balls:S.balls.map(b=>{const old=guestPrevious[b.id];return old&&!old.pocketed&&!b.pocketed?{...b,x:old.x+(b.x-old.x)*t,y:old.y+(b.y-old.y)*t}:b;})};}
    const aim=humanTurn();view.draw(shown,{aiming:aim&&!S.ballInHand,angle:A.angle,power:A.power,calledPocket:aim?A.called:S.calledPocket,callRequired:S.playMode!=='practice'&&R.eligible8(S,S.turn)&&!S.break,placement:aim&&S.ballInHand?A.placement:null,guide:A.guide,legalIds:R.targets(S,S.turn),turnColor:S.turn===0?'#9df6cb':'#ec84bb',time:now/1000});
  }
  function tray(i){
    const el=$('Balls'+i),g=S.groups[i],ids=g==='solids'?[1,2,3,4,5,6,7]:g==='stripes'?[9,10,11,12,13,14,15]:[];
    el.replaceChildren();if(!ids.length){const em=document.createElement('em');em.textContent=S.playMode==='practice'?POT_COUNT()+' / 15 pocketed':'First legal pot chooses your crew';el.append(em);return;}
    const colors=['#e2b829','#4081df','#e64f62','#ae74d6','#e99640','#42b890','#aa4168'];
    for(const id of ids){const b=S.balls.find(v=>v.id===id),dot=document.createElement('i');dot.textContent=id;dot.style.setProperty('--ball',colors[(id-1)%8]);dot.className=(id>8?'stripe ':'')+(b?.pocketed?'gone':'');dot.setAttribute('aria-label',id+(b?.pocketed?' pocketed':' remaining'));el.append(dot);}
    if(!R.remaining(S,i).length){const eight=document.createElement('i');eight.textContent='8';eight.className='eight';el.append(eight);}
  }
  function POT_COUNT(){return S.balls.filter(b=>b.id!==0&&b.pocketed).length;}
  function hud(){
    const key=JSON.stringify([S.mode,S.turn,S.groups,S.scores,S.balls.filter(b=>b.pocketed).map(b=>b.id),S.notice,S.ballInHand,S.playMode,S.difficulty,A.called,N?.pending,N?.ready]);
    if(key!==hudKey){hudKey=key;
      for(let i=0;i<2;i++){text('Name'+i,name(i));text('Group'+i,S.playMode==='practice'?'ANY BALL, ANY ORDER':S.groups[i]?S.groups[i].toUpperCase():'OPEN TABLE');text('Score'+i,S.scores[i].toLocaleString());$('Player'+i).classList.toggle('active',S.turn===i&&!['ready','over'].includes(S.mode));tray(i);}
      $('Player1').style.opacity=S.playMode==='practice'?'.35':'1';
      text('Turn',S.mode==='ready'?'WELCOME TO THE HALL':S.mode==='over'?'RACK COMPLETE':S.mode==='paused'?'TABLE PAUSED':S.mode==='rolling'?'BALLS IN MOTION':N?.pending?'SENDING YOUR SHOT…':S.playMode==='cpu'&&S.turn===1?name(1)+' IS LINING IT UP':name(S.turn)+(S.ballInHand?' · CUE BALL IN HAND':S.break?' · THE BREAK':' · AT THE TABLE'));
      text('Status',S.notice);text('Career',S.wins+' CPU win'+(S.wins===1?'':'s')+' · Best '+S.best.toLocaleString());
    }
    const can=humanTurn(),call=can&&!S.break&&R.eligible8(S,S.turn)&&S.playMode!=='practice';
    const callChanged=$('PocketCall').hidden===call;$('PocketCall').hidden=!call;
    $('ShootBtn').hidden=can&&S.ballInHand;$('PlaceBtn').hidden=!can||!S.ballInHand;
    $('ShootBtn').disabled=!can||S.ballInHand||(call&&A.called===null);$('PlaceBtn').disabled=!A.placement?.valid;
    $('Power').disabled=!can||S.ballInHand;$('AimLeft').disabled=!can||S.ballInHand;$('AimRight').disabled=!can||S.ballInHand;
    text('ShootBtn',call&&A.called===null?'CALL POCKET':S.break?'BREAK':'SHOOT');
    text('AimHint',S.ballInHand?'Move the white ball. Confirm its spot.':call?'Pick a numbered pocket for the 8.':'Tap or drag the table to aim');
    for(const el of $('PocketButtons').children)el.setAttribute('aria-pressed',String(Number(el.dataset.plPocket)===A.called));
    text('PowerValue',Math.round(A.power*100)+'%');$('Power').value=Math.round(A.power*100);
    if(callChanged)resize();
  }
  function cuePlacement(){
    const cue=S.balls.find(b=>b.id===0);const proposed=cue&&!cue.pocketed?{x:cue.x,y:cue.y}:{x:285,y:300};
    if(P.validPlacement(S.balls,proposed.x,proposed.y))return{...proposed,valid:true};
    for(let x=110;x<=890;x+=35)for(let y=120;y<=480;y+=35)if(P.validPlacement(S.balls,x,y))return{x,y,valid:true};
    return{...proposed,valid:false};
  }
  function prepareTurn(){
    A.called=null;A.placement=S.ballInHand?cuePlacement():null;
    const cue=S.balls.find(b=>b.id===0),targets=S.balls.filter(b=>!b.pocketed&&R.targets(S,S.turn).includes(b.id)),target=S.break?targets.sort((a,b)=>a.x-b.x)[0]:targets[0];
    if(cue&&target)A.angle=Math.atan2(target.y-cue.y,target.x-cue.x);
    A.power=S.break ? .82 : .48;settled=0;hudKey='';hud();draw();scheduleCPU();
  }
  function reset(mode,seed,starter=0){
    cancelWork();Object.assign(S,{mode:'aiming',playMode:mode,balls:P.rack(seed),turn:starter,groups:[null,null],break:true,scores:[0,0],stats:[freshStats(),freshStats()],calledPocket:null,ballInHand:false,winner:null,notice:'Break the rack. The table stays open after the break.',shot:null,elapsed:0,seed,saved:false,resultSaved:false});
    prepareTurn();layout();canvas.focus({preventScroll:true});
  }
  function start(){
    if(N){ready();return;}
    const mode=validMode($('Mode').value);S.difficulty=validDiff($('Difficulty').value);store.set('mode',mode);store.set('difficulty',S.difficulty);
    reset(mode,(Date.now()^Math.floor(Math.random()*0xffffffff))>>>0);
  }
  function choose(){
    if(N)return;cancelWork();Object.assign(S,{mode:'ready',playMode:validMode($('Mode').value),balls:P.rack(17),groups:[null,null],scores:[0,0],stats:[freshStats(),freshStats()],turn:0,winner:null,ballInHand:false,break:true,notice:'A clean break. A wicked finish.',shot:null});A.placement=null;A.called=null;hudKey='';layout();hud();draw();
  }
  function place(x,y,actor=side()){
    if(S.mode!=='aiming'||!S.ballInHand||actor!==S.turn||!P.validPlacement(S.balls,x,y))return false;
    if(N?.role==='join'){N.pending=true;send({k:'place',request:++N.requests,x,y});hud();return true;}
    const cue=S.balls.find(b=>b.id===0);Object.assign(cue,{x,y,vx:0,vy:0,pocketed:false});S.ballInHand=false;A.placement=null;S.notice='Cue ball placed. Aim your shot.';hud();draw();sendFrame();return true;
  }
  function shoot(params={},actor=side()){
    if(S.mode!=='aiming'||S.ballInHand||actor!==S.turn||N?.pending||P.moving(S.balls))return false;
    const angle=params.angle??A.angle,power=params.power??A.power,called=params.calledPocket??A.called;
    if(!Number.isFinite(angle)||Math.abs(angle)>Math.PI*100||!Number.isFinite(power)||power<.05||power>1)return false;
    const needsCall=!S.break&&S.playMode!=='practice'&&R.eligible8(S,S.turn);
    if(needsCall&&(!Number.isInteger(called)||called<0||called>5))return false;
    if(N?.role==='join'){N.pending=true;send({k:'shot',request:++N.requests,angle,power,calledPocket:needsCall?called:null});hud();return true;}
    clearTimeout(cpuTimer);cpuTimer=0;pointer=null;A.angle=angle;A.power=power;S.calledPocket=needsCall?called:null;
    S.shot=R.prepare(S);if(!P.strike(S.balls,angle,power)){S.shot=null;return false;}
    S.mode='rolling';S.notice=needsCall?'Eight ball called to pocket '+(called+1)+'.':'Let the balls settle…';settled=0;audio('shot');hud();draw();sendFrame();run();return true;
  }
  function complete(){
    if(S.resultSaved)return;S.resultSaved=true;stop();
    const win=S.winner===side(),practice=S.playMode==='practice';
    if(S.playMode==='cpu'&&S.winner===0){S.wins++;S.best=Math.max(S.best,S.scores[0]);store.set('wins',S.wins);store.set('best',S.best);}
    text('ResultTitle',practice?'TABLE CLEARED':N?(win?'THE TABLE IS YOURS':'YOUR HOMIE TAKES IT'):S.playMode==='cpu'?(win?'YOU OWN THE TABLE':'THE CARNIVAL TAKES IT'):name(S.winner)+' TAKES THE TABLE');
    text('ResultDetail',S.notice);text('FinalScore',(practice?S.scores[0]:S.scores[S.winner??0]).toLocaleString());
    const st=S.stats[practice?0:(S.winner??0)];text('ResultStats',st.shots+' shots · '+st.pots+' balls · Best run '+st.bestRun);
    if(N){N.phase='over';N.ready=[false,false];}
    if(win&&!practice)Sound.play('fanfare',.35);layout();hud();draw();
  }
  function step(dt){
    if(S.mode!=='rolling'||!Number.isFinite(dt)||dt<=0)return;
    if(N?.role==='join')return;
    dt=Math.min(.05,dt);const pots=S.shot.potted.length,first=S.shot.first,rails=S.shot.rails.length;P.step(S.balls,dt,S.shot);S.elapsed+=dt;
    if(S.shot.potted.length>pots)audio('pot');else if(first===null&&S.shot.first!==null||S.shot.rails.length>rails)audio('hit');
    settled=P.moving(S.balls)?0:settled+dt;
    if(settled>=.09||S.shot.elapsed>=25){
      for(const ball of S.balls){ball.vx=0;ball.vy=0;}
      R.resolve(S,S.shot);S.shot=null;
      if(S.mode==='over')complete();else{S.mode='aiming';prepareTurn();}
      sendFrame();hud();draw();
    }else if(N){netClock+=dt;if(netClock>=1/15){netClock=0;sendFrame();}}
  }
  function scheduleCPU(){
    clearTimeout(cpuTimer);cpuTimer=0;if(!active||S.playMode!=='cpu'||S.turn!==1||S.mode!=='aiming')return;
    const token=generation;cpuTimer=setTimeout(()=>{
      cpuTimer=0;if(token!==generation||!active||S.playMode!=='cpu'||S.turn!==1||S.mode!=='aiming')return;
      const aim=POOL_AI.choose(S,S.difficulty);if(!aim)return;
      if(S.ballInHand){const p=aim.placement||cuePlacement();if(!place(p.x,p.y,1))return;}
      shoot(aim,1);
    },650);
  }
  function pause(force){
    if(['ready','over'].includes(S.mode))return;
    const value=typeof force==='boolean'?force:S.mode!=='paused';
    if(N){N.pauses[side()]=value;if(N.role==='join'){N.waitingPause=value;send({k:'pause',paused:value});if(value&&S.mode!=='paused'){S.resumeMode=S.mode;S.mode='paused';stop();layout();hud();}return;}applyPauses();return;}
    if(value&&S.mode!=='paused'){S.resumeMode=S.mode;S.mode='paused';cancelWork();}
    else if(!value&&S.mode==='paused'){S.mode=S.resumeMode||'aiming';delete S.resumeMode;run();scheduleCPU();}
    layout();hud();draw();
  }
  function aimAt(point){
    if(!point||!humanTurn())return;
    if(S.ballInHand){const x=clamp(point.x,P.B.left+P.R,P.B.right-P.R),y=clamp(point.y,P.B.top+P.R,P.B.bottom-P.R);A.placement={x,y,valid:P.validPlacement(S.balls,x,y)};}
    else{const cue=S.balls.find(b=>b.id===0);if(Math.hypot(point.x-cue.x,point.y-cue.y)>4)A.angle=Math.atan2(point.y-cue.y,point.x-cue.x);}
    hud();draw();
  }
  function aimBy(delta){if(!humanTurn()||S.ballInHand)return;A.angle+=delta;draw();}
  function callPocket(index){if(!humanTurn()||!Number.isInteger(index)||index<0||index>5)return;A.called=index;hud();draw();}
  function pointerStart(e){
    if(e.button!==0||pointer!==null||!humanTurn())return;const point=view.point(e.clientX,e.clientY);if(!point)return;
    if(S.playMode!=='practice'&&!S.ballInHand&&!S.break&&R.eligible8(S,S.turn)){const index=P.pockets.findIndex(p=>Math.hypot(point.x-p.x,point.y-p.y)<p.r+20);if(index>=0){callPocket(index);return;}}
    e.preventDefault();pointer=e.pointerId;canvas.setPointerCapture(e.pointerId);canvas.focus({preventScroll:true});aimAt(point);
  }
  function enter(){active=true;document.body.classList.add('pool-selected');layout();hud();resize();TICK.set('JUGGALO POOL — CLEAR YOUR CREW. CALL YOUR EIGHT.','BILLIARD HALL');scheduleCPU();run();}
  function leave(){document.body.classList.remove('pool-selected');if(active&&['rolling','aiming'].includes(S.mode))pause(true);active=false;cancelWork();$('Screen').classList.remove('pl-match');document.body.classList.remove('pool-match');renderMenu();}
  function send(data){if(N)NET.push('pool',{round:N.round,...data});}
  function snapshot(){return{mode:S.mode,playMode:'online',balls:S.balls.map(b=>({id:b.id,x:b.x,y:b.y,vx:b.vx,vy:b.vy,pocketed:b.pocketed})),turn:S.turn,groups:S.groups,break:S.break,scores:S.scores,stats:S.stats,calledPocket:S.calledPocket,ballInHand:S.ballInHand,winner:S.winner,notice:S.notice,seed:S.seed,elapsed:S.elapsed,resumeMode:S.resumeMode||null};}
  function sendFrame(kind='frame'){if(N?.role==='host')send({k:kind,seq:++N.tx,state:snapshot(),pauses:N.pauses});}
  function validSnapshot(s){
    const finite=n=>typeof n==='number'&&Number.isFinite(n),pair=a=>Array.isArray(a)&&a.length===2;
    if(!s||typeof s!=='object'||Array.isArray(s)||s.playMode!=='online')return false;
    if(!Array.isArray(s.balls)||s.balls.length!==16||!s.balls.every(b=>b&&typeof b==='object'&&Number.isInteger(b.id)&&b.id>=0&&b.id<=15&&finite(b.x)&&finite(b.y)&&b.x>=0&&b.x<=P.W&&b.y>=0&&b.y<=P.H&&finite(b.vx)&&finite(b.vy)&&Math.abs(b.vx)<=P.MAX_SPEED+1&&Math.abs(b.vy)<=P.MAX_SPEED+1&&typeof b.pocketed==='boolean')||new Set(s.balls.map(b=>b.id)).size!==16)return false;
    return ['aiming','rolling','paused','over'].includes(s.mode)&&[0,1].includes(s.turn)&&typeof s.break==='boolean'&&typeof s.ballInHand==='boolean'&&finite(s.elapsed)&&s.elapsed>=0&&finite(s.seed)&&typeof s.notice==='string'&&s.notice.length<350&&(s.mode==='over'?[0,1].includes(s.winner):s.winner===null)&&pair(s.groups)&&((s.groups[0]===null&&s.groups[1]===null)||(s.groups[0]==='solids'&&s.groups[1]==='stripes')||(s.groups[0]==='stripes'&&s.groups[1]==='solids'))&&pair(s.scores)&&s.scores.every(n=>finite(n)&&n>=0&&n<=1e7)&&pair(s.stats)&&s.stats.every(t=>t&&['shots','pots','fouls','run','bestRun'].every(k=>Number.isInteger(t[k])&&t[k]>=0&&t[k]<=1e6))&&[null,0,1,2,3,4,5].includes(s.calledPocket)&&[null,'aiming','rolling'].includes(s.resumeMode)&&(s.mode!=='paused'||s.resumeMode!==null);
  }
  function netStart(role){
    cancelWork();N={role,round:0,phase:'lobby',ready:[false,false],pauses:[false,false],tx:0,rx:0,requests:0,remoteRequest:0,pending:false};
    Object.assign(S,{mode:'ready',playMode:'online',balls:P.rack(17),turn:0,groups:[null,null],scores:[0,0],stats:[freshStats(),freshStats()],notice:'Your homie is here. Both players ready up to break.',winner:null,resultSaved:false});hudKey='';layout();hud();draw();
  }
  function ready(){
    if(!N||!['lobby','over'].includes(N.phase)||N.ready[side()])return;
    N.ready[side()]=true;send({k:'ready'});maybeStartOnline();layout();
  }
  function maybeStartOnline(){
    if(!N||N.role!=='host'||!N.ready.every(Boolean))return;
    const starter=N.round%2;N.round++;N.phase='playing';N.pauses=[false,false];N.ready=[false,false];N.tx=0;N.rx=0;N.remoteRequest=0;N.pending=false;
    reset('online',(Date.now()^0xcafef00d^N.round)>>>0,starter);sendFrame('start');
  }
  function applyPauses(){
    if(!N||S.mode==='over'||S.mode==='ready')return;
    if(N.pauses.some(Boolean)&&S.mode!=='paused'){S.resumeMode=S.mode;S.mode='paused';stop();}
    else if(!N.pauses.some(Boolean)&&S.mode==='paused'){S.mode=S.resumeMode||'aiming';delete S.resumeMode;run();}
    layout();hud();draw();sendFrame();
  }
  function netApply(d){
    if(!N||!d||typeof d!=='object'||!Number.isSafeInteger(d.round)||d.round<0)return;
    if(N.role==='join'&&['frame','start'].includes(d.k)){
      if((d.k==='start'?d.round!==N.round+1||!['lobby','over'].includes(N.phase)||d.state?.mode!=='aiming':d.round!==N.round)||!Number.isSafeInteger(d.seq)||d.seq<=0||(d.k==='frame'&&d.seq<=N.rx)||!validSnapshot(d.state)||!Array.isArray(d.pauses)||d.pauses.length!==2||d.pauses.some(p=>typeof p!=='boolean'))return;
      if(d.k==='start'){cancelWork();N.round=d.round;N.phase='playing';N.ready=[false,false];N.rx=0;N.requests=0;N.waitingPause=false;S.resultSaved=false;S.saved=false;}
      const changedTurn=S.turn!==d.state.turn||S.mode==='rolling'&&d.state.mode==='aiming';
      guestPrevious=Object.fromEntries(S.balls.map(b=>[b.id,{...b}]));guestAt=performance.now();N.rx=d.seq;N.pauses=d.pauses.slice();N.pending=false;
      // A peer owns the shared rack, never this device's records or UI flags.
      const shared={};for(const key of ['mode','balls','turn','groups','break','scores','stats','calledPocket','ballInHand','winner','notice','seed','elapsed','resumeMode'])shared[key]=copy(d.state[key]);
      Object.assign(S,shared,{playMode:'online',shot:null});
      // A rolling frame already in flight must not undo an immediate local
      // pause while that pause request is still travelling to the host.
      if(N.waitingPause&&S.mode!=='over'){
        if(N.pauses[side()])N.waitingPause=false;
        else{N.pauses[side()]=true;if(S.mode!=='paused')S.resumeMode=S.mode;S.mode='paused';stop();}
      }
      if(S.mode==='over')complete();else{if(changedTurn||d.k==='start')prepareTurn();layout();hud();draw();run();}
      return;
    }
    if(d.round!==N.round)return;
    if(d.k==='ready'&&['lobby','over'].includes(N.phase)){N.ready[1-side()]=true;maybeStartOnline();layout();return;}
    if(N.role!=='host')return;
    if(d.k==='pause'&&typeof d.paused==='boolean'){N.pauses[1]=d.paused;applyPauses();return;}
    if(!['shot','place'].includes(d.k)||!Number.isSafeInteger(d.request)||d.request<=N.remoteRequest)return;
    // Network input must be explicit; shoot()'s local aim defaults must not be
    // used for missing or null fields received from the other player.
    if(d.k==='shot'&&(!Number.isFinite(d.angle)||Math.abs(d.angle)>Math.PI*100||!Number.isFinite(d.power)||d.power<.05||d.power>1||![null,0,1,2,3,4,5].includes(d.calledPocket)))return;
    if(d.k==='place'&&(!Number.isFinite(d.x)||!Number.isFinite(d.y)))return;
    N.remoteRequest=d.request;
    if(N.phase!=='playing'||S.mode!=='aiming'||S.turn!==1||N.pauses.some(Boolean)){sendFrame();return;}
    if(d.k==='place')place(d.x,d.y,1);else shoot({angle:d.angle,power:d.power,calledPocket:d.calledPocket},1);
    sendFrame();
  }
  function netEnd(){
    if(!N)return;N=null;guestPrevious=null;cancelWork();S.playMode=validMode(store.get('mode','cpu'));$('Mode').value=S.playMode;choose();S.notice='Online table closed. Start a fresh local rack any time.';hud();
  }
  function bind(){
    canvas=$('Canvas');view=POOL_RENDERER.create(canvas,P);menuView=POOL_RENDERER.create($('MenuArt'),P);renderMenu();
    $('Mode').value=S.playMode;$('Difficulty').value=S.difficulty;$('Guide').checked=A.guide;
    $('Mode').onchange=()=>{S.playMode=validMode($('Mode').value);layout();hud();};$('Difficulty').onchange=()=>{S.difficulty=validDiff($('Difficulty').value);hud();};
    $('StartBtn').onclick=start;$('AgainBtn').onclick=()=>N?ready():start();$('ChooseBtn').onclick=choose;$('OverChooseBtn').onclick=choose;$('NewBtn').onclick=choose;
    $('ShootBtn').onclick=()=>{if(humanTurn())shoot();canvas.focus({preventScroll:true});};$('PlaceBtn').onclick=()=>{if(humanTurn()&&A.placement)place(A.placement.x,A.placement.y);canvas.focus({preventScroll:true});};
    $('PauseBtn').onclick=()=>pause();$('ResumeBtn').onclick=()=>pause(false);$('HomeBtn').onclick=()=>showScreen('menu');$('SoundBtn').onclick=toggleSound;
    $('SaveBtn').onclick=()=>{if(S.mode!=='over'||S.playMode!=='cpu'||S.winner!==0||S.saved)return;S.saved=true;LB.check('pool',S.scores[0],S.difficulty+' CPU · '+S.stats[0].shots+' shots');layout();};
    $('Power').oninput=()=>{A.power=Number($('Power').value)/100;hud();draw();};$('Guide').onchange=()=>{A.guide=$('Guide').checked;store.set('guide',A.guide);draw();};
    $('AimLeft').onclick=()=>aimBy(-Math.PI/360);$('AimRight').onclick=()=>aimBy(Math.PI/360);
    for(const el of $('PocketButtons').children)el.onclick=()=>callPocket(Number(el.dataset.plPocket));
    canvas.addEventListener('pointerdown',pointerStart);canvas.addEventListener('pointermove',e=>{if(e.pointerId===pointer)aimAt(view.point(e.clientX,e.clientY));});
    for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,e=>{if(e.pointerId===pointer)pointer=null;});
    document.addEventListener('keydown',e=>{
      if(!active||gameKeysBlocked(e)||e.target.closest('button,input,select,textarea'))return;
      if(['p','P','Escape'].includes(e.key)){e.preventDefault();pause();return;}
      if(!humanTurn())return;
      if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' ','Enter'].includes(e.key))e.preventDefault();
      if(S.ballInHand){
        if(e.key==='Enter'){if(A.placement)place(A.placement.x,A.placement.y);return;}
        const p=A.placement||cuePlacement(),amount=e.shiftKey?2:10;
        if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){const screen=view.project(p.x,p.y),delta={ArrowLeft:[-amount,0],ArrowRight:[amount,0],ArrowUp:[0,-amount],ArrowDown:[0,amount]}[e.key];aimAt(view.point(screen.x+delta[0],screen.y+delta[1]));}return;
      }
      if(e.key==='ArrowLeft')aimBy(-(e.shiftKey?.15:.75)*Math.PI/180);
      if(e.key==='ArrowRight')aimBy((e.shiftKey?.15:.75)*Math.PI/180);
      if(e.key==='ArrowUp'||e.key==='ArrowDown'){A.power=clamp(A.power+(e.key==='ArrowUp'?.05:-.05),.05,1);hud();draw();}
      if(e.key===' '&&!e.repeat)shoot();if(/^[1-6]$/.test(e.key))callPocket(Number(e.key)-1);
    });
    window.addEventListener('blur',()=>{pointer=null;pause(true);});document.addEventListener('visibilitychange',()=>{if(document.hidden)pause(true);});
    window.addEventListener('resize',()=>{if(active)resize();else renderMenu();});
    if(window.ResizeObserver){resizeObserver=new ResizeObserver(()=>{if(active)resize();});resizeObserver.observe($('Stage'));}
    layout();hud();
  }
  return{bind,enter,leave,start,choose,pause,step,draw,shoot,place,callPocket,aimAt,state:S,aim:A,physics:P,rules:R,ai:POOL_AI,netStart,netApply,netEnd,netState:()=>N,debug:{stop,resize,project:(x,y)=>view.project(x,y),point:(x,y)=>view.point(x,y),humanTurn,complete}};
})();
