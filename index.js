const express = require('express')
const path = require('path')
const opn = require('opn')

const server = express()
const host = 'http://localhost:8082'

// Behind cloudflared the socket address is the tunnel's, so the rate limiter
// would see every player as one IP without this.
server.set('trust proxy', true)

server.use('/assets', express.static(path.resolve(__dirname, './assets')))
server.use('/dist', express.static(path.resolve(__dirname, './dist')))

// Global leaderboard. Mounted before the catch-all below, which answers every
// unmatched path with the game's HTML and would otherwise swallow these.
server.use('/api', require('./server/api'))

// Blink Edition — same game, controlled by eye blinks (webcam)
server.get('/blink', (req, res) => {
  res.sendFile(path.resolve(__dirname, './index-blink.html'));
})

// Score-export console: buttons for the two CSV exports the API serves.
server.get('/export', (req, res) => {
  res.sendFile(path.resolve(__dirname, './export.html'));
})

server.get('*', (req, res) => {
  res.sendFile(path.resolve(__dirname, './index.html'));
})

server.listen(8082, () => {
  console.log(`server started at ${host}`)
  opn(host)
})
