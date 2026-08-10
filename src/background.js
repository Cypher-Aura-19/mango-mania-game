import { checkMoveDown, getMoveDownValue, isGameOver } from './utils'
import * as constant from './constant'

const drawLayer = (engine, img, x, y, w, h) => {
  if (img && img.width && img.height) {
    engine.ctx.drawImage(img, x, y, w, h)
  }
}

// Ascending order of the backdrop: ground, then sky, then space. Space is the
// last one and simply repeats from there up — the climb has no ceiling, so
// there is nothing to cycle back to.
const bgSequence = ['gamebg', 'gamebg2']
const bgTop = 'gamebg3'

/* Static sky decor — the mango star, planet, satellite and friends. Each prop
 * belongs to the backdrop layer it is listed under and is drawn at a fixed spot
 * inside that tile, so it scrolls with the sky and has no motion of its own.
 * They used to be sprites that drifted and recycled themselves; against a
 * backdrop that is already moving, the drift only read as fidgeting.
 *
 * `gamebg` gets none — that is the low sky, and it is busy carrying the tower.
 * `gamebg2` is the climb out of the blue; `gamebg3` is space and repeats
 * forever, so its props are listed as several arrangements and the tile number
 * picks one. Same tile, same arrangement, every time: nothing shifts between
 * frames, and consecutive space screens are not carbon copies of each other.
 *
 * x is a fraction of the canvas and y a fraction of the tile; both mark the
 * prop's centre. Sizes are fractions of cloudSize, which is keyed to the play
 * column, so a planet stays the size it is on a phone.
 *
 * The x values hug the sides. The middle of the column is where the hook swings
 * and the tower grows, and while a prop there is only ever painted behind them,
 * the sky reads as less cluttered with the traffic lane left clear.
 */
const decor = {
  gamebg2: [
    [{ img: 'c4', x: 0.17, y: 0.16 },
      { img: 'c7', x: 0.84, y: 0.26, scale: 0.85 }]
  ],
  gamebg3: [
    [{ img: 'c5', x: 0.19, y: 0.22 },
      { img: 'c6', x: 0.82, y: 0.60, scale: 0.8 }],
    [{ img: 'c8', x: 0.80, y: 0.18 },
      { img: 'c4', x: 0.18, y: 0.10, scale: 0.85 }],
    [{ img: 'c6', x: 0.20, y: 0.24, scale: 0.9 },
      { img: 'c5', x: 0.83, y: 0.52, scale: 0.8 },
      { img: 'c7', x: 0.24, y: 0.84, scale: 0.6 }]
  ]
}

/* Drawn at the sprite's own aspect ratio: the props are 3:2 frames, and the
 * sprite painter these replace forced them into a square, which quietly
 * squashed every one of them.
 *
 * Nothing here reads the clock or the random source, so a prop lands on the
 * same pixel of its tile in every frame — which is the whole point of moving
 * them into the backdrop. Every y sits far enough inside the tile that no prop
 * crosses a seam.
 */
const paintDecor = (engine, name, tile, tileTop, tileH) => {
  const arrangements = decor[name]
  if (!arrangements) return
  const props = arrangements[tile % arrangements.length]
  const size = engine.getVariable(constant.cloudSize)
  props.forEach((p) => {
    const img = engine.getImg(p.img)
    if (!img || !img.width || !img.height) return
    const w = size * (p.scale || 1)
    const h = (img.height * w) / img.width
    engine.ctx.drawImage(img, (engine.width * p.x) - (w / 2),
      tileTop + (tileH * p.y) - (h / 2), w, h)
  })
}

/* Fill the canvas with an image the way CSS `background-size: cover` would:
 * scale until both axes are covered, centre it, and crop the overspill.
 *
 * The canvas spans the whole window, so a landscape screen gets the landscape
 * cut of the artwork at its own aspect. Stretching a 16:9 image to fit would
 * squash it; letterboxing would show the page behind it. Cover does neither.
 */
const drawCover = (engine, img, destY, destH) => {
  if (!img || !img.width || !img.height) return
  const cw = engine.width
  const ch = engine.height
  const scale = Math.max(cw / img.width, ch / img.height)
  // Float guard: img.height * (ch / img.height) can land a whisker under ch,
  // and a tile that stops short of its own box leaves a hairline at the seam.
  const dw = Math.max(img.width * scale, cw)
  const dh = Math.max(img.height * scale, ch)
  const { ctx } = engine
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, destY, cw, destH)
  ctx.clip()
  ctx.drawImage(img, (cw - dw) / 2, destY + ((ch - dh) / 2), dw, dh)
  ctx.restore()
}

/* One backdrop layer, in whichever cut suits the screen. The landscape cut is
 * only registered on a wide screen and only used once it has actually loaded,
 * so a phone keeps the portrait artwork and a laptop keeps the portrait one
 * until the download lands. */
const paint = (engine, name, destY, destH) => {
  const { wideBackdrop } = engine.getVariable(constant.gameUserOption) || {}
  const wide = wideBackdrop ? engine.getImg(`${name}Wide`) : null
  if (wide && wide.width) {
    drawCover(engine, wide, destY, destH)
    return
  }
  drawLayer(engine, engine.getImg(name), 0, destY, engine.width, destH)
}

export const backgroundImg = (engine) => {
  // Menu: background.webp fills the screen.
  if (!engine.getVariable(constant.gameStartNow, false)) {
    paint(engine, 'background', 0, engine.height)
    return
  }
  // In-game: game-bg-1 starts filling the screen; game-bg-2 sits ABOVE it.
  // As the tower climbs the strip moves DOWN — game-bg-1 slides out the bottom
  // while game-bg-2 comes down from the top into view. Layers alternate so the
  // ascent keeps flowing.
  let offset = engine.getVariable(constant.bgImgOffset, 0)
  // The background scrolls at the SAME rate as the line/blocks (s/2), starting
  // from the 2nd landing, so it moves in perfect lockstep with the tower
  // — game-bg-1 slides out the bottom and game-bg-2 comes down from the top
  // without any relative drift between the tower and background.
  const successCount = engine.getVariable(constant.successCount, 0)
  if (successCount >= 2 && !isGameOver(engine)) {
    engine.getTimeMovement(
      constant.moveDownMovement,
      [[offset, offset + (getMoveDownValue(engine, { pixelsPerFrame: s => s / 2 }))]],
      (value) => {
        offset = value
        engine.setVariable(constant.bgImgOffset, offset)
      },
      {
        name: 'background'
      }
    )
  }
  const H = engine.height
  const k0 = Math.floor(-offset / H) - 1
  for (let k = k0; k <= k0 + 2; k += 1) {
    // k decreases as the player climbs, so -k counts steps upward from the
    // starting tile. Anything at or past the end of the sequence draws the
    // space layer, which is why the climb can go on indefinitely.
    const step = Math.max(0, -k)
    const name = step < bgSequence.length ? bgSequence[step] : bgTop
    const y = (k * H) + offset
    if (y < H && (y + H) > 0) {
      // Snap to a whole pixel and overdraw 1px. At fractional y the canvas
      // resamples the edge rows against transparent black, which leaves a
      // hairline between tiles even when the artwork matches exactly; rounding
      // plus a 1px overlap makes each tile cover its predecessor's last row.
      const top = Math.round(y)
      const tileH = Math.ceil(H) + 1
      paint(engine, name, top, tileH)
      // Decor rides on top of its own tile, and the tile below is painted after
      // it, so a prop that hangs past the seam is covered rather than left
      // floating in the wrong sky. The arrangement index counts from the first
      // tile that uses this layer, so the first space screen always gets the
      // first arrangement.
      const tile = step < bgSequence.length ? 0 : step - bgSequence.length
      paintDecor(engine, name, tile, top, tileH)
    }
  }
}

const getLinearGradientColorRgb = (colorArr, colorIndex, proportion) => {
  const currentIndex = colorIndex + 1 >= colorArr.length ? colorArr.length - 1 : colorIndex
  const colorCurrent = colorArr[currentIndex]
  const nextIndex = currentIndex + 1 >= colorArr.length - 1 ? currentIndex : currentIndex + 1
  const colorNext = colorArr[nextIndex]
  const calRgbValue = (index) => {
    const current = colorCurrent[index]
    const next = colorNext[index]
    return Math.round(current + ((next - current) * proportion))
  }
  return `rgb(${calRgbValue(0)}, ${calRgbValue(1)}, ${calRgbValue(2)})`
}

export const backgroundLinearGradient = (engine) => {
  const grad = engine.ctx.createLinearGradient(0, 0, 0, engine.height)
  const colorArr = [
    [200, 255, 150],
    [105, 230, 240],
    [90, 190, 240],
    [85, 100, 190],
    [55, 20, 35],
    [75, 25, 35],
    [25, 0, 10]
  ]
  const offsetHeight = engine.getVariable(constant.bgLinearGradientOffset, 0)
  if (checkMoveDown(engine) && !isGameOver(engine)) {
    engine.setVariable(
      constant.bgLinearGradientOffset
      , offsetHeight + (getMoveDownValue(engine) * 1.5)
    )
  }
  const colorIndex = parseInt(offsetHeight / engine.height, 10)
  const calOffsetHeight = offsetHeight % engine.height
  const proportion = calOffsetHeight / engine.height
  const colorBase = getLinearGradientColorRgb(colorArr, colorIndex, proportion)
  const colorTop = getLinearGradientColorRgb(colorArr, colorIndex + 1, proportion)
  grad.addColorStop(0, colorTop)
  grad.addColorStop(1, colorBase)
  engine.ctx.fillStyle = grad
  engine.ctx.beginPath()
  engine.ctx.rect(0, 0, engine.width, engine.height)
  engine.ctx.fill()

  // lightning
  const lightning = () => {
    engine.ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
    engine.ctx.fillRect(0, 0, engine.width, engine.height)
  }
  engine.getTimeMovement(
    constant.lightningMovement, [], () => {},
    {
      before: lightning,
      after: lightning
    }
  )
}

export const background = (engine) => {
  backgroundLinearGradient(engine)
  backgroundImg(engine)
}

