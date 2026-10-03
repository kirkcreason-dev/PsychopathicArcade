# Psychopathic Arcade — published game

Play through the JCW Lunacy arcade: https://jcwlunacy.net/arcade.html

This branch contains the tested static build from `codex/ladder-phone-fixes` at `f799682858d461feb39f2861669ceeafb74b0ae7`. Ladder Wars keeps phone controls visible in portrait and landscape, opens with a synchronized three-count, and highlights correct ladder placement. Knockdowns settle onto their prone frames and Caleb faces his running direction. All 298 browser checks passed. The sixteen-game arcade, multiplayer, device-local records, 540 Carnival Claw collectibles, locker hooks and JCW access gate are preserved.

GitHub Pages publishes the root of `gh-pages`. Build source with `npm run build`, replace the static files with `dist/`, retain `.nojekyll`, update `version.json`, and keep `public/game.html` identical to `game.html` for existing links. Do not merge this generated branch into source branches.
