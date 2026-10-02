/* SIPI — viz/lpddr6.js
 * Three roads to the same bandwidth: faster NRZ on 16 pins, PAM4 on 16 pins, and
 * LPDDR6's wide NRZ, through one physical channel at LVSTL's swing.
 *   fast / pam4 / wide   the three eyes, each with its noise and jitter allowance
 *   margins              what is left of each eye, side by side
 *   pulses               the three single-symbol responses on one time axis, so
 *                        the same echo is seen landing on a different symbol
 * Maths: js/models/lpddr6-model.js. Requires viz-kit.js and lpddr6-model.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;

  const PRESETS = {
    lp6: { set: {},
      note: 'The LPDDR6 starting bin: 24 pins at 10.667 Gb/s, against the same raw bandwidth carried on 16 pins either by running NRZ at 16 Gb/s or by sending PAM4 at 8 GBd. Same channel, same 250 mV swing. The wide route keeps the most of its eye; PAM4’s three eyes are each a third of the swing before the channel takes anything.' },
    top: { set: { rate: 14400 },
      note: 'The top defined bin, 14.4 Gb/s on 24 pins. The faster-NRZ road now needs 21.6 Gb/s on 16 pins and its eye is narrow; the wide road at 14.4 still has a usable opening.' },
    clean: { set: { loss5: 0, echo: 0, noiseMv: 0, jitterPs: 0 },
      note: 'A perfect channel with no noise. NRZ opens to the full 250 mV and PAM4 to exactly a third of it, 83 mV: three eyes share the swing. That factor of three, about 9.5 dB, is the price PAM4 pays before anything else happens.' },
    lossy: { set: { loss5: 6 },
      note: 'Twice the loss. Loss grows with frequency, so the road with the highest Nyquist frequency, faster NRZ, loses the most. PAM4 sees the least loss, at half the symbol rate, and still ends with the smallest eye.' },
    noisy: { set: { noiseMv: 7 },
      note: 'More noise and crosstalk, as on a dense escape. The allowance is the same number of millivolts on every road, so it takes the largest share of the smallest eye: PAM4 closes first.' },
    echo: { set: { echo: 15 },
      note: 'A stronger echo, 15% of the signal, 240 ps late. It is the same echo on every road, but it lands on a different symbol on each: almost four symbols late on faster NRZ, two on PAM4. Open the single-symbol responses to watch it.' },
    dfe: { set: { dfe: true },
      note: 'A one-tap DFE on every road, cancelling the first post-cursor. It helps all three, and it cannot help PAM4 with its real problem, which is that its eyes are a third of the swing to begin with.' },
    wider: { set: { pins: 32 },
      note: 'Push the wide road further: 32 pins for the same bandwidth, each at 8 Gb/s. More margin again, paid for in package balls, routing and the power of more drivers. LPDDR6 chose 24.' }
  };

  function ticks(lo, hi, count) {
    const raw = (hi - lo) / count, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw);
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toPrecision(10));
    return out;
  }

  NS.viz.lpddr6 = function (root) {
    const M = (NS.models || {}).lpddr6;
    if (!M) throw new Error('js/models/lpddr6-model.js must load before this panel');
    const $ = (s) => root.querySelector(s);
    const cv = { fast: $('[data-cv="fast"]'), pam4: $('[data-cv="pam4"]'), wide: $('[data-cv="wide"]'), margins: $('[data-cv="margins"]'), pulses: $('[data-cv="pulses"]') };
    const p = Object.assign({}, M.defaults);
    let R = null;
    const out = (k, v) => { const e = $('[data-out="' + k + '"]'); if (e) e.textContent = v; };
    const visible = (c) => !!(c && c.offsetParent !== null && c.clientWidth > 0);

    function drawEye(T, e) {
      const s = K.canvas(cv[e.r.id], 260), sps = M.SPS, ctx = s.ctx;
      const hi = M.SWING * 1.25, lo = -M.SWING * 0.25;
      const P = K.plot(s, T, {
        pad: { l: 46, r: 10, t: 18, b: 30 },
        x: { min: -1, max: 1, ticks: [-1, 0, 1], fmt: (v) => (v * e.r.ui).toFixed(0), title: 'ps' },
        y: { min: lo, max: hi, ticks: ticks(0, M.SWING, 5), fmt: (v) => (v * 1000).toFixed(0), title: 'mV' }
      }).grid();
      ctx.save(); ctx.beginPath(); ctx.rect(P.box.L, P.box.TP, P.box.R - P.box.L, P.box.B - P.box.TP); ctx.clip();
      ctx.strokeStyle = K.rgba(T.signal, e.r.levels > 2 ? 0.1 : 0.07); ctx.lineWidth = 1;
      for (let b = e.lead; b < e.n - 1; b++) {
        ctx.beginPath();
        for (let k = -sps; k <= sps; k++) {
          const v = e.sample(b, k); if (v === undefined) continue;
          const x = P.X(k / sps), y = P.Y(v);
          k === -sps ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();
      const noise = p.q * p.noiseMv / 1000, jit = p.q * p.jitterPs / e.r.ui;
      e.eyes.forEach((ey) => {
        if (ey.c.pts) K.strokeEyeOpening(ctx, P.X, P.Y, ey.c, sps, T.ink);
        /* the allowance: a box of +/- Q sigma in both directions, centred in the eye */
        if (!K.series(ctx, T.reflect, 'allow', 'noise and jitter allowance') && (noise || jit)) {
          ctx.save(); ctx.fillStyle = K.rgba(T.reflect, 0.22); ctx.strokeStyle = T.reflect; ctx.lineWidth = 1;
          const x0 = P.X(-jit), x1 = P.X(jit), y0 = P.Y(ey.centre + noise), y1 = P.Y(ey.centre - noise);
          ctx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)); ctx.strokeRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
          ctx.restore();
        }
      });
      P.frame();
      const ok = e.openV && e.openT;
      K.text(ctx, ok ? 'open after noise' : 'closed after noise', P.box.R - 4, P.box.TP + 8, ok ? T.muted : T.alarm, 10, 'right');
      const tag = $('[data-out="' + e.r.id + '-tag"]');
      if (tag) tag.textContent = e.r.pins + ' × ' + (e.r.baud / 1000).toFixed(1) + (e.r.levels > 2 ? ' GBd' : ' Gb/s');
    }

    function drawMargins(T) {
      const s = K.canvas(cv.margins, 240), ctx = s.ctx;
      const rows = R.map((e) => ({ name: e.r.name, v: e.marginV * 1000, vRaw: e.height * 1000, t: e.marginT / e.r.ui, tRaw: e.width / e.r.ui }));
      const half = (s.w - 30) / 2;
      [['vertical, mV', 'v', 'vRaw', M.SWING * 1000, (x) => x.toFixed(0)], ['horizontal, share of a UI', 't', 'tRaw', 1, (x) => (x * 100).toFixed(0) + '%']].forEach(([title, k, kr, max, fmt], c) => {
        const x0 = 10 + c * (half + 10), lab = 92, w = Math.max(40, half - lab - 86);
        K.text(ctx, title, x0, 14, T.muted, 10, 'left');
        rows.forEach((r, i) => {
          const y = 34 + i * 62;
          K.text(ctx, r.name, x0, y + 10, T.ink2, 10, 'left');
          const bx = x0 + lab, bw = w;
          ctx.fillStyle = K.rgba(T.signal, 0.18); ctx.fillRect(bx, y, bw * Math.min(1, r[kr] / max), 18);
          ctx.fillStyle = T.signal; ctx.fillRect(bx, y + 22, bw * Math.min(1, r[k] / max), 18);
          K.text(ctx, 'eye ' + fmt(r[kr]), bx + bw + 6, y + 9, T.muted, 10, 'left');
          K.text(ctx, r[k] > 0 ? 'left ' + fmt(r[k]) : 'none left', bx + bw + 6, y + 31, r[k] > 0 ? T.ink : T.alarm, 10, 'left');
        });
      });
    }

    function drawPulses(T) {
      const s = K.canvas(cv.pulses, 240);
      const cols = { fast: T.reflect, pam4: T.muted, wide: T.signal };
      const tMax = 900;
      let lo = 0, hi = 0;
      R.forEach((e) => e.P.forEach((v) => { lo = Math.min(lo, v); hi = Math.max(hi, v); }));
      const P = K.plot(s, T, {
        pad: { l: 50, r: 14, t: 18, b: 30 },
        x: { min: -100, max: tMax, ticks: ticks(0, tMax, 6), fmt: (v) => v.toFixed(0), title: 'ps from each symbol’s centre' },
        y: { min: lo - 0.05, max: hi * 1.1, ticks: ticks(0, 1, 4), fmt: (v) => v.toFixed(2), title: 'share of a full symbol' }
      }).grid();
      R.forEach((e) => {
        const dt = e.r.ui / M.SPS, pts = [];
        for (let i = 0; i < e.P.length; i++) pts.push([(i - e.cur) * dt, e.P[i]]);
        P.trace(pts, cols[e.r.id], { width: 2, id: e.r.id, label: e.r.name });
        for (let k = 1; k * e.r.ui < tMax; k++) {
          const x = P.X(k * e.r.ui);
          K.line(s.ctx, x, P.box.B - 6, x, P.box.B, cols[e.r.id], 1.5);
        }
      });
      P.vline(p.echoPs, T.ink2, [3, 3], 'the echo, ' + p.echoPs + ' ps late');
      P.frame();
    }

    function readouts() {
      const raw = 24 * p.rate / 8000;
      out('bw', raw.toFixed(1) + ' GB/s');
      const by = (id) => R.find((e) => e.r.id === id);
      const fmt = (e) => (e.marginV > 0 ? (e.marginV * 1000).toFixed(0) + ' mV' : 'none') + ' / ' + (e.marginT > 0 ? e.marginT.toFixed(0) + ' ps' : 'none');
      out('fast', fmt(by('fast'))); out('pam4', fmt(by('pam4'))); out('wide', fmt(by('wide')));
    }

    function syncControls() {
      $('#l6-rate').value = M.RATES.indexOf(p.rate); $('#l6-rate-out').value = p.rate + ' MT/s';
      $('#l6-pins').value = p.pins; $('#l6-pins-out').value = p.pins + ' pins';
      $('#l6-loss').value = Math.round(p.loss5 * 10); $('#l6-loss-out').value = p.loss5.toFixed(1) + ' dB';
      $('#l6-echo').value = p.echo; $('#l6-echo-out').value = p.echo + '%';
      $('#l6-echops').value = p.echoPs; $('#l6-echops-out').value = p.echoPs + ' ps';
      $('#l6-noise').value = Math.round(p.noiseMv * 2); $('#l6-noise-out').value = p.noiseMv.toFixed(1) + ' mV';
      $('#l6-jit').value = Math.round(p.jitterPs * 10); $('#l6-jit-out').value = p.jitterPs.toFixed(1) + ' ps';
      $('#l6-dfe').checked = !!p.dfe;
    }

    const m = K.mount({
      root, params: p, height: 0,
      draw(T) {
        R = M.run(p);
        R.forEach((e) => drawEye(T, e));
        if (visible(cv.margins)) drawMargins(T);
        if (visible(cv.pulses)) drawPulses(T);
        readouts(); syncControls();
      }
    });

    function clearPreset() {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      $('[data-out="note"]').textContent = 'Custom';
    }
    const bind = (id, fn) => $('#' + id).addEventListener('input', (e) => { fn(+e.target.value); clearPreset(); m.render(); });
    bind('l6-rate', (v) => { p.rate = M.RATES[v]; });
    bind('l6-pins', (v) => { p.pins = v; });
    bind('l6-loss', (v) => { p.loss5 = v / 10; });
    bind('l6-echo', (v) => { p.echo = v; });
    bind('l6-echops', (v) => { p.echoPs = v; });
    bind('l6-noise', (v) => { p.noiseMv = v / 2; });
    bind('l6-jit', (v) => { p.jitterPs = v / 10; });
    $('#l6-dfe').addEventListener('change', (e) => { p.dfe = e.target.checked; clearPreset(); m.render(); });
    root.querySelectorAll('.preset[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const c = PRESETS[b.dataset.preset];
      if (!c) return;
      Object.assign(p, M.defaults, c.set);
      root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      $('[data-out="note"]').textContent = c.note;
      m.render();
    }));
    $('[data-out="note"]').textContent = PRESETS.lp6.note;
    const off = K.onRepaint(root, () => m.render());
    m.render();
    return { start() {}, stop() {}, destroy() { off(); m.teardown(); } };
  };
  NS.viz.lpddr6.presets = PRESETS;
})();
