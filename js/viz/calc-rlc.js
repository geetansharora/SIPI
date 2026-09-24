/* SIPI — viz/calc-rlc.js
 * LC / RLC resonance calculator: series, parallel, or a real capacitor
 * (C with its ESL and ESR). Maths: js/models/calc-models.js (C.rlc, C.rlcZ).
 * Requires js/viz-kit.js and js/models/calc-models.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit, M = NS.calc;
  const hz = (x) => K.si(x, 'Hz');
  /* "151 – 167 MHz" rather than "151 MHz – 167 MHz": one unit keeps the tile on one line. */
  const band = (a, b) => {
    const A = hz(a).split(' '), B = hz(b).split(' ');
    return A[1] === B[1] ? A[0] + ' \u2013 ' + B[0] + ' ' + B[1] : hz(a) + ' \u2013 ' + hz(b);
  };

  NS.viz.calcRlc = function (root) {
    const keep = {};                      // this chart's axis ranges, held while they still fit
    return K.calc(root, {
      selects: [{
        id: 'mode', label: 'Circuit', def: 'series',
        options: [['series', 'Series RLC'], ['parallel', 'Parallel RLC'], ['cap', 'Capacitor']],
        onPick(val, v) {
          if (val === 'cap' && v.mode !== 'cap') Object.assign(v, { R: 0.01, L: 0.5e-9, C: 100e-9 });
          if (val !== 'cap' && v.mode === 'cap') Object.assign(v, { R: 1, L: 10e-9, C: 100e-12 });
        }
      }],
      inputs: [
        { id: 'R', label: (v) => (v.mode === 'cap' ? 'ESR' : 'Resistance R'), kind: 'si', unit: 'Ω',
          alias: ['ohm', 'ohms'], min: 1e-3, max: 1e4, log: true, def: 1, positive: true },
        { id: 'L', label: (v) => (v.mode === 'cap' ? 'ESL' : 'Inductance L'), kind: 'si', unit: 'H',
          min: 1e-12, max: 1e-3, log: true, def: 10e-9, positive: true },
        { id: 'C', label: 'Capacitance C', kind: 'si', unit: 'F',
          min: 1e-15, max: 1e-3, log: true, def: 100e-12, positive: true }
      ],
      compute: (v) => M.rlc(v.mode === 'cap' ? 'series' : v.mode, v.R, v.L, v.C),
      outputs: (r, v) => [
        { k: v.mode === 'cap' ? 'Self-resonant frequency' : 'Resonant frequency f₀', v: hz(r.f0) },
        { k: 'Q', v: r.Q >= 100 ? r.Q.toFixed(0) : r.Q.toPrecision(3) },
        { k: '−3 dB bandwidth', v: hz(r.bw) },
        { k: 'Band edges f₁ – f₂', v: band(r.f1, r.f2) },
        { k: 'Damping ratio ζ', v: r.zeta.toPrecision(3) },
        { k: v.mode === 'parallel' ? '|Z| at f₀ (peak)' : '|Z| at f₀ (minimum)', v: K.si(r.zAtF0, 'Ω') },
        { k: '√(L/C)', v: K.si(r.z0, 'Ω') }
      ],
      chart: {
        draw(s, T, v, r) {
          const mode = v.mode === 'cap' ? 'series' : v.mode;
          const [lo, hi] = K.sticky(keep, 'x', r.f0 / 100, r.f0 * 100, true);
          const pts = []; let zmin = Infinity, zmax = 0;
          for (let i = 0; i <= 320; i++) {
            const f = lo * Math.pow(hi / lo, i / 320), z = M.rlcZ(mode, v.R, v.L, v.C, f).mag;
            pts.push([f, z]); zmin = Math.min(zmin, z); zmax = Math.max(zmax, z);
          }
          const [ylo, yhi] = K.sticky(keep, 'y', zmin / 1.5, zmax * 1.5, true);
          const P = K.plot(s, T, {
            pad: { l: 62, r: 16, t: 20, b: 32 },
            x: { min: lo, max: hi, log: true, fmt: (x) => K.si(x, 'Hz', 1), title: 'frequency' },
            y: { min: ylo, max: yhi, log: true, fmt: (y) => K.si(y, 'Ω', 1), title: '|Z|' }
          }).grid();
          K.shadeX(P, r.f1, r.f2, K.rgba(T.signal, 0.12));
          P.trace(pts, T.signal, { width: 2.2, label: '|Z|', unit: 'Ω' });
          P.vline(r.f0, T.ink2, [3, 4], 'f₀ ' + hz(r.f0));
          K.dot(s.ctx, P.X(r.f0), P.Y(r.zAtF0), T.signal, true);
          P.frame();
          return [{ label: '|Z|', colour: T.signal },
                  { label: '−3 dB band', colour: K.rgba(T.signal, 0.35) }];
        }
      }
    });
  };
})();
