# Psychopathic Arcade — published game

Play through the JCW Lunacy arcade: https://jcwlunacy.net/arcade.html

This branch contains the tested static build from `codex/ladder-thumb-layout` at `745607d11344381561cc17d446b87e851d286a07`. Ladder Wars reserves a visible arena in portrait, separates the landscape thumb controls to bottom left and right, and allows short screens to scroll. Rotation, safe-area spacing, the opening countdown, multiplayer, and pointer controls are covered by the checks. All 310 browser checks passed. The sixteen-game arcade, device-local records, 530 Carnival Claw collectibles, 21 active wrestlers, locker hooks and JCW access gate are preserved.

GitHub Pages publishes the root of `gh-pages`. Build source with `npm run build`, replace the static files with `dist/`, retain `.nojekyll`, update `version.json`, and keep `public/game.html` identical to `game.html` for existing links. Do not merge this generated branch into source branches.
