/* SIPI — models/ddr5-model.js
 * A DDR5 data net, from the controller to one or two DIMMs, solved in time.
 *
 * The net is a tree of lossless transmission-line sections joined at nodes. A node
 * may carry a shunt capacitance (a die pad), a termination to AC ground (an ODT
 * leg, which in POD signalling returns to VDDQ, an AC ground) and a Thevenin source
 * (the driver). It is solved by the method of characteristics (Bergeron): every
 * section is a pair of delay lines, and at each 1 ps step every node sees its
 * sections as 2a/Z sources behind Z, so the node voltage is one division and the
 * waves it launches are V - a. Capacitors use the trapezoidal companion model.
 * This is exact for lossless lines with integer-picosecond delays, and it lets a
 * reader watch each wave travel, split at a slot and come back from a stub.
 *
 *   controller die --pkg-- ball --mainboard-- slot 1 --+-- connector -- DIMM trace -- pkg -- DRAM die
 *                                                      |
 *                                                      +-- (slot pitch) -- slot 2 -- connector -- ...
 *
 * From the step response at the receiver the model builds the single-bit
 * (pulse) response, a PRBS eye, the worst-case eye by peak distortion, the DRAM's
 * 4-tap DFE with the tap ranges a public JESD79-5B data sheet gives, a training
 * shmoo, and a sweep of both terminations.
 *
 * A second, smaller model is the fly-by: the CA/CK net from the RCD along five
 * DRAMs, each a lumped capacitance, which is what makes write leveling necessary.
 *
 * No DOM. Requires js/viz-kit.js (rng and gaussians only).
 */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const NS = (root.SIPI = root.SIPI || { viz: {} });
  const D = ((NS.models = NS.models || {}).ddr5 = {});

  /* ---------- what the panel holds fixed ---------- */
  const VDDQ = 1.1;                    // V, DDR5 nominal (ledger)
  const PS_PER_MM = 6.7;               // 170 ps/in, the site's stripline default
  const Z_BOARD = 40, Z_DIMM = 40;     // model choice, not a specification
  const CONN = { z: 60, ps: 25 };      // a DIMM connector, as a short high-impedance section
  const PKG_HOST = { z: 45, ps: 40 }, PKG_DRAM = { z: 45, ps: 30 };
  const C_HOST = 1.0, C_DRAM = 0.8;    // pF; 0.8 pF is the data sheet's CIO max at 6000-6400
  const DIMM_MM = 20;                  // edge finger to DRAM ball
  const SPS = 32;                      // samples per UI for eyes and pulses
  const RAMP_PER_1090 = 1 / 0.5903;    // a raised cosine's 10-90% is 0.5903 of its full ramp
  D.VDDQ = VDDQ; D.PS_PER_MM = PS_PER_MM; D.SPS = SPS; D.Z_BOARD = Z_BOARD;

  D.RATES = [3200, 3600, 4000, 4400, 4800, 5200, 5600, 6000, 6400, 6800, 7200, 7600, 8000, 8400, 8800];
  D.RTT = [Infinity, 240, 120, 80, 60, 48, 40, 34];             // RZQ/n, RZQ = 240 ohm, and off
  D.RON = [34, 40, 48];
  D.rttLabel = (r) => (r === Infinity ? 'off' : r + ' Ω');

  /* DRAM DFE tap ranges, 1X multiplier, 3200-6400 (Micron DDR5 core data sheet,
     JESD79-5B compliant, table 234), and the stressed-eye sum limit on taps 2-4.
     A tap is the correction, so it has the opposite sign to the post-cursor. */
  D.TAP_RANGE = [[-200, 50], [-75, 75], [-60, 60], [-45, 45]];
  D.TAP_STEP = 5;                      // mV
  D.TAP_SUM_234 = 60;                  // mV, |t2| + |t3| + |t4| < 60
  /* Rx stressed eye at the slicer, golden reference channel (same data sheet,
     tables 321-322): [eye height mV, eye width UI]. TBD above 6400 in that revision. */
  D.STRESSED = { 3200: [95, 0.25], 3600: [85, 0.25], 4000: [80, 0.25], 4400: [75, 0.25], 4800: [70, 0.25],
    5200: [65, 0.235], 5600: [60, 0.235], 6000: [57.5, 0.23], 6400: [57.5, 0.23] };
  D.VREF_STEP = 0.005;                 // of VDDQ, VrefDQ step
  D.VREF_RANGE = [0.35, 0.975];        // of VDDQ

  D.defaults = {
    rate: 4800, pop: 'two', target: 'near', dir: 'write',
    mb: 100, slot: 10, ron: 34, rttT: 240, rttO: 40, dfe: true
  };

  D.uiPs = (rate) => 1e6 / rate;
  D.edgePs = (rate) => Math.min(70, Math.max(30, 0.3 * D.uiPs(rate)));   // driver 10-90%, model choice

  /* ---------- the net ---------- */
  D.network = function (p) {
    const nodes = [], lines = [];
    const node = (name, o) => { nodes.push(Object.assign({ name, R: Infinity, C: 0, ports: [] }, o || {})); return nodes.length - 1; };
    const line = (a, b, z, ps, label, kind) => {
      lines.push({ a, b, z, d: Math.max(1, Math.round(ps)), label, kind });
      const i = lines.length - 1;
      nodes[a].ports.push([i, 0]); nodes[b].ports.push([i, 1]);
      return i;
    };
    const H = node('controller', { C: C_HOST, role: 'host' });
    const Hb = node('controller ball');
    line(H, Hb, PKG_HOST.z, PKG_HOST.ps, 'package', 'pkg');
    const S1 = node('slot 1', { role: 'slot' });
    line(Hb, S1, Z_BOARD, p.mb * PS_PER_MM, 'mainboard', 'board');
    const dimm = (slot, tag) => {
      const e = node(tag + ' edge');
      line(slot, e, CONN.z, CONN.ps, 'connector', 'conn');
      const b = node(tag + ' DRAM ball');
      line(e, b, Z_DIMM, DIMM_MM * PS_PER_MM, 'DIMM trace', 'dimm');
      const d = node(tag + ' DRAM', { C: C_DRAM, role: 'dram' });
      line(b, d, PKG_DRAM.z, PKG_DRAM.ps, 'package', 'pkg');
      return d;
    };
    const empty = (slot, tag) => {
      const e = node(tag + ', empty');
      line(slot, e, CONN.z, CONN.ps, 'empty connector', 'conn');
      return e;
    };
    let near = null, far = null, S2 = null;
    if (p.pop === 'one') near = dimm(S1, 'DIMM 1');
    else {
      S2 = node('slot 2', { role: 'slot' });
      if (p.pop === 'far') empty(S1, 'slot 1');
      else near = dimm(S1, 'DIMM 1');
      line(S1, S2, Z_BOARD, p.slot * PS_PER_MM, 'slot to slot', 'board');
      if (p.pop === 'near') empty(S2, 'slot 2');
      else far = dimm(S2, 'DIMM 2');
    }
    /* who drives, who listens, who terminates */
    const tgt = p.pop === 'two' ? (p.target === 'far' ? far : near) : (near !== null ? near : far);
    const other = p.pop === 'two' ? (tgt === near ? far : near) : null;
    let src, rx;
    if (p.dir === 'read') { src = tgt; rx = H; nodes[H].R = p.rttT; }
    else { src = H; rx = tgt; nodes[tgt].R = p.rttT; }
    if (other !== null) nodes[other].R = p.rttO;
    nodes[src].src = true; nodes[src].Rs = p.ron;
    return { nodes, lines, src, rx, H, S1, S2, near, far, tgt, other };
  };

  /* Path from one node to another through the tree, as [lineIndex, direction]
     where direction 0 means travelling a -> b. */
  D.path = function (net, from, to) {
    const prev = new Map([[from, null]]), q = [from];
    while (q.length) {
      const n = q.shift();
      if (n === to) break;
      for (const [li, end] of net.nodes[n].ports) {
        const L = net.lines[li], m = end === 0 ? L.b : L.a;
        if (!prev.has(m)) { prev.set(m, [n, li, end]); q.push(m); }
      }
    }
    const out = [];
    for (let n = to; prev.get(n); n = prev.get(n)[0]) { const [, li, end] = prev.get(n); out.unshift([li, end]); }
    return out;
  };

  /* Every branch hanging off the path, each followed outward to its end. A branch
     here is a chain (no further forks), which holds for every net this builds. */
  D.branches = function (net, path) {
    const onPath = new Set(path.map(([li]) => li));
    const pathNodes = new Set([net.src]);
    path.forEach(([li, dir]) => pathNodes.add(dir === 0 ? net.lines[li].b : net.lines[li].a));
    const out = [];
    for (const n of pathNodes) {
      for (const [li, end] of net.nodes[n].ports) {
        if (onPath.has(li)) continue;
        const chain = [];
        let cur = n, l = li, e = end;
        for (;;) {
          chain.push([l, e]);
          const L = net.lines[l]; cur = e === 0 ? L.b : L.a;
          const next = net.nodes[cur].ports.filter(([x]) => x !== l);
          if (next.length !== 1) break;
          [l, e] = next[0];
        }
        out.push({ from: n, chain, end: cur });
      }
    }
    return out;
  };

  /* ---------- the solver ----------
     src(t) is the driver's open-circuit voltage in V at time t ps. Returns node
     voltages, and the waves launched into each line from each end (for drawing).
     opts.keep: array of node indices to record (default all). */
  D.solve = function (net, nT, src, opts) {
    opts = opts || {};
    const N = net.nodes, L = net.lines, nN = N.length, nL = L.length;
    const fromA = L.map(() => new Float64Array(nT)), fromB = L.map(() => new Float64Array(nT));
    const keep = opts.keep || N.map((_, i) => i);
    const V = new Array(nN).fill(null);
    keep.forEach((k) => { V[k] = new Float64Array(nT); });
    const G = new Float64Array(nN), Gc = new Float64Array(nN), J = new Float64Array(nN);
    N.forEach((n, k) => {
      Gc[k] = 2 * n.C;                                   // pF / 1 ps = S
      let g = Gc[k] + (isFinite(n.R) ? 1 / n.R : 0) + (n.src ? 1 / n.Rs : 0);
      n.ports.forEach(([li]) => { g += 1 / L[li].z; });
      G[k] = g;
    });
    const inc = new Float64Array(8);
    for (let t = 0; t < nT; t++) {
      const vs = src(t);
      for (let k = 0; k < nN; k++) {
        const n = N[k];
        let num = J[k] + (n.src ? vs / n.Rs : 0);
        const ports = n.ports;
        for (let j = 0; j < ports.length; j++) {
          const li = ports[j][0], end = ports[j][1], d = L[li].d;
          const a = t >= d ? (end === 0 ? fromB[li][t - d] : fromA[li][t - d]) : 0;
          inc[j] = a; num += 2 * a / L[li].z;
        }
        const v = num / G[k];
        if (V[k]) V[k][t] = v;
        for (let j = 0; j < ports.length; j++) {
          const li = ports[j][0];
          if (ports[j][1] === 0) fromA[li][t] = v - inc[j]; else fromB[li][t] = v - inc[j];
        }
        if (Gc[k]) { const ic = Gc[k] * v - J[k]; J[k] = Gc[k] * v + ic; }
      }
    }
    return { V, fromA, fromB, nT };
  };

  /* Voltage on a line at distance x ps from end a, at time t: the wave launched
     from a x ps ago plus the wave launched from b (d - x) ps ago. */
  D.lineV = function (sol, net, li, x, t) {
    const d = net.lines[li].d;
    const ta = Math.round(t - x), tb = Math.round(t - (d - x));
    return (ta >= 0 && ta < sol.nT ? sol.fromA[li][ta] : 0) + (tb >= 0 && tb < sol.nT ? sol.fromB[li][tb] : 0);
  };

  D.edge = function (amp, tr1090) {
    const ramp = tr1090 * RAMP_PER_1090;
    return (t) => (t <= 0 ? 0 : t >= ramp ? amp : amp * 0.5 * (1 - Math.cos(Math.PI * t / ramp)));
  };

  /* The DC level the bus settles to with the driver low: every termination to
     VDDQ in parallel against the driver to ground. */
  D.swing = function (net) {
    let g = 0;
    net.nodes.forEach((n) => { if (isFinite(n.R)) g += 1 / n.R; });
    if (g === 0) return VDDQ;
    const rtt = 1 / g, ron = net.nodes[net.src].Rs;
    return VDDQ * rtt / (ron + rtt);
  };

  function interp(a, t) {
    if (t <= 0) return a[0] * (t >= 0 ? 1 : 0);
    const i = Math.floor(t);
    if (i >= a.length - 1) return a[a.length - 1];
    return a[i] + (a[i + 1] - a[i]) * (t - i);
  }

  /* PRBS-11, x^11 + x^9 + 1 */
  D.prbs11 = function () {
    let s = 0x7ff; const out = new Uint8Array(2047);
    for (let i = 0; i < 2047; i++) {
      const b = ((s >> 10) ^ (s >> 8)) & 1;
      out[i] = s & 1; s = ((s << 1) | b) & 0x7ff;
    }
    return out;
  };

  /* ---------- DFE ---------- */
  D.dfeTaps = function (hMv) {          // h1..h4 post-cursors in mV -> taps in mV
    const t = [0, 1, 2, 3].map((k) => {
      const want = -(hMv[k] || 0), [lo, hi] = D.TAP_RANGE[k];
      return Math.max(lo, Math.min(hi, Math.round(want / D.TAP_STEP) * D.TAP_STEP));
    });
    const s = Math.abs(t[1]) + Math.abs(t[2]) + Math.abs(t[3]);
    if (s >= D.TAP_SUM_234) {           // scale 2-4 back inside the sum limit, on the step grid
      const f = (D.TAP_SUM_234 - D.TAP_STEP) / s;
      for (let k = 1; k < 4; k++) t[k] = Math.sign(t[k]) * Math.floor(Math.abs(t[k]) * f / D.TAP_STEP + 1e-9) * D.TAP_STEP;
    }
    return t;
  };

  /* Peak-distortion eye at pulse sample index i: the worst '1' and worst '0' over
     every bit pattern, with DFE taps (mV, correction sign) on the first four
     post-cursors. P in volts, from a '0' baseline. */
  D.pda = function (P, i, taps) {
    const sps = SPS;
    let main = P[i], lo1 = 0, hi0 = 0;
    for (let k = -Math.floor(i / sps); i + k * sps < P.length; k++) {
      if (k === 0) continue;
      let h = P[i + k * sps];
      if (taps && k >= 1 && k <= 4) h += taps[k - 1] / 1000;
      if (h < 0) lo1 += h; else hi0 += h;
    }
    return { one: main + lo1, zero: hi0, height: main + lo1 - hi0 };
  };

  /* ---------- one configuration, end to end ---------- */
  D.run = function (p, opts) {
    opts = opts || {};
    const net = D.network(p);
    const ui = D.uiPs(p.rate), tr = D.edgePs(p.rate);
    const pth = D.path(net, net.src, net.rx);
    const flight = pth.reduce((s, [li]) => s + net.lines[li].d, 0);
    let total = 0; net.lines.forEach((l) => { total += l.d; });
    const nT = Math.min(26000, Math.ceil(flight + 4 * total + 40 * ui + 3 * tr));
    const keep = opts.full ? undefined : [net.rx];
    const sol = D.solve(net, nT, D.edge(VDDQ, tr), { keep });
    const s = sol.V[net.rx];
    const swing = D.swing(net), vLow = VDDQ - swing;

    /* the single-bit response, sampled SPS times a UI from t = 0 */
    const np = Math.floor((nT - ui) / (ui / SPS));
    const P = new Float64Array(np);
    for (let j = 0; j < np; j++) { const t = j * ui / SPS; P[j] = interp(s, t) - interp(s, t - ui); }
    let c = 0; for (let j = 1; j < np; j++) if (P[j] > P[c]) c = j;

    /* train: the phase within a UI either side of the peak that opens the eye most,
       with the DFE taps it would set there */
    const useDfe = p.dfe && p.dir === 'write';
    const tapsAt = (i) => (useDfe ? D.dfeTaps([1, 2, 3, 4].map((k) => (i + k * SPS < np ? P[i + k * SPS] * 1000 : 0))) : null);
    let best = c, bestH = -Infinity;
    for (let i = Math.max(0, c - SPS); i <= Math.min(np - 1, c + SPS); i++) {
      const h = D.pda(P, i, tapsAt(i)).height;
      if (h > bestH) { bestH = h; best = i; }
    }
    const taps = tapsAt(best);
    const wc = D.pda(P, best, taps);
    /* worst-case width: the run of phases around the trained one that stay open
       with the taps held where training put them */
    let a = best, z = best;
    if (wc.height > 0) {
      while (a > 0 && D.pda(P, a - 1, taps).height > 0) a--;
      while (z < np - 1 && D.pda(P, z + 1, taps).height > 0) z++;
    }
    const wcWidth = wc.height > 0 ? (z - a + 1) * ui / SPS : 0;
    const post = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((k) => (best + k * SPS < np ? P[best + k * SPS] : 0));
    let beyond = 0;
    for (let k = 5; best + k * SPS < np; k++) beyond += Math.abs(P[best + k * SPS]);

    const out = {
      p, net, ui, tr, nT, flight, swing, vLow, P, cursor: best, peak: c, taps, useDfe,
      main: P[best], post, beyondMv: beyond * 1000,
      wc: { height: wc.height, width: wcWidth, one: vLow + wc.one, zero: vLow + wc.zero },
      step: s
    };
    if (opts.full) { out.sol = sol; out.path = pth; out.branches = D.branches(net, pth); }
    if (opts.eye !== false) D.eye(out);
    return out;
  };

  /* ---------- the PRBS eye, with the DFE in the loop ---------- */
  D.eye = function (r) {
    const bits = D.prbs11(), nb = bits.length, P = r.P, sps = SPS;
    /* pulse aligned so that index 0 of each bit is its sampling instant */
    const pre = Math.ceil(r.cursor / sps) + 1, span = Math.ceil((P.length - r.cursor) / sps);
    const lead = 64;                                     // bits before the analysed window, to fill the ISI history
    const n = nb + lead, y = new Float64Array(n * sps);
    for (let b = 0; b < n; b++) {
      if (!bits[(b - lead + nb) % nb]) continue;
      for (let k = -pre; k < span; k++) {
        const j0 = r.cursor + k * sps;
        for (let s = 0; s < sps; s++) {
          const pj = j0 + s - sps / 2, yi = (b + k) * sps + s;
          if (pj >= 0 && pj < P.length && yi >= 0 && yi < y.length) y[yi] += P[pj];
        }
      }
    }
    /* y[b*sps + s] is bit b's waveform at s - sps/2 samples from its instant */
    const bitAt = (b) => bits[(b - lead + nb) % nb];
    if (r.taps) {
      for (let b = 0; b < n; b++) {
        let corr = 0;
        for (let k = 1; k <= 4; k++) if (b - k >= 0 && bitAt(b - k)) corr += r.taps[k - 1] / 1000;
        for (let s = 0; s < sps; s++) y[b * sps + s] += corr;
      }
    }
    for (let i = 0; i < y.length; i++) y[i] += r.vLow;
    r.eyeWave = { y, bits: Array.from({ length: n }, (_, b) => bitAt(b)), lead, n, sps };
    return r;
  };

  /* ---------- what training sees ----------
     For every DQS delay step (one sample, UI/32) and every VrefDQ step (0.5% of
     VDDQ), does a PRBS-11 burst pass with no error? Random noise and jitter, seeded,
     make the edges ragged as they are on real hardware. The centre is chosen the
     way a simple trainer would: the Vref with the widest passing run, then the
     middle of that run. */
  D.shmoo = function (r, opts) {
    opts = opts || {};
    const sigV = opts.sigmaMv === undefined ? 0.005 : opts.sigmaMv / 1000;
    const sigT = opts.sigmaPs === undefined ? 2 : opts.sigmaPs;
    const W = r.eyeWave, sps = SPS, y = W.y, ui = r.ui;
    const phases = [];
    for (let s = -sps; s <= sps; s++) phases.push(s);           // two UI, centred on the trained instant
    const g = NS.kit && NS.kit.gaussians ? NS.kit.gaussians(2 * W.n * 4 + 8, 0xdd5) : null;
    const cols = phases.map((s, ci) => {
      let lo1 = Infinity, hi0 = -Infinity;
      for (let b = W.lead; b < W.n; b++) {
        const gi = 2 * ((b * 7 + ci * 13) % (W.n * 4));
        const jt = g ? g[gi] * sigT / (ui / sps) : 0, nv = g ? g[gi + 1] * sigV : 0;
        const pos = b * sps + sps / 2 + s + jt;
        const i0 = Math.floor(pos);
        if (i0 < 0 || i0 + 1 >= y.length) continue;
        const v = y[i0] + (y[i0 + 1] - y[i0]) * (pos - i0) + nv;
        if (W.bits[b]) { if (v < lo1) lo1 = v; } else if (v > hi0) hi0 = v;
      }
      return { s, lo1, hi0 };
    });
    const step = D.VREF_STEP * VDDQ;
    const vMin = Math.max(D.VREF_RANGE[0] * VDDQ, r.vLow - 0.04), vMax = Math.min(D.VREF_RANGE[1] * VDDQ, VDDQ);
    const rows = [];
    for (let k = Math.ceil(vMin / step); k * step <= vMax + 1e-12; k++) rows.push(k * step);
    const pass = rows.map((v) => cols.map((c) => v > c.hi0 && v < c.lo1));
    let bestRow = -1, bestW = 0, bestA = 0;
    pass.forEach((row, ri) => {
      let run = 0;
      row.forEach((ok, ci) => {
        run = ok ? run + 1 : 0;
        if (run > bestW || (run === bestW && run > 0 && Math.abs(ri - rows.length / 2) < Math.abs(bestRow - rows.length / 2))) {
          bestW = run; bestRow = ri; bestA = ci - run + 1;
        }
      });
    });
    const centre = bestRow < 0 ? null : {
      s: phases[bestA + Math.floor((bestW - 1) / 2)], vref: rows[bestRow],
      widthPs: bestW * ui / sps
    };
    if (centre) {                        // the passing Vref range at that delay
      const ci = phases.indexOf(centre.s);
      let n = 0; rows.forEach((_, ri) => { if (pass[ri][ci]) n++; });
      centre.heightMv = n * step * 1000;
    }
    return { phases, rows, pass, cols, centre, step, sigV, sigT };
  };

  /* ---------- both terminations at once ---------- */
  D.matrix = function (p) {
    const list = D.RTT, others = p.pop === 'two' ? list : [p.rttO];
    return list.map((rT) => others.map((rO) => {
      const r = D.run(Object.assign({}, p, { rttT: rT, rttO: rO }), { eye: false });
      return { rttT: rT, rttO: rO, height: r.wc.height * 1000, width: r.wc.width };
    }));
  };

  /* ---------- the fly-by ----------
     CA/CK from the RCD along five DRAMs, each a lumped input capacitance, ending
     in the last DRAM's CA ODT. Returns each DRAM's waveform and 50% arrival time,
     and the loaded-line figures the arrivals should approach. */
  D.FLY = { n: 5, leadMm: 12, z0: 50, rcdRon: 25 };
  D.flybyDefaults = { rate: 6400, pitch: 12, cLoad: 1.0, odt: 40, level: true };
  D.loaded = function (z0, psPerMm, pitchMm, cLoad) {
    const cLine = psPerMm * pitchMm / z0;               // pF per pitch: t/Z = sqrt(LC) / sqrt(L/C) = C
    const k = Math.sqrt(1 + cLoad / cLine);
    return { z: z0 / k, psPerMm: psPerMm * k, k, cLine };
  };
  D.flyby = function (q) {
    const F = D.FLY, nodes = [], lines = [];
    const node = (o) => { nodes.push(Object.assign({ R: Infinity, C: 0, ports: [] }, o)); return nodes.length - 1; };
    const line = (a, b, ps) => { lines.push({ a, b, z: F.z0, d: Math.max(1, Math.round(ps)) }); const i = lines.length - 1; nodes[a].ports.push([i, 0]); nodes[b].ports.push([i, 1]); };
    const rcd = node({ src: true, Rs: F.rcdRon });
    const drams = [];
    let prev = rcd;
    for (let i = 0; i < F.n; i++) {
      const d = node({ C: q.cLoad });
      line(prev, d, (i === 0 ? F.leadMm : q.pitch) * PS_PER_MM);
      drams.push(d); prev = d;
    }
    nodes[prev].R = q.odt;
    const net = { nodes, lines };
    const tr = 60, flight = (F.leadMm + (F.n - 1) * q.pitch) * PS_PER_MM * 2.2;
    const nT = Math.ceil(flight * 4 + 800);
    const sol = D.solve(net, nT, D.edge(1, tr));
    const final = isFinite(q.odt) ? q.odt / (F.rcdRon + q.odt) : 1;
    const arr = drams.map((k) => {
      const v = sol.V[k];
      let t = 0; while (t < nT - 1 && v[t] < 0.5 * final) t++;
      const t0 = t > 0 ? t - 1 + (0.5 * final - v[t - 1]) / ((v[t] - v[t - 1]) || 1) : 0;
      return { t: t0, wave: v };
    });
    const ld = D.loaded(F.z0, PS_PER_MM, q.pitch, q.cLoad);
    const tck = 2 * D.uiPs(q.rate);
    return { arr, nT, final, tr, loaded: ld, tck, skew: arr[F.n - 1].t - arr[0].t };
  };
})();
