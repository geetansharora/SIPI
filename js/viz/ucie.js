/* SI & PI — viz/ucie.js
 * How much die edge a die-to-die bandwidth costs, on a standard or an advanced
 * package, at each UCIe data rate, and the power it burns.
 *
 * All the arithmetic is in js/models/ucie-model.js; this draws it. The chart is
 * the edge needed against data rate for both packages, so changing the bandwidth
 * moves both curves and changing the package or the rate moves the marker.
 *
 * Requires js/viz-kit.js and js/models/ucie-model.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;

  const PRESETS = {
    accel: { pkg: 'A', ri: 5, tbps: 4, note: 'An accelerator die exchanging 2 TB/s each way with a neighbour, 4 TB/s in total, over a silicon bridge at 32 GT/s: about 3 mm of edge.' },
    organic: { pkg: 'S', ri: 5, tbps: 4, note: 'The same 4 TB/s on an organic substrate: the bumps are about 2.5 times coarser and it needs about six times the edge.' },
    fast: { pkg: 'A', ri: 7, tbps: 4, note: 'UCIe 3.0 at 64 GT/s on the advanced package: half the edge of 32 GT/s, at a higher energy per bit.' },
    slowS: { pkg: 'S', ri: 3, tbps: 1, note: 'A modest 1 TB/s link, 0.5 TB/s each way, on a standard package at 16 GT/s, the fastest rate with the standard package’s lowest energy per bit.' }
  };

  NS.viz.ucie = function (root) {
    const axes = K.axisMemo(root);   // sticky ranges: inputs move the waveform, not the axis
    const $ = (s) => root.querySelector(s);
    const M = NS.models.ucie, RATES = M.RATES;
    const p = { pkg: 'A', ri: 5, tbps: 4 };
    const fmtPow = (lo, hi) => (lo === hi ? lo.toFixed(1) : lo.toFixed(1) + '–' + hi.toFixed(1)) + ' W';
    const fmtPj = (lo, hi) => (lo === hi ? lo.toFixed(2) : lo.toFixed(2) + '–' + hi.toFixed(2)) + ' pJ/b';

    function draw(T) {
      const R = M({ pkg: p.pkg, rate: RATES[p.ri], tbps: p.tbps });
      const m = R.measurements, g = R.generated;
      const all = [...g.curves.S, ...g.curves.A].map((q) => q[1]);
      const yr = K.stickyAxis(axes, 'edge', Math.min(...all), Math.max(...all), { log: true, head: 0.2 });
      const s = K.canvas($('[data-cv="edge"]'), 250);
      const P = K.plot(s, T, {
        pad: { l: 58, r: 40, t: 18, b: 32 },
        x: { min: 3.4, max: 75, log: true, ticks: RATES, fmt: (v) => String(v), title: 'data rate, GT/s' },
        y: { min: yr.min, max: yr.max, log: true, fmt: (v) => (v >= 1 ? (+v.toPrecision(3)) + '' : v.toPrecision(1)), title: 'die edge needed, mm' }
      }).grid();
      const col = { S: T.reflect, A: T.signal };
      ['S', 'A'].forEach((k) => {
        P.trace(g.curves[k], col[k], { width: k === p.pkg ? 2.4 : 1.4, dash: k === p.pkg ? [] : [5, 4],
          id: 'edge-' + k, label: k === 'S' ? 'standard package' : 'advanced package', unit: 'mm' });
        g.curves[k].forEach(([x, y]) => K.dot(P.ctx, P.X(x), P.Y(y), col[k], T.surface, 2.5));
      });
      const sel = g.curves[p.pkg][p.ri];
      K.dot(P.ctx, P.X(sel[0]), P.Y(sel[1]), col[p.pkg], T.ink, 5);
      K.text(P.ctx, sel[1].toPrecision(3) + ' mm', P.X(sel[0]) + 8, P.Y(sel[1]) - 8, col[p.pkg], 11, 'left');
      if (!P.narrow) {
        const last = (k) => g.curves[k][g.curves[k].length - 1];
        K.text(P.ctx, 'standard', P.X(last('S')[0]) - 4, P.Y(last('S')[1]) - 9, T.reflect, 10, 'right');
        K.text(P.ctx, 'advanced', P.X(last('A')[0]) - 4, P.Y(last('A')[1]) - 9, T.signal, 10, 'right');
      }
      P.frame();

      const set = (k, v) => { const e = $('[data-out="' + k + '"]'); if (e) e.textContent = v; };
      set('shore', Math.round(m.shoreline) + ' GB/s/mm');
      set('edge', m.edgeMm.toPrecision(3) + ' mm');
      set('power', fmtPow(m.powerLoW, m.powerHiW));
      set('energy', fmtPj(m.energyLo, m.energyHi));
      set('module', m.width + ' lanes, ' + (+m.moduleGBps.toPrecision(3)) + ' GB/s each way');
      set('trip', (+m.roundTripUI.toPrecision(2)) + ' UI at ' + m.reachMm + ' mm');
      set('detail', 'At ' + RATES[p.ri] + ' GT/s the ' + (p.pkg === 'A' ? 'advanced' : 'standard') + ' package carries '
        + Math.round(m.shoreline) + ' GB/s per mm of die edge' + (m.fromTable ? '' : ' (scaled from the consortium’s 32 GT/s figure)')
        + ', both directions together, so ' + p.tbps + ' TB/s in total needs ' + m.edgeMm.toPrecision(3)
        + ' mm; the ' + (p.pkg === 'A' ? 'standard' : 'advanced') + ' package would need ' + m.otherEdgeMm.toPrecision(3)
        + ' mm. At ' + fmtPj(m.energyLo, m.energyHi) + ' that bandwidth burns ' + fmtPow(m.powerLoW, m.powerHiW) + '.'
        + (m.energyLo !== m.energyHi ? ' The consortium gives no energy figure for the standard package at 24 GT/s, so the range spans its neighbours.' : ''));
      $('#uc-pkg').value = p.pkg;
      $('#uc-rate').value = p.ri; $('#uc-rate-out').value = RATES[p.ri] + ' GT/s';
      $('#uc-bw').value = Math.round(Math.log2(p.tbps / 0.25) * 4); $('#uc-bw-out').value = (+p.tbps.toPrecision(3)) + ' TB/s';
    }

    const m = K.mount({ root, params: p, draw });
    const clear = () => {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      $('[data-out="note"]').textContent = 'Custom';
    };
    $('#uc-pkg').addEventListener('change', (e) => { p.pkg = e.target.value; clear(); m.render(); });
    $('#uc-rate').addEventListener('input', (e) => { p.ri = +e.target.value; clear(); m.render(); });
    // 0.25 to 16 TB/s in quarter-octave steps.
    $('#uc-bw').addEventListener('input', (e) => { p.tbps = +(0.25 * Math.pow(2, +e.target.value / 4)).toPrecision(3); clear(); m.render(); });
    root.querySelectorAll('.preset[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const q = PRESETS[b.dataset.preset];
      if (!q) return;
      Object.assign(p, { pkg: q.pkg, ri: q.ri, tbps: q.tbps });
      root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      $('[data-out="note"]').textContent = q.note;
      m.render();
    }));
    root.querySelector('.preset[data-preset="accel"]').setAttribute('aria-pressed', 'true');
    $('[data-out="note"]').textContent = PRESETS.accel.note;
    m.render();
    return { start() {}, stop() {}, destroy() { m.teardown(); } };
  };
})();
