/* Smoke-test the customer's reaction videos.
 *
 *     NODE_PATH="$(npm root -g)" node tools/check-customer.js
 *     NODE_PATH="$(npm root -g)" node tools/check-customer.js https://mango-mania-game.vercel.app
 *
 * The customer is three <video> clips keyed against their white background at
 * runtime (src/customer.js), and every part of that is invisible in a diff: a
 * clip that never decodes, a keyer that never sizes, a mood that never changes,
 * a sprite parked off screen. So the run below actually plays: it walks the
 * title -> mode -> profile screens into a real game, drops layers, and reads the
 * instance's own state back out of the engine.
 *
 * Real Chrome, not the bundled Chromium: the clips are H.264 and Playwright's
 * Chromium ships without proprietary codecs, so there it would report a broken
 * video and be right about its own build and wrong about the game.
 *
 * Note the layer argument on getInstance. cooljs looks in the DEFAULT layer
 * unless told otherwise, and the customer is on their own layer so they paint in
 * front of the tower -- so a bare getInstance('customer') finds nothing and
 * looks exactly like the feature being broken.
 */
const { chromium } = require('playwright')

const BASE = (process.argv[2] || 'http://localhost:8082').replace(/\/$/, '')
const LAYER = 'CUSTOMER_LAYER'

async function launch() {
  try {
    return { browser: await chromium.launch({ channel: 'chrome' }), real: true }
  } catch (e) {
    return { browser: await chromium.launch(), real: false }
  }
}

// Read the instance out of the engine. Nothing observable from outside can say
// whether the keyer ever produced a frame or where the sprite actually sits.
const peek = page => page.evaluate((layer) => {
  const g = window.game
  const i = g && g.getInstance('customer', layer)
  if (!i) return { missing: true }
  const cur = i.videos && i.videos[i.shown]
  return {
    ready: !!i.ready,
    shown: i.shown,
    mood: g.getVariable('CUSTOMER_MOOD'),
    x: Math.round(i.x),
    y: Math.round(i.y),
    w: Math.round(i.w),
    h: Math.round(i.h),
    fade: i.fade,
    fitted: !!i.fitted,
    keyed: !!(cur && cur.keyer.ready),
    canvasW: g.width,
    canvasH: g.height,
    colLeft: g.getVariable('PLAY_LEFT'),
    colWidth: g.getVariable('PLAY_WIDTH'),
    clips: Object.keys(i.videos).map((m) => {
      const v = i.videos[m].el
      return {
        m,
        rs: v.readyState,
        playing: !v.paused,
        wh: v.videoWidth + 'x' + v.videoHeight,
        err: v.error ? v.error.code : null
      }
    })
  }
}, LAYER)

async function main() {
  const { browser, real } = await launch()
  if (!real) console.log('! Chrome not found - using bundled Chromium (no H.264)')
  const ctx = await browser.newContext({ viewport: { width: 420, height: 760 } })
  const page = await ctx.newPage()
  const bad = []
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().startsWith(BASE)) bad.push(r.status() + ' ' + r.url())
  })
  page.on('pageerror', e => bad.push('JS ' + String(e).slice(0, 120)))

  await page.goto(BASE + '/', { waitUntil: 'load' })
  await page.waitForSelector('#start:not(.hide)', { timeout: 45000 })

  /* Every clip should be decodable by the time the button appears -- that is the
   * whole point of folding them into the loading gate, so check it AT the gate
   * rather than later when it would have had time to catch up. */
  const gate = await page.evaluate((layer) => {
    const i = window.game.getInstance('customer', layer)
    return i && i.videos
      ? Object.keys(i.videos).map(m => m + '=' + i.videos[m].el.readyState).join(' ')
      : 'no instance'
  }, LAYER)
  console.log('--- clips at PLAY :', gate)

  // Title -> mode -> profile -> playing.
  await page.click('#start')
  await page.waitForTimeout(600)
  await page.click('.mode-pick[data-mode="tap"]')
  await page.waitForTimeout(700)
  await page.fill('#player-name', 'Probe')
  await page.click('#profile-go')
  await page.waitForTimeout(1800)

  const before = await peek(page)
  if (before.missing) {
    console.log('customer instance missing\nFAIL')
    await browser.close()
    process.exit(1)
  }
  console.log('--- watching')
  console.log('  clips        :', before.clips.map(c => `${c.m} rs=${c.rs} ${c.playing ? 'play' : 'PAUSED'} ${c.wh}${c.err ? ' ERR' + c.err : ''}`).join(' | '))
  await page.screenshot({ path: '.shots/customer-watching.png' })

  /* Drop layers and watch the mood. Whatever the landings actually score, the
   * customer has to leave 'watching' at least once or the reaction path is dead;
   * polling `shown` rather than the variable catches it even when the reaction
   * has already lapsed by the time the drop settles.
   *
   * Stops the moment the run ends. Three missed drops is an ordinary outcome for
   * a script aiming at a fixed point, and the summary card that follows has
   * buttons under the same coordinates -- one more click there reloads the page
   * out from under everything below. */
  const moods = new Set()
  const over = () => page.evaluate(() => !!window.game.getVariable('GAME_OVER'))
  const poll = async (n) => {
    for (let t = 0; t < n; t += 1) {
      /* eslint-disable no-await-in-loop */
      const s = await page.evaluate((layer) => {
        const i = window.game.getInstance('customer', layer)
        return i ? i.shown : null
      }, LAYER)
      if (s) moods.add(s)
      await page.waitForTimeout(70)
    }
  }
  let drops = 0
  for (let n = 0; n < 8; n += 1) {
    if (await over()) break
    await page.mouse.click(210, 520)
    drops += 1
    await poll(14)
  }

  const after = await peek(page)
  console.log('--- after ' + drops + ' drops')
  console.log('  moods seen   :', Array.from(moods).sort().join(', ') || 'none')
  await page.screenshot({ path: '.shots/customer-after.png' })

  /* Then drive both reactions directly. A run of eight scripted drops may never
   * happen to earn one, and "the clip the mechanic asks for is the clip that
   * gets keyed and drawn" is the part of this worth asserting on its own -- the
   * dissolve included, since a fade stuck at 0 would leave the customer as a
   * ghost forever. Only meaningful while the run is live: the scene freezes on
   * game over and the action stops reading the variable at all. */
  const forced = {}
  if (!await over()) {
    /* eslint-disable no-restricted-syntax */
    for (const mood of ['happy', 'angry']) {
      await page.evaluate((m) => {
        window.game.setVariable('CUSTOMER_MOOD', m)
        window.game.setVariable('CUSTOMER_MOOD_AT', window.game.getVariable('GAME_TIME', 0))
      }, mood)
      // Long enough for the dissolve (160ms) to finish, short enough to be well
      // inside the 1.5s a reaction holds.
      await page.waitForTimeout(500)
      forced[mood] = await page.evaluate((layer) => {
        const i = window.game.getInstance('customer', layer)
        const cur = i.videos[i.shown]
        return { shown: i.shown, fade: i.fade, keyed: !!cur.keyer.ready }
      }, LAYER)
      await page.screenshot({ path: `.shots/customer-${mood}.png` })
    }
  }
  console.log('--- forced reactions')
  Object.keys(forced).forEach(m => console.log(
    `  asked ${m.padEnd(8)} -> shown=${forced[m].shown} keyed=${forced[m].keyed} fade=${forced[m].fade}`
  ))

  /* The checks worth failing on. `rides` is the one that catches the sprite
   * being pinned to the world instead of tracking the tower top -- which moves
   * UP the screen (smaller y) as floors land. */
  const inColumn = after.x >= after.colLeft - 2
    && (after.x + after.w) <= after.colLeft + after.colWidth + 2
  const onScreen = after.y >= 0 && (after.y + after.h) <= after.canvasH
  const rides = after.y <= before.y + 1
  // Either route counts: a landing that earned a reaction, or the mechanic's own
  // request being honoured. Both exercise the same switch.
  const reacted = moods.has('happy') || moods.has('angry')
    || Object.keys(forced).every(m => forced[m].shown === m)
  const faded = Object.keys(forced).every(m => forced[m].fade >= 1 && forced[m].keyed)
  /* Every clip decoded, and the one being SHOWN actually running. The other two
   * are expected to be paused now: a reaction is parked on its first frame until
   * it is asked for, so that it never has to rewind at the moment it is wanted.
   * See the play-through rules in src/customer.js, and tools/check-reactions.js
   * for the test that covers them. */
  const clipsOk = after.clips.every(c => c.rs >= 3 && !c.err)
    && after.clips.some(c => c.m === after.shown && c.playing)

  console.log('--- assertions')
  console.log('  instance live :', after.ready)
  console.log('  clips decoded :', clipsOk)
  console.log('  box fitted    :', after.fitted, `${after.w}x${after.h}`)
  console.log('  keyer running :', after.keyed)
  console.log('  inside column :', inColumn, `x=${after.x} col=${after.colLeft}..${after.colLeft + after.colWidth}`)
  console.log('  on screen     :', onScreen, `y=${after.y} h=${after.h} canvas=${after.canvasH}`)
  console.log('  rides tower   :', rides, `${before.y} -> ${after.y}`)
  console.log('  mood switches :', reacted)
  console.log('  dissolve done :', faded)
  console.log('  bad requests  :', bad.length ? bad.join(', ') : 'none')

  await browser.close()
  const ok = after.ready && clipsOk && after.fitted && after.keyed
    && inColumn && onScreen && rides && reacted && faded && !bad.length
  console.log(ok ? '\nPASS' : '\nFAIL')
  process.exit(ok ? 0 : 1)
}

main()
