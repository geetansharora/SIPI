/* SIPI — viz/calc-loss-budget.js
 * Channel insertion loss from the laminate and the copper: dielectric plus
 * conductor loss with roughness, summed over the run against a budget.
 * Maths: js/models/calc-models.js (C.loss). Requires viz-kit.js and calc-models.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit, M = NS.calc;
  const db = (x) => x.toFixed(x < 1 ? 3 : 2) + ' dB';

  NS.viz.calcLossBudget = function (root) {
    const keep = {};                      // this chart's axis ranges, held while they still fit
    return K.calc(root, {
      inputs: [
        { id: 'f', label: 'Frequency (usually Nyquist)', kind: 'si', unit: 'Hz', min: 0.1e9, max: 100e9, log: true,
          def: 16e9, positive: true },
        { id: 'len', label: 'Channel length', kind: 'length', unit: 'in', base: 0.0254, dp: 2,
          min: 0.5, max: 60, log: true, def: 10, positive: true },
        { id: 'dk', label: 'Dk', kind: 'plain', dp: 2, min: 2, max: 6, def: 3.7, lo: 1 },
        { id: 'df', label: 'Df (loss tangent)', kind: 'plain', dp: 4, min: 0.0005, max: 0.03, log: true, def: 0.004, lo: 0 },
        { id: 'w', label: 'Trace width', kind: 'length', unit: 'mil', base: 25.4e-6, dp: 1,
          min: 2, max: 30, log: true, def: 5, positive: true },
        { id: 'z0', label: 'Line impedance Z₀', kind: 'plain', unit: 'Ω', dp: 1, min: 30, max: 120, def: 50, positive: true },
        { id: 'rq', label: 'RMS roughness R<sub>q</sub>', kind: 'length', unit: 'µm', base: 1e-6, dp: 2,
          min: 0.05, max: 5, log: true, def: 0.5, lo: 0 },
        { id: 'budget', label: 'Loss budget', kind: 'plain', unit: 'dB', dp: 1, min: 1, max: 60, def: 20, positive: true }
      ],
      compute: (v) => M.loss(v.f, v.len, v.dk, v.df, v.w, v.z0, v.rq),
      outputs: (r, v) => {
        const margin = v.budget - r.total;
        return [
          { k: 'Conductor (with roughness)', v: db(r.ac) + '/in' },
          { k: 'Dielectric', v: db(r.ad) + '/in' },
          { k: 'Total per inch', v: db(r.per) + '/in' },
          { k: 'Over the channel', v: db(r.total) },
          { k: 'Margin to budget', v: (margin >= 0 ? '+' : '') + margin.toFixed(2) + ' dB', tone: margin >= 0 ? 'ok' : 'alarm' },
          { k: 'Roughness multiplier', v: r.kr.toFixed(2) + '×' },
          { k: 'Dielectric share', v: (r.dielShare * 100).toFixed(0) + ' %' }
        ];
      },
      chart: {
        /* A fixed log frequency axis, 100 MHz to 100 GHz, as the loss pages draw
           it: the frequency input moves a marker along curves that stay put. */
        draw(s, T, v, r) {
          const lo = 1e8, hi = 1e11, c = [], d = [], t = [];
          for (let i = 0; i <= 240; i++) {
            const f = lo * Math.pow(hi / lo, i / 240), q = M.loss(f, v.len, v.dk, v.df, v.w, v.z0, v.rq);
            c.push([f, q.ac * v.len]); d.push([f, q.ad * v.len]); t.push([f, q.total]);
          }
          const top = K.sticky(keep, 'y', 0, Math.max(r.total * 1.6, v.budget * 1.1), false)[1];
          const P = K.plot(s, T, {
            pad: { l: 52, r: 16, t: 20, b: 32 },
            x: { min: lo, max: hi, log: true, fmt: (x) => K.si(x, 'Hz', 1), title: 'frequency' },
            y: { min: 0, max: top, count: 5, fmt: (y) => y.toFixed(y < 10 ? 1 : 0), title: 'loss, dB' }
          }).grid();
          P.trace(c, T.reflect, { width: 1.8, label: 'conductor', unit: 'dB' });
          P.trace(d, T.muted, { width: 1.8, dash: [4, 3], label: 'dielectric', unit: 'dB' });
          P.trace(t, T.signal, { width: 2.4, label: 'total', unit: 'dB' });
          P.hline(v.budget, T.alarm, [4, 4], 'budget ' + v.budget + ' dB');
          P.vline(v.f, T.ink2, [3, 4]);
          K.dot(s.ctx, P.X(v.f), P.Y(Math.min(r.total, top)), T.signal, true);
          P.frame();
          return [{ label: 'total', colour: T.signal }, { label: 'conductor \u00d7 roughness', colour: T.reflect },
                  { label: 'dielectric', colour: T.muted, dash: true }, { label: 'budget', colour: T.alarm, dash: true }];
        }
      }
    });
  };
})();
