import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/game.html');
  await page.waitForFunction(() => window.POKER_READY);
  await page.evaluate(() => { ARCADE.Sound.on = false; });
});

test('poker rejects incompatible invites and unknown games before creating a peer', async ({ page }) => {
  const errors = await page.evaluate(async () => {
    const net = ARCADE.NET, errors = [];
    for (const packet of [{ g: 'poker', s: 'invalid', v: 0 }, { g: 'unknown', s: 'invalid' }, null]) {
      try { await net.joinAccept(await net.pack(packet)); } catch (e) { errors.push(e.message); }
      if (net.state.pc !== null) throw new Error('Invalid invite created a peer');
    }
    return errors;
  });
  expect(errors).toHaveLength(3);
  expect(errors[0]).toContain('versions do not match');
  expect(errors[1]).toContain('Invalid arcade invite');
});

test('closing a pending invite cannot resurrect its connection after decoding', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const net = ARCADE.NET;
    const code = await net.pack({ g: 'poker', v: 1, s: 'unused' });
    const pending = net.joinAccept(code).then(() => 'unexpected connection', e => e.message);
    net.leave();
    return { message: await pending, connected: net.state.connected, peer: net.state.pc };
  });
  expect(result.message).toContain('cancelled');
  expect(result.connected).toBe(false);
  expect(result.peer).toBeNull();
});

for (const operation of ['createRoom', 'joinRoom', 'quickMatch']) {
  test(`cancelled ${operation} cannot replace a newer lobby when the broker connects late`, async ({ page }) => {
    const result = await page.evaluate(async operation => {
      const net = ARCADE.NET;
      net.state.game = 'poker';
      let connected, subscriptions = 0;
      net.mqtt.connect = () => new Promise(resolve => { connected = resolve; });
      net.mqtt.sub = () => { subscriptions++; };
      const pending = net[operation]('RUSTLAS-123456');
      net.mmStop();
      // A newer operation owns the lobby by the time the old connection resolves.
      net.mm.active = true; net.mm.mode = 'newer-lobby';
      connected();
      await pending;
      const result = { peer: net.state.pc, mode: net.mm.mode, subscriptions };
      net.mmStop();
      return result;
    }, operation);
    expect(result).toEqual({ peer: null, mode: 'newer-lobby', subscriptions: 0 });
  });
}

test('poker transport keeps a short interruption recoverable, then closes after grace expires', async ({ page }) => {
  await page.clock.install();
  await page.evaluate(async () => {
    const RTC = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends RTC { constructor() { super({ iceServers: [] }); } };
    const net = ARCADE.NET;
    net.state.game = 'poker';
    await net.hostCreate();
    net.debug.fakeSession('poker', 'host');
    ARCADE.showScreen('poker');
    ARCADE.POKER.netStart('host');
    window.pokerTransportState = state => {
      const pc = net.state.pc;
      Object.defineProperty(pc, 'connectionState', { configurable: true, value: state });
      pc.dispatchEvent(new Event('connectionstatechange'));
    };
    pokerTransportState('disconnected');
  });
  expect(await page.evaluate(() => ({ session: ARCADE.NET.state.session, connected: ARCADE.NET.state.connected })))
    .toEqual({ session: true, connected: false });
  await expect(page.locator('#netPillTxt')).toHaveText(/RECONNECTING/);
  await page.clock.fastForward(19000);
  expect(await page.evaluate(() => ARCADE.NET.state.session)).toBe(true);
  await page.evaluate(() => pokerTransportState('connected'));
  await page.clock.fastForward(2000);
  expect(await page.evaluate(() => ({ session: ARCADE.NET.state.session, connected: ARCADE.NET.state.connected })))
    .toEqual({ session: true, connected: true });
  await page.evaluate(() => pokerTransportState('disconnected'));
  await page.clock.fastForward(20001);
  expect(await page.evaluate(() => ({ session: ARCADE.NET.state.session, peer: ARCADE.NET.state.pc })))
    .toEqual({ session: false, peer: null });
});

test('cancelled broker sockets and old close callbacks cannot replace the current connection', async ({ page }) => {
  await page.clock.install();
  await page.evaluate(() => {
    window.brokerSockets = [];
    window.WebSocket = class {
      constructor() { brokerSockets.push(this); this.closed = false; }
      send() {}
      close() { this.closed = true; this.onclose?.(); }
    };
    window.oldBrokerPromise = ARCADE.NET.mqtt.connect();
  });
  await page.clock.runFor(1);
  await page.evaluate(() => { ARCADE.NET.mqtt.close(); window.currentBrokerPromise = ARCADE.NET.mqtt.connect(); });
  await page.clock.runFor(1);
  const first = await page.evaluate(async () => {
    const m = ARCADE.NET.mqtt, old = brokerSockets[0], current = brokerSockets[1];
    old.onmessage({ data: new Uint8Array([0x20, 2, 0, 0]).buffer });
    current.onopen(); current.onmessage({ data: new Uint8Array([0x20, 2, 0, 0]).buffer });
    await Promise.all([oldBrokerPromise, currentBrokerPromise]);
    window.oldBrokerClose = current.onclose;
    return { ready: m.ready, current: m.ws === current, oldClosed: old.closed };
  });
  expect(first).toEqual({ ready: true, current: true, oldClosed: true });
  await page.evaluate(() => { ARCADE.NET.mqtt.close(); window.nextBrokerPromise = ARCADE.NET.mqtt.connect(); });
  await page.clock.runFor(1);
  await page.evaluate(async () => {
    const current = brokerSockets[2]; current.onopen(); current.onmessage({ data: new Uint8Array([0x20, 2, 0, 0]).buffer });
    await nextBrokerPromise; oldBrokerClose();
  });
  await page.clock.runFor(6000);
  expect(await page.evaluate(() => ({ ready: ARCADE.NET.mqtt.ready, current: ARCADE.NET.mqtt.ws === brokerSockets[2], sockets: brokerSockets.length })))
    .toEqual({ ready: true, current: true, sockets: 3 });
  await page.evaluate(() => ARCADE.NET.mqtt.close());
});

test('one broker failure is counted once while other connection attempts continue', async ({ page }) => {
  await page.clock.install();
  await page.evaluate(() => {
    window.brokerSockets = [];
    window.WebSocket = class { constructor() { brokerSockets.push(this); } send() {} close() {} };
    window.brokerOutcome = 'pending';
    ARCADE.NET.mqtt.connect().then(() => { brokerOutcome = 'connected'; }, () => { brokerOutcome = 'unreachable'; });
  });
  await page.clock.runFor(2500);
  await page.evaluate(() => { brokerSockets[0].onerror(); brokerSockets[0].onerror(); brokerSockets[0].onerror(); });
  expect(await page.evaluate(() => brokerOutcome)).toBe('pending');
  await page.evaluate(() => { brokerSockets[1].onerror(); brokerSockets[2].onerror(); });
  expect(await page.evaluate(() => brokerOutcome)).toBe('unreachable');
  expect(await page.evaluate(() => ARCADE.NET.mqtt._connecting)).toBeNull();
});
