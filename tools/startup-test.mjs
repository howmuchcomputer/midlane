// Optional real-browser smoke test; no game/runtime dependencies are added.
// With Playwright and its Chromium installed: node tools/startup-test.mjs
// Or use an existing install:
// PLAYWRIGHT_MODULE=/absolute/path/playwright/index.mjs CHROME_PATH=/path/to/chrome node tools/startup-test.mjs
// Set SCREENSHOT_DIR to save title and gameplay screenshots.
/* global window, document, dispatchEvent, KeyboardEvent */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = spawn(process.execPath, ['server.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: '0', HOST: '127.0.0.1', BROWSER: 'none' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let browser;
let page;
let output = '';
server.stdout.on('data', (chunk) => { output += chunk; });
server.stderr.on('data', (chunk) => { output += chunk; });
const check = (name) => console.log(`  ✔ ${name}`);

try {
  const url = await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error(`Server did not start: ${output}`)), 10000);
    const ready = () => {
      const match = output.match(/Local:\s+(http:\/\/[^\s]+)/);
      if (match) { clearTimeout(deadline); resolve(match[1].replace('localhost', '127.0.0.1')); }
    };
    server.stdout.on('data', ready);
    server.once('error', (error) => { clearTimeout(deadline); reject(error); });
    server.once('exit', (code) => { clearTimeout(deadline); reject(new Error(`Server exited (${code}): ${output}`)); });
    ready();
  });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => {
    // Low graphics makes the smoke test practical on machines with software WebGL.
    const key = 'midlane.settings.v1';
    const settings = JSON.parse(localStorage.getItem(key) || '{}');
    localStorage.setItem(key, JSON.stringify({ ...settings, quality: 'low', master: 0 }));
  });
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const screen = async (name) => page.waitForFunction((expected) => window.app?.screen?.constructor.name === expected, name);
  const title = async () => {
    await page.goto(url);
    await screen('TitleScreen');
    await page.locator('#boot.gone').waitFor();
    await page.getByRole('button', { name: 'Play now', exact: true }).waitFor();
    // Count actual screen transitions to catch duplicate native keyboard activation.
    await page.evaluate(() => {
      const original = window.app.go.bind(window.app);
      window.testBattleStarts = 0;
      window.app.go = (next) => {
        if (next.constructor.name === 'Battle') window.testBattleStarts++;
        return original(next);
      };
    });
  };
  const quickFight = async () => {
    await screen('Battle');
    assert.deepEqual(await page.evaluate(() => {
      const s = window.app.screen;
      return { quick: s.cfg.quick, shop: s.match.G.cfg.noShop, mode: s.cfg.mode, ai: s.cfg.ai, devices: s.cfg.devices };
    }), { quick: true, shop: true, mode: 'cpu', ai: [null, 0], devices: ['any', 'any'] });
    assert.equal(await page.locator('.vs-splash').count(), 0);
    assert.equal(await page.evaluate(() => window.testBattleStarts), 1);
    await page.waitForFunction(() => window.app.screen.match.G.phase === 'fight');
  };
  const pause = async () => {
    await page.keyboard.press('Escape');
    await page.locator('.pause').waitFor();
    assert.equal(await page.evaluate(() => window.app.screen.match.paused), true);
  };
  const mainMenu = async () => {
    await pause();
    await page.locator('.pause .mi-name').getByText('Main menu', { exact: true }).click();
    await screen('MainMenu');
  };

  await title();
  if (process.env.SCREENSHOT_DIR) {
    await mkdir(process.env.SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'midlane-title.png') });
  }
  for (const [width, height] of [[390, 844], [844, 390]]) {
    await page.setViewportSize({ width, height });
    const bounds = await page.getByRole('button', { name: 'Play now', exact: true }).boundingBox();
    assert(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= height, `Play now must fit ${width}x${height}`);
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `midlane-title-${width}x${height}.png`) });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  check('Play now remains visible on narrow and landscape screens');
  await page.getByRole('button', { name: 'Play now', exact: true }).click();
  await quickFight();
  check('one click starts a playable CPU match without selection screens, splash, or shop');
  const x = await page.evaluate(() => window.app.screen.match.G.fighters[0].x);
  await page.keyboard.down('KeyD');
  await page.waitForFunction((before) => window.app.screen.match.G.fighters[0].x > before + 300, x);
  await page.keyboard.up('KeyD');
  check('the player can move with the keyboard');
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'midlane-playing.png') });
  await pause();
  const frame = await page.evaluate(() => window.app.screen.match.G.frame);
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.app.screen.match.G.frame), frame);
  await page.keyboard.press('Escape');
  await page.locator('.pause').waitFor({ state: 'hidden' });
  await page.waitForFunction((before) => window.app.screen.match.G.frame > before, frame);
  check('pause freezes the match and resume restores gameplay');

  await page.evaluate(() => {
    const s = window.app.screen;
    s.match.G.phase = 'over'; s.match.G.winner = 0;
    s.showResults();
  });
  await page.getByRole('button', { name: 'Rematch', exact: true }).click();
  await page.waitForFunction(() => window.testBattleStarts === 2 && !window.app.screen.resultsShown);
  await screen('Battle');
  assert.equal(await page.evaluate(() => window.app.screen.cfg.quick && window.app.screen.match.G.cfg.noShop && window.app.screen.splashT === 0), true);
  check('rematch retains the fast start and bypasses the shop');
  await mainMenu();
  await page.getByRole('button', { name: /^Play now/ }).click();
  await screen('Battle');
  assert.equal(await page.evaluate(() => window.app.screen.cfg.quick), true);
  check('the main menu offers the same one-button start');

  await title();
  await page.keyboard.down('Enter');
  await page.evaluate(() => dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', repeat: true, bubbles: true })));
  await page.keyboard.up('Enter');
  await quickFight();
  check('Enter starts exactly one match, including held-key repeats');

  await title();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'More ways to play');
  await page.keyboard.press('Enter');
  await screen('MainMenu');
  check('Tab and Enter reach the additional modes');
  for (const [label, expected, mode] of [
    ['Local Versus', 'CharSelect', 'local'], ['Training', 'CharSelect', 'training'],
    ['How to Play', 'HowTo'], ['Options', 'Options'], ['LAN Battle', 'Lobby'],
  ]) {
    await page.getByRole('button', { name: new RegExp(`^${label}`) }).click();
    await screen(expected);
    if (mode) assert.equal(await page.evaluate(() => window.app.screen.mode), mode);
    if (expected === 'Lobby') await page.getByText('Connected to the game server', { exact: false }).waitFor();
    await page.keyboard.press('Escape');
    await screen('MainMenu');
  }
  check('local versus, training, instructions, options, and LAN remain accessible');
  await page.getByRole('button', { name: /^Versus CPU/ }).click();
  await screen('CharSelect');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Enter');
  await screen('Battle');
  assert.equal(await page.evaluate(() => window.app.screen.cfg.shop && !window.app.screen.cfg.quick && window.app.screen.splashT > 0), true);
  check('custom CPU matches retain hero, opponent, arena, and shop choices');

  await title();
  await page.evaluate(() => {
    window.app.input.layouts.solo.right = ['KeyZ'];
    window.app.input.saveBindings();
  });
  await title();
  await page.keyboard.press('Enter');
  await quickFight();
  const boundX = await page.evaluate(() => window.app.screen.match.G.fighters[0].x);
  await page.keyboard.down('KeyZ');
  await page.waitForFunction((before) => window.app.screen.match.G.fighters[0].x > before + 300, boundX);
  await page.keyboard.up('KeyZ');
  check('quick play respects saved player key bindings');

  await title();
  await page.evaluate(() => {
    window.testPad = { connected: true, index: 0, mapping: 'standard', axes: [0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })) };
    navigator.getGamepads = () => [window.testPad];
    window.testPad.buttons[0] = { pressed: true, value: 1 };
  });
  await screen('Battle');
  await page.evaluate(() => { window.testPad.buttons[0] = { pressed: false, value: 0 }; });
  await quickFight();
  const padX = await page.evaluate(() => window.app.screen.match.G.fighters[0].x);
  await page.evaluate(() => { window.testPad.axes[0] = 1; });
  await page.waitForFunction((before) => window.app.screen.match.G.fighters[0].x > before + 300, padX);
  await page.evaluate(() => { window.testPad.axes[0] = 0; });
  check('a gamepad can start and control quick play');

  assert.deepEqual(errors, [], `Browser errors: ${errors.join('; ')}`);
  console.log('\nAll startup browser checks passed.');
} catch (error) {
  if (page && !page.isClosed()) {
    console.error('Last browser state:', await page.evaluate(() => ({ screen: window.app?.screen?.constructor.name, paused: window.app?.screen?.match?.paused, phase: window.app?.screen?.match?.G.phase, results: !!window.app?.screen?.resEl, errors: window.app?.errShown, ui: document.querySelector('#ui')?.textContent })).catch(() => null));
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'midlane-test-failure.png') }).catch(() => {});
  }
  throw error;
} finally {
  if (browser) await browser.close();
  server.kill();
}
