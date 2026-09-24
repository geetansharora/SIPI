/* SI & PI — viz-kit.js
 * Shared drawing layer for the visualisation modules.
 *
 * Every viz was re-implementing the same four things: reading theme tokens,
 * sizing a canvas for devicePixelRatio, drawing axes with ticks, and the
 * start/stop/destroy lifecycle. That boilerplate is what made a small graphic
 * expensive, so it lives here once. A parameterised widget should be ~60 lines.
 *
 * Load before any js/viz/<name>.js that uses it.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  // Search can create SIPI before the plotting scripts load.
  NS.viz = NS.viz || {};
  const K = (NS.kit = {});

  K.MONO = '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace';

  /* ---------- theme ---------- */
  const TOKENS = ['ink', 'ink-2', 'muted', 'signal', 'reflect', 'alarm',
                  'grid', 'border', 'border-soft', 'surface', 'surface-2', 'glow'];
  K.theme = function (el) {
    const cs = getComputedStyle(el || document.documentElement), t = {};
    TOKENS.forEach((n) => { t[n.replace('-2', '2')] = cs.getPropertyValue('--' + n).trim(); });
    return t;
  };
  K.rgba = function (hex, a) {
    const h = (hex || '#000').replace('#', '');
    if (h.length < 6) return hex;
    return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16)
         + ',' + parseInt(h.slice(4, 6), 16) + ',' + a + ')';
  };

  /* ---------- canvas ----------
     A module asks for the height its drawing needs, and normally gets it. A layout
     that has to place several plots on one screen may override the height of one
     canvas through K.canvasHeight; the module is never told, goes on asking for its
     native height, and clearing the override restores that height exactly.

     The override is per canvas and in CSS pixels. Choosing it is the layout's
     policy; the kit only applies it. Nothing is clamped here on purpose — a layout
     that wants a minimum imposes it in the one place it decides heights, rather
     than negotiating with a second floor hidden in the kit. */
  const nativeH = new WeakMap(), layoutH = new WeakMap();
  K.canvasHeight = {
    set(cv, px) { if (px > 0) layoutH.set(cv, px); else layoutH.delete(cv); },
    clear(cv) { layoutH.delete(cv); },
    get(cv) { return layoutH.get(cv) || null; },
    native(cv) { return nativeH.get(cv) || null; }
  };
  K.canvas = function (cv, hCss) {
    nativeH.set(cv, hCss);
    const over = layoutH.get(cv);
    if (over > 0) hCss = Math.round(over);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const wCss = cv.clientWidth || (cv.parentNode && cv.parentNode.clientWidth) || 320;
    cv.width = Math.round(wCss * dpr);
    cv.height = Math.round(hCss * dpr);
    cv.style.height = hCss + 'px';
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, wCss, hCss);
    return { ctx, w: wCss, h: hCss, dpr, cv };
  };

  /* ---------- what a hidden trace means ----------
     A legend toggle has to remove the whole series, not just the polyline: the
     marker at the sampling instant and the direct label beside it are the same
     series, and leaving them behind points at a line that is no longer there.
     Routing the test through the low-level helpers catches all of them without a
     single module needing to know the feature exists.

     `__chrome` is the exception. Axes, ticks and the frame are drawn in the same
     muted colour a series can legitimately use, and hiding a series must never
     take the grid with it — so grid() and frame() raise the flag while they run. */
  /* N4-5 / R10. The key is the series ID when the caller gives one, and the
     colour otherwise. Colour-keyed suppression could not tell two same-coloured
     series apart, so the loader disabled toggling for both — an honest
     limitation, and the one this replaces. Every call that passes an `id` is now
     independently addressable; every call that does not behaves exactly as
     before, which is what lets this land without touching twenty-five modules
     at once. */
  K.seriesKey = function (colour, id) {
    return id ? 'id:' + id : K.colourKey(colour);
  };

  /* A series that is not a polyline — a shaded region, a fill, a set of markers —
     still needs to be addressable, and the loader can only match a legend entry
     to something recorded in `__traces`. This registers it and answers whether it
     is hidden, in one call, so the drawing code reads as a guard. */
  K.series = function (ctx, colour, id, label) {
    const cv = ctx && ctx.canvas;
    if (cv && !cv.__chrome) {
      cv.__traces = cv.__traces || [];
      if (!cv.__traces.some((t) => t.id === id)) {
        cv.__traces.push({ key: K.seriesKey(colour, id), id: id,
                           colour: K.colourKey(colour), pts: [],
                           dash: false, label: label || id, region: true });
      }
    }
    return K._suppressed(ctx, colour, id);
  };

  K._suppressed = function (ctx, colour, id) {
    const cv = ctx && ctx.canvas;
    if (!cv || cv.__chrome) return false;
    const key = K.seriesKey(colour, id);
    if (cv.__drawn) cv.__drawn.add(key);
    return !!(cv.__hidden && cv.__hidden.has(key));
  };

  K.line = function (ctx, x1, y1, x2, y2, colour, width, dash) {
    if (K._suppressed(ctx, colour)) return;
    ctx.save();
    ctx.strokeStyle = colour; ctx.lineWidth = width || 1; ctx.setLineDash(dash || []);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.restore();
  };
  K.text = function (ctx, str, x, y, colour, size, align, baseline) {
    if (K._suppressed(ctx, colour)) return;
    ctx.save();
    ctx.fillStyle = colour; ctx.font = (size || 10) + 'px ' + K.MONO;
    ctx.textAlign = align || 'left'; ctx.textBaseline = baseline || 'middle';
    ctx.fillText(str, x, y);
    ctx.restore();
  };
  K.dot = function (ctx, x, y, colour, ring, r) {
    if (K._suppressed(ctx, colour)) return;
    ctx.save();
    ctx.fillStyle = colour; ctx.strokeStyle = ring; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, r || 4, 0, Math.PI * 2); ctx.fill();
    if (ring) ctx.stroke();
    ctx.restore();
  };

  /* ---------- plot ----------
     opts: { x:{min,max,log,ticks,fmt,title}, y:{...}, pad:{l,r,t,b} }
     Returns { X, Y, box, grid(), frame(), trace(pts,colour,opts) }.       */
  /* Keep the grid resolution while choosing labels by their measured footprint.
     Endpoint labels take priority; thinning labels never changes the data axis. */
  K.axisLabels = function (ticks, position, format, measure, left, right) {
    const labels = ticks.map((v) => {
      const label = String(format(v)), width = measure(label);
      const x = Math.max(left + width / 2, Math.min(right - width / 2, position(v)));
      return { value: v, label, x, left: x - width / 2, right: x + width / 2 };
    }).filter((q) => q.left >= left && q.right <= right).sort((a, b) => a.x - b.x);
    if (labels.length < 2) return labels;
    const first = labels[0], last = labels[labels.length - 1], chosen = [first];
    if (last.left < first.right + 8) return chosen;
    labels.slice(1, -1).forEach((q) => {
      if (q.left >= chosen[chosen.length - 1].right + 8 && q.right + 8 <= last.left) chosen.push(q);
    });
    chosen.push(last);
    return chosen;
  };

  K.plot = function (surface, T, opts) {
    const { ctx, w, h } = surface;
    /* A right pad wide enough for trace labels on a desktop is a large fraction of
       a 316 px phone canvas, and those labels then run off the edge. Below ~420 px
       the pad collapses and P.narrow tells the module to keep its labels inside —
       the HTML legend and summary carry the identity there instead. */
    const narrow = w < 420;
    const pad = Object.assign({ l: 50, r: 14, t: 16, b: 30 }, opts.pad || {});
    if (narrow && !pad.keepR) {
      pad.r = Math.min(pad.r, 14);        // right margin only — see below
      /* The LEFT pad is not shrunk. Y-axis labels are drawn right-aligned into it,
         so trimming it truncates them ("100 mΩ" became ".00 mΩ"). Losing a trace
         label at the right margin is recoverable; losing the axis is not.

         keepR is the exception that reasoning did not cover. A panel with a SECOND
         axis on the right — Lab A's probe plot draws current there — loses that
         axis to this clamp, not a label: the mA numbers were cut to "2(" and "1:"
         on a phone. A module that declares keepR is saying the right margin is an
         axis and must survive, and it accepts a narrower plot box in exchange. */
    }
    const L = pad.l, R = w - pad.r, TP = pad.t, B = h - pad.b;
    let ax = opts.x, ay = opts.y;

    /* Zoom lives on the canvas, not in the module. Every module builds a fresh
       axis object on each render, so a zoom stored anywhere else would be undone
       by the next frame; re-applying it here means any module that calls K.plot
       is zoomable without knowing it. Traces already clip to the box, so data
       outside the window disappears correctly rather than drawing over the axes. */
    const cvz = surface.cv || surface.canvas;
    if (cvz && cvz.__zoom) {
      const z = cvz.__zoom;
      if (z.x) ax = Object.assign({}, ax, { min: z.x[0], max: z.x[1], ticks: null });
      if (z.y) ay = Object.assign({}, ay, { min: z.y[0], max: z.y[1], ticks: null });
    }
    if (cvz) { cvz.__drawn = new Set(); cvz.__traces = []; }

    const fwd = (a, v) => (a.log ? Math.log10(v) : v);
    const X = (v) => L + (fwd(ax, v) - fwd(ax, ax.min)) / (fwd(ax, ax.max) - fwd(ax, ax.min)) * (R - L);
    const Y = (v) => {
      const c = ay.log ? Math.max(v, ay.min) : v;
      return B - (fwd(ay, c) - fwd(ay, ay.min)) / (fwd(ay, ay.max) - fwd(ay, ay.min)) * (B - TP);
    };

    function ticksFor(a) {
      if (a.ticks) return a.ticks;
      if (a.log) {
        const out = [];
        for (let d = Math.ceil(Math.log10(a.min)); d <= Math.log10(a.max) + 1e-9; d++) out.push(Math.pow(10, d));
        return out;
      }
      const out = [], n = a.count || 5, step = (a.max - a.min) / n;
      for (let i = 0; i <= n; i++) out.push(a.min + i * step);
      return out;
    }

    const P = {
      X, Y, narrow, box: { L, R, TP, B, w, h }, ctx,
      grid() {
        if (cvz) cvz.__chrome = 1;
        ticksFor(ax).forEach((v) => {
          const x = X(v);
          if (x < L - 0.5 || x > R + 0.5) return;
          K.line(ctx, x, TP, x, B, ax.zeroAt === v ? T.border : T.grid, 1);
        });
        ctx.save();
        ctx.font = '10px ' + K.MONO;
        const visibleTicks = ticksFor(ax).filter((v) => X(v) >= L - 0.5 && X(v) <= R + 0.5);
        K.axisLabels(visibleTicks, X, ax.fmt || String,
          (label) => ctx.measureText(label).width, 2, w - 2).forEach((q) => {
          K.text(ctx, q.label, q.x, B + 12, T.muted, 10, 'center');
        });
        ctx.restore();
        if (ax.log) {                       // minor decade lines, so a log axis reads as one
          ticksFor(ax).forEach((v) => {
            for (let m = 2; m < 10; m++) {
              const x = X(v * m);
              if (x > L && x < R) K.line(ctx, x, TP, x, B, T.grid, 0.4);
            }
          });
        }
        ticksFor(ay).forEach((v) => {
          const y = Y(v);
          if (y < TP - 0.5 || y > B + 0.5) return;
          K.line(ctx, L, y, R, y, v === 0 ? T.border : T.grid, 1);
          K.text(ctx, (ay.fmt || String)(v), L - 8, y, T.muted, 10, 'right');
        });
        if (cvz) cvz.__chrome = 0;
        return P;
      },
      frame() {
        if (cvz) cvz.__chrome = 1;
        K.line(ctx, L, TP, L, B, T.border, 1);
        K.line(ctx, L, B, R, B, T.border, 1);
        // The y title sits ABOVE the plot, not beside the top tick. Inside the tick
        // column it collides with the topmost label whenever that label is wide —
        // "dB/in" over "2.3" renders as "dB/in³" with a stray 2, which looks like a
        // unit rather than a collision.
        if (ay.title) K.text(ctx, ay.title, Math.max(4, L - 46), Math.max(7, TP - 9), T.muted, 10, 'left');
        if (ax.title) K.text(ctx, ax.title, R - 2, B + 25, T.muted, 10, 'right');
        if (cvz) cvz.__chrome = 0;
        return P;
      },
      /* pts: [[x,y], …] or a function i -> [x,y] with opts.n */
      trace(pts, colour, o) {
        o = o || {};
        /* Colour is the trace's identity here. No call site passes a name — the
           legend swatch beside the canvas is what the reader matches a line to,
           and that swatch carries a colour, so the colour is the honest key.
           Recording what was actually drawn also means the loader can refuse to
           make a legend entry clickable when nothing on the canvas answers to it,
           which keeps 'no control without a lesson' true. */
        if (cvz) {
          const key = K.seriesKey(colour, o.id);
          cvz.__drawn.add(key);
          if (cvz.__hidden && cvz.__hidden.has(key)) return P;
        }
        /* M5-3 · Record the sampled points in AXIS units, so the probe can
           report what a trace says at a given x rather than only where the
           pointer is. This is the data the plot already has; the cursor was
           inverting screen coordinates instead, which is a different and much
           weaker thing — a reader could hover over empty space and read a
           number that looked like a measurement. */
        if (cvz) {
          cvz.__traces = cvz.__traces || [];
          const nrec = typeof pts === 'function' ? o.n : pts.length;
          const rec = new Array(nrec);
          for (let i = 0; i < nrec; i++) {
            const q = typeof pts === 'function' ? pts(i) : pts[i];
            rec[i] = [q[0], q[1]];
          }
          cvz.__traces.push({ key: K.seriesKey(colour, o.id), id: o.id || null,
                              colour: K.colourKey(colour), pts: rec,
                              dash: !!o.dash, label: o.label || null,
                              unit: o.unit || null });
        }
        ctx.save();
        ctx.beginPath(); ctx.rect(L, TP, R - L, B - TP); ctx.clip();   // stay inside the axes
        ctx.strokeStyle = colour; ctx.lineWidth = o.width || 2; ctx.lineJoin = 'round';
        if (o.dash) ctx.setLineDash(o.dash);
        if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
        if (o.glow) { ctx.shadowColor = T.glow; ctx.shadowBlur = 8; }
        ctx.beginPath();
        const n = typeof pts === 'function' ? o.n : pts.length;
        let started = false;
        for (let i = 0; i < n; i++) {
          const p = typeof pts === 'function' ? pts(i) : pts[i];
          /* A non-finite sample ENDS the current sub-path. Skipping it silently
             drew a straight line across the gap, which reads as data. */
          if (!p || !isFinite(p[0]) || !isFinite(p[1])) { started = false; continue; }
          const x = X(p[0]), y = Y(p[1]);
          started ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), started = true);
        }
        ctx.stroke(); ctx.restore();
        return P;
      },
      hline(v, colour, dash, labelText) {
        const y = Y(v);
        K.line(ctx, L, y, R, y, colour, 1, dash || [4, 4]);
        if (labelText) K.text(ctx, labelText, R - 2, y - 9, colour, 10, 'right');
        return P;
      },
      vline(v, colour, dash, labelText) {
        const x = X(v);
        K.line(ctx, x, TP, x, B, colour, 1, dash || [3, 4]);
        if (labelText) K.text(ctx, labelText, x + 4, TP + 6, colour, 10, 'left');
        return P;
      }
    };

    /* The probe needs to go the other way — pixel back to data — and it lives
       outside the module, so the mapping is recorded on the canvas itself. Last
       plot wins; the panels that draw two plots on one canvas are the exception,
       and there the probe reads the lower one, which is always the detail view. */
    const cv = surface.cv || surface.canvas;
    if (cv) {
      const back = (a, v) => (a.log ? Math.pow(10, v) : v);
      cv.__plot = {
        X, Y, box: { L, R, TP, B, w, h }, ax, ay, baseX: opts.x, baseY: opts.y,
        invX: (px) => back(ax, fwd(ax, ax.min) + (px - L) / (R - L) * (fwd(ax, ax.max) - fwd(ax, ax.min))),
        invY: (py) => back(ay, fwd(ay, ay.min) + (B - py) / (B - TP) * (fwd(ay, ay.max) - fwd(ay, ay.min)))
      };
    }
    return P;
  };

  /* ---------- lossless transmission line ----------
     One canonical implementation, because reflections are taught on three
     different pages and a second copy would drift. Exact for a lossless line by
     superposition of launched waves:

       forward wave m   launched at t = 2m·Td     from x=0,  a₀·(ΓL·Γs)^m
       backward wave m  launched at t = (2m+1)·Td from x=L,  a₀·ΓL·(ΓL·Γs)^m

     with a₀ = Vs·Z0/(Rs+Z0) — a divider against the LINE, never against the load,
     because at the instant of launch the line looks like a resistor of Z0 and the
     far end has not been heard from yet.

     Current is not a second model. A forward wave carries +v/Z0 and a backward
     wave carries −v/Z0, so voltage adds where current subtracts. That sign is the
     whole reason an open doubles the voltage and zeroes the current while a short
     does the opposite, and it is why this returns f and b separately.

     Times are in picoseconds and voltages in volts throughout, which makes
     energies come out in picojoules. */
  K.line1D = function (p) {
    const Z0 = p.Z0, Rs = p.Rs, td = p.td, vs = p.vs === undefined ? 1 : p.vs;
    const RL = p.open ? Infinity : p.RL;
    const GL = p.open ? 1 : (RL - Z0) / (RL + Z0);
    const GS = (Rs - Z0) / (Rs + Z0);
    const a0 = vs * Z0 / (Rs + Z0);
    const vFinal = p.open ? vs : vs * RL / (Rs + RL);
    const n = p.nWave || 24;
    const fwd = [], bwd = [];
    for (let m = 0; m < n; m++) {
      const r = Math.pow(GL * GS, m);
      fwd.push({ t0: 2 * m * td, a: a0 * r });
      bwd.push({ t0: (2 * m + 1) * td, a: a0 * GL * r });
    }
    return { Z0, Rs, RL, open: !!p.open, GL, GS, a0, vs, vFinal, td, tr: p.tr, n, fwd, bwd };
  };

  /* 50% point at u = 0, so a wave's nominal arrival is its half-amplitude
     instant — which is what a scope cursor and a datasheet both mean by it. */
  K.smoothStep = function (u, tr) {
    const s = (u + tr / 2) / tr;
    if (s <= 0) return 0;
    if (s >= 1) return 1;
    return s * s * (3 - 2 * s);
  };

  /* xn in [0,1] along the line, t in ps. */
  K.line1DAt = function (M, xn, t) {
    let f = 0, b = 0;
    for (let m = 0; m < M.n; m++) {
      f += M.fwd[m].a * K.smoothStep(t - M.fwd[m].t0 - xn * M.td, M.tr);
      b += M.bwd[m].a * K.smoothStep(t - M.bwd[m].t0 - (1 - xn) * M.td, M.tr);
    }
    return { f, b, v: f + b, i: (f - b) / M.Z0 };
  };

  /* The source voltage as a function of time. K.smoothStep centres the edge on
     t = 0, so it begins at -tr/2 and ends at +tr/2, and the launched wave is
     a0 = vs*Z0/(Rs+Z0) times that shape. At x = 0 the model gives
     v = a0*ss(t) and i = a0*ss(t)/Z0 while the first wave is alone, so

         v + Rs*i = a0*ss(t)*(Z0+Rs)/Z0 = vs*ss(t)

     which identifies the source waveform exactly. M2-1: the energy integral
     used the CONSTANT vs instead, which is the source's final value rather than
     its value during the transition. */
  K.line1DSource = function (M, t) {
    return M.vs * K.smoothStep(t, M.tr);
  };

  /* Energy account over [t0, t], in pJ. Integrates the two terminal powers and
     measures what is standing on the line, so the three can be compared against
     each other — the point being that with an open end nothing is delivered and
     nothing is lost, and the energy is simply still in transit.

     M2-1 fixed two separate defects here, both of which made the account wrong
     through the source transition rather than merely imprecise:

       - the integrand used a constant M.vs, not the time-varying source
         voltage. Before the edge finishes, those are different numbers;
       - the integral started at t = 0, while the edge starts at -tr/2. A third
         of a smoothstep was therefore outside the integral, and the energy it
         put on the line was counted as an unexplained residual.

     So the lower limit defaults to before the edge, where every quantity is
     genuinely zero, and conservation holds across it rather than from the
     middle of it. The old behaviour printed 296,509,210.4% at t = 0. */
  K.line1DEnergy = function (M, t, nt, nx, t0) {
    nt = nt || 600; nx = nx || 200;
    const start = t0 === undefined ? -M.tr : t0;
    let fromSource = 0, inRs = 0, inRL = 0;
    const dt = (t - start) / nt;
    for (let k = 0; k <= nt; k++) {
      const tk = start + k * dt, w = (k === 0 || k === nt) ? 0.5 : 1;   // trapezoid
      const s0 = K.line1DAt(M, 0, tk), sL = K.line1DAt(M, 1, tk);
      fromSource += w * K.line1DSource(M, tk) * s0.i * dt;
      inRs += w * s0.i * s0.i * M.Rs * dt;
      inRL += w * sL.v * sL.i * dt;
    }
    /* Per unit length C = Td/(L·Z0) and L = Td·Z0/L, so integrating ½Cv² + ½Li²
       over x collapses to Td·∫₀¹(½v²/Z0 + ½i²Z0)dxn — the line length cancels. */
    const standing = (tk) => {
      let e = 0;
      for (let k = 0; k <= nx; k++) {
        const xn = k / nx, w = (k === 0 || k === nx) ? 0.5 : 1;
        const s2 = K.line1DAt(M, xn, tk);
        e += w * (0.5 * s2.v * s2.v / M.Z0 + 0.5 * s2.i * s2.i * M.Z0) * (M.td / nx);
      }
      return e;
    };
    const onLine = standing(t);
    /* Whatever was already standing on the line at the lower limit was not
       supplied by the integral, so the balance has to carry it. With the default
       limit it is zero, which is the point of choosing that limit — but a caller
       integrating from somewhere else gets an account that still closes. */
    const onLineAtStart = standing(start);
    const residual = fromSource + onLineAtStart - (inRs + inRL + onLine);
    /* A fraction of the injected energy is meaningless when almost none has been
       injected. Report the scale the residual should be judged against instead of
       letting a caller divide by the wrong thing. */
    const scale = Math.max(Math.abs(fromSource), onLine, onLineAtStart);
    return { fromSource, inRs, inRL, onLine, onLineAtStart, residual,
             scale, closes: scale > 0 ? Math.abs(residual) / scale : 0,
             from: start, to: t };
  };

  /* ---------- return-path loop inductance (M7-4) ----------
     M7-4 asked for a return-path example with VALIDATED data. A field solution
     is out of reach here, and inventing one would be worse than the schematic
     it was meant to replace. But one case has an exact closed form, and it
     happens to be the case a designer actually asks about: how much does moving
     a return via cost?

     For two parallel round conductors of radius r whose centres are s apart,
     the external inductance per unit length is exactly

         L' = (mu0/pi) * acosh(s / 2r)

     — exact for round conductors, for any s > 2r, with no thin-wire
     approximation. The familiar (mu0/pi)*ln(s/r) is its s >> r limit and is
     what most references quote; the acosh form is the one to use when the via
     barrels are close, which is exactly when the answer matters.

     This is `analytical`, not `measured`, and it is the EXTERNAL inductance of a
     uniform pair of round barrels through a board of thickness l.

     N3-2e / R9 withdrew the upper-bound framing this comment used to carry. It
     said the omitted effects — planes, pads, antipads, current shared with other
     return vias — "all reduce the answer", so the result was an upper bound.
     Sharing does reduce it. Others do not:

       INTERNAL inductance is omitted and ADDS. A round conductor carries
       mu0/(8*pi) per unit length inside itself at DC, so two 1.6 mm barrels add
       0.160 nH to a 1.199 nH external result at 1 mm spacing — 13.3%. Skin
       effect expels it at high frequency, so the formula is close there and low
       at DC, which is a two-sided error rather than a bound.

       The END TRANSITIONS are omitted and add too: a barrel meets a trace, and
       that junction has its own loop.

     So this is an ESTIMATE of one contribution, not a one-sided bound on a real
     transition. The honest use is comparing two placements of the same geometry,
     which is what the panel does. */
  K.MU0_OVER_PI = 4e-7;                       // H/m, exactly: mu0 = 4*pi*1e-7

  /* ---------- passivity of a general two-port (N1-3 / R3) ----------
     The largest singular value of the full complex S, which is the quantity
     passivity is actually defined by: a network is passive at a frequency when
     sigma_max(S) <= 1.

     What this replaces was |S11 +/- S21|, which is sigma_max ONLY for a
     reciprocal, port-symmetric matrix. The parser accepts general two-ports, so
     the shortcut was a wrong answer waiting for the right input — and both
     directions were reachable:

       [[s, s], [s, -s]], s = 1/sqrt(2)   unitary, sigma_max = 1
                                          shortcut said 1.414214 — a false alarm
       [[0, 0.5], [0.5, 2]]               active, sigma_max = 2.118034
                                          shortcut said 0.5 — a false pass

     S^H S is 2x2 Hermitian positive semi-definite, so its eigenvalues come from
     its trace and determinant alone:

       T = sum |Sij|^2                    (trace of S^H S)
       D = |det S|^2                      (determinant of S^H S)
       lambda = ( T +/- sqrt(T^2 - 4D) ) / 2
       sigma_max = sqrt(lambda_max)

     T^2 - 4D is non-negative in exact arithmetic and can land just below zero in
     floating point when the two singular values are nearly equal, so it is
     clamped rather than allowed to produce a NaN. */
  K.sigmaMax2x2 = function (s11, s12, s21, s22) {
    const m2 = (z) => z.re * z.re + z.im * z.im;
    const T = m2(s11) + m2(s12) + m2(s21) + m2(s22);
    /* det S = S11*S22 - S12*S21, complex */
    const dr = s11.re * s22.re - s11.im * s22.im - (s12.re * s21.re - s12.im * s21.im);
    const di = s11.re * s22.im + s11.im * s22.re - (s12.re * s21.im + s12.im * s21.re);
    const D = dr * dr + di * di;
    const disc = Math.max(0, T * T - 4 * D);
    return Math.sqrt((T + Math.sqrt(disc)) / 2);
  };

  K.viaLoopInductance = function (lengthM, radiusM, spacingM) {
    if (!(spacingM > 2 * radiusM)) return NaN;   // barrels would intersect
    const x = spacingM / (2 * radiusM);
    return lengthM * K.MU0_OVER_PI * Math.acosh(x);
  };

  /* ---------- one real capacitor on a board (M7-5) ----------
     Contract: docs/real-capacitor-model.md. Read clause 4 before adding a
     derating curve to this file. The short version is that this model takes the
     retained capacitance as an INPUT and will not compute it, because Novak et
     al. (DesignCon East 2011) measured the same nominal part from different
     vendors behaving very differently -- so a shipped curve would teach that
     derating is a lookup, which is the error the panel exists to correct.

     Catalog scalars below are markings, case sizes and voltage ratings, which
     every distributor publishes identically. No vendor characteristic curve is
     reproduced here. */

  K.REAL_CAP_PARTS = [
    { id: 'grm188-22u',  vendor: 'Murata',  code: 'GRM188R60J226',
      cNom: 22e-6,  vRated: 6.3,  size: '0603', metric: '1608', dielectric: 'X5R', tol: 0.20 },
    { id: 'c1608-22u',   vendor: 'TDK',     code: 'C1608X5R0J226M',
      cNom: 22e-6,  vRated: 6.3,  size: '0603', metric: '1608', dielectric: 'X5R', tol: 0.20 },
    { id: 'cl21a226-22u', vendor: 'Samsung', code: 'CL21A226MAQNNN',
      cNom: 22e-6,  vRated: 25.0, size: '0805', metric: '2012', dielectric: 'X5R', tol: 0.20 },
    { id: 'generic-100n', vendor: null,     code: '100 nF 0402 X7R 16 V',
      cNom: 100e-9, vRated: 16.0, size: '0402', metric: '1005', dielectric: 'X7R', tol: 0.10 }
  ];

  /* Published brackets for the retained fraction, quoted from the prose of
     Novak et al. -- not read off any plotted curve. Clause 4's table. */
  K.RETAINED_BRACKETS = [
    { id: 'classII-historic',  lo: 0.60, hi: 0.80,
      label: 'Class II, historically',
      source: 'Novak et al. 2011, sec. I: "a modest 20 to 40% maximum capacitance degradation over the full DC working range"' },
    { id: 'classIII-historic', lo: 0.00, hi: 0.40,
      label: 'Class III, historically',
      source: 'Novak et al. 2011, sec. I: "a maximum capacitance loss of 60% or higher"' }
  ];

  /* ESR with the two mechanisms the page describes: dielectric loss falling,
     metal loss rising as sqrt(f). Rd and Rm are solved so the minimum lands
     exactly on (fMin, esrMin):

       ESR(u) = Rd*u^-p + Rm*u^0.5,  u = f/fMin
       dESR/du = 0 at u=1  =>  Rm = 2*p*Rd
       ESR(1) = esrMin     =>  Rd = esrMin/(1+2p)

     At the default p = 1/2 this collapses to esrMin*cosh(ln(u)/2), which is the
     closed form check-models.js asserts against. */
  K.realCapEsr = function (f, esrMin, fMin, p) {
    const pw = p === undefined ? 0.5 : p;
    if (!(f > 0) || !(fMin > 0)) return NaN;
    const rd = esrMin / (1 + 2 * pw);
    const rm = 2 * pw * rd;
    const u = f / fMin;
    return rd * Math.pow(u, -pw) + rm * Math.sqrt(u);
  };

  /* |Z| of one mounted part across a log frequency grid, plus the band that the
     reader's retained-fraction uncertainty opens up. */
  K.realCap = function (spec) {
    const part = spec.part;
    const retained = spec.retained;
    const lTot = spec.eslPart + spec.lMount;
    const cEff = part.cNom * retained;

    const bad = !(retained > 0) ? 'retained fraction must be above zero'
      : !(lTot > 0) ? 'total inductance must be above zero'
      : !(spec.esrMin > 0) ? 'ESR minimum must be above zero'
      : null;

    const srf = (c) => 1 / (2 * Math.PI * Math.sqrt(lTot * c));
    const f0Marked = srf(part.cNom);
    const f0Eff = bad ? NaN : srf(cEff);

    const n = spec.n || 240;
    const fLo = spec.fLo || 1e3, fHi = spec.fHi || 1e9;
    const fs = [], zMarked = [], zEff = [], bandLo = [], bandHi = [];
    const mag = (f, c) => {
      const x = 2 * Math.PI * f * lTot - 1 / (2 * Math.PI * f * c);
      const r = K.realCapEsr(f, spec.esrMin, spec.fEsrMin, spec.esrShape);
      return Math.sqrt(r * r + x * x);
    };
    const loC = part.cNom * (spec.bandLo === undefined ? retained : spec.bandLo);
    const hiC = part.cNom * (spec.bandHi === undefined ? retained : spec.bandHi);

    if (!bad) {
      for (let i = 0; i < n; i++) {
        const f = fLo * Math.pow(fHi / fLo, i / (n - 1));
        fs.push(f);
        zMarked.push(mag(f, part.cNom));
        zEff.push(mag(f, cEff));
        /* Below resonance |Z| falls with C, above it |Z| is set by L and the
           two coincide. Taking min/max per point rather than assuming which
           curve is on top keeps the envelope right through the crossover. */
        /* The envelope of the family, not of its two endpoints. Reactance
           X(C) = 2*pi*f*L - 1/(2*pi*f*C) rises monotonically with C, so the
           MAXIMUM of |X| is always at an endpoint -- but the MINIMUM is zero
           wherever the band straddles the C that resonates at this frequency,
           and there |Z| drops to ESR. Taking min over the two endpoints instead
           misses that dip entirely and draws a band that excludes curves lying
           inside it. */
        const w = 2 * Math.PI * f;
        const r = K.realCapEsr(f, spec.esrMin, spec.fEsrMin, spec.esrShape);
        const xLo = w * lTot - 1 / (w * loC);
        const xHi = w * lTot - 1 / (w * hiC);
        const cRes = 1 / (w * w * lTot);
        const xMin = (cRes >= loC && cRes <= hiC) ? 0 : Math.min(Math.abs(xLo), Math.abs(xHi));
        const xMax = Math.max(Math.abs(xLo), Math.abs(xHi));
        bandLo.push(Math.sqrt(r * r + xMin * xMin));
        bandHi.push(Math.sqrt(r * r + xMax * xMax));
      }
    }

    /* |Z| at SRF is ESR(SRF) exactly, because the reactance vanishes there.
       Whether that is also the minimum of |Z| depends on the ESR slope, so the
       grid minimum is found rather than assumed, and both are reported. */
    let iMin = -1;
    for (let i = 0; i < zEff.length; i++) if (iMin < 0 || zEff[i] < zEff[iMin]) iMin = i;

    return K.result({
      model: 'realCap',
      version: '1.0',
      status: bad ? 'unsupported' : 'ok',
      why: bad,
      params: {
        part: part.code, vendor: part.vendor, cNom: part.cNom, vRated: part.vRated,
        dielectric: part.dielectric, size: part.size,
        retained: retained, eslPart: spec.eslPart, lMount: spec.lMount,
        esrMin: spec.esrMin, fEsrMin: spec.fEsrMin
      },
      units: { f: 'Hz', z: 'ohm', c: 'F', l: 'H' },
      origins: {
        cNom: 'catalog fact — part marking',
        vRated: 'catalog fact — datasheet',
        retained: 'reader input — see docs/real-capacitor-model.md clause 4',
        eslPart: 'declared — get it from your vendor',
        lMount: 'computed — K.viaLoopInductance',
        esrMin: 'declared'
      },
      /* N4-4. These carried bare x and y arrays with no unit and no name for the
         abscissa, which is exactly the "12 MHz, -3.2 means nothing" problem. */
      traces: bad ? [] : [
        K.trace('z-marked', 'marked value', 'ohm', 'frequency', 'Hz', fs, zMarked),
        K.trace('z-effective', 'at your operating point', 'ohm', 'frequency', 'Hz', fs, zEff),
        K.trace('z-band-lo', 'band, low', 'ohm', 'frequency', 'Hz', fs, bandLo),
        K.trace('z-band-hi', 'band, high', 'ohm', 'frequency', 'Hz', fs, bandHi)
      ],
      measurements: bad ? undefined : {
        cEff: cEff,
        lTot: lTot,
        srfMarked: f0Marked,
        srfEffective: f0Eff,
        srfRatio: f0Eff / f0Marked,
        zAtSrf: K.realCapEsr(f0Eff, spec.esrMin, spec.fEsrMin, spec.esrShape),
        zMin: iMin < 0 ? NaN : zEff[iMin],
        fAtZmin: iMin < 0 ? NaN : fs[iMin],
        mountShare: spec.lMount / lTot
      },
      diagnostics: { n: n, fLo: fLo, fHi: fHi, gridDecades: Math.log10(fHi / fLo) }
    });
  };

  /* ---------- the result contract (M0-6 / A4) ----------
     One object is the authoritative record of one run of one model. Before this
     existed, the DOM was the record: the values table captured rows when it was
     opened, the CSV export re-serialised those stale rows against a freshly
     generated scenario URL, and nothing could tell you which scenario a number
     came from. Tables, exports, A/B overlays and the model gate now all read the
     same object, so they cannot disagree.

     Two separations matter and are enforced below:

     `params` are the physical scenario — change one and the physics changes.
     `view` is zoom, cursor position, selected trace. A view change must never
     invalidate a result, and a params change always must.

     `status` is the other one. A model that cannot answer has to say so in a way
     that reads as "no answer", never as a number. An unsettled transient is not
     a small transient; an empty symbol population is not a closed eye; a sample
     off the end of the record is not zero. Every consumer checks status first,
     and `measurements` is null unless status is 'ok'. */
  /* ---------- one shape for a trace (N4-4 / R10) ----------
     Before this, `traces` held four different things depending on the panel: an
     array of objects with named columns, a Float64Array of samples, a pair of
     x/y arrays, and — on three panels — an id, a label and a unit with NO DATA
     AT ALL, the numbers living in `generated` where nothing downstream looked.

     So a numerical trace export could not be written, which is why the CSV was a
     summary of rounded readouts instead. One constructor, one shape:

       { id, label, unit, x: { name, unit, values }, y: values }

     The abscissa is named and carries its own unit, because "12 MHz, -3.2" is a
     coordinate and a reader needs to know which quantity and which axis. */
  K.trace = function (id, label, unit, xName, xUnit, xs, ys) {
    return { id: id, label: label, unit: unit,
             x: { name: xName, unit: xUnit, values: xs },
             y: ys };
  };

  /* Inspect native trace coordinates, independently of plot/log transforms.
     Segments use half-open sample-index ranges. Cartesian complex interpolation
     interpolates re/im, then derives magnitude/phase; never wrapped angles. */
  K.traceInspector = function (trace, options) {
    const o=options || {}, xs=trace.x.values, ys=trace.y;
    const policy=o.policy || 'nearest', imaginary=o.imaginary;
    const segments=o.segments || (xs.length ? [{from:0,to:xs.length}] : []);
    if (!['nearest','linear'].includes(policy) || xs.length!==ys.length
        || (imaginary && imaginary.length!==xs.length)
        || (policy==='linear' && trace.unit==='deg' && !imaginary)
        || Array.from(xs).some((x,i)=>!Number.isFinite(x)||(i>0&&x<=xs[i-1]))
        || segments.some(q=>!Number.isInteger(q.from)||!Number.isInteger(q.to)||q.from<0||q.to>xs.length||q.to<=q.from))
      throw new Error('Invalid trace inspection contract');
    const finite=i=>Number.isFinite(ys[i])&&(!imaginary||Number.isFinite(imaginary[i]));
    return {
      traceId:trace.id, policy, length:xs.length,
      at(x) {
        if (!Number.isFinite(x)||!xs.length||x<xs[0]||x>xs[xs.length-1])
          return {status:'out-of-range',requested:x,traceId:trace.id};
        let lo=0,hi=xs.length-1;
        while(lo<hi) {const mid=(lo+hi)>>1;if(xs[mid]<x)lo=mid+1;else hi=mid;}
        const right=lo,left=xs[right]===x?right:Math.max(0,right-1);
        if(!finite(left)||!finite(right)||!segments.some(q=>left>=q.from&&right<q.to))
          return {status:'gap',requested:x,traceId:trace.id};
        const index=x-xs[left]<=xs[right]-x?left:right;
        const t=right===left?0:(x-xs[left])/(xs[right]-xs[left]);
        const interpolate=a=>policy==='nearest'?a[index]:a[left]+t*(a[right]-a[left]);
        const value=interpolate(ys), result={status:'ok',traceId:trace.id,requested:x,
          x:policy==='nearest'?xs[index]:x,value,index,left,right,policy,unit:trace.unit,xUnit:trace.x.unit};
        if(imaginary) {result.imaginary=interpolate(imaginary);result.magnitude=Math.hypot(value,result.imaginary);
          result.phaseDeg=result.magnitude===0?null:Math.atan2(result.imaginary,value)*180/Math.PI;}
        return result;
      }
    };
  };

  /* ---------- publishing a result to the page (N4-1 / R10) ----------
     The export snapshot used to be built by scraping `.ctl` outputs and
     `[data-out]` text — rounded DISPLAY STRINGS, missing any control outside
     `.ctl`, and stamped with the contract island's version rather than the
     version of the thing that computed the numbers. Those two already differed:
     Lab B's contract read 3.0 while its result read 1.0.

     So a panel publishes the result object itself, and everything downstream —
     the values table, the CSV, the report, A/B — reads that. One object, one
     version, real numbers. Panels with no model keep the DOM path and the
     snapshot SAYS which one it used, rather than quietly mixing them. */
  K.publish = function (root, result) {
    if (root) root.__result = result;
    return result;
  };

  K.published = function (root) {
    return (root && root.__result) || null;
  };

  K.STATUS = ['ok', 'unsupported', 'not-settled', 'no-convergence', 'empty', 'out-of-record'];

  K.result = function (spec) {
    const need = ['model', 'version', 'status', 'params'];
    for (const k of need) {
      if (spec[k] === undefined) throw new Error('K.result: missing ' + k);
    }
    if (!K.STATUS.includes(spec.status)) {
      throw new Error('K.result: unknown status ' + spec.status);
    }
    if (spec.status !== 'ok' && !spec.why) {
      throw new Error('K.result: status ' + spec.status + ' must carry a `why`');
    }
    /* A trace without a stable id is a trace that only colour can identify,
       which is the U4 defect. Refuse it here rather than downstream. */
    const traces = spec.traces || [];
    const ids = new Set();
    for (const t of traces) {
      if (!t.id) throw new Error('K.result: every trace needs a stable id');
      if (ids.has(t.id)) throw new Error('K.result: duplicate trace id ' + t.id);
      ids.add(t.id);
    }
    /* G-12 (N1-2 / R2). `status: 'ok'` is a claim about the NUMBERS, so it is
       computed from them here rather than taken from the solver's opinion of
       itself. Lab B reported ok, settled, 393 valid symbols and a zero periodic
       residual while its eye height was NaN — every one of those came from a
       solver that believed it had converged, and the zero residual was itself a
       failure artifact (a NaN peak makes `peak > 0` false and selects the
       fallback). Scanning the measurements is the only check that cannot be
       fooled that way, because it looks at the answer instead of the process. */
    let status = spec.status, why = spec.why || null;
    const nonFinite = [];

    /* NaN and Infinity are NOT the same failure, and collapsing them was this
       check's first bug. NaN always means the computation broke. Infinity can
       mean the answer is genuinely unbounded and correct: a perfectly matched
       channel has |S11| = 0, so its return loss really is -Infinity dB, and
       refusing that would be refusing the ideal case the gate uses as a
       reference.

       So: NaN is always invalid. An infinity has to be DECLARED by the model,
       naming the measurement and therefore the limit it represents. An
       undeclared infinity is still a failure, because the other thing that
       produces one is a division nobody meant to do. */
    const mayBeInfinite = spec.mayBeInfinite || [];
    if (status === 'ok' && spec.measurements) {
      for (const k of Object.keys(spec.measurements)) {
        const v = spec.measurements[k];
        if (typeof v !== 'number' || Number.isFinite(v)) continue;
        if (Number.isNaN(v) || mayBeInfinite.indexOf(k) < 0) nonFinite.push(k);
      }
      if (nonFinite.length) {
        status = 'unsupported';
        why = 'the model produced a non-finite value for ' + nonFinite.join(', ')
            + ', so this configuration is outside what it can represent';
      }
    }

    return {
      model: spec.model,
      version: spec.version,
      status: status,
      why: why,
      params: spec.params,
      view: spec.view || {},
      units: spec.units || {},
      conventions: spec.conventions || {},
      stimulus: spec.stimulus || null,
      origins: spec.origins || {},
      valid: spec.valid || null,
      traces: traces,
      measurements: status === 'ok' ? (spec.measurements || {}) : null,
      diagnostics: Object.assign({}, spec.diagnostics || {},
        nonFinite.length ? { nonFinite: nonFinite } : null),
      generated: spec.generated || null
    };
  };


  /* The valid sample range is computed here from the record geometry and then
     compared against whatever the model believed. A4 is explicit that a count
     must not simply be returned and trusted — the 393-vs-378 disagreement over
     Lab B's sample count existed because two people each trusted a number. */
  K.validRange = function (first, last, recordLen, stride) {
    const from = Math.max(0, Math.ceil(first));
    const to = Math.min(recordLen - 1, Math.floor(last));
    const count = to < from ? 0 : (stride > 0 ? Math.floor((to - from) / stride) + 1 : to - from + 1);
    return { from, to, count, recordLen, stride: stride || 1 };
  };

  /* ---------- a channel as a cascade of sections ----------
     Lab B shows one network in six domains, so there has to be exactly one
     definition of the network. ABCD (transmission) matrices are the right form:
     cascading is a matrix product, so a via field between two trace lengths is
     three multiplications and every internal re-reflection is included exactly —
     not to first order, which is where a hand-rolled "discontinuity plus load
     echo" treatment stops.

     Sections:
       {type:'line',  z, td, lossDb, dielFrac}   lossy transmission line
       {type:'series', r, l, c}                  R, L and C in series, in series
       {type:'shunt',  r, l, c}                  R, L and C in series, to ground
       {type:'stub',  z, td}                     open-circuit stub, shunted on

     td is in seconds; lossDb is the one-way loss at fRef, split between a √f
     skin term and a linear dielectric term by dielFrac. */

  const cmul = (ar, ai, br, bi) => [ar * br - ai * bi, ar * bi + ai * br];
  const cdiv = (ar, ai, br, bi) => {
    const d = br * br + bi * bi;
    return [(ar * br + ai * bi) / d, (ai * br - ar * bi) / d];
  };

  /* ---------- the causal line (M1-3b, to the contract in docs/channel-model.md) ----------

     What this replaces: attenuation from a sqrt(f) + f mixture, phase from
     w*td alone, and a real z multiplying a complex sinh. Those three are not
     independently choosable. A causal medium ties loss and dispersion together
     through Kramers-Kronig, so a magnitude law with an unrelated linear phase
     produces a network whose impulse response begins before its own propagation
     delay — measured at 47.63% of the energy for a 14 dB line.

     The fix is not a Hilbert transform bolted onto the output. It is to build
     the line out of per-unit-length quantities that are causal to begin with:
       z'(f) = Rs(f)(1 + j) + jwL      the (1 + j) is the causal skin form,
                                       equal resistive and reactive parts
       y'(f) = jw*Cvac*eps_r(f)        eps_r from a wideband Debye distribution
     and take BOTH gamma and Zc from them:
       gamma = sqrt(z'y')              Zc = sqrt(z'/y')

     Clause numbers below refer to docs/channel-model.md. */
  const DS_M1 = 4, DS_M2 = 13;                   // relaxation decades: 10 kHz to 10 THz
  const C_LIGHT = 299792458;
  const NEPER_DB = 8.685889638065035;

  const csqrt = (ar, ai) => {
    const m = Math.hypot(ar, ai);
    const re = Math.sqrt(Math.max(0, (m + ar) / 2));
    let im = Math.sqrt(Math.max(0, (m - ar) / 2));
    if (ai < 0) im = -im;                        // clause 2: principal branch, Re >= 0
    return [re, im];
  };
  const clogQ = (ar, ai) => [Math.log(Math.hypot(ar, ai)), Math.atan2(ai, ar)];

  /* Clause 3 — Djordjevic-Sarkar wideband Debye. Causal by construction: eps'
     and eps'' are the Hilbert pair of one analytic function, so nothing here
     needs a separate Kramers-Kronig correction. */
  K.dsPermittivity = function (f, epsInf, dEps) {
    const num = [Math.pow(10, DS_M2), f], den = [Math.pow(10, DS_M1), f];
    const q = cdiv(num[0], num[1], den[0], den[1]);
    const l = clogQ(q[0], q[1]);
    const scale = dEps / (Math.LN10 * (DS_M2 - DS_M1));
    return [epsInf + scale * l[0], scale * l[1]];   // eps' - j*eps''
  };

  /* Solve eps_inf and delta_eps so that at fRef, Re(eps) is exactly Dk and the
     loss tangent is exactly Df. The plateau form gives the starting delta_eps;
     a few fixed-point steps make both exact. */
  function fitDielectric(Dk, Df, fRef) {
    if (!(Df > 0)) return { epsInf: Dk, dEps: 0 };
    let dEps = Df * Dk * Math.LN10 * (DS_M2 - DS_M1) * 2 / Math.PI;
    let epsInf = Dk;
    for (let i = 0; i < 80; i++) {
      epsInf = Dk - K.dsPermittivity(fRef, 0, dEps)[0];
      const e = K.dsPermittivity(fRef, epsInf, dEps);
      const got = -e[1] / e[0];
      if (!(got > 0)) break;
      if (Math.abs(got - Df) < 1e-15 * Df) break;
      dEps *= Df / got;
    }
    return { epsInf: epsInf, dEps: dEps };
  }

  function gammaZc(M, f) {
    const w = 2 * Math.PI * f;
    const rs = M.rs0 * Math.sqrt(f / M.fRef);
    const zp = [M.rdc + rs, rs + w * M.lext];       // Rs(1+j) + jwL
    const e = K.dsPermittivity(f, M.epsInf, M.dEps);
    const yp = cmul(0, w * M.cvac, e[0], e[1]);     // jw*Cvac*eps_r
    return {
      g: csqrt.apply(null, cmul(zp[0], zp[1], yp[0], yp[1])),
      zc: csqrt.apply(null, cdiv(zp[0], zp[1], yp[0], yp[1]))
    };
  }

  /* Clause 7 — the loss budget is a target, and solving the material from it is
     approximate at first pass because alpha_d uses sqrt(Dk) while propagation
     uses sqrt(eps'(f)). Measure what the line actually gives at fRef and rescale
     until it matches. Two or three iterations, done once per section. */
  K.lineMaterial = function (sec, fallbackRef) {
    /* `||` here meant a lossRefHz of 0 silently became 8 GHz — the sentinel
       class again, an in-band value standing for "not supplied". A zero
       reference frequency is a caller error, not a default. */
    const fRef = sec.lossRefHz !== undefined ? sec.lossRefHz
               : (fallbackRef !== undefined ? fallbackRef : 8e9);
    if (!(fRef > 0)) {
      console.warn('[kit] lineMaterial needs a positive loss reference frequency, got ' + fRef);
      return { fRef: NaN, Dk: NaN, len: NaN, rdc: 0, lext: NaN, cvac: NaN,
               epsInf: NaN, dEps: NaN, rs0: NaN, z: sec.z, td: sec.td,
               wavefront: NaN, nominal: sec.td };
    }
    const Dk = sec.Dk || 4.03;
    const dielFrac = sec.dielFrac === undefined ? 0.5 : sec.dielFrac;
    const lossDb = sec.lossDb || 0;
    const key = [sec.td, sec.z, lossDb, dielFrac, fRef, Dk].join('|');
    if (sec.__mat && sec.__matKey === key) return sec.__mat;

    const len = sec.td * C_LIGHT / Math.sqrt(Dk);         // clause 1
    const M = {
      fRef: fRef, Dk: Dk, len: len, rdc: 0,
      lext: sec.z * Math.sqrt(Dk) / C_LIGHT,
      cvac: 1 / (sec.z * C_LIGHT * Math.sqrt(Dk)),
      epsInf: Dk, dEps: 0, rs0: 0, z: sec.z, td: sec.td
    };
    if (lossDb > 0 && len > 0) {
      // first pass: split the budget between the two mechanisms
      const aD = (dielFrac * lossDb / NEPER_DB) / len;    // nepers/m at fRef
      const aC = ((1 - dielFrac) * lossDb / NEPER_DB) / len;
      let tand = aD * C_LIGHT / (Math.PI * fRef * Math.sqrt(Dk));
      let rs0 = 2 * sec.z * aC;
      for (let i = 0; i < 6; i++) {
        const fit = fitDielectric(Dk, Math.max(tand, 1e-15), fRef);
        M.epsInf = fit.epsInf; M.dEps = fit.dEps; M.rs0 = rs0;
        const got = NEPER_DB * gammaZc(M, fRef).g[0] * len;
        if (!(got > 0)) break;
        if (Math.abs(got - lossDb) < 1e-9) break;
        const scale = lossDb / got;
        tand *= scale; rs0 *= scale;
      }
    }
    /* Clause 8 (N1-2 / R2) — the fitted material has to be a material.

       Solving eps_inf and delta_eps from a loss BUDGET is an inverse problem, and
       nothing in the algebra stops it returning a permittivity no dielectric has.
       Asking a short line for a large loss drives delta_eps up, and
       eps_inf = Dk - plateau(delta_eps) falls through 1 and then through 0.

       Two different failures live there, and only the second is loud:

         eps_inf < 0   sqrt is NaN, and the NaN propagates into the eye. This is
                       what Astra reported.
         0 < eps_inf < 1   NO NaN AT ALL. The line is finite, the eye is plausible,
                       and the wavefront arrives sooner than light crosses the same
                       distance in VACUUM. At 1 inch and 14 dB -- one slider move
                       from Lab B's default -- the wavefront is 65.16 ps against a
                       vacuum transit of 84.73 ps. A causality violation presented
                       as an engineering result, which is worse than a NaN because
                       nothing downstream can detect it.

       So the admissibility boundary is eps_inf >= 1, not eps_inf > 0. Where that
       lands depends on the loss reference frequency, the dielectric fraction and
       Dk together -- at 8 GHz, Dk 4.03, dielFrac 0.5 it is 12.33 dB/inch, but at
       16 GHz it is 27.31 and at dielFrac 1.0 it is 6.13 -- so the limit is
       COMPUTED here rather than tabulated anywhere. */
    M.admissible = M.epsInf >= 1;
    /* maxAdmissibleLoss probes lineMaterial, and an inadmissible probe would ask
       for the limit again — so the limit is computed only on the outermost call. */
    if (!M.admissible && !probingDomain) {
      M.why = 'the loss asked of this length needs a high-frequency permittivity of '
            + M.epsInf.toFixed(3) + ', and no dielectric has one below 1 — the wavefront '
            + 'would arrive before light crosses the same distance in vacuum';
      M.maxLossDb = maxAdmissibleLoss(sec, fRef, Dk, dielFrac);
    }

    /* Clause 4 — the wavefront, the only boundary causality guarantees. As
       f -> infinity, eps' -> eps_inf, so this is the earliest possible arrival.
       Energy between here and the nominal delay is dispersion, not a defect. */
    M.wavefront = M.admissible ? len * Math.sqrt(M.epsInf) / C_LIGHT : NaN;
    M.nominal = sec.td;
    sec.__mat = M; sec.__matKey = key;
    return M;
  };

  /* The largest loss budget this geometry can carry and still fit a real
     dielectric. Bisection, because the relation runs through the whole fit and
     has no closed form -- and it is only ever called to build a message. */
  let probingDomain = false;

  function maxAdmissibleLoss(sec, fRef, Dk, dielFrac) {
    probingDomain = true;
    try {
      return maxAdmissibleLossInner(sec, fRef, Dk, dielFrac);
    } finally {
      probingDomain = false;
    }
  }

  function maxAdmissibleLossInner(sec, fRef, Dk, dielFrac) {
    const probe = (lossDb) => {
      const t = { type: 'line', z: sec.z, td: sec.td, lossDb: lossDb,
                  dielFrac: dielFrac, Dk: Dk, lossRefHz: fRef };
      return K.lineMaterial(t, fRef).epsInf;
    };
    if (!(probe(1e-6) >= 1)) return 0;
    let lo = 1e-6, hi = 1;
    while (probe(hi) >= 1 && hi < 1e4) hi *= 2;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (probe(mid) >= 1) lo = mid; else hi = mid;
    }
    return lo;
  }

  K.lineGammaZc = function (sec, f, fallbackRef) {
    return gammaZc(K.lineMaterial(sec, fallbackRef), f);
  };

  K.sectionABCD = function (sec, f, fRef) {
    const w = 2 * Math.PI * f;
    if (sec.type === 'line') {
      /* Clause 2 — gamma and Zc from ONE pair of per-unit-length quantities, and
         all four ABCD entries complex. B and C are a complex product and a
         complex quotient; the old code multiplied a real z by a complex sinh,
         which is what made the matrix disagree with its own loss law. */
      const M = K.lineMaterial(sec, fRef);
      const { g, zc } = gammaZc(M, Math.max(f, 1e3));    // clause 5: DC at 1 kHz
      const thR = g[0] * M.len, thI = g[1] * M.len;
      const ch = Math.cosh(thR), sh = Math.sinh(thR);
      const c = Math.cos(thI), sn = Math.sin(thI);
      const coshR = ch * c, coshI = sh * sn;             // cosh(thR + j*thI)
      const sinhR = sh * c, sinhI = ch * sn;             // sinh(thR + j*thI)
      const B = cmul(zc[0], zc[1], sinhR, sinhI);
      const C = cdiv(sinhR, sinhI, zc[0], zc[1]);
      return {
        ar: coshR, ai: coshI,
        br: B[0], bi: B[1],
        cr: C[0], ci: C[1],
        dr: coshR, di: coshI
      };
    }
    // impedance of an R-L-C in series
    const zr = sec.r || 0;
    const zi = w * (sec.l || 0) - (sec.c ? 1 / (w * sec.c) : 0);
    if (sec.type === 'series') {
      return { ar: 1, ai: 0, br: zr, bi: zi, cr: 0, ci: 0, dr: 1, di: 0 };
    }
    if (sec.type === 'shunt') {
      const [yr, yi] = cdiv(1, 0, zr, zi);
      return { ar: 1, ai: 0, br: 0, bi: 0, cr: yr, ci: yi, dr: 1, di: 0 };
    }
    if (sec.type === 'stub') {
      /* An open stub of delay td presents Z = −j·Zc·cot(ωtd); as an admittance
         that is +j·tan(ωtd)/Zc, which is finite at ωtd = 0 and blows up at the
         quarter-wave point. Using the admittance form avoids the division by a
         cotangent that is zero there. */
      const t = Math.tan(w * sec.td);
      return { ar: 1, ai: 0, br: 0, bi: 0, cr: 0, ci: t / sec.z, dr: 1, di: 0 };
    }
    return { ar: 1, ai: 0, br: 0, bi: 0, cr: 0, ci: 0, dr: 1, di: 0 };
  };

  K.abcdMul = function (m, n2) {
    const A = cmul(m.ar, m.ai, n2.ar, n2.ai), B = cmul(m.br, m.bi, n2.cr, n2.ci);
    const C = cmul(m.ar, m.ai, n2.br, n2.bi), D = cmul(m.br, m.bi, n2.dr, n2.di);
    const E = cmul(m.cr, m.ci, n2.ar, n2.ai), F = cmul(m.dr, m.di, n2.cr, n2.ci);
    const G = cmul(m.cr, m.ci, n2.br, n2.bi), H = cmul(m.dr, m.di, n2.dr, n2.di);
    return {
      ar: A[0] + B[0], ai: A[1] + B[1],
      br: C[0] + D[0], bi: C[1] + D[1],
      cr: E[0] + F[0], ci: E[1] + F[1],
      dr: G[0] + H[0], di: G[1] + H[1]
    };
  };

  /* S-parameters of the whole cascade at one frequency, referenced to z0.
       denom = A + B/z0 + C·z0 + D
       S11   = (A + B/z0 − C·z0 − D) / denom
       S21   = 2 / denom
     For a reciprocal cascade AD − BC = 1, so S12 = S21; the gate checks that
     rather than this code asserting it. */
  K.cascadeS = function (sections, f, z0, fRef) {
    let M = { ar: 1, ai: 0, br: 0, bi: 0, cr: 0, ci: 0, dr: 1, di: 0 };
    for (let i = 0; i < sections.length; i++) {
      M = K.abcdMul(M, K.sectionABCD(sections[i], f, fRef));
    }
    const nr = M.ar + M.br / z0 + M.cr * z0 + M.dr;
    const ni = M.ai + M.bi / z0 + M.ci * z0 + M.di;
    const pr = M.ar + M.br / z0 - M.cr * z0 - M.dr;
    const pi = M.ai + M.bi / z0 - M.ci * z0 - M.di;
    const s11 = cdiv(pr, pi, nr, ni);
    const s21 = cdiv(2, 0, nr, ni);
    const det = [M.ar * M.dr - M.ai * M.di - (M.br * M.cr - M.bi * M.ci),
                 M.ar * M.di + M.ai * M.dr - (M.br * M.ci + M.bi * M.cr)];
    const s12 = cdiv(2 * det[0], 2 * det[1], nr, ni);
    return { s11r: s11[0], s11i: s11[1], s21r: s21[0], s21i: s21[1],
             s12r: s12[0], s12i: s12[1], abcd: M };
  };

  /* Group delay, −dφ/dω, by central difference on the UNWRAPPED phase. Taking
     the difference of two wrapped phases gives a spike of 2π/Δω wherever the
     branch cut falls, which reads as a resonance that is not there. */
  K.groupDelay = function (sections, f, z0, fRef, df) {
    df = df || Math.max(f * 1e-4, 1e6);
    const lo = K.cascadeS(sections, Math.max(f - df, df), z0, fRef);
    const hi = K.cascadeS(sections, f + df, z0, fRef);
    let d = Math.atan2(hi.s21i, hi.s21r) - Math.atan2(lo.s21i, lo.s21r);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return -d / (2 * Math.PI * 2 * df);
  };

  /* ---------- TDR ----------
     Integrate the S11 impulse response into a reflection coefficient, then read
     it as an impedance:

       rho(t) = integral of the S11 impulse response, band-limited by the edge
       Z(t)   = Z0 (1 + rho) / (1 - rho)

     Band-limited on purpose. That is what an instrument does, and it is what
     makes spatial resolution finite — a profile drawn from an ideal step shows
     discontinuities sharper than any equipment could resolve, which is exactly
     the impression a reader should not be given. Resolution is about
     tr·v/2: the round trip halves it. */
  K.tdrProfile = function (s11Imp, z0, trSamples, nOut) {
    const N = Math.min(s11Imp.length, nOut);
    const k = Math.max(1, Math.round(trSamples));
    const edge = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const u = i / k;
      edge[i] = u >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * u);
    }
    const out = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      let acc = 0;
      for (let j = 0; j <= i; j++) acc += s11Imp[j] * edge[i - j];
      const rho = Math.max(-0.98, Math.min(0.98, acc));
      out[i] = z0 * (1 + rho) / (1 - rho);
    }
    return out;
  };

  /* ---------- Touchstone import ----------
     Reads a 2-port .s2p. Deliberately strict: it validates and refuses rather
     than repairing, because a silently "fixed" network is worse than a rejected
     one — the reader gets a plausible answer to a question about a file that
     does not say what they think it says.

     What it checks, and why each one has burned somebody:
       - the option line exists and is understood (unit, format, parameter, R)
       - the parameter is S, not Y/Z/H/G
       - the reference impedance is stated, and is what the caller expects
       - every data line has 1 + 2*n^2 numbers for an n-port
       - frequencies ascend strictly — a reordered file transforms to nonsense
       - magnitudes are not absurd for a passive part (a silent dB/MA mix-up)

     Port order is the one thing a file cannot tell you. Touchstone 1.0 fixes
     2-port ordering as S11 S21 S12 S22 — note S21 BEFORE S12, which is the
     opposite of the row-major order everyone assumes — so that is applied, and
     said out loud in the result rather than left implicit. */
  /* N4-9. The parser's own version, so an imported file's report can say which
     code read it. Bumped when the ACCEPTED GRAMMAR or the returned shape
     changes, not when a message is reworded. */
  K.TOUCHSTONE_VERSION = '1.1';

  K.parseTouchstone = function (text, opts) {
    opts = opts || {};
    const warn = [];
    const fail = (msg) => ({ ok: false, error: msg, warnings: warn });
    if (typeof text !== 'string' || !text.trim()) return fail('empty file');

    const MULT = { hz: 1, khz: 1e3, mhz: 1e6, ghz: 1e9 };
    let unit = 1e9, format = 'ma', param = 's', z0 = 50, sawOption = false;
    const rows = [];

    const lines = text.split(/\r\n|\r|\n/);
    for (let i = 0; i < lines.length; i++) {
      let ln = lines[i];
      const bang = ln.indexOf('!');
      if (bang >= 0) ln = ln.slice(0, bang);       // ! starts a comment
      ln = ln.trim();
      if (!ln) continue;

      if (ln[0] === '[') {                          // Touchstone 2.0 keyword
        return fail('this is a Touchstone 2.0 file (it uses [Version] style '
                    + 'keywords); only 1.0 .s2p is supported');
      }
      if (ln[0] === '#') {
        if (sawOption) return fail('more than one option line');
        sawOption = true;
        const t = ln.slice(1).trim().toLowerCase().split(/\s+/).filter(Boolean);
        for (let k = 0; k < t.length; k++) {
          if (MULT[t[k]] !== undefined) unit = MULT[t[k]];
          else if (t[k] === 's' || t[k] === 'y' || t[k] === 'z' || t[k] === 'h' || t[k] === 'g') param = t[k];
          else if (t[k] === 'ma' || t[k] === 'db' || t[k] === 'ri') format = t[k];
          else if (t[k] === 'r') { z0 = parseFloat(t[k + 1]); k++; }
          else return fail('unrecognised token in the option line: ' + t[k]);
        }
        continue;
      }
      const nums = ln.split(/[\s,]+/).map(Number);
      if (nums.some((v) => !isFinite(v))) return fail('non-numeric data on line ' + (i + 1));
      rows.push(nums);
    }

    if (!sawOption) return fail('no option line (the "# HZ S RI R 50" line) — refusing to guess');
    if (param !== 's') return fail('parameter is "' + param.toUpperCase() + '", not S');
    if (!(z0 > 0)) return fail('reference impedance is missing or not positive');
    if (opts.expectZ0 && Math.abs(z0 - opts.expectZ0) > 1e-9) {
      return fail('file is referenced to ' + z0 + ' ohm, not ' + opts.expectZ0
                  + ' — renormalise it rather than using it as is');
    }
    if (!rows.length) return fail('no data rows');

    const wide = 1 + 2 * 4;                         // 2-port: f + 8 numbers
    if (rows[0].length !== wide) {
      const n = Math.sqrt((rows[0].length - 1) / 2);
      return fail('each row has ' + rows[0].length + ' numbers, which is a '
                  + (Number.isInteger(n) ? n + '-port' : 'malformed') + ' file; only 2-port is supported');
    }

    const f = new Float64Array(rows.length);
    const S = [];
    let prev = -Infinity, worst = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.length !== wide) return fail('row ' + (i + 1) + ' has ' + r.length + ' numbers, expected ' + wide);
      /* M5-10 · Validate the CONVERTED value, not the parsed one. `isFinite` on
         the raw number passes 1e308, and 1e308 in GHz is Infinity — a finite
         file producing an infinite frequency, which then propagates silently
         into every transform downstream. */
      if (r[0] < 0) {
        return fail('negative frequency ' + r[0] + ' at row ' + (i + 1)
                    + ' — a real-signal S-parameter file has none');
      }
      f[i] = r[0] * unit;
      if (!isFinite(f[i])) {
        return fail('frequency at row ' + (i + 1) + ' overflows once converted from '
                    + Object.keys(MULT).find((k) => MULT[k] === unit).toUpperCase()
                    + ' to hertz (' + r[0] + ' x ' + unit + ')');
      }
      if (!(f[i] > prev)) {
        return fail('frequencies are not strictly ascending at row ' + (i + 1)
                    + ' (' + r[0] + ') — a reordered file transforms to nonsense');
      }
      prev = f[i];
      const e = [];
      for (let k = 0; k < 4; k++) {
        const a = r[1 + 2 * k], b = r[2 + 2 * k];
        let re, im;
        if (format === 'ri') { re = a; im = b; }
        else {
          const mag = format === 'db' ? Math.pow(10, a / 20) : a;
          if (!isFinite(mag)) {
            return fail('magnitude at row ' + (i + 1) + ' overflows once converted from '
                        + format.toUpperCase() + ' (' + a + ' dB is 10^' + (a / 20) + ')');
          }
          const th = b * Math.PI / 180;
          re = mag * Math.cos(th); im = mag * Math.sin(th);
        }
        if (!isFinite(re) || !isFinite(im)) {
          return fail('S-parameter at row ' + (i + 1) + ' is not finite after conversion');
        }
        e.push({ re: re, im: im });
        worst = Math.max(worst, Math.hypot(re, im));
      }
      /* Touchstone 1.0 two-port order: S11 S21 S12 S22. */
      S.push({ s11: e[0], s21: e[1], s12: e[2], s22: e[3] });
    }

    if (worst > 1.05) {
      warn.push('a magnitude of ' + worst.toFixed(2) + ' means gain — either this is an '
                + 'active part, or the format is not "' + format.toUpperCase() + '"');
    }
    if (f[0] > 1e6) {
      warn.push('lowest frequency is ' + (f[0] / 1e6).toFixed(1) + ' MHz; with no DC point a '
                + 'time-domain transform has to extrapolate one');
    }
    return {
      ok: true, f: f, S: S, z0: z0, format: format, points: rows.length,
      portOrder: 'Touchstone 1.0 two-port: S11 S21 S12 S22 (S21 before S12)',
      /* M5-10 · What this parser accepts, stated rather than implied. It is a
         small strict reader for one shape of file, and advertising "Touchstone
         support" from a parser-only test set would overstate it considerably. */
      accepts: {
         versions: ['1.0'],
         ports: [2],
         parameters: ['S'],
         formats: ['MA', 'DB', 'RI'],
         units: ['Hz', 'kHz', 'MHz', 'GHz'],
         notSupported: ['Touchstone 2.0 keywords', 'noise data (the 5-column '
           + 'trailing block)', 'more or fewer than 2 ports', 'Y/Z/H/G parameters',
           'per-port reference impedances', 'interpolation or renormalisation']
      },
      warnings: warn
    };
  };

  /* ---------- a PDN as a ladder ----------
     Lab C needs more than the impedance the die sees: it needs to know which
     bank is supplying the current at each frequency, which is the whole content
     of "why is there a peak here". So the network is reduced as an explicit
     ladder with named nodes rather than collapsed into a two-port.

     stages run from the VRM end to the die. Each has an optional series branch
     (the plane or package inductance getting there) and a shunt branch (the
     capacitor bank sitting at that node):

       {name, series:{r,l}|null, shunt:{r,l,c,n}|null}

     n is how many identical parts are in parallel, which divides R and L and
     multiplies C — the reason adding capacitors lowers impedance in two ways at
     once and why the mounting inductance is what eventually stops helping.

     K.cascadeS is the right tool for a two-port channel and the wrong one here;
     the model gate asserts the two agree on the input impedance, so this stays a
     second view of one circuit rather than a second circuit. */

  K.zBranch = function (b, w) {
    if (!b) return null;
    const n = b.n || 1;
    const r = (b.r || 0) / n;
    const l = (b.l || 0) / n;
    const c = (b.c || 0) * n;
    /* A branch with no capacitor is a plain series R + jωL — used for the VRM,
       whose output impedance is resistive inside the loop bandwidth and rises
       like an inductor beyond it. */
    return { re: r, im: w * l - (c > 0 ? 1 / (w * c) : 0) };
  };

  const zpar = (a, b) => {
    if (!a) return b;
    if (!b) return a;
    const sr = a.re + b.re, si = a.im + b.im;
    const pr = a.re * b.re - a.im * b.im, pi = a.re * b.im + a.im * b.re;
    const d = sr * sr + si * si;
    if (d === 0) return { re: 0, im: 0 };
    return { re: (pr * sr + pi * si) / d, im: (pi * sr - pr * si) / d };
  };

  /* Impedance looking back from the die, plus where the current comes from.
     Reduce from the VRM end to get Z; then inject 1 A at the die and walk the
     other way to get every node voltage and branch current. */
  K.pdnLadder = function (stages, f) {
    const w = 2 * Math.PI * Math.max(f, 1e-9);
    const zAt = [];                       // impedance looking upstream from node i
    let acc = null;
    for (let i = 0; i < stages.length; i++) {
      const st = stages[i];
      const se = K.zBranch(st.series, w);
      if (se) acc = acc ? { re: acc.re + se.re, im: acc.im + se.im } : se;
      acc = zpar(acc, K.zBranch(st.shunt, w));
      zAt[i] = acc;
    }
    const z = zAt[zAt.length - 1] || { re: 0, im: 0 };

    // 1 A into the die node; split it between that node's shunt and the way back
    const branches = [];
    let vNode = z, remaining = { re: 1, im: 0 };
    for (let i = stages.length - 1; i >= 0; i--) {
      const sh = K.zBranch(stages[i].shunt, w);
      let iSh = { re: 0, im: 0 };
      if (sh) {
        const d = sh.re * sh.re + sh.im * sh.im;
        iSh = d === 0 ? { re: 0, im: 0 }
                      : { re: (vNode.re * sh.re + vNode.im * sh.im) / d,
                          im: (vNode.im * sh.re - vNode.re * sh.im) / d };
      }
      /* M2-6 · Keep the PHASORS. Storing only |i| made complex KCL impossible
         from the outside, so the gate's "current conservation" test summed
         magnitudes and asserted the total was finite and under 50 — which a
         reversed sign, or any phase error, cannot disturb. Banks fight each
         other out of phase and their magnitudes legitimately sum past 1 A;
         the complex sum is what has to come to exactly the injected current. */
      branches[i] = { name: stages[i].name,
                      ir: iSh.re, ii: iSh.im, i: Math.hypot(iSh.re, iSh.im),
                      vr: vNode.re, vi: vNode.im,
                      v: Math.hypot(vNode.re, vNode.im),
                      phase: Math.atan2(iSh.im, iSh.re) * 180 / Math.PI };
      remaining = { re: remaining.re - iSh.re, im: remaining.im - iSh.im };
      if (i > 0) {
        const up = zAt[i - 1];
        // what is left flows upstream through the series branch into node i-1
        vNode = { re: remaining.re * up.re - remaining.im * up.im,
                  im: remaining.re * up.im + remaining.im * up.re };
      }
    }
    /* What the recursion has left over after every shunt has taken its share.
       For a ladder whose top node has only a shunt path there is nowhere else
       for current to go, so this must be zero — and that IS the KCL check,
       available to any caller rather than reconstructed by one. */
    const unaccounted = { re: remaining.re, im: remaining.im };
    return {
      z, mag: Math.hypot(z.re, z.im), phase: Math.atan2(z.im, z.re) * 180 / Math.PI,
      branches, unaccounted,
      /* Transfer impedance: the volts appearing at the VRM node per amp drawn at
         the die. It is what says whether a noisy core disturbs a quiet rail on
         the same plane, and it is not the same question as |Z| at the die. */
      zTransfer: branches[0] ? branches[0].v : 0
    };
  };

  /* The transient, done the way it is actually done: transform the current
     waveform, multiply by Z(f), transform back.

     Not by inverse-transforming Z on its own. At high frequency this ladder is
     an inductor, so |Z| grows without bound and its impulse response is L·δ′(t)
     — a doublet, which no sampled grid represents and which spreads energy
     across the whole record. The current waveform has a finite rise time and so
     rolls off; the product does too, and the voltage that comes back is the one
     the circuit would actually develop.

     The window is a stated limitation. 200 ns at 25 ps resolves the package and
     die resonances, which is where PDN noise becomes jitter. The first droop is
     below a megahertz and is simply not in this window — the frequency panel is
     where you look for it. */
  K.pdnTransient = function (stages, current, dt) {
    const n = current.length;
    const re = Float64Array.from(current), im = new Float64Array(n);
    K.fft(re, im, false);
    const fs = 1 / dt;
    for (let k = 0; k <= n / 2; k++) {
      const f = Math.max(k * fs / n, (fs / n) * 1e-6);
      const z = K.pdnLadder(stages, f).z;
      const ar = re[k] * z.re - im[k] * z.im, ai = re[k] * z.im + im[k] * z.re;
      re[k] = ar; im[k] = ai;
      if (k > 0 && k < n / 2) { re[n - k] = ar; im[n - k] = -ai; }
    }
    K.fft(re, im, true);
    return re;
  };

  /* Multi-node PDN: positive RHS is injection; Z[observe,excite] is V/A.
     Passive ladder with finite positive resistance in every connected branch.
     Capacitive branches are exactly open at DC. Ideal shorts are refused. */
  K.pdnNodal = function (stages, f, nodes) {
    if (!Number.isFinite(f) || f < 0 || !stages.length) throw new Error('Invalid PDN frequency/network');
    const n = stages.length, w = 2 * Math.PI * f;
    const add = (a,b) => ({re:a.re+b.re, im:a.im+b.im});
    const mul = (a,b) => ({re:a.re*b.re-a.im*b.im, im:a.re*b.im+a.im*b.re});
    const sub = (a,b) => ({re:a.re-b.re, im:a.im-b.im});
    const div = (a,b) => {
      const d=b.re*b.re+b.im*b.im;
      if (!(d > 0) || !Number.isFinite(d)) throw new Error('Singular PDN network');
      return {re:(a.re*b.re+a.im*b.im)/d, im:(a.im*b.re-a.re*b.im)/d};
    };
    const zero = () => ({re:0, im:0});
    const adm = b => {
      if (!b) return zero();
      if (!(b.r > 0) || !Number.isFinite(b.r) || !Number.isFinite(b.l || 0)
          || (b.l || 0) < 0 || !Number.isFinite(b.c || 0) || (b.c || 0) < 0
          || (b.n !== undefined && (!Number.isInteger(b.n) || b.n < 1)))
        throw new Error('PDN branches require positive finite R and nonnegative finite L/C');
      if (f === 0 && b.c > 0) return zero();
      return div({re:1, im:0}, K.zBranch(b,w));
    };
    if (stages[0].series || stages.slice(1).some(st => !st.series))
      throw new Error('PDN requires a connected ladder');
    const sh=stages.map(st => adm(st.shunt)), se=stages.map(st => adm(st.series));
    const diag=sh.map((y,i) => add(add(y,se[i]),i+1<n?se[i+1]:zero()));
    const off=se.map(y => ({re:-y.re,im:-y.im})), factors=[];
    for(let i=1;i<n;i++) {
      factors[i]=div(off[i],diag[i-1]);
      diag[i]=sub(diag[i],mul(factors[i],off[i]));
    }
    return nodes.map(node => {
      if (!Number.isInteger(node) || node<0 || node>=n) throw new Error('Invalid PDN node');
      const rhs=Array.from({length:n},(_,i)=>({re:i===node?1:0,im:0}));
      for(let i=1;i<n;i++) rhs[i]=sub(rhs[i],mul(factors[i],rhs[i-1]));
      const v=new Array(n); v[n-1]=div(rhs[n-1],diag[n-1]);
      for(let i=n-2;i>=0;i--) v[i]=div(sub(rhs[i],mul(off[i+1],v[i+1])),diag[i]);
      return v;
    });
  };

  /* Signed rail deviation from withdrawals: dV_i = -sum_j Zij Ij.
     Keep each load contribution so comparison is a view operation. */
  K.pdnMultiTransient = function (stages, loads, dt, observe) {
    const n=loads.length && loads[0].current.length;
    if (!(dt>0) || !Number.isFinite(dt) || n<2 || (n & (n-1))
        || observe.some(i=>!Number.isInteger(i)||i<0||i>=stages.length)
        || loads.some(l=>l.current.length!==n || !Array.from(l.current).every(Number.isFinite)))
      throw new Error('Invalid PDN transient grid/current');
    const spectra=loads.map(l=>{
      const re=Float64Array.from(l.current), im=new Float64Array(n);
      K.fft(re,im,false); return {re,im};
    });
    const out=observe.map(()=>loads.map(()=>({re:new Float64Array(n),im:new Float64Array(n)})));
    for(let k=0;k<=n/2;k++) {
      const cols=K.pdnNodal(stages,k/(n*dt),loads.map(l=>l.node));
      observe.forEach((node,a)=>loads.forEach((l,b)=>{
        const z=cols[b][node], I=spectra[b], q=out[a][b];
        const re=-(z.re*I.re[k]-z.im*I.im[k]);
        const im=k===0||k===n/2?0:-(z.re*I.im[k]+z.im*I.re[k]);
        q.re[k]=re; q.im[k]=im;
        if(k>0&&k<n/2) {q.re[n-k]=re;q.im[n-k]=-im;}
      }));
    }
    return out.map(parts=>{
      parts.forEach(q=>K.fft(q.re,q.im,true));
      return {parts:parts.map(q=>q.re), combined:Float64Array.from(parts[0].re,(_,i)=>parts.reduce((a,q)=>a+q.re[i],0))};
    });
  };

  /* Zero-state causal response of the supported RL/series-RLC ladder.
     Capacitor-bank currents i and voltages c obey
       M i' + R i + c = -Br I - Bl I',  c'=diag(1/C)i.
     M/R are shared source-path L/R plus each bank's own L/R.
     Put u=i+M^-1 Bl I to remove the input derivative from the state equation.
     A small matrix exponential advances [u,c] exactly for linearly interpolated
     currents; analytic input derivatives recover the inductive output voltage.
     This differs from the independent trapezoidal nodal reference in tests. */
  K.pdnCausalTransient = function (stages, loads, dt, observe) {
    const banks=stages.length-1, n=loads.length&&loads[0].current.length;
    if(banks<1||!Number.isFinite(dt)||dt<=0||n<2||!loads.length
        ||stages[0].series||!stages[0].shunt||stages[0].shunt.c
        ||observe.some(k=>!Number.isInteger(k)||k<1||k>banks)
        ||loads.some(l=>!Number.isInteger(l.node)||l.node<1||l.node>banks
          ||l.current.length!==n||!l.derivative||l.derivative.length!==n
          ||l.current[0]!==0||l.derivative[0]!==0
          ||!Array.from(l.current).every(Number.isFinite)||!Array.from(l.derivative).every(Number.isFinite)))
      throw new Error('Invalid causal PDN grid, nodes or zero-state stimulus');
    const branch=b=>{
      if(!b||!Number.isFinite(b.r)||b.r<=0||!Number.isFinite(b.l)||b.l<=0
          ||(b.c!==undefined&&(!Number.isFinite(b.c)||b.c<=0))
          ||(b.n!==undefined&&(!Number.isInteger(b.n)||b.n<1))) throw new Error('Unsupported causal PDN branch');
      const count=b.n||1;return {r:b.r/count,l:b.l/count,c:b.c?b.c*count:0};
    };
    const source=branch(stages[0].shunt), sh=stages.slice(1).map(s=>branch(s.shunt));
    const se=stages.slice(1).map(s=>branch(s.series));
    if(sh.some(b=>!b.c)||se.some(b=>b.c)) throw new Error('Causal PDN requires RL links and series RLC banks');
    const zeros=(r,c)=>Array.from({length:r},()=>Array(c).fill(0));
    const mul=(a,b)=>a.map(row=>b[0].map((_,j)=>row.reduce((sum,v,k)=>sum+v*b[k][j],0)));
    const inv=a=>{
      const m=a.length,q=a.map((row,i)=>[...row,...Array.from({length:m},(_,j)=>+(i===j))]);
      for(let k=0;k<m;k++) {
        let pivot=k;for(let i=k+1;i<m;i++) if(Math.abs(q[i][k])>Math.abs(q[pivot][k])) pivot=i;
        [q[k],q[pivot]]=[q[pivot],q[k]];
        const d=q[k][k];if(!Number.isFinite(d)||Math.abs(d)<1e-30) throw new Error('Singular causal PDN network');
        for(let j=0;j<2*m;j++) q[k][j]/=d;
        for(let i=0;i<m;i++) if(i!==k) {const f=q[i][k];for(let j=0;j<2*m;j++) q[i][j]-=f*q[k][j];}
      }
      return q.map(row=>row.slice(m));
    };
    const path=(k,j,key)=>source[key]+se.slice(0,Math.min(k,j)).reduce((s,b)=>s+b[key],0);
    const mass=zeros(banks,banks), resistance=zeros(banks,banks);
    for(let k=0;k<banks;k++) for(let j=0;j<banks;j++) {
      mass[k][j]=path(k+1,j+1,'l')+(k===j?sh[k].l:0);
      resistance[k][j]=path(k+1,j+1,'r')+(k===j?sh[k].r:0);
    }
    const inverse=inv(mass), mr=mul(inverse,resistance);
    const bl=zeros(banks,loads.length), br=zeros(banks,loads.length);
    for(let k=0;k<banks;k++) loads.forEach((l,j)=>{bl[k][j]=path(k+1,l.node,'l');br[k][j]=path(k+1,l.node,'r');});
    const b=mul(inverse,bl), mbr=mul(inverse,br), mrb=mul(mr,b);
    const dim=2*banks,A=zeros(dim,dim),F=zeros(dim,loads.length);
    for(let k=0;k<banks;k++) {
      for(let j=0;j<banks;j++) {A[k][j]=-mr[k][j];A[k][j+banks]=-inverse[k][j];}
      A[k+banks][k]=1/sh[k].c;
      loads.forEach((_,j)=>{F[k][j]=mrb[k][j]-mbr[k][j];F[k+banks][j]=-b[k][j]/sh[k].c;});
    }
    // Augmented state [x, I, delta-I], with unit-length normalized step.
    const size=dim+2*loads.length,H=zeros(size,size);
    for(let i=0;i<dim;i++) {
      for(let j=0;j<dim;j++) H[i][j]=dt*A[i][j];
      loads.forEach((_,j)=>{H[i][dim+j]=dt*F[i][j];});
    }
    loads.forEach((_,j)=>{H[dim+j][dim+loads.length+j]=1;});
    const norm=Math.max(...H.map(row=>row.reduce((s,v)=>s+Math.abs(v),0)));
    const scale=Math.max(0,Math.ceil(Math.log2(norm/.5))), factor=2**scale;
    const small=H.map(row=>row.map(v=>v/factor));
    let term=zeros(size,size),exp=zeros(size,size);
    for(let i=0;i<size;i++) term[i][i]=exp[i][i]=1;
    let converged=false;
    for(let k=1;k<=40;k++) {
      term=mul(term,small).map(row=>row.map(v=>v/k));
      let max=0;for(let i=0;i<size;i++) for(let j=0;j<size;j++) {exp[i][j]+=term[i][j];max=Math.max(max,Math.abs(term[i][j]));}
      if(max<1e-17){converged=true;break;}
    }
    if(!converged) throw new Error('Causal PDN matrix exponential did not converge');
    for(let k=0;k<scale;k++) exp=mul(exp,exp);
    const out=observe.map(()=>({parts:loads.map(()=>new Float64Array(n)),combined:new Float64Array(n)}));
    // Evolve separate load contributions, preserving comparison/superposition semantics.
    loads.forEach((load,l)=>{
      let x=new Float64Array(dim),next=new Float64Array(dim);
      for(let t=0;t<n;t++) {
        const current=load.current[t],derivative=load.derivative[t];
        if(t) {
          const previous=load.current[t-1],delta=current-previous;
          for(let i=0;i<dim;i++) {
            let v=exp[i][dim+l]*previous+exp[i][dim+loads.length+l]*delta;
            for(let j=0;j<dim;j++) v+=exp[i][j]*x[j];next[i]=v;
          }
          [x,next]=[next,x];
        }
        observe.forEach((node,j)=>{
          const k=node-1,bank=sh[k],ib=x[k]-b[k][l]*current;
          let dib=F[k][l]*current-b[k][l]*derivative;
          for(let m=0;m<dim;m++) dib+=A[k][m]*x[m];
          const voltage=bank.r*ib+bank.l*dib+x[k+banks];
          if(!Number.isFinite(voltage)) throw new Error('Non-finite causal PDN response');
          out[j].parts[l][t]=voltage;out[j].combined[t]+=voltage;
        });
      }
    });
    return out;
  };

  /* ---------- what a finite run can actually evidence ----------
     An eye drawn from a few hundred symbols is not a 1e-12 eye, and the number
     beside it must not imply that it is. With zero errors observed in n symbols
     the 95% upper confidence bound on the error rate is −ln(0.05)/n ≈ 3/n — so a
     900-symbol run evidences "better than about 3e-3", eight decades short of the
     number a compliance spec asks for.

     This is the guard behind P4-7. Anything reporting an eye or a margin from a
     simulated run states this floor beside it; anything claiming a lower number
     is extrapolating from a model and has to say so. */
  K.berFloor = function (n) {
    if (!(n > 0)) return NaN;
    return 2.9957322735539909 / n;          // −ln(0.05)
  };

  /* M1-8 · The rule of three is a CONDITIONAL statement and this helper used to
     state it unconditionally. It was handed a symbol count and nothing else, so
     it announced "393 symbols evidences BER better than 7.6e-3" on a channel
     that was making 96 wrong decisions — a zero-error bound printed beside a
     hundred errors. Two separate things were wrong with that:

     First, the bound only applies when the observed error count is ZERO. With
     k errors in n trials the 95% upper bound is larger, and the honest summary
     is the measured rate, not an upper bound borrowed from the k = 0 case.

     Second, the rule of three assumes independent Bernoulli trials. One period
     of a repeating PRBS7 is a deterministic pattern with no noise process: its
     samples are reproducible, not random, so 393 of them are not 393 trials.
     What a finite pattern gives is a worst case OVER THAT PATTERN, which is a
     different claim and is stated as one.

     `opts.independent` is the opt-in for the case where a caller really does
     have independent trials. Nothing in this project sets it yet. */
  K.berFloorText = function (n, errors, opts) {
    if (!(n > 0)) return 'no valid symbols — nothing measured';
    const k = errors === undefined ? null : errors;
    const pattern = (opts && opts.pattern) || 'a repeating deterministic pattern';

    if (k === null) {
      return n + ' symbols of ' + pattern + ' · error count not reported, '
        + 'so no rate is claimed';
    }
    if (k > 0) {
      return k + ' wrong decision' + (k === 1 ? '' : 's') + ' in ' + n
        + ' symbols · ' + (k / n).toExponential(1) + ' over this pattern, '
        + 'not a BER — the pattern is deterministic and repeated';
    }
    if (opts && opts.independent) {
      return n + ' independent trials, 0 errors · BER better than '
        + K.berFloor(n).toExponential(1) + ' at 95% confidence';
    }
    return '0 wrong decisions in ' + n + ' symbols of ' + pattern
      + ' · worst case over this pattern, not a BER — '
      + K.berFloor(n).toExponential(1) + ' would need ' + n
      + ' INDEPENDENT trials';
  };

  /* ---------- colour as identity ----------
     Normalises every spelling of a colour to one string, so a legend swatch
     written `var(--signal)` and a trace drawn with the resolved token compare
     equal. The 2d context is the normaliser the browser already ships: assigning
     fillStyle and reading it back returns a canonical form. */
  K.colourKey = (function () {
    let probeCtx = null;
    return function (c) {
      if (!c) return '';
      if (!probeCtx) probeCtx = document.createElement('canvas').getContext('2d');
      probeCtx.fillStyle = '#000';
      probeCtx.fillStyle = String(c).trim();
      return probeCtx.fillStyle;
    };
  })();

  /* ---------- ask a panel to redraw ----------
     Every module in this codebase re-renders on `input` from its own controls —
     that is what makes applyScenario work — so dispatching one is the redraw
     signal that already exists. Nothing new for a module to implement, and a
     module that ignored it was already broken for the scenario links. */
  /* ---------- repaint, which is not the same as rebuild (N4-2 / R10) ----------
     Every caller of `K.redraw` in the loader is a VIEW operation: hiding a
     trace, zooming, resetting a zoom, switching a tab. None of them changes a
     model parameter. But `redraw` nudges a physical control, and a module cannot
     tell that nudge apart from the reader moving the slider — so in Lab B a
     legend toggle cleared the selected preset, rebuilt the whole pipeline and
     abandoned a running sweep.

     `repaint` asks for pixels instead. A module that listens marks the event
     handled and redraws from the result it already has; a module that does not
     falls back to the old nudge, so nothing regresses while the modules are
     converted one at a time. */
  K.repaint = function (root) {
    if (!root) return false;
    const ev = new CustomEvent('sipi:repaint', { detail: { handled: false } });
    root.dispatchEvent(ev);
    if (ev.detail.handled) return true;
    return K.redraw(root);
  };

  /* The module side of that contract, so each panel is one line rather than
     five, and they cannot drift in how they mark the event handled. */
  K.onRepaint = function (root, fn) {
    const h = (e) => { e.detail.handled = true; fn(); };
    root.addEventListener('sipi:repaint', h);
    return () => root.removeEventListener('sipi:repaint', h);
  };

  K.redraw = function (root) {
    /* Explicitly the range, select or checkbox — NOT `.ctl input`. numericEntry
       inserts its text box ahead of the range in document order, and that box has
       no id and reacts to `change`, so a plain `input` on it dispatched into
       nothing and every caller silently did nothing at all. */
    const c = root.querySelector('.ctl input[type="range"], .ctl select, .ctl input[type="checkbox"]');
    if (!c) { console.warn('[viz] redraw found no control to nudge'); return false; }
    c.dispatchEvent(new Event(c.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    return true;
  };

  /* ---------- probe cursor ----------
     Reads the value under the pointer in the plot's own units. Deliberately NOT
     drawn on the canvas: the module owns that surface and repaints it whenever a
     control moves, so anything the probe drew there would be erased or would have
     to be re-drawn from outside the module's render loop. An absolutely positioned
     overlay sits above it instead and survives every repaint for free.

     Keyboard is not a second-class path here. Arrow keys step the probe along x,
     and the readout is a live region, so "what is the impedance at 2 GHz" is
     answerable without a mouse. */
  K.probe = function (cv) {
    if (cv.__probed || (cv.dataset && cv.dataset.inspection==='native')) return;
    cv.__probed = 1;

    const host = document.createElement('div');
    host.className = 'probe-host';
    cv.parentNode.insertBefore(host, cv);
    host.appendChild(cv);

    const ov = document.createElement('div');
    ov.className = 'probe';
    ov.innerHTML = '<i class="probe__v"></i><i class="probe__h"></i><b class="probe__tag"></b>';
    host.appendChild(ov);
    const vl = ov.querySelector('.probe__v'), hl = ov.querySelector('.probe__h'),
          tag = ov.querySelector('.probe__tag');

    const live = document.createElement('p');
    live.className = 'probe__live';
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    host.appendChild(live);

    cv.tabIndex = 0;
    let at = null;                                  // css px within the canvas

    function show(px, py, speak) {
      const P = cv.__plot;
      if (!P) return;
      const b = P.box;
      px = Math.max(b.L, Math.min(b.R, px));
      py = Math.max(b.TP, Math.min(b.B, py));
      at = [px, py];
      /* Axis titles are two different things across the modules: sometimes the
         unit ('mV', 'ns') with a bare-number formatter, sometimes the quantity
         ('frequency') with a formatter that already prints the unit. Appending
         the title only when the formatted value carries no letters of its own
         gets both right, and never produces '2.0 GHz frequency'. */
      const unitise = (v, a) => {
        const t = (a.fmt || K.fmt.num)(v);
        return a.title && !/[a-zA-Z\u00b5\u03a9%\u00b0]/.test(t) ? t + ' ' + a.title : t;
      };
      const xv = unitise(P.invX(px), P.ax);
      const yv = unitise(P.invY(py), P.ay);

      /* M5-3 · What the TRACES say at this x, which is a different question from
         where the pointer is. Each recorded series is interpolated at the
         cursor's x and reported by its own colour swatch, so "what is this
         bank's current at 12 MHz" has an answer. The free coordinates are still
         shown, and now labelled as coordinates. */
      const xAt = P.invX(px);
      const reads = [];
      (cv.__traces || []).forEach((tr) => {
        if (cv.__hidden && cv.__hidden.has(tr.key || tr.colour)) return;
        const pts = tr.pts;
        if (!pts || pts.length < 2) return;
        /* The recorded x may ascend or descend; find the bracketing pair either
           way, and refuse to extrapolate past the ends. */
        let lo = -1;
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i][0], b = pts[i + 1][0];
          if ((xAt >= a && xAt <= b) || (xAt <= a && xAt >= b)) { lo = i; break; }
        }
        if (lo < 0) return;
        const [x0, y0] = pts[lo], [x1, y1] = pts[lo + 1];
        if (!isFinite(y0) || !isFinite(y1)) return;
        const t = x1 === x0 ? 0 : (xAt - x0) / (x1 - x0);
        reads.push({ colour: tr.colour, dash: tr.dash, v: y0 + t * (y1 - y0),
                     label: tr.label || null, unit: tr.unit || null });
      });
      const scale = cv.clientWidth / b.w;           // the canvas is laid out fluid
      vl.style.left = px * scale + 'px';
      vl.style.top = b.TP * scale + 'px';
      vl.style.height = (b.B - b.TP) * scale + 'px';
      hl.style.top = py * scale + 'px';
      hl.style.left = b.L * scale + 'px';
      hl.style.width = (b.R - b.L) * scale + 'px';
      /* The trace readings lead, because they are measurements. The pointer's
         own position follows, labelled, because it is not. */
      const fmtY = (v) => (P.ay.fmt || K.fmt.num)(v)
        + (P.ay.title && !/[a-zA-Z\u00b5\u03a9]/.test((P.ay.fmt || K.fmt.num)(v))
           ? ' ' + P.ay.title : '');
      /* N4-6 / R10. A reading used to be a colour swatch and a number. "12 MHz,
         -3.2" is a COORDINATE; a measurement says which quantity it belongs to
         and in what unit. The series name leads, its own unit is preferred over
         the axis's when it has one, and the swatch stays as a second cue rather
         than the only one. */
      /* A formatter that already prints a unit must not have another appended.
         Letters are the obvious case; %, degrees and ohms are units too and
         carry no letters, which produced "0% A per A at the die". */
      const carriesUnit = (t) => /[a-zA-Z\u00b5\u03a9%\u00b0]/.test(t);
      const readText = (r) => {
        const n = (P.ay.fmt || K.fmt.num)(r.v);
        if (r.unit) return carriesUnit(n) ? n : n + ' ' + r.unit;
        return fmtY(r.v);
      };
      tag.innerHTML = '<span class="probe__x">' + xv + '</span>'
        + reads.map((r) => '<span class="probe__t">'
            + '<i style="background:' + r.colour + (r.dash ? ';opacity:.55' : '') + '"></i>'
            + (r.label ? '<em>' + r.label + '</em> ' : '')
            + readText(r) + '</span>').join('')
        + '<span class="probe__free">cursor ' + yv + '</span>';
      tag.style.left = Math.min(px * scale, cv.clientWidth - 8) + 'px';
      tag.style.top = b.TP * scale + 'px';
      /* Mark the traces on the vertical line, so the number and the point it
         came from are visibly the same place. */
      ov.querySelectorAll('.probe__dot').forEach((d) => d.remove());
      reads.forEach((r) => {
        const d = document.createElement('i');
        d.className = 'probe__dot';
        d.style.background = r.colour;
        d.style.left = px * scale + 'px';
        d.style.top = P.Y(r.v) * scale + 'px';
        ov.appendChild(d);
      });
      ov.classList.add('is-on');
      if (speak) {
        /* The spoken form needs the names more than the sighted one does: a
           screen-reader user has no swatch to look at, and a list of bare
           numbers is unreadable. */
        live.textContent = reads.length
          ? xv + ': ' + reads.map((r) => (r.label ? r.label + ' ' : '') + readText(r)).join(', ')
            + '. Cursor at ' + yv + '.'
          : xv + ', ' + yv + ' (cursor position; no trace here)';
      }
    }
    function hide() { ov.classList.remove('is-on'); live.textContent = ''; at = null; }

    const local = (e) => {
      const r = cv.getBoundingClientRect();
      // no layout box (a hidden tab panel) means no meaningful position
      if (!(r.width > 0)) return null;
      const scale = r.width / (cv.__plot ? cv.__plot.box.w : r.width);
      return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale];
    };
    cv.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch' || cv.__probeOff) return;  // a touch is a scroll; zoom owns the drag
      const at2 = local(e);
      if (at2) show(at2[0], at2[1], false);
    });
    cv.addEventListener('pointerleave', hide);
    cv.addEventListener('focus', () => {
      const P = cv.__plot; if (!P) return;
      show(at ? at[0] : (P.box.L + P.box.R) / 2, at ? at[1] : (P.box.TP + P.box.B) / 2, true);
    });
    cv.addEventListener('blur', hide);
    /* N4-6. EXACT X ENTRY. Dragging a cursor is fine for looking and useless for
       answering "what is it at 12 MHz" — the pointer lands between samples and a
       reader cannot say where. This takes a number, in the axis's own units,
       accepts an SI suffix, and puts the cursor exactly there. */
    const entry = document.createElement('label');
    entry.className = 'probe__at';
    entry.innerHTML = '<span>read at</span><input type="text" inputmode="decimal" '
      + 'size="9" autocomplete="off" spellcheck="false">';
    host.appendChild(entry);
    const entryInput = entry.querySelector('input');
    const SI = { p: 1e-12, n: 1e-9, u: 1e-6, \u00b5: 1e-6, m: 1e-3,
                 k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12 };
    entryInput.addEventListener('change', () => {
      const P = cv.__plot; if (!P) return;
      const raw = entryInput.value.trim();
      const m = raw.match(/^([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)\s*([pnu\u00b5mkKMGT]?)/);
      if (!m) { entry.classList.add('is-bad'); return; }
      entry.classList.remove('is-bad');
      const value = parseFloat(m[1]) * (m[2] ? SI[m[2]] : 1);
      const px = P.X(value);
      /* Outside the plotted range is a refusal, not a clamp: clamping would
         answer a different question than the one that was asked. */
      if (!(px >= P.box.L && px <= P.box.R)) { entry.classList.add('is-bad'); return; }
      cv.focus();
      show(px, at ? at[1] : (P.box.TP + P.box.B) / 2, true);
    });

    cv.addEventListener('keydown', (e) => {
      if(e.defaultPrevented){hide();return;} // model-owned sample cursor handled this key
      const P = cv.__plot; if (!P || !at) return;
      const step = e.shiftKey ? 20 : 4;
      let [x, y] = at;
      if (e.key === 'ArrowLeft') x -= step;
      else if (e.key === 'ArrowRight') x += step;
      else if (e.key === 'ArrowUp') y -= step;
      else if (e.key === 'ArrowDown') y += step;
      else if (e.key === 'Escape') { hide(); return; }
      else return;
      e.preventDefault();
      show(x, y, true);
    });
  };

  /* ---------- formatters ---------- */
  K.fmt = {
    hz(f) {
      if (f >= 1e9) return (f / 1e9 < 10 ? (f / 1e9).toFixed(1) : (f / 1e9).toFixed(0)) + ' GHz';
      if (f >= 1e6) return (f / 1e6 < 10 ? (f / 1e6).toFixed(1) : (f / 1e6).toFixed(0)) + ' MHz';
      if (f >= 1e3) return (f / 1e3 < 10 ? (f / 1e3).toFixed(1) : (f / 1e3).toFixed(0)) + ' kHz';
      return f.toFixed(0) + ' Hz';
    },
    ohm(z) {
      if (z >= 1) return z.toFixed(2) + ' Ω';
      if (z >= 1e-3) return (z * 1e3).toFixed(z < 1e-2 ? 2 : 1) + ' mΩ';
      return (z * 1e6).toFixed(0) + ' µΩ';
    },
    db(v) { return v.toFixed(v > -10 && v < 10 ? 1 : 0) + ' dB'; },
    ps(v) { return v < 1000 ? v.toFixed(0) + ' ps' : (v / 1000).toFixed(2) + ' ns'; },
    mv(v) { return (v * 1000).toFixed(0) + ' mV'; },
    pct(v) { return (v * 100).toFixed(0) + '%'; },
    /* Fallback for the probe when an axis has no formatter of its own: three
       significant figures, so 0.00123 and 12300 both read without a wall of zeros. */
    num(v) {
      if (!isFinite(v)) return '—';
      const a = Math.abs(v);
      if (a === 0) return '0';
      if (a >= 1e4 || a < 1e-3) return v.toExponential(2);
      /* M2-8 · Trim FRACTIONAL trailing zeroes only. The old regex was
         /\.?0+$/ against the whole string, so it ate significant zeroes off
         integers: 100 became "1", 200 became "2", -100 became "-1". The probe
         readout was therefore off by two orders of magnitude on any round
         number, which is the worst possible input for a formatter to mangle
         because it looks deliberate. */
      const t = v.toPrecision(3);
      return t.indexOf('.') >= 0 ? t.replace(/0+$/, '').replace(/\.$/, '') : t;
    }
  };

  /* ---------- seeded randomness ----------
     Visualisations must be reproducible: the number under a plot has to describe
     the picture above it, and a redraw must not change either. */
  K.rng = function (seed) {
    let a = seed || 0x5eed;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  K.gaussians = function (n, seed) {
    const r = K.rng(seed), out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
    return out;
  };

  /* ---------- channel model ----------
     A causal impulse response for a lossy channel, shared by every module that
     needs to push bits through one. Two-term loss law, then minimum-phase
     reconstruction by real cepstrum — a magnitude-only channel with linear phase
     is not physical and understates ISI, because the asymmetric tail is most of
     the eye closure.

     Bin k sits at k·f_sample/N, so with sps samples per UI the ratio to the data
     Nyquist is 2·k·sps/N. Getting that normalisation wrong scales the entire loss
     law and is invisible at 0 dB.                                              */
  K.fft = function (re, im, inverse) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (inverse ? 2 : -2) * Math.PI / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const ur = re[i + k], ui = im[i + k];
          const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
          const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
          re[i + k] = ur + vr; im[i + k] = ui + vi;
          re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
          const nr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr; cr = nr;
        }
      }
    }
    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  };

  K.channelImpulse = function (lossDb, sps, nfft) {
    const n = nfft, half = n / 2;
    const logMag = new Float64Array(n);
    const Ac = 0.35 * lossDb, Ad = 0.65 * lossDb;   // √f / linear-f split
    for (let k = 0; k <= half; k++) {
      const fN = 2 * k * sps / n;
      const dB = Ac * Math.sqrt(fN) + Ad * fN;
      logMag[k] = Math.log(Math.max(1e-7, Math.pow(10, -dB / 20)));
      if (k > 0 && k < half) logMag[n - k] = logMag[k];
    }
    const cr = Float64Array.from(logMag), ci = new Float64Array(n);
    K.fft(cr, ci, true);
    ci.fill(0);
    for (let k = 1; k < half; k++) cr[k] *= 2;
    for (let k = half + 1; k < n; k++) cr[k] = 0;
    K.fft(cr, ci, false);
    const hr = new Float64Array(n), hi = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const mm = Math.exp(cr[k]);
      hr[k] = mm * Math.cos(ci[k]); hi[k] = mm * Math.sin(ci[k]);
    }
    K.fft(hr, hi, true);
    let energy = 0;
    for (let i = 0; i < n; i++) energy += hr[i] * hr[i];
    let acc = 0, len = n;
    for (let i = 0; i < n; i++) {
      acc += hr[i] * hr[i];
      if (acc > 0.9999 * energy) { len = Math.min(n, i + 2); break; }
    }
    return hr.slice(0, Math.max(sps * 2, len));
  };

  /* Single-bit response: one UI-wide pulse through h. Its peak is the cursor —
     NOT the peak of h, which for a low-loss channel sits at the bit boundary. */
  K.singleBit = function (h, sps) {
    const n = h.length + sps, sbr = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let k = 0; k < sps; k++) { const j = i - k; if (j >= 0 && j < h.length) acc += h[j]; }
      sbr[i] = acc;
    }
    let peak = -Infinity;
    for (let i = 0; i < n; i++) if (sbr[i] > peak) peak = sbr[i];
    let lo = -1, hi = -1;
    for (let i = 0; i < n; i++) if (sbr[i] >= peak * 0.999) { if (lo < 0) lo = i; hi = i; }
    return { sbr, cursor: Math.round((lo + hi) / 2), peak };
  };

  /* CTLE: one zero, two poles — a peaking filter, not an amplifier.
     |H| is normalised to its own maximum, so the block adds no net gain; the
     "boost" is the RATIO of the response at Nyquist to the response at DC, which
     is what a datasheet means by CTLE boost. Getting this wrong produces eye
     openings larger than the signal swing. */
  /* ---------- CTLE ----------
     H(s) = (1 + s/wz) / [(1 + s/wp1)(1 + s/wp2)]

     The COMPLEX response, not just its magnitude. Applying a real positive
     magnitude to a spectrum makes a zero-phase filter, which is not causal: it
     produces response before the input event. A probe on the previous version put
     24.5% of the output energy ahead of an impulse, with samples either side of it
     equal. Poles and zeros in the left half plane are minimum-phase by
     construction, so taking the response itself fixes the causality.

     Normalisation: peak gain is 1 (0 dB) and DC gain is therefore -boostDb.
     "Boost" is the peak-to-DC ratio, the convention serial-link CTLEs are
     specified with. The equaliser never adds net gain; it attenuates low
     frequencies to flatten the channel, which is what the hardware does too.

     Frequencies are in units of the data Nyquist, so fp1 = 0.75 means 0.75x
     Nyquist. Callers work in the same units as channelImpulse. */
  K.ctleResponse = function (f, fz, fp1, fp2) {
    const nr = 1, ni = f / fz;
    const ar = 1, ai = f / fp1, br = 1, bi = f / fp2;
    const dr = ar * br - ai * bi, di = ar * bi + ai * br;   // (1+jf/p1)(1+jf/p2)
    const m = dr * dr + di * di;
    return { re: (nr * dr + ni * di) / m, im: (ni * dr - nr * di) / m };
  };
  K.ctleMag = function (f, fz, fp1, fp2) {
    return Math.hypot(1, f / fz) / (Math.hypot(1, f / fp1) * Math.hypot(1, f / fp2));
  };

  /* Peak of |H| over the band, and the fz that puts it at a requested boost.
     Lowering fz brings the zero in earlier and raises the peak monotonically, so
     bisection is exact here and needs no closed-form inversion. */
  function ctlePeak(fz, fp1, fp2) {
    let peak = 0;
    for (let i = 0; i <= 400; i++) peak = Math.max(peak, K.ctleMag((i / 400) * 4, fz, fp1, fp2));
    return peak;
  }
  /* fp1, fp2 and the returned fz are all NORMALISED TO NYQUIST, not in hertz.
     Passing absolute frequencies puts the answer outside the bracket below, and
     the bisection then converges on its own lower bound — a zero at DC, whose
     peak gain is ~1e10. That is a sentinel inside the valid range, the bug class
     rule G-5 exists for, so it is refused loudly instead. */
  K.ctleZeroFor = function (boostDb, fp1, fp2) {
    const G = Math.pow(10, boostDb / 20);
    const LO = 1e-4, HI = 100;
    if (!(fp1 > 0) || !(fp2 > 0) || fp1 > HI || fp2 > HI) {
      console.warn('[kit] ctleZeroFor expects poles normalised to Nyquist, got '
                   + fp1 + ' and ' + fp2);
      return NaN;
    }
    if (ctlePeak(LO, fp1, fp2) <= G) {
      console.warn('[kit] ctleZeroFor: ' + boostDb + ' dB is more boost than these poles can give');
      return NaN;
    }
    let lo = LO, hi = HI;                          // small fz = big peak
    for (let i = 0; i < 80; i++) {
      const mid = Math.sqrt(lo * hi);              // geometric bisection
      (ctlePeak(mid, fp1, fp2) > G) ? (lo = mid) : (hi = mid);
    }
    return Math.sqrt(lo * hi);
  };

  K.ctle = function (h, boostDb, sps, nfft) {
    if (boostDb <= 0) return h;
    const fp1 = 0.75, fp2 = 1.4;
    const fz = K.ctleZeroFor(boostDb, fp1, fp2);
    const peak = ctlePeak(fz, fp1, fp2);

    const n = nfft, re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < Math.min(h.length, n); i++) re[i] = h[i];
    K.fft(re, im, false);
    for (let k = 0; k <= n / 2; k++) {
      const f = 2 * k * sps / n;
      const H = K.ctleResponse(f, fz, fp1, fp2);
      const gr = H.re / peak, gi = H.im / peak;
      const rr = re[k] * gr - im[k] * gi;
      const ii = re[k] * gi + im[k] * gr;
      re[k] = rr; im[k] = ii;
      if (k > 0 && k < n / 2) { re[n - k] = rr; im[n - k] = -ii; }
    }
    K.fft(re, im, true);

    /* Keep the equalised tail rather than truncating back to the input length —
       the CTLE has its own ringing, and cutting it would reintroduce exactly the
       wraparound error the causal response was meant to remove. */
    let energy = 0;
    for (let i = 0; i < n; i++) energy += re[i] * re[i];
    let acc = 0, len = h.length;
    for (let i = 0; i < n; i++) {
      acc += re[i] * re[i];
      if (acc > 0.9999 * energy) { len = Math.min(n, i + 2); break; }
    }
    return re.slice(0, Math.max(h.length, len));
  };

  /* Response to ONE isolated symbol, using the real transmit edge rather than a
     rectangle. DFE taps read off this: taps taken from a rectangular pulse do not
     exactly cancel a waveform generated with a finite edge, so the "exact
     cancellation" claim only holds if both use the same pulse definition. */
  K.pulseResponse = function (h, sps, trUI) {
    const tr = Math.max(1, (trUI || 0) * sps);
    const n = h.length + 2 * sps;
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const u = i / tr, d = (i - sps) / tr;          // rise at 0, fall at one UI
      const up = u >= 1 ? 1 : u <= 0 ? 0 : 0.5 - 0.5 * Math.cos(Math.PI * u);
      const dn = d >= 1 ? 1 : d <= 0 ? 0 : 0.5 - 0.5 * Math.cos(Math.PI * d);
      x[i] = up - dn;
    }
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let acc = 0;
      const kmax = Math.min(h.length, i + 1);
      for (let k = 0; k < kmax; k++) acc += h[k] * x[i - k];
      out[i] = acc;
    }
    let peak = -Infinity, at = 0;
    for (let i = 0; i < n; i++) if (out[i] > peak) { peak = out[i]; at = i; }
    let lo = -1, hi = -1;
    for (let i = 0; i < n; i++) if (out[i] >= peak * 0.999) { if (lo < 0) lo = i; hi = i; }
    return { sbr: out, peak, cursor: Math.round((lo + hi) / 2), at };
  };

  /* DFE. Subtracts the post-cursor taps of the pulse response weighted by earlier
     symbols.

     mode 'ideal'    — weights by the TRANSMITTED symbols. Exact cancellation of
                       known ISI, no noise gain, no decision errors. Useful as an
                       upper bound; it is NOT what hardware does, because hardware
                       does not know what was sent.
     mode 'decision' — weights by the receiver's own sliced decisions, taken from
                       the already-corrected waveform. A wrong decision therefore
                       feeds back and can propagate, which is the behaviour that
                       makes DFE costly on a marginal channel.

     The correction window is HALF-OPEN. It was inclusive at both ends, making it
     sps+1 samples wide, so adjacent symbol windows overlapped by one sample and
     that sample received two corrections. */
  K.applyDFE = function (y, levels, sbr, cursor, ntaps, sps, opts) {
    if (ntaps <= 0) return y;
    opts = opts || {};
    const mode = opts.mode === 'decision' ? 'decision' : 'ideal';

    const taps = [];
    for (let k = 1; k <= ntaps; k++) {
      const i = cursor + k * sps;
      taps.push(i < sbr.length ? sbr[i] : 0);
    }

    /* M2-7 · The slicer decides in TRANSMIT units, so the received sample has to
       be divided by the main-cursor gain first.

       It used to compare the received voltage directly against the transmit
       alphabet. With a main cursor of 0.2 and levels [-1, -1/3, +1/3, +1], a
       transmitted +1 arrives at about 0.2 — which is nearer +1/3 than +1, so
       every outer symbol was decided as an inner one. NRZ survived that because
       its thresholds are only signs, which is why the defect stayed latent: the
       exposed decision-directed toggle is NRZ. It would not have survived
       decision-directed PAM4 for a single symbol.

       `opts.gain` lets a caller state an explicit AGC or threshold scale instead.
       Either way the scale is named rather than assumed to be one. */
    const alphabet = Array.from(new Set(levels)).sort((a, b) => a - b);
    const gain = opts.gain !== undefined ? opts.gain
               : (cursor >= 0 && cursor < sbr.length && sbr[cursor] !== 0 ? sbr[cursor] : 1);
    const slice = (v) => {
      const u = v / gain;                       // received volts -> transmit units
      let best = alphabet[0], bd = Infinity;
      for (const L of alphabet) { const d = Math.abs(u - L); if (d < bd) { bd = d; best = L; } }
      return best;
    };

    const out = Float64Array.from(y);
    const decided = new Float64Array(levels.length);
    for (let b = 0; b < levels.length; b++) {
      for (let k = 1; k <= taps.length; k++) {
        if (b - k < 0) continue;
        const src = mode === 'ideal' ? levels[b - k] : decided[b - k];
        const corr = taps[k - 1] * src;
        for (let s2 = -sps / 2; s2 < sps / 2; s2++) {       // half-open: exactly sps wide
          const i = b * sps + cursor + s2;
          if (i >= 0 && i < out.length) out[i] -= corr;
        }
      }
      const at = b * sps + cursor;
      let v = at >= 0 && at < out.length ? out[at] : 0;
      decided[b] = slice(v);
      if (opts.errorAt === b) {                             // force one wrong decision
        const other = alphabet.filter((L) => L !== decided[b]);
        if (other.length) decided[b] = other[other.length - 1];
      }
    }
    out.decided = decided;
    return out;
  };

  /* ---------- reproducible scenarios ----------
     A panel is only useful in a design discussion if the other person can open
     exactly what you were looking at. These read and write every control in a
     panel straight from the DOM, so they work for any module without it knowing.

     The hash is readable on purpose — `#lab=eye&eye-loss=18&_p=lossy` — because a
     scenario pasted into a review comment should be inspectable, and because a
     stale link should fail visibly rather than silently restoring the wrong thing. */
  K.readScenario = function (root) {
    const out = {};
    root.querySelectorAll('.ctl input, .ctl select').forEach((el) => {
      if (!el.id) return;
      out[el.id] = el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value;
    });
    const sel = root.querySelector('.preset[aria-pressed="true"]');
    if (sel) out._p = sel.dataset.preset;
    return out;
  };

  K.applyScenario = function (root, vals) {
    /* Preset first: it writes the module's whole parameter set, and the individual
       controls then override only what the link actually changed. The other order
       would let the preset clobber them. */
    if (vals._p) {
      const b = root.querySelector('.preset[data-preset="' + vals._p + '"]');
      if (b) b.click();
    }
    let applied = 0;
    Object.keys(vals).forEach((id) => {
      if (id === '_p') return;
      const el = root.querySelector('#' + CSS.escape(id));
      if (!el) return;
      if (el.type === 'checkbox') {
        const want = vals[id] === '1';
        if (el.checked !== want) { el.checked = want; el.dispatchEvent(new Event('change', { bubbles: true })); }
      } else {
        el.value = vals[id];
        el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
      }
      applied++;
    });
    return applied;
  };

  /* A4 · A shared link carries the model version it was made against. Without
     it, a link from before a model changed silently reproduces the SETTINGS in a
     model that no longer means the same thing by them — which is the failure
     mode provenance exists to prevent. The Gen5 loss knob is the concrete case:
     before M1-13 it meant "22 dB at whatever Nyquist happens to be", and after
     it means "22 dB at 8 GHz". Same number, different board.

     The version is read from the page's stamped contract island, so it comes
     from docs/model-types.json rather than being maintained here. A link made
     against a different version still applies — the parameters are usually
     compatible — but the reader is told. */
  K.scenarioHash = function (root, vizName) {
    const v = K.readScenario(root);
    let ver = '';
    const island = root.querySelector
      && root.querySelector('script[type="application/json"][data-contract]');
    if (island) {
      try { ver = JSON.parse(island.textContent).version || ''; } catch (e) { ver = ''; }
    }
    return '#lab=' + vizName + (ver ? ';v=' + encodeURIComponent(ver) : '')
      + Object.keys(v).map((k) => ';' + k + '=' + encodeURIComponent(v[k])).join('');
  };

  K.parseHash = function (hash) {
    if (!hash || hash.indexOf('lab=') < 0) return null;
    const parts = hash.replace(/^#/, '').split(';');
    const out = {};
    let name = null, ver = null;
    for (const seg of parts) {
      const i = seg.indexOf('=');
      if (i < 0) continue;
      const k = seg.slice(0, i);
      let val;
      try { val = decodeURIComponent(seg.slice(i + 1)); }
      catch (_) { return null; }
      if (k === 'lab') name = val;
      else if (k === 'v') ver = val;
      else out[k] = val;
    }
    return name ? { viz: name, vals: out, version: ver } : null;
  };

  /* ---------- numeric entry beside every slider ----------
     A range input alone means a precise comparison requires dragging to a pixel,
     and the exact value can only be read, never typed. This upgrades every
     .ctl > input[type=range] in a panel: the <output> that displayed the value
     becomes editable, keyboard steppable, and shows the unit.

     It is progressive enhancement — it reads the slider's own min/max/step, fires
     the same 'input' event the module already listens for, and changes nothing
     about how modules are written. A slider whose output is a mapped label (a
     speed bin, an index) is left alone: parsing those back is guesswork. */
  K.numericEntry = function (root) {
    root.querySelectorAll('.ctl input[type="range"]').forEach((range) => {
      const out = root.querySelector('#' + range.id + '-out');
      if (!out || out.dataset.numeric) return;

      /* Infer the display scale, and only accept an exact power of ten.
         Many sliders are scaled — a raw 2 shows as 0.002 — and typing into those
         must map back. But some controls are MAPPED, not scaled: the LPDDR rate
         slider is an index 0..5 that displays a speed bin, so its ratio is 1706.6
         and writing a typed value back would land on the wrong bin. A power-of-ten
         test accepts every scaled slider and rejects every mapped one. */
      const shown = (out.value || out.textContent || '').trim();
      const lead = parseFloat(shown);
      const raw = +range.value;
      if (!isFinite(lead) || raw === 0) return;
      const scale = lead / raw;
      const decades = Math.log10(Math.abs(scale));
      if (Math.abs(decades - Math.round(decades)) > 1e-9 || Math.abs(decades) > 3) return;
      // strip the whole leading number, not String(lead).length characters —
              // "1.00×" parsed as 1 and sliced by 1 char left the unit as ".00×"
              const unit = shown.replace(/^[-+]?[\d.,]+(?:[eE][-+]?\d+)?\s*/, '').trim();

      /* How many decimals the declared step justifies showing. A slider that moves
         in hundredths has two meaningful decimals; printing 0.7000000000000001,
         because 70 x 0.01 is not exactly 0.7 in binary, shows sixteen. Deriving the
         count from step x scale keeps a coarse control tidy without truncating a
         fine one — one fixed decimal count could not do both.

         This formats the BOX only. The range keeps its own value, and the model is
         handed that value, never this string. */
      const shownStep = Math.abs((+range.step || 1) * scale);
      let places = 6;
      for (let d = 0; d <= 9; d++) {
        const q = shownStep * Math.pow(10, d);
        if (Math.abs(q - Math.round(q)) < 1e-9 * Math.max(1, q)) { places = d; break; }
      }
      const show = (v) => {
        if (!isFinite(v)) return '';
        const r = +v.toFixed(places);
        // a value finer than its own step still has to be visible, not shown as 0
        return String(r === 0 && v !== 0 ? +v.toPrecision(6) : r);
      };

      const box = document.createElement('input');
      box.type = 'text';
      box.inputMode = 'decimal';
      box.className = 'ctl__num';
      box.value = show(+range.value * scale);
      box.setAttribute('aria-label',
        (root.querySelector('label[for="' + range.id + '"]') || {}).textContent || range.id);
      const suffix = document.createElement('span');
      suffix.className = 'ctl__unit';
      suffix.textContent = unit;

      const commit = () => {
        const v = parseFloat(box.value);
        if (!isFinite(v)) { box.value = String(+range.value); return; }
        const lo = +range.min, hi = +range.max, st = +range.step || 1;
        const rawWanted = v / scale;
        const snapped = Math.min(hi, Math.max(lo, Math.round((rawWanted - lo) / st) * st + lo));
        range.value = String(snapped);
        box.value = show(+range.value * scale);
        range.dispatchEvent(new Event('input', { bubbles: true }));
      };
      box.addEventListener('change', commit);
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const st = (+range.step || 1) * scale * (e.shiftKey ? 10 : 1);
          box.value = show(parseFloat(box.value || String(raw * scale))
            + (e.key === 'ArrowUp' ? st : -st));
          commit();
        }
      });
      // the module keeps writing to the <output>; mirror it back into the box
      const sync = () => {
        const t = (out.value || out.textContent || '').trim();
        const n = parseFloat(t);
        if (isFinite(n) && document.activeElement !== box) box.value = show(n);
        suffix.textContent = isFinite(n) ? t.replace(/^[-+]?[\d.,]+(?:[eE][-+]?\d+)?\s*/, '').trim() : '';
      };
      new MutationObserver(sync).observe(out, { childList: true, characterData: true, subtree: true });
      range.addEventListener('input', sync);

      out.dataset.numeric = '1';
      out.style.display = 'none';
      out.insertAdjacentElement('afterend', suffix);
      out.insertAdjacentElement('afterend', box);
    });
  };

  /* ---------- HTML result summary ----------
     Canvas text is not a substitute for semantic HTML. It cannot reflow, so a
     long annotation is simply cut off on a narrow screen; it is invisible to a
     screen reader, unselectable, and unsearchable.

     K.summary renders the numbers as a real <dl> below the plot. The canvas keeps
     the short labels that sit ON the geometry and belong there; everything that is
     a value or an explanation moves here, where it wraps, reads and copies.

     rows: [{ label, value, note, colour }]. `colour` is a CSS custom property name
     and draws a swatch, so identity never rests on colour alone — the label is
     right there. aria-live is polite and only the settled result is announced. */
  K.summary = function (root, rows, opts) {
    opts = opts || {};
    let el = root.querySelector('[data-summary]');
    if (!el) {
      el = document.createElement('dl');
      el.setAttribute('data-summary', '');
      el.className = 'viz-summary';
      /* M5-6 · The VISIBLE list is no longer a live region. It is rewritten on
         every draw, and a draw happens on every frame of a slider drag — so a
         screen reader was being handed the whole summary dozens of times a
         second, which is not information, it is a denial of service.

         The announcement moves to a separate off-screen region updated on a
         debounce, so what is spoken is the SETTLED result: one announcement
         after the reader stops moving the control, which is the only version
         that was ever useful. */
      el.setAttribute('aria-label', opts.label || 'Current values');
      const host = root.querySelector('[data-summary-host]')
        || root.querySelector('.panel') || root;
      host.appendChild(el);
    }
    el.innerHTML = rows.map((r) => {
      const sw = r.colour ? `<i class="viz-summary__sw" style="background:var(--${r.colour})"></i>` : '';
      const note = r.note ? `<span class="viz-summary__note">${r.note}</span>` : '';
      return `<div class="viz-summary__row"><dt>${sw}${r.label}</dt>`
           + `<dd>${r.value}${note}</dd></div>`;
    }).join('');

    /* The settled announcement. 600 ms after the last change, which is long
       enough that a drag produces one utterance and short enough that it does
       not feel detached from the action. */
    let say = root.querySelector('[data-summary-live]');
    if (!say) {
      say = document.createElement('p');
      say.setAttribute('data-summary-live', '');
      say.className = 'sr-only';
      say.setAttribute('role', 'status');
      say.setAttribute('aria-live', 'polite');
      el.parentNode.insertBefore(say, el.nextSibling);
    }
    clearTimeout(root.__summaryTimer);
    const text = (opts.label ? opts.label + '. ' : '')
      + rows.map((r) => r.label + ': ' + r.value).join('. ') + '.';
    root.__summaryTimer = setTimeout(() => { say.textContent = text; }, 600);
    return el;
  };

  /* ---------- lifecycle ----------
     Handles the parts of the module contract that are identical every time:
     theme re-read on sipi:theme and on prefers-color-scheme, debounced resize,
     prefers-reduced-motion, a first complete frame before anything animates,
     and wiring [data-ctl] inputs to a params object.

     spec = {
       root, params, draw(T, params), tick(dt, params) -> bool (false to stop),
       onChange(params), height
     }                                                                        */
  K.mount = function (spec) {
    const root = spec.root;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let T = K.theme(root), raf = 0, playing = false, last = 0;

    function render() { spec.draw(T, spec.params); }

    function frame(ts) {
      if (!playing) return;
      const dt = Math.min(64, ts - (last || ts)); last = ts;
      const go = spec.tick ? spec.tick(dt, spec.params) : false;
      render();
      if (go === false) { playing = false; return; }
      raf = requestAnimationFrame(frame);
    }

    const api = {
      reduce,
      render,
      play() {
        if (playing || reduce || !spec.tick) return;
        playing = true; last = 0; raf = requestAnimationFrame(frame);
      },
      pause() { playing = false; cancelAnimationFrame(raf); },
      get playing() { return playing; }
    };

    // [data-ctl="name"] on a range/checkbox writes params[name] and redraws
    const bound = [];
    root.querySelectorAll('[data-ctl]').forEach((el) => {
      const key = el.dataset.ctl, scale = +(el.dataset.scale || 1);
      const ev = el.type === 'checkbox' ? 'change' : 'input';
      const fn = () => {
        spec.params[key] = el.type === 'checkbox' ? el.checked : +el.value * scale;
        if (spec.onChange) spec.onChange(spec.params);
        render();
      };
      el.addEventListener(ev, fn);
      bound.push([el, ev, fn]);
    });

    const onTheme = () => { T = K.theme(root); render(); };
    window.addEventListener('sipi:theme', onTheme);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', onTheme);
    let rt = 0;
    const onResize = () => { clearTimeout(rt); rt = setTimeout(render, 90); };
    window.addEventListener('resize', onResize);

    /* Reduced motion can be toggled while the page is open — an accessibility
       preference that only took effect on reload was not much of a preference.
       Stopping any running animation immediately is the whole point of it. */
    const rmq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMotion = () => {
      api.reduce = rmq.matches;
      if (rmq.matches) { api.pause(); render(); }
    };
    rmq.addEventListener('change', onMotion);


    render();                                  // complete frame at rest, before any animation

    api.teardown = function () {
      api.pause();
      clearTimeout(rt);                                   // pending debounced redraw
      window.removeEventListener('sipi:theme', onTheme);
      mq.removeEventListener('change', onTheme);
      rmq.removeEventListener('change', onMotion);
      window.removeEventListener('resize', onResize);
      bound.forEach(([el, ev, fn]) => el.removeEventListener(ev, fn));
      bound.length = 0;
    };
    return api;
  };

  /* ---------- the tail of a Gaussian ----------
     Moved here from js/viz/jitter.js, unchanged, so the BER calculator and the
     jitter panels answer from the same arithmetic rather than two copies of it.

     Q(x) is evaluated in two regimes so the far tail stays accurate: a Chebyshev
     erfc below x = 3, and the asymptotic series above it. A single erfc loses all
     relative accuracy by 1e-12, which is exactly where the answer lives. */
  const SQ2PI = Math.sqrt(2 * Math.PI);
  K.erfc = function (x) {                  // Numerical Recipes, |err| < 1.2e-7
    const z = Math.abs(x), t = 2 / (2 + z);
    const ans = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196
      + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398
      + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
    return x >= 0 ? ans : 2 - ans;
  };
  K.Q = function Q(x) {
    if (x < 0) return 1 - Q(-x);
    if (x < 3) return 0.5 * K.erfc(x / Math.SQRT2);
    const i = 1 / (x * x);                 // asymptotic series — keeps relative accuracy in the tail
    return Math.exp(-x * x / 2) / (x * SQ2PI) * (1 - i + 3 * i * i - 15 * i * i * i);
  };
  /* Inverse: the Q value a BER demands. Bisection on a monotone function is
     plenty here and cannot diverge the way Newton can in the tail. */
  K.Qinv = function (p) {
    let lo = 0, hi = 12;
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      (K.Q(mid) > p) ? (lo = mid) : (hi = mid);
    }
    return (lo + hi) / 2;
  };

  /* ---------- quantities a reader types ----------
     Engineers write values the way a schematic does: 100n, 1.2p, 3G, 50 mil.
     K.parseQty reads that; K.si writes it back with the prefix that keeps the
     mantissa between 1 and 1000.

     A BARE number means the prefix currently on display, so typing 22 over
     "10 nH" means 22 nH, not 22 henries -- which is what anyone retyping a
     value intends. Lower-case m is milli and upper-case M is mega; that is the
     SI rule and the only reading that does not guess. */
  const PREFIX_IN = { f: 1e-15, p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, 'μ': 1e-6,
                      m: 1e-3, '': 1, k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12 };
  const PREFIX_OUT = [[1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''],
                      [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f']];
  const LENGTH_M = { m: 1, cm: 1e-2, mm: 1e-3, um: 1e-6, 'µm': 1e-6, 'μm': 1e-6,
                     mil: 25.4e-6, mils: 25.4e-6, in: 0.0254, inch: 0.0254, '"': 0.0254 };

  K.prefixScale = function (v) {           // the display prefix a value would get
    const a = Math.abs(v);
    if (!(a > 0) || !isFinite(a)) return 1;
    const hit = PREFIX_OUT.find(([s]) => a >= s * 0.9995);
    return hit ? hit[0] : 1e-15;
  };
  K.si = function (v, unit, sig) {
    const n = sig || 3, u = unit || '';
    if (v === Infinity) return '∞';
    if (!isFinite(v)) return '—';
    if (v === 0) return '0' + (u ? ' ' + u : '');
    const a = Math.abs(v);
    let i = PREFIX_OUT.findIndex(([s]) => a >= s);
    if (i < 0) i = PREFIX_OUT.length - 1;
    let m = Number((v / PREFIX_OUT[i][0]).toPrecision(n));
    if (Math.abs(m) >= 1000 && i > 0) { i--; m = Number((v / PREFIX_OUT[i][0]).toPrecision(n)); }
    const t = m.toPrecision(n);
    return (t.indexOf('e') >= 0 ? String(m) : t) + ' ' + PREFIX_OUT[i][1] + u;
  };
  /* q: { kind: 'si' | 'plain' | 'sci' | 'length', unit, alias: [...], base, scale } */
  K.parseQty = function (text, q) {
    const s = String(text).trim().replace(/−/g, '-').replace(/,/g, '.').replace(/\s+/g, '');
    const m = s.match(/^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)/i);
    if (!m) return NaN;
    const x = parseFloat(m[1]);
    const rest = s.slice(m[1].length);
    if (q.kind === 'length') {
      if (!rest) return x;                               // the input's own unit
      const f = LENGTH_M[rest] !== undefined ? LENGTH_M[rest] : LENGTH_M[rest.toLowerCase()];
      return f === undefined ? NaN : x * f / q.base;
    }
    const units = [q.unit || ''].concat(q.alias || []).filter(Boolean);
    if (q.kind !== 'si') {                               // plain and sci take no prefix
      return (!rest || units.some((u) => rest.toLowerCase() === u.toLowerCase())) ? x : NaN;
    }
    if (!rest) return x * (q.scale || 1);
    let p = rest;
    for (const u of units) {
      if (p.toLowerCase().endsWith(u.toLowerCase())) { p = p.slice(0, p.length - u.length); break; }
    }
    return Object.prototype.hasOwnProperty.call(PREFIX_IN, p) ? x * PREFIX_IN[p] : NaN;
  };

  /* ---------- the calculator engine ----------
     Every calculator page is the same instrument: inputs on the left, the answer
     in numbers above one chart on the right, all inside one screen on a laptop.
     On a phone the numbers come first and stay pinned while the inputs scroll
     beneath them, so an input and what it changes are never on different
     screens. Building that once here is what makes it true of every page; a
     layout rule re-implemented twelve times is twelve chances to break it.

     A spec is data plus three functions:
       selects  [{ id, label, options: [[value, text], ...], def }]
       inputs   [{ id, label, kind, unit, min, max, log, def, when(v), hint, ... }]
       compute(v)            -> r        pure; lives in js/models/calc-models.js
       outputs(r, v)         -> [{ k, v, tone, wide }]
       chart.draw(s, T, v, r) -> legend [{ label, colour, dash }]
       laminate { freq(v), note }  optional: a Laminate select that fills the
                                   spec's dk and df inputs from js/models/laminates.js
     The state is also written to the URL, so a link reproduces the calculation. */
  const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* Whole decades around a range, for a log axis whose ticks should land on
     1, 10, 100 rather than wherever the data happens to start. */
  K.decades = function (lo, hi) {
    const a = Math.pow(10, Math.floor(Math.log10(lo)));
    let b = Math.pow(10, Math.ceil(Math.log10(hi)));
    if (!(b > a)) b = a * 10;
    return [a, b];
  };
  /* A round upper limit for a linear axis: 1, 2, 2.5 or 5 times a power of ten. */
  K.niceCeil = function (x) {
    if (!(x > 0)) return 1;
    const e = Math.pow(10, Math.floor(Math.log10(x))), m = x / e;
    return [1, 2, 2.5, 5, 10].find((k) => k >= m - 1e-9) * e;
  };
  /* An axis that holds still. A calculator's chart must show a slider MOVING the
     curve; an axis re-fitted to the input on every frame keeps the curve in place
     and changes only the numbers under it, which reads as nothing happening
     (Geetansh, on the return-loss chart). So a range is kept while what must be
     shown still fits in it, and replaced -- by whole decades on a log axis, a
     round number on a linear one -- only when it no longer fits, or when the
     content has shrunk to a small corner of it. `keep` is per chart. */
  K.sticky = function (keep, key, needLo, needHi, log) {
    const prev = keep[key];
    if (prev && needLo >= prev[0] && needHi <= prev[1]) {
      const roomy = log ? Math.log10(prev[1] / prev[0]) - Math.log10(needHi / needLo) <= 2.01
                        : needHi >= prev[1] / 5;
      if (roomy) return prev;
    }
    const r = log ? K.decades(needLo, needHi) : [Math.min(0, needLo), K.niceCeil(needHi * 1.02)];
    keep[key] = r;
    return r;
  };

  /* A shaded x-interval clipped to the plot box: a band, a region, a margin. */
  K.shadeX = function (P, x1, x2, colour) {
    const B = P.box, l = Math.max(B.L, Math.min(P.X(x1), P.X(x2)));
    const r = Math.min(B.R, Math.max(P.X(x1), P.X(x2)));
    if (r > l) { P.ctx.fillStyle = colour; P.ctx.fillRect(l, B.TP, r - l, B.B - B.TP); }
  };
  K.shadeY = function (P, y1, y2, colour) {
    const B = P.box, top = Math.max(B.TP, Math.min(P.Y(y1), P.Y(y2)));
    const bot = Math.min(B.B, Math.max(P.Y(y1), P.Y(y2)));
    if (bot > top) { P.ctx.fillStyle = colour; P.ctx.fillRect(B.L, top, B.R - B.L, bot - top); }
  };

  K.calcFormat = function (q, x) {
    if (!isFinite(x)) return '';
    if (q.kind === 'sci') return Number(x.toPrecision(2)).toExponential().replace('e+', 'e');
    if (q.kind === 'plain' || q.kind === 'length') {
      const dp = q.dp !== undefined ? q.dp : 2;
      return (+x.toFixed(dp)).toString() + (q.unit ? ' ' + q.unit : '');
    }
    return K.si(x, q.unit, q.sig || 3);
  };

  K.calc = function (root, spec) {
    const $ = (s) => root.querySelector(s);
    const inBox = $('[data-calc-inputs]'), outBox = $('[data-calc-results]');
    const cv = $('[data-cv="calc"]'), legendBox = $('[data-calc-legend]');
    const v = {};
    const selects = spec.selects || [];
    selects.forEach((s) => { v[s.id] = s.def; });
    spec.inputs.forEach((q) => { v[q.id] = q.def; });
    /* A laminate preset owns Dk and Df while it is selected. Editing either by
       hand returns the select to Custom, so the page never attributes to a data
       sheet a value the reader has changed. */
    const L = NS.laminates, lam = spec.laminate && L ? spec.laminate : null;
    const lamFields = lam ? ['dk', 'df'].filter((k) => spec.inputs.some((q) => q.id === k)) : [];
    if (lam) v.mat = 'custom';

    /* ?L=1e-8&mode=parallel -- read first, so a shared link opens on its values. */
    try {
      const qs = new URLSearchParams(window.location.search);
      selects.forEach((s) => {
        const val = qs.get(s.id);
        if (val && s.options.some(([o]) => o === val)) v[s.id] = val;
      });
      spec.inputs.forEach((q) => {
        const val = parseFloat(qs.get(q.id));
        if (isFinite(val) && (!q.positive || val > 0)) v[q.id] = val;
      });
      if (lam && L.byId[qs.get('mat')]) v.mat = qs.get('mat');
    } catch (e) { /* no URL state, defaults stand */ }

    const label = (x) => (typeof x === 'function' ? x(v) : x);
    const toT = (q, x) => {
      const t = q.log ? Math.log(x / q.min) / Math.log(q.max / q.min) : (x - q.min) / (q.max - q.min);
      return Math.round(1000 * Math.max(0, Math.min(1, t)));
    };
    const fromT = (q, t) => {
      const u = t / 1000;
      const x = q.log ? q.min * Math.pow(q.max / q.min, u) : q.min + (q.max - q.min) * u;
      return q.snap ? q.snap(x) : Number(x.toPrecision(3));
    };

    /* ---- controls ---- */
    const segs = selects.map((s) => {
      const g = document.createElement('div');
      g.className = 'calc-seg';
      g.setAttribute('role', 'group');
      g.setAttribute('aria-label', s.label);
      g.innerHTML = '<span class="calc-seg__k">' + s.label + '</span>' + s.options.map(([val, text]) =>
        '<button type="button" class="calc-seg__b" data-val="' + escHtml(val) + '">' + text + '</button>').join('');
      g.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        if (s.onPick) s.onPick(b.dataset.val, v);          // may load values that suit the new mode
        v[s.id] = b.dataset.val; m.render();
      }));
      inBox.appendChild(g);
      return [s, g];
    });
    let matSel = null, matSrc = null;
    if (lam) {
      const row = document.createElement('div');
      row.className = 'calc-in calc-in--mat';
      row.innerHTML = '<div class="calc-in__head"><label for="calc-mat">Laminate</label>'
        + '<select id="calc-mat" class="calc-in__sel"><option value="custom">Custom</option>'
        + L.list.map((x) => '<option value="' + x.id + '">' + escHtml(x.name) + '</option>').join('')
        + '</select></div>';
      matSel = row.querySelector('select');
      /* The source goes under the chart's legend, not under the select: the input
         column is the tall one on a laptop, and on a phone the chart sits directly
         above the inputs, so the line still lands next to the select. */
      matSrc = document.createElement('p');
      matSrc.className = 'calc-src';
      matSrc.hidden = true;
      legendBox.after(matSrc);
      matSel.addEventListener('change', () => { v.mat = matSel.value; m.render(); });
      inBox.appendChild(row);
    }
    const lamFreq = (f) => (f >= 1e9 ? Number((f / 1e9).toPrecision(3)) + ' GHz' : Number((f / 1e6).toPrecision(3)) + ' MHz');
    function applyLaminate() {
      matSel.value = v.mat;
      matSrc.hidden = v.mat === 'custom';
      if (v.mat === 'custom') return;
      const x = L.byId[v.mat], want = lam.freq ? lam.freq(v) : L.REF_HZ, p = L.at(v.mat, want);
      lamFields.forEach((k) => { v[k] = p[k]; });
      const vals = 'Dk ' + p.dk.toFixed(2) + (lamFields.includes('df') ? ', Df ' + Number(p.df.toPrecision(2)) : '');
      const where = p.clamped ? ' at ' + lamFreq(p.f) + ', the nearest tabulated point to ' + lamFreq(want)
        : ' at ' + lamFreq(p.f) + (lam.freq ? '' : ', the reference frequency') + (p.exact ? '' : ', interpolated');
      matSrc.innerHTML = '<b>' + vals + where + '.</b> ' + escHtml(x.construction[0].toUpperCase() + x.construction.slice(1)) + '. '
        + '<a href="' + x.url + '" rel="noopener">' + escHtml(x.doc) + '</a>' + (x.date ? ', ' + x.date : '')
        + '. Typical, not guaranteed.' + (lam.note ? ' ' + lam.note : '');
    }
    const rows = spec.inputs.map((q) => {
      const id = 'calc-' + q.id;
      const row = document.createElement('div');
      row.className = 'calc-in';
      row.innerHTML =
        '<div class="calc-in__head"><label for="' + id + '"></label>'
        + '<input id="' + id + '" class="calc-in__num" type="text" inputmode="decimal" '
        + 'autocomplete="off" spellcheck="false"></div>'
        + '<input type="range" min="0" max="1000" step="1" data-rng>'
        + (q.hint ? '<span class="calc-in__hint">' + q.hint + '</span>' : '');
      const lab = row.querySelector('label'), box = row.querySelector('.calc-in__num');
      const rng = row.querySelector('[data-rng]');
      const setLabel = () => {
        const t = label(q.label);
        lab.innerHTML = t;
        rng.setAttribute('aria-label', lab.textContent);
      };
      const show = () => {
        box.value = K.calcFormat(q, v[q.id]);
        rng.value = toT(q, v[q.id]);
        rng.setAttribute('aria-valuetext', box.value);
        box.classList.remove('is-bad');
        box.removeAttribute('aria-invalid');
      };
      const ok = (x) => isFinite(x) && (!q.positive || x > 0)
        && (q.lo === undefined || x >= q.lo) && (q.hi === undefined || x <= q.hi);
      const own = lamFields.includes(q.id);
      rng.addEventListener('input', () => {
        if (own) v.mat = 'custom';
        v[q.id] = fromT(q, +rng.value);
        box.value = K.calcFormat(q, v[q.id]);
        rng.setAttribute('aria-valuetext', box.value);
        box.classList.remove('is-bad');
        m.render();
      });
      box.addEventListener('input', () => {
        const x = K.parseQty(box.value, Object.assign({ scale: K.prefixScale(v[q.id]) }, q));
        if (ok(x)) {
          if (own) v.mat = 'custom';
          v[q.id] = x; rng.value = toT(q, x);
          box.classList.remove('is-bad'); box.removeAttribute('aria-invalid');
          m.render();
        } else {
          box.classList.add('is-bad'); box.setAttribute('aria-invalid', 'true');
        }
      });
      box.addEventListener('change', show);                // canonical form once the reader is done
      box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { box.blur(); show(); } });
      inBox.appendChild(row);
      return { q, row, show, setLabel };
    });

    /* ---- the URL ---- */
    let urlT = 0;
    const writeUrl = () => {
      clearTimeout(urlT);
      urlT = setTimeout(() => {
        try {
          const qs = new URLSearchParams();
          selects.forEach((s) => qs.set(s.id, v[s.id]));
          if (lam && v.mat !== 'custom') qs.set('mat', v.mat);
          spec.inputs.forEach((q) => qs.set(q.id, String(Number(v[q.id].toPrecision(6)))));
          window.history.replaceState(null, '', '?' + qs.toString() + window.location.hash);
        } catch (e) { /* file:// in some browsers; the calculation still works */ }
      }, 300);
    };

    function draw(T) {
      segs.forEach(([s, g]) => g.querySelectorAll('button').forEach((b) =>
        b.setAttribute('aria-pressed', String(b.dataset.val === v[s.id]))));
      if (lam) applyLaminate();
      rows.forEach((r) => {
        r.row.hidden = r.q.when ? !r.q.when(v) : false;
        r.setLabel();
        if (document.activeElement !== r.row.querySelector('.calc-in__num')) r.show();
      });
      const res = spec.compute(v);
      outBox.innerHTML = spec.outputs(res, v).map((o) =>
        '<div class="calc-out' + (o.wide ? ' calc-out--wide' : '') + (o.tone ? ' calc-out--' + o.tone : '') + '">'
        + '<span class="calc-out__k">' + o.k + '</span>'
        + '<b class="calc-out__v">' + escHtml(o.v) + '</b></div>').join('');
      const narrow = window.matchMedia('(max-width: 55.99rem)').matches;
      /* On a laptop the chart is the one part that can give height back. The rest
         of the instrument and the page head above it take about 450 px, so the
         chart takes what a short screen has left -- down to 150 px, where a
         curve still reads -- and the whole instrument stays in the first screen
         of a 1280 x 720 laptop as well as a 1366 x 768 one. */
      const srcH = matSrc && !matSrc.hidden ? matSrc.offsetHeight + 4 : 0;   // a laminate's source line
      const deskH = Math.max(150, Math.min(spec.chart.h || 200, window.innerHeight - 450 - srcH));
      const s = K.canvas(cv, narrow ? 210 : deskH);
      const legend = spec.chart.draw(s, T, v, res) || [];
      legendBox.innerHTML = legend.map((l) =>
        '<span><i' + (l.dash ? ' class="dash" style="color:' + l.colour + '"'
          : ' style="background:' + l.colour + '"') + '></i>' + l.label + '</span>').join('');
      writeUrl();
    }

    const m = K.mount({ root, params: v, draw });
    return { start() {}, stop() {}, destroy() { clearTimeout(urlT); m.teardown(); } };
  };
})();
