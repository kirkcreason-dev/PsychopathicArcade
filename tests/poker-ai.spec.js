import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import vm from 'node:vm';
const source=['rules','ai'].map(name=>fs.readFileSync(new URL('../games/poker-'+name+'.js',import.meta.url),'utf8')).join('\n');
const load=()=>vm.runInNewContext(source+';({R:POKER_RULES,A:POKER_AI})');
const random=seed=>()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
const card=s=>({T:10,J:11,Q:12,K:13,A:14}[s[0]]||Number(s[0]))-2+'cdhs'.indexOf(s[1])*13;
const cards=text=>text.split(' ').map(card);
function table(R,seed=1){const S=R.create();R.startHand(S,{rng:random(seed)});return S;}

test('CPU samples only its own cards and public board, never the opponent or private deck',()=>{
  const {R,A}=load(),S=table(R),v=R.view(S,S.turn);
  Object.defineProperty(v.players[1-v.seat],'hand',{get(){throw new Error('Opponent hand was read');}});
  for(const key of ['deck','rng','deckIndex'])Object.defineProperty(v,key,{get(){throw new Error('Private field was read');}});
  const action=A.choose(v,'normal',{rng:random(2)});expect(R.act(S,S.turn,action)).toBe(true);
});

test('CPU equity recognizes a board tie and an unbeatable made hand',()=>{
  const {R,A}=load(),v=R.view(table(R),0);v.board=cards('Ts Js Qs Ks As');v.players[0].hand=cards('2c 3d');
  expect(A.equity(v,20,random(7))).toBe(.5);
  v.board=cards('Ts Js Qs Ks 2c');v.players[0].hand=cards('As 3d');expect(A.equity(v,20,random(7))).toBe(1);
});

test('CPU returns deterministic legal actions for injected randomness without mutating the view',()=>{
  const {R,A}=load(),S=table(R,8),v=R.view(S,S.turn),before=JSON.stringify(v);
  const a=A.choose(v,'hard',{rng:random(98)}),b=A.choose(v,'hard',{rng:random(98)});expect(a).toEqual(b);expect(JSON.stringify(v)).toBe(before);expect(R.act(S,S.turn,a)).toBe(true);
});

test('all difficulties choose legal actions through complete small-stack matches',()=>{
  const {R,A}=load();
  for(const difficulty of ['easy','normal','hard']){
    const S=R.create({stacks:[120,120]}),rng=random(100);let count=0;
    while(S.matchWinner===null&&S.handNo<40){R.startHand(S,{rng});while(S.stage!=='over'&&count++<300){const action=A.choose(R.view(S,S.turn),difficulty,{rng});expect(action).toBeTruthy();expect(R.act(S,S.turn,action)).toBe(true);expect(S.players[0].stack+S.players[1].stack+S.pot).toBe(240);}}
    expect(S.matchWinner).not.toBeNull();expect(count).toBeLessThan(300);
  }
});

test('CPU declines an inactive turn and its sample budget is capped',()=>{
  const {R,A}=load(),S=table(R),v=R.view(S,1-S.turn);expect(A.choose(v)).toBeNull();
  const mine=R.view(S,S.turn);let calls=0;A.equity(mine,100000,()=>{calls++;return .4;});expect(calls).toBe(48*7);
});
