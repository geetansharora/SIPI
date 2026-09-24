/* SIPI — viz/calc-ber.js
 * BER ↔ Q ↔ total jitter, dual-Dirac. Maths: js/models/calc-models.js (C.ber),
 * which uses the same Gaussian tail (K.Q, K.Qinv) as the jitter panels.
 * Requires js/viz-kit.js and js/models/calc-models.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit, M = NS.calc;
  const s_ = (x) => K.si(x, 's');

  NS.viz.calcBer = function (root) {
    return K.calc(root, {
      selects: [{ id: 'rho', label: 'Transition density ρ', def: '0.5',
                  options: [['0.5', '0.5 · random data'], ['1', '1 · table convention']] }],
      inputs: [
        { id: 'ber', label: 'Target BER', kind: 'sci', min: 1e-18, max: 1e-3, log: true, def: 1e-12,
          positive: true, hi: 0.4 },
        { id: 'rj', label: 'Random jitter RJ (rms)', kind: 'si', unit: 's', min: 1e-14, max: 1e-10, log: true,
          def: 1e-12, positive: true },
        { id: 'dj', label: 'Deterministic jitter DJ(δδ)', kind: 'si', unit: 's', min: 0, max: 50e-12,
          def: 5e-12, lo: 0 },
        { id: 'ui', label: 'Unit interval', kind: 'si', unit: 's', min: 1e-12, max: 1e-9, log: true,
          def: 31.25e-12, positive: true, hint: 'UI = 1 / symbol rate. 32 GT/s is 31.25 ps.' }
      ],
      compute: (v) => M.ber(v.ber, +v.rho, v.rj, v.dj, v.ui),
      outputs: (r) => [
        { k: 'Q<sub>BER</sub>', v: r.q.toFixed(3) },
        { k: 'RJ multiplier 2Q', v: r.alpha.toFixed(3) },
        { k: 'Total jitter TJ', v: s_(r.tj) },
        { k: 'RJ share 2Q·RJ', v: s_(r.rjPart) },
        { k: 'Eye opening at BER', v: r.open > 0 ? s_(r.open) : 'closed', tone: r.open > 0 ? 'ok' : 'alarm' },
        { k: 'Opening, % of UI', v: (r.openFrac * 100).toFixed(1) + ' %', tone: r.open > 0 ? null : 'alarm' }
      ],
      chart: {
        draw(s, T, v, r) {
          const rho = +v.rho, pts = [];
          for (let i = 0; i <= 300; i++) { const x = 10 * i / 300; pts.push([x, rho * K.Q(x)]); }
          const P = K.plot(s, T, {
            pad: { l: 56, r: 16, t: 20, b: 32 },
            x: { min: 0, max: 10, count: 10, fmt: (x) => x.toFixed(0), title: 'distance from the edge, in σ (RJ)' },
            y: { min: 1e-20, max: 1, log: true,
                 ticks: [1, 1e-3, 1e-6, 1e-9, 1e-12, 1e-15, 1e-18],
                 fmt: (y) => (y === 1 ? '1' : '1e' + Math.round(Math.log10(y))), title: 'BER' }
          }).grid();
          K.shadeX(P, r.q, 10, K.rgba(T.signal, 0.08));
          P.trace(pts, T.signal, { width: 2.2, label: 'BER', unit: '' });
          P.hline(v.ber, T.ink2, [3, 4], 'target ' + K.calcFormat({ kind: 'sci' }, v.ber));
          P.vline(r.q, T.reflect, [3, 4], 'Q = ' + r.q.toFixed(2));
          K.dot(s.ctx, P.X(r.q), P.Y(v.ber), T.reflect, true);
          P.frame();
          return [{ label: 'ρ·Q(x), the Gaussian tail', colour: T.signal },
                  { label: 'Q at the target BER', colour: T.reflect, dash: true }];
        }
      }
    });
  };
})();
