// Import reviewed image-generation atlases into the self-contained game.
// Frame boundaries are explicit gutters, not an assumed equal grid. Never
// color-key black: dark interiors belong to the art, just like bright pixels.
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, 'assets/sprites');
const frames = JSON.parse(await fs.readFile(path.join(directory, 'frames.json'), 'utf8'));
const localChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch(existsSync(localChrome) ? {executablePath:localChrome} : {});
const sprites = {};
try {
  const page = await browser.newPage();
  for (const frame of frames) {
    const source = await fs.readFile(path.join(directory, frame.file));
    const result = await page.evaluate(async ({frame, source}) => {
      const image = new Image(); image.src = source; await image.decode();
      if (image.naturalWidth !== frame.x.at(-1) || image.naturalHeight !== frame.y.at(-1)) {
        throw new Error('Atlas dimensions changed: '+frame.file);
      }
      const atlas = document.createElement('canvas');
      atlas.width = image.naturalWidth; atlas.height = image.naturalHeight;
      const context = atlas.getContext('2d', {willReadFrequently:true});
      context.drawImage(image, 0, 0);
      const out = {};
      const columns = frame.x.length-1;
      if (columns*(frame.y.length-1) !== frame.keys.length) throw new Error('Invalid frame count');
      for (const [index, key] of frame.keys.entries()) {
        const column = index%columns, row = Math.floor(index/columns);
        const x = frame.x[column], y = frame.y[row];
        const width = frame.x[column+1]-x, height = frame.y[row+1]-y;
        const {data} = context.getImageData(x, y, width, height);
        let left = width, right = -1, top = height, bottom = -1;
        for(let py=0;py<height;py++) for(let px=0;px<width;px++) {
          if(data[(py*width+px)*4+3] > 0) {
            left = Math.min(left, px); right = Math.max(right, px);
            top = Math.min(top, py); bottom = Math.max(bottom, py);
          }
        }
        if(right < left) throw new Error('Empty sprite: '+key);
        // Preserve every alpha value and add a clear sampling gutter. This
        // prevents edge clipping and neighboring art when scaled in canvas.
        const padding = 6;
        const scale = Math.min(1, (frame.maxEdge || 320)/Math.max(right-left+1,bottom-top+1));
        const outputWidth = Math.round((right-left+1)*scale);
        const outputHeight = Math.round((bottom-top+1)*scale);
        const tile = document.createElement('canvas');
        tile.width = outputWidth+padding*2;
        tile.height = outputHeight+padding*2;
        tile.getContext('2d').drawImage(atlas, x+left, y+top, right-left+1, bottom-top+1,
          padding, padding, outputWidth, outputHeight);
        out[key] = tile.toDataURL('image/webp', .94);
      }
      return out;
    }, {frame, source:'data:image/png;base64,'+source.toString('base64')});
    Object.assign(sprites, result);
  }
} finally {
  await browser.close();
}
const gamePath = path.join(root, 'public/game.html');
let html = await fs.readFile(gamePath, 'utf8');
const match = html.match(/^ASSETS\.img = (.*);$/m);
if (!match) throw new Error('Game asset registry missing');
const assets = JSON.parse(match[1]);
Object.assign(assets, sprites);
html = html.replace(match[0], 'ASSETS.img = '+JSON.stringify(assets)+';');
await fs.writeFile(gamePath, html);
console.log(`Imported ${Object.keys(sprites).length} padded sprites from ${frames.length} reviewed atlases.`);
