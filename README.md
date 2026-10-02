# Psychopathic Arcade — published game

Play through the JCW Lunacy arcade: https://jcwlunacy.net/arcade.html

This branch contains the tested static build from `codex/carnival-shooter` at `647c890fef76ee065cbdebb527546d719dd6a03b`. Carnival Crossfire adds the twelfth game. All 135 browser checks passed locally; the existing JCW Lunacy access gate is preserved.

GitHub Pages publishes the root of `gh-pages`. For future releases, build the source with `npm run build` and replace this branch’s static files with the contents of `dist/`. Keep `.nojekyll`, update `version.json`, and retain `public/game.html` as a copy of `game.html` so existing links continue working. Do not merge this generated branch into the source branches.
