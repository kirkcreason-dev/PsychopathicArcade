/* Separate combat-racing cabinet. Shares decoded artwork and music with Road
 * to the Show, but owns its simulation, inputs, records and lifecycle. */
const ROAD_RIOT=(()=>{
  'use strict';
  const R=ROAD_RIOT_RULES,D=RACING_ASSET_DATA,$=id=>document.getElementById('rr'+id),store=gameStore('pa_riot_');
  const ids=R.roster.map(r=>r.id),clone=value=>JSON.parse(JSON.stringify(value));
  const name=id=>R.roster.find(r=>r.id===id)?.name||'Rider';
  const legNames=['Detroit','Carnival','JCW Arena'];
  const duelName=d=>Number.isInteger(d.rivalId)?name(state.racers[d.rivalId].racerId):'';
  const duelStatus={upcoming:'UP NEXT',seeking:'OPEN',active:'RACING',won:'WIN',lost:'LOSS',tied:'TIE',unavailable:'NO DUEL',expired:'TIME LIMIT'};
  const count=value=>Number.isSafeInteger(value)&&value>=0?value:0;
  let chosen=ids.includes(store.get('rider','violent-j'))?store.get('rider','violent-j'):'violent-j';
  let difficulty=['easy','normal','hard'].includes(store.get('difficulty','normal'))?store.get('difficulty','normal'):'normal';
  let track=['theme','fight-club','off'].includes(store.get('music','fight-club'))?store.get('music','fight-club'):'fight-club';
  let state=R.create({playerRacer:chosen,difficulty}),active=false,started=false,paused=false,saved=false,recorded=false,pendingSave=null;
  let assets=null,loading=null,assetError='',renderer=null,raf=0,last=0,lastUI=0,dirty=true,motor=null;
  let best=count(store.get('best',0)),wins=count(store.get('wins',0)),seen=new Set(),feedback={text:'',kind:'',until:0},newBest=false;
  const music=RACING_MUSIC.create();music.setTrack(track);
  const keys=new Map(),pointers=new Map(),pulses=new Set();
  const bindings=[['LeftBtn','left'],['RightBtn','right'],['BrakeBtn','brake'],['AttackLeftBtn','attackLeft'],['AttackRightBtn','attackRight'],['BlockBtn','block'],['BoostBtn','boost']];
  const keyMap={ArrowLeft:'left',a:'left',A:'left',ArrowRight:'right',d:'right',D:'right',ArrowDown:'brake',s:'brake',S:'brake',j:'attackLeft',J:'attackLeft',l:'attackRight',L:'attackRight',k:'block',K:'block',' ':'boost',Shift:'boost'};
  const isAction=action=>['attackLeft','attackRight','boost'].includes(action);
  const driving=()=>active&&started&&!paused&&state.phase==='racing'&&state.racers[0].finishTime===null;
  const text=(id,value)=>{const el=$(id);if(el.textContent!==String(value))el.textContent=String(value);};
  const hide=(id,value)=>{if($(id).hidden!==value)$(id).hidden=value;};
  const disable=(id,value)=>{if($(id).disabled!==value)$(id).disabled=value;};
  const attr=(el,key,value)=>{if(el.getAttribute(key)!==String(value))el.setAttribute(key,String(value));};
  const flag=(el,key,value)=>{if(el.classList.contains(key)!==value)el.classList.toggle(key,value);};
  const meter=(id,value)=>{const next=Math.round(Math.max(0,Math.min(100,value)));if($(id).value!==next)$(id).value=next;};
  function controls(){const held=action=>[...keys.values(),...pointers.values()].includes(action);if(!driving())return{steer:0,brake:false,boost:false,attackLeft:false,attackRight:false,block:false};return{steer:Number(held('right'))-Number(held('left')),brake:held('brake'),boost:held('boost'),attackLeft:held('attackLeft'),attackRight:held('attackRight'),block:held('block')};}
  function release(){keys.clear();pointers.clear();pulses.clear();for(const[id]of bindings)$(id)?.classList.remove('held');}
  function strikeState(side){
    const p=state.racers[0];if(!driving()||p.crashTime>0)return'unavailable';
    if(p.blocking)return'guarding';
    if(p.attackCooldown>0||p.attackTime>0)return'cooldown';
    if(p.speed<=35)return'slow';
    return R.attackTargets(state,0,side).length?'ready':'line-up';
  }
  function press(action){
    if(!driving())return;
    const p=state.racers[0];
    if(action==='boost'&&p.boostTime<=0){
      if(p.boost<30)announce('TURBO NEEDS 30% CHARGE','hint',1000);
      else if(p.blocking||controls().brake)announce('RELEASE BLOCK / BRAKE TO TURBO','hint',1000);
      else if(Math.abs(p.x)>R.constants.ROAD_EDGE)announce('GET BACK ON THE ROAD TO TURBO','hint',1000);
    }
    if(action.startsWith('attack')){
      const readiness=strikeState(action==='attackLeft'?-1:1);
      if(readiness==='guarding')announce('RELEASE BLOCK TO STRIKE','hint',1000);
      else if(readiness==='slow')announce('BUILD SPEED TO SWING','hint',1000);
    }
    if(isAction(action))pulses.add(action);syncMusic(true);
  }
  function syncMusic(gesture=false){music.sync(active&&started&&!paused&&!document.hidden&&state.phase!=='finished'&&Sound.on,gesture);}
  function stopMotor(){if(!motor)return;try{motor.osc.stop();motor.osc.disconnect();motor.filter.disconnect();motor.gain.disconnect();}catch(_e){}motor=null;}
  function soundFrame(){
    if(!driving()||!Sound.on||state.racers[0].crashTime>0){stopMotor();return;}
    try{const ctx=Sound.ensure();if(!ctx)return;const p=state.racers[0];if(!motor){const osc=ctx.createOscillator(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();osc.type='sawtooth';filter.type='lowpass';gain.gain.value=0;osc.connect(filter);filter.connect(gain);gain.connect(Sound.master);osc.start();motor={osc,filter,gain};}motor.osc.frequency.setTargetAtTime(29+p.speed*.4,ctx.currentTime,.09);motor.filter.frequency.setTargetAtTime(p.boosting?500:260,ctx.currentTime,.1);motor.gain.gain.setTargetAtTime(.015+p.speed*.0001,ctx.currentTime,.1);}catch(_e){stopMotor();}
  }
  function loadAssets(){
    if(loading)return loading;assetError='';
    loading=RACING.loadAssets().then(a=>{if(!a)throw Error('Artwork unavailable');assets=a;renderer=RACING_RENDERER.create($('Canvas'),a);dirty=true;render();return a;}).catch(()=>{loading=null;assetError='Artwork did not load. Tap RETRY LOADING.';render();return null;});
    return loading;
  }
  function announce(message,kind='hit',duration=1400){
    const priority={crash:5,ko:4,hit:3,block:3,duel:2.5,zone:2,miss:1,hint:1,pickup:0};
    // A pickup on the same physics tick must not erase a knockout or impact.
    if(feedback.until>state.time&&feedback.protectedUntil>state.time&&(priority[feedback.kind]||0)>(priority[kind]||0))return;
    feedback={text:message,kind,until:state.time+duration/1000,protectedUntil:state.time+(kind==='ko'||kind==='crash'?1:.65)};dirty=true;
  }
  function observe(){
    for(const e of state.events){
      if(seen.has(e.id))continue;seen.add(e.id);
      if(state.time-e.time>1)continue;
      if(e.type==='strike'&&(e.racer===0||e.target===0)){
        if(e.blocked){announce(e.target===0?'BLOCKED IT!':'RIVAL BLOCKED YOUR HIT','block');Sound.play('capture',.17);}
        else{announce(e.racer===0?'CLEAN HIT!'+(e.combo>1?' · '+e.combo+' HIT STREAK':''):'HIT! · BLOCK THE NEXT SWING','hit');Sound.play('slam',.22);}
      }
      if(e.type==='knockout'&&e.racer===0){announce('KNOCKOUT!','ko',1900);Sound.play('crowdPop',.35);}
      if(e.type==='crash'&&e.racer===0){announce('WIPED OUT · GETTING BACK UP','crash',2200);Sound.play('slam',.25);}
      if(e.type==='recover'&&e.racer===0)announce('BACK IN IT · RECOVERY SHIELD','block',1600);
      if(e.type==='hit'&&e.racer===0)announce('ROAD HAZARD · WATCH YOUR LINE','hit');
      if(e.type==='miss'&&e.racer===0)announce('MISSED · PULL ALONGSIDE YOUR RIVAL','miss',1100);
      if(e.type==='zone'&&e.racer===0)announce(e.zone===1?'DETROIT CLEARED · INTO THE CARNIVAL':'FINAL LEG · BRING IT HOME','zone',1800);
      if(e.type==='duelStart'&&e.leg>1)announce('DUEL '+e.leg+' · RACE '+duelName(state.duels[e.leg-1]).toUpperCase()+' TO THE FLAG','hint',1800);
      if(e.type==='duelResult'&&['won','lost','tied'].includes(e.status)){
        const rival=duelName(state.duels[e.leg-1]).toUpperCase();
        announce(e.status==='won'?'DUEL WON · +'+e.bonus:e.status==='tied'?'DEAD HEAT · DUEL TIED':rival+' TOOK THE FLAG','duel',2100);
        if(e.status==='won')Sound.play('crowdPop',.2);
      }
      if(e.type==='pickup'&&e.racer===0){const gain=Math.round(e.amount||0);announce(e.kind==='repair'?(gain>0?'RIDE REPAIRED +'+gain+'%':'RIDE ALREADY HEALTHY'):e.kind==='boost'?(gain>0?'TURBO REFILLED +'+gain+'%':'TURBO ALREADY FULL'):'TICKET +50','pickup');}
    }
    if(seen.size>100)seen=new Set(state.events.map(e=>e.id));
    if(state.phase==='finished'&&!recorded){recorded=true;const score=R.score(state);newBest=score>best;best=Math.max(best,score);store.set('best',best);if(!state.racers[0].dnf&&R.standings(state)[0]?.id===0){wins++;store.set('wins',wins);}release();stopMotor();syncMusic();render();}
  }
  function choose(id){if(!ids.includes(id)||started)return false;chosen=id;store.set('rider',id);state=R.create({playerRacer:chosen,difficulty});dirty=true;render();return true;}
  function start(){
    if(!assets){loadAssets();return false;}
    const seed=crypto.getRandomValues(new Uint32Array(1))[0]||1;state=R.create({seed,playerRacer:chosen,difficulty});started=true;paused=false;saved=false;pendingSave=null;recorded=false;newBest=false;$('Placements').removeAttribute('data-tick');seen.clear();feedback={text:'',kind:'',until:0};release();last=0;dirty=true;render();window.scrollTo(0,0);renderer.resize();syncMusic(true);return true;
  }
  function reset(){release();stopMotor();started=false;paused=false;saved=false;pendingSave=null;state=R.create({playerRacer:chosen,difficulty});feedback={text:'',kind:'',until:0};dirty=true;last=0;syncMusic();render();renderer?.resize();window.scrollTo(0,0);}
  function pause(value){if(!started||state.phase==='finished')return;paused=typeof value==='boolean'?value:!paused;release();stopMotor();last=0;dirty=true;syncMusic(!paused);render();}
  function advance(dt,input){
    if(!active||!started||paused||state.phase==='finished')return;
    let effective=input||controls();
    // Preserve a complete touch tap between animation frames; clear pulses only
    // after enough simulation time has accumulated to consume an input step.
    const consume=(state.remainder||0)+dt+1e-10>=1/120;
    if(!input&&state.phase==='racing')for(const action of pulses){
      // A release and new press may both land between physics steps. Each
      // pulse comes from a fresh physical down event, so rearm that edge.
      const latch={attackLeft:'attackLeftHeld',attackRight:'attackRightHeld',boost:'boostHeld'}[action];
      if(latch)state.racers[0][latch]=false;effective={...effective,[action]:true};
    }
    R.advance(state,dt,effective);if(consume)pulses.clear();observe();dirty=true;
  }
  // These three rows also serve as a scorecard at the finish. Build the DOM
  // once and only change values that differ, including when starting a rematch.
  function duelCard(id){
    const list=$(id);
    for(const d of state.duels){
      let row=list.children[d.leg-1];
      if(!row){row=document.createElement('li');row.dataset.leg=String(d.leg);for(const tag of ['small','span','b'])row.append(document.createElement(tag));list.append(row);}
      const rival=duelName(d),outcome=d.status==='won'?'WIN +'+d.bonus:duelStatus[d.status];
      const values=['0'+d.leg+' / '+legNames[d.leg-1],rival||'—',outcome];
      for(let i=0;i<values.length;i++)if(row.children[i].textContent!==values[i])row.children[i].textContent=values[i];
      attr(row,'data-state',d.status);
    }
  }
  function duelHud(p,finished){
    const leg=RACING_RULES.zoneAt(p.z),d=state.duels[leg],rival=duelName(d);
    const remaining=Math.max(0,Math.ceil((d.checkpoint-p.z)/10));
    let line='GET READY TO RUMBLE';
    if(finished)line='FINISHED';
    else if(started){
      if(d.status==='active'){
        const gap=state.racers[d.rivalId].z-p.z,meters=Math.round(Math.abs(gap)/10);
        line=rival+' · '+(meters===0?'LEVEL':(gap>0?'TRAIL ':'LEAD ')+meters+'m');
      }else if(d.status==='lost')line='FLAG LOST · '+rival;
      else if(d.status==='won')line='DUEL WON · +'+d.bonus;
      else if(d.status==='tied')line='DEAD HEAT';
      else line=d.status==='seeking'?'NO RIVAL IN REACH':'RACE TO THE FLAG';
    }
    attr($('Duel'),'data-state',finished?'finished':started?d.status:'idle');
    text('DuelLeg',(started&&rival?'DUEL ':'LEG ')+d.leg+'/3');
    text('Distance',finished?'RACE OVER':remaining+'m TO FLAG');text('RivalGap',line);
  }
  function render(){
    const p=state.racers[0],finished=state.phase==='finished',match=active&&started;
    if(pendingSave){
      if(LB.board('riot').some(row=>!pendingSave.before.has(row)&&row.v===pendingSave.score&&row.tag===pendingSave.tag)){saved=true;pendingSave=null;}
      else if(document.getElementById('lbModal').hidden)pendingSave=null;
    }
    flag($('Screen'),'rr-match',match);flag(document.body,'riot-match',match);
    hide('Setup',started);hide('Pause',!started||!paused||finished);hide('Result',!started||!finished);
    const standings=R.standings(state),place=standings.findIndex(r=>r.id===0)+1;
    if($('Position').textContent!==place+'/6')$('Position').replaceChildren(document.createTextNode(String(place)),Object.assign(document.createElement('span'),{textContent:'/6'}));
    text('Speed',Math.round(p.speed*.36));text('Zone',['DETROIT SUNSET','DARK CARNIVAL','JCW TONIGHT'][RACING_RULES.zoneAt(p.z)]);
    meter('Progress',p.z/state.length*100);duelHud(p,finished);
    if(started&&paused&&!finished)duelCard('PauseDuels');
    text('Health',Math.ceil(p.health)+'%');meter('HealthMeter',p.health);
    text('TurboLabel',p.boostTime>0?'+25% · '+p.boostTime.toFixed(1)+'s':'TURBO');text('Boost',Math.floor(p.boost)+'%');
    meter('BoostMeter',p.boost);text('BoostBtnLabel',p.boostTime>0?p.boostTime.toFixed(1)+'s':p.boost<30?'NEED 30%':'TURBO');attr($('BoostBtn'),'data-state',p.boostTime>0?'active':p.boost<30?'empty':'ready');
    text('Knockouts',p.knockouts||0);text('Combo',p.combo>1?p.combo+'×':'—');
    for(const[id,action]of bindings){const b=$(id),held=[...keys.values(),...pointers.values()].includes(action);disable(id,!driving()||p.crashTime>0);flag(b,'held',held);}
    for(const [prefix,side,arrow]of[['AttackLeft',-1,'↖'],['AttackRight',1,'↗']]){const readiness=strikeState(side),cool=Math.max(p.attackCooldown,p.attackTime);attr($(prefix+'Btn'),'data-state',readiness);flag($(prefix+'Btn'),'in-range',readiness==='ready');text(prefix+'Glyph',readiness==='cooldown'?cool.toFixed(1):readiness==='guarding'?'◇':arrow);meter(prefix+'Meter',100*(1-Math.min(1,cool/.85)));}
    disable('PauseBtn',!started||finished);text('PauseBtn',paused?'RESUME':'PAUSE');disable('SaveBtn',saved||!!pendingSave||!finished);text('SaveBtn',saved?'RECORD SAVED':pendingSave?'ENTER INITIALS':finished&&LB.rankOf('riot',R.score(state))<0?'VIEW RECORDS':'SAVE RECORD');
    text('StartBtn',assetError?'RETRY LOADING':assets?'START A RIOT':'LOADING RIDES…');disable('StartBtn',!assets&&!assetError);
    const threat=state.racers.find(r=>r.id!==0&&r.attackTime>R.constants.SWING_TIME&&R.attackTargets(state,r.id,r.attackSide)[0]?.id===0);
    const readyLeft=strikeState(-1)==='ready',readyRight=strikeState(1)==='ready';
    const status=assetError||(!started?'Pull alongside rivals. Lit strike buttons mean they’re in reach.':paused?'Race paused.':finished?'Race complete. Race again or save your device record.':state.phase==='countdown'?(state.duels[0].status==='active'?'FIRST FLAG · BEAT '+duelName(state.duels[0]).toUpperCase()+' FOR +250':'GET READY · AUTO-ACCELERATE ON GO'):p.crashTime>0?'WIPED OUT · BACK UP IN '+p.crashTime.toFixed(1)+'s':p.blocking?'GUARD UP · RELEASE TO STRIKE':threat?'INCOMING '+(threat.x<p.x?'LEFT':'RIGHT')+' · HOLD BLOCK':p.boostTime>0?'TURBO · +25% SPEED FOR 3 SECONDS':readyLeft&&readyRight?'BOTH SIDES IN RANGE · PICK YOUR TARGET':readyLeft?'LEFT RIVAL IN RANGE · STRIKE LEFT':readyRight?'RIGHT RIVAL IN RANGE · STRIKE RIGHT':p.attackCooldown>0?'RECOVERING · NEXT SWING IN '+p.attackCooldown.toFixed(1)+'s':'PULL ALONGSIDE · LIGHT UP A STRIKE BUTTON');text('Status',status);
    attr($('Status'),'data-warning',!!threat&&!p.blocking&&driving());
    text('SoundBtn',Sound.on?'SOUND ON':'SOUND OFF');attr($('SoundBtn'),'aria-label',Sound.on?'Mute sound':'Enable sound');
    text('Best',best?'PERSONAL BEST '+best.toLocaleString('en-US')+' · '+wins+' WINS':'Your first riot starts here.');
    for(const b of $('Roster').children)attr(b,'aria-pressed',b.dataset.riotRacer===chosen);
    hide('Feedback',!driving()||feedback.until<=state.time||!feedback.text);text('Feedback',feedback.text);attr($('Feedback'),'data-kind',feedback.kind);
    if(finished&&started){
      text('ResultTitle',p.dnf?'TIME’S UP!':place===1?'KING OF THE ROAD!':'MADE THE SHOW!');text('Score',R.score(state).toLocaleString('en-US'));
      text('ResultDetail',(p.dnf?'Time limit':p.finishTime.toFixed(1)+' seconds')+' · '+(p.combatHits||0)+' hits · '+(p.knockouts||0)+' knockouts · '+(p.crashes||0)+' wipeouts');
      const points=R.scoreBreakdown(state);for(const [id,key]of[['Finish','finish'],['Hits','hits'],['Knockouts','knockouts'],['Tickets','tickets'],['Duels','duels'],['Time','timeBonus'],['Penalty','penalty']])text('Score'+id,points[key].toLocaleString('en-US'));
      const victories=state.duels.filter(d=>d.status==='won').length;text('DuelsWon','YOUR DUEL CARD · '+victories+(victories===1?' WIN':' WINS'));duelCard('DuelRecap');
      hide('PenaltyRow',!points.penalty);text('ResultRecap',(newBest?'NEW PERSONAL BEST · ':'')+'BEST STREAK '+(p.bestCombo||0)+' HITS');
      const list=$('Placements');if(list.dataset.tick!==String(state.tick)){list.dataset.tick=String(state.tick);list.replaceChildren();R.standings(state).forEach((r,i)=>{const li=document.createElement('li');li.classList.toggle('rr-you',r.id===0);const label=document.createElement('span'),time=document.createElement('b');label.textContent=(i+1)+'. '+name(r.racerId)+(r.id===0?' · YOU':'');time.textContent=r.dnf?'DNF':r.finishTime>state.time+.0001?'BEHIND':r.finishTime.toFixed(1)+'s';li.append(label,time);list.append(li);});}
    }
  }
  function frame(now){
    if(!active){raf=0;return;}
    const elapsed=last?(now-last)/1000:0;last=now;
    // A slow visible frame shouldn't open the pause menu or fast-forward the
    // opponents. Actual focus loss and backgrounding have their own handlers.
    const dt=elapsed>.5?0:Math.min(.1,elapsed);
    advance(dt);syncMusic();soundFrame();
    if(renderer&&(dirty||renderer.needsRedraw)){renderer.draw(state,0,dt);dirty=false;}
    if(now-lastUI>80){render();lastUI=now;}
    raf=requestAnimationFrame(frame);
  }
  function enter(){active=true;document.body.classList.add('riot-selected');loadAssets();last=0;dirty=true;render();if(!raf)raf=requestAnimationFrame(frame);TICK.set('JCW ROAD RIOT · THE ROAD IS YOUR RING.','COMBAT RACING');}
  function leave(){if(started&&state.phase!=='finished')pause(true);active=false;cancelAnimationFrame(raf);raf=0;release();stopMotor();syncMusic();document.body.classList.remove('riot-selected','riot-match');$('Screen').classList.remove('rr-match');}
  function snapshot(){return{...clone(state),mode:!started?'ready':paused?'paused':state.phase,active,started,paused,loaded:!!assets,chosen,difficulty,best,wins,saved,music:music.state};}
  function bind(){
    for(const r of R.roster){const b=document.createElement('button');b.type='button';b.className='rr-rider';b.dataset.riotRacer=r.id;const img=document.createElement('img'),label=document.createElement('strong'),vehicle=document.createElement('small');img.src=D.riders[r.id];img.alt='';label.textContent=r.name;vehicle.textContent=r.vehicle==='kart'?'GO-KART':'MINI BIKE';b.append(img,label,vehicle);b.onclick=()=>choose(r.id);$('Roster').append(b);}
    $('Difficulty').value=difficulty;$('Difficulty').onchange=e=>{difficulty=e.target.value;store.set('difficulty',difficulty);state=R.create({playerRacer:chosen,difficulty});dirty=true;render();};
    $('MusicSelect').value=track;$('MusicSelect').onchange=e=>{track=e.target.value;store.set('music',track);music.setTrack(track);syncMusic(true);};
    $('StartBtn').onclick=start;$('AgainBtn').onclick=start;$('PauseBtn').onclick=()=>pause();$('ResumeBtn').onclick=()=>pause(false);$('HomeBtn').onclick=()=>showScreen('menu');$('RestartBtn').onclick=$('ChangeBtn').onclick=reset;
    $('SoundBtn').onclick=()=>{toggleSound();syncMusic(true);render();};
    $('SaveBtn').onclick=()=>{
      if(!started||state.phase!=='finished'||saved||pendingSave)return;
      const score=R.score(state),tag=name(chosen)+' · '+(state.racers[0].knockouts||0)+' KO · '+difficulty.toUpperCase();
      if(LB.rankOf('riot',score)<0){LB.show('riot');return;}
      pendingSave={score,tag,before:new Set(LB.board('riot'))};LB.check('riot',score,tag);render();
    };
    for(const [id,action]of bindings){const b=$(id);
      b.addEventListener('pointerdown',e=>{if(b.disabled)return;e.preventDefault();press(action);pointers.set(e.pointerId,action);try{b.setPointerCapture(e.pointerId);}catch(_e){}b.classList.add('held');});
      const up=e=>{pointers.delete(e.pointerId);if(![...pointers.values()].includes(action))b.classList.remove('held');};for(const event of['pointerup','pointercancel','lostpointercapture'])b.addEventListener(event,up);
      b.addEventListener('keydown',e=>{if(![' ','Enter'].includes(e.key)||b.disabled)return;e.preventDefault();e.stopPropagation();if(!e.repeat)press(action);keys.set('button:'+id+e.key,action);});b.addEventListener('keyup',e=>{if(![' ','Enter'].includes(e.key))return;e.preventDefault();e.stopPropagation();keys.delete('button:'+id+e.key);});
      b.addEventListener('blur',()=>{for(const key of keys.keys())if(key.startsWith('button:'+id))keys.delete(key);});
      b.addEventListener('click',e=>{if(e.detail===0&&!b.disabled&&isAction(action))press(action);});b.addEventListener('contextmenu',e=>e.preventDefault());
    }
    document.addEventListener('keydown',e=>{if(!active||gameKeysBlocked(e)||e.target.closest('input,textarea,select')||e.key===' '&&e.target.closest('button,a[href]'))return;if(['p','P','Escape'].includes(e.key)){e.preventDefault();if(!e.repeat)pause();return;}const action=keyMap[e.key];if(action&&driving()){e.preventDefault();if(!e.repeat)press(action);keys.set(e.code||e.key,action);}});
    document.addEventListener('keyup',e=>{keys.delete(e.code||e.key);});window.addEventListener('blur',()=>{release();if(active)pause(true);});document.addEventListener('visibilitychange',()=>{if(document.hidden){release();if(active)pause(true);}syncMusic();});
    const resize=()=>{renderer?.resize();dirty=true;};window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);render();
  }
  return{bind,enter,leave,start,choose,pause,loadAssets,get state(){return snapshot();},getState:snapshot,debug:{advance,controls}};
})();
