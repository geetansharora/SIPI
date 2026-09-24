/* SIPI — js/models/calc-models.js
 * The arithmetic behind the calculators, and nothing else: no DOM, no drawing.
 * Everything here is a closed form, so check-models.js can call it headless and
 * test it against limits, special cases and published references rather than
 * against a copy of itself.
 *
 * Units are SI inside every function (m, s, Hz, H, F, Ω) unless the argument
 * name says otherwise (lenIn, wMil, tUm, aMm). Where a calculator takes its
 * inputs in engineering units, the conversion happens once, here.
 *
 * Requires js/viz-kit.js (K.Q, K.Qinv, K.viaLoopInductance).
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;
  const C = (NS.calc = NS.calc || {});

  const C0 = 299792458;                  // m/s, exact
  const MU0 = 4e-7 * Math.PI;            // H/m, the value K.MU0_OVER_PI also uses
  const ETA0 = MU0 * C0;                 // 376.73 Ω
  const IN = 0.0254, MIL = 25.4e-6;      // m, exact
  const DB_PER_NP = 20 / Math.LN10;      // 8.686 dB per neper
  /* Copper at 20 °C. 1.68e-8 Ω·m is the figure behind the 2.06 µm at 1 GHz that
     the loss pages already use, so a calculator and a topic page cannot disagree
     about the same copper. Annealed-copper IACS (1.724e-8) would move δ by 1.3%. */
  const RHO_CU = 1.68e-8;
  const TPD_AIR = 1e12 * IN / C0;        // 84.72 ps per inch in vacuum

  C.CONST = { C0, MU0, ETA0, IN, MIL, RHO_CU, TPD_AIR };

  /* ── 1. LC / RLC resonance ───────────────────────────────────────────────
     Series: Z = R + j(ωL − 1/ωC).  Parallel: Y = 1/R + j(ωC − 1/ωL).
     Both resonate at ω0 = 1/√(LC). Q = Z0/R in series and R/Z0 in parallel,
     with Z0 = √(L/C). The half-power points solve |X| = R (series) or |B| = G
     (parallel), which is the same quadratic in both cases:
         f1,2 = f0 · ( √(1 + 1/4Q²) ∓ 1/2Q ),  so f2 − f1 = f0/Q exactly.
     The capacitor mode is the series circuit with R = ESR and L = ESL. */
  C.rlc = function (mode, R, L, Cap) {
    const w0 = 1 / Math.sqrt(L * Cap), f0 = w0 / (2 * Math.PI);
    const z0 = Math.sqrt(L / Cap);
    const Q = mode === 'parallel' ? R / z0 : z0 / R;
    const h = 1 / (2 * Q), root = Math.sqrt(1 + h * h);
    return { f0, z0, Q, bw: f0 / Q, f1: f0 * (root - h), f2: f0 * (root + h), zeta: h, zAtF0: R };
  };
  C.rlcZ = function (mode, R, L, Cap, f) {
    const w = 2 * Math.PI * f;
    if (mode === 'parallel') {
      const g = 1 / R, b = w * Cap - 1 / (w * L);
      return { mag: 1 / Math.hypot(g, b), phase: Math.atan2(-b, g) };
    }
    const x = w * L - 1 / (w * Cap);
    return { mag: Math.hypot(R, x), phase: Math.atan2(x, R) };
  };

  /* ── 2. Return loss, Γ, VSWR, load ───────────────────────────────────────
     Γ = (ZL − Z0)/(ZL + Z0) for a resistive load. Return loss, |Γ| and VSWR all
     fix only the MAGNITUDE, so from any of them the load is one of two values,
     Z0·VSWR or Z0/VSWR. Only a known load gives Γ its sign. */
  C.refl = function (z0, given, value) {
    let g, zl = null;
    if (given === 'zl') { g = (value - z0) / (value + z0); zl = value; }
    else if (given === 'gamma') g = value;
    else if (given === 'vswr') g = (value - 1) / (value + 1);
    else g = Math.pow(10, -value / 20);
    const a = Math.abs(g);
    const vswr = a >= 1 ? Infinity : (1 + a) / (1 - a);
    return {
      gamma: g, mag: a, known: zl !== null, zl, vswr,
      rl: a === 0 ? Infinity : -20 * Math.log10(a),
      zHigh: a >= 1 ? Infinity : z0 * vswr, zLow: a >= 1 ? 0 : z0 / vswr,
      pRefl: a * a, pTrans: 1 - a * a,
      ml: a >= 1 ? Infinity : -10 * Math.log10(1 - a * a),
      vLoad: zl !== null ? 1 + g : null
    };
  };

  /* ── 3. BER, Q and total jitter (dual-Dirac) ─────────────────────────────
     BER = ρ·Q(QBER), where ρ is the transition density, and
     TJ(BER) = DJ(δδ) + 2·QBER·RJ.
     ρ = 0.5 is random data and is what the jitter and bathtub panels use.
     ρ = 1 is the convention behind the published multiplier tables (14.07 at
     1e-12), so both are offered and the page says which is which. */
  C.ber = function (ber, rho, rj, dj, ui) {
    const q = K.Qinv(ber / rho);
    const tj = dj + 2 * q * rj;
    return { q, alpha: 2 * q, tj, rjPart: 2 * q * rj, open: ui - tj, openFrac: (ui - tj) / ui };
  };

  /* ── 4. Bit rate, UI, Nyquist, edge bandwidth ────────────────────────────
     A single pole's 10–90% rise time is 2.2τ, so its −3 dB frequency is
     1/(2πτ) = 2.2/(2π·tr) = 0.350/tr. That is where the 0.35 comes from, and it
     is exact only for a single pole. PAM4 carries two bits per symbol, so the
     same bit rate has twice the UI and half the Nyquist frequency. */
  C.bitrate = function (rate, bits, tr, lenIn, dk) {
    const baud = rate / bits, ui = 1 / baud;
    const td = lenIn * TPD_AIR * Math.sqrt(dk) * 1e-12;
    const bw = 0.35 / tr;
    return { baud, ui, fn: baud / 2, bw, trFrac: tr / ui, td, inFlight: td / ui, bwOverFn: bw / (baud / 2) };
  };
  C.dataPsd = function (f, ui) {         // random NRZ/PAM symbols: sinc² envelope, 1 at DC
    const x = Math.PI * f * ui;
    return x === 0 ? 1 : Math.pow(Math.sin(x) / x, 2);
  };
  /* Its upper envelope, min(1, 1/(pi*f*UI)^2): flat to about Nyquist, then down
     20 dB per decade. The sidelobes between the nulls add detail, not meaning,
     and on a log axis they pile into a comb that hides the roll-off. */
  C.dataEnvelope = function (f, ui) {
    const x = Math.PI * f * ui;
    return Math.min(1, 1 / (x * x));
  };
  C.edgeLpf = function (f, tr) {          // single pole, |H|², corner at 0.35/tr
    return 1 / (1 + Math.pow(f * tr / 0.35, 2));
  };

  /* ── 5. Electrical length ────────────────────────────────────────────────
     The same criterion as when-is-a-trace-a-transmission-line.html, so the two
     pages cannot disagree: a trace is electrically long when its round trip is
     longer than a third of the rise time, 2·Td > tr/3, i.e. l > tr/(6·tpd). */
  C.tpd = (dk) => TPD_AIR * Math.sqrt(dk) * 1e-12;          // s per inch
  C.elen = function (lenIn, tr, dk) {
    const tpd = C.tpd(dk), td = lenIn * tpd, lcrit = tr / (6 * tpd);
    return { tpd, td, round: 2 * td, third: tr / 3, lcrit, ratio: lenIn / lcrit, long: 2 * td > tr / 3 };
  };

  /* ── 6. Via stub resonance ───────────────────────────────────────────────
     An open stub is a quarter wave at f = c/(4·l·√Dk_eff) and shorts the line
     there. For an ideal stub of the line's own impedance, shunted across a
     matched line: S21 = 2/(2 + j·tan θ), θ = (π/2)(f/f_notch). Exact for that
     idealisation: a real stub has loss, so its notch is finite. */
  C.stub = function (lenMil, dk, fn, k) {
    const fNotch = C0 / (4 * lenMil * MIL * Math.sqrt(dk));
    const lMaxMil = C0 / (4 * k * fn * Math.sqrt(dk)) / MIL;
    return { fNotch, ratio: fNotch / fn, lMaxMil, ok: fNotch >= k * fn, s21AtFn: C.stubS21(fn, fNotch) };
  };
  C.stubS21 = function (f, fNotch) {      // dB
    const t = Math.tan((Math.PI / 2) * (f / fNotch));
    return 10 * Math.log10(4 / (4 + t * t));
  };

  /* ── 7. Target impedance ─────────────────────────────────────────────────
     Z = V·ripple/ΔI: the impedance at which the transient current step, flowing
     through the network, produces exactly the allowed ripple. */
  C.ztarget = function (v, ripplePct, dI) {
    const dv = v * ripplePct / 100;
    return { z: dv / dI, dv };
  };

  /* ── 8. Skin depth and roughness ─────────────────────────────────────────
     δ = √(ρ/(π·f·µ0)). The surface resistance of a conductor much thicker than δ
     is Rs = ρ/δ per square. Current crowds into the skin once δ < t/2, i.e.
     above f = ρ/(π·µ0·(t/2)²). Roughness multiplies conductor loss by
     K = 1 + (2/π)·atan(1.4·(Rq/δ)²) -- Hammerstad & Bekkadal (1975), which is
     written for the RMS roughness Rq, not the peak-to-valley Rz. */
  C.skinDepth = (f) => Math.sqrt(RHO_CU / (Math.PI * f * MU0));
  C.roughK = (rq, delta) => 1 + (2 / Math.PI) * Math.atan(1.4 * Math.pow(rq / delta, 2));
  C.skin = function (f, tUm, rqUm) {
    const d = C.skinDepth(f), t = tUm * 1e-6;
    return {
      delta: d, rs: RHO_CU / d, kr: C.roughK(rqUm * 1e-6, d),
      fHalf: RHO_CU / (Math.PI * MU0 * Math.pow(t / 2, 2)),
      ratio: d / (t / 2)
    };
  };

  /* ── 9. Loss budget ──────────────────────────────────────────────────────
     Dielectric: α_d = π·f·√Dk·Df/c nepers per metre -- exact for a TEM line
     wholly in one dielectric, and the source of the familiar 2.3·f[GHz]·Df·√Dk
     dB/in. Conductor: α_c = R'/(2·Z0) with R' = Rs·K/w, current taken on one face
     of the strip and the return path lossless. That first-order split is the
     assumption to know: stripline current on both faces would halve R', and the
     return planes add some of it back. */
  C.loss = function (f, lenIn, dk, df, wMil, z0, rqUm) {
    const d = C.skinDepth(f), kr = C.roughK(rqUm * 1e-6, d);
    const rPer = (RHO_CU / d) * kr / (wMil * MIL);                 // Ω/m
    const ac = rPer / (2 * z0) * DB_PER_NP * IN;                   // dB/in
    const ad = Math.PI * f * Math.sqrt(dk) * df / C0 * DB_PER_NP * IN;
    return { ac, ad, per: ac + ad, total: (ac + ad) * lenIn, kr, delta: d, dielShare: ad / (ac + ad) };
  };

  /* ── 10. Plane-pair cavity resonance ─────────────────────────────────────
     A rectangular plane pair with open (magnetic-wall) edges resonates at
       f(m,n) = (c / 2√Dk) · √((m/a)² + (n/b)²).
     Fringing at the edges lowers these slightly; the planes are assumed
     unpopulated -- decoupling capacitors and vias move every mode. */
  C.cavity = function (aMm, bMm, dk, fMax) {
    const v = C0 / Math.sqrt(dk), a = aMm / 1000, b = bMm / 1000;
    const f = (m, n) => (v / 2) * Math.sqrt(Math.pow(m / a, 2) + Math.pow(n / b, 2));
    const modes = [];
    for (let m = 0; m <= 30; m++) {
      for (let n = 0; n <= 30; n++) {
        if (m || n) { const fm = f(m, n); if (fm <= fMax) modes.push({ m, n, f: fm }); }
      }
    }
    modes.sort((p, q) => p.f - q.f);
    return { f, modes, f10: f(1, 0), f01: f(0, 1), f11: f(1, 1), first: Math.min(f(1, 0), f(0, 1)) };
  };

  /* ── 11. Decoupling capacitor mounting inductance ────────────────────────
     The two vias from the capacitor's pads down to its plane pair form a loop.
     For two parallel round conductors the loop inductance is exact:
       L = (µ0·h/π)·acosh(s/d)
     -- K.viaLoopInductance, the same model the via pages use. Pad, trace and
     plane-spreading inductance are NOT included, and on a real board they are
     often comparable, so this is the via pair's share, not the whole loop. */
  C.mount = function (hMil, dMil, sMil, esl, cap) {
    const lVia = K.viaLoopInductance(hMil * MIL, dMil * MIL / 2, sMil * MIL);
    const lTot = esl + lVia;
    return { lVia, lTot, srf: 1 / (2 * Math.PI * Math.sqrt(lTot * cap)),
             srfPart: 1 / (2 * Math.PI * Math.sqrt(esl * cap)),
             z0: Math.sqrt(lTot / cap), viaShare: lVia / lTot };
  };

  /* ── 12. Microstrip and stripline impedance ──────────────────────────────
     Microstrip: Hammerstad & Jensen (1980), with their thickness correction.
     Their paper reports the zero-thickness Z01 within 0.01% and ε_eff within
     0.2% of their reference over 0.01 ≤ w/h ≤ 100 and ε_r ≤ 128.
     Stripline, centred, zero thickness: Cohn's conformal-mapping result
       Z0 = (η0/4√ε_r)·K(k)/K(k'),  k = sech(πw/2b),  k' = tanh(πw/2b)
     which is exact for that geometry; K is evaluated by the arithmetic-
     geometric mean, also exact. A strip of real thickness has a few ohms less. */
  function hjZ01(u) {                     // air-filled, zero thickness
    const fu = 6 + (2 * Math.PI - 6) * Math.exp(-Math.pow(30.666 / u, 0.7528));
    return ETA0 / (2 * Math.PI) * Math.log(fu / u + Math.sqrt(1 + 4 / (u * u)));
  }
  function hjEeff(u, er) {
    const a = 1 + Math.log((Math.pow(u, 4) + Math.pow(u / 52, 2)) / (Math.pow(u, 4) + 0.432)) / 49
              + Math.log(1 + Math.pow(u / 18.1, 3)) / 18.7;
    const b = 0.564 * Math.pow((er - 0.9) / (er + 3), 0.053);
    return (er + 1) / 2 + (er - 1) / 2 * Math.pow(1 + 10 / u, -a * b);
  }
  C.microstrip = function (w, h, t, er) { // any one length unit for w, h, t
    const u = w / h, tn = t / h;
    let u1 = u, ur = u;
    if (tn > 0) {
      const coth = 1 / Math.tanh(Math.sqrt(6.517 * u));
      const du1 = (tn / Math.PI) * Math.log(1 + 4 * Math.E / (tn * coth * coth));
      u1 = u + du1;
      ur = u + 0.5 * (1 + 1 / Math.cosh(Math.sqrt(er - 1))) * du1;
    }
    const eeff = hjEeff(ur, er) * Math.pow(hjZ01(u1) / hjZ01(ur), 2);
    const z0 = hjZ01(ur) / Math.sqrt(hjEeff(ur, er));
    return { z0, eeff, tpd: TPD_AIR * Math.sqrt(eeff) * 1e-12 };
  };
  function agm(a, b) {
    for (let i = 0; i < 60 && Math.abs(a - b) > 1e-15 * a; i++) {
      const m = (a + b) / 2; b = Math.sqrt(a * b); a = m;
    }
    return a;
  }
  C.ellipK = (k) => Math.PI / (2 * agm(1, Math.sqrt(1 - k * k)));   // complete, modulus k
  C.stripline = function (w, b, er) {
    const x = Math.PI * w / (2 * b);
    const k = 1 / Math.cosh(x), kp = Math.tanh(x);
    /* K(k) = π/(2·agm(1,k')) and K(k') = π/(2·agm(1,k)): passing the complement
       directly keeps full precision when k is within 1e-16 of 1. */
    const kk = Math.PI / (2 * agm(1, kp)), kkp = Math.PI / (2 * agm(1, k));
    return { z0: ETA0 / (4 * Math.sqrt(er)) * kk / kkp, eeff: er, tpd: TPD_AIR * Math.sqrt(er) * 1e-12 };
  };
  C.zline = function (type, w, h, t, er) {
    return type === 'sl' ? C.stripline(w, h, er) : C.microstrip(w, h, t, er);
  };
  /* The width that gives a target impedance. Z0 falls monotonically with width,
     so bisection on a log scale cannot miss it. Returns NaN when the target is
     outside what w/h from 1e-3 to 1e3 can reach. */
  C.widthFor = function (target, type, h, t, er) {
    const z = (w) => C.zline(type, w, h, t, er).z0;
    let lo = h * 1e-3, hi = h * 1e3;
    if (!(z(lo) >= target && z(hi) <= target)) return NaN;
    for (let i = 0; i < 100; i++) {
      const mid = Math.sqrt(lo * hi);
      (z(mid) > target) ? (lo = mid) : (hi = mid);
    }
    return Math.sqrt(lo * hi);
  };
})();
