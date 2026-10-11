/* SI & PI — viz/d2d-compare.js
 * Chiplet interconnects compared. Two views of the same four published layouts:
 * bandwidth per millimetre of die edge against wire rate, and bandwidth per square
 * millimetre of bump field, per Gb/s of wire rate, against a common bump pitch.
 * Colour is the package (organic or interposer), line style the standard (UCIe solid,
 * BoW dashed), so the plot needs only the two validated series colours.
 *
 * All the arithmetic is in js/models/d2d-model.js; this draws it.
 *
 * Requires js/viz-kit.js and js/models/d2d-model.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;
  const PITCHES = [10, 15, 20, 25, 30, 36, 40, 45, 55, 70, 90, 110, 130, 150];   // um

  const PRESETS = {
    edge16: { view: 'edge', ri: 4, pi: 6, note: 'At 16 Gb/s per wire, the UCIe-A module carries about twice the bandwidth per millimetre of edge of BoW’s interposer example, although BoW’s bumps are finer.' },
    area40: { view: 'area', ri: 4, pi: 6, note: 'The same layouts per square millimetre of bumps, at a common 40 µm pitch and per Gb/s of wire rate: UCIe-A and both BoW examples land within about 3% of each other. The difference in edge density came from how deep each layout goes.' },
    fast: { view: 'edge', ri: 8, pi: 6, note: '64 Gb/s per wire: only UCIe defines it. BoW stops at 32 Gb/s; AIB specifies no maximum, with 6.4 Gb/s typical.' },
    organic: { view: 'area', ri: 4, pi: 12, note: 'At a common 130 µm, the UCIe-S module needs about 40% more bump area for the same bandwidth than the other three layouts. The sources do not say why.' }
  };
  const SHORT = { ucieS: 'UCIe-S', ucieA: 'UCIe-A', bowL: 'BoW laminate', bowI: 'BoW interposer' };

  NS.viz.d2dCompare = function (root) {
    const axes = K.axisMemo(root);   // sticky ranges: inputs move the waveform, not the axis
    const $ = (s) => root.querySelector(s);
    const D = NS.models.d2d, RATES = D.RATES;
    const p = { view: 'edge', ri: 4, pi: 6 };

    function draw(T) {
      const R = D({ rate: RATES[p.ri], pitch: PITCHES[p.pi] });
      const m = R.measurements, g = R.generated;
      const col = (k) => (g.layouts[k].pkg === 'organic' ? T.reflect : T.signal);
      const dash = (k) => (g.layouts[k].std === 'BoW' ? [6, 4] : []);
      const s = K.canvas($('[data-cv="d2d"]'), 260);
      let P;
      if (p.view === 'edge') {
        const all = g.keys.flatMap((k) => g.curves[k].map((q) => q[1]).filter((v) => v));
        const yr = K.stickyAxis(axes, 'edge', Math.min(...all), Math.max(...all), { log: true, head: 0.2, fine: true });
        P = K.plot(s, T, {
          pad: { l: 58, r: 24, t: 18, b: 32 },
          x: { min: 1.7, max: 75, log: true, ticks: RATES, fmt: (v) => String(v), title: 'wire rate, Gb/s per wire' },
          y: { min: yr.min, max: yr.max, log: true, fmt: (v) => String(+v.toPrecision(3)), title: 'GB/s per mm of edge, both directions' }
        }).grid();
        P.vline(RATES[p.ri], T.muted, [2, 4]);
        g.keys.forEach((k) => {
          const pts = g.curves[k].filter((q) => q[1]);
          P.trace(pts, col(k), { width: 2, dash: dash(k), id: 'edge-' + k, label: SHORT[k], unit: 'GB/s/mm' });
          pts.forEach(([x, y]) => K.dot(P.ctx, P.X(x), P.Y(y), col(k), T.surface, x === RATES[p.ri] ? 4 : 2.2));
        });
      } else {
        const vals = g.keys.flatMap((k) => g.lines[k].map((q) => q[1]));
        const yr = K.stickyAxis(axes, 'area', Math.min(...vals), Math.max(...vals), { log: true, head: 0.1 });
        P = K.plot(s, T, {
          pad: { l: 58, r: 24, t: 18, b: 32 },
          x: { min: 10, max: 150, log: true, ticks: [10, 20, 40, 55, 110, 150], fmt: (v) => String(v), title: 'common bump pitch, µm' },
          y: { min: yr.min, max: yr.max, log: true, fmt: (v) => String(+v.toPrecision(2)), title: 'GB/s per mm² per Gb/s of wire rate' }
        }).grid();
        P.vline(PITCHES[p.pi], T.muted, [2, 4]);
        g.keys.forEach((k) => {
          P.trace(g.lines[k], col(k), { width: 2, dash: dash(k), id: 'area-' + k, label: SHORT[k], unit: 'GB/s/mm²/(Gb/s)' });
          const L = g.layouts[k];
          K.dot(P.ctx, P.X(L.pitch), P.Y(D.areaDensity(k)), col(k), T.ink, 3.5);   // the layout at its own pitch
        });
      }
      P.frame();

      const set = (k, v) => { const e = $('[data-out="' + k + '"]'); if (e) e.textContent = v; };
      const fmtE = (v) => (v === null ? 'not defined' : Math.round(v) + ' GB/s/mm');
      if (p.view === 'edge') g.keys.forEach((k) => set(k, fmtE(m.edge[k])));
      else g.keys.forEach((k) => set(k, m.areaAtCommonPitch[k].toPrecision(3)));
      set('unit', p.view === 'edge' ? 'per mm of edge at ' + RATES[p.ri] + ' Gb/s per wire' : 'per mm² per Gb/s at ' + PITCHES[p.pi] + ' µm');
      set('aib', 'no layout published');
      set('detail', p.view === 'edge'
        ? 'Each curve is one published layout with its geometry fixed, so bandwidth rises in step with the wire rate. The UCIe-S curve rises more slowly above 32 GT/s, where the consortium’s own table is used. Where a standard defines no such rate, its readout says so.'
        : 'Each line is one layout’s bump-field density moved to a common pitch, which multiplies it by (its own pitch / common pitch)². Dots mark each layout at its real pitch. At the same pitch, UCIe-A is ' + (100 * (1 / m.interposerRatio - 1)).toFixed(0) + '% above BoW’s interposer example and the UCIe-S module ' + (100 * (1 - 1 / m.organicRatio)).toFixed(0) + '% below BoW’s laminate one.');
      $('#dc-view').value = p.view;
      $('#dc-rate').value = p.ri; $('#dc-rate-out').value = RATES[p.ri] + ' Gb/s';
      $('#dc-pitch').value = p.pi; $('#dc-pitch-out').value = PITCHES[p.pi] + ' µm';
    }

    const m = K.mount({ root, params: p, draw });
    const clear = () => {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      $('[data-out="note"]').textContent = 'Custom';
    };
    $('#dc-view').addEventListener('change', (e) => { p.view = e.target.value; clear(); m.render(); });
    $('#dc-rate').addEventListener('input', (e) => { p.ri = +e.target.value; clear(); m.render(); });
    $('#dc-pitch').addEventListener('input', (e) => { p.pi = +e.target.value; clear(); m.render(); });
    root.querySelectorAll('.preset[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const q = PRESETS[b.dataset.preset];
      if (!q) return;
      Object.assign(p, { view: q.view, ri: q.ri, pi: q.pi });
      root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      $('[data-out="note"]').textContent = q.note;
      m.render();
    }));
    root.querySelector('.preset[data-preset="edge16"]').setAttribute('aria-pressed', 'true');
    $('[data-out="note"]').textContent = PRESETS.edge16.note;
    m.render();
    return { start() {}, stop() {}, destroy() { m.teardown(); } };
  };
})();
