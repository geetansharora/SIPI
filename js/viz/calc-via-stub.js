/* SIPI — viz/calc-via-stub.js
 * Quarter-wave via stub resonance against the channel's Nyquist frequency.
 * Maths: js/models/calc-models.js (C.stub, C.stubS21). Requires viz-kit.js and calc-models.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit, M = NS.calc;

  NS.viz.calcViaStub = function (root) {
    return K.calc(root, {
      inputs: [
        { id: 'len', label: 'Stub length', kind: 'length', unit: 'mil', base: 25.4e-6, dp: 1,
          min: 2, max: 400, log: true, def: 40, positive: true },
        { id: 'dk', label: 'Effective Dk', kind: 'plain', dp: 2, min: 1, max: 10, def: 3.8, lo: 1 },
        { id: 'fn', label: 'Nyquist frequency', kind: 'si', unit: 'Hz', min: 0.5e9, max: 60e9, log: true,
          def: 16e9, positive: true },
        { id: 'k', label: 'Keep the notch above k × Nyquist', kind: 'plain', dp: 1, min: 1, max: 5, def: 3,
          lo: 1, hint: 'A design margin you choose — no specification sets it.' }
      ],
      compute: (v) => M.stub(v.len, v.dk, v.fn, v.k),
      outputs: (r, v) => [
        { k: 'Notch frequency', v: K.si(r.fNotch, 'Hz') },
        { k: 'Notch ÷ Nyquist', v: r.ratio.toPrecision(3) + '×' },
        { k: '|S21| at Nyquist', v: r.s21AtFn.toFixed(2) + ' dB' },
        { k: 'Longest stub for k = ' + v.k, v: r.lMaxMil.toFixed(1) + ' mil (' + (r.lMaxMil * 0.0254).toPrecision(3) + ' mm)' },
        { k: 'Verdict', tone: r.ok ? 'ok' : 'alarm', v: r.ok ? 'Clear of the margin' : 'Inside the margin' }
      ],
      chart: {
        draw(s, T, v, r) {
          const xMax = Math.max(1.35 * r.fNotch, 1.25 * v.k * v.fn);
          const pts = [];
          for (let i = 0; i <= 600; i++) { const f = xMax * i / 600; pts.push([f, Math.max(-40, M.stubS21(f, r.fNotch))]); }
          const P = K.plot(s, T, {
            pad: { l: 52, r: 16, t: 20, b: 32 },
            x: { min: 0, max: xMax, count: 5, fmt: (x) => K.si(x, 'Hz', 2), title: 'frequency' },
            y: { min: -40, max: 2, ticks: [0, -10, -20, -30, -40], fmt: (y) => y.toFixed(0), title: '|S21|, dB' }
          }).grid();
          K.shadeX(P, 0, v.k * v.fn, K.rgba(T.signal, 0.07));
          P.trace(pts, T.signal, { width: 2.2, label: '|S21|', unit: 'dB' });
          P.vline(v.fn, T.reflect, [3, 4], 'Nyquist');
          P.vline(v.k * v.fn, T.ink2, [2, 4], v.k + '×');
          P.frame();
          return [{ label: '|S21| through an ideal open stub', colour: T.signal },
                  { label: 'Nyquist', colour: T.reflect, dash: true },
                  { label: 'band to keep clear', colour: K.rgba(T.signal, 0.35) }];
        }
      }
    });
  };
})();
