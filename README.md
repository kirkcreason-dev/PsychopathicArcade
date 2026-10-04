# Psychopathic Arcade — published game

Play through the JCW Lunacy arcade: https://jcwlunacy.net/arcade.html

This branch contains the tested static build from `codex/sally-facade-facing` at `6b6218e5febaf3f76035c262efdb1a3fb9cf23fa`. Sally Boy and Facade face their movement in Rumble and Ladder Wars. All six run frames per wrestler are normalized, and the importer retains the correction. Standing and attack animations keep their existing direction. All 314 browser checks passed. The Ladder Wars phone layout, sixteen-game arcade, multiplayer, device-local records, 530 Carnival Claw collectibles, 21 active wrestlers, locker hooks and JCW access gate are preserved.

GitHub Pages publishes the root of `gh-pages`. Build source with `npm run build`, replace the static files with `dist/`, retain `.nojekyll`, update `version.json`, and keep `public/game.html` identical to `game.html` for existing links. Do not merge this generated branch into source branches.
