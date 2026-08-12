"""Bake each customer clip into a pre-keyed sprite atlas for phones.

The runtime keyer in src/customer.js strips the near-white background from a
video FRAME BY FRAME, on the main thread, with a getImageData readback. On
WebKit that readback is synchronous with the game loop, so the iOS path skips
video entirely and shows a single still. This tool does the identical keying
OFFLINE, once, and packs the transparent frames into one WebP grid per mood.
The phone then plays the reaction by drawing one grid cell per frame — the same
one drawImage the frozen still already cost, with zero keying at runtime.

The mask is the same one used everywhere else (near-white -> dilate for
connectivity -> keep only what the frame border can reach -> intersect back with
the undilated near mask, so a tooth or an eye highlight stays opaque). It is
vectorised here with numpy/cv2 so all ~150 frames of three clips bake in
seconds; the reference implementation lives in tools/make-ios-customer-stills.py.

Output: assets/customer-<mood>-atlas.webp and assets/customer-atlas.json, the
manifest src/customer.js reads (grid shape, cell size, frame count, fps).
"""
from pathlib import Path
import json
import math
import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
MOODS = ("watching", "happy", "angry")

# Phone draw size is ~40% of a column; 192px on the long side is a touch above
# that on the densest phones and downsamples cleanly. 15fps reads as motion
# while halving the frame count against the 30fps source.
LONG_SIDE = 192
FPS_OUT = 15
TOLERANCE = 80
RADIUS = 2
MASK_LONG = 128
VERSION = "20260812-atlas"


def fit(w, h, long_side):
    s = long_side / max(w, h)
    return max(2, round(w * s)), max(2, round(h * s))


def key_frame(bgr, ow, oh, mw, mh):
    """Background-subtracted RGBA uint8 at (ow, oh)."""
    small = cv2.resize(bgr, (mw, mh), interpolation=cv2.INTER_LINEAR)
    thr = 255 - TOLERANCE
    near = ((small[:, :, 0] >= thr) & (small[:, :, 1] >= thr)
            & (small[:, :, 2] >= thr)).astype(np.uint8)

    kernel = np.ones((RADIUS * 2 + 1, RADIUS * 2 + 1), np.uint8)
    dil = cv2.dilate(near, kernel)

    # Components of the dilated near mask; only those touching an edge are the
    # true outside. Interior white (teeth, catch-lights) is unreachable and stays.
    _, lab = cv2.connectedComponents(dil, connectivity=4)
    border = (set(lab[0, :]) | set(lab[-1, :])
              | set(lab[:, 0]) | set(lab[:, -1]))
    border.discard(0)
    outside = np.isin(lab, list(border))
    bg = outside & (near == 1)

    alpha_small = np.where(bg, 0, 255).astype(np.uint8)
    alpha = cv2.resize(alpha_small, (ow, oh), interpolation=cv2.INTER_LINEAR)
    rgb = cv2.cvtColor(
        cv2.resize(bgr, (ow, oh), interpolation=cv2.INTER_LANCZOS4),
        cv2.COLOR_BGR2RGB)
    return np.dstack([rgb, alpha])


def bake(mood):
    cap = cv2.VideoCapture(str(ASSETS / f"{mood}.mp4"))
    if not cap.isOpened():
        raise SystemExit(f"cannot open {mood}.mp4")
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    w0 = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h0 = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    ow, oh = fit(w0, h0, LONG_SIDE)
    mw, mh = fit(w0, h0, MASK_LONG)
    step = max(1, round(src_fps / FPS_OUT))

    frames = []
    idx = 0
    while True:
        ok, bgr = cap.read()
        if not ok:
            break
        if idx % step == 0:
            frames.append(Image.fromarray(key_frame(bgr, ow, oh, mw, mh), "RGBA"))
        idx += 1
    cap.release()

    n = len(frames)
    cols = math.ceil(math.sqrt(n))
    rows = math.ceil(n / cols)
    atlas = Image.new("RGBA", (cols * ow, rows * oh), (0, 0, 0, 0))
    for i, fr in enumerate(frames):
        atlas.paste(fr, ((i % cols) * ow, (i // cols) * oh))

    out = ASSETS / f"customer-{mood}-atlas.webp"
    atlas.save(out, "WEBP", quality=80, method=6)
    kb = out.stat().st_size // 1024
    print(f"{out.name}: {n} frames, cell {ow}x{oh}, grid {cols}x{rows}, {kb}KB")
    return {"file": f"{out.name}?v={VERSION}", "cols": cols, "rows": rows,
            "count": n, "cw": ow, "ch": oh}


def main():
    manifest = {"fps": FPS_OUT, "version": VERSION, "moods": {}}
    for mood in MOODS:
        manifest["moods"][mood] = bake(mood)
    (ASSETS / "customer-atlas.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8")
    print("wrote assets/customer-atlas.json")


if __name__ == "__main__":
    main()
