# Psychopathic Arcade — published game

Play through the JCW Lunacy arcade: https://jcwlunacy.net/arcade.html

This branch contains the tested static build from `codex/ladder-achievements-roster` at `97f5f80f1cc83e42558613d78bf5cd90f26e8ec8`. Vincenzo and Matt Cross face their movement in Rumble and Ladder Wars; Tony and Willie Mack retain the correct direction through every run frame. Abel’s display name is corrected without changing saved IDs. Completed Ladder Wars matches report each player’s grabs, misses, falls, tips and result for 35 locker achievements in the companion JCWLUNACY website update. All 328 browser checks passed. The sixteen-game arcade, mobile controls, multiplayer, device-local records, 530 Carnival Claw collectibles, 21 active wrestlers and JCW access gate are preserved.

GitHub Pages publishes the root of `gh-pages`. Build source with `npm run build`, replace the static files with `dist/`, retain `.nojekyll`, update `version.json`, and keep `public/game.html` identical to `game.html` for existing links. Do not merge this generated branch into source branches.
