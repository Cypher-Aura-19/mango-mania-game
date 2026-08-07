/*
 * Generates the mango-cream sprinkle sprites used by the tower blocks.
 *
 *   node generate-cream.js
 *
 * Writes assets/cream-1.png … cream-4.png — four creamy mango droplet
 * variants (round blob, teardrop, capsule sprinkle, small dot). Each is
 * shaded with a vertical cream->mango gradient, a gloss highlight and a
 * darker rim so it reads as glossy cream rather than a flat shape.
 */
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

/* ---------- minimal RGBA PNG encoder ---------- */

const crcTable = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    t[n] = c
  }
  return t
})()

const crc32 = (buf) => {
  let c = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

const encodePNG = (w, h, rgba) => {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  let p = 0
  for (let y = 0; y < h; y += 1) {
    raw[p] = 0 // filter: none
    p += 1
    rgba.copy(raw, p, y * w * 4, (y + 1) * w * 4)
    p += w * 4
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 6   // colour type: RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/* ---------- signed distance helpers (units = fraction of sprite size) ---------- */

const sdCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r

const sdEllipse = (px, py, cx, cy, rx, ry) => {
  // Cheap approximate ellipse SDF — accurate enough at sprite scale.
  const dx = (px - cx) / rx
  const dy = (py - cy) / ry
  const k = Math.hypot(dx, dy)
  return (k - 1) * Math.min(rx, ry)
}

// Smooth union — melts shapes together so blobs look like one creamy mass.
const smin = (a, b, k) => {
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k))
  return (b * (1 - h)) + (a * h) - (k * h * (1 - h))
}

/* ---------- droplet shapes, in a 0..1 unit square ---------- */

const SHAPES = {
  // Fat round blob with a small satellite fleck.
  blob: (x, y) => {
    let d = sdEllipse(x, y, 0.48, 0.52, 0.34, 0.31)
    d = smin(d, sdCircle(x, y, 0.70, 0.30, 0.10), 0.10)
    return smin(d, sdCircle(x, y, 0.30, 0.30, 0.13), 0.12)
  },
  // Classic teardrop, point upward.
  teardrop: (x, y) => {
    const bulb = sdCircle(x, y, 0.50, 0.62, 0.30)
    const tip = sdEllipse(x, y, 0.50, 0.28, 0.11, 0.22)
    return smin(bulb, tip, 0.16)
  },
  // Elongated sprinkle (capsule) — the "sprinkle" read.
  sprinkle: (x, y) => {
    const a = sdCircle(x, y, 0.30, 0.62, 0.155)
    const b = sdCircle(x, y, 0.70, 0.38, 0.155)
    return smin(a, b, 0.34)
  },
  // Small round droplet.
  dot: (x, y) => sdEllipse(x, y, 0.5, 0.5, 0.26, 0.245)
}

/* ---------- mango cream palette ---------- */

const GRADIENT = [
  [0.00, [255, 249, 222]], // cream highlight
  [0.22, [255, 233, 160]], // pale mango
  [0.52, [255, 199, 74]],  // mango
  [0.78, [249, 160, 22]],  // deep mango
  [1.00, [226, 122, 0]]    // caramelised edge
]

const sampleGradient = (t) => {
  const u = Math.max(0, Math.min(1, t))
  for (let i = 0; i < GRADIENT.length - 1; i += 1) {
    const [t0, c0] = GRADIENT[i]
    const [t1, c1] = GRADIENT[i + 1]
    if (u <= t1) {
      const f = (u - t0) / (t1 - t0)
      return [
        c0[0] + (c1[0] - c0[0]) * f,
        c0[1] + (c1[1] - c0[1]) * f,
        c0[2] + (c1[2] - c0[2]) * f
      ]
    }
  }
  return GRADIENT[GRADIENT.length - 1][1]
}

const RIM = [198, 96, 4] // darker outline so the droplet pops on any background

/* ---------- render one sprite ---------- */

const SS = 4 // supersampling factor for anti-aliasing

const render = (size, shapeFn) => {
  const out = Buffer.alloc(size * size * 4)
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      // Coverage via supersampling.
      let inside = 0
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const ux = (px + (sx + 0.5) / SS) / size
          const uy = (py + (sy + 0.5) / SS) / size
          if (shapeFn(ux, uy) < 0) inside += 1
        }
      }
      const i = (py * size + px) * 4
      if (inside === 0) continue
      const coverage = inside / (SS * SS)

      const ux = (px + 0.5) / size
      const uy = (py + 0.5) / size
      const d = shapeFn(ux, uy) // negative inside

      // Base vertical gradient: cream at the top, deep mango at the bottom.
      let [r, g, b] = sampleGradient(uy * 0.92 + 0.04)

      // Gloss highlight, upper-left.
      const hl = Math.max(0, 1 - (Math.hypot(ux - 0.36, uy - 0.32) / 0.22))
      const gloss = Math.pow(hl, 1.8) * 0.85
      r += (255 - r) * gloss
      g += (255 - g) * gloss
      b += (245 - b) * gloss

      // Rim darkening in the outer ~8% so the edge reads crisp.
      const rimT = Math.max(0, 1 - (Math.abs(d) / 0.075))
      const rim = Math.pow(rimT, 2.2) * 0.55
      r += (RIM[0] - r) * rim
      g += (RIM[1] - g) * rim
      b += (RIM[2] - b) * rim

      out[i] = Math.round(Math.max(0, Math.min(255, r)))
      out[i + 1] = Math.round(Math.max(0, Math.min(255, g)))
      out[i + 2] = Math.round(Math.max(0, Math.min(255, b)))
      out[i + 3] = Math.round(coverage * 255)
    }
  }
  return out
}

/* ---------- write the four variants ---------- */

const SIZE = 64
const VARIANTS = [
  ['cream-1.png', SHAPES.blob],
  ['cream-2.png', SHAPES.teardrop],
  ['cream-3.png', SHAPES.sprinkle],
  ['cream-4.png', SHAPES.dot]
]

const outDir = path.join(__dirname, 'assets')
VARIANTS.forEach(([file, shape]) => {
  const png = encodePNG(SIZE, SIZE, render(SIZE, shape))
  fs.writeFileSync(path.join(outDir, file), png)
  console.log(`wrote assets/${file}  ${SIZE}x${SIZE}  ${(png.length / 1024).toFixed(1)}KB`)
})
