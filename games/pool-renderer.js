/* Juggalo Pool: cached table artwork and a responsive, invertible camera. */
const POOL_RENDERER=(()=>{
  const TAU=Math.PI*2;
  const colors=['#fff4db','#f5c842','#327be5','#eb4058','#a769df','#f38b36','#25c48b','#ad3764','#151925'];
  const tiles=new Map();
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function circle(c,x,y,r,fill,stroke,width=1){c.beginPath();c.arc(x,y,r,0,TAU);if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.lineWidth=width;c.strokeStyle=stroke;c.stroke();}}
  function line(c,points,stroke,width=1){c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.strokeStyle=stroke;c.lineWidth=width;c.stroke();}
  function polygon(c,points,fill,stroke,width=1){c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=width;c.stroke();}}
  function rounded(c,x,y,w,h,r,fill,stroke,width=1){c.beginPath();c.roundRect(x,y,w,h,r);if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=width;c.stroke();}}
  function spaced(c,text,x,y,spacing=2){
    const widths=[...text].map(letter=>c.measureText(letter).width),width=widths.reduce((sum,v)=>sum+v,0)+(text.length-1)*spacing;
    let left=x-width/2;c.textAlign='left';for(let i=0;i<text.length;i++){c.fillText(text[i],left,y);left+=widths[i]+spacing;}
  }
  function makeCanvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
  function ballTile(id,portrait){
    const key=id+':'+Number(portrait);if(tiles.has(key))return tiles.get(key);
    const tile=makeCanvas(88,88),c=tile.getContext('2d'),r=25,x=44,y=42,color=colors[id===0?0:id===8?8:(id-1)%8+1];
    const shadow=c.createRadialGradient(x+2,y+6,5,x+2,y+6,32);shadow.addColorStop(0,'#0009');shadow.addColorStop(.72,'#0004');shadow.addColorStop(1,'#0000');circle(c,x+2,y+6,32,shadow);
    circle(c,x,y,r,id>8?'#f7f0dc':color);
    c.save();c.beginPath();c.arc(x,y,r,0,TAU);c.clip();
    if(id>8){c.fillStyle=color;c.fillRect(x-r,y-12,r*2,24);}
    const light=c.createRadialGradient(x-8,y-11,1,x+2,y+4,31);light.addColorStop(0,'#ffffff70');light.addColorStop(.48,'#ffffff05');light.addColorStop(.78,'#00000008');light.addColorStop(1,'#000000b8');circle(c,x,y,r,light);
    c.restore();circle(c,x,y,r,null,id===8?'#b1bdc3':'#ffffff63',1.3);
    if(id){
      c.save();c.translate(x,y);if(portrait)c.rotate(Math.PI/2);
      circle(c,0,0,15,'#fff9e9','#ffffffad',.7);
      c.fillStyle='#111722';c.textAlign='center';c.textBaseline='middle';c.font=`900 ${id>9?21:23}px Arial,sans-serif`;c.fillText(String(id),0,.9);c.restore();
    }else{
      circle(c,x+4,y+5,2.1,'#a69a80');
    }
    c.save();c.translate(x-8,y-12);c.rotate(-.5);c.fillStyle='#ffffffcf';c.beginPath();c.ellipse(0,0,5.5,2.4,0,0,TAU);c.fill();c.restore();
    tiles.set(key,tile);return tile;
  }
  function drawBall(c,id,x,y,r=12.5,portrait=false,alpha=1){
    c.save();c.globalAlpha*=alpha;const extent=r*88/25;c.drawImage(ballTile(id,portrait),x-r*44/25,y-r*42/25,extent,extent);c.restore();
  }
  function joker(c,x,y,size){
    c.save();c.translate(x,y);c.scale(size/100,size/100);c.lineJoin='round';
    // A felt-stitched jester crest rather than a high-contrast picture under the balls.
    polygon(c,[[0,-88],[69,-26],[50,64],[0,91],[-50,64],[-69,-26]],null,'#57bea0',2);
    polygon(c,[[0,-75],[58,-22],[42,56],[0,78],[-42,56],[-58,-22]],null,'#57bea0',.7);
    polygon(c,[[-38,-23],[-52,-61],[-16,-40],[0,-73],[16,-40],[52,-61],[38,-23]],'#57bea0');
    for(const [xx,yy] of [[-52,-61],[0,-73],[52,-61]])circle(c,xx,yy,5,'#57bea0');
    c.beginPath();c.moveTo(-35,-21);c.quadraticCurveTo(-34,48,0,63);c.quadraticCurveTo(34,48,35,-21);c.quadraticCurveTo(0,-36,-35,-21);c.closePath();c.strokeStyle='#57bea0';c.lineWidth=3;c.stroke();
    polygon(c,[[-28,-12],[-8,-2],[-25,12]],'#57bea0');polygon(c,[[28,-12],[8,-2],[25,12]],'#57bea0');
    polygon(c,[[0,2],[7,16],[0,21],[-7,16]],'#57bea0');
    c.beginPath();c.moveTo(-24,25);c.quadraticCurveTo(0,39,24,25);c.quadraticCurveTo(16,52,0,53);c.quadraticCurveTo(-16,52,-24,25);c.strokeStyle='#57bea0';c.lineWidth=2;c.stroke();
    for(const xx of [-12,0,12])line(c,[[xx,35],[xx,46]],'#57bea0',2);
    c.restore();
  }
  function background(physics){
    const {W,H,B,pockets,cushions}=physics,c=makeCanvas(W*2,H*2),g=c.getContext('2d');g.scale(2,2);
    const room=g.createRadialGradient(W/2,H/2,30,W/2,H/2,W*.62);room.addColorStop(0,'#22152c');room.addColorStop(.7,'#110f1b');room.addColorStop(1,'#08090e');g.fillStyle=room;g.fillRect(0,0,W,H);
    // Subtle floor seams and table shadow are rendered only once.
    for(let x=-H;x<W+H;x+=55)line(g,[[x,0],[x+H,H]],'#ffffff03',1);
    rounded(g,22,42,W-44,H-56,56,'#0009');rounded(g,24,26,W-48,H-52,52,'#0b080e','#a16b70',1);
    const wood=g.createLinearGradient(0,28,0,H-28);wood.addColorStop(0,'#613443');wood.addColorStop(.13,'#3c1c30');wood.addColorStop(.45,'#281426');wood.addColorStop(.75,'#4c2439');wood.addColorStop(1,'#20101e');
    rounded(g,30,31,W-60,H-62,47,wood,'#cba66b',2);
    rounded(g,36,37,W-72,H-74,42,null,'#dcc39550',1);
    rounded(g,42,43,W-84,H-86,38,null,'#0d0913',3);
    // Lacquer grain stays on the wooden rails, outside the green playing surface.
    g.save();g.beginPath();g.roundRect(44,44,W-88,H-88,35);g.clip();
    for(let i=0;i<7;i++){
      const y=49+i*3.2;
      g.beginPath();g.moveTo(62,y);g.bezierCurveTo(280,y+2,620,y-3,938,y+1);g.strokeStyle=i%2?'#dca09116':'#0a071c3b';g.lineWidth=.8;g.stroke();
      g.beginPath();g.moveTo(62,H-y);g.bezierCurveTo(330,H-y-3,670,H-y+3,938,H-y);g.stroke();
    }
    g.restore();
    const felt=g.createRadialGradient(450,240,40,W/2,H/2,520);felt.addColorStop(0,'#176b67');felt.addColorStop(.55,'#105851');felt.addColorStop(1,'#073d3e');
    rounded(g,B.left-8,B.top-8,B.right-B.left+16,B.bottom-B.top+16,20,felt,'#030e19',3);
    g.save();g.beginPath();g.roundRect(B.left-5,B.top-5,B.right-B.left+10,B.bottom-B.top+10,16);g.clip();
    let seed=491;
    for(let i=0;i<13000;i++){
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;const x=B.left+(seed/4294967296)*(B.right-B.left);
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;const y=B.top+(seed/4294967296)*(B.bottom-B.top);
      g.fillStyle=i%2?'#a4eac908':'#001b220e';g.fillRect(x,y,.7,1.4);
    }
    for(let y=B.top+2;y<B.bottom;y+=4)line(g,[[B.left,y],[B.right,y]],'#8acfb203',.6);
    g.globalAlpha=.18;joker(g,500,290,87);g.globalAlpha=.2;g.fillStyle='#9bdec3';g.font='700 10px Arial,sans-serif';spaced(g,'DARK CARNIVAL BILLIARDS',500,390,3.1);g.globalAlpha=1;
    // Head string and foot spot aid placement without distracting from aim lines.
    const head=B.left+(B.right-B.left)*.25,foot=B.left+(B.right-B.left)*.75;
    g.setLineDash([4,8]);line(g,[[head,B.top+12],[head,B.bottom-12]],'#a4d7c31a',1);g.setLineDash([]);
    circle(g,head,H/2,2.4,'#c5e0c65c');circle(g,foot,H/2,2.4,'#c5e0c65c');g.restore();
    // The rail's inside edge and rounded endpoints use the physics geometry.
    for(const rail of cushions||[]){
      const {ax,ay,bx,by,nx,ny}=rail,dx=bx-ax,dy=by-ay,len=Math.hypot(dx,dy),tx=dx/len,ty=dy/len;
      const depth=22,flare=13;
      polygon(g,[[ax,ay],[bx,by],[bx-nx*depth+tx*flare,by-ny*depth+ty*flare],[ax-nx*depth-tx*flare,ay-ny*depth-ty*flare]],'#093d38','#082922',1);
      polygon(g,[[ax-nx*3,ay-ny*3],[bx-nx*3,by-ny*3],[bx-nx*depth+tx*flare,by-ny*depth+ty*flare],[ax-nx*depth-tx*flare,ay-ny*depth-ty*flare]],'#247264');
      line(g,[[ax,ay],[bx,by]],'#77b99b',1.4);
      line(g,[[ax-nx*depth-tx*flare,ay-ny*depth-ty*flare],[bx-nx*depth+tx*flare,by-ny*depth+ty*flare]],'#7297817a',1);
      line(g,[[ax,ay],[ax-nx*depth-tx*flare,ay-ny*depth-ty*flare]],'#051e22',2);
      line(g,[[bx,by],[bx-nx*depth+tx*flare,by-ny*depth+ty*flare]],'#051e22',2);
    }
    for(const pocket of pockets){
      const {x,y,r}=pocket;
      const brass=g.createLinearGradient(x-r,y-r,x+r,y+r);brass.addColorStop(0,'#d1ba83');brass.addColorStop(.4,'#725234');brass.addColorStop(.7,'#e2c588');brass.addColorStop(1,'#4b3441');
      circle(g,x,y,r+5,'#100d18',brass,2.5);
      const well=g.createRadialGradient(x-5,y-5,1,x,y,r);well.addColorStop(0,'#0c1019');well.addColorStop(.6,'#04070b');well.addColorStop(1,'#020306');circle(g,x,y,r,well);
      g.save();g.beginPath();g.arc(x,y,r-3,0,TAU);g.clip();
      for(let i=-3;i<=3;i++){line(g,[[x-r,y+i*8],[x+r,y+i*8]],'#9d93700b',1);line(g,[[x+i*8,y-r],[x+i*8,y+r]],'#9d93700b',1);}g.restore();
      g.beginPath();g.arc(x,y,r+2,Math.PI*1.08,Math.PI*1.82);g.strokeStyle='#f1dfb55c';g.lineWidth=1.5;g.stroke();
    }
    const diamond=(x,y,vertical=false)=>{g.save();g.translate(x,y);if(vertical)g.rotate(Math.PI/2);polygon(g,[[0,-4.5],[3.3,0],[0,4.5],[-3.3,0]],'#dfd5ad','#2a1528',1);g.restore();};
    for(const k of [1,2,3,5,6,7]){const x=B.left+(B.right-B.left)*k/8;diamond(x,53);diamond(x,H-53);}
    for(const k of [1,2,3]){const y=B.top+(B.bottom-B.top)*k/4;diamond(47,y,true);diamond(W-47,y,true);}
    for(const [x,word] of [[285,'JUGGALO'],[715,'POOL · EIGHT BALL']]){
      rounded(g,x-72,H-41,144,17,5,'#120d18','#ae8a54',.7);g.fillStyle='#d1bb8b';g.font='700 8.5px Arial,sans-serif';spaced(g,word,x,H-29,1.9);
    }
    for(const x of [53,W-53])for(const y of [53,H-53]){circle(g,x,y,2.3,'#d0b47d','#352038',.7);line(g,[[x-1.1,y-1.1],[x+1.1,y+1.1]],'#453142',.6);}
    return c;
  }
  function create(canvas,physics=POOL_PHYSICS){
    const {W,H,R,B,pockets}=physics,ctx=canvas.getContext('2d'),table=background(physics);
    let width=W,height=H,portrait=false,dpr=1,scale=1,offsetX=0,offsetY=0;
    function resize(w,h,turned=false){
      width=Math.max(1,Number.isFinite(w)?w:canvas.clientWidth||W);height=Math.max(1,Number.isFinite(h)?h:canvas.clientHeight||H);portrait=!!turned;
      dpr=clamp(globalThis.devicePixelRatio||1,1,2);
      const vw=portrait?H:W,vh=portrait?W:H;scale=Math.min(width/vw,height/vh);offsetX=(width-vw*scale)/2;offsetY=(height-vh*scale)/2;
      const pixelWidth=Math.max(1,Math.round(width*dpr)),pixelHeight=Math.max(1,Math.round(height*dpr));
      // Repeated network layouts must not clear and reallocate the backing surface.
      if(canvas.width!==pixelWidth)canvas.width=pixelWidth;
      if(canvas.height!==pixelHeight)canvas.height=pixelHeight;
      return{width,height,portrait,scale};
    }
    function point(clientX,clientY){
      const rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return null;
      const x=((clientX-rect.left)*width/rect.width-offsetX)/scale,y=((clientY-rect.top)*height/rect.height-offsetY)/scale;
      const wx=portrait?W-y:x,wy=portrait?x:y;
      if(!Number.isFinite(wx)||!Number.isFinite(wy)||wx<0||wy<0||wx>W||wy>H)return null;
      return{x:wx,y:wy};
    }
    function project(x,y){
      const rect=canvas.getBoundingClientRect(),sx=portrait?y:x,sy=portrait?W-x:y;
      return{x:rect.left+(offsetX+sx*scale)*rect.width/width,y:rect.top+(offsetY+sy*scale)*rect.height/height};
    }
    function upright(text,x,y,color,font='700 14px Arial,sans-serif'){
      ctx.save();ctx.translate(x,y);if(portrait)ctx.rotate(Math.PI/2);ctx.fillStyle=color;ctx.font=font;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,0,0);ctx.restore();
    }
    function arrow(x,y,dx,dy,length,color,width=1.8){
      const mag=Math.hypot(dx,dy);if(mag<.0001)return;dx/=mag;dy/=mag;
      const ex=x+dx*length,ey=y+dy*length;
      line(ctx,[[x,y],[ex,ey]],color,width);
      polygon(ctx,[[ex,ey],[ex-dx*7-dy*3.5,ey-dy*7+dx*3.5],[ex-dx*7+dy*3.5,ey-dy*7-dx*3.5]],color);
    }
    function guides(balls,cue,angle,legalIds){
      if(typeof physics.trace!=='function')return;
      const hit=physics.trace(balls,angle);if(!hit||!Number.isFinite(hit.x)||!Number.isFinite(hit.y))return;
      const dx=Math.cos(angle),dy=Math.sin(angle),legal=hit.type!=='ball'||!Array.isArray(legalIds)||legalIds.includes(hit.id);
      const color=legal?'#d0ffdce8':'#ff7d9ceb';
      ctx.save();ctx.beginPath();ctx.rect(B.left-1,B.top-1,B.right-B.left+2,B.bottom-B.top+2);ctx.clip();
      ctx.setLineDash([7,7]);line(ctx,[[cue.x+dx*(R+4),cue.y+dy*(R+4)],[hit.x,hit.y]],'#effff9b8',Math.max(1.5,1/scale));ctx.setLineDash([]);
      if(hit.type==='ball'){
        circle(ctx,hit.x,hit.y,R,'#ffffff12',color,1.7);
        const target=balls.find(b=>b.id===hit.id&&!b.pocketed);
        if(target&&Math.hypot(target.x-hit.x,target.y-hit.y)>.0001){
          const nx=target.x-hit.x,ny=target.y-hit.y,n=Math.hypot(nx,ny),dot=n?(dx*nx+dy*ny)/n:0;
          arrow(target.x+nx/n*(R+2),target.y+ny/n*(R+2),nx,ny,74,color,2);
          const tx=dx-(nx/n)*dot,ty=dy-(ny/n)*dot;
          if(Math.hypot(tx,ty)>.08)arrow(hit.x,hit.y,tx,ty,45,'#f7f5df78',1.5);
        }
      }else if(hit.type==='cushion'&&hit.normal){
        const {x:nx,y:ny}=hit.normal,dot=dx*nx+dy*ny;
        circle(ctx,hit.x,hit.y,3.2,'#effff9');arrow(hit.x,hit.y,dx-2*nx*dot,dy-2*ny*dot,80,'#eaffef73',1.6);
      }else circle(ctx,hit.x,hit.y,4,'#e4ffdf');
      ctx.restore();
    }
    function cueStick(cue,angle,power){
      const pull=16+clamp(power||0,0,1)*28;
      ctx.save();ctx.translate(cue.x,cue.y);ctx.rotate(angle);ctx.globalAlpha=.94;
      const start=-(R+pull),end=start-185;
      const wood=ctx.createLinearGradient(end,-4,start,4);wood.addColorStop(0,'#25172e');wood.addColorStop(.24,'#6d375c');wood.addColorStop(.32,'#d0a568');wood.addColorStop(.91,'#f2dca2');wood.addColorStop(1,'#fff4c8');
      polygon(ctx,[[start,-2],[start,2],[end,4.5],[end,-4.5]],wood,'#190e24',.8);
      ctx.fillStyle='#c7f8ff';ctx.fillRect(start-4,-2.2,4,4.4);ctx.fillStyle='#4aa4b0';ctx.fillRect(start-1.7,-2.25,2,4.5);
      ctx.fillStyle='#b5b696';ctx.fillRect(end+43,-3.9,3,7.8);ctx.fillRect(end+48,-3.8,2,7.6);
      line(ctx,[[end+7,-2],[start-9,-.6]],'#ffffff63',.8);ctx.restore();
    }
    function pocketTargets(options){
      if(!options.callRequired&&!Number.isInteger(options.calledPocket))return;
      for(let i=0;i<pockets.length;i++){
        const p=pockets[i],selected=i===options.calledPocket,r=p.r+9;
        circle(ctx,p.x,p.y,r,null,selected?'#e2ff6d':'#81e6eb',selected?3.7:1.8);
        if(selected){
          ctx.setLineDash([4,5]);circle(ctx,p.x,p.y,r+5,null,'#e2ff6d9c',1.1);ctx.setLineDash([]);
        }
        upright(String(i+1),p.x,p.y,selected?'#e7ff87':'#c9ffff','900 20px Arial,sans-serif');
      }
    }
    function draw(state,options={}){
      ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);ctx.fillStyle='#090a10';ctx.fillRect(0,0,width,height);
      ctx.translate(offsetX,offsetY);ctx.scale(scale,scale);if(portrait){ctx.translate(0,W);ctx.rotate(-Math.PI/2);}
      ctx.drawImage(table,0,0,W,H);
      const balls=Array.isArray(state.balls)?state.balls:[],cue=balls.find(b=>b.id===0&&!b.pocketed),angle=Number.isFinite(options.angle)?options.angle:0;
      pocketTargets(options);
      if(cue&&options.aiming&&options.guide!==false&&!options.placement)guides(balls,cue,angle,options.legalIds);
      if(cue&&options.aiming&&!options.placement){
        circle(ctx,cue.x,cue.y,R+5,null,options.turnColor||'#d5ff75',1.25);cueStick(cue,angle,options.power);
      }
      for(const ball of balls){
        if(ball.pocketed||ball.id===0&&options.placement||!Number.isFinite(ball.x)||!Number.isFinite(ball.y))continue;
        drawBall(ctx,ball.id,ball.x,ball.y,R,portrait);
      }
      const p=options.placement;
      if(p&&Number.isFinite(p.x)&&Number.isFinite(p.y)){
        const color=p.valid?'#dbff78':'#ff769b';circle(ctx,p.x,p.y,R+8,'#071a2377',color,2);
        drawBall(ctx,0,p.x,p.y,R,portrait,.68);
        for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]])line(ctx,[[p.x+dx*(R+11),p.y+dy*(R+11)],[p.x+dx*(R+17),p.y+dy*(R+17)]],color,2);
      }
      ctx.setTransform(dpr,0,0,dpr,0,0);
    }
    resize(canvas.clientWidth||W,canvas.clientHeight||H,false);
    return{resize,draw,point,project};
  }
  return{create,drawBall};
})();
