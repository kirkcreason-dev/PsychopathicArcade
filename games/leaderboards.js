const LB = (()=>{
  const CFG = {
    poker: {name:'BIG MONEY RUSTLAS POKER',metric:'CPU MATCH VICTORY SCORE',higher:true,screen:'pkScreen',localOnly:true},
    racing: {name:'ROAD TO THE SHOW',metric:'SOLO RACE SCORE',higher:true,screen:'rcScreen',localOnly:true},
    pool: {name:'JUGGALO POOL',metric:'BEST RACK WON VS CPU',higher:true,screen:'plScreen'},
    ladder: {name:'LADDER WARS',metric:'HIGH SCORE',higher:true,screen:'lwScreen'},
    rumble: {name:'JCW RUMBLE',metric:'HIGH SCORE',higher:true,screen:'ruScreen'},
    chicken: {name:'CHICKEN HUNTIN’',metric:'HIGH SCORE',higher:true,screen:'khScreen'},
    claw: {name:'CARNIVAL CLAW',metric:'BEST FIVE-PULL HAUL',higher:true,screen:'clScreen'},
    shooter: {name:'CARNIVAL CROSSFIRE',metric:'HIGH SCORE',higher:true,screen:'shScreen'},
    ttt:     { name:'TIC TAC SLAM',        metric:'LONGEST FALL STREAK VS CPU', higher:true,  screen:'tttScreen' },
    chess:   { name:'JUGGALO CHESS',       metric:'FEWEST MOVES TO MATE THE CPU', higher:false, screen:'chessScreen' },
    checkers:{ name:'JUGGALO CHECKERS',    metric:'FEWEST MOVES TO SWEEP THE CPU', higher:false, screen:'checkersScreen' },
    pinball: { name:'DARK CARNIVAL PINBALL', metric:'HIGH SCORE', higher:true, screen:'pinballScreen' },
    faygo:   { name:'JOKER CARD FOUR',             metric:'ROUND WIN STREAK VS CPU', higher:true, screen:'faygoScreen' },
    bj:      { name:'BLACKJACK 21',        metric:'PEAK POINTS IN ONE RUN', higher:true, screen:'bjScreen' },
    memory:  { name:'JOKER CARD MEMORY',   metric:'SOLO DECK-CLEAR SCORE', higher:true, screen:'mmScreen' },
    camper:  { name:'GATHERING CAMPER',    metric:'RUN SCORE', higher:true, screen:'gcScreen' },
    solitaire:{ name:'DARK CARNIVAL SOLITAIRE', metric:'KLONDIKE HIGH SCORE', higher:true, screen:'soScreen' },
    j31:     { name:'JUGGALO 31',           metric:'TABLES SWEPT IN A ROW VS CPU', higher:true, screen:'j31Screen' },
    hockey:  { name:'JUGGALO AIR HOCKEY',   metric:'WIN STREAK VS CPU', higher:true, screen:'ahScreen' },
  };
  const SHORT = { racing:'ROAD TO THE SHOW', poker:'RUSTLAS POKER', pool:'POOL', ladder:'LADDER WARS', rumble:'RUMBLE', chicken:'CHICKEN HUNTIN’', claw:'CLAW', shooter:'CROSSFIRE', ttt:'SLAM', chess:'CHESS', checkers:'CHECKERS', pinball:'PINBALL', faygo:'JOKER CARD FOUR', bj:'21', memory:'MEMORY', camper:'CAMPER', solitaire:'SOLITAIRE', j31:'31', hockey:'HOCKEY' };
  const known = g => typeof g==='string' && Object.hasOwn(CFG,g);
  const validScore = v => typeof v==='number' && Number.isFinite(v) && v>0 && v<=Number.MAX_SAFE_INTEGER;
  const sorter = g => (a,b) => CFG[g].higher ? b.v - a.v : a.v - b.v;
  let data = {}, pending = null, queue = [], current = 'ttt';
  try{ data = JSON.parse(localStorage.getItem('pa_lb') || '{}') || {}; }catch(e){ data = {}; }
  if(!data || typeof data!=='object' || Array.isArray(data)) data={};
  data=Object.fromEntries(Object.keys(CFG).map(key=>[key,
    (Array.isArray(data[key]) ? data[key] : [])
      .filter(e=>e && validScore(e.v) && typeof e.name==='string')
      .map(e=>({v:e.v,name:e.name.toUpperCase().replace(/[^A-Z0-9-]/g,'').padEnd(3,'-').slice(0,3),tag:typeof e.tag==='string'?e.tag.slice(0,120):'',t:Number.isFinite(e.t)&&e.t>0&&e.t<8640000000000000?e.t:0}))
      .sort(sorter(key)).slice(0,10)
  ]));
  const save = ()=>{ try{ localStorage.setItem('pa_lb', JSON.stringify(data)); }catch(e){} };
  const board = g => known(g) ? (data[g] = data[g] || []) : [];
  function rankOf(g, v){
    if(!known(g) || !validScore(v)) return -1;
    const list = board(g).slice();
    list.push({ v, __probe:true });
    list.sort(sorter(g));
    const r = list.findIndex(e=>e.__probe);
    return r < 10 ? r : -1;
  }
  // Shared rankings use a separate, acknowledged bridge. The legacy win/badge
  // bridge below is intentionally unchanged, including its localOnly guard.
  const shared = new Map(), requests = new Map(), SHARED_MAX=1000000000;
  let source='device',viewVersion=0,requestSerial=0,dispatching=false;
  function trustedOrigin(origin){
    if(origin==='https://jcwlunacy.net'||origin==='https://www.jcwlunacy.net')return true;
    try{const u=new URL(origin);return ['http:','https:'].includes(u.protocol)&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)&&u.origin===origin;}catch{return false;}
  }
  function parentOrigin(){
    if(window.parent===window)return null;
    const candidates=[];
    try{if(document.referrer)candidates.push(new URL(document.referrer).origin);}catch{}
    try{if(location.ancestorOrigins?.length)candidates.push(location.ancestorOrigins[0]);}catch{}
    try{candidates.push(window.parent.location.origin);}catch{}
    return candidates.find(trustedOrigin)||null;
  }
  const hostOrigin=parentOrigin();
  const validSharedScore=v=>Number.isSafeInteger(v)&&v>0&&v<=SHARED_MAX;
  const sharedState=g=>{if(!shared.has(g))shared.set(g,{rows:[],own:null,state:'idle',submission:'',serial:0});return shared.get(g);};
  function sharedMessage(result){
    if(result?.reason==='standalone')return 'Open the arcade on JCW Lunacy and sign in to use website rankings. Device records work here.';
    if(result?.error==='signed-out'||(result?.ok===true&&result?.signedIn===false))return 'Sign in on JCW Lunacy to view and save website rankings. Device records still work.';
    return 'Website rankings are unavailable right now. Your device records still work.';
  }
  function requestShared(action,g,extra={}){
    if(!known(g))return Promise.resolve({ok:false,error:'invalid-request'});
    if(!hostOrigin)return Promise.resolve({ok:false,error:'unavailable',reason:window.parent===window?'standalone':'untrusted'});
    if(requests.size>=32)return Promise.resolve({ok:false,error:'unavailable'});
    const id='lb-'+Date.now().toString(36)+'-'+(++requestSerial).toString(36)+'-'+crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
    return new Promise(resolve=>{
      const timer=setTimeout(()=>settleShared(id,{ok:false,error:'unavailable'}),30000);
      requests.set(id,{action,g,resolve,timer,sent:false,deadline:Date.now()+30000,packet:{type:'jcw-arcade-rankings',v:1,id,action,g,...extra}});
      dispatchShared();
    });
  }
  function settleShared(id,result){
    const pendingRequest=requests.get(id);if(!pendingRequest)return;
    clearTimeout(pendingRequest.timer);requests.delete(id);pendingRequest.resolve(result);dispatchShared();
  }
  function dispatchShared(){
    if(dispatching)return;dispatching=true;
    try{
      let sent=[...requests.values()].filter(value=>value.sent).length;
      for(const[id,value]of requests){
        if(sent>=3)break;if(value.sent)continue;
        if(value.deadline<=Date.now()){settleShared(id,{ok:false,error:'unavailable'});continue;}
        clearTimeout(value.timer);value.sent=true;
        value.timer=setTimeout(()=>settleShared(id,{ok:false,error:'unavailable'}),Math.max(1,Math.min(8000,value.deadline-Date.now())));
        try{window.parent.postMessage(value.packet,hostOrigin);sent++;}
        catch{clearTimeout(value.timer);requests.delete(id);value.resolve({ok:false,error:'unavailable'});}
      }
    }finally{dispatching=false;}
  }
  function cleanSharedRow(row){
    if(!row||typeof row!=='object'||typeof row.uid!=='string'||!row.uid.length||row.uid.length>128||typeof row.name!=='string'||!row.name.trim()||row.name.length>80||!validSharedScore(row.v)||typeof row.tag!=='string'||row.tag.length>120||!Number.isFinite(row.t)||row.t<0||row.t>=8640000000000000)return null;
    return{uid:row.uid,name:row.name,v:row.v,tag:row.tag,t:row.t};
  }
  window.addEventListener('message',event=>{
    if(event.source!==window.parent||!hostOrigin||event.origin!==hostOrigin||!trustedOrigin(event.origin))return;
    const value=event.data;
    if(!value||typeof value!=='object'||value.type!=='jcw-arcade-rankings-response'||value.v!==1||typeof value.id!=='string'||value.id.length>100)return;
    const pendingRequest=requests.get(value.id);
    if(!pendingRequest||!pendingRequest.sent||value.action!==pendingRequest.action||value.g!==pendingRequest.g||typeof value.ok!=='boolean'||typeof value.signedIn!=='boolean')return;
    const result={ok:value.ok,signedIn:value.signedIn};
    if(!value.ok){if(!['signed-out','unavailable','invalid-request'].includes(value.error))return;result.error=value.error;}
    if(value.ok&&value.action==='submit'){if(typeof value.accepted!=='boolean'||!value.signedIn)return;result.accepted=value.accepted;}
    if(value.ok&&value.action==='list'){
      if(!value.signedIn||!Array.isArray(value.rows)||value.rows.length>10)return;
      const rows=value.rows.map(cleanSharedRow),own=value.own===null?null:cleanSharedRow(value.own);
      if(rows.some(row=>!row)||new Set(rows.map(row=>row.uid)).size!==rows.length||(value.own!==null&&!own))return;
      result.rows=rows.sort(sorter(value.g));result.own=own;
    }
    settleShared(value.id,result);
  });
  function updateSharedNotice(){
    const value=sharedState(current),notice=$('#lbCloudStatus');
    if(source==='website')notice.textContent=value.state==='loading'?'Loading JCW website rankings…':value.state==='ready'?(value.submission||'Signed in · one personal best per player'):value.message||'';
    else notice.textContent=value.submission||'Device records are saved in this browser.';
  }
  async function loadShared(g,version){
    const value=sharedState(g),serial=++value.serial;value.state='loading';value.message='';
    if(current===g&&source==='website'&&version===viewVersion){renderSharedRows();updateSharedNotice();}
    let result=await requestShared('status',g);
    if(result.ok&&result.signedIn)result=await requestShared('list',g);
    if(serial!==value.serial)return;
    if(result.ok&&result.signedIn&&Array.isArray(result.rows)){value.rows=result.rows;value.own=result.own;value.state='ready';}
    else{value.state='unavailable';value.rows=[];value.own=null;value.message=sharedMessage(result);}
    if(current===g&&source==='website'&&version===viewVersion&&!$('#lbModal').hidden){renderSharedRows();updateSharedNotice();}
  }
  function submitShared(g,v,tag){
    const value=sharedState(g);
    if(!validSharedScore(v)){value.submission='This score is outside website ranking limits. Your device record still works.';return;}
    let initials='ICP';try{initials=(localStorage.getItem('pa_lb_name')||'ICP').toUpperCase().replace(/[^A-Z0-9-]/g,'').padEnd(3,'-').slice(0,3);}catch{}
    value.submission=hostOrigin?'Saving to JCW website rankings…':sharedMessage({reason:window.parent===window?'standalone':'untrusted'});
    const serial=value.submissionSerial=(value.submissionSerial||0)+1;
    requestShared('submit',g,{score:v,tag,initials}).then(result=>{
      if(serial!==value.submissionSerial)return;
      value.submission=result.ok?(result.accepted?'Saved to JCW website rankings.':'Your JCW website best is unchanged.'):sharedMessage(result);
      if(current===g&&!$('#lbModal').hidden){updateSharedNotice();if(source==='website'&&result.ok)loadShared(g,viewVersion);}
    });
  }

  /* every win/cleared run is handed to the page hosting the arcade (jcwlunacy.net
     puts it in the player's cloud locker: lockers/<uid>/arcade wins, per-game
     counts, best streak/score). Fire-and-forget; does nothing when the arcade
     is opened on its own. */
  function report(g, v, kind){
    try{
      if(!known(g) || CFG[g].localOnly || window.parent === window) return;
      window.parent.postMessage({ type:'jcw-arcade', ev: kind==='record' ? 'record' : 'win', g, v: Number.isFinite(v) ? v : 0 }, '*');
    }catch(e){}
  }
  function check(g, v, tag){
    if(!known(g) || !validScore(v)) return;
    report(g, v);
    const cleanTag=typeof tag==='string'?tag.slice(0,120):'';
    submitShared(g,v,cleanTag);
    if(rankOf(g, v) < 0) return;
    queue.push({ g, v, tag: typeof tag==='string' ? tag.slice(0,120) : '' });
    if(!pending) nextEntry();
  }
  function nextEntry(){
    pending = queue.shift() || null;
    if(!pending){ $('#lbEntry').hidden = true; return; }
    current = pending.g;source='device';
    render();
    $('#lbEntry').hidden = false;
    $('#lbEntryTitle').textContent = 'DEVICE TOP 10! CARVE YOUR MARK — '+CFG[current].name;
    const init = $('#lbInitials');
    try{ init.value = localStorage.getItem('pa_lb_name') || ''; }catch(e){}
    $('#lbModal').hidden = false;
    Sound.play('fanfare');
    const entry=pending;
    setTimeout(()=>{ try{
      const modal=$('#lbModal');
      if(pending!==entry || modal.hidden || $('#lbEntry').hidden || modal.contains(document.activeElement)) return;
      init.focus(); init.select();
    }catch(e){} }, 50);
  }
  function commit(skip){
    if(!pending){ $('#lbEntry').hidden = true; return; }
    if(!skip){
      const name = ($('#lbInitials').value || 'ICP').toUpperCase().replace(/[^A-Z0-9]/g,'').padEnd(3,'-').slice(0,3);
      try{ localStorage.setItem('pa_lb_name', name); }catch(e){}
      const list = board(pending.g);
      const entry = { v:pending.v, tag:pending.tag, name, t:Date.now() };
      list.push(entry); list.sort(sorter(pending.g));
      if(list.length > 10) list.length = 10;
      data[pending.g] = list; save();
      report(pending.g, 0, 'record');
      render(entry);
      Sound.play('crowdPop', .6);
    }
    pending = null;
    if(queue.length) nextEntry(); else $('#lbEntry').hidden = true;
  }
  function fmtV(g, v){ return v.toLocaleString('en-US') + (CFG[g].higher ? '' : ' MV'); }
  function render(fresh){
    const version=++viewVersion;
    $('#lbDeviceTab').setAttribute('aria-selected',String(source==='device'));$('#lbWebsiteTab').setAttribute('aria-selected',String(source==='website'));
    $('#lbSharedTools').hidden=source!=='website';$('#lbEntry').hidden=!pending||source!=='device';
    $('#lbOwn').hidden=true;updateSharedNotice();
    $('#lbGameName').textContent = CFG[current].name;
    $('#lbMetric').textContent = CFG[current].metric;
    const tabs = $('#lbTabs'); tabs.replaceChildren();
    for(const g of Object.keys(CFG)){
      const b = document.createElement('button');
      b.textContent = SHORT[g]; b.classList.toggle('on', g===current);
      b.onclick = ()=>{ current = g; render(); };
      tabs.appendChild(b);
    }
    if(source==='website'){loadShared(current,version);return;}
    const rows = $('#lbRows'); rows.replaceChildren();
    const list = board(current);
    if(!list.length){
      const e = document.createElement('div'); e.className = 'lb-empty';
      e.textContent = 'NO LEGENDS YET — GO MAKE SOME NOISE'; rows.appendChild(e);
      return;
    }
    list.forEach((en, i)=>{
      const r = document.createElement('div');
      r.className = 'lb-row' + (fresh===en ? ' fresh' : '');
      const d = new Date(en.t || Date.now());
      r.innerHTML = '<span class="rk">'+(i+1)+'</span><span class="nm"></span><span class="tg"></span><span class="vl"></span>';
      r.children[1].textContent = en.name || '---';
      r.children[2].textContent = (en.tag ? en.tag+' · ' : '') + (d.getMonth()+1)+'/'+d.getDate();
      r.children[3].textContent = fmtV(current, en.v);
      rows.appendChild(r);
    });
  }
  function appendSharedRow(container,en,rank,own){
    const row=document.createElement('div');row.className='lb-row shared'+(own?' own':'');
    for(const [cls,text]of[['rk',rank],['nm',en.name+(own?' · YOU':'')],['tg',en.tag],['vl',fmtV(current,en.v)]]){const span=document.createElement('span');span.className=cls;span.textContent=text;row.appendChild(span);}container.appendChild(row);
  }
  function renderSharedRows(){
    const rows=$('#lbRows'),ownBox=$('#lbOwn'),value=sharedState(current);rows.replaceChildren();ownBox.replaceChildren();ownBox.hidden=true;
    if(value.state!=='ready'||!value.rows.length){const empty=document.createElement('div');empty.className='lb-empty';empty.textContent=value.state==='loading'?'CONNECTING TO JCW LUNACY…':value.state==='ready'?'NO WEBSITE RECORDS YET — SET THE FIRST ONE':'YOUR DEVICE RECORDS ARE STILL AVAILABLE';rows.appendChild(empty);}
    if(value.state==='ready'){
      value.rows.forEach((row,i)=>appendSharedRow(rows,row,i+1,row.uid===value.own?.uid));
      if(value.own&&!value.rows.some(row=>row.uid===value.own.uid)){ownBox.hidden=false;const label=document.createElement('div');label.className='lb-own-title';label.textContent='YOUR PERSONAL BEST';ownBox.appendChild(label);appendSharedRow(ownBox,value.own,'YOU',true);}
    }
  }
  function show(g){
    if(!$('#pkScreen').hidden) POKER.pause(true);
    if(!$('#rcScreen').hidden) RACING.pause(true);
    if(!$('#plScreen').hidden) POOL.pause(true);
    if(!$('#lwScreen').hidden) LADDER.pause(true);
    if(!$('#ruScreen').hidden) RUMBLE.pause(true);
    if(!$('#khScreen').hidden) CHICKEN.pause(true);
    if(!$('#shScreen').hidden) SHOOTER.pause(true);
    if(!$('#clScreen').hidden) CLAW.pause(true);
    if(known(g)) current = g;
    $('#lbEntry').hidden = !pending;
    render();
    $('#lbModal').hidden = false;
    Sound.play('move');
  }
  function bind(){
    $('#lbClose').onclick = ()=>{ viewVersion++;pending=null;queue=[];$('#lbEntry').hidden=true;$('#lbModal').hidden=true; };
    $('#lbDeviceTab').onclick=()=>{source='device';render();};
    $('#lbWebsiteTab').onclick=()=>{source='website';render();};
    $('#lbRefresh').onclick=()=>loadShared(current,++viewVersion);
    $('#lbSaveBtn').onclick = ()=>commit(false);
    $('#lbSkipBtn').onclick = ()=>commit(true);
    $('#lbInitials').addEventListener('keydown', e=>{ if(e.key==='Enter') commit(false); e.stopPropagation(); });
    $('#lbInitials').addEventListener('input', e=>{ e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,3); });
    $('#recordsBtn').onclick = ()=>show(current);
    // trophy button on every game screen
    for(const [g, cfg] of Object.entries(CFG)){
      const row = document.querySelector('#'+cfg.screen+' .ctl-row');
      if(!row) continue;
      const wrap = document.createElement('div'); wrap.className = 'ctl';
      const b = document.createElement('button');
      b.className = 'img-btn icon lb-mini'; b.setAttribute('aria-label','Leaderboard');
      const im = document.createElement('img'); im.src = img('mm_icoTrophy'); im.alt = 'Records';
      b.appendChild(im); b.onclick = ()=>show(g);
      wrap.appendChild(b); row.appendChild(wrap);
    }
  }
  return { bind, check, show, board, rankOf, CFG,
           debug:{ wipe(){ data={}; save(); }, data:()=>data, forcePending:()=>pending } };
})();
window.LB_READY = true;
