/*
 * Generate the UI click.
 *
 *     node tools/make-click-sfx.js
 *
 * Writes assets/click.mp3 — the tick every button in the page makes. Nothing
 * was sampled for this; it is synthesised, because a click has to be SHORT
 * (under a tenth of a second) and dead consistent, and trimming a recording
 * down that far leaves either a clipped attack or a tail of room noise.
 *
 * Three parts, in the order the ear hears them:
 *
 *   1. A 3 ms noise burst. This is the actual "click" — the transient. Without
 *      it the sound reads as a soft beep no matter how fast the envelope is.
 *      It is lowpassed hard: raw white noise sounds like a mouse click on a
 *      cheap keyboard, and this game is all rounded edges.
 *   2. A pitched body that glides DOWN from 1150 Hz to 720 Hz over its short
 *      life. The downward glide is what makes it read as something soft being
 *      tapped rather than as a UI beep; a fixed pitch sounds electronic.
 *   3. A quiet octave above the body, which gives the tick enough high end to
 *      survive over the music bed without having to be loud.
 *
 * The envelope is a fast exponential with a 1.5 ms attack. The attack matters:
 * starting at full amplitude on sample 0 puts a DC step in the file, which the
 * mp3 encoder smears into a thump.
 */
const fs = require('fs')
const path = require('path')
const vm = require('vm')

// The package main is the un-bundled source, whose modules reference each other
// through globals that only exist in the concatenated build. That build is a
// browser script — it hangs Mp3Encoder off `window` and exports nothing — so
// run it in a sandbox that provides a `window` and lift the encoder back out.
const sandbox = { console }
sandbox.window = sandbox
sandbox.self = sandbox
vm.createContext(sandbox)
vm.runInContext(
  fs.readFileSync(require.resolve('lamejs/lame.min'), 'utf8'),
  sandbox,
  { filename: 'lame.min.js' }
)
const lamejs = sandbox.lamejs || sandbox

const RATE = 44100
const MS = 95
const N = Math.round((RATE * MS) / 1000)

const TAU = Math.PI * 2
const lerp = (a, b, t) => a + ((b - a) * t)

// Deterministic noise: the same file every run, so rebuilding it does not
// silently change what players hear.
let seed = 0x9e3779b9
const rnd = () => {
  seed ^= seed << 13; seed >>>= 0
  seed ^= seed >> 17
  seed ^= seed << 5; seed >>>= 0
  return ((seed / 0xffffffff) * 2) - 1
}

const samples = new Float32Array(N)
let phase = 0
let phase2 = 0
// One-pole lowpass state for the noise burst.
let lp = 0
let lp2 = 0

for (let i = 0; i < N; i += 1) {
  const t = i / RATE
  const u = i / (N - 1)

  // Envelope: 1.5 ms attack, then exponential decay with a hard tail-out so
  // the file ends at true zero instead of being cut off part-way down.
  const attack = Math.min(1, t / 0.0015)
  const decay = Math.exp(-t * 46)
  const tailOut = Math.min(1, (1 - u) * 12)
  const env = attack * decay * tailOut

  // 1. transient
  const burst = Math.exp(-t * 900)
  lp += (rnd() - lp) * 0.22
  lp2 += (lp - lp2) * 0.22
  const noise = lp2 * burst * 3.4

  // 2. body, gliding down
  const f = lerp(1150, 720, Math.min(1, t / 0.045))
  phase += (TAU * f) / RATE
  const body = Math.sin(phase)

  // 3. octave sparkle, decaying faster than the body
  phase2 += (TAU * f * 2) / RATE
  const sparkle = Math.sin(phase2) * Math.exp(-t * 95) * 0.3

  const v = ((body + sparkle) * 0.75) + noise
  // Soft clip: keeps the transient's peak in range without the flat top that
  // hard clipping leaves, which mp3 turns into fizz.
  samples[i] = Math.tanh(v * env * 1.35)
}

// Normalise to a common peak with the rest of the sfx, then leave headroom.
let peak = 0
for (let i = 0; i < N; i += 1) peak = Math.max(peak, Math.abs(samples[i]))
const norm = peak > 0 ? 0.92 / peak : 1

const pcm = new Int16Array(N)
for (let i = 0; i < N; i += 1) {
  pcm[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * norm * 32767)))
}

const encoder = new lamejs.Mp3Encoder(1, RATE, 128)
const chunks = []
const BLOCK = 1152
for (let i = 0; i < pcm.length; i += BLOCK) {
  const buf = encoder.encodeBuffer(pcm.subarray(i, Math.min(i + BLOCK, pcm.length)))
  if (buf.length) chunks.push(Buffer.from(buf))
}
const tail = encoder.flush()
if (tail.length) chunks.push(Buffer.from(tail))

const out = path.join(__dirname, '..', 'assets', 'click.mp3')
fs.writeFileSync(out, Buffer.concat(chunks))
console.log(`${out}  ${MS}ms  ${fs.statSync(out).size} bytes`)
