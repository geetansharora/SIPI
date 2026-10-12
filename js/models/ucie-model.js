/* SI & PI — models/ucie-model.js
 * UCIe die-to-die links: how much die edge a bandwidth costs, and at what power.
 *
 * Arithmetic on the UCIe Consortium's published key metrics (its 2025 overview
 * deck, "Key Metrics with UCIe 3.0"; ledger C-64 to C-71, and C-76 for direction). Nothing here is a
 * channel simulation: shoreline density is the consortium's figure for its
 * reference bump pitch (110 µm for UCIe-S, 45 µm for UCIe-A), scaled linearly
 * with data rate below 32 GT/s, which is what fixed geometry implies and what
 * the table's own 4 GT/s figures confirm (28 and 165 GB/s/mm against 28.0 and
 * 164.6 scaled down from 32 GT/s). The 48 and 64 GT/s figures are the table's,
 * not an extrapolation: UCIe-S gains less than the rate there.
 *
 * The round-trip estimate uses one assumption the table does not supply: a
 * propagation delay of 6.7 ps/mm, the site's figure for a dielectric constant
 * near 4. It is a scale, not a package model.
 *
 * Pure: no DOM, no state. Requires js/viz-kit.js for K.result.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || {});
  const K = NS.kit;
  NS.models = NS.models || {};

  const RATES = [4, 8, 12, 16, 24, 32, 48, 64];          // GT/s, the table's list
  const TPD = 6.7;                                       // ps/mm, Dk near 4 (assumption)
  const PKG = {
    S: {
      name: 'UCIe-S, standard package', width: 16, pitch: [100, 130], refPitch: 110, reach: 25,
      at32: 224, high: { 48: 278, 64: 370 },
      // 0.5 pJ/b at or below 16 GT/s, 0.75 at or above 32; the table gives no figure at 24.
      pj: (r) => (r <= 16 ? [0.5, 0.5] : r >= 32 ? [0.75, 0.75] : [0.5, 0.75])
    },
    A: {
      name: 'UCIe-A, advanced package', width: 64, pitch: [25, 55], refPitch: 45, reach: 2,
      at32: 1317, high: { 48: 1975, 64: 2634 },
      // 0.25 at or below 12 GT/s, 0.3 from 16 to 32, 0.5 at 48 and above.
      pj: (r) => (r <= 12 ? [0.25, 0.25] : r <= 32 ? [0.3, 0.3] : [0.5, 0.5])
    }
  };

  /* GB/s per mm of die edge, as the consortium quotes it: both directions together,
     which is what the module sizes in its chair's 2025 talk imply (ledger C-76). */
  function shoreline(pkg, rate) {
    const q = PKG[pkg];
    return rate <= 32 ? q.at32 * rate / 32 : q.high[rate];
  }

  NS.models.ucie = function (p) {
    const ok = p && PKG[p.pkg] && RATES.includes(p.rate) && Number.isFinite(p.tbps) && p.tbps >= 0.05 && p.tbps <= 64;
    if (!ok) return K.result({ model: 'ucie', version: '1.1', status: 'unsupported', params: p,
      why: 'Package must be S or A, the rate one of ' + RATES.join(', ') + ' GT/s, and the bandwidth 0.05 to 64 TB/s.' });
    const q = PKG[p.pkg], other = p.pkg === 'S' ? 'A' : 'S';
    const density = shoreline(p.pkg, p.rate);
    const edge = p.tbps * 1000 / density;                 // mm
    const pj = q.pj(p.rate);
    const ui = 1000 / p.rate;                              // ps
    const roundTrip = 2 * q.reach * TPD;                   // ps, at the table's maximum reach
    const curves = { S: RATES.map((r) => [r, p.tbps * 1000 / shoreline('S', r)]),
                     A: RATES.map((r) => [r, p.tbps * 1000 / shoreline('A', r)]) };
    return K.result({
      model: 'ucie', version: '1.1', status: 'ok', params: p,
      units: { tbps: 'TB/s, both directions', rate: 'GT/s', shoreline: 'GB/s/mm', edge: 'mm', energy: 'pJ/b', power: 'W', ui: 'ps', roundTrip: 'ps' },
      measurements: {
        shoreline: density, edgeMm: edge,
        fromTable: [4, 32, 48, 64].includes(p.rate),      // false: scaled linearly from 32 GT/s
        otherEdgeMm: p.tbps * 1000 / shoreline(other, p.rate),
        energyLo: pj[0], energyHi: pj[1],
        powerLoW: p.tbps * 8 * pj[0], powerHiW: p.tbps * 8 * pj[1],   // TB/s x 8 b/B x pJ/b = W
        moduleGBps: q.width * p.rate / 8,                  // one module, one direction
        uiPs: ui, roundTripPs: roundTrip, roundTripUI: roundTrip / ui,
        reachMm: q.reach, width: q.width, pitchLo: q.pitch[0], pitchHi: q.pitch[1]
      },
      generated: { curves, rates: RATES, name: q.name, otherName: PKG[other].name }
    });
  };
  /* ---------- does this wire need a termination? ----------
     A UCIe lane as a lossless line between a resistive driver and a receiver that
     is either open or terminated in Z0, driven with a bit pattern. Exact: the line
     is linear, so the received voltage is the sum of K.line1D step responses, one
     per bit transition, the same solver Lab A uses. The edge is taken as 30% of a
     unit interval, and Z0 as 50 ohm; both are choices, not UCIe figures.

     The measurement is what a receiver sampling mid-bit sees: the worst difference
     between the voltage at each bit centre and the level that bit settles to, as a
     fraction of the settled swing. An echo that dies within the bit costs nothing;
     one that arrives in the next bit is inter-symbol interference. */
  const PATTERN = [0, 1, 0, 1, 1, 0, 0, 1, 1, 1, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0];
  /* ---------- a resistive line, solved exactly in frequency ----------
     A wire with series resistance R' per mm as well as its inductance and
     capacitance (RLC, no G, R' independent of frequency: a thin interposer or RDL
     trace, where the DC resistance dominates). The telegrapher solution is exact at
     every frequency:

       Z = R' + jwL',  Y = jwC',  gamma = sqrt(ZY),  Zc = sqrt(Z/Y)
       ABCD of the line: A = D = cosh(gamma*l), B = Zc*sinh(gamma*l), C = sinh(gamma*l)/Zc
       V_rx / V_s = 1 / (A + B/ZL + Rs*C + Rs*D/ZL)          (1 / (A + Rs*C) when open)

     with L' = Z0*tpd and C' = tpd/Z0, so that at R' = 0 it is the same 50 ohm,
     6.7 ps/mm line as the lossless lattice. The source waveform, with the same
     smoothstep edges, is transformed, multiplied and transformed back; the record is
     long enough for the echoes to die below 1e-6, so the FFT's periodic wrap does not
     reach the samples. At DC the open end sees the full swing and a terminated end
     the divider RL / (RL + Rs + R'*l). */
  function lossyLineWave(p, ui, td, tr, Z0, steps) {
    const Rw = p.rPerMm, len = p.lenMm, Lp = Z0 * TPD, Cp = TPD / Z0;        // ohm/mm, ohm.ps/mm, ps/(ohm.mm)
    const open = p.term === 'open', RL = Z0;
    const echo = Math.max(0.05, Math.abs((open ? 1 : 0) * (p.rs - Z0) / (p.rs + Z0)));
    const trips = Math.min(60, Math.ceil(Math.log(1e-6) / Math.log(echo)));
    const t0 = -tr, span = PATTERN.length * ui + td + trips * 2 * td + 20 * tr + 50;
    const dt = Math.min(ui / 32, tr / 8);
    let N = 1; while (N < span / dt) N <<= 1;
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const t = t0 + i * dt;
      re[i] = steps.reduce((v, q) => v + q.d * K.smoothStep(t - q.t, tr), 0);
    }
    K.fft(re, im, false);
    // Complex helpers on [re, im] pairs.
    const mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
    const div = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
    const csqrt = (a) => { const r = Math.hypot(a[0], a[1]), x = Math.sqrt((r + a[0]) / 2), y = Math.sign(a[1] || 1) * Math.sqrt(Math.max(0, (r - a[0]) / 2)); return [x, y]; };
    const cexp = (a) => { const e = Math.exp(a[0]); return [e * Math.cos(a[1]), e * Math.sin(a[1])]; };
    const H = (k) => {
      if (k === 0) return [open ? 1 : RL / (RL + p.rs + Rw * len), 0];
      const w = 2 * Math.PI * k / (N * dt);                                  // rad/ps
      const Z = [Rw, w * Lp], Y = [0, w * Cp];
      const g = csqrt(mul(Z, Y)), Zc = csqrt(div(Z, Y));
      const gl = [g[0] * len, g[1] * len], ep = cexp(gl), em = cexp([-gl[0], -gl[1]]);
      const ch = [(ep[0] + em[0]) / 2, (ep[1] + em[1]) / 2], sh = [(ep[0] - em[0]) / 2, (ep[1] - em[1]) / 2];
      const B = mul(Zc, sh), C = div(sh, Zc);
      let den = [ch[0] + p.rs * C[0], ch[1] + p.rs * C[1]];
      if (!open) den = [den[0] + B[0] / RL + p.rs * ch[0] / RL, den[1] + B[1] / RL + p.rs * ch[1] / RL];
      return div([1, 0], den);
    };
    for (let k = 0; k <= N / 2; k++) {
      const h = H(k);
      const a = mul([re[k], im[k]], h);
      re[k] = a[0]; im[k] = a[1];
      if (k > 0 && k < N / 2) { const b = mul([re[N - k], im[N - k]], [h[0], -h[1]]); re[N - k] = b[0]; im[N - k] = b[1]; }
    }
    K.fft(re, im, true);
    const swing = open ? 1 : RL / (RL + p.rs + Rw * len);
    const at = (t) => {
      const x = (t - t0) / dt, i = Math.floor(x);
      if (i < 0) return 0;
      if (i >= N - 1) return re[N - 1];
      return re[i] + (x - i) * (re[i + 1] - re[i]);
    };
    return { at, swing };
  }

  NS.models.ucieEcho = function (p) {
    p = p && Object.assign({ rPerMm: 0 }, p);
    const ok = p && RATES.includes(p.rate) && Number.isFinite(p.lenMm) && p.lenMm >= 0.2 && p.lenMm <= 30
      && (p.term === 'open' || p.term === 'matched') && Number.isFinite(p.rs) && p.rs >= 5 && p.rs <= 200
      && Number.isFinite(p.rPerMm) && p.rPerMm >= 0 && p.rPerMm <= 100;
    if (!ok) return K.result({ model: 'ucieEcho', version: '1.1', status: 'unsupported', params: p,
      why: 'Rate must be a UCIe rate, length 0.2 to 30 mm, receiver open or matched, driver 5 to 200 ohm, wire resistance 0 to 100 ohm/mm.' });
    const Z0 = 50, ui = 1000 / p.rate, td = p.lenMm * TPD, tr = 0.3 * ui;
    const M = K.line1D({ Z0, Rs: p.rs, td, tr, open: p.term === 'open', RL: Z0, vs: 1, nWave: 80 });
    const steps = PATTERN.map((b, k) => ({ t: k * ui, d: b - (k ? PATTERN[k - 1] : 0) })).filter((q) => q.d);
    const lossy = p.rPerMm > 0 ? lossyLineWave(p, ui, td, tr, Z0, steps) : null;
    const at = lossy ? lossy.at : (t) => steps.reduce((v, q) => v + q.d * K.line1DAt(M, 1, t - q.t).v, 0);
    const swing = lossy ? lossy.swing : M.vFinal, end = td + PATTERN.length * ui, n = 900;
    const wave = [], ideal = [], samples = [];
    for (let i = 0; i <= n; i++) {
      const t = end * i / n;
      wave.push([t, at(t) / swing]);
      const k = Math.floor((t - td) / ui);
      ideal.push([t, k >= 0 && k < PATTERN.length ? PATTERN[k] : 0]);
    }
    let worst = 0;
    PATTERN.forEach((b, k) => {
      const t = td + (k + 0.5) * ui, v = at(t) / swing;
      samples.push([t, v, b]);
      if (k) worst = Math.max(worst, Math.abs(v - b));
    });
    return K.result({
      model: 'ucieEcho', version: '1.1', status: 'ok', params: p,
      units: { rate: 'GT/s', lenMm: 'mm', rs: 'ohm', rPerMm: 'ohm/mm', time: 'ps', voltage: 'fraction of settled swing' },
      measurements: {
        uiPs: ui, tdPs: td, roundTripPs: 2 * td, roundTripUI: 2 * td / ui,
        gammaLoad: M.GL, gammaSource: M.GS, echo: M.GL * M.GS, settledSwing: swing,
        wireOhms: p.rPerMm * p.lenMm, solver: lossy ? 'frequency' : 'lattice',
        worstSampleError: worst
      },
      generated: { wave, ideal, samples, pattern: PATTERN, end }
    });
  };

  /* ---------- UCIe-3D: how hot a bonded interface runs ----------
     Two dies bonded face to face carry bandwidth through their overlap, so it is set
     per square millimetre. The consortium publishes two points (C-71, C-102):
       9 um bond pitch: 4,000 GB/s/mm2 at under 0.05 pJ/b
       1 um bond pitch: 300,000 GB/s/mm2 at 0.01 pJ/b
     Between them the model draws a power law through both points, the straight line on
     log axes. For density the exponent is ln(75)/ln(9) = 1.965, close to the square
     law the bump count implies; for energy it is ln(5)/ln(9) = 0.732. Only the two end
     points are published, so everything between them is an interpolation, and the pitch
     is limited to the 1 to 9 um the targets cover.

     Power density is bandwidth density x energy per bit x the share of wires busy:
     GB/s/mm2 x 8 b/B x pJ/b = mW/mm2. The reference it is compared with is one product's
     average, an H100 SXM module's 700 W over its 814 mm2 die (C-103, C-104), which
     over-states the die's own average because the module power includes its memory. */
  const P3 = { lo: 1, hi: 9, dLo: 300000, dHi: 4000, eLo: 0.01, eHi: 0.05 };
  const H100 = 700 / 814;                                  // W/mm2, module power over die area
  NS.models.ucie3d = function (p) {
    const ok = p && Number.isFinite(p.pitch) && p.pitch >= P3.lo && p.pitch <= P3.hi
      && Number.isFinite(p.activity) && p.activity > 0 && p.activity <= 1
      && Number.isFinite(p.area) && p.area > 0 && p.area <= 1000
      && Number.isFinite(p.budget) && p.budget > 0 && p.budget <= 100;
    if (!ok) return K.result({ model: 'ucie3d', version: '1.0', status: 'unsupported', params: p,
      why: 'Bond pitch must be 1 to 9 um (the published targets), activity 0 to 1, area up to 1000 mm2 and budget up to 100 W/mm2.' });
    const kD = Math.log(P3.dLo / P3.dHi) / Math.log(P3.hi / P3.lo);
    const kE = Math.log(P3.eHi / P3.eLo) / Math.log(P3.hi / P3.lo);
    const dens = (q) => P3.dHi * Math.pow(P3.hi / q, kD);              // GB/s/mm2
    const epb = (q) => P3.eHi * Math.pow(q / P3.hi, kE);               // pJ/b
    const pd = (q, a) => dens(q) * 8 * epb(q) * 1e-3 * a;              // W/mm2
    const full = pd(p.pitch, 1), now = full * p.activity;
    const curve = [], fullCurve = [];
    for (let i = 0; i <= 80; i++) {
      const q = P3.lo * Math.pow(P3.hi / P3.lo, i / 80);
      curve.push([q, pd(q, p.activity)]); fullCurve.push([q, pd(q, 1)]);
    }
    return K.result({
      model: 'ucie3d', version: '1.0', status: 'ok', params: p,
      units: { pitch: 'um', density: 'GB/s/mm2', energy: 'pJ/b', powerDensity: 'W/mm2', bandwidth: 'TB/s', power: 'W', area: 'mm2' },
      measurements: {
        density: dens(p.pitch), energy: epb(p.pitch), powerDensity: now, powerDensityFull: full,
        bandwidth: dens(p.pitch) * p.area / 1000, power: now * p.area,
        ratioToBudget: now / p.budget, maxActivity: Math.min(1, p.budget / full),
        published: p.pitch === P3.lo || p.pitch === P3.hi,
        exponents: { density: kD, energy: kE }
      },
      generated: { curve, fullCurve, points: [[P3.hi, pd(P3.hi, 1)], [P3.lo, pd(P3.lo, 1)]], h100: H100 }
    });
  };
  NS.models.ucie3d.H100 = H100;
  NS.models.ucie3d.RANGE = [P3.lo, P3.hi];

  NS.models.ucie.RATES = RATES;
  NS.models.ucie.shoreline = shoreline;
  NS.models.ucie.TPD = TPD;
})();
