import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import vm from 'node:vm';

const base=fs.readFileSync(new URL('../games/racing-rules.js',import.meta.url),'utf8');
const source=fs.readFileSync(new URL('../games/road-riot-rules.js',import.meta.url),'utf8');
const load=()=>vm.runInNewContext(base+'\n'+source+';ROAD_RIOT_RULES',{Math,Number,Object,Array});
const advance=(R,s,seconds,input={},fps=120)=>{for(let i=0;i<Math.round(seconds*fps);i++)R.advance(s,1/fps,typeof input==='function'?input(s):input);return s;};
function fight(R,seed=1){
  const s=R.create({seed});s.phase='racing';s.countdown=0;s.tick=432;s.time=.6;s.objects=[];
  s.racers[0].x=-.3;s.racers[0].z=100;s.racers[0].speed=140;
  s.racers[1].x=.3;s.racers[1].z=120;s.racers[1].speed=140;
  for(const r of s.racers.slice(2)){r.z=15000;r.finishTime=0;s.finishOrder.push(r.id);}
  return s;
}
function solo(R){const s=fight(R);s.racers[1].finishTime=0;s.racers[1].z=15000;s.finishOrder.push(1);s.racers[0].x=0;s.racers[0].z=0;s.racers[0].speed=0;return s;}
const strikes=(s,id=0)=>s.events.filter(e=>e.type==='strike'&&e.racer===id);
function finiteState(s){
  expect(s.racers).toHaveLength(6);expect(s.events.length).toBeLessThanOrEqual(24);
  for(const r of s.racers){
    for(const key of ['x','z','speed','health','boost','boostTime','attackTime','attackCooldown','crashTime','invulnerable','combo','combatHits','knockouts'])expect(Number.isFinite(r[key])).toBe(true);
    expect(Math.abs(r.x)).toBeLessThanOrEqual(1);expect(r.z).toBeGreaterThanOrEqual(0);expect(r.z).toBeLessThanOrEqual(15000);
    expect(r.speed).toBeGreaterThanOrEqual(0);expect(r.speed).toBeLessThanOrEqual(312.5);expect(r.health).toBeGreaterThanOrEqual(0);expect(r.health).toBeLessThanOrEqual(100);
    expect(r.boostTime).toBeGreaterThanOrEqual(0);expect(r.boostTime).toBeLessThanOrEqual(3);expect(r.boosting).toBe(r.boostTime>0);
    expect(r.attackTime).toBeGreaterThanOrEqual(0);expect(r.attackTime).toBeLessThanOrEqual(.58);expect([-1,0,1]).toContain(r.attackSide);
    expect(r.crashTime).toBeGreaterThanOrEqual(0);expect(r.crashTime).toBeLessThanOrEqual(2.2);expect(r.drifting).toBe(false);expect(r.driftTurbo).toBe(0);
    if(r.crashTime>0){expect(r.health).toBe(0);expect(r.attackTime).toBe(0);expect(r.boostTime).toBe(0);expect(r.blocking).toBe(false);}
  }
}

test('Road Riot has an independent deterministic six-rider combat state and compatible scenery',()=>{
  const R=load(),s=R.create({seed:55,playerRacer:'big-foot'});
  expect(s.combat).toBe(true);expect(s.racers[0].racerId).toBe('big-foot');expect(s.racers.map(r=>r.id)).toEqual([0,1,2,3,4,5]);
  expect(new Set(s.racers.map(r=>r.racerId)).size).toBe(6);expect(R.create({seed:55,playerRacer:'big-foot'})).toEqual(s);
  expect(R.create({seed:56}).objects).not.toEqual(s.objects);expect(s.objects.length).toBeLessThan(100);expect(s.objects.every(o=>R.kinds[o.kind]&&o.collectedBy.length===0)).toBe(true);
  expect(R.attackTargets(s,0,1).map(r=>r.id)).toContain(1);finiteState(s);
});

test('countdown keeps the nearby starting grid still and ignores focus-sized catch-up spikes',()=>{
  const R=load(),s=R.create(),grid=s.racers.map(r=>[r.x,r.z]);R.advance(s,100000,{boost:true,attackRight:true});
  expect(s.tick).toBe(30);expect(s.time).toBe(0);expect(s.racers.map(r=>[r.x,r.z])).toEqual(grid);
  advance(R,s,2.75);expect(s.phase).toBe('racing');expect(s.time).toBe(0);expect(s.racers.every(r=>r.speed===0)).toBe(true);
  R.advance(s,NaN,{});R.advance(s,-1,{});expect(s.tick).toBe(360);
});

test('a punch is telegraphed before impact and resolves only once even when held',()=>{
  const R=load(),s=fight(R),before=s.racers[1].health;
  advance(R,s,.2,{attackRight:true});expect(s.racers[0].attackSide).toBe(1);expect(s.racers[0].attackTime).toBeGreaterThan(R.constants.SWING_TIME);expect(s.racers[1].health).toBe(before);expect(strikes(s)).toHaveLength(0);
  advance(R,s,5/120,{attackRight:true});expect(strikes(s)).toHaveLength(1);expect(s.racers[1].health).toBeLessThan(before);expect(s.racers[0].combatHits).toBe(1);
  advance(R,s,1,{attackRight:true});expect(strikes(s)).toHaveLength(1);expect(s.racers[0].attackTime).toBe(0);expect(s.racers[0].attackSide).toBe(0);
});

test('wrong-side, distant and out-of-lane attacks cannot damage a rider',()=>{
  const R=load();
  for(const mode of ['wrong-side','far','wide']){
    const s=fight(R);if(mode==='far')s.racers[1].z=250;if(mode==='wide'){s.racers[0].x=-.6;s.racers[1].x=1;}
    advance(R,s,.5,mode==='wrong-side'?{attackLeft:true}:{attackRight:true});expect(strikes(s)).toHaveLength(0);expect(s.racers[1].health).toBe(100);
  }
});

test('each missed swing emits one side-specific result and never grants hit or combo points',()=>{
  const R=load(),s=fight(R);advance(R,s,1.5,{attackLeft:true});
  expect(s.events.filter(e=>e.type==='miss'&&e.racer===0)).toEqual([expect.objectContaining({type:'miss',racer:0,side:-1})]);
  expect(s.racers[0].combatHits).toBe(0);expect(s.racers[0].combo).toBe(0);expect(s.racers[0].knockouts).toBe(0);
  const escaped=fight(R);advance(R,escaped,.1,{attackRight:true});escaped.racers[1].z+=80;advance(R,escaped,.2,{});
  expect(escaped.events.filter(e=>e.type==='miss'&&e.racer===0)).toHaveLength(1);expect(strikes(escaped)).toHaveLength(0);
  const landed=fight(R);advance(R,landed,.3,{attackRight:true});expect(strikes(landed)).toHaveLength(1);expect(landed.events.filter(e=>e.type==='miss'&&e.racer===0)).toHaveLength(0);
});

test('a stopped ride cannot skate sideways and slow steering scales with actual forward movement',()=>{
  const R=load(),stopped=solo(R);stopped.racers[0].x=.2;
  advance(R,stopped,3,{steer:1,brake:true});expect(stopped.racers[0].speed).toBe(0);expect(stopped.racers[0].x).toBe(.2);expect(stopped.racers[0].z).toBe(0);
  const slow=solo(R),fast=solo(R);slow.racers[0].speed=10;fast.racers[0].speed=160;
  advance(R,slow,.1,{steer:1});advance(R,fast,.1,{steer:1});expect(Math.abs(slow.racers[0].x)).toBeLessThan(Math.abs(fast.racers[0].x)*.25);
});

test('side contact separates closing vehicles symmetrically without damage or a lateral jump',()=>{
  const R=load(),states=[1,-1].map(mirror=>{
    const s=fight(R);s.racers[1].human=true;s.racers[1].racerId=s.racers[0].racerId;
    for(const r of s.racers.slice(0,2)){r.z=100;r.speed=190;}
    s.racers[0].x=-.151*mirror;s.racers[1].x=.151*mirror;s.racers[0].steer=mirror;s.racers[1].steer=-mirror;
    R.advance(s,1/120,{});return s;
  });
  for(const s of states){
    const[a,b]=s.racers;expect(Math.abs(a.x-b.x)).toBeCloseTo(.3,8);expect(a.x+b.x).toBeCloseTo(0,10);
    expect(a.health).toBe(100);expect(b.health).toBe(100);expect(a.hits+b.hits).toBe(0);
    expect(Math.abs(Math.abs(a.x)-.151)).toBeLessThan(.02);expect(a.z).toBeGreaterThan(100);expect(b.z).toBeGreaterThan(100);
  }
  expect(states[0].racers[0].x).toBeCloseTo(-states[1].racers[0].x,10);expect(states[0].racers[0].z).toBe(states[1].racers[0].z);
});

test('rear contact shares momentum and prevents overtaking through an occupied lane without rewinding either ride',()=>{
  const R=load(),s=fight(R);s.racers[1].human=true;s.racers[1].racerId=s.racers[0].racerId;
  s.racers[0].x=s.racers[1].x=0;s.racers[0].z=100;s.racers[1].z=127;s.racers[0].speed=250;s.racers[1].speed=80;
  const free=JSON.parse(JSON.stringify(s));free.racers[0].x=-.8;free.racers[1].x=.8;R.advance(free,1/120,{});R.advance(s,1/120,{});
  const[a,b]=s.racers;expect(b.z-a.z).toBeCloseTo(R.constants.CONTACT_LENGTH,8);expect(a.speed).toBeCloseTo(b.speed,8);
  expect(a.speed+b.speed).toBeCloseTo(free.racers[0].speed+free.racers[1].speed,8);
  expect(a.z).toBeGreaterThanOrEqual(100);expect(b.z).toBeGreaterThanOrEqual(127);expect(a.z-100).toBeLessThanOrEqual(312.5/120);expect(b.z-127).toBeLessThanOrEqual(312.5/120);
  expect(a.health+b.health).toBe(200);finiteState(s);
});

test('a three-rider contact cannot manufacture speed or rewind distance through uneven averaging',()=>{
  const R=load(),s=fight(R);s.finishOrder=s.finishOrder.filter(id=>id!==2);
  for(let i=0;i<3;i++){const r=s.racers[i];r.human=true;r.racerId=s.racers[0].racerId;r.finishTime=null;r.x=0;r.z=100+i*20;r.speed=250-i*100;}
  const free=JSON.parse(JSON.stringify(s));free.racers[0].x=-.8;free.racers[2].x=.8;
  R.advance(free,1/120,{});R.advance(s,1/120,{});
  expect(s.racers.slice(0,3).reduce((sum,r)=>sum+r.speed,0)).toBeCloseTo(free.racers.slice(0,3).reduce((sum,r)=>sum+r.speed,0),8);
  for(let i=0;i<3;i++){expect(s.racers[i].z).toBeGreaterThanOrEqual(100+i*20);expect(s.racers[i].z-(100+i*20)).toBeLessThanOrEqual(312.5/120);expect(Math.abs(s.racers[i].x)).toBeLessThanOrEqual(.02);}
});

test('attack targeting uses physical side and distance and never selects self or a recovering rider',()=>{
  const R=load(),s=fight(R);expect(R.attackTargets(s,0,1).map(r=>r.id)).toEqual([1]);expect(R.attackTargets(s,0,-1)).toHaveLength(0);
  s.racers[1].invulnerable=1;expect(R.attackTargets(s,0,1)).toHaveLength(0);s.racers[1].invulnerable=0;s.racers[1].crashTime=1;expect(R.attackTargets(s,0,1)).toHaveLength(0);
  expect(R.attackTargets(s,99,1)).toHaveLength(0);expect(R.attackTargets(s,0,0)).toHaveLength(0);
});

test('blocking substantially reduces a real punch and knockback while costing cruising speed',()=>{
  const R=load(),open=fight(R,1),guarded=fight(R,3);
  advance(R,open,.3,{attackRight:true});advance(R,guarded,.3,{attackRight:true});
  expect(strikes(open)[0].blocked).toBe(false);expect(strikes(guarded)[0].blocked).toBe(true);
  expect(strikes(guarded)[0].damage).toBeLessThan(strikes(open)[0].damage*.25);expect(guarded.racers[0].combatHits).toBe(0);expect(guarded.racers[0].combo).toBe(0);
  const fast=solo(R),slow=solo(R);fast.racers[0].speed=189;slow.racers[0].speed=189;
  advance(R,fast,1);advance(R,slow,1,{block:true});expect(slow.racers[0].speed).toBeLessThan(fast.racers[0].speed*.85);expect(slow.racers[0].blocking).toBe(true);
});

test('rival windups give the player time to block instead of dealing instant damage',()=>{
  const R=load(),s=fight(R);s.time=2.1;s.tick=612;
  R.advance(s,1/120,{});expect(s.racers[1].attackTime).toBeGreaterThan(.55);expect(s.racers[0].health).toBe(100);
  advance(R,s,.25,{});expect(s.racers[0].health).toBe(100);advance(R,s,.2,{block:true});
  const strike=strikes(s,1)[0];expect(strike).toBeTruthy();expect(strike.blocked).toBe(true);expect(s.racers[0].health).toBeGreaterThan(94);
});

test('a knockout awards once, visibly crashes, then restores health and temporary protection',()=>{
  const R=load(),s=fight(R);s.racers[1].health=5;advance(R,s,29/120,{attackRight:true});
  const target=s.racers[1],crashZ=target.z;expect(target.crashTime).toBe(2.2);expect(target.health).toBe(0);expect(s.racers[0].knockouts).toBe(1);expect(target.crashes).toBe(1);
  expect(s.events.filter(e=>e.type==='knockout')).toHaveLength(1);advance(R,s,2.2,{attackRight:true});
  expect(target.crashTime).toBe(0);expect(target.health).toBe(75);expect(target.invulnerable).toBe(1.8);expect(target.z-crashZ).toBeLessThan(30);expect(s.racers[0].knockouts).toBe(1);finiteState(s);
});

test('blocked swings, cooldown taps and held buttons cannot farm combat stats',()=>{
  const R=load(),s=fight(R,3);advance(R,s,.3,{attackRight:true});expect(s.racers[0].combatHits).toBe(0);
  for(let i=0;i<10;i++)R.advance(s,1/120,{attackRight:i%2===0});expect(s.events.filter(e=>e.type==='attack'&&e.racer===0)).toHaveLength(1);
  advance(R,s,.5,{attackRight:true});expect(s.events.filter(e=>e.type==='attack'&&e.racer===0)).toHaveLength(1);
});

test('turbo is a fresh-press3-second25% speed increase and cannot be extended or repeated by holding',()=>{
  const R=load(),normal=solo(R),burst=solo(R);
  for(let i=0;i<360;i++){
    R.advance(normal,1/120,{});R.advance(burst,1/120,{boost:i===0});
    expect(burst.racers[0].speed).toBeCloseTo(normal.racers[0].speed*(i===359?1:1.25),8);
  }
  expect(burst.racers[0].z).toBeCloseTo(normal.racers[0].z*1.25,8);expect(burst.racers[0].boostTime).toBe(0);expect(burst.racers[0].boost).toBe(30);
  const held=solo(R);advance(R,held,12,{boost:true});expect(held.racers[0].boostTime).toBe(0);expect(held.racers[0].boost).toBe(100);finiteState(held);
});

test('combat, steering, pickups and turbo are deterministic at30,60 and120frames per second',()=>{
  const R=load(),states=[30,60,120].map(fps=>{
    const s=R.create({seed:812});advance(R,s,3,{},fps);advance(R,s,.6,{},fps);advance(R,s,.5,{attackRight:true},fps);advance(R,s,2,{steer:.04,boost:true},fps);advance(R,s,3,{block:true,steer:-.03},fps);return s;
  });
  for(const s of states.slice(1)){expect(s.tick).toBe(states[0].tick);expect(s.events).toEqual(states[0].events);expect(s.objects).toEqual(states[0].objects);expect(s.racers).toEqual(states[0].racers);}finiteState(states[0]);
});

test('repair, boost and ticket pickups apply once per rider and report only the actual capped gain',()=>{
  const R=load(),s=solo(R),r=s.racers[0];r.speed=190;r.z=100;r.health=98;r.boost=99;
  s.objects=['repair','boost','ticket'].map((kind,id)=>({id,kind,x:0,z:110,collectedBy:[]}));advance(R,s,.1,{});
  expect(r.health).toBe(100);expect(r.boost).toBe(100);expect(r.tickets).toBe(1);
  const events=s.events.filter(e=>e.type==='pickup');expect(events).toHaveLength(3);expect(events.find(e=>e.kind==='repair').amount).toBe(2);expect(events.find(e=>e.kind==='boost').amount).toBeLessThan(1);
  advance(R,s,.2,{});expect(s.events.filter(e=>e.type==='pickup')).toHaveLength(3);
});

test('swept obstacles remain physical and can cause a recoverable crash without tunneling',()=>{
  const R=load(),s=solo(R),r=s.racers[0];r.z=100;r.speed=250;r.health=5;
  s.objects=[{id:0,kind:'barrier',x:0,z:112,collectedBy:[]}];R.advance(s,.25,{boost:true});expect(r.crashes).toBe(1);expect(r.crashTime).toBeGreaterThan(0);expect(r.boostTime).toBe(0);
  advance(R,s,2.3);expect(r.health).toBe(75);expect(r.crashTime).toBe(0);expect(r.invulnerable).toBeGreaterThan(1);finiteState(s);
});

test('the finish settles every placing, stops combat and preserves results across later updates',()=>{
  const R=load(),s=R.create();s.phase='racing';s.countdown=0;s.tick=360;s.objects=[];const r=s.racers[0];r.z=14999;r.speed=190;
  R.advance(s,.1,{boost:true,attackRight:true});expect(s.phase).toBe('finished');expect(s.finishOrder).toHaveLength(6);expect(s.racers.every(v=>v.finishTime!==null&&v.attackTime===0&&v.crashTime===0&&!v.boosting&&!v.blocking)).toBe(true);
  expect(Number.isInteger(R.score(s))).toBe(true);expect(R.score(s)).toBeGreaterThan(0);const frozen=JSON.stringify(s);R.advance(s,.25,{attackLeft:true,boost:true});expect(JSON.stringify(s)).toBe(frozen);
});

test('the score breakdown exposes the unchanged point values and sums exactly for every placement and cutoff',()=>{
  const R=load();
  for(let place=1;place<=6;place++)for(const dnf of [false,true]){
    const s=R.create();s.time=123.456;for(const r of s.racers)r.z=(6-r.id)*100;s.racers[0].z=650-place*100;
    const p=s.racers[0];p.combatHits=3;p.knockouts=2;p.tickets=7;p.dnf=dnf;const before=JSON.stringify(s),b=R.scoreBreakdown(s);
    expect(b.place).toBe(place);expect(b.finish).toBe([5000,4200,3500,2900,2400,2000][place-1]);expect(b.hits).toBe(225);expect(b.knockouts).toBe(1200);expect(b.tickets).toBe(350);
    expect(b.penalty).toBe(dnf?-1200:0);expect(b.timeBonus).toBe(Math.round((180-s.time)*15));
    expect(b.duels).toBe(0);
    const sum=b.finish+b.hits+b.knockouts+b.tickets+b.timeBonus+b.penalty+b.duels;
    expect(b.total).toBe(sum);expect(R.score(s)).toBe(sum);expect(JSON.stringify(s)).toBe(before);
  }
});

test('the time limit finishes an obstructed run and invalid controls remain finite',()=>{
  const R=load(),s=R.create();s.phase='racing';s.countdown=0;s.tick=360+180*120-1;s.time=180-1/120;
  R.advance(s,1/120,{steer:Infinity,brake:true,boost:'yes',attackLeft:{}});expect(s.phase).toBe('finished');expect(s.timedOut).toBe(true);expect(s.racers.every(r=>r.dnf)).toBe(true);finiteState(s);
});

test('the untouched starting grid supports a readable first right punch before rivals attack',()=>{
  const R=load(),s=R.create({seed:1});advance(R,s,3.6,{});advance(R,s,.3,{attackRight:true});
  expect(strikes(s).length).toBeGreaterThan(0);expect(strikes(s)[0].target).toBe(1);expect(s.racers[0].health).toBe(100);
});

function approachCheckpoint(s,line,playerDistance,rivalDistance){
  // Both riders decelerate from above cruising speed at the same rate. With
  // separate lanes, the different crossing fractions depend only on distance.
  for(const [id,distance] of [playerDistance,rivalDistance].entries()){
    const rider=s.racers[id];
    rider.z=line-distance;
    rider.x=id===0?-.55:.55;
    rider.speed=230;
    rider.boost=0;
    rider.boostTime=0;
    rider.boosting=false;
  }
}

test('the opening duel names a reachable rival and every later leg has its own checkpoint',()=>{
  const R=load();
  for(const seed of [1,16,987]){
    const s=R.create({seed,playerRacer:'dani-mo'});
    expect(s.duels.map(d=>d.checkpoint)).toEqual([5000,10000,15000]);
    expect(s.duels.map(d=>d.status)).toEqual(['active','upcoming','upcoming']);
    const first=s.duels[0],rival=s.racers[first.rivalId];
    expect(rival.human).toBe(false);
    expect(first.startGap).toBe(rival.z-s.racers[0].z);
    expect(first.startTime).toBe(0);
    expect(first.rivalId).toBe(1);
    expect(s.events.filter(e=>e.type==='duelStart')).toEqual([
      expect.objectContaining({leg:1,checkpoint:5000,rivalId:rival.id,status:'active',bonus:0,racer:0})
    ]);
    expect(R.create({seed,playerRacer:'dani-mo'}).duels).toEqual(s.duels);
  }
});

test('sub-step checkpoint order decides wins, losses and exact ties without an actor-order advantage',()=>{
  const R=load(),dt=R.constants.FIXED_DT;
  for(const [p,r,status] of [[.25,1.5,'won'],[1.5,.25,'lost'],[.75,.75,'tied']]){
    const s=fight(R);
    approachCheckpoint(s,5000,p,r);
    R.advance(s,dt,{});
    const first=s.duels[0];
    expect(first.status).toBe(status);
    expect(first.playerCross).toBeCloseTo(.6+p/(230-100*dt),9);
    expect(first.rivalCross).toBeCloseTo(.6+r/(230-100*dt),9);
    const reward=status==='won'?250:0;
    expect(first.bonus).toBe(reward);
    advance(R,s,.25);
    expect(R.scoreBreakdown(s).duels).toBe(reward);
    expect(s.events.filter(e=>e.type==='duelResult'&&e.leg===1)).toHaveLength(1);
  }
});

test('a rival can beat the player to the line before the next leg opens',()=>{
  const R=load(),s=fight(R);
  approachCheckpoint(s,5000,20,.5);
  R.advance(s,1/120,{});
  expect(s.duels[0]).toMatchObject({status:'lost',playerCross:null,bonus:0});
  expect(s.duels[1].status).toBe('upcoming');
  advance(R,s,.15);
  expect(s.duels[0].playerCross).toBeGreaterThan(s.duels[0].rivalCross);
  expect(s.duels[1]).toMatchObject({status:'active',rivalId:1});
  expect(s.events.filter(e=>e.type==='duelStart'&&e.leg===2)).toHaveLength(1);
});

test('the next leg can wait for a fair rival, accept a close defender or pass on a late offer',()=>{
  const R=load();
  for(const late of [false,true]){
    const s=fight(R);
    approachCheckpoint(s,5000,.4,600);
    R.advance(s,1/120,{});
    const next=s.duels[1];
    expect(next).toMatchObject({status:'seeking',rivalId:null,bonus:0});
    // With the original rival far behind, another rider can catch the pack.
    const challenger=s.racers[2];
    s.finishOrder=s.finishOrder.filter(id=>id!==challenger.id);
    challenger.finishTime=null;
    if(late)s.racers[0].z=8500;
    challenger.z=s.racers[0].z-40;
    challenger.crashTime=.1;
    R.advance(s,1/120,{});
    expect(next.rivalId).toBe(null);
    challenger.crashTime=0;
    R.advance(s,1/120,{});
    expect(next.status).toBe(late?'unavailable':'active');
    if(late)expect(next.rivalId).toBe(null);
    else {
      expect(next.rivalId).toBe(challenger.id);
      expect(next.startGap).toBeLessThan(0);
      expect(next.startGap).toBeGreaterThanOrEqual(-75);
    }
  }
});

test('the final duel uses the official finish times and never uses a projected time',()=>{
  const R=load();
  for(const [p,r,status] of [[.3,1.4,'won'],[1.4,.3,'lost'],[.75,.75,'tied'],[.3,24,'won']]){
    const s=fight(R);
    for(const line of [5000,10000]){
      approachCheckpoint(s,line,.3,1.4);
      R.advance(s,1/120,{});
    }
    expect(s.duels[2].status).toBe('active');
    approachCheckpoint(s,15000,p,r);
    R.advance(s,1/120,{});
    expect(s.phase).toBe('finished');
    const last=s.duels[2];
    expect(last.status).toBe(status);
    expect(last.playerCross).toBe(s.racers[0].finishTime);
    expect(last.rivalCross).toBe(r>2?null:s.racers[1].finishTime);
    const points=R.scoreBreakdown(s);
    expect(points.duels).toBe(500+(status==='won'?250:0));
    expect(points.total).toBe(points.finish+points.hits+points.knockouts+points.tickets+points.timeBonus+points.penalty+points.duels);
    expect(R.score(s)).toBe(points.total);
    R.advance(s,.25,{});
    expect(R.scoreBreakdown(s)).toEqual(points);
  }
});

test('cutoff retains earned points and expires open duels before projecting trailing finishers',()=>{
  const R=load(),s=fight(R);
  approachCheckpoint(s,5000,.2,1.2);
  R.advance(s,1/120,{});
  expect(s.duels[1].status).toBe('active');
  s.tick=360+180*120-1;
  s.time=180-1/120;
  R.advance(s,1/120,{});
  expect(s.timedOut).toBe(true);
  expect(s.duels.map(d=>d.status)).toEqual(['won','expired','expired']);
  expect(s.duels[1]).toMatchObject({playerCross:null,rivalCross:null,bonus:0});
  expect(R.scoreBreakdown(s)).toMatchObject({duels:250,penalty:-1200});
});

test('seeded complete races produce achievable rival fights, fair recovery and bounded final results',()=>{
  const R=load(),summary=[];let overlaps=0,racingFrames=0,reachableFrames=0;
  for(const seed of [1,2,3,4]){
    const s=R.create({seed});let frames=0;while(s.phase!=='finished'&&frames++<6000){
      R.advance(s,1/30,R.aiInput(s,0));if(s.phase!=='racing')continue;racingFrames++;
      if(R.attackTargets(s,0,-1).length+R.attackTargets(s,0,1).length)reachableFrames++;
      for(let a=0;a<6;a++)for(let b=a+1;b<6;b++){
        const first=s.racers[a],second=s.racers[b];if(first.finishTime===null&&second.finishTime===null&&!first.crashTime&&!second.crashTime&&Math.abs(first.x-second.x)<.18&&Math.abs(first.z-second.z)<18)overlaps++;
      }
    }
    expect(s.phase).toBe('finished');expect(s.timedOut).toBe(false);expect(s.time).toBeLessThan(150);expect(s.racers.every(r=>r.finishTime!==null&&r.finishTime<250)).toBe(true);finiteState(s);
    expect(s.racers.reduce((sum,r)=>sum+r.combatHits,0)).toBeGreaterThan(4);expect(s.finishOrder).toEqual(R.standings(s).map(r=>r.id));
    summary.push({seed,time:s.time,place:R.standings(s).findIndex(r=>r.id===0)+1,hits:s.racers[0].combatHits,knockouts:s.racers[0].knockouts,crashes:s.racers[0].crashes});
  }
  expect(summary.filter(r=>r.place<=3).length).toBeGreaterThanOrEqual(2);expect(overlaps).toBeLessThan(50);expect(reachableFrames/racingFrames).toBeGreaterThan(.12);
  console.log('Road Riot race audit: '+JSON.stringify({races:summary,overlaps,reachableFraction:reachableFrames/racingFrames}));
});
