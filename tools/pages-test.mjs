// Real-browser checks for the published site and the no-install offline download.
// Run npm run build:web first. Set CHROME_PATH to use an installed Chrome.
/* global window, document */
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { unzipSync } from 'fflate';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = path.join(ROOT, 'dist');
const PREFIX = '/midlane/';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.zip': 'application/zip',
};

// Deliberately provide only static files under a repository subpath. Absolute
// asset paths, missing files, and requests for a game backend must fail here.
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith(PREFIX)) { res.writeHead(404); res.end(); return; }
    const relative = decodeURIComponent(url.pathname.slice(PREFIX.length)) || 'index.html';
    const file = path.resolve(DIST, relative);
    if (!file.startsWith(DIST + path.sep) || !(await stat(file)).isFile()) {
      res.writeHead(404); res.end(); return;
    }
    const content = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(content);
  } catch {
    res.writeHead(404); res.end();
  }
});

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
let browser;
let temp;
const check = (name) => console.log(`  ✔ ${name}`);
const lowGraphics = async (context) => context.addInitScript(() => {
  try {
    localStorage.setItem('midlane.settings.v1', JSON.stringify({ quality: 'low', master: 0 }));
  } catch { /* The game also supports browsers that block file-origin storage. */ }
});
const titleReady = async (page) => {
  await page.waitForFunction(() => !!window.app?.screen);
  await page.locator('#boot.gone').waitFor();
  await page.getByRole('button', { name: 'Play now', exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(() => document.fonts.check('900 48px "Cinzel Decorative"')), true);
  assert.equal(await page.evaluate(() => document.fonts.check('500 16px Rajdhani')), true);
};
const startAndMove = async (page) => {
  await page.getByRole('button', { name: 'Play now', exact: true }).click();
  await page.waitForFunction(() => window.app.screen.match?.G.phase === 'fight');
  assert.equal(await page.evaluate(() => window.app.screen.cfg.quick && window.app.screen.match.G.cfg.noShop), true);
  const x = await page.evaluate(() => window.app.screen.match.G.fighters[0].x);
  await page.keyboard.down('KeyD');
  await page.waitForFunction((before) => window.app.screen.match.G.fighters[0].x > before + 300, x);
  await page.keyboard.up('KeyD');
  assert.equal(await page.evaluate(() => !!window.app.errShown), false, 'The game loop must run without caught errors');
};

try {
  await stat(path.join(DIST, 'index.html'));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}${PREFIX}`;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await lowGraphics(context);
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  const badResponses = [];
  const failedRequests = [];
  const sockets = [];
  const fontUrls = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
    if (/\.woff2?(?:\?|$)/.test(response.url())) fontUrls.push(response.url());
  });
  page.on('requestfailed', (request) => failedRequests.push(request.url()));
  page.on('websocket', (socket) => sockets.push(socket.url()));

  await page.goto(url);
  await titleReady(page);
  assert(fontUrls.length > 0, 'The hosted game must load its bundled fonts');
  assert(fontUrls.every((fontUrl) => fontUrl.startsWith(url)), 'Font paths must stay under /midlane/');
  await startAndMove(page);
  check('the static /midlane/ site loads all assets and supports one-click play and movement');

  await page.goto(url);
  await titleReady(page);
  await page.getByRole('button', { name: 'More ways to play', exact: true }).click();
  for (const [label, mode] of [['Versus CPU', 'cpu'], ['Local Versus', 'local'], ['Training', 'training']]) {
    await page.getByRole('button', { name: new RegExp(`^${label}`) }).click();
    await page.waitForFunction((expected) => window.app.screen.mode === expected, mode);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^Play with a friend/ }).waitFor();
  }
  check('CPU, two-player local versus, and training remain available on the hosted site');

  await page.getByRole('button', { name: /^Play with a friend/ }).click();
  await page.getByRole('heading', { name: 'Play with a friend', exact: true }).waitFor();
  await page.getByText('LAN battles need the downloadable server version.', { exact: true }).waitFor();
  const download = page.getByRole('link', { name: 'Download game', exact: true });
  await download.waitFor();
  const downloadUrl = new URL(await download.getAttribute('href'), url).href;
  assert.equal(downloadUrl, `${url}download/MIDLANE-offline.zip`);
  const response = await page.request.get(downloadUrl);
  assert.equal(response.status(), 200);
  const zip = new Uint8Array(await response.body());
  const files = unzipSync(zip);
  assert(files['MIDLANE.html'], 'The download must contain a ready-to-open game file');
  assert(files['README.txt'], 'The download must include simple opening instructions');
  assert.equal(sockets.length, 0, 'The static site must not attempt unsupported WebSocket connections');
  assert.deepEqual(badResponses, [], `Missing static files: ${badResponses.join('; ')}`);
  assert.deepEqual(failedRequests, [], `Failed static requests: ${failedRequests.join('; ')}`);
  assert.deepEqual(errors, [], `Hosted browser errors: ${errors.join('; ')}`);
  check('hosted multiplayer explains its server requirement and offers a working download without connection failures');
  await context.close(); // Release software-WebGL rendering before the offline run.

  temp = await mkdtemp(path.join(os.tmpdir(), 'midlane offline '));
  const offlineFile = path.join(temp, 'MIDLANE.html');
  await writeFile(offlineFile, files['MIDLANE.html']);
  const offlineContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await lowGraphics(offlineContext);
  await offlineContext.setOffline(true);
  const offlinePage = await offlineContext.newPage();
  offlinePage.setDefaultTimeout(20000);
  const offlineErrors = [];
  const externalRequests = [];
  offlinePage.on('pageerror', (error) => offlineErrors.push(error.message));
  offlinePage.on('request', (request) => {
    if (/^https?:/.test(request.url())) externalRequests.push(request.url());
  });
  offlinePage.on('websocket', (socket) => externalRequests.push(socket.url()));
  await offlinePage.goto(pathToFileURL(offlineFile).href, { waitUntil: 'domcontentloaded' });
  await titleReady(offlinePage);
  await startAndMove(offlinePage);
  assert.deepEqual(externalRequests, [], 'The downloaded game must not need the internet or a local server');
  assert.deepEqual(offlineErrors, [], `Offline browser errors: ${offlineErrors.join('; ')}`);
  check('the downloaded HTML opens from disk and plays with networking disabled and no extra software');
  console.log('\nAll Pages and offline-download browser checks passed.');
} finally {
  if (browser) await browser.close();
  if (server.listening) {
    const closed = new Promise((resolve) => server.close(resolve));
    server.closeAllConnections();
    await closed;
  }
  if (temp) await rm(temp, { recursive: true, force: true });
}
