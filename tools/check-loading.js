/* Smoke-test the loading screen on both editions.
 *
 *     NODE_PATH="$(npm root -g)" node tools/check-loading.js
 *
 * Asserts the three things that are easy to break and invisible in a diff: no
 * request 404s, the bar actually reaches the button (PLAY visible, panel gone),
 * and the old red/GIF screen is really gone. Camera is granted so the blink
 * page's gate can close without waiting out its grace period.
 */
const { chromium } = require('playwright')

const BASE = 'http://localhost:8082'

async function check(path, label) {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    viewport: { width: 420, height: 760 },
    permissions: ['camera'],
  })
  const page = await ctx.newPage()

  // Only the game's own traffic counts. The analytics beacon is blocked in
  // headless Chromium and says nothing about whether an asset is missing.
  const mine = (url) => url.startsWith(BASE)
  const bad = []
  page.on('response', (r) => { if (r.status() >= 400 && mine(r.url())) bad.push(r.status() + ' ' + r.url()) })
  page.on('requestfailed', (r) => { if (mine(r.url())) bad.push('FAILED ' + r.url()) })

  await page.goto(BASE + path, { waitUntil: 'load' })

  let started = 'never'
  try {
    await page.waitForSelector('#start:not(.hide)', { timeout: 45000 })
    started = 'shown'
  } catch (e) { /* reported below */ }

  const state = await page.evaluate(() => ({
    panelShown: !!document.querySelector('.load-panel') &&
      getComputedStyle(document.querySelector('.load-panel')).display !== 'none',
    pct: (document.querySelector('.pct') || {}).textContent,
    fill: (document.querySelector('.fill') || {}).style?.width,
    gif: !!document.querySelector('img[src*="main-loading.gif"]'),
    red: getComputedStyle(document.querySelector('.loading')).backgroundColor,
    canvasShown: getComputedStyle(document.getElementById('canvas')).display !== 'none',
  }))

  console.log('--- ' + label + ' (' + path + ')')
  console.log('  PLAY button   :', started)
  console.log('  panel hidden  :', !state.panelShown)
  console.log('  bar reached   :', state.pct, state.fill)
  console.log('  gif gone      :', !state.gif)
  console.log('  loading bg    :', state.red)
  console.log('  canvas shown  :', state.canvasShown)
  console.log('  bad requests  :', bad.length ? bad.join('\n                  ') : 'none')

  await browser.close()
  return started === 'shown' && !state.panelShown && !state.gif && bad.length === 0
}

;(async () => {
  const tap = await check('/', 'tap edition')
  const blink = await check('/blink', 'blink edition')
  console.log('\n' + (tap && blink ? 'PASS' : 'FAIL'))
  process.exit(tap && blink ? 0 : 1)
})()
