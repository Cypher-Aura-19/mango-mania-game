# Tower Building

A physics-based tower-building game. A crane swings a block back and forth above a stack — tap to drop it, land it as square on top as you can to slice off only the tiny overhang and climb ever higher.

The classic build-within-chapters mobile format, rebuilt on a lightweight custom engine.

## Features

- **Tap / click** to release the swinging block onto the tower
- **Perfect drops** shave the block clean and reward you with bonus height
- Misses slice the block narrower — the tower gets harder to place on
- Parallax background, drifting clouds, and a swinging crane
- Optimized HTML5 canvas rendering, runs in any modern browser

## Blink Edition

A controller-free variant in `index-blink.html`: instead of tapping, **blink** to drop the block. It uses the webcam to detect your eye blinks. Open the `/blink` route to play.

## Getting Started

```bash
npm install
npm start
```

`npm start` builds the game bundle, then starts a local server at `http://localhost:8082`.

- **Play:** http://localhost:8082
- **Blink edition:** http://localhost:8082/blink

## Tech Stack

| Layer | Tool |
| ----- | ---- |
| Game engine | cooljs |
| Rendering | HTML5 Canvas |
| Bundling | webpack 4 + babel |
| Server | Express |
| DOM helper | Zepto |

## Project Layout

```
src/
  index.js        # game engine + state machine
  constant.js     # game states and constants
  utils.js        # physics/delta helpers, scoring
  background.js   # parallax background
  cloud.js        # drifting clouds
  line.js         # the scrolling ground line
  hook.js         # swinging crane block hook
  block.js        # tower blocks, stacking + slice-off
  flight.js       # block flight physics
  animateFuncs.js # per-state animation functions
  tutorial.js     # onboarding / game-over overlays
index.html        # main game page
index-blink.html  # blink-controlled edition
index.js          # Express server
assets/           # sprites, backgrounds, audio, fonts
```