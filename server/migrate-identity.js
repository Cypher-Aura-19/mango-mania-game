/* One-time schema fix: a player is (device, name, company), not a device.
 *
 * The first version of the store had UNIQUE on players.device_id alone, so a
 * second name typed on the same laptop collided with the existing row and the
 * upsert renamed it — the earlier player's scores silently became somebody
 * else's. This moves the store to a composite unique index so a new name or a
 * new company starts its own row instead.
 *
 * Lives in its own file because it is the one piece of this server that can
 * destroy data if it is wrong, and it has to be runnable against a copy of the
 * real database before it is pointed at the real one.
 *
 * THE HAZARD: scores.player_id REFERENCES players(id) ON DELETE CASCADE, and
 * the server runs with foreign_keys ON. `DROP TABLE players` under that pragma
 * fires the cascade and takes every score row with it. The rebuild therefore
 * runs with foreign keys OFF — which must be set outside a transaction, as the
 * pragma is a no-op inside one — and puts the rows back under their original
 * ids so scores.player_id still points at the right player afterwards.
 */

const NEW_TABLE = `
  CREATE TABLE players_new (
    id          INTEGER PRIMARY KEY,
    device_id   TEXT    NOT NULL,
    name        TEXT    NOT NULL,
    company     TEXT    NOT NULL DEFAULT '',
    avatar      TEXT    NOT NULL DEFAULT 'avatar1',
    first_seen  TEXT    NOT NULL,
    last_seen   TEXT    NOT NULL
  )`;

const IDENTITY = 'players_identity';

/* Returns what it did, so the caller can log it: 'none' (already migrated),
 * 'index' (only a named unique index had to go) or 'rebuild'. */
function migrateIdentity(db) {
  const has = (name) => !!db.prepare(
    `SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?`
  ).get(name);
  if (has(IDENTITY)) return 'none';

  /* An inline UNIQUE column constraint shows up as sqlite_autoindex_*, whose
   * sql is NULL — it cannot be found by looking for 'UNIQUE' in index sql, and
   * it cannot be dropped by name either. The table's own DDL is the only
   * reliable place to see it, and the only way to remove it is a rebuild. */
  const ddl = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'players'`
  ).get();
  if (!ddl) return 'none'; // fresh store: CREATE TABLE already made it right
  const inline = /UNIQUE/i.test(ddl.sql || '');

  const named = db.prepare(`
    SELECT name FROM sqlite_master
     WHERE type = 'index' AND tbl_name = 'players'
       AND sql IS NOT NULL AND sql LIKE '%UNIQUE%'`).all();

  if (!inline) {
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const r of named) db.exec(`DROP INDEX IF EXISTS "${r.name}"`);
      db.exec(`CREATE UNIQUE INDEX ${IDENTITY} ON players (device_id, name, company)`);
      db.exec('COMMIT');
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* already unwound */ }
      throw err;
    }
    return 'index';
  }

  // Outside the transaction on purpose: PRAGMA foreign_keys is ignored inside
  // one, and leaving it on here is what would cascade the scores away.
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(NEW_TABLE);
      // Columns named out rather than SELECT *: the copy has to survive the
      // column order of whatever old build wrote this file.
      db.exec(`
        INSERT INTO players_new
          (id, device_id, name, company, avatar, first_seen, last_seen)
        SELECT id, device_id, name, company, avatar, first_seen, last_seen
          FROM players`);
      for (const r of named) db.exec(`DROP INDEX IF EXISTS "${r.name}"`);
      db.exec('DROP TABLE players');
      // legacy_alter_table keeps the rename from rewriting other tables' FK
      // clauses: scores already says REFERENCES players(id) and must keep
      // saying it, pointing at the table this rename is about to create.
      db.exec('PRAGMA legacy_alter_table = ON');
      db.exec('ALTER TABLE players_new RENAME TO players');
      db.exec('PRAGMA legacy_alter_table = OFF');
      db.exec(`CREATE UNIQUE INDEX ${IDENTITY} ON players (device_id, name, company)`);
      db.exec('COMMIT');
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* already unwound */ }
      throw err;
    }

    // Every score must still point at a live player. If the cascade fired after
    // all, this is where it shows, while the backup is still fresh.
    const orphans = db.prepare('PRAGMA foreign_key_check').all();
    if (orphans.length) {
      throw new Error(`identity migration left ${orphans.length} orphaned row(s)`);
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
  return 'rebuild';
}

module.exports = { migrateIdentity };
