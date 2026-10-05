#!/usr/bin/env python3
"""
Sprite sheet slicer for Take Down.

  index  -> writes numbered preview images of every frame found on each sheet
  build  -> cuts the frames listed in tools/characters.json, packs one atlas PNG
            per character into assets/sprites/, and writes js/sprite-data.js

Needs: pillow, numpy, scipy.
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHEETS = os.path.join(ROOT, 'sprite_assets')
CONFIG = os.path.join(ROOT, 'tools', 'characters.json')
OUT_DIR = os.path.join(ROOT, 'assets', 'sprites')
OUT_JS = os.path.join(ROOT, 'js', 'sprite-data.js')


def hex_rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def load(sheet_cfg):
    im = Image.open(os.path.join(SHEETS, sheet_cfg['file'])).convert('RGBA')
    a = np.asarray(im).copy()
    cells = a[..., 3] >= 128  # sheets that put every frame on its own coloured cell
    bg = a[..., 3] < 128
    for h in sheet_cfg.get('bg', []):
        r, g, b = hex_rgb(h)
        bg |= (a[..., 0] == r) & (a[..., 1] == g) & (a[..., 2] == b)
    bg |= grid_lines(a, bg)
    a[bg] = 0
    if sheet_cfg.get('cells'):
        return a, ~bg, cells
    return a, ~bg, ~bg


def grid_lines(a, bg, run=30):
    """Box borders on sheets: 1px-thin straight single-colour runs, which sprites never have."""
    rgb = a[..., :3].astype(np.int32)
    key = (rgb[..., 0] << 16) | (rgb[..., 1] << 8) | rgb[..., 2]
    key = np.where(bg, -1, key)
    lines = np.zeros(bg.shape, bool)
    for arr, out in ((key, lines), (key.T, lines.T)):
        pad = np.pad(arr, 1, constant_values=-2)
        c = pad[1:-1, 1:-1]
        thin = (c >= 0) & (pad[:-2, 1:-1] != c) & (pad[2:, 1:-1] != c)
        h, w = arr.shape
        same = np.zeros((h, w), np.int32)
        same[:, 0] = thin[:, 0]
        for x in range(1, w):
            cont = thin[:, x] & thin[:, x - 1] & (c[:, x] == c[:, x - 1])
            same[:, x] = np.where(cont, same[:, x - 1] + 1, thin[:, x].astype(np.int32))
        last = same >= run
        last &= np.concatenate([same[:, 1:] <= same[:, :-1], np.ones((h, 1), bool)], axis=1)
        for y, x in zip(*np.nonzero(last)):
            out[y, x - same[y, x] + 1:x + 1] = True
    return lines


def components(fg, cfg):
    """Frames = connected blobs of foreground (slightly dilated so loose bits stay attached)."""
    grow = 0 if cfg.get('cells') else cfg.get('grow', 1)
    m = ndimage.binary_dilation(fg, iterations=grow) if grow else fg
    lab, n = ndimage.label(m, structure=np.ones((3, 3)))
    boxes = []
    for i, sl in enumerate(ndimage.find_objects(lab)):
        ys, xs = sl
        h, w = ys.stop - ys.start, xs.stop - xs.start
        if h < cfg.get('min_h', 20) or w < 6:
            continue
        if not cfg.get('cells') and (lab[sl] == i + 1).sum() < 0.06 * h * w:  # box grid lines
            continue
        boxes.append((ys.start, xs.start, ys.stop, xs.stop, i + 1))
    # reading order: rows (by vertical overlap), then left to right
    boxes.sort(key=lambda b: (b[0], b[1]))
    rows = []
    for b in boxes:
        for r in rows:
            top, bot = r['top'], r['bot']
            ov = min(bot, b[2]) - max(top, b[0])
            if ov > 0.5 * min(bot - top, b[2] - b[0]):
                r['items'].append(b)
                r['top'], r['bot'] = min(top, b[0]), max(bot, b[2])
                break
        else:
            rows.append({'top': b[0], 'bot': b[2], 'items': [b]})
    out = []
    for r in sorted(rows, key=lambda r: r['top']):
        out.extend(sorted(r['items'], key=lambda b: b[1]))
    return lab, out


def index(only=None):
    cfg = json.load(open(CONFIG))
    dst = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'tools', 'index')
    os.makedirs(dst, exist_ok=True)
    for cid, c in cfg['characters'].items():
        if only and cid not in only:
            continue
        a, fg, seg = load(c)
        lab, boxes = components(seg, c)
        im = Image.fromarray(a).convert('RGBA')
        bgim = Image.new('RGBA', im.size, (40, 40, 56, 255))
        bgim.alpha_composite(im)
        z = min(1.0, 1600 / im.width)  # big sheets: shrink, then label at the new scale
        if z < 1:
            bgim = bgim.resize((round(im.width * z), round(im.height * z)), Image.BOX)
        d = ImageDraw.Draw(bgim)
        for k, (y0, x0, y1, x1, _) in enumerate(boxes):
            y0, x0, y1, x1 = (round(v * z) for v in (y0, x0, y1, x1))
            d.rectangle([x0, y0, x1 - 1, y1 - 1], outline=(255, 255, 0, 255))
            d.rectangle([x0, y0, x0 + 18, y0 + 10], fill=(200, 0, 0, 255))
            d.text((x0 + 1, y0 - 1), str(k), fill=(255, 255, 255, 255))
        bgim.save(os.path.join(dst, f'{cid}.png'))
        print(cid, len(boxes), 'frames')


def shadow_colors(c, a, fg, lab, boxes):
    """Baked-in floor shadow: colours common near the feet of the idle frames that never
    appear in the upper body (so outlines and skin are never stripped)."""
    if c.get('strip') != 'auto':
        return [hex_rgb(h) for h in c.get('strip', [])]
    from collections import Counter
    low, high = Counter(), set()
    for k in c['anims']['idle']:
        y0, x0, y1, x1, li = boxes[k]
        m = (lab[y0:y1, x0:x1] == li) & fg[y0:y1, x0:x1]
        img = a[y0:y1, x0:x1]
        h = y1 - y0
        for px in img[: int(h * 0.75)][m[: int(h * 0.75)]]:
            high.add(tuple(int(v) for v in px[:3]))
        for px in img[h - 12:][m[h - 12:]]:
            low[tuple(int(v) for v in px[:3])] += 1
    total = sum(low.values()) or 1
    return [col for col, n in low.most_common(6) if n > 0.05 * total and col not in high]


def strip_dashes(img):
    """Remove dashed divider lines glued to a frame: 1px columns/rows of isolated pixels."""
    al = img[..., 3] > 0
    for axis in (0, 1):
        a = al if axis == 0 else al.T
        pad = np.pad(a, ((0, 0), (1, 1)))
        iso = a & ~pad[:, :-2] & ~pad[:, 2:]
        for x in range(a.shape[1]):
            n = iso[:, x].sum()
            if n >= 6 and n >= 0.9 * a[:, x].sum():
                (img[:, x] if axis == 0 else img[x, :])[...] = 0


def scale2x(img):
    """Scale2x (EPX): doubles pixel art and rounds off staircase edges without blurring."""
    k = img.view(np.uint32)[..., 0] if img.flags['C_CONTIGUOUS'] else np.ascontiguousarray(img).view(np.uint32)[..., 0]
    k = np.where(img[..., 3] > 0, k, 0)
    p = np.pad(k, 1, mode='edge')
    A, B, C, D = p[:-2, 1:-1], p[1:-1, 2:], p[1:-1, :-2], p[2:, 1:-1]  # up, right, left, down
    P = k
    e0 = np.where((C == A) & (C != D) & (A != B), A, P)
    e1 = np.where((A == B) & (A != C) & (B != D), B, P)
    e2 = np.where((D == C) & (D != B) & (C != A), C, P)
    e3 = np.where((B == D) & (B != A) & (D != C), D, P)
    h, w = k.shape
    out = np.zeros((h * 2, w * 2), np.uint32)
    out[0::2, 0::2], out[0::2, 1::2], out[1::2, 0::2], out[1::2, 1::2] = e0, e1, e2, e3
    return out.view(np.uint8).reshape(h * 2, w * 2, 4)


def cut(c, a, fg, lab, boxes, used):
    crops = {}
    shadows = shadow_colors(c, a, fg, lab, boxes)
    floor = c.get('strip_rows', 14)  # how far up from the bottom edge a shadow may sit
    for k in used:
        y0, x0, y1, x1, li = boxes[k]
        mask = (lab[y0:y1, x0:x1] == li) & fg[y0:y1, x0:x1]
        img = a[y0:y1, x0:x1].copy()
        img[~mask] = 0
        for r, g, b in shadows:  # baked-in floor shadows: only near the feet
            kill = (img[..., 0] == r) & (img[..., 1] == g) & (img[..., 2] == b)
            kill[: max(0, img.shape[0] - floor)] = False
            img[kill] = 0
        strip_dashes(img)
        ys, xs = np.nonzero(img[..., 3])
        img = img[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        crops[k] = img
    if facing_left(c, crops):
        for k in crops:
            crops[k] = crops[k][:, ::-1]
    # mixed sheets: single frames drawn facing the other way
    for k in c.get('flip_frames', []):
        if k in crops:
            crops[k] = crops[k][:, ::-1]
    return crops


def facing_left(c, crops):
    """Punching arms stick out on the side the fighter faces. Measured in the arm band
    (upper body) against the idle pose. 'flip' in the config overrides the guess."""
    if 'flip' in c:
        return bool(c['flip'])

    def arm_extents(img):
        al = img[..., 3] > 0
        h, w = al.shape
        body = al[int(h * 0.25):int(h * 0.65)].sum(0)
        cx = (body * np.arange(w)).sum() / max(1, body.sum())
        arms = np.nonzero(al[int(h * 0.12):int(h * 0.5)].any(0))[0]
        return cx - arms.min(), arms.max() - cx

    il, ir = arm_extents(crops[c['anims']['idle'][0]])
    left = right = 0.0
    for name in ('jab', 'cross', 'hook'):
        for k in c['anims'].get(name, []):
            l, r = arm_extents(crops[k])
            left += max(0, l - il)
            right += max(0, r - ir)
    return left > right


def strips(only=None):
    """One image per character: every mapped animation as a labelled row, feet on a line."""
    cfg = json.load(open(CONFIG))
    dst = sys.argv[2]
    os.makedirs(dst, exist_ok=True)
    for cid, c in cfg['characters'].items():
        if not c.get('anims') or (only and cid not in only):
            continue
        a, fg, seg = load(c)
        lab, boxes = components(seg, c)
        used = sorted({f for frames in c['anims'].values() for f in frames})
        crops = cut(c, a, fg, lab, boxes, used)
        rows = []
        for name, fr in c['anims'].items():
            h = max(crops[k].shape[0] for k in fr) + 14
            w = sum(crops[k].shape[1] + 6 for k in fr) + 90
            row = Image.new('RGBA', (w, h), (40, 40, 56, 255))
            d = ImageDraw.Draw(row)
            d.text((2, 2), name, fill=(255, 255, 0, 255))
            x = 90
            for k in fr:
                im = Image.fromarray(crops[k])
                row.alpha_composite(im, (x, h - im.height))
                d.text((x, 0), str(k), fill=(255, 120, 120, 255))
                x += im.width + 6
            rows.append(row)
        W = max(r.width for r in rows)
        out = Image.new('RGBA', (W, sum(r.height + 2 for r in rows)), (20, 20, 28, 255))
        y = 0
        for r in rows:
            out.alpha_composite(r, (0, y))
            y += r.height + 2
        out.save(os.path.join(dst, f'{cid}.png'))
        print(cid, out.size)


def save_atlas(atlas, path):
    """Indexed PNG when the atlas has at most 256 colours (exact, about half the bytes),
    plain RGBA otherwise."""
    flat = atlas.reshape(-1, 4).copy()
    flat[flat[:, 3] == 0] = 0
    cols, inv = np.unique(flat, axis=0, return_inverse=True)
    if len(cols) > 256:
        Image.fromarray(atlas).save(path, optimize=True)
        return
    im = Image.fromarray(inv.reshape(atlas.shape[:2]).astype(np.uint8), 'P')
    im.putpalette(cols[:, :3].astype(np.uint8).flatten().tolist())
    im.save(path, optimize=True, transparency=bytes(cols[:, 3].astype(np.uint8).tolist()))


def build():
    cfg = json.load(open(CONFIG))
    os.makedirs(OUT_DIR, exist_ok=True)
    data = {}
    for cid, c in cfg['characters'].items():
        if not c.get('anims'):
            continue
        a, fg, seg = load(c)
        lab, boxes = components(seg, c)
        used = sorted({f for frames in c['anims'].values() for f in frames})
        crops = cut(c, a, fg, lab, boxes, used)
        if c.get('scale2x'):
            # low-res art blown up far: smooth the pixel staircase (Scale2x twice = 4x), then
            # draw it filtered like HD art
            for _ in range(2):
                crops = {k: scale2x(img) for k, img in crops.items()}
        # normalise size. `scale` = sprite pixels -> game pixels. HD art keeps 3x the
        # detail it needs and is drawn smoothly; small pixel art gets an integer upscale.
        scale = 1.0
        smooth = False
        target = c.get('target_h', cfg.get('target_h'))
        if target:
            f = target / crops[c['anims']['idle'][0]].shape[0]
            if f < 0.9:
                # HD art: keep 3x the detail it needs, drawn smoothly
                r = min(1.0, 3 * f)
                if r > 0.85:
                    r = 1.0  # a few % smaller isn't worth resampling (it smears the palette into thousands of colours)
                if r < 1:
                    for k, img in crops.items():
                        im = Image.fromarray(img)
                        im = im.resize((max(1, round(im.width * r)), max(1, round(im.height * r))), Image.LANCZOS)
                        crops[k] = np.asarray(im).copy()
                scale = f / r
                smooth = True
            else:
                scale = f  # pixel art: stretched, kept crisp
        idle0 = crops[c['anims']['idle'][0]]
        # anchor x: centre of mass of the torso band, so extended limbs don't shift the body
        meta = {}
        for k, img in crops.items():
            h, w = img.shape[:2]
            al = img[..., 3] > 0
            band = al[int(h * 0.2):int(h * 0.6)]
            cols = band.sum(0)
            ax = float((cols * np.arange(w)).sum() / max(1, cols.sum()))
            # Reach point: front-most pixel of the upper body (facing right). The bottom
            # rows are skipped so a wide stance's front foot never counts as the fist;
            # otherwise fireballs launch from the ankles and hit sparks land on the floor.
            upper = al[:max(1, int(h * 0.72))]
            if not upper.any():
                upper = al
            fx = np.nonzero(upper.any(0))[0].max()
            fy = int(np.nonzero(upper[:, fx])[0].mean())
            meta[k] = {'w': w, 'h': h, 'ax': round(ax, 1), 'reach': round(fx - ax, 1), 'reachY': fy - h}
        # shelf-pack into an atlas
        order = sorted(crops, key=lambda k: -crops[k].shape[0])
        W = 2048 if max(im.shape[1] for im in crops.values()) > 200 else 1024
        x = y = rowh = 0
        for k in order:
            h, w = crops[k].shape[:2]
            if x + w > W:
                x, y, rowh = 0, y + rowh + 1, 0
            meta[k]['x'], meta[k]['y'] = x, y
            x += w + 1
            rowh = max(rowh, h)
        atlas = np.zeros((y + rowh, W, 4), np.uint8)
        for k, img in crops.items():
            h, w = img.shape[:2]
            atlas[meta[k]['y']:meta[k]['y'] + h, meta[k]['x']:meta[k]['x'] + w] = img
        save_atlas(atlas, os.path.join(OUT_DIR, f'{cid}.png'))
        frames = [meta[k] | {'id': k} for k in used]
        pos = {k: i for i, k in enumerate(used)}
        data[cid] = {
            'name': c['name'],
            'image': f'assets/sprites/{cid}.png',
            'scale': round(scale, 4),
            'smooth': smooth,
            'idleH': int(idle0.shape[0]),
            'frames': [[f['x'], f['y'], f['w'], f['h'], f['ax'], f['reach'], f['reachY']] for f in frames],
            'anims': {n: [pos[k] for k in fr] for n, fr in c['anims'].items()},
        }
        for k in ('super1', 'super2'):
            if c.get(k):
                data[cid][k] = c[k]
        print(cid, len(used), 'frames ->', atlas.shape[1], 'x', atlas.shape[0], '(source faces left, flipped)' if facing_left(c, cut(c, a, fg, lab, boxes, c['anims']['idle'] + c['anims'].get('jab', []) + c['anims'].get('cross', []) + c['anims'].get('hook', []) + c['anims'].get('kick', []))) and False else '')
    with open(OUT_JS, 'w') as f:
        f.write('// Generated by tools/slice_sprites.py. Do not edit.\n')
        f.write("'use strict';\n\nconst SPRITE_DATA = ")
        json.dump(data, f, separators=(',', ':'))
        f.write(';\n')


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'index'
    if cmd == 'index':
        index(sys.argv[3:] or None)
    elif cmd == 'build':
        build()
    elif cmd == 'strips':
        strips(sys.argv[3:] or None)
