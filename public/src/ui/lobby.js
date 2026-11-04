// LAN lobby: name, host a lane, list/join lanes, then hand off to online char select.
import { h, clear, toast } from './dom.js';
import { NetClient } from '../net/client.js';
import { CharSelect } from './select.js';
import { LAN_ENABLED, OFFLINE_BUILD } from '../features.js';

export class Lobby {
  constructor(app, client = null) { this.app = app; this.client = client; this.rooms = []; this.sel = 0; this.state = 'idle'; }

  async enter() {
    const A = this.app;
    A.shade('dark');
    A.renderer.viewT = { zoom: 1.05, shift: 0, lift: 0 };
    A.hudRoot.classList.add('hidden');
    A.audio.music('select');
    if (!A.backdrop || A.backdrop.idle) A.setBackdrop();
    if (!LAN_ENABLED) {
      A.ui.append(h('div', { class: 'page' }, [
        h('div', { class: 'page-head' }, [
          h('div', {}, [h('div', { class: 'eyebrow' }, 'Multiplayer'), h('h1', { class: 'h1' }, 'Play with a friend')]),
          h('button', { class: 'btn', onclick: () => this.back() }, 'Back'),
        ]),
        h('div', { class: 'page-body grid2' }, [
          h('div', { class: 'card panel' }, [
            h('h3', {}, 'Two players. One computer.'),
            h('p', {}, 'Share a keyboard or connect two gamepads. Choose your heroes and fight right here.'),
            h('button', { class: 'btn', onclick: () => A.go(new CharSelect(A, { mode: 'local' })) }, 'Play local versus'),
          ]),
          h('div', { class: 'card panel' }, [
            h('h3', {}, 'On separate computers?'),
            h('p', {}, 'LAN battles need the downloadable server version.'),
            h('p', {}, 'One person runs the server; everyone joins on the same Wi-Fi.'),
            h('a', { class: 'btn ghost', href: 'https://github.com/howmuchcomputer/midlane/archive/refs/heads/main.zip', target: '_blank', rel: 'noopener' }, 'Get LAN version'),
            OFFLINE_BUILD
              ? h('p', {}, 'You’re playing the offline edition. Solo fights, training, and Local Versus work without an internet connection.')
              : h('p', {}, [h('a', { class: 'btn ghost', href: './download/MIDLANE-offline.zip', download: '' }, 'Download game'), ' — unzip and open MIDLANE.html. Nothing to install.']),
          ]),
        ]),
      ]));
      return;
    }
    const name = A.settings.name || ('Hero' + Math.floor(100 + Math.random() * 900));
    this.nameIn = h('input', { class: 'input', value: name, maxlength: '20', placeholder: 'Your name' });
    this.nameIn.addEventListener('change', () => this.setName());
    this.status = h('div', { class: 'muted', style: 'margin:8px 0' }, 'Connecting…');
    this.urlEl = h('div', {});
    this.listEl = h('div', { class: 'lobby-list' });
    this.waitEl = h('div', {});
    const page = h('div', { class: 'page' }, [
      h('div', { class: 'page-head' }, [h('div', {}, [h('div', { class: 'eyebrow' }, 'Local network'), h('h1', { class: 'h1' }, 'LAN Battle')]), h('button', { class: 'btn', onclick: () => this.back() }, 'Back')]),
      h('div', { class: 'page-body grid2' }, [
        h('div', { class: 'card panel' }, [
          h('h3', {}, 'You'), this.nameIn, this.status,
          h('h3', { style: 'margin-top:16px' }, 'Invite a friend'),
          h('p', { class: 'muted' }, 'On another laptop on this network, open:'), this.urlEl,
          h('p', { class: 'muted', style: 'font-size:14px' }, 'Then one of you hosts a lane and the other joins it.'),
        ]),
        h('div', { class: 'card panel' }, [
          h('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, [h('h3', { style: 'margin:0' }, 'Open lanes'),
            h('div', { style: 'display:flex;gap:8px' }, [h('button', { class: 'btn', onclick: () => this.host() }, 'Host a lane'), h('button', { class: 'btn ghost', onclick: () => this.client && this.client.send({ t: 'list' }) }, 'Refresh')])]),
          this.listEl, this.waitEl,
        ]),
      ]),
    ]);
    A.ui.append(page);
    this.drawList();
    try {
      if (!this.client || !this.client.open) {
        this.client = new NetClient();
        await this.client.connect();
      }
      this.bind();
      this.client.send({ t: 'hello', name: this.nameIn.value });
      this.client.send({ t: 'leave' });
      this.status.innerHTML = '<span class="status-dot on"></span>Connected to the game server';
      this.drawUrls(this.client.lan);
    } catch (e) {
      this.status.innerHTML = '<span class="status-dot"></span>' + (e.message || 'Not connected');
      this.drawUrls([]);
    }
  }

  bind() {
    const C = this.client;
    this.offs = [
      C.on('rooms', (m) => { this.rooms = m.rooms; this.drawList(); }),
      C.on('joined', (m) => this.joined(m)),
      C.on('peer_joined', (m) => { this.names = m.players; this.toSelect(0, true); }),
      C.on('error', (m) => toast(m.msg, true)),
      C.on('close', () => { this.status.innerHTML = '<span class="status-dot"></span>Disconnected — is the server still running?'; }),
      C.on('room_closed', () => { this.state = 'idle'; this.drawList(); }),
    ];
  }
  exit() { if (this.offs) for (const o of this.offs) o(); }

  drawUrls(lan) {
    clear(this.urlEl);
    const here = `${location.protocol}//${location.host}`;
    const urls = lan && lan.length ? lan : [here];
    for (const u of urls) this.urlEl.append(h('div', { class: 'url' }, u));
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      this.urlEl.append(h('p', { class: 'muted', style: 'font-size:13px' }, 'You opened the game via localhost — your friend must use the LAN address above, not localhost.'));
    }
  }

  setName() {
    const n = (this.nameIn.value || '').trim().slice(0, 20) || 'Player';
    this.app.saveSettings({ name: n });
    if (this.client) this.client.send({ t: 'hello', name: n });
  }

  drawList() {
    clear(this.listEl);
    if (this.state === 'hosting') {
      clear(this.waitEl);
      this.waitEl.append(h('div', { class: 'lane sel' }, [h('div', {}, [h('div', { class: 'ln' }, 'Your lane is open'), h('div', { class: 'lp' }, 'Waiting for a challenger to join…')]),
        h('button', { class: 'btn ghost', onclick: () => { this.client.send({ t: 'leave' }); this.state = 'idle'; this.drawList(); } }, 'Close')]));
      return;
    }
    clear(this.waitEl);
    const open = this.rooms.filter((r) => !r.started || r.players.length < 2);
    if (!open.length) this.listEl.append(h('div', { class: 'muted', style: 'padding:14px 4px' }, 'No lanes yet. Host one, or wait for a friend to host.'));
    open.forEach((r, i) => {
      this.listEl.append(h('div', { class: 'lane' + (i === this.sel ? ' sel' : ''), onclick: () => this.join(r) }, [
        h('div', {}, [h('div', { class: 'ln' }, r.name), h('div', { class: 'lp' }, r.players.join(' vs '))]),
        h('div', { class: 'ls ' + (r.full ? 'full' : 'open') }, r.full ? (r.started ? 'In battle' : 'Full') : 'Join'),
      ]));
    });
    this.openRooms = open;
  }

  host() {
    if (!this.client || !this.client.open) { toast('Not connected to the server.', true); return; }
    this.setName();
    this.client.send({ t: 'create' });
    this.app.audio.play('ui_select');
  }
  join(r) {
    if (!this.client || !this.client.open) return;
    if (r.full) { toast('That lane is full.', true); return; }
    this.setName();
    this.client.send({ t: 'join', room: r.id });
    this.app.audio.play('ui_select');
  }
  joined(m) {
    this.names = m.players;
    if (m.host) { this.state = 'hosting'; this.drawList(); toast('Lane opened — waiting for a challenger.'); }
    else this.toSelect(1, false);
  }
  toSelect(local, host) {
    const names = this.names && this.names.length === 2 ? this.names : (local === 0 ? [this.nameIn.value, 'Challenger'] : ['Host', this.nameIn.value]);
    this.app.audio.play('ui_ready');
    this.app.go(new CharSelect(this.app, { mode: 'online', online: { client: this.client, local, host, names } }));
  }

  back() {
    if (this.client) { this.client.send({ t: 'leave' }); this.client.close(); }
    this.app.audio.play('ui_back');
    import('./screens.js').then(({ MainMenu }) => this.app.go(new MainMenu(this.app, 3)));
  }
  nav(a, src, e) {
    if (!LAN_ENABLED) {
      if (a === 'pause' || a === 'back') { if (e) e.preventDefault(); this.back(); }
      return;
    }
    if (e && e.target && e.target.tagName === 'INPUT' && a !== 'back') return;
    const n = (this.openRooms || []).length;
    if (a === 'up' && n) { this.sel = (this.sel + n - 1) % n; this.drawList(); }
    else if (a === 'down' && n) { this.sel = (this.sel + 1) % n; this.drawList(); }
    else if (a === 'confirm' && n && this.state !== 'hosting') this.join(this.openRooms[this.sel]);
    else if (a === 'alt') this.host();
    else if (a === 'pause' || (a === 'back' && !(e && e.target && e.target.tagName === 'INPUT'))) this.back();
  }
}
