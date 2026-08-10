/*
 * Shared bones for the synthesised sound effects.
 *
 * make-click-sfx.js came first and carries its own copy of all of this. It is
 * left alone on purpose: it produces a file players already hear, and there is
 * no reason to risk changing that byte-for-byte. Everything written after it
 * builds on this module instead.
 *
 * Why synthesise at all: these clips have to be tiny, seamless at the loop-ish
 * repeats (the rope creak fires twice a swing, the landing thud once a floor),
 * and licence-clean. A synthesised clip is also DETERMINISTIC — the noise runs
 * off a seeded xorshift, so re-running a tool cannot silently change what the
 * game sounds like.
 */
const fs = require('fs')
const path = require('path')
const vm = require('vm')

/* The lamejs package main is un-bundled source whose modules reach for each
 * other through globals that only exist in the concatenated build. That build is
 * a browser script — it hangs Mp3Encoder off `window` and exports nothing — so
 * run it in a sandbox that supplies a `window` and lift the encoder back out. */
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
const TAU = Math.PI * 2

const lerp = (a, b, t) => a + ((b - a) * t)
const clamp01 = t => Math.max(0, Math.min(1, t))

// Deterministic white noise. Seeded per caller so two noise beds in the same
// clip are not the identical sequence, which would phase-lock and sound tonal.
const noise = (seedInit = 0x9e3779b9) => {
  let seed = seedInit >>> 0
  return () => {
    seed ^= seed << 13; seed >>>= 0
    seed ^= seed >> 17
    seed ^= seed << 5; seed >>>= 0
    return ((seed / 0xffffffff) * 2) - 1
  }
}

// One-pole lowpass with the coefficient passed in per sample, so a sweep is
// just a changing k rather than a filter rebuild.
const lowpass = () => {
  let y = 0
  return (x, k) => {
    y += (x - y) * k
    return y
  }
}

/* Two-pole resonator: y = g·x + c·y₋₁ + d·y₋₂.
 *
 * This is the one filter both new tools lean on. Fed noise it rings at `freq`
 * with a bandwidth set by `q`, which is what turns a hiss into a creak; fed a
 * pulse train it becomes a vocal formant, which is what turns a buzz into a
 * voice. `q` here is freq/bandwidth, so bigger = narrower = more pitched.
 *
 * The centre frequency is a per-sample ARGUMENT, not a constructor parameter,
 * because nothing here holds still: the whoosh sweeps its band down as the cake
 * accelerates, and a vowel is a pair of formants gliding from one target to
 * another — a fixed-frequency filter would make both read as machinery.
 *
 * Scaled by (1 - r) to keep the ringing roughly level-matched across the sweep;
 * exact gain does not matter because every clip is normalised before encoding.
 */
const resonator = (q) => {
  let y1 = 0
  let y2 = 0
  return (x, freq) => {
    const r = Math.exp((-Math.PI * (freq / q)) / RATE)
    const c = 2 * r * Math.cos((TAU * freq) / RATE)
    const y = ((1 - r) * x) + (c * y1) - (r * r * y2)
    y2 = y1
    y1 = y
    return y
  }
}

// Band-limited-ish glottal pulse: a saw whose harmonics are already soft enough
// that the formant filters do the shaping rather than fighting aliasing.
const pulseTrain = () => {
  let ph = 0
  return (freq) => {
    ph += freq / RATE
    if (ph >= 1) ph -= 1
    // Saw folded into a rounded pulse — closer to a glottal flow derivative
    // than a raw ramp, so the vowels below read as breath, not as a synth.
    const saw = (2 * ph) - 1
    return saw - (saw ** 3 * 0.33)
  }
}

// Every clip ends at true zero. A file that stops part-way down its decay gets
// a click on the cut, and the mp3 encoder smears that into a thump.
const fadeEnds = (u, inMs, outMs, ms) => Math.min(
  1,
  Math.max(0, (u * ms) / Math.max(0.001, inMs)),
  Math.max(0, ((1 - u) * ms) / Math.max(0.001, outMs))
)

const normalise = (samples, peakTarget = 0.92) => {
  let peak = 0
  for (let i = 0; i < samples.length; i += 1) peak = Math.max(peak, Math.abs(samples[i]))
  const norm = peak > 0 ? peakTarget / peak : 1
  for (let i = 0; i < samples.length; i += 1) samples[i] *= norm
  return samples
}

const write = (name, samples, kbps = 128) => {
  const pcm = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i += 1) {
    pcm[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767)))
  }
  const encoder = new lamejs.Mp3Encoder(1, RATE, kbps)
  const chunks = []
  const BLOCK = 1152
  for (let i = 0; i < pcm.length; i += BLOCK) {
    const buf = encoder.encodeBuffer(pcm.subarray(i, Math.min(i + BLOCK, pcm.length)))
    if (buf.length) chunks.push(Buffer.from(buf))
  }
  const tail = encoder.flush()
  if (tail.length) chunks.push(Buffer.from(tail))
  const out = path.join(__dirname, '..', 'assets', name)
  fs.writeFileSync(out, Buffer.concat(chunks))
  const ms = Math.round((samples.length / RATE) * 1000)
  console.log(`${name}  ${ms}ms  ${fs.statSync(out).size} bytes`)
}

// Build one clip: `ms` long, `fn(t, u, i)` returns a sample in roughly -1..1.
const render = (ms, fn) => {
  const n = Math.round((RATE * ms) / 1000)
  const samples = new Float32Array(n)
  for (let i = 0; i < n; i += 1) samples[i] = fn(i / RATE, i / (n - 1), i)
  return samples
}

module.exports = {
  RATE, TAU, lerp, clamp01, noise, lowpass, resonator, pulseTrain,
  fadeEnds, normalise, write, render
}
