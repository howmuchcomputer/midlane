// Battle screen: runs a Match, drives HUD/audio, pause menu, move list, results.
import { h, clear, toast } from './dom.js';
import { Match, playEventAudio } from '../game/match.js';
import { HUD } from './hud.js';
import { HEROES } from '../sim/heroes/index.js';
import { STAGE_BY_ID } from '../render/stages/index.js';
import { keyLabel } from '../input/input.js';
import { MANA, ULT_LEVEL, SHOP_FRAMES } from '../sim/const.js';

const NORMAL_INPUT = { stL: 'L', stM: 'M', stH: 'H', crL: '↓ + L', crM: '↓ + M', crH: '↓ + H', jL: 'Air L', jM: 'Air M', jH: 'Air H', fH: '→ + H', fM: '→ + M', throw: 'L + M' };

export class Battle {
  constructor(app, cfg) { this.app = app; this.cfg = cfg; }

  enter() {
    const A = this.app;
    const cfg = this.cfg;
    A.shade('');
    A.renderer.viewT = { zoom: 1, shift: 0, lift: 0 };
    A.renderer.view = { zoom: 1, shift: 0, lift: 0 };
    A.backdrop = null;
    this.match = new Match(A, cfg);
    A.renderer.setStage(cfg.stage);
    A.renderer.setFighters(cfg.heroes);
    A.renderer.showBoxes = false;
    this.local = this.match.local;
    const names = cfg.online ? cfg.online.names : cfg.mode === 'cpu' ? ['You', 'CPU'] : cfg.mode === 'training' ? ['You', 'Dummy'] : ['P1', 'P2'];
    this.hud = new HUD(A.hudRoot, { heroes: cfg.heroes, names, local: this.local, keyLabels: [this.keyLabels(0), this.keyLabels(1)], mode: cfg.mode });
    const st = STAGE_BY_ID[cfg.stage];
    A.audio.music(st ? st.music : 'stage_river');
    A.audio.setIntensity(0.45);
    // Quick play uses only the short in-arena countdown before you can move.
    if (cfg.quick) this.splashT = 0;
    else this.splash(cfg, st);
    if (cfg.quick) {
      const L = A.input.layouts.solo;
      const keys = (actions) => actions.map((a) => keyLabel((L[a] || [])[0])).join(' / ');
      const controls = A.input.pads().length
        ? 'Stick / D-pad move · X / Y / RB attack · A / B / RT abilities · Start pause'
        : `${keys(['up', 'left', 'down', 'right'])} move · ${keys(['L', 'M', 'H'])} attack · ${keys(['Q', 'W', 'E'])} abilities · Esc pause`;
      this.quickHint = h('div', { class: 'quick-controls' }, controls);
      this.quickHintT = 14;
      A.ui.append(this.quickHint);
    }
    this.overT = 0;
    this.resultsShown = false;
    this.paused = false;
    this.rematch = [false, false];
    if (cfg.online) {
      const C = cfg.online.client;
      this.offs = [
        C.on('peer_left', () => this.netGone('Your opponent left the match.')),
        C.on('room_closed', () => this.netGone('The host closed the lane.')),
        C.on('close', () => this.netGone('Lost connection to the server.')),
        C.on('rematch', () => { this.rematch[1 - cfg.online.local] = true; this.checkRematch(); if (this.resEl) this.drawResults(); }),
        C.on('tochars', () => this.toChars(true)),
        C.on('start', (m) => this.restartOnline(m)),
      ];
    }
    this.fpsEl = A.settings.showFps ? h('div', { style: 'position:absolute;right:10px;bottom:8px;color:#9da3bd;font-size:12px' }) : null;
    if (this.fpsEl) A.ui.append(this.fpsEl);
  }

  exit() {
    if (this.offs) for (const o of this.offs) o();
    this.match.dispose();
    this.hud.destroy();
  }

  keyLabels(i) {
    const dev = (this.cfg.devices || [])[i] || 'any';
    const A = this.app;
    const lay = dev.startsWith('left') ? 'left' : dev.startsWith('right') ? 'right' : 'solo';
    const L = A.input.layouts[lay];
    const k = (a) => keyLabel((L[a] || [])[0]);
    if (dev.startsWith('pad')) return { Q: 'A', W: 'B', E: 'RT', R: 'LB', L: 'X', M: 'Y', H: 'RB' };
    return { Q: k('Q'), W: k('W'), E: k('E'), R: k('R'), L: k('L'), M: k('M'), H: k('H') };
  }

  splash(cfg, st) {
    const A = this.app;
    const [a, b] = cfg.heroes.map((id) => HEROES[id]);
    this.splashT = 1.8;
    this.splashEl = h('div', { class: 'vs-splash' }, [
      h('div', { class: 'vsn l', style: `color:${a.color}` }, a.name), h('div', { class: 'vs' }, 'VS'), h('div', { class: 'vsn r', style: `color:${b.color}` }, b.name),
      h('div', { class: 'stg' }, st ? st.name : ''),
    ]);
    A.ui.append(this.splashEl);
    A.audio.play('round');
  }

  update(dt) {
    const A = this.app;
    let evs = [];
    if (this.splashT > 0) {
      this.splashT -= dt;
      if (this.splashT <= 0 && this.splashEl) { this.splashEl.remove(); this.splashEl = null; }
    } else evs = this.match.update(dt);
    const G = this.match.G;
    if (this.quickHint && !this.match.paused && G.phase === 'fight') {
      this.quickHintT -= dt;
      if (this.quickHintT <= 0) { this.quickHint.remove(); this.quickHint = null; }
    }
    for (const e of evs) {
      this.hud.onEvent(e, G);
      playEventAudio(A, e, G, { local: this.local });
    }
    const net = this.match.session ? this.match.session.info() : null;
    this.hud.update(G, net);
    this.hud.tick(dt);
    if (this.cfg.mode === 'training') this.hud.training(this.match.tinfo);
    // music intensity: final round / low health
    const need = G.cfg.roundsToWin;
    const final = !G.cfg.training && G.wins[0] === need - 1 && G.wins[1] === need - 1;
    const low = Math.min(...G.fighters.map((f) => f.hp / f.mhp));
    A.audio.setIntensity(final ? 0.95 : Math.min(0.9, 0.42 + (1 - low) * 0.45));
    if (net && net.desync >= 0 && !this.desyncWarned) { this.desyncWarned = true; toast('Desync detected — the two games disagree. Please report this!', true, 6000); }
    if (G.phase === 'over' && !this.resultsShown) {
      this.overT += dt;
      if (this.overT > 2.8) this.showResults();
    }
    if (this.fpsEl) this.fpsEl.textContent = `${Math.round(A.fps)} fps`;
    return { G, events: evs };
  }

  nav(a, src, e) {
    if (this.resEl) return this.resultsNav(a);
    if (this.pauseEl) return this.pauseNav(a, e);
    if (a === 'pause') this.openPause();
  }

  // ---------------------------------------------------------------------------
  openPause() {
    if (this.resultsShown) return;
    const A = this.app;
    this.match.paused = true;
    A.audio.play('ui_select');
    this.pauseSel = 0;
    this.pauseEl = h('div', { class: 'pause' });
    A.ui.append(this.pauseEl);
    this.drawPause();
  }
  pauseItems() {
    const A = this.app;
    const M = this.match;
    const tr = M.G.cfg.tr;
    const items = [['Resume', () => this.closePause()]];
    if (this.cfg.mode === 'training') {
      const dummies = ['stand', 'crouch', 'jump', 'cpu'];
      const blocks = ['none', 'all', 'after'];
      items.push(
        [`Dummy: ${M.trainingDummy}`, (d = 1) => { M.setTrainingDummy(dummies[(dummies.indexOf(M.trainingDummy) + d + 4) % 4]); }],
        [`Dummy blocks: ${tr.block === 'after' ? 'after first hit' : tr.block}`, (d = 1) => { tr.block = blocks[(blocks.indexOf(tr.block) + d + 3) % 3]; }],
        [`Infinite mana & cooldowns: ${tr.infinite ? 'on' : 'off'}`, () => { tr.infinite = !tr.infinite; }],
        [`Show hitboxes: ${A.renderer.showBoxes ? 'on' : 'off'}`, () => { A.renderer.showBoxes = !A.renderer.showBoxes; }],
        ['Open item shop', () => { const G = M.G; G.phase = 'shop'; G.pt = SHOP_FRAMES; for (const s of G.shop) s.ready = false; this.closePause(); }],
      );
    }
    items.push(['Move list', () => this.moveList()]);
    if (!this.cfg.online) items.push(['Restart match', () => A.go(new Battle(A, Object.assign({}, this.cfg, { seed: (Math.random() * 2 ** 31) >>> 0 })))]);
    if (!this.cfg.online) items.push(['Character select', () => this.toChars()]);
    items.push([this.cfg.online ? 'Leave match' : 'Main menu', () => this.quit()]);
    return items;
  }
  drawPause() {
    clear(this.pauseEl);
    const items = this.pauseItems();
    this.pauseSel = Math.min(this.pauseSel, items.length - 1);
    const list = h('div', { class: 'menu-list' });
    items.forEach(([n, fn], i) => list.append(h('div', { class: 'menu-item' + (i === this.pauseSel ? ' sel' : ''), onmouseenter: () => {
      this.pauseSel = i;
      [...list.children].forEach((el, k) => el.classList.toggle('sel', k === i));
    }, onclick: () => { fn(); if (this.pauseEl) this.drawPause(); } }, [h('div', { class: 'mi-name' }, n)])));
    this.pauseEl.append(h('div', { class: 'panel' }, [h('div', { class: 'eyebrow', style: 'margin-bottom:10px' }, this.cfg.online ? 'Menu — the match keeps running' : 'Paused'), list]));
  }
  pauseNav(a, e) {
    if (this.moveEl) { if (a === 'back' || a === 'pause' || a === 'confirm') { this.moveEl.remove(); this.moveEl = null; } return; }
    const items = this.pauseItems();
    if (a === 'up') this.pauseSel = (this.pauseSel + items.length - 1) % items.length;
    else if (a === 'down') this.pauseSel = (this.pauseSel + 1) % items.length;
    else if (a === 'confirm' || a === 'right') { items[this.pauseSel][1](1); }
    else if (a === 'left') { items[this.pauseSel][1](-1); }
    else if (a === 'back' || a === 'pause') { this.closePause(); return; }
    this.app.audio.play('ui_move');
    if (this.pauseEl) this.drawPause();
  }
  closePause() {
    if (this.pauseEl) { this.pauseEl.remove(); this.pauseEl = null; }
    if (this.moveEl) { this.moveEl.remove(); this.moveEl = null; }
    this.match.paused = false;
    this.match.acc = 0;
  }

  moveList() {
    const A = this.app;
    const slot = this.cfg.online ? this.cfg.online.local : 0;
    const H = HEROES[this.cfg.heroes[slot]];
    const rows = [];
    rows.push(h('div', { class: 'eyebrow', style: 'margin:4px 0 6px' }, `${H.name} — ${H.title}`));
    rows.push(h('div', { class: 'ml-row' }, [h('span', { class: 'mi' }, 'Passive'), h('span', { class: 'md' }, [h('b', {}, H.passive.name + ' — '), H.passive.desc]), h('span', { class: 'mf' }, '')]));
    for (const s of ['Q', 'W', 'E', 'R']) {
      const ab = H.abilities[s];
      if (!ab) continue;
      const m = H.moves[s];
      rows.push(h('div', { class: 'ml-row' }, [h('span', { class: 'mi' }, `${s === 'R' ? 'Ult' : s} · ${ab.name}`), h('span', { class: 'md' }, ab.desc), h('span', { class: 'mf' }, `${m.cost / MANA} mp · ${(ab.cd / 60).toFixed(1)}s${s === 'R' ? ` · Lv${ULT_LEVEL}` : ''}`)]));
    }
    for (const id of ['stL', 'stM', 'stH', 'crL', 'crM', 'crH', 'fM', 'fH', 'jL', 'jM', 'jH', 'throw']) {
      const m = H.moves[id];
      if (!m) continue;
      const hit = m.hits[0];
      const lvl = hit ? (hit.lvl === 'low' ? 'Low' : hit.lvl === 'over' ? 'Overhead' : hit.grab ? 'Throw' : 'Mid') : '';
      const adv = m.adv && !m.air ? ` · ${m.adv[0] >= 0 ? '+' : ''}${m.adv[0]}/${m.adv[1] >= 0 ? '+' : ''}${m.adv[1]}` : '';
      rows.push(h('div', { class: 'ml-row' }, [h('span', { class: 'mi' }, NORMAL_INPUT[id]), h('span', { class: 'md' }, `${m.name || (id === 'throw' ? 'Throw (tech with L+M)' : id)}${lvl ? ' — ' + lvl : ''}${m.kd ? ', knockdown' : ''}`), h('span', { class: 'mf' }, `${m.startup}f${adv}`)]));
    }
    rows.push(h('div', { class: 'ml-row' }, [h('span', { class: 'mi' }, 'Dash in a combo'), h('span', { class: 'md' }, 'Rush cancel — burst forward out of a connecting normal (25 mana).'), h('span', { class: 'mf' }, '')]));
    rows.push(h('div', { class: 'ml-row' }, [h('span', { class: 'mi' }, 'Dash when hit'), h('span', { class: 'md' }, 'Dispel — knock the attacker away (50 mana, 9 s cooldown).'), h('span', { class: 'mf' }, '')]));
    this.moveEl = h('div', { class: 'pause', onclick: () => { this.moveEl.remove(); this.moveEl = null; } }, [h('div', { class: 'panel movelist', style: 'padding:18px 22px' }, rows)]);
    A.ui.append(this.moveEl);
  }

  // ---------------------------------------------------------------------------
  showResults() {
    this.resultsShown = true;
    if (this.pauseEl) this.closePause();
    this.resSel = 0;
    this.resEl = h('div', { class: 'results' });
    this.app.ui.append(this.resEl);
    this.app.shade('menu');
    this.app.audio.music('results');
    this.drawResults();
  }
  resultButtons() {
    const A = this.app;
    if (this.cfg.online) {
      const me = this.cfg.online.local;
      return [
        [this.rematch[me] ? (this.rematch[1 - me] ? 'Starting…' : 'Waiting for opponent…') : (this.rematch[1 - me] ? 'Accept rematch' : 'Rematch'), () => { if (!this.rematch[me]) { this.rematch[me] = true; this.cfg.online.client.send({ t: 'rematch' }); this.checkRematch(); this.drawResults(); } }],
        ['Character select', () => { this.cfg.online.client.send({ t: 'tochars' }); this.toChars(true); }],
        ['Leave', () => this.quit()],
      ];
    }
    return [
      ['Rematch', () => A.go(new Battle(A, Object.assign({}, this.cfg, { seed: (Math.random() * 2 ** 31) >>> 0 })))],
      ['Character select', () => this.toChars()],
      ['Main menu', () => this.quit()],
    ];
  }
  drawResults() {
    const G = this.match.G;
    const R = this.resEl;
    clear(R);
    const w = G.winner;
    const W = w >= 0 ? HEROES[G.fighters[w].h] : null;
    const me = this.cfg.online ? this.cfg.online.local : 0;
    const label = w < 0 ? 'Draw' : this.cfg.mode === 'cpu' ? (w === 0 ? 'Victory' : 'Defeat') : this.cfg.online ? (w === me ? 'Victory' : 'Defeat') : `Player ${w + 1} wins`;
    R.append(h('div', { class: 'wsub' }, label));
    R.append(h('div', { class: 'winner', style: W ? `color:${W.color}` : '' }, W ? W.name : 'Nobody'));
    if (W) R.append(h('div', { class: 'quote' }, W.title));
    const [a, b] = G.fighters;
    const rows = [
      ['Damage dealt', (f) => f.st.dealt],
      ['Longest combo', (f) => f.st.maxCombo],
      ['Abilities cast', (f) => f.st.abil],
      ['Ultimates', (f) => f.st.ults],
      ['Runes taken', (f) => f.st.runes],
      ['Throws', (f) => f.st.throws],
      ['Level', (f) => f.lv],
      ['Items', (f) => f.items.length],
    ];
    const t = h('table', { class: 'res-table' });
    t.append(h('tr', {}, [h('th', {}, ''), h('th', { style: `color:${HEROES[a.h].color}` }, HEROES[a.h].name), h('th', { style: `color:${HEROES[b.h].color}` }, HEROES[b.h].name)]));
    for (const [n, fn] of rows) {
      const va = fn(a), vb = fn(b);
      t.append(h('tr', {}, [h('td', {}, n), h('td', { class: va > vb ? 'best' : '' }, String(va)), h('td', { class: vb > va ? 'best' : '' }, String(vb))]));
    }
    R.append(t);
    const btns = h('div', { class: 'res-btns' });
    this.resultButtons().forEach(([n, fn], i) => btns.append(h('button', { class: 'btn' + (i === this.resSel ? ' sel' : ''), onclick: fn, onmouseenter: () => {
      this.resSel = i;
      [...btns.children].forEach((el, k) => el.classList.toggle('sel', k === i));
    } }, n)));
    R.append(btns);
  }
  resultsNav(a) {
    const n = this.resultButtons().length;
    if (a === 'left' || a === 'up') this.resSel = (this.resSel + n - 1) % n;
    else if (a === 'right' || a === 'down') this.resSel = (this.resSel + 1) % n;
    else if (a === 'confirm') { this.app.audio.play('ui_select'); this.resultButtons()[this.resSel][1](); return; }
    else return;
    this.app.audio.play('ui_move');
    this.drawResults();
  }

  checkRematch() {
    if (!this.cfg.online || !(this.rematch[0] && this.rematch[1])) return;
    if (this.cfg.online.host) {
      const c = this.cfg;
      c.online.client.send({ t: 'start', seed: (Math.random() * 2 ** 31) >>> 0, heroes: c.heroes, stage: c.stage, delay: c.online.delay, roundsToWin: c.roundsToWin, runes: c.runes, shop: c.shop, echo: true });
    }
  }
  restartOnline(m) {
    const c = this.cfg;
    this.app.go(new Battle(this.app, Object.assign({}, c, { heroes: m.heroes, stage: m.stage, seed: m.seed, roundsToWin: m.roundsToWin, runes: m.runes, shop: m.shop, online: Object.assign({}, c.online, { delay: m.delay }) })));
  }

  toChars() {
    const A = this.app;
    import('./select.js').then(({ CharSelect }) => {
      if (this.cfg.online) A.go(new CharSelect(A, { mode: 'online', online: { client: this.cfg.online.client, local: this.cfg.online.local, host: this.cfg.online.host, names: this.cfg.online.names }, keep: { heroes: this.cfg.heroes } }));
      else A.go(new CharSelect(A, { mode: this.cfg.mode, keep: { heroes: this.cfg.heroes } }));
    });
  }
  quit() {
    const A = this.app;
    if (this.cfg.online) {
      const C = this.cfg.online.client;
      if (C.open) C.send({ t: 'leave' });
      import('./lobby.js').then(({ Lobby }) => A.go(new Lobby(A, C)));
      return;
    }
    import('./screens.js').then(({ MainMenu }) => A.go(new MainMenu(A)));
  }
  netGone(msg) {
    if (this.gone) return;
    this.gone = true;
    toast(msg, true, 4000);
    const A = this.app;
    const C = this.cfg.online.client;
    setTimeout(() => import('./lobby.js').then(({ Lobby }) => A.go(new Lobby(A, C.open ? C : null))), 1200);
  }
}
