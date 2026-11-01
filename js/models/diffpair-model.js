/* SI & PI — models/diffpair-model.js
 * Where the common mode comes from: two legs of a differential pair that are not
 * quite the same, and what the difference turns into.
 *
 * Each leg is a gain, a delay and a first-order edge (one pole, time constant
 * tau = t_r / 2.197 for a 10-90% rise time t_r), so everything is closed form:
 *
 *   leg k, in frequency   H_k(f) = g_k · e^(−j2πf d_k) / (1 + j2πf τ_k)
 *   leg k, in time        a step of size Δ at t0 gives Δ·(1 − e^(−(t − t0 − d_k)/τ_k))
 *   mixed mode            S_DD21 = (H_P + H_N)/2,  S_CD21 = (H_P − H_N)/2
 *                         V_diff = V_P − V_N,      V_cm = (V_P + V_N)/2
 *
 * The four ways the legs can differ are the four the page names: a length
 * mismatch, a glass-weave velocity difference over the route, a drive-strength
 * imbalance, and one leg's edge slower than the other's. The pair is uncoupled
 * and lossless apart from the edge, which is the cleanest setting in which
 * symmetry, and only symmetry, decides the common mode.
 *
 * Units: ps, GHz, V, inches.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  NS.models = NS.models || {};

  const C_IN_PER_PS = 299792458 / 0.0254 * 1e-12;   // speed of light, inches per ps
  const DK = 4.0;                                    // the slower leg sees Dk + ΔDk
  const SWING = 0.4;                                 // V, each leg's step, so ±0.2 V a leg
  const SPB = 32;                                    // samples per bit
  const TAU_PER_TR = 1 / Math.log(9);                // one pole: t_r(10-90%) = τ·ln 9

  /* PRBS7 (x^7 + x^6 + 1), one full period: every 7-bit pattern but all-zeros. */
  function prbs7() {
    let s = 0x7f; const out = [];
    for (let i = 0; i < 127; i++) { const b = ((s >> 6) ^ (s >> 5)) & 1; s = ((s << 1) | b) & 0x7f; out.push(b); }
    return out;
  }
  const BITS = prbs7();

  /* Skew from glass weave: the same routed length at two velocities. */
  function weaveSkew(lenIn, dDk, dk) {
    const d = dk === undefined ? DK : dk;
    return lenIn * (Math.sqrt(d + dDk) - Math.sqrt(d)) / C_IN_PER_PS;
  }

  /* The two legs from the reader's settings. P is driven with the data and N with
     its complement; the skew delays P by half and advances N by half, so the pair's
     mean delay never moves and only the asymmetry shows. */
  function legs(cfg) {
    const skew = (cfg.skew || 0) + weaveSkew(cfg.len || 0, cfg.dDk || 0);
    const tau = cfg.tr * TAU_PER_TR, a = (cfg.imb || 0) / 100, m = (cfg.slow || 0) / 100;
    return {
      skew,
      P: { g: 1 + a / 2, d: skew / 2, tau, sign: 1 },
      N: { g: 1 - a / 2, d: -skew / 2, tau: tau * (1 + m), sign: -1 }
    };
  }

  function H(leg, fGHz) {
    const w = 2 * Math.PI * fGHz * 1e-3;            // rad per ps
    const re0 = 1, im0 = w * leg.tau;               // 1 + jωτ
    const den = re0 * re0 + im0 * im0;
    const pr = leg.g * Math.cos(-w * leg.d), pi = leg.g * Math.sin(-w * leg.d);
    return [(pr * re0 + pi * im0) / den, (pi * re0 - pr * im0) / den];
  }

  /* Mixed-mode transfer of the pair, standard normalisation. */
  function mixed(L, fGHz) {
    const p = H(L.P, fGHz), n = H(L.N, fGHz);
    const dd = [(p[0] + n[0]) / 2, (p[1] + n[1]) / 2], cd = [(p[0] - n[0]) / 2, (p[1] - n[1]) / 2];
    return { sdd: Math.hypot(dd[0], dd[1]), scd: Math.hypot(cd[0], cd[1]) };
  }

  /* One leg's voltage at time t (ps) for a periodic bit pattern: every transition,
     in this period and enough earlier ones for the slowest edge to have settled. */
  function legWave(leg, bits, ui, ts) {
    const n = bits.length, T = n * ui, out = new Float64Array(ts.length);
    const lv = (b) => leg.sign * leg.g * SWING * (b - 0.5);
    const trans = [];
    for (let i = 0; i < n; i++) {
      const prev = bits[(i - 1 + n) % n];
      if (bits[i] !== prev) trans.push({ t: i * ui, step: lv(bits[i]) - lv(prev) });
    }
    const back = Math.ceil((12 * leg.tau + Math.abs(leg.d)) / T) + 1;
    for (let k = 0; k < ts.length; k++) {
      const t = ts[k];
      // the level that would hold had no edge happened since long ago: the pattern's
      // value just before the earliest period counted, then every edge since. A leg
      // that runs early (d < 0) meets the next period's first edges before this one
      // ends, so the count runs one period on, and the wave closes on itself.
      let v = lv(bits[n - 1]);
      for (let p = -back; p <= 1; p++) {
        for (const e of trans) {
          const x = t - (e.t + p * T) - leg.d;
          if (x > 0) v += e.step * (1 - Math.exp(-x / leg.tau));
        }
      }
      out[k] = v;
    }
    return out;
  }

  /* Both legs, the differential and common-mode voltages, over one PRBS7 period
     sampled SPB times a bit. */
  function waves(cfg) {
    const L = legs(cfg), ui = 1000 / cfg.rate, n = BITS.length;
    const ts = new Float64Array(n * SPB);
    for (let i = 0; i < ts.length; i++) ts[i] = i * ui / SPB;
    const P = legWave(L.P, BITS, ui, ts), N = legWave(L.N, BITS, ui, ts);
    const D = new Float64Array(ts.length), Cm = new Float64Array(ts.length);
    for (let i = 0; i < ts.length; i++) { D[i] = P[i] - N[i]; Cm[i] = (P[i] + N[i]) / 2; }
    return { L, ui, ts, P, N, D, Cm, bits: BITS };
  }

  /* The differential eye. Fold the period at the UI, with the fold's starting
     phase chosen so the opening sits whole inside one bit (the edges lag the bit
     boundary by the pole, so a fold at the boundary would split the eye in two).
     At each phase the opening is the lowest 1 less the highest 0. The height is the
     best phase's opening; the width is the share of the UI where the opening is at
     least THRESH of the swing, which is what a receiver with that much sensitivity
     can use. Timing the zero crossings would not do: half a UI of skew leaves the
     differential voltage sitting at zero between two half-steps, and a crossing
     time cannot see a dwell. */
  const THRESH = 0.1;
  function eye(W) {
    const n = W.bits.length, D = W.D, swing = 2 * SWING, len = D.length;
    let best = null;
    for (let o = 0; o < SPB; o++) {
      const open = new Float64Array(SPB);
      for (let ph = 0; ph < SPB; ph++) {
        let lo1 = Infinity, hi0 = -Infinity;
        for (let b = 0; b < n; b++) {
          const v = D[(b * SPB + o + ph) % len];
          if (W.bits[b]) lo1 = Math.min(lo1, v); else hi0 = Math.max(hi0, v);
        }
        open[ph] = (lo1 - hi0) / swing;
      }
      const height = Math.max(...open), width = open.filter((x) => x >= THRESH).length / SPB;
      if (!best || width > best.width || (width === best.width && height > best.height)) best = { o, open, height, width };
    }
    return { height: Math.max(0, best.height), width: best.width, offset: best.o, open: best.open };
  }

  /* Common-mode emission, relative to driving one wire alone with the same data.
     A short cable's radiated field goes as f·I_cm, and I_cm follows V_cm, so the
     figure compares the peak over frequency of f·|S_CD21|·|data spectrum| with the
     same for one wire (whose common mode is half its signal). */
  function emission(L, rate) {
    const fN = rate / 2;
    let pair = 0, one = 0;
    for (let i = 1; i <= 400; i++) {
      const f = i * 4 * fN / 400, x = Math.PI * f / rate;
      const data = Math.abs(Math.sin(x) / x);             // NRZ spectrum envelope
      const edge = 1 / Math.hypot(1, 2 * Math.PI * f * 1e-3 * L.P.tau);
      pair = Math.max(pair, f * mixed(L, f).scd * data);
      one = Math.max(one, f * 0.5 * edge * data);
    }
    return pair > 0 ? 20 * Math.log10(pair / one) : -Infinity;
  }

  function analyse(cfg) {
    const W = waves(cfg), E = eye(W);
    let cmPk = 0;
    for (const v of W.Cm) cmPk = Math.max(cmPk, Math.abs(v));
    const fN = cfg.rate / 2;
    return { W, eye: E, skew: W.L.skew, cmPk, atNyq: mixed(W.L, fN), emission: emission(W.L, cfg.rate) };
  }

  NS.models.diffpair = { DK, SWING, SPB, THRESH, TAU_PER_TR, C_IN_PER_PS, BITS, weaveSkew, legs, H, mixed, legWave, waves, eye, emission, analyse };
})();
