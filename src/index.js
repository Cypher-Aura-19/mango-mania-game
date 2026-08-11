import { Engine, Instance } from 'cooljs'
import { touchEventHandler, playSfx } from './utils'
import { background } from './background'
import { lineAction, linePainter } from './line'
import { hookAction, hookPainter } from './hook'
import { tutorialAction, tutorialPainter } from './tutorial'
import { addCustomer } from './customer'
import * as constant from './constant'
import { startAnimate, endAnimate } from './animateFuncs'
import { prepareBlockTextures } from './block'

window.TowerGame = (option = {}) => {
  const {
    width,
    height,
    canvasId,
    soundOn
  } = option
  /* The engine's "high resolution" mode is a fixed 2x backing store. That is
   * four times as many pixels every frame, even on phones which are already
   * decoding video (and, in blink mode, running a camera model). Keep the crisp
   * 2x canvas on capable pointer devices and use a 1x backing store on touch or
   * memory/CPU constrained devices. Callers can still override either choice. */
  const nav = window.navigator || {}
  const coarsePointer = window.matchMedia
    ? window.matchMedia('(pointer: coarse)').matches
    : false
  // iPadOS may identify itself as Macintosh; touch capability separates it
  // from a real Mac. Kept on the shared option so media/effects can specialize.
  const appleMobile = /iPad|iPhone|iPod/.test(nav.userAgent || '')
    || ((nav.platform === 'MacIntel' || nav.platform === 'Macintosh')
      && nav.maxTouchPoints > 1)
  const constrained = option.performanceMode === undefined
    ? (coarsePointer || nav.maxTouchPoints > 0
      || (nav.hardwareConcurrency && nav.hardwareConcurrency <= 4)
      || (nav.deviceMemory && nav.deviceMemory <= 4))
    : !!option.performanceMode
  const highResolution = option.highResolution === undefined
    ? !constrained
    : !!option.highResolution
  // Store the resolved profile in the same options object all game systems use.
  option.performanceMode = constrained
  option.highResolution = highResolution
  option.appleMobile = appleMobile

  const game = new Engine({
    canvasId,
    highResolution,
    width,
    height,
    soundOn
  })
  /* iOS uses a 1x canvas, so decoding desktop-size textures only burns WebKit's
   * memory budget. These variants cover the largest possible iPad play column
   * while cutting the active texture set substantially. Android/desktop retain
   * their existing assets and visual path. */
  const appleTexture = new Set([
    'background.webp', 'game-bg-1.webp', 'game-bg-2.webp', 'game-bg-3.webp',
    'block.webp', 'block-rope.webp',
    'c4.webp', 'c5.webp', 'c6.webp', 'c7.webp', 'c8.webp',
    'f1.webp', 'f4.webp', 'f6.webp'
  ])
  const pathGenerator = (path) => {
    const resolved = appleMobile && appleTexture.has(path)
      ? path.replace(/\.webp$/, '-ios.webp')
      : path
    return `./assets/${resolved}?v=20260811-ios-static`
  }

  /* A stable 30fps is preferable to WebKit oscillating between 60 and long
   * stalls. Physics reads timestamps, so skipped paints do not change gravity,
   * landing height, or game speed. This also leaves regular main-thread slots
   * for touch/audio and (in blink mode) camera inference. */
  if (appleMobile) {
    option.renderFps = 30
    const engineAnimate = game.animate.bind(game)
    const minFrame = 1000 / option.renderFps
    let lastFrame = -Infinity
    game.animate = (time) => {
      if (time - lastFrame < minFrame - 1) {
        window.requestAnimationFrame(game.animate)
        return
      }
      lastFrame = time
      engineAnimate(time)
    }
  }

  game.addImg('background', pathGenerator('background.webp'))
  game.addImg('gamebg', pathGenerator('game-bg-1.webp'))
  game.addImg('gamebg2', pathGenerator('game-bg-2.webp'))
  game.addImg('gamebg3', pathGenerator('game-bg-3.webp'))
  /* A wide screen shows the canvas as a centre column with the page's own
   * backdrop filling the bands either side. The landscape cut of each layer is
   * what lets the two add up to one picture instead of three: the column paints
   * its slice of a window-wide fill and the page paints the rest. Registered
   * only when it will be used, so a phone never downloads them. */
  if (option.wideBackdrop) {
    game.addImg('backgroundWide', pathGenerator('laptop-background.webp'))
    game.addImg('gamebgWide', pathGenerator('laptop-game-bg-1.webp'))
    game.addImg('gamebg2Wide', pathGenerator('laptop-game-bg-2.webp'))
    game.addImg('gamebg3Wide', pathGenerator('laptop-game-bg-3.webp'))
  }
  game.addImg('hook', pathGenerator('hook.webp'))
  game.addImg('blockRope', pathGenerator('block-rope.webp'))
  game.addImg('block', pathGenerator('block.webp'))
  game.addImg('block-perfect', pathGenerator('block-perfect.webp'))
  /* Sky decor. c1..c3 were the plain white clouds and are no longer used, so
   * only the mango-space props are registered. They are painted straight into
   * the backdrop tiles now rather than drifting as sprites — see the decor
   * table in background.js. */
  for (let i = 4; i <= 8; i += 1) {
    game.addImg(`c${i}`, pathGenerator(`c${i}.webp`))
  }
  game.addLayer(constant.flightLayer)
  /* Only the flypast art the schedule actually asks for. f2/f3 were a pair of
   * red-and-cream hot-air balloons from the original artwork and are dropped.
   * f5 is a byte-for-byte copy of the f4 plane, so the second plane pass reuses
   * f4 rather than paying for the same 1.4MB download twice. Both files are
   * still in assets/. */
  const flightImgs = ['f1', 'f4', 'f6', 'f7']
  flightImgs.forEach((name) => {
    game.addImg(name, pathGenerator(`${name}.webp`))
  })
  game.swapLayer(0, 1)
  /* Layers now paint in the order [flight, default, customer]: birds behind the
   * tower, blocks next, the customer last. Added AFTER the swap on purpose —
   * swap indices 0 and 1 are the only two layers that exist at that point, and
   * appending afterwards is what puts the customer on top. */
  game.addLayer(constant.customerLayer)
  game.addImg('tutorial', pathGenerator('tutorial.webp'))
  game.addImg('tutorial-arrow', pathGenerator('tutorial-arrow.webp'))
  game.addImg('mango', pathGenerator('mango.webp'))
  // HUD plaques carry their own SCORE / FLOOR label; only the numbers are
  // drawn live. Regenerate with tools/make-hud-plaques.py.
  game.addImg('hudScore', pathGenerator('hud-score.webp'))
  game.addImg('hudFloor', pathGenerator('hud-floor.webp'))
  game.addImg('hudLives', pathGenerator('hud-lives.webp'))
  /* The satisfaction gauge's art — the wooden track, the juice column and the
   * six reaction faces — is gone with the gauge itself. The customer reacts on
   * video now (src/customer.js), so nothing here loads for the mechanic; the
   * three clips are <video> elements and never touch the engine's image loader.
   * The files are still in assets/, and tools/make-satisfaction-meter.py still
   * regenerates them, in case the gauge is ever wanted back. */
  // Mango cream sprinkle variants: blob, teardrop, capsule sprinkle, dot.
  for (let i = 1; i <= 4; i += 1) {
    game.addImg(`cream${i}`, pathGenerator(`cream-${i}.webp`))
  }
  game.addAudio('drop-perfect', pathGenerator('drop-perfect.mp3'))
  game.addAudio('drop', pathGenerator('drop.mp3'))
  game.addAudio('game-over', pathGenerator('game-over.mp3'))
  game.addAudio('rotate', pathGenerator('rotate.mp3'))
  game.addAudio('bgm', pathGenerator('bgm.mp3'))
  /* One voice per flypast, played as the sprite enters — see the schedule in
   * animateFuncs.js. `celebrate` is the take-the-lead party, fired by the page
   * (celebrate.js) rather than by the engine. `clip` is the shear as an
   * overhang breaks off, and `drip` a single bead of cream leaving the seam. */
  game.addAudio('flight-plane', pathGenerator('flight-plane.mp3'))
  game.addAudio('flight-rocket', pathGenerator('flight-rocket.mp3'))
  game.addAudio('flight-birds', pathGenerator('flight-birds.mp3'))
  game.addAudio('flight-comet', pathGenerator('flight-comet.mp3'))
  game.addAudio('celebrate', pathGenerator('celebrate.mp3'))
  game.addAudio('clip', pathGenerator('clip.mp3'))
  game.addAudio('drip', pathGenerator('drip.mp3'))
  /* Every button in the page ticks. Registered here rather than as a bare
   * <audio> on the page so it goes through the same mute switch and the same
   * preload as the rest — a UI sound that keeps playing after the player has
   * turned the sound off is the sort of thing people notice. */
  game.addAudio('click', pathGenerator('click.mp3'))
  /* The cake block's own three sounds, in the order the player hears them: the
   * rope creaking as the block swings, the air as it drops, the thud as it
   * lands. `land` is the physical impact only — drop / drop-perfect above stay
   * the scoring chime, and the two layer because the thud is all low end and
   * the chime has none. See tools/make-cake-sfx.js. */
  game.addAudio('swing', pathGenerator('swing.mp3'))
  game.addAudio('fall', pathGenerator('fall.mp3'))
  game.addAudio('land', pathGenerator('land.mp3'))
  /* The engine has no mixer, so levels are set on the elements themselves.
   * These sit on top of a bed of music and the drop sounds, and element volume
   * only ever scales DOWN — so the clips themselves are normalised to a common
   * peak (tools do this offline) and the trims below are balance, not rescue.
   * addAudio stores the element synchronously, so it is there to be adjusted.
   *
   * The drip and the rope creak are held well back. Both recur on their own
   * clock for the whole run — a bead falls off every landed layer every second
   * or so, and the rope creaks twice per swing — so both have to read as texture
   * rather than as events. Everything else is a one-off. */
  const levels = {
    'flight-plane': 0.85,
    'flight-rocket': 0.8,
    'flight-birds': 0.85,
    'flight-comet': 0.8,
    celebrate: 0.9,
    clip: 0.7,
    drip: 0.3,
    // Held back for the same reason as the drip: it fires on every tap, and a
    // confirmation tick that competes with the music is a tick you get sick of.
    click: 0.45,
    // Constant, so quiet enough to notice only when it stops.
    swing: 0.22,
    // Under the tap that caused it, and ducking out of the way of the thud.
    fall: 0.5,
    // The thud sits UNDER drop/drop-perfect rather than beside them; at parity
    // the two attacks fight and the landing reads as a rattle.
    land: 0.6
  }
  Object.keys(levels).forEach((name) => {
    const audio = game.getAudio(name)
    if (audio) audio.volume = levels[name]
  })
  /* The canvas is as wide as the window; the tower is stacked in a centred
   * portrait column of it. The page passes the column width in CSS pixels —
   * fall back to the whole canvas so a portrait screen, where the two are the
   * same thing, needs no special case. */
  const playWidth = option.playWidth
    ? option.playWidth * (game.highResolution ? 2 : 1)
    : game.width
  game.setVariable(constant.playWidth, playWidth)
  game.setVariable(constant.playLeft, Math.round((game.width - playWidth) / 2))

  game.setVariable(constant.blockWidth, playWidth * 0.39)
  // Height as a fraction of width. Lower = flatter, more normal-looking cake
  // layer; the tall 0.71 slab read as too chunky next to its own width.
  game.setVariable(constant.blockHeight, game.getVariable(constant.blockWidth) * 0.56)
  game.setVariable(constant.currentWidth, game.getVariable(constant.blockWidth))
  game.setVariable(constant.currentHeight, game.getVariable(constant.blockHeight))
  // Sized off the column so a space prop or a bird stays the size it is on a
  // phone; they are still PLACED across the whole canvas, which is what gives a
  // laptop a wider view of the same sky rather than bigger scenery.
  game.setVariable(constant.cloudSize, playWidth * 0.3)
  game.setVariable(constant.ropeHeight, game.height * 0.34)
  game.setVariable(constant.lineInitialOffset, game.height * 0.671)
  game.setVariable(constant.blockCount, 0)
  game.setVariable(constant.successCount, 0)
  game.setVariable(constant.failedCount, 0)
  game.setVariable(constant.gameScore, 0)
  game.setVariable(constant.satisfaction, constant.satisfactionStart)
  game.setVariable(constant.hardMode, false)
  game.setVariable(constant.gameUserOption, option)
  const line = new Instance({
    name: 'line',
    action: lineAction,
    painter: linePainter
  })
  game.addInstance(line)
  const hook = new Instance({
    name: 'hook',
    action: hookAction,
    painter: hookPainter
  })
  game.addInstance(hook)
  /* The customer hovers beside the tower on video, watching it go up. The three
   * clips are <video> elements, so the engine's image/audio loader knows nothing
   * about them — the promise, and the per-clip ticks, are handed to the page
   * instead, which folds both into the same loading bar. */
  game.customerReady = addCustomer(game, option.onCustomerProgress)

  /* The stock engine treats an Audio element as loaded as soon as it is created
   * and swallows play() failures. On mobile that creates two hard-to-see races:
   * an effect can be requested before its first bytes are decoded, and the BGM
   * can be paused by the bulk "unlock" after a page-level fallback started it.
   * Own playback here so persistent sounds can retry once data is available and
   * so a real play always cancels an in-flight silent warm-up. */
  const enginePauseAudio = game.pauseAudio.bind(game)
  game.playAudio = (name, loop = false) => {
    if (!game.soundOn) return Promise.resolve(false)
    const audio = game.getAudio(name)
    if (!audio) return Promise.resolve(false)
    if (name === 'bgm') game._bgmWanted = true
    if (audio._cancelWarm) audio._cancelWarm()
    audio._warmToken = null
    audio.loop = loop
    audio.muted = false
    const attempt = () => {
      let promise
      try { promise = audio.play() } catch (e) { promise = Promise.reject(e) }
      if (!promise || !promise.catch) return Promise.resolve(true)
      return promise.then(() => true).catch((error) => {
        // A gesture will retry BGM. A decode/network miss on either long-lived
        // cue gets one canplay retry instead of being silently discarded.
        if (error && error.name === 'NotAllowedError') return false
        if ((name === 'bgm' || name === 'game-over') && !audio._readyRetry) {
          audio._readyRetry = true
          audio.addEventListener('canplay', () => {
            audio._readyRetry = false
            if (name !== 'bgm' || game._bgmWanted) attempt()
          }, { once: true })
          audio.preload = 'auto'
          try { audio.load() } catch (e) { /* browser will retry naturally */ }
        }
        return false
      })
    }
    return attempt()
  }
  game.pauseAudio = (name) => {
    if (name === 'bgm') game._bgmWanted = false
    enginePauseAudio(name)
  }

  /* Unlock the small gameplay effects during a real gesture. BGM is deliberately
   * started separately and never included in the pause/rewind warm-up. Starting
   * sixteen audio/video elements together was both the missing-music race and a
   * burst of decoder work on Android/iOS. */
  game.unlockAudio = () => {
    if (!game.soundOn) return
    // An async camera permission callback may no longer have autoplay rights.
    // Keep the method retryable for the next real tap in that case.
    if (nav.userActivation && !nav.userActivation.isActive) return
    const firstUnlock = !game._mediaUnlocked
    game._mediaUnlocked = true
    // playBgm() may already have failed outside a gesture; this call is inside
    // the gesture and is the authoritative start. Never pause it below.
    game.playBgm()
    if (!firstUnlock) return
    const media = [
      'drop-perfect', 'drop', 'game-over', 'rotate', 'click',
      'swing', 'fall', 'land', 'clip', 'drip'
    ].map(name => game.getAudio(name)).filter(Boolean)
    // Customer voices are separate Audio elements. Warm those three too so
    // Safari cannot authorize the effects while leaving reactions silent.
    const customer = game.getInstance('customer', constant.customerLayer)
    if (customer && customer.videos) {
      Object.keys(customer.videos).forEach((mood) => {
        media.push(customer.videos[mood].voice)
      })
    }
    media.forEach((el) => {
      if (!el || !el.paused) return
      const token = {}
      el._warmToken = token
      const level = el.volume
      const wasMuted = el.muted
      el._cancelWarm = () => {
        if (el._warmToken !== token) return
        el._warmToken = null
        el.volume = level
        el.muted = wasMuted
      }
      el.muted = false
      el.volume = 0
      const done = () => {
        // A real effect may have reused this element while play() was resolving.
        if (el._warmToken !== token) return
        el._warmToken = null
        el._cancelWarm = null
        el.pause()
        try { el.currentTime = 0 } catch (e) { /* not seekable yet */ }
        el.volume = level
        el.muted = wasMuted
      }
      try {
        const p = el.play()
        if (p && p.then) p.then(done).catch(done)
        else done()
      } catch (e) { done() }
    })
  }
  const unlock = () => game.unlockAudio()
  // Capture phase puts unlocking ahead of the engine's own touch listener.
  document.addEventListener('touchstart', unlock, true)
  document.addEventListener('mousedown', unlock, true)
  document.addEventListener('keydown', unlock, true)

  game.startAnimate = startAnimate
  game.endAnimate = endAnimate
  game.paintUnderInstance = background
  // Assets are loaded when init is called. Downsize print-resolution cake art
  // before the first animation frame so gameplay never pays this cost mid-drop.
  const engineInit = game.init.bind(game)
  game.init = () => {
    prepareBlockTextures(game)
    engineInit()
  }
  game.addKeyDownListener('enter', () => {
    if (game.debug) game.togglePaused()
  })
  game.touchStartListener = () => {
    touchEventHandler(game)
  }

  game.playBgm = () => {
    game._bgmWanted = true
    return game.playAudio('bgm', true)
  }

  game.pauseBgm = () => {
    game.pauseAudio('bgm')
  }

  // Mobile browsers can suspend media when switching apps or opening camera
  // permission UI. Resume the requested music when the page becomes active.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && game._mediaUnlocked && game._bgmWanted) game.playBgm()
  })

  /* The page's buttons live in the DOM, not in the engine, so they get a hook
   * rather than reaching into the audio map themselves. playSfx and not
   * playAudio: two taps in quick succession are normal on a menu, and play()
   * on an element that is already playing does nothing at all. */
  game.playClick = () => {
    playSfx(game, 'click')
  }

  game.start = () => {
    const tutorial = new Instance({
      name: 'tutorial',
      action: tutorialAction,
      painter: tutorialPainter
    })
    game.addInstance(tutorial)
    const tutorialArrow = new Instance({
      name: 'tutorial-arrow',
      action: tutorialAction,
      painter: tutorialPainter
    })
    game.addInstance(tutorialArrow)
    game.setTimeMovement(constant.bgInitMovement, 500)
    game.setTimeMovement(constant.tutorialMovement, 500)
    game.setVariable(constant.gameStartNow, true)
  }

  return game
}
