# Psychopathic Arcade — published game

Play: https://kirkcreason-dev.github.io/PsychopathicArcade/

This branch contains the tested static build from `codex/arcade-reliability` at `38bf99d174a0f0a8ee4a8d5ae339a5827658b5fe`.

GitHub Pages publishes the root of `gh-pages`. For future releases, build the source with `npm run build` and replace this branch's static files with the contents of `dist/`. Keep `.nojekyll`, update `version.json`, and retain `public/game.html` as a copy of `game.html` so existing direct links continue working. Do not merge this generated branch into the source branches.
