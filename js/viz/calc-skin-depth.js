/* SIPI — viz/calc-skin-depth.js
 * Copper skin depth, surface resistance, where skin effect sets in for a given
 * thickness, and the roughness multiplier. Maths: js/models/calc-models.js (C.skin).
 * Requires viz-kit.js and calc-models.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit, M = NS.calc;

  NS.viz.calcSkinDepth = function (root) {
    return K.calc(root, {
      inputs: [
        { id: 'f', label: 'Frequency', kind: 'si', unit: 'Hz', min: 1e5, max: 1e11, log: true, def: 1e9, positive: true },
        { id: 't', label: 'Copper thickness', kind: 'length', unit: 'µm', base: 1e-6, dp: 1,
          min: 2, max: 200, log: true, def: 35, positive: true, hint: '1 oz/ft² copper is about 35 µm.' },
        { id: 'rq', label: 'RMS roughness R<sub>q</sub>', kind: 'length', unit: 'µm', base: 1e-6, dp: 2,
          min: 0.05, max: 10, log: true, def: 0.5, lo: 0, hint: 'RMS (R<sub>q</sub>), not peak-to-valley R<sub>z</sub>.' }
      ],
      compute: (v) => M.skin(v.f, v.t, v.rq),
      outputs: (r) => [
        { k: 'Skin depth δ', v: K.si(r.delta, 'm') },
        { k: 'Surface resistance R<sub>s</sub>', v: K.si(r.rs, 'Ω/□') },
        { k: 'δ ÷ half-thickness', v: r.ratio.toPrecision(3) },
        { k: 'Skin effect sets in above', v: K.si(r.fHalf, 'Hz') },
        { k: 'Roughness multiplier', v: r.kr.toFixed(3) + '×' }
      ],
      chart: {
        draw(s, T, v, r) {
          const pts = [];
          for (let i = 0; i <= 200; i++) { const f = 1e5 * Math.pow(1e6, i / 200); pts.push([f, M.skinDepth(f)]); }
          const P = K.plot(s, T, {
            pad: { l: 62, r: 16, t: 20, b: 32 },
            x: { min: 1e5, max: 1e11, log: true, fmt: (x) => K.si(x, 'Hz', 1), title: 'frequency' },
            y: { min: 1e-7, max: 1e-3, log: true, fmt: (y) => K.si(y, 'm', 1), title: 'δ' }
          }).grid();
          P.trace(pts, T.signal, { width: 2.2, label: 'δ', unit: 'm' });
          P.hline(v.t * 1e-6 / 2, T.reflect, [4, 4], 'half the copper');
          if (v.rq > 0) P.hline(v.rq * 1e-6, T.muted, [2, 4], 'Rq roughness');
          P.vline(v.f, T.ink2, [3, 4]);
          K.dot(s.ctx, P.X(v.f), P.Y(r.delta), T.signal, true);
          P.frame();
          return [{ label: 'skin depth, copper', colour: T.signal },
                  { label: 'half the thickness', colour: T.reflect, dash: true },
                  { label: 'RMS roughness', colour: T.muted, dash: true }];
        }
      }
    });
  };
})();
