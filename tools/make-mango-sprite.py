"""Draw the mango life-counter sprite used by the in-game HUD.

Kept as a script so the art can be re-rendered at a different size or tuned
without hand-editing pixels. Matches heart.png's presentation — white keyline,
soft drop shadow, single glossy highlight — so it reads the same in the HUD.

    python tools/make-mango-sprite.py

Writes assets/mango.png. The geometry and colour ramp live in mango_art.py so
the HUD plaque decorations (tools/make-hud-plaques.py) draw the same fruit.
"""
from mango_art import render

render(out=128, ss=8).save('assets/mango.png', optimize=True)
print('wrote assets/mango.png')
