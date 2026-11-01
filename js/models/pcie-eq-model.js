/* SI & PI — models/pcie-eq-model.js
 * PCIe 4.0 and 5.0 link equalisation: a channel built from the four places the
 * decibels go, a transmitter preset, a reference-style receiver, and the eye that
 * results. Then the same for every preset, which is what Phases 2 and 3 do.
 *
 *   channel     K.channelImpulse at the total loss at Nyquist (two-term law,
 *               minimum phase), the same model every other panel uses
 *   transmitter 3-tap FIR from the preset table (C-136): the pulse launched for
 *               one bit is c₋₁ one UI early, c₀ on time and c₊₁ one UI late
 *   receiver    K.ctle at a DC gain of −6 … −12 dB (Gen 4) or −5 … −15 dB
 *               (Gen 5) in 1 dB steps, 7 and 11 settings (C-138, C-197); then a
 *               DFE of 2 or 3 taps, each clipped to its limit in mV (C-138)
 *   eye         peak distortion: the worst any pattern can do at each sampling
 *               phase, with the DFE's taps fixed at the chosen sampling point
 *
 * The whole chain is linear, so the receiver's pulse response for a preset is the
 * shaped sum of three shifted copies of the pulse response for no preset. A sweep
 * over ten presets and eleven CTLE settings therefore costs eleven CTLE passes,
 * not a hundred and ten.
 *
 * What this is not: the CTLE is the kit's one-zero, two-pole peaking filter set to
 * the reference DC gains, not the Base specification's pole and zero placement
 * (Gen 5's has four poles and two zeros); there is no noise, jitter or crosstalk;
 * and the eye is the worst-case bound, not an extrapolation to 1e-12. Compliance
 * is SigTest and Seasim against the Base specification, not this.
 *
 * Units: dB, inches, volts, UI. Frequencies are normalised to Nyquist inside the
 * channel and CTLE, as the kit expects.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  NS.models = NS.models || {};
  const K = NS.kit;

  const SPS = 32, NFFT = 4096;
  const SWING = 0.8;                      // V, differential peak-to-peak at full swing (C-198, its low end)
  const A = SWING / 2;                    // each symbol is ±A before shaping
  const TR_UI = 0.2;                      // the launch edge, as a share of the UI
  const TARGET = { eh: 0.015, ew: 0.3 };  // TI's tabulated minimum after EQ (C-135)

  /* Where the decibels go, as TI allocates them (C-134), and the reference
     receiver of each generation (C-138, C-197). The board figure is TI's 9 in. */
  const GENS = {
    4: { rate: 16, fN: 8, budget: 28, pkg: 5, conn: 0.5, card: 8.5, boardTI: 14,
      ctle: [6, 7, 8, 9, 10, 11, 12], dfe: [0.030, 0.020] },
    5: { rate: 32, fN: 16, budget: 36, pkg: 9, conn: 1.5, card: 9.5, boardTI: 16,
      ctle: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], dfe: [0.080, 0.020, 0.020] }
  };

  /* P0 to P9 as the page tabulates them (C-136). P10's de-emphasis is set by the
     receiver's advertised LF level, so it has no fixed taps and is not swept. */
  const PRESETS = [
    [0, 0.750, -0.250], [0, 0.834, -0.166], [0, 0.801, -0.199], [0, 0.875, -0.125],
    [0, 1, 0], [-0.098, 0.902, 0], [-0.125, 0.875, 0],
    [-0.100, 0.701, -0.200], [-0.125, 0.751, -0.125], [-0.166, 0.834, 0]
  ];

  /* The shape of the two-term loss law, as a share of its value at a reference
     frequency: 35% skin effect (√f) and 65% dielectric (f), the kit's split. */
  const lawShare = (x) => 0.35 * Math.sqrt(x) + 0.65 * x;

  /* The four segments at this generation's Nyquist. The board is the reader's:
     its laminate is given as dB per inch at 16 GHz and scaled to 8 GHz by the same
     law the channel model uses, so one board is one board at either rate. */
  function segments(cfg) {
    const G = GENS[cfg.gen];
    const board = cfg.len * cfg.dbIn * lawShare(G.fN / 16);
    return { pkg: G.pkg, board, conn: G.conn, card: G.card, total: G.pkg + board + G.conn + G.card };
  }

  /* Insertion loss at f (GHz) for a channel whose loss at Nyquist is L. */
  const ilAt = (L, f, fN) => L * lawShare(f / fN);

  /* Receiver pulse response for no preset, one per CTLE setting. Cached on the
     loss alone: the generation only picks which settings are asked for. */
  const cache = new Map();
  function rxPulses(total, boosts) {
    const key = total.toFixed(4);
    let row = cache.get(key);
    if (!row) {
      // the pulse first and the CTLE on it: both are linear, so this is the same
      // response as CTLE-then-pulse at one convolution instead of eleven
      row = { p: K.pulseResponse(K.channelImpulse(total, SPS, NFFT), SPS, TR_UI).sbr, byBoost: new Map() };
      if (cache.size > 24) cache.delete(cache.keys().next().value);
      cache.set(key, row);
    }
    return boosts.map((b) => {
      let p = row.byBoost.get(b);
      if (!p) { p = b > 0 ? K.ctle(row.p, b, SPS, NFFT) : row.p; row.byBoost.set(b, p); }
      return p;
    });
  }

  /* Shape a pulse response by the preset: c₋₁ launched one UI before the bit, c₊₁
     one UI after. Padded by a UI each side so the pre-cursor copy has room. */
  function shape(p, taps) {
    const n = p.length + 2 * SPS, q = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const j = i - SPS;                                  // q is p delayed by one UI
      const at = (k) => (k >= 0 && k < p.length ? p[k] : 0);
      q[i] = taps[0] * at(j + SPS) + taps[1] * at(j) + taps[2] * at(j - SPS);
    }
    return q;
  }

  /* Peak-distortion eye of one pulse response, in volts and UI.
     At a sampling point s, the main cursor is A·q[s]; every other UI-spaced sample
     A·q[s + kT] is ISI that some pattern lines up against it. The DFE subtracts a
     constant from each of the first N post-cursors, the value it measured at s
     clipped to its limit; away from s the waveform moves and the DFE does not.
     Height at phase s+δ is 2·(main − Σ|residual ISI|). The sampling point is the
     one with the tallest eye; the width is the span about it where the height
     stays at or above the target. */
  function eye(q, dfeLims) {
    const n = q.length, T = SPS;
    const heightAt = (s, d) => {
      let isi = 0;
      for (let k = s % T; k < n; k += T) {
        if (k === s) continue;
        const m = Math.round((k - s) / T);
        let v = A * q[k];
        if (m >= 1 && m <= d.length) v -= d[m - 1];
        isi += Math.abs(v);
      }
      return 2 * (A * q[s] - isi);
    };
    const tapsAt = (s) => dfeLims.map((lim, i) => {
      const k = s + (i + 1) * T, v = k < n ? A * q[k] : 0;
      return Math.max(-lim, Math.min(lim, v));
    });
    // the tallest eye sits within a UI of the pulse's peak; nowhere else has a
    // main cursor large enough to compete
    let pk = 0;
    for (let i = 1; i < n; i++) if (q[i] > q[pk]) pk = i;
    let best = -Infinity, s0 = pk, dfe = [];
    for (let s = Math.max(0, pk - T); s <= Math.min(n - 1, pk + T); s++) {
      if (q[s] <= 0) continue;
      const d = tapsAt(s), h = heightAt(s, d);
      if (h > best) { best = h; s0 = s; dfe = d; }
    }
    // the eye's profile across one UI either side, taps held at s0
    const prof = new Float64Array(2 * T + 1);
    for (let i = -T; i <= T; i++) {
      const s = s0 + i;
      prof[i + T] = s >= 0 && s < n ? heightAt(s, dfe) : -Infinity;
    }
    let lo = T, hi = T;
    if (prof[T] >= TARGET.eh) {
      while (lo > 0 && prof[lo - 1] >= TARGET.eh) lo--;
      while (hi < 2 * T && prof[hi + 1] >= TARGET.eh) hi++;
    }
    const width = prof[T] >= TARGET.eh ? (hi - lo + 1) / T : 0;
    return { height: best, width, s0, dfe, profile: prof };
  }

  /* One preset, one generation: try every CTLE setting the receiver has and keep
     the best eye, which is what the receiver does while the far end tunes it. A
     fixed setting (ci ≥ 0) skips the search. */
  function evaluate(cfg, preset, ci, pulses) {
    const G = GENS[cfg.gen], taps = PRESETS[preset];
    const lims = cfg.dfe === false ? [] : G.dfe;
    const P = pulses || rxPulses(segments(cfg).total, G.ctle);
    let best = null;
    G.ctle.forEach((b, i) => {
      if (ci >= 0 && i !== ci) return;
      const q = shape(P[i], taps), E = eye(q, lims);
      if (!best || E.height > best.height) best = Object.assign({ ctle: i, boost: b, q }, E);
    });
    return best;
  }

  /* Phases 2 and 3, compressed: every fixed preset, each with its best CTLE. */
  function sweep(cfg) {
    const G = GENS[cfg.gen], P = rxPulses(segments(cfg).total, G.ctle);
    const rows = PRESETS.map((_, i) => evaluate(cfg, i, -1, P));
    let win = 0;
    rows.forEach((r, i) => {
      const w = rows[win];
      if (r.height > w.height || (r.height === w.height && r.width > w.width)) win = i;
    });
    return { rows, win };
  }

  function analyse(cfg) {
    const G = GENS[cfg.gen], seg = segments(cfg);
    const P = rxPulses(seg.total, G.ctle);
    const S = sweep(cfg);
    const mine = evaluate(cfg, cfg.preset, cfg.ctle === undefined ? -1 : cfg.ctle, P);
    return { G, seg, sweep: S, mine };
  }

  /* A PRBS stretch through the shaped pulse, for drawing the eye's traces. Linear
     superposition of the pulse at every bit, with the same clipped DFE taps
     subtracted after each decided bit (decisions are the sent bits: this draws
     the waveform, it does not test the slicer). */
  function traces(q, s0, dfe, nb) {
    // a warm-up as long as the pulse, so every drawn bit has its whole history
    const n = nb || 200, T = SPS, warm = Math.ceil(q.length / T);
    let st = 0x5a; const bits = [];
    for (let i = 0; i < n + warm; i++) { const b = ((st >> 6) ^ (st >> 5)) & 1; st = ((st << 1) | b) & 0x7f; bits.push(b ? 1 : -1); }
    const len = (n + warm) * T, y = new Float64Array(len);
    for (let b = 0; b < bits.length; b++) {
      const t0 = b * T - s0;
      for (let k = 0; k < q.length; k++) {
        const i = t0 + k;
        if (i >= 0 && i < len) y[i] += A * bits[b] * q[k];
      }
      // the DFE: after bit b is decided, subtract its tap from each of the next
      // bits' whole UI, centred on their sampling instants
      for (let m = 1; m <= dfe.length; m++) {
        const c = (b + m) * T;
        for (let i = c - T / 2; i < c + T / 2; i++) if (i >= 0 && i < len) y[i] -= dfe[m - 1] * bits[b];
      }
    }
    return { y, bits, T, from: warm };
  }

  NS.models.pcieEq = { SPS, NFFT, SWING, A, TR_UI, TARGET, GENS, PRESETS, lawShare, segments, ilAt, rxPulses, shape, eye, evaluate, sweep, analyse, traces };
})();
