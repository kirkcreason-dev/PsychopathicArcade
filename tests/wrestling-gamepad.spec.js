import { test, expect } from '@playwright/test';

const cabinets = [
  { screen: 'rumble', module: 'RUMBLE', prefix: 'ru' },
  { screen: 'ladder', module: 'LADDER', prefix: 'lw' },
];
let errors;
test.beforeEach(() => { errors = []; });
test.afterEach(() => expect(errors).toEqual([]));

async function open(page, cabinet, baseURL = '') {
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const device = {
      id: 'Test standard controller', index: 0, connected: true, mapping: 'standard',
      axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
      timestamp: 1,
    };
    window.padTest = {
      device, available: true, fail: false,
      set({ axes, buttons, connected, mapping } = {}) {
        if (axes) device.axes = [...axes, 0, 0].slice(0, 4);
        if (buttons) device.buttons = device.buttons.map((_, index) => ({
          pressed: buttons.includes(index), touched: buttons.includes(index), value: buttons.includes(index) ? 1 : 0,
        }));
        if (connected !== undefined) device.connected = connected;
        if (mapping !== undefined) device.mapping = mapping;
        device.timestamp++;
      },
    };
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value() {
        if (padTest.fail) throw new DOMException('Gamepad access denied', 'SecurityError');
        return padTest.available && device.connected ? [device] : [];
      },
    });
  });
  await page.goto(baseURL + '/game.html');
  await page.waitForFunction(() => window.ARCADE);
  await page.evaluate(screen => { ARCADE.Sound.on = false; ARCADE.showScreen(screen); }, cabinet.screen);
  await frames(page);
}

async function frames(page, count = 6) {
  await page.evaluate(async count => {
    for (let i = 0; i < count; i++) await new Promise(resolve => requestAnimationFrame(resolve));
  }, count);
}

async function pad(page, value) {
  await page.evaluate(value => padTest.set(value), value);
  await frames(page);
}

async function tap(page, button) {
  await pad(page, { buttons: [button] });
  await pad(page, { buttons: [] });
}

async function prepare(page, cabinet) {
  await page.locator('#' + cabinet.prefix + 'StartBtn').click();
  await page.waitForFunction(module => ARCADE[module].state.mode === 'playing', cabinet.module);
  await page.evaluate(({ module, screen }) => {
    const game = ARCADE[module], state = game.state, player = game.player();
    const rival = state.fighters.find(f => !f.player);
    state.countdown = 0;
    state.nextIn = 999;
    state.fighters = [player, rival];
    const y = screen === 'ladder' ? 365 : 265;
    Object.assign(player, { x: 220, y, invuln: 0, action: null, cool: 0, stun: 0, guardOn: false });
    // A landed hit replaces stun. Use neutral human input so AI cannot move or
    // guard midway through an assertion about the controller's fresh presses.
    Object.assign(rival, { x: 370, y, human: true, invuln: 0, action: null, cool: 0, stun: 999, guardOn: false });
  }, cabinet);
  await frames(page);
}

async function pose(page, cabinet) {
  return page.evaluate(module => {
    const p = ARCADE[module].player();
    return { x: p.x, y: p.y, guard: p.guardOn, action: p.action?.kind || null };
  }, cabinet.module);
}

for (const cabinet of cabinets) {
  const { screen, module, prefix } = cabinet;

  test(screen + ': shoulders select once and South starts without a queued strike', async ({ page }) => {
    await open(page, cabinet);
    const selected = await page.locator('#' + prefix + 'Roster').inputValue();
    await pad(page, { buttons: [5] });
    const next = await page.locator('#' + prefix + 'Roster').inputValue();
    expect(next).not.toBe(selected);
    await frames(page, 15);
    await expect(page.locator('#' + prefix + 'Roster')).toHaveValue(next);
    await pad(page, { buttons: [] });
    await tap(page, 4);
    await expect(page.locator('#' + prefix + 'Roster')).toHaveValue(selected);
    await pad(page, { buttons: [0] });
    await page.waitForFunction(module => ARCADE[module].state.mode === 'playing', module);
    await frames(page, 15);
    expect(await page.evaluate(module => ({ id: ARCADE[module].player().id, action: ARCADE[module].player().action, score: ARCADE[module].state.score }), module))
      .toEqual({ id: selected, action: null, score: 0 });
    await pad(page, { buttons: [] });
  });

  test(screen + ': stick dead zone, D-pad precedence, keyboard and touch coexist', async ({ page }) => {
    await open(page, cabinet); await prepare(page, cabinet);
    const initial = await pose(page, cabinet);
    await pad(page, { axes: [.1, -.1] });
    await frames(page, 12);
    expect(await pose(page, cabinet)).toEqual(initial);
    await pad(page, { axes: [.55, 0] });
    await expect.poll(async () => (await pose(page, cabinet)).x).toBeGreaterThan(initial.x + 2);
    const moved = await pose(page, cabinet);
    await pad(page, { axes: [1, 0], buttons: [14] });
    await expect.poll(async () => (await pose(page, cabinet)).x).toBeLessThan(moved.x - 2);
    await pad(page, { axes: [0, 0], buttons: [] });
    await page.locator('#' + prefix + 'Canvas').focus();
    await page.keyboard.down('ArrowRight');
    const keyStart = await pose(page, cabinet);
    await expect.poll(async () => (await pose(page, cabinet)).x).toBeGreaterThan(keyStart.x + 2);
    await pad(page, { buttons: [1] });
    await expect.poll(async () => (await pose(page, cabinet)).guard).toBe(true);
    await page.keyboard.up('ArrowRight');
    const guarded = await pose(page, cabinet);
    await frames(page);
    expect((await pose(page, cabinet)).x).toBeCloseTo(guarded.x, 4);
    await pad(page, { buttons: [] });
    const stick = await page.locator('#' + prefix + 'Stick').boundingBox();
    await page.mouse.move(stick.x + stick.width - 8, stick.y + stick.height / 2);
    await page.mouse.down();
    const touchStart = await pose(page, cabinet);
    await expect.poll(async () => (await pose(page, cabinet)).x).toBeGreaterThan(touchStart.x + 2);
    await pad(page, { buttons: [5] });
    await expect.poll(async () => (await pose(page, cabinet)).guard).toBe(true);
    await page.mouse.up();
    const touchEnd = await pose(page, cabinet);
    await frames(page);
    expect((await pose(page, cabinet)).x).toBeCloseTo(touchEnd.x, 4);
    expect((await pose(page, cabinet)).guard).toBe(true);
    await pad(page, { buttons: [] });
    await expect.poll(async () => (await pose(page, cabinet)).guard).toBe(false);
  });

  test(screen + ': South and North are edge triggered and both guard buttons hold', async ({ page }) => {
    await open(page, cabinet); await prepare(page, cabinet);
    await page.evaluate(module => {
      const game = ARCADE[module], p = game.player(), rival = game.state.fighters[1];
      rival.x = p.x + 40;
    }, module);
    await pad(page, { buttons: [0] });
    await expect.poll(() => page.evaluate(module => ARCADE[module].state.score, module)).toBe(25);
    await page.waitForTimeout(1000);
    expect(await page.evaluate(module => ARCADE[module].state.score, module)).toBe(25);
    await pad(page, { buttons: [] });
    await pad(page, { buttons: [0] });
    await expect.poll(() => page.evaluate(module => ARCADE[module].state.score, module)).toBe(50);
    await pad(page, { buttons: [] });
    await page.waitForFunction(module => !ARCADE[module].player().action && ARCADE[module].player().cool === 0, module);
    await page.evaluate(module => { ARCADE[module].state.charge = 100; }, module);
    await pad(page, { buttons: [3] });
    await expect.poll(() => page.evaluate(module => ARCADE[module].state.charge, module)).toBeLessThan(100);
    await page.waitForFunction(module => !ARCADE[module].player().action && ARCADE[module].player().cool === 0, module);
    await page.evaluate(module => { ARCADE[module].state.charge = 100; }, module);
    await frames(page, 15);
    expect(await page.evaluate(module => ARCADE[module].state.charge, module)).toBe(100);
    await pad(page, { buttons: [1, 5] });
    await expect.poll(async () => (await pose(page, cabinet)).guard).toBe(true);
    await pad(page, { buttons: [5] });
    expect((await pose(page, cabinet)).guard).toBe(true);
    await pad(page, { buttons: [] });
    await expect.poll(async () => (await pose(page, cabinet)).guard).toBe(false);
  });

  test(screen + ': West performs the game action once per press', async ({ page }) => {
    await open(page, cabinet); await prepare(page, cabinet);
    await page.evaluate(({ module, screen }) => {
      const game = ARCADE[module], p = game.player();
      if (screen === 'rumble') game.state.fighters[1].x = p.x + 40;
      else Object.assign(game.state.ladder, { x: p.x, y: p.y, carrier: null, open: false });
    }, cabinet);
    await pad(page, { buttons: [2] });
    if (screen === 'rumble') {
      await expect.poll(() => page.evaluate(module => ARCADE[module].state.fighters[1].hp, module)).toBeLessThan(100);
      await page.waitForTimeout(900);
      expect(await page.evaluate(module => ARCADE[module].state.fighters[1].hp, module)).toBe(88);
    } else {
      await expect.poll(() => page.evaluate(module => ARCADE[module].state.ladder.carrier, module))
        .toBe(await page.evaluate(module => ARCADE[module].player().uid, module));
      await page.waitForTimeout(600);
      expect(await page.evaluate(module => ARCADE[module].state.ladder.open, module)).toBe(false);
      await pad(page, { buttons: [] });
      await tap(page, 2);
      await expect.poll(() => page.evaluate(module => ARCADE[module].state.ladder.open, module)).toBe(true);
      await page.waitForFunction(module => ARCADE[module].player().cool === 0, module);
      await tap(page, 2);
      await page.waitForFunction(module => ARCADE[module].player().climb > .08, module);
      const height = await page.evaluate(module => ARCADE[module].player().climb, module);
      await pad(page, { buttons: [13] });
      await expect.poll(() => page.evaluate(module => ARCADE[module].player().climb, module)).toBeLessThan(height);
    }
    await pad(page, { buttons: [] });
  });

  test(screen + ': pause and reconnect require neutral controls and disconnect stops movement', async ({ page }) => {
    await open(page, cabinet); await prepare(page, cabinet);
    await pad(page, { buttons: [9] });
    await page.waitForFunction(module => ARCADE[module].state.mode === 'paused', module);
    await frames(page, 12);
    expect(await page.evaluate(module => ARCADE[module].state.mode, module)).toBe('paused');
    await pad(page, { buttons: [] });
    await pad(page, { axes: [1, 0], buttons: [0, 9] });
    await page.waitForFunction(module => ARCADE[module].state.mode === 'playing', module);
    const resumed = await pose(page, cabinet);
    await frames(page, 15);
    expect(await pose(page, cabinet)).toEqual(resumed);
    expect(resumed.action).toBeNull();
    await pad(page, { axes: [0, 0], buttons: [] });
    await pad(page, { axes: [-1, 0] });
    await expect.poll(async () => (await pose(page, cabinet)).x).toBeLessThan(resumed.x - 2);
    await pad(page, { connected: false });
    await page.waitForFunction(module => ARCADE[module].state.mode === 'paused', module);
    const disconnected = await pose(page, cabinet);
    await frames(page, 12);
    expect(await pose(page, cabinet)).toEqual(disconnected);
    await pad(page, { connected: true, axes: [-1, 0], buttons: [0, 9] });
    await frames(page, 12);
    expect(await page.evaluate(module => ARCADE[module].state.mode, module)).toBe('paused');
    await pad(page, { axes: [0, 0], buttons: [] });
    await tap(page, 9);
    await page.waitForFunction(module => ARCADE[module].state.mode === 'playing', module);
    const reconnected = await pose(page, cabinet);
    await frames(page, 8);
    expect(await pose(page, cabinet)).toEqual(reconnected);
  });
}

test('only the selected cabinet reads actions and an open records modal blocks Start', async ({ page }) => {
  await open(page, cabinets[0]);
  await page.evaluate(() => ARCADE.showScreen('menu'));
  await pad(page, { buttons: [0] });
  expect(await page.evaluate(() => [ARCADE.RUMBLE.state.mode, ARCADE.LADDER.state.mode])).toEqual(['ready', 'ready']);
  await page.evaluate(() => ARCADE.showScreen('rumble'));
  await frames(page);
  expect(await page.evaluate(() => ARCADE.RUMBLE.state.mode)).toBe('ready');
  await pad(page, { buttons: [] }); await tap(page, 0);
  await page.waitForFunction(() => ARCADE.RUMBLE.state.mode === 'playing');
  await page.evaluate(() => ARCADE.showScreen('ladder'));
  const rumble = await page.evaluate(() => JSON.stringify(ARCADE.RUMBLE.state));
  await frames(page); await tap(page, 0);
  await page.waitForFunction(() => ARCADE.LADDER.state.mode === 'playing');
  expect(await page.evaluate(() => JSON.stringify(ARCADE.RUMBLE.state))).toBe(rumble);
  await page.locator('#lwScreen .lb-mini').click();
  await expect(page.locator('#lbModal')).toBeVisible();
  await tap(page, 9);
  expect(await page.evaluate(() => ARCADE.LADDER.state.mode)).toBe('paused');
  await page.locator('#lbClose').click();
  await tap(page, 9);
  await page.waitForFunction(() => ARCADE.LADDER.state.mode === 'playing');
});

test('unmapped devices and denied controller access give guidance while keyboard input works', async ({ page }) => {
  await open(page, cabinets[0]); await prepare(page, cabinets[0]);
  await pad(page, { mapping: '', axes: [1, 0], buttons: [0] });
  await expect(page.locator('#ruGamepadStatus')).toContainText(/standard|mapping|supported/i);
  await page.locator('#ruResumeBtn').click();
  const initial = await pose(page, cabinets[0]);
  await frames(page);
  expect(await pose(page, cabinets[0])).toEqual(initial);
  await page.locator('#ruCanvas').focus(); await page.keyboard.down('ArrowLeft');
  await expect.poll(async () => (await pose(page, cabinets[0])).x).toBeLessThan(initial.x - 2);
  await page.keyboard.up('ArrowLeft');
  await page.evaluate(() => { padTest.fail = true; });
  await frames(page);
  await expect(page.locator('#ruGamepadStatus')).toContainText(/unavailable|blocked|permission|access/i);
  await page.evaluate(() => { padTest.fail = false; Object.defineProperty(navigator, 'getGamepads', { value: undefined }); });
  await frames(page);
  await expect(page.locator('#ruGamepadStatus')).toContainText(/unavailable|supported|browser/i);
});

for (const cabinet of cabinets) {
  test(cabinet.screen + ': a real online guest sends controller movement, actions, guard and pause', async ({ browser, browserName, baseURL }) => {
    test.skip(browserName === 'webkit' && !process.env.ARCADE_NETWORK_TESTS, 'Local WebKit peer tests require the optional public-STUN run.');
    const host = await browser.newPage(), guest = await browser.newPage();
    try {
      for (const page of [host, guest]) {
        await open(page, cabinet, baseURL);
        await page.evaluate(() => {
          const RTC = window.RTCPeerConnection;
          window.RTCPeerConnection = class extends RTC { constructor() { super({ iceServers: [] }); } };
        });
      }
      const offer = await host.evaluate(async screen => { ARCADE.NET.state.game = screen; return ARCADE.NET.hostCreate(); }, cabinet.screen);
      const answer = await guest.evaluate(offer => ARCADE.NET.joinAccept(offer), offer);
      await host.evaluate(answer => ARCADE.NET.hostConnect(answer), answer);
      for (const page of [host, guest]) await page.waitForFunction(() => ARCADE.NET.state.session);
      await frames(host); await frames(guest);
      await tap(host, 0); await tap(guest, 0);
      for (const page of [host, guest]) await page.waitForFunction(module => ARCADE[module].state.mode === 'playing' && ARCADE[module].state.countdown === 0, cabinet.module);
      await pad(guest, { axes: [-1, 0] });
      await host.waitForFunction(module => ARCADE[module].state.fighters[1].x < 280, cabinet.module);
      await pad(guest, { axes: [0, 0] });
      await host.evaluate(({ module, screen }) => {
        const state = ARCADE[module].state;
        const y = screen === 'ladder' ? 365 : 265;
        state.fighters.forEach((f, i) => Object.assign(f, { x: 220 + 40 * i, y, invuln: 0, action: null, cool: 0, stun: 0, guardOn: false }));
      }, cabinet);
      await pad(guest, { buttons: [0] });
      await expect.poll(() => host.evaluate(module => ARCADE[module].state.fighters[1].score, cabinet.module)).toBe(25);
      await guest.waitForTimeout(900);
      expect(await host.evaluate(module => ARCADE[module].state.fighters[1].score, cabinet.module)).toBe(25);
      await pad(guest, { buttons: [1] });
      await host.waitForFunction(module => ARCADE[module].state.fighters[1].guardOn, cabinet.module);
      await pad(guest, { buttons: [] });
      await host.waitForFunction(module => !ARCADE[module].state.fighters[1].guardOn, cabinet.module);
      await host.evaluate(({ module, screen }) => {
        const game = ARCADE[module], [hostPlayer, guestPlayer] = game.state.fighters;
        Object.assign(hostPlayer, { x: 220, invuln: 0, action: null, stun: 0, cool: 0 });
        Object.assign(guestPlayer, { x: 260, invuln: 0, action: null, stun: 0, cool: 0 });
        if (screen === 'ladder') Object.assign(game.state.ladder, { x: guestPlayer.x, y: guestPlayer.y, open: false, carrier: null });
      }, cabinet);
      const hostHealth = await host.evaluate(module => ARCADE[module].state.fighters[0].hp, cabinet.module);
      await tap(guest, 2);
      if (cabinet.screen === 'ladder') {
        await host.waitForFunction(module => ARCADE[module].state.ladder.carrier === 'p2', cabinet.module);
        await guest.waitForFunction(module => ARCADE[module].state.ladder.carrier === 'p2', cabinet.module);
      } else {
        await expect.poll(() => host.evaluate(module => ARCADE[module].state.fighters[0].hp, cabinet.module)).toBeLessThan(hostHealth);
      }
      await tap(guest, 9);
      for (const page of [host, guest]) await page.waitForFunction(module => ARCADE[module].state.mode === 'paused', cabinet.module);
      const still = await host.evaluate(module => ARCADE[module].state.fighters.map(f => [f.x, f.y]), cabinet.module);
      await frames(host, 10);
      expect(await host.evaluate(module => ARCADE[module].state.fighters.map(f => [f.x, f.y]), cabinet.module)).toEqual(still);
      await tap(guest, 9);
      for (const page of [host, guest]) await page.waitForFunction(module => ARCADE[module].state.mode === 'playing', cabinet.module);
      await pad(guest, { connected: false });
      for (const page of [host, guest]) await page.waitForFunction(module => ARCADE[module].state.mode === 'paused', cabinet.module);
    } finally {
      await host.close(); await guest.close();
    }
  });
}
