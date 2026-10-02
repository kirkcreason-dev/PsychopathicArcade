# Psychopathic Arcade — published game

Play through the JCW Lunacy arcade: https://jcwlunacy.net/arcade.html

This branch contains the tested static build from `codex/carnival-claw` at `5575cb01d0e66f75b2bd5e314ee0a40ceb5814cd`. Carnival Claw adds the thirteenth game with 540 saved collectibles across 108 roster sets. The existing JCW Lunacy access gate is preserved.

GitHub Pages publishes the root of `gh-pages`. For future releases, build the source with `npm run build` and replace this branch’s static files with the contents of `dist/`. Keep `.nojekyll`, update `version.json`, and retain `public/game.html` as a copy of `game.html` so existing links continue working. Do not merge this generated branch into the source branches.
