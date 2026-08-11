import { Instance } from 'cooljs'
import { blockAction, blockPainter } from './block'
import {
  checkMoveDown,
  getMoveDownValue,
  drawBoardString,
  getAngleBase,
  isGameOver,
  freezeGame,
  pw
} from './utils'
import { addFlight } from './flight'
import * as constant from './constant'

// Where the cream panel sits inside a plaque PNG, as fractions of that PNG.
// Both plaques share these because the generator lays them out proportionally;
// tools/make-hud-plaques.py prints the numbers when it runs.
const panelRect = {
  x: 0.1633, y: 0.5021, w: 0.6734, h: 0.3294
}
// Sockets in the lives tray PNG. `first`/`pitch`/`dia` are fractions of its
// width, `cy` of its height. Also printed by make-hud-plaques.py.
const socketRect = {
  first: 0.22, pitch: 0.28, cy: 0.48, dia: 0.217
}
/* HUD geometry. Every SIZE below is a fraction of the stacking column (pw), so a
 * plaque is the same size on a laptop as on a phone; only the PLACEMENT keys to
 * the full canvas, which pushes the plaques out to the real screen corners
 * instead of leaving them huddled around the tower. */
const hudTop = 0.025          // fraction of the column width
const hudMargin = 0.03
const hudHeight = 0.22
const livesWidth = 0.30
const numberColor = '#4A3012'

// Gutter between the HUD and the edge of the SCREEN. A column-sized margin is
// too tight to read as deliberate once the canvas is much wider than the column,
// so it grows with the canvas up to a cap. On a portrait screen the two are the
// same number and this is exactly the old value.
const hudGutter = engine =>
  Math.min(engine.width * hudMargin, pw(engine) * 0.06)

// Draws a plaque of the given height, right-aligned to `right` if supplied and
// left-aligned to `x` otherwise, then paints its live number into the panel.
const drawPlaque = (engine, imgName, opt) => {
  const img = engine.getImg(imgName)
  if (!img || !img.width) return
  const { y, height, string } = opt
  const width = (img.width * height) / img.height
  const x = opt.right === undefined ? opt.x : opt.right - width
  engine.ctx.drawImage(img, x, y, width, height)
  drawBoardString(engine, {
    string,
    box: {
      x: x + (width * panelRect.x),
      y: y + (height * panelRect.y),
      w: width * panelRect.w,
      h: height * panelRect.h
    },
    color: numberColor
  })
}

// The lives tray: a wooden rail with three recessed sockets, one mango each.
// Spent lives stay in their socket at low alpha so the row never reflows, and
// the empty socket still reads as "a life used to be here".
//
// Anchored by its BOTTOM edge, not its top: the tray sits in the bottom-right
// corner, and the caller knows the gutter it wants to leave below the tray but
// not how tall the art is at this width. Deriving the top here keeps that
// arithmetic in one place.
const drawLives = (engine, right, bottom, width, failedCount) => {
  const tray = engine.getImg('hudLives')
  const mango = engine.getImg('mango')
  if (!tray || !tray.width || !mango || !mango.width) return
  const height = (tray.height * width) / tray.width
  const x = right - width
  const y = bottom - height
  const { ctx } = engine
  ctx.drawImage(tray, x, y, width, height)
  // Sized to overflow its socket a little, so the fruit sits IN the hole
  // rather than looking like a dot painted at the bottom of it.
  const size = width * socketRect.dia * 1.34
  const cy = y + (height * socketRect.cy)
  for (let i = 0; i < 3; i += 1) {
    const cx = x + (width * (socketRect.first + (i * socketRect.pitch)))
    ctx.save()
    if (i < failedCount) {
      ctx.globalAlpha = 0.22
    }
    ctx.drawImage(mango, cx - (size / 2), cy - (size / 2), size, size)
    ctx.restore()
  }
}

/* Flypasts, keyed by the floor that sets them off. `id` is just a unique slot
 * number — it names the instance and stops the same pass being added twice while
 * the floor holds — so the artwork is named separately and can repeat.
 *
 * The old schedule ran 2, 6, 8, 14, 18, 22, 25 with the image tied to the slot
 * number, which put the plane at floor 14 and the rocket at 22: heights most
 * runs never reach, so the best art in the game went unseen. These floors
 * front-load it — the plane is up by 5 and the rocket by 8 — and then keep
 * cycling so a long run still gets something crossing the sky now and then.
 *
 * The plane climbs bottomToTop like the rocket. Both sprites are drawn nose-up
 * from above, so flying them sideways showed the player a plane travelling
 * broadside; rising up the screen is the one heading that matches the artwork.
 *
 * `sound` is the clip that plays as the pass enters. f7 is the little comet and
 * has none — a silent streak reads fine, and something crossing the sky every
 * few floors is more welcome when it is not always announced.
 */
const flightSchedule = {
  2: { id: 1, img: 'f1', type: 'leftToRight', sound: 'flight-birds' },
  5: { id: 2, img: 'f4', type: 'bottomToTop', sound: 'flight-plane' },
  8: { id: 3, img: 'f6', type: 'bottomToTop', sound: 'flight-rocket' },
  11: { id: 4, img: 'f7', type: 'rightTopToLeft', sound: 'flight-comet' },
  14: { id: 5, img: 'f4', type: 'bottomToTop', sound: 'flight-plane' },
  17: { id: 6, img: 'f1', type: 'rightToLeft', sound: 'flight-birds' },
  20: { id: 7, img: 'f6', type: 'bottomToTop', sound: 'flight-rocket' },
  24: { id: 8, img: 'f7', type: 'rightTopToLeft', sound: 'flight-comet' }
}

export const endAnimate = (engine) => {
  const gameStartNow = engine.getVariable(constant.gameStartNow)
  if (!gameStartNow) return
  const successCount = engine.getVariable(constant.successCount, 0)
  const failedCount = engine.getVariable(constant.failedCount)
  const gameScore = engine.getVariable(constant.gameScore, 0)

  // FLOOR on the left, SCORE on the right, drawn to the same height so their
  // panels line up. Both plaques carry their own label and mango decorations.
  const colW = pw(engine)
  const gutter = hudGutter(engine)
  const height = colW * hudHeight
  const y = colW * hudTop
  const left = gutter
  const right = engine.width - gutter
  drawPlaque(engine, 'hudFloor', {
    x: left, y, height, string: successCount
  })
  drawPlaque(engine, 'hudScore', {
    right, y, height, string: gameScore
  })
  // Lives sit in the bottom-right corner. The bottom gutter matches the side
  // one so the tray reads as tucked into the corner rather than floating near
  // it.
  drawLives(engine, right, engine.height - gutter,
    colW * livesWidth, failedCount)
  /* The satisfaction gauge used to be drawn here, on the left below the FLOOR
   * plaque. The customer says it on video now — see src/customer.js — so the
   * number has no HUD of its own and the left edge is clear. */
  // Last thing in the frame: if the run just ended, stop the loop here, with
  // this fully-painted frame left on screen.
  freezeGame(engine)
}

export const startAnimate = (engine) => {
  const gameStartNow = engine.getVariable(constant.gameStartNow)
  if (!gameStartNow) return
  // No new blocks once the run is over — the last one stays where it fell.
  if (isGameOver(engine)) return
  const lastBlock = engine.getInstance(`block_${engine.getVariable(constant.blockCount)}`)
  if (!lastBlock || [constant.land, constant.out, constant.tip].indexOf(lastBlock.status) > -1) {
    if (checkMoveDown(engine) && getMoveDownValue(engine)) return
    if (engine.checkTimeMovement(constant.hookUpMovement)) return
    const angleBase = getAngleBase(engine)
    const initialAngle = (Math.PI
        * engine.utils.random(angleBase, angleBase + 5)
        * engine.utils.randomPositiveNegative()
    ) / 180
    engine.setVariable(constant.blockCount, engine.getVariable(constant.blockCount) + 1)
    engine.setVariable(constant.initialAngle, initialAngle)
    engine.setTimeMovement(constant.hookDownMovement, 500)
    const block = new Instance({
      name: `block_${engine.getVariable(constant.blockCount)}`,
      action: blockAction,
      painter: blockPainter
    })
    engine.addInstance(block)
  }
  const successCount = Number(engine.getVariable(constant.successCount, 0))
  const flight = flightSchedule[successCount]
  if (flight) {
    addFlight(engine, flight)
  }
}

