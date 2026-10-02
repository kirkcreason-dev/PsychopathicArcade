# Lunacy Unlocked roster artwork

Reused from the supplied Lunacy Unlocked v0.7.0 `dist/assets` folder at the
project owner's request. All 22 wrestlers keep the reviewed frame rectangles,
alpha, foot anchors, `flipX` corrections and optional `drawScale` metadata.
The artwork's existing ownership and licensing remain unchanged.

`source-roster.json`: original fighter/animation metadata.
`manifest.json`: packed coordinates, anchors, animation sequences and stats.
`*.webp`: 0.64-scale, quality 0.93 repacks with four-pixel transparent gutters.

Rebuild: `node scripts/import-rumble.mjs /path/to/lunacy-unlocked/dist/assets`
Embed existing files: `node scripts/import-rumble.mjs --embed`

Do not apply color-key removal or recut these sheets on a fixed-size grid.
