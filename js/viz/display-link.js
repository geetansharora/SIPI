/* SI & PI — viz/display-link.js
 * Will it train? A display link from source die to sink die: boards, connectors,
 * a cable and, if the reader adds one, a retimer. The loss chart shows each
 * segment against frequency with every rate's budget at its Nyquist; the ladder
 * shows the rates link training tries, highest first, and where it settles.
 * "Train" steps down the ladder one rate at a time.
 *
 * The same module serves DisplayPort and HDMI: the protocol comes from the
 * mount point's data-protocol, and each protocol has its own presets.
 *
 * All the arithmetic is in js/models/display-link-model.js; this draws it.
 *
 * Requires js/viz-kit.js, js/models/calc-models.js, js/models/laminates.js and
 * js/models/display-link-model.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;

  const PRESETS = {
    dp: {
      desk: { cap: 6, lanes: 4, srcIn: 4, sinkIn: 3, lam: 'megtron4', cableM: 1, awg: 30, retimer: 'none',
        note: 'A graphics card to a monitor over a 1 m, 30 AWG cable. Every segment fits UHBR20’s 22.5 dB at 10 GHz with room to spare, so the link trains at the top rate.' },
      long: { cap: 6, lanes: 4, srcIn: 4, sinkIn: 3, lam: 'megtron4', cableM: 3, awg: 30, retimer: 'none',
        note: 'The same link with a 3 m cable. At 10 GHz the path loses more than UHBR20’s budget, so training drops to UHBR13.5: two thirds of the payload.' },
      thin: { cap: 6, lanes: 4, srcIn: 4, sinkIn: 3, lam: 'megtron4', cableM: 2, awg: 34, retimer: 'none',
        note: 'A thin, flexible 2 m cable of 34 AWG. Thinner wire means more resistance at every frequency, and UHBR13.5 only just fits.' },
      retimer: { cap: 6, lanes: 4, srcIn: 4, sinkIn: 3, lam: 'megtron4', cableM: 3, awg: 30, retimer: 'source',
        note: 'The 3 m cable with a retimer beside the source’s connector. The source board becomes a segment of its own, and the rest just fits UHBR20 again.' },
      usbc: { cap: 3, lanes: 2, srcIn: 8, sinkIn: 3, lam: 'isola-370hr', cableM: 1, awg: 32, retimer: 'none',
        note: 'A laptop’s USB-C port in DisplayPort Alt Mode, two lanes beside USB data, HBR3 at most, 8 in of FR-4. Loss is easy here; the lanes are what limit the payload.' }
    },
    hdmi: {
      tv: { cap: 7, lanes: 4, srcIn: 3, sinkIn: 4, lam: 'isola-370hr', cableM: 2, awg: 28, retimer: 'none',
        note: 'A games console to a television over a 2 m, 28 AWG cable, FR-4 at both ends. FRL 12G fits its 20 dB at 6 GHz with about 3 dB to spare.' },
      long: { cap: 7, lanes: 4, srcIn: 3, sinkIn: 4, lam: 'isola-370hr', cableM: 4, awg: 28, retimer: 'none',
        note: 'The same link with a 4 m cable. FRL 12G and 10G no longer fit, and the link settles two rates down at FRL 8G: two thirds of the payload.' },
      thin: { cap: 7, lanes: 4, srcIn: 3, sinkIn: 4, lam: 'isola-370hr', cableM: 4, awg: 32, retimer: 'none',
        note: 'A thinner 4 m cable of 32 AWG. Its wire loses more at every frequency, and the link drops to FRL 6G on four lanes.' },
      retimer: { cap: 7, lanes: 4, srcIn: 3, sinkIn: 4, lam: 'isola-370hr', cableM: 4, awg: 28, retimer: 'sink',
        note: 'The 4 m cable with a retimer by the television’s connector. Its 4 in board becomes a segment of its own, and FRL 12G fits again.' },
      hdmi20: { cap: 1, lanes: 4, srcIn: 3, sinkIn: 4, lam: 'isola-370hr', cableM: 2, awg: 28, retimer: 'none',
        note: 'A sink that offers no FRL, an HDMI 2.0 television. The link runs TMDS at 6 Gb/s on three lanes beside a clock, with loss to spare.' }
    }
  };
  const FMAX = { dp: 11, hdmi: 7 };                       // GHz, the loss chart's span
  const ROW_MS = 450;                                     // one rung of the ladder, animated

  /* Round ticks from zero: a step of 1, 2, 5 or 10 times a power of ten, at most five. */
  function ticks(hi) {
    const e = Math.pow(10, Math.floor(Math.log10(hi / 5)));
    const step = [1, 2, 5, 10].map((m) => m * e).find((q) => hi / q <= 5);
    const out = []; for (let v = 0; v <= hi + 1e-9; v += step) out.push(+v.toPrecision(10));
    return out;
  }

  NS.viz.displayLink = function (root) {
    const D = NS.models.displayLink;
    const proto = root.dataset.protocol || 'dp', P = D.PROTOCOLS[proto], PS = PRESETS[proto];
    const first = Object.keys(PS).find((k) => root.querySelector('.preset[data-preset="' + k + '"][aria-pressed="true"]')) || Object.keys(PS)[0];
    const $ = (s) => root.querySelector(s);
    const axes = K.axisMemo(root);
    const p = Object.assign({}, PS[first]);
    delete p.note;
    const cfgOf = () => Object.assign({ proto }, p);
    let anim = null;                                      // { t } while the ladder is being walked

    function draw(T) {
      const cfg = cfgOf(), R = D.train(cfg), fmax = FMAX[proto];
      const tried = anim ? Math.floor(anim.t / ROW_MS) : Infinity;   // rungs already decided
      const settled = R.trained ? R.ladder.indexOf(R.trained) : R.ladder.length - 1;

      /* Loss against frequency, each segment, with every rate's budget. */
      {
        const s = K.canvas($('[data-cv="loss"]'), 150);
        const C = D.curves(cfg, fmax * 1e9, 110);
        let hi = 0; C.forEach((c) => c.forEach((q) => { hi = Math.max(hi, q[1]); }));
        R.ladder.forEach((x) => { hi = Math.max(hi, x.rate.budget); });
        const yr = K.stickyAxis(axes, 'loss', 0, hi, { head: 0.1 });
        const P2 = K.plot(s, T, {
          pad: { l: 40, r: 12, t: 16, b: 30 },
          x: { min: 0, max: fmax, ticks: [0, 2, 4, 6, 8, 10].filter((v) => v <= fmax), fmt: (v) => String(v), title: 'GHz' },
          y: { min: 0, max: yr.max, ticks: ticks(yr.max), fmt: (v) => String(v), title: 'dB' }
        }).grid();
        const cols = [T.signal, T.reflect];
        C.forEach((c, j) => P2.trace(c, cols[j], { width: 2, dash: j ? [5, 3] : null, id: 'dl-seg' + (j + 1),
          label: C.length > 1 ? (j ? 'after the retimer' : 'before the retimer') : 'whole path', unit: 'dB' }));
        const ctx = P2.ctx;
        let lastL = Infinity;                               // the left edge of the last label, drawn right to left
        R.ladder.forEach((x, k) => {
          const fx = x.f / 1e9, X = P2.X(fx), w = 7;
          ctx.save(); ctx.strokeStyle = T.ink; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(X - w, P2.Y(x.rate.budget)); ctx.lineTo(X + w, P2.Y(x.rate.budget)); ctx.stroke(); ctx.restore();
          const col = k < tried && k === settled && x.ok ? T.signal : k < tried && !x.ok ? T.alarm : T.muted;
          K.dot(ctx, X, P2.Y(x.worst), col, T.surface, 3.5);
          // name the faster rates, skipping any label that would run into its neighbour; the
          // name goes below the tick when the point is above it, so a failing rate's dot and
          // curve never strike through its own name
          const half = x.rate.id.length * 2.9 + 3, above = P2.Y(x.worst) >= P2.Y(x.rate.budget) - 4;
          if (fx >= 2.5 && X + half < lastL) {
            K.text(ctx, x.rate.id, X, P2.Y(x.rate.budget) + (above ? -8 : 9), T.muted, 9, 'center');
            lastL = X - half;
          }
        });
        P2.frame();
      }

      /* The ladder: each rate tried, highest first. */
      {
        const s = K.canvas($('[data-cv="ladder"]'), 150), ctx = s.ctx;
        ctx.clearRect(0, 0, s.w, s.h);
        // rows share the height the plot is given, so a taller plot spaces them out
        const n = R.ladder.length, top = 6, rowH = (s.h - top - 4) / Math.max(n, 1);
        // the names' column fits the longest name, then the longest lane rate
        const gbps = (x) => String(x.rate.gbps) + ' Gb/s';
        ctx.font = '11px ' + K.MONO;
        const nameW = Math.max(...R.ladder.map((x) => ctx.measureText(x.rate.id).width));
        ctx.font = '10px ' + K.MONO;
        const gbW = Math.max(...R.ladder.map((x) => ctx.measureText(gbps(x)).width));
        // dB at the bars' right end: 30, held still, and grown only when a loss would run off it
        const scale = K.stickyAxis(axes, 'ladder', 0, Math.max(30, ...R.ladder.map((x) => x.worst)), { head: 0 }).max;
        const L = 6 + nameW + 12 + gbW + 12, Rr = s.w - 92;
        const bar = Math.max(6, Math.min(12, rowH * 0.4));
        const bx = (db) => L + (Rr - L) * Math.min(1, db / scale);
        R.ladder.forEach((x, k) => {
          const y = top + k * rowH, mid = y + rowH / 2;
          const decided = k < tried, current = anim && k === tried;
          if (k === settled && decided && x.ok) { ctx.fillStyle = K.rgba(T.signal, 0.10); ctx.fillRect(0, y, s.w, rowH); }
          if (current) { ctx.fillStyle = K.rgba(T.ink, 0.06); ctx.fillRect(0, y, s.w, rowH); }
          const ink = k > settled ? T.muted : T.ink;
          K.text(ctx, x.rate.id, 6, mid, ink, 11, 'left');
          K.text(ctx, gbps(x), L - 12, mid, T.muted, 10, 'right');
          const show = decided || current || !anim;
          if (show && k <= settled) {
            ctx.fillStyle = K.rgba(x.ok ? T.signal : T.alarm, 0.75);
            ctx.fillRect(L, mid - bar / 2, bx(x.worst) - L, bar);
          }
          ctx.save(); ctx.strokeStyle = T.ink; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(bx(x.rate.budget), mid - bar / 2 - 3); ctx.lineTo(bx(x.rate.budget), mid + bar / 2 + 3); ctx.stroke(); ctx.restore();
          const word = current ? 'trying…' : !decided ? '' : k > settled ? 'not tried' : x.ok ? 'trains' : 'too lossy';
          const wc = word === 'trains' ? T.signal : word === 'too lossy' ? T.alarm : T.muted;
          K.text(ctx, word, s.w - 6, mid, wc, 11, 'right');
        });
      }

      const set = (k, v) => { const e = $('[data-out="' + k + '"]'); if (e) e.textContent = v; };
      const done = !anim;
      const tr = R.trained;
      set('rate', done ? (tr ? tr.rate.id : 'no link') : 'training…');
      set('pay', done && tr ? R.payload.toFixed(2) + ' Gb/s' : '—');
      const m = $('[data-out="margin"]');
      m.textContent = done && tr ? (tr.margin >= 0 ? '+' : '') + tr.margin.toFixed(1) + ' dB' : '—';
      m.style.color = done && tr && tr.margin < 1 ? 'var(--alarm-text)' : 'var(--ink)';
      set('video', done && tr ? Math.floor(D.maxRefresh(R.payload, 3840, 2160, 30)) + ' Hz' : '—');

      $('#dl-cap').value = String(p.cap);
      if ($('#dl-lanes')) $('#dl-lanes').value = String(p.lanes);
      $('#dl-src').value = p.srcIn; $('#dl-src-out').value = p.srcIn + ' in';
      $('#dl-sink').value = p.sinkIn; $('#dl-sink-out').value = p.sinkIn + ' in';
      $('#dl-lam').value = p.lam;
      $('#dl-cable').value = p.cableM; $('#dl-cable-out').value = p.cableM.toFixed(1) + ' m';
      $('#dl-awg').value = String(p.awg);
      $('#dl-rt').value = p.retimer;
    }

    const mnt = K.mount({
      root, params: p, draw,
      tick(dt) {
        if (!anim) return false;
        anim.t += dt;
        if (anim.t >= anim.end) { anim = null; return false; }
        return true;
      }
    });
    const note = $('[data-out="note"]');
    const clear = () => {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      note.textContent = 'Custom';
    };
    const stopAnim = () => { if (anim) { anim = null; mnt.pause(); } };
    [['#dl-cap', 'cap'], ['#dl-lanes', 'lanes'], ['#dl-src', 'srcIn'], ['#dl-sink', 'sinkIn'], ['#dl-lam', 'lam'],
      ['#dl-cable', 'cableM'], ['#dl-awg', 'awg'], ['#dl-rt', 'retimer']].forEach(([id, k]) => {
      const el = $(id);
      if (!el) return;                                    // HDMI fixes the lanes per rate
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', (ev) => {
        const v = ev.target.value;
        p[k] = (k === 'lam' || k === 'retimer') ? v : +v;
        stopAnim(); clear(); mnt.render();
      });
    });
    root.querySelectorAll('.preset[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const q = PS[b.dataset.preset];
      if (!q) return;
      Object.keys(p).forEach((k) => { if (k in q) p[k] = q[k]; });
      root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      note.textContent = q.note;
      stopAnim(); mnt.render();
    }));
    // Walk the ladder from the top: one rung at a time, then settle.
    $('[data-act="train"]').addEventListener('click', () => {
      if (mnt.reduce) { anim = null; mnt.render(); return; }
      const R = D.train(cfgOf());
      const rungs = R.trained ? R.ladder.indexOf(R.trained) + 1 : R.ladder.length;
      mnt.pause();
      anim = { t: 0, end: rungs * ROW_MS + 1 };
      mnt.render(); mnt.play();
    });
    note.textContent = PS[first].note;
    const notes = Object.values(PS).map((q) => q.note).concat(['Custom']);
    const reserve = () => K.reserveText(note, notes);
    reserve();
    window.addEventListener('resize', reserve);
    const offRepaint = K.onRepaint(root, () => mnt.render());
    mnt.render();
    return { start() {}, stop() { stopAnim(); mnt.render(); }, destroy() { window.removeEventListener('resize', reserve); offRepaint(); mnt.teardown(); } };
  };
  NS.viz.displayLink.PRESETS = PRESETS;
})();
