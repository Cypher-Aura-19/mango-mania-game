/* Vercel serverless entry point.
 *
 * The local server (index.js) both serves files and answers the API. On Vercel
 * those are two different things: assets and HTML are static, handed straight
 * to the CDN by the routes in vercel.json, and only /api reaches this function.
 * So this file mounts the API router and nothing else -- no express.static, no
 * catch-all, no listen(). Vercel invokes the exported app per request.
 *
 * trust proxy is on for the same reason it is locally: the socket address is
 * the edge's, so without it the rate limiter would file every player in the
 * world under one IP.
 */
const express = require('express');

const app = express();
app.set('trust proxy', true);

app.use('/api', require('../server/api'));

module.exports = app;
