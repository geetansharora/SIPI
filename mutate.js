#!/usr/bin/env node
/* Mutation harness — proves the model gate can FAIL.
 *
 *   node mutate.js            run every active mutation
 *   node mutate.js --fast     run only the ones marked fast
 *   node mutate.js ctle       run mutations whose id contains "ctle"
 *   node mutate.js --list     print the manifest without running anything
 *
 * WHY THIS EXISTS.
 *
 * check-models.js grew to 276 assertions and all of them passed. Astra then
 * multiplied the CTLE's applied complex gain by two — a 6.02 dB gain error — and
 * all fourteen CTLE assertions still passed. One of them was
 * `Math.abs(pk / pk - 1) < 1e-12`, which is true for every finite input.
 *
 * An assertion count is therefore not a quality measure. The measure is whether
 * the gate notices a consequential fault, and the only way to know that is to
 * introduce one on purpose. Each entry below plants a specific defect in a copy
 * of the tree and requires a NAMED assertion to fail.
 *
 * WHAT COUNTS AS DETECTION (A1, and G-6).
 *
 * Not "the run went red". A syntax error, a module that fails to load, a timeout
 * or an unrelated assertion failing all prove nothing about the claim in
 * question — they only prove the harness broke something. So every mutation is
 * checked four ways:
 *
 *   1. baseline   the target suite must PASS before the mutation
 *   2. applied    the replacement must occur exactly the expected number of times
 *   3. runnable   the mutated tree must still load and run
 *   4. named      the specific assertion named by `expect` must be among the
 *                 failures
 *
 * Anything else is reported as a harness error, never as a pass.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const TIMEOUT_MS = 120000;

/* ---------- the manifest ----------
 * id        short name, also the filter
 * file      which source file to mutate
 * find      exact text to replace (must be unique unless `count` says otherwise)
 * with      what to replace it with
 * suite     the check-models.js suite filter to run
 * expect    substring of the assertion that MUST fail
 * why       what real defect this stands in for
 * active    false means the test that would catch it does not exist yet
 * owner     which plan item owes that test
 * fast      include in the small set that runs on every ./check
 */
const MUTATIONS = [
  {
    id: 'repaint-becomes-rebuild',
    file: 'js/viz-kit.js',
    find: '    if (ev.detail.handled) return true;',
    with: '    if (false) return true;',
    suite: 'One result, one truth —',
    expect: 'without the loader nudging a control',
    why: 'R10: every view operation falls back to nudging a physical control, '
       + 'which a module cannot tell apart from the reader moving a slider. On '
       + 'Lab B that cleared the selected preset, re-solved the whole pipeline '
       + 'and abandoned a running sweep because somebody hid a trace.',
    active: true, fast: true
  },
  {
    id: 'suppression-back-to-colour',
    file: 'js/viz-kit.js',
    find: "    return id ? 'id:' + id : K.colourKey(colour);",
    with: '    return K.colourKey(colour);',
    suite: 'One result, one truth —',
    expect: 'two series sharing a colour get different keys once they have ids',
    why: 'R10: colour-keyed suppression, which cannot tell two same-coloured '
       + 'series apart. One page paid the whole price -- the critical-length '
       + 'boundary and the transmission-line region share --reflect, and that '
       + 'panel had no working legend toggles at all.',
    active: true, fast: true
  },
  {
    id: 'traces-lose-their-numbers',
    file: 'js/viz/cdr.js',
    find: "        K.trace('transfer', 'input to recovered clock', '-',\n"
        + "                'jitter frequency', 'Hz', sweep.map((q) => q.f), sweep.map((q) => q.h)),",
    with: "        { id: 'transfer', label: 'input to recovered clock', unit: '-' },",
    suite: 'One result, one truth —',
    expect: 'cdr traces carry x values and y values',
    why: 'R10: three panels declared traces as an id, a label and a unit with no '
       + 'numbers attached, the data sitting in `generated` where no export could '
       + 'reach it. That is why the CSV was a table of rounded readouts rather '
       + 'than the curves.',
    active: true, fast: true
  },
  {
    id: 'fn-called-the-bandwidth',
    file: 'js/viz/cdr.js',
    find: '    const f3dB = p.fn * 1e6 * bwFactor(p.zeta);',
    with: '    const f3dB = p.fn * 1e6;',
    suite: 'CDR loop —',
    expect: 'NOT the natural frequency, by a wide margin',
    why: 'R8: the panel labelled the natural frequency "loop bw". At zeta 0.7 '
       + 'the closed-loop -3 dB bandwidth is 2.049x higher, and the ratio '
       + 'itself runs from 1.58 to 3.37 across the damping control — so the '
       + 'label taught a relationship that does not exist.',
    active: true, fast: true
  },
  {
    id: 'residual-peak-unreported',
    file: 'js/viz/cdr.js',
    find: '      if (s.e > peakE) { peakE = s.e; peakEF = s.f; }',
    with: '      if (s.e > peakE && s.e <= 1) { peakE = s.e; peakEF = s.f; }',
    suite: 'CDR loop —',
    expect: 'residual EXCEEDS unity, which is worse than no loop',
    why: 'Caps the residual peak at unity, which is what the retired guide '
       + 'answer assumed when it said the residual "dips below what a '
       + 'first-order model would predict". Measured, it reaches x3.37 at the '
       + 'lowest damping the control allows, and tolerance dips with it.',
    active: true, fast: true
  },
  {
    id: 'tail-from-fixed-window',
    file: 'js/viz/lab-channel.js',
    find: '      const d = Math.min((i - peakAt + NFFT) % NFFT, (peakAt - i + NFFT) % NFFT);\n'
        + '      if (d >= NFFT / 4) wrapAmp = Math.max(wrapAmp, Math.abs(re[i]));',
    with: '      if (i >= Math.floor(NFFT * 0.875)) wrapAmp = Math.max(wrapAmp, Math.abs(re[i]));',
    suite: 'Lab B assembled —',
    expect: 'channel with no reflector reports a negligible tail',
    why: 'R5 restored: measuring a fixed last eighth of the circular record '
       + 'rather than a distance from the response peak. On a matched lossless '
       + 'line with no reflector anywhere it reads 3.8462% at every record '
       + 'length, because the de-embedded peak sits at sample 0 and the '
       + 'sidelobes of a band-limited fractional delay wrap in behind it. The '
       + 'retired comment quoted 1.26e-2 unchanged at every record length for the '
       + '"resonator" case and read it as physics; restoring this mutation '
       + 'reproduces exactly that number, which is how we know it was the artefact.',
    active: true, fast: true
  },
  {
    id: 'lab-a-fixed-spatial-grid',
    file: 'js/viz/lab-waves.js',
    find: '    const NX_PER_EDGE = 64;      // intervals across the wavefront ramp',
    with: '    const NX_PER_EDGE = 1;       // intervals across the wavefront ramp',
    suite: 'Lab A quadrature —',
    expect: 'closes to better than 0.1%',
    why: 'R6 restored. With the spatial grid no longer following the edge, a '
       + '12 inch line with a 10 ps wavefront puts about one sample on the '
       + 'transition and the energy account fails to close by 74.58% — while '
       + 'the conservation equation it is evaluating remains exactly right.',
    active: true, fast: true
  },
  {
    id: 'edge-collapses-to-two-samples',
    file: 'js/viz/lab-pdn.js',
    find: '  const MIN_EDGE_SAMPLES = 8;',
    with: '  const MIN_EDGE_SAMPLES = 1;',
    suite: 'Lab C transient —',
    expect: '200 ps and 400 ps no longer produce identical droop',
    why: 'R7 restored. With the grid no longer chosen from the request, '
       + 'max(2, round(tr/dt)) at dt = 200 ps collapses both a 200 ps and a '
       + '400 ps request to the same two-sample edge, and the panel returns '
       + 'bit-identical droop and overshoot for two different experiments.',
    active: true, fast: true
  },
  {
    id: 'il-from-the-budget',
    file: 'js/viz/lab-channel.js',
    find: '    const ilNyq = 20 * Math.log10(Math.hypot(Snyq.s21r, Snyq.s21i));',
    with: '    const ilNyq = -p.loss;',
    suite: 'The featured comparison —',
    expect: 'about 10.09 dB lossier at Nyquist',
    why: "The homepage's original assumption, made explicit: that the loss "
       + 'CONTROL is the channel\'s insertion loss. It is a budget applied to the '
       + 'trace sections, and a stub adds a quarter-wave notch it never sees — '
       + '10.09 dB of it, on the site\'s own featured comparison.',
    active: true, fast: true
  },
  {
    id: 'passivity-shortcut-restored',
    file: 'js/viz-kit.js',
    find: '    const disc = Math.max(0, T * T - 4 * D);\n    return Math.sqrt((T + Math.sqrt(disc)) / 2);',
    with: '    return Math.max(Math.hypot(s11.re + s21.re, s11.im + s21.im),\n'
        + '                    Math.hypot(s11.re - s21.re, s11.im - s21.im));',
    suite: 'Passivity —',
    expect: 'unitary asymmetric two-port has sigma_max exactly 1',
    why: 'The |S11 +/- S21| shortcut R3 found. Correct for a reciprocal, '
       + 'port-symmetric matrix and wrong in BOTH directions otherwise: it called '
       + 'a unitary network active at 1.414 and an active one passive at 0.5.',
    active: true, fast: true
  },
  {
    id: 'passivity-disc-unclamped',
    file: 'js/viz-kit.js',
    find: '    const disc = Math.max(0, T * T - 4 * D);',
    with: '    const disc = T * T - 4 * D;',
    suite: 'Passivity —',
    expect: 'equal singular values does not produce a NaN',
    why: 'Removes the clamp that keeps a nearly-degenerate pair of singular '
       + 'values from taking sqrt of a small negative. The resulting NaN is '
       + 'silent: it fails a `> 1.001` test, so an active file reads as passive.',
    active: true, fast: true
  },
  {
    id: 'domain-check-removed',
    file: 'js/viz-kit.js',
    find: '    M.admissible = M.epsInf >= 1;',
    with: '    M.admissible = M.epsInf > 0;',
    suite: 'Model domain —',
    expect: 'faster than light in vacuum',
    why: 'Astra reported the NaN at eps_inf < 0 and this is the boundary one step '
       + 'further in: between 0 and 1 there is NO NaN, the eye looks plausible, and '
       + 'the wavefront arrives before light crosses the same distance in vacuum. '
       + 'Only the causality assertion sees it.',
    active: true, fast: true
  },
  {
    id: 'nonfinite-accepted',
    file: 'js/viz-kit.js',
    find: '        if (Number.isNaN(v) || mayBeInfinite.indexOf(k) < 0) nonFinite.push(k);',
    with: '        if (mayBeInfinite.indexOf(k) < 0 && false) nonFinite.push(k);',
    suite: 'Model domain —',
    expect: 'NaN measurement forces a non-ok status',
    why: 'G-12 turned off. This is the shape of the original R2 defect: a solver '
       + 'that believes it converged publishes status ok, a settled flag and a '
       + 'valid symbol count around a NaN eye height.',
    active: true, fast: true
  },
  {
    id: 'infinity-blanket-accepted',
    file: 'js/viz-kit.js',
    find: '        if (Number.isNaN(v) || mayBeInfinite.indexOf(k) < 0) nonFinite.push(k);',
    with: '        if (Number.isNaN(v)) nonFinite.push(k);',
    suite: 'Model domain —',
    expect: 'UNdeclared infinity is refused',
    why: 'The weaker rule that lets any infinity through. It keeps the ideal '
       + 'matched channel working, so a test that only checked the reference case '
       + 'would pass -- but an unmeant division by zero would then travel just as '
       + 'freely as a declared limit.',
    active: true, fast: true
  },
  {
    id: 'realcap-band-endpoints',
    file: 'js/viz-kit.js',
    find: "        const xMin = (cRes >= loC && cRes <= hiC) ? 0 : Math.min(Math.abs(xLo), Math.abs(xHi));",
    with: "        const xMin = Math.min(Math.abs(xLo), Math.abs(xHi));",
    suite: 'Real capacitors —',
    expect: 'band contains the operating point',
    why: 'The bug this panel actually shipped with for one run of the gate. '
       + 'Building the uncertainty band from the two endpoint curves instead of '
       + 'the envelope of the family looks right on a log plot and is wrong '
       + 'between the endpoint resonances, where interior capacitances dip to '
       + 'ESR and the drawn band excludes curves that lie inside it.',
    active: true, fast: true
  },
  {
    id: 'realcap-esr-exponent',
    file: 'js/viz-kit.js',
    find: '    const rm = 2 * pw * rd;',
    with: '    const rm = pw * rd;',
    suite: 'Real capacitors —',
    expect: 'esrMin*cosh',
    why: 'Breaks the condition that puts the ESR minimum on its stated anchor. '
       + 'The curve still has a minimum and still looks like a capacitor ESR, '
       + 'so nothing about the picture gives it away — only the closed form does.',
    active: true, fast: true
  },
  {
    id: 'ctle-gain-x2',
    file: 'js/viz-kit.js',
    find: 'const gr = H.re / peak, gi = H.im / peak;',
    with: 'const gr = 2 * H.re / peak, gi = 2 * H.im / peak;',
    suite: 'CTLE —',
    expect: 'applied DC gain',
    why: "Astra's own mutation: a 6.02 dB error in the gain the CTLE actually "
       + 'applies. Passed all 14 assertions before M0-5, because every one of '
       + 'them tested the analytic helper instead of the applied path.',
    active: true, fast: true
  },
  {
    id: 'ctle-phase-stripped',
    file: 'js/viz-kit.js',
    find: 'const gr = H.re / peak, gi = H.im / peak;',
    with: 'const gr = Math.hypot(H.re, H.im) / peak, gi = 0;',
    suite: 'CTLE —',
    expect: 'causal',
    why: 'The original M2 defect — a magnitude-only equaliser, which is '
       + 'zero-phase and therefore not causal. It produced plausible eyes for '
       + 'months.',
    active: true, fast: true
  },
  {
    id: 'impulse-truncated',
    file: 'js/viz/lab-channel.js',
    find: '    const keep = NFFT;',
    with: '    const keep = Math.min(NFFT, SPS * 40);',
    suite: 'Lab B assembled',
    expect: "kept record covers the channel's memory",
    why: 'B1 itself, put back: truncate the response to 40 UI. With the '
       + 'transport delay de-embedded it no longer loses the arrival, but it '
       + 'does cut the memory of every preset that needs more than 40 UI — '
       + 'which is the claim a fixed constant can never satisfy.',
    active: true, fast: true
  },
  {
    id: 'bathtub-sentinel',
    file: 'js/viz/jitter.js',
    find: 'const lo = clippedLo ? 0 : bisect(0, MID);\n    const hi = clippedHi ? 1 : bisect(1, MID);',
    with: 'const lo = 0;\n    const hi = 1;',
    suite: 'Bathtub',
    expect: 'crossing',
    why: 'The original M1 defect and the first of three sentinel bugs in this '
       + 'project: lo=0, hi=1 means "no crossing found" while also being the '
       + 'maximally OPEN interval, so a closed eye rendered as 100% of a UI.',
    active: true, fast: true
  },
  {
    id: 'dfe-window-inclusive',
    file: 'js/viz-kit.js',
    find: 'for (let s2 = -sps / 2; s2 < sps / 2; s2++) {       // half-open: exactly sps wide',
    with: 'for (let s2 = -sps / 2; s2 <= sps / 2; s2++) {      // mutated: sps+1 wide',
    suite: 'DFE',
    expect: 'window',
    why: 'The original M3 defect. An inclusive-at-both-ends correction window is '
       + 'sps+1 samples wide, so adjacent symbols overlap and each boundary '
       + 'sample is corrected twice.',
    active: true, fast: true
  },
  {
    id: 'loss-ref-falsy-zero',
    file: 'js/viz-kit.js',
    find: "    const fRef = sec.lossRefHz !== undefined ? sec.lossRefHz\n               : (fallbackRef !== undefined ? fallbackRef : 8e9);",
    with: '    const fRef = sec.lossRefHz || fallbackRef || 8e9;',
    suite: 'Units',
    expect: 'reference frequency',
    why: 'The sentinel class for the fourth time in this project: `||` made a '
       + 'lossRefHz of 0 silently become 8 GHz, so a caller error read as a '
       + 'working default. Found by this harness reporting the rate mutation as '
       + '"survived" — the mutation set lossRefHz to 0 and nothing changed.',
    active: true, fast: true
  },
  {
    id: 'antiresonance-stale-peak',
    file: 'js/viz/pdn-extras.js',
    find: '    return { pts: pts, peak: pk ? { f: pk[0], z: pk[1] } : null };',
    with: '    return { pts: pts, peak: { f: pts[pts.length - 1][0], z: pts[pts.length - 1][1] } };',
    suite: 'Anti-resonance',
    expect: 'returns null rather than the last one it found',
    why: 'The original M7 defect and the third sentinel bug: with no else branch '
       + 'the panel kept the previous peak on screen, so a resolved problem '
       + 'still read 246.8 mOhm at 11 MHz. The mutation returns the last sweep '
       + 'point instead of null, which is what "keep the old one" amounts to. '
       + 'Activated with M2-4.',
    active: true, fast: true
  },
  {
    id: 'eye-phase-drift',
    file: 'js/viz/lab-channel.js',
    find: 'return pr.cursor;',
    with: 'return pr.cursor + 3;',
    suite: 'Lab B assembled',
    expect: 'measured AT the pulse cursor',
    why: 'B2a. The four views now share one phase, so moving it breaks the '
       + 'agreement between them. Activated with M1-5.',
    active: true, fast: true
  },
  {
    id: 'symbol-labels-from-sign',
    file: 'js/viz/lab-channel.js',
    find: "      if (bits[b] > 0) { hiLo = Math.min(hiLo, v); nHi++; }\n      else { loHi = Math.max(loHi, v); nLo++; }",
    with: "      if (v > 0) { hiLo = Math.min(hiLo, v); nHi++; }\n      else { loHi = Math.max(loHi, v); nLo++; }",
    suite: 'Lab B assembled',
    expect: 'negative opening and a non-zero error count',
    why: 'B2b, put back exactly as it shipped: group the populations by the SIGN '
       + 'of the sample instead of the symbol that was sent. A wrong sample is '
       + 'then filed as a good member of the other cloud. Activated with M1-6.',
    active: true, fast: true
  },
  {
    id: 'loss-ref-follows-rate',
    file: 'js/viz/lab-channel.js',
    find: '    const ref = LOSS_REF_HZ;',
    with: '    const ref = p.rate * 1e9 / 2;   // mutated: Nyquist, as F1 had it',
    suite: 'Lab B assembled',
    expect: 'unchanged by the symbol rate',
    why: 'F1. Anchoring the loss law to anything but a fixed physical frequency '
       + 'makes the modelled board change when the symbol rate changes, so no '
       + 'rate-only experiment is possible.',
    active: true, fast: true
  },
  {
    id: 'line-phase-linear',
    file: 'js/viz-kit.js',
    find: '    const yp = cmul(0, w * M.cvac, e[0], e[1]);     // jw*Cvac*eps_r',
    with: '    const yp = cmul(0, w * M.cvac, M.Dk, 0);        // mutated: lossless eps',
    suite: 'Causal line',
    expect: 'budget gives',
    why: 'B3. Strip the dielectric loss out of the shunt admittance, leaving the '
       + 'attenuation to come from the conductor alone. The loss budget is then '
       + 'not met, which is what the clause 6.5 assertions are for.',
    active: true, fast: true
  },
  {
    id: 'branch-current-sign',
    file: 'js/viz-kit.js',
    find: '                          im: (vNode.im * sh.re - vNode.re * sh.im) / d };',
    with: '                          im: (vNode.re * sh.im - vNode.im * sh.re) / d };',
    suite: 'Lab C assembled',
    expect: 'complex sum of the shunt currents',
    why: 'A reversed sign on the imaginary part of a branch current. It was '
       + 'undetectable while the gate summed MAGNITUDES and asserted the total '
       + 'was finite and under 50 — a sign error cannot disturb either. '
       + 'Activated with M2-6.',
    active: true, fast: true
  },
  {
    id: 'pam4-slicer-gain',
    file: 'js/viz-kit.js',
    find: "      const u = v / gain;                       // received volts -> transmit units",
    with: '      const u = v;                              // mutated: ignore the gain',
    suite: 'DFE slicer',
    expect: 'noiseless attenuated PAM4 decides correctly',
    why: 'M2-7: slicing a received sample against the transmit alphabet without '
       + 'dividing by the main-cursor gain. With a cursor of 0.2 every outer '
       + 'PAM4 symbol is decided as an inner one.',
    active: true, fast: true
  },
  {
    id: 'formatter-trims-integers',
    file: 'js/viz-kit.js',
    find: "      return t.indexOf('.') >= 0 ? t.replace(/0+$/, '').replace(/\\.$/, '') : t;",
    with: "      return t.replace(/\\.?0+$/, '');",
    suite: 'Number formatter',
    expect: '100 formats as',
    why: 'M2-8, the original: one regex against the whole string, so 100 became '
       + '"1" and 200 became "2".',
    active: true, fast: true
  },
  {
    id: 'search-score-sentinel',
    file: 'js/search.js',
    find: '      if (at < 0) return Infinity;              // sentinel must sit outside the score range',
    with: '      if (at < 0) return -1;                    // mutated: collides with valid best scores',
    suite: 'Search',
    expect: 'absent token returns no results',
    why: 'The second sentinel bug: -1 meant "no match" while negative scores '
       + 'also meant "best match".',
    active: true, fast: true
  },
  {
    id: 'eye-scale-clips-tall-signals',
    file: 'js/viz/lab-channel.js',
    find: "  const eyeStep = (need) => EYE_STEPS.find((v) => v >= need) || Math.ceil(need * 2) / 2;",
    with: "  const eyeStep = (need) => EYE_STEPS.find((v) => v >= need) || EYE_STEPS[EYE_STEPS.length - 1];",
    suite: 'Lab B eye scale —',
    expect: 'a signal past the top rung still fits',
    why: 'A held eye scale earns its keep by making a closing eye visibly close. '
       + 'The same mechanism fails dangerously in the other direction: a ladder '
       + 'that stops at its top rung draws a 3 V signal inside a 2 V frame, and '
       + 'the clipped trace reads as a clean eye rather than an overdriven one.',
    active: true, fast: true
  },

  /* ── Lab D · ADC interference ────────────────────────────────────────────
     Six faults planted in the converter model, each routed to the assertion that
     claims to catch it, plus one in what the page says — which the model gate
     cannot see, so it runs against the scenario regressions instead. */
  {
    id: 'adc-fold-sign',
    file: 'js/models/adc-model.js',
    find: 'return Math.abs(f - Math.round(f / fs) * fs);',
    with: 'return Math.abs(f + Math.round(f / fs) * fs);',
    suite: 'ADC aliasing',
    expect: 'every fold lands where remainder-and-mirror puts it',
    why: 'Where a tone lands after sampling is the whole subject of the page. A '
       + 'sign error puts every spur somewhere else, and the spectrum still looks '
       + 'entirely plausible.',
    active: true, fast: true
  },
  {
    id: 'adc-window-power-correction',
    file: 'js/models/adc-model.js',
    find: 'pw[k] = (k === 0 ? 1 : 2) * m2 / (M * S2);',
    with: 'pw[k] = (k === 0 ? 1 : 2) * m2 / (M * M);',
    suite: 'ADC metrics',
    expect: 'an off-bin −20 dBFS tone still sums to −20 dBFS',
    why: 'A window needs two different corrections, and the power one is what makes '
       + 'a lobe sum to the tone that produced it. Without it every level is wrong '
       + 'by the same 5.9 dB, which looks like a calibration rather than a bug.',
    active: true, fast: true
  },
  {
    id: 'adc-window-amplitude-correction',
    file: 'js/models/adc-model.js',
    find: 'Math.sqrt(m2) / S1 / vref',
    with: 'Math.sqrt(m2) / M / vref',
    suite: 'ADC metrics',
    expect: 'a full-scale coherent sine reads 0 dBFS at its bin',
    why: 'The other of the two corrections. A full-scale sine stops reading 0 dBFS, '
       + 'so every displayed level is offset and nothing in the plot says so.',
    active: true, fast: true
  },
  {
    id: 'adc-dc-counted-as-noise',
    file: 'js/models/adc-model.js',
    find: 'mark(0, 1);',
    with: '/* DC not excluded */',
    suite: 'ADC aliasing',
    expect: 'only a shared crystal lands on DC, leaving SNR alone',
    why: 'An aggressor locked to the clock lands on DC, where it is an offset and '
       + 'not noise. Counting DC as noise makes a shared clock look like a '
       + 'catastrophe and hides the actual lesson, which is that it moves the zero.',
    active: true, fast: true
  },
  {
    id: 'adc-reference-read-once',
    file: 'js/models/adc-model.js',
    find: 'const vr = vref + agg.at(n + when[j]);',
    with: 'const vr = vref + agg.at(n);',
    suite: 'ADC reference coupling',
    expect: 'a reference pulse at 0.25 T costs SNR; the same pulse at 0.75 T costs nothing',
    why: 'A SAR reads its reference once per BIT TRIAL, not once per sample. Reading '
       + 'it once removes the entire mechanism the lesson is about — a disturbance '
       + 'that arrives between trials stops mattering.',
    active: true, fast: true
  },
  {
    id: 'adc-integrators-out-of-order',
    file: 'js/models/adc-model.js',
    find: '      x1 += u - fb;\n      x2 += x1 - fb;',
    with: '      x2 += x1 - fb;\n      x1 += u - fb;',
    suite: 'ADC delta-sigma',
    expect: 'the reference delta-sigma scenario runs at all',
    why: 'The second integrator using the OLD first integrator is a different loop. '
       + 'It is also an unstable one at this input level, so what catches it is the '
       + 'assertion that the reference scenario produced a bitstream at all — which '
       + 'is why that assertion exists: without it the suite threw a TypeError and '
       + 'took the gate down before naming anything, and a red run that names '
       + 'nothing proves nothing.',
    active: true, fast: true
  },
  {
    id: 'adc-feedback-gain-error',
    file: 'js/models/adc-model.js',
    find: '      x1 += u - fb;',
    with: '      x1 += u - fb * 1.0005;',
    suite: 'ADC delta-sigma',
    expect: 'V = z⁻¹U + (1−z⁻¹)²E leaves a bounded quantization error',
    why: 'A feedback DAC 0.05 % out is the transfer-function fault that does NOT '
       + 'destabilise the loop: the bitstream still decimates to something that '
       + 'looks like the input, and the SNR slope against oversampling is '
       + 'unchanged. What notices is the transfer function itself — the double '
       + 'integral of (V − z⁻¹U) stops being a bounded quantization error and '
       + 'reaches 2.2 kV against a 42.5 V bound.',
    active: true, fast: true
  },
  {
    id: 'adc-two-boxcars',
    file: 'js/models/adc-model.js',
    find: 'return conv(conv(box, box), box);',
    with: 'return conv(box, box);',
    suite: 'ADC decimation',
    expect: 'the kernel is 3·OSR−2 long, unity at DC and symmetric',
    why: 'A sinc-squared decimator still passes DC and still nulls the output rate. '
       + 'It just stops rejecting the shaped noise between the nulls, which is the '
       + 'reason the third boxcar is there.',
    active: true, fast: true
  },
  {
    id: 'adc-quantizer-rounds',
    file: 'js/models/adc-model.js',
    find: 'c = Math.min(2 * half - 1, Math.max(0, Math.floor((h / vref + 1) * half)));',
    with: 'c = Math.min(2 * half - 1, Math.max(0, Math.round((h / vref + 1) * half)));',
    suite: 'ADC SAR',
    expect: 'no sample is further than half an LSB from its input',
    why: 'Rounding where the ladder truncates shifts the whole transfer curve by half '
       + 'an LSB. The spectrum is unchanged; only the error against the input moves.',
    active: true, fast: true
  },
  {
    id: 'adc-masking-not-reported',
    file: 'js/models/adc-model.js',
    find: 'if (k >= 0 && k < (M >> 1) && an.cls[k] !== 0 && q.dbfs > an.floorDbfs) {',
    with: 'if (false) {',
    suite: 'ADC metrics',
    expect: 'interference hidden inside an excluded lobe is named, not silently dropped',
    why: 'Interference that folds inside an excluded lobe leaves SNR alone however '
       + 'large it is. Not reporting that turns a limitation of the convention into '
       + 'an apparently clean result.',
    active: true, fast: true
  },
  {
    id: 'adc-domain-unchecked',
    file: 'js/models/adc-model.js',
    find: 'const bad = A.validate(p);',
    with: 'const bad = null;',
    suite: 'ADC domain',
    expect: 'every value outside the domain is refused with a reason',
    why: 'Slider ranges are a user interface. A scenario link carrying a negative '
       + 'reference or an input above Nyquist would otherwise come back with '
       + 'numbers that look like measurements.',
    active: true, fast: true
  },
  {
    id: 'adc-scenario-note-stale',
    file: 'js/viz/adc-lab.js',
    find: 'SNR falls from 97.1 to 85.2 dB',
    with: 'SNR falls from 97.1 to 86.2 dB',
    runner: 'tests/check-adc-integration.js',
    expect: 'every simulated number in the lesson, the guide and the scenario notes',
    why: 'The defect this catches is prose, not arithmetic: a scenario note left '
       + 'quoting a result the model no longer produces. The model gate cannot see '
       + 'it, so it runs against the scenario regressions instead of being dressed '
       + 'up as a numerical assertion.',
    active: true, fast: true
  },
  /* ── Calculators · one planted defect each, in js/models/calc-models.js ── */
  {
    id: 'calc-rlc-drops-2pi',
    file: 'js/models/calc-models.js',
    find: 'const w0 = 1 / Math.sqrt(L * Cap), f0 = w0 / (2 * Math.PI);',
    with: 'const w0 = 1 / Math.sqrt(L * Cap), f0 = w0;',
    suite: 'Calculator: LC/RLC resonance',
    expect: 'resonate at 159.155 MHz',
    why: 'Radians per second reported as hertz: every resonance 6.28x too high, and '
       + 'a Q and bandwidth that still look self-consistent.',
    active: true, fast: true
  },
  {
    id: 'calc-refl-sign-flipped',
    file: 'js/models/calc-models.js',
    find: "if (given === 'zl') { g = (value - z0) / (value + z0); zl = value; }",
    with: "if (given === 'zl') { g = (z0 - value) / (value + z0); zl = value; }",
    suite: 'Calculator: return loss, reflection coefficient, VSWR',
    expect: '75 ohm on 50 ohm gives gamma = +0.2',
    why: 'Return loss and VSWR are blind to the sign, so an inverted convention '
       + 'survives every magnitude check and only the known-load case exposes it.',
    active: true, fast: true
  },
  {
    id: 'calc-ber-single-sided-tj',
    file: 'js/models/calc-models.js',
    find: 'const tj = dj + 2 * q * rj;',
    with: 'const tj = dj + q * rj;',
    suite: 'Calculator: BER, Q and total jitter',
    expect: 'is the published 14.069 ps',
    why: 'Counting the random tail on one side of the eye only halves the RJ '
       + 'penalty, and makes a closed eye look open.',
    active: true, fast: true
  },
  {
    id: 'calc-bitrate-knee-not-3db',
    file: 'js/models/calc-models.js',
    find: '    const bw = 0.35 / tr;',
    with: '    const bw = 0.5 / tr;',
    suite: 'Calculator: bit rate, UI and Nyquist',
    expect: 'edge bandwidth is the single pole ln(9)/(2*pi*tr)',
    why: 'The knee frequency 0.5/tr is a different, looser rule; presenting it as '
       + 'the -3 dB bandwidth overstates how far the spectrum reaches.',
    active: true, fast: true
  },
  {
    id: 'calc-elen-one-way-not-round-trip',
    file: 'js/models/calc-models.js',
    find: 'const tpd = C.tpd(dk), td = lenIn * tpd, lcrit = tr / (6 * tpd);',
    with: 'const tpd = C.tpd(dk), td = lenIn * tpd, lcrit = tr / (3 * tpd);',
    suite: 'Calculator: electrical length',
    expect: 'at the critical length the round trip is exactly tr/3',
    why: 'Forgetting that the reflection has to come back doubles the critical '
       + 'length, and calls a transmission line a lumped wire.',
    active: true, fast: true
  },
  {
    id: 'calc-stub-half-wave',
    file: 'js/models/calc-models.js',
    find: 'const fNotch = C0 / (4 * lenMil * MIL * Math.sqrt(dk));',
    with: 'const fNotch = C0 / (2 * lenMil * MIL * Math.sqrt(dk));',
    suite: 'Calculator: via stub resonance',
    expect: 'at the notch the stub is a quarter wavelength',
    why: 'A half-wave stub is transparent, not resonant. Using it puts the notch '
       + 'at twice its real frequency and approves stubs that should be backdrilled.',
    active: true, fast: true
  },
  {
    id: 'calc-ztarget-percent-as-fraction',
    file: 'js/models/calc-models.js',
    find: '    const dv = v * ripplePct / 100;',
    with: '    const dv = v * ripplePct;',
    suite: 'Calculator: target impedance',
    expect: '0.8 V, 3%, 20 A gives 1.2 milliohm',
    why: 'A percentage read as a fraction makes the target a hundred times too '
       + 'lenient, and every PDN drawn against it looks comfortably compliant.',
    active: true, fast: true
  },
  {
    id: 'calc-skin-drops-pi',
    file: 'js/models/calc-models.js',
    find: 'C.skinDepth = (f) => Math.sqrt(RHO_CU / (Math.PI * f * MU0));',
    with: 'C.skinDepth = (f) => Math.sqrt(RHO_CU / (f * MU0));',
    suite: 'Calculator: skin depth and roughness',
    expect: 'copper at 1 GHz: 2.06 um',
    why: 'A missing pi makes the skin 1.8x too thick, which halves the roughness '
       + 'penalty and understates conductor loss everywhere downstream.',
    active: true, fast: true
  },
  {
    id: 'calc-loss-dk-not-sqrt',
    file: 'js/models/calc-models.js',
    find: 'const ad = Math.PI * f * Math.sqrt(dk) * df / C0 * DB_PER_NP * IN;',
    with: 'const ad = Math.PI * f * dk * df / C0 * DB_PER_NP * IN;',
    suite: 'Calculator: loss budget',
    expect: 'dielectric loss matches 2.3*f[GHz]*Df*sqrt(Dk)',
    why: 'Dk where sqrt(Dk) belongs inflates dielectric loss by a factor of about '
       + 'two, and blames the laminate for loss it does not cause.',
    active: true, fast: true
  },
  {
    id: 'calc-cavity-full-wave',
    file: 'js/models/calc-models.js',
    find: '    const f = (m, n) => (v / 2) * Math.sqrt(Math.pow(m / a, 2) + Math.pow(n / b, 2));',
    with: '    const f = (m, n) => v * Math.sqrt(Math.pow(m / a, 2) + Math.pow(n / b, 2));',
    suite: 'Calculator: plane cavity resonance',
    expect: 'air, 150 mm: f(1,0) = c/2a',
    why: 'A full wavelength across the plane instead of a half puts every mode an '
       + 'octave high, beyond the band where the board actually rings.',
    active: true, fast: true
  },
  {
    id: 'calc-mount-diameter-as-radius',
    file: 'js/models/calc-models.js',
    find: 'const lVia = K.viaLoopInductance(hMil * MIL, dMil * MIL / 2, sMil * MIL);',
    with: 'const lVia = K.viaLoopInductance(hMil * MIL, dMil * MIL, sMil * MIL);',
    suite: 'Calculator: mounting inductance',
    expect: 'the exact loop matches the thin-wire ln(2s/d)',
    why: 'Passing the drill diameter where the radius belongs makes every via look '
       + 'twice as fat, and the loop inductance optimistically small.',
    active: true, fast: true
  },
  {
    id: 'calc-microstrip-eta-over-pi',
    file: 'js/models/calc-models.js',
    find: '    return ETA0 / (2 * Math.PI) * Math.log(fu / u + Math.sqrt(1 + 4 / (u * u)));',
    with: '    return ETA0 / Math.PI * Math.log(fu / u + Math.sqrt(1 + 4 / (u * u)));',
    suite: 'Calculator: microstrip and stripline impedance',
    expect: 'Hammerstad-Jensen agrees with Wheeler',
    why: 'A factor of two in the air-line impedance doubles every microstrip Z0; '
       + 'only an independent formula can see it, since the model stays '
       + 'monotonic and smooth.',
    active: true, fast: true
  },
];

/* A deliberately UNDETECTABLE mutation, used only by --selftest.
   The harness has to be able to report "survived", or its verdict of "detected"
   carries no information — the same trap as an assertion that cannot fail. This
   renames an internal variable, which changes no behaviour, so a correct harness
   must report it as surviving. */
const SELFTEST = {
  id: 'selftest-noop',
  file: 'js/viz-kit.js',
  find: '  K.berFloor = function (n) {',
  with: '  K.berFloor = function (n) { /* behaviour-preserving edit */',
  suite: 'Evidence',
  expect: 'floor',
  why: 'harness self-test — must survive',
  active: true
};

/* ---------- harness ---------- */
const args = process.argv.slice(2);
const FAST = args.includes('--fast');
const LIST = args.includes('--list');
const SELF = args.includes('--selftest');
const FILTER = args.filter((a) => !a.startsWith('-'))[0];

function selected() {
  if (SELF) return [SELFTEST];
  return MUTATIONS.filter((m) => {
    if (FILTER && !m.id.includes(FILTER)) return false;
    if (FAST && !m.fast) return false;
    return true;
  });
}

/* Most mutations are checked by the model gate. A defect in what the PAGE says —
   a scenario note left quoting a result the model no longer produces — is not a
   numerical assertion and must not be dressed up as one, so a mutation may name a
   different runner. It reports failures in the same `x <assertion>` form, which is
   what `expect` is matched against. */
function gate(src, suiteFilter, runner) {
  const argv = [runner || 'check-models.js'];
  if (suiteFilter && !runner) argv.push(suiteFilter);
  try {
    const out = execFileSync('node', argv, {
      cwd: ROOT, timeout: TIMEOUT_MS, encoding: 'utf8',
      env: Object.assign({}, process.env, { SIPI_SRC: src }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return { passed: true, out: out };
  } catch (e) {
    if (e.killed || e.signal) return { passed: false, out: '', timedOut: true };
    return { passed: false, out: (e.stdout || '') + (e.stderr || '') };
  }
}

function copyTree(dest) {
  /* Anything a suite READS through SIPI_SRC has to come along, or the suite
     fails before a mutation is planted and the harness correctly reports a
     baseline failure rather than detection. tests/fixtures carries the .s2p
     counterexamples; index.html carries the featured comparison that the
     page-against-model cross-check parses. */
  for (const rel of ['js', 'check-models.js', 'topics.json', 'tests', 'index.html',
                     /* the ADC scenario regressions read the page they guard */
                     'topics/labs/adc-interference.html']) {
    const from = path.join(ROOT, rel), to = path.join(dest, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(from, to, { recursive: true });
  }
}

function main() {
  const list = selected();
  if (LIST) {
    console.log('\n  mutation manifest\n');
    for (const m of list) {
      console.log(`  ${m.active ? '[active]' : '[pending]'} ${m.id}`);
      console.log(`      ${m.why.replace(/\s+/g, ' ')}`);
      if (!m.active) console.log(`      owed by ${m.owner} — ${m.note.replace(/\s+/g, ' ')}`);
      console.log('');
    }
    return 0;
  }

  const active = list.filter((m) => m.active);
  const skipped = list.filter((m) => !m.active);

  console.log(`\n  ${active.length} active mutation(s), ${skipped.length} pending\n`);

  const results = [];
  for (const m of active) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sipi-mut-'));
    try {
      copyTree(tmp);

      // 1. BASELINE — the target suite must pass before anything is changed.
      const base = gate(tmp, m.suite, m.runner);
      if (!base.passed) {
        results.push({ m, state: 'baseline-failure',
                       detail: 'the suite fails before the mutation' });
        continue;
      }

      // 2. APPLIED — exactly once, and verifiably.
      const target = path.join(tmp, m.file);
      const before = fs.readFileSync(target, 'utf8');
      const hits = before.split(m.find).length - 1;
      if (hits !== 1) {
        results.push({ m, state: 'invalid-mutation',
                       detail: `the anchor text occurs ${hits} time(s), expected 1` });
        continue;
      }
      const after = before.replace(m.find, m.with);
      if (after === before) {
        results.push({ m, state: 'invalid-mutation', detail: 'replacement was a no-op' });
        continue;
      }
      fs.writeFileSync(target, after);

      // 3 + 4. RUNNABLE, and the NAMED assertion must be the one that fails.
      const run = gate(tmp, m.suite, m.runner);
      if (run.timedOut) {
        results.push({ m, state: 'harness-error', detail: 'the mutated run timed out' });
        continue;
      }
      if (run.passed) {
        results.push({ m, state: 'survived',
                       detail: 'the gate did not notice' });
        continue;
      }
      const fails = run.out.split('\n').filter((l) => l.trim().startsWith('x '));
      if (!fails.length) {
        results.push({ m, state: 'harness-error',
                       detail: 'the run failed without reporting an assertion — '
                             + 'probably a parse or load error, which proves nothing' });
        continue;
      }
      const named = fails.filter((l) => l.includes(m.expect));
      if (!named.length) {
        results.push({ m, state: 'wrong-assertion',
                       detail: `expected "${m.expect}" to fail; instead: `
                             + fails[0].trim().slice(0, 110) });
        continue;
      }
      results.push({ m, state: 'detected',
                     detail: `${named.length} named assertion(s) of ${fails.length} failure(s)` });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  console.log('');
  let bad = 0;
  const want = SELF ? 'survived' : 'detected';
  for (const r of results) {
    const tag = r.state === want ? 'ok  ' : 'FAIL';
    if (r.state !== want) bad++;
    console.log(`  ${tag} ${r.m.id.padEnd(26)} ${r.state.padEnd(17)} ${r.detail}`);
  }
  if (SELF) {
    console.log('');
    console.log(bad ? '  the harness did NOT report a behaviour-preserving edit as surviving,'
                    + '\n  so its "detected" verdicts cannot be trusted either.'
                    : '  ok the harness reports a behaviour-preserving edit as surviving,'
                    + '\n     so it is measuring detection and not just returning yes');
    return bad ? 1 : 0;
  }
  for (const m of skipped) {
    console.log(`  ..   ${m.id.padEnd(26)} pending           owed by ${m.owner}`);
  }

  console.log('');
  if (bad) {
    console.log(`  ${bad} mutation(s) were not detected by their named assertion.\n`);
    console.log('  A surviving mutation means the gate cannot see that defect. A');
    console.log('  wrong-assertion or harness-error result means the run went red for');
    console.log('  the wrong reason, which is not evidence either.');
    return 1;
  }
  console.log(`  ok every active mutation was caught by the assertion that claims it`);
  if (skipped.length) {
    console.log(`     ${skipped.length} pending — each names the item that owes its test`);
  }
  return 0;
}

process.exit(main());
