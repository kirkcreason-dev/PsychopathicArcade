/* CPU picks visible ghost-ball pots, not outcomes. All shots use the same real
   physics as the player; seeded aim error makes the three levels reproducible. */
const POOL_AI=(()=>{
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const levels={easy:{error:.026,powerError:.07},normal:{error:.009,powerError:.035},hard:{error:.0018,powerError:.012}};
  function rngFor(S){
    let seed=(Number(S.seed)>>>0)^Math.imul((S.stats?.[0]?.shots||0)+1,1664525)^Math.imul((S.stats?.[1]?.shots||0)+1,1013904223)^(S.turn*2654435761);
    return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  }
  function segmentDistance(p,a,b){
    const dx=b.x-a.x,dy=b.y-a.y,q=dx*dx+dy*dy;
    const t=q?clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/q,0,1):0;
    return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
  }
  function clear(balls,a,b,exclude=[]){
    return !balls.some(v=>!v.pocketed&&v.id!==0&&!exclude.includes(v.id)&&segmentDistance(v,a,b)<POOL_PHYSICS.R*2+.6);
  }
  function finish(candidate,level,rng){
    return {angle:candidate.angle+(rng()-.5)*2*level.error,power:clamp(candidate.power*(1+(rng()-.5)*2*level.powerError),.13,1),calledPocket:candidate.calledPocket??null,...(candidate.placement?{placement:{...candidate.placement}}:{})};
  }
  function candidates(S,cue){
    const P=POOL_PHYSICS,{R,B}=P,legal=new Set(POOL_RULES.targets(S,S.turn)),list=[];
    for(const target of S.balls)if(!target.pocketed&&legal.has(target.id))for(let pocket=0;pocket<P.pockets.length;pocket++){
      const hole=P.pockets[pocket],distance=dist(target,hole);if(distance<1)continue;
      const ux=(hole.x-target.x)/distance,uy=(hole.y-target.y)/distance,ghost={x:target.x-ux*2*R,y:target.y-uy*2*R};
      if(ghost.x<B.left+R||ghost.x>B.right-R||ghost.y<B.top+R||ghost.y>B.bottom-R||!clear(S.balls,target,hole,[target.id]))continue;
      const positions=S.ballInHand?[75,125,200].map(d=>({x:ghost.x-ux*d,y:ghost.y-uy*d})).filter(p=>P.validPlacement(S.balls,p.x,p.y)):[cue];
      for(const from of positions){
        const travel=dist(from,ghost);if(travel<2||!clear(S.balls,from,ghost,[target.id]))continue;
        const ax=(ghost.x-from.x)/travel,ay=(ghost.y-from.y)/travel,cut=ax*ux+ay*uy;if(cut<.24)continue;
        const speed=Math.sqrt(2*P.ROLL_FRICTION*(travel+(distance+65)/(cut*cut*.94)))+22;
        const power=clamp(speed/P.MAX_SPEED,.16,.88);
        list.push({angle:Math.atan2(ay,ax),power,calledPocket:target.id===8?pocket:null,pocket,target:target.id,from,ghost,placement:S.ballInHand?from:null,rank:travel*.24+distance+460*(1-cut)});
      }
    }
    return list.sort((a,b)=>a.rank-b.rank||a.target-b.target||a.pocket-b.pocket);
  }
  function simulateCandidate(S,candidate){
    // Geometry reduces the search to two finalists. Predict against the real
    // full table, with a seven-second cap; never run exhaustive angle searches.
    const cue={...S.balls.find(b=>b.id===0),...candidate.from,vx:0,vy:0,pocketed:false};
    const result=POOL_PHYSICS.simulate(S.balls.map(b=>b.id===0?cue:b),candidate,{maxTime:7,dt:1/30});
    const scratch=result.shot.potted.some(p=>p.id===0),pot=result.shot.potted.some(p=>p.id===candidate.target&&p.pocket===candidate.pocket);
    return candidate.rank+(pot?-1500:500)+(scratch?4000:0)+(result.shot.first!==candidate.target?2000:0);
  }
  function safety(S,cue,legal){
    const P=POOL_PHYSICS,{B,R}=P,balls=S.balls.filter(b=>!b.pocketed&&legal.has(b.id));
    let best=null;
    const accept=(target,point,distance,bank=false)=>{
      const candidate={angle:Math.atan2(point.y-cue.y,point.x-cue.x),power:clamp(Math.sqrt(2*P.ROLL_FRICTION*(distance+400))/P.MAX_SPEED+(bank?.14:.06),.28,.8),calledPocket:target.id===8?P.pockets.map((p,i)=>({i,d:dist(p,target)})).sort((a,b)=>a.d-b.d)[0].i:null,rank:distance+(bank?700:0)};
      if(!best||candidate.rank<best.rank)best=candidate;
    };
    for(const target of balls){
      if(clear(S.balls,cue,target,[target.id]))accept(target,target,dist(cue,target));
      for(const axis of ['x','y'])for(const wall of axis==='x'?[B.left+R,B.right-R]:[B.top+R,B.bottom-R]){
        // The cushion damps normal velocity but retains tangential velocity, so
        // a true bank point differs from a perfectly mirrored optical reflection.
        const across=axis==='x'?'y':'x',before=Math.abs(cue[axis]-wall),after=Math.abs(target[axis]-wall);
        const fraction=before/(before+after/P.RAIL_RESTITUTION);if(!(fraction>0&&fraction<1))continue;
        const point={[axis]:wall,[across]:cue[across]+(target[across]-cue[across])*fraction};
        if(point.x<B.left+R-.01||point.x>B.right-R+.01||point.y<B.top+R-.01||point.y>B.bottom-R+.01||P.pockets.some(p=>dist(p,point)<p.r+R+8))continue;
        if(clear(S.balls,cue,point,[target.id])&&clear(S.balls,point,target,[target.id]))accept(target,point,dist(cue,point)+dist(point,target),true);
      }
    }
    const target=balls.sort((a,b)=>dist(a,cue)-dist(b,cue))[0];
    return best||{angle:target?Math.atan2(target.y-cue.y,target.x-cue.x):0,power:.45,calledPocket:target?.id===8?0:null};
  }
  function choose(S,difficulty='hustler'){
    const key=({street:'easy',juggalo:'normal',hustler:'hard'})[difficulty]||difficulty,level=levels[key]||levels.normal,rng=rngFor(S),P=POOL_PHYSICS;
    let cue=S.balls.find(b=>b.id===0),placement=null;
    if(!cue)return {angle:0,power:.3,calledPocket:null};
    if(S.ballInHand){placement=POOL_RULES.findPlacement(S);if(placement)cue={...cue,...placement,pocketed:false};}
    if(S.break){
      const apex=S.balls.filter(b=>b.id>0&&!b.pocketed).sort((a,b)=>a.x-b.x||a.id-b.id)[0];
      return finish({angle:apex?Math.atan2(apex.y-cue.y+(rng()-.5)*P.R*.5,apex.x-cue.x):0,power:key==='easy'?.8:.93,calledPocket:null,placement},level,rng);
    }
    const list=candidates(S,cue);
    if(list.length){
      // Two predictions can reject an obvious scratch without exhaustive search.
      const shortlist=list.slice(0,2);let best=shortlist[0],score=Infinity;
      for(const candidate of shortlist){const value=simulateCandidate(S,candidate);if(value<score){score=value;best=candidate;}}
      return finish(best,level,rng);
    }
    const shot=safety(S,cue,new Set(POOL_RULES.targets(S,S.turn)));if(placement)shot.placement=placement;
    return finish(shot,level,rng);
  }
  return {choose,segmentDistance};
})();
