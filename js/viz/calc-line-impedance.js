/* SIPI — viz/calc-line-impedance.js
 * Microstrip (Hammerstad–Jensen, with thickness) and centred stripline (Cohn,
 * exact for zero thickness): Z0, ε_eff, delay, and the width for a target.
 * Maths: js/models/calc-models.js (C.zline, C.widthFor). Requires viz-kit.js and calc-models.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit, M = NS.calc;
  const mil = (x) => (isFinite(x) ? x.toFixed(x < 10 ? 2 : 1) + ' mil (' + (x * 25.4).toFixed(0) + ' µm)' : 'out of range');

  NS.viz.calcLineImpedance = function (root) {
    const keep = {};                      // this chart's axis ranges, held while they still fit
    return K.calc(root, {
      selects: [{
        id: 'type', label: 'Structure', def: 'ms', options: [['ms', 'Microstrip'], ['sl', 'Stripline (centred)']],
        onPick(val, v) {
          if (val === 'sl' && v.type !== 'sl') Object.assign(v, { w: 5, h: 15 });
          if (val === 'ms' && v.type !== 'ms') Object.assign(v, { w: 10, h: 5.5 });
        }
      }],
      laminate: {},
      inputs: [
        { id: 'w', label: 'Trace width w', kind: 'length', unit: 'mil', base: 25.4e-6, dp: 2,
          min: 1, max: 100, log: true, def: 10, positive: true },
        { id: 'h', label: (v) => (v.type === 'sl' ? 'Plane spacing b' : 'Dielectric height h'),
          kind: 'length', unit: 'mil', base: 25.4e-6, dp: 2, min: 1, max: 100, log: true, def: 5.5, positive: true },
        { id: 't', label: 'Copper thickness t', kind: 'length', unit: 'mil', base: 25.4e-6, dp: 2,
          min: 0, max: 3, def: 1.4, lo: 0, when: (v) => v.type === 'ms', hint: '1 oz copper is about 1.4 mil.' },
        { id: 'dk', label: 'Dk', kind: 'plain', dp: 2, min: 1, max: 12, def: 4.2, lo: 1 },
        { id: 'target', label: 'Target Z₀', kind: 'plain', unit: 'Ω', dp: 1, min: 20, max: 150, def: 50, positive: true }
      ],
      compute: (v) => {
        const t = v.type === 'ms' ? v.t : 0;
        const z = M.zline(v.type, v.w, v.h, t, v.dk);
        return Object.assign(z, { wFor: M.widthFor(v.target, v.type, v.h, t, v.dk) });
      },
      outputs: (r, v) => [
        { k: 'Z₀', v: r.z0.toFixed(2) + ' Ω' },
        { k: 'ε<sub>eff</sub>', v: r.eeff.toFixed(3) },
        { k: 'Delay', v: (r.tpd * 1e12).toFixed(1) + ' ps/in' },
        { k: 'Width for ' + v.target + ' Ω', v: mil(r.wFor) },
        { k: 'Model', v: v.type === 'sl' ? 'Cohn, t = 0, exact' : 'Hammerstad–Jensen' }
      ],
      chart: {
        draw(s, T, v, r) {
          const t = v.type === 'ms' ? v.t : 0;
          const [lo, hi] = K.sticky(keep, 'x', v.w / 4, v.w * 4, true), pts = [];
          for (let i = 0; i <= 200; i++) {
            const w = lo * Math.pow(hi / lo, i / 200);
            pts.push([w, M.zline(v.type, w, v.h, t, v.dk).z0]);
          }
          const top = K.sticky(keep, 'y', 0, Math.min(250, Math.max(pts[0][1], v.target) * 1.05), false)[1];
          const P = K.plot(s, T, {
            pad: { l: 52, r: 16, t: 20, b: 32 },
            x: { min: lo, max: hi, log: true,
                 fmt: (x) => String(Number(x.toPrecision(2))), title: 'trace width, mil' },
            y: { min: 0, max: top, count: 5, fmt: (y) => y.toFixed(0), title: 'Z₀, Ω' }
          }).grid();
          P.trace(pts, T.signal, { width: 2.2, label: 'Z0', unit: 'Ω' });
          P.hline(v.target, T.reflect, [4, 4], 'target');
          if (isFinite(r.wFor) && r.wFor > lo && r.wFor < hi) P.vline(r.wFor, T.reflect, [2, 4]);
          K.dot(s.ctx, P.X(v.w), P.Y(r.z0), T.signal, true);
          P.frame();
          return [{ label: 'Z₀ against width', colour: T.signal }, { label: 'target and its width', colour: T.reflect, dash: true }];
        }
      }
    });
  };
})();
