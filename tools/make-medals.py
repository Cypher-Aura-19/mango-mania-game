"""Generate the leaderboard's top-three laurel medals.

    python tools/make-medals.py

Writes assets/medal-1.png, medal-2.png and medal-3.png — a gold, silver and
bronze wreath badge for the first three rows of the board. The numeral is baked
into the art rather than layered over it in CSS: there are exactly three of
these, they never carry any other digit, and drawing the "1" into the same
pass as the disc is what lets it take the disc's own bevel and drop shadow.

Everything is drawn 4x and downsampled, which is what keeps the leaf tips and
the numeral's edge clean at the ~34px the board actually shows them at.

Geometry and colour are measured off the approved comp (assets/leaderboard
ui.png). The one thing that decides whether this reads as a wreath or as a
daisy: in the comp the leaves are not separate blades sitting on a circle, they
are a SINGLE cast body whose silhouette is scalloped, with the individual
leaves showing only as darker creases inside it. So the leaves are unioned into
one mask first, that mask is filled and keylined as a whole, and only then are
the creases drawn back in.
"""
import math

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

SS = 4                      # supersample
# Drawn on a roomy square and cropped to its own ink at the end, so the wreath
# and the finial can never be clipped by a canvas guessed too tight. The script
# prints the cropped aspect ratio for the CSS to match.
BOX = 160
FONT = 'assets/audex/audex-regular.ttf'

# Sampled off the comp. Each badge is one metal all through — the wreath is the
# same gold as the disc, a shade deeper, not a green laurel. The silver is
# deliberately warm: a neutral grey went dead against the cream row behind it.
METALS = {
    1: dict(line=(176, 96, 4), leaf_top=(255, 217, 96), leaf_bot=(246, 176, 26),
            face_top=(255, 231, 140), face_bot=(243, 172, 22),
            ring_top=(255, 221, 108), ring_bot=(236, 156, 12),
            shade=(158, 86, 4)),
    2: dict(line=(132, 118, 112), leaf_top=(252, 250, 244), leaf_bot=(210, 201, 193),
            face_top=(253, 251, 245), face_bot=(203, 194, 186),
            ring_top=(250, 247, 240), ring_bot=(199, 189, 181),
            shade=(112, 100, 96)),
    3: dict(line=(150, 64, 6), leaf_top=(252, 190, 112), leaf_bot=(230, 134, 34),
            face_top=(252, 196, 122), face_bot=(224, 126, 28),
            ring_top=(250, 186, 104), ring_bot=(222, 120, 26),
            shade=(122, 54, 6)),
}

# The wreath's reach as a half-ellipse. In the comp the disc is 0.68 of the
# badge's width but very nearly its full height (60 of 72), so the wreath is
# almost entirely a SIDEWAYS growth: 1/0.68 = 1.47 radii out at the flanks,
# barely one radius at the crown and chin. Reaching equally in both directions
# is what turns this into a rosette.
REACH_X, REACH_Y = 1.62, 1.04
SEAT = 0.62                 # how deep behind the disc each leaf is rooted
# Leaf angles down one flank, anticlockwise from +x. Stopping well short of 90
# and -90 is what leaves the crown clear for the finial and the chin clear for
# the disc's own shadow — the comp shows five tips a side, not a full ring.
ANGLES = (56.0, 29.0, 2.0, -25.0, -52.0)


def leaf_poly(length, width, n=24):
    """A laurel leaf pointing along +x, base at the origin.

    Widest a little past a third of the way out and drawn to a point, which is
    the shape in the comp — a plain ellipse reads as a petal instead.
    """
    ts = np.linspace(0.0, 1.0, n)
    hw = (ts ** 0.55) * ((1 - ts) ** 0.78)
    hw = hw / hw.max() * (width / 2)
    top = [(t * length, -w) for t, w in zip(ts, hw)]
    bot = [(t * length, w) for t, w in zip(ts, hw)][::-1]
    return top + bot


def placed(r, cx, cy):
    """Every leaf in the wreath, as (polygon points, base, tip).

    Leaves run down both flanks only, so the top stays open for the finial and
    the chin stays open for the disc's shadow.
    """
    out = []
    for a in ANGLES:
        for side in (1, -1):
            th = math.radians(a)
            # Reach along the ellipse, so flank leaves are long and the ones
            # near the crown and chin are stubs.
            reach = r / math.hypot(math.cos(th) / REACH_X, math.sin(th) / REACH_Y)
            ln = reach - r * SEAT
            # Wide enough that neighbours overlap into one body rather than
            # standing apart as petals.
            wd = ln * 0.86
            ca, sa = math.cos(th) * side, -math.sin(th)
            bx, by = cx + ca * r * SEAT, cy + sa * r * SEAT
            ang = math.degrees(math.atan2(-sa, ca))
            ra = math.radians(ang)
            cs, sn = math.cos(ra), -math.sin(ra)
            pts = [(bx + x * cs - y * sn, by + x * sn + y * cs)
                   for x, y in leaf_poly(ln, wd)]
            out.append((pts, (bx, by), (bx + ca * ln, by + sa * ln)))
    return out


def finial_poly(r, cx, cy):
    """The little crown on the cap, which is what stops the disc from reading
    as a coin someone dropped into a bush."""
    fy = cy - r * 1.06
    fw, fh = r * 0.17, r * 0.30
    return [(cx, fy - fh), (cx + fw, fy - fh * 0.30), (cx + fw * 0.62, fy + fh * 0.65),
            (cx - fw * 0.62, fy + fh * 0.65), (cx - fw, fy - fh * 0.30)]


def vgrad(size, top, bot):
    """A vertical two-stop ramp as an RGBA image."""
    w, h = size
    t = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
    a = np.float32(top) * (1 - t) + np.float32(bot) * t
    return Image.fromarray(
        np.clip(np.repeat(a, w, axis=1), 0, 255).astype('uint8'), 'RGB').convert('RGBA')


def keyline(shape, grow):
    """The band just outside `shape`, used as the cast outline.

    Grown by blurring and thresholding rather than with MaxFilter, which keeps
    the corners of the leaf tips round instead of squaring them off.
    """
    big = shape.filter(ImageFilter.GaussianBlur(grow)).point(
        lambda v: 255 if v > 26 else 0)
    return Image.fromarray(
        np.clip(np.asarray(big, np.int16) - np.asarray(shape, np.int16),
                0, 255).astype('uint8'), 'L')


def medal(rank):
    m = METALS[rank]
    w = h = BOX * SS
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))

    r = w * 0.20                       # disc radius
    cx, cy = w * 0.5, h * 0.53
    leaves = placed(r, cx, cy)

    # ---- wreath ---------------------------------------------------------
    # One mask for the lot. Filling the union is what makes this a cast wreath
    # instead of a ring of loose blades; the creases go back on afterwards.
    body = Image.new('L', (w, h), 0)
    bd = ImageDraw.Draw(body)
    for pts, _, _ in leaves:
        bd.polygon(pts, fill=255)
    bd.polygon(finial_poly(r, cx, cy), fill=255)
    bd.ellipse([cx - r * 0.96, cy - r * 0.96, cx + r * 0.96, cy + r * 0.96], fill=255)

    line_w = max(2, int(r * 0.055))
    img.paste(Image.new('RGBA', (w, h), m['line'] + (255,)),
              (0, 0), keyline(body, line_w))

    metal = vgrad((w, h), m['leaf_top'], m['leaf_bot'])
    # Darker the further out it goes, so the body turns away from the light at
    # its edges the way a struck relief does.
    gx = (np.arange(w, dtype=np.float32) - cx) / (r * REACH_X)
    gy = (np.arange(h, dtype=np.float32) - cy) / (r * REACH_Y)
    rad = np.clip(np.hypot(gx[None, :], gy[:, None]), 0, 1.6)
    arr = np.asarray(metal, np.float32)
    arr[..., :3] *= (1.0 - 0.30 * np.clip(rad - 0.45, 0, 1))[..., None]
    metal = Image.fromarray(np.clip(arr, 0, 255).astype('uint8'), 'RGBA')
    img.paste(metal, (0, 0), body)

    # Creases: each leaf's own outline, drawn back over the filled body so the
    # individual leaves read without breaking the silhouette apart.
    cre = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    cd = ImageDraw.Draw(cre)
    for pts, base, tip in leaves:
        cd.polygon(pts, outline=m['line'] + (170,), width=max(1, int(r * 0.032)))
        cd.line([base, tip], fill=m['line'] + (95,), width=max(1, int(r * 0.026)))
    cre.putalpha(Image.fromarray(
        (np.asarray(cre.getchannel('A'), np.float32)
         * np.asarray(body, np.float32) / 255).astype('uint8'), 'L'))
    img.alpha_composite(cre)

    # ---- disc -----------------------------------------------------------
    # Shadow first, so the disc sits in front of the wreath rather than on it.
    sh = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse([cx - r, cy - r + r * 0.07, cx + r, cy + r + r * 0.07],
                               fill=m['shade'] + (150,))
    img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(r * 0.10)))

    d_px = int(r * 2)
    face = np.asarray(vgrad((d_px, d_px), m['face_top'], m['face_bot']), np.float32)
    g = np.linspace(-1, 1, d_px, dtype=np.float32)
    xx, yy = np.meshgrid(g, g)
    # A soft specular off the upper left, the same light the wood assets use.
    face[..., :3] += 40 * np.exp(-(((xx + 0.32) ** 2 + (yy + 0.38) ** 2)
                                   / (2 * 0.32 ** 2)))[..., None]
    face[..., :3] -= 30 * np.exp(-(((xx - 0.28) ** 2 + (yy - 0.42) ** 2)
                                   / (2 * 0.34 ** 2)))[..., None]
    disc = Image.fromarray(np.clip(face, 0, 255).astype('uint8'), 'RGBA')
    dm = Image.new('L', (d_px, d_px), 0)
    ImageDraw.Draw(dm).ellipse([0, 0, d_px - 1, d_px - 1], fill=255)
    disc.putalpha(dm)
    img.alpha_composite(disc, (int(cx - r), int(cy - r)))

    # The raised ring around the field, brighter than the field it encloses.
    ring = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(ring).ellipse([cx - r * 0.92, cy - r * 0.92,
                                  cx + r * 0.92, cy + r * 0.92],
                                 outline=(255, 255, 255, 0),
                                 width=max(2, int(r * 0.16)))
    rmask = Image.new('L', (w, h), 0)
    ImageDraw.Draw(rmask).ellipse([cx - r * 0.94, cy - r * 0.94,
                                   cx + r * 0.94, cy + r * 0.94],
                                  outline=255, width=max(2, int(r * 0.15)))
    img.paste(vgrad((w, h), m['ring_top'], m['ring_bot']), (0, 0), rmask)

    dr = ImageDraw.Draw(img)
    for rr in (r, r * 0.80):
        dr.ellipse([cx - rr, cy - rr, cx + rr, cy + rr],
                   outline=m['line'] + (190,), width=max(2, int(r * 0.045)))

    # ---- numeral --------------------------------------------------------
    font = ImageFont.truetype(FONT, int(r * 1.02))
    txt = str(rank)
    tl, tt, tr_, tb = dr.textbbox((0, 0), txt, font=font)
    tx, ty = cx - (tr_ + tl) / 2, cy - (tb + tt) / 2
    # Cast down-right off the numeral so it looks stamped into the face.
    glyph = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(glyph).text((tx, ty), txt, font=font, fill=m['shade'] + (200,))
    img.alpha_composite(glyph.filter(ImageFilter.GaussianBlur(r * 0.04)),
                        (0, int(r * 0.06)))
    dr.text((tx, ty), txt, font=font, fill=(255, 253, 246, 255))

    # Crop to the ink and downsample. Height drives the output size because the
    # CSS gives the badge a fixed height and lets the width follow.
    img = img.crop(img.getchannel('A').getbbox())
    oh = 108
    return img.resize((max(1, round(img.width * oh / img.height)), oh),
                      Image.LANCZOS)


for rank in (1, 2, 3):
    out = medal(rank)
    path = 'assets/medal-%d.png' % rank
    out.save(path, optimize=True)
    print('wrote %s %s  aspect w/h %.4f' % (path, out.size, out.width / out.height))
