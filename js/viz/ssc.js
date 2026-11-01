/* SI & PI — viz/ssc.js
 * The clock is never still, and the receiver has to keep up. USB's down-spread
 * moves the data by a hundred or more unit intervals every SSC cycle; the
 * receiver's clock recovery follows it, and what it fails to follow lands on the
 * eye. The panel draws the data's phase and the recovered clock's, the residual
 * between them, and the loop's transfer with the sweep's harmonics marked.
 *
 * All the arithmetic is in js/models/ssc-model.js and K.cdrLoop; this draws it.
 *
 * Requires js/viz-kit.js and js/models/ssc-model.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;

  const FNS = [0.05, 0.1, 0.2, 0.3, 0.5, 1, 2, 3, 4.9, 7.5, 10, 20];   // MHz
  const PRESETS = {
    none: { gen: 1, shape: 'tri', depth: 0, fm: 30, fi: 8, zeta: 0.7,
      note: 'No spread: a fixed clock, as a bench without SSC would give. Nothing moves and the CDR has nothing to follow.' },
    healthy: { gen: 2, shape: 'tri', depth: 5000, fm: 33, fi: 9, zeta: 0.7,
      note: 'Full down-spread at Gen 2, a loop near the 7.5 MHz tolerance corner. The data moves 189 UI; the clock follows to well under a picosecond.' },
    slow: { gen: 2, shape: 'tri', depth: 5000, fm: 33, fi: 3, zeta: 0.7,
      note: 'The same sweep with a 300 kHz loop. It lags each ramp by about one UI, and the eye pays for it before any other jitter.' },
    ringing: { gen: 2, shape: 'tri', depth: 5000, fm: 33, fi: 5, zeta: 0.15,
      note: 'An underdamped 1 MHz loop. At each corner of the triangle it overshoots and rings, doubling what a damped loop leaves.' },
    steep: { gen: 2, shape: 'fast', depth: 5000, fm: 33, fi: 5, zeta: 0.7,
      note: 'A legal profile that ramps at the 1250 ppm/µs limit and holds. Same depth, same rate; four times the slope, nearly four times the lag.' }
  };

  /* Ticks on a round step: 1, 2, 2.5 or 5 times a power of ten, at most six of them. */
  function ticks(lo, hi) {
    const span = hi - lo, e = Math.pow(10, Math.floor(Math.log10(span / 6)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * e).find((q) => span / q <= 6);
    const out = []; for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(+v.toPrecision(10));
    return out;
  }
  const tfmt = (v) => String(+v.toPrecision(4));

  NS.viz.ssc = function (root) {
    const S = NS.models.ssc;
    const $ = (s) => root.querySelector(s);
    const axes = K.axisMemo(root);
    const p = Object.assign({}, PRESETS.healthy);
    delete p.note;
    const cfgOf = () => ({ gen: p.gen, shape: p.shape, depth: p.depth, fm: p.fm * 1e3, fn: FNS[p.fi] * 1e6, zeta: p.zeta });

    function draw(T) {
      const cfg = cfgOf(), A = S.analyse(cfg), N = S.N, Tus = 1e3 / p.fm, ui = A.G.ui;
      const at = (arr, k) => arr[k % N];

      /* The data's phase and the recovered clock's, over two SSC cycles, in UI. */
      {
        const s = K.canvas($('[data-cv="phase"]'), 140);
        const top = Math.max(A.xpp / ui / 2, 1);
        const yr = K.stickyAxis(axes, 'x', -top, top, { head: 0.1 });
        const P = K.plot(s, T, {
          pad: { l: 46, r: 14, t: 14, b: 30 },
          x: { min: 0, max: 2 * Tus, ticks: ticks(0, 2 * Tus), fmt: tfmt, title: 'µs' },
          y: { min: yr.min, max: yr.max, ticks: ticks(yr.min, yr.max), fmt: tfmt, title: 'UI' }
        }).grid();
        const n = 2 * N / 8;
        P.trace((k) => [k * 8 / N * Tus, at(A.x, k * 8) / ui], T.signal, { n, width: 2, id: 'ssc-x', label: 'data', unit: 'UI' });
        P.trace((k) => [k * 8 / N * Tus, (at(A.x, k * 8) - at(A.r, k * 8)) / ui], T.reflect, { n, width: 1.6, dash: [5, 4], id: 'ssc-rec', label: 'recovered clock', unit: 'UI' });
        P.frame();
      }

      /* What the loop leaves, in picoseconds. */
      {
        const s = K.canvas($('[data-cv="resid"]'), 124);
        const m = Math.max(...Array.from(A.r, Math.abs)) * 1e12;
        const yr = K.stickyAxis(axes, 'r', -Math.max(m, 0.1), Math.max(m, 0.1), { head: 0.12 });
        const P = K.plot(s, T, {
          pad: { l: 46, r: 12, t: 14, b: 30 },
          x: { min: 0, max: 2 * Tus, ticks: ticks(0, 2 * Tus), fmt: tfmt, title: 'µs' },
          y: { min: yr.min, max: yr.max, ticks: ticks(yr.min, yr.max), fmt: tfmt, title: 'ps' }
        }).grid();
        P.trace((k) => [k * 4 / N * Tus, at(A.r, k * 4) * 1e12], T.reflect, { n: N / 2, width: 1.8, id: 'ssc-r', label: 'tracking error', unit: 'ps' });
        P.frame();
      }

      /* The loop: what it passes and what it leaves, with the sweep's harmonics. */
      {
        const s = K.canvas($('[data-cv="tf"]'), 124);
        const P = K.plot(s, T, {
          pad: { l: 42, r: 12, t: 14, b: 30 },
          x: { min: 3, max: 8, ticks: [3, 4, 5, 6, 7, 8], fmt: (v) => ({ 3: '1k', 4: '10k', 5: '100k', 6: '1M', 7: '10M', 8: '100M' })[v], title: 'Hz' },
          y: { min: -80, max: 10, ticks: [-80, -60, -40, -20, 0], fmt: (v) => String(v), title: 'dB' }
        }).grid();
        const M = 160, lf = (k) => 3 + 5 * k / (M - 1), db = (v) => Math.max(-80, 20 * Math.log10(Math.max(v, 1e-9)));
        P.trace((k) => [lf(k), db(K.cdrLoop(Math.pow(10, lf(k)), cfg.fn, cfg.zeta).h)], T.signal, { n: M, width: 2, id: 'ssc-h', label: 'H, data to clock', unit: 'dB' });
        P.trace((k) => [lf(k), db(K.cdrLoop(Math.pow(10, lf(k)), cfg.fn, cfg.zeta).e)], T.reflect, { n: M, width: 2, id: 'ssc-e', label: '1 − H, left behind', unit: 'dB' });
        if (cfg.depth > 0) for (const h of [1, 3, 5, 7]) {
          const f = h * cfg.fm, L = K.cdrLoop(f, cfg.fn, cfg.zeta);
          K.dot(P.ctx, P.X(Math.log10(f)), P.Y(db(L.e)), T.reflect, T.surface, h === 1 ? 3.5 : 2.5);
        }
        P.vline(Math.log10(cfg.fn), T.muted, [3, 4]);
        P.frame();
      }

      const set = (k, v) => { const e = $('[data-out="' + k + '"]'); if (e) e.textContent = v; };
      set('moves', (A.xpp / ui).toFixed(0) + ' UI');
      set('slew', A.slew.toFixed(0) + ' ppm/µs');
      const rp = A.rpp * 1e12;
      set('resid', (rp < 1 ? rp.toFixed(2) : rp < 10 ? rp.toFixed(1) : rp.toFixed(0)) + ' ps');
      const share = A.rpp / ui;
      const e = $('[data-out="share"]');
      e.textContent = (share < 0.01 ? (share * 100).toFixed(2) : share < 1 ? (share * 100).toFixed(1) : (share * 100).toFixed(0)) + '%';
      e.style.color = share > 0.3 ? 'var(--alarm-text)' : 'var(--ink)';

      $('#ssc-gen').value = String(p.gen);
      $('#ssc-shape').value = p.shape;
      $('#ssc-depth').value = p.depth; $('#ssc-depth-out').value = p.depth + ' ppm';
      $('#ssc-fm').value = p.fm; $('#ssc-fm-out').value = p.fm + ' kHz';
      $('#ssc-fn').value = p.fi; $('#ssc-fn-out').value = (FNS[p.fi] < 1 ? FNS[p.fi] * 1000 + ' kHz' : FNS[p.fi] + ' MHz');
      $('#ssc-zeta').value = p.zeta; $('#ssc-zeta-out').value = p.zeta.toFixed(2);
    }

    const mnt = K.mount({ root, params: p, draw });
    const note = $('[data-out="note"]');
    const clear = () => {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      note.textContent = 'Custom';
    };
    [['#ssc-gen', 'gen', true], ['#ssc-shape', 'shape', false], ['#ssc-depth', 'depth', true], ['#ssc-fm', 'fm', true], ['#ssc-fn', 'fi', true], ['#ssc-zeta', 'zeta', true]].forEach(([id, k, num]) => {
      const el = $(id);
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', (ev) => { p[k] = num ? +ev.target.value : ev.target.value; clear(); mnt.render(); });
    });
    root.querySelectorAll('.preset[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const q = PRESETS[b.dataset.preset];
      if (!q) return;
      Object.keys(p).forEach((k) => { if (k in q) p[k] = q[k]; });
      root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      note.textContent = q.note;
      mnt.render();
    }));
    root.querySelector('.preset[data-preset="healthy"]').setAttribute('aria-pressed', 'true');
    note.textContent = PRESETS.healthy.note;
    const notes = Object.values(PRESETS).map((q) => q.note).concat(['Custom']);
    const reserve = () => K.reserveText(note, notes);
    reserve();
    window.addEventListener('resize', reserve);
    const offRepaint = K.onRepaint(root, () => mnt.render());
    mnt.render();
    return { start() {}, stop() {}, destroy() { window.removeEventListener('resize', reserve); offRepaint(); mnt.teardown(); } };
  };
  NS.viz.ssc.PRESETS = PRESETS;
  NS.viz.ssc.FNS = FNS;
})();
