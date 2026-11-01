/* Road to the Show. The host simulates the race; the guest sends controls only.
 * A fixed physics step, bounded snapshots and explicit ready/pause barriers keep
 * a delayed tab from silently advancing the race or awarding a disconnected win. */
const RACING=(()=>{
  const R=RACING_RULES,D=RACING_ASSET_DATA,$=id=>document.getElementById('rc'+id),store=gameStore('pa_racing_');
  const clone=x=>JSON.parse(JSON.stringify(x)),ids=D.manifest.racers.map(r=>r.id),name=id=>D.manifest.racers.find(r=>r.id===id)?.name||'Racer';
  const finite=(n,min,max)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
  const integer=(n,max=1000000000)=>Number.isSafeInteger(n)&&n>=0&&n<=max;
  const count=n=>integer(Number(n))?Number(n):0;
  const music=RACING_MUSIC.create();
  let musicSuspended=false;
  let musicTrack=['theme','fight-club','off'].includes(store.get('music','theme'))?store.get('music','theme'):'theme';music.setTrack(musicTrack);
  let chosen=ids.includes(store.get('racer','violent-j'))?store.get('racer','violent-j'):'violent-j';
  let runMode=store.get('runMode','convoy')==='daily'?'daily':'convoy',raceDay='';
  const utcDay=()=>new Date().toISOString().slice(0,10);
  const dailyRecords={};
  const storedDaily=store.get('dailyRecords',{});
  if(storedDaily&&typeof storedDaily==='object')for(const [day,r]of Object.entries(storedDaily).filter(([day])=>/^\d{4}-\d{2}-\d{2}$/.test(day)).sort().slice(-7)){
    if(r&&integer(r.score,1000000)&&finite(r.time,.001,180)&&ids.includes(r.racer)&&integer(r.runs,1000000)&&integer(r.wins,r.runs))dailyRecords[day]={score:r.score,time:r.time,racer:r.racer,runs:r.runs,wins:r.wins};
  }
  let state=R.create({playerRacer:chosen}),active=false,started=false,paused=false,ended=false,saved=false,recorded=false,localSeat=0,onlineMatch=false;
  let assets=null,assetPromise=null,assetError='',renderer=null,raf=0,last=0,uiTime=0,netTime=0,N=null,heartbeat=0,previous=null,receivedAt=0;
  let multiplayer=null,partyListKey='',boostQueued=false;
  let best=count(store.get('best',0)),wins=count(store.get('wins',0)),notice='Choose your ride. Beat the convoy to the next JCW show.',motor=null,drawDirty=true,placementKey='';
  let feedback={text:'',kind:'pickup',until:0},seenEvents=new Set(),lastPosition=null,lastDraft=false,lastFinished=false;
  const keys=new Map(),pointers=new Map(),zones=['DETROIT SUNSET','CARNIVAL AFTER DARK','JCW TONIGHT'];
  const seat=()=>localSeat;
  const mode=()=>ended?'disconnected':!started?'ready':paused?'paused':state.phase;
  function syncMusic(gesture=false){music.sync(active&&!document.hidden&&!musicSuspended&&Sound.on&&!paused&&!ended&&(!N||N.transport&&!N.congested)&&(started&&state.phase!=='finished'||!!N?.localReady),gesture);}
  function selectMusic(value){if(!['theme','fight-club','off'].includes(value))return;musicTrack=value;store.set('music',value);music.setTrack(value);syncMusic(true);render();}
  function partyChanged(next){
    const wasStarted=started,wasPaused=paused,oldPhase=state.phase,oldRound=N?.round,oldNotice=notice;
    const incoming=next.state||state,net=next.net;
    if(net?.role==='join'&&incoming.tick!==state.tick){previous=state;receivedAt=performance.now();}
    state=incoming;N=next.ended?null:net;localSeat=next.localSeat??0;onlineMatch=true;runMode='convoy';raceDay='';
    started=!!next.started;paused=!!next.paused;ended=!!next.ended;notice=next.notice||notice;drawDirty=true;
    if(net?.round!==oldRound||started&&!wasStarted){release();resetFeedback();saved=false;recorded=false;last=0;window.scrollTo(0,0);renderer?.resize();}
    if(paused!==wasPaused||ended||state.phase==='finished'){release();last=0;}
    observeRace();
    if(!started||paused!==wasPaused||state.phase!==oldPhase||oldNotice!==notice||ended||state.phase==='finished')render();
  }
  function openParty(){if(!active)showScreen('racing');pause(true);RACING_PARTY.open();}
  function endParty(reason='The online room closed.'){if(multiplayer?.active)multiplayer.end(reason);}
  function text(id,value){const e=$(id);if(e&&e.textContent!==String(value))e.textContent=String(value);}
  const neutral=()=>({steer:0,brake:false,boost:false});
  function controls(){if(!active||!started||paused||ended||state.racers[seat()].finishTime!==null)return neutral();const held=k=>[...keys.values()].includes(k)||[...pointers.values()].includes(k);return{steer:(held('right')?1:0)-(held('left')?1:0),brake:held('brake'),boost:held('boost')};}
  function queueBoost(){if(!N?.party&&N?.role!=='join'&&started&&!paused&&!ended&&state.phase==='racing'&&state.racers[seat()].boostTime===0&&!controls().boost)boostQueued=true;}
  function hide(id,value){const e=$(id);if(e&&e.hidden!==value)e.hidden=value;}
  function disable(id,value){const e=$(id);if(e&&e.disabled!==value)e.disabled=value;}
  function flag(e,key,value){if(e.classList.contains(key)!==value)e.classList.toggle(key,value);}
  function meter(id,value){const e=$(id),n=Math.round(Math.max(0,Math.min(100,value)));if(e&&e.value!==n)e.value=n;}
  function resetFeedback(){feedback={text:'',kind:'pickup',until:0};seenEvents.clear();lastPosition=null;lastDraft=false;lastFinished=false;placementKey='';drawDirty=true;}
  function announce(message,kind='pickup',duration=1800){feedback={text:message,kind,until:performance.now()+duration};}
  function observeRace(){
    if(!started||ended)return;const p=state.racers[seat()],position=R.standings(state).findIndex(r=>r.id===seat())+1;
    if(lastPosition!==null&&position<lastPosition&&state.time>1&&p.finishTime===null)announce('MOVED UP · '+position+(position===1?'ST':position===2?'ND':position===3?'RD':'TH')+' PLACE','overtake');
    lastPosition=position;
    if(p.drafting&&!lastDraft&&feedback.until<performance.now())announce('IN THE SLIPSTREAM · BOOST RECHARGES FASTER','draft',1600);lastDraft=p.drafting;
    for(const event of state.events){
      if(seenEvents.has(event.id))continue;seenEvents.add(event.id);if(event.racer!==seat()||state.time-event.time>.8)continue;
      if(event.type==='pickup'){
        const gain=Number(event.amount)||0,amount=gain<1?'TOPPED OFF':'+'+Math.round(gain)+'%';
        announce(event.kind==='ticket'?'TICKET +1 · +75 POINTS':event.kind==='boost'?(gain>0?'BOOST REFILLED · '+amount:'BOOST ALREADY FULL'):(gain>0?'RIDE REPAIRED · '+amount:'RIDE ALREADY HEALTHY'),'pickup');
      }
      if(event.type==='hit')announce('HIT! · FIND A WRENCH TO REPAIR','hit');
      if(event.type==='drift'){announce((event.tier===2?'SUPER DRIFT':'MINI DRIFT')+' · TURBO!'+(event.amount>=1?' · +'+Math.round(event.amount)+'% BOOST':''),'drift',1800);Sound.play('launch',.15);}
      if(event.type==='zone')announce(event.zone===1?'DETROIT CLEARED · INTO THE CARNIVAL':'FINAL LEG · THE JCW SHOW IS AHEAD','zone',2500);
    }
    if(seenEvents.size>160)seenEvents=new Set(state.events.map(e=>e.id));
    if(p.finishTime!==null&&!lastFinished){release();lastFinished=true;drawDirty=true;}
  }
  function release(){boostQueued=false;if(N&&!N.party)N.boostPending=false;keys.clear();pointers.clear();for(const id of ['LeftBtn','RightBtn','BrakeBtn','BoostBtn'])$(id)?.classList.remove('held');}
  function stopMotor(){if(!motor)return;try{motor.osc.stop();motor.osc.disconnect();motor.gain.disconnect();motor.filter.disconnect();}catch(_e){}motor=null;}
  function soundFrame(){
    const p=state.racers[seat()];if(!active||!started||paused||ended||state.phase!=='racing'||p.finishTime!==null||!Sound.on){stopMotor();return;}
    try{
      const ctx=Sound.ensure();if(!ctx)return;
      if(!motor){const osc=ctx.createOscillator(),gain=ctx.createGain(),filter=ctx.createBiquadFilter();osc.type='sawtooth';filter.type='lowpass';filter.frequency.value=280;gain.gain.value=0;osc.connect(filter);filter.connect(gain);gain.connect(Sound.master);osc.start();motor={osc,gain,filter};}
      motor.osc.frequency.setTargetAtTime(32+p.speed*.39,ctx.currentTime,.08);motor.filter.frequency.setTargetAtTime(p.boosting||p.driftTurbo>0?560:p.drifting?380:260,ctx.currentTime,.1);motor.gain.gain.setTargetAtTime(.018+p.speed/250*.025,ctx.currentTime,.1);
    }catch(_e){stopMotor();}
  }
  function image(src){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('A racing image could not load.'));img.src=src;});}
  function loadAssets(){
    if(assetPromise)return assetPromise;
    assetError='';
    assetPromise=(async()=>{
      const a={riders:{},backgrounds:[],vectors:{}};
      await Promise.all([
        ...D.manifest.racers.map(async meta=>{a.riders[meta.id]={image:await image(D.riders[meta.id]),meta};}),
        ...D.manifest.backgrounds.map(async(meta,i)=>{a.backgrounds[i]={image:await image(D.backgrounds[i]),meta};}),
        ...Object.entries(D.vectors).map(async([id,src])=>{const meta=D.manifest.vectors?.assets?.find(x=>x.id===id)||{};a.vectors[id]={image:await image(src),meta};})
      ]);
      assets=a;renderer=RACING_RENDERER.create($('Canvas'),a);drawDirty=true;render();return a;
    })().catch(()=>{assetPromise=null;assetError='The racing artwork did not load. Tap TRY AGAIN to reload it.';render();return null;});
    return assetPromise;
  }
  function choose(id){if(!ids.includes(id)||started&&state.phase!=='finished'||N?.localReady)return false;if(multiplayer?.active&&!multiplayer.choose(id))return false;chosen=id;store.set('racer',id);if(!started&&!N)state=R.create({playerRacer:id});drawDirty=true;render();sendInput();return true;}
  function chooseMode(value){if(N||started||!['convoy','daily'].includes(value))return false;runMode=value;raceDay='';store.set('runMode',value);render();return true;}
  function dailySeed(day){let value=2166136261;for(const c of 'jcw-racing-daily-v1:'+day)value=Math.imul(value^c.charCodeAt(0),16777619);return value>>>0||1;}
  function seed(){const a=new Uint32Array(1);crypto.getRandomValues(a);return a[0]||1;}
  function start(){
    if(!assets){loadAssets();return;}
    if(multiplayer?.active){multiplayer.ready();syncMusic(true);return;}
    if(N){ready();return;}
    localSeat=0;onlineMatch=false;raceDay=runMode==='daily'?utcDay():'';state=R.create({seed:raceDay?dailySeed(raceDay):seed(),playerRacer:chosen});started=true;paused=false;ended=false;saved=false;recorded=false;notice='Brake + steer to charge a drift. Release for a turbo burst.';release();resetFeedback();last=0;
    syncMusic(true);render();window.scrollTo(0,0);renderer?.resize();
  }
  function record(){
    if(recorded||ended||!started||state.phase!=='finished'||N)return;recorded=true;
    const score=R.score(state,0),won=R.standings(state)[0]?.id===0,p=state.racers[0];
    if(runMode==='daily'){
      if(!p.dnf&&p.finishTime!==null){const old=dailyRecords[raceDay],improved=!old||score>old.score||score===old.score&&p.finishTime<old.time;
        dailyRecords[raceDay]={score:improved?score:old.score,time:improved?p.finishTime:old.time,racer:improved?p.racerId:old.racer,runs:Math.min(1000000,(old?.runs||0)+1),wins:Math.min(1000000,(old?.wins||0)+(won?1:0))};
        for(const day of Object.keys(dailyRecords).sort().slice(0,-7))delete dailyRecords[day];store.set('dailyRecords',dailyRecords);
      }
    }else{best=Math.max(best,score);store.set('best',best);if(won){wins++;store.set('wins',wins);}}
    Sound.play('fanfare',.25);
  }
  function render(){
    if(!$('Screen'))return;
    syncMusic();
    const m=mode(),p=state.racers[seat()],order=R.standings(state),position=order.findIndex(r=>r.id===seat())+1,match=active&&started;
    flag($('Screen'),'rc-match',match);flag(document.body,'racing-match',match);
    hide('Setup',m!=='ready');hide('Pause',m!=='paused');hide('Result',!['finished','disconnected'].includes(m));
    for(const id of ['MusicSelect','PauseMusicSelect']){const el=$(id);if(el&&el.value!==musicTrack)el.value=musicTrack;}
    text('MusicNotice',musicTrack==='off'?'Music off. Race sound effects follow the sound button.':!Sound.on?'Sound is muted. Use the sound button below to hear the soundtrack.':'Original Lunacy Unlocked soundtrack · plays when the race starts.');
    const daily=runMode==='daily'&&!onlineMatch,day=raceDay||utcDay(),dailyBest=dailyRecords[day];
    hide('Modes',!!N);hide('DailyNote',!!N);
    for(const [id,value]of [['ConvoyBtn','convoy'],['DailyBtn','daily']]){const el=$(id);if(el&&el.getAttribute('aria-pressed')!==String(runMode===value))el.setAttribute('aria-pressed',String(runMode===value));}
    text('DailyNote',daily?'DAILY ROUTE · '+day+' UTC · Same course all day. Your best stays on this device.':'CONVOY RUN · A fresh road layout every race. Brake + steer, then release to drift boost.');
    text('StartBtn',assetError?'TRY AGAIN':!assets?'LOADING RIDES…':N?.localReady?(N.party?'READY · WAITING FOR THE GROUP':'WAITING FOR YOUR HOMIE…'):N?'READY TO RACE':daily?'RACE THE DAILY ROUTE':'RACE TO THE SHOW');
    disable('StartBtn',!assetError&&(!assets||!!N&&(!N.synced||N.localReady||!N.transport||N.congested)));
    const waiting=started&&p.finishTime!==null&&state.phase!=='finished'&&!ended;
    let status=notice;
    if(waiting){const remaining=state.racers.filter(r=>r.human&&r.finishTime===null);status='FINISHED IN '+p.finishTime.toFixed(2)+'s · Waiting for '+remaining.length+' racer'+(remaining.length===1?'':'s');}
    else if(started&&!paused&&state.phase==='racing')status=p.drifting?(p.driftCharge>=1.4?'SUPER DRIFT READY · RELEASE BRAKE FOR TURBO':p.driftCharge>=.65?'DRIFT READY · RELEASE, OR HOLD FOR SUPER TURBO':'DRIFT CHARGING · HOLD BRAKE + STEER'):p.driftTurbo>0?'DRIFT TURBO · GO GET THAT NEXT PLACE':p.boosting?'TURBO +25% · AIM FOR A CLEAR LINE':p.drafting?'DRAFTING · STAY BEHIND A RIVAL TO RECHARGE BOOST':Math.abs(p.x)>R.constants.ROAD_EDGE?'OFF ROAD · STEER BACK ONTO THE TARMAC':p.health<45?'RIDE DAMAGED · LOOK FOR RED WRENCH PICKUPS':p.boost<30?'BOOST RECHARGING · NEED 30% FOR A BURST':'BRAKE + STEER TO DRIFT · RELEASE FOR TURBO';
    text('Status',assetError||(N?.congested?'Connection is catching up. The race is paused.':N&&!N.transport?'Connection interrupted. The race is paused.':status));
    text('Position',position+'/'+state.racers.length);text('Speed',Math.round(p.speed*.36));text('Distance',Math.max(0,(state.length-p.z)/10000).toFixed(2)+' KM');
    const turbo=p.boostTime>0,turboSeconds=(Math.ceil(p.boostTime*10)/10).toFixed(1);
    text('Boost',turbo?'+25% '+turboSeconds+'s':Math.round(p.boost)+'%');text('BoostLabel',turbo?'TURBO':'BOOST');
    flag($('BoostStat'),'turbo-active',turbo);flag($('BoostBtn'),'turbo-active',turbo);
    text('BoostBtnLabel',turbo?'TURBO '+turboSeconds+'s':p.boost<30?'CHARGING':'BOOST');
    const boostLabel=turbo?'Turbo active. Your three-second burst is running.':p.boost<30?'Boost recharging. A burst needs 30 percent charge.':'Tap for 25 percent extra speed for three seconds; costs 30 percent boost charge';
    if($('BoostBtn').getAttribute('aria-label')!==boostLabel)$('BoostBtn').setAttribute('aria-label',boostLabel);
    text('Health',Math.round(p.health)+'%');text('Tickets',p.tickets);text('Time',state.time.toFixed(1)+'s');text('Zone',zones[R.zoneAt(p.z)]||zones[2]);
    meter('BoostMeter',p.boost);meter('HealthMeter',p.health);meter('Progress',p.z/state.length*100);text('LegLabel','STOP '+(R.zoneAt(p.z)+1)+' OF 3');
    const driftTier=p.driftCharge>=1.4?2:p.driftCharge>=.65?1:0;
    meter('DriftMeter',p.driftCharge/1.4*100);text('DriftLabel',p.drifting?(driftTier===2?'RELEASE II':driftTier===1?'RELEASE I':'CHARGING'):p.driftTurbo>0?'TURBO!':'READY');
    const driftInstrument=$('DriftInstrument');if(driftInstrument&&driftInstrument.dataset.tier!==String(driftTier))driftInstrument.dataset.tier=String(driftTier);
    const route=$('Route');if(route&&route.dataset.activeLeg!==String(R.zoneAt(p.z)))route.dataset.activeLeg=String(R.zoneAt(p.z));
    text('PersonalBest',daily?(dailyBest?'DAILY BEST · '+dailyBest.score.toLocaleString()+' PTS · '+dailyBest.time.toFixed(2)+'s · '+name(dailyBest.racer):'SET TODAY’S FIRST RECORD · FINISH STRONG AND COLLECT TICKETS'):best?'YOUR BEST · '+best.toLocaleString()+' PTS · '+wins+' SOLO WIN'+(wins===1?'':'S'):'YOUR FIRST RUN · FINISH STRONG AND COLLECT TICKETS');
    const showFeedback=started&&!paused&&!ended&&state.phase==='racing'&&!waiting&&feedback.until>performance.now();hide('Feedback',!showFeedback);text('Feedback',feedback.text);
    if($('Feedback')?.dataset.kind!==feedback.kind)$('Feedback').dataset.kind=feedback.kind;
    for(const el of document.querySelectorAll('[data-racing-racer]')){const selected=el.dataset.racingRacer===chosen;if(el.getAttribute('aria-pressed')!==String(selected))el.setAttribute('aria-pressed',String(selected));if(el.disabled!==!!N?.localReady)el.disabled=!!N?.localReady;flag(el,'selected',selected);}
    text('PauseBtn',paused?'RESUME':'PAUSE');disable('PauseBtn',!started||ended||state.phase==='finished'||!!N?.congested);
    disable('ResumeBtn',!!N&&(!N.transport||!N.synced||N.congested));text('ResumeBtn',N?.localPause===false&&paused?(N.party?'WAITING FOR THE GROUP…':'WAITING FOR YOUR HOMIE…'):'BACK ON THE ROAD');
    const party=!!N?.party,members=party?N.members||[]:[],readyCount=members.filter(r=>r.ready).length;
    hide('PartyMembers',!party);hide('PartyResultStatus',!party);
    const partySignature=JSON.stringify(members.map(r=>[r.seat,r.racerId,r.ready,r.connected]));
    if(partySignature!==partyListKey){partyListKey=partySignature;const list=$('PartyMembers');list?.replaceChildren();if(list)for(const r of members){const row=document.createElement('li');row.textContent='P'+(r.seat+1)+' · '+name(r.racerId)+(r.seat===RACING_PARTY.state.seat?' · YOU':'')+' · '+(!r.connected?'RECONNECTING':r.ready?'READY':'CHOOSING');list.append(row);}}
    text('PartyResultStatus',readyCount+'/'+members.length+' READY FOR THE NEXT RACE');
    for(const id of ['LaunchBtn','LaunchAgainBtn']){hide(id,!party||N.role!=='host');disable(id,!N?.canLaunch);text(id,N?.canLaunch?'START '+members.length+'-PLAYER RACE':'WAITING FOR EVERYONE TO READY');}
    for(const id of ['LeftBtn','RightBtn','BrakeBtn','BoostBtn'])disable(id,!started||paused||ended||state.phase!=='racing'||p.finishTime!==null);
    if(m==='finished'||m==='disconnected'){
      const medal=$('Result').querySelector('.rc-result-medal');if(medal.hidden!==(ended||p.dnf))medal.hidden=ended||p.dnf;const medalSrc=D.vectors[position===1?'gold-medal':position===2?'silver-medal':position===3?'bronze-medal':'destination-pin'];if(medal.src!==medalSrc)medal.src=medalSrc;
      text('ResultTitle',ended?'RACE INTERRUPTED':p.dnf?'THE SHOW HAS STARTED':position===1?'FIRST TO THE SHOW!':'YOU MADE THE SHOW!');
      text('ResultDetail',ended?notice+' No race result was awarded.':name(p.racerId)+' · '+position+(position===1?'st':position===2?'nd':position===3?'rd':'th')+' place · '+(p.dnf||p.finishTime===null?'TIME LIMIT':p.finishTime.toFixed(2)+'s')+' · '+p.tickets+' tickets');
      const signature=JSON.stringify([ended,seat(),order.map(r=>[r.id,r.racerId,r.finishTime,r.dnf])]);
      if(signature!==placementKey){placementKey=signature;const list=$('Placements');list.replaceChildren();if(!ended)for(let i=0;i<order.length;i++){const r=order[i],row=document.createElement('li');row.textContent=(i+1)+'. '+name(r.racerId)+(Number.isInteger(r.playerSeat)?' · P'+(r.playerSeat+1):'')+(r.id===seat()?' · YOU':'')+' — '+(r.dnf||r.finishTime===null?'DNF':r.finishTime>state.time+.001?'BEHIND YOU':r.finishTime.toFixed(2)+'s');list.append(row);}}
      text('RunSummary',ended?'':N?'ONLINE RACE · BRAGGING RIGHTS EARNED':R.score(state,0).toLocaleString()+' PTS'+(daily?' · DAILY ROUTE':' · PERSONAL BEST '+best.toLocaleString()));
      text('RaceRecap',ended?'':p.drifts+' DRIFT TURBO'+(p.drifts===1?'':'S')+' · '+p.hits+' HIT'+(p.hits===1?'':'S')+' · '+p.tickets+' TICKETS');hide('RaceRecap',ended);
      hide('DailyResult',!daily||ended);text('DailyResult',daily?(p.dnf?'FINISH THE ROUTE TO SET A DAILY RECORD':day+' UTC · BEST '+dailyBest.score.toLocaleString()+' PTS · '+dailyBest.runs+' COMPLETED RUN'+(dailyBest.runs===1?'':'S')):'');
      text('AgainBtn',ended?'NEW SOLO RACE':N?.localReady?(N.party?'READY · WAITING FOR THE GROUP':'WAITING FOR YOUR HOMIE…'):N?.party?'READY FOR ANOTHER RACE':daily?'RACE DAILY ROUTE AGAIN':'RACE AGAIN');disable('AgainBtn',!!N&&(!N.synced||N.localReady||!N.transport||N.congested));
    }
    hide('SaveBtn',m!=='finished'||!!N||ended||daily);disable('SaveBtn',saved);text('SaveBtn',saved?'RECORD SAVED':'SAVE RACE RECORD');hide('ChangeBtn',!!N);
  }
  function drawState(now){
    if(N?.role!=='join'||!previous||previous.racers.length!==state.racers.length||state.phase!=='racing'||paused)return state;
    const t=Math.min(1,Math.max(0,(now-receivedAt)/70));
    return{...state,racers:state.racers.map((r,i)=>({...r,x:previous.racers[i].x+(r.x-previous.racers[i].x)*t,z:previous.racers[i].z+(r.z-previous.racers[i].z)*t}))};
  }
  function advance(dt,input=controls()){
    if(multiplayer?.active){multiplayer.update(dt,input);return;}
    if(!started||paused||ended||state.phase==='finished'||N?.role==='join')return;
    const oldPhase=state.phase,oldCount=Math.ceil(state.countdown),oldTickets=state.racers[0].tickets,oldHits=state.racers[0].hits;
    const peerFresh=N&&performance.now()-N.lastInput<350;
    let peer=peerFresh?N.controls:{steer:0,brake:true,boost:false};
    const oldTime=state.time,localPulse=boostQueued&&state.racers[0].boostTime===0,peerPulse=peerFresh&&N.boostPending&&state.racers[1].boostTime===0;
    // Preserve a complete tap that arrives between physics frames. Only a
    // validated fresh press resets the engine edge latch; it never extends turbo.
    if(dt>0&&state.phase==='racing'){if(localPulse){state.racers[0].boostHeld=false;input={...input,boost:true};}if(peerPulse){state.racers[1].boostHeld=false;peer={...peer,boost:true};}}
    R.update(state,dt,[input,peer]);
    if(state.time>oldTime){boostQueued=false;if(N)N.boostPending=false;}
    observeRace();drawDirty=true;
    if(oldPhase==='countdown'&&state.phase==='racing'){Sound.play('launch',.25);render();}
    else if(oldPhase==='countdown'&&Math.ceil(state.countdown)!==oldCount)Sound.play('beep',.2);
    if(state.racers[0].tickets>oldTickets)Sound.play('matchChime',.15);
    if(state.racers[0].hits>oldHits)Sound.play('slam',.15);
    if(state.phase==='finished'){release();record();snapshot();render();}
  }
  function frame(now){
    if(!active){raf=0;return;}const dt=last?Math.min(.1,(now-last)/1000):0;last=now;
    const moving=started&&!paused&&!ended&&state.phase!=='finished';
    advance(dt);syncMusic();soundFrame();if(renderer&&(moving||drawDirty||renderer.needsRedraw)){renderer.draw(drawState(now),seat(),dt);drawDirty=false;}
    if(moving&&now-uiTime>80){uiTime=now;render();}
    if(N?.role==='host'&&now-netTime>70){netTime=now;snapshot();}
    raf=requestAnimationFrame(frame);
  }
  function enter(){active=true;drawDirty=true;document.body.classList.add('racing-selected');loadAssets();render();last=0;if(!raf)raf=requestAnimationFrame(frame);TICK.set('JCW × ICP — ROAD TO THE SHOW. PICK YOUR RIDE.','MINI BIKES + GO-KARTS');}
  function leave(){if(multiplayer?.active)endParty('A player left the racing room.');else if(started&&state.phase!=='finished')pause(true);active=false;syncMusic();cancelAnimationFrame(raf);raf=0;release();stopMotor();document.body.classList.remove('racing-selected','racing-match');$('Screen').classList.remove('rc-match');}
  function pause(value){
    if(multiplayer?.active){release();multiplayer.pause(typeof value==='boolean'?value:!paused);syncMusic(value===false);return;}
    if(!started||ended||state.phase==='finished')return;
    const next=typeof value==='boolean'?value:!paused;release();last=0;drawDirty=true;
    if(N){if(!N.transport||N.congested&&!next)return;N.localPause=next;if(N.role==='host'){paused=N.localPause||N.peerPause;snapshot();}else{if(next)paused=true;sendInput();}}
    else paused=next;
    notice=paused?'Race paused. Both the road and your rivals can wait.':'Back on the road.';syncMusic(!next);render();
  }
  function send(d){
    if(!N?.transport)return false;
    // Do not queue seconds of obsolete racing state behind a slow connection.
    // https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel/bufferedAmount
    const buffered=Number(NET.state.dc?.bufferedAmount)||0;
    if(buffered>65536||N.congested&&buffered>16384){
      if(!N.congested){N.congested=true;N.localPause=true;N.peerPause=true;paused=started;release();drawDirty=true;
        if(N.role==='host')N.epoch++;else{N.barrier++;N.synced=false;}
        notice='The connection is catching up. The race is paused.';render();}
      return false;
    }
    if(N.congested){N.congested=false;notice='Connection caught up. Both players must resume.';render();}
    NET.push('racing',{v:1,...d});return true;
  }
  function snapshot(){
    if(N?.party)return;
    if(N?.role!=='host'||performance.now()-N.lastSnapshot<65)return;N.lastSnapshot=performance.now();
    // Track geometry is deterministic from the seed. Only per-racer pickup
    // consumption travels over the wire, rather than resending every prop.
    const {objects,...wire}=state;wire.collected=objects.filter(o=>o.collectedBy.length).map(o=>[o.id,...o.collectedBy]);
    send({k:'snapshot',round:N.round,epoch:N.epoch,barrier:N.peerBarrier,seq:++N.tx,ack:N.rx,started,paused,ready:[N.localReady,N.peerReady],choices:[chosen,N.choice],state:wire});
  }
  function expandState(raw){
    if(!raw||Object.hasOwn(raw,'objects')||!integer(raw.seed,4294967295)||!Array.isArray(raw.collected)||raw.collected.length>500)return null;
    if(N.routeSeed!==raw.seed){N.routeSeed=raw.seed;N.route=R.create({seed:raw.seed}).objects;}
    const known=new Set(N.route.map(o=>o.id)),taken=new Map();
    for(const row of raw.collected){if(!Array.isArray(row)||row.length<2||row.length>7||!known.has(row[0])||taken.has(row[0])||row.slice(1).some(i=>!integer(i,5))||new Set(row.slice(1)).size!==row.length-1)return null;taken.set(row[0],row.slice(1));}
    const {collected,...plain}=raw;return{...plain,objects:N.route.map(o=>({...o,collectedBy:taken.get(o.id)||[]}))};
  }
  function sendInput(){if(multiplayer?.active){multiplayer.input(controls());return;}if(N?.role!=='join'||!N.transport||!N.synced)return;send({k:'input',round:N.round,epoch:N.epoch,seq:++N.tx,choice:chosen,ready:N.localReady,paused:N.localPause,controls:controls(),loaded:!!assets});}
  function heartbeatTick(){
    if(!N)return;const now=performance.now();
    if(N.role==='join'){if(N.synced)sendInput();else send({k:'sync',barrier:N.barrier});if(now-N.lastSeen>2200&&started&&!paused){N.localPause=true;paused=true;release();notice='Waiting for your homie. The race is paused.';render();}}
    else{
      if(started&&state.phase!=='finished'&&now-N.lastSeen>2200&&!N.stalled){N.stalled=true;N.epoch++;N.localPause=true;N.peerPause=true;paused=true;release();notice='Your homie stopped responding. Both players must resume.';render();}
      snapshot();
    }
  }
  function ready(){
    if(multiplayer?.active){if(!assets)return false;const accepted=multiplayer.ready();syncMusic(true);return accepted;}
    if(!N||!assets||!N.transport||!N.synced||N.congested||started&&state.phase!=='finished'||N.localReady)return false;
    N.localReady=true;syncMusic(true);if(N.role==='host')maybeStart();else sendInput();snapshot();render();return true;
  }
  function maybeStart(){
    if(N?.role!=='host'||!N.localReady||!N.peerReady||!N.peerLoaded||!assets||N.congested)return;
    N.round++;N.localReady=false;N.peerReady=false;N.localPause=false;N.peerPause=false;N.stalled=false;N.boostPending=false;N.controls={steer:0,brake:false,boost:false};
    state=R.create({seed:seed(),playerRacer:chosen,guestRacer:N.choice,online:true});started=true;paused=false;ended=false;saved=false;recorded=false;release();resetFeedback();last=0;notice='Two homies. Four rivals. First to the show wins.';render();window.scrollTo(0,0);renderer?.resize();
  }
  function netStart(role){
    endParty('Switched to a head-to-head race.');
    if(!['host','join'].includes(role))return;clearInterval(heartbeat);release();
    localSeat=role==='join'?1:0;onlineMatch=true;runMode='convoy';raceDay='';
    N={role,round:0,epoch:0,barrier:0,peerBarrier:0,tx:0,rx:0,transport:true,congested:false,synced:role==='host',localReady:false,peerReady:false,localPause:false,peerPause:false,choice:ids.find(id=>id!==chosen),peerLoaded:false,boostPending:false,lastSeen:performance.now(),lastInput:0,lastSnapshot:-1000,controls:{steer:0,brake:false,boost:false},stalled:false};
    state=R.create({playerRacer:chosen,online:true});started=false;paused=false;ended=false;previous=null;resetFeedback();notice='Choose a ride. Both players must be ready before the countdown.';loadAssets();render();snapshot();
    if(role==='join')send({k:'sync',barrier:N.barrier});heartbeat=setInterval(heartbeatTick,140);
  }
  function cleanState(s){
    if(!s||s.version!==1||!integer(s.seed,4294967295)||!['countdown','racing','finished'].includes(s.phase)||!finite(s.time,0,300)||s.length!==15000||!finite(s.countdown,-1,3)||!Array.isArray(s.racers)||s.racers.length!==6||!Array.isArray(s.objects)||s.objects.length>500||!Array.isArray(s.finishOrder)||s.finishOrder.length>6||new Set(s.finishOrder).size!==s.finishOrder.length||s.finishOrder.some(id=>!integer(id,5)))return null;
    if(!integer(s.tick,30000)||!finite(s.remainder,0,.25)||typeof s.timedOut!=='boolean'||!Array.isArray(s.events)||s.events.length>16||s.events.some(e=>!e||typeof e.id!=='string'||!['pickup','hit','finish','zone','drift'].includes(e.type)||!integer(e.racer,5)||!finite(e.time,0,180)||e.type==='drift'&&(![1,2].includes(e.tier)||!finite(e.amount,0,e.tier===2?22:12))))return null;
    if(s.phase==='countdown'&&(s.time!==0||s.countdown<=0||s.tick>=360)||s.phase!=='countdown'&&s.countdown!==0)return null;
    for(let i=0;i<6;i++){const r=s.racers[i];if(!r||r.id!==i||!ids.includes(r.racerId)||typeof r.human!=='boolean'||!finite(r.x,-1,1)||!finite(r.z,0,16000)||!finite(r.speed,0,312.5)||!finite(r.boost,0,100)||!finite(r.health,0,100)||!integer(r.tickets,1000)||!integer(r.hits,10000)||!finite(r.invulnerable,0,10)||!finite(r.steer,-1,1)||typeof r.boosting!=='boolean'||!finite(r.boostTime,0,3)||typeof r.boostHeld!=='boolean'||r.boosting!==(r.boostTime>0)||!(r.finishTime===null||finite(r.finishTime,0,300)))return null;}
    for(const r of s.racers){if(typeof r.dnf!=='boolean'||typeof r.drafting!=='boolean'||r.z>s.length||r.finishTime!==null&&(r.z!==s.length||r.speed!==0)||r.dnf&&!s.timedOut)return null;}
    for(const r of s.racers){
      if(r.boosting&&(r.drifting||r.driftTurbo>0)||(s.phase==='countdown'||r.finishTime!==null)&&(r.boostTime!==0||r.boostHeld))return null;
      if(typeof r.drifting!=='boolean'||!finite(r.driftCharge,0,2)||![-1,0,1].includes(r.driftDirection)||!finite(r.driftTurbo,0,2)||!integer(r.drifts,1000))return null;
      if(r.drifting&&(r.driftDirection===0||r.driftTurbo>0)||!r.drifting&&(r.driftCharge!==0||r.driftDirection!==0)||r.finishTime!==null&&(r.drifting||r.driftTurbo>0)||s.phase==='countdown'&&(r.drifting||r.driftTurbo>0||r.drifts>0))return null;
    }
    const finished=s.racers.filter(r=>r.finishTime!==null).map(r=>r.id);
    if(s.finishOrder.length!==finished.length||s.finishOrder.some(id=>!finished.includes(id))||s.phase==='finished'&&finished.length!==6||s.phase==='countdown'&&(finished.length||s.racers.some(r=>r.speed!==0||r.human&&r.z!==0||r.z>500)))return null;
    if(s.phase==='finished'&&JSON.stringify(s.finishOrder)!==JSON.stringify(R.standings(s).map(r=>r.id)))return null;
    const seen=new Set();for(const o of s.objects){if(!o||!['string','number'].includes(typeof o.id)||seen.has(o.id)||!['ticket','boost','repair','cone','barrier','tire'].includes(o.kind)||!finite(o.x,-1.5,1.5)||!finite(o.z,0,16000)||!Array.isArray(o.collectedBy)||o.collectedBy.length>6||o.collectedBy.some(i=>!integer(i,5)))return null;seen.add(o.id);}
    // Reject nested payloads, non-finite values and unbounded strings before a
    // snapshot reaches canvas, including unexpected optional engine fields.
    let budget=20000;function safe(v,depth=0){if(--budget<0||depth>7)return false;if(v===null||typeof v==='boolean')return true;if(typeof v==='number')return Number.isFinite(v);if(typeof v==='string')return v.length<180;if(typeof v!=='object')return false;return Object.entries(v).every(([k,x])=>!['__proto__','constructor','prototype'].includes(k)&&safe(x,depth+1));}
    return safe(s)?clone(s):null;
  }
  function netApply(d){
    if(!N||!d||d.v!==1)return;
    if(N.role==='host'){
      if(d.k==='sync'){if(!integer(d.barrier))return;if(d.barrier>N.peerBarrier){N.peerBarrier=d.barrier;N.epoch++;N.localPause=true;N.peerPause=true;paused=started;release();notice='Connection restored. Both players must resume.';render();}snapshot();return;}
      if(d.k!=='input'||d.round!==N.round||d.epoch!==N.epoch||!integer(d.seq)||d.seq<=N.rx||!ids.includes(d.choice)||typeof d.ready!=='boolean'||typeof d.paused!=='boolean'||typeof d.loaded!=='boolean'||!d.controls||!finite(d.controls.steer,-1,1)||typeof d.controls.brake!=='boolean'||typeof d.controls.boost!=='boolean')return;
      if(started&&!paused&&!d.paused&&state.phase==='racing'&&d.controls.boost&&!N.controls.boost&&state.racers[1].boostTime===0)N.boostPending=true;
      N.rx=d.seq;N.lastSeen=performance.now();N.lastInput=N.lastSeen;N.stalled=false;N.controls={steer:d.controls.steer,brake:d.controls.brake,boost:d.controls.boost};N.peerPause=d.paused;N.peerLoaded=d.loaded;
      if(!started||state.phase==='finished'){N.choice=d.choice;N.peerReady=d.ready;maybeStart();}else paused=N.localPause||N.peerPause;
      if(paused)release();
      snapshot();render();return;
    }
    if(d.k!=='snapshot'||!integer(d.seq)||d.seq<=N.rx||!integer(d.round)||d.round<N.round||d.round>N.round+1||!integer(d.epoch)||d.epoch<N.epoch||!integer(d.barrier)||d.barrier<N.barrier||!integer(d.ack)||typeof d.started!=='boolean'||typeof d.paused!=='boolean'||!Array.isArray(d.ready)||d.ready.length!==2||d.ready.some(b=>typeof b!=='boolean')||!Array.isArray(d.choices)||d.choices.length!==2||d.choices.some(id=>!ids.includes(id)))return;
    const expanded=expandState(d.state),next=expanded&&cleanState(expanded);if(!next)return;
    if(!d.started&&next.phase!=='countdown')return;
    const newRound=d.round>N.round,newEpoch=d.epoch>N.epoch;
    if(!newRound&&started&&next.time<state.time)return;
    N.rx=d.seq;N.round=d.round;N.epoch=d.epoch;N.synced=true;N.lastSeen=performance.now();
    if(newRound){N.localReady=false;N.localPause=false;release();resetFeedback();notice='Two homies. Four rivals. First to the show wins.';window.scrollTo(0,0);}
    if(newEpoch){N.localPause=true;release();notice='Connection restored. Both players must resume.';}
    if(!newRound&&started){if(next.racers[localSeat].tickets>state.racers[localSeat].tickets)Sound.play('matchChime',.15);if(next.racers[localSeat].hits>state.racers[localSeat].hits)Sound.play('slam',.15);}
    N.peerReady=d.ready[0];if(next.tick!==state.tick||newRound)drawDirty=true;previous=newRound?null:state;state=next;receivedAt=performance.now();started=d.started;paused=d.paused||N.localPause;ended=false;observeRace();
    if(state.phase==='finished'){paused=false;release();}render();
  }
  function netConnection(status){
    if(!N||!['disconnected','connected'].includes(status)||status==='connected'&&N.transport)return;release();N.localPause=true;N.peerPause=true;paused=started;N.transport=status==='connected';N.lastSeen=performance.now();
    if(status==='disconnected'){N.synced=N.role==='host';if(N.role==='host')N.epoch++;notice='Connection interrupted. Waiting for your homie to reconnect.';}
    else{notice='Connection restored. Both players must resume.';if(N.role==='host')snapshot();else{N.barrier++;N.synced=false;send({k:'sync',barrier:N.barrier});}}
    render();
  }
  function netEnd(reason='The online race ended.'){
    if(N?.party)return;
    if(!N)return;clearInterval(heartbeat);heartbeat=0;N=null;ended=true;started=true;paused=false;notice=String(reason||'The online race ended.').slice(0,160);release();render();
  }
  function bind(){
    multiplayer=RACING_MULTI.create({transport:RACING_PARTY,onChange:partyChanged,controls,choice:()=>chosen});RACING_PARTY.bindUI();
    for(const e of document.querySelectorAll('[data-racing-vector]'))e.src=D.vectors[e.dataset.racingVector];
    for(const e of document.querySelectorAll('[data-racing-background]'))e.src=D.backgrounds[Number(e.dataset.racingBackground)];
    for(const e of document.querySelectorAll('[data-racing-rider]'))e.src=D.riders[e.dataset.racingRider];
    for(const r of D.manifest.racers){const b=document.createElement('button');b.type='button';b.dataset.racingRacer=r.id;b.className='rc-racer';b.style.setProperty('--ride-color',r.color);const img=document.createElement('img');img.src=D.riders[r.id];img.alt='';const strong=document.createElement('strong');strong.textContent=r.name;const small=document.createElement('small');small.textContent=r.vehicle==='kart'?'GO-KART · STABILITY':'MINI BIKE · AGILITY';b.append(img,strong,small);b.onclick=()=>choose(r.id);$('Roster').append(b);}
    $('StartBtn').onclick=start;$('AgainBtn').onclick=start;$('PauseBtn').onclick=()=>pause();$('ResumeBtn').onclick=()=>pause(false);$('HomeBtn').onclick=()=>showScreen('menu');$('SoundBtn').onclick=()=>{toggleSound();syncMusic(true);render();};
    $('MusicSelect').onchange=e=>selectMusic(e.target.value);$('PauseMusicSelect').onchange=e=>selectMusic(e.target.value);
    $('LaunchBtn').onclick=$('LaunchAgainBtn').onclick=()=>{if(assets)multiplayer.launch();syncMusic(true);};
    $('ConvoyBtn').onclick=()=>chooseMode('convoy');$('DailyBtn').onclick=()=>chooseMode('daily');
    $('ChangeBtn').onclick=()=>{if(N)return;started=false;ended=false;paused=false;localSeat=0;onlineMatch=false;raceDay='';state=R.create({playerRacer:chosen});resetFeedback();notice='Choose a new ride for the next run.';render();};
    $('SaveBtn').onclick=()=>{if(!ended&&!N&&runMode!=='daily'&&state.phase==='finished'&&!saved){saved=true;const p=state.racers[0];LB.check('racing',R.score(state,0),name(p.racerId)+' · '+(p.dnf?'DNF — TIME LIMIT':p.finishTime.toFixed(2)+'s'));render();}};
    for(const[id,control]of[['LeftBtn','left'],['RightBtn','right'],['BrakeBtn','brake'],['BoostBtn','boost']]){
      const b=$(id);b.addEventListener('pointerdown',e=>{if(b.disabled)return;e.preventDefault();syncMusic(true);if(control==='boost')queueBoost();b.setPointerCapture?.(e.pointerId);pointers.set(e.pointerId,control);b.classList.add('held');sendInput();});
      if(control==='boost'){
        b.addEventListener('keydown',e=>{if(b.disabled||![' ','Enter'].includes(e.key))return;e.preventDefault();e.stopPropagation();if(!e.repeat){syncMusic(true);queueBoost();keys.set(e.code||e.key,'boost');sendInput();}});
        b.addEventListener('keyup',e=>{if(![' ','Enter'].includes(e.key))return;e.preventDefault();e.stopPropagation();keys.delete(e.code||e.key);sendInput();});
      }
      const up=e=>{pointers.delete(e.pointerId);if(![...pointers.values()].includes(control))b.classList.remove('held');sendInput();};b.addEventListener('pointerup',up);b.addEventListener('pointercancel',up);b.addEventListener('lostpointercapture',up);b.addEventListener('contextmenu',e=>e.preventDefault());
    }
    const map={ArrowLeft:'left',a:'left',A:'left',ArrowRight:'right',d:'right',D:'right',ArrowDown:'brake',s:'brake',S:'brake',' ':'boost',Shift:'boost'};
    document.addEventListener('keydown',e=>{if(!active||gameKeysBlocked(e)||e.target.closest('input,select,textarea')||e.key===' '&&e.target.closest('button,a[href]'))return;if(e.key==='p'||e.key==='P'||e.key==='Escape'){e.preventDefault();if(!e.repeat)pause();return;}if(map[e.key]&&started&&!paused&&!ended&&state.racers[seat()].finishTime===null&&['countdown','racing'].includes(state.phase)){e.preventDefault();if(!e.repeat)syncMusic(true);if(map[e.key]==='boost'&&!e.repeat)queueBoost();keys.set(e.code||e.key,map[e.key]);sendInput();}});
    document.addEventListener('keyup',e=>{if(map[e.key]){keys.delete(e.code||e.key);if(active)sendInput();}});
    window.addEventListener('blur',()=>{musicSuspended=true;release();if(active)pause(true);syncMusic();});window.addEventListener('focus',()=>{musicSuspended=false;syncMusic();});document.addEventListener('visibilitychange',()=>{if(document.hidden){release();if(active)pause(true);}syncMusic();});
    const resize=()=>{renderer?.resize();drawDirty=true;};window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);render();
  }
  return{bind,enter,leave,start,choose,chooseMode,pause,ready,openParty,endParty,partyActive:()=>!!multiplayer?.active,launch:()=>!!assets&&multiplayer?.launch(),netStart,netApply,netConnection,netEnd,loadAssets,get state(){return{...clone(state),mode:mode(),seat:seat(),chosen,loaded:!!assets,paused,started,ended,best,wins,playMode:onlineMatch?'online':'solo',saved,runMode,raceDay,dailyDate:raceDay||utcDay(),dailyBest:clone(dailyRecords[raceDay||utcDay()]||null),music:music.state};},netState:()=>N?clone({...N,controls:{...N.controls}}):null,debug:{advance,advanceAll:(dt,inputs)=>multiplayer?.debug.advanceAll(dt,inputs),controls,cleanState}};
})();
