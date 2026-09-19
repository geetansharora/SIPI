/* SI & PI — viz/pdn-extras.js
 * Four Power Integrity panels that share the same series-RLC vocabulary.
 *   targetZ        — the target impedance formula, and the current spectrum it ignores
 *   antiResonance  — two capacitors, one peak, and what sets its height
 *   ssn            — di/dt through shared return inductance
 *   vrmStep        — a load step, the three droops, and what the loop can reach
 *
 * All exact. Requires js/viz-kit.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;

  const zBranch = (br, f) => {
    const w = 2 * Math.PI * f;
    return { re: br.esr / br.n, im: (w * br.esl - 1 / (w * br.C)) / br.n };
  };
  const zPar = (bs, f) => {
    let gr = 0, gi = 0;
    for (const b of bs) {
      if (!b.on) continue;
      const z = zBranch(b, f), d = z.re * z.re + z.im * z.im;
      if (d) { gr += z.re / d; gi += -z.im / d; }
    }
    const d = gr * gr + gi * gi;
    return d ? Math.hypot(gr / d, -gi / d) : Infinity;
  };
  const srf = (C, L) => 1 / (2 * Math.PI * Math.sqrt(C * L));

  const bindAll = (root, $, p, m, map) => {
    const clear = () => {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      const n = $('[data-out="note"]'); if (n) n.textContent = 'Custom';
    };
    for (const [id, key, sc] of map) {
      $(id).addEventListener('input', (e) => { p[key] = +e.target.value * (sc || 1); clear(); m.render(); });
    }
    return clear;
  };
  const wirePresets = (root, $, p, m, PRESETS, initial) => {
    root.querySelectorAll('.preset[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const c = PRESETS[b.dataset.preset];

      if (!c) return;
      Object.keys(c).forEach((k) => { if (k !== 'note') p[k] = c[k]; });
      root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      $('[data-out="note"]').textContent = c.note;
      m.render();
    }));
    const el = root.querySelector('.preset[data-preset="' + initial + '"]');
    if (el) el.setAttribute('aria-pressed', 'true');
    const c = PRESETS[initial];
    Object.keys(c).forEach((k) => { if (k !== 'note') p[k] = c[k]; });
    $('[data-out="note"]').textContent = c.note;
  };

  /* ═══════════ target impedance ═══════════ */
  NS.viz.targetZ = function (root) {
    const $ = (s) => root.querySelector(s);
    const cv = $('[data-cv="zt"]');
    const p = { vdd: 0.75, ripple: 5, imax: 20, frac: 50 };
    const PRESETS = {
      soc:    { vdd: 0.75, ripple: 5, imax: 20, frac: 50, note: 'A typical SoC core rail. 37.5 mV of budget against a 10 A step gives 3.75 mΩ — flat, across eight decades.' },
      tight:  { vdd: 0.75, ripple: 3, imax: 20, frac: 50, note: 'Tighten the ripple spec to 3% and the target drops to 2.25 mΩ. The cost of that is not linear.' },
      io:     { vdd: 1.80, ripple: 5, imax: 2,  frac: 50, note: 'A 1.8 V I/O rail drawing far less current: 90 mV over 1 A is 90 mΩ, a completely different design problem.' },
      big:    { vdd: 0.75, ripple: 5, imax: 60, frac: 50, note: 'A big compute die. Three times the current, one third the target — this is why high-current rails are hard.' }
    };
    function zt() { return (p.vdd * p.ripple / 100) / (p.imax * p.frac / 100); }

    function draw(T) {
      const s = K.canvas(cv, 250);
      const F_LO = 1e3, F_HI = 1e9;
      const t = zt();
      const P = K.plot(s, T, {
        pad: { l: 62, r: 16, t: 20, b: 32 },
        x: { min: F_LO, max: F_HI, log: true, fmt: K.fmt.hz, title: 'frequency' },
        y: { min: 1e-4, max: 1, log: true, fmt: K.fmt.ohm, title: '|Z|' }
      }).grid();
      const ctx = s.ctx, B = P.box;

      // the flat target the formula produces
      P.hline(t, T.alarm, [5, 4], 'Z target = ' + K.fmt.ohm(t));
      ctx.save();
      ctx.fillStyle = K.rgba(T.alarm, 0.07);
      ctx.fillRect(B.L, B.TP, B.R - B.L, P.Y(t) - B.TP);
      ctx.restore();

      // where the die actually draws current — the thing a flat target ignores
      const peaks = [[2e5, 1], [1.2e7, 0.75], [1e8, 0.55], [4e8, 0.3]];
      const spec = (f) => {
        let a = 0.04;
        for (const [fc, h] of peaks) a += h / (1 + Math.pow((Math.log10(f / fc)) / 0.16, 2));
        return Math.min(1, a);
      };
      ctx.save();
      ctx.beginPath();
      let started = false;
      for (let i = 0; i <= 300; i++) {
        const f = F_LO * Math.pow(F_HI / F_LO, i / 300);
        const y = B.B - spec(f) * (B.B - B.TP) * 0.30;
        started ? ctx.lineTo(P.X(f), y) : (ctx.moveTo(P.X(f), y), started = true);
      }
      ctx.lineTo(B.R, B.B); ctx.lineTo(B.L, B.B); ctx.closePath();
      ctx.fillStyle = K.rgba(T.signal, 0.16); ctx.fill();
      ctx.strokeStyle = K.rgba(T.signal, 0.65); ctx.lineWidth = 1.2; ctx.stroke();
      ctx.restore();
      K.text(ctx, 'synthetic current spectrum — shape only, arbitrary vertical scale',
             B.L + 8, B.B - 16, T.signal, 10, 'left');
      K.text(ctx, 'it shares the axis for comparison; it is not an impedance',
             B.L + 8, B.B - 5, T.muted, 9, 'left');
      K.text(ctx, 'a flat target over-designs here…', B.L + 8, B.TP + 14, T.muted, 10, 'left');
      K.text(ctx, '…and says nothing about a peak landing on a spike', B.R - 8, B.TP + 14, T.muted, 10, 'right');
      P.frame();

      $('[data-out="zt"]').textContent = K.fmt.ohm(t);
      $('[data-out="budget"]').textContent = (p.vdd * p.ripple * 10).toFixed(1) + ' mV';
      $('[data-out="step"]').textContent = (p.imax * p.frac / 100).toFixed(1) + ' A';
      $('#tz-vdd').value = Math.round(p.vdd * 100); $('#tz-vdd-out').value = p.vdd.toFixed(2) + ' V';
      $('#tz-rip').value = p.ripple; $('#tz-rip-out').value = p.ripple + ' %';
      $('#tz-imax').value = p.imax; $('#tz-imax-out').value = p.imax + ' A';
      $('#tz-frac').value = p.frac; $('#tz-frac-out').value = p.frac + ' %';
    }
    const m = K.mount({ root, params: p, draw });
    bindAll(root, $, p, m, [['#tz-vdd','vdd',0.01],['#tz-rip','ripple'],['#tz-imax','imax'],['#tz-frac','frac']]);
    wirePresets(root, $, p, m, PRESETS, 'soc');
    m.render();
    return { start() {}, stop() {}, destroy() { m.teardown(); } };
  };

  /* ═══════════ anti-resonance ═══════════ */
  /* ---------- the anti-resonance peak search, as a pure model (M2-4) ----------
     The search and its refinement lived inside draw(), so the only way to ask
     whether a peak had been found was to read a canvas and a readout. That is
     how the stale-peak defect survived: `if (pk) { ... }` with no else, so when
     no peak existed the previous value simply stayed on screen and a resolved
     problem still read as 246.8 mOhm at 11 MHz.

     Returning null explicitly — and having a caller that must handle it — is
     what makes "there is no peak" a representable answer rather than an absence.
     Same rule as the bathtub sentinel and the search score: a search that can
     fail returns an explicit empty result. */
  NS.models = NS.models || {};
  NS.models.antiResonancePeak = function (bs, fLo, fHi, n) {
    n = n || 400;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const f = fLo * Math.pow(fHi / fLo, i / n);
      pts.push([f, zPar(bs, f)]);
    }
    let pk = null;
    for (let i = 1; i < pts.length - 1; i++) {
      if (pts[i][1] > pts[i - 1][1] && pts[i][1] >= pts[i + 1][1] && (!pk || pts[i][1] > pk[1])) {
        /* Refine within the bracketing samples. A 400-point log grid across five
           decades can straddle a narrow anti-resonance and under-report its
           height by a wide margin, which matters because the height is the whole
           point of the panel. */
        let a = pts[i - 1][0], b = pts[i + 1][0];
        const R = 0.6180339887;
        let c = b - R * (b - a), d = a + R * (b - a);
        for (let m = 0; m < 60; m++) {
          if (zPar(bs, c) > zPar(bs, d)) { b = d; d = c; c = b - R * (b - a); }
          else { a = c; c = d; d = a + R * (b - a); }
        }
        const f = (a + b) / 2;
        pk = [f, zPar(bs, f)];
      }
    }
    return { pts: pts, peak: pk ? { f: pk[0], z: pk[1] } : null };
  };

  NS.viz.antiResonance = function (root) {
    const $ = (s) => root.querySelector(s);
    const cv = $('[data-cv="ar"]');
    const p = { cBig: 10, cSml: 100, esr: 1, esl: 1.2 };   // µF, nF, ×, nH
    const PRESETS = {
      two:   { cBig: 10, cSml: 100, esr: 1, esl: 1.2, note: 'Two decades apart. Between their resonances one is inductive and the other capacitive — a parallel tank, and a peak.' },
      close: { cBig: 1,  cSml: 100, esr: 1, esl: 1.2, note: 'Values one decade apart. The gap narrows and the peak shrinks — closer values interact less badly.' },
      lowesr:{ cBig: 10, cSml: 100, esr: 0.2, esl: 1.2, note: 'A fifth the ESR. The floor drops a little and the peak grows about five times: Q is set by resistance alone.' },
      damped:{ cBig: 10, cSml: 100, esr: 4, esl: 1.2, note: 'Four times the ESR. The peak all but disappears. This is why controlled-ESR parts exist.' }
    };
    function branches() {
      return [
        { C: p.cBig * 1e-6, esr: 0.010 * p.esr, esl: p.esl * 1e-9, n: 1, on: true },
        { C: p.cSml * 1e-9, esr: 0.008 * p.esr, esl: p.esl * 1e-9, n: 1, on: true }
      ];
    }
    function draw(T) {
      const s = K.canvas(cv, 260);
      const F_LO = 1e4, F_HI = 1e9, bs = branches();
      const P = K.plot(s, T, {
        pad: { l: 62, r: 16, t: 20, b: 32 },
        x: { min: F_LO, max: F_HI, log: true, fmt: K.fmt.hz, title: 'frequency' },
        y: { min: 1e-3, max: 10, log: true, fmt: K.fmt.ohm, title: '|Z|' }
      }).grid();
      const M = NS.models.antiResonancePeak(bs, F_LO, F_HI, 400);
      const pts = M.pts;
      const pk = M.peak ? [M.peak.f, M.peak.z] : null;
      const each = [[], []];
      for (let i = 0; i <= 400; i++) {
        const f = F_LO * Math.pow(F_HI / F_LO, i / 400);
        bs.forEach((b, j) => { const z = zBranch(b, f); each[j].push([f, Math.hypot(z.re, z.im)]); });
      }
      P.trace(each[0], T.muted, { width: 1, dash: [3, 3] });
      P.trace(each[1], T.muted, { width: 1, dash: [3, 3] });
      P.trace(pts, T.signal, { width: 2.2, glow: true });
      const ctx = s.ctx;
      for (const b of bs) P.vline(srf(b.C, b.esl), T.reflect, [2, 4]);
      K.text(ctx, 'SRF of each part', P.X(srf(bs[0].C, bs[0].esl)) + 5, P.box.B - 12, T.reflect, 10, 'left');
      if (pk) {
        K.dot(ctx, P.X(pk[0]), P.Y(pk[1]), T.alarm, T.surface, 5);
        /* Flip the label to the left of the marker when it would overrun the plot.
           Canvas text does not wrap and does not clip gracefully. */
        const lbl = K.fmt.ohm(pk[1]) + ' @ ' + K.fmt.hz(pk[0]);
        ctx.save(); ctx.font = '10px ' + K.MONO;
        const lw = ctx.measureText(lbl).width; ctx.restore();
        const fits = P.X(pk[0]) + 8 + lw < P.box.R;
        K.text(ctx, lbl, P.X(pk[0]) + (fits ? 8 : -8), P.Y(pk[1]) - 10,
               T.alarm, 10, fits ? 'left' : 'right');
        $('[data-out="peak"]').textContent = K.fmt.ohm(pk[1]);
        $('[data-out="fpk"]').textContent = K.fmt.hz(pk[0]);
        $('[data-out="peak"]').style.color = 'var(--alarm-text)';
      } else {
        /* No between-SRF peak exists in this configuration — set both capacitors
           equal and there is nothing between the SRFs to resonate. Without this
           branch the previous value simply stayed on screen, so a resolved
           problem still read as 246.8 mOhm at 11 MHz. */
        $('[data-out="peak"]').textContent = 'none';
        $('[data-out="peak"]').style.color = 'var(--muted)';
        $('[data-out="fpk"]').textContent = 'no between-SRF peak';
        K.text(ctx, 'no anti-resonance between the two SRFs in this configuration',
               (P.box.L + P.box.R) / 2, P.box.TP + 16, T.muted, 11, 'center');
      }
      P.frame();
      $('[data-out="srf1"]').textContent = K.fmt.hz(srf(bs[0].C, bs[0].esl));
      $('[data-out="srf2"]').textContent = K.fmt.hz(srf(bs[1].C, bs[1].esl));
      $('#ar-cb').value = p.cBig; $('#ar-cb-out').value = p.cBig + ' µF';
      $('#ar-cs').value = p.cSml; $('#ar-cs-out').value = p.cSml + ' nF';
      $('#ar-esr').value = Math.round(p.esr * 10); $('#ar-esr-out').value = p.esr.toFixed(1) + '×';
      $('#ar-esl').value = Math.round(p.esl * 10); $('#ar-esl-out').value = p.esl.toFixed(1) + ' nH';
    }
    const m = K.mount({ root, params: p, draw });
    bindAll(root, $, p, m, [['#ar-cb','cBig'],['#ar-cs','cSml'],['#ar-esr','esr',0.1],['#ar-esl','esl',0.1]]);
    wirePresets(root, $, p, m, PRESETS, 'two');
    m.render();
    return { start() {}, stop() {}, destroy() { m.teardown(); } };
  };

  /* ═══════════ SSN ═══════════ */
  NS.viz.ssn = function (root) {
    const $ = (s) => root.querySelector(s);
    const cv = $('[data-cv="ssn"]');
    const p = { nbits: 16, ibit: 13, tr: 150, lret: 50, budget: 100 };
    const PRESETS = {
      x16:  { nbits: 16, ibit: 13, tr: 150, lret: 50, budget: 100, note: 'A x16 bus switching together through 50 pH of shared return. The mean slope gives 69 mV, but a raised-cosine edge peaks at pi/2 times its mean — so the worst instantaneous bounce is 109 mV, which is what the readout shows, against a 100 mV budget.' },
      dbi:  { nbits: 8,  ibit: 13, tr: 150, lret: 50, budget: 100, note: 'Halving the number of bits switching together halves the di/dt, and so the bounce. Data bus inversion is one way to bound that — though what a given DDR generation and mode actually limits (transitions, or bits at a level) needs checking against that spec, not assumed.' },
      gnd:  { nbits: 16, ibit: 13, tr: 150, lret: 20, budget: 100, note: 'More ground balls interleaved with the signals: 20 pH instead of 50. This is the biggest single lever.' },
      slow: { nbits: 16, ibit: 13, tr: 300, lret: 50, budget: 100, note: 'Slew-rate control instead. Halving di/dt halves the bounce — but it costs timing margin.' }
    };
    function draw(T) {
      const s = K.canvas(cv, 250);
      const tMax = p.tr * 3.2, ipk = p.nbits * p.ibit * 1e-3;      // A
      const di = (t) => {                                          // dI/dt, A/s
        if (t <= 0 || t >= p.tr) return 0;
        return ipk * (Math.PI / (2 * p.tr * 1e-12)) * Math.sin(Math.PI * t / p.tr);
      };
      const v = (t) => p.lret * 1e-12 * di(t);                     // V
      const N = 500, cur = [], bounce = [];
      let vpk = 0;
      for (let i = 0; i <= N; i++) {
        const t = (i / N) * tMax - p.tr * 0.4;
        const I = t <= 0 ? 0 : t >= p.tr ? ipk : ipk * (0.5 - 0.5 * Math.cos(Math.PI * t / p.tr));
        cur.push([t, I]); const vv = v(t); bounce.push([t, vv]);
        if (vv > vpk) vpk = vv;
      }
      const P = K.plot(s, T, {
        pad: { l: 56, r: 84, t: 20, b: 32 },
        x: { min: -p.tr * 0.4, max: tMax - p.tr * 0.4, count: 5, fmt: (x) => x.toFixed(0), title: 'ps' },
        y: { min: -0.05, max: Math.max(vpk * 1.25, p.budget / 1000 * 1.3), count: 5,
             fmt: (y) => (y * 1000).toFixed(0), title: 'mV' }
      }).grid();
      P.hline(p.budget / 1000, T.alarm, [4, 4], 'noise budget ' + p.budget + ' mV');
      // current, scaled onto the same frame so the shapes can be compared
      const sc = (Math.max(vpk, p.budget / 1000) * 0.9) / ipk;
      P.trace(cur.map(([t, I]) => [t, I * sc]), T.muted, { width: 1.4, dash: [4, 3] });
      P.trace(bounce, T.reflect, { width: 2.2, glow: true });
      const ctx = s.ctx, B = P.box;
      if (!P.narrow) K.text(ctx, 'ground bounce', B.R + 6, P.Y(vpk), T.reflect, 10, 'left');
      if (!P.narrow) K.text(ctx, 'L·di/dt', B.R + 6, P.Y(vpk) + 12, T.muted, 9, 'left');
      if (!P.narrow) K.text(ctx, 'total current', B.R + 6, P.Y(ipk * sc), T.muted, 10, 'left');
      P.frame();
      $('[data-out="ipk"]').textContent = ipk.toFixed(2) + ' A';
      // peak, not average: a raised-cosine edge peaks at π/2 times its mean slope,
      // and the peak is what sets the worst-case bounce
      $('[data-out="didt"]').textContent =
        (ipk * (Math.PI / (2 * p.tr * 1e-12)) / 1e9).toFixed(1) + ' GA/s';
      const e = $('[data-out="vpk"]');
      e.textContent = (vpk * 1000).toFixed(0) + ' mV';
      e.style.color = vpk * 1000 > p.budget ? 'var(--alarm-text)' : 'var(--ink)';
      $('[data-out="frac"]').textContent = (vpk * 1e5 / p.budget).toFixed(0) + '% of budget';
      $('#sn-n').value = p.nbits; $('#sn-n-out').value = p.nbits + ' bits';
      $('#sn-i').value = p.ibit; $('#sn-i-out').value = p.ibit + ' mA';
      $('#sn-tr').value = p.tr; $('#sn-tr-out').value = p.tr + ' ps';
      $('#sn-l').value = p.lret; $('#sn-l-out').value = p.lret + ' pH';
    }
    const m = K.mount({ root, params: p, draw });
    bindAll(root, $, p, m, [['#sn-n','nbits'],['#sn-i','ibit'],['#sn-tr','tr'],['#sn-l','lret']]);
    wirePresets(root, $, p, m, PRESETS, 'x16');
    m.render();
    return { start() {}, stop() {}, destroy() { m.teardown(); } };
  };

  /* ═══════════ VRM load step ═══════════ */
  NS.viz.vrmStep = function (root) {
    const $ = (s) => root.querySelector(s);
    const cv = $('[data-cv="vrm"]');
    const p = { bw: 100, cbulk: 500, istep: 10, avp: 0 };   // kHz, µF, A, on/off
    const PRESETS = {
      base:  { bw: 100, cbulk: 500, istep: 10, avp: 0, note: 'A 100 kHz loop against a 10 A step. The capacitors hold the rail alone for the whole first ten microseconds.' },
      fast:  { bw: 400, cbulk: 500, istep: 10, avp: 0, note: 'Four times the loop bandwidth. The capacitors are on their own for a quarter as long, so both the depth and the duration improve.' },
      morec: { bw: 100, cbulk: 2000, istep: 10, avp: 0, note: 'Four times the capacitance instead. The same depth improvement — but the excursion still lasts as long, because the loop has not got faster.' },
      avp:   { bw: 100, cbulk: 500, istep: 10, avp: 1, note: 'Load-line droop: the rail sits high at light load, so the same step has further to fall before it hits the limit.' }
    };
    function draw(T) {
      const s = K.canvas(cv, 250);
      const tau = 1 / (2 * Math.PI * p.bw * 1e3);              // s
      const sag = p.istep * tau / (p.cbulk * 1e-6);            // V, charge deficit
      const lim = 0.037, offset = p.avp ? 0.018 : 0;
      const tMax = 8 * tau;
      const pts = [];
      let dvMax = 0;                       // the excursion itself, independent of the offset
      for (let i = 0; i <= 500; i++) {
        const t = (i / 500) * tMax;
        const dv = t <= 0 ? 0 : sag * Math.exp(-t / tau) * (1 - Math.exp(-t / (tau * 0.06)));
        pts.push([t * 1e6, offset - dv]);
        if (dv > dvMax) dvMax = dv;
      }
      const P = K.plot(s, T, {
        pad: { l: 62, r: 16, t: 20, b: 32 },
        x: { min: 0, max: tMax * 1e6, count: 5, fmt: (x) => x.toFixed(1), title: 'µs' },
        y: { min: -Math.max(sag * 1.3, lim * 1.25), max: Math.max(0.026, offset * 1.7), count: 5,
             fmt: (y) => (y * 1000).toFixed(0), title: 'mV from nominal' }
      }).grid();
      P.hline(-lim, T.alarm, [4, 4], 'lower limit');
      if (p.avp) P.hline(offset, T.muted, [3, 3], 'light-load offset (AVP)');
      P.trace(pts, T.signal, { width: 2.2, glow: true });
      const ctx = s.ctx;
      const loopX = P.X(tau * 1e6);
      P.vline(tau * 1e6, T.reflect, [3, 3]);
      K.text(ctx, 'loop responds', loopX + 5, P.box.TP + 10, T.reflect, 10, 'left');
      P.frame();
      const margin = lim + offset - dvMax;   // AVP starts the rail high, so it buys margin
      $('[data-out="sag"]').textContent = (dvMax * 1000).toFixed(1) + ' mV';
      const e = $('[data-out="margin"]');
      e.textContent = (margin * 1000).toFixed(1) + ' mV';
      e.style.color = margin < 0 ? 'var(--alarm-text)' : 'var(--ink)';
      $('[data-out="tau"]').textContent = (tau * 1e6).toFixed(2) + ' µs';
      $('#vr-bw').value = p.bw; $('#vr-bw-out').value = p.bw + ' kHz';
      $('#vr-c').value = p.cbulk; $('#vr-c-out').value = p.cbulk + ' µF';
      $('#vr-i').value = p.istep; $('#vr-i-out').value = p.istep + ' A';
      $('#vr-avp').checked = !!p.avp;
    }
    const m = K.mount({ root, params: p, draw });
    bindAll(root, $, p, m, [['#vr-bw','bw'],['#vr-c','cbulk'],['#vr-i','istep']]);
    $('#vr-avp').addEventListener('change', (e) => { p.avp = e.target.checked ? 1 : 0; m.render(); });
    wirePresets(root, $, p, m, PRESETS, 'base');
    m.render();
    return { start() {}, stop() {}, destroy() { m.teardown(); } };
  };
})();

/* Appended: plane cavity resonance, and PDN noise turning into jitter. */
(function () {
  const NS = window.SIPI, K = NS.kit;

  const bindAll = (root, $, p, m, map) => {
    const clear = () => {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      const n = $('[data-out="note"]'); if (n) n.textContent = 'Custom';
    };
    for (const [id, key, sc] of map) {
      $(id).addEventListener('input', (e) => { p[key] = +e.target.value * (sc || 1); clear(); m.render(); });
    }
  };
  const wirePresets = (root, $, p, m, PRESETS, initial) => {
    root.querySelectorAll('.preset[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const c = PRESETS[b.dataset.preset];

      if (!c) return;
      Object.keys(c).forEach((k) => { if (k !== 'note') p[k] = c[k]; });
      root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      $('[data-out="note"]').textContent = c.note;
      m.render();
    }));
    const el = root.querySelector('.preset[data-preset="' + initial + '"]');
    if (el) el.setAttribute('aria-pressed', 'true');
    const c = PRESETS[initial];
    Object.keys(c).forEach((k) => { if (k !== 'note') p[k] = c[k]; });
    $('[data-out="note"]').textContent = c.note;
  };

  /* ═══════════ plane cavity resonance ═══════════
     f_mn = (c / 2√Dk) · √((m/a)² + (n/b)²)  — exact for a rectangular cavity. */
  NS.viz.planeResonance = function (root) {
    const $ = (s) => root.querySelector(s);
    const cv = $('[data-cv="modes"]');
    const C0 = 299.792458;                              // mm/ns
    const p = { a: 100, b: 80, dk: 4.2 };

    const PRESETS = {
      board:  { a: 100, b: 80, dk: 4.2, note: 'A 100 × 80 mm plane pair on FR-4. The first mode lands near 730 MHz — well above where any capacitor still works.' },
      big:    { a: 250, b: 200, dk: 4.2, note: 'A large server board. The modes drop into the low hundreds of MHz and crowd together.' },
      small:  { a: 40, b: 30, dk: 4.2, note: 'A small module. Every mode is pushed up past 1.8 GHz — one reason splitting a plane can help.' },
      lowdk:  { a: 100, b: 80, dk: 3.0, note: 'The same board on a lower-Dk laminate. Modes move up by √(4.2/3.0), about 18%.' }
    };

    function modes() {
      const v = C0 / Math.sqrt(p.dk);                   // mm/ns
      const out = [];
      for (let m0 = 0; m0 <= 3; m0++) {
        for (let n0 = 0; n0 <= 3; n0++) {
          if (!m0 && !n0) continue;
          const f = (v / 2) * Math.sqrt(Math.pow(m0 / p.a, 2) + Math.pow(n0 / p.b, 2));  // GHz
          out.push({ m: m0, n: n0, f });
        }
      }
      return out.sort((x, y) => x.f - y.f);
    }

    function draw(T) {
      const s = K.canvas(cv, 250);
      const ms = modes();
      const F_HI = Math.max(3, ms[ms.length - 1].f * 1.1);
      const P = K.plot(s, T, {
        pad: { l: 56, r: 16, t: 22, b: 34 },
        x: { min: 0, max: F_HI, count: 6, fmt: (v) => v.toFixed(1), title: 'GHz' },
        y: { min: 0, max: 1, ticks: [], fmt: () => '', title: '' }
      }).grid();
      const ctx = s.ctx, B = P.box;

      // where board capacitors have already given up
      const capLimit = 0.2;
      ctx.save();
      ctx.fillStyle = K.rgba(T.muted, 0.10);
      ctx.fillRect(B.L, B.TP, P.X(capLimit) - B.L, B.B - B.TP);
      ctx.restore();
      K.text(ctx, 'decoupling still works', B.L + 6, B.TP + 12, T.muted, 9, 'left');
      K.text(ctx, 'marker heights are drawn for legibility — they are NOT computed impedance',
             B.L + 6, B.TP + 24, T.reflect, 9, 'left');
      K.text(ctx, 'above here every capacitor is an inductor — you cannot short out a cavity with one',
             P.X(capLimit) + 8, B.TP + 12, T.reflect, 10, 'left');

      ms.forEach((mo, i) => {
        const x = P.X(mo.f);
        if (x > B.R) return;
        const h = i === 0 ? 0.86 : 0.62 - Math.min(0.32, i * 0.045);
        K.line(ctx, x, B.B, x, P.Y(h), i === 0 ? T.alarm : T.signal, i === 0 ? 2.5 : 1.6);
        K.dot(ctx, x, P.Y(h), i === 0 ? T.alarm : T.signal, T.surface, i === 0 ? 4.5 : 3);
        if (i < 6) {
          K.text(ctx, mo.m + ',' + mo.n, x, P.Y(h) - 11, i === 0 ? T.alarm : T.muted, 9, 'center');
          K.text(ctx, mo.f.toFixed(2), x, P.Y(h) - 22, i === 0 ? T.alarm : T.muted, 9, 'center');
        }
      });
      P.frame();

      $('[data-out="f1"]').textContent = (ms[0].f * 1000).toFixed(0) + ' MHz';
      $('[data-out="mode1"]').textContent = ms[0].m + ',' + ms[0].n;
      $('[data-out="count"]').textContent = ms.filter((x) => x.f < 2).length + ' below 2 GHz';
      $('#pr-a').value = p.a; $('#pr-a-out').value = p.a + ' mm';
      $('#pr-b').value = p.b; $('#pr-b-out').value = p.b + ' mm';
      $('#pr-dk').value = Math.round(p.dk * 10); $('#pr-dk-out').value = p.dk.toFixed(1);
    }
    const m = K.mount({ root, params: p, draw });
    bindAll(root, $, p, m, [['#pr-a', 'a'], ['#pr-b', 'b'], ['#pr-dk', 'dk', 0.1]]);
    wirePresets(root, $, p, m, PRESETS, 'board');
    m.render();
    return { start() {}, stop() {}, destroy() { m.teardown(); } };
  };

  /* ═══════════ PDN noise → jitter ═══════════
     ILLUSTRATIVE MODEL. Supply ripple displaces a clock edge through a delay
     sensitivity; a PLL corrects part of it depending on WHERE the noise enters.

       displacement = sensitivity [ps/V] x stages x ripple [V] x |H_inj(f)|

     The transfer term is the part that is usually got wrong. A single "PLL
     bandwidth" knob is not enough, because a first-order loop treats the three
     injection points oppositely:

       reference / input  |H| = 1 / sqrt(1 + (f/fc)^2)     low-pass: the loop
                                                           FOLLOWS slow reference
                                                           noise onto the output
       VCO, inside loop   |H| = (f/fc) / sqrt(1+(f/fc)^2)  high-pass: the loop
                                                           CORRECTS slow VCO noise
       buffer, outside    |H| = 1                          nothing corrects it

     The previous version applied the VCO case universally and called it "the PLL
     tracks it out", which is only true for one of the three. Single-pole
     approximations; a real loop has order, damping and peaking. See AD AN-143. */
  /* ---------- PSIJ as a pure model (M0-5b) ----------
     This was inside the closure, and the gate therefore could not reach it. What
     the gate had instead was two assertions that re-implemented the arithmetic
     locally and then compared it to itself:

         near('peak-to-peak is twice the peak', 2 * peak, 2 * peak, 1e-12);
         near('rms of a sinusoid is peak/2**0.5', peak / Math.SQRT2, peak * 0.70710678, 1e-6);

     The first is the `pk / pk` tautology again — an expression compared to
     itself, true for every input. The second only checks that a decimal literal
     matches a library constant. Neither touched this function, so the conversion
     the panel actually applies was never tested. Third occurrence of that shape
     in this codebase; see G-6. */
  const PSIJ_LOOP_FC = 4;                                 // MHz, first-order loop bandwidth
  const PSIJ_INJ = {
    buffer:    { label: 'output buffer (outside the loop)', H: () => 1 },
    vco:       { label: 'VCO (inside the loop)',
                 H: (f) => (f / PSIJ_LOOP_FC) / Math.hypot(1, f / PSIJ_LOOP_FC) },
    reference: { label: 'reference input',
                 H: (f) => 1 / Math.hypot(1, f / PSIJ_LOOP_FC) }
  };

  NS.models = NS.models || {};
  NS.models.psijInjections = PSIJ_INJ;
  NS.models.psij = function (p) {
    const H = PSIJ_INJ[p.inj].H(p.fnoise);
    const peak = p.sens * p.stages * (p.ripple / 1000) * H;
    return { peak, pkpk: 2 * peak, H, rms: peak / Math.SQRT2 };
  };

  NS.viz.pdnJitter = function (root) {
    const $ = (s) => root.querySelector(s);
    const cvA = $('[data-cv="ripple"]'), cvB = $('[data-cv="edge"]');
    const LOOP_FC = PSIJ_LOOP_FC;
    const INJ = PSIJ_INJ;

    const p = { ripple: 30, fnoise: 120, sens: 30, stages: 8, ui: 62.5, inj: 'vco' };
    const PRESETS = {
      firstdroop: { ripple: 30, fnoise: 120, sens: 30, stages: 8, inj: 'vco',
        note: 'The package-to-die anti-resonance at 120 MHz, entering at the VCO. Far above the loop bandwidth, so the loop corrects none of it.' },
      vrm:        { ripple: 30, fnoise: 1, sens: 30, stages: 8, inj: 'vco',
        note: 'Regulator switching at 1 MHz. Inside the loop bandwidth and entering at the VCO, so most of it IS corrected — note the same noise at the reference would not be.' },
      refnoise:   { ripple: 30, fnoise: 1, sens: 30, stages: 8, inj: 'reference',
        note: 'The same 1 MHz ripple, but entering at the reference. Now the loop follows it onto the output instead of removing it. Injection point decides the answer.' },
      outside:    { ripple: 30, fnoise: 120, sens: 30, stages: 8, inj: 'buffer',
        note: 'Noise on an output buffer, downstream of the loop. No feedback path reaches it, so nothing is corrected at any frequency.' },
      sensitive:  { ripple: 30, fnoise: 120, sens: 60, stages: 14, inj: 'vco',
        note: 'A longer, more sensitive clock tree. Same supply noise, roughly three times the displacement.' }
    };

    /* peak displacement, in ps. Ripple is quoted as a peak amplitude, so the
       peak-to-peak excursion an edge can see is twice this. */
    function psij() { return NS.models.psij(p); }

    /* ---- view A: the supply, over three periods of the ripple ---- */
    function drawRipple(T) {
      const s = K.canvas(cvA, 210);
      const period = 1e6 / p.fnoise;                      // MHz -> ps.  THIS was 1000.
      const tMax = 3 * period;
      const amp = Math.max(p.ripple / 1000, 0.002) * 1.35;
      const P = K.plot(s, T, {
        pad: { l: 56, r: 16, t: 18, b: 30 },
        x: { min: 0, max: tMax, count: 6,
             fmt: (v) => tMax > 2e4 ? (v / 1000).toFixed(0) : (v / 1000).toFixed(1),
             title: 'ns' },
        y: { min: -amp, max: amp, count: 5, fmt: (v) => (v * 1000).toFixed(0), title: 'mV' }
      }).grid();
      const sup = [];
      for (let i = 0; i <= 600; i++) {
        const t = (i / 600) * tMax;
        sup.push([t, (p.ripple / 1000) * Math.sin(2 * Math.PI * t / period)]);
      }
      P.trace(sup, T.reflect, { width: 2, glow: true });
      const ctx = s.ctx;
      P.hline(p.ripple / 1000, T.muted, [3, 3], '+peak');
      P.hline(-p.ripple / 1000, T.muted, [3, 3], '−peak');
      K.text(ctx, 'one UI is ' + p.ui.toFixed(1) + ' ps — ' +
             (period / p.ui).toFixed(0) + ' UI fit in one ripple cycle',
             P.box.L + 8, P.box.TP + 12, T.muted, 10, 'left');
      P.frame();
    }

    /* ---- view B: the edge, magnified to picoseconds ----
       A separate axis is not a convenience. At 120 MHz the ripple period is
       ~133 UI, so on view A's scale the displacement is far under one pixel. */
    function drawEdge(T) {
      const s = K.canvas(cvB, 210);
      const R = psij();
      const span = Math.max(R.pkpk * 1.8, 4);             // ps, always shows something
      const P = K.plot(s, T, {
        pad: { l: 56, r: 16, t: 18, b: 30 },
        x: { min: -span / 2, max: span / 2, count: 5, fmt: (v) => v.toFixed(1), title: 'ps from nominal' },
        y: { min: -0.1, max: 1.1, ticks: [0, 0.5, 1], fmt: (v) => v.toFixed(1), title: 'V' }
      }).grid();
      const ctx = s.ctx;
      const edge = (shift, colour, width, dash) => {
        const pts = [];
        for (let i = 0; i <= 200; i++) {
          const t = -span / 2 + (i / 200) * span;
          const u = (t - shift) / (span * 0.18);
          pts.push([t, 0.5 + 0.5 * Math.tanh(u)]);
        }
        P.trace(pts, colour, { width, dash });
      };
      edge(0, T.muted, 1.4, [4, 3]);
      edge(+R.peak, T.signal, 2, null);
      edge(-R.peak, T.signal, 2, null);
      P.vline(0, T.muted, [2, 3]);
      const y = P.Y(0.5);
      K.line(ctx, P.X(-R.peak), y, P.X(R.peak), y, T.alarm, 2);
      K.text(ctx, 'pk-pk ' + R.pkpk.toFixed(2) + ' ps', P.X(0), y - 12, T.alarm, 11, 'center');
      K.text(ctx, 'nominal edge', P.X(0) + 6, P.box.TP + 12, T.muted, 10, 'left');
      K.text(ctx, 'at ripple peak / trough', P.box.L + 8, P.box.B - 10, T.signal, 10, 'left');
      P.frame();
    }

    function draw(T) {
      drawRipple(T); drawEdge(T);
      const R = psij();
      $('[data-out="pj"]').textContent = R.pkpk.toFixed(2) + ' ps pk-pk';
      const e = $('[data-out="pjui"]');
      const frac = R.pkpk / p.ui;
      e.textContent = (frac * 100).toFixed(1) + '% of UI';
      e.style.color = frac > 0.05 ? 'var(--alarm-text)' : 'var(--ink)';
      $('[data-out="rms"]').textContent = R.rms.toFixed(2) + ' ps rms';
      $('[data-out="tracked"]').textContent = (100 * (1 - R.H)).toFixed(0) + '% removed by the loop';
      $('[data-out="fn"]').textContent = p.fnoise < 1000 ? p.fnoise + ' MHz' : (p.fnoise / 1000) + ' GHz';
      $('#pj-rip').value = p.ripple; $('#pj-rip-out').value = p.ripple + ' mV peak';
      $('#pj-f').value = p.fnoise; $('#pj-f-out').value = p.fnoise + ' MHz';
      $('#pj-s').value = p.sens; $('#pj-s-out').value = p.sens + ' ps/V';
      $('#pj-n').value = p.stages; $('#pj-n-out').value = p.stages + ' stages';
      $('#pj-inj').value = p.inj;
    }
    const m = K.mount({ root, params: p, draw });
    bindAll(root, $, p, m, [['#pj-rip', 'ripple'], ['#pj-f', 'fnoise'], ['#pj-s', 'sens'], ['#pj-n', 'stages']]);
    $('#pj-inj').addEventListener('change', (e) => {
      p.inj = e.target.value;
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      $('[data-out="note"]').textContent = 'Custom · ' + INJ[p.inj].label;
      m.render();
    });
    wirePresets(root, $, p, m, PRESETS, 'firstdroop');
    m.render();
    return { start() {}, stop() {}, destroy() { m.teardown(); } };
  };
})();
