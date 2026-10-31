import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import vm from 'node:vm';
const source=['physics','rules','ai'].map(name=>fs.readFileSync(new URL('../games/pool-'+name+'.js',import.meta.url),'utf8')).join('\n');
const load=()=>vm.runInNewContext(source+';({P:POOL_PHYSICS,R:POOL_RULES,A:POOL_AI})');
const ball=(id,x,y)=>({id,x,y,vx:0,vy:0,pocketed:false});
function state(balls){return{balls,turn:1,groups:['stripes','solids'],break:false,mode:'aiming',scores:[0,0],stats:[{shots:0,pots:0,fouls:0,run:0,bestRun:0},{shots:0,pots:0,fouls:0,run:0,bestRun:0}],calledPocket:null,ballInHand:false,winner:null,notice:'',playMode:'cpu',seed:145};}
function play(P,S,aim){const balls=S.balls.map(b=>({...b,...(b.id===0&&aim.placement?aim.placement:{})}));return P.simulate(balls,aim);}

test('CPU converts a clear ghost-ball shot into an actual pot without scratching',()=>{
  const {P,A}=load(),S=state([ball(0,500,360),ball(1,500,240),ball(8,800,350),ball(9,850,250)]);
  const aim=A.choose(S,'hard'),result=play(P,S,aim);
  expect(result.shot.first).toBe(1);expect(result.shot.potted).toContainEqual({id:1,pocket:1});expect(result.shot.potted.some(p=>p.id===0)).toBe(false);
});

test('CPU respects assigned groups instead of attacking a nearer opponent ball',()=>{
  const {P,A}=load(),S=state([ball(0,500,360),ball(1,500,240),ball(8,800,350),ball(9,480,310)]);
  const aim=A.choose(S,'hard'),result=play(P,S,aim);
  expect(result.shot.first).toBe(1);expect(aim.power).toBeGreaterThan(0);expect(aim.power).toBeLessThanOrEqual(1);
});

test('ball in hand chooses a legal position and produces a genuine pot',()=>{
  const {P,A}=load(),S=state([ball(0,280,300),ball(1,500,240),ball(8,800,350),ball(9,850,250)]);S.ballInHand=true;
  const aim=A.choose(S,'hard');expect(aim.placement).toBeTruthy();expect(P.validPlacement(S.balls,aim.placement.x,aim.placement.y)).toBe(true);
  const result=play(P,S,aim);expect(result.shot.first).toBe(1);expect(result.shot.potted.some(p=>p.id===1)).toBe(true);expect(result.shot.potted.some(p=>p.id===0)).toBe(false);
});

test('CPU explicitly calls the eight pocket and its simulated pot matches the call',()=>{
  const {P,A,R}=load(),S=state([ball(0,500,360),ball(8,500,240),ball(9,850,250)]);
  const aim=A.choose(S,'hard');expect(Number.isInteger(aim.calledPocket)).toBe(true);S.calledPocket=aim.calledPocket;
  const attempt=R.prepare(S),result=play(P,S,aim);Object.assign(attempt,result.shot);S.balls=result.balls;R.resolve(S,attempt);
  expect(S.winner).toBe(1);expect(S.mode).toBe('over');
});

test('break planner produces a legal full-rack break without assuming group ownership',()=>{
  const {P,A,R}=load(),S=state(P.rack(145));S.break=true;S.groups=[null,null];
  const aim=A.choose(S,'normal'),attempt=R.prepare(S),result=play(P,S,aim);Object.assign(attempt,result.shot);S.balls=result.balls;
  const outcome=R.resolve(S,attempt);expect(outcome.foul).toBe(false);expect(S.groups).toEqual([null,null]);expect(result.settled).toBe(true);
});

test('seeded CPU choices repeat exactly and do not mutate the live table',()=>{
  const {A}=load(),S=state([ball(0,500,360),ball(1,500,240),ball(8,800,350),ball(9,850,250)]),before=JSON.stringify(S);
  const first=A.choose(S,'hustler'),second=A.choose(S,'hard');expect(first).toEqual(second);expect(JSON.stringify(S)).toBe(before);
  expect(A.choose(S,'easy').angle).not.toBe(first.angle);expect(A.choose(S,'normal').power).not.toBe(first.power);
});

test('a snookered CPU finds a finite bank or safety instead of stalling',()=>{
  const {P,A}=load(),S=state([ball(0,350,300),ball(1,850,300),ball(8,650,450),ball(9,400,300)]);
  const aim=A.choose(S,'hard');expect(Number.isFinite(aim.angle)).toBe(true);expect(aim.power).toBeGreaterThan(0);expect(aim.power).toBeLessThanOrEqual(1);
  const result=play(P,S,aim);expect(result.settled).toBe(true);expect(result.shot.first).toBe(1);
});

test('easy normal and hard produce finite bounded controls across scattered layouts',()=>{
  const {P,A}=load();
  for(const difficulty of ['easy','normal','hard'])for(const seed of [1,42]){
    const initial=P.simulate(P.rack(seed),{angle:0,power:.93}),S=state(initial.balls);S.groups=[null,null];S.seed=seed;
    const aim=A.choose(S,difficulty);expect(Number.isFinite(aim.angle)).toBe(true);expect(aim.power).toBeGreaterThan(0);expect(aim.power).toBeLessThanOrEqual(1);
    expect(aim.calledPocket===null||Number.isInteger(aim.calledPocket)&&aim.calledPocket>=0&&aim.calledPocket<6).toBe(true);
  }
});
