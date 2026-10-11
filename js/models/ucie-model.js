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
  NS.models.ucieEcho = function (p) {
    const ok = p && RATES.includes(p.rate) && Number.isFinite(p.lenMm) && p.lenMm >= 0.2 && p.lenMm <= 30
      && (p.term === 'open' || p.term === 'matched') && Number.isFinite(p.rs) && p.rs >= 5 && p.rs <= 200;
    if (!ok) return K.result({ model: 'ucieEcho', version: '1.0', status: 'unsupported', params: p,
      why: 'Rate must be a UCIe rate, length 0.2 to 30 mm, receiver open or matched, driver 5 to 200 ohm.' });
    const Z0 = 50, ui = 1000 / p.rate, td = p.lenMm * TPD, tr = 0.3 * ui;
    const M = K.line1D({ Z0, Rs: p.rs, td, tr, open: p.term === 'open', RL: Z0, vs: 1, nWave: 80 });
    const steps = PATTERN.map((b, k) => ({ t: k * ui, d: b - (k ? PATTERN[k - 1] : 0) })).filter((q) => q.d);
    const at = (t) => steps.reduce((v, q) => v + q.d * K.line1DAt(M, 1, t - q.t).v, 0);
    const swing = M.vFinal, end = td + PATTERN.length * ui, n = 900;
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
      model: 'ucieEcho', version: '1.0', status: 'ok', params: p,
      units: { rate: 'GT/s', lenMm: 'mm', rs: 'ohm', time: 'ps', voltage: 'fraction of settled swing' },
      measurements: {
        uiPs: ui, tdPs: td, roundTripPs: 2 * td, roundTripUI: 2 * td / ui,
        gammaLoad: M.GL, gammaSource: M.GS, echo: M.GL * M.GS, settledSwing: swing,
        worstSampleError: worst
      },
      generated: { wave, ideal, samples, pattern: PATTERN, end }
    });
  };

  NS.models.ucie.RATES = RATES;
  NS.models.ucie.shoreline = shoreline;
  NS.models.ucie.TPD = TPD;
})();
