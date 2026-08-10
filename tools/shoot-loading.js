/* Shoot the loading screen mid-load and at rest, on both editions.
 *
 *     NODE_PATH="$(npm root -g)" node tools/shoot-loading.js
 *
 * Writes /tmp/load-<edition>-<mid|done>.png. The mid shot is taken on a
 * throttled connection, because at localhost speed the bar is gone before it
 * can be photographed and the whole point is how it looks while it is filling.
 */
const { chromium } = require('playwright')

const BASE = 'http://localhost:8082'
const SHOTS = require('path').join(__dirname, '..', '.shots', 'load-')

async function shoot(path, label) {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    viewport: { width: 420, height: 760 },
    permissions: ['camera'],
  })
  const page = await ctx.newPage()

  // Throttle so the bar is caught partway rather than already full.
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: 40, downloadThroughput: 700 * 1024, uploadThroughput: 700 * 1024,
  })

  page.goto(BASE + path, { waitUntil: 'load' }).catch(() => {})
  await page.waitForTimeout(2600)
  await page.screenshot({ path: SHOTS + label + '-mid.png' })

  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
  })
  await page.waitForSelector('#start:not(.hide)', { timeout: 60000 }).catch(() => {})
  await page.waitForTimeout(400)
  await page.screenshot({ path: SHOTS + label + '-done.png' })

  console.log('shot ' + label)
  await browser.close()
}

;(async () => {
  await shoot('/', 'tap')
  await shoot('/blink', 'blink')
})()
