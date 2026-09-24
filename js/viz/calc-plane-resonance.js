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
        draw(s, T, v, r) {
          const P = K.plot(s, T, {
            pad: { l: 26, r: 16, t: 20, b: 32 },
            x: { min: 0, max: v.fmax, count: 5, fmt: (x) => K.si(x, 'Hz', 2), title: 'frequency' },
            y: { min: 0, max: 1, ticks: [], fmt: () => '' }
          }).grid();
          const ctx = s.ctx, B = P.box;
          const shown = r.modes.slice(0, 60);
          shown.forEach((q, i) => {
            const x = P.X(q.f), axial = q.m === 0 || q.n === 0;
            K.line(ctx, x, B.B, x, B.TP + (axial ? 18 : 34), axial ? T.signal : T.reflect, 2);
            if (i < 14) K.text(ctx, q.m + ',' + q.n, x, B.TP + (axial ? 10 : 26), axial ? T.signal : T.reflect, 9, 'center');
          });
          if (r.modes.length > shown.length) K.text(ctx, '+' + (r.modes.length - shown.length) + ' more', B.R - 4, B.TP + 10, T.muted, 10, 'right');
          P.frame();
          return [{ label: '(m,0) and (0,n) modes', colour: T.signal }, { label: '(m,n) modes', colour: T.reflect }];
        }
      }
    });
  };
})();
