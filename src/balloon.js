import { Instance } from 'cooljs'
import { pl, pw, isGameOver } from './utils'
import * as constant from './constant'

// The mango hot-air balloon. It drifts in from one side, parks beside the tower
// top and bobs there watching the player stack, then wanders off across the
// screen and comes back somewhere else. Pure decoration — it sits on its own
// layer, painted after the tower, so it flies in FRONT of the blocks.

// Exponential ease toward a target that stays stable across frame rates.
const ease = (current, target, rate, dt) =>
  current + ((target - current) * (1 - Math.exp(-rate * dt)))

// Where the balloon hovers: just above the tower top, tucked against one side.
// The line instance's live y is the real tower top — it scrolls down as floors
// land — so read that rather than the static initial offset.
const towerTopY = (engine) => {
  const line = engine.getInstance('line')
  return (line && line.ready)
    ? line.y
    : engine.getVariable(constant.lineInitialOffset)
}

// Parking is column-relative: the balloon watches the TOWER, so it tucks
// against the edge of the stacking column rather than the edge of the screen.
// On a laptop that keeps it beside the action instead of stranded in a corner.
// Drifting, by contrast, uses the whole canvas — see drift/enter.
const parkSpot = (i, engine) => {
  const margin = pw(engine) * 0.04
  const left = pl(engine)
  const right = left + pw(engine)
  return {
    x: i.dir === 1 ? right - i.w - margin : left + margin,
    // Offset by the sprite's own height so the basket sits above the tower top
    // rather than at a fixed screen fraction.
    y: towerTopY(engine) - (i.h * 0.9)
  }
}

// Drift in from off-screen toward the parking spot.
const enter = (i, engine, dt) => {
  i.x += engine.width * 0.26 * i.dir * dt
  i.y = ease(i.y, i.parkY, 1.5, dt)
  const arrived = i.dir === 1 ? i.x >= i.parkX : i.x <= i.parkX
  if (arrived) {
    i.x = i.parkX
    setPhase(i, engine, 'park')
  }
}

// Hover beside the tower, bobbing. Keeps re-reading the tower top so it stays
// with the action if the line moves.
const park = (i, engine, dt) => {
  const spot = parkSpot(i, engine)
  i.y = ease(i.y, spot.y, 1.2, dt)
  i.y += Math.sin(i.elapsed * 2) * 34 * dt
  i.x = ease(i.x, spot.x, 0.8, dt)
  if (i.elapsed > i.phaseUntil) setPhase(i, engine, 'drift')
}

// Wander lazily across the screen, bobbing as it goes.
const drift = (i, engine, dt) => {
  i.x += engine.width * 0.13 * i.dir * dt
  i.y += Math.sin(i.elapsed * 1.2) * 42 * dt
  if (i.x < -i.w * 1.4 || i.x > engine.width + (i.w * 1.4)) {
    setPhase(i, engine, 'out')
  }
}

// Off-screen: wait a beat, then come back from a fresh side.
const out = (i, engine, dt) => {
  i.timer += dt
  if (i.timer > i.waitFor) setPhase(i, engine, 'enter')
}

const PHASES = { enter, park, drift, out }

function setPhase(i, engine, name) {
  i.phase = name
  i.phaseTick = PHASES[name]
  if (name === 'enter') {
    i.dir = Math.random() < 0.5 ? 1 : -1
    const spot = parkSpot(i, engine)
    i.parkX = spot.x
    i.parkY = spot.y
    // Start just off the edge on the side it is travelling from.
    i.x = i.dir === 1 ? -i.w : engine.width
    i.y = spot.y + ((Math.random() - 0.5) * engine.height * 0.12)
  } else if (name === 'park') {
    i.phaseUntil = i.elapsed + 5 + (Math.random() * 5)
  } else if (name === 'drift') {
    // Cross the screen rather than slipping out the near edge: head away from
    // whichever side it parked on.
    i.dir = i.x < engine.width / 2 ? 1 : -1
  } else if (name === 'out') {
    i.timer = 0
    // Roll the wait once, not every frame.
    i.waitFor = 4 + (Math.random() * 3)
  }
}

const balloonAction = (instance, engine, time) => {
  const i = instance
  const img = engine.getImg('balloon')
  // Images load asynchronously; wait until the texture has real dimensions
  // before sizing and placing the balloon.
  if (!img || !img.width) return
  // Gameplay only — the balloon stays off the menu screen entirely.
  if (!engine.getVariable(constant.gameStartNow, false)) {
    i.ready = false
    return
  }
  // Frozen scene: it hangs in the sky exactly where the run ended. Note this
  // returns AFTER the ready check, so it keeps its position rather than
  // re-entering from off-screen.
  if (isGameOver(engine)) return
  if (!i.ready) {
    i.ready = true
    i.w = pw(engine) * 0.17
    i.h = i.w * (img.height / img.width)
    i.elapsed = 0
    i.timer = 0
    i.lastTime = time
    setPhase(i, engine, 'enter')
    return
  }
  // time is milliseconds. Clamp dt so a backgrounded tab does not teleport it.
  const dt = Math.min((time - i.lastTime) / 1000, 0.05)
  i.lastTime = time
  i.elapsed += dt
  i.phaseTick(i, engine, dt)
}

const balloonPainter = (instance, engine) => {
  const { ctx } = engine
  const img = engine.getImg('balloon')
  if (!img || !img.width || !instance.ready) return
  // Painter runs independently of action, so gate it too — otherwise the last
  // gameplay frame lingers on the menu screen.
  if (!engine.getVariable(constant.gameStartNow, false)) return
  ctx.drawImage(img, instance.x, instance.y, instance.w, instance.h)
}

export const addBalloon = (game) => {
  const balloon = new Instance({
    name: 'balloon',
    action: balloonAction,
    painter: balloonPainter
  })
  game.addInstance(balloon, constant.balloonLayer)
}
