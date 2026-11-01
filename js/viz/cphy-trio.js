/* SI & PI — viz/cphy-trio.js
 * A trio, a symbol at a time. A 16-bit word becomes seven C-PHY symbols; each
 * symbol moves the trio to one of the five other wire states; three receivers
 * compare the wires in pairs; and the folded eye of those receivers shows the
 * crossings that make a C-PHY eye unlike a differential one.
 *
 * All the arithmetic is in js/models/cphy-model.js; this draws it.
 *
 * Requires js/viz-kit.js and js/models/cphy-model.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;

  const RATES = [1, 2, 2.5, 3.5, 4.5, 6];          // Gsps
  const PRESETS = {
    clean: { word: 'A5C3', ri: 2, tr: 40, skew: 0, loss: 0,
      note: 'One trio at 2.5 Gsps, matched wires, no loss. Every symbol moves the trio, and each receiver lands on ±1 or ±2: three levels, edges of two to four steps.' },
    fast: { word: 'A5C3', ri: 5, tr: 40, skew: 0, loss: 4,
      note: 'Six gigasymbols a second through 4 dB at Nyquist. The weak and strong edges cross zero at different times, so the eye has more than one crossing.' },
    skew: { word: 'A5C3', ri: 5, tr: 40, skew: 30, loss: 0,
      note: 'Wire C 30 ps late, a fifth of a symbol. In a pair, skew turns into common mode; in a trio it moves the receivers’ crossings apart and eats the eye’s width.' },
    lossy: { word: 'A5C3', ri: 5, tr: 40, skew: 0, loss: 10,
      note: 'Ten decibels at Nyquist with no equaliser. The weak ±1 level arrives last and lowest, and at this threshold the eye has shut.' },
    slow: { word: 'FFFF', ri: 4, tr: 100, skew: 0, loss: 0,
      note: 'A slow driver at 4.5 Gsps. Each edge takes 100 ps, nearly half a symbol, and the crossings smear across it.' }
  };

  NS.viz.cphyTrio = function (root) {
    const C = NS.models.cphy;
    const $ = (s) => root.querySelector(s);
    const p = Object.assign({}, PRESETS.clean);
    delete p.note;
    const SEQ = C.stream(36, 0x5eed);              // the eye's data: 36 random words
    const parseWord = () => {
      const v = parseInt(String(p.word).replace(/[^0-9a-f]/gi, '').slice(0, 4) || '0', 16);
      return isFinite(v) ? v & 0xffff : 0;
    };

    function draw(T) {
      const rate = RATES[p.ri], ui = 1000 / rate;
      const cfg = { tr: p.tr / ui, skew: p.skew / ui, loss: p.loss };
      const word = parseWord(), digits = C.encode(word);
      // the word's seven symbols, after two lead-in states so the edges have history
      const lead = [0, 2], seq = lead.concat(C.states(digits, lead[lead.length - 1]));
      const Wv = C.waves(seq.concat([seq[seq.length - 1]]), cfg);
      const E = C.eye(SEQ, cfg);
      const SPS = C.SPS, show = seq.length;

      /* The three wires over the word's symbols, with the state each symbol lands on. */
      {
        const s = K.canvas($('[data-cv="wires"]'), 136);
        const P = K.plot(s, T, {
          pad: { l: 40, r: 12, t: 22, b: 26 },
          x: { min: 0, max: show, ticks: [], title: '' },
          y: { min: -1.35, max: 1.35, ticks: [-1, 0, 1], fmt: (v) => ({ '-1': 'low', 0: 'mid', 1: 'high' })[v], title: '' }
        }).grid();
        const n = show * SPS;
        P.trace((k) => [k / SPS, Wv.W[0][k]], T.signal, { n, width: 2, id: 'cp-a', label: 'wire A', unit: 'level' });
        P.trace((k) => [k / SPS, Wv.W[1][k]], T.reflect, { n, width: 2, id: 'cp-b', label: 'wire B', unit: 'level' });
        P.trace((k) => [k / SPS, Wv.W[2][k]], T.muted, { n, width: 2, dash: [5, 3], id: 'cp-c', label: 'wire C', unit: 'level' });
        const ctx = P.ctx;
        for (let b = 0; b < show; b++) {
          if (b) P.vline(b, K.rgba(T.muted, 0.5), [2, 3]);
          const x = P.X(b + 0.5);
          K.text(ctx, C.STATES[seq[b]].name, x, P.box.TP - 9, b < lead.length ? T.muted : T.ink, 10, 'center');
          if (b >= lead.length) K.text(ctx, String(digits[b - lead.length]), x, P.box.B + 10, T.muted, 10, 'center');
        }
        K.text(ctx, 'symbol', P.box.L - 6, P.box.B + 10, T.muted, 10, 'right');
        P.frame();
      }

      /* The three receivers over the same symbols. */
      {
        const s = K.canvas($('[data-cv="rx"]'), 128);
        const P = K.plot(s, T, {
          pad: { l: 40, r: 12, t: 12, b: 30 },
          x: { min: 0, max: show, ticks: [], title: '' },
          y: { min: -2.4, max: 2.4, ticks: [-2, -1, 0, 1, 2], fmt: (v) => String(v), title: '' }
        }).grid();
        const n = show * SPS;
        P.trace((k) => [k / SPS, Wv.R[0][k]], T.signal, { n, width: 1.8, id: 'cp-ab', label: 'A − B', unit: 'steps' });
        P.trace((k) => [k / SPS, Wv.R[1][k]], T.reflect, { n, width: 1.8, id: 'cp-bc', label: 'B − C', unit: 'steps' });
        P.trace((k) => [k / SPS, Wv.R[2][k]], T.muted, { n, width: 1.8, dash: [5, 3], id: 'cp-ca', label: 'C − A', unit: 'steps' });
        for (let b = 1; b < show; b++) P.vline(b, K.rgba(T.muted, 0.5), [2, 3]);
        P.frame();
      }

      /* The eye: all three receivers folded over two symbols. */
      {
        const s = K.canvas($('[data-cv="eye"]'), 128);
        const P = K.plot(s, T, {
          pad: { l: 40, r: 12, t: 12, b: 30 },
          x: { min: 0, max: 2, ticks: [0, 0.5, 1, 1.5, 2], fmt: (v) => String(v), title: 'UI' },
          y: { min: -2.4, max: 2.4, ticks: [-2, -1, 0, 1, 2], fmt: (v) => String(v), title: '' }
        }).grid();
        const ctx = P.ctx, band = C.THRESH;
        ctx.save(); ctx.fillStyle = K.rgba(T.alarm, 0.08);
        ctx.fillRect(P.box.L, P.Y(band), P.box.R - P.box.L, P.Y(-band) - P.Y(band)); ctx.restore();
        ctx.save();
        ctx.beginPath(); ctx.rect(P.box.L, P.box.TP, P.box.R - P.box.L, P.box.B - P.box.TP); ctx.clip();
        const last = Math.floor(E.n / SPS) - 3;
        [T.signal, T.reflect, T.muted].forEach((col, j) => {
          ctx.strokeStyle = K.rgba(col, 0.22); ctx.lineWidth = 1;
          for (let b = 8; b < last; b++) {
            ctx.beginPath();
            for (let k = 0; k <= 2 * SPS; k++) {
              const v = E.R[j][b * SPS + k], x = P.X(k / SPS), y = P.Y(v);
              k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
            }
            ctx.stroke();
          }
        });
        ctx.restore();
        P.frame();
        delete $('[data-cv="eye"]').__plot;
      }

      const set = (k, v) => { const e = $('[data-out="' + k + '"]'); if (e) e.textContent = v; };
      set('syms', digits.join(' '));
      set('trio', (rate * 16 / 7).toFixed(1) + ' Gb/s');
      set('three', (3 * rate * 16 / 7).toFixed(1) + ' Gb/s');
      const ew = $('[data-out="ew"]');
      ew.textContent = Math.round(E.width * 100) + '% UI';
      ew.style.color = E.width < 0.3 ? 'var(--alarm-text)' : 'var(--ink)';

      const wi = $('#cp-word');
      if (document.activeElement !== wi) wi.value = word.toString(16).toUpperCase().padStart(4, '0');
      $('#cp-rate').value = p.ri; $('#cp-rate-out').value = rate + ' Gsps';
      $('#cp-tr').value = p.tr; $('#cp-tr-out').value = p.tr + ' ps';
      $('#cp-skew').value = p.skew; $('#cp-skew-out').value = p.skew + ' ps';
      $('#cp-loss').value = p.loss; $('#cp-loss-out').value = p.loss + ' dB';
    }

    const mnt = K.mount({ root, params: p, draw });
    const note = $('[data-out="note"]');
    const clear = () => {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      note.textContent = 'Custom';
    };
    [['#cp-rate', 'ri'], ['#cp-tr', 'tr'], ['#cp-skew', 'skew'], ['#cp-loss', 'loss']].forEach(([id, k]) =>
      $(id).addEventListener('input', (e) => { p[k] = +e.target.value; clear(); mnt.render(); }));
    // only hex digits reach the box: anything else is dropped as it is typed, and
    // leaving the box shows the word in use, padded to four digits
    $('#cp-word').addEventListener('input', (e) => {
      const el = e.target, raw = el.value, v = raw.replace(/[^0-9a-f]/gi, '').slice(0, 4);
      if (v !== raw) { const at = Math.max(0, (el.selectionStart || 0) - (raw.length - v.length)); el.value = v; el.setSelectionRange(at, at); }
      if (!v) return;
      p.word = v; clear(); mnt.render();
    });
    $('#cp-word').addEventListener('blur', (e) => { e.target.value = parseInt(p.word, 16).toString(16).toUpperCase().padStart(4, '0'); });
    // a word chosen at random, from a generator that moves on with each press
    let seed = 1;
    $('[data-act="random"]').addEventListener('click', () => {
      const r = K.rng(0x9e37 + seed++)();
      p.word = Math.floor(r * 65536).toString(16).toUpperCase().padStart(4, '0');
      clear(); mnt.render();
    });
    root.querySelectorAll('.preset[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const q = PRESETS[b.dataset.preset];
      if (!q) return;
      Object.keys(p).forEach((k) => { if (k in q) p[k] = q[k]; });
      root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      note.textContent = q.note;
      mnt.render();
    }));
    root.querySelector('.preset[data-preset="clean"]').setAttribute('aria-pressed', 'true');
    note.textContent = PRESETS.clean.note;
    const notes = Object.values(PRESETS).map((q) => q.note).concat(['Custom']);
    const reserve = () => K.reserveText(note, notes);
    reserve();
    window.addEventListener('resize', reserve);
    const offRepaint = K.onRepaint(root, () => mnt.render());
    mnt.render();
    return { start() {}, stop() {}, destroy() { window.removeEventListener('resize', reserve); offRepaint(); mnt.teardown(); } };
  };
  NS.viz.cphyTrio.PRESETS = PRESETS;
  NS.viz.cphyTrio.RATES = RATES;
})();
