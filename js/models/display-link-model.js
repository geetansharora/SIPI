/* SI & PI — models/display-link-model.js
 * Will it train? A display link built from the places its decibels go: the
 * source's package and board, a mated connector, the cable, the second
 * connector, the sink's board and package. At each rate the protocol offers,
 * the loss at that rate's Nyquist is compared with the budget for that rate;
 * the link trains at the highest rate whose every segment fits, stepping down
 * the way link training does (C-206), and carries lanes × rate × coding.
 *
 *   board     NS.calc.loss: dielectric plus conductor loss with roughness for a
 *             5 mil, 50 Ω trace (one side of a 100 Ω pair), the laminate's own
 *             published Dk and Df at each frequency (js/models/laminates.js)
 *   cable     a two-wire line of the gauge's diameter at 100 Ω, exact for its
 *             geometry: R' = 2 Rs/(π d) · s/√(s² − 1), s = D/d from
 *             Z = (120/√Dk) acosh(D/d); the second factor is the proximity
 *             effect of two round wires. Plus π f √Dk Df / c in the insulation.
 *             A bare pair has no shield, drain or plating, so it is a floor; the
 *             conductor term is scaled by the factor that makes 6.8 in of 30 AWG
 *             twinax lose 2.2 dB at 53.125 GHz, a worked example contributed to
 *             IEEE 802.3dj (C-118). One factor for every gauge and length
 *   package,  ILLUSTRATIVE allowances at 10 GHz, scaled with frequency by the
 *   connector two-term law the channel pages use; no public figure exists
 *   retimer   a link-training tunable repeater (LTTPR) recovers the data and
 *             sends it again, so each side of it is a segment with the whole
 *             budget to itself; it adds a package of its own to each
 *
 * Budgets are die to die at each rate's Nyquist: UHBR10, 13.5 and 20 from a
 * PHY vendor's summary of the specification (C-205); HBR3 from the 22 to 24 dB
 * stress channel a DisplayPort 1.4 sink is calibrated against (C-207), its low
 * end taken. RBR, HBR and HBR2 have no public figure and are given HBR3's,
 * labelled so: at their lower Nyquist frequencies they are never the binding
 * rate on any path this panel can build.
 *
 * HDMI: FRL at 3 and 6 Gb/s on three lanes and 6, 8, 10 and 12 Gb/s on four,
 * 16b/18b, the TMDS clock lane reused as FRL lane 3 (C-212, C-214); below them
 * the TMDS rates of HDMI 2.0 and 1.4b, three data lanes of 8b/10b beside a clock
 * lane, which a link falls back to when FRL training fails (C-212). FRL 12G's
 * budget is the 20.18 dB worst-case cable test channel a PHY vendor calibrates
 * its sink against (C-213), taken as 20 dB; the other HDMI rates have no public
 * figure and are given the same, labelled so. Each HDMI rate fixes its own lane
 * count, so the reader's lane choice applies to DisplayPort only.
 *
 * What this is not: a loss budget is not an eye. There is no reflection,
 * crosstalk or jitter here; a path that fits its budget can still fail on a
 * connector's return loss, and one that misses by a decibel can still train on
 * a receiver better than the reference. Compliance is the VESA or HDMI test
 * specification, not this.
 *
 * Units: Hz inside, GHz at the edges; dB; inches for boards, metres for cables.
 */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const NS = (root.SIPI = root.SIPI || { viz: {} });
  NS.models = NS.models || {};

  const C0 = 299792458, DB = 20 / Math.LN10;

  /* The two-term law's shape as a share of its value at f0: 35% √f, 65% f. */
  const lawShare = (x) => 0.35 * Math.sqrt(x) + 0.65 * x;

  /* Illustrative allowances at 10 GHz. */
  const PKG10 = 1.5, CONN10 = 0.7;

  /* The board trace: 5 mil, 50 Ω, Rq 0.5 µm, on the chosen laminate. */
  const TRACE = { w: 5, z0: 50, rq: 0.5 };
  const LAMINATES = ['isola-370hr', 'megtron4', 'megtron6n'];

  /* The cable: insulation Dk and Df, illustrative (a polyolefin or fluoropolymer
     sits near these); the insulation is a small share of the loss either way. */
  const CABLE = { z: 100, dk: 2.1, df: 3e-4 };
  const awgD = (n) => 0.127e-3 * Math.pow(92, (36 - n) / 39);            // m, the AWG definition

  function boardDb(f, lenIn, lam) {
    if (!(f > 0) || !(lenIn > 0)) return 0;
    const L = NS.laminates.at(lam, f);
    return NS.calc.loss(f, lenIn, L.dk, L.df, TRACE.w, TRACE.z0, TRACE.rq).total;
  }

  /* The bare pair's two terms in nepers per metre at f. `prox` false drops the
     proximity factor (for the gate's limit check). */
  function pairNp(f, awg, prox) {
    const d = awgD(awg), s = Math.cosh(CABLE.z * Math.sqrt(CABLE.dk) / 120);
    const rs = NS.calc.skin(f, 1e4, 0).rs;                                // Ω per square, thick copper
    const k = prox === false ? 1 : s / Math.sqrt(s * s - 1);
    const rPair = 2 * rs / (Math.PI * d) * k;                             // Ω/m, both wires
    return { ac: rPair / (2 * CABLE.z), ad: Math.PI * f * Math.sqrt(CABLE.dk) * CABLE.df / C0 };
  }

  /* The construction factor on the conductor term, from C-118's twinax. */
  const CAL = { f: 53.125e9, awg: 30, m: 6.8 * 0.0254, db: 2.2 };
  const CAB_K = (function () {
    const q = pairNp(CAL.f, CAL.awg);
    return (CAL.db / (CAL.m * DB) - q.ad) / q.ac;
  })();

  /* dB per metre of the cable of gauge `awg` at f. `bare` true gives the
     unscaled two-wire floor. */
  function cablePerM(f, awg, bare) {
    if (!(f > 0)) return 0;
    const q = pairNp(f, awg);
    return ((bare ? 1 : CAB_K) * q.ac + q.ad) * DB;
  }

  const pkgDb = (f) => PKG10 * lawShare(f / 10e9);
  const connDb = (f) => CONN10 * lawShare(f / 10e9);

  /* The path as segments of elements. A retimer splits it in two. */
  function segments(cfg) {
    const src = [{ k: 'pkg', name: 'source package' }, { k: 'board', name: 'source board', len: cfg.srcIn }];
    const mid = [{ k: 'conn', name: 'connector' }, { k: 'cable', name: 'cable', m: cfg.cableM }, { k: 'conn', name: 'connector' }];
    const snk = [{ k: 'board', name: 'sink board', len: cfg.sinkIn }, { k: 'pkg', name: 'sink package' }];
    const rt = { k: 'pkg', name: 'retimer package' };
    if (cfg.retimer === 'source') return [src.concat([rt]), [rt].concat(mid, snk)];
    if (cfg.retimer === 'sink') return [src.concat(mid, [rt]), [rt].concat(snk)];
    return [src.concat(mid, snk)];
  }

  function elementDb(e, f, cfg) {
    if (e.k === 'pkg') return pkgDb(f);
    if (e.k === 'conn') return connDb(f);
    if (e.k === 'board') return boardDb(f, e.len, cfg.lam);
    if (e.k === 'cable') return cablePerM(f, cfg.awg) * e.m;
    return 0;
  }
  const segmentDb = (seg, f, cfg) => seg.reduce((a, e) => a + elementDb(e, f, cfg), 0);

  /* ---------- protocols ---------- */
  const PROTOCOLS = {
    dp: {
      name: 'DisplayPort',
      lanes: [4, 2],
      rates: [
        { id: 'RBR', gbps: 1.62, code: [8, 10], budget: 22, assumed: true },
        { id: 'HBR', gbps: 2.7, code: [8, 10], budget: 22, assumed: true },
        { id: 'HBR2', gbps: 5.4, code: [8, 10], budget: 22, assumed: true },
        { id: 'HBR3', gbps: 8.1, code: [8, 10], budget: 22 },
        { id: 'UHBR10', gbps: 10, code: [128, 132], budget: 23 },
        { id: 'UHBR13.5', gbps: 13.5, code: [128, 132], budget: 21 },
        { id: 'UHBR20', gbps: 20, code: [128, 132], budget: 22.5 }
      ]
    },
    hdmi: {
      name: 'HDMI',
      lanes: null,
      rates: [
        { id: 'TMDS 3.4G', gbps: 3.4, lanes: 3, clock: true, code: [8, 10], budget: 20, assumed: true },
        { id: 'TMDS 6G', gbps: 6, lanes: 3, clock: true, code: [8, 10], budget: 20, assumed: true },
        { id: 'FRL 3G ×3', gbps: 3, lanes: 3, code: [16, 18], budget: 20, assumed: true },
        { id: 'FRL 6G ×3', gbps: 6, lanes: 3, code: [16, 18], budget: 20, assumed: true },
        { id: 'FRL 6G ×4', gbps: 6, lanes: 4, code: [16, 18], budget: 20, assumed: true },
        { id: 'FRL 8G ×4', gbps: 8, lanes: 4, code: [16, 18], budget: 20, assumed: true },
        { id: 'FRL 10G ×4', gbps: 10, lanes: 4, code: [16, 18], budget: 20, assumed: true },
        { id: 'FRL 12G ×4', gbps: 12, lanes: 4, code: [16, 18], budget: 20 }
      ]
    }
  };

  const nyquist = (r) => r.gbps * 1e9 / 2;                                // Hz, NRZ
  /* Data lanes × rate × coding. An HDMI rate fixes its own lane count; a TMDS
     clock lane carries no data. */
  const lanesOf = (r, lanes) => r.lanes || lanes;
  const payload = (r, lanes) => lanesOf(r, lanes) * r.gbps * r.code[0] / r.code[1];   // Gb/s

  /* Every rate up to the cap, highest first, each with every segment's loss at
     its Nyquist and whether all of them fit. The trained rate is the first that
     fits; null when none does (training ends with no link). */
  function train(cfg) {
    const P = PROTOCOLS[cfg.proto], segs = segments(cfg);
    const ladder = [];
    for (let i = Math.min(cfg.cap, P.rates.length - 1); i >= 0; i--) {
      const r = P.rates[i], f = nyquist(r);
      const losses = segs.map((s) => segmentDb(s, f, cfg));
      const worst = Math.max(...losses);
      ladder.push({ i, rate: r, f, losses, worst, margin: r.budget - worst, ok: worst <= r.budget });
    }
    const hit = ladder.find((x) => x.ok) || null;
    return { segs, ladder, trained: hit, payload: hit ? payload(hit.rate, cfg.lanes) : 0 };
  }

  /* Loss of each segment over a frequency grid, for the chart. */
  function curves(cfg, fMax, n) {
    const segs = segments(cfg);
    return segs.map((s) => {
      const out = [];
      for (let k = 0; k <= n; k++) { const f = fMax * k / n; out.push([f / 1e9, segmentDb(s, f, cfg)]); }
      return out;
    });
  }

  /* The video arithmetic: frames a second of w × h at bpp bits a pixel that the
     payload carries, active pixels only: no blanking, no compression. */
  const maxRefresh = (gbps, w, h, bpp) => gbps * 1e9 / (w * h * bpp);

  NS.models.displayLink = { PROTOCOLS, LAMINATES, PKG10, CONN10, TRACE, CABLE, CAL, CAB_K, lawShare, awgD,
    boardDb, pairNp, cablePerM, pkgDb, connDb, segments, segmentDb, nyquist, lanesOf, payload, train, curves, maxRefresh };
})();
