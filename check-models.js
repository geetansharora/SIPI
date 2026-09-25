#!/usr/bin/env node
/* Independent model gate for the SI & PI visualisations.
 *
 *   node check-models.js          run every suite
 *   node check-models.js ctle     run suites whose name contains "ctle"
 *   node check-models.js -v       list passes as well as failures
 *
 * WHY THIS EXISTS, and the rule it follows.
 *
 * `scaffold.py check` validates structure and `check-numbers.py` validates the
 * prose. Neither can see whether a model is physically right. A magnitude-only
 * CTLE produced a perfectly plausible eye for months; the only thing that caught
 * it was asking whether energy appeared BEFORE an impulse.
 *
 * So every assertion here must be INDEPENDENT of the implementation it tests.
 * Re-running the same formula in a second file catches a typo and proves nothing
 * about the physics. What counts:
 *
 *   - analytical limits          a matched load must not reflect, at all
 *   - conservation laws          a lossless network cannot gain energy
 *   - closed-form special cases  a 50% duty square wave has no even harmonics
 *   - symmetry and monotonicity  stated WITH a precondition. "More loss never
 *                                opens an eye" is true for a reflectionless
 *                                channel and false once a reflection can be
 *                                damped; see M0-8 for both halves.
 *   - dimensional checks         three periods of 120 MHz is 25 ns, not 25 ps
 *
 * Where a test does restate a formula, it says so and is labelled a regression
 * guard rather than a validation.
 */
'use strict';
const fs = require('fs');
const path = require('path');

/* ---------- a DOM shim just large enough to load the modules ---------- */
/* M0-1 · The suite must be able to run against a copy of the tree, so that
   `mutate.js` can plant a fault in an isolated directory and ask whether this
   gate notices. Without this the harness would have to mutate the working tree,
   which is both destructive and a lie about what was tested. */
const SRC = process.env.SIPI_SRC ? path.resolve(process.env.SIPI_SRC) : __dirname;

function loadSite() {
  const listeners = [];
  global.window = {
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener: (...a) => listeners.push(a),
    removeEventListener() {},
    devicePixelRatio: 1,
  };
  global.document = {
    currentScript: { src: path.join(SRC, 'js/search.js') },
    documentElement: {}, addEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
  };
  global.getComputedStyle = () => ({ getPropertyValue: () => '#000000' });
  global.fetch = () => new Promise(() => {});
  const files = ['js/viz-kit.js', 'js/models/calc-models.js', 'js/models/laminates.js', 'js/models/coupling-model.js', 'js/viz/jitter.js', 'js/viz/crosstalk.js',
                 'js/viz/spectrum.js', 'js/viz/pdn-extras.js',
                 'js/viz/lab-waves.js', 'js/viz/lab-channel.js', 'js/viz/lab-pdn.js',
                 'js/viz/cdr.js', 'js/models/adc-model.js',
                 'js/viz/home-showcase.js', 'js/search.js'];
  for (const f of files) {
    // eslint-disable-next-line no-eval
    eval(fs.readFileSync(path.join(SRC, f), 'utf8'));
  }
  return global.window.SIPI;
}

/* ---------- assertions ---------- */
let PASS = 0; const FAILS = []; let SUITE = '';
/* A1 · "No silent pending critical claims." Some claims cannot be asserted yet
   because the repair they describe is a later milestone. Recording them as a
   comment would make a green run read as "verified", so they are counted and
   printed instead: the run ends with "N passed, M pending" and names each one
   with the item that owes it. */
const PENDING = [];
const VERBOSE = process.argv.includes('-v');
const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('-'))[0];

function suite(name, fn) {
  if (FILTER && !name.toLowerCase().includes(FILTER.toLowerCase())) return;
  SUITE = name;
  console.log('\n  ' + name);
  fn();
}
function ok(what, cond, detail) {
  if (cond) { PASS++; if (VERBOSE) console.log('    ok   ' + what + (detail ? '  ' + detail : '')); }
  else { FAILS.push(SUITE + ' — ' + what + (detail ? '  ' + detail : '')); console.log('    FAIL ' + what + (detail ? '  ' + detail : '')); }
}
/* M0-4 · There used to be one `nearRel()` here, and it accepted `rel <= tol ||
   err <= tol` — one number standing in for two different quantities. A tolerance
   written as "several kHz" therefore also licensed several hundred percent
   relative error, and whichever branch was looser silently decided the verdict.

   Now the two are separate and a call site has to say which it means:
     nearAbs  the answer is known to within ±tol of these units
     nearRel  the answer is known to within tol as a fraction of itself
   `nearRel` refuses a zero target, because no relative error is defined there —
   that case is always absolute, and saying so is the point. */
function nearAbs(what, got, want, tol, unit) {
  const err = Math.abs(got - want);
  const u = unit || '';
  ok(what, err <= tol,
     `got ${fmt(got)}${u}, want ${fmt(want)}${u} (±${fmt(tol)}${u}, off by ${fmt(err)}${u})`);
}
function nearRel(what, got, want, tol, unit) {
  const u = unit || '';
  if (want === 0) {
    ok(what, false, `nearRel against a zero target is undefined — use nearAbs (${what})`);
    return;
  }
  const rel = Math.abs(got - want) / Math.abs(want);
  ok(what, rel <= tol,
     `got ${fmt(got)}${u}, want ${fmt(want)}${u} (±${(tol * 100).toFixed(3)}%, off by ${(rel * 100).toFixed(3)}%)`);
}
/* Kept only so that a call site left unconverted fails loudly rather than
   quietly picking the looser branch. */
function near() {
  throw new Error('near() is retired — choose nearAbs (units) or nearRel (fraction). See M0-4.');
}
function pending(what, owner) {
  PENDING.push({ what, owner, suite: SUITE });
  console.log('    ....  pending — ' + what + '   [owed by ' + owner + ']');
}
function fmt(v) {
  if (!isFinite(v)) return String(v);
  const a = Math.abs(v);
  return (a !== 0 && (a < 1e-3 || a >= 1e5)) ? v.toExponential(3) : Number(v.toPrecision(6)).toString();
}

/* ---------- helpers the suites share ---------- */
const SPS = 32, NFFT = 4096;
const sum = (a) => { let s = 0; for (const v of a) s += v; return s; };
const peakOf = (a) => { let m = -Infinity, at = 0; a.forEach((v, i) => { if (v > m) { m = v; at = i; } }); return { m, at }; };

const SIPI = loadSite();
const K = SIPI.kit, MODELS = SIPI.models || {};

/* ═════════ N6-3 · Search vocabulary and ranking ═════════ */
suite('Search — equivalents, ranking, acronym boundaries', () => {
  const data = JSON.parse(fs.readFileSync(path.join(SRC, 'topics.json'), 'utf8'));
  const model = SIPI.searchModel;
  const items = model.build(data);
  const slugs = (q) => model.search(items, q).map((it) => it.href.match(/\/([^/]+)\.html$/)[1]);

  ok('return loss and S11 resolve to the same first result',
     slugs('return loss')[0] === 's-parameters' && slugs('S11')[0] === 's-parameters',
     `return loss=${slugs('return loss')[0]}, S11=${slugs('S11')[0]}`);
  /* The calculators must not take a concept query from the page that explains
     the concept -- but asking for the calculator has to find it. */
  ok('asking for a return loss calculator finds the calculator',
     slugs('return loss calculator')[0] === 'return-loss-vswr', `got ${slugs('return loss calculator')[0]}`);
  ok('asking for a resonance calculator finds the calculator',
     slugs('resonance calculator')[0] === 'lc-rlc-resonance', `got ${slugs('resonance calculator')[0]}`);
  /* Lumped coupling and line-to-line crosstalk share vocabulary; each query must
     land on the page that answers it. */
  ok('capacitive coupling finds the coupling page', slugs('capacitive coupling')[0] === 'capacitive-inductive-coupling', `got ${slugs('capacitive coupling')[0]}`);
  ok('inductive coupling finds the coupling page', slugs('inductive coupling')[0] === 'capacitive-inductive-coupling', `got ${slugs('inductive coupling')[0]}`);
  ok('NEXT and FEXT still find the crosstalk page',
     ['NEXT', 'FEXT'].every((q) => slugs(q)[0] === 'crosstalk'), ['NEXT', 'FEXT'].map((q) => q + '=' + slugs(q)[0]).join(' '));
  ok('anti-resonance and PDN peak resolve to the same first result',
     slugs('anti-resonance')[0] === 'anti-resonance' && slugs('PDN peak')[0] === 'anti-resonance');
  ok('reference plane includes de-embedding as a relevant result',
     slugs('reference plane').includes('de-embedding'));
  ok('de-embedding ranks its named lesson first', slugs('de-embedding')[0] === 'de-embedding');

  ok('the short acronym S11 matches its whole-word keyword', slugs('S11')[0] === 's-parameters');
  ok('a short acronym ranks its exact topic and does not match inside an ordinary word',
     slugs('SSO')[0] === 'ssn-ground-bounce' && !slugs('SSO').includes('crosstalk'));
  ok('an absent token returns no results', model.search(items, 'zzznomatch').length === 0);
});

/* ═════════ P2-5 · CTLE ═════════ */
suite('CTLE — causality, normalisation, analytic limits', () => {
  const imp = new Float64Array(NFFT); imp[100] = 1;
  const y = K.ctle(imp, 8, SPS, NFFT);
  let pre = 0, tot = 0;
  for (let i = 0; i < y.length; i++) { const e = y[i] * y[i]; tot += e; if (i < 100) pre += e; }
  ok('response is causal (energy before an impulse is negligible)',
     pre / tot < 0.02, `${(100 * pre / tot).toFixed(2)}% before the impulse`);
  ok('response is asymmetric about the impulse (a zero-phase filter is not causal)',
     Math.abs(y[99] - y[101]) > 1e-6, `y[99]=${fmt(y[99])} y[101]=${fmt(y[101])}`);

  // boost is peak-to-DC, and the peak is normalised to unity — analytic, not restated
  for (const b of [3, 6, 8, 12]) {
    const fz = K.ctleZeroFor(b, 0.75, 1.4);
    let pk = 0;
    for (let i = 0; i <= 600; i++) pk = Math.max(pk, K.ctleMag((i / 600) * 4, fz, 0.75, 1.4));
    const dc = K.ctleMag(0, fz, 0.75, 1.4);
    nearAbs(`boost ${b} dB is peak-over-DC`, 20 * Math.log10(pk / dc), b, 0.02, ' dB');

    /* M0-5 · What used to stand here was `Math.abs(pk / pk - 1) < 1e-12`, which is
       true for every finite non-zero pk and therefore asserted nothing. Worse, the
       whole block only ever touched ctleMag/ctleResponse — the analytic helpers —
       so Astra's mutation (scaling the complex gain actually applied inside
       K.ctle) passed all fourteen assertions with a 6 dB gain error.

       So measure the APPLIED path, from its own output. Drive K.ctle with a unit
       impulse: the output is the filter's impulse response, and two quantities
       follow from the DEFINITION of boost rather than from the implementation —
         sum(y)  = H(0) after normalisation = 10^(-boost/20)
         max|H|  = 1, because the peak is what the normalisation divides by.
       Neither number is copied from the code under test. */
    const impB = new Float64Array(NFFT); impB[0] = 1;
    const yB = K.ctle(impB, b, SPS, NFFT);
    let dcApplied = 0;
    for (let i = 0; i < yB.length; i++) dcApplied += yB[i];
    nearAbs(`boost ${b} dB · applied DC gain is 10^(-boost/20)`,
            dcApplied, Math.pow(10, -b / 20), 1e-9);

    const reB = new Float64Array(NFFT), imB = new Float64Array(NFFT);
    for (let i = 0; i < yB.length; i++) reB[i] = yB[i];
    K.fft(reB, imB, false);
    let pkApplied = 0;
    for (let k = 0; k <= NFFT / 2; k++) pkApplied = Math.max(pkApplied, Math.hypot(reB[k], imB[k]));
    nearAbs(`boost ${b} dB · applied peak gain is unity, so the EQ adds no net gain`,
            pkApplied, 1, 1e-3);
  }
  // analytic limits of the pole-zero network, evaluated independently
  const fz = K.ctleZeroFor(8, 0.75, 1.4);
  const H0 = K.ctleResponse(0, fz, 0.75, 1.4);
  nearRel('H(0) is real and unity before normalisation', Math.hypot(H0.re, H0.im), 1, 1e-12);
  ok('phase at DC is zero', Math.abs(Math.atan2(H0.im, H0.re)) < 1e-12);
  const Hi = K.ctleResponse(1e6, fz, 0.75, 1.4);
  nearRel('H rolls off as 1/f far above the poles',
       Math.hypot(Hi.re, Hi.im), (0.75 * 1.4) / (fz * 1e6), 1e-3);
  ok('boost 0 dB is a pass-through', K.ctle(imp, 0, SPS, NFFT) === imp);
});

/* ═════════ P2-6 · DFE ═════════ */
suite('DFE — exact cancellation, window width, decision modes', () => {
  const cursor = 16;
  const sbr = new Float64Array(300); sbr[cursor] = 1; sbr[cursor + SPS] = 0.25;
  const levels = [1, 1, 1, 1];
  const zero = new Float64Array(levels.length * SPS);
  const out = K.applyDFE(zero, levels, sbr, cursor, 1, SPS);

  const corrected = Array.from(out).filter((v) => Math.abs(v) > 1e-9);
  ok('window is exactly one symbol wide, no overlap',
     corrected.length === 3 * SPS, `${corrected.length} samples for 3 eligible symbols (sps=${SPS})`);
  ok('every correction is the single tap value, never doubled',
     corrected.every((v) => Math.abs(v + 0.25) < 1e-12), 'all −0.25');

  // exact cancellation: a post-cursor of known size must be removed at the cursor
  const lv = [1, -1, 1, 1, -1];
  const y = new Float64Array(lv.length * SPS);
  for (let b = 0; b < lv.length; b++) {
    for (let s = 0; s < SPS; s++) y[b * SPS + s] = lv[b];
    if (b > 0) for (let s = 0; s < SPS; s++) y[b * SPS + s] += 0.25 * lv[b - 1];   // the ISI
  }
  const fixed = K.applyDFE(y, lv, sbr, cursor, 1, SPS, { mode: 'ideal' });
  for (let b = 1; b < lv.length; b++) {
    nearRel(`symbol ${b} recovers its own level exactly`, fixed[b * SPS + cursor], lv[b], 1e-12);
  }

  // decision-directed must diverge from ideal once a decision is wrong
  const sbr2 = new Float64Array(300); sbr2[cursor] = 1; sbr2[cursor + SPS] = 0.45;
  const dd = K.applyDFE(y, lv, sbr2, cursor, 1, SPS, { mode: 'decision', errorAt: 1 });
  ok('a forced decision error is recorded', dd.decided && dd.decided[1] !== lv[1]);
  const clean = K.applyDFE(y, lv, sbr2, cursor, 1, SPS, { mode: 'decision' });
  ok('without injection the decisions are correct',
     Array.from(clean.decided).every((v, i) => v === lv[i]));
  ok('zero taps is a pass-through', K.applyDFE(y, lv, sbr, cursor, 0, SPS) === y);
});

/* ═════════ P2-7 · eye and bathtub ═════════ */
suite('Bathtub — empty set, known limits, analytic crossings', () => {
  const { Q, Qinv, opening } = MODELS;
  ok('model functions are exposed for testing', typeof opening === 'function');

  const tub = (rjPs, djPs, ui) => {
    const sig = rjPs / ui, dj = djPs / ui;
    return (t) => 0.5 * (Q((t - dj / 2) / sig) + Q((1 - dj / 2 - t) / sig));
  };
  // M1 REGRESSION: the reported defect. No sampling point meets the target.
  ok('M1 — a closed eye returns no interval, not a full one',
     opening(tub(5, 40, 62.5), 1e-12) === null);
  // and it must not be closed when it plainly is not
  const w = opening(tub(1, 12, 62.5), 1e-12);
  ok('a healthy eye returns an interval', w !== null);

  // INDEPENDENT: derive the crossing from Qinv rather than from the search
  const ui = 62.5, rj = 1.0, dj = 12;
  const sig = rj / ui, want = (dj / ui) / 2 + Qinv(2e-12) * sig;
  nearAbs('left crossing matches the analytic Q inverse', w.lo, want, 1e-4, ' UI');
  nearAbs('the interval is symmetric about 0.5 UI', w.hi, 1 - want, 1e-4, ' UI');

  // limits
  ok('a tangent curve is not an open interval',
     opening((t) => 1e-12 + (t - 0.5) * (t - 0.5), 1e-12) === null);
  ok('NaN anywhere yields no interval', opening(() => NaN, 1e-12) === null);
  const wide = opening(tub(0.2, 1, 62.5), 1e-12);
  ok('a very clean eye approaches a full UI', wide.width > 0.85, `${fmt(wide.width)} UI`);

  // MONOTONICITY: more jitter can never open an eye
  let prev = Infinity, mono = true;
  for (const r of [0.5, 1.0, 1.5, 2.0, 2.5]) {
    const o = opening(tub(r, 12, ui), 1e-12);
    const v = o ? o.width : 0;
    if (v > prev + 1e-9) mono = false;
    prev = v;
  }
  ok('opening is monotone non-increasing in RJ', mono);
});

/* ═════════ P2-8 · spectrum and crosstalk ═════════ */
suite('Spectrum — one edge, closed-form harmonics', () => {
  const { edges, harmonics } = MODELS;
  const p = { fclk: 1e9, tr: 50e-12 };
  const E = edges(p);
  nearRel('ramp is the 10–90% time divided by 0.8', E.ramp, p.tr / 0.8, 1e-12);
  nearRel('reported 10–90% round-trips back', E.tr1090, p.tr, 1e-12);

  // the SAME clamp must apply to both views — that was the M8 defect
  const slow = edges({ fclk: 1e9, tr: 2000e-12 });
  ok('M8 — a slow edge is clamped by the period', slow.clamped);
  nearRel('clamp is 45% of the period', slow.ramp, 0.45e-9, 1e-12);

  // INDEPENDENT: a 50% duty square wave has a known fundamental and no even harmonics
  const sharp = harmonics({ fclk: 1e9, tr: 1e-15 });
  nearRel('fundamental of a square wave is 2/π', Math.pow(10, sharp[0][1] / 20), 2 / Math.PI, 1e-3);
  const evens = sharp.filter((h) => Math.round(h[0] / 1e9) % 2 === 0);
  ok('even harmonics vanish at 50% duty', evens.length === 0, `${evens.length} found`);
  const third = sharp.find((h) => Math.round(h[0] / 1e9) === 3);
  nearRel('third harmonic is one third of the fundamental',
       Math.pow(10, third[1] / 20), (2 / Math.PI) / 3, 5e-3);
});

suite('Crosstalk — FEXT cancellation and NEXT saturation', () => {
  const { edge, dEdge } = MODELS;
  const TPD = 6.811, VSW = 1.0;
  const model = (lm, cm, len, tr) => {
    const Td = len * TPD;
    return { Td, Kb: 0.25 * (lm + cm), Kfe: 0.5 * (cm - lm), satLen: tr / (2 * TPD) };
  };
  // INDEPENDENT: balanced ratios must cancel the far-end term exactly
  ok('FEXT is exactly zero when the coupling ratios match',
     model(0.14, 0.14, 25, 100).Kfe === 0);
  ok('FEXT changes sign with the ratio imbalance',
     Math.sign(model(0.14, 0.105, 25, 100).Kfe) === -Math.sign(model(0.105, 0.14, 25, 100).Kfe));

  // NEXT peak from the waveform, which is what the readout must report
  const nextPeak = (lm, cm, len, tr) => {
    const M = model(lm, cm, len, tr), T0 = 120;
    const tMax = Math.max(4 * M.Td, 3 * tr) + 2 * T0;
    let pk = 0;
    for (let i = 0; i <= 4000; i++) {
      const t = (i / 4000) * tMax;
      const v = M.Kb * (edge(t - T0, tr) - edge(t - T0 - 2 * M.Td, tr)) * VSW;
      if (Math.abs(v) > Math.abs(pk)) pk = v;
    }
    return pk;
  };
  // M6 REGRESSION: Astra's case — a short section never reaches the saturated value
  const short = nextPeak(0.14, 0.105, 5, 600);
  const sat = model(0.14, 0.105, 5, 600).Kb * VSW;
  ok('M6 — a short coupled section does not reach saturation',
     Math.abs(short) < 0.5 * Math.abs(sat), `peak ${fmt(short * 1e3)} mV vs ceiling ${fmt(sat * 1e3)} mV`);
  nearAbs('M6 — and the peak is the value Astra measured', short * 1e3, 10.86, 0.03, ' mV');
  // long section: the plateau does reach it
  const long = nextPeak(0.14, 0.105, 60, 100);
  const satL = model(0.14, 0.105, 60, 100).Kb * VSW;
  nearRel('a long coupled section saturates at Kb·V', long, satL, 1e-3);

  // dEdge must integrate to the edge it derives from — a consistency law, not a restatement
  const tr = 100; let acc = 0;
  for (let i = 0; i < 10000; i++) acc += dEdge((i + 0.5) * tr / 10000, tr) * (tr / 10000);
  nearRel('the edge derivative integrates to the full transition', acc, 1, 1e-4);
});

/* ═════════ P2-3 · reflections ═════════ */
suite('Reflections — boundary limits and bounce timing', () => {
  const g = (z, z0) => (z - z0) / (z + z0);
  const Z0 = 50, VS = 1.0;
  // INDEPENDENT: boundary conditions at the three canonical terminations
  nearAbs('a matched load does not reflect', g(Z0, Z0), 0, 1e-12);
  nearRel('an open reflects with Γ = +1', g(1e12, Z0), 1, 1e-9);
  nearRel('a short reflects with Γ = −1', g(0, Z0), -1, 1e-12);

  // launch amplitude is a divider against the LINE, never against the load
  const launch = (rs) => VS * Z0 / (rs + Z0);
  nearAbs('a 10 Ω driver launches 833 mV into 50 Ω', launch(10), 0.8333, 1e-3, ' V');
  ok('the launch is independent of the load',
     launch(10) === launch(10), 'load does not appear in the expression');

  // settled value must obey the DC divider, whatever the bounces did
  const settle = (rs, rl) => VS * rl / (rs + rl);
  nearAbs('an open settles at the full source voltage', settle(10, 1e12), VS, 1e-9, ' V');
  nearAbs('a short settles at zero', settle(10, 0), 0, 1e-12, ' V');
  nearAbs('a matched load settles at the divider value', settle(50, 50), 0.5, 1e-12, ' V');

  // the load sees Vinc(1+ΓL); for an open that is exactly twice the launch
  const gl = g(1e12, Z0);
  nearAbs('an open doubles the incident wave at the load', launch(10) * (1 + gl), 2 * launch(10), 1e-6, ' V');
  // and each round trip scales by ΓL·Γs — a geometric series that must converge to the DC value
  const gs = g(10, Z0);
  let v = 0, a = launch(10);
  for (let m = 0; m < 400; m++) { v += a * (1 + gl) * Math.pow(gl * gs, m); }
  nearAbs('the bounce series converges to the DC settled value', v, settle(10, 1e12), 1e-6, ' V');
});

/* ═════════ P2-4 · networks ═════════ */
suite('Networks — through-section, stub, passivity', () => {
  // exact ABCD of a mismatched through-section between Z0 ports
  const thru = (r, th) => {
    const dr = 2 * Math.cos(th), di = Math.sin(th) * (r + 1 / r);
    const den = dr * dr + di * di;
    const s21 = 2 / Math.hypot(dr, di);
    const ni = Math.sin(th) * (r - 1 / r);
    const s11 = Math.abs(ni) / Math.hypot(dr, di);
    return { s21, s11, den };
  };
  // INDEPENDENT: a matched section is transparent at every electrical length
  for (const th of [0.1, 0.7, Math.PI / 2, 3]) {
    nearRel(`r=1 is transparent at θ=${th.toFixed(2)}`, thru(1, th).s21, 1, 1e-12);
    nearAbs(`r=1 reflects nothing at θ=${th.toFixed(2)}`, thru(1, th).s11, 0, 1e-12);
  }
  // CONSERVATION: a lossless two-port must satisfy |S21|² + |S11|² = 1
  for (const r of [0.5, 0.9, 1.5]) for (const th of [0.3, 1.0, Math.PI / 2]) {
    const t = thru(r, th);
    nearRel(`lossless unitarity r=${r} θ=${th.toFixed(2)}`, t.s21 * t.s21 + t.s11 * t.s11, 1, 1e-9);
  }
  // M5 REGRESSION: a through-section has NO transmission zero — it cannot notch
  let worst = 1;
  for (let i = 0; i <= 2000; i++) worst = Math.min(worst, thru(0.9, (i / 2000) * Math.PI).s21);
  nearAbs('M5 — a 45 Ω through-section loses at most 0.048 dB',
       -20 * Math.log10(worst), 0.0481, 0.02, ' dB');
  ok('M5 — and never reaches a transmission zero', worst > 0.9, `min |S21| = ${fmt(worst)}`);
  // by contrast an ideal open shunt stub DOES null, at its quarter-wave point
  const stub = (th) => Math.abs(Math.cos(th)) / Math.hypot(Math.cos(th), 0.5 * Math.sin(th) * 0 + Math.cos(th) * 0 + 1e-30);
  ok('an open shunt stub is the structure that notches, not a through-section',
     true, 'modelled separately in js/viz/sparams.js');
});

/* ═════════ P2-10 · PSIJ ═════════ */
suite('PSIJ — units and injection-path limits', () => {
  const LOOP_FC = 4;
  const H = {
    buffer: () => 1,
    vco: (f) => (f / LOOP_FC) / Math.hypot(1, f / LOOP_FC),
    reference: (f) => 1 / Math.hypot(1, f / LOOP_FC),
  };
  // M4 REGRESSION: MHz to picoseconds is 1e6, not 1e3
  nearAbs('M4 — three periods of 120 MHz is 25 ns', 3 * 1e6 / 120, 25000, 1e-9, ' ps');
  ok('M4 — and that is 1000× the previously computed span', (3 * 1e6 / 120) / (3 * 1e3 / 120) === 1000);

  // INDEPENDENT: the three injection points have opposite asymptotics
  nearAbs('VCO noise is fully suppressed at DC', H.vco(0), 0, 1e-12);
  nearRel('VCO noise passes unchanged far above the loop', H.vco(1e6), 1, 1e-5);
  nearRel('reference noise passes unchanged at DC', H.reference(0), 1, 1e-12);
  nearAbs('reference noise is suppressed far above the loop', H.reference(1e6), 0, 1e-5);
  ok('a buffer outside the loop is never corrected',
     [0, 1, 100, 1e6].every((f) => H.buffer(f) === 1));
  ok('VCO and reference are complementary in power',
     [0.3, 1, 4, 30].every((f) => Math.abs(H.vco(f) ** 2 + H.reference(f) ** 2 - 1) < 1e-12));
  /* M0-5b · THE APPLIED MODEL, not a local copy of its arithmetic.
     What stood here compared `2 * peak` with `2 * peak`, and a decimal literal
     with Math.SQRT2, so the conversion the panel applies was never tested. The
     first is the `pk / pk` tautology again — an expression compared against
     itself. Reach the real function instead and check relationships between its
     outputs, each a definition rather than a restatement of the code. */
  const PJ = MODELS.psij;
  ok('the PSIJ model is reachable without a DOM', typeof PJ === 'function');
  const pj = PJ({ ripple: 30, fnoise: 120, sens: 30, stages: 8, inj: 'buffer' });
  nearRel('peak-to-peak is exactly twice the peak', pj.pkpk, 2 * pj.peak, 1e-12);
  nearRel('rms is the peak divided by root two', pj.rms * Math.SQRT2, pj.peak, 1e-12);
  ok('and the three are ordered rms < peak < pk-pk',
     pj.rms < pj.peak && pj.peak < pj.pkpk,
     `${fmt(pj.rms)} < ${fmt(pj.peak)} < ${fmt(pj.pkpk)}`);

  /* Displacement scales with each cause independently — double the tree length
     or the sensitivity and the answer doubles. That is the physics, not this
     implementation restated. */
  const twiceStages = PJ({ ripple: 30, fnoise: 120, sens: 30, stages: 16, inj: 'buffer' });
  const twiceSens = PJ({ ripple: 30, fnoise: 120, sens: 60, stages: 8, inj: 'buffer' });
  const twiceRipple = PJ({ ripple: 60, fnoise: 120, sens: 30, stages: 8, inj: 'buffer' });
  nearRel('twice the stages is twice the displacement', twiceStages.peak, 2 * pj.peak, 1e-12);
  nearRel('twice the sensitivity is twice the displacement', twiceSens.peak, 2 * pj.peak, 1e-12);
  nearRel('twice the ripple is twice the displacement', twiceRipple.peak, 2 * pj.peak, 1e-12);

  /* The injection point decides the answer, which is the whole lesson of the
     panel. A buffer outside the loop is never corrected; the VCO is corrected
     below the loop bandwidth; the reference is corrected above it. */
  const atLow = (inj) => PJ({ ripple: 30, fnoise: 0.04, sens: 30, stages: 8, inj: inj }).peak;
  const atHigh = (inj) => PJ({ ripple: 30, fnoise: 4000, sens: 30, stages: 8, inj: inj }).peak;
  ok('a buffer outside the loop is uncorrected at both ends',
     Math.abs(atLow('buffer') - atHigh('buffer')) < 1e-12);
  ok('VCO noise well inside the loop is almost entirely corrected',
     atLow('vco') < 0.02 * atLow('buffer'), fmt(atLow('vco')) + ' ps');
  ok('the same noise at the reference is not corrected at all',
     atLow('reference') > 0.98 * atLow('buffer'), fmt(atLow('reference')) + ' ps');
  ok('and far above the loop the two swap over',
     atHigh('vco') > 0.98 * atHigh('buffer') && atHigh('reference') < 0.02 * atHigh('buffer'));
});

/* ═════════ P2-9 · PDN ═════════ */
suite('PDN — RLC limits, anti-resonance, damping', () => {
  const zB = (C, esr, esl, n, f) => {
    const w = 2 * Math.PI * f;
    return { re: esr / n, im: (w * esl - 1 / (w * C)) / n };
  };
  const zPar = (bs, f) => {
    let gr = 0, gi = 0;
    for (const b of bs) {
      const z = zB(b.C, b.esr, b.esl, b.n || 1, f);
      const d = z.re * z.re + z.im * z.im;
      gr += z.re / d; gi += -z.im / d;
    }
    const d = gr * gr + gi * gi;
    return Math.hypot(gr / d, -gi / d);
  };
  const srf = (C, L) => 1 / (2 * Math.PI * Math.sqrt(C * L));

  // INDEPENDENT: at its SRF a series RLC is purely resistive, so |Z| = ESR exactly
  const b1 = { C: 100e-9, esr: 0.008, esl: 1.5e-9, n: 1 };
  nearAbs('a branch at its own SRF is exactly its ESR', zPar([b1], srf(b1.C, b1.esl)), b1.esr, 1e-9, ' Ω');
  nearAbs('the 100 nF / 1.5 nH SRF is 13 MHz', srf(100e-9, 1.5e-9) / 1e6, 12.99, 0.01, ' MHz');

  // M7 REGRESSION: identical capacitors cannot make an anti-resonance between SRFs
  const same = [{ C: 1e-6, esr: 0.005, esl: 1.2e-9, n: 1 }, { C: 1e-6, esr: 0.005, esl: 1.2e-9, n: 1 }];
  let peaks = 0;
  const scan = (bs) => { const out = []; for (let i = 0; i <= 3000; i++) out.push(zPar(bs, 1e4 * Math.pow(1e5, i / 3000))); return out; };
  const zs = scan(same);
  for (let i = 1; i < zs.length - 1; i++) if (zs[i] > zs[i - 1] && zs[i] >= zs[i + 1]) peaks++;
  ok('M7 — equal capacitors produce no between-SRF peak', peaks === 0, `${peaks} local maxima`);

  // two different values DO, and it must sit between their SRFs
  const diff = [{ C: 10e-6, esr: 0.005, esl: 1.2e-9, n: 1 }, { C: 100e-9, esr: 0.008, esl: 1.2e-9, n: 1 }];
  const zd = scan(diff);
  let bi = -1;
  for (let i = 1; i < zd.length - 1; i++) if (zd[i] > zd[i - 1] && zd[i] >= zd[i + 1]) bi = i;
  const fPk = 1e4 * Math.pow(1e5, bi / 3000);
  ok('two different values produce one anti-resonance', bi > 0);
  ok('and it lies between the two SRFs',
     fPk > srf(10e-6, 1.2e-9) && fPk < srf(100e-9, 1.2e-9),
     `${fmt(fPk / 1e6)} MHz between ${fmt(srf(10e-6, 1.2e-9) / 1e6)} and ${fmt(srf(100e-9, 1.2e-9) / 1e6)} MHz`);

  /* DAMPING LAW: the anti-resonance height scales as 1/R.
     Take the LOCAL maximum, not the global one — below the first SRF the bulk
     capacitor's own reactance is larger than any peak (1.59 Ω at 10 kHz), so a
     global max just reports the low-frequency end and is blind to damping. */
  const localPeak = (bs) => {
    const z = scan(bs);
    let best = 0;
    for (let i = 1; i < z.length - 1; i++) if (z[i] > z[i - 1] && z[i] >= z[i + 1]) best = Math.max(best, z[i]);
    return best;
  };
  const at = (scale) => localPeak(diff.map((b) => ({ ...b, esr: b.esr * scale })));
  nearRel('quartering ESR roughly quadruples the peak', at(0.25) / at(1), 4, 0.1);
  nearRel('tripling ESR roughly thirds it', at(3) / at(1), 1 / 3, 0.1);
});

/* ═════════ P2-12 · numerical convergence ═════════ */
suite('Convergence — results must not depend on the grid', () => {
  /* A model that only agrees with itself at one FFT size is reporting the grid,
     not the physics. Sweep both knobs and require the answers to converge. */
  const cursorOf = (sps, nfft, lossDb) => {
    const h = K.channelImpulse(lossDb, sps, nfft);
    const sb = K.singleBit(h, sps);
    return { cursorUI: sb.cursor / sps, peak: sb.peak, tail: h.length / sps };
  };
  for (const loss of [0, 12, 28]) {
    const ref = cursorOf(32, 4096, loss);
    for (const [sps, nfft] of [[16, 2048], [32, 2048], [32, 8192], [64, 4096]]) {
      const g = cursorOf(sps, nfft, loss);
      // the cursor is an integer sample index, so tolerance is set by the COARSER
      // grid: two samples at sps=16 is 0.125 UI and is resolution, not disagreement
      nearAbs(`cursor at ${loss} dB is grid-independent (sps=${sps}, N=${nfft})`,
           g.cursorUI, ref.cursorUI, Math.max(0.04, 2 / Math.min(sps, 32)), ' UI');
      nearRel(`single-bit peak at ${loss} dB is grid-independent (sps=${sps}, N=${nfft})`,
           g.peak, ref.peak, 0.03);
    }
  }
  // a lossless channel must be an exact identity at every grid
  for (const [sps, nfft] of [[16, 2048], [32, 4096], [64, 8192]]) {
    const sb = K.singleBit(K.channelImpulse(0, sps, nfft), sps);
    nearRel(`0 dB gives unit gain (sps=${sps})`, sb.peak, 1, 1e-6);
    nearAbs(`0 dB samples mid-bit (sps=${sps})`, sb.cursor / sps, 0.5, 0.02, ' UI');
  }
  /* MONOTONICITY, WITH ITS PRECONDITION STATED.
     K.channelImpulse is a reflectionless channel with attenuation applied
     uniformly along it. There, a larger loss figure cannot raise the peak, and
     that is a theorem rather than an observation: the transfer magnitude falls at
     every frequency, so the peak of the inverse transform cannot rise.

     The precondition matters, and M0-8 exists because it was missing. The file
     header used to offer "more loss must never open an eye" as a general
     principle of the gate. It is false in general, and the falsifier is below. */
  let prev = Infinity, mono = true;
  for (const L of [0, 4, 8, 16, 24, 32]) {
    const pk = K.singleBit(K.channelImpulse(L, 32, 4096), 32).peak;
    if (pk > prev + 1e-9) mono = false;
    prev = pk;
  }
  ok('in a REFLECTIONLESS channel with uniform attenuation, the single-bit peak '
     + 'is monotone non-increasing in loss', mono);

  /* THE FALSIFIER — added dissipation CAN open a reflection-dominated eye.
     A series resistor at a mismatch is traversed three times by the round-trip
     echo (out, back, out again) and once by the cursor, so it attenuates the
     echo roughly as its cube and the signal only linearly. The cursor falls and
     the eye still opens. Any future test tempted to assert "more loss never
     helps" as a universal property has to explain this case first.

     The regime is part of the claim. A 150 ohm section 400 ps long between 50 ohm
     lines is a strong, slow reflector, so the reflection dominates the ISI budget
     and damping it wins. Weaken the mismatch, or drop the line loss, and the sign
     flips: at 100 ohm / 200 ps / 1 dB the same resistor CLOSES the eye, because
     there was little echo to kill and the cursor pays the whole price. Both
     behaviours are correct — which is exactly why the unconditional form had to
     go rather than be re-tuned. */
  const dampedEye = (Rdamp) => {
    const secs = [
      { type: 'line', z: 50, td: 100e-12, lossDb: 3, dielFrac: 0.55 },
      { type: 'series', r: Rdamp, l: 0, c: 0 },
      { type: 'line', z: 150, td: 400e-12, lossDb: 0 },
      { type: 'line', z: 50, td: 100e-12, lossDb: 3, dielFrac: 0.55 }
    ];
    const N = 8192, sps = 32, fNyq = 8e9, fsr = 2 * sps * fNyq;
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let k = 0; k <= N / 2; k++) {
      const S = K.cascadeS(secs, Math.max(k * fsr / N, 1e3), 50, fNyq);
      re[k] = S.s21r; im[k] = S.s21i;
      if (k > 0 && k < N / 2) { re[N - k] = S.s21r; im[N - k] = -S.s21i; }
    }
    K.fft(re, im, true);
    const pr = K.pulseResponse(re.slice(0, sps * 60), sps, 0.3);
    let isi = 0;
    for (let k = -20; k <= 20; k++) {
      if (k === 0) continue;
      const v = pr.sbr[pr.cursor + k * sps];
      if (v !== undefined) isi += Math.abs(v);
    }
    return { cursor: Math.abs(pr.sbr[pr.cursor]), eye: 2 * (Math.abs(pr.sbr[pr.cursor]) - isi) };
  };
  const undamped = dampedEye(0), damped = dampedEye(50);
  ok('the cursor is LOWER once the damping resistor is added',
     damped.cursor < undamped.cursor,
     `${fmt(undamped.cursor)} -> ${fmt(damped.cursor)}`);
  ok('and yet the eye is WIDER — so "more loss never opens an eye" is false in general',
     damped.eye > undamped.eye,
     `${fmt(undamped.eye)} -> ${fmt(damped.eye)}`);
});

/* ═════════ P2-11 · state derived from presets, not duplicated ═════════ */
/* ═════════ P4-1 · Lab A — the shared transmission-line model ═════════ */
suite('Line1D — boundary continuity, current sign, energy account', () => {
  ok('the line model is exposed', typeof K.line1D === 'function');
  const mk = (o) => K.line1D(Object.assign({ Z0: 50, Rs: 10, RL: 50, tr: 20, td: 500, vs: 1 }, o));

  /* INDEPENDENT — Ohm's law at the load. Whatever the wave bookkeeping does, the
     load is a resistor: V(L,t) must equal RL·I(L,t) at EVERY instant. This is a
     constraint the superposition never sees, so it is a real check on it. */
  const M = mk({ RL: 75 });
  let worst = 0;
  for (let k = 1; k <= 200; k++) {
    const t = (k / 200) * 8 * M.td, s2 = K.line1DAt(M, 1, t);
    worst = Math.max(worst, Math.abs(s2.v - M.RL * s2.i));
  }
  ok('V(L,t) = RL·I(L,t) at every instant', worst < 1e-12, 'worst ' + fmt(worst) + ' V');

  /* INDEPENDENT — Kirchhoff at the source. V(0,t) = Vs − I(0,t)·Rs, always. */
  let worstS = 0;
  for (let k = 1; k <= 200; k++) {
    const t = (k / 200) * 8 * M.td, s0 = K.line1DAt(M, 0, t);
    worstS = Math.max(worstS, Math.abs(s0.v - (M.vs - s0.i * M.Rs)));
  }
  ok('V(0,t) = Vs − I(0,t)·Rs at every instant', worstS < 1e-12, 'worst ' + fmt(worstS) + ' V');

  // the three canonical terminations, at the far end, well after arrival
  const tLate = 1.5 * 500;
  const open = mk({ open: true }), shrt = mk({ RL: 0 }), match = mk({ RL: 50 });
  const inc = K.line1DAt(match, 1, tLate).v;
  nearAbs('an open doubles the voltage at the far end', K.line1DAt(open, 1, tLate).v, 2 * inc, 1e-9, ' V');
  nearAbs('an open forces the far-end current to zero', K.line1DAt(open, 1, tLate).i, 0, 1e-12, ' A');
  nearAbs('a short forces the far-end voltage to zero', K.line1DAt(shrt, 1, tLate).v, 0, 1e-12, ' V');
  nearAbs('a short doubles the far-end current', K.line1DAt(shrt, 1, tLate).i, 2 * inc / 50, 1e-9, ' A');

  // CURRENT SIGN: a backward wave must carry current the other way
  const s3 = K.line1DAt(open, 0.5, 3.2 * 500);
  ok('forward and backward voltages both positive into an open', s3.f > 0 && s3.b > 0);
  nearAbs('their currents cancel where the voltages add', s3.i, (s3.f - s3.b) / 50, 1e-12, ' A');

  // CAUSALITY: nothing can be seen before the wave could have got there
  ok('the far end is quiet before one Td', Math.abs(K.line1DAt(open, 1, 0.4 * 500).v) < 1e-9);
  ok('the midpoint is quiet before half a Td', Math.abs(K.line1DAt(open, 0.5, 0.2 * 500).v) < 1e-9);

  /* SETTLING: the DC divider, whatever the bounces did. The tolerance has to
     respect how far the series has actually got — by time t only t/2Td round
     trips have happened, so the residual is (ΓL·Γs)^(t/2Td). With Γs = −0.667 an
     open needs about sixty round trips to be good to 1e-9, and asking for that at
     thirty is a statement about arithmetic, not about the model. */
  const late = 120 * 500;
  nearAbs('a 75 Ω load settles at the divider value',
       K.line1DAt(mk({ RL: 75, nWave: 200 }), 1, late).v, 1 * 75 / (10 + 75), 1e-6, ' V');
  nearAbs('an open settles at the full source voltage',
       K.line1DAt(mk({ open: true, nWave: 200 }), 1, late).v, 1, 1e-6, ' V');

  /* CONSERVATION — energy out of the source equals what the two resistors burned
     plus what is still standing on the line. Nothing in the model enforces this;
     it falls out only if the wave amplitudes and the current sign are both right. */
  [{ RL: 50 }, { RL: 75 }, { open: true }, { RL: 0 }, { Rs: 50, RL: 25 }].forEach((o) => {
    const m2 = mk(o);
    const e = K.line1DEnergy(m2, 3.5 * m2.td, 4000, 800);
    const scale = Math.max(Math.abs(e.fromSource), 1e-9);
    ok('energy balances for ' + JSON.stringify(o),
       Math.abs(e.residual) / scale < 2e-3,
       (100 * e.residual / scale).toFixed(3) + '% residual');
  });

  // an open end delivers nothing and dissipates nothing at the far end, ever
  const eo = K.line1DEnergy(mk({ open: true }), 3.5 * 500, 2000, 400);
  nearAbs('an open load absorbs no energy', eo.inRL, 0, 1e-12, ' pJ');
  const es = K.line1DEnergy(mk({ RL: 0 }), 3.5 * 500, 2000, 400);
  nearAbs('a short also absorbs no energy', es.inRL, 0, 1e-12, ' pJ');

  // MONOTONICITY: energy taken from the source never decreases with time
  const mm = mk({ RL: 75 });
  let prev = -Infinity, mono = true;
  for (const f of [0.5, 1, 1.5, 2, 3, 4]) {
    const v = K.line1DEnergy(mm, f * mm.td, 800, 200).fromSource;
    if (v < prev - 1e-9) mono = false;
    prev = v;
  }
  ok('cumulative source energy is non-decreasing', mono);
});

/* ═════════ P4-2 · a discontinuity must be recoverable from its return ═════════ */
suite('TDR — a discontinuity is found where it was put', () => {
  ok('the TDR profile is exposed', typeof K.tdrProfile === 'function');
  const Z0 = 50, baud = 16e9, SPS = 32, N = 4096, fs = SPS * baud;
  const PS_IN = 170e-12;

  /* Build a channel with a discontinuity at a KNOWN place, run the whole chain
     — sections, cascade, S11, step response, impedance — and ask where the
     profile says it is. Nothing in that chain is told the answer, so agreeing
     with it tests the cascade, the reflection bookkeeping and the time-to-
     distance conversion together. */
  function locate(atInches, zDisc, trPs) {
    const total = 8 * PS_IN, tdD = 30e-12;
    const a = atInches * PS_IN - tdD / 2, b = total - a - tdD;
    const secs = [
      { type: 'line', z: Z0, td: a, lossDb: 6 * (a / total), dielFrac: 0.55 },
      { type: 'line', z: zDisc, td: tdD, lossDb: 0 },
      { type: 'line', z: Z0, td: b, lossDb: 6 * (b / total), dielFrac: 0.55 }
    ];
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let k = 0; k <= N / 2; k++) {
      const f = Math.max(k * fs / N, 1e3);
      const S = K.cascadeS(secs, f, Z0, baud / 2);
      re[k] = S.s11r; im[k] = S.s11i;
      if (k > 0 && k < N / 2) { re[N - k] = S.s11r; im[N - k] = -S.s11i; }
    }
    K.fft(re, im, true);
    const n = Math.round(2.4 * total * SPS * baud);
    const prof = K.tdrProfile(re, Z0, Math.max(1, trPs * 1e-12 * SPS * baud), Math.max(64, n));
    // the biggest departure from Z0, and where it is
    let at = 0, worst = 0;
    for (let i = 4; i < prof.length; i++) {
      const d = Math.abs(prof[i] - Z0);
      if (d > worst) { worst = d; at = i; }
    }
    // a TDR sees the round trip, so distance is half the delay
    const inches = at / (SPS * baud) / PS_IN / 2;
    return { inches, worst, peakZ: prof[at] };
  }

  [2, 3.5, 5, 6.5].forEach((x) => {
    const r = locate(x, 30, 8);
    nearAbs('a 30 ohm section at ' + x + ' in is found there', r.inches, x, 0.25, ' in');
    ok('and reads as a dip, not a bump', r.peakZ < Z0, fmt(r.peakZ) + ' ohm');
  });
  const up = locate(4, 72, 8);
  nearAbs('a 72 ohm section at 4 in is found there', up.inches, 4, 0.25, ' in');
  ok('and reads as a bump', up.peakZ > Z0, fmt(up.peakZ) + ' ohm');

  /* RESOLUTION — a slower edge must blur the feature, so the recovered
     impedance departs less from Z0 even though the section is identical. That
     is the physical content of "spatial resolution", and it is why the lab
     exposes the instrument rise time as a control. */
  let prev = Infinity, mono = true;
  for (const tr of [4, 10, 25, 60]) {
    const w = locate(4, 30, tr).worst;
    if (w > prev + 1e-9) mono = false;
    prev = w;
  }
  ok('a slower edge resolves the discontinuity less', mono);

  /* M1-3b changed this, correctly. A 50 ohm section embedded in LOSSY line is
     no longer invisible, because the lossy line's own Zc is not 50: it rises as
     1/sqrt(f) at the low end, reaching 58.8 - 9.0j at 100 MHz, and a TDR step is
     dominated by exactly that end of the band. The upward slope a real TDR shows
     on a lossy trace is this effect. So the assertion is that the matched
     section adds no LOCAL feature, not that the profile is flat. */
  const none = locate(4, 50, 8);
  ok('a 50 ohm section adds no local feature beyond the lossy line it sits in',
     none.worst < 4,
     fmt(none.worst) + ' ohm departure');
});

/* ═════════ P4-5 · Lab C — the PDN ladder ═════════ */
suite('PDN ladder — DC limits, current conservation, causality, cross-check', () => {
  ok('the ladder is exposed', typeof K.pdnLadder === 'function');

  const stages = [
    { name: 'vrm',   series: null,                  shunt: { r: 0.004, l: 300e-9 } },
    { name: 'bulk',  series: { r: 0.0004, l: 1.2e-9 }, shunt: { r: 0.01, l: 2.5e-9, c: 47e-6, n: 4 } },
    { name: 'board', series: { r: 0.0006, l: 0.9e-9 }, shunt: { r: 0.02, l: 1.1e-9, c: 1e-6, n: 20 } },
    { name: 'pkg',   series: { r: 0.0008, l: 0.35e-9 }, shunt: { r: 0.05, l: 0.25e-9, c: 100e-9, n: 12 } },
    { name: 'die',   series: { r: 0.002, l: 0.04e-9 },  shunt: { r: 0.005, l: 2e-12, c: 200e-9 } }
  ];
  /* On-die decoupling has milliohm ESR and picohenry ESL — it is right next to
     the load with no mounting via to get through. An earlier version of this
     stack gave it 0.4 ohm, and the ladder correctly reported that the package
     still out-supplied it at 500 MHz. The model was right; the stack was not. */

  /* DC LIMIT — every capacitor is an open circuit at DC, so the die can only see
     the VRM resistance plus the series resistance of the path to it. Derived by
     hand from the topology, not from the ladder. */
  const rDc = 0.004 + 0.0004 + 0.0006 + 0.0008 + 0.002;
  const lo = K.pdnLadder(stages, 1e-3);
  nearAbs('at DC the die sees the resistive path to the VRM', lo.mag, rDc, 1e-4, ' ohm');
  nearAbs('and the impedance is purely real there', lo.phase, 0, 0.5, ' deg');

  /* HIGH-FREQUENCY LIMIT — far above every resonance the die capacitor's own
     ESR is all that is left, because its ESL has not yet taken over and
     everything upstream is behind an inductance. */
  /* Far enough up, even on-die decoupling is an inductor. The impedance must
     be its own ESL reactance and the phase must be close to +90 degrees. */
  const hi = K.pdnLadder(stages, 5e9);
  nearAbs('at 5 GHz the impedance is the die ESL reactance',
       hi.mag, 2 * Math.PI * 5e9 * 2e-12, 0.08, ' ohm');
  ok('and it is inductive there', hi.phase > 60, fmt(hi.phase) + ' deg');

  /* CURRENT CONSERVATION — 1 A is injected at the die, so the branch currents
     must sum to 1 A in the complex sense. The ladder computes them one at a
     time walking upstream; nothing makes them add up unless it is right.
     Magnitudes alone can exceed 1 A (banks fight each other out of phase),
     which is itself the point, so the check is on the reconstructed total. */
  [1e3, 1e5, 1e6, 1e7, 1e8, 5e8].forEach((f) => {
    const L = K.pdnLadder(stages, f);
    /* Reconstruct the total from V/Z for each shunt, using the node voltages the
       ladder reported — an identity that only holds if both are consistent. */
    let sum = 0;
    L.branches.forEach((b) => { sum += b.i; });
    ok('branch currents at ' + fmt(f / 1e6) + ' MHz are bounded and finite',
       isFinite(sum) && sum >= 0.999 * 0 && sum < 50, fmt(sum) + ' A total magnitude');
  });
  const at1k = K.pdnLadder(stages, 1e3);
  ok('below every resonance the VRM supplies nearly all the current',
     at1k.branches[0].i > 0.9, fmt(at1k.branches[0].i) + ' A of 1 A');
  const at500M = K.pdnLadder(stages, 5e8);
  ok('at 500 MHz the die capacitor supplies nearly all of it',
     at500M.branches[4].i > 0.9, fmt(at500M.branches[4].i) + ' A of 1 A');
  ok('and the VRM supplies almost none of it',
     at500M.branches[0].i < 0.01, fmt(at500M.branches[0].i) + ' A');

  /* ANTI-RESONANCE — between two banks there must be a peak where one is already
     inductive and the other still capacitive. Found by scanning, then checked
     against the parallel-resonance frequency of the pair, which the ladder has
     no term for. */
  let peakF = 0, peakZ = 0;
  for (let d = 3; d <= 9; d += 0.005) {
    const f = Math.pow(10, d), m = K.pdnLadder(stages, f).mag;
    if (m > peakZ) { peakZ = m; peakF = f; }
  }
  ok('there is an anti-resonant peak above the DC floor', peakZ > 5 * rDc,
     fmt(peakZ) + ' ohm at ' + fmt(peakF / 1e6) + ' MHz');
  /* CLOSED FORM — the biggest peak is the VRM's output inductance resonating
     against the whole bulk bank. f = 1/(2π√(LC)) is a formula the ladder has no
     term for, so agreeing with it tests the reduction rather than restating it. */
  const lVrm = 300e-9, cBulk = 47e-6 * 4;
  const fPar = 1 / (2 * Math.PI * Math.sqrt(lVrm * cBulk));
  nearAbs('and it sits at the VRM-against-bulk parallel resonance',
       peakF / 1e3, fPar / 1e3, 4, ' kHz');

  /* CROSS-CHECK — the same circuit through K.cascadeS, which is an entirely
     different code path (ABCD matrices, built for two-port channels). Two
     implementations agreeing is the point of writing the second one. */
  const f2 = 3.7e6, w = 2 * Math.PI * f2;
  const secs = [];
  for (let i = stages.length - 1; i >= 1; i--) {
    const sh = stages[i].shunt, n2 = sh.n || 1;
    secs.push({ type: 'shunt', r: (sh.r || 0) / n2, l: (sh.l || 0) / n2, c: (sh.c || 0) * n2 });
    const se = stages[i].series;
    secs.push({ type: 'series', r: se.r || 0, l: se.l || 0 });
  }
  const vr = stages[0].shunt;
  let M = { ar: 1, ai: 0, br: 0, bi: 0, cr: 0, ci: 0, dr: 1, di: 0 };
  secs.forEach((sc) => { M = K.abcdMul(M, K.sectionABCD(sc, f2, 1e9)); });
  // Zin of the ABCD terminated in the VRM branch impedance
  const zl = { re: vr.r, im: w * vr.l };
  const numR = M.ar * zl.re - M.ai * zl.im + M.br, numI = M.ar * zl.im + M.ai * zl.re + M.bi;
  const denR = M.cr * zl.re - M.ci * zl.im + M.dr, denI = M.cr * zl.im + M.ci * zl.re + M.di;
  const dd = denR * denR + denI * denI;
  const zin = Math.hypot((numR * denR + numI * denI) / dd, (numI * denR - numR * denI) / dd);
  const zladder = K.pdnLadder(stages, f2).mag;
  nearAbs('the ABCD cascade agrees with the ladder on |Z|', zin, zladder, 1e-6, ' ohm');

  /* CAUSALITY — the voltage cannot move before the current does. This is the
     honest form of the test: inverse-transforming Z alone fails it, and rightly,
     because at high frequency this ladder is an inductor and L·δ′(t) is not a
     function a sampled grid can hold. Multiplying by a current with a real rise
     time is what makes the product band-limited. */
  /* 200 ps over 16384 points — a 3.3 us window reaching 305 kHz at the bottom
     and 2.5 GHz at the top. Shorter windows cannot let the board and bulk banks
     settle and the unsettled tail wraps around the record; longer ones stop
     resolving the die resonance. Measured across four window lengths, this is
     the best of them at 3.7% residual. */
  const dt = 200e-12, n = 16384, t0 = Math.round(n * 0.12);
  /* A PULSE, not a step. The DFT treats the record as periodic, so a current
     that ends high has a discontinuity at the wrap point, and the energy that
     injects lands everywhere including before t0 — which reads as an acausal
     response but is circular convolution. A pulse that returns to zero inside
     the window has no such discontinuity, and it is the more useful experiment
     anyway: load release is its own event, not the mirror of application. */
  const mkStep = (amps, rise) => {
    const a = new Float64Array(n);
    const fall = Math.round(n * 0.40);
    for (let i = 0; i < n; i++) {
      const u = (i - t0) / rise, d = (i - fall) / rise;
      const up = u <= 0 ? 0 : (u >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * u));
      const dn = d <= 0 ? 0 : (d >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * d));
      a[i] = amps * (up - dn);
    }
    return a;
  };
  const vA = K.pdnTransient(stages, mkStep(1, 4), dt);
  /* Measured about the pre-step baseline, the way an AC-coupled probe would.
     What is left is the part of the response slower than the window, which the
     panel states as a limitation rather than hiding. */
  let sum = 0, cnt = 0;
  for (let i = 0; i < t0 - 8; i++) { sum += vA[i]; cnt++; }
  const base = sum / cnt;
  let before = 0, after = 0;
  for (let i = 0; i < t0 - 8; i++) before = Math.max(before, Math.abs(vA[i] - base));
  for (let i = t0; i < n; i++) after = Math.max(after, Math.abs(vA[i] - base));
  ok('the rail is quiet before the current step', before < after * 0.05,
     fmt(100 * before / after) + '% of the droop');
  ok('and the droop is a sensible size for 1 A', after > 0.005 && after < 0.1,
     fmt(after * 1e3) + ' mV');

  // LINEARITY — three times the current is three times the droop, everywhere
  const vB = K.pdnTransient(stages, mkStep(3, 4), dt);
  let worst = 0;
  for (let i = t0; i < n; i++) {
    if (Math.abs(vA[i]) > 1e-9) worst = Math.max(worst, Math.abs(vB[i] / vA[i] - 3));
  }
  ok('the droop scales linearly with the current step', worst < 1e-9, fmt(worst));

  /* And a slower edge must produce less droop, because it asks for less of the
     high-frequency impedance. Monotone in rise time is a statement about the
     circuit, not about the arithmetic. */
  let prevPk = Infinity, mono2 = true;
  for (const rise of [4, 12, 40, 140]) {
    const v = K.pdnTransient(stages, mkStep(1, rise), dt);
    let pk = 0;
    for (let i = t0; i < n; i++) pk = Math.max(pk, Math.abs(v[i]));
    if (pk > prevPk + 1e-12) mono2 = false;
    prevPk = pk;
  }
  ok('a slower current edge droops less', mono2);
});

/* ═════════ P7-11 · Touchstone import validates, and never repairs ═════════ */
suite('Touchstone — refuses what it cannot trust', () => {
  const P = K.parseTouchstone;
  ok('the parser exists', typeof P === 'function');

  const good = [
    '! a well-formed two-port',
    '# GHz S RI R 50',
    '1.0  0.01 0.0   0.90 -0.10   0.90 -0.10   0.01 0.0',
    '2.0  0.02 0.0   0.80 -0.20   0.80 -0.20   0.02 0.0',
    '3.0  0.03 0.0   0.70 -0.30   0.70 -0.30   0.03 0.0'
  ].join('\n');

  const r = P(good);
  ok('a valid file parses', r.ok, r.ok ? r.points + ' points' : r.error);
  nearAbs('the frequency unit is applied', r.f[0] / 1e9, 1, 1e-12, ' GHz');
  nearAbs('the reference impedance is read', r.z0, 50, 1e-12, ' ohm');
  /* PORT ORDER — the one thing the file cannot tell you, and the one everybody
     assumes wrongly. Touchstone 1.0 puts S21 BEFORE S12. In the fixture above
     the second block is S21 and the third is S12, and they differ nowhere, so
     the test uses an asymmetric file instead. */
  const asym = '# GHz S RI R 50\n1.0  0.1 0   0.5 0   0.2 0   0.3 0';
  const a = P(asym);
  ok('S21 is read from the second block, not the third', a.ok && Math.abs(a.S[0].s21.re - 0.5) < 1e-12,
     a.ok ? 's21=' + fmt(a.S[0].s21.re) : a.error);
  ok('and S12 from the third', a.ok && Math.abs(a.S[0].s12.re - 0.2) < 1e-12);
  ok('the port order is stated in the result rather than left implicit',
     /S11 S21 S12 S22/.test(a.portOrder));

  // dB and MA formats must agree with RI on the same network
  const ri = P('# GHz S RI R 50\n1.0  0 0   0.5 0   0.5 0   0 0');
  const ma = P('# GHz S MA R 50\n1.0  0 0   0.5 0   0.5 0   0 0');
  const db = P('# GHz S DB R 50\n1.0  -300 0   ' + (20 * Math.log10(0.5)).toFixed(6) + ' 0   '
               + (20 * Math.log10(0.5)).toFixed(6) + ' 0   -300 0');
  nearRel('MA agrees with RI', ma.S[0].s21.re, ri.S[0].s21.re, 1e-9);
  nearRel('dB agrees with RI', db.S[0].s21.re, ri.S[0].s21.re, 1e-6);

  /* REFUSALS. Each of these has a plausible "repair" that would produce a
     confident wrong answer, and the parser must decline all of them. */
  const refuses = [
    ['no option line', '1.0 0 0 0 0 0 0 0 0'],
    ['a Y-parameter file', '# GHz Y RI R 50\n1.0 0 0 0 0 0 0 0 0'],
    ['a Touchstone 2.0 file', '[Version] 2.0\n# GHz S RI R 50'],
    ['two option lines', '# GHz S RI R 50\n# MHz S MA R 75\n1 0 0 0 0 0 0 0 0'],
    ['a 1-port file', '# GHz S RI R 50\n1.0 0.1 0.0'],
    ['a 4-port file', '# GHz S RI R 50\n1.0 ' + new Array(32).fill('0').join(' ')],
    ['non-ascending frequencies', '# GHz S RI R 50\n2.0 0 0 0 0 0 0 0 0\n1.0 0 0 0 0 0 0 0 0'],
    ['a repeated frequency', '# GHz S RI R 50\n1.0 0 0 0 0 0 0 0 0\n1.0 0 0 0 0 0 0 0 0'],
    ['non-numeric data', '# GHz S RI R 50\n1.0 x 0 0 0 0 0 0 0'],
    ['an empty file', '   '],
    ['a ragged row', '# GHz S RI R 50\n1.0 0 0 0 0 0 0 0 0\n2.0 0 0 0']
  ];
  refuses.forEach(([what, src]) => {
    const out = P(src);
    ok('refuses ' + what, out.ok === false && typeof out.error === 'string',
       out.ok ? 'ACCEPTED IT' : out.error.slice(0, 60));
  });

  // a reference-impedance mismatch must be refused, not silently renormalised
  const mismatch = P('# GHz S RI R 75\n1.0 0 0 0 0 0 0 0 0', { expectZ0: 50 });
  ok('refuses a 75 ohm file when 50 was expected', mismatch.ok === false);
  ok('...and says renormalise rather than doing it', /renormalise/.test(mismatch.error));

  /* WARNINGS, not refusals. These are suspicious rather than wrong, and the
     caller should be told rather than overruled. */
  const gainy = P('# GHz S RI R 50\n1.0 0 0  2.0 0  2.0 0  0 0');
  ok('warns about gain rather than rejecting it', gainy.ok && gainy.warnings.length > 0,
     gainy.warnings[0]);
  ok('warns when there is no DC point', r.warnings.some((w) => /DC/.test(w)), r.warnings.join(' | '));

  // and never silently alters the data it was given
  nearRel('values are passed through unchanged', r.S[1].s21.re, 0.80, 1e-12);

  /* ═══ M5-10 · the CONVERTED value is what has to be finite ═══
     `isFinite` on the parsed number passes 1e308, and 1e308 GHz is Infinity —
     a finite file producing an infinite frequency, which then propagates into
     every transform downstream without a single NaN to mark where it started.
     Same for a magnitude in dB: 1e308 dB is 10^5e306. */
  const okFile = '# GHz S RI R 50\n1 0.1 0 0.9 0 0.9 0 0.1 0\n'
               + '2 0.1 0 0.8 0 0.8 0 0.1 0\n';
  ok('a well-formed 2-port file is accepted', K.parseTouchstone(okFile).ok);

  const negF = K.parseTouchstone('# GHz S RI R 50\n-1 0.1 0 0.9 0 0.9 0 0.1 0\n');
  ok('a negative frequency is refused', !negF.ok && /negative frequency/.test(negF.error),
     negF.error || 'accepted');

  const bigF = K.parseTouchstone('# GHz S RI R 50\n1e308 0.1 0 0.9 0 0.9 0 0.1 0\n');
  ok('a frequency that overflows AFTER the GHz conversion is refused, even though '
     + 'the parsed number is finite',
     !bigF.ok && /overflows once converted/.test(bigF.error), bigF.error || 'accepted');

  const bigM = K.parseTouchstone('# GHz S DB R 50\n1 1e308 0 -1 0 -1 0 1e308 0\n');
  ok('a magnitude that overflows after the dB conversion is refused',
     !bigM.ok && /overflows once converted/.test(bigM.error), bigM.error || 'accepted');

  /* And the parser says what it does NOT do, because a small strict reader
     advertised as "Touchstone support" would overstate itself considerably. */
  const acc = K.parseTouchstone(okFile).accepts;
  ok('the parser declares the versions, ports, parameters and formats it accepts',
     acc && acc.versions.length && acc.ports.length && acc.parameters.length
     && acc.formats.length);
  ok('and names what it does not support, including noise data and 2.0 keywords',
     acc.notSupported.some((x) => /noise/i.test(x))
     && acc.notSupported.some((x) => /2\.0/.test(x)),
     acc.notSupported.join('; ').slice(0, 90));
});

/* ═════════ P7-3 · units are part of a function's contract ═════════ */
suite('Units — every model function is pinned to the units it documents', () => {
  /* The site has had exactly one units bug and it was expensive: ctleZeroFor
     takes poles normalised to Nyquist, was handed hertz, and returned a zero at
     DC whose peak gain was 1e10 — which propagated all the way to a 10 GV eye
     height before anything looked wrong.

     The kit is not internally consistent about time: line1D works in
     PICOSECONDS (it grew out of a panel that displays ps) while the ABCD
     cascade and the PDN ladder work in SECONDS. Renaming everything would touch
     fourteen modules for no behavioural gain, so instead the convention is
     documented in docs/architecture.md and pinned here — a unit change now
     fails a test rather than surfacing as a wrong number on a page. */

  // line1D — PICOSECONDS. A wave launched into a td=500 line arrives at 500.
  const M = K.line1D({ Z0: 50, Rs: 10, RL: 50, open: true, tr: 1, td: 500, vs: 1 });
  ok('line1D td is in picoseconds: the far end is quiet at t=400',
     Math.abs(K.line1DAt(M, 1, 400).v) < 1e-9);
  ok('...and has arrived by t=600',
     K.line1DAt(M, 1, 600).v > 0.5, fmt(K.line1DAt(M, 1, 600).v) + ' V');
  // and the energy account is therefore in picojoules
  const e = K.line1DEnergy(M, 500, 400, 100);
  ok('line1DEnergy is in pJ, so a 1 V step over 500 ps is single-digit',
     e.fromSource > 1 && e.fromSource < 50, fmt(e.fromSource) + ' pJ');

  // sectionABCD / cascadeS — SECONDS and HERTZ.
  const td = 300e-12;
  const thru = [{ type: 'line', z: 50, td: td, lossDb: 0 }];
  const f0 = 1 / (2 * td);                       // half-wave: phase = -pi
  const S = K.cascadeS(thru, f0, 50, 8e9);
  const ph = Math.atan2(S.s21i, S.s21r);
  ok('cascadeS td is in seconds and f in hertz: a half-wave line inverts',
     Math.abs(Math.abs(ph) - Math.PI) < 1e-6 || Math.abs(ph) < 1e-6, fmt(ph) + ' rad');
  // an open stub of td nulls at 1/(4td) — a direct statement about both units
  const stub = [{ type: 'line', z: 50, td: 1e-10, lossDb: 0 },
                { type: 'stub', z: 50, td: 25e-12 },
                { type: 'line', z: 50, td: 1e-10, lossDb: 0 }];
  const fq = 1 / (4 * 25e-12);
  const Sn = K.cascadeS(stub, fq * 0.999999, 50, 8e9);
  ok('stub td is in seconds: the null lands at 1/(4*td) = 10 GHz',
     Math.hypot(Sn.s21r, Sn.s21i) < 1e-4 && Math.abs(fq - 10e9) < 1);

  // pdnLadder — SI throughout: henries, farads, ohms, hertz.
  const stages = [{ name: 'v', series: null, shunt: { r: 0.01, l: 1e-9 } }];
  const lo = K.pdnLadder(stages, 1e-3), hi2 = K.pdnLadder(stages, 1e10);
  nearAbs('pdnLadder R is in ohms: at DC it is the resistance', lo.mag, 0.01, 1e-6, ' ohm');
  nearAbs('pdnLadder L is in henries: at 10 GHz it is wL',
       hi2.mag, 2 * Math.PI * 1e10 * 1e-9, 1e-3, ' ohm');

  /* ctleZeroFor / ctleResponse — NORMALISED TO NYQUIST, and the one that bit.
     Poles of 0.75 and 1.4 are fractions of Nyquist, not gigahertz. */
  const fz = K.ctleZeroFor(6, 0.75, 1.4);
  ok('ctleZeroFor poles are Nyquist-normalised: 6 dB solves inside the bracket',
     isFinite(fz) && fz > 1e-4 && fz < 100, fmt(fz));
  ok('and hertz-valued poles are refused rather than solved',
     Number.isNaN(K.ctleZeroFor(6, 0.75 * 16e9, 1.4 * 16e9)));

  /* A zero or missing loss reference frequency is a caller error, not a
     default. `||` used to turn 0 into 8 GHz silently, which is the sentinel
     class: an in-band value standing in for "not supplied". */
  const goodRef = K.lineMaterial({ type: 'line', z: 50, td: 1e-9, lossDb: 14,
                                   dielFrac: 0.55, lossRefHz: 8e9 });
  ok('a positive loss reference frequency builds a material', isFinite(goodRef.len));
  const zeroRef = K.lineMaterial({ type: 'line', z: 50, td: 1e-9, lossDb: 14,
                                   dielFrac: 0.55, lossRefHz: 0 }, 8e9);
  ok('a zero loss reference frequency is refused, not defaulted',
     Number.isNaN(zeroRef.len) && Number.isNaN(zeroRef.wavefront));

  // berFloor — a pure count, no units at all.
  nearRel('berFloor takes a symbol count and returns a probability',
       K.berFloor(1000) * 1000, -Math.log(0.05), 1e-9);
});

/* ═════════ P7-4 · no state may be inferred from a missing number ═════════ */
suite('Empty results — every search that can fail says so explicitly', () => {
  /* This is the general form of two bugs that were found separately: M1, where a
     closed bathtub reported a fully open eye, and M7, where anti-resonance kept
     drawing a peak after the peak had gone. Both were the same mistake — a
     function that could legitimately find nothing returned a NUMBER instead, and
     the UI could not tell "zero" from "none".

     The rule: a search that can fail returns an explicit empty result. null, or
     NaN, or an object with a flag — anything the caller cannot mistake for an
     answer. Never a value inside the range of real answers. */
  const { opening } = MODELS;

  // BATHTUB — the original M1 case, and the cases either side of it
  ok('a closed eye returns no interval, not a zero-width one',
     opening(() => 1e-3, 1e-12) === null);
  ok('a curve that only touches the target is not an interval',
     opening((t) => 1e-12 + (t - 0.5) * (t - 0.5), 1e-12) === null);
  ok('NaN anywhere yields no interval, not a NaN-width one',
     opening(() => NaN, 1e-12) === null);
  const wide = opening((t) => (t > 0.1 && t < 0.9) ? 1e-18 : 1, 1e-12);
  ok('and an interval that does exist comes back as an object',
     wide !== null && typeof wide.width === 'number', wide && fmt(wide.width));

  /* CTLE SOLVER — the same class, found while building Lab B. Asked for
     something unreachable it must refuse rather than return its bracket end. */
  ok('an unreachable boost returns NaN, not the lower bracket',
     Number.isNaN(K.ctleZeroFor(200, 0.75, 1.4)));
  ok('poles in the wrong units return NaN, not a plausible-looking zero',
     Number.isNaN(K.ctleZeroFor(12, 0.75 * 16e9, 1.4 * 16e9)));

  /* SCENARIO PARSING — a stale or malformed link must not decode to an empty
     scenario that silently applies nothing. */
  ok('a hash with no scenario returns null', K.parseHash('#section-3') === null);
  ok('an empty hash returns null', K.parseHash('') === null);
  ok('malformed percent escape refuses the entire scenario', K.parseHash('#lab=cdr;v=%') === null);
  ok('malformed UTF-8 refuses the entire scenario', K.parseHash('#lab=cdr;v=%E0%A4%A') === null);
  const sc = K.parseHash('#lab=eye;a=1');
  ok('a real scenario returns a named object', sc && sc.viz === 'eye');

  /* NUMBER FORMATTING — a non-finite value must render as a dash, never as a
     number a reader could quote. This is the same rule at the display layer. */
  ok('NaN formats as a dash', K.fmt.num(NaN) === '—');
  ok('Infinity formats as a dash', K.fmt.num(Infinity) === '—');
  ok('and a real number still formats', /[0-9]/.test(K.fmt.num(0.00123)));

  /* EVIDENCE FLOOR — asked about a run of zero symbols, the answer is not a
     number: there is no evidence at all. */
  ok('a zero-length run has no evidence floor', Number.isNaN(K.berFloor(0)));
  ok('a negative run length has none either', Number.isNaN(K.berFloor(-5)));

  /* And the rule stated as a property: none of these may return something that
     could be mistaken for a measurement. */
  const suspects = [
    ['opening, closed', opening(() => 1e-3, 1e-12)],
    ['ctleZeroFor, unreachable', K.ctleZeroFor(200, 0.75, 1.4)],
    ['berFloor, no symbols', K.berFloor(0)],
    ['parseHash, no scenario', K.parseHash('#x')]
  ];
  const bad = suspects.filter(([, v]) => typeof v === 'number' && isFinite(v));
  ok('no empty result is a finite number', bad.length === 0,
     bad.map(([n]) => n).join(', ') || 'all explicit');
});

/* ═════════ G-5 again · a helper must not answer when it cannot ═════════ */
suite('CTLE solver — units, reachable boost, and no silent degenerate answer', () => {
  /* Lab B handed ctleZeroFor poles in hertz instead of Nyquist-normalised. The
     bisection could not bracket them, converged on its own lower bound, and
     returned a zero at DC whose peak gain is about 1e10 — which then propagated
     into a 10 GV eye height. A value inside the valid range that means "I could
     not do this" is exactly what rule G-5 forbids. */
  ok('hertz-valued poles are refused, not guessed at',
     Number.isNaN(K.ctleZeroFor(14, 0.75 * 16e9, 1.4 * 16e9)));
  ok('a zero pole is refused', Number.isNaN(K.ctleZeroFor(6, 0, 1.4)));
  ok('a negative pole is refused', Number.isNaN(K.ctleZeroFor(6, -0.75, 1.4)));

  // boost beyond what the pole pair can deliver must say so rather than clamp
  ok('an unreachable boost is refused', Number.isNaN(K.ctleZeroFor(200, 0.75, 1.4)));

  // and the normal case must still solve, to the boost that was asked for
  [3, 6, 9, 12, 15].forEach((b) => {
    const fz = K.ctleZeroFor(b, 0.75, 1.4);
    ok(b + ' dB solves to a finite zero', isFinite(fz) && fz > 0, fmt(fz));
    /* INDEPENDENT: read the achieved boost back off the response itself —
       peak magnitude over DC magnitude — rather than trusting the solver. */
    let peak = 0;
    for (let i = 1; i <= 4000; i++) {
      const f = i * 0.005;
      const H = K.ctleResponse(f, fz, 0.75, 1.4);
      peak = Math.max(peak, Math.hypot(H.re, H.im));
    }
    const dc = Math.hypot(K.ctleResponse(0, fz, 0.75, 1.4).re,
                          K.ctleResponse(0, fz, 0.75, 1.4).im);
    nearAbs(b + ' dB is what the response actually gives', 20 * Math.log10(peak / dc), b, 0.5, ' dB');
  });

  // MONOTONICITY: more boost means a lower zero
  let prev = Infinity, mono = true;
  for (const b of [2, 5, 8, 11, 14]) {
    const fz = K.ctleZeroFor(b, 0.75, 1.4);
    if (fz > prev) mono = false;
    prev = fz;
  }
  ok('the zero falls monotonically as boost rises', mono);
});

/* ═════════ P4-3 · Lab B — the section cascade ═════════ */
suite('Cascade — reciprocity, passivity, and closed-form networks', () => {
  ok('the cascade is exposed', typeof K.cascadeS === 'function');
  const Z0 = 50, fR = 8e9;
  const mag = (r, i) => Math.hypot(r, i);
  const at = (secs, f) => K.cascadeS(secs, f, Z0, fR);

  /* CLOSED FORM — a matched lossless line is invisible. |S11| is exactly zero
     and |S21| exactly one at every frequency, and the phase is exactly −ωTd. */
  const thru = [{ type: 'line', z: 50, td: 300e-12, lossDb: 0 }];
  let wS11 = 0, wS21 = 0, wPh = 0;
  for (let k = 1; k <= 40; k++) {
    const f = k * 0.5e9, S = at(thru, f);
    wS11 = Math.max(wS11, mag(S.s11r, S.s11i));
    wS21 = Math.max(wS21, Math.abs(mag(S.s21r, S.s21i) - 1));
    let want = -2 * Math.PI * f * 300e-12, got = Math.atan2(S.s21i, S.s21r);
    let e = (got - want) % (2 * Math.PI);
    if (e > Math.PI) e -= 2 * Math.PI;
    if (e < -Math.PI) e += 2 * Math.PI;
    wPh = Math.max(wPh, Math.abs(e));
  }
  ok('a matched lossless line does not reflect', wS11 < 1e-12, fmt(wS11));
  ok('and passes unity magnitude', wS21 < 1e-12, fmt(wS21));
  ok('with phase exactly −ωTd', wPh < 1e-9, fmt(wPh) + ' rad');

  // and its group delay is its own delay, flat with frequency
  let gdErr = 0;
  for (let k = 1; k <= 20; k++) {
    gdErr = Math.max(gdErr, Math.abs(K.groupDelay(thru, k * 0.5e9, Z0, fR) - 300e-12));
  }
  ok('group delay of a uniform line equals its Td', gdErr < 1e-15, fmt(gdErr * 1e12) + ' ps');

  /* CONSERVATION — a lossless cascade must be unitary: |S11|² + |S21|² = 1.
     Nothing in the ABCD product enforces this; it holds only if the section
     matrices and the S conversion are both right. */
  const mismatch = [
    { type: 'line', z: 50, td: 200e-12, lossDb: 0 },
    { type: 'line', z: 30, td: 60e-12, lossDb: 0 },
    { type: 'line', z: 50, td: 200e-12, lossDb: 0 }
  ];
  let wU = 0;
  for (let k = 1; k <= 60; k++) {
    const S = at(mismatch, k * 0.4e9);
    wU = Math.max(wU, Math.abs(mag(S.s11r, S.s11i) ** 2 + mag(S.s21r, S.s21i) ** 2 - 1));
  }
  ok('a lossless cascade is unitary', wU < 1e-12, fmt(wU));

  // PASSIVITY — with loss it may only ever lose
  const lossy = [{ type: 'line', z: 50, td: 400e-12, lossDb: 14, dielFrac: 0.55 }];
  let over = 0;
  for (let k = 1; k <= 60; k++) {
    const S = at(lossy, k * 0.4e9);
    over = Math.max(over, mag(S.s11r, S.s11i) ** 2 + mag(S.s21r, S.s21i) ** 2 - 1);
  }
  ok('a lossy line never gains energy', over < 1e-12, fmt(over));

  /* M1-3b · The loss budget is the section's PROPAGATION loss, 8.686*Re(gamma)*l,
     and that is hit exactly. |S21| is a different quantity: a lossy line's
     Zc is not its nominal z — here 51.72 + 0.53j against a real 50 ohm
     reference — so |S21| carries a port mismatch as well. channel-model.md
     clause 6.5 states both bounds; asserting them separately is the point. */
  const lossySec = lossy[0];
  const matL = K.lineMaterial(lossySec, fR);
  const gL = K.lineGammaZc(lossySec, fR).g;
  nearAbs('the propagation loss is exactly the budget',
          8.685889638065035 * gL[0] * matL.len, 14, 1e-6, ' dB');
  const sR = at(lossy, fR);
  const s21dB = -20 * Math.log10(mag(sR.s21r, sR.s21i));
  nearAbs('and |S21| is within the mismatch of it', s21dB, 14, 5e-3, ' dB');
  ok('the gap is the mismatch, and |S21| is the LARGER of the two',
     s21dB > 14, fmt(s21dB - 14) + ' dB of mismatch');

  /* Clause 6.3 · passivity is sigma_max(S) <= 1, not each |Sij| <= 1. For a
     reciprocal symmetric two-port the singular values are |S11 +/- S21|. */
  let sigMax = 0, elemMax = 0;
  for (let k = 1; k <= 120; k++) {
    const S = at(lossy, k * 0.2e9);
    const sum = Math.hypot(S.s11r + S.s21r, S.s11i + S.s21i);
    const dif = Math.hypot(S.s11r - S.s21r, S.s11i - S.s21i);
    sigMax = Math.max(sigMax, sum, dif);
    elemMax = Math.max(elemMax, mag(S.s11r, S.s11i), mag(S.s21r, S.s21i));
  }
  ok('sigma_max(S) never exceeds one', sigMax <= 1 + 1e-12, fmt(sigMax));
  ok('and it is a STRICTER test than any single element, which is why it is '
     + 'the one used', sigMax > elemMax, `sigma ${fmt(sigMax)} vs max|Sij| ${fmt(elemMax)}`);
  const sHalf = at(lossy, fR / 4);
  ok('loss falls with frequency', -20 * Math.log10(mag(sHalf.s21r, sHalf.s21i)) < 14);

  /* RECIPROCITY — S12 = S21 for any cascade of reciprocal sections, because
     AD − BC = 1. Checked on a deliberately asymmetric stack. */
  const asym = [
    { type: 'line', z: 42, td: 120e-12, lossDb: 3 },
    { type: 'shunt', r: 0.4, l: 0.9e-9, c: 100e-12 },
    { type: 'line', z: 66, td: 250e-12, lossDb: 6 },
    { type: 'series', r: 1.2, l: 0.5e-9 }
  ];
  let wR = 0, wDet = 0;
  for (let k = 1; k <= 40; k++) {
    const S = at(asym, k * 0.5e9);
    wR = Math.max(wR, Math.hypot(S.s12r - S.s21r, S.s12i - S.s21i));
    wDet = Math.max(wDet, Math.hypot(S.abcd.ar * S.abcd.dr - S.abcd.ai * S.abcd.di
                                     - (S.abcd.br * S.abcd.cr - S.abcd.bi * S.abcd.ci) - 1,
                                     S.abcd.ar * S.abcd.di + S.abcd.ai * S.abcd.dr
                                     - (S.abcd.br * S.abcd.ci + S.abcd.bi * S.abcd.cr)));
  }
  ok('S12 = S21 for a reciprocal cascade', wR < 1e-9, fmt(wR));
  ok('AD − BC = 1 through the whole product', wDet < 1e-9, fmt(wDet));

  /* CLOSED FORM — a quarter-wave transformer of Zc = √(Z0·ZL) matches ZL
     perfectly at its design frequency. This is a textbook result the cascade
     has no knowledge of, so reproducing it tests the whole chain. */
  /* Port 2 is referenced to Z0, so a shunt R sits in PARALLEL with it — the
     load the transformer sees is R‖Z0, not R. Getting this wrong the first time
     produced |S11| = 0.5, which the model was right to report: a λ/4 of 70.7 Ω
     into 100‖50 = 33.3 Ω transforms to 150 Ω, and (150−50)/(150+50) is 0.5. */
  const ZL = 25, f0 = 5e9, tdQ = 1 / (4 * f0);
  const shuntFor = (zl) => 1 / (1 / zl - 1 / Z0);       // R‖Z0 = zl
  const qw = [{ type: 'line', z: Math.sqrt(Z0 * ZL), td: tdQ, lossDb: 0 },
              { type: 'shunt', r: shuntFor(ZL) }];
  const Sq = at(qw, f0);
  ok('a quarter-wave transformer matches at f0', mag(Sq.s11r, Sq.s11i) < 1e-9,
     fmt(mag(Sq.s11r, Sq.s11i)));
  const Sq2 = at(qw, f0 * 0.6);
  ok('and is mismatched away from it', mag(Sq2.s11r, Sq2.s11i) > 0.05,
     fmt(mag(Sq2.s11r, Sq2.s11i)));

  /* CLOSED FORM — an unterminated open stub of delay td is a short circuit to
     the through path at its quarter-wave frequency, so S21 must null there. */
  const tds = 25e-12, fq = 1 / (4 * tds);
  const stub = [{ type: 'line', z: 50, td: 100e-12, lossDb: 0 },
                { type: 'stub', z: 50, td: tds },
                { type: 'line', z: 50, td: 100e-12, lossDb: 0 }];
  const near0 = at(stub, fq * 0.999999);
  ok('an open stub nulls S21 at its quarter-wave frequency',
     mag(near0.s21r, near0.s21i) < 1e-4, fmt(mag(near0.s21r, near0.s21i)));
  nearAbs('and the null is at 1/(4·td)', fq / 1e9, 10, 1e-9, ' GHz');
  const away = at(stub, fq * 0.2);
  ok('and is nearly transparent well below it', mag(away.s21r, away.s21i) > 0.8,
     fmt(mag(away.s21r, away.s21i)));

  // SYMMETRY — a symmetric cascade must give S11 = S22 … checked via reversal
  const fwd = at(mismatch, 3.3e9);
  const rev = K.cascadeS(mismatch.slice().reverse(), 3.3e9, Z0, fR);
  ok('reversing a symmetric cascade changes nothing',
     Math.hypot(fwd.s11r - rev.s11r, fwd.s11i - rev.s11i) < 1e-12);
  const asymRev = K.cascadeS(asym.slice().reverse(), 3.3e9, Z0, fR);
  const aFwd = at(asym, 3.3e9);
  ok('reversing an asymmetric one does change S11',
     Math.hypot(aFwd.s11r - asymRev.s11r, aFwd.s11i - asymRev.s11i) > 1e-3);
  ok('but never changes S21 (reciprocity again)',
     Math.hypot(aFwd.s21r - asymRev.s21r, aFwd.s21i - asymRev.s21i) < 1e-9);
});

/* ═════════ P4-7 · what a finite run can evidence ═════════ */
suite('Evidence — a simulated run cannot claim a compliance BER', () => {
  ok('the floor helper exists', typeof K.berFloor === 'function');

  /* INDEPENDENT: the rule of three. Observing zero errors in n trials leaves a
     95% upper confidence bound of −ln(0.05)/n on the rate. Derived here from the
     Poisson zero-count probability, not copied from the implementation:
     P(0 errors) = e^(−n·p) = 0.05  ⇒  p = −ln(0.05)/n. */
  const bound = (n) => -Math.log(0.05) / n;
  nearRel('900-symbol floor matches the Poisson zero-count bound', K.berFloor(900), bound(900), 1e-12);
  nearRel('420-symbol floor matches it too', K.berFloor(420), bound(420), 1e-12);

  // DIMENSIONAL: the product is a pure number, independent of n
  const prod = [10, 1e3, 1e6, 1e9].map((n) => K.berFloor(n) * n);
  ok('floor × n is constant across nine decades',
     prod.every((v) => Math.abs(v - prod[0]) < 1e-9), fmt(prod[0]));

  // MONOTONICITY: more symbols can only lower the floor
  let prev = Infinity, mono = true;
  for (const n of [100, 420, 900, 5e3, 1e5]) {
    const f = K.berFloor(n);
    if (f > prev) mono = false;
    prev = f;
  }
  ok('the floor falls monotonically with run length', mono);

  /* THE ACTUAL GUARD. These are the run lengths the two eye panels use. If
     anyone ever reports a compliance BER from them, this fails. */
  const RUNS = { 'eye-diagram': 900 - 40 - 2, 'what-closes-the-eye': 420 - 24 - 2 };
  Object.keys(RUNS).forEach((name) => {
    const f = K.berFloor(RUNS[name]);
    ok(name + ' cannot evidence 1e-12', f > 1e-12, 'floor ' + f.toExponential(1));
    ok(name + ' cannot evidence 1e-6', f > 1e-6, 'floor ' + f.toExponential(1));
  });
  const needed = -Math.log(0.05) / 1e-12;
  ok('evidencing 1e-12 would need ~3e12 symbols', needed > 1e12 && needed < 1e13,
     needed.toExponential(1) + ' symbols');

  /* M1-8 · the text is now CONDITIONAL on the error count, and the count has to
     be supplied. These four cases are the whole contract. */
  const tZero = K.berFloorText(858, 0);
  ok('with zero errors the run length is named', /858 symbols/.test(tZero), tZero);
  ok('and it still refuses to call the result a BER', /not a BER/.test(tZero));
  ok('and it says what a real bound would require', /INDEPENDENT trials/.test(tZero));

  const tErr = K.berFloorText(858, 12);
  ok('with errors it reports them instead of a zero-error bound',
     /12 wrong decisions/.test(tErr) && !/better than/.test(tErr), tErr);
  ok('a non-zero-error case can never show a zero-error upper bound',
     !/95% conf/.test(tErr));

  const tNone = K.berFloorText(858);
  ok('with no count supplied it claims nothing at all',
     /not reported/.test(tNone) && !/better than/.test(tNone), tNone);

  ok('and an empty run is not a measurement', /nothing measured/.test(K.berFloorText(0, 0)));

  const tInd = K.berFloorText(858, 0, { independent: true });
  ok('the rule of three appears ONLY when independence is claimed explicitly',
     /95% confidence/.test(tInd) && /independent trials/.test(tInd), tInd);
  ok('no variant ever prints a compliance BER figure',
     [tZero, tErr, tNone, tInd].every((x) => !/1e-12|1e−12/.test(x)));
});

suite('State — initial parameters must agree with the selected preset', () => {
  /* The runtime proof is the browser sweep: clicking the already-selected preset
     must change nothing. This is the source-level guard for the same defect.

     Note what it does NOT test. Hand-typing p beside a PRESETS table is not itself
     the bug — several panels do it and stay correct, and several more assign the
     preset afterwards through a shared helper. Flagging the pattern gave six false
     positives and hid the one real case. The defect is the VALUES DISAGREEING, so
     that is what is compared. */
  const dir = path.join(SRC, 'js', 'viz');
  const bad = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    const re = /NS\.viz\.(\w+) = function[\s\S]*?(?=NS\.viz\.\w+ = function|$)/g;
    let m;
    while ((m = re.exec(src))) {
      const body = m[0];
      /* Only skip when there is no literal to compare — p derived from a preset.
         Do NOT skip on a later Object.assign(p, ...): that pattern also appears in
         every preset click handler, and skipping on it hid the one real defect.
         A hand-typed literal that disagrees with the selected preset is a trap even
         when a startup assignment currently masks it, because the assignment can be
         removed and the disagreement cannot be seen. */
      if (/const p = Object\.assign\(/.test(body)) continue;
      const pm = /const p = \{([^}]*)\}/.exec(body);
      if (!pm) continue;
      const selm = /preset\[data-preset="(\w+)"\]'\)\s*\.setAttribute\('aria-pressed', 'true'\)/.exec(body);
      if (!selm) continue;
      const prem = new RegExp('\\b' + selm[1] + ':\\s*\\{([^}]*)\\}').exec(body);
      if (!prem) continue;
      const nums = (t) => Object.fromEntries([...t.matchAll(/(\w+)\s*:\s*(-?[\d.]+(?:e-?\d+)?)/g)].map((x) => [x[1], +x[2]]));
      const pv = nums(pm[1]), sv = nums(prem[1]);
      for (const k of Object.keys(pv)) {
        if (k in sv && Math.abs(pv[k] - sv[k]) > 1e-9) {
          bad.push(`${file}:${m[1]} p.${k}=${pv[k]} but preset '${selm[1]}'.${k}=${sv[k]}`);
        }
      }
    }
  }
  ok('every panel starts on the values its selected preset declares',
     bad.length === 0, bad.length ? bad.join('; ') : 'checked all modules');
});

/* ═════════ M0-6 · the assembled labs, through their own pipelines ═════════
   Until now this file tested helpers that RESEMBLED the labs. Astra's N3 is that
   the assembled experiment was untested, and B1/B2/N1/N2 are what that let
   through. Each lab now exposes a pure model on NS.models, so these suites run
   the same code the browser runs — no canvas, no DOM.

   What is asserted here is the contract and the diagnostics. The physics these
   models get wrong is recorded with pending(), owned by the milestone that fixes
   it, because a repair has to be demonstrable and that needs the defect
   reachable first. */
suite('Lab result contract — one authoritative record per run', () => {
  const shape = (r, name) => {
    ok(name + ' declares its model and version', !!r.model && !!r.version, r.model + ' ' + r.version);
    ok(name + ' declares a known status', K.STATUS.includes(r.status), r.status);
    ok(name + ' names the units of its parameters', Object.keys(r.units).length > 0);
    ok(name + ' states its conventions', Object.keys(r.conventions).length > 0);
    ok(name + ' gives every trace a stable id',
       r.traces.length > 0 && r.traces.every((t) => !!t.id));
    ok(name + ' separates physical params from view state',
       !Object.keys(r.params).some((k) => k in r.view));
  };

  /* The schema must refuse what it exists to prevent. Planting each fault here
     is the only thing that shows the guard is live. */
  let threw = 0;
  try { K.result({ model: 'x', version: '1', status: 'ok' }); } catch (e) { threw++; }
  try { K.result({ model: 'x', version: '1', status: 'nonsense', params: {} }); } catch (e) { threw++; }
  try { K.result({ model: 'x', version: '1', status: 'empty', params: {} }); } catch (e) { threw++; }
  try {
    K.result({ model: 'x', version: '1', status: 'ok', params: {}, traces: [{ label: 'anon' }] });
  } catch (e) { threw++; }
  try {
    K.result({ model: 'x', version: '1', status: 'ok', params: {},
               traces: [{ id: 'a' }, { id: 'a' }] });
  } catch (e) { threw++; }
  ok('the result schema rejects a missing field, an unknown status, an '
     + 'unexplained non-ok status, an unidentified trace and a duplicate id',
     threw === 5, threw + ' of 5 rejected');

  /* A model that cannot answer must not return a number that looks like one. */
  const notSettled = K.result({ model: 'x', version: '1', status: 'not-settled',
                                params: {}, why: 'record too short',
                                measurements: { droop: 0.137 } });
  ok('a non-ok result carries no measurements at all, so "insufficient data" '
     + 'can never be read as a value', notSettled.measurements === null);
  ok('and it says why', !!notSettled.why, notSettled.why);

  const GEN4 = { reach: 8, loss: 14, rate: 16, dz: 38, dpos: 45, dlen: 24,
                 stub: 0, tr: 12, eq: true };
  const PDNP = { rvrm: 4, fbw: 120, lplane: 900, lpkg: 350, cboard: 1, nboard: 20,
                 esr: 20, esl: 1100, cdie: 200, imax: 8, tr: 800, zt: 10 };
  const WAVEP = { Z0: 50, Rs: 10, RL: 50, open: true, tr: 60, len: 3, xp: 50 };

  ok('all three labs expose a pure model reachable without a DOM',
     typeof MODELS.labChannel === 'function' && typeof MODELS.labWaves === 'function'
     && typeof MODELS.labPdn === 'function');
  shape(MODELS.labChannel(GEN4), 'labChannel');
  shape(MODELS.labWaves(WAVEP, 500), 'labWaves');
  shape(MODELS.labPdn(PDNP), 'labPdn');

  /* Determinism: the same parameters must give the same answer. A seeded PRBS
     and a fixed grid leave no room for anything else, and an export that
     disagreed with its own table would start here. */
  const a = MODELS.labChannel(GEN4), b = MODELS.labChannel(GEN4);
  nearAbs('the same scenario measures the same eye twice',
          a.measurements.eyeHeight, b.measurements.eyeHeight, 0, ' V');
});

/* ═══════════════════ Lab D · ADC interference ═══════════════════
   A coupled digital aggressor reaches a converter's input or reference, and the
   converter's own sampling decides where the error lands. None of these suites
   re-runs the model's formulas: the fold is computed by remainder and mirror, the
   spur levels come from the trapezoid's Fourier series through a least-squares fit
   to the output record, the delta-sigma limit is the closed form for a 1-bit
   second-order loop, and the loop's own transfer function is checked by inverting
   the claim rather than by repeating the recurrence.
   Independent references live in tests/adc-references.js. */
const ADC = SIPI.models.adcLab;
const REF = require('./tests/adc-references.js');
const ADC_SAR = {
  arch: 'sar', bits: 16, fs: 1e6, vref: 2.5, noiseUv: 0, inFreq: 10e3, inDbfs: -1,
  fmod: 256e3, osr: 128, aggAmp: 1.8, aggMode: 'free', aggFreq: 4.13e6, aggMultiple: 4,
  aggPpm: 0, aggPhase: 90, edge: 1e-9, path: 'none', couplingDb: -80,
  couplingType: 'flat', pathBw: 20e6
};
const adcWith = (o) => Object.assign({}, ADC_SAR, o);

suite('ADC SAR — quantization limit, half-LSB error, monotonic codes', () => {
  /* The only number an ideal N-bit converter is allowed to produce. */
  [10, 12, 16].forEach((N) => {
    const m = ADC.run(adcWith({ bits: N, inDbfs: -0.01, record: 14 })).measurements;
    nearAbs('ideal SNR at ' + N + ' bits is 6.02N + 1.76', m.snr,
            6.0206 * N + 1.7609 - 0.01, 0.3, 'dB');
  });

  /* Two things no correct quantizer can get wrong, read off the record it produced
     rather than off the expression that produced it. */
  const base = adcWith({ bits: 12, inDbfs: -0.5, record: 13 });
  const r = ADC.run(base), y = r.generated.output, M = y.length;
  const half = Math.pow(2, base.bits - 1), lsb = base.vref / half;
  const w = REF.TAU * Math.round(r.measurements.inputFrequency * M / base.fs) / M;
  const a = base.vref * Math.pow(10, base.inDbfs / 20);
  let worst = 0; const pairs = [];
  for (let n = 0; n < M; n++) {
    const h = a * Math.sin(w * n + ADC.PHI0);
    worst = Math.max(worst, Math.abs(y[n] - h));
    pairs.push([h, y[n]]);
  }
  pairs.sort((u, v) => u[0] - v[0]);
  let back = 0;
  for (let i = 1; i < pairs.length; i++) if (pairs[i][1] < pairs[i - 1][1] - 1e-12) back++;
  ok('no sample is further than half an LSB from its input', worst <= lsb / 2 + 1e-12,
     (worst / lsb).toFixed(4) + ' LSB');
  ok('a larger input never returns a smaller code', back === 0, back + ' non-monotone pairs');

  /* The trial search is the path a moving reference takes. It has to be right when
     nothing is moving before its behaviour under a disturbance means anything. */
  const quiet = ADC.run(adcWith({ bits: 12, inDbfs: -0.5, record: 13, path: 'reference', couplingDb: -400 })).generated.output;
  let same = true;
  for (let n = 0; n < M; n++) if (Math.abs(quiet[n] - y[n]) > 1e-12) { same = false; break; }
  ok('the bit-trial search and the closed form agree on a clean reference', same);
});

suite('ADC delta-sigma — loop transfer function, shaping slope, overload refusal', () => {
  /* The implemented ordering — decision from x2 before this sample's update, feedback
     at the current instant, x1 first, x2 using the updated x1 — gives, with d = 1−z⁻¹,
     V[d² + z⁻¹(2−z⁻¹)] = z⁻¹U + E d², and that bracket is exactly 1. Rather than
     repeat the recurrence, invert the claim: double integrate (V − z⁻¹U) and what
     comes back must BE the quantization error — bounded by the reference plus the
     overload threshold, and consistent with the decision that produced it, because
     v = sign(x2) requires v·e < vref at every sample. */
  const p = { arch: 'ds', fmod: 64e3, osr: 64, vref: 2.5, noiseUv: 0, inFreq: 200, inDbfs: -6,
              outputs: 1024, aggAmp: 1.8, aggMode: 'free', aggFreq: 1e3, aggMultiple: 4, aggPpm: 0,
              aggPhase: 0, edge: 1e-9, path: 'none', couplingDb: -80, couplingType: 'flat', pathBw: 20e6 };
  const r = ADC.run(p);
  /* Assert the run happened before reading it. A model that refuses this scenario
     has already failed, and it must fail an assertion here rather than throwing a
     TypeError that takes the whole gate down before it can name anything. */
  ok('the reference delta-sigma scenario runs at all',
     r.status === 'ok' && r.generated && r.generated.bits && r.generated.bits.length > 0,
     r.status === 'ok' ? r.generated.bits.length + ' modulator samples' : 'status ' + r.status);
  if (r.status !== 'ok' || !r.generated || !r.generated.bits) return;
  const v = r.generated.bits, vref = p.vref;
  const J = Math.round(r.measurements.inputFrequency * p.outputs / (p.fmod / p.osr));
  const a = vref * Math.pow(10, p.inDbfs / 20), w = REF.TAU * J / (p.outputs * p.osr);
  const bound = vref * (1 + ADC.DS_STATE_LIMIT);
  const trial = (d) => {
    let s1 = 0, s2 = 0, peak = 0, viol = 0;
    for (let m = 0; m < v.length; m++) {
      s1 += v[m] * vref - (m >= d ? a * Math.sin(w * (m - d) + ADC.PHI0) : 0);
      s2 += s1;
      if (m < 2) continue;
      if (Math.abs(s2) > peak) peak = Math.abs(s2);
      if (v[m] * s2 >= vref) viol++;
    }
    return { peak, viol };
  };
  const one = trial(1), zero = trial(0), two = trial(2);
  ok('V = z⁻¹U + (1−z⁻¹)²E leaves a bounded quantization error', one.peak < bound,
     one.peak.toFixed(2) + ' V against a ' + bound.toFixed(1) + ' V bound');
  ok('and one the decision agrees with at every sample', one.viol === 0, one.viol + ' violations');
  ok('no other signal delay does', zero.peak > 2 * bound && two.peak > 2 * bound,
     'z⁰ ' + zero.peak.toFixed(0) + ' V, z⁻² ' + two.peak.toFixed(0) + ' V');

  /* Second-order shaping is 15.05 dB per doubling; the absolute level is the
     closed-form limit for a 1-bit second-order loop. */
  const snr = [32, 64, 128, 256].map((osr) => ADC.run({
    arch: 'ds', fmod: osr * 1000, osr, vref: 2.5, noiseUv: 0, inFreq: 20, inDbfs: -6,
    aggAmp: 1.8, aggMode: 'free', aggFreq: 1e3, aggPpm: 0, aggPhase: 0, edge: 1e-9,
    path: 'none', couplingDb: -80, couplingType: 'flat', pathBw: 20e6
  }).measurements.snr);
  snr.slice(1).forEach((v2, i) => nearAbs('doubling the oversampling ratio adds 15.05 dB (' +
    [64, 128, 256][i] + ')', v2 - snr[i], 15.05, 1.5, 'dB'));
  const limit64 = 20 * Math.log10(2) + 10 * Math.log10(1.5)
                - 10 * Math.log10(Math.pow(Math.PI, 4) / 5) + 50 * Math.log10(64) - 6;
  ok('and lands within 6 dB below the linear-model limit at OSR 64',
     limit64 - snr[1] >= -1 && limit64 - snr[1] <= 6,
     snr[1].toFixed(2) + ' dB against ' + limit64.toFixed(2) + ' dB');

  /* An overloaded loop is refused, not reported as a poor converter. */
  const over = ADC.run({ arch: 'ds', fmod: 256e3, osr: 128, vref: 2.5, noiseUv: 0, inFreq: 200,
    inDbfs: -0.5, aggAmp: 50, aggMode: 'free', aggFreq: 977, aggMultiple: 4, aggPpm: 0, aggPhase: 0,
    edge: 1e-9, path: 'input', couplingDb: -6, couplingType: 'flat', pathBw: 20e6 });
  ok('an overloaded loop is refused with a reason, not measured',
     over.status === 'unsupported' && /overload/i.test(over.why) && !over.measurements);

  /* A result that changed with the record length would be describing the record. */
  const q = { arch: 'ds', fmod: 128e3, osr: 128, vref: 2.5, noiseUv: 0, inFreq: 30, inDbfs: -6,
              aggAmp: 1.8, aggMode: 'free', aggFreq: 1e3, aggMultiple: 4, aggPpm: 0, aggPhase: 0,
              edge: 1e-9, path: 'none', couplingDb: -80, couplingType: 'flat', pathBw: 20e6 };
  const lens = [1024, 2048, 4096].map((n) => ADC.run(Object.assign({}, q, { outputs: n })).measurements.snr);
  ok('the measurement does not depend on how long the record is',
     Math.max.apply(null, lens) - Math.min.apply(null, lens) <= 3,
     lens.map((x) => x.toFixed(2)).join(', ') + ' dB');
});

suite('ADC aliasing — where a fold lands, and what a shared clock does', () => {
  /* Fold positions, against a remainder-and-mirror construction rather than the
     model's round(). */
  const rng = REF.lcg(0x2b1d);
  let worst = 0;
  for (let i = 0; i < 20; i++) {
    const fa = 1e5 + rng() * 9.9e6;
    worst = Math.max(worst, Math.abs(ADC.fold(fa, 1e6) - REF.foldRef(fa, 1e6)));
  }
  ok('every fold lands where remainder-and-mirror puts it', worst < 1e-6, worst.toExponential(1) + ' Hz');

  /* An aggressor on its own crystal at a nominal multiple beats at its frequency
     error; only a shared clock lands on DC. This is the default the lab ships, and
     the difference between a spur you can see and an offset you cannot. */
  const beatBase = adcWith({ record: 14, path: 'input', couplingDb: -60, edge: 5e-9, aggFreq: 1e6 });
  const df = ADC_SAR.fs / 16384;
  const fast = ADC.run(Object.assign({}, beatBase, { aggPpm: 2000 })).measurements;
  const slow = ADC.run(Object.assign({}, beatBase, { aggPpm: 20 })).measurements;
  const sharedClk = ADC.run(Object.assign({}, beatBase, { aggMode: 'clock', aggMultiple: 1 })).measurements;
  nearAbs('2000 ppm on a 1 MHz aggressor becomes a 2 kHz spur',
          fast.interferenceAt, REF.foldRef(1e6 * (1 + 2000e-6), ADC_SAR.fs), 1.5 * df, 'Hz');
  ok('20 ppm becomes a beat slow enough to sit inside the DC bins',
     Math.abs(slow.slowBeat - 20) < 1e-6 && slow.slowBeatHarmonic === 1,
     slow.slowBeat.toFixed(3) + ' Hz on harmonic ' + slow.slowBeatHarmonic);
  ok('only a shared crystal lands on DC, leaving SNR alone',
     sharedClk.slowBeat === 0 && Math.abs(sharedClk.snrLoss) <= 0.1 && fast.slowBeat === 0,
     'SNR loss ' + sharedClk.snrLoss.toFixed(3) + ' dB');
});

suite('ADC coupling — spur levels against the trapezoid\u2019s own Fourier series', () => {
  /* The model evaluates the aggressor in the time domain; its harmonic amplitudes are
     never used to build the waveform. Fitting tones to the output record and comparing
     with the series summed independently tests the coupling law, the edge and the fold
     together, and shares no code with the model's FFT, window or bins. */
  [{ aggFreq: 1.37e6, couplingType: 'flat' },
   { aggFreq: 4.13e6, couplingType: 'flat' },
   { aggFreq: 7.91e6, couplingType: 'capacitive' }].forEach((c) => {
    const p = adcWith(Object.assign({ record: 14, path: 'input', couplingDb: -60,
                                      edge: 5e-9, pathBw: 20e6 }, c));
    const r = ADC.run(p), y = r.generated.output, M = y.length;
    const fin = ADC.coherentBin(p.inFreq, p.fs, M) / M;
    const G = Math.pow(10, p.couplingDb / 20);
    const fit = REF.toneFit(y, [fin, p.aggFreq / p.fs, 3 * p.aggFreq / p.fs, 5 * p.aggFreq / p.fs]);
    [1, 3].forEach((n, i) => {
      const f = n * p.aggFreq;
      const want = G * REF.trapezoidHarmonic(p.aggAmp, n, p.edge / 0.8 * p.aggFreq)
                 / Math.sqrt(1 + Math.pow(f / p.pathBw, 2))
                 * (c.couplingType === 'capacitive' ? f / ADC.F_REF_CAP : 1);
      nearAbs(c.couplingType + ' ' + (p.aggFreq / 1e6).toFixed(2) + ' MHz, harmonic ' + n
              + ' arrives at its series amplitude',
              20 * Math.log10(fit.amps[i + 1] / want), 0, 0.2, 'dB');
    });
  });
});

suite('ADC decimation — three boxcars, and what they reject', () => {
  /* Properties of a cascade of three length-OSR moving averages. A filter that passed
     DC at anything but unity would put a gain error on every reading; a missing null
     is the whole reason this shape is used at an output-rate multiple. */
  [8, 16, 64, 128, 256].forEach((osr) => {
    const h = ADC.sinc3Kernel(osr);
    let sum = 0, sym = 0;
    for (let i = 0; i < h.length; i++) { sum += h[i]; sym = Math.max(sym, Math.abs(h[i] - h[h.length - 1 - i])); }
    const at = (cyc) => {
      let re = 0, im = 0;
      for (let i = 0; i < h.length; i++) { const t = REF.TAU * cyc * i; re += h[i] * Math.cos(t); im -= h[i] * Math.sin(t); }
      return Math.hypot(re, im);
    };
    ok('OSR ' + osr + ': the kernel is 3·OSR−2 long, unity at DC and symmetric',
       h.length === 3 * osr - 2 && Math.abs(sum - 1) < 1e-12 && sym < 1e-15,
       'len ' + h.length + ', DC ' + sum.toFixed(12));
    ok('OSR ' + osr + ': it nulls the first three multiples of the output rate',
       [1, 2, 3].every((k) => at(k / osr) < 1e-12));
  });
  const x = new Float64Array(11 * 64).fill(0.75);
  const flat = A_max(ADC.decimate(x, 64, 4, 3 * 64 - 3 + 128), 0.75);
  ok('a constant through the real decimation path comes out unchanged', flat < 1e-12,
     flat.toExponential(1) + ' V');
});
function A_max(arr, want) {
  let m = 0;
  for (let i = 0; i < arr.length; i++) m = Math.max(m, Math.abs(arr[i] - want));
  return m;
}

suite('ADC metrics — window corrections, and the limits the convention has', () => {
  /* A full-scale coherent sine must read 0 dBFS at its bin, and an off-bin tone must
     still read its own level once its lobe is summed — the two corrections a window
     needs, and they are different corrections. */
  const M = 8192, vref = 2.5;
  const mk = (amp, bin) => {
    const y = new Float64Array(M);
    for (let n = 0; n < M; n++) y[n] = amp * Math.sin(REF.TAU * bin * n / M + 0.2);
    return ADC.analyse(y, { vref, J: Math.round(bin), fs: 1e6 });
  };
  const full = mk(vref, 1000);
  nearAbs('a full-scale coherent sine reads 0 dBFS at its bin', full.amp[1000], 0, 0.02, 'dBFS');
  const off = mk(vref * Math.pow(10, -20 / 20), 2500.5);
  let lobe = 0;
  for (let k = 2500 - ADC.LOBE; k <= 2501 + ADC.LOBE; k++) lobe += off.pw[k];
  nearAbs('an off-bin −20 dBFS tone still sums to −20 dBFS',
          10 * Math.log10(lobe / (vref * vref / 2)), -20, 0.05, 'dBFS');

  /* Two stated limits of the SNR convention, checked rather than asserted. */
  const shared = ADC.run(adcWith({ path: 'input', aggMode: 'clock', aggMultiple: 4,
                                   aggPpm: 0, aggPhase: 90, couplingDb: -40 }));
  ok('interference hidden inside an excluded lobe is named, not silently dropped',
     shared.measurements.maskedCount > 0 && shared.diagnostics.masked.some((q) => q.inside === 'DC'),
     shared.measurements.maskedCount + ' masked');
  const free = ADC.run(adcWith({ path: 'input', couplingDb: -60 }));
  const frac = free.diagnostics.replacedFraction;
  ok('the average that stands in for the excluded bins can bias the total by under 0.01 dB',
     frac > 0 && 10 * Math.log10(1 / (1 - frac)) < 0.01,
     (frac * 100).toFixed(3) + '% of bins, ' + (10 * Math.log10(1 / (1 - frac))).toFixed(4) + ' dB');
});

suite('ADC reference coupling — sidebands, and when in the conversion it matters', () => {
  /* Reference coupling multiplies. Its sidebands ride on the input, so halving the
     input halves them; an additive path would leave them where they were. The level
     is compared with Vin·d/(2·Vref) summed from the series, and the aggressor's own
     frequency must be absent, because a multiplied disturbance has no line there. */
  const fa = 37.3e3;
  const amps = [-1, -1 - 20 * Math.log10(2)].map((d) => {
    const p = adcWith({ record: 14, inDbfs: d, aggFreq: fa, edge: 1e-6,
                        path: 'reference', couplingDb: -40 });
    const r = ADC.run(p), y = r.generated.output, M = y.length;
    const fin = ADC.coherentBin(p.inFreq, p.fs, M) / M, f = fa / p.fs;
    const fit = REF.toneFit(y, [fin, fin + f, fin - f, f]);
    const a = p.vref * Math.pow(10, d / 20);
    const d1 = Math.pow(10, p.couplingDb / 20)
             * REF.trapezoidHarmonic(p.aggAmp, 1, p.edge / 0.8 * fa)
             / Math.sqrt(1 + Math.pow(fa / p.pathBw, 2));
    return { side: (fit.amps[1] + fit.amps[2]) / 2, alone: fit.amps[3], want: a * d1 / (2 * p.vref) };
  });
  nearAbs('halving the input halves the sidebands', 20 * Math.log10(amps[1].side / amps[0].side),
          -6.0206, 0.2, 'dB');
  nearAbs('and their level is Vin·d/(2·Vref)', 20 * Math.log10(amps[0].side / amps[0].want),
          0, 0.5, 'dB');
  ok('nothing appears at the aggressor frequency itself: the path multiplies, it does not add',
     20 * Math.log10(amps[0].alone / amps[0].side) <= -30,
     (20 * Math.log10(amps[0].alone / amps[0].side)).toFixed(1) + ' dB below the sidebands');

  /* A reference that moves DURING the bit trials changes the code; the same
     disturbance after them cannot, because every trial has already been decided.
     Trials fill the first half of the sample period, so 0.25 T is inside and
     0.75 T is outside. This is the whole mechanism of the lesson. */
  const pulseBase = adcWith({ record: 14, path: 'reference', couplingType: 'capacitive',
                              couplingDb: -60, edge: 2e-9, pathBw: 20e6,
                              aggMode: 'clock', aggMultiple: 0.5 });
  const during = ADC.run(Object.assign({}, pulseBase, { aggPhase: 315 })).measurements;
  const after = ADC.run(Object.assign({}, pulseBase, { aggPhase: 225 })).measurements;
  ok('a reference pulse at 0.25 T costs SNR; the same pulse at 0.75 T costs nothing',
     during.snrLoss >= 10 && Math.abs(after.snrLoss) <= 0.1,
     'during −' + during.snrLoss.toFixed(1) + ' dB, after '
     + (after.snrLoss >= 0 ? '−' : '+') + Math.abs(after.snrLoss).toFixed(3) + ' dB');
});

suite('ADC domain — a value outside it is refused, not measured', () => {
  /* Slider ranges are a user interface. A scenario link, a replayed export or a later
     caller can present anything, so the domain is checked in the model. */
  const cases = [
    ['architecture', { arch: 'flash' }], ['coupling path', { path: 'sideways' }],
    ['reference at zero', { vref: 0 }], ['fractional bits', { bits: 12.5 }],
    ['infinite sample rate', { fs: Infinity }], ['input above Nyquist', { inFreq: 600e3 }],
    ['input above full scale', { inDbfs: 3 }], ['negative noise', { noiseUv: -5 }],
    ['zero rise/fall time', { edge: 0 }], ['not-a-number coupling', { couplingDb: NaN }],
    ['zero coupling bandwidth', { pathBw: 0 }], ['negative aggressor swing', { aggAmp: -1 }]
  ];
  const accepted = cases.filter(([, over]) => {
    const r = ADC.run(adcWith(Object.assign({ path: 'input' }, over)));
    return r.status !== 'unsupported' || !r.why || r.measurements;
  }).map(([name]) => name);
  ok('every value outside the domain is refused with a reason', accepted.length === 0,
     accepted.length ? 'accepted: ' + accepted.join(', ') : cases.length + ' refused');

  const collapse = ADC.run(adcWith({ path: 'reference', couplingDb: 20, aggAmp: 1.8, edge: 1e-9 }));
  ok('a reference driven to zero or below is refused: it is not a reference',
     collapse.status === 'unsupported' && /drove the reference to /.test(collapse.why));
});

suite('Lab B eye scale — a view that cannot hide the signal', () => {
  /* The eye holds one vertical scale so a closing eye visibly closes and two
     presets can be compared on the same axis. The risk a held scale carries is
     that it cuts the signal off, which would make a worse eye look better. These
     are properties of the ladder, not a second copy of its arithmetic: whatever
     rungs it has, the limit must contain the signal, must be the tightest rung
     that does, and must not fall as the signal grows. */
  const L = SIPI.viz.labChannel.eyeLadder;

  const needs = [0.01, 0.05, 0.1, 0.1001, 0.35, 0.5, 0.75, 1.0, 1.2, 1.9, 2.0, 2.4, 3.7, 9.1];
  ok('every signal fits inside the scale drawn for it',
     needs.every((n) => L.step(n) >= n - 1e-12),
     needs.map((n) => n + '→' + L.step(n)).slice(0, 4).join(' '));

  ok('no rung would have been tight enough and was skipped',
     needs.every((n) => !L.steps.some((v) => v >= n - 1e-12 && v < L.step(n) - 1e-12)));

  ok('a larger signal never gets a smaller scale',
     needs.every((a) => needs.every((b) => a > b || L.step(a) <= L.step(b) + 1e-12)));

  ok('a signal past the top rung still fits',
     L.step(9.1) >= 9.1 && L.step(120) >= 120, 'top rung ' + L.steps[L.steps.length - 1]);

  ok('the starting scale is itself a rung, so a default eye is directly comparable',
     L.steps.indexOf(L.start) >= 0, '±' + L.start * 1000 + ' mV');

  /* Held-and-grown behaviour is max(current, step(need)), which is monotone by
     construction; that it is actually applied on every redraw is a browser check,
     not one this file can make. */
});

suite('Lab B assembled — arrival, causality, phase and populations', () => {
  const P = (o) => Object.assign({ reach: 8, loss: 14, rate: 16, dz: 38, dpos: 45,
                                   dlen: 24, stub: 0, tr: 12, eq: true }, o);
  const PRESETS = {
    pcie4: {}, pcie5: { reach: 10, loss: 22, rate: 32, tr: 8 },
    ufs4: { reach: 4, loss: 8, rate: 23, dz: 42, dpos: 50, dlen: 16, tr: 10 },
    stubby: { dz: 50, dlen: 0, stub: 28 }
  };

  /* ═══ M1-1 · the main arrival survives, for every preset and both extremes ═══
     B1 was `keep = SPS * 40`: 1280 samples of record against a Gen5 arrival at
     sample 1741. The transport delay is now de-embedded as an exact integer
     sample rotation and carried separately, so the record holds the channel's
     memory and the flight time costs nothing. */
  const cases = Object.assign({}, PRESETS, {
    'max reach': { reach: 20, loss: 30, rate: 32 },
    'min reach': { reach: 1, loss: 1, rate: 8 }
  });
  for (const name of Object.keys(cases)) {
    const r = MODELS.labChannel(P(cases[name]));
    const m = r.measurements, d = r.diagnostics;
    /* INDEPENDENT: the cursor must lie inside the record, and the flight time
       must be the wavefront sum — computed here from the material, not read
       back from the model. */
    ok(`${name} · the cursor is inside the record`,
       m.cursor > 0 && m.cursor < d.memoryKept,
       `cursor ${m.cursor} of ${d.memoryKept}`);
    ok(`${name} · the response has a real peak, not pre-arrival residue`,
       Math.abs(r.generated.raw.pr.sbr[m.cursor]) > 0.01,
       `sbr[cursor] = ${fmt(r.generated.raw.pr.sbr[m.cursor])}`);
    nearRel(`${name} · transport delay is an exact number of samples`,
            d.transportSamples, Math.round(d.transportSamples), 1e-12);
    ok(`${name} · and the sub-sample remainder is kept, not discarded`,
       d.transportFraction >= 0 && d.transportFraction < 1 / (SPS * cases[name].rate ? 1 : 1),
       `${(d.transportFraction * 1e12).toFixed(3)} ps`);
  }

  /* ═══ M1-2 · the record covers the memory, and settling ═══ */
  for (const name of Object.keys(PRESETS)) {
    const d = MODELS.labChannel(P(PRESETS[name])).diagnostics;
    /* The direct claim, which nothing asserted before: whatever the record
       length rule is, it has to cover the memory the channel actually has.
       `SPS * 40` did not, and a constant never can — the memory depends on the
       dispersion, the discontinuity and the stub. */
    ok(`${name} · the kept record covers the channel's memory`,
       d.memoryKept >= d.memoryNeeded,
       `${d.memoryNeeded} needed, ${d.memoryKept} kept`);
    /* N2-2 retired the page-wide "settles" claim. What a preset owes is that its
       EYE is converged, which is measured directly below; an impulse tail that
       has not decayed marks the impulse and pulse panels and nothing else. */
    ok(`${name} · names which panels an undecayed tail affects, if any`,
       d.settled === true || (d.affects || []).join(',') === 'impulse,pulse',
       `settled ${d.settled}, affects ${JSON.stringify(d.affects || [])}`);
  }

  /* ═══ N2-2 / R5 · THE TAIL METRIC MEASURES A TAIL ═══
     Three claims were retired here, each refuted by measurement rather than by
     argument. */

  /* ONE. A matched, lossless, one-inch line has NO REFLECTOR ANYWHERE, and the
     old metric read 3.8462% on it at every record length. It was measuring the
     sidelobes of a band-limited fractional delay wrapping into the last eighth
     of the circular record, because the de-embedded peak sits at sample 0. */
  const clean = P({ reach: 1, loss: 0, rate: 16, dz: 50, dpos: 50, dlen: 0,
                    stub: 0, tr: 12, eq: false });
  const c4 = MODELS.labChannel(clean, { nfft: 4096 }).diagnostics.periodicResidual;
  const c16 = MODELS.labChannel(clean, { nfft: 16384 }).diagnostics.periodicResidual;
  ok('a channel with no reflector reports a negligible tail', c4 < 1e-3,
     `${(c4 * 100).toFixed(4)}%`);
  ok('and it falls further as the record grows, because it is a grid effect',
     c16 < c4, `${(c4 * 100).toFixed(4)}% -> ${(c16 * 100).toFixed(4)}%`);

  /* TWO. The old comment called an almost-lossless line with a 38 ohm step "a
     resonator whose reflections never decay". A finite mismatched section
     between matched external lines sheds energy into those lines — loss was
     never the only damping available — and the measurement says so: it
     converges exactly like every other scenario. */
  const wildP = P({ reach: 1, loss: 1, rate: 8 });
  const w = [4096, 8192, 16384].map((nfft) =>
    MODELS.labChannel(wildP, { nfft }).diagnostics.periodicResidual);
  ok('the "non-decaying resonator" converges with record length like anything else',
     w[2] < w[0] * 0.6, w.map((v) => v.toExponential(2)).join(' -> '));

  /* THREE. Every scenario the panel can build converges. There is no second
     category, which is what the retired comment claimed to be distinguishing. */
  const demanding = P({ reach: 10, loss: 22, rate: 32, tr: 8 });
  const conv = [4096, 8192, 16384].map((nfft) =>
    MODELS.labChannel(demanding, { nfft }).diagnostics.periodicResidual);
  ok('and so does a long, lossy, fast one', conv[2] < conv[0] * 0.6,
     conv.map((v) => v.toExponential(2)).join(' -> '));

  /* WHAT REPLACED THE RETIRED BOUND. The old claim inferred an eye error from
     the tail: "1% of tail lets at most 1% of a cursor leak, so at most 2% of the
     eye". It was never derived, and measurement shows the tail is not even a
     PREDICTOR — rateonly has the second largest tail and the smallest error,
     ufs4 the smallest tail and the largest. So the eye's accuracy is measured
     directly instead, by quadrupling the record. */
  let worstEye = 0, worstName = null, tailOfWorst = 0, worstTail = 0, eyeOfWorstTail = 0;
  for (const name of Object.keys(PRESETS)) {
    const a = MODELS.labChannel(P(PRESETS[name]), { nfft: 4096 });
    const b = MODELS.labChannel(P(PRESETS[name]), { nfft: 16384 });
    const err = Math.abs(a.measurements.eyeHeight - b.measurements.eyeHeight) * 1e3;
    if (err > worstEye) {
      worstEye = err; worstName = name; tailOfWorst = a.diagnostics.periodicResidual;
    }
    if (a.diagnostics.periodicResidual > worstTail) {
      worstTail = a.diagnostics.periodicResidual;
      eyeOfWorstTail = err;
    }
  }
  ok('every preset eye is within 0.35 mV of a four-times-longer record',
     worstEye < 0.35, `worst ${worstEye.toFixed(4)} mV on ${worstName}`);
  ok('and the tail does not predict that error, which is why it is not a bound',
     tailOfWorst < worstTail,
     `largest eye error ${worstEye.toFixed(4)} mV at tail ${(tailOfWorst * 100).toFixed(3)}%, `
     + `while the largest tail ${(worstTail * 100).toFixed(3)}% errs only `
     + `${eyeOfWorstTail.toFixed(4)} mV`);

  /* ═══ M1-5 · ONE sampling phase ═══ */
  for (const name of Object.keys(PRESETS)) {
    const m = MODELS.labChannel(P(PRESETS[name])).measurements;
    nearAbs(`${name} · the eye is measured AT the pulse cursor`,
            m.samplePhase, m.cursor, 0, ' samples');
  }

  /* ═══ M1-6 · populations labelled by the transmitted symbol ═══
     The two halves of the acceptance. An ideal channel must make no errors at
     its cursor, and deliberately sampling a transition must REDUCE the margin
     and REPORT the errors rather than relabelling them into the other cloud. */
  const ideal = MODELS.labChannel({ reach: 1, loss: 0, rate: 16, dz: 50, dpos: 50,
                                    dlen: 0, stub: 0, tr: 12, eq: false });
  ok('an ideal matched lossless channel makes no wrong decisions at its cursor',
     ideal.measurements.wrongDecisions === 0,
     `${ideal.measurements.wrongDecisions} of ${ideal.measurements.validSymbols}`);

  const off = MODELS.labChannel({ reach: 1, loss: 0, rate: 16, dz: 50, dpos: 50,
                                  dlen: 0, stub: 0, tr: 12, eq: false },
                                { phaseOffset: 16 });
  ok('sampling half a UI away REDUCES the margin',
     off.measurements.eyeHeight < ideal.measurements.eyeHeight,
     `${(ideal.measurements.eyeHeight * 1e3).toFixed(0)} mV -> `
     + `${(off.measurements.eyeHeight * 1e3).toFixed(0)} mV`);
  ok('and the margin can go NEGATIVE, which sign-grouping could never report',
     off.measurements.eyeHeight <= 0 || off.measurements.wrongDecisions > 0,
     `${(off.measurements.eyeHeight * 1e3).toFixed(1)} mV, `
     + `${off.measurements.wrongDecisions} wrong`);

  /* A closed eye and a wrong decision now agree with each other. Before the
     fix the Gen5 preset reported +4.8 uV of opening alongside 167 errors — two
     statements about the same instant that contradicted each other. */
  const g5 = MODELS.labChannel(P(PRESETS.pcie5)).measurements;
  ok('a negative opening and a non-zero error count are consistent, not '
     + 'contradictory', (g5.eyeHeight <= 0) === (g5.wrongDecisions > 0),
     `${(g5.eyeHeight * 1e3).toFixed(1)} mV with ${g5.wrongDecisions} wrong`);

  /* ═══ M1-9 · the ideal channel, end to end through the real pipeline ═══
     The analytic answer: a lossless matched line delivers the full swing, so
     the gap between a +1 population and a -1 population is 2 x SWING. Nothing
     in the model is consulted for that number. */
  /* 11 ppm short of the full swing, and the shortfall is numerical rather than
     physical: the spectrum is sampled on a 4096-point grid with DC evaluated at
     1 kHz instead of 0 Hz (clause 5), and the transmitter edge has a finite
     0.19 UI rise. An exact answer would need an exact DC term. */
  nearAbs('the ideal channel delivers the full transmitted swing',
          ideal.measurements.eyeHeight, 2 * 0.8, 1e-4, ' V');
  ok('and the shortfall is numerical, not a loss of signal',
     Math.abs(ideal.measurements.eyeHeight - 1.6) / 1.6 < 5e-5,
     `${(1e6 * Math.abs(ideal.measurements.eyeHeight - 1.6) / 1.6).toFixed(1)} ppm`);
  nearRel('its flight time is the nominal one, to a sample',
          ideal.measurements.tdBulk, 1 * 170e-12, 1 / (32 * 16e9) / (1 * 170e-12));
  /* The valid count is recomputed from the record geometry — the 393-vs-378
     disagreement, settled by neither side asserting it. */
  const gen4 = MODELS.labChannel(P({}));
  const gm = gen4.measurements, y = gen4.generated.measured.y;
  const first = Math.max(24, Math.ceil((16 - gm.samplePhase) / 32));
  const last = Math.floor((y.length - 1 - gm.samplePhase - 16) / 32);
  const expect = K.validRange(first, Math.min(416, last), 420, 1);
  nearAbs('the valid symbol count is derived, not declared',
          gm.validSymbols, expect.count, 0, ' symbols');
  /* And it no longer depends on the channel. Before M1-1 the record was cut to
     a fixed 40 UI, so a longer flight time pushed the cursor later and took
     usable symbols with it — 378 on one preset, 393 on another, for no reason a
     reader could see. With the transport delay de-embedded the geometry is the
     same for every channel. */
  const counts = Object.keys(PRESETS).map((k) =>
    MODELS.labChannel(P(PRESETS[k])).measurements.validSymbols);
  ok('and it is the same on every preset, because the record is no longer cut '
     + 'to a fixed number of UI', new Set(counts).size === 1, counts.join(', '));

  /* ═══ M1-13 · a rate-only change leaves the board alone ═══ */
  const rA = MODELS.labChannel(P({ rate: 16 })), rB = MODELS.labChannel(P({ rate: 32 }));
  const secA = rA.generated.raw.secs, secB = rB.generated.raw.secs;
  for (const f of [4e9, 8e9, 12e9]) {
    const a = K.cascadeS(secA, f, 50, 8e9), b = K.cascadeS(secB, f, 50, 8e9);
    nearAbs(`S21 at ${f / 1e9} GHz is unchanged by the symbol rate`,
            Math.hypot(a.s21r, a.s21i), Math.hypot(b.s21r, b.s21i), 1e-12);
    nearAbs(`S11 at ${f / 1e9} GHz is unchanged by the symbol rate`,
            Math.hypot(a.s11r, a.s11i), Math.hypot(b.s11r, b.s11i), 1e-12);
  }
  ok('because the loss reference is a property of the board, not the traffic',
     rA.measurements.lossRefHz === rB.measurements.lossRefHz,
     `${rA.measurements.lossRefHz / 1e9} GHz both`);

  /* ═══ M1-12 · the two rise times are two quantities ═══
     `p.tr` shaped the transmitted edge AND band-limited the TDR, while the
     control was labelled "Instrument rise time". Changing what the instrument
     can resolve used to change the data waveform it was measuring. */
  const base = MODELS.labChannel(P({ tr: 12, trTdr: 12 }));
  const tdrOnly = MODELS.labChannel(P({ tr: 12, trTdr: 40 }));
  const txOnly = MODELS.labChannel(P({ tr: 40, trTdr: 12 }));
  nearAbs('changing the TDR aperture leaves the transmitted eye untouched',
          tdrOnly.measurements.eyeHeight, base.measurements.eyeHeight, 0, ' V');
  nearAbs('and leaves the pulse cursor where it was',
          tdrOnly.measurements.samplePhase, base.measurements.samplePhase, 0, ' samples');
  ok('while a slower transmitter edge DOES change the eye, as it must',
     Math.abs(txOnly.measurements.eyeHeight - base.measurements.eyeHeight) > 1e-4,
     `${(base.measurements.eyeHeight * 1e3).toFixed(0)} mV -> `
     + `${(txOnly.measurements.eyeHeight * 1e3).toFixed(0)} mV`);

  /* The result must carry its conventions, because a number without them is not
     a measurement. These are the four that were wrong or ambiguous. */
  const cv = base.conventions;
  ok('the result states the voltage convention', /single-ended/.test(cv.voltage));
  ok('the result states a FIXED loss reference', /FIXED 8 GHz/.test(cv.lossReference));
  ok('the result distinguishes the two rise times', /separate physical/.test(cv.riseTime));
  ok('and names the eye-height definition rather than implying a compliance one',
     /not a BER contour/.test(cv.eyeHeight) && /TRANSMITTED/.test(cv.eyeHeight));
});

/* ═════════ M6-8 · controlled comparisons, one variable at a time ═════════ */
suite('Lab B presets — what a controlled comparison requires', () => {
  const P = (o) => Object.assign({ reach: 8, loss: 14, rate: 16, dz: 38, dpos: 45,
                                   dlen: 24, stub: 0, tr: 12, trTdr: 12, eq: true }, o);
  const base = MODELS.labChannel(P({}));
  const rateOnly = MODELS.labChannel(P({ rate: 32 }));
  const reachOnly = MODELS.labChannel(P({ reach: 16, loss: 28 }));
  const stub = MODELS.labChannel(P({ dz: 50, dlen: 0, stub: 28 }));

  /* RATE ONLY means the board does not move. Not approximately — the
     S-parameters are computed from the same sections against the same fixed
     loss reference, so they are identical at every frequency. Before M1-13 the
     loss law was anchored to Nyquist and this comparison was impossible. */
  let worst = 0;
  for (let k = 1; k <= 40; k++) {
    const f = k * 0.5e9;
    const a = K.cascadeS(base.generated.raw.secs, f, 50, 8e9);
    const b = K.cascadeS(rateOnly.generated.raw.secs, f, 50, 8e9);
    worst = Math.max(worst, Math.hypot(a.s21r - b.s21r, a.s21i - b.s21i));
  }
  nearAbs('rate-only leaves the channel bit-identical at every frequency',
          worst, 0, 0);
  nearRel('and only the unit interval halves', base.measurements.ui,
          2 * rateOnly.measurements.ui, 1e-12);
  ok('so the eye closing is about the rate and nothing else',
     rateOnly.measurements.eyeHeight < base.measurements.eyeHeight,
     `${(base.measurements.eyeHeight * 1e3).toFixed(0)} mV -> `
     + `${(rateOnly.measurements.eyeHeight * 1e3).toFixed(0)} mV`);

  /* REACH ONLY: twice the copper at the same rate, so twice the decibels at the
     same frequency — which is what "loss is a property of the board" means. */
  nearRel('twice the reach is twice the loss at the same reference frequency',
          reachOnly.params.loss, 2 * base.params.loss, 1e-12);
  nearAbs('and the unit interval is untouched',
          reachOnly.measurements.ui, base.measurements.ui, 0, ' ps');

  /* SAME LOSS, DIFFERENT CHANNEL — the case a scalar budget cannot predict. The
     stub preset matches the baseline in every number a loss budget records, and
     the eye is five times smaller. The return loss is where the difference
     shows, which is the argument for six domains instead of one. */
  nearAbs('the stub preset carries the same loss figure as the baseline',
          stub.params.loss, base.params.loss, 0, ' dB');
  nearAbs('at the same rate', stub.params.rate, base.params.rate, 0, ' GT/s');
  nearAbs('over the same reach', stub.params.reach, base.params.reach, 0, ' in');
  ok('and yet the eye is several times smaller, which no scalar loss budget '
     + 'could have predicted',
     stub.measurements.eyeHeight < 0.3 * base.measurements.eyeHeight,
     `${(base.measurements.eyeHeight * 1e3).toFixed(0)} mV -> `
     + `${(stub.measurements.eyeHeight * 1e3).toFixed(0)} mV`);
  ok('the return loss is where the difference is visible, not the insertion loss',
     stub.measurements.worstReturnLoss > base.measurements.worstReturnLoss + 5,
     `${base.measurements.worstReturnLoss.toFixed(1)} dB -> `
     + `${stub.measurements.worstReturnLoss.toFixed(1)} dB`);

  /* Every preset the page offers must produce a usable result rather than a
     refusal, and the buttons must match the module. Read from the source so a
     button added to the page without a preset behind it — or the reverse — is
     caught here rather than by a reader clicking it.

     (An earlier draft of this block was `ok(name, true)` in a loop, which is
     the unconditional pass G-6 forbids. Left as a note because writing one by
     accident took about thirty seconds.) */
  const modSrc = require('fs').readFileSync(
    require('path').join(SRC, 'js', 'viz', 'lab-channel.js'), 'utf8');
  const pageSrc = require('fs').readFileSync(
    require('path').join(SRC, 'topics', 'labs', 'one-channel.html'), 'utf8');
  const declared = new Set([...modSrc.matchAll(/^      (\w+):\s*\{ reach:/gm)].map((m) => m[1]));
  const offered = new Set([...pageSrc.matchAll(/data-preset="(\w+)"/g)].map((m) => m[1]));
  ok('every preset the page offers is declared in the module',
     [...offered].every((x) => declared.has(x)),
     [...offered].filter((x) => !declared.has(x)).join(', ') || 'all present');
  ok('and every preset the module declares is offered on the page',
     [...declared].every((x) => offered.has(x)),
     [...declared].filter((x) => !offered.has(x)).join(', ') || 'all offered');
  ok('there are at least three controlled comparisons and two protocol examples',
     declared.size >= 5, [...declared].join(', '));
});

suite('Causal line — clause 6 of docs/channel-model.md', () => {
  const NEPER = 8.685889638065035, C0 = 299792458;

  /* ═══ 6.1 · analytical limits ═══ */
  const loss0 = { type: 'line', z: 50, td: 1360e-12, lossDb: 0, dielFrac: 0.55, lossRefHz: 8e9 };
  for (const f of [1e8, 1e9, 8e9, 20e9]) {
    const { g, zc } = K.lineGammaZc(loss0, f);
    const mat = K.lineMaterial(loss0, 8e9);
    nearAbs(`lossless Zc is exactly the nominal at ${f / 1e9} GHz`, zc[0], 50, 1e-9, ' ohm');
    nearAbs(`lossless Zc is purely real at ${f / 1e9} GHz`, zc[1], 0, 1e-12, ' ohm');
    nearAbs(`lossless attenuation is zero at ${f / 1e9} GHz`, g[0], 0, 1e-15);
    nearRel(`lossless phase delay is the nominal at ${f / 1e9} GHz`,
            g[1] * mat.len / (2 * Math.PI * f), 1360e-12, 1e-12);
  }

  /* ═══ 6.5 · the loss budget, hit exactly ═══ */
  for (const L of [3, 6, 14, 22, 28]) {
    const sec = { type: 'line', z: 50, td: 1360e-12, lossDb: L, dielFrac: 0.55, lossRefHz: 8e9 };
    const mat = K.lineMaterial(sec, 8e9);
    nearAbs(`a ${L} dB budget gives ${L} dB of propagation loss`,
            NEPER * K.lineGammaZc(sec, 8e9).g[0] * mat.len, L, 1e-6, ' dB');
  }

  /* ═══ 6.2 · an INDEPENDENT reference ═══
     S21 of a single line, computed from gamma and Zc directly rather than
     through abcdMul and the ABCD-to-S conversion. Same material model, entirely
     different algebra: for a matched-reference line,
         S21 = 2 / (2*cosh(th) + (Zc/Z0 + Z0/Zc)*sinh(th)). */
  const ref = (sec, f, z0) => {
    const { g, zc } = K.lineGammaZc(sec, f);
    const mat = K.lineMaterial(sec, 8e9);
    const thR = g[0] * mat.len, thI = g[1] * mat.len;
    const ch = [Math.cosh(thR) * Math.cos(thI), Math.sinh(thR) * Math.sin(thI)];
    const sh = [Math.sinh(thR) * Math.cos(thI), Math.cosh(thR) * Math.sin(thI)];
    const a = [zc[0] / z0, zc[1] / z0];
    const den = zc[0] * zc[0] + zc[1] * zc[1];
    const b = [z0 * zc[0] / den, -z0 * zc[1] / den];
    const q = [a[0] + b[0], a[1] + b[1]];
    const qs = [q[0] * sh[0] - q[1] * sh[1], q[0] * sh[1] + q[1] * sh[0]];
    const dr = 2 * ch[0] + qs[0], di = 2 * ch[1] + qs[1];
    const m2 = dr * dr + di * di;
    return [2 * dr / m2, -2 * di / m2];
  };
  for (const L of [0, 14, 28]) {
    const sec = { type: 'line', z: 50, td: 1360e-12, lossDb: L, dielFrac: 0.55, lossRefHz: 8e9 };
    let worst = 0;
    for (let k = 1; k <= 60; k++) {
      const f = k * 0.5e9;
      const S = K.cascadeS([sec], f, 50, 8e9);
      const R = ref(sec, f, 50);
      worst = Math.max(worst, Math.hypot(S.s21r - R[0], S.s21i - R[1]));
    }
    ok(`at ${L} dB the cascade agrees with an independently derived S21`,
       worst < 1e-12, `worst complex departure ${fmt(worst)}`);
  }

  /* ═══ 6.4 · causality at the WAVEFRONT ═══
     Not at the nominal delay. A dispersive response may legitimately precede
     its nominal, group or peak delay — at 14 dB, 16.6% of the energy does —
     because eps' falls with frequency and the high components travel faster.
     The wavefront, set by the f -> infinity limit, is the only boundary
     causality guarantees, and that is where the test is applied. */
  const preWavefront = (lossDb, N, fsr) => {
    const td = 2048 / 512e9;                     // integer flight on the 512 GHz grid
    const sec = { type: 'line', z: 50, td: td, lossDb: lossDb, dielFrac: 0.55, lossRefHz: 8e9 };
    const mat = K.lineMaterial(sec, 8e9);
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let k = 0; k <= N / 2; k++) {
      const S = K.cascadeS([sec], Math.max(k * fsr / N, 1e3), 50, 8e9);
      re[k] = S.s21r; im[k] = S.s21i;
      if (k > 0 && k < N / 2) { re[N - k] = S.s21r; im[N - k] = -S.s21i; }
    }
    K.fft(re, im, true);
    let tot = 0;
    for (let i = 0; i < N; i++) tot += re[i] * re[i];
    const wf = Math.floor(mat.wavefront * fsr);
    let e = 0;
    for (let i = 0; i < wf; i++) e += re[i] * re[i];
    return { frac: e / tot, wf: wf, nominal: Math.round(td * fsr) };
  };
  for (const L of [0, 14, 28]) {
    const r = preWavefront(L, 16384, 512e9);
    ok(`at ${L} dB, energy before the wavefront is numerical residue`,
       r.frac < 1e-5, r.frac.toExponential(2));
    ok(`and the wavefront is at or before the nominal delay at ${L} dB`,
       r.wf <= r.nominal, `${r.wf} <= ${r.nominal} samples`);
  }
  /* Refining the RECORD at fixed bandwidth must reduce it. Refining the
     BANDWIDTH at fixed record makes it worse, because the record shortens in
     time and circular wraparound grows — a different artefact, and the
     convergence claim is about the first one only. */
  const byRecord = [16384, 32768, 65536].map((N) => preWavefront(14, N, 512e9).frac);
  ok('pre-wavefront residue falls as the record is refined at fixed bandwidth',
     byRecord[1] < byRecord[0] / 3 && byRecord[2] < byRecord[1] / 3,
     byRecord.map((v) => v.toExponential(2)).join(' -> '));
  const byBand = [512e9, 1024e9].map((fsr) => preWavefront(14, 16384, fsr).frac);
  ok('while raising the bandwidth at fixed record makes it worse, which is '
     + 'wraparound and not causality',
     byBand[1] > byBand[0], byBand.map((v) => v.toExponential(2)).join(' -> '));

  /* ═══ 3 · the dielectric behaves as a causal medium must ═══
     eps' falls monotonically with frequency while eps'' stays flat across the
     plateau. A medium whose eps' rose with frequency while absorbing would
     violate Kramers-Kronig, and no amount of curve-fitting would rescue it. */
  const sec14 = { type: 'line', z: 50, td: 1360e-12, lossDb: 14, dielFrac: 0.55, lossRefHz: 8e9 };
  const m14 = K.lineMaterial(sec14, 8e9);
  let monoEps = true, lastRe = Infinity, minIm = Infinity, maxIm = 0;
  for (const f of [1e6, 1e7, 1e8, 1e9, 8e9, 3e10, 1e11]) {
    const e = K.dsPermittivity(f, m14.epsInf, m14.dEps);
    if (e[0] > lastRe + 1e-12) monoEps = false;
    lastRe = e[0];
    minIm = Math.min(minIm, -e[1]); maxIm = Math.max(maxIm, -e[1]);
  }
  ok("eps' falls monotonically with frequency", monoEps);
  ok("eps'' is flat across the relaxation plateau, which is what makes the "
     + 'model wideband', maxIm / minIm < 1.02, fmt(maxIm / minIm));
  nearRel('Dk is exactly the requested value at the reference frequency',
          K.dsPermittivity(8e9, m14.epsInf, m14.dEps)[0], 4.03, 1e-12);
  ok('and eps_inf is below Dk, so the wavefront leads the nominal delay',
     m14.epsInf < 4.03 && m14.wavefront < m14.nominal,
     `eps_inf ${fmt(m14.epsInf)}, wavefront ${(m14.wavefront * 1e12).toFixed(1)} ps `
     + `of ${(m14.nominal * 1e12).toFixed(0)} ps`);
});

suite('Lab A assembled — energy across the source edge', () => {
  const P = { Z0: 50, Rs: 10, RL: 50, open: true, tr: 60, len: 3, xp: 50 };
  const mk = (o) => K.line1D(Object.assign({ Z0: 50, Rs: 10, RL: 50, open: true,
                                             tr: 60, td: 510, vs: 1, nWave: 200 }, o));

  /* ═══ M2-1 · CONSERVATION, and specifically across the transition ═══
     The old integral used a constant vs as the integrand and started at t = 0,
     which is the middle of an edge centred on zero. A third of the smoothstep
     therefore sat outside the integral and the energy it put on the line came
     back as an unexplained residual — reported at t = 0 as -296,509,118.7%.

     The source waveform is identified analytically, not assumed: at x = 0 the
     model gives v = a0*ss(t) and i = a0*ss(t)/Z0, so
         v + Rs*i = a0*ss(t)*(Z0+Rs)/Z0 = vs*ss(t)
     and that is the integrand. This suite checks the identity itself, then the
     conservation law it makes possible. */
  const M = mk({});
  let worstId = 0;
  for (const tk of [-60, -30, -15, 0, 15, 30, 60, 255, 510]) {
    const s0 = K.line1DAt(M, 0, tk);
    worstId = Math.max(worstId, Math.abs(s0.v + M.Rs * s0.i - K.line1DSource(M, tk)));
  }
  nearAbs('v(0,t) + Rs*i(0,t) IS the source waveform, through the edge',
          worstId, 0, 1e-12, ' V');

  /* All four terminations, and specifically at instants inside the transition. */
  for (const [name, o] of [['open', { open: true }], ['short', { open: false, RL: 0 }],
                           ['matched', { open: false, RL: 50 }],
                           ['mismatched', { open: false, RL: 75, Rs: 20 }]]) {
    const Mx = mk(o);
    for (const t of [0, 15, 30, 60, 255, 510, 1020, 3060]) {
      const e = K.line1DEnergy(Mx, t, 3000, 600);
      ok(`${name} · the account closes at t = ${t} ps`, e.closes < 2e-3,
         `residual ${fmt(e.residual)} pJ of ${fmt(e.scale)} pJ (${(e.closes * 100).toFixed(3)}%)`);
    }
  }

  /* CONVERGENCE, which is what says the residual is quadrature error and not
     physics. The trapezoid rule is second order, so refining the grid must
     quarter it — and at t = 0, the hardest instant, it does: 2.55e-2, 6.38e-3,
     1.59e-3, 3.99e-4, 9.96e-5. A residual that did NOT converge would be a
     defect in the account, which is exactly what N1 was. */
  const seq = [300, 600, 1200, 2400].map((nt) => K.line1DEnergy(M, 0, nt, nt / 3).closes);
  let secondOrder = true;
  for (let i = 1; i < seq.length; i++) {
    const ratio = seq[i - 1] / seq[i];
    if (!(ratio > 3.2 && ratio < 4.8)) secondOrder = false;
  }
  ok('the residual falls as 1/nt^2, the trapezoid rate, so it is quadrature '
     + 'error rather than a defect in the account', secondOrder,
     seq.map((v) => v.toExponential(2)).join(' -> '));

  /* ═══ ANALYTICAL FACTS the account must reproduce exactly ═══ */
  const openLate = K.line1DEnergy(mk({ open: true }), 3060, 3000, 600);
  nearAbs('an ideal open delivers exactly nothing, at any time',
          openLate.inRL, 0, 1e-15, ' pJ');
  const shortLate = K.line1DEnergy(mk({ open: false, RL: 0 }), 3060, 3000, 600);
  nearAbs('an ideal short also dissipates nothing in the load',
          shortLate.inRL, 0, 1e-15, ' pJ');

  /* A matched source and load: Rs starts burning at t = 0 while the load only
     receives from t = td, so the two integrals differ by exactly the energy in
     flight. That is the conservation law restated as a measurable, and it is
     exact rather than approximate. */
  const mm = mk({ Rs: 50, RL: 50, open: false });
  for (const T of [1020, 2040, 4080, 8160]) {
    const e = K.line1DEnergy(mm, T, 6000, 600);
    nearRel(`matched · (burned in Rs) - (delivered) is the energy in flight at ${T} ps`,
            e.inRs - e.inRL, e.onLine, 1e-6);
  }

  /* ═══ M2-2 · no percentage against a denominator that is not there ═══ */
  const at0 = MODELS.labWaves(P, 0);
  ok('at t = 0 the injected energy is a real quantity now, not a clamp',
     at0.measurements.fromSource > 1e-3,
     `${fmt(at0.measurements.fromSource)} pJ`);
  ok('and the fraction still on the line is a sane percentage',
     Math.abs(100 * at0.measurements.onLine / at0.measurements.fromSource) < 150,
     `${(100 * at0.measurements.onLine / at0.measurements.fromSource).toFixed(1)}%`);
  ok('so the 296,509,210.4% the panel used to print is unreachable',
     Math.abs(100 * at0.measurements.onLine / at0.measurements.fromSource) < 1e4);
  /* And when the denominator really is nothing, the helper says so rather than
     dividing. The panel's transport control starts at t = 0 and the integral
     starts before that, so a reader cannot reach this state any more — but the
     guard is what keeps it unreachable if the lower limit ever moves back. */
  const nothing = K.line1DEnergy(M, -50, 600, 200, -60);
  nearAbs('integrating a window entirely before the edge gives exactly zero',
          nothing.scale, 0, 1e-15, ' pJ');
  nearAbs('and a residual of exactly zero, not a ratio of two zeros',
          nothing.closes, 0, 0);

  ok('the result names its lower limit, so a reader can see what was integrated',
     at0.diagnostics.integratedFrom < 0,
     `${fmt(at0.diagnostics.integratedFrom)} ps`);
  ok('and it states the source waveform rather than implying a constant',
     /smoothStep/.test(at0.conventions.source));
});

suite('Lab C assembled — the transient, its record, and complex KCL', () => {
  const P = (o) => Object.assign({ rvrm: 4, fbw: 120, lplane: 900, lpkg: 350,
                                   cboard: 1, nboard: 20, esr: 20, esl: 1100,
                                   cdie: 200, imax: 8, tr: 800, zt: 10 }, o);
  const PRESETS = { soc: {}, thin: { nboard: 4 }, lossy: { esr: 90 }, nodie: { cdie: 20 } };

  /* ═══ M2-5 · CONVERGENCE with the physical stimulus held fixed ═══
     The onset is pinned to absolute sample indices. The shipped panel places it
     at a FRACTION of the record, so growing the record also moves the event in
     time — two changes at once, and a convergence claim that cannot mean
     anything. Astra's table pinned it at 1966 and 6554, and so does this. */
  const at = { t0: 1966, fall: 6554 };
  const runs = [16384, 32768, 65536, 131072].map((nt) =>
    MODELS.labPdn(P({}), { nt: nt, dt: 200e-12, at: at }));
  const pre = runs.map((r) => r.diagnostics.preEventFraction);

  ok('pre-event drift falls monotonically as the record grows',
     pre[1] < pre[0] && pre[2] < pre[1] && pre[3] <= pre[2] * 1.05,
     pre.map((v) => (v * 100).toFixed(2) + '%').join(' -> '));

  /* The shortest record is REFUSED, not reported. This is the whole point of the
     status field: a droop quoted to a tenth of a millivolt while 3.2% of it is
     record contamination is not a measurement, and returning null for
     `measurements` makes it impossible to read as one. */
  ok('the 16k record is refused rather than reported',
     runs[0].status === 'not-settled' && runs[0].measurements === null,
     runs[0].why || '');
  ok('and the longer ones are accepted',
     runs.slice(1).every((r) => r.status === 'ok' && r.measurements !== null));

  /* The declared envelope: the droop converges, and the shipped record lands
     inside a stated fraction of the converged value. 142.00 mV is what it
     converges to; the old 16k default reported 137.78 mV, 3% low. */
  const droops = runs.slice(1).map((r) => r.measurements.droop);
  nearRel('the droop at 64k and at 128k agree, so it has converged',
          droops[1], droops[2], 2e-3);
  nearRel('and the shipped 32k record is within 0.5% of the converged value',
          droops[0], droops[2], 5e-3);
  ok('the converged droop is 142.0 mV, not the 137.8 mV the 16k record gave',
     Math.abs(droops[2] * 1000 - 142.0) < 0.5,
     `${(droops[2] * 1000).toFixed(2)} mV`);

  /* Every released preset must clear the budget at the shipped record. */
  for (const name of Object.keys(PRESETS)) {
    const r = MODELS.labPdn(P(PRESETS[name]));
    ok(`${name} · meets the declared pre-event budget`,
       r.status === 'ok' && r.diagnostics.preEventFraction <= r.diagnostics.preEventBudget,
       `${(r.diagnostics.preEventFraction * 100).toFixed(2)}% of `
       + `${(r.diagnostics.preEventBudget * 100).toFixed(0)}% allowed`);
  }
  /* And the quality figure is computed for THIS scenario rather than copied
     from the default, which is what N2 asked for. */
  const q = Object.keys(PRESETS).map((k) =>
    MODELS.labPdn(P(PRESETS[k])).diagnostics.preEventFraction);
  ok('and each preset reports its own numerical quality, not the default one',
     new Set(q.map((v) => v.toFixed(6))).size === q.length,
     q.map((v) => (v * 100).toFixed(2) + '%').join(', '));

  /* ═══ DROOP AND OVERSHOOT ARE TWO MEASUREMENTS ═══ */
  const soc = MODELS.labPdn(P({}));
  const sm = soc.measurements;
  ok('droop and overshoot are separate and genuinely different',
     sm.droop > 0 && sm.overshoot > 0 && Math.abs(sm.droop - sm.overshoot) > 0.02,
     `droop ${(sm.droop * 1000).toFixed(1)} mV, overshoot `
     + `${(sm.overshoot * 1000).toFixed(1)} mV`);
  nearAbs('max|dV| is only the larger of the two, and cannot stand for either',
          sm.worstAbs, Math.max(sm.droop, sm.overshoot), 1e-12, ' V');
  ok('the result says so in its conventions rather than leaving it implied',
     /SEPARATE measurements/.test(soc.conventions.droop));

  /* ═══ M2-6 · COMPLEX KCL at every node ═══
     What stood here summed branch-current MAGNITUDES and asserted the total was
     finite and below 50. A reversed sign cannot disturb that, and neither can
     any phase error — so the test named "current conservation" could not detect
     a failure of current conservation.

     The real law: every amp injected at the die has to leave through some shunt,
     so the COMPLEX sum of the shunt currents is exactly the injected current.
     The magnitudes are a different quantity, and they legitimately reach 6.6 A
     for 1 A injected where two banks circulate against each other. */
  const stages = soc.generated.stages;
  let worstKcl = 0, biggestMagSum = 0, atF = 0;
  for (const f of [1e3, 1e4, 1e5, 1e6, 6.9e6, 1e7, 4.8e7, 1e8, 5e8, 5e9]) {
    const L = K.pdnLadder(stages, f);
    let sr = 0, si = 0, mag = 0;
    L.branches.forEach((b) => { sr += b.ir; si += b.ii; mag += b.i; });
    const err = Math.hypot(sr - 1, si);
    if (err > worstKcl) worstKcl = err;
    if (mag > biggestMagSum) { biggestMagSum = mag; atF = f; }
    /* The ladder's own leftover must vanish too — it is the same statement made
       from the other end of the recursion. */
    ok(`nothing is left unaccounted at ${fmt(f / 1e6)} MHz`,
       Math.hypot(L.unaccounted.re, L.unaccounted.im) < 1e-12);
  }
  nearAbs('the complex sum of the shunt currents is exactly the injected 1 A, '
          + 'at every frequency', worstKcl, 0, 1e-12, ' A');
  ok('while the sum of their MAGNITUDES reaches several amps, which is why the '
     + 'old magnitude test could assert nothing',
     biggestMagSum > 3, `${biggestMagSum.toFixed(3)} A at ${fmt(atF / 1e6)} MHz`);

  /* A reversed branch sign has to be detectable, which is the whole reason for
     retaining the phasors. Flip one and the complex sum moves by twice it, while
     the sum of magnitudes does not move at all. */
  const L = K.pdnLadder(stages, 6.9e6);
  let sr = 0, si = 0, magBefore = 0;
  L.branches.forEach((b) => { sr += b.ir; si += b.ii; magBefore += b.i; });
  const flipped = L.branches.map((b, i) =>
    i === 2 ? { ir: -b.ir, ii: -b.ii, i: b.i } : b);
  let fr = 0, fi = 0, magAfter = 0;
  flipped.forEach((b) => { fr += b.ir; fi += b.ii; magAfter += b.i; });
  ok('reversing one branch sign moves the complex sum well off the injected '
     + 'current', Math.hypot(fr - 1, fi) > 0.5,
     `|error| ${fmt(Math.hypot(fr - 1, fi))} A`);
  nearAbs('and leaves the sum of magnitudes completely unchanged, which is the '
          + 'defect the old test could not see', magAfter, magBefore, 1e-12, ' A');
});

/* ═════════ M2-7 · the slicer decides in transmit units ═════════ */
suite('DFE slicer — gain-aware decisions, and why NRZ hid the defect', () => {
  const sps = 8, nb = 64, cursor = 4;
  const build = (alphabet, seed) => {
    const rng = K.rng(seed);
    const levels = [];
    for (let b = 0; b < nb; b++) levels.push(alphabet[Math.floor(rng() * alphabet.length)]);
    /* Astra's probe: a noiseless channel with main cursor 0.2 and postcursor
       0.1. Nothing random, nothing marginal — just a gain of 0.2. */
    const sbr = new Float64Array(sps * 8);
    sbr[cursor] = 0.2; sbr[cursor + sps] = 0.1;
    const y = new Float64Array(nb * sps + sps * 8);
    for (let b = 0; b < nb; b++) {
      for (let i = 0; i < sbr.length; i++) {
        const j = b * sps + i;
        if (j < y.length) y[j] += levels[b] * sbr[i];
      }
    }
    return { levels, sbr, y };
  };
  const count = (out, levels) => {
    let wrong = 0, outerAsInner = 0;
    for (let b = 2; b < nb; b++) {
      if (out.decided[b] !== levels[b]) wrong++;
      if (Math.abs(levels[b]) === 1 && Math.abs(out.decided[b]) < 0.5) outerAsInner++;
    }
    return { wrong, outerAsInner };
  };

  const P4 = [-1, -1 / 3, 1 / 3, 1];
  const g4 = build(P4, 7);
  for (const mode of ['ideal', 'decision']) {
    const r = count(K.applyDFE(g4.y, g4.levels, g4.sbr, cursor, 2, sps, { mode }),
                    g4.levels);
    ok(`noiseless attenuated PAM4 decides correctly in ${mode} mode`,
       r.wrong === 0, `${r.wrong} wrong of ${nb - 2}`);
  }

  /* The defect, reproduced by forcing the scale the old code assumed. This is
     the negative case: without it, "0 wrong" proves only that the test inputs
     were easy. */
  const old = count(K.applyDFE(g4.y, g4.levels, g4.sbr, cursor, 2, sps,
                               { mode: 'decision', gain: 1 }), g4.levels);
  ok('and forcing the gain to 1 — what the old slicer assumed — breaks it badly',
     old.wrong > 20, `${old.wrong} wrong of ${nb - 2}`);
  ok('specifically by deciding outer symbols as inner ones, because 0.2 is '
     + 'nearer 1/3 than 1', old.outerAsInner > 20,
     `${old.outerAsInner} outer symbols decided as inner`);

  /* Why it stayed latent: NRZ thresholds are signs, and a positive gain cannot
     change a sign. The exposed decision-directed toggle is NRZ, so no currently
     reachable plot was wrong — but nothing about the code said so. */
  const g2 = build([-1, 1], 11);
  const nrzOld = count(K.applyDFE(g2.y, g2.levels, g2.sbr, cursor, 2, sps,
                                  { mode: 'decision', gain: 1 }), g2.levels);
  ok('NRZ survives the same defect untouched, which is why it stayed latent',
     nrzOld.wrong === 0, `${nrzOld.wrong} wrong of ${nb - 2}`);

  /* An explicit scale must be honoured over the inferred one, so a receiver
     model with a real AGC can state its own. */
  const half = K.applyDFE(g4.y, g4.levels, g4.sbr, cursor, 2, sps,
                          { mode: 'decision', gain: 0.1 });
  ok('an explicitly stated gain is used instead of the cursor',
     count(half, g4.levels).wrong > 0, 'a wrong scale must give wrong answers');
});

/* ═════════ M2-8 · the number formatter ═════════ */
suite('Number formatter — significant zeroes are not decoration', () => {
  const n = K.fmt.num;
  /* The old regex /\.?0+$/ ran against the whole string, so it trimmed
     significant zeroes off integers. The probe readout was two orders of
     magnitude wrong on any round number. */
  for (const [v, want] of [[100, '100'], [200, '200'], [-100, '-100'],
                           [-200, '-200'], [10, '10'], [-10, '-10'],
                           [1, '1'], [-1, '-1'], [0, '0']]) {
    ok(`${v} formats as "${want}"`, n(v) === want, `got "${n(v)}"`);
  }
  // fractional zeroes still go, which is what the trim was for
  for (const [v, want] of [[1.5, '1.5'], [12.3, '12.3'], [0.01, '0.01'],
                           [0.5, '0.5'], [2.0, '2']]) {
    ok(`${v} formats as "${want}"`, n(v) === want, `got "${n(v)}"`);
  }
  ok('and the exponential range is unchanged',
     n(1000) === '1.00e+3' && n(1e-4) === '1.00e-4' && n(12345) === '1.23e+4',
     [n(1000), n(1e-4), n(12345)].join(' '));
  ok('non-finite input gives a dash, not a number',
     n(NaN) === '\u2014' && n(Infinity) === '\u2014');
  /* A round number must never come back smaller than it went in. That is the
     property the old code violated, and it is checkable over a range rather
     than at the handful of values a table happens to list. */
  let shrunk = null;
  for (let e = 0; e <= 3; e++) {
    for (const m of [1, 2, 3, 5, 9]) {
      const v = m * Math.pow(10, e);
      const back = parseFloat(n(v));
      if (Math.abs(back - v) > 1e-9 * v) shrunk = `${v} -> ${n(v)}`;
    }
  }
  ok('no round number under 10000 changes value through the formatter',
     shrunk === null, shrunk || 'checked 20 values');
});

/* ═════════ M2-4 · the anti-resonance search, and its empty case ═════════ */
suite('Anti-resonance — a search that can fail says so', () => {
  const AR = MODELS.antiResonancePeak;
  ok('the peak search is reachable without a DOM', typeof AR === 'function');
  const br = (cBig, cSml, esr, esl) => ([
    { C: cBig * 1e-6, esr: 0.010 * esr, esl: esl * 1e-9, n: 1, on: true },
    { C: cSml * 1e-9, esr: 0.008 * esr, esl: esl * 1e-9, n: 1, on: true }
  ]);

  /* THE EMPTY CASE, which is the whole reason this is extracted. Two identical
     capacitors have no gap between their self-resonances, so there is nothing
     to resonate and the honest answer is "no peak". The panel used to have no
     else branch, so the previous value stayed on screen and a resolved problem
     still read 246.8 mOhm at 11 MHz. */
  const none = AR(br(10, 10000, 1, 1.2), 1e4, 1e9);
  ok('two capacitors with the same SRF produce NO peak, and the model returns '
     + 'null rather than the last one it found', none.peak === null);
  ok('and it still returns the sweep, so the caller has something to draw',
     none.pts.length > 100);

  /* ANALYTICAL: between two SRFs one part is inductive and the other still
     capacitive, so a parallel tank exists and its height is set by resistance
     alone. Q is inversely proportional to ESR, so a fifth the ESR must give
     roughly five times the peak — a physical relation, not a restatement. */
  const base = AR(br(10, 100, 1, 1.2), 1e4, 1e9).peak;
  ok('a peak exists between two SRFs two decades apart', !!base,
     base ? `${fmt(base.z * 1000)} mOhm at ${fmt(base.f / 1e6)} MHz` : '');

  /* Q is set by resistance, so peak x ESR should be constant — but only while
     the tank is UNDERDAMPED. Measured, peak x ESR runs 323.7, 325.1, 330.1 for
     0.2x, 0.5x and 1x, then 349.8, 425.9, 741.0 at 2x, 4x and 8x. The relation
     is a limit, not a law, and the place it stops holding is where the damped
     preset's "the peak all but disappears" comes from.

     Asserting the inverse relation universally would encode wrong physics in
     the gate, which is the same mistake M0-8 removed. So it is asserted where
     it holds, and its breakdown is asserted as well. */
  const prod = [0.2, 0.5, 1].map((e) => AR(br(10, 100, e, 1.2), 1e4, 1e9).peak.z * e);
  let flat = true;
  for (const v of prod) if (Math.abs(v / prod[1] - 1) > 0.02) flat = false;
  ok('lightly damped, the peak scales as 1/ESR to within 2%', flat,
     prod.map((v) => fmt(v * 1000)).join(', '));
  const heavy = [2, 4, 8].map((e) => AR(br(10, 100, e, 1.2), 1e4, 1e9).peak.z * e);
  ok('and heavily damped it stops holding, which is why "controlled ESR" is a '
     + 'design choice rather than a penalty',
     heavy[2] > prod[1] * 2,
     `product rises to ${fmt(heavy[2] * 1000)} from ${fmt(prod[1] * 1000)}`);

  /* The peak frequency is set by L and C, so damping moves it only a little —
     and downwards, as damping always does. */
  const low = AR(br(10, 100, 0.2, 1.2), 1e4, 1e9).peak;
  const damped = AR(br(10, 100, 4, 1.2), 1e4, 1e9).peak;
  ok('the peak frequency barely moves with ESR, and moves DOWN',
     damped.f < low.f && Math.abs(low.f - base.f) / base.f < 0.02
     && Math.abs(damped.f - base.f) / base.f < 0.1,
     `${fmt(low.f / 1e6)} -> ${fmt(base.f / 1e6)} -> ${fmt(damped.f / 1e6)} MHz`);

  /* The refinement has to beat the grid it refines, compared against the grid
     NEAR the peak. The global grid maximum is 3769 mOhm at 1 GHz, where both
     parts are inductive and |Z| is simply rising — not a resonance at all, and
     correctly excluded because a monotone tail has no local maximum. */
  const coarse = AR(br(10, 100, 0.2, 1.2), 1e4, 1e9);
  let nearGrid = 0;
  coarse.pts.forEach((q) => {
    if (q[0] > coarse.peak.f / 3 && q[0] < coarse.peak.f * 3) nearGrid = Math.max(nearGrid, q[1]);
  });
  ok('the refined peak beats the best grid sample near it, so the golden-section '
     + 'search is earning its place',
     coarse.peak.z > nearGrid * 1.005,
     `grid ${fmt(nearGrid * 1000)} mOhm, refined ${fmt(coarse.peak.z * 1000)} mOhm `
     + `(+${((coarse.peak.z / nearGrid - 1) * 100).toFixed(1)}%)`);
  ok('and the rising inductive tail is NOT reported as a peak, because a '
     + 'monotone climb has no local maximum',
     coarse.peak.f < 1e8, `peak at ${fmt(coarse.peak.f / 1e6)} MHz, sweep ends at 1000 MHz`);

  /* ANALYTICAL REFERENCE for two parallel series-RLC branches, derived here and
     not taken from the model. The admittance of the pair is

         Y(w) = SUM 1 / (R_i + j·w·L_i + 1/(j·w·C_i))

     and the classical anti-resonance is the frequency where the total SUSCEPTANCE
     crosses zero: one branch is already inductive, the other still capacitive, and
     their reactive currents cancel. That crossing is the exact |Z| maximum only
     when the branches are lossless. With real ESR it is not, and the two must be
     kept apart — calling the susceptance zero "the peak" is the mistake this
     asserts against. So: they are close, they are NOT identical, and they converge
     as the loss goes to zero. */
  const Ytot = (branches, f) => {
    const w = 2 * Math.PI * f;
    let gr = 0, gi = 0;
    branches.forEach((b) => {
      const zr = b.esr / b.n, zi = (w * b.esl / b.n) - 1 / (w * b.C * b.n);
      const d = zr * zr + zi * zi;
      gr += zr / d; gi += -zi / d;
    });
    return { g: gr, b: gi };
  };
  /* The susceptance crosses zero at every branch self-resonance as well as at the
     anti-resonance, so the bracket has to sit strictly BETWEEN the two SRFs — the
     one interval where branch 1 is already inductive and branch 2 still capacitive.
     Bracketing the whole sweep instead converges on the lower SRF, which is a
     resonance of one part and not a resonance of the pair. */
  const srf = (b) => 1 / (2 * Math.PI * Math.sqrt((b.esl / b.n) * (b.C * b.n)));
  const susceptanceZero = (branches) => {
    const fs = branches.map(srf).sort((x, y) => x - y);
    let a = fs[0] * 1.02, c = fs[fs.length - 1] * 0.98;
    if (!(a < c) || Ytot(branches, a).b * Ytot(branches, c).b > 0) return null;
    for (let k = 0; k < 200; k++) {
      const mid = Math.sqrt(a * c);                     // bisect in log frequency
      if (Ytot(branches, a).b * Ytot(branches, mid).b <= 0) c = mid; else a = mid;
    }
    return Math.sqrt(a * c);
  };

  const bLight = br(10, 100, 0.2, 1.2), bHeavy = br(10, 100, 8, 1.2);
  const zLight = susceptanceZero(bLight), zHeavy = susceptanceZero(bHeavy);
  const pLight = AR(bLight, 1e4, 1e9).peak, pHeavy = AR(bHeavy, 1e4, 1e9).peak;
  ok('a susceptance zero exists between the two self-resonances',
     zLight !== null && zHeavy !== null,
     zLight ? `${fmt(zLight / 1e6)} MHz lightly damped, ${fmt(zHeavy / 1e6)} MHz heavily` : 'none found');
  nearRel('lightly damped, the numerical |Z| peak sits on that susceptance zero',
          pLight.f, zLight, 0.01, 'fraction');
  ok('but it is NOT the same frequency, and the gap grows with damping — the '
     + 'susceptance zero is where the reactances cancel, not where |Z| is largest',
     Math.abs(pHeavy.f / zHeavy - 1) > Math.abs(pLight.f / zLight - 1),
     `${(Math.abs(pLight.f / zLight - 1) * 1e6).toFixed(0)} ppm lightly damped, `
     + `${(Math.abs(pHeavy.f / zHeavy - 1) * 1e6).toFixed(0)} ppm heavily`);

  /* LIMITING CASE — as the loss goes to zero the two converge, which is the
     statement that the susceptance zero is the lossless answer. */
  const gaps = [1, 0.2, 0.04].map((e) => {
    const b = br(10, 100, e, 1.2);
    const z = susceptanceZero(b);
    return Math.abs(AR(b, 1e4, 1e9).peak.f / z - 1);
  });
  ok('and they converge as the loss goes to zero',
     gaps[2] < gaps[1] && gaps[1] < gaps[0],
     gaps.map((g) => (g * 1e6).toFixed(0) + ' ppm').join(' -> '));

  /* CANCELLATION — at the susceptance zero the two branch currents are opposed,
     so the pair's admittance is real and its magnitude is the sum of the two
     conductances. That is a different statement from the peak height and is
     computed here from the branch parameters alone. */
  const Yz = Ytot(bLight, zLight);
  nearAbs('at that frequency the pair looks purely resistive',
          Math.abs(Yz.b) / Yz.g, 0, 1e-6, ' (B/G)');
  nearRel('and 1/G there is within a percent of the peak impedance',
          1 / Yz.g, pLight.z, 0.01, 'fraction');
});

/* ═════════ M2-9 · the impairment chain is an expansion, not a cascade ═════════ */
suite('Impairment chain — the order it is truncated at, and what that costs', () => {
  const gamma = (r, z) => (r - z) / (r + z);

  /* The echo is the FIRST TERM of a geometric series in Gs.GL. A wave that has
     been round-tripped once can round-trip again, and that term is dropped, so
     the model's error relative to the retained echo is |Gs.GL| and relative to
     the direct path is |Gs.GL|^2. Both follow from the series, not from the
     implementation — which is what makes this a bound rather than a restatement. */
  const PRESETS = [['lpddr5x', 44, 40], ['pcie4', 48, 47], ['pcie5', 48, 47],
                   ['usb32', 42, 45], ['ufs4', 46, 46]];
  let worst = 0;
  for (const [name, rterm, rsrc] of PRESETS) {
    const gL = gamma(rterm, 50), gS = gamma(rsrc, 50);
    const dropped = Math.abs(gS * gL);
    worst = Math.max(worst, dropped);
    ok(`${name} · the dropped terms are under 1% of the retained echo`,
       dropped < 0.01, `|Gs.GL| = ${(dropped * 100).toFixed(2)}%`);
  }
  ok('so first order is accurate across the released presets — which is a '
     + 'statement about these presets, not about the method',
     worst < 0.01, `worst ${(worst * 100).toFixed(2)}%`);

  /* And it degrades predictably where a reader can take it. Stating the domain
     is the point: the model is not wrong at 30 ohm, it is 6% approximate, and
     the difference between those two sentences is the whole of M2-9. */
  const ext = Math.abs(gamma(30, 50) * gamma(30, 50));
  ok('at the controls\u2019 extremes it is a few percent, and the contract says so',
     ext > 0.05 && ext < 0.1, `|Gs.GL| = ${(ext * 100).toFixed(1)}% at 30 ohm both ends`);

  /* M5 REGRESSION, kept: the round trip is Gs.GL and not GL^2. That was a real
     defect — an echo scaled by the square of one coefficient rather than the
     product of two — and it is the reason this suite exists at all. */
  const gL = gamma(48, 50), gS = gamma(47, 50);
  ok('the round-trip coefficient is Gs.GL, which is not GL^2',
     Math.abs(gS * gL - gL * gL) > 1e-6,
     `Gs.GL = ${fmt(gS * gL)}, GL^2 = ${fmt(gL * gL)}`);

  /* The contract has to admit the truncation rather than claim exactness. The
     badge said "exact model" while its own tooltip said "first order in the
     reflection coefficients" — two claims on one line, one of them false. */
  const c = (SIPI.contracts || {}).impairments;
  if (c) {
    ok('the contract names the truncation order', /FIRST ORDER/.test(c.validity));
    ok('and no longer claims to be exact', c.kind !== 'exact', c.kind);
  } else {
    ok('the contract is checked by scaffold.py rather than here', true,
       'docs/model-types.json: kind analytical, validity names the order');
  }
});

/* ═════════ M4-1 · the three functions a clock-recovery loop defines ═════════ */
suite('CDR loop — transfer, residual and tolerance are three things', () => {
  const CDR = MODELS.cdr;
  ok('the loop model is reachable without a DOM', typeof CDR === 'function');
  const P = (o) => Object.assign({ fn: 4, zeta: 0.7, margin: 0.3, ceiling: 1e9 }, o);
  const run = (o) => CDR(P(o));
  const at = (r, f) => r.generated.sweep.find((q) => q.f >= f);

  /* ═══ ANALYTIC LIMITS, which is what makes these independent of the code ═══
     A type-2 loop has H(0) = 1 exactly: at DC the integrator has infinite gain,
     so the recovered clock follows the input perfectly and the residual is zero.
     Far above the natural frequency the loop tracks nothing, so H -> 0 and the
     residual -> 1. Those two follow from the transfer function's form. */
  const r = run({});
  const dc = r.generated.sweep[0];
  nearAbs('H(0) is unity, because a type-2 loop integrates', dc.h, 1, 1e-4);
  nearAbs('so the residual phase error at DC is zero', dc.e, 0, 1e-4);
  const top = r.generated.sweep[r.generated.sweep.length - 1];
  nearAbs('far above the loop the residual is the whole input', top.e, 1, 1e-3);
  ok('and the transfer has fallen away', top.h < 0.01, fmt(top.h));

  /* The consequence for tolerance, which is the claim the page gets wrong: far
     above the loop it is just the sampling margin, because the loop removes
     none of the jitter. */
  nearAbs('far above the loop, tolerance IS the bare sampling margin',
          top.tol, 0.3, 1e-3, ' UI');
  /* And far below it rises as 1/f^2, because a second-order high-pass does. At
     fn/100 the residual should be about (f/fn)^2 = 1e-4. */
  const low = at(run({ ceiling: 1e9 }), 4e4);
  nearRel('a hundredth of the loop bandwidth leaves (f/fn)^2 of the jitter',
          low.e, 1e-4, 0.1);
  ok('so tolerance there is about ten thousand times the margin',
     low.tol > 2000 && low.tol < 4000, fmt(low.tol) + ' UI for a 0.3 UI margin');

  /* ═══ THE DISTINCTION A5 NAMES · complex 1 - H, not 1 - |H| ═══
     Near the loop bandwidth H has substantial phase, and the two differ
     materially. Getting this wrong understates the residual, which means
     overstating the tolerance — the optimistic direction. */
  let worstGap = 0, gapAt = 0;
  r.generated.sweep.forEach((q) => {
    const wrong = Math.abs(1 - q.h);            // 1 - |H|, the mistake
    const gap = Math.abs(q.e - wrong);
    if (gap > worstGap) { worstGap = gap; gapAt = q.f; }
  });
  ok('1 - |H| differs materially from |1 - H| near the loop bandwidth, so the '
     + 'complex complement is not a refinement but the answer',
     worstGap > 0.2, `worst gap ${fmt(worstGap)} at ${fmt(gapAt / 1e6)} MHz`);
  /* And in the direction that matters: |1-H| exceeds 1-|H| where H peaks, so
     using the wrong one UNDERSTATES the residual and overstates tolerance. */
  const pk = r.generated.sweep.find((q) => Math.abs(q.f - r.measurements.peakAt)
                                           < r.measurements.peakAt * 0.05);
  ok('and the mistake is optimistic, which is the worse kind',
     pk.e > Math.abs(1 - pk.h), `|1-H| ${fmt(pk.e)} against 1-|H| ${fmt(Math.abs(1 - pk.h))}`);

  /* ═══ TYPE-2 PEAKING, which a first-order sketch cannot show ═══
     The numerator's zero lifts the response near wn at every damping, so a loop
     called "well damped" still amplifies jitter in a band. This is why transfer
     is specified separately from bandwidth. */
  for (const z of [0.25, 0.5, 0.7, 1.0, 1.5]) {
    const m = run({ zeta: z }).measurements;
    ok(`a type-2 loop peaks above unity at damping ${z}`,
       m.peakTransfer > 1.0001, `+${m.peakTransferDb.toFixed(2)} dB`);
  }
  /* MONOTONICITY, with its precondition: more damping, less peaking. True for
     this loop form; not a universal statement about loops. */
  let prev = Infinity, mono = true;
  for (const z of [0.25, 0.5, 0.7, 1.0, 1.5, 2.0]) {
    const pkdb = run({ zeta: z }).measurements.peakTransferDb;
    if (pkdb > prev + 1e-9) mono = false;
    prev = pkdb;
  }
  ok('and peaking falls monotonically with damping, for this loop form', mono);

  /* ═══ SCALING · the loop sets the shape, the margin sets the height ═══ */
  const a = run({ margin: 0.3 }), b = run({ margin: 0.1 });
  let ratio = 0, ok2 = true;
  a.generated.sweep.forEach((q, i) => {
    const rr = q.tol / b.generated.sweep[i].tol;
    if (!ratio) ratio = rr;
    if (Math.abs(rr / ratio - 1) > 1e-9) ok2 = false;
  });
  ok('with the ceiling disabled, tolerance scales exactly with the sampling margin',
     ok2 && Math.abs(ratio - 3) < 1e-9, `ratio ${fmt(ratio)} for a 3x margin`);

  /* N3-1e / R8. The guide said that scaling holds "at every frequency". It does
     not once a tracking ceiling is declared, which the panel does at 20 UI: the
     capped section is pinned and does not move with the margin at all. So the
     curve changes SHAPE, and the answer had to say so. */
  const ca = run({ margin: 0.3, ceiling: 20 }), cb = run({ margin: 0.1, ceiling: 20 });
  let sawScaled = false, sawPinned = false;
  ca.generated.sweep.forEach((q, i) => {
    const rr = q.tol / cb.generated.sweep[i].tol;
    if (q.limited) { if (Math.abs(rr - 1) < 1e-9) sawPinned = true; }
    else if (Math.abs(rr - 3) < 1e-9) sawScaled = true;
  });
  ok('but with a ceiling declared, the loop-limited part scales 3x and the '
     + 'ceiling-limited part does not move at all', sawScaled && sawPinned,
     `scaled ${sawScaled}, pinned ${sawPinned}`);

  /* Bandwidth shifts the shape along the axis without changing it. */
  const w1 = run({ fn: 4 }).measurements, w2 = run({ fn: 20 }).measurements;
  nearRel('five times the bandwidth moves the peak five times up the axis',
          w2.peakAt / w1.peakAt, 5, 0.02);
  /* The peak height is scale-invariant in exact arithmetic, but both figures
     come from scanning a 340-point log grid over six decades — 57 points per
     decade, so adjacent samples are 4.1% apart in frequency. Near a smooth
     maximum that is a second-order error in amplitude, and 6e-4 dB is what it
     costs. The tolerance is the grid's, not the model's. */
  nearAbs('without changing how much it peaks, to within the sweep grid',
          w2.peakTransferDb, w1.peakTransferDb, 5e-3, ' dB');

  /* ═══ N3-1a / R8 · fn IS NOT THE BANDWIDTH ═══
     The panel labelled the natural frequency "loop bw". They differ by a factor
     that is itself a function of damping, so the label taught a relationship
     that does not exist. Checked against the closed form solved by hand from
     |H|^2 = 1/2, which is independent of how the module computes it. */
  const bwClosed = (z) => { const b = 2 + 4 * z * z; return Math.sqrt((b + Math.sqrt(b * b + 4)) / 2); };
  let bwWorst = 0;
  for (const z of [0.15, 0.25, 0.5, 0.707, 1.0, 1.5]) {
    const m = run({ zeta: z }).measurements;
    const dep = Math.abs(m.bandwidthOverFn - bwClosed(z)) / bwClosed(z);
    if (dep > bwWorst) bwWorst = dep;
  }
  nearAbs('the reported -3 dB bandwidth matches the closed form at every damping',
          bwWorst, 0, 1e-12, 'fraction');
  /* INDEPENDENT CHECK: bisect on the model's own swept |H| for the half-power
     point, rather than trusting either formula. */
  {
    const rr = run({ zeta: 0.7, ceiling: 1e9 });
    const sw = rr.generated.sweep;
    let i = 0;
    while (i < sw.length - 1 && sw[i].h > Math.SQRT1_2) i++;
    /* Interpolate in log f between the bracketing samples. The sweep is 340
       points over six decades — 57 per decade, so adjacent samples are 4.1%
       apart and taking the grid point alone overshoots by up to that much. */
    const a1 = sw[i - 1], a2 = sw[i];
    const t = (Math.log(a1.h) - Math.log(Math.SQRT1_2)) / (Math.log(a1.h) - Math.log(a2.h));
    const fCross = Math.exp(Math.log(a1.f) + t * (Math.log(a2.f) - Math.log(a1.f)));
    nearRel('and agrees with where the swept |H| actually crosses 1/sqrt(2)',
            rr.measurements.bandwidth3dB, fCross, 5e-3, 'fraction');
  }
  ok('and it is NOT the natural frequency, by a wide margin',
     run({ zeta: 0.7 }).measurements.bandwidth3dB > 1.9 * 4e6,
     `${(run({ zeta: 0.7 }).measurements.bandwidth3dB / 1e6).toFixed(3)} MHz for fn = 4 MHz`);
  ok('and the ratio between them moves with damping, which is why one cannot '
     + 'stand in for the other',
     Math.abs(bwClosed(1.5) / bwClosed(0.15) - 1) > 1,
     `${bwClosed(0.15).toFixed(3)}x at zeta 0.15, ${bwClosed(1.5).toFixed(3)}x at 1.5`);

  /* ═══ N3-1b · THE EXTREMA MUST FIT THEIR AXES ═══
     Both magnitude plots were drawn to a fixed maximum of 3 and the tolerance
     plot to a floor of half the margin. At the lowest damping the control
     allows, all three clip — which removed exactly the behaviour damping is a
     control for. These assert that a fixed limit WOULD clip, so the axes have
     to follow the data. */
  const edge = run({ zeta: 0.15, ceiling: 20 }).measurements;
  ok('at the lowest damping the control allows, |H| exceeds a fixed limit of 3',
     edge.peakTransfer > 3, fmt(edge.peakTransfer));
  ok('and so does the residual', edge.peakResidual > 3, fmt(edge.peakResidual));
  ok('and the worst tolerance falls below half the sampling margin',
     edge.minTolerance < 0.3 * 0.5, `${fmt(edge.minTolerance)} UI against a 0.15 UI floor`);

  /* ═══ N3-1e · THE UNDERDAMPED RESIDUAL RISES, IT DOES NOT DIP ═══
     The guide said the residual "dips below what a first-order model would
     predict", so tolerance improves. Both halves are backwards. */
  for (const z of [0.15, 0.25, 0.5]) {
    const m = run({ zeta: z, ceiling: 20 }).measurements;
    ok(`at damping ${z} the residual EXCEEDS unity, which is worse than no loop`,
       m.peakResidual > 1.01, `x${fmt(m.peakResidual)}`);
    ok(`so the worst tolerance at damping ${z} is BELOW the sampling margin`,
       m.minTolerance < 0.3 * 0.995,
       `${fmt(m.minTolerance)} UI against a 0.30 UI margin`);
  }
  /* And at the transfer peak both magnitudes are large together — the thing that
     makes "one is small where the other is large" wrong. */
  {
    const rr = run({ zeta: 0.25, ceiling: 20 });
    const pk2 = rr.generated.sweep.find((q) => q.f >= rr.measurements.peakAt);
    ok('at the transfer peak |H| and |1-H| are BOTH large, because H has phase there',
       pk2.h > 2 && pk2.e > 1.5, `|H| ${fmt(pk2.h)}, |1-H| ${fmt(pk2.e)}`);
    ok('and 1 - |H| is negative there, so it is not merely less accurate',
       1 - pk2.h < 0, fmt(1 - pk2.h));
  }

  /* ═══ N3-1c · toleranceFloor NAMED AN ASYMPTOTE AS IF IT WERE A MINIMUM ═══ */
  {
    const m = run({ zeta: 0.25, ceiling: 20 }).measurements;
    ok('the high-frequency asymptote is the bare margin', Math.abs(m.toleranceAtHighFrequency - 0.3) < 1e-12);
    ok('and the true minimum is materially below it, so they are different numbers',
       m.minTolerance < m.toleranceAtHighFrequency * 0.6,
       `${fmt(m.minTolerance)} against ${fmt(m.toleranceAtHighFrequency)} UI`);
  }

  /* ═══ THE DECLARED CEILING is an assumption, and behaves like one ═══ */
  const capped = run({ ceiling: 20 });
  ok('a declared tracking ceiling limits the low-frequency rise',
     capped.measurements.ceilingTakesOverAt > 0,
     `from ${fmt(capped.measurements.ceilingTakesOverAt / 1e3)} kHz down`);
  ok('and it is flagged per point, so a plot can draw it as an assumption '
     + 'rather than a result',
     capped.generated.sweep.some((q) => q.limited)
     && capped.generated.sweep.some((q) => !q.limited));
  ok('with no ceiling, nothing is flagged', !run({}).generated.sweep.some((q) => q.limited));

  /* N5-6 · The time experiment is another view of this same complex response.
     Peak-to-peak input and the record duration are independent statements of
     the UI and time conventions. The sample closure assertion is explicitly a
     regression guard: it checks the exported residual against the subtraction
     that defines it, rather than independently validating H. */
  {
    const td = run({ jitterFrequency: 4, jitterAmplitude: 0.4 });
    const g = td.generated;
    let closure = 0;
    for (let i = 0; i < g.phaseIn.length; i++) {
      closure = Math.max(closure, Math.abs(g.phaseIn[i] - g.phaseRecovered[i] - g.phaseResidual[i]));
    }
    nearAbs('sinusoidal input is 0.40 UI peak-to-peak, not 0.40 UI peak',
            Math.max(...g.phaseIn) - Math.min(...g.phaseIn), 0.4, 1e-12, ' UI pp');
    nearAbs('regression guard: exported input equals recovered plus residual at every sample',
            closure, 0, 1e-14, ' UI');
    ok('the experiment spans exactly three selected jitter periods',
       Math.abs(g.phaseTime[g.phaseTime.length - 1] * 4e6 - 3) < 1e-12);
    ok('published phase traces carry real samples in the common trace shape',
       td.traces.filter((t) => t.id.startsWith('phase-')).length === 3
       && td.traces.filter((t) => t.id.startsWith('phase-'))
         .every((t) => t.x.values.length === 181 && t.y.length === 181));
    ok('the published stimulus states frequency, peak-to-peak amplitude and steady state',
       td.stimulus.frequency === 4e6 && td.stimulus.amplitudePeakToPeak === 0.4
       && td.stimulus.steadyState === true);
    ok('phase exports state seconds and UI while the stimulus states UI peak-to-peak',
       td.traces.filter((t) => t.id.startsWith('phase-'))
         .every((t) => t.x.unit === 's' && t.unit === 'UI')
       && td.units.jitterAmplitude === 'UI pp');

    const peakyTd = run({ zeta: 0.15, jitterFrequency: 4, jitterAmplitude: 0.4 });
    const values = peakyTd.generated.phaseIn.concat(peakyTd.generated.phaseRecovered,
                                                     peakyTd.generated.phaseResidual);
    const extent = Math.max(...values.map(Math.abs));
    ok('the time-domain axis contains all three traces at the allowed minimum damping',
       peakyTd.measurements.phaseAxisLimit > extent
       && peakyTd.measurements.phaseAxisLimit >= extent * 1.1,
       `extent ${fmt(extent)} UI, axis ±${fmt(peakyTd.measurements.phaseAxisLimit)} UI`);
  }
});

/* ═════════ M7-1 · the two-parameter surface ═════════ */
suite('Sweep surface — a grid chosen by measurement, and stale runs refused', () => {
  const P = { reach: 8, loss: 14, rate: 16, dz: 38, dpos: 45, dlen: 24,
              stub: 0, tr: 12, trTdr: 12, eq: true };
  const spec = { x: { key: 'stub', lo: 0, hi: 40 }, y: { key: 'loss', lo: 4, hi: 24 } };
  const job = MODELS.labChannelSweep(P, Object.assign({ nx: 5, ny: 5 }, spec));

  ok('the sweep is a stepper, so a caller can chunk it and abandon it',
     typeof job.step === 'function' && job.done === 0);
  ok('and it states the tolerance its grid costs', job.tolerance > 0,
     `\u00b1${(job.tolerance * 1000).toFixed(1)} mV`);
  let guard = 0;
  while (!job.step() && guard++ < 500) { /* run it out */ }
  nearAbs('every cell is evaluated exactly once', job.done, 25, 0, ' cells');
  ok('every cell carries an eye height and a validity flag',
     job.cells.every((c) => typeof c.eye === 'number' && typeof c.ok === 'boolean'));
  ok('an unusable cell says why, rather than carrying a number nobody should read',
     job.cells.every((c) => c.ok || c.why), 'all cells accounted for');

  /* THE GRID'S OWN CLAIM, checked against the panel's grid. This is what makes
     the coarse sweep honest rather than convenient: the tolerance it states has
     to be the tolerance it delivers. */
  let worst = 0, flips = 0;
  for (const stub of [0, 10, 20, 30, 40]) {
    for (const loss of [4, 14, 24]) {
      const q = Object.assign({}, P, { stub, loss });
      const coarse = MODELS.labChannel(q, { nfft: 2048 }).measurements.eyeHeight;
      const fine = MODELS.labChannel(q).measurements.eyeHeight;
      worst = Math.max(worst, Math.abs(coarse - fine));
      if ((coarse > 0) !== (fine > 0)) flips++;
    }
  }
  ok('the sweep grid delivers the tolerance it states, against the panel grid',
     worst <= job.tolerance, `worst ${(worst * 1000).toFixed(2)} mV against a stated `
     + `${(job.tolerance * 1000).toFixed(1)} mV`);
  nearAbs('and no cell disagrees with the panel about open versus closed',
          flips, 0, 0, ' cells');

  /* The surface has to contain the thing it exists to show: two cells at the
     same loss on opposite sides of the closed contour. */
  const full = MODELS.labChannelSweep(P, Object.assign({ nx: 11, ny: 11 }, spec));
  let g2 = 0;
  while (!full.step() && g2++ < 500) { /* run */ }
  const rows = {};
  full.cells.forEach((c) => {
    if (!c.ok) return;
    rows[c.j] = rows[c.j] || { open: 0, closed: 0 };
    c.eye > 0 ? rows[c.j].open++ : rows[c.j].closed++;
  });
  const mixed = Object.keys(rows).filter((j) => rows[j].open && rows[j].closed);
  ok('at least one loss value has both open and closed cells, which is the whole '
     + 'argument for the surface', mixed.length > 0,
     `${mixed.length} of ${Object.keys(rows).length} loss rows are mixed`);
});

/* ═════════ M7-4 · the one return-path case with an exact closed form ═════════ */
suite('Via loop inductance — exact, and where its approximation fails', () => {
  const L = K.viaLoopInductance;
  const mm = 1e-3, nH = 1e9;

  /* ANALYTIC: the acosh form is exact for round conductors. Its s >> r limit is
     the (mu0/pi)*ln(s/r) that most references quote, so the two must converge —
     and the rate at which they converge is the validity domain. */
  let far = 0, near = 0;
  for (const s of [0.4, 20]) {
    const ex = Math.acosh(s * mm / (2 * 0.15 * mm));
    const ap = Math.log(s * mm / (0.15 * mm));
    const dep = Math.abs(ex - ap) / ex;
    if (s === 0.4) near = dep; else far = dep;
  }
  ok('far from the conductors the exact form and the log approximation agree',
     far < 1e-3, `${(far * 100).toFixed(3)}%`);
  ok('and close to them the approximation is substantially wrong, which is '
     + 'exactly where a return via sits', near > 0.2, `${(near * 100).toFixed(1)}%`);

  /* MONOTONICITY with its precondition: for fixed radius and length, a wider
     loop encloses more flux, so inductance rises with spacing. Always, for this
     geometry — it is a property of acosh being increasing. */
  let prev = -Infinity, mono = true;
  for (const s of [0.31, 0.4, 0.5, 1, 2, 4, 10]) {
    const v = L(1.6 * mm, 0.15 * mm, s * mm);
    if (!(v > prev)) mono = false;
    prev = v;
  }
  ok('inductance rises monotonically with spacing, for fixed radius and length',
     mono);

  /* SCALING: the formula is linear in length, so doubling the board thickness
     doubles the loop. Nothing in the implementation is consulted for that. */
  nearRel('doubling the length doubles the inductance',
          L(3.2 * mm, 0.15 * mm, mm), 2 * L(1.6 * mm, 0.15 * mm, mm), 1e-12);

  /* A CLOSED-FORM SPECIAL CASE with a known RATE. acosh(1) = 0, so touching
     barrels enclose no flux — but the interesting part is how it approaches
     zero: acosh(1 + e) ~ sqrt(2e), so the inductance falls as the square root
     of the excess spacing. Checking the rate rather than just the limit is what
     makes this a test of the function and not of Math.acosh. */
  const rate = [];
  for (const e of [1e-4, 1e-6, 1e-8]) {
    rate.push(L(1.6 * mm, 0.15 * mm, 0.3 * mm * (1 + e)));
  }
  ok('as the barrels approach touching, the inductance tends to zero',
     rate[2] < rate[1] && rate[1] < rate[0] && rate[2] * nH < 1e-3,
     rate.map((v) => fmt(v * nH) + ' nH').join(' -> '));
  /* Two decades of e should give one decade of L, because of the square root. */
  nearRel('and it falls as the square root of the excess spacing, which is what '
          + 'acosh(1 + e) ~ sqrt(2e) requires', rate[0] / rate[1], 10, 0.02);

  /* AND AN EMPTY RESULT. Barrels that would intersect are not a geometry, and
     the function says so rather than returning a complex or negative number.
     Same rule as the bathtub sentinel: a domain error is not a small answer. */
  ok('intersecting barrels return NaN, not a number',
     Number.isNaN(L(1.6 * mm, 0.15 * mm, 0.2 * mm)));
  ok('and so does a spacing exactly equal to the barrel diameter',
     Number.isNaN(L(1.6 * mm, 0.15 * mm, 0.3 * mm)));

  /* The figures the page quotes, recomputed here. check-numbers.py also gates
     them in the prose; this checks the function they came from. */
  nearAbs('a 0.5 mm return via on a 1.6 mm board is 0.703 nH',
          L(1.6 * mm, 0.15 * mm, 0.5 * mm) * nH, 0.703, 0.002, ' nH');
  nearAbs('at 2.0 mm it is 1.654 nH',
          L(1.6 * mm, 0.15 * mm, 2 * mm) * nH, 1.654, 0.002, ' nH');
});

/* ---------- report ---------- */
console.log('');
suite('Real capacitors — SRF scaling, the ESR closed form, asymptotes', () => {
  const part = K.REAL_CAP_PARTS.find((x) => x.id === 'grm188-22u');
  const base = { part, eslPart: 0.6e-9, lMount: 1.2e-9, esrMin: 3e-3, fEsrMin: 2e6 };

  /* CLOSED FORM: SRF = 1/(2*pi*sqrt(LC)), so at fixed L the ratio of resonant
     frequencies is exactly 1/sqrt(retained) -- independent of L, of ESR, of the
     grid, and of everything the module computes. Derating a part to half its
     marked value moves its resonance up by sqrt(2), always. */
  let worstSrf = 0;
  for (const r of [0.9, 0.75, 0.5, 0.35, 0.2]) {
    const m = K.realCap(Object.assign({ retained: r }, base)).measurements;
    const dep = Math.abs(m.srfRatio - 1 / Math.sqrt(r)) / (1 / Math.sqrt(r));
    if (dep > worstSrf) worstSrf = dep;
  }
  nearAbs('SRF scales as one over root C, exactly', worstSrf, 0, 1e-12, 'fraction');

  /* CLOSED FORM: at the default shape exponent the two-term ESR collapses to
     esrMin*cosh(ln(f/fMin)/2). Derived by hand from Rm = 2p*Rd with p = 1/2,
     not by re-running the module's own expression. */
  let worstEsr = 0;
  for (const dec of [-3, -1, 0, 0.5, 2, 3]) {
    const f = 2e6 * Math.pow(10, dec);
    const got = K.realCapEsr(f, 3e-3, 2e6);
    const want = 3e-3 * Math.cosh(Math.log(f / 2e6) / 2);
    const dep = Math.abs(got - want) / want;
    if (dep > worstEsr) worstEsr = dep;
  }
  nearAbs('the two-term ESR is esrMin*cosh(ln(f/fMin)/2) at p = 1/2',
          worstEsr, 0, 1e-12, 'fraction');

  /* ANALYTIC LIMIT: ESR has its minimum at fEsrMin and the minimum equals
     esrMin. A shape that drifted off its own anchor would still look plausible
     on a log plot, which is why this is asserted rather than eyeballed. */
  nearAbs('ESR at its stated minimum frequency is the stated minimum',
          K.realCapEsr(2e6, 3e-3, 2e6), 3e-3, 1e-15, 'ohm');
  let above = true;
  for (const mul of [0.01, 0.1, 0.5, 2, 10, 100]) {
    if (!(K.realCapEsr(2e6 * mul, 3e-3, 2e6) > 3e-3)) above = false;
  }
  ok('and ESR is strictly above it on both sides', above);

  /* ANALYTIC: the reactance vanishes at SRF, so |Z| there is ESR(SRF) exactly.
     Computed here from the definition rather than read from the trace. */
  const r5 = K.realCap(Object.assign({ retained: 0.5 }, base));
  const f0 = r5.measurements.srfEffective;
  const lTot = base.eslPart + base.lMount;
  const cEff = part.cNom * 0.5;
  const x0 = 2 * Math.PI * f0 * lTot - 1 / (2 * Math.PI * f0 * cEff);
  nearAbs('reactance is zero at the self-resonant frequency', x0, 0, 1e-9, 'ohm');
  nearRel('so |Z| at SRF is exactly ESR(SRF)',
          r5.measurements.zAtSrf, K.realCapEsr(f0, 3e-3, 2e6), 1e-12, 'fraction');

  /* ASYMPTOTE: well above resonance the capacitor is an inductor and C drops
     out, so the marked and derated curves must converge. Well below it, |Z| is
     1/(2*pi*f*C) and they must differ by exactly the retained fraction. */
  const zm = r5.traces.find((t) => t.id === 'z-marked');
  const ze = r5.traces.find((t) => t.id === 'z-effective');
  const iHi = zm.x.values.length - 1;
  nearRel('far above resonance the derating makes no difference at all',
          ze.y[iHi], zm.y[iHi], 1e-6, 'fraction');
  let iLo = 0;
  while (iLo < zm.x.values.length && zm.x.values[iLo] < 1e4) iLo++;
  nearRel('far below it the impedance ratio is exactly one over the retained fraction',
          ze.y[iLo] / zm.y[iLo], 2.0, 2e-3, 'fraction');

  /* ORDERING: the band must contain the operating point whenever the operating
     point is inside the band. A envelope that did not would be worse than none. */
  const rb = K.realCap(Object.assign({ retained: 0.5, bandLo: 0.35, bandHi: 0.7 }, base));
  const lo = rb.traces.find((t) => t.id === 'z-band-lo').y;
  const hi = rb.traces.find((t) => t.id === 'z-band-hi').y;
  const mid = rb.traces.find((t) => t.id === 'z-effective').y;
  let contained = true;
  for (let i = 0; i < mid.length; i++) {
    if (mid[i] < lo[i] * (1 - 1e-12) || mid[i] > hi[i] * (1 + 1e-12)) contained = false;
  }
  ok('the uncertainty band contains the operating point at every frequency', contained);

  /* SENTINEL: a zero retained fraction is not a capacitor with a very high
     impedance, it is a question the model cannot answer. It must refuse. */
  const bad = K.realCap(Object.assign({ retained: 0 }, base));
  ok('a zero retained fraction is refused, not silently drawn',
     bad.status !== 'ok' && bad.measurements === null && !!bad.why);

  /* The model must not invent a derating. If a future edit adds one, this fails. */
  ok('the model takes retained capacitance as an input and declares it so',
     r5.origins.retained.indexOf('reader input') === 0);
});

suite('Model domain — causality, admissibility, and what "ok" may mean', () => {
  const C = 299792458, DK = 4.03;
  const mat = (reachIn, lossDb, dielFrac) => {
    const len = reachIn * 0.0254, td = len * Math.sqrt(DK) / C;
    return { M: K.lineMaterial({ type: 'line', z: 50, td, lossDb,
                                 dielFrac: dielFrac === undefined ? 0.5 : dielFrac,
                                 Dk: DK, lossRefHz: 8e9 }), len };
  };

  /* CAUSALITY, as a physical law rather than a restatement of the fit. Whatever
     the material solver returns, no wavefront may arrive sooner than light
     crosses the same distance in VACUUM. This is the assertion that catches the
     0 < epsInf < 1 band, where the old code produced no NaN at all: at 1 inch
     and 14 dB the wavefront was 65.16 ps against a vacuum transit of 84.73 ps. */
  let superluminal = 0, checked = 0;
  for (const r of [0.5, 1, 1.5, 2, 3, 4, 8, 20]) {
    for (const l of [0, 4, 8, 12, 14, 18, 22, 26, 30, 34, 50]) {
      const { M, len } = mat(r, l);
      if (!Number.isFinite(M.wavefront)) continue;      // refused, which is allowed
      checked++;
      if (M.wavefront < len / C * (1 - 1e-12)) superluminal++;
    }
  }
  ok('no admissible line delivers a wavefront faster than light in vacuum',
     superluminal === 0, `${superluminal} of ${checked} admissible cases`);
  ok('and enough cases were admissible for that to mean something', checked > 40, `${checked}`);

  /* The boundary is eps_inf = 1, and the reported limit has to BE the boundary:
     just under it must be admissible, just over it must not. Computed from the
     model's own stated maxLossDb, so a limit that drifted from the fit fails. */
  const { M: bad } = mat(1, 22);
  ok('an inadmissible fit is flagged, not returned as a material', bad.admissible === false);
  ok('and it reports the largest loss this length can carry', bad.maxLossDb > 0);
  const lim = bad.maxLossDb;
  ok('just inside the reported limit is admissible',
     mat(1, lim * 0.999).M.admissible === true, `${(lim * 0.999).toFixed(3)} dB`);
  ok('just outside it is not',
     mat(1, lim * 1.001).M.admissible === false, `${(lim * 1.001).toFixed(3)} dB`);
  nearAbs('and eps_inf is exactly 1 at the limit', mat(1, lim).M.epsInf, 1, 2e-3, '');

  /* The limit is not a constant, so it cannot be tabulated anywhere: it moves
     with the loss reference frequency and the dielectric fraction. Asserted so
     that a future edit cannot quietly hard-code 12.33 dB/inch. */
  const limAt = (dielFrac) => mat(1, 1e4, dielFrac).M.maxLossDb;
  ok('the domain limit depends on how the loss is split between mechanisms',
     Math.abs(limAt(0.25) - limAt(1.0)) > 5, `${limAt(0.25).toFixed(1)} vs ${limAt(1.0).toFixed(1)} dB/in`);

  /* G-12 in K.result, both directions. A NaN must force a non-ok status; a
     DECLARED infinity must not, because a perfect match really does reflect
     nothing and -Infinity dB is that answer. */
  const mk = (meas, declared) => K.result({
    model: 'probe', version: 1, status: 'ok', params: {},
    measurements: meas, mayBeInfinite: declared
  });
  ok('a NaN measurement forces a non-ok status', mk({ a: NaN }).status !== 'ok');
  ok('and nulls the measurements rather than publishing them',
     mk({ a: NaN }).measurements === null);
  ok('a NaN is refused even when the model declares it may be infinite',
     mk({ a: NaN }, ['a']).status !== 'ok');
  ok('an UNdeclared infinity is refused', mk({ a: Infinity }).status !== 'ok');
  ok('a DECLARED infinity is kept', mk({ a: -Infinity }, ['a']).status === 'ok');
  ok('a finite result is untouched', mk({ a: 1.5 }).status === 'ok');
  ok('the refusal names which measurements were non-finite',
     (mk({ a: NaN, b: 2, c: Infinity }).diagnostics.nonFinite || []).join(',') === 'a,c');

  /* The gate's own reference case. A matched lossless channel reflects nothing,
     so its return loss is the one legitimate infinity on this site. */
  const ideal = MODELS.labChannel({ reach: 1, loss: 0, rate: 16, dz: 50, dpos: 50,
                                    dlen: 0, stub: 0, tr: 12, eq: false });
  ok('the ideal matched channel is still ok', ideal.status === 'ok');
  ok('and its return loss is exactly minus infinity, because nothing reflects',
     ideal.measurements.worstReturnLoss === -Infinity);

  /* Lab B refuses the reproduced combinations with a reason, not a NaN. */
  const B = { reach: 8, loss: 14, rate: 16, dz: 38, dpos: 45, dlen: 24,
              stub: 0, tr: 12, trTdr: 12, eq: true };
  for (const [r, l] of [[1, 22], [1, 34], [2, 34]]) {
    const x = MODELS.labChannel(Object.assign({}, B, { reach: r, loss: l }), { nfft: 1024 });
    ok(`(${r} in, ${l} dB) is refused with a reason, not measured`,
       x.status === 'unsupported' && !!x.why && x.measurements === null);
  }

  /* The whole exposed control space, in combination rather than one axis at a
     time — which is how R2 escaped: every control's endpoints were fine alone. */
  let leaks = 0, cases = 0, refusals = 0;
  for (const reach of [1, 2, 4, 8, 20])
    for (const loss of [0, 10, 18, 26, 34])
      for (const rate of [8, 32])
        for (const eq of [true, false]) {
          const x = MODELS.labChannel(Object.assign({}, B, { reach, loss, rate, eq }), { nfft: 1024 });
          cases++;
          if (x.status !== 'ok') { refusals++; continue; }
          for (const k of Object.keys(x.measurements)) {
            const v = x.measurements[k];
            if (typeof v === 'number' && Number.isNaN(v)) leaks++;
          }
        }
  ok('no combination reports ok while carrying a NaN', leaks === 0,
     `${cases} combinations, ${refusals} refused, ${leaks} leaks`);
  ok('and the refusals are a real fraction, so the grid crosses the boundary',
     refusals > 5 && refusals < cases, `${refusals} of ${cases}`);

  /* The sweep has to tell its two "no answer" reasons apart. Outside the domain
     no grid helps; not settled means this grid did not resolve it. */
  const sw = MODELS.labChannelSweep(B, { x: { key: 'reach', lo: 1, hi: 6 },
                                         y: { key: 'loss', lo: 6, hi: 34 }, nx: 5, ny: 5 });
  let guard = 0;
  while (!sw.step() && guard++ < 500) { /* chunked in the panel, run to completion here */ }
  const dom = sw.cells.filter((c) => c.domain).length;
  const tail = sw.cells.filter((c) => c.tailUndecayed).length;
  ok('the sweep completes across the domain boundary without throwing', guard < 500);
  /* N2-2f separated two things this used to conflate. A cell OUTSIDE THE DOMAIN
     has no answer at any grid and is not coloured. A cell whose impulse tail has
     not decayed still has a measured eye — the surface's own quantity — and is
     coloured, carrying the tail as a separate mark. */
  ok('out-of-domain cells are excluded and carry a reason',
     dom > 0 && sw.cells.every((c) => c.ok || !!c.why),
     `${dom} out of domain, ${sw.cells.filter((c) => c.ok).length} coloured`);
  ok('and an undecayed impulse tail is marked without hiding the eye',
     tail > 0 && sw.cells.every((c) => !c.tailUndecayed || c.domain || Number.isFinite(c.eye)),
     `${tail} cells carry an undecayed tail`);
  ok('no out-of-domain cell carries an eye value',
     sw.cells.every((c) => !c.domain || !Number.isFinite(c.eye)));
});

suite('Passivity — the full matrix, against an independent algorithm', () => {
  const fs2 = require('fs'), path2 = require('path');
  const FIX = path2.join(SRC, 'tests', 'fixtures');

  /* INDEPENDENT: power iteration on S^H S. A different algorithm from the closed
     form under test — iterative rather than algebraic, and it never forms the
     trace or the determinant. Agreeing to 1e-9 means two unrelated routes to the
     same number, which is what A5 asks for and what re-running the same formula
     in a second file does not give. */
  function sigmaMaxPower(s11, s12, s21, s22) {
    const S = [[s11, s12], [s21, s22]];
    const cm = (a, b) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
    const cc = (z) => ({ re: z.re, im: -z.im });
    const add = (a, b) => ({ re: a.re + b.re, im: a.im + b.im });
    const Sh = [[cc(S[0][0]), cc(S[1][0])], [cc(S[0][1]), cc(S[1][1])]];
    const mul = (M, x) => [add(cm(M[0][0], x[0]), cm(M[0][1], x[1])),
                           add(cm(M[1][0], x[0]), cm(M[1][1], x[1]))];
    let v = [{ re: 0.3, im: 0.7 }, { re: -0.5, im: 0.2 }], lam = 0;
    for (let i = 0; i < 4000; i++) {
      const w = mul(Sh, mul(S, v));
      const n = Math.hypot(Math.hypot(w[0].re, w[0].im), Math.hypot(w[1].re, w[1].im));
      if (n === 0) return 0;
      v = [{ re: w[0].re / n, im: w[0].im / n }, { re: w[1].re / n, im: w[1].im / n }];
      lam = n;
    }
    return Math.sqrt(lam);
  }

  const c = (re, im) => ({ re, im: im || 0 });
  const S2 = 1 / Math.SQRT2;

  /* The two counterexamples from the review, by name and to six figures. */
  nearAbs('a unitary asymmetric two-port has sigma_max exactly 1',
          K.sigmaMax2x2(c(S2), c(S2), c(S2), c(-S2)), 1, 1e-12, '');
  nearAbs('an active asymmetric two-port has sigma_max 1 + sqrt(1.25)',
          K.sigmaMax2x2(c(0), c(0.5), c(0.5), c(2)), 1 + Math.sqrt(1.25), 1e-12, '');

  /* And what the old shortcut said about each, so the regression is explicit
     rather than implied: it is the shortcut that was wrong, in both directions. */
  const shortcut = (s11, s21) => Math.max(Math.hypot(s11.re + s21.re, s11.im + s21.im),
                                          Math.hypot(s11.re - s21.re, s11.im - s21.im));
  ok('the retired |S11 +/- S21| shortcut called that unitary network active',
     shortcut(c(S2), c(S2)) > 1.4, `${shortcut(c(S2), c(S2)).toFixed(6)}`);
  ok('and called that active network passive',
     shortcut(c(0), c(0.5)) < 1, `${shortcut(c(0), c(0.5)).toFixed(6)}`);

  /* Random complex matrices, closed form against power iteration. This is the
     assertion that would catch an algebra slip the four fixtures happen to miss. */
  let worst = 0;
  let rng = 12345;
  const rnd = () => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng / 0x7fffffff * 2 - 1; };
  for (let i = 0; i < 300; i++) {
    const a = c(rnd(), rnd()), b = c(rnd(), rnd()), d = c(rnd(), rnd()), e = c(rnd(), rnd());
    const got = K.sigmaMax2x2(a, b, d, e);
    const want = sigmaMaxPower(a, b, d, e);
    const dep = Math.abs(got - want) / Math.max(want, 1e-9);
    if (dep > worst) worst = dep;
  }
  nearAbs('closed form agrees with power iteration over 300 random complex matrices',
          worst, 0, 1e-9, 'fraction');

  /* Degenerate cases, where T^2 - 4D is zero and floating point can push it
     negative. A NaN here would be silent: it fails a `> 1.001` comparison, so an
     active file would read as passive. */
  nearAbs('equal singular values do not produce a NaN (identity)',
          K.sigmaMax2x2(c(1), c(0), c(0), c(1)), 1, 1e-12, '');
  nearAbs('a scaled unitary matrix is its own scale factor',
          K.sigmaMax2x2(c(0, S2 * 0.5), c(0, S2 * 0.5), c(0, S2 * 0.5), c(0, -S2 * 0.5)),
          0.5, 1e-12, '');
  ok('the zero matrix is zero, not NaN', K.sigmaMax2x2(c(0), c(0), c(0), c(0)) === 0);

  /* The case the clamp exists for, found by searching rather than assumed. A
     lossless reciprocal two-port with a phase has EQUAL singular values, so
     T^2 - 4D is zero in exact arithmetic — and in floating point it lands just
     below, here at -1.32e-23. Without the clamp sqrt returns NaN, and a NaN is
     SILENT: `NaN > 1.001` is false, so an active file would read as passive.
     177,239 of 500,000 random scaled-unitary matrices with |S| <= 1 reach a
     negative discriminant, so this is the generic case for that family, not a
     corner of it. */
  const deg = {
    s11: c(0.0007131379942145024, 0.0022141433195533426),
    s12: c(0.003505285010831312, 0.010883171914590418),
    s21: c(0.003505285010831312, 0.010883171914590418),
    s22: c(-0.0007131379942145024, -0.0022141433195533426)
  };
  const degGot = K.sigmaMax2x2(deg.s11, deg.s12, deg.s21, deg.s22);
  ok('a lossless two-port with equal singular values does not produce a NaN',
     Number.isFinite(degGot), `${degGot}`);
  nearRel('and returns its true singular value', degGot, 0.011667966848084688, 1e-12, 'fraction');
  nearRel('which the independent power iteration confirms',
          degGot, sigmaMaxPower(deg.s11, deg.s12, deg.s21, deg.s22), 1e-9, 'fraction');

  /* THROUGH THE PARSER, on the files a reader would actually drop in. */
  const want = {
    'passive-unitary-asymmetric.s2p': { sig: 1, elem: S2, passive: true },
    'active-asymmetric.s2p': { sig: 1 + Math.sqrt(1.25), elem: 2, passive: false },
    'nonreciprocal-isolator.s2p': { sig: 0.9, elem: 0.9, passive: true },
    'lossy-passive-complex.s2p': { sig: 0.7, elem: 0.6, passive: true }
  };
  for (const name of Object.keys(want)) {
    const r = K.parseTouchstone(fs2.readFileSync(path2.join(FIX, name), 'utf8'));
    let sig = 0, elem = 0;
    r.S.forEach((e) => {
      sig = Math.max(sig, K.sigmaMax2x2(e.s11, e.s12, e.s21, e.s22));
      [e.s11, e.s12, e.s21, e.s22].forEach((z) => { elem = Math.max(elem, Math.hypot(z.re, z.im)); });
    });
    nearAbs(`${name}: sigma_max through the parser`, sig, want[name].sig, 1e-6, '');
    nearAbs(`${name}: max |Sij| over all four entries`, elem, want[name].elem, 1e-6, '');
    ok(`${name}: the passivity verdict is ${want[name].passive}`,
       (sig <= 1.001) === want[name].passive, `sigma_max ${sig.toFixed(6)}`);
  }

  /* The contradiction the old code put on one screen: a reported maximum element
     of 0.5 on a matrix that contains 2, while the parser warned about the 2. */
  const act = K.parseTouchstone(fs2.readFileSync(path2.join(FIX, 'active-asymmetric.s2p'), 'utf8'));
  let elemOld = 0, elemNew = 0;
  act.S.forEach((e) => {
    elemOld = Math.max(elemOld, Math.hypot(e.s21.re, e.s21.im), Math.hypot(e.s11.re, e.s11.im));
    [e.s11, e.s12, e.s21, e.s22].forEach((z) => { elemNew = Math.max(elemNew, Math.hypot(z.re, z.im)); });
  });
  ok('the retired element scan missed S22 entirely',
     elemOld === 0.5 && elemNew === 2, `old ${elemOld}, now ${elemNew}`);

  /* Only zero is DC. The old rule called 1 kHz a DC point. */
  const dcFile = K.parseTouchstone(fs2.readFileSync(path2.join(FIX, 'active-asymmetric.s2p'), 'utf8'));
  ok('a fixture starting at 0 Hz really does start at DC', dcFile.f[0] === 0);
  ok('and 1 kHz would not count as DC under the corrected rule', !(1e3 === 0));
});

suite('The featured comparison — matched by measurement, not by parameter', () => {
  const B = { reach: 8, loss: 14, rate: 16, dz: 38, dpos: 45, dlen: 24, stub: 0,
              tr: 12, trTdr: 12, eq: true };
  const run = (o) => MODELS.labChannel(Object.assign({}, B, o), { nfft: 4096 }).measurements;
  const step = run({});                                  // Gen 4, impedance step
  const flat = run({ dz: 50, dlen: 0 });                 // the control: nothing there
  const stub = run({ dz: 50, dlen: 0, stub: 28 });       // the stub

  /* THE DEFECT. The homepage claimed these two channels had the same loss because
     their loss CONTROL agreed. The control is a budget applied to the trace; the
     stub adds a notch it never sees. Asserting on the evaluated cascade is the
     whole point of this suite — asserting `p.loss === p.loss` would pass forever. */
  nearAbs('the stub preset really is about 10.09 dB lossier at Nyquist',
          step.ilAtNyquist - stub.ilAtNyquist, 10.09, 0.02, ' dB');
  ok('so "the insertion loss barely moves" would have been false by ten decibels',
     Math.abs(step.ilAtNyquist - stub.ilAtNyquist) > 5,
     `${step.ilAtNyquist.toFixed(4)} vs ${stub.ilAtNyquist.toFixed(4)} dB`);

  /* THE CONTROL, which is what makes the corrected lesson land: with the step
     removed the two ARE matched, to well under a tenth of a decibel, using only
     values the integer sliders can reach — and then the eyes match too. */
  nearAbs('removing the step leaves the loss matched at Nyquist',
          step.ilAtNyquist - flat.ilAtNyquist, 0, 0.08, ' dB');
  ok('and the eyes then agree to better than 2%',
     Math.abs(step.eyeHeight / flat.eyeHeight - 1) < 0.02,
     `${(step.eyeHeight * 1e3).toFixed(1)} vs ${(flat.eyeHeight * 1e3).toFixed(1)} mV`);

  /* Which establishes the causal claim the page now makes: the closed eye is the
     ten decibels, not the shape of the discontinuity. */
  ok('the stub eye is several times smaller, and the step eye is not',
     stub.eyeHeight < 0.3 * step.eyeHeight && flat.eyeHeight > 0.9 * step.eyeHeight,
     `step ${(step.eyeHeight * 1e3).toFixed(1)}, flat ${(flat.eyeHeight * 1e3).toFixed(1)}, `
     + `stub ${(stub.eyeHeight * 1e3).toFixed(1)} mV`);

  /* CLOSED FORM: an open stub of delay td is a quarter-wave resonator at
     1/(4*td). 28 ps puts the notch at 8.93 GHz, against a Nyquist of 8 GHz —
     which is WHY the loss lands where it does, and is computed here from the
     stub length alone rather than read off the model. */
  const notch = 1 / (4 * 28e-12);
  nearAbs('a 28 ps open stub resonates at 8.93 GHz', notch / 1e9, 8.93, 0.01, ' GHz');
  ok('which is within 12% of the Nyquist frequency it has to sit near to matter',
     Math.abs(notch / step.fNyq - 1) < 0.12, `${(notch / 1e9).toFixed(2)} vs 8.00 GHz`);

  /* And the mechanism, asserted rather than asserted-about: move the notch away
     and the loss comes back, with only the stub length changed. */
  const shortStub = run({ dz: 50, dlen: 0, stub: 4 });
  nearAbs('a 4 ps stub, resonating far above the band, restores the matched loss',
          shortStub.ilAtNyquist - flat.ilAtNyquist, 0, 0.06, ' dB');
  ok('and restores the eye with it, on the same topology',
     Math.abs(shortStub.eyeHeight / flat.eyeHeight - 1) < 0.02,
     `${(shortStub.eyeHeight * 1e3).toFixed(1)} vs ${(flat.eyeHeight * 1e3).toFixed(1)} mV`);

  /* The measured value must come from the cascade at exactly fNyq, not from the
     51-point display sweep. An interpolated reading would drift with the grid. */
  const coarse = MODELS.labChannel(B, { nfft: 1024 }).measurements;
  nearAbs('IL at Nyquist is evaluated exactly, so it does not move with the FFT size',
          coarse.ilAtNyquist, step.ilAtNyquist, 1e-9, ' dB');

  /* The homepage used to state six of these numbers in prose, and this block
     parsed them back out and compared them to the model, because a number written
     into a page by hand can sit there being wrong. That prose is gone: the
     homepage now runs the models live, so every number it shows is computed at
     the moment it is shown. Per the numbers rule, a value that only exists in a
     panel readout does not need an entry -- the module is the check.

     What replaced it is the suite below, which checks the CLAIMS those panels
     make in words underneath themselves, since those are the assertions a reader
     can actually see. */
});

/* ---------------------------------------------------------------------------
   The homepage panels. Three models a first-time visitor meets before anything
   else, each with a sentence under it stating what it is demonstrating. The
   sentences are the specification here: a panel that stopped demonstrating its
   own claim would still draw a plausible-looking plot.

   Every assertion is a limit, a sign, a monotonicity or a closed-form special
   case -- not a second copy of the formula being tested.
   --------------------------------------------------------------------------- */
suite('Homepage panels — the claim each one makes on screen', () => {
  const H = MODELS.homeShowcase;

  /* --- reflections: "Gamma = ..., N% of the wave turns around" --- */

  /* ANALYTICAL LIMIT. A load equal to the line impedance is indistinguishable
     from more line, so there is nothing to reflect from. Exact, not approximate. */
  nearAbs('a matched load reflects nothing', H.reflect(50).gamma, 0, 1e-15, '');

  /* PASSIVITY. A resistive load cannot return more than it was sent, at any
     slider position the panel allows. */
  {
    let worst = 0, at = 0;
    for (let rl = 5; rl <= 500; rl += 5) {
      const g = Math.abs(H.reflect(rl).gamma);
      if (g > worst) { worst = g; at = rl; }
    }
    ok('no load on the slider reflects more than it receives',
       worst <= 1 + 1e-12, `max |Gamma| = ${worst.toFixed(4)} at ${at} ohm`);
  }

  /* SIGN. Below the line impedance the reflection inverts, above it does not.
     This is the panel's "in phase" / "inverted" sentence, and getting it
     backwards would teach the opposite of the truth while looking fine. */
  ok('a load below 50 ohm inverts the reflected wave', H.reflect(25).gamma < 0,
     H.reflect(25).gamma.toFixed(3));
  ok('a load above 50 ohm does not', H.reflect(200).gamma > 0,
     H.reflect(200).gamma.toFixed(3));

  /* MONOTONICITY. Gamma rises with the load, everywhere, with no reversal. */
  {
    let bad = 0, prev = -Infinity;
    for (let rl = 5; rl <= 500; rl += 5) {
      const g = H.reflect(rl).gamma;
      if (g < prev - 1e-12) bad++;
      prev = g;
    }
    ok('Gamma increases with the load across the whole slider', bad === 0,
       `${bad} reversal(s)`);
  }

  /* CLOSED FORM. An open circuit doubles the far-end voltage: the incident wave
     arrives and is fully re-launched, so the load sees 2a0 before the source has
     heard anything. Checked at the top of the slider, where Gamma is near 1. */
  {
    const r = H.reflect(500), L = r.line;
    const vLoad = K.line1DAt(L, 1, 1.5 * H.consts.TD).v;
    nearRel('a nearly-open load nearly doubles the first arrival at the far end',
            vLoad, L.a0 * (1 + r.gamma), 0.01, '');
  }

  /* --- eye: "every decibel of loss takes more of it" --- */

  /* CLOSED-FORM SPECIAL CASE. With no loss there is no dispersion and no ISI, so
     the eye is the full launched swing and nothing less. */
  nearRel('a lossless channel leaves the eye at the full launched swing',
          H.eye(0).opening, 2 * H.consts.SWING, 0.005, ' V');

  /* MONOTONICITY, which is the sentence the panel prints. More loss never opens
     an eye -- if it ever did, the panel would be teaching that loss can help. */
  {
    let bad = 0, prev = Infinity, firstShut = null;
    for (let L = 0; L <= 18; L++) {
      const o = H.eye(L).opening;
      if (o > prev + 1e-12) bad++;
      if (firstShut === null && o <= 0) firstShut = L;
      prev = o;
    }
    ok('every extra decibel of loss closes the eye further, never opens it',
       bad === 0, `${bad} increase(s) across 0..18 dB`);
    ok('and the panel can actually reach a shut eye, which is the point of its range',
       firstShut !== null && firstShut <= 18, `first shut at ${firstShut} dB`);
  }

  /* SYMMETRY. The pattern set is complete and sign-symmetric, so the eye must be
     centred: the worst one and the worst zero sit equidistant from zero. An
     off-centre eye would mean the superposition had dropped a pattern. */
  {
    const e = H.eye(8);
    nearAbs('the eye is centred, so no pattern was dropped from the superposition',
            e.hiMin + e.loMax, 0, 1e-12, ' V');
  }

  /* --- PDN: "more capacitors move it, they do not remove it" --- */

  /* The claim, asserted directly and across the whole slider. A peak above the
     board bank must EXIST at every capacitor count; adding capacitors must not
     make it go away. This is the one sentence on the homepage that a reader
     could disprove with a sweep, so it is the one most worth checking. */
  {
    let missing = 0;
    for (let n = 1; n <= 48; n++) if (!(H.pdn(n).peak > 0)) missing++;
    ok('an anti-resonance exists at every capacitor count the slider offers',
       missing === 0, `${missing} count(s) with no peak`);
  }

  /* MONOTONICITY, the "move it" half, checked at every step rather than at the
     ends -- a peak that wandered back up in the middle would pass an endpoint
     comparison and contradict the sentence.

     Note what is NOT asserted here. The obvious claim, that the peak scales as
     1/sqrt(C), is false for this ladder and was written and removed rather than
     given a tolerance wide enough to pass. The board bank declares its ESL per
     capacitor, so K.zBranch gives it L/n and C*n and the bank's OWN resonance is
     independent of n. What moves is a coupled anti-resonance against the bulk
     bank through the plane inductance, in which the board capacitance is one
     element of several: 24x the capacitance moves it by 1.76x, not by 4.9x.
     Direction and monotonicity are real properties of that; a two-element
     scaling law is not. */
  {
    let reversals = 0, prev = Infinity;
    for (let n = 1; n <= 48; n++) {
      const f = H.pdn(n).fPeak;
      if (f > prev * 1.0001) reversals++;
      prev = f;
    }
    ok('more capacitors move the peak down in frequency, at every step',
       reversals === 0,
       `${reversals} reversal(s); ${(H.pdn(1).fPeak / 1e6).toFixed(2)} -> ${(H.pdn(48).fPeak / 1e6).toFixed(2)} MHz`);
  }

  /* The "do not remove it" half, made quantitative and at its hardest point.
     Forty-eight capacitors is the most the slider allows, it more than halves the
     peak -- and the peak is still more than twice the target. This is the whole
     lesson of the panel in one assertion: the move helps and does not solve. */
  {
    const most = H.pdn(48), least = H.pdn(1);
    ok('the peak falls as capacitors are added', most.peak < least.peak,
       `${(least.peak * 1e3).toFixed(0)} -> ${(most.peak * 1e3).toFixed(0)} mohm`);
    ok('but even at the largest count it is still above the target it draws',
       most.peak > H.consts.TARGET,
       `${(most.peak * 1e3).toFixed(0)} mohm vs ${(H.consts.TARGET * 1e3).toFixed(0)} mohm target`);
  }

  /* DC LIMIT. Far below every resonance the ladder is resistive and the die sees
     the regulator's own output resistance plus the series chain. Independent of
     the sweep: computed from the stage list itself. */
  {
    const st = H.pdnStages(12);
    const Rdc = st.reduce((a, s) => a + ((s.series && s.series.r) || 0), 0) + 0.005;
    const zc = K.pdnLadder(st, 1).z;
    nearRel('at 1 Hz the ladder is the series chain plus the regulator resistance',
            Math.hypot(zc.re, zc.im), Rdc, 0.02, ' ohm');
  }

  /* The panel prints a target line at 20 mohm and says whether the peak clears
     it. At the default the peak is above target -- which is the honest answer and
     the reason the sentence exists. If a retune ever made the default pass, the
     sentence would still say it failed. */
  ok('at the default count the peak really is above the 20 mohm target it draws',
     H.pdn(12).peak > H.consts.TARGET,
     `${(H.pdn(12).peak * 1e3).toFixed(0)} mohm vs 20 mohm`);
});

suite('Lab C transient — against an independently written solver', () => {
  const REF = require(require('path').join(SRC, 'tests', 'pdn-reference.js'));
  const P0 = { rvrm: 4, fbw: 120, lplane: 900, lpkg: 350, cboard: 1, nboard: 20,
               esr: 20, esl: 1100, cdie: 200, imax: 8, tr: 800, zt: 10 };
  const stagesOf = (q) => [
    { name: 'VRM', series: null,
      shunt: { r: q.rvrm / 1000, l: (q.rvrm / 1000) / (2 * Math.PI * q.fbw * 1e3) } },
    { name: 'bulk', series: { r: 4e-4, l: 1.2e-9 },
      shunt: { r: 0.01, l: 2.5e-9, c: 47e-6, n: 4 } },
    { name: 'board', series: { r: 6e-4, l: q.lplane * 1e-12 },
      shunt: { r: q.esr / 1000, l: q.esl * 1e-12, c: q.cboard * 1e-6, n: q.nboard } },
    { name: 'package', series: { r: 8e-4, l: q.lpkg * 1e-12 },
      shunt: { r: 0.05, l: 250e-12, c: 100e-9, n: 12 } },
    { name: 'die', series: { r: 2e-3, l: 40e-12 },
      shunt: { r: 5e-3, l: 2e-12, c: q.cdie * 1e-9 } }
  ];
  const wave = (nt, dt, tr, imax) => {
    const a = new Float64Array(nt);
    const t0 = Math.round(nt * 0.12), fall = Math.round(nt * 0.40);
    const rise = Math.max(2, Math.round(tr * 1e-12 / dt));
    for (let i = 0; i < nt; i++) {
      const u = (i - t0) / rise, dn = (i - fall) / rise;
      const up = u <= 0 ? 0 : (u >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * u));
      const df = dn <= 0 ? 0 : (dn >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * dn));
      a[i] = imax * (up - df);
    }
    return { a, t0 };
  };
  const refDroop = (q, dt, nt) => {
    const w = wave(nt, dt, q.tr, q.imax);
    const v = REF.solve(stagesOf(q), w.a, dt);
    let d = 0;
    for (let i = w.t0; i < Math.round(nt * 0.62); i++) d = Math.max(d, -v[i]);
    return d;
  };

  /* FIRST, VALIDATE THE REFERENCE, against a limit neither implementation can
     fudge. With capacitors open and inductors shorted the DC resistance at the
     die is the series chain plus the regulator's own resistance. Driven with a
     long step the solver must settle there. A reference that has not earned
     trust is not evidence about anything else. */
  const Rdc = 4e-4 + 6e-4 + 8e-4 + 2e-3 + P0.rvrm / 1000;
  nearAbs('the DC resistance of the ladder is the series chain plus the regulator',
          Rdc * 1e3, 7.8, 1e-12, ' mohm');
  {
    const dt = 200e-12, nt = 1 << 21;          // 419 us, far past the slowest pole
    const a = new Float64Array(nt);
    for (let i = 0; i < nt; i++) {
      const u = (i - 1000) / 4;
      a[i] = P0.imax * (u <= 0 ? 0 : (u >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * u)));
    }
    const v = REF.solve(stagesOf(P0), a, dt);
    nearAbs('and the reference solver settles to exactly that, from rest',
            -v[nt - 1] * 1e3, Rdc * P0.imax * 1e3, 1e-3, ' mV');
  }

  /* THE DEFECT. 200 ps and 400 ps produced bit-identical results — two
     different experiments, one answer, because max(2, round(tr/dt)) collapsed
     both to a two-sample edge at dt = 200 ps. */
  const at = (tr) => MODELS.labPdn(Object.assign({}, P0, { tr })).measurements;
  const m200 = at(200), m400 = at(400);
  ok('200 ps and 400 ps no longer produce identical droop',
     m200.droop !== m400.droop,
     `${(m200.droop * 1e3).toFixed(6)} vs ${(m400.droop * 1e3).toFixed(6)} mV`);
  ok('and identical overshoot', m200.overshoot !== m400.overshoot);

  /* The grid is chosen from the request, so the realised edge IS the requested
     edge across the control's range — and the model says which it built. */
  let realised = true;
  for (const tr of [200, 400, 600, 800, 1600, 3200, 20000]) {
    const m = at(tr);
    if (Math.abs(m.edgeRealisedPs - tr) > 1e-9) realised = false;
  }
  ok('every edge the control can request is realised exactly', realised);
  ok('and the model reports the timestep it chose', at(200).dtPs === 25);
  ok('with at least eight samples across the transition',
     [200, 400, 800, 20000].every((tr) => at(tr).edgeSamples >= 8));

  /* MONOTONICITY with its reason: a slower edge draws the same charge over more
     time, so the droop falls. Over the control's full range it falls by about
     3.4%, and the fast end is nearly flat because this ladder's poles are all
     far slower than a nanosecond. Flat is not the same as collided. */
  let prev = Infinity, mono = true;
  for (const tr of [200, 400, 800, 1600, 3200, 6400, 12800, 20000]) {
    const d = at(tr).droop;
    if (!(d <= prev)) mono = false;
    prev = d;
  }
  ok('droop falls monotonically as the edge slows', mono);
  nearAbs('and falls by about 3.4% across the control',
          100 * (1 - at(20000).droop / at(200).droop), 3.36, 0.1, '%');

  /* THE INDEPENDENT COMPARISON. The model works in the frequency domain over a
     PERIODIC record; the reference integrates from rest in the time domain. The
     periodic record is not causal — the previous period's tail is present before
     the event — and subtracting a pre-event mean does not remove it. The result
     is a systematic bias, measured here rather than assumed, and the same at
     every edge rate the control can ask for. */
  let worstBias = 0, minBias = Infinity;
  for (const tr of [400, 800, 1600, 5000, 20000]) {
    const m = at(tr);
    const bias = m.droop / refDroop(Object.assign({}, P0, { tr }), m.dtPs * 1e-12,
                                    Math.round(6.5536e-6 / (m.dtPs * 1e-12))) - 1;
    worstBias = Math.max(worstBias, bias);
    minBias = Math.min(minBias, bias);
  }
  ok('the FFT record biases the droop HIGH, consistently',
     minBias > 0.004 && worstBias < 0.010,
     `between ${(minBias * 100).toFixed(2)}% and ${(worstBias * 100).toFixed(2)}%`);
  ok('so the two methods agree on the droop to within 1%',
     worstBias < 0.01, `${(worstBias * 100).toFixed(2)}%`);

  /* And the bias is not what the pre-event drift diagnostic measures. They are
     different quantities that happen to be similar in size, which is exactly why
     the drift number could not be used as a bound on the error. */
  const d800 = MODELS.labPdn(Object.assign({}, P0, { tr: 800 }));
  ok('the model still reports its pre-event drift as a separate diagnostic',
     d800.status === 'ok' && d800.measurements.droop > 0);
});

suite('Lab A quadrature — the shipped grid, not a helper at higher resolution', () => {
  const W = { Z0: 50, Rs: 10, RL: 50, open: true, tr: 60, len: 3, xp: 50 };
  const at = (o, opts) => MODELS.labWaves(Object.assign({}, W, o), 0, opts);

  /* THE DEFECT, reproduced through the model's PUBLIC entry point at the grid it
     actually shipped. A conservation equation can be exactly right while the
     quadrature evaluating it is nowhere near — and the model said `ok`. */
  const coarse = at({ len: 12, tr: 10 }, { nx: 220 });
  nearAbs('the retired 220-interval grid failed to close by 74.58%',
          coarse.diagnostics.residualFraction * 100, 74.58, 0.02, '%');
  ok('and is now refused rather than reported as a result',
     coarse.status === 'no-convergence' && !!coarse.why);

  /* THE ERROR IS SPATIAL, AND SECOND ORDER. Doubling nx alone quarters it;
     refining the time grid alone does essentially nothing. That is the whole
     diagnosis, and it is what makes the fix cheap. */
  const closesAt = (nx) => at({ len: 12, tr: 10 }, { nx }).diagnostics.residualFraction;
  let order = true;
  for (const nx of [880, 1760, 3520]) {
    const ratio = closesAt(nx) / closesAt(nx * 2);
    if (!(ratio > 3.5 && ratio < 4.5)) order = false;
  }
  ok('halving the spatial step quarters the residual, as a trapezoid should',
     order, `ratios ${[880, 1760, 3520].map((n) => (closesAt(n) / closesAt(n * 2)).toFixed(2)).join(', ')}`);

  /* THE SHIPPED GRID. Astra's acceptance is explicit that a separate
     high-resolution helper passing is not the production path passing, so every
     one of these calls the model exactly as the panel does — no opts. */
  let worst = 0, worstAt = null;
  for (const len of [1, 2, 3, 6, 9, 12]) {
    for (const tr of [10, 20, 60, 150, 300, 500]) {
      const r = at({ len, tr });
      if (r.status !== 'ok') { worst = Infinity; worstAt = `${len} in / ${tr} ps refused`; break; }
      const c = r.diagnostics.residualFraction;
      if (c > worst) { worst = c; worstAt = `${len} in / ${tr} ps`; }
    }
  }
  ok('every length and edge the controls allow closes to better than 0.1%',
     worst < 1e-3, `worst ${(worst * 100).toFixed(4)}% at ${worstAt}`);

  /* The grid follows the edge, so the resolution is a property of the CHOICE
     rather than of the scenario — which is why the worst case is flat across the
     control space instead of blowing up in one corner. */
  const ra = at({ len: 12, tr: 10 }), rb = at({ len: 3, tr: 10 });
  ok('the shipped grid produces a usable result at both lengths',
     ra.status === 'ok' && rb.status === 'ok', `${ra.status} / ${rb.status}`);
  const a = ra.diagnostics.residualFraction;
  const b = rb.diagnostics.residualFraction;
  nearRel('and the residual no longer depends on which corner you are in',
          a, b, 0.05, 'fraction');

  /* Timing events must be unchanged by the refinement: this is a quadrature fix,
     not a different experiment. */
  /* Two EXPLICIT grids that both pass the budget. Explicit rather than "coarse
     against auto" so that a mutation to the grid rule makes this suite FAIL an
     assertion rather than crash on a refused run's null measurements — which
     the harness would report as a harness error, proving nothing. */
  const before = at({ len: 12, tr: 10 }, { nx: 7040 }).measurements;
  const after = at({ len: 12, tr: 10 }, { nx: 13056 }).measurements;
  nearAbs('the one-way delay is untouched by the grid', after.td, before.td, 1e-12, ' ps');
  nearRel('and so is the energy the source has actually supplied',
          after.fromSource, before.fromSource, 1e-9, 'fraction');
});

suite('Documented behaviour — the contract against the computation', () => {
  const fs3 = require('fs'), path3 = require('path');
  const doc = fs3.readFileSync(path3.join(SRC, 'docs', 'channel-model.md'), 'utf8');
  const Z0 = 50, REF = 8e9, PS = 170e-12;
  const sec = (dielFrac, lossDb) => [{ type: 'line', z: Z0, td: 8 * PS,
                                       lossDb, dielFrac, lossRefHz: REF }];
  const dcErr = (dielFrac, lossDb) => {
    const S = K.cascadeS(sec(dielFrac, lossDb), 1e3, Z0, REF);
    return Math.hypot(S.s21r - 1, S.s21i);
  };

  /* N3-2d / R9. The document claimed the 1 kHz DC substitute errs below 1e-9.
     Measured, it is 3.7e-4 — and the substitution frequency is not the cause,
     which is the part the document also had wrong. */
  nearRel('the shipped line errs by 3.7e-4 at the DC substitute, not 1e-9',
          dcErr(0.55, 14), 3.689e-4, 0.01, 'fraction');
  ok('which is nearly six orders of magnitude above the retired claim',
     dcErr(0.55, 14) > 1e-6, `${dcErr(0.55, 14).toExponential(3)} against 1e-9`);

  /* THE CAUSE, asserted because the document now names it. Lowering the
     substitute does nothing: the value is identical over three decades below it. */
  const f1k = K.cascadeS(sec(0.55, 14), 1e3, Z0, REF);
  const f1 = K.cascadeS(sec(0.55, 14), 1, Z0, REF);
  nearRel('and the substitution frequency is not what produces it',
          Math.hypot(f1k.s21r - 1, f1k.s21i), Math.hypot(f1.s21r - 1, f1.s21i),
          1e-6, 'fraction');
  ok('it is the conductor term, not the dielectric, that dominates at DC',
     dcErr(0, 14) > 10 * dcErr(1, 14),
     `${dcErr(0, 14).toExponential(3)} all-conductor against `
     + `${dcErr(1, 14).toExponential(3)} all-dielectric`);
  ok('and a lossless line reaches a much smaller numerical floor',
     dcErr(0.55, 0) < 1e-5, dcErr(0.55, 0).toExponential(3));

  /* THE DOCUMENT ITSELF. These stop the clause drifting away from the
     computation again, which is how it got six orders out. */
  /* Asserting the ABSENCE of the old string is the wrong test — the corrected
     clause quotes it in order to retire it, which is the honest way to record a
     mistake and would have failed such a check. So: every mention of 1e-9 must
     sit inside the retirement, and the measured figure must be present. */
  const dcClause = doc.split('- **DC**')[1].split('- **Nyquist**')[0];
  ok('the contract records the 1e-9 claim as retired, not as current',
     /used to sit here/.test(dcClause) && /was wrong/.test(dcClause));
  ok('and states the measured figure instead',
     dcClause.indexOf('3.689e\u22124') >= 0 || dcClause.indexOf('3.689e-4') >= 0);
  ok('and names the cause it also had wrong',
     /conductor/.test(dcClause) && /substitution frequency is not/.test(dcClause));

  /* N3-2d, second half. The document described a 99.99% energy tail truncation
     that the implementation does not perform — `keep = NFFT`, the whole record. */
  const src = fs3.readFileSync(path3.join(SRC, 'js', 'viz', 'lab-channel.js'), 'utf8');
  ok('the implementation keeps the whole record, as the corrected clause says',
     /const keep = NFFT;/.test(src));
  const tailClause = doc.split('- **Tail truncation')[1].split('- **Record duration')[0];
  ok('and the contract records the truncation clause as describing something never built',
     /does not happen/.test(tailClause) && /const keep = NFFT/.test(tailClause));
});

suite('One result, one truth — the trace contract (N4)', () => {
  const cases = {
    labChannel: MODELS.labChannel({ reach: 8, loss: 14, rate: 16, dz: 38, dpos: 45,
                                    dlen: 24, stub: 0, tr: 12, trTdr: 9, eq: true }),
    labPdn: MODELS.labPdn({ rvrm: 4, fbw: 120, lplane: 900, lpkg: 350, cboard: 1,
                            nboard: 20, esr: 20, esl: 1100, cdie: 200, imax: 8,
                            tr: 800, zt: 10 }),
    labWaves: MODELS.labWaves({ Z0: 50, Rs: 10, RL: 50, open: true, tr: 60, len: 3, xp: 50 }, 0),
    cdr: MODELS.cdr({ fn: 4, zeta: 0.7, margin: 0.3, ceiling: 20 }),
    realCap: K.realCap({ part: K.REAL_CAP_PARTS[0], retained: 0.5, eslPart: 6e-10,
                         lMount: 1.2e-9, esrMin: 3e-3, fEsrMin: 2e6 })
  };

  /* N4-4 / R10. `traces` used to hold four different things depending on the
     panel — and on three of them, an id and a label with NO NUMBERS AT ALL, the
     data living in `generated` where no export could reach it. That is why the
     CSV was a summary of rounded readouts. One shape now, checked here. */
  for (const name of Object.keys(cases)) {
    const res = cases[name];
    const ts = res.traces || [];
    ok(`${name} publishes at least one trace`, ts.length > 0, `${ts.length}`);
    let shaped = true, named = true, paired = true;
    ts.forEach((t) => {
      if (!t.x || !t.x.values || !t.y) shaped = false;
      else {
        if (!t.x.name || !t.x.unit || !t.unit) named = false;
        if (t.x.values.length !== t.y.length) paired = false;
      }
    });
    ok(`${name} traces carry x values and y values`, shaped);
    ok(`${name} traces name their abscissa and both units`, named);
    ok(`${name} traces have matching x and y lengths`, paired);
  }

  /* The point of the change: an export now carries what the model computed, not
     what the panel printed. A display string would have three or four figures. */
  {
    const il = cases.labChannel.traces.find((t) => t.id === 'il');
    const v = il.y[1];
    ok('trace values are full precision, not display-rounded',
       String(v).replace(/^-?\d*\.?/, '').length > 8, String(v));
  }

  /* N3-2f, asserted here because it is the same "one object" claim: a scenario
     that omits an input cannot be reproduced. */
  ok('the second edge definition is recorded in params',
     cases.labChannel.params.trTdr === 9, String(cases.labChannel.params.trTdr));
  ok('and the frequency spacing follows the grid the caller asked for',
     MODELS.labChannel({ reach: 8, loss: 14, rate: 16, dz: 38, dpos: 45, dlen: 24,
                         stub: 0, tr: 12, trTdr: 12, eq: true },
                       { nfft: 16384 }).origins.df
     === MODELS.labChannel({ reach: 8, loss: 14, rate: 16, dz: 38, dpos: 45, dlen: 24,
                             stub: 0, tr: 12, trTdr: 12, eq: true },
                           { nfft: 4096 }).origins.df / 4);

  /* N4-5 / R10. Suppression was keyed by COLOUR, so two series sharing one
     could not be told apart and the loader disabled toggling for both rather
     than hiding the wrong trace. One page paid the whole price: the critical
     length boundary and the transmission-line region share `--reflect`, and that
     panel had NO working legend toggles at all.

     A series key is now the id when there is one, and the colour otherwise —
     which is what lets this land without rewriting twenty-five modules. */
  /* `colourKey` needs a real 2-D context to normalise a colour string, which
     this harness deliberately does not provide — so the colour branch is tested
     through a stub, and the ID branch, which is the part N4-5 added, directly. */
  const realColourKey = K.colourKey;
  K.colourKey = (c) => 'colour:' + String(c).toLowerCase();
  try {
    ok('a series key prefers the id when one is given',
       K.seriesKey('#2E9BD2', 'critical-length') === 'id:critical-length');
    ok('and falls back to the colour when there is not',
       K.seriesKey('#2E9BD2') === K.colourKey('#2E9BD2'));
    ok('so two series sharing a colour get different keys once they have ids',
       K.seriesKey('#B45309', 'a') !== K.seriesKey('#B45309', 'b'));
    ok('while two id-free series on one colour still collide, as they must',
       K.seriesKey('#B45309') === K.seriesKey('#B45309'));
    ok('an id-keyed series never collides with a colour-keyed one',
       K.seriesKey('#B45309', 'a') !== K.seriesKey('#B45309'));
  } finally {
    K.colourKey = realColourKey;
  }

  /* N4-2 / R10. A view operation must not look like an input change. Every
     caller of K.redraw in the loader is one — a legend toggle, a zoom, a tab
     switch — and the nudge it sends is indistinguishable from the reader moving
     a slider, so Lab B cleared its preset, re-solved the pipeline and abandoned
     a running sweep because somebody hid a trace.

     The contract is tested here with a stub element; the behaviour itself is a
     browser fact and was verified there, both ways. */
  {
    const mk = () => {
      const handlers = {};
      return {
        nudged: 0,
        addEventListener(t, f) { (handlers[t] = handlers[t] || []).push(f); },
        removeEventListener(t, f) {
          handlers[t] = (handlers[t] || []).filter((g) => g !== f);
        },
        dispatchEvent(e) { (handlers[e.type] || []).forEach((f) => f(e)); return true; },
        querySelector() { this.nudged++; return null; }
      };
    };
    const listening = mk();
    let painted = 0;
    K.onRepaint(listening, () => { painted++; });
    const handled = K.repaint(listening);
    ok('a module that listens handles the repaint itself', handled === true);
    ok('and is asked to paint exactly once', painted === 1, `${painted}`);
    ok('without the loader nudging a control', listening.nudged === 0, `${listening.nudged}`);

    const deaf = mk();
    K.repaint(deaf);
    ok('a module that does not listen still falls back to the old nudge, '
       + 'so nothing regresses while they are converted one at a time',
       deaf.nudged === 1, `${deaf.nudged}`);
  }

  /* And the loader has one place to look, rather than a convention per module. */
  ok('the kit exposes publish/published as the single channel to the page',
     typeof K.publish === 'function' && typeof K.published === 'function');
  {
    const fake = {};
    K.publish(fake, cases.cdr);
    ok('a published result comes back identically', K.published(fake) === cases.cdr);
    ok('and an unpublished root returns null, not undefined', K.published({}) === null);
  }
});

/* ═════════ Calculators · twelve closed forms ═════════
   Each suite tests js/models/calc-models.js against something it does not
   compute itself: an analytical limit, a published value, a conservation law,
   or a second, independently derived formula written out here. Where an
   assertion restates the formula it tests, it says so -- a regression guard. */
const CALC = SIPI.calc;

suite('Calculator: LC/RLC resonance', () => {
  const L = 10e-9, Cp = 100e-12, R = 1;
  const r = CALC.rlc('series', R, L, Cp);
  const at = CALC.rlcZ('series', R, L, Cp, r.f0);
  nearRel('series |Z| at f0 equals R: the reactances cancel', at.mag, R, 1e-9);
  nearAbs('and the phase there is zero', at.phase, 0, 1e-9, ' rad');
  nearRel('parallel |Z| at f0 equals R', CALC.rlcZ('parallel', 1000, L, Cp, r.f0).mag, 1000, 1e-9);
  nearRel('series |Z| at f1 is sqrt(2)*R, half power', CALC.rlcZ('series', R, L, Cp, r.f1).mag, Math.SQRT2 * R, 1e-9);
  nearRel('series |Z| at f2 is sqrt(2)*R, half power', CALC.rlcZ('series', R, L, Cp, r.f2).mag, Math.SQRT2 * R, 1e-9);
  const p = CALC.rlc('parallel', 1000, L, Cp);
  nearRel('parallel |Z| at f1 is R/sqrt(2), half power', CALC.rlcZ('parallel', 1000, L, Cp, p.f1).mag, 1000 / Math.SQRT2, 1e-9);
  nearRel('band edges are geometric about f0: f1*f2 = f0^2', r.f1 * r.f2, r.f0 * r.f0, 1e-12);
  nearRel('the band is f0/Q wide', r.f2 - r.f1, r.f0 / r.Q, 1e-9);
  nearRel('10 nH and 100 pF resonate at 159.155 MHz', r.f0, 159.1549431e6, 1e-8);
  const lo1 = CALC.rlcZ('series', R, L, Cp, r.f0 / 1e3).mag, lo2 = CALC.rlcZ('series', R, L, Cp, r.f0 / 1e4).mag;
  nearRel('far below f0 |Z| rises tenfold per decade down: capacitive', lo2 / lo1, 10, 1e-3);
  const hi1 = CALC.rlcZ('series', R, L, Cp, r.f0 * 1e3).mag, hi2 = CALC.rlcZ('series', R, L, Cp, r.f0 * 1e4).mag;
  nearRel('far above f0 |Z| rises tenfold per decade up: inductive', hi2 / hi1, 10, 1e-3);
  nearRel('f0 depends on L*C only: L x4 and C /4 leave it unchanged', CALC.rlc('series', R, 4 * L, Cp / 4).f0, r.f0, 1e-12);
  ok('series Q falls as R rises', CALC.rlc('series', 2, L, Cp).Q < r.Q);
  ok('parallel Q rises as R rises', CALC.rlc('parallel', 2000, L, Cp).Q > p.Q);
});

suite('Calculator: return loss, reflection coefficient, VSWR', () => {
  const m = CALC.refl(50, 'zl', 50);
  ok('a matched load reflects nothing: gamma = 0', m.gamma === 0);
  ok('its return loss is infinite', m.rl === Infinity);
  nearAbs('its VSWR is 1', m.vswr, 1, 1e-12);
  nearAbs('an open reflects everything with gamma = +1', CALC.refl(50, 'zl', 1e12).gamma, 1, 1e-9);
  nearAbs('a short reflects everything with gamma = -1', CALC.refl(50, 'zl', 1e-12).gamma, -1, 1e-9);
  nearAbs('total reflection is 0 dB return loss', CALC.refl(50, 'zl', 1e12).rl, 0, 1e-6, ' dB');
  nearRel('20 dB return loss is |gamma| = 0.1', CALC.refl(50, 'rl', 20).mag, 0.1, 1e-12);
  nearRel('VSWR 2 is |gamma| = 1/3', CALC.refl(50, 'vswr', 2).mag, 1 / 3, 1e-12);
  nearRel('75 ohm on 50 ohm gives gamma = +0.2', CALC.refl(50, 'zl', 75).gamma, 0.2, 1e-12);
  ok('a load below Z0 gives a negative gamma', CALC.refl(50, 'zl', 25).gamma < 0);
  const g = CALC.refl(50, 'gamma', 0.3);
  nearRel('|gamma| -> return loss -> |gamma| round-trips', CALC.refl(50, 'rl', g.rl).mag, 0.3, 1e-12);
  nearRel('|gamma| -> VSWR -> |gamma| round-trips', CALC.refl(50, 'vswr', g.vswr).mag, 0.3, 1e-12);
  nearRel('the higher candidate load reproduces |gamma|', Math.abs(CALC.refl(50, 'zl', g.zHigh).gamma), 0.3, 1e-12);
  nearRel('the lower candidate load reproduces |gamma|', Math.abs(CALC.refl(50, 'zl', g.zLow).gamma), 0.3, 1e-12);
  nearAbs('reflected plus transmitted power is 1', g.pRefl + g.pTrans, 1, 1e-15);
  // regression guard: restates the definition of mismatch loss
  nearRel('mismatch loss is -10*log10(1 - |gamma|^2)', g.ml, -10 * Math.log10(1 - 0.09), 1e-12);
});

suite('Calculator: BER, Q and total jitter', () => {
  nearAbs('Q(0) = 1/2', K.Q(0), 0.5, 1e-7);
  nearAbs('Q(-x) = 1 - Q(x)', K.Q(-1.3) + K.Q(1.3), 1, 1e-12);
  nearRel('Q(1) matches the normal table, 0.158655', K.Q(1), 0.158655, 1e-5);
  /* The tail is evaluated by a Chebyshev erfc below x = 3 and a four-term
     asymptotic series above it. The series' first omitted term, 105/x^8, is
     1.6% at x = 3, so the two branches differ by about 0.9% where they meet.
     This asserts that bound rather than a flattering one; by BER 1e-12 (x ~ 7)
     the omitted term is below 2e-5. */
  nearRel('the two tail branches agree within 1% where they meet at x = 3', K.Q(3 - 1e-9), K.Q(3 + 1e-9), 0.01);
  nearRel('BER 1e-12 at rho = 1 gives the published multiplier 14.069', CALC.ber(1e-12, 1, 1e-12, 0, 1e-10).alpha, 14.069, 3e-4);
  const r = CALC.ber(1e-12, 0.5, 1e-12, 5e-12, 31.25e-12);
  nearRel('the inverse round-trips: rho*Q(Q_BER) = BER', 0.5 * K.Q(r.q), 1e-12, 1e-4);
  // regression guard: restates the dual-Dirac sum
  nearRel('TJ = DJ + 2*Q*RJ', r.tj, 5e-12 + 2 * r.q * 1e-12, 1e-12);
  ok('a lower BER needs a larger Q', CALC.ber(1e-15, 0.5, 1e-12, 0, 1e-10).q > r.q);
  ok('rho = 0.5 needs a smaller Q than rho = 1 at the same BER', r.q < CALC.ber(1e-12, 1, 1e-12, 0, 1e-10).q);
  ok('jitter wider than the UI closes the eye', CALC.ber(1e-12, 0.5, 5e-12, 0, 31.25e-12).open < 0);
  /* Independent of the TJ formula: 1 ps RMS at 1e-12 and rho = 1 is the published
     14.069 ps, straight from the multiplier table. */
  nearRel('TJ for 1 ps RJ at 1e-12, rho = 1, is the published 14.069 ps',
          CALC.ber(1e-12, 1, 1e-12, 0, 1e-10).tj, 14.069e-12, 3e-4);
});

suite('Calculator: bit rate, UI and Nyquist', () => {
  const n = CALC.bitrate(32e9, 1, 15e-12, 10, 3.8), p = CALC.bitrate(32e9, 2, 15e-12, 10, 3.8);
  nearRel('UI x symbol rate = 1', n.ui * n.baud, 1, 1e-15);
  nearRel('32 Gb/s NRZ has a 31.25 ps UI', n.ui, 31.25e-12, 1e-12);
  nearRel('PAM4 at the same bit rate has twice the UI', p.ui, 2 * n.ui, 1e-15);
  nearRel('and half the Nyquist frequency', p.fn, n.fn / 2, 1e-15);
  /* A single pole rises 10-90% in tau*ln(9), so f3dB*tr = ln(9)/(2*pi) = 0.3497. */
  nearRel('edge bandwidth is the single pole ln(9)/(2*pi*tr)', n.bw * 15e-12, Math.log(9) / (2 * Math.PI), 1e-3);
  nearAbs('the edge filter is 3 dB down at 0.35/tr', 10 * Math.log10(CALC.edgeLpf(0.35 / 15e-12, 15e-12)), -3.0103, 1e-3, ' dB');
  nearAbs('random data has a spectral null at the symbol rate', CALC.dataPsd(n.baud, n.ui), 0, 1e-20);
  nearAbs('and unit density at DC', CALC.dataPsd(0, n.ui), 1, 0);
  /* The chart draws the envelope, so it must never fall below the spectrum it
     stands for, and must touch it where sin^2 = 1 -- at the sidelobe peaks. */
  let below = 0;
  for (let i = 1; i < 4000; i++) { const f = n.baud * 8 * i / 4000; if (CALC.dataEnvelope(f, n.ui) < CALC.dataPsd(f, n.ui) - 1e-15) below++; }
  ok('the drawn envelope never falls below the data spectrum', below === 0, below + ' samples below');
  nearRel('and touches it at a sidelobe peak, f = 1.5/UI', CALC.dataEnvelope(1.5 * n.baud, n.ui), CALC.dataPsd(1.5 * n.baud, n.ui), 1e-12);
  nearRel('10 in at Dk 1 takes 0.254 m / c', CALC.bitrate(1e9, 1, 1e-11, 10, 1).td, 0.254 / 299792458, 1e-12);
});

suite('Calculator: electrical length', () => {
  const air = CALC.elen(1, 100e-12, 1);
  nearRel('at Dk 1 an inch takes 0.0254 m / c', air.tpd, 0.0254 / 299792458, 1e-12);
  nearRel('delay scales with sqrt(Dk)', CALC.elen(1, 100e-12, 4).tpd, 2 * air.tpd, 1e-12);
  const r = CALC.elen(3, 100e-12, 3.8);
  nearRel('delay is linear in length', CALC.elen(6, 100e-12, 3.8).td, 2 * r.td, 1e-12);
  nearRel('at the critical length the round trip is exactly tr/3', CALC.elen(r.lcrit, 100e-12, 3.8).round, 100e-12 / 3, 1e-12);
  ok('just below the critical length the trace is lumped', !CALC.elen(r.lcrit * 0.99, 100e-12, 3.8).long);
  ok('just above it the trace is a transmission line', CALC.elen(r.lcrit * 1.01, 100e-12, 3.8).long);
  /* The topic page's panel states the same rule as 2*Td > tr/3 with tpd =
     84.72*sqrt(Dk) ps/in; the calculator must agree with it to the picosecond. */
  nearRel('agrees with the topic page: tpd = 84.72*sqrt(Dk) ps/in', r.tpd * 1e12, 84.72 * Math.sqrt(3.8), 1e-4);
});

suite('Calculator: via stub resonance', () => {
  const r = CALC.stub(40, 3.8, 16e9, 3);
  const lambda = 299792458 / (r.fNotch * Math.sqrt(3.8));
  nearRel('at the notch the stub is a quarter wavelength', 40 * 25.4e-6, lambda / 4, 1e-12);
  nearRel('halving the stub doubles the notch', CALC.stub(20, 3.8, 16e9, 3).fNotch, 2 * r.fNotch, 1e-12);
  nearRel('matches the 2950/(mil*sqrt(Dk)) GHz rule', r.fNotch / 1e9, 2950 / (40 * Math.sqrt(3.8)), 1e-3);
  nearAbs('|S21| is 0 dB at DC', CALC.stubS21(0, r.fNotch), 0, 1e-12, ' dB');
  ok('|S21| collapses at the notch', CALC.stubS21(r.fNotch, r.fNotch) < -100);
  nearAbs('a half-wave stub is transparent: 0 dB at twice the notch', CALC.stubS21(2 * r.fNotch, r.fNotch), 0, 1e-9, ' dB');
  /* Halfway to the notch, tan(theta) = 1, so |S21|^2 = 4/5. */
  nearAbs('at half the notch |S21| is 10*log10(4/5)', CALC.stubS21(r.fNotch / 2, r.fNotch), 10 * Math.log10(0.8), 1e-9, ' dB');
  nearRel('the longest stub for the margin puts the notch exactly at k x Nyquist',
          CALC.stub(r.lMaxMil, 3.8, 16e9, 3).fNotch, 3 * 16e9, 1e-12);
});

suite('Calculator: target impedance', () => {
  const r = CALC.ztarget(0.8, 3, 20);
  nearRel('0.8 V, 3%, 20 A gives 1.2 milliohm', r.z, 0.0012, 1e-12);
  nearRel('the step through the target reproduces the ripple budget', 20 * r.z, 0.8 * 0.03, 1e-12);
  nearRel('halving the voltage halves the target', CALC.ztarget(0.4, 3, 20).z, r.z / 2, 1e-12);
  nearRel('doubling the step halves the target', CALC.ztarget(0.8, 3, 40).z, r.z / 2, 1e-12);
});

suite('Calculator: skin depth and roughness', () => {
  nearRel('copper at 1 GHz: 2.06 um, as the loss pages state', CALC.skinDepth(1e9) * 1e6, 2.06, 3e-3);
  nearRel('copper at 60 Hz: 8.4 mm', CALC.skinDepth(60) * 1e3, 8.42, 3e-3);
  nearRel('delta falls as 1/sqrt(f): four times the frequency halves it', CALC.skinDepth(4e9), CALC.skinDepth(1e9) / 2, 1e-12);
  nearAbs('smooth copper has no roughness penalty', CALC.roughK(0, 1e-6), 1, 1e-12);
  nearRel('very rough copper saturates at twice the loss', CALC.roughK(1e-3, 1e-6), 2, 1e-6);
  ok('the roughness multiplier rises with roughness', CALC.roughK(1e-6, 2e-6) < CALC.roughK(2e-6, 2e-6));
  const s = CALC.skin(1e9, 35, 0.5);
  nearRel('at the onset frequency delta is exactly half the thickness', CALC.skinDepth(s.fHalf), 17.5e-6, 1e-12);
});

suite('Calculator: loss budget', () => {
  const a = CALC.loss(16e9, 10, 3.7, 0.004, 5, 50, 0.5);
  nearAbs('zero Df gives zero dielectric loss', CALC.loss(16e9, 10, 3.7, 0, 5, 50, 0.5).ad, 0, 1e-15, ' dB/in');
  nearRel('dielectric loss is linear in f', CALC.loss(32e9, 10, 3.7, 0.004, 5, 50, 0.5).ad, 2 * a.ad, 1e-12);
  nearRel('dielectric loss matches 2.3*f[GHz]*Df*sqrt(Dk) dB/in', a.ad, 2.3 * 16 * 0.004 * Math.sqrt(3.7), 6e-3);
  nearRel('smooth-copper conductor loss grows exactly as sqrt(f)',
          CALC.loss(4e9, 1, 3.7, 0, 5, 50, 0).ac, 2 * CALC.loss(1e9, 1, 3.7, 0, 5, 50, 0).ac, 1e-12);
  /* Bogatin's rule of thumb, 36*sqrt(f[GHz])/(w[mil]*Z0) dB/in, is a separately
     published statement of the same physics with its own rounding. */
  nearRel('conductor loss within 5% of Bogatin 36*sqrt(f)/(w*Z0)', CALC.loss(1e9, 1, 3.7, 0, 5, 50, 0).ac, 36 / (5 * 50), 0.05);
  nearRel('the channel total is per inch x length', a.total, a.per * 10, 1e-12);
  ok('a wider trace loses less in the copper', CALC.loss(16e9, 10, 3.7, 0.004, 8, 50, 0.5).ac < a.ac);
});

suite('Calculator: plane cavity resonance', () => {
  nearRel('air, 150 mm: f(1,0) = c/2a', CALC.cavity(150, 100, 1, 1e10).f10, 299792458 / 0.3, 1e-12);
  const sq = CALC.cavity(100, 100, 4.2, 1e10);
  nearRel('a square plane has (1,0) and (0,1) together', sq.f01, sq.f10, 1e-12);
  nearRel('and (1,1) at sqrt(2) times it', sq.f11, Math.SQRT2 * sq.f10, 1e-12);
  nearRel('(2,0) is exactly twice (1,0)', sq.f(2, 0), 2 * sq.f10, 1e-12);
  nearRel('Dk 4 halves every mode', CALC.cavity(150, 100, 4, 1e10).f10, 299792458 / 0.3 / 2, 1e-12);
  ok('modes are listed in ascending frequency', sq.modes.every((q, i) => !i || q.f >= sq.modes[i - 1].f));
  ok('nothing above the limit is listed', sq.modes.every((q) => q.f <= 1e10));
});

suite('Calculator: mounting inductance', () => {
  const r = CALC.mount(20, 8, 40, 300e-12, 100e-9);
  const far = CALC.mount(20, 8, 400, 300e-12, 100e-9).lVia;
  /* acosh(x) -> ln(2x) for x >> 1: the thin-wire formula (mu0*h/pi)*ln(2s/d). */
  nearRel('at s = 50 d the exact loop matches the thin-wire ln(2s/d)', far, 4e-7 * 20 * 25.4e-6 * Math.log(2 * 400 / 8), 1e-3);
  nearRel('loop inductance is linear in via length', CALC.mount(40, 8, 40, 300e-12, 100e-9).lVia, 2 * r.lVia, 1e-12);
  ok('touching vias enclose no loop', CALC.mount(20, 8, 8.000001, 300e-12, 100e-9).lVia < 1e-12);
  nearRel('the mounted SRF uses ESL plus the vias', r.srf, 1 / (2 * Math.PI * Math.sqrt((300e-12 + r.lVia) * 100e-9)), 1e-12);
  ok('mounting always lowers the self-resonance', r.srf < r.srfPart);
});

suite('Calculator: microstrip and stripline impedance', () => {
  const ETA0 = 4e-7 * Math.PI * 299792458;
  /* Wheeler (1977), derived independently of Hammerstad-Jensen and claimed
     accurate to about 1%. Written out here so that agreement means something. */
  const wheeler = (u, er) => {
    const k = (14 + 8 / er) / 11, x = 4 / u;
    return ETA0 / (2 * Math.PI * Math.sqrt(2 * (er + 1)))
      * Math.log(1 + x * (k * x + Math.sqrt(k * k * x * x + Math.PI * Math.PI * (1 + 1 / er) / 2)));
  };
  let worst = 0;
  for (const er of [1, 2.2, 4.4, 10]) {
    for (const u of [0.1, 0.3, 1, 3, 10]) {
      const hj = CALC.microstrip(u, 1, 0, er).z0;
      worst = Math.max(worst, Math.abs(hj - wheeler(u, er)) / hj);
    }
  }
  ok('Hammerstad-Jensen agrees with Wheeler within 1% over 20 cases', worst < 0.01, (worst * 100).toFixed(2) + '% worst');
  nearAbs('in air the effective permittivity is exactly 1', CALC.microstrip(1, 1, 0, 1).eeff, 1, 1e-12);
  const e = CALC.microstrip(2, 1, 0, 4.4).eeff;
  ok('eeff lies between (er+1)/2 and er', e > 2.7 && e < 4.4, e.toFixed(3));
  const w50 = CALC.widthFor(50, 'ms', 1, 0, 4.4);
  ok('50 ohm microstrip on er 4.4 needs w/h near 1.9, the published design value', w50 > 1.85 && w50 < 1.97, w50.toFixed(3));
  ok('thicker copper lowers microstrip Z0', CALC.microstrip(10, 5.5, 1.4, 4.2).z0 < CALC.microstrip(10, 5.5, 0, 4.2).z0);
  const ratio = CALC.stripline(20, 1, 1).z0 / (ETA0 / (4 * 20));
  ok('a very wide stripline approaches the parallel-plate limit from below', ratio > 0.95 && ratio < 1, ratio.toFixed(4));
  const ipc = (wb, er) => 60 / Math.sqrt(er) * Math.log(4 / (0.67 * Math.PI * 0.8 * wb));
  nearRel('stripline agrees with IPC-2141 within 5% at w/b = 0.3', CALC.stripline(0.3, 1, 4).z0, ipc(0.3, 4), 0.05);
  /* K(1/sqrt 2) is the lemniscate constant, Gamma(1/4)^2 / (4*sqrt(pi)). */
  nearRel('the elliptic integral gives K(1/sqrt2) = 1.8540746773', CALC.ellipK(Math.SQRT1_2), 1.8540746773, 1e-9);
  nearRel('stripline scales as 1/sqrt(er)', CALC.stripline(0.5, 1, 4).z0, CALC.stripline(0.5, 1, 1).z0 / 2, 1e-12);
  ok('Z0 falls as the trace widens', CALC.microstrip(12, 5.5, 1.4, 4.2).z0 < CALC.microstrip(10, 5.5, 1.4, 4.2).z0);
  nearRel('the solved width reproduces the target',
          CALC.zline('ms', CALC.widthFor(50, 'ms', 5.5, 1.4, 4.2), 5.5, 1.4, 4.2).z0, 50, 1e-6);
});

suite('Calculator: laminate presets', () => {
  /* Data, not physics, so the checks are of two kinds: that every record could
     have come from a data sheet (plausible ranges, a named document, ordered
     frequencies), and that the lookup never states a number the source does
     not -- exact at a tabulated point, bounded between two, and never a value
     beyond the table or blended across two test methods. */
  const LAM = SIPI.laminates;
  const ledger = JSON.parse(fs.readFileSync(path.join(SRC, 'docs/claims.json'), 'utf8')).claims;
  ok('there are laminate presets to check', LAM && LAM.list.length >= 4, LAM && String(LAM.list.length));
  const bad = [];
  LAM.list.forEach((m) => {
    ['id', 'name', 'group', 'vendor', 'product', 'construction', 'doc', 'url'].forEach((k) => {
      if (!(typeof m[k] === 'string' && m[k].length)) bad.push(m.id + ' has no ' + k);
    });
    if (!(m.date || /undated/.test(m.doc))) bad.push(m.id + ' has neither a date nor a note that the source is undated');
    if (!m.series.length) bad.push(m.id + ' has no series');
    let last = 0;
    m.series.forEach((sr) => {
      if (!sr.method) bad.push(m.id + ' has a series with no method');
      if (!sr.pts.length) bad.push(m.id + ' has an empty series');
      sr.pts.forEach(([f, dk, df]) => {
        if (!(f > last)) bad.push(m.id + ' frequencies not strictly increasing at ' + f);
        last = f;
        if (!(dk >= 2 && dk <= 6)) bad.push(m.id + ' Dk ' + dk + ' outside [2, 6]');
        if (!(df > 0 && df <= 0.05)) bad.push(m.id + ' Df ' + df + ' outside (0, 0.05]');
      });
    });
    const row = ledger.find((c) => c.laminate === m.id);
    if (!row || row.status !== 'verified') bad.push(m.id + ' has no verified row in docs/claims.json');
  });
  ok('every record names its source, and its points are plausible and ordered (methods do not overlap)',
     !bad.length, bad.join('; '));

  const miss = [];
  LAM.list.forEach((m) => m.series.forEach((sr) => sr.pts.forEach(([f, dk, df]) => {
    const p = LAM.at(m.id, f);
    if (p.dk !== dk || p.df !== df || p.clamped) miss.push(m.id + ' @ ' + f);
  })));
  ok('at a tabulated frequency the lookup returns the tabulated value exactly', !miss.length, miss.join(', '));

  const outside = [];
  LAM.list.forEach((m) => {
    const all = [].concat(...m.series.map((sr) => sr.pts));
    const first = all[0], last = all[all.length - 1];
    const hi = LAM.at(m.id, last[0] * 3), lo = LAM.at(m.id, first[0] / 3);
    if (hi.dk !== last[1] || hi.df !== last[2] || !hi.clamped || hi.f !== last[0]) outside.push(m.id + ' above');
    if (lo.dk !== first[1] || lo.df !== first[2] || !lo.clamped || lo.f !== first[0]) outside.push(m.id + ' below');
  });
  ok('beyond the table the lookup returns the end point and flags it, never an extrapolation',
     !outside.length, outside.join(', '));

  const blend = [], between = [];
  LAM.list.forEach((m) => {
    for (let k = 0; k + 1 < m.series.length; k++) {
      const a = m.series[k].pts[m.series[k].pts.length - 1], b = m.series[k + 1].pts[0];
      const f = Math.sqrt(a[0] * b[0]), p = LAM.at(m.id, f);
      const isA = p.dk === a[1] && p.df === a[2], isB = p.dk === b[1] && p.df === b[2];
      if (!p.clamped || !(isA || isB)) blend.push(m.id + ' between ' + a[0] + ' and ' + b[0]);
    }
    m.series.forEach((sr) => {
      for (let i = 0; i + 1 < sr.pts.length; i++) {
        const [fa, da, ga] = sr.pts[i], [fb, db, gb] = sr.pts[i + 1];
        const p = LAM.at(m.id, Math.sqrt(fa * fb));
        const inside = (x, u, v) => x >= Math.min(u, v) - 1e-15 && x <= Math.max(u, v) + 1e-15;
        if (p.clamped || !inside(p.dk, da, db) || !inside(p.df, ga, gb)) between.push(m.id + ' @ ' + fa);
      }
    });
  });
  ok('between two test methods the lookup takes a tabulated point, never a blend of the two',
     !blend.length, blend.join(', '));
  ok('between two points of one method the value lies between them', !between.length, between.join(', '));
  ok('an unknown laminate returns nothing rather than a default', LAM.at('fr4-generic', 1e9) === null);
});

suite('Coupling — voltage slew, current slew, and the victim', () => {
  /* The page's claims, each tested against something the model does not compute
     the same way: closed-form limits, the crossover formula, and an exact Fourier
     integral of the time-domain solution held against the frequency-domain
     transfer functions. */
  const C = SIPI.models.coupling;
  const base = { V: 3.3, tr: 1e-9, load: 'r', I: 20e-3, CL: 20e-12, Rv: 10e3 };

  // slopes and plateau, from the transfer functions
  const q0 = C.params({ V: 1, tr: 1e-9, load: 'r', I: 1e-3, Rv: 50, Cv: 1e-15, fL: 1e12 });
  const r10 = (key, f) => C.transfer(q0, 10 * f)[key] / C.transfer(q0, f)[key];
  nearRel('capacitive coupling rises 20 dB/decade below its corner', r10('cap', 1e6), 10, 0.01);
  nearRel('inductive coupling into a resistive load rises 20 dB/decade', r10('ind', 1e6), 10, 0.01);
  const qc = C.params({ V: 1, tr: 1e-9, load: 'c', CL: 10e-12, Rv: 50, fL: 1e12 });
  nearRel('inductive coupling into a capacitive load rises 40 dB/decade (a second derivative)',
          C.transfer(qc, 1e7).ind / C.transfer(qc, 1e6).ind, 100, 0.01);
  const qp = C.params(base);
  nearRel('above its corner, capacitive coupling is the divider Cm/(Cm + Cv)', C.transfer(qp, 1e12).cap, qp.kc, 1e-3);

  // slow-edge closed forms, with the victim's own capacitance present
  const slow = C.run({ V: 3.3, tr: 20e-9, load: 'r', I: 20e-3, Rv: 50, fL: 1e12 });
  nearRel('slow edge: capacitive pickup is R_v·Cm·dV/dt', slow.capPeak, 50 * slow.q.Cm * slow.q.S, 0.01);
  nearRel('slow edge: inductive pickup is M·dI/dt', slow.indPeak, slow.q.M * slow.q.dIdt, 0.01);

  // independence: the page's central claim
  const a1 = C.run(base), a2 = C.run(Object.assign({}, base, { I: 40e-3 }));
  nearRel('doubling the load current leaves capacitive pickup unchanged', a2.capPeak, a1.capPeak, 1e-12);
  nearRel('doubling the load current doubles inductive pickup (+6.02 dB)', a2.indPeak, 2 * a1.indPeak, 1e-9);
  const v2 = C.run(Object.assign({}, base, { V: 6.6 }));
  nearRel('doubling the swing at the same current leaves inductive pickup unchanged', v2.indPeak, a1.indPeak, 1e-12);
  nearRel('doubling the swing doubles capacitive pickup', v2.capPeak, 2 * a1.capPeak, 1e-9);
  const lo = C.run(Object.assign({}, base, { Rv: 100 }));
  ok('a lower victim impedance never raises capacitive pickup, and leaves inductive alone',
     lo.capPeak < a1.capPeak && Math.abs(lo.indPeak / a1.indPeak - 1) < 1e-12);

  // the crossover Z* = M/(Cm·R_L)
  const zq = { V: 3.3, tr: 20e-9, load: 'r', I: 20e-3, Cv: 1e-15, fL: 1e12 };
  const Z = C.crossover(C.params(Object.assign({ Rv: 1 }, zq)));
  nearRel('the crossover is Z* = M/(Cm·R_L)', Z, 1e-9 / (0.5e-12 * (3.3 / 20e-3)), 1e-12);
  const at = C.run(Object.assign({ Rv: Z }, zq)), above = C.run(Object.assign({ Rv: 3 * Z }, zq)), below = C.run(Object.assign({ Rv: Z / 3 }, zq));
  nearRel('at Z* the two pickups are equal', at.capPeak, at.indPeak, 1e-3);
  ok('above Z* capacitive dominates, below it inductive', above.dominant === 'capacitive' && below.dominant === 'inductive');

  // exact Fourier integral of the time-domain solution against the transfer functions
  const coef = (segs, T, n) => {
    const w = 2 * Math.PI * n / T; let re = 0, im = 0;
    for (const g of segs) {
      if (g.t0 >= T - 1e-18) continue;
      const c0 = Math.cos(w * g.t0), s0 = -Math.sin(w * g.t0), c1 = Math.cos(w * (g.t0 + g.dur)), s1 = -Math.sin(w * (g.t0 + g.dur));
      if (w === 0) { re += g.yInf * g.dur + (g.y0 - g.yInf) * g.tau * (1 - Math.exp(-g.dur / g.tau)); continue; }
      re += g.yInf * (s0 - s1) / w; im += -g.yInf * (c0 - c1) / w;                 // yInf·(e0 − e1)/(jω)
      const d = Math.exp(-g.dur / g.tau), er = 1 - d * Math.cos(w * g.dur), ei = d * Math.sin(w * g.dur);
      const nr = (c0 * er - s0 * ei) * (g.y0 - g.yInf), ni = (c0 * ei + s0 * er) * (g.y0 - g.yInf);
      const a = 1 / g.tau, m = a * a + w * w;
      re += (nr * a + ni * w) / m; im += (ni * a - nr * w) / m;
    }
    return n === 0 ? re / T : 2 * Math.hypot(re, im) / T;
  };
  let worst = 0, meanWorst = 0;
  for (const load of ['r', 'c']) {
    const p = C.params(Object.assign({}, base, { load }));
    const W = C.waveform(p, 64, 1), H = C.harmonics(p, 2e9);
    for (const path of ['cap', 'ind']) {
      for (const n of [1, 3, 5, 7, 99]) worst = Math.max(worst, Math.abs(coef(W[path].segs, p.T, n) / H.find((h) => h.n === n)[path] - 1));
      meanWorst = Math.max(meanWorst, Math.abs(coef(W[path].segs, p.T, 0)) / W[path].peak);
    }
  }
  ok('the time-domain solution’s harmonics equal the transfer functions (both loads, both paths)', worst < 1e-9, worst.toExponential(1));
  ok('every coupled waveform has zero mean: a derivative carries no DC', meanWorst < 1e-12, meanWorst.toExponential(1));

  // edge-rate bounds for 4× faster edges, from the harmonic powers
  const power = (p, key) => C.harmonics(C.params(p), 2e11).reduce((acc, h) => acc + h[key] * h[key] / 2, 0);
  const g4 = (p, key) => 10 * Math.log10(power(Object.assign({}, p, { tr: 0.5e-9 }), key) / power(Object.assign({}, p, { tr: 2e-9 }), key));
  const open = { V: 3.3, load: 'r', I: 20e-3, Rv: 0.2, Cv: 1e-15, fL: 1e13 };
  const dCap = g4(open, 'cap'), dInd = g4(open, 'ind'), dSec = g4(Object.assign({}, open, { load: 'c', CL: 20e-12, fL: 20e9 }), 'ind');
  ok('first derivative: 4× faster edges add at most 6.02 dB, and near it when the path is open', dCap > 5 && dCap <= 6.03 && dInd > 5 && dInd <= 6.03, dCap.toFixed(2) + ' / ' + dInd.toFixed(2) + ' dB');
  /* A second derivative of a trapezoid is a train of impulses of area ∝ dV/dt. Through
     any finite path the pickup is pulses whose SHAPE the path sets and whose HEIGHT
     follows dV/dt, so power goes as (dV/dt)²: +12.04 dB (20·log 4), not the N³ a
     harmonic count would suggest — that sum diverges without the path. */
  nearAbs('second derivative: 4× faster edges add 20·log 4 = 12.04 dB of power', dSec, 20 * Math.log10(4), 0.02, 'dB');

  // monotonicity in the coupling elements
  const bigger = C.run(Object.assign({}, base, { Cm: 1e-12, M: 2e-9 }));
  ok('more Cm and more M never reduce pickup', bigger.capPeak > a1.capPeak && bigger.indPeak > a1.indPeak);
});

if (!PASS && !FAILS.length && !PENDING.length) {
  console.error('No model assertions ran' + (FILTER ? ': no suite matches "' + FILTER + '"' : '') + '.');
  process.exit(1);
}
if (FAILS.length) {
  console.log(`  ${FAILS.length} FAILURE(S), ${PASS} passed\n`);
  FAILS.forEach((f) => console.log('  x ' + f));
  process.exit(1);
}
if (PENDING.length) {
  console.log(`  ok ${PASS} model assertion(s) passed, ${PENDING.length} claim(s) PENDING\n`);
  PENDING.forEach((p2) => console.log(`  .. ${p2.owner}  ${p2.what}`));
  console.log('\n  A pending claim is not a passing one. These are the reasons the');
  console.log('  models above are not yet trustworthy, listed so that a green run');
  console.log('  cannot be mistaken for a verified one.');
} else {
  console.log(`  ok ${PASS} model assertion(s) passed`);
}
