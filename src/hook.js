import { getSwingBlockVelocity } from './utils'
import * as constant from './constant'

export const hookAction = (instance, engine, time) => {
  const ropeHeight = engine.getVariable(constant.ropeHeight)
  if (!instance.ready) {
    instance.x = engine.width / 2
    instance.y = ropeHeight * constant.hookTopFactor
    instance.ready = true
  }
  engine.getTimeMovement(
    constant.hookUpMovement,
    [[instance.y, instance.y - ropeHeight]],
    (value) => {
      instance.y = value
    },
    {
      after: () => {
        instance.y = ropeHeight * constant.hookTopFactor
      }
    }
  )
  engine.getTimeMovement(
    constant.hookDownMovement,
    [[instance.y, instance.y + ropeHeight]],
    (value) => {
      instance.y = value
    },
    {
      name: 'hook'
    }
  )
  const initialAngle = engine.getVariable(constant.initialAngle)
  instance.angle = initialAngle *
    getSwingBlockVelocity(engine, time)
  instance.weightX = instance.x +
    (Math.sin(instance.angle) * ropeHeight)
  instance.weightY = instance.y +
    (Math.cos(instance.angle) * ropeHeight)
}

// hook.png is not a plain strap: rows 0..418 of 507 are one flat dark colour,
// then a gold clasp and hook head are moulded into the bottom 88 rows. Scaling
// the whole texture to span the rope stretches that head by however long the
// rope happens to be, so draw the head at its native aspect and let only the
// featureless strap take up the slack.
const HOOK_STRAP = 419 / 507
const HOOK_HEAD_ASPECT = 88 / 50 // head height / texture width

export const hookPainter = (instance, engine) => {
  const { ctx } = engine
  const ropeHeight = engine.getVariable(constant.ropeHeight)
  const ropeWidth = ropeHeight * constant.hookSize
  const hook = engine.getImg('hook')
  if (!hook || !hook.width) return
  // The hook hangs higher than the block it carries. Both fall by the same
  // amount during hookDownMovement, so the block's pivot is always this fixed
  // gap below the hook's live y.
  const gap = (constant.ropeTopFactor - constant.hookTopFactor) * ropeHeight
  const blockPivotY = instance.y + gap
  ctx.save()
  // Swing around the BLOCK's pivot, not the hook's, so the rope's lower end
  // traces exactly the same arc as the block hanging off it at every angle.
  ctx.translate(instance.x, blockPivotY)
  ctx.rotate((Math.PI * 2) - instance.angle)
  ctx.translate(-instance.x, -blockPivotY)
  // Fixed length, NOT derived from the gap. Sizing it from the gap made the rope
  // grow by however far the block was lowered, which walked the hook head down
  // with the block instead of leaving it in place.
  const total = constant.hookRopeLength * ropeHeight
  const headH = ropeWidth * HOOK_HEAD_ASPECT
  const strapH = Math.max(1, total - headH)
  const x = instance.x - (ropeWidth / 2)
  const splitY = Math.round(hook.height * HOOK_STRAP)
  // Strap runs 1px past the split and the head paints over it, so no background
  // hairline opens up where the two draws meet.
  ctx.drawImage(
    hook,
    0, 0, hook.width, splitY,
    x, instance.y, ropeWidth, strapH + 1
  )
  ctx.drawImage(
    hook,
    0, splitY, hook.width, hook.height - splitY,
    x, instance.y + strapH, ropeWidth, headH
  )
  ctx.restore()
}

