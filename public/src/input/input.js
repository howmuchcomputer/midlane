// Keyboard + gamepad input. Produces game input bits per "device" and menu
// navigation events. Bindings are rebindable and persisted.
import * as I from '../sim/input.js';
import { loadSettings, saveSettings } from '../settings.js';

export const ACTIONS = [
  ['up', 'Up', I.UP], ['down', 'Down', I.DOWN], ['left', 'Left', I.LEFT], ['right', 'Right', I.RIGHT],
  ['L', 'Light', I.B_L], ['M', 'Medium', I.B_M], ['H', 'Heavy', I.B_H],
  ['Q', 'Ability 1', I.B_Q], ['W', 'Ability 2', I.B_W], ['E', 'Ability 3', I.B_E],
  ['R', 'Ultimate', I.B_R], ['S', 'Dash / Dispel', I.B_S], ['T', 'Throw (L+M)', I.B_L | I.B_M],
];
export const ACTION_BITS = Object.fromEntries(ACTIONS.map((a) => [a[0], a[2]]));

export const DEFAULT_LAYOUTS = {
  // One player on the keyboard (vs CPU, training, online)
  solo: {
    up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
    L: ['KeyJ'], M: ['KeyK'], H: ['KeyL'], Q: ['KeyU'], W: ['KeyI'], E: ['KeyO'], R: ['Space'], S: ['ShiftLeft', 'ShiftRight'], T: ['KeyH'],
  },
  // Two players sharing one keyboard
  left: {
    up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
    L: ['KeyF'], M: ['KeyG'], H: ['KeyH'], Q: ['KeyR'], W: ['KeyT'], E: ['KeyY'], R: ['KeyV'], S: ['ShiftLeft'], T: ['KeyB'],
  },
  right: {
    up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
    L: ['Comma', 'Numpad1'], M: ['Period', 'Numpad2'], H: ['Slash', 'Numpad3'], Q: ['KeyK', 'Numpad4'], W: ['KeyL', 'Numpad5'], E: ['Semicolon', 'Numpad6'],
    R: ['Quote', 'Numpad0'], S: ['ShiftRight', 'NumpadEnter'], T: ['KeyM', 'NumpadAdd'],
  },
};

// Standard gamepad mapping (Xbox naming): X=Light, Y=Medium, RB=Heavy, A=Ability1, B=Ability2, RT=Ability3, LB=Ultimate, LT=Dash/Dispel
export const PAD_MAP = { 2: I.B_L, 3: I.B_M, 5: I.B_H, 0: I.B_Q, 1: I.B_W, 7: I.B_E, 4: I.B_R, 6: I.B_S, 12: I.UP, 13: I.DOWN, 14: I.LEFT, 15: I.RIGHT };

export function keyLabel(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num' + code.slice(6);
  return { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Space', ShiftLeft: 'LShift', ShiftRight: 'RShift',
    Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", Enter: 'Enter', Backspace: 'Bksp', Escape: 'Esc',
    BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`', Backslash: '\\', Tab: 'Tab', ControlLeft: 'LCtrl', AltLeft: 'LAlt' }[code] || code;
}

export class Input {
  constructor() {
    this.down = new Set();
    this.latch = new Set(); // keys pressed since the last endFrame(), so sub-frame taps are never lost
    this.listeners = new Set();
    this.layouts = JSON.parse(JSON.stringify(DEFAULT_LAYOUTS));
    const saved = loadSettings().bindings;
    if (saved) for (const k of Object.keys(saved)) if (this.layouts[k]) Object.assign(this.layouts[k], saved[k]);
    this.capture = null; // rebinding callback
    this.padPrev = [0, 0, 0, 0];
    this.padNav = [{}, {}, {}, {}];
    this.typing = false;
    addEventListener('keydown', (e) => this.onKey(e, true));
    addEventListener('keyup', (e) => this.onKey(e, false));
    addEventListener('blur', () => this.down.clear());
    this.compile();
  }

  compile() {
    this.maps = {};
    for (const [name, L] of Object.entries(this.layouts)) {
      const m = {};
      for (const [act, codes] of Object.entries(L)) for (const c of codes || []) m[c] = (m[c] || 0) | ACTION_BITS[act];
      this.maps[name] = m;
    }
  }
  saveBindings() {
    const s = loadSettings();
    s.bindings = this.layouts;
    saveSettings(s);
    this.compile();
  }
  resetBindings() {
    this.layouts = JSON.parse(JSON.stringify(DEFAULT_LAYOUTS));
    this.saveBindings();
  }

  onKey(e, isDown) {
    const t = e.target;
    const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
    if (this.capture && isDown) {
      e.preventDefault();
      const cb = this.capture; this.capture = null;
      cb(e.code);
      return;
    }
    if (inField) { if (isDown && (e.code === 'Escape' || e.code === 'Enter')) this.emitNav(e.code === 'Escape' ? 'back' : 'confirm', 'kb', e); return; }
    if (isDown) {
      if (!e.repeat) { this.down.add(e.code); this.latch.add(e.code); }
      const nav = navFor(e.code);
      if (nav) this.emitNav(nav, 'kb', e);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    } else this.down.delete(e.code);
  }

  emitNav(action, src, e) {
    for (const l of this.listeners) l(action, src, e);
  }
  onNav(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  keyBits(layout) {
    const m = this.maps[layout];
    let b = 0;
    for (const c of this.down) if (m[c]) b |= m[c];
    for (const c of this.latch) if (m[c]) b |= m[c];
    return b;
  }

  pads() {
    const out = [];
    const list = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of list) if (p && p.connected) out.push(p);
    return out;
  }
  padBits(i) {
    const p = this.pads()[i];
    if (!p) return 0;
    let b = 0;
    for (const [k, bit] of Object.entries(PAD_MAP)) if (p.buttons[k] && (p.buttons[k].pressed || p.buttons[k].value > 0.5)) b |= bit;
    const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
    if (ax < -0.45) b |= I.LEFT; if (ax > 0.45) b |= I.RIGHT;
    if (ay < -0.55) b |= I.UP; if (ay > 0.55) b |= I.DOWN;
    return b;
  }

  endFrame() { this.latch.clear(); }

  // Poll gamepads for menu navigation (called each frame by the app).
  pollPadNav() {
    const pads = this.pads();
    for (let i = 0; i < pads.length && i < 4; i++) {
      const p = pads[i];
      const st = this.padNav[i];
      const btn = (k) => p.buttons[k] && p.buttons[k].pressed;
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
      const dirs = {
        up: btn(12) || ay < -0.6, down: btn(13) || ay > 0.6, left: btn(14) || ax < -0.6, right: btn(15) || ax > 0.6,
        confirm: btn(0), back: btn(1), start: btn(9), alt: btn(3), alt2: btn(2),
      };
      const now = performance.now();
      for (const [k, v] of Object.entries(dirs)) {
        if (v && !st[k]) { st[k] = now; this.emitNav(k === 'start' ? 'pause' : k, 'pad' + i); }
        else if (v && ['up', 'down', 'left', 'right'].includes(k) && now - st[k] > 380) { st[k] = now - 290; this.emitNav(k, 'pad' + i); }
        else if (!v) st[k] = 0;
      }
    }
  }

  // Input bits for a game slot. dev: 'solo' | 'left' | 'right' | 'pad0'.. | 'any'
  bits(dev) {
    if (dev.includes('|')) { let b = 0; for (const d of dev.split('|')) b |= this.bits(d); return I.cleanInput(b); }
    if (dev === 'any') {
      let b = this.keyBits('solo');
      const n = this.pads().length;
      for (let i = 0; i < n; i++) b |= this.padBits(i);
      return I.cleanInput(b);
    }
    if (dev.startsWith('pad')) return I.cleanInput(this.padBits(+dev.slice(3)));
    return I.cleanInput(this.keyBits(dev));
  }
}

function navFor(code) {
  switch (code) {
    case 'ArrowUp': case 'KeyW': return 'up';
    case 'ArrowDown': case 'KeyS': return 'down';
    case 'ArrowLeft': case 'KeyA': return 'left';
    case 'ArrowRight': case 'KeyD': return 'right';
    case 'Enter': case 'Space': case 'KeyJ': case 'KeyF': case 'NumpadEnter': return 'confirm';
    case 'Escape': return 'pause';
    case 'Backspace': case 'KeyK': case 'KeyG': return 'back';
    case 'KeyU': case 'KeyR': return 'alt';
    case 'KeyI': case 'KeyT': return 'alt2';
  }
  return null;
}
