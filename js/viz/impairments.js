/* SI & PI — viz/impairments.js
 * Four channel impairments, one eye, and a real interface behind it.
 *
 *   IL        two-term loss law, as everywhere else on this site
 *   TDR       a short mismatched section, cascaded exactly:
 *               r = Z1/Z0,  θ = ωτ
 *               S21 = 2 / (2cosθ + j·sinθ·(r + 1/r))
 *               S11 = j·sinθ·(r − 1/r) / (same denominator)
 *   RL        NOT a control — an outcome. Termination mismatch and the
 *             discontinuity both reflect; the panel reports the resulting return
 *             loss. The echo train follows from it:
 *               H_total = H / (1 − Γs·ΓL·H²·e^(−j2ωTd))
 *             which is why the round-trip delay matters as much as the magnitude:
 *             at 3 UI the echo is ISI, at 100 UI it is re-attenuated to nothing.
 *   crosstalk N independent aggressors, each contributing a FEXT pulse scaled so
 *             its peak is the coupling coefficient times the aggressor swing.
 *
 * The sensitivity readout re-runs the whole chain with each impairment removed in
 * turn, which is the question an engineer actually has: which one is costing me?
 *
 * Requires js/viz-kit.js.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;
  const SPS = 32, NFFT = 4096, NB = 420, SKIP = 24, SWING = 0.8;
  const MEM_UI = NFFT / SPS;            // 128 UI of channel memory

  /* Representative values, not spec citations: a starting point for each
     interface, close enough that the trade-offs land honestly. */
  const IFACES = {
    lpddr5x: { label: 'LPDDR5X 8533', rate: 8533e6, il: 2.5, rterm: 44, rsrc: 40, dz: 42, dps: 12,
               nagg: 4, coup: 0.045, tdps: 171, eq: 0,
               note: 'A 25 mm point-to-point channel. Almost no loss — but sixteen neighbours, and the echo comes back after under 3 UI, so it lands as ISI rather than dying away.' },
    pcie4:   { label: 'PCIe Gen 4', rate: 16e9, il: 18, rterm: 48, rsrc: 47, dz: 45, dps: 15,
               nagg: 2, coup: 0.02, tdps: 1736, eq: 1,
               note: 'Ten inches plus a connector. Loss dominates and the equaliser is doing most of the work; the echo returns 55 UI later, re-attenuated to nothing.' },
    pcie5:   { label: 'PCIe Gen 5', rate: 32e9, il: 28, rterm: 48, rsrc: 47, dz: 45, dps: 15,
               nagg: 2, coup: 0.02, tdps: 1736, eq: 1,
               note: 'The same board at twice the rate. 28 dB at 16 GHz, and the connector discontinuity now sits well inside the band.' },
    usb32:   { label: 'USB 3.2 Gen 2', rate: 10e9, il: 12, rterm: 42, rsrc: 45, dz: 40, dps: 20,
               nagg: 1, coup: 0.015, tdps: 5000, eq: 1,
               note: 'A metre of user-supplied cable and two Type-C launches. The footprint is the worst discontinuity on the board and you do not get to change it.' },
    ufs4:    { label: 'UFS 4.0 HS-G5', rate: 23.2e9, il: 8, rterm: 46, rsrc: 46, dz: 44, dps: 10,
               nagg: 3, coup: 0.03, tdps: 273, eq: 1,
               note: 'Short but fast, inside a handset. The escape is the whole problem — and the neighbours are LPDDR and a camera interface, unrelated to your data.' }
  };

  function lfsr(n, seed) {
    let s = seed || 0x4a1;
    const b = new Int8Array(n);
    for (let i = 0; i < n; i++) { const x = ((s >> 14) ^ (s >> 13)) & 1; s = ((s << 1) | x) & 0x7fff; b[i] = s & 1; }
    return b;
  }
  function shape(levels, tr) {
    const n = levels.length * SPS, x = new Float64Array(n), trs = Math.max(1, tr * SPS);
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(i / SPS);
      const prev = idx > 0 ? levels[idx - 1] : levels[0], cur = levels[idx];
      const u = (i - idx * SPS) / trs;
      const a = (u >= 1 || prev === cur) ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, u)));
      x[i] = prev + (cur - prev) * a;
    }
    return x;
  }
  function conv(x, h) {
    const y = new Float64Array(x.length);
    for (let i = 0; i < x.length; i++) {
      let s = 0; const kmax = Math.min(h.length, i + 1);
      for (let k = 0; k < kmax; k++) s += h[k] * x[i - k];
      y[i] = s;
    }
    return y;
  }
  const gamma = (z, z0) => (z - z0) / (z + z0);

  /* ───────── one network, everything derived from it ─────────

     Topology, between 50 ohm reference planes:

        source (Rsrc) ──[ lossy line, Td/2 ]──[ Z1 over tau ]──[ lossy line, Td/2 ]── load (Rterm)

     Forward path       S21 = H_loss(f) . S21_disc(f)
     Through-section    S21_disc = 2 / (2cos0 + j(r + 1/r)sin0),  r = Z1/Z0, 0 = w.tau
                        S11_disc = j(r - 1/r)sin0 / (same denominator)
     Input reflection   S11_in = S11_disc.e^(-jwTd) + S21_disc^2 . GL . H_loss^2 . e^(-j2wTd)
     Round trip         the wave reflects at the LOAD and again at the SOURCE, so the
                        echo coefficient is Gs.GL — not GL^2. A matched source does
                        not re-reflect a returning wave however bad the load is.

     Return loss and the TDR trace both come from S11_in, so the frequency view and
     the time view describe the same channel instead of one being a sketch drawn
     beside the other. */
  function shapeChannel(h, p, use) {
    const n = NFFT;
    const uiPs = 1e12 / p.rate;
    const tdUI = p.tdps / uiPs;                       // one-way, in UI
    const gL = use.rl ? gamma(p.rterm, 50) : 0;
    const gS = use.rl ? gamma(p.rsrc, 50) : 0;
    const r = p.dz / 50, tauUI = use.tdr ? (p.dps / uiPs) : 0;

    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < Math.min(h.length, n); i++) re[i] = h[i];
    K.fft(re, im, false);                              // H_loss(f)

    const lr = Float64Array.from(re), li = Float64Array.from(im);   // keep H_loss
    const s11r = new Float64Array(n), s11i = new Float64Array(n);
    let worstS11 = 0;

    for (let k = 0; k <= n / 2; k++) {
      const fN = 2 * k * SPS / n;                      // f / f_Nyquist
      const w = Math.PI * fN;                          // omega, in UI^-1
      let hr = re[k], hi = im[k];
      let t21r = 1, t21i = 0, d11r = 0, d11i = 0;

      if (tauUI > 0) {                                 // exact ABCD of the section
        const th = w * tauUI, c = Math.cos(th), sn = Math.sin(th);
        const dr = 2 * c, di = sn * (r + 1 / r);
        const den = dr * dr + di * di;
        t21r = 2 * dr / den; t21i = -2 * di / den;
        const ni = sn * (r - 1 / r);                   // S11 numerator is pure imaginary
        d11r = (ni * di) / den; d11i = (ni * dr) / den;
        const a = hr * t21r - hi * t21i, b = hr * t21i + hi * t21r;
        hr = a; hi = b;
      }
      re[k] = hr; im[k] = hi;
      if (k > 0 && k < n / 2) { re[n - k] = hr; im[n - k] = -hi; }

      /* S11 seen from the source: the discontinuity's own reflection, delayed by
         its position, plus the load's reflection returning through the whole
         channel twice. First order in the reflection coefficients. */
      const ph1 = -w * tdUI, ph2 = -2 * w * tdUI;
      const c1 = Math.cos(ph1), sp1 = Math.sin(ph1);
      const c2 = Math.cos(ph2), sp2 = Math.sin(ph2);
      const ar = d11r * c1 - d11i * sp1, ai = d11r * sp1 + d11i * c1;
      // S21_disc^2 . H_loss^2 . GL
      const q1r = t21r * lr[k] - t21i * li[k], q1i = t21r * li[k] + t21i * lr[k];
      const q2r = q1r * q1r - q1i * q1i, q2i = 2 * q1r * q1i;
      const br = gL * (q2r * c2 - q2i * sp2), bi = gL * (q2r * sp2 + q2i * c2);
      const tr = ar + br, ti = ai + bi;
      s11r[k] = tr; s11i[k] = ti;
      if (k > 0 && k < n / 2) { s11r[n - k] = tr; s11i[n - k] = -ti; }
      if (fN <= 2.2) worstS11 = Math.max(worstS11, Math.hypot(tr, ti));   // in-band only
    }

    /* The echo path: down, back, down again — three crossings of the channel, so
       H_loss^2 more than the direct path, scaled by Gs.GL. */
    const er = Float64Array.from(re), ei = Float64Array.from(im);
    for (let k = 0; k <= n / 2; k++) {
      const l2r = lr[k] * lr[k] - li[k] * li[k], l2i = 2 * lr[k] * li[k];
      const ar = re[k] * l2r - im[k] * l2i, ai = re[k] * l2i + im[k] * l2r;
      er[k] = ar; ei[k] = ai;
      if (k > 0 && k < n / 2) { er[n - k] = ar; ei[n - k] = -ai; }
    }

    // S11 back to time, for the TDR
    const tr_ = Float64Array.from(s11r), ti_ = Float64Array.from(s11i);
    K.fft(tr_, ti_, true);
    K.fft(re, im, true);
    K.fft(er, ei, true);

    const cut = (arr) => {
      let energy = 0;
      for (let i = 0; i < n; i++) energy += arr[i] * arr[i];
      let acc = 0, len = Math.min(n, SPS * 24);
      for (let i = 0; i < n; i++) {
        acc += arr[i] * arr[i];
        if (acc > 0.9999 * energy) { len = Math.min(n, i + 2); break; }
      }
      return arr.slice(0, Math.max(SPS * 2, len));
    };

    return {
      h: cut(re),
      hEcho: cut(er),
      gEcho: gS * gL,                                  // Gs.GL, not GL^2
      echoSamples: Math.round(2 * tdUI * SPS),
      s11Imp: tr_,                                     // impulse response of S11_in
      rlDb: worstS11 > 1e-9 ? -20 * Math.log10(worstS11) : Infinity,
      echoUI: 2 * tdUI,
      echoOK: Math.abs(gS * gL) > 1e-9 && Math.round(2 * tdUI * SPS) < NB * SPS * 0.5
    };
  }

  /* TDR: the step response of S11_in, converted to impedance.
       rho(t) = integral of the S11 impulse response, band-limited by the step edge
       Z(t)   = Z0 (1 + rho) / (1 - rho)
     This is what an instrument actually does, so the finite edge shows up as
     limited spatial resolution rather than being absent from an idealised sketch. */
  function tdrTrace(s11Imp, sps, trSamples, nOut) {
    const N = Math.min(s11Imp.length, nOut);
    const k = Math.max(1, Math.round(trSamples));
    const step = new Float64Array(N);                  // raised-cosine edge
    for (let i = 0; i < N; i++) {
      const u = i / k;
      step[i] = u >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * u);
    }
    const out = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      let acc = 0;
      const kmax = Math.min(s11Imp.length, i + 1);
      for (let j = 0; j < kmax; j++) acc += s11Imp[j] * step[i - j];
      const rho = Math.max(-0.98, Math.min(0.98, acc));
      out[i] = 50 * (1 + rho) / (1 - rho);
    }
    return out;
  }

  /* Where a CDR would actually sample. NOT the peak of the pulse response — for a
     low-loss channel that sits at the end of the settled region, one sample before
     the next transition, which maximises amplitude while sitting on an edge. A
     receiver centres in the eye, so sweep the offset and take the widest opening,
     tie-broken on height. */
  function bestCursor(y, bits, base) {
    let best = { off: base, w: -1, h: -1 };
    for (let d = -SPS / 2; d <= SPS / 2; d++) {
      const off = base + d;
      if (off < 0) continue;
      const h = eyeOpen(y, bits, off);
      if (h <= 0) continue;
      const w = eyeWidth(y, bits, off);
      if (w > best.w || (w === best.w && h > best.h)) best = { off, w, h };
    }
    return best.w < 0 ? base : best.off;
  }

  function eyeOpen(y, bits, cursor) {
    let lo1 = Infinity, hi0 = -Infinity;
    for (let b = SKIP; b < bits.length - 2; b++) {
      const v = y[b * SPS + cursor];
      if (v === undefined) continue;
      if (bits[b]) { if (v < lo1) lo1 = v; } else if (v > hi0) hi0 = v;
    }
    return Math.max(0, lo1 - hi0);
  }
  function eyeWidth(y, bits, cursor) {
    let w = 0;
    for (let d = 0; d <= SPS / 2; d++) {
      let ok = true;
      for (let b = SKIP; b < bits.length - 2 && ok; b++) {
        for (const s of [-d, d]) {
          const v = y[b * SPS + cursor + s];
          if (v === undefined) continue;
          if (bits[b] ? v <= 0 : v >= 0) { ok = false; break; }
        }
      }
      if (!ok) break;
      w = 2 * d / SPS;
    }
    return Math.min(1, w);
  }

  NS.viz.impairments = function (root) {
    const $ = (s) => root.querySelector(s);
    const cvE = $('[data-cv="eye"]'), cvT = $('[data-cv="tdr"]'), cvB = $('[data-cv="bars"]');
    const p = Object.assign({ rsrc: 50 }, IFACES.pcie4);
    const bits = lfsr(NB, 0x4a1);
    const aggBits = [0, 1, 2, 3].map((i) => lfsr(NB, 0x1f3 + i * 0x2b7));

    /* Run the whole chain. `use` switches individual impairments off so the same
       code produces the sensitivity numbers — no second, drifting implementation. */
    /* The received signal is assembled BEFORE the receiver, then the receiver
       processes all of it. Previously the CTLE was folded into the channel
       impulse response — so it shaped the direct path only — while the echo and
       the crosstalk were added afterwards and never passed through it at all.
       That cannot demonstrate the receiver chain the prose describes, and it
       flatters the equaliser: in real silicon the CTLE amplifies crosstalk along
       with the signal, which is one of the page's central claims. */
    /* rel: where to sample, as an offset from this channel's own pulse peak. Left
       out, the eye is searched for its centre, as a CDR would. */
    function run(use, rel) {
      const h0 = K.channelImpulse(use.il ? p.il : 0, SPS, NFFT);
      const sc = shapeChannel(h0, p, use);
      const lv = Array.from(bits, (b) => (b ? 1 : -1) * SWING / 2);
      const x = shape(lv, 0.3);

      // ---- at the receiver pad: direct + echo + crosstalk ----
      let y = conv(x, sc.h);
      if (sc.echoOK && Math.abs(sc.gEcho) > 1e-9) {
        const ye = conv(x, sc.hEcho);
        for (let i = sc.echoSamples; i < y.length; i++) y[i] += sc.gEcho * ye[i - sc.echoSamples];
      }
      /* Each aggressor carries a fixed skew relative to the victim. Without one
         they are all edge-aligned, FEXT is proportional to the aggressor's
         derivative, and so it is identically zero at mid-bit — the cursor search
         then parks in that null and reports crosstalk as free. Real neighbours
         have arbitrary phase; these skews are deterministic so runs stay
         comparable, and spread across the UI so no single alignment is special. */
      if (use.xt && p.nagg > 0 && p.coup > 0) {
        for (let a = 0; a < p.nagg; a++) {
          const alv = Array.from(aggBits[a % 4], (b) => (b ? 1 : -1) * SWING / 2);
          const ax = shape(alv, 0.3);
          let pk = 0;
          const d = new Float64Array(ax.length);
          for (let i = 1; i < ax.length; i++) { d[i] = ax[i] - ax[i - 1]; if (Math.abs(d[i]) > pk) pk = Math.abs(d[i]); }
          const g = pk > 0 ? (p.coup * SWING) / pk : 0;
          /* Phase must depend on WHICH aggressor, never on how many there are.
             Deriving it from the count made adding a neighbour move every other
             neighbour, so the eye was not monotone in aggressor count — and a
             lone aggressor landed exactly back in the mid-bit null. The golden
             ratio spreads them without any landing on 0 or 0.5 UI. */
          const skew = Math.round((((a + 1) * 0.6180339887) % 1) * SPS);
          for (let i = skew; i < y.length && i - skew < d.length; i++) y[i] += d[i - skew] * g;
        }
      }

      // ---- the receiver, applied to everything that arrived ----
      let hEff = sc.h;
      if (p.eq) {
        const imp = new Float64Array(SPS * 8); imp[0] = 1;
        const hCtle = K.ctle(imp, 9, SPS, NFFT);
        y = conv(y, hCtle);
        hEff = conv(sc.h, hCtle);                    // taps must match the equalised pulse
      }
      const sb = K.pulseResponse(hEff, SPS, 0.3);
      const cur = (rel === undefined) ? bestCursor(y, bits, sb.cursor) : sb.cursor + rel;
      if (p.eq) y = K.applyDFE(y, lv, sb.sbr, cur, 4, SPS, { mode: 'ideal' });

      return { y, cur, rel: cur - sb.cursor, height: eyeOpen(y, bits, cur), width: eyeWidth(y, bits, cur),
               rlDb: sc.rlDb, echoUI: sc.echoUI, echoOK: sc.echoOK, s11Imp: sc.s11Imp };
    }

    const ALL = { il: 1, rl: 1, tdr: 1, xt: 1 };
    let M = null, SENS = null;
    function rebuild() {
      M = run(ALL);
      SENS = ['il', 'rl', 'tdr', 'xt'].map((k) => {
        const use = Object.assign({}, ALL); use[k] = 0;
        /* The same sampling PHASE, not the same sample: loss delays the pulse by
           more than a UI at 18 dB, so removing it at a fixed sample read the next
           bit and reported the loss as helping. */
        return { key: k, height: run(use, M.rel).height };
      });
    }

    function drawEye(T) {
      const s = K.canvas(cvE, 250);
      // Auto-scale vertically. A 28 dB channel delivers a few tens of millivolts to
      // the pad, and drawn against a full-swing axis that is a flat line. The
      // readout stays in absolute mV so the difficulty is still visible in the
      // number — only the picture is zoomed, which is what a scope's vertical
      // control does anyway.
      let amp = 0;
      for (let b = SKIP; b < NB - 2; b++) {
        for (let k = -SPS / 2; k < SPS / 2; k += 4) {
          const v = M.y[b * SPS + M.cur + k];
          if (v !== undefined && Math.abs(v) > amp) amp = Math.abs(v);
        }
      }
      amp = Math.max(amp * 1.18, 0.02);
      const tick = amp / 2;
      const P = K.plot(s, T, {
        pad: { l: 52, r: 16, t: 20, b: 30 },
        x: { min: -0.5, max: 0.5, ticks: [-0.5, -0.25, 0, 0.25, 0.5], fmt: (v) => v === 0 ? '0' : v.toFixed(2), title: 'UI' },
        y: { min: -amp, max: amp, ticks: [-tick * 2, -tick, 0, tick, tick * 2],
             fmt: (v) => (v * 1000).toFixed(Math.abs(v) < 0.02 ? 1 : 0), title: 'mV' }
      }).grid();
      const ctx = s.ctx;
      ctx.save();
      ctx.strokeStyle = K.rgba(T.signal, 0.13); ctx.lineWidth = 1; ctx.lineJoin = 'round';
      /* Half-open, like the DFE's window: sample +SPS/2 is the next bit's, with the
         next correction already subtracted, and drawing it put a false step at +0.5 UI. */
      for (let b = SKIP; b < NB - 2; b++) {
        ctx.beginPath();
        for (let k = -SPS / 2; k < SPS / 2; k++) {
          const v = M.y[b * SPS + M.cur + k];
          if (v === undefined) continue;
          const x = P.X(k / SPS), yy = P.Y(v);
          k === -SPS / 2 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
      ctx.restore();
      const open = K.eyeContour((b, k) => M.y[b * SPS + M.cur + k], bits, SKIP, NB - 2, -SPS / 2, SPS / 2 - 1);
      if (M.height > 0 && open.pts) {
        K.strokeEyeOpening(ctx, P.X, P.Y, open, SPS, T.reflect);
      } else {
        K.text(ctx, 'EYE CLOSED', (P.box.L + P.box.R) / 2, (P.box.TP + P.box.B) / 2, T.alarm, 13, 'center');
      }
      P.frame();
    }

    function drawTDR(T) {
      const s = K.canvas(cvT, 200);
      const uiPs = 1e12 / p.rate;
      const span = Math.min(2 * p.tdps * 1.3 + 400, 4000);       // ps of round trip
      const P = K.plot(s, T, {
        pad: { l: 48, r: 14, t: 18, b: 28 },
        x: { min: 0, max: span, count: 5, fmt: (v) => (v / 1000).toFixed(1), title: 'ns (round trip)' },
        y: { min: 30, max: 70, ticks: [30, 40, 50, 60, 70], fmt: (v) => v.toFixed(0), title: 'ohm' }
      }).grid();

      /* Derived from the SAME S11 the return-loss readout uses, not sketched
         beside it. The 20 ps step edge is the instrument's bandwidth, so a short
         discontinuity is correctly shown smaller than it is — which is the whole
         reason a TDR under-reads a fast feature. */
      const trS = Math.max(1, (20 / uiPs) * SPS);
      const nOut = Math.min(NFFT, Math.ceil((span / uiPs) * SPS) + 4);
      const z = tdrTrace(M.s11Imp, SPS, trS, nOut);
      const pts = [];
      for (let i = 0; i < z.length; i++) {
        const t = (i / SPS) * uiPs;
        if (t > span) break;
        pts.push([t, z[i]]);
      }
      P.hline(50, T.muted, [3, 3], '50 ohm');
      P.trace(pts, T.signal, { width: 2, glow: true });

      const ctx = s.ctx;
      let zmin = 50, zmax = 50, tAt = 0;
      for (const [t, v] of pts) {
        if (Math.abs(v - 50) > Math.abs(zmax - 50)) { zmax = v; tAt = t; }
        if (v < zmin) zmin = v;
      }
      if (Math.abs(zmax - 50) > 0.4) {
        K.dot(ctx, P.X(tAt), P.Y(zmax), T.reflect, T.surface, 4);
        K.text(ctx, zmax.toFixed(1) + ' ohm', P.X(tAt) + 7, P.Y(zmax) - 9, T.reflect, 10, 'left');
      }
      K.text(ctx, 'step edge 20 ps — a shorter feature reads shallower than it is',
             P.box.L + 6, P.box.TP + 11, T.muted, 9, 'left');
      P.frame();
    }

    /* Counterfactuals, not a decomposition. Each bar re-runs the whole chain with
       one impairment removed, holding the equaliser settings fixed. The bars
       therefore need not sum to anything: impairments interact, and removing one
       can make another worse — a negative bar is a real result, not an error, so
       it is drawn rather than clipped away. */
    function drawBars(T) {
      const s = K.canvas(cvB, 200);
      const { ctx, w } = s;
      const L = 124, R = w - 84, MIDW = R - L;
      const names = { il: 'insertion loss', rl: 'reflections (RL)', tdr: 'the discontinuity', xt: 'crosstalk' };
      const costs = SENS.map((x) => ({ key: x.key, cost: x.height - M.height }));
      /* Each side gets width in proportion to its own largest bar. A fixed 28/72
         split scaled both sides by the larger one, so a big negative bar ran left
         past the names. */
      const neg = Math.max(0, ...costs.map((c) => -c.cost)), pos = Math.max(0, ...costs.map((c) => c.cost));
      const anyNeg = neg > 1e-9;
      const scale = MIDW / Math.max(1e-6, neg + pos);
      const zero = L + neg * scale;
      const worst = Math.max(...costs.map((c) => c.cost));

      K.text(ctx, 'removing one, holding EQ fixed', L - 116, 16, T.ink2, 11, 'left');
      if (w >= 460) K.text(ctx, 'eye height regained', w - 4, 16, T.muted, 9, 'right');   // no room beside the title on a phone
      if (anyNeg) K.line(ctx, zero, 28, zero, 178, T.border, 1);

      costs.forEach((c, i) => {
        const y = 38 + i * 34;
        const wpx = c.cost * scale;
        const colour = c.cost < -1e-9 ? T.reflect : (c.cost === worst ? T.alarm : T.signal);
        ctx.save();
        ctx.fillStyle = K.rgba(colour, 0.6);
        ctx.fillRect(Math.min(zero, zero + wpx), y, Math.max(1, Math.abs(wpx)), 20);
        ctx.restore();
        K.text(ctx, names[c.key], L - 8, y + 11, T.ink2, 10, 'right');
        const lbl = (c.cost >= 0 ? '+' : '−') + Math.abs(c.cost * 1000).toFixed(0) + ' mV';
        // a negative bar's value sits just right of zero, clear of the names
        K.text(ctx, lbl, wpx >= 0 ? zero + Math.max(1, wpx) + 6 : zero + 6, y + 11, colour, 10, 'left');
      });
      K.text(ctx, 'they do not add up — impairments interact',
             L - 116, 190, T.muted, 9, 'left');
    }

    function draw(T) {
      drawEye(T); drawTDR(T); drawBars(T);
      const uiPs = 1e12 / p.rate;
      $('[data-out="ui"]').textContent = uiPs.toFixed(1) + ' ps';
      $('[data-out="nyq"]').textContent = (p.rate / 2e9).toFixed(2) + ' GHz';
      const eh = $('[data-out="eh"]');
      eh.textContent = M.height <= 0 ? 'closed' : (M.height * 1000).toFixed(0) + ' mV';
      eh.style.color = M.height <= 0 ? 'var(--alarm-text)' : 'var(--ink)';
      $('[data-out="ew"]').textContent = M.width <= 0 ? 'closed' : (M.width * uiPs).toFixed(0) + ' ps';
      /* Same guard as the eye page: this eye is NB symbols, not a compliance run. */
      $('[data-out="evidence"]').textContent = K.berFloorText(NB - SKIP - 2);
      $('[data-out="rl"]').textContent = '-' + M.rlDb.toFixed(1) + ' dB';
      // Always report the real round trip. Beyond the FFT window the echo is not
      // folded into the impulse response — extending the window would slow the
      // convolution several-fold to model something already ~80 dB down.
      const echoEl = $('[data-out="echo"]');
      echoEl.textContent = M.echoUI.toFixed(0) + ' UI' + (M.echoOK ? '' : ' · negligible');
      echoEl.style.color = M.echoOK && M.echoUI < 8 ? 'var(--alarm-text)' : 'var(--ink)';
      $('#im-il').value = p.il; $('#im-il-out').value = p.il + ' dB';
      $('#im-rt').value = p.rterm; $('#im-rt-out').value = p.rterm + ' ohm';
      $('#im-rs').value = p.rsrc; $('#im-rs-out').value = p.rsrc + ' ohm';
      $('#im-dz').value = p.dz; $('#im-dz-out').value = p.dz + ' ohm';
      $('#im-dp').value = p.dps; $('#im-dp-out').value = p.dps + ' ps';
      $('#im-na').value = p.nagg; $('#im-na-out').value = p.nagg + ' aggressors';
      $('#im-co').value = Math.round(p.coup * 1000); $('#im-co-out').value = (p.coup * 100).toFixed(1) + ' %';
      $('#im-eq').checked = !!p.eq;
    }

    rebuild();
    const m = K.mount({ root, params: p, draw });
    const clear = () => {
      root.querySelectorAll('.preset[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      $('[data-out="note"]').textContent = 'Custom';
    };
    for (const [id, key, sc] of [['#im-il', 'il'], ['#im-rt', 'rterm'], ['#im-rs', 'rsrc'], ['#im-dz', 'dz'],
                                 ['#im-dp', 'dps'], ['#im-na', 'nagg'], ['#im-co', 'coup', 0.001]]) {
      $(id).addEventListener('input', (e) => { p[key] = +e.target.value * (sc || 1); rebuild(); clear(); m.render(); });
    }
    $('#im-eq').addEventListener('change', (e) => { p.eq = e.target.checked ? 1 : 0; rebuild(); clear(); m.render(); });
    root.querySelectorAll('.preset[data-preset]').forEach((b) => b.addEventListener('click', () => {
      Object.assign(p, IFACES[b.dataset.preset]);
      root.querySelectorAll('.preset[data-preset]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      $('[data-out="note"]').textContent = IFACES[b.dataset.preset].note;
      rebuild(); m.render();
    }));
    root.querySelector('.preset[data-preset="pcie4"]').setAttribute('aria-pressed', 'true');
    $('[data-out="note"]').textContent = IFACES.pcie4.note;
    m.render();
    return { start() {}, stop() {}, destroy() { m.teardown(); } };
  };
})();
