/* SI & PI — models/adc-model.js
 * Lab D: ADC interference, aliasing and reference noise.
 *
 * A toggling digital signal couples into a converter's input or reference, and
 * the converter's own sampling decides where the resulting error lands. Two
 * converters share one aggressor so the same disturbance can be compared:
 *
 *   SAR          ideal sample-and-hold, then N bit trials spread over the first
 *                half of the sample period. Each trial compares the held input
 *                with a DAC scaled by the reference AT THAT TRIAL'S TIME.
 *   delta-sigma  discrete-time, second order, 1-bit, unity signal transfer:
 *                V = z^-1 U + (1 - z^-1)^2 E. Input coupling adds at every
 *                modulator sample; reference coupling scales the feedback DAC.
 *                Sinc-cubed decimation to the output data rate.
 *
 * The aggressor is evaluated in the TIME domain at the exact instants the
 * converter uses it — never as a list of folded tones — so folding, offsets and
 * mixing come out of the simulation rather than being assumed. Its Fourier
 * series exists here only to label spurs; the checks compare the two.
 */
(function () {
  'use strict';
  const NS = (window.SIPI = window.SIPI || { viz: {} });
  const K = NS.kit;
  /* The converter solver lives here, not in the drawing kit: it is the physics of
     one lab, and nothing else on the site has a use for it. */
  const A = ((NS.models = NS.models || {}).adcLab = {});

  const TAU = 2 * Math.PI;
  const LOBE = 4;                            // 4-term Blackman-Harris main lobe, ± bins
  const BH = [0.35875, 0.48829, 0.14128, 0.01168];
  const F_REF_CAP = 1e6;                     // capacitive coupling level is stated at 1 MHz
  const DS_STATE_LIMIT = 16;                 // |second integrator| / Vref beyond which the loop has overloaded
  const PHI0 = 0.2;                          // input sine phase, rad: keeps samples off exact code edges
  const HARMONICS = 6;                       // SNR excludes input harmonics 2..6

  A.LOBE = LOBE;
  A.F_REF_CAP = F_REF_CAP;
  /* The stimulus phase and the overload threshold are published so the loop can be
     checked against its own input and output rather than against a second copy of
     its recurrence. They describe the experiment, not the physics. */
  A.PHI0 = PHI0;
  A.DS_STATE_LIMIT = DS_STATE_LIMIT;
  A.HARMONICS = HARMONICS;

  /* ---------- the domain this model is defined on ----------
     Slider ranges are a user interface, not a contract: a scenario link, an export
     replayed by hand or a future caller can present anything. Everything the run
     depends on is checked here once, and a value outside the domain is refused with
     the reason rather than producing a number that looks like a measurement.

     Returns a reason string, or null when the parameters are supported. */
  A.validate = function (p) {
    const fin = (v) => typeof v === 'number' && isFinite(v);
    const int = (v) => fin(v) && Math.floor(v) === v;
    if (p.arch !== 'sar' && p.arch !== 'ds') return 'architecture must be "sar" or "ds"';
    if (['none', 'input', 'reference'].indexOf(p.path) < 0) return 'coupling path must be "none", "input" or "reference"';
    if (['flat', 'capacitive'].indexOf(p.couplingType) < 0) return 'coupling type must be "flat" or "capacitive"';
    if (['free', 'clock', 'odr'].indexOf(p.aggMode) < 0) return 'aggressor frequency mode must be "free", "clock" or "odr"';
    if (!(fin(p.vref) && p.vref > 0)) return 'the reference must be a finite positive voltage';

    if (p.arch === 'sar') {
      if (!(fin(p.fs) && p.fs > 0)) return 'the sample rate must be finite and above zero';
      if (!(int(p.bits) && p.bits >= 6 && p.bits <= 24)) return 'SAR resolution must be a whole number of bits from 6 to 24';
      if (p.record !== undefined && !(int(p.record) && p.record >= 8 && p.record <= 20)) {
        return 'the record length exponent must be a whole number from 8 to 20';
      }
    } else {
      if (!(fin(p.fmod) && p.fmod > 0)) return 'the modulator clock must be finite and above zero';
      if (!(int(p.osr) && p.osr >= 8 && p.osr <= 1024)) return 'the oversampling ratio must be a whole number from 8 to 1024';
      if (p.outputs !== undefined && !(int(p.outputs) && p.outputs >= 256 && p.outputs <= 65536)) {
        return 'the output record must be a whole number of samples from 256 to 65,536';
      }
    }

    const bandFs = p.arch === 'ds' ? p.fmod / p.osr : p.fs;
    if (!(fin(p.inFreq) && p.inFreq > 0)) return 'the input frequency must be finite and above zero';
    if (p.inFreq >= bandFs / 2) return 'the input frequency must be below half the output data rate';
    if (!(fin(p.inDbfs) && p.inDbfs <= 0)) return 'the input level must be finite and at or below full scale';
    if (!(fin(p.noiseUv) && p.noiseUv >= 0)) return 'the added noise must be finite and not negative';

    if (!(fin(p.aggAmp) && p.aggAmp >= 0)) return 'the aggressor swing must be finite and not negative';
    if (!(fin(p.aggPhase))) return 'the aggressor phase must be finite';
    if (!(fin(p.aggPpm))) return 'the aggressor frequency error must be finite';
    if (!(fin(p.edge) && p.edge > 0)) return 'the rise/fall time must be finite and above zero';
    if (!(fin(p.couplingDb))) return 'the coupling level must be finite';
    if (!(fin(p.pathBw) && p.pathBw > 0)) return 'the coupling bandwidth must be finite and above zero';
    if (p.aggMode === 'free' && !(fin(p.aggFreq) && p.aggFreq > 0)) return 'the aggressor frequency must be finite and above zero';
    if (p.aggMode !== 'free' && !(fin(p.aggMultiple) && p.aggMultiple > 0)) return 'the aggressor clock multiple must be finite and above zero';
    return null;
  };

  const frac = (v) => v - Math.floor(v);
  const db10 = (v) => 10 * Math.log10(v);
  const db20 = (v) => 20 * Math.log10(v);

  /* Where a tone at f lands after sampling at fs: its distance to the nearest
     multiple of fs. Every harmonic of the aggressor folds independently. */
  A.fold = function (f, fs) {
    return Math.abs(f - Math.round(f / fs) * fs);
  };

  /* Magnitude of the sinc-cubed decimation filter. Periodic in fmod, with exact
     nulls at multiples of the output data rate that are not multiples of fmod. */
  A.sinc3 = function (f, fmod, osr) {
    const d = Math.sin(Math.PI * f / fmod);
    if (Math.abs(d) < 1e-12) return 1;
    return Math.pow(Math.abs(Math.sin(Math.PI * f * osr / fmod) / (osr * d)), 3);
  };

  /* An odd number of cycles in a power-of-two record shares no factor with the
     record length, so the tone and every harmonic sit exactly on a bin and the
     quantization error is spread over the whole band rather than collected on
     a few bins. Kept clear of DC and of Nyquist by two lobes. */
  A.coherentBin = function (f, fsample, M) {
    const exact = f * M / fsample;
    let J = Math.round(exact);
    if (J % 2 === 0) J += exact >= J ? 1 : -1;
    return Math.min(M / 2 - 2 * LOBE - 1, Math.max(2 * LOBE + 1, J));
  };

  /* ---------- aggressor ----------
     A 50%-duty trapezoid of amplitude aggAmp peak-to-peak with its mean removed,
     rising from phase 0 over a linear edge, through a single-pole path of
     bandwidth pathBw. Flat coupling scales it; capacitive coupling scales its
     derivative, with the level stated at 1 MHz.

     The single pole has a closed-form periodic steady state. Over the first
     half period (rise then high) the output is exact; the second half is the
     negative of the first, because the input is half-wave antisymmetric. That
     makes one evaluation O(1), which a million modulator samples need. */
  A.aggressor = function (p) {
    const clock = p.arch === 'ds' ? p.fmod : p.fs;
    /* An aggressor timed from the converter's own crystal has an exact ratio to its
       clock. One with its own oscillator — a GPIO, a nearby interface — never does:
       aggPpm is its frequency error against the converter's crystal, and it is what
       turns a nominal match into a slow beat instead of a constant. */
    let ratio;
    if (p.aggMode === 'clock') ratio = p.aggMultiple;
    else if (p.aggMode === 'odr' && p.arch === 'ds') ratio = p.aggMultiple / p.osr;
    else ratio = p.aggFreq / clock * (1 + (p.aggPpm || 0) * 1e-6);
    const fa = ratio * clock;
    const notes = [];
    const G = Math.pow(10, p.couplingDb / 20);
    const cap = p.couplingType === 'capacitive';
    let fbw = p.pathBw;
    /* A coupling capacitor into a node with its own capacitance cannot pass more
       than all of the aggressor: the plateau above the pole is G·fbw/f_ref, and
       it must not exceed one. When it would, the capacitor itself sets the pole. */
    if (cap && G * fbw / F_REF_CAP > 1) {
      fbw = F_REF_CAP / G;
      notes.push('the coupling capacitor limits the path bandwidth to ' + (fbw / 1e6).toPrecision(3) + ' MHz');
    }
    /* p.edge is the rise and fall time, 10–90%, as a datasheet quotes it. A linear
       edge covers the remaining 20% of its swing in the same slope, so the full
       ramp is 1.25 × the 10–90% time. */
    let r = Math.max(p.edge / 0.8 * fa, 1e-12);  // the full ramp as a fraction of the aggressor period
    if (r > 0.5) {
      r = 0.5;
      notes.push('the edges take more than half the aggressor period, so the wave is a triangle');
    }
    const tn = fa / (TAU * fbw);                  // pole time constant, in aggressor periods
    const E1 = Math.exp(-r / tn), E2 = Math.exp(-(0.5 - r) / tn);
    const g = (tn / r) * Math.expm1(-r / tn);
    const y0 = -0.5 - g * E2 / (1 + E1 * E2);     // periodic start value: y(1/2) = -y(0)
    const yr = 0.5 + (y0 + 0.5) * E1 + g;         // value at the end of the rise
    const scale = p.aggAmp * G * (cap ? fbw / F_REF_CAP : 1);
    const phase0 = (p.aggPhase || 0) / 360;

    function shape(th) {                          // th in [0, 1)
      let sign = 1;
      if (th >= 0.5) { th -= 0.5; sign = -1; }
      /* Past 36 time constants the transient is below 3e-16 of the step, so the
         exponential is skipped: most evaluations then cost one division. */
      let x, y;
      if (th < r) {
        x = -0.5 + th / r;
        const e = th / tn;
        y = e > 36 ? x - tn / r : x + (tn / r) * Math.expm1(-e) + (y0 + 0.5) * Math.exp(-e);
      } else {
        x = 0.5;
        const e = (th - r) / tn;
        y = e > 36 ? 0.5 : 0.5 + (yr - 0.5) * Math.exp(-e);
      }
      // capacitive: dy/dt = (x - y)/tau, so G/(2π f_ref)·A·dy/dt = G·(fbw/f_ref)·A·(x - y)
      return sign * (cap ? x - y : y);
    }

    return {
      fa, ratio, clock, r, fbw, gain: G, cap, notes, phase0,
      /* t in converter clock periods; ratio·t is the aggressor phase */
      at(t) { return scale * shape(frac(ratio * t + phase0)); },
      atPhase(th) { return scale * shape(frac(th)); },
      /* Peak amplitude of harmonic n at the converter pin, for labels only. */
      harmonic(n) {
        if (n % 2 === 0) return 0;
        const f = n * fa, x = Math.PI * n * r;
        const sinc = Math.abs(Math.sin(x) / x);
        const pole = 1 / Math.sqrt(1 + (f / fbw) * (f / fbw));
        return p.aggAmp * G * (2 / (n * Math.PI)) * sinc * pole * (cap ? f / F_REF_CAP : 1);
      }
    };
  };

  /* The shortest number of clock periods over which the aggressor also repeats
     exactly. When it is short, only that many aggressor phases are ever sampled:
     a locked multiple is 1, and 4.13 MHz against 1 MS/s is 100 — so a 1 ns edge
     can fall between every sampled phase and vanish. */
  A.commonPeriod = function (ratio, limit) {
    for (let q = 1; q <= (limit || 4096); q++) {
      const v = ratio * q;
      if (Math.abs(v - Math.round(v)) < 1e-9 * Math.max(1, v)) return q;
    }
    return null;
  };

  function gaussian(seed) {
    const r = K.rng(seed);
    return function () {
      return Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(TAU * r());
    };
  }

  /* ---------- SAR ---------- */
  function sar(p, agg, M) {
    const N = p.bits, half = Math.pow(2, N - 1);
    const vref = p.vref, a = vref * Math.pow(10, p.inDbfs / 20);
    const J = A.coherentBin(p.inFreq, p.fs, M);
    const w = TAU * J / M;
    const inPath = !!agg && p.path === 'input', refPath = !!agg && p.path === 'reference';
    const sigma = (p.noiseUv || 0) * 1e-6;
    const gauss = sigma > 0 ? gaussian(0x5a4) : null;
    const weight = [], when = [];
    for (let j = 0; j < N; j++) {
      weight.push(Math.pow(2, N - 1 - j));
      when.push((j + 0.5) / (2 * N));             // trials fill the first half period
    }
    const y = new Float64Array(M);
    let clipped = 0;
    for (let n = 0; n < M; n++) {
      let h = a * Math.sin(w * n + PHI0);
      if (inPath) h += agg.at(n);
      if (gauss) h += sigma * gauss();
      if (h >= vref || h < -vref) clipped++;
      let c = 0;
      if (refPath) {
        for (let j = 0; j < N; j++) {
          const trial = c + weight[j];
          const vr = vref + agg.at(n + when[j]);
          /* A comparison against a reference at or below zero has no meaning: the
             DAC's ladder collapses or inverts, and the code that comes back would
             describe the arithmetic, not a converter. */
          if (!(vr > 0)) return { refCollapsed: true, at: n, vr, J };
          if (h >= vr * (trial / half - 1)) c = trial;
        }
      } else {
        /* With a clean reference every trial uses the same DAC scale, and the
           binary search lands on exactly this code. */
        c = Math.min(2 * half - 1, Math.max(0, Math.floor((h / vref + 1) * half)));
      }
      y[n] = vref * ((c + 0.5) / half - 1);
    }
    return { y, J, fsOut: p.fs, clipped, lsb: 2 * vref / (2 * half) };
  }

  /* ---------- delta-sigma ---------- */
  A.sinc3Kernel = function (osr) {
    const box = new Float64Array(osr).fill(1 / osr);
    const conv = (u, v) => {
      const out = new Float64Array(u.length + v.length - 1);
      for (let i = 0; i < u.length; i++) for (let j = 0; j < v.length; j++) out[i + j] += u[i] * v[j];
      return out;
    };
    return conv(conv(box, box), box);
  };

  /* out[k] = sum h[i]·x[start + k·osr - i]; the first output needs a full kernel behind it */
  A.decimate = function (x, osr, count, start) {
    const h = A.sinc3Kernel(osr), L = h.length, y = new Float64Array(count);
    for (let k = 0; k < count; k++) {
      const base = start + k * osr;
      let acc = 0;
      for (let i = 0; i < L; i++) acc += h[i] * x[base - i];
      y[k] = acc;
    }
    return y;
  };

  function ds(p, agg, Nout) {
    const osr = p.osr, vref = p.vref, L = 3 * osr - 2;
    const a = vref * Math.pow(10, p.inDbfs / 20);
    const J = A.coherentBin(p.inFreq, p.fmod / osr, Nout);
    const w = TAU * J / (Nout * osr);
    const inPath = !!agg && p.path === 'input', refPath = !!agg && p.path === 'reference';
    const sigma = (p.noiseUv || 0) * 1e-6;
    const gauss = sigma > 0 ? gaussian(0x5a4) : null;
    const warm = 4096 + 8 * osr;
    const start = warm + L - 1;
    const total = start + (Nout - 1) * osr + 1;
    const v = new Int8Array(total);
    const limit = DS_STATE_LIMIT * vref;
    let x1 = 0, x2 = 0, peak = 0;
    for (let m = 0; m < total; m++) {
      let u = a * Math.sin(w * m + PHI0);
      if (inPath) u += agg.at(m);
      if (gauss) u += sigma * gauss();
      const q = x2 >= 0 ? 1 : -1;
      v[m] = q;
      let vr = vref;
      if (refPath) {
        vr = vref + agg.at(m);
        if (!(vr > 0)) return { refCollapsed: true, at: m, vr, J };
      }
      const fb = q * vr;
      x1 += u - fb;
      x2 += x1 - fb;
      const s = x2 < 0 ? -x2 : x2;
      if (s > peak) {
        peak = s;
        if (peak > limit) return { overload: true, at: m, J };
      }
    }
    const y = A.decimate(v, osr, Nout, start);
    for (let k = 0; k < Nout; k++) y[k] *= vref;
    return { y, v, J, fsOut: p.fmod / osr, clipped: 0, peakState: peak / vref };
  }

  /* ---------- measurement ----------
     Blackman-Harris, 4-term, periodic. A coherent tone stays inside ±3 bins; an
     incoherent aggressor spur is captured to within 0.01 dB by summing ±4.
     pw[k] is mean-square volts in bin k, so a lobe sums to a tone's A²/2 whatever
     its scalloping. amp[k] is the tone-amplitude reading in dBFS, so a full-scale
     coherent sine reads 0 dBFS at its bin. */
  A.analyse = function (y, o) {
    const M = y.length, half = M >> 1, vref = o.vref, J = o.J;
    const re = new Float64Array(M), im = new Float64Array(M);
    let S1 = 0, S2 = 0, sum = 0;
    for (let n = 0; n < M; n++) {
      const c = TAU * n / M;
      const wn = BH[0] - BH[1] * Math.cos(c) + BH[2] * Math.cos(2 * c) - BH[3] * Math.cos(3 * c);
      re[n] = y[n] * wn;
      S1 += wn; S2 += wn * wn; sum += y[n];
    }
    K.fft(re, im);
    const pw = new Float64Array(half), amp = new Float32Array(half);
    for (let k = 0; k < half; k++) {
      const m2 = re[k] * re[k] + im[k] * im[k];
      pw[k] = (k === 0 ? 1 : 2) * m2 / (M * S2);
      amp[k] = db20(Math.max((k === 0 ? 1 : 2) * Math.sqrt(m2) / S1 / vref, 1e-12));
    }

    /* 1 DC, 2 fundamental, 3 harmonic 2..6, 0 everything SNR counts */
    const cls = new Uint8Array(half);
    const mark = (centre, c) => {
      for (let k = centre - LOBE; k <= centre + LOBE; k++) if (k >= 0 && k < half && cls[k] === 0) cls[k] = c;
    };
    mark(0, 1);
    mark(J, 2);
    for (let hN = 2; hN <= HARMONICS; hN++) {
      let kb = (hN * J) % M;
      if (kb > half) kb = M - kb;
      mark(kb, 3);
    }

    let Ps = 0, Ph = 0, Pn = 0, nN = 0;
    for (let k = 0; k < half; k++) {
      if (cls[k] === 2) Ps += pw[k];
      else if (cls[k] === 3) Ph += pw[k];
      else if (cls[k] === 0) { Pn += pw[k]; nN++; }
    }
    /* The excluded bins — DC, the fundamental and harmonics 2..6, each a lobe wide —
       hold no measurable noise of their own, so the measured average density stands
       in for them. That substitution is exact only for white noise. Its error is
       bounded by the fraction of bins it covers: it can overstate the noise by at
       most (half - nN)/half of the total, and understate it by at most whatever the
       excluded bins really held. Both are reported so the bound can be checked. */
    const PnAll = Pn * half / nN;

    /* Largest spur: the biggest ±LOBE power sum around a local maximum, over the
       bins a class filter allows. Its frequency is the power-weighted centre. */
    const largest = (allow) => {
      let bestP = 0, bestK = 0;
      for (let k = 1; k < half - 1; k++) {
        if (!allow(cls[k]) || pw[k] < pw[k - 1] || pw[k] < pw[k + 1]) continue;
        let s = 0, sk = 0;
        for (let i = Math.max(0, k - LOBE); i <= Math.min(half - 1, k + LOBE); i++) {
          if (allow(cls[i])) { s += pw[i]; sk += i * pw[i]; }
        }
        if (s > bestP) { bestP = s; bestK = sk / s; }
      }
      return { power: bestP, bin: bestK, f: bestK * o.fs / M, dbfs: db10(bestP / (vref * vref / 2)) };
    };
    const spur = largest((c) => c === 0 || c === 3);
    const interference = largest((c) => c === 0);
    const fsPow = vref * vref / 2;
    const signalDbfs = db10(Ps / fsPow);
    const sinad = db10(Ps / (PnAll + Ph));
    return {
      M, J, fs: o.fs, df: o.fs / M, pw, amp, cls,
      noiseBins: nN, bandBins: half, replacedFraction: (half - nN) / half,
      mean: sum / M,
      signalDbfs,
      snr: db10(Ps / PnAll),
      sinad,
      thd: Ph > 0 ? db10(Ph / Ps) : -Infinity,
      sfdr: db10(Ps / spur.power),
      enob: (sinad - 1.7609 - signalDbfs) / 6.0206,
      spur, interference,
      noiseDbfs: db10(PnAll / fsPow),
      floorDbfs: db10(2 * (PnAll / half) * M * S2 / (S1 * S1) / (vref * vref))
    };
  };

  /* Amplitude spectrum of a long bitstream, for the modulator's full-band view: up to
     262,144 samples, so the output band near DC is resolved to about a hertz at a
     256 kHz clock. Computed only when that view is open. */
  A.bitSpectrum = function (v, vref) {
    let M = 1;
    while (M * 2 <= Math.min(v.length, 262144)) M *= 2;
    const y = new Float64Array(M), off = v.length - M;
    for (let n = 0; n < M; n++) y[n] = v[off + n] * vref;
    const an = A.analyse(y, { vref, J: 2 * LOBE + 1, fs: 1 });
    return { amp: an.amp, M };
  };

  function idealSnr(p) {
    if (p.arch === 'ds') {                       // 1 bit, order 2: 6.02 + 1.76 - 10log(π⁴/5) + 50log(OSR)
      return 6.0206 + 1.7609 - db10(Math.pow(Math.PI, 4) / 5) + 50 * Math.log10(p.osr) + p.inDbfs;
    }
    return 6.0206 * p.bits + 1.7609 + p.inDbfs;
  }

  function convert(p, agg, M) {
    return p.arch === 'ds' ? ds(p, agg, M) : sar(p, agg, M);
  }

  /* ---------- one run ----------
     cache holds the aggressor-free result for the current converter settings,
     so dragging an aggressor control re-simulates one converter, not two. */
  A.run = function (p, cache) {
    const isDs = p.arch === 'ds';
    /* A delta-sigma record long enough to resolve spurs a few hertz from DC, at a cost
       held near a million modulator samples whatever the oversampling ratio: 16,384
       outputs at 32 and 64, 8,192 at 128, 4,096 at 256. */
    const dsOutputs = Math.min(16384, Math.max(4096, Math.pow(2, Math.round(Math.log2(1.05e6 / p.osr)))));
    const M = isDs ? (p.outputs || dsOutputs) : Math.pow(2, p.record || 16);
    const agg = A.aggressor(p);
    const applied = p.path === 'none' ? null : agg;
    const bandFs = isDs ? p.fmod / p.osr : p.fs;
    const base = {
      model: 'adcLab', version: '1.0', params: Object.assign({}, p),
      units: { frequency: 'Hz', level: 'dBFS', voltage: 'V', snr: 'dB' }
    };

    const bad = A.validate(p);
    if (bad) return K.result(Object.assign(base, { status: 'unsupported', why: bad }));
    if (!(agg.fa > 0)) {
      return K.result(Object.assign(base, { status: 'unsupported', why: 'the aggressor frequency must be above zero' }));
    }
    const out = convert(p, applied, M);
    if (out.refCollapsed) {
      return K.result(Object.assign(base, {
        status: 'unsupported',
        why: 'the coupled disturbance drove the reference to ' + out.vr.toFixed(3) + ' V at sample '
          + out.at + '. A reference at or below zero is not a reference: the converter has no '
          + 'ladder to compare against, and any code it returned would describe the arithmetic '
          + 'rather than a measurement. Reduce the swing or the coupling into the reference.'
      }));
    }
    if (out.overload) {
      return K.result(Object.assign(base, {
        status: 'unsupported',
        why: 'the second-order loop has overloaded: its second integrator passed '
          + DS_STATE_LIMIT + '× the reference, so the bitstream no longer tracks the input. '
          + 'A 1-bit second-order modulator needs headroom below full scale; reduce the input '
          + 'or the coupled disturbance. An SNR from this state would describe the overload, not the converter.'
      }));
    }
    const an = A.analyse(out.y, { vref: p.vref, J: out.J, fs: bandFs });
    const out2 = out;

    const key = [p.arch, p.bits, p.fs, p.fmod, p.osr, p.vref, p.inFreq, p.inDbfs, p.noiseUv, M].join('|');
    let clean = cache && cache.key === key ? cache.value : null;
    if (!clean) {
      const c = applied ? A.analyse(convert(p, null, M).y, { vref: p.vref, J: out.J, fs: bandFs }) : an;
      clean = { snr: c.snr, sfdr: c.sfdr, sinad: c.sinad, mean: c.mean, floorDbfs: c.floorDbfs };
      if (cache) { cache.key = key; cache.value = clean; }
    }

    /* Where each aggressor harmonic lands — the Fourier series of the same wave,
       used for labels and the folding map, never for the simulation. */
    const fin = out.J * bandFs / M;
    const a = p.vref * Math.pow(10, p.inDbfs / 20);
    const fmax = Math.min(1e11, Math.max(200 * agg.fbw, 20 * agg.fa));
    const harmonics = [];
    for (let n = 1; n <= 799 && n * agg.fa <= fmax; n += 2) {
      const f = n * agg.fa, amp = agg.harmonic(n);
      if (!(amp > 0)) continue;
      const filt = isDs ? A.sinc3(f, p.fmod, p.osr) : 1;
      harmonics.push({ n, f, amp, pinDbfs: db20(amp / p.vref), land: A.fold(f, bandFs),
                       filter: filt, outDbfs: db20(Math.max(amp * filt, 1e-15) / p.vref) });
    }
    const predicted = [];
    if (p.path === 'input') {
      harmonics.forEach((h) => predicted.push({ n: h.n, side: 0, f: h.land, dbfs: h.outDbfs }));
    } else if (p.path === 'reference') {
      /* code ≈ Vin/(Vref + d): the error is -Vin·d/Vref, a product, so each
         harmonic appears as a pair of sidebands around the input tone */
      harmonics.forEach((h) => [1, -1].forEach((side) => {
        const f = fin + side * h.f;
        const filt = isDs ? A.sinc3(f, p.fmod, p.osr) : 1;
        predicted.push({ n: h.n, side, f: A.fold(f, bandFs),
                         dbfs: db20(Math.max(a * h.amp / (2 * p.vref) * filt, 1e-15) / p.vref) });
      }));
    }
    /* A label takes its POSITION from the series and its LEVEL from the measured
       spectrum. Levels are not predicted: a SAR's bit trials sample reference
       ripple at N different instants and average it, and a delta-sigma loop's
       noise depends on everything it is fed. */
    /* Strongest predicted contributor first, so a bin that two harmonics share is
       named after the one that dominates it — at 51 Hz with a 10 Hz output rate
       that is harmonic 251 beside five times the modulator clock, not the
       fundamental 103 dB down the filter's skirt. */
    const seen = new Set(), labels = [];
    /* Only positions the series expects to stand above the floor are looked up,
       and a label needs 12 dB of clearance: among 2,000 noise bins the largest
       sits about 9 dB above the mean, and hundreds of candidate positions would
       otherwise find one. */
    predicted.filter((q) => q.dbfs > an.floorDbfs).sort((u, v) => v.dbfs - u.dbfs).forEach((q) => {
      const k = Math.round(q.f / an.df);
      if (k <= LOBE || k >= M / 2 || an.cls[k] !== 0) return;
      let lvl = -Infinity, kk = k;
      for (let i = Math.max(0, k - 2); i <= Math.min(M / 2 - 1, k + 2); i++) {
        if (an.cls[i] === 0 && an.amp[i] > lvl) { lvl = an.amp[i]; kk = i; }
      }
      if (lvl < an.floorDbfs + 12 || seen.has(kk)) return;
      seen.add(kk);
      labels.push({ n: q.n, side: q.side, f: q.f, dbfs: lvl });
    });
    labels.sort((u, v) => v.dbfs - u.dbfs);
    labels.length = Math.min(labels.length, 4);

    /* A harmonic landing inside the DC bins but not exactly on DC is a beat slower
       than this record can resolve. The record reads it as offset; a real system
       sees that offset wander at the beat frequency. */
    const dcEdge = (LOBE + 0.5) * an.df;
    const slow = harmonics
      .filter((h) => p.path === 'input' && h.land > 1e-9 * bandFs && h.land < dcEdge && h.outDbfs > an.floorDbfs + 10)
      .sort((u, v) => v.outDbfs - u.outDbfs)[0];

    /* An aggressor component that folds into an excluded lobe is counted as part of
       the thing that lobe excludes, so it leaves SNR alone however large it is. That
       is a property of the convention, not of the converter, and it is reported
       rather than left for a reader to infer from an SNR that did not move. */
    const masked = [];
    predicted.forEach((q) => {
      const k = Math.round(q.f * M / bandFs);
      if (k >= 0 && k < (M >> 1) && an.cls[k] !== 0 && q.dbfs > an.floorDbfs) {
        masked.push({ f: q.f, dbfs: q.dbfs, n: q.n, side: q.side,
                      inside: an.cls[k] === 1 ? 'DC' : an.cls[k] === 2 ? 'the fundamental' : 'an input harmonic' });
      }
    });

    const lsb = isDs ? null : out.lsb;
    return K.result(Object.assign(base, {
      status: 'ok',
      conventions: {
        snr: 'signal over everything in band except the fundamental, input harmonics 2 to 6 and DC; interference counts as noise',
        masking: 'interference that lands inside an excluded lobe — within ' + LOBE + ' bins of DC, of the '
               + 'fundamental or of harmonics 2 to 6 — is excluded with it and does not reduce the reported SNR. '
               + 'diagnostics.masked names any such component; measurements.maskedCount counts them',
        noiseReplacement: 'the excluded bins carry no measurable noise of their own, so the measured average '
               + 'density stands in for them. Exact for white noise; for shaped noise the error is bounded by '
               + 'the fraction of bins replaced, reported as diagnostics.replacedFraction',
        sfdr: 'fundamental over the largest spur, harmonics included',
        enob: '(SINAD − 1.76 dB), referred to full scale, / 6.02',
        offset: 'mean of the output record — where an aggressor that folds to DC goes',
        window: '4-term Blackman-Harris, lobes summed over ±4 bins',
        band: isDs ? '0 to half the output data rate, after sinc³ decimation' : '0 to half the sample rate',
        edge: 'rise and fall times are 10–90%; the full linear ramp is that divided by 0.8. The lab holds the '
            + 'applied edge to a fifth of the aggressor period, so params.edge is what was applied and '
            + 'diagnostics.edgeRequested is what was asked for',
        inputFrequency: 'params.inFreq is what was asked for; measurements.inputFrequency is the coherent '
            + 'frequency actually used — an odd number of cycles in the record, so the tone and its harmonics '
            + 'sit exactly on bins'
      },
      /* What the result carries out, at full precision, with its own axes. The
         output samples and the measured spectrum are the two things a reader can
         check an assertion against; `generated` keeps the drawing caches, but it is
         not the only route to the data.

         The modulator bitstream is deliberately NOT a trace. It is up to a million
         samples, and publishing a plot-length excerpt of it under the name
         "bitstream" would claim to be the whole record. Its length and rate are
         reported instead, in diagnostics. */
      traces: (function () {
        const out = [];
        const n = out2.y.length;
        const t = new Float64Array(n);
        for (let i = 0; i < n; i++) t[i] = i / bandFs;
        out.push(K.trace('output', isDs ? 'decimated output' : 'converted code, as volts',
                         'V', 'time', 's', t, out2.y));
        const nf = an.amp.length;
        const f = new Float64Array(nf);
        for (let k = 0; k < nf; k++) f[k] = k * bandFs / M;
        out.push(K.trace('spectrum', 'measured output spectrum', 'dBFS', 'frequency', 'Hz',
                         f, Float64Array.from(an.amp)));
        return out;
      })(),
      measurements: {
        snr: an.snr, sinad: an.sinad, enob: an.enob, sfdr: an.sfdr, thd: an.thd,
        signalDbfs: an.signalDbfs, noiseDbfs: an.noiseDbfs, floorDbfs: an.floorDbfs,
        spurDbfs: an.spur.dbfs, spurAt: an.spur.f,
        interferenceDbfs: an.interference.dbfs, interferenceAt: an.interference.f,
        offset: an.mean, offsetLsb: lsb ? an.mean / lsb : 0,
        snrClean: clean.snr, snrLoss: clean.snr - an.snr, sfdrClean: clean.sfdr,
        idealSnr: idealSnr(p),
        aggressorFrequency: agg.fa, outputRate: bandFs, inputFrequency: fin,
        slowBeat: slow ? slow.land : 0, slowBeatHarmonic: slow ? slow.n : 0, dcBinsTo: dcEdge,
        clippedSamples: out.clipped,
        maskedCount: masked.length
      },
      mayBeInfinite: ['thd'],
      diagnostics: { record: M, notes: agg.notes, peakState: out.peakState || null,
                     commonPeriod: A.commonPeriod(agg.ratio),
                     replacedFraction: an.replacedFraction, noiseBins: an.noiseBins,
                     outputRate: bandFs, outputOrigin: 0,
                     modulatorSamples: isDs && out.v ? out.v.length : 0,
                     modulatorRate: isDs ? p.fmod : 0,
                     bitstreamExported: false,
                     edgeRequested: p.edgeSet === undefined ? p.edge : p.edgeSet, edgeApplied: p.edge,
                     clockRelation: p.aggMode === 'free' ? 'independent oscillator' : 'shared with the converter clock',
                     masked },
      generated: { analysis: an, harmonics, predicted, labels, agg, output: out.y, bits: isDs ? out.v : null }
    }));
  };
})();
