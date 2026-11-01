import { test, expect } from '@playwright/test';

// Real local data channels, no STUN/public broker dependency. WebKit local ICE
// availability differs on this machine; its rendering is tested separately.
test.skip(({ browserName }) => browserName === 'webkit', 'Local peer ICE is exercised in Chrome.');

async function createPeers(browser, baseURL) {
  const pages = [await browser.newPage(), await browser.newPage()], errors = [];
  for (const page of pages) {
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(baseURL + '/game.html');
    await page.waitForFunction(() => window.RACING_READY);
    await page.evaluate(async () => {
      ARCADE.Sound.on = false;
      const RTC = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends RTC { constructor() { super({ iceServers: [] }); } };
      ARCADE.showScreen('racing');
      await ARCADE.RACING.loadAssets();
      const push = ARCADE.NET.push;
      window.racingPackets = [];
      window.rawRacingPush = push;
      window.dropRacingInputs = false;
      ARCADE.NET.push = (game, data) => {
        if (game === 'racing') {
          racingPackets.push(JSON.parse(JSON.stringify(data)));
          if (data.k === 'input' && dropRacingInputs) return;
        }
        return push(game, data);
      };
    });
    await page.waitForFunction(() => ARCADE.RACING.state.loaded);
  }
  return { pages, host: pages[0], join: pages[1], errors };
}

async function connect(host, join) {
  const offer = await host.evaluate(() => { ARCADE.NET.state.game = 'racing'; return ARCADE.NET.hostCreate(); });
  const answer = await join.evaluate(offer => ARCADE.NET.joinAccept(offer), offer);
  await host.evaluate(answer => ARCADE.NET.hostConnect(answer), answer);
  for (const page of [host, join]) await page.waitForFunction(() => ARCADE.NET.state.session && ARCADE.RACING.netState()?.synced);
}

async function ready(host, join) {
  expect(await host.evaluate(() => ARCADE.RACING.ready())).toBe(true);
  expect(await join.evaluate(() => ARCADE.RACING.ready())).toBe(true);
  for (const page of [host, join]) await page.waitForFunction(() => ARCADE.RACING.state.started && !ARCADE.RACING.state.paused && ARCADE.RACING.state.phase === 'countdown');
  await host.evaluate(() => { for (let i = 0; i < 13; i++) ARCADE.RACING.debug.advance(.25, { steer: 0, brake: false, boost: false }); });
  for (const page of [host, join]) await page.waitForFunction(() => ARCADE.RACING.state.phase === 'racing');
}

async function pauseBoth(host, join) {
  await host.evaluate(() => ARCADE.RACING.pause(true));
  await join.evaluate(() => ARCADE.RACING.pause(true));
  for (const page of [host, join]) await page.waitForFunction(() => ARCADE.RACING.state.paused);
  await expect.poll(async () => JSON.stringify(await world(join))).toBe(JSON.stringify(await world(host)));
}

function world(page) {
  return page.evaluate(() => {
    const s = ARCADE.RACING.state;
    return { phase: s.phase, time: s.time, countdown: s.countdown, racers: s.racers, objects: s.objects, finishOrder: s.finishOrder };
  });
}

async function closePages(pages) { for (const page of pages) await page.close(); }


test('racing assets are embedded, decode once, and retain separate padded rider images', async ({ page }) => {
  const requests = [], errors = [];
  page.on('request', r => { if (r.resourceType() === 'image' && /^https?:/.test(r.url())) requests.push(r.url()); });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/game.html');
  await page.waitForFunction(() => window.RACING_READY);
  const result = await page.evaluate(async () => {
    ARCADE.Sound.on = false; ARCADE.showScreen('racing');
    const first = ARCADE.RACING.loadAssets(), second = ARCADE.RACING.loadAssets();
    const cached = first === second; await first;
    const data = RACING_ASSET_DATA;
    const images = [...Object.values(data.riders), ...data.backgrounds, ...Object.values(data.vectors)];
    return {
      cached, loaded: ARCADE.RACING.state.loaded, count: images.length,
      embedded: images.every(s => /^data:image\/(?:webp|svg\+xml);base64,/.test(s)),
      riders: Object.values(data.manifest.runtime.riders).map(r => ({ width: r.width, height: r.height, transparent: r.alpha.transparent, alphaDifference: r.alpha.maxDownsampleAlphaDifference, padding: r.padding })),
      roster: [...document.querySelectorAll('[data-racing-racer] img')].map(i => ({ src: i.src.startsWith('data:image/webp;'), complete: i.complete && i.naturalWidth === 512 })),
    };
  });
  expect(result.cached).toBe(true); expect(result.loaded).toBe(true); expect(result.count).toBe(29); expect(result.embedded).toBe(true);
  expect(result.riders).toHaveLength(6); expect(result.roster).toHaveLength(6);
  for (const rider of result.riders) {
    expect([rider.width, rider.height]).toEqual([512, 512]); expect(rider.transparent).toBeGreaterThan(0); expect(rider.alphaDifference).toBe(0);
    expect(Math.min(...Object.values(rider.padding))).toBeGreaterThan(0);
  }
  expect(result.roster.every(r => r.src && r.complete)).toBe(true);
  expect(requests).toEqual([]); expect(errors).toEqual([]);
});


test('real racing peers wait for both choices and readiness, then propagate steering and converge', async ({ browser, baseURL }) => {
  const { host, join, pages, errors } = await createPeers(browser, baseURL);
  try {
    await host.evaluate(() => ARCADE.RACING.choose('big-foot'));
    await join.evaluate(() => ARCADE.RACING.choose('mad-man-pondo'));
    await connect(host, join);
    expect(await host.evaluate(() => ARCADE.RACING.ready())).toBe(true);
    await host.waitForTimeout(200);
    expect(await host.evaluate(() => ARCADE.RACING.state.started)).toBe(false);
    expect(await host.evaluate(() => ARCADE.RACING.choose('violent-j'))).toBe(false);
    expect(await join.evaluate(() => ARCADE.RACING.ready())).toBe(true);
    for (const page of pages) await page.waitForFunction(() => ARCADE.RACING.state.started && ARCADE.RACING.netState().round === 1);
    expect(await host.evaluate(() => ARCADE.RACING.state.racers.slice(0, 2).map(r => r.racerId))).toEqual(['big-foot', 'mad-man-pondo']);
    await host.evaluate(() => { for (let i = 0; i < 13; i++) ARCADE.RACING.debug.advance(.25); });
    for (const page of pages) await page.waitForFunction(() => ARCADE.RACING.state.phase === 'racing');
    const before = await host.evaluate(() => ARCADE.RACING.state.racers[1].x);
    await join.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
    await host.waitForFunction(() => ARCADE.RACING.netState().controls.steer === -1);
    await host.evaluate(() => { ARCADE.RACING.debug.advance(.25); ARCADE.RACING.debug.advance(.25); });
    expect(await host.evaluate(() => ARCADE.RACING.state.racers[1].x)).toBeLessThan(before - .1);
    await join.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', bubbles: true })));
    await host.waitForFunction(() => ARCADE.RACING.netState().controls.steer === 0);
    await pauseBoth(host, join);
    const fixed = await world(join);
    await join.evaluate(() => ARCADE.RACING.debug.advance(.25, { steer: 1, boost: true }));
    expect(await world(join)).toEqual(fixed);
    expect(errors).toEqual([]);
  } finally { await closePages(pages); }
});


test('racing peers reject stale controls and malformed or impossible snapshots', async ({ browser, baseURL }) => {
  const { host, join, pages, errors } = await createPeers(browser, baseURL);
  try {
    await connect(host, join); await ready(host, join); await pauseBoth(host, join);
    const beforeHost = await world(host), beforeJoin = await world(join);
    await join.evaluate(() => {
      const n = ARCADE.RACING.netState();
      const good = { v: 1, k: 'input', round: n.round, epoch: n.epoch, seq: n.tx + 1000, choice: ARCADE.RACING.state.chosen, ready: false, paused: true, controls: { steer: 0, brake: false, boost: false }, loaded: true };
      for (const bad of [
        { ...good, seq: 0, controls: { ...good.controls, steer: 1 } },
        { ...good, round: good.round - 1 }, { ...good, epoch: -1 }, { ...good, choice: 'unknown-racer' },
        { ...good, controls: { ...good.controls, steer: 2 } }, { ...good, controls: { ...good.controls, brake: 'yes' } },
      ]) rawRacingPush('racing', bad);
    });
    await host.waitForTimeout(100);
    expect(await host.evaluate(() => ARCADE.RACING.netState().controls.steer)).toBe(0);
    expect(await world(host)).toEqual(beforeHost);
    const snapshot = await host.evaluate(() => racingPackets.filter(p => p.k === 'snapshot').at(-1));
    const rejected = await join.evaluate(snapshot => {
      const original = ARCADE.RACING.state;
      const mutate = change => { const d = structuredClone(snapshot); d.seq = ARCADE.RACING.netState().rx + 1000; change(d); ARCADE.RACING.netApply(d); return ARCADE.RACING.netState().rx !== d.seq; };
      return [
        mutate(d => { d.state.racers[0].x = 2; }),
        mutate(d => { d.state.racers[0].speed = Infinity; }),
        mutate(d => { d.state.objects = [{ id: 1, kind: 'unknown' }]; }),
        mutate(d => { d.state.finishOrder = [7]; }),
        mutate(d => { d.state.phase = 'finished'; d.state.finishOrder = []; }),
        mutate(d => { d.seq = 0; d.state.racers[0].tickets += 1; }),
        mutate(d => { d.round--; }),
        mutate(d => { d.state.time = original.time - .01; }),
        mutate(d => { d.state.racers[0].drifting = 'yes'; }),
        mutate(d => { d.state.racers[0].driftCharge = 2.01; }),
        mutate(d => { d.state.racers[0].driftDirection = .5; }),
        mutate(d => { d.state.racers[0].driftTurbo = 2.01; }),
        mutate(d => { d.state.racers[0].drifts = 1.5; }),
        mutate(d => { delete d.state.racers[0].drifting; }),
        mutate(d => { d.state.racers[0].driftCharge = .5; }),
        mutate(d => { d.state.racers[0].driftDirection = 1; }),
        mutate(d => { Object.assign(d.state.racers[0], { drifting: true, driftDirection: 0 }); }),
        mutate(d => { Object.assign(d.state.racers[0], { drifting: true, driftDirection: 1, driftTurbo: .5 }); }),
        mutate(d => { d.state.events.push({ id: 'bad-tier', type: 'drift', racer: 0, time: d.state.time, tier: 3, amount: 12 }); }),
        mutate(d => { d.state.events.push({ id: 'bad-amount', type: 'drift', racer: 0, time: d.state.time, tier: 1, amount: 13 }); }),
      ];
    }, snapshot);
    expect(rejected).toEqual(Array(20).fill(true));
    expect(await world(join)).toEqual(beforeJoin); expect(errors).toEqual([]);
  } finally { await closePages(pages); }
});


test('both racing peers must resume after a pause or guest-only transport interruption', async ({ browser, baseURL }) => {
  const { host, join, pages, errors } = await createPeers(browser, baseURL);
  try {
    await connect(host, join); await ready(host, join);
    await join.evaluate(() => ARCADE.RACING.pause(true));
    await host.waitForFunction(() => ARCADE.RACING.state.paused);
    await expect(host.locator('#rcPause')).toBeVisible();
    await expect(join.locator('#rcPause')).toBeVisible();
    await pauseBoth(host, join);
    const frozen = await world(host);
    await join.evaluate(() => ARCADE.RACING.pause(false));
    await host.waitForTimeout(100);
    expect(await host.evaluate(() => ARCADE.RACING.state.paused)).toBe(true); expect(await world(host)).toEqual(frozen);
    await host.evaluate(() => ARCADE.RACING.pause(false));
    for (const page of pages) await page.waitForFunction(() => !ARCADE.RACING.state.paused);
    const oldInput = await join.evaluate(() => racingPackets.filter(p => p.k === 'input').at(-1));
    const oldEpoch = await host.evaluate(() => ARCADE.RACING.netState().epoch);
    await join.evaluate(() => { ARCADE.RACING.netConnection('disconnected'); ARCADE.RACING.netConnection('connected'); });
    await host.waitForFunction(epoch => ARCADE.RACING.netState().epoch > epoch && ARCADE.RACING.state.paused, oldEpoch);
    await join.waitForFunction(() => ARCADE.RACING.netState().synced && ARCADE.RACING.state.paused);
    await host.evaluate(() => ARCADE.RACING.pause(false));
    await join.evaluate(old => rawRacingPush('racing', { ...old, seq: 900000, paused: false }), oldInput);
    await host.waitForTimeout(100);
    expect(await host.evaluate(() => ARCADE.RACING.state.paused)).toBe(true);
    await join.evaluate(() => ARCADE.RACING.pause(false));
    for (const page of pages) await page.waitForFunction(() => !ARCADE.RACING.state.paused);
    expect(errors).toEqual([]);
  } finally { await closePages(pages); }
});


test('racing heartbeat stalls and host-only interruptions require fresh resumes from both peers', async ({ browser, baseURL }) => {
  const { host, join, pages, errors } = await createPeers(browser, baseURL);
  try {
    await connect(host, join); await ready(host, join);
    const initialEpoch = await host.evaluate(() => ARCADE.RACING.netState().epoch);
    const oldInput = await join.evaluate(() => {
      const packet = racingPackets.filter(p => p.k === 'input').at(-1);
      window.dropRacingInputs = true;
      return packet;
    });
    await host.waitForFunction(epoch => {
      const n = ARCADE.RACING.netState();
      return n.stalled && n.epoch > epoch && ARCADE.RACING.state.paused;
    }, initialEpoch);
    await join.waitForFunction(() => ARCADE.RACING.state.paused);
    const frozen = await world(host);
    await host.waitForTimeout(300);
    expect(await world(host)).toEqual(frozen);
    await expect.poll(async () => JSON.stringify(await world(join))).toBe(JSON.stringify(frozen));
    for (const page of pages) {
      const s = await page.evaluate(() => ARCADE.RACING.state);
      expect(s.phase).toBe('racing'); expect(s.best).toBe(0); expect(s.wins).toBe(0); expect(s.ended).toBe(false);
      await expect(page.locator('#rcResult')).toBeHidden();
    }
    // Restore delivery. Receiving controls acknowledges the new epoch, but it
    // does not provide either player's explicit confirmation to resume.
    await join.evaluate(() => { window.dropRacingInputs = false; });
    await host.waitForFunction(() => !ARCADE.RACING.netState().stalled);
    await host.evaluate(() => ARCADE.RACING.pause(false));
    await join.evaluate(old => rawRacingPush('racing', { ...old, seq: 900000, paused: false }), oldInput);
    await host.waitForTimeout(100);
    expect(await host.evaluate(() => ARCADE.RACING.state.paused)).toBe(true);
    expect(await world(host)).toEqual(frozen);
    await join.evaluate(() => ARCADE.RACING.pause(false));
    for (const page of pages) await page.waitForFunction(() => !ARCADE.RACING.state.paused);

    // A transport change observed by only the host still establishes a fresh
    // epoch and pauses the guest through the authoritative snapshot.
    const currentEpoch = await host.evaluate(() => ARCADE.RACING.netState().epoch);
    const beforeInterruption = await join.evaluate(() => racingPackets.filter(p => p.k === 'input').at(-1));
    await host.evaluate(() => { ARCADE.RACING.netConnection('disconnected'); ARCADE.RACING.netConnection('connected'); });
    for (const page of pages) await page.waitForFunction(epoch => ARCADE.RACING.state.paused && ARCADE.RACING.netState().epoch > epoch, currentEpoch);
    const stopped = await world(host);
    await host.evaluate(() => ARCADE.RACING.pause(false));
    await join.evaluate(old => rawRacingPush('racing', { ...old, seq: 900001, paused: false }), beforeInterruption);
    await host.waitForTimeout(100);
    expect(await world(host)).toEqual(stopped); expect(await host.evaluate(() => ARCADE.RACING.state.paused)).toBe(true);
    await join.evaluate(() => ARCADE.RACING.pause(false));
    for (const page of pages) await page.waitForFunction(() => !ARCADE.RACING.state.paused);
    expect(errors).toEqual([]);
  } finally { await closePages(pages); }
});


test('racing peers finish a complete race and require both players for a rematch', async ({ browser, baseURL }) => {
  test.setTimeout(60000);
  const { host, join, pages, errors } = await createPeers(browser, baseURL);
  try {
    for (const page of pages) expect(await page.evaluate(() => ARCADE.RACING.chooseMode('daily'))).toBe(true);
    await connect(host, join);
    for (const page of pages) expect(await page.evaluate(() => ({ mode: ARCADE.RACING.state.runMode, day: ARCADE.RACING.state.raceDay }))).toEqual({ mode: 'convoy', day: '' });
    await ready(host, join);
    await host.evaluate(() => {
      for (let i = 0; i < 850 && ARCADE.RACING.state.phase !== 'finished'; i++) {
        const s = ARCADE.RACING.state;
        ARCADE.RACING.debug.advance(.25, RACING_RULES.aiInput(s, 0));
      }
    });
    for (const page of pages) await page.waitForFunction(() => ARCADE.RACING.state.mode === 'finished');
    expect(await world(join)).toEqual(await world(host));
    for (const page of pages) {
      const s = await page.evaluate(() => ARCADE.RACING.state);
      expect(s.finishOrder).toHaveLength(6); expect(new Set(s.finishOrder).size).toBe(6);
      expect(s.racers.every(r => Number.isFinite(r.finishTime))).toBe(true);
      expect(s.best).toBe(0); expect(s.wins).toBe(0); expect(s.dailyBest).toBeNull();
      expect(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('pa_racing_dailyRecords') || '{}')).length)).toBe(0); await expect(page.locator('#rcSaveBtn')).toBeHidden();
      await expect(page.locator('#rcPlacements li')).toHaveCount(6);
    }
    expect(await host.evaluate(() => ARCADE.RACING.ready())).toBe(true);
    await host.waitForTimeout(100); expect(await host.evaluate(() => ARCADE.RACING.state.phase)).toBe('finished');
    expect(await join.evaluate(() => ARCADE.RACING.ready())).toBe(true);
    for (const page of pages) await page.waitForFunction(() => ARCADE.RACING.netState().round === 2 && ARCADE.RACING.state.phase === 'countdown');
    expect(await host.evaluate(() => ARCADE.RACING.state.time === 0 && ARCADE.RACING.state.finishOrder.length === 0 && ARCADE.RACING.state.racers.every(r => r.finishTime === null && r.speed === 0))).toBe(true);
    expect(errors).toEqual([]);
  } finally { await closePages(pages); }
});


test('racing disconnects preserve the guest viewpoint and award no result', async ({ browser, baseURL }) => {
  const { host, join, pages, errors } = await createPeers(browser, baseURL);
  try {
    await connect(host, join); await ready(host, join); await pauseBoth(host, join);
    const before = await world(join);
    await host.evaluate(() => ARCADE.NET.leave());
    for (const page of pages) await page.waitForFunction(() => ARCADE.RACING.state.mode === 'disconnected' && !ARCADE.NET.state.session);
    expect(await world(join)).toEqual(before);
    expect(await join.evaluate(() => ARCADE.RACING.state.seat)).toBe(1);
    for (const page of pages) {
      const s = await page.evaluate(() => ARCADE.RACING.state);
      expect(s.best).toBe(0); expect(s.wins).toBe(0); expect(s.ended).toBe(true); expect(s.playMode).toBe('online');
      await expect(page.locator('#rcResultTitle')).toHaveText('RACE INTERRUPTED');
      await expect(page.locator('#rcResultDetail')).toContainText('No race result was awarded');
      await expect(page.locator('#rcSaveBtn')).toBeHidden(); await expect(page.locator('#rcPlacements li')).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  } finally { await closePages(pages); }
});


test('legacy RACER room codes complete automatic signaling with real local racing peers', async ({ browser, baseURL }) => {
  test.setTimeout(60000);
  const { host, join, pages, errors } = await createPeers(browser, baseURL), retained = new Map(), subscribers = new Map();
  try {
    for (const page of pages) {
      await page.exposeFunction('racingBroker', async ({ op, topic, payload, retain }) => {
        if (op === 'sub') {
          if (!subscribers.has(topic)) subscribers.set(topic, new Set()); subscribers.get(topic).add(page);
          if (retained.has(topic)) await page.evaluate(({ topic, payload }) => deliverRacingBroker(topic, payload), { topic, payload: retained.get(topic) });
        } else if (op === 'unsub') subscribers.get(topic)?.delete(page);
        else if (op === 'close') { for (const clients of subscribers.values()) clients.delete(page); }
        else if (op === 'pub') {
          if (retain) { if (payload) retained.set(topic, payload); else retained.delete(topic); }
          for (const target of subscribers.get(topic) || []) if (!target.isClosed()) await target.evaluate(({ topic, payload }) => deliverRacingBroker(topic, payload), { topic, payload });
        }
      });
      await page.evaluate(() => {
        const m = ARCADE.NET.mqtt, subs = new Map();
        window.deliverRacingBroker = (topic, payload) => { for (const fn of subs.get(topic) || []) fn(payload, topic); };
        m.connect = async () => { m.ready = true; };
        m.sub = (topic, fn) => { if (!subs.has(topic)) subs.set(topic, []); subs.get(topic).push(fn); void racingBroker({ op: 'sub', topic }); };
        m.unsub = topic => { subs.delete(topic); void racingBroker({ op: 'unsub', topic }); };
        m.pub = (topic, payload, retain) => { if (m.ready) void racingBroker({ op: 'pub', topic, payload, retain }); };
        m.close = () => { m.ready = false; subs.clear(); void racingBroker({ op: 'close' }); };
      });
    }
    // The racing ONLINE button now opens the eight-player party lobby. Exercise
    // the retained two-peer signaling API explicitly; party UI has its own suite.
    await host.evaluate(async () => { ARCADE.NET.state.game = 'racing'; await ARCADE.NET.createRoom(); });
    await expect(host.locator('#netRoomCode')).toHaveText(/^RACER-\d{6}$/);
    const code = await host.locator('#netRoomCode').textContent();
    await join.evaluate(code => ARCADE.NET.joinRoom(code), code);
    for (const page of pages) await page.waitForFunction(() => ARCADE.NET.state.session && ARCADE.RACING.netState()?.synced);
    await ready(host, join); await pauseBoth(host, join);
    expect(await world(join)).toEqual(await world(host)); expect(errors).toEqual([]);
  } finally { await closePages(pages); }
});


test('slow outbound channels bound queued updates and require both players to resume after draining', async ({ browser, baseURL }) => {
  test.setTimeout(60000);
  const { host, join, pages, errors } = await createPeers(browser, baseURL);
  try {
    await connect(host, join); await ready(host, join);
    for (const congested of [host, join]) {
      await congested.evaluate(() => Object.defineProperty(ARCADE.NET.state.dc, 'bufferedAmount', { configurable: true, value: 128 * 1024 }));
      await congested.waitForFunction(() => ARCADE.RACING.netState().congested && ARCADE.RACING.state.paused);
      const count = await congested.evaluate(() => racingPackets.length);
      if (congested === join) await host.waitForFunction(() => ARCADE.RACING.state.paused);
      const frozen = await world(host);
      await congested.waitForTimeout(200);
      expect(await congested.evaluate(() => racingPackets.length)).toBe(count);
      expect(await world(host)).toEqual(frozen);
      await expect(congested.locator('#rcResumeBtn')).toBeDisabled();
      expect(await host.evaluate(() => ARCADE.RACING.state.best)).toBe(0);
      // Stay paused inside the hysteresis range, rather than alternating sends
      // and pauses while a slow queue hovers just below the high-water mark.
      await congested.evaluate(() => Object.defineProperty(ARCADE.NET.state.dc, 'bufferedAmount', { configurable: true, value: 32 * 1024 }));
      await congested.waitForTimeout(200);
      expect(await congested.evaluate(() => ARCADE.RACING.netState().congested)).toBe(true);
      expect(await congested.evaluate(() => racingPackets.length)).toBe(count);
      await congested.evaluate(() => { delete ARCADE.NET.state.dc.bufferedAmount; });
      await congested.waitForFunction(() => !ARCADE.RACING.netState().congested);
      for (const page of pages) await page.waitForFunction(() => ARCADE.RACING.state.paused && ARCADE.RACING.netState().synced);
      await host.evaluate(() => ARCADE.RACING.pause(false));
      await host.waitForTimeout(100);
      expect(await host.evaluate(() => ARCADE.RACING.state.paused)).toBe(true);
      await join.evaluate(() => ARCADE.RACING.pause(false));
      for (const page of pages) await page.waitForFunction(() => !ARCADE.RACING.state.paused);
    }
    expect(errors).toEqual([]);
  } finally { await closePages(pages); }
});


test('guest brake-and-steer drifts are simulated by the host and shared with the guest', async ({ browser, baseURL }) => {
  const { host, join, pages, errors } = await createPeers(browser, baseURL);
  try {
    await connect(host, join); await ready(host, join);
    await host.evaluate(() => { for (let i = 0; i < 50; i++) ARCADE.RACING.debug.advance(.05); });
    await join.waitForFunction(() => ARCADE.RACING.state.racers[1].speed >= 120);
    await join.evaluate(() => {
      for (const [key, code] of [['ArrowLeft', 'ArrowLeft'], ['ArrowDown', 'ArrowDown']]) document.body.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true }));
    });
    await host.waitForFunction(() => ARCADE.RACING.netState().controls.steer === -1 && ARCADE.RACING.netState().controls.brake);
    await host.evaluate(() => { for (let i = 0; i < 15; i++) ARCADE.RACING.debug.advance(.05); });
    await join.waitForFunction(() => ARCADE.RACING.state.racers[1].drifting && ARCADE.RACING.state.racers[1].driftCharge >= .65);
    const charging = await host.evaluate(() => ARCADE.RACING.state.racers[1]);
    expect(charging.driftDirection).toBe(-1);
    await expect(join.locator('#rcDriftMeter')).toBeVisible();
    await join.evaluate(() => {
      for (const [key, code] of [['ArrowLeft', 'ArrowLeft'], ['ArrowDown', 'ArrowDown']]) document.body.dispatchEvent(new KeyboardEvent('keyup', { key, code, bubbles: true }));
    });
    await host.waitForFunction(() => !ARCADE.RACING.netState().controls.brake && ARCADE.RACING.netState().controls.steer === 0);
    await host.evaluate(() => ARCADE.RACING.debug.advance(.05));
    await join.waitForFunction(() => ARCADE.RACING.state.racers[1].drifts > 0);
    await pauseBoth(host, join);
    const shared = await world(host);
    expect(await world(join)).toEqual(shared);
    expect(shared.racers[1].drifting).toBe(false); expect(shared.racers[1].driftCharge).toBe(0); expect(shared.racers[1].drifts).toBe(charging.drifts + 1);
    expect(shared.racers[1].driftTurbo).toBeGreaterThan(0);
    expect(shared.objects.length).toBeGreaterThan(0);
    const packet = await host.evaluate(() => racingPackets.filter(p => p.k === 'snapshot').at(-1));
    expect(packet.state.events.some(e => e.type === 'drift' && e.racer === 1 && e.tier === 1 && e.amount >= 0 && e.amount <= 12)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await closePages(pages); }
});
