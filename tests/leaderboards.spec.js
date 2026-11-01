import { test, expect } from '@playwright/test';

const games = ['poker', 'racing', 'pool', 'ladder', 'rumble', 'chicken', 'claw', 'shooter', 'ttt', 'chess', 'checkers', 'pinball', 'faygo', 'bj', 'memory', 'camper', 'solitaire', 'j31', 'hockey'];
let errors;
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', error => errors.push(error.message));
});
test.afterEach(() => expect(errors).toEqual([]));

async function open(page) {
  await page.goto('/game.html');
  await page.waitForFunction(() => window.LB_READY);
  await page.evaluate(() => { ARCADE.Sound.on = false; });
}

async function embedded(page) {
  await page.goto('/');
  await page.evaluate(() => {
    window.recordMessages = [];
    window.addEventListener('message', e => { if (e.data?.type === 'jcw-arcade') recordMessages.push(e.data); });
  });
  const frame = page.frames().find(f => f.url().endsWith('/game.html'));
  await frame.waitForFunction(() => window.LB_READY);
  await frame.evaluate(() => { ARCADE.Sound.on = false; });
  return frame;
}

test('all 19 games have their own reachable trophy and correctly named board', async ({ page }) => {
  await open(page);
  const config = await page.evaluate(() => ARCADE.LB.CFG);
  expect(Object.keys(config)).toEqual(games);
  for (const game of games) {
    const button = page.locator('#' + config[game].screen + ' .lb-mini');
    await expect(button).toHaveCount(1);
    await expect(button).toHaveAttribute('aria-label', 'Leaderboard');
    await button.evaluate(el => el.click());
    await expect(page.locator('#lbModal')).toBeVisible();
    await expect(page.locator('#lbGameName')).toHaveText(config[game].name);
    await expect(page.locator('#lbMetric')).toHaveText(config[game].metric);
    await expect(page.locator('#lbTabs button')).toHaveCount(19);
    await page.locator('#lbClose').click();
  }
});

test('all 19 games save independently and persist, without extending the website badge bridge', async ({ page }) => {
  const frame = await embedded(page);
  for (let i = 0; i < games.length; i++) {
    const game = games[i], score = 100 + i;
    await frame.evaluate(({ game, score }) => ARCADE.LB.check(game, score, 'TEST RUN'), { game, score });
    await frame.locator('#lbInitials').fill('JCW');
    await frame.locator('#lbSaveBtn').click();
    expect(await frame.evaluate(game => ARCADE.LB.board(game).map(e => ({ name: e.name, v: e.v, tag: e.tag })), game))
      .toEqual([{ name: 'JCW', v: score, tag: 'TEST RUN' }]);
    await frame.locator('#lbClose').click();
  }
  // Existing legacy games retain their previous host notifications; adding
  // Poker and Racing records must not add website wins or badges.
  await expect.poll(async () => (await page.evaluate(() => recordMessages.filter(m => ['win', 'record'].includes(m.ev)))).length).toBe(34);
  const messages = await page.evaluate(() => recordMessages.filter(m => ['win', 'record'].includes(m.ev)));
  expect(messages.some(m => m.g === 'poker' || m.g === 'racing')).toBe(false);
  for (const game of games.filter(g => !['poker', 'racing'].includes(g))) {
    expect(messages.filter(m => m.g === game).map(m => m.ev)).toEqual(['win', 'record']);
  }
  await page.reload();
  const reloaded = page.frames().find(f => f.url().endsWith('/game.html'));
  await reloaded.waitForFunction(() => window.LB_READY);
  expect(await reloaded.evaluate(() => Object.fromEntries(Object.keys(ARCADE.LB.CFG).map(g => [g, ARCADE.LB.board(g).map(e => e.v)]))))
    .toEqual(Object.fromEntries(games.map((g, i) => [g, [100 + i]])));
});

test('loading records sorts before trimming, honors low-score games, and rejects corrupted entries', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const entry = v => ({ v, name: 'ABC', tag: 'round', t: 1700000000000 });
    localStorage.setItem('pa_lb', JSON.stringify({
      pinball: Array.from({ length: 15 }, (_, i) => entry(i + 1)),
      chess: Array.from({ length: 15 }, (_, i) => entry(30 - i)),
      poker: [null, entry(0), entry(-2), entry('300'), entry(Number.MAX_SAFE_INTEGER + 1), { v: 100, name: null }, { v: 101, name: '<script>', tag: { bad: true }, t: 'bad' }],
      unknownGame: [entry(900)],
    }));
  });
  await open(page);
  expect(await page.evaluate(() => ARCADE.LB.board('pinball').map(e => e.v))).toEqual([15, 14, 13, 12, 11, 10, 9, 8, 7, 6]);
  expect(await page.evaluate(() => ARCADE.LB.board('chess').map(e => e.v))).toEqual([16, 17, 18, 19, 20, 21, 22, 23, 24, 25]);
  expect(await page.evaluate(() => ARCADE.LB.board('poker'))).toEqual([{ v: 101, name: 'SCR', tag: '', t: 0 }]);
  expect(await page.evaluate(() => ARCADE.LB.board('unknownGame'))).toEqual([]);
  expect(await page.evaluate(() => [ARCADE.LB.rankOf('pinball', 5), ARCADE.LB.rankOf('pinball', 99), ARCADE.LB.rankOf('chess', 26), ARCADE.LB.rankOf('chess', 3)])).toEqual([-1, 0, -1, 0]);
});

test('invalid scores and inherited object keys cannot open an entry or notify the host', async ({ page }) => {
  const frame = await embedded(page);
  await frame.evaluate(() => {
    for (const value of [0, -1, NaN, Infinity, -Infinity, '5', null, {}, Number.MAX_SAFE_INTEGER + 1]) ARCADE.LB.check('ttt', value);
    for (const game of ['unknown', '__proto__', 'constructor', 'toString']) {
      ARCADE.LB.check(game, 10);
      if (ARCADE.LB.rankOf(game, 10) !== -1) throw new Error('Unknown game qualified.');
    }
  });
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => recordMessages.filter(m => ['win', 'record'].includes(m.ev)))).toEqual([]);
  await expect(frame.locator('#lbModal')).toBeHidden();
  expect(await frame.evaluate(() => ARCADE.LB.debug.forcePending())).toBeNull();
});

test('closing queued entries dismisses them cleanly and a later game can open its record', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { ARCADE.LB.check('ttt', 2); ARCADE.LB.check('pinball', 500); });
  await expect(page.locator('#lbEntryTitle')).toContainText('TIC TAC SLAM');
  await page.locator('#lbClose').click();
  expect(await page.evaluate(() => ARCADE.LB.debug.forcePending())).toBeNull();
  await expect(page.locator('#lbModal')).toBeHidden();
  await page.evaluate(() => ARCADE.LB.check('chess', 8));
  await expect(page.locator('#lbModal')).toBeVisible();
  await expect(page.locator('#lbEntryTitle')).toContainText('JUGGALO CHESS');
  await page.locator('#lbInitials').fill('NEW'); await page.locator('#lbSaveBtn').click();
  expect(await page.evaluate(() => [ARCADE.LB.board('ttt').length, ARCADE.LB.board('pinball').length, ARCADE.LB.board('chess').length])).toEqual([0, 0, 1]);
});

test('skip advances one queued entry and saving still works when storage is unavailable', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    Storage.prototype.setItem = function () { throw new DOMException('Storage disabled', 'SecurityError'); };
    ARCADE.LB.check('racing', 100); ARCADE.LB.check('poker', 200);
  });
  await page.locator('#lbSkipBtn').click();
  await expect(page.locator('#lbEntryTitle')).toContainText('BIG MONEY RUSTLAS POKER');
  await page.locator('#lbInitials').fill('WIN'); await page.locator('#lbSaveBtn').click();
  expect(await page.evaluate(() => ARCADE.LB.board('racing'))).toEqual([]);
  expect(await page.evaluate(() => ARCADE.LB.board('poker').map(e => ({ name: e.name, v: e.v })))).toEqual([{ name: 'WIN', v: 200 }]);
  await expect(page.locator('#lbEntry')).toBeHidden();
});
