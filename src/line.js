import { getMoveDownValue, getLandBlockVelocity, isGameOver, pl, pw } from './utils'
import * as constant from './constant'

export const lineAction = (instance, engine, time) => {
  const i = instance
  // Frozen scene: the landing target stops scrolling with the tower.
  if (isGameOver(engine)) return
  if (!i.ready) {
    i.y = engine.getVariable(constant.lineInitialOffset)
    i.ready = true
    // The first floor lands on the full stacking-column platform. collisionX
    // is always a physical RIGHT EDGE; subtracting block width here made this
    // initial line mean "rightmost allowed left edge", unlike every later line,
    // and forced a special no-clipping exception in the block code.
    i.x = pl(engine)
    i.collisionX = pl(engine) + pw(engine)
  }
  // Tower stays still — the line never scrolls. Only the background scrolls
  // (see background.js) to give the sense of ascending.
  // From the 2nd landing the line scrolls down by one block height per land —
// exactly cancelling the rise from stacking — so the tower top stays pinned.
// The background scrolls at the same rate, so the whole world moves as one
// and the tower never appears to climb or drop.
  if (engine.getVariable(constant.successCount, 0) >= 2) {
    engine.getTimeMovement(
      constant.moveDownMovement,
      [[instance.y, instance.y + (getMoveDownValue(engine, { pixelsPerFrame: s => s / 2 }))]],
      (value) => {
        instance.y = value
      },
      {
        name: 'line'
      }
    )
  }
  // Keep the sway: the line rocks horizontally in sync with the landed blocks
  // at the SAME velocity, so the whole tower stays aligned (no gaps between
  // clipped seams).
  const landBlockVelocity = getLandBlockVelocity(engine, time)
  instance.x += landBlockVelocity
  instance.collisionX += landBlockVelocity
}

export const linePainter = (instance, engine) => {
  const { ctx, debug } = engine
  if (!debug) {
    return
  }
  ctx.save()
  ctx.beginPath()
  ctx.strokeStyle = 'red'
  ctx.moveTo(instance.x, instance.y)
  ctx.lineTo(instance.collisionX, instance.y)
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.restore()
}
