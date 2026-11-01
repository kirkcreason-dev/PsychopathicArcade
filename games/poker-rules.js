/* Heads-up no-limit Hold'em for play chips. Betting order, full raises,
   short all-ins and odd chips follow https://www.pokertda.com/view-poker-tda-rules/.
   The complete engine state is PRIVATE. Send only view(state, recipientSeat).
   Cards 0..51: rank = id % 13 + 2; suits are clubs, diamonds, hearts, spades. */
const POKER_RULES=(()=>{
  const SUITS=['c','d','h','s'],NAMES=['High card','One pair','Two pair','Three of a kind','Straight','Flush','Full house','Four of a kind','Straight flush'];
  const rank=card=>card%13+2,suit=card=>Math.floor(card/13);
  const cardLabel=card=>({11:'J',12:'Q',13:'K',14:'A'}[rank(card)]||String(rank(card)))+SUITS[suit(card)];
  const cardOK=c=>Number.isInteger(c)&&c>=0&&c<52;
  const seatOK=s=>s===0||s===1;
  const active=stage=>['preflop','flop','turn','river'].includes(stage);
  function compare(a,b){
    if(a.rank!==b.rank)return Math.sign(a.rank-b.rank);
    for(let i=0;i<Math.max(a.kickers.length,b.kickers.length);i++){const d=(a.kickers[i]||0)-(b.kickers[i]||0);if(d)return Math.sign(d);}return 0;
  }
  function five(cards){
    const ranks=cards.map(rank).sort((a,b)=>b-a),counts=new Map();for(const r of ranks)counts.set(r,(counts.get(r)||0)+1);
    const sets=[...counts].sort((a,b)=>b[1]-a[1]||b[0]-a[0]),flush=cards.every(c=>suit(c)===suit(cards[0]));
    const straight=counts.size===5?(ranks[0]-ranks[4]===4?ranks[0]:ranks.join(',')==='14,5,4,3,2'?5:0):0;
    let category=0,kickers=ranks;
    if(straight&&flush){category=8;kickers=[straight];}
    else if(sets[0][1]===4){category=7;kickers=[sets[0][0],sets[1][0]];}
    else if(sets[0][1]===3&&sets[1][1]===2){category=6;kickers=[sets[0][0],sets[1][0]];}
    else if(flush)category=5;
    else if(straight){category=4;kickers=[straight];}
    else if(sets[0][1]===3){category=3;kickers=[sets[0][0],...sets.slice(1).map(v=>v[0])];}
    else if(sets[0][1]===2&&sets[1][1]===2){category=2;kickers=[sets[0][0],sets[1][0],sets[2][0]];}
    else if(sets[0][1]===2){category=1;kickers=[sets[0][0],...sets.slice(1).map(v=>v[0])];}
    return{rank:category,kickers,name:category===8&&straight===14?'Royal flush':NAMES[category],best5:cards.slice()};
  }
  function evaluate(cards){
    if(!Array.isArray(cards)||cards.length<5||cards.length>7||!cards.every(cardOK)||new Set(cards).size!==cards.length)throw new RangeError('Evaluate five to seven distinct cards.');
    let best=null;
    for(let a=0;a<cards.length-4;a++)for(let b=a+1;b<cards.length-3;b++)for(let c=b+1;c<cards.length-2;c++)for(let d=c+1;d<cards.length-1;d++)for(let e=d+1;e<cards.length;e++){
      const hand=five([cards[a],cards[b],cards[c],cards[d],cards[e]]);if(!best||compare(hand,best)>0)best=hand;
    }
    return best;
  }
  function randomIndex(n,rng){
    if(rng){const value=rng();if(!Number.isFinite(value)||value<0||value>=1)throw new RangeError('Random source must return a number from zero up to, but not including, one.');return Math.floor(value*n);}
    if(!globalThis.crypto?.getRandomValues)throw new Error('Secure card shuffling is unavailable in this browser.');
    const data=new Uint32Array(1),limit=Math.floor(4294967296/n)*n;do{globalThis.crypto.getRandomValues(data);}while(data[0]>=limit);return data[0]%n;
  }
  function shuffle(rng){const deck=Array.from({length:52},(_,i)=>i);for(let i=51;i>0;i--){const j=randomIndex(i+1,rng);[deck[i],deck[j]]=[deck[j],deck[i]];}return deck;}
  function create(options={}){
    const stacks=options.stacks||[1000,1000],dealer=options.dealer??0;
    if(!Array.isArray(stacks)||stacks.length!==2||!stacks.every(v=>Number.isSafeInteger(v)&&v>=0)||!Number.isSafeInteger(stacks[0]+stacks[1])||stacks[0]+stacks[1]<=0||!seatOK(dealer))throw new RangeError('Use two nonnegative chip stacks and a valid dealer seat.');
    return{stage:'ready',players:stacks.map(stack=>({stack,hand:[],folded:false,allIn:false,bet:0,contributed:0,lastAction:''})),board:[],pot:0,dealer,turn:null,handNo:0,smallBlind:10,bigBlind:20,currentBet:0,lastRaise:20,notice:'Play chips only. Ready to deal.',result:null,matchWinner:stacks[0]===0?1:stacks[1]===0?0:null,revision:0,raiseRights:[true,true],pending:[false,false],deck:[],deckIndex:0,burned:[],lastAction:null,totalChips:stacks[0]+stacks[1]};
  }
  function commit(S,seat,amount){const p=S.players[seat];p.stack-=amount;p.bet+=amount;p.contributed+=amount;S.pot+=amount;p.allIn=p.stack===0;}
  function draw(S){if(S.deckIndex>=S.deck.length)throw new Error('The deck is exhausted.');return S.deck[S.deckIndex++];}
  function dealStreet(S){
    S.burned.push(draw(S));const count=S.board.length===0?3:1;for(let i=0;i<count;i++)S.board.push(draw(S));
    S.stage=S.board.length===3?'flop':S.board.length===4?'turn':'river';
  }
  function splitPot(amount,winners,dealer){
    if(!Number.isSafeInteger(amount)||amount<0||!Array.isArray(winners)||!winners.length||!winners.every(seatOK)||new Set(winners).size!==winners.length||!seatOK(dealer))throw new RangeError('Invalid pot award.');
    const payouts=[0,0],each=Math.floor(amount/winners.length);for(const seat of winners)payouts[seat]=each;
    let odd=amount-each*winners.length;for(const seat of [1-dealer,dealer])if(odd&&winners.includes(seat)){payouts[seat]++;odd--;}
    return payouts;
  }
  function settle(S,foldWinner=null){
    const refunds=[0,0],diff=S.players[0].contributed-S.players[1].contributed;
    if(diff){const seat=diff>0?0:1,amount=Math.abs(diff);refunds[seat]=amount;S.players[seat].stack+=amount;S.players[seat].contributed-=amount;S.players[seat].bet=Math.max(0,S.players[seat].bet-amount);S.pot-=amount;}
    let hands=[null,null],winners;
    if(foldWinner!==null)winners=[foldWinner];
    else{hands=S.players.map(p=>evaluate([...p.hand,...S.board]));const order=compare(hands[0],hands[1]);winners=order===0?[0,1]:[order>0?0:1];}
    const contested=S.pot,payouts=splitPot(contested,winners,S.dealer);
    for(let i=0;i<2;i++){const p=S.players[i];p.stack+=payouts[i];p.bet=0;p.contributed=0;p.allIn=p.stack===0;}
    S.pot=0;S.stage='over';S.turn=null;S.currentBet=0;S.pending=[false,false];S.raiseRights=[false,false];
    S.matchWinner=S.players[0].stack===0?1:S.players[1].stack===0?0:null;
    S.result={kind:foldWinner===null?'showdown':'fold',handWinner:winners.length===1?winners[0]:null,winners,payouts,pot:contested,refunds,hands};
    S.notice=winners.length===2?'Split pot.':`Player ${winners[0]+1} wins ${contested} chips`+(foldWinner===null?' with '+hands[winners[0]].name+'.':' after a fold.');
  }
  function runout(S){while(S.board.length<5)dealStreet(S);settle(S);}
  function advance(S,afterSeat){
    const withChips=[0,1].filter(i=>!S.players[i].folded&&S.players[i].stack>0);
    if(withChips.length===0){runout(S);return;}
    if(withChips.length===1){
      const only=withChips[0],opponent=1-only;
      if(S.players[only].bet<S.players[opponent].bet){S.pending[only]=true;S.turn=only;return;}
      runout(S);return;
    }
    if(S.pending.some(Boolean)){S.turn=S.pending[1-afterSeat]?1-afterSeat:afterSeat;return;}
    if(S.players[0].bet!==S.players[1].bet){S.turn=S.players[0].bet<S.players[1].bet?0:1;S.pending[S.turn]=true;return;}
    if(S.stage==='river'){settle(S);return;}
    dealStreet(S);for(const p of S.players){p.bet=0;p.lastAction='';}S.currentBet=0;S.lastRaise=S.bigBlind;S.pending=[true,true];S.raiseRights=[true,true];S.turn=1-S.dealer;S.notice=S.stage.toUpperCase()+` · Player ${S.turn+1} acts first.`;
  }
  function startHand(S,options={}){
    if(!S||!['ready','over'].includes(S.stage)||S.matchWinner!==null||S.players.some(p=>p.stack<=0))return false;
    const deck=options.deck?options.deck.slice():shuffle(options.rng);
    if(deck.length!==52||!deck.every(cardOK)||new Set(deck).size!==52)throw new RangeError('A test deck must contain each of the 52 cards exactly once.');
    if(S.handNo>0)S.dealer=1-S.dealer;S.handNo++;S.bigBlind=Math.min(160,20*2**Math.floor((S.handNo-1)/6));S.smallBlind=S.bigBlind/2;
    Object.assign(S,{stage:'preflop',board:[],pot:0,turn:S.dealer,currentBet:0,lastRaise:S.bigBlind,notice:'The button posts the small blind and acts first.',result:null,raiseRights:[true,true],pending:[true,true],deck,deckIndex:0,burned:[],lastAction:null});
    for(const p of S.players)Object.assign(p,{hand:[],folded:false,allIn:false,bet:0,contributed:0,lastAction:''});
    for(let round=0;round<2;round++)for(const seat of [1-S.dealer,S.dealer])S.players[seat].hand.push(draw(S));
    commit(S,S.dealer,Math.min(S.smallBlind,S.players[S.dealer].stack));commit(S,1-S.dealer,Math.min(S.bigBlind,S.players[1-S.dealer].stack));
    S.currentBet=Math.max(...S.players.map(p=>p.bet));S.revision++;
    if(S.players.some(p=>p.allIn))advance(S,1-S.dealer);
    return true;
  }
  function legal(S,seat=S.turn){
    const disabled={canAct:false,canFold:false,canCheck:false,canCall:false,canRaise:false,canAllIn:false,toCall:0,callAmount:0,minRaiseTo:0,maxRaiseTo:0};
    if(!seatOK(seat)||!active(S.stage)||seat!==S.turn||S.players[seat].folded||S.players[seat].stack<=0)return disabled;
    const p=S.players[seat],other=S.players[1-seat],toCall=Math.max(0,S.currentBet-p.bet),maxRaiseTo=p.bet+p.stack,minRaiseTo=S.currentBet+(S.currentBet?S.lastRaise:S.bigBlind);
    const mayRaise=S.raiseRights[seat]!==false&&!other.folded&&other.stack>0&&maxRaiseTo>S.currentBet;
    return{canAct:true,canFold:true,canCheck:toCall===0,canCall:toCall>0,toCall,callAmount:Math.min(toCall,p.stack),minRaiseTo,maxRaiseTo,canRaise:mayRaise&&maxRaiseTo>=minRaiseTo,canAllIn:maxRaiseTo<=S.currentBet||mayRaise};
  }
  function act(S,seat,action){
    const options=legal(S,seat);if(!options.canAct||!action||typeof action!=='object')return false;
    const p=S.players[seat],other=1-seat;let type=action.type,amount=0,raiseTo=null;
    if(type==='allin'){
      if(!options.canAllIn)return false;
      if(options.maxRaiseTo<=S.currentBet)type='call';else{type='raise';raiseTo=options.maxRaiseTo;}
    }
    if(type==='fold'){
      p.folded=true;p.lastAction='Fold';S.lastAction={seat,type:'fold',amount:0,stage:S.stage};S.revision++;settle(S,other);return true;
    }
    if(type==='check'){if(!options.canCheck)return false;p.lastAction='Check';}
    else if(type==='call'){if(!options.canCall)return false;amount=options.callAmount;}
    else if(type==='raise'){
      const target=raiseTo??action.amount;
      if(!Number.isSafeInteger(target)||target<=S.currentBet||target>options.maxRaiseTo||S.raiseRights[seat]===false||S.players[other].stack<=0)return false;
      if(target<options.minRaiseTo&&target!==options.maxRaiseTo)return false;
      raiseTo=target;amount=target-p.bet;
    }else return false;
    const previous=S.currentBet;if(amount)commit(S,seat,amount);
    S.pending[seat]=false;S.raiseRights[seat]=false;
    if(type==='raise'){
      const increment=raiseTo-previous;if(increment>=S.lastRaise){S.lastRaise=increment;S.raiseRights[other]=true;}
      S.currentBet=raiseTo;S.pending[other]=true;p.lastAction=(p.allIn?'All in · ':'Raise to ')+raiseTo;
    }else if(type==='call')p.lastAction=(p.allIn?'All-in call ':'Call ')+amount;
    S.lastAction={seat,type,amount:type==='raise'?raiseTo:amount,stage:S.stage};S.notice=`Player ${seat+1} · ${p.lastAction}`;S.revision++;
    advance(S,seat);return true;
  }
  function view(S,seat=0){
    if(!seatOK(seat))throw new RangeError('Invalid viewer seat.');
    const shown=S.stage==='over'&&S.result?.kind==='showdown';
    const r=S.result,result=r?{kind:r.kind,handWinner:r.handWinner,winners:r.winners.slice(),payouts:r.payouts.slice(),pot:r.pot,refunds:r.refunds.slice(),hands:shown?r.hands.map(h=>h?{rank:h.rank,kickers:h.kickers.slice(),name:h.name,best5:h.best5.slice()}:null):[null,null]}:null;
    const action=S.lastAction;
    return{seat,stage:S.stage,players:S.players.map((p,i)=>({stack:p.stack,hand:i===seat||shown?p.hand.slice():p.hand.map(()=>null),folded:p.folded,allIn:p.allIn,bet:p.bet,contributed:p.contributed,lastAction:p.lastAction})),board:S.board.slice(),pot:S.pot,dealer:S.dealer,turn:S.turn,handNo:S.handNo,smallBlind:S.smallBlind,bigBlind:S.bigBlind,currentBet:S.currentBet,lastRaise:S.lastRaise,notice:S.notice,result,matchWinner:S.matchWinner,revision:S.revision,raiseRights:S.raiseRights.slice(),lastAction:action?{seat:action.seat,type:action.type,amount:action.amount,stage:action.stage}:null,totalChips:S.totalChips};
  }
  return Object.freeze({create,startHand,legal,act,view,evaluate,compare,shuffle,splitPot,rank,suit,cardLabel});
})();
