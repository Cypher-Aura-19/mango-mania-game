import { getHookStatus, pw, px } from './utils'
import * as constant from './constant'

export const tutorialAction = (instance, engine, time) => {
  const { height } = engine
  const { name } = instance
  if (!instance.ready) {
    instance.ready = true
    const tutorialWidth = pw(engine) * 0.2
    instance.updateWidth(tutorialWidth)
    instance.height = tutorialWidth * 0.46
    // Centred on the stacking column — the hand points at the block, which
    // hangs over the column, not over the middle of a wide canvas.
    instance.x = px(engine, 0.5) - instance.calWidth
    instance.y = height * 0.45
    if (name !== 'tutorial') {
      instance.y += instance.height * 1.2
    }
  }
  if (name !== 'tutorial') {
    instance.y += Math.cos(time / 200) * instance.height * 0.01
  }
}

export const tutorialPainter = (instance, engine) => {
  if (engine.checkTimeMovement(constant.tutorialMovement)) {
    return
  }
  if (getHookStatus(engine) !== constant.hookNormal) {
    return
  }
  const { ctx } = engine
  const { name } = instance
  const t = engine.getImg(name)
  ctx.drawImage(t, instance.x, instance.y, instance.width, instance.height)
}

