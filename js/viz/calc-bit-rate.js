/* SIPI — viz/calc-bit-rate.js
 * Data rate → symbol rate, UI, Nyquist frequency, edge bandwidth, and how many
 * UIs a trace holds in flight. Maths: js/models/calc-models.js (C.bitrate).
 * Requires js/viz-kit.js and js/models/calc-models.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit, M = NS.calc;

  NS.viz.calcBitRate = function (root) {
    return K.calc(root, {
      selects: [{ id: 'mod', label: 'Modulation', def: '1', options: [['1', 'NRZ'], ['2', 'PAM4']] }],
      inputs: [
        { id: 'rate', label: 'Data rate', kind: 'si', unit: 'b/s', alias: ['bps', 'bit/s', 'b'],
          min: 1e8, max: 4e11, log: true, def: 32e9, positive: true },
        { id: 'tr', label: 'Rise time t<sub>r</sub> (10–90%)', kind: 'si', unit: 's',
          min: 1e-12, max: 1e-9, log: true, def: 15e-12, positive: true },
        { id: 'len', label: 'Trace length', kind: 'length', unit: 'in', base: 0.0254, dp: 2,
          min: 0.1, max: 40, log: true, def: 10, positive: true },
        { id: 'dk', label: 'Effective Dk', kind: 'plain', dp: 2, min: 1, max: 10, def: 3.8, lo: 1 }
      ],
      compute: (v) => M.bitrate(v.rate, +v.mod, v.tr, v.len, v.dk),
      outputs: (r) => [
        { k: 'Symbol rate', v: K.si(r.baud, 'Bd') },
        { k: 'Unit interval', v: K.si(r.ui, 's') },
        { k: 'Nyquist frequency', v: K.si(r.fn, 'Hz') },
        { k: 'Edge bandwidth 0.35/t<sub>r</sub>', v: K.si(r.bw, 'Hz') },
        { k: 't<sub>r</sub> as % of UI', v: (r.trFrac * 100).toFixed(1) + ' %', tone: r.trFrac > 0.5 ? 'alarm' : null },
        { k: 'Trace delay', v: K.si(r.td, 's') },
        { k: 'UIs in flight', v: r.inFlight.toPrecision(3) }
      ],
      chart: {
        draw(s, T, v, r) {
          const fMax = Math.max(2.5 * r.baud, 1.15 * r.bw);
          const db = (x) => Math.max(-60, 10 * Math.log10(Math.max(x, 1e-12)));
          const psd = [], edged = [];
          for (let i = 0; i <= 500; i++) {
            const f = fMax * i / 500, a = M.dataPsd(f, r.ui);
            psd.push([f, db(a)]); edged.push([f, db(a * M.edgeLpf(f, v.tr))]);
          }
          const P = K.plot(s, T, {
            pad: { l: 52, r: 16, t: 20, b: 32 },
            x: { min: 0, max: fMax, count: 5, fmt: (x) => K.si(x, 'Hz', 2), title: 'frequency' },
            y: { min: -40, max: 0, count: 4, fmt: (y) => y.toFixed(0), title: 'power, dB' }
          }).grid();
          P.trace(psd, T.muted, { width: 1.4, dash: [4, 3], label: 'data spectrum', unit: 'dB' });
          P.trace(edged, T.signal, { width: 2.2, label: 'with the edge', unit: 'dB' });
          P.vline(r.fn, T.reflect, [3, 4], 'Nyquist');
          if (r.bw < fMax) P.vline(r.bw, T.ink2, [2, 4], '0.35/tᵣ');
          P.frame();
          return [{ label: 'random-data spectrum (sinc²)', colour: T.muted, dash: true },
                  { label: '× single-pole edge', colour: T.signal },
                  { label: 'Nyquist', colour: T.reflect, dash: true }];
        }
      }
    });
  };
})();
