/* SI & PI — viz/lab-channel.js
 * Lab B: one channel, every domain.
 *
 * There is exactly ONE definition of the channel on this page — an array of
 * sections handed to K.cascadeS. Everything else is that same network asked a
 * different question:
 *
 *   frequency   |S21| and |S11| in dB, and the group delay behind the phase
 *   time        the impulse response, and the single bit it smears into
 *   space       the step response of S11 read back as an impedance profile
 *   data        a bit sequence, the eye it builds, and the histogram at the
 *               sampling instant
 *
 * Cascading is a matrix product, so every internal re-reflection between the
 * discontinuity and the two ends is included exactly rather than to first order.
 * That matters here: the difference between "a notch" and "a notch plus the
 * ringing either side of it" is entirely in those higher terms.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;

  const SPS = 32, NFFT_DEFAULT = 4096, NB = 420, SKIP = 24, SWING = 0.8;
  const NFFT = NFFT_DEFAULT;          // the default grid, for callers outside build()
  const Z0 = 50;
  const PS_PER_IN = 170e-12;

  /* ---------- the one network definition ---------- */
  /* M1-13 · LOSS_REF_HZ is a property of the board, not of the traffic on it.
     The old code passed the current Nyquist frequency as the loss reference, so
     `sectionABCD` computed dB = lossDb·[(1-df)√(f/fRef) + df·(f/fRef)] against a
     moving fRef. A fixed 22 dB knob therefore described a DIFFERENT PHYSICAL
     BOARD at every symbol rate — 22.00 dB at 8 GHz on the Gen4 preset and
     13.05 dB at the same 8 GHz on Gen5. "Same board, twice the rate" changed the
     board, so no rate-only experiment was possible.

     8 GHz because that is where the interface presets quote their loss. The
     number the reader sets is now anchored there and stays there. */
  const LOSS_REF_HZ = 8e9;
  /* How small a sample has to be before it counts as decayed, as a fraction of
     the response's peak. Used for two things: where the channel's memory ends,
     and whether the response has died away before the circular record wraps.
     1e-3 of a cursor is a tenth of a percent of the eye. Stated, not guessed. */
  const TAIL_BUDGET = 1e-3;
  /* How much inter-period leakage is tolerable before the answer stops being a
     number. 1e-2 of a cursor bounds the eye error at roughly 2%. */
  const SETTLE_BUDGET = 1e-2;

  function sectionsFor(p) {
    const tdTotal = p.reach * PS_PER_IN;
    const at = Math.min(0.95, Math.max(0.05, p.dpos / 100));
    const tdDisc = p.dlen * 1e-12;
    const a = Math.max(1e-13, tdTotal * at - tdDisc / 2);
    const b = Math.max(1e-13, tdTotal * (1 - at) - tdDisc / 2);
    const lossA = p.loss * (a / tdTotal), lossB = p.loss * (b / tdTotal);
    const ref = LOSS_REF_HZ;
    const out = [{ type: 'line', z: Z0, td: a, lossDb: lossA, dielFrac: 0.55, lossRefHz: ref }];
    if (p.stub > 0) out.push({ type: 'stub', z: Z0, td: p.stub * 1e-12 });
    if (tdDisc > 0) out.push({ type: 'line', z: p.dz, td: tdDisc, lossDb: 0, lossRefHz: ref });
    out.push({ type: 'line', z: Z0, td: b, lossDb: lossB, dielFrac: 0.55, lossRefHz: ref });
    return out;
  }

  /* M1-1 · The transport delay, taken as the sum of the sections' WAVEFRONT
     delays — the earliest time anything can arrive (channel-model.md clause 4).
     De-embedding this and not the nominal delay keeps every sample of the
     response at non-negative time, so causality survives the shift instead of
     being assumed through it. */
  function transportDelay(secs) {
    let td = 0;
    for (const sec of secs) {
      if (sec.type === 'line') td += K.lineMaterial(sec, LOSS_REF_HZ).wavefront;
    }
    return td;
  }

  function lfsr(n, seed) {
    let s = seed || 0x1a3;
    const b = new Int8Array(n);
    for (let i = 0; i < n; i++) {
      const bit = ((s >> 6) ^ (s >> 5)) & 1;
      s = ((s << 1) | bit) & 0x7f;
      b[i] = bit ? 1 : -1;
    }
    return b;
  }

  /* ---------- build every domain from that one network ---------- */
  function build(p, grid) {
    const NFFT = (grid && grid.nfft) || NFFT_DEFAULT;
    const secs = sectionsFor(p);
    const baud = p.rate * 1e9;
    const uiPs = 1e12 / baud;
    const fNyq = baud / 2;
    const fs = SPS * baud;                       // sample rate of the impulse grid
    /* M1-1 · De-embed an INTEGER number of samples and keep the fraction in the
       response. An integer circular shift is exactly what a linear phase ramp of
       e^{+j2*pi*k*n/N} does to a DFT, so it costs nothing and introduces nothing.
       A fractional shift does not: it is a periodic-sinc interpolation, and it
       smeared a low-level tail across the whole record, which then read as "this
       channel needs 60 UI of memory" when the channel needs about five.

       The remaining fraction is under one sample and stays where it belongs, in
       the response. That is the "preserve fractional delay" clause. */
    const tdNominal = p.reach * PS_PER_IN;
    const tdWave = transportDelay(secs);
    const nBulk = Math.max(0, Math.floor(tdWave * fs));
    const tdBulk = nBulk / fs;                   // exactly representable on this grid
    const tdFrac = tdWave - tdBulk;              // < 1 sample, left in the response

    const re = new Float64Array(NFFT), im = new Float64Array(NFFT);
    const sweep = [];                            // for the frequency panels
    for (let k = 0; k <= NFFT / 2; k++) {
      /* DC is evaluated at a tiny offset, not at zero: a series capacitor is an
         open there and a stub's tangent is fine, but 0 Hz in a √f loss law is a
         removable singularity it is cheaper to step around than to special-case. */
      const f = Math.max(k * fs / NFFT, 1e3);
      const S = K.cascadeS(secs, f, Z0, LOSS_REF_HZ);
      /* M1-1 · De-embed the transport delay HERE, as a phase advance, rather
         than transforming the whole flight time into the record and then
         truncating it away. Multiplying by e^{+jw·tdBulk} slides the arrival to
         the start of the record, so what the array holds is the channel's
         MEMORY — a few UI of it — and the flight time is carried separately as
         a sample offset with its fraction intact.

         This is the B1 repair. Before it, `keep = SPS * 40` retained 1280
         samples while the Gen5 preset's arrival sat at sample 1741, so the eye
         was drawn from pre-arrival residue and read 4.8 uV. */
      const ph = 2 * Math.PI * k * nBulk / NFFT;   // integer-sample rotation, exact
      const cp = Math.cos(ph), sp = Math.sin(ph);
      const dr = S.s21r * cp - S.s21i * sp;
      const di = S.s21r * sp + S.s21i * cp;
      re[k] = dr; im[k] = di;
      if (k > 0 && k < NFFT / 2) { re[NFFT - k] = dr; im[NFFT - k] = -di; }
      if (k > 0 && f <= 3.2 * fNyq && k % 4 === 0) {
        sweep.push({
          f,
          s21: 20 * Math.log10(Math.max(Math.hypot(S.s21r, S.s21i), 1e-12)),
          s11: 20 * Math.log10(Math.max(Math.hypot(S.s11r, S.s11i), 1e-12)),
          gd: K.groupDelay(secs, f, Z0, LOSS_REF_HZ)
        });
      }
    }

    // S11 on the same grid, for the TDR
    const r11 = new Float64Array(NFFT), i11 = new Float64Array(NFFT);
    for (let k = 0; k <= NFFT / 2; k++) {
      const f = Math.max(k * fs / NFFT, 1e3);
      const S = K.cascadeS(secs, f, Z0, LOSS_REF_HZ);
      r11[k] = S.s11r; i11[k] = S.s11i;
      if (k > 0 && k < NFFT / 2) { r11[NFFT - k] = S.s11r; i11[NFFT - k] = -S.s11i; }
    }

    K.fft(re, im, true);
    K.fft(r11, i11, true);

    /* M1-2 · The record follows a STATED ENERGY BUDGET, not a fixed number of
       UI. `SPS * 40` was a guess that happened to hold for one preset; the
       length the response actually needs depends on the dispersion, the
       discontinuity and the stub, and no constant can know that.

       Keep until 99.99% of the energy is accounted for, then a little margin for
       the equaliser's own ringing, and report whether the grid could hold it.
       channel-model.md clause 5. */
    /* Nothing is truncated any more, and that is the point. `SPS * 40` was there
       to bound the work of carrying a long flight time through the record; the
       flight time is now de-embedded, so the record holds the memory and only
       the memory. Keeping all of it removes the choice that caused B1.

       What remains is a question of VALIDITY rather than of length: has the
       response decayed before it wraps around the end of the circular record? If
       it has not, the samples near the start are contaminated by the tail of the
       previous period, and the answer is not a number — it is 'not-settled'. */
    let peak = 0;
    for (let i = 0; i < NFFT; i++) peak = Math.max(peak, Math.abs(re[i]));
    let need = 0;
    for (let i = NFFT - 1; i >= 0; i--) {
      if (Math.abs(re[i]) > TAIL_BUDGET * peak) { need = i + 1; break; }
    }
    /* N2-2 / R5. This measured the last eighth of the circular record, which is
       the wrong window. The de-embedded response peaks at or near sample 0, so
       the sidelobes immediately BEFORE the peak wrap into that eighth — and a
       band-limited fractional delay has sidelobes falling only as 1/n.

       On a matched, lossless, one-inch line with no reflector anywhere, the old
       metric read 3.8462% and did not move at any record length. Measuring
       |h| against distance from the peak shows why: 4.17e-2 at k=1, 2.04e-2 at
       2, 1.01e-2 at 4, 5.03e-3 at 8 — halving with every doubling, which is the
       signature of a periodic sinc, not of an echo. At the antipodal sample it
       is 9.4e-10. There was never anything there to settle.

       So the tail is measured at circular distance from the PEAK instead. It
       then converges with record length for every scenario the panel can build,
       including the two the old comment called resonators whose reflections
       never decay. */
    let peakAt = 0;
    for (let i = 0; i < NFFT; i++) if (Math.abs(re[i]) === peak) { peakAt = i; break; }
    let wrapAmp = 0;
    for (let i = 0; i < NFFT; i++) {
      const d = Math.min((i - peakAt + NFFT) % NFFT, (peakAt - i + NFFT) % NFFT);
      if (d >= NFFT / 4) wrapAmp = Math.max(wrapAmp, Math.abs(re[i]));
    }
    const keep = NFFT;
    const h = re.slice(0, keep);
    /* A response that has not decayed inside the grid is the one case where the
       answer is not a number. `settled` is false only when the grid itself is
       too short, which the released presets never reach — but a reader dragging
       reach and loss to their limits can, and then the panel has to say so
       instead of quietly reporting the truncated answer. */
    /* WHAT THIS NUMBER IS, and three things it is not. N2-2 replaced all three.

       It is: the largest |h| at a circular distance of a quarter-record or more
       from the peak, over the peak. A diagnostic of whether the impulse response
       has decayed inside the grid it is computed on.

       It is NOT a periodic steady state. The old comment said a circular
       convolution is exactly the steady-state response to this periodic PRBS.
       The record is 4096 points at 32 samples/UI, so 128 UI, and PRBS7 has 127
       symbols — the two do not divide. And the waveform is not built that way
       anyway: it is a finite convolution of a 420-symbol LFSR record with a
       24-symbol startup exclusion. Neither object is 127-periodic.

       It is NOT evidence of a non-decaying resonator. The old comment said an
       almost-lossless line with a 38 ohm step has reflections that never decay.
       With the metric measured from the peak, that scenario falls 0.0034% ->
       0.0008% as the record quadruples, exactly like every other one. A finite
       mismatched section between matched external lines sheds energy into those
       lines; material loss was never the only damping mechanism available.

       It is NOT a bound on eye error, and measurement says it is not even a
       predictor. Quadrupling the record from 4096 to 16384:

         preset      tail@4096    eye error
         rateonly      0.778%      0.021 mV     <- second largest tail, smallest error
         ufs4          0.120%      0.346 mV     <- smallest tail, largest error
         pcie5         2.690%      0.298 mV

       The retired claim — "1% of tail lets at most 1% of a cursor leak, so at
       most 2% of the eye" — was never derived and does not hold. What CAN be
       said is what was measured directly: across every released preset, the eye
       at this record is within 0.35 mV of its value at four times the record.
       That is a convergence measurement, not an inequality, and it is stated
       where the reader can see it. */
    const periodicResidual = peak > 0 ? wrapAmp / peak : 0;
    const settled = periodicResidual <= SETTLE_BUDGET;
    const tailEnergy = periodicResidual;

    /* The equaliser is K.ctle, not a second copy of it here.

       N3-2b / R9. The label used to say the boost "undoes the loss at Nyquist".
       It does not, on two counts: it is taken from the loss CONTROL, which is a
       budget applied to the trace and not the channel's insertion loss (see
       N2-1, where the two differ by 10.09 dB on a preset), and it is capped at
       18 dB. So this is a DELIBERATELY FIXED receiver, and the panel now says
       so. That is the right choice for this lab — every controlled comparison on
       the page depends on the receiver not moving when the channel does — but it
       had to be labelled rather than dressed up as adaptation.

       Note the units: the kit's CTLE works in frequency normalised to Nyquist,
       so its poles are 0.75 and 1.4, not 12 GHz and 22 GHz. Handing it hertz puts
       the zero outside the solver's bracket. */
    const boost = Math.min(18, Math.max(0, p.loss));
    const hEq = boost > 0 ? K.ctle(h, boost, SPS, NFFT) : h;

    const trUI = Math.max(0.02, p.tr / uiPs);
    const sb = K.singleBit(h, SPS);
    const prRaw = K.pulseResponse(h, SPS, trUI);
    const prEq = K.pulseResponse(hEq, SPS, trUI);
    const pr = p.eq ? prEq : prRaw;

    // worst in-band return loss
    /* -Infinity, not 0. Starting at zero meant a sweep whose values are all
       negative reported 0 dB — a perfect reflector — which is the worst possible
       reading and looked like a real result. */
    let worst = -Infinity;
    sweep.forEach((s) => { if (s.f <= 1.1 * fNyq && s.s11 > -200) worst = Math.max(worst, s.s11); });

    /* N2-1 / R4. The channel's ACTUAL insertion loss at Nyquist, evaluated at
       exactly fNyq rather than read off the 51-point display grid or inferred
       from the `loss` control.

       These are not the same number and the homepage said they were. The loss
       control is a BUDGET applied to the trace sections; a stub contributes a
       notch that the budget knows nothing about. Gen 4 and the stub preset share
       a control value of 14 dB and differ by 10.09 dB in the thing that matters.
       Reporting the measured value is what lets the comparison verify itself on
       screen instead of being asserted in prose. */
    const Snyq = K.cascadeS(secs, fNyq, Z0, LOSS_REF_HZ);
    const ilNyq = 20 * Math.log10(Math.hypot(Snyq.s21r, Snyq.s21i));
    const rlNyq = 20 * Math.log10(Math.hypot(Snyq.s11r, Snyq.s11i));

    return { secs, h, hEq, sb, pr, prRaw, prEq, sweep, s11Imp: r11, uiPs, fNyq, baud,
             ilNyq, rlNyq, nfft: NFFT,
             boost, rlDb: worst, tdTotal: tdNominal,
             tdBulk, tdFrac, memoryNeeded: need, memoryKept: keep, settled,
             tailEnergy, periodicResidual,
             lossRefHz: LOSS_REF_HZ };
  }

  /* ---------- the measurement layer, lifted out of the drawing layer ----------
     M0-6. These used to live inside drawEye() and drawHist(), which meant the
     only way to ask what this lab measures was to render it into a canvas and
     read the pixels back. The model gate could therefore only test helpers that
     RESEMBLED the lab; Astra's N3 is precisely that the assembled pipeline was
     untested, and B1/B2 are what got through.

     Behaviour here is preserved exactly as it shipped, bugs included — the
     half-UI offset between the pulse cursor and the eye measurement, and the
     classification of samples by sign rather than by transmitted symbol. That is
     deliberate: M1-5 and M1-6 fix them, and a fix is only demonstrable if the
     defect is reachable first. Both are recorded in `diagnostics.known` below so
     that nothing reads this result as trustworthy in the meantime. */

  function convolveBits(pr, bits) {
    const y = new Float64Array((NB + 4) * SPS);
    const h = pr.sbr;
    for (let b = 0; b < NB; b++) {
      if (!bits[b]) continue;
      const a = bits[b] * SWING;
      const off = b * SPS;
      for (let i = 0; i < h.length; i++) {
        const j = off + i;
        if (j < y.length) y[j] += a * h[i];
      }
    }
    return y;
  }

  /* M1-5 · ONE sampling phase, defined once, relative to a named input symbol.
     It is the pulse cursor and nothing else. Four things used to disagree about
     it: the eye window started at the cursor, the eye measurement was taken half
     a UI later, the tap readout used the cursor, and the bit marker used the
     window. The eye and the taps therefore described different instants, which
     is why the panel could report a healthy opening on a channel that was
     making a wrong decision in every third symbol.

     The eye is now drawn CENTRED on this instant — window from at - SPS/2 to
     at + SPS/2 — so the decision point is the middle of the picture, which is
     where a reader looks for it and where every eye diagram puts it. */
  function samplePhase(pr) {
    return pr.cursor;
  }

  function measure(M, bits, phaseOffset) {
    const y = convolveBits(M.pr, bits);
    const at = samplePhase(M.pr) + (phaseOffset || 0);

    /* The independently computed valid range, rather than a count taken on
       trust. The window now reaches half a UI either side of the decision, so
       the first usable symbol has to clear that too. */
    const firstBit = Math.max(SKIP, Math.ceil((SPS / 2 - at) / SPS));
    const lastBit = Math.floor((y.length - 1 - at - SPS / 2) / SPS);
    const valid = K.validRange(firstBit, Math.min(NB - 4, lastBit), NB, 1);

    /* M1-6 · Populations are labelled by the symbol that was TRANSMITTED, not by
       the sign of the sample that came back. Grouping by sign takes a sample
       that landed on the wrong side of zero and files it as a good member of the
       other population, so the two clouds are reported as separated by exactly
       the margin the errors removed. That is not a measurement of an eye; it is
       a measurement with the failures deleted.

       With real labels, hiLo can fall below loHi and the opening goes NEGATIVE.
       That is the correct reading for a closed eye and the panel shows it. */
    const vals = [], symbols = [];
    let hiLo = Infinity, loHi = -Infinity, wrong = 0, nHi = 0, nLo = 0;
    for (let b = valid.from; b <= valid.to; b++) {
      const v = y[b * SPS + at];
      if (v === undefined) continue;
      vals.push(v);
      symbols.push(bits[b]);
      if (bits[b] > 0) { hiLo = Math.min(hiLo, v); nHi++; }
      else { loHi = Math.max(loHi, v); nLo++; }
      if ((v > 0 ? 1 : -1) !== bits[b]) wrong++;
    }
    /* An empty population is not a closed eye — it is no measurement. Both
       symbols have to appear before an opening between them means anything. */
    const populated = nHi > 0 && nLo > 0;
    const eh = populated ? hiLo - loHi : NaN;
    return { y, at, valid, vals, symbols, eh, hiLo, loHi, wrong, nHi, nLo, populated };
  }

  /* ---------- the pure model: parameters in, one result out ---------- */
  NS.models = NS.models || {};
  /* N1-2 / R2. Ask the material layer whether this reach-and-loss combination is
     a dielectric before building anything on it. K.result would catch the NaN
     downstream anyway (G-12), but a generic "non-finite value" tells the reader
     nothing they can act on, and the specific answer — how much loss this length
     can actually carry — is one bisection away. */
  function domainRefusal(p) {
    for (const sec of sectionsFor(p)) {
      if (sec.type !== 'line' || !(sec.lossDb > 0)) continue;
      const M = K.lineMaterial(sec, LOSS_REF_HZ);
      if (M.admissible === false) {
        const perInch = M.maxLossDb / (sec.td / PS_PER_IN);
        return 'At ' + p.reach + ' inch' + (p.reach === 1 ? '' : 'es') + ', '
             + p.loss + ' dB at ' + (LOSS_REF_HZ / 1e9) + ' GHz is more loss than a real '
             + 'dielectric can produce: the fit needs a high-frequency permittivity of '
             + M.epsInf.toFixed(2) + ', and below 1 the wavefront would outrun light in '
             + 'vacuum. This model supports about ' + perInch.toFixed(1) + ' dB per inch '
             + 'here, so about ' + (perInch * p.reach).toFixed(1) + ' dB at this reach.';
      }
    }
    return null;
  }

  NS.models.labChannel = function (p, opts) {
    const refusal = domainRefusal(p);
    if (refusal) {
      return K.result({
        model: 'labChannel', version: '1.2', status: 'unsupported', why: refusal,
        params: {
          reach: p.reach, loss: p.loss, rate: p.rate, dz: p.dz,
          dpos: p.dpos, dlen: p.dlen, stub: p.stub, tr: p.tr, eq: p.eq
        },
        diagnostics: { domain: 'dielectric fit requires epsInf >= 1' }
      });
    }
    const seed = (opts && opts.seed) || 0x4a1;
    const bits = lfsr(NB, seed);
    const M = build(p, opts && { nfft: opts.nfft });
    const m = measure(M, bits, opts && opts.phaseOffset);

    return K.result({
      model: 'labChannel',
      version: '1.2',
      status: 'ok',
      /* A channel matched at every interface reflects nothing, so 20*log10|S11|
         is -Infinity dB. That is the exact answer, not a failure, and the gate's
         ideal reference case is precisely that channel. Declared rather than
         clamped: a floor of -300 dB would be a number nobody computed. */
      mayBeInfinite: ['worstReturnLoss'],
      params: {
        reach: p.reach, loss: p.loss, rate: p.rate, dz: p.dz,
        dpos: p.dpos, dlen: p.dlen, stub: p.stub, tr: p.tr, eq: p.eq,
        /* N3-2f. Two edge definitions exist and only one was recorded: `tr` is
           the transmitter's, `trTdr` the step used to build the TDR view. A
           scenario that did not carry trTdr could not be reproduced. */
        trTdr: p.trTdr
      },
      units: {
        reach: 'in', loss: 'dB', rate: 'GT/s', dz: 'ohm', dpos: '%',
        dlen: 'ps', stub: 'ps', tr: 'ps', eyeHeight: 'V', ui: 'ps', fNyq: 'Hz'
      },
      conventions: {
        voltage: 'single-ended terminal volts, swing +/-' + SWING + ' V',
        z0: Z0 + ' ohm real reference at both ports',
        lossReference: 'a FIXED 8 GHz, a property of the board. A rate-only change '
          + 'therefore leaves the S-parameters alone (M1-13)',
        riseTime: 'tr is the transmitter edge (10-90%); trTdr is the TDR '
          + 'instrument aperture. Separate controls — they are separate physical '
          + 'quantities and moving one must not move the other (M1-12)',
        eyeHeight: 'the extremal gap between the two TRANSMITTED populations at '
          + 'the decision instant, over the valid portion of the finite symbol record. Not a percentile, not a '
          + 'BER contour, and not comparable with a compliance eye height (M1-7). '
          + 'Goes negative when the populations overlap',
        impulse: 'Dimensionless discrete convolution weights h[k]; y[n] = sum h[k] x[n-k]. The sample interval is dt. Sum h[k] is the real DC bin of the finite FFT model, not necessarily ideal unity gain.',
        timeOrigin: 'Impulse and pulse trace times start after removing tdBulk of transport delay. Add tdBulk to restore their transport time labels; this does not remove finite-bandwidth or periodic-record artifacts.',
        samplePhase: 'one phase for eye, histogram, taps and bit marker: the '
          + 'pulse cursor (M1-5)'
      },
      /* N3-2f. The record is 420 LFSR symbols with the first 24 excluded for
         startup, and the eye is measured over the 393 that survive the decision
         window. It is NOT "one PRBS7 period" — that would be 127, and 128 UI of
         record would not divide by it anyway. All three numbers are now here. */
      stimulus: { kind: 'prbs7-lfsr', seed: seed, generated: NB, skipped: SKIP,
                  measured: m.valid.count, sps: SPS,
                  note: 'a finite convolution of a ' + NB + '-symbol record, not one '
                    + 'period of a 127-symbol sequence' },
      /* N3-2f / R9. df hard-coded the module's default 4096 even when the caller
         asked for a different grid, so a result computed at 16384 reported a
         frequency spacing four times too large. It now comes from the build. */
      origins: { t0: 0, dt: 1 / (SPS * p.rate * 1e9), df: (SPS * p.rate * 1e9) / M.nfft,
                 nfft: M.nfft, sps: SPS, tdBulk: M.tdBulk },
      valid: m.valid,
      /* N4-4. Four different shapes became one. `data` is kept alongside for the
         drawing layer, which indexes these arrays directly and has no reason to
         walk a pair of parallel lists; the x/y form is what leaves the page. */
      traces: (function () {
        const fs2 = M.sweep.map((q) => q.f);
        const dtS = 1 / (SPS * p.rate * 1e9);
        const tOf = (arr) => { const t = []; for (let i = 0; i < arr.length; i++) t.push(i * dtS); return t; };
        const mk = (id, label, unit, xn, xu, xs, ys, raw) =>
          Object.assign(K.trace(id, label, unit, xn, xu, xs, ys), { data: raw });
        return [
          mk('il', 'insertion loss', 'dB', 'frequency', 'Hz',
             fs2, M.sweep.map((q) => q.s21), M.sweep),
          mk('rl', 'return loss', 'dB', 'frequency', 'Hz',
             fs2, M.sweep.map((q) => q.s11), M.sweep),
          mk('group-delay', 'channel group delay', 's', 'frequency', 'Hz',
             fs2, M.sweep.map(q=>q.gd), M.sweep),
          mk('pulse', 'normalized single-bit response', '-', 'time', 's',
             tOf(M.pr.sbr), Array.from(M.pr.sbr), M.pr.sbr),
          mk('impulse', 'raw discrete impulse weights', '-', 'time', 's',
             tOf(M.h), Array.from(M.h), M.h),
          mk('impulse-active', 'active-path discrete impulse weights', '-', 'time', 's',
             tOf(p.eq ? M.hEq : M.h), Array.from(p.eq ? M.hEq : M.h), p.eq ? M.hEq : M.h),
          mk('rx', 'received waveform', 'V', 'time', 's',
             tOf(m.y), Array.from(m.y), m.y),
          /* A histogram is a list of sampled values, not a curve: its abscissa
             is the sample index, and saying so is better than inventing one. */
          mk('histogram', 'sampled voltages', 'V', 'sample index', '-',
             m.vals.map((_, i) => i), Array.from(m.vals), m.vals)
        ];
      }()),
      measurements: {
        eyeHeight: m.eh,
        ui: M.uiPs,
        fNyq: M.fNyq,
        worstReturnLoss: M.rlDb,
        ilAtNyquist: M.ilNyq,
        rlAtNyquist: M.rlNyq,
        boost: M.boost,
        cursor: M.pr.cursor,
        samplePhase: m.at,
        validSymbols: m.valid.count,
        wrongDecisions: m.wrong,
        tdTotal: M.tdTotal,
        tdBulk: M.tdBulk,
        lossRefHz: M.lossRefHz
      },
      diagnostics: {
        impulseKept: M.h.length,
        impulseNeeded: M.memoryNeeded,
        memoryNeeded: M.memoryNeeded,
        memoryKept: M.memoryKept,
        settled: M.settled,
        periodicResidual: M.periodicResidual,
        tailEnergy: M.tailEnergy,
        transportFraction: M.tdFrac,
        transportSamples: M.tdBulk * SPS * p.rate * 1e9,
        recordSymbols: NB,
        /* Named, not hidden. A green gate on this model does not mean the model
           is right; it means these four are the reasons it is not yet. */
        /* N2-2f. Validity is PER MEASUREMENT. An impulse response that has not
           decayed inside its record makes the impulse and pulse panels
           unreliable; it does not make the S-parameters wrong, and it does not
           by itself make the eye wrong — the eye's accuracy is established by
           direct convergence measurement, not inferred from this number. Saying
           "this scenario does not settle" as one page-wide flag conflated three
           different questions. */
        known: M.settled ? [] : [
          'the impulse response has not decayed inside this record — '
            + (M.periodicResidual * 100).toFixed(2) + '% of the peak is still '
            + 'present a quarter-record away, so the IMPULSE and PULSE panels '
            + 'are showing a tail the grid cannot resolve. The S-parameters are '
            + 'unaffected; the eye is measured to converge separately.'
        ],
        affects: M.settled ? [] : ['impulse', 'pulse'],
        /* Measured, not asserted: every released preset's eye at this record is
           within 0.35 mV of its value at four times the record. The retired
           claim inferred an eye bound from the tail, which measurement shows is
           not even a predictor — the preset with the second largest tail has the
           smallest eye error. */
        eyeConvergence: '±0.35 mV against a 4x longer record, across the presets'
      },
      generated: { raw: M, measured: m }
    });
  };

  /* ---------- the two-parameter sweep (M7-1) ----------
     One scalar loss budget cannot predict an eye, and the single clearest way
     to show that is a surface: hold everything else and vary a channel feature
     against a receiver setting.

     THE GRID IS CHOSEN BY MEASUREMENT AND ITS TOLERANCE IS STATED. A cell is a
     full pipeline build: 22.6 ms at the panel's own 4096-point grid, so a 13x13
     surface would be 3.8 seconds. Measured against that 4096 reference:

       NFFT 1024   3.8 ms/cell   worst eye error 3.65 mV   8 of 24 cells unsettled
       NFFT 2048   8.2 ms/cell   worst eye error 1.30 mV   0 unsettled
       NFFT 4096  22.6 ms/cell   exact by definition       0 unsettled

     2048 is the grid: no cell disagrees about open versus closed at any of the
     three, and at 2048 the validity flag never fires while the surface still
     completes in about 1.4 seconds.

     Worth recording how that nearly went differently. Measured as a RELATIVE
     error, 1024 disagrees by 64.7% at its worst cell — because that cell sits
     where the eye crosses zero and the divisor vanishes. The figure is true and
     useless; taken at face value it would have rejected a usable grid, and
     taken as reassurance it would have shipped one whose validity flag fires on
     a third of the surface. The ABSOLUTE error and the flag together are what
     decided it. Same lesson as M0-4: a tolerance means nothing until its units
     are chosen.

     `gen` is the staleness guard A4 asks for. A sweep is chunked across frames,
     so a reader who changes a control mid-sweep would otherwise get cells from
     two different scenarios blended into one surface — and it would look fine. */
  const SWEEP_NFFT = 2048;
  /* N2-2 corrects M7-1's own measurement. The 1.30 mV I recorded there was taken
     against a 4096 reference over a handful of points. Measured properly — 25
     points spanning the whole sweep space, against a 16384 reference — NFFT 2048
     errs by 1.86 mV, so the 1.5 mV it claimed was not met:

       NFFT 1024   4.3 ms/cell   worst 5.99 mV
       NFFT 2048   8.2 ms/cell   worst 1.86 mV
       NFFT 4096  22.8 ms/cell   worst 0.29 mV
       NFFT 8192  75.1 ms/cell   worst 0.11 mV

     2048 stays, and the tolerance is restated to what it actually delivers. The
     reason it stays is that the worst errors are far from the closed contour —
     1.86 mV sits where the eye is -52 mV — while near the contour, which is what
     the surface exists to show, the error is under 0.5 mV. That claim is
     asserted, not assumed: no cell may disagree with the panel about open versus
     closed. */
  const SWEEP_TOL_V = 0.002;         // measured against the 4096 grid, not assumed

  NS.models.labChannelSweep = function (p, spec) {
    p = Object.assign({}, p); // Freeze the experiment used by every cell.
    const nx = spec.nx || 13, ny = spec.ny || 13;
    const cells = [];
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        cells.push({
          i, j,
          x: spec.x.lo + (spec.x.hi - spec.x.lo) * (nx === 1 ? 0 : i / (nx - 1)),
          y: spec.y.lo + (spec.y.hi - spec.y.lo) * (ny === 1 ? 0 : j / (ny - 1))
        });
      }
    }
    return {
      nx, ny, spec, cells, done: 0, baseParams: p, nfft: SWEEP_NFFT,
      tolerance: SWEEP_TOL_V,
      /* Evaluate one cell. Kept as a method so the caller can chunk it across
         frames and abandon the run without the model knowing or caring. */
      step() {
        if (this.done >= this.cells.length) return true;
        const c = this.cells[this.done++];
        const q = Object.assign({}, p);
        q[spec.x.key] = c.x;
        q[spec.y.key] = c.y;
        const r = NS.models.labChannel(q, { nfft: SWEEP_NFFT });
        /* Two different reasons a cell has no number, and the surface has to tell
           them apart. A cell OUTSIDE THE MODEL'S DOMAIN (N1-2) has no answer at any
           grid — no refinement rescues it, and `measurements` is null by contract.
           A cell that DOES NOT SETTLE has an answer this grid cannot resolve, which
           a finer grid might. Neither is coloured; both say which they are. */
        if (r.status !== 'ok') {
          c.eye = NaN; c.wrong = NaN;
          c.ok = false;
          c.domain = true;
          c.why = r.why || 'outside the model domain';
          return this.done >= this.cells.length;
        }
        c.eye = r.measurements.eyeHeight;
        c.wrong = r.measurements.wrongDecisions;
        c.domain = false;
        /* A cell whose response does not settle inside the record is NOT
           coloured. A4: numerically unsupported cells are marked unavailable
           rather than interpolated into a credible-looking surface. */
        /* N2-2f. A cell's validity follows the measurement the SURFACE SHOWS,
           which is the eye — not the impulse tail. Gating on the tail hatched 71
           of 121 cells, leaving no loss row with both open and closed cells, and
           it was the wrong test in both directions: the worst-erring UNhatched
           cell was at 0.05% tail. The eye's accuracy across this space is the
           measured 1.86 mV above. */
        c.ok = r.measurements.validSymbols > 100;
        c.tailUndecayed = !r.diagnostics.settled;
        c.why = c.ok ? null : 'too few valid symbols at this grid';
        return this.done >= this.cells.length;
      }
    };
  };

  NS.models.labChannelImpulse = function (result, options) {
    if (!result || result.status !== 'ok') return null;
    const opts = options || {}, model = result.generated.raw;
    const raw = model.h, active = result.params.eq ? model.hEq : raw;
    const dt = result.origins.dt;
    const offset = opts.absolute ? model.tdBulk : 0;
    const count = opts.full ? raw.length : Math.min(raw.length, 12 * SPS + 1);
    let lo = 0, hi = 0;
    for (let i = 0; i < count; i++) { lo = Math.min(lo, raw[i], active[i]); hi = Math.max(hi, raw[i], active[i]); }
    const margin = Math.max(1e-9, (hi - lo) * .1);
    return { raw, active, count, dt, offset, min: lo - margin, max: hi + margin,
      sumRaw: raw.reduce((sum, value) => sum + value, 0),
      sumActive: active.reduce((sum, value) => sum + value, 0) };
  };

  // Decompose the actual sampled convolution, including every retained symbol.
  NS.models.labChannelDecision = function (result, bit) {
    if (!result || result.status !== 'ok') return null;
    const { raw, measured } = result.generated;
    if (!Number.isInteger(bit) || bit < measured.valid.from || bit > measured.valid.to) return null;
    const symbols = lfsr(NB, result.stimulus.seed);
    const sample = bit * SPS + measured.at;
    const terms = []; let sum = 0, rawValue = 0, main = 0;
    for (let source = 0; source < NB; source++) {
      const index = sample - source * SPS;
      if (index < 0 || index >= raw.pr.sbr.length) continue;
      const weight = raw.pr.sbr[index];
      const contribution = symbols[source] * SWING * weight;
      sum += contribution;
      rawValue += symbols[source] * SWING * (raw.prRaw.sbr[index] || 0);
      if (source === bit) main = contribution;
      if (contribution !== 0) terms.push({ source, offset: bit - source,
        symbol: symbols[source], weight, contribution });
    }
    const value = measured.y[sample], transmitted = symbols[bit], detected = value > 0 ? 1 : -1;
    return { bit, sample, transmitted, detected, correct: transmitted === detected,
      value, threshold: 0, main, isi: sum - main, sum, residual: value - sum, rawValue,
      terms: terms.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)) };
  };

  /* The ladder the held eye scale climbs, in volts. A scale is only useful for
     comparison if it lands on the same few values for different signals, so the
     limit is the smallest rung that contains the signal rather than the signal's
     own peak. Above the top rung it falls back to the next half volt. */
  const EYE_STEPS = [0.1, 0.2, 0.5, 1, 1.5, 2], EYE_START = 0.5;
  const eyeStep = (need) => EYE_STEPS.find((v) => v >= need) || Math.ceil(need * 2) / 2;

  NS.viz.labChannel = function (root) {
    const $ = (s) => root.querySelector(s);
    let frequencyIndex=0, frequencyInspector=null;
    const cv = {};
    root.querySelectorAll('canvas[data-cv]').forEach((c) => (cv[c.dataset.cv] = c));

    /* These must match the preset shown as selected, and the value= attributes
       in the page. The state gate compares all three; two copies of a number
       are a drift waiting to happen and this one is checked. */
    /* M1-12 · `tr` and `trTdr` are two different physical quantities and used to
       be one slider. A transmitter's edge rate shapes the transmitted waveform;
       a TDR's aperture band-limits what the instrument can resolve. Moving one
       used to move the other, and the label called it "Instrument rise time"
       while it was also driving the data edge. */
    const p = { reach: 8, loss: 14, rate: 16, dz: 38, dpos: 45, dlen: 24,
                stub: 0, tr: 12, trTdr: 12, eq: true };
    let M = null, R = null, T = null, sel = 1;     // sel: which post-cursor is inspected
    let impulseIndex = 0, impulseAbsolute = false, impulseFull = false;
    let selectedBit = 68, plotLimit = SWING * 1.25;
    /* The eye and histogram hold one vertical scale instead of rescaling to each
       new signal. It starts at +/-500 mV, grows a step whenever the received signal
       would otherwise be cut off, and never shrinks by itself — so a closing eye
       visibly closes, and two presets can be compared on the same axis. `fit`
       rescales to the signal in front of you on request.

       This is the view only. The eye metrics, the traces and the scenario are
       measured from the signal and do not know what scale it is drawn at. */
    let eyeLimit = EYE_START;
    const eyeNeed = () => Math.max(...R.generated.measured.y.map(Math.abs)) * 1.05;
    let showRaw = true;                            // M6-7, overlay the un-equalised response
    const bits = lfsr(NB, 0x4a1);

    /* M6-8 · Three kinds of preset, kept apart because they answer different
       questions. The old pair was labelled "same board, twice the rate" and
       changed reach AND rate AND — before M1-13 — the frequency the loss figure
       referred to. Three variables at once is not a comparison.

       CONTROLLED pairs change exactly one thing against `pcie4`. PROTOCOL
       examples are what a real interface looks like, and are illustrative
       operating points rather than compliance channels. */
    const PRESETS = {
      pcie4: { reach: 8, loss: 14, rate: 16, dz: 38, dpos: 45, dlen: 24, stub: 0, tr: 12, trTdr: 12,
               note: 'PROTOCOL EXAMPLE · PCIe Gen 4, 16 GT/s NRZ. 14 dB at 8 GHz is a long board channel — and 8 GHz happens to be this rate\u2019s Nyquist, which is why the number is quoted there. This is the baseline the two controlled presets change one thing against.' },

      rateonly: { reach: 8, loss: 14, rate: 32, dz: 38, dpos: 45, dlen: 24, stub: 0, tr: 12, trTdr: 12,
               note: 'CONTROLLED \u00b7 RATE ONLY. The same 8 inches and the same 14 dB at 8 GHz \u2014 literally the same board as Gen 4, with the S-parameters unchanged at every frequency. Only the symbol rate doubles. The eye closes because Nyquist moved to 16 GHz where that same copper loses far more, and because the channel\u2019s memory, fixed in picoseconds, now spans twice as many bits. Nothing about the board changed.' },

      reachonly: { reach: 16, loss: 28, rate: 16, dz: 38, dpos: 45, dlen: 24, stub: 0, tr: 12, trTdr: 12,
               note: 'CONTROLLED \u00b7 REACH ONLY. Twice the length at the same 16 GT/s, and therefore twice the loss at the same 8 GHz \u2014 doubling the copper doubles the decibels. Compare with rate-only: both end up near 28 dB, reached by different mechanisms. One has a longer channel memory in picoseconds; the other has the same memory measured against half the bit period.' },

      pcie5: { reach: 10, loss: 22, rate: 32, dz: 38, dpos: 45, dlen: 24, stub: 0, tr: 12, trTdr: 8,
               note: 'PROTOCOL EXAMPLE \u00b7 PCIe Gen 5, 32 GT/s and a longer reach. Both change at once, which is what a real generation jump does \u2014 so use the two controlled presets to separate the causes before drawing a conclusion from this one.' },

      /* N2-1 / R4. This note used to say the insertion loss "barely moves". It
         moves by 10.09 dB. The two presets share a loss CONTROL value, which is a
         budget applied to the trace sections; the stub adds a quarter-wave notch
         at 8.93 GHz that the budget knows nothing about. The corrected lesson is
         better than the one it replaces, because the reason the eye closes is now
         visible in the panel's own IL readout rather than asserted here. */
      stubby: { reach: 8, loss: 14, rate: 16, dz: 50, dpos: 45, dlen: 0, stub: 28, tr: 12, trTdr: 12,
               note: 'CONTROLLED \u00b7 THE BUDGET SAYS 14 dB. THE CHANNEL SAYS 24.15. Same loss CONTROL as Gen 4, same length, same rate \u2014 and 10.09 dB more insertion loss at Nyquist, because a 28 ps stub is a quarter-wave notch at 8.93 GHz, not extra trace attenuation. That is why the eye falls from 254 mV to 48 mV. Press \u201cno step at all\u201d for the control: matched to 0.06 dB, the eyes match to 0.7%.' },

      /* The control for that comparison. Matched at Nyquist to 0.058 dB using
         only integer control values, which is what makes it reachable. */
      matched: { reach: 8, loss: 14, rate: 16, dz: 50, dpos: 45, dlen: 0, stub: 0, tr: 12, trTdr: 12,
               note: 'CONTROLLED \u00b7 THE ACTUAL CONTROL. Gen 4 with the impedance step removed and nothing put in its place. Insertion loss at Nyquist 14.00 dB against Gen 4\u2019s 14.06 \u2014 matched to 0.058 dB \u2014 and the eyes are 252.6 mV against 254.3, within 0.7%. So a 38 \u03a9 step 24 ps long on an 8 inch channel is very nearly invisible, and the stub preset\u2019s closed eye is the 10 dB it adds, not the shape of its discontinuity.' },

      ufs4: { reach: 4, loss: 8, rate: 23, dz: 42, dpos: 50, dlen: 16, stub: 0, tr: 10, trTdr: 10,
               note: 'PROTOCOL EXAMPLE \u00b7 UFS 4.0 HS-Gear5, 23.3 Gb/s raw. Short reach inside a phone.' }
    };

    /* R is the authoritative record of this run; M stays as the raw arrays the
       drawing code already speaks. Nothing recomputes a measurement locally. */
    /* N4-2 / R10. This is the panel the defect was worst on. Every view
       operation in the loader — a legend toggle, a zoom, a tab switch — went
       through K.redraw, which nudges a physical control; rebuild() cannot tell
       that from the reader moving a slider, so it cleared the selected preset,
       re-solved the whole pipeline and ABANDONED A RUNNING SWEEP. Repainting
       from R does none of that. */
    K.onRepaint(root, () => { if (R && R.status === 'ok') draw(); });
    root.addEventListener('sipi:eye-scale', (e) => {
      if (!R || R.status !== 'ok') return;
      const step = eyeStep(eyeNeed());
      eyeLimit = e.detail === 'fit' ? step : Math.max(EYE_START, step);
      draw();
    });

    function rebuild(preserveSweep) {
      /* Any running sweep describes the previous scenario, so it is
         abandoned rather than allowed to finish into this one. */
      if (sweepJob && !preserveSweep) abandonSweep();
      R = K.publish(root, NS.models.labChannel(p));
      syncControls();
      /* N1-2e. A refused result has no traces to draw and no measurements to
         report, so the panel must say what happened rather than draw the last
         valid scenario under the new control positions — which is the state the
         old preset bug left it in. */
      if (R.status !== 'ok') { M = null; drawUnsupported(); return; }
      M = R.generated.raw;
      frequencyInspector=K.traceInspector(R.traces.find(t=>t.id==='il'));
      frequencyIndex=Math.min(frequencyIndex,M.sweep.length-1);
      plotLimit = Math.max(SWING * 1.25, ...R.generated.measured.y.map(Math.abs)) * 1.05;
      eyeLimit = Math.max(eyeLimit, eyeStep(eyeNeed()));
      selectedBit = Math.max(R.generated.measured.valid.from, Math.min(R.generated.measured.valid.to, selectedBit));
      draw();
    }

    /* Blank every plot, blank every readout, and put the model's own reason where
       the reader is already looking. The controls keep their positions: the point
       is that THIS combination is unsupported, which you cannot see if the panel
       silently snaps back to one that works. */
    function drawUnsupported() {
      frequencyInspector=null;
      $('[data-out="frequency-detail"]').textContent=R.why;
      if ($('[data-out="impulse-detail"]')) $('[data-out="impulse-detail"]').textContent = R.why;
      if ($('[data-out="decision-detail"]')) $('[data-out="decision-detail"]').textContent = R.why;
      if ($('[data-out="decision-terms"]')) $('[data-out="decision-terms"]').replaceChildren();
      if ($('[data-out="decision-remainder"]')) $('[data-out="decision-remainder"]').textContent = '';
      T = K.theme(root);
      drawTopology();
      Object.keys(cv).forEach((k) => {
        const c = cv[k];
        const surf = K.canvas(c, c.clientHeight || 200);
        surf.ctx.clearRect(0, 0, surf.w, surf.h);
        K.text(surf.ctx, 'outside the model domain', surf.w / 2, surf.h / 2,
               T.muted, 12, 'center');
      });
      ['ui', 'nyq', 'eh', 'rl', 'eq', 'tap'].forEach((k) => {
        const n = $('[data-out="' + k + '"]');
        if (n) n.textContent = '—';
      });
      const note = $('[data-out="note"]');
      if (note) note.textContent = R.why || 'This configuration is outside the model domain.';
      const ev = $('[data-out="evidence"]');
      if (ev) ev.textContent = 'unsupported';
    }

    function syncControls() {
      const set = (id, v, txt) => {
        $('#' + id).value = v;
        const out = $('#' + id + '-out');
        // while a discontinuity is hidden its readouts stay blank, or the
        // exercise answers itself
        if (!(hidden && DISC_IDS.indexOf('#' + id) >= 0)) out.value = txt;
      };
      set('lc-reach', p.reach, p.reach + ' in');
      set('lc-loss', p.loss, p.loss + ' dB');
      set('lc-rate', p.rate, p.rate + ' GT/s');
      set('lc-dz', p.dz, p.dz + ' Ω');
      set('lc-dpos', p.dpos, p.dpos + ' %');
      set('lc-dlen', p.dlen, p.dlen + ' ps');
      set('lc-stub', p.stub, p.stub + ' ps');
      set('lc-tr', p.tr, p.tr + ' ps');
      set('lc-trtdr', p.trTdr, p.trTdr + ' ps');
      $('#lc-eq').checked = p.eq;
    }

    function frequencyReadout() {
      const d=M.sweep[frequencyIndex], input=$('#lc-frequency');
      input.min=M.sweep[0].f/1e9;input.max=M.sweep[M.sweep.length-1].f/1e9;input.value=d.f/1e9;
      $('[data-out="frequency-detail"]').textContent='Native sample '+frequencyIndex+' at '+(d.f/1e9).toPrecision(6)+' GHz: '
        +'S21 '+d.s21.toFixed(2)+' dB; S11 '+d.s11.toFixed(2)+' dB; group delay '+(d.gd*1e12).toFixed(2)+' ps. '
        +'Nearest sample in physical frequency; no interpolation. Input/output reference planes, before CTLE.';
    }
    function selectFrequency(f) {
      if(!frequencyInspector)return;
      const q=frequencyInspector.at(f);
      if(q.status!=='ok') {$('[data-out="frequency-detail"]').textContent='Enter a frequency within the sampled range; the previous selection is unchanged.';return;}
      frequencyIndex=q.index; draw();
    }
    $('#lc-frequency').addEventListener('change',e=>selectFrequency(e.target.value===''?NaN:Number(e.target.value)*1e9));
    $('#lc-frequency-go').addEventListener('click',()=>{const el=$('#lc-frequency');selectFrequency(el.value===''?NaN:Number(el.value)*1e9);});
    $('#lc-frequency').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('#lc-frequency-go').click();}});
    [['lc-frequency-prev',-1],['lc-frequency-next',1]].forEach(([id,step])=>$('#'+id).addEventListener('click',()=>{
      if(M)selectFrequency(M.sweep[Math.max(0,Math.min(M.sweep.length-1,frequencyIndex+step))].f);
    }));
    $('#lc-frequency-fit').addEventListener('click',()=>{delete cv.freq.__zoom;delete cv.delay.__zoom;if(M)draw();});
    ['freq','delay'].forEach(key=>{
      cv[key].tabIndex=0;
      cv[key].addEventListener('keydown',e=>{
        const step=e.key==='ArrowLeft'?-1:e.key==='ArrowRight'?1:0;
        if(step&&M){e.preventDefault();selectFrequency(M.sweep[Math.max(0,Math.min(M.sweep.length-1,frequencyIndex+step))].f);}
      });
      cv[key].addEventListener('click',e=>{
        const P=cv[key].__frequencyPlot,r=cv[key].getBoundingClientRect();if(!M||!P||!r.width)return;
        const px=(e.clientX-r.left)*P.box.w/r.width;
        if(px>=P.box.L&&px<=P.box.R)selectFrequency(P.invX(px)*1e9);
      });
    });

    /* ---------- frequency ---------- */
    function drawFreq() {
      const s = K.canvas(cv.freq, 210);
      const P = K.plot(s, T, {
        pad: { l: 52, r: 16, t: 16, b: 30 },
        x: { min: 0.1, max: 3.2 * M.fNyq / 1e9, count: 4, fmt: (v) => v.toFixed(0), title: 'GHz' },
        y: { min: -60, max: 3, count: 5, fmt: (v) => v.toFixed(0), title: 'dB' }
      }).grid();
      P.trace(M.sweep.map((d) => [d.f / 1e9, d.s21]), T.signal, { width: 2.2, glow: true });
      P.trace(M.sweep.map((d) => [d.f / 1e9, d.s11]), T.reflect, { width: 1.8, dash: [4, 3] });
      P.vline(M.fNyq / 1e9, T.ink2, [3, 3], 'Nyquist');
      P.vline(M.sweep[frequencyIndex].f/1e9,T.alarm,[2,3],'selected');
      P.frame(); cv.freq.__frequencyPlot=cv.freq.__plot;
    }

    function drawDelay() {
      const s = K.canvas(cv.delay, 210);
      const gds = M.sweep.map((d) => d.gd * 1e12);
      const lo = Math.min.apply(null, gds), hi = Math.max.apply(null, gds);
      const pad = Math.max(2, (hi - lo) * 0.2);
      const P = K.plot(s, T, {
        pad: { l: 56, r: 16, t: 16, b: 30 },
        x: { min: 0.1, max: 3.2 * M.fNyq / 1e9, count: 4, fmt: (v) => v.toFixed(0), title: 'GHz' },
        y: { min: lo - pad, max: hi + pad, count: 4, fmt: (v) => v.toFixed(0), title: 'ps' }
      }).grid();
      P.trace(M.sweep.map((d) => [d.f / 1e9, d.gd * 1e12]), T.signal, { width: 2.2 });
      P.hline(M.tdTotal * 1e12, T.muted, [4, 4], 'flat-line delay');
      P.vline(M.fNyq / 1e9, T.ink2, [3, 3], null);
      P.vline(M.sweep[frequencyIndex].f/1e9,T.alarm,[2,3],'selected');
      P.frame(); cv.delay.__frequencyPlot=cv.delay.__plot;
    }

    function drawImpulse() {
      const data = NS.models.labChannelImpulse(R, {absolute: impulseAbsolute, full: impulseFull});
      if (!data) return;
      impulseIndex = Math.max(0, Math.min(data.count - 1, impulseIndex));
      const control = $('#lc-impulse-index'); control.max = data.count - 1; control.value = impulseIndex;
      const surf = K.canvas(cv.impulse, 230);
      const P = K.plot(surf, T, {
        pad: {l: 60, r: 18, t: 18, b: 35},
        x: {min: data.offset * 1e9, max: (data.offset + (data.count - 1) * data.dt) * 1e9,
          count: 4, fmt: value => value.toFixed(2), title: impulseAbsolute ? 'ns from input reference' : 'ns after removed delay'},
        y: {min: data.min, max: data.max, count: 4, fmt: value => value.toFixed(3), title: 'weight (V/V)'}
      }).grid();
      P.trace(i => [(data.offset + i * data.dt) * 1e9, data.raw[i]], T.muted,
        {n: data.count, width: 1.4, dash: [4, 3]});
      P.trace(i => [(data.offset + i * data.dt) * 1e9, data.active[i]], T.signal,
        {n: data.count, width: 2});
      const time = data.offset + impulseIndex * data.dt;
      P.vline(time * 1e9, T.reflect, [3, 3], null);
      K.dot(surf.ctx, P.X(time * 1e9), P.Y(data.active[impulseIndex]), T.reflect, T.surface, 5);
      P.frame();
      $('[data-out="impulse-detail"]').textContent = 'Sample ' + impulseIndex + ' at ' +
        (time * 1e12).toFixed(3) + ' ps: raw weight ' + data.raw[impulseIndex].toPrecision(6) +
        ', active weight ' + data.active[impulseIndex].toPrecision(6) + '. Sample interval ' +
        (data.dt * 1e12).toFixed(3) + ' ps; removed delay ' + (M.tdBulk * 1e12).toFixed(3) +
        ' ps. Full-record sums: raw ' + data.sumRaw.toPrecision(6) + ', active ' + data.sumActive.toPrecision(6) +
        '. ' + (M.settled ? 'The impulse tail meets this model’s decay criterion.' :
          'The impulse tail has not decayed within the FFT record. Inspect the full record; its boundary can contain periodic wraparound.') +
        ' Lines join discrete weights; changing the time labels does not change the calculation.';
    }

    /* ---------- time ---------- */
    function drawPulse() {
      const s = K.canvas(cv.pulse, 210);
      const taps = [];
      const c = M.pr.cursor;
      for (let k = -3; k <= 10; k++) {
        const i = c + k * SPS;
        taps.push([k, i >= 0 && i < M.pr.sbr.length ? M.pr.sbr[i] * SWING : 0]);
      }
      const visible = taps.map(tap => tap[1]);
      for (const response of [M.pr.sbr, ...(showRaw && p.eq ? [M.prRaw.sbr] : [])]) {
        for (let i = Math.max(0, c - 3 * SPS); i < Math.min(response.length, c + 11 * SPS); i++) visible.push(response[i] * SWING);
      }
      const low = Math.min(0, ...visible), high = Math.max(0, ...visible);
      const margin = Math.max(.001, (high - low) * .1);
      const P = K.plot(s, T, {
        pad: { l: 52, r: 16, t: 16, b: 30 },
        x: { min: -3.6, max: 10.6, ticks: [-2, 0, 2, 4, 6, 8, 10], fmt: (v) => v.toFixed(0), title: 'UI from cursor' },
        y: { min: low - margin, max: high + margin, count: 4, fmt: (v) => (v * 1000).toFixed(0), title: 'mV' }
      }).grid();
      const ctx = s.ctx;
      taps.forEach(([k, v]) => {
        const on = k === sel;
        const col = k === 0 ? T.signal : (k < 0 ? T.muted : T.reflect);
        K.line(ctx, P.X(k), P.Y(0), P.X(k), P.Y(v), on ? T.alarm : col, on ? 3.5 : 2);
      });
      /* M6-7 · The CONTINUOUS response behind the taps, and the un-equalised one
         beside it. Both were already computed and neither was ever shown, so a
         reader saw sampled stems with no way to ask what happened between them
         — or what the equaliser actually did.

         The continuous curve is what the channel delivers; the stems are what
         the receiver looks at. Seeing them together is the difference between
         "there is a post-cursor" and "here is the tail it is a sample of". */
      const drawCurve = (sbr, colour, width, dash) => {
        const n = Math.min(sbr.length - c + 3 * SPS, 14 * SPS);
        P.trace((i) => {
          const idx = c - 3 * SPS + i;
          return [(idx - c) / SPS, idx >= 0 && idx < sbr.length ? sbr[idx] * SWING : NaN];
        }, colour, { n: n, width: width, dash: dash });
      };
      if (showRaw && p.eq) drawCurve(M.prRaw.sbr, T.muted, 1.2, [4, 3]);
      drawCurve(M.pr.sbr, T.signal, 1.6, null);

      taps.forEach(([k, v]) => {
        const on = k === sel;
        const col = k === 0 ? T.signal : (k < 0 ? T.muted : T.reflect);
        K.dot(ctx, P.X(k), P.Y(v), on ? T.alarm : col, T.surface, on ? 4.5 : 3);
      });

      // Reserve a footer for the key. The cursor label follows its sample and
      // cannot collide with instructions at the top of a narrow plot.
      K.text(ctx, 'cursor', P.X(0) + 7, Math.max(P.box.TP + 12, P.Y(taps[3][1]) + 14), T.signal, 10, 'left');
      if (showRaw && p.eq) {
        K.text(ctx, 'dashed: before EQ', P.box.R - 4, P.box.B - 10,
               T.muted, 10, 'right');
      }
      P.frame();
      cv.pulse.__taps = { taps, P };
    }

    function drawTdr() {
      const s = K.canvas(cv.tdr, 210);
      const n = Math.round(2.4 * M.tdTotal * SPS * M.baud);
      const z = K.tdrProfile(M.s11Imp, Z0, Math.max(1, p.trTdr * 1e-12 * SPS * M.baud), Math.max(64, n));
      const inPerSample = 1 / (SPS * M.baud) / PS_PER_IN / 2;   // round trip → one way
      const P = K.plot(s, T, {
        pad: { l: 52, r: 16, t: 16, b: 30 },
        x: { min: 0, max: z.length * inPerSample, count: 5, fmt: (v) => v.toFixed(1), title: 'inches' },
        y: { min: 20, max: 80, count: 4, fmt: (v) => v.toFixed(0), title: 'Ω' }
      }).grid();
      P.trace((i) => [i * inPerSample, z[i]], T.signal, { n: z.length, width: 2, glow: true });
      P.hline(Z0, T.muted, [4, 4], null);
      P.frame();
    }

    /* ---------- data ---------- */
    function drawBits(y) {
      const s = K.canvas(cv.bits, 210);
      const c = M.pr.cursor;
      const shown = 14;
      const first = Math.max(0, Math.min(NB - shown - 4, selectedBit - 7));
      const P = K.plot(s, T, {
        pad: { l: 52, r: 16, t: 16, b: 30 },
        x: { min: 0, max: shown, count: 7, fmt: (v) => v.toFixed(0), title: 'UI' },
        y: { min: -plotLimit, max: plotLimit, count: 4, fmt: (v) => (v * 1000).toFixed(0), title: 'mV' }
      }).grid();
      const ctx = s.ctx;
      cv.bits.__decisionPlot = { P, first };

      // the transmitted bits, as a faint staircase
      P.trace((i) => {
        const u = (i / 8);
        const b = first + Math.floor(u);
        return [u, b < NB ? bits[b] * SWING : 0];
      }, T.muted, { n: shown * 8 + 1, width: 1.2, dash: [3, 3] });

      P.trace((i) => [i / SPS, y[(first * SPS) + c + i] || 0],
              T.signal, { n: shown * SPS + 1, width: 2.2, glow: true });

      /* The inspected sample, and the bit that the selected post-cursor says is
         responsible for part of its error. This is the link the lab exists for:
         a tap on the pulse response is not an abstraction, it is a specific
         earlier bit still arriving. */
      const insp = selectedBit - first;
      const src = insp - sel;
      P.vline(insp, T.ink2, [3, 3], 'sample');
      K.dot(ctx, P.X(insp), P.Y(y[selectedBit * SPS + c]), T.reflect, T.surface, 5);
      if (src >= 0 && src < shown) {
        const x0 = P.X(src), x1 = P.X(src + 1);
        ctx.save();
        ctx.fillStyle = K.rgba(T.alarm, 0.16);
        ctx.fillRect(x0, P.box.TP, x1 - x0, P.box.B - P.box.TP);
        ctx.restore();
        K.text(ctx, sel === 0 ? 'this bit' : (sel > 0 ? sel + ' UI earlier' : -sel + ' UI later'),
               (x0 + x1) / 2, P.box.TP + 8, T.alarm, 10, 'center');
      }
      P.frame();
    }

    function drawEye(y, m) {
      const s = K.canvas(cv.eye, 230);
      const ctx = s.ctx, w = s.w, h = s.h;
      const L = 46, R = w - 14, TP = 26, B = h - 26;
      ctx.clearRect(0, 0, w, h);
      const X = (u) => L + u * (R - L);
      const Y = (v) => B - (v + eyeLimit) / (2 * eyeLimit) * (B - TP);

      K.line(ctx, L, TP, L, B, T.border, 1);
      K.line(ctx, L, B, R, B, T.border, 1);
      K.line(ctx, L, Y(0), R, Y(0), T.grid, 1);
      for (const v of [-eyeLimit / 2, eyeLimit / 2]) K.line(ctx, L, Y(v), R, Y(v), T.grid, 1);
      for (const u of [0, 0.5, 1]) K.line(ctx, X(u), TP, X(u), B, T.grid, 1);
      K.text(ctx, '0', X(0), B + 12, T.muted, 10, 'center');
      K.text(ctx, '1 UI', X(1), B + 12, T.muted, 10, 'center');
      K.text(ctx, 'mV', L - 6, TP - 14, T.muted, 10, 'right');
      for (const v of [-eyeLimit, -eyeLimit / 2, 0, eyeLimit / 2, eyeLimit]) K.text(ctx, (v * 1000).toFixed(0), L - 6, Y(v), T.muted, 10, 'right');

      /* M1-5 · The window is CENTRED on the decision instant, so the middle of
         the drawn eye is the instant the receiver actually samples and the
         instant the tap readout reports. Before, the window started at the
         cursor and the measurement was taken half a UI further on, so the
         marked opening was not at the middle of the picture it was drawn on. */
      const at = m.at, half = Math.round(SPS / 2);
      ctx.save();
      ctx.beginPath(); ctx.rect(L, TP, R - L, B - TP); ctx.clip();
      for (let b = m.valid.from; b <= m.valid.to; b++) {
        /* Coloured by the symbol that was SENT, so a trajectory that crosses to
           the wrong side stays visibly in its own population instead of joining
           the other one. */
        ctx.strokeStyle = K.rgba(m.symbols[b - m.valid.from] > 0 ? T.signal : T.reflect, 0.26);
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = -half; i <= half; i++) {
          const v = y[b * SPS + at + i]; if (v === undefined) break;
          const x = X((i + half) / SPS), yy = Y(v);
          i === -half ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
      ctx.strokeStyle = T.ink; ctx.lineWidth = 2; ctx.beginPath();
      for (let i = -half; i <= half; i++) {
        const value = y[selectedBit * SPS + at + i];
        const x = X((i + half) / SPS), yy = Y(value);
        i === -half ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
      }
      ctx.stroke();
      K.dot(ctx, X(.5), Y(y[selectedBit * SPS + at]), T.ink, T.surface, 5);
      ctx.restore();

      K.text(ctx, 'decision', X(0.5), TP + 9, T.ink2, 10, 'center');
      if (m.populated) {
        K.line(ctx, X(0.5), Y(m.loHi), X(0.5), Y(m.hiLo), m.eh > 0 ? T.reflect : T.alarm, 2);
      }
      cv.eye.dataset.eyeLimit = String(eyeLimit);
      return { eh: m.eh, hiLo: m.hiLo, loHi: m.loHi };
    }

    function drawHist(y, m) {
      const s = K.canvas(cv.hist, 230);
      const vals = m.vals;
      const lim = eyeLimit, nb = 61;
      const binsHi = new Float64Array(nb), binsLo = new Float64Array(nb);
      vals.forEach((v, i) => {
        const k = Math.max(0, Math.min(nb - 1, Math.round((v + lim) / (2 * lim) * (nb - 1))));
        // M1-6 · binned by the transmitted symbol, so the overlap between the
        // two populations is visible instead of being folded away at zero
        (m.symbols[i] > 0 ? binsHi : binsLo)[k]++;
      });
      const peak = Math.max(1, Math.max.apply(null, [...binsHi, ...binsLo]));
      const P = K.plot(s, T, {
        pad: { l: 52, r: 16, t: 14, b: 30 },
        x: { min: 0, max: peak, count: 3, fmt: (v) => v.toFixed(0), title: 'count' },
        y: { min: -lim, max: lim, count: 4, fmt: (v) => (v * 1000).toFixed(0), title: 'mV' }
      }).grid();
      const ctx = s.ctx;
      for (let k = 0; k < nb; k++) {
        const v = -lim + (k / (nb - 1)) * 2 * lim;
        [[binsHi[k], T.signal], [binsLo[k], T.reflect]].forEach(([n2, col]) => {
          if (n2 <= 0) return;
          K.line(ctx, P.X(0), P.Y(v), P.X(n2), P.Y(v), col, 2.6);
        });
      }
      const selectedValue = y[selectedBit * SPS + m.at];
      P.hline(selectedValue, T.ink, [3, 3], null);
      P.frame();
      /* Where the two populations overlap, the eye is closed there and the
         reader should see the crossing rather than infer it. */
      if (m.populated && m.eh <= 0) {
        K.line(ctx, P.X(0), P.Y(m.hiLo), P.X(peak), P.Y(m.hiLo), T.alarm, 1);
        K.line(ctx, P.X(0), P.Y(m.loHi), P.X(peak), P.Y(m.loHi), T.alarm, 1);
        K.text(ctx, 'populations overlap', P.X(peak), P.Y((m.hiLo + m.loHi) / 2), T.alarm, 10, 'right');
      }
      return vals;
    }

    function readouts(m) {
      const set = (k, v) => { const e = $('[data-out="' + k + '"]'); if (e) e.textContent = v; };
      set('ui', M.uiPs.toFixed(1) + ' ps');
      set('nyq', (M.fNyq / 1e9).toFixed(1) + ' GHz');
      /* N2-1. The MEASURED insertion loss at Nyquist, so the comparison between
         two presets verifies itself on screen instead of being asserted in a
         note. The loss control beside it is a budget, and the two disagree by
         10.09 dB on the stub preset — which was the whole defect. */
      set('il', M.ilNyq.toFixed(2) + ' dB');
      set('rl', isFinite(M.rlDb) ? M.rlDb.toFixed(1) + ' dB' : '—');
      set('eq', p.eq ? M.boost.toFixed(0) + ' dB boost' : 'off');
      const at = m.at;
      const tap = M.pr.sbr[at + sel * SPS];
      set('tap', sel === 0 ? 'cursor' :
        (sel > 0 ? '+' : '') + sel + ' UI · ' + ((tap || 0) * SWING * 1000).toFixed(0) + ' mV');

      /* M1-7 · Name the quantity. This is the extremal gap between the two
         transmitted populations over one period of a PRBS7 — not a percentile,
         not a BER contour, and not comparable to a compliance eye height. An
         empty population is "no measurement", never a closed eye. */
      const ehEl = $('[data-out="eh"]');
      if (!m.populated) {
        set('eh', 'no measurement');
        if (ehEl) ehEl.style.color = 'var(--muted)';
      } else {
        set('eh', (m.eh <= 0 ? 'closed by ' : '') + (m.eh * 1000).toFixed(0) + ' mV');
        if (ehEl) ehEl.style.color = m.eh <= 0 ? 'var(--alarm-text)' : 'var(--ink)';
      }

      // M1-8 · the count comes from the decisions actually made
      set('evidence', K.berFloorText(m.valid.count, m.wrong));

      const rows = [
        { label: 'reach', value: p.reach + ' in',
          note: (M.tdTotal * 1e12).toFixed(0) + ' ps nominal, '
                + (M.tdBulk * 1e12).toFixed(0) + ' ps wavefront' },
        { label: 'sections in the cascade', value: String(M.secs.length),
          note: M.secs.map((x) => x.type).join(' → ') },
        { label: 'worst gap between the two symbol populations',
          value: m.populated ? (m.eh * 1000).toFixed(0) + ' mV' : 'no measurement',
          note: 'over one PRBS7 period at the decision instant',
          colour: m.populated && m.eh > 0 ? 'signal' : 'alarm' },
        { label: 'wrong decisions', value: m.wrong + ' of ' + m.valid.count,
          colour: m.wrong ? 'alarm' : 'signal' },
        { label: 'channel memory', value: (M.memoryNeeded / SPS).toFixed(0) + ' UI',
          note: M.settled ? 'decayed before the record wraps'
                          : 'NOT settled — ' + (M.periodicResidual * 100).toFixed(1)
                            + '% leaks between periods' }
      ];
      K.summary(root, rows, { label: 'This channel' });
    }

    /* ---------- M7-1 · the two-parameter surface ----------
       Chunked across frames, with a generation counter. A4 is explicit that a
       sweep must reject stale results: a reader who moves a control mid-sweep
       would otherwise get cells from two scenarios blended into one surface,
       and it would look entirely plausible. */
    let sweepJob = null, sweepGen = 0, sweepRaf = 0, selectedCell = 0, sweepComparison = null;

    function startSweep() {
      const gen = ++sweepGen;
      cancelAnimationFrame(sweepRaf);
      selectedCell = 0;
      sweepComparison = null;
      sweepJob = NS.models.labChannelSweep(p, {
        nx: 11, ny: 11,
        x: { key: 'stub', lo: 0, hi: 40 },
        y: { key: 'loss', lo: 4, hi: 24 }
      });
      const tick = () => {
        if (gen !== sweepGen) return;              // a newer sweep has started
        const until = performance.now() + 12;      // stay inside a frame
        let done = false;
        while (!done && performance.now() < until) done = sweepJob.step();
        drawSweep();
        if (!done) sweepRaf = requestAnimationFrame(tick);
      };
      sweepRaf = requestAnimationFrame(tick);
    }

    function abandonSweep() {
      sweepGen++;                                  // invalidates any running job
      cancelAnimationFrame(sweepRaf);
      sweepJob = null;
      sweepComparison = null;
      drawSweep();
    }

    function drawSweep() {
      if (!cv.sweep) return;
      const s = K.canvas(cv.sweep, 230);
      const ctx = s.ctx, w = s.w, h = s.h;
      ctx.clearRect(0, 0, w, h);
      const L = 52, Rr = w - 74, TP = 18, B = h - 32;
      cv.sweep.__cellBox = { L, Rr, TP, B, w };
      sweepReadout();

      if (!sweepJob) {
        K.text(ctx, 'press “sweep the surface” to compute it', (L + Rr) / 2,
               (TP + B) / 2, T.muted, 11, 'center');
        K.text(ctx, 'Select a completed cell to compare resolutions',
               (L + Rr) / 2, (TP + B) / 2 + 16, T.muted, 10, 'center');
        return;
      }
      const J = sweepJob, nx = J.nx, ny = J.ny;
      const cw = (Rr - L) / nx, ch = (B - TP) / ny;
      /* Scale from the cells computed SO FAR, so a partial surface is readable
         rather than flashing as the range fills in. */
      let mx = 0;
      J.cells.forEach((c) => { if (c.ok && c.eye > mx) mx = c.eye; });
      mx = Math.max(mx, 0.05);

      J.cells.forEach((c) => {
        if (c.eye === undefined) return;           // not computed yet
        const x = L + c.i * cw, y = B - (c.j + 1) * ch;
        if (!c.ok) {
          /* A4 · unavailable, not interpolated. Hatched so it cannot read as a
             value, and never given a colour from the scale. */
          ctx.save();
          ctx.strokeStyle = T.border; ctx.lineWidth = 1;
          ctx.beginPath();
          for (let o = 0; o < cw + ch; o += 4) {
            ctx.moveTo(x + Math.min(o, cw), y + Math.max(0, o - cw));
            ctx.lineTo(x + Math.max(0, o - ch), y + Math.min(o, ch));
          }
          ctx.stroke(); ctx.restore();
          return;
        }
        /* N2-2f. An undecayed impulse tail does NOT invalidate the eye, which is
           what this surface plots — so the cell keeps its colour and carries a
           small mark instead of being hatched away. Two different statements,
           two different marks. */
        if (c.tailUndecayed) {
          ctx.save();
          ctx.globalAlpha = 0.5;
          ctx.fillStyle = T.ink2;
          ctx.beginPath();
          ctx.arc(x + cw - 3.5, y + 3.5, 1.2, 0, 2 * Math.PI);
          ctx.fill(); ctx.restore();
        }
        if (c.eye <= 0) {
          ctx.fillStyle = K.rgba(T.alarm, 0.25 + 0.6 * Math.min(1, -c.eye / (0.15 * mx)));
        } else {
          ctx.fillStyle = K.rgba(T.signal, 0.12 + 0.8 * (c.eye / mx));
        }
        ctx.fillRect(x, y, cw + 0.5, ch + 0.5);
      });

      // axes, in the units the controls use
      K.line(ctx, L, TP, L, B, T.border, 1);
      K.line(ctx, L, B, Rr, B, T.border, 1);
      for (const f of [0, 0.5, 1]) {
        K.text(ctx, (J.spec.x.lo + f * (J.spec.x.hi - J.spec.x.lo)).toFixed(0),
               L + cw / 2 + f * (Rr - L - cw), B + 13, T.muted, 10, 'center');
        K.text(ctx, (J.spec.y.lo + f * (J.spec.y.hi - J.spec.y.lo)).toFixed(0),
               L - 6, B - ch / 2 - f * (B - TP - ch), T.muted, 10, 'right');
      }
      K.text(ctx, 'stub, ps', (L + Rr) / 2, B + 26, T.muted, 10, 'center');
      /* Rotated up the y-axis rather than parked at the top-left, where it
         collided with the progress line. */
      ctx.save();
      ctx.translate(L - 34, (TP + B) / 2);
      ctx.rotate(-Math.PI / 2);
      K.text(ctx, 'loss at 8 GHz, dB', 0, 0, T.muted, 10, 'center');
      ctx.restore();

      const chosen = J.cells[selectedCell];
      if (chosen) {
        ctx.strokeStyle = T.ink; ctx.lineWidth = 2;
        ctx.strokeRect(L + chosen.i * cw + 1, B - (chosen.j + 1) * ch + 1, cw - 2, ch - 2);
      }

      // where the panel's own settings sit on the surface
      const px = L + cw / 2 + (Rr - L - cw) * (p.stub - J.spec.x.lo) / (J.spec.x.hi - J.spec.x.lo);
      const py = B - ch / 2 - (B - TP - ch) * (p.loss - J.spec.y.lo) / (J.spec.y.hi - J.spec.y.lo);
      if (px >= L && px <= Rr && py >= TP && py <= B) {
        K.line(ctx, px, TP, px, B, T.ink2, 1, [3, 3]);
        K.line(ctx, L, py, Rr, py, T.ink2, 1, [3, 3]);
        K.dot(ctx, px, py, T.ink, T.surface, 4);
        K.text(ctx, 'you are here', Math.min(px + 6, Rr - 4), TP + 10, T.ink2, 10, 'left');
      }

      // scale, and the progress that produced it
      const sx = Rr + 14;
      for (let k = 0; k <= 24; k++) {
        const v = (k / 24) * mx;
        ctx.fillStyle = K.rgba(T.signal, 0.12 + 0.8 * (v / mx));
        ctx.fillRect(sx, B - (k + 1) * (B - TP) / 25, 12, (B - TP) / 25 + 0.5);
      }
      K.text(ctx, (mx * 1000).toFixed(0) + ' mV', sx + 15, TP, T.muted, 10, 'left');
      K.text(ctx, 'closed', sx + 15, B - 4, T.alarm, 10, 'left');
      const pc = Math.round(100 * J.done / J.cells.length);
      K.text(ctx, pc < 100 ? 'computing… ' + pc + '%'
             : J.cells.length + ' builds · ±' + (J.tolerance * 1000).toFixed(1) + ' mV',
             L, TP - 6, pc < 100 ? T.reflect : T.muted, 10, 'left');
    }

    function draw() {
      T = K.theme(root);
      drawFreq(); drawDelay(); frequencyReadout(); drawImpulse(); drawPulse(); drawTdr();
      const m = R.generated.measured;
      drawBits(m.y);
      drawEye(m.y, m);
      drawHist(m.y, m);
      readouts(m);
      decisionReadout();
      drawTopology();
      drawSweep();
    }

    function drawTopology() {
      const host = $('[data-out="channel-topology"]'); host.replaceChildren();
      if (hidden) { host.textContent = 'Topology details are hidden during the discontinuity hunt.'; return; }
      if (!M) { host.textContent = 'This setting is outside the channel model domain.'; return; }
      const nodes = [{ title: 'Input plane · 50 Ω', detail: 'S11 measured here', control: 'lc-reach' }];
      M.secs.forEach((section, i) => nodes.push({
        title: section.type === 'stub' ? 'Shunt open stub' : 'Line section ' + (i + 1),
        detail: section.z + ' Ω · ' + (section.td * 1e12).toFixed(1) + ' ps' +
          (section.type === 'stub' ? ' one-way branch delay' : ' nominal delay'),
        control: section.type === 'stub' ? 'lc-stub' : i > 0 && i < M.secs.length - 1 ? 'lc-dz' : 'lc-reach',
        shunt: section.type === 'stub'
      }));
      nodes.push({title: 'Output plane · 50 Ω', detail: 'S21 ends here', control: 'lc-loss'},
        {title: p.eq ? 'Receiver · CTLE on' : 'Receiver · CTLE off', detail: 'Equalizer follows the channel reference plane', control: 'lc-eq'});
      nodes.forEach(node => {
        const button = document.createElement('button'); button.type = 'button';
        button.className = 'topology-node' + (node.shunt ? ' topology-node--shunt' : '');
        const title = document.createElement('strong'); title.textContent = node.title;
        const detail = document.createElement('span'); detail.textContent = node.detail;
        button.append(title, detail);
        button.addEventListener('click', () => {
          const control = $('#' + node.control), group = control.closest('details');
          const toggle = root.querySelector('.controls-toggle');
          if (toggle && toggle.getAttribute('aria-expanded') === 'false') toggle.click();
          if (group) group.open = true;
          control.focus(); control.scrollIntoView({block: 'center'});
        });
        host.appendChild(button);
      });
    }

    function sweepReadout() {
      const host = $('[data-out="sweep-selection"]');
      const load = $('[data-act="load-cell"]');
      if (!host || !load) return;
      if (!sweepJob) { host.textContent = 'Run a sweep, then select a cell by click or arrow keys.'; load.disabled = true; return; }
      const cell = sweepJob.cells[selectedCell], p0 = sweepJob.baseParams;
      load.disabled = !cell || !cell.ok || hidden;
      if (!cell) return;
      host.textContent = 'Selected: stub ' + cell.x + ' ps, loss setting ' + cell.y + ' dB at 8 GHz. ' +
        (cell.eye === undefined ? 'Still computing.' : !cell.ok ? cell.why : 'Sweep eye: ' + (cell.eye * 1000).toFixed(3) + ' mV.') +
        ' Held: reach ' + p0.reach + ' in, rate ' + p0.rate + ' GT/s, discontinuity ' + p0.dz +
        ' Ω at ' + p0.dpos + '%, length ' + p0.dlen + ' ps; TX edge ' + p0.tr +
        ' ps, TDR edge ' + p0.trTdr + ' ps; CTLE ' + (p0.eq ? 'on' : 'off') + '. ' +
        'Sweep FFT: ' + sweepJob.nfft + ' points. ' + (hidden ? 'End the discontinuity hunt before loading a cell.' : '') +
        (sweepComparison && sweepComparison.index === selectedCell ? sweepComparison.text : '');
    }
    $('[data-act="load-cell"]').addEventListener('click', () => {
      if (!sweepJob || hidden) return;
      const cell = sweepJob.cells[selectedCell]; if (!cell || !cell.ok) return;
      Object.assign(p, sweepJob.baseParams, {stub: cell.x, loss: cell.y});
      clearPreset(); rebuild(true);
      const full = R.measurements;
      sweepComparison = {index: selectedCell, text: full ?
        ' Full FFT: ' + R.origins.nfft + ' points. Full-resolution eye: ' + (full.eyeHeight * 1000).toFixed(3) +
        ' mV; difference (full − sweep): ' + ((full.eyeHeight - cell.eye) * 1000).toFixed(3) +
        ' mV. ' + (Math.abs(full.eyeHeight - cell.eye) <= sweepJob.tolerance ? 'Within the sweep comparison budget.' : 'Exceeds the sweep comparison budget; use the full-resolution result.') : ' Full-resolution result refused: ' + R.why};
      sweepReadout();
    });
    cv.sweep.tabIndex = 0;
    cv.sweep.addEventListener('keydown', event => {
      if (!sweepJob) return;
      const delta = {ArrowLeft: -1, ArrowRight: 1, ArrowUp: sweepJob.nx, ArrowDown: -sweepJob.nx}[event.key];
      if (delta === undefined) return;
      event.preventDefault(); selectedCell = Math.max(0, Math.min(sweepJob.cells.length - 1, selectedCell + delta)); drawSweep();
    });
    cv.sweep.addEventListener('click', event => {
      if (!sweepJob || !cv.sweep.__cellBox) return;
      const box = cv.sweep.__cellBox, rect = cv.sweep.getBoundingClientRect();
      if (!rect.width) return;
      const x = (event.clientX - rect.left) * box.w / rect.width, y = (event.clientY - rect.top) * box.w / rect.width;
      if (x < box.L || x >= box.Rr || y <= box.TP || y > box.B) return;
      const i = Math.floor((x - box.L) / (box.Rr - box.L) * sweepJob.nx);
      const j = Math.floor((box.B - y) / (box.B - box.TP) * sweepJob.ny);
      selectedCell = j * sweepJob.nx + i; drawSweep();
    });

    $('#lc-impulse-index').addEventListener('change', event => {
      const value = Number(event.target.value);
      if (Number.isFinite(value)) impulseIndex = Math.round(value);
      if (M) drawImpulse();
    });
    $('#lc-impulse-time').addEventListener('change', event => {
      impulseAbsolute = event.target.value === 'absolute'; delete cv.impulse.__zoom; if (M) drawImpulse();
    });
    $('#lc-impulse-span').addEventListener('change', event => {
      impulseFull = event.target.value === 'full'; delete cv.impulse.__zoom; if (M) drawImpulse();
    });
    cv.impulse.tabIndex = 0;
    cv.impulse.addEventListener('keydown', event => {
      if (!M || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault(); impulseIndex += event.key === 'ArrowRight' ? 1 : -1; drawImpulse();
    });

    function decisionReadout() {
      const d = NS.models.labChannelDecision(R, selectedBit);
      if (!d) return;
      const input = $('#lc-decision');
      input.min = R.generated.measured.valid.from; input.max = R.generated.measured.valid.to; input.value = selectedBit;
      const mv = value => (value * 1000).toFixed(2) + ' mV';
      $('[data-out="decision-detail"]').textContent = 'Symbol ' + d.bit + ': sent ' +
        (d.transmitted > 0 ? '+1' : '−1') + ', detected ' + (d.detected > 0 ? '+1' : '−1') +
        ' (' + (d.correct ? 'correct' : 'wrong') + '). Sample ' + mv(d.value) +
        ' = desired-symbol contribution ' + mv(d.main) + ' + ISI ' + mv(d.isi) +
        '. Threshold: 0 V; an exactly zero sample is decided as −1. ' +
        'Raw channel at this same sampling instant: ' + mv(d.rawValue) +
        '. Active path: ' + (p.eq ? 'channel + CTLE' : 'raw channel') +
        '; no DFE or noise model. Reconstruction residual: ' + d.residual.toExponential(2) + ' V.';
      const host = $('[data-out="decision-terms"]'); host.replaceChildren();
      const selectedTerm = d.terms.find(term => term.offset === sel);
      const terms = d.terms.slice(0, 8);
      const desiredTerm = d.terms.find(term => term.offset === 0);
      for (const term of [desiredTerm, selectedTerm]) if (term && !terms.includes(term)) terms.push(term);
      for (const term of terms) {
        const row = document.createElement('tr');
        row.classList.toggle('decision-term-selected', term.offset === sel);
        if (term.offset === sel) row.setAttribute('aria-current', 'true');
        const label = term.offset === 0 ? 'desired' : term.offset > 0 ? term.offset + ' UI earlier' : -term.offset + ' UI later';
        for (const text of [term.source + ' (' + label + ')', term.symbol > 0 ? '+1' : '−1', term.weight.toFixed(5), mv(term.contribution)]) {
          const cell = document.createElement('td'); cell.textContent = text; row.appendChild(cell);
        }
        host.appendChild(row);
      }
      $('[data-out="decision-remainder"]').textContent = 'Inspected SBR offset: ' + sel + ' UI; contribution ' + mv(selectedTerm ? selectedTerm.contribution : 0) + '. Highlighted row follows the selected tap. Largest contributions shown' +
        (terms.length > 8 ? ', including desired and inspected terms' : '') + '. All remaining symbols sum to ' +
        mv(d.sum - terms.reduce((total, term) => total + term.contribution, 0)) +
        '. Weights come from the active single-bit response; signed symbol amplitude is multiplied by its weight.';
    }
    function chooseDecision(value) {
      if (!R || R.status !== 'ok') return;
      const valid = R.generated.measured.valid;
      if (!Number.isFinite(value)) return;
      selectedBit = Math.max(valid.from, Math.min(valid.to, Math.round(value))); draw();
    }
    $('#lc-decision').addEventListener('change', event => chooseDecision(Number(event.target.value)));
    $('[data-act="decision-prev"]').addEventListener('click', () => chooseDecision(selectedBit - 1));
    $('[data-act="decision-next"]').addEventListener('click', () => chooseDecision(selectedBit + 1));
    $('[data-act="decision-worst"]').addEventListener('click', () => {
      if (!R || R.status !== 'ok') return;
      const m = R.generated.measured;
      let worst = 0;
      for (let i = 1; i < m.vals.length; i++) if (m.vals[i] * m.symbols[i] < m.vals[worst] * m.symbols[worst]) worst = i;
      chooseDecision(m.valid.from + worst);
    });
    cv.bits.tabIndex = 0;
    cv.bits.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault(); chooseDecision(selectedBit + (event.key === 'ArrowRight' ? 1 : -1));
    });
    cv.bits.addEventListener('click', event => {
      if (!M || !cv.bits.__decisionPlot) return;
      const { P, first } = cv.bits.__decisionPlot, rect = cv.bits.getBoundingClientRect();
      if (!rect.width) return;
      const x = (event.clientX - rect.left) * P.box.w / rect.width;
      const unit = (x - P.X(0)) / (P.X(1) - P.X(0));
      chooseDecision(first + unit);
    });

    /* ---------- the linked cursor (P4-4) ---------- */
    cv.pulse.addEventListener('click', (e) => {
      const info = cv.pulse.__taps;
      if (!info) return;
      const r = cv.pulse.getBoundingClientRect();
      /* A canvas inside a hidden tab panel has no layout box, and dividing by a
         zero width turns every following number into NaN — which then fails the
         distance test and does nothing, silently. Bail while it is still obvious. */
      if (!(r.width > 0) || !(info.P.box.w > 0)) return;
      const scale = r.width / info.P.box.w;
      const px = (e.clientX - r.left) / scale;
      let best = null, bd = Infinity;
      info.taps.forEach(([k]) => {
        const d = Math.abs(info.P.X(k) - px);
        if (d < bd) { bd = d; best = k; }
      });
      if (best !== null && bd < 26) { sel = best; draw(); }
    });
    cv.pulse.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      sel = Math.max(-3, Math.min(10, sel + d));
      draw();
    });

    /* ---------- controls ---------- */
    [['lc-reach', 'reach'], ['lc-loss', 'loss'], ['lc-rate', 'rate'], ['lc-dz', 'dz'],
     ['lc-dpos', 'dpos'], ['lc-dlen', 'dlen'], ['lc-stub', 'stub'], ['lc-tr', 'tr'],
     ['lc-trtdr', 'trTdr']
    ].forEach(([id, key]) => {
      $('#' + id).addEventListener('input', (e) => {
        p[key] = +e.target.value;
        /* Changing the reach while a discontinuity is hidden would move it, so
           the hunt is abandoned rather than quietly becoming unanswerable. */
        if (hidden && key === 'reach') { hidden = false; lockDisc(false);
          $('[data-out="verdict"]').textContent = 'Reach changed — hunt abandoned.'; }
        clearPreset(); rebuild();
      });
    });
    const sweepBtn = root.querySelector('[data-act="sweep"]');
    if (sweepBtn) sweepBtn.addEventListener('click', () => {
      if (sweepJob && sweepJob.done < sweepJob.cells.length) { abandonSweep(); return; }
      startSweep();
    });

    const rawBox = $('#lc-raw');
    if (rawBox) rawBox.addEventListener('change', (e) => { showRaw = e.target.checked; draw(); });

    $('#lc-eq').addEventListener('change', (e) => { p.eq = e.target.checked; rebuild(); });

    /* ---------- find it (P4-2) ----------
       The point of a TDR is not that it draws a nice profile, it is that you can
       read a position off one. So: hide a discontinuity, disable the controls
       that would give it away, and make the reader say where it is. The verdict
       reports the miss in inches AND in picoseconds of round trip, against the
       instrument's own resolution, because "0.3 inches out" means nothing until
       you know what the edge rate could have resolved. */
    let hidden = false, tries = 0;
    const DISC_IDS = ['#lc-dz', '#lc-dpos', '#lc-dlen', '#lc-stub'];

    function lockDisc(on) {
      DISC_IDS.forEach((id) => {
        const el2 = $(id);
        el2.disabled = on;
        const out = $(id + '-out');
        if (out) { out.dataset.was = out.dataset.was || out.value; out.value = on ? '?' : out.dataset.was; }
        const box = el2.closest('.ctl');
        if (box) box.classList.toggle('is-locked', on);
      });
    }

    function hideOne() {
      tries++;
      const r = K.rng(0x51b1 + tries * 977);
      p.dpos = Math.round(12 + r() * 76);            // 12–88% of the reach
      p.dz = r() < 0.5 ? Math.round(26 + r() * 12) : Math.round(62 + r() * 14);
      p.dlen = Math.round(18 + r() * 30);
      p.stub = 0;
      hidden = true;
      lockDisc(true);
      $('[data-out="verdict"]').textContent =
        'Hidden. Read the TDR panel and give a distance in inches.';
      $('#lc-guess').value = '';
      $('#lc-guess').focus();
      clearPreset();
      rebuild();
    }

    function checkGuess() {
      if (!hidden) {
        $('[data-out="verdict"]').textContent = 'Press “hide one” first.';
        return;
      }
      const g = parseFloat($('#lc-guess').value);
      if (!isFinite(g)) { $('[data-out="verdict"]').textContent = 'Give a distance in inches.'; return; }
      const truth = p.reach * (p.dpos / 100);
      const err = g - truth;
      const errPs = Math.abs(err) * 170 * 2;         // round trip
      /* tr·v/2 — the round trip halves it. The *2/2 that used to be here
         cancelled, and the panel reported twice the resolution the edge
         actually gives. */
      const res = p.trTdr / 170 / 2;                 // inches the APERTURE can resolve
      const verdict = Math.abs(err) <= 0.3 ? 'Found it.'
                    : Math.abs(err) <= 0.8 ? 'Close.' : 'Not yet.';
      $('[data-out="verdict"]').textContent =
        verdict + ' It is at ' + truth.toFixed(2) + ' in (' + Math.round(p.dz) + ' Ω, '
        + Math.round(p.dlen) + ' ps). You were ' + Math.abs(err).toFixed(2) + ' in out — '
        + errPs.toFixed(0) + ' ps of round trip, against an instrument that resolves about '
        + res.toFixed(2) + ' in at this edge rate.';
      hidden = false;
      lockDisc(false);
      syncControls();
    }

    $('[data-act="hide"]').addEventListener('click', hideOne);
    $('[data-act="check"]').addEventListener('click', checkGuess);
    $('#lc-guess').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); checkGuess(); }
    });

    function clearPreset() {
      root.querySelectorAll('.preset[data-preset]')
          .forEach((b) => b.setAttribute('aria-pressed', 'false'));
      $('[data-out="note"]').textContent = 'Custom';
    }
    /* N1-1 / R1. This handler shipped in 6c43501 reading `q.note`, where the only
       `q` in this file is a const inside another function — so every preset threw
       a ReferenceError before rebuild() ran, including the one the homepage
       features. The parameters were assigned BEFORE the throw, so a later
       unrelated control event applied changes the reader never saw.

       Three things fix it, and the ordering is the one that matters:
         1. select `.preset[data-preset]`, not `.preset`. Two buttons on this page
            carry class `preset` for styling and `data-act` for behaviour, and the
            bare selector caught them too.
         2. look the preset up and validate it BEFORE touching any state, so an
            unknown name leaves the panel exactly as it was.
         3. apply parameters, pressed state, note and rebuild as one block that
            either runs completely or does not start. */
    root.querySelectorAll('.preset[data-preset]').forEach((b) => {
      b.addEventListener('click', () => {
        const cfg = PRESETS[b.dataset.preset];
        if (!cfg) return;
        if (hidden) { hidden = false; lockDisc(false); $('[data-out="verdict"]').textContent = '—'; }
        Object.assign(p, cfg);
        root.querySelectorAll('.preset[data-preset]')
            .forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
        $('[data-out="note"]').textContent = cfg.note;
        rebuild();
      });
    });

    Object.assign(p, PRESETS.pcie4);
    rebuild();
    $('[data-out="note"]').textContent = PRESETS.pcie4.note;
    root.querySelector('.preset[data-preset="pcie4"]').setAttribute('aria-pressed', 'true');

    document.addEventListener('sipi:theme', draw);
    let rt = 0;
    const onResize = () => { clearTimeout(rt); rt = setTimeout(draw, 140); };
    window.addEventListener('resize', onResize);

    return {
      start() {}, stop() {},
      destroy() {
        window.removeEventListener('resize', onResize);
        document.removeEventListener('sipi:theme', draw);
      }
    };
  };
  /* For the model gate: the ladder is a pure function of the signal it has to
     contain, and is checked without a DOM. */
  NS.viz.labChannel.eyeLadder = { steps: EYE_STEPS, start: EYE_START, step: eyeStep };
})();
