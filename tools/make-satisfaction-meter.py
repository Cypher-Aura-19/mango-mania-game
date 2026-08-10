"""Generate the customer-satisfaction meter and its reaction markers.

    python tools/make-satisfaction-meter.py

Three kinds of output:

  assets/meter-track.png   the upright wooden post with an empty recessed
                           channel, drawn first
  assets/meter-fill.png    the mango-juice column that lives in that channel,
                           the same canvas size as the track so the game can
                           draw the bottom `p` fraction of it with an identical
                           destination rect and no arithmetic
  assets/reaction-N.png    three customers on wooden tokens, sitting on the post
  assets/reaction-N-off.png  as level markers — one lit for the current mood, the
                           rest greyed out. These replace the star markers in the
                           reference art. The people are Kenney's Toon Characters
                           (CC0), assembled from the head and torso parts kept in
                           tools/sprites/; see the LICENSE.txt beside them.

The timber is the same stock as the HUD plaques (see hud_art.py), lit from the
side because this one is standing up. The script prints the channel rect and
the badge geometry as fractions for animateFuncs.js.
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from hud_art import (
    SS, FRUIT, LEAF, MANGO_ASPECT, WOOD_EDGE, WOOD_HI,
    mask, stroke, streaks, stamp, wood_fill, cream_fill, carved_edges, drop_shadow,
)

METER_W, METER_H = 120, 600
BADGE = 128
# The juice column reads bottom-up: ripe deep orange settled at the bottom of
# the tube, lightening toward the surface. Deliberately NOT the fruit's own ramp
# (mango_art.RAMP_STOPS) — that one starts in yellow-green, which against tan
# timber made the gauge look like yet more wood instead of something in it.
JUICE_STOPS = [(0.00, (255, 198, 72)), (0.42, (250, 156, 30)),
               (0.78, (236, 112, 26)), (1.00, (214, 78, 26))]


def ramp(n, stops):
    """Sample a list of (position, rgb) stops into an n-row float colour table."""
    t = np.linspace(0, 1, n, dtype=np.float32)
    pos = np.float32([p for p, _ in stops])
    cols = np.float32([c for _, c in stops])
    return np.stack([np.interp(t, pos, cols[:, k]) for k in range(3)], axis=-1)


def meter():
    """Returns (track, fill, channel rect as fractions of the PNG)."""
    w, h = METER_W * SS, METER_H * SS
    track = Image.new('RGBA', (w, h), (0, 0, 0, 0))

    # Headroom at the top for the mango sitting on the cap.
    frame_box = [w * 0.055, h * 0.070, w * 0.945, h * 0.985]
    fw = int(frame_box[2] - frame_box[0])
    fh = int(frame_box[3] - frame_box[1])
    frame_r = int(fw * 0.46)
    # Both the offset and the blur are taken off the WIDTH here. The plaques key
    # the offset to their height, which is fine for a squat board but would give
    # this 600px-tall post an absurd shadow.
    drop_shadow(track, frame_box, frame_r, w, w)
    track.alpha_composite(wood_fill(fw, fh, frame_r, grooves=(), lit='left'),
                          (int(frame_box[0]), int(frame_box[1])))
    carved_edges(track, frame_box, frame_r, w)

    # The channel is inset by the same physical amount all round, so the tube
    # has an even wall.
    pad = fw * 0.19
    ch_box = [frame_box[0] + pad, frame_box[1] + pad,
              frame_box[2] - pad, frame_box[3] - pad]
    cw = int(ch_box[2] - ch_box[0])
    chh = int(ch_box[3] - ch_box[1])
    ch_r = cw // 2                                     # pill: fully round ends

    # An empty gauge channel is the same cream as a plaque panel, only sitting
    # deep in shadow at the bottom of a groove — so it is that cream taken most
    # of the way to the timber's own edge colour, not a different material.
    trough = cream_fill(cw, chh, ch_r, w * 0.012, grooves=(), lit='left')
    arr = np.asarray(trough, np.float32)
    arr[..., :3] = (arr[..., :3] * 0.30 + np.float32(WOOD_EDGE) * 0.70) * 0.92
    track.alpha_composite(Image.fromarray(arr.astype('uint8'), 'RGBA'),
                          (int(ch_box[0]), int(ch_box[1])))
    track.alpha_composite(stroke(track.size, ch_box, ch_r,
                                 max(1, int(w * 0.012)), WOOD_EDGE + (190,)))

    # A mango on the cap, the same fruit as the plaques and the life counter.
    stamp(track, LEAF, w * 0.30, frame_box[1] - h * 0.004, w * 0.34, 52)
    stamp(track, LEAF, w * 0.71, frame_box[1] - h * 0.004, w * 0.34, -52)
    stamp(track, FRUIT, w * 0.50, frame_box[1] - h * 0.012, w * 0.46, -22, MANGO_ASPECT)

    # The juice column: mango ramp running bottom-heavy, plus a soft specular
    # stripe down the left so the fill reads as liquid in a round tube.
    col = ramp(chh, JUICE_STOPS)[:, None, :].repeat(cw, axis=1)
    col *= 1 + 0.045 * streaks(cw, chh, 1.4, 22.0, 5)[..., None]
    x = np.linspace(0, 1, cw, dtype=np.float32)[None, :, None]
    col += 46 * np.exp(-((x - 0.30) ** 2) / (2 * 0.11 ** 2))
    col -= 26 * np.exp(-((x - 0.88) ** 2) / (2 * 0.13 ** 2))
    juice = Image.fromarray(np.clip(col, 0, 255).astype('uint8'), 'RGB').convert('RGBA')
    juice.putalpha(mask((cw, chh), [0, 0, cw - 1, chh - 1], ch_r))

    fill = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    fill.alpha_composite(juice, (int(ch_box[0]), int(ch_box[1])))

    rect = {'x': ch_box[0] / w, 'y': ch_box[1] / h,
            'w': cw / w, 'h': chh / h}
    return (track.resize((METER_W, METER_H), Image.LANCZOS),
            fill.resize((METER_W, METER_H), Image.LANCZOS), rect)


def dulled(img):
    """The unreached version of a marker: drained of colour and pushed toward
    stone, so a lit face is unmistakably the one the customer is wearing.

    Contrast is stretched around mid-grey afterwards. Blending flat toward stone
    is what makes it read as "off", but on its own it also closes the gap between
    ink and skin until the face turns to mush at 40px — the stretch buys that
    definition back without putting any colour back in."""
    arr = np.asarray(img, np.float32)
    rgb, a = arr[..., :3], arr[..., 3:]
    luma = (rgb * np.float32([0.299, 0.587, 0.114])).sum(-1)[..., None]
    grey = rgb * 0.20 + luma * 0.80
    out = grey * 0.66 + np.float32((146, 136, 122)) * 0.34
    out = 138 + (out - 138) * 1.42
    return Image.fromarray(np.dstack([np.clip(out, 0, 255), a]).astype('uint8'), 'RGBA')


def bust(name, overlap=0.10):
    """Assemble a customer's head and torso into a head-and-shoulders portrait.

    The sources are Kenney's Toon Characters modular parts (CC0, see
    tools/sprites/LICENSE.txt), which are meant to be stacked like this. The full
    standing poses were tried first and are wrong for a round token: a raised
    fist or a bent knee wanders into the crop and reads as a skin-coloured blob.
    Parts have nothing in them but the character.

    `overlap` is how far the torso tucks under the head, as a fraction of the
    torso's height — without it the neck shows as a seam.
    """
    head = Image.open(f'tools/sprites/{name}-head.png').convert('RGBA')
    body = Image.open(f'tools/sprites/{name}-body.png').convert('RGBA')
    head, body = head.crop(head.getbbox()), body.crop(body.getbbox())
    w = max(head.width, body.width)
    ov = int(body.height * overlap)
    out = Image.new('RGBA', (w, head.height + body.height - ov), (0, 0, 0, 0))
    out.alpha_composite(body, ((w - body.width) // 2, head.height - ov))
    out.alpha_composite(head, ((w - head.width) // 2, 0))
    return out


def token(bg_top, bg_bot, name, scale, shift):
    """A customer portrait on a wooden token.

    The portrait is pasted onto its own layer and then clipped to the disc, so
    the shoulders run off the bottom edge the way a real portrait does instead of
    floating inside the circle.
    """
    s = BADGE * SS
    canvas = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    ring_box = [s * 0.045, s * 0.045, s * 0.955, s * 0.955]
    drop_shadow(canvas, ring_box, int(s * 0.455), s, s)
    canvas.alpha_composite(wood_fill(int(s * 0.91), int(s * 0.91), int(s * 0.455),
                                     grooves=(), lit='left'),
                           (int(s * 0.045), int(s * 0.045)))
    carved_edges(canvas, ring_box, int(s * 0.455), s)

    d_px = int(s * 0.76)
    t = np.linspace(0, 1, d_px, dtype=np.float32)[:, None, None]
    disc = np.float32(bg_top) * (1 - t) + np.float32(bg_bot) * t
    disc = np.repeat(disc, d_px, axis=1)
    back = Image.fromarray(np.clip(disc, 0, 255).astype('uint8'), 'RGB').convert('RGBA')
    disc_mask = mask((d_px, d_px), [0, 0, d_px - 1, d_px - 1], d_px // 2)
    back.putalpha(disc_mask)
    canvas.alpha_composite(back, (int(s * 0.12), int(s * 0.12)))

    art = bust(name)
    pw = int(s * scale)
    art = art.resize((pw, max(1, int(art.height * pw / art.width))), Image.LANCZOS)
    char = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    char.alpha_composite(art, (int(s * 0.5 - pw / 2 + s * shift[0]), int(s * shift[1])))
    clip = Image.new('L', (s, s), 0)
    clip.paste(disc_mask, (int(s * 0.12), int(s * 0.12)))
    char.putalpha(Image.fromarray(
        (np.asarray(char.getchannel('A'), np.float32)
         * np.asarray(clip, np.float32) / 255).astype('uint8'), 'L'))
    canvas.alpha_composite(char)

    canvas.alpha_composite(stroke(canvas.size,
                                  [s * 0.12, s * 0.12, s * 0.88, s * 0.88],
                                  int(s * 0.38), max(1, int(s * 0.014)),
                                  WOOD_EDGE + (150,)))
    gloss = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(gloss).ellipse([s * 0.20, s * 0.10, s * 0.72, s * 0.34],
                                  fill=WOOD_HI + (70,))
    canvas.alpha_composite(gloss.filter(ImageFilter.GaussianBlur(s * 0.018)))
    return canvas.resize((BADGE, BADGE), Image.LANCZOS)


# path, disc gradient, sprite name, scale, (x, y) offset as fractions of the
# token. Three different people rather than one face in three moods, so the
# markers read as a queue of customers watching the cake go up: a moustached man
# scowling, a second man flat and unimpressed, and a regular grinning.
REACTIONS = [
    ('assets/reaction-1.png', (250, 214, 176), (232, 168, 128), 'cross', 0.60, 0.155),
    # `wait` is scaled up a touch: his quiff is tall, so an equal scale spends the
    # token's height on hair and leaves the face smaller than the other two.
    ('assets/reaction-2.png', (246, 232, 186), (226, 202, 142), 'wait', 0.62, 0.120),
    ('assets/reaction-3.png', (255, 240, 178), (250, 208, 108), 'happy', 0.60, 0.175),
]

track_img, fill_img, ch = meter()
track_img.save('assets/meter-track.png', optimize=True)
fill_img.save('assets/meter-fill.png', optimize=True)
print(f'wrote assets/meter-track.png + meter-fill.png {track_img.size} '
      f'channel (fractions of w,h): x {ch["x"]:.4f} y {ch["y"]:.4f} '
      f'w {ch["w"]:.4f} h {ch["h"]:.4f}')

for path, top, bot, name, scale, top_y in REACTIONS:
    img = token(top, bot, name, scale, (0.0, top_y))
    img.save(path, optimize=True)
    dulled(img).save(path.replace('.png', '-off.png'), optimize=True)
    print(f'wrote {path} + off variant {img.size}')
