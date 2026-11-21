import { expect, test } from '@playwright/test';

const checkpoints = [5000, 10000, 15000];
let errors;

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/game.html');
  await page.waitForFunction(() => window.ROAD_RIOT_READY);
  await page.evaluate(() => { ARCADE.Sound.on = false; });
  await page.locator('#cardRoadRiot').click();
  await page.waitForFunction(() => ARCADE.ROAD_RIOT.state.loaded);
});

test.afterEach(() => expect(errors).toEqual([]));

async function startRace(page, seed) {
  await page.evaluate(seed => {
    const random = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = array => { array.fill(seed); return array; };
    document.getElementById('rrStartBtn').addEventListener('click', () => {
      crypto.getRandomValues = random;
      ARCADE.ROAD_RIOT.pause(true);
    }, { once: true });
  }, seed);
  await page.locator('#rrStartBtn').click();
  await expect(page.locator('#rrResumeBtn')).toBeVisible();
}

// Advance the ordinary physics and controller until a player-visible milestone.
// Keep each racer's actual position crossings to independently check duel times.
async function drive(page, { stopAt = 'finish', checkpoint = 0, brake = false } = {}) {
  return page.evaluate(({ stopAt, checkpoint, brake, checkpoints }) => {
    const game = ARCADE.ROAD_RIOT;
    const events = new Map();
    const crossings = [];
    game.pause(false);
    let state = game.state;
    const reached = () => {
      if (state.phase === 'finished') return true;
      if (stopAt === 'start') return state.time >= .5;
      if (stopAt === 'checkpoint') return state.racers[0].z >= checkpoint;
      if (stopAt === 'rival-win') return state.duels[0].status === 'lost';
      return false;
    };
    for (let i = 0; i < 800 && !reached(); i++) {
      const before = state;
      game.debug.advance(.25, brake ? { brake: true } : ROAD_RIOT_RULES.aiInput(state, 0));
      state = game.state;
      for (const event of state.events) {
        if (event.type === 'duelStart' || event.type === 'duelResult') events.set(event.id, event);
      }
      for (const racer of state.racers) {
        // endRace projects the remaining finish order. Only physical crossings count.
        if (racer.dnf || racer.finishTime !== null && racer.finishTime > state.time + 1e-6) continue;
        for (const flag of checkpoints) {
          if (before.racers[racer.id].z < flag && racer.z >= flag) {
            crossings.push({ actor: racer.id, checkpoint: flag, from: before.time, to: state.time });
          }
        }
      }
    }
    if (!reached()) throw new Error('The requested race milestone was not reached.');
    game.pause(true);
    return {
      state: game.state,
      events: [...events.values()],
      crossings,
      names: state.racers.map(racer => ROAD_RIOT_RULES.roster.find(ride => ride.id === racer.racerId).name),
      score: ROAD_RIOT_RULES.scoreBreakdown(state),
    };
  }, { stopAt, checkpoint, brake, checkpoints });
}

function assertCrossing(time, actor, checkpoint, crossings) {
  const crossing = crossings.find(value => value.actor === actor && value.checkpoint === checkpoint);
  expect(crossing, `Actor ${actor} physically crosses checkpoint ${checkpoint}`).toBeDefined();
  expect(time).toBeGreaterThanOrEqual(crossing.from - 1e-6);
  expect(time).toBeLessThanOrEqual(crossing.to + 1e-6);
}

test('three checkpoint duels follow actual riders and award exactly the earned bonus', async ({ page }) => {
  await startRace(page, 2);
  const samples = [await drive(page, { stopAt: 'start' })];
  for (const checkpoint of checkpoints) {
    const leg = checkpoints.indexOf(checkpoint) + 1;
    const before = samples.at(-1);
    const duel = before.state.duels[leg - 1];
    expect(duel.leg).toBe(leg);
    expect(duel.checkpoint).toBe(checkpoint);
    if (duel.status === 'active') {
      await expect(page.locator('#rrDuel')).toHaveAttribute('data-state', 'active');
      await expect(page.locator('#rrDuelLeg')).toContainText(new RegExp(`${leg}\\s*/\\s*3`));
      await expect(page.locator('#rrRivalGap')).toContainText(before.names[duel.rivalId], { ignoreCase: true });
    }
    samples.push(await drive(page, { stopAt: 'checkpoint', checkpoint }));
  }
  const final = samples.at(-1);
  const crossings = samples.flatMap(sample => sample.crossings);
  const events = new Map(samples.flatMap(sample => sample.events).map(event => [event.id, event]));
  expect(final.state.phase).toBe('finished');
  expect(final.state.racers[0].dnf).toBe(false);
  let earned = 0;
  for (const duel of final.state.duels) {
    expect(['won', 'lost', 'tied']).toContain(duel.status);
    expect(duel.rivalId).toBeGreaterThan(0);
    if (duel.playerCross !== null) assertCrossing(duel.playerCross, 0, duel.checkpoint, crossings);
    if (duel.rivalCross !== null) assertCrossing(duel.rivalCross, duel.rivalId, duel.checkpoint, crossings);
    const result = [...events.values()].filter(event => event.type === 'duelResult' && event.leg === duel.leg);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ rivalId: duel.rivalId, status: duel.status, bonus: duel.bonus });
    const won = duel.playerCross !== null && (duel.rivalCross === null || duel.playerCross < duel.rivalCross - 1e-7);
    expect(duel.bonus).toBe(won ? 250 : 0);
    earned += duel.bonus;
    const row = page.locator(`#rrDuelRecap [data-leg="${duel.leg}"]`);
    await expect(row).toHaveAttribute('data-state', duel.status);
    await expect(row).toContainText(final.names[duel.rivalId], { ignoreCase: true });
    await expect(row).toContainText({ won: 'WIN +250', lost: 'LOSS', tied: 'TIE' }[duel.status]);
  }
  expect(earned).toBe(500);
  expect(final.score.duels).toBe(earned);
  await expect(page.locator('#rrScoreDuels')).toContainText(earned.toLocaleString('en-US'));
  await expect(page.locator('#rrScore')).toHaveText(final.score.total.toLocaleString('en-US'));
  await page.locator('#rrSaveBtn').click();
  await page.locator('#lbInitials').fill('RUN');
  await page.locator('#lbSaveBtn').click();
  expect(await page.evaluate(() => ARCADE.LB.board('riot')[0].v)).toBe(final.score.total);
});

test('a rival can take the flag while the player keeps racing without a loss penalty', async ({ page }) => {
  await startRace(page, 5);
  const lost = await drive(page, { stopAt: 'rival-win', brake: true });
  const first = lost.state.duels[0];
  expect(lost.state.phase).toBe('racing');
  expect(lost.state.racers[0].z).toBeLessThan(5000);
  expect(first).toMatchObject({ status: 'lost', bonus: 0, playerCross: null });
  expect(first.rivalCross).toBeGreaterThan(0);
  expect(lost.state.duels[1].status).toBe('upcoming');
  expect(lost.score.penalty).toBe(0);
  expect(lost.score.duels).toBe(0);
  const timeout = await drive(page, { brake: true });
  expect(timeout.state.racers[0].dnf).toBe(true);
  expect(timeout.state.duels.map(duel => duel.status)).toEqual(['lost', 'expired', 'expired']);
  expect(timeout.score.duels).toBe(0);
  await expect(page.locator('#rrDuelRecap [data-leg]')).toHaveCount(3);
  await expect(page.locator('#rrScoreDuels')).toHaveText('0');
});

test('a timeout preserves a previously won leg and gives no points for later legs', async ({ page }) => {
  await startRace(page, 2);
  const first = await drive(page, { stopAt: 'checkpoint', checkpoint: 5000 });
  expect(first.state.duels[0]).toMatchObject({ status: 'won', bonus: 250 });
  const timeout = await drive(page, { brake: true });
  expect(timeout.state.racers[0].dnf).toBe(true);
  expect(timeout.state.duels.map(duel => duel.bonus)).toEqual([250, 0, 0]);
  expect(timeout.score.duels).toBe(250);
  expect(timeout.score.penalty).toBe(-1200);
  await expect(page.locator('#rrScoreDuels')).toContainText('250');
});

for (const [width, height] of [[320, 568], [667, 375]]) {
  test(`duel target and pause card stay readable at ${width} × ${height}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await startRace(page, 5);
    const first = await drive(page, { stopAt: 'start' });
    const target = first.names[first.state.duels[0].rivalId];
    await expect(page.locator('#rrPauseDuels')).toBeVisible();
    await expect(page.locator('#rrPauseDuels')).toContainText(target, { ignoreCase: true });
    await page.locator('#rrResumeBtn').click();
    await expect(page.locator('#rrDuel')).toHaveAttribute('data-state', 'active');
    await expect(page.locator('#rrRivalGap')).toContainText(target, { ignoreCase: true });
    await expect(page.locator('#rrRivalGap')).toContainText(/LEAD|TRAIL|LEVEL/i);
    const geometry = await page.evaluate(() => {
      const rect = id => document.getElementById(id).getBoundingClientRect();
      const gap = document.getElementById('rrRivalGap');
      const card = rect('rrDuel'), stage = rect('rrCanvas');
      return {
        inRace: card.x >= stage.x && card.y >= stage.y && card.right <= stage.right + 1 && card.bottom <= stage.bottom + 1,
        clipped: gap.scrollWidth > gap.clientWidth + 1,
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
      };
    });
    expect(geometry).toEqual({ inRace: true, clipped: false, overflow: false });
    await page.screenshot({ path: testInfo.outputPath(`road-riot-duel-${width}.png`) });
  });
}
