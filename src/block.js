import { Instance } from 'cooljs'
import {
  getMoveDownValue,
  getLandBlockVelocity,
  getSwingBlockVelocity,
  touchEventHandler,
  addSuccessCount,
  addFailedCount,
  addScore
} from './utils'
import * as constant from './constant'

let fragmentSeq = 0

const checkCollision = (block, line) => {
  // 0 goon 1 drop 2 rotate left 3 rotate right 4 ok 5 perfect
  if (block.y + block.height >= line.y) {
    if (block.x < line.x - block.calWidth || block.x > line.collisionX + block.calWidth) {
      return 1
    }
    if (block.x < line.x) {
      return 2
    }
    if (block.x > line.collisionX) {
      return 3
    }
    if (block.x > line.x + (block.calWidth * 0.8) && block.x < line.x + (block.calWidth * 1.2)) {
      // -10% +10%
      return 5
    }
    return 4
  }
  return 0
}
const swing = (instance, engine, time) => {
  const ropeHeight = engine.getVariable(constant.ropeHeight)
  if (instance.status !== constant.swing) return
  const i = instance
  const initialAngle = engine.getVariable(constant.initialAngle)
  i.angle = initialAngle *
    getSwingBlockVelocity(engine, time)
  i.weightX = i.x +
    (Math.sin(i.angle) * ropeHeight)
  i.weightY = i.y +
    (Math.cos(i.angle) * ropeHeight)
}

const checkBlockOut = (instance, engine) => {
  if (instance.y >= engine.height) {
    instance.visible = false
    instance.status = constant.out
    addFailedCount(engine)
  }
}

const applyLand = (engine, block, line, opts) => {
  const { blockY, keptLeft, keptWidth, isPerfect } = opts
  const i = block
  const lastSuccessCount = engine.getVariable(constant.successCount)
  addSuccessCount(engine)
  engine.setTimeMovement(constant.moveDownMovement, 500)
  if (lastSuccessCount === 10 || lastSuccessCount === 15) {
    engine.setTimeMovement(constant.lightningMovement, 150)
  }
  i.y = blockY
  // soft floor: never below 20% of the original width
  const minWidth = engine.getVariable(constant.blockWidth) * 0.2
  const finalWidth = Math.max(keptWidth, minWidth)
  i.x = keptLeft
  i.updateWidth(finalWidth)
  line.y = blockY
  line.x = keptLeft
  line.collisionX = keptLeft + finalWidth
  engine.setVariable(constant.currentWidth, finalWidth)
  // cheat detection: measured against the original block width
  const cheatWidth = engine.getVariable(constant.blockWidth) * 0.3
  if (i.x > engine.width - (cheatWidth * 2) || i.x < -cheatWidth) {
    engine.setVariable(constant.hardMode, true)
  }
  if (isPerfect) {
    i.perfect = true
    addScore(engine, true)
    engine.playAudio('drop-perfect')
  } else {
    addScore(engine)
    engine.playAudio('drop')
  }
}

// The block lands on the tower edge but can't balance — so it topples over
// that edge like a real object would. It hinges on the tower's corner and
// swings outward in an arc (rotation speed scales with how far off-center it
// is), then once it tips past ~74° it breaks off the corner and plummets
// outward-down. Mirrors the reference edition's rotate-left/right fall.
const tipBlockAction = (instance, engine) => {
  const i = instance
  const line = engine.getInstance('line')
  if (!i.tipRig) {
    i.tipRig = true
    // outwardOffset: horizontal distance from the tower edge (the pivot) to
    // the block's inner edge — the less the block is supported, the faster
    // it tips. tipDir 1 = hangs right, -1 = hangs left.
    i.outwardOffset = i.tipDir === 1
      ? (line.collisionX - i.x)
      : (line.x - i.x)
    i.outwardOffset = Math.max(i.outwardOffset, 1)
    i.originOutwardAngle = Math.atan(i.height / i.outwardOffset)
    i.originHypotenuse = Math.sqrt((i.height ** 2) + (i.outwardOffset ** 2))
    i.rotate = 0
    engine.playAudio('rotate')
  }
  const isRight = i.tipDir === 1
  const leftFix = isRight ? 1 : -1
  const rotateSpeed = engine.pixelsPerFrame(Math.PI * 4)
  const shouldFall = isRight ? i.rotate > 1.3 : i.rotate < -1.3 // ~74°
  if (!shouldFall) {
    // hinged on the corner: swing the block outward in an arc around the edge
    let rotateRatio = (i.calWidth - i.outwardOffset) / i.calWidth
    rotateRatio = rotateRatio > 0.5 ? rotateRatio : 0.5
    i.rotate += rotateSpeed * rotateRatio * leftFix
    const angle = i.originOutwardAngle + i.rotate
    const axisX = isRight ? line.collisionX : line.x
    const axisY = line.y
    i.x = axisX - (Math.cos(angle) * i.originHypotenuse)
    i.y = axisY - (Math.sin(angle) * i.originHypotenuse)
  } else {
    // tipped past the balance point — break off the corner and plummet outward
    i.rotate += (rotateSpeed / 8) * leftFix
    i.y += engine.pixelsPerFrame(engine.height * 0.7)
    i.x += engine.pixelsPerFrame(engine.width * 0.3) * leftFix
  }
  if (i.y > engine.height + i.height || i.x < -i.width || i.x > engine.width + i.width) {
    addFailedCount(engine)
    instance.visible = false
    engine.removeInstance(instance.name)
  }
}

export const blockAction = (instance, engine, time) => {
  const i = instance
  const ropeHeight = engine.getVariable(constant.ropeHeight)
  if (!i.visible) {
    return
  }
  if (!i.ready) {
    i.ready = true
    i.status = constant.swing
    instance.updateWidth(engine.getVariable(constant.currentWidth, engine.getVariable(constant.blockWidth)))
    instance.updateHeight(engine.getVariable(constant.blockHeight))
    instance.x = engine.width / 2
    instance.y = ropeHeight * -1.5
  }
  const line = engine.getInstance('line')
  switch (i.status) {
    case constant.swing:
      engine.getTimeMovement(
        constant.hookDownMovement,
        [[instance.y, instance.y + ropeHeight]],
        (value) => {
          instance.y = value
        },
        {
          name: 'block'
        }
      )
      swing(instance, engine, time)
      break
    case constant.beforeDrop:
      i.x = instance.weightX - instance.calWidth
      i.y = instance.weightY + (0.3 * instance.height) // add rope height
      i.rotate = 0
      i.ay = engine.pixelsPerFrame(0.0003 * engine.height) // acceleration of gravity
      i.startDropTime = time
      i.status = constant.drop
      break
    case constant.drop:
      const deltaTime = time - i.startDropTime
      i.startDropTime = time
      i.vy += i.ay * deltaTime
      i.y += (i.vy * deltaTime) + (0.5 * i.ay * (deltaTime ** 2))
      const collision = checkCollision(instance, line)
      const blockY = line.y - instance.height
      // Capture the ORIGINAL block left edge now — applyLand() mutates
      // instance.x, so it must not be read after the stack happens.
      const blockLeft = instance.x
      const blockRight = blockLeft + instance.width
      const overlapLeft = Math.max(blockLeft, line.x)
      const overlapRight = Math.min(blockRight, line.collisionX)
      const overlapWidth = overlapRight - overlapLeft
      // The block must land with at least 20% of itself resting on the tower.
      // If more than 80% hangs off the edge, it can't balance.
      const minOverlap = instance.width * 0.20
      if (overlapWidth <= 0) {
        // full miss — nothing to rest on, the block drops straight through
        checkBlockOut(instance, engine)
      } else if (overlapWidth < minOverlap) {
        // 80%+ of the block hangs off the tower — it touches the edge but
        // can't balance. Land it on the current block, then tip it over the
        // edge and let it tumble off (still a miss).
        i.status = constant.tip
        instance.y = blockY
        i.tipDir = (blockLeft + instance.width / 2) > ((line.x + line.collisionX) / 2) ? 1 : -1
        i.tipRig = false
      } else if (collision === 5) {
        // perfect: full-width stack, no clip, bonus + texture
        i.status = constant.land
        instance.y = blockY
        applyLand(engine, instance, line, {
          blockY,
          keptLeft: blockLeft,
          keptWidth: i.width,
          isPerfect: true
        })
      } else {
        // partial overlap → clip & stack (the protruding part falls off)
        i.status = constant.land
        instance.y = blockY
        applyLand(engine, instance, line, {
          blockY,
          keptLeft: overlapLeft,
          keptWidth: overlapWidth,
          isPerfect: false
        })
        const leftCut = overlapLeft - blockLeft
        const rightCut = blockRight - overlapRight
        if (leftCut > 1) {
          spawnFragment(engine, i, { left: blockLeft, width: leftCut, y: blockY, fallDir: -1 })
        }
        if (rightCut > 1) {
          spawnFragment(engine, i, { left: overlapRight, width: rightCut, y: blockY, fallDir: 1 })
        }
      }
      break
    case constant.tip:
      tipBlockAction(instance, engine)
      break
    case constant.land:
      engine.getTimeMovement(
        constant.moveDownMovement,
        [[instance.y, instance.y + (getMoveDownValue(engine, { pixelsPerFrame: s => s / 2 }))]],
        (value) => {
          if (!instance.visible) return
          instance.y = value
          if (instance.y > engine.height) {
            // Block has scrolled off the bottom — remove it from the engine so
            // dead instances don't pile up and slow every frame as you climb.
            instance.visible = false
            engine.removeInstance(instance.name)
          }
        },
        {
          name: instance.name
        }
      )
      instance.x += getLandBlockVelocity(engine, time)
      break
    default:
      break
  }
}

const drawSwingBlock = (instance, engine) => {
  const bl = engine.getImg('blockRope')
  engine.ctx.drawImage(
    bl, instance.weightX - instance.calWidth
    , instance.weightY
    , instance.width, instance.height * 1.3
  )
  const leftX = instance.weightX - instance.calWidth
  engine.debugLineY(leftX)
}

const drawBlock = (instance, engine) => {
  const { perfect } = instance
  const bl = engine.getImg(perfect ? 'block-perfect' : 'block')
  engine.ctx.drawImage(bl, instance.x, instance.y, instance.width, instance.height)
}

const drawTipBlock = (instance, engine) => {
  // Rotate about the block's top-left corner (instance.x/y) — the pivot the
  // topple arc is built around in tipBlockAction. Mirrors the reference.
  const bl = engine.getImg('block')
  const { ctx } = engine
  ctx.save()
  ctx.translate(instance.x, instance.y)
  ctx.rotate(instance.rotate)
  ctx.translate(-instance.x, -instance.y)
  ctx.drawImage(bl, instance.x, instance.y, instance.width, instance.height)
  ctx.restore()
}

export const blockPainter = (instance, engine) => {
  const { status } = instance
  switch (status) {
    case constant.swing:
      drawSwingBlock(instance, engine)
      break
    case constant.drop:
    case constant.land:
      drawBlock(instance, engine)
      break
    case constant.tip:
      drawTipBlock(instance, engine)
      break
    default:
      break
  }
}

const fragmentAction = (instance, engine, time) => {
  if (!instance.ready) {
    instance.ready = true
    // slight upward pop, then gravity; outward horizontal drift; tumble rotation
    instance.vy = -100
    instance.ay = 2000
    instance.vx = 130 * instance.fallDir
    instance.rotateVelocity = (2 + Math.random() * 3) * instance.fallDir
    instance.lastTime = time
    return
  }
  const dt = (time - instance.lastTime) / 1000
  instance.lastTime = time
  instance.vy += instance.ay * dt
  instance.x += instance.vx * dt
  instance.y += instance.vy * dt
  instance.rotate += instance.rotateVelocity * dt
  if (instance.y > engine.height + instance.height) {
    engine.removeInstance(instance.name)
  }
}

const fragmentPainter = (instance, engine) => {
  const { ctx } = engine
  const img = engine.getImg('block')
  ctx.save()
  ctx.translate(instance.x + instance.width / 2, instance.y + instance.height / 2)
  ctx.rotate(instance.rotate)
  ctx.translate(-(instance.x + instance.width / 2), -(instance.y + instance.height / 2))
  ctx.drawImage(img, instance.x, instance.y, instance.width, instance.height)
  ctx.restore()
}

const spawnFragment = (engine, block, { left, width, y, fallDir }) => {
  const frag = new Instance({
    name: `clip_${fragmentSeq++}`,
    action: fragmentAction,
    painter: fragmentPainter
  })
  frag.x = left
  frag.y = y
  frag.width = width
  frag.height = block.height
  frag.calWidth = width / 2
  frag.calHeight = block.height / 2
  frag.rotate = 0
  frag.fallDir = fallDir
  engine.addInstance(frag)
}

