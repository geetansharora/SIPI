/* SIPI — viz/home-showcase.js
 * Three working models on the homepage, one swipe apart.
 *
 * The homepage used to DESCRIBE an interactive comparison in prose and then send
 * the reader to Lab B to press the buttons themselves. A visitor deciding in five
 * seconds whether this site is different from a textbook never got that far. So
 * these are the real models, not illustrations of them:
 *
 *   reflections   K.line1D / K.line1DAt   — lossless line by superposition
 *   eye           K.channelImpulse + K.singleBit — causal two-term loss channel
 *   PDN           K.pdnLadder             — the same ladder Lab C reduces
 *
 * Nothing here re-implements a model. Every number these panels print comes from
 * the shared kit, so a homepage that disagreed with its own lab would be a bug in
 * one place rather than a difference of opinion between two.
 *
 * Cost, measured before this was written: a channel recompute is 0.26 ms and a
 * 200-point PDN sweep is 0.60 ms, so each panel can recompute on every slider
 * event without scheduling or debouncing. The carousel is CSS scroll-snap, which
 * means the swipe is the browser's own and costs nothing.
 *
 * Requires js/viz-kit.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;

  /* Plot height from panel width. A phone panel is about 340 px across and a
     260 px plot there leaves no room for the control and the readout without
     pushing the link below the fold, which is the one thing this section cannot
     afford to do. */
  const plotH = (w) => (w < 420 ? 172 : w < 620 ? 208 : 232);

  /* ---------- the models, separated from the drawing ----------
     Each panel makes a claim in words underneath it, and a claim a reader can see
     is a claim something should be checking. These are pure, take only their
     control value, and are published on SIPI.models so check-models.js can assert
     the CLAIMS -- reflection limits, eye monotonicity, the anti-resonance that
     moves but never leaves -- without a DOM and without restating a formula. */
  const Z0 = 50, RS = 10, TD = 500, TR = 120;             // ohms, ohms, ps, ps
  const SPS = 16, NFFT = 2048, SWING = 0.5;               // +/-0.5 V, 1 V pp
  /* The ISI window is ASYMMETRIC because the channel is. A causal two-term loss
     response has essentially no pre-cursor -- measured at 14 dB the taps at -2 UI
     and beyond are 0.000 -- and a long post-cursor tail. A symmetric +/-3 window
     therefore spends three of its seven symbols on taps that contribute nothing
     and truncates the tail that does, capturing 82.4% of the total ISI. One
     pre-cursor and six post-cursors captures 89.1% of it, and the eye stops
     looking lopsided because the window finally matches the physics. */
  const PRE = 1, POST = 6, NSYM = PRE + 1 + POST;
  const F_LO = 1e3, F_HI = 1e9, NPT = 220, TARGET = 0.02; // Hz, Hz, points, ohms

  const M = {
    reflect(rl) {
      const L = K.line1D({ Z0, Rs: RS, td: TD, vs: 1, RL: rl, tr: TR, nWave: 24 });
      return { line: L, gamma: L.GL, vFinal: L.vFinal };
    },

    /* The eye the way an ISI-limited eye actually is: every combination of the
       symbols around the cursor, superposed from the single-bit response. See
       PRE/POST above for why the window is not centred. 2^8 = 256 patterns, which
       redraw well inside one frame. */
    eye(lossDb) {
      const h = K.channelImpulse(lossDb, SPS, NFFT);
      const sb = K.singleBit(h, SPS), sbr = sb.sbr, cur = sb.cursor;
      const val = (i) => (i >= 0 && i < sbr.length ? sbr[i] : 0);
      /* The cursor symbol's index. In the sum below, symbol k reads the response
         at an index shifted by -(k - centre)*SPS, so a symbol ABOVE the centre
         reads earlier and is therefore a PRE-cursor. Six post-cursors means the
         cursor sits at index POST, not at PRE -- written the other way round
         first, which produced six pre-cursor taps of nearly zero and an eye that
         opened as loss rose. */
      const centre = POST;
      /* ONE unit interval, centred on the cursor, so the crossings land on the
         left and right edges of the frame. Two UI is the other convention and it
         is the wrong one here: it puts the eye in the middle half of a wide
         canvas with a flat tail either side, and the shape a reader recognises
         stops being the first thing they see. */
      const half = SPS >> 1;
      const traces = [];
      let hiMin = Infinity, loMax = -Infinity;
      for (let pat = 0; pat < (1 << NSYM); pat++) {
        const row = new Float64Array(SPS + 1);
        for (let j = 0; j <= SPS; j++) {
          let v = 0;
          for (let k = 0; k < NSYM; k++) {
            const d = (pat >> k) & 1 ? 1 : -1;
            v += d * val(cur - half + j - (k - centre) * SPS);
          }
          row[j] = v * SWING;
          if (j === half) {                              // the decision instant
            if ((pat >> centre) & 1) { if (row[j] < hiMin) hiMin = row[j]; }
            else if (row[j] > loMax) loMax = row[j];
          }
        }
        traces.push(row);
      }
      return { traces, hiMin, loMax, opening: hiMin - loMax, sps: SPS, swing: SWING };
    },

    pdnStages(n) {
      return [
        { name: 'VRM', series: null, shunt: { r: 0.005, l: 0.005 / (2 * Math.PI * 100e3) } },
        { name: 'bulk', series: { r: 4e-4, l: 1.2e-9 }, shunt: { r: 0.01, l: 2.5e-9, c: 47e-6, n: 4 } },
        { name: 'board', series: { r: 6e-4, l: 250e-12 },
          shunt: { r: 0.008, l: 700e-12, c: 100e-9, n: n } },
        { name: 'package', series: { r: 8e-4, l: 120e-12 }, shunt: { r: 0.05, l: 250e-12, c: 100e-9, n: 12 } },
        { name: 'die', series: { r: 2e-3, l: 40e-12 }, shunt: { r: 5e-3, l: 2e-12, c: 200e-9 } }
      ];
    },

    pdn(n) {
      const st = M.pdnStages(n), pts = [];
      let peak = -Infinity, fPeak = 0;
      for (let i = 0; i <= NPT; i++) {
        const f = F_LO * Math.pow(F_HI / F_LO, i / NPT);
        const zc = K.pdnLadder(st, f).z;
        const z = Math.hypot(zc.re, zc.im);
        pts.push([f, z]);
        /* Only the anti-resonance above the board bank is in scope. The VRM's own
           rise at low frequency is not a resonance and naming it one would be wrong. */
        if (f > 1e5 && z > peak) { peak = z; fPeak = f; }
      }
      return { pts, peak, fPeak, target: TARGET };
    },

    consts: { Z0, RS, TD, TR, SPS, NSYM, SWING, F_LO, F_HI, TARGET }
  };
  (NS.models = NS.models || {}).homeShowcase = M;

  const setOut = (root, name, text) => {
    const el = root.querySelector('[data-out="' + name + '"]');
    if (el) el.textContent = text;
  };

  /* ---------- panel 1: reflections ----------
     Rs = 10 ohm is a real push-pull driver against a 50 ohm line, so Gamma_s is
     -0.67 and an unterminated far end rings for several round trips instead of
     settling in one. That is the point of the panel: the default shows the
     ringing, and dragging the load to 50 ohm collapses it to a single clean step.
     A source-matched version would be tidier and would teach nothing, because one
     reflection that lands and stops looks the same as no reflection at all. */
  function reflections(root) {
    const cv = root.querySelector('[data-cv="reflect"]');
    const p = { rl: 220 };

    function draw(T) {
      const s = K.canvas(cv, plotH(cv.clientWidth || 360));
      const r = M.reflect(p.rl), L = r.line;
      const tMax = 8 * M.consts.TD;   // 4 ns exactly, so ticks land on whole ns

      /* The axis holds the overshoot an open-ish load produces, above the source
         voltage, and the undershoot a low load produces. Fixing it to the worst
         case over the slider's whole range keeps the trace from rescaling under
         the reader's finger -- a plot that resizes while you drag hides the very
         change you are dragging to see. */
      const P = K.plot(s, T, {
        pad: { l: 42, r: 12, t: 14, b: 28 },
        /* Explicit ticks, not a count. `count` divides the span evenly, so 5 over
           4000 ps gives 800 ps steps and the labels round to 0,1,2,2,3,4 -- a
           duplicate that reads as a mistake in the plot rather than in the axis. */
        x: { min: 0, max: tMax, ticks: [0, 1000, 2000, 3000, 4000],
             fmt: (v) => (v / 1000).toFixed(0), title: 'ns' },
        y: { min: -0.35, max: 1.75, count: 5, fmt: (v) => v.toFixed(1), title: 'V' }
      }).grid();

      const N = 420;
      const at = (xn) => {
        const out = [];
        for (let i = 0; i <= N; i++) {
          const tt = tMax * i / N;
          out.push([tt, K.line1DAt(L, xn, tt).v]);
        }
        return out;
      };

      P.hline(r.vFinal, T.muted, [2, 4]);
      P.trace(at(1), T.reflect, { width: 1.5 });      // far end, where the load is
      P.trace(at(0), T.signal, { width: 2.1 });       // near end, where a scope sits
      P.frame();

      const ctx = P.ctx, B = P.box;
      if (!P.narrow) {
        K.text(ctx, 'at the driver', B.L + 6, B.TP + 12, T.signal, 10, 'left');
        K.text(ctx, 'at the load', B.L + 6, B.TP + 26, T.reflect, 10, 'left');
      }

      setOut(root, 'rl', Math.round(p.rl) + ' \u03A9');
      setOut(root, 'gamma', (r.gamma >= 0 ? '+' : '\u2212') + Math.abs(r.gamma).toFixed(2));
      setOut(root, 'rsay', Math.abs(r.gamma) < 0.02
        ? 'matched \u2014 nothing comes back'
        : (Math.abs(r.gamma) * 100).toFixed(0) + '% of the wave turns around, '
          + (r.gamma > 0 ? 'in phase' : 'inverted'));
    }

    const m = K.mount({ root, params: p, draw });
    const sl = root.querySelector('#hs-rl');
    sl.addEventListener('input', () => { p.rl = +sl.value; m.render(); });
    return m;
  }

  /* ---------- panel 2: eye ----------
     Drawn straight to the context rather than through P.trace: 128 alpha-blended
     traces is what makes an eye look like an eye, and a trace call per pattern
     would spend more time in bookkeeping than in drawing. */
  function eye(root) {
    const cv = root.querySelector('[data-cv="eye"]');
    const p = { loss: 8 };

    function draw(T) {
      const s = K.canvas(cv, plotH(cv.clientWidth || 360));
      const e = M.eye(p.loss), sps = e.sps;

      const P = K.plot(s, T, {
        pad: { l: 46, r: 12, t: 14, b: 28 },
        x: { min: -0.5, max: 0.5, ticks: [-0.5, -0.25, 0, 0.25, 0.5],
             fmt: (v) => v.toFixed(2), title: 'UI' },
        y: { min: -0.62, max: 0.62, count: 5, fmt: (v) => (v * 1000).toFixed(0), title: 'mV' }
      }).grid();

      const ctx = P.ctx;
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = K.rgba(T.signal, 0.34);
      ctx.beginPath();
      for (let i = 0; i < e.traces.length; i++) {
        const row = e.traces[i];
        for (let j = 0; j < row.length; j++) {
          const x = P.X(j / sps - 0.5), y = P.Y(row[j]);
          j ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
      }
      ctx.stroke();
      ctx.restore();

      if (e.opening > 0) {
        P.hline(e.hiMin, T.reflect, [3, 3]);
        P.hline(e.loMax, T.reflect, [3, 3]);
      }
      P.frame();

      setOut(root, 'loss', p.loss.toFixed(0) + ' dB');
      setOut(root, 'open', e.opening > 0 ? (e.opening * 1000).toFixed(0) + ' mV' : 'closed');
      setOut(root, 'esay', e.opening <= 0
        ? 'the eye is shut \u2014 no sampling instant separates a one from a zero'
        : e.opening * 1000 < 80
          ? 'barely open; equalisation is no longer optional'
          : 'open, and every decibel of loss takes more of it');
    }

    const m = K.mount({ root, params: p, draw });
    const sl = root.querySelector('#hs-loss');
    sl.addEventListener('input', () => { p.loss = +sl.value; m.render(); });
    return m;
  }

  /* ---------- panel 3: PDN ----------
     Board capacitors are the control because adding them is the move everyone
     reaches for first, and because it is the clearest demonstration that the move
     has a cost: each bank is a parallel resonance against the inductance above it,
     so the dip it creates arrives with a peak beside it. Sweeping the count moves
     the dip down and the peak with it; it never removes the peak. */
  function pdn(root) {
    const cv = root.querySelector('[data-cv="pdn"]');
    const p = { n: 12 };

    function draw(T) {
      const s = K.canvas(cv, plotH(cv.clientWidth || 360));
      const z = M.pdn(p.n);

      const P = K.plot(s, T, {
        pad: { l: 50, r: 12, t: 14, b: 28 },
        x: { min: M.consts.F_LO, max: M.consts.F_HI, log: true,
             fmt: (K.fmt && K.fmt.hz) ? K.fmt.hz : String, title: 'Hz' },
        y: { min: 1e-3, max: 1, log: true,
             fmt: (v) => (v >= 1 ? v.toFixed(0) : (v * 1000).toFixed(0) + 'm'), title: '|Z|' }
      }).grid();

      P.hline(z.target, T.muted, [2, 4]);
      P.trace(z.pts, T.signal, { width: 2 });
      if (z.peak > 0) {
        P.vline(z.fPeak, T.alarm, [3, 3]);
        K.dot(P.ctx, P.X(z.fPeak), P.Y(z.peak), T.alarm, T.surface, 3);
      }
      P.frame();

      const ctx = P.ctx, B = P.box;
      if (!P.narrow) K.text(ctx, 'target 20 m\u03A9', B.L + 6, P.Y(z.target) - 5, T.muted, 10, 'left');

      setOut(root, 'ncap', String(p.n));
      setOut(root, 'zpk', (z.peak * 1000).toFixed(0) + ' m\u03A9');
      setOut(root, 'fpk', z.fPeak >= 1e7 ? (z.fPeak / 1e6).toFixed(0) + ' MHz'
                        : z.fPeak >= 1e6 ? (z.fPeak / 1e6).toFixed(1) + ' MHz'
                                         : (z.fPeak / 1e3).toFixed(0) + ' kHz');
      setOut(root, 'psay', z.peak > z.target
        ? 'the peak is above target \u2014 more capacitors move it, they do not remove it'
        : 'under target across the band');
    }

    const m = K.mount({ root, params: p, draw });
    const sl = root.querySelector('#hs-ncap');
    sl.addEventListener('input', () => { p.n = +sl.value; m.render(); });
    return m;
  }

  /* ---------- the carousel ----------
     Scroll-snap does the swipe, so touch, trackpad, momentum and rubber-banding
     are the platform's rather than a gesture handler's. JavaScript only drives the
     arrows, the dots and the keyboard, and only reads scroll position to keep them
     in step. With JS off the section is still three readable panels side by side
     that can be scrolled — degraded, not broken. */
  NS.viz.homeShowcase = function (root) {
    const track = root.querySelector('[data-track]');
    const panels = Array.from(root.querySelectorAll('.demo'));
    const dots = Array.from(root.querySelectorAll('[data-dot]'));
    const prev = root.querySelector('[data-nav="prev"]');
    const next = root.querySelector('[data-nav="next"]');
    const live = root.querySelector('[data-live]');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

    const mounts = [reflections(panels[0]), eye(panels[1]), pdn(panels[2])];
    let index = 0, ticking = 0;

    function go(i, smooth) {
      index = Math.max(0, Math.min(panels.length - 1, i));
      track.scrollTo({
        left: panels[index].offsetLeft - track.offsetLeft,
        behavior: smooth && !reduce.matches ? 'smooth' : 'auto'
      });
      sync();
    }

    function sync() {
      dots.forEach((d, i) => {
        d.setAttribute('aria-current', i === index ? 'true' : 'false');
        d.tabIndex = i === index ? 0 : -1;
      });
      panels.forEach((el, i) => {
        /* Off-screen panels stay in the accessibility tree and stay focusable.
           A carousel that hides two thirds of its content from a screen reader has
           traded one audience for another, and scroll-snap already lets a keyboard
           user reach them. Only the visual position changes. */
        el.setAttribute('aria-hidden', 'false');
      });
      if (prev) prev.disabled = index === 0;
      if (next) next.disabled = index === panels.length - 1;
      if (live) live.textContent = 'Panel ' + (index + 1) + ' of ' + panels.length
        + ': ' + (panels[index].dataset.title || '');
    }

    /* Which panel is showing is whichever one's centre is nearest the track's
       centre — the only definition that stays correct mid-swipe, at any panel
       width, and when a partial neighbour is visible on a wide screen. */
    function nearest() {
      const mid = track.scrollLeft + track.clientWidth / 2;
      let best = 0, bestD = Infinity;
      panels.forEach((el, i) => {
        const c = el.offsetLeft - track.offsetLeft + el.offsetWidth / 2;
        const d = Math.abs(c - mid);
        if (d < bestD) { bestD = d; best = i; }
      });
      return best;
    }

    const onScroll = () => {
      if (ticking) return;
      ticking = requestAnimationFrame(() => {
        ticking = 0;
        const i = nearest();
        if (i !== index) { index = i; sync(); }
      });
    };

    const onKey = (e) => {
      if (e.key === 'ArrowLeft') { go(index - 1, true); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { go(index + 1, true); e.preventDefault(); }
    };

    track.addEventListener('scroll', onScroll, { passive: true });
    if (prev) prev.addEventListener('click', () => go(index - 1, true));
    if (next) next.addEventListener('click', () => go(index + 1, true));
    dots.forEach((d, i) => d.addEventListener('click', () => go(i, true)));
    root.addEventListener('keydown', onKey);

    sync();

    return {
      start() {},
      stop() {},
      destroy() {
        cancelAnimationFrame(ticking);
        track.removeEventListener('scroll', onScroll);
        root.removeEventListener('keydown', onKey);
        mounts.forEach((m) => m && m.teardown && m.teardown());
      }
    };
  };
})();
