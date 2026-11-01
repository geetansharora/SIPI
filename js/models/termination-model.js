/* SI & PI — models/termination-model.js
 * Six ways to end a line, driven with real data, and what each one costs.
 *
 * K.line1D (Lab A, the reflections page) is exact by superposition, and that
 * superposition only exists for resistors. Everything this page is about needs
 * more than that: a capacitor in an AC terminator, a receiver's own input
 * capacitance, a Thevenin pair pulled to two rails, a second receiver half-way
 * down the line, and a board resistor that sits a stub and a via away from the
 * pin. So this file solves the circuit in time instead.
 *
 * The method is Bergeron's (method of characteristics). A lossless line of
 * impedance Z0 and delay Td looks, from either end, like a resistor Z0 in series
 * with a source of twice the wave arriving at that end:
 *
 *     v_end = 2·a(t) + Z0·i_in,    a(t) = wave leaving the other end at t − Td
 *
 * which is exact for a lossless line: it is the definition of a travelling wave,
 * not an approximation to one. Capacitors and inductors use trapezoidal companion
 * models, which conserve energy, so the energy account closes. With every
 * element a conductance and a current, each time step is one small nodal solve
 * whose matrix never changes, so it is factored once.
 *
 *   capacitor   i(n+1) = (2C/dt)·v(n+1) − [(2C/dt)·v(n) + i(n)]
 *   inductor    i(n+1) = (dt/2L)·v(n+1) + [i(n) + (dt/2L)·v(n)]
 *   line end    i_in(n+1) = (v(n+1) − 2·a(n+1))/Z0
 *
 * Units: ps, V, ohm, pF, nH (converted to ohm·ps), so currents come out in A,
 * energies in pJ and powers in W.
 *
 * Requires js/viz-kit.js (for K.smoothStep only).
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  NS.models = NS.models || {};
  const K = NS.kit;

  const VDD = 1.2;            // V, the rail the page's arithmetic uses
  const Z0 = 50;              // ohm
  const VIL = 0.35 * VDD, VIH = 0.65 * VDD;   // a CMOS-style receiver's thresholds
  const BUS = 32;             // nets, for the bus total
  const PS_PER_MM = 6.7;      // stripline in FR-4, Dk about 4
  const STUB_MM = 5, LVIA = 2;              // the deeper section's board terminator
  const SMOOTH_1090 = 0.608;  // a cubic smoothstep's 10-90% time over its support
  const SKIP = 2;             // bits at the start of a pattern left out of every measurement

  /* ---------- dense LU with partial pivoting, for the few-node systems here ---------- */
  function lu(A) {
    const n = A.length, M = A.map((r) => Float64Array.from(r)), piv = new Int32Array(n);
    for (let k = 0; k < n; k++) {
      let p = k, best = Math.abs(M[k][k]);
      for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > best) { best = Math.abs(M[i][k]); p = i; }
      if (!(best > 0)) throw new Error('termination model: singular nodal matrix');
      piv[k] = p;
      if (p !== k) { const t = M[k]; M[k] = M[p]; M[p] = t; }
      for (let i = k + 1; i < n; i++) {
        const f = (M[i][k] /= M[k][k]);
        if (f) for (let j = k + 1; j < n; j++) M[i][j] -= f * M[k][j];
      }
    }
    return { M, piv, n };
  }
  function luSolve(F, b) {
    const { M, piv, n } = F, x = Float64Array.from(b);
    for (let k = 0; k < n; k++) { const p = piv[k]; if (p !== k) { const t = x[k]; x[k] = x[p]; x[p] = t; } }
    for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) x[i] -= M[i][j] * x[j];
    for (let i = n - 1; i >= 0; i--) {
      for (let j = i + 1; j < n; j++) x[i] -= M[i][j] * x[j];
      x[i] /= M[i][i];
    }
    return x;
  }

  /* ---------- the netlist ----------
     n       number of nodes (ground is -1)
     S       sources: { a, R, v(t), parts: [{ R, tag }] } -- an ideal source v(t)
             behind R into node a; `parts` splits R into the resistors it stands
             for (the driver's own impedance and a series terminator)
     R       resistors: { a, b, R, v, tag } -- b = -1 means to a fixed rail at v
     C, L    { a, b, C } in pF, { a, b, L } in nH
     T       lines: { a, b, Z0, td } with td in ps
  */
  const GBIG = 1e6;           // a line or an inductor at DC: a wire

  function stamp(G, a, b, g) {
    if (a >= 0) G[a][a] += g;
    if (b >= 0) G[b][b] += g;
    if (a >= 0 && b >= 0) { G[a][b] -= g; G[b][a] -= g; }
  }
  const zeros = (n) => Array.from({ length: n }, () => new Array(n).fill(0));
  const at = (v, i) => (i < 0 ? 0 : v[i]);

  /* The DC operating point with every source at v(t). Capacitors are open,
     inductors and lines are wires. Returns node voltages and, for each inductor
     and line, the current flowing from a to b. */
  function dcSolve(net, t) {
    const G = zeros(net.n), J = new Array(net.n).fill(0);
    net.S.forEach((s) => { stamp(G, s.a, -1, 1 / s.R); J[s.a] += s.v(t) / s.R; });
    net.R.forEach((r) => { stamp(G, r.a, r.b, 1 / r.R); if (r.b < 0 && r.v) J[r.a] += r.v / r.R; });
    net.L.forEach((l) => stamp(G, l.a, l.b, GBIG));
    net.T.forEach((l) => stamp(G, l.a, l.b, GBIG));
    const v = luSolve(lu(G), J);
    const iL = net.L.map((l) => GBIG * (at(v, l.a) - at(v, l.b)));
    const iT = net.T.map((l) => GBIG * (at(v, l.a) - at(v, l.b)));
    return { v, iL, iT };
  }

  /* Power dissipated in each tag, and delivered by sources and rails, for a
     given set of node voltages and source values. */
  function powers(net, v, t, out) {
    let delivered = 0;
    net.S.forEach((s) => {
      const vs = s.v(t), i = (vs - v[s.a]) / s.R;
      delivered += vs * i;
      s.parts.forEach((q) => { out[q.tag] = (out[q.tag] || 0) + i * i * q.R; });
    });
    net.R.forEach((r) => {
      const vb = r.b < 0 ? (r.v || 0) : v[r.b], i = (vb - v[r.a]) / r.R;
      if (r.b < 0 && r.v) delivered += r.v * i;
      out[r.tag] = (out[r.tag] || 0) + i * i * r.R;
    });
    return delivered;
  }

  /* Transient solve from the DC point at t = 0. Every line delay is rounded to a
     whole number of steps (reported back as tdUsed). Energies are integrated over
     [w0, w1] (default: the whole record). */
  function transient(net, opt) {
    const dt = opt.dt, N = opt.N, n = net.n;
    // The window, snapped to whole steps so the energy stored at its two ends is
    // read at the same instants the power sums start and stop.
    const k0 = Math.max(0, Math.round((opt.w0 || 0) / dt));
    const k1 = Math.min(N, opt.w1 === undefined ? N : Math.round(opt.w1 / dt));
    const G = zeros(n);
    net.S.forEach((s) => stamp(G, s.a, -1, 1 / s.R));
    net.R.forEach((r) => stamp(G, r.a, r.b, 1 / r.R));
    const Cs = net.C.map((c) => ({ ...c, g: 2 * c.C / dt }));
    const Ls = net.L.map((l) => ({ ...l, g: dt / (2 * l.L * 1000) }));
    Cs.forEach((c) => stamp(G, c.a, c.b, c.g));
    Ls.forEach((l) => stamp(G, l.a, l.b, l.g));
    const Ts = net.T.map((l) => {
      const nd = Math.max(1, Math.round(l.td / dt));
      return { ...l, nd, tdUsed: nd * dt, A: new Float64Array(nd), B: new Float64Array(nd), p: 0 };
    });
    // Each line end is a conductance 1/Z0 to ground behind its history source.
    Ts.forEach((l) => { if (l.a >= 0) G[l.a][l.a] += 1 / l.Z0; if (l.b >= 0) G[l.b][l.b] += 1 / l.Z0; });
    const F = lu(G);

    // Start from DC.
    const dc = dcSolve(net, 0);
    let v = Float64Array.from(dc.v);
    Cs.forEach((c) => { c.vc = at(v, c.a) - at(v, c.b); c.ic = 0; });
    Ls.forEach((l, k) => { l.vl = 0; l.il = dc.iL[k]; });
    Ts.forEach((l, k) => {
      const V = (at(v, l.a) + at(v, l.b)) / 2, I = dc.iT[k];
      l.A.fill((V + l.Z0 * I) / 2);   // leaving a, travelling to b
      l.B.fill((V - l.Z0 * I) / 2);   // leaving b, travelling to a
    });
    const stored = () => {
      let e = 0;
      Cs.forEach((c) => { e += 0.5 * c.C * c.vc * c.vc; });
      Ls.forEach((l) => { e += 0.5 * l.L * 1000 * l.il * l.il; });
      Ts.forEach((l) => { for (let k = 0; k < l.nd; k++) e += (l.A[k] * l.A[k] + l.B[k] * l.B[k]) * dt / l.Z0; });
      return e;
    };

    /* The loop below runs up to 60,000 times for each of six schemes on every
       input event, so it works on flat arrays rather than the netlist objects.
       Ground is index n, a slot that always holds 0, so no element needs a branch
       for it. */
    const g = (i) => (i < 0 ? n : i);
    const tags = [], tagOf = (t) => { let k = tags.indexOf(t); if (k < 0) { tags.push(t); k = tags.length - 1; } return k; };
    const sA = net.S.map((q) => q.a), sR = net.S.map((q) => q.R), sV = net.S.map((q) => q.v);
    const sParts = net.S.map((q) => q.parts.map((pt) => [pt.R, tagOf(pt.tag)]));
    const rA = Int32Array.from(net.R.map((r) => g(r.a))), rB = Int32Array.from(net.R.map((r) => g(r.b)));
    const rG = Float64Array.from(net.R.map((r) => 1 / r.R)), rV = Float64Array.from(net.R.map((r) => (r.b < 0 ? r.v || 0 : 0)));
    const rRail = net.R.map((r) => r.b < 0 && !!r.v), rTag = Int32Array.from(net.R.map((r) => tagOf(r.tag)));
    const vv = new Float64Array(n + 1); vv.set(v);
    const J = new Float64Array(n);
    const Pt = new Float64Array(tags.length + 1), E = new Float64Array(tags.length + 1);
    let delivered = 0, Ein = null, Eout = null;
    const rec = Array.from({ length: n }, () => new Float32Array(N + 1));
    for (let i = 0; i < n; i++) rec[i][0] = v[i];
    if (k0 === 0) Ein = stored();
    const { M: LU, piv } = F;
    for (let k = 1; k <= N; k++) {
      const t = k * dt;
      J.fill(0);
      for (let q = 0; q < sA.length; q++) J[sA[q]] += sV[q](t) / sR[q];
      for (let q = 0; q < rA.length; q++) if (rRail[q]) J[rA[q]] += rV[q] * rG[q];
      for (let q = 0; q < Cs.length; q++) {
        const c = Cs[q]; c.h = c.g * c.vc + c.ic;
        if (c.a >= 0) J[c.a] += c.h; if (c.b >= 0) J[c.b] -= c.h;
      }
      for (let q = 0; q < Ls.length; q++) {
        const l = Ls[q]; l.h = l.il + l.g * l.vl;
        if (l.a >= 0) J[l.a] -= l.h; if (l.b >= 0) J[l.b] += l.h;
      }
      for (let q = 0; q < Ts.length; q++) {
        const l = Ts[q]; l.incA = l.B[l.p]; l.incB = l.A[l.p];
        if (l.a >= 0) J[l.a] += 2 * l.incA / l.Z0;
        if (l.b >= 0) J[l.b] += 2 * l.incB / l.Z0;
      }
      // forward and back substitution against the factor, in place
      for (let a = 0; a < n; a++) { const p = piv[a]; if (p !== a) { const x = J[a]; J[a] = J[p]; J[p] = x; } }
      for (let a = 0; a < n; a++) { const row = LU[a]; let x = J[a]; for (let b = 0; b < a; b++) x -= row[b] * J[b]; J[a] = x; }
      for (let a = n - 1; a >= 0; a--) { const row = LU[a]; let x = J[a]; for (let b = a + 1; b < n; b++) x -= row[b] * J[b]; J[a] = x / row[a]; }
      for (let a = 0; a < n; a++) { vv[a] = J[a]; rec[a][k] = J[a]; }
      for (let q = 0; q < Cs.length; q++) { const c = Cs[q]; c.vc = vv[g(c.a)] - vv[g(c.b)]; c.ic = c.g * c.vc - c.h; }
      for (let q = 0; q < Ls.length; q++) { const l = Ls[q]; l.vl = vv[g(l.a)] - vv[g(l.b)]; l.il = l.g * l.vl + l.h; }
      for (let q = 0; q < Ts.length; q++) {
        const l = Ts[q];
        l.A[l.p] = vv[g(l.a)] - l.incA;
        l.B[l.p] = vv[g(l.b)] - l.incB;
        if (++l.p === l.nd) l.p = 0;
      }
      if (k > k0 && k <= k1) {
        /* The power at the END of the step, times the step. Not a trapezoid: a line
           takes in (out² − in²)·dt/Z0 per step and holds exactly the sum of what is
           in flight, and that bookkeeping is the end-of-step rule. With every
           element counted the same way the account closes to rounding for lines
           and resistors (Tellegen at each step). With a C or an L the companion
           model is trapezoidal while this sum is not, which leaves a residual of
           first order in the step: small, and halving when the step does. */
        Pt.fill(0); let D = 0;
        for (let q = 0; q < sA.length; q++) {
          const vs = sV[q](t), i = (vs - vv[sA[q]]) / sR[q];
          D += vs * i;
          const parts = sParts[q];
          for (let m = 0; m < parts.length; m++) Pt[parts[m][1]] += i * i * parts[m][0];
        }
        for (let q = 0; q < rA.length; q++) {
          const vb = rRail[q] ? rV[q] : vv[rB[q]], i = (vb - vv[rA[q]]) * rG[q];
          if (rRail[q]) D += rV[q] * i;
          Pt[rTag[q]] += i * i / rG[q];
        }
        delivered += dt * D;
        for (let m = 0; m < tags.length; m++) E[m] += dt * Pt[m];
      }
      if (k === k0) Ein = stored();
      if (k === k1) Eout = stored();
    }
    const Eby = {}; tags.forEach((tg, m) => { Eby[tg] = E[m]; });
    const dissipated = Object.values(Eby).reduce((a, b) => a + b, 0);
    return {
      dt, N, rec, E: Eby, delivered, dissipated, stored0: Ein, stored1: Eout, window: (k1 - k0) * dt,
      tdUsed: Ts.map((l) => l.tdUsed),
      balance: delivered - dissipated - (Eout - Ein)
    };
  }

  /* ---------- the bit pattern ---------- */
  const PATTERNS = {
    step: { label: 'One rising edge' },
    clock: { label: 'Clock, 1010…', bits: '101010101010' },
    prbs: { label: 'Random data (PRBS7)' },
    run: { label: 'Data with a long run of ones', bits: '0101011111111111010101' }
  };
  /* PRBS7 (x^7 + x^6 + 1) from the all-ones seed. The panel shows 24 bits of it,
     from bit 19: a stretch with as many ones as zeros and runs of one to four,
     rather than the six zeros the sequence happens to start with. */
  function prbs7(n, from) {
    let s = 0x7f; const out = [];
    for (let i = 0; i < (from || 0) + n; i++) { const b = ((s >> 6) ^ (s >> 5)) & 1; s = ((s << 1) | b) & 0x7f; out.push(b); }
    return out.slice(from || 0).join('');
  }
  PATTERNS.prbs.bits = prbs7(24, 19);

  /* The driver's open-circuit voltage: each transition is a cubic smoothstep
     whose 10-90% time is tr, centred on its bit boundary, bit k starting at
     t0 + k·ui. Before t0 the line sits settled at `idle` (as a fraction of the
     rail), which is the first bit's level for data that starts after an idle bus,
     and the clock's average for a clock that has been running: a clock's DC
     content never changes, so an AC terminator's capacitor sits at it. */
  function source(bits, ui, trSupport, t0, hi, idle) {
    const lv = (i) => (i < 0 ? idle : +bits[Math.min(i, bits.length - 1)]) * hi;
    return (t) => {
      const k = Math.round((t - t0) / ui);
      if (k < 0) return lv(-1);
      if (k >= bits.length) return lv(bits.length - 1);
      return lv(k - 1) + (lv(k) - lv(k - 1)) * K.smoothStep(t - (t0 + k * ui), trSupport);
    };
  }

  /* ---------- the six schemes ---------- */
  const SCHEMES = {
    none: { label: 'Unterminated' },
    series: { label: 'Series at the driver' },
    parallel: { label: 'Parallel to ground' },
    thevenin: { label: 'Thevenin split' },
    ac: { label: 'AC (R + C)' },
    odt: { label: 'On-die, to VDDQ' }
  };
  const ORDER = ['none', 'series', 'parallel', 'thevenin', 'ac', 'odt'];
  /* Each scheme's matched value for a driver of impedance Rs: what the cost
     chart compares when it shows every scheme at once. */
  function matched(scheme, Rs) {
    return scheme === 'series' ? Math.max(0, Z0 - Rs) : Z0;
  }

  /* cfg: scheme, Rt (ohm), Rs (ohm), td (ps, the whole line), tap (bool),
     tapAt (0-1 of the way along), cin (pF), cac (pF), bias (0-1 of VDD, Thevenin),
     place ('pin' | 'stub', parallel, Thevenin and AC only), pattern, rate (Gb/s),
     tr (ps, 10-90%). */
  function build(cfg) {
    const bits = cfg.pattern === 'step' ? '01' : PATTERNS[cfg.pattern].bits;
    const ui = cfg.pattern === 'step' ? Infinity : 1000 / cfg.rate;
    const trSupport = Math.min(cfg.tr / SMOOTH_1090, isFinite(ui) ? 0.9 * ui : Infinity);
    const lead = Math.max(2 * trSupport, 200);
    const nodes = { D: 0 }; let n = 1;
    const net = { n: 0, S: [], R: [], C: [], L: [], T: [] };
    if (cfg.tap) {
      nodes.T = n++; nodes.F = n++;
      net.T.push({ a: nodes.D, b: nodes.T, Z0, td: cfg.td * cfg.tapAt });
      net.T.push({ a: nodes.T, b: nodes.F, Z0, td: cfg.td * (1 - cfg.tapAt) });
      if (cfg.cin > 0) net.C.push({ a: nodes.T, b: -1, C: cfg.cin });
    } else {
      nodes.F = n++;
      net.T.push({ a: nodes.D, b: nodes.F, Z0, td: cfg.td });
    }
    if (cfg.cin > 0) net.C.push({ a: nodes.F, b: -1, C: cfg.cin });

    const series = cfg.scheme === 'series' ? cfg.Rt : 0;
    const t0 = lead;
    let vsrc;
    if (cfg.pattern === 'step') {
      vsrc = (t) => VDD * K.smoothStep(t - t0, trSupport);
    } else {
      vsrc = source(bits, ui, trSupport, t0, VDD, cfg.pattern === 'clock' ? 0.5 : +bits[0]);
    }
    const parts = [{ R: cfg.Rs, tag: 'driver' }];
    if (series > 0) parts.push({ R: series, tag: 'term' });
    net.S.push({ a: nodes.D, R: cfg.Rs + series, v: vsrc, parts });

    let P = nodes.F;
    const board = ['parallel', 'thevenin', 'ac'].includes(cfg.scheme) && cfg.place === 'stub';
    if (board) {
      nodes.S1 = n++; nodes.S2 = n++;
      net.T.push({ a: nodes.F, b: nodes.S1, Z0, td: STUB_MM * PS_PER_MM });
      net.L.push({ a: nodes.S1, b: nodes.S2, L: LVIA });
      P = nodes.S2;
    }
    if (cfg.scheme === 'parallel') net.R.push({ a: P, b: -1, R: cfg.Rt, v: 0, tag: 'term' });
    if (cfg.scheme === 'thevenin') {
      const b = Math.min(0.95, Math.max(0.05, cfg.bias));
      net.R.push({ a: P, b: -1, R: cfg.Rt / b, v: VDD, tag: 'term' });
      net.R.push({ a: P, b: -1, R: cfg.Rt / (1 - b), v: 0, tag: 'term' });
    }
    if (cfg.scheme === 'ac') {
      nodes.M = n++;
      net.R.push({ a: P, b: nodes.M, R: cfg.Rt, tag: 'term' });
      net.C.push({ a: nodes.M, b: -1, C: cfg.cac });
    }
    if (cfg.scheme === 'odt') net.R.push({ a: nodes.F, b: -1, R: cfg.Rt, v: VDD, tag: 'term' });
    net.n = n;

    const span = isFinite(ui) ? bits.length * ui : 0;
    const tail = isFinite(ui) ? 2 * ui : 10 * cfg.td + 2 * trSupport + 1000;
    const tEnd = t0 + span + tail;
    return { net, nodes, bits, ui, t0, tEnd, span, trSupport };
  }

  /* Dwell in the threshold band and ringback, on one receiver's waveform. */
  function quality(rec, dt, lo, hi, swing) {
    let vmax = -Infinity, vmin = Infinity;
    for (let k = 0; k < rec.length; k++) { if (rec[k] > vmax) vmax = rec[k]; if (rec[k] < vmin) vmin = rec[k]; }
    // Longest continuous stay between VIL and VIH.
    let run = 0, longest = 0;
    for (let k = 0; k < rec.length; k++) {
      const x = rec[k];
      if (x > VIL && x < VIH) { run += dt; if (run > longest) longest = run; } else run = 0;
    }
    // Ringback: after reaching a level, coming back into the band and returning
    // to the SAME level without reaching the other one.
    let ringback = 0, last = 0, entered = 0;
    for (let k = 0; k < rec.length; k++) {
      const x = rec[k], s = x >= VIH ? 1 : x <= VIL ? -1 : 0;
      if (s !== 0) { if (s === last && entered) ringback++; last = s; entered = 0; }
      else if (last !== 0) entered = 1;
    }
    return {
      vmax, vmin,
      over: hi > lo ? Math.max(0, vmax - hi) / swing : 0,
      under: hi > lo ? Math.max(0, lo - vmin) / swing : 0,
      band: longest, ringback
    };
  }

  /* Where each edge crosses mid-swing at the far end, against where it was sent.
     A linear termination absorbs every edge the same way, so on a clean net the
     crossings all land at the same offset; when they do not, what moved them is
     the data that came before (an AC terminator's capacitor, or ringing still
     dying away), and the spread is data-dependent jitter. */
  function edgeSpread(x, dt, B, delay, mid) {
    if (!isFinite(B.ui)) return null;
    const offs = [];
    for (let k = SKIP; k < B.bits.length; k++) {
      if (B.bits[k] === B.bits[k - 1]) continue;
      const rising = B.bits[k] === '1', nom = B.t0 + k * B.ui + delay;
      const a = Math.max(1, Math.floor((nom - B.ui / 2) / dt)), z = Math.min(x.length - 1, Math.ceil((nom + B.ui / 2) / dt));
      let hit = null;
      for (let i = a; i <= z; i++) {
        const p = x[i - 1] - mid, q = x[i] - mid;
        if (rising ? (p < 0 && q >= 0) : (p > 0 && q <= 0)) { hit = (i - 1 + p / (p - q)) * dt - nom; break; }
      }
      if (hit === null) return { spread: Infinity, edges: offs.length };
      offs.push(hit);
    }
    if (!offs.length) return null;
    return { spread: Math.max(...offs) - Math.min(...offs), edges: offs.length };
  }

  /* One configuration: the waveforms at the driver pin, the tap and the far end,
     the settled levels, the energy account and the cost per net. */
  function simulate(cfg, maxSteps) {
    const B = build(cfg);
    // Step: resolve the edge with 20 samples and the shortest line section with
    // 8, but never more than 60,000 steps (fewer when only the cost is wanted).
    const shortest = Math.min(...B.net.T.map((l) => l.td));
    let dt = Math.min(B.trSupport / 20, shortest / 8);
    dt = Math.max(dt, B.tEnd / (maxSteps || 60000));
    const N = Math.ceil(B.tEnd / dt);
    // Energy is counted over the pattern from bit SKIP to its last, so the start-up
    // is left out; a single edge is counted over the whole record, so the edge
    // itself is inside.
    const w0 = isFinite(B.ui) ? B.t0 + SKIP * B.ui : 0;
    const w1 = isFinite(B.ui) ? B.t0 + B.span : B.tEnd;
    const tr = transient(B.net, { dt, N, w0, w1 });
    // Settled levels from DC, with the source held low and high.
    const net = B.net, nodeF = B.nodes.F;
    const withSrc = (val) => ({ ...net, S: net.S.map((s) => ({ ...s, v: () => val })) });
    const dLo = dcSolve(withSrc(0), 0), dHi = dcSolve(withSrc(VDD), 0);
    const pLo = {}, pHi = {};
    powers(withSrc(0), dLo.v, 0, pLo); powers(withSrc(VDD), dHi.v, 0, pHi);
    const lo = dLo.v[nodeF], hi = dHi.v[nodeF], swing = Math.max(1e-9, hi - lo);
    // Levels and dwell are judged from the first measured bit on, as power is.
    const from = Math.round(w0 / dt), cut = (x) => x.subarray(from);
    const far = quality(cut(tr.rec[nodeF]), dt, lo, hi, swing);
    const delay = tr.tdUsed.slice(0, cfg.tap ? 2 : 1).reduce((x, y) => x + y, 0);
    far.edges = edgeSpread(tr.rec[nodeF], dt, B, delay, (lo + hi) / 2);
    const tap = B.nodes.T !== undefined ? quality(cut(tr.rec[B.nodes.T]), dt, dLo.v[B.nodes.T], dHi.v[B.nodes.T], swing) : null;
    const T = tr.window;
    const avg = { term: (tr.E.term || 0) / T, driver: (tr.E.driver || 0) / T };
    return {
      cfg, build: B, dt, N, rec: tr.rec, nodes: B.nodes, tr,
      levels: { lo, hi, swing },
      dc: { low: { term: pLo.term || 0, driver: pLo.driver || 0 }, high: { term: pHi.term || 0, driver: pHi.driver || 0 } },
      avg, total: avg.term + avg.driver, far, tap
    };
  }

  /* Every scheme at its matched value under the same driver, line and data,
     except the one the reader has chosen, which keeps the reader's values (and
     can be passed in as `mine` when it has already been solved). The others only
     feed a cost bar and a verdict, so they run on at most 20,000 steps. */
  function compare(cfg, mine) {
    return ORDER.map((s) => {
      const c = s === cfg.scheme ? cfg : { ...cfg, scheme: s, Rt: matched(s, cfg.Rs), place: 'pin', bias: 0.5 };
      const r = s === cfg.scheme ? (mine || simulate(c)) : simulate(c, 20000);
      return { scheme: s, label: SCHEMES[s].label, yours: s === cfg.scheme, r };
    });
  }

  NS.models.termination = {
    VDD, Z0, VIL, VIH, BUS, PS_PER_MM, STUB_MM, LVIA, SMOOTH_1090,
    PATTERNS, SCHEMES, ORDER, matched,
    lu, luSolve, dcSolve, transient, build, simulate, compare, quality, prbs7
  };
})();
