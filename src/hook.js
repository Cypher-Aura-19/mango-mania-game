import { getSwingBlockVelocity, isGameOver, px } from './utils'
import { slingRingPos } from './block'
import * as constant from './constant'

export const hookAction = (instance, engine, time) => {
  // Frozen scene: the crane stops swinging.
  if (isGameOver(engine)) return
  const ropeHeight = engine.getVariable(constant.ropeHeight)
  if (!instance.ready) {
    // Centre of the stacking column, not of the canvas: on a laptop the canvas
    // is wider than the column and the hook has to hang over the tower.
    instance.x = px(engine, 0.5)
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

// hook.webp is not a plain strap: rows 0..418 of 507 are one flat dark colour,
// then a gold clasp and hook head are moulded into the bottom 88 rows. Scaling
// the whole texture to span the rope stretches that head by however long the
// rope happens to be, so draw the head at its native aspect and let only the
// featureless strap take up the slack.
const HOOK_STRAP = 419 / 507
const HOOK_HEAD_ASPECT = 88 / 50 // head height / texture width

/* The throat of the claw — the concave bite a ring is meant to sit in — as a
 * fraction of the head. Measured off hook.webp with _measure_claw: the striped
 * clasp fills rows 419..462, the grey claw starts at row 475 (0.64 of the head)
 * and splits into a curve and a tip over rows 485..495, i.e. 0.75..0.86. The
 * middle of that bite, cols 22..31, is what the rope is aimed at — and it is
 * LEFT of the strap's own centre, which is why the horizontal offset is needed
 * as well as the vertical one. */
const HOOK_THROAT = { x: 26.5 / 50, y: 0.8 }

export const hookPainter = (instance, engine) => {
  const { ctx } = engine
  const ropeHeight = engine.getVariable(constant.ropeHeight)
  const ropeWidth = ropeHeight * constant.hookSize
  const hook = engine.getImg('hook')
  if (!hook || !hook.width) return
  /* Aim the claw at the block's sling ring instead of drawing a fixed length of
   * rope and hoping the two meet.
   *
   * They can't meet by luck: the ring rides at a multiple of the BLOCK's height,
   * the block is sized off the play column, and the rope was a multiple of
   * ropeHeight which comes off the canvas height — so the two drift apart with
   * the window's aspect (the block is 0.21 of the rope on a phone, 0.39 on a
   * laptop) and drift again with every clipped floor. At the old fixed 2.72 the
   * claw kept 14% of its height over the ring on a phone and 45% on a laptop:
   * the rig visibly coming apart into two floating pieces.
   *
   * Read the block rather than deriving where it ought to be — the hook and the
   * block are separate instances on separate time-movements (the hook alone runs
   * hookUpMovement), so the nominal gap between them is only right between
   * hand-offs and wrong by most of a hook-head the rest of the time. */
  const block = engine.instancesObj[engine.defaultLayer]
    .filter(i => i.status === constant.swing)[0]
  const gap = (constant.ropeTopFactor - constant.hookTopFactor) * ropeHeight
  const blockPivotY = block ? block.y : instance.y + gap
  const headH = ropeWidth * HOOK_HEAD_ASPECT
  // The sling is drawn UNROTATED, so measure the ring in screen space and put
  // the claw there — then rotate the rope about the same pivot the block swings
  // around, which carries the claw along the identical arc.
  const ring = block
    ? slingRingPos(block)
    : { x: instance.x, y: blockPivotY + ropeHeight }
  ctx.save()
  ctx.translate(instance.x, blockPivotY)
  ctx.rotate((Math.PI * 2) - instance.angle)
  ctx.translate(-instance.x, -blockPivotY)
  // Un-rotate the ring into the strap's own frame: the drawing below happens
  // inside the rotation, so it needs the ring where the rotated canvas will put
  // it, not where it sits on screen.
  const a = -instance.angle
  const dx = ring.x - instance.x
  const dy = ring.y - blockPivotY
  const localX = instance.x + ((dx * Math.cos(a)) + (dy * Math.sin(a)))
  const localY = blockPivotY + ((dy * Math.cos(a)) - (dx * Math.sin(a)))
  // Hang the strap so the throat — not the tip of the texture — lands on the
  // ring, in both axes.
  const total = (localY - instance.y) + ((1 - HOOK_THROAT.y) * headH)
  const strapH = Math.max(1, total - headH)
  const x = localX - (HOOK_THROAT.x * ropeWidth)
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
