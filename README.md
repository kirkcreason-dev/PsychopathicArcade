# Psychopathic Arcade — published game

Play through the JCW Lunacy arcade: https://jcwlunacy.net/arcade.html

This branch contains the tested static build from `codex/jcw-rumble` at `8bb398c039db2f94801ff734b13fc7cd9e242de5`. The fifteen-game arcade adds JCW Rumble with the 22 original Lunacy Unlocked wrestlers. All 251 browser checks passed. Existing games, 540 Carnival Claw collectibles, locker hooks and the JCW access gate are preserved.

GitHub Pages publishes the root of `gh-pages`. Build source with `npm run build`, replace the static files with `dist/`, retain `.nojekyll`, update `version.json`, and keep `public/game.html` identical to `game.html` for existing links. Do not merge this generated branch into source branches.
