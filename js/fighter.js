'use strict';

const GROUND = 640;
const STAGE_L = 80;
const STAGE_R = VIEW_W - 80;
const GRAV = 0.78;
const WALK_F = 4.4;
const WALK_B = 3.4;
const JUMP_V = -15.5;
const JUMP_X = 4.6;
const MAX_HP = 100;
const MAX_POWER = 100;

let moveCounter = 0;

class Fighter {
  constructor({ name, ch, input, side }) {
    this.name = name;
    this.ch = ch;
    this.side = side;
    this.input = input;
    this.dmgMul = 1; // the CPU's damage edge on hard
    this.supers = { super1: buildSuper('super1', ch.super1), super2: buildSuper('super2', ch.super2) };
    this.reset(side === 0 ? 440 : VIEW_W - 440, side === 0 ? 1 : -1);
  }

  reset(x, face) {
    this.x = x;
    this.y = GROUND;
    this.vx = 0;
    this.vy = 0;
    this.face = face;
    this.hp = MAX_HP;
    this.ghostHp = MAX_HP;
    this.power = 0;
    this.state = 'idle';
    this.st = 0;
    this.move = null;
    this.mt = 0;
    this.hitsDone = 0;
    this.moveId = 0;
    this.connected = false;
    this.stun = 0;
    this.stunMax = 1;
    this.hitType = 'head';
    this.invuln = 0;
    this.flash = 0;
    this.downPhase = null;
    this.lieT = 0;
    this.bounced = false;
    this.airUsed = false;
    this.combo = 0;
    this.walkT = 0;
    this.trail = [];
    this.ghosts = [];
    this.frame = this.ch.anims.idle[0];
    this.rot = 0;
    this.stats = { hits: 0, maxCombo: 0, dmg: 0, supers: 0 };
    this.input.reset();
  }

  get airborne() {
    return this.y < GROUND - 0.5;
  }

  get vulnerable() {
    return this.invuln <= 0 && this.state !== 'down' && this.state !== 'getup' && this.state !== 'ko';
  }

  setState(s, force = false) {
    if (this.state === s && !force) return;
    this.state = s;
    this.st = 0;
  }

  faceTarget(opp) {
    const d = opp.x - this.x;
    if (!this.airborne && Math.abs(d) > 4) this.face = d > 0 ? 1 : -1;
  }

  moveFor(action) {
    if (action === 'super1' || action === 'super2') return this.supers[action];
    return MOVES[action === 'upper' ? 'uppercut' : action];
  }

  animFor(m) {
    if (m.super) return anim(this.ch, m.anim) || anim(this.ch, m.key === 'super1' ? 'rush' : 'uppercut') || this.ch.anims.cross;
    return anim(this.ch, m.key) || this.ch.anims.cross;
  }

  // Forward reach of a move in world units (used by the AI to pick attacks).
  range(action) {
    const m = this.moveFor(action);
    const name = m.super ? m.anim : m.key;
    const reach = Math.max(this.ch.reach[name] || this.ch.reach.cross || 0, this.ch.pushW + 34);
    return reach + (m.hits[0] ? m.hits[0].r : 30);
  }

  update(opp, game) {
    this.input.tick();
    this.st++;
    // super afterimages fade out quickly once the move is over
    if (this.ghosts.length && !this.move && this.st % 2 === 0) this.ghosts.shift();
    if (this.invuln > 0) this.invuln--;
    if (this.flash > 0) this.flash--;
    if (this.ghostHp > this.hp) this.ghostHp = Math.max(this.hp, this.ghostHp - 0.4);
    const fighting = game.phase === 'fight';

    switch (this.state) {
      case 'idle':
      case 'walk':
      case 'block':
        this.faceTarget(opp);
        if (fighting) this.neutral(game);
        else {
          this.vx = 0;
          this.setState('idle');
        }
        break;
      case 'jump':
        if (fighting && !this.airUsed) {
          const a = this.input.takeAttack();
          if (a && !a.startsWith('super')) {
            this.airUsed = true;
            this.startMove(MOVES.airkick);
          }
        }
        break;
      case 'attack':
        this.updateAttack(opp, game);
        break;
      case 'hit':
      case 'blockstun':
        if (--this.stun <= 0) this.setState(this.state === 'blockstun' && this.input.held.block ? 'block' : 'idle');
        break;
      case 'down':
        if (this.downPhase === 'lie' && ++this.lieT > 42) this.setState(this.hp <= 0 ? 'ko' : 'getup');
        break;
      case 'getup':
        if (this.st >= 26) {
          this.setState('idle');
          this.invuln = 14;
        }
        break;
    }
    this.physics(game);
    this.pickFrame();
    this.keepOnScreen();
  }

  // A body lying on the floor is far wider than the walls allow for, so slide it
  // in until the whole sprite is visible.
  keepOnScreen() {
    if (this.state !== 'down' && this.state !== 'ko' && this.state !== 'getup') return;
    const f = this.ch.frames[this.frame];
    const w = this.ch.toWorld;
    let back, front;
    if (this.rot) {
      back = front = Math.max(w(f.w), w(f.h)) / 2;
    } else {
      back = w(f.ax);
      front = w(f.w - f.ax);
    }
    const left = this.face > 0 ? back : front;
    const right = this.face > 0 ? front : back;
    const pad = 6;
    this.x = clamp(this.x, Math.max(STAGE_L, left + pad), Math.min(STAGE_R, VIEW_W - right - pad));
  }

  neutral(game) {
    const inp = this.input;
    const atk = inp.takeAttack();
    if (atk && this.tryAttack(atk, game)) return;
    const dir = (inp.held.right ? 1 : 0) - (inp.held.left ? 1 : 0);
    if (inp.takeJump()) {
      this.vy = JUMP_V;
      this.vx = dir * JUMP_X;
      this.y -= 1;
      this.airUsed = false;
      this.setState('jump');
      Sound.whoosh(0.6);
      return;
    }
    if (inp.held.block) {
      this.vx = 0;
      this.setState('block');
      return;
    }
    if (dir) {
      const fwd = dir === this.face;
      this.vx = dir * (fwd ? WALK_F : WALK_B);
      this.walkT += fwd ? 1 : -1;
      this.setState('walk');
    } else {
      this.vx = 0;
      this.setState('idle');
    }
  }

  tryAttack(action, game) {
    const m = this.moveFor(action);
    if (m.super) {
      if (this.power < m.cost) return false;
      this.power -= m.cost;
      this.stats.supers++;
      this.startMove(m);
      game.onSuper(this, m);
      return true;
    }
    this.startMove(m);
    return true;
  }

  startMove(m) {
    this.move = m;
    this.moveAnim = this.animFor(m);
    this.movePeak = this.moveAnim.reduce((best, fi, i, list) => (this.ch.frames[fi].reach > this.ch.frames[list[best]].reach ? i : best), 0);
    this.mt = 0;
    this.hitsDone = 0;
    this.connected = false;
    this.moveId = ++moveCounter;
    this.trail.length = 0;
    if (!m.air) this.vx = 0;
    if (m.invuln) this.invuln = m.invuln;
    this.setState('attack', true);
  }

  updateAttack(opp, game) {
    const m = this.move;
    const t = ++this.mt;

    if (!m.air) {
      let stepping = false;
      for (const [a, b, spd, seek] of m.step) {
        if (t < a || t >= b) continue;
        stepping = true;
        this.vx = seek && Math.abs(opp.x - this.x) < seek ? 0 : this.face * spd;
      }
      if (!stepping && !this.airborne) this.vx *= 0.7;
    }
    for (const [f, vy] of m.impulse) {
      if (t === f) {
        this.vy = vy;
        this.y -= 1;
      }
    }
    if (m.shot && t === m.release) {
      // leave from the hand, but never beyond a close opponent (long beam art)
      const p = this.hitPoint(this.moveAnim[this.movePeak]);
      const x = this.x + this.face * Math.min(Math.abs(p.x - this.x), this.ch.halfW + 60);
      game.spawnProjectile(this, m, x, p.y);
    }

    for (let i = 0; i < m.hits.length; i++) {
      const h = m.hits[i];
      if (t === h.from) Sound.whoosh(h.big ? 1.4 : 1);
      if (this.hitsDone & (1 << i) || t < h.from || t > h.to) continue;
      const p = this.reachInto(opp, h.r);
      if (p) {
        this.hitsDone |= 1 << i;
        game.resolveHit(this, opp, h, m, p);
        if (this.state !== 'attack') return;
      }
    }

    if (m.super) {
      const active = t >= m.window[0] - 2 && t <= m.window[1] + 1;
      if (active && t % 3 === 0) {
        this.ghosts.push({ x: this.x, y: this.y, face: this.face, frame: this.frame, color: m.aura || '#ffffff' });
        if (this.ghosts.length > 4) this.ghosts.shift();
      }
    }

    // Combo chaining: a connected move cancels into a higher-ranked one (or a super).
    if (this.connected && t > m.lastHit && game.phase === 'fight' && this.input.buffer) {
      const a = this.input.buffer;
      const n = this.moveFor(a);
      const ok = n.super
        ? !m.super && this.power >= n.cost
        : !m.air && !m.super && (n.rank > m.rank || (n.key === 'jab' && m.key === 'jab'));
      if (ok) {
        this.input.takeAttack();
        this.tryAttack(a, game);
        return;
      }
    }

    if (t >= m.total) {
      if (m.air) {
        this.move = null;
        this.setState('jump');
      } else if (!this.airborne) {
        this.move = null;
        this.setState('idle');
      }
    }
  }

  // World position of the front-most pixel (fist/foot) of the current frame.
  // Where this frame's strike touches opp, or null. The whole arm counts, not just
  // the tip: big sprites reach so far that the tip can sail past a close opponent.
  reachInto(opp, r) {
    if (!opp.vulnerable) return null;
    const tip = this.hitPoint();
    const base = this.x + this.face * this.ch.halfW;
    for (const k of [1, 0.66, 0.33]) {
      const x = base + (tip.x - base) * k;
      if (opp.overlaps(x, tip.y, r)) return { x, y: tip.y };
    }
    return null;
  }

  hitPoint(fi = this.frame) {
    const f = this.ch.frames[fi];
    const w = this.ch.toWorld;
    // Bulky art barely extends past the body; always reach past the push-apart distance.
    const reach = Math.max(w(f.reach), this.ch.pushW + 34);
    // Props (grapple lines, raised weapons) can poke far above the head; strike at body height.
    const y = clamp(this.y + w(f.reachY), this.y - this.ch.height, this.y - 30);
    return { x: this.x + this.face * reach, y };
  }

  hurtbox() {
    const f = this.ch.frames[this.frame];
    const hw = this.ch.halfW;
    return { l: this.x - hw, r: this.x + hw, t: this.y - this.ch.toWorld(f.h), b: this.y };
  }

  overlaps(x, y, r) {
    const b = this.hurtbox();
    return x + r > b.l && x - r < b.r && y + r > b.t && y - r < b.b;
  }

  takeHit(h, dir) {
    this.move = null;
    if (this.airborne) {
      this.knockdown(dir, { vx: 4, vy: -7 });
      return;
    }
    this.stun = this.stunMax = h.stun;
    this.hitType = h.type;
    this.vx = dir * h.push;
    this.setState('hit', true);
  }

  blockHit(h, dir) {
    this.stun = Math.round(h.stun * 0.6);
    this.vx = dir * h.push * 1.3;
    this.setState('blockstun', true);
  }

  knockdown(dir, l) {
    this.move = null;
    this.face = -dir;
    this.vx = dir * l.vx;
    this.vy = l.vy;
    this.y = Math.min(this.y, GROUND - 1);
    this.downPhase = 'air';
    this.bounced = false;
    this.setState('down', true);
  }

  physics(game) {
    if (this.y < GROUND || this.vy < 0) {
      this.vy += GRAV * (this.state === 'down' ? 0.85 : 1);
      this.y += this.vy;
      this.x += this.vx;
      if (this.y >= GROUND) {
        this.y = GROUND;
        this.land(game);
      }
    } else {
      this.x += this.vx;
      if (this.state === 'hit' || this.state === 'blockstun' || this.state === 'down' || this.state === 'getup') this.vx *= 0.82;
    }
    this.x = clamp(this.x, STAGE_L, STAGE_R);
  }

  land(game) {
    const vy = this.vy;
    this.vy = 0;
    if (this.state === 'jump' || (this.state === 'attack' && this.move.air)) {
      this.move = null;
      this.vx = 0;
      this.setState('idle');
      game.fx.dust(this.x, GROUND, 4);
      Sound.land();
    } else if (this.state === 'attack') {
      this.vx *= 0.3;
      game.fx.dust(this.x, GROUND, 5);
    } else if (this.state === 'down') {
      if (!this.bounced && vy > 3) {
        this.bounced = true;
        this.vy = -vy * 0.35;
        this.y = GROUND - 1;
        this.vx *= 0.6;
        game.fx.dust(this.x, GROUND, 12);
        game.shake(7, 10);
        Sound.land();
      } else {
        this.downPhase = 'lie';
        this.lieT = 0;
        this.vx *= 0.5;
        game.fx.dust(this.x, GROUND, 6);
      }
    } else {
      this.vx = 0;
    }
  }

  // Choose the sprite frame for the current state.
  pickFrame() {
    const A = this.ch.anims;
    this.rot = 0;
    const at = (list, i) => list[clamp(Math.floor(i), 0, list.length - 1)];
    const loop = (list, t, rate) => list[Math.floor(t / rate) % list.length];
    switch (this.state) {
      case 'idle':
        this.frame = loop(A.idle, this.st, 9);
        break;
      case 'walk': {
        const w = A.walk || A.idle;
        const i = Math.floor(this.walkT / 6) % w.length;
        this.frame = w[(i + w.length) % w.length];
        break;
      }
      case 'jump': {
        const j = A.jump || A.idle;
        this.frame = at(j, ((this.vy - JUMP_V) / (-2 * JUMP_V)) * j.length);
        break;
      }
      case 'block':
      case 'blockstun':
        this.frame = (A.block || A.idle)[0];
        break;
      case 'attack':
        this.frame = this.attackFrame();
        break;
      case 'hit': {
        const h = (this.hitType === 'body' && A.hitBody) || A.hit || A.idle;
        this.frame = at(h, (1 - this.stun / this.stunMax) * h.length * 1.6);
        break;
      }
      case 'down':
        if (!A.fall) {
          // no falling art: tip the hit pose over
          this.frame = (A.hit || A.idle)[0];
          this.rot = this.downPhase === 'air' ? -Math.min(1.5, 0.3 + this.st * 0.07) : -1.5;
        } else if (this.downPhase === 'air') {
          const f = A.fall || A.ko || A.idle;
          this.frame = at(f, this.st / 7);
        } else {
          this.frame = (A.lie || A.ko || A.fall || A.idle).slice(-1)[0];
        }
        break;
      case 'getup': {
        if (!A.getup) {
          this.frame = (A.hit || A.idle)[0];
          this.rot = -1.5 * Math.max(0, 1 - this.st / 18);
          break;
        }
        const g = A.getup;
        this.frame = at(g, (this.st / 26) * g.length);
        break;
      }
      case 'ko':
        if (!A.fall) {
          this.frame = (A.hit || A.idle)[0];
          this.rot = -1.5;
        } else {
          this.frame = (A.ko || A.lie || A.fall).slice(-1)[0];
        }
        break;
      case 'win': {
        const w = A.win || A.intro || A.idle;
        this.frame = at(w, this.st / 10);
        break;
      }
      case 'intro':
        this.frame = loop(A.intro || A.idle, this.st, 10);
        break;
    }
  }

  // Startup frames before the hit window, the extended frame during it, recovery after.
  attackFrame() {
    const m = this.move;
    const list = this.moveAnim;
    const t = this.mt;
    if (m.loopAnim && t >= m.window[0] - 6) return list[Math.floor(t / m.loopAnim) % list.length];
    const peak = this.movePeak;
    const [from, to] = m.window;
    if (t < from) return list[Math.min(peak, Math.floor((t / from) * peak))];
    if (t <= to) return list[peak];
    const rest = list.length - 1 - peak;
    if (rest <= 0) return list[peak];
    return list[peak + 1 + Math.min(rest - 1, Math.floor(((t - to) / Math.max(1, m.total - to)) * rest))];
  }

  drawShadow(ctx) {
    const s = clamp(1 - (GROUND - this.y) / 320, 0.35, 1);
    const w = this.state === 'down' || this.state === 'ko' ? this.ch.halfW * 2.4 : this.ch.halfW * 1.5;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(this.x, GROUND + 3, w * s, 12 * s, 0, 0, TAU);
    ctx.fill();
  }

  draw(ctx, frame) {
    const m = this.state === 'attack' ? this.move : null;

    if (m && m.super) {
      // charging aura
      const k = this.mt < 30 ? 1 : Math.max(0, 1 - (this.mt - 30) / 30);
      if (k > 0) {
        const cx = this.x;
        const cy = this.y - this.ch.height * 0.5;
        const r = this.ch.height * 0.62 + Math.sin(frame * 0.5) * 12;
        const g = ctx.createRadialGradient(cx, cy, 10, cx, cy, r);
        g.addColorStop(0, m.aura + 'aa');
        g.addColorStop(1, m.aura + '00');
        ctx.globalAlpha = k;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r * 0.7, r, 0, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    if (this.ghosts.length) {
      // additive and faint, older copies fainter: an energy smear, not a solid copy
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < this.ghosts.length; i++) {
        const g = this.ghosts[i];
        ctx.globalAlpha = 0.1 + i * 0.06;
        drawFrame(ctx, this.ch, g.frame, g.x, g.y, g.face, g.color);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    drawFrame(ctx, this.ch, this.frame, this.x, this.y, this.face, null, this.rot);
    if (this.flash > 0) {
      // hit flash: a quick white wash over the sprite, fading out
      ctx.globalAlpha = Math.min(0.75, this.flash * 0.15);
      drawFrame(ctx, this.ch, this.frame, this.x, this.y, this.face, '#ffffff', this.rot);
      ctx.globalAlpha = 1;
    }
  }
}

// Fireballs and other thrown specials.
class Projectile {
  constructor(owner, m, x, y) {
    this.owner = owner;
    this.ch = owner.ch;
    this.m = m;
    this.h = m.shot;
    this.x = x;
    this.y = y;
    this.face = owner.face;
    this.t = 0;
    this.dead = false;
    this.frames = anim(owner.ch, m.shotAnim);
  }

  update(game) {
    this.t++;
    this.x += this.face * this.h.speed;
    if (this.t % 2 === 0) game.fx.energy(this.x - this.face * 30, this.y, this.m.aura);
    const opp = this.owner === game.p1 ? game.p2 : game.p1;
    if (opp.vulnerable && opp.overlaps(this.x, this.y, this.h.r)) {
      game.resolveHit(this.owner, opp, this.h, this.m, { x: this.x, y: this.y }, this.face);
      this.dead = true;
    }
    if (this.x < -100 || this.x > VIEW_W + 100) this.dead = true;
  }

  draw(ctx) {
    if (this.frames) {
      const fi = this.frames[Math.floor(this.t / 4) % this.frames.length];
      const f = this.ch.frames[fi];
      // projectile frames are anchored at their centre
      drawFrame(ctx, this.ch, fi, this.x - this.face * this.ch.toWorld(f.reach * 0.5), this.y + this.ch.toWorld(f.h / 2), this.face);
    } else if (this.m.shotAnim === 'batarang') {
      // spinning bat-wing blade, drawn in code (the sheet has no thrown frames)
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.t * 0.45 * this.face);
      ctx.scale(1.9, 1.9);
      ctx.beginPath();
      ctx.moveTo(-22, -2);
      ctx.quadraticCurveTo(-12, -4, -6, -10);
      ctx.lineTo(-3, -4);
      ctx.lineTo(0, -8);
      ctx.lineTo(3, -4);
      ctx.lineTo(6, -10);
      ctx.quadraticCurveTo(12, -4, 22, -2);
      ctx.quadraticCurveTo(14, 0, 12, 7);
      ctx.quadraticCurveTo(6, 2, 0, 6);
      ctx.quadraticCurveTo(-6, 2, -12, 7);
      ctx.quadraticCurveTo(-14, 0, -22, -2);
      ctx.closePath();
      ctx.fillStyle = '#1b1d27';
      ctx.strokeStyle = this.m.aura;
      ctx.lineWidth = 1.6;
      ctx.shadowColor = this.m.aura;
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    } else {
      const r = (this.h.size || 44) * (1 + Math.sin(this.t * 0.5) * 0.08); // gentle pulse
      const g = ctx.createRadialGradient(this.x, this.y, 4, this.x, this.y, r);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.4, this.m.aura);
      g.addColorStop(1, this.m.aura + '00');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(this.x, this.y, r, 0, TAU);
      ctx.fill();
    }
  }
}
