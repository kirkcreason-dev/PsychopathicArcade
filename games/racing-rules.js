// Deterministic arcade racing simulation. No rendering, timers, network or DOM.
const RACING_RULES = (() => {
  'use strict';
  const LENGTH = 15000, FIXED_DT = 1 / 120, ROAD_EDGE = .86, MAX_TIME = 180, MAX_RACERS = 8;
  const DRIFT_MIN_SPEED = 120, DRIFT_TIER_ONE = .65, DRIFT_TIER_TWO = 1.4;
  const BOOST_DURATION=3,BOOST_MULTIPLIER=1.25,BOOST_COST=30;
  const roster = [
    {id:'violent-j',name:'Violent J',vehicle:'minibike',color:'#76cd24',topSpeed:189,acceleration:76,handling:1.06,offroad:.66,armor:1.02},
    {id:'shaggy-2-dope',name:'Shaggy 2 Dope',vehicle:'kart',color:'#db303d',topSpeed:190,acceleration:79,handling:.99,offroad:.68,armor:1.04},
    {id:'dani-mo',name:'Dani Mo',vehicle:'kart',color:'#edb843',topSpeed:189,acceleration:81,handling:1.03,offroad:.66,armor:1},
    {id:'2-tuff-tony',name:'2 Tuff Tony',vehicle:'minibike',color:'#f78d30',topSpeed:190,acceleration:75,handling:1.05,offroad:.65,armor:1.02},
    {id:'mad-man-pondo',name:'Mad Man Pondo',vehicle:'kart',color:'#aa5bd4',topSpeed:188,acceleration:79,handling:1,offroad:.69,armor:1.08},
    {id:'big-foot',name:'Big Foot',vehicle:'minibike',color:'#39a9e5',topSpeed:188,acceleration:77,handling:1.02,offroad:.70,armor:1.08}
  ];
  roster.forEach(Object.freeze); Object.freeze(roster);
  const byId = Object.fromEntries(roster.map(r => [r.id, r]));
  const kinds = Object.freeze({
    ticket:{width:.16,pickup:true,amount:1}, boost:{width:.16,pickup:true,amount:28}, repair:{width:.17,pickup:true,amount:30},
    cone:{width:.14,damage:9,speedFactor:.76}, tire:{width:.21,damage:14,speedFactor:.64}, barrier:{width:.26,damage:18,speedFactor:.56}
  });
  const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
  const finite = (n,fallback=0) => Number.isFinite(n) ? n : fallback;
  const stats = racer => byId[racer.racerId] || roster[0];
  function random(seed) {
    let value = seed >>> 0 || 0x6d2b79f5;
    return () => { value ^= value << 13; value ^= value >>> 17; value ^= value << 5; return (value >>> 0) / 4294967296; };
  }
  function curveAt(z) {
    z = clamp(finite(z),0,LENGTH);
    const fade = clamp((z-650)/400,0,1) * clamp((LENGTH-500-z)/500,0,1);
    return fade ? fade * (.55*Math.sin(z/650) + .30*Math.sin(z/1270+.7)) : 0;
  }
  const zoneAt = z => clamp(Math.floor(Math.max(0,finite(z))/5000),0,2);
  function route(seed) {
    const rng = random(seed ^ 0xa5366b4d), objects = [];
    const put = (kind,x,z) => objects.push({id:objects.length,kind,x,z,collectedBy:[]});
    // The first three clear rewards teach their effects before obstacles appear.
    put('boost',0,460); put('ticket',-.52,660); put('ticket',.52,660);
    const lanes = [-.58,0,.58], hazards = ['cone','tire','barrier'];
    let row = 0;
    for(let z=950;z<LENGTH-650;z+=200+Math.floor(rng()*75),row++) {
      const lane = Math.floor(rng()*3), rewardLane = (lane+1+Math.floor(rng()*2))%3;
      if(row%4!==3) put(hazards[Math.floor(rng()*3)],lanes[lane],z);
      const reward = row%9===6 ? 'repair' : row%4===2 ? 'boost' : 'ticket';
      put(reward,lanes[rewardLane],z+35);
      if(row%5===0) put('ticket',lanes[rewardLane],z+90);
    }
    return objects.sort((a,b)=>a.z-b.z || a.id-b.id);
  }
  function create(options={}) {
    const seed = finite(options.seed,1) >>> 0, online = !!options.online;
    const playerId = byId[options.playerRacer] ? options.playerRacer : roster[0].id;
    const guestId = byId[options.guestRacer] ? options.guestRacer : roster[1].id;
    // Explicit room seats take precedence over the legacy solo/two-peer API.
    // Duplicate character choices are valid: seat IDs, not artwork IDs, own
    // controls, pickup consumption and results. Bound malformed oversized input.
    const seats=Array.isArray(options.humanRacers)&&options.humanRacers.length>=2?
      options.humanRacers.slice(0,MAX_RACERS).map((id,i)=>byId[id]?id:roster[i%roster.length].id):null;
    const picks = seats || (online ? [playerId,guestId] : [playerId]);
    const humanCount=picks.length;
    const remaining = roster.filter(r=>!picks.includes(r.id)).map(r=>r.id), rng=random(seed);
    for(let i=remaining.length-1;i>0;i--) { const j=Math.floor(rng()*(i+1)); [remaining[i],remaining[j]]=[remaining[j],remaining[i]]; }
    while(picks.length<6) picks.push(remaining.shift() || roster[picks.length%6].id);
    return {
      version:1,seed,phase:'countdown',countdown:3,time:0,length:LENGTH,tick:0,remainder:0,
      racers:picks.map((racerId,id)=>({id,racerId,human:id<humanCount,
        // Human seats share the same start line. The convoy is staggered ahead
        // so six full-size vehicles never occupy one visual starting row.
        x:id<humanCount&&humanCount>2?-.72+1.44*id/(humanCount-1):id%2?.5:-.5,
        z:id<humanCount?0:(id-humanCount+1)*90,speed:0,boost:60,health:100,tickets:0,hits:0,
        invulnerable:0,steer:0,boosting:false,boostTime:0,boostHeld:false,drafting:false,
        drifting:false,driftCharge:0,driftDirection:0,driftTurbo:0,drifts:0,finishTime:null,dnf:false})),
      objects:route(seed),events:[],finishOrder:[],timedOut:false
    };
  }
  function emit(s,event) {
    s.events.push({id:`${s.tick}:${event.type}:${event.racer}:${event.object ?? ''}`,time:s.time,...event});
    if(s.events.length>16) s.events.splice(0,s.events.length-16);
  }
  function standings(s) {
    return s.racers.slice().sort((a,b)=>{
      if(a.finishTime!==null || b.finishTime!==null) {
        if(a.finishTime===null) return 1;
        if(b.finishTime===null) return -1;
        return a.finishTime-b.finishTime || a.id-b.id;
      }
      return b.z-a.z || a.id-b.id;
    });
  }
  function cancelDrift(r,clearTurbo=false) {
    r.drifting=false;r.driftCharge=0;r.driftDirection=0;
    if(clearTurbo) r.driftTurbo=0;
  }
  function bankDrift(s,r,charge,brake) {
    // A held drift earns one award on release. Tiny taps and left/right
    // reversals never add up; a new charge must be earned from zero.
    const tier=charge+1e-9>=DRIFT_TIER_TWO?2:charge+1e-9>=DRIFT_TIER_ONE?1:0;
    if(!tier) return;
    const before=r.boost;
    r.boost=clamp(before+(tier===2?22:12),0,100);
    r.driftTurbo=tier===2?1.25:.75;r.drifts++;
    // Releasing steering while holding brake banks charge too, but must not
    // force acceleration against a player's deliberate braking input.
    if(!brake) r.speed=Math.min(250,r.speed+(tier===2?26:16));
    emit(s,{type:'drift',racer:r.id,tier,amount:r.boost-before});
  }
  function finish(s,r,time,projected=false) {
    if(r.finishTime!==null) return;
    r.z=s.length; r.speed=0; r.steer=0; r.boosting=false; r.boostTime=0; r.boostHeld=false; r.drafting=false;
    cancelDrift(r,true);
    r.finishTime=time;
    s.finishOrder.push(r.id);
    emit(s,{type:'finish',racer:r.id,finishTime:time,projected});
  }
  function endRace(s,cutoff) {
    // Race ends when the humans have arrived. CPUs still behind receive later,
    // distance-ordered times for a complete results table, not phantom wins.
    s.timedOut=cutoff;
    const pending=standings(s).filter(r=>r.finishTime===null);
    for(const r of pending) {
      const projected=s.time+Math.max(.01,(s.length-r.z)/160);
      r.dnf=cutoff;
      finish(s,r,projected,true);
    }
    s.finishOrder=standings(s).map(r=>r.id);
    s.phase='finished'; s.remainder=0;
  }
  function aiInput(s,index) {
    const r=s.racers[index];
    if(!r || r.finishTime!==null) return {steer:0,brake:false,boost:false};
    const look=320+r.speed*.3, lanes=[-.58,-.29,0,.29,.58], nearby=[];
    for(const o of s.objects) {
      if(o.z<r.z-5 || o.collectedBy.includes(r.id)) continue;
      if(o.z>r.z+look) break;
      nearby.push(o);
    }
    const traffic=s.racers.filter(other=>other.id!==r.id && other.finishTime===null && other.z-r.z>-45 && other.z-r.z<150);
    let target=r.x, best=-Infinity;
    for(const x of lanes) {
      // A small stable preference breaks ties without sending the whole convoy
      // toward the same pickup line. Traffic takes precedence over a reward.
      const preferred=(r.id%3-1)*.5;
      let value=-Math.abs(x-r.x)*3-Math.abs(x-preferred)*.35;
      for(const o of nearby) {
        const k=kinds[o.kind], urgency=1-clamp((o.z-r.z)/look,0,1);
        if(Math.abs(x-o.x)>k.width+.11) continue;
        if(!k.pickup) value-=32*(.35+urgency);
        else {
          const desire=o.kind==='repair' ? (100-r.health)/22 : o.kind==='boost' ? (100-r.boost)/28 : 1.8;
          value+=desire*(.5+urgency);
        }
      }
      for(const other of traffic) {
        const gap=other.z-r.z, lane=clamp(other.x+other.steer*.10,-.8,.8);
        const overlap=Math.max(0,1-Math.abs(x-lane)/.34);
        value-=overlap*overlap*(gap<0?42:36)*(1-Math.abs(gap)/180);
      }
      if(value>best) {best=value;target=x;}
    }
    const bend=curveAt(r.z+70);
    const steer=clamp((target-r.x)*3.8+bend*.145,-1,1);
    const brake=Math.abs(bend)>.76 && Math.abs(r.x)>.70 && r.speed>165;
    // Short periodic presses release the edge latch between bursts. Holding a
    // button through recharge intentionally cannot buy another automatic boost.
    const boost=(s.time+r.id*.65)%7<.25 && r.boost>=BOOST_COST && r.boostTime<=0 && r.driftTurbo<=0 && Math.abs(bend)<.65 && Math.abs(target-r.x)<.24 && !brake;
    return {steer,brake,boost};
  }
  function collideObjects(s,r,oldX,oldZ) {
    const travel=r.z-oldZ;
    if(travel<=0) return;
    for(const o of s.objects) {
      if(o.z<oldZ-9 || o.collectedBy.includes(r.id)) continue;
      if(o.z>r.z+9) break;
      const k=kinds[o.kind];
      if(!k) continue;
      // Swept longitudinal intersection also interpolates x at impact. A fast
      // nitro frame cannot jump through a cone or miss a crossed pickup.
      const fraction=clamp((o.z-oldZ)/travel,0,1), impactX=oldX+(r.x-oldX)*fraction;
      if(Math.abs(impactX-o.x)>k.width+.085) continue;
      if(k.pickup) {
        o.collectedBy.push(r.id);
        let amount=k.amount;
        if(o.kind==='ticket') r.tickets+=amount;
        else if(o.kind==='boost') {const before=r.boost;r.boost=clamp(before+amount,0,100);amount=r.boost-before;}
        else {const before=r.health;r.health=clamp(before+amount,0,100);amount=r.health-before;}
        emit(s,{type:'pickup',racer:r.id,object:o.id,kind:o.kind,amount});
      } else if(r.invulnerable<=0) {
        o.collectedBy.push(r.id); r.hits++;
        r.health=clamp(r.health-k.damage/stats(r).armor,0,100);
        r.speed*=k.speedFactor; r.invulnerable=1.1;
        cancelDrift(r,true);
        emit(s,{type:'hit',racer:r.id,object:o.id,kind:o.kind});
      }
    }
  }
  function step(s,inputs) {
    s.tick++;
    if(s.phase==='countdown') {
      s.countdown=Math.max(0,3-s.tick*FIXED_DT);
      if(s.countdown<=0) s.phase='racing';
      return;
    }
    s.time=(s.tick-360)*FIXED_DT;
    // Inputs are computed before moving any car; drafting and AI see a single
    // coherent world rather than gaining an advantage from racer array order.
    const controls=s.racers.map(r=>r.human ? inputs[r.id]||{} : aiInput(s,r.id));
    const drafts=s.racers.map(r=>s.racers.some(other=>other.id!==r.id && other.finishTime===null &&
      other.z-r.z>18 && other.z-r.z<160 && Math.abs(other.x-r.x)<.19));
    const leaders=s.racers.map(r=>r.human?null:s.racers.filter(other=>other.id!==r.id && other.finishTime===null &&
      other.z-r.z>0 && other.z-r.z<70 && Math.abs(other.x-r.x)<.27).sort((a,b)=>a.z-b.z)[0]);
    // Snapshot speeds/gaps before updating any racer to avoid slot-order bias.
    const following=leaders.map((leader,i)=>leader?{gap:leader.z-s.racers[i].z,speed:leader.speed}:null);
    for(const r of s.racers) {
      if(r.finishTime!==null) continue;
      const input=controls[r.id], tune=stats(r), oldX=r.x, oldZ=r.z;
      const steer=clamp(finite(input.steer),-1,1), brake=input.brake===true;
      // Integrate the ordinary velocity first. The public speed includes the
      // temporary multiplier, so divide it out exactly once before this step.
      // This also preserves an impact's slowdown instead of restoring old speed.
      if(r.boostTime>0)r.speed/=BOOST_MULTIPLIER;
      const boostPressed=input.boost===true&&!r.boostHeld;
      r.boostHeld=input.boost===true;
      r.steer += (steer-r.steer)*Math.min(1,FIXED_DT*12);
      r.invulnerable=Math.max(0,r.invulnerable-FIXED_DT);
      r.drafting=drafts[r.id] && r.speed>80;
      const offroad=Math.abs(r.x)>ROAD_EDGE, bend=curveAt(r.z);
      r.driftTurbo=Math.max(0,r.driftTurbo-FIXED_DT);
      if(boostPressed&&r.boostTime<=0&&r.driftTurbo<=0&&!brake&&!offroad&&r.invulnerable<.8&&r.boost>=BOOST_COST){
        r.boost-=BOOST_COST;r.boostTime=BOOST_DURATION;cancelDrift(r);
      }
      r.boosting=r.boostTime>0;
      const direction=Math.abs(steer)>=.35?Math.sign(steer):0;
      let bankCharge=0;
      const oldHits=r.hits;
      if(offroad || r.invulnerable>0 || input.boost===true || r.boosting || r.driftTurbo>0 || r.speed<(r.drifting?100:DRIFT_MIN_SPEED)) {
        cancelDrift(r,offroad||r.invulnerable>0);
      } else if(r.drifting) {
        if(direction && direction!==r.driftDirection) cancelDrift(r);
        else if(!brake || !direction) {bankCharge=r.driftCharge;cancelDrift(r);}
        else r.driftCharge=Math.min(2,r.driftCharge+FIXED_DT);
      } else if(brake && direction) {
        r.drifting=true;r.driftDirection=direction;r.driftCharge=FIXED_DT;
      }
      // One press pays once. The 3-second clock is independent of button hold,
      // brake, hits and pickups; neither a held key nor another press extends it.
      if(!r.boosting)r.boost=clamp(r.boost+FIXED_DT*(9+(r.drafting?7:0)),0,100);
      // Hits still cause an immediate, visible slowdown. Lasting wear is mild
      // enough that an early mistake does not decide the whole race.
      const engineHealth=.88+.12*r.health/100;
      const turbo=r.driftTurbo>0;
      let target=(tune.topSpeed+(turbo?42:0)+(r.drafting?5:0))*engineHealth;
      if(!r.human) target*=.94; // A clean first run can contend with the convoy.
      target*=1-Math.abs(bend)*.065;
      if(offroad) target*=tune.offroad;
      if(brake) target=r.drifting?Math.min(target,155):0;
      const lead=following[r.id];
      if(lead) target=Math.min(target,Math.max(0,lead.speed+(lead.gap-48)*1.8)/(r.boosting?BOOST_MULTIPLIER:1));
      const rate=target<r.speed ? (lead?190:r.drifting&&r.driftCharge>.15?55:brake?190:offroad?145:95) : tune.acceleration*(turbo?1.7:1);
      r.speed=clamp(r.speed+clamp(target-r.speed,-rate*FIXED_DT,rate*FIXED_DT),0,250);
      if(r.boosting)r.speed*=BOOST_MULTIPLIER;
      const ratio=r.speed/190, kart=tune.vehicle==='kart';
      const cornerLoad=Math.max(0,ratio-.82)*Math.abs(bend);
      const grip=brake?1.26:1-cornerLoad*(kart?.42:.58);
      // Bikes change line more quickly; karts hold a fast bend more steadily.
      // A brief brake tap restores turn grip and reduces outward drift, rather
      // than merely sacrificing speed with no useful steering benefit.
      // Keep the initial brake tap's turn response, then settle into a small,
      // controllable lateral slide so a1.4s hold fits on the road at touch input.
      const mobility=r.drifting&&r.driftCharge>.15?.34*(kart?.98:1.05):(.5+.85*Math.min(ratio,1.2))*tune.handling*grip*(kart?1:1.08);
      const drift=bend*.24*ratio**2*(kart?.82:1)*(brake?.55:1)*(r.drifting?.35:1);
      r.x=clamp(r.x+(r.steer*mobility-drift)*FIXED_DT,-1,1);
      const travelSpeed=r.speed;
      r.z=Math.min(s.length,r.z+travelSpeed*FIXED_DT);
      collideObjects(s,r,oldX,oldZ);
      if(Math.abs(r.x)>ROAD_EDGE || r.hits!==oldHits) {cancelDrift(r,true);bankCharge=0;}
      // Only award after the swept collision and road checks. Releasing on
      // the impact/finish step cannot sneak a free turbo through cancellation.
      if(bankCharge && r.z<s.length && r.invulnerable<=0) bankDrift(s,r,bankCharge,brake);
      if(r.boostTime>0){
        r.boostTime=r.boostTime<=FIXED_DT+1e-9?0:r.boostTime-FIXED_DT;
        if(r.boostTime===0){r.speed/=BOOST_MULTIPLIER;r.boosting=false;}
      }
      if(zoneAt(oldZ)!==zoneAt(r.z)) emit(s,{type:'zone',racer:r.id,zone:zoneAt(r.z)});
      if(r.z>=s.length) {
        const fraction=clamp((s.length-oldZ)/Math.max(.0001,travelSpeed*FIXED_DT),0,1);
        finish(s,r,s.time-FIXED_DT+fraction*FIXED_DT);
      }
    }
    if(s.racers.filter(r=>r.human).every(r=>r.finishTime!==null)) endRace(s,false);
    else if(s.time>=MAX_TIME) endRace(s,true);
  }
  function update(s,dt,inputs={}) {
    if(!s || s.phase==='finished' || !Number.isFinite(dt) || dt<=0) return s;
    // Bound catch-up after an interrupted frame; the controller pauses on blur.
    // A tab returning after minutes never simulates a whole race in one call.
    s.remainder=finite(s.remainder)+Math.min(dt,.25);
    while(s.remainder+1e-10>=FIXED_DT && s.phase!=='finished') {
      s.remainder=Math.max(0,s.remainder-FIXED_DT);
      step(s,inputs||{});
    }
    return s;
  }
  function score(s,index=0) {
    const r=s.racers[index];
    if(!r) return 0;
    const place=standings(s).findIndex(other=>other.id===r.id);
    const time=r.finishTime===null ? s.time : r.finishTime;
    return Math.max(1,Math.round([5000,4200,3500,2900,2400,2000,1700,1450][place]+r.tickets*75+
      Math.max(0,MAX_TIME-time)*20+Math.max(0,600-r.hits*60)-(r.dnf?1500:0)));
  }
  return Object.freeze({create,update,curveAt,zoneAt,standings,score,aiInput,roster,kinds,MAX_RACERS,
    constants:Object.freeze({LENGTH,FIXED_DT,ROAD_EDGE,MAX_TIME,MAX_RACERS,MAX_SPEED:250*BOOST_MULTIPLIER,DRIFT_MIN_SPEED,DRIFT_TIER_ONE,DRIFT_TIER_TWO,BOOST_DURATION,BOOST_MULTIPLIER,BOOST_COST})});
})();
