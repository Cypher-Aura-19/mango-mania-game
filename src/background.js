import { checkMoveDown, getMoveDownValue } from './utils'
import * as constant from './constant'

const drawLayer = (engine, img, x, y, w, h) => {
  if (img && img.width && img.height) {
    engine.ctx.drawImage(img, x, y, w, h)
  }
}

// Top-to-center darkening overlay on top of the game backgrounds.
// A vertical gradient: clearly dark at the top of the screen, fading out by the
// center. Chosen over a radial wash so the effect is actually visible.
const drawVignette = (engine) => {
  const { ctx } = engine
  const H = engine.height
  // Vertical linear gradient — darkest at the top, reaching the middle, then
  // fully clear AT the 50% line so it never darkens the bottom half.
  const grad = ctx.createLinearGradient(0, 0, 0, H * 0.5)
  grad.addColorStop(0, 'rgba(0,0,0,0.55)')   // dark at the top
  grad.addColorStop(0.7, 'rgba(0,0,0,0.22)') // some darkening in the middle
  grad.addColorStop(1, 'rgba(0,0,0,0)')       // clear exactly at the middle
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.rect(0, 0, engine.width, H)
  ctx.fill()
}

export const backgroundImg = (engine) => {
  // Menu: background.webp fills the screen, with the same vignette on top.
  if (!engine.getVariable(constant.gameStartNow, false)) {
    drawLayer(engine, engine.getImg('background'), 0, 0, engine.width, engine.height)
    drawVignette(engine)
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
  if (successCount >= 2) {
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
    const img = engine.getImg(k % 2 === 0 ? 'gamebg' : 'gamebg2')
    const y = (k * H) + offset
    if (y < H && (y + H) > 0) {
      drawLayer(engine, img, 0, y, engine.width, H)
    }
  }
  // Vignette on top of the background layers (game-bg-1 / game-bg-2).
  drawVignette(engine)
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
  if (checkMoveDown(engine)) {
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

