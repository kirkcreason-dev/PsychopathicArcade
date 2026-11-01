import {test,expect} from '@playwright/test';
import {deflateRawSync} from 'node:zlib';

const encode=(value,compressed)=>{
  const bytes=Buffer.from(JSON.stringify(value));
  return{code:`PA${compressed?1:0}.`+(compressed?deflateRawSync(bytes):bytes).toString('base64url'),bytes:bytes.length};
};
test.beforeEach(async({page})=>{
  await page.goto('/game.html');
  await page.waitForFunction(()=>window.ARCADE?.NET);
  await page.evaluate(()=>{ARCADE.Sound.on=false;});
});

for(const compressed of[false,true])test(`PA${compressed?1:0} limits decoded bytes and preserves existing code decoding`,async({page})=>{
  const value={g:'racing',v:1,s:'v=0\r\na=🃏é🎪\r\n'},valid=encode(value,compressed),large=encode({s:'r'.repeat(131072)},compressed);
  const outcome=await page.evaluate(async({valid,large})=>{
    const net=ARCADE.NET,errors=[];
    for(const[code,limit]of[[valid.code,valid.bytes-1],[large.code,65536]]){
      try{await net.unpack(code,limit);errors.push('accepted');}catch(error){errors.push(error.message);}
    }
    return{bounded:await net.unpack(valid.code,valid.bytes),legacy:await net.unpack(valid.code),largeLegacyLength:(await net.unpack(large.code)).s.length,errors};
  },{valid,large});
  expect(outcome.bounded).toEqual(value);expect(outcome.legacy).toEqual(value);expect(outcome.largeLegacyLength).toBe(131072);
  expect(outcome.errors).toEqual(['Arcade code exceeds the allowed size.','Arcade code exceeds the allowed size.']);
});

test('real manual invites still round-trip through capped and legacy decoding',async({page})=>{
  const outcome=await page.evaluate(async()=>{
    const RTC=window.RTCPeerConnection;
    window.RTCPeerConnection=class extends RTC{constructor(){super({iceServers:[]});}};
    const net=ARCADE.NET;net.state.game='racing';
    try{
      const code=await net.hostCreate(),bounded=await net.unpack(code,65536),legacy=await net.unpack(code);
      return{same:JSON.stringify(bounded)===JSON.stringify(legacy),game:bounded.g,version:bounded.v,sdp:bounded.s.startsWith('v=0'),prefix:code.slice(0,4)};
    }finally{net.leave();}
  });
  expect(outcome).toMatchObject({same:true,game:'racing',version:1,sdp:true});expect(['PA0.','PA1.']).toContain(outcome.prefix);
});

async function fakeSockets(page){
  await page.clock.install();
  await page.evaluate(()=>{
    ARCADE.NET.mqtt.close();window.brokerSockets=[];
    window.WebSocket=class{
      constructor(url,protocols){this.url=url;this.protocols=protocols;this.closed=false;brokerSockets.push(this);}
      send(){}close(){this.closed=true;this.onclose?.();}
    };
  });
}

test('broker pins reject unapproved URLs before opening any socket',async({page})=>{
  await fakeSockets(page);
  const result=await page.evaluate(async()=>{
    const messages=[];
    for(const url of['wss://unexpected.example/mqtt','ws://broker.emqx.io:8084/mqtt','wss://broker.emqx.io:8084/mqtt?other=1']){
      try{await ARCADE.NET.mqtt.connect(url);messages.push('accepted');}catch(error){messages.push(error.message);}
    }
    return{messages,sockets:brokerSockets.length,ready:ARCADE.NET.mqtt.ready};
  });
  expect(result).toEqual({messages:Array(3).fill('Unknown matchmaking broker.'),sockets:0,ready:false});
});

test('a pinned broker failure never falls back to a different room service',async({page})=>{
  await fakeSockets(page);
  await page.evaluate(()=>{window.brokerOutcome='pending';ARCADE.NET.mqtt.connect(ARCADE.NET.mqtt.brokers[1]).then(()=>{brokerOutcome='connected';},()=>{brokerOutcome='unreachable';});});
  await page.clock.runFor(2500);
  expect(await page.evaluate(()=>brokerSockets.map(s=>s.url))).toEqual(['wss://broker.hivemq.com:8884/mqtt']);
  await page.evaluate(()=>brokerSockets[0].onerror());await page.clock.runFor(6000);
  expect(await page.evaluate(()=>({outcome:brokerOutcome,count:brokerSockets.length,ready:ARCADE.NET.mqtt.ready}))).toEqual({outcome:'unreachable',count:1,ready:false});
});

test('switching to a pinned broker ignores late acknowledgments from old broker attempts',async({page})=>{
  await fakeSockets(page);
  await page.evaluate(()=>{window.oldBrokerConnect=ARCADE.NET.mqtt.connect();});await page.clock.runFor(1300);
  await page.evaluate(()=>{window.pinnedBrokerConnect=ARCADE.NET.mqtt.connect(ARCADE.NET.mqtt.brokers[2]);});await page.clock.runFor(1);
  const before=await page.evaluate(async()=>{
    const[oldA,oldB,current]=brokerSockets,ack={data:new Uint8Array([0x20,2,0,0]).buffer};
    oldA.onmessage(ack);oldB.onmessage(ack);
    const ignored=!ARCADE.NET.mqtt.ready;
    current.onopen();current.onmessage(ack);await Promise.all([oldBrokerConnect,pinnedBrokerConnect]);
    oldA.onmessage(ack);
    return{ignored,oldClosed:oldA.closed&&oldB.closed,current:ARCADE.NET.mqtt.ws===current,url:ARCADE.NET.mqtt.ws.url,protocols:current.protocols};
  });
  expect(before).toEqual({ignored:true,oldClosed:true,current:true,url:'wss://test.mosquitto.org:8081/mqtt',protocols:['mqtt']});
  await page.clock.runFor(6000);
  expect(await page.evaluate(()=>({count:brokerSockets.length,ready:ARCADE.NET.mqtt.ready,url:ARCADE.NET.mqtt.ws.url}))).toEqual({count:3,ready:true,url:'wss://test.mosquitto.org:8081/mqtt'});
  await page.evaluate(()=>ARCADE.NET.mqtt.close());
});
