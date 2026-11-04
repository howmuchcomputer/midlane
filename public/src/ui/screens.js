// Title, main menu, how-to-play and options screens.
import { h, clear, toast } from './dom.js';
import { CharSelect } from './select.js';
import { Lobby } from './lobby.js';
import { ACTIONS, keyLabel, PAD_MAP } from '../input/input.js';
import { AI_LEVELS } from '../sim/ai.js';
import { ITEMS, RUNES } from '../sim/items.js';
import { itemIconSVG } from './hud.js';
import { iconSVG } from './icons.js';
import { ULT_LEVEL } from '../sim/const.js';
import { Battle } from './battle.js';
import { LAN_ENABLED, OFFLINE_BUILD } from '../features.js';

// A ready-to-play match: no selection screens or strategy shop to get through.
function playNow(app) {
  app.audio.unlock();
  app.go(new Battle(app, {
    mode: 'cpu', quick: true, heroes: ['aldric', 'ysolde'], stage: 'river',
    seed: (Math.random() * 2 ** 31) >>> 0,
    devices: ['any', 'any'], ai: [null, 0],
    roundsToWin: 2, runes: true, shop: false,
  }));
}

export class TitleScreen {
  constructor(app) { this.app = app; this.sel = 0; }
  enter() {
    const A = this.app;
    A.shade('title');
    A.renderer.viewT = { zoom: 1.05, shift: 0, lift: 0.2 };
    this.actions = [() => playNow(A), () => A.go(new MainMenu(A))];
    this.buttons = [
      h('button', { type: 'button', class: 'btn play-now', onclick: () => this.activate(0), onfocus: () => this.select(0), 'aria-describedby': 'quick-play-description' }, 'Play now'),
      h('button', { type: 'button', class: 'btn ghost', onclick: () => this.activate(1), onfocus: () => this.select(1) }, 'More ways to play'),
    ];
    this.el = h('div', { class: 'title-screen' }, [
      h('div', { class: 'title-content' }, [
        h('div', { class: 'logo' }, 'MIDLANE'),
        h('div', { class: 'tag' }, 'A Duel of Heroes'),
        h('p', { class: 'title-pitch' }, 'Six heroes. One lane. Jump straight into the fight.'),
        h('div', { class: 'title-actions' }, this.buttons),
        h('p', { id: 'quick-play-description', class: 'quick-play-description' }, 'You’re Aldric · Easy CPU · No setup or shop'),
        h('p', { class: 'title-help' }, 'Choose heroes, play with a friend, or train in More ways to play.'),
        h('p', { class: 'title-input-hint' }, 'Keyboard or gamepad · Enter or A to play'),
      ]),
      h('div', { class: 'ver' }, `v1.0 · ${LAN_ENABLED ? 'LAN' : OFFLINE_BUILD ? 'Offline' : 'Browser'} edition`),
    ]);
    A.ui.append(this.el);
    A.audio.music('menu');
    this.select(0);
    this.buttons[0].focus({ preventScroll: true });
  }
  select(i) {
    this.sel = i;
    this.buttons.forEach((button, k) => button.classList.toggle('sel', k === i));
  }
  nav(a, src, e) {
    if (e && e.repeat) return;
    if (a === 'up' || a === 'down' || a === 'left' || a === 'right') {
      this.select(1 - this.sel);
      this.buttons[this.sel].focus({ preventScroll: true });
    } else if (a === 'confirm' || (a === 'pause' && src && src.startsWith('pad'))) {
      if (e) e.preventDefault(); // Avoid a second native button click from Enter.
      this.activate(this.sel);
    }
  }
  activate(i) {
    if (this.done) return;
    this.done = true;
    this.app.audio.unlock();
    this.app.audio.play('ui_select');
    this.actions[i]();
  }
}

// ---------------------------------------------------------------------------
export class MainMenu {
  constructor(app, sel = 0) { this.app = app; this.sel = sel; }
  enter() {
    const A = this.app;
    A.shade('menu');
    A.renderer.viewT = { zoom: 0.95, shift: 0.4, lift: 0 };
    A.hudRoot.classList.add('hidden');
    if (!A.backdrop || A.backdrop.idle) A.setBackdrop();
    A.audio.music('menu');
    this.items = [
      ['Play now', 'Jump into a fight as Aldric against an Easy CPU. No setup or shop.', () => playNow(A)],
      ['Versus CPU', 'Fight the machine. Pick its hero and difficulty.', () => A.go(new CharSelect(A, { mode: 'cpu' }))],
      ['Local Versus', 'Two players, one machine — keyboard halves or gamepads.', () => A.go(new CharSelect(A, { mode: 'local' }))],
      [LAN_ENABLED ? 'LAN Battle' : 'Play with a friend', LAN_ENABLED ? 'Host or join a duel with someone on your network.' : 'Play on one computer, or get the LAN version for separate computers.', () => A.go(new Lobby(A))],
      ['Training', 'Frame data, hitboxes, infinite resources, a patient dummy.', () => A.go(new CharSelect(A, { mode: 'training' }))],
      ['How to Play', 'Controls, systems, and the MOBA layer explained.', () => A.go(new HowTo(A))],
      ['Options', 'Audio, graphics, rules and key bindings.', () => A.go(new Options(A))],
    ];
    this.list = h('div', { class: 'menu-list' });
    this.items.forEach(([n, d, fn], i) => {
      const el = h('button', { type: 'button', class: 'menu-item', onfocus: () => this.select(i), onmouseenter: () => this.select(i), onclick: () => { this.select(i); this.activate(); } }, [
        h('div', { class: 'mi-name' }, n), h('div', { class: 'mi-desc' }, d),
      ]);
      this.list.append(el);
    });
    A.ui.append(h('div', { class: 'main-menu' }, [h('div', { class: 'logo' }, 'MIDLANE'), h('div', { class: 'tag' }, 'A Duel of Heroes'), this.list]));
    A.ui.append(h('div', { class: 'footer-hints' }, [
      h('span', {}, [h('span', { class: 'kbd' }, 'W'), h('span', { class: 'kbd' }, 'S'), ' Move']),
      h('span', {}, [h('span', { class: 'kbd' }, 'Enter'), ' Select']),
      h('span', {}, [h('span', { class: 'kbd' }, 'Esc'), ' Back']),
    ]));
    this.select(this.sel, true);
    this.list.children[this.sel].focus({ preventScroll: true });
  }
  select(i, silent) {
    if (i !== this.sel && !silent) this.app.audio.play('ui_move');
    this.sel = (i + this.items.length) % this.items.length;
    [...this.list.children].forEach((el, k) => el.classList.toggle('sel', k === this.sel));
    this.list.children[this.sel].scrollIntoView({ block: 'nearest' });
  }
  activate() { this.app.audio.play('ui_select'); this.items[this.sel][2](); }
  nav(a, src, e) {
    if (a === 'up' || a === 'down') {
      this.select(this.sel + (a === 'up' ? -1 : 1));
      this.list.children[this.sel].focus({ preventScroll: true });
    }
    else if (a === 'confirm') { if (e) { e.preventDefault(); if (e.repeat) return; } this.activate(); }
    else if (a === 'back' || a === 'pause') { this.app.audio.play('ui_back'); this.app.go(new TitleScreen(this.app)); }
  }
}

// ---------------------------------------------------------------------------
export class HowTo {
  constructor(app) { this.app = app; }
  enter() {
    const A = this.app;
    A.shade('dark');
    const k = (s) => h('span', { class: 'kbd' }, s);
    const card = (title, body) => h('div', { class: 'card panel' }, [h('h3', {}, title), ...body]);
    const p = (...c) => h('p', {}, c);
    const page = h('div', { class: 'page' }, [
      h('div', { class: 'page-head' }, [h('div', {}, [h('div', { class: 'eyebrow' }, 'Field manual'), h('h1', { class: 'h1' }, 'How to Play')]), h('button', { class: 'btn', onclick: () => this.back() }, 'Back')]),
      h('div', { class: 'page-body grid2' }, [
        card('Controls — keyboard', [
          p(k('W'), k('A'), k('S'), k('D'), ' move · jump · crouch. Hold away from your opponent to block (crouch-block lows, stand-block overheads).'),
          p(k('J'), ' Light  ', k('K'), ' Medium  ', k('L'), ' Heavy  —  hold ', k('S'), ' for crouching versions, ', k('D'), '+', k('L'), ' (toward) for a command normal.'),
          p(k('U'), k('I'), k('O'), ' abilities Q / W / E  ·  ', k('Space'), ' Ultimate  ·  ', k('Shift'), ' dash (hold back for a backdash)  ·  ', k('J'), '+', k('K'), ' or ', k('H'), ' throw.'),
          p('Two players on one keyboard: P1 uses WASD + F G H / R T Y / V / LShift, P2 uses the arrows + , . / / K L ; / \' / RShift. Rebind everything in Options.'),
        ]),
        card('Controls — gamepad', [
          p('Stick or d-pad to move. ', h('b', {}, 'X'), ' Light, ', h('b', {}, 'Y'), ' Medium, ', h('b', {}, 'RB'), ' Heavy.'),
          p(h('b', {}, 'A'), ' / ', h('b', {}, 'B'), ' / ', h('b', {}, 'RT'), ' abilities Q / W / E, ', h('b', {}, 'LB'), ' Ultimate, ', h('b', {}, 'LT'), ' dash / dispel, ', h('b', {}, 'Start'), ' pause.'),
          p('Gamepads are picked up automatically: first pad is Player 1, second is Player 2.'),
        ]),
        card('Fighting fundamentals', [
          p(h('b', {}, 'Chains: '), 'Light → Medium → Heavy cancel into each other on contact (lights chain into lights too).'),
          p(h('b', {}, 'Cancels: '), 'Any normal (except sweeps) can be cancelled into an ability on hit or block. Some abilities cancel into your Ultimate.'),
          p(h('b', {}, 'Rush cancel: '), 'Press dash during a connecting normal to burst forward for 25 mana and keep the pressure going.'),
          p(h('b', {}, 'Throws '), 'beat blocking; press throw yourself within a few frames of being grabbed to tech. Strikes beat throws.'),
          p(h('b', {}, 'Counter hits: '), 'hitting someone during their startup deals extra damage and hitstun; punishing recovery is a Punish Counter.'),
          p(h('b', {}, 'Juggles, scaling, quick rise: '), 'launchers juggle, long combos scale down, and holding a button while knocked down makes you stand up faster.'),
        ]),
        card('The MOBA layer', [
          p(h('b', {}, 'Mana & cooldowns: '), 'abilities cost mana and have cooldowns. Mana regenerates and refills as you deal and take damage.'),
          p(h('b', {}, 'Levels: '), `everyone starts each match at level 1. Damage dealt and taken earns XP; levels raise damage and mana regen, abilities rank up at 3 and 5, and your `, h('b', {}, `Ultimate unlocks at level ${ULT_LEVEL}`), '. Levels carry across rounds.'),
          p(h('b', {}, 'Gold & items: '), 'damage, combos and rounds earn gold. Spend it in the strategy phase before round 1 and the shop between rounds (4 slots). Losing a round pays comeback gold.'),
          p(h('b', {}, 'Runes '), 'spawn mid-round — grab them for a burst of power:'),
          h('ul', {}, Object.values(RUNES).map((r) => h('li', {}, [h('b', { style: `color:${r.color}` }, r.name), ' — ', r.desc]))),
        ]),
        card('Defense', [
          p(h('b', {}, 'Dispel: '), 'press dash while being hit or blocking to burst the opponent away (50 mana, 9 s cooldown). Your escape from bad situations — budget your mana for it.'),
          p(h('b', {}, 'Backdash '), 'is briefly invulnerable. Several heroes have invulnerable reversals.'),
          p(h('b', {}, 'Attributes: '), h('span', { class: 'attr str' }, [h('i'), 'Strength']), ' heroes are durable, ', h('span', { class: 'attr agi' }, [h('i'), 'Agility']), ' heroes are fast, ', h('span', { class: 'attr int' }, [h('i'), 'Intelligence']), ' heroes have deep mana pools.'),
        ]),
        card('Items', ITEMS.map((it) => h('div', { style: 'display:flex;gap:10px;align-items:center;margin:4px 0' }, [h('span', { class: 'icon', style: 'width:30px;height:30px', html: itemIconSVG(it.id, 30) }), h('div', {}, [h('b', {}, `${it.name} `), h('span', { class: 'muted' }, `${it.cost}g — ${it.desc}`)])]))),
        card('LAN battles', [
          p('One machine runs the server (', h('span', { class: 'url' }, 'node server.js'), '). Everyone opens the LAN address it prints — e.g. ', h('span', { class: 'url' }, 'http://192.168.1.20:7878'), '.'),
          p('In ', h('b', {}, 'LAN Battle'), ', one player hosts a lane and the other joins it. Inputs are exchanged with rollback netcode, so your own inputs are always instant; short network hiccups are corrected invisibly.'),
        ]),
      ]),
    ]);
    A.ui.append(page);
  }
  back() { this.app.audio.play('ui_back'); this.app.go(new MainMenu(this.app, 5)); }
  nav(a) { if (a === 'back' || a === 'pause') this.back(); }
}

// ---------------------------------------------------------------------------
export class Options {
  constructor(app) { this.app = app; this.sel = 0; }
  enter() {
    const A = this.app;
    A.shade('dark');
    const S = () => A.settings;
    const vol = (key, label) => ({ label, get: () => Math.round(S()[key] * 100) + '%', bar: () => S()[key], adj: (d) => A.saveSettings({ [key]: Math.max(0, Math.min(1, Math.round((S()[key] + d * 0.05) * 100) / 100)) }) });
    const cyc = (key, label, vals, names) => ({ label, get: () => names[vals.indexOf(S()[key])] ?? String(S()[key]), adj: (d) => { const i = vals.indexOf(S()[key]); A.saveSettings({ [key]: vals[(i + d + vals.length) % vals.length] }); } });
    this.rows = [
      vol('master', 'Master volume'), vol('music', 'Music'), vol('sfx', 'Sound effects'), vol('voice', 'Announcer volume'),
      cyc('announcer', 'Announcer', [true, false], ['On', 'Off']),
      cyc('quality', 'Graphics', ['high', 'low'], ['High', 'Performance']),
      cyc('cpuLevel', 'CPU difficulty', [0, 1, 2, 3], AI_LEVELS.map((l) => l.name)),
      cyc('roundsToWin', 'Rounds to win', [1, 2, 3], ['1', '2', '3']),
      cyc('runes', 'Runes', [true, false], ['On', 'Off']),
      cyc('shop', 'Item shop', [true, false], ['On', 'Off']),
      cyc('delay', 'LAN input delay', [0, 1, 2, 3], ['0 frames', '1 frame', '2 frames', '3 frames']),
      cyc('showFps', 'Show FPS', [false, true], ['Off', 'On']),
    ];
    this.rowEls = [];
    const list = h('div', {});
    this.rows.forEach((r, i) => {
      const val = h('div', { class: 'val' });
      const el = h('div', { class: 'opt-row', onmouseenter: () => this.select(i), onclick: (e) => { this.select(i); this.adj(e.offsetX < el.clientWidth * 0.7 ? -1 : 1); } }, [h('div', { class: 'lbl' }, r.label), val]);
      this.rowEls.push({ el, val });
      list.append(el);
    });
    this.bindEl = h('div', {});
    A.ui.append(h('div', { class: 'page' }, [
      h('div', { class: 'page-head' }, [h('div', {}, [h('div', { class: 'eyebrow' }, 'Settings'), h('h1', { class: 'h1' }, 'Options')]), h('button', { class: 'btn', onclick: () => this.back() }, 'Back')]),
      h('div', { class: 'page-body grid2' }, [
        h('div', { class: 'card panel' }, [h('h3', {}, 'General'), list, h('p', { class: 'muted', style: 'font-size:13px' }, 'Graphics changes apply after reloading the page. ← → change a value.')]),
        h('div', { class: 'card panel' }, [h('h3', {}, 'Key bindings'), this.bindEl]),
      ]),
    ]));
    this.drawRows();
    this.drawBindings();
    this.select(0);
  }
  drawRows() {
    this.rows.forEach((r, i) => {
      const v = this.rowEls[i].val;
      clear(v);
      v.append(h('span', { class: 'arr' }, '‹'));
      if (r.bar) { const b = h('span', { class: 'bar' }, [h('i', { style: `width:${r.bar() * 100}%` })]); v.append(b); }
      v.append(h('span', {}, r.get()), h('span', { class: 'arr' }, '›'));
    });
  }
  drawBindings() {
    const A = this.app;
    clear(this.bindEl);
    const layouts = [['solo', 'Single player'], ['left', 'Local P1'], ['right', 'Local P2']];
    const tbl = h('table', { class: 'bind-table' });
    tbl.append(h('tr', {}, [h('th', {}, 'Action'), ...layouts.map((l) => h('th', {}, l[1])), h('th', {}, 'Pad')]));
    const padName = { 0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT' };
    for (const [act, label, bits] of ACTIONS) {
      const tr = h('tr', {}, [h('td', {}, label)]);
      for (const [lay] of layouts) {
        const codes = A.input.layouts[lay][act] || [];
        const td = h('td', { class: 'k', title: 'Click to rebind' }, [h('span', { class: 'kbd' }, keyLabel(codes[0]))]);
        td.onclick = () => {
          td.classList.add('wait');
          td.firstChild.textContent = '…';
          A.input.capture = (code) => {
            if (code !== 'Escape') { A.input.layouts[lay][act] = [code, ...codes.slice(1).filter((c) => c !== code)]; A.input.saveBindings(); A.audio.play('ui_select'); }
            this.drawBindings();
          };
        };
        tr.append(td);
      }
      const pk = Object.entries(PAD_MAP).find(([, b]) => b === bits);
      tr.append(h('td', { class: 'muted' }, pk ? (padName[pk[0]] || 'D-pad') : act === 'T' ? 'X+Y' : 'Stick'));
      tbl.append(tr);
    }
    this.bindEl.append(tbl, h('div', { style: 'margin-top:12px;display:flex;gap:10px' }, [
      h('button', { class: 'btn ghost', onclick: () => { A.input.resetBindings(); this.drawBindings(); toast('Bindings reset'); } }, 'Reset bindings'),
    ]));
  }
  select(i) {
    this.sel = (i + this.rows.length) % this.rows.length;
    this.rowEls.forEach((r, k) => r.el.classList.toggle('sel', k === this.sel));
  }
  adj(d) {
    this.rows[this.sel].adj(d);
    this.app.audio.play('ui_move');
    this.drawRows();
  }
  back() { this.app.audio.play('ui_back'); this.app.go(new MainMenu(this.app, 6)); }
  nav(a) {
    if (this.app.input.capture) return;
    if (a === 'up') { this.select(this.sel - 1); this.app.audio.play('ui_move'); }
    else if (a === 'down') { this.select(this.sel + 1); this.app.audio.play('ui_move'); }
    else if (a === 'left') this.adj(-1);
    else if (a === 'right' || a === 'confirm') this.adj(1);
    else if (a === 'back' || a === 'pause') this.back();
  }
}

export { iconSVG };
