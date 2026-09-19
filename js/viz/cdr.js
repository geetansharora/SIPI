/* CDR jitter transfer, residual error, and tolerance — three readings of one loop.
 *
 * WHY THIS PANEL EXISTS.
 *
 * The page it sits on used to say "jitter transfer ~ low-pass, jitter tolerance
 * ~ high-pass", and then, four paragraphs later, "tolerance is high-pass and
 * rises steeply at low frequency". Those two halves contradict each other: a
 * high-pass response FALLS at low frequency. The sentence was reaching for
 * something true and naming the wrong function.
 *
 * There are three functions, and the third is the reciprocal of the second:
 *
 *   H(f)          input jitter -> recovered clock.  LOW-pass. The loop follows
 *                 slow wander, so slow jitter lands on its own clock.
 *   1 - H(f)      input jitter -> RESIDUAL phase error at the decision. High-pass,
 *                 and complex: 1 - |H| is a different and wrong quantity.
 *   margin/|1-H|  the input jitter the receiver can withstand. This is what
 *                 rises at low frequency, because its denominator is small
 *                 there — it is not itself high-pass, it is one over a high-pass.
 *
 * The model is a second-order type-2 loop, stated rather than implied:
 *
 *   H(s) = (2*zeta*wn*s + wn^2) / (s^2 + 2*zeta*wn*s + wn^2)
 *
 * First order cannot peak, and peaking is the whole reason transfer is
 * specified separately from bandwidth — so the damping is a control.
 */
(function () {
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;

  const FLO = 1e3, FHI = 1e9, NF = 340;

  /* Complex H and its complement, from one evaluation. `s = j*2*pi*f`. */
  function loop(f, fn, zeta) {
    const w = 2 * Math.PI * f, wn = 2 * Math.PI * fn;
    // numerator 2*zeta*wn*s + wn^2  ->  wn^2 + j*2*zeta*wn*w
    const nr = wn * wn, ni = 2 * zeta * wn * w;
    // denominator s^2 + 2*zeta*wn*s + wn^2  ->  (wn^2 - w^2) + j*2*zeta*wn*w
    const dr = wn * wn - w * w, di = 2 * zeta * wn * w;
    const den = dr * dr + di * di;
    const hr = (nr * dr + ni * di) / den, hi = (ni * dr - nr * di) / den;
    /* THE COMPLEX complement. 1 - |H| would be a different function and would
       give the wrong residual wherever H has phase, which is everywhere near
       fn. */
    const er = 1 - hr, ei = -hi;
    return { hr, hi, h: Math.hypot(hr, hi), e: Math.hypot(er, ei) };
  }

  NS.models = NS.models || {};
  NS.models.cdr = function (p) {
    const jitterFrequency = p.jitterFrequency == null ? 4 : p.jitterFrequency;
    const jitterAmplitude = p.jitterAmplitude == null ? 0.4 : p.jitterAmplitude;
    const sweep = [];
    for (let i = 0; i < NF; i++) {
      const f = FLO * Math.pow(FHI / FLO, i / (NF - 1));
      const L = loop(f, p.fn * 1e6, p.zeta);
      /* The tolerance the loop alone would allow, and the ceiling a real
         receiver imposes on top of it.

         1/f², not 1/f (N3-1e). This is a TYPE-2 loop, so |1−H| falls as f²
         below fn and the tolerance it allows rises as the reciprocal —
         measured at exactly 100× per decade, where 1/f would give 10×.

         That rise cannot continue for ever: the phase detector has finite range
         and the VCO has finite tuning, so past some amplitude the loop simply
         loses lock however slow the jitter is. Declaring that ceiling is the
         difference between a teaching model and a mask. */
      const fromLoop = L.e > 1e-12 ? p.margin / L.e : Infinity;
      sweep.push({ f, h: L.h, e: L.e, tol: Math.min(fromLoop, p.ceiling),
                   limited: fromLoop > p.ceiling });
    }
    let peak = 0, peakF = 0, peakE = 0, peakEF = 0, minTol = Infinity, minTolF = 0;
    sweep.forEach((s) => {
      if (s.h > peak) { peak = s.h; peakF = s.f; }
      if (s.e > peakE) { peakE = s.e; peakEF = s.f; }
      if (s.tol < minTol) { minTol = s.tol; minTolF = s.f; }
    });

    /* N3-1a / R8. fn is the NATURAL frequency, not the closed-loop -3 dB
       bandwidth, and the panel called it "loop bw". They differ by a factor that
       depends on damping, so the mislabelling taught a relationship that does
       not exist.

       For this H, |H|^2 = (1 + 4*z^2*u) / ((1-u)^2 + 4*z^2*u) with u = (w/wn)^2,
       and setting that to 1/2 gives u^2 - (2 + 4*z^2)*u - 1 = 0. The positive
       root is closed form:

         zeta 0.15   f3dB = 1.578 * fn        zeta 0.707  f3dB = 2.058 * fn
         zeta 0.70   f3dB = 2.049 * fn        zeta 1.5    f3dB = 3.373 * fn

       So at the default fn = 4 MHz and zeta = 0.7 the bandwidth is 8.196 MHz,
       and across the damping control the ratio itself moves by 2.1x. Both
       numbers are now reported, each under its own name. */
    const bwFactor = (z) => {
      const b = 2 + 4 * z * z;
      return Math.sqrt((b + Math.sqrt(b * b + 4)) / 2);
    };
    const f3dB = p.fn * 1e6 * bwFactor(p.zeta);
    /* Where the declared ceiling takes over from the loop. That is the more
       useful number than "tolerance at some fixed offset", because a decade
       below fn the 1/f² rise has usually already hit the
       ceiling and the reading says nothing about the loop. */
    let ceilAt = null;
    for (let i = sweep.length - 1; i > 0; i--) {
      if (sweep[i].limited) { ceilAt = sweep[i].f; break; }
    }
    // where the residual reaches 1/sqrt(2) — the -3 dB point of the complement
    let cross = null;
    for (let i = 1; i < sweep.length; i++) {
      if (sweep[i - 1].e < Math.SQRT1_2 && sweep[i].e >= Math.SQRT1_2) {
        cross = sweep[i].f; break;
      }
    }
    /* Steady-state sinusoidal response of the same complex H used above.
       UI pp becomes half that value at the sine peak. Three periods make the
       phase lag and the residual visible without implying acquisition time. */
    const jf = jitterFrequency * 1e6;
    const jl = loop(jf, p.fn * 1e6, p.zeta);
    const phaseTime = [], phaseIn = [], phaseRecovered = [], phaseResidual = [];
    const amp = jitterAmplitude / 2;
    for (let i = 0; i <= 180; i++) {
      const t = (i / 180) * 3 / jf;
      const a = 2 * Math.PI * jf * t;
      const input = amp * Math.sin(a);
      const recovered = amp * (jl.hr * Math.sin(a) + jl.hi * Math.cos(a));
      phaseTime.push(t);
      phaseIn.push(input);
      phaseRecovered.push(recovered);
      phaseResidual.push(input - recovered);
    }
    const phaseExtent = Math.max(...phaseIn.map(Math.abs), ...phaseRecovered.map(Math.abs),
                                 ...phaseResidual.map(Math.abs));
    const phaseAxisLimit = Math.max(phaseExtent * 1.12, 0.05);
    return K.result({
      model: 'cdr', version: '1.1', status: 'ok',
      params: { fn: p.fn, zeta: p.zeta, margin: p.margin, ceiling: p.ceiling,
                jitterFrequency, jitterAmplitude },
      units: { fn: 'MHz', zeta: '-', margin: 'UI pp', ceiling: 'UI pp',
               jitterFrequency: 'MHz', jitterAmplitude: 'UI pp', frequency: 'Hz',
               transfer: '-', tolerance: 'UI pp', phase: 'UI', time: 's' },
      conventions: {
        loop: 'second-order type-2, H(s) = (2*zeta*wn*s + wn^2)/(s^2 + 2*zeta*wn*s + wn^2)',
        residual: 'COMPLEX 1 - H(f), not 1 - |H(f)|',
        tolerance: 'margin / |1 - H(f)|, capped by a declared tracking ceiling. '
          + 'A real tolerance mask carries more than this: pattern dependence, '
          + 'BER target, and the phase detector’s own characteristic',
        margin: 'the receiver’s usable sampling window, in UI peak-to-peak',
        sinusoid: 'steady-state small-signal response; jitterAmplitude is input UI peak-to-peak'
      },
      /* N4-4. These used to be three labels with no numbers attached; the data
         sat in `generated` where no export could reach it. */
      traces: [
        K.trace('transfer', 'input to recovered clock', '-',
                'jitter frequency', 'Hz', sweep.map((q) => q.f), sweep.map((q) => q.h)),
        K.trace('residual', 'input to residual error', '-',
                'jitter frequency', 'Hz', sweep.map((q) => q.f), sweep.map((q) => q.e)),
        K.trace('tolerance', 'allowable input jitter', 'UI pp',
                'jitter frequency', 'Hz', sweep.map((q) => q.f), sweep.map((q) => q.tol)),
        K.trace('phase-input', 'input phase', 'UI', 'time', 's', phaseTime, phaseIn),
        K.trace('phase-recovered', 'recovered clock phase', 'UI', 'time', 's', phaseTime, phaseRecovered),
        K.trace('phase-residual', 'residual phase error', 'UI', 'time', 's', phaseTime, phaseResidual)
      ],
      measurements: {
        naturalFrequency: p.fn * 1e6,
        bandwidth3dB: f3dB,
        bandwidthOverFn: bwFactor(p.zeta),
        peakTransfer: peak, peakTransferDb: 20 * Math.log10(peak), peakAt: peakF,
        /* The residual's own peak, which the panel never reported. It EXCEEDS
           unity whenever the loop is underdamped — 2.066 at zeta 0.25, 3.372 at
           0.15 — which is the mechanism behind the tolerance dip. */
        peakResidual: peakE, peakResidualAt: peakEF,
        residualCrossover: cross,
        /* Renamed. `toleranceFloor` was p.margin, which is the HIGH-FREQUENCY
           ASYMPTOTE — where the loop tracks nothing and the whole sampling
           window is available. It is not the minimum, and for an underdamped
           loop the minimum is well below it. */
        toleranceAtHighFrequency: p.margin,
        minTolerance: minTol, minToleranceAt: minTolF,
        toleranceAtNaturalFrequency: sweep.find((s) => s.f >= p.fn * 1e6).tol,
        ceilingTakesOverAt: ceilAt,
        phaseAxisLimit
      },
      diagnostics: { points: NF, fLo: FLO, fHi: FHI },
      stimulus: { excitation: 'sinusoidal jitter', frequency: jf,
                  amplitudePeakToPeak: jitterAmplitude, steadyState: true },
      generated: { sweep, phaseTime, phaseIn, phaseRecovered, phaseResidual }
    });
  };

  NS.viz.cdr = function (root) {
    const $ = (s) => root.querySelector(s);
    const cv = {};
    root.querySelectorAll('canvas[data-cv]').forEach((c) => (cv[c.dataset.cv] = c));

    const p = { fn: 4, zeta: 0.7, margin: 0.3, ceiling: 20,
                jitterFrequency: 4, jitterAmplitude: 0.4 };
    const PRESETS = {
      typical: { fn: 4, zeta: 0.7, margin: 0.3, ceiling: 20, jitterFrequency: 4, jitterAmplitude: 0.4,
        note: 'A 4 MHz loop, critically damped enough not to peak much. Slow jitter is tracked out, so the receiver tolerates a great deal of it.' },
      /* N3-1e / R8. Three notes corrected, each against a measurement rather
         than an argument. */
      wide: { fn: 20, zeta: 0.7, margin: 0.3, ceiling: 20, jitterFrequency: 20, jitterAmplitude: 0.4,
        note: 'Five times the natural frequency, and five times the −3 dB bandwidth with it — 40.98 MHz against 8.20 — because the ratio between them is set by the damping, and the damping has not changed. More jitter is tracked out, so tolerance improves over a wider band. The old note added that the loop then passes “five times as much of its own reference noise”: that has no meaning without a noise spectrum and an injection point, neither of which is modelled here, so it is withdrawn rather than left standing.' },
      peaky: { fn: 4, zeta: 0.25, margin: 0.3, ceiling: 20, jitterFrequency: 4, jitterAmplitude: 0.4,
        note: 'Under-damped. Transfer exceeds unity near fₙ — the loop AMPLIFIES jitter there, +7.2 dB — and so does the residual: |1−H| peaks at ×2.07, which is WORSE than having no loop at all. Tolerance therefore dips to 0.145 UI, below the 0.30 UI it reaches far above the loop. The old note said the residual dips below what a first-order model predicts; it rises above unity. This is why transfer is specified separately from bandwidth.' },
      tight: { fn: 4, zeta: 0.7, margin: 0.1, ceiling: 20, jitterFrequency: 4, jitterAmplitude: 0.4,
        note: 'A third the sampling margin, everything else equal. The loop-limited part of the curve scales exactly with it — 3.000× at every frequency the loop governs — but the part held down by the declared tracking ceiling does not move at all, so the curve changes SHAPE rather than sliding down. The loop decides the shape, the margin decides the height, and the ceiling decides where that stops being true.' }
    };

    let M = null, T = null;

    function rebuild() { M = K.publish(root, NS.models.cdr(p)); syncControls(); draw(); }
    /* N4-2. A view operation repaints from the result already computed; it
       does not rebuild the loop or disturb the selected preset. */
    K.onRepaint(root, () => { if (M) draw(); });

    function syncControls() {
      const set = (id, v, txt) => {
        const e = $('#' + id); if (e) e.value = v;
        const o = $('#' + id + '-out'); if (o) o.value = txt;
      };
      set('cdr-fn', p.fn, p.fn + ' MHz');
      set('cdr-zeta', Math.round(p.zeta * 100), p.zeta.toFixed(2));
      set('cdr-margin', Math.round(p.margin * 100), p.margin.toFixed(2) + ' UI');
      set('cdr-jitter-f', p.jitterFrequency, p.jitterFrequency + ' MHz');
      set('cdr-jitter-a', Math.round(p.jitterAmplitude * 100), p.jitterAmplitude.toFixed(2) + ' UI pp');
    }

    function drawTransfer() {
      const s = K.canvas(cv.transfer, 200);
      const P = K.plot(s, T, {
        pad: { l: 56, r: 16, t: 18, b: 30 },
        x: { min: FLO, max: FHI, log: true, fmt: K.fmt.hz, title: 'jitter frequency' },
        /* N3-1b. The top came from a fixed 3, while the peak reaches 3.514 at
           the lowest damping the control allows — so the one feature damping
           exists to show was drawn off the top of its own axis. The limit now
           follows the peak. */
        y: { min: 0.002, max: Math.max(3, M.measurements.peakTransfer * 1.25), log: true,
             fmt: (v) => v.toFixed(v < 1 ? 2 : 1), title: '|H|' }
      }).grid();
      P.trace((i) => [M.generated.sweep[i].f, Math.max(M.generated.sweep[i].h, 0.002)],
              T.signal, { n: NF, width: 2.2, glow: true });
      P.hline(1, T.muted, [4, 4], 'unity');
      /* Two different frequencies, named apart. fn is where the loop's poles sit;
         the -3 dB bandwidth is 1.58x to 3.37x higher depending on damping. */
      P.vline(p.fn * 1e6, T.ink2, [3, 3], 'fn');
      P.vline(M.measurements.bandwidth3dB, T.muted, [2, 4], '−3 dB');
      P.vline(p.jitterFrequency * 1e6, T.alarm, [5, 3]);
      if (M.measurements.peakTransfer > 1.01) {
        K.dot(s.ctx, P.X(M.measurements.peakAt), P.Y(M.measurements.peakTransfer),
              T.alarm, T.surface, 4);
        K.text(s.ctx, '+' + M.measurements.peakTransferDb.toFixed(1) + ' dB of peaking',
               P.X(M.measurements.peakAt) + 8, P.Y(M.measurements.peakTransfer) - 8,
               T.alarm, 10, 'left');
      }
      P.frame();
    }

    function drawResidual() {
      const s = K.canvas(cv.residual, 200);
      const P = K.plot(s, T, {
        pad: { l: 56, r: 16, t: 18, b: 30 },
        x: { min: FLO, max: FHI, log: true, fmt: K.fmt.hz, title: 'jitter frequency' },
        y: { min: 0.002, max: Math.max(3, M.measurements.peakResidual * 1.25), log: true,
             fmt: (v) => v.toFixed(v < 1 ? 2 : 1), title: '|1−H|' }
      }).grid();
      P.trace((i) => [M.generated.sweep[i].f, Math.max(M.generated.sweep[i].e, 0.002)],
              T.reflect, { n: NF, width: 2.2, glow: true });
      P.hline(1, T.muted, [4, 4], 'all of it');
      /* The residual EXCEEDS unity when the loop is underdamped — 3.372 at
         zeta 0.15 — which is why tolerance dips there. Marked, because the old
         axis cut it off and the preset note said the opposite. */
      if (M.measurements.peakResidual > 1.01) {
        K.dot(s.ctx, P.X(M.measurements.peakResidualAt), P.Y(M.measurements.peakResidual),
              T.alarm, T.surface, 4);
        K.text(s.ctx, 'x' + M.measurements.peakResidual.toFixed(2) + ' — worse than no loop',
               P.X(M.measurements.peakResidualAt) + 8,
               P.Y(M.measurements.peakResidual) - 8, T.alarm, 10, 'left');
      }
      if (M.measurements.residualCrossover) {
        P.vline(M.measurements.residualCrossover, T.ink2, [3, 3], 'half the power');
      }
      P.vline(p.jitterFrequency * 1e6, T.alarm, [5, 3]);
      P.frame();
    }

    function drawTolerance() {
      const s = K.canvas(cv.tolerance, 200);
      const sw = M.generated.sweep;
      let hi = 0;
      sw.forEach((q) => { if (isFinite(q.tol)) hi = Math.max(hi, q.tol); });
      const P = K.plot(s, T, {
        pad: { l: 56, r: 16, t: 18, b: 30 },
        x: { min: FLO, max: FHI, log: true, fmt: K.fmt.hz, title: 'jitter frequency' },
        /* The floor came from the margin alone, so at zeta 0.15 the minimum of
           0.0890 UI fell below a 0.15 UI axis — the dip that damping exists to
           produce, drawn off the bottom. It now follows the actual minimum. */
        y: { min: Math.min(p.margin * 0.5, M.measurements.minTolerance * 0.7),
             max: Math.max(hi * 1.4, p.margin * 4), log: true,
             fmt: (v) => v.toFixed(v < 1 ? 2 : 0), title: 'UI pp' }
      }).grid();
      /* The part of the curve the loop sets, and the part a declared ceiling
         sets, drawn differently — because only the first comes from the model. */
      P.trace((i) => [sw[i].f, sw[i].limited ? NaN : sw[i].tol], T.signal,
              { n: NF, width: 2.2, glow: true });
      P.trace((i) => [sw[i].f, sw[i].limited ? sw[i].tol : NaN], T.alarm,
              { n: NF, width: 1.6, dash: [5, 4] });
      P.hline(p.margin, T.muted, [4, 4], 'sampling margin');
      P.vline(p.jitterFrequency * 1e6, T.alarm, [5, 3]);
      P.frame();
      K.text(s.ctx, 'dashed: a declared tracking ceiling, not the loop',
             P.box.L + 6, P.box.TP + 12, T.muted, 10, 'left');
    }

    function drawPhase() {
      if (!cv.phase) return;
      const xs = M.generated.phaseTime.map((t) => t * 1e9);
      const lim = M.measurements.phaseAxisLimit;
      const s = K.canvas(cv.phase, 220);
      const P = K.plot(s, T, {
        pad: { l: 56, r: 16, t: 18, b: 32 },
        x: { min: xs[0], max: xs[xs.length - 1], fmt: (v) => v.toFixed(0), title: 'time (ns)' },
        y: { min: -lim, max: lim, fmt: (v) => v.toFixed(2), title: 'phase (UI)' }
      }).grid();
      P.trace((i) => [xs[i], M.generated.phaseIn[i]], T.ink2, { n: xs.length, width: 1.4, dash: [4, 3] });
      P.trace((i) => [xs[i], M.generated.phaseRecovered[i]], T.signal, { n: xs.length, width: 2.2 });
      P.trace((i) => [xs[i], M.generated.phaseResidual[i]], T.reflect, { n: xs.length, width: 2.2 });
      P.hline(0, T.muted, [3, 3]);
      P.frame();
    }

    function readouts() {
      const set = (k, v) => { const e = $('[data-out="' + k + '"]'); if (e) e.textContent = v; };
      const m = M.measurements;
      set('peak', m.peakTransfer > 1.01
        ? '+' + m.peakTransferDb.toFixed(1) + ' dB at ' + K.fmt.hz(m.peakAt)
        : 'none (' + m.peakTransferDb.toFixed(1) + ' dB)');
      set('cross', m.residualCrossover ? K.fmt.hz(m.residualCrossover) : '—');
      /* Was toleranceFloor, which named an asymptote as if it were a minimum.
         The bar now shows the real worst case and says where it is. */
      set('floor', m.minTolerance < p.margin * 0.995
        ? m.minTolerance.toFixed(3) + ' UI at ' + K.fmt.hz(m.minToleranceAt)
        : m.toleranceAtHighFrequency.toFixed(2) + ' UI');
      set('low', m.ceilingTakesOverAt
        ? 'ceiling below ' + K.fmt.hz(m.ceilingTakesOverAt) : 'loop governs throughout');
      K.summary(root, [
        /* N3-1a. Two numbers, two names. fn is where the loop's poles sit; the
           -3 dB bandwidth is what a specification means by "loop bandwidth", and
           the ratio between them is set by the damping. */
        { label: 'natural frequency f\u2099', value: p.fn + ' MHz',
          note: 'second-order type-2, damping ' + p.zeta.toFixed(2) },
        { label: 'closed-loop \u22123 dB bandwidth',
          value: (m.bandwidth3dB / 1e6).toFixed(2) + ' MHz',
          note: m.bandwidthOverFn.toFixed(2) + '\u00d7 f\u2099 at this damping \u2014 '
            + 'the ratio moves from 1.58 to 3.37 across the control' },
        { label: 'peak jitter transfer',
          value: m.peakTransfer > 1.01 ? '+' + m.peakTransferDb.toFixed(1) + ' dB' : 'no peaking',
          note: m.peakTransfer > 1.01 ? 'the loop amplifies jitter here' : 'damped',
          colour: m.peakTransfer > 1.2 ? 'alarm' : 'muted' },
        { label: 'tolerance far above the loop', value: p.margin.toFixed(2) + ' UI pp',
          note: 'the loop tracks none of it, so this is the sampling margin \u2014 '
            + 'an asymptote, not the minimum',
          colour: 'signal' },
        /* The real minimum, which the old readout never showed and the old axis
           cut off. For an underdamped loop it sits BELOW the high-frequency
           asymptote, because the residual exceeds unity at resonance. */
        { label: 'worst tolerance anywhere',
          value: m.minTolerance.toFixed(3) + ' UI pp',
          note: m.minTolerance < p.margin * 0.995
            ? 'at ' + K.fmt.hz(m.minToleranceAt) + ' \u2014 below the margin, because '
              + '|1\u2212H| peaks at \u00d7' + m.peakResidual.toFixed(2) + ' there'
            : 'the residual never exceeds unity, so the margin is the worst case',
          colour: m.minTolerance < p.margin * 0.995 ? 'alarm' : 'muted' },
        { label: 'where the declared ceiling takes over',
          value: m.ceilingTakesOverAt ? K.fmt.hz(m.ceilingTakesOverAt) : 'nowhere in band',
          note: m.ceilingTakesOverAt
            ? 'below this the 1/f\u00b2 rise is stopped by the phase detector\u2019s '
              + 'range, not by the loop \u2014 a real mask, not this model'
            : 'the loop governs the whole sweep' }
      ], { label: 'This loop' });
    }

    function draw() {
      T = K.theme(root);
      drawTransfer(); drawResidual(); drawTolerance(); drawPhase(); readouts();
    }

    function clearPreset() {
      root.querySelectorAll('.preset[aria-pressed="true"]')
        .forEach((b) => b.setAttribute('aria-pressed', 'false'));
      const n = $('[data-out="note"]'); if (n) n.textContent = '';
    }

    [['cdr-fn', 'fn', 1], ['cdr-zeta', 'zeta', 100], ['cdr-margin', 'margin', 100],
     ['cdr-jitter-f', 'jitterFrequency', 1], ['cdr-jitter-a', 'jitterAmplitude', 100]]
      .forEach(([id, key, scale]) => {
        const el = $('#' + id);
        if (el) el.addEventListener('input', (e) => {
          p[key] = +e.target.value / scale; clearPreset(); rebuild();
        });
      });

    root.querySelectorAll('.preset[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const q = PRESETS[b.dataset.preset]; if (!q) return;
      clearPreset();
      Object.keys(q).forEach((k) => { if (k !== 'note') p[k] = q[k]; });
      b.setAttribute('aria-pressed', 'true');
      const n = $('[data-out="note"]'); if (n) n.textContent = q.note;
      rebuild();
    }));

    /* The module contract, and the two events every panel has to honour: a
       theme change re-reads the tokens, a resize re-measures the canvases. No
       animation here, so start and stop have nothing to do. */
    rebuild();
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
})();
