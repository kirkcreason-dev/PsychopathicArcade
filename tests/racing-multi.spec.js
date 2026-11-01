import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import vm from 'node:vm';

const rules=fs.readFileSync(new URL('../games/racing-rules.js',import.meta.url),'utf8');
const protocol=fs.readFileSync(new URL('../games/racing-multi.js',import.meta.url),'utf8');
const copy=x=>JSON.parse(JSON.stringify(x));
const neutral=()=>({steer:0,brake:false,boost:false});
function room(seats=[0,1],picks={}){
  let clock=0,seed=991,queue=[],drop=new Set();const nodes=new Map(),traffic=[];
  const context=vm.createContext({Math,Number,Object,Array,Set,Map,JSON,Uint32Array,performance:{now:()=>clock},crypto:{getRandomValues:a=>{a[0]=seed++;return a;}}});
  vm.runInContext(rules+'\n'+protocol+'\nthis.R=RACING_RULES;this.M=RACING_MULTI;',context);const R=context.R,M=context.M;
  function add(seat){
    const node={seat,view:null,callbacks:{},buffer:0,locked:false,open:true};nodes.set(seat,node);
    const transport={configure:c=>node.callbacks=c,send:(packet,target)=>{
      const destinations=seat===0?(target===undefined?[...nodes.keys()].filter(s=>s!==0):[target]):[0];
      for(const to of destinations){const entry={from:seat,to,packet:copy(packet)};traffic.push(entry);if(!drop.has(seat)&&!drop.has(to))queue.push(entry);}return !!destinations.length;
    },lock:v=>node.locked=v,close:reason=>{node.open=false;node.callbacks.onEnd(reason);},get state(){return{active:node.open,role:seat===0?'host':'join',seat,members:[...nodes.keys()].map(s=>({seat:s,connected:!drop.has(s)})),bufferedAmount:node.buffer};}};
    node.controller=M.create({transport,onChange:v=>node.view=v,choice:()=>picks[seat]||R.roster[seat%6].id});return node;
  }
  function flush(){let loops=0;while(queue.length){if(++loops>10000)throw new Error('Protocol loop');const entry=queue.shift(),target=nodes.get(entry.to);if(target?.open)target.callbacks.onMessage(copy(entry.packet),entry.from);}}
  function roster(){const list=[...nodes.keys()].map(s=>({seat:s,connected:!drop.has(s)}));for(const n of nodes.values())n.callbacks.onRoster(copy(list));flush();}
  for(const seat of seats)add(seat);roster();for(const n of nodes.values())if(n.seat)n.callbacks.onConnection(0,'connected');flush();
  const out={R,nodes,traffic,add,flush,roster,drop,host:()=>nodes.get(0),guest:(s=seats[1])=>nodes.get(s),
    tick:(ms=100,dt=ms/1000)=>{clock+=ms;for(const n of [...nodes.values()].reverse())if(n.open)n.controller.update(dt,neutral());flush();},
    wait:ms=>clock+=ms,
    ready:()=>{for(const n of nodes.values())n.controller.ready();flush();},
    launch:()=>{out.ready();expect(nodes.get(0).controller.launch()).toBe(true);flush();},
    latest:to=>copy(traffic.filter(e=>e.from===0&&e.to===to&&e.packet.k==='snapshot').at(-1).packet),
    inject:(to,packet,from=0)=>{nodes.get(to).callbacks.onMessage(copy(packet),from);flush();},
    disconnect:(seat,closed=false)=>{drop.add(seat);nodes.get(0).callbacks.onConnection(seat,closed?'closed':'disconnected');nodes.get(seat).callbacks.onConnection(0,closed?'closed':'disconnected');flush();},
    reconnect:seat=>{drop.delete(seat);roster();nodes.get(0).callbacks.onConnection(seat,'connected');nodes.get(seat).callbacks.onConnection(0,'connected');flush();},
    remove:seat=>{const n=nodes.get(seat);n.open=false;nodes.delete(seat);roster();nodes.get(0)?.callbacks.onConnection(seat,'closed');flush();}
  };return out;
}

test('eight riders explicitly ready and launch, with duplicate choices and one authoritative start line',()=>{
  const h=room([0,1,2,3,4,5,6,7],{0:'big-foot',7:'big-foot'});h.tick();
  for(const n of h.nodes.values()){expect(n.view.localSeat).toBe(0);expect(n.view.started).toBe(false);}
  h.ready();expect(h.host().view.net.canLaunch).toBe(true);expect(h.host().view.started).toBe(false);
  expect(h.guest().controller.launch()).toBe(false);expect(h.host().controller.launch()).toBe(true);h.flush();
  const s=h.host().view.state;expect(s.racers).toHaveLength(8);expect(s.racers.every(r=>r.human&&r.z===0)).toBe(true);
  expect(s.racers.map(r=>r.playerSeat)).toEqual([0,1,2,3,4,5,6,7]);expect(s.racers[7].racerId).toBe('big-foot');
  for(const n of h.nodes.values()){expect(n.view.localSeat).toBe(n.seat);expect(n.view.state.seed).toBe(s.seed);expect(n.view.net.round).toBe(1);expect(n.view.net.localReady).toBe(false);}
  expect(h.host().locked).toBe(true);
});

test('sparse transport seats map to contiguous actors and the local preview keeps its selected ride',()=>{
  const h=room([0,3,7],{3:'dani-mo',7:'dani-mo'});h.tick();
  expect(h.guest(3).view.state.racers[0].racerId).toBe('dani-mo');expect(h.guest(7).view.state.racers[0].racerId).toBe('dani-mo');
  h.launch();expect(h.host().view.state.racers.filter(r=>r.human).map(r=>r.playerSeat)).toEqual([0,3,7]);
  expect(h.guest(7).view.localSeat).toBe(2);expect(h.guest(7).view.net.members.map(m=>m.actorId)).toEqual([0,1,2]);
});

test('only authenticated seats control their own actor and short press/release packets bypass the heartbeat interval',()=>{
  const h=room([0,2,5]);h.launch();for(let i=0;i<31;i++)h.tick(100);
  const before=h.host().view.state.racers.map(r=>r.x),count=h.traffic.length;
  h.guest(5).controller.input({steer:-1,brake:false,boost:false});h.flush();h.host().controller.update(.1,neutral());
  expect(h.host().view.state.racers[2].x).toBeLessThan(before[2]);expect(h.host().view.state.racers[1].x).toBe(before[1]);
  h.guest(5).controller.input(neutral());h.flush();
  expect(h.traffic.slice(count).filter(e=>e.from===5&&e.packet.k==='input').map(e=>e.packet.controls.steer)).toEqual([-1,0]);
  const forged=copy(h.traffic.findLast(e=>e.from===5&&e.packet.k==='input').packet);forged.seq+=100;forged.seat=2;forged.controls.steer=1;
  h.inject(0,forged,5);h.host().controller.update(.1,neutral());expect(h.host().view.state.racers[2].steer).toBeLessThanOrEqual(0);
});

test('pause propagates to every rider and each paused person must explicitly resume',()=>{
  const h=room([0,1,2]);h.launch();h.guest(1).controller.pause(true);h.flush();h.guest(2).controller.pause(true);h.flush();
  expect(h.host().view.net.members.every(m=>m.paused)).toBe(true);
  const tick=h.host().view.state.tick;h.tick(200);expect(h.host().view.state.tick).toBe(tick);
  h.guest(1).controller.pause(false);h.flush();expect(h.host().view.paused).toBe(true);
  h.guest(2).controller.pause(false);h.flush();expect(h.host().view.paused).toBe(true);
  h.host().controller.pause(false);h.flush();expect(h.host().view.paused).toBe(false);h.tick();expect(h.host().view.state.tick).toBeGreaterThan(tick);
});

test('reconnecting requires a fresh barrier and rejects delayed old-epoch resume packets',()=>{
  const h=room([0,1,2]);h.launch();h.guest(1).controller.pause(false);h.flush();
  const old=copy(h.traffic.findLast(e=>e.from===1&&e.packet.k==='input').packet),oldSnapshot=h.latest(1);
  h.disconnect(1);expect(h.host().view.paused).toBe(true);h.reconnect(1);
  expect(h.guest(1).view.net.synced).toBe(true);expect(h.guest(1).view.net.epoch).toBeGreaterThan(old.epoch);
  old.seq+=10000;h.inject(0,old,1);expect(h.host().view.net.members.find(m=>m.seat===1).paused).toBe(true);
  oldSnapshot.seq+=10000;h.inject(1,oldSnapshot);expect(h.guest(1).view.net.epoch).toBeGreaterThan(oldSnapshot.epoch);
  h.host().controller.pause(false);h.guest(1).controller.pause(false);h.flush();expect(h.host().view.paused).toBe(true);
  h.guest(2).controller.pause(false);h.flush();expect(h.host().view.paused).toBe(false);
});

test('inputs older than350ms brake safely and a missing heartbeat pauses after2.2seconds',()=>{
  const h=room();h.launch();for(let i=0;i<50;i++)h.tick(100);
  const speed=h.host().view.state.racers[1].speed;h.wait(400);h.host().controller.update(.2,neutral());h.flush();
  expect(h.host().view.state.racers[1].speed).toBeLessThan(speed);expect(h.host().view.paused).toBe(false);
  h.wait(1900);h.host().controller.update(.1,neutral());h.flush();expect(h.host().view.paused).toBe(true);expect(h.host().view.net.members.every(m=>m.paused)).toBe(true);
});

test('backpressure pauses without queueing more snapshots and recovery cannot silently resume',()=>{
  const h=room([0,1,2]);h.launch();h.host().buffer=70000;const count=h.traffic.length;h.host().controller.update(.1,neutral());
  expect(h.host().view.net.congested).toBe(true);expect(h.host().view.paused).toBe(true);expect(h.traffic.length).toBe(count);
  h.host().buffer=12000;h.host().controller.update(.1,neutral());h.flush();expect(h.host().view.net.congested).toBe(false);expect(h.nodes.get(2).view.paused).toBe(true);
  for(const n of h.nodes.values())n.controller.pause(false);h.flush();expect(h.host().view.paused).toBe(false);
});

test('lobby departure preserves the room, while a closed active racer ends the entire race',()=>{
  const h=room([0,1,2]);h.remove(1);expect(h.host().controller.active).toBe(true);expect(h.host().view.net.members.map(m=>m.seat)).toEqual([0,2]);h.launch();
  h.remove(2);expect(h.host().controller.active).toBe(false);expect(h.host().view.ended).toBe(true);expect(h.host().view.state.phase).not.toBe('finished');
});

test('impossible snapshots never overwrite the last good guest race state',()=>{
  const h=room([0,2,7]);h.launch();h.tick();const good=copy(h.guest(7).view.state),base=h.latest(7);
  const changes=[p=>p.mapping=[0,7,2],p=>p.state.racers[2].playerSeat=2,p=>p.state.racers[2].speed=Infinity,p=>p.state.racers[0].driftCharge=1,
    p=>p.state.racers[0].speed=312.501,p=>p.state.racers[0].boostTime=4,p=>p.state.racers[0].boostTime=1,p=>p.state.racers[0].boostHeld=1,p=>{p.state.racers[0].boostTime=1;p.state.racers[0].boosting=true;p.state.racers[0].driftTurbo=.5;},
    p=>p.state.racers[0].tickets=5,p=>p.state.collected=[[0,8]],p=>p.state.objects=[],p=>p.state.tick+=400,p=>p.state.phase='finished',p=>p.state.racers.push(copy(p.state.racers[0])),
    p=>p.state.racers[0].human=false,p=>p.members[0].seat=7,p=>p.members[2].barrier+=1,p=>p.state.finishOrder=[0],p=>p.state.events=[{id:'bad',type:'drift',racer:7,time:0,tier:3,amount:100}]];
  for(const change of changes){const packet=copy(base);packet.seq+=100;change(packet);h.inject(7,packet);expect(copy(h.guest(7).view.state)).toEqual(good);}
  const unauthorized=copy(base);unauthorized.seq+=100;h.inject(7,unauthorized,2);expect(copy(h.guest(7).view.state)).toEqual(good);
});

test('all eight seats finish a complete race, receive equal authoritative results and explicitly launch a rematch',()=>{
  const h=room([0,1,2,3,4,5,6,7]);h.launch();let iterations=0;
  while(h.host().view.state.phase!=='finished'&&iterations++<1000){h.wait(85);const s=h.host().view.state;expect(h.host().controller.debug.advanceAll(.2,s.racers.map((_,i)=>h.R.aiInput(s,i)))).toBe(true);h.flush();}
  expect(iterations).toBeLessThan(1000);expect(h.host().view.state.finishOrder).toHaveLength(8);expect(h.host().view.state.racers.every(r=>r.finishTime!==null&&!r.dnf)).toBe(true);
  for(const n of h.nodes.values()){expect(n.view.state.phase).toBe('finished');expect(n.view.state.finishOrder).toEqual(h.host().view.state.finishOrder);expect(n.view.net.localReady).toBe(false);}
  expect(h.host().locked).toBe(false);expect(h.host().controller.launch()).toBe(false);
  h.ready();expect(h.host().view.started).toBe(true);expect(h.host().view.state.phase).toBe('finished');expect(h.host().controller.launch()).toBe(true);h.flush();
  expect(h.host().view.net.round).toBe(2);expect(h.guest(7).view.state.phase).toBe('countdown');expect(h.guest(7).view.state.racers.every(r=>r.z===0)).toBe(true);
  const packets=h.traffic.filter(e=>e.from===0&&e.to===7&&e.packet.k==='snapshot');
  const largest=Math.max(...packets.map(e=>Buffer.byteLength(JSON.stringify(e.packet))));
  expect(largest).toBeLessThan(16000);console.log(`Eight-rider maximum snapshot: ${largest} bytes; seven-peer14Hz outbound ceiling: ${largest*7*14} bytes/s.`);
});

test('an older unacknowledged lobby snapshot cannot undo local ready or character intent',()=>{
  const h=room();h.tick();const old=h.latest(1);h.drop.add(1);
  expect(h.guest().controller.choose('big-foot')).toBe(true);expect(h.guest().controller.ready()).toBe(true);
  old.seq++;h.inject(1,old);expect(h.guest().view.net.localReady).toBe(true);expect(h.guest().view.state.racers[0].racerId).toBe('big-foot');
  h.drop.delete(1);h.tick();h.tick();expect(h.host().view.net.members.find(m=>m.seat===1).racerId).toBe('big-foot');expect(h.host().view.net.members.find(m=>m.seat===1).ready).toBe(true);
});

test('an older unacknowledged paused snapshot cannot undo a fresh local resume',()=>{
  const h=room();h.launch();h.host().controller.pause(true);h.flush();const old=h.latest(1);h.drop.add(1);
  expect(h.guest().controller.pause(false)).toBe(true);old.seq++;h.inject(1,old);expect(h.guest().view.net.localPause).toBe(false);expect(h.guest().view.paused).toBe(true);
  h.drop.delete(1);h.host().controller.pause(false);h.flush();h.tick();h.tick();expect(h.host().view.paused).toBe(false);
});

test('guest backpressure invalidates its old barrier and requires a fresh host snapshot before resuming',()=>{
  const h=room();h.launch();const old=h.latest(1);h.guest().buffer=70000;h.guest().controller.update(.1,neutral());
  expect(h.guest().view.net.synced).toBe(false);expect(h.guest().controller.pause(false)).toBe(false);old.seq+=100;h.inject(1,old);expect(h.guest().view.net.synced).toBe(false);
  h.guest().buffer=12000;h.guest().controller.update(.1,neutral());h.flush();expect(h.guest().view.net.synced).toBe(true);expect(h.host().view.paused).toBe(true);
  h.guest().controller.pause(false);h.host().controller.pause(false);h.flush();expect(h.host().view.paused).toBe(false);
});

test('joining between finished races resets readiness and a new seat participates in the rematch',()=>{
  const h=room([0,2]);h.launch();let loops=0;
  while(h.host().view.state.phase!=='finished'&&loops++<1000)h.host().controller.debug.advanceAll(.25,[neutral(),neutral()]);h.flush();
  expect(h.host().view.state.phase).toBe('finished');h.ready();h.add(5);h.roster();h.nodes.get(5).callbacks.onConnection(0,'connected');h.flush();
  expect(h.host().view.started).toBe(false);expect(h.host().view.net.members.every(m=>!m.ready)).toBe(true);expect(h.host().controller.launch()).toBe(false);
  h.launch();expect(h.nodes.get(5).view.localSeat).toBe(2);expect(h.host().view.state.racers.filter(r=>r.human).map(r=>r.playerSeat)).toEqual([0,2,5]);
});

test('legitimate floating-point pickup gain residue is accepted without allowing oversized awards',()=>{
  const h=room();h.launch();for(let i=0;i<13;i++)h.host().controller.debug.advanceAll(.25,[neutral(),neutral()]);
  const rider=h.host().view.state.racers[0];rider.x=0;rider.z=455;rider.speed=190;rider.boost=4.156959526159921;
  h.wait(100);h.host().controller.debug.advanceAll(.1,[neutral(),neutral()]);h.flush();
  const packet=h.latest(1),event=packet.state.events.find(e=>e.type==='pickup'&&e.object===0&&e.racer===0);expect(event).toBeTruthy();
  event.amount=28.000000000000004;packet.seq++;h.inject(1,packet);expect(h.guest().view.state.events.find(e=>e.id===event.id).amount).toBe(event.amount);
  const good=copy(h.guest().view.state);event.amount=28.01;packet.seq++;h.inject(1,packet);expect(copy(h.guest().view.state)).toEqual(good);
});

test('debug advancement is host-only and bounded; a fresh room resets all protocol generations',()=>{
  const h=room();h.launch();expect(h.guest().controller.debug.advanceAll(.1,[neutral(),neutral()])).toBe(false);expect(h.host().controller.debug.advanceAll(100,[neutral(),neutral()])).toBe(false);
  h.host().controller.pause(true);expect(h.host().controller.debug.advanceAll(.1,[neutral(),neutral()])).toBe(false);
  h.host().controller.end();h.host().open=true;h.host().callbacks.onOpen('host',0);expect(h.host().view.net.round).toBe(0);expect(h.host().view.ended).toBe(false);expect(h.host().view.started).toBe(false);
});

test('idle states heartbeat at2Hz while live racing keeps14Hz and forced intents remain immediate',()=>{
  const h=room(),count=()=>h.traffic.filter(e=>e.from===0&&e.to===1&&e.packet.k==='snapshot').length;
  let before=count();for(let i=0;i<10;i++)h.tick(100,0);expect(count()-before).toBe(2);
  before=count();h.host().controller.ready();h.flush();expect(count()-before).toBe(1);
  h.launch();before=count();for(let i=0;i<14;i++)h.tick(72,.072);expect(count()-before).toBe(14);
  before=count();h.host().controller.pause(true);h.flush();expect(count()-before).toBeGreaterThanOrEqual(1);
  before=count();const tick=h.host().view.state.tick;for(let i=0;i<10;i++)h.tick(100,.1);
  expect(count()-before).toBe(2);expect(h.host().view.state.tick).toBe(tick);expect(h.guest().view.net.synced).toBe(true);
  h.host().controller.pause(false);h.guest().controller.pause(false);h.flush();
  let loops=0;while(h.host().view.state.phase!=='finished'&&loops++<1000)h.host().controller.debug.advanceAll(.25,[neutral(),neutral()]);h.flush();
  expect(h.guest().view.state.phase).toBe('finished');before=count();for(let i=0;i<10;i++)h.tick(100,.1);expect(count()-before).toBe(2);
  expect(h.guest().view.net.synced).toBe(true);expect(h.guest().view.state.phase).toBe('finished');
});

test('quick local and remote boost taps survive packet coalescing, stay authoritative and freeze during an eight-player pause',()=>{
  const h=room([0,1,2,3,4,5,6,7]);h.launch();for(let i=0;i<13;i++)h.host().controller.debug.advanceAll(.25,Array.from({length:8},neutral));h.flush();
  h.host().view.state.racers[7].speed=230;
  for(const node of [h.host(),h.guest(7)]){node.controller.input({steer:0,brake:false,boost:true});node.controller.input(neutral());}h.flush();
  h.wait(100);h.host().controller.update(.1,neutral());h.flush();
  for(const id of [0,7])expect(h.host().view.state.racers[id].boostTime).toBeCloseTo(2.9,8);
  expect(h.host().view.state.racers[7].speed).toBeGreaterThan(250);
  for(const n of h.nodes.values())expect(n.view.state.racers[7].boostTime).toBeCloseTo(2.9,8);
  h.guest(3).controller.pause(true);h.flush();const frozen=h.host().view.state.racers[7].boostTime;
  for(let i=0;i<40;i++)h.tick(100,.1);expect(h.host().view.state.racers[7].boostTime).toBe(frozen);
  for(const n of h.nodes.values())n.controller.pause(false);h.flush();
  for(let i=0;i<29;i++)h.tick(100,.1);
  expect(h.host().view.state.racers[7].boostTime).toBe(0);expect(h.host().view.state.racers[7].boosting).toBe(false);
  for(const n of h.nodes.values()){expect(n.view.state.racers[7].boostTime).toBe(0);expect(n.view.net.synced).toBe(true);}
});

test('a fresh remote release-press after expiry rearms even when both edges arrive between physics ticks',()=>{
  const h=room();h.launch();for(let i=0;i<13;i++)h.host().controller.debug.advanceAll(.25,[neutral(),neutral()]);h.flush();
  const held={steer:0,brake:false,boost:true};h.guest().controller.input(held);h.flush();
  for(let i=0;i<12;i++)h.host().controller.debug.advanceAll(.25,[neutral(),held]);
  expect(h.host().view.state.racers[1].boostTime).toBe(0);expect(h.host().view.state.racers[1].boostHeld).toBe(true);
  const charge=h.host().view.state.racers[1].boost;
  h.guest().controller.input(neutral());h.guest().controller.input(held);h.guest().controller.input(neutral());h.flush();
  h.host().controller.update(.1,neutral());expect(h.host().view.state.racers[1].boostTime).toBeCloseTo(2.9,8);expect(h.host().view.state.racers[1].boost).toBeCloseTo(charge-30,8);
});
