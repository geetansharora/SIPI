/* SI & PI — viz/pcie-eq.js
 * Negotiated, not designed. A PCIe 4.0 or 5.0 channel built from TI's four
 * places the decibels go, with the board trace the reader's; a transmitter
 * preset from the page's table; the reference receiver's CTLE and DFE; and the
 * eye that results. "Run Phases 2–3" tries every fixed preset, each with the
 * receiver tuned to it, and keeps the best, which is what link equalisation does.
 *
 * All the arithmetic is in js/models/pcie-eq-model.js; this draws it.
 *
 * Requires js/viz-kit.js and js/models/pcie-eq-model.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;

  const PRESETS = {
    short4: { gen: 4, len: 4, dbIn: 1.2, preset: 4, ctle: 0, dfe: 1,
      note: 'A short desktop slot at Gen 4: a 4 in board on TI’s package, connector and card. No shaping is needed; P4 already wins.' },
    short5: { gen: 5, len: 4, dbIn: 1.2, preset: 4, ctle: 0, dfe: 1,
      note: 'The same board at Gen 5. Twice the rate meets more loss in every segment, and the eye is less than half of what it was.' },
    ti4: { gen: 4, len: 9, dbIn: 2.72, preset: 4, ctle: 0, dfe: 1,
      note: 'TI’s Gen 4 allocation, 28 dB at 8 GHz. Even unshaped, the worst case clears 15 mV; preshoot buys a few more.' },
    ti5: { gen: 5, len: 9, dbIn: 1.78, preset: 4, ctle: 0, dfe: 1,
      note: 'TI’s Gen 5 allocation, exactly 36 dB. Unshaped, the worst case misses 15 mV. Press Run Phases 2–3.' },
    over: { gen: 5, len: 15, dbIn: 1.78, preset: 7, ctle: 0, dfe: 1,
      note: 'About 11 dB over the Gen 5 budget. Every preset closes: negotiation picks the best of what there is, and it is not enough.' }
  };
  const NEG_NOTE = (w, ci) => 'Phases 2–3 on this channel: of the ten fixed presets, ' + w + ' gives the tallest eye, with the CTLE at ' + ci + '.';

  NS.viz.pcieEq = function (root) {
    const M = NS.models.pcieEq;
    const $ = (s) => root.querySelector(s);
    const axes = K.axisMemo(root);   // sticky ranges: inputs move the waveform, not the axis
    const p = Object.assign({}, PRESETS.ti5);
    delete p.note;
    const cfgOf = () => ({ gen: p.gen, len: p.len, dbIn: p.dbIn, preset: p.preset, ctle: p.ctle - 1, dfe: !!p.dfe });
    let last = null;

    function draw(T) {
      const cfg = cfgOf(), R = M.analyse(cfg), G = R.G, me = R.mine, S = R.sweep;
      last = R;
      const mV = (v) => v * 1000;

      /* The eye at the receiver: a stretch of data through the shaped pulse, the
         worst case any pattern can reach drawn as the inner contour, and TI's
         15 mV by 0.3 UI minimum as a box. */
      {
        const s = K.canvas($('[data-cv="eye"]'), 160);
        const tr = M.traces(me.q, me.s0, me.dfe, 160), Tn = tr.T;
        let top = 0;
        for (let b = tr.from; b < tr.bits.length - 1; b++)
          for (let k = -Tn / 2; k <= Tn / 2; k++) top = Math.max(top, Math.abs(tr.y[b * Tn + k] || 0));
        const yr = K.stickyAxis(axes, 'eye', -mV(top), mV(top), { head: 0.06 });
        // millivolt ticks on a round step, so the axis reads 0, 20, 40 rather than fifths of its span
        const vs = [5, 10, 20, 25, 50, 100, 200].find((q) => (yr.max - yr.min) / q <= 8) || 200;
        const yt = []; for (let v = Math.ceil(yr.min / vs) * vs; v <= yr.max + 1e-9; v += vs) yt.push(v);
        const P = K.plot(s, T, {
          pad: { l: 46, r: 14, t: 14, b: 30 },
          x: { min: -0.5, max: 0.5, ticks: [-0.5, -0.25, 0, 0.25, 0.5], fmt: (v) => (v === 0 ? '0' : v.toFixed(2)), title: 'UI' },
          y: { min: yr.min, max: yr.max, ticks: yt, fmt: (v) => String(v), title: 'mV diff' }
        }).grid();
        const ctx = P.ctx;
        ctx.save();
        ctx.beginPath(); ctx.rect(P.box.L, P.box.TP, P.box.R - P.box.L, P.box.B - P.box.TP); ctx.clip();
        ctx.strokeStyle = K.rgba(T.signal, 0.16); ctx.lineWidth = 1; ctx.lineJoin = 'round';
        for (let b = tr.from; b < tr.bits.length - 1; b++) {
          ctx.beginPath();
          for (let k = -Tn / 2; k <= Tn / 2; k++) {
            const x = P.X(k / Tn), y = P.Y(mV(tr.y[b * Tn + k]));
            k === -Tn / 2 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
        // the worst case: where the eye's inner edges sit for the worst pattern
        ctx.strokeStyle = T.alarm; ctx.lineWidth = 1.6;
        for (const sign of [1, -1]) {
          ctx.beginPath(); let on = false;
          for (let k = -Tn / 2; k <= Tn / 2; k++) {
            const h = me.profile[k + Tn];
            if (!(h > 0)) { on = false; continue; }
            const x = P.X(k / Tn), y = P.Y(sign * mV(h) / 2);
            on ? ctx.lineTo(x, y) : ctx.moveTo(x, y); on = true;
          }
          ctx.stroke();
        }
        ctx.restore();
        // TI's minimum, centred on the sampling point
        ctx.save(); ctx.setLineDash([4, 3]); ctx.strokeStyle = T.ink; ctx.lineWidth = 1;
        const bx0 = P.X(-M.TARGET.ew / 2), bx1 = P.X(M.TARGET.ew / 2), by0 = P.Y(mV(M.TARGET.eh) / 2), by1 = P.Y(-mV(M.TARGET.eh) / 2);
        ctx.strokeRect(bx0, by0, bx1 - bx0, by1 - by0); ctx.restore();
        K.text(ctx, 'P' + cfg.preset + ' · ' + (cfg.dfe ? 'CTLE + DFE' : 'CTLE only'), P.box.L + 6, P.box.TP + 8, T.muted, 10, 'left');
        P.frame();
        // folded strokes, not a trace the loader's cursor could read
        delete $('[data-cv="eye"]').__plot;
      }

      /* Insertion loss against frequency, with the generation's budget at Nyquist. */
      {
        const s = K.canvas($('[data-cv="il"]'), 128);
        const fMax = 1.25 * G.fN, N = 120;
        const yr = K.stickyAxis(axes, 'il', -Math.max(M.ilAt(R.seg.total, fMax, G.fN), G.budget), 0, { head: 0.06 });
        const P = K.plot(s, T, {
          pad: { l: 42, r: 12, t: 14, b: 30 },
          x: { min: 0, max: fMax, ticks: [0, G.fN / 2, G.fN, fMax].map((v) => +v.toFixed(1)), fmt: (v) => String(v), title: 'GHz' },
          y: { min: yr.min, max: 0, title: 'dB' }
        }).grid();
        P.trace((k) => { const f = (k / N) * fMax; return [f, -M.ilAt(R.seg.total, f, G.fN)]; }, T.signal, { n: N + 1, width: 2, id: 'pe-il', label: 'insertion loss', unit: 'dB' });
        P.vline(G.fN, T.muted, [3, 4]);
        P.hline(-G.budget, T.reflect, [4, 3]);
        K.text(P.ctx, G.budget + ' dB budget', P.box.L + 4, P.Y(-G.budget) - 7, T.reflect, 10, 'left');
        K.dot(P.ctx, P.X(G.fN), P.Y(-R.seg.total), R.seg.total > G.budget + 0.05 ? T.alarm : T.signal, T.surface, 3.5);
        // what the reader's board adds, beside TI's package, connector and card
        K.text(P.ctx, 'board ' + R.seg.board.toFixed(1) + ' dB', P.X(0.2 * fMax), P.box.TP + 8, T.muted, 10, 'left');
        P.frame();
      }

      /* Phases 2 and 3: every fixed preset with its own best CTLE. */
      {
        const s = K.canvas($('[data-cv="sweep"]'), 128);
        const hs = S.rows.map((r) => mV(r.height));
        const yr = K.stickyAxis(axes, 'sweep', Math.min(0, ...hs), Math.max(mV(M.TARGET.eh), ...hs), { head: 0.1 });
        const P = K.plot(s, T, {
          pad: { l: 42, r: 12, t: 14, b: 30 },
          x: { min: -0.5, max: 9.5, ticks: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], fmt: (v) => 'P' + v, title: 'Tx preset' },
          y: { min: yr.min, max: yr.max, title: 'mV' }
        }).grid();
        const ctx = P.ctx, w = (P.X(1) - P.X(0)) * 0.62;
        hs.forEach((h, i) => {
          const x = P.X(i) - w / 2, y0 = P.Y(0), y1 = P.Y(h);
          ctx.save();
          ctx.fillStyle = i === S.win ? T.signal : K.rgba(T.signal, 0.35);
          if (h < 0) ctx.fillStyle = K.rgba(T.alarm, i === S.win ? 0.8 : 0.35);
          ctx.fillRect(x, Math.min(y0, y1), w, Math.abs(y1 - y0));
          if (i === cfg.preset) { ctx.strokeStyle = T.ink; ctx.lineWidth = 1.5; ctx.strokeRect(x - 1.5, Math.min(y0, y1) - 1.5, w + 3, Math.abs(y1 - y0) + 3); }
          ctx.restore();
        });
        P.hline(mV(M.TARGET.eh), T.ink, [4, 3]);
        K.text(ctx, '15 mV', P.box.R - 2, P.Y(mV(M.TARGET.eh)) - 7, T.ink, 10, 'right');
        P.frame();
        delete $('[data-cv="sweep"]').__plot;
      }

      /* Readouts */
      const set = (k, v) => { const e = $('[data-out="' + k + '"]'); if (e) e.textContent = v; };
      set('loss', R.seg.total.toFixed(1) + ' of ' + G.budget + ' dB');
      const eh = $('[data-out="eh"]');
      eh.textContent = me.height > 0 ? Math.round(mV(me.height)) + ' mV' : 'closed';
      eh.style.color = me.height >= M.TARGET.eh ? 'var(--ink)' : 'var(--alarm-text)';
      set('ew', me.width > 0 ? me.width.toFixed(2) + ' UI' : '—');
      set('ctle', '−' + me.boost + ' dB');
      set('best', 'P' + S.win);

      $('#pe-gen').value = String(p.gen);
      $('#pe-preset').value = String(p.preset);
      $('#pe-len').value = p.len; $('#pe-len-out').value = p.len + ' in';
      $('#pe-db').value = p.dbIn; $('#pe-db-out').value = p.dbIn.toFixed(2) + ' dB/in';
      // the receiver's settings are the generation's: 7 at Gen 4, 11 at Gen 5
      const ctl = $('#pe-ctle');
      if (ctl.dataset.gen !== String(p.gen)) {
        ctl.innerHTML = '<option value="0">Best</option>'
          + G.ctle.map((b, i) => '<option value="' + (i + 1) + '">−' + b + ' dB</option>').join('');
        ctl.dataset.gen = String(p.gen);
      }
      ctl.value = String(p.ctle);
      $('#pe-dfe').value = p.dfe ? '1' : '0';
    }

    const mnt = K.mount({ root, params: p, draw });
    const note = $('[data-out="note"]');
    const clear = (txt) => {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      note.textContent = txt || 'Custom';
    };
    const fit = () => { p.ctle = Math.min(p.ctle, M.GENS[p.gen].ctle.length); };
    [['#pe-gen', 'gen'], ['#pe-preset', 'preset'], ['#pe-len', 'len'], ['#pe-db', 'dbIn'], ['#pe-ctle', 'ctle'], ['#pe-dfe', 'dfe']].forEach(([id, k]) => {
      const el = $(id);
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', (e) => { p[k] = +e.target.value; fit(); clear(); mnt.render(); });
    });
    root.querySelectorAll('.preset[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const q = PRESETS[b.dataset.preset];
      if (!q) return;
      Object.keys(p).forEach((k) => { if (k in q) p[k] = q[k]; });
      root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      note.textContent = q.note;
      mnt.render();
    }));
    // Phases 2–3: adopt the sweep's winner and let the receiver tune itself to it.
    $('[data-act="negotiate"]').addEventListener('click', () => {
      const S = last ? last.sweep : M.sweep(cfgOf());
      p.preset = S.win; p.ctle = 0;
      clear(NEG_NOTE('P' + S.win, '−' + S.rows[S.win].boost + ' dB'));
      mnt.render();
    });
    root.querySelector('.preset[data-preset="ti5"]').setAttribute('aria-pressed', 'true');
    note.textContent = PRESETS.ti5.note;
    // Room for the longest note, so pressing a preset changes the words, not the panel's height.
    const notes = Object.values(PRESETS).map((q) => q.note).concat(['Custom', NEG_NOTE('P7', '−15 dB')]);
    const reserve = () => K.reserveText(note, notes);
    reserve();
    window.addEventListener('resize', reserve);
    // A tab switch asks for pixels; without this the loader nudges the first control
    // and the panel drops its preset.
    const offRepaint = K.onRepaint(root, () => mnt.render());
    mnt.render();
    return { start() {}, stop() {}, destroy() { window.removeEventListener('resize', reserve); offRepaint(); mnt.teardown(); } };
  };
  NS.viz.pcieEq.PRESETS = PRESETS;
})();
