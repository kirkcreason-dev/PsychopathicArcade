# Road to the Show runtime artwork

These files are mechanical derivatives of the approved source artwork. The six original rider PNGs and three selected backgrounds remain unchanged. Conversion uses the entire source rectangle: no crop, redraw, masking, threshold cleanup, or compositing.

- Riders: 512 × 512 WebP, quality 0.90, original transparency preserved.
- Backgrounds: 1200 × 600 WebP, quality 0.88, opaque.
- Vector props and UI: embedded directly from the separate original SVG files.
- Total embedded image URIs: approximately 914 KB, below the 2 MiB budget.

Run from the repository root:

```sh
# Convert approved PNGs, embed the files, and check Chrome/WebKit decoding.
node scripts/import-racing-assets.mjs --convert --verify-browser

# Rebuild the byte-exact data module from existing runtime files; no browser needed.
node scripts/import-racing-assets.mjs

# Check source/runtime hashes, file dimensions, byte sizes, and the generated module.
node scripts/import-racing-assets.mjs --check
```

`games/racing-assets.js` defines `RACING_ASSET_DATA` with `manifest`, `riders`, `backgrounds`, and `vectors`. The image maps contain self-contained data URIs. Background order matches the approved source manifest. The importer does not change `public/game.html`.

The original manifest remains intact inside `RACING_ASSET_DATA.manifest`. Use `manifest.runtime.riders[id]` and `manifest.runtime.backgrounds[index]` for actual decoded runtime dimensions. `manifest.vectors.assets` contains SVG metadata. Rider anchors remain normalized to the complete, uncropped image; draw at `x - anchor.x * width`, `y - anchor.y * height`. Give `drawImage` explicit destination dimensions for consistent SVG rendering in WebKit.

The runtime manifest records source/runtime SHA-256 hashes, measured alpha bounds at the source threshold, padding, and decoded-memory sizes. During conversion, every WebP alpha pixel is compared with the downsampled source canvas. The alpha difference must be zero. Near-invisible alpha speckles remain untouched; visible bounds and anchors never imply a crop.

Conversion depends on the browser's WebP encoder version, recorded in the manifest. Normal packaging and `--check` are deterministic for the committed runtime bytes and do not re-encode files.
