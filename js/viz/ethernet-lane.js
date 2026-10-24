/* SI & PI — viz/ethernet-lane.js
 * Same board, twice the rate: one trace's loss per inch against frequency with the
 * 112G and 224G Nyquist frequencies marked, and the single-bit pulse each rate gets
 * through the same length. 112G is the signal colour and 224G the second series
 * colour throughout, so the panel needs only the two validated series colours.
 *
 * All the arithmetic is in js/models/ethernet-model.js; this draws it.
 *
 * Requires js/viz-kit.js, js/models/calc-models.js, js/models/laminates.js and
 * js/models/ethernet-model.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;
  const LAMS = ['isola-370hr', 'megtron4', 'megtron6n', 'megtron7gn'];
  const RQ = [0.1, 0.2, 0.3, 0.5, 0.8, 1.2];                     // um, RMS
  const LEN = [1, 2, 3, 4, 6, 8, 10, 12, 15, 20, 25, 30];        // in
  const BUDGET = [10, 15, 20, 25, 30, 35, 40];                   // dB

  const PRESETS = {
    low10: { li: 2, ri: 2, ni: 6, bi: 2, note: 'Low-loss laminate, 10 in: each inch loses about 1.8 times as much at 224G, so 20 dB buys a little over half the length.' },
    fr4: { li: 0, ri: 3, ni: 3, bi: 2, note: 'FR-4, data held flat above 10 GHz: 4 in loses about 30 dB at 224G, half as much again as the 20 dB budget.' },
    smooth: { li: 3, ri: 0, ni: 6, bi: 2, note: 'Lowest-loss laminate in the list, smooth copper: about 1 dB/in at 112G and 1.8 at 224G, still about 1.8 times.' },
    rough: { li: 3, ri: 5, ni: 6, bi: 2, note: 'Same laminate, rough copper: copper loss, which grows only as about √f, now dominates, so the ratio falls toward 1.6.' }
  };

  NS.viz.ethLane = function (root) {
    const axes = K.axisMemo(root);   // sticky ranges: inputs move the waveform, not the axis
    const $ = (s) => root.querySelector(s);
    const E = NS.models.ethernet, L = NS.laminates;
    const p = { li: 2, ri: 2, ni: 6, bi: 2 };
    const name = (id) => L.byId[id].name;

    function draw(T) {
      const R = E({ lam: LAMS[p.li], rq: RQ[p.ri], len: LEN[p.ni], budget: BUDGET[p.bi] });
      const m = R.measurements, g = R.generated;
      const c112 = T.signal, c224 = T.reflect;

      /* Loss per inch against frequency, both Nyquists marked. */
      {
        const s = K.canvas($('[data-cv="loss"]'), 158);
        const top = Math.max(...g.curve.map((q) => q[1]));
        const yr = K.stickyAxis(axes, 'loss', 0, top, { head: 0.15 });
        const P = K.plot(s, T, {
          pad: { l: 50, r: 16, t: 16, b: 32 },
          x: { min: 0, max: 60, ticks: [0, 10, 20, 30, 40, 50, 60], fmt: (v) => String(v), title: 'frequency, GHz' },
          y: { min: yr.min, max: yr.max, fmt: (v) => String(+v.toFixed(1)), title: 'loss, dB per inch' }
        }).grid();
        P.trace(g.curve.map((q) => [q[0], q[2]]), T.muted, { width: 1.2, dash: [4, 3], id: 'loss-diel', label: 'dielectric part', unit: 'dB/in' });
        P.trace(g.curve.map((q) => [q[0], q[1]]), T.ink, { width: 2, id: 'loss-total', label: 'total', unit: 'dB/in' });
        const f112 = m.nyq112 / 1e9, f224 = m.nyq224 / 1e9;
        P.vline(f112, c112, [3, 4]);
        P.vline(f224, c224, [3, 4]);
        K.dot(P.ctx, P.X(f112), P.Y(m.per112), c112, T.surface, 4.5);
        K.dot(P.ctx, P.X(f224), P.Y(m.per224), c224, T.surface, 4.5);
        K.text(P.ctx, '112G Nyquist', P.X(f112) - 4, P.Y(yr.max) + 12, c112, 10, 'right');
        K.text(P.ctx, '224G Nyquist', P.X(f224) - 4, P.Y(yr.max) + 12, c224, 10, 'right');
        if (m.clamped) K.text(P.ctx, 'published data stop at ' + (m.dataAt[1] / 1e9) + ' GHz; held flat above', P.X(1), P.Y(yr.max) + 28, T.alarm, 10, 'left');
        P.frame();
      }

      /* The single-bit pulse each rate gets through the same length, on one time axis. */
      {
        const s = K.canvas($('[data-cv="pulse"]'), 138);
        const P = K.plot(s, T, {
          pad: { l: 50, r: 16, t: 16, b: 32 },
          x: { min: -40, max: 200, ticks: [0, 50, 100, 150, 200], fmt: (v) => String(v), title: 'time from the pulse peak, ps' },
          y: { min: -0.05, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1], fmt: (v) => String(v), title: 'fraction of the swing' }
        }).grid();
        P.hline(0, T.muted, [2, 3]);
        P.trace(g.pulse112.pts, c112, { width: 2, id: 'pulse-112', label: '112G pulse', unit: '' });
        P.trace(g.pulse224.pts, c224, { width: 2, id: 'pulse-224', label: '224G pulse', unit: '' });
        g.pulse112.marks.forEach(([x, y]) => { if (x >= -40 && x <= 200) K.dot(P.ctx, P.X(x), P.Y(y), c112, T.surface, 2.6); });
        g.pulse224.marks.forEach(([x, y]) => { if (x >= -40 && x <= 200) K.dot(P.ctx, P.X(x), P.Y(y), c224, T.surface, 2.2); });
        P.frame();
      }

      const set = (k, v) => { const e = $('[data-out="' + k + '"]'); if (e) e.textContent = v; };
      const db = (v) => (v < 10 ? v.toFixed(1) : Math.round(v)) + ' dB';
      const inch = (v) => (v < 10 ? v.toFixed(1) : Math.round(v)) + ' in';
      set('l112', db(m.loss112));
      set('l224', db(m.loss224));
      set('ratio', '×' + m.ratio.toFixed(2));
      set('reach', inch(m.reach112) + ' → ' + inch(m.reach224));
      set('h', Math.round(100 * g.pulse112.height) + '% → ' + Math.round(100 * g.pulse224.height) + '%');
      $('#el-lam').value = String(p.li);
      $('#el-rq').value = p.ri; $('#el-rq-out').value = RQ[p.ri] + ' µm';
      $('#el-len').value = p.ni; $('#el-len-out').value = LEN[p.ni] + ' in';
      $('#el-budget').value = p.bi; $('#el-budget-out').value = BUDGET[p.bi] + ' dB';
    }

    const mnt = K.mount({ root, params: p, draw });
    const clear = () => {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      $('[data-out="note"]').textContent = 'Custom';
    };
    $('#el-lam').addEventListener('change', (e) => { p.li = +e.target.value; clear(); mnt.render(); });
    [['#el-rq', 'ri'], ['#el-len', 'ni'], ['#el-budget', 'bi']].forEach(([id, k]) =>
      $(id).addEventListener('input', (e) => { p[k] = +e.target.value; clear(); mnt.render(); }));
    root.querySelectorAll('.preset[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const q = PRESETS[b.dataset.preset];
      if (!q) return;
      Object.assign(p, { li: q.li, ri: q.ri, ni: q.ni, bi: q.bi });
      root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      $('[data-out="note"]').textContent = q.note;
      mnt.render();
    }));
    root.querySelector('.preset[data-preset="low10"]').setAttribute('aria-pressed', 'true');
    $('[data-out="note"]').textContent = PRESETS.low10.note;
    // Room for the longest note, so pressing a preset changes the words, not the panel's height.
    const notes = Object.values(PRESETS).map((q) => q.note).concat(['Custom']);
    const reserve = () => K.reserveText($('[data-out="note"]'), notes);
    reserve();
    window.addEventListener('resize', reserve);
    // A tab switch asks for pixels; without this the loader nudges the laminate select
    // and the panel drops its preset.
    const offRepaint = K.onRepaint(root, () => mnt.render());
    mnt.render();
    return { start() {}, stop() {}, destroy() { window.removeEventListener('resize', reserve); offRepaint(); mnt.teardown(); } };
  };
  NS.viz.ethLane.PRESETS = PRESETS;
  NS.viz.ethLane.GRID = { LAMS, RQ, LEN, BUDGET };
})();
