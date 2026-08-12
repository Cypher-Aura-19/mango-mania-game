/* Does the pre-keyed atlas play a full reaction on phones?
 *
 * The complaint this checks for: on phones the happy/angry customer clips showed
 * a single frozen frame. The cause was runtime chroma-keying — each video frame
 * read back through a canvas to subtract the white — which on WebKit is
 * synchronous with the game loop, so the iOS path skipped video entirely and
 * drew one still. tools/make-customer-atlases.py now bakes that keying offline
 * into a sprite atlas per mood; the phone plays it as one drawImage of a grid
 * cell per frame, with zero keying at runtime.
 *
 * The reaction STATE MACHINE (want / PRIORITY / i.until / transitions) is shared
 * with the desktop video path that tools/check-reactions.js covers. This proves
 * it still holds when the picture backend is the atlas, and that the shown cell
 * actually advances. Driven with a synthetic clock so it is deterministic and
 * needs no audio unlock.
 *
 * Traps worth knowing (both cost a session already):
 *   - channel: 'chrome'. The bundled Chromium lacks H.264; this page ships MP4.
 *   - getInstance(name, layer): the customer lives on CUSTOMER_LAYER, so a bare
 *     getInstance('customer') finds nothing and looks like the feature is broken.
 *   - window.TowerGame is the bundle global; the page's `game` is a closure var,
 *     so we wrap the global to capture the engine the moment it is constructed.
 */
const { chromium, devices } = require('playwright')

const URL = process.env.URL || 'http://localhost:8082/'

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome' })
  // iPhone emulation gives the appleMobile profile — the case that used to show
  // one frozen still. Android (performanceMode) takes the same atlas path.
  const ctx = await browser.newContext({ ...devices['iPhone 13'] })
  const page = await ctx.newPage()

  const errors = []
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()) })

  await page.addInitScript(() => {
    let real
    Object.defineProperty(window, 'TowerGame', {
      configurable: true,
      get() { return real ? function (opt) { const g = real(opt); window.__game = g; return g } : undefined },
      set(v) { real = v }
    })
  })

  await page.goto(URL, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__game && window.__game.customerReady, null, { timeout: 20000 })
  await page.evaluate(() => window.__game.customerReady)

  const out = await page.evaluate(() => {
    const g = window.__game
    const opt = g.getVariable('GAME_USER_OPTION') || {}
    const inst = g.getInstance('customer', 'CUSTOMER_LAYER')
    const v = inst.videos
    const r = { checks: [], err: null }
    const ck = (ok, label, detail) => r.checks.push({ ok: !!ok, label, detail: detail || '' })

    ck(opt.appleMobile === true, 'profile is appleMobile (iOS)', 'apple=' + opt.appleMobile)
    ck(!!v.watching.atlas && !!v.happy.atlas && !!v.angry.atlas, 'all moods use an atlas')
    ck(!v.watching.el && !v.happy.el && !v.angry.el, 'no video decoder created')
    ck(v.happy.atlas.img.complete && v.happy.atlas.img.naturalWidth > 0, 'happy atlas image decoded')

    g.setVariable('GAME_START_NOW', true)
    const tick = (t) => { try { inst.action(inst, g, t) } catch (e) { r.err = String(e && e.message || e) } }
    const frame = (m) => v[m].atlas.frame
    const started = (m) => v[m].atlas.startedAt
    const dur = v.happy.atlas.count / v.happy.atlas.fps // 10s

    tick(1000) // init -> watching
    const w = []
    for (let t = 1000; t <= 1700; t += 33) { tick(t); w.push(frame('watching')) }
    ck(inst.shown === 'watching', 'starts on watching', 'shown=' + inst.shown)
    ck(new Set(w).size > 3, 'watching cell advances', new Set(w).size + ' distinct cells')
    const watchStart = started('watching')

    g.setVariable('CUSTOMER_MOOD', 'happy'); g.setVariable('CUSTOMER_MOOD_AT', 2000)
    tick(2000)
    ck(inst.shown === 'happy', 'happy takes the screen', 'shown=' + inst.shown)
    ck(frame('happy') === 0, 'happy starts on cell 0', 'frame=' + frame('happy'))
    const happyStart = started('happy')
    for (let t = 2033; t <= 4000; t += 33) tick(t)
    const fAt4 = frame('happy')
    ck(fAt4 > 0, 'happy cell advanced', 'frame=' + fAt4)

    g.setVariable('CUSTOMER_MOOD', 'happy'); g.setVariable('CUSTOMER_MOOD_AT', 4000)
    tick(4000); tick(4100)
    ck(inst.shown === 'happy' && started('happy') === happyStart,
      'repeated happy does not restart', 'startedAt ' + happyStart + '->' + started('happy'))
    ck(frame('happy') >= fAt4, 'happy keeps advancing after repeat', fAt4 + '->' + frame('happy'))

    g.setVariable('CUSTOMER_MOOD', 'angry'); g.setVariable('CUSTOMER_MOOD_AT', 5000)
    tick(5000)
    ck(inst.shown === 'angry', 'angry cuts in over happy', 'shown=' + inst.shown)
    ck(frame('angry') === 0, 'angry starts on cell 0', 'frame=' + frame('angry'))
    const angryStart = started('angry')
    for (let t = 5033; t <= 6000; t += 33) tick(t)

    g.setVariable('CUSTOMER_MOOD', 'happy'); g.setVariable('CUSTOMER_MOOD_AT', 6000)
    tick(6000); tick(6100)
    ck(inst.shown === 'angry', 'happy cannot interrupt angry', 'shown=' + inst.shown)

    g.setVariable('CUSTOMER_MOOD', 'angry'); g.setVariable('CUSTOMER_MOOD_AT', 7000)
    tick(7000); tick(7100)
    ck(started('angry') === angryStart, 'second angry does not restart',
      'startedAt ' + angryStart + '->' + started('angry'))

    for (let t = 7133; t <= angryStart + (dur * 1000) + 300; t += 33) tick(t)
    ck(inst.shown === 'watching', 'hands back to watching when the clip is done',
      'shown=' + inst.shown + ' after ' + dur + 's')
    // The idle loop must pick up where it left off, not snap to frame 0 — the
    // watching clock is set once and left running, like the paused/resumed video.
    ck(started('watching') === watchStart, 'watching loop was not restarted on hand-back',
      'startedAt ' + watchStart + '->' + started('watching'))

    return r
  })

  let fails = 0
  out.checks.forEach((c) => {
    console.log(`${c.ok ? 'ok  ' : 'FAIL'}  ${c.label}${c.detail ? '  -- ' + c.detail : ''}`)
    if (!c.ok) fails++
  })
  if (out.err) { console.log('THREW: ' + out.err); fails++ }
  console.log('PAGE ERRORS:', errors.length ? errors : 'none')
  if (errors.length) fails++
  console.log(fails ? `\nFAIL (${fails})` : '\nPASS')
  await browser.close()
  process.exit(fails ? 1 : 0)
})()
