import { Instance } from 'cooljs'
import { pl, pw, isGameOver } from './utils'
import * as constant from './constant'

/* The customer, watching the cake go up.
 *
 * This replaces two things at once: the mango balloon that used to drift past,
 * and the satisfaction gauge with its three little faces. What stands in for
 * both is one of three video clips — WATCHING while the stacking is going
 * normally, HAPPY when a layer lands clean, ANGRY when one gets mangled —
 * parked to the right of the tower and a little above its top, riding with the
 * stack as the world scrolls.
 *
 * The clips are shot on flat white, so the white has to come off at runtime.
 * That is what the keyer below does, and the algorithm is the one from the
 * reference page in assets/index.html: a downsampled near-white mask, dilated
 * so thin light details cannot cut the background into islands, flood filled
 * from the borders so only white CONNECTED TO THE OUTSIDE is removed (the eyes
 * stay), intersected back with the undilated mask to recover the true edge, and
 * subtracted with destination-out. Upscaling the small mask onto the frame
 * feathers that edge for free.
 *
 * It is not the same COST, though. The reference keys one full-resolution frame
 * per rAF and does nothing else; this runs inside a game already painting a
 * whole canvas at 60fps, on phones. Four things pay for it:
 *
 *   - the mask is 128px on its long side rather than 320 — ~6x fewer pixels;
 *   - the dilation is separable, two 5-tap passes instead of one 5x5 kernel;
 *   - the frame is keyed at the size it will be DRAWN, not at video resolution;
 *   - and it is keyed only when the video presents a NEW frame. The clips run at
 *     video rate and the game paints at 60Hz, so most game frames are a plain
 *     drawImage of the canvas that was keyed last time.
 *
 * A mood change is a short cross-dissolve between the outgoing keyed frame,
 * kept as a snapshot, and the incoming one — so the switch is quick and smooth
 * and only ever one keyer is running.
 */

// White tolerance, as the reference page's slider defaults to.
const TOLERANCE = 80
// Long side of the mask, and of the keyed canvas, in pixels.
const MASK_LONG = 112
const KEYED_LONG = 280
// Runtime keying is deliberately below the source video's 30fps. The customer
// still moves at the game's frame rate; only its internal video frame refresh is
// limited, freeing the main thread for the hook and block physics.
const KEY_FPS = 20
const MOBILE_MASK_LONG = 80
const MOBILE_KEYED_LONG = 192
const MOBILE_KEY_FPS = 12
// WebKit video-to-canvas readback is the expensive path on iPhone/iPad. Keep
// the decorative customer deliberately light so gameplay owns the main thread.
const APPLE_MASK_LONG = 48
const APPLE_KEYED_LONG = 144
const APPLE_KEY_FPS = 6
// Dilation radius. 2 = the reference's 5x5 kernel.
const RADIUS = 2
// The box the clip is fitted into, as fractions of the stacking column. Fitting
// rather than scaling by width keeps a portrait clip from towering over the
// tower and a landscape one from becoming a stripe.
const BOX_W = 0.40
const BOX_H = 0.49
// Gap between the customer's feet and the tower top, in column widths.
const LIFT = 0.09
// Nothing climbs above this — it is where the FLOOR and SCORE plaques end.
const CEILING = 0.30
// The dissolve between two clips.
const FADE = 0.16
/* How loud the customer is. The reactions are one-off events and are meant to be
 * heard; the watching bed runs for the WHOLE RUN behind the music and the
 * landing sounds, so it is held back to the same territory as the cream drip and
 * the rope creak — texture you notice when it stops, not a voice competing with
 * the game. */
const VOICE_LEVEL = 0.9
const VOICE_REST_LEVEL = 0.35
/* How far the voice may drift from its picture before it is pulled back, in
 * seconds. Two elements, two clocks: over a run of several minutes the ten-second
 * watching loop would otherwise walk out of step with the mouth it belongs to.
 * A quarter-second is under the threshold where a voice reads as dubbed. */
const SYNC_SLIP = 0.25
/* How long a reaction runs when its clip will not say how long it is. Only ever
 * a fallback -- the real answer is the clip's own duration, read at runtime. */
const REACTION_FALLBACK = 4

/* Which mood may take the screen from which, and when.
 *
 * The mechanic asks for a reaction on every landing worth an opinion, which is
 * most of them. Honouring each request the moment it arrived meant a reaction
 * every second or two, each one cut off partway through and the next one joined
 * partway in -- the customer never finished reacting to anything, and what the
 * player saw was a clip that kept restarting.
 *
 * So a reaction now plays THROUGH. It starts at the top of its clip, runs the
 * clip's full length, and only then hands back to watching. A request that
 * arrives while it is running is DROPPED, not queued: a verdict on a layer three
 * floors down, delivered late, is worse than no reaction at all.
 *
 * ANGRY is the one exception. A wrecked layer is the loudest thing that happens
 * in a run, so it cuts in over a happy clip immediately rather than waiting its
 * turn. Nothing cuts in over angry -- not even another angry, which would only
 * restart it and is exactly the stutter this is here to remove.
 *
 * All of which is one comparison: a request plays if, and only if, it OUTRANKS
 * what is already on screen. */
const PRIORITY = { watching: 0, happy: 1, angry: 2 }

const MOODS = {
  watching: 'watching',
  happy: 'happy',
  angry: 'angry'
}

/* WebM/VP9 where the browser takes it, MP4/H.264 everywhere else.
 *
 * VP9-in-WebM is the moving-picture answer to WebP — same lineage, same trade,
 * about 10% off the H.264 file at matched quality here, and both are a fifth of
 * what the masters weighed. The clips are shipped in both because the fallback
 * is not hypothetical: Safari only learned VP9 recently and decodes it in
 * software when it does, and this page is already asking a phone to decode three
 * videos while keying one of them per frame. H.264 is hardware-decoded on
 * everything, so the browsers that would struggle are exactly the ones that get
 * it.
 *
 * canPlayType answers 'probably' / 'maybe' / '' — anything non-empty means the
 * browser is willing, and a codecs= string is what makes the answer meaningful
 * rather than a guess about the container. */
const clipUrl = (mood, appleMobile) => {
  // Apple recommends H.264 MP4 for static Safari video. Newer iOS versions may
  // report VP9/WebM support even where that particular device/browser path is
  // less power-efficient than its long-established H.264 hardware decoder.
  if (appleMobile) return `./assets/${MOODS[mood]}.mp4`
  const probe = document.createElement('video')
  const webm = probe.canPlayType('video/webm; codecs="vp9"')
  return `./assets/${MOODS[mood]}.${webm ? 'webm' : 'mp4'}`
}

/* The clip's soundtrack. The mp3s are the real thing — recorded audio cut to
 * match each clip, frame by frame — so they play through a separate element
 * rather than through the video itself. The videos cannot carry the sound:
 * they must stay muted for autoplay to be legal without a gesture, so unmuting
 * them on a reaction would be blocked half the time. Instead each clip has its
 * own <audio>, held in lockstep: rewound to zero and started on the same frame
 * the clip starts, paused and rewound the moment the clip hands back. */
const audioUrl = (mood) => `./assets/${MOODS[mood]}.mp3`

// Exponential ease toward a target that stays stable across frame rates.
const ease = (current, target, rate, dt) =>
  current + ((target - current) * (1 - Math.exp(-rate * dt)))

// The line instance's live y IS the tower top — it scrolls as floors land — so
// read that rather than the static initial offset.
const towerTopY = (engine) => {
  const line = engine.getInstance('line')
  return (line && line.ready)
    ? line.y
    : engine.getVariable(constant.lineInitialOffset)
}

/* Where the customer stands: against the right edge of the STACKING COLUMN, not
 * of the screen, so on a laptop they stay beside the action instead of stranded
 * out in the wallpaper. Vertically they ride just above the tower top, clamped
 * out of the HUD's corner. */
const restSpot = (i, engine) => {
  const colW = pw(engine)
  const right = pl(engine) + colW
  return {
    x: right - i.w - (colW * 0.02),
    y: Math.max(colW * CEILING, towerTopY(engine) - i.h - (colW * LIFT))
  }
}
/* The keyer. One of these per clip, holding every buffer it needs so that a
 * frame costs no allocation at all — the reference page allocates a fresh
 * ImageData per frame, which is the one thing it does that a 60fps game cannot
 * afford. Sized on first use, when the video finally reports its resolution. */
function makeKeyer(performanceMode, appleMobile) {
  return {
    ready: false,
    // The visible result: a canvas the size the clip is drawn at, with the
    // background already subtracted. The game blits this.
    out: null,
    outCtx: null,
    // The frame downsampled to mask resolution, and the mask built from it.
    src: null,
    srcCtx: null,
    mask: null,
    maskCtx: null,
    maskImg: null,
    w: 0,
    h: 0,
    mw: 0,
    mh: 0,
    near: null,
    tmp: null,
    dil: null,
    flood: null,
    queue: null,
    // The clip's own frame counter where the browser exposes one, so a repeat
    // of the same video frame is never keyed twice.
    lastFrame: -1,
    lastKeyAt: -Infinity,
    maskLong: appleMobile ? APPLE_MASK_LONG
      : (performanceMode ? MOBILE_MASK_LONG : MASK_LONG),
    keyedLong: appleMobile ? APPLE_KEYED_LONG
      : (performanceMode ? MOBILE_KEYED_LONG : KEYED_LONG),
    keyInterval: 1000 / (appleMobile ? APPLE_KEY_FPS
      : (performanceMode ? MOBILE_KEY_FPS : KEY_FPS)),
    smoothingQuality: performanceMode ? 'low' : 'medium'
  }
}

function sizeKeyer(k, vw, vh) {
  const scale = k.keyedLong / Math.max(vw, vh)
  k.w = Math.max(2, Math.round(vw * scale))
  k.h = Math.max(2, Math.round(vh * scale))
  const mScale = k.maskLong / Math.max(vw, vh)
  k.mw = Math.max(2, Math.round(vw * mScale))
  k.mh = Math.max(2, Math.round(vh * mScale))

  k.out = document.createElement('canvas')
  k.out.width = k.w
  k.out.height = k.h
  k.outCtx = k.out.getContext('2d')

  k.src = document.createElement('canvas')
  k.src.width = k.mw
  k.src.height = k.mh
  /* willReadFrequently: this canvas exists to be read back with getImageData
   * every frame, which is the access pattern GPU-backed canvases are worst at —
   * each read stalls the pipeline waiting for a readback. The hint moves it to
   * software, where the read is a memcpy. */
  k.srcCtx = k.src.getContext('2d', { willReadFrequently: true })

  k.mask = document.createElement('canvas')
  k.mask.width = k.mw
  k.mask.height = k.mh
  k.maskCtx = k.mask.getContext('2d')
  k.maskImg = k.maskCtx.createImageData(k.mw, k.mh)

  const n = k.mw * k.mh
  k.near = new Uint8Array(n)
  k.tmp = new Uint8Array(n)
  k.dil = new Uint8Array(n)
  k.flood = new Uint8Array(n)
  k.queue = new Int32Array(n)
  k.ready = true
}

/* Dilate `near` into `dil`, separably: a horizontal 5-tap pass into `tmp`, then
 * a vertical one out of it. A square kernel is separable by definition, so this
 * is the same result as the reference's 5x5 double loop for 2r+1 + 2r+1 reads
 * per pixel instead of (2r+1)^2 — 10 against 25 at radius 2, and the gap widens
 * if the radius ever does. */
function dilate(k) {
  const { mw, mh, near, tmp, dil } = k
  for (let y = 0; y < mh; y += 1) {
    const row = y * mw
    for (let x = 0; x < mw; x += 1) {
      let hit = 0
      const from = x - RADIUS < 0 ? 0 : x - RADIUS
      const to = x + RADIUS >= mw ? mw - 1 : x + RADIUS
      for (let nx = from; nx <= to; nx += 1) {
        if (near[row + nx] === 1) { hit = 1; break }
      }
      tmp[row + x] = hit
    }
  }
  for (let y = 0; y < mh; y += 1) {
    const from = y - RADIUS < 0 ? 0 : y - RADIUS
    const to = y + RADIUS >= mh ? mh - 1 : y + RADIUS
    for (let x = 0; x < mw; x += 1) {
      let hit = 0
      for (let ny = from; ny <= to; ny += 1) {
        if (tmp[(ny * mw) + x] === 1) { hit = 1; break }
      }
      dil[(y * mw) + x] = hit
    }
  }
}

/* Flood the dilated mask inward from every border pixel. This is the step that
 * makes the whole thing work: it is what tells the white AROUND the customer
 * apart from the white INSIDE them — an eye, a tooth, a highlight — because
 * only the outside is reachable from the frame's edge. The queue holds flat
 * indices rather than x/y pairs, so it is half the reference's traffic. */
function floodFromBorders(k) {
  const {
    mw, mh, dil, flood, queue
  } = k
  flood.fill(0)
  let tail = 0
  const seed = (idx) => {
    if (dil[idx] === 1 && flood[idx] === 0) {
      flood[idx] = 1
      queue[tail] = idx
      tail += 1
    }
  }
  const lastRow = (mh - 1) * mw
  for (let x = 0; x < mw; x += 1) {
    seed(x)
    seed(lastRow + x)
  }
  for (let y = 1; y < mh - 1; y += 1) {
    seed(y * mw)
    seed((y * mw) + mw - 1)
  }
  let head = 0
  while (head < tail) {
    const idx = queue[head]
    head += 1
    const x = idx % mw
    if (x > 0 && dil[idx - 1] === 1 && flood[idx - 1] === 0) {
      flood[idx - 1] = 1; queue[tail] = idx - 1; tail += 1
    }
    if (x < mw - 1 && dil[idx + 1] === 1 && flood[idx + 1] === 0) {
      flood[idx + 1] = 1; queue[tail] = idx + 1; tail += 1
    }
    if (idx >= mw && dil[idx - mw] === 1 && flood[idx - mw] === 0) {
      flood[idx - mw] = 1; queue[tail] = idx - mw; tail += 1
    }
    if (idx < (mh - 1) * mw && dil[idx + mw] === 1 && flood[idx + mw] === 0) {
      flood[idx + mw] = 1; queue[tail] = idx + mw; tail += 1
    }
  }
}

// Key one video frame into k.out. Costs a getImageData, three passes over a
// small buffer and two drawImages; everything else is reused.
function keyFrame(k, video) {
  const {
    mw, mh, near, dil, flood
  } = k
  const n = mw * mh

  k.outCtx.globalCompositeOperation = 'source-over'
  k.outCtx.clearRect(0, 0, k.w, k.h)
  k.outCtx.drawImage(video, 0, 0, k.w, k.h)

  k.srcCtx.drawImage(video, 0, 0, mw, mh)
  const data = k.srcCtx.getImageData(0, 0, mw, mh).data

  // Near-white by L1 distance to flat white, per channel.
  for (let i = 0; i < n; i += 1) {
    const p = i * 4
    near[i] = (data[p] >= 255 - TOLERANCE
      && data[p + 1] >= 255 - TOLERANCE
      && data[p + 2] >= 255 - TOLERANCE) ? 1 : 0
  }

  dilate(k)
  floodFromBorders(k)

  /* Intersect back with the UNDILATED mask. The dilation was only ever a device
   * for letting the flood cross thin bright lines; keeping it in the result
   * would eat a two-pixel bite out of the customer's outline all the way round. */
  const out = k.maskImg.data
  for (let i = 0; i < n; i += 1) {
    const p = i * 4
    const bg = (flood[i] === 1 && near[i] === 1) ? 255 : 0
    out[p] = bg
    out[p + 1] = bg
    out[p + 2] = bg
    out[p + 3] = bg
  }
  k.maskCtx.putImageData(k.maskImg, 0, 0)

  // Subtract. Smoothing on the upscale is what feathers the edge: a mask built
  // at 128px would otherwise cut a visibly stepped silhouette.
  k.outCtx.globalCompositeOperation = 'destination-out'
  k.outCtx.imageSmoothingEnabled = true
  k.outCtx.imageSmoothingQuality = k.smoothingQuality
  k.outCtx.drawImage(k.mask, 0, 0, k.w, k.h)
  k.outCtx.globalCompositeOperation = 'source-over'
}

/* Has the clip advanced since the last key? Chromium and Safari can answer
 * exactly, through the frame counter that comes with requestVideoFrameCallback;
 * elsewhere currentTime is the best available proxy and is good enough, because
 * a repeated timestamp means a repeated frame either way. */
function frameId(video) {
  const q = video.getVideoPlaybackQuality
    ? video.getVideoPlaybackQuality()
    : null
  return q ? q.totalVideoFrames : video.currentTime
}

/* One <video> per mood.
 *
 * They are created here rather than in the page because there are two pages and
 * the engine is the one thing they share — a copy in each HTML file is a copy to
 * forget to change. muted is what makes autoplay legal without a gesture, and
 * the clips have no sound to lose; playsinline stops iOS taking one fullscreen.
 *
 * WATCHING is the resting state, so it loops and runs from the start. The two
 * reactions do NOT loop: each is played once, all the way through, and then
 * parked back on its own first frame to wait for the next time it is asked for.
 * Parked is not cold — preload='auto' has the clip decoded, so play() picks up
 * on the frame already being drawn. What parking buys is that a reaction never
 * has to REWIND at the moment it is wanted, which is a seek landing exactly on
 * the frame the player is looking at. */
function makeVideos(performanceMode, appleMobile) {
  const vids = {}
  Object.keys(MOODS).forEach((mood) => {
    const resting = mood === 'watching'
    const v = document.createElement('video')
    v.src = clipUrl(mood, appleMobile)
    v.muted = true
    v.defaultMuted = true
    v.loop = resting
    v.playsInline = true
    v.setAttribute('muted', '')
    v.setAttribute('playsinline', '')
    v.preload = 'auto'
    /* The clip's voice, on its own element beside the muted picture. It loops
     * with the clip it belongs to, so watching's ambience runs as long as
     * watching does and a reaction's voice stops when the reaction does.
     *
     * Held under the music and the landing sounds: the customer is a presence in
     * the corner of the screen, not the thing the player is listening for, and
     * the ten-second watching bed plays for the entire run. */
    const a = document.createElement('audio')
    a.src = audioUrl(mood)
    a.loop = resting
    a.preload = 'auto'
    a.volume = resting ? VOICE_REST_LEVEL : VOICE_LEVEL
    vids[mood] = { el: v, voice: a, keyer: makeKeyer(performanceMode, appleMobile) }
    const play = () => { const p = v.play(); if (p && p.catch) p.catch(() => {}) }
    if (resting) {
      play()
      /* A browser that refused the autoplay gets one more chance on the first
       * touch — the same fallback the page uses for the music. */
      document.addEventListener('touchstart', play, { once: true, passive: true })
      document.addEventListener('click', play, { once: true })
    } else {
      /* Started and stopped again immediately, which is the reliable way to get
       * a first frame decoded and on the element across browsers; loadeddata is
       * the belt to that pair of braces, for when autoplay is refused outright. */
      const park = () => { v.pause(); v.currentTime = 0 }
      v.addEventListener('loadeddata', park, { once: true })
      const p = v.play()
      if (p && p.then) p.then(park).catch(() => {})
    }
  })
  return vids
}

/* Resolves once every clip can play, so the page's loading bar can wait for them
 * along with the sprites and the audio, and calls `onProgress(done, total)` as
 * each one arrives so the bar moves rather than jumping.
 *
 * The engine's own loader cannot do this: it knows about Image and Audio and
 * nothing else. And they DO have to be waited for — the customer is on screen
 * from the first floor, so a clip still buffering at that point is a hole in the
 * scene during the part of the run the player is paying most attention to.
 *
 * The bar is `canplay`, not `canplaythrough`: the customer needs frames to key,
 * not the whole file, and for a looping ten-second clip canplaythrough is very
 * nearly the whole download. The rest arrives while the player is stacking.
 *
 * Never rejects, and gives up after six seconds. A missing or slow clip should
 * cost the player a customer, not the game: everything else about the run works
 * without one, and a loading bar that will not fill is the worse failure. */
function whenVideosReady(vids, onProgress) {
  /* Both halves of every mood — the picture and the voice that has to land on
   * it. The audio is gated for the same reason the video is: a reaction whose
   * voice is still arriving plays silent, and the first one usually fires within
   * a few floors of the start. Six items, one bar. */
  const media = []
  Object.keys(vids).forEach((m) => {
    media.push(vids[m].el)
    media.push(vids[m].voice)
  })
  let arrived = 0
  return Promise.all(media.map(v => new Promise((resolve) => {
    let settled = false
    // One tick per clip whichever way it finishes — ready, broken or timed out.
    // Without the guard the timeout would count a clip that already arrived and
    // push the bar past 100%.
    const done = () => {
      if (settled) return
      settled = true
      v.removeEventListener('canplay', done)
      v.removeEventListener('error', done)
      arrived += 1
      if (onProgress) onProgress(arrived, media.length)
      resolve()
    }
    if (v.readyState >= 3) { done(); return }
    v.addEventListener('canplay', done)
    v.addEventListener('error', done)
    setTimeout(done, 6000)
  })))
}

/* Which mood a landing calls for, and the request itself, both live in utils.js
 * next to addSatisfaction — see moodForDelta / setCustomerMood there. They are a
 * pair of one-liners over engine variables and they belong on the calling side:
 * this module already imports utils for the column helpers, so defining them
 * here would close a require cycle for no gain. */

/* Start a clip and its voice together, ON THE SAME FRAME. The video needs a
 * fresh play() (a reaction is parked and paused between uses; watching is
 * already looping and play() on it is a no-op).
 *
 * The voice is seeked to the PICTURE's position rather than to zero, which is
 * the same thing in the case that matters — a reaction is parked on frame 0, so
 * its voice starts at 0 with it — but is also right for watching, whose picture
 * has been looping since engine construction and may be six seconds in. Seeking
 * that one to zero would put the voice six seconds out from the mouth.
 *
 * play() before the seek, because an element that is already playing ignores
 * play() entirely: a reaction cutting in over itself would otherwise carry on
 * from its own tail. */
function startClipAndVoice(engine, mood, i) {
  const { el, voice } = i.videos[mood]
  const p = el.play()
  if (p && p.catch) p.catch(() => {})
  if (!engine.soundOn) return
  try { voice.currentTime = el.currentTime || 0 } catch (e) { /* not seekable yet */ }
  // A reaction can start while the first-gesture silent warm-up is resolving.
  // Restore its real level and make that old promise unable to pause the voice.
  if (voice._cancelWarm) voice._cancelWarm()
  const q = voice.play()
  if (q && q.catch) q.catch(() => {})
}

/* Silence whichever voice is on screen. Called on every mood change, before the
 * incoming one starts — including when the outgoing mood is watching, whose bed
 * must get out of the way of a reaction rather than play underneath it. */
function stopVoice(engine, i) {
  const cur = i.videos[i.shown]
  if (!cur) return
  cur.voice.pause()
  try { cur.voice.currentTime = 0 } catch (e) { /* not seekable yet */ }
}

/* Pull the voice back onto its picture if the two have drifted.
 *
 * Two media elements mean two clocks, and over a run of several minutes the
 * ten-second watching loop walks away from the mouth it belongs to. Both
 * currentTimes are already in seconds, and the correction is applied in either
 * direction — the audio is 10.03s against a 10.00s clip, so it runs slightly
 * long and the drift is not one-sided. Only ever nudged when it is audible;
 * seeking every frame would be its own artefact. */
function resyncVoice(engine, i, mood) {
  if (!engine.soundOn) return
  const { el, voice } = i.videos[mood]
  if (voice.paused || el.paused) return
  if (!voice.duration || !isFinite(voice.duration)) return
  /* Modulo the clip length, so the instant one of the pair has looped and the
   * other has not is not read as ten seconds of drift. */
  const len = Math.min(voice.duration, el.duration || voice.duration)
  let slip = (voice.currentTime - el.currentTime) % len
  if (slip > len / 2) slip -= len
  if (slip < -len / 2) slip += len
  if (Math.abs(slip) > SYNC_SLIP) {
    try { voice.currentTime = el.currentTime } catch (e) { /* not seekable yet */ }
  }
}

const customerAction = (instance, engine, time) => {
  const i = instance
  if (!engine.getVariable(constant.gameStartNow, false)) {
    i.ready = false
    return
  }
  // The scene freezes where the run ended: the customer holds their last
  // position and their last verdict, on whatever frame the clip stopped at.
  // The voice does NOT hold — a looping bed under a game-over card is the one
  // sound in the run that would never stop on its own.
  if (isGameOver(engine)) {
    if (i.ready && !i.hushed) {
      i.hushed = true
      stopVoice(engine, i)
    }
    return
  }
  engine.setVariable(constant.gameTime, time)

  if (!i.ready) {
    const colW = pw(engine)
    /* Fit the clip into a box rather than scaling it by width. The aspect is not
     * known until a video reports it, and the first frames arrive before that,
     * so start from the box and correct once. */
    i.w = colW * BOX_W
    i.h = colW * BOX_H
    i.fitted = false
    i.mood = 'watching'
    i.shown = 'watching'
    // When the reaction on screen is due to end, and the timestamp of the last
    // request answered. Both are meaningless while watching.
    i.until = 0
    i.tookAt = -1
    i.fade = 1
    i.snap = null
    i.hushed = false
    i.lastTime = time
    const spot = restSpot(i, engine)
    i.x = spot.x
    i.y = spot.y
    i.elapsed = 0
    i.ready = true
    /* The watching bed starts with the run, not with the page: the clips are
     * created and playing from engine construction so their first frame is
     * decoded, but the menu should be silent. This is the first gameplay frame,
     * which is also a user gesture's worth of history, so play() is allowed. */
    startClipAndVoice(engine, 'watching', i)
    engine.setVariable(constant.customerMood, 'watching')
    engine.setVariable(constant.customerMoodAt, time)
    return
  }

  // Milliseconds in; clamp so a backgrounded tab does not teleport anything.
  const dt = Math.min((time - i.lastTime) / 1000, 0.05)
  i.lastTime = time
  i.elapsed += dt

  // Correct the box to the clip's real aspect, once it is known.
  if (!i.fitted) {
    const el = i.videos.watching.el
    if (el.videoWidth && el.videoHeight) {
      const colW = pw(engine)
      const scale = Math.min((colW * BOX_W) / el.videoWidth,
        (colW * BOX_H) / el.videoHeight)
      i.w = el.videoWidth * scale
      i.h = el.videoHeight * scale
      i.fitted = true
    }
  }

  const asked = engine.getVariable(constant.customerMood, 'watching')
  const askedAt = engine.getVariable(constant.customerMoodAt, 0)
  const playing = i.videos[i.shown]

  /* What SHOULD be on screen this frame, in two steps.
   *
   * First: a reaction that has run its length is over, and the customer goes
   * back to watching. `i.until` was set from the clip's own duration when it
   * started, and `ended` covers the case where it finished early or the timer
   * and the decoder disagree. */
  let want = i.shown
  if (want !== 'watching' && (time >= i.until || (playing && playing.el.ended))) {
    want = 'watching'
  }

  /* Second: a request. Each one is answered exactly once — `i.tookAt` remembers
   * the timestamp of the last one seen, so a mood variable that sits unchanged
   * for eight seconds does not re-trigger on all four hundred frames of them.
   *
   * A request that cannot take the screen is DROPPED here rather than queued.
   * Queueing was the other half of the stutter: a verdict on a layer three
   * floors down, delivered late, reads as the customer reacting to nothing. */
  if (asked !== 'watching' && askedAt !== i.tookAt) {
    i.tookAt = askedAt
    if (PRIORITY[asked] > PRIORITY[want]) want = asked
  }

  /* Cross-dissolve on a change. The outgoing clip's last keyed frame is copied
   * once into a snapshot canvas and faded out over the incoming one, so the
   * switch is a blend rather than a cut and only ONE keyer runs at a time — two
   * live keyers is the one version of this that drops frames. */
  if (want !== i.shown) {
    const from = i.videos[i.shown]
    if (from && from.keyer.ready) {
      if (!i.snap) i.snap = document.createElement('canvas')
      if (i.snap.width !== from.keyer.w || i.snap.height !== from.keyer.h) {
        i.snap.width = from.keyer.w
        i.snap.height = from.keyer.h
      }
      const sctx = i.snap.getContext('2d')
      sctx.clearRect(0, 0, i.snap.width, i.snap.height)
      sctx.drawImage(from.keyer.out, 0, 0)
      i.fade = 0
    } else {
      i.fade = 1
    }
    // Park the clip being left on its own first frame, ready for next time, and
    // silence its voice on the same frame so a cut-short reaction does not go on
    // talking underneath the one that replaced it.
    stopVoice(engine, i)
    if (from) {
      // Only the visible clip decodes. Leaving the watching loop running behind
      // every reaction made phones decode two videos while also keying one.
      from.el.pause()
      if (i.shown !== 'watching') from.el.currentTime = 0
    }
    i.shown = want
    const next = i.videos[want]
    if (want === 'watching') {
      i.until = 0
      /* Back to the resting state. Watching's picture never stopped — it loops
       * from engine construction — so this only restarts the voice, onto
       * whatever frame the loop has reached. */
      startClipAndVoice(engine, 'watching', i)
    } else if (next) {
      // Picture and voice from zero on the same frame. This is the sync.
      startClipAndVoice(engine, want, i)
      /* Run for as long as the clip actually is. The fallback is only for a
       * browser that has not read the metadata yet; every real answer here
       * comes from the file. */
      const dur = (next.el.duration && isFinite(next.el.duration))
        ? next.el.duration
        : REACTION_FALLBACK
      i.until = time + (dur * 1000)
    }
  }
  if (i.fade < 1) i.fade = Math.min(1, i.fade + (dt / FADE))

  // Ride with the tower. Eased rather than pinned, so the customer floats up as
  // the stack grows instead of snapping a floor's height every landing.
  const spot = restSpot(i, engine)
  i.x = ease(i.x, spot.x, 6, dt)
  i.y = ease(i.y, spot.y, 3.5, dt)
  // A slow bob on top, so they read as hovering rather than pasted on.
  i.bob = Math.sin(i.elapsed * 1.6) * (i.h * 0.035)

  // Key the drawn clip, but only when it has a new frame to key.
  const cur = i.videos[i.shown]
  if (cur && cur.el.readyState >= 2 && cur.el.videoWidth) {
    if (!cur.keyer.ready) sizeKeyer(cur.keyer, cur.el.videoWidth, cur.el.videoHeight)
    // Check the decoder frame only when the keyer's own budget allows work.
    // getVideoPlaybackQuality plus getImageData on every rAF was enough to stall
    // the shared animation thread on mobile devices.
    const keyDue = time - cur.keyer.lastKeyAt >= cur.keyer.keyInterval
    const id = keyDue ? frameId(cur.el) : cur.keyer.lastFrame
    if (keyDue && id !== cur.keyer.lastFrame) {
      cur.keyer.lastFrame = id
      cur.keyer.lastKeyAt = time
      keyFrame(cur.keyer, cur.el)
    }
  }
  // And hold the voice on the picture. Only ever seeks when the two have
  // audibly parted; see SYNC_SLIP.
  resyncVoice(engine, i, i.shown)
}

const customerPainter = (instance, engine) => {
  const i = instance
  if (!i.ready) return
  // Painter runs independently of action, so gate it too — otherwise the last
  // gameplay frame lingers on the menu screen.
  if (!engine.getVariable(constant.gameStartNow, false)) return
  const cur = i.videos && i.videos[i.shown]
  if (!cur || !cur.keyer.ready) return
  const { ctx } = engine
  const y = i.y + (i.bob || 0)
  // The outgoing frame underneath, fading; the incoming one over it, coming up.
  // Both at the same box, so the customer does not appear to move during the
  // change — only to change their mind.
  if (i.fade < 1 && i.snap) {
    ctx.save()
    ctx.globalAlpha = 1 - i.fade
    ctx.drawImage(i.snap, i.x, y, i.w, i.h)
    ctx.restore()
  }
  ctx.save()
  if (i.fade < 1) ctx.globalAlpha = i.fade
  ctx.drawImage(cur.keyer.out, i.x, y, i.w, i.h)
  ctx.restore()
}

export const addCustomer = (game, onProgress) => {
  /* The clips are created and started HERE, at engine construction, not on the
   * first gameplay frame — they are a couple of megabytes each and the whole
   * point of the loading bar is that nothing large is still arriving once the
   * player is playing. The instance picks them up off the engine.
   *
   * The returned promise is what the page waits on; see the loading gate in
   * index.html / index-blink.html. */
  const gameOption = game.getVariable(constant.gameUserOption) || {}
  const videos = makeVideos(!!gameOption.performanceMode, !!gameOption.appleMobile)
  const customer = new Instance({
    name: 'customer',
    action: customerAction,
    painter: customerPainter
  })
  customer.videos = videos
  game.addInstance(customer, constant.customerLayer)
  return whenVideosReady(videos, onProgress).then(() => {
    // Its first frame is decoded for instant start; do not spend battery
    // decoding the watching loop underneath the menu screens.
    videos.watching.el.pause()
  })
}
