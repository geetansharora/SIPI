/* SI & PI — viz/diffpair.js
 * Where the common mode comes from. Two legs of a pair, each a little different
 * from the other in one of the four ways the page names, and what that difference
 * turns into: a common-mode voltage at every edge, a differential-to-common
 * conversion that climbs with frequency, and an eye that only starts to notice
 * long after the emissions scan has.
 *
 * All the arithmetic is in js/models/diffpair-model.js; this draws it.
 *
 * Requires js/viz-kit.js and js/models/diffpair-model.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;

  const RATES = [1, 2.5, 5, 8, 10, 16, 25, 32];                    // Gb/s
  const EDGES = [10, 15, 20, 30, 40, 50, 75, 100];                 // ps, 10-90%
  const DDKS = [0, 0.02, 0.05, 0.1, 0.2, 0.3];                     // Dk difference between the legs
  const SHOW = 12;                                                 // bits on the time chart

  const PRESETS = {
    balanced: { ri: 4, ti: 3, skew: 0, len: 10, ki: 0, imb: 0, slow: 0,
      note: 'Two identical legs at 10 Gb/s. The common mode is a flat zero and SCD21 is not on the chart at all: nothing converts.' },
    skew5: { ri: 4, ti: 3, skew: 5, len: 10, ki: 0, imb: 0, slow: 0,
      note: '5 ps of length mismatch, a twentieth of a bit. The eye does not notice; the common mode spikes at every edge.' },
    halfUI: { ri: 4, ti: 3, skew: 50, len: 10, ki: 0, imb: 0, slow: 0,
      note: 'Half a bit of skew: at Nyquist SDD21 is 3 dB down and SCD21 as large as it. The eye keeps its height, loses a fifth of its width.' },
    weave: { ri: 4, ti: 3, skew: 0, len: 10, ki: 2, imb: 0, slow: 0,
      note: 'Lengths matched exactly, but one leg sees Dk 0.05 higher over 10 in: about 1 ps an inch of skew that no serpentine fixes.' },
    imb: { ri: 4, ti: 3, skew: 0, len: 10, ki: 0, imb: 10, slow: 0,
      note: 'One leg drives 10% harder. The common mode is a copy of the data at a twentieth of its size, at every frequency alike.' },
    slow: { ri: 4, ti: 3, skew: 0, len: 10, ki: 0, imb: 0, slow: 30,
      note: 'The N leg’s edge is 30% slower. Common mode appears only while the edges move, so it lives at high frequency.' }
  };

  NS.viz.diffPair = function (root) {
    const DP = NS.models.diffpair;
    const $ = (s) => root.querySelector(s);
    const p = Object.assign({}, PRESETS.balanced);
    delete p.note;
    const cfgOf = () => ({ rate: RATES[p.ri], tr: EDGES[p.ti], skew: p.skew, len: p.len, dDk: DDKS[p.ki], imb: p.imb, slow: p.slow });

    function draw(T) {
      const cfg = cfgOf(), A = DP.analyse(cfg), W = A.W, ui = W.ui, spb = DP.SPB;
      const vmax = DP.SWING * 1.1;          // the differential swing is ±SWING, each leg ±SWING/2

      /* Time: each leg thin, the difference and the common mode in the two series colours. */
      {
        const s = K.canvas($('[data-cv="time"]'), 156);
        const first = 20, i0 = first * spb + A.eye.offset, i1 = i0 + SHOW * spb;
        const P = K.plot(s, T, {
          pad: { l: 46, r: 16, t: 14, b: 30 },
          x: { min: 0, max: SHOW, ticks: [0, 2, 4, 6, 8, 10, 12], fmt: (v) => String(v), title: 'time, bits' },
          y: { min: -vmax, max: vmax, ticks: [-0.4, -0.2, 0, 0.2, 0.4], fmt: (v) => String(v), title: 'volts' }
        }).grid();
        const series = (arr) => (k) => [k / spb, arr[(i0 + k) % arr.length]];
        const n = i1 - i0 + 1;
        P.trace(series(W.P), T.muted, { n, width: 1, id: 'dp-p', label: 'P leg', unit: 'V' });
        P.trace(series(W.N), T.muted, { n, width: 1, dash: [3, 3], id: 'dp-n', label: 'N leg', unit: 'V' });
        P.trace(series(W.D), T.signal, { n, width: 2, id: 'dp-d', label: 'differential', unit: 'V' });
        P.trace(series(W.Cm), T.reflect, { n, width: 2, id: 'dp-cm', label: 'common mode', unit: 'V' });
        P.frame();
      }

      /* Frequency: what the pair passes as differential, and what it converts to common mode. */
      const fN = cfg.rate / 2, fMax = 2 * cfg.rate;
      {
        const s = K.canvas($('[data-cv="freq"]'), 132);
        const P = K.plot(s, T, {
          pad: { l: 42, r: 12, t: 14, b: 30 },
          x: { min: 0, max: fMax, ticks: [0, fN, cfg.rate, 1.5 * cfg.rate, fMax], fmt: (v) => String(+v.toFixed(1)), title: 'GHz' },
          y: { min: -40, max: 2, ticks: [-40, -30, -20, -10, 0], fmt: (v) => String(v), title: 'dB' }
        }).grid();
        const db = (x) => (x > 1e-6 ? 20 * Math.log10(x) : -120);
        const N = 240, f = (k) => (k + 0.5) * fMax / N;
        P.trace((k) => [f(k), db(DP.mixed(W.L, f(k)).sdd)], T.signal, { n: N, width: 2, id: 'dp-sdd', label: 'SDD21', unit: 'dB' });
        P.trace((k) => [f(k), db(DP.mixed(W.L, f(k)).scd)], T.reflect, { n: N, width: 2, id: 'dp-scd', label: 'SCD21', unit: 'dB' });
        P.vline(fN, T.muted, [3, 4]);
        // at the foot of the line: SDD21 runs along the top at Nyquist and would strike through it
        K.text(P.ctx, 'Nyquist', P.X(fN) + 4, P.box.B - 8, T.muted, 10, 'left');
        if (A.skew > 0 && 1000 / (2 * A.skew) <= fMax) {
          const fz = 1000 / (2 * A.skew);
          K.dot(P.ctx, P.X(fz), P.Y(-40), T.signal, T.surface, 3.5);
          K.text(P.ctx, '1/(2·skew)', Math.min(P.X(fz) + 4, P.box.R - 60), P.Y(-40) - 10, T.signal, 10, 'left');
        }
        P.frame();
      }

      /* Eye: two UI of the differential voltage per bit, folded, with the receiver's ±10% band. */
      {
        const s = K.canvas($('[data-cv="eye"]'), 132);
        const P = K.plot(s, T, {
          pad: { l: 42, r: 12, t: 14, b: 30 },
          x: { min: 0, max: 2, ticks: [0, 0.5, 1, 1.5, 2], fmt: (v) => String(v), title: 'UI' },
          y: { min: -vmax, max: vmax, ticks: [-0.4, 0, 0.4], fmt: (v) => String(v), title: 'V diff' }
        }).grid();
        const ctx = P.ctx, len = W.D.length, band = DP.THRESH * 2 * DP.SWING;
        ctx.save(); ctx.fillStyle = K.rgba(T.alarm, 0.07);
        ctx.fillRect(P.box.L, P.Y(band), P.box.R - P.box.L, P.Y(-band) - P.Y(band)); ctx.restore();
        ctx.save();
        ctx.beginPath(); ctx.rect(P.box.L, P.box.TP, P.box.R - P.box.L, P.box.B - P.box.TP); ctx.clip();
        ctx.strokeStyle = K.rgba(T.signal, 0.35); ctx.lineWidth = 1;
        for (let b = 0; b < W.bits.length; b++) {
          ctx.beginPath();
          const start = b * spb + A.eye.offset - spb / 2;
          for (let k = 0; k <= 2 * spb; k++) {
            const v = W.D[((start + k) % len + len) % len], x = P.X(k / spb), y = P.Y(v);
            k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          }
          ctx.stroke();
        }
        ctx.restore();
        P.frame();
        // a folded eye is many strokes, not a trace the cursor could read
        delete $('[data-cv="eye"]').__plot;
      }

      const set = (k, v) => { const e = $('[data-out="' + k + '"]'); if (e) e.textContent = v; };
      const dB = (x) => (x > 1e-6 ? (20 * Math.log10(x)).toFixed(1) + ' dB' : 'none');
      set('skew', A.skew.toFixed(1) + ' ps');
      set('cm', Math.round(A.cmPk * 1000) + ' mV');
      set('scd', dB(A.atNyq.scd));
      set('emi', isFinite(A.emission) ? (A.emission > 0 ? '+' : '') + A.emission.toFixed(0) + ' dB' : 'none');
      set('eye', Math.round(A.eye.width * 100) + '% wide');

      $('#dp-rate').value = p.ri; $('#dp-rate-out').value = RATES[p.ri] + ' Gb/s';
      $('#dp-tr').value = p.ti; $('#dp-tr-out').value = EDGES[p.ti] + ' ps';
      $('#dp-skew').value = p.skew; $('#dp-skew-out').value = p.skew + ' ps';
      $('#dp-len').value = p.len; $('#dp-len-out').value = p.len + ' in';
      $('#dp-dk').value = p.ki; $('#dp-dk-out').value = DDKS[p.ki] ? '+' + DDKS[p.ki] : 'none';
      $('#dp-imb').value = p.imb; $('#dp-imb-out').value = p.imb + '%';
      $('#dp-slow').value = p.slow; $('#dp-slow-out').value = p.slow ? p.slow + '% slower' : 'same';
    }

    const mnt = K.mount({ root, params: p, draw });
    const clear = () => {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      $('[data-out="note"]').textContent = 'Custom';
    };
    [['#dp-rate', 'ri'], ['#dp-tr', 'ti'], ['#dp-skew', 'skew'], ['#dp-len', 'len'], ['#dp-dk', 'ki'], ['#dp-imb', 'imb'], ['#dp-slow', 'slow']].forEach(([id, k]) =>
      $(id).addEventListener('input', (e) => { p[k] = +e.target.value; clear(); mnt.render(); }));
    root.querySelectorAll('.preset[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const q = PRESETS[b.dataset.preset];
      if (!q) return;
      Object.keys(p).forEach((k) => { if (k in q) p[k] = q[k]; });
      root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      $('[data-out="note"]').textContent = q.note;
      mnt.render();
    }));
    root.querySelector('.preset[data-preset="balanced"]').setAttribute('aria-pressed', 'true');
    $('[data-out="note"]').textContent = PRESETS.balanced.note;
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
  NS.viz.diffPair.PRESETS = PRESETS;
  NS.viz.diffPair.GRID = { RATES, EDGES, DDKS };
})();
