/*
 * Generate the customer's three reactions.
 *
 *     node tools/make-customer-sfx.js
 *
 * Writes assets/react-happy.mp3, assets/react-ok.mp3, assets/react-angry.mp3 —
 * one per face on the satisfaction gauge (reaction-3, -2, -1), voiced when the
 * lit face changes. See satisfactionLevels in constant.js.
 *
 * These are WORDLESS on purpose. The game is played in more than one language
 * and a spoken "nice!" would date and localise badly, where a chirp, a hum and
 * a squeaky grumble read the same to everybody.
 *
 * They are formant-synthesised rather than sampled. A voice is a buzzing source
 * shaped by a few resonances in the throat and mouth, so: a glottal pulse train
 * at the pitch, through three resonators parked on the vowel's formants. Moving
 * those formants during the clip is what makes it a MOUTH rather than an organ —
 * every clip here glides from one vowel shape to another, because a held vowel
 * with fixed formants is instantly recognisable as a synthesiser.
 *
 * CUTE, specifically. The first pass voiced an adult: an "ooh" at 232 Hz, a
 * chest hum, and a genuine growl. It was convincing and it was wrong — the
 * customers are round cartoon faces, and a real grown man grumbling at them
 * plays as menace rather than as a customer who wanted a tidier cake. So every
 * clip here is a small character instead. What makes that read:
 *
 *   pitch    roughly an octave up (child/chipmunk register, 330-620 Hz), which
 *            also lifts the formants — a small head is a small resonator
 *   shape    every clip BENDS, none hold. A flat pitch at any height sounds
 *            like a tone; the bend is what sounds like a person
 *   ends     short, with quick fades, so they land inside the gap between two
 *            block drops instead of trailing under the next one
 *   no growl `rough` is gone entirely. Subharmonics are the sound of a big
 *            throat, and they are what made the old angry one scary
 *
 * Nothing here needs to be mistaken for a recording. It needs to read as a
 * small character reacting, over music, in a fifth of a second.
 */
const {
  lerp, clamp01, noise, lowpass, resonator, pulseTrain, fadeEnds,
  normalise, write, render
} = require('./sfx-lib')

/* One voice: pitch contour + vowel contour. `vow` returns [F1, F2, F3] for a
 * position through the clip, so a glide is just interpolation between targets.
 *
 * `sparkle` is the cute dial. It mixes in a quiet octave above the fundamental,
 * which is what a small resonant head does to a voice — the harmonic is already
 * there, a child's is just louder relative to the rest. Cheaper and steadier
 * than raising the formants further, which starts to sound like a kazoo.
 */
const voice = (opts) => {
  const {
    ms, f0, vowel, sparkle = 0, breath = 0.05, vib = 0.02, seed = 0x9e3779b9,
    fadeIn = 22, fadeOut = 60, env = u => Math.sin(Math.PI * clamp01(u)) ** 0.7
  } = opts
  const rnd = noise(seed)
  const glottis = pulseTrain()
  const upper = pulseTrain()
  const r1 = resonator(9)
  const r2 = resonator(11)
  const r3 = resonator(13)
  const br = resonator(2)
  const lp = lowpass()
  return render(ms, (t, u) => {
    // Pitch: the contour plus a light vibrato. No random walk — jitter is what
    // makes a voice sound worn, and none of these three are.
    const pitch = f0(u) * (1 + (vib * Math.sin(t * 38)))
    const src = glottis(pitch) + (sparkle * upper(pitch * 2))

    const [F1, F2, F3] = vowel(u)
    const shaped = (r1(src, F1) * 1.0) +
      (r2(src, F2) * 0.62) +
      (r3(src, F3) * 0.28)

    // A little air through the same mouth shape, so the onset is a breath.
    const air = br(rnd(), F2) * breath * (1 - (u * 0.5))

    // Lighter lowpass than the adult voices used: at this pitch the harmonics
    // that carry "small" all live up top, and rolling them off dulls the whole
    // effect back into a hum.
    const v = lp(shaped + air, 0.82) * env(u)
    return Math.tanh(v * 3.2) * fadeEnds(u, fadeIn, fadeOut, ms)
  })
}

/* --------------------------------------------------------------- happy -----
 * "Wee-ee!" — a bright chirp that jumps a fifth, dips, then flicks up again on
 * the way out. That final flick is the whole character: a single rise reads as
 * a question, where rise-dip-rise reads as delight. Mouth opens from a rounded
 * /u/ into a wide /i/, which is a smile, physically.
 */
write('react-happy.mp3', normalise(voice({
  ms: 380,
  seed: 0x1b873593,
  f0: (u) => {
    if (u < 0.34) return lerp(430, 640, u / 0.34)          // leap up
    if (u < 0.68) return lerp(640, 560, (u - 0.34) / 0.34)  // small dip
    return lerp(560, 700, (u - 0.68) / 0.32)                // flick
  },
  vowel: u => [
    lerp(330, 420, clamp01(u / 0.5)),
    lerp(980, 2450, clamp01(u / 0.6)),
    lerp(2700, 3150, u)
  ],
  sparkle: 0.34,
  vib: 0.03,
  breath: 0.05,
  fadeOut: 55,
  env: u => Math.sin(Math.PI * clamp01(u)) ** 0.5
}), 0.9), 112)

/* ------------------------------------------------------------------ ok -----
 * "Mm-hm?" Mouth closed the whole way, so F1 stays low and F2 is damped: a
 * nasal hum, barely a reaction at all — which is the point of the middle face.
 * Shortest and quietest of the three, and the only one that ends UP, because a
 * neutral customer is not satisfied, just not complaining yet.
 */
write('react-ok.mp3', normalise(voice({
  ms: 300,
  seed: 0xcc9e2d51,
  f0: u => (u < 0.55
    ? lerp(360, 335, u / 0.55)
    : lerp(335, 395, (u - 0.55) / 0.45)),
  vowel: u => [lerp(300, 285, u), lerp(1180, 1320, u), 2600],
  sparkle: 0.18,
  vib: 0.018,
  breath: 0.02,
  fadeIn: 35,
  fadeOut: 80
}), 0.78), 96)

/* --------------------------------------------------------------- angry -----
 * "Aww-w." A small squeaky grumble: pitch sags a third, mouth pulls back from
 * an open /a/ to a pinched /ɜ/, and a slow wide wobble sits on top of it. The
 * wobble is doing the work the old growl's subharmonic did — it says something
 * is wrong — without the chest that made it read as a threat.
 *
 * Still the longest of the three, because a complaint takes longer to say than
 * approval, but a third shorter than the growl it replaces.
 */
write('react-angry.mp3', normalise(voice({
  ms: 420,
  seed: 0x27d4eb2f,
  f0: u => lerp(400, 300, u ** 0.7),
  vowel: u => [
    lerp(720, 480, u),
    lerp(1450, 1080, u),
    lerp(2600, 2400, u)
  ],
  sparkle: 0.22,
  vib: 0.055,
  breath: 0.06,
  fadeOut: 95,
  env: u => Math.sin(Math.PI * clamp01(u)) ** 0.75
}), 0.9), 112)
