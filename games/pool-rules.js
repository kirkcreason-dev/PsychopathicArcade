/* Arcade eight-ball, based on WPA sections 3 and 4. Normal pots are auto-called;
   every foul gives ball in hand anywhere, and the 8 on a break is always spotted.
   These are deliberate arcade choices rather than all tournament options. */
const POOL_RULES = (()=>{
  const group=id=>Number.isInteger(id)&&id>=1&&id<=7?'solids':Number.isInteger(id)&&id>=9&&id<=15?'stripes':null;
  const live=S=>S.balls.filter(b=>b.id>0&&!b.pocketed);
  const inGroup=(S,g)=>live(S).filter(b=>group(b.id)===g).map(b=>b.id);
  function remaining(S,side=S.turn){return S.groups[side]?inGroup(S,S.groups[side]):live(S).filter(b=>b.id!==8).map(b=>b.id);}
  function eligible8(S,side=S.turn){
    if(S.playMode==='practice')return true;
    return S.groups[side]?remaining(S,side).length===0:!inGroup(S,'solids').length||!inGroup(S,'stripes').length;
  }
  function targets(S,side=S.turn){
    if(S.playMode==='practice'||S.break)return live(S).map(b=>b.id);
    return eligible8(S,side)?live(S).filter(b=>b.id===8).map(b=>b.id):remaining(S,side);
  }
  function prepare(S){
    return Object.assign(POOL_PHYSICS.createShot(),{shooter:S.turn,wasBreak:!!S.break,eligible8:eligible8(S,S.turn),calledPocket:S.calledPocket,groupBefore:S.groups[S.turn],targetsBefore:targets(S,S.turn),resolved:false});
  }
  function stats(S){
    S.scores||=[0,0];S.stats||=[{},{}];
    for(let i=0;i<2;i++){S.stats[i]||={};if(!Number.isFinite(S.scores[i]))S.scores[i]=0;for(const key of ['shots','pots','fouls','run','bestRun'])if(!Number.isFinite(S.stats[i][key]))S.stats[i][key]=0;}
  }
  function placementClear(S,x,y,id=0){
    const balls=S.balls.filter(b=>b.id!==id);
    if(!POOL_PHYSICS.validPlacement(balls,x,y))return false;
    return id===0||balls.every(b=>b.pocketed||Math.hypot(x-b.x,y-b.y)>=2*POOL_PHYSICS.R+.05);
  }
  function findPlacement(S,preferred,id=0){
    const {B,R}=POOL_PHYSICS,midY=(B.top+B.bottom)/2;
    const start=preferred||{x:B.left+(B.right-B.left)*(id===8?.75:.25),y:midY};
    if(placementClear(S,start.x,start.y,id))return {x:start.x,y:start.y};
    // A respotted eight follows the long string towards the foot rail first.
    if(id===8)for(const sign of [1,-1])for(let d=2*R+.5;d<B.right-B.left;d+=2*R+.5){const x=start.x+sign*d;if(placementClear(S,x,midY,id))return {x,y:midY};}
    let best=null,distance=Infinity;
    for(let y=B.top+R+3;y<=B.bottom-R-3;y+=2*R+3)for(let x=B.left+R+3;x<=B.right-R-3;x+=2*R+3){
      const d=Math.hypot(x-start.x,y-start.y);if(d<distance&&placementClear(S,x,y,id)){best={x,y};distance=d;}
    }
    return best;
  }
  function spot(S,id){
    let b=S.balls.find(v=>v.id===id);if(!b){b={id,x:0,y:0,vx:0,vy:0,pocketed:true};S.balls.push(b);}
    const p=findPlacement(S,undefined,id);if(!p)return false;
    Object.assign(b,p,{vx:0,vy:0,pocketed:false});delete b.pocket;return true;
  }
  function assign(S,side,g){S.groups[side]=g;S.groups[1-side]=g==='solids'?'stripes':'solids';}
  function claimEmptyGroup(S){
    // Rare open-table edge: all seven of a group may fall on the break or a foul.
    // Automatically give the next shooter the cleared group, permitting an 8 shot
    // rather than leaving a rack that can no longer assign either player a group.
    if(S.groups[0]||S.groups[1]||S.playMode==='practice')return;
    const empty=['solids','stripes'].find(g=>!inGroup(S,g).length);if(empty)assign(S,S.turn,empty);
  }
  function credit(S,side,ids,practice=false){
    for(const id of ids){
      S.scores[side]+=100+(practice?0:Math.min(100,S.stats[side].run*25));
      S.stats[side].pots++;S.stats[side].run++;S.stats[side].bestRun=Math.max(S.stats[side].bestRun,S.stats[side].run);
    }
  }
  function resolve(S,shot){
    if(shot.resolved)return shot.result;
    shot.resolved=true;stats(S);
    const shooter=shot.shooter===1?1:0,other=1-shooter,events=[];
    for(const p of shot.potted||[])if(Number.isInteger(p.id)&&p.id>=0&&p.id<=15&&!events.some(e=>e.id===p.id))events.push(p);
    const objectPots=events.filter(p=>p.id>0),eight=events.find(p=>p.id===8),scratch=events.some(p=>p.id===0);
    S.stats[shooter].shots++;S.ballInHand=false;S.calledPocket=null;S.break=false;S.winner=null;
    // Physics normally marks these. Reapply idempotently so serialized shot results
    // and the rule engine share the same source of truth.
    for(const event of events){const b=S.balls.find(v=>v.id===event.id);if(b)Object.assign(b,{pocketed:true,vx:0,vy:0});}
    const result={shooter,potted:objectPots.map(p=>p.id),foul:false,reason:'',keepTurn:false,winner:null};
    shot.result=result;
    if(S.playMode==='practice'){
      if(scratch){result.foul=true;result.reason='Scratch';S.stats[shooter].fouls++;S.stats[shooter].run=0;S.ballInHand=true;spot(S,0);}
      else credit(S,shooter,result.potted,true);
      S.turn=shooter;result.keepTurn=true;S.mode=live(S).length?'aiming':'over';
      S.notice=S.mode==='over'?'PRACTICE COMPLETE · ALL 15 CLEARED':scratch?'SCRATCH · PLACE THE CUE BALL':objectPots.length?'NICE POT · KEEP PRACTICING':'LINE UP YOUR NEXT SHOT';
      return result;
    }
    let foul=scratch?'Scratch':null;
    if(!Number.isInteger(shot.first)||shot.first<1||shot.first>15)foul||='No object ball hit';
    if(shot.wasBreak){
      const rails=new Set((shot.rails||[]).filter(r=>r.id>0&&r.id<=15).map(r=>r.id));
      if(!objectPots.length&&rails.size<4)foul||='Break needs a pot or four balls to a rail';
      if(eight)spot(S,8);
    }else{
      const legal=shot.targetsBefore||(shot.eligible8?[8]:shot.groupBefore?S.balls.filter(b=>group(b.id)===shot.groupBefore).map(b=>b.id):S.balls.filter(b=>group(b.id)).map(b=>b.id));
      if(shot.first!==null&&!legal.includes(shot.first))foul||='Wrong ball first';
      if(!objectPots.length&&!shot.railAfterContact)foul||='No rail after contact';
    }
    if(eight&&!shot.wasBreak){
      const called=Number.isInteger(shot.calledPocket)&&shot.calledPocket>=0&&shot.calledPocket<6;
      const reason=!shot.eligible8?'Eight ball too early':foul?foul:!called||eight.pocket!==shot.calledPocket?'Eight ball in the wrong pocket':null;
      S.mode='over';S.winner=reason?other:shooter;S.scores[S.winner]+=1000;
      result.foul=!!foul;result.reason=reason||'Called eight ball';result.winner=S.winner;
      if(foul)S.stats[shooter].fouls++;
      if(reason)S.stats[shooter].run=0;
      else{S.stats[shooter].pots++;S.stats[shooter].run++;S.stats[shooter].bestRun=Math.max(S.stats[shooter].bestRun,S.stats[shooter].run);}
      S.notice=reason?reason.toUpperCase()+' · PLAYER '+(other+1)+' WINS':'CALLED EIGHT · PLAYER '+(shooter+1)+' WINS';
      return result;
    }
    if(foul){
      result.foul=true;result.reason=foul;S.stats[shooter].fouls++;S.stats[shooter].run=0;S.turn=other;S.ballInHand=true;
      const cue=S.balls.find(b=>b.id===0);if(!cue||cue.pocketed||!placementClear(S,cue.x,cue.y))spot(S,0);
      S.notice='FOUL · '+foul.toUpperCase()+' · PLAYER '+(other+1)+' HAS BALL IN HAND';
    }else{
      if(!shot.wasBreak&&!S.groups[shooter]){const chosen=objectPots.find(p=>group(p.id));if(chosen)assign(S,shooter,group(chosen.id));}
      const own=objectPots.filter(p=>p.id!==8&&(shot.wasBreak||group(p.id)===S.groups[shooter])).map(p=>p.id);
      credit(S,shooter,own);
      result.keepTurn=shot.wasBreak?objectPots.length>0:own.length>0;
      S.turn=result.keepTurn?shooter:other;
      if(!result.keepTurn)S.stats[shooter].run=0;
      S.notice=shot.wasBreak?(eight?'EIGHT RESPOTTED · ':'')+'BREAK COMPLETE · '+(result.keepTurn?'KEEP SHOOTING':'PLAYER '+(other+1)+' TO SHOOT'):
        result.keepTurn?'CLEAN POT · KEEP SHOOTING':'PLAYER '+(other+1)+' TO SHOOT';
    }
    S.mode='aiming';claimEmptyGroup(S);return result;
  }
  return {group,remaining,targets,eligible8,prepare,resolve,findPlacement,placementClear};
})();
