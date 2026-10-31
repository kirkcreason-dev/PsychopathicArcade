/* Shared deterministic table simulation; no DOM, timers, network or randomness.
 * Small fixed steps plus swept time-of-impact contacts prevent fast balls from
 * tunneling. The finite cushion segments have circular end caps at each jaw.
 * Background: https://box2d.org/documentation/md_simulation.html
 * https://box2d.org/files/ErinCatto_ContinuousCollision_GDC2013.pdf
 * This is an arcade rolling-ball model: no spin, jump shots or cloth nap.
 */
const POOL_PHYSICS = (() => {
  const W=1000,H=600,R=12.5,MAX_SPEED=1500,ROLL_FRICTION=95;
  const B=Object.freeze({left:70,right:930,top:85,bottom:515});
  const FIXED_DT=1/240,BALL_RESTITUTION=.985,RAIL_RESTITUTION=.8,STOP_SPEED=1.5,EPS=1e-8;
  const pockets=Object.freeze([
    {x:70,y:85,r:29},{x:500,y:85,r:27},{x:930,y:85,r:29},
    {x:70,y:515,r:29},{x:500,y:515,r:27},{x:930,y:515,r:29},
  ].map(Object.freeze));
  const cushions=Object.freeze([
    {id:'top-left',ax:110,ay:85,bx:462,by:85,nx:0,ny:1},
    {id:'top-right',ax:538,ay:85,bx:890,by:85,nx:0,ny:1},
    {id:'bottom-left',ax:110,ay:515,bx:462,by:515,nx:0,ny:-1},
    {id:'bottom-right',ax:538,ay:515,bx:890,by:515,nx:0,ny:-1},
    {id:'left',ax:70,ay:125,bx:70,by:475,nx:1,ny:0},
    {id:'right',ax:930,ay:125,bx:930,by:475,nx:-1,ny:0},
  ].map(Object.freeze));
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const live=b=>!b.pocketed;

  function random(seed){
    let n=2166136261;for(const c of String(seed))n=Math.imul(n^c.charCodeAt(0),16777619);
    return()=>{let t=n+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};
  }
  function rack(seed=1){
    const rng=random(seed),shuffle=list=>{for(let i=list.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[list[i],list[j]]=[list[j],list[i]];}return list;};
    const solids=shuffle([1,2,3,4,5,6,7]),stripes=shuffle([9,10,11,12,13,14,15]);
    const rear=rng()<.5?[solids.pop(),stripes.pop()]:[stripes.pop(),solids.pop()];
    const remaining=shuffle([...solids,...stripes]);
    const balls=[{id:0,x:285,y:300,vx:0,vy:0,pocketed:false}],spacing=2*R+.3;
    for(let row=0;row<5;row++)for(let col=0;col<=row;col++){
      const id=row===2&&col===1?8:row===4&&col===0?rear[0]:row===4&&col===4?rear[1]:remaining.pop();
      balls.push({id,x:675+row*spacing*Math.sqrt(3)/2,y:300+(col-row/2)*spacing,vx:0,vy:0,pocketed:false});
    }
    return balls.sort((a,b)=>a.id-b.id);
  }
  function createShot(){return{first:null,potted:[],rails:[],railAfterContact:false,elapsed:0,_carry:0};}
  function prepareShot(shot){
    if(shot.first===undefined)shot.first=null;
    if(!Array.isArray(shot.potted))shot.potted=[];
    if(!Array.isArray(shot.rails))shot.rails=[];
    if(shot.railAfterContact===undefined)shot.railAfterContact=false;
    if(!Number.isFinite(shot.elapsed))shot.elapsed=0;
    if(!Number.isFinite(shot._carry))shot._carry=0;
    return shot;
  }
  function moving(balls){return balls.some(b=>live(b)&&Number.isFinite(b.vx)&&Number.isFinite(b.vy)&&Math.hypot(b.vx,b.vy)>STOP_SPEED);}
  function strike(balls,angle,power){
    const cue=balls.find(b=>b.id===0&&live(b));
    if(!cue||!Number.isFinite(angle)||!Number.isFinite(power)||moving(balls))return false;
    const requested=clamp(power,0,1)*MAX_SPEED,speed=requested>STOP_SPEED?requested:0;
    cue.vx=Math.cos(angle)*speed;cue.vy=Math.sin(angle)*speed;
    return speed>0;
  }
  function validPlacement(balls,x,y){
    if(!Number.isFinite(x)||!Number.isFinite(y)||x<B.left+R||x>B.right-R||y<B.top+R||y>B.bottom-R)return false;
    if(pockets.some(p=>Math.hypot(x-p.x,y-p.y)<=p.r+1))return false;
    return !balls.some(b=>b.id!==0&&live(b)&&Math.hypot(x-b.x,y-b.y)<2*R+.1);
  }

  // First time a moving point enters a circle. Using the stable quadratic form
  // matters for grazing impacts and for balls that start very close together.
  function circleTime(dx,dy,vx,vy,r,inside=false){
    const c=dx*dx+dy*dy-r*r,dot=dx*vx+dy*vy;
    if(c<=EPS)return inside||dot<-EPS*r?0:Infinity;
    const speed2=vx*vx+vy*vy;if(speed2<EPS||dot>=0)return Infinity;
    const disc=dot*dot-speed2*c;if(disc<0)return Infinity;
    return c/(-dot+Math.sqrt(disc));
  }
  function railHit(ball,rail,limit){
    const endX=ball.x+ball.vx*limit,endY=ball.y+ball.vy*limit;
    if(Math.max(ball.x,endX)<Math.min(rail.ax,rail.bx)-R||Math.min(ball.x,endX)>Math.max(rail.ax,rail.bx)+R||Math.max(ball.y,endY)<Math.min(rail.ay,rail.by)-R||Math.min(ball.y,endY)>Math.max(rail.ay,rail.by)+R)return null;
    let best=null;
    const vn=ball.vx*rail.nx+ball.vy*rail.ny;
    if(vn<-EPS){
      const d=(ball.x-rail.ax)*rail.nx+(ball.y-rail.ay)*rail.ny;
      const t=Math.max(0,(R-d)/vn),x=ball.x+ball.vx*t,y=ball.y+ball.vy*t;
      const sx=rail.bx-rail.ax,sy=rail.by-rail.ay,u=((x-rail.ax)*sx+(y-rail.ay)*sy)/(sx*sx+sy*sy);
      if(t<=limit+EPS&&u>=0&&u<=1)best={t,nx:rail.nx,ny:rail.ny,plane:true};
    }
    for(const [x,y] of [[rail.ax,rail.ay],[rail.bx,rail.by]]){
      const t=circleTime(ball.x-x,ball.y-y,ball.vx,ball.vy,R);
      if(t<=limit+EPS&&(!best||t<best.t-EPS)){
        const dx=ball.x+ball.vx*t-x,dy=ball.y+ball.vy*t-y,d=Math.hypot(dx,dy);
        best={t,nx:d>EPS?dx/d:rail.nx,ny:d>EPS?dy/d:rail.ny,jawX:x,jawY:y};
      }
    }
    return best;
  }
  function openingHit(ball,limit){
    let best=null;
    const consider=(t,p)=>{if(t>=0&&t<=limit+EPS&&p>=0&&(!best||t<best.t))best={t,p};};
    if(Math.abs(ball.vy)>EPS){
      const top=ball.vy<0,t=((top?B.top:B.bottom)-ball.y)/ball.vy,x=ball.x+ball.vx*t,base=top?0:3;
      consider(t,x<110?base:x>890?base+2:x>462&&x<538?base+1:-1);
    }
    if(Math.abs(ball.vx)>EPS){
      const left=ball.vx<0,t=((left?B.left:B.right)-ball.x)/ball.vx,y=ball.y+ball.vy*t,side=left?0:2;
      consider(t,y<125?side:y>475?side+3:-1);
    }
    return best;
  }
  function pocketBall(ball,index,shot){
    ball.pocketed=true;ball.vx=0;ball.vy=0;ball.pocket=index;
    // Keep the mouth position for a renderer's sinking animation.
    if(!shot.potted.some(p=>p.id===ball.id))shot.potted.push({id:ball.id,pocket:index});
  }
  function recordRail(ball,rail,shot){
    if(!shot.rails.some(r=>r.id===ball.id&&r.rail===rail.id))shot.rails.push({id:ball.id,rail:rail.id});
    if(shot.first!==null)shot.railAfterContact=true;
  }
  function separatePair(a,b){
    let dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);
    if(d>=2*R-1e-7)return;
    if(d<EPS){dx=a.id<b.id?1:-1;dy=0;d=1;}
    const shift=(2*R-Math.hypot(b.x-a.x,b.y-a.y)+1e-6)/2;
    a.x-=dx/d*shift;a.y-=dy/d*shift;b.x+=dx/d*shift;b.y+=dy/d*shift;
  }
  function separateRail(ball,rail){
    const sx=rail.bx-rail.ax,sy=rail.by-rail.ay;
    const u=clamp(((ball.x-rail.ax)*sx+(ball.y-rail.ay)*sy)/(sx*sx+sy*sy),0,1);
    const x=rail.ax+u*sx,y=rail.ay+u*sy,dx=ball.x-x,dy=ball.y-y,d=Math.hypot(dx,dy);
    if(d>=R-1e-7)return;
    const nx=d>EPS?dx/d:rail.nx,ny=d>EPS?dy/d:rail.ny;
    ball.x+=nx*(R-d+1e-6);ball.y+=ny*(R-d+1e-6);
  }
  function advance(balls,t){for(const b of balls)if(live(b)){b.x+=b.vx*t;b.y+=b.vy*t;}}
  function integrate(balls,h,shot){
    let left=h,events=0;
    while(left>EPS&&events<96){
      let hit=null;
      const choose=e=>{if(e.t<=left+EPS&&(!hit||e.t<hit.t-EPS||(Math.abs(e.t-hit.t)<=EPS&&e.priority<hit.priority)))hit=e;};
      for(let i=0;i<balls.length;i++){
        const a=balls[i];if(!live(a))continue;
        for(let j=i+1;j<balls.length;j++){
          const b=balls[j];if(!live(b))continue;
          const dx=b.x-a.x,dy=b.y-a.y,vx=b.vx-a.vx,vy=b.vy-a.vy;
          if(Math.abs(dx)>2*R+Math.abs(vx)*left||Math.abs(dy)>2*R+Math.abs(vy)*left)continue;
          const t=circleTime(dx,dy,vx,vy,2*R);
          if(t<=left+EPS)choose({t,priority:1,type:'ball',a,b});
        }
        for(let p=0;p<pockets.length;p++){
          const hole=pockets[p],dx=a.x-hole.x,dy=a.y-hole.y;
          if(Math.abs(dx)>hole.r+Math.abs(a.vx)*left||Math.abs(dy)>hole.r+Math.abs(a.vy)*left)continue;
          const t=circleTime(dx,dy,a.vx,a.vy,hole.r,true);
          if(t<=left+EPS)choose({t,priority:0,type:'pocket',a,p});
        }
        if(Math.abs(a.vx)+Math.abs(a.vy)>EPS)for(const rail of cushions){
          const r=railHit(a,rail,left);if(r)choose({...r,priority:2,type:'rail',a,rail});
        }
        const opening=openingHit(a,left);if(opening)choose({...opening,priority:0,type:'pocket',a});
      }
      if(!hit){advance(balls,left);left=0;break;}
      const t=clamp(hit.t,0,left);advance(balls,t);left-=t;events++;
      const a=hit.a;
      if(hit.type==='pocket'){pocketBall(a,hit.p,shot);continue;}
      if(hit.type==='ball'){
        const b=hit.b,dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);
        const nx=d>EPS?dx/d:1,ny=d>EPS?dy/d:0,vn=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;
        if(vn<-EPS){
          const impulse=-(1+BALL_RESTITUTION)*vn/2;
          a.vx-=impulse*nx;a.vy-=impulse*ny;b.vx+=impulse*nx;b.vy+=impulse*ny;
          if(shot.first===null&&(a.id===0||b.id===0)){
            shot.first=a.id===0?b.id:a.id;shot.firstTime=shot.elapsed+h-left;
          }
        }
        separatePair(a,b);
      }else{
        const vn=a.vx*hit.nx+a.vy*hit.ny;
        if(vn<-EPS){a.vx-=(1+RAIL_RESTITUTION)*vn*hit.nx;a.vy-=(1+RAIL_RESTITUTION)*vn*hit.ny;recordRail(a,hit.rail,shot);}
        separateRail(a,hit.rail);
      }
    }
    // A cap protects pathological coincident inputs. Never advance unchecked
    // through remaining contacts; normal breaks stay well below this limit.
    if(left>EPS)shot.solverLimit=(shot.solverLimit||0)+1;
    for(let pass=0;pass<(events?2:0);pass++)for(let i=0;i<balls.length;i++){
      const a=balls[i];if(!live(a))continue;
      for(let j=i+1;j<balls.length;j++)if(live(balls[j]))separatePair(a,balls[j]);
      for(const rail of cushions)separateRail(a,rail);
    }
    for(const b of balls)if(live(b)){
      // Crossing a pocket opening is also a capture. This closes the tiny
      // crescent between a circular catchment and its rounded cushion jaws.
      let p=-1;
      if(b.y<B.top||b.y>B.bottom){
        const base=b.y<B.top?0:3;
        if(b.x<110)p=base;else if(b.x>890)p=base+2;else if(b.x>462&&b.x<538)p=base+1;
      }
      if(b.x<B.left||b.x>B.right){
        const side=b.x<B.left?0:2;if(b.y<125)p=side;else if(b.y>475)p=side+3;
      }
      if(p>=0){pocketBall(b,p,shot);continue;}
      const speed=Math.hypot(b.vx,b.vy),next=Math.max(0,speed-ROLL_FRICTION*h);
      if(next<=STOP_SPEED){b.vx=0;b.vy=0;}else{b.vx*=next/speed;b.vy*=next/speed;}
    }
    shot.elapsed+=h;
  }
  function step(balls,dt,shot=createShot()){
    prepareShot(shot);if(!Number.isFinite(dt)||dt<=0)return shot;
    for(const b of balls)if(live(b)){
      if(!Number.isFinite(b.x)||!Number.isFinite(b.y)){b.x=500;b.y=300;}
      if(!Number.isFinite(b.vx))b.vx=0;if(!Number.isFinite(b.vy))b.vy=0;
      const speed=Math.hypot(b.vx,b.vy);if(speed>MAX_SPEED){b.vx*=MAX_SPEED/speed;b.vy*=MAX_SPEED/speed;}
    }
    if(!shot._initialized){
      // Repairs small placement/network round-off without manufacturing a hit.
      for(let pass=0;pass<4;pass++)for(let i=0;i<balls.length;i++)if(live(balls[i])){
        for(let j=i+1;j<balls.length;j++)if(live(balls[j]))separatePair(balls[i],balls[j]);
        for(const rail of cushions)separateRail(balls[i],rail);
      }
      shot._initialized=true;
    }
    // A stalled tab does not fast-forward an entire shot. The game can pause
    // on visibility change; this is the final guard against a long frame.
    shot._carry+=Math.min(dt,.1);
    const count=Math.floor((shot._carry+1e-10)/FIXED_DT);
    for(let i=0;i<count;i++)integrate(balls,FIXED_DT,shot);
    shot._carry=Math.max(0,shot._carry-count*FIXED_DT);
    return shot;
  }
  function simulate(input,aim,options={}){
    const balls=input.map(b=>({...b})),shot=createShot();
    const dt=Number.isFinite(options.dt)?clamp(options.dt,FIXED_DT,.1):1/60;
    const maxTime=Number.isFinite(options.maxTime)?clamp(options.maxTime,0,30):20;
    strike(balls,aim.angle,aim.power);
    while(moving(balls)&&shot.elapsed+FIXED_DT<=maxTime+EPS)step(balls,Math.min(dt,maxTime-shot.elapsed),shot);
    return{balls,shot,elapsed:shot.elapsed,settled:!moving(balls)};
  }
  function trace(balls,angle){
    const cue=balls.find(b=>b.id===0&&live(b));if(!cue||!Number.isFinite(angle))return null;
    const vx=Math.cos(angle),vy=Math.sin(angle),ray={x:cue.x,y:cue.y,vx,vy};
    let best={t:W*2,type:'none'};
    for(const b of balls)if(b.id!==0&&live(b)){
      const t=circleTime(cue.x-b.x,cue.y-b.y,vx,vy,2*R);
      if(t<best.t)best={t,type:'ball',id:b.id,ball:{id:b.id,x:b.x,y:b.y}};
    }
    for(let p=0;p<pockets.length;p++){
      const hole=pockets[p],t=circleTime(cue.x-hole.x,cue.y-hole.y,vx,vy,hole.r,true);
      if(t<best.t)best={t,type:'pocket',pocket:p};
    }
    for(const rail of cushions){const r=railHit(ray,rail,best.t);if(r&&r.t<best.t)best={...r,type:'cushion',id:rail.id};}
    const opening=openingHit(ray,best.t);if(opening&&opening.t<best.t)best={t:opening.t,type:'pocket',pocket:opening.p};
    const x=cue.x+vx*best.t,y=cue.y+vy*best.t;
    let normal=null;
    if(best.type==='ball'){const dx=x-best.ball.x,dy=y-best.ball.y,d=Math.hypot(dx,dy);normal={x:dx/d,y:dy/d};}
    if(best.type==='cushion')normal={x:best.nx,y:best.ny};
    return{x,y,type:best.type,id:best.id,pocket:best.pocket,ball:best.ball,normal,distance:best.t,points:[{x:cue.x,y:cue.y},{x,y}]};
  }
  return Object.freeze({W,H,R,B,pockets,cushions,MAX_SPEED,ROLL_FRICTION,FIXED_DT,BALL_RESTITUTION,RAIL_RESTITUTION,rack,createShot,strike,step,moving,validPlacement,simulate,trace});
})();
