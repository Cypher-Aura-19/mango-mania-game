/* Permanently clear the hosted leaderboard.
 *
 * This is intentionally a command instead of a browser button or public API:
 * even an authenticated reset URL can leak into browser history, logs, or a
 * screenshot. The command reads the same ignored .env.local file as Vercel,
 * prints the exact row counts it is about to remove, and requires --yes before
 * issuing either DELETE.
 *
 * Usage:
 *   npm run leaderboard:reset -- --yes
 */
const fs = require('fs');
const path = require('path');

function loadLocalEnv() {
  const file = path.resolve(__dirname, '..', '.env.local');
  if (!fs.existsSync(file)) return;

  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || Object.prototype.hasOwnProperty.call(process.env, match[1])) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function targetLabel(raw) {
  try {
    const parsed = new URL(raw);
    return parsed.protocol + '//' + parsed.hostname;
  } catch (_) {
    return '[configured database]';
  }
}

async function count(db, table) {
  const result = await db.execute(`SELECT COUNT(*) AS count FROM ${table}`);
  return Number(result.rows[0].count);
}

async function main() {
  loadLocalEnv();

  const databaseUrl = process.env.TURSO_DATABASE_URL;
  if (!databaseUrl || !/^(libsql|https|wss?):/i.test(databaseUrl)) {
    throw new Error(
      'TURSO_DATABASE_URL is missing or is not hosted. Run `vercel env pull .env.local` first.'
    );
  }

  // Load only after the hosted URL is validated; server/db.js otherwise falls
  // back to data/scores.db during local development.
  const { db } = require('../server/db');
  const before = {
    players: await count(db, 'players'),
    scores: await count(db, 'scores'),
  };

  console.log('Leaderboard:', targetLabel(databaseUrl));
  console.log(`Rows found: ${before.players} players, ${before.scores} scores`);

  if (!process.argv.slice(2).includes('--yes')) {
    console.log('No data changed. To permanently reset it, run:');
    console.log('npm run leaderboard:reset -- --yes');
    process.exitCode = 2;
    return;
  }

  const tx = await db.transaction('write');
  try {
    // Delete children first even though the foreign key also cascades. This
    // makes the intended scope explicit and works with every libSQL setting.
    await tx.execute('DELETE FROM scores');
    await tx.execute('DELETE FROM players');
    await tx.commit();
  } finally {
    tx.close();
  }

  const after = {
    players: await count(db, 'players'),
    scores: await count(db, 'scores'),
  };
  if (after.players !== 0 || after.scores !== 0) {
    throw new Error(`Reset verification failed: ${after.players} players, ${after.scores} scores remain`);
  }

  console.log(`Reset complete: removed ${before.players} players and ${before.scores} scores.`);
}

main().catch((error) => {
  console.error('Leaderboard reset failed:', error && error.message);
  process.exitCode = 1;
});
