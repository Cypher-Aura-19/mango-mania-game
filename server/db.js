/* Score store for the global leaderboard.
 *
 * Backed by Turso (libSQL) rather than a file on disk. The store used to be a
 * local scores.db opened with node:sqlite, which works when one machine serves
 * every player and does not work at all on Vercel: a function gets a fresh,
 * per-instance filesystem, so that file would be created empty on every cold
 * start and never shared between the instances answering two players at once.
 * A hosted libSQL database is the same SQLite reachable over the network, so
 * the schema and every query below are unchanged from the on-disk version —
 * window functions, ON CONFLICT ... RETURNING, `?` placeholders and all.
 *
 * What DID change is that nothing is synchronous any more. Every read and write
 * returns a promise, which is why the API routes await them.
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

/* On a hosted database the URL is the only acceptable answer: falling back to a
 * local file there would turn a missing env var into a silent, per-instance
 * database that accepts scores and loses them, which is precisely the failure
 * this store exists to avoid. So it throws instead.
 *
 * Off Vercel, the same driver opens a plain SQLite file, so `npm start` keeps
 * working against data/scores.db exactly as it did — same file, same rows, no
 * setup needed to run the game on the desk. Set TURSO_DATABASE_URL locally
 * (vercel env pull writes it to .env.local) to point local dev at the real one. */
const url = process.env.TURSO_DATABASE_URL
  || (process.env.VERCEL ? '' : 'file:data/scores.db');
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url) {
  throw new Error(
    'TURSO_DATABASE_URL is not set — the leaderboard has no store without it. ' +
    'Set it in the Vercel project (Storage -> the Turso database -> connect).'
  );
}

/* Which of the driver's two entry points to load, decided by the URL.
 *
 * The default entry can also open a file, and to do that it depends on `libsql`,
 * a native module shipped as a per-platform binary. In a serverless function
 * that is a liability rather than a feature: the function has no persistent file
 * to open, and the binary that gets bundled is whichever platform ran the
 * install — a `libsql-win32-x64-msvc` from this laptop is not something a Linux
 * runtime can load, and the function dies at import with "Cannot find module
 * '@libsql/linux-x64-gnu'" before a single route is reached.
 *
 * The /web entry is the same client with the file support removed, spoken purely
 * over HTTP. It needs no binary, so it is correct on every platform, smaller,
 * and quicker to cold-start. It cannot open file: — which is exactly the case
 * the default entry is kept for. So the URL picks: a remote database gets the
 * portable client, a local file gets the native one. */
const remote = /^(libsql|wss?|https?):/.test(url);
const { createClient } = remote
  ? require('@libsql/client/web')
  : require('@libsql/client');

const db = createClient({ url, authToken });

/* The pragmas the file-backed store set on open are gone: journal_mode,
 * synchronous and busy_timeout describe how a local file is written, and the
 * server owns all three. Foreign keys are enforced server-side too.
 *
 * Schema creation is idempotent and cheap, but it must not race — several cold
 * starts can land at once on a fresh deploy. The promise is built once at module
 * scope and awaited by every query, so the statements run a single time per
 * instance and the first request cannot read a table that is still being made. */
const ready = db.batch([
  `CREATE TABLE IF NOT EXISTS players (
     id          INTEGER PRIMARY KEY,
     device_id   TEXT    NOT NULL,
     name        TEXT    NOT NULL,
     company     TEXT    NOT NULL DEFAULT '',
     avatar      TEXT    NOT NULL DEFAULT 'avatar1',
     first_seen  TEXT    NOT NULL,
     last_seen   TEXT    NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS scores (
     id         INTEGER PRIMARY KEY,
     player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
     score      INTEGER NOT NULL,
     layers     INTEGER NOT NULL DEFAULT 0,
     edition    TEXT    NOT NULL DEFAULT 'tap',
     played_at  TEXT    NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS scores_player ON scores (player_id)`,
  `CREATE INDEX IF NOT EXISTS scores_best   ON scores (score DESC)`,
  `CREATE INDEX IF NOT EXISTS scores_when   ON scores (played_at)`,
  /* The identity rule, as an index rather than an inline column constraint.
   * migrate-identity.js existed to rebuild tables written by an older build
   * that had UNIQUE(device_id) on the column; a hosted store starts at this
   * shape, so there is no legacy form to bring forward and nothing to migrate. */
  `CREATE UNIQUE INDEX IF NOT EXISTS players_identity
     ON players (device_id, name, company)`,
], 'write');

ready.catch((err) => {
  console.error('[db] schema setup failed:', err && err.message);
});

/* The public board treats a normalized visible profile as one person. Device
 * ids remain in storage because shared phones can host several players, but a
 * hostname rename creates a new localStorage origin and therefore a new device
 * id for the same name/company/avatar. This partition folds those legacy rows
 * together while retaining every underlying run. */
const LEADERBOARD = `
  SELECT pid, name, company, avatar, score, layers, played_at, plays
    FROM (
      SELECT p.id AS pid, p.name, p.company, p.avatar, s.score, s.layers, s.played_at,
             COUNT(*) OVER (
               PARTITION BY lower(trim(p.name)), lower(trim(p.company)), p.avatar
             ) AS plays,
             ROW_NUMBER() OVER (
               PARTITION BY lower(trim(p.name)), lower(trim(p.company)), p.avatar
                                ORDER BY s.score DESC, s.played_at ASC) AS seat
        FROM scores s JOIN players p ON p.id = s.player_id
    )
   WHERE seat = 1
   ORDER BY score DESC, played_at ASC
`;

const SQL = {
  /* Resolving "which row is mine" needs the whole identity, not the device:
   * one laptop can hold several players' rows now. */
  findPlayer: `SELECT id FROM players
                WHERE device_id = ? AND name = ? AND company = ?`,
  /* Identity is (device_id, name, company): the same device may run several
   * names (a rename should show as a separate player on the board, not rewrite
   * the old name's history), and the same name on another device is a different
   * person. One statement, not SELECT-then-INSERT: two runs finishing at the
   * same instant from a device with no row yet would both miss the SELECT and
   * the loser would die on the UNIQUE constraint. The upsert lets the database
   * settle it, and RETURNING hands back the id either way. */
  upsertPlayer: `INSERT INTO players (device_id, name, company, avatar, first_seen, last_seen)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(device_id, name, company) DO UPDATE SET
                   avatar = excluded.avatar, last_seen = excluded.last_seen
                 RETURNING id`,
  addScore: `INSERT INTO scores (player_id, score, layers, edition, played_at)
             VALUES (?, ?, ?, ?, ?)`,
  best: `SELECT COALESCE(MAX(score), 0) AS best FROM scores WHERE player_id = ?`,
  board: LEADERBOARD + ' LIMIT ?',
  boardAll: LEADERBOARD,
  history: `SELECT p.name, p.company, p.avatar, p.device_id,
                   s.id, s.score, s.layers, s.edition, s.played_at
              FROM scores s JOIN players p ON p.id = s.player_id
             ORDER BY s.played_at DESC, s.id DESC`,
  rank: `SELECT COUNT(*) + 1 AS rank FROM (
           SELECT MAX(s.score) AS best
             FROM scores s JOIN players p ON p.id = s.player_id
            GROUP BY lower(trim(p.name)), lower(trim(p.company)), p.avatar
         ) WHERE best > ?`,
  totals: `SELECT (SELECT COUNT(*) FROM (
                    SELECT 1 FROM players
                     GROUP BY lower(trim(name)), lower(trim(company)), avatar
                  )) AS players,
                  (SELECT COUNT(*) FROM scores)  AS runs`,
};

/* db.prepare() is gone — libSQL takes the SQL and its arguments together on
 * every call. These two keep the call sites reading the way they did: one row,
 * or all of them. Both wait on the schema first. */
async function all(sql, args = []) {
  await ready;
  const rs = await db.execute({ sql, args });
  return rs.rows;
}

async function get(sql, args = []) {
  return (await all(sql, args))[0];
}

/* libSQL returns INTEGER columns as BigInt once they are wide enough, and a
 * BigInt does not survive JSON.stringify — it throws. Every number here is a
 * score, a count or a row id, all comfortably inside Number range, so they are
 * coerced on the way out and the routes can serialise a row directly. */
function plain(row) {
  if (!row) return row;
  const out = {};
  for (const k of Object.keys(row)) {
    out[k] = typeof row[k] === 'bigint' ? Number(row[k]) : row[k];
  }
  return out;
}

const q = {
  findPlayer: async (deviceId, name, company) =>
    plain(await get(SQL.findPlayer, [deviceId, name, company])),
  best: async (playerId) => plain(await get(SQL.best, [playerId])),
  board: async (limit) => (await all(SQL.board, [limit])).map(plain),
  boardAll: async () => (await all(SQL.boardAll)).map(plain),
  history: async () => (await all(SQL.history)).map(plain),
  rank: async (best) => plain(await get(SQL.rank, [best])),
  totals: async () => plain(await get(SQL.totals)),
};

/* Upsert on the full identity. Only the avatar and last_seen move: a name or a
 * company that differs from an existing row is a different player and gets its
 * own row, so nobody's history is ever relabelled under them. */
async function upsertPlayer(deviceId, name, company, avatar) {
  const now = new Date().toISOString();
  const row = await get(SQL.upsertPlayer, [deviceId, name, company, avatar, now, now]);
  return Number(row.id);
}

/* The player row, the score row and the reads that answer the request all sit
 * in one transaction, so the rank we hand back is the rank as of this run —
 * never a number blended with someone else's submit landing mid-flight.
 *
 * The BEGIN IMMEDIATE retry loop went with the file. SQLITE_BUSY was contention
 * over a local write lock, and there is no such lock to lose against a hosted
 * store. tx.close() is a rollback if the body threw before the commit and a
 * no-op after it, so no path leaves the transaction open.
 */
async function recordScore({ deviceId, name, company, avatar, score, layers, edition }) {
  await ready;
  const playedAt = new Date().toISOString();

  const tx = await db.transaction('write');
  try {
    const up = await tx.execute({
      sql: SQL.upsertPlayer,
      args: [deviceId, name, company, avatar, playedAt, playedAt],
    });
    const playerId = Number(up.rows[0].id);

    await tx.execute({ sql: SQL.addScore, args: [playerId, score, layers, edition, playedAt] });

    const bestRs = await tx.execute({ sql: SQL.best, args: [playerId] });
    const best = Number(bestRs.rows[0].best);

    const rankRs = await tx.execute({ sql: SQL.rank, args: [best] });
    const rank = Number(rankRs.rows[0].rank);

    await tx.commit();
    return { best, rank, playedAt };
  } finally {
    tx.close();
  }
}

module.exports = { db, q, upsertPlayer, recordScore };
