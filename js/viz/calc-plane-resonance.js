/* SIPI — viz/calc-plane-resonance.js
 * Cavity modes of a rectangular plane pair. Maths: js/models/calc-models.js (C.cavity).
 * Requires viz-kit.js and calc-models.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit, M = NS.calc;
  const hz = (x) => K.si(x, 'Hz');

  NS.viz.calcPlaneResonance = function (root) {
    return K.calc(root, {
      inputs: [
        { id: 'a', label: 'Plane length a', kind: 'length', unit: 'mm', base: 1e-3, dp: 1,
          min: 5, max: 500, log: true, def: 100, positive: true },
        { id: 'b', label: 'Plane width b', kind: 'length', unit: 'mm', base: 1e-3, dp: 1,
          min: 5, max: 500, log: true, def: 60, positive: true },
        { id: 'dk', label: 'Dk between the planes', kind: 'plain', dp: 2, min: 1, max: 10, def: 4.2, lo: 1 },
        { id: 'fmax', label: 'Show modes up to', kind: 'si', unit: 'Hz', min: 0.1e9, max: 20e9, log: true,
          def: 5e9, positive: true }
      ],
      compute: (v) => M.cavity(v.a, v.b, v.dk, v.fmax),
      outputs: (r) => [
        { k: 'First mode', v: hz(r.first) },
        { k: 'f(1,0)', v: hz(r.f10) },
        { k: 'f(0,1)', v: hz(r.f01) },
        { k: 'f(1,1)', v: hz(r.f11) },
        { k: 'Modes in range', v: String(r.modes.length) }
      ],
      chart: {
        /* A fixed log axis, 50 MHz to 50 GHz, so the modes stay where they are:
           the plane size and Dk move them, and "show modes up to" is a marker on
           the axis rather than the axis itself -- as the axis, it redrew every
           mode in a new place on each step without any of them having moved. */
        draw(s, T, v, r) {
          const lo = 5e7, hi = 5e10;
          const P = K.plot(s, T, {
            pad: { l: 26, r: 16, t: 20, b: 32 },
            x: { min: lo, max: hi, log: true, fmt: (x) => K.si(x, 'Hz', 1), title: 'frequency' },
            y: { min: 0, max: 1, ticks: [], fmt: () => '' }
          }).grid();
          const ctx = s.ctx, B = P.box;
          K.shadeX(P, v.fmax, hi, K.rgba(T.muted, 0.08));
          const shown = r.modes.filter((q) => q.f >= lo && q.f <= hi).slice(0, 80);
          shown.forEach((q, i) => {
            const x = P.X(q.f), axial = q.m === 0 || q.n === 0;
            K.line(ctx, x, B.B, x, B.TP + (axial ? 18 : 34), axial ? T.signal : T.reflect, 2);
            if (i < 6) K.text(ctx, q.m + ',' + q.n, x, B.TP + (axial ? 10 : 26), axial ? T.signal : T.reflect, 9, 'center');
          });
          P.vline(v.fmax, T.ink2, [3, 4], 'up to ' + K.si(v.fmax, 'Hz'));
          P.frame();
          return [{ label: '(m,0) and (0,n) modes', colour: T.signal }, { label: '(m,n) modes', colour: T.reflect }];
        }
      }
    });
  };
})();
