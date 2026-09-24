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
        /* A fixed log axis, 10 MHz to 1 THz. Nothing rescales: dragging the data
           rate slides the whole spectrum sideways past the edge bandwidth, which
           the rise time sets and which therefore stays put -- and whether the edge
           cuts into the spectrum is the thing this chart is for. */
        draw(s, T, v, r) {
          const lo = 1e7, hi = 1e12;
          const db = (x) => Math.max(-60, 10 * Math.log10(Math.max(x, 1e-12)));
          const psd = [], edged = [];
          for (let i = 0; i <= 900; i++) {
            const f = lo * Math.pow(hi / lo, i / 900), a = M.dataEnvelope(f, r.ui);
            psd.push([f, db(a)]); edged.push([f, db(a * M.edgeLpf(f, v.tr))]);
          }
          const P = K.plot(s, T, {
            pad: { l: 52, r: 16, t: 22, b: 32 },
            x: { min: lo, max: hi, log: true, fmt: (x) => K.si(x, 'Hz', 1), title: 'frequency' },
            y: { min: -40, max: 0, count: 4, fmt: (y) => y.toFixed(0), title: 'power, dB' }
          }).grid();
          K.shadeX(P, lo, r.fn, K.rgba(T.signal, 0.08));
          P.trace(psd, T.muted, { width: 1.6, dash: [4, 3], label: 'data envelope', unit: 'dB' });
          P.trace(edged, T.signal, { width: 2.2, label: 'with the edge', unit: 'dB' });
          P.vline(r.fn, T.reflect, [3, 4], 'Nyquist');
          P.vline(r.baud, T.muted, [2, 5], '1/UI');
          P.vline(r.bw, T.ink2, [2, 4], '0.35/t\u1d63');
          P.frame();
          return [{ label: 'random-data envelope', colour: T.muted, dash: true },
                  { label: 'after a single-pole edge', colour: T.signal },
                  { label: 'below Nyquist', colour: K.rgba(T.signal, 0.35) }];
        }
      }
    });
  };
})();
