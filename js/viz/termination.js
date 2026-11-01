/* SI & PI — viz/termination.js
 * Terminate it, then pay for it. One line, six ways to end it, driven with real
 * data: what the receivers see, and what every scheme costs under the same
 * driver, line and data.
 *
 * The solver is in js/models/termination-model.js (Bergeron's method, so the
 * reactive and biased ends the reflections page cannot show are exact for a
 * lossless line). This file draws two charts from it: the waveform at the far
 * end, at a second receiver if there is one, and at the driver pin; and one
 * cost bar per scheme, split into what the termination burns and what the
 * driver burns.
 *
 * Requires js/viz-kit.js and js/models/termination-model.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;

  const RATES = [0.1, 0.2, 0.4, 0.8, 1.6, 3.2, 6.4];               // Gb/s
  const EDGES = [20, 35, 50, 75, 100, 150, 200, 300, 500, 800];    // ps, 10-90%
  const LINES = [100, 200, 300, 500, 700, 1000, 1500, 2000];       // ps, one way
  const CIN = 1;                                                   // pF at each receiver
  const CACS = [10, 22, 47, 68, 100, 220, 330, 1000];              // pF
  const BIASES = [0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8];
  const TAPS = [0, 0.25, 0.5, 0.75];                              // where a second receiver sits; 0 = none
  const TAP_TXT = ['none', 'at ¼', 'at ½', 'at ¾'];
  const SHORT = { none: 'Unterminated', series: 'Series', parallel: 'Parallel', thevenin: 'Thevenin', ac: 'AC (R + C)', odt: 'On-die' };
  const RT_LABEL = { none: 'Terminator', series: 'Series R', parallel: 'Terminator', board: 'Terminator', thevenin: 'R₁ ∥ R₂', ac: 'AC resistor', odt: 'On-die R' };

  /* Index-valued fields (ri, ti, li, ki) point into the lists above. Plain series
     and Thevenin are one choice away in the scheme menu, so they have no button. */
  const PRESETS = {
    open: { scheme: 'none', Rt: 50, Rs: 10, data: 'clock', ri: 1, ti: 7, li: 5, ki: 6, bias: 0.5, tap: 0,
      note: 'A 10 Ω driver into 6 in of 50 Ω line, open at the far end. Both ends mismatch, so every edge rings.' },
    tap: { scheme: 'series', Rt: 40, Rs: 10, data: 'clock', ri: 1, ti: 7, li: 5, ki: 6, bias: 0.5, tap: 2,
      note: 'Series termination, a second receiver half-way along: it sits at half the rail, in the band, until the echo returns.' },
    parallel: { scheme: 'parallel', Rt: 50, Rs: 10, data: 'prbs', ri: 2, ti: 6, li: 5, ki: 6, bias: 0.5, tap: 0,
      note: '50 Ω to ground: clean at once, but the high level is 83% of the rail and the terminator burns 20 mW while high.' },
    acClock: { scheme: 'ac', Rt: 50, Rs: 20, data: 'clock', ri: 1, ti: 6, li: 3, ki: 6, bias: 0.5, tap: 0,
      note: 'A clock’s average never changes, so the 330 pF sits at mid-rail and every edge lands in the same place.' },
    acData: { scheme: 'ac', Rt: 50, Rs: 20, data: 'run', ri: 1, ti: 6, li: 3, ki: 6, bias: 0.5, tap: 0,
      note: 'Same terminator, on data: every edge is absorbed, but the capacitor follows the data and the edges move about 65 ps with it. Small against this 5 ns bit; try 47 pF.' },
    stub: { scheme: 'board', Rt: 50, Rs: 20, data: 'prbs', ri: 5, ti: 2, li: 2, ki: 6, bias: 0.5, tap: 0,
      note: 'At 3.2 Gb/s, a terminator 5 mm and a 2 nH via from the pin lets the receiver ring, 26% over. Move it to the pin and that halves; what is left is the receiver’s 1 pF reflecting off the 20 Ω driver.' }
  };

  /* One word for the far end (and the tap): the first problem found, in order of
     how badly it breaks the link. */
  function verdict(r) {
    const TM = NS.models.termination;
    const ui = r.build.ui;
    if (r.far.edges && r.far.edges.spread === Infinity) return 'misses an edge';
    if (r.levels.hi < TM.VIH || r.levels.lo > TM.VIL) return 'misses a threshold';
    // every receiver crosses the band on each edge; a tap is in trouble when it stays
    // there well beyond what the far end itself takes to cross
    if (r.tap && r.tap.band > 2 * r.far.band + 2 * r.dt) return 'tap sits in the band';
    if (r.far.over > 0.15 || r.far.under > 0.15 || r.far.ringback) return 'rings';
    if (r.far.edges && isFinite(ui) && r.far.edges.spread > 0.05 * ui) return 'edges move';
    return 'clean';
  }

  NS.viz.termination = function (root) {
    const TM = NS.models.termination;
    const axes = K.axisMemo(root);   // sticky ranges: inputs move the waveform, not the axis
    const $ = (s) => root.querySelector(s);
    const p = Object.assign({}, PRESETS.open);
    delete p.note;

    const cfgOf = () => ({
      // 'board' is the menu's name for a parallel terminator 5 mm and a via from the pin
      scheme: p.scheme === 'board' ? 'parallel' : p.scheme, place: p.scheme === 'board' ? 'stub' : 'pin',
      Rt: p.Rt, Rs: p.Rs, td: LINES[p.li], tap: p.tap > 0, tapAt: TAPS[p.tap] || 0.5,
      cin: CIN, cac: CACS[p.ki], bias: p.bias, pattern: p.data,
      rate: RATES[p.ri], tr: EDGES[p.ti]
    });

    /* The other five schemes only change when the driver, line or data do, so a
       drag of the termination value re-solves one scheme, not six. */
    const rows = new Map(); let rowsKey = '';
    function compare(cfg, mine) {
      const key = JSON.stringify(Object.assign({}, cfg, { scheme: null, Rt: null, bias: null, place: null }));
      if (key !== rowsKey) { rows.clear(); rowsKey = key; }
      return TM.ORDER.map((s) => {
        if (s === cfg.scheme) return { scheme: s, yours: true, r: mine };
        if (!rows.has(s)) rows.set(s, TM.simulate(Object.assign({}, cfg, { scheme: s, Rt: TM.matched(s, cfg.Rs), place: 'pin', bias: 0.5 }), 20000));
        return { scheme: s, yours: false, r: rows.get(s) };
      });
    }


    /* Up to 60,000 samples into a few hundred pixels: keep each column's extremes,
       in order, so ringing survives the decimation. */
    function decimate(x, dt, from, to, px) {
      const a = Math.max(0, Math.floor(from / dt)), z = Math.min(x.length - 1, Math.ceil(to / dt));
      const per = Math.max(1, Math.floor((z - a) / (2 * px)));
      const out = [];
      for (let i = a; i <= z; i += per) {
        let lo = i, hi = i;
        for (let j = i; j < Math.min(z + 1, i + per); j++) { if (x[j] < x[lo]) lo = j; if (x[j] > x[hi]) hi = j; }
        const [first, second] = lo < hi ? [lo, hi] : [hi, lo];
        out.push([first * dt, x[first]]);
        if (second !== first) out.push([second * dt, x[second]]);
      }
      return out;
    }

    function draw(T) {
      const cfg = cfgOf();
      const r = TM.simulate(cfg);
      const C = compare(cfg, r);
      const B = r.build;

      /* The waveforms, from the first measured bit to the last bit's arrival. */
      {
        const s = K.canvas($('[data-cv="wave"]'), 150);
        const step = !isFinite(B.ui);
        const delay = r.tr.tdUsed.slice(0, cfg.tap ? 2 : 1).reduce((a, b) => a + b, 0);
        const t0 = step ? B.t0 - B.trSupport : B.t0 + 2 * B.ui;
        const t1 = step ? B.tEnd : Math.min(B.tEnd, B.t0 + B.span + delay);
        const lo = Math.min(...[r.far.vmin, r.tap ? r.tap.vmin : 0, 0]), hi = Math.max(...[r.far.vmax, r.tap ? r.tap.vmax : 0, TM.VDD]);
        const yr = K.stickyAxis(axes, 'v', lo - 0.05, hi + 0.05, { head: 0.08 });
        const span = (t1 - t0) / 1000;
        const xt = span > 30 ? 10 : span > 12 ? 5 : span > 6 ? 2 : span > 3 ? 1 : span > 1.2 ? 0.5 : 0.2;
        const ticks = []; for (let v = 0; v <= span + 1e-9; v += xt) ticks.push(+v.toFixed(3));
        // volt ticks on a round step, so the axis reads 0, 0.5, 1.0 rather than fifths of its span
        const vs = [0.1, 0.2, 0.25, 0.5, 1].find((q) => (yr.max - yr.min) / q <= 6) || 1;
        const yt = []; for (let v = Math.ceil(yr.min / vs - 1e-9) * vs; v <= yr.max + 1e-9; v += vs) yt.push(+v.toFixed(3));
        const P = K.plot(s, T, {
          pad: { l: 46, r: 16, t: 16, b: 32 },
          x: { min: 0, max: span, ticks, fmt: (v) => String(+v.toFixed(2)), title: 'time, ns' },
          y: { min: yr.min, max: yr.max, ticks: yt, fmt: (v) => (vs < 0.25 ? v.toFixed(1) : String(+v.toFixed(2))), title: 'volts' }
        }).grid();
        // the receiver's threshold band
        const ctx = P.ctx;
        ctx.save(); ctx.fillStyle = K.rgba(T.alarm, 0.07);
        ctx.fillRect(P.box.L, P.Y(TM.VIH), P.box.R - P.box.L, P.Y(TM.VIL) - P.Y(TM.VIH)); ctx.restore();
        // VIH above its line and VIL below its own, so the two labels never meet
        P.hline(TM.VIH, T.muted, [2, 3]); P.hline(TM.VIL, T.muted, [2, 3]);
        K.text(ctx, 'VIH', P.box.R - 2, P.Y(TM.VIH) - 7, T.muted, 10, 'right');
        K.text(ctx, 'VIL', P.box.R - 2, P.Y(TM.VIL) + 8, T.muted, 10, 'right');
        const px = Math.max(100, P.box.R - P.box.L);
        const pts = (node) => decimate(r.rec[node], r.dt, t0, t1, px).map(([t, v]) => [(t - t0) / 1000, v]);
        P.trace(pts(r.nodes.D), T.muted, { width: 1.2, dash: [4, 3], id: 'tm-driver', label: 'driver pin', unit: 'V' });
        if (r.nodes.T !== undefined) P.trace(pts(r.nodes.T), T.reflect, { width: 1.6, id: 'tm-tap', label: 'second receiver', unit: 'V' });
        P.trace(pts(r.nodes.F), T.signal, { width: 2, id: 'tm-far', label: 'far end', unit: 'V' });
        P.frame();
      }

      /* One bar per scheme: what the termination burns, then what the driver does,
         with the total and a word for the far end in a column of their own. */
      {
        const s = K.canvas($('[data-cv="cost"]'), 124);
        const narrow = s.w < 420, n = C.length, top = Math.max(...C.map((c) => c.r.total)) * 1e3;
        const xr = K.stickyAxis(axes, 'mw', 0, Math.max(top, 0.5), { head: 0.08 });
        const P = K.plot(s, T, {
          pad: { l: narrow ? 82 : 92, r: narrow ? 52 : 150, t: 8, b: 30, keepR: true },
          x: { min: 0, max: xr.max, fmt: (v) => String(+v.toFixed(1)), title: 'mW per net' },
          y: { min: 0, max: n, ticks: [] }
        }).grid();
        const ctx = P.ctx, rowH = (P.box.B - P.box.TP) / n, barH = Math.min(12, rowH * 0.56);
        C.forEach((c, i) => {
          const yMid = P.box.TP + (i + 0.5) * rowH, y = yMid - barH / 2;
          const term = c.r.avg.term * 1e3, drv = c.r.avg.driver * 1e3, tot = term + drv;
          ctx.save();
          ctx.fillStyle = c.yours ? T.signal : K.rgba(T.signal, 0.45);
          ctx.fillRect(P.X(0), y, Math.max(0, P.X(term) - P.X(0)), barH);
          ctx.fillStyle = K.rgba(T.muted, c.yours ? 0.6 : 0.35);
          ctx.fillRect(P.X(term), y, Math.max(0, P.X(tot) - P.X(term)), barH);
          ctx.restore();
          const ink = c.yours ? T.ink : T.muted;
          const name = c.yours && cfg.place === 'stub' ? 'Board R' : SHORT[c.scheme];
          K.text(ctx, (c.yours ? '▸ ' : '') + name, P.box.L - 8, yMid, ink, 10, 'right');
          const mwTxt = (tot < 0.05 ? '0' : tot.toFixed(tot < 10 ? 1 : 0)) + ' mW';
          K.text(ctx, narrow ? mwTxt : mwTxt + ' · ' + verdict(c.r), P.box.R + 8, yMid, ink, 10, 'left');
        });
        P.frame();
        // Bars, not traces: there is nothing here for the loader's cursor to read.
        delete $('[data-cv="cost"]').__plot;
      }

      /* Readouts */
      const set = (k, v) => { const e = $('[data-out="' + k + '"]'); if (e) e.textContent = v; };
      const mw = (w) => { const m = w * 1e3; return m < 0.05 ? '0 mW' : (m < 10 ? m.toFixed(1) : Math.round(m)) + ' mW'; };
      set('lv', r.levels.lo.toFixed(2) + '–' + r.levels.hi.toFixed(2) + ' V');
      set('over', Math.round(100 * Math.max(r.far.over, r.far.under)) + '%');
      const e = r.far.edges;
      set('spread', !e ? '—' : e.spread === Infinity ? 'misses' : Math.round(e.spread) + ' ps');
      set('tap', r.tap ? (r.tap.band / 1000).toFixed(2) + ' ns' : '—');
      set('pnet', mw(r.total));
      set('pbus', mw(r.total * TM.BUS));

      /* Controls show what is in force; the ones a scheme does not use stand down. */
      const sch = p.scheme;
      $('#tm-scheme').value = sch;
      $('#tm-data').value = p.data;
      $('#tm-rt').value = p.Rt; $('#tm-rt-out').value = sch === 'none' ? '—' : p.Rt + ' Ω';
      $('#tm-rt-label').textContent = RT_LABEL[sch];
      $('#tm-rs').value = p.Rs; $('#tm-rs-out').value = p.Rs + ' Ω';
      $('#tm-rate').value = p.ri; $('#tm-rate-out').value = p.data === 'step' ? '—' : (RATES[p.ri] < 1 ? Math.round(RATES[p.ri] * 1000) + ' Mb/s' : RATES[p.ri] + ' Gb/s');
      $('#tm-tr').value = p.ti;
      $('#tm-tr-out').value = (B.trSupport * TM.SMOOTH_1090 < EDGES[p.ti] - 0.5 ? Math.round(B.trSupport * TM.SMOOTH_1090) + ' ps (fitted)' : EDGES[p.ti] + ' ps');
      $('#tm-td').value = p.li; $('#tm-td-out').value = (LINES[p.li] / (TM.PS_PER_MM * 25.4)).toFixed(1) + ' in';
      /* One slot, two meanings: the AC terminator's capacitor, or where the Thevenin
         pair biases the line. Any other scheme has neither. */
      const ex = $('#tm-extra');
      if (sch === 'thevenin') {
        ex.max = BIASES.length - 1; ex.value = Math.max(0, BIASES.findIndex((b) => Math.abs(b - p.bias) < 1e-9));
        $('#tm-extra-label').textContent = 'Bias'; $('#tm-extra-out').value = Math.round(p.bias * 100) + '% of VDD';
      } else {
        ex.max = CACS.length - 1; ex.value = p.ki;
        $('#tm-extra-label').textContent = 'AC capacitor'; $('#tm-extra-out').value = sch === 'ac' ? CACS[p.ki] + ' pF' : '—';
      }
      $('#tm-tap').value = p.tap; $('#tm-tap-out').value = TAP_TXT[p.tap];
      $('#tm-rt').disabled = sch === 'none';
      ex.disabled = sch !== 'ac' && sch !== 'thevenin';
      $('#tm-rate').disabled = p.data === 'step';
    }

    const mnt = K.mount({ root, params: p, draw });
    /* Synchronous, as every module's readouts must be: the loader's values table
       reads them straight after the input event. Dragging the terminator re-solves
       only the reader's own scheme; the other five come from the cache above. */
    const render = () => mnt.render();
    const clear = () => {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      $('[data-out="note"]').textContent = 'Custom';
    };
    const num = (v) => +v;
    [['#tm-scheme', 'scheme', String], ['#tm-data', 'data', String]].forEach(([id, k, f]) =>
      $(id).addEventListener('change', (e) => {
        p[k] = f(e.target.value);
        // a newly chosen scheme starts at its own matched value
        if (k === 'scheme') p.Rt = TM.matched(cfgOf().scheme, p.Rs) || p.Rt;
        clear(); render();
      }));
    [['#tm-rt', 'Rt'], ['#tm-rs', 'Rs'], ['#tm-rate', 'ri'], ['#tm-tr', 'ti'], ['#tm-td', 'li'], ['#tm-tap', 'tap']].forEach(([id, k]) =>
      $(id).addEventListener('input', (e) => { p[k] = num(e.target.value); clear(); render(); }));
    $('#tm-extra').addEventListener('input', (e) => {
      if (p.scheme === 'thevenin') p.bias = BIASES[+e.target.value]; else p.ki = +e.target.value;
      clear(); render();
    });
    root.querySelectorAll('.preset[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const q = PRESETS[b.dataset.preset];
      if (!q) return;
      Object.keys(p).forEach((k) => { if (k in q) p[k] = q[k]; });
      root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      $('[data-out="note"]').textContent = q.note;
      mnt.render();
    }));
    root.querySelector('.preset[data-preset="open"]').setAttribute('aria-pressed', 'true');
    $('[data-out="note"]').textContent = PRESETS.open.note;
    // Room for the longest note, so pressing a preset changes the words, not the panel's height.
    const notes = Object.values(PRESETS).map((q) => q.note).concat(['Custom']);
    const reserve = () => K.reserveText($('[data-out="note"]'), notes);
    reserve();
    window.addEventListener('resize', reserve);
    // A tab switch asks for pixels; without this the loader nudges the first slider
    // and the panel drops its preset.
    const offRepaint = K.onRepaint(root, () => mnt.render());
    mnt.render();
    return { start() {}, stop() {}, destroy() { window.removeEventListener('resize', reserve); offRepaint(); mnt.teardown(); } };
  };
  NS.viz.termination.PRESETS = PRESETS;
  NS.viz.termination.verdict = verdict;
  NS.viz.termination.GRID = { RATES, EDGES, LINES, CIN, CACS, BIASES, TAPS };
})();
