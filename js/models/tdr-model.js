/* SIPI — models/tdr-model.js
 * Time-domain reflectometry of a channel built from a few sections.
 *
 * The channel, from the instrument's reference plane outwards:
 *   launch      a 50 ohm line, so the trace starts flat before the first feature
 *   via A       a lumped feature: a shunt capacitance (dips) or a series inductance (bumps)
 *   via B       optional, the same feature again after a gap, for the resolution lesson
 *   trace 1     the board trace, at its own impedance
 *   section     a short run at another impedance: a connector, a neck, a pad
 *   trace 2     the trace again
 *   load        matched, open, short, or a resistor
 *
 * The TDR is what an instrument computes: S11 of the cascade over frequency
 * (K.cascadeS, the same ABCD chain the labs use, with lossy lines whose
 * characteristic impedance is complex), an inverse FFT to the impulse response,
 * and that integrated against a raised-cosine edge of the chosen 10-90% rise time
 * (K.tdrReflection). The reading is the naive one every instrument shows first:
 * Z = Z0 (1 + rho) / (1 - rho), with no layer peeling, so masking is visible.
 *
 * Time zero is the edge's 50% point, so a feature at one-way delay T reads at
 * round-trip time 2T and at its true distance on the distance axis.
 *
 * No DOM. Requires js/viz-kit.js.
 */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const NS = (root.SIPI = root.SIPI || { viz: {} });
  const K = NS.kit;
  const T = ((NS.models = NS.models || {}).tdr = {});

  const Z0 = 50;
  const PS_PER_IN = 170;            // stripline, Dk 4.03: the kit's default line material
  const DT = 1e-12;                 // 1 ps samples
  const NFFT = 8192;                // an 8.2 ns record: every echo has died by its end
  const LAUNCH_PS = 150;            // the reference line before the first feature
  const LOSS_REF = 10e9;            // trace loss is quoted at 10 GHz
  const DIEL_FRAC = 0.55;           // share of that loss that is dielectric
  const RAMP_PER_1090 = 1 / 0.5903; // a raised cosine's 10-90% is 0.5903 of its full ramp
  T.Z0 = Z0; T.PS_PER_IN = PS_PER_IN; T.LAUNCH_PS = LAUNCH_PS;

  T.defaults = {
    tr: 35,                 // ps, 10-90% at the DUT
    zt: 50,                 // ohm, trace
    len1: 2, len2: 2,       // in
    via: 'c', viaSize: 0.5, // 'c' pF | 'l' nH | 'none'
    via2: false, gap: 60,   // ps between the two vias, one way
    zs: 50, sps: 0,         // section impedance (ohm) and one-way length (ps)
    load: 'match', rl: 50,  // 'match' | 'open' | 'short' | 'r'
    loss: 0                 // dB per inch at 10 GHz on the traces and the section
  };

  function line(z, ps, lossPerIn) {
    const inches = ps / PS_PER_IN;
    return { type: 'line', z, td: ps * 1e-12, lossDb: (lossPerIn || 0) * inches,
             dielFrac: DIEL_FRAC, lossRefHz: LOSS_REF };
  }
  function feature(p) {
    if (p.via === 'c') return { type: 'shunt', c: p.viaSize * 1e-12 };
    if (p.via === 'l') return { type: 'series', l: p.viaSize * 1e-9 };
    return null;
  }

  /* The sections, and the TRUE profile against one-way delay: what the channel is,
     before any instrument looks at it. Lumped features are points. */
  T.channel = function (p) {
    const secs = [line(Z0, LAUNCH_PS, 0)];
    const truth = [{ t0: 0, t1: LAUNCH_PS, z: Z0, name: 'launch' }];
    const marks = [];
    let t = LAUNCH_PS;
    const f = feature(p);
    if (f) { secs.push(f); marks.push({ t, kind: p.via, size: p.viaSize, name: 'via' }); }
    if (f && p.via2) {
      secs.push(line(p.zt, p.gap, p.loss)); truth.push({ t0: t, t1: t + p.gap, z: p.zt, name: 'gap' });
      t += p.gap;
      secs.push(Object.assign({}, f)); marks.push({ t, kind: p.via, size: p.viaSize, name: 'second via' });
    }
    const runs = [['trace', p.zt, p.len1 * PS_PER_IN], ['section', p.zs, p.sps], ['trace', p.zt, p.len2 * PS_PER_IN]];
    for (const [name, z, ps] of runs) {
      if (ps <= 0) continue;
      secs.push(line(z, ps, p.loss));
      truth.push({ t0: t, t1: t + ps, z, name });
      t += ps;
    }
    const zl = p.load === 'open' ? Infinity : p.load === 'short' ? 0 : p.load === 'r' ? p.rl : Z0;
    return { secs, truth, marks, end: t, zl };
  };

  /* Input reflection with an arbitrary load, from the cascade's ABCD:
       Zin = (A·ZL + B) / (C·ZL + D),  Gamma = (Zin − Z0) / (Zin + Z0).
     Open and short are the two limits, taken exactly rather than through a large
     or small resistor. */
  function gammaIn(abcd, zl) {
    const { ar, ai, br, bi, cr, ci, dr, di } = abcd;
    let nr, ni, dr2, di2;
    if (zl === Infinity) { nr = ar; ni = ai; dr2 = cr; di2 = ci; }
    else if (zl === 0) { nr = br; ni = bi; dr2 = dr; di2 = di; }
    else { nr = ar * zl + br; ni = ai * zl + bi; dr2 = cr * zl + dr; di2 = ci * zl + di; }
    // Gamma = (N − Z0·D') / (N + Z0·D'), N/D' = Zin; no division by a zero D'
    const ur = nr - Z0 * dr2, ui = ni - Z0 * di2, vr = nr + Z0 * dr2, vi = ni + Z0 * di2;
    const m = vr * vr + vi * vi;
    return [(ur * vr + ui * vi) / m, (ui * vr - ur * vi) / m];
  }

  T.run = function (pIn) {
    const p = Object.assign({}, T.defaults, pIn);
    const ch = T.channel(p);
    const re = new Float64Array(NFFT), im = new Float64Array(NFFT);
    const fs = 1 / DT;
    for (let k = 0; k <= NFFT / 2; k++) {
      const f = Math.max(k * fs / NFFT, 1e6);
      const S = K.cascadeS(ch.secs, f, Z0, LOSS_REF);
      const [gr, gi] = gammaIn(S.abcd, ch.zl);
      re[k] = gr; im[k] = gi;
      if (k > 0 && k < NFFT / 2) { re[NFFT - k] = gr; im[NFFT - k] = -gi; }
    }
    K.fft(re, im, true);                              // S11 impulse response, per sample
    const ramp = p.tr * RAMP_PER_1090;                // full ramp, ps
    const rhoRaw = K.tdrReflection(re, ramp / (DT * 1e12), NFFT);
    /* shift so t = 0 is the edge's 50% point */
    const shift = Math.round(ramp / 2);
    const n = NFFT - shift;
    const t = new Float64Array(n), rho = new Float64Array(n), z = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      t[i] = i * DT * 1e12;                           // round-trip time, ps
      const r = rhoRaw[i + shift];
      rho[i] = r;
      const rc = Math.max(-0.999, Math.min(0.999, r));
      z[i] = Z0 * (1 + rc) / (1 - rc);
    }
    return {
      p, channel: ch, t, rho, z,
      /* the edge occupies tr·v; the round trip halves what that resolves */
      edgeIn: p.tr / PS_PER_IN,
      resolutionIn: p.tr / (2 * PS_PER_IN),
      roundTripEnd: 2 * ch.end,
      at(roundTripPs) { const i = Math.round(roundTripPs); return i >= 0 && i < n ? { rho: rho[i], z: z[i] } : null; }
    };
  };

  /* Reading helpers the panel and the gate share. */
  T.toIn = (roundTripPs) => roundTripPs / 2 / PS_PER_IN;
  T.extremum = function (r, t0, t1, sign) {        // sign −1: deepest dip, +1: highest bump
    let best = null;
    for (let i = Math.max(0, Math.round(t0)); i <= Math.min(r.z.length - 1, Math.round(t1)); i++) {
      if (best === null || sign * (r.z[i] - r.z[best]) > 0) best = i;
    }
    return best === null ? null : { t: best, z: r.z[best], rho: r.rho[best] };
  };
})();
