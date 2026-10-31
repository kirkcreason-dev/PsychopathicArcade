import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import vm from 'node:vm';
const source=['physics','rules'].map(name=>fs.readFileSync(new URL('../games/pool-'+name+'.js',import.meta.url),'utf8')).join('\n');
const load=()=>vm.runInNewContext(source+';({P:POOL_PHYSICS,R:POOL_RULES})');
function state(P){return{balls:P.rack(73),turn:0,groups:[null,null],break:true,mode:'rolling',scores:[0,0],stats:[{shots:0,pots:0,fouls:0,run:0,bestRun:0},{shots:0,pots:0,fouls:0,run:0,bestRun:0}],calledPocket:null,ballInHand:false,winner:null,notice:'',playMode:'cpu',seed:73};}
const pot=(id,pocket=1)=>({id,pocket});
const shot=(R,S,events={})=>Object.assign(R.prepare(S),{first:1,railAfterContact:true},events);
const clearGroup=(S,g)=>S.balls.forEach(b=>{if(g==='solids'?b.id>=1&&b.id<=7:b.id>=9)b.pocketed=true;});

test('group classification and targets separate open, assigned, eight and practice play',()=>{
  const {P,R}=load(),S=state(P);S.break=false;
  expect([0,1,7,8,9,15,16].map(R.group)).toEqual([null,'solids','solids',null,'stripes','stripes',null]);
  expect(R.targets(S)).toHaveLength(14);expect(R.targets(S)).not.toContain(8);
  S.groups=['solids','stripes'];expect(R.remaining(S)).toEqual([1,2,3,4,5,6,7]);
  clearGroup(S,'solids');expect(R.eligible8(S)).toBe(true);expect(R.targets(S)).toEqual([8]);
  S.playMode='practice';expect(R.targets(S)).toEqual([8,9,10,11,12,13,14,15]);
});

test('break pots retain the turn but never assign groups; four distinct rails legalize a dry break',()=>{
  const {P,R}=load(),S=state(P);R.resolve(S,shot(R,S,{potted:[pot(1),pot(10)]}));
  expect(S.turn).toBe(0);expect(S.groups).toEqual([null,null]);expect(S.break).toBe(false);expect(S.scores[0]).toBe(225);
  const dry=state(P);R.resolve(dry,shot(R,dry,{rails:[1,2,3,4].map(id=>({id,rail:'right'}))}));
  expect(dry.turn).toBe(1);expect(dry.ballInHand).toBe(false);
  const soft=state(P);const result=R.resolve(soft,shot(R,soft,{rails:['top','right','bottom','left'].map(rail=>({id:1,rail}))}));
  expect(result.foul).toBe(true);expect(soft.turn).toBe(1);expect(soft.ballInHand).toBe(true);
});

test('break eight is safely respotted, keeps the turn, and scratch does not lose the rack',()=>{
  const {P,R}=load(),S=state(P);S.balls.find(b=>b.id===2).x=715;S.balls.find(b=>b.id===2).y=300;
  R.resolve(S,shot(R,S,{first:8,potted:[pot(8)]}));
  const eight=S.balls.find(b=>b.id===8);expect(eight.pocketed).toBe(false);expect(R.placementClear(S,eight.x,eight.y,8)).toBe(true);expect(S.turn).toBe(0);expect(S.winner).toBeNull();
  const scratch=state(P);R.resolve(scratch,shot(R,scratch,{first:8,potted:[pot(8),pot(0)]}));
  expect(scratch.mode).toBe('aiming');expect(scratch.winner).toBeNull();expect(scratch.turn).toBe(1);expect(scratch.ballInHand).toBe(true);
  expect(scratch.balls.filter(b=>[0,8].includes(b.id)).every(b=>!b.pocketed)).toBe(true);
});

test('first legal nonbreak pot assigns a mixed shot deterministically; fouls cannot claim a group',()=>{
  const {P,R}=load(),S=state(P);S.break=false;
  R.resolve(S,shot(R,S,{first:1,potted:[pot(10),pot(2)]}));
  expect(S.groups).toEqual(['stripes','solids']);expect(S.scores).toEqual([100,0]);expect(S.turn).toBe(0);
  const foul=state(P);foul.break=false;R.resolve(foul,shot(R,foul,{potted:[pot(2),pot(0)]}));
  expect(foul.groups).toEqual([null,null]);expect(foul.scores).toEqual([0,0]);expect(foul.turn).toBe(1);
});

test('wrong first, no contact, no rail after contact and scratch are separate fouls',()=>{
  const {P,R}=load();
  for(const [change,reason] of [[{first:9},'Wrong ball first'],[{first:null},'No object ball hit'],[{railAfterContact:false,rails:[{id:0,rail:'top'}]},'No rail after contact'],[{potted:[pot(0)]},'Scratch']]){
    const S=state(P);S.break=false;S.groups=['solids','stripes'];const result=R.resolve(S,shot(R,S,change));
    expect(result.reason).toBe(reason);expect(S.turn).toBe(1);expect(S.ballInHand).toBe(true);expect(S.stats[0].fouls).toBe(1);expect(S.scores[0]).toBe(0);
    const cue=S.balls.find(b=>b.id===0);expect(cue.pocketed).toBe(false);expect(P.validPlacement(S.balls,cue.x,cue.y)).toBe(true);
  }
});

test('an object pot satisfies the rail requirement; opponent-only pot passes the turn',()=>{
  const {P,R}=load(),S=state(P);S.break=false;S.groups=['solids','stripes'];
  const result=R.resolve(S,shot(R,S,{railAfterContact:false,potted:[pot(9)]}));
  expect(result.foul).toBe(false);expect(S.turn).toBe(1);expect(S.scores).toEqual([0,0]);expect(S.balls.find(b=>b.id===9).pocketed).toBe(true);
});

test('normal legal pots build a bounded run bonus and a miss resets the current run',()=>{
  const {P,R}=load(),S=state(P);S.break=false;S.groups=['solids','stripes'];
  for(const id of [1,2,3])R.resolve(S,shot(R,S,{first:id,potted:[pot(id)]}));
  expect(S.scores[0]).toBe(375);expect(S.stats[0].run).toBe(3);expect(S.stats[0].bestRun).toBe(3);
  R.resolve(S,shot(R,S,{first:4}));expect(S.stats[0].run).toBe(0);expect(S.stats[0].bestRun).toBe(3);expect(S.turn).toBe(1);
});

test('called eight wins only after the group was clear before the shot',()=>{
  const {P,R}=load(),S=state(P);S.break=false;S.groups=['solids','stripes'];clearGroup(S,'solids');S.calledPocket=4;
  const result=R.resolve(S,shot(R,S,{first:8,potted:[pot(8,4)]}));
  expect(result.winner).toBe(0);expect(S.winner).toBe(0);expect(S.mode).toBe('over');expect(S.scores[0]).toBe(1000);
  const early=state(P);early.break=false;early.groups=['solids','stripes'];clearGroup(early,'solids');early.balls.find(b=>b.id===7).pocketed=false;early.calledPocket=4;
  const attempt=shot(R,early,{first:7,potted:[pot(7),pot(8,4)]});R.resolve(early,attempt);
  expect(early.winner).toBe(1);expect(attempt.result.reason).toBe('Eight ball too early');
});

test('scratch with eight, uncalled eight and wrong called pocket all lose',()=>{
  const {P,R}=load();
  for(const [calledPocket,events] of [[1,[pot(8,1),pot(0)]],[null,[pot(8,1)]],[3,[pot(8,1)]]]){
    const S=state(P);S.break=false;S.groups=['solids','stripes'];clearGroup(S,'solids');S.calledPocket=calledPocket;
    R.resolve(S,shot(R,S,{first:8,potted:events}));expect(S.winner).toBe(1);expect(S.mode).toBe('over');
  }
});

test('eight first on an open table is a foul, while an empty group can still finish',()=>{
  const {P,R}=load(),S=state(P);S.break=false;
  R.resolve(S,shot(R,S,{first:8}));expect(S.ballInHand).toBe(true);expect(S.stats[0].fouls).toBe(1);
  const rare=state(P);R.resolve(rare,shot(R,rare,{potted:[1,2,3,4,5,6,7].map(id=>pot(id))}));
  expect(rare.groups).toEqual(['solids','stripes']);expect(R.targets(rare)).toEqual([8]);rare.calledPocket=1;
  R.resolve(rare,shot(R,rare,{first:8,potted:[pot(8)]}));expect(rare.winner).toBe(0);
});

test('practice accepts any order, recovers scratches and ends without a competitive winner',()=>{
  const {P,R}=load(),S=state(P);S.playMode='practice';S.break=false;
  R.resolve(S,shot(R,S,{first:8,potted:[pot(8)]}));expect(S.mode).toBe('aiming');expect(S.turn).toBe(0);expect(S.scores[0]).toBe(100);
  R.resolve(S,shot(R,S,{first:null,railAfterContact:false,potted:[pot(0)]}));expect(S.ballInHand).toBe(true);expect(S.turn).toBe(0);
  R.resolve(S,shot(R,S,{first:1,potted:[1,2,3,4,5,6,7,9,10,11,12,13,14,15].map(id=>pot(id))}));
  expect(S.mode).toBe('over');expect(S.winner).toBeNull();expect(S.scores[0]).toBe(1500);expect(S.stats[0].pots).toBe(15);
});

test('resolving a duplicate shot cannot double-score or advance the turn again',()=>{
  const {P,R}=load(),S=state(P);S.break=false;const attempt=shot(R,S,{potted:[pot(3),pot(3)]});
  const first=R.resolve(S,attempt),snapshot=JSON.stringify(S),second=R.resolve(S,attempt);
  expect(second).toBe(first);expect(JSON.stringify(S)).toBe(snapshot);expect(S.stats[0].shots).toBe(1);expect(S.stats[0].pots).toBe(1);
});
