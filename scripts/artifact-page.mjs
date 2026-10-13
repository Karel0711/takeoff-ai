// Turns the Vite build into a claude.ai artifact: the page body (title, inline CSS,
// root element, module script) plus the asset files it loads, listed for publishing.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
const html = readFileSync(join(dist, 'index.html'), 'utf8');

const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const fontLinks = [...html.matchAll(/<link[^>]+fonts\.(?:googleapis|gstatic)\.com[^>]*>/g)].map((m) => m[0]);
const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"[^>]*>/g)]
  .map((m) => readFileSync(join(dist, m[1]), 'utf8'))
  .join('\n');
const script = html.match(/<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/)[1];

const page = [
  title,
  ...fontLinks,
  `<style>\n${css}\n</style>`,
  '<div id="root"></div>',
  `<script type="module" src="${script}"></script>`,
  '',
].join('\n');
writeFileSync(join(dist, 'artifact.html'), page);

// The publisher refuses raw control characters and U+FFFD. In minified libraries they only occur
// inside string, template and regex literals, where a \xNN escape means the same thing.
for (const f of readdirSync(join(dist, 'assets')).filter((f) => /\.m?js$/.test(f))) {
  const path = join(dist, 'assets', f);
  const src = readFileSync(path, 'utf8');
  // eslint-disable-next-line no-control-regex
  const escaped = src
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
    .replace(/\uFFFD/g, '\\uFFFD');
  if (escaped !== src) writeFileSync(path, escaped);
}

const files = Object.fromEntries(
  readdirSync(join(dist, 'assets'))
    .filter((f) => !f.endsWith('.css') && !f.endsWith('.map'))
    .map((f) => [`assets/${f}`, `dist/assets/${f}`]),
);
writeFileSync(join(dist, 'artifact-files.json'), JSON.stringify(files, null, 2));
console.log(`artifact.html (${page.length} bytes) + ${Object.keys(files).length} files`);
