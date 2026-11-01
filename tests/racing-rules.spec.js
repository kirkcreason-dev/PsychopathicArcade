import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../games/racing-rules.js',import.meta.url),'utf8');
const manifest=JSON.parse(fs.readFileSync(new URL('../assets/racing/manifest.json',import.meta.url),'utf8'));
const load=()=>vm.runInNewContext(source+';RACING_RULES',{Math,Number,Object,Array});
function racing(R,options={}) {const s=R.create(options);s.phase='racing';s.countdown=0;s.tick=360;return s;}
function advance(R,s,seconds,inputs={},fps=60) {for(let n=0;n<Math.round(seconds*fps);n++)R.update(s,1/fps,typeof inputs==='function'?inputs(s):inputs);return s;}
function emptyTrack(R,options={}) {const s=racing(R,options);s.objects=[];s.racers[0].x=0;s.racers[0].z=100;s.racers[0].speed=100;return s;}
function finiteRace(s) {
  for(const r of s.racers) {
    for(const key of ['x','z','speed','boost','boostTime','health','tickets','hits','invulnerable','steer','driftCharge','driftDirection','driftTurbo','drifts'])expect(Number.isFinite(r[key])).toBe(true);
    expect(Math.abs(r.x)).toBeLessThanOrEqual(1);expect(r.z).toBeGreaterThanOrEqual(0);expect(r.z).toBeLessThanOrEqual(s.length);
    expect(r.speed).toBeGreaterThanOrEqual(0);expect(r.speed).toBeLessThanOrEqual(312.5);
    expect(r.boost).toBeGreaterThanOrEqual(0);expect(r.boost).toBeLessThanOrEqual(100);
    expect(r.boostTime).toBeGreaterThanOrEqual(0);expect(r.boostTime).toBeLessThanOrEqual(3);expect(typeof r.boostHeld).toBe('boolean');
    expect(r.boosting).toBe(r.boostTime>0);if(r.boosting){expect(r.drifting).toBe(false);expect(r.driftTurbo).toBe(0);}
    expect(r.health).toBeGreaterThanOrEqual(0);expect(r.health).toBeLessThanOrEqual(100);
    expect(r.driftCharge).toBeGreaterThanOrEqual(0);expect(r.driftCharge).toBeLessThanOrEqual(2);
    expect(r.driftTurbo).toBeGreaterThanOrEqual(0);expect(r.driftTurbo).toBeLessThanOrEqual(2);
    expect([-1,0,1]).toContain(r.driftDirection);expect(Number.isInteger(r.drifts)).toBe(true);
    if(!r.drifting){expect(r.driftCharge).toBe(0);expect(r.driftDirection).toBe(0);}
    if(r.drifting)expect(r.driftTurbo).toBe(0);
  }
}

test('roster references the six approved assets and routes are deterministic and bounded',()=>{
  const R=load(),s=R.create({seed:739});
  expect(R.roster.map(r=>r.id)).toEqual(manifest.racers.map(r=>r.id));
  expect(JSON.stringify(s)).toBe(JSON.stringify(R.create({seed:739})));
  expect(s.objects).not.toEqual(R.create({seed:740}).objects);
  expect(s.racers).toHaveLength(6);expect(new Set(s.racers.map(r=>r.racerId)).size).toBe(6);
  expect(s.racers.filter(r=>r.human).map(r=>r.id)).toEqual([0]);
  expect(s.objects.length).toBeLessThan(160);expect(new Set(s.objects.map(o=>o.id)).size).toBe(s.objects.length);
  expect(s.objects.every(o=>Math.abs(o.x)<=.65&&o.z>0&&o.z<s.length&&R.kinds[o.kind])).toBe(true);
  expect(s.objects.every((o,i)=>!i||o.z>=s.objects[i-1].z)).toBe(true);
  const online=R.create({online:true,playerRacer:'dani-mo',guestRacer:'dani-mo'});
  expect(online.racers.filter(r=>r.human).map(r=>r.id)).toEqual([0,1]);
  expect(online.racers[0].racerId).toBe('dani-mo');expect(online.racers[1].racerId).toBe('dani-mo');
  expect(R.create({playerRacer:'missing'}).racers[0].racerId).toBe('violent-j');
});

test('countdown holds every racer still for three seconds and then starts together',()=>{
  const R=load(),s=R.create(),grid=s.racers.map(r=>r.z);advance(R,s,2.5,{0:{boost:true,steer:1}});
  expect(s.phase).toBe('countdown');expect(s.countdown).toBeCloseTo(.5,8);expect(s.time).toBe(0);
  expect(s.racers.every(r=>r.z===grid[r.id]&&r.speed===0&&r.boost===60)).toBe(true);
  advance(R,s,.5);expect(s.phase).toBe('racing');expect(s.racers.map(r=>r.z)).toEqual(grid);
  R.update(s,1/30,{});expect(s.racers.every(r=>r.z>grid[r.id])).toBe(true);
});

test('starting grid separates the convoy while online humans share an equal start line',()=>{
  const R=load();
  for(const online of [false,true]) {
    const s=R.create({online});
    expect(s.racers.filter(r=>r.human).every(r=>r.z===0)).toBe(true);
    expect(s.racers.filter(r=>!r.human).map(r=>r.z)).toEqual(online?[90,180,270,360]:[90,180,270,360,450]);
    expect(s.racers.every(r=>Math.abs(r.x)===.5)).toBe(true);
    for(const a of s.racers)for(const b of s.racers)if(a.id!==b.id)expect(Math.abs(a.z-b.z)>=90||Math.abs(a.x-b.x)>=1).toBe(true);
  }
});

test('AI chooses a passing lane and holds a safe speed when a slower rider blocks its lane',()=>{
  const R=load(),s=racing(R);s.objects=[];
  for(const r of s.racers){r.z=5000+r.id*1000;r.x=.58;}
  const follower=s.racers[1],leader=s.racers[0];follower.z=100;follower.x=0;follower.speed=190;leader.z=135;leader.x=0;leader.speed=70;
  const control=R.aiInput(s,1);expect(Math.abs(control.steer)).toBeGreaterThan(.5);
  R.update(s,.1,{0:{brake:true}});expect(follower.speed).toBeLessThan(180);expect(Math.abs(follower.x)).toBeGreaterThan(0);
  // The human is allowed to pass freely: traffic never applies an invisible
  // brake to their controls or pins them behind a CPU vehicle.
  const human=emptyTrack(R);human.racers[0].speed=190;human.racers[1].z=130;human.racers[1].x=0;human.racers[1].speed=60;
  R.update(human,.1,{0:{boost:true}});expect(human.racers[0].speed).toBeGreaterThan(190);
});

test('30, 60 and 120fps produce the same simulation for identical held controls',()=>{
  const R=load(),states=[30,60,120].map(fps=>advance(R,R.create({seed:17}),16,{0:{steer:.12,boost:true}},fps));
  for(const s of states.slice(1)) {
    expect(s.tick).toBe(states[0].tick);expect(s.time).toBe(states[0].time);
    expect(s.objects).toEqual(states[0].objects);
    for(let i=0;i<6;i++)for(const key of ['x','z','speed','boost','health','tickets','hits'])expect(s.racers[i][key]).toBeCloseTo(states[0].racers[i][key],9);
  }
});

test('nitro accelerates, braking slows, and running onto the shoulder costs speed',()=>{
  const R=load(),normal=emptyTrack(R),boost=emptyTrack(R),brake=emptyTrack(R),offroad=emptyTrack(R);
  offroad.racers[0].x=1;
  advance(R,normal,2);advance(R,boost,2,{0:{boost:true}});advance(R,brake,2,{0:{brake:true}});advance(R,offroad,2);
  expect(boost.racers[0].z).toBeGreaterThan(normal.racers[0].z+20);
  expect(normal.racers[0].z).toBeGreaterThan(brake.racers[0].z+100);
  expect(offroad.racers[0].speed).toBeLessThan(normal.racers[0].speed*.8);
  expect(boost.racers[0].boost).toBeLessThan(normal.racers[0].boost);
  expect(brake.racers[0].speed).toBe(0);
});

test('a fresh boost press buys exactly3seconds of25% extra ordinary velocity without lingering speed',()=>{
  const R=load();expect(R.constants.BOOST_DURATION).toBe(3);expect(R.constants.BOOST_MULTIPLIER).toBe(1.25);expect(R.constants.BOOST_COST).toBe(30);
  for(const racer of R.roster){
    const normal=emptyTrack(R,{playerRacer:racer.id}),boost=emptyTrack(R,{playerRacer:racer.id});
    for(const s of [normal,boost]){s.racers[0].z=0;s.racers[0].speed=0;for(const r of s.racers.slice(1))r.z=5000+r.id*1000;}
    for(let tick=0;tick<360;tick++){
      R.update(normal,1/120,{});R.update(boost,1/120,{0:{boost:tick===0}});
      expect(boost.racers[0].boostTime).toBeCloseTo(3-(tick+1)/120,8);
      expect(boost.racers[0].speed).toBeCloseTo(normal.racers[0].speed*(tick===359?1:1.25),8);
    }
    expect(boost.racers[0].z).toBeCloseTo(normal.racers[0].z*1.25,7);expect(boost.racers[0].boost).toBe(30);
    expect(boost.racers[0].boosting).toBe(false);expect(boost.racers[0].boostTime).toBe(0);finiteRace(boost);
  }
});

test('holding or repeatedly pressing cannot extend a burst or automatically trigger after recharge',()=>{
  const R=load(),held=emptyTrack(R),tapped=emptyTrack(R);held.racers[0].boost=100;tapped.racers[0].boost=100;
  for(let tick=0;tick<360;tick++){
    R.update(held,1/120,{0:{boost:true}});R.update(tapped,1/120,{0:{boost:Math.floor(tick/12)%2===0}});
    expect(held.racers[0].boostTime).toBe(tapped.racers[0].boostTime);expect(held.racers[0].boost).toBe(70);expect(tapped.racers[0].boost).toBe(70);
  }
  advance(R,held,8,{0:{boost:true}});expect(held.racers[0].boostTime).toBe(0);expect(held.racers[0].boost).toBe(100);
  held.racers[0].x=0;R.update(held,1/120,{});R.update(held,1/120,{0:{boost:true}});expect(held.racers[0].boostTime).toBeCloseTo(3-1/120,8);expect(held.racers[0].boost).toBe(70);
  const empty=emptyTrack(R);empty.racers[0].boost=1;advance(R,empty,8,{0:{boost:true}});expect(empty.racers[0].boostTime).toBe(0);expect(empty.racers[0].boost).toBeGreaterThan(30);
  empty.racers[0].x=0;R.update(empty,1/120,{});R.update(empty,1/120,{0:{boost:true}});expect(empty.racers[0].boosting).toBe(true);
});

test('the3second burst has identical duration and speed at30,60 and120fps',()=>{
  const R=load(),states=[30,60,120].map(fps=>{
    const s=emptyTrack(R);advance(R,s,2.5,{0:{boost:true}},fps);expect(s.racers[0].boostTime).toBeCloseTo(.5,8);
    advance(R,s,.5,{},fps);expect(s.racers[0].boostTime).toBe(0);expect(s.racers[0].boosting).toBe(false);return s;
  });
  for(const s of states.slice(1))for(const field of ['z','speed','boost','boostTime'])expect(s.racers[0][field]).toBeCloseTo(states[0].racers[0][field],8);
});

test('braking and impacts still slow an active burst and a stopped clock cannot consume it',()=>{
  const R=load(),s=emptyTrack(R);s.racers[0].speed=189;R.update(s,1/120,{0:{boost:true}});
  const time=s.racers[0].boostTime,speed=s.racers[0].speed;R.update(s,0,{});expect(s.racers[0].boostTime).toBe(time);expect(s.racers[0].speed).toBe(speed);
  s.objects=[{id:0,kind:'barrier',x:0,z:s.racers[0].z+9,collectedBy:[]}];advance(R,s,.1,{});expect(s.racers[0].hits).toBe(1);expect(s.racers[0].speed).toBeLessThan(150);expect(s.racers[0].boostTime).toBeCloseTo(time-.1,8);
  advance(R,s,1.3,{0:{brake:true}});expect(s.racers[0].speed).toBe(0);expect(s.racers[0].boosting).toBe(true);finiteRace(s);
});

test('drift mini turbo and manual burst never stack and finishing clears the entire boost state',()=>{
  const R=load(),drift=driftReady(R);advance(R,drift,.8,{0:{brake:true,steer:1}});R.update(drift,1/120,{});
  const r=drift.racers[0];r.boost=100;R.update(drift,1/120,{0:{boost:true}});expect(r.driftTurbo).toBeGreaterThan(0);expect(r.boostTime).toBe(0);expect(r.boost).toBe(100);
  advance(R,drift,1,{0:{boost:true}});expect(r.boostTime).toBe(0);R.update(drift,1/120,{});R.update(drift,1/120,{0:{boost:true}});expect(r.boosting).toBe(true);expect(r.driftTurbo).toBe(0);
  R.update(drift,.2,{0:{brake:true,steer:1}});expect(r.drifting).toBe(false);expect(r.driftCharge).toBe(0);
  r.z=drift.length-.1;r.speed=100;R.update(drift,1/120,{});expect(r.finishTime).not.toBeNull();expect(r.boostTime).toBe(0);expect(r.boostHeld).toBe(false);expect(r.boosting).toBe(false);finiteRace(drift);
});

test('manual boost preserves the exact25% factor on residual drift momentum without clipping',()=>{
  const R=load(),s=driftReady(R);advance(R,s,.8,{0:{brake:true,steer:1}});R.update(s,1/120,{});
  while(s.racers[0].driftTurbo>0)R.update(s,1/120,{});
  expect(s.racers[0].speed).toBeGreaterThan(200);s.racers[0].boost=100;s.racers[0].x=0;s.racers[0].z=0;
  for(const r of s.racers.slice(1))r.z=5000+r.id*1000;
  const ordinary=JSON.parse(JSON.stringify(s));R.update(ordinary,1/120,{});R.update(s,1/120,{0:{boost:true}});
  expect(s.racers[0].speed).toBeGreaterThan(250);expect(s.racers[0].speed).toBeCloseTo(ordinary.racers[0].speed*1.25,9);expect(R.constants.MAX_SPEED).toBe(312.5);finiteRace(s);
});

test('an impact still costs speed but damaged rides recover a competitive cruising pace',()=>{
  const R=load(),hit=emptyTrack(R);hit.racers[0].speed=190;
  hit.objects=[{id:0,kind:'barrier',x:0,z:115,collectedBy:[]}];R.update(hit,.1,{});
  expect(hit.racers[0].hits).toBe(1);expect(hit.racers[0].speed).toBeLessThan(125);
  hit.objects=[];advance(R,hit,3);expect(hit.racers[0].speed).toBeGreaterThan(170);
  const healthy=emptyTrack(R),worn=emptyTrack(R);healthy.racers[0].speed=190;worn.racers[0].speed=190;worn.racers[0].health=0;
  advance(R,healthy,2);advance(R,worn,2);
  expect(worn.racers[0].speed).toBeGreaterThan(healthy.racers[0].speed*.85);
  expect(worn.racers[0].speed).toBeLessThan(healthy.racers[0].speed*.95);
});

test('a brake tap restores fast-corner steering; bikes turn faster and karts resist outward drift',()=>{
  const R=load(),fast=emptyTrack(R),braked=emptyTrack(R);
  for(const s of [fast,braked]){s.racers[0].z=1100;s.racers[0].speed=245;s.racers[0].steer=.6;}
  advance(R,fast,.1,{0:{steer:.6}});advance(R,braked,.1,{0:{steer:.6,brake:true}});
  expect(braked.racers[0].x).toBeGreaterThan(fast.racers[0].x+.025);
  expect(braked.racers[0].speed).toBeLessThan(fast.racers[0].speed);
  const bike=emptyTrack(R,{playerRacer:'violent-j'}),kart=emptyTrack(R,{playerRacer:'dani-mo'});
  for(const s of [bike,kart]){s.racers[0].speed=190;s.racers[0].steer=1;}
  advance(R,bike,.25,{0:{steer:1}});advance(R,kart,.25,{0:{steer:1}});
  expect(bike.racers[0].x).toBeGreaterThan(kart.racers[0].x+.02);
  for(const s of [bike,kart]){s.racers[0].x=0;s.racers[0].z=1100;s.racers[0].steer=0;s.racers[0].speed=190;}
  advance(R,bike,.25);advance(R,kart,.25);
  expect(Math.abs(kart.racers[0].x)).toBeLessThan(Math.abs(bike.racers[0].x)*.9);
});

test('drafting behind another racer regenerates extra nitro without giving a teleport advantage',()=>{
  const R=load(),solo=emptyTrack(R),draft=emptyTrack(R);
  for(const s of [solo,draft]){s.racers[0].boost=20;s.racers[0].speed=150;}
  draft.racers[1].x=0;draft.racers[1].z=180;draft.racers[1].speed=150;
  advance(R,solo,.5);advance(R,draft,.5);
  expect(draft.racers[0].drafting).toBe(true);expect(draft.racers[0].boost).toBeGreaterThan(solo.racers[0].boost+2);
  expect(draft.racers[0].z-solo.racers[0].z).toBeLessThan(5);
});

test('pickups are consumed once per racer, fairly available to both online humans, and clamped',()=>{
  const R=load(),s=racing(R,{online:true});
  for(const r of s.racers.slice(0,2)){r.x=0;r.speed=190;r.boost=95;r.health=90;}
  s.objects=[{id:0,kind:'ticket',x:0,z:12,collectedBy:[]},{id:1,kind:'boost',x:0,z:20,collectedBy:[]},{id:2,kind:'repair',x:0,z:28,collectedBy:[]}];
  R.update(s,.25,{});R.update(s,.25,{});
  for(const r of s.racers.slice(0,2)){expect(r.tickets).toBe(1);expect(r.boost).toBe(100);expect(r.health).toBe(100);}
  for(const o of s.objects)expect(o.collectedBy.filter(id=>id<2).sort()).toEqual([0,1]);
});

test('pickup feedback reports only the gain actually applied, including zero at full capacity',()=>{
  const R=load();
  for(const full of [false,true]) {
    const s=emptyTrack(R);s.racers[0].speed=190;s.racers[0].boost=full?100:99;s.racers[0].health=full?100:98.5;
    s.objects=['boost','repair','ticket'].map((kind,id)=>({id,kind,x:0,z:110,collectedBy:[]}));
    R.update(s,1/120,{});
    const events=s.events.filter(e=>e.type==='pickup'&&e.racer===0);
    expect(events).toHaveLength(3);
    expect(events.find(e=>e.kind==='ticket').amount).toBe(1);
    // Passive recharge applies before impact in this step, so only0.925 boost
    // remains available—not the pickup's nominal28-point reward.
    expect(events.find(e=>e.kind==='boost').amount).toBeCloseTo(full?0:.925,8);
    expect(events.find(e=>e.kind==='repair').amount).toBeCloseTo(full?0:1.5,8);
    expect(s.racers[0].boost).toBe(100);expect(s.racers[0].health).toBe(100);
  }
});

test('swept impacts catch a full-speed obstacle, protect recovery, and respect lateral clearance',()=>{
  const R=load(),s=racing(R);s.racers[0].x=0;s.racers[0].speed=250;s.racers[0].boost=100;
  s.objects=[{id:0,kind:'barrier',x:0,z:20,collectedBy:[]},{id:1,kind:'tire',x:0,z:24,collectedBy:[]}];
  const clear=JSON.parse(JSON.stringify(s));clear.objects=[];R.update(clear,.25,{0:{boost:true}});R.update(s,.25,{0:{boost:true}});
  expect(s.racers[0].hits).toBe(1);expect(s.racers[0].health).toBeLessThan(90);expect(s.racers[0].speed).toBeLessThan(clear.racers[0].speed*.75);
  advance(R,s,2);expect(s.racers[0].hits).toBe(1);
  const miss=racing(R);miss.racers[0].x=-.58;miss.racers[0].speed=250;
  miss.objects=[{id:0,kind:'barrier',x:.58,z:20,collectedBy:[]}];R.update(miss,.25,{});
  expect(miss.racers[0].hits).toBe(0);
});

test('human finish freezes the result, projects trailing CPU times later, and awards an integer score',()=>{
  const R=load(),s=emptyTrack(R);s.racers[0].z=s.length-1;s.racers[0].speed=190;
  R.update(s,1/30,{});expect(s.phase).toBe('finished');expect(s.finishOrder[0]).toBe(0);
  expect(new Set(s.finishOrder).size).toBe(6);expect(s.racers.every(r=>r.z===s.length&&r.speed===0&&Number.isFinite(r.finishTime))).toBe(true);
  expect(s.racers.slice(1).every(r=>r.finishTime>s.racers[0].finishTime)).toBe(true);
  expect(Number.isInteger(R.score(s,0))).toBe(true);expect(R.score(s,0)).toBeGreaterThan(0);
  const frozen=JSON.stringify(s);R.update(s,1,{});expect(JSON.stringify(s)).toBe(frozen);
});

test('online race waits for both humans and the 180 second cutoff cannot hang',()=>{
  const R=load(),s=emptyTrack(R,{online:true});s.racers[0].z=s.length-1;s.racers[0].speed=190;
  R.update(s,1/30,{});expect(s.phase).toBe('racing');expect(s.racers[0].finishTime).not.toBeNull();
  s.racers[1].z=s.length-1;s.racers[1].speed=190;R.update(s,1/30,{});expect(s.phase).toBe('finished');
  const cutoff=emptyTrack(R,{online:true});cutoff.tick=360+180*120-1;cutoff.time=180-1/120;
  R.update(cutoff,1/120,{0:{brake:true},1:{brake:true}});
  expect(cutoff.phase).toBe('finished');expect(cutoff.timedOut).toBe(true);expect(cutoff.finishOrder).toHaveLength(6);
  expect(cutoff.racers.every(r=>r.dnf&&r.finishTime>=180&&r.finishTime<300)).toBe(true);finiteRace(cutoff);
});

test('invalid timing and controls cannot create nonfinite values or an unbounded catch-up loop',()=>{
  const R=load(),s=R.create(),original=JSON.stringify(s);
  for(const dt of [-1,0,Infinity,NaN])R.update(s,dt,{});expect(JSON.stringify(s)).toBe(original);
  R.update(s,100000,{0:{steer:Infinity,boost:'yes'}});expect(s.tick).toBe(30);
  advance(R,s,8,{0:{steer:NaN,boost:true,brake:false}});finiteRace(s);
  expect(s.events.length).toBeLessThanOrEqual(16);
  expect([R.curveAt(-1),R.curveAt(NaN),R.curveAt(500),R.curveAt(14900)]).toEqual([0,0,0,0]);
  expect([-1,4999,5000,9999,10000,15000].map(R.zoneAt)).toEqual([0,0,1,1,2,2]);
});

test('seeded full races complete with sensible AI, all six identities, and bounded state',()=>{
  test.setTimeout(60000);
  const R=load();
  for(let seed=1;seed<=6;seed++) {
    const s=R.create({seed,playerRacer:R.roster[seed-1].id,online:seed===6});
    while(s.phase!=='finished') {
      const inputs={0:R.aiInput(s,0)};if(seed===6)inputs[1]=R.aiInput(s,1);
      R.update(s,1/30,inputs);
    }
    finiteRace(s);expect(s.timedOut).toBe(false);expect(s.time).toBeGreaterThan(60);expect(s.time).toBeLessThan(130);
    expect(s.racers[0].hits).toBeLessThan(8);expect(s.racers[0].tickets).toBeGreaterThan(3);
    expect(s.racers.every(r=>r.finishTime!==null&&r.finishTime<150)).toBe(true);
    expect(s.finishOrder).toEqual(R.standings(s).map(r=>r.id));
    expect(s.objects.every(o=>o.collectedBy.length===new Set(o.collectedBy).size)).toBe(true);
    expect(s.events).toHaveLength(16);
  }
});

test('coarse digital steering and boost can contend without using the expert routing helper',()=>{
  test.setTimeout(60000);
  const R=load(),places=[];
  for(let seed=1;seed<=6;seed++) {
    const s=R.create({seed});let input={},frames=0;
    while(s.phase!=='finished'&&frames++<6000) {
      // A deliberately simple policy: react only every 267ms, notice hazards
      // 240 units ahead, use full left/right presses, and tap boost when ready.
      // It does not collect optimal rewards or call the game's AI planner.
      if(frames%8===1) {
        const r=s.racers[0],hazards=s.objects.filter(o=>!R.kinds[o.kind].pickup&&o.z-r.z>0&&o.z-r.z<240);
        let target=r.x;
        if(hazards.some(o=>Math.abs(o.x-r.x)<R.kinds[o.kind].width+.16)) {
          target=[-.58,0,.58].map(x=>({x,cost:Math.abs(x-r.x)+hazards.reduce((total,o)=>total+(Math.abs(x-o.x)<R.kinds[o.kind].width+.13?4:0),0)})).sort((a,b)=>a.cost-b.cost)[0].x;
        }
        input={steer:Math.abs(target-r.x)>.09?Math.sign(target-r.x):R.curveAt(r.z)*.15,boost:r.boost>=30&&r.boostTime===0&&!r.boostHeld,brake:false};
      }
      R.update(s,1/30,{0:input});
    }
    expect(s.phase).toBe('finished');expect(s.timedOut).toBe(false);finiteRace(s);
    places.push(R.standings(s).findIndex(r=>r.id===0)+1);
  }
  expect(places.filter(place=>place<=3).length).toBeGreaterThanOrEqual(4);
  expect(places.reduce((a,b)=>a+b,0)/places.length).toBeLessThan(3.5);
});

function driftReady(R){const s=emptyTrack(R);s.racers[0].x=-.5;s.racers[0].speed=190;s.racers[0].boost=25;return s;}
const driftEvents=s=>s.events.filter(e=>e.type==='drift'&&e.racer===0);

test('brake and steer holds bank two accessible drift tiers without leaving the road',()=>{
  const R=load();
  for(const [hold,tier,reward,turbo] of [[.65,1,12,.75],[1.4,2,22,1.25]]) {
    const s=driftReady(R),r=s.racers[0];advance(R,s,hold,{0:{brake:true,steer:1}},120);
    expect(r.drifting).toBe(true);expect(r.driftCharge).toBeCloseTo(hold,8);expect(Math.abs(r.x)).toBeLessThan(R.constants.ROAD_EDGE);
    expect(r.speed).toBeGreaterThanOrEqual(150);expect(r.drifts).toBe(0);
    R.update(s,1/120,{0:{steer:0,brake:false}});
    expect(driftEvents(s)).toHaveLength(1);expect(driftEvents(s)[0]).toMatchObject({tier,amount:reward});
    expect(r.drifts).toBe(1);expect(r.driftTurbo).toBe(turbo);expect(r.speed).toBeGreaterThan(tier===1?170:180);
    expect(r.drifting).toBe(false);expect(r.driftCharge).toBe(0);expect(r.driftDirection).toBe(0);
    advance(R,s,turbo+.2,{});expect(r.driftTurbo).toBe(0);expect(r.drifts).toBe(1);finiteRace(s);
  }
});

test('drift charging, release and turbo are deterministic at30,60 and120fps',()=>{
  const R=load(),states=[30,60,120].map(fps=>{
    const s=driftReady(R);advance(R,s,1.4,{0:{brake:true,steer:1}},fps);advance(R,s,1.5,{},fps);return s;
  });
  for(const s of states.slice(1)) {
    expect(s.tick).toBe(states[0].tick);expect(s.events).toEqual(states[0].events);
    for(let i=0;i<6;i++)for(const field of ['x','z','speed','boost','driftCharge','driftTurbo','drifts'])expect(s.racers[i][field]).toBeCloseTo(states[0].racers[i][field],9);
  }
});

test('straight braking stops, slow steering cannot charge, and repeated taps earn no turbo',()=>{
  const R=load(),straight=driftReady(R);advance(R,straight,2,{0:{brake:true}});
  expect(straight.racers[0].speed).toBe(0);expect(straight.racers[0].drifts).toBe(0);expect(driftEvents(straight)).toHaveLength(0);
  const stoppedAt=straight.racers[0].z;advance(R,straight,.5,{0:{brake:true}});expect(straight.racers[0].z).toBe(stoppedAt);
  const slow=driftReady(R);slow.racers[0].speed=110;advance(R,slow,1.6,{0:{brake:true,steer:1}});
  expect(slow.racers[0].drifting).toBe(false);expect(slow.racers[0].driftCharge).toBe(0);expect(slow.racers[0].drifts).toBe(0);
  const taps=driftReady(R);
  for(let i=0;i<8;i++){advance(R,taps,.2,{0:{brake:true,steer:i%2?-1:1}});advance(R,taps,.2,{});}
  expect(taps.racers[0].drifts).toBe(0);expect(taps.racers[0].driftTurbo).toBe(0);expect(driftEvents(taps)).toHaveLength(0);
});

test('reversing direction discards a charged drift instead of banking or carrying it over',()=>{
  const R=load(),s=driftReady(R);advance(R,s,.8,{0:{brake:true,steer:1}});
  R.update(s,1/120,{0:{brake:true,steer:-1}});
  expect(s.racers[0].drifting).toBe(false);expect(s.racers[0].driftCharge).toBe(0);expect(driftEvents(s)).toHaveLength(0);
  advance(R,s,.3,{0:{brake:true,steer:-1}});R.update(s,1/120,{});
  expect(s.racers[0].drifts).toBe(0);expect(s.racers[0].driftTurbo).toBe(0);
});

test('boost, immunity, shoulder excursions and impacts cancel charge and active turbo',()=>{
  const R=load();
  for(const cause of ['boost','immunity','shoulder','impact']) {
    const s=driftReady(R);advance(R,s,.8,{0:{brake:true,steer:1}});const r=s.racers[0];
    if(cause==='immunity')r.invulnerable=.5;
    if(cause==='shoulder')r.x=.98;
    if(cause==='impact')s.objects=[{id:0,kind:'cone',x:r.x,z:r.z+9,collectedBy:[]}];
    R.update(s,1/120,{0:{brake:true,steer:1,boost:cause==='boost'}});
    expect(r.drifting).toBe(false);expect(r.driftCharge).toBe(0);expect(r.drifts).toBe(0);expect(driftEvents(s)).toHaveLength(0);
  }
  for(const cause of ['shoulder','impact']) {
    const s=driftReady(R);advance(R,s,.8,{0:{brake:true,steer:1}});R.update(s,1/120,{});const r=s.racers[0];
    expect(r.driftTurbo).toBeGreaterThan(0);
    if(cause==='shoulder')r.x=.98;else s.objects=[{id:0,kind:'tire',x:r.x,z:r.z+9,collectedBy:[]}];
    R.update(s,1/120,{});expect(r.driftTurbo).toBe(0);expect(r.drifts).toBe(1);
  }
});

test('release on the collision or finish step cannot award a free drift',()=>{
  const R=load();
  for(const cause of ['impact','finish']) {
    const s=driftReady(R);advance(R,s,.8,{0:{brake:true,steer:1}});const r=s.racers[0];
    if(cause==='impact')s.objects=[{id:0,kind:'barrier',x:r.x,z:r.z+9,collectedBy:[]}];else r.z=s.length-.1;
    R.update(s,1/120,{});
    expect(r.drifts).toBe(0);expect(r.drifting).toBe(false);expect(r.driftCharge).toBe(0);expect(r.driftDirection).toBe(0);expect(r.driftTurbo).toBe(0);
    expect(driftEvents(s)).toHaveLength(0);
  }
  const finished=driftReady(R);advance(R,finished,.8,{0:{brake:true,steer:1}});R.update(finished,1/120,{});
  finished.racers[0].z=finished.length-.1;R.update(finished,1/120,{});
  expect(finished.racers[0].drifts).toBe(1);expect(finished.racers.every(r=>!r.drifting&&r.driftCharge===0&&r.driftDirection===0&&r.driftTurbo===0)).toBe(true);
});

test('steering release banks actual capped boost while continued braking still stops',()=>{
  const R=load(),s=driftReady(R);advance(R,s,.8,{0:{brake:true,steer:1}});s.racers[0].boost=99;
  R.update(s,1/120,{0:{brake:true,steer:0}});
  expect(driftEvents(s)[0].amount).toBeCloseTo(.925,8);expect(s.racers[0].drifts).toBe(1);
  advance(R,s,1.5,{0:{brake:true}});expect(s.racers[0].speed).toBe(0);
  const full=driftReady(R);advance(R,full,.8,{0:{brake:true,steer:1}});full.racers[0].boost=100;R.update(full,1/120,{});
  expect(driftEvents(full)[0].amount).toBe(0);expect(full.racers[0].driftTurbo).toBeGreaterThan(0);
});

test('an online guest can earn a drift from the untouched grid using ordinary controls',()=>{
  const R=load(),s=R.create({online:true});advance(R,s,5.5,{});
  expect(s.racers[1].speed).toBeGreaterThanOrEqual(120);
  advance(R,s,.8,{1:{brake:true,steer:-1}});expect(s.racers[1].drifting).toBe(true);
  R.update(s,1/120,{1:{brake:false,steer:0}});
  expect(s.racers[1].drifts).toBe(1);expect(s.events.some(e=>e.type==='drift'&&e.racer===1&&e.tier===1)).toBe(true);
  expect(Math.abs(s.racers[1].x)).toBeLessThan(R.constants.ROAD_EDGE);finiteRace(s);
});

test('explicit rooms support two through eight human seats with equal start distance and bounded CPU fill',()=>{
  const R=load();expect(R.MAX_RACERS).toBe(8);expect(R.constants.MAX_RACERS).toBe(8);
  for(let count=2;count<=8;count++) {
    const humanRacers=Array.from({length:count},(_,i)=>R.roster[i%6].id),s=R.create({seed:82,humanRacers});
    expect(s.version).toBe(1);expect(s.racers).toHaveLength(Math.max(6,count));
    expect(s.racers.filter(r=>r.human).map(r=>r.id)).toEqual(Array.from({length:count},(_,i)=>i));
    expect(s.racers.slice(0,count).map(r=>r.racerId)).toEqual(humanRacers);
    expect(s.racers.slice(0,count).every(r=>r.z===0&&Math.abs(r.x)<R.constants.ROAD_EDGE)).toBe(true);
    expect(new Set(s.racers.slice(0,count).map(r=>r.x)).size).toBe(count);
    expect(s.racers.slice(count).map(r=>r.z)).toEqual(Array.from({length:Math.max(0,6-count)},(_,i)=>(i+1)*90));
    const grid=s.racers.map(r=>({x:r.x,z:r.z}));advance(R,s,3,{});
    expect(s.racers.map(r=>({x:r.x,z:r.z}))).toEqual(grid);finiteRace(s);
  }
  const duplicates=R.create({humanRacers:Array(8).fill('big-foot')});
  expect(duplicates.racers.every(r=>r.human&&r.racerId==='big-foot')).toBe(true);
  expect(R.create({humanRacers:Array(50).fill('big-foot')}).racers).toHaveLength(8);
  expect(R.create({humanRacers:['bad-id','bad-id']}).racers.slice(0,2).map(r=>r.racerId)).toEqual(['violent-j','shaggy-2-dope']);
});

test('all eight seats can independently collect the same reward and control their own vehicle',()=>{
  const R=load(),s=racing(R,{humanRacers:Array(8).fill('dani-mo')});
  s.objects=[{id:0,kind:'ticket',x:0,z:12,collectedBy:[]}];
  for(const r of s.racers){r.x=0;r.speed=190;}
  R.update(s,.1,{});expect(s.racers.every(r=>r.tickets===1)).toBe(true);
  expect(s.objects[0].collectedBy.slice().sort((a,b)=>a-b)).toEqual([0,1,2,3,4,5,6,7]);
  R.update(s,.1,{});expect(s.racers.every(r=>r.tickets===1)).toBe(true);
  s.objects=[];for(const r of s.racers){r.x=0;r.steer=0;}
  advance(R,s,.2,{6:{steer:-1},7:{steer:1}});
  expect(s.racers[6].x).toBeLessThan(-.1);expect(s.racers[7].x).toBeGreaterThan(.1);
  expect(s.racers.slice(0,6).every(r=>Math.abs(r.x)<.001)).toBe(true);finiteRace(s);
});

test('eight-person finish waits for the last human and awards finite scores for every placing',()=>{
  const R=load(),s=racing(R,{humanRacers:Array(8).fill('violent-j')});s.objects=[];
  for(const r of s.racers.slice(0,7)){r.z=s.length-.1;r.speed=190;}
  R.update(s,1/120,{});expect(s.phase).toBe('racing');expect(s.finishOrder).toHaveLength(7);
  expect(s.racers[7].finishTime).toBeNull();s.racers[7].z=s.length-.1;s.racers[7].speed=190;
  R.update(s,1/120,{});expect(s.phase).toBe('finished');expect(s.finishOrder).toHaveLength(8);
  expect(new Set(s.finishOrder).size).toBe(8);expect(R.standings(s).at(-1).id).toBe(7);
  const scores=s.racers.map(r=>R.score(s,r.id));expect(scores.every(n=>Number.isInteger(n)&&n>0)).toBe(true);
  expect(scores[5]).toBeGreaterThan(scores[6]);expect(scores[6]).toBeGreaterThan(scores[7]);finiteRace(s);
});

test('eight-person cutoff settles every seat and resets drift without waiting indefinitely',()=>{
  const R=load(),s=racing(R,{humanRacers:Array(8).fill('big-foot')});s.objects=[];
  s.tick=360+180*120-1;s.time=180-1/120;
  for(const r of s.racers){r.z=r.id*100;r.driftTurbo=.5;}
  R.update(s,1/120,{});expect(s.phase).toBe('finished');expect(s.timedOut).toBe(true);
  expect(s.finishOrder).toEqual([7,6,5,4,3,2,1,0]);
  expect(s.racers.every(r=>r.dnf&&r.finishTime>=180&&r.finishTime<300&&r.driftTurbo===0)).toBe(true);finiteRace(s);
});

test('complete seven- and eight-person races keep per-seat pickups, standings and scores consistent',()=>{
  test.setTimeout(60000);const R=load();
  for(const count of [7,8]) {
    const s=R.create({seed:202+count,humanRacers:Array.from({length:count},(_,i)=>R.roster[i%6].id)});
    while(s.phase!=='finished')R.update(s,1/30,s.racers.map(r=>R.aiInput(s,r.id)));
    expect(s.timedOut).toBe(false);expect(s.time).toBeGreaterThan(60);expect(s.time).toBeLessThan(130);
    expect(s.finishOrder).toEqual(R.standings(s).map(r=>r.id));expect(new Set(s.finishOrder).size).toBe(count);
    for(const r of s.racers){expect(r.finishTime).not.toBeNull();expect(Number.isInteger(R.score(s,r.id))).toBe(true);expect(R.score(s,r.id)).toBeGreaterThan(0);}
    expect(s.objects.every(o=>o.collectedBy.length===new Set(o.collectedBy).size&&o.collectedBy.every(id=>id>=0&&id<count))).toBe(true);finiteRace(s);
  }
});
