import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const source=fs.readFileSync(new URL('../games/poker-rules.js',import.meta.url),'utf8');
const load=()=>vm.runInNewContext(source+';POKER_RULES',{crypto:webcrypto});
const card=s=>({T:10,J:11,Q:12,K:13,A:14}[s[0]]||Number(s[0]))-2+'cdhs'.indexOf(s[1])*13;
const cards=text=>text.split(' ').map(card);
const deck=prefix=>{const first=typeof prefix==='string'?cards(prefix):prefix;return [...first,...Array.from({length:52},(_,i)=>i).filter(c=>!first.includes(c))];};
const random=seed=>()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
function begin(R,options={},prefix=[]){const s=R.create(options);expect(R.startHand(s,{deck:deck(prefix)})).toBe(true);return s;}
const step=(R,S,type,amount)=>{expect(R.act(S,S.turn,{type,...(amount===undefined?{}:{amount})})).toBe(true);};
function invariant(S){
  expect(S.players[0].stack+S.players[1].stack+S.pot).toBe(S.totalChips);
  for(const p of S.players){expect(Number.isSafeInteger(p.stack)&&p.stack>=0).toBe(true);expect(p.bet).toBeGreaterThanOrEqual(0);expect(p.contributed).toBeGreaterThanOrEqual(p.bet);}
  if(S.stage!=='over')expect(S.players.reduce((n,p)=>n+p.contributed,0)).toBe(S.pot);
}

test('all hand categories and best-five kickers use standard poker ordering',()=>{
  const R=load(),hands=['Ac Kd Qh 9s 3c','Ac Ad Qh 9s 3c','Ac Ad Qh Qs 3c','Ac Ad Ah 9s 3c','2c 3d 4h 5s 6c','Ac Jc 9c 5c 3c','Ac Ad Ah 9s 9c','Ac Ad Ah As 3c','9c Tc Jc Qc Kc'];
  expect(hands.map(h=>R.evaluate(cards(h)).rank)).toEqual([0,1,2,3,4,5,6,7,8]);
  for(let i=1;i<hands.length;i++)expect(R.compare(R.evaluate(cards(hands[i])),R.evaluate(cards(hands[i-1])))).toBe(1);
  expect(R.evaluate(cards('Ac Ad Kc Kd Qh Qs 2c')).kickers).toEqual([14,13,12]);
  expect(R.evaluate(cards('Ac Ad Ah Kc Kd Kh 2c')).kickers).toEqual([14,13]);
  expect(R.evaluate(cards('Ac 2d 3h 4s 5c Qd Jh')).kickers).toEqual([5]);
  expect(R.compare(R.evaluate(cards('Ac 2d 3h 4s 5c')),R.evaluate(cards('2c 3d 4h 5s 6c')))).toBe(-1);
  expect(R.evaluate(cards('Ac Kc Qc Jc Tc 2d 3s')).name).toBe('Royal flush');
  expect(R.evaluate(cards('Ac Kc Qc 9c 8c 3c 2c')).best5).toHaveLength(5);
});

test('seven-card evaluation compares every kicker and can play the board',()=>{
  const R=load(),board=cards('Ac Ad 9h 9s 3c');
  expect(R.compare(R.evaluate([...cards('Kh 2d'),...board]),R.evaluate([...cards('Qh Jd'),...board]))).toBe(1);
  const royal=cards('Ts Js Qs Ks As');expect(R.compare(R.evaluate([...cards('2c 2d'),...royal]),R.evaluate([...cards('Ah Kd'),...royal]))).toBe(0);
  expect(()=>R.evaluate(cards('Ac Ac 2c 3c 4c'))).toThrow();expect(()=>R.evaluate(cards('Ac Kd'))).toThrow();
});

test('button is the small blind, deals last, and a limp preserves the big blind option',()=>{
  const R=load(),S=begin(R,{},'2c Ac 3c Ad');
  expect(S.players[0].hand).toEqual(cards('Ac Ad'));expect(S.players[1].hand).toEqual(cards('2c 3c'));
  expect(S.players.map(p=>p.stack)).toEqual([990,980]);expect(S.turn).toBe(0);expect(S.pot).toBe(30);
  expect(R.legal(S).minRaiseTo).toBe(40);step(R,S,'call');expect(S.stage).toBe('preflop');expect(S.turn).toBe(1);expect(R.legal(S).canCheck).toBe(true);expect(R.legal(S).canRaise).toBe(true);
  step(R,S,'check');expect(S.stage).toBe('flop');expect(S.turn).toBe(1);expect(S.board).toHaveLength(3);expect(S.deckIndex).toBe(8);expect(S.pot).toBe(40);invariant(S);
});

test('each street burns a card and nondealer acts first until river showdown',()=>{
  const R=load(),S=begin(R,{dealer:1},'2c 3c 4c 5c 6c 7c 8c 9c Tc Jc Qc Kc');
  step(R,S,'call');step(R,S,'check');expect(S.board).toEqual(cards('7c 8c 9c'));expect(S.turn).toBe(0);
  step(R,S,'check');step(R,S,'check');expect(S.board).toEqual(cards('7c 8c 9c Jc'));expect(S.turn).toBe(0);
  step(R,S,'check');step(R,S,'check');expect(S.board).toEqual(cards('7c 8c 9c Jc Kc'));expect(S.turn).toBe(0);
  step(R,S,'check');step(R,S,'check');expect(S.stage).toBe('over');expect(S.result.kind).toBe('showdown');expect(S.burned).toEqual(cards('6c Tc Qc'));expect(S.deckIndex).toBe(12);invariant(S);
});

test('raise-to minimum follows the last full increment and rejects invalid actions atomically',()=>{
  const R=load(),S=begin(R),before=JSON.stringify(S);
  for(const [seat,action] of [[1,{type:'call'}],[0,{type:'check'}],[0,{type:'raise',amount:39}],[0,{type:'raise',amount:Infinity}],[0,{type:'raise',amount:40.5}],[0,{type:'raise',amount:1001}],[0,{type:'dance'}]]){expect(R.act(S,seat,action)).toBe(false);expect(JSON.stringify(S)).toBe(before);}
  step(R,S,'raise',60);expect(S.lastRaise).toBe(40);expect(R.legal(S).minRaiseTo).toBe(100);step(R,S,'call');
  expect(R.legal(S).minRaiseTo).toBe(20);step(R,S,'raise',20);expect(R.act(S,S.turn,{type:'raise',amount:30})).toBe(false);step(R,S,'raise',50);expect(S.lastRaise).toBe(30);expect(R.legal(S).minRaiseTo).toBe(80);step(R,S,'fold');invariant(S);
});

test('a short all-in raise is legal but does not change the minimum or reopen betting',()=>{
  const R=load(),S=begin(R,{stacks:[1000,150]});step(R,S,'raise',100);expect(S.lastRaise).toBe(80);step(R,S,'allin');
  expect(S.currentBet).toBe(150);expect(S.lastRaise).toBe(80);expect(S.raiseRights[0]).toBe(false);expect(R.legal(S).canRaise).toBe(false);expect(R.legal(S).canAllIn).toBe(false);expect(R.legal(S).callAmount).toBe(50);
  const before=JSON.stringify(S);expect(R.act(S,0,{type:'raise',amount:230})).toBe(false);expect(JSON.stringify(S)).toBe(before);step(R,S,'call');expect(S.stage).toBe('over');expect(S.board).toHaveLength(5);invariant(S);
});

test('an under-minimum raise is accepted only for the entire remaining stack',()=>{
  const R=load(),S=begin(R,{stacks:[30,1000]});expect(R.legal(S).canRaise).toBe(false);expect(R.legal(S).canAllIn).toBe(true);
  expect(R.act(S,0,{type:'raise',amount:25})).toBe(false);step(R,S,'raise',30);expect(S.players[0].allIn).toBe(true);expect(S.lastRaise).toBe(20);step(R,S,'call');expect(S.stage).toBe('over');expect(S.result.pot).toBe(60);invariant(S);
});

test('unmatched overbets are refunded on short calls and folds, without a side pot',()=>{
  const R=load(),S=begin(R,{stacks:[1000,40]});step(R,S,'allin');expect(R.legal(S).callAmount).toBe(20);step(R,S,'call');
  expect(S.result.refunds).toEqual([960,0]);expect(S.result.pot).toBe(80);expect(S.result.payouts.reduce((a,b)=>a+b,0)).toBe(80);invariant(S);
  const folded=begin(R);step(R,folded,'allin');step(R,folded,'fold');expect(folded.players.map(p=>p.stack)).toEqual([1020,980]);expect(folded.result.refunds).toEqual([980,0]);expect(folded.result.pot).toBe(40);expect(folded.result.hands).toEqual([null,null]);invariant(folded);
});

test('short blind all-ins run out when no opponent decision remains and preserve a pending call otherwise',()=>{
  const R=load(),shortSB=begin(R,{stacks:[5,1995]});expect(shortSB.stage).toBe('over');expect(shortSB.result.refunds).toEqual([0,15]);expect(shortSB.result.pot).toBe(10);invariant(shortSB);
  const shortBB=begin(R,{stacks:[1985,15]});expect(shortBB.stage).toBe('preflop');expect(shortBB.turn).toBe(0);expect(R.legal(shortBB).callAmount).toBe(5);expect(R.legal(shortBB).canRaise).toBe(false);step(R,shortBB,'call');expect(shortBB.result.pot).toBe(30);invariant(shortBB);
});

test('ties split the matched pot and odd chips go left of the dealer',()=>{
  const R=load(),S=begin(R,{},'2c 3d 4c 5d 6c Ts Js Qs 7c Ks 8c As');step(R,S,'allin');step(R,S,'call');
  expect(S.result.handWinner).toBeNull();expect(S.result.payouts).toEqual([1000,1000]);expect(S.players.map(p=>p.stack)).toEqual([1000,1000]);expect(S.matchWinner).toBeNull();
  expect(R.splitPot(27,[0,1],0)).toEqual([13,14]);expect(R.splitPot(27,[0,1],1)).toEqual([14,13]);invariant(S);
});

test('a whole-stack showdown ends the match and cannot deal or act afterward',()=>{
  const R=load(),S=begin(R,{},'Kc Ac Kd Ad 2c 3c 4d 7h 2d 8s 2h 9c');step(R,S,'allin');step(R,S,'call');
  expect(S.matchWinner).toBe(0);expect(S.players.map(p=>p.stack)).toEqual([2000,0]);expect(R.startHand(S)).toBe(false);expect(R.act(S,0,{type:'check'})).toBe(false);invariant(S);
});

test('dealer alternates and blinds double every six hands up to 80/160',()=>{
  const R=load(),S=R.create({dealer:1});
  for(let hand=1;hand<=32;hand++){expect(R.startHand(S,{rng:random(hand)})).toBe(true);expect(S.dealer).toBe(hand%2);expect(S.bigBlind).toBe(Math.min(160,20*2**Math.floor((hand-1)/6)));expect(S.smallBlind).toBe(S.bigBlind/2);step(R,S,'fold');invariant(S);}
  expect(S.revision).toBe(64);
});

test('recipient views hide opponent cards, future deck and private nested fields',()=>{
  const R=load(),S=begin(R,{},'Kc Ac Kd Ad');const shown=R.view(S,0);
  expect(shown.players[0].hand).toEqual(cards('Ac Ad'));expect(shown.players[1].hand).toEqual([null,null]);
  for(const key of ['deck','deckIndex','burned','pending','rng'])expect(shown).not.toHaveProperty(key);
  shown.players[0].hand[0]=0;shown.board.push(9);expect(S.players[0].hand).toEqual(cards('Ac Ad'));expect(S.board).toHaveLength(0);
  step(R,S,'fold');S.result.secretDeck=S.deck;S.result.hands=[{secret:'private'},null];S.lastAction.secretDeck=S.deck;
  const folded=R.view(S,1);expect(folded.players[0].hand).toEqual([null,null]);expect(folded.result.hands).toEqual([null,null]);expect(folded.result).not.toHaveProperty('secretDeck');expect(folded.lastAction).not.toHaveProperty('secretDeck');
  const allin=begin(R);step(R,allin,'allin');step(R,allin,'call');expect(R.view(allin,0).players.every(p=>p.hand.every(Number.isInteger))).toBe(true);
});

test('shuffle uses supplied randomness or secure crypto, never stores it, and validates test decks',()=>{
  const R=load();expect(R.shuffle(random(1))).toEqual(R.shuffle(random(1)));expect(R.shuffle(random(1))).not.toEqual(R.shuffle(random(2)));
  const secure=R.shuffle();expect(secure).toHaveLength(52);expect(new Set(secure).size).toBe(52);expect(secure).not.toEqual(Array.from({length:52},(_,i)=>i));
  const S=R.create(),before=JSON.stringify(S);expect(()=>R.startHand(S,{deck:Array(52).fill(0)})).toThrow();expect(JSON.stringify(S)).toBe(before);
  expect(()=>R.shuffle(()=>1)).toThrow();expect(()=>R.shuffle(()=>NaN)).toThrow();expect(R.startHand(S,{rng:random(4)})).toBe(true);expect(()=>JSON.parse(JSON.stringify(S))).not.toThrow();expect(S).not.toHaveProperty('rng');
});

test('seeded legal-action matches conserve chips and terminate across folds, raises and all-ins',()=>{
  const R=load();let hands=0,actions=0;
  for(let seed=1;seed<=70;seed++){
    const rng=random(seed),S=R.create({dealer:seed%2});
    while(S.matchWinner===null&&S.handNo<100){
      expect(R.startHand(S,{rng})).toBe(true);hands++;let count=0;
      while(S.stage!=='over'&&count++<300){
        const legal=R.legal(S),choices=[];if(legal.canCheck)choices.push({type:'check'});if(legal.canCall)choices.push({type:'call'},{type:'call'});if(legal.toCall)choices.push({type:'fold'});if(legal.canRaise)choices.push({type:'raise',amount:legal.minRaiseTo},{type:'raise',amount:Math.floor((legal.minRaiseTo+legal.maxRaiseTo)/2)});if(legal.canAllIn)choices.push({type:'allin'});
        expect(choices.length).toBeGreaterThan(0);const revision=S.revision;expect(R.act(S,S.turn,choices[Math.floor(rng()*choices.length)])).toBe(true);expect(S.revision).toBe(revision+1);actions++;invariant(S);
      }
      expect(S.stage).toBe('over');
    }
    expect(S.matchWinner).not.toBeNull();expect(S.players[S.matchWinner].stack).toBe(2000);
  }
  expect(hands).toBeGreaterThan(100);expect(actions).toBeGreaterThan(300);
});
