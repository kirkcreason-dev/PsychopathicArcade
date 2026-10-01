# Psychopathic Arcade

Eleven browser games with the original artwork, synthesized audio, CPU opponents,
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
`npm run check:game` validates both inline scripts, which Vite otherwise copies
without checking. Keep the bundled chess engine's license intact.

## Reliability update

- Restarting games cancels old endings, bonus sequences, promotion choices, and
  queued CPU turns. Checkers locks input throughout multi-jumps and validates
  received moves, including promotions.
- Blackjack finds the best legal ace/joker total and settles each stand once.
  Solitaire undo restores its Vegas balance and rejects face-down/invalid moves.
  Juggalo 31 recognizes a dealt 31 and rejects out-of-turn/after-round actions.
- Air hockey resumes after menu navigation and bounds paddle momentum. Runner
  swipes handle cancelled pointers; pinball releases controls on focus loss.
- Solo clocks and the Faygo speed timer stop advancing while their game is hidden.
  Faygo's clock survives full-column clicks; changing modes starts a fresh round.
- Invalid stored score types cannot prevent startup. Sound preferences persist.
  Keyboard shortcuts respect help dialogs. Browser zoom and reduced motion work.
- Phone layouts keep game controls with the playfield and condense solitaire
  statistics. Badge notices stay hidden until earned.

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
