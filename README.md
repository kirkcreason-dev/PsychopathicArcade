# Psychopathic Arcade — published game

Play through the JCW Lunacy arcade: https://jcwlunacy.net/arcade.html

This branch contains the tested static build from `codex/ladder-wars` at `43f694fb513c58d173bfad9ca4157f4849ad1d04`. The sixteen-game arcade adds Ladder Wars with all 22 original Lunacy Unlocked wrestlers, refines Rumble targeting and throws, and connects five new multiplayer modes. All 280 browser checks passed. Records save on each device. Existing games, 540 Carnival Claw collectibles, locker hooks and the JCW access gate are preserved.

GitHub Pages publishes the root of `gh-pages`. Build source with `npm run build`, replace the static files with `dist/`, retain `.nojekyll`, update `version.json`, and keep `public/game.html` identical to `game.html` for existing links. Do not merge this generated branch into source branches.
