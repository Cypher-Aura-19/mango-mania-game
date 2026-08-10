/* Score store for the global leaderboard.
 *
 * Uses node:sqlite, which ships with Node itself (>=23.4) — no native build, no
 * extra dependency, and the whole store is one file under data/ that can be
 * copied or backed up as-is.
 *
 * Two tables. `players` is the identity row, carrying the profile the game
 * already collects. `scores` is append-only: EVERY run gets a row with its own
 * UTC timestamp, so the history is intact even though the leaderboard only ever
 * shows each player's best. Nothing here is ever updated in place except the
 * avatar and last_seen on an existing identity.
 *
 * WHAT COUNTS AS ONE PLAYER: the device AND the name AND the company together.
 * A device is a shared thing — a laptop passed around a stand has a dozen
 * people on it — so keying on the device alone would file everyone who touched
 * it under whichever name was typed last, and rewrite the earlier players'
 * names out from under their scores. Typing a different name or company starts
 * a separate row with its own history; typing the same one again comes back to
 * the row you had.
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DIR = path.resolve(__dirname, '..', 'data');
fs.mkdirSync(DIR, { recursive: true });

const db = new DatabaseSync(path.join(DIR, 'scores.db'));

/* WAL lets readers carry on while a write is in flight, which is the whole game
 * here: many people finish a run at once and everyone else is reading the board.
 * busy_timeout is the other half — without it a writer that finds the lock held
 * fails instantly with SQLITE_BUSY instead of waiting its turn. NORMAL sync is
 * safe under WAL and takes the fsync off every commit. */
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA busy_timeout = 5000;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS players (
    id          INTEGER PRIMARY KEY,
    device_id   TEXT    NOT NULL,
    name        TEXT    NOT NULL,
    company     TEXT    NOT NULL DEFAULT '',
    avatar      TEXT    NOT NULL DEFAULT 'avatar1',
    first_seen  TEXT    NOT NULL,
    last_seen   TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS scores (
    id         INTEGER PRIMARY KEY,
    player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    score      INTEGER NOT NULL,
    layers     INTEGER NOT NULL DEFAULT 0,
    edition    TEXT    NOT NULL DEFAULT 'tap',
    played_at  TEXT    NOT NULL
  );

  CREATE INDEX IF NOT EXISTS scores_player  ON scores (player_id);
  CREATE INDEX IF NOT EXISTS scores_best    ON scores (score DESC);
  CREATE INDEX IF NOT EXISTS scores_when    ON scores (played_at);
`);

/* A store written before the identity rule changed has UNIQUE(device_id) on
 * players, which the upsert's ON CONFLICT(device_id, name, company) cannot bind
 * against — and worse, still collides on a rename. Bringing it forward is the
 * one operation here that can lose data, so it lives in its own file and is
 * tested against a copy of the real store before it is run on it. */
const { migrateIdentity } = require('./migrate-identity');

const migrated = migrateIdentity(db);
if (migrated !== 'none') {
  console.log(`[db] identity migration: ${migrated}`);
}

db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS players_identity
           ON players (device_id, name, company)`);

/* The leaderboard: one row per player, their best run, ties broken by who got
 * there first. MAX(score) with a bare GROUP BY would leave the other columns
 * unspecified, so the window function picks the actual winning row. */
const LEADERBOARD = `
  SELECT pid, name, company, avatar, score, layers, played_at, plays
    FROM (
      SELECT p.id AS pid, p.name, p.company, p.avatar, s.score, s.layers, s.played_at,
             COUNT(*) OVER (PARTITION BY p.id) AS plays,
             ROW_NUMBER() OVER (PARTITION BY p.id
                                ORDER BY s.score DESC, s.played_at ASC) AS seat
        FROM scores s JOIN players p ON p.id = s.player_id
    )
   WHERE seat = 1
   ORDER BY score DESC, played_at ASC
`;

const q = {
  /* Resolving "which row is mine" needs the whole identity, not the device:
   * one laptop can hold several players' rows now. */
  findPlayer: db.prepare(`
    SELECT id FROM players
     WHERE device_id = ? AND name = ? AND company = ?`),
  /* Identity is (device_id, name, company): the same device may run several
   * names (a rename should show as a separate player on the board, not rewrite
   * the old name's history), and the same name on another device is a different
   * person. One statement, not SELECT-then-INSERT: two runs finishing at the
   * same instant from a device with no row yet would both miss the SELECT and
   * the loser would die on the UNIQUE constraint. The upsert lets SQLite settle
   * it, and RETURNING hands back the id either way. */
  upsertPlayer: db.prepare(`
    INSERT INTO players (device_id, name, company, avatar, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(device_id, name, company) DO UPDATE SET
      avatar = excluded.avatar, last_seen = excluded.last_seen
    RETURNING id`),
  addScore: db.prepare(`
    INSERT INTO scores (player_id, score, layers, edition, played_at)
    VALUES (?, ?, ?, ?, ?)`),
  best: db.prepare(`
    SELECT COALESCE(MAX(score), 0) AS best FROM scores WHERE player_id = ?`),
  board: db.prepare(LEADERBOARD + ' LIMIT ?'),
  boardAll: db.prepare(LEADERBOARD),
  history: db.prepare(`
    SELECT p.name, p.company, p.avatar, p.device_id,
           s.id, s.score, s.layers, s.edition, s.played_at
      FROM scores s JOIN players p ON p.id = s.player_id
     ORDER BY s.played_at DESC, s.id DESC`),
  rank: db.prepare(`
    SELECT COUNT(*) + 1 AS rank FROM (
      SELECT MAX(score) AS best FROM scores GROUP BY player_id
    ) WHERE best > ?`),
  totals: db.prepare(`
    SELECT (SELECT COUNT(*) FROM players) AS players,
           (SELECT COUNT(*) FROM scores)  AS runs`),
};

/* Upsert on the full identity. Only the avatar and last_seen move: a name or a
 * company that differs from an existing row is a different player and gets its
 * own row, so nobody's history is ever relabelled under them. */
function upsertPlayer(deviceId, name, company, avatar) {
  const now = new Date().toISOString();
  return Number(q.upsertPlayer.get(deviceId, name, company, avatar, now, now).id);
}

/* BEGIN IMMEDIATE, not a bare BEGIN: it takes the write lock up front, so two
 * concurrent submits queue instead of both starting as readers and one dying
 * when it tries to upgrade. busy_timeout covers the wait; the retry is for the
 * case where even that runs out under a burst. */
function inWrite(fn, tries = 3) {
  for (let attempt = 1; ; attempt++) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* already unwound */ }
      const busy = /SQLITE_BUSY|database is locked/i.test(String(err));
      if (!busy || attempt >= tries) throw err;
    }
  }
}

/* The player row, the score row and the reads that answer the request all sit
 * in one transaction, so the rank we hand back is the rank as of this run —
 * never a number blended with someone else's submit landing mid-flight. */
function recordScore({ deviceId, name, company, avatar, score, layers, edition }) {
  const playedAt = new Date().toISOString();
  return inWrite(() => {
    const playerId = upsertPlayer(deviceId, name, company, avatar);
    q.addScore.run(playerId, score, layers, edition, playedAt);
    const best = q.best.get(playerId).best;
    return { best, rank: q.rank.get(best).rank, playedAt };
  });
}

module.exports = { db, q, upsertPlayer, recordScore, inWrite };
