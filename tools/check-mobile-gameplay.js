/* Mobile regression test for frame-rate-independent falling and audio unlock.
 * Uses a 3x DPR touch viewport, then compares a normal run with 6x CPU
 * throttling. A cake must remain in DROP before vertical contact, land exactly
 * on the collision line, and play its fall/land effects on mobile. */
const { chromium } = require('playwright')

const BASE = (process.argv[2] || 'http://localhost:8082').replace(/\/$/, '')
const IOS = process.env.IOS === '1'

async function run(rate) {
  const browser = await chromium.launch({ channel: 'chrome' })
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: IOS
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
      : undefined
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto(BASE, { waitUntil: 'load' })
  await page.waitForSelector('#start:not(.hide)', { timeout: 45000 })
  await page.tap('#start')
  await page.waitForTimeout(1100)
  await page.tap('.mode-pick[data-mode="tap"]')
  await page.waitForTimeout(700)
  await page.fill('#player-name', 'MobileProbe')
  await page.tap('#profile-go')
  await page.waitForFunction(() => window.game && window.game.getVariable('GAME_START_NOW'), null, { timeout: 10000 })
  await page.waitForTimeout(700)

  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate })
  await page.evaluate(() => {
    window.__mobileAudio = { fall: 0, land: 0 }
    window.game.getAudio('fall').addEventListener('play', () => { window.__mobileAudio.fall += 1 })
    window.game.getAudio('land').addEventListener('play', () => { window.__mobileAudio.land += 1 })
  })
  const started = Date.now()
  await page.touchscreen.tap(195, 500)
  await page.waitForTimeout(60)
  const mid = await page.evaluate(() => {
    const g = window.game
    const b = g.getInstance('block_' + g.getVariable('BLOCK_COUNT'))
    const line = g.getInstance('line')
    const fall = g.getAudio('fall')
    return {
      status: b.status,
      clearOfTarget: b.status === 'DROP' ? b.y + b.height < line.y : true,
      audioUnlocked: !!g._mediaUnlocked,
      fallAudible: !!fall && !fall.muted && fall.volume > 0
    }
  })
  await page.waitForFunction(() => {
    const g = window.game
    const b = g.getInstance('block_' + g.getVariable('BLOCK_COUNT'))
    return b && b.status === 'LAND'
  }, null, { timeout: 5000 })
  const landed = await page.evaluate(() => {
    const g = window.game
    const b = g.getInstance('block_' + g.getVariable('BLOCK_COUNT'))
    const line = g.getInstance('line')
    const land = g.getAudio('land')
    const customer = g.getInstance('customer', 'CUSTOMER_LAYER')
    const watching = customer && customer.videos.watching
    const option = g.getVariable('GAME_USER_OPTION') || {}
    return {
      gap: Math.abs(b.y - line.y),
      dropElapsed: g.getVariable('GAME_TIME') - b.dropBeganAt,
      fallPlayed: window.__mobileAudio.fall > 0,
      landPlayed: window.__mobileAudio.land > 0,
      landAudible: !!land && !land.muted && land.volume > 0,
      appleMobile: !!option.appleMobile,
      customerCodec: watching ? (watching.el.currentSrc || watching.el.src).split('.').pop() : '',
      keyInterval: watching ? Math.round(watching.keyer.keyInterval) : 0,
      keyLong: watching ? watching.keyer.keyedLong : 0
    }
  })
  const duration = Date.now() - started
  await browser.close()
  return { rate, duration, mid, landed, errors }
}

async function main() {
  const normal = await run(1)
  const throttled = await run(4)
  const results = [normal, throttled]
  results.forEach(r => console.log(
    `${r.rate}x CPU: ${r.duration}ms`, JSON.stringify({ mid: r.mid, landed: r.landed, errors: r.errors })
  ))
  const motionStable = Math.abs(throttled.landed.dropElapsed - normal.landed.dropElapsed) < 180
  const ok = results.every(r => r.mid.status === 'DROP'
    || r.mid.status === 'LAND')
    && results.every(r => r.mid.clearOfTarget
    && r.mid.audioUnlocked
    && r.mid.fallAudible
    && r.landed.gap <= 1
    && r.landed.dropElapsed > 350
    && r.landed.fallPlayed
    && r.landed.landPlayed
    && r.landed.landAudible
    && (!IOS || (r.landed.appleMobile
      && r.landed.customerCodec.indexOf('mp4') === 0
      && r.landed.keyInterval >= 160
      && r.landed.keyLong === 144))
    && !r.errors.length) && motionStable
  console.log('frame-time stable:', motionStable)
  console.log(ok ? 'PASS' : 'FAIL')
  process.exit(ok ? 0 : 1)
}

main()
