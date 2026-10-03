#!/usr/bin/env python3
"""
Stage builder for Take Down.

Cuts pieces out of background sheets in sprite_assets/ and composes one picture per stage
into assets/stages/<id>.png. The game draws it scaled up to the 1280x720 world with crisp
pixels, so the picture is SNES-sized: 455x256, about 2.8 world units per pixel, with the
fighters' ground line at y=228.

Needs: pillow, numpy, scipy.
"""
import os

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHEETS = os.path.join(ROOT, 'sprite_assets')
OUT_DIR = os.path.join(ROOT, 'assets', 'stages')
W, H = 455, 256
GROUND = 228  # GROUND (640) in stage pixels
BR = 'SNES - The Adventures of Batman and Robin - Backgrounds - '


def pieces(file, key=(255, 0, 255)):
    """Every separate piece on a sheet (keyed background colour made transparent),
    largest first."""
    a = np.asarray(Image.open(os.path.join(SHEETS, file)).convert('RGBA')).copy()
    bg = (a[..., 0] == key[0]) & (a[..., 1] == key[1]) & (a[..., 2] == key[2])
    a[bg] = 0
    lab, n = ndimage.label(ndimage.binary_dilation(~bg, iterations=1), structure=np.ones((3, 3)))
    out = []
    for i, sl in enumerate(ndimage.find_objects(lab)):
        img = a[sl].copy()
        img[lab[sl] != i + 1] = 0
        out.append(Image.fromarray(img))
    return sorted(out, key=lambda im: -im.width * im.height)


def find(ps, w, h):
    """The piece with this size (sizes are stable; reading order is not)."""
    exact = [p for p in ps if (p.width, p.height) == (w, h)]
    if exact:
        return exact[0]
    for p in ps:
        if abs(p.width - w) <= 2 and abs(p.height - h) <= 2:
            return p
    raise SystemExit(f'piece {w}x{h} not found')


def gotham():
    ps = pieces(BR + 'Area 1-1.png')
    sky, skyline = find(ps, 258, 226), find(ps, 514, 258)
    street, lamp = find(ps, 1754, 212), find(ps, 35, 192)
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    im.paste(sky.resize((W, GROUND), Image.BILINEAR), (0, 0))
    im.alpha_composite(skyline.crop((0, 0, W, skyline.height)), (0, -60))
    # blue building and low garage, so the skyline shows over the garage roof
    im.alpha_composite(street.crop((640, 0, 640 + W, street.height)), (0, GROUND - street.height + 4))
    im.alpha_composite(lamp, (32, GROUND - lamp.height + 4))
    im.alpha_composite(lamp.transpose(Image.FLIP_LEFT_RIGHT), (W - 32 - lamp.width, GROUND - lamp.height + 4))
    return im


def cafe():
    """Default stage: red night sky over the skyline, the CAFE storefront behind the fighters."""
    ps = pieces(BR + 'Area 1-1.png')
    sky, skyline = find(ps, 258, 226), find(ps, 514, 258)
    street, lamp, hydrant = find(ps, 1754, 212), find(ps, 35, 192), find(ps, 24, 36)
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    im.paste(sky.resize((W, GROUND), Image.BILINEAR), (0, 0))
    im.alpha_composite(skyline.crop((40, 0, 40 + W, skyline.height)), (0, -70))
    # CAFE window, door, CAFE window: the door sits right behind the middle of the fight
    x0 = 108
    im.alpha_composite(street.crop((x0, 0, x0 + W, street.height)), (0, GROUND - street.height + 4))
    im.alpha_composite(lamp, (18, GROUND - lamp.height + 4))
    im.alpha_composite(lamp.transpose(Image.FLIP_LEFT_RIGHT), (W - 18 - lamp.width, GROUND - lamp.height + 4))
    im.alpha_composite(hydrant, (62, GROUND - hydrant.height + 4))
    return im


def funhouse():
    ps = pieces(BR + 'Area 1-2A.png')
    park, front = find(ps, 458, 258), find(ps, 514, 258)
    im = park.crop((1, 1, 1 + W, 1 + H))
    # fence, hedge and path, with the funhouse door on the right
    im.alpha_composite(front.crop((front.width - W, 0, front.width, front.height)), (0, GROUND - 215))
    return im


def backdrop():
    """Night colour behind everything, and dark pavement under the ground line for
    anything the art leaves empty there."""
    a = np.zeros((H, W, 4), np.uint8)
    a[...] = (8, 6, 14, 255)
    for y in range(GROUND, H):
        t = (y - GROUND) / (H - GROUND)
        a[y] = (int(28 - 14 * t), int(24 - 12 * t), int(34 - 14 * t), 255)
    return Image.fromarray(a)


STAGES = {'cafe': cafe, 'gotham': gotham, 'funhouse': funhouse}

if __name__ == '__main__':
    os.makedirs(OUT_DIR, exist_ok=True)
    for sid, make in STAGES.items():
        bg = backdrop()
        bg.alpha_composite(make())
        bg.convert('RGB').save(os.path.join(OUT_DIR, f'{sid}.png'), optimize=True)
        print(sid, W, 'x', H)
