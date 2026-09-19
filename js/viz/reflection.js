/* SI & PI — viz/reflection.js
 * Transmission-line reflections: a 1 V step launched into a 3-inch stripline.
 *
 * Physics is exact for a lossless line, by superposition of launched waves:
 *   forward wave m   launched at t = 2m·Td   from x=0,  amplitude a0·(ΓL·Γs)^m
 *   backward wave m  launched at t = (2m+1)·Td from x=L, amplitude a0·ΓL·(ΓL·Γs)^m
 * with a0 = Vs·Z0/(Rs+Z0). Each wave is a raised-cosine step of width tr.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });

  const TD = 500;          // ps — one-way delay of a 3-inch stripline (~170 ps/in)
  const LEN_IN = 3;        // inches
  const VS = 1.0;          // V step amplitude
  const TMAX = 8 * TD;     // ps — show four round trips
  const NWAVE = 7;

  const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';

  /* ---------- theme ---------- */
  let T = null;
  function readTheme(el) {
    const cs = getComputedStyle(el);
    const g = (n) => cs.getPropertyValue(n).trim();
    T = {
      ink: g('--ink'), ink2: g('--ink-2'), muted: g('--muted'),
      signal: g('--signal'), reflect: g('--reflect'), alarm: g('--alarm'),
      grid: g('--grid'), border: g('--border'), surface: g('--surface'),
      glow: g('--glow')
    };
    return T;
  }

  /* ---------- math ----------
     The wave superposition lives in the kit as K.line1D. It is taught on this
     page, in Lab A and in the termination pages, and three copies of it would
     drift — the current sign in particular, which is the one thing a second
     implementation tends to get wrong. */
  const smoothStep = (u, tr) => NS.kit.smoothStep(u, tr);

  function model(p) {
    return NS.kit.line1D({
      Z0: p.Z0, Rs: p.Rs, RL: p.RL, open: p.open,
      tr: p.tr, td: TD, vs: VS, nWave: NWAVE
    });
  }

  // xn in [0,1] along the line; t in ps
  const vAt = (M, xn, t) => NS.kit.line1DAt(M, xn, t);

  function vRange(M) {
    let lo = 0, hi = M.vFinal;
    for (let i = 0; i <= 400; i++) {
      const t = (i / 400) * TMAX;
      for (const xn of [0, 1]) {
        const v = vAt(M, xn, t).v;
        if (v < lo) lo = v; if (v > hi) hi = v;
      }
    }
    const pad = Math.max(0.12, (hi - lo) * 0.16);
    return { lo: lo - pad, hi: hi + pad };
  }

  /* ---------- canvas helpers ---------- */
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
  function clear(ctx, w, h) { ctx.clearRect(0, 0, w, h); }
  function line(ctx, x1, y1, x2, y2, color, width, dash) {
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = width || 1;
    ctx.setLineDash(dash || []);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.restore();
  }
  function label(ctx, text, x, y, color, size, align, baseline) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = (size || 10) + 'px ' + MONO;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = baseline || 'middle';
    ctx.fillText(text, x, y);
    ctx.restore();
  }
  function vTicks(lo, hi) {
    const span = hi - lo;
    const step = span > 2.4 ? 0.5 : span > 1.1 ? 0.25 : 0.1;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(Math.round(v * 1000) / 1000);
    return out;
  }

  /* ---------- panel 1: voltage along the line ---------- */
  function drawLine(cv, M, rng, t) {
    const { ctx, w, h } = fit(cv, 210);
    clear(ctx, w, h);
    const L = 46, R = w - 14, TP = 16, B = h - 30;
    const X = (xn) => L + xn * (R - L);
    const Y = (v) => B - ((v - rng.lo) / (rng.hi - rng.lo)) * (B - TP);

    for (const v of vTicks(rng.lo, rng.hi)) {
      const y = Y(v);
      line(ctx, L, y, R, y, T.grid, 1);
      label(ctx, v.toFixed(2), L - 8, y, T.muted, 10, 'right');
    }
    line(ctx, L, Y(0), R, Y(0), T.border, 1);
    for (let i = 0; i <= LEN_IN; i++) {
      const x = X(i / LEN_IN);
      line(ctx, x, TP, x, B, T.grid, 1);
      label(ctx, i + '"', x, B + 12, T.muted, 10, 'center');
    }
    line(ctx, L, Y(M.vFinal), R, Y(M.vFinal), T.muted, 1, [3, 4]);
    label(ctx, 'settles → ' + M.vFinal.toFixed(2) + ' V', R - 2, Y(M.vFinal) - 9, T.muted, 10, 'right');

    const N = 260;
    const trace = (pick, color, width, dash, glow) => {
      ctx.save();
      ctx.strokeStyle = color; ctx.lineWidth = width;
      ctx.setLineDash(dash || []);
      ctx.lineJoin = 'round';
      if (glow) { ctx.shadowColor = T.glow; ctx.shadowBlur = 9; }
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const xn = i / N, y = Y(pick(vAt(M, xn, t)));
        i ? ctx.lineTo(X(xn), y) : ctx.moveTo(X(xn), y);
      }
      ctx.stroke(); ctx.restore();
    };
    trace((o) => o.f, T.signal, 1.25, [4, 4]);
    trace((o) => o.b, T.reflect, 1.25, [4, 4]);
    trace((o) => o.v, T.signal, 2, null, true);

    line(ctx, L, TP, L, B, T.border, 1);
    line(ctx, R, TP, R, B, T.border, 1);
    label(ctx, 'DRIVER', L + 4, TP + 6, T.muted, 9, 'left');
    label(ctx, M.open ? 'OPEN' : 'LOAD', R - 4, TP + 6, T.muted, 9, 'right');
    label(ctx, 'V', 12, TP + 4, T.muted, 10, 'left');
    label(ctx, 't = ' + Math.round(t) + ' ps', R - 2, B - 6, T.ink2, 10, 'right');
  }

  /* ---------- panel 2: voltage vs time at each end ---------- */
  function drawScope(cv, M, rng, t) {
    const { ctx, w, h } = fit(cv, 230);
    clear(ctx, w, h);
    const L = 46, R = w - 68, TP = 16, B = h - 30;
    const X = (ps) => L + (ps / TMAX) * (R - L);
    const Y = (v) => B - ((v - rng.lo) / (rng.hi - rng.lo)) * (B - TP);

    for (const v of vTicks(rng.lo, rng.hi)) {
      const y = Y(v);
      line(ctx, L, y, R, y, T.grid, 1);
      label(ctx, v.toFixed(2), L - 8, y, T.muted, 10, 'right');
    }
    line(ctx, L, Y(0), R, Y(0), T.border, 1);
    for (let k = 0; k <= 8; k += 2) {
      const x = X(k * TD);
      line(ctx, x, TP, x, B, T.grid, 1);
      label(ctx, k + ' Td', x, B + 12, T.muted, 10, 'center');
      label(ctx, (k * TD / 1000).toFixed(1) + ' ns', x, B + 24, T.muted, 9, 'center');
    }
    line(ctx, L, Y(M.vFinal), R, Y(M.vFinal), T.muted, 1, [3, 4]);

    const N = 420;
    const sweep = (xn, color) => {
      ctx.save();
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round';
      ctx.shadowColor = T.glow; ctx.shadowBlur = 7;
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const ps = (i / N) * TMAX, y = Y(vAt(M, xn, ps).v);
        i ? ctx.lineTo(X(ps), y) : ctx.moveTo(X(ps), y);
      }
      ctx.stroke(); ctx.restore();
    };
    sweep(1, T.signal);
    sweep(0, T.reflect);

    // direct labels — identity never rests on colour alone
    label(ctx, 'at load', R + 4, Y(vAt(M, 1, TMAX).v), T.signal, 10, 'left');
    label(ctx, 'at driver', R + 4, Y(vAt(M, 0, TMAX).v), T.reflect, 10, 'left');

    const px = X(t);
    line(ctx, px, TP, px, B, T.ink2, 1, [2, 3]);
    for (const [xn, color] of [[1, T.signal], [0, T.reflect]]) {
      const y = Y(vAt(M, xn, t).v);
      ctx.save();
      ctx.fillStyle = color; ctx.strokeStyle = T.surface; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, y, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    label(ctx, 'V', 12, TP + 4, T.muted, 10, 'left');
  }

  /* ---------- panel 3: bounce (lattice) diagram ---------- */
  function drawLattice(cv, M, t) {
    const { ctx, w, h } = fit(cv, 230);
    clear(ctx, w, h);
    const L = 46, R = w - 16, TP = 26, B = h - 16;
    const X = (xn) => L + xn * (R - L);
    const Y = (ps) => TP + (ps / TMAX) * (B - TP);

    line(ctx, L, TP, L, B, T.border, 1);
    line(ctx, R, TP, R, B, T.border, 1);
    label(ctx, 'driver', L, TP - 12, T.muted, 10, 'left');
    label(ctx, M.open ? 'open' : 'load', R, TP - 12, T.muted, 10, 'right');
    for (let k = 0; k <= 8; k++) {
      const y = Y(k * TD);
      line(ctx, L, y, R, y, T.grid, 1);
      if (k % 2 === 0) label(ctx, k + ' Td', L - 8, y, T.muted, 10, 'right');
    }

    for (let m = 0; m < NWAVE; m++) {
      const segs = [
        { t0: M.fwd[m].t0, a: M.fwd[m].a, x0: 0, x1: 1, c: T.signal },
        { t0: M.bwd[m].t0, a: M.bwd[m].a, x0: 1, x1: 0, c: T.reflect }
      ];
      for (const s of segs) {
        if (s.t0 >= TMAX || Math.abs(s.a) < 0.004) continue;
        const y0 = Y(s.t0), y1 = Y(Math.min(s.t0 + TD, TMAX));
        const x1 = s.x0 + (s.x1 - s.x0) * ((Math.min(s.t0 + TD, TMAX) - s.t0) / TD);
        const done = t >= s.t0;
        ctx.save();
        ctx.globalAlpha = done ? 1 : 0.28;
        line(ctx, X(s.x0), y0, X(x1), y1, s.c, done ? 2 : 1.25);
        ctx.restore();
        const mx = (X(s.x0) + X(x1)) / 2, my = (y0 + y1) / 2;
        const txt = (s.a >= 0 ? '+' : '−') + Math.abs(s.a * 1000).toFixed(0) + ' mV';
        ctx.save();
        ctx.globalAlpha = done ? 1 : 0.35;
        ctx.font = '9px ' + MONO;
        const tw = ctx.measureText(txt).width;
        ctx.fillStyle = T.surface;
        ctx.fillRect(mx - tw / 2 - 3, my - 7, tw + 6, 13);
        ctx.restore();
        label(ctx, txt, mx, my, done ? T.ink2 : T.muted, 9, 'center');
      }
    }
    const py = Y(t);
    line(ctx, L, py, R, py, T.ink2, 1, [2, 3]);
  }

  /* ---------- component ---------- */
  NS.viz.reflection = function (root) {
    const $ = (s) => root.querySelector(s);
    const cvLine = $('[data-cv="line"]'), cvScope = $('[data-cv="scope"]'), cvLat = $('[data-cv="lattice"]');
    const btnPlay = $('[data-act="play"]');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const p = { Z0: 50, Rs: 10, RL: 50, open: true, tr: 80 };
    let M = model(p), rng = vRange(M);
    let t = reduce ? TMAX : 0, playing = false, raf = 0, last = 0, hold = 0;

    const PRESETS = {
      unterminated: { Rs: 10, RL: 50, open: true, note: 'Fast driver, nothing at the far end.' },
      series:       { Rs: 50, RL: 50, open: true, note: 'Rs raised to Z0 — the reflection comes back once and stops.' },
      parallel:     { Rs: 10, RL: 50, open: false, note: 'Z0 to ground at the load — nothing reflects at all.' },
      short:        { Rs: 10, RL: 0,  open: false, note: 'Dead short: ΓL = −1, the wave comes back inverted.' },
      mismatch:     { Rs: 20, RL: 75, open: false, note: 'A common real case — partial reflection at both ends.' }
    };

    function fmt(x, n) { return (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(n === undefined ? 2 : n); }

    function syncReadout() {
      const peak = (() => { let hi = 0; for (let i = 0; i <= 300; i++) { const v = vAt(M, 1, (i / 300) * TMAX).v; if (v > hi) hi = v; } return hi; })();
      const over = M.vFinal > 0.001 ? ((peak - M.vFinal) / M.vFinal) * 100 : 0;
      $('[data-out="gs"]').textContent = fmt(M.GS);
      $('[data-out="gl"]').textContent = fmt(M.GL);
      $('[data-out="a0"]').textContent = (M.a0 * 1000).toFixed(0) + ' mV';
      $('[data-out="over"]').textContent = over.toFixed(0) + '%';
      const ov = $('[data-out="over"]');
      ov.style.color = over > 10 ? 'var(--alarm-text)' : 'var(--ink)';
    }

    function rebuild() {
      M = model(p); rng = vRange(M);
      $('#rf-rs').value = p.Rs; $('#rf-rs-out').value = p.Rs + ' Ω';
      $('#rf-z0').value = p.Z0; $('#rf-z0-out').value = p.Z0 + ' Ω';
      $('#rf-rl').value = p.RL; $('#rf-rl-out').value = p.open ? '∞ (open)' : p.RL + ' Ω';
      $('#rf-rl').disabled = p.open;
      $('#rf-open').checked = p.open;
      $('#rf-tr').value = p.tr; $('#rf-tr-out').value = p.tr + ' ps';
      syncReadout();
      if (!playing) $('[data-out="event"]').textContent = describe(ev) + ' · t = ' + ev + ' Td';
      draw();
    }

    function draw() {
      if (!T) readTheme(root);
      drawLine(cvLine, M, rng, t);
      drawScope(cvScope, M, rng, t);
      drawLattice(cvLat, M, t);
    }

    function frame(ts) {
      if (!playing) return;
      const dt = Math.min(64, ts - (last || ts)); last = ts;
      if (hold > 0) { hold -= dt; } else {
        t += dt * (TMAX / 3400);
        if (t >= TMAX) { t = TMAX; hold = 700; }
      }
      if (hold > 0 && t >= TMAX && hold <= 40) t = 0;
      draw();
      raf = requestAnimationFrame(frame);
    }
    function play() {
      if (playing) return;
      if (t >= TMAX) t = 0;
      playing = true; last = 0; hold = 0;
      btnPlay.textContent = '❚❚ Pause';
      btnPlay.setAttribute('aria-pressed', 'true');
      raf = requestAnimationFrame(frame);
    }
    function pause() {
      playing = false; cancelAnimationFrame(raf);
      btnPlay.textContent = '▶ Play';
      btnPlay.setAttribute('aria-pressed', 'false');
    }

    /* controls */
    $('#rf-rs').addEventListener('input', (e) => { p.Rs = +e.target.value; clearPreset(); rebuild(); });
    $('#rf-z0').addEventListener('input', (e) => { p.Z0 = +e.target.value; clearPreset(); rebuild(); });
    $('#rf-rl').addEventListener('input', (e) => { p.RL = +e.target.value; clearPreset(); rebuild(); });
    $('#rf-tr').addEventListener('input', (e) => { p.tr = +e.target.value; rebuild(); });
    $('#rf-open').addEventListener('change', (e) => { p.open = e.target.checked; clearPreset(); rebuild(); });
    btnPlay.addEventListener('click', () => (playing ? pause() : play()));

    /* ---------- event stepping ----------
       The interesting instants on this panel are not evenly spaced frames, they
       are the boundary crossings: every Td the wave arrives somewhere and a
       reflection coefficient decides what happens next. Stepping lands exactly on
       those, which is the difference between watching an animation and reading a
       lattice diagram. The description is computed, not written down, so it stays
       true when the reader changes the terminations. */
    const EVENTS = 8;                       // TMAX is 8·TD — four round trips
    let ev = 0;
    function describe(k) {
      if (k === 0) return 'edge launched at the driver · a₀ = ' + (M.a0 * 1000).toFixed(0) + ' mV';
      const bounces = Math.floor((k - 1) / 2);
      const amp = M.a0 * Math.pow(M.GL * M.GS, bounces) * (k % 2 ? 1 : M.GL);
      const at = k % 2 ? 'load' : 'driver';
      const G = k % 2 ? M.GL : M.GS;
      return 'arrives at the ' + at + ' · Γ' + (k % 2 ? 'L' : 's') + ' = ' + fmt(G)
        + ' · reflects ' + fmt(amp * G * 1000, 0) + ' mV';
    }
    function stepTo(k) {
      pause();
      ev = Math.max(0, Math.min(EVENTS, k));
      t = (ev / EVENTS) * TMAX;
      $('[data-out="event"]').textContent = describe(ev) + ' · t = ' + ev + ' Td';
      draw();
    }
    $('[data-act="prev"]').addEventListener('click', () => stepTo(ev - 1));
    $('[data-act="next"]').addEventListener('click', () => stepTo(ev + 1));

    function clearPreset() {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      $('[data-out="note"]').textContent = 'Custom';
    }
    root.querySelectorAll('.preset[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cfg = PRESETS[btn.dataset.preset];
        Object.assign(p, { Rs: cfg.Rs, RL: cfg.RL, open: cfg.open });
        root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
        $('[data-out="note"]').textContent = cfg.note;
        rebuild();
        if (!reduce) { t = 0; play(); }
      });
    });

    /* scrub the scope + lattice */
    function scrubber(cv, axis) {
      let down = false;
      const set = (ev) => {
        const r = cv.getBoundingClientRect();
        const frac = axis === 'x'
          ? (ev.clientX - r.left - 46) / (r.width - 114)
          : (ev.clientY - r.top - 26) / (r.height - 42);
        t = Math.max(0, Math.min(1, frac)) * TMAX;
        draw();
      };
      cv.addEventListener('pointerdown', (e) => { down = true; pause(); cv.setPointerCapture(e.pointerId); set(e); });
      cv.addEventListener('pointermove', (e) => { if (down) set(e); });
      cv.addEventListener('pointerup', () => { down = false; });
      cv.addEventListener('pointercancel', () => { down = false; });
    }
    scrubber(cvScope, 'x');
    scrubber(cvLat, 'y');

    /* theme + resize */
    const onTheme = () => { readTheme(root); draw(); };
    window.addEventListener('sipi:theme', onTheme);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', onTheme);
    let rt = 0;
    const onResize = () => { clearTimeout(rt); rt = setTimeout(draw, 90); };
    window.addEventListener('resize', onResize);

    readTheme(root);
    rebuild();
    root.querySelector('.preset[data-preset="unterminated"]').setAttribute('aria-pressed', 'true');
    $('[data-out="note"]').textContent = PRESETS.unterminated.note;

    return {
      start() { if (!reduce) play(); },
      stop() { pause(); },
      destroy() {
        pause();
        window.removeEventListener('sipi:theme', onTheme);
        window.removeEventListener('resize', onResize);
      }
    };
  };
})();
