/* The build entry point, so that one command works everywhere.
 *
 * Webpack 4 hashes internal module identifiers with md4, and OpenSSL 3 — which
 * is every Node from 17 on — refuses to produce it, so a plain `webpack` run
 * dies with ERR_OSSL_EVP_UNSUPPORTED. Naming a different hashFunction in
 * webpack.config.js is not enough on its own: ConcatenatedModule (scope
 * hoisting, which production mode turns on) calls for md4 directly, ignoring
 * the setting. The flag is genuinely required.
 *
 * It used to be passed as `NODE_OPTIONS=--openssl-legacy-provider webpack ...`
 * in the npm script. That is shell syntax for setting a variable on one
 * command, and cmd.exe has no such syntax — it reads the whole thing as a
 * program name and reports that 'NODE_OPTIONS' is not recognized. So the build
 * worked on the Vercel builder and failed on Windows, which meant `vercel build`
 * could not be run here to check a deploy before shipping it.
 *
 * Spawning node with the flag sidesteps the shell on both platforms: no
 * variable syntax, no cross-env dependency, same bundle either way. It has to
 * be a child process because --openssl-legacy-provider is read at startup and
 * cannot be turned on from inside a program that is already running.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const webpack = path.join(__dirname, 'node_modules', 'webpack', 'bin', 'webpack.js');

const r = spawnSync(
  process.execPath,
  ['--openssl-legacy-provider', webpack, '--mode', 'production', ...process.argv.slice(2)],
  { stdio: 'inherit', cwd: __dirname }
);

process.exit(r.status === null ? 1 : r.status);
