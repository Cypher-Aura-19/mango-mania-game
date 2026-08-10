"""Shared mango renderer.

The HUD life counter and the plaque decorations both need the same fruit, but
presented differently: the counter sits on the busy game background and needs
heart.png's white keyline to pop, while the plaque mangoes sit on wood and want
a thin warm outline instead. Same geometry and colour ramp either way, so the
two never drift apart.
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

# Ripe mango: green-gold shoulder into golden yellow into a warm orange belly.
RAMP_STOPS = [
    (0.00, (214, 222, 84)),
    (0.22, (255, 208, 61)),
    (0.55, (252, 176, 20)),
    (0.82, (240, 133, 25)),
    (1.00, (222, 104, 26)),
]
BLUSH_RGB = (232, 88, 47)
LEAF_RGB = (94, 168, 58)
STEM_RGB = (120, 84, 40)


def _silhouette(s, cx, cy, a, b, bend=0.22, exp_top=2.05, exp_bot=2.25):
    """Superellipse bent along y, which gives the lopsided mango curve."""
    yy, xx = np.mgrid[0:s, 0:s].astype(np.float32)
    u = (xx - cx) / a
    v = (yy - cy) / b
    u = u + bend * (v * v - 0.33)          # fuller on one side, tapered at the tip
    e = np.where(v < 0, exp_top, exp_bot)  # flatter shoulders, plumper bottom
    d = np.abs(u) ** e + np.abs(v) ** e
    return np.clip((1.0 - d) * s * 0.05, 0, 1), v


def _ramp(t, stops):
    """Piecewise-linear colour ramp over t in [0,1]."""
    out = np.zeros(t.shape + (3,), np.float32)
    for i in range(len(stops) - 1):
        (p0, c0), (p1, c1) = stops[i], stops[i + 1]
        m = (t >= p0) & (t <= p1)
        k = np.zeros_like(t)
        k[m] = (t[m] - p0) / max(p1 - p0, 1e-6)
        for c in range(3):
            out[..., c] += m * (c0[c] + (c1[c] - c0[c]) * k)
    return out


def render(out=128, ss=8, keyline_rgb=(255, 255, 255), keyline_grow=0.030,
           shadow_rgb=(120, 62, 12), shadow_alpha=90, leaf=True):
    """Render one mango, supersampled then downsampled to `out` px square.

    keyline_rgb=None drops the outline, shadow_alpha=0 drops the drop shadow.
    """
    s = out * ss
    cx, cy = s * 0.465, s * 0.545
    a, b = s * 0.300, s * 0.340

    body, v = _silhouette(s, cx, cy, a, b)
    # The keyline is the same shape grown slightly, so its width stays even.
    grown, _ = _silhouette(s, cx, cy, a + s * keyline_grow, b + s * keyline_grow)

    t = np.clip((v + 1) / 2, 0, 1)
    rgb = _ramp(t, RAMP_STOPS)

    # Sun-blush on the upper shoulder, the giveaway that it is a mango not a lemon.
    yy, xx = np.mgrid[0:s, 0:s].astype(np.float32)
    blush = np.exp(-(((xx - s * 0.40) ** 2 + (yy - s * 0.27) ** 2) / (2 * (s * 0.20) ** 2)))
    rgb = rgb * (1 - blush[..., None] * 0.55) + np.float32(BLUSH_RGB) * blush[..., None] * 0.55

    # Single soft specular, angled like the heart's.
    spec = np.exp(-((((xx - s * 0.35) / (s * 0.115)) ** 2
                     + ((yy - s * 0.34) / (s * 0.175)) ** 2)) / 2)
    rgb = np.clip(rgb + 255 * spec[..., None] * 0.42, 0, 255)

    canvas = Image.new('RGBA', (s, s), (0, 0, 0, 0))

    if shadow_alpha:
        sh = Image.fromarray((grown * shadow_alpha).astype('uint8'), 'L')
        sh = sh.filter(ImageFilter.GaussianBlur(s * 0.022))
        shadow = Image.new('RGBA', (s, s), shadow_rgb + (0,))
        shadow.putalpha(sh)
        canvas.alpha_composite(shadow, (int(s * 0.012), int(s * 0.020)))

    if keyline_rgb is not None:
        line = Image.new('RGBA', (s, s), tuple(keyline_rgb) + (0,))
        line.putalpha(Image.fromarray((grown * 255).astype('uint8'), 'L'))
        canvas.alpha_composite(line)

    fruit = Image.fromarray(np.dstack([rgb.astype('uint8'),
                                       (body * 255).astype('uint8')]), 'RGBA')
    canvas.alpha_composite(fruit)

    if leaf:
        # Leaf and stem, drawn on their own layer so they get the same keyline.
        lf = Image.new('RGBA', (s, s), (0, 0, 0, 0))
        d = ImageDraw.Draw(lf)
        edge = tuple(keyline_rgb) + (255,) if keyline_rgb is not None else None
        d.ellipse([s * 0.50, s * 0.055, s * 0.80, s * 0.20], fill=LEAF_RGB + (255,),
                  outline=edge, width=int(s * 0.022) if edge else 0)
        lf = lf.rotate(-18, resample=Image.BICUBIC, center=(s * 0.52, s * 0.15))
        ImageDraw.Draw(lf).line([(s * 0.47, s * 0.20), (s * 0.535, s * 0.115)],
                                fill=STEM_RGB + (255,), width=int(s * 0.045))
        canvas.alpha_composite(lf)

    return canvas.resize((out, out), Image.LANCZOS)
