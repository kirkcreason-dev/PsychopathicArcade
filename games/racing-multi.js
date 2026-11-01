/* Eight-player race protocol. Only the host advances physics. Transport seats
 * identify people; contiguous actor IDs identify this round's simulation. */
const RACING_MULTI=(()=>{
  'use strict';
  const R=RACING_RULES,ids=R.roster.map(r=>r.id),MAX=8;
  const number=(v,a,b)=>typeof v==='number'&&Number.isFinite(v)&&v>=a&&v<=b;
  const integer=(v,max=1e9)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
  const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
  const keys=(v,list)=>object(v)&&Object.keys(v).every(k=>list.includes(k));
  const clone=v=>JSON.parse(JSON.stringify(v));
  const neutral=()=>({steer:0,brake:false,boost:false});
  const stop=()=>({steer:0,brake:true,boost:false});
  const cleanInput=v=>keys(v,['steer','brake','boost'])&&number(v.steer,-1,1)&&typeof v.brake==='boolean'&&typeof v.boost==='boolean'?{steer:v.steer,brake:v.brake,boost:v.boost}:null;
  function create({transport,onChange=()=>{},controls=neutral,choice=()=>ids[0]}={}){
    if(!transport||typeof transport.configure!=='function')throw new Error('A racing party transport is required.');
    const now=()=>performance.now();
    let chosen=typeof choice==='function'?choice():choice;if(!ids.includes(chosen))chosen=ids[0];
    let active=false,role=null,seat=0,round=0,epoch=0,tx=0,rx=0,barrier=0,intentSeq=0;
    let state=R.create({playerRacer:chosen}),mapping=[],members=new Map();
    let started=false,paused=false,ended=false,synced=false,congested=false,localReady=false,localPause=false;
    let notice='Choose a ride. Everybody gets ready, then the host launches.',lastSeen=0,lastSend=-Infinity,lastSnapshot=-Infinity,waiting=false;
    let currentInput=neutral(),localBoostPending=false,routeSeed=null,routeCache=[];
    const liveRace=()=>started&&state.phase!=='finished';
    const connected=()=>active&&(role==='host'||members.get(0)?.connected===true);
    const localActor=()=>started?Math.max(0,mapping.indexOf(seat)):0;
    const summary=()=>[...members.values()].sort((a,b)=>a.seat-b.seat).map(m=>({seat:m.seat,racerId:m.racerId,ready:m.ready,paused:m.paused,connected:m.connected,...(mapping.includes(m.seat)?{actorId:mapping.indexOf(m.seat)}:{})}));
    const canLaunch=()=>active&&role==='host'&&!liveRace()&&!congested&&members.size>=2&&members.size<=MAX&&[...members.values()].every(m=>m.connected&&m.ready);
    function netState(){return{party:true,role,seat,transport:connected(),synced,congested,localReady,localPause,canLaunch:canLaunch(),members:summary(),round,epoch,barrier};}
    function emit(){onChange({state,started,paused,ended,notice,localSeat:localActor(),net:netState()});}
    function preview(){state=R.create({playerRacer:chosen});}
    function member(id,isConnected=true){return{seat:id,racerId:id===seat?chosen:ids[id%ids.length],ready:false,paused:false,connected:isConnected,barrier:0,ack:0,lastSeen:now(),lastInput:-Infinity,input:neutral(),boostPending:false,stalled:false};}
    function write(data,target){if(!active||congested)return false;return transport.send(data,target)!==false;}
    function pack(){const{objects,...rest}=state;return{...rest,collected:objects.filter(o=>o.collectedBy.length).map(o=>[o.id,...o.collectedBy])};}
    function snapshot(force=false){
      // Results, lobbies and pauses still heartbeat, but need no animation-rate
      // fanout. Ready/resume/roster changes always bypass this idle interval.
      const interval=liveRace()&&!paused?1000/14:500;
      if(!active||role!=='host'||congested||!force&&now()-lastSnapshot<interval)return false;
      lastSnapshot=now();
      const packet={v:1,k:'snapshot',round,epoch,seq:++tx,started,paused,mapping:mapping.slice(),members:[...members.values()].sort((a,b)=>a.seat-b.seat).map(m=>({seat:m.seat,racerId:m.racerId,ready:m.ready,paused:m.paused,connected:m.connected,barrier:m.barrier,ack:m.ack})),state:started?pack():null};
      return write(packet);
    }
    function sendInput(intent=false){
      if(!active||role!=='join'||!synced||!connected()||congested)return false;
      const seq=++tx;if(intent)intentSeq=seq;lastSend=now();
      return write({v:1,k:'input',round,epoch,seq,racerId:chosen,ready:localReady,paused:localPause,controls:currentInput});
    }
    function syncRequest(){lastSend=now();return write({v:1,k:'sync',barrier});}
    function hostPause(message){
      if(!liveRace())return;
      epoch++;paused=true;localPause=true;currentInput=neutral();localBoostPending=false;
      for(const m of members.values()){m.paused=true;m.input=neutral();m.boostPending=false;m.lastInput=-Infinity;}
      notice=message;snapshot(true);emit();
    }
    function guestBarrier(message){
      if(role!=='join')return;
      barrier++;synced=false;waiting=true;localPause=liveRace();if(liveRace())paused=true;currentInput=neutral();
      notice=message;syncRequest();emit();
    }
    function resetLobby(){
      started=false;paused=false;mapping=[];localReady=false;localPause=false;epoch++;
      for(const m of members.values()){m.ready=false;m.paused=false;}
      preview();notice='The room changed. Choose a ride and get ready again.';
    }
    function open(newRole,newSeat){
      if(!['host','join'].includes(newRole)||!integer(newSeat,7)||newRole==='host'&&newSeat!==0)return;
      // Transport emits once per room; this controller survives subsequent rooms.
      active=true;role=newRole;seat=newSeat;round=epoch=tx=rx=barrier=intentSeq=0;started=paused=ended=congested=localReady=localPause=waiting=false;
      synced=role==='host';mapping=[];members=new Map();members.set(seat,member(seat));if(role==='join')members.set(0,member(0,false));
      chosen=typeof choice==='function'?choice():chosen;if(!ids.includes(chosen))chosen=ids[0];members.get(seat).racerId=chosen;
      currentInput=neutral();localBoostPending=false;lastSeen=now();lastSend=lastSnapshot=-Infinity;routeSeed=null;preview();
      notice='Choose a ride. Everybody gets ready, then the host launches.';emit();
      if(role==='host')roster(transport.state?.members||[{seat:0,connected:true}]);else syncRequest();
    }
    function roster(list){
      if(!active||!Array.isArray(list)||list.length>MAX)return;
      if(list.some(m=>!object(m)||!integer(m.seat,7)||typeof m.connected!=='boolean')||new Set(list.map(m=>m.seat)).size!==list.length)return;
      if(role==='join'){
        // The transport is authoritative for connection flags, the host for
        // choices/readiness. A new guest may not have a game snapshot yet.
        for(const item of list){const m=members.get(item.seat)||member(item.seat,item.connected);m.connected=item.connected;members.set(item.seat,m);}
        emit();return;
      }
      if(!list.some(m=>m.seat===0))return;
      const next=new Set(list.map(m=>m.seat)),changed=next.size!==members.size||[...next].some(s=>!members.has(s));
      if(liveRace()&&mapping.some(s=>!next.has(s))){end('A rider left. This online race has ended without a result.');return;}
      if(liveRace()&&[...next].some(s=>!mapping.includes(s)))return;
      if(changed&&started)resetLobby();
      for(const key of members.keys())if(!next.has(key))members.delete(key);
      let lost=false;
      for(const item of list){let m=members.get(item.seat);if(!m){m=member(item.seat,item.connected);members.set(item.seat,m);}if(m.connected&&!item.connected)lost=true;m.connected=item.connected;}
      if(changed){for(const m of members.values())m.ready=false;localReady=false;}
      if(lost&&liveRace())hostPause('A rider disconnected. Everyone must resume after the connection recovers.');
      snapshot(true);emit();
    }
    function connection(remote,status){
      if(!active||!integer(remote,7)||!['connected','disconnected','closed'].includes(status))return;
      if(status==='closed'){
        if(role==='join'||liveRace()){end('A rider left. This online race has ended without a result.');return;}
        if(members.has(remote)){members.delete(remote);if(started)resetLobby();snapshot(true);emit();}return;
      }
      const m=members.get(remote);if(m)m.connected=status==='connected';
      if(role==='host'){
        if(status==='disconnected'&&liveRace())hostPause('A rider disconnected. Everyone must resume after the connection recovers.');
        if(m&&status==='connected'){m.lastSeen=now();m.stalled=false;}
        snapshot(true);emit();
      }else if(remote===0){
        if(status==='disconnected'){synced=false;localPause=liveRace();paused=liveRace();notice='Connection interrupted. The race is paused.';emit();}
        else guestBarrier('Reconnecting to the host. Waiting for the current race state.');
      }
    }
    function unpack(raw,map){
      if(!keys(raw,['version','seed','phase','countdown','time','length','tick','remainder','racers','events','finishOrder','timedOut','collected']))return null;
      const n=Math.max(6,map.length);
      if(raw.version!==1||!integer(raw.seed,4294967295)||raw.length!==15000||!['countdown','racing','finished'].includes(raw.phase)||!number(raw.time,0,180.000001)||!number(raw.countdown,0,3)||!integer(raw.tick,21960)||!number(raw.remainder,0,.25)||typeof raw.timedOut!=='boolean'||!Array.isArray(raw.racers)||raw.racers.length!==n)return null;
      if(raw.phase==='countdown'?(raw.tick>=360||raw.time!==0||Math.abs(raw.countdown-(3-raw.tick/120))>.00001):(raw.tick<360||raw.countdown!==0||Math.abs(raw.time-(raw.tick-360)/120)>.00001))return null;
      if(raw.timedOut&&(raw.phase!=='finished'||raw.time<180))return null;
      const racerKeys=['id','racerId','human','x','z','speed','boost','health','tickets','hits','invulnerable','steer','boosting','boostTime','boostHeld','drafting','drifting','driftCharge','driftDirection','driftTurbo','drifts','finishTime','dnf','playerSeat'];
      for(let i=0;i<n;i++){
        const r=raw.racers[i];if(!keys(r,racerKeys)||r.id!==i||!ids.includes(r.racerId)||r.human!==(i<map.length)||r.human&&r.playerSeat!==map[i]||!r.human&&r.playerSeat!==undefined)return null;
        for(const [key,a,b]of[['x',-1,1],['z',0,15000],['speed',0,R.constants.MAX_SPEED],['boost',0,100],['boostTime',0,3],['health',0,100],['invulnerable',0,2],['steer',-1,1],['driftCharge',0,2],['driftTurbo',0,2]])if(!number(r[key],a,b))return null;
        if(['boosting','boostHeld','drafting','drifting','dnf'].some(k=>typeof r[k]!=='boolean')||['tickets','hits','drifts'].some(k=>!integer(r[k],1000))||![-1,0,1].includes(r.driftDirection))return null;
        if(r.boosting!==(r.boostTime>0)||r.boosting&&(r.drifting||r.driftTurbo>0))return null;
        if(!r.drifting&&(r.driftCharge!==0||r.driftDirection!==0)||r.drifting&&(r.driftDirection===0||r.driftTurbo!==0)||r.dnf&&!raw.timedOut)return null;
        if(r.finishTime!==null&&(!number(r.finishTime,0,300)||r.z!==15000||r.speed!==0||r.drifting||r.driftTurbo!==0||r.boosting||r.boostHeld||r.drafting||r.steer!==0))return null;
        if(raw.phase!=='finished'&&r.finishTime!==null&&r.finishTime>raw.time+.00001)return null;
        if(raw.phase==='countdown'&&(r.speed!==0||r.human&&r.z!==0||!r.human&&r.z>500||r.finishTime!==null||r.tickets||r.hits||r.drifts||r.boostTime||r.boostHeld))return null;
      }
      if(!Array.isArray(raw.finishOrder)||raw.finishOrder.length>n||new Set(raw.finishOrder).size!==raw.finishOrder.length||raw.finishOrder.some(i=>!integer(i,n-1)||raw.racers[i].finishTime===null)||raw.racers.some(r=>r.finishTime!==null&&!raw.finishOrder.includes(r.id)))return null;
      if(raw.phase==='finished'&&(raw.finishOrder.length!==n||R.standings(raw).some((r,i)=>raw.finishOrder[i]!==r.id)))return null;
      if(!Array.isArray(raw.collected)||raw.collected.length>160)return null;
      if(routeSeed!==raw.seed){routeSeed=raw.seed;routeCache=R.create({seed:raw.seed}).objects;}
      const known=new Map(routeCache.map(o=>[o.id,o])),taken=new Map();
      for(const row of raw.collected){if(!Array.isArray(row)||row.length<2||row.length>n+1||!known.has(row[0])||taken.has(row[0])||new Set(row.slice(1)).size!==row.length-1||row.slice(1).some(i=>!integer(i,n-1)))return null;taken.set(row[0],row.slice(1));}
      for(const r of raw.racers){let tickets=0,hits=0;for(const [id,actors]of taken)if(actors.includes(r.id)){if(known.get(id).kind==='ticket')tickets++;else if(!R.kinds[known.get(id).kind].pickup)hits++;}if(r.tickets!==tickets||r.hits!==hits)return null;}
      if(!Array.isArray(raw.events)||raw.events.length>16||new Set(raw.events.map(e=>e?.id)).size!==raw.events.length)return null;
      for(const e of raw.events){
        if(!keys(e,['id','time','type','racer','object','kind','amount','tier','zone','finishTime','projected'])||typeof e.id!=='string'||e.id.length>100||!number(e.time,0,raw.time)||!integer(e.racer,n-1))return null;
        // Subtracting two valid floating-point meter values can leave a tiny
        // positive rounding residue (for example 28.000000000000004).
        if(e.type==='pickup'||e.type==='hit'){const o=known.get(e.object);if(!o||e.kind!==o.kind||!taken.get(o.id)?.includes(e.racer)||!!R.kinds[o.kind].pickup!==(e.type==='pickup'))return null;if(e.type==='pickup'&&!number(e.amount,0,R.kinds[o.kind].amount+1e-8))return null;}
        else if(e.type==='drift'){if(![1,2].includes(e.tier)||!number(e.amount,0,(e.tier===1?12:22)+1e-8))return null;}
        else if(e.type==='zone'){if(![1,2].includes(e.zone))return null;}
        else if(e.type==='finish'){if(!number(e.finishTime,0,300)||typeof e.projected!=='boolean'||raw.racers[e.racer].finishTime!==e.finishTime)return null;}
        else return null;
      }
      const{collected,...plain}=clone(raw);return{...plain,objects:routeCache.map(o=>({...o,collectedBy:taken.get(o.id)?.slice()||[]}))};
    }
    function receiveSnapshot(p,source){
      if(role!=='join'||source!==0||!keys(p,['v','k','round','epoch','seq','started','paused','mapping','members','state'])||!integer(p.round)||!integer(p.epoch)||!integer(p.seq)||p.seq<=rx||p.round<round||p.epoch<epoch||typeof p.started!=='boolean'||typeof p.paused!=='boolean')return;
      if(!Array.isArray(p.members)||p.members.length<2||p.members.length>MAX||!Array.isArray(p.mapping)||p.mapping.length>MAX)return;
      const list=new Map();
      for(const m of p.members){if(!keys(m,['seat','racerId','ready','paused','connected','barrier','ack'])||!integer(m.seat,7)||list.has(m.seat)||!ids.includes(m.racerId)||['ready','paused','connected'].some(k=>typeof m[k]!=='boolean')||!integer(m.barrier)||!integer(m.ack))return;list.set(m.seat,{...m});}
      const own=list.get(seat);if(!list.has(0)||!own||own.barrier!==barrier)return;
      let next;
      if(p.started){
        if(p.round<1||p.mapping.length<2||new Set(p.mapping).size!==p.mapping.length||p.mapping.some((id,i)=>!integer(id,7)||!list.has(id)||i&&id<=p.mapping[i-1])||p.mapping[0]!==0||!p.mapping.includes(seat)||p.members.length!==p.mapping.length)return;
        next=unpack(p.state,p.mapping);if(!next)return;
        if(next.racers.slice(0,p.mapping.length).some((r,i)=>r.racerId!==list.get(p.mapping[i]).racerId)&&next.phase!=='finished')return;
        if(p.paused!==(next.phase!=='finished'&&p.members.some(m=>m.paused||!m.connected)))return;
        if(p.round===round&&started&&(p.mapping.join()!==mapping.join()||next.tick<state.tick||next.seed!==state.seed||next.racers.some((r,i)=>r.racerId!==state.racers[i].racerId)))return;
      }else if(p.state!==null||p.mapping.length||p.paused)return;
      const changedRound=p.round!==round,changedEpoch=p.epoch!==epoch;
      rx=p.seq;round=p.round;epoch=p.epoch;lastSeen=now();synced=true;waiting=false;members=list;mapping=p.mapping.slice();started=p.started;paused=p.paused;
      // The seat owns its selected character. In particular, an initial host
      // placeholder must not overwrite a saved local choice before its first
      // input is acknowledged. Readiness/pause still follow acknowledged intent.
      if(changedRound||changedEpoch||own.ack>=intentSeq){localReady=own.ready;localPause=own.paused;}
      if(changedEpoch&&liveRace()){currentInput=neutral();localPause=own.paused;}
      if(started)state=next;else preview();
      notice=!started?'Choose a ride. Everybody gets ready, then the host launches.':state.phase==='finished'?'Race complete. Get ready for a rematch.':paused?'The race is paused. Every paused rider must resume.':'Race to the next JCW show!';
      emit();if(changedRound||changedEpoch)sendInput();
    }
    function receive(p,source){
      if(!active||!object(p)||p.v!==1||!integer(source,7))return;
      if(p.k==='snapshot'){receiveSnapshot(p,source);return;}
      if(role!=='host'||source===0||!members.has(source))return;
      const m=members.get(source);
      if(p.k==='sync'){
        if(!keys(p,['v','k','barrier'])||!integer(p.barrier)||p.barrier<m.barrier)return;
        if(p.barrier>m.barrier){m.barrier=p.barrier;if(liveRace())hostPause('Connection recovered. Everyone must resume together.');}
        m.lastSeen=now();m.stalled=false;snapshot(true);return;
      }
      if(p.k!=='input'||!keys(p,['v','k','round','epoch','seq','racerId','ready','paused','controls'])||p.round!==round||p.epoch!==epoch||!integer(p.seq)||p.seq<=m.ack||!ids.includes(p.racerId)||typeof p.ready!=='boolean'||typeof p.paused!=='boolean')return;
      const input=cleanInput(p.controls);if(!input)return;
      const priorPause=paused,priorMemberPause=m.paused,priorReady=m.ready,priorChoice=m.racerId;
      // Preserve a short tap across two packets received before the next
      // physics frame. It buys at most one engine attempt, never extra time.
      if(input.boost&&!m.input.boost&&liveRace()&&!paused&&!m.paused)m.boostPending=true;
      m.ack=p.seq;m.lastSeen=m.lastInput=now();m.input=input;m.stalled=false;
      if(!liveRace()){m.racerId=p.racerId;m.ready=p.ready;m.paused=false;}
      else{
        m.ready=false;
        if(p.paused&&!m.paused){hostPause('A rider paused. Everyone must resume together.');return;}
        m.paused=p.paused;paused=[...members.values()].some(v=>v.paused||!v.connected);
      }
      if(priorPause!==paused||priorMemberPause!==m.paused||priorReady!==m.ready||priorChoice!==m.racerId){snapshot(true);emit();}
    }
    function ready(){
      if(!active||liveRace()||!connected()||!synced||congested||localReady)return false;
      localReady=true;if(role==='host'){members.get(0).ready=true;snapshot(true);}else sendInput(true);emit();return true;
    }
    function choose(id){
      if(!ids.includes(id)||liveRace())return false;chosen=id;localReady=false;
      if(!started)preview();
      if(active){if(role==='host'){const m=members.get(0);m.racerId=id;m.ready=false;snapshot(true);}else sendInput(true);emit();}return true;
    }
    function launch(){
      if(!canLaunch())return false;
      const value=new Uint32Array(1);crypto.getRandomValues(value);
      mapping=[...members.keys()].sort((a,b)=>a-b);round++;
      state=R.create({seed:value[0],humanRacers:mapping.map(s=>members.get(s).racerId)});
      for(let i=0;i<mapping.length;i++)state.racers[i].playerSeat=mapping[i];
      for(const m of members.values()){m.ready=m.paused=m.stalled=false;m.input=neutral();m.boostPending=false;m.lastInput=m.lastSeen=now();}
      started=true;paused=ended=localReady=localPause=false;currentInput=neutral();localBoostPending=false;transport.lock(true);
      notice=`${mapping.length} homies. One road to the show.`;snapshot(true);emit();return true;
    }
    function pause(value){
      if(!active||!liveRace()||typeof value!=='boolean'||!value&&(!connected()||!synced||congested))return false;
      if(value===localPause)return true;
      localPause=value;currentInput=neutral();localBoostPending=false;
      if(role==='host'){
        if(value){hostPause('A rider paused. Everyone must resume together.');return true;}
        members.get(0).paused=false;paused=[...members.values()].some(m=>m.paused||!m.connected);snapshot(true);
      }
      else{if(value)paused=true;sendInput(true);}
      notice=value?'The race is paused. Resume when everyone is ready.':'Waiting for every paused rider to resume.';emit();return true;
    }
    function input(value){const valid=cleanInput(value);if(!valid)return false;if(role==='host'&&valid.boost&&!currentInput.boost&&liveRace()&&!paused)localBoostPending=true;currentInput=valid;if(role==='join')sendInput();return true;}
    function advance(dt,inputs){
      if(!active||role!=='host'||!liveRace()||paused)return false;
      const phase=state.phase,tick=state.tick;
      if(phase==='racing'&&number(dt,0,.25)&&state.remainder+dt+1e-10>=R.constants.FIXED_DT){
        // A physical release followed by a new press can arrive between two
        // physics frames. Its authenticated edge rearms the latch once, only
        // after the previous burst has ended; active bursts cannot be queued.
        mapping.forEach((s,i)=>{if(inputs[i]?.boost&&(s===0?localBoostPending:members.get(s).boostPending)&&state.racers[i].boostTime===0)state.racers[i].boostHeld=false;});
      }
      R.update(state,dt,inputs);
      if(state.tick!==tick&&state.time>0){localBoostPending=false;for(const m of members.values())m.boostPending=false;}
      if(phase!=='finished'&&state.phase==='finished'){
        localReady=localPause=paused=false;for(const m of members.values()){m.ready=m.paused=false;}
        transport.lock(false);notice='Race complete. Get ready for a rematch.';snapshot(true);
      }else snapshot();
      emit();return true;
    }
    function update(dt,value){
      if(!active)return;
      const current=cleanInput(value===undefined?controls():value);if(current)currentInput=current;
      const buffered=transport.state?.bufferedAmount||0;
      if(!congested&&buffered>65536){
        congested=true;if(role==='host')hostPause('Connection is catching up. Everyone must resume when it recovers.');
        else guestBarrier('Connection is catching up. Waiting for a fresh race state.');emit();
      }else if(congested&&buffered<16384){congested=false;if(role==='host'){snapshot(true);emit();}else syncRequest();}
      if(role==='join'){
        if(liveRace()&&now()-lastSeen>2200&&!waiting)guestBarrier('The host stopped responding. The race is paused.');
        if(now()-lastSend>=100){if(synced)sendInput();else syncRequest();}return;
      }
      if(liveRace()){
        const stale=[...members.values()].filter(m=>m.seat!==0&&now()-m.lastSeen>2200&&!m.stalled);
        if(stale.length){for(const m of stale)m.stalled=true;hostPause('A rider stopped responding. Everyone must resume after the connection recovers.');}
      }
      if(liveRace()&&!paused&&!congested){const inputs=mapping.map(s=>{
        if(s===0)return{...currentInput,boost:currentInput.boost||localBoostPending};
        const m=members.get(s);return now()-m.lastInput<=350?{...m.input,boost:m.input.boost||m.boostPending}:stop();
      });advance(dt,inputs);}
      else snapshot();
    }
    function end(reason='The online room closed.'){
      if(!active)return false;active=false;synced=false;ended=true;paused=false;localReady=false;localPause=false;currentInput=neutral();notice=String(reason).slice(0,160);emit();transport.close?.(notice);return true;
    }
    function advanceAll(dt,inputs){
      if(!number(dt,0,.25)||!Array.isArray(inputs)||inputs.length!==mapping.length||inputs.some(v=>!cleanInput(v))||role!=='host'||!active||paused)return false;
      return advance(dt,inputs.map(cleanInput));
    }
    transport.configure({onOpen:open,onRoster:roster,onMessage:receive,onConnection:connection,onEnd:reason=>end(reason)});
    const initial=transport.state;if(initial?.active&&['host','join'].includes(initial.role))open(initial.role,initial.seat);
    return{ready,launch,choose,pause,input,update,end,get active(){return active;},get netState(){return netState();},debug:{advanceAll}};
  }
  return Object.freeze({create});
})();
