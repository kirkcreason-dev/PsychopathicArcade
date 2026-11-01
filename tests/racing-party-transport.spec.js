import {test,expect} from '@playwright/test';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../games/racing-party.js',import.meta.url),'utf8');
const markup=fs.readFileSync(new URL('../games/racing-party.html',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../games/racing-party.css',import.meta.url),'utf8');
async function tab(browser,withUI=false){
  const page=await browser.newPage();
  await page.route('**/party-harness',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>'+(withUI?markup:'')+'</body></html>'}));
  await page.goto('http://127.0.0.1:4713/party-harness');
  await page.evaluate(()=>{
    window.partyEvents=[];window.partyErrors=[];window.testChannels=[];window.testPeers=[];
    window.addEventListener('error',e=>partyErrors.push(e.message));
    const Native=window.RTCPeerConnection;
    window.RTCPeerConnection=class extends Native{
      constructor(){super({iceServers:[]});testPeers.push(this);this.addEventListener('datachannel',e=>testChannels.push(e.channel));}
      createDataChannel(...args){const dc=super.createDataChannel(...args);testChannels.push(dc);return dc;}
    };
    window.NET={leave(){},mmStop(){},mqtt:{brokers:['wss://broker.emqx.io:8084/mqtt'],close(){},sub(){},unsub(){},ready:false,connect(){throw new Error('Manual tests must not contact a broker.');}},
      async pack(value){return 'PA0.'+btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))));},
      async unpack(code){if(!code.startsWith('PA0.'))throw new Error('Invalid code');return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(code.slice(4)),c=>c.charCodeAt(0))));}};
  });
  await page.addScriptTag({content:source});if(withUI)await page.addStyleTag({content:css});
  await page.evaluate(()=>RACING_PARTY.configure({onOpen:(role,seat)=>partyEvents.push({kind:'open',role,seat}),onRoster:members=>partyEvents.push({kind:'roster',members}),onMessage:(data,seat)=>partyEvents.push({kind:'message',data,seat}),onConnection:(seat,status)=>partyEvents.push({kind:'connection',seat,status}),onEnd:reason=>partyEvents.push({kind:'end',reason})}));
  return page;
}
async function pair(host,guest){const invite=await host.evaluate(()=>RACING_PARTY.createInvite());const reply=await guest.evaluate(code=>RACING_PARTY.acceptInvite(code),invite);await host.evaluate(code=>RACING_PARTY.acceptReply(code),reply);await guest.waitForFunction(()=>RACING_PARTY.state.members.length>=2);return{invite,reply};}
async function cleanup(pages){for(const p of pages){if(!p.isClosed()){await p.evaluate(()=>RACING_PARTY.close('Test finished'));await p.close();}}}

test.describe('eight-rider transport using real local WebRTC channels',()=>{
  test.skip(({browserName})=>browserName!=='chromium','These isolated host-candidate WebRTC tests use Chrome; integrated WebKit checks use the normal public STUN configuration.');
  test('eight real peers receive authoritative broadcasts and sender-bound private traffic',async({browser})=>{
    const pages=await Promise.all(Array.from({length:8},()=>tab(browser))),[host,...guests]=pages;
    try{
      await host.evaluate(()=>RACING_PARTY.host({manual:true}));
      const invites=await host.evaluate(()=>Promise.all(Array.from({length:7},()=>RACING_PARTY.createInvite())));
      const replies=await Promise.all(guests.map((p,i)=>p.evaluate(code=>RACING_PARTY.acceptInvite(code),invites[i])));
      await host.evaluate(codes=>Promise.all(codes.map(code=>RACING_PARTY.acceptReply(code))),replies);
      await Promise.all(pages.map(p=>p.waitForFunction(()=>RACING_PARTY.state.members.length===8&&RACING_PARTY.state.members.every(m=>m.connected))));
      expect(await host.evaluate(()=>RACING_PARTY.state.members.map(m=>m.seat))).toEqual([0,1,2,3,4,5,6,7]);
      for(let i=0;i<guests.length;i++)expect(await guests[i].evaluate(()=>RACING_PARTY.state.seat)).toBe(i+1);
      expect(await host.evaluate(()=>RACING_PARTY.send({kind:'snapshot',frame:9}))).toBe(true);
      await Promise.all(guests.map(p=>p.waitForFunction(()=>partyEvents.some(e=>e.kind==='message'&&e.data.frame===9&&e.seat===0))));
      expect(await host.evaluate(()=>RACING_PARTY.send({private:true},3))).toBe(true);
      await guests[2].waitForFunction(()=>partyEvents.some(e=>e.kind==='message'&&e.data.private));
      for(let i=0;i<guests.length;i++)expect(await guests[i].evaluate(()=>partyEvents.filter(e=>e.kind==='message'&&e.data.private).length)).toBe(i===2?1:0);
      expect(await guests[2].evaluate(()=>RACING_PARTY.send({seat:7,input:'right'}))).toBe(true);
      await host.waitForFunction(()=>partyEvents.some(e=>e.kind==='message'&&e.data.input==='right'));
      expect(await host.evaluate(()=>partyEvents.find(e=>e.kind==='message'&&e.data.input==='right').seat)).toBe(3);
      expect(await guests[2].evaluate(()=>RACING_PARTY.send({forged:true},5))).toBe(false);
      expect(await host.evaluate(async()=>{try{await RACING_PARTY.createInvite();return '';}catch(e){return e.message;}})).toContain('eight');
      await guests[2].evaluate(()=>RACING_PARTY.close('Rider left'));
      await host.waitForFunction(()=>RACING_PARTY.state.members.length===7);
      await guests[0].waitForFunction(()=>RACING_PARTY.state.members.length===7);
      expect(await host.evaluate(()=>partyEvents.some(e=>e.kind==='connection'&&e.seat===3&&e.status==='closed'))).toBe(true);
      await host.evaluate(()=>RACING_PARTY.lock(true));expect(await host.evaluate(async()=>{try{await RACING_PARTY.createInvite();return '';}catch(e){return e.message;}})).toContain('locked');
      await host.evaluate(()=>RACING_PARTY.close('Host ended'));
      await Promise.all(guests.filter((_,i)=>i!==2).map(p=>p.waitForFunction(()=>!RACING_PARTY.state.active)));
      for(const p of pages)expect(await p.evaluate(()=>partyErrors)).toEqual([]);
      for(const p of pages)expect(await p.evaluate(()=>partyEvents.filter(e=>e.kind==='open').length)).toBe(1);
    }finally{await cleanup(pages);}
  });
  test('one congested channel cannot queue unbounded snapshots; it recovers after draining',async({browser})=>{
    const host=await tab(browser),guest=await tab(browser);try{
      await host.evaluate(()=>RACING_PARTY.host({manual:true}));const{invite}=await pair(host,guest);
      await host.evaluate(()=>Object.defineProperty(testChannels[0],'bufferedAmount',{configurable:true,get:()=>300000}));
      expect(await host.evaluate(()=>RACING_PARTY.send({frame:1}))).toBe(false);expect(await host.evaluate(()=>RACING_PARTY.state.bufferedAmount)).toBe(300000);
      await host.evaluate(()=>delete testChannels[0].bufferedAmount);expect(await host.evaluate(()=>RACING_PARTY.send({frame:2}))).toBe(true);await guest.waitForFunction(()=>partyEvents.some(e=>e.kind==='message'&&e.data.frame===2));
      expect(await host.evaluate(()=>RACING_PARTY.send({blob:'x'.repeat(140000)}))).toBe(false);
      const session=await host.evaluate(async code=>(await NET.unpack(code)).session,invite);
      await guest.evaluate(s=>testChannels[0].send(JSON.stringify({p:1,session:s,k:'data',data:{oversized:'x'.repeat(140000)}})),session);await pageTick(guest);
      expect(await host.evaluate(()=>partyEvents.some(e=>e.kind==='message'&&e.data.oversized))).toBe(false);
    }finally{await cleanup([host,guest]);}
  });
  test('one room code pins the host broker, connects friends, and rejects a locked grid',async({browser})=>{
    const context=await browser.newContext(),host=await tab(context),guest=await tab(context),late=await tab(context);
    const pages=[host,guest,late];try{
      for(const page of pages)await page.evaluate(()=>{
        const listeners=new Map();let bus=null;
        NET.mqtt={brokers:['wss://broker.emqx.io:8084/mqtt','wss://broker.hivemq.com:8884/mqtt'],ready:false,ws:null,attempted:[],
          async connect(url){const selected=url||this.brokers[1];this.attempted.push(selected);this.ready=true;this.ws=new EventTarget();this.ws.url=selected;bus=new BroadcastChannel('racing-party-signaling-test');bus.onmessage=({data})=>listeners.get(data.topic)?.(data.payload);},
          close(){this.ready=false;bus?.close();bus=null;listeners.clear();this.ws=null;},
          sub(topic,callback){listeners.set(topic,callback);},unsub(topic){listeners.delete(topic);},
          pub(topic,payload){bus?.postMessage({topic,payload});}};
      });
      const code=await host.evaluate(()=>RACING_PARTY.host());expect(code).toMatch(/^RACE-B-[A-HJ-NP-Z2-9]{8}$/);
      expect(await guest.evaluate(c=>RACING_PARTY.join(c),code)).toBe(1);
      await host.waitForFunction(()=>RACING_PARTY.state.members.length===2);
      expect(await guest.evaluate(()=>NET.mqtt.attempted)).toEqual(['wss://broker.hivemq.com:8884/mqtt']);
      expect(await guest.evaluate(()=>RACING_PARTY.send({roomCodeConnected:true}))).toBe(true);
      await host.waitForFunction(()=>partyEvents.some(e=>e.kind==='message'&&e.data.roomCodeConnected&&e.seat===1));
      await host.evaluate(()=>RACING_PARTY.lock(true));
      const rejection=await late.evaluate(async c=>{try{await RACING_PARTY.join(c);return '';}catch(e){return e.message;}},code);
      expect(rejection).toContain('started');expect(await late.evaluate(()=>RACING_PARTY.state.active)).toBe(false);
      expect(await host.evaluate(()=>RACING_PARTY.state.members.length)).toBe(2);
      for(const page of pages)expect(await page.evaluate(()=>partyErrors)).toEqual([]);
    }finally{await cleanup(pages);await context.close();}
  });
  test('old replies and canceled asynchronous offers cannot claim a new room or seat',async({browser})=>{
    const host=await tab(browser),guest=await tab(browser);try{
      await host.evaluate(()=>RACING_PARTY.host({manual:true}));const invite=await host.evaluate(()=>RACING_PARTY.createInvite());const reply=await guest.evaluate(c=>RACING_PARTY.acceptInvite(c),invite);
      await host.evaluate(()=>RACING_PARTY.lock(true));expect(await host.evaluate(()=>RACING_PARTY.state.pending)).toBe(0);
      expect(await host.evaluate(async c=>{try{await RACING_PARTY.acceptReply(c);return '';}catch(e){return e.message;}},reply)).toContain('expired');
      await host.evaluate(()=>RACING_PARTY.host({manual:true}));await host.evaluate(()=>RACING_PARTY.createInvite());
      expect(await host.evaluate(async c=>{try{await RACING_PARTY.acceptReply(c);return '';}catch(e){return e.message;}},reply)).toContain('expired');
      const canceled=await host.evaluate(async()=>{const offer=RACING_PARTY.createInvite();RACING_PARTY.close('Canceled');try{await offer;return false;}catch{return true;}});expect(canceled).toBe(true);
      expect(await host.evaluate(()=>RACING_PARTY.state)).toMatchObject({active:false,role:null,seat:null,pending:0});expect(await host.evaluate(()=>partyErrors)).toEqual([]);
    }finally{await cleanup([host,guest]);}
  });
});
async function pageTick(page){await page.waitForTimeout(100);}
for(const [width,height]of[[320,568],[568,320],[1280,800]])test(`party lobby stays reachable at ${width}x${height}`,async({browser})=>{
  const page=await tab(browser,true);try{await page.setViewportSize({width,height});await page.evaluate(()=>{RACING_PARTY.bindUI();RACING_PARTY.open();});
    for(const id of['rpHostBtn','rpRoomInput','rpJoinBtn','rpCloseBtn']){const e=page.locator('#'+id);await e.scrollIntoViewIfNeeded();expect(await e.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);}
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
    await page.locator('.rp-manual summary').click();await page.locator('#rpCopyReply').scrollIntoViewIfNeeded();await expect(page.locator('#rpCopyReply')).toBeVisible();
    await page.keyboard.press('Escape');await expect(page.locator('#rpModal')).toBeHidden();
  }finally{await cleanup([page]);}
});
