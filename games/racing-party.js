/* Eight-rider star transport. MQTT carries invitations only; race traffic is
 * host-authoritative over individual, sender-bound WebRTC data channels. */
const RACING_PARTY=(()=>{
  'use strict';
  const VERSION=1,MAX_PEERS=8,MAX_PACKET=131072,MAX_BUFFER=262144,GRACE_MS=20000;
  const NS='psy-arcade/racing-party/v1',TOKEN=/^[a-f0-9]{32}$/;
  const callbacks={},peers=new Map(),subscriptions=new Map(),timers=new Set();
  const enc=new TextEncoder(),$=id=>document.getElementById('rp'+id);
  let generation=0,role=null,seat=null,session='',room='',active=false,locked=false,opened=false;
  let roster=[],ownsSignal=false,signalSocket=null,signalClose=null,brokerURL='',joinRequest=null,bound=false,returnFocus=null;
  const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');
  const emit=(name,...args)=>{if(typeof callbacks[name]==='function')callbacks[name](...args);};
  const later=(fn,ms)=>{const timer=setTimeout(()=>{timers.delete(timer);fn();},ms);timers.add(timer);return timer;};
  const clearTimer=timer=>{clearTimeout(timer);timers.delete(timer);};
  const validSeat=n=>Number.isInteger(n)&&n>=0&&n<MAX_PEERS;
  const current=e=>active&&!e.closed&&e.generation===generation&&peers.get(e.key)===e;
  function configure(value={}){for(const key of['onOpen','onRoster','onMessage','onConnection','onEnd'])if(typeof value[key]==='function')callbacks[key]=value[key];return api;}
  function members(){return role==='host'?[{seat:0,connected:true},...[...peers.values()].filter(e=>e.ready).map(e=>({seat:e.seat,connected:e.connected}))].sort((a,b)=>a.seat-b.seat):roster.map(m=>({...m}));}
  function state(){return{role,seat,active,room,locked,members:members(),bufferedAmount:Math.max(0,...[...peers.values()].map(e=>e.dc?.bufferedAmount||0)),pending:[...peers.values()].filter(e=>!e.ready).length};}
  function notifyOpen(){if(opened)return;opened=true;emit('onOpen',role,seat);}
  function rawSend(e,wire,bytes){
    if(!current(e)||e.dc?.readyState!=='open'||e.dc.bufferedAmount+(bytes??enc.encode(wire).length)>MAX_BUFFER)return false;
    try{e.dc.send(wire);return true;}catch(_error){return false;}
  }
  function control(e,data){return rawSend(e,JSON.stringify({p:VERSION,session,...data}));}
  function publishRoster(){
    if(role!=='host'||!active)return;
    const list=members(),wire=JSON.stringify({p:VERSION,session,k:'roster',members:list});
    emit('onRoster',list.map(m=>({...m})));
    for(const e of peers.values())if(e.ready){e.pendingRoster=rawSend(e,wire)?null:wire;}
    ui.render();
  }
  function cleanRoster(value){
    if(!Array.isArray(value)||value.length<1||value.length>MAX_PEERS)return null;
    const seen=new Set(),out=[];
    for(const m of value){if(!m||!validSeat(m.seat)||typeof m.connected!=='boolean'||seen.has(m.seat))return null;seen.add(m.seat);out.push({seat:m.seat,connected:m.connected});}
    if(!seen.has(0)||!seen.has(seat))return null;
    return out.sort((a,b)=>a.seat-b.seat);
  }
  function detachSignal(){if(signalSocket&&signalClose)signalSocket.removeEventListener('close',signalClose);signalSocket=null;signalClose=null;}
  function signalSub(topic,fn){subscriptions.set(topic,fn);NET.mqtt.sub(topic,fn);}
  function signalUnsub(topic){subscriptions.delete(topic);NET.mqtt.unsub(topic);}
  function signalPub(topic,data){if(ownsSignal&&NET.mqtt.ready)NET.mqtt.pub(topic,JSON.stringify(data),false);}
  function attachSignal(){
    detachSignal();signalSocket=NET.mqtt.ws;const stamp=generation;
    signalClose=()=>{if(stamp!==generation||!active||!ownsSignal)return;ui.status('Room-code service disconnected. Connected riders can keep racing; manual invites still work.','error');};
    signalSocket?.addEventListener('close',signalClose);
  }
  function destroy(e){
    if(e.closed)return;e.closed=true;clearTimer(e.timeout);clearTimer(e.grace);e.cancelIce?.();
    e.cancel?.(new Error('Invite cancelled. Create or join a fresh room.'));e.cancel=null;
    peers.delete(e.key);if(e.answerTopic&&ownsSignal)signalUnsub(e.answerTopic);
    if(e.rejectOpen){e.rejectOpen(new Error('Connection closed.'));e.rejectOpen=null;e.resolveOpen=null;}
    try{e.dc?.close();}catch(_error){}try{e.pc?.close();}catch(_error){}
  }
  function removePeer(e,reason='A rider disconnected.'){
    if(!current(e))return;const wasReady=e.ready,remoteSeat=role==='host'?e.seat:0;
    if(role==='join'){emit('onConnection',0,'closed');close(reason);ui.status(reason,'error');return;}
    destroy(e);if(wasReady){publishRoster();emit('onConnection',remoteSeat,'closed');}else ui.render();
    ui.status(reason,'error');
  }
  function connection(e,status){
    if(!current(e)||!e.ready)return;
    if(status==='disconnected'){
      if(!e.connected)return;e.connected=false;
      if(role==='host')publishRoster();else{roster=roster.map(m=>m.seat===0?{...m,connected:false}:m);emit('onRoster',members());}
      emit('onConnection',role==='host'?e.seat:0,'disconnected');
      e.grace=later(()=>removePeer(e,'A connection could not recover. Return to the room to rejoin.'),GRACE_MS);ui.render();
    }else if(status==='connected'&&e.dc?.readyState==='open'){
      clearTimer(e.grace);e.grace=null;
      if(e.connected)return;e.connected=true;
      if(role==='host')publishRoster();else{roster=roster.map(m=>m.seat===0?{...m,connected:true}:m);emit('onRoster',members());}
      emit('onConnection',role==='host'?e.seat:0,'connected');ui.render();
    }
  }
  function receive(e,raw){
    if(!current(e)||typeof raw!=='string'||raw.length>MAX_PACKET)return;
    let packet;try{packet=JSON.parse(raw);}catch(_error){return;}
    if(!packet||packet.p!==VERSION||packet.session!==session||typeof packet.k!=='string')return;
    if(packet.k==='welcome'&&role==='join'&&!e.ready){
      if(packet.token!==e.token||packet.seat!==seat)return;
      const list=cleanRoster(packet.members);if(!list)return;
      e.ready=e.connected=true;clearTimer(e.timeout);roster=list;notifyOpen();
      control(e,{k:'ack',token:e.token,seat});emit('onRoster',members());emit('onConnection',0,'connected');
      e.resolveOpen?.(seat);e.resolveOpen=null;e.rejectOpen=null;finishJoin();ui.status('Connected. Choose your ride and get ready.','ok');ui.render();return;
    }
    if(packet.k==='ack'&&role==='host'&&!e.ready){
      if(packet.token!==e.token||packet.seat!==e.seat)return;
      e.ready=e.connected=true;clearTimer(e.timeout);publishRoster();emit('onConnection',e.seat,'connected');ui.status('A rider joined your convoy.','ok');return;
    }
    if(!e.ready)return;
    if(packet.k==='roster'&&role==='join'){
      const list=cleanRoster(packet.members);if(!list)return;roster=list;emit('onRoster',members());ui.render();
    }else if(packet.k==='data'&&packet.data&&typeof packet.data==='object'){
      emit('onMessage',packet.data,role==='host'?e.seat:0);
    }else if(packet.k==='bye')removePeer(e,role==='join'?'The host closed the room.':'A rider left the room.');
  }
  function wireChannel(e,dc){
    if(!current(e)||e.dc||dc.label!=='racing-party-v1'){try{dc.close();}catch(_error){}return;}
    e.dc=dc;dc.bufferedAmountLowThreshold=65536;
    dc.onopen=()=>{
      if(!current(e))return;
      if(role==='host')control(e,{k:'welcome',token:e.token,seat:e.seat,members:[...members(),{seat:e.seat,connected:true}]});
    };
    dc.onmessage=event=>receive(e,event.data);
    dc.onbufferedamountlow=()=>{if(current(e)&&e.pendingRoster&&rawSend(e,e.pendingRoster))e.pendingRoster=null;};
    dc.onclose=()=>removePeer(e,'A rider connection closed.');dc.onerror=()=>{if(current(e))ui.status('A rider connection is having trouble.','error');};
  }
  function makePeer(key,assignedSeat,token,timeoutMs){
    const e={key,seat:assignedSeat,token,generation,pc:null,dc:null,ready:false,connected:false,closed:false,pendingRoster:null,timeout:null,grace:null,answerTopic:null};
    e.canceled=new Promise((resolve,reject)=>{e.cancel=reject;});e.canceled.catch(()=>{});
    const pc=e.pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}]});peers.set(key,e);
    pc.onconnectionstatechange=()=>{if(!current(e))return;const status=pc.connectionState;if(status==='connected'||status==='disconnected')connection(e,status);else if(status==='failed'||status==='closed')removePeer(e,'A rider could not connect. Try a fresh invite or a different network.');};
    pc.ondatachannel=event=>wireChannel(e,event.channel);
    e.timeout=later(()=>removePeer(e,'A rider connection timed out. Create a fresh invite to try again.'),timeoutMs);ui.render();return e;
  }
  function iceDone(e){
    return new Promise(resolve=>{
      if(e.pc.iceGatheringState==='complete')return resolve();let done=false,timer;
      const finish=()=>{if(done)return;done=true;clearTimer(timer);e.pc.removeEventListener('icegatheringstatechange',changed);e.cancelIce=null;resolve();};
      const changed=()=>{if(e.pc.iceGatheringState==='complete')finish();};e.cancelIce=finish;e.pc.addEventListener('icegatheringstatechange',changed);timer=later(finish,3500);
    });
  }
  const pending=(e,promise)=>Promise.race([promise,e.canceled]);
  function ensureCurrent(e){if(!current(e))throw new Error('Invite cancelled. Create or join a fresh room.');}
  function stopLegacy(){NET.leave(true);NET.mmStop?.();NET.mqtt.close();}
  function initialize(nextRole,nextSeat,nextSession){
    role=nextRole;seat=nextSeat;session=nextSession;active=true;locked=false;roster=role==='host'?[{seat:0,connected:true}]:[];
    if(validSeat(seat)){notifyOpen();emit('onRoster',members());}ui.render();
  }
  function reset(reason){close(reason);stopLegacy();}
  async function host(options={}){
    if(typeof RTCPeerConnection==='undefined')throw new Error('This browser cannot connect to an online race.');
    reset('Started a new room.');initialize('host',0,randomToken());const stamp=generation;
    if(options.manual){ui.status('Manual room ready. Create one invite for each guest.','ok');return '';}
    ownsSignal=true;ui.status('Opening your convoy room…');
    try{
      await NET.mqtt.connect();if(stamp!==generation||!active)throw new Error('Room creation cancelled.');
      brokerURL=NET.mqtt.ws?.url||'';const index=NET.mqtt.brokers.indexOf(brokerURL);if(index<0)throw new Error('The room service could not be identified.');
      const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',bytes=crypto.getRandomValues(new Uint8Array(8));
      room='RACE-'+String.fromCharCode(65+index)+'-'+[...bytes].map(b=>alphabet[b%32]).join('');
      signalSub(NS+'/'+room+'/join',payload=>handleJoinRequest(payload,stamp));attachSignal();ui.status('Share the room code. Up to seven friends can join.','ok');ui.render();return room;
    }catch(error){if(stamp===generation){close(error.message);ui.status(error.message+' Use a manual invite below.','error');}throw error;}
  }
  async function createOffer(client=null){
    if(!active||role!=='host')throw new Error('Create a room before inviting riders.');
    if(locked)throw new Error('The race is locked. Wait for the host to open the next grid.');
    const assignedSeat=Array.from({length:7},(_,i)=>i+1).find(n=>![...peers.values()].some(e=>e.seat===n));
    if(assignedSeat===undefined)throw new Error('This room already has eight riders or pending invites.');
    const e=makePeer(client?.id||randomToken(),assignedSeat,randomToken(),client?30000:120000);
    if(client){e.client=client; e.answerTopic=NS+'/'+room+'/answer/'+client.id;signalSub(e.answerTopic,payload=>handleAnswer(e,payload));}
    try{
      wireChannel(e,e.pc.createDataChannel('racing-party-v1',{ordered:true}));
      const offer=await pending(e,e.pc.createOffer());ensureCurrent(e);await pending(e,e.pc.setLocalDescription(offer));ensureCurrent(e);await iceDone(e);ensureCurrent(e);
      const code=await pending(e,NET.pack({v:VERSION,kind:'racing-party-offer',session,token:e.token,seat:e.seat,room,sdp:e.pc.localDescription.sdp}));ensureCurrent(e);e.offer=code;return{code,e};
    }catch(error){if(current(e))destroy(e);ui.render();throw error;}
  }
  async function createInvite(){if(!active||role!=='host')await host({manual:true});return(await createOffer()).code;}
  function validInvite(value,kind){return value&&value.v===VERSION&&value.kind===kind&&TOKEN.test(value.session)&&TOKEN.test(value.token)&&Number.isInteger(value.seat)&&value.seat>=1&&value.seat<8&&typeof value.sdp==='string'&&value.sdp.length>20&&value.sdp.length<=60000&&typeof value.room==='string'&&value.room.length<=40;}
  async function decode(code,kind){if(typeof code!=='string'||code.length>100000)throw new Error('That invite is too large or invalid.');const value=await NET.unpack(code,65536);if(!validInvite(value,kind))throw new Error('This is not an eight-player racing '+(kind.endsWith('offer')?'invite.':'reply.'));return value;}
  async function acceptOffer(value,auto=false){
    session=value.session;seat=value.seat;room=value.room;notifyOpen();const e=makePeer('host',0,value.token,auto?30000:120000);
    e.openPromise=new Promise((resolve,reject)=>{e.resolveOpen=resolve;e.rejectOpen=reject;});e.openPromise.catch(()=>{});
    try{
      await pending(e,e.pc.setRemoteDescription({type:'offer',sdp:value.sdp}));ensureCurrent(e);const answer=await pending(e,e.pc.createAnswer());ensureCurrent(e);await pending(e,e.pc.setLocalDescription(answer));ensureCurrent(e);await iceDone(e);ensureCurrent(e);
      const reply=await pending(e,NET.pack({v:VERSION,kind:'racing-party-answer',session,token:e.token,seat,room,sdp:e.pc.localDescription.sdp}));ensureCurrent(e);return{reply,e};
    }catch(error){if(current(e))removePeer(e,'The invite could not connect. Ask the host for a fresh one.');throw error;}
  }
  async function acceptInvite(code){
    const stamp=generation,value=await decode(code,'racing-party-offer');if(stamp!==generation)throw new Error('Invite cancelled.');
    reset('Joined a different room.');initialize('join',null,value.session);const result=await acceptOffer(value);ui.status('Reply ready. Send it to the host, then wait here.');return result.reply;
  }
  async function acceptReply(code){
    if(!active||role!=='host')throw new Error('Create a host invite before accepting a reply.');const stamp=generation;
    const value=await decode(code,'racing-party-answer');if(stamp!==generation||!active)throw new Error('Invite cancelled.');
    const e=[...peers.values()].find(p=>p.seat===value.seat&&p.token===value.token);
    if(!e||value.session!==session||value.room!==room)throw new Error('That reply belongs to a different or expired invite.');
    if(e.answer){if(e.answer===value.sdp)return true;throw new Error('This invite already has a different reply.');}
    e.answer=value.sdp;
    try{await pending(e,e.pc.setRemoteDescription({type:'answer',sdp:value.sdp}));ensureCurrent(e);ui.status('Connecting the rider…');return true;}
    catch(error){if(current(e)){e.answer=null;ui.status('The reply could not connect. Ask for a fresh reply.','error');}throw error;}
  }
  function handleJoinRequest(payload,stamp){
    if(stamp!==generation||!active||role!=='host'||typeof payload!=='string'||payload.length>2048)return;
    let value;try{value=JSON.parse(payload);}catch(_error){return;}
    if(!value||value.v!==VERSION||value.kind!=='join'||!TOKEN.test(value.client)||!TOKEN.test(value.request))return;
    const topic=NS+'/'+room+'/offer/'+value.client;
    const reject=reason=>signalPub(topic,{v:VERSION,kind:'rejected',request:value.request,reason});
    const existing=peers.get(value.client);
    if(existing){if(existing.client?.request===value.request&&existing.offer)signalPub(topic,{v:VERSION,kind:'offer',request:value.request,code:existing.offer});return;}
    if(locked)return reject('This race has started. Ask the host to reopen the next grid.');
    if(peers.size>=7)return reject('This room is full. Eight riders are already connected or joining.');
    createOffer({id:value.client,request:value.request}).then(({code,e})=>{if(current(e))signalPub(topic,{v:VERSION,kind:'offer',request:value.request,code});}).catch(error=>{if(stamp===generation)reject(error.message);});
  }
  function handleAnswer(e,payload){
    if(!current(e)||typeof payload!=='string'||payload.length>110000)return;let value;try{value=JSON.parse(payload);}catch(_error){return;}
    if(!value||value.v!==VERSION||value.kind!=='answer'||value.request!==e.client.request||typeof value.code!=='string')return;
    // Validation binds the answer to this peer, even on the shared broker.
    decode(value.code,'racing-party-answer').then(answer=>{if(current(e)&&answer.token===e.token&&answer.seat===e.seat)return acceptReply(value.code);}).catch(()=>{if(current(e))ui.status('An invalid reply was ignored. The rider can try again.','error');});
  }
  function finishJoin(){
    if(!joinRequest)return;clearTimer(joinRequest.timer);clearTimer(joinRequest.retry);
    if(joinRequest.topic&&ownsSignal)signalUnsub(joinRequest.topic);joinRequest.resolve?.(seat);joinRequest=null;
  }
  async function join(code){
    code=String(code||'').trim().toUpperCase().replace(/\s+/g,'');const match=/^RACE-([A-C])-([A-HJ-NP-Z2-9]{8})$/.exec(code);
    if(!match)throw new Error('Use a room code like RACE-A-ABCDEFGH, or open Manual invite codes below.');
    reset('Joined a different room.');initialize('join',null,'');room=code;brokerURL=NET.mqtt.brokers[match[1].charCodeAt(0)-65];const stamp=generation;
    if(!brokerURL){close('Invalid room service.');throw new Error('This room uses an unsupported room service.');}
    ownsSignal=true;ui.status('Finding your convoy…');
    try{
      await NET.mqtt.connect(brokerURL);if(stamp!==generation||!active)throw new Error('Join cancelled.');attachSignal();
      const id=randomToken(),request=randomToken(),topic=NS+'/'+room+'/offer/'+id;
      return await new Promise((resolve,reject)=>{
        const pending=joinRequest={resolve,reject,topic,timer:null,retry:null,accepting:false};
        const fail=message=>{if(joinRequest!==pending)return;joinRequest=null;clearTimer(pending.timer);clearTimer(pending.retry);signalUnsub(topic);reject(new Error(message));close(message);ui.status(message,'error');};
        signalSub(topic,async payload=>{
          if(stamp!==generation||joinRequest!==pending||typeof payload!=='string'||payload.length>110000)return;
          let value;try{value=JSON.parse(payload);}catch(_error){return;}
          if(!value||value.v!==VERSION||value.request!==request)return;
          if(value.kind==='rejected')return fail(typeof value.reason==='string'?value.reason.slice(0,180):'The host could not accept another rider.');
          if(pending.accepting||value.kind!=='offer'||typeof value.code!=='string')return;
          pending.accepting=true;clearTimer(pending.retry);
          try{const invite=await decode(value.code,'racing-party-offer');if(stamp!==generation||joinRequest!==pending)return;if(invite.room!==room)throw new Error('That invite belongs to a different room.');const{reply}=await acceptOffer(invite,true);if(stamp!==generation||joinRequest!==pending)return;signalPub(NS+'/'+room+'/answer/'+id,{v:VERSION,kind:'answer',request,code:reply});ui.status('Connecting to the host…');}
          catch(error){if(stamp===generation)fail(error.message);}
        });
        const knock=()=>{if(stamp!==generation||joinRequest!==pending||pending.accepting)return;signalPub(NS+'/'+room+'/join',{v:VERSION,kind:'join',client:id,request});pending.retry=later(knock,1500);};
        pending.timer=later(()=>fail('No host answered this room code. Check the code, or use a manual invite.'),30000);knock();
      });
    }catch(error){if(stamp===generation&&active){close(error.message);ui.status(error.message,'error');}throw error;}
  }
  function send(data,targetSeat){
    if(!active||!data||typeof data!=='object')return false;
    if(targetSeat!==undefined&&(!validSeat(targetSeat)||(role==='join'&&targetSeat!==0)))return false;
    let wire;try{wire=JSON.stringify({p:VERSION,session,k:'data',data});}catch(_error){return false;}
    const bytes=enc.encode(wire).length;if(wire.length>MAX_PACKET||bytes>MAX_PACKET)return false;
    const targets=[...peers.values()].filter(e=>e.ready&&e.connected&&(role==='join'||targetSeat===undefined||e.seat===targetSeat));
    if(!targets.length)return false;let ok=true;for(const e of targets)if(!rawSend(e,wire,bytes))ok=false;return ok;
  }
  function lock(value){if(role!=='host'||!active)return false;locked=!!value;if(locked)for(const e of [...peers.values()])if(!e.ready){if(e.client)signalPub(NS+'/'+room+'/offer/'+e.client.id,{v:VERSION,kind:'rejected',request:e.client.request,reason:'The host locked the grid. Join the next race.'});destroy(e);}ui.render();return true;}
  function close(reason='Left the convoy.'){
    const notify=opened;generation++;opened=false;active=false;
    if(joinRequest){const pending=joinRequest;joinRequest=null;pending.reject?.(new Error(reason));}
    for(const timer of timers)clearTimeout(timer);timers.clear();
    for(const e of peers.values()){try{if(e.dc?.readyState==='open')e.dc.send(JSON.stringify({p:VERSION,session,k:'bye'}));}catch(_error){}destroy(e);}peers.clear();
    detachSignal();subscriptions.clear();if(ownsSignal)NET.mqtt.close();ownsSignal=false;
    role=null;seat=null;session='';room='';roster=[];locked=false;brokerURL='';ui.render();if(notify)emit('onEnd',reason);
  }
  const ui={
    status(message='',kind=''){const e=$('Status');if(e){e.textContent=message;e.dataset.kind=kind;}},
    render(){
      if(!$('Modal'))return;const list=members();$('Count').textContent=list.filter(m=>m.connected).length+' / 8 RIDERS';$('RoomCode').textContent=room||((active&&role==='host')?'MANUAL ROOM':'CREATE OR JOIN A ROOM');$('CopyRoom').disabled=!room;$('LeaveBtn').hidden=!active;
      $('Members').replaceChildren();for(const m of list){const item=document.createElement('li');item.textContent='RIDER '+(m.seat+1)+(m.seat===seat?' · YOU':'')+(m.seat===0?' · HOST':'')+' — '+(m.connected?'CONNECTED':'RECONNECTING');$('Members').append(item);}
      if(role==='host')for(const e of peers.values())if(!e.ready){const item=document.createElement('li');item.textContent='RIDER '+(e.seat+1)+' — CONNECTING';$('Members').append(item);}
      $('RoomHint').textContent=locked?'The grid is locked for this race.':'Pick your ride and get ready after everyone has joined.';
      $('CreateInviteBtn').disabled=role==='host'&&(locked||peers.size>=7);
    },
    hide(){if($('Modal'))$('Modal').hidden=true;if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});returnFocus=null;},
    show(){if(!$('Modal'))return false;if($('Modal').hidden)returnFocus=document.activeElement;$('Modal').hidden=false;ui.render();$('HostBtn').focus();return true;}
  };
  function open(){if(typeof RTCPeerConnection==='undefined'){ui.show();ui.status('This browser cannot connect to an online race. Try an updated browser.','error');return false;}return ui.show();}
  async function copy(text){if(!text)return;try{await navigator.clipboard.writeText(text);ui.status('Copied. Share it with your riders.','ok');}catch(_error){ui.status('Copy is unavailable here. Select the code and copy it manually.','error');}}
  function bindUI(){
    if(bound||!$('Modal'))return false;bound=true;
    const task=fn=>async()=>{try{await fn();}catch(error){ui.status(error.message,'error');}};
    $('HostBtn').onclick=task(()=>host());$('JoinBtn').onclick=task(()=>join($('RoomInput').value));$('RoomInput').addEventListener('keydown',e=>{if(e.key==='Enter')$('JoinBtn').click();});
    $('CloseBtn').onclick=$('BackBtn').onclick=()=>ui.hide();$('LeaveBtn').onclick=()=>{close('You left the convoy.');ui.status('You left the convoy.');};$('CopyRoom').onclick=()=>copy(room);
    $('CreateInviteBtn').onclick=task(async()=>{$('InviteOut').value=await createInvite();ui.status('Send this invite to one guest. Their reply goes in the box below.');});
    $('AcceptInviteBtn').onclick=task(async()=>{$('ReplyOut').value=await acceptInvite($('InviteIn').value);});
    $('AcceptReplyBtn').onclick=task(()=>acceptReply($('ReplyIn').value));$('CopyInvite').onclick=()=>copy($('InviteOut').value);$('CopyReply').onclick=()=>copy($('ReplyOut').value);
    $('Modal').addEventListener('click',e=>{if(e.target===$('Modal'))ui.hide();});
    document.addEventListener('keydown',e=>{
      if($('Modal').hidden)return;
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();ui.hide();}
      else if(e.key==='Tab'){
        const items=[...$('Modal').querySelectorAll('button:not(:disabled),input,textarea,summary,[tabindex="0"]')].filter(el=>el.getClientRects().length);
        const first=items[0],last=items.at(-1);if(!first)return;
        if(!e.shiftKey&&(document.activeElement===last||!$('Modal').contains(document.activeElement))){e.preventDefault();first.focus();}
        else if(e.shiftKey&&(document.activeElement===first||!$('Modal').contains(document.activeElement))){e.preventDefault();last.focus();}
      }
    },true);
    window.addEventListener('beforeunload',()=>close('A rider closed the arcade.'));ui.render();return true;
  }
  const api={configure,bindUI,open,host,join,createInvite,acceptInvite,acceptReply,send,lock,close,get state(){return state();}};
  return api;
})();
