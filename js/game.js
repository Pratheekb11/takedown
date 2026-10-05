'use strict';

// DOM heads-up display. Only touches the DOM when a value actually changes.
class Hud {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.root = $('hud');
    this.sides = [0, 1].map((i) => ({
      name: $(`p${i + 1}-name`),
      hp: $(`p${i + 1}-hp`),
      ghost: $(`p${i + 1}-ghost`),
      pw: $(`p${i + 1}-pw`),
      pwWrap: $(`p${i + 1}-pw-wrap`),
      combo: $(`p${i + 1}-combo`),
      pips: [...$(`p${i + 1}-pips`).children],
      last: { hp: -1, ghost: -1, pw: -1, lv: -1 },
      comboT: 0,
    }));
    this.announcer = $('announcer');
    this.clockEl = $('clock');
    this.clockShown = -1;
    this.banner = $('super-banner');
    this.touchSuper = document.querySelector('[data-act="super"]');
  }

  setup(p1, p2) {
    [p1, p2].forEach((p, i) => {
      const s = this.sides[i];
      s.name.textContent = p.name;
      s.last = { hp: -1, ghost: -1, pw: -1, lv: -1 };
      s.combo.className = 'combo p' + (i + 1);
    });
    this.update(p1, p2);
  }

  show(on) {
    this.root.classList.toggle('hidden', !on);
  }

  rounds(won) {
    won.forEach((n, i) => this.sides[i].pips.forEach((pip, k) => pip.classList.toggle('won', k < n)));
  }

  update(p1, p2) {
    [p1, p2].forEach((p, i) => {
      const s = this.sides[i];
      const hp = Math.round(p.hp * 10) / 10;
      const ghost = Math.round(p.ghostHp * 10) / 10;
      const pw = Math.floor(p.power);
      if (hp !== s.last.hp) {
        s.hp.style.transform = `scaleX(${hp / MAX_HP})`;
        s.hp.classList.toggle('low', hp < 30);
        s.last.hp = hp;
      }
      if (ghost !== s.last.ghost) {
        s.ghost.style.transform = `scaleX(${ghost / MAX_HP})`;
        s.last.ghost = ghost;
      }
      if (pw !== s.last.pw) {
        s.pw.style.transform = `scaleX(${pw / MAX_POWER})`;
        const lv = pw >= 100 ? 2 : pw >= 50 ? 1 : 0;
        if (lv !== s.last.lv) {
          s.pwWrap.dataset.lv = lv;
          if (i === 0) {
            this.touchSuper.dataset.lv = lv;
          }
          s.last.lv = lv;
        }
        s.last.pw = pw;
      }
      if (s.comboT > 0 && --s.comboT === 0) s.combo.classList.remove('show');
    });
  }

  combo(side, n) {
    const s = this.sides[side];
    s.combo.innerHTML = `<b>${n}</b> HITS`;
    s.combo.classList.remove('show');
    void s.combo.offsetWidth;
    s.combo.classList.add('show');
    s.comboT = 80;
  }

  clock(sec) {
    if (sec === this.clockShown) return;
    this.clockShown = sec;
    this.clockEl.textContent = String(sec).padStart(2, '0');
    this.clockEl.classList.toggle('low', sec <= 10);
  }

  announce(text, cls = '') {
    const a = this.announcer;
    a.textContent = text;
    a.className = '';
    void a.offsetWidth;
    a.className = 'show ' + cls;
  }

  superBanner(f, m) {
    const b = this.banner;
    b.querySelector('.who').textContent = f.name;
    b.querySelector('.what').textContent = m.name;
    b.style.setProperty('--aura', m.aura);
    b.className = '';
    void b.offsetWidth;
    b.className = 'show ' + (f.side === 0 ? 'left' : 'right');
  }
}

const ROUNDS_TO_WIN = 2; // best of three
const ROUND_SECONDS = 99; // when the clock runs out, more health wins the round
const ROUND_WORDS = ['', 'one', 'two', 'three'];

// Names are shown in capitals; speech engines spell all-caps words out letter by letter.
const spoken = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const clipKey = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const MAX_CROP = 0.25; // share of the world height a wide screen may trim
const FLOOR_KEEP = 40; // world units of floor trimmed first; the rest comes off the sky
const CAM_ZOOM = 0.1; // extra zoom when the fighters are up close

class Game {
  constructor(canvas, hooks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.hooks = hooks;
    this.fx = new Effects();
    this.crowd = new Crowd();
    this.hud = new Hud();
    this.inputs = [new PlayerInput(), new PlayerInput()];
    this.p1 = this.p2 = null;
    this.ai = null;
    this.stageId = 'alley';
    this.phase = 'menu';
    this.running = false;
    this.paused = false;
    this.frame = 0;
    this.loop = this.loop.bind(this);
    this.resetFx();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resetFx() {
    this.hitstop = 0;
    this.freeze = 0;
    this.freezeUser = null;
    this.shots = [];
    this.timeScale = 1;
    this.shakeT = 0;
    this.shakeDur = 1;
    this.shakeM = 0;
    this.flashA = 0;
    this.dark = 0;
    this.zoom = 1;
    this.camX = VIEW_W / 2;
  }

  // Ease in a little when the fighters close in, centred between them. The view
  // never leaves the stage, so no edge or black bar ever shows.
  updateCamera() {
    const { p1, p2 } = this;
    let tz = 1, tx = VIEW_W / 2;
    if (p1 && this.phase !== 'menu') {
      tz = 1 + CAM_ZOOM * clamp((620 - Math.abs(p1.x - p2.x)) / 360, 0, 1);
      tx = (p1.x + p2.x) / 2;
    }
    this.zoom += (tz - this.zoom) * 0.04;
    const half = VIEW_W / (2 * this.zoom);
    this.camX = clamp(this.camX + (tx - this.camX) * 0.08, half, VIEW_W - half);
    // Scaled on the compositor (CSS), not by redrawing the stage bigger: the zoom
    // costs nothing per frame. Anchored on the bottom edge so the floor stays put.
    const z = Math.round(this.zoom * 1000) / 1000;
    const x = Math.round((VIEW_W / 2 - this.camX) * z * this.cssScale - (VIEW_W / 2) * (z - 1) * this.cssScale);
    if (z !== this.camZ || x !== this.camPx) {
      this.camZ = z;
      this.camPx = x;
      this.canvas.style.transform = z === 1 ? '' : `translateX(${x}px) scale(${z})`;
    }
  }

  resize() {
    const stage = this.canvas.parentElement;
    const ww = window.innerWidth, wh = window.innerHeight;
    let s = Math.min(ww / VIEW_W, wh / VIEW_H);
    // Screens wider than 16:9 (phones): fill the width and trim sky instead of
    // leaving black side bars. Never trim more than MAX_CROP of the world.
    if (ww / VIEW_W > s) s = Math.min(ww / VIEW_W, wh / (VIEW_H * (1 - MAX_CROP)));
    // Portrait menus: blow the backdrop up so the two fighters fill the gap the
    // menu leaves between the logo and the buttons (the sides crop off).
    const gap = this.phase === 'menu' && wh > ww && this.hooks.backdropGap ? this.hooks.backdropGap() : null;
    if (gap) {
      const tall = Math.max(this.p1 ? this.p1.ch.height : 0, this.p2 ? this.p2.ch.height : 0) || 300;
      s = Math.max(s, (gap.bottom - gap.top) / (tall + 30));
    }
    const cw = Math.floor(VIEW_W * s);
    const ch = Math.min(wh, Math.floor(VIEW_H * s));
    const cut = VIEW_H - ch / s;
    this.camY = cut - Math.min(cut, FLOOR_KEEP); // trim the floor a little, the sky the rest
    this.cssScale = s;
    // ...and slide it so the floor sits just above the buttons
    const lift = gap ? Math.round(gap.bottom - ((wh - ch) / 2 + (GROUND - this.camY) * s)) : 0;
    stage.style.transform = lift ? `translateY(${lift}px)` : '';
    stage.style.width = cw + 'px';
    stage.style.height = ch + 'px';
    document.documentElement.style.setProperty('--s', s.toFixed(4));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(cw * dpr), h = Math.round(ch * dpr);
    if (w !== this.canvas.width || h !== this.canvas.height || !this.layers) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.scale = w / VIEW_W;
      this.layers = buildStage(this.scale, this.stageId);
    }
    this.render();
  }

  // Menu backdrop: two fighters flexing on the stage.
  showcase(chA, chB) {
    this.setStage(defaultStage());
    this.p1 = new Fighter({ name: '', ch: chA, input: new PlayerInput(), side: 0 });
    this.p2 = new Fighter({ name: '', ch: chB, input: new PlayerInput(), side: 1 });
    this.p1.setState('intro', 1);
    this.p2.setState('intro', 1);
    this.ai = null;
    this.phase = 'menu';
    this.resize();
    this.paused = false;
    this.fx.clear();
    this.resetFx();
    this.hud.show(false);
    this.ensureLoop();
  }

  start(cfg) {
    const [i1, i2] = this.inputs;
    this.setStage(cfg.stage || defaultStage());
    this.p1 = new Fighter({ name: cfg.p1.name, ch: cfg.p1.ch, input: i1, side: 0 });
    this.p2 = new Fighter({ name: cfg.p2.name, ch: cfg.p2.ch, input: i2, side: 1 });
    this.ai = cfg.mode === 'cpu' ? new AIController(cfg.difficulty, i2) : null;
    if (this.ai) this.p2.dmgMul = this.ai.cfg.dmg;
    this.round = 0;
    this.won = [0, 0];
    this.paused = false;
    this.hud.setup(this.p1, this.p2);
    this.hud.show(true);
    this.nextRound();
    this.resize();
    this.ensureLoop();
  }

  // Best of three: hp and positions reset, power and stats carry over.
  // replay: a drawn round is fought again under the same number
  nextRound(replay = false) {
    if (!replay) this.round++;
    this.clockT = ROUND_SECONDS * 60;
    this.timeUp = false;
    this.hud.clock(ROUND_SECONDS);
    for (const f of [this.p1, this.p2]) {
      const { power, stats } = f;
      f.reset(f.side === 0 ? 440 : VIEW_W - 440, f.side === 0 ? 1 : -1);
      if (this.round > 1) Object.assign(f, { power, stats });
    }
    if (this.ai) this.ai = new AIController(this.ai.level, this.inputs[1]);
    this.fx.clear();
    this.resetFx();
    this.shots = [];
    this.phase = 'intro';
    // round 1 opens with the names; later rounds go straight to the round call
    this.phaseT = this.round === 1 ? 0 : 70;
    this.winner = this.loser = null;
    const pose = this.round === 1 ? 'intro' : 'idle';
    this.p1.setState(pose, true);
    this.p2.setState(pose, true);
    this.hud.rounds(this.won);
    this.hud.update(this.p1, this.p2);
  }

  get finalRound() {
    return this.won[0] === ROUNDS_TO_WIN - 1 && this.won[1] === ROUNDS_TO_WIN - 1;
  }

  setStage(id) {
    if (id === this.stageId) return;
    this.stageId = id;
    this.layers = buildStage(this.scale, id);
  }

  ensureLoop() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.acc = 0;
    requestAnimationFrame(this.loop);
  }

  loop(ts) {
    const dt = Math.min(100, ts - this.last);
    this.last = ts;
    if (!this.paused) {
      this.acc += dt * this.timeScale;
      let n = 0;
      while (this.acc >= STEP_MS && n < 5) {
        this.tick();
        this.acc -= STEP_MS;
        n++;
      }
      if (n === 5) this.acc = 0;
    }
    this.render();
    if (this.running) requestAnimationFrame(this.loop);
  }

  shake(mag, frames) {
    if (mag * frames < this.shakeM * this.shakeT) return;
    this.shakeM = Math.min(mag, 18);
    this.shakeT = this.shakeDur = frames;
  }

  tick() {
    this.frame++;
    this.updateCamera();
    this.fx.update();
    this.crowd.update();
    if (this.shakeT > 0) this.shakeT--;
    if (this.flashA > 0) this.flashA = Math.max(0, this.flashA - 0.07);
    const { p1, p2 } = this;
    if (!p1) return;

    if (this.phase === 'menu') {
      p1.update(p2, this);
      p2.update(p1, this);
      return;
    }
    if (this.hitstop > 0) {
      this.hitstop--;
      // the hit flash keeps fading through hitstop so it reads as a blink, not a freeze
      if (p1.flash > 0) p1.flash--;
      if (p2.flash > 0) p2.flash--;
      return;
    }
    this.phaseT++;
    if (this.phase === 'intro') this.tickIntro();

    if (this.freeze > 0) {
      this.freeze--;
      this.dark = Math.min(1, this.dark + 0.15);
      const u = this.freezeUser;
      u.update(u === p1 ? p2 : p1, this);
      if (u.move) {
        this.fx.energy(u.x, u.y - 90, u.move.aura);
        if (this.frame % 2) this.fx.energy(u.x, u.y - 90, '#ffffff');
      }
      this.hud.update(p1, p2);
      return;
    }
    this.dark = Math.max(0, this.dark - 0.06);

    if (this.ai) this.ai.update(p2, p1, this);
    p1.update(p2, this);
    p2.update(p1, this);
    for (const s of this.shots) s.update(this);
    this.shots = this.shots.filter((s) => !s.dead);
    this.separate();
    this.trackCombos();
    if (this.phase === 'fight') {
      this.clockT--;
      this.hud.clock(Math.ceil(this.clockT / 60));
      if (this.clockT <= 0) this.onTimeUp();
    }
    if (this.phase === 'ko') this.tickKO();
    this.hud.update(p1, p2);
  }

  tickIntro() {
    const t = this.phaseT;
    if (t === 1) {
      this.hud.announce(`${this.p1.name} vs ${this.p2.name}`, 'names');
      Sound.say(`${spoken(this.p1.ch.name)} versus ${spoken(this.p2.ch.name)}`, {
        rate: 0.95,
        parts: [clipKey(this.p1.ch.name), 'versus', clipKey(this.p2.ch.name)],
      });
    }
    if (t === 85) {
      if (this.p1.state === 'intro') this.p1.setState('idle', 8);
      if (this.p2.state === 'intro') this.p2.setState('idle', 8);
      if (this.finalRound) {
        this.hud.announce('FINAL ROUND', 'round final');
        Sound.say('Final round!', { rate: 0.8, interrupt: false });
      } else {
        this.hud.announce(`ROUND ${this.round}`, 'round');
        Sound.say(`Round ${ROUND_WORDS[this.round]}!`, { rate: 0.85, interrupt: false });
      }
      Sound.ui();
    }
    if (t === 140) {
      this.phase = 'fight';
      this.hud.announce('FIGHT!', 'fight');
      Sound.say('Fight!', { rate: 1, pitch: 0.5 });
      Sound.bell();
      this.crowd.excite(0.8);
    }
  }

  tickKO() {
    const t = this.phaseT;
    if (t === 45) this.timeScale = 1;
    const w = this.winner;
    if (!w) {
      if (t === 160) this.nextRound(true);
      return;
    }
    if (t > 100 && w.state !== 'win' && (w.state === 'idle' || w.state === 'walk' || w.state === 'block')) {
      w.setState('win', 8);
      this.crowd.excite(1);
    }
    const matchOver = this.won[w.side] >= ROUNDS_TO_WIN;
    if (!matchOver && t === 200) this.nextRound();
    if (matchOver && t === 150) Sound.say(`${spoken(w.ch.name)} wins!`, { rate: 0.9, parts: [clipKey(w.ch.name), 'wins'] });
    if (matchOver && t === 250) {
      this.phase = 'over';
      this.hooks.onEnd({ winner: w, loser: this.loser, p1: this.p1, p2: this.p2, won: this.won });
    }
  }

  separate() {
    const a = this.p1, b = this.p2;
    const lying = (f) => f.state === 'down' || f.state === 'ko' || f.state === 'getup';
    if (lying(a) || lying(b) || Math.abs(a.y - b.y) > 130) return;
    const dx = b.x - a.x;
    const ad = Math.abs(dx);
    const PUSH_DIST = a.ch.pushW + b.ch.pushW;
    if (ad >= PUSH_DIST) return;
    const s = dx === 0 ? a.face : Math.sign(dx);
    const push = (PUSH_DIST - ad) / 2;
    a.x = clamp(a.x - s * push, STAGE_L, STAGE_R);
    b.x = clamp(b.x + s * push, STAGE_L, STAGE_R);
    // one is pinned against a wall: the other gets the full push
    const rest = PUSH_DIST - Math.abs(b.x - a.x);
    if (rest > 0.5) {
      if (a.x === STAGE_L || a.x === STAGE_R) b.x = clamp(b.x + s * rest, STAGE_L, STAGE_R);
      else a.x = clamp(a.x - s * rest, STAGE_L, STAGE_R);
    }
  }

  trackCombos() {
    for (const [att, def] of [[this.p1, this.p2], [this.p2, this.p1]]) {
      const reeling = def.state === 'hit' || (def.state === 'down' && def.downPhase === 'air');
      if (att.combo && !reeling) att.combo = 0;
    }
  }

  spawnProjectile(owner, m, x, y) {
    this.shots.push(new Projectile(owner, m, x, y));
  }

  resolveHit(att, def, h, m, p, dirOverride) {
    if (this.phase !== 'fight') return; // the round is already decided
    const dir = dirOverride || att.face;
    const blocking = (def.state === 'block' || def.state === 'blockstun') && !def.airborne;

    if (blocking) {
      const chip = m.super ? Math.ceil(h.dmg * 0.25) : h.dmg >= 10 ? 1 : 0;
      def.hp = Math.max(1, def.hp - chip);
      def.blockHit(h, dir);
      att.power = Math.min(MAX_POWER, att.power + h.dmg * 0.4);
      def.power = Math.min(MAX_POWER, def.power + h.dmg * 0.5);
      att.connected = true;
      this.fx.blockSpark(p.x, p.y, dir);
      Sound.block();
      this.hitstop = 3;
      return;
    }

    const counter = def.state === 'attack';
    const reeling = def.state === 'hit' || def.state === 'down';
    att.combo = reeling ? att.combo + 1 : 1;
    const scale = Math.max(0.45, 1 - (att.combo - 1) * 0.1) * (counter ? 1.25 : 1);
    const dmg = Math.max(1, Math.round(h.dmg * scale * att.dmgMul));
    def.hp = Math.max(0, def.hp - dmg);
    att.stats.hits++;
    att.stats.dmg += dmg;
    att.stats.maxCombo = Math.max(att.stats.maxCombo, att.combo);
    if (!m.super) att.power = Math.min(MAX_POWER, att.power + dmg * 1.3);
    def.power = Math.min(MAX_POWER, def.power + dmg * 0.8);
    att.connected = true;
    def.flash = 6;

    if (def.hp <= 0) {
      const l = h.launch || { vx: 5, vy: -10 };
      def.knockdown(dir, { vx: l.vx + 2, vy: l.vy - 2 });
    } else if (h.launch) {
      def.knockdown(dir, h.launch);
    } else {
      def.takeHit(h, dir);
    }

    const power = h.big ? 1.4 : clamp(h.dmg / 12, 0.2, 1);
    this.fx.spark(p.x, p.y, dir, power, m.aura || (counter ? '#ff7a3d' : '#ffe27a'));
    if (h.type === 'head' && power >= 0.8) this.fx.sweat(p.x, p.y, dir);
    if (counter) this.fx.text(p.x, def.y - def.ch.height - 14, 'COUNTER!', '#ff7a3d');
    if (h.big) {
      this.flashA = 0.3;
      this.fx.ring(p.x, p.y, 20, 240, 24, '#ffffff', 10);
    }
    this.hitstop = h.stop + (counter ? 3 : 0);
    this.shake(power * 9, 6 + power * 9);
    Sound.hit(Math.min(1, power));
    this.crowd.excite(power * 0.35);
    if (att.combo >= 2) this.hud.combo(att.side, att.combo);

    if (def.hp <= 0) this.onKO(att, def);
  }

  onSuper(f, m) {
    this.freeze = m.freeze;
    this.freezeUser = f;
    Sound.superCharge();
    this.hud.superBanner(f, m);
    Sound.say(spoken(m.name) + '!', { rate: 1.05, pitch: 0.7 });
    this.crowd.excite(0.6);
    this.fx.ring(f.x, f.y - 120, 20, 260, 26, m.aura, 8);
    this.shake(4, m.freeze);
  }

  // Clock ran out: more health wins the round; level health is a draw and the round
  // is fought again.
  onTimeUp() {
    const { p1, p2 } = this;
    this.phase = 'ko';
    this.phaseT = 0;
    this.timeUp = true;
    this.inputs.forEach((i) => i.reset());
    Sound.bell();
    if (p1.hp === p2.hp) {
      this.winner = this.loser = null;
      this.hud.announce('DRAW', 'round');
      Sound.say('Draw!', { rate: 0.9 });
      return;
    }
    const [w, l] = p1.hp > p2.hp ? [p1, p2] : [p2, p1];
    this.winner = w;
    this.loser = l;
    this.hud.announce('TIME OVER', 'round final');
    Sound.say('Time over!', { rate: 0.9 });
    this.won[w.side]++;
    this.hud.rounds(this.won);
  }

  onKO(winner, loser) {
    this.phase = 'ko';
    this.phaseT = 0;
    this.winner = winner;
    this.loser = loser;
    this.timeScale = 0.3;
    this.hitstop = 22;
    this.flashA = 0.6;
    this.shake(16, 30);
    Sound.ko();
    Sound.crowd();
    this.crowd.excite(1.5);
    this.hud.announce('K.O.', 'ko');
    Sound.say('Knockout!', { rate: 0.7, pitch: 0.45 });
    this.won[winner.side]++;
    this.hud.rounds(this.won);
  }

  render() {
    const ctx = this.ctx;
    const { p1, p2 } = this;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, -this.camY * this.scale);
    ctx.imageSmoothingEnabled = true;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.save();
    if (this.shakeT > 0) {
      const m = this.shakeM * (this.shakeT / this.shakeDur);
      ctx.translate(rand(-m, m), rand(-m, m));
    }
    ctx.drawImage(this.layers.back, 0, 0, VIEW_W, VIEW_H);
    if (this.layers.crowd) this.crowd.draw(ctx, this.frame);
    ctx.drawImage(this.layers.front, 0, 0, VIEW_W, VIEW_H);

    if (this.dark > 0) {
      ctx.fillStyle = `rgba(6,0,18,${(this.dark * 0.65).toFixed(3)})`;
      ctx.fillRect(-20, -20, VIEW_W + 40, VIEW_H + 40);
      const u = this.freezeUser;
      if (u && this.freeze > 0) {
        // speed lines converging on the super user
        const cx = u.x, cy = u.y - 140;
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 26; i++) {
          const a = rand(0, TAU);
          const r0 = rand(220, 320);
          ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
          ctx.lineTo(cx + Math.cos(a) * 900, cy + Math.sin(a) * 900);
        }
        ctx.stroke();
      }
    }

    if (p1) {
      p1.drawShadow(ctx);
      p2.drawShadow(ctx);
      const p2Front = p2.state === 'attack' && p1.state !== 'attack';
      const [a, b] = p2Front ? [p1, p2] : [p2, p1];
      a.draw(ctx, this.frame);
      b.draw(ctx, this.frame);
    }
    for (const s of this.shots) s.draw(ctx);
    this.fx.draw(ctx);
    ctx.restore();

    if (this.flashA > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.flashA.toFixed(3)})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
  }
}
