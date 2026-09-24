/* SIPI — viz/calc-mounting-inductance.js
 * The via pair under a decoupling capacitor: loop inductance, and what it does
 * to the part's self-resonance. Maths: js/models/calc-models.js (C.mount), which
 * uses K.viaLoopInductance -- the same exact model as the via pages.
 * Requires viz-kit.js and calc-models.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit, M = NS.calc;

  NS.viz.calcMountingInductance = function (root) {
    const keep = {};                      // this chart's axis ranges, held while they still fit
    return K.calc(root, {
      inputs: [
        { id: 'h', label: 'Via length to the plane pair', kind: 'length', unit: 'mil', base: 25.4e-6, dp: 1,
          min: 2, max: 120, log: true, def: 20, positive: true },
        { id: 'd', label: 'Via drill diameter', kind: 'length', unit: 'mil', base: 25.4e-6, dp: 1,
          min: 4, max: 20, def: 8, positive: true },
        { id: 's', label: 'Via pitch (centre to centre)', kind: 'length', unit: 'mil', base: 25.4e-6, dp: 1,
          min: 10, max: 200, log: true, def: 40, positive: true },
        { id: 'esl', label: 'Capacitor ESL (the part)', kind: 'si', unit: 'H', min: 50e-12, max: 2e-9, log: true,
          def: 300e-12, positive: true },
        { id: 'cap', label: 'Capacitance', kind: 'si', unit: 'F', min: 1e-9, max: 100e-6, log: true, def: 100e-9, positive: true }
      ],
      compute: (v) => M.mount(v.h, v.d, v.s, v.esl, v.cap),
      outputs: (r, v) => (v.s > v.d ? [
        { k: 'Via-pair loop inductance', v: K.si(r.lVia, 'H') },
        { k: 'ESL + vias', v: K.si(r.lTot, 'H') },
        { k: 'Share from the vias', v: (r.viaShare * 100).toFixed(0) + ' %' },
        { k: 'Self-resonance, part alone', v: K.si(r.srfPart, 'Hz') },
        { k: 'Self-resonance, mounted', v: K.si(r.srf, 'Hz') },
        { k: '√(L/C), mounted', v: K.si(r.z0, 'Ω') }
      ] : [{ k: 'Geometry', wide: true, tone: 'alarm', v: 'The pitch must exceed the drill diameter — these vias would overlap' }]),
      chart: {
        draw(s, T, v, r) {
          const sLo = v.d * 1.05, sHi = K.sticky(keep, 'x', 0, Math.max(1.5 * v.s, 3 * v.d), false)[1], pts = [];
          for (let i = 0; i <= 200; i++) {
            const sp = sLo + (sHi - sLo) * i / 200;
            pts.push([sp, M.mount(v.h, v.d, sp, v.esl, v.cap).lVia]);
          }
          const top = K.sticky(keep, 'y', 0, pts[pts.length - 1][1] * 1.05, false)[1];
          const P = K.plot(s, T, {
            pad: { l: 58, r: 16, t: 20, b: 32 },
            x: { min: 0, max: sHi, count: 5, fmt: (x) => x.toFixed(0), title: 'via pitch, mil' },
            y: { min: 0, max: top, count: 5, fmt: (y) => K.si(y, 'H', 2), title: 'loop inductance' }
          }).grid();
          K.shadeX(P, 0, v.d, K.rgba(T.alarm, 0.08));
          P.trace(pts, T.signal, { width: 2.2, label: 'via-pair L', unit: 'H' });
          if (v.s > v.d) K.dot(s.ctx, P.X(v.s), P.Y(r.lVia), T.signal, true);
          P.frame();
          return [{ label: 'via-pair loop inductance against pitch', colour: T.signal },
                  { label: 'pitch ≤ drill: vias overlap', colour: K.rgba(T.alarm, 0.35) }];
        }
      }
    });
  };
})();
