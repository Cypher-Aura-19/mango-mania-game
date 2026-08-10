"""Generate the control-mode chooser card: assets/mode-card.png.

    python tools/make-mode-cards.py

The card is asked before every run: blink control, or tap/click. It is cut from
the same orange-framed cream stock as the profile card, so the two read as one
step in the same flow rather than two different screens.

This is a FRAME, not a finished picture. The two choices are the illustrated
cards assets/blink.png and assets/tap.png, which the page lays into the slots
this script measures out. So the only things baked here are the parts that must
not move relative to the frame: the border, the mango crest, the heading and the
OR badge sitting in the gutter between the slots. The script prints every slot
as a fraction of the PNG for the pages' CSS to consume.

The slot aspect is read off the real artwork rather than guessed, and the whole
card's aspect is then solved backwards from it, so the illustrations sit in
their slots at their native proportions with no letterboxing at any size.
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from hud_art import (
    SS, FONT_PATH, FRUIT, LEAF, MANGO_ASPECT,
    vgrad, streaks, mask, stroke, stamp, drop_shadow,
)

# Every geometry constant below is a fraction of the card's WIDTH, vertical ones
# included. The height is not known until the artwork has been measured, so
# fractions-of-height would be circular; W is the one fixed unit here.
W = 1100
FRAME_L, FRAME_R = 0.022, 0.978
FRAME_T = 0.062
PAD_X, PAD_Y = 0.032, 0.026    # frame -> cream body
TITLE_T = 0.116
SLOT_T = 0.268
SLOT_W = 0.390
SLOT_L = 0.058                 # left slot's left edge; the right slot mirrors it
SLOT_GAP_B = 0.045             # slot bottom -> frame bottom
BOTTOM = 0.014                 # frame bottom -> PNG bottom, for the drop shadow

# Frame and cream sampled off assets/profile.webp, so the chooser and the
# profile card are the same card.
FRAME_TOP = (255, 190, 66)
FRAME_BOT = (236, 141, 16)
FRAME_EDGE = (150, 66, 2)
FRAME_HI = (255, 228, 158)
CREAM_TOP = (255, 251, 235)
CREAM_BOT = (246, 229, 194)
CREAM_EDGE = (206, 160, 96)
TITLE_RGB = (92, 50, 12)
SUB_RGB = (156, 112, 64)
SPARK_RGB = (255, 197, 49)


def normalise_pair():
    """Trim, size-match and bottom-align the two illustrations.

    They are drawn at different sizes and carry different amounts of empty
    space, so dropped into equal slots as-is one would tower over the other.
    Cropping each to its own ink and matching WIDTHS puts them at the same
    scale; bottom-aligning inside a shared canvas then lines their START pills
    up across the gutter, which is the one row the eye actually compares.

    Writes assets/mode-blink.png / assets/mode-tap.png and returns their common
    aspect, which is what the card's height is solved from.
    """
    cards = {}
    for key, src in (('blink', 'assets/blink.png'), ('tap', 'assets/tap.png')):
        im = Image.open(src).convert('RGBA')
        cards[key] = im.crop(im.getbbox())

    cw = 760
    scaled = {k: im.resize((cw, max(1, round(im.height * cw / im.width))), Image.LANCZOS)
              for k, im in cards.items()}
    ch = max(im.height for im in scaled.values())
    for key, im in scaled.items():
        out = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
        out.alpha_composite(im, (0, ch - im.height))
        out.save(f'assets/mode-{key}.png', optimize=True)
        print(f'wrote assets/mode-{key}.png {out.size}')
    return cw / ch


def slab(w_, h_, radius, top, bot, seed=11, grain=0.05):
    """Rounded gradient panel with a little grain, matched to the card stock."""
    g = vgrad(w_, h_, top, bot)
    g = g * (1 + grain * streaks(w_, h_, 16.0, 2.0, seed)[..., None])
    img = Image.fromarray(np.clip(g, 0, 255).astype('uint8'), 'RGB').convert('RGBA')
    img.putalpha(mask((w_, h_), [0, 0, w_ - 1, h_ - 1], radius))
    return img


def recess(img, blur, edge, strength=150):
    """Darken a band hugging the panel's own rim, so it reads as sunk into the
    card rather than laid on it. The band is the alpha minus its own blur."""
    m = img.getchannel('A')
    ring = np.asarray(m, np.float32) / 255.0
    soft = np.asarray(m.filter(ImageFilter.GaussianBlur(blur)), np.float32) / 255.0
    inset = np.clip((ring - soft) * 2.2, 0, 1) * ring
    hh, ww = ring.shape
    img.alpha_composite(Image.fromarray(np.dstack([
        np.full((hh, ww, 3), edge, 'uint8'),
        (inset * strength).astype('uint8')]), 'RGBA'))


def spark(dr, cx, cy, r, rgb):
    """The four-point star used all over the cards, as a polygon."""
    k = r * 0.30
    dr.polygon([(cx, cy - r), (cx + k, cy - k), (cx + r, cy), (cx + k, cy + k),
                (cx, cy + r), (cx - k, cy + k), (cx - r, cy), (cx - k, cy - k)],
               fill=tuple(rgb) + (255,))


def fit(text, target_w, start):
    """Largest Audex that keeps `text` inside `target_w`."""
    size = int(start)
    f = ImageFont.truetype(FONT_PATH, size)
    while f.getbbox(text)[2] - f.getbbox(text)[0] > target_w and size > 8:
        size -= 2
        f = ImageFont.truetype(FONT_PATH, size)
    return f


def centred(dr, text, font, cx, top, fill, lift=None):
    """Draw `text` centred on cx with its cap top at `top`. Returns its width
    and height. `lift` paints a pale ghost a hair below for the carved look."""
    b = font.getbbox(text)
    x = cx - (b[2] - b[0]) / 2 - b[0]
    y = top - b[1]
    if lift:
        dr.text((x, y + lift[1]), text, font=font, fill=lift[0])
    dr.text((x, y), text, font=font, fill=tuple(fill) + (255,))
    return b[2] - b[0], b[3] - b[1]


# ---- solve the card's height off the measured artwork ----------------------
aspect = normalise_pair()
SLOT_H = SLOT_W / aspect
FRAME_B = SLOT_T + SLOT_H + SLOT_GAP_B
H = round(W * (FRAME_B + BOTTOM))

w = W * SS
h = H * SS
U = w                      # every fraction above is in units of the width
canvas = Image.new('RGBA', (w, h), (0, 0, 0, 0))

# ---- frame and cream body --------------------------------------------------
frame_box = [U * FRAME_L, U * FRAME_T, U * FRAME_R, U * FRAME_B]
frame_r = int(U * 0.072)
fw = int(frame_box[2] - frame_box[0])
fh = int(frame_box[3] - frame_box[1])
drop_shadow(canvas, frame_box, frame_r, w, h)
canvas.alpha_composite(slab(fw, fh, frame_r, FRAME_TOP, FRAME_BOT, seed=5, grain=0.03),
                       (int(frame_box[0]), int(frame_box[1])))
canvas.alpha_composite(stroke(canvas.size, frame_box, frame_r,
                              max(1, int(U * 0.009)), FRAME_EDGE + (255,)))
bevel = U * 0.016
canvas.alpha_composite(stroke(
    canvas.size, [frame_box[0] + bevel, frame_box[1] + bevel,
                  frame_box[2] - bevel, frame_box[3] - bevel],
    int(frame_r * 0.82), max(1, int(U * 0.005)), FRAME_HI + (180,)))

body_box = [frame_box[0] + U * PAD_X, frame_box[1] + U * PAD_Y,
            frame_box[2] - U * PAD_X, frame_box[3] - U * PAD_Y]
body_r = int(frame_r * 0.76)
body = slab(int(body_box[2] - body_box[0]), int(body_box[3] - body_box[1]),
            body_r, CREAM_TOP, CREAM_BOT, seed=19, grain=0.025)
recess(body, U * 0.010, CREAM_EDGE, 120)
canvas.alpha_composite(body, (int(body_box[0]), int(body_box[1])))

# ---- crest -----------------------------------------------------------------
# Mangoes sitting on the top rail, exactly the trick the FLOOR plaque pulls.
cx0 = U * 0.500
stamp(canvas, LEAF, cx0 - U * 0.075, frame_box[1] + U * 0.012, U * 0.062, 52)
stamp(canvas, LEAF, cx0 + U * 0.075, frame_box[1] + U * 0.012, U * 0.062, -52)
stamp(canvas, LEAF, cx0 - U * 0.030, frame_box[1] - U * 0.026, U * 0.055, 26)
stamp(canvas, LEAF, cx0 + U * 0.030, frame_box[1] - U * 0.026, U * 0.055, -26)
stamp(canvas, FRUIT, cx0 - U * 0.052, frame_box[1] + U * 0.004, U * 0.062, 24, MANGO_ASPECT)
stamp(canvas, FRUIT, cx0 + U * 0.052, frame_box[1] + U * 0.004, U * 0.062, -24, MANGO_ASPECT)
stamp(canvas, FRUIT, cx0, frame_box[1] - U * 0.006, U * 0.075, -8, MANGO_ASPECT)

d = ImageDraw.Draw(canvas)

# ---- heading ---------------------------------------------------------------
TITLE = 'HOW WILL YOU PLAY?'
title_font = fit(TITLE, U * 0.78, U * 0.066)
tw, th = centred(d, TITLE, title_font, cx0, U * TITLE_T, TITLE_RGB,
                 lift=((255, 255, 255, 165), U * 0.005))

SUB = 'PICK A CARD TO START'
sub_font = fit(SUB, U * 0.46, U * 0.032)
sub_top = U * TITLE_T + th + U * 0.030
sw, sh = centred(d, SUB, sub_font, cx0, sub_top, SUB_RGB)
for side in (-1, 1):
    sx = cx0 + side * (sw / 2 + U * 0.052)
    spark(d, sx, sub_top + sh * 0.45, U * 0.018, SPARK_RGB)
    spark(d, sx + side * U * 0.028, sub_top + sh * 1.05, U * 0.010, (255, 222, 130))

# ---- slots -----------------------------------------------------------------
# Nothing is painted in them. The illustrations already carry their own frames,
# so a well behind one would read as a frame inside a frame.
SLOTS = {
    'blink': [SLOT_L, SLOT_T, SLOT_L + SLOT_W, SLOT_T + SLOT_H],
    'tap': [1 - SLOT_L - SLOT_W, SLOT_T, 1 - SLOT_L, SLOT_T + SLOT_H],
}

# ---- OR badge --------------------------------------------------------------
# Sits in the gutter between the slots, so the two read as alternatives rather
# than as two things to do in order.
or_d = int(U * 0.100)
or_cx, or_cy = cx0, U * (SLOT_T + SLOT_H / 2)
badge = slab(or_d, or_d, or_d // 2, FRAME_TOP, FRAME_BOT, seed=7, grain=0.02)
canvas.alpha_composite(badge, (int(or_cx - or_d / 2), int(or_cy - or_d / 2)))
or_box = [or_cx - or_d / 2, or_cy - or_d / 2, or_cx + or_d / 2, or_cy + or_d / 2]
d.ellipse(or_box, outline=CREAM_TOP + (255,), width=int(U * 0.010))
d.ellipse(or_box, outline=FRAME_EDGE + (255,), width=int(U * 0.003))
or_font = fit('OR', or_d * 0.52, or_d * 0.46)
centred(d, 'OR', or_font, or_cx, or_cy - or_d * 0.16, (255, 252, 238),
        lift=((150, 66, 2, 150), or_d * 0.018))

img = canvas.resize((W, H), Image.LANCZOS)
img.save('assets/mode-card.png', optimize=True)

print(f'wrote assets/mode-card.png {img.size}  aspect {W / H:.4f}')
print(f'  slot aspect {aspect:.4f}')
for key, box in SLOTS.items():
    # Vertical fractions were authored against the width; the page needs them
    # against the card's own height, so convert on the way out.
    k = W / H
    print(f'  slot {key:<5} left {box[0]:.4f}  top {box[1] * k:.4f}  '
          f'width {box[2] - box[0]:.4f}  height {(box[3] - box[1]) * k:.4f}')
