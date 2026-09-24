/* SIPI — viz/calc-return-loss.js
 * Return loss, |Γ|, VSWR and load resistance, from any one of them.
 * Maths: js/models/calc-models.js (C.refl).
 * Requires js/viz-kit.js and js/models/calc-models.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit, M = NS.calc;
  const ohm = (x) => K.si(x, 'Ω');
  const pct = (x) => (x * 100 < 0.1 ? (x * 100).toPrecision(2) : (x * 100).toFixed(x * 100 < 10 ? 2 : 1)) + ' %';

  NS.viz.calcReturnLoss = function (root) {
    const keep = {};                      // this chart's axis ranges, held while they still fit
    return K.calc(root, {
      selects: [{ id: 'given', label: 'Start from', def: 'rl',
                  options: [['rl', 'Return loss'], ['gamma', '|Γ|'], ['vswr', 'VSWR'], ['zl', 'Load R']] }],
      inputs: [
        { id: 'z0', label: 'Reference impedance Z₀', kind: 'si', unit: 'Ω', alias: ['ohm', 'ohms'],
          min: 1, max: 1000, log: true, def: 50, positive: true },
        { id: 'rl', label: 'Return loss', kind: 'plain', unit: 'dB', dp: 2, min: 0, max: 60, def: 20, lo: 0,
          when: (v) => v.given === 'rl' },
        { id: 'gamma', label: 'Reflection coefficient |Γ|', kind: 'plain', dp: 4, min: 0, max: 1, def: 0.1,
          lo: 0, hi: 1, when: (v) => v.given === 'gamma' },
        { id: 'vswr', label: 'VSWR', kind: 'plain', dp: 3, min: 1, max: 20, log: true, def: 1.5, lo: 1,
          when: (v) => v.given === 'vswr' },
        { id: 'zl', label: 'Load resistance Rₗ', kind: 'si', unit: 'Ω', alias: ['ohm', 'ohms'],
          min: 0.1, max: 1e4, log: true, def: 75, positive: true, when: (v) => v.given === 'zl' }
      ],
      compute: (v) => M.refl(v.z0, v.given, v[v.given]),
      outputs: (r, v) => {
        const out = [
          { k: 'Return loss', v: r.rl === Infinity ? '∞ (matched)' : r.rl.toFixed(2) + ' dB' },
          { k: r.known ? 'Γ (signed)' : '|Γ|', v: (r.known ? r.gamma : r.mag).toFixed(4) },
          { k: 'VSWR', v: r.vswr === Infinity ? '∞' : r.vswr.toFixed(3) + ' : 1' },
          { k: 'Reflected power', v: pct(r.pRefl) },
          { k: 'Mismatch loss', v: r.ml === Infinity ? '∞' : r.ml.toPrecision(3) + ' dB' }
        ];
        if (r.known) out.push({ k: 'Load voltage / incident', v: r.vLoad.toFixed(4) });
        else out.push({ k: 'Load is one of two', v: ohm(r.zLow) + ' or ' + ohm(r.zHigh) });
        return out;
      },
      chart: {
        draw(s, T, v, r) {
          const [lo, hi] = K.sticky(keep, 'x', v.z0 / 10, v.z0 * 10, true), top = 60;
          const rlOf = (z) => Math.min(top, -20 * Math.log10(Math.abs((z - v.z0) / (z + v.z0))));
          const pts = [];
          for (let i = 0; i <= 400; i++) { const z = lo * Math.pow(hi / lo, i / 400); pts.push([z, rlOf(z)]); }
          const P = K.plot(s, T, {
            pad: { l: 52, r: 16, t: 20, b: 32 },
            x: { min: lo, max: hi, log: true,
                 fmt: (x) => K.si(x, 'Ω', 2), title: 'load resistance' },
            y: { min: 0, max: top, count: 6, fmt: (y) => y.toFixed(0), title: 'return loss, dB' }
          }).grid();
          P.trace(pts, T.signal, { width: 2.2, label: 'return loss', unit: 'dB' });
          if (isFinite(r.rl)) P.hline(Math.min(r.rl, top), T.ink2, [3, 4], r.rl.toFixed(1) + ' dB');
          const loads = r.known ? [r.zl] : [r.zLow, r.zHigh];
          loads.forEach((z) => {
            if (z >= lo && z <= hi) K.dot(s.ctx, P.X(z), P.Y(Math.min(isFinite(r.rl) ? r.rl : top, top)), T.reflect, true);
          });
          P.vline(v.z0, T.muted, [2, 4], 'Z0');
          P.frame();
          return [{ label: 'return loss against load', colour: T.signal },
                  { label: r.known ? 'this load' : 'the two loads that fit', colour: T.reflect }];
        }
      }
    });
  };
})();
