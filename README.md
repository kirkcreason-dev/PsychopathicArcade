# Psychopathic Arcade — published game

Play: https://kirkcreason-dev.github.io/PsychopathicArcade/

This branch contains the tested static build from `codex/juggalo-pool` at `8831d82e3e530a061e9f5469b282a748b46ea034`, merged through PR #14. Juggalo Pool is the seventeenth arcade game, with three CPU opponents, pass-and-play, practice, online versus, touch aiming, power control, called-eight pockets, foul recovery and device-local CPU records. The separate JCWLUNACY website and its badge definitions are unchanged.

Validation: all 457 tests, lint, type checking, source synchronization and the production build passed in GitHub Actions run 41214771707. Phone layouts were checked in Chrome and WebKit, including rotation and embedded play. Physical-phone and cross-network testing remain separate field checks.

GitHub Pages publishes the root of `gh-pages`. Build source with `npm run build`, replace the static files with `dist/`, retain `.nojekyll`, update `version.json`, and keep `public/game.html` identical to `game.html` for existing links. Do not merge this generated branch into source branches.
