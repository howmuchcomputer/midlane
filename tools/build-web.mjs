// Build GitHub Pages and a standalone, no-install browser download.
// Development dependencies are used only while building, never by players.
import { build } from 'esbuild';
import { zipSync, strToU8 } from 'fflate';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DIST = path.join(ROOT, 'dist');
const STATIC_FEATURES = '// Generated for the hosted browser edition.\nexport const LAN_ENABLED = false;\nexport const OFFLINE_BUILD = false;\n';
const OFFLINE_FEATURES = '// Generated for the self-contained offline edition.\nexport const LAN_ENABLED = false;\nexport const OFFLINE_BUILD = true;\n';

const escapeHTML = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Preserve the repository's vendored three.js version instead of downloading
// another package. The same modules power the hosted and offline editions.
const browserModules = {
  name: 'midlane-browser-modules',
  setup(builder) {
    builder.onResolve({ filter: /^three$/ }, () => ({ path: path.join(PUBLIC, 'vendor/three/build/three.module.js') }));
    builder.onResolve({ filter: /^three\/addons\// }, (args) => ({ path: path.join(PUBLIC, 'vendor/three/addons', args.path.slice('three/addons/'.length)) }));
    builder.onLoad({ filter: /[/\\]features\.js$/ }, () => ({ contents: OFFLINE_FEATURES, loader: 'js' }));
  },
};

await rm(DIST, { recursive: true, force: true });
await cp(PUBLIC, DIST, { recursive: true });
await writeFile(path.join(DIST, 'src/features.js'), STATIC_FEATURES);
await writeFile(path.join(DIST, '.nojekyll'), '');

const bundled = await build({
  absWorkingDir: ROOT,
  entryPoints: [path.join(PUBLIC, 'src/main.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  legalComments: 'inline',
  write: false,
  plugins: [browserModules],
});

const cssFile = path.join(PUBLIC, 'css/style.css');
const css = await readFile(cssFile, 'utf8');
let embeddedCSS = '';
let last = 0;
for (const match of css.matchAll(/url\(\s*(['"]?)([^'"\s)]+)\1\s*\)/g)) {
  const value = match[2];
  if (value.startsWith('data:') || value.startsWith('#')) continue;
  if (/^[a-z]+:/i.test(value) || value.startsWith('/')) throw new Error(`Offline CSS must use local relative assets: ${value}`);
  const asset = path.resolve(path.dirname(cssFile), value);
  if (!asset.startsWith(PUBLIC + path.sep)) throw new Error(`CSS asset is outside public/: ${value}`);
  const mime = { '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.svg': 'image/svg+xml' }[path.extname(asset)];
  if (!mime) throw new Error(`Unsupported offline asset: ${value}`);
  const data = await readFile(asset);
  embeddedCSS += css.slice(last, match.index) + `url("data:${mime};base64,${data.toString('base64')}")`;
  last = match.index + match[0].length;
}
embeddedCSS += css.slice(last);

const licenses = (await Promise.all([
  ['MIDLANE', path.join(ROOT, 'LICENSE')],
  ['three.js', path.join(PUBLIC, 'vendor/three/LICENSE')],
  ['Fonts', path.join(PUBLIC, 'vendor/fonts/LICENSE-OFL.txt')],
].map(async ([title, file]) => `${title}\n${'='.repeat(title.length)}\n\n${await readFile(file, 'utf8')}`))).join('\n\n');

// Script and stylesheet contents are raw-text elements in HTML. Guard their
// closing tags even when future code or comments contain a matching string.
const script = bundled.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const style = embeddedCSS.replace(/<\/style/gi, '<\\/style');
const entry = await readFile(path.join(PUBLIC, 'index.html'), 'utf8');
let html = entry
  .replace(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/, () => `<style>${style}</style>`)
  .replace(/<script\b[^>]*type=["']importmap["'][^>]*>[\s\S]*?<\/script>/g, '')
  .replace(/<script\b[^>]*type=["']module["'][^>]*src=["'][^"']*["'][^>]*><\/script>/, () => `<script>${script}</script>`);
html = html.replace('</body>', `<template id="midlane-licenses"><pre>${escapeHTML(licenses)}</pre></template>\n</body>`);
if (html === entry || /<script\b[^>]*\bsrc=|<link\b[^>]*rel=["']stylesheet["']/.test(html)) throw new Error('Could not inline the offline game entry point.');

const instructions = `MIDLANE — offline browser edition

1. Extract this ZIP.
2. Open MIDLANE.html in a current desktop browser.
3. Click Play now.

No installation, Node.js, server, or internet connection is required.

Keyboard: W A S D move, J K L attack, U I O abilities,
Space ultimate, Shift dash, Escape pause. Gamepads also work.
More ways to play includes custom CPU matches, two players on one
computer, and training. LAN play requires the server/source edition.

Keep LICENSES.txt with the game when sharing this download.
`;

const download = path.join(DIST, 'download');
await mkdir(download, { recursive: true });
const zip = zipSync({
  'MIDLANE.html': strToU8(html),
  'README.txt': strToU8(instructions),
  'LICENSES.txt': strToU8(licenses),
}, { level: 9 });
await writeFile(path.join(download, 'MIDLANE-offline.zip'), zip);
console.log(`Built dist/ for static hosting and download/MIDLANE-offline.zip (${(zip.length / 1024 / 1024).toFixed(2)} MB).`);
