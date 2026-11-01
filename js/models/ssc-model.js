/* SI & PI — models/ssc-model.js
 * USB spread-spectrum clocking against the receiver's clock recovery.
 *
 *   SSC         the data rate is pulled down by up to `depth` ppm and back, `fm`
 *               times a second (C-15). Two profiles: a triangle, and a legal
 *               profile that ramps at the specification's slew limit of
 *               1250 ppm/µs and holds at each end
 *   phase       the data's time error against a clock at the average rate is the
 *               running integral of the frequency offset: x(t) = ∫ (Δf/f) dt
 *   CDR         the site's second-order, type-2 loop (K.cdrLoop, the one the
 *               receiver-and-clock page explains)
 *   residual    what the loop fails to follow: r = (1 − H) x, harmonic by
 *               harmonic, since the sweep is periodic and the loop is linear
 *
 * The sweep is periodic, so the steady state is exact from one period's Fourier
 * series: x is sampled N times over a period, transformed, each harmonic k/T
 * multiplied by the complex 1 − H(k/T), and transformed back. No start-up
 * transient and no step-size error.
 *
 * Units: seconds and ppm inside; ps, UI, µs, MHz at the edges.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  NS.models = NS.models || {};
  const K = NS.kit;

  const N = 4096;                                  // samples per SSC period
  const SLEW_LIMIT = 1250;                         // ppm/µs (C-15)
  const GENS = { 1: { rate: 5, ui: 200e-12 }, 2: { rate: 10, ui: 100e-12 } };

  /* The frequency offset, ppm, at sample i of one period: 0 at the start, the
     deepest point half a period later. */
  function profile(cfg) {
    const T = 1 / cfg.fm, dev = new Float64Array(N), D = cfg.depth;
    const ramp = cfg.shape === 'fast' ? Math.min(T / 2, (D / SLEW_LIMIT) * 1e-6) : T / 2;
    for (let i = 0; i < N; i++) {
      const t = (i / N) * T, h = t < T / 2 ? t : t - T / 2;
      const into = ramp > 0 ? Math.min(1, h / ramp) : 1;   // share of the way through this half's ramp
      dev[i] = t < T / 2 ? -D * into : -D * (1 - into);
    }
    return dev;
  }

  /* The data's time error, seconds, against a clock at the sweep's average rate:
     the running integral of the offset, by the trapezoid rule (exact for the
     piecewise-linear profiles here at the sample points), mean removed. */
  function phase(dev, fm) {
    const dt = 1 / fm / N, mean = dev.reduce((a, b) => a + b, 0) / N;
    const x = new Float64Array(N);
    for (let i = 1; i < N; i++) x[i] = x[i - 1] + 0.5 * ((dev[i - 1] - mean) + (dev[i] - mean)) * 1e-6 * dt;
    const xm = x.reduce((a, b) => a + b, 0) / N;
    for (let i = 0; i < N; i++) x[i] -= xm;
    return x;
  }

  /* What the loop leaves: (1 − H) applied to every harmonic of the period. */
  function residual(x, fm, fn, zeta) {
    const re = Float64Array.from(x), im = new Float64Array(N);
    K.fft(re, im, false);
    for (let k = 1; k <= N / 2; k++) {
      const L = K.cdrLoop(k * fm, fn, zeta);
      const er = 1 - L.hr, ei = -L.hi;
      const a = re[k] * er - im[k] * ei, b = re[k] * ei + im[k] * er;
      re[k] = a; im[k] = b;
      if (k < N / 2) { re[N - k] = a; im[N - k] = -b; }
    }
    re[0] = 0; im[0] = 0;                          // a constant time offset is no error
    K.fft(re, im, true);
    return re;
  }

  const pp = (a) => { let lo = Infinity, hi = -Infinity; for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v; } return hi - lo; };

  function analyse(cfg) {
    const G = GENS[cfg.gen], dev = profile(cfg), x = phase(dev, cfg.fm);
    const r = cfg.depth > 0 ? residual(x, cfg.fm, cfg.fn, cfg.zeta) : new Float64Array(N);
    let slew = 0;
    const dt = 1e6 / cfg.fm / N;                   // µs per sample
    for (let i = 0; i < N; i++) slew = Math.max(slew, Math.abs(dev[(i + 1) % N] - dev[i]) / dt);
    return {
      G, dev, x, r,
      xpp: pp(x), rpp: pp(r), slew
    };
  }

  NS.models.ssc = { N, SLEW_LIMIT, GENS, profile, phase, residual, pp, analyse };
})();
