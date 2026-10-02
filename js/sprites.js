'use strict';

// Sprite sizing: one sprite pixel covers 1/PIX world units, so on a 1280x720 world a
// sprite takes the same share of the screen as it did on a 320x180 arcade screen.
// The canvas itself renders at full device resolution.
const PIX = 0.25;

const CHARS = {}; // id -> character (sprite atlas + animation data), filled by loadCharacters()

function loadCharacters() {
  const jobs = Object.entries(typeof SPRITE_DATA === 'undefined' ? {} : SPRITE_DATA).map(
    ([id, d]) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(makeCharacter(id, d, img));
        img.onerror = () => {
          console.warn('Take Down: missing sprite atlas', d.image);
          resolve(null);
        };
        img.src = d.image;
      })
  );
  // Fill CHARS in SPRITE_DATA order, not load order, so the roster never reshuffles.
  return Promise.all(jobs).then((list) => list.forEach((c) => c && (CHARS[c.id] = c)));
}

function makeCharacter(id, d, img) {
  const frames = d.frames.map(([x, y, w, h, ax, reach, reachY]) => ({ x, y, w, h, ax, reach, reachY }));
  const c = { id, name: d.name, img, frames, anims: d.anims, scale: d.scale || 1, smooth: !!d.smooth, super1: d.super1, super2: d.super2, tints: {} };
  const idle = frames[c.anims.idle[0]];
  const w = (px) => (px * c.scale) / PIX; // sprite pixels -> world units
  c.toWorld = w;
  c.height = w(idle.h);
  c.halfW = w(idle.w) * 0.36;
  // For each animation: the frame with the longest forward reach is its "hit" pose.
  c.peak = {};
  c.reach = {};
  for (const [name, list] of Object.entries(c.anims)) {
    let best = 0;
    list.forEach((fi, i) => {
      if (frames[fi].reach > frames[list[best]].reach) best = i;
    });
    c.peak[name] = best;
    c.reach[name] = w(frames[list[best]].reach);
  }
  return c;
}

function anim(c, name) {
  return c.anims[name] || null;
}

// Silhouette copy of the atlas in one colour (hit flash, super afterimages).
function tintedAtlas(c, color) {
  if (c.tints[color]) return c.tints[color];
  const cv = document.createElement('canvas');
  cv.width = c.img.width;
  cv.height = c.img.height;
  const g = cv.getContext('2d');
  g.drawImage(c.img, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = color;
  g.fillRect(0, 0, cv.width, cv.height);
  c.tints[color] = cv;
  return cv;
}

// Draw frame fi with its anchor (torso centre, feet) at world (x, y), snapped to screen pixels.
// rot tips the sprite backwards around its feet (knockdowns for art without falling frames).
function drawFrame(ctx, c, fi, x, y, face, tint, rot = 0) {
  const f = c.frames[fi];
  if (!f) return;
  const src = tint ? tintedAtlas(c, tint) : c.img;
  ctx.save();
  ctx.imageSmoothingEnabled = c.smooth; // pixel art stays crisp, HD art is filtered
  if (rot) {
    // tip over around the sprite centre and rest the lowest edge on the ground
    const hw = c.toWorld(f.w) / 2, hh = c.toWorld(f.h) / 2;
    const s = Math.abs(Math.sin(rot)), k = Math.abs(Math.cos(rot));
    ctx.translate(x, y - (hh * k + hw * s));
    ctx.rotate(rot * face);
    ctx.scale((face * c.scale) / PIX, c.scale / PIX);
    ctx.drawImage(src, f.x, f.y, f.w, f.h, -f.w / 2, -f.h / 2, f.w, f.h);
    ctx.restore();
    return;
  }
  ctx.translate(x, y);
  ctx.scale((face * c.scale) / PIX, c.scale / PIX);
  ctx.drawImage(src, f.x, f.y, f.w, f.h, -Math.round(f.ax), -f.h, f.w, f.h);
  ctx.restore();
}

// Standalone preview (menus): draw a frame centred on a small canvas.
function drawPreview(ctx, c, fi, cx, bottom, zoom, face) {
  const f = c.frames[fi];
  if (!f) return;
  const s = c.scale * zoom;
  ctx.save();
  ctx.imageSmoothingEnabled = c.smooth;
  ctx.translate(cx, bottom);
  ctx.scale(face * s, s);
  ctx.drawImage(c.img, f.x, f.y, f.w, f.h, -Math.round(f.ax), -f.h, f.w, f.h);
  ctx.restore();
}
