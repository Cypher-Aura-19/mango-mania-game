"""Shared timber-and-cream art used by every HUD piece.

The plaques (make-hud-plaques.py) and the satisfaction meter
(make-satisfaction-meter.py) are cut from the same wood and the same cream, so
the palette and the slab builders live here rather than in either script. If
the wood tone changes, it changes for the whole HUD at once.

Everything is drawn at SS x the output size and downsampled, which is what
gives the rounded corners and the text a clean edge.
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from mango_art import render

SS = 4
FONT_PATH = 'assets/audex/Audex-Regular.ttf'

WOOD_TOP = (215, 177, 104)
WOOD_BOT = (176, 133, 66)
WOOD_EDGE = (108, 74, 33)
WOOD_GROOVE = (150, 110, 52)
WOOD_HI = (238, 209, 148)
PANEL_TOP = (251, 240, 208)
PANEL_BOT = (234, 213, 164)
PANEL_GROOVE = (223, 199, 150)
PANEL_EDGE = (150, 112, 55)
LEAF_MID = (96, 170, 60)
LEAF_DARK = (52, 112, 40)
SHADOW = (86, 58, 22)


def vgrad(w, h, top, bot):
    """Vertical linear gradient as a float HxWx3 array."""
    t = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
    col = np.float32(top) * (1 - t) + np.float32(bot) * t
    return np.repeat(col, w, axis=1)


def streaks(w, h, sx, sy, seed):
    """Smooth directional noise in [-1,1]. Downsample-then-upsample is a cheap
    way to get grain that runs along one axis without a real 2D convolution."""
    rng = np.random.default_rng(seed)
    n = np.clip(rng.normal(0, 1, (h, w)) * 40 + 128, 0, 255).astype('uint8')
    img = Image.fromarray(n, 'L')
    img = img.resize((max(1, int(w / sx)), max(1, int(h / sy))), Image.BILINEAR)
    img = img.resize((w, h), Image.BICUBIC)
    return (np.asarray(img, np.float32) - 128) / 40.0


def mask(size, box, radius, fill=255, width=0, outline=None):
    """Rounded-rectangle coverage mask (mode L)."""
    layer = Image.new('L', size, 0)
    ImageDraw.Draw(layer).rounded_rectangle(
        box, radius=radius, fill=fill, outline=outline, width=width)
    return layer


def stroke(size, box, radius, width, rgba):
    """Rounded-rectangle outline on a transparent RGBA layer."""
    layer = Image.new('RGBA', size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).rounded_rectangle(
        box, radius=radius, outline=rgba, width=width)
    return layer



def leaf_sprite(length, seed=3):
    """Pointed oval leaf with a darker rim and a centre vein."""
    h = int(length)
    w = int(length * 0.46)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    u = (yy - h / 2) / (h / 2 - 1)
    v = (xx - w / 2) / (w / 2 - 1)
    half = np.power(np.clip(1 - u * u, 0, 1), 0.7)
    body = np.clip((half - np.abs(v)) * w * 0.5, 0, 1)
    rim = np.clip((half * 1.12 - np.abs(v)) * w * 0.5, 0, 1)
    shade = 0.5 + 0.5 * streaks(w, h, 2.0, 8.0, seed)
    rgb = np.float32(LEAF_MID) * (0.82 + 0.30 * shade[..., None])
    out = Image.fromarray(np.dstack([
        np.clip(np.float32(LEAF_DARK) * np.ones((h, w, 3), np.float32), 0, 255).astype('uint8'),
        (rim * 255).astype('uint8')]), 'RGBA')
    out.alpha_composite(Image.fromarray(
        np.dstack([np.clip(rgb, 0, 255).astype('uint8'),
                   (body * 255).astype('uint8')]), 'RGBA'))
    vein = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(vein).line([(w / 2, h * 0.10), (w / 2, h * 0.90)],
                              fill=LEAF_DARK + (110,), width=max(1, int(w * 0.06)))
    out.alpha_composite(vein)
    return out


# One fruit and one leaf, rendered once and then scaled/rotated per placement so
# every mango on the HUD is the same fruit as the life counter.
# A thin warm rim rather than the counter's white keyline: white would read as
# a sticker cut-out against the wood, where the reference has the fruit sitting
# directly on the frame.
FRUIT = render(out=256, ss=4, keyline_rgb=(163, 96, 24), keyline_grow=0.013,
               shadow_alpha=0, leaf=False)
FRUIT = FRUIT.crop(FRUIT.getbbox())
LEAF = leaf_sprite(256)

MANGO_ASPECT = 0.78


def stamp(canvas, sprite, cx, cy, height, angle, aspect=1.0):
    """Scale a sprite to `height` px tall, rotate it, and centre it on (cx, cy).

    aspect < 1 narrows it — the life-counter mango is nearly round because it
    is read at 8% of the screen width, but at plaque size it needs the longer
    taper to be recognisable as a mango rather than an orange.
    """
    scale = height / sprite.height
    s = sprite.resize((max(1, int(sprite.width * scale * aspect)), int(height)), Image.LANCZOS)
    s = s.rotate(angle, resample=Image.BICUBIC, expand=True)
    canvas.alpha_composite(s, (int(cx - s.width / 2), int(cy - s.height / 2)))


def wood_fill(w, h, radius, grooves=(0.34, 0.70), lit='top'):
    """Rounded wooden slab: gradient, grain along the planks, groove lines.

    lit='left' builds the board on its side and stands it up, so the shading
    runs across the timber and the grain runs down it. That is how an upright
    post reads; the plaques are boards lying flat and stay lit from the top.
    """
    if lit == 'left':
        return wood_fill(h, w, radius, grooves).transpose(Image.TRANSPOSE)
    wood = vgrad(w, h, WOOD_TOP, WOOD_BOT)
    wood = wood * (1 + 0.085 * streaks(w, h, 14.0, 1.6, 11)[..., None])
    for frac in grooves:
        band = np.exp(-(((np.arange(h, dtype=np.float32) - h * frac)
                         / (h * 0.022)) ** 2) / 2)[:, None, None]
        wood = wood * (1 - band * 0.55) + np.float32(WOOD_GROOVE) * band * 0.55
    img = Image.fromarray(np.clip(wood, 0, 255).astype('uint8'), 'RGB').convert('RGBA')
    img.putalpha(mask((w, h), [0, 0, w - 1, h - 1], radius))
    return img


def cream_fill(w, h, radius, blur, grooves=(0.30, 0.62, 0.88), lit='top'):
    """Rounded cream panel with faint plank lines and an inner shadow, so it
    reads as recessed into the wood rather than laid on top of it."""
    if lit == 'left':
        return cream_fill(h, w, radius, blur, grooves).transpose(Image.TRANSPOSE)
    panel = vgrad(w, h, PANEL_TOP, PANEL_BOT)

    panel = panel * (1 + 0.030 * streaks(w, h, 18.0, 2.0, 27)[..., None])
    for frac in grooves:
        band = np.exp(-(((np.arange(h, dtype=np.float32) - h * frac)
                         / (h * 0.010)) ** 2) / 2)[:, None, None]
        panel = panel * (1 - band * 0.45) + np.float32(PANEL_GROOVE) * band * 0.45
    img = Image.fromarray(np.clip(panel, 0, 255).astype('uint8'), 'RGB').convert('RGBA')
    m = mask((w, h), [0, 0, w - 1, h - 1], radius)
    img.putalpha(m)
    # The mask minus its own blur is a band hugging the rim — that is the shadow.
    ring = np.asarray(m, np.float32) / 255.0
    soft = np.asarray(m.filter(ImageFilter.GaussianBlur(blur)), np.float32) / 255.0
    inset = np.clip((ring - soft) * 2.2, 0, 1) * ring
    img.alpha_composite(Image.fromarray(np.dstack([
        np.full((h, w, 3), PANEL_EDGE, 'uint8'),
        (inset * 130).astype('uint8')]), 'RGBA'))
    return img


def carved_edges(canvas, box, radius, w):
    """Dark outline plus a lighter inner bevel line. This pair is what makes a
    slab read as carved rather than as a flat rounded rectangle."""
    canvas.alpha_composite(stroke(canvas.size, box, radius,
                                  max(1, int(w * 0.011)), WOOD_EDGE + (255,)))
    bevel = w * 0.026
    canvas.alpha_composite(stroke(
        canvas.size, [box[0] + bevel, box[1] + bevel, box[2] - bevel, box[3] - bevel],
        int(radius * 0.8), max(1, int(w * 0.005)), WOOD_HI + (170,)))


def drop_shadow(canvas, box, radius, w, h):
    sh = mask(canvas.size, [box[0], box[1] + h * 0.012, box[2], box[3] + h * 0.012],
              radius, fill=150)
    sh = sh.filter(ImageFilter.GaussianBlur(w * 0.012))
    layer = Image.new('RGBA', canvas.size, SHADOW + (0,))
    layer.putalpha(sh)
    canvas.alpha_composite(layer)
