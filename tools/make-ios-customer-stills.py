"""Build transparent customer reaction stills for the low-overhead iOS path.

Safari's video-to-canvas readback is synchronous with the main thread. These
stills preserve the three customer moods without decoding/keying video while a
block is moving. The mask matches src/customer.js: near-white pixels are
dilated for connectivity, flood-filled from the frame border, then intersected
with the original near-white mask so internal highlights remain opaque.
"""
from collections import deque
from pathlib import Path
import subprocess
import tempfile

from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
MOODS = ("watching", "happy", "angry")
FRAME_AT = 1.5
LONG_SIDE = 384
MASK_LONG = 128
TOLERANCE = 80
RADIUS = 2


def ffmpeg_path():
    result = subprocess.run(
        ["node", "-e", "process.stdout.write(require('ffmpeg-static'))"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def fit_size(size, long_side):
    width, height = size
    scale = long_side / max(width, height)
    return max(2, round(width * scale)), max(2, round(height * scale))


def outside_white_mask(source):
    mask_size = fit_size(source.size, MASK_LONG)
    small = source.resize(mask_size, Image.Resampling.BILINEAR).convert("RGB")
    pixels = list(small.getdata())
    threshold = 255 - TOLERANCE
    near = [r >= threshold and g >= threshold and b >= threshold for r, g, b in pixels]

    near_image = Image.new("L", mask_size)
    near_image.putdata([255 if value else 0 for value in near])
    dilated = list(near_image.filter(ImageFilter.MaxFilter((RADIUS * 2) + 1)).getdata())

    width, height = mask_size
    flooded = [False] * (width * height)
    queue = deque()

    def seed(index):
        if dilated[index] and not flooded[index]:
            flooded[index] = True
            queue.append(index)

    for x in range(width):
        seed(x)
        seed(((height - 1) * width) + x)
    for y in range(1, height - 1):
        seed(y * width)
        seed((y * width) + width - 1)

    while queue:
        index = queue.popleft()
        x = index % width
        neighbours = []
        if x > 0:
            neighbours.append(index - 1)
        if x < width - 1:
            neighbours.append(index + 1)
        if index >= width:
            neighbours.append(index - width)
        if index < (height - 1) * width:
            neighbours.append(index + width)
        for neighbour in neighbours:
            if dilated[neighbour] and not flooded[neighbour]:
                flooded[neighbour] = True
                queue.append(neighbour)

    removal = Image.new("L", mask_size)
    removal.putdata([255 if flooded[i] and near[i] else 0 for i in range(len(near))])
    return removal


def build(mood, ffmpeg, temp):
    raw = temp / f"{mood}.png"
    subprocess.run(
        [ffmpeg, "-loglevel", "error", "-y", "-ss", str(FRAME_AT),
         "-i", str(ASSETS / f"{mood}.mp4"), "-frames:v", "1", str(raw)],
        check=True,
    )
    source = Image.open(raw).convert("RGB")
    output_size = fit_size(source.size, LONG_SIDE)
    output = source.resize(output_size, Image.Resampling.LANCZOS).convert("RGBA")
    removal = outside_white_mask(source).resize(output_size, Image.Resampling.BILINEAR)
    alpha = removal.point(lambda value: 255 - value)
    output.putalpha(alpha)
    target = ASSETS / f"customer-{mood}-ios.webp"
    output.save(target, "WEBP", quality=88, method=6)
    print(f"{target.name}: {output.width}x{output.height}, {target.stat().st_size} bytes")


def main():
    ffmpeg = ffmpeg_path()
    with tempfile.TemporaryDirectory(prefix="mango-ios-stills-") as directory:
        temp = Path(directory)
        for mood in MOODS:
            build(mood, ffmpeg, temp)


if __name__ == "__main__":
    main()
