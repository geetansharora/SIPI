/* SI & PI — viz/spectrum.js
 * The spectrum of a trapezoidal clock, and what actually moves the knee.
 *
 * Exact. The nth harmonic of a trapezoidal pulse train is a product of two sincs:
 *     |c_n| = 2·A·d · |sinc(n·d)| · |sinc(n·t_r/T)|
 * The first sinc comes from the pulse width, the second from the finite edge.
 * Their breakpoints — 1/(π·d·T) and 1/(π·t_r) — are the two corners in the
 * envelope, and the second one is the only one that moves when the edge changes.
 *
 * Requires js/viz-kit.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;

  const NH = 4001;               // odd harmonics only survive at d = 0.5
  const F_LO = 1e6, F_HI = 2e11; // 1 MHz – 200 GHz
  const DB_LO = -80, DB_HI = 6;

  const sinc = K.sincPi;         // the shared definition, in viz-kit.js

  /* ONE edge definition, shared by the waveform and the spectrum.

     p.tr is the 10-90% rise time — the SI convention, and what the knee formulas
     assume. The trapezoid spectrum needs the FULL ramp, and for a linear ramp the
     10-90% portion is 0.8 of it, so t_ramp = t_r / 0.8.

     The ramp is also clamped to 45% of the period here, where it used to be
     clamped only in the time view: the waveform flattened into a triangle while
     the harmonics kept using the uncapped value, so the two panels could describe
     different edges. Both now read the same number. */
  function edges(p) {
    const T = 1 / p.fclk;
    return Object.assign({ T }, K.edgeRamp(p.tr, T));   // viz-kit.js holds the convention
  }

  function harmonics(p) {
    const { T, ramp } = edges(p);
    const d = 0.5, out = [];
    for (let n = 1; n < NH; n++) {
      const f = n * p.fclk;
      if (f > F_HI) break;
      const a = K.trapezoidHarmonic(n, ramp / T, d);
      if (a > 1e-6) out.push([f, 20 * Math.log10(a)]);
    }
    return out;
  }

  /* Pure functions exposed for the headless model gate (check-models.js).
     Testing physics through the DOM is slow and proves less; these have no
     rendering dependency, so the gate can call them directly. */
  const M = (NS.models = NS.models || {});
  M.edges = edges;
  M.harmonics = harmonics;
  M.sinc = sinc;

  NS.viz.spectrum = function (root) {
    const $ = (s) => root.querySelector(s);
    const cvT = $('[data-cv="time"]'), cvF = $('[data-cv="spec"]');

    const p = { fclk: 10e6, tr: 100e-12 };

    const PRESETS = {
      slowfast: { fclk: 10e6,   tr: 100e-12,
        note: 'A 10 MHz control net driven by a modern buffer. The clock is slow; the spectrum reaches 5 GHz.' },
      slowslow: { fclk: 10e6,   tr: 2000e-12,
        note: 'Same 10 MHz clock, a deliberately slow edge. The knee drops by 20× and the high harmonics collapse.' },
      fastclk:  { fclk: 1000e6, tr: 100e-12,
        note: 'A 100× faster clock with the same edge. The harmonics spread out — but the knee has not moved at all.' },
      serial:   { fclk: 4000e6, tr: 30e-12,
        note: 'A serial link: fast clock and a fast edge together. Now the knee is genuinely out at 17 GHz.' }
    };

    /* ---------- time domain ---------- */
    function drawTime(T) {
      const s = K.canvas(cvT, 150);
      const per = 1 / p.fclk, span = 2.5 * per;
      const P = K.plot(s, T, {
        pad: { l: 40, r: 14, t: 14, b: 26 },
        x: { min: 0, max: span, count: 5, fmt: (v) => (v * 1e9).toFixed(v * 1e9 < 10 ? 1 : 0), title: 'ns' },
        y: { min: -0.15, max: 1.15, ticks: [0, 0.5, 1], fmt: (v) => v.toFixed(1), title: 'V' }
      }).grid();

      const tr = edges(p).ramp;                     // identical to the spectrum's
      const pts = [];
      for (let i = 0; i <= 600; i++) {
        const t = (i / 600) * span;
        const ph = (t % per) / per;
        const rise = tr / per, hi = 0.5;
        let v;
        if (ph < rise) v = ph / rise;
        else if (ph < hi) v = 1;
        else if (ph < hi + rise) v = 1 - (ph - hi) / rise;
        else v = 0;
        pts.push([t, v]);
      }
      P.trace(pts, T.signal, { width: 2, glow: true }).frame();
      // mark one edge so the slider has something to point at
      const E = edges(p);
      K.text(s.ctx, 't_r(10-90) = ' + (E.tr1090 * 1e12).toFixed(0) + ' ps'
             + (E.clamped ? ' — clamped by the period' : ''),
             P.box.R - 2, P.box.TP + 8, E.clamped ? T.alarm : T.reflect, 10, 'right');
    }

    /* ---------- spectrum ---------- */
    function drawSpec(T) {
      const s = K.canvas(cvF, 230);
      const P = K.plot(s, T, {
        pad: { l: 46, r: 14, t: 18, b: 32 },
        x: { min: F_LO, max: F_HI, log: true, fmt: K.fmt.hz, title: 'frequency' },
        y: { min: DB_LO, max: DB_HI, ticks: [0, -20, -40, -60, -80], fmt: (v) => v + ' dB', title: 'dB rel. swing' }
      }).grid();

      // envelope: flat, then −20 dB/decade past 1/(π·d·T), then −40 past 1/(π·t_r)
      const f1 = 1 / (Math.PI * 0.5 / p.fclk), f2 = 1 / (Math.PI * p.tr);
      const env = [];
      for (let i = 0; i <= 300; i++) {
        const f = F_LO * Math.pow(F_HI / F_LO, i / 300);
        let dB = 20 * Math.log10(2 / Math.PI);
        if (f > f1) dB -= 20 * Math.log10(f / f1);
        if (f > f2) dB -= 20 * Math.log10(f / f2);
        env.push([f, dB]);
      }
      P.trace(env, T.muted, { width: 1.2, dash: [5, 4] });

      // the harmonics themselves, as stems
      const hs = harmonics(p);
      const ctx = s.ctx, y0 = P.Y(DB_LO);
      ctx.save();
      ctx.strokeStyle = T.signal; ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (const [f, dB] of hs) {
        if (dB < DB_LO || f < F_LO) continue;
        const x = P.X(f);
        if (x < P.box.L || x > P.box.R) continue;
        ctx.moveTo(x, y0); ctx.lineTo(x, P.Y(dB));
      }
      ctx.stroke(); ctx.restore();

      // the knee — the number the whole page is about
      const knee = 0.5 / edges(p).tr1090;
      if (knee > F_LO && knee < F_HI) {
        P.vline(knee, T.reflect, [3, 3]);
        K.text(ctx, 'knee ' + K.fmt.hz(knee), P.X(knee) + 5, P.box.TP + 8,
               T.reflect, 10, P.X(knee) > (P.box.L + P.box.R) * 0.62 ? 'right' : 'left');
      }
      P.frame();
      K.text(ctx, 'envelope', P.box.L + 6, P.Y(-6), T.muted, 10, 'left');
    }

    function readouts() {
      const E = edges(p);
      const knee = 0.5 / E.tr1090;
      $('[data-out="knee"]').textContent = K.fmt.hz(knee);
      $('[data-out="bw"]').textContent = K.fmt.hz(0.35 / E.tr1090);
      $('[data-out="fclk"]').textContent = K.fmt.hz(p.fclk);
      const n = harmonics(p).filter((h) => h[1] > -40).length;
      $('[data-out="nh"]').textContent = n + ' above −40 dB';
      $('#sp-f-out').value = K.fmt.hz(p.fclk);
      $('#sp-tr-out').value = (p.tr * 1e12).toFixed(0) + ' ps';
      $('#sp-f').value = Math.round(Math.log10(p.fclk / 1e6) * 100);
      $('#sp-tr').value = Math.round(p.tr * 1e12);
    }

    const m = K.mount({
      root, params: p, height: 0,
      draw(T) { drawTime(T); drawSpec(T); readouts(); }
    });

    function clearPreset() {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      $('[data-out="note"]').textContent = 'Custom';
    }
    $('#sp-f').addEventListener('input', (e) => {
      p.fclk = 1e6 * Math.pow(10, +e.target.value / 100); clearPreset(); m.render();
    });
    $('#sp-tr').addEventListener('input', (e) => {
      p.tr = +e.target.value * 1e-12; clearPreset(); m.render();
    });
    root.querySelectorAll('.preset[data-preset]').forEach((b) => {
      b.addEventListener('click', () => {
        const c = PRESETS[b.dataset.preset];
        if (!c) return;   // a .preset with no data-preset is not one
        p.fclk = c.fclk; p.tr = c.tr;
        root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
        $('[data-out="note"]').textContent = c.note;
        m.render();
      });
    });

    root.querySelector('.preset[data-preset="slowfast"]').setAttribute('aria-pressed', 'true');
    $('[data-out="note"]').textContent = PRESETS.slowfast.note;
    m.render();

    return { start() {}, stop() {}, destroy() { m.teardown(); } };
  };
})();
