/* SI & PI — models/ufs-burst-model.js
 * A short link with a power problem: one UFS transfer after another, the lane
 * waiting in STALL or dropping to HIBERN8 between them, and what each choice
 * costs in energy, in power and in the latency of waking.
 *
 *   burst     the transfer at the gear's rate over two lanes, after 8b10b
 *             (HS-G4 11.6 Gb/s, HS-G5 23.32 Gb/s a lane; C-157, C-12b)
 *   STALL     the wait between bursts, left in nanoseconds (C-163): no latency
 *   HIBERN8   entered after an idle threshold; leaving it takes hundreds to
 *             thousands of microseconds (C-163), the reader's setting, and the
 *             next transfer waits for it
 *
 * The energy account per transfer is
 *
 *   E = P_burst t_burst + P_stall min(gap, θ) + P_h8 max(0, gap − θ) + [gap > θ] P_wake t_wake
 *
 * and HIBERN8 beats staying in STALL once the idle is longer than
 *
 *   gap* = θ + P_wake t_wake / (P_stall − P_h8)
 *
 * since both policies spend the same in STALL until θ: the sleep then has to
 * win back the wake's energy out of the time that is left.
 *
 * The state powers are illustrative: M-PHY's are in the members-only
 * specification, and a PHY's own figures are in its datasheet. The lesson, the
 * break-even and its dependence on the wake time, does not depend on them.
 *
 * The rail view drives an illustrative three-stage PDN (K.pdnLadder) with the
 * current step a burst draws, through K.pdnTransient.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  NS.models = NS.models || {};
  const K = NS.kit;

  const GEARS = { 4: 11.6, 5: 23.32 };              // Gb/s a lane, on the wire
  const LANES = 2, CODE = 0.8;                       // 8b10b
  const VRAIL = 1.2;                                 // V, illustrative
  // illustrative state powers, mW: a burst, waiting in STALL, asleep in HIBERN8,
  // and waking (taken as STALL's, the PHY's bias and clocks coming back)
  const P = { burst: 96, stall: 30, h8: 0.25, wake: 30 };

  const burstUs = (kb, gear) => (kb * 1024 * 8) / (GEARS[gear] * 1e3 * LANES * CODE);   // µs

  /* One cycle: a burst, the idle gap, and a wake when the gap outlasted θ.
     Times in µs, powers in mW, energies in nJ (mW·µs). */
  function cycle(cfg) {
    const tb = burstUs(cfg.kb, cfg.gear), g = cfg.gap, th = cfg.theta;
    const sleeps = isFinite(th) && g > th;
    const segs = [{ state: 'burst', t: tb, p: P.burst }];
    if (sleeps) {
      if (th > 0) segs.push({ state: 'stall', t: th, p: P.stall });
      segs.push({ state: 'hibern8', t: g - th, p: P.h8 });
      segs.push({ state: 'wake', t: cfg.wake, p: P.wake });
    } else if (g > 0) segs.push({ state: 'stall', t: g, p: P.stall });
    const T = segs.reduce((a, s) => a + s.t, 0);
    const E = P.burst * tb + P.stall * Math.min(g, isFinite(th) ? th : g) + P.h8 * (sleeps ? g - th : 0) + (sleeps ? P.wake * cfg.wake : 0);
    return { segs, T, E, tb, latency: sleeps ? cfg.wake : 0, avg: E / T, sleeps };
  }

  /* The power at time t (µs) into a cycle: the timeline as a function. */
  function powerAt(C, t) {
    let a = 0;
    for (const s of C.segs) { if (t < a + s.t) return s.p; a += s.t; }
    return C.segs[C.segs.length - 1].p;
  }

  // the idle at which sleeping after θ starts to pay; θ = 0 for a lane that never sleeps,
  // which the chart compares against sleeping at once
  const breakEven = (wake, theta) => (isFinite(theta) ? theta : 0) + (P.wake * wake) / (P.stall - P.h8);

  /* An illustrative rail: regulator, a bulk capacitor, the board's decoupling and
     the package into the die. "weak" has a quarter of the local decoupling and
     four times the package inductance. */
  function stages(weak) {
    return [
      { name: 'VRM', series: null, shunt: { r: 2e-3, l: 2e-3 / (2 * Math.PI * 100e3) } },
      { name: 'bulk', series: { r: 4e-4, l: 1.2e-9 }, shunt: { r: 0.01, l: 1e-9, c: 10e-6, n: 2 } },
      { name: 'board', series: { r: 2e-4, l: 0.5e-9 }, shunt: { r: 5e-3, l: 0.4e-9, c: 1e-6, n: weak ? 1 : 4 } },
      { name: 'die', series: { r: 1e-3, l: weak ? 4e-9 : 1e-9 }, shunt: { r: 0.02, l: 0, c: 20e-9, n: 1 } }
    ];
  }

  /* The rail at the burst's start: the current steps from the waiting state's to
     the burst's over 20 ns and holds for the burst (or 5.5 µs), then falls.
     The step is 1 µs in; the view shows the first 8 µs. The transform is
     circular, so the record runs to 32 µs: the regulator's slow recovery has to
     die away before it would wrap round onto the start. Returns volts of
     deviation, negative a droop. */
  const DT = 2e-9, NS_ = 16384, T0 = 1e-6;
  function railStep(cfg, scale) {
    const from = cfg.sleepsBefore ? P.wake : P.stall;
    const dI = ((P.burst - from) / 1000 / VRAIL) * (scale === undefined ? 1 : scale);
    const hold = Math.min(cfg.tbUs * 1e-6, 5.5e-6), rise = 20e-9;
    const i = new Float64Array(NS_);
    for (let k = 0; k < NS_; k++) {
      const t = k * DT;
      const up = Math.max(0, Math.min(1, (t - T0) / rise)), dn = Math.max(0, Math.min(1, (t - T0 - hold) / rise));
      i[k] = dI * (up - dn);
    }
    const v = K.pdnTransient(stages(cfg.weak), i, DT);
    for (let k = 0; k < NS_; k++) v[k] = -v[k];
    return { i, v, dI, dt: DT, t0: T0 };
  }

  const railCache = new Map();
  function analyse(cfg) {
    const C = cycle(cfg);
    const S = cycle(Object.assign({}, cfg, { theta: Infinity }));
    // the rail depends only on the burst's length (to 5.5 µs), the state it woke
    // from and the rail, so dragging the gap or the threshold reuses it
    const key = [Math.min(C.tb, 5.5).toFixed(4), C.sleeps, !!cfg.weak].join('|');
    let R = railCache.get(key);
    if (!R) {
      R = railStep({ sleepsBefore: C.sleeps, tbUs: C.tb, weak: cfg.weak });
      if (railCache.size > 16) railCache.delete(railCache.keys().next().value);
      railCache.set(key, R);
    }
    let droop = 0; for (const x of R.v) droop = Math.min(droop, x);
    return { C, S, R, droop, be: breakEven(cfg.wake, cfg.theta) };
  }

  NS.models.ufsBurst = { GEARS, LANES, CODE, VRAIL, P, burstUs, cycle, powerAt, breakEven, stages, railStep, analyse };
})();
