"""Generate the wooden HUD plaques: assets/hud-score.png, assets/hud-floor.png.

    python tools/make-hud-plaques.py

Each plaque is a tan wooden frame around a cream panel, with the static label
(SCORE / FLOOR) baked in using Audex and mangoes overhanging the top edge. The
dynamic number is NOT baked — the game draws it live into the panel, so the
script prints the panel rect as fractions of the PNG for animateFuncs.js to use.

The timber, the cream and the slab builders come from hud_art so the plaques,
the lives tray and the satisfaction meter are all cut from the same stock.
"""
from PIL import Image, ImageDraw, ImageFont
from hud_art import (
    SS, FONT_PATH, FRUIT, LEAF, MANGO_ASPECT,
    stamp, wood_fill, cream_fill, carved_edges, drop_shadow,
)


def plaque(out_w, out_h, label, label_rgb, decorate):
    """Build one plaque. Returns (image, panel rect in output px).

    The panel rect is where the live number goes; the caller converts it to
    fractions so animateFuncs.js can place text without hard-coded pixels.
    """
    w, h = out_w * SS, out_h * SS
    canvas = Image.new('RGBA', (w, h), (0, 0, 0, 0))

    # Margins leave room for the mangoes to overhang the frame's top corners.
    mx = w * 0.055
    top = h * 0.150
    bot = h * 0.030
    frame_box = [mx, top, w - mx, h - bot]
    frame_r = int((frame_box[3] - frame_box[1]) * 0.24)
    fw = int(frame_box[2] - frame_box[0])
    fh = int(frame_box[3] - frame_box[1])

    drop_shadow(canvas, frame_box, frame_r, w, h)
    canvas.alpha_composite(wood_fill(fw, fh, frame_r),
                           (int(frame_box[0]), int(frame_box[1])))
    carved_edges(canvas, frame_box, frame_r, w)

    # Cream panel inset into the frame.
    pad_x = w * 0.075
    pad_y = fh * 0.115
    panel_box = [frame_box[0] + pad_x, frame_box[1] + pad_y,
                 frame_box[2] - pad_x, frame_box[3] - pad_y]
    pw = int(panel_box[2] - panel_box[0])
    ph = int(panel_box[3] - panel_box[1])
    canvas.alpha_composite(cream_fill(pw, ph, int(ph * 0.16), w * 0.010),
                           (int(panel_box[0]), int(panel_box[1])))

    # Label baked in, sized to fill ~72% of the panel width at most.
    size = int(ph * 0.30)
    font = ImageFont.truetype(FONT_PATH, size)
    while font.getbbox(label)[2] - font.getbbox(label)[0] > pw * 0.72 and size > 8:
        size -= 2
        font = ImageFont.truetype(FONT_PATH, size)
    bbox = font.getbbox(label)
    lx = panel_box[0] + (pw - (bbox[2] - bbox[0])) / 2 - bbox[0]
    ly = panel_box[1] + ph * 0.075 - bbox[1]
    d = ImageDraw.Draw(canvas)
    d.text((lx, ly + h * 0.006), label, font=font, fill=(255, 255, 255, 150))
    d.text((lx, ly), label, font=font, fill=tuple(label_rgb) + (255,))

    # Number region: under the label with a clear gap, and inset either side so
    # a wide value like "2560" keeps air between it and the frame.
    num_top = ly + (bbox[3] - bbox[1]) + ph * 0.175
    num_box = (panel_box[0] + pw * 0.045, num_top,
               panel_box[2] - pw * 0.045, panel_box[3] - ph * 0.070)

    decorate(canvas, w, h, frame_box)

    img = canvas.resize((out_w, out_h), Image.LANCZOS)
    return img, tuple(v / SS for v in num_box)


def lives_tray(out_w, out_h, count=3):
    """Wooden rail with `count` recessed sockets, one per life.

    The game draws a mango into each socket so spent ones can dim; the tray only
    provides the holes. Returns (image, socket geometry in output px).
    """
    w, h = out_w * SS, out_h * SS
    canvas = Image.new('RGBA', (w, h), (0, 0, 0, 0))

    mx, top, bot = w * 0.020, h * 0.060, h * 0.100
    bar_box = [mx, top, w - mx, h - bot]
    bar_h = int(bar_box[3] - bar_box[1])
    bar_r = bar_h // 2                                   # full pill
    drop_shadow(canvas, bar_box, bar_r, w, h)
    canvas.alpha_composite(wood_fill(int(bar_box[2] - bar_box[0]), bar_h, bar_r,
                                     grooves=(0.28,)),
                           (int(bar_box[0]), int(bar_box[1])))
    carved_edges(canvas, bar_box, bar_r, w)

    dia = int(bar_h * 0.68)
    pitch = w * 0.280
    cy = (bar_box[1] + bar_box[3]) / 2
    socket = cream_fill(dia, dia, dia // 2, w * 0.010, grooves=())
    centres = [(w / 2) + (i - (count - 1) / 2) * pitch for i in range(count)]
    for cx in centres:
        canvas.alpha_composite(socket, (int(cx - dia / 2), int(cy - dia / 2)))

    img = canvas.resize((out_w, out_h), Image.LANCZOS)
    return img, {
        'first': centres[0] / SS, 'pitch': pitch / SS,
        'cy': cy / SS, 'dia': dia / SS
    }


def score_decor(canvas, w, h, frame):
    """Mango clusters overhanging the top-left and top-right corners."""
    for side in (-1, 1):
        cx = (frame[0] + w * 0.075) if side < 0 else (frame[2] - w * 0.075)
        stamp(canvas, LEAF, cx - side * w * 0.075, frame[1] - h * 0.020, h * 0.215, 40 * side)
        stamp(canvas, LEAF, cx + side * w * 0.078, frame[1] + h * 0.010, h * 0.200, -68 * side)
        stamp(canvas, LEAF, cx, frame[1] - h * 0.105, h * 0.180, 6 * side)
        stamp(canvas, FRUIT, cx - side * w * 0.042, frame[1] + h * 0.040,
              h * 0.185, 22 * side, MANGO_ASPECT)
        stamp(canvas, FRUIT, cx + side * w * 0.040, frame[1] - h * 0.028,
              h * 0.225, -16 * side, MANGO_ASPECT)


def floor_decor(canvas, w, h, frame):
    """One mango sitting on the top edge, leaves fanning out at both corners."""
    for side, x in ((1, w * 0.105), (-1, w * 0.895)):
        stamp(canvas, LEAF, x, frame[1] + h * 0.030, h * 0.215, 56 * side)
        stamp(canvas, LEAF, x + side * w * 0.070, frame[1] - h * 0.010, h * 0.185, 22 * side)
    stamp(canvas, LEAF, w * 0.425, frame[1] - h * 0.080, h * 0.170, 50)
    stamp(canvas, LEAF, w * 0.578, frame[1] - h * 0.080, h * 0.170, -50)
    stamp(canvas, FRUIT, w * 0.500, frame[1] - h * 0.030, h * 0.245, -24, MANGO_ASPECT)



PLAQUES = [
    ('assets/hud-score.png', 300, 200, 'SCORE', (74, 48, 18), score_decor),
    ('assets/hud-floor.png', 260, 200, 'FLOOR', (58, 132, 46), floor_decor),
]

for path, pw_, ph_, label, rgb, decor in PLAQUES:
    img, num = plaque(pw_, ph_, label, rgb, decor)
    img.save(path, optimize=True)
    print(f'wrote {path} {img.size} number box (fractions of w,h): '
          f'x {num[0] / pw_:.4f}-{num[2] / pw_:.4f}  y {num[1] / ph_:.4f}-{num[3] / ph_:.4f}')

TRAY_W, TRAY_H = 220, 84
tray, geom = lives_tray(TRAY_W, TRAY_H)
tray.save('assets/hud-lives.png', optimize=True)
print(f'wrote assets/hud-lives.png {tray.size} sockets (fractions of w,h): '
      f'first x {geom["first"] / TRAY_W:.4f}  pitch {geom["pitch"] / TRAY_W:.4f}  '
      f'cy {geom["cy"] / TRAY_H:.4f}  dia {geom["dia"] / TRAY_W:.4f}')
