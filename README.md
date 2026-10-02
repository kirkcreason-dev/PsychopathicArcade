# Psychopathic Arcade

Thirteen browser games with carnival artwork, synthesized audio, CPU opponents,
local multiplayer, and seven online modes. Open `public/game.html` directly for
local play, or serve the Vite build. No backend is needed for solo/local games.

## Run and check

Requires Node.js 22.12+ (or Node.js 24) and npm.

```sh
npm ci
npm run dev
npm run lint
npm run typecheck
npm test
```

`npm test` builds the production site and runs Playwright against its preview,
including game rules, interrupted rounds, CPU cancellation, score persistence,
keyboard controls, phone layouts, and real two-peer WebRTC matches.
The test server uses port 4713 (`ARCADE_TEST_PORT` can override it) and never
silently reuses another project's server.

On a developer machine Chromium tests use installed Google Chrome. Install
WebKit with `npx playwright install webkit`. In CI, install both engines with
`npx playwright install --with-deps chromium webkit`; CI uses bundled Chromium.

## Deployment

Run `npm run build` and serve **all of `dist/`**, including `game.html`.
Relative paths support deployment at either `/` or a subdirectory. `index.html`
is a thin, titled iframe wrapper. The React starter files in `src/` are retained
but are not the arcade entry point. The Vite build no longer injects an external
editor's script-message handler into the published site.

The executable arcade code and embedded assets live in `public/game.html`.
`npm run check:game` validates the inline scripts, which Vite otherwise copies
without checking. Keep the bundled chess engine's license intact.

## Carnival Claw

The thirteenth game is a wrestling memorabilia claw machine. Aim by dragging or
using the arrow controls, drop the claw, then press Grab (or Space) while the
needle is green. A centred, correctly timed grip always succeeds. Five pulls
make a round; successive wins build a multiplier, and precise grabs earn bonuses.
The claw visibly lowers, closes, lifts, carries, and delivers each prize through
the chute. Pausing or leaving freezes the current pull, including the grip timer.

The catalog includes **540 collectibles: five distinct item types for each of
108 entries** on the JCW Lunacy roster, including teams, crew, and legends. The
roster snapshot is from <https://jcwlunacy.net/#crew>, checked October 1, 2026.
Dani Mo’s belt and The Ring Rat’s pants appear in the opening mixed load. Search
the cabinet and use **Hunt this set** to stock all five of a specific name’s items.
Mixed restocks favor missing items. Prizes save as soon as they reach the chute;
copies are counted separately from unique items and completed five-item sets.

`data/claw-roster.json` is the editable catalog. Keep roster and item-kind IDs
stable so saved collections continue to match. After editing it, run
`node scripts/sync-claw-catalog.mjs` to refresh the copy embedded in the standalone
game. The regular checks reject missing, duplicate or unsynchronized five-item
sets. Item artwork is original, code-native SVG with roster colorways and initials;
the game loads no remote artwork and bounds its decoded-image cache.

`tests/claw.spec.js` checks all 540 illustrations, every roster set, full offline
rounds, grip timing, misses, scoring, phone layout, interrupted deliveries, search,
restart, and immediate collection persistence in Chromium and WebKit.

## Carnival Crossfire

The twelfth game is a 60-second carnival target shooter. Tap or click moving
Joker Card targets, aim for bullseyes, and avoid the red bombs. Three waves
increase the pace. Every three consecutive hits raises the combo up to ×4;
eight unlock six seconds of unlimited ammo and double scoring. Gold targets,
six-shot magazines, five score medals, an immediate replay button, and saved
personal bests give each round a clear score to chase.

Arrow keys aim, Space fires, R reloads, and P/Escape pauses. The clock, targets,
frenzy and reload freeze on focus loss, menu navigation, or opening records.
The cabinet uses a cached canvas background and reuses embedded Joker art;
no extra downloads are required during play. Local records are submitted from
the result screen. The existing JCW Lunacy access gate remains in place.

`tests/shooter.spec.js` covers phone hit coordinates and layout, scoring,
reloads, frenzy, keyboard input, interrupted play, score persistence, and a
complete offline round in Chromium and WebKit.

## Reliability update

- Restarting games cancels old endings, bonus sequences, promotion choices, and
  queued CPU turns. Checkers locks input throughout multi-jumps and validates
  received moves, including promotions.
- Blackjack finds the best legal ace/joker total and settles each stand once.
  Solitaire undo restores its Vegas balance and rejects face-down/invalid moves.
  Juggalo 31 recognizes a dealt 31 and rejects out-of-turn/after-round actions.
- Air hockey resumes after menu navigation and bounds paddle momentum. Runner
  swipes handle cancelled pointers; pinball releases controls on focus loss.
- Solo clocks and the Joker Card Four speed timer stop advancing while hidden.
  Its clock survives full-column clicks; changing modes starts a fresh round.
- Invalid stored score types cannot prevent startup. Sound preferences persist.
  Keyboard shortcuts respect help dialogs. Browser zoom and reduced motion work.
- Phone layouts keep game controls with the playfield and condense solitaire
  statistics. Badge notices stay hidden until earned.

## Sprite and Gathering Camper update

Repaired 52 sprites, including the Camper selection icon/logo, 25 campground
objects, checker tokens, pickups and three Joker Card pucks. The replacement art
keeps opaque dark interiors and transparent margins. Broken text-button cuts and
score plates now use live text. Visible beverage branding has been replaced with
Joker Card art; internal game and storage IDs remain compatible.

Camper caches its scenery, draws one continuous horizon, and uses a fixed
simulation step. Touch controls respond on press and swipes act before release.
Cleared obstacles resolve once, fatal hits stop scoring, and focus loss pauses
the run. Rows leave a reachable lane and their spacing grows with speed.

Source PNGs, reviewed frame boundaries and generation prompts are in
`assets/sprites/`. Run `node scripts/import-sprites.mjs` to rebuild the embedded
WebP sprites after changing those sources. This preserves alpha rather than
treating dark object pixels as background. The exported game remains a single
self-contained HTML file.

Local 4× CPU-throttled Chromium sampling (390px viewport, 2× pixel ratio) measured
median simulation/draw work of 1.4ms before and 1.0ms after; p95 was 2.4ms and
1.8ms. This is a local rendering-cost comparison, not a guaranteed device FPS.

## Online play and test limits

Invite-code multiplayer uses ordered WebRTC data channels. Quick matchmaking
also relies on third-party public MQTT brokers. The built-in ICE configuration
uses public STUN servers and **does not include a TURN relay**; restrictive
networks may prevent connections. Failed invite connections now time out with
recovery instructions. Public broker availability and cross-network connectivity
are not guaranteed by the automated suite.

All seven online games are tested with real Chromium peers on the same machine,
without public brokers or STUN. Local game flows and layouts are also tested in
Playwright WebKit. WebKit peer connections in the macOS test runner require public STUN rather
than only mDNS host candidates, so those network-dependent checks are opt-in:
`ARCADE_NETWORK_TESTS=1 npm test`. The default suite stays independent of public
servers. Real Safari/iOS hardware and cross-network online play still need field
testing.

The suite uses the existing `window.ARCADE` hooks to construct hard-to-reach rule
and restart cases, alongside actual pointer/keyboard interactions. It does not
establish that every game is defect-free.
