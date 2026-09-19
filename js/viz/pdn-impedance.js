/* SI & PI — viz/pdn-impedance.js
 * PDN impedance vs frequency: add capacitors and watch anti-resonance appear.
 *
 * Exact, not fitted. Every branch is a series RLC evaluated at each frequency:
 *     Z(f) = ESR + j( 2πf·ESL − 1/(2πf·C) )
 * and the network is the parallel combination of the branches:
 *     Z_total = 1 / Σ (1/Z_i)
 * n identical capacitors in parallel divide that branch's impedance by n, which is
 * the assumption the page calls out as optimistic — real mountings share current paths.
 * The peak readout is a numerical maximum of that exact expression, not an estimate.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';

  // 1 kHz – 100 MHz. The upper bound is deliberate: a lumped board-level model is
  // honest to roughly here. Above it a plane behaves as a distributed cavity rather
  // than one RLC — lumping it invents a high-Q resonance that isn't physically there —
  // and package inductance has taken over anyway, which is the point the page makes.
  const F_LO = 1e3, F_HI = 1e8, NF = 420;
  const FREQ = [];
  for (let i = 0; i < NF; i++) FREQ.push(F_LO * Math.pow(F_HI / F_LO, i / (NF - 1)));

  /* ---------- theme ---------- */
  let T = null;
  function readTheme(el) {
    const cs = getComputedStyle(el), g = (n) => cs.getPropertyValue(n).trim();
    T = { ink: g('--ink'), ink2: g('--ink-2'), muted: g('--muted'),
          signal: g('--signal'), reflect: g('--reflect'), alarm: g('--alarm'),
          grid: g('--grid'), border: g('--border'), surface: g('--surface'), glow: g('--glow') };
    return T;
  }

  /* ---------- model ---------- */
  // A branch is { C, esr, esl, n, on, label, colour }. n>1 means n in parallel.
  function branches(p) {
    const b = [];
    // The regulator: resistive at DC, inductive above its loop bandwidth, so it
    // hands off to the capacitors somewhere in the tens of kilohertz.
    b.push({ vrm: true, r: 0.0012, l: 500e-9, on: true, label: 'VRM' });
    b.push({ C: 100e-6, esr: 0.010 * p.esrScale, esl: 2.0e-9, n: 2, on: true, label: 'bulk 100 µF ×2' });
    b.push({ C: 1e-6, esr: 0.005 * p.esrScale, esl: p.esl, n: 4, on: p.useMid, label: '1 µF ×4' });
    b.push({ C: 100e-9, esr: 0.008 * p.esrScale, esl: p.esl, n: p.nSmall, on: p.nSmall > 0, label: '100 nF' });
    // Plane-pair capacitance: tiny, but almost inductance-free, so it is the only
    // thing still working above a few hundred megahertz.
    b.push({ C: 10e-9, esr: 0.002, esl: 40e-12, n: 1, on: p.usePlane, label: 'plane pair' });
    return b;
  }

  function zBranch(br, f) {
    const w = 2 * Math.PI * f;
    if (br.vrm) return { re: br.r, im: w * br.l };
    const re = br.esr / br.n;
    const im = (w * br.esl - 1 / (w * br.C)) / br.n;
    return { re, im };
  }

  function zTotal(bs, f) {
    let gRe = 0, gIm = 0;                       // sum of admittances
    for (const br of bs) {
      if (!br.on) continue;
      const z = zBranch(br, f);
      const d = z.re * z.re + z.im * z.im;
      if (d === 0) continue;
      gRe += z.re / d;
      gIm += -z.im / d;
    }
    const d = gRe * gRe + gIm * gIm;
    if (d === 0) return Infinity;
    return Math.hypot(gRe / d, -gIm / d);
  }

  function curve(bs) { return FREQ.map((f) => zTotal(bs, f)); }

  function srf(C, L) { return 1 / (2 * Math.PI * Math.sqrt(C * L)); }

  /* Largest local maximum above the bulk handoff — the anti-resonance the page is about.
     A local max is used rather than a global one because |Z| rises monotonically at the
     top of the band once every branch is inductive, and that rise is not a resonance. */
  function findPeak(zs) {
    let best = null;
    for (let i = 1; i < NF - 1; i++) {
      if (FREQ[i] < 1e5) continue;
      if (zs[i] > zs[i - 1] && zs[i] >= zs[i + 1] && (!best || zs[i] > best.z)) {
        best = { z: zs[i], f: FREQ[i] };
      }
    }
    return best;
  }

  /* ---------- canvas ---------- */
  function fit(cv, hCss) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const wCss = cv.clientWidth || cv.parentNode.clientWidth || 320;
    cv.width = Math.round(wCss * dpr);
    cv.height = Math.round(hCss * dpr);
    cv.style.height = hCss + 'px';
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: wCss, h: hCss };
  }
  function line(ctx, x1, y1, x2, y2, c, lw, dash) {
    ctx.save(); ctx.strokeStyle = c; ctx.lineWidth = lw || 1; ctx.setLineDash(dash || []);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
  }
  function label(ctx, t, x, y, c, size, align, baseline) {
    ctx.save(); ctx.fillStyle = c; ctx.font = (size || 10) + 'px ' + MONO;
    ctx.textAlign = align || 'left'; ctx.textBaseline = baseline || 'middle';
    ctx.fillText(t, x, y); ctx.restore();
  }
  function fmtHz(f) {
    if (f >= 1e9) return (f / 1e9).toFixed(f < 1e10 ? 1 : 0) + ' GHz';
    if (f >= 1e6) return (f / 1e6).toFixed(f < 1e7 ? 1 : 0) + ' MHz';
    if (f >= 1e3) return (f / 1e3).toFixed(f < 1e4 ? 1 : 0) + ' kHz';
    return f.toFixed(0) + ' Hz';
  }
  function fmtOhm(z) {
    if (z >= 1) return z.toFixed(2) + ' Ω';
    if (z >= 1e-3) return (z * 1e3).toFixed(z < 1e-2 ? 2 : 1) + ' mΩ';
    return (z * 1e6).toFixed(0) + ' µΩ';
  }

  /* ---------- draw ---------- */
  function draw(cv, p, bs, zs, peak, reveal) {
    const { ctx, w, h } = fit(cv, 300);
    ctx.clearRect(0, 0, w, h);
    const L = 56, R = w - 14, TP = 18, B = h - 34;

    const Z_LO = 1e-4, Z_HI = 1;
    const X = (f) => L + (Math.log10(f) - Math.log10(F_LO)) / (Math.log10(F_HI) - Math.log10(F_LO)) * (R - L);
    const Y = (z) => B - (Math.log10(Math.max(z, Z_LO)) - Math.log10(Z_LO)) / (Math.log10(Z_HI) - Math.log10(Z_LO)) * (B - TP);

    // decade grid, with minor lines so the log axis reads as log
    for (let d = 3; d <= 8; d++) {
      const x = X(Math.pow(10, d));
      line(ctx, x, TP, x, B, T.grid, 1);
      label(ctx, fmtHz(Math.pow(10, d)), x, B + 13, T.muted, 10, 'center');
      for (let m = 2; m < 10 && d < 8; m++) {
        const xm = X(m * Math.pow(10, d));
        if (xm < R) line(ctx, xm, TP, xm, B, T.grid, 0.4);
      }
    }
    for (let d = -4; d <= 0; d++) {
      const z = Math.pow(10, d), y = Y(z);
      line(ctx, L, y, R, y, T.grid, 1);
      label(ctx, fmtOhm(z), L - 8, y, T.muted, 10, 'right');
    }

    // target impedance
    const yT = Y(p.zTarget);
    line(ctx, L, yT, R, yT, T.muted, 1, [4, 4]);
    label(ctx, 'Z target ' + fmtOhm(p.zTarget), R - 2, yT - 9, T.muted, 10, 'right');

    // individual branches, faint — identity carried by the direct label, not colour
    if (p.showBranches) {
      for (const br of bs) {
        if (!br.on || br.vrm) continue;
        ctx.save();
        ctx.strokeStyle = T.muted; ctx.lineWidth = 1; ctx.globalAlpha = 0.42;
        ctx.setLineDash([3, 3]); ctx.beginPath();
        for (let i = 0; i < NF; i++) {
          const z = zBranch(br, FREQ[i]);
          const y = Y(Math.hypot(z.re, z.im));
          i ? ctx.lineTo(X(FREQ[i]), y) : ctx.moveTo(X(FREQ[i]), y);
        }
        ctx.stroke(); ctx.restore();
      }
    }

    // total impedance
    const upto = Math.max(2, Math.round(NF * reveal));
    ctx.save();
    ctx.strokeStyle = T.signal; ctx.lineWidth = 2.2; ctx.lineJoin = 'round';
    ctx.shadowColor = T.glow; ctx.shadowBlur = 8;
    ctx.beginPath();
    for (let i = 0; i < upto; i++) {
      const y = Y(zs[i]);
      i ? ctx.lineTo(X(FREQ[i]), y) : ctx.moveTo(X(FREQ[i]), y);
    }
    ctx.stroke(); ctx.restore();

    // the anti-resonance
    if (peak && reveal >= 0.999) {
      const px = X(peak.f), py = Y(peak.z);
      const over = peak.z > p.zTarget;
      const c = over ? T.alarm : T.reflect;
      line(ctx, px, py, px, yT, c, 1, [2, 3]);
      ctx.save();
      ctx.fillStyle = c; ctx.strokeStyle = T.surface; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
      const txt = (over ? '▲ ' : '') + fmtOhm(peak.z) + ' @ ' + fmtHz(peak.f);
      label(ctx, txt, Math.min(px + 8, R - 4), py - 10,
            c, 10, px > (L + R) / 2 ? 'right' : 'left');
    }

    line(ctx, L, TP, L, B, T.border, 1);
    line(ctx, L, B, R, B, T.border, 1);
    label(ctx, '|Z|', 14, TP + 4, T.muted, 10, 'left');
    label(ctx, 'frequency', R - 2, B + 26, T.muted, 10, 'right');
  }

  /* ---------- component ---------- */
  NS.viz.pdnImpedance = function (root) {
    const $ = (s) => root.querySelector(s);
    const cv = $('[data-cv="zplot"]');
    const btn = $('[data-act="play"]');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const p = { nSmall: 8, esl: 1.2e-9, esrScale: 1, useMid: true, usePlane: true,
                showBranches: true, zTarget: 0.02 };

    const PRESETS = {
      one:     { nSmall: 12, useMid: false, esrScale: 1,    esl: 1.2e-9, note: 'Bulk and 100 nF only. Removing a value does not remove the peak — it widens the gap the bulk has to bridge, and the peak gets worse.' },
      two:     { nSmall: 8,  useMid: true,  esrScale: 1,    esl: 1.2e-9, note: 'A 1 µF bank between them. Here it helps — but note there are now two anti-resonances instead of one.' },
      lowesr:  { nSmall: 8,  useMid: true,  esrScale: 0.25, esl: 1.2e-9, note: 'Same caps, a quarter the ESR. The floor drops and the peak grows about four times: Q is set by resistance.' },
      damped:  { nSmall: 8,  useMid: true,  esrScale: 3,    esl: 1.2e-9, note: 'Three times the ESR, peak down to a third. Lossier parts are sometimes the cheapest fix there is.' },
      badmount:{ nSmall: 8,  useMid: true,  esrScale: 1,    esl: 2.4e-9, note: 'Same parts, twice the mounting inductance. Every SRF drops by √2 and the whole high-frequency floor rises.' }
    };

    let bs = branches(p), zs = curve(bs), peak = findPeak(zs);
    let reveal = 1, raf = 0, playing = false, last = 0;

    function sync() {
      bs = branches(p); zs = curve(bs); peak = findPeak(zs);
      $('#pdn-n').value = p.nSmall;
      $('#pdn-n-out').value = p.nSmall + ' × 100 nF';
      $('#pdn-esl').value = Math.round(p.esl * 1e12);
      $('#pdn-esl-out').value = (p.esl * 1e9).toFixed(2) + ' nH';
      $('#pdn-esr').value = Math.round(p.esrScale * 100);
      $('#pdn-esr-out').value = p.esrScale.toFixed(2) + '×';
      $('#pdn-mid').checked = p.useMid;
      $('#pdn-branches').checked = p.showBranches;

      $('[data-out="peak"]').textContent = peak ? fmtOhm(peak.z) : '—';
      $('[data-out="fpeak"]').textContent = peak ? fmtHz(peak.f) : 'none';
      $('[data-out="srf"]').textContent = fmtHz(srf(100e-9, p.esl));
      const el = $('[data-out="peak"]');
      el.style.color = peak && peak.z > p.zTarget ? 'var(--alarm-text)' : 'var(--ink)';
      render();
    }
    function render() {
      if (!T) readTheme(root);
      draw(cv, p, bs, zs, peak, reveal);
    }

    function frame(ts) {
      if (!playing) return;
      const dt = Math.min(64, ts - (last || ts)); last = ts;
      reveal += dt / 1300;
      if (reveal >= 1) { reveal = 1; stop(); render(); return; }
      render();
      raf = requestAnimationFrame(frame);
    }
    function play() {
      if (playing || reduce) { reveal = 1; render(); return; }
      reveal = 0; playing = true; last = 0;
      btn.setAttribute('aria-pressed', 'true');
      raf = requestAnimationFrame(frame);
    }
    function stop() {
      playing = false; cancelAnimationFrame(raf);
      btn.setAttribute('aria-pressed', 'false');
    }

    function clearPreset() {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      $('[data-out="note"]').textContent = 'Custom';
    }
    $('#pdn-n').addEventListener('input', (e) => { p.nSmall = +e.target.value; clearPreset(); sync(); });
    $('#pdn-esl').addEventListener('input', (e) => { p.esl = +e.target.value * 1e-12; clearPreset(); sync(); });
    $('#pdn-esr').addEventListener('input', (e) => { p.esrScale = +e.target.value / 100; clearPreset(); sync(); });
    $('#pdn-mid').addEventListener('change', (e) => { p.useMid = e.target.checked; clearPreset(); sync(); });
    $('#pdn-branches').addEventListener('change', (e) => { p.showBranches = e.target.checked; render(); });
    btn.addEventListener('click', () => (playing ? (stop(), reveal = 1, render()) : play()));

    root.querySelectorAll('.preset[data-preset]').forEach((b) => {
      b.addEventListener('click', () => {
        const cfg = PRESETS[b.dataset.preset];
        Object.assign(p, { nSmall: cfg.nSmall, useMid: cfg.useMid, esrScale: cfg.esrScale, esl: cfg.esl });
        root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
        sync();
        $('[data-out="note"]').textContent = cfg.note;
        if (!reduce) play();
      });
    });

    const onTheme = () => { readTheme(root); render(); };
    window.addEventListener('sipi:theme', onTheme);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', onTheme);
    let rt = 0;
    const onResize = () => { clearTimeout(rt); rt = setTimeout(render, 90); };
    window.addEventListener('resize', onResize);

    readTheme(root);
    sync();
    root.querySelector('.preset[data-preset="two"]').setAttribute('aria-pressed', 'true');
    $('[data-out="note"]').textContent = PRESETS.two.note;

    return {
      start() { if (!reduce && reveal >= 1) play(); },
      stop() { stop(); reveal = 1; render(); },
      destroy() {
        stop();
        window.removeEventListener('sipi:theme', onTheme);
        window.removeEventListener('resize', onResize);
      }
    };
  };
})();
