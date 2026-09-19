/* SI & PI — viz/lpddr.js
 * Where an LPDDR5X write timing budget actually goes.
 *
 * Arithmetic, not simulation: a 117 ps unit interval at 8533 MT/s, minus each
 * contributor, is what is left for the receiver mask. Every term is a control,
 * so the reader can find out which one they should actually be arguing about.
 *
 * Requires js/viz-kit.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;

  const TERMS = [
    { key: 'tdqs',  label: 'tDQS2DQ (inside the DRAM)',  colour: 'reflect', note: 'varies with V and T — training chases it' },
    { key: 'xtalk', label: 'crosstalk',                   colour: 'alarm',   note: 'x16 in a dense escape' },
    { key: 'ssn',   label: 'SSN / reference shift',       colour: 'alarm',   note: 'all sixteen switching at once' },
    { key: 'isi',   label: 'ISI and reflections',         colour: 'muted',   note: 'package, vias, any stub' },
    { key: 'skew',  label: 'routing skew',                colour: 'muted',   note: 'the part layout controls' },
    { key: 'jit',   label: 'clock jitter',                colour: 'signal',  note: 'WCK path and PLL' }
  ];

  NS.viz.lpddrBudget = function (root) {
    const $ = (s) => root.querySelector(s);
    const cv = $('[data-cv="budget"]');
    /* Discrete speed bins, not a continuous range. The slider was min 3200 /
       step 133, so 8533 was not on the grid at all — the nearest step is 8520,
       and the panel displayed 8533 while computing 8520. A rate is a bin, so the
       control should offer bins. */
    const BINS = [3200, 4266, 5500, 6400, 7500, 8533];
    const binOf = (r) => { let b = 0; BINS.forEach((v, i) => { if (Math.abs(v - r) < Math.abs(BINS[b] - r)) b = i; }); return b; };

    const p = { rate: 8533, tdqs: 18, xtalk: 14, ssn: 12, isi: 16, skew: 6, jit: 9, trained: 1 };

    const PRESETS = {
      typ:   { rate: 8533, tdqs: 18, xtalk: 14, ssn: 12, isi: 16, skew: 6, jit: 9, trained: 1,
        note: 'A trained LPDDR5X channel at 8533 MT/s. Training has centred the strobe, so tDQS2DQ mostly disappears.' },
      untr:  { rate: 8533, tdqs: 18, xtalk: 14, ssn: 12, isi: 16, skew: 6, jit: 9, trained: 0,
        note: 'The same channel without training. tDQS2DQ alone eats most of what was left — which is why the interface is designed to be measured at runtime.' },
      hot:   { rate: 8533, tdqs: 26, xtalk: 14, ssn: 12, isi: 16, skew: 6, jit: 9, trained: 1,
        note: 'At the hot corner the DRAM internal skew grows. This is what periodic retraining is for.' },
      dense: { rate: 8533, tdqs: 18, xtalk: 24, ssn: 20, isi: 16, skew: 6, jit: 9, trained: 1,
        note: 'A congested escape: more crosstalk and more SSN together. Any two of these is usually fine; all three is not.' },
      slow:  { rate: 6400, tdqs: 18, xtalk: 14, ssn: 12, isi: 16, skew: 6, jit: 9, trained: 1,
        note: 'Back off to LPDDR5 at 6400 MT/s and the UI grows to 156 ps. The impairments have not changed — the budget has.' }
    };

    function ui() { return 1e6 / p.rate; }                    // ps
    function spend() {
      return TERMS.map((t) => {
        let v = p[t.key];
        if (t.key === 'tdqs' && p.trained) v *= 0.25;         // training removes most of it
        return { ...t, v };
      });
    }

    function draw(T) {
      const s = K.canvas(cv, 128);
      const { ctx, w } = s;
      const L = 20, R = w - 20, U = ui();
      const items = spend();
      const used = items.reduce((a, x) => a + x.v, 0);
      const left = U - used;
      const X = (ps) => L + (ps / U) * (R - L);

      // the UI, as one bar
      ctx.save();
      ctx.strokeStyle = T.border; ctx.lineWidth = 1;
      ctx.strokeRect(L, 44, R - L, 46);
      ctx.restore();
      let x = L;
      for (const it of items) {
        const wpx = (it.v / U) * (R - L);
        ctx.save();
        ctx.fillStyle = K.rgba(T[it.colour] || T.muted, 0.72);
        ctx.fillRect(x, 44, wpx, 46);
        ctx.strokeStyle = T.surface; ctx.lineWidth = 1.5;
        ctx.strokeRect(x, 44, wpx, 46);
        ctx.restore();
        if (wpx > 26) K.text(ctx, it.v.toFixed(0), x + wpx / 2, 67, T.ink, 10, 'center');
        x += wpx;
      }
      if (left > 0) {
        ctx.save();
        ctx.fillStyle = K.rgba(T.signal, 0.20);
        ctx.fillRect(x, 44, X(U) - x, 46);
        ctx.restore();
        /* Shorten when the remaining bar cannot hold the full phrase — canvas text
           does not wrap, so the alternative is a word cut in half. */
        const room = X(U) - x;
        const label = room > 190 ? left.toFixed(0) + ' ps left for the mask'
                    : room > 80  ? left.toFixed(0) + ' ps left'
                    : left.toFixed(0);
        K.text(ctx, label, (x + X(U)) / 2, 67,
               T.signal, 10, 'center');
      } else {
        ctx.save(); ctx.fillStyle = K.rgba(T.alarm, 0.30); ctx.fillRect(L, 44, R - L, 46); ctx.restore();
        K.text(ctx, 'OVER BUDGET by ' + (-left).toFixed(0) + ' ps', (L + R) / 2, 67, T.alarm, 12, 'center');
      }
      K.text(ctx, 'one UI = ' + U.toFixed(0) + ' ps at ' + p.rate + ' MT/s', L, 32, T.ink2, 11, 'left');
      K.text(ctx, '0', L, 102, T.muted, 10, 'center');
      K.text(ctx, U.toFixed(0) + ' ps', R, 102, T.muted, 10, 'center');

      /* The legend is HTML, not canvas text. Painted at a fixed x it was simply
         cut off at 390 px — "varies…", "packag…", "x16 i…" — and a screen reader
         never saw it at all. As a <dl> it reflows, reads and copies. */
      K.summary(root, items.map((it) => ({
        label: it.label, value: it.v.toFixed(0) + ' ps', note: it.note, colour: it.colour,
      })).concat([{ label: 'left for the receiver mask',
                    value: left.toFixed(0) + ' ps',
                    note: left <= 0 ? 'over budget' : (100 * left / U).toFixed(0) + '% of the UI' }]),
      { label: 'Where the unit interval goes' });

      $('[data-out="ui"]').textContent = U.toFixed(0) + ' ps';
      const e = $('[data-out="left"]');
      e.textContent = left.toFixed(0) + ' ps';
      e.style.color = left <= 0 ? 'var(--alarm-text)' : left < U * 0.2 ? 'var(--reflect)' : 'var(--ink)';
      $('[data-out="pct"]').textContent = (100 * left / U).toFixed(0) + '% of UI';
      $('[data-out="worst"]').textContent = items.reduce((a, b) => a.v > b.v ? a : b).label.split(' ')[0];
      for (const t of TERMS) {
        $('#lp-' + t.key).value = p[t.key];
        $('#lp-' + t.key + '-out').value = p[t.key] + ' ps';
      }
      $('#lp-rate').value = binOf(p.rate);
      $('#lp-rate-out').value = p.rate + ' MT/s';
      $('#lp-train').checked = !!p.trained;
    }

    const m = K.mount({ root, params: p, draw });
    const clear = () => {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      $('[data-out="note"]').textContent = 'Custom';
    };
    for (const t of TERMS) {
      $('#lp-' + t.key).addEventListener('input', (e) => { p[t.key] = +e.target.value; clear(); m.render(); });
    }
    $('#lp-rate').addEventListener('input', (e) => { p.rate = BINS[+e.target.value]; clear(); m.render(); });
    $('#lp-train').addEventListener('change', (e) => { p.trained = e.target.checked ? 1 : 0; clear(); m.render(); });
    root.querySelectorAll('.preset[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const q = PRESETS[b.dataset.preset];
      /* A `.preset` without a data-preset is not a preset — the sweep button
         on Lab B is one. Reading straight from the table threw on it. */
      if (!q) return;
      Object.assign(p, q);
      root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      $('[data-out="note"]').textContent = q.note;
      m.render();
    }));
    root.querySelector('.preset[data-preset="typ"]').setAttribute('aria-pressed', 'true');
    $('[data-out="note"]').textContent = PRESETS.typ.note;
    m.render();
    return { start() {}, stop() {}, destroy() { m.teardown(); } };
  };
})();
