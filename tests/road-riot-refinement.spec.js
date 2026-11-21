import { test, expect } from '@playwright/test';

let errors;
test.beforeEach(async ({ page }) => {
  errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/game.html'); await page.waitForFunction(() => window.ROAD_RIOT_READY);
  await page.evaluate(() => { ARCADE.Sound.on = false; ARCADE.showScreen('riot'); });
  await page.waitForFunction(() => ARCADE.ROAD_RIOT.state.loaded);
});
test.afterEach(() => expect(errors).toEqual([]));

async function start(page) {
  await page.locator('#rrStartBtn').click();
  await page.evaluate(() => { for (let i = 0; i < 13; i++) ARCADE.ROAD_RIOT.debug.advance(.25, {}); });
  await expect(page.locator('#rrLeftBtn')).toBeEnabled();
}

async function stableDom(page) {
  await page.waitForTimeout(160);
  await page.evaluate(() => {
    window.riotMutations = [];
    window.riotObserver = new MutationObserver(records => riotMutations.push(...records.map(record => ({ id: record.target.id, attribute: record.attributeName, type: record.type }))));
    riotObserver.observe(document.getElementById('rrScreen'), { subtree: true, attributes: true, childList: true, characterData: true });
  });
  await page.waitForTimeout(260);
  const records = await page.evaluate(() => { riotObserver.disconnect(); return riotMutations; });
  expect(records).toEqual([]);
}

test('idle and paused screens preserve their DOM while meaningful selection still updates', async ({ page }) => {
  await stableDom(page);
  await page.locator('[data-riot-racer="big-foot"]').click();
  await expect(page.locator('[data-riot-racer="big-foot"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-riot-racer="violent-j"]')).toHaveAttribute('aria-pressed', 'false');
  await start(page); await page.locator('#rrPauseBtn').click();
  await stableDom(page);
});

test('a long foreground frame discards elapsed race time while hiding the page still pauses it', async ({ page }) => {
  await start(page);
  const frame = await page.evaluate(async () => {
    const g = ARCADE.ROAD_RIOT;
    const nativeFrame = window.requestAnimationFrame.bind(window);
    let offset = 0;
    window.requestAnimationFrame = callback => nativeFrame(time => callback(time + offset));
    const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
    const capture = () => {
      const s = g.state;
      return { mode: s.mode, time: s.time, positions: s.racers.map(r => r.z) };
    };

    // Let the game's existing callback schedule its next frame on the controlled clock.
    const startTime = await nextFrame();
    const before = capture();
    offset = 750;
    const endTime = await nextFrame();
    return { before, after: capture(), gap: endTime - startTime };
  });
  expect(frame.before.mode).toBe('racing');
  expect(frame.gap).toBeGreaterThanOrEqual(750);
  expect(frame.after).toEqual(frame.before);
  await expect.poll(() => page.evaluate(() => ARCADE.ROAD_RIOT.state.time)).toBeGreaterThan(frame.after.time);

  await page.locator('#rrCanvas').focus();
  await page.keyboard.down('ArrowRight');
  const hidden = await page.evaluate(() => {
    const g = ARCADE.ROAD_RIOT;
    const steerBefore = g.debug.controls().steer;
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    return { steerBefore, steerAfter: g.debug.controls().steer, paused: g.state.paused };
  });
  expect(hidden).toEqual({ steerBefore: 1, steerAfter: 0, paused: true });
  await expect(page.locator('#rrResumeBtn')).toBeVisible();
});

test('holding brake and steering cannot slide a stopped ride sideways', async ({ page }) => {
  await start(page); await page.locator('#rrCanvas').click(); await page.keyboard.down('ArrowDown');
  const stopped = await page.evaluate(() => {
    const g = ARCADE.ROAD_RIOT;
    for (let i = 0; i < 12; i++) g.debug.advance(.25);
    return g.state.racers[0];
  });
  expect(stopped.speed).toBe(0);
  await page.keyboard.down('ArrowRight');
  const after = await page.evaluate(() => {
    const g = ARCADE.ROAD_RIOT;
    for (let i = 0; i < 4; i++) g.debug.advance(.25);
    return g.state.racers[0];
  });
  expect(after.speed).toBe(0); expect(after.x).toBeCloseTo(stopped.x, 8); expect(after.z).toBeCloseTo(stopped.z, 8);
  await expect(page.locator('#rrAttackLeftBtn')).toHaveAttribute('data-state', 'slow');
  await expect(page.locator('#rrAttackRightBtn')).not.toHaveClass(/in-range/);
  await page.keyboard.up('ArrowRight'); await page.keyboard.up('ArrowDown');
});

test('strike readiness respects guarding and cooldown indicators freeze when paused', async ({ page }) => {
  await start(page); await page.locator('#rrCanvas').click();
  await page.evaluate(() => ARCADE.ROAD_RIOT.debug.advance(.25, {}));
  await page.keyboard.down('k');
  await expect(page.locator('#rrAttackRightBtn')).toHaveAttribute('data-state', 'guarding');
  await expect(page.locator('#rrAttackRightBtn')).not.toHaveClass(/in-range/);
  await page.keyboard.up('k'); await expect(page.locator('#rrAttackRightBtn')).not.toHaveAttribute('data-state', 'guarding');
  // Keep the 0.85-second cooldown inside one browser sequence. Remote click
  // actionability and separate assertions can take longer than the cooldown.
  const { live, frozen } = await page.evaluate(async () => {
    const game = ARCADE.ROAD_RIOT;
    const button = document.getElementById('rrAttackRightBtn');
    const glyph = document.getElementById('rrAttackRightGlyph');
    const meter = document.getElementById('rrAttackRightMeter');
    button.click();
    game.debug.advance(.1);
    for (let frame = 0; frame < 30; frame++) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      if (button.dataset.state !== 'cooldown') continue;
      const live = { state: button.dataset.state, label: glyph.textContent, inRange: button.classList.contains('in-range') };
      document.getElementById('rrPauseBtn').click();
      return { live, frozen: { cooldown: game.state.racers[0].attackCooldown, meter: meter.value, label: glyph.textContent } };
    }
    throw new Error('The accepted strike never displayed its cooldown');
  });
  expect(live.state).toBe('cooldown'); expect(live.label).toMatch(/\d\.\d/); expect(live.inRange).toBe(false);
  expect(frozen.cooldown).toBeGreaterThan(0); expect(frozen.meter).toBeGreaterThanOrEqual(0); expect(frozen.meter).toBeLessThan(100);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => ({ cooldown: ARCADE.ROAD_RIOT.state.racers[0].attackCooldown, meter: document.getElementById('rrAttackRightMeter').value, label: document.getElementById('rrAttackRightGlyph').textContent }))).toEqual(frozen);
  await page.locator('#rrResumeBtn').click();
  await page.evaluate(() => { for (let i = 0; i < 4; i++) ARCADE.ROAD_RIOT.debug.advance(.25, {}); });
  await expect(page.locator('#rrAttackRightBtn')).not.toHaveAttribute('data-state', 'cooldown');
  await expect.poll(() => page.locator('#rrAttackRightMeter').evaluate(el => el.value)).toBe(100);
});

test('an out-of-range strike reports a miss and a useful gap instead of a false hit', async ({ page }) => {
  await start(page);
  await page.evaluate(() => { for (let i = 0; i < 16; i++) ARCADE.ROAD_RIOT.debug.advance(.25, { brake: true }); });
  await page.evaluate(() => { for (let i = 0; i < 3; i++) ARCADE.ROAD_RIOT.debug.advance(.25, {}); });
  await expect(page.locator('#rrAttackLeftBtn')).toHaveAttribute('data-state', 'line-up');
  await expect(page.locator('#rrRivalGap')).toHaveText(/.+ · TRAIL \d+\s*m/i);
  await page.locator('#rrAttackLeftBtn').click();
  const result = await page.evaluate(() => {
    const g = ARCADE.ROAD_RIOT; g.debug.advance(.25); g.debug.advance(.1); g.pause(true);
    return { misses: g.state.events.filter(event => event.type === 'miss' && event.racer === 0), hits: g.state.racers[0].combatHits };
  });
  expect(result.misses).toHaveLength(1); expect(result.misses[0].side).toBe(-1); expect(result.hits).toBe(0);
  await expect(page.locator('#rrFeedback')).toContainText(/MISS|WHIFF/i);
  await expect(page.locator('#rrFeedback')).not.toContainText('CLEAN HIT');
});

test('a pickup immediately after an impact cannot erase the combat feedback', async ({ page }) => {
  const found = await page.evaluate(() => {
    const random = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = array => { array.fill(1); return array; };
    document.getElementById('rrStartBtn').click(); crypto.getRandomValues = random;
    const g = ARCADE.ROAD_RIOT, seen = new Set(); let impact = null, found = null;
    for (let i = 0; i < 3600 && !found; i++) {
      g.debug.advance(1 / 60, ROAD_RIOT_RULES.aiInput(g.state, 0));
      for (const event of g.state.events) {
        if (seen.has(event.id)) continue; seen.add(event.id);
        if (event.type === 'strike' && (event.racer === 0 || event.target === 0) || event.racer === 0 && ['knockout', 'crash', 'hit', 'recover'].includes(event.type)) impact = event;
        if (event.type === 'pickup' && event.racer === 0 && impact && event.time - impact.time < .3) found = { impact, pickup: event };
      }
    }
    g.pause(true); return found;
  });
  expect(found).not.toBeNull(); expect(found.pickup.time - found.impact.time).toBeLessThan(.3);
  await expect(page.locator('#rrFeedback')).not.toHaveAttribute('data-kind', 'pickup');
  await expect(page.locator('#rrFeedback')).not.toContainText(/TICKET|REFILLED|REPAIRED/);
});

for (const timeout of [false, true]) {
  test(`the ${timeout ? 'timeout' : 'finished'} score breakdown sums to the result and saved score`, async ({ page }) => {
    await start(page);
    const result = await page.evaluate(timeout => {
      const g = ARCADE.ROAD_RIOT;
      for (let i = 0; i < 1000 && g.state.phase !== 'finished'; i++) g.debug.advance(.25, timeout ? { brake: true } : ROAD_RIOT_RULES.aiInput(g.state, 0));
      return { state: g.state, breakdown: ROAD_RIOT_RULES.scoreBreakdown(g.state), score: ROAD_RIOT_RULES.score(g.state) };
    }, timeout);
    expect(result.state.phase).toBe('finished'); expect(result.state.racers[0].dnf).toBe(timeout);
    const fields = { Finish: 'finish', Hits: 'hits', Knockouts: 'knockouts', Tickets: 'tickets', Duels: 'duels', Time: 'timeBonus', Penalty: 'penalty' };
    let sum = 0;
    for (const [id, key] of Object.entries(fields)) {
      const value = await page.locator('#rrScore' + id).textContent();
      const number = Number(value.replace(/,/g, '').replace(/−/g, '-').replace(/[^0-9+.-]/g, ''));
      expect(number, id).toBe(result.breakdown[key]); sum += number;
    }
    expect(sum).toBe(result.score); expect(result.breakdown.total).toBe(result.score);
    expect(result.breakdown.penalty).toBe(timeout ? -1200 : 0);
    await expect(page.locator('#rrScore')).toHaveText(result.score.toLocaleString('en-US'));
    await expect(page.locator('#rrResultRecap')).toContainText('BEST STREAK'); await expect(page.locator('#rrRivalGap')).toContainText('FINISHED');
    await stableDom(page);
    await page.locator('#rrSaveBtn').click(); await page.locator('#lbInitials').fill('SUM'); await page.locator('#lbSaveBtn').click();
    expect(await page.evaluate(() => ARCADE.LB.board('riot')[0].v)).toBe(sum);
    if (timeout) {
      await page.locator('#lbClose').click(); await page.locator('#rrChangeBtn').click();
      await page.locator('[data-riot-racer="big-foot"]').click(); await page.locator('#rrStartBtn').click();
      const nextTick = await page.evaluate(() => {
        const g = ARCADE.ROAD_RIOT;
        for (let i = 0; i < 1000 && g.state.phase !== 'finished'; i++) g.debug.advance(.25, { brake: true });
        return g.state.tick;
      });
      expect(nextTick).toBe(result.state.tick);
      await expect(page.locator('#rrPlacements .rr-you')).toContainText('Big Foot');
    }
  });
}

for (const [width, height] of [[320, 568], [667, 375]]) {
  test(`new combat indicators remain inside their controls at ${width}x${height}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height }); await start(page);
    await page.evaluate(() => ARCADE.ROAD_RIOT.debug.advance(.25, {}));
    await page.locator('#rrAttackRightBtn').click(); await expect(page.locator('#rrAttackRightBtn')).toHaveAttribute('data-state', 'cooldown');
    const geometry = await page.evaluate(() => {
      const contained = (child, parent) => { const c = document.getElementById(child).getBoundingClientRect(), p = document.getElementById(parent).getBoundingClientRect(); return { child, fits: c.x >= p.x - 1 && c.y >= p.y - 1 && c.right <= p.right + 1 && c.bottom <= p.bottom + 1, width: c.width, height: c.height }; };
      return { overflow: document.documentElement.scrollWidth > innerWidth + 1, parts: [contained('rrAttackLeftGlyph', 'rrAttackLeftBtn'), contained('rrAttackRightGlyph', 'rrAttackRightBtn'), contained('rrAttackLeftMeter', 'rrAttackLeftBtn'), contained('rrAttackRightMeter', 'rrAttackRightBtn'), contained('rrRivalGap', 'rrCanvas')] };
    });
    expect(geometry.overflow).toBe(false);
    for (const part of geometry.parts) { expect(part.fits, part.child).toBe(true); expect(part.width, part.child).toBeGreaterThan(0); expect(part.height, part.child).toBeGreaterThan(0); }
    await page.screenshot({ path: testInfo.outputPath('riot-readiness-' + width + '.png') });
  });
}
