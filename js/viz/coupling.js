/* SIPI — viz/coupling.js
 * Capacitive and inductive coupling from one aggressor, side by side: what the
 * victim sees in time, and where it sits in frequency. Capacitive pickup follows
 * the aggressor's voltage slew and the victim's impedance; inductive pickup follows
 * how much current moves and how fast.
 * Maths: js/models/coupling-model.js. Requires viz-kit.js and coupling-model.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;

  const PRESETS = {
    gpio: { V: 3.3, tr: 1e-9, load: 'c', I: 20e-3, CL: 10e-12, Rv: 10e3,
      note: 'A 3.3 V GPIO driving 10 pF, beside a 10 kΩ reference node. Its current is a pulse on every edge, so both couplings are present. The node’s high impedance is what makes the capacitive pickup large.' },
    lowz: { V: 3.3, tr: 1e-9, load: 'c', I: 20e-3, CL: 10e-12, Rv: 50,
      note: 'The same GPIO, but the victim is a 50 Ω node. The capacitive pickup falls with the impedance; the inductive pickup does not move, because it never depended on the node.' },
    slow: { V: 3.3, tr: 4e-9, load: 'c', I: 20e-3, CL: 10e-12, Rv: 10e3,
      note: 'The first GPIO with 4 ns edges. The inductive spikes shrink the most: into a capacitive load they are a second derivative, and their height follows dV/dt.' },
    reg: { V: 12, tr: 5e-9, load: 'r', I: 3, CL: 10e-12, Rv: 10,
      note: 'A 12 V, 3 A switching loop beside a 10 Ω sense line. Modest slew, large current moving: a dI/dt aggressor into a low-impedance victim. Inductive coupling dominates.' }
  };

  NS.viz.coupling = function (root) {
    const C = (NS.models || {}).coupling;
    if (!C) throw new Error('js/models/coupling-model.js must load before this panel');
    const $ = (s) => root.querySelector(s);
    const cvT = $('[data-cv="time"]'), cvF = $('[data-cv="spec"]');
    const p = Object.assign({}, PRESETS.gpio);
    delete p.note;
    const keep = {};

    /* log sliders: 0..1000 across [lo, hi] */
    const LOG = { 'cp-tr': ['tr', 0.1e-9, 10e-9], 'cp-i': ['I', 1e-3, 10], 'cp-cl': ['CL', 1e-12, 1e-9], 'cp-rv': ['Rv', 1, 1e6] };
    const toT = (lo, hi, v) => Math.round(1000 * Math.log(v / lo) / Math.log(hi / lo));
    const fromT = (lo, hi, t) => Number((lo * Math.pow(hi / lo, t / 1000)).toPrecision(3));
    const fmtV = (v) => K.si(v, 'V', 3), fmtA = (v) => K.si(v, 'A', 3);

    function drawTime(T, r) {
      const s = K.canvas(cvT, 190);
      const q = r.q, W = C.waveform(q, 1600, 1);
      const top = K.sticky(keep, 'y', 0, Math.max(W.cap.peak, W.ind.peak) * 1e3 * 1.12, false)[1];
      const P = K.plot(s, T, {
        pad: { l: 50, r: 14, t: 16, b: 30 },
        x: { min: 0, max: q.T * 1e9, count: 5, fmt: (v) => v.toFixed(0), title: 'time, ns' },
        y: { min: -top, max: top, count: 5, fmt: (v) => v.toFixed(Math.abs(top) < 10 ? 1 : 0), title: 'pickup, mV' }
      }).grid();
      /* the aggressor's edges, where all of the coupling happens */
      K.shadeX(P, 0, q.ramp * 1e9, T.muted + '22');
      K.shadeX(P, q.T / 2 * 1e9, (q.T / 2 + q.ramp) * 1e9, T.muted + '22');
      const line = (w) => Array.from(w.t, (t, i) => [t * 1e9, w.y[i] * 1e3]);
      P.trace(line(W.cap), T.signal, { width: 2, label: 'capacitive', unit: 'mV' });
      P.trace(line(W.ind), T.reflect, { width: 2, label: 'inductive', unit: 'mV' });
      P.frame();
      K.text(s.ctx, 'edges shaded', P.box.L + 6, P.box.TP + 8, T.muted, 10, 'left');
    }

    function drawSpec(T, r) {
      const s = K.canvas(cvF, 190);
      const q = r.q, F_LO = 1e7, F_HI = 1e10;
      const hs = C.harmonics(q, F_HI);
      const db = (a) => 20 * Math.log10(Math.max(a, 1e-9));
      const P = K.plot(s, T, {
        pad: { l: 50, r: 14, t: 16, b: 30 },
        x: { min: F_LO, max: F_HI, log: true, fmt: K.fmt.hz, title: 'frequency' },
        y: { min: -140, max: 20, ticks: [-140, -100, -60, -20, 20], fmt: (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1)), title: 'dBV' }
      }).grid();
      const ctx = s.ctx, y0 = P.Y(-140);
      /* ~500 harmonics to 10 GHz: drawn faint, so the two pickups read first */
      ctx.save(); ctx.strokeStyle = T.muted; ctx.globalAlpha = 0.35; ctx.lineWidth = 1; ctx.beginPath();
      hs.forEach((h) => { const x = P.X(h.f); ctx.moveTo(x, y0); ctx.lineTo(x, P.Y(Math.max(-140, db(h.agg)))); });
      ctx.stroke(); ctx.restore();
      P.trace(hs.map((h) => [h.f, db(h.cap)]), T.signal, { width: 2, label: 'capacitive', unit: 'dBV' });
      P.trace(hs.map((h) => [h.f, db(h.ind)]), T.reflect, { width: 2, label: 'inductive', unit: 'dBV' });
      const cn = r.corners;
      [[cn.edge, 'edge corner', T.ink2], [cn.cap, 'victim corner', T.signal], [cn.loop, 'loop 1 GHz', T.reflect]].forEach(([f, lbl, col], i) => {
        if (f < F_LO || f > F_HI) return;
        P.vline(f, col, [3, 4]);
        K.text(ctx, lbl, P.X(f) + 4, P.box.TP + 8 + i * 12, col, 10, P.X(f) > (P.box.L + P.box.R) * 0.7 ? 'right' : 'left');
      });
      P.frame();
    }

    function readouts(r) {
      const q = r.q, out = (k, v) => { const e = $('[data-out="' + k + '"]'); if (e) e.textContent = v; };
      out('dvdt', (q.S / 1e9).toPrecision(3) + ' V/ns');
      out('didt', q.load === 'r' ? K.si(q.dIdt / 1e9, 'A', 3) + '/ns' : fmtA(q.Iedge) + ' pulse');
      out('cap', K.si(r.capPeak, 'V', 3));
      out('ind', K.si(r.indPeak, 'V', 3));
      out('dom', r.dominant);
      out('zstar', r.crossover ? K.si(r.crossover, 'Ω', 3) : 'n/a (C load)');
      const sg = (v) => (v >= 0 ? '+' : '') + v.toFixed(1) + ' dB';
      out('faster', 'C ' + sg(r.faster.cap) + ' · L ' + sg(r.faster.ind));
      $('#cp-v-out').value = fmtV(q.V);
      $('#cp-v').value = Math.round(q.V * 10);
      $('#cp-tr-out').value = K.si(q.tr, 's', 3);
      $('#cp-i-out').value = fmtA(q.I);
      $('#cp-cl-out').value = K.si(q.CL, 'F', 3);
      $('#cp-rv-out').value = K.si(q.Rv, 'Ω', 3);
      Object.keys(LOG).forEach((id) => { const [key, lo, hi] = LOG[id]; $('#' + id).value = toT(lo, hi, p[key]); });
      root.querySelectorAll('[data-load]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.load === p.load)));
      $('[data-ctl="i"]').hidden = p.load !== 'r';
      $('[data-ctl="cl"]').hidden = p.load !== 'c';
      $('[data-out="clamp"]').textContent = q.clamped ? 'Edge held to 45% of the period.' : '';
    }

    const m = K.mount({
      root, params: p, height: 0,
      draw(T) { const r = C.run(p); drawTime(T, r); drawSpec(T, r); readouts(r); }
    });

    function clearPreset() {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      $('[data-out="note"]').textContent = 'Custom';
    }
    $('#cp-v').addEventListener('input', (e) => { p.V = +e.target.value / 10; clearPreset(); m.render(); });
    Object.keys(LOG).forEach((id) => {
      const [key, lo, hi] = LOG[id];
      $('#' + id).addEventListener('input', (e) => { p[key] = fromT(lo, hi, +e.target.value); clearPreset(); m.render(); });
    });
    /* A new scenario re-fits the time axis; a slider drag keeps it, so the trace moves. */
    const refit = () => { delete keep.y; };
    root.querySelectorAll('[data-load]').forEach((b) => b.addEventListener('click', () => {
      p.load = b.dataset.load; refit(); clearPreset(); m.render();
    }));
    root.querySelectorAll('.preset[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const c = PRESETS[b.dataset.preset];
      if (!c) return;
      Object.assign(p, c); delete p.note; refit();
      root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      $('[data-out="note"]').textContent = c.note;
      m.render();
    }));
    $('[data-out="note"]').textContent = PRESETS.gpio.note;
    m.render();
    return { start() {}, stop() {}, destroy() { m.teardown(); } };
  };
})();
