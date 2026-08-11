"""Convert every PNG the game actually loads into WebP.

    python tools/to-webp.py

Alpha art at quality 90 / method 6 is visually indistinguishable from the PNG
here — these are painted sprites, not screenshots of text — and lands roughly an
order of magnitude smaller. That is the whole point: 43 MB of PNG is what makes
a first run stutter no matter how honest the loading bar is.

The PNGs are left on disk. Every one of them is either a generator's output
(tools/make-*.py write PNG) or supplied artwork, so they are the masters; this
script is the build step that produces what the game ships.

NAMES is the list of images something actually references. Anything not in it
(c1-c3, f2/f3/f5, the old main-modal-* set) is dead weight nothing loads, so
converting it would only add files.
"""
import os
from PIL import Image

NAMES = [
    # engine sprites (src/index.js)
    'hook', 'block-rope', 'block', 'balloon',
    'c4', 'c5', 'c6', 'c7', 'c8',
    'f1', 'f4', 'f6', 'f7',
    'tutorial', 'tutorial-arrow', 'mango',
    'hud-score', 'hud-floor', 'hud-lives',
    'meter-track', 'meter-fill',
    'reaction-1', 'reaction-2', 'reaction-3',
    'reaction-1-off', 'reaction-2-off', 'reaction-3-off',
    'cream-1', 'cream-2', 'cream-3', 'cream-4',
    # page furniture (index.html / index-blink.html)
    'leaderboard', 'result', 'main-bg',
    'mode-card', 'mode-blink', 'mode-tap',
    'medal-1', 'medal-2', 'medal-3',
]

before = after = 0
for n in NAMES:
    src = f'assets/{n}.png'
    if not os.path.exists(src):
        print(f'  MISSING {src}')
        continue
    im = Image.open(src)
    im = im.convert('RGBA' if im.mode in ('P', 'LA', 'RGBA') else 'RGB')
    dst = f'assets/{n}.webp'
    im.save(dst, 'WEBP', quality=90, method=6)
    b, a = os.path.getsize(src), os.path.getsize(dst)
    before += b
    after += a
    print(f'  {n:<18} {b / 1024:8.0f}K -> {a / 1024:7.0f}K  {im.size}')

print(f'total {before / 1048576:.1f}MB -> {after / 1048576:.1f}MB')
