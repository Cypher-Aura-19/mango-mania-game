/* The take-the-lead celebration.
 *
 * Fires the moment a player's live score passes the score at the top of the
 * leaderboard — mid-run, while they are still stacking, not on the game-over
 * card. That instant is the whole point: they should see the party while they
 * are playing, and know they have to hold on to it.
 *
 * Everything hangs off window.MangoParty. Loaded by both editions.
 *
 * Drawn on its own canvas over the game, sized to the game canvas and pinned to
 * it, so it never touches the engine's own draw loop. The canvas is removed the
 * moment the last particle dies — no permanent second surface to composite.
 */
(function (w, d) {
  'use strict';

  var POPPER = './assets/fx/party-popper.svg';
  var FIREWORKS = './assets/fx/fireworks.svg';
  var CONFETTI_BALL = './assets/fx/confetti-ball.svg';

  // Cake-stand palette: the mango yellows and creams the game already uses,
  // plus a hot pink and a mint so the shower reads against both the sky
  // background and the tower itself.
  var COLORS = ['#FFC93C', '#FF7A45', '#FF4F81', '#FFE9A8',
    '#7BE0AD', '#FFFFFF', '#F76B1C'];
  var DURATION = 3400;
  var GRAVITY = 900;

  function rand(a, b) { return a + (Math.random() * (b - a)); }

  /* One scrap of confetti. Rectangles with an independent spin on each axis:
   * scaling x by cos(spin) is what makes a flat scrap look like it is tumbling
   * edge-on and back without the cost of actually drawing it in 3D. */
  function scrap(x, y, vx, vy, w2) {
    return {
      x: x, y: y, vx: vx, vy: vy,
      w: rand(w2 * 0.010, w2 * 0.020),
      h: rand(w2 * 0.014, w2 * 0.028),
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      spin: rand(0, Math.PI * 2),
      spinRate: rand(-9, 9),
      tilt: rand(0, Math.PI * 2),
      tiltRate: rand(-4, 4),
      drag: rand(0.15, 0.4),
      born: 0,
    };
  }

  var running = null;

  var MangoParty = {
    /* True while a celebration is on screen, so a caller can avoid stacking a
     * second one on top of the first. */
    busy: function () { return !!running; },

    /* canvas: the game canvas to cover. Anything else on the page is left
     * alone — the overlay is inserted as a sibling and positioned over it. */
    fire: function (canvas, opts) {
      if (!canvas || !canvas.parentNode) return;
      var o = opts || {};
      if (running) MangoParty.stop();

      var host = canvas.parentNode;
      var box = d.createElement('div');
      box.className = 'party-fx';
      var art = d.createElement('canvas');
      art.className = 'party-fx-canvas';
      box.appendChild(art);

      var banner = null;
      if (o.banner !== false) {
        banner = d.createElement('div');
        banner.className = 'party-banner';
        banner.innerHTML =
          '<img src="' + POPPER + '" alt="" class="party-icon party-icon-l">'
          + '<span class="party-text"><b>' + (o.title || 'You are #1!')
          + '</b><i>' + (o.note || 'Top of the leaderboard') + '</i></span>'
          + '<img src="' + FIREWORKS + '" alt="" class="party-icon party-icon-r">';
        box.appendChild(banner);
      }
      host.appendChild(box);

      /* Match the game canvas's on-screen box, at device pixel density so the
       * scraps have clean edges on a phone.
       *
       * A canvas that is hidden or not laid out yet measures 0, and clamping
       * that to a 1px surface would draw the whole celebration into a single
       * invisible pixel. The overlay is fixed to the viewport, so its own box is
       * the honest fallback: better to shower the screen than nothing at all. */
      var rect = canvas.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 40) rect = box.getBoundingClientRect();
      var dpr = Math.min(2, w.devicePixelRatio || 1);
      var W = Math.max(1, Math.round(rect.width));
      var H = Math.max(1, Math.round(rect.height));
      art.width = Math.round(W * dpr);
      art.height = Math.round(H * dpr);
      art.style.width = W + 'px';
      art.style.height = H + 'px';
      var ctx = art.getContext('2d');
      ctx.scale(dpr, dpr);

      /* Two poppers firing inward from the bottom corners, the way a real one
       * is held — plus a light shower from above so the middle of the screen
       * is not empty while the corner bursts are still climbing. */
      var bits = [];
      var burst = Math.round(o.count || 90);
      for (var i = 0; i < burst; i += 1) {
        var left = i % 2 === 0;
        var a = left ? rand(-1.35, -0.55) : rand(-2.59, -1.79);
        var speed = rand(H * 0.9, H * 1.5);
        bits.push(scrap(
          left ? rand(-8, W * 0.12) : rand(W * 0.88, W + 8),
          rand(H * 0.86, H * 1.0),
          Math.cos(a) * speed, Math.sin(a) * speed, W
        ));
      }
      for (var j = 0; j < Math.round(burst * 0.45); j += 1) {
        var s = scrap(rand(0, W), rand(-H * 0.5, -4),
          rand(-40, 40), rand(H * 0.1, H * 0.45), W);
        s.born = rand(0, 900);
        bits.push(s);
      }

      var start = null;
      var raf = 0;
      var last = 0;

      function frame(now) {
        if (start === null) { start = now; last = now; }
        var t = now - start;
        // Clamp the step: a tab that loses focus resumes with a huge delta and
        // every scrap teleports off screen in one frame.
        var dt = Math.min(0.05, (now - last) / 1000);
        last = now;

        ctx.clearRect(0, 0, W, H);
        var alive = 0;

        for (var k = 0; k < bits.length; k += 1) {
          var p = bits[k];
          if (t < p.born) { alive += 1; continue; }
          p.vy += GRAVITY * dt;
          p.vx -= p.vx * p.drag * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.spin += p.spinRate * dt;
          p.tilt += p.tiltRate * dt;
          if (p.y - p.h > H) continue;
          alive += 1;

          // Fade the whole shower out over the last third rather than letting
          // it stop dead, so the screen clears without a visible cut.
          var life = t / DURATION;
          ctx.globalAlpha = life > 0.66 ? Math.max(0, 1 - ((life - 0.66) / 0.34)) : 1;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.tilt);
          ctx.scale(Math.cos(p.spin), 1);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore();
        }
        ctx.globalAlpha = 1;

        if (t < DURATION && alive) {
          raf = w.requestAnimationFrame(frame);
        } else {
          MangoParty.stop();
        }
      }

      running = {
        box: box,
        cancel: function () { if (raf) w.cancelAnimationFrame(raf); },
      };
      raf = w.requestAnimationFrame(frame);

      if (o.sound !== false && o.playAudio) {
        try { o.playAudio(); } catch (e) { /* audio is optional garnish */ }
      }
    },

    stop: function () {
      if (!running) return;
      running.cancel();
      var box = running.box;
      running = null;
      // Let the banner play its exit before the node goes.
      box.classList.add('party-out');
      setTimeout(function () {
        if (box.parentNode) box.parentNode.removeChild(box);
      }, 420);
    },
  };

  /* Watches a live score against the score to beat and fires once when it is
   * passed. Reset at the start of every run.
   *
   * The target is captured when the run starts, not read live: the board can
   * move under the player mid-run, and a celebration that retriggers because
   * someone else's score arrived would be noise. Passing the mark they were
   * chasing when they sat down is the moment worth celebrating. */
  function Chase() {
    this.target = null;
    this.done = false;
  }
  Chase.prototype.arm = function (target) {
    this.target = typeof target === 'number' && target >= 0 ? target : null;
    this.done = false;
  };
  Chase.prototype.check = function (score) {
    if (this.done || this.target === null) return false;
    if (score <= this.target) return false;
    this.done = true;
    return true;
  };

  MangoParty.Chase = Chase;
  MangoParty.assets = {
    popper: POPPER, fireworks: FIREWORKS, confettiBall: CONFETTI_BALL
  };

  w.MangoParty = MangoParty;
}(window, document));
