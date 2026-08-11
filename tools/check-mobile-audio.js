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
  const beforeTap = await page.evaluate(() => {
    window.__audioProbe = { bgmPlay: 0, bgmPause: 0, overPlay: 0 }
    if (window.game.appleAudio) {
      return {
        mixer: true,
        context: window.game.appleAudio.context.state,
        playCounts: { ...window.game.appleAudio.playCounts }
      }
    }
    const bgm = window.game.getAudio('bgm')
    const over = window.game.getAudio('game-over')
    bgm.addEventListener('play', () => { window.__audioProbe.bgmPlay += 1 })
    bgm.addEventListener('pause', () => { window.__audioProbe.bgmPause += 1 })
    over.addEventListener('play', () => { window.__audioProbe.overPlay += 1 })
    return { mixer: false }
  })

  await page.tap('#start')
  await page.waitForFunction((ios) => {
    if (ios) {
      const mixer = window.game.appleAudio
      return mixer && mixer.context.state === 'running' && mixer.isPlaying('bgm')
    }
    const bgm = window.game.getAudio('bgm')
    return bgm && !bgm.paused && !bgm.muted && bgm.volume > 0
  }, IOS, { timeout: 5000 })
  await page.waitForTimeout(350)

  // At this point the player is still on the menu. On iOS the only sound that
  // may have started is BGM: this catches the old audible "silent warm-up" of
  // every landing and customer reaction sound.
  const menuState = await page.evaluate(() => {
    const mixer = window.game.appleAudio
    if (!mixer) return null
    const customer = window.game.getInstance('customer', 'CUSTOMER_LAYER')
    const playCounts = { ...mixer.playCounts }
    // The launch button has its own intentional click tick. Effects, game-over,
    // and customer voices must remain untouched until gameplay asks for them.
    const leaked = Object.keys(playCounts)
      .filter(name => name !== 'bgm' && name !== 'click' && playCounts[name] > 0)
    return {
      playCounts,
      leaked,
      customerMediaStarted: !!(customer && customer.mediaStarted),
      customerVideoElements: customer && customer.videos
        ? Object.keys(customer.videos).filter(mood => !!customer.videos[mood].el).length
        : -1
    }
  })

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
  await page.waitForFunction((ios) => {
    if (ios) {
      const mixer = window.game.appleAudio
      return mixer && (mixer.playCounts['game-over'] || 0) > 0 && mixer.isPlaying('game-over')
    }
    const audio = window.game.getAudio('game-over')
    // First play is the non-Apple silent unlock warm-up; the second is the cue.
    return window.__audioProbe.overPlay > 1 && audio && !audio.paused && !audio.muted && audio.volume > 0
  }, IOS, { timeout: 5000 })

  const result = await page.evaluate(() => {
    const mixer = window.game.appleAudio
    const bgm = window.game.getAudio('bgm')
    const over = window.game.getAudio('game-over')
    return {
      events: window.__audioProbe,
      unlocked: !!window.game._mediaUnlocked,
      mixer: !!mixer,
      mixerState: mixer ? mixer.context.state : '',
      mixerPlayCounts: mixer ? { ...mixer.playCounts } : {},
      bgmAudibleBeforeOver: mixer
        ? (mixer.playCounts.bgm || 0) > 0
        : window.__audioProbe.bgmPlay > 0,
      bgmStoppedForOver: mixer ? !mixer.isPlaying('bgm') : bgm.paused,
      overAudible: mixer
        ? mixer.isPlaying('game-over')
        : (!over.paused && !over.muted && over.volume > 0),
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
    && (IOS
      ? (result.appleMobile
        && beforeTap.mixer
        && Object.keys(beforeTap.playCounts).every(name => name === 'bgm')
        && menuState
        && menuState.leaked.length === 0
        && !menuState.customerMediaStarted
        && menuState.customerVideoElements === 0
        && result.mixerState === 'running'
        && result.mixerPlayCounts['game-over'] > 0)
      : result.events.overPlay > 1)
    && errors.length === 0
  console.log(JSON.stringify({ mode: IOS ? 'ios' : 'android', beforeTap, menuState, result, errors }, null, 2))
  console.log(ok ? 'PASS' : 'FAIL')
  process.exit(ok ? 0 : 1)
}

main()
