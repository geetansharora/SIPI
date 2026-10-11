/* SI & PI — viz/ucie-echo.js
 * Does this UCIe wire need a termination? The received waveform of a bit pattern
 * on a lossless line, open or terminated at the receiver, from a resistive driver,
 * with the mid-bit samples marked against the levels they should settle to.
 *
 * All the physics is NS.models.ucieEcho (js/models/ucie-model.js), which sums
 * K.line1D step responses; this draws it.
 *
 * Requires js/viz-kit.js and js/models/ucie-model.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;
  const LENS = [0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 25];   // mm

  const PRESETS = {
    slow: { ri: 3, li: 4, term: 'open', rs: 40, note: '2 mm at 16 GT/s with an open receiver: the round trip is 0.43 UI, the echoes settle before mid-bit, and the samples land on their levels.' },
    open32: { ri: 5, li: 4, term: 'open', rs: 40, note: 'The same wire at 32 GT/s: the first echo now arrives after the sample, which sees the 40 ohm driver’s overshoot.' },
    term64: { ri: 7, li: 4, term: 'matched', rs: 40, note: '64 GT/s with the receiver terminated in 50 ohm: no echo, whatever the driver, which is what UCIe 3.0 requires at 48 and 64 GT/s.' },
    long: { ri: 3, li: 11, term: 'open', rs: 40, note: '25 mm on a standard package at 16 GT/s, open: the round trip is more than five bits, so every echo is inter-symbol interference.' }
  };

  NS.viz.ucieEcho = function (root) {
    const axes = K.axisMemo(root);   // sticky ranges: inputs move the waveform, not the axis
    const $ = (s) => root.querySelector(s);
    const E = NS.models.ucieEcho, RATES = NS.models.ucie.RATES;
    const p = { ri: 5, li: 4, term: 'open', rs: 40 };

    function draw(T) {
      const R = E({ rate: RATES[p.ri], lenMm: LENS[p.li], term: p.term, rs: p.rs });
      const m = R.measurements, g = R.generated;
      const ys = g.wave.map((q) => q[1]);
      const yr = K.stickyAxis(axes, 'v', Math.min(-0.1, ...ys), Math.max(1.1, ...ys), { head: 0.05 });
      const s = K.canvas($('[data-cv="echo"]'), 240);
      const P = K.plot(s, T, {
        pad: { l: 52, r: 44, t: 18, b: 32 },
        x: { min: 0, max: g.end, count: 5, fmt: (v) => (v / 1000).toFixed(2), title: 'time at the receiver, ns' },
        y: { min: yr.min, max: yr.max, count: 4, fmt: (v) => v.toFixed(1), title: 'fraction of the settled swing' }
      }).grid();
      // Bit boundaries at the receiver, so an echo can be seen to cross into the next bit.
      for (let k = 0; k <= g.pattern.length; k++) P.vline(m.tdPs + k * m.uiPs, T.grid || T.muted, [1, 4]);
      P.trace(g.ideal, T.muted, { width: 1.2, dash: [4, 3] });
      P.trace(g.wave, T.signal, { width: 2.2, glow: true, id: 'received', label: 'received', unit: 'of swing' });
      g.samples.forEach(([t, v, b], k) => {
        if (!k) return;
        const bad = Math.abs(v - b) > 0.1;
        K.dot(P.ctx, P.X(t), P.Y(v), bad ? T.alarm : T.signal, T.surface, bad ? 3.5 : 2.5);
      });
      P.frame();

      const set = (k, v) => { const e = $('[data-out="' + k + '"]'); if (e) e.textContent = v; };
      set('rt', m.roundTripPs.toFixed(1) + ' ps, ' + m.roundTripUI.toFixed(2) + ' UI');
      set('half', (m.uiPs / 2).toFixed(1) + ' ps');
      set('echo', m.echo === 0 ? 'none' : (m.echo > 0 ? '+' : '') + m.echo.toFixed(3));
      set('err', (m.worstSampleError * 100).toFixed(1) + '%');
      const err = $('[data-out="err"]');
      if (err) err.style.color = m.worstSampleError > 0.1 ? 'var(--alarm-text)' : '';
      $('#ue-rate').value = p.ri; $('#ue-rate-out').value = RATES[p.ri] + ' GT/s';
      $('#ue-len').value = p.li; $('#ue-len-out').value = LENS[p.li] + ' mm';
      $('#ue-term').value = p.term;
      $('#ue-rs').value = p.rs; $('#ue-rs-out').value = p.rs + ' Ω';
    }

    const m = K.mount({ root, params: p, draw });
    const clear = () => {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      $('[data-out="note"]').textContent = 'Custom';
    };
    $('#ue-rate').addEventListener('input', (e) => { p.ri = +e.target.value; clear(); m.render(); });
    $('#ue-len').addEventListener('input', (e) => { p.li = +e.target.value; clear(); m.render(); });
    $('#ue-term').addEventListener('change', (e) => { p.term = e.target.value; clear(); m.render(); });
    $('#ue-rs').addEventListener('input', (e) => { p.rs = +e.target.value; clear(); m.render(); });
    root.querySelectorAll('.preset[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const q = PRESETS[b.dataset.preset];
      if (!q) return;
      Object.assign(p, { ri: q.ri, li: q.li, term: q.term, rs: q.rs });
      root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      $('[data-out="note"]').textContent = q.note;
      m.render();
    }));
    root.querySelector('.preset[data-preset="open32"]').setAttribute('aria-pressed', 'true');
    $('[data-out="note"]').textContent = PRESETS.open32.note;
    m.render();
    return { start() {}, stop() {}, destroy() { m.teardown(); } };
  };
})();
