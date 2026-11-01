// Mechanical image conversion and deterministic embedding. Approved sources stay untouched.
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtimeDir = 'assets/racing/runtime';
const runtimeFile = `${runtimeDir}/manifest.json`;
const output = 'games/racing-assets.js';
const args = new Set(process.argv.slice(2));
const supported = new Set(['--convert', '--check', '--verify-browser']);
for (const arg of args) if (!supported.has(arg)) throw new Error(`Unknown option: ${arg}`);
if (args.has('--convert') && args.has('--check')) throw new Error('--convert and --check are mutually exclusive.');
const read = file => fs.readFile(path.join(root, file));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceBytes = await read('assets/racing/manifest.json');
const source = JSON.parse(sourceBytes);
const vectorBytes = await read(source.art.vectorManifest);
const vectorManifest = JSON.parse(vectorBytes);
const uri = (type, bytes) => `data:${type};base64,${bytes.toString('base64')}`;
const config = { rider: { width: 512, height: 512, quality: .9 }, background: { width: 1200, height: 600, quality: .88 } };
const sourceImages = [
  ...source.racers.map(r => ({ id: r.id, kind: 'rider', source: r.sprite, anchor: r.sprite.anchor })),
  ...source.backgrounds.map(b => ({ id: b.id, kind: 'background', source: b, horizon: b.horizon })),
];
if (sourceImages.length !== 9 || source.racers.length !== 6 || vectorManifest.assets.length !== 20) throw new Error('Expected the approved six riders, three backgrounds, and twenty vectors.');
for (const item of sourceImages) {
  if (!/^[a-z0-9-]+$/.test(item.id)) throw new Error(`Invalid asset id: ${item.id}`);
  const bytes = await read(item.source.src);
  if (hash(bytes) !== item.source.sha256) throw new Error(`Approved source hash changed: ${item.source.src}`);
  item.bytes = bytes;
}

// Inspect the WebP container without a browser dependency in normal build/check mode.
function dimensions(bytes) {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error('Invalid WebP container.');
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const tag = bytes.toString('ascii', offset, offset + 4), size = bytes.readUInt32LE(offset + 4), data = offset + 8;
    if (data + size > bytes.length) throw new Error('Truncated WebP chunk.');
    if (tag === 'VP8X' && size >= 10) return { width: bytes.readUIntLE(data + 4, 3) + 1, height: bytes.readUIntLE(data + 7, 3) + 1 };
    if (tag === 'VP8 ' && size >= 10 && bytes.subarray(data + 3, data + 6).equals(Buffer.from([0x9d, 0x01, 0x2a]))) return { width: bytes.readUInt16LE(data + 6) & 0x3fff, height: bytes.readUInt16LE(data + 8) & 0x3fff };
    if (tag === 'VP8L' && size >= 5 && bytes[data] === 0x2f) return { width: (bytes.readUInt32LE(data + 1) & 0x3fff) + 1, height: ((bytes.readUInt32LE(data + 1) >>> 14) & 0x3fff) + 1 };
    offset = data + size + (size & 1);
  }
  throw new Error('Missing WebP dimension header.');
}

async function launchChrome() {
  const { chromium } = await import('@playwright/test');
  const installed = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  return chromium.launch(existsSync(installed) ? { executablePath: installed, headless: true } : { headless: true });
}

if (args.has('--convert')) {
  const browser = await launchChrome();
  const runtime = {
    version: 1,
    sourceManifestSha256: hash(sourceBytes),
    vectorManifestSha256: hash(vectorBytes),
    conversion: { method: 'Canvas downsample and WebP encoding only; full source rectangle, unchanged composition and alpha.', engine: await browser.version(), config },
    riders: {}, backgrounds: [],
  };
  try {
    const page = await browser.newPage();
    await fs.mkdir(path.join(root, runtimeDir), { recursive: true });
    for (const item of sourceImages) {
      const target = config[item.kind];
      if (item.source.width / item.source.height !== target.width / target.height) throw new Error(`Refusing aspect-ratio change: ${item.id}`);
      const converted = await page.evaluate(async ({ src, target, alphaThreshold }) => {
        const image = new Image(); image.src = src; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = target.width; canvas.height = target.height;
        const ctx = canvas.getContext('2d', { alpha: true });
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const downsampled = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const encoded = canvas.toDataURL('image/webp', target.quality);
        if (!encoded.startsWith('data:image/webp;base64,')) throw new Error('Browser does not support WebP encoding.');
        // Inspect the encoded image rather than the uncompressed canvas.
        const result = new Image(); result.src = encoded; await result.decode();
        ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(result, 0, 0, canvas.width, canvas.height);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let transparent = 0, opaque = 0, partial = 0, solid = 0, maxDownsampleAlphaDifference = 0;
        const bounds = threshold => {
          let l = canvas.width, t = canvas.height, r = -1, b = -1;
          for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) if (pixels[(y * canvas.width + x) * 4 + 3] >= threshold) { l = Math.min(l, x); t = Math.min(t, y); r = Math.max(r, x); b = Math.max(b, y); }
          return r < 0 ? null : { x: l, y: t, w: r - l + 1, h: b - t + 1 };
        };
        for (let i = 3; i < pixels.length; i += 4) { if (pixels[i] === 0) transparent++; else if (pixels[i] === 255) opaque++; else partial++; if (pixels[i] >= 250) solid++; }
        for (let i = 3; i < pixels.length; i += 4) maxDownsampleAlphaDifference = Math.max(maxDownsampleAlphaDifference, Math.abs(pixels[i] - downsampled[i]));
        return { encoded, width: result.naturalWidth, height: result.naturalHeight, alphaBounds: bounds(alphaThreshold), rawAlphaBounds: bounds(1), alpha: { transparent, opaque, partial, solid, maxDownsampleAlphaDifference } };
      }, { src: uri('image/png', item.bytes), target, alphaThreshold: source.art.alphaBoundsThreshold });
      const bytes = Buffer.from(converted.encoded.split(',')[1], 'base64');
      const src = `${runtimeDir}/${item.id}.webp`, bounds = converted.alphaBounds;
      if (converted.alpha.maxDownsampleAlphaDifference !== 0) throw new Error(`WebP encoder altered downsampled alpha: ${item.id}`);
      if (item.kind === 'rider' && (!converted.alpha.transparent || !converted.alpha.solid || !bounds || bounds.x === 0 || bounds.y === 0 || bounds.x + bounds.w === target.width || bounds.y + bounds.h === target.height)) throw new Error(`Runtime rider transparency/clipping check failed: ${item.id}`);
      if (item.kind === 'background' && converted.alpha.transparent + converted.alpha.partial !== 0) throw new Error(`Runtime background is not opaque: ${item.id}`);
      await fs.writeFile(path.join(root, src), bytes);
      const meta = {
        id: item.id, src, width: converted.width, height: converted.height,
        bytes: bytes.length, sha256: hash(bytes), mime: 'image/webp', quality: target.quality,
        decodedBytes: target.width * target.height * 4, alphaBounds: bounds, rawAlphaBounds: converted.rawAlphaBounds,
        alpha: converted.alpha,
        padding: { left: bounds.x, top: bounds.y, right: target.width - bounds.x - bounds.w, bottom: target.height - bounds.y - bounds.h },
        ...(item.anchor ? { anchor: item.anchor } : { horizon: item.horizon }),
        original: { src: item.source.src, sha256: item.source.sha256, width: item.source.width, height: item.source.height },
      };
      if (item.kind === 'rider') runtime.riders[item.id] = meta; else runtime.backgrounds.push(meta);
      console.log(`${item.id}: ${target.width}×${target.height}, ${Math.round(bytes.length / 1024)} KB`);
    }
  } finally { await browser.close(); }
  await fs.writeFile(path.join(root, runtimeFile), JSON.stringify(runtime, null, 2) + '\n');
}

const runtime = JSON.parse(await read(runtimeFile));
if (runtime.sourceManifestSha256 !== hash(sourceBytes) || runtime.vectorManifestSha256 !== hash(vectorBytes)) throw new Error('Approved manifests changed. Review changes, then run import-racing-assets.mjs --convert.');
const data = { manifest: { ...source, runtime, vectors: vectorManifest }, riders: {}, backgrounds: [], vectors: {} };
let rasterBytes = 0, embeddedBytes = 0;
for (const item of sourceImages) {
  const meta = item.kind === 'rider' ? runtime.riders[item.id] : runtime.backgrounds.find(b => b.id === item.id);
  if (!meta || meta.src !== `${runtimeDir}/${item.id}.webp`) throw new Error(`Runtime metadata missing: ${item.id}`);
  const bytes = await read(meta.src), target = config[item.kind], size = dimensions(bytes);
  if (hash(bytes) !== meta.sha256 || bytes.length !== meta.bytes || size.width !== target.width || size.height !== target.height || meta.width !== target.width || meta.height !== target.height || meta.original.sha256 !== item.source.sha256) throw new Error(`Runtime artifact changed: ${item.id}. Run --convert.`);
  if (item.anchor && (meta.anchor.x !== item.anchor.x || meta.anchor.y !== item.anchor.y)) throw new Error(`Original placement anchor was changed: ${item.id}`);
  const value = uri('image/webp', bytes);
  if (item.kind === 'rider') data.riders[item.id] = value; else data.backgrounds.push(value);
  rasterBytes += bytes.length; embeddedBytes += value.length;
}
for (const vector of vectorManifest.assets) {
  const bytes = await read(`assets/racing/vectors/${vector.file}`);
  const text = bytes.toString('utf8');
  if (/<(?:script|image|foreignObject)\b|\bon\w+\s*=|(?:href|src)\s*=\s*["'](?:https?:|\/\/)/i.test(text)) throw new Error(`Vector contains an external or active resource: ${vector.id}`);
  const value = uri('image/svg+xml', bytes);
  data.vectors[vector.id] = value; embeddedBytes += value.length;
}
if (embeddedBytes > 2 * 1024 * 1024) throw new Error(`Embedded racing imagery exceeds the 2 MiB budget: ${embeddedBytes} bytes.`);
const block = '// Generated by scripts/import-racing-assets.mjs. Approved originals remain under assets/racing/.\n' +
  '// manifest.runtime contains decoded dimensions; source metadata and normalized anchors are preserved.\n' +
  'const RACING_ASSET_DATA = ' + JSON.stringify(data) + ';\n';
if (args.has('--check')) {
  if ((await read(output)).toString('utf8') !== block) throw new Error(`Racing data is out of sync. Run node scripts/import-racing-assets.mjs.`);
} else await fs.writeFile(path.join(root, output), block);
console.log(`Racing asset package ${args.has('--check') ? 'verified' : 'written'}: 29 images; ${rasterBytes} raster bytes; ${embeddedBytes} embedded URI bytes.`);

if (args.has('--verify-browser')) {
  const { webkit } = await import('@playwright/test');
  const inputs = [
    ...source.racers.map(r => ({ id: r.id, uri: data.riders[r.id], meta: runtime.riders[r.id], type: 'rider' })),
    ...runtime.backgrounds.map((b, i) => ({ id: b.id, uri: data.backgrounds[i], meta: b, type: 'background' })),
    ...vectorManifest.assets.map(v => ({ id: v.id, uri: data.vectors[v.id], meta: v, type: 'vector' })),
  ];
  for (const engine of ['Chrome', 'WebKit']) {
    const browser = engine === 'Chrome' ? await launchChrome() : await webkit.launch({ headless: true });
    try {
      const page = await browser.newPage();
      for (const input of inputs) {
        const info = await page.evaluate(async input => {
          const image = new Image(); image.src = input.uri; await image.decode();
          const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
          const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          let transparent = 0, partial = 0, opaque = 0, solid = 0;
          for (let i = 3; i < pixels.length; i += 4) { if (pixels[i] === 0) transparent++; else if (pixels[i] === 255) opaque++; else partial++; if (pixels[i] >= 250) solid++; }
          return { width: image.naturalWidth, height: image.naturalHeight, transparent, partial, opaque, solid };
        }, input);
        if (info.width !== input.meta.width || info.height !== input.meta.height) throw new Error(`${engine}: decoded dimensions differ for ${input.id}`);
        if (input.type === 'rider' && (!info.transparent || !info.solid)) throw new Error(`${engine}: missing rider alpha in ${input.id}`);
        if (input.type === 'background' && (info.transparent || info.partial)) throw new Error(`${engine}: background alpha in ${input.id}`);
      }
      console.log(`${engine}: all 29 embedded images decode at the expected dimensions; rider alpha and opaque backgrounds verified.`);
    } finally { await browser.close(); }
  }
}
