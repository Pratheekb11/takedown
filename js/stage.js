'use strict';

// Stages. Static layers are painted once into offscreen canvases, so each frame costs
// two drawImage calls (plus a handful of crowd shapes in the alley).
//   pictures  - composed by tools/build_stages.py, drawn with crisp pixels (cafe is the default)
//   alley     - night alley painted in code; fallback when the pictures aren't built
const GAP_L = 430;
const GAP_R = 850;
const STREET_Y = 585;

function makeLayer(scale) {
  const c = document.createElement('canvas');
  c.width = Math.round(VIEW_W * scale);
  c.height = Math.round(VIEW_H * scale);
  const g = c.getContext('2d');
  g.setTransform(scale, 0, 0, scale, 0, 0);
  return [c, g];
}

// Deterministic RNG so the stage looks the same after a resize.
function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

const STAGE_FILES = {
  cafe: 'assets/stages/cafe.png',
  gotham: 'assets/stages/gotham.png',
  funhouse: 'assets/stages/funhouse.png',
};
const STAGE_PICS = {}; // id -> loaded image, filled by loadStages()

function loadStages() {
  const jobs = Object.entries(STAGE_FILES).map(
    ([id, src]) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          STAGE_PICS[id] = img;
          resolve();
        };
        img.onerror = () => resolve(); // not built yet: the alley still works
        img.src = src;
      })
  );
  return Promise.all(jobs);
}

// The code-painted alley is only a fallback for when the stage pictures aren't built.
function stageIds() {
  const pics = Object.keys(STAGE_PICS);
  return pics.length ? pics : ['alley'];
}

function defaultStage() {
  return STAGE_PICS.cafe ? 'cafe' : stageIds()[0];
}

function buildStage(scale, id = 'alley') {
  const pic = STAGE_PICS[id];
  if (!pic) return buildAlley(scale);
  const [back, b] = makeLayer(scale);
  const [front, f] = makeLayer(scale);
  b.imageSmoothingEnabled = false;
  b.drawImage(pic, 0, 0, VIEW_W, VIEW_H);
  vignette(f);
  return { back, front, crowd: false };
}

function vignette(f) {
  const g = f.createRadialGradient(VIEW_W / 2, VIEW_H * 0.55, 300, VIEW_W / 2, VIEW_H * 0.55, 820);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.55)');
  f.fillStyle = g;
  f.fillRect(0, 0, VIEW_W, VIEW_H);
}

function buildAlley(scale) {
  const R = seeded(42);
  const [back, b] = makeLayer(scale);
  const [front, f] = makeLayer(scale);

  // --- BACK: sky, moon, skyline (seen through the gap) ---
  let g = b.createLinearGradient(0, 0, 0, STREET_Y);
  g.addColorStop(0, '#07081a');
  g.addColorStop(0.55, '#1d1240');
  g.addColorStop(1, '#5a1f4f');
  b.fillStyle = g;
  b.fillRect(0, 0, VIEW_W, VIEW_H);

  b.fillStyle = 'rgba(255,240,220,0.9)';
  b.beginPath();
  b.arc(700, 110, 34, 0, TAU);
  b.fill();
  g = b.createRadialGradient(700, 110, 30, 700, 110, 140);
  g.addColorStop(0, 'rgba(255,220,200,0.25)');
  g.addColorStop(1, 'rgba(255,220,200,0)');
  b.fillStyle = g;
  b.fillRect(540, 0, 320, 260);

  for (let layer = 0; layer < 2; layer++) {
    let x = GAP_L - 40;
    while (x < GAP_R + 40) {
      const w = 40 + R() * 70;
      const h = (layer ? 140 : 210) + R() * 120;
      const top = STREET_Y - 120 - h;
      b.fillStyle = layer ? '#120c26' : '#1b1436';
      b.fillRect(x, top, w, h + 120);
      b.fillStyle = layer ? 'rgba(255,200,90,0.75)' : 'rgba(120,170,255,0.45)';
      for (let wy = top + 10; wy < STREET_Y - 130; wy += 16) {
        for (let wx = x + 6; wx < x + w - 8; wx += 12) {
          if (R() < 0.28) b.fillRect(wx, wy, 5, 7);
        }
      }
      x += w + 4;
    }
  }

  // --- FRONT: buildings, fence, ground ---
  // left brick building
  f.fillStyle = '#4a2523';
  f.fillRect(0, 60, GAP_L, STREET_Y - 60);
  for (let y = 60, row = 0; y < STREET_Y; y += 18, row++) {
    for (let x = (row % 2) * -22; x < GAP_L; x += 44) {
      const v = 60 + R() * 30;
      f.fillStyle = `rgb(${v + 40},${v * 0.45},${v * 0.4})`;
      f.fillRect(x + 1, y + 1, 42, 16);
    }
  }
  g = f.createLinearGradient(0, 0, GAP_L, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(1, 'rgba(0,0,0,0.15)');
  f.fillStyle = g;
  f.fillRect(0, 60, GAP_L, STREET_Y - 60);

  // graffiti
  f.save();
  f.translate(215, 330);
  f.rotate(-0.08);
  f.font = 'bold 74px Impact, "Arial Black", sans-serif';
  f.textAlign = 'center';
  f.lineJoin = 'round';
  f.lineWidth = 14;
  f.strokeStyle = '#120914';
  f.strokeText('TAKE', 0, -30);
  f.strokeText('DOWN', 0, 45);
  f.fillStyle = '#ff2e7e';
  f.fillText('TAKE', 0, -30);
  f.fillStyle = '#25d9ff';
  f.fillText('DOWN', 0, 45);
  f.fillStyle = '#ff2e7e';
  for (let i = 0; i < 9; i++) f.fillRect(-90 + R() * 180, -22, 3, 10 + R() * 28);
  f.restore();

  // fire-escape window + door
  f.fillStyle = '#16121c';
  f.fillRect(60, 120, 90, 110);
  f.fillStyle = 'rgba(255,190,90,0.55)';
  f.fillRect(66, 126, 78, 98);
  f.strokeStyle = '#16121c';
  f.lineWidth = 5;
  f.beginPath();
  f.moveTo(105, 126);
  f.lineTo(105, 224);
  f.moveTo(66, 175);
  f.lineTo(144, 175);
  f.stroke();

  // right concrete building
  f.fillStyle = '#2a2b3a';
  f.fillRect(GAP_R, 30, VIEW_W - GAP_R, STREET_Y - 30);
  for (let y = 30; y < STREET_Y; y += 46) {
    f.fillStyle = 'rgba(0,0,0,0.25)';
    f.fillRect(GAP_R, y, VIEW_W - GAP_R, 3);
  }
  g = f.createLinearGradient(GAP_R, 0, VIEW_W, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.2)');
  g.addColorStop(1, 'rgba(0,0,0,0.6)');
  f.fillStyle = g;
  f.fillRect(GAP_R, 30, VIEW_W - GAP_R, STREET_Y - 30);
  // shutter
  f.fillStyle = '#3d4152';
  f.fillRect(940, 400, 230, STREET_Y - 400);
  f.fillStyle = 'rgba(0,0,0,0.35)';
  for (let y = 404; y < STREET_Y; y += 10) f.fillRect(940, y, 230, 3);
  // neon sign
  f.save();
  f.font = 'bold 64px Impact, "Arial Black", sans-serif';
  f.textAlign = 'center';
  f.shadowColor = '#ff3d3d';
  f.shadowBlur = 28;
  f.fillStyle = '#ff6b6b';
  f.fillText('GYM', 1055, 250);
  f.shadowBlur = 12;
  f.fillStyle = '#ffd1d1';
  f.fillText('GYM', 1055, 250);
  f.shadowColor = '#29d3ff';
  f.shadowBlur = 20;
  f.font = 'bold 26px Impact, "Arial Black", sans-serif';
  f.fillStyle = '#bff3ff';
  f.fillText('OPEN 24/7', 1055, 290);
  f.restore();
  f.strokeStyle = '#ff6b6b';
  f.lineWidth = 3;
  f.strokeRect(975, 190, 160, 115);

  // chain-link fence across the gap (crowd shows through it)
  f.save();
  f.beginPath();
  f.rect(GAP_L, 372, GAP_R - GAP_L, STREET_Y - 372);
  f.clip();
  f.strokeStyle = 'rgba(190,200,220,0.35)';
  f.lineWidth = 1.5;
  f.beginPath();
  for (let x = GAP_L - 200; x < GAP_R; x += 16) {
    f.moveTo(x, 380);
    f.lineTo(x + 205, STREET_Y);
    f.moveTo(x + 205, 380);
    f.lineTo(x, STREET_Y);
  }
  f.stroke();
  f.restore();
  f.fillStyle = '#5e6475';
  for (const x of [GAP_L, 570, 710, GAP_R - 6]) f.fillRect(x, 372, 6, STREET_Y - 372);
  f.fillRect(GAP_L, 372, GAP_R - GAP_L, 5);

  // street
  g = f.createLinearGradient(0, STREET_Y, 0, VIEW_H);
  g.addColorStop(0, '#2b2a36');
  g.addColorStop(1, '#121118');
  f.fillStyle = g;
  f.fillRect(0, STREET_Y, VIEW_W, VIEW_H - STREET_Y);
  f.fillStyle = '#3c3a48';
  f.fillRect(0, STREET_Y, VIEW_W, 8);
  // perspective seams
  f.strokeStyle = 'rgba(0,0,0,0.35)';
  f.lineWidth = 2;
  f.beginPath();
  for (let i = -8; i <= 8; i++) {
    f.moveTo(VIEW_W / 2 + i * 70, STREET_Y + 8);
    f.lineTo(VIEW_W / 2 + i * 200, VIEW_H);
  }
  f.stroke();
  // painted fight circle
  f.strokeStyle = 'rgba(255,255,255,0.18)';
  f.lineWidth = 5;
  f.beginPath();
  f.ellipse(VIEW_W / 2, 650, 430, 46, 0, 0, TAU);
  f.stroke();
  // puddle with neon reflection
  g = f.createRadialGradient(1050, 690, 4, 1050, 690, 120);
  g.addColorStop(0, 'rgba(255,90,110,0.35)');
  g.addColorStop(1, 'rgba(255,90,110,0)');
  f.fillStyle = g;
  f.beginPath();
  f.ellipse(1050, 690, 130, 16, 0, 0, TAU);
  f.fill();
  // cracks
  f.strokeStyle = 'rgba(0,0,0,0.5)';
  f.lineWidth = 2;
  f.beginPath();
  f.moveTo(200, 700);
  f.lineTo(240, 680);
  f.lineTo(230, 660);
  f.moveTo(880, 715);
  f.lineTo(920, 700);
  f.lineTo(960, 705);
  f.stroke();

  // streetlights + light pools
  for (const lx of [GAP_L - 10, GAP_R + 10]) {
    f.fillStyle = '#1b1b22';
    f.fillRect(lx - 4, 170, 8, STREET_Y - 170);
    f.fillRect(lx - 4, 170, lx < VIEW_W / 2 ? 60 : -60, 7);
    const hx = lx + (lx < VIEW_W / 2 ? 56 : -56);
    f.fillStyle = '#fff3c4';
    f.fillRect(hx - 12, 176, 24, 6);
    g = f.createRadialGradient(hx, 180, 4, hx, 180, 90);
    g.addColorStop(0, 'rgba(255,240,190,0.55)');
    g.addColorStop(1, 'rgba(255,240,190,0)');
    f.fillStyle = g;
    f.fillRect(hx - 90, 90, 180, 180);
    g = f.createRadialGradient(hx, 650, 10, hx, 650, 260);
    g.addColorStop(0, 'rgba(255,230,170,0.18)');
    g.addColorStop(1, 'rgba(255,230,170,0)');
    f.fillStyle = g;
    f.beginPath();
    f.ellipse(hx, 650, 260, 60, 0, 0, TAU);
    f.fill();
  }

  // props: trash can + crates
  f.fillStyle = '#3f4a3f';
  f.fillRect(30, 520, 54, 70);
  f.fillStyle = '#566456';
  f.fillRect(26, 512, 62, 10);
  f.fillStyle = '#6b4a2a';
  f.fillRect(1180, 520, 70, 66);
  f.fillRect(1196, 470, 54, 50);
  f.strokeStyle = '#3a2814';
  f.lineWidth = 3;
  f.strokeRect(1180, 520, 70, 66);
  f.strokeRect(1196, 470, 54, 50);

  vignette(f);
  return { back, front, crowd: true };
}

// Silhouette crowd behind the fence. Hype makes them bounce and raise arms.
class Crowd {
  constructor() {
    const R = seeded(7);
    this.people = [];
    for (let x = GAP_L + 14; x < GAP_R - 10; x += 22 + R() * 14) {
      this.people.push({ x, h: 60 + R() * 30, ph: R() * TAU, c: R() < 0.5 ? '#0d0a1c' : '#160f29', arm: R() < 0.5 });
    }
    this.hype = 0.2;
  }

  excite(v) {
    this.hype = Math.min(1.5, this.hype + v);
  }

  update() {
    this.hype = Math.max(0.15, this.hype * 0.99);
  }

  draw(ctx, frame) {
    for (const p of this.people) {
      const bob = Math.abs(Math.sin(frame * 0.12 + p.ph)) * 7 * this.hype;
      const top = STREET_Y - p.h - bob;
      ctx.fillStyle = p.c;
      ctx.beginPath();
      ctx.ellipse(p.x, top + p.h * 0.55, 15, p.h * 0.5, 0, 0, TAU);
      ctx.arc(p.x, top, 10, 0, TAU);
      ctx.fill();
      if (p.arm && this.hype > 0.5) {
        ctx.strokeStyle = p.c;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(p.x + 8, top + 18);
        ctx.lineTo(p.x + 16, top - 18 - bob);
        ctx.stroke();
      }
    }
  }
}
