import * as constant from './constant'

/* The stacking column: the centred portrait box the tower is built in. On a
 * portrait screen it is the whole canvas; on a laptop the canvas is wider and
 * the column sits in the middle of it, so gameplay is identical on both and
 * only the scenery gets the extra width. See constant.playWidth.
 *
 * pw()/pl() are the two halves — width and left edge — and px(f) turns a
 * fraction of the column into a canvas x. Anything the player aims with should
 * be sized with pw() and placed with px(); anything that is scenery keeps using
 * engine.width. */
export const pw = engine => engine.getVariable(constant.playWidth) || engine.width
export const pl = engine => engine.getVariable(constant.playLeft) || 0
export const px = (engine, fraction) => pl(engine) + (pw(engine) * fraction)

export const checkMoveDown = engine =>
  (engine.checkTimeMovement(constant.moveDownMovement))

/* The run is over and the scene is frozen.
 *
 * Read by every action and by the backdrop scroll. The engine's own `paused`
 * flag stops the loop a frame later (see freezeGame), but the frame in which
 * the third life is lost is still mid-flight when this gets set, and without
 * these guards that frame would scroll the sky and tip the tower one last time
 * before stopping. */
export const isGameOver = engine => !!engine.getVariable(constant.gameOver)

/* Stop the animation loop, leaving the last painted frame on the canvas.
 *
 * cooljs bails out of animate() before clean() when `paused` is set, so nothing
 * repaints and nothing clears: the tower, the hanging block, the backdrop and
 * the HUD all stay exactly as they were. Called at the very END of the frame
 * (from endAnimate) so that frame is complete before the loop stops — freezing
 * any earlier would leave the HUD or the sprites missing from the final image.
 *
 * Never unpaused. Both buttons on the summary card restart with a page load. */
export const freezeGame = (engine) => {
  if (isGameOver(engine) && !engine.paused) engine.paused = true
}

// A block keeps its cake proportions: as clipping shaves the width down, the
// layer gets shorter too instead of stretching into a long thin slab. Applies
// to the hanging rope block as well, since it is built from the same width.
export const getBlockHeightForWidth = (engine, width) => {
  const fullWidth = engine.getVariable(constant.blockWidth)
  const fullHeight = engine.getVariable(constant.blockHeight)
  if (!fullWidth) return fullHeight
  const widthRatio = Math.max(constant.minHeightRatio, Math.min(1, width / fullWidth))
  // Shrink by only HALF of what the width lost. Matching the width 1:1 made
  // clipped layers collapse into slivers; this keeps the cake proportions
  // reading right while leaving the layer thick enough to see and land on.
  const ratio = 1 - ((1 - widthRatio) * constant.heightSqueezeFactor)
  return fullHeight * ratio
}

export const getMoveDownValue = (engine, store) => {
  const pixelsPerFrame = store ? store.pixelsPerFrame : engine.pixelsPerFrame.bind(engine)
  const successCount = engine.getVariable(constant.successCount)
  // Track the height the tower actually grew by (the layer that just landed),
  // so squeezed layers scroll proportionally less and the stack stays pinned.
  const landedHeight = engine.getVariable(
    constant.currentHeight,
    engine.getVariable(constant.blockHeight)
  )
  const calHeight = landedHeight * 2
  if (successCount <= 4) {
    return pixelsPerFrame(calHeight * 1.25)
  }
  return pixelsPerFrame(calHeight)
}

export const getAngleBase = (engine) => {
  const successCount = engine.getVariable(constant.successCount)
  const gameScore = engine.getVariable(constant.gameScore)
  const { hookAngle } = engine.getVariable(constant.gameUserOption)
  if (hookAngle) {
    return hookAngle(successCount, gameScore)
  }
  if (engine.getVariable(constant.hardMode)) {
    return 90
  }
  switch (true) {
    case successCount < 10:
      return 30
    case successCount < 20:
      return 60
    default:
      return 80
  }
}

export const getSwingBlockVelocity = (engine, time) => {
  const successCount = engine.getVariable(constant.successCount)
  const gameScore = engine.getVariable(constant.gameScore)
  const { hookSpeed, swingSpeedScale } = engine.getVariable(constant.gameUserOption)
  if (hookSpeed) {
    return hookSpeed(successCount, gameScore)
  }
  let hard
  switch (true) {
    case successCount < 1:
      hard = 0
      break
    case successCount < 10:
      hard = 1
      break
    case successCount < 20:
      hard = 0.8
      break
    case successCount < 30:
      hard = 0.7
      break
    default:
      hard = 0.74
      break
  }
  if (engine.getVariable(constant.hardMode)) {
    hard = 1.1
  }
  // Optional per-game slowdown (blink edition sets this) for easier aiming.
  if (swingSpeedScale) {
    hard *= swingSpeedScale
  }
  return Math.sin(time / (200 / hard))
}

export const getLandBlockVelocity = (engine, time) => {
  const successCount = engine.getVariable(constant.successCount)
  const gameScore = engine.getVariable(constant.gameScore)
  const { landBlockSpeed, swingSpeedScale } = engine.getVariable(constant.gameUserOption)
  if (landBlockSpeed) {
    return landBlockSpeed(successCount, gameScore)
  }
  const { width } = engine
  let hard
  switch (true) {
    case successCount < 5:
      hard = 0
      break
    case successCount < 13:
      hard = 0.001
      break
    case successCount < 23:
      hard = 0.002
      break
    default:
      hard = 0.003
      break
  }
  // Optional per-game slowdown (blink edition) to reduce the left-right drift.
  if (swingSpeedScale) {
    hard *= swingSpeedScale
  }
  return Math.cos(time / 200) * hard * width
}

export const getHookStatus = (engine) => {
  if (engine.checkTimeMovement(constant.hookDownMovement)) {
    return constant.hookDown
  }
  if (engine.checkTimeMovement(constant.hookUpMovement)) {
    return constant.hookUp
  }
  return constant.hookNormal
}

export const touchEventHandler = (engine) => {
  if (!engine.getVariable(constant.gameStartNow)) return
  if (isGameOver(engine)) return
  if (engine.debug && engine.paused) {
    return
  }
  if (getHookStatus(engine) !== constant.hookNormal) {
    return
  }
  engine.removeInstance('tutorial')
  engine.removeInstance('tutorial-arrow')
  const b = engine.getInstance(`block_${engine.getVariable(constant.blockCount)}`)
  if (b && b.status === constant.swing) {
    engine.setTimeMovement(constant.hookUpMovement, 500)
    b.status = constant.beforeDrop
  }
}

// How pleased the customer is with a landing, as a satisfaction change.
// `keepRatio` is how much of the layer survived the drop. Linear on each side
// of the good-keep line, with a small step at the line itself so a landing that
// is exactly good enough still counts for something.
export const getSatisfactionDelta = (keepRatio) => {
  const good = constant.satisfactionGoodKeep
  if (keepRatio >= good) {
    return 2 + (8 * ((keepRatio - good) / (1 - good)))
  }
  return -(2 + (18 * ((good - keepRatio) / good)))
}

/* Which reaction clip a landing calls for, read off HOW WELL THE LAYER LANDED.
 *
 * This used to be derived from the satisfaction delta, and that was the wrong
 * quantity: the delta is a curve with a narrow neutral band, so nearly every
 * landing cleared one threshold or the other and the customer flipped between
 * happy and angry on almost every floor. Watching — the resting state, the thing
 * that should be on screen MOST of the time — was hardly ever seen.
 *
 * So the verdict comes straight from the geometry now, with a wide middle:
 *
 *   happy    the layer landed clean — `satisfactionGoodKeep` (80%) or more of it
 *            survived. Perfect and near-perfect drops, nothing else.
 *   angry    a third or more of the layer was sheared off
 *            (`moodAngryKeep`). A total miss is angry too, but that path does
 *            not come through here — see addFailedCount.
 *   null     everything in between, which is most drops: the customer keeps
 *            watching and says nothing.
 *
 * This and setCustomerMood live here rather than in customer.js because
 * customer.js imports this file for the column helpers; putting them there
 * would close a require cycle to save nothing. */
export const moodForKeep = (keepRatio) => {
  if (keepRatio >= constant.satisfactionGoodKeep) return 'happy'
  if (keepRatio <= constant.moodAngryKeep) return 'angry'
  return null
}

/* Ask the customer for a reaction. Goes through engine variables rather than a
 * handle on the instance, so a landing that somehow beats the instance into
 * existence is a no-op instead of a crash — and so the request survives being
 * made from anywhere in the landing path. */
export const setCustomerMood = (engine, mood) => {
  if (!mood) return
  engine.setVariable(constant.customerMood, mood)
  engine.setVariable(constant.customerMoodAt, engine.getVariable(constant.gameTime, 0))
}

// Move the meter and pay out the swing. The customer tipping better for a tidy
// cake, and docking you for a mangled one, is the whole point of the mechanic.
export const addSatisfaction = (engine, delta) => {
  const { setGameScore, setGameSatisfaction } = engine.getVariable(constant.gameUserOption)
  const before = engine.getVariable(constant.satisfaction, constant.satisfactionStart)
  const after = Math.max(0, Math.min(100, before + delta))
  engine.setVariable(constant.satisfaction, after)
  /* No reaction is asked for here any more. The meter moves on EVERY landing,
   * by a curve with a narrow neutral band, so driving the clips from it meant a
   * reaction on nearly every floor. The verdict is the layer's geometry, not the
   * meter's swing — callers ask for it themselves with moodForKeep. */
  // Pay for the movement that actually happened, not the movement asked for.
  // Once the meter is pinned at 100 there is no more goodwill left to earn, so
  // a run of flawless drops stops printing free points.
  //
  // Upward movement only: the score is a record of what the player built, so a
  // clipped or dropped layer costs them the meter and the tower, never points
  // already banked. The meter still falls — it is the thing that carries the
  // customer's mood, and it gates the tip on later layers.
  const moved = after - before
  if (moved > 0) {
    const score = Math.max(0, engine.getVariable(constant.gameScore, 0)
      + Math.round(moved * constant.satisfactionScoreRate))
    engine.setVariable(constant.gameScore, score)
    if (setGameScore) setGameScore(score)
  }
  if (setGameSatisfaction) setGameSatisfaction(after)
}

/* Plays a short effect that may fire again before it has finished.
 *
 * engine.playAudio calls play() on one shared element per name, and play() on an
 * element that is already playing does nothing — so a second shear inside the
 * length of the first is silent. Rewinding first makes it audible again. The
 * seek is guarded: currentTime throws while the clip is still unreadable, which
 * is exactly when the sound does not matter anyway.
 */
export const playSfx = (engine, name) => {
  if (!engine.soundOn) return
  const audio = engine.getAudio(name)
  if (!audio) return
  try {
    if (audio.currentTime > 0) audio.currentTime = 0
  } catch (e) { /* not seekable yet */ }
  engine.playAudio(name)
}

export const addSuccessCount = (engine) => {
  const { setGameSuccess } = engine.getVariable(constant.gameUserOption)
  const lastSuccessCount = engine.getVariable(constant.successCount)
  const success = lastSuccessCount + 1
  engine.setVariable(constant.successCount, success)
  if (engine.getVariable(constant.hardMode)) {
    engine.setVariable(constant.ropeHeight, engine.height * engine.utils.random(0.35, 0.55))
  }
  if (setGameSuccess) setGameSuccess(success)
}

export const addFailedCount = (engine) => {
  const { setGameFailed } = engine.getVariable(constant.gameUserOption)
  const lastFailedCount = engine.getVariable(constant.failedCount)
  const failed = lastFailedCount + 1
  engine.setVariable(constant.failedCount, failed)
  engine.setVariable(constant.perfectCount, 0)
  // A layer on the floor is the worst thing the customer can watch happen.
  addSatisfaction(engine, -25)
  // A layer that never landed at all is the loudest angry there is.
  setCustomerMood(engine, 'angry')
  if (setGameFailed) setGameFailed(failed)
  if (failed >= 3) {
    engine.pauseAudio('bgm')
    engine.playAudio('game-over')
    /* Freeze, don't reset. This used to clear gameStartNow, which is the MENU
     * flag — so the backdrop flipped to the title art and the HUD vanished
     * while the tower carried on wobbling underneath. Marking the run over
     * instead keeps the scene exactly as the player left it and stops the
     * motion, which is what "game over" should look like. */
    engine.setVariable(constant.gameOver, true)
  }
}

export const addScore = (engine, isPerfect) => {
  const { setGameScore, successScore, perfectScore } = engine.getVariable(constant.gameUserOption)
  const lastPerfectCount = engine.getVariable(constant.perfectCount, 0)
  const lastGameScore = engine.getVariable(constant.gameScore)
  const perfect = isPerfect ? lastPerfectCount + 1 : 0
  const score = lastGameScore + (successScore || 25) + ((perfectScore || 25) * perfect)
  engine.setVariable(constant.gameScore, score)
  engine.setVariable(constant.perfectCount, perfect)
  if (setGameScore) setGameScore(score)
}

export const drawYellowString = (engine, option) => {
  const {
    string, size, x, y, textAlign, fontName = 'Audex', fontWeight = 'normal'
  } = option
  const { ctx } = engine
  const fontSize = size
  const lineSize = fontSize * 0.1
  ctx.save()
  ctx.beginPath()
  const gradient = ctx.createLinearGradient(0, 0, 0, y)
  gradient.addColorStop(0, '#FAD961')
  gradient.addColorStop(1, '#F76B1C')
  ctx.fillStyle = gradient
  ctx.lineWidth = lineSize
  ctx.strokeStyle = '#FFF'
  ctx.textAlign = textAlign || 'center'
  ctx.font = `${fontWeight} ${fontSize}px ${fontName}`
  ctx.strokeText(string, x, y)
  ctx.fillText(string, x, y)
  ctx.restore()
}

// Number painted into a HUD plaque's cream panel. The plaque PNG already
// carries its SCORE / FLOOR label; this only draws the live value, fitted to
// `box` so a five-figure score cannot run under the frame. The pale copy
// underneath is the same emboss the baked label uses.
export const drawBoardString = (engine, option) => {
  const {
    string, box, color = '#4A3012', fontName = 'Audex', fontWeight = 'bold'
  } = option
  const { ctx } = engine
  const text = String(string)
  ctx.save()
  // Measure once at a reference size and scale from it, rather than looping:
  // both the advance width and the ink height are linear in font size.
  const probe = 100
  ctx.font = `${fontWeight} ${probe}px ${fontName}`
  const m = ctx.measureText(text)
  const unitWidth = m.width / probe
  // Fit the INK, not the em box — digits have no descender, so sizing by the em
  // box would leave the number floating small in the middle of the panel.
  const ink = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent
  const unitHeight = (ink > 0 ? ink : probe * 0.72) / probe
  const size = Math.min(box.h / unitHeight, unitWidth > 0 ? box.w / unitWidth : box.h)
  ctx.font = `${fontWeight} ${size}px ${fontName}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  const fit = ctx.measureText(text)
  const asc = fit.actualBoundingBoxAscent
  const desc = fit.actualBoundingBoxDescent
  const x = box.x + (box.w / 2)
  const y = box.y + (box.h / 2) + (asc > 0 ? (asc - desc) / 2 : size * 0.36)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)'
  ctx.fillText(text, x, y + (size * 0.045))
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
  ctx.restore()
}

