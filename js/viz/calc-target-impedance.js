/* SIPI — viz/calc-target-impedance.js
 * Target impedance from rail voltage, allowed ripple and the transient step.
 * Maths: js/models/calc-models.js (C.ztarget). Requires viz-kit.js and calc-models.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit, M = NS.calc;

  NS.viz.calcTargetImpedance = function (root) {
    return K.calc(root, {
      inputs: [
        { id: 'v', label: 'Rail voltage', kind: 'si', unit: 'V', min: 0.3, max: 12, log: true, def: 0.8, positive: true },
        { id: 'ripple', label: 'Allowed ripple', kind: 'plain', unit: '%', dp: 2, min: 0.5, max: 10, def: 3,
          positive: true, hi: 100 },
        { id: 'di', label: 'Transient current step ΔI', kind: 'si', unit: 'A', min: 0.01, max: 500, log: true,
          def: 20, positive: true }
      ],
      compute: (v) => M.ztarget(v.v, v.ripple, v.di),
      outputs: (r) => [
        { k: 'Target impedance', v: K.si(r.z, 'Ω') },
        { k: 'Allowed ripple ΔV', v: K.si(r.dv, 'V') }
      ],
      chart: {
        draw(s, T, v, r) {
          const [ylo, yhi] = K.decades(r.z / 30, r.z * 30);
          const P = K.plot(s, T, {
            pad: { l: 62, r: 16, t: 20, b: 32 },
            x: { min: 1e3, max: 1e9, log: true, fmt: (x) => K.si(x, 'Hz', 1), title: 'frequency' },
            y: { min: ylo, max: yhi, log: true, fmt: (y) => K.si(y, 'Ω', 1), title: '|Z| of the rail' }
          }).grid();
          K.shadeY(P, r.z, yhi, K.rgba(T.alarm, 0.07));
          P.trace([[1e3, r.z], [1e9, r.z]], T.signal, { width: 2.4, label: 'target', unit: 'Ω' });
          K.text(s.ctx, 'ripple exceeds ' + v.ripple + ' % here', P.box.L + 8, P.Y(r.z) - 12, T.alarm, 10, 'left');
          K.text(s.ctx, 'Zₜ = ' + K.si(r.z, 'Ω'), P.box.R - 6, P.Y(r.z) + 14, T.signal, 10, 'right');
          P.frame();
          return [{ label: 'target impedance', colour: T.signal },
                  { label: 'above target', colour: K.rgba(T.alarm, 0.35) }];
        }
      }
    });
  };
})();
