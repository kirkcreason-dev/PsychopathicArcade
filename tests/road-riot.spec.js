import { test, expect } from '@playwright/test';

const neutral = { steer: 0, brake: false, boost: false, attackLeft: false, attackRight: false, block: false };
let errors;

async function openRiot(page) {
  await page.goto('/game.html');
  await page.waitForFunction(() => window.ROAD_RIOT_READY);
  await page.evaluate(() => { ARCADE.Sound.on = false; ARCADE.showScreen('riot'); });
  await page.waitForFunction(() => ARCADE.ROAD_RIOT.state.loaded);
}
async function race(page) {
  await page.locator('#rrStartBtn').click();
  await page.evaluate(() => { for (let i = 0; i < 13; i++) ARCADE.ROAD_RIOT.debug.advance(.25, {}); });
  await page.waitForFunction(() => ARCADE.ROAD_RIOT.state.phase === 'racing');
  await expect(page.locator('#rrLeftBtn')).toBeEnabled();
}
async function complete(page, braking = false) {
  return page.evaluate(braking => {
    const g = ARCADE.ROAD_RIOT;
    for (let i = 0; i < 1000 && g.state.phase !== 'finished'; i++) {
      g.debug.advance(.25, braking ? { brake: true } : ROAD_RIOT_RULES.aiInput(g.state, 0));
    }
    const state = g.state;
    if (state.phase !== 'finished') throw new Error('Road Riot did not finish within the time limit.');
    return { state, score: ROAD_RIOT_RULES.score(state), won: ROAD_RIOT_RULES.standings(state)[0].id === 0 };
  }, braking);
}
async function pointer(page, id, type, pointerId) {
  return page.evaluate(({ id, type, pointerId }) => {
    const button = document.getElementById(id);
    button.setPointerCapture = () => {};
    button.dispatchEvent(new PointerEvent(type, { pointerId, pointerType: 'touch', bubbles: true }));
    return ARCADE.ROAD_RIOT.debug.controls();
  }, { id, type, pointerId });
}

test.beforeEach(async ({ page }) => {
  errors = []; page.on('pageerror', error => errors.push(error.message));
  await openRiot(page);
});
test.afterEach(() => expect(errors).toEqual([]));

test('Road Riot is a separate selectable game with six decoded rides and a fair countdown', async ({ page }) => {
  await expect(page.locator('[data-riot-racer]')).toHaveCount(6);
  expect(await page.locator('[data-riot-racer] img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth === 512))).toBe(true);
  await page.locator('[data-riot-racer="mad-man-pondo"]').click();
  await expect(page.locator('[data-riot-racer="mad-man-pondo"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#rrStartBtn').focus(); await page.keyboard.press('Space');
  const state = await page.evaluate(() => ARCADE.ROAD_RIOT.getState());
  expect(state.started).toBe(true); expect(state.phase).toBe('countdown'); expect(state.combat).toBe(true);
  expect(state.racers[0].racerId).toBe('mad-man-pondo'); expect(state.racers.every(racer => racer.speed === 0)).toBe(true);
  expect(await page.evaluate(() => ARCADE.RACING.state.started)).toBe(false);
  await expect(page.locator('#rrSetup')).toBeHidden();
  await page.locator('#rrHomeBtn').click(); await expect(page.locator('#cardRoadRiot')).toBeVisible();
  await page.locator('#cardRoadRiot').click();
  expect(await page.evaluate(() => ARCADE.ROAD_RIOT.state.paused)).toBe(true);
});

test('steering, both attacks, block and turbo receive keyboard input without alias release conflicts', async ({ page }) => {
  await race(page); await page.locator('#rrCanvas').click();
  await page.keyboard.down('ArrowLeft'); await page.keyboard.down('a'); await page.keyboard.up('ArrowLeft');
  expect(await page.evaluate(() => ARCADE.ROAD_RIOT.debug.controls().steer)).toBe(-1);
  await page.keyboard.up('a');
  await page.keyboard.down('j'); await page.keyboard.down('k'); await page.keyboard.down('Shift');
  expect(await page.evaluate(() => ARCADE.ROAD_RIOT.debug.controls())).toEqual({ ...neutral, attackLeft: true, block: true, boost: true });
  await page.keyboard.up('j'); await page.keyboard.up('k'); await page.keyboard.up('Shift');
  await page.keyboard.down('l');
  expect(await page.evaluate(() => ARCADE.ROAD_RIOT.debug.controls().attackRight)).toBe(true);
  await page.keyboard.up('l'); expect(await page.evaluate(() => ARCADE.ROAD_RIOT.debug.controls())).toEqual(neutral);
});

test('touch controls release independently on cancellation and pause clears every held action', async ({ page }) => {
  await race(page);
  await pointer(page, 'rrLeftBtn', 'pointerdown', 41);
  await pointer(page, 'rrAttackRightBtn', 'pointerdown', 42);
  expect(await pointer(page, 'rrBlockBtn', 'pointerdown', 43)).toEqual({ ...neutral, steer: -1, attackRight: true, block: true });
  expect(await pointer(page, 'rrAttackRightBtn', 'pointercancel', 42)).toEqual({ ...neutral, steer: -1, block: true });
  expect(await pointer(page, 'rrLeftBtn', 'lostpointercapture', 41)).toEqual({ ...neutral, block: true });
  await page.locator('#rrPauseBtn').click();
  expect(await page.evaluate(() => ARCADE.ROAD_RIOT.debug.controls())).toEqual(neutral);
  const position = await page.evaluate(() => ARCADE.ROAD_RIOT.state.racers.map(racer => racer.z));
  await page.waitForTimeout(180);
  expect(await page.evaluate(() => ARCADE.ROAD_RIOT.state.racers.map(racer => racer.z))).toEqual(position);
  await page.locator('#rrResumeBtn').click();
  expect(await page.evaluate(() => ARCADE.ROAD_RIOT.debug.controls())).toEqual(neutral);
});

test('blur and arcade navigation stop combat and preserve the paused race', async ({ page }) => {
  await race(page); await page.locator('#rrCanvas').click();
  await page.keyboard.down('ArrowRight'); await page.keyboard.down('l'); await page.keyboard.down('k');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  expect(await page.evaluate(() => ARCADE.ROAD_RIOT.debug.controls())).toEqual(neutral);
  const before = await page.evaluate(() => ARCADE.ROAD_RIOT.state);
  expect(before.paused).toBe(true);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => ARCADE.ROAD_RIOT.state.time)).toBe(before.time);
  await page.keyboard.up('ArrowRight'); await page.keyboard.up('l'); await page.keyboard.up('k');
  await page.evaluate(() => { ARCADE.showScreen('racing'); ARCADE.showScreen('riot'); });
  expect(await page.evaluate(() => ARCADE.ROAD_RIOT.state.time)).toBe(before.time);
  expect(await page.evaluate(() => ARCADE.ROAD_RIOT.state.paused)).toBe(true);
  await page.locator('#rrResumeBtn').focus(); await page.keyboard.press('Space');
  expect(await page.evaluate(() => ARCADE.ROAD_RIOT.state.paused)).toBe(false);
  expect(await page.evaluate(() => ARCADE.ROAD_RIOT.debug.controls())).toEqual(neutral);
});

test('a released turbo tap lasts three simulation seconds and pauses with the race', async ({ page }) => {
  await race(page);
  const initial = await page.evaluate(() => ARCADE.ROAD_RIOT.state.racers[0].boost);
  await page.locator('#rrBoostBtn').focus(); await page.keyboard.press('Space');
  const burst = await page.evaluate(() => {
    const g = ARCADE.ROAD_RIOT; g.debug.advance(.05); g.pause(true); return g.state.racers[0];
  });
  expect(burst.boosting).toBe(true); expect(burst.boostTime).toBeGreaterThan(2.7); expect(burst.boostTime).toBeLessThanOrEqual(3);
  expect(burst.boost).toBeLessThan(initial - 25);
  await expect(page.locator('#rrSpeed')).toHaveText(String(Math.round(burst.speed * .36)));
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => ARCADE.ROAD_RIOT.state.racers[0].boostTime)).toBe(burst.boostTime);
  const after = await page.evaluate(() => {
    const g = ARCADE.ROAD_RIOT; g.pause(false);
    for (let i = 0; i < 13; i++) g.debug.advance(.25, {});
    g.pause(true); return g.state.racers[0];
  });
  expect(after.boosting).toBe(false); expect(after.boostTime).toBe(0);
});

for (const seed of [1, 2]) {
  test(`a real strike tap reaches a rival and reports its actual blocked outcome (seed ${seed})`, async ({ page }) => {
    await page.evaluate(seed => {
      window.riotRandom = crypto.getRandomValues.bind(crypto);
      crypto.getRandomValues = array => { array.fill(seed); return array; };
    }, seed);
    await page.locator('#rrStartBtn').click();
    await page.evaluate(() => {
      crypto.getRandomValues = riotRandom;
      const g = ARCADE.ROAD_RIOT;
      while (g.state.phase === 'countdown') g.debug.advance(.25, {});
      for (let i = 0; i < 3; i++) g.debug.advance(.2, {});
    });
    await page.locator('#rrAttackRightBtn').click();
    const outcome = await page.evaluate(() => {
      const g = ARCADE.ROAD_RIOT; g.debug.advance(.25); g.debug.advance(.1);
      const event = g.state.events.filter(event => event.type === 'strike' && event.racer === 0).at(-1);
      g.pause(true); return { event, state: g.state };
    });
    expect(outcome.event).toMatchObject({ racer: 0, target: 1, side: 1 });
    expect(outcome.state.racers[1].health).toBeLessThan(100);
    expect(outcome.state.racers[0].combatHits).toBe(outcome.event.blocked ? 0 : 1);
    await expect(page.locator('#rrFeedback')).toContainText(outcome.event.blocked ? 'BLOCKED YOUR HIT' : 'CLEAN HIT');
  });
}

test('releasing and pressing again between physics frames rearms ready attacks and expired turbo', async ({ page }) => {
  await race(page);
  const result = await page.evaluate(() => {
    const g = ARCADE.ROAD_RIOT;
    const key = (type, key, code) => document.body.dispatchEvent(new KeyboardEvent(type, { key, code, bubbles: true }));
    g.debug.advance(.25, {}); key('keydown', 'l', 'KeyL');
    for (let i = 0; i < 4; i++) g.debug.advance(.25);
    const attacksBefore = g.state.events.filter(event => event.type === 'attack' && event.racer === 0).length;
    key('keyup', 'l', 'KeyL'); key('keydown', 'l', 'KeyL'); g.debug.advance(.025);
    const attacksAfter = g.state.events.filter(event => event.type === 'attack' && event.racer === 0).length;
    key('keyup', 'l', 'KeyL'); key('keydown', 'Shift', 'ShiftLeft');
    for (let i = 0; i < 13; i++) g.debug.advance(.25);
    const expired = g.state.racers[0];
    key('keyup', 'Shift', 'ShiftLeft'); key('keydown', 'Shift', 'ShiftLeft'); g.debug.advance(.025);
    const fresh = g.state.racers[0]; key('keyup', 'Shift', 'ShiftLeft'); g.pause(true);
    return { attacksBefore, attacksAfter, expired, fresh };
  });
  expect(result.attacksBefore).toBe(1); expect(result.attacksAfter).toBe(2);
  expect(result.expired.boostTime).toBe(0); expect(result.expired.boostHeld).toBe(true);
  expect(result.fresh.boostTime).toBeGreaterThan(2.9); expect(result.fresh.boost).toBeLessThan(result.expired.boost - 29);
});

test('a completed race saves one independent local score and rematches with clean combat state', async ({ page }) => {
  await race(page); const finished = await complete(page);
  expect(finished.state.racers[0].dnf).toBe(false); expect(finished.score).toBeGreaterThan(0);
  expect(finished.state.best).toBe(finished.score); expect(finished.state.wins).toBe(finished.won ? 1 : 0);
  await expect(page.locator('#rrResult')).toBeVisible(); await expect(page.locator('#rrPlacements li')).toHaveCount(6);
  await page.locator('#rrSaveBtn').focus(); await page.keyboard.press('Space');
  await expect(page.locator('#lbGameName')).toContainText('ROAD RIOT');
  await page.locator('#lbInitials').fill('JCW'); await page.locator('#lbSaveBtn').click();
  expect(await page.evaluate(() => ARCADE.LB.board('riot').map(row => row.v))).toEqual([finished.score]);
  expect(await page.evaluate(() => ARCADE.LB.board('racing'))).toEqual([]);
  await page.locator('#lbClose').click();
  await expect(page.locator('#rrSaveBtn')).toBeDisabled();
  await page.evaluate(() => { for (let i = 0; i < 8; i++) ARCADE.ROAD_RIOT.debug.advance(.25, {}); });
  expect(await page.evaluate(() => [ARCADE.ROAD_RIOT.state.best, ARCADE.ROAD_RIOT.state.wins])).toEqual([finished.state.best, finished.state.wins]);
  await page.locator('#rrAgainBtn').focus(); await page.keyboard.press('Space');
  const next = await page.evaluate(() => ARCADE.ROAD_RIOT.state);
  expect(next.phase).toBe('countdown'); expect(next.racers.every(racer => racer.finishTime === null && racer.combatHits === 0 && racer.knockouts === 0 && racer.attackTime === 0 && racer.crashTime === 0 && !racer.blocking && racer.boostTime === 0)).toBe(true);
  await openRiot(page);
  expect(await page.evaluate(() => ARCADE.LB.board('riot').map(row => row.v))).toEqual([finished.score]);
  expect(await page.evaluate(() => ARCADE.ROAD_RIOT.state.best)).toBe(finished.score);
});

test('closing or skipping initials never claims a saved record and allows the same result to retry', async ({ page }) => {
  await race(page); const finished = await complete(page);
  for (const dismiss of ['lbClose', 'lbSkipBtn']) {
    await page.locator('#rrSaveBtn').click(); await expect(page.locator('#lbEntry')).toBeVisible();
    expect(await page.evaluate(() => ARCADE.ROAD_RIOT.state.saved)).toBe(false);
    expect(await page.evaluate(() => ARCADE.LB.board('riot'))).toEqual([]);
    await page.locator('#' + dismiss).click();
    if (dismiss === 'lbSkipBtn') {
      await expect(page.locator('#lbEntry')).toBeHidden();
      expect(await page.evaluate(() => ARCADE.ROAD_RIOT.state.saved)).toBe(false);
      await page.locator('#lbClose').click();
    }
    await expect(page.locator('#lbModal')).toBeHidden();
    await expect(page.locator('#rrSaveBtn')).toBeEnabled(); await expect(page.locator('#rrSaveBtn')).toHaveText('SAVE RECORD');
    expect(await page.evaluate(() => ARCADE.ROAD_RIOT.state.saved)).toBe(false);
  }
  await page.locator('#rrSaveBtn').click(); await page.locator('#lbInitials').fill('TRY');
  await page.locator('#lbSaveBtn').click();
  await expect.poll(() => page.evaluate(() => ARCADE.ROAD_RIOT.state.saved)).toBe(true);
  expect(await page.evaluate(() => ARCADE.LB.board('riot').map(row => ({ name: row.name, v: row.v })))).toEqual([{ name: 'TRY', v: finished.score }]);
  await page.locator('#lbClose').click(); await expect(page.locator('#rrSaveBtn')).toHaveText('RECORD SAVED');
});

test('choosing another rider cannot replace a completed result until Change Ride is used', async ({ page }) => {
  await race(page); await complete(page);
  const result = await page.evaluate(() => {
    const g = ARCADE.ROAD_RIOT, before = g.state, accepted = g.choose('big-foot');
    return { before, accepted, after: g.state };
  });
  expect(result.accepted).toBe(false); expect(result.after).toEqual(result.before);
  await expect(page.locator('#rrResult')).toBeVisible(); await expect(page.locator('#rrPlacements li')).toHaveCount(6);
  await page.locator('#rrChangeBtn').click(); await page.locator('[data-riot-racer="big-foot"]').click();
  expect(await page.evaluate(() => ARCADE.ROAD_RIOT.state.chosen)).toBe('big-foot');
  await expect(page.locator('#rrSetup')).toBeVisible(); await expect(page.locator('#rrResult')).toBeHidden();
});

test('an unranked timeout shows honest results and opens records without claiming a save or win', async ({ page }) => {
  await page.evaluate(() => { for (let i = 0; i < 10; i++) ARCADE.LB.board('riot').push({ name: 'TOP', v: 100000 - i, tag: 'EXISTING', t: 1700000000000 }); });
  await race(page); const finished = await complete(page, true);
  expect(finished.state.racers[0].dnf).toBe(true); expect(finished.state.wins).toBe(0);
  await expect(page.locator('#rrResultDetail')).toContainText('Time limit'); await expect(page.locator('#rrSaveBtn')).toHaveText('VIEW RECORDS');
  await page.locator('#rrSaveBtn').click(); await expect(page.locator('#lbModal')).toBeVisible(); await expect(page.locator('#lbEntry')).toBeHidden();
  expect(await page.evaluate(() => ARCADE.ROAD_RIOT.state.saved)).toBe(false);
  expect(await page.evaluate(() => ARCADE.LB.board('riot').length)).toBe(10);
  await page.locator('#lbClose').click(); await expect(page.locator('#rrSaveBtn')).toBeEnabled();
});

test('abandoning a run awards nothing and changing rides creates a fresh independent grid', async ({ page }) => {
  await race(page);
  await page.locator('#rrHomeBtn').click();
  expect(await page.evaluate(() => [ARCADE.ROAD_RIOT.state.best, ARCADE.ROAD_RIOT.state.wins, ARCADE.LB.board('riot').length])).toEqual([0, 0, 0]);
  await page.locator('#cardRoadRiot').click(); await page.locator('#rrResumeBtn').click();
  await complete(page); await page.locator('#rrChangeBtn').click();
  await expect(page.locator('#rrSetup')).toBeVisible(); await page.locator('[data-riot-racer="big-foot"]').click();
  await page.locator('#rrStartBtn').click();
  expect(await page.evaluate(() => ARCADE.ROAD_RIOT.state.racers[0].racerId)).toBe('big-foot');
  expect(await page.evaluate(() => ARCADE.RACING.state.chosen)).not.toBe('big-foot');
});

for (const [width, height] of [[320, 568], [390, 844], [667, 375], [844, 390]]) {
  test(`race, combat controls and results remain reachable at ${width}x${height}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height }); await race(page);
    const layout = await page.evaluate(() => {
      const ids = ['rrCanvas', 'rrLeftBtn', 'rrRightBtn', 'rrBrakeBtn', 'rrBoostBtn', 'rrAttackLeftBtn', 'rrAttackRightBtn', 'rrBlockBtn', 'rrPauseBtn', 'rrHomeBtn'];
      return { overflow: document.documentElement.scrollWidth > innerWidth + 1, rects: ids.map(id => {
        const el = document.getElementById(id), r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { id, x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom, hit: hit === el || el.contains(hit) };
      }) };
    });
    expect(layout.overflow).toBe(false);
    for (const rect of layout.rects) {
      expect(rect.x, rect.id).toBeGreaterThanOrEqual(-1); expect(rect.y, rect.id).toBeGreaterThanOrEqual(-1);
      expect(rect.right, rect.id).toBeLessThanOrEqual(width + 1); expect(rect.bottom, rect.id).toBeLessThanOrEqual(height + 1);
      expect(rect.height, rect.id).toBeGreaterThanOrEqual(rect.id === 'rrCanvas' ? 120 : 32);
      expect(rect.hit, rect.id + ' is not covered').toBe(true);
    }
    const canvas = layout.rects[0];
    for (const rect of layout.rects.slice(1)) expect(canvas.bottom <= rect.y + 1 || canvas.right <= rect.x + 1 || rect.right <= canvas.x + 1 || rect.bottom <= canvas.y + 1, rect.id + ' does not cover the race').toBe(true);
    await page.screenshot({ path: testInfo.outputPath('road-riot-race-' + width + '.png') });
    await complete(page); await expect(page.locator('#rrPlacements li')).toHaveCount(6);
    for (const id of ['rrSaveBtn', 'rrAgainBtn', 'rrChangeBtn']) {
      await page.locator('#' + id).scrollIntoViewIfNeeded();
      await expect(page.locator('#' + id)).toBeInViewport();
      expect(await page.locator('#' + id).evaluate(el => { const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return el === hit || el.contains(hit); })).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath('road-riot-result-' + width + '.png') });
  });
}
