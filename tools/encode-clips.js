/* Re-encode the customer's reaction clips for the web.
 *
 * Run:  node tools/encode-clips.js
 *
 * Reads the camera masters from .video-src/*.orig.mp4 and writes both shipping
 * formats into assets/. Nothing here is destructive to the masters; the assets
 * are overwritten, which is the point.
 *
 * WHY TWO FORMATS
 *
 * WebM/VP9 is the moving-picture answer to WebP: same lineage out of Google,
 * same trade of encode time for file size, and here it lands about 10% under the
 * H.264 file at matched quality. It is the one every modern browser gets.
 *
 * The MP4 is not a formality. Safari only learned VP9 recently and decodes it in
 * SOFTWARE when it does -- and this page already asks a phone to decode video
 * while chroma-keying a frame of it per paint. H.264 is hardware-decoded on
 * essentially everything, so the browsers that would struggle are exactly the
 * ones served the MP4. src/customer.js picks between them with canPlayType.
 *
 * WHY THESE NUMBERS
 *
 *   540x960   The clips are drawn into a box a third of the stacking column
 *             wide -- about 200 CSS px, so ~400 device px on a 2x phone. Half
 *             the 720x1280 master is still comfortably above that, and the keyer
 *             downsamples to 320px on the long side before it draws anyway.
 *
 *   CRF 40 (VP9) / CRF 27 (H.264)
 *             The two scales are NOT comparable -- VP9 at 33 came out LARGER
 *             than H.264 at 27, which is what sent this to a sweep in the first
 *             place. 40 is where VP9 matches; 45 is visibly softer at the hair
 *             and the white edge, which is the part the keyer is reading.
 *
 *   -an       The clips are silent and play muted. The reaction sounds are audio
 *             assets, triggered separately.
 *
 *   +faststart (H.264 only)
 *             Moves the moov atom to the front so the browser can start decoding
 *             on the first bytes instead of waiting out the whole download. WebM
 *             does not need it; the format is streamable by construction.
 *
 * ffmpeg comes from the ffmpeg-static devDependency -- there is no system ffmpeg
 * on the machine this was built on, and requiring one would put a manual install
 * between a fresh clone and a working build.
 */
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const FF = require('ffmpeg-static')
const ROOT = path.join(__dirname, '..')
const SRC = path.join(ROOT, '.video-src')
const OUT = path.join(ROOT, 'assets')
const CLIPS = ['watching', 'happy', 'angry']

const SCALE = 'scale=540:960:flags=lanczos'
const mb = f => (fs.statSync(f).size / (1024 * 1024)).toFixed(2)

const run = (args) => execFileSync(FF, args, { stdio: ['ignore', 'ignore', 'pipe'] })

let before = 0
let webmTotal = 0
let mp4Total = 0

CLIPS.forEach((clip) => {
  const src = path.join(SRC, `${clip}.orig.mp4`)
  if (!fs.existsSync(src)) {
    console.error(`missing master: ${path.relative(ROOT, src)}`)
    process.exit(1)
  }
  before += fs.statSync(src).size

  const webm = path.join(OUT, `${clip}.webm`)
  run(['-i', src, '-vf', SCALE, '-c:v', 'libvpx-vp9', '-crf', '40', '-b:v', '0',
    '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2',
    '-pix_fmt', 'yuv420p', '-an', '-y', webm])

  const mp4 = path.join(OUT, `${clip}.mp4`)
  run(['-i', src, '-vf', SCALE, '-c:v', 'libx264', '-crf', '27', '-preset', 'slow',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', '-y', mp4])

  webmTotal += fs.statSync(webm).size
  mp4Total += fs.statSync(mp4).size
  console.log(`${clip.padEnd(9)} webm ${mb(webm)} MB   mp4 ${mb(mp4)} MB`)
})

const MB = b => (b / (1024 * 1024)).toFixed(2)
console.log(`\nmasters ${MB(before)} MB -> ${MB(webmTotal)} MB webm / ${MB(mp4Total)} MB mp4`)
console.log(`a browser downloads one set: ${MB(webmTotal)} MB where VP9 is taken.`)
