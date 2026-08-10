/* CSV serialisation for the two exports.
 *
 * RFC 4180 quoting: a field is quoted when it holds a comma, a quote, a newline
 * or leading/trailing space, and inner quotes are doubled. Player names and
 * company names are free text from the profile form, so this is the part that
 * actually matters — an unescaped comma in "Orchard Labs, Inc" would shift every
 * later column in the row.
 *
 * Fields opening with = + - @ get a leading apostrophe. Excel treats those as
 * formulas, which turns a name like "-Max" into a spreadsheet expression and, in
 * the worst case, a command the sheet offers to run.
 */
const NEEDS_QUOTE = /[",\r\n]|^\s|\s$/;
const FORMULA = /^[=+\-@\t\r]/;

function cell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (FORMULA.test(s)) s = "'" + s;
  return NEEDS_QUOTE.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/* CRLF line endings and a UTF-8 BOM, because the point of these files is that
 * they open in Excel: without the BOM it reads the bytes as the local codepage
 * and mangles any non-ASCII name. */
function toCsv(columns, rows) {
  const head = columns.map((c) => cell(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => cell(c.value(r))).join(','));
  return '﻿' + [head, ...body].join('\r\n') + '\r\n';
}

/* Filenames carry a UTC stamp so repeated exports land side by side in the
 * downloads folder instead of overwriting each other. */
function stamped(base) {
  const t = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${base}-${t}.csv`;
}

function send(res, filename, csv) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(csv);
}

const LEADERBOARD_COLUMNS = [
  { label: 'rank', value: (r) => r.rank },
  { label: 'player', value: (r) => r.name },
  { label: 'company', value: (r) => r.company },
  { label: 'best_score', value: (r) => r.score },
  { label: 'layers', value: (r) => r.layers },
  { label: 'total_plays', value: (r) => r.plays },
  { label: 'achieved_at_utc', value: (r) => r.played_at },
];

const SCORES_COLUMNS = [
  { label: 'score_id', value: (r) => r.id },
  { label: 'player', value: (r) => r.name },
  { label: 'company', value: (r) => r.company },
  { label: 'score', value: (r) => r.score },
  { label: 'layers', value: (r) => r.layers },
  { label: 'edition', value: (r) => r.edition },
  { label: 'played_at_utc', value: (r) => r.played_at },
  { label: 'device_id', value: (r) => r.device_id },
];

module.exports = { toCsv, stamped, send, LEADERBOARD_COLUMNS, SCORES_COLUMNS };
