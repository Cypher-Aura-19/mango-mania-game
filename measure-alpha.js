// Measure the opaque bounding box of a PNG: which rows/columns actually have
// non-transparent pixels. Reveals transparent padding baked into the texture.
const fs = require('fs')
const zlib = require('zlib')

const file = process.argv[2]
const buf = fs.readFileSync(file)

let pos = 8
let width = 0
let height = 0
let bitDepth = 0
let colorType = 0
let trns = null
const idat = []

while (pos < buf.length) {
  const len = buf.readUInt32BE(pos)
  const type = buf.toString('ascii', pos + 4, pos + 8)
  const data = buf.slice(pos + 8, pos + 8 + len)
  if (type === 'IHDR') {
    width = data.readUInt32BE(0)
    height = data.readUInt32BE(4)
    bitDepth = data[8]
    colorType = data[9]
  } else if (type === 'tRNS') {
    trns = Buffer.from(data)
  } else if (type === 'IDAT') {
    idat.push(data)
  } else if (type === 'IEND') break
  pos += 12 + len
}

console.log(`${file}: ${width}x${height} bitDepth=${bitDepth} colorType=${colorType}`)
// colorType 6 = RGBA (alpha in every pixel); 3 = palette (alpha via tRNS).
if (!((colorType === 6 && bitDepth === 8) || (colorType === 3 && bitDepth === 8))) {
  console.log('Unsupported format for this measurement; aborting.')
  process.exit(0)
}
if (colorType === 3 && !trns) {
  console.log('Palette image with no tRNS chunk — fully opaque, no padding.')
  process.exit(0)
}

const raw = zlib.inflateSync(Buffer.concat(idat))
const bpp = colorType === 6 ? 4 : 1
const stride = width * bpp

const paeth = (a, b, c) => {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

let prev = Buffer.alloc(stride)
let p = 0
const rowAlphaMax = new Uint8Array(height)
const colAlphaMax = new Uint8Array(width)

for (let y = 0; y < height; y += 1) {
  const filter = raw[p]
  p += 1
  const line = Buffer.from(raw.slice(p, p + stride))
  p += stride
  for (let x = 0; x < stride; x += 1) {
    const a = x >= bpp ? line[x - bpp] : 0
    const b = prev[x]
    const c = x >= bpp ? prev[x - bpp] : 0
    switch (filter) {
      case 1: line[x] = (line[x] + a) & 0xFF; break
      case 2: line[x] = (line[x] + b) & 0xFF; break
      case 3: line[x] = (line[x] + ((a + b) >> 1)) & 0xFF; break
      case 4: line[x] = (line[x] + paeth(a, b, c)) & 0xFF; break
      default: break
    }
  }
  let rmax = 0
  for (let x = 0; x < width; x += 1) {
    // RGBA: alpha is the 4th byte. Palette: alpha comes from tRNS[paletteIndex]
    // (indices beyond the tRNS table are fully opaque).
    const al = colorType === 6
      ? line[(x * bpp) + 3]
      : (line[x] < trns.length ? trns[line[x]] : 255)
    if (al > rmax) rmax = al
    if (al > colAlphaMax[x]) colAlphaMax[x] = al
  }
  rowAlphaMax[y] = rmax
  prev = line
}

const THRESH = 8
let top = 0
while (top < height && rowAlphaMax[top] <= THRESH) top += 1
let bottom = height - 1
while (bottom >= 0 && rowAlphaMax[bottom] <= THRESH) bottom -= 1
let left = 0
while (left < width && colAlphaMax[left] <= THRESH) left += 1
let right = width - 1
while (right >= 0 && colAlphaMax[right] <= THRESH) right -= 1

console.log(`opaque rows: ${top}..${bottom}  (transparent: ${top} top, ${height - 1 - bottom} bottom)`)
console.log(`opaque cols: ${left}..${right}  (transparent: ${left} left, ${width - 1 - right} right)`)
console.log(`top pad    = ${(top / height * 100).toFixed(2)}% of height`)
console.log(`bottom pad = ${((height - 1 - bottom) / height * 100).toFixed(2)}% of height`)

// Show alpha profile near the bottom edge to spot soft shadow falloff.
console.log('\nlast 12 rows alpha max:')
for (let y = Math.max(0, height - 12); y < height; y += 1) {
  console.log(`  row ${y}: ${rowAlphaMax[y]}`)
}
console.log('\nfirst 12 rows alpha max:')
for (let y = 0; y < Math.min(12, height); y += 1) {
  console.log(`  row ${y}: ${rowAlphaMax[y]}`)
}
