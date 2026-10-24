/* SI & PI — viz/return-path.js
 * Watch the return current choose its path. A plane seen from above, with the
 * current in it drawn as a glow (how much) and as particles flowing along it
 * (which way), solved live from DC to 100 MHz or followed in time after a step.
 *
 * All the physics is NS.models.returnPath (js/models/return-path-model.js); this
 * schedules the solves, keeps the results and draws them.
 *
 * Drag across the copper to cut a slot; click a slot to bridge it with a
 * capacitor; click the capacitor to remove it; drag the driver or load via.
 *
 * Requires js/viz-kit.js and js/models/return-path-model.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;
  const JREF = 0.25;                                       // per mm of width: the current density drawn at full glow
  const NPART = 900;                                       // particles
  const SPEED = 9;                                         // mm per second along the current
  const SWEEP_RATE = 4.5;                                  // sweep points per second while playing
  const STEP_RATE = 3;                                     // time points per second while playing

  const PRESETS = {
    straight: { S: [8.5, 20.5], L: [51.5, 20.5], style: 'straight', voids: [], caps: [],
      note: 'A straight trace. At DC the return spreads across the whole plane; as the frequency rises it gathers under the trace.' },
    corner: { S: [8.5, 8.5], L: [47.5, 32.5], style: 'corner', voids: [], caps: [],
      note: 'A trace with a corner. At DC the return cuts straight across; at high frequency it turns the corner with the trace.' },
    detour: { S: [12.5, 30.5], L: [47.5, 30.5], style: 'detour', voids: [], caps: [],
      note: 'The trace takes the long way round. At DC the return goes straight from via to via; at high frequency it follows the trace all the way.' },
    split: { S: [8.5, 20.5], L: [51.5, 20.5], style: 'straight', voids: [[30.5, 0.5, 30.5, 29.5]], caps: [],
      note: 'A slot cut from the top edge across the trace. The return cannot follow the trace and goes round the end of the slot.' },
    splitcap: { S: [8.5, 20.5], L: [51.5, 20.5], style: 'straight', voids: [[30.5, 0.5, 30.5, 29.5]], caps: [{ a: [29.5, 20.5], b: [31.5, 20.5] }],
      note: 'The same slot with a 100 nF capacitor across it at the crossing. Below its resonance near 16 MHz it barely helps; above it, it carries the return.' }
  };

  function routeFor(style, S, L) {
    if (style === 'detour') { const top = 8.5; return [S, [S[0], top], [L[0], top], L]; }
    if (style === 'straight' && S[1] === L[1]) return [S, L];
    return [S, [L[0], S[1]], L];
  }

  const hex = (h) => {
    const s = (h || '#000000').replace('#', '');
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  };
  const hzShort = (f) => (f >= 1e6 ? f / 1e6 + ' MHz' : f >= 1e3 ? f / 1e3 + ' kHz' : f + ' Hz');
  const fmtT = (t) => (t <= 0 ? '0+' : t < 1e-6 ? +(t * 1e9).toPrecision(2) + ' ns' : t < 1e-3 ? +(t * 1e6).toPrecision(2) + ' µs' : +(t * 1e3).toPrecision(2) + ' ms');

  NS.viz.returnPath = function (root) {
    const M = NS.models.returnPath;
    const axes = K.axisMemo(root);
    const $ = (s) => root.querySelector(s);
    const cvB = $('[data-cv="board"]'), cvL = $('[data-cv="ind"]'), cvS = $('[data-cv="share"]');
    const F = M.SWEEP, TT = [0].concat(M.TIMES);           // time index 0 is t = 0+
    const p = { S: null, L: null, style: 'detour', voids: new Set(), caps: [], hi: 0, mode: 'sine', fi: 0, ti: 0, pos: 0 };

    let model = null, sweep = [], steps = null, ghost = null, job = 0, playing = false, geo = null;
    const fields = new Map();                              // cache of display fields, by key
    const pending = new Set();                             // cells of a slot being drawn

    /* ---------- solving ---------- */
    function rebuild(keepGhost) {
      const done = sweep.length && sweep.every(Boolean);
      if (keepGhost && done) ghost = { L: sweep.map((r) => r.L), share: sweep.map((r) => r.share), steps: steps && steps.every(Boolean) ? steps.map((s) => s.share) : null };
      const next = M.create({ S: p.S, L: p.L, route: routeFor(p.style, p.S, p.L), h: M.HEIGHTS[p.hi], voids: [...p.voids], caps: p.caps });
      if (next.error) return false;
      model = next; sweep = F.map(() => null); steps = null; fields.clear();
      schedule();
      return true;
    }
    /* Solve in slices, the point on screen first, so a change answers at once and the
       curves fill in behind it. */
    function schedule() {
      clearTimeout(job);
      const run = () => {
        if (!model) return;
        const t0 = performance.now();
        while (performance.now() - t0 < 14) {
          if (p.mode === 'step' && (!steps || !steps.every(Boolean))) { advanceSteps(); continue; }
          const k = nextMissing();
          if (k < 0) break;
          const near = sweep[k - 1] || sweep[k + 1];
          const r = model.solveFreq(F[k], near ? near.x : null);
          sweep[k] = { f: F[k], x: r.x, I: r.I, L: r.L, R: r.R, share: r.share };
        }
        m.render();
        if (nextMissing() >= 0 || (p.mode === 'step' && (!steps || !steps.every(Boolean)))) job = setTimeout(run, 0);
      };
      job = setTimeout(run, 0);
    }
    function nextMissing() {
      const c = Math.round(p.mode === 'sine' ? p.pos : p.fi);
      for (let dk = 0; dk < F.length; dk++) {
        for (const k of [c + dk, c - dk]) if (k >= 0 && k < F.length && !sweep[k]) return k;
      }
      return -1;
    }
    let stepState = null;
    function advanceSteps() {
      if (!steps) { steps = TT.map(() => null); stepState = model.inductive(); steps[0] = info(stepState); return; }
      const k = steps.findIndex((s) => !s);
      stepState = model.stepFrom(stepState, TT[k]);
      steps[k] = info(stepState);
    }
    const info = (st) => { const r = model.stepInfo(st); return { t: st.t, I: r.I, share: r.share }; };

    /* The field on screen: between two solved points while a sweep plays, blended. */
    function fieldAt(list, x) {
      const a = Math.max(0, Math.min(list.length - 1, Math.floor(x))), b = Math.min(list.length - 1, a + 1), u = x - a;
      const get = (k) => {
        if (!list[k]) return null;
        const key = (list === sweep ? 'f' : 't') + k;
        if (!fields.has(key)) fields.set(key, model.field(list[k].I));
        return fields.get(key);
      };
      const A = get(a), B = get(b);
      if (!A) return B; if (!B || u < 1e-3) return A;
      const out = {};
      for (const key of ['jx', 'jxi', 'jy', 'jyi']) {
        const o = new Float64Array(A[key].length);
        for (let k = 0; k < o.length; k++) o[k] = (1 - u) * A[key][k] + u * B[key][k];
        out[key] = o;
      }
      return out;
    }
    const current = () => (p.mode === 'sine' ? fieldAt(sweep, p.pos) : steps ? fieldAt(steps, p.pos) : null);

    /* ---------- particles ----------
       Placed where the current is, in proportion to it, so their density reads as
       current density; they all move at one speed along the in-phase current. */
    const rng = K.rng(0x51ce);
    const parts = [];
    let lastField = null, cdf = null;
    function buildCdf(J) {
      const n = model.nx * model.ny; cdf = new Float64Array(n);
      let s = 0;
      for (let k = 0; k < n; k++) { s += Math.hypot(J.jx[k], J.jy[k]) * (model.cu[k] ? 1 : 0); cdf[k] = s; }
    }
    function spawn(q) {
      const nx = model.nx, total = cdf[cdf.length - 1];
      if (!(total > 0)) { q.x = -1; return; }
      const u = rng() * total;
      let lo = 0, hi = cdf.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < u) lo = mid + 1; else hi = mid; }
      const i = lo % nx, j = (lo - i) / nx, d = model.d;
      q.x = (i + rng()) * d; q.y = (j + rng()) * d; q.age = 0; q.life = 1.2 + 1.8 * rng();
    }
    function sample(J, x, y) {                              // bilinear, cell-centred, in-phase part, per mm
      const d = model.d, nx = model.nx, ny = model.ny;
      const fx = x / d - 0.5, fy = y / d - 0.5;
      const i0 = Math.max(0, Math.min(nx - 2, Math.floor(fx))), j0 = Math.max(0, Math.min(ny - 2, Math.floor(fy)));
      const u = Math.max(0, Math.min(1, fx - i0)), v = Math.max(0, Math.min(1, fy - j0));
      const at = (a, i, j) => a[i + j * nx];
      const bl = (a) => (1 - u) * (1 - v) * at(a, i0, j0) + u * (1 - v) * at(a, i0 + 1, j0) + (1 - u) * v * at(a, i0, j0 + 1) + u * v * at(a, i0 + 1, j0 + 1);
      return [bl(J.jx) * 1e-3, bl(J.jy) * 1e-3];
    }
    function moveParticles(J, dt) {
      if (J !== lastField) { buildCdf(J); lastField = J; }
      let ncu = 0; for (let k = 0; k < model.cu.length; k++) ncu += model.cu[k];
      const meanJ = cdf[cdf.length - 1] / (ncu || 1) * 1e-3;
      if (!parts.length) for (let k = 0; k < NPART; k++) { const q = {}; spawn(q); q.age = rng() * q.life; parts.push(q); }
      const nx = model.nx;
      parts.forEach((q) => {
        q.age += dt;
        const c = q.x >= 0 ? Math.floor(q.x / model.d) + Math.floor(q.y / model.d) * nx : -1;
        if (q.age > q.life || q.x < 0 || q.y < 0 || q.x >= M.BOARD.a || q.y >= M.BOARD.b || !model.cu[c]) { spawn(q); return; }
        const [vx, vy] = sample(J, q.x, q.y), s = Math.hypot(vx, vy);
        // Where the current has moved away, the particle goes with it.
        if (s < 0.12 * meanJ) { spawn(q); return; }
        q.x += SPEED * dt * vx / s; q.y += SPEED * dt * vy / s;
      });
    }

    /* ---------- the board ---------- */
    /* On a laptop the board fills the height the screen leaves under the instrument bar
       (measured, not guessed) and the two plots share that height beside it; on a phone
       everything takes its natural height. */
    const wide = () => window.innerWidth >= 992;
    function over(cv) {                                   // a panel's height apart from its canvas: label, legend, padding
      const panel = cv.parentElement, st = getComputedStyle(panel), kids = [...panel.children];
      let h = parseFloat(st.paddingTop) + parseFloat(st.paddingBottom) + (kids.length - 1) * (parseFloat(st.rowGap) || 0);
      kids.forEach((k) => { if (k !== cv) h += k.getBoundingClientRect().height; });
      return h || 40;
    }
    function boardHeight() {
      const w = cvB.clientWidth || 600, natural = Math.round((w - 24) * M.BOARD.b / M.BOARD.a + 34);
      if (!wide()) return natural;
      const bar = $('.instrument__bar').getBoundingClientRect().height || 60;
      return Math.max(240, Math.min(natural, Math.floor((window.innerHeight || 800) - bar - over(cvB) - 6)));
    }
    let heat = null;
    function drawBoard(T, J) {
      const s2 = K.canvas(cvB, boardHeight()), ctx = s2.ctx, W = s2.w, H = s2.h;
      const A = M.BOARD.a, B = M.BOARD.b;
      const sc = Math.min((W - 24) / A, (H - 30) / B), ox = (W - A * sc) / 2, oy = 18;
      geo = { ox, oy, sc };
      const PX = (x) => ox + x * sc, PY = (y) => oy + y * sc;
      ctx.fillStyle = T.surface; ctx.fillRect(0, 0, W, H);
      if (!model) return;
      const nx = model.nx, ny = model.ny;

      // The glow: one pixel per cell, smoothed up to the board.
      if (!heat) heat = document.createElement('canvas');
      heat.width = nx; heat.height = ny;
      const hctx = heat.getContext('2d'), img = hctx.createImageData(nx, ny);
      const base = hex(T.surface2), tint = hex(T.signal), bg = hex(T.surface);
      for (let k = 0; k < nx * ny; k++) {
        let c = bg;
        if (model.cu[k] && !pending.has(k)) {
          const j = J ? Math.hypot(J.jx[k], J.jxi[k], J.jy[k], J.jyi[k]) * 1e-3 : 0;
          const a = 0.9 * Math.min(1, Math.sqrt(j / JREF));
          c = [base[0] + a * (tint[0] - base[0]), base[1] + a * (tint[1] - base[1]), base[2] + a * (tint[2] - base[2])];
        }
        img.data[4 * k] = c[0]; img.data[4 * k + 1] = c[1]; img.data[4 * k + 2] = c[2]; img.data[4 * k + 3] = 255;
      }
      hctx.putImageData(img, 0, 0);
      ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(heat, PX(0), PY(0), A * sc, B * sc); ctx.restore();
      // Slots, crisp over the smoothing.
      ctx.fillStyle = T.surface;
      for (let k = 0; k < nx * ny; k++) {
        if (model.cu[k] && !pending.has(k)) continue;
        const i = k % nx, j = (k - i) / nx;
        ctx.fillRect(PX(i * model.d) - 0.5, PY(j * model.d) - 0.5, model.d * sc + 1, model.d * sc + 1);
      }
      ctx.strokeStyle = T.border; ctx.lineWidth = 1; ctx.strokeRect(PX(0) - 0.5, PY(0) - 0.5, A * sc + 1, B * sc + 1);

      // The current itself.
      if (J) {
        ctx.save(); ctx.strokeStyle = K.rgba(T.ink, 0.62); ctx.lineWidth = 1.1; ctx.lineCap = 'round';
        ctx.beginPath();
        if (m.reduce || !parts.length) {
          // At rest: short strokes along the current, placed in proportion to it.
          if (J !== lastField) { buildCdf(J); lastField = J; }
          const r0 = K.rng(7), q = {};
          for (let k = 0; k < 420; k++) {
            const u = r0() * cdf[cdf.length - 1];
            let lo = 0, hi = cdf.length - 1;
            while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < u) lo = mid + 1; else hi = mid; }
            q.x = (lo % nx + r0()) * model.d; q.y = (Math.floor(lo / nx) + r0()) * model.d;
            const [vx, vy] = sample(J, q.x, q.y), s = Math.hypot(vx, vy) || 1, l = 0.9;
            ctx.moveTo(PX(q.x - l * vx / s), PY(q.y - l * vy / s)); ctx.lineTo(PX(q.x + l * vx / s), PY(q.y + l * vy / s));
          }
        } else {
          parts.forEach((q) => {
            if (q.x < 0) return;
            const [vx, vy] = sample(J, q.x, q.y), s = Math.hypot(vx, vy) || 1, l = 0.7;
            ctx.moveTo(PX(q.x - l * vx / s), PY(q.y - l * vy / s)); ctx.lineTo(PX(q.x), PY(q.y));
          });
        }
        ctx.stroke(); ctx.restore();
      }

      const label = (txt, x, y, c, align, bold) => {
        ctx.save(); ctx.font = (bold ? '600 ' : '') + '10px ' + K.MONO; ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.strokeStyle = T.surface; ctx.strokeText(txt, x, y);
        ctx.fillStyle = c; ctx.fillText(txt, x, y); ctx.restore();
      };
      // The trace, on the layer above: drawn over the plane, with its direction.
      const rt = model.route;
      ctx.save(); ctx.strokeStyle = T.reflect; ctx.lineWidth = 2.2; ctx.lineJoin = 'round'; ctx.globalAlpha = 0.9;
      ctx.beginPath(); rt.forEach((q, k) => (k ? ctx.lineTo(PX(q[0]), PY(q[1])) : ctx.moveTo(PX(q[0]), PY(q[1])))); ctx.stroke();
      for (let k = 0; k + 1 < rt.length; k++) {                // an arrowhead mid-segment
        const a = rt[k], b = rt[k + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 6) continue;
        const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len, cx = PX((a[0] + b[0]) / 2), cy = PY((a[1] + b[1]) / 2);
        ctx.beginPath(); ctx.moveTo(cx + 6 * ux, cy + 6 * uy); ctx.lineTo(cx - 4 * ux - 4 * uy, cy - 4 * uy + 4 * ux); ctx.lineTo(cx - 4 * ux + 4 * uy, cy - 4 * uy - 4 * ux);
        ctx.closePath(); ctx.fillStyle = T.reflect; ctx.fill();
      }
      ctx.restore();
      // Capacitors across slots.
      p.caps.forEach((c) => {
        const ax = PX(c.a[0]), ay = PY(c.a[1]), bx = PX(c.b[0]), by = PY(c.b[1]);
        const len = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / len, uy = (by - ay) / len;
        ctx.save(); ctx.translate((ax + bx) / 2, (ay + by) / 2); ctx.rotate(Math.atan2(uy, ux));
        ctx.fillStyle = T.ink2; ctx.fillRect(-len / 2 - 2, -4, len + 4, 8);
        ctx.fillStyle = T.surface; ctx.fillRect(-1.5, -4, 3, 8);
        ctx.restore();
        label('100 nF', (ax + bx) / 2, (ay + by) / 2 - 11, T.ink, 'center');
      });
      // The two vias.
      const via = (q, txt, below) => {
        const x = PX(q[0]), y = PY(q[1]);
        K.dot(ctx, x, y, T.reflect, T.surface, 5);
        label(txt, x, y + (below ? 13 : -13), T.ink, 'center', true);
      };
      via(p.S, 'driver', p.S[1] < 12); via(p.L, 'load', p.L[1] < 12);
      // Clock and scale.
      const at = p.mode === 'sine' ? 'f = ' + K.fmt.hz(F[Math.round(p.pos)]) : 't = ' + fmtT(TT[Math.round(p.pos)]) + ' after the step';
      label(at, PX(0), 8, T.ink, 'left', true);
      const sb = 10 * sc, bx = PX(A) - sb, by = H - 6;
      K.line(ctx, bx, by, bx + sb, by, T.ink2, 2);
      label('10 mm', bx - 6, by, T.ink2, 'right');
      if (!sweep[Math.round(p.pos)] && p.mode === 'sine') label('solving…', PX(A), 8, T.muted, 'right');
    }

    /* ---------- the plots ---------- */
    const plotH = () => {
      if (!wide()) return 190;
      const total = boardHeight() + over(cvB);
      return Math.max(100, Math.floor((total - over(cvL) - over(cvS) - 1) / 2));
    };
    function drawInd(T) {
      const s = K.canvas(cvL, plotH());
      const pts = sweep.map((r, k) => (r ? [F[k], r.L * 1e9] : null)).filter(Boolean);
      const all = pts.map((q) => q[1]).concat(ghost ? ghost.L.map((v) => v * 1e9) : []);
      const yr = K.stickyAxis(axes, 'L', all.length ? Math.min(...all) : 0, all.length ? Math.max(...all) : 50, { head: 0.1 });
      const P = K.plot(s, T, {
        pad: { l: 44, r: 12, t: 18, b: 30 },
        x: { min: F[0], max: F[F.length - 1], log: true, ticks: [10, 1e3, 1e5, 1e7], fmt: hzShort },
        y: { min: yr.min, max: yr.max, count: 4, fmt: (v) => +v.toPrecision(3) + '', title: 'nH' }
      }).grid();
      if (ghost) P.trace(ghost.L.map((v, k) => [F[k], v * 1e9]), T.muted, { width: 1.2, dash: [4, 3], id: 'before', label: 'before your change', unit: 'nH' });
      if (pts.length) P.trace(pts, T.signal, { width: 1.8, id: 'L', label: 'loop inductance', unit: 'nH' });
      if (p.mode === 'sine') P.vline(F[Math.round(p.pos)], T.ink2, [2, 3], null);
      P.frame();
    }
    function drawShare(T) {
      const s = K.canvas(cvS, plotH());
      const step = p.mode === 'step';
      const xs = step ? TT.slice(1) : F;
      const val = step ? (steps ? steps.slice(1).map((r, k) => (r ? [TT[k + 1], 100 * r.share] : null)).filter(Boolean) : [])
        : sweep.map((r, k) => (r ? [F[k], 100 * r.share] : null)).filter(Boolean);
      const P = K.plot(s, T, {
        pad: { l: 44, r: 12, t: 18, b: 30 },
        x: { min: xs[0], max: xs[xs.length - 1], log: true, ticks: step ? [1e-8, 1e-6, 1e-4, 1e-2] : [10, 1e3, 1e5, 1e7], fmt: step ? fmtT : hzShort },
        y: { min: 0, max: 100, count: 4, fmt: (v) => v.toFixed(0) + '%', title: 'within 2 mm' }
      }).grid();
      const g = ghost && (step ? ghost.steps : ghost.share);
      if (g) P.trace((step ? g.slice(1) : g).map((v, k) => [xs[k], 100 * v]), T.muted, { width: 1.2, dash: [4, 3], id: 'before', label: 'before your change', unit: '%' });
      if (val.length) P.trace(val, T.signal, { width: 1.8, id: 'share', label: 'within 2 mm', unit: '%' });
      const x = step ? TT[Math.max(1, Math.round(p.pos))] : F[Math.round(p.pos)];
      P.vline(x, T.ink2, [2, 3], null);
      P.frame();
    }

    /* The frequency where the return is half-way from its DC spread to its high-frequency
       band: where the path changes its mind. */
    function transition() {
      if (!sweep.length || !sweep.every(Boolean)) return null;
      const s0 = sweep[0].share, s1 = sweep[sweep.length - 1].share, mid = (s0 + s1) / 2;
      for (let k = 0; k + 1 < sweep.length; k++) {
        const a = sweep[k].share - mid, b = sweep[k + 1].share - mid;
        if (a <= 0 && b > 0) return Math.pow(10, Math.log10(F[k]) + (Math.log10(F[k + 1]) - Math.log10(F[k])) * (-a) / (b - a));
      }
      return null;
    }

    function readouts() {
      const set = (k, v) => { const e = $('[data-out="' + k + '"]'); if (e) e.textContent = v; };
      const k = Math.round(p.pos);
      if (p.mode === 'sine') {
        const r = sweep[k];
        set('at', K.fmt.hz(F[k]));
        set('L', r ? (r.L * 1e9).toFixed(1) + ' nH' : '…');
        set('R', r ? K.fmt.ohm(r.R) : '…');
        set('band', r ? Math.round(100 * Math.max(0, Math.min(1, r.share))) + '%' : '…');
      } else {
        const r = steps && steps[k];
        set('at', fmtT(TT[k]));
        set('L', 'step'); set('R', 'step');
        set('band', r ? Math.round(100 * Math.max(0, Math.min(1, r.share))) + '%' : '…');
      }
      const ft = transition();
      set('mid', ft ? K.fmt.hz(ft) : '…');
      const sl = $('#rp-at');
      sl.max = p.mode === 'sine' ? F.length - 1 : TT.length - 1; sl.value = Math.round(p.pos);
      $('#rp-at-out').value = p.mode === 'sine' ? K.fmt.hz(F[k]) : fmtT(TT[k]);
      $('#rp-at-label').textContent = p.mode === 'sine' ? 'Frequency' : 'Time after the step';
      $('#rp-mode').value = p.mode; $('#rp-h').value = String(p.hi);
      $('[data-act="play"]').textContent = playing ? 'pause' : p.mode === 'sine' ? 'sweep' : 'play';
    }

    let lastJ = null;
    const m = K.mount({
      root, params: p,
      draw(T) { drawInd(T); drawShare(T); lastJ = current(); drawBoard(T, lastJ); readouts(); },
      tick(dtMs) {
        const dt = dtMs / 1000;
        if (playing) {
          const list = p.mode === 'sine' ? sweep : steps, end = (p.mode === 'sine' ? F : TT).length - 1;
          const want = Math.min(end, p.pos + dt * (p.mode === 'sine' ? SWEEP_RATE : STEP_RATE));
          // Wait for the solver rather than run ahead of it.
          if (list && list[Math.min(end, Math.ceil(want))]) p.pos = want;
          if (p.pos >= end) { p.pos = end; playing = false; }
        }
        const J = current();
        if (J && model) moveParticles(J, dt);
        return true;
      }
    });

    /* ---------- controls ---------- */
    function custom() {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      $('[data-out="note"]').textContent = 'Custom';
    }
    function preset(name) {
      const q = PRESETS[name];
      p.S = q.S.slice(); p.L = q.L.slice(); p.style = q.style; p.caps = q.caps.map((c) => ({ a: c.a.slice(), b: c.b.slice() }));
      p.voids = new Set();
      q.voids.forEach((v) => M.slotCells([v[0], v[1]], [v[2], v[3]], M.BOARD.d).forEach((k) => p.voids.add(k)));
      root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o.dataset.preset === name)));
      $('[data-out="note"]').textContent = q.note;
    }
    root.querySelectorAll('.preset[data-preset]').forEach((b) => b.addEventListener('click', () => {
      if (!PRESETS[b.dataset.preset]) return;
      ghost = null; preset(b.dataset.preset); rebuild(false); m.render();
    }));
    $('#rp-at').addEventListener('input', (e) => {
      playing = false; p.pos = +e.target.value; schedule(); m.render();
    });
    $('#rp-mode').addEventListener('change', (e) => {
      p.mode = e.target.value; p.pos = p.mode === 'sine' ? F.length - 1 : 0; playing = false; parts.length = 0;
      schedule(); m.render();
    });
    $('#rp-h').addEventListener('change', (e) => { p.hi = +e.target.value; parts.length = 0; rebuild(true); m.render(); });
    $('[data-act="play"]').addEventListener('click', () => {
      if (playing) { playing = false; m.render(); return; }
      const end = (p.mode === 'sine' ? F : TT).length - 1;
      if (p.pos >= end) p.pos = 0;
      playing = true; schedule(); m.play(); m.render();
    });
    $('[data-act="heal"]').addEventListener('click', () => {
      p.voids = new Set(); p.caps = []; custom(); parts.length = 0; rebuild(true); m.render();
    });

    /* ---------- pointer: cut, bridge, move ----------
       Press on a via and drag to move it. Press on copper and drag to cut a slot along
       the way. Tap a slot to bridge it with a capacitor; tap a capacitor to remove it. */
    const local = (e) => { const r = cvB.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const toMm = (x, y) => [(x - geo.ox) / geo.sc, (y - geo.oy) / geo.sc];
    const snap = (v) => (Math.floor(v / M.BOARD.d) + 0.5) * M.BOARD.d;
    const cellAt = (mm) => { const c = M.cellOf(mm, M.BOARD.d, model.nx, model.ny); return c[0] + c[1] * model.nx; };
    function pick(x, y) {
      for (const k of ['S', 'L']) if (Math.hypot(x - (geo.ox + p[k][0] * geo.sc), y - (geo.oy + p[k][1] * geo.sc)) <= 10) return { kind: k };
      for (let i = 0; i < p.caps.length; i++) {
        const c = p.caps[i], cx = geo.ox + (c.a[0] + c.b[0]) / 2 * geo.sc, cy = geo.oy + (c.a[1] + c.b[1]) / 2 * geo.sc;
        if (Math.hypot(x - cx, y - cy) <= 9) return { kind: 'cap', i };
      }
      return null;
    }
    const keep = () => {                                   // cells a slot may not take: the vias and capacitor pads
      const s = new Set([cellAt(p.S), cellAt(p.L)]);
      p.caps.forEach((c) => { s.add(cellAt(c.a)); s.add(cellAt(c.b)); });
      return s;
    };
    /* A capacitor across the slot at a tapped void cell: the nearest copper on either
       side, across whichever direction the slot is narrower. */
    function bridge(mm) {
      const nx = model.nx, ny = model.ny, c = M.cellOf(mm, M.BOARD.d, nx, ny);
      const cu = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && model.cu[i + j * nx] && !pending.has(i + j * nx);
      let best = null;
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        let a = 1, b = 1;
        while (a < 5 && !cu(c[0] - a * dx, c[1] - a * dy)) a++;
        while (b < 5 && !cu(c[0] + b * dx, c[1] + b * dy)) b++;
        if (a < 5 && b < 5 && (!best || a + b < best.n)) best = { n: a + b, a: [c[0] - a * dx, c[1] - a * dy], b: [c[0] + b * dx, c[1] + b * dy] };
      }
      if (!best || p.caps.length >= 4) return false;
      const ctr = (q) => [(q[0] + 0.5) * M.BOARD.d, (q[1] + 0.5) * M.BOARD.d];
      p.caps.push({ a: ctr(best.a), b: ctr(best.b) });
      return true;
    }

    let press = null;
    cvB.style.cursor = 'crosshair';
    cvB.addEventListener('pointerdown', (e) => {
      if (!geo || !model) return;
      const [x, y] = local(e), mm = toMm(x, y), target = pick(x, y);
      if (!target && (mm[0] < 0 || mm[1] < 0 || mm[0] > M.BOARD.a || mm[1] > M.BOARD.b)) return;
      press = { x, y, mm, target, moved: false, last: mm };
      cvB.setPointerCapture(e.pointerId);
    });
    cvB.addEventListener('pointermove', (e) => {
      if (!geo || !model) return;
      const [x, y] = local(e);
      if (!press) { const t = pick(x, y); cvB.style.cursor = t ? (t.kind === 'cap' ? 'pointer' : 'grab') : 'crosshair'; return; }
      if (!press.moved && Math.hypot(x - press.x, y - press.y) > 4) press.moved = true;
      if (!press.moved) return;
      const mm = toMm(x, y);
      if (press.target && (press.target.kind === 'S' || press.target.kind === 'L')) {
        p[press.target.kind] = [snap(Math.max(2, Math.min(M.BOARD.a - 2, mm[0]))), snap(Math.max(2, Math.min(M.BOARD.b - 2, mm[1])))];
        cvB.style.cursor = 'grabbing'; m.render(); return;
      }
      if (press.target) return;
      // Cutting: every cell along the drag, short of the vias and capacitor pads.
      const kept = keep();
      M.slotCells(press.last, mm, M.BOARD.d).forEach((k) => { if (!kept.has(k) && model.cu[k]) pending.add(k); });
      press.last = mm;
      m.render();
    });
    cvB.addEventListener('pointerup', (e) => {
      if (!press) return;
      const was = press; press = null;
      const [x, y] = local(e);
      cvB.style.cursor = pick(x, y) ? 'grab' : 'crosshair';
      const t = was.target;
      if (t && (t.kind === 'S' || t.kind === 'L')) {
        if (was.moved) { custom(); parts.length = 0; rebuild(true); m.render(); }
        return;
      }
      if (t && t.kind === 'cap') { if (!was.moved) { p.caps.splice(t.i, 1); custom(); rebuild(true); m.render(); } return; }
      if (was.moved && pending.size) {
        const before = new Set(p.voids);
        pending.forEach((k) => p.voids.add(k)); pending.clear();
        custom(); parts.length = 0;
        if (!rebuild(true)) {
          p.voids = before; rebuild(false);
          $('[data-out="note"]').textContent = 'That cut would split the plane in two, leaving the return no way back. Leave a gap somewhere.';
        }
        m.render(); return;
      }
      pending.clear();
      if (!was.moved && !model.cu[cellAt(was.mm)]) {
        if (bridge(was.mm)) { custom(); rebuild(true); }
        else $('[data-out="note"]').textContent = 'No copper close on both sides of the slot here, or already four capacitors.';
        m.render();
      }
    });
    cvB.addEventListener('pointercancel', () => { press = null; pending.clear(); m.render(); });

    const notes = Object.values(PRESETS).map((q) => q.note).concat(['Custom', 'That cut would split the plane in two, leaving the return no way back. Leave a gap somewhere.']);
    const reserve = () => K.reserveText($('[data-out="note"]'), notes);
    reserve();
    window.addEventListener('resize', reserve);
    // A layout change (the phone's swipe track, a tab) asks for pixels, not a nudged slider,
    // which this panel would take for the reader and drop its preset.
    const offRepaint = K.onRepaint(root, () => m.render());
    preset('detour');
    rebuild(false);
    m.render();
    setTimeout(() => m.render(), 0);                        // again once the loader has added its rows
    let started = false;
    return {
      start() {
        if (!started) {
          started = true;
          if (!m.reduce) { p.pos = 0; playing = true; }      // the first visit sweeps from DC upward
          else p.pos = F.indexOf(1e5);
          schedule();
        }
        if (!m.reduce) m.play();
        m.render();
      },
      stop() { m.pause(); },
      destroy() { clearTimeout(job); window.removeEventListener('resize', reserve); offRepaint(); m.teardown(); }
    };
  };
  NS.viz.returnPath.presets = PRESETS;
})();
