/* SI & PI — viz/isi.js
 * Where ISI comes from: one bit's response, and what it does to its neighbours.
 *
 * Uses the shared channel model in viz-kit (two-term loss law, minimum phase).
 * Panel 1 is the single-bit response sampled once per UI — cursor, pre-cursor
 * and post-cursors. Panel 2 drives two specific patterns through the same
 * channel and reads the voltage at the sampling instant, which is the whole
 * point of the page: same channel, same driver, two different voltages.
 *
 * Requires js/viz-kit.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;
  const SPS = 32, NFFT = 4096, SWING = 0.8;

  function drive(bits, tr) {
    const n = bits.length * SPS, x = new Float64Array(n);
    const trs = Math.max(1, tr * SPS);
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(i / SPS);
      const prev = idx > 0 ? bits[idx - 1] : bits[0], cur = bits[idx];
      const u = (i - idx * SPS) / trs;
      const a = (u >= 1 || prev === cur) ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, u)));
      x[i] = (prev + (cur - prev) * a - 0.5) * SWING;
    }
    return x;
  }
  function conv(x, h) {
    const y = new Float64Array(x.length);
    for (let i = 0; i < x.length; i++) {
      let s = 0;
      const kmax = Math.min(h.length, i + 1);
      for (let k = 0; k < kmax; k++) s += h[k] * x[i - k];
      y[i] = s;
    }
    return y;
  }

  NS.viz.isi = function (root) {
    const $ = (s) => root.querySelector(s);
    const cvP = $('[data-cv="pulse"]'), cvW = $('[data-cv="pattern"]');
    const p = { loss: 14, rate: 16 };

    const PRESETS = {
      light:  { loss: 4,  rate: 16, note: 'A short channel. The response is nearly one UI wide and the neighbours barely feel it.' },
      medium: { loss: 14, rate: 16, note: 'A real board. The tail now runs several UI, so the isolated bit no longer reaches the run amplitude.' },
      heavy:  { loss: 26, rate: 16, note: 'A long channel. The cursor is a fraction of the swing and most of the energy has moved into the tail.' },
      fast:   { loss: 14, rate: 32, note: 'Same channel loss, twice the rate. Everything is the same in UI — which is why loss is always quoted at Nyquist.' }
    };

    function build() {
      const h = K.channelImpulse(p.loss, SPS, NFFT);
      const sb = K.singleBit(h, SPS);
      const cur = sb.cursor;
      // taps: value of the single-bit response one UI apart around the cursor
      const taps = [];
      for (let k = -3; k <= 8; k++) {
        const i = cur + k * SPS;
        taps.push([k, i >= 0 && i < sb.sbr.length ? sb.sbr[i] * SWING : 0]);
      }
      // two patterns: an isolated one after a run of zeros, and the last bit of a run
      const mk = (bits) => conv(drive(bits, 0.25), h);
      const iso = [0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0];
      const run = [1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0];
      const yi = mk(iso), yr = mk(run);
      const vIso = yi[8 * SPS + cur], vRun = yr[8 * SPS + cur];
      return { h, sb, cur, taps, yi, yr, vIso, vRun };
    }
    let M = build();

    function drawPulse(T) {
      const s = K.canvas(cvP, 220);
      const P = K.plot(s, T, {
        pad: { l: 54, r: 16, t: 18, b: 30 },
        x: { min: -3.5, max: 8.5, ticks: [-3,-2,-1,0,1,2,3,4,5,6,7,8], fmt: (v) => v === 0 ? '0' : (v > 0 ? '+' + v : v), title: 'UI from cursor' },
        y: { min: Math.min(-0.05, ...M.taps.map(t => t[1])) * 1.2, max: Math.max(0.05, ...M.taps.map(t => t[1])) * 1.15,
             count: 5, fmt: (v) => (v * 1000).toFixed(0), title: 'mV' }
      }).grid();
      const ctx = s.ctx, y0 = P.Y(0);
      for (const [k, v] of M.taps) {
        const x = P.X(k);
        const col = k === 0 ? T.signal : (k < 0 ? T.muted : T.reflect);
        K.line(ctx, x, y0, x, P.Y(v), col, k === 0 ? 3 : 2);
        K.dot(ctx, x, P.Y(v), col, T.surface, k === 0 ? 4.5 : 3);
      }
      K.text(ctx, 'cursor', P.X(0), P.Y(M.taps[3][1]) - 14, T.signal, 10, 'center');
      K.text(ctx, 'pre', P.X(-2), y0 + 16, T.muted, 10, 'center');
      K.text(ctx, 'post-cursors — this is the ISI', P.X(4), y0 + 16, T.reflect, 10, 'center');
      P.frame();
    }

    function drawPattern(T) {
      const s = K.canvas(cvW, 230);
      const span = 14;
      const P = K.plot(s, T, {
        pad: { l: 54, r: 82, t: 18, b: 30 },
        x: { min: 0, max: span, count: 7, fmt: (v) => v.toFixed(0), title: 'UI' },
        y: { min: -SWING * 0.62, max: SWING * 0.62, count: 5, fmt: (v) => (v * 1000).toFixed(0), title: 'mV' }
      }).grid();
      const pts = (y) => {
        const out = [];
        for (let i = 0; i < span * SPS; i++) out.push([i / SPS, y[i + M.cur] || 0]);
        return out;
      };
      P.trace(pts(M.yr), T.reflect, { width: 2 });
      P.trace(pts(M.yi), T.signal, { width: 2, glow: true });

      const ctx = s.ctx, B = P.box, xs = P.X(8);
      K.line(ctx, xs, B.TP, xs, B.B, T.ink2, 1, [2, 3]);
      K.text(ctx, 'sample', xs, B.TP + 8, T.ink2, 10, 'center');
      K.dot(ctx, xs, P.Y(M.vIso), T.signal, T.surface, 4.5);
      K.dot(ctx, xs, P.Y(M.vRun), T.reflect, T.surface, 4.5);
      if (!P.narrow) K.text(ctx, 'isolated 1', B.R + 6, P.Y(M.vIso), T.signal, 10, 'left');
      if (!P.narrow) K.text(ctx, 'end of a run', B.R + 6, P.Y(M.vRun), T.reflect, 10, 'left');
      P.frame();
    }

    function draw(T) {
      drawPulse(T); drawPattern(T);
      const worst = M.taps.filter(t => t[0] > 0).reduce((a, t) => Math.max(a, Math.abs(t[1])), 0);
      // taps are the response to one full-swing bit; the waveform readouts are
      // measured from the decision threshold. Halve the taps to put both on the
      // same scale, so "cursor" and "end of a run" are comparable numbers.
      $('[data-out="cursor"]').textContent = (M.taps[3][1] * 500).toFixed(0) + ' mV';
      $('[data-out="post"]').textContent = (worst * 500).toFixed(0) + ' mV';
      $('[data-out="iso"]').textContent = (M.vIso * 1000).toFixed(0) + ' mV';
      $('[data-out="run"]').textContent = (M.vRun * 1000).toFixed(0) + ' mV';
      // A ratio goes meaningless once the isolated bit crosses the threshold, so
      // report the thing that actually decides the bit instead.
      const e = $('[data-out="ratio"]');
      const ok = M.vIso > 0;
      e.textContent = ok ? 'resolves' : 'FAILS';
      e.style.color = ok ? 'var(--ink)' : 'var(--alarm-text)';
      $('#isi-loss').value = p.loss; $('#isi-loss-out').value = p.loss + ' dB';
      $('#isi-rate').value = p.rate; $('#isi-rate-out').value = p.rate + ' GT/s';
    }

    const m = K.mount({ root, params: p, draw });
    const clear = () => {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      $('[data-out="note"]').textContent = 'Custom';
    };
    $('#isi-loss').addEventListener('input', (e) => { p.loss = +e.target.value; M = build(); clear(); m.render(); });
    $('#isi-rate').addEventListener('input', (e) => { p.rate = +e.target.value; clear(); m.render(); });
    root.querySelectorAll('.preset[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const q = PRESETS[b.dataset.preset];
      /* A `.preset` without a data-preset is not a preset — the sweep button
         on Lab B is one. Reading straight from the table threw on it. */
      if (!q) return;
      Object.assign(p, q); M = build();
      root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      $('[data-out="note"]').textContent = q.note;
      m.render();
    }));
    root.querySelector('.preset[data-preset="medium"]').setAttribute('aria-pressed', 'true');
    $('[data-out="note"]').textContent = PRESETS.medium.note;
    m.render();
    return { start() {}, stop() {}, destroy() { m.teardown(); } };
  };
})();
