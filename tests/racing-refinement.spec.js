import { test, expect } from '@playwright/test';

let errors;
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/game.html');
  await page.waitForFunction(() => window.RACING_READY);
  await page.evaluate(async () => { ARCADE.Sound.on = false; ARCADE.showScreen('racing'); await ARCADE.RACING.loadAssets(); });
});
test.afterEach(() => expect(errors).toEqual([]));

async function startRace(page) {
  await page.evaluate(() => {
    ARCADE.RACING.start();
    for (let i = 0; i < 13; i++) ARCADE.RACING.debug.advance(.25);
  });
  await page.waitForFunction(() => ARCADE.RACING.state.phase === 'racing');
}

function key(page, type, key, code) {
  return page.evaluate(({ type, key, code }) => {
    document.body.dispatchEvent(new KeyboardEvent(type, { key, code, bubbles: true }));
    return ARCADE.RACING.debug.controls();
  }, { type, key, code });
}

test('releasing one keyboard alias keeps another held steering or boost key active', async ({ page }) => {
  await startRace(page);
  await key(page, 'keydown', 'ArrowLeft', 'ArrowLeft');
  await key(page, 'keydown', 'a', 'KeyA');
  expect((await key(page, 'keyup', 'ArrowLeft', 'ArrowLeft')).steer).toBe(-1);
  expect((await key(page, 'keyup', 'A', 'KeyA')).steer).toBe(0);

  await key(page, 'keydown', 'Shift', 'ShiftLeft');
  await key(page, 'keydown', 'Shift', 'ShiftRight');
  expect((await key(page, 'keyup', 'Shift', 'ShiftLeft')).boost).toBe(true);
  expect((await key(page, 'keyup', 'Shift', 'ShiftRight')).boost).toBe(false);

  await key(page, 'keydown', ' ', 'Space');
  await key(page, 'keydown', 'Shift', 'ShiftLeft');
  expect((await key(page, 'keyup', ' ', 'Space')).boost).toBe(true);
  expect((await key(page, 'keyup', 'Shift', 'ShiftLeft')).boost).toBe(false);

  await key(page, 'keydown', 'a', 'KeyA');
  await key(page, 'keydown', 'd', 'KeyD');
  expect((await key(page, 'keydown', 'd', 'KeyD')).steer).toBe(0);
  expect((await key(page, 'keyup', 'd', 'KeyD')).steer).toBe(-1);
  expect((await key(page, 'keyup', 'a', 'KeyA')).steer).toBe(0);
});

test('keyboard and pointer inputs remain independent until each physical input releases', async ({ page }) => {
  await startRace(page);
  await key(page, 'keydown', 'ArrowRight', 'ArrowRight');
  await page.evaluate(() => {
    const button = document.getElementById('rcRightBtn');
    button.setPointerCapture = () => {};
    button.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 71, bubbles: true }));
  });
  expect((await key(page, 'keyup', 'ArrowRight', 'ArrowRight')).steer).toBe(1);
  await page.locator('#rcRightBtn').dispatchEvent('pointercancel', { pointerId: 71 });
  expect(await page.evaluate(() => ARCADE.RACING.debug.controls().steer)).toBe(0);
  await key(page, 'keydown', 'ArrowDown', 'ArrowDown');
  await key(page, 'keydown', 's', 'KeyS');
  expect((await key(page, 'keyup', 'ArrowDown', 'ArrowDown')).brake).toBe(true);
  await page.evaluate(() => ARCADE.RACING.pause(true));
  expect(await page.evaluate(() => ARCADE.RACING.debug.controls())).toEqual({ steer: 0, brake: false, boost: false });
});

test('idle ride selection avoids repeated roster mutations and still updates a new choice', async ({ page }) => {
  await page.evaluate(() => {
    window.racingRosterMutations = 0;
    window.racingRosterObserver = new MutationObserver(records => { racingRosterMutations += records.length; });
    racingRosterObserver.observe(document.getElementById('rcRoster'), { subtree: true, attributes: true, childList: true });
  });
  await page.waitForTimeout(320);
  expect(await page.evaluate(() => racingRosterMutations)).toBe(0);
  await page.evaluate(() => ARCADE.RACING.choose('mad-man-pondo'));
  await expect(page.locator('[data-racing-racer="mad-man-pondo"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-racing-racer="violent-j"]')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => racingRosterMutations)).toBeGreaterThan(0);
  await page.evaluate(() => racingRosterObserver.disconnect());
});

test('finished results keep stable placement rows instead of rebuilding them each frame', async ({ page }) => {
  await startRace(page);
  await page.evaluate(() => {
    for (let i = 0; i < 850 && ARCADE.RACING.state.phase !== 'finished'; i++) {
      const s = ARCADE.RACING.state;
      ARCADE.RACING.debug.advance(.25, RACING_RULES.aiInput(s, 0));
    }
    const list = document.getElementById('rcPlacements');
    window.racingFirstResultRow = list.firstElementChild;
    window.racingResultMutations = 0;
    window.racingResultsObserver = new MutationObserver(records => { racingResultMutations += records.length; });
    racingResultsObserver.observe(list, { childList: true, subtree: true, characterData: true });
  });
  await expect(page.locator('#rcResult')).toBeVisible();
  await expect(page.locator('#rcPlacements li')).toHaveCount(6);
  await page.waitForTimeout(320);
  expect(await page.evaluate(() => racingResultMutations)).toBe(0);
  expect(await page.evaluate(() => racingFirstResultRow === document.getElementById('rcPlacements').firstElementChild)).toBe(true);
  await page.evaluate(() => { racingResultsObserver.disconnect(); ARCADE.RACING.start(); });
  await expect(page.locator('#rcResult')).toBeHidden();
  expect(await page.evaluate(() => ARCADE.RACING.state.racers.every(r => r.finishTime === null))).toBe(true);
});

test('a guest who has crossed the line waits clearly and cannot keep driving with the keyboard', async ({ page }) => {
  const outcome = await page.evaluate(() => {
    const g = ARCADE.RACING, rules = RACING_RULES;
    const s = rules.create({ seed: 71, online: true, playerRacer: 'violent-j', guestRacer: 'mad-man-pondo' });
    for (let i = 0; i < 850 && s.racers[1].finishTime === null && s.phase !== 'finished'; i++) {
      rules.update(s, .25, [{ steer: 0, brake: true, boost: false }, rules.aiInput(s, 1)]);
    }
    if (s.phase !== 'racing' || s.racers[1].finishTime === null || s.racers[0].finishTime !== null) throw new Error('The engine scenario did not produce an early guest finish.');
    g.netStart('join');
    const { objects, ...wire } = s;
    wire.collected = objects.filter(o => o.collectedBy.length).map(o => [o.id, ...o.collectedBy]);
    g.netApply({ v: 1, k: 'snapshot', round: 1, epoch: 0, barrier: 0, seq: 1, ack: 0, started: true, paused: false, ready: [false, false], choices: ['violent-j', 'mad-man-pondo'], state: wire });
    return { mode: g.state.mode, seat: g.state.seat, finishTime: g.state.racers[1].finishTime, best: g.state.best, wins: g.state.wins };
  });
  expect(outcome.mode).toBe('racing'); expect(outcome.seat).toBe(1); expect(outcome.finishTime).toBeGreaterThan(0);
  expect(outcome.best).toBe(0); expect(outcome.wins).toBe(0);
  await expect(page.locator('#rcStatus')).toContainText(/waiting/i);
  await expect(page.locator('#rcResult')).toBeHidden();
  for (const id of ['rcLeftBtn', 'rcRightBtn', 'rcBrakeBtn', 'rcBoostBtn']) await expect(page.locator('#' + id)).toBeDisabled();
  await key(page, 'keydown', 'ArrowRight', 'ArrowRight');
  await key(page, 'keydown', ' ', 'Space');
  expect(await page.evaluate(() => ARCADE.RACING.debug.controls())).toEqual({ steer: 0, brake: false, boost: false });
});
