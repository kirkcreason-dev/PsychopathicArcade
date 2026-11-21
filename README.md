# Psychopathic Arcade — published game

Play: https://kirkcreason-dev.github.io/PsychopathicArcade/

This twenty-game release adds Road Riot, a combat racer with three rival duels, and standard Xbox/PlayStation controller support for JCW Rumble and Ladder Wars. It also includes the previously merged Rustlas Poker and eight-player Road to the Show updates. Source: `779ef1730aa4f338b9efbd0b20ad0f64de657da6`, merged through https://github.com/kirkcreason-dev/PsychopathicArcade/pull/16.

Validation: 986 tests passed, 9 intentionally skipped, 0 failed in GitHub Actions run https://github.com/kirkcreason-dev/PsychopathicArcade/actions/runs/44954673051. Lint, type checking, standalone-source synchronization and production builds passed. Seventeen additional controller checks passed in the browser using simulated standard gamepads. Physical controller hardware remains a separate field check.

GitHub Pages publishes the root of `gh-pages`. Build source with `npm run build`, replace the static files with `dist/`, retain `.nojekyll`, update `version.json`, and keep `public/game.html` identical to `game.html` for existing links. Do not merge this generated branch into source branches.
