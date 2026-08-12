/* Does a reaction clip play THROUGH, and does its voice land on it?
 *
 * The complaint this checks for: the customer's clip kept restarting. A reaction
 * was requested on nearly every landing, each request took the screen the frame
 * it arrived, and a 1.5s hold retired clips that are ten seconds long -- so the
 * player never saw one finish.
 *
 * Four things have to hold now (src/customer.js):
 *   1. a reaction runs its clip's full length and only then hands back;
 *   2. a second request of the SAME mood does not restart it;
 *   3. ANGRY cuts in over a happy immediately -- the tower going bad is the one
 *      thing that gets to interrupt;
 *   4. nothing cuts in over an angry, including another angry.
 *
 * And three more, for the per-mood mp3s the clips are cut against:
 *   5. the mood on screen is the mood being HEARD, and no other voice is;
 *   6. its voice sits on its picture, within SYNC_SLIP;
 *   7. a reaction's voice starts from the top of the clip, not from wherever it
 *      was left.
 *
 * Traps worth knowing, both of which cost a session already:
 *   - channel: 'chrome'. Bundled Chromium has no H.264, and this page ships MP4
 *     as the fallback next to the WebM.
 *   - getInstance(name, layer) defaults to the DEFAULT layer. The customer lives
 *     on CUSTOMER_LAYER, so a bare getInstance('customer') finds nothing and
 *     looks exactly like the feature being broken.
 */
const { chromium } = require('playwright')

/* Both editions share dist/main.js, so both get this. MODE=blink runs the other
 * one -- which needs a fake camera, because its game does not start until the
 * face mesh has a stream to look at. */
const MODE = process.env.MODE === 'blink' ? 'blink' : 'tap'
const URL = process.env.URL
  || `http://localhost:8082/${MODE === 'blink' ? 'blink' : ''}`
const wait = ms => new Promise(r => setTimeout(r, ms))

// Read the customer's own state out of the engine, plus each clip's position in
// its own timeline -- currentTime is what proves a restart happened or did not.
// `voice` is the paired mp3: its own position, and how far it sits from the
// picture it belongs to.
const SNAP = `(() => {
  const g = window.game;
  const c = g && g.getInstance('customer', 'CUSTOMER_LAYER');
  if (!c) return { err: 'no customer instance' };
  const clip = m => {
    const v = c.videos && c.videos[m];
    if (!v) return null;
    const a = v.voice;
    return { t: +v.el.currentTime.toFixed(2), paused: v.el.paused, ended: v.el.ended,
             dur: +(v.el.duration || 0).toFixed(2), rs: v.el.readyState,
             voice: a ? { t: +a.currentTime.toFixed(2), paused: a.paused,
                          dur: +(a.duration || 0).toFixed(2), rs: a.readyState,
                          vol: +(a.volume || 0).toFixed(2), loop: a.loop,
                          src: (a.currentSrc || '').split('/').pop(),
                          slip: +(a.currentTime - v.el.currentTime).toFixed(2) } : null };
  };
  return {
    shown: c.shown, fade: +(c.fade || 0).toFixed(2), until: Math.round(c.until || 0),
    tookAt: Math.round(c.tookAt),
    now: Math.round(g.getVariable('GAME_TIME', 0)),
    watching: clip('watching'), happy: clip('happy'), angry: clip('angry')
  };
})()`

const ask = mood => `(() => {
  const g = window.game;
  g.setVariable('CUSTOMER_MOOD', '${mood}');
  g.setVariable('CUSTOMER_MOOD_AT', g.getVariable('GAME_TIME', 0));
  return true;
})()`

;(async () => {
  const fails = []
  const check = (ok, label, detail) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`)
    if (!ok) fails.push(label)
  }

  const browser = await chromium.launch({
    channel: 'chrome',
    args: MODE === 'blink'
      ? ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
      : []
  })
  const page = await browser.newPage({
    viewport: { width: 420, height: 760 },
    permissions: MODE === 'blink' ? ['camera'] : []
  })
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))

  /* This test asserts the VIDEO + keyer backend (v.el.currentTime, keyer.out):
   * the reaction state machine is shared, but the picture backend it reads is
   * the desktop one. Phones with a baked atlas take the pre-keyed path instead
   * (no el, no keyer) — covered by .shots/atlas-check.js. A CI box with few
   * cores trips performanceMode and would otherwise land on the atlas path here
   * and read null.el, so pin the desktop profile before the bundle builds. */
  await page.addInitScript(() => {
    let real
    Object.defineProperty(window, 'TowerGame', {
      configurable: true,
      get() {
        return real ? function (opt) {
          opt.performanceMode = false
          opt.appleMobile = false
          return real(opt)
        } : undefined
      },
      set(v) { real = v }
    })
  })

  console.log(`      ${MODE} edition, ${URL}`)
  await page.goto(URL, { waitUntil: 'load' })
  await page.click('#start')
  await page.click(`.mode-pick[data-mode="${MODE}"]`)
  await page.fill('#player-name', 'ReactionProbe')
  await page.click('#profile-go')
  await wait(MODE === 'blink' ? 6000 : 2500)

  let s = await page.evaluate(SNAP)
  if (s.err) { console.log('FAIL  ' + s.err); await browser.close(); process.exit(1) }
  check(s.shown === 'watching', 'starts on watching', `shown=${s.shown}`)
  check(!s.watching.paused, 'watching clip is running', JSON.stringify(s.watching))
  check(s.happy.paused && s.happy.t === 0, 'happy parked on frame 0', JSON.stringify(s.happy))
  check(s.angry.paused && s.angry.t === 0, 'angry parked on frame 0', JSON.stringify(s.angry))
  const dur = s.happy.dur
  check(dur > 1, 'clip duration known', `${dur}s`)

  /* 5, 6. Each mood's voice is its OWN file, and the resting one is up and on
   * its picture. Only one voice may be audible at a time -- two would be two
   * people talking over each other. */
  const MOODS = ['watching', 'happy', 'angry']
  MOODS.forEach((m) => {
    check(!!s[m].voice, `${m} has a paired voice`, JSON.stringify(s[m].voice))
    check(s[m].voice && s[m].voice.src === `${m}.mp3`,
      `${m} voice is ${m}.mp3`, s[m].voice && s[m].voice.src)
    check(s[m].voice && s[m].voice.dur > 1,
      `${m} voice loaded`, s[m].voice && `${s[m].voice.dur}s rs=${s[m].voice.rs}`)
  })
  check(!s.watching.voice.paused, 'watching voice is playing',
    JSON.stringify(s.watching.voice))
  check(s.happy.voice.paused && s.angry.voice.paused,
    'only the shown mood is audible',
    `happy=${s.happy.voice.paused} angry=${s.angry.voice.paused}`)
  check(Math.abs(s.watching.voice.slip) <= 0.3,
    'watching voice sits on its picture', `slip ${s.watching.voice.slip}s`)
  // The clips are cut against these files frame for frame, so a length that
  // disagrees with the picture would put the mouth out by the difference.
  check(Math.abs(s.watching.voice.dur - s.watching.dur) < 0.2,
    'voice and clip are the same length',
    `voice ${s.watching.voice.dur}s vs clip ${s.watching.dur}s`)

  // 1 + 2. Ask for happy, let it get a second or two in, then ask again -- twice,
  // the way a run of clean landings would. currentTime must keep climbing.
  await page.evaluate(ask('happy'))
  await wait(1200)
  s = await page.evaluate(SNAP)
  check(s.shown === 'happy', 'happy takes the screen', `shown=${s.shown}`)
  check(!s.happy.paused, 'happy clip is playing', JSON.stringify(s.happy))
  // 5, 6, 7. The voice came with it, from the top, and the bed got out of the way.
  check(!s.happy.voice.paused, 'happy voice started with the clip',
    JSON.stringify(s.happy.voice))
  check(Math.abs(s.happy.voice.slip) <= 0.3, 'happy voice is in sync',
    `slip ${s.happy.voice.slip}s`)
  check(s.watching.voice.paused, 'watching bed stopped for the reaction',
    JSON.stringify(s.watching.voice))
  const t1 = s.happy.t

  await page.evaluate(ask('happy'))
  await wait(900)
  await page.evaluate(ask('happy'))
  await wait(900)
  s = await page.evaluate(SNAP)
  check(s.shown === 'happy', 'still happy after repeat requests', `shown=${s.shown}`)
  check(s.happy.t > t1 + 1.2,
    'repeated happy does NOT restart the clip',
    `t went ${t1} -> ${s.happy.t}, so it advanced ${(s.happy.t - t1).toFixed(2)}s`)

  // 3. Angry cuts in, mid-happy.
  await page.evaluate(ask('angry'))
  await wait(400)
  s = await page.evaluate(SNAP)
  check(s.shown === 'angry', 'angry cuts in over happy', `shown=${s.shown}`)
  check(!s.angry.paused && s.angry.t > 0, 'angry clip started from the top',
    JSON.stringify(s.angry))
  check(s.happy.paused && s.happy.t === 0, 'the happy it replaced was parked back',
    JSON.stringify(s.happy))
  // 7. The interrupting voice starts at the top of ITS clip, not from the
  // position the previous one had reached.
  check(!s.angry.voice.paused, 'angry voice cut in too', JSON.stringify(s.angry.voice))
  check(Math.abs(s.angry.voice.slip) <= 0.3, 'angry voice is in sync',
    `slip ${s.angry.voice.slip}s`)
  check(s.happy.voice.paused && s.happy.voice.t === 0,
    'the happy voice it replaced was rewound', JSON.stringify(s.happy.voice))

  // 4. Nothing outranks angry -- not happy, not a second angry.
  const tA = (await page.evaluate(SNAP)).angry.t
  await page.evaluate(ask('happy'))
  await wait(700)
  s = await page.evaluate(SNAP)
  check(s.shown === 'angry', 'happy cannot interrupt angry', `shown=${s.shown}`)
  await page.evaluate(ask('angry'))
  await wait(700)
  s = await page.evaluate(SNAP)
  check(s.shown === 'angry', 'still angry', `shown=${s.shown}`)
  check(s.angry.t > tA + 1.0, 'a second angry does NOT restart the clip',
    `t went ${tA} -> ${s.angry.t}`)

  // 1, the other half: it ends on its own, without being asked to.
  console.log(`      waiting out the rest of the ${dur}s clip...`)
  await wait(((dur - s.angry.t) * 1000) + 1200)
  s = await page.evaluate(SNAP)
  check(s.shown === 'watching', 'hands back to watching when the clip is done',
    `shown=${s.shown}`)
  check(s.angry.paused && s.angry.t === 0, 'angry parked again', JSON.stringify(s.angry))
  check(!s.watching.paused, 'watching resumed', JSON.stringify(s.watching))
  // And the voices handed back with them.
  check(s.angry.voice.paused && s.angry.voice.t === 0, 'angry voice stopped with its clip',
    JSON.stringify(s.angry.voice))
  check(!s.watching.voice.paused, 'watching voice resumed',
    JSON.stringify(s.watching.voice))
  check(Math.abs(s.watching.voice.slip) <= 0.3, 'watching voice back in sync',
    `slip ${s.watching.voice.slip}s`)

  // The keyer still has to work on the COMPRESSED clips -- low-bitrate ringing at
  // a white edge is exactly what could rot the near-white mask.
  const opaque = await page.evaluate(`(() => {
    const c = window.game.getInstance('customer', 'CUSTOMER_LAYER');
    const k = c.videos[c.shown].keyer;
    if (!k.ready) return -1;
    const d = k.outCtx.getImageData(0, 0, k.w, k.h).data;
    let on = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 128) on += 1;
    return +(on / (k.w * k.h)).toFixed(3);
  })()`)
  check(opaque > 0.25 && opaque < 0.75, 'keyer still keys the compressed clip',
    `opaque fraction ${opaque}`)

  check(errors.length === 0, 'no page errors', errors.join(' | '))

  await page.screenshot({ path: `.shots/reactions-${MODE}-end.png` })
  await browser.close()
  console.log(fails.length ? `\nFAIL (${fails.length}): ${fails.join(', ')}` : '\nPASS')
  process.exit(fails.length ? 1 : 0)
})()
