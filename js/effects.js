'use strict';

const MAX_PARTICLES = 320;

// Pooled-ish particle system: hit sparks, impact stars, rings, dust, energy.
class Effects {
  constructor() {
    this.parts = [];
    this.rings = [];
  }

  clear() {
    this.parts.length = 0;
    this.rings.length = 0;
  }

  add(p) {
    if (this.parts.length < MAX_PARTICLES) this.parts.push(p);
  }

  spark(x, y, dir, power, color = '#ffe27a') {
    const n = 6 + Math.round(power * 12);
    for (let i = 0; i < n; i++) {
      const a = (dir > 0 ? 0 : Math.PI) + rand(-1.2, 1.2);
      const sp = rand(5, 11) * (0.7 + power * 0.6);
      const life = rand(9, 16);
      this.add({ k: 0, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1, life, max: life, w: rand(2, 4) * (1 + power * 0.5), c: color });
    }
    this.add({ k: 2, x, y, life: 7, max: 7, s: 34 + power * 40, c: color, a: rand(0, 1) });
    if (power > 0.45) this.ring(x, y, 12, 70 + power * 60, 14, color, 6);
  }

  blockSpark(x, y, dir) {
    for (let i = 0; i < 7; i++) {
      const a = (dir > 0 ? 0 : Math.PI) + rand(-0.9, 0.9);
      const sp = rand(3, 7);
      this.add({ k: 0, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 10, max: 10, w: 2.5, c: '#9fe8ff' });
    }
    this.ring(x, y, 8, 40, 10, '#9fe8ff', 4);
  }

  dust(x, y, n) {
    for (let i = 0; i < n; i++) {
      const life = rand(18, 30);
      this.add({ k: 1, x: x + rand(-30, 30), y: y - rand(0, 6), vx: rand(-2.2, 2.2), vy: rand(-1.6, -0.3), life, max: life, r: rand(6, 12), c: 'rgba(170,160,150,' });
    }
  }

  sweat(x, y, dir) {
    for (let i = 0; i < 5; i++) {
      const life = rand(20, 32);
      this.add({ k: 3, x, y, vx: dir * rand(1, 5), vy: rand(-6, -2), life, max: life, r: rand(2, 3.5), c: '#cfefff' });
    }
  }

  energy(x, y, color) {
    const life = rand(16, 28);
    this.add({ k: 4, x: x + rand(-50, 50), y: y + rand(-120, 20), vx: rand(-0.5, 0.5), vy: rand(-4, -2), life, max: life, r: rand(2, 5), c: color });
  }

  // Pops in, holds, then fades fast so it never lingers over the fighters.
  text(x, y, str, color, size = 34) {
    x = clamp(x, size * 3, VIEW_W - size * 3);
    this.add({ k: 5, x, y, vx: 0, vy: -0.8, life: 34, max: 34, str, c: color, size });
  }

  ring(x, y, r0, r1, life, color, w) {
    this.rings.push({ x, y, r0, r1, life, max: life, c: color, w });
  }

  update() {
    const ps = this.parts;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      if (--p.life <= 0) {
        ps[i] = ps[ps.length - 1];
        ps.pop();
        continue;
      }
      if (p.k === 2) continue;
      p.x += p.vx;
      p.y += p.vy;
      if (p.k === 0) {
        p.vx *= 0.86;
        p.vy = p.vy * 0.86 + 0.25;
      } else if (p.k === 1) {
        p.vx *= 0.94;
        p.vy *= 0.94;
        p.r += 0.5;
      } else if (p.k === 3) {
        p.vy += 0.45;
      } else if (p.k === 5) {
        p.vy *= 0.92;
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      if (--this.rings[i].life <= 0) this.rings.splice(i, 1);
    }
  }

  draw(ctx) {
    ctx.lineCap = 'round';
    for (const p of this.parts) {
      const t = p.life / p.max;
      if (p.k === 0) {
        ctx.globalAlpha = t;
        ctx.strokeStyle = p.c;
        ctx.lineWidth = p.w;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 2.2, p.y - p.vy * 2.2);
        ctx.stroke();
      } else if (p.k === 1) {
        ctx.fillStyle = p.c + (t * 0.35).toFixed(3) + ')';
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, TAU);
        ctx.fill();
      } else if (p.k === 2) {
        // impact star
        const s = p.s * (0.6 + (1 - t) * 0.6);
        ctx.globalAlpha = t;
        ctx.fillStyle = '#ffffff';
        star(ctx, p.x, p.y, s, s * 0.28, 8, p.a);
        ctx.fillStyle = p.c;
        star(ctx, p.x, p.y, s * 0.6, s * 0.2, 8, p.a + 0.2);
      } else if (p.k === 5) {
        const age = p.max - p.life;
        ctx.globalAlpha = Math.min(1, p.life / 10);
        const pop = age < 6 ? 1.5 - (age / 6) * 0.5 : 1;
        ctx.font = `${Math.round(p.size * pop)}px Bangers, Impact, sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 6;
        ctx.strokeStyle = '#120914';
        ctx.strokeText(p.str, p.x, p.y);
        ctx.fillStyle = p.c;
        ctx.fillText(p.str, p.x, p.y);
      } else {
        ctx.globalAlpha = Math.min(1, t * 1.5);
        ctx.fillStyle = p.c;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, TAU);
        ctx.fill();
      }
    }
    for (const r of this.rings) {
      const t = r.life / r.max;
      ctx.globalAlpha = t;
      ctx.strokeStyle = r.c;
      ctx.lineWidth = r.w * t + 1;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, lerp(r.r1, r.r0, t), lerp(r.r1, r.r0, t) * 0.75, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

function star(ctx, x, y, ro, ri, n, rot) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? ri : ro;
    const a = rot + (i * Math.PI) / n;
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
}
