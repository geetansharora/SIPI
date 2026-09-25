/* SIPI — models/coupling-model.js
 * Lumped capacitive and inductive coupling from one aggressor into a victim.
 *
 * The aggressor is a trapezoidal clock: swing V, 10-90% edge tr, 50% duty. It
 * drives either a resistive load (peak current I, so i = v·I/V) or a capacitive
 * load C_L (so i = C_L·dv/dt, a current pulse on every edge).
 *
 *   capacitive   mutual capacitance Cm into a victim node R_v ∥ C_v:
 *                  dy/dt + y/τc = kc·dv/dt,  τc = R_v·(Cm + C_v),  kc = Cm/(Cm + C_v)
 *                a derivative (R_v·Cm·dv/dt) below 1/(2π·τc), the divider kc above it.
 *                It depends on the aggressor's VOLTAGE slew, and on the victim's impedance.
 *   inductive    mutual inductance M into the victim's loop, EMF = M·di/dt, through
 *                one pole at the loop's bandwidth f_L:  dy/dt + y/τL = (M/τL)·di/dt.
 *                It depends on the aggressor's CURRENT slew, not on its voltage and
 *                not on the victim node's impedance.
 *
 * Both are first-order systems driven by a piecewise-constant slope (or, for a
 * capacitive load, by current steps whose derivative is an impulse), so the
 * periodic steady state is solved exactly, segment by segment, with no series and
 * no time step. The spectrum is computed separately from the transfer functions;
 * check-models.js holds the two against each other.
 *
 * No DOM. Requires js/viz-kit.js (K.edgeRamp, K.trapezoidHarmonic).
 */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const NS = (root.SIPI = root.SIPI || { viz: {} });
  const K = NS.kit;
  const C = ((NS.models = NS.models || {}).coupling = {});
  const TAU = 2 * Math.PI;

  /* Fixed for the page, and shown on screen: they scale the answer, not the lesson.
     Cm and M are of the order of two adjacent package pins or closely spaced traces. */
  C.FIXED = { f: 10e6, Cm: 0.5e-12, M: 1e-9, Cv: 5e-12, fL: 1e9 };

  C.params = function (p) {
    const q = Object.assign({}, C.FIXED, p);
    const T = 1 / q.f;
    const E = K.edgeRamp(q.tr, T);
    const S = q.V / E.ramp;                                  // dV/dt on the edge
    const RL = q.load === 'r' ? q.V / q.I : null;             // the resistor that draws I at V
    return Object.assign(q, {
      T, ramp: E.ramp, clamped: E.clamped, tr1090: E.tr1090, S,
      RL,
      dIdt: q.load === 'r' ? q.I / E.ramp : null,             // current slew, resistive load
      Iedge: q.load === 'c' ? q.CL * S : null,                // current during each edge, capacitive load
      tauC: q.Rv * (q.Cm + q.Cv), kc: q.Cm / (q.Cm + q.Cv),
      tauL: 1 / (TAU * q.fL)
    });
  };

  /* |H| of each path at frequency f: volts out per volt of aggressor. */
  C.transfer = function (p, f) {
    const q = p.S ? p : C.params(p);
    const w = TAU * f;
    const cap = q.kc * w * q.tauC / Math.sqrt(1 + (w * q.tauC) * (w * q.tauC));
    const pole = 1 / Math.sqrt(1 + (w * q.tauL) * (w * q.tauL));
    const ind = q.load === 'r' ? (q.M / q.RL) * w * pole : q.M * q.CL * w * w * pole;
    return { cap, ind };
  };

  /* The corners a reader can point at. */
  C.corners = function (p) {
    const q = p.S ? p : C.params(p);
    return { edge: 1 / (Math.PI * q.ramp), cap: 1 / (TAU * q.tauC), loop: q.fL };
  };

  /* Where the two pickups are equal for a resistive load, well below the corners:
     R_v·Cm·dV/dt = M·dI/dt = (M/R_L)·dV/dt  ->  Z* = M / (Cm·R_L). */
  C.crossover = function (p) {
    const q = p.S ? p : C.params(p);
    return q.load === 'r' ? q.M / (q.Cm * q.RL) : null;
  };

  /* Harmonic amplitudes (volts, peak): the aggressor's, and each path's pickup. */
  C.harmonics = function (p, fmax) {
    const q = p.S ? p : C.params(p);
    const out = [], top = fmax || 20e9;
    for (let n = 1; n * q.f <= top; n += 2) {
      const f = n * q.f, a = q.V * K.trapezoidHarmonic(n, q.ramp / q.T);
      const H = C.transfer(q, f);
      out.push({ n, f, agg: a, cap: a * H.cap, ind: a * H.ind });
    }
    return out;
  };

  /* ---------- exact periodic steady state ----------
     One period is four segments: rise (dv/dt = +S), high, fall (−S), low. The
     second half is the first half negated, so y(t + T/2) = −y(t), and the start
     value that satisfies it follows from one affine map over the first half. Each
     segment carries a steady value yInf and an optional jump at its start. */
  function halfPeriod(q, path) {
    if (path === 'cap') {
      return { tau: q.tauC, segs: [{ dur: q.ramp, yInf: q.kc * q.S * q.tauC, jump: 0 },
                                   { dur: q.T / 2 - q.ramp, yInf: 0, jump: 0 }] };
    }
    if (q.load === 'r') {                                       // EMF = M·I/ramp on the edge
      return { tau: q.tauL, segs: [{ dur: q.ramp, yInf: q.M * q.dIdt, jump: 0 },
                                   { dur: q.T / 2 - q.ramp, yInf: 0, jump: 0 }] };
    }
    /* Capacitive load: the current steps by ±C_L·S at each end of the edge, so its
       derivative is an impulse of area C_L·S, and through the loop's pole the EMF
       M·di/dt jumps by M·C_L·S/τL, then decays. */
    const J = q.M * q.CL * q.S / q.tauL;
    return { tau: q.tauL, segs: [{ dur: q.ramp, yInf: 0, jump: J },
                                 { dur: q.T / 2 - q.ramp, yInf: 0, jump: -J }] };
  }
  function advance(y, seg, tau, sign, dt) {
    const yi = sign * seg.yInf;
    return yi + (y - yi) * Math.exp(-dt / tau);
  }
  function runHalf(y0, H, sign) {
    let y = y0;
    for (const s of H.segs) { y += sign * s.jump; y = advance(y, s, H.tau, sign, s.dur); }
    return y;
  }
  function steadyStart(H) {
    const b = runHalf(0, H, 1), a = runHalf(1, H, 1) - b;      // y(T/2) = a·y0 + b
    return -b / (1 + a);                                        // antiperiodic: y(T/2) = −y0
  }

  /* Samples over `periods` periods, n per period, plus the exact extremes, which
     sit at segment boundaries (every segment is a monotone exponential). */
  C.waveform = function (p, n, periods) {
    const q = p.S ? p : C.params(p);
    const N = n || 800, P = periods || 2;
    const res = {};
    ['cap', 'ind'].forEach((path) => {
      const H = halfPeriod(q, path);
      const y0 = steadyStart(H);
      const bounds = [];                                        // [t, value] at every boundary, both sides of a jump
      const segs = [];
      let t = 0, y = y0;
      for (let k = 0; k < 2 * P; k++) {
        const sign = k % 2 === 0 ? 1 : -1;
        for (const s of H.segs) {
          bounds.push([t, y]);
          y += sign * s.jump;
          bounds.push([t, y]);
          segs.push({ t0: t, y0: y, seg: s, sign, yInf: sign * s.yInf, dur: s.dur, tau: H.tau });
          y = advance(y, s, H.tau, sign, s.dur);
          t += s.dur;
        }
      }
      bounds.push([t, y]);
      const ts = new Float64Array(N * P + 1), ys = new Float64Array(N * P + 1);
      let si = 0;
      for (let i = 0; i <= N * P; i++) {
        const tt = i * q.T / N;
        while (si < segs.length - 1 && tt >= segs[si + 1].t0) si++;
        const g = segs[si];
        ts[i] = tt;
        ys[i] = advance(g.y0, g.seg, H.tau, g.sign, tt - g.t0);
      }
      let peak = 0;
      bounds.forEach((b) => { peak = Math.max(peak, Math.abs(b[1])); });
      /* segs: every piece is y = yInf + (y0 − yInf)·exp(−(t − t0)/tau) on [t0, t0 + dur],
         so a check can integrate the waveform exactly instead of sampling it. */
      res[path] = { t: ts, y: ys, peak, bounds, start: y0, segs };
    });
    return res;
  };

  /* The aggressor itself over the same window, for shading and labels. */
  C.aggressorAt = function (p, t) {
    const q = p.S ? p : C.params(p);
    const ph = ((t % q.T) + q.T) % q.T;
    let v;
    if (ph < q.ramp) v = q.V * ph / q.ramp;
    else if (ph < q.T / 2) v = q.V;
    else if (ph < q.T / 2 + q.ramp) v = q.V * (1 - (ph - q.T / 2) / q.ramp);
    else v = 0;
    const i = q.load === 'r' ? q.I * v / q.V
      : (ph < q.ramp ? q.CL * q.S : ph >= q.T / 2 && ph < q.T / 2 + q.ramp ? -q.CL * q.S : 0);
    return { v, i };
  };

  /* Peak pickups, and how each changes for an edge twice as fast. */
  C.run = function (p) {
    const q = C.params(p);
    const W = C.waveform(q, 400, 1);
    const fast = C.waveform(C.params(Object.assign({}, p, { tr: p.tr / 2 })), 400, 1);
    const db = (a, b) => (a > 0 && b > 0 ? 20 * Math.log10(a / b) : 0);
    return {
      q, capPeak: W.cap.peak, indPeak: W.ind.peak,
      dominant: W.cap.peak >= W.ind.peak ? 'capacitive' : 'inductive',
      crossover: C.crossover(q), corners: C.corners(q),
      faster: { cap: db(fast.cap.peak, W.cap.peak), ind: db(fast.ind.peak, W.ind.peak) }
    };
  };
})();
