'use strict';

/*
 Move frame data (frames @ 60fps). The sprite animation for each move is timed
 around its hit window: frames before the most extended pose play during startup,
 the most extended pose is shown while the hit is active, the rest play in recovery.

   hits   active windows: r = hit radius (world units), dmg, stun (hitstun frames),
          push, stop (hitstop), type (head|body), launch = knockdown
   step   [from, to, speed, seekRange] forward movement
   rank   chain order: a connected move can cancel into a higher rank
*/
const MOVES = {
  jab: {
    rank: 1, total: 15,
    hits: [{ from: 3, to: 6, r: 18, dmg: 4, stun: 14, push: 3.5, stop: 4, type: 'head' }],
    step: [[0, 3, 1.5]],
  },
  cross: {
    rank: 2, total: 22,
    hits: [{ from: 6, to: 9, r: 20, dmg: 7, stun: 17, push: 5, stop: 6, type: 'head' }],
    step: [[3, 7, 3]],
  },
  hook: {
    rank: 3, total: 27,
    hits: [{ from: 7, to: 11, r: 22, dmg: 10, stun: 21, push: 6, stop: 7, type: 'head' }],
    step: [[4, 8, 2.2]],
  },
  uppercut: {
    rank: 4, total: 32,
    hits: [{ from: 9, to: 14, r: 22, dmg: 12, stun: 26, push: 4, stop: 9, type: 'head', launch: { vx: 4, vy: -11 } }],
    step: [[5, 10, 2.5]],
  },
  kick: {
    rank: 4, total: 32,
    hits: [{ from: 10, to: 16, r: 22, dmg: 11, stun: 20, push: 8, stop: 7, type: 'body' }],
    step: [[0, 6, 1]],
  },
  airkick: {
    rank: 5, total: 30, air: true,
    hits: [{ from: 4, to: 22, r: 24, dmg: 8, stun: 18, push: 4, stop: 6, type: 'head' }],
  },

  // ---- super templates; each character picks one per slot (super1 = half bar, super2 = full) ----
  rush: {
    rank: 9, total: 76, super: true, invuln: 22, freeze: 20, loopAnim: 4,
    hits: [
      ...[0, 1, 2, 3, 4].map((i) => ({ from: 23 + i * 6, to: 26 + i * 6, r: 34, dmg: 3, stun: 24, push: 1.2, stop: 3, type: i % 2 ? 'body' : 'head' })),
      { from: 54, to: 60, r: 36, dmg: 9, stun: 30, push: 4, stop: 12, type: 'head', big: true, launch: { vx: 6, vy: -13 } },
    ],
    step: [[14, 22, 13, 130], [22, 56, 1.6, 95]],
  },
  rising: {
    rank: 9, total: 72, super: true, invuln: 30, freeze: 26,
    // leaves the ground just before the hit, so the blow lands on the way up
    hits: [{ from: 25, to: 38, r: 36, dmg: 28, stun: 40, push: 6, stop: 18, type: 'head', big: true, launch: { vx: 5, vy: -19 } }],
    step: [[18, 25, 15, 120]],
    impulse: [[24, -15]],
  },
  projectile: {
    rank: 9, total: 46, super: true, invuln: 16, freeze: 18,
    hits: [],
    release: 18, // frame the projectile leaves the hand
    shot: { speed: 9, r: 30, dmg: 20, stun: 34, push: 7, stop: 14, type: 'head', big: true },
  },
};

for (const [key, m] of Object.entries(MOVES)) {
  m.key = key;
  m.step = m.step || [];
  m.impulse = m.impulse || [];
  m.lastHit = m.hits.length ? Math.max(...m.hits.map((h) => h.to)) : m.release;
  // frames during which the animation's most extended pose is shown
  m.window = m.hits.length ? [m.hits[0].from, m.hits[m.hits.length - 1].to] : [m.release, m.release + 6];
}

// A fighter's super for one slot, from its character config (super1 = half bar, super2 = full bar).
function buildSuper(slot, cfg) {
  const full = slot === 'super2';
  const base = MOVES[(cfg && cfg.type) || (full ? 'rising' : 'rush')];
  const scale = full ? 1 : 0.75;
  const m = Object.assign({}, base, {
    key: slot,
    cost: full ? 100 : 50,
    name: (cfg && cfg.name) || (full ? 'MAX BREAKER' : 'FURY RUSH'),
    anim: cfg && cfg.anim,
    shotAnim: (cfg && cfg.shot) || 'projectile', // animation for the thrown shot; a missing one draws an energy ball
    aura: full ? '#ff3b1f' : '#29d3ff',
  });
  m.hits = base.hits.map((h) => Object.assign({}, h, { dmg: Math.max(1, Math.round(h.dmg * scale)) }));
  if (base.shot) {
    // a full-bar shot is bigger and knocks the opponent down
    m.shot = Object.assign({}, base.shot, { dmg: Math.round(base.shot.dmg * (full ? 1.4 : 1)) });
    if (full) Object.assign(m.shot, { r: 40, size: 62, launch: { vx: 6, vy: -12 } });
  }
  return m;
}
