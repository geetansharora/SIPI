/* SI & PI — viz/lab-waves.js
 * Lab A: travelling waves, termination and return paths.
 *
 * Everything on this page comes from ONE model — K.line1D in the kit, the same
 * superposition the reflections topic page uses. The lab's job is not a second
 * physics engine, it is to show the same physics in the four places engineers
 * actually argue about it:
 *
 *   along the line   V(x) and I(x) at one instant, split into the forward and
 *                    backward waves that make them
 *   at a probe       V(t) and I(t) where you put the scope
 *   in the lattice   which bounce is responsible for what you are looking at
 *   in the energy    where the energy went, which is the only account that
 *                    explains why an open end rings instead of dissipating
 *
 * Voltage adds where current subtracts. That one sign is why an open doubles the
 * voltage and zeroes the current, and why a short does the opposite, and it is
 * the reason this lab draws both.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;

  const PS_PER_IN = 170;        // stripline, Dk ≈ 4.0 — 170 ps/in
  const VS = 1.0;
  const NWAVE = 24;

  /* ---------- the pure model (M0-6) ----------
     The energy account used to be computed inside energyRows(), which built
     display strings in the same breath, so the only way to ask whether energy
     was conserved was to read a percentage off a summary card. That is how N1
     survived: the account is wrong through the source transition, and at t=0 the
     panel printed 296,509,210.4% because it divided by an injected energy that
     was still zero.

     Preserved exactly as it ships. M2-1 fixes the integrand and the lower limit;
     M2-2 stops dividing by nothing. */
  NS.models = NS.models || {};
  NS.models.labWaves = function (p, t, opts) {
    const td = p.len * PS_PER_IN;
    const tmax = 6 * td;
    const tt = Math.min(Math.max(t === undefined ? tmax : t, 0), tmax);
    const M = K.line1D({ Z0: p.Z0, Rs: p.Rs, RL: p.RL, open: p.open,
                         tr: p.tr, td: td, vs: VS, nWave: NWAVE });
    /* M2-1 · from before the edge, so the account closes across it. The old
       call started at t = 0, which is the middle of a smoothstep centred on
       zero, and the third of the transition before that point went unaccounted. */
    /* N2-3 / R6. The spatial grid is chosen from the EDGE, not fixed at 220.
       A wavefront occupies tr of the line's td, so at 12 inches and a 10 ps edge
       the transition is 0.49% of the line and 220 intervals put barely one
       sample on it. The account then failed to close by 74.59% while still
       reporting `ok` — the conservation equation was right and the quadrature
       was nowhere near it.

       The error is purely SPATIAL and second order: holding nt at 900 and
       doubling nx alone runs 74.59 -> 49.19 -> 18.75 -> 4.76 -> 1.19 -> 0.30%,
       while refining nt alone from 900 to 14400 moves it by 0.0001 percentage
       points. That is what makes the fix cheap — the spatial integral is
       evaluated at two instants, not once per timestep, so nx is nearly free:
       220 and 32768 both cost about a millisecond. */
    const NX_PER_EDGE = 64;      // intervals across the wavefront ramp
    const NX_MIN = 220, NX_MAX = 65536;
    /* Overridable so a convergence test can force a grid the controls cannot
       reach. Within the controls (1-12 inches, 10-500 ps) the cap never binds,
       so the closure budget below would otherwise be a guard nothing could
       exercise — which is a test that cannot fail. */
    const nx = (opts && opts.nx) || Math.min(NX_MAX, Math.max(NX_MIN,
      Math.ceil(NX_PER_EDGE * td / Math.max(p.tr, 1e-9))));
    const e = K.line1DEnergy(M, tt, 900, nx);
    const xp = p.xp / 100;
    const here = K.line1DAt(M, xp, tt);
    const far = K.line1DAt(M, 1, tt);

    /* M2-2 · A percentage needs a denominator worth dividing by. The account now
       starts before the edge, so `fromSource` is a real quantity rather than a
       number that happens to be near zero — but at the very first instant it is
       still genuinely tiny, and a ratio taken there says nothing. The model
       reports the scale it judged the residual against and whether a fraction of
       it means anything; the panel shows absolute picojoules either way. */
    const injected = e.fromSource;
    const accountable = e.scale > 0 && Math.abs(injected) > 0.01 * e.scale;

    /* N2-3d. A residual is only a footnote while it is small. Past this the
       account is not evidence of anything and the model says so rather than
       printing percentages that do not add up. The budget is 1%: the chosen
       grid reaches about 0.09% at the worst combination the controls allow, so
       exceeding it means something other than resolution is wrong. */
    const CLOSURE_BUDGET = 0.01;
    const closes = e.closes;
    const closed = !accountable || closes <= CLOSURE_BUDGET;

    return K.result({
      model: 'labWaves',
      version: '1.2',
      status: closed ? 'ok' : 'no-convergence',
      why: closed ? null
        : 'the energy account closes to only ' + (closes * 100).toFixed(2) + '% '
          + 'at this instant, above the ' + (CLOSURE_BUDGET * 100) + '% budget — the '
          + 'spatial quadrature cannot resolve this wavefront on a line this long',
      params: { Z0: p.Z0, Rs: p.Rs, RL: p.RL, open: p.open, tr: p.tr, len: p.len, t: tt },
      view: { xp: p.xp },
      units: { Z0: 'ohm', Rs: 'ohm', RL: 'ohm', tr: 'ps', len: 'in', t: 'ps',
               energy: 'pJ', v: 'V', i: 'A', td: 'ps' },
      conventions: {
        edge: 'cubic smoothstep centred on t=0, so it begins at -tr/2. The '
          + 'energy account integrates from before that, and closes across the '
          + 'transition (M2-1)',
        source: 'v_s(t) = vs * smoothStep(t, tr), which is what v(0,t) + Rs*i(0,t) '
          + 'evaluates to — the integrand, not the constant final value',
        tr: 'p.tr is the 0-100% support of that smoothstep, not a 10-90% time',
        vs: VS + ' V ideal step behind Rs',
        delay: PS_PER_IN + ' ps/in stripline'
      },
      stimulus: { kind: 'step', vs: VS, tr: p.tr, nWave: NWAVE },
      origins: { t0: 0, td: td, tmax: tmax },
      /* N4-4. V and I along the line at this instant, sampled on the same
         spatial grid the panel draws, with position as a named abscissa. The
         lattice is an event list rather than a curve and is not a trace. */
      traces: (function () {
        const NXOUT = 201, xs = [], vs = [], is = [];
        for (let i = 0; i < NXOUT; i++) {
          const u = i / (NXOUT - 1);
          const q = K.line1DAt(M, u, tt);
          xs.push(u * p.len);          // inches from the source
          vs.push(q.v); is.push(q.i);
        }
        return [
          K.trace('v-x', 'V along the line', 'V', 'position', 'in', xs, vs),
          K.trace('i-x', 'I along the line', 'A', 'position', 'in', xs, is)
        ];
      }()),
      measurements: {
        td: td, tmax: tmax,
        vHere: here.v, iHere: here.i, vFar: far.v, iFar: far.i,
        fromSource: e.fromSource, inRs: e.inRs, inRL: e.inRL,
        onLine: e.onLine, residual: e.residual,
        accountable: accountable, scale: e.scale, closes: e.closes,
        sourceNow: K.line1DSource(M, tt)
      },
      diagnostics: {
        integratedFrom: e.from,
        /* The residual is quadrature error and nothing else, which is a claim
           the gate checks by refining: it falls as 1/nt^2, the trapezoid rate. */
        residualFraction: e.closes,
        known: e.closes > 1e-3 ? ['the energy account closes to only '
          + (e.closes * 100).toFixed(2) + '% at this instant — refine the '
          + 'quadrature before reading the residual as physical'] : []
      },
      generated: { raw: M, energy: e }
    });
  };

  // Compute a history only when physical settings change, never on cursor moves.
  NS.models.labWavesHistorySteps = function* (p) {
    const td = p.len * PS_PER_IN, end = 6 * td;
    const line = K.line1D({ Z0: p.Z0, Rs: p.Rs, RL: p.RL, open: p.open,
      tr: p.tr, td, vs: VS, nWave: NWAVE });
    const nx = Math.min(65536, Math.max(220, Math.ceil(64 * td / p.tr)));
    const times = new Set(Array.from({ length: 121 }, (_, i) => i * end / 120));
    // Retain the beginnings, midpoints and ends of finite boundary transitions.
    for (let k = 0; k <= 6; k++) for (const offset of [-.5, -.25, 0, .25, .5]) {
      const time = k * td + offset * p.tr;
      if (time >= 0 && time <= end) times.add(time);
    }
    const xs = [...times].sort((a, b) => a - b);
    const keys = ['fromSource', 'inRs', 'inRL', 'onLine', 'residual'];
    const labels = ['From source', 'Dissipated in source resistance', 'Delivered to load', 'Stored on line', 'Energy residual'];
    const values = keys.map(() => []);
    let maxResidualFraction = 0;
    for (const time of xs) {
      const e = K.line1DEnergy(line, time, 900, nx);
      maxResidualFraction = Math.max(maxResidualFraction, e.closes);
      keys.forEach((key, i) => values[i].push(e[key]));
      yield; // UI may yield between samples; the synchronous model drains this iterator.
    }
    return { traces: keys.map((key, i) => K.trace('energy-' + key, labels[i], 'pJ', 'time', 'ps', xs, values[i])),
      maxResidualFraction, nx, nt: 900 };
  };

  NS.models.labWavesHistory = function (p) {
    const steps=NS.models.labWavesHistorySteps(p);
    let next; do {next=steps.next();} while(!next.done);
    return next.value;
  };

  // Boundary arrivals are edge midpoints, not necessarily settled plateaus.
  NS.models.labWavesArrival = function (line, td, time, horizon) {
    const k = Math.floor(time / td + 1e-9) + 1;
    if (k * td > horizon) return null;
    const atLoad = k % 2 === 1, m = Math.floor((k - 1) / 2);
    const wave = (atLoad ? line.fwd : line.bwd)[m];
    if (!wave || wave.a === 0) return null;
    const gamma = atLoad ? line.GL : line.GS;
    return { k, m, atLoad, time: k * td, incident: wave.a, gamma,
      reflected: wave.a * gamma, voltageChange: wave.a * (1 + gamma) };
  };

  NS.viz.labWaves = function (root) {
    const $ = (s) => root.querySelector(s);
    const cvLine = $('[data-cv="line"]'), cvCur = $('[data-cv="current"]'),
          cvProbe = $('[data-cv="probe"]'), cvLat = $('[data-cv="lattice"]'),
          cvEnergy = $('[data-cv="energy"]');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const p = { Z0: 50, Rs: 10, RL: 50, open: true, tr: 60, len: 3, xp: 50 };
    let M = null, RES = null, TD = 0, TMAX = 0, t = 0, playing = false, raf = 0, last = 0, hold = 0;
    let history = null, historyState='complete', historyError='';
    let historyJob=null, historyTimer=0, historyGeneration=0, destroyed=false;
    let publishedTime = null, publishedProbe = null;
    let selEvent = null;                       // M6-5, the inspected bounce

    const PRESETS = {
      unterminated: { Rs: 10, RL: 50, open: true, note: 'Fast driver, nothing at the far end. Voltage doubles, current stops dead.' },
      series:       { Rs: 50, RL: 50, open: true, note: 'Rs raised to Z0. The far end still reflects everything, and the returning wave is absorbed at the source rather than re-reflected. Note where the energy goes: an ideal open dissipates NOTHING, so every joule that leaves the source ends up in Rs or still standing on the line.' },
      parallel:     { Rs: 10, RL: 50, open: false, note: 'Z0 at the load. Nothing reflects, so the load absorbs ALL of the incident wave\u2019s power. It is a smaller wave than the source could have launched \u2014 the 10 \u03a9 driver and the 50 \u03a9 line form a divider, so 83% of the source voltage sets off down the line \u2014 but of what arrives, none comes back.' },
      shorted:      { Rs: 10, RL: 0,  open: false, note: 'ΓL = −1. Voltage cancels, current doubles — the mirror image of an open.' },
      mismatch:     { Rs: 20, RL: 75, open: false, note: 'Partial reflection at both ends: the common real case.' }
    };

    /* N4-2. Repaint from RES; do not re-solve the line and its energy account
       because a legend entry was clicked. */
    K.onRepaint(root, () => { if (RES) draw(); });

    function publishState() {
      const result = NS.models.labWaves(p, t);
      result.diagnostics.energyHistory={status:historyState};
      if(historyError)result.diagnostics.energyHistory.why=historyError;
      if (history && result.status === 'ok') {
        result.traces.push(...history.traces);
        result.diagnostics.energyHistory = { status:'complete', samples: history.traces[0].y.length,
          nx: history.nx, nt: history.nt, maxResidualFraction: history.maxResidualFraction };
      }
      return K.publish(root, result);
    }
    function runHistory(generation) {
      if(destroyed || generation!==historyGeneration || !historyJob)return;
      const start=performance.now();
      try {
        let step;
        do { step=historyJob.next(); } while(!step.done && performance.now()-start<8);
        if(destroyed || generation!==historyGeneration)return;
        if(!step.done){historyTimer=setTimeout(()=>runHistory(generation),0);return;}
        history=step.value;historyState='complete';historyJob=null;
      } catch(error) {
        historyState='failed';historyError='Energy history could not be calculated. Change a physical setting to retry.';
        historyJob=null;
      }
      RES=publishState();draw();
    }
    function flushHistory() {
      if(!historyJob || destroyed)return;
      clearTimeout(historyTimer);
      const generation=historyGeneration;
      historyTimer=setTimeout(()=>runHistory(generation),0);
    }
    function rebuild(initial=false, delay=120) {
      resetPrediction();
      selEvent = null;
      // Dismiss a pinned probe before hiding its old history surface.
      cvEnergy.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));
      clearTimeout(historyTimer);historyGeneration++;
      history=null;historyJob=null;historyError='';
      historyState=initial?'complete':'pending';
      if(initial)history=NS.models.labWavesHistory(p);
      else {
        historyJob=NS.models.labWavesHistorySteps({...p});
        const generation=historyGeneration;
        historyTimer=setTimeout(()=>runHistory(generation),delay);
      }
      RES = publishState();
      publishedTime = t; publishedProbe = p.xp;
      TD = RES.measurements.td;
      TMAX = RES.measurements.tmax;
      M = RES.generated.raw;
      if (t > TMAX) t = TMAX;
      syncControls();
      draw();
    }

    function syncControls() {
      $('#lw-z0').value = p.Z0;  $('#lw-z0-out').value = p.Z0 + ' Ω';
      $('#lw-rs').value = p.Rs;  $('#lw-rs-out').value = p.Rs + ' Ω';
      $('#lw-rl').value = p.RL;  $('#lw-rl-out').value = p.open ? '∞ (open)' : p.RL + ' Ω';
      $('#lw-rl').disabled = p.open;
      $('#lw-open').checked = p.open;
      $('#lw-len').value = p.len; $('#lw-len-out').value = p.len + ' in';
      $('#lw-tr').value = p.tr;  $('#lw-tr-out').value = p.tr + ' ps';
      $('#lw-xp').value = p.xp;  $('#lw-xp-out').value = p.xp + ' %';
      $('#lw-t').max = Math.round(TMAX);
      $('#lw-t').value = Math.round(t);
      $('#lw-t-out').value = (t / 1000).toFixed(2) + ' ns';
    }

    /* ---------- ranges ----------
       Fixed across the whole sweep, not per frame: an axis that rescales as the
       wave arrives makes a growing wave look static. */
    function ranges() {
      let vlo = 0, vhi = M.vFinal, ilo = 0, ihi = 0;
      for (let k = 0; k <= 300; k++) {
        const tk = (k / 300) * TMAX;
        for (let j = 0; j <= 10; j++) {
          const s = K.line1DAt(M, j / 10, tk);
          if (s.v < vlo) vlo = s.v; if (s.v > vhi) vhi = s.v;
          if (s.i < ilo) ilo = s.i; if (s.i > ihi) ihi = s.i;
        }
      }
      const vp = Math.max(0.1, (vhi - vlo) * 0.15);
      const ip = Math.max(0.002, (ihi - ilo) * 0.15);
      return { vlo: vlo - vp, vhi: vhi + vp, ilo: ilo - ip, ihi: ihi + ip };
    }
    let R = null;

    /* ---------- panel 1 · voltage along the line ---------- */
    function drawAlong(cv, kind, T) {
      const s = K.canvas(cv, 200);
      const isV = kind === 'v';
      const P = K.plot(s, T, {
        pad: { l: 56, r: 16, t: 16, b: 30 },
        x: { min: 0, max: p.len, count: Math.min(6, p.len), fmt: (x) => x.toFixed(0), title: 'inches from the driver' },
        y: isV
          ? { min: R.vlo, max: R.vhi, count: 4, fmt: (v) => (v * 1000).toFixed(0), title: 'mV' }
          : { min: R.ilo, max: R.ihi, count: 4, fmt: (v) => (v * 1000).toFixed(1), title: 'mA' }
      }).grid();

      const N = 260;
      const pick = (S) => (isV ? S.v : S.i);
      const pf = (S) => (isV ? S.f : S.f / M.Z0);
      const pb = (S) => (isV ? S.b : -S.b / M.Z0);

      P.trace((i) => { const xn = i / N; return [xn * p.len, pf(K.line1DAt(M, xn, t))]; },
              T.muted, { n: N + 1, width: 1.4, dash: [5, 3] });
      P.trace((i) => { const xn = i / N; return [xn * p.len, pb(K.line1DAt(M, xn, t))]; },
              T.reflect, { n: N + 1, width: 1.4, dash: [2, 3] });
      P.trace((i) => { const xn = i / N; return [xn * p.len, pick(K.line1DAt(M, xn, t))]; },
              T.signal, { n: N + 1, width: 2.4, glow: true });

      // the probe, and the two ends
      const xp = p.xp / 100;
      const S = K.line1DAt(M, xp, t);
      P.vline(xp * p.len, T.ink2, [3, 3], null);
      K.dot(s.ctx, P.X(xp * p.len), P.Y(pick(S)), T.signal, T.surface, 4);
      const event = selectedWave();
      if (event && t >= event.t0 && t <= event.t0 + TD) {
        const u = (t - event.t0) / TD;
        const position = event.dir === 'forward' ? u : 1 - u;
        P.vline(position * p.len, T.reflect, [2, 3], null);
        K.dot(s.ctx, P.X(position * p.len),
          P.Y(pick(K.line1DAt(M, position, t))), T.reflect, T.surface, 6);
      }
      P.frame();
      return S;
    }

    /* ---------- panel 3 · the probe over time ---------- */
    function drawProbe(cv, T) {
      const s = K.canvas(cv, 210);
      const P = K.plot(s, T, {
        /* keepR: the right margin here is the current axis, not trace labels. */
        pad: { l: 56, r: 46, t: 16, b: 30, keepR: true },
        x: { min: 0, max: TMAX / 1000, count: 6, fmt: (v) => v.toFixed(1), title: 'ns' },
        y: { min: R.vlo, max: R.vhi, count: 4, fmt: (v) => (v * 1000).toFixed(0), title: 'mV' }
      }).grid();
      const xp = p.xp / 100, N = 420;

      /* Current is drawn on the SAME box, mapped through the current range, and
         labelled on the right. Two y-scales on one plot is a thing to do rarely
         and say loudly — but V and I here are the same event seen two ways, and
         separating them costs the reader the comparison the panel exists for. */
      const iToV = (i) => R.vlo + (i - R.ilo) / (R.ihi - R.ilo) * (R.vhi - R.vlo);

      P.trace((k) => { const tk = (k / N) * TMAX; return [tk / 1000, iToV(K.line1DAt(M, xp, tk).i)]; },
              T.reflect, { n: N + 1, width: 1.8, dash: [4, 3] });
      P.trace((k) => { const tk = (k / N) * TMAX; return [tk / 1000, K.line1DAt(M, xp, tk).v]; },
              T.signal, { n: N + 1, width: 2.2, glow: true });

      // right-hand current axis
      const ctx = s.ctx, B = P.box;
      for (let k = 0; k <= 4; k++) {
        const iv = R.ilo + (k / 4) * (R.ihi - R.ilo);
        K.text(ctx, (iv * 1000).toFixed(1), B.R + 6, P.Y(iToV(iv)), T.reflect, 10, 'left');
      }
      if (!P.narrow) K.text(ctx, 'mA', B.R + 6, B.TP - 9, T.reflect, 10, 'left');

      const event = selectedWave();
      if (event) {
        const arrival = event.t0 + TD * (event.dir === 'forward' ? xp : 1 - xp);
        P.vline(arrival / 1000, T.reflect, [2, 3], null);
        K.dot(ctx, P.X(arrival / 1000), P.Y(K.line1DAt(M, xp, arrival).v),
          T.reflect, T.surface, 6);
      }
      P.vline(t / 1000, T.ink2, [3, 3], null);
      P.frame();
    }

    /* ---------- panel 4 · lattice ---------- */
    function drawLattice(cv, T) {
      const s = K.canvas(cv, 210);
      const ctx = s.ctx, w = s.w, h = s.h;
      const L = 46, Rr = w - 16, TP = 16, B = h - 26;
      const X = (xn) => L + xn * (Rr - L);
      const Y = (ps) => TP + (ps / TMAX) * (B - TP);

      K.line(ctx, L, TP, L, B, T.border, 1);
      K.line(ctx, Rr, TP, Rr, B, T.border, 1);
      K.text(ctx, 'driver', L, B + 13, T.muted, 10, 'center');
      K.text(ctx, 'load', Rr, B + 13, T.muted, 10, 'center');
      for (let k = 0; k * TD <= TMAX + 1e-9; k++) {
        const y = Y(k * TD);
        K.line(ctx, L, y, Rr, y, T.grid, k % 2 ? 0.4 : 1);
        if (k % 2 === 0) K.text(ctx, k + ' Td', L - 8, y, T.muted, 10, 'right');
      }

      // one segment per launched wave, thickness by amplitude
      const amax = Math.abs(M.a0) || 1;
      for (let m = 0; m < M.n; m++) {
        [[M.fwd[m], 0, 1], [M.bwd[m], 1, 0]].forEach(([wv, x0, x1]) => {
          if (wv.t0 >= TMAX || Math.abs(wv.a) < 0.004) return;
          const tEnd = Math.min(wv.t0 + TD, TMAX);
          const frac = (tEnd - wv.t0) / TD;
          const xe = x0 + (x1 - x0) * frac;
          const done = wv.t0 + TD <= t;
          const live = wv.t0 <= t && !done;
          K.line(ctx, X(x0), Y(wv.t0), X(xe), Y(tEnd),
                 wv.a >= 0 ? T.signal : T.alarm,
                 Math.max(0.8, 3.2 * Math.abs(wv.a) / amax));
          if (live) {
            const f2 = Math.min(1, (t - wv.t0) / TD);
            K.dot(ctx, X(x0 + (x1 - x0) * f2), Y(t), T.ink, T.surface, 3);
          }
        });
      }
      K.line(ctx, L, Y(t), Rr, Y(t), T.ink2, 1, [4, 3]);
      K.text(ctx, 'now', Rr - 2, Y(t) - 8, T.ink2, 10, 'right');

      /* M6-5 · Record where each segment was drawn, so a click can identify it.
         A bounce diagram that cannot be interrogated is a picture of the answer
         rather than a way to get it: the question a reader has is "which of
         these is responsible for the step I can see on the probe", and that is
         answerable only if each segment knows its own parentage. */
      cv.__events = [];
      for (let m = 0; m < M.n; m++) {
        [[M.fwd[m], 0, 1, 'forward'], [M.bwd[m], 1, 0, 'backward']].forEach(
          ([wv, x0, x1, dir]) => {
            if (wv.t0 >= TMAX || Math.abs(wv.a) < 0.004) return;
            cv.__events.push({ m, dir, t0: wv.t0, a: wv.a, x0, x1,
                               arrives: wv.t0 + TD });
          });
      }
      cv.__lat = { L, Rr, TP, B, X, Y };
      if (selEvent) {
        const e = cv.__events.find((q) => q.m === selEvent.m && q.dir === selEvent.dir);
        if (e) {
          const tEnd = Math.min(e.t0 + TD, TMAX);
          const frac = (tEnd - e.t0) / TD;
          K.line(ctx, X(e.x0), Y(e.t0),
                 X(e.x0 + (e.x1 - e.x0) * frac), Y(tEnd), T.reflect, 3.6);
          K.dot(ctx, X(e.x0), Y(e.t0), T.reflect, T.surface, 4);
        }
      }
    }

    /* M6-5 · What produced a given wave, derived rather than narrated. The
       model is a geometric series: forward wave m has amplitude
       a0*(GL*GS)^m and backward wave m has a0*GL*(GL*GS)^m, so the parent of
       any segment and the coefficient that made it are both arithmetic. */
    function explainEvent(e) {
      if (!e) return null;
      const born = e.dir === 'forward'
        ? (e.m === 0 ? 'the source, at launch'
                     : 'backward wave ' + (e.m - 1) + ' reflecting off the SOURCE')
        : 'forward wave ' + e.m + ' reflecting off the LOAD';
      const gamma = e.dir === 'forward'
        ? (e.m === 0 ? null : M.GS)
        : M.GL;
      const parentA = e.dir === 'forward'
        ? (e.m === 0 ? null : M.bwd[e.m - 1].a)
        : M.fwd[e.m].a;
      return {
        born, gamma, parentA,
        launchedAt: e.t0,
        arrivesAt: e.arrives,
        amplitude: e.a,
        /* Its contribution to what the far end sees: a forward wave adds its
           amplitude times (1 + GL) there, because the reflection is already on
           its way back before the sum settles. A backward wave contributes
           nothing new at the load — it is leaving. */
        atLoad: e.dir === 'forward' ? e.a * (1 + M.GL) : 0
      };
    }

    function drawEnergy(T) {
      const host=cvEnergy.closest('.probe-host');
      cvEnergy.hidden=!history;if(host)host.hidden=!history;
      const note=$('[data-out="energy-history"]');
      if(note.dataset.state!==historyState)note.dataset.state=historyState;
      if (!history) {
        const s=K.canvas(cvEnergy,340);s.ctx.clearRect(0,0,s.w,s.h);
        cvEnergy.__plot=null;cvEnergy.__traces=[];
        const message=historyState==='failed'?historyError:
          'Updating energy history for the current settings. Instantaneous results are current; history traces are omitted from exports until ready.';
        if(note.textContent!==message)note.textContent=message;
        return;
      }
      const s = K.canvas(cvEnergy, 340), ctx = s.ctx;
      const traces = history.traces;
      const all = traces.slice(0, 4).flatMap((trace) => trace.y);
      if (RES.measurements) all.push(...['fromSource', 'inRs', 'inRL', 'onLine'].map(key => RES.measurements[key]));
      const low = Math.min(0, ...all), high = Math.max(.01, ...all);
      const pad = (high - low) * .08;
      const P = K.plot(s, T, {
        pad: { l: 58, r: 18, t: 20, b: 126 },
        x: { min: 0, max: TMAX / 1000, count: 6, fmt: v => v.toFixed(1) },
        y: { min: low - pad, max: high + pad, count: 4, fmt: v => v.toFixed(1), title: 'pJ' }
      }).grid();
      const colours = [T.ink, T.reflect, T.signal, T.muted];
      const dashes = [[], [5, 3], [], [2, 3]];
      traces.slice(0, 4).forEach((trace, i) => {
        P.trace(k => [trace.x.values[k] / 1000, trace.y[k]], colours[i],
          { n: trace.y.length, width: i === 2 ? 2.4 : 1.8, dash: dashes[i] });
        const value = RES.measurements && RES.measurements[['fromSource','inRs','inRL','onLine'][i]];
        if (Number.isFinite(value)) K.dot(ctx, P.X(t / 1000), P.Y(value), colours[i], T.surface, 4);
      });
      P.vline(t / 1000, T.reflect, [3, 3], null); P.frame();
      const residual = traces[4];
      const currentResidual = RES.measurements ? RES.measurements.residual : 0;
      const limit = Math.max(.00001, Math.abs(currentResidual), ...residual.y.map(Math.abs)) * 1.15;
      const Q = K.plot(s, T, {
        pad: { l: 58, r: 18, t: 251, b: 30 },
        x: { min: 0, max: TMAX / 1000, count: 6, fmt: v => v.toFixed(1), title: 'ns' },
        y: { min: -limit, max: limit, count: 2, fmt: v => v.toExponential(1), title: 'pJ residual' }
      }).grid();
      Q.trace(k => [residual.x.values[k] / 1000, residual.y[k]], T.alarm,
        { n: residual.y.length, width: 1.6 });
      Q.vline(t / 1000, T.reflect, [3, 3], null);
      K.dot(ctx, Q.X(t / 1000), Q.Y(currentResidual), T.alarm, T.surface, 4); Q.frame();
      const message = 'Sampled history; straight lines join ' +
        residual.y.length + ' computed times. Cursor dots use the current calculation. Maximum sampled closure error: ' +
        (history.maxResidualFraction * 100).toFixed(3) + '% of the largest energy term. ' +
        'Residual has its own scale; it is numerical imbalance, not missing physical energy.';
      if(note.textContent!==message)note.textContent=message;
    }

    /* ---------- the energy account ---------- */
    /* M2-2 · Absolute picojoules first, percentages only where the denominator
       is worth dividing by. The old version divided by max(|fromSource|, 1e-12),
       which at t = 0 is a clamp rather than a quantity, and the panel printed
       "still on the line 296,509,210.4%" and "unaccounted for -296,509,118.7%".
       Those were not numerical residue; they were a timing defect expressed as a
       percentage of nearly nothing. */
    function energyRows() {
      const m = RES.measurements;
      const pj = (v) => (Math.abs(v) < 5e-4 ? '0.00' : v.toFixed(2)) + ' pJ';
      const pc = (v) => (m.accountable ? (100 * v / m.fromSource).toFixed(1) + '%' : '—');
      const rows = [
        { label: 'out of the source', value: pj(m.fromSource),
          note: m.accountable ? null : 'the edge has barely started' },
        { label: 'burned in R\u209b', value: pj(m.inRs), note: pc(m.inRs), colour: 'reflect' },
        { label: 'delivered to R\u029f', value: pj(m.inRL), note: pc(m.inRL), colour: 'signal' },
        { label: 'still on the line', value: pj(m.onLine), note: pc(m.onLine), colour: 'muted' }
      ];
      /* The residual is judged against the largest energy in the account, not
         against the injected energy, so that an early instant is measured
         against something real. */
      rows.push({
        label: 'unaccounted for',
        value: pj(m.residual),
        note: m.scale > 0
          ? (100 * Math.abs(m.residual) / m.scale).toFixed(3) + '% of the largest term'
          : 'nothing to account for yet'
      });
      return rows;
    }

    function readouts() {
      const xp = p.xp / 100, S = K.line1DAt(M, xp, t);
      $('[data-out="gs"]').textContent = sgn(M.GS);
      $('[data-out="gl"]').textContent = sgn(M.GL);
      $('[data-out="td"]').textContent = TD.toFixed(0) + ' ps';
      $('[data-out="vp"]').textContent = (S.v * 1000).toFixed(0) + ' mV';
      $('[data-out="ip"]').textContent = (S.i * 1000).toFixed(2) + ' mA';
      /* The instantaneous ratio at the probe. On a line that is not yet settled
         this is NOT Z0 and not RL — it is whatever the mix of waves happens to
         be, which is exactly what a TDR measures and mis-reads. */
      /* Before anything arrives both are zero and the ratio is 0/0, which is not
         infinity and must not be drawn as one. Only a real open circuit — some
         voltage, no current — earns the infinity sign. */
      const quiet = Math.abs(S.v) < 1e-9 && Math.abs(S.i) < 1e-9;
      $('[data-out="zp"]').textContent = quiet ? '—'
        : (Math.abs(S.i) > 1e-9 ? (S.v / S.i).toFixed(1) + ' Ω' : '∞');
      K.summary(root, energyRows(), { label: 'Energy account at this instant' });
    }
    const sgn = (x) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(2);

    let T = null;
    function draw() {
      t = Math.round(t); // Match the 1 ps cursor resolution stored in scenario links.
      // Time and probe controls also change public results, not only pixels.
      if (publishedTime !== t || publishedProbe !== p.xp) {
        RES = publishState();
        publishedTime = t; publishedProbe = p.xp;
      }
      T = K.theme(root);
      if (!R) R = ranges();
      drawAlong(cvLine, 'v', T);
      drawAlong(cvCur, 'i', T);
      drawProbe(cvProbe, T);
      drawLattice(cvLat, T);
      drawEnergy(T);
      readouts();
      eventReadout();
      if (prediction && prediction.cursor !== t) resetPrediction();
    }

    /* M6-5 · Click or arrow-key a bounce to be told what produced it. */
    function selectedWave() {
      if (!selEvent) return null;
      const wave = (selEvent.dir === 'forward' ? M.fwd : M.bwd)[selEvent.m];
      return wave ? { ...wave, dir: selEvent.dir } : null;
    }
    function selectEvent(event) {
      pause();
      selEvent = { m: event.m, dir: event.dir };
      t = event.t0 + TD * (event.dir === 'forward' ? p.xp / 100 : 1 - p.xp / 100);
      t = Math.min(TMAX, t);
      syncControls(); draw();
    }
    function pickEvent(px, py) {
      const lat = cvLat.__lat, evs = cvLat.__events;
      if (!lat || !evs || !evs.length) return;
      let best = null, bd = Infinity;
      evs.forEach((e) => {
        const tEnd = Math.min(e.t0 + TD, TMAX);
        const frac = (tEnd - e.t0) / TD;
        const x1 = lat.X(e.x0 + (e.x1 - e.x0) * frac), y1 = lat.Y(tEnd);
        const x0 = lat.X(e.x0), y0 = lat.Y(e.t0);
        /* distance from the click to the segment */
        const dx = x1 - x0, dy = y1 - y0;
        const len2 = dx * dx + dy * dy;
        const u = len2 ? Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2)) : 0;
        const d = Math.hypot(px - (x0 + u * dx), py - (y0 + u * dy));
        if (d < bd) { bd = d; best = e; }
      });
      if (best && bd < 14) selectEvent(best);
    }

    function eventReadout() {
      const host = $('[data-out="event-detail"]');
      if (!host) return;
      if (!selEvent) {
        host.textContent = 'Select a wave with a click or arrow keys. Time pauses at its probe crossing; amber markers link the spatial and probe plots.';
        return;
      }
      const e = (cvLat.__events || []).find((q) => q.m === selEvent.m && q.dir === selEvent.dir);
      const x = explainEvent(e);
      if (!x) { host.textContent = 'That wave is no longer in range.'; return; }
      const mv = (v) => (v * 1000).toFixed(0) + ' mV';
      host.innerHTML =
        '<b>' + (e.dir === 'forward' ? 'Forward' : 'Backward') + ' wave ' + e.m + '</b>'
        + ' \u00b7 born from ' + x.born
        + (x.gamma !== null
            ? ' \u00b7 \u0393 = ' + (x.gamma >= 0 ? '+' : '') + x.gamma.toFixed(2)
              + ' \u00d7 ' + mv(x.parentA) + ' = ' + mv(x.amplitude)
            : ' \u00b7 ' + mv(x.amplitude) + ' from the source divider')
        + ' · probe crossing at ' + (e.t0 + TD * (e.dir === 'forward' ? p.xp / 100 : 1 - p.xp / 100)).toFixed(0) + ' ps (edge midpoint, cursor rounded to 1 ps); amber markers link this wave to the spatial and probe plots. The energy account follows the current time and includes all waves.'
        + ' \u00b7 leaves at ' + x.launchedAt.toFixed(0) + ' ps, arrives at '
        + x.arrivesAt.toFixed(0) + ' ps'
        + (e.dir === 'forward'
            ? ' \u00b7 adds ' + mv(x.atLoad) + ' at the load, because the '
              + 'reflection it causes is already on its way back'
            : ' \u00b7 adds nothing further at the load \u2014 it is leaving');
    }

    cvLat.tabIndex = 0;
    cvLat.addEventListener('click', (e) => {
      const r = cvLat.getBoundingClientRect();
      const P = cvLat.__lat;
      if (!P || !(r.width > 0)) return;
      const sc = r.width / cvLat.width * (window.devicePixelRatio > 1 ? 1 : 1);
      /* The canvas is laid out fluid and drawn at devicePixelRatio, so the
         click has to be mapped through both. __lat holds CSS-pixel geometry. */
      const scale = r.width / (cvLat.width / Math.min(window.devicePixelRatio || 1, 2));
      pickEvent((e.clientX - r.left) / scale, (e.clientY - r.top) / scale);
    });
    cvLat.addEventListener('keydown', (e) => {
      const evs = cvLat.__events || [];
      if (!evs.length) return;
      const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1
              : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const i = selEvent
        ? evs.findIndex((q) => q.m === selEvent.m && q.dir === selEvent.dir)
        : -1;
      const n = (i + d + evs.length) % evs.length;
      selectEvent(evs[n]);
    });

    /* ---------- transport ---------- */
    const btnPlay = $('[data-act="play"]');
    function frame(ts) {
      if (!playing) return;
      const dt = Math.min(64, ts - (last || ts)); last = ts;
      if (hold > 0) { hold -= dt; } else {
        t += dt * (TMAX / 4200);
        if (t >= TMAX) { t = TMAX; hold = 800; }
      }
      if (hold > 0 && t >= TMAX && hold <= 40) t = 0;
      syncControls(); draw();
      raf = requestAnimationFrame(frame);
    }
    function play() {
      if (playing) return;
      if (t >= TMAX) t = 0;
      playing = true; last = 0; hold = 0;
      btnPlay.textContent = '❚❚ Pause'; btnPlay.setAttribute('aria-pressed', 'true');
      raf = requestAnimationFrame(frame);
    }
    function pause() {
      playing = false; cancelAnimationFrame(raf);
      btnPlay.textContent = '▶ Play'; btnPlay.setAttribute('aria-pressed', 'false');
    }
    btnPlay.addEventListener('click', () => (playing ? pause() : play()));

    /* Step to the next boundary crossing — the instants that matter here are not
       evenly spaced frames, they are arrivals. */
    function stepTo(k) {
      pause();
      const kk = Math.max(0, Math.min(6, k));
      t = kk * TD;
      $('[data-out="ev"]').textContent = eventText(kk);
      syncControls(); draw();
    }
    function eventText(k) {
      if (k === 0) return 'launch · ' + (M.a0 * 1000).toFixed(0) + ' mV into ' + M.Z0 + ' Ω';
      const bounces = Math.floor((k - 1) / 2);
      const amp = M.a0 * Math.pow(M.GL * M.GS, bounces) * (k % 2 ? 1 : M.GL);
      const G = k % 2 ? M.GL : M.GS;
      return (k % 2 ? 'at the load' : 'at the driver') + ' · Γ = ' + sgn(G)
        + ' · returns ' + sgn(amp * G * 1000).replace(/\.\d+$/, '') + ' mV';
    }
    $('[data-act="prev"]').addEventListener('click', () => stepTo(Math.round(t / TD) - 1));
    $('[data-act="next"]').addEventListener('click', () => stepTo(Math.floor(t / TD + 1e-6) + 1));

    /* Prediction stays tied to one paused experiment. Any parameter/time edit
       invalidates it; revealing advances to the tested boundary midpoint. */
    let prediction = null;
    const predictionHost = $('[data-out="prediction"]');
    const guess = $('#lw-prediction');
    const reveal = $('[data-act="reveal-arrival"]');
    function resetPrediction() {
      prediction = null;
      if (reveal) reveal.disabled = true;
      if (predictionHost) predictionHost.textContent = 'Pause and predict the sign of the next reflected voltage wave.';
    }
    $('[data-act="predict-arrival"]').addEventListener('click', () => {
      pause();
      const event = NS.models.labWavesArrival(M, TD, t, TMAX);
      if (!event) {
        resetPrediction();
        predictionHost.textContent = 'No further nonzero incident wave in this time window. Rewind or change the termination to try another experiment.';
        return;
      }
      prediction = { event, cursor: t }; guess.value = ''; reveal.disabled = false;
      predictionHost.textContent = 'The next incident voltage wave is ' +
        (event.incident * 1000).toFixed(1) + ' mV, heading to the ' +
        (event.atLoad ? 'load' : 'source') + '. Predict the sign of the reflected voltage wave before revealing.';
    });
    reveal.addEventListener('click', () => {
      if (!prediction) return;
      if (!guess.value) { predictionHost.textContent = 'Choose positive, negative or zero before revealing.'; return; }
      const event = prediction.event;
      const sign = event.reflected === 0 ? 'zero' : event.reflected > 0 ? 'positive' : 'negative';
      const correct = guess.value === sign;
      prediction = null;
      selEvent = { m: event.m, dir: event.atLoad ? 'forward' : 'backward' };
      stepTo(event.k);
      reveal.disabled = true;
      predictionHost.textContent = (correct ? 'Correct. ' : 'Try the reflection coefficient: ') +
        'At ' + event.time.toFixed(0) + ' ps, Γ = ' + event.gamma.toFixed(3) +
        '; reflected voltage = Γ × incident voltage = ' + (event.reflected * 1000).toFixed(1) +
        ' mV (' + sign + '). This incident wave and its reflection contribute ' +
        (event.voltageChange * 1000).toFixed(1) + ' mV of eventual boundary voltage change. ' +
        'The cursor marks the edge midpoint; other waves can overlap, so this is not the instantaneous total voltage. ' +
        'Current is positive toward the load; each backward voltage wave contributes −V/Z₀ to current.';
    });

    /* ---------- controls ---------- */
    const wire = (id, key, after) => {
      $(id).addEventListener('input', (e) => {
        p[key] = +e.target.value;
        clearPreset();
        if (after) R = null;
        rebuild();
      });
      $(id).addEventListener('change',flushHistory);
    };
    wire('#lw-z0', 'Z0', true);
    wire('#lw-rs', 'Rs', true);
    wire('#lw-rl', 'RL', true);
    wire('#lw-len', 'len', true);
    wire('#lw-tr', 'tr', true);
    $('#lw-xp').addEventListener('input', (e) => { p.xp = +e.target.value; syncControls(); draw(); });
    $('#lw-t').addEventListener('input', (e) => { pause(); t = +e.target.value; syncControls(); draw(); });
    $('#lw-open').addEventListener('change', (e) => { p.open = e.target.checked; clearPreset(); R = null; rebuild(false,0); });

    function clearPreset() {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      $('[data-out="note"]').textContent = 'Custom';
    }
    root.querySelectorAll('.preset[data-preset]').forEach((b) => {
      b.addEventListener('click', () => {
        const c = PRESETS[b.dataset.preset];
        if (!c) return;   // a .preset with no data-preset is not one
        Object.assign(p, { Rs: c.Rs, RL: c.RL, open: c.open });
        root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
        $('[data-out="note"]').textContent = c.note;
        R = null; rebuild(false,0);
      });
    });

    /* first frame complete at rest, per the module contract */
    t = reduce ? 1.6 * p.len * PS_PER_IN : 0;
    rebuild(true);
    $('[data-out="note"]').textContent = PRESETS.unterminated.note;
    root.querySelector('.preset[data-preset="unterminated"]').setAttribute('aria-pressed', 'true');
    $('[data-out="ev"]').textContent = eventText(0);

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMotion = () => { if (mq.matches) { pause(); t = TMAX; syncControls(); draw(); } };
    mq.addEventListener('change', onMotion);
    root.addEventListener('sipi:theme', draw);
    document.addEventListener('sipi:theme', draw);
    let rt = 0;
    const onResize = () => { clearTimeout(rt); rt = setTimeout(draw, 120); };
    window.addEventListener('resize', onResize);

    return {
      start() { if (!reduce) play(); },
      stop() { pause(); },
      destroy() {
        destroyed=true;historyGeneration++;historyJob=null;
        clearTimeout(historyTimer);clearTimeout(rt);
        pause();
        root.removeEventListener('sipi:theme',draw);
        window.removeEventListener('resize', onResize);
        document.removeEventListener('sipi:theme', draw);
        mq.removeEventListener('change', onMotion);
      }
    };
  };
})();
