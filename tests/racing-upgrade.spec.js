import { test, expect } from '@playwright/test';

// A local date behind UTC catches accidental locale-based daily rotation.
test.use({ timezoneId: 'America/Los_Angeles' });
let errors;
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.setFixedTime(new Date('2026-11-08T00:15:00Z'));
  await openRacing(page);
});
test.afterEach(() => expect(errors).toEqual([]));

async function openRacing(page) {
  await page.goto('/game.html');
  await page.waitForFunction(() => window.RACING_READY);
  await page.evaluate(async () => { ARCADE.Sound.on = false; ARCADE.showScreen('racing'); await ARCADE.RACING.loadAssets(); });
}
async function dailyStart(page) {
  await page.locator('#rcDailyBtn').click();
  await expect(page.locator('#rcDailyBtn')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#rcStartBtn').click();
}
function route(page) {
  return page.evaluate(() => {
    const s = ARCADE.RACING.state;
    return { seed: s.seed, day: s.raceDay, mode: s.runMode, objects: s.objects.map(o => ({ id: o.id, kind: o.kind, x: o.x, z: o.z })) };
  });
}
function finish(page, dnf = false) {
  return page.evaluate(dnf => {
    const g = ARCADE.RACING;
    for (let i = 0; i < 850 && g.state.phase !== 'finished'; i++) {
      const s = g.state;
      g.debug.advance(.25, dnf ? { steer: 0, brake: true, boost: false } : RACING_RULES.aiInput(s, 0));
    }
    const s = g.state;
    if (s.phase !== 'finished') throw new Error('Race did not reach a result.');
    return { state: s, score: RACING_RULES.score(s, 0), won: RACING_RULES.standings(s)[0].id === 0 };
  }, dnf);
}
function dailyRecords(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('pa_racing_dailyRecords') || '{}'));
}

test('Daily Route is stable across restarts and reloads, then rotates at the UTC day boundary', async ({ page }) => {
  await dailyStart(page);
  const first = await route(page);
  expect(first.mode).toBe('daily'); expect(first.day).toBe('2026-11-08');
  await page.evaluate(() => ARCADE.RACING.start());
  expect(await route(page)).toEqual(first);
  await openRacing(page); await dailyStart(page);
  expect(await route(page)).toEqual(first);
  await page.clock.setFixedTime(new Date('2026-11-09T00:15:00Z'));
  await page.evaluate(() => ARCADE.RACING.start());
  const next = await route(page);
  expect(next.day).toBe('2026-11-09'); expect(next.seed).not.toBe(first.seed); expect(next.objects).not.toEqual(first.objects);
});

test('daily records persist separately from convoy scores and preserve the best run', async ({ page }) => {
  await page.evaluate(() => { localStorage.setItem('pa_racing_best', '7777'); localStorage.setItem('pa_racing_wins', '3'); });
  await openRacing(page); await dailyStart(page);
  const first = await finish(page);
  expect(first.state.racers[0].dnf).toBe(false);
  expect(first.state.best).toBe(7777); expect(first.state.wins).toBe(3);
  expect(first.state.dailyBest).toMatchObject({ score: first.score, time: first.state.racers[0].finishTime, racer: first.state.racers[0].racerId, runs: 1, wins: first.won ? 1 : 0 });
  await expect(page.locator('#rcSaveBtn')).toBeHidden();
  const storedFirst = (await dailyRecords(page))['2026-11-08'];
  expect(storedFirst).toEqual(first.state.dailyBest);
  await page.locator('#rcChangeBtn').click();
  await page.locator('[data-racing-racer="big-foot"]').click();
  await page.locator('#rcStartBtn').click();
  const second = await finish(page);
  expect(second.state.racers[0].racerId).not.toBe(first.state.racers[0].racerId);
  const storedSecond = (await dailyRecords(page))['2026-11-08'];
  expect(storedSecond.score).toBe(Math.max(first.score, second.score));
  expect(storedSecond.runs).toBe(2); expect(storedSecond.wins).toBe((first.won ? 1 : 0) + (second.won ? 1 : 0));
  const bestRun = second.score > first.score || second.score === first.score && second.state.racers[0].finishTime < first.state.racers[0].finishTime ? second : first;
  expect(storedSecond.time).toBe(bestRun.state.racers[0].finishTime); expect(storedSecond.racer).toBe(bestRun.state.racers[0].racerId);
  await openRacing(page); await page.locator('#rcDailyBtn').click();
  expect(await page.evaluate(() => ARCADE.RACING.state.dailyBest)).toEqual(storedSecond);
  await page.locator('#rcConvoyBtn').click();
  await expect(page.locator('#rcConvoyBtn')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => ({ mode: ARCADE.RACING.state.runMode, best: ARCADE.RACING.state.best, wins: ARCADE.RACING.state.wins }))).toEqual({ mode: 'convoy', best: 7777, wins: 3 });
});

test('a daily timeout or abandoned run cannot add a daily completion or win', async ({ page }) => {
  await dailyStart(page);
  const failed = await finish(page, true);
  expect(failed.state.racers[0].dnf).toBe(true); expect(failed.state.dailyBest).toBeNull();
  expect((await dailyRecords(page))['2026-11-08']).toBeUndefined();
  expect([failed.state.best, failed.state.wins]).toEqual([0, 0]);
  await page.locator('#rcAgainBtn').click();
  await page.evaluate(() => {
    for (let i = 0; i < 25; i++) ARCADE.RACING.debug.advance(.25, { steer: 0, brake: false, boost: false });
    ARCADE.showScreen('menu');
  });
  expect((await dailyRecords(page))['2026-11-08']).toBeUndefined();
  await openRacing(page);
  expect(await page.evaluate(() => ARCADE.RACING.state.dailyBest)).toBeNull();
});

test('a daily race crossing midnight is credited to its start day', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-08T23:59:50Z'));
  await dailyStart(page);
  const initial = await route(page);
  await page.clock.setFixedTime(new Date('2026-11-09T00:01:00Z'));
  const completed = await finish(page);
  expect(completed.state.racers[0].dnf).toBe(false);
  expect(completed.state.raceDay).toBe('2026-11-08'); expect(completed.state.dailyDate).toBe('2026-11-08');
  const records = await dailyRecords(page);
  expect(records['2026-11-08'].score).toBe(completed.score); expect(records['2026-11-09']).toBeUndefined();
  await page.locator('#rcAgainBtn').click();
  const next = await route(page);
  expect(next.day).toBe('2026-11-09'); expect(next.seed).not.toBe(initial.seed);
  expect(await page.evaluate(() => ARCADE.RACING.state.dailyBest)).toBeNull();
});

test('braking into a turn charges the drift meter and releasing awards the advertised turbo', async ({ page }) => {
  await page.locator('#rcStartBtn').click();
  await page.evaluate(() => {
    for (let i = 0; i < 13; i++) ARCADE.RACING.debug.advance(.25, { steer: 0, brake: false, boost: false });
    for (let i = 0; i < 50; i++) ARCADE.RACING.debug.advance(.05, { steer: 0, brake: false, boost: false });
    for (const [key, code] of [['ArrowRight', 'ArrowRight'], ['ArrowDown', 'ArrowDown']]) document.body.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true }));
    for (let i = 0; i < 15; i++) ARCADE.RACING.debug.advance(.05);
    // UI assertions must not keep charging toward tier II on slower CI browsers.
    ARCADE.RACING.pause(true);
  });
  const charging = await page.evaluate(() => ARCADE.RACING.state.racers[0]);
  expect(charging.drifting).toBe(true); expect(charging.driftDirection).toBe(1); expect(charging.driftCharge).toBeGreaterThanOrEqual(.65);
  await expect(page.locator('#rcDriftMeter')).toBeVisible();
  await expect.poll(() => page.locator('#rcDriftMeter').evaluate(el => el.value)).toBeGreaterThan(0);
  await expect(page.locator('#rcDriftLabel')).toContainText(/drift|release|turbo/i);
  const released = await page.evaluate(() => {
    ARCADE.RACING.pause(false);
    for (const [key, code] of [['ArrowRight', 'ArrowRight'], ['ArrowDown', 'ArrowDown']]) document.body.dispatchEvent(new KeyboardEvent('keyup', { key, code, bubbles: true }));
    ARCADE.RACING.debug.advance(.05);
    const s = ARCADE.RACING.state;
    // Freeze after the award so a later roadside pickup cannot replace its UI message.
    ARCADE.RACING.pause(true);
    return { racer: s.racers[0], event: s.events.findLast(e => e.type === 'drift' && e.racer === 0) };
  });
  expect(released.racer.drifting).toBe(false); expect(released.racer.driftCharge).toBe(0); expect(released.racer.driftTurbo).toBeGreaterThan(0);
  expect(released.racer.drifts).toBe(charging.drifts + 1);
  expect(released.event).toMatchObject({ type: 'drift', tier: 1, racer: 0 });
  expect(released.event.amount).toBeGreaterThanOrEqual(0); expect(released.event.amount).toBeLessThanOrEqual(12);
  await expect(page.locator('#rcFeedback')).toContainText(/drift|turbo/i);
});

test('race music starts on a user gesture and follows pause, track selection, mute and exit', async ({ page }) => {
  const music = () => page.evaluate(() => ARCADE.RACING.state.music);
  expect(await music()).toMatchObject({ track: 'theme', playing: false, loaded: false, currentTime: 0 });
  await expect(page.locator('#rcMusicSelect')).toHaveValue('theme');
  await page.evaluate(() => { ARCADE.Sound.on = true; });
  await page.locator('#rcStartBtn').click();
  await expect.poll(async () => (await music()).playing, { timeout: 10000 }).toBe(true);
  await expect.poll(async () => (await music()).currentTime, { timeout: 10000 }).toBeGreaterThan(0);
  expect(await music()).toMatchObject({ track: 'theme', loaded: true, blocked: false });
  await page.locator('#rcPauseBtn').click();
  await expect.poll(async () => (await music()).playing).toBe(false);
  const pausedAt = (await music()).currentTime;
  await page.waitForTimeout(200);
  expect(Math.abs((await music()).currentTime - pausedAt)).toBeLessThan(.05);
  await expect(page.locator('#rcPauseMusicSelect')).toHaveValue('theme');
  await page.locator('#rcPauseMusicSelect').selectOption('fight-club');
  expect(await music()).toMatchObject({ track: 'fight-club', playing: false });
  await page.waitForTimeout(100);
  expect((await music()).playing).toBe(false);
  await page.locator('#rcResumeBtn').click();
  await expect.poll(async () => (await music()).playing, { timeout: 10000 }).toBe(true);
  await expect.poll(async () => (await music()).currentTime, { timeout: 10000 }).toBeGreaterThan(0);
  await page.locator('#rcSoundBtn').click();
  expect(await page.evaluate(() => ARCADE.Sound.on)).toBe(false);
  expect((await music()).playing).toBe(false);
  await page.locator('#rcSoundBtn').click();
  await expect.poll(async () => (await music()).playing, { timeout: 10000 }).toBe(true);
  await page.locator('#rcHomeBtn').click();
  expect((await music()).playing).toBe(false);
  const stoppedAt = (await music()).currentTime;
  await page.waitForTimeout(150);
  expect(Math.abs((await music()).currentTime - stoppedAt)).toBeLessThan(.05);
  // A ready host can hear music while awaiting a friend. Backgrounding that
  // lobby must stop synchronously, without waiting for a suspended RAF loop.
  await page.evaluate(() => { ARCADE.showScreen('racing'); ARCADE.RACING.netStart('host'); });
  await page.locator('#rcStartBtn').click();
  await expect.poll(async () => (await music()).playing, { timeout: 10000 }).toBe(true);
  expect(await page.evaluate(() => ARCADE.RACING.state.started)).toBe(false);
  expect(await page.evaluate(() => { window.dispatchEvent(new Event('blur')); return ARCADE.RACING.state.music.playing; })).toBe(false);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(async () => (await music()).playing).toBe(true);
  expect(await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    return ARCADE.RACING.state.music.playing;
  })).toBe(false);
  await page.evaluate(() => { delete document.hidden; ARCADE.RACING.netEnd('Test complete.'); });
});

test('manual turbo shows its three-second countdown, freezes on pause and needs a fresh press after expiry', async ({ page }) => {
  const fired = await page.evaluate(() => {
    const g = ARCADE.RACING;
    g.start();
    for (let i = 0; i < 13; i++) g.debug.advance(.25, { steer: 0, brake: false, boost: false });
    const charge = g.state.racers[0].boost;
    document.getElementById('rcBoostBtn').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
    document.getElementById('rcBoostBtn').dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true }));
    // A complete tap between frames must still fire exactly one burst.
    g.debug.advance(.05);
    g.pause(true);
    return { charge, racer: g.state.racers[0] };
  });
  expect(fired.racer.boosting).toBe(true);
  expect(fired.racer.boostTime).toBeCloseTo(2.95, 5);
  expect(fired.racer.boost).toBeCloseTo(fired.charge - 30, 5);
  await expect(page.locator('#rcBoost')).toHaveText('+25% 3.0s');
  await expect(page.locator('#rcBoostBtnLabel')).toHaveText('TURBO 3.0s');
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => ARCADE.RACING.state.racers[0].boostTime)).toBe(fired.racer.boostTime);

  const retried = await page.evaluate(() => {
    const g = ARCADE.RACING;
    g.pause(false);
    for (let i = 0; i < 4; i++) g.debug.advance(.25);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', code: 'ShiftLeft', bubbles: true }));
    g.debug.advance(.05);
    const during = g.state.racers[0];
    // Keep the key down beyond expiry: it must not buy another burst.
    for (let i = 0; i < 8; i++) g.debug.advance(.25);
    const expired = g.state.racers[0];
    document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', code: 'ShiftLeft', bubbles: true }));
    g.debug.advance(.025);
    const beforeFresh = g.state.racers[0].boost;
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', code: 'ShiftLeft', bubbles: true }));
    g.debug.advance(.025);
    const fresh = g.state.racers[0];
    document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', code: 'ShiftLeft', bubbles: true }));
    g.pause(true);
    return { during, expired, beforeFresh, fresh };
  });
  expect(retried.during.boostTime).toBeCloseTo(1.9, 5);
  expect(retried.during.boost).toBe(fired.racer.boost);
  expect(retried.expired.boosting).toBe(false); expect(retried.expired.boostTime).toBe(0);
  expect(retried.expired.boostHeld).toBe(true);
  expect(retried.fresh.boosting).toBe(true); expect(retried.fresh.boostTime).toBeCloseTo(2.975, 5);
  expect(retried.fresh.boost).toBeCloseTo(retried.beforeFresh - 30, 5);
});

test('legacy friend snapshots accept authoritative turbo and reject malformed burst state', async ({ page }) => {
  const outcome = await page.evaluate(() => {
    const g = ARCADE.RACING, rules = RACING_RULES;
    const s = rules.create({ seed: 71, online: true, playerRacer: 'violent-j', guestRacer: 'mad-man-pondo' });
    const neutral = { steer: 0, brake: false, boost: false };
    for (let i = 0; i < 13; i++) rules.update(s, .25, [neutral, neutral]);
    rules.update(s, .05, [neutral, { ...neutral, boost: true }]);
    g.netStart('join');
    const { objects, ...wire } = s;
    wire.collected = objects.filter(o => o.collectedBy.length).map(o => [o.id, ...o.collectedBy]);
    const packet = { v: 1, k: 'snapshot', round: 1, epoch: 0, barrier: 0, seq: 1, ack: 0, started: true, paused: false, ready: [false, false], choices: ['violent-j', 'mad-man-pondo'], state: wire };
    g.netApply(packet);
    const accepted = g.state.racers[1].boostTime;
    const bad = [{ boostTime: 3.1 }, { boostTime: -1 }, { boostHeld: 1 }, { boosting: false }, { drifting: true, driftDirection: 1 }, { driftTurbo: .5 }];
    const rejected = bad.map(change => {
      const next = JSON.parse(JSON.stringify(packet)); next.seq = 2;
      Object.assign(next.state.racers[1], change);
      g.netApply(next);
      return g.netState().rx === 1 && g.state.racers[1].boostTime === accepted;
    });
    const countdown = rules.create({ online: true }); countdown.racers[1].boostHeld = true;
    const countdownRejected = g.debug.cleanState(countdown) === null;
    return { accepted, rejected, countdownRejected, seat: g.state.seat };
  });
  expect(outcome.accepted).toBeCloseTo(2.95, 5); expect(outcome.seat).toBe(1);
  expect(outcome.rejected).toEqual(Array(6).fill(true)); expect(outcome.countdownRejected).toBe(true);
  await expect(page.locator('#rcBoost')).toHaveText('+25% 3.0s');
  const quickGuest = await page.evaluate(() => {
    const g = ARCADE.RACING, controls = { steer: 0, brake: false, boost: false };
    g.netEnd('Previous fixture complete.'); g.netStart('host'); g.ready();
    const packet = { v: 1, k: 'input', round: 0, epoch: 0, seq: 1, choice: 'mad-man-pondo', ready: true, paused: false, loaded: true, controls };
    g.netApply(packet);
    for (let i = 0; i < 13; i++) g.debug.advance(.25, controls);
    const round = g.netState().round, charge = g.state.racers[1].boost;
    g.netApply({ ...packet, round, seq: 2, ready: false, controls: { ...controls, boost: true } });
    g.netApply({ ...packet, round, seq: 3, ready: false });
    const heldAfterRelease = g.netState().controls.boost;
    g.debug.advance(.05, controls);
    const racer = g.state.racers[1];
    g.netEnd('Test complete.');
    return { charge, heldAfterRelease, racer };
  });
  expect(quickGuest.heldAfterRelease).toBe(false);
  expect(quickGuest.racer.boostTime).toBeCloseTo(2.95, 5);
  expect(quickGuest.racer.boost).toBeCloseTo(quickGuest.charge - 30, 5);
});

test('the active turbo HUD and touch controls fit small portrait and landscape screens', async ({ page }, testInfo) => {
  for (const viewport of [{ width: 320, height: 568 }, { width: 667, height: 375 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => {
      const g = ARCADE.RACING;
      g.start();
      for (let i = 0; i < 13; i++) g.debug.advance(.25, { steer: 0, brake: false, boost: false });
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', code: 'ShiftLeft', bubbles: true }));
      g.debug.advance(.05);
      document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', code: 'ShiftLeft', bubbles: true }));
    });
    await expect(page.locator('#rcBoost')).toContainText('+25%');
    await expect(page.locator('#rcBoostBtn')).toHaveClass(/turbo-active/);
    const fit = await page.evaluate(() => ['rcBoost', 'rcBoostBtnLabel', 'rcLeftBtn', 'rcRightBtn', 'rcBrakeBtn', 'rcBoostBtn'].map(id => {
      const el = document.getElementById(id), b = el.getBoundingClientRect(), parent = el.parentElement.getBoundingClientRect();
      return { id, visible: b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight, fits: el.scrollWidth <= el.clientWidth && b.right <= parent.right + 1 };
    }));
    expect(fit.every(row => row.visible && row.fits), JSON.stringify(fit)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('turbo-' + viewport.width + '.png') });
  }
});
