# Psychopathic Arcade — published game

Play: https://kirkcreason-dev.github.io/PsychopathicArcade/

This branch contains the tested static build from `codex/camper-freeze` at `228015768a7edeb7a94fcc08f1ded52269882d9c`, based on main with the Gathering Camper welcome-gate freeze repaired. All 109 browser checks passed locally.

GitHub Pages publishes the root of `gh-pages`. For future releases, build the source with `npm run build` and replace this branch's static files with the contents of `dist/`. Keep `.nojekyll`, update `version.json`, and retain `public/game.html` as a copy of `game.html` so existing direct links continue working. Do not merge this generated branch into the source branches.
