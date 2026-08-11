/* Client for the global leaderboard API.
 *
 * Loaded by both editions before their own script, and shared so the two never
 * drift apart on wire format. Everything hangs off window.MangoBoard.
 *
 * The board is a nice-to-have layered over a game that has always run offline:
 * every call resolves rather than rejects, and the caller falls back to the
 * local house table when a request comes back null. A dead server or a blocked
 * fetch must never keep the game-over card from appearing.
 */
(function (w) {
  'use strict';

  var DEVICE_KEY = 'mangoMania.deviceId';
  var QUEUE_KEY = 'mangoMania.pending';
  var SNAP_KEY = 'mangoMania.lastBoard';
  var TIMEOUT = 6000;
  var SLIDE_MS = 620;
  /* How long the previous standings sit still before the rows start moving.
   * Long enough to read the old order, short enough not to feel like a stall. */
  var HOLD_MS = 900;

  /* Identity is per browser, not per person: it is what ties repeat runs to one
   * leaderboard row without asking anyone to make an account. Cleared storage
   * means a new player as far as the board is concerned. */
  function deviceId() {
    var id;
    try {
      id = localStorage.getItem(DEVICE_KEY);
      if (id) return id;
    } catch (e) {
      // Storage blocked: a fresh id each run, so scores land as separate rows.
    }
    id = 'dev-';
    if (w.crypto && w.crypto.randomUUID) {
      id += w.crypto.randomUUID().replace(/-/g, '').slice(0, 24);
    } else {
      for (var i = 0; i < 24; i += 1) {
        id += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)];
      }
    }
    try { localStorage.setItem(DEVICE_KEY, id); } catch (e) { }
    return id;
  }

  function ask(path, opts) {
    var o = opts || {};
    // AbortController rather than a bare Promise.race: without it a hung request
    // keeps its socket open behind the resolved timeout.
    var ctl = w.AbortController ? new w.AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT);
    o.signal = ctl ? ctl.signal : undefined;
    return fetch(path, o)
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (v) { clearTimeout(timer); return v; });
  }

  function normalized(v) {
    return String(v || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function identity(row) {
    return [normalized(row.name), normalized(row.company), row.avatar || 'avatar1'].join('\u001f');
  }

  /* Old snapshots can still contain one row from each Vercel hostname. Keep
   * the best score for a visible profile and carry YOU across from any lower
   * duplicate, so cached data cannot briefly recreate the server-side bug. */
  function dedupe(rows) {
    var out = [];
    var seats = {};
    (rows || []).forEach(function (row) {
      var id = identity(row);
      var at = seats[id];
      if (at === undefined) {
        seats[id] = out.length;
        out.push(Object.assign({}, row));
        return;
      }
      var old = out[at];
      var mine = !!old.me || !!row.me;
      if ((Number(row.score) || 0) > (Number(old.score) || 0)) {
        out[at] = Object.assign({}, row, { me: mine });
      } else {
        old.me = mine;
      }
    });
    out.sort(function (a, b) { return (Number(b.score) || 0) - (Number(a.score) || 0); });
    out.forEach(function (row, i) { row.rank = i + 1; });
    return out;
  }

  /* A run finished while the network was down is still a real score. It parks in
   * localStorage and rides along with the next successful submit. */
  function queue(body) {
    try {
      var q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
      q.push(body);
      localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-20)));
    } catch (e) { }
  }

  function drain() {
    var q;
    try { q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch (e) { return; }
    if (!q.length) return;
    try { localStorage.removeItem(QUEUE_KEY); } catch (e) { }
    q.forEach(function (body) {
      ask('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    });
  }

  var MangoBoard = {
    deviceId: deviceId,

    /* Who this browser is currently playing as. A player is identified by
     * device AND name AND company, so every call that asks "which row is mine"
     * has to send all three. Both editions already publish their profile
     * reader as window.getPlayerProfile; this just borrows it rather than
     * keeping a second copy of the storage key in sync. */
    profile: function () {
      try {
        return w.getPlayerProfile ? w.getPlayerProfile() : null;
      } catch (e) { return null; }
    },

    /* Called on every game over, not just personal bests: the scores table is
     * the play history, and the leaderboard picks the best out of it server-side. */
    submit: function (profile, score, layers, edition) {
      var p = profile || {};
      var body = {
        deviceId: deviceId(),
        name: p.name || 'Player',
        company: p.company || '',
        avatar: p.avatar || 'avatar1',
        score: Math.max(0, Math.round(score) || 0),
        layers: Math.max(0, Math.round(layers) || 0),
        edition: edition || 'tap',
      };
      return ask('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(function (res) {
        if (res) drain(); else queue(body);
        return res;
      });
    },

    /* Hold the old standings on screen before letting the new ones in.
     *
     * The whole reason the card opens on the previous board is so the player
     * sees where everyone stood and then watches the rows move. A fetch that
     * answers in eight milliseconds swaps the board before their eyes have
     * even landed on it, and the animation is wasted. This waits out the beat
     * whether the answer was instant or slow: the pause is what makes the
     * movement legible, not the latency. */
    paced: function (p) {
      return Promise.all([p, new Promise(function (done) {
        setTimeout(done, HOLD_MS);
      })]).then(function (both) { return both[0]; });
    },

    top: function (limit) {
      var p = MangoBoard.profile ? MangoBoard.profile() : null;
      return ask('/api/leaderboard?limit=' + (limit || 20)
        + '&me=' + encodeURIComponent(deviceId())
        + '&meName=' + encodeURIComponent((p && p.name) || '')
        + '&meCompany=' + encodeURIComponent((p && p.company) || '')
        + '&meAvatar=' + encodeURIComponent((p && p.avatar) || 'avatar1'))
        .then(function (res) {
          if (res && res.leaderboard) res.leaderboard = dedupe(res.leaderboard);
          return res;
        });
    },

    /* The score sitting at the top of the board right now, and whether it is
     * already this player's. Read once at the start of a run to give them a
     * mark to chase, so the celebration can fire the instant they pass it.
     *
     * Null when the board is empty or the server cannot be reached: there is
     * nothing to take the lead from, so nothing fires. `mine` matters because a
     * player who already holds first place cannot climb to it — beating their
     * own record is a different thing, and the game-over card says so. */
    leader: function () {
      return MangoBoard.top(1).then(function (res) {
        var rows = res && res.leaderboard;
        if (!rows || !rows.length) return null;
        return { score: rows[0].score, mine: !!rows[0].me };
      });
    },

    me: function () {
      var p = MangoBoard.profile ? MangoBoard.profile() : null;
      return ask('/api/me/' + encodeURIComponent(deviceId())
        + '?name=' + encodeURIComponent((p && p.name) || '')
        + '&company=' + encodeURIComponent((p && p.company) || ''));
    },

    // The board as it stood the last time this device looked at it. Opening the
    // card paints this first so the new standings can be shown arriving, rather
    // than the player finding the shuffle already over.
    snapshot: function () {
      try {
        var raw = localStorage.getItem(SNAP_KEY);
        var rows = raw ? JSON.parse(raw) : null;
        rows = rows && rows.length ? dedupe(rows) : null;
        return rows && rows.length ? rows : null;
      } catch (e) { return null; }
    },

    remember: function (rows) {
      try {
        localStorage.setItem(SNAP_KEY, JSON.stringify(dedupe(rows).map(function (r) {
          return {
            key: r.key, name: r.name, company: r.company,
            avatar: r.avatar, score: r.score, me: r.me
          };
        })));
      } catch (e) { /* private mode, or the quota is full */ }
    },

    /* Move the rows to their new standings instead of cutting to them.
     *
     * FLIP: the DOM is already in its new order when this runs, so each row is
     * translated back to where it used to sit and then released. Only transform
     * animates, which keeps a six-row reshuffle off the layout path entirely.
     *
     * `before` maps row key -> its old y. A row with no entry is new to the
     * board and fades in where it landed rather than sliding from nowhere. */
    slide: function (list, before, climbers) {
      if (!list) return;
      var rows = [].slice.call(list.children);
      var reduced = w.matchMedia
        && w.matchMedia('(prefers-reduced-motion: reduce)').matches;
      var moving = [];

      rows.forEach(function (row) {
        var key = row.getAttribute('data-key');
        var was = before[key];
        var now = row.getBoundingClientRect().top;

        if (was == null) { row.classList.add('arriving'); return; }
        var shift = was - now;
        if (!shift || reduced) return;

        // Invert with no transition attached yet, pinning the row to its old
        // seat. The transition is added only once this frame has been painted.
        row.style.transform = 'translateY(' + shift + 'px)';
        moving.push(row);
      });

      /* Releasing on a later frame is what makes the rows travel. Setting the
       * inverted transform and clearing it in one frame lets the browser fold
       * both values into a single style change, and a forced reflow does not
       * help: transform is paint-only, so reading offsetHeight flushes layout
       * without ever committing the transform the transition needs to start
       * from. Two frames guarantee the inverted position is on screen first. */
      function release() {
        moving.forEach(function (row) {
          row.classList.add('sliding');
          row.style.transform = '';
        });
      }
      if (moving.length) {
        if (w.requestAnimationFrame) {
          w.requestAnimationFrame(function () { w.requestAnimationFrame(release); });
        } else {
          release();
        }
      }

      setTimeout(function () {
        rows.forEach(function (row) {
          row.classList.remove('sliding', 'arriving');
          row.style.transform = '';
          // Flash only the rows that gained ground, once the sliding has settled.
          if (climbers && climbers[row.getAttribute('data-key')]) {
            row.classList.add('climbed');
            setTimeout(function () { row.classList.remove('climbed'); }, 520);
          }
        });
        // The two frames spent pinning the rows come before the transition, so
        // the wait has to cover them or the tail of the slide gets cut off.
      }, reduced ? 0 : SLIDE_MS + 80);
    },

    positions: function (list) {
      var at = {};
      if (!list) return at;
      [].slice.call(list.children).forEach(function (row) {
        var key = row.getAttribute('data-key');
        if (key) at[key] = row.getBoundingClientRect().top;
      });
      return at;
    },

    dedupe: dedupe,
  };

  w.MangoBoard = MangoBoard;
}(window));
