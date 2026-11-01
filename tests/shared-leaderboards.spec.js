import {test,expect} from '@playwright/test';
import fs from 'node:fs';
const clientSource=fs.readFileSync(new URL('../games/leaderboards.js',import.meta.url),'utf8'),clientMarkup=fs.readFileSync(new URL('../games/leaderboards.html',import.meta.url),'utf8');
const games=['poker','racing','pool','ladder','rumble','chicken','claw','shooter','ttt','chess','checkers','pinball','faygo','bj','memory','camper','solitaire','j31','hockey'];
const row=(uid,name,v)=>({uid,name,v,tag:'SOLO RUN',t:1700000000000});
async function embedded(page,baseURL,{auto=true,origin=baseURL}={}){
  await page.route(origin+'/ranking-host',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden}iframe{width:100%;height:100%;border:0}</style><iframe id="game" src="${baseURL}/game.html"></iframe><script>
    window.rankRequests=[];window.legacy=[];window.rankAuto=${JSON.stringify(auto)};window.rankSignedIn=true;window.rankError=null;window.rankRows={};window.rankOwn={};
    window.reply=(request,extra={})=>document.querySelector('#game').contentWindow.postMessage({type:'jcw-arcade-rankings-response',v:1,id:request.id,action:request.action,g:request.g,ok:true,signedIn:true,...extra},new URL(document.querySelector('#game').src).origin);
    window.addEventListener('message',event=>{const m=event.data;if(m?.type==='jcw-arcade')legacy.push(m);if(m?.type!=='jcw-arcade-rankings')return;rankRequests.push(m);if(!rankAuto)return;
      if(rankError)return reply(m,{ok:false,signedIn:rankSignedIn,error:rankError});
      if(m.action==='status')reply(m,{signedIn:rankSignedIn});else if(!rankSignedIn)reply(m,{ok:false,signedIn:false,error:'signed-out'});else if(m.action==='submit')reply(m,{accepted:true});else reply(m,{rows:rankRows[m.g]||[],own:rankOwn[m.g]||null});});
  </script>`}));
  await page.goto(origin+'/ranking-host');
  const frame=await(await page.locator('#game').elementHandle()).contentFrame();await frame.waitForFunction(()=>window.LB_READY);await frame.evaluate(()=>{ARCADE.Sound.on=false;});return frame;
}
async function request(page,action,g){await expect.poll(()=>page.evaluate(({action,g})=>rankRequests.filter(r=>r.action===action&&r.g===g).length,{action,g})).toBeGreaterThan(0);return page.evaluate(({action,g})=>rankRequests.filter(r=>r.action===action&&r.g===g).at(-1),{action,g});}

test('every game submits an eligible run outside device top10 without adding new badge events',async({page,baseURL})=>{
  const frame=await embedded(page,baseURL);
  await frame.evaluate(games=>{for(const g of games){const list=ARCADE.LB.board(g);for(let i=0;i<10;i++)list.push({name:'AAA',v:['chess','checkers'].includes(g)?i+1:1000+i,tag:'OLD',t:1700000000000});ARCADE.LB.check(g,100,'NEW RUN');}},games);
  await expect.poll(()=>page.evaluate(()=>rankRequests.filter(r=>r.action==='submit').length)).toBe(19);
  expect(await page.evaluate(()=>rankRequests.filter(r=>r.action==='submit').map(r=>r.g))).toEqual(games);
  expect(await page.evaluate(()=>rankRequests.filter(r=>r.action==='submit').every(r=>r.score===100&&r.tag==='NEW RUN'&&/^[A-Z0-9-]{3}$/.test(r.initials)&&!('uid'in r)&&!('name'in r)))).toBe(true);
  await expect(frame.locator('#lbModal')).toBeHidden();expect(await frame.evaluate(()=>ARCADE.LB.debug.forcePending())).toBeNull();
  expect(await page.evaluate(()=>legacy.filter(m=>['poker','racing'].includes(m.g)))).toEqual([]);
  expect(await page.evaluate(()=>legacy.filter(m=>m.ev==='win').length)).toBe(17);
});

test('shared requests dispatch three at a time in FIFO order with a bounded queue lifetime',async({page,baseURL})=>{
  await page.clock.install();const frame=await embedded(page,baseURL,{auto:false});
  await frame.evaluate(()=>{for(let i=1;i<=40;i++)ARCADE.LB.check('racing',i,'RUN '+i);});
  await expect.poll(()=>page.evaluate(()=>rankRequests.length)).toBe(3);
  expect(await page.evaluate(()=>rankRequests.map(r=>r.score))).toEqual([1,2,3]);
  const first=await page.evaluate(()=>rankRequests[0]);await page.evaluate(r=>reply(r,{accepted:true}),first);
  await expect.poll(()=>page.evaluate(()=>rankRequests.length)).toBe(4);
  expect(await page.evaluate(()=>rankRequests[3].score)).toBe(4);
  // Fourteen dispatched requests at most before the shared 30s deadline;
  // queued results cannot silently accumulate behind a stalled host forever.
  for(let i=0;i<4;i++)await page.clock.fastForward(8001);
  const before=await page.evaluate(()=>rankRequests.length);expect(before).toBeLessThanOrEqual(14);
  await frame.evaluate(()=>ARCADE.LB.check('poker',900,'AFTER TIMEOUT'));
  await expect.poll(()=>page.evaluate(()=>rankRequests.filter(r=>r.g==='poker').length)).toBe(1);
  await page.clock.fastForward(8001);await frame.evaluate(()=>ARCADE.LB.show('racing'));await expect(frame.locator('#lbCloudStatus')).toContainText('unavailable');
});

test('a resumed background tab never dispatches already expired queued results',async({page,baseURL})=>{
  await page.clock.install();const frame=await embedded(page,baseURL,{auto:false});
  await frame.evaluate(()=>{for(let i=1;i<=8;i++)ARCADE.LB.check('racing',i,'RUN');});
  await expect.poll(()=>page.evaluate(()=>rankRequests.length)).toBe(3);
  await frame.evaluate(()=>{const clock=Date.now;Date.now=()=>clock()+31000;});
  const first=await page.evaluate(()=>rankRequests[0]);await page.evaluate(r=>reply(r,{accepted:true}),first);
  await expect(frame.locator('#lbCloudStatus')).toContainText('unavailable');
  expect(await page.evaluate(()=>rankRequests.length)).toBe(3);
});

test('website rankings show top10 and your separate best while device records remain intact',async({page,baseURL})=>{
  const frame=await embedded(page,baseURL);await page.evaluate(({top,own})=>{rankRows.poker=top;rankOwn.poker=own;},{top:[row('other','Carnival Champion',550)],own:row('me','My JCW Name',300)});
  await frame.evaluate(()=>{ARCADE.LB.board('poker').push({name:'ICP',v:250,tag:'LOCAL',t:1700000000000});ARCADE.LB.show('poker');});
  await expect(frame.locator('#lbRows')).toContainText('ICP');await frame.locator('#lbWebsiteTab').click();
  await expect(frame.locator('#lbRows')).toContainText('Carnival Champion');await expect(frame.locator('#lbOwn')).toContainText('My JCW Name · YOU');
  await expect(frame.locator('#lbCloudStatus')).toContainText('Signed in');await frame.locator('#lbDeviceTab').click();
  await expect(frame.locator('#lbRows')).toContainText('ICP');await expect(frame.locator('#lbRows')).not.toContainText('Carnival Champion');
});

test('only a correlated trusted-parent acknowledgement may claim a shared save',async({page,baseURL})=>{
  const frame=await embedded(page,baseURL,{auto:false});await frame.evaluate(()=>ARCADE.LB.check('racing',456,'RUN'));const sent=await request(page,'submit','racing');
  await expect(frame.locator('#lbCloudStatus')).toContainText('Saving');
  const good={type:'jcw-arcade-rankings-response',v:1,id:sent.id,action:sent.action,g:sent.g,ok:true,signedIn:true,accepted:true};
  await frame.evaluate(reply=>{
    window.dispatchEvent(new MessageEvent('message',{source:window.parent,origin:'https://untrusted.example',data:reply}));
    window.dispatchEvent(new MessageEvent('message',{source:window,origin:new URL(document.referrer).origin,data:reply}));
  },good);
  await page.evaluate(sent=>{reply({...sent,id:'unknown'},{accepted:true});reply({...sent,g:'poker'},{accepted:true});reply({...sent,action:'list'},{accepted:true});},sent);
  await frame.locator('#lbInitials').fill('ABC');await frame.locator('#lbSaveBtn').click();
  expect(await frame.evaluate(()=>ARCADE.LB.board('racing')[0].name)).toBe('ABC');await expect(frame.locator('#lbCloudStatus')).toContainText('Saving');
  await page.evaluate(sent=>reply(sent,{accepted:true}),sent);await expect(frame.locator('#lbCloudStatus')).toHaveText('Saved to JCW website rankings.');
});

test('late responses cannot replace the selected game and names are rendered as text',async({page,baseURL})=>{
  const frame=await embedded(page,baseURL,{auto:false});await frame.evaluate(()=>ARCADE.LB.show('poker'));await frame.locator('#lbWebsiteTab').click();
  const pokerStatus=await request(page,'status','poker');await page.evaluate(r=>reply(r),pokerStatus);const pokerList=await request(page,'list','poker');
  await frame.evaluate(()=>ARCADE.LB.show('chess'));const chessStatus=await request(page,'status','chess');await page.evaluate(r=>reply(r),chessStatus);const chessList=await request(page,'list','chess');
  await page.evaluate(({r,rows})=>reply(r,{rows,own:null}),{r:chessList,rows:[row('safe','<img src=x onerror=alert(1)>',12)]});
  await expect(frame.locator('#lbRows')).toContainText('<img src=x onerror=alert(1)>');expect(await frame.locator('#lbRows img').count()).toBe(0);
  await page.evaluate(({r,rows})=>reply(r,{rows,own:null}),{r:pokerList,rows:[row('late','OLD POKER RESPONSE',999)]});
  await expect(frame.locator('#lbGameName')).toHaveText('JUGGALO CHESS');await expect(frame.locator('#lbRows')).not.toContainText('OLD POKER RESPONSE');await expect(frame.locator('#lbRows')).toContainText('12 MV');
});

test('timeouts and signed-out hosts leave local saving available without false success',async({page,baseURL})=>{
  await page.clock.install();const frame=await embedded(page,baseURL,{auto:false});await frame.evaluate(()=>ARCADE.LB.check('poker',400,'WIN'));
  await request(page,'submit','poker');await page.clock.fastForward(8001);await expect(frame.locator('#lbCloudStatus')).toContainText('unavailable');
  await frame.locator('#lbInitials').fill('WIN');await frame.locator('#lbSaveBtn').click();expect(await frame.evaluate(()=>ARCADE.LB.board('poker')[0].v)).toBe(400);
  await page.evaluate(()=>{rankAuto=true;rankSignedIn=false;});await frame.locator('#lbWebsiteTab').click();await expect(frame.locator('#lbCloudStatus')).toContainText('Sign in on JCW Lunacy');
  await frame.locator('#lbDeviceTab').click();await expect(frame.locator('#lbRows')).toContainText('WIN');
});

test('unavailable auth or overloaded host is not presented as a sign-in failure',async({page,baseURL})=>{
  const frame=await embedded(page,baseURL);await page.evaluate(()=>{rankError='unavailable';rankSignedIn=false;});
  await frame.evaluate(()=>ARCADE.LB.check('poker',100,'RUN'));await expect(frame.locator('#lbCloudStatus')).toContainText('unavailable');await expect(frame.locator('#lbCloudStatus')).not.toContainText('Sign in');
  await frame.locator('#lbWebsiteTab').click();await expect(frame.locator('#lbCloudStatus')).toContainText('unavailable');
});

test('malformed lists are ignored and requests stay bounded under repeated refreshes',async({page,baseURL})=>{
  await page.clock.install();const frame=await embedded(page,baseURL,{auto:false});await frame.evaluate(()=>ARCADE.LB.show('pool'));await frame.locator('#lbWebsiteTab').click();
  const status=await request(page,'status','pool');await page.evaluate(r=>reply(r),status);const list=await request(page,'list','pool');
  await page.evaluate(({r,rows})=>reply(r,{rows,own:null}),{r:list,rows:[row('bad','BROKEN ENTRY',Infinity)]});
  await expect(frame.locator('#lbRows')).not.toContainText('BROKEN ENTRY');
  await frame.evaluate(()=>{for(let i=0;i<80;i++)document.getElementById('lbRefresh').click();});
  expect(await page.evaluate(()=>rankRequests.length)).toBeLessThanOrEqual(33);await page.clock.fastForward(8001);
  await expect(frame.locator('#lbCloudStatus')).toContainText('unavailable');
});

test('standalone and untrusted embeds do not send website ranking requests',async({page,baseURL})=>{
  await page.goto('/game.html');await page.waitForFunction(()=>window.LB_READY);await page.evaluate(()=>ARCADE.LB.show('racing'));await page.locator('#lbWebsiteTab').click();await expect(page.locator('#lbCloudStatus')).toContainText('Open the arcade on JCW Lunacy');
  // Isolate the client: the complete game correctly refuses untrusted hosts.
  // This fixture exercises the bridge allowlist without bypassing that gate.
  const screens=['pkScreen','rcScreen','plScreen','lwScreen','ruScreen','khScreen','shScreen','clScreen'].map(id=>'<div id="'+id+'" hidden></div>').join('');
  await page.route('http://untrusted.example/game.html',route=>route.fulfill({contentType:'text/html',body:'<!doctype html>'+clientMarkup+screens+'<button id="recordsBtn">RECORDS</button><script>const $=s=>document.querySelector(s);const Sound={play(){},on:false};'+clientSource+';window.ARCADE={LB,Sound};LB.bind();</script>'}));
  const frame=await embedded(page,'http://untrusted.example');await frame.evaluate(()=>ARCADE.LB.check('poker',100,'RUN'));await frame.locator('#lbWebsiteTab').click();
  await expect(frame.locator('#lbCloudStatus')).toContainText('unavailable');expect(await page.evaluate(()=>rankRequests)).toEqual([]);
});

for(const[width,height]of[[320,568],[568,320],[1280,800]])test(`shared rankings remain readable and reachable at ${width}x${height}`,async({page,baseURL},testInfo)=>{
  await page.setViewportSize({width,height});const frame=await embedded(page,baseURL);
  await page.evaluate(rows=>{rankRows.racing=rows;rankOwn.racing={uid:'own',name:'My personal racing record',v:300,tag:'DAILY · DETROIT TO THE ARENA',t:1700000000000};},Array.from({length:10},(_,i)=>row('u'+i,'The Carnival Champion '+i,1000000-i)));
  await frame.evaluate(()=>ARCADE.LB.show('racing'));await frame.locator('#lbWebsiteTab').click();await expect(frame.locator('#lbRows .shared')).toHaveCount(10);
  await frame.locator('.lb-card').screenshot({path:testInfo.outputPath('shared-rankings-'+width+'x'+height+'.png')});
  for(const id of['lbWebsiteTab','lbRefresh','lbOwn','lbClose']){const e=frame.locator('#'+id);await e.scrollIntoViewIfNeeded();expect(await e.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);}
  expect(await frame.locator('.lb-card').evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(false);
});
