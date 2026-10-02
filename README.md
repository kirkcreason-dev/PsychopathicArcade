# Psychopathic Arcade — published game

Play through the JCW Lunacy arcade: https://jcwlunacy.net/arcade.html

This branch contains the tested static build from `codex/wicked-chicken` at `e624f522ac1d281d5feb8431c6840963c1d64a35`. The fourteen-game arcade includes Chicken Huntin’s wicked-clown carnival artwork and the latest locker-badge updates. Carnival Claw’s 540 collectibles and the existing JCW Lunacy access gate are preserved.

GitHub Pages publishes the root of `gh-pages`. For future releases, build the source with `npm run build` and replace this branch’s static files with the contents of `dist/`. Keep `.nojekyll`, update `version.json`, and retain `public/game.html` as a copy of `game.html` so existing links continue working. Do not merge this generated branch into the source branches.
