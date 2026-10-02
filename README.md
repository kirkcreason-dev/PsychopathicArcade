# Psychopathic Arcade — published game

Play through the JCW Lunacy arcade: https://jcwlunacy.net/arcade.html

This branch contains the tested static build from `codex/chicken-huntin` at `c4aebcf82339d5cdd20a84faabf005ee3004fac7`. Chicken Huntin’ adds the fourteenth game, with running and flying chickens, golden time bonuses and Feather Frenzy. Carnival Claw’s 540 collectibles and the latest locker-badge updates are included. The existing JCW Lunacy access gate is preserved.

GitHub Pages publishes the root of `gh-pages`. For future releases, build the source with `npm run build` and replace this branch’s static files with the contents of `dist/`. Keep `.nojekyll`, update `version.json`, and retain `public/game.html` as a copy of `game.html` so existing links continue working. Do not merge this generated branch into the source branches.
