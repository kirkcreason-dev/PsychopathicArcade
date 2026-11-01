import { test, expect } from '@playwright/test';

// Exercise real local RTC channels. WebKit's local ICE support is covered by
// the isolated transport tests; this multi-browser integration uses Chrome.
test.skip(({ browserName }) => browserName !== 'chromium', 'Eight real local peers run in Chrome.');
const rides = ['violent-j', 'shaggy-2-dope', 'dani-mo', '2-tuff-tony', 'mad-man-pondo', 'big-foot', 'violent-j', 'shaggy-2-dope'];

async function createPlayers(browser, baseURL, count) {
  const pages = [], errors = [];
  for (let i = 0; i < count; i++) {
    const page = await browser.newPage(); pages.push(page);
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(baseURL + '/game.html');
    await page.waitForFunction(() => window.RACING_READY);
    await page.evaluate(async () => {
      ARCADE.Sound.on = false;
      const RTC = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends RTC { constructor() { super({ iceServers: [] }); } };
      ARCADE.showScreen('racing'); await ARCADE.RACING.loadAssets();
    });
  }
  return { pages, host: pages[0], guests: pages.slice(1), errors };
}
async function connect(host, guest) {
  const offer = await host.evaluate(() => RACING_PARTY.createInvite());
  const reply = await guest.evaluate(code => RACING_PARTY.acceptInvite(code), offer);
  await host.evaluate(code => RACING_PARTY.acceptReply(code), reply);
  await guest.waitForFunction(() => RACING_PARTY.state.members.length >= 2 && ARCADE.RACING.netState()?.synced);
  const seat = await guest.evaluate(() => RACING_PARTY.state.seat);
  await host.waitForFunction(seat => RACING_PARTY.state.members.some(m => m.seat === seat && m.connected), seat);
  return seat;
}
async function ready(players) {
  for (const page of players) expect(await page.evaluate(() => ARCADE.RACING.ready())).toBe(true);
  await players[0].waitForFunction(() => ARCADE.RACING.netState()?.canLaunch);
}
async function launch(host, players, capture = false) {
  const initial = await host.evaluate(() => {
    const accepted = ARCADE.RACING.launch();
    return { accepted, state: ARCADE.RACING.state };
  });
  expect(initial.accepted).toBe(true); expect(initial.state.phase).toBe('countdown');
  expect(initial.state.racers.filter(r => r.human).every(r => r.z === 0 && r.speed === 0)).toBe(true);
  for (const page of players) await page.waitForFunction(() => ARCADE.RACING.state.started && ARCADE.RACING.state.phase === 'countdown');
  if (capture) await host.screenshot({ path: test.info().outputPath('eight-player-grid.png') });
  await host.evaluate(() => { for (let i = 0; i < 13; i++) ARCADE.RACING.debug.advance(.25); });
  for (const page of players) await page.waitForFunction(() => ARCADE.RACING.state.phase === 'racing');
  return initial.state;
}
function world(page) {
  return page.evaluate(() => {
    const s = ARCADE.RACING.state;
    return { phase: s.phase, time: s.time, tick: s.tick, remainder: s.remainder, countdown: s.countdown, racers: s.racers, objects: s.objects, finishOrder: s.finishOrder, events: s.events };
  });
}
async function converge(players) {
  const expected = JSON.stringify(await world(players[0]));
  for (const page of players.slice(1)) await expect.poll(async () => JSON.stringify(await world(page))).toBe(expected);
}
async function key(page, type, key) {
  await page.evaluate(({ type, key }) => document.body.dispatchEvent(new KeyboardEvent(type, { key, code: key, bubbles: true })), { type, key });
}
async function closePlayers(pages) {
  for (const page of pages) { try { await page.close(); } catch {} }
}
async function rejected(page, expression) {
  return page.evaluate(async expression => {
    try { await new Function('return ' + expression)(); return ''; }
    catch (error) { return error.message; }
  }, expression);
}

test('eight real riders choose, ready, launch together, steer their own seats, pause, finish and rematch', async ({ browser, baseURL }) => {
  test.setTimeout(120000);
  const { pages, host, guests, errors } = await createPlayers(browser, baseURL, 8);
  try {
    await host.evaluate(() => RACING_PARTY.host({ manual: true }));
    for (const guest of guests) await connect(host, guest);
    for (let i = 0; i < pages.length; i++) expect(await pages[i].evaluate(id => ARCADE.RACING.choose(id), rides[i])).toBe(true);
    await host.waitForFunction(rides => ARCADE.RACING.netState().members.length === 8 && ARCADE.RACING.netState().members.every((m, i) => m.racerId === rides[i]), rides);
    for (const page of pages) {
      await page.waitForFunction(() => ARCADE.RACING.netState()?.members.length === 8);
      await expect(page.locator('#rcPartyMembers li')).toHaveCount(8);
    }
    expect(await rejected(host, 'RACING_PARTY.createInvite()')).toMatch(/eight|full/i);
    expect(await host.evaluate(() => ARCADE.RACING.launch())).toBe(false);
    expect(await guests[0].evaluate(() => ARCADE.RACING.launch())).toBe(false);
    await ready(pages);
    expect(await host.evaluate(() => ARCADE.RACING.state.started)).toBe(false);
    await expect(host.locator('#rcLaunchBtn')).toBeEnabled();
    const initial = await launch(host, pages, true);
    expect(initial.racers).toHaveLength(8); expect(initial.racers.every(r => r.human)).toBe(true);
    expect(initial.racers.map(r => r.playerSeat)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(initial.racers.map(r => r.racerId)).toEqual(rides);
    expect(await rejected(host, 'RACING_PARTY.createInvite()')).toMatch(/locked|started/i);
    await key(guests[6], 'keydown', 'ArrowLeft');
    await host.waitForFunction(() => ARCADE.RACING.state.racers[7].steer < 0);
    expect(await host.evaluate(() => ARCADE.RACING.state.racers.slice(0, 7).every(r => r.steer === 0))).toBe(true);
    await key(guests[6], 'keyup', 'ArrowLeft');
    await host.waitForFunction(() => Math.abs(ARCADE.RACING.state.racers[7].steer) < .001);
    await host.screenshot({ path: test.info().outputPath('eight-player-race.png') });
    await guests[2].evaluate(() => ARCADE.RACING.pause(true));
    for (const page of pages) await page.waitForFunction(() => ARCADE.RACING.state.paused);
    await converge(pages);
    expect(await host.evaluate(() => ARCADE.RACING.netState().members.every(m => m.paused))).toBe(true);
    const frozen = await world(host);
    for (const page of pages.slice(0, -1)) await page.evaluate(() => ARCADE.RACING.pause(false));
    await host.waitForTimeout(150);
    expect(await host.evaluate(() => ARCADE.RACING.state.paused)).toBe(true); expect(await world(host)).toEqual(frozen);
    await pages.at(-1).evaluate(() => ARCADE.RACING.pause(false));
    for (const page of pages) await page.waitForFunction(() => !ARCADE.RACING.state.paused);
    // The fixture speeds up a complete, normally simulated race only after
    // real remote controls and the shared pause barrier have been exercised.
    const completed = await host.evaluate(() => {
      let firstArrivalWaited = false;
      for (let i = 0; i < 850 && ARCADE.RACING.state.phase !== 'finished'; i++) {
        const s = ARCADE.RACING.state, humans = s.racers.filter(r => r.human), arrived = humans.filter(r => r.finishTime !== null).length;
        if (arrived > 0 && arrived < humans.length) { if (s.phase !== 'racing') throw new Error('Ended before the remaining riders arrived.'); firstArrivalWaited = true; }
        ARCADE.RACING.debug.advanceAll(.25, s.racers.map((_, index) => RACING_RULES.aiInput(s, index)));
      }
      return { state: ARCADE.RACING.state, firstArrivalWaited };
    });
    expect(completed.state.phase).toBe('finished'); expect(completed.firstArrivalWaited).toBe(true);
    expect(completed.state.racers.every(r => r.finishTime !== null && !r.dnf)).toBe(true);
    for (const page of pages) await page.waitForFunction(() => ARCADE.RACING.state.mode === 'finished');
    await converge(pages);
    for (const page of pages) {
      await expect(page.locator('#rcPlacements li')).toHaveCount(8);
      const labels = await page.locator('#rcPlacements li').allTextContents();
      expect(labels.map(text => Number(text.match(/\bP([1-8])\b/)?.[1])).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      const ownSeat = await page.evaluate(() => RACING_PARTY.state.seat);
      expect(labels.filter(text => text.includes('YOU'))).toHaveLength(1);
      expect(labels.find(text => text.includes('YOU'))).toContain('P' + (ownSeat + 1));
      await expect(page.locator('#rcSaveBtn')).toBeHidden();
      expect(await page.evaluate(() => [ARCADE.RACING.state.best, ARCADE.RACING.state.wins, ARCADE.LB.board('racing').length])).toEqual([0, 0, 0]);
    }
    await host.setViewportSize({ width: 390, height: 844 });
    await host.screenshot({ path: test.info().outputPath('eight-player-mobile-results.png') });
    for (const selector of ['#rcPlacements li:last-child', '#rcAgainBtn', '#rcLaunchAgainBtn']) {
      const item = host.locator(selector); await item.scrollIntoViewIfNeeded(); await expect(item).toBeVisible();
      expect(await item.evaluate(el => { const r = el.getBoundingClientRect(), x = Math.max(0, Math.min(innerWidth - 1, r.left + r.width / 2)), y = Math.max(0, Math.min(innerHeight - 1, r.top + r.height / 2)); return r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1 && el.contains(document.elementFromPoint(x, y)); })).toBe(true);
    }
    const previousRound = await host.evaluate(() => ARCADE.RACING.netState().round);
    for (const page of pages.slice(0, -1)) expect(await page.evaluate(() => ARCADE.RACING.ready())).toBe(true);
    expect(await host.evaluate(() => ARCADE.RACING.launch())).toBe(false);
    expect(await pages.at(-1).evaluate(() => ARCADE.RACING.ready())).toBe(true);
    await host.waitForFunction(() => ARCADE.RACING.netState().canLaunch);
    expect(await host.evaluate(() => ARCADE.RACING.state.phase)).toBe('finished');
    const next = await host.evaluate(() => { const accepted = ARCADE.RACING.launch(); return { accepted, s: ARCADE.RACING.state, round: ARCADE.RACING.netState().round }; });
    expect(next.accepted).toBe(true); expect(next.round).toBe(previousRound + 1); expect(next.s.phase).toBe('countdown');
    expect(next.s.finishOrder).toEqual([]); expect(next.s.racers.every(r => r.z === 0 && r.speed === 0 && r.finishTime === null)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await closePlayers(pages); }
});

test('duplicate riders and a vacant room seat retain control ownership, and departure ends the race without an award', async ({ browser, baseURL }) => {
  test.setTimeout(60000);
  const { pages, host, guests, errors } = await createPlayers(browser, baseURL, 3);
  try {
    await host.evaluate(() => RACING_PARTY.host({ manual: true }));
    expect(await connect(host, guests[0])).toBe(1); expect(await connect(host, guests[1])).toBe(2);
    await guests[0].evaluate(() => RACING_PARTY.close('Leaving the lobby.'));
    await host.waitForFunction(() => RACING_PARTY.state.members.length === 2);
    for (const page of [host, guests[1]]) expect(await page.evaluate(() => ARCADE.RACING.choose('big-foot'))).toBe(true);
    await ready([host, guests[1]]);
    const initial = await launch(host, [host, guests[1]]);
    expect(initial.racers.filter(r => r.human).map(r => [r.id, r.playerSeat, r.racerId])).toEqual([[0, 0, 'big-foot'], [1, 2, 'big-foot']]);
    expect(await guests[1].evaluate(() => ARCADE.RACING.state.seat)).toBe(1);
    await key(guests[1], 'keydown', 'ArrowLeft');
    await host.waitForFunction(() => ARCADE.RACING.state.racers[1].steer < 0);
    expect(await host.evaluate(() => ARCADE.RACING.state.racers[0].steer)).toBe(0);
    await key(guests[1], 'keyup', 'ArrowLeft');
    await guests[1].evaluate(() => RACING_PARTY.close('Left the race.'));
    for (const page of [host, guests[1]]) {
      await page.waitForFunction(() => ARCADE.RACING.state.ended);
      await expect(page.locator('#rcResultTitle')).toHaveText('RACE INTERRUPTED');
      await expect(page.locator('#rcSaveBtn')).toBeHidden();
      expect(await page.evaluate(() => [ARCADE.RACING.state.best, ARCADE.RACING.state.wins, ARCADE.LB.board('racing').length])).toEqual([0, 0, 0]);
    }
    expect(await guests[1].evaluate(() => ARCADE.RACING.state.seat)).toBe(1);
    for (const page of [host, guests[1]]) {
      await expect(page.locator('#rcAgainBtn')).toHaveText('NEW SOLO RACE');
      await page.locator('#rcAgainBtn').click();
      expect(await page.evaluate(() => ({ mode: ARCADE.RACING.state.mode, playMode: ARCADE.RACING.state.playMode, seat: ARCADE.RACING.state.seat, humans: ARCADE.RACING.state.racers.filter(r => r.human).length, ended: ARCADE.RACING.state.ended, party: ARCADE.RACING.partyActive() })))
        .toEqual({ mode: 'countdown', playMode: 'solo', seat: 0, humans: 1, ended: false, party: false });
    }
    expect(errors).toEqual([]);
  } finally { await closePlayers(pages); }
});

test('launch cancels an unfinished invite and rejects its late reply without adding a racer', async ({ browser, baseURL }) => {
  test.setTimeout(60000);
  const { pages, host, guests, errors } = await createPlayers(browser, baseURL, 3);
  try {
    await host.evaluate(() => RACING_PARTY.host({ manual: true })); await connect(host, guests[0]);
    const offer = await host.evaluate(() => RACING_PARTY.createInvite());
    const reply = await guests[1].evaluate(offer => RACING_PARTY.acceptInvite(offer), offer);
    expect(await host.evaluate(() => RACING_PARTY.state.pending)).toBe(1);
    await ready([host, guests[0]]); await launch(host, [host, guests[0]]);
    const error = await host.evaluate(async reply => { try { await RACING_PARTY.acceptReply(reply); return ''; } catch (error) { return error.message; } }, reply);
    expect(error).toMatch(/different|expired|cancelled/i);
    expect(await host.evaluate(() => RACING_PARTY.state.members.map(m => m.seat))).toEqual([0, 1]);
    expect(await host.evaluate(() => ARCADE.RACING.state.racers.filter(r => r.human).length)).toBe(2);
    expect(await guests[1].evaluate(() => ARCADE.RACING.state.started)).toBe(false);
    expect(await rejected(host, 'RACING_PARTY.createInvite()')).toMatch(/locked|started/i);
    expect(errors).toEqual([]);
  } finally { await closePlayers(pages); }
});
