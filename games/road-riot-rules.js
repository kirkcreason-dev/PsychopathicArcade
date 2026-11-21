/* JCW Road Riot: deterministic racing and side-by-side arcade combat.
 * Shared scenery/roster geometry, independent simulation and no browser APIs. */
const ROAD_RIOT_RULES=(()=>{
  'use strict';
  const BASE=RACING_RULES,roster=BASE.roster,byId=Object.fromEntries(roster.map(r=>[r.id,r]));
  const FIXED_DT=1/120,LENGTH=15000,MAX_TIME=180,ROAD_EDGE=.86,MAX_SPEED=312.5;
  const PLAYER_WINDUP=.24,RIVAL_WINDUP=.40,SWING_TIME=.18,ATTACK_RANGE_Z=38,ATTACK_RANGE_X=.68,ATTACK_MIN_X=.08;
  const CRASH_TIME=2.2,RECOVERY_HEALTH=75,RECOVERY_PROTECTION=1.8,BOOST_DURATION=3,BOOST_COST=30,BOOST_MULTIPLIER=1.25;
  const CONTACT_WIDTH=.30,CONTACT_LENGTH=26,CONTACT_SIDE_RATE=2.4;
  const DUEL_BONUS=250, DUEL_MAX_LEAD=280, DUEL_MAX_TRAIL=75, DUEL_MIN_DISTANCE=1600;
  const curveAt=BASE.curveAt,zoneAt=BASE.zoneAt;
  const kinds=Object.freeze({ticket:{width:.17,pickup:true,amount:1},boost:{width:.19,pickup:true,amount:30},repair:{width:.21,pickup:true,amount:35},cone:{width:.14,damage:8,factor:.80},tire:{width:.20,damage:12,factor:.72},barrier:{width:.25,damage:15,factor:.65}});
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),finite=(v,fallback=0)=>Number.isFinite(v)?v:fallback;
  const tune=r=>byId[r.racerId]||roster[0];
  function random(seed){let n=seed>>>0||0x6d2b79f5;return()=>{n^=n<<13;n^=n>>>17;n^=n<<5;return(n>>>0)/4294967296;};}
  function route(seed){
    const rng=random(seed^0xe9d42381),objects=[],lanes=[-.56,0,.56];
    const put=(kind,x,z)=>objects.push({id:objects.length,kind,x,z,collectedBy:[]});
    put('boost',0,500);put('ticket',-.55,720);put('ticket',.55,720);put('repair',0,1100);
    for(let row=0,z=1450;z<LENGTH-500;row++,z+=330+Math.floor(rng()*90)){
      const lane=Math.floor(rng()*3),rewardLane=(lane+1+Math.floor(rng()*2))%3;
      if(row%3!==2)put(['cone','tire','barrier'][Math.floor(rng()*3)],lanes[lane],z);
      put(row%3===1?'repair':row%3===0?'boost':'ticket',lanes[rewardLane],z+65);
      if(row%4===0)put('ticket',lanes[rewardLane],z+130);
    }
    return objects.sort((a,b)=>a.z-b.z||a.id-b.id);
  }
  function create(options={}){
    const seed=finite(options.seed,1)>>>0,difficulty=['easy','hard'].includes(options.difficulty)?options.difficulty:'normal';
    const player=byId[options.playerRacer]?options.playerRacer:roster[0].id,remaining=roster.filter(r=>r.id!==player).map(r=>r.id),rng=random(seed);
    for(let i=remaining.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[remaining[i],remaining[j]]=[remaining[j],remaining[i]];}
    const state={version:1,combat:true,seed,difficulty,phase:'countdown',countdown:3,time:0,tick:0,remainder:0,length:LENGTH,timedOut:false,
      racers:[player,...remaining].map((racerId,id)=>({id,racerId,human:id===0,x:[-.32,.28,-.56,.52,-.20,.30][id],z:[0,22,55,90,125,160][id],speed:0,health:100,boost:60,
        steer:0,boosting:false,boostTime:0,boostHeld:false,drafting:false,drifting:false,driftCharge:0,driftDirection:0,driftTurbo:0,drifts:0,
        tickets:0,hits:0,invulnerable:0,finishTime:null,dnf:false,
        attackSide:0,attackTime:0,attackCooldown:0,attackResolved:false,attackLeftHeld:false,attackRightHeld:false,
        blocking:false,crashTime:0,hurtTime:0,combatHits:0,knockouts:0,combo:0,bestCombo:0,comboTime:0,crashes:0})),
      objects:route(seed),events:[],finishOrder:[],duels:[1,2,3].map(leg=>({
        leg,checkpoint:leg*LENGTH/3,rivalId:null,status:'upcoming',startTime:null,startGap:null,playerCross:null,rivalCross:null,bonus:0
      }))};
    offerDuel(state,state.duels[0]);
    return state;
  }
  function emit(s,event){s.events.push({id:`${s.tick}:${event.type}:${event.racer}:${event.target??event.object??event.leg??''}`,time:s.time,...event});if(s.events.length>24)s.events.splice(0,s.events.length-24);}
  function duelEvent(s,duel,type){
    const {leg,checkpoint,rivalId,status,bonus}=duel;
    emit(s,{type,racer:0,leg,checkpoint,rivalId,status,bonus});
  }
  function offerDuel(s,duel){
    const player=s.racers[0];
    if(duel.checkpoint-player.z<DUEL_MIN_DISTANCE){
      duel.status='unavailable';
      return;
    }
    duel.status='seeking';
    if(player.crashTime>0)return;
    let rival=null, bestDistance=Infinity;
    for(const candidate of s.racers){
      if(candidate.human||candidate.finishTime!==null||candidate.crashTime>0||candidate.z>=duel.checkpoint)continue;
      const gap=candidate.z-player.z;
      if(gap < -DUEL_MAX_TRAIL || gap > DUEL_MAX_LEAD)continue;
      // Prefer a new opponent when the gaps are comparable. A rider a short
      // distance behind can race for the lead just as one ahead can defend it.
      const repeat=s.duels.some(past=>past.leg<duel.leg&&past.rivalId===candidate.id);
      const distance=Math.abs(gap)+(repeat?30:0);
      if(distance<bestDistance){
        rival=candidate;
        bestDistance=distance;
      }
    }
    if(!rival)return;
    duel.rivalId=rival.id;
    duel.startTime=s.time;
    duel.startGap=rival.z-player.z;
    duel.status='active';
    duelEvent(s,duel,'duelStart');
  }
  function checkpointTime(s,racer,oldZ,checkpoint){
    if(oldZ>=checkpoint||racer.z<checkpoint)return null;
    // At the finish the position is capped. Use the same unclipped crossing
    // time as the race standings, before any trailing finishers are projected.
    if(checkpoint===LENGTH)return racer.finishTime;
    return s.time-FIXED_DT+FIXED_DT*(checkpoint-oldZ)/(racer.z-oldZ);
  }
  function updateDuels(s,previous){
    const player=s.racers[0];
    for(let i=0;i<s.duels.length;i++){
      const duel=s.duels[i];
      if(i>0&&s.duels[i-1].playerCross===null)break;
      if(duel.status==='upcoming'||duel.status==='seeking')offerDuel(s,duel);
      if(duel.playerCross===null)duel.playerCross=checkpointTime(s,player,previous[0].z,duel.checkpoint);
      if(duel.rivalId===null)continue;
      const rival=s.racers[duel.rivalId];
      if(duel.rivalCross===null)duel.rivalCross=checkpointTime(s,rival,previous[rival.id].z,duel.checkpoint);
      if(duel.status!=='active'||(duel.playerCross===null&&duel.rivalCross===null))continue;
      if(duel.playerCross===null)duel.status='lost';
      else if(duel.rivalCross===null)duel.status='won';
      else {
        const delta=duel.playerCross-duel.rivalCross;
        duel.status=Math.abs(delta)<1e-9?'tied':delta<0?'won':'lost';
      }
      duel.bonus=duel.status==='won'?DUEL_BONUS:0;
      duelEvent(s,duel,'duelResult');
    }
  }
  function standings(s){return s.racers.slice().sort((a,b)=>a.finishTime!==null||b.finishTime!==null?a.finishTime===null?1:b.finishTime===null?-1:a.finishTime-b.finishTime||a.id-b.id:b.z-a.z||a.id-b.id);}
  function attackTargets(s,index,side){
    const a=s.racers[index];if(!a||![-1,1].includes(side)||a.crashTime>0||a.finishTime!==null)return[];
    return s.racers.filter(b=>b.id!==index&&b.finishTime===null&&b.crashTime<=0&&b.invulnerable<=0&&Math.abs(b.z-a.z)<=ATTACK_RANGE_Z&&
      (b.x-a.x)*side>=ATTACK_MIN_X&&(b.x-a.x)*side<=ATTACK_RANGE_X).sort((b,c)=>Math.abs(b.z-a.z)-Math.abs(c.z-a.z)||Math.abs(b.x-a.x)-Math.abs(c.x-a.x)||b.id-c.id);
  }
  function aiInput(s,index=0){
    const r=s.racers[index];if(!r||r.finishTime!==null||r.crashTime>0)return{steer:0,brake:false,boost:false,attackLeft:false,attackRight:false,block:false};
    const nearby=s.racers.filter(o=>o.id!==index&&o.finishTime===null&&o.crashTime<=0&&Math.abs(o.z-r.z)<120).sort((a,b)=>Math.abs(a.z-r.z)-Math.abs(b.z-r.z)||a.id-b.id);
    const opponent=nearby[0],bend=curveAt(r.z),hazards=s.objects.filter(o=>!kinds[o.kind].pickup&&!o.collectedBy.includes(index)&&o.z>r.z&&o.z-r.z<230);
    let target=clamp((index%3-1)*.48,-.65,.65);
    if(opponent){const side=r.x>=opponent.x?1:-1;target=clamp(opponent.x+side*.44,-.68,.68);}
    if(hazards.some(o=>Math.abs(o.x-target)<kinds[o.kind].width+.12)){
      target=[-.62,0,.62].map(x=>({x,cost:Math.abs(x-r.x)+hazards.reduce((n,o)=>n+(Math.abs(o.x-x)<kinds[o.kind].width+.12?4:0),0)})).sort((a,b)=>a.cost-b.cost)[0].x;
    }
    // Wounded riders seek visible repairs instead of repeatedly losing the same
    // fight. Pickups and attacks still require physically reaching their lane.
    const repair=r.health<55?s.objects.find(o=>o.kind==='repair'&&!o.collectedBy.includes(index)&&o.z>r.z&&o.z-r.z<280):null;
    if(repair&&!hazards.some(o=>Math.abs(o.x-repair.x)<kinds[o.kind].width+.12))target=repair.x;
    const threat=nearby.find(o=>o.attackTime>SWING_TIME&&o.attackTime<SWING_TIME+(o.human?PLAYER_WINDUP:RIVAL_WINDUP)-.12&&o.attackSide===Math.sign(r.x-o.x)&&Math.abs(o.z-r.z)<45);
    const defense=(s.seed+index*17+Math.floor(s.time*2))%5<(s.difficulty==='hard'?3:s.difficulty==='easy'?1:2);
    const block=!!threat&&defense&&r.attackTime<=0;
    const left=attackTargets(s,index,-1)[0],right=attackTargets(s,index,1)[0];
    const canAttack=s.time>2&&r.speed>45&&r.attackCooldown<=0&&r.attackTime<=0&&!block&&r.invulnerable<=0;
    const side=left&&right?(Math.abs(left.z-r.z)<=Math.abs(right.z-r.z)?-1:1):left?-1:right?1:0;
    return{steer:clamp((target-r.x)*3.2+bend*.16,-1,1),brake:Math.abs(r.x)>.78&&Math.abs(bend)>.7&&r.speed>170,
      boost:(s.time+index*.61)%8<.22&&r.boost>=BOOST_COST&&r.boostTime<=0&&Math.abs(target-r.x)<.24&&!block,
      attackLeft:canAttack&&side===-1&&!r.attackLeftHeld,attackRight:canAttack&&side===1&&!r.attackRightHeld,block};
  }
  function clearAttack(r){r.attackTime=0;r.attackSide=0;r.attackResolved=false;}
  function clearBoost(r){if(r.boostTime>0)r.speed/=BOOST_MULTIPLIER;r.boostTime=0;r.boosting=false;}
  function crash(s,r,attacker=null){
    if(r.crashTime>0||r.finishTime!==null)return;
    clearBoost(r);clearAttack(r);r.blocking=false;r.crashTime=CRASH_TIME;r.health=0;r.speed*=.35;r.invulnerable=0;r.combo=0;r.comboTime=0;r.crashes++;
    if(attacker){attacker.knockouts++;emit(s,{type:'knockout',racer:attacker.id,target:r.id});}
    emit(s,{type:'crash',racer:r.id,by:attacker?.id??null});
  }
  function hit(s,attacker,target,side){
    if(target.crashTime>0||target.finishTime!==null||target.invulnerable>0)return false;
    const blocked=target.blocking,base=attacker.human?22+(Math.min(attacker.combo,3)*2):s.difficulty==='easy'?13:s.difficulty==='hard'?20:17;
    const damage=blocked?Math.max(2,Math.round(base*.18)):base;
    target.health=clamp(target.health-damage/tune(target).armor,0,100);target.hits++;target.hurtTime=.32;target.invulnerable=blocked?.20:.45;
    target.x=clamp(target.x+side*(blocked?.025:.12),-1,1);target.speed*=blocked?.96:.83;
    if(!blocked){attacker.combatHits++;attacker.combo=attacker.comboTime>0?attacker.combo+1:1;attacker.comboTime=4;attacker.bestCombo=Math.max(attacker.bestCombo,attacker.combo);}
    emit(s,{type:'strike',racer:attacker.id,target:target.id,side,damage,blocked,combo:attacker.combo});
    if(target.health<=0)crash(s,target,attacker);
    return true;
  }
  function finish(s,r,time,projected=false){
    if(r.finishTime!==null)return;
    r.z=LENGTH;r.speed=0;r.steer=0;r.finishTime=time;r.boosting=false;r.boostTime=0;r.boostHeld=false;r.blocking=false;r.crashTime=0;r.drafting=false;
    r.attackLeftHeld=r.attackRightHeld=false;clearAttack(r);s.finishOrder.push(r.id);emit(s,{type:'finish',racer:r.id,finishTime:time,projected});
  }
  function endRace(s,cutoff){
    s.timedOut=cutoff;
    for(const duel of s.duels){
      if(duel.status==='active'||duel.status==='seeking'||duel.status==='upcoming'){
        duel.status='expired';
        if(duel.rivalId!==null)duelEvent(s,duel,'duelResult');
      }
    }
    for(const r of standings(s).filter(r=>r.finishTime===null)){r.dnf=cutoff;finish(s,r,s.time+Math.max(.01,(LENGTH-r.z)/165),true);}
    s.finishOrder=standings(s).map(r=>r.id);s.phase='finished';s.remainder=0;
  }
  function collect(s,r,oldX,oldZ){
    const travel=r.z-oldZ;if(travel<=0||r.crashTime>0)return;
    for(const o of s.objects){
      if(o.z<oldZ-8||o.collectedBy.includes(r.id))continue;if(o.z>r.z+8)break;
      const k=kinds[o.kind];if(!k)continue;
      const x=oldX+(r.x-oldX)*clamp((o.z-oldZ)/travel,0,1);if(Math.abs(x-o.x)>k.width+.085)continue;
      if(k.pickup){
        o.collectedBy.push(r.id);let amount=k.amount;
        if(o.kind==='ticket')r.tickets++;
        else if(o.kind==='repair'){const before=r.health;r.health=clamp(before+k.amount,0,100);amount=r.health-before;}
        else{const before=r.boost;r.boost=clamp(before+k.amount,0,100);amount=r.boost-before;}
        emit(s,{type:'pickup',racer:r.id,object:o.id,kind:o.kind,amount});
      }else if(r.invulnerable<=0){
        o.collectedBy.push(r.id);r.hits++;r.health=clamp(r.health-k.damage/tune(r).armor,0,100);r.speed*=k.factor;r.invulnerable=.75;r.hurtTime=.3;
        emit(s,{type:'hit',racer:r.id,object:o.id,kind:o.kind});if(r.health<=0)crash(s,r);
      }
    }
  }
  function contacts(s,motion){
    // Accumulate every pair from one coherent snapshot. Player and CPU have
    // equal mass: neither receives a special passing or shoving advantage.
    const world=s.racers.map(r=>({x:r.x,z:r.z,speed:r.speed})),side=world.map(()=>0),long=world.map(()=>0),impulse=world.map(()=>0),counts=world.map(()=>0),pairs=[];
    for(let i=0;i<world.length;i++)for(let j=i+1;j<world.length;j++){
      if(!motion[i]||!motion[j])continue;
      const a=world[i],b=world[j],ma=motion[i],mb=motion[j];
      const oldX=mb.oldX-ma.oldX,dx=b.x-a.x,oldZ=mb.oldZ-ma.oldZ,dz=b.z-a.z;
      const nearX=oldX*dx<=0?0:Math.min(Math.abs(oldX),Math.abs(dx)),nearZ=oldZ*dz<=0?0:Math.min(Math.abs(oldZ),Math.abs(dz));
      if(nearX>=CONTACT_WIDTH||nearZ>=CONTACT_LENGTH)continue;
      const direction=Math.abs(oldX)>.00001?Math.sign(oldX):Math.abs(dx)>.00001?Math.sign(dx):i<j?1:-1;
      const wanted=CONTACT_WIDTH*(.65+.35*(1-nearZ/CONTACT_LENGTH));
      const push=Math.min(CONTACT_SIDE_RATE*FIXED_DT,Math.max(0,wanted-dx*direction)/2);
      side[i]-=direction*push;side[j]+=direction*push;
      if(Math.abs(oldZ)<.001)continue;
      const back=oldZ>0?i:j,front=oldZ>0?j:i,closing=world[back].speed-world[front].speed;
      if(closing<=0)continue;
      const gap=Math.abs(oldZ),hitAt=clamp((gap-CONTACT_LENGTH)/Math.max(.0001,closing*FIXED_DT),0,1),exchange=closing/2;
      // Move to contact, then share forward momentum for the rest of this
      // step. Distance never rewinds and no rider is teleported into a gap.
      const travel=exchange*FIXED_DT*(1-hitAt);
      pairs.push({back,front,travel,exchange});counts[back]++;counts[front]++;
    }
    for(const p of pairs){
      // A rider touching two others shares each impulse at the same weight on
      // both ends. The pack cannot create speed through asymmetric averaging.
      const weight=Math.max(counts[p.back],counts[p.front]);
      long[p.back]-=p.travel/weight;long[p.front]+=p.travel/weight;impulse[p.back]-=p.exchange/weight;impulse[p.front]+=p.exchange/weight;
    }
    for(let i=0;i<world.length;i++){
      if(!motion[i])continue;const r=s.racers[i],limit=CONTACT_SIDE_RATE*FIXED_DT;
      r.x=clamp(world[i].x+clamp(side[i],-limit,limit),-1,1);
      if(counts[i]){r.z=clamp(world[i].z+long[i],motion[i].oldZ,LENGTH);r.speed=clamp(world[i].speed+impulse[i],0,MAX_SPEED);}
    }
  }
  function step(s,input){
    s.tick++;
    if(s.phase==='countdown'){s.countdown=Math.max(0,3-s.tick*FIXED_DT);if(s.countdown<=0)s.phase='racing';return;}
    s.time=(s.tick-360)*FIXED_DT;
    const actions=s.racers.map(r=>r.human?input||{}:aiInput(s,r.id)),strikes=[],motion=[];
    const previous=s.racers.map(r=>({x:r.x,z:r.z,speed:r.speed,live:r.finishTime===null&&r.crashTime<=0}));
    for(const r of s.racers){
      if(r.finishTime!==null)continue;
      const a=actions[r.id],steer=clamp(finite(a.steer),-1,1),brake=a.brake===true,oldX=r.x,oldZ=r.z,t=tune(r);
      const left=a.attackLeft===true,right=a.attackRight===true,boost=a.boost===true;
      const newLeft=left&&!r.attackLeftHeld,newRight=right&&!r.attackRightHeld,newBoost=boost&&!r.boostHeld;
      r.attackLeftHeld=left;r.attackRightHeld=right;r.boostHeld=boost;
      r.attackCooldown=Math.max(0,r.attackCooldown-FIXED_DT);r.invulnerable=Math.max(0,r.invulnerable-FIXED_DT);r.hurtTime=Math.max(0,r.hurtTime-FIXED_DT);
      r.comboTime=Math.max(0,r.comboTime-FIXED_DT);if(!r.comboTime)r.combo=0;
      if(r.crashTime>0){
        r.crashTime=r.crashTime<=FIXED_DT+1e-9?0:r.crashTime-FIXED_DT;r.steer=0;r.blocking=false;r.speed=Math.max(0,r.speed-140*FIXED_DT);r.z=Math.min(LENGTH-1,r.z+r.speed*FIXED_DT);
        if(!r.crashTime){r.health=RECOVERY_HEALTH;r.invulnerable=RECOVERY_PROTECTION;r.attackCooldown=.5;r.boost=Math.max(30,r.boost);emit(s,{type:'recover',racer:r.id});}
        continue;
      }
      if(r.boostTime>0)r.speed/=BOOST_MULTIPLIER;
      r.steer+=(steer-r.steer)*Math.min(1,FIXED_DT*12);
      const offroad=Math.abs(r.x)>ROAD_EDGE,bend=curveAt(r.z);
      r.drafting=previous.some((o,i)=>i!==r.id&&o.live&&o.z-r.z>18&&o.z-r.z<140&&Math.abs(o.x-r.x)<.18)&&r.speed>80;
      r.blocking=a.block===true&&r.attackTime<=0;
      if(newBoost&&r.boostTime<=0&&!brake&&!offroad&&!r.blocking&&r.boost>=BOOST_COST){r.boost-=BOOST_COST;r.boostTime=BOOST_DURATION;}
      r.boosting=r.boostTime>0;if(!r.boosting)r.boost=clamp(r.boost+FIXED_DT*(8+(r.drafting?5:0)),0,100);
      if(r.attackTime<=0&&r.attackCooldown<=0&&!r.blocking&&r.speed>35&&newLeft!==newRight){
        r.attackSide=newLeft?-1:1;r.attackTime=(r.human?PLAYER_WINDUP:RIVAL_WINDUP)+SWING_TIME;r.attackResolved=false;
        r.attackCooldown=r.human?.85:s.difficulty==='hard'?1.15:s.difficulty==='easy'?1.8:1.45;
        emit(s,{type:'attack',racer:r.id,side:r.attackSide});
      }
      if(r.attackTime>0){
        r.attackTime=Math.max(0,r.attackTime-FIXED_DT);
        if(!r.attackResolved&&r.attackTime<=SWING_TIME+1e-9){r.attackResolved=true;strikes.push({racer:r.id,side:r.attackSide});}
        if(!r.attackTime)clearAttack(r);
      }
      const health=.92+.08*r.health/100,pace=r.human?1:(s.difficulty==='easy'?.92:s.difficulty==='hard'?1:.96)+(r.id%3-1)*.008;
      let target=(t.topSpeed+(r.drafting?5:0))*health*pace*(1-Math.abs(bend)*.055);
      if(offroad)target*=t.offroad;if(r.blocking)target*=.78;if(brake)target=0;
      if(!r.human){const lead=previous.filter((o,i)=>i!==r.id&&o.live&&o.z-r.z>0&&o.z-r.z<45&&Math.abs(o.x-r.x)<.16).sort((a,b)=>a.z-b.z)[0];if(lead)target=Math.min(target,Math.max(0,lead.speed+(lead.z-r.z-28)*2)/(r.boosting?BOOST_MULTIPLIER:1));}
      const rate=target<r.speed?(brake?200:offroad?130:100):t.acceleration;
      r.speed=clamp(r.speed+clamp(target-r.speed,-rate*FIXED_DT,rate*FIXED_DT),0,250);if(r.boosting)r.speed*=BOOST_MULTIPLIER;
      const ratio=r.speed/190,moving=Math.min(1,r.speed/80),handling=(.5+.8*Math.min(ratio,1.3))*moving*t.handling*(brake?1.15:1);
      r.x=clamp(r.x+(r.steer*handling-bend*.21*ratio*ratio)*FIXED_DT,-1,1);
      const travelSpeed=r.speed;r.z=Math.min(LENGTH,r.z+travelSpeed*FIXED_DT);motion[r.id]={oldX,oldZ,travelSpeed};
    }
    contacts(s,motion);
    for(const r of s.racers){
      const moved=motion[r.id];if(!moved)continue;const{oldX,oldZ,travelSpeed}=moved;collect(s,r,oldX,oldZ);
      if(r.boostTime>0){r.boostTime=r.boostTime<=FIXED_DT+1e-9?0:r.boostTime-FIXED_DT;if(!r.boostTime){r.speed/=BOOST_MULTIPLIER;r.boosting=false;}}
      if(zoneAt(oldZ)!==zoneAt(r.z))emit(s,{type:'zone',racer:r.id,zone:zoneAt(r.z)});
      if(r.z>=LENGTH)finish(s,r,s.time-FIXED_DT+clamp((LENGTH-oldZ)/Math.max(.001,travelSpeed*FIXED_DT),0,1)*FIXED_DT);
    }
    // Resolve all targets after movement. Simultaneous swings can trade hits;
    // array order cannot silently grant a faster windup to the first rider.
    const impacts=strikes.map(a=>({attacker:s.racers[a.racer],side:a.side,target:attackTargets(s,a.racer,a.side)[0]})).filter(a=>a.attacker.finishTime===null&&a.attacker.crashTime<=0);
    for(const impact of impacts)if(!impact.target||!hit(s,impact.attacker,impact.target,impact.side))emit(s,{type:'miss',racer:impact.attacker.id,side:impact.side});
    updateDuels(s,previous);
    if(s.racers[0].finishTime!==null)endRace(s,false);else if(s.time>=MAX_TIME)endRace(s,true);
  }
  function advance(s,dt,input={}){
    if(!s||s.phase==='finished'||!Number.isFinite(dt)||dt<=0)return s;
    s.remainder=finite(s.remainder)+Math.min(dt,.25);
    while(s.remainder+1e-10>=FIXED_DT&&s.phase!=='finished'){s.remainder=Math.max(0,s.remainder-FIXED_DT);step(s,input);}
    return s;
  }
  function scoreBreakdown(s){
    const r=s.racers[0],place=standings(s).findIndex(o=>o.id===0)+1;
    const result={place,finish:[5000,4200,3500,2900,2400,2000][place-1],hits:r.combatHits*75,knockouts:r.knockouts*600,tickets:r.tickets*50,timeBonus:Math.round(Math.max(0,MAX_TIME-(r.finishTime??s.time))*15),penalty:r.dnf?-1200:0};
    result.duels=(s.duels||[]).reduce((points,duel)=>points+duel.bonus,0);
    const sum=result.finish+result.hits+result.knockouts+result.tickets+result.timeBonus+result.penalty+result.duels;
    result.total=Math.max(1,sum);result.finish+=result.total-sum;return result;
  }
  function score(s){return scoreBreakdown(s).total;}
  return Object.freeze({create,advance,standings,score,scoreBreakdown,aiInput,attackTargets,roster,kinds,curveAt,zoneAt,constants:Object.freeze({FIXED_DT,LENGTH,MAX_TIME,ROAD_EDGE,MAX_SPEED,PLAYER_WINDUP,RIVAL_WINDUP,SWING_TIME,ATTACK_RANGE_Z,ATTACK_RANGE_X,ATTACK_MIN_X,CRASH_TIME,RECOVERY_HEALTH,RECOVERY_PROTECTION,BOOST_DURATION,BOOST_COST,BOOST_MULTIPLIER,CONTACT_WIDTH,CONTACT_LENGTH,CONTACT_SIDE_RATE})});
})();
