/* SI & PI — viz/jitter.js
 * The dual-Dirac model, drawn two ways: as a distribution, and as a bathtub.
 *
 * Exact. Bounded jitter collapses to two impulses separated by DJ_pp; random
 * jitter is Gaussian with RMS σ. The convolution is a pair of Gaussians, and
 *     TJ(BER) = DJ_pp + 2·Q(BER)·RJ_rms
 * The bathtub is the same model read as an error rate against sampling position:
 *     BER(t) = ½ [ Q((t − DJ/2)/σ) + Q((UI − DJ/2 − t)/σ) ]
 *
 * Q(x) is evaluated in two regimes so the far tail stays accurate: a Chebyshev
 * erfc below x = 3, and the asymptotic series above it. A single erfc loses all
 * relative accuracy by 1e-12, which is exactly where the answer lives.
 *
 * Requires js/viz-kit.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;

  const SQ2PI = Math.sqrt(2 * Math.PI);

  /* The tail maths moved to viz-kit.js (K.erfc, K.Q, K.Qinv) so the BER
     calculator shares it rather than copying it. Same code, one place. */
  const Q = K.Q, Qinv = K.Qinv;

  /* The sampling interval that meets a target BER, or null when there is none.
     Returns an explicit empty result rather than a sentinel: this previously
     initialised the crossings to 0 and 1 UI and let them fall through when no
     point met the target, so a fully closed eye reported a fully open one.
     A "not found" marker must never sit inside the valid range.

     The dual-Dirac bathtub is symmetric about 0.5 UI and monotone on each wall,
     so each crossing is bisected rather than scanned — sampling resolution then
     cannot decide the answer, and a curve that merely grazes the target is not
     mistaken for one that crosses it. `clipped*` flags an interval running past
     the plotted domain. NaN-safe by construction: !(NaN < target) is true. */
  function opening(ber, target) {
    const MID = 0.5;
    if (!(ber(MID) < target)) return null;         // closed, tangent, or NaN
    const bisect = (a, b) => {                     // ber(a) >= target > ber(b)
      for (let i = 0; i < 60; i++) {
        const m = (a + b) / 2;
        (ber(m) < target) ? (b = m) : (a = m);
      }
      return (a + b) / 2;
    };
    const clippedLo = ber(0) < target, clippedHi = ber(1) < target;
    const lo = clippedLo ? 0 : bisect(0, MID);
    const hi = clippedHi ? 1 : bisect(1, MID);
    return { lo, hi, width: hi - lo, clippedLo, clippedHi };
  }

  /* Pure functions exposed for the headless model gate (check-models.js).
     Testing physics through the DOM is slow and proves less; these have no
     rendering dependency, so the gate can call them directly. */
  const M = (NS.models = NS.models || {});
  M.Q = Q;
  M.Qinv = Qinv;
  M.opening = opening;

  const BERS = [1e-6, 1e-9, 1e-12, 1e-15];
  const norm = (x, s) => Math.exp(-x * x / (2 * s * s)) / (s * SQ2PI);

  /* ─────────── jitter distribution ─────────── */
  NS.viz.jitter = function (root) {
    const $ = (s) => root.querySelector(s);
    const cv = $('[data-cv="hist"]');
    const p = { rj: 1.0, dj: 12, ui: 62.5, beri: 2 };

    const PRESETS = {
      typical: { rj: 1.0, dj: 12, ui: 62.5, beri: 2, note: 'A Gen 4 lane: 1 ps of RJ and 12 ps of DJ in a 62.5 ps UI.' },
      lowrj:   { rj: 0.5, dj: 12, ui: 62.5, beri: 2, note: 'Half the random jitter. TJ drops by 7 ps — because RJ is multiplied by 14.' },
      lowdj:   { rj: 1.0, dj: 6,  ui: 62.5, beri: 2, note: 'Half the deterministic jitter instead. TJ drops by only 6 ps, for the same effort.' },
      strict:  { rj: 1.0, dj: 12, ui: 62.5, beri: 3, note: 'The same link at BER 1e-15. Three more decades cost under 2 ps — the tail is that steep.' }
    };

    function draw(T) {
      const ber = BERS[p.beri], q = Qinv(ber), tj = p.dj + 2 * q * p.rj;
      const span = Math.max(tj * 0.62, p.dj + 6 * p.rj);
      const s = K.canvas(cv, 260);
      const pk = norm(0, p.rj) * 0.5;

      const P = K.plot(s, T, {
        pad: { l: 52, r: 16, t: 20, b: 32 },
        x: { min: -span, max: span, count: 6, fmt: (v) => v.toFixed(0), title: 'ps from ideal edge' },
        y: { min: 0, max: pk * 1.18, count: 4, fmt: () => '', title: 'density' }
      }).grid();

      const pdf = (t) => 0.5 * norm(t + p.dj / 2, p.rj) + 0.5 * norm(t - p.dj / 2, p.rj);
      const pts = [];
      for (let i = 0; i <= 500; i++) { const t = -span + (2 * span) * i / 500; pts.push([t, pdf(t)]); }
      const ctx = s.ctx, B = P.box;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(P.X(-span), P.Y(0));
      for (const [x, y] of pts) ctx.lineTo(P.X(x), P.Y(y));
      ctx.lineTo(P.X(span), P.Y(0)); ctx.closePath();
      ctx.fillStyle = K.rgba(T.signal, 0.16); ctx.fill();
      ctx.restore();
      P.trace(pts, T.signal, { width: 2, glow: true });

      // the two Diracs
      for (const d of [-p.dj / 2, p.dj / 2]) {
        K.line(ctx, P.X(d), P.Y(0), P.X(d), P.Y(pk * 1.06), T.reflect, 1.5, [3, 2]);
        K.dot(ctx, P.X(d), P.Y(pk * 1.06), T.reflect, T.surface, 3.5);
      }
      K.text(ctx, 'DJ = ' + p.dj.toFixed(0) + ' ps', P.X(0), P.Y(pk * 1.12), T.reflect, 10, 'center');

      // TJ span at the chosen BER
      const yT = B.B - 10;
      K.line(ctx, P.X(-tj / 2), yT, P.X(tj / 2), yT, T.alarm, 1.5);
      K.line(ctx, P.X(-tj / 2), yT - 4, P.X(-tj / 2), yT + 4, T.alarm, 1.5);
      K.line(ctx, P.X(tj / 2), yT - 4, P.X(tj / 2), yT + 4, T.alarm, 1.5);
      K.text(ctx, 'TJ @ ' + ber.toExponential(0) + ' = ' + tj.toFixed(1) + ' ps',
             P.X(0), yT - 12, T.alarm, 10, 'center');
      P.frame();

      $('[data-out="tj"]').textContent = tj.toFixed(1) + ' ps';
      $('[data-out="q"]').textContent = (2 * q).toFixed(2) + '×';
      $('[data-out="ber"]').textContent = ber.toExponential(0);
      const budget = tj / p.ui;
      const eb = $('[data-out="budget"]');
      eb.textContent = (budget * 100).toFixed(0) + '% of UI';
      eb.style.color = budget > 0.5 ? 'var(--alarm-text)' : 'var(--ink)';
      $('#jt-rj').value = Math.round(p.rj * 10); $('#jt-rj-out').value = p.rj.toFixed(1) + ' ps';
      $('#jt-dj').value = p.dj; $('#jt-dj-out').value = p.dj + ' ps';
      $('#jt-ber').value = p.beri; $('#jt-ber-out').value = ber.toExponential(0);
    }

    const m = K.mount({ root, params: p, draw });
    const clear = () => {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      $('[data-out="note"]').textContent = 'Custom';
    };
    $('#jt-rj').addEventListener('input', (e) => { p.rj = +e.target.value / 10; clear(); m.render(); });
    $('#jt-dj').addEventListener('input', (e) => { p.dj = +e.target.value; clear(); m.render(); });
    $('#jt-ber').addEventListener('input', (e) => { p.beri = +e.target.value; clear(); m.render(); });
    root.querySelectorAll('.preset[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const q = PRESETS[b.dataset.preset];
      /* A `.preset` without a data-preset is not a preset — the sweep button
         on Lab B is one. Reading straight from the table threw on it. */
      if (!q) return;
      Object.assign(p, q);
      root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      $('[data-out="note"]').textContent = q.note;
      m.render();
    }));
    root.querySelector('.preset[data-preset="typical"]').setAttribute('aria-pressed', 'true');
    $('[data-out="note"]').textContent = PRESETS.typical.note;
    m.render();
    return { start() {}, stop() {}, destroy() { m.teardown(); } };
  };

  /* ─────────── bathtub ─────────── */
  NS.viz.bathtub = function (root) {
    const $ = (s) => root.querySelector(s);
    const cv = $('[data-cv="tub"]');
    const p = { rj: 1.0, dj: 12, ui: 62.5, meas: 8 };   // meas = decades actually measured

    const PRESETS = {
      typical: { rj: 1.0, dj: 12, meas: 8, note: 'Wide floor, steep walls: a link limited by bounded jitter, and that is the fixable kind.' },
      noisy:   { rj: 2.6, dj: 6,  meas: 8, note: 'Narrow floor, shallow walls. This is a noise problem, and it is far more expensive.' },
      clean:   { rj: 0.5, dj: 5,  meas: 8, note: 'Both small. Note how little of the curve you would ever measure directly.' },
      deep:    { rj: 1.0, dj: 12, meas: 12, note: 'If you could measure to 1e-12 directly. At 16 GT/s one point takes about a minute — a whole curve takes days.' }
    };

    function draw(T) {
      const s = K.canvas(cv, 280);
      const P = K.plot(s, T, {
        pad: { l: 58, r: 18, t: 18, b: 34 },
        x: { min: 0, max: 1, count: 5, fmt: (v) => v.toFixed(2), title: 'sampling position (UI)' },
        y: { min: 1e-16, max: 0.5, log: true, fmt: (v) => v.toExponential(0), title: 'BER' }
      }).grid();

      const sig = p.rj / p.ui, dj = p.dj / p.ui;
      const ber = (t) => 0.5 * (Q((t - dj / 2) / sig) + Q((1 - dj / 2 - t) / sig));
      const pts = [];
      for (let i = 0; i <= 600; i++) { const t = i / 600; pts.push([t, Math.max(ber(t), 1e-17)]); }

      const ctx = s.ctx, B = P.box;
      // everything below the measured floor is extrapolation, not measurement
      const yM = P.Y(Math.pow(10, -p.meas));
      ctx.save();
      ctx.fillStyle = K.rgba(T.muted, 0.10);
      ctx.fillRect(B.L, yM, B.R - B.L, B.B - yM);
      ctx.restore();
      K.line(ctx, B.L, yM, B.R, yM, T.muted, 1, [4, 3]);
      K.text(ctx, 'measured down to 1e−' + p.meas, B.L + 8, yM - 9, T.muted, 10, 'left');
      K.text(ctx, 'below here is extrapolated', B.L + 8, yM + 12, T.muted, 10, 'left');

      P.trace(pts, T.signal, { width: 2.2, glow: true });

      // opening at 1e-12 — an interval that may legitimately be empty
      const target = 1e-12;
      const win = opening(ber, target);
      if (win) {
        const y = P.Y(target);
        K.line(ctx, P.X(win.lo), y, P.X(win.hi), y, T.reflect, 2);
        K.line(ctx, P.X(win.lo), y - 5, P.X(win.lo), y + 5, T.reflect, 2);
        K.line(ctx, P.X(win.hi), y - 5, P.X(win.hi), y + 5, T.reflect, 2);
        K.text(ctx, 'eye opening at 1e−12 = ' + (win.width * p.ui).toFixed(1) + ' ps'
                    + (win.clippedLo || win.clippedHi ? ' (runs past the plot)' : ''),
               (P.X(win.lo) + P.X(win.hi)) / 2, y - 12, T.reflect, 10, 'center');
      } else {
        K.text(ctx, 'no sampling position reaches 1e−12 — the eye is closed',
               (B.L + B.R) / 2, P.Y(target) - 12, T.alarm, 11, 'center');
      }
      P.frame();

      const eo = $('[data-out="open"]'), eu = $('[data-out="openui"]');
      eo.textContent = win ? (win.width * p.ui).toFixed(1) + ' ps' : 'closed';
      eu.textContent = win ? (win.width * 100).toFixed(0) + '% UI' : '—';
      eo.style.color = !win || win.width < 0.3 ? 'var(--alarm-text)' : 'var(--ink)';
      eu.style.color = eo.style.color;
      $('[data-out="decades"]').textContent = (12 - p.meas) + ' decades';
      $('#bt-rj').value = Math.round(p.rj * 10); $('#bt-rj-out').value = p.rj.toFixed(1) + ' ps';
      $('#bt-dj').value = p.dj; $('#bt-dj-out').value = p.dj + ' ps';
      $('#bt-meas').value = p.meas; $('#bt-meas-out').value = '1e−' + p.meas;
    }

    const m = K.mount({ root, params: p, draw });
    const clear = () => {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      $('[data-out="note"]').textContent = 'Custom';
    };
    $('#bt-rj').addEventListener('input', (e) => { p.rj = +e.target.value / 10; clear(); m.render(); });
    $('#bt-dj').addEventListener('input', (e) => { p.dj = +e.target.value; clear(); m.render(); });
    $('#bt-meas').addEventListener('input', (e) => { p.meas = +e.target.value; clear(); m.render(); });
    root.querySelectorAll('.preset[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const q = PRESETS[b.dataset.preset];
      /* A `.preset` without a data-preset is not a preset — the sweep button
         on Lab B is one. Reading straight from the table threw on it. */
      if (!q) return;
      Object.assign(p, q);
      root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      $('[data-out="note"]').textContent = q.note;
      m.render();
    }));
    root.querySelector('.preset[data-preset="typical"]').setAttribute('aria-pressed', 'true');
    $('[data-out="note"]').textContent = PRESETS.typical.note;
    m.render();
    return { start() {}, stop() {}, destroy() { m.teardown(); } };
  };
})();
