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
- **Score exports:** http://localhost:8082/export

## Score data exports (admin)

Scores live in SQLite (`data/scores.db` locally, a hosted Turso database in
production). CSV is never stored on disk — it's generated on request. There are
two exports, both with UTC timestamps and Excel-ready (BOM + CRLF):

| Export | What it contains |
| ------ | ---------------- |
| **Leaderboard** | Each player's *best* score, ranked: `rank, player, company, best_score, layers, total_plays, achieved_at_utc` |
| **All scores** | *Every* run/try, one row each: `score_id, player, company, score, layers, edition, played_at_utc, device_id` |

### The export page (recommended)

Open the `/export` route, paste the admin token into the field, and click a
button:

- Local: http://localhost:8082/export
- Production: https://mango-cake-stacker.vercel.app/export

### Direct URLs

The endpoints can also be hit directly. In production they require the admin
token (the scores CSV carries `device_id`), passed as `?token=`:

```
# Production (token required)
https://mango-cake-stacker.vercel.app/api/export/leaderboard.csv?token=GvuzYsuWnEurhC_i0aETkmsMijXSYZ1o
https://mango-cake-stacker.vercel.app/api/export/scores.csv?token=GvuzYsuWnEurhC_i0aETkmsMijXSYZ1o

# Local (no token needed — the guard is off unless LEADERBOARD_ADMIN_TOKEN is set)
http://localhost:8082/api/export/leaderboard.csv
http://localhost:8082/api/export/scores.csv
```

Or with curl, passing the token as a header instead of a query param:

```bash
curl -H "x-admin-token: GvuzYsuWnEurhC_i0aETkmsMijXSYZ1o" \
  https://mango-cake-stacker.vercel.app/api/export/scores.csv -o scores.csv
```

### The admin token

The token is a single static value, `LEADERBOARD_ADMIN_TOKEN`, reused on every
export — it does not expire. It lives in `.env.local` (local) and the Vercel
project's environment variables (production). Current value:

```
GvuzYsuWnEurhC_i0aETkmsMijXSYZ1o
```

> ⚠️ **Security:** this token gates access to player data including device IDs.
> Treat it as a secret. If it has been committed to git or shared, rotate it:
> generate a new value, update it in both `.env.local` and the Vercel dashboard
> (Settings → Environment Variables), then redeploy.

## Resetting the leaderboard

Run this from the **project root** (the folder containing `package.json`):

```
C:\Users\HP\Desktop\open source projects\mine\mango mania\game\tower_game-master\tower_game-master
```

`cd` into it first (quote the path — it has spaces):

```bash
cd "C:\Users\HP\Desktop\open source projects\mine\mango mania\game\tower_game-master\tower_game-master"
```

Pull the production environment variables once, then run the guarded reset:

```bash
vercel env pull .env.local          # once, writes TURSO_* into .env.local
npm run leaderboard:reset           # dry run — prints target + row counts, changes nothing
npm run leaderboard:reset -- --yes  # permanent reset
```

Running `npm run leaderboard:reset` without `--yes` only prints the target and
current row counts. A confirmed reset permanently deletes all score and player
rows from the configured hosted leaderboard.

> **Note:** this resets the *production* (Turso) leaderboard, not the local
> `data/scores.db`. The script requires a hosted `TURSO_DATABASE_URL` and refuses
> to run against a local file, which is why `vercel env pull` comes first. The
> reset is irreversible — there is no undo — so use the dry run to confirm the
> row counts before running with `--yes`. `npm` resolves the script from the
> current directory, so running it anywhere other than the project root fails
> with a "missing script" error.

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
