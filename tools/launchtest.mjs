// Launcher checks use a fake browser opener: no browser windows are created.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { browserCommand } from './browser.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('browser commands keep the address as a single argument on every platform', () => {
  const url = 'http://localhost:7878';
  assert.deepEqual(browserCommand(url, 'darwin'), ['open', [url]]);
  assert.deepEqual(browserCommand(url, 'win32'), ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]);
  assert.deepEqual(browserCommand(url, 'linux'), ['xdg-open', [url]]);
});

test('launching opens the listening port and supports headless starts', { skip: process.platform === 'win32' }, async (t) => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'midlane launcher '));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const capture = path.join(tmp, 'opened');
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
  await writeFile(path.join(tmp, opener), '#!/bin/sh\nprintf "%s\\n" "$@" >> "$MIDLANE_BROWSER_CAPTURE"\n', { mode: 0o755 });

  async function start(args, patch = {}) {
    const child = spawn(process.execPath, [path.join(ROOT, 'server.js'), ...args], {
      // Confirm starting from a different working directory works.
      cwd: tmp,
      env: { ...process.env, HOST: '127.0.0.1', PORT: '0', BROWSER: '', PATH: tmp + path.delimiter + process.env.PATH, MIDLANE_BROWSER_CAPTURE: capture, ...patch },
    });
    let output = '';
    child.stdout.on('data', (data) => { output += data; });
    child.stderr.on('data', (data) => { output += data; });
    t.after(async () => { if (child.exitCode === null) { child.kill(); await once(child, 'exit'); } });
    for (let i = 0; i < 100; i++) {
      const match = output.match(/Local: {3}http:\/\/localhost:(\d+)/);
      if (match) return { child, port: Number(match[1]) };
      if (child.exitCode !== null) throw new Error(output);
      await delay(20);
    }
    throw new Error('Server never became ready: ' + output);
  }

  await t.test('opens one browser at the actual ephemeral port after the game is ready', async () => {
    const { port } = await start(['--open']);
    const info = await fetch(`http://127.0.0.1:${port}/api/info`).then((r) => r.json());
    assert.equal(info.port, port);
    for (let i = 0; i < 50; i++) {
      const opened = await readFile(capture, 'utf8').catch(() => '');
      if (opened) { assert.equal(opened, `http://127.0.0.1:${port}\n`); return; }
      await delay(20);
    }
    assert.fail('Browser was not opened');
  });

  for (const [name, args, patch] of [
    ['direct server stays headless', [], {}],
    ['--no-open overrides --open', ['--open', '--no-open'], {}],
    ['BROWSER=none overrides --open', ['--open'], { BROWSER: 'none' }],
  ]) {
    await t.test(name, async () => {
      await rm(capture, { force: true });
      await start(args, patch);
      await delay(100);
      assert.equal(await readFile(capture, 'utf8').catch(() => ''), '');
    });
  }

  await t.test('a failed fixed-port start never opens a browser', async () => {
    await rm(capture, { force: true });
    const blocker = http.createServer();
    blocker.listen(0, '127.0.0.1');
    await once(blocker, 'listening');
    try {
      const child = spawn(process.execPath, [path.join(ROOT, 'server.js'), '--open'], {
        env: { ...process.env, HOST: '127.0.0.1', PORT: String(blocker.address().port), BROWSER: '', PATH: tmp + path.delimiter + process.env.PATH, MIDLANE_BROWSER_CAPTURE: capture },
        stdio: 'ignore',
      });
      const [code] = await once(child, 'exit');
      assert.equal(code, 1);
      assert.equal(await readFile(capture, 'utf8').catch(() => ''), '');
    } finally { blocker.close(); }
  });

  await t.test('a busy default port opens the next available game address', async () => {
    await rm(capture, { force: true });
    const blocker = http.createServer();
    blocker.listen(7878, '127.0.0.1');
    try { await once(blocker, 'listening'); }
    catch (err) { if (err.code !== 'EADDRINUSE') throw err; }
    try {
      const { port } = await start(['--open'], { PORT: '' });
      assert.ok(port > 7878);
      for (let i = 0; i < 50; i++) {
        const opened = await readFile(capture, 'utf8').catch(() => '');
        if (opened) { assert.equal(opened, `http://127.0.0.1:${port}\n`); return; }
        await delay(20);
      }
      assert.fail('Browser was not opened after selecting another port');
    } finally { if (blocker.listening) blocker.close(); }
  });
});
