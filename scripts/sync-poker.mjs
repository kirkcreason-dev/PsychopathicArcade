import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const file = root + 'public/game.html';
let html = await fs.readFile(file, 'utf8');
const before = html;
const parts = [
  ['poker.css', 'STYLE', '</style>'],
  ['poker-card.html', 'CARD', '<!-- POOL CARD START -->'],
  ['poker.html', 'SCREEN', '<!-- POOL SCREEN START -->'],
  ['poker-rules.js', 'RULES', '/* CLAW CATALOG START */'],
  ['poker-ai.js', 'AI', '/* CLAW CATALOG START */'],
  ['poker-renderer.js', 'RENDERER', '/* CLAW CATALOG START */'],
  ['poker.js', 'GAME', '/* CLAW CATALOG START */'],
];
for (const [name, label, anchor] of parts) {
  const content = (await fs.readFile(root + 'games/' + name, 'utf8')).trim();
  const isHTML = name.endsWith('.html');
  const start = isHTML ? `<!-- POKER ${label} START -->` : `/* POKER ${label} START */`;
  const end = isHTML ? `<!-- POKER ${label} END -->` : `/* POKER ${label} END */`;
  const block = start + '\n' + content + '\n' + end;
  if (html.includes(start)) {
    const a = html.indexOf(start), b = html.indexOf(end, a);
    if (b < 0) throw new Error('Missing poker end marker: ' + label);
    html = html.slice(0, a) + block + html.slice(b + end.length);
  } else {
    if (!html.includes(anchor)) throw new Error('Missing poker anchor: ' + label);
    html = html.replace(anchor, () => block + '\n' + anchor);
  }
}
if (process.argv.includes('--check')) {
  if (html !== before) throw new Error('Run node scripts/sync-poker.mjs to synchronize Big Money Rustlas Poker.');
  console.log('Poker sources match standalone game.');
} else await fs.writeFile(file, html);
