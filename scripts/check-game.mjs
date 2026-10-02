import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
const html = readFileSync(new URL('../public/game.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
for (const [index, [, source]] of scripts.entries()) new Script(source, { filename: `game-script-${index + 1}.js` });
console.log(`Validated ${scripts.length} arcade scripts.`);
