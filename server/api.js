/* The leaderboard API.
 *
 * Mounted at /api by index.js. Five routes: submit a run, read the board, read
 * one device's own standing, and the two CSV exports.
 *
 * On trust: the score arrives from the browser, so it is a claim, not a
 * measurement — anyone can POST any number. The validation below only bounds it
 * to something the game could plausibly produce and stops one client from
 * flooding the table. Set LEADERBOARD_ADMIN_TOKEN to gate the CSV exports, which
 * carry device ids.
 */
const express = require('express');
const { q, recordScore } = require('./db');
const csv = require('./csv');

const router = express.Router();
router.use(express.json({ limit: '4kb' }));

const AVATARS = new Set(['avatar1', 'avatar2', 'avatar3', 'avatar4', 'avatar5', 'avatar6']);
const EDITIONS = new Set(['tap', 'blink']);
const MAX_SCORE = 100000;
const ADMIN_TOKEN = process.env.LEADERBOARD_ADMIN_TOKEN || '';

/* One bucket per IP, refilled continuously. Submitting is the only write, so it
 * is the only thing worth limiting; the reads are cheap and cacheable. */
const buckets = new Map();
/* Per device, not per IP. A room full of players on one office network shares a
 * single source address, so an IP bucket would throttle the tenth person to
 * pick up a phone. The IP ceiling is kept as a much looser flood guard — high
 * enough that a genuine crowd never reaches it. */
const RATE = { per: 60000, device: 20, ip: 400 };

function take(key, burst) {
  const now = Date.now();
  const b = buckets.get(key) || { tokens: burst, at: now };
  b.tokens = Math.min(burst, b.tokens + ((now - b.at) / RATE.per) * burst);
  b.at = now;
  buckets.set(key, b);
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

function allowed(ip, deviceId) {
  // Device first: a throttled device must not spend the shared IP allowance.
  return take('d:' + deviceId, RATE.device) && take('i:' + ip, RATE.ip);
}

/* Unbounded otherwise: one entry per device that ever posted, held for the life
 * of the process. */
setInterval(() => {
  const cutoff = Date.now() - RATE.per * 10;
  for (const [key, b] of buckets) if (b.at < cutoff) buckets.delete(key);
}, RATE.per * 10).unref();

function text(v, max) {
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

function guard(req, res, next) {
  if (!ADMIN_TOKEN) return next();
  const given = req.get('x-admin-token') || req.query.token || '';
  if (given === ADMIN_TOKEN) return next();
  return res.status(401).json({ error: 'admin token required' });
}

router.post('/score', (req, res) => {
  const b = req.body || {};
  const deviceId = text(b.deviceId, 64);
  const name = text(b.name, 40);
  const score = Number(b.score);

  // Validate before rate limiting, so a malformed body gets the reason it was
  // rejected rather than a 429 that sends the client into its retry queue.
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(deviceId)) {
    return res.status(400).json({ error: 'deviceId missing or malformed' });
  }
  if (!allowed(req.ip, deviceId)) {
    return res.status(429).json({ error: 'too many submissions, slow down' });
  }
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE) {
    return res.status(400).json({ error: 'score must be an integer 0..' + MAX_SCORE });
  }

  const layers = Number.isInteger(Number(b.layers))
    ? Math.max(0, Math.min(MAX_SCORE, Number(b.layers))) : 0;

  // A write that loses the lock race past its retries is retryable, not the
  // client's fault: 503 tells the client to requeue instead of dropping the run.
  try {
    const out = recordScore({
      deviceId,
      name,
      company: text(b.company, 40),
      avatar: AVATARS.has(b.avatar) ? b.avatar : 'avatar1',
      score,
      layers,
      edition: EDITIONS.has(b.edition) ? b.edition : 'tap',
    });
    res.status(201).json({ ok: true, ...out });
  } catch (err) {
    console.error('[api] score submit failed:', err && err.message);
    res.status(503).json({ error: 'could not record the score, try again' });
  }
});

/* ?me=<deviceId>&meName=&meCompany= marks the caller's own row, so the client
 * can highlight it without matching on name — two players called "Ali" would
 * both light up. Identity is device+name+company, so all three are needed; a
 * bare ?me= from an older client simply matches nothing and no row is marked.
 * The internal player id is resolved here and dropped from the response. */
router.get('/leaderboard', (req, res) => {
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 20));
  const mine = req.query.me
    ? q.findPlayer.get(String(req.query.me), text(req.query.meName, 40),
      text(req.query.meCompany, 40))
    : null;
  const rows = q.board.all(limit).map((r, i) => ({
    rank: i + 1,
    // Stable across reorders, so the client can animate a row from its old
    // rank to its new one. The internal id never leaves as anything else.
    key: 'p' + r.pid,
    name: r.name,
    company: r.company,
    avatar: r.avatar,
    score: r.score,
    layers: r.layers,
    plays: r.plays,
    played_at: r.played_at,
    me: !!mine && r.pid === mine.id,
  }));
  res.json({ leaderboard: rows, ...q.totals.get() });
});

/* The player's own standing, for the row the board highlights: their best and
 * where it sits even when that is far below the visible top slice. Name and
 * company come as query params because they are part of the identity. */
router.get('/me/:deviceId', (req, res) => {
  const found = q.findPlayer.get(req.params.deviceId,
    text(req.query.name, 40), text(req.query.company, 40));
  if (!found) return res.json({ best: 0, rank: null, plays: 0 });
  const best = q.best.get(found.id).best;
  res.json({ best, rank: q.rank.get(best).rank });
});

router.get('/export/leaderboard.csv', guard, (req, res) => {
  const rows = q.boardAll.all().map((r, i) => ({ rank: i + 1, ...r }));
  csv.send(res, csv.stamped('mango-mania-leaderboard'),
    csv.toCsv(csv.LEADERBOARD_COLUMNS, rows));
});

router.get('/export/scores.csv', guard, (req, res) => {
  csv.send(res, csv.stamped('mango-mania-scores'),
    csv.toCsv(csv.SCORES_COLUMNS, q.history.all()));
});

router.get('/stats', (req, res) => res.json(q.totals.get()));

module.exports = router;
