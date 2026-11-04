// Character select + stage select for every mode (CPU, local, training, online).
import { h, clear, toast } from './dom.js';
import { HEROES, HERO_LIST } from '../sim/heroes/index.js';
import { STAGES } from '../render/stages/index.js';
import { MANA, ULT_LEVEL } from '../sim/const.js';
import * as I from '../sim/input.js';
import { AI_LEVELS } from '../sim/ai.js';
import { heroIconSVG, abilityIconSVG, ATTR_COLOR, ATTR_NAME } from './hud.js';
import { keyLabel } from '../input/input.js';
import { Battle } from './battle.js';

const PLAY_STAGES = STAGES.filter((s) => s.id !== 'debug');
const ROSTER = [...HERO_LIST, 'random'];

export function heroPanel(id, side, who, locked, extra) {
  const H = HEROES[id];
  const el = h('div', { class: `hinfo panel ${side}` });
  if (!H) return el;
  const S = H.stats;
  const stat = (lbl, v, max, txt) => [h('span', {}, lbl), h('span', { class: 'sb' }, [h('i', { style: `width:${Math.min(100, (v / max) * 100)}%` })]), h('span', { class: 'sv' }, txt ?? String(v))];
  const ab = (slot) => {
    const A = slot === 'P' ? H.passive : H.abilities[slot];
    if (!A) return null;
    const m = H.moves[slot];
    const meta = slot === 'P' ? 'Passive' : `${m.cost / MANA} mana · ${(A.cd / 60).toFixed(A.cd % 60 ? 1 : 0)}s${slot === 'R' ? ` · Lv ${ULT_LEVEL}` : ''}`;
    return h('div', { class: 'abil' }, [
      h('span', { class: 'icon', html: abilityIconSVG(id, slot, 38) }),
      h('div', { class: 'an' }, [h('span', {}, [h('span', { class: 'slot' }, slot === 'P' ? '◆' : slot), A.name]), h('small', {}, meta)]),
      h('div', { class: 'ad' }, A.desc || ''),
    ]);
  };
  el.append(
    h('div', { class: 'who' }, who),
    h('div', { class: 'hname', style: `color:${H.color}` }, H.name),
    h('div', { class: 'htitle' }, H.title),
    h('div', { class: 'hmeta' }, [
      h('span', { class: `attr ${H.attr}` }, [h('i'), ATTR_NAME[H.attr]]),
      h('span', {}, (H.roles || []).join(' · ')),
      h('span', { class: 'diff' }, ['Difficulty', ...[1, 2, 3].map((k) => h('i', { class: k <= (H.diff || 1) ? 'on' : '' }))]),
    ]),
    h('div', { class: 'blurb' }, H.blurb || ''),
    h('div', { class: 'stats' }, [
      ...stat('Health', S.hpBase, 1300), ...stat('Mana', S.mana, 340), ...stat('Armor', S.armor, 25, S.armor + '%'),
      ...stat('M. Res', S.mr, 25, S.mr + '%'), ...stat('Speed', S.walkF / 100, 5.2, (S.walkF / 100).toFixed(1)),
    ]),
    ab('P'), ab('Q'), ab('W'), ab('E'), ab('R'),
  );
  if (extra) el.append(extra);
  if (locked) el.append(h('div', { class: 'locked-banner' }, 'LOCKED IN'));
  return el;
}

export class CharSelect {
  // opts: { mode: 'cpu'|'local'|'training'|'online', online: { client, local, host, names }, keep: {heroes} }
  constructor(app, opts) {
    this.app = app;
    this.mode = opts.mode;
    this.online = opts.online || null;
    const keep = opts.keep && opts.keep.heroes;
    this.p = [0, 1].map((i) => ({ cur: keep ? HERO_LIST.indexOf(keep[i]) : (i === 0 ? 0 : 3), locked: false, hero: null, prev: 0 }));
    this.phase = this.mode === 'cpu' || this.mode === 'training' ? 'p0' : 'both';
    this.stageCur = 0;
    if (this.mode === 'local') this.devs = ['left|pad0', 'right|pad1'];
    else this.devs = ['any', 'any'];
    this.cpuLevel = app.settings.cpuLevel;
  }

  enter() {
    const A = this.app;
    A.shade('select');
    A.renderer.viewT = { zoom: 0.74, shift: 0, lift: 0.12 };
    A.hudRoot.classList.add('hidden');
    A.audio.music('select');
    this.root = h('div', { class: 'select-screen' });
    A.ui.append(this.root);
    this.previewKey = '';
    this.draw();
    this.updatePreview(true);
    if (this.online) {
      const C = this.online.client;
      this.offs = [
        C.on('sel', (m) => { const r = this.p[1 - this.online.local]; r.cur = m.cur; r.locked = m.locked; this.draw(); this.updatePreview(); this.checkBoth(); }),
        C.on('start', (m) => this.startOnline(m)),
        C.on('peer_left', () => { toast('Your opponent left the lane.', true); this.leaveOnline(); }),
        C.on('room_closed', () => { toast('The host closed the lane.', true); this.leaveOnline(); }),
        C.on('close', () => { toast('Lost connection to the server.', true); this.leaveOnline(); }),
        C.on('stagepick', (m) => { this.stageCur = m.cur; this.draw(); this.updatePreview(); }),
      ];
      this.sendSel();
    }
  }
  exit() { if (this.offs) for (const o of this.offs) o(); clearTimeout(this.pvT); }

  // Which player slots this client controls right now
  controllers() {
    if (this.online) return [this.online.local];
    if (this.phase === 'p0') return [0];
    if (this.phase === 'p1') return [1];
    if (this.phase === 'stage') return [0];
    return [0, 1];
  }

  update() {
    const A = this.app;
    // poll devices (edge detection) — this works for keyboards and gamepads alike
    const ctrl = this.phase === 'stage' ? (this.online ? (this.online.host ? [this.online.local] : []) : [0]) : this.controllers();
    for (const slot of ctrl) {
      const devSlot = this.online ? 0 : (this.mode === 'local' ? slot : 0);
      const dev = this.devs[devSlot];
      const bits = A.input.bits(dev);
      const P = this.p[devSlot];
      const pr = bits & ~P.prev;
      P.prev = bits;
      if (pr & I.LEFT) this.move(slot, -1);
      if (pr & I.RIGHT) this.move(slot, 1);
      if (pr & I.UP) this.adjCpu(slot, 1);
      if (pr & I.DOWN) this.adjCpu(slot, -1);
      if (pr & I.B_L) this.confirm(slot);
      if (pr & I.B_M) this.back(slot);
    }
    return null;
  }

  nav(a, src, e) {
    // Enter / Escape / gamepad start as conveniences (single-controller modes)
    if (e && e.code === 'Enter') this.confirm(this.controllers()[0]);
    else if (e && e.code === 'Escape') this.back(this.controllers()[0]);
    else if (a === 'pause' && src && src.startsWith('pad')) this.back(this.controllers()[0]);
  }

  adjCpu(slot, d) {
    if (this.mode !== 'cpu' || this.phase !== 'p1') return;
    this.cpuLevel = Math.max(0, Math.min(3, this.cpuLevel + d));
    this.app.saveSettings({ cpuLevel: this.cpuLevel });
    this.app.audio.play('ui_move');
    this.draw();
  }

  move(slot, d) {
    const A = this.app;
    if (this.phase === 'stage') {
      const n = PLAY_STAGES.length + 1;
      this.stageCur = (this.stageCur + d + n) % n;
      A.audio.play('ui_move');
      if (this.online) this.online.client.send({ t: 'stagepick', cur: this.stageCur });
      this.draw(); this.updatePreview();
      return;
    }
    const P = this.p[slot];
    if (P.locked) return;
    P.cur = (P.cur + d + ROSTER.length) % ROSTER.length;
    A.audio.play('ui_move');
    this.draw();
    this.updatePreview();
    this.sendSel();
  }

  confirm(slot) {
    const A = this.app;
    if (this.phase === 'stage') {
      if (this.online && !this.online.host) return;
      A.audio.play('ui_select');
      this.start();
      return;
    }
    const P = this.p[slot];
    if (P.locked) return;
    if (ROSTER[P.cur] === 'random') P.cur = Math.floor(Math.random() * HERO_LIST.length);
    P.locked = true;
    A.audio.play('ui_ready');
    this.updatePreview(true);
    const bd = A.backdrop;
    if (bd && bd.G) { const f = bd.G.fighters[slot]; f.act = 'win'; f.af = 0; }
    if (this.phase === 'p0') this.phase = 'p1';
    else if (this.phase === 'p1') this.phase = 'stage';
    this.sendSel();
    this.checkBoth();
    this.draw();
  }

  back(slot) {
    const A = this.app;
    A.audio.play('ui_back');
    if (this.phase === 'stage') {
      if (this.online && !this.online.host) return;
      if (this.online) { this.p[this.online.local].locked = false; this.phase = 'both'; this.sendSel(); }
      else { this.phase = this.mode === 'local' ? 'both' : 'p1'; this.p[this.mode === 'local' ? 0 : 1].locked = false; if (this.mode === 'local') this.p[1].locked = false; }
      this.updatePreview(true); this.draw();
      return;
    }
    const P = this.p[slot];
    if (P.locked) { P.locked = false; this.updatePreview(true); this.sendSel(); this.draw(); return; }
    if (this.phase === 'p1') { this.phase = 'p0'; this.p[0].locked = false; this.updatePreview(true); this.draw(); return; }
    if (this.online) { this.leaveOnline(); return; }
    import('./screens.js').then(({ MainMenu }) => A.go(new MainMenu(A, { cpu: 1, local: 2, training: 4 }[this.mode] || 0)));
  }

  checkBoth() {
    if (this.phase === 'both' && this.p[0].locked && this.p[1].locked) {
      this.phase = 'stage';
      this.draw();
      this.updatePreview();
    }
  }

  sendSel() {
    if (!this.online) return;
    const P = this.p[this.online.local];
    this.online.client.send({ t: 'sel', cur: P.cur, locked: P.locked });
  }

  heroAt(slot) {
    const id = ROSTER[this.p[slot].cur];
    return id === 'random' ? null : id;
  }

  updatePreview(now) {
    clearTimeout(this.pvT);
    const run = () => {
      const heroes = [this.heroAt(0) || 'aldric', this.heroAt(1) || 'kaida'];
      const stage = this.phase === 'stage' ? this.stageId() : (this.app.backdropStage || 'river');
      const key = heroes.join() + stage;
      if (key === this.previewKey) {
        // still update lock poses
        const bd = this.app.backdrop;
        if (bd) for (let i = 0; i < 2; i++) { const f = bd.G.fighters[i]; if (this.p[i].locked && f.act !== 'win') { f.act = 'win'; f.af = 0; } if (!this.p[i].locked && f.act === 'win') f.act = 'idle'; }
        return;
      }
      this.previewKey = key;
      this.app.setBackdrop({ heroes, stage, idle: true });
      const bd = this.app.backdrop;
      for (let i = 0; i < 2; i++) if (this.p[i].locked) { bd.G.fighters[i].act = 'win'; bd.G.fighters[i].af = 30; }
    };
    if (now) run(); else this.pvT = setTimeout(run, 160);
  }

  stageId() {
    if (this.stageCur >= PLAY_STAGES.length) return this.randomStage || (this.randomStage = PLAY_STAGES[Math.floor(Math.random() * PLAY_STAGES.length)].id);
    return PLAY_STAGES[this.stageCur].id;
  }

  draw() {
    const R = this.root;
    clear(R);
    const titles = { cpu: 'Versus CPU', local: 'Local Versus', training: 'Training', online: 'LAN Battle' };
    const sub = this.phase === 'stage' ? 'Choose the battlefield' : this.phase === 'p1' ? (this.mode === 'training' ? 'Choose the training dummy' : 'Choose your opponent') : 'Choose your hero';
    R.append(h('div', { class: 'sel-top' }, [h('div', { class: 'eyebrow' }, titles[this.mode]), h('div', { class: 'h1' }, sub)]));
    const names = this.online ? this.online.names : null;
    const who = (i) => {
      if (this.online) return [h('span', {}, i === 0 ? '1P' : '2P'), (names && names[i]) || (i === this.online.local ? 'You' : 'Opponent')];
      if (this.mode === 'cpu' && i === 1) return [h('span', {}, 'CPU'), ` · ${AI_LEVELS[this.cpuLevel].name}`, this.phase === 'p1' ? h('span', { class: 'muted' }, '  (W/S to change)') : null];
      if (this.mode === 'training' && i === 1) return 'Dummy';
      return i === 0 ? 'Player 1' : 'Player 2';
    };
    for (let i = 0; i < 2; i++) {
      const id = this.heroAt(i);
      if (id) R.append(heroPanel(id, i === 0 ? 'left' : 'right', who(i), this.p[i].locked));
      else R.append(h('div', { class: `hinfo panel ${i === 0 ? 'left' : 'right'}` }, [h('div', { class: 'who' }, who(i)), h('div', { class: 'hname' }, 'Random'), h('div', { class: 'htitle' }, 'Let fate choose')]));
    }
    if (this.phase === 'stage') {
      const strip = h('div', { class: 'stage-strip' });
      [...PLAY_STAGES, { id: 'random', name: 'Random', sub: 'Any battlefield', palette: { accent: '#888', dark: '#222', light: '#ccc' } }].forEach((s, k) => {
        const pal = s.palette || { accent: '#e8c26a', dark: '#111', light: '#fff' };
        strip.append(h('div', {
          class: 'stage-card' + (k === this.stageCur ? ' sel' : ''),
          style: `background: linear-gradient(160deg, ${pal.light}55, ${pal.accent}aa 45%, ${pal.dark} 100%)`,
          onclick: () => { if (this.online && !this.online.host) return; if (k === this.stageCur) this.confirm(0); else { this.stageCur = k; this.draw(); this.updatePreview(); if (this.online) this.online.client.send({ t: 'stagepick', cur: k }); } },
        }, [h('div', { class: 'sn' }, s.name), h('div', { class: 'ss' }, s.sub || '')]));
      });
      R.append(strip);
      const waiting = this.online && !this.online.host;
      R.append(h('div', { class: 'sel-hint', style: 'bottom:150px' }, waiting ? 'The host is choosing the battlefield…' : this.hint('stage')));
      return;
    }
    const roster = h('div', { class: 'roster' });
    ROSTER.forEach((id, k) => {
      const cls = ['hero-card'];
      const on0 = this.p[0].cur === k, on1 = this.p[1].cur === k && this.phase !== 'p0';
      if (on0) cls.push('p1');
      if (on1) cls.push('p2');
      if (id === 'random') cls.push('random');
      const H = HEROES[id];
      roster.append(h('div', {
        class: cls.join(' '),
        onclick: () => {
          const slot = this.controllers()[0];
          if (slot == null || this.p[slot].locked) return;
          if (this.p[slot].cur === k) this.confirm(slot); else { this.p[slot].cur = k; this.app.audio.play('ui_move'); this.draw(); this.updatePreview(); this.sendSel(); }
        },
      }, [
        H ? h('div', { class: 'hc-sig', html: heroIconSVG(id, 62) }) : h('div', { class: 'hc-sig', html: '<svg viewBox="0 0 64 64"><text x="32" y="44" text-anchor="middle" font-size="40" fill="#9da3bd" font-family="Cinzel">?</text></svg>' }),
        H ? h('div', { class: 'hc-attr', style: `background:${ATTR_COLOR[H.attr]}` }) : null,
        h('div', { class: 'hc-name' }, H ? H.name : 'Random'),
        on0 ? h('span', { class: 'tagp t1' }, this.online && this.online.local === 1 ? 'P1' : '1P') : null,
        on1 ? h('span', { class: 'tagp t2' }, this.mode === 'cpu' ? 'CPU' : '2P') : null,
      ]));
    });
    R.append(roster);
    R.append(h('div', { class: 'sel-hint' }, this.hint('hero')));
  }

  hint(kind) {
    const L = this.app.input.layouts;
    const lay = this.mode === 'local' ? 'left' : 'solo';
    const k = (a) => keyLabel((L[lay][a] || [])[0]);
    if (this.mode === 'local' && kind === 'hero') {
      const k2 = (a) => keyLabel((L.right[a] || [])[0]);
      return `P1: ${k('left')}/${k('right')} move · ${k('L')} confirm · ${k('M')} back      P2: ${k2('left')}/${k2('right')} move · ${k2('L')} confirm · ${k2('M')} back      (gamepads: X confirm · Y back)`;
    }
    return `${k('left')} / ${k('right')} choose · ${k('L')} or Enter confirm · ${k('M')} or Esc back${this.mode === 'cpu' && this.phase === 'p1' ? ` · ${k('up')}/${k('down')} CPU difficulty` : ''}`;
  }

  // ---------------------------------------------------------------------------
  matchCfg(seed) {
    const S = this.app.settings;
    const heroes = [HERO_LIST[this.p[0].cur], HERO_LIST[this.p[1].cur]];
    return {
      mode: this.mode, heroes, stage: this.stageId(), seed,
      devices: this.devs,
      ai: this.mode === 'cpu' ? [null, this.cpuLevel] : [null, null],
      roundsToWin: S.roundsToWin, runes: S.runes, shop: S.shop,
      tr: this.mode === 'training' ? { dummy: 'stand', block: 'none', infinite: true, refill: true } : null,
    };
  }

  start() {
    const seed = (Math.random() * 2 ** 31) >>> 0;
    if (this.online) {
      const S = this.app.settings;
      const msg = { t: 'start', seed, heroes: [HERO_LIST[this.p[0].cur], HERO_LIST[this.p[1].cur]], stage: this.stageId(), delay: S.delay, roundsToWin: S.roundsToWin, runes: S.runes, shop: S.shop, echo: true };
      this.online.client.send(msg);
      return;
    }
    this.app.go(new Battle(this.app, this.matchCfg(seed)));
  }

  startOnline(m) {
    const O = this.online;
    this.app.go(new Battle(this.app, {
      mode: 'online', heroes: m.heroes, stage: m.stage, seed: m.seed, devices: ['any', 'any'], ai: [null, null],
      roundsToWin: m.roundsToWin, runes: m.runes, shop: m.shop,
      online: { client: O.client, local: O.local, delay: m.delay, host: O.host, names: O.names },
    }));
  }

  leaveOnline() {
    const A = this.app;
    if (this.left) return;
    this.left = true;
    if (this.online.client.open) this.online.client.send({ t: 'leave' });
    import('./lobby.js').then(({ Lobby }) => A.go(new Lobby(A, this.online.client)));
  }
}
