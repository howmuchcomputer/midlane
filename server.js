#!/usr/bin/env node
// MIDLANE — LAN game server. Zero dependencies: serves the game and relays
// rollback-netcode messages between two players over a minimal WebSocket server.
//
//   node server.js            (port 7878, all interfaces; tries the next port if busy)
//   PORT=8080 node server.js  (use exactly this port)
//   node server.js --open     (also open the game in your default browser)
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { openBrowser } from './tools/browser.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const DEFAULT_PORT = 7878;
const FIXED_PORT = !!process.env.PORT;
let PORT = parseInt(process.env.PORT || String(DEFAULT_PORT), 10);
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon', '.txt': 'text/plain',
};

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Static files
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/info') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ port: PORT, lan: lanAddresses().map((a) => `http://${a.address}:${PORT}`) }));
    return;
  }
  let p;
  try { p = decodeURIComponent(url.pathname); } catch { res.writeHead(400); res.end('bad request'); return; }
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return; }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
      'content-length': st.size,
    });
    fs.createReadStream(file).pipe(res);
  });
});

// ---------------------------------------------------------------------------
// Minimal RFC6455 WebSocket implementation (text frames, ping/pong, close).
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class Conn {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frag = [];
    this.fragLen = 0;
    this.open = true;
    this.onmessage = null;
    this.onclose = null;
    socket.setNoDelay(true);
    socket.on('data', (d) => this.onData(d));
    socket.on('close', () => this.closed());
    socket.on('error', () => this.closed());
  }
  onData(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0, op = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (len > 1 << 20) { this.close(); return; }
      const need = off + (masked ? 4 : 0) + len;
      if (this.buf.length < need) return;
      let payload = this.buf.subarray(off + (masked ? 4 : 0), need);
      if (masked) {
        const mask = this.buf.subarray(off, off + 4);
        const out = Buffer.allocUnsafe(len);
        for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3];
        payload = out;
      }
      this.buf = this.buf.subarray(need);
      if (op === 0x8) { this.close(); return; }
      if (op === 0x9) { this.sendFrame(0xA, payload); continue; }
      if (op === 0xA) continue;
      if (op === 0x1 || op === 0x2 || op === 0x0) {
        this.frag.push(Buffer.from(payload));
        this.fragLen += len;
        if (this.fragLen > 1 << 20) { this.close(); return; }
        if (fin) {
          const msg = Buffer.concat(this.frag).toString('utf8');
          this.frag = [];
          this.fragLen = 0;
          if (this.onmessage) {
            try { this.onmessage(msg); } catch (e) { console.error('message handler error', e); }
          }
        }
      }
    }
  }
  sendFrame(op, payload) {
    if (!this.open) return;
    const len = payload.length;
    let header;
    if (len < 126) { header = Buffer.from([0x80 | op, len]); }
    else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | op; header[1] = 126; header.writeUInt16BE(len, 2); }
    else { header = Buffer.alloc(10); header[0] = 0x80 | op; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
    this.socket.write(Buffer.concat([header, payload]));
  }
  send(obj) { this.sendFrame(0x1, Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf8')); }
  close() {
    if (!this.open) return;
    try { this.sendFrame(0x8, Buffer.alloc(0)); } catch {}
    this.socket.end();
    this.closed();
  }
  closed() {
    if (!this.open) return;
    this.open = false;
    if (this.onclose) this.onclose();
  }
}

// ---------------------------------------------------------------------------
// Lobby
let nextId = 1;
const clients = new Map(); // id -> { id, name, conn, room }
const rooms = new Map();   // id -> { id, name, host, players: [id, id?], started }

function roomList() {
  return [...rooms.values()].map((r) => ({
    id: r.id, name: r.name, players: r.players.map((pid) => clients.get(pid)?.name || '?'),
    full: r.players.length >= 2, started: r.started,
  }));
}
function broadcastRooms() {
  const list = roomList();
  for (const c of clients.values()) if (!c.room) c.conn.send({ t: 'rooms', rooms: list });
}
function leaveRoom(c) {
  const r = c.room && rooms.get(c.room);
  c.room = null;
  if (!r) return;
  r.players = r.players.filter((p) => p !== c.id);
  for (const pid of r.players) clients.get(pid)?.conn.send({ t: 'peer_left' });
  if (r.players.length === 0 || r.host === c.id) {
    for (const pid of r.players) { const o = clients.get(pid); if (o) { o.room = null; o.conn.send({ t: 'room_closed' }); } }
    rooms.delete(r.id);
  }
  broadcastRooms();
}

server.on('upgrade', (req, socket) => {
  if (!req.url.startsWith('/ws')) { socket.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  const conn = new Conn(socket);
  const c = { id: nextId++, name: 'Player', conn, room: null };
  clients.set(c.id, c);
  conn.send({ t: 'welcome', id: c.id, lan: lanAddresses().map((a) => `http://${a.address}:${PORT}`) });
  conn.onclose = () => { leaveRoom(c); clients.delete(c.id); broadcastRooms(); };
  conn.onmessage = (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    switch (m.t) {
      case 'hello':
        c.name = String(m.name || 'Player').slice(0, 20);
        conn.send({ t: 'rooms', rooms: roomList() });
        break;
      case 'list':
        conn.send({ t: 'rooms', rooms: roomList() });
        break;
      case 'create': {
        leaveRoom(c);
        const id = String(nextId++);
        rooms.set(id, { id, name: `${c.name}'s lane`, host: c.id, players: [c.id], started: false });
        c.room = id;
        conn.send({ t: 'joined', room: id, slot: 0, host: true, players: [c.name] });
        broadcastRooms();
        break;
      }
      case 'join': {
        const r = rooms.get(String(m.room));
        if (!r || r.players.length >= 2) { conn.send({ t: 'error', msg: 'That lane is full or gone.' }); break; }
        leaveRoom(c);
        r.players.push(c.id);
        c.room = r.id;
        const names = r.players.map((pid) => clients.get(pid).name);
        conn.send({ t: 'joined', room: r.id, slot: 1, host: false, players: names });
        clients.get(r.host)?.conn.send({ t: 'peer_joined', name: c.name, players: names });
        broadcastRooms();
        break;
      }
      case 'leave':
        leaveRoom(c);
        conn.send({ t: 'rooms', rooms: roomList() });
        break;
      default: {
        // Relay any other message to the other player in the room.
        const r = c.room && rooms.get(c.room);
        if (!r) break;
        if (m.t === 'start') { r.started = true; broadcastRooms(); }
        if (m.t === 'end') { r.started = false; broadcastRooms(); }
        for (const pid of r.players) if (pid !== c.id) clients.get(pid)?.conn.send(raw);
        if (m.echo) conn.send(raw);
      }
    }
  };
});

let attempts = 0;
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && !FIXED_PORT && attempts < 20) {
    console.log(`  Port ${PORT} is busy, trying ${PORT + 1}…`);
    attempts++;
    PORT++;
    setTimeout(() => server.listen(PORT, HOST), 50);
    return;
  }
  if (err.code === 'EADDRINUSE') console.error(`\n  Port ${PORT} is already in use. Pick another, e.g.  PORT=${PORT + 1} node server.js\n`);
  else console.error(err);
  process.exit(1);
});

server.listen(PORT, HOST);
server.on('listening', () => {
  PORT = server.address().port;
  const lan = lanAddresses();
  console.log('\n  ⚔  MIDLANE server running\n');
  console.log(`     Local:   http://localhost:${PORT}`);
  for (const a of lan) console.log(`     LAN:     http://${a.address}:${PORT}   (${a.name})`);
  console.log('\n  Open one of the LAN addresses on the other laptop to join.\n');
  if (process.argv.includes('--open') && !process.argv.includes('--no-open') && process.env.BROWSER !== 'none') {
    const host = HOST === '0.0.0.0' || HOST === '::' ? 'localhost' : HOST.includes(':') ? `[${HOST}]` : HOST;
    openBrowser(`http://${host}:${PORT}`);
  }
});
