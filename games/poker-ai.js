/* The CPU receives only POKER_RULES.view(privateState, cpuSeat). It samples
   unknown cards, never reads an opponent hand, undealt deck or private RNG. */
const POKER_AI=(()=>{
  function random(rng){const v=rng();if(!Number.isFinite(v)||v<0||v>=1)throw new RangeError('Invalid CPU random source.');return v;}
  function equity(view,samples=28,rng=Math.random){
    const own=view.players[view.seat].hand,board=view.board;
    if(own.length!==2||!own.every(Number.isInteger)||![0,3,4,5].includes(board.length))return .5;
    const known=new Set([...own,...board]),unknown=Array.from({length:52},(_,i)=>i).filter(id=>!known.has(id)),need=7-board.length;
    let wins=0;samples=Math.max(1,Math.min(48,Math.trunc(samples)));
    for(let trial=0;trial<samples;trial++){
      const deck=unknown.slice();
      for(let i=0;i<need;i++){const j=i+Math.floor(random(rng)*(deck.length-i));[deck[i],deck[j]]=[deck[j],deck[i]];}
      const publicBoard=[...board,...deck.slice(2,need)],mine=POKER_RULES.evaluate([...own,...publicBoard]),theirs=POKER_RULES.evaluate([deck[0],deck[1],...publicBoard]);
      const comparison=POKER_RULES.compare(mine,theirs);wins+=comparison>0?1:comparison===0?.5:0;
    }
    return wins/samples;
  }
  function choose(view,difficulty='normal',options={}){
    const legal=POKER_RULES.legal(view,view.seat);if(!legal.canAct)return null;
    const rng=options.rng||Math.random,level=['easy','normal','hard'].includes(difficulty)?difficulty:'normal';
    const chance=equity(view,level==='easy'?16:level==='hard'?40:28,rng),strength=.5+(chance-.5)*.88;
    const noise=(random(rng)-.5)*(level==='easy'?.24:level==='hard'?.035:.09),assessment=Math.max(0,Math.min(1,strength+noise));
    const potOdds=legal.callAmount/(view.pot+legal.callAmount||1),willingness=level==='easy'?.09:level==='hard'?.015:.04;
    if(legal.toCall>0&&assessment+willingness<potOdds+.025)return{type:'fold'};
    const bluff=random(rng)<(level==='easy'?.035:level==='hard'?.075:.055),value=assessment>.68||assessment>.55&&random(rng)<.32;
    if(legal.canRaise&&(value||bluff)){
      const fraction=assessment>.8?.9:assessment>.65?.7:.5,increment=Math.max(view.lastRaise,Math.round((view.pot+legal.callAmount)*fraction));
      const target=Math.max(legal.minRaiseTo,Math.min(legal.maxRaiseTo,view.currentBet+increment));
      return target===legal.maxRaiseTo?{type:'allin'}:{type:'raise',amount:target};
    }
    if(!legal.canRaise&&legal.canAllIn&&legal.maxRaiseTo>view.currentBet&&assessment>.67)return{type:'allin'};
    return legal.canCheck?{type:'check'}:legal.canCall?{type:'call'}:{type:'fold'};
  }
  return Object.freeze({choose,equity});
})();
