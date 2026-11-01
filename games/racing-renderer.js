/* Chase-camera renderer. Draws approved standalone assets without atlas cuts.
 * Track coordinates and road-edge placement match the deterministic rules. */
const RACING_RENDERER=(()=>{
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n)),mix=(a,b,t)=>a+(b-a)*t;
  const ROAD_HALF=130,CAMERA_BACK=140,CAMERA_HEIGHT=143,DEPTH=1.05,FAR=2200,STEP=40;
  const ground=[['#293b39','#253634'],['#19362d','#1c3b30'],['#222f38','#25333d']];
  const objectIds={ticket:'ticket-pickup',boost:'boost-pickup',repair:'repair-pickup',cone:'traffic-cone',barrier:'road-barrier',tire:'tire-stack'};
  const objectWidths={ticket:.16,boost:.16,repair:.17,cone:.14,barrier:.26,tire:.21};
  function create(canvas,assets){
    const ctx=canvas.getContext('2d',{alpha:false});
    const motionQuery=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');let reducedMotion=!!motionQuery?.matches;
    let width=1200,height=700,projectionWidth=1200,dpr=1,horizon=220,disposed=false,redraw=true,playerSeat=-1,cameraX=0,currentZone=0,oldZone=0,zoneFade=1,lastTime=-1;
    const nodes=[],sprites=[],labels=[],labelBoxes=[],tireMarks=[],tireHeads=new Map();let ownBox=null,roadPattern=null,dirtPattern=null,edgeGradient=null;
    const motionChanged=event=>{reducedMotion=event.matches;tireMarks.length=0;tireHeads.clear();redraw=true;};
    motionQuery?.addEventListener?.('change',motionChanged);
    if(assets.vectors['asphalt-tile']?.image)roadPattern=ctx.createPattern(assets.vectors['asphalt-tile'].image,'repeat');
    if(assets.vectors['dirt-tile']?.image)dirtPattern=ctx.createPattern(assets.vectors['dirt-tile'].image,'repeat');
    function resize(){
      if(disposed)return;redraw=true;const r=canvas.getBoundingClientRect();width=Math.max(1,r.width||canvas.clientWidth||1200);height=Math.max(1,r.height||canvas.clientHeight||700);dpr=clamp(globalThis.devicePixelRatio||1,1,2);horizon=height*.32;projectionWidth=Math.min(width,height*1.8);
      const pw=Math.round(width*dpr),ph=Math.round(height*dpr);if(canvas.width!==pw)canvas.width=pw;if(canvas.height!==ph)canvas.height=ph;
      edgeGradient=ctx.createLinearGradient(0,0,0,height);edgeGradient.addColorStop(0,'#07101a15');edgeGradient.addColorStop(.55,'#07101a00');edgeGradient.addColorStop(1,'#07101a88');
    }
    const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(resize):null;observer?.observe(canvas);resize();
    function polygon(points,fill){ctx.beginPath();ctx.moveTo(points[0][0],points[0][1]);for(let i=1;i<points.length;i++)ctx.lineTo(points[i][0],points[i][1]);ctx.closePath();ctx.fillStyle=fill;ctx.fill();}
    function band(a,b,inner,outer,fill){polygon([[a.x+a.course*inner,a.y],[a.x+a.course*outer,a.y],[b.x+b.course*outer,b.y],[b.x+b.course*inner,b.y]],fill);}
    function roadQuad(a,b,half,fill){polygon([[a.x-a.course*half,a.y-1.1],[a.x+a.course*half,a.y-1.1],[b.x+b.course*half,b.y+1.1],[b.x-b.course*half,b.y+1.1]],fill);}
    function background(index,alpha,racer){
      const entry=assets.backgrounds[index];if(!entry?.image||alpha<=0)return;
      const image=entry.image,aspect=image.naturalWidth/image.naturalHeight,anchor=entry.meta?.horizon||.45;
      const h=Math.max(width*1.09/aspect,horizon/anchor),w=h*aspect,overflow=w-width;
      const pan=clamp(RACING_RULES.curveAt(racer.z+450)*width*.10+racer.x*width*.025,-overflow/2,overflow/2);
      ctx.save();ctx.globalAlpha=alpha;ctx.drawImage(image,(width-w)/2+pan,horizon-h*anchor,w,h);ctx.restore();
    }
    function makeRoad(racer){
      nodes.length=0;let center=0,heading=0,lastPositive=0;
      for(let distance=-100;distance<=FAR+STEP;distance+=STEP){
        let worldX;
        if(distance<0)worldX=RACING_RULES.curveAt(racer.z)*distance*distance*.000625;
        else{const span=distance-lastPositive;heading+=RACING_RULES.curveAt(racer.z+(distance+lastPositive)/2)*span*.00125;center+=heading*span;lastPositive=distance;worldX=center;}
        const scale=DEPTH/(distance+CAMERA_BACK);
        nodes.push({d:distance,z:racer.z+distance,worldX,scale,x:width/2+(worldX-cameraX*ROAD_HALF)*scale*projectionWidth/2,y:horizon+CAMERA_HEIGHT*scale*height/2,course:ROAD_HALF*scale*projectionWidth/2});
      }
    }
    function point(distance,lateral=0){
      if(distance<-95||distance>FAR+STEP)return null;
      const fi=(distance+100)/STEP,i=clamp(Math.floor(fi),0,nodes.length-2),t=clamp(fi-i,0,1),a=nodes[i],b=nodes[i+1];
      const worldX=mix(a.worldX,b.worldX,t),scale=DEPTH/(distance+CAMERA_BACK);
      return{x:width/2+(worldX+(lateral-cameraX)*ROAD_HALF)*scale*projectionWidth/2,y:horizon+CAMERA_HEIGHT*scale*height/2,course:ROAD_HALF*scale*projectionWidth/2,scale,ratio:CAMERA_BACK/(distance+CAMERA_BACK)};
    }
    function track(state){
      if(roadPattern?.setTransform&&typeof DOMMatrix!=='undefined')roadPattern.setTransform(new DOMMatrix().translate(0,(state.racers[playerSeat].z*1.4)%256));
      for(let i=nodes.length-1;i>0;i--){
        const far=nodes[i],near=nodes[i-1];if(far.y>height+100||near.y<horizon)continue;
        const zone=RACING_RULES.zoneAt(far.z),stripe=Math.floor(far.z/80)&1;
        ctx.fillStyle=ground[zone][0];ctx.fillRect(0,far.y-1,width,Math.max(1,near.y-far.y+2));
        if(zone===0){
          roadQuad(far,near,2.75,'#424b49');
          band(far,near,-1.3,-1.16,'#303b3a');band(far,near,1.16,1.3,'#303b3a');
          if(Math.floor(far.z/160)%3===0){band(far,near,-2.65,-1.8,'#3b4442');band(far,near,1.9,2.6,'#3c4643');}
        }else if(zone===1){
          roadQuad(far,near,2.65,stripe?'#23432e':'#24452f');
          if(Math.floor(far.z/160)%3===0){band(far,near,-2.6,-1.55,'#2b4a33');band(far,near,1.6,2.7,'#2a4832');}
        }else{
          roadQuad(far,near,3.2,'#333e46');
          band(far,near,-1.62,-1.60,'#9da79e66');band(far,near,1.60,1.62,'#9da79e66');
          if(Math.floor(far.z/40)%5===0){const mark=point(far.d-4);if(mark){band(far,mark,-3,-1.6,'#a8b1a87a');band(far,mark,1.6,3,'#a8b1a87a');}}
        }
        roadQuad(far,near,1.12,zone===0?'#797265':zone===1?'#564a49':'#77786c');
        if(dirtPattern){ctx.globalAlpha=.15;roadQuad(far,near,1.12,dirtPattern);ctx.globalAlpha=1;}
        roadQuad(far,near,.94,stripe?'#efdfc4':['#a9433e','#813c72','#3f5e68'][zone]);
        roadQuad(far,near,.86,zone===1?(stripe?'#2d3740':'#2a343d'):(stripe?'#343d42':'#303a3f'));
        if(roadPattern){ctx.globalAlpha=.14;roadQuad(far,near,.86,roadPattern);ctx.globalAlpha=1;}
        band(far,near,-.86,-.845,'#efe6cc');band(far,near,.845,.86,'#efe6cc');
        if(Math.floor(far.z/90)%2===0){band(far,near,-.292,-.28,'#e9e2c49c');band(far,near,.28,.292,'#e9e2c49c');}
        if(far.d>1000){ctx.globalAlpha=clamp((far.d-1000)/1600,0,.48);roadQuad(far,near,1.13,zone===0?'#367074':'#1b5660');ctx.globalAlpha=1;}
      }
      // A high-contrast finish line remains readable below the arrival gantry.
      const d=state.length-state.racers[playerSeat].z,a=point(d),b=point(d+22);
      if(a&&b&&a.y<height+100){for(let c=0;c<12;c++){const l=-.86+c*1.72/12,r=l+1.72/12;band(a,b,l,r,c%2?'#10181d':'#fff2d5');}}
    }
    function roadPaint(player){
      // Directional paint is part of the road, never a new collision object.
      for(let z=Math.ceil((player.z+140)/600)*600;z<player.z+1050;z+=600){
        const bend=RACING_RULES.curveAt(z+160),d=z-player.z;if(Math.abs(bend)<.43)continue;
        const direction=Math.sign(bend),shape=[[-.17,-12],[.02,-12],[.02,-34],[.18,0],[.02,34],[.02,12],[-.17,12]];
        const points=shape.map(([x,dz])=>point(d+dz,x*direction));if(points.some(p=>!p))continue;
        ctx.save();ctx.globalAlpha=.42*clamp((d-140)/100,0,1)*clamp((1050-d)/160,0,1);polygon(points.map(p=>[p.x,p.y]),'#eee5c7');ctx.restore();
      }
    }
    function roadsideFences(player){
      const spacing=180;
      for(let z=Math.floor((player.z+35)/spacing)*spacing;z<player.z+1250;z+=spacing){
        const d=z-player.z;if(d<35)continue;
        const zone=RACING_RULES.zoneAt(z),index=Math.floor(z/spacing);
        for(const side of[-1,1]){
          const a=point(d,side*1.48),b=point(d+spacing,side*1.48);if(!a||!b)continue;
          const ah=height*(zone===1?.095:.075)*a.ratio,bh=height*(zone===1?.095:.075)*b.ratio;
          ctx.save();ctx.globalAlpha=.83*clamp((d-35)/75,0,1)*clamp((1250-d)/180,0,1);
          if(zone===2){
            polygon([[a.x,a.y-ah],[b.x,b.y-bh],[b.x,b.y-bh*.15],[a.x,a.y-ah*.15]],index%2?'#446672':'#893c49');
            polygon([[a.x,a.y-ah*.78],[b.x,b.y-bh*.78],[b.x,b.y-bh*.56],[a.x,a.y-ah*.56]],'#d2cfb5');
          }else{
            ctx.strokeStyle=zone===0?'#71817b':'#86745c';ctx.lineWidth=clamp(2*a.ratio,1,3);
            for(const level of[.25,.8]){ctx.beginPath();ctx.moveTo(a.x,a.y-ah*level);ctx.lineTo(b.x,b.y-bh*level);ctx.stroke();}
            for(let k=0;k<=3;k++){const t=k/3,x=mix(a.x,b.x,t),y=mix(a.y,b.y,t),h=mix(ah,bh,t);ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x,y-h);ctx.stroke();}
            if(zone===0){ctx.globalAlpha*=.45;ctx.beginPath();ctx.moveTo(a.x,a.y-ah*.8);ctx.lineTo(b.x,b.y-bh*.25);ctx.moveTo(a.x,a.y-ah*.25);ctx.lineTo(b.x,b.y-bh*.8);ctx.stroke();}
          }
          if(zone===1){
            for(let k=0;k<4;k++){const t=(k+.5)/4,x=mix(a.x,b.x,t),y=mix(a.y-ah,b.y-bh,t),h=mix(ah,bh,t),w=Math.max(2,Math.abs(a.x-b.x)*.10);polygon([[x-w,y],[x+w,y],[x,y+h*.45]],['#d56f70','#f1c66b','#7ec3bc','#b175bd'][(k+index)%4]);ctx.fillStyle='#ffdf99';ctx.beginPath();ctx.arc(x,y-1,clamp(h*.065,.8,2.5),0,Math.PI*2);ctx.fill();}
          }
          if(zone===2&&index%3===0){const top=a.y-ah*2.7,w=ah*.6;ctx.strokeStyle='#a9bbb9';ctx.lineWidth=Math.max(1,a.ratio*1.5);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(a.x,top);ctx.stroke();polygon([[a.x,top],[a.x+side*w,top+ah*.12],[a.x+side*w*.8,top+ah*.68],[a.x,top+ah*.55]],side<0?'#e4c76c':'#c25466');}
          ctx.restore();
        }
      }
    }
    function nativeScenery(sprite){
      const {p,zone,side,index,d}=sprite,ratio=p.ratio;
      ctx.save();ctx.globalAlpha=clamp((d-15)/65,0,1)*clamp((1450-d)/160,0,1);
      if(zone===0){
        const h=height*.34*ratio,arm=h*.21;ctx.strokeStyle='#223132';ctx.lineWidth=clamp(5*ratio,1.2,5);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x,p.y-h);ctx.lineTo(p.x-side*arm,p.y-h);ctx.stroke();
        ctx.strokeStyle='#9ca59b';ctx.lineWidth=Math.max(1,ratio*1.6);ctx.beginPath();ctx.moveTo(p.x-1,p.y);ctx.lineTo(p.x-1,p.y-h+2);ctx.stroke();
        ctx.fillStyle='#f5dca0';ctx.fillRect(p.x-side*arm-4*ratio,p.y-h,8*ratio,3*ratio);ctx.fillStyle='#f2cc6421';ctx.beginPath();ctx.arc(p.x-side*arm,p.y-h+3*ratio,10*ratio,0,Math.PI*2);ctx.fill();
      }else if(zone===1){
        const h=height*.20*ratio,w=h*.95,x=p.x+side*h*.10;shadow(x,p.y,w*1.15);
        polygon([[x-w*.5,p.y-h*.43],[x-w*.5,p.y],[x+w*.5,p.y],[x+w*.5,p.y-h*.43]],index%2?'#663951':'#3d5d5e');
        for(let k=0;k<3;k++)polygon([[x-w*.59+k*w*.393,p.y-h*.43],[x-w*.197+k*w*.393,p.y-h*.43],[x,p.y-h]],k%2?'#cc9473':'#963f5e');
        ctx.fillStyle='#202c32';ctx.fillRect(x-w*.12,p.y-h*.4,w*.24,h*.4);ctx.strokeStyle='#d3ac74';ctx.lineWidth=Math.max(1,ratio*2);ctx.beginPath();ctx.moveTo(x,p.y-h);ctx.lineTo(x,p.y-h*1.18);ctx.stroke();polygon([[x,p.y-h*1.18],[x+side*w*.24,p.y-h*1.09],[x,p.y-h*.99]],'#e9bf65');
      }else{
        const h=height*.43*ratio,bar=h*.4,top=p.y-h;ctx.strokeStyle='#53696e';ctx.lineWidth=clamp(6*ratio,1,5);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x,top);ctx.moveTo(p.x-bar/2,top);ctx.lineTo(p.x+bar/2,top);ctx.stroke();
        const light=Math.max(1.5,h*.047);for(let k=0;k<4;k++){const x=p.x-bar*.4+k*bar*.267;ctx.fillStyle='#e9e5b9';ctx.fillRect(x-light*.6,top-light,light*1.2,light);ctx.fillStyle='#e9df9c1c';ctx.beginPath();ctx.arc(x,top,light*2,0,Math.PI*2);ctx.fill();}
        for(let k=0;k<5;k++){const x=p.x+side*(h*.10+k*h*.055),r=Math.max(1,h*.025);ctx.fillStyle=['#8d5261','#506c77','#8c855e'][k%3];ctx.fillRect(x-r,p.y-h*.10,r*2,h*.10);ctx.fillStyle='#c4a18c';ctx.beginPath();ctx.arc(x,p.y-h*.125,r,0,Math.PI*2);ctx.fill();}
      }
      ctx.restore();
    }
    function sampleTireMarks(state,player,reset){
      if(reset||reducedMotion){tireMarks.length=0;tireHeads.clear();}
      if(reducedMotion)return;
      for(const racer of state.racers){
        const distance=racer.z-player.z;
        if(!racer.drifting||distance < -60||distance>700){tireHeads.delete(racer.id);continue;}
        const last=tireHeads.get(racer.id);
        if(!last){tireHeads.set(racer.id,{x:racer.x,z:racer.z,time:state.time});continue;}
        const travel=racer.z-last.z;
        if(travel>=14){
          if(travel<75&&state.time-last.time<.35)tireMarks.push({ax:last.x,az:last.z,bx:racer.x,bz:racer.z,time:state.time,kart:assets.riders[racer.racerId]?.meta.vehicle==='kart'});
          tireHeads.set(racer.id,{x:racer.x,z:racer.z,time:state.time});
        }
      }
      while(tireMarks.length&&(tireMarks.length>120||state.time-tireMarks[0].time>1.35))tireMarks.shift();
    }
    function drawTireMarks(state,player){
      if(reducedMotion||!tireMarks.length)return;
      ctx.save();ctx.strokeStyle='#0b151ac9';ctx.lineCap='round';
      for(const mark of tireMarks){
        const fade=clamp(1-(state.time-mark.time)/1.35,0,1);
        for(const offset of mark.kart?[-.075,.075]:[0]){
          const a=point(mark.az-player.z,mark.ax+offset),b=point(mark.bz-player.z,mark.bx+offset);
          if(!a||!b||a.y>height+30||b.y<horizon)continue;
          ctx.globalAlpha=fade*.48;ctx.lineWidth=clamp(b.course*.018,1,4);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
        }
      }
      ctx.restore();
    }
    function driftSparks(racer,p,state,visibleWidth){
      if(reducedMotion||!racer.drifting||(racer.driftCharge||0)<.65||p.ratio<.18)return;
      const direction=racer.driftDirection||Math.sign(racer.steer)||1;
      ctx.save();ctx.strokeStyle=racer.driftCharge>=1.4?'#ffdb7a':'#8ae8e8';ctx.lineWidth=clamp(1.6*p.ratio,.8,2);
      for(let i=0;i<4;i++){
        const t=(state.time*6+i*.23+racer.id*.13)%1,x=p.x-direction*(visibleWidth*.27+t*12*p.ratio),y=p.y+(2+t*7)*p.ratio;
        ctx.globalAlpha=(1-t)*.75;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-direction*(3+t*3)*p.ratio,y+2*p.ratio);ctx.stroke();
      }
      ctx.restore();
    }
    function dimensions(entry){
      const m=entry.meta?.sprite||entry.meta||{},w=m.width||entry.image.naturalWidth,h=m.height||entry.image.naturalHeight;
      const b=m.alphaBounds,box=Array.isArray(b)?{x:b[0],y:b[1],w:b[2]-b[0],h:b[3]-b[1]}:b||{x:0,y:0,w,h};
      const anchor=m.anchor?.normalized||[m.anchor?.x??.5,m.anchor?.y??.875];
      return{w,h,visibleW:box.w/w,visibleH:box.h/h,anchorX:anchor[0],anchorY:anchor[1]};
    }
    const riderGeometry=Object.fromEntries(Object.entries(assets.riders).map(([id,e])=>[id,dimensions(e)]));
    const vectorGeometry=Object.fromEntries(Object.entries(assets.vectors).map(([id,e])=>[id,dimensions(e)]));
    function vector(id,p,visibleWidth,options={}){
      const entry=assets.vectors[id],g=vectorGeometry[id];if(!entry||!g||visibleWidth<2)return;
      const w=visibleWidth/Math.max(.1,g.visibleW),h=w*g.h/g.w;if(p.x+w<0||p.x-w>width||p.y-h>height)return;
      ctx.save();ctx.translate(p.x,p.y);if(options.flip)ctx.scale(-1,1);ctx.globalAlpha=options.alpha??1;ctx.drawImage(entry.image,-w*g.anchorX,-h*g.anchorY,w,h);ctx.restore();
    }
    function shadow(x,y,w){ctx.save();ctx.fillStyle='#030a0bcc';ctx.beginPath();ctx.ellipse(x,y,w*.47,Math.max(2,w*.12),0,0,Math.PI*2);ctx.fill();ctx.restore();}
    // Articulation uses hand-mapped regions of each standalone 512px rider.
    // Layers are cached once; source artwork and transparent edges stay intact.
    const rigs={},poses=new Map(),TAU=Math.PI*2;
    const rigSpec={
      'violent-j':{head:[[212,5],[328,5],[328,99],[309,99],[276,86],[254,80],[228,79],[212,79]],pivot:[266,84],profile:true,neck:'#bc8657',wheels:[[256,421,36,65,'block']]},
      'shaggy-2-dope':{head:[[221,23],[324,23],[324,114],[297,114],[281,108],[253,108],[237,111],[221,103]],pivot:[267,108],profile:true,neck:'#b97d51',wheels:[[87,386,48,63,'slick'],[426,386,48,63,'slick']],hubs:[[134,389,6,37],[379,389,6,37]]},
      'mad-man-pondo':{head:[[204,39],[301,39],[309,115],[281,125],[256,122],[230,122],[204,115]],pivot:[256,116],neck:'#b87c52',wheels:[[79,385,48,65,'slick'],[432,385,48,65,'slick']],hubs:[[128,387,6,39],[383,387,6,39]]},
      'dani-mo':{head:[[180,9],[365,9],[365,136],[180,136]],pivot:[264,118],soft:18,eraseBottom:121,wheels:[[68,402,45,71,'chevron'],[447,402,44,71,'chevron']],front:[{region:[[64,217],[77,201],[122,201],[144,220],[142,287],[126,307],[79,305],[62,280]],wheel:[104,255,31,46,'chevron']},{region:[[369,219],[387,201],[432,201],[448,216],[450,281],[434,306],[387,307],[369,287]],wheel:[409,255,31,46,'chevron']}]},
      '2-tuff-tony':{head:[[190,24],[345,24],[345,111],[310,120],[285,113],[239,114],[218,116],[190,104]],pivot:[269,112],profile:true,neck:'#b67a4e',wheels:[[256,419,35,59,'block']]},
      'big-foot':{head:[[187,2],[332,2],[335,112],[184,112]],pivot:[258,104],soft:28,eraseBottom:85,wheels:[[256,429,34,53,'chevron']]}
    };
    function regionPath(context,points){context.beginPath();context.moveTo(points[0][0],points[0][1]);for(let i=1;i<points.length;i++)context.lineTo(points[i][0],points[i][1]);context.closePath();}
    function layer(image,points){
      const x=Math.floor(Math.min(...points.map(p=>p[0])))-2,y=Math.floor(Math.min(...points.map(p=>p[1])))-2,w=Math.ceil(Math.max(...points.map(p=>p[0])))-x+3,h=Math.ceil(Math.max(...points.map(p=>p[1])))-y+3;
      const c=document.createElement('canvas');c.width=w;c.height=h;const context=c.getContext('2d');context.translate(-x,-y);regionPath(context,points);context.clip();context.drawImage(image,0,0,512,512);return{image:c,x,y};
    }
    function prepareWheel(wheel,image){
      const[x,y,rx,ry,kind]=wheel,c=document.createElement('canvas');c.width=Math.ceil(rx*2+4);c.height=Math.ceil(ry*2+4);const context=c.getContext('2d'),gradient=context.createLinearGradient(0,0,c.width,0);
      gradient.addColorStop(0,'#030913d9');gradient.addColorStop(.2,'#03091345');gradient.addColorStop(.48,'#0000');gradient.addColorStop(.75,'#03091335');gradient.addColorStop(1,'#030913d9');
      context.fillStyle=gradient;context.beginPath();context.ellipse(rx+2,ry+2,rx,ry,0,0,TAU);context.fill();
      const texture=document.createElement('canvas'),strip=Math.ceil(ry*.9);texture.width=Math.ceil(rx*2);texture.height=strip*2;const scale=(image.naturalWidth||image.width)/512,tc=texture.getContext('2d');
      const paint=()=>tc.drawImage(image,(x-rx*.9)*scale,(y-ry*.45)*scale,rx*1.8*scale,ry*.9*scale,0,0,texture.width,strip);
      paint();tc.translate(0,texture.height);tc.scale(1,-1);paint();
      return{x,y,rx,ry,kind,surface:c,texture};
    }
    for(const[id,spec]of Object.entries(rigSpec)){
      const entry=assets.riders[id];if(!entry?.image)continue;
      const base=document.createElement('canvas');base.width=base.height=512;const context=base.getContext('2d');context.drawImage(entry.image,0,0,512,512);
      context.save();regionPath(context,spec.head);context.clip();
      if(spec.soft){const fade=context.createLinearGradient(0,spec.eraseBottom-spec.soft,0,spec.eraseBottom);fade.addColorStop(0,'#000');fade.addColorStop(1,'#0000');context.globalCompositeOperation='destination-out';context.fillStyle=fade;context.fillRect(0,0,512,spec.eraseBottom);}
      else context.clearRect(0,0,512,512);context.restore();
      const front=(spec.front||[]).map(part=>{const cut=layer(entry.image,part.region);context.save();regionPath(context,part.region);context.clip();context.clearRect(0,0,512,512);context.restore();return{...cut,wheel:prepareWheel(part.wheel,entry.image)};});
      const head=layer(entry.image,spec.head);
      if(spec.soft){const hc=head.image.getContext('2d'),fade=hc.createLinearGradient(0,head.image.height-spec.soft,0,head.image.height);fade.addColorStop(0,'#000');fade.addColorStop(1,'#0000');hc.setTransform(1,0,0,1,0,0);hc.globalCompositeOperation='destination-in';hc.fillStyle=fade;hc.fillRect(0,0,head.image.width,head.image.height);}
      rigs[id]={base,head,spec,wheels:spec.wheels.map(w=>prepareWheel(w,entry.image)),front};
    }
    function updatePoses(state,dt,reset){
      if(reset)poses.clear();const blend=1-Math.exp(-Math.max(0,dt)*12),seen=new Set();
      for(const racer of state.racers){
        seen.add(racer.id);const target=clamp(Number(racer.steer)||0,-1,1);let pose=poses.get(racer.id);
        if(!pose||pose.racerId!==racer.racerId){pose={racerId:racer.racerId,steer:target,face:target<-.1?1:0};poses.set(racer.id,pose);}
        else{pose.steer=mix(pose.steer,target,blend);pose.face=mix(pose.face,target<-.1?1:0,blend);}
        // Distance, not elapsed animation time: stopped and paused wheels stay still.
        pose.phase=reducedMotion?.35:((racer.z||0)*.085)%TAU;
      }
      for(const id of poses.keys())if(!seen.has(id))poses.delete(id);
    }
    function rollingTire(wheel,phase){
      const{x,y,rx,ry,kind,texture}=wheel;
      ctx.save();ctx.beginPath();ctx.ellipse(x,y,rx*.96,ry*.97,0,0,TAU);ctx.clip();ctx.fillStyle='#151d24';ctx.fillRect(x-rx,y-ry,rx*2,ry*2);
      const offset=((phase/TAU)%1+1)%1*texture.height;
      for(let yy=y-ry-offset;yy<y+ry;yy+=texture.height-1)ctx.drawImage(texture,x-rx,yy,rx*2,texture.height);
      ctx.drawImage(wheel.surface,x-rx-2,y-ry-2);
      if(kind==='slick')for(let i=0;i<7;i++){
        const angle=((phase+i*TAU/7+Math.PI)%TAU+TAU)%TAU-Math.PI;if(Math.abs(angle)>Math.PI/2)continue;
        const yy=y+Math.sin(angle)*ry;ctx.strokeStyle='#b9c5c52b';ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(x-rx,yy);ctx.quadraticCurveTo(x,yy+3*Math.cos(angle),x+rx,yy);ctx.stroke();
      }
      ctx.restore();
    }
    function articulatedRider(racer,w,h,g){
      const rig=rigs[racer.racerId];if(!rig){ctx.drawImage(assets.riders[racer.racerId].image,-w*g.anchorX,-h*g.anchorY,w,h);return;}
      const pose=poses.get(racer.id)||{steer:0,face:0,phase:0},turn=pose.steer;
      ctx.save();ctx.translate(-w*g.anchorX,-h*g.anchorY);ctx.scale(w/512,h/512);
      for(const front of rig.front){const wheel=front.wheel;ctx.save();ctx.translate(wheel.x,wheel.y);ctx.rotate(turn*.13);ctx.transform(1-Math.abs(turn)*.16,0,-turn*.09,1,0,0);ctx.translate(-wheel.x,-wheel.y);ctx.drawImage(front.image,front.x,front.y);rollingTire(wheel,pose.phase*1.12);ctx.restore();}
      const[px,py]=rig.spec.pivot;if(rig.spec.neck){ctx.fillStyle=rig.spec.neck;ctx.beginPath();ctx.ellipse(px,py+3,20,10,0,0,TAU);ctx.fill();}
      ctx.drawImage(rig.base,0,0);
      for(const wheel of rig.wheels)rollingTire(wheel,pose.phase);
      for(const[x,y,rx,ry]of rig.spec.hubs||[]){ctx.save();ctx.strokeStyle='#d2d5cb91';ctx.lineWidth=1.6;ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,TAU);ctx.clip();for(let i=0;i<5;i++){const a=pose.phase+i*TAU/5;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+Math.cos(a)*rx,y+Math.sin(a)*ry);ctx.stroke();}ctx.restore();}
      const head=rig.head;
      ctx.save();ctx.translate(px+turn*(rig.spec.soft?4:7),py+Math.abs(turn)*1.5);ctx.rotate(turn*(reducedMotion?.09:rig.spec.soft?.11:.15));ctx.transform(1-Math.abs(turn)*.07,0,turn*.07,1,0,0);
      if(rig.spec.profile){
        if(pose.face<.995){ctx.globalAlpha=1-pose.face;ctx.drawImage(head.image,head.x-px,head.y-py);}
        if(pose.face>.005){ctx.save();ctx.globalAlpha=pose.face;ctx.scale(-1,1);ctx.drawImage(head.image,head.x-px,head.y-py);ctx.restore();}
      }else ctx.drawImage(head.image,head.x-px,head.y-py);
      ctx.restore();ctx.restore();
    }

    function vehicle(racer,p,state,own,distance){
      const entry=assets.riders[racer.racerId],g=riderGeometry[racer.racerId];if(!entry||!g)return;
      const visibleHeight=height*(own?(width>height*1.7?.35:.29):(width>height*1.7?.29:.245))*p.ratio;if(visibleHeight<5)return;
      const h=visibleHeight/Math.max(.1,g.visibleH),w=h*g.w/g.h,visibleWidth=w*g.visibleW;
      if(p.x+visibleWidth<0||p.x-visibleWidth>width||p.y-visibleHeight>height)return;
      const bounce=reducedMotion?0:Math.sin(state.time*22+racer.id*2)*Math.min(1,racer.speed/130)*height*.0013*p.ratio;
      const turbo=(racer.driftTurbo||0)>0,charge=racer.driftCharge||0,driftColor=charge>=1.4?'#ffdb7ab3':'#8ae8e8aa';
      shadow(p.x,p.y,visibleWidth*.89);
      if(own){ownBox={x:p.x-visibleWidth*.58,y:p.y-visibleHeight-12,w:visibleWidth*1.16,h:visibleHeight+30};ctx.save();ctx.strokeStyle=racer.invulnerable>0?'#ed986bb3':racer.drifting?driftColor:turbo?'#a5e8ffb3':'#b9ef4288';ctx.lineWidth=racer.invulnerable>0?3:2;ctx.beginPath();ctx.ellipse(p.x,p.y,visibleWidth*.53,Math.max(3,visibleWidth*.13),0,0,Math.PI*2);ctx.stroke();ctx.restore();}
      driftSparks(racer,p,state,visibleWidth);
      if((racer.boosting||turbo)&&!reducedMotion){
        ctx.save();ctx.globalAlpha=.55;ctx.shadowColor=turbo?'#91dfff':'#b9ef42';ctx.shadowBlur=9*p.ratio;
        const length=clamp(visibleHeight*(turbo?.55:.8),8,height*.32);
        for(const side of[-1,1]){const x=p.x+side*visibleWidth*.18;polygon([[x-3*p.ratio,p.y-5*p.ratio],[x+3*p.ratio,p.y-5*p.ratio],[x+side*visibleWidth*.08,p.y+length]],turbo?'#96e5ff':side<0?'#c0ff5c':'#7be8e2');}ctx.restore();
      }
      const steer=poses.get(racer.id)?.steer||0,kart=entry.meta.vehicle==='kart';
      ctx.save();ctx.translate(p.x,p.y+bounce);const lean=racer.drifting?(racer.driftDirection||Math.sign(racer.steer))*(reducedMotion?.045:.095)+steer*.02:steer*(kart?.045:.09);ctx.rotate(clamp(lean,-.135,.135)*Math.min(1,racer.speed/70));
      articulatedRider(racer,w,h,g);
      ctx.restore();
      if(!own&&distance>45&&distance<650&&visibleHeight>23&&p.y<height*.82){
        labels.push({text:(entry.meta.name||racer.racerId)+(Number.isInteger(racer.playerSeat)?' · P'+(racer.playerSeat+1):''),color:entry.meta.color||'#f3e8cf',x:p.x,y:p.y-visibleHeight-8,d:distance});
      }
    }
    function drawLabels(){
      const font=height<280?10:width<600?11:12,limit=width<600?2:3,gap=4;
      ctx.font=`800 ${font}px Arial,sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
      labelBoxes.length=0;if(ownBox)labelBoxes.push(ownBox);
      labels.sort((a,b)=>a.d-b.d);let shown=0;
      for(const label of labels){
        if(shown>=limit)break;
        const w=ctx.measureText(label.text).width+14,h=font+10,x=label.x-w/2;
        if(x<8||x+w>width-8)continue;
        let y=label.y-h,clear=false;
        for(let attempt=0;attempt<2;attempt++){
          if(y<Math.max(horizon+5,90))break;
          clear=!labelBoxes.some(b=>x<b.x+b.w+gap&&x+w>b.x-gap&&y<b.y+b.h+gap&&y+h>b.y-gap);
          if(clear)break;y-=h+gap;
        }
        if(!clear)continue;
        ctx.fillStyle='#09151ee8';ctx.fillRect(x,y,w,h);ctx.fillStyle=label.color;ctx.fillRect(x,y,2,h);
        ctx.fillStyle='#f6f0dd';ctx.fillText(label.text,label.x,y+h/2+.5);
        labelBoxes.push({x,y,w,h});shown++;
      }
    }
    function populate(state,player){
      sprites.length=0;labels.length=0;ownBox=null;
      for(const object of state.objects){const d=object.z-player.z;if(d<-18||d>1800||object.collectedBy.includes(player.id))continue;const p=point(d,object.x);if(p)sprites.push({d,type:'object',object,p});}
      // A single outside-bend sign gives direction without a wall of arrows.
      // Passed scenery fades before its perspective can overwhelm the rider.
      for(let z=Math.floor(player.z/720)*720;z<player.z+1500;z+=720){
        const d=z-player.z;if(z<0||z>state.length||d<18)continue;
        const curve=RACING_RULES.curveAt(z);if(Math.abs(curve)<.32)continue;
        const side=curve>0?-1:1,p=point(d,side*1.27);
        if(p)sprites.push({d,type:'scenery',id:'warning-arrow',p,curve});
      }
      for(let z=Math.floor(player.z/480)*480;z<player.z+1450;z+=480){
        const d=z-player.z;if(z<0||z>state.length||d<15)continue;
        const zone=RACING_RULES.zoneAt(z),index=Math.round(z/480);
        for(const side of[-1,1]){if(zone!==1&&(index%2===0?side>0:side<0))continue;const p=point(d,side*(zone===1?2.18:1.88));if(p)sprites.push({d,type:'native',p,zone,side,index});}
      }
      for(const z of[5000,10000,state.length]){const d=z-player.z,p=point(d);if(p&&d>-75&&d<FAR)sprites.push({d,type:'arch',id:z===state.length?'finish-gantry':'checkpoint-banner',p});}
      for(const racer of state.racers){const own=racer.id===player.id,d=racer.z-player.z;if(!own&&(d<-42||d>FAR))continue;const p=point(d,racer.x);if(p)sprites.push({d,type:'racer',racer,p,own});}
      sprites.sort((a,b)=>Number(!!a.own)-Number(!!b.own)||b.d-a.d);
      for(const sprite of sprites){const p=sprite.p;if(sprite.type==='racer')vehicle(sprite.racer,p,state,sprite.own,sprite.d);
        else if(sprite.type==='native')nativeScenery(sprite);
        else if(sprite.type==='object'){
          const o=sprite.object,pickup=['ticket','boost','repair'].includes(o.kind);
          if(pickup){const radius=Math.max(3,p.course*.13);ctx.save();ctx.fillStyle=o.kind==='ticket'?'#f5bd493b':o.kind==='boost'?'#b9ef4238':'#ff6b7133';ctx.beginPath();ctx.ellipse(p.x,p.y,radius,radius*.24,0,0,Math.PI*2);ctx.fill();ctx.restore();}
          vector(objectIds[o.kind],p,p.course*objectWidths[o.kind]*1.5,{alpha:clamp((sprite.d+18)/30,0,1)});
        }else if(sprite.type==='arch')vector(sprite.id,p,p.course*2.55);
        else vector(sprite.id,p,p.course*(sprite.id==='warning-arrow'?.24:.22),{flip:sprite.id==='warning-arrow'&&sprite.curve<0,alpha:clamp((sprite.d-18)/80,0,1)*clamp((1600-sprite.d)/200,0,1)});
      }
      drawLabels();
    }
    function effects(state,player){
      if((player.boosting||(player.driftTurbo||0)>0)&&!reducedMotion){ctx.save();ctx.strokeStyle='#d2f9df';ctx.lineWidth=1.5;ctx.globalAlpha=.18;for(let i=0;i<8;i++){const side=i%2?-1:1,t=((state.time*1.6+i*.143)%1),x=width/2+side*width*(.18+t*.42),y=horizon+height*(.08+(i%5)*.11);ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+side*height*.08,y+height*.065);ctx.stroke();}ctx.restore();}
      ctx.fillStyle=edgeGradient;ctx.fillRect(0,0,width,height);
      if(state.phase==='countdown'||state.phase==='racing'&&state.time<.8){
        const ready=state.phase==='countdown',label=ready?String(Math.max(1,Math.ceil(state.countdown))):'GO!';
        ctx.save();ctx.translate(width/2,height*.46);if(!ready)ctx.globalAlpha=1-clamp(state.time/.8,0,1);
        const size=Math.min(width*.22,height*.22);ctx.fillStyle='#07121bba';ctx.beginPath();ctx.arc(0,0,size*.65,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#b9ef42';ctx.lineWidth=3;ctx.stroke();ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`900 ${size}px Impact,Arial Black,sans-serif`;ctx.fillStyle=ready?'#fff2d0':'#b9ef42';ctx.fillText(label,0,2);ctx.font=`800 ${Math.max(8,size*.12)}px Arial,sans-serif`;ctx.fillStyle='#dde8d7';ctx.fillText(ready?'GET READY':'RACE TO THE SHOW',0,size*.85);ctx.restore();
      }
    }
    function draw(state,index=0,dt=0){
      if(disposed||!state?.racers?.length)return;const player=state.racers.find(r=>r.id===index)||state.racers[0];
      const reset=playerSeat!==player.id||state.time<lastTime;playerSeat=player.id;lastTime=state.time;
      if(reset)cameraX=player.x*.68;else cameraX=mix(cameraX,player.x*.68,clamp(dt*8,0,1));
      const zone=RACING_RULES.zoneAt(player.z);if(reset){currentZone=oldZone=zone;zoneFade=1;}else if(zone!==currentZone){oldZone=currentZone;currentZone=zone;zoneFade=0;}zoneFade=clamp(zoneFade+Math.max(0,dt)*1.8,0,1);
      ctx.setTransform(dpr,0,0,dpr,0,0);ctx.globalAlpha=1;ctx.fillStyle='#0e2630';ctx.fillRect(0,0,width,height);
      if(zoneFade<1)background(oldZone,1,player);background(currentZone,zoneFade,player);
      updatePoses(state,dt,reset);makeRoad(player);sampleTireMarks(state,player,reset);track(state);roadPaint(player);roadsideFences(player);drawTireMarks(state,player);populate(state,player);effects(state,player);redraw=false;
    }
    function dispose(){disposed=true;observer?.disconnect();motionQuery?.removeEventListener?.('change',motionChanged);tireMarks.length=0;tireHeads.clear();nodes.length=0;sprites.length=0;labels.length=0;labelBoxes.length=0;roadPattern=null;dirtPattern=null;poses.clear();for(const rig of Object.values(rigs)){for(const image of[rig.base,rig.head.image,...rig.front.map(p=>p.image),...rig.wheels.flatMap(w=>[w.surface,w.texture]),...rig.front.flatMap(p=>[p.wheel.surface,p.wheel.texture])]){image.width=1;image.height=1;}}}
    return{draw,resize,dispose,get needsRedraw(){return redraw;}};
  }
  return{create};
})();
