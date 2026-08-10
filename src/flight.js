import { Instance } from 'cooljs'
import { isGameOver, playSfx } from './utils'
import * as constant from './constant'

const getActionConfig = (engine, type) => {
  const {
    width, height, utils
  } = engine
  const { random } = utils
  const size = engine.getVariable(constant.cloudSize)
  const actionTypes = {
    bottomToTop: {
      x: width * random(0.3, 0.7),
      y: height,
      vx: 0,
      vy: engine.pixelsPerFrame(height) * 0.7 * -1
    },
    leftToRight: {
      x: size * -1,
      y: height * random(0.3, 0.6),
      vx: engine.pixelsPerFrame(width) * 0.4,
      vy: engine.pixelsPerFrame(height) * 0.1 * -1
    },
    rightToLeft: {
      x: width,
      y: height * random(0.2, 0.5),
      vx: engine.pixelsPerFrame(width) * 0.4 * -1,
      vy: engine.pixelsPerFrame(height) * 0.1
    },
    /* The comet. Slower than the others despite travelling further: it crosses
     * on a diagonal, so vx and vy compound, and at the old rate it was off the
     * far edge inside two seconds — a blink rather than a flypast. */
    rightTopToLeft: {
      x: width,
      y: 0,
      vx: engine.pixelsPerFrame(width) * 0.26 * -1,
      vy: engine.pixelsPerFrame(height) * 0.2
    }
  }
  return actionTypes[type]
}


export const flightAction = (instance, engine) => {
  const { visible, ready, type } = instance
  if (!visible) return
  // Frozen scene: the birds stop mid-flight.
  if (isGameOver(engine)) return
  const size = engine.getVariable(constant.cloudSize)
  if (!ready) {
    const action = getActionConfig(engine, type)
    instance.ready = true
    instance.width = size
    instance.height = size
    instance.x = action.x
    instance.y = action.y
    instance.vx = action.vx
    instance.vy = action.vy
  }
  instance.x += instance.vx
  instance.y += instance.vy
  if (instance.y + size < 0
    || instance.y > engine.height
    || instance.x + size < 0
    || instance.x > engine.width) {
    instance.visible = false
  }
}

export const flightPainter = (instance, engine) => {
  const { ctx } = engine
  const flight = engine.getImg(instance.imgName)
  ctx.drawImage(flight, instance.x, instance.y, instance.width, instance.height)
}

/* Takes the whole schedule entry. `id` only has to be unique and stable per
 * scheduled flypast — it names the instance and dedupes the add across the
 * frames where the schedule matches. The image is carried in the entry rather
 * than derived from the id, so the schedule can drop or reuse artwork without
 * the numbering having to line up with filenames.
 *
 * The sound plays here, once, at the moment the pass is created — the same
 * guard that stops a second instance being added stops a second play, and the
 * sprite starts off-screen, so the sound arrives just before the thing making
 * it does.
 */
export const addFlight = (engine, entry) => {
  const { id, type, img } = entry
  const flightCount = engine.getVariable(constant.flightCount)
  if (flightCount === id) return
  const flight = new Instance({
    name: `flight_${id}`,
    action: flightAction,
    painter: flightPainter
  })
  flight.imgName = img
  flight.type = type
  engine.addInstance(flight, constant.flightLayer)
  engine.setVariable(constant.flightCount, id)
  if (entry.sound) playSfx(engine, entry.sound)
}
