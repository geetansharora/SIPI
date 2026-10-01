/* SIPI — viz/tdr.js
 * Build a channel, read its TDR. Two views of one measurement: the impedance the
 * instrument reports against distance, laid over what the channel really is, and
 * the raw reflection against round-trip time, which is what the instrument records.
 * Maths: js/models/tdr-model.js. Requires viz-kit.js and tdr-model.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;

  const PRESETS = {
    via: { set: {},
      note: 'A 0.5 pF via in a 50 Ω line, read with a 35 ps edge. A shunt capacitance pulls the reflection negative for as long as the edge is charging it, so it shows as a dip. The dip is the edge’s width, not the via’s, and its depth depends on the edge as much as on the capacitance.' },
    clean: { set: { via: 'none' },
      note: 'A matched 50 Ω line into a matched load: nothing comes back, and the reading is flat at 50 Ω all the way to the end. Every feature in the other scenarios is measured against this.' },
    inductive: { set: { via: 'l', viaSize: 1 },
      note: 'A 1 nH series inductance instead: a bump. An inductor resists the change in current while the edge passes, so the reflection goes positive. Dip for capacitance, bump for inductance is the first thing to read on any TDR.' },
    merge: { set: { via2: true, gap: 10 },
      note: 'Two identical vias 10 ps apart, one way, read with a 35 ps edge. Their reflections arrive 20 ps apart, less than the edge, so they merge into one deeper dip. Nothing in the trace says there are two.' },
    resolve: { set: { via2: true, gap: 10, tr: 10 },
      note: 'The same two vias with a 10 ps edge. Now the edge is shorter than the 20 ps between their reflections, and they separate. Resolution is set by the edge, not by the sample rate. The ripple after them is real: an edge this fast bounces back and forth between the two vias before it leaks away.' },
    neck: { set: { via: 'none', zs: 35, sps: 10 },
      note: 'A 35 Ω neck only 10 ps long. It is shorter than the edge, so the reading never reaches 35 Ω: it bottoms out well above it. A short feature’s apparent impedance is not its real one. Lengthen the section and watch the reading settle at the true value.' },
    mask: { set: { via: 'none', zs: 30, sps: 150, load: 'r', rl: 70 },
      note: 'A 30 Ω section, then a 70 Ω load behind it. The section reads correctly, but what follows it is seen through its two boundaries, and the first level the load shows is not 70 Ω. That is masking: everything after a large mismatch is distorted by it, and only layer peeling or a model recovers it.' },
    loss: { set: { via: 'none', loss: 1.5, len1: 3, len2: 3 },
      note: 'A uniform 50 Ω line with 1.5 dB per inch of loss at 10 GHz, matched at the far end. The line does not change along its length, yet the reading climbs. The loss is in the line’s series resistance, and the further the edge travels the more of it the reading includes. A rising baseline on a lossy trace is not a taper.' },
    open: { set: { via: 'none', load: 'open' },
      note: 'An open end: everything reflects with the same sign, ρ goes to +1 and the impedance off the top of the scale. A short sends it to −1 and zero. Those two shapes are how you find the end of a line, and a broken one.' }
  };

  /* Round tick steps (1, 2 or 5 times a power of ten) across [lo, hi]. */
  function ticks(lo, hi, count) {
    const raw = (hi - lo) / count, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw);
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toPrecision(10));
    return out;
  }

  NS.viz.tdr = function (root) {
    const M = (NS.models || {}).tdr;
    if (!M) throw new Error('js/models/tdr-model.js must load before this panel');
    const $ = (s) => root.querySelector(s);
    const cvZ = $('[data-cv="profile"]'), cvR = $('[data-cv="scope"]');
    const p = Object.assign({}, M.defaults);
    const keep = {};

    const LOG = { 'td-tr': ['tr', 8, 200] };
    const toT = (lo, hi, v) => Math.round(1000 * Math.log(v / lo) / Math.log(hi / lo));
    const fromT = (lo, hi, t) => Number((lo * Math.pow(hi / lo, t / 1000)).toPrecision(3));
    const LIN = {
      'td-zt': ['zt', 1], 'td-l1': ['len1', 0.1], 'td-l2': ['len2', 0.1], 'td-loss': ['loss', 0.1],
      'td-gap': ['gap', 1], 'td-zs': ['zs', 1], 'td-sps': ['sps', 1], 'td-rl': ['rl', 1]
    };

    function zRange(r) {
      let lo = Infinity, hi = -Infinity;
      for (const s of r.channel.truth) { lo = Math.min(lo, s.z); hi = Math.max(hi, s.z); }
      const n = Math.min(r.z.length, Math.round(r.roundTripEnd + 400));
      for (let i = 0; i < n; i++) { lo = Math.min(lo, r.z[i]); hi = Math.max(hi, r.z[i]); }
      if (isFinite(r.channel.zl)) { lo = Math.min(lo, r.channel.zl); hi = Math.max(hi, r.channel.zl); }
      lo = Math.max(0, Math.floor((lo - 4) / 5) * 5);
      hi = Math.min(150, Math.ceil((hi + 4) / 5) * 5);
      return [lo, Math.max(hi, lo + 20)];
    }

    function drawProfile(T, r) {
      const s = K.canvas(cvZ, 230);
      const xMax = M.toIn(r.roundTripEnd) + 0.6;
      /* Not K.sticky: that always includes zero, and a 45-55 Ω story drawn on a 0-60 Ω
         axis is a flat line. Keep the last range while the data still fits it with some
         room, so a drag moves the trace rather than the axis. */
      const need = zRange(r), prev = keep.z;
      const fits = prev && need[0] >= prev[0] && need[1] <= prev[1] && (need[1] - need[0]) > 0.4 * (prev[1] - prev[0]);
      const yr = fits ? prev : (keep.z = need);
      const P = K.plot(s, T, {
        pad: { l: 50, r: 16, t: 18, b: 30 },
        x: { min: 0, max: xMax, ticks: ticks(0, xMax, 6), fmt: (v) => +v.toFixed(2) + '', title: 'distance from the reference plane, in' },
        y: { min: yr[0], max: yr[1], ticks: ticks(yr[0], yr[1], 5), fmt: (v) => v.toFixed(0), title: 'Ω' }
      }).grid();
      const ctx = s.ctx;
      /* the truth first, underneath: stepped sections, lumped features as ticks */
      const pts = [];
      for (const seg of r.channel.truth) {
        pts.push([seg.t0 / M.PS_PER_IN, seg.z], [seg.t1 / M.PS_PER_IN, seg.z]);
      }
      const end = r.channel.end / M.PS_PER_IN;
      const zl = r.channel.zl;
      const zlDraw = zl === Infinity ? yr[1] : Math.max(yr[0], Math.min(yr[1], zl));
      pts.push([end, zlDraw], [xMax, zlDraw]);
      P.trace(pts, T.ink2, { width: 1.6, dash: [5, 4], label: 'the channel as built', unit: 'Ω' });
      const marks = r.channel.marks, size = (mk) => mk.size + (mk.kind === 'c' ? ' pF' : ' nH');
      marks.forEach((mk, i) => {
        const x = P.X(mk.t / M.PS_PER_IN);
        K.line(ctx, x, P.Y(yr[0]), x, P.Y(yr[1]), T.muted, 1, [2, 3]);
        if (i > 0 && x - P.X(marks[i - 1].t / M.PS_PER_IN) < 48) return;      // named once, with its twin
        const twin = marks[i + 1] && P.X(marks[i + 1].t / M.PS_PER_IN) - x < 48;
        K.text(ctx, (twin ? '2 × ' : '') + size(mk), x + 4, P.box.TP + 8, T.muted, 10, 'left');
      });
      P.vline(end, T.muted, [2, 4], zl === Infinity ? 'open' : zl === 0 ? 'short' : 'load ' + (zl === M.Z0 ? 'matched' : zl + ' Ω'));
      /* the reading, on top */
      const n = Math.min(r.z.length, Math.round(2 * xMax * M.PS_PER_IN));
      const tdr = [];
      for (let i = 0; i < n; i += 2) tdr.push([M.toIn(r.t[i]), Math.max(yr[0], Math.min(yr[1], r.z[i]))]);
      P.trace(tdr, T.signal, { width: 2.2, label: 'what the TDR reads', unit: 'Ω' });
      P.frame();
    }

    function drawScope(T, r) {
      const s = K.canvas(cvR, 180);
      const tMax = r.roundTripEnd + 400;
      let lo = 0, hi = 0;
      for (let i = 0; i < Math.min(r.rho.length, tMax); i++) { lo = Math.min(lo, r.rho[i]); hi = Math.max(hi, r.rho[i]); }
      const yr = K.sticky(keep, 'r', Math.max(-1.05, lo - 0.05), Math.min(1.05, hi + 0.05));
      const P = K.plot(s, T, {
        pad: { l: 50, r: 16, t: 18, b: 30 },
        x: { min: 0, max: tMax, ticks: ticks(0, tMax, 6), fmt: (v) => v.toFixed(0), title: 'round-trip time, ps' },
        y: { min: yr[0], max: yr[1], ticks: ticks(yr[0], yr[1], 5), fmt: (v) => +v.toFixed(2) + '', title: 'ρ' }
      }).grid();
      P.hline(0, T.muted, [3, 3]);
      const pts = [];
      for (let i = 0; i < Math.min(r.rho.length, tMax); i += 2) pts.push([r.t[i], r.rho[i]]);
      P.trace(pts, T.signal, { width: 2, label: 'reflection coefficient', unit: '' });
      P.vline(r.roundTripEnd, T.muted, [2, 4], 'round trip to the load');
      P.frame();
    }

    function readouts(r) {
      const out = (k, v) => { const e = $('[data-out="' + k + '"]'); if (e) e.textContent = v; };
      out('edge', r.edgeIn.toFixed(2) + ' in');
      out('res', r.resolutionIn.toFixed(2) + ' in');
      out('rt', r.roundTripEnd.toFixed(0) + ' ps');
      const stop = Math.min(r.z.length - 1, r.roundTripEnd - 1);
      const lo = M.extremum(r, 1, stop, -1), hi = M.extremum(r, 1, stop, +1);
      out('min', lo.z.toFixed(1) + ' Ω at ' + M.toIn(lo.t).toFixed(2) + ' in');
      out('max', hi.z.toFixed(1) + ' Ω at ' + M.toIn(hi.t).toFixed(2) + ' in');
    }

    function syncControls() {
      Object.keys(LOG).forEach((id) => { const [k, lo, hi] = LOG[id]; $('#' + id).value = toT(lo, hi, p[k]); });
      Object.keys(LIN).forEach((id) => { const [k, sc] = LIN[id]; $('#' + id).value = Math.round(p[k] / sc); });
      const fmt = { 'td-tr': p.tr + ' ps', 'td-zt': p.zt + ' Ω', 'td-l1': p.len1.toFixed(1) + ' in', 'td-l2': p.len2.toFixed(1) + ' in',
        'td-loss': p.loss.toFixed(1) + ' dB/in', 'td-gap': p.gap + ' ps', 'td-zs': p.zs + ' Ω', 'td-sps': p.sps + ' ps',
        'td-rl': p.rl + ' Ω', 'td-vs': p.via === 'l' ? p.viaSize.toFixed(1) + ' nH' : p.viaSize.toFixed(2) + ' pF' };
      Object.keys(fmt).forEach((id) => { const e = $('#' + id + '-out'); if (e) e.value = fmt[id]; });
      $('#td-vs').value = Math.round(p.viaSize * (p.via === 'l' ? 10 : 100));
      $('#td-vs').max = p.via === 'l' ? 30 : 200;
      root.querySelectorAll('[data-via]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.via === p.via)));
      root.querySelectorAll('[data-load]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.load === p.load)));
      $('#td-via2').checked = !!p.via2;
      $('[data-ctl="vs"]').hidden = p.via === 'none';
      $('[data-ctl="gap"]').hidden = p.via === 'none' || !p.via2;
      $('[data-ctl="via2"]').hidden = p.via === 'none';
      $('[data-ctl="rl"]').hidden = p.load !== 'r';
    }

    const m = K.mount({
      root, params: p, height: 0,
      draw(T) { const r = M.run(p); drawProfile(T, r); drawScope(T, r); readouts(r); syncControls(); }
    });

    function clearPreset() {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      $('[data-out="note"]').textContent = 'Custom';
    }
    const refit = () => { delete keep.z; delete keep.r; };
    Object.keys(LOG).forEach((id) => {
      const [k, lo, hi] = LOG[id];
      $('#' + id).addEventListener('input', (e) => { p[k] = fromT(lo, hi, +e.target.value); clearPreset(); m.render(); });
    });
    Object.keys(LIN).forEach((id) => {
      const [k, sc] = LIN[id];
      $('#' + id).addEventListener('input', (e) => { p[k] = +(+e.target.value * sc).toFixed(2); clearPreset(); m.render(); });
    });
    $('#td-vs').addEventListener('input', (e) => { p.viaSize = +e.target.value / (p.via === 'l' ? 10 : 100); clearPreset(); m.render(); });
    $('#td-via2').addEventListener('change', (e) => { p.via2 = e.target.checked; refit(); clearPreset(); m.render(); });
    root.querySelectorAll('[data-via]').forEach((b) => b.addEventListener('click', () => {
      p.via = b.dataset.via; p.viaSize = p.via === 'l' ? 1 : 0.5; refit(); clearPreset(); m.render();
    }));
    root.querySelectorAll('[data-load]').forEach((b) => b.addEventListener('click', () => {
      p.load = b.dataset.load; refit(); clearPreset(); m.render();
    }));
    root.querySelectorAll('.preset[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const c = PRESETS[b.dataset.preset];
      if (!c) return;
      Object.assign(p, M.defaults, c.set); refit();
      root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      $('[data-out="note"]').textContent = c.note;
      m.render();
    }));
    $('[data-out="note"]').textContent = PRESETS.via.note;
    /* answer repaints ourselves: otherwise the kit nudges the first slider, which
       rounds the rise time through its log scale and clears the scenario */
    const off = K.onRepaint(root, () => m.render());
    m.render();
    return { start() {}, stop() {}, destroy() { off(); m.teardown(); } };
  };
  NS.viz.tdr.presets = PRESETS;
})();
