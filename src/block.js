import { Instance } from 'cooljs'
import {
  getMoveDownValue,
  getLandBlockVelocity,
  getSwingBlockVelocity,
  getBlockHeightForWidth,
  touchEventHandler,
  addSuccessCount,
  addFailedCount,
  addScore,
  addSatisfaction,
  getSatisfactionDelta,
  isGameOver,
  playSfx,
  pl,
  pw,
  px
} from './utils'
import * as constant from './constant'

let fragmentSeq = 0
let creamSeq = 0

// Dead padding baked into the block textures, as a fraction of texture height.
// Measured with measure-alpha.js: block.webp is 1705 rows tall but only rows
// 66..1669 are FULLY opaque. Rows 57-65 fade in and rows 1670-1687 fade out —
// trimming only the completely-transparent rows still left those soft ramps
// being drawn, and two semi-transparent edges stacked on each other let the
// background show through as a hairline seam. Cut to the solid body so every
// floor has a hard top and bottom edge. block-perfect.webp has no padding.
const TEX_PAD = {
  block: { top: 66 / 1705, bottom: 35 / 1705 },
  'block-perfect': { top: 0, bottom: 0 }
}

// Vertical source rect for a block texture, skipping its transparent padding.
const texSrcY = (imgName, img) => {
  const pad = TEX_PAD[imgName] || { top: 0, bottom: 0 }
  const sy = Math.round(img.height * pad.top)
  const sh = Math.max(1, img.height - sy - Math.round(img.height * pad.bottom))
  return { sy, sh }
}

// block-rope.webp is a sling hanging ABOVE a cake, not a bare cake. These are the
// cake body's bounds as fractions of the texture, measured from its alpha
// channel: the cake starts halfway down the image. Stretching the whole texture
// into the block's width/height box therefore drew the cake at ~0.61x the
// landed block's height, which is why the hanging slab looked smaller than the
// tower it was about to join.
const ROPE_CAKE = { top: 0.5014, bottom: 0.967, left: 0.0281, right: 0.976 }

// Screen box the swinging block's CAKE body occupies at FULL size — the size it
// will be once it lands. drawSwingBlock shrinks this by SWING_SCALE for the
// hanging look, and beforeDrop hands the falling block the unscaled coords;
// sharing one source of truth means the drop can't start somewhere other than
// where the cake appeared to hang.
const swingCakeBox = instance => ({
  x: instance.weightX - instance.calWidth,
  y: instance.weightY + (0.3 * instance.height),
  w: instance.width,
  h: instance.height
})

// How big the cake looks while it dangles, relative to the size it lands at.
// Below 1 it reads as further away up on the rope. Shrunk about the box CENTRE
// so releasing it grows it back symmetrically — an edge anchor would make the
// block visibly jump sideways or downward on the first frame of the drop.
const SWING_SCALE = 0.88

/* Where the sling's gold ring is on screen — the point the hook's claw has to
 * close on.
 *
 * block-rope.webp carries the ring at the top of the sling: rows 56..195 of 2455
 * (centre 125.5) and cols 1061..1204 (centre 1132.5, a shade RIGHT of the
 * texture's own centre). Run those through the same solve drawSwingBlock uses
 * and they land wherever the block currently hangs.
 *
 * It has to be computed rather than written down as a constant offset because
 * it is a multiple of the BLOCK's height, while the rope is a multiple of
 * ropeHeight — and those two scale off different things. ropeHeight comes off
 * the canvas height, the block off the play column, so their ratio moves with
 * the window's aspect; and clipping squeezes the block further as the tower
 * goes up. A fixed rope length can only meet the ring at one window size on one
 * turn of the game.
 */
const RING = { cx: 1132.5 / 2209, cy: 125.5 / 2455 }

export const slingRingPos = (instance) => {
  const cake = scaledSwingCakeBox(instance)
  const fullW = cake.w / (ROPE_CAKE.right - ROPE_CAKE.left)
  const fullH = cake.h / (ROPE_CAKE.bottom - ROPE_CAKE.top)
  return {
    x: cake.x + ((RING.cx - ROPE_CAKE.left) * fullW),
    y: cake.y + ((RING.cy - ROPE_CAKE.top) * fullH)
  }
}

const scaledSwingCakeBox = (instance) => {
  const box = swingCakeBox(instance)
  const w = box.w * SWING_SCALE
  const h = box.h * SWING_SCALE
  return {
    x: box.x + ((box.w - w) / 2),
    y: box.y + ((box.h - h) / 2),
    w,
    h
  }
}

// Deterministic jagged-edge DEPTHS so the kept piece and its fragment share the
// SAME zigzag — the break looks like a real split. Values are POSITIVE depths
// measured from the cut line, dug INWARD into the block face. The sign (which
// direction "inward" is) is applied by the caller based on the cut side.
const makeJag = (seed, maxDepth) => {
  const n = 10
  const depth = Math.max(2, Math.min(maxDepth, 14)) // scale with the real cut
  const jag = [0]
  let s = Math.abs(Math.round(seed)) + 1
  for (let i = 1; i < n; i += 1) {
    s = (s * 9301 + 49297) % 233280
    const r = s / 233280
    const big = (i % 2 === 0) ? 1 : 0.55
    jag.push(r * depth * big) // 0..depth, uneven chipped profile
  }
  jag.push(0)
  return jag
}

// Clip a block/fragment region to a rectangle whose cut edge is a jagged line
// instead of a straight slice. cutSide 'left' jags the left edge; 'right' jags
// the right edge. Assumes the caller has already ctx.save()'d.
const clipCut = (engine, instance, cutSide) => {
  const { ctx } = engine
  const x = instance.x
  const y = instance.y
  const w = instance.width
  // Match the 1px seam overlap drawBlock adds, so the clip region never cuts
  // the extra pixel back off and reopens the gap between floors.
  const h = instance.height + (instance.seamExtend || 0)
  const jag = instance.cutJag
  const n = jag.length - 1
  ctx.beginPath()
  if (cutSide === 'left') {
    // Cut edge on the left: jag digs INWARD (rightwards) into the block face.
    ctx.moveTo(x + jag[0], y)
    for (let i = 1; i <= n; i += 1) ctx.lineTo(x + jag[i], y + h * (i / n))
    ctx.lineTo(x + w, y + h)
    ctx.lineTo(x + w, y)
  } else {
    // Cut edge on the right: jag digs INWARD (leftwards) into the block face.
    ctx.moveTo(x, y)
    ctx.lineTo(x, y + h)
    ctx.lineTo(x + w - jag[n], y + h)
    for (let i = n - 1; i >= 0; i -= 1) ctx.lineTo(x + w - jag[i], y + h * (i / n))
  }
  ctx.closePath()
  ctx.clip()
}

// Stroke a dark jagged outline along the cut edge so the crack is clearly
// visible. cutSide 'left' outlines the left edge, 'right' the right edge.
const strokeJagEdge = (engine, instance, cutSide) => {
  const { ctx } = engine
  const x = instance.x
  const y = instance.y
  const h = instance.height
  const jag = instance.cutJag
  const n = jag.length - 1
  ctx.save()
  ctx.beginPath()
  if (cutSide === 'left') {
    ctx.moveTo(x + jag[0], y)
    for (let i = 1; i <= n; i += 1) ctx.lineTo(x + jag[i], y + h * (i / n))
  } else {
    ctx.moveTo(x + instance.width - jag[0], y)
    for (let i = 1; i <= n; i += 1) ctx.lineTo(x + instance.width - jag[i], y + h * (i / n))
  }
  ctx.strokeStyle = 'rgba(30, 15, 5, 0.85)'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.restore()
}

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
/* The rope creaks at the ENDS of the swing, not continuously.
 *
 * A held loop would have been the obvious thing and it is the wrong thing twice
 * over: it needs pausing on release, on game over and on a fresh run — three
 * places to leave it stuck droning — and a rope groaning at a constant level
 * tells the player nothing. The turning points do: the sway is a sine of `time`
 * whose period is set by the difficulty, so voicing the reversals lands a creak
 * every ~570-630 ms that speeds up exactly when the hook does. It reads as the
 * rope taking the weight at the top of the arc, and it doubles as a metronome
 * for the drop.
 *
 * The reversal is read off the angle rather than computed from the clock so it
 * stays correct through the blink edition's swingSpeedScale and through
 * hardMode, both of which change the period underneath us.
 */
const voiceSwingCreak = (i, engine) => {
  const last = i.creakAngle
  i.creakAngle = i.angle
  // A motionless block gives no delta to take a sign from. That is the first
  // floor, which does not swing at all (hard = 0), so it stays silent.
  if (last === undefined || i.angle === last) return
  const dir = i.angle > last ? 1 : -1
  const turned = i.creakDir !== undefined && dir !== i.creakDir
  i.creakDir = dir
  if (turned) playSfx(engine, 'swing')
}

const swing = (instance, engine, time) => {
  const ropeHeight = engine.getVariable(constant.ropeHeight)
  if (instance.status !== constant.swing) return
  const i = instance
  const initialAngle = engine.getVariable(constant.initialAngle)
  i.angle = initialAngle *
    getSwingBlockVelocity(engine, time)
  voiceSwingCreak(i, engine)
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

/* One bloop for the tower, not one per bead.
 *
 * Every landed layer sheds cream on its own timer, and a tall tower has a dozen
 * layers on screen — voicing each bead would be a rattle, and the shared audio
 * element could not keep up with it anyway. So the drip is rationed globally: at
 * most one every DRIP_SOUND_GAP seconds, whichever layer happened to produce the
 * bead that got through. What the player hears is an occasional drop from a
 * dripping tower, which is the impression the visual gives too.
 *
 * The gate lives on the engine's variable store rather than in a module-level
 * counter so that a fresh run starts silent-clean, and it is keyed to the
 * animation clock already passed in, not to wall time.
 */
const dripSoundGap = 0.9

const playDrip = (engine, time) => {
  const last = engine.getVariable(constant.dripSoundTime) || 0
  // First bead of a run: start the clock, stay quiet. Also covers the clock
  // going backwards, which a restart does.
  if (!last || time < last) {
    engine.setVariable(constant.dripSoundTime, time)
    return
  }
  if ((time - last) / 1000 < dripSoundGap) return
  engine.setVariable(constant.dripSoundTime, time)
  playSfx(engine, 'drip')
}

const applyLand = (engine, block, line, opts) => {
  const { blockY, keptLeft, keptWidth, isPerfect } = opts
  const i = block
  // How much of the layer survived, measured BEFORE updateWidth() below
  // overwrites i.width with the kept width and makes the ratio always 1.
  const keepRatio = i.width > 0 ? Math.min(1, keptWidth / i.width) : 1
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
  // Pin the texture source at the land-time left edge. The block drifts with
  // the sway afterwards; if the source is derived from the LIVE x, the wood
  // grain slides faster than the block and it looks like only the "window" of
  // the block shakes. Pinning keeps grain glued to the block so the whole
  // tower rocks as one rigid unit.
  i.srcPinned = keptLeft
  i.updateWidth(finalWidth)
  // Close the seam with the layer below. dy and dh are rounded independently in
  // drawBlock, so a block's rounded bottom edge doesn't always meet the rounded
  // top of the block beneath it — that mismatch shows as a 1px transparent gap
  // between floors. Drawing 1px taller makes consecutive layers always overlap
  // instead. The base block has nothing under it, so it is left alone.
  i.seamExtend = lastSuccessCount === 0 ? 0 : 1
  line.y = blockY
  line.x = keptLeft
  line.collisionX = keptLeft + finalWidth
  engine.setVariable(constant.currentWidth, finalWidth)
  // Record how tall this layer actually was. The next block on the rope is
  // squeezed to match finalWidth, and the world scrolls by the height that
  // really landed — otherwise squeezed layers would scroll further than the
  // tower grew and the stack would sink.
  engine.setVariable(constant.currentHeight, i.height)
  // cheat detection: measured against the original block width
  const cheatWidth = engine.getVariable(constant.blockWidth) * 0.3
  if (i.x > (pl(engine) + pw(engine)) - (cheatWidth * 2) || i.x < pl(engine) - cheatWidth) {
    engine.setVariable(constant.hardMode, true)
  }
  /* Two sounds for one landing, and they are doing different jobs. `land` is the
   * physical event — cake meeting cake, all low end and a wet slap of cream —
   * and it fires for every landing there is. drop / drop-perfect are the SCORING
   * chime on top of it, and they are the pair that tell perfect apart from
   * merely good.
   *
   * The thud goes first so its attack is the leading edge of the hit; the chime
   * has no low end of its own, so the two layer rather than mask each other.
   * playSfx, not playAudio: two landings inside a quarter of a second is normal
   * once the hook is fast, and play() on an element already playing is silent. */
  playSfx(engine, 'land')
  if (isPerfect) {
    i.perfect = true
    addScore(engine, true)
    engine.playAudio('drop-perfect')
  } else {
    addScore(engine)
    engine.playAudio('drop')
  }
  // The customer's verdict on the layer. Applied after addScore so the tip or
  // the docking lands on top of the landing's own points.
  addSatisfaction(engine, getSatisfactionDelta(keepRatio))
  // Mango cream squishes out along the seam where the cake layer slammed down.
  // A perfect landing squeezes out a bigger, wider splash.
  spawnCream(engine, {
    x: i.x + (finalWidth / 2),
    y: blockY + i.height,
    count: isPerfect ? 22 : 14,
    spread: finalWidth * 0.9,
    power: isPerfect ? 280 : 210,
    sizeBase: i.height * 0.20,  // much smaller sprinkle size
    dir: 0
  })
  // Set up continuous slow drip from the landed block's seam.
  i.dripTimer = 0
  i.dripInterval = 0.35 + (Math.random() * 0.25)  // 0.35-0.6s per drip
  i.dripsLeft = -1  // -1 means unlimited drips until the block scrolls off
}

// The block lands on the tower edge but can't balance — so it topples over
// that edge like a real object would. It hinges on the tower's corner and
// swings outward in an arc (rotation speed scales with how far off-center it
// is), then once it tips past ~74° it breaks off the corner and plummets
// outward-down. Mirrors the reference edition's rotate-left/right fall.
const tipBlockAction = (instance, engine, time) => {
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
    i.dripTimer = 0
    i.dripsLeft = -1  // unlimited drips while the block tips and falls
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
    i.x += engine.pixelsPerFrame(pw(engine) * 0.3) * leftFix
  }
  // Cream sheds off the doomed block the whole way — while it hinges on the
  // corner and while it plummets — so a missed layer trails mango all the way
  // down instead of falling dry.
  if (time) {
    if (!i.lastDripTime) i.lastDripTime = time
    i.dripTimer = (i.dripTimer || 0) + ((time - i.lastDripTime) / 1000)
    i.lastDripTime = time
    if (i.dripTimer > 0.12) {
      i.dripTimer = 0
      spawnCream(engine, {
        x: i.x + (i.width * 0.5),
        y: i.y + (i.height * 0.7),
        count: 2,
        spread: i.width * 0.7,
        power: 80,
        sizeBase: i.height * 0.16,
        dir: leftFix
      })
    }
  }
  if (i.y > engine.height + i.height || i.x < -i.width || i.x > engine.width + i.width) {
    addFailedCount(engine)
    instance.visible = false
    engine.removeInstance(instance.name)
  }
}

export const blockAction = (instance, engine, time) => {
  const i = instance
  // Frozen scene: every block holds its position, including one mid-fall.
  if (isGameOver(engine)) return
  const ropeHeight = engine.getVariable(constant.ropeHeight)
  if (!i.visible) {
    return
  }
  if (!i.ready) {
    i.ready = true
    i.status = constant.swing
    const w = engine.getVariable(constant.currentWidth, engine.getVariable(constant.blockWidth))
    instance.updateWidth(w)
    // Squeeze the height along with the width so a clipped tower's next slab
    // stays cake-shaped on the rope instead of a long thin plank.
    instance.updateHeight(getBlockHeightForWidth(engine, w))
    instance.x = px(engine, 0.5)
    instance.y = ropeHeight * constant.ropeTopFactor
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
    case constant.beforeDrop: {
      // Centre of the box drawSwingBlock rendered the cake into, at full size,
      // so the block starts falling from exactly where it appeared to hang and
      // just grows out of its SWING_SCALE shrink.
      const cake = swingCakeBox(instance)
      i.x = cake.x
      i.y = cake.y
      i.rotate = 0
      i.ay = engine.pixelsPerFrame(0.0003 * engine.height) // acceleration of gravity
      i.startDropTime = time
      i.status = constant.drop
      /* The air on the way down. Voiced here, on the one frame the release
       * happens, rather than anywhere in the drop case below — that runs every
       * frame of the fall and would restart the clip forty times over.
       *
       * The clip is deliberately longer than a short fall: it swells in and
       * ducks at the end, so a block that lands early is cut off during the
       * quiet part and one that falls the full height gets the whole sweep. */
      playSfx(engine, 'fall')
      break
    }
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
      const blockWidth = instance.width
      // Remember the original block bounds for texture-source cutting: the kept
      // piece and the fragments must each show the slice of the SAME texture,
      // aligned so the break looks continuous (like real Stack cutting).
      i.srcLeft = blockLeft
      i.srcWidth = blockWidth
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
        // partial overlap → clip & stack (only the truly-overhanging part breaks off)
        const leftCut = overlapLeft - blockLeft
        const rightCut = blockRight - overlapRight
        // Forgiving near-miss: a tiny overhang (< ~4% width or a few px) counts as
        // a clean full-width stack — no visible clipping.
        const grace = Math.max(4, instance.width * 0.04)
        // The very first block is never clipped — it always lands whole so the
        // tower starts life at full width no matter where the player drops it.
        const isFirstBlock = engine.getVariable(constant.successCount, 0) === 0
        if (isFirstBlock || (leftCut <= grace && rightCut <= grace)) {
          i.status = constant.land
          instance.y = blockY
          applyLand(engine, instance, line, {
            blockY,
            keptLeft: blockLeft,
            keptWidth: i.width,
            isPerfect: false
          })
        } else {
          i.status = constant.land
          instance.y = blockY
          applyLand(engine, instance, line, {
            blockY,
            keptLeft: overlapLeft,
            keptWidth: overlapWidth,
            isPerfect: false
          })
          // One jagged cut shared by the kept piece and its fragment so the break
          // looks like a real split. The cut side is the side that overhangs; the
          // jag depth scales with the real cut width so it never extends past it.
          const cutSide = leftCut > rightCut ? 'left' : 'right'
          const cutDepth = Math.max(leftCut, rightCut)
          i.cutJag = makeJag(blockLeft + blockRight, cutDepth)
          i.cutSide = cutSide
          /* The shear itself. Only this branch reaches it — a landing inside the
           * grace window keeps its full width and nothing is cut, so it stays on
           * the landing thud alone. Played after applyLand so it layers over that
           * thud rather than in place of it: one sound for the layer arriving,
           * one for the overhang coming off. */
          playSfx(engine, 'clip')
          if (leftCut > 1) {
            spawnFragment(engine, i, { left: blockLeft, width: leftCut, y: blockY, fallDir: -1, cutSide: 'right', cutJag: i.cutJag })
            // Cream bursts sideways out of the fresh break.
            spawnCream(engine, {
              x: overlapLeft,
              y: blockY + (instance.height * 0.5),
              count: 12,
              spread: instance.height * 0.5,
              power: 230,
              sizeBase: instance.height * 0.18,
              dir: -1
            })
            i.dripsLeft = -1  // unlimited drips until the block scrolls off
          }
          if (rightCut > 1) {
            spawnFragment(engine, i, { left: overlapRight, width: rightCut, y: blockY, fallDir: 1, cutSide: 'left', cutJag: i.cutJag })
            spawnCream(engine, {
              x: overlapRight,
              y: blockY + (instance.height * 0.5),
              count: 12,
              spread: instance.height * 0.5,
              power: 230,
              sizeBase: instance.height * 0.18,
              dir: 1
            })
            i.dripsLeft = -1  // unlimited drips until the block scrolls off
          }
        }
      }
      break
    case constant.tip:
      tipBlockAction(instance, engine, time)
      break
    case constant.land:
      // From the 2nd landing, landed blocks scroll down at the same rate
      // as the line and background (s/2), keeping the stack in place together.
      if (engine.getVariable(constant.successCount, 0) >= 2) {
        engine.getTimeMovement(
          constant.moveDownMovement,
          [[instance.y, instance.y + (getMoveDownValue(engine, { pixelsPerFrame: s => s / 2 }))]],
          (value) => {
            if (!instance.visible) return
            instance.y = value
            if (instance.y > engine.height) {
              instance.visible = false
              engine.removeInstance(instance.name)
            }
          },
          {
            name: instance.name
          }
        )
      }
      // Keep the sway: landed blocks drift horizontally together with the line,
      // so the tower rocks as one unit. The texture source is pinned at land
      // time (see land), so this drift doesn't reveal the cut edges.
      instance.x += getLandBlockVelocity(engine, time)
      // Cream keeps oozing out of the seam and dripping off, one bead at a
      // time, for as long as the layer is on screen. dripsLeft === -1 means
      // unlimited; a positive count decrements and eventually stops.
      if (instance.dripsLeft !== 0 && instance.dripsLeft !== undefined) {
        if (!instance.lastDripTime) instance.lastDripTime = time
        const dripDt = (time - instance.lastDripTime) / 1000
        instance.dripTimer = (instance.dripTimer || 0) + dripDt
        instance.lastDripTime = time
        if (instance.dripTimer >= instance.dripInterval) {
          instance.dripTimer = 0
          // Vary the gap so the beads never fall on a metronome.
          instance.dripInterval = 0.45 + (Math.random() * 0.9)
          if (instance.dripsLeft > 0) instance.dripsLeft -= 1
          // Hang from an edge of THIS block, following it as it sways. A clipped
          // block drips from its cut edge; a clean layer alternates edges so
          // every floor keeps shedding cream.
          const side = instance.cutSide
            || (Math.random() < 0.5 ? 'left' : 'right')
          const edge = side === 'left'
            ? instance.x
            : instance.x + instance.width
          spawnCream(engine, {
            x: edge,
            y: instance.y + instance.height,
            count: 1,
            spread: instance.width * 0.10,
            power: 0,
            sizeBase: instance.height * 0.17,
            drip: true,
            host: instance.name,
            hostSide: side
          })
          playDrip(engine, time)
        }
      }
      break
    default:
      break
  }
}

const drawSwingBlock = (instance, engine) => {
  const bl = engine.getImg('blockRope')
  if (!bl || !bl.width) return
  // Solve for the box that puts the texture's CAKE BODY exactly on the cake box,
  // then draw the full texture into it. The sling above the cake spills out the
  // top of that box, which is what we want — it reaches up toward the hook.
  const cake = scaledSwingCakeBox(instance)
  const scaleX = cake.w / ((ROPE_CAKE.right - ROPE_CAKE.left) * bl.width)
  const scaleY = cake.h / ((ROPE_CAKE.bottom - ROPE_CAKE.top) * bl.height)
  const fullW = bl.width * scaleX
  const fullH = bl.height * scaleY
  engine.ctx.drawImage(
    bl,
    cake.x - (ROPE_CAKE.left * bl.width * scaleX),
    cake.y - (ROPE_CAKE.top * bl.height * scaleY),
    fullW, fullH
  )
  engine.debugLineY(cake.x)
}

const drawBlock = (instance, engine) => {
  const { perfect } = instance
  const imgName = perfect ? 'block-perfect' : 'block'
  const bl = engine.getImg(imgName)
  const { ctx } = engine
  // Skip the texture's transparent top/bottom padding so stacked layers meet
  // with no empty band between them.
  const { sy, sh } = texSrcY(imgName, bl)
  // Integer-align the destination box. During the sway the block's x is a
  // fractional cosine drift; fractional dest coords make drawImage leave 1px
  // transparent "windows" at the left/right edges of clipped blocks.
  const dx = Math.round(instance.x)
  const dw = Math.round(instance.width)
  const dy = Math.round(instance.y)
  // Stretch 1px past the bottom so this layer always overlaps the one below and
  // no transparent seam can show between floors (see seamExtend in applyLand).
  const dh = Math.round(instance.height) + (instance.seamExtend || 0)
  ctx.save()
  // When this block was clipped, cut its visible region along the shared jagged
  // edge so the kept piece shows a craggy break instead of a straight slice.
  if (instance.cutJag && instance.cutSide) {
    clipCut(engine, instance, instance.cutSide)
  }
  // Source-rect the texture so the kept piece shows the aligned slice of the
  // original block (wood grain lines up) instead of a squished full texture.
  if (instance.srcLeft !== undefined && instance.srcWidth) {
    // Use the PINNED land-time left edge, not the live drifting dx, so the
    // grain stays glued to the block as the tower sways.
    const refX = instance.srcPinned !== undefined ? instance.srcPinned : dx
    let srcX = (refX - instance.srcLeft) / instance.srcWidth * bl.width
    let srcW = dw / instance.srcWidth * bl.width
    // Clamp the source slice to the texture so rounding never samples outside.
    srcX = Math.max(0, Math.min(srcX, bl.width - 1))
    srcW = Math.max(1, Math.min(srcW, bl.width - srcX))
    ctx.drawImage(
      bl,
      srcX, sy, srcW, sh,
      dx, dy, dw, dh
    )
  } else {
    ctx.drawImage(bl, 0, sy, bl.width, sh, dx, dy, dw, dh)
  }
  // Dark outline along the jagged cut edge so the crack is visible.
  if (instance.cutJag && instance.cutSide) {
    strokeJagEdge(engine, instance, instance.cutSide)
  }
  ctx.restore()
}

const drawTipBlock = (instance, engine) => {
  // Rotate about the block's top-left corner (instance.x/y) — the pivot the
  // topple arc is built around in tipBlockAction. Mirrors the reference.
  const bl = engine.getImg('block')
  const { ctx } = engine
  const { sy, sh } = texSrcY('block', bl)
  ctx.save()
  ctx.translate(instance.x, instance.y)
  ctx.rotate(instance.rotate)
  ctx.translate(-instance.x, -instance.y)
  ctx.drawImage(
    bl,
    0, sy, bl.width, sh,
    instance.x, instance.y, instance.width, instance.height
  )
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
  const i = instance
  const line = engine.getInstance('line')
  const isRight = i.fallDir === 1
  if (!i.tipRig) {
    i.tipRig = true
    i.rotate = 0
    i.lastTime = time
    return
  }
  if (!i.lastTime) i.lastTime = time
  const dt = (time - i.lastTime) / 1000
  i.lastTime = time
  const leftFix = isRight ? 1 : -1
  if (!i.broke) {
    // Wobble: swing the clipped piece outward on the tower corner, slowly enough
    // to see. rotateSpeed is deliberately gentle (not the full-pivot speed) so a
    // overhang, whose inner edge sits right at the corner, tips visibly.
    const rotateSpeed = engine.pixelsPerFrame(Math.PI * 1.2)
    i.rotate += rotateSpeed * leftFix
    const shouldFall = isRight ? i.rotate > 1.3 : i.rotate < -1.3 // ~74°
    if (shouldFall) i.broke = true
  }
  if (i.broke) {
    // Broken off the corner — fall with gravity, keep tumbling, drift outward.
    if (!i.vy) i.vy = 0
    i.vy += 620 * dt
    i.y += i.vy * dt
    i.x += 40 * leftFix * dt
    i.rotate += (Math.PI * 0.4) * leftFix * dt
    // Cream keeps shedding off the tumbling chunk on the way down.
    i.dripTimer = (i.dripTimer || 0) + dt
    if (i.dripTimer > 0.14) {
      i.dripTimer = 0
      spawnCream(engine, {
        x: i.x + (i.width * 0.5),
        y: i.y + (i.height * 0.6),
        count: 1,
        spread: i.width * 0.8,
        power: 70,
        sizeBase: i.height * 0.16,
        dir: leftFix
      })
    }
  }
  // Remove once clearly off-screen.
  if (i.y > engine.height + i.height
    || i.x < -i.width * 2 || i.x > engine.width + i.width * 2) {
    engine.removeInstance(i.name)
  }
}

const fragmentPainter = (instance, engine) => {
  const { ctx } = engine
  const img = engine.getImg('block')
  const w = instance.width
  const h = instance.height
  // Source-rect the fragment from the SAME texture the kept piece came from, so
  // the broken-off slice keeps its aligned wood grain and looks continuous.
  const srcX = (instance.x - instance.srcLeft) / instance.srcWidth * img.width
  const srcW = w / instance.srcWidth * img.width
  // Same padding trim as the kept block, so the two halves of the break match.
  const { sy, sh } = texSrcY('block', img)
  ctx.save()
  // Rotate about the piece's top-left corner (its x/y), matching drawTipBlock —
  // the fall math in fragmentAction is built around this pivot.
  ctx.translate(instance.x, instance.y)
  ctx.rotate(instance.rotate)
  ctx.translate(-instance.x, -instance.y)
  // Apply the SHARED jagged clip on the cut edge (the edge touching the tower).
  if (instance.cutJag && instance.cutSide) {
    ctx.beginPath()
    if (instance.cutSide === 'left') {
      ctx.moveTo(instance.x + instance.cutJag[0], instance.y)
      for (let i = 1; i <= instance.cutJag.length - 1; i += 1) {
        ctx.lineTo(instance.x + instance.cutJag[i], instance.y + h * (i / (instance.cutJag.length - 1)))
      }
      ctx.lineTo(instance.x + w, instance.y + h)
      ctx.lineTo(instance.x + w, instance.y)
    } else {
      // cutSide 'right': the cut edge is the fragment's RIGHT side, jag digs
      // INWARD (leftwards) into the fragment face.
      ctx.moveTo(instance.x, instance.y)
      ctx.lineTo(instance.x, instance.y + h)
      for (let i = instance.cutJag.length - 1; i >= 0; i -= 1) {
        ctx.lineTo(instance.x + w - instance.cutJag[i], instance.y + h * (i / (instance.cutJag.length - 1)))
      }
    }
    ctx.closePath()
    ctx.clip()
  }
  ctx.drawImage(
    img,
    srcX, sy, srcW, sh,
    instance.x, instance.y, w, h
  )
  // No zig-zag stroke on the falling piece — the crack outline is only drawn
  // on the kept block (drawBlock), so the falling chunk stays clean.
  ctx.restore()
}

const creamAction = (instance, engine, time) => {
  const i = instance
  if (!i.lastTime) i.lastTime = time
  const dt = Math.min((time - i.lastTime) / 1000, 0.05)
  i.lastTime = time
  i.life += dt
  // A drip clings to the block for a beat, swelling in place, before it
  // finally lets go and slides down slowly.
  if (i.hang > 0) {
    i.hang -= dt
    i.rotate += i.spin * 0.15 * dt
    // Stay glued to the cut edge of the block it hangs from, so it rides the
    // tower's sway instead of drifting off the block.
    if (i.hostName) {
      const host = engine.getInstance(i.hostName)
      if (host && host.visible !== false) {
        i.x = (i.hostSide === 'left' ? host.x : host.x + host.width) + i.hostOffsetX
        i.y = host.y + host.height
      }
    }
    // Swell slightly while hanging, like a bead of cream gathering.
    i.size = i.baseSize * (0.6 + (0.4 * (1 - (i.hang / i.hangTotal))))
    return
  }
  i.vy += i.gravity * dt
  i.x += i.vx * dt
  i.y += i.vy * dt
  i.rotate += i.spin * dt
  // Fade out over the last third of the particle's life.
  i.alpha = i.life > i.maxLife * 0.66
    ? Math.max(0, 1 - ((i.life - i.maxLife * 0.66) / (i.maxLife * 0.34)))
    : 1
  if (i.life >= i.maxLife || i.y > engine.height + i.size) {
    engine.removeInstance(i.name)
  }
}

const creamPainter = (instance, engine) => {
  const { ctx } = engine
  const img = engine.getImg(instance.imgName)
  if (!img || !img.width) return
  const s = instance.size
  ctx.save()
  ctx.globalAlpha = instance.alpha
  ctx.translate(instance.x, instance.y)
  ctx.rotate(instance.rotate)
  // Sprinkles squash slightly along their travel direction so they feel wet.
  ctx.scale(1, instance.squash)
  ctx.drawImage(img, -s / 2, -s / 2, s, s)
  ctx.restore()
}

// Splatter mango cream from a point — used on land (splash along the seam),
// on clip (burst out of the break) and as slow drips off a cut edge.
// `drip: true` makes the particle cling in place first, then ooze down slowly
// instead of being flung.
const spawnCream = (engine, {
  x, y, count, spread, power, sizeBase, dir, drip, host, hostSide
}) => {
  for (let n = 0; n < count; n += 1) {
    const p = new Instance({
      name: `cream_${creamSeq++}`,
      action: creamAction,
      painter: creamPainter
    })
    const r1 = Math.random()
    const r2 = Math.random()
    const r3 = Math.random()
    const r4 = Math.random()
    p.x = x + (r1 - 0.5) * spread
    p.y = y + (r2 - 0.5) * (spread * 0.25)
    if (drip) {
      // Hangs off the cut edge, then slides down slowly under light gravity.
      p.vx = (r4 - 0.5) * 12
      p.vy = 0
      p.gravity = 150
      p.hangTotal = 0.25 + (r3 * 0.45)
      p.hang = p.hangTotal
      p.spin = (r3 - 0.5) * 1.2
      p.maxLife = 3.2 + (r2 * 1.4)
      // Remember which block edge this bead hangs from so it rides the sway.
      p.hostName = host
      p.hostSide = hostSide
      p.hostOffsetX = p.x - x
    } else {
      // Fling upward and outward, then gravity pulls it back down. The sideways
      // kick leans the way the particle already sits, so the burst fans out.
      p.vx = ((r4 - 0.5) * 1.6 * power) + ((r1 - 0.5) * power * 0.7)
        + ((dir || 0) * power * 0.6)
      p.vy = -power * (0.45 + r3 * 0.75)
      p.gravity = 1400
      p.hang = 0
      p.spin = (r3 - 0.5) * 10
      p.maxLife = 0.85 + r3 * 0.5
    }
    p.size = sizeBase * (0.55 + r2 * 0.75)
    p.baseSize = p.size
    p.rotate = r1 * Math.PI * 2
    // Pick one of the four cream sprinkle sprites, weighted so the small
    // sprinkle/dot shapes dominate and the fatter blob/teardrop show up as
    // occasional bigger gobs.
    const pick = Math.random()
    let variant = 3        // capsule sprinkle
    if (pick < 0.18) variant = 1       // fat blob
    else if (pick < 0.40) variant = 2  // teardrop
    else if (pick > 0.75) variant = 4  // small dot
    p.imgName = `cream${variant}`
    p.squash = 0.82 + (r2 * 0.3)
    p.alpha = 1
    p.life = 0
    p.width = p.size
    p.height = p.size
    p.calWidth = p.size / 2
    p.calHeight = p.size / 2
    engine.addInstance(p)
  }
}

const spawnFragment = (engine, block, { left, width, height, fallDir, cutSide, cutJag }) => {
  const frag = new Instance({
    name: `clip_${fragmentSeq++}`,
    action: fragmentAction,
    painter: fragmentPainter
  })
  frag.x = left
  frag.y = block.y
  frag.width = width
  frag.height = block.height || height
  frag.calWidth = width / 2
  frag.calHeight = (block.height || height) / 2
  frag.rotate = 0
  frag.fallDir = fallDir
  // Carry the source-bounds AND the shared jagged cut edge so the two broken
  // halves visually match.
  frag.srcLeft = block.srcLeft
  frag.srcWidth = block.srcWidth
  frag.cutSide = cutSide
  frag.cutJag = cutJag
  engine.addInstance(frag)
}

