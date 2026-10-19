# Psychopathic Arcade — published game

Play: https://kirkcreason-dev.github.io/PsychopathicArcade/

This branch contains the tested static build from `codex/big-foot-roster` at `b2d38277d62a2c4d1dfaea8f17948bae61e94f19`. Big Foot joins JCW Rumble and Ladder Wars as the 22nd playable wrestler, with reviewed transparent artwork, kicks, a one-handed chokeslam, climbing, and proper prone poses. Solo and versus play, device-local records, all sixteen games, and 530 Carnival Claw collectibles are included. The separate JCWLUNACY website and its badge definitions are unchanged.

Validation: all 344 browser tests, lint, type checking and the production build passed in GitHub Actions.

GitHub Pages publishes the root of `gh-pages`. Build source with `npm run build`, replace the static files with `dist/`, retain `.nojekyll`, update `version.json`, and keep `public/game.html` identical to `game.html` for existing links. Do not merge this generated branch into source branches.
