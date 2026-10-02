/* ================= GAME 15 — JCW RUMBLE ================= */
const RUMBLE = (()=>{
  const W=480,H=420,FONT='Impact,"Arial Black",sans-serif',B={left:72,right:408,top:185,bottom:337};
  const roster=RUMBLE_ART.roster,byId=Object.fromEntries(roster.map(r=>[r.id,r])),store=gameStore('pa_ru_');
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const S={mode:'ready',fighters:[],queue:[],entered:0,total:12,elapsed:0,nextIn:8,score:0,kills:0,chain:0,lastKill:-99,labels:[],banner:'',bannerTime:0,selected:byId[store.get('selected','violent-j')]?store.get('selected','violent-j'):'violent-j',best:Math.max(0,store.get('best',0)),wins:Math.max(0,store.get('wins',0)),charge:0,saved:false,won:false,error:''};
  let loadingIds=new Set();
  const art=new Map(),held=new Set(),guards=new Set();
  let canvas,ctx,scenery,active=false,raf=0,last=0,generation=0,portraitGeneration=0,stickId=null,stick={x:0,y:0},hudKey='';
  const player=()=>S.fighters.find(f=>f.player);
  const alive=()=>S.fighters.filter(f=>!f.out);
  function text(id,v){const e=$('#'+id);if(e.textContent!==String(v))e.textContent=String(v);}
  function status(s){text('ruStatus',s);}
  function announce(s){S.banner=s;S.bannerTime=2;status(s);}
  function cleanCache(){
    const keep=new Set([...loadingIds,...S.fighters.map(f=>f.id),...S.queue.slice(0,1),S.selected]);
    for(const [id,item] of art){if(art.size<=6)break;if(!keep.has(id)&&item.image)art.delete(id);}
  }
  function load(id){
    if(art.has(id))return art.get(id).promise;
    const image=new Image(),entry={image:null,promise:null};
    entry.promise=(async()=>{image.src=byId[id].src;await image.decode();entry.image=image;cleanCache();return image;})();
    art.set(id,entry);cleanCache();entry.promise.catch(()=>{if(art.get(id)===entry)art.delete(id);});return entry.promise;
  }
  function prefetch(){
    const id=S.queue[0],token=generation;if(!id||art.has(id))return;
    load(id).catch(()=>{if(token!==generation||S.mode!=='playing')return;S.error='Wrestler artwork could not be decoded. Resume to retry.';pause(true);});
  }
  function clearInput(){held.clear();guards.clear();stick={x:0,y:0};stickId=null;$('#ruStickNub').style.transform='';$('#ruGuardBtn').setAttribute('aria-pressed','false');}
  function stop(){cancelAnimationFrame(raf);raf=0;last=0;clearInput();}
  function loop(now){raf=0;if(!active||S.mode!=='playing')return;const dt=last?Math.min(.05,Math.max(0,(now-last)/1000)):0;last=now;step(dt);draw();if(S.mode==='playing')raf=requestAnimationFrame(loop);}
  function run(){if(active&&S.mode==='playing'&&!raf){last=0;raf=requestAnimationFrame(loop);}}
  function overlays(){
    $('#ruSetup').hidden=!['ready','loading'].includes(S.mode);$('#ruPause').hidden=S.mode!=='paused';$('#ruOver').hidden=S.mode!=='over';
    $('#ruStartBtn').disabled=S.mode==='loading';$('#ruRoster').disabled=S.mode==='loading';$('#ruSize').disabled=S.mode==='loading';
    $('#ruPauseBtn').disabled=!['playing','paused'].includes(S.mode);text('ruPauseBtn',S.mode==='paused'?'RESUME':'PAUSE');text('ruPauseNote',S.error||'Your match is paused.');
    for(const id of ['ruHitBtn','ruThrowBtn','ruGuardBtn'])$('#'+id).disabled=S.mode!=='playing';
  }
  function hud(){
    const p=player(),hp=p?Math.ceil(p.hp):100,guard=p?Math.floor(p.guard):100;
    const key=[S.mode,S.score,S.kills,S.total,S.entered,alive().length,S.best,hp,guard,Math.floor(S.charge),S.wins].join('|');if(key===hudKey)return;hudKey=key;
    text('ruScore',S.score.toLocaleString());text('ruKills',S.kills);text('ruRemaining',S.queue.length+alive().length||S.total);text('ruBest',S.best.toLocaleString());text('ruHealth',hp);text('ruGuard',guard);
    $('#ruHealthFill').style.width=hp+'%';$('#ruHealthFill').style.background=hp<=35?'#ff5b99':'#d1fa61';
    $('#ruFinisherFill').style.width=S.charge+'%';$('#ruFinisherBtn').classList.toggle('ready',S.charge>=100);$('#ruFinisherBtn').disabled=S.mode!=='playing'||S.charge<100;
    text('ruFinisherText',S.charge>=100?'UNLEASH FINISHER · F':'FINISHER · '+Math.floor(S.charge)+'%');text('ruCareer',S.wins+' career '+(S.wins===1?'win':'wins'));
  }
  function fighter(id,isPlayer,x,y){return {id,player:isPlayer,x,y,facing:isPlayer?1:-1,hp:100,guard:100,guardOn:false,age:0,walk:false,cool:0,stun:0,invuln:1.1,lastHit:-10,action:null,grabbed:null,out:false,outTime:0,think:Math.random()*.5,target:null,aiWait:.8+Math.random()*.7};}
  function distance(a,b){return Math.hypot(a.x-b.x,(a.y-b.y)*1.35);}
  function nearest(f){return alive().filter(v=>v!==f&&!v.grabbed).sort((a,b)=>distance(f,a)-distance(f,b))[0];}
  function edge(f){return [{axis:'x',sign:-1,at:B.left,d:f.x-B.left},{axis:'x',sign:1,at:B.right,d:B.right-f.x},{axis:'y',sign:-1,at:B.top,d:f.y-B.top},{axis:'y',sign:1,at:B.bottom,d:B.bottom-f.y}].sort((a,b)=>a.d-b.d)[0];}
  function confine(f){f.x=clamp(f.x,B.left,B.right);f.y=clamp(f.y,B.top,B.bottom);}
  function label(f,value,color='#d9ff83'){S.labels.push({x:f.x,y:f.y-90,value,color,t:.85});if(S.labels.length>12)S.labels.shift();}
  function cancelMove(f){if(f.action?.target){const v=S.fighters.find(v=>v.id===f.action.target);if(v?.grabbed===f.id)v.grabbed=null;}f.action=null;}
  function damage(v,amount,from,push=0){
    if(v.out||v.invuln>0||v.grabbed)return false;
    if(v.guardOn&&v.guard>=12){v.guard=Math.max(0,v.guard-24);label(v,'BLOCK','#aeb9ff');v.hp=Math.max(1,v.hp-amount*.1);v.lastHit=S.elapsed;return false;}
    cancelMove(v);v.hp=Math.max(1,v.hp-amount);v.lastHit=S.elapsed;v.stun=.24;v.action={kind:'hurt',t:0,duration:.32};
    if(push){const e=edge(v);v[e.axis]+=e.sign*push;confine(v);}
    label(v,'−'+Math.round(amount),'#fff0cc');if(from.player){S.score+=25;S.charge=clamp(S.charge+13,0,100);Sound.play('hit');}return true;
  }
  function act(kind,f=player()){
    if(S.mode!=='playing'||!f||f.out||f.grabbed||f.stun>0||f.action||f.cool>0)return false;
    if(kind==='finish'){
      if(!f.player||S.charge<100)return false;S.charge=0;f.guardOn=false;f.action={kind:'heavy',t:0,duration:.72,hit:false};f.invuln=.75;f.cool=.85;announce(byId[f.id].name.toUpperCase()+' · FINISHER!');return true;
    }
    if(!['hit','throw'].includes(kind))return false;
    const v=nearest(f);f.guardOn=false;
    if(v&&Math.abs(v.x-f.x)>2)f.facing=Math.sign(v.x-f.x);
    if(kind==='throw'){
      if(!v||distance(f,v)>68){if(f.player)status('Get closer to grab an opponent.');return false;}
      if(v.invuln>0){if(f.player)status('Let the new entrant get into the ring.');return false;}
      if(v.guardOn&&v.guard>=12){v.guard=Math.max(0,v.guard-30);f.cool=.55;label(v,'RESISTED','#aeb9ff');return false;}
      const e=edge(v),ringOut=v.hp<=35&&e.d<=48;
      cancelMove(v);v.grabbed=f.id;f.action={kind:'throw',t:0,duration:.85,hit:false,target:v.id,edge:e,ringOut};f.cool=.95;
      if(f.player)status(ringOut?'OVER THE ROPES!':'Work the ropes. Weaken them, then throw again.');
    }else{f.action={kind:'light',t:0,duration:f.player?.4:.65,hit:false,target:v?.id};f.cool=f.player?.43:.9;}
    return true;
  }
  function eliminate(v,from,e){
    if(v.out)return;cancelMove(v);v.grabbed=null;v.out=true;v.outTime=0;v.exit={x:v.x,y:v.y,axis:e.axis,sign:e.sign};
    label(v,'OUT!','#ff78bd');
    if(from.player){S.kills++;S.chain=S.elapsed-S.lastKill<=12?S.chain+1:1;S.lastKill=S.elapsed;const points=500+Math.min(4,S.chain-1)*100;S.score+=points;S.charge=clamp(S.charge+20,0,100);announce(byId[v.id].name.toUpperCase()+' OUT · +'+points);Sound.play('bell');}
    else announce(byId[v.id].name.toUpperCase()+' ELIMINATED');
    S.nextIn=Math.min(S.nextIn,2.2);
  }
  function resolve(f){
    const a=f.action;if(!a||a.hit||a.t<(a.kind==='throw'?.46:a.kind==='heavy'?.3:f.player?.13:.3))return;a.hit=true;
    if(a.kind==='light'){
      const v=S.fighters.find(v=>v.id===a.target);if(v&&!v.out&&distance(f,v)<=76)damage(v,(f.player?27:14)*byId[f.id].power/byId[v.id].toughness,f,8);
    }else if(a.kind==='heavy'){
      for(const v of alive())if(v!==f&&distance(f,v)<125)damage(v,44,f,65);
      label(f,'FINISHER!','#ffe185');Sound.play('launch');
    }else if(a.kind==='throw'){
      const v=S.fighters.find(v=>v.id===a.target);if(!v||v.out||v.grabbed!==f.id)return;
      v.grabbed=null;
      if(a.ringOut)eliminate(v,f,a.edge);
      else{v.hp=Math.max(1,v.hp-12);v.lastHit=S.elapsed;v[a.edge.axis]+=a.edge.sign*72;confine(v);v.stun=.8;v.action={kind:'hurt',t:0,duration:.8};label(v,'TO THE ROPES','#f5d984');}
    }
  }
  function spawn(){
    if(!S.queue.length||alive().length>=4)return false;const id=S.queue[0];if(!art.get(id)?.image){prefetch();return false;}
    S.queue.shift();S.entered++;const side=S.entered%2;const opening=S.entered<=3;const f=fighter(id,false,opening?265+(S.entered-2)*70:side?380:100,opening?210:205+Math.random()*78);S.fighters.push(f);S.nextIn=8;announce('ENTRANT '+S.entered+' / '+S.total+' · '+byId[id].name.toUpperCase());prefetch();return true;
  }
  function ai(f,dt){
    f.think-=dt;f.aiWait=Math.max(0,f.aiWait-dt);
    if(f.think<=0||!S.fighters.some(v=>v.id===f.target&&!v.out&&!v.grabbed)){f.target=nearest(f)?.id;f.think=.6;}
    const v=S.fighters.find(v=>v.id===f.target);if(!v||v.out||v.grabbed)return;
    const dist=distance(f,v);if(Math.abs(v.x-f.x)>3)f.facing=Math.sign(v.x-f.x);
    f.guardOn=!!(v.action?.kind==='light'&&v.action.t<.25&&f.guard>35&&f.age%3<.65&&dist<85);
    if(dist>52){const dx=v.x-f.x,dy=v.y-f.y,len=Math.hypot(dx,dy)||1,speed=70*byId[f.id].speed*(f.guardOn?.4:1);f.x+=dx/len*speed*dt;f.y+=dy/len*speed*dt*.8;f.walk=true;}
    else if(f.aiWait<=0&&!f.guardOn){const needsThrow=v.hp<=35||v.hp<65&&f.age%4<1.4;act(needsThrow?'throw':'hit',f);f.aiWait=.35+Math.random()*.55;}
  }
  function step(dt){
    if(S.mode!=='playing'||!Number.isFinite(dt)||dt<=0)return;dt=Math.min(dt,.05);S.elapsed+=dt;S.nextIn=Math.max(0,S.nextIn-dt);S.bannerTime=Math.max(0,S.bannerTime-dt);
    S.labels.forEach(l=>{l.t-=dt;l.y-=18*dt;});S.labels=S.labels.filter(l=>l.t>0);
    const p=player();
    for(const f of S.fighters){
      f.age+=dt;f.walk=false;
      if(f.out){f.outTime+=dt;continue;}
      f.cool=Math.max(0,f.cool-dt);f.stun=Math.max(0,f.stun-dt);f.invuln=Math.max(0,f.invuln-dt);
      if(f.action){f.action.t+=dt;resolve(f);if(f.action&&f.action.t>=f.action.duration)cancelMove(f);}
      f.guardOn=false;
      if(f.grabbed||f.action||f.stun>0)continue;
      if(f.player){
        f.guardOn=guards.size>0&&f.guard>=8;
        let dx=stick.x+(held.has('right')?1:0)-(held.has('left')?1:0),dy=stick.y+(held.has('down')?1:0)-(held.has('up')?1:0);const len=Math.hypot(dx,dy);if(len>1){dx/=len;dy/=len;}
        const speed=123*byId[f.id].speed*(f.guardOn?.48:1);f.x+=dx*speed*dt;f.y+=dy*speed*.8*dt;f.walk=Math.hypot(dx,dy)>.12;if(Math.abs(dx)>.1)f.facing=Math.sign(dx);
        if(held.has('hit')&&!f.guardOn)act('hit',f);
      }else ai(f,dt);
      f.guard=clamp(f.guard+(f.guardOn?-30:22)*dt,0,100);
      if(S.elapsed-f.lastHit>5)f.hp=Math.min(f.hp+dt*1.2,100);
      confine(f);
    }
    const fighters=alive();
    for(let i=0;i<fighters.length;i++)for(let j=i+1;j<fighters.length;j++){
      const a=fighters[i],b=fighters[j];if(a.grabbed||b.grabbed||a.action?.kind==='throw'||b.action?.kind==='throw')continue;
      const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);if(len<25){const ux=len?dx/len:1,uy=len?dy/len:0,amount=(25-len)/2;a.x-=ux*amount;a.y-=uy*amount;b.x+=ux*amount;b.y+=uy*amount;confine(a);confine(b);}
    }
    S.fighters=S.fighters.filter(f=>!f.out||f.player||f.outTime<1.25);
    if(p?.out&&p.outTime>=.85){finish(false);return;}
    if(S.nextIn<=0)spawn();
    if(p&&!p.out&&S.queue.length===0&&alive().length===1)finish(true);
    if(S.elapsed%1<dt)cleanCache();hud();
  }
  async function start(){
    stop();const token=++generation;S.mode='loading';S.error='';text('ruLoadStatus','Getting your wrestlers ready…');overlays();
    S.selected=$('#ruRoster').value;S.total=Number($('#ruSize').value)===22?22:12;store.set('selected',S.selected);
    const ids=roster.filter(r=>r.id!==S.selected).map(r=>r.id);for(let i=ids.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[ids[i],ids[j]]=[ids[j],ids[i]];}
    const queue=ids.slice(0,S.total-1);loadingIds=new Set([S.selected,...queue.slice(0,2)]);
    try{await Promise.all([S.selected,...queue.slice(0,2)].map(load));}catch(_e){if(token!==generation)return;S.mode='ready';text('ruLoadStatus','Artwork could not load. Tap Ring the Bell to retry.');overlays();return;}
    if(token!==generation||!active)return;
    Object.assign(S,{mode:'playing',fighters:[fighter(S.selected,true,230,280)],queue,entered:1,elapsed:0,nextIn:8,score:0,kills:0,chain:0,lastKill:-99,charge:0,labels:[],banner:'',bannerTime:0,saved:false,won:false,error:''});
    spawn();spawn();loadingIds.clear();announce('RING THE BELL · LAST LUNATIC STANDING');text('ruLoadStatus','');$('#ruSaveBtn').disabled=false;text('ruSaveBtn','SAVE YOUR RECORD');overlays();hud();draw();window.scrollTo(0,0);canvas.focus({preventScroll:true});Sound.play('bell');run();
  }
  function finish(won){
    if(S.mode!=='playing')return;S.mode='over';S.won=won;if(won){S.score+=2000;S.wins++;store.set('wins',S.wins);}S.best=Math.max(S.best,S.score);store.set('best',S.best);stop();
    text('ruResultKicker',won?'JCW RUMBLE CHAMPION':'OVER THE ROPES');text('ruResultTitle',won?'LAST LUNATIC STANDING':'GET BACK IN THERE.');text('ruFinalScore',S.score.toLocaleString());text('ruResultDetail',S.kills+' eliminations · '+Math.floor(S.elapsed/60)+':'+String(Math.floor(S.elapsed%60)).padStart(2,'0')+' survived · '+S.total+' entrants');
    $('#ruSaveBtn').disabled=S.score<=0;overlays();hud();status(won?'You cleared the whole field. Champion!':'You were eliminated. Your best score is saved.');$('#ruAgainBtn').focus({preventScroll:true});Sound.play(won?'fanfare':'bell');
    try{window.__arcSend&&window.__arcSend({ev:'rumble',score:S.score,kills:S.kills,won,roster:S.selected,entrants:S.total});}catch(_e){}
  }
  function pause(force){
    if(S.mode==='playing'){S.mode='paused';stop();}
    else if(S.mode==='paused'&&force!==true){S.error='';S.mode='playing';prefetch();run();canvas.focus({preventScroll:true});}else return;
    overlays();hud();draw();
  }
  function choose(){stop();generation++;S.mode='ready';S.fighters=[];S.queue=[];S.score=0;S.kills=0;S.charge=0;S.error='';S.bannerTime=0;text('ruLoadStatus','');overlays();hud();portrait();draw();}
  function leave(){if(S.mode==='loading'){generation++;S.mode='ready';text('ruLoadStatus','');}pause(true);active=false;stop();}
  function enter(){active=true;resize();overlays();hud();portrait();draw();TICK.set('JCW RUMBLE — OVER THE ROPES. LAST LUNATIC STANDING.','LUNACY UNLOCKED');}
  function resize(){const dpr=Math.min(devicePixelRatio||1,2);canvas.width=W*dpr;canvas.height=H*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);draw();}
  function oval(c,x,y,rx,ry,fill,stroke){c.beginPath();c.ellipse(x,y,rx,ry,0,0,Math.PI*2);if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.stroke();}}
  function path(c,points,fill,stroke){c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));if(fill){c.closePath();c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.stroke();}}
  function makeScenery(){
    scenery=document.createElement('canvas');scenery.width=W*2;scenery.height=H*2;const c=scenery.getContext('2d');c.scale(2,2);
    const bg=c.createLinearGradient(0,0,0,H);bg.addColorStop(0,'#100b1c');bg.addColorStop(.4,'#38213b');bg.addColorStop(1,'#080910');c.fillStyle=bg;c.fillRect(0,0,W,H);
    for(let i=0;i<35;i++){const x=(i*67)%480,y=52+(i*19)%103;c.fillStyle=i%3?'#251c32':'#453246';c.fillRect(x-8,y+6,16,25);oval(c,x,y,6,7,c.fillStyle);}
    for(const x of [30,450]){path(c,[[x,0],[x-90,175],[x+100,175]],'#a5da3820');c.fillStyle='#e4ff87';c.fillRect(x-12,12,24,6);}
    c.textAlign='center';c.font='14px '+FONT;c.fillStyle='#d6d2c0';c.fillText('JUGGALO CHAMPIONSHIP WRESTLING',240,28);c.font='43px '+FONT;c.fillStyle='#c9f96b';c.fillText('RUMBLE',240,71);c.fillStyle='#cd5b9c';c.font='10px '+FONT;c.fillText('LUNACY UNLOCKED  /  NO ONE LEAVES QUIETLY',240,89);
    path(c,[[40,172],[440,172],[456,365],[24,365]],'#5c4b66','#b09aa9');path(c,[[24,365],[456,365],[448,400],[32,400]],'#1b1325','#a2527e');
    const mat=c.createLinearGradient(0,175,0,365);mat.addColorStop(0,'#6a596e');mat.addColorStop(1,'#897988');c.fillStyle=mat;c.fillRect(50,176,380,180);
    c.save();c.translate(240,278);c.scale(1,.55);oval(c,0,0,91,91,'#4a3a54','#bbae97');c.fillStyle='#b6d585';c.font='62px '+FONT;c.fillText('JCW',0,16);c.fillStyle='#c5b7c5';c.font='15px '+FONT;c.fillText('LAST LUNATIC STANDING',0,44);c.restore();
    c.font='22px '+FONT;c.fillStyle='#d5fb79';c.fillText('PSYCHOPATHIC ARCADE',240,390);
    c.lineWidth=3;for(let i=0;i<3;i++)path(c,[[40,120+i*21],[440,120+i*21]],null,i===0?'#d8f795':'#c95496');
    for(const x of [40,440]){c.fillStyle='#141321';c.fillRect(x-5,101,10,87);for(let i=0;i<3;i++){c.fillStyle=i===0?'#adc851':'#69294d';c.fillRect(x-10,115+i*21,20,12);}}
  }
  function sprite(c,id,anim,index,x,y,scale=1,facing=1,rotation=0){
    const image=art.get(id)?.image;if(!image)return false;const frames=byId[id].animations[anim]||byId[id].animations.idle,f=frames[Math.min(index,frames.length-1)]||frames[0];
    c.save();c.translate(x,y);c.rotate(rotation);c.scale(facing*scale,scale);if(f.flipX)c.scale(-1,1);if(f.drawScale)c.scale(f.drawScale,f.drawScale);
    c.drawImage(image,f.x,f.y,f.w,f.h,-f.anchorX,-f.anchorY,f.w,f.h);c.restore();return true;
  }
  async function portrait(){
    const id=S.selected,token=++portraitGeneration;text('ruStyle',byId[id].style+' · '+(byId[id].finisher||'Signature finisher'));$('#ruPortrait').setAttribute('aria-label',byId[id].name);
    const c=$('#ruPortrait').getContext('2d');c.clearRect(0,0,180,240);
    try{await load(id);}catch(_e){if(token===portraitGeneration)text('ruLoadStatus','Tap Ring the Bell to retry loading the artwork.');return;}if(token!==portraitGeneration)return;
    oval(c,90,224,51,9,'#0007');sprite(c,id,'idle',0,90,222,1.45,1);if(S.mode==='ready')draw();
  }
  function draw(){
    if(!ctx)return;ctx.clearRect(0,0,W,H);ctx.drawImage(scenery,0,0,W,H);
    const p=player(),target=p&&!p.out?nearest(p):null;
    for(const f of [...S.fighters].sort((a,b)=>a.y-b.y)){
      if(f.out&&f.outTime>1.2)continue;
      const a=f.action,frames=byId[f.id].animations;let anim=a?a.kind:f.walk?'walk':'idle',ix=0,x=f.x,y=f.y,rotation=0;
      if(anim==='throw'){anim=a.t<.46?'lift':'throw';const progress=a.t<.46?a.t/.46:(a.t-.46)/.39;ix=Math.floor(clamp(progress,0,.99)*frames[anim].length);}
      else if(a)ix=Math.floor(clamp(a.t/a.duration,0,.99)*frames[anim].length);
      else if(f.walk)ix=Math.floor(f.age*9)%frames.walk.length;
      if(S.won&&f.player){anim='victory';ix=Math.min(Math.floor(f.age*5)%frames.victory.length,frames.victory.length-1);}
      if(f.grabbed){const owner=S.fighters.find(v=>v.id===f.grabbed);if(owner){x=owner.x+owner.facing*19;y=owner.y-45;rotation=owner.facing*-.9;anim='hurt';ix=0;}}
      if(f.out){const t=clamp(f.outTime/1.1,0,1);x=f.exit.x+(f.exit.axis==='x'?f.exit.sign*100*t:0);y=f.exit.y+(f.exit.axis==='y'?f.exit.sign*72*t:18*t)-Math.sin(t*Math.PI)*65;rotation=f.exit.sign*t*2.8;anim='hurt';ix=0;ctx.globalAlpha=1-t;}
      const scale=.61+(f.y-B.top)/900;
      if(!f.out){oval(ctx,x,f.y,21,6,'#100b2477',f.player?'#d1ff68':f===target?'#ff70b6':null);}
      sprite(ctx,f.id,anim,ix,x,y,scale,f.facing,rotation);ctx.globalAlpha=1;
      if(!f.out){
        const head=f.y-106;ctx.textAlign='center';ctx.font='9px '+FONT;ctx.fillStyle=f.player?'#defd93':'#fff1ea';ctx.fillText((f.player?'YOU · ':'')+byId[f.id].name.toUpperCase(),f.x,head);
        ctx.fillStyle='#211323';ctx.fillRect(f.x-22,head+5,44,4);ctx.fillStyle=f.hp<=35?'#ff69a8':f.player?'#c5f876':'#e8b387';ctx.fillRect(f.x-22,head+5,44*f.hp/100,4);
        if(f.guardOn){ctx.strokeStyle='#a6b4f3';ctx.lineWidth=2;ctx.beginPath();ctx.arc(f.x,f.y-46,37,-2.6,.6);ctx.stroke();}
        if(f.hp<=35&&edge(f).d<=48){ctx.fillStyle='#d6ff72';ctx.font='15px '+FONT;ctx.fillText('OUT!',f.x,f.y+18);}
        if(a?.kind==='light'&&!a.hit&&!f.player){ctx.fillStyle='#ffce7b';ctx.font='20px '+FONT;ctx.fillText('!',f.x+29,f.y-77);}
      }
    }
    ctx.lineWidth=3;for(let i=0;i<3;i++){const back=120+i*21,front=294+i*22;path(ctx,[[40,back],[24,front]],null,'#c59eb7');path(ctx,[[440,back],[456,front]],null,'#c59eb7');ctx.globalAlpha=.65;path(ctx,[[24,front],[456,front]],null,i===0?'#d1f986':'#db669f');ctx.globalAlpha=1;}
    for(const x of [24,456]){ctx.fillStyle='#18131f';ctx.fillRect(x-5,274,10,92);for(let i=0;i<3;i++){ctx.fillStyle=i===0?'#acc56d':'#733356';ctx.fillRect(x-11,287+i*22,22,12);}}
    for(const l of S.labels){ctx.globalAlpha=Math.min(1,l.t*3);ctx.font='16px '+FONT;ctx.textAlign='center';ctx.lineWidth=3;ctx.strokeStyle='#17101c';ctx.strokeText(l.value,l.x,l.y);ctx.fillStyle=l.color;ctx.fillText(l.value,l.x,l.y);}ctx.globalAlpha=1;
    if(S.mode==='playing'||S.mode==='paused'){
      ctx.fillStyle='#120e1ded';ctx.fillRect(60,100,360,26);ctx.fillStyle=S.bannerTime>0?'#edfab5':'#d6bcda';ctx.font='12px '+FONT;ctx.textAlign='center';
      const next=S.queue.length?(alive().length>=4?'RING FULL · NEXT ENTRANT WAITING':'NEXT ENTRANT IN '+Math.ceil(S.nextIn)+'s'):'FINAL FIELD · CLEAR THE RING';ctx.fillText(S.bannerTime>0?S.banner:next,240,118,345);
    }
  }
  function movePointer(e){const r=$('#ruStick').getBoundingClientRect(),x=(e.clientX-r.left-r.width/2)/35,y=(e.clientY-r.top-r.height/2)/35,len=Math.hypot(x,y);stick=len>.12?{x:x/Math.max(1,len),y:y/Math.max(1,len)}:{x:0,y:0};$('#ruStickNub').style.transform=`translate(${stick.x*22}px,${stick.y*22}px)`;}
  function bindHold(id,on,off){const el=$('#'+id);el.addEventListener('pointerdown',e=>{if(e.button!==0||S.mode!=='playing')return;e.preventDefault();el.setPointerCapture(e.pointerId);on('p'+e.pointerId);});for(const event of ['pointerup','pointercancel','lostpointercapture'])el.addEventListener(event,e=>off('p'+e.pointerId));}
  function bind(){
    canvas=$('#ruCanvas');ctx=canvas.getContext('2d');makeScenery();resize();
    for(const r of roster){const o=document.createElement('option');o.value=r.id;o.textContent=r.name;$('#ruRoster').appendChild(o);}$('#ruRoster').value=S.selected;
    $('#ruRoster').onchange=()=>{S.selected=$('#ruRoster').value;store.set('selected',S.selected);portrait();};
    $('#ruStartBtn').onclick=start;$('#ruAgainBtn').onclick=start;$('#ruRestartBtn').onclick=choose;$('#ruChooseBtn').onclick=choose;$('#ruPauseBtn').onclick=()=>pause();$('#ruResumeBtn').onclick=()=>pause();$('#ruHomeBtn').onclick=()=>showScreen('menu');$('#ruSoundBtn').onclick=toggleSound;
    $('#ruFinisherBtn').onclick=()=>{act('finish');canvas.focus({preventScroll:true});};$('#ruSaveBtn').onclick=()=>{if(S.mode!=='over'||S.saved||S.score<=0)return;S.saved=true;$('#ruSaveBtn').disabled=true;text('ruSaveBtn','RECORD SUBMITTED');LB.check('rumble',S.score,S.kills+' eliminations · '+(S.won?'Champion':byId[S.selected].name));};
    bindHold('ruHitBtn',()=>{held.add('hit');act('hit');},()=>held.delete('hit'));
    bindHold('ruThrowBtn',()=>act('throw'),()=>{});
    bindHold('ruGuardBtn',key=>{guards.add(key);$('#ruGuardBtn').setAttribute('aria-pressed','true');},key=>{guards.delete(key);$('#ruGuardBtn').setAttribute('aria-pressed',String(guards.size>0));});
    $('#ruHitBtn').onclick=e=>{if(e.detail===0)act('hit');};$('#ruThrowBtn').onclick=e=>{if(e.detail===0)act('throw');};$('#ruGuardBtn').onclick=e=>{if(e.detail===0){guards.has('toggle')?guards.delete('toggle'):guards.add('toggle');$('#ruGuardBtn').setAttribute('aria-pressed',String(guards.size>0));}};
    const stickEl=$('#ruStick');stickEl.addEventListener('pointerdown',e=>{if(e.button!==0||stickId!==null||S.mode!=='playing')return;e.preventDefault();stickId=e.pointerId;stickEl.setPointerCapture(e.pointerId);movePointer(e);});stickEl.addEventListener('pointermove',e=>{if(e.pointerId===stickId)movePointer(e);});
    for(const type of ['pointerup','pointercancel','lostpointercapture'])stickEl.addEventListener(type,e=>{if(e.pointerId!==stickId)return;stickId=null;stick={x:0,y:0};$('#ruStickNub').style.transform='';});
    for(const el of $$('[data-ru-dir]')){el.onkeydown=e=>{if([' ','Enter'].includes(e.key)&&S.mode==='playing'){e.preventDefault();held.add(el.dataset.ruDir);}};el.onkeyup=e=>{if([' ','Enter'].includes(e.key)){e.preventDefault();held.delete(el.dataset.ruDir);}};el.onblur=()=>held.delete(el.dataset.ruDir);}
    const keys={ArrowLeft:'left',a:'left',ArrowRight:'right',d:'right',ArrowUp:'up',w:'up',ArrowDown:'down',s:'down',j:'hit',' ':'hit'};
    window.addEventListener('keydown',e=>{
      if(!active||gameKeysBlocked(e)||e.target.closest('button,select,input,textarea'))return;const k=e.key.length===1?e.key.toLowerCase():e.key;
      if(k==='p'||k==='Escape'){e.preventDefault();if(!e.repeat)pause();return;}if(S.mode!=='playing')return;
      if(keys[k]){e.preventDefault();held.add(keys[k]);if(keys[k]==='hit'&&!e.repeat)act('hit');}else if(k==='Shift'||k==='l'){e.preventDefault();guards.add(k);}else if(k==='k'||k==='f'){e.preventDefault();if(!e.repeat)act(k==='k'?'throw':'finish');}
    });
    window.addEventListener('keyup',e=>{const k=e.key.length===1?e.key.toLowerCase():e.key;if(keys[k])held.delete(keys[k]);guards.delete(k);});
    window.addEventListener('blur',()=>pause(true));document.addEventListener('visibilitychange',()=>{if(document.hidden)pause(true);});window.addEventListener('resize',()=>{if(active)resize();});
    // Menu art reuses whole reviewed frames, including their transparent margins.
    Promise.all([load('violent-j'),load('dani-mo')]).then(()=>{const c=$('#ruMenuArt').getContext('2d');c.drawImage(scenery,0,0,400,300);sprite(c,'violent-j','idle',0,145,255,1.23,1);sprite(c,'dani-mo','idle',0,267,255,1.23,-1);}).catch(()=>{});
    hud();overlays();
  }
  return {bind,enter,leave,start,pause,choose,step,draw,act,state:S,roster,player,edge,distance,load,cacheSize:()=>art.size};
})();
