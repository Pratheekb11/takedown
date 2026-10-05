'use strict';

// guard: chance per decision to raise a guard pre-emptively when the opponent is close
// punish: chance to hit back when the opponent is stuck recovering in range
// dmg: damage multiplier on the CPU's hits
const AI_LEVELS = {
  easy: { react: 26, block: 0.12, guard: 0, punish: 0.05, antiAir: 0.1, combo: 0.15, superUse: 0.008, cooldown: [50, 90], aggro: 0.35, dmg: 0.85 },
  normal: { react: 10, block: 0.65, guard: 0.06, punish: 0.55, antiAir: 0.5, combo: 0.65, superUse: 0.05, cooldown: [16, 38], aggro: 0.65, dmg: 1 },
  hard: { react: 3, block: 0.92, guard: 0.12, punish: 0.95, antiAir: 0.9, combo: 1, superUse: 0.2, cooldown: [6, 16], aggro: 0.85, dmg: 1.2 },
};

const CHAIN_NEXT = { jab: 'cross', cross: 'hook', hook: 'upper' };

// Drives a PlayerInput exactly like a human would. It reacts to what it saw
// `react` frames ago, so difficulty is mostly reaction time + decision odds.
class AIController {
  constructor(level, input) {
    this.level = level;
    this.cfg = AI_LEVELS[level] || AI_LEVELS.normal;
    this.input = input;
    this.hist = [];
    this.cool = 50;
    this.walkDir = 0;
    this.walkT = 0;
    this.blockT = 0;
    this.seenMove = -1;
    this.seenJump = false;
    this.chainFor = -1;
    this.punishedFor = -1;
  }

  update(me, opp, game) {
    const inp = this.input;
    this.hist.push({ attacking: opp.state === 'attack', moveId: opp.moveId, jumping: opp.state === 'jump' || (opp.move && opp.move.air) });
    if (this.hist.length > 32) this.hist.shift();
    const seen = this.hist[Math.max(0, this.hist.length - 1 - this.cfg.react)];

    if (game.phase !== 'fight') {
      inp.reset();
      return;
    }

    const dist = Math.abs(opp.x - me.x);
    const gap = dist - opp.ch.halfW; // distance from my centre to the front of their body
    const far = Math.max(me.range('kick'), me.range('cross'));
    const touching = me.ch.pushW + opp.ch.pushW + 15;
    const toward = opp.x > me.x ? 'right' : 'left';
    const away = toward === 'right' ? 'left' : 'right';
    const free = me.state === 'idle' || me.state === 'walk' || me.state === 'block';

    // Keep chaining once the first hit lands.
    if (me.state === 'attack' && me.connected && me.moveId !== this.chainFor) {
      this.chainFor = me.moveId;
      const next = CHAIN_NEXT[me.move.key];
      const confirm = me.move.key !== 'jab' && me.power >= 50 && chance(this.cfg.superUse * 3);
      if (confirm && !me.move.super) inp.press(me.power >= 100 ? 'super2' : 'super1');
      else if (next && chance(this.cfg.combo)) inp.press(next);
      else if (me.move.key === 'hook' && me.power >= 50 && chance(this.cfg.combo * 0.5)) inp.press('super1');
    }

    // Hold block for a while once committed.
    if (this.blockT > 0) {
      // keep the guard up through a block string
      if (me.state === 'blockstun' || (opp.state === 'attack' && opp.mt <= opp.move.lastHit)) this.blockT = Math.max(this.blockT, 4);
      this.blockT--;
      inp.held.left = inp.held.right = false;
      inp.held.block = this.blockT > 0;
      return;
    }
    inp.held.block = false;

    // Punish: they are stuck in recovery (whiffed or blocked) and we are close enough.
    const recovering = opp.state === 'attack' && opp.move && !opp.move.air && opp.mt > opp.move.lastHit && opp.move.total - opp.mt > 4;
    if (free && recovering && opp.moveId !== this.punishedFor && seen.moveId === opp.moveId) {
      this.punishedFor = opp.moveId;
      if (chance(this.cfg.punish)) {
        const pick = ['hook', 'cross', 'jab'].find((a) => me.range(a) >= gap);
        if (pick) {
          if (me.power >= 50 && chance(this.cfg.superUse * 4)) return inp.press(me.power >= 100 ? 'super2' : 'super1');
          return inp.press(pick);
        }
      }
    }

    // Guard up pre-emptively when they are in striking range.
    if (free && opp.state !== 'attack' && gap < opp.range('kick') + 20 && chance(this.cfg.guard)) {
      this.blockT = randInt(8, 16);
      inp.held.block = true;
      return;
    }

    // React to an incoming attack.
    if (seen.attacking && seen.moveId !== this.seenMove) {
      this.seenMove = seen.moveId;
      if (free && dist - me.ch.halfW < opp.range('kick') + 40 && chance(this.cfg.block)) {
        this.blockT = randInt(16, 26);
        inp.held.block = true;
        return;
      }
    }

    // Anti-air.
    if (seen.jumping && !this.seenJump) {
      this.seenJump = true;
      if (free && gap < me.range('upper') + 50 && chance(this.cfg.antiAir)) inp.press('upper');
    } else if (!seen.jumping) {
      this.seenJump = false;
    }

    if (!free) {
      inp.held.left = inp.held.right = false;
      return;
    }

    // Supers.
    if (opp.vulnerable) {
      const inReach = (slot) => (me.supers[slot].shot ? gap < 700 : gap < me.range(slot) + 140);
      if (me.power >= 100 && inReach('super2') && chance(this.cfg.superUse)) return inp.press('super2');
      if (me.power >= 50 && inReach('super1') && chance(this.cfg.superUse * 0.6)) return inp.press('super1');
    }

    // Movement.
    if (this.walkT > 0) {
      this.walkT--;
    } else {
      this.walkDir = 0;
      if (gap > far) {
        this.walkDir = chance(0.2 + this.cfg.aggro) ? 1 : 0;
        this.walkT = randInt(8, 24);
        if (chance(this.cfg.aggro * 0.04)) {
          this.walkDir = 1;
          inp.press('up');
        }
      } else if (dist < touching && chance(0.25)) {
        this.walkDir = -1;
        this.walkT = randInt(8, 18);
      } else if (chance(0.06)) {
        this.walkDir = -1;
        this.walkT = randInt(10, 22);
      }
      // Cornered and pressured: jump out.
      const cornered = me.x < STAGE_L + 40 || me.x > STAGE_R - 40;
      if (cornered && dist < touching + 20 && chance(0.04)) {
        this.walkDir = 1;
        this.walkT = 12;
        inp.press('up');
      }
    }
    inp.held[toward] = this.walkDir === 1;
    inp.held[away] = this.walkDir === -1;

    // Attacks.
    if (this.cool > 0) {
      this.cool--;
      return;
    }
    const opts = [['jab', 3], ['cross', 3], ['hook', 3], ['upper', 2], ['kick', 3]].filter(([a]) => me.range(a) >= gap);
    if (opts.length) {
      let total = 0;
      for (const o of opts) total += o[1];
      let r = Math.random() * total;
      for (const [a, w] of opts) {
        if ((r -= w) <= 0) {
          inp.press(a);
          break;
        }
      }
      const [lo, hi] = this.cfg.cooldown;
      this.cool = randInt(lo, hi);
    }
  }
}
