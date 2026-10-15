/* SI & PI — models/ethernet-model.js
 * 112G against 224G Ethernet on the same board trace. 802.3ck signals PAM4 at
 * 53.125 GBd (C-106) and the 802.3dj draft at 106.25 GBd (C-115), so their Nyquist
 * frequencies are 26.5625 and 53.125 GHz. The model asks one question: what does
 * doubling the rate cost on a trace you already have?
 *
 * Loss per inch comes from the site's laminate loss model, calc-models.js C.loss:
 * dielectric loss grows as f * Df, conductor loss as sqrt(f) times the roughness
 * factor. Dk and Df come from js/models/laminates.js, the manufacturers' published
 * values at each frequency, so a laminate whose Df rises with frequency costs more
 * than the textbook factor of 2. The trace is one leg of a 90 ohm pair: 6 mil wide,
 * 45 ohm odd mode (the geometry of ledger C-119).
 *
 * Reach is a budget in dB divided by the loss per inch at each Nyquist.
 *
 * The pulse responses use the site's shared channel model, K.channelImpulse and
 * K.singleBit, with the trace's loss at each rate's own Nyquist. Only that loss
 * comes from the laminate; the shape of the loss with frequency is the kit's own
 * fixed split, so the pulses are a picture of the mechanism, not of this laminate.
 *
 * Pure: no DOM, no state. Requires js/viz-kit.js, js/models/calc-models.js and
 * js/models/laminates.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || {});
  const K = NS.kit;
  NS.models = NS.models || {};

  const BAUD = { g112: 53.125e9, g224: 106.25e9 };        // C-106, C-115
  const NYQ = { g112: BAUD.g112 / 2, g224: BAUD.g224 / 2 };
  const W_MIL = 6, Z0 = 45;                               // C-119: 90 ohm pair, 6 mil
  const SPS = 32, NFFT = 4096;

  /* Dk and Df at f: a laminate from the list, or { dk, df } given directly. */
  function material(lam, f) {
    if (lam && typeof lam === 'object') return { dk: lam.dk, df: lam.df, f, clamped: false };
    return NS.laminates.at(lam, f);
  }
  function perInch(lam, f, rq) {
    const m = material(lam, f);
    const r = NS.calc.loss(f, 1, m.dk, m.df, W_MIL, Z0, rq);
    return { per: r.per, ac: r.ac, ad: r.ad, dk: m.dk, df: m.df, clamped: m.clamped, fData: m.f };
  }
  /* One rate's single-bit response through a trace losing `lossDb` at that rate's
     Nyquist, sampled once per unit interval either side of the cursor. */
  function pulse(lossDb, baud) {
    const h = K.channelImpulse(lossDb, SPS, NFFT), sb = K.singleBit(h, SPS);
    const ui = 1e12 / baud, dt = ui / SPS;
    const pts = [], marks = [];
    for (let i = 0; i < sb.sbr.length; i++) pts.push([(i - sb.cursor) * dt, sb.sbr[i]]);
    let isi = 0;
    for (let k = -3; k <= 40; k++) {
      const j = sb.cursor + k * SPS;
      if (j < 0 || j >= sb.sbr.length) continue;
      marks.push([k * ui, sb.sbr[j]]);
      if (k) isi += Math.abs(sb.sbr[j]);
    }
    return { pts, marks, height: sb.peak, isi, ui };
  }

  const okNum = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;

  NS.models.ethernet = function (p) {
    const lamOk = p && (typeof p.lam === 'object'
      ? okNum(p.lam.dk, 1, 10) && okNum(p.lam.df, 0, 0.1)
      : !!(NS.laminates && NS.laminates.byId[p.lam]));
    const ok = lamOk && okNum(p.rq, 0, 5) && okNum(p.len, 0.1, 60) && okNum(p.budget, 1, 80);
    if (!ok) return K.result({ model: 'ethernet', version: '1.0', status: 'unsupported', params: p,
      why: 'Needs a laminate from the list (or Dk 1-10 and Df 0-0.1), roughness 0-5 um, a length of 0.1-60 in and a budget of 1-80 dB.' });

    const a = perInch(p.lam, NYQ.g112, p.rq), b = perInch(p.lam, NYQ.g224, p.rq);
    const curve = [];
    for (let f = 1e9; f <= 60e9 + 1; f += 1e9) {
      const q = perInch(p.lam, f, p.rq);
      curve.push([f / 1e9, q.per, q.ad]);
    }
    const loss112 = a.per * p.len, loss224 = b.per * p.len;
    const want = p.pulses !== false;
    return K.result({
      model: 'ethernet', version: '1.0', status: 'ok', params: p,
      units: { per: 'dB/in', loss: 'dB', reach: 'in', f: 'GHz', t: 'ps' },
      measurements: {
        nyq112: NYQ.g112, nyq224: NYQ.g224,
        per112: a.per, per224: b.per, ratio: b.per / a.per,
        dielShare112: a.ad / a.per, dielShare224: b.ad / b.per,
        loss112, loss224,
        reach112: p.budget / a.per, reach224: p.budget / b.per, reachRatio: a.per / b.per,
        clamped: a.clamped || b.clamped, dataAt: [a.fData, b.fData],
        material112: { dk: a.dk, df: a.df }, material224: { dk: b.dk, df: b.df }
      },
      generated: {
        curve,
        pulse112: want ? pulse(loss112, BAUD.g112) : null,
        pulse224: want ? pulse(loss224, BAUD.g224) : null
      }
    });
  };
  NS.models.ethernet.BAUD = BAUD;
  NS.models.ethernet.NYQ = NYQ;
  NS.models.ethernet.perInch = perInch;
})();
