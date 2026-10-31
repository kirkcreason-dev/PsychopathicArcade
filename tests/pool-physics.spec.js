import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../games/pool-physics.js',import.meta.url),'utf8');
const physics=()=>vm.runInNewContext(source+';POOL_PHYSICS');
const ball=(id,x,y,vx=0,vy=0)=>({id,x,y,vx,vy,pocketed:false});
const energy=balls=>balls.reduce((n,b)=>n+b.vx*b.vx+b.vy*b.vy,0);
function advance(p,balls,time,shot=p.createShot(),dt=1/60){for(let t=0;t<time-1e-8;t+=dt)p.step(balls,Math.min(dt,time-t),shot);return shot;}

test('seeded rack has sixteen unique balls, eight centered and opposite rear groups',()=>{
  const p=physics(),a=p.rack('showtime'),b=p.rack('showtime'),other=p.rack('carnival');
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));expect(JSON.stringify(a)).not.toBe(JSON.stringify(other));
  expect(a.map(b=>b.id)).toEqual(Array.from({length:16},(_,i)=>i));
  const eight=a.find(b=>b.id===8);expect(eight.y).toBe(300);
  const back=a.filter(b=>b.x>760).sort((a,b)=>a.y-b.y);expect(back).toHaveLength(5);
  expect(back[0].id<8).not.toBe(back[4].id<8);
  for(let i=0;i<a.length;i++)for(let j=i+1;j<a.length;j++)expect(Math.hypot(a[i].x-a[j].x,a[i].y-a[j].y)).toBeGreaterThanOrEqual(2*p.R);
});

test('head-on impact transfers velocity without energy gain or tunneling at full speed',()=>{
  const p=physics(),balls=[ball(0,300,300,1500),ball(4,340,300)],before=energy(balls),shot=p.createShot();
  p.step(balls,1/30,shot);
  expect(shot.first).toBe(4);expect(balls[0].vx).toBeLessThan(20);expect(balls[1].vx).toBeGreaterThan(1400);
  expect(balls[0].x).toBeLessThan(balls[1].x);expect(energy(balls)).toBeLessThanOrEqual(before);
  expect(Math.hypot(balls[0].x-balls[1].x,balls[0].y-balls[1].y)).toBeGreaterThanOrEqual(25-1e-6);
});

test('glancing collision preserves tangential motion and creates two sensible outgoing paths',()=>{
  const p=physics(),balls=[ball(0,300,300,700),ball(2,345,316)],shot=p.createShot(),before=energy(balls);
  advance(p,balls,.08,shot);
  expect(shot.first).toBe(2);expect(balls[0].vy).toBeLessThan(-100);expect(balls[1].vy).toBeGreaterThan(100);
  expect(balls[0].vx).toBeGreaterThan(100);expect(balls[1].vx).toBeGreaterThan(100);expect(energy(balls)).toBeLessThanOrEqual(before);
});

test('a very thin grazing impact is caught even when neither fixed-step endpoint overlaps',()=>{
  const p=physics(),balls=[ball(0,300,300,1500),ball(6,308,324.99)],shot=p.createShot();
  p.step(balls,1/120,shot);
  expect(shot.first).toBe(6);expect(balls[1].vy).toBeGreaterThan(1);
  expect(energy(balls)).toBeLessThanOrEqual(1500*1500);
});

test('continuous contact identifies the earliest ball regardless of array order',()=>{
  const p=physics(),balls=[ball(0,280,300,1500),ball(9,350,300),ball(3,315,300)],shot=p.createShot();
  p.step(balls,.1,shot);expect(shot.first).toBe(3);expect(shot.firstTime).toBeLessThan(.01);
});

test('all six pocket mouths accept a directly aimed ball and pot exactly once',()=>{
  const p=physics();
  for(let i=0;i<p.pockets.length;i++){
    const hole=p.pockets[i],angle=Math.atan2(hole.y-300,hole.x-500);
    const balls=[ball(0,500,300,Math.cos(angle)*900,Math.sin(angle)*900)],shot=p.createShot();
    advance(p,balls,2,shot);expect(balls[0].pocketed,`pocket ${i}`).toBe(true);expect(shot.potted).toEqual([{id:0,pocket:i}]);
    advance(p,balls,1,shot);expect(shot.potted).toHaveLength(1);
  }
});

test('cushions rebound, jaw near-misses deflect, and pocket openings never act like flat walls',()=>{
  const p=physics(),plain=[ball(0,300,130,0,-500)],plainShot=p.createShot();
  advance(p,plain,.1,plainShot);expect(plain[0].vy).toBeGreaterThan(0);expect(plainShot.rails.map(r=>r.rail)).toContain('top-left');
  const jaw=[ball(0,467,140,0,-600)],jawShot=p.createShot();advance(p,jaw,.1,jawShot);
  expect(jaw[0].vx).toBeGreaterThan(0);expect(jawShot.rails.length).toBeGreaterThan(0);
  const mouth=[ball(0,500,130,0,-500)],mouthShot=p.createShot();advance(p,mouth,.1,mouthShot);
  expect(mouth[0].pocketed).toBe(true);expect(mouthShot.rails).toHaveLength(0);
});

test('rail-after-contact is chronological and rails retain unique ball identifiers',()=>{
  const p=physics(),balls=[ball(0,300,150,0,-500),ball(1,300,300)],shot=p.createShot();
  advance(p,balls,.2,shot);expect(shot.rails).toEqual([{id:0,rail:'top-left'}]);expect(shot.railAfterContact).toBe(false);
  balls[0].x=300;balls[0].y=300;balls[0].vx=900;balls[0].vy=0;balls[1].x=340;balls[1].y=300;
  advance(p,balls,1,shot);expect(shot.first).toBe(1);expect(shot.railAfterContact).toBe(true);
  expect(shot.rails.some(r=>r.id===1&&r.rail==='right')).toBe(true);
  expect(new Set(shot.rails.map(r=>r.id+':'+r.rail)).size).toBe(shot.rails.length);
});

test('a full-power break settles within twenty seconds, stays finite and does not overlap',()=>{
  const p=physics();
  for(const seed of ['juggalo',5,107]){
    const input=p.rack(seed),before=JSON.stringify(input),result=p.simulate(input,{angle:.004,power:1});
    expect(result.settled).toBe(true);expect(result.elapsed).toBeLessThan(20);expect(result.shot.first).not.toBeNull();expect(result.shot.solverLimit||0).toBe(0);
    expect(JSON.stringify(input)).toBe(before);
    const live=result.balls.filter(b=>!b.pocketed);
    for(const b of live){expect(Number.isFinite(b.x+b.y+b.vx+b.vy)).toBe(true);expect(b.x).toBeGreaterThanOrEqual(p.B.left-1e-6);expect(b.x).toBeLessThanOrEqual(p.B.right+1e-6);expect(b.y).toBeGreaterThanOrEqual(p.B.top-1e-6);expect(b.y).toBeLessThanOrEqual(p.B.bottom+1e-6);}
    for(let i=0;i<live.length;i++)for(let j=i+1;j<live.length;j++)expect(Math.hypot(live[i].x-live[j].x,live[i].y-live[j].y)).toBeGreaterThanOrEqual(25-1e-4);
  }
});

test('fixed steps give identical results across render frame groupings',()=>{
  const p=physics(),a=[ball(0,300,300,1200),ball(1,450,315)],b=a.map(b=>({...b})),sa=p.createShot(),sb=p.createShot();
  advance(p,a,3,sa,1/60);advance(p,b,3,sb,1/30);
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));expect(sa.first).toBe(sb.first);expect(JSON.stringify(sa.potted)).toBe(JSON.stringify(sb.potted));
  const r=p.rack(13);expect(JSON.stringify(p.simulate(r,{angle:.01,power:.8}))).toBe(JSON.stringify(p.simulate(r,{angle:.01,power:.8})));
});

test('placement rejects balls, pockets, rails and non-finite coordinates but ignores the old cue',()=>{
  const p=physics(),balls=[ball(0,300,300),ball(1,450,300),{...ball(2,500,300),pocketed:true}];
  expect(p.validPlacement(balls,300,300)).toBe(true);expect(p.validPlacement(balls,500,300)).toBe(true);
  for(const [x,y] of [[450,300],[470,300],[70,300],[500,90],[85,100],[NaN,300],[300,Infinity]])expect(p.validPlacement(balls,x,y)).toBe(false);
});

test('aim trace predicts the same first ball, pocket and finite cushion used by physics',()=>{
  const p=physics(),balls=[ball(0,300,300),ball(5,500,300)],hit=p.trace(balls,0);
  expect(hit.type).toBe('ball');expect(hit.id).toBe(5);expect(hit.x).toBeCloseTo(475,8);expect(hit.normal.x).toBeCloseTo(-1,8);
  const rail=p.trace([ball(0,300,300)],-Math.PI/2);expect(rail.type).toBe('cushion');expect(rail.y).toBeCloseTo(97.5,8);
  const pocket=p.trace([ball(0,500,300)],-Math.PI/2);expect(pocket.type).toBe('pocket');expect(pocket.pocket).toBe(1);
});

test('zero shots, bad frame times and long background frames cannot destabilize the table',()=>{
  const p=physics(),balls=p.rack(1),shot=p.createShot(),before=JSON.stringify(balls);
  expect(p.strike(balls,0,0)).toBe(false);p.step(balls,NaN,shot);p.step(balls,-1,shot);expect(JSON.stringify(balls)).toBe(before);
  p.strike(balls,0,1);p.step(balls,500,shot);expect(shot.elapsed).toBeCloseTo(.1,8);expect(p.moving(balls)).toBe(true);
});
