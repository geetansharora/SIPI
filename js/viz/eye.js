/* SI & PI — viz/eye.js
 * An eye diagram assembling from real bits through a real lossy channel.
 *
 * Not a drawn eye shape. The pipeline is the same one a channel simulator runs:
 *
 *   1. |H(f)| from the two-term loss law the Loss page derives:
 *          loss(f) [dB] = A_c·√(f/f_N)  +  A_d·(f/f_N)
 *      conductor loss as √f, dielectric loss linear in f, normalised so the two
 *      sum to the loss the reader dials in at Nyquist.
 *   2. Minimum-phase reconstruction by real cepstrum, so the impulse response is
 *      CAUSAL. A magnitude-only channel with linear phase is not physical and it
 *      understates ISI — the asymmetric tail is most of the eye closure.
 *   3. PRBS from a maximal-length LFSR, shaped by a finite transmitter rise time.
 *   4. Linear convolution with h(t), then overlay one UI at a time.
 *
 * Eye height and width are measured from the resulting samples, not estimated:
 * height is the gap between the worst '1' and the worst '0' at the sampling
 * instant; width is the span between the latest early crossing and the earliest
 * late crossing of the decision threshold.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;
  const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';

  const SPS = 32;              // samples per unit interval
  const NFFT = 4096;           // 128 UI of channel memory
  const SWING = 0.8;           // V differential, peak to peak

  /* ---------- theme ---------- */
  let T = null;
  function readTheme(el) {
    const cs = getComputedStyle(el), g = (n) => cs.getPropertyValue(n).trim();
    T = { ink: g('--ink'), ink2: g('--ink-2'), muted: g('--muted'),
          signal: g('--signal'), reflect: g('--reflect'), alarm: g('--alarm'),
          grid: g('--grid'), border: g('--border'), surface: g('--surface') };
    return T;
  }
  function rgba(hex, a) {
    const h = hex.replace('#', '');
    return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16)
         + ',' + parseInt(h.slice(4, 6), 16) + ',' + a + ')';
  }

  /* FFT, channel impulse response and cursor now live in viz-kit.js —
     isi.js needs the same model and the project conventions forbid duplicating it. */
  const impulse = (lossDb) => K.channelImpulse(lossDb, SPS, NFFT);
  const findCursor = (h) => K.singleBit(h, SPS).cursor;

  /* ---------- transmit waveform ---------- */
  function lfsr(nBits, seed) {
    // x^15 + x^14 + 1 — maximal length, so runs and transitions are representative
    let s = seed || 0x4a1;
    const b = new Int8Array(nBits);
    for (let i = 0; i < nBits; i++) {
      const nxt = ((s >> 14) ^ (s >> 13)) & 1;
      s = ((s << 1) | nxt) & 0x7fff;
      b[i] = s & 1;
    }
    return b;
  }

  function transmit(bits, trUI) {
    const n = bits.length * SPS, x = new Float64Array(n);
    const tr = Math.max(1, trUI * SPS);
    for (let i = 0; i < n; i++) {
      const pos = i / SPS;
      const idx = Math.floor(pos);
      const prev = idx > 0 ? bits[idx - 1] : bits[0];
      const cur = bits[idx];
      // raised-cosine transition of width tr centred on the bit boundary
      const u = (i - idx * SPS) / tr;
      let a;
      if (u >= 1 || prev === cur) a = 1;
      else a = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));
      x[i] = (prev + (cur - prev) * a - 0.5) * SWING;
    }
    return x;
  }

  function convolve(x, h) {
    const n = x.length, m = h.length, y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      const kmax = Math.min(m, i + 1);
      for (let k = 0; k < kmax; k++) s += h[k] * x[i - k];
      y[i] = s;
    }
    return y;
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gaussians(n, seed) {
    const r = mulberry32(seed), out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
    }
    return out;
  }

  /* ---------- measurement ---------- */
  /* Height: the gap between the worst '1' and the worst '0' at the sampling
     instant. Width: how far either side of centre the threshold is still cleared
     by every bit. Both read off the actual samples. */
  function measure(y, bits, skip, cursorOff, jit, jitScale) {
    const off = (b) => Math.round(cursorOff + jit[b] * jitScale);
    let lo1 = Infinity, hi0 = -Infinity;
    for (let b = skip; b < bits.length - 2; b++) {
      const v = y[b * SPS + off(b)];
      if (bits[b]) { if (v < lo1) lo1 = v; } else if (v > hi0) hi0 = v;
    }
    const height = lo1 - hi0;
    let width = 0;
    for (let d = 0; d <= SPS / 2; d++) {
      let ok = true;
      for (let b = skip; b < bits.length - 2 && ok; b++) {
        for (const s of [-d, d]) {
          const v = y[b * SPS + off(b) + s];
          if (v === undefined) continue;
          if (bits[b] ? v <= 0 : v >= 0) { ok = false; break; }
        }
      }
      if (!ok) break;
      width = 2 * d / SPS;
    }
    return { height, width: Math.min(1, width) };
  }

  /* ---------- component ---------- */
  NS.viz.eye = function (root) {
    const $ = (s) => root.querySelector(s);
    const cv = $('[data-cv="eye"]');
    const btn = $('[data-act="play"]');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const NBITS = 900, SKIP = 40;
    const PRESETS = {
      clean:  { rate: 8,  loss: 3,  rj: 0.3, note: 'Short channel at 8 GT/s. Wide open — this is what margin looks like.' },
      typical:{ rate: 16, loss: 9,  rj: 0.5, note: 'Gen 4 across a short board channel, with no equalisation at all. Every real link adds a CTLE and a DFE on top of this.' },
      lossy:  { rate: 16, loss: 18, rj: 0.5, note: 'The same link over a longer channel. The traces have split into ISI bands — one band per pattern family.' },
      closed: { rate: 32, loss: 30, rj: 0.6, note: 'Gen 5 across the same channel. Closed at the pad — which is the design point, not a failure.' },
      jitter: { rate: 16, loss: 12, rj: 2.4, note: 'Moderate loss, heavy random jitter. The eye closes sideways instead of vertically.' }
    };

    /* Derived from the preset marked selected, not a second hand-typed copy —
       otherwise the panel starts computing one thing while its controls display
       another. This one started at 12 dB while showing the 9 dB preset. */
    const p = Object.assign({ tr: 0.25 }, PRESETS.typical);
    delete p.note;

    let bits = lfsr(NBITS), h = impulse(p.loss), y = null, meas = null;
    const jit = gaussians(NBITS, 0x5eed);
    let shown = 0, raf = 0, playing = false, last = 0;

    function ui() { return 1000 / p.rate; }        // ps

    function rebuild() {
      h = impulse(p.loss);
      const x = transmit(bits, p.tr);
      y = convolve(x, h);
      // align the sampling instant to the peak of the single-bit response
      const cursor = findCursor(h);
      meas = measure(y, bits, SKIP, cursor, jit, (p.rj / ui()) * SPS);
      meas.cursor = cursor;
      syncOut();
    }

    function syncOut() {
      $('#eye-rate').value = p.rate; $('#eye-rate-out').value = p.rate + ' GT/s';
      $('#eye-loss').value = p.loss; $('#eye-loss-out').value = p.loss + ' dB';
      $('#eye-rj').value = Math.round(p.rj * 10); $('#eye-rj-out').value = p.rj.toFixed(1) + ' ps';
      /* The eye on screen is 900 symbols. Say what that can and cannot support,
         beside the height it produced — see K.berFloor. */
      $('[data-out="evidence"]').textContent = K.berFloorText(NBITS - SKIP - 2);
      $('[data-out="ui"]').textContent = ui().toFixed(1) + ' ps';
      const hmV = Math.max(0, meas.height * 1000);
      const wps = meas.width * ui();
      $('[data-out="eh"]').textContent = hmV.toFixed(0) + ' mV';
      $('[data-out="ew"]').textContent = meas.width <= 0 ? 'closed' : wps.toFixed(0) + ' ps';
      $('[data-out="eh"]').style.color = hmV < 50 ? 'var(--alarm-text)' : 'var(--ink)';
      $('[data-out="ew"]').style.color = wps < 0.3 * ui() ? 'var(--alarm-text)' : 'var(--ink)';
    }

    function fit() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const wCss = cv.clientWidth || cv.parentNode.clientWidth || 320, hCss = 280;
      cv.width = Math.round(wCss * dpr); cv.height = Math.round(hCss * dpr);
      cv.style.height = hCss + 'px';
      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { ctx, w: wCss, h: hCss };
    }

    let geom = null;
    function frameBase() {
      const { ctx, w, h: hh } = fit();
      ctx.clearRect(0, 0, w, hh);
      const L = 52, R = w - 14, TP = 16, B = hh - 30;
      geom = { ctx, L, R, TP, B, w, hh };
      const V = SWING * 0.85;
      const X = (u) => L + (u + 0.5) * (R - L);
      const Y = (v) => (TP + B) / 2 - v / V * (B - TP) / 2;

      for (const v of [-0.4, -0.2, 0, 0.2, 0.4]) {
        const yy = Y(v);
        line(ctx, L, yy, R, yy, v === 0 ? T.border : T.grid, 1);
        label(ctx, (v * 1000).toFixed(0), L - 8, yy, T.muted, 10, 'right');
      }
      for (const u of [-0.5, -0.25, 0, 0.25, 0.5]) {
        const xx = X(u);
        line(ctx, xx, TP, xx, B, u === 0 ? T.border : T.grid, 1);
        label(ctx, u === 0 ? '0' : (u > 0 ? '+' : '') + u, xx, B + 12, T.muted, 10, 'center');
      }
      label(ctx, 'mV', 16, TP + 4, T.muted, 10, 'left');
      label(ctx, 'UI', R - 2, B + 24, T.muted, 10, 'right');
      geom.X = X; geom.Y = Y;
    }

    function line(ctx, x1, y1, x2, y2, c, lw, dash) {
      ctx.save(); ctx.strokeStyle = c; ctx.lineWidth = lw || 1; ctx.setLineDash(dash || []);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
    }
    function label(ctx, t, x, yy, c, size, align) {
      ctx.save(); ctx.fillStyle = c; ctx.font = (size || 10) + 'px ' + MONO;
      ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(t, x, yy); ctx.restore();
    }

    function drawBits(from, to) {
      const { ctx, X, Y } = geom;
      ctx.save();
      ctx.strokeStyle = rgba(T.signal, 0.16);
      ctx.lineWidth = 1.1; ctx.lineJoin = 'round';
      for (let b = from; b < to; b++) {
        // the same jitter realisation the measurement used — picture and numbers agree
        const base = b * SPS + meas.cursor + jit[b] * (p.rj / ui()) * SPS;
        ctx.beginPath();
        for (let s = -SPS / 2; s <= SPS / 2; s++) {
          const idx = Math.round(base + s);
          const v = y[idx];
          if (v === undefined) continue;
          const xx = X(s / SPS), yy = Y(v);
          s === -SPS / 2 ? ctx.moveTo(xx, yy) : ctx.lineTo(xx, yy);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    function overlay() {
      const { ctx, X, Y, L, R, TP, B } = geom;
      if (meas.height > 0 && meas.width > 0) {
        const x0 = X(-meas.width / 2), x1 = X(meas.width / 2);
        const y0 = Y(meas.height / 2), y1 = Y(-meas.height / 2);
        ctx.save();
        ctx.strokeStyle = T.reflect; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
        ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
        ctx.restore();
        label(ctx, 'measured opening', x1 + 6 > R - 60 ? x0 - 6 : x1 + 6, y0 - 8,
              T.reflect, 10, x1 + 6 > R - 60 ? 'right' : 'left');
      } else {
        label(ctx, 'EYE CLOSED at the pad', (L + R) / 2, (TP + B) / 2, T.alarm, 12, 'center');
      }
    }

    function redrawAll() {
      if (!T) readTheme(root);
      frameBase();
      drawBits(SKIP, SKIP + shown);
      if (shown >= NBITS - SKIP - 2) overlay();
    }

    function step(ts) {
      if (!playing) return;
      const dt = Math.min(64, ts - (last || ts)); last = ts;
      const add = Math.max(4, Math.round(dt * 0.9));
      const from = SKIP + shown;
      shown = Math.min(NBITS - SKIP - 2, shown + add);
      drawBits(from, SKIP + shown);
      if (shown >= NBITS - SKIP - 2) { overlay(); stop(); return; }
      raf = requestAnimationFrame(step);
    }
    function play() {
      if (playing) return;
      shown = 0; frameBase();
      if (reduce) { shown = NBITS - SKIP - 2; redrawAll(); return; }
      playing = true; last = 0;
      btn.textContent = '❚❚ Pause'; btn.setAttribute('aria-pressed', 'true');
      raf = requestAnimationFrame(step);
    }
    function stop() {
      playing = false; cancelAnimationFrame(raf);
      btn.textContent = '▶ Rebuild'; btn.setAttribute('aria-pressed', 'false');
    }
    function settle() { stop(); shown = NBITS - SKIP - 2; redrawAll(); }

    function onParam() {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      $('[data-out="note"]').textContent = 'Custom';
      rebuild(); settle();
    }
    $('#eye-rate').addEventListener('input', (e) => { p.rate = +e.target.value; onParam(); });
    $('#eye-loss').addEventListener('input', (e) => { p.loss = +e.target.value; onParam(); });
    $('#eye-rj').addEventListener('input', (e) => { p.rj = +e.target.value / 10; onParam(); });
    btn.addEventListener('click', () => (playing ? settle() : play()));

    root.querySelectorAll('.preset[data-preset]').forEach((b) => {
      b.addEventListener('click', () => {
        const c = PRESETS[b.dataset.preset];
        if (!c) return;   // a .preset with no data-preset is not one
        Object.assign(p, { rate: c.rate, loss: c.loss, rj: c.rj });
        root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
        $('[data-out="note"]').textContent = c.note;
        rebuild();
        reduce ? settle() : play();
      });
    });

    const onTheme = () => { readTheme(root); redrawAll(); };
    window.addEventListener('sipi:theme', onTheme);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', onTheme);
    let rt = 0;
    const onResize = () => { clearTimeout(rt); rt = setTimeout(redrawAll, 90); };
    window.addEventListener('resize', onResize);

    readTheme(root);
    rebuild();
    settle();                                   // a complete eye before anything animates
    root.querySelector('.preset[data-preset="typical"]').setAttribute('aria-pressed', 'true');
    $('[data-out="note"]').textContent = PRESETS.typical.note;

    return {
      start() { if (!reduce && shown >= NBITS - SKIP - 2) play(); },
      stop() { settle(); },
      destroy() {
        stop();
        window.removeEventListener('sipi:theme', onTheme);
        window.removeEventListener('resize', onResize);
      }
    };
  };
})();
