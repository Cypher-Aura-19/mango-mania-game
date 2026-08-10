/* Webpack ran on defaults until now — no config file at all, just CLI flags.
 * This keeps the same build and writes the two implicit pieces down.
 *
 * The babel rule is what `--module-bind js=babel-loader` in the old npm script
 * did. It is spelled out here because --module-bind is a CLI-only shorthand,
 * and leaving it in the script meant the transpile silently depended on which
 * command you happened to run: `webpack` on its own produced an untranspiled
 * bundle. .babelrc targets ios >= 9 and android >= 4 — this is a game people
 * open on whatever phone is in their pocket, so that reach is the point.
 *
 * hashFunction covers the md4 calls that honour it. It does not cover all of
 * them (see build.js), but the ones it does are no longer asking OpenSSL for a
 * hash it will not give. Filenames are unaffected; this is internal bookkeeping.
 */
const path = require('path');

module.exports = {
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'main.js',
    hashFunction: 'sha256',
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: 'babel-loader',
      },
    ],
  },
};
