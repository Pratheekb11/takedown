'use strict';

const ATTACKS = ['jab', 'cross', 'hook', 'upper', 'kick', 'super1', 'super2'];

// One per fighter. Keyboard, touch and the AI all drive a fighter through this,
// so swapping the CPU for a second human later is just a different controller.
class PlayerInput {
  constructor() {
    this.held = { left: false, right: false, block: false };
    this.buffer = null;
    this.bufferT = 0;
    this.jumpT = 0;
  }

  press(action) {
    if (action === 'up') {
      this.jumpT = 6;
    } else if (ATTACKS.includes(action)) {
      this.buffer = action;
      this.bufferT = 10;
    } else if (action in this.held) {
      this.held[action] = true;
    }
  }

  release(action) {
    if (action in this.held) this.held[action] = false;
  }

  tick() {
    if (this.bufferT > 0 && --this.bufferT === 0) this.buffer = null;
    if (this.jumpT > 0) this.jumpT--;
  }

  takeAttack() {
    const a = this.buffer;
    this.buffer = null;
    this.bufferT = 0;
    return a;
  }

  takeJump() {
    if (this.jumpT <= 0) return false;
    this.jumpT = 0;
    return true;
  }

  reset() {
    this.held.left = this.held.right = this.held.block = false;
    this.buffer = null;
    this.bufferT = this.jumpT = 0;
  }
}

const KEYMAP_P1 = {
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  KeyW: 'up', ArrowUp: 'up', Space: 'up',
  KeyS: 'block', ArrowDown: 'block',
  KeyJ: 'jab',
  KeyK: 'cross',
  KeyL: 'hook',
  KeyI: 'upper',
  KeyU: 'kick',
  KeyO: 'super1',
  KeyP: 'super2',
};

class KeyboardController {
  constructor(map) {
    this.map = map;
    this.input = null;
    window.addEventListener('keydown', (e) => {
      const a = this.map[e.code];
      if (!a || !this.input) return;
      e.preventDefault();
      if (!e.repeat) this.input.press(a);
    });
    window.addEventListener('keyup', (e) => {
      const a = this.map[e.code];
      if (a && this.input) this.input.release(a);
    });
    window.addEventListener('blur', () => this.input && this.input.reset());
  }
}

// Phone controls. Left thumb: a fixed stick; touches anywhere in the generous
// zone around it steer relative to its centre. Right thumb gets three buttons:
//   PUNCH  repeated taps walk the chain jab > cross > hook > uppercut;
//          with the stick pulled down it is an uppercut straight away
//   KICK
//   SUPER  fires the biggest super the power bar can pay for (data-lv set by the HUD)
const PUNCH_CHAIN = ['jab', 'cross', 'hook', 'upper'];
const PUNCH_RESET_MS = 450;

class TouchController {
  constructor(root) {
    this.input = null;
    this.chainI = 0;
    this.lastPunch = 0;
    this.initStick(root.querySelector('#stick-zone'), root.querySelector('#stick'));
    root.querySelectorAll('[data-act]').forEach((btn) => this.initButton(btn));
  }

  initStick(zone, stick) {
    const knob = stick.querySelector('.knob');
    const dirs = { left: false, right: false, block: false };
    let id = null;
    let ox = 0;
    let oy = 0;
    let jumpArmed = true;

    const set = (k, on) => {
      if (dirs[k] === on) return;
      dirs[k] = on;
      stick.classList.toggle(k, on);
      if (this.input) on ? this.input.press(k) : this.input.release(k);
    };

    const move = (x, y) => {
      const r = stick.offsetWidth / 2;
      let dx = x - ox;
      let dy = y - oy;
      const d = Math.hypot(dx, dy);
      if (d > r) {
        dx = (dx / d) * r;
        dy = (dy / d) * r;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      set('left', dx < -r * 0.35);
      set('right', dx > r * 0.35);
      set('block', dy > r * 0.55);
      const up = dy < -r * 0.55;
      if (up && jumpArmed) {
        jumpArmed = false;
        stick.classList.add('up');
        if (this.input) this.input.press('up');
      } else if (dy > -r * 0.3) {
        jumpArmed = true;
        stick.classList.remove('up');
      }
    };

    const release = () => {
      id = null;
      for (const k in dirs) set(k, false);
      jumpArmed = true;
      stick.classList.remove('active', 'up');
      knob.style.transform = '';
    };
    const end = (e) => e.pointerId === id && release();

    zone.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      e.preventDefault();
      id = e.pointerId;
      try {
        zone.setPointerCapture(id);
      } catch (err) {
        // pointer already gone
      }
      // The stick stays put; the thumb is read relative to its centre.
      const box = stick.getBoundingClientRect();
      ox = box.left + box.width / 2;
      oy = box.top + box.height / 2;
      stick.classList.add('active');
      move(e.clientX, e.clientY);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId === id) move(e.clientX, e.clientY);
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => zone.addEventListener(ev, end));
    zone.addEventListener('contextmenu', (e) => e.preventDefault());
    this.stickDirs = dirs;
    this.releaseStick = release;
  }

  // Drop any held stick so a pause or match switch never leaves a direction stuck.
  reset() {
    this.releaseStick();
    this.chainI = 0;
  }

  // What a button press means right now.
  actionFor(act, btn) {
    if (act === 'super') return btn.dataset.lv === '2' ? 'super2' : 'super1';
    if (act !== 'punch') return act;
    if (this.stickDirs.block) {
      this.chainI = 0;
      return 'upper';
    }
    const now = performance.now();
    if (now - this.lastPunch > PUNCH_RESET_MS) this.chainI = 0;
    this.lastPunch = now;
    const a = PUNCH_CHAIN[this.chainI];
    this.chainI = (this.chainI + 1) % PUNCH_CHAIN.length;
    return a;
  }

  initButton(btn) {
    const act = btn.dataset.act;
    const pointers = new Set();
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try {
        btn.setPointerCapture(e.pointerId);
      } catch (err) {
        // pointer already gone; the button still works without capture
      }
      pointers.add(e.pointerId);
      btn.classList.remove('on');
      void btn.offsetWidth; // restart the press ripple on rapid taps
      btn.classList.add('on');
      if (this.input) this.input.press(this.actionFor(act, btn));
      if (navigator.vibrate) navigator.vibrate(8);
    });
    const up = (e) => {
      if (!pointers.delete(e.pointerId) || pointers.size) return;
      btn.classList.remove('on');
    };
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => btn.addEventListener(ev, up));
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}
