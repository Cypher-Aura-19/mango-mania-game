import { getMoveDownValue, getLandBlockVelocity } from './utils'
import * as constant from './constant'

export const lineAction = (instance, engine, time) => {
  const i = instance
  if (!i.ready) {
    i.y = engine.getVariable(constant.lineInitialOffset)
    i.ready = true
    i.collisionX = engine.width - engine.getVariable(constant.blockWidth)
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

