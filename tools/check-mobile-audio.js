/* Regression test for the mobile audio-unlock race.
 *
 * Chromium is launched with autoplay requiring a gesture. The first tap must
 * leave BGM playing (the old bulk warm-up paused it after the tap), and a later
 * real-gesture game-over request must remain audible. Run with IOS=1 to exercise
 * the Apple-specific application path as well. */
const { chromium } = require('playwright')

const BASE = (process.argv[2] || 'http://localhost:8082').replace(/\/$/, '')
const IOS = process.env.IOS === '1'

async function main() {
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--autoplay-policy=user-gesture-required']
  })
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
  page.on('pageerror', error => errors.push(String(error)))
  await page.goto(BASE, { waitUntil: 'load' })
  await page.waitForSelector('#start:not(.hide)', { timeout: 45000 })
  await page.evaluate(() => {
    window.__audioProbe = { bgmPlay: 0, bgmPause: 0, overPlay: 0 }
    const bgm = window.game.getAudio('bgm')
    const over = window.game.getAudio('game-over')
    bgm.addEventListener('play', () => { window.__audioProbe.bgmPlay += 1 })
    bgm.addEventListener('pause', () => { window.__audioProbe.bgmPause += 1 })
    over.addEventListener('play', () => { window.__audioProbe.overPlay += 1 })
  })

  await page.tap('#start')
  await page.waitForFunction(() => {
    const audio = window.game.getAudio('bgm')
    return audio && !audio.paused && !audio.muted && audio.volume > 0
  }, null, { timeout: 5000 })
  await page.waitForTimeout(350)

  // Invoke the exact game-over audio sequence from a trusted gesture.
  await page.evaluate(() => {
    const button = document.createElement('button')
    button.id = 'audio-probe-over'
    button.style.cssText = 'position:fixed;left:0;top:0;width:80px;height:80px;z-index:99999'
    button.addEventListener('click', () => {
      window.game.pauseAudio('bgm')
      window.game.playAudio('game-over')
    })
    document.body.appendChild(button)
  })
  await page.tap('#audio-probe-over')
  await page.waitForFunction(() => {
    const audio = window.game.getAudio('game-over')
    // First play is the silent unlock warm-up; the second is the real cue.
    return window.__audioProbe.overPlay > 1 && audio && !audio.paused && !audio.muted && audio.volume > 0
  }, null, { timeout: 5000 })

  const result = await page.evaluate(() => {
    const bgm = window.game.getAudio('bgm')
    const over = window.game.getAudio('game-over')
    return {
      events: window.__audioProbe,
      unlocked: !!window.game._mediaUnlocked,
      bgmAudibleBeforeOver: window.__audioProbe.bgmPlay > 0,
      bgmStoppedForOver: bgm.paused,
      overAudible: !over.paused && !over.muted && over.volume > 0,
      bgmReady: bgm.readyState,
      overReady: over.readyState,
      appleMobile: !!(window.game.getVariable('GAME_USER_OPTION') || {}).appleMobile
    }
  })
  await browser.close()

  const ok = result.unlocked
    && result.bgmAudibleBeforeOver
    && result.bgmStoppedForOver
    && result.overAudible
    && result.events.overPlay > 1
    && (!IOS || result.appleMobile)
    && errors.length === 0
  console.log(JSON.stringify({ mode: IOS ? 'ios' : 'android', result, errors }, null, 2))
  console.log(ok ? 'PASS' : 'FAIL')
  process.exit(ok ? 0 : 1)
}

main()
