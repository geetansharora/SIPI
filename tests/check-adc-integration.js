#!/usr/bin/env node
/* Lab D · ADC interference — scenario regressions.
 *
 * These are REGRESSION GUARDS, not independent benchmarks. Each one recomputes a
 * named scenario with the model and asserts that the guide, the prose or the
 * scenario's own note still quotes the number that scenario produces. They cannot
 * tell you the model is right; they tell you the page has not drifted from it.
 *
 * The physics assertions live in check-models.js, in the eight suites named ADC
 * SAR, ADC delta-sigma, ADC aliasing, ADC coupling, ADC decimation, ADC metrics,
 * ADC reference coupling and ADC domain. The page's closed-form numbers — folds,
 * beats, quantization limits, sinc-cubed nulls, kT/C — live in check-numbers.py,
 * where a derivable number belongs. 21 of them moved there; what is left here is
 * every value that comes out of a simulation, plus the handful of closed forms
 * with no unique anchor in the prose.
 *
 *   node tests/check-adc-integration.js
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
/* The mutation harness runs this from the real repository and points it at a copy
   through SIPI_SRC, exactly as it does for check-models.js. Without honouring that,
   a planted defect is never read and the gate reports that it survived. */
const ROOT = process.env.SIPI_SRC || path.join(__dirname, '..');
const REF = require('./adc-references.js');
const { TAU, foldRef, trapezoidHarmonic, toneFit, lcg } = REF;
const dB20 = (v) => 20 * Math.log10(v);

global.window = { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
global.document = { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
                    createElement: () => ({ style: {}, classList: { add() {}, toggle() {} },
                                            setAttribute() {}, appendChild() {}, addEventListener() {} }) };
global.getComputedStyle = () => ({ getPropertyValue: () => '' });
for (const f of ['js/viz-kit.js', 'js/models/adc-model.js', 'js/viz/adc-lab.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}
const A = window.SIPI.models.adcLab;

const PAGE = path.join(ROOT, 'topics/labs/adc-interference.html');
function pageText() {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ' };
  return fs.readFileSync(PAGE, 'utf8')
    .replace(/<script[^>]*data-contract[^>]*>[\s\S]*?<\/script>/, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&(\w+);/g, (m, n) => named[n] || m)
    .replace(/\s+/g, ' ');
}

const SAR = {
  arch: 'sar', bits: 16, fs: 1e6, vref: 2.5, noiseUv: 0, inFreq: 10e3, inDbfs: -1,
  fmod: 256e3, osr: 128, aggAmp: 1.8, aggMode: 'free', aggFreq: 4.13e6, aggMultiple: 4,
  aggPpm: 0, aggPhase: 90, edge: 1e-9, path: 'none', couplingDb: -80,
  couplingType: 'flat', pathBw: 20e6
};
const with_ = (base, o) => Object.assign({}, base, o);

const RESULTS = [];
function check(name, fn) {
  const [ok, detail] = fn();
  RESULTS.push({ name, ok, detail });
  console.log((ok ? '  ok   ' : '  FAIL ') + name + '\n       ' + detail);
}

/* Selected scenarios, not a theorem. Over the range this lab offers, slowing the
   edge under capacitive coupling helps and never hurts; under flat coupling it
   barely moves. Both are claims about these five edge times at this aggressor
   frequency and this path bandwidth, and the page says so. */
check('over the tested range, a slower edge helps under capacitive coupling and barely moves flat coupling', () => {
    const base = with_(SAR, { record: 14, path: 'input', couplingDb: -60, aggFreq: 4.1273e6, pathBw: 200e6 });
    const edges = [0.3e-9, 1e-9, 3e-9, 10e-9, 30e-9];
    const cap = edges.map((e) => A.run(with_(base, { couplingType: 'capacitive', edge: e })).measurements.snr);
    const flat = edges.map((e) => A.run(with_(base, { couplingType: 'flat', edge: e })).measurements.snr);
    const mono = cap.every((s, i) => i === 0 || s >= cap[i - 1] - 0.3);
    const spread = Math.max(...flat) - Math.min(...flat);
    return [mono && cap[4] - cap[0] >= 6 && spread <= 1.5,
      `capacitive ${cap.map((s) => s.toFixed(1)).join(' → ')} dB; flat spread ${spread.toFixed(2)} dB`];
  });

check('every simulated number in the lesson, the guide and the scenario notes matches the run that produced it', () => {
  const lab = global.window.SIPI.viz.adcLab, text = pageText();
  const runs = {};
  const run = (id, extra) => {
    const key = id + JSON.stringify(extra || {});
    return runs[key] || (runs[key] = A.run(Object.assign({}, lab.base, lab.presets[id].set, extra || {})));
  };
  const m = (id, extra) => run(id, extra).measurements;
  const sharedRuns = {};
  const shared = (o) => {
    const key = JSON.stringify(o);
    return sharedRuns[key] || (sharedRuns[key] = A.run(Object.assign({}, lab.base, { aggMode: 'clock', aggMultiple: 1 }, o)).measurements);
  };
  const neg = (s) => s.replace(/^-/, '−');
  const sinc3dB = (f) => 20 * Math.log10(Math.pow(Math.abs(Math.sin(Math.PI * f / 10) / (256 * Math.sin(Math.PI * f / 2560))), 3));
  const kTC = Math.sqrt(1.380649e-23 * 300 / 10e-12);
  const ideal16 = 20 * Math.log10(65536) + 10 * Math.log10(1.5);
  const fund = 4 / Math.PI * 0.9;
  const claims = [
    // closed forms without a unique anchor in the prose, or present only in the guide
    ['page', 'harmonics 5, 7 and 9 of a 20 Hz beat', null, () => [5, 7, 9].map((n) => n * 20).join(', ').replace(/, (\d+)$/, ' and $1') + ' Hz'],
    ['note:sar-slow', 'corner for 10 ns', 0.8 / (Math.PI * 10e-9) / 1e6, (v) => 'above ' + v.toFixed(0) + ' MHz'],
    ['note:sar-fast', 'corner for 10 ns', 0.8 / (Math.PI * 10e-9) / 1e6, (v) => 'at ' + v.toFixed(0) + ' MHz'],
    ['page', 'harmonic 251 of 51 Hz, 20 ppm off', 251 * 51 * (1 + 20e-6), (v) => v.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' Hz'],
    ['page', 'ideal 16-bit SNR 1 dB below full scale', ideal16 - 1, (v) => v.toFixed(1) + ' dB'],
    ['page', 'second-order limit at OSR 64', 20 * Math.log10(2) + 10 * Math.log10(1.5) - 10 * Math.log10(Math.pow(Math.PI, 4) / 5) + 50 * Math.log10(64), (v) => v.toFixed(1) + ' dB'],
    ['page', 'in dBFS for ±2.5 V', 20 * Math.log10(fund * 1e-4 / 2.5), (v) => neg(v.toFixed(1)) + ' dBFS'],
    ['page', 'a 20 MHz pole at 4.1273 MHz', 10 * Math.log10(1 + Math.pow(4.1273 / 20, 2)), (v) => v.toFixed(1) + ' dB'],
    ['page', 'sinc³ response at 51 Hz', sinc3dB(51), (v) => neg(v.toFixed(1)) + ' dB'],
    ['page', 'sinc³ response at 55 Hz', sinc3dB(55), (v) => neg(v.toFixed(1)) + ' dB'],
    ['page', '|1 − z⁻¹|² power gain at half the clock', Math.pow(Math.pow(2, 2), 2), (v) => v + ' times'],
    // regression guards: the scenarios' own runs
    ['page', 'edge-rate SNR difference', m('sar-slow').snr - m('sar-fast').snr, (v) => v.toFixed(1) + ' dB'],
    ['page', 'reference ripple SNR', null, () => m('ds-ref').snrClean.toFixed(1) + ' to ' + m('ds-ref').snr.toFixed(1) + ' dB'],
    ['page', '51 Hz square wave SNR loss', m('ds-offnotch').snrLoss, (v) => v.toFixed(1) + ' dB'],
    ['page', 'a 1-bit loop under the linear model', m('ds-clean').idealSnr - m('ds-clean').snrClean, (v) => v.toFixed(1) + ' dB'],
    ['page', 'the lab’s fold scenario spur', m('sar-fold').interferenceDbfs, (v) => neg(v.toFixed(1)) + ' dBFS'],
    ['page', 'guide: SNR against clean', null, () => m('sar-fold').snr.toFixed(1) + ' dB against ' + m('sar-fold').snrClean.toFixed(1) + ' dB'],
    ['page', 'guide: coupled level at the pin', run('sar-fold').generated.harmonics[0].amp * 1e6, (v) => v.toFixed(0) + ' µV'],
    ['page', 'the 50 Hz square wave on the notch', m('ds-notch').snrLoss, (v) => 'yet costs ' + v.toFixed(1) + ' dB'],
    ['page', 'guide: the fold including the aggressor error', foldRef(4.1273e6 * (1 + 20e-6), 1e6) / 1e3, (v) => 'At ' + v.toFixed(1) + ' kHz'],
    ['page', 'guide: the GPIO scenario SNR', m('sar-gpio').snr, (v) => 'SNR ' + v.toFixed(1) + ' dB'],
    // the offset, gain and linearity section: a shared clock at exactly 1 MHz on the SAR
    ['page', 'LSB of 16 bits over ±2.5 V', 5 / 65536 * 1e6, (v) => '118 LSB of ' + v.toFixed(1) + ' µV'],
    ['page', 'input-coupled shared-clock offset', shared({ path: 'input', couplingDb: -40, aggPhase: 180 }).offset * 1e3, (v) => 'offset +' + v.toFixed(1) + ' mV'],
    ['page', 'that offset in LSB', shared({ path: 'input', couplingDb: -40, aggPhase: 180 }).offsetLsb, (v) => v.toFixed(0) + ' LSB of'],
    ['page', 'reference gain error', shared({ path: 'reference', couplingDb: -20, aggPhase: 180 }).signalDbfs, (v) => 'reads ' + neg(v.toFixed(2)) + ' dBFS instead of \u22121.00 dBFS'],
    ['page', 'the reference that gain implies', 2.5 - 1.8 * 0.1 / 2, (v) => 'reference were ' + v.toFixed(2) + ' V'],
    ['page', 'THD with an edge in the bit trials', null, () => 'THD rises from ' + neg(shared({ path: 'none' }).thd.toFixed(1)) + ' dB to ' + neg(shared({ path: 'reference', couplingDb: -20, aggPhase: 270 }).thd.toFixed(1)) + ' dB'],
    ['page', 'SINAD with an edge in the bit trials', null, () => 'SINAD falls from ' + shared({ path: 'none' }).sinad.toFixed(1) + ' dB to ' + shared({ path: 'reference', couplingDb: -20, aggPhase: 270 }).sinad.toFixed(1) + ' dB'],
    ['page', 'the same 40 dB down', shared({ path: 'reference', couplingDb: -40, aggPhase: 270 }).sinad, (v) => 'SINAD still falls to ' + v.toFixed(1) + ' dB'],
    ['page', 'GPIO offset wander over phase', null, () => {
      const offs = [0, 45, 90, 135, 180, 225, 270, 315].map((ph) => m('sar-gpio', { aggPhase: ph }).offset * 1e3);
      return 'between ' + neg(Math.min.apply(null, offs).toFixed(2)) + ' and +' + Math.max.apply(null, offs).toFixed(2) + ' mV';
    }],
    ['note:sar-clean', 'SNR', m('sar-clean').snr, (v) => v.toFixed(1) + ' dB'],
    ['note:sar-fold', 'pin level', run('sar-fold').generated.harmonics[0].amp * 1e6, (v) => v.toFixed(0) + ' µV'],
    ['note:sar-fold', 'where it lands', foldRef(m('sar-fold').aggressorFrequency, 1e6) / 1e3, (v) => v.toFixed(1) + ' kHz'],
    ['note:sar-fold', 'spur', m('sar-fold').interferenceDbfs, (v) => neg(v.toFixed(1)) + ' dBFS'],
    ['note:sar-fold', 'SNR fall', null, () => m('sar-fold').snrClean.toFixed(1) + ' to ' + m('sar-fold').snr.toFixed(1) + ' dB'],
    ['note:sar-locked', 'SNR', m('sar-locked').snr, (v) => v.toFixed(1) + ' dB'],
    ['note:sar-locked', 'offset', m('sar-locked').offset * 1e3, (v) => '+' + v.toFixed(2) + ' mV'],
    ['note:sar-locked', 'offset in LSB', m('sar-locked').offsetLsb, (v) => v.toFixed(1) + ' LSB'],
    ['note:sar-locked', 'offset at 0°', m('sar-locked', { aggPhase: 0 }).offset * 1e3, (v) => neg(v.toFixed(2)) + ' mV'],
    ['note:sar-gpio', 'beat', m('sar-gpio').slowBeat, (v) => 'beats at ' + v.toFixed(0) + ' Hz'],
    ['note:sar-gpio', 'offset in this record', m('sar-gpio').offset * 1e3, (v) => '+' + v.toFixed(2) + ' mV'],
    ['note:sar-gpio', 'SNR', m('sar-gpio').snr, (v) => 'SNR ' + v.toFixed(1) + ' dB'],
    ['note:ds-notch', 'SNR fall', null, () => m('ds-notch').snrClean.toFixed(1) + ' to ' + m('ds-notch').snr.toFixed(1) + ' dB'],
    ['note:ds-offnotch', 'harmonic 251', 251 * m('ds-offnotch').aggressorFrequency, (v) => v.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' Hz'],
    ['note:ds-ref', 'offset from half the clock', 128e3 - m('ds-ref').aggressorFrequency, (v) => v.toFixed(1) + ' Hz below half'],
    ['note:sar-slow', 'SNR', m('sar-slow').snr, (v) => v.toFixed(1) + ' dB'],
    ['note:sar-fast', 'SNR', m('sar-fast').snr, (v) => v.toFixed(1) + ' dB'],
    ['note:sar-fast', 'difference', m('sar-slow').snr - m('sar-fast').snr, (v) => v.toFixed(1) + ' dB'],
    ['note:sar-ref', 'SNR', m('sar-ref').snr, (v) => v.toFixed(0) + ' dB'],
    ['note:ds-clean', 'SNR', m('ds-clean').snr, (v) => v.toFixed(1) + ' dB'],
    ['note:ds-clean', 'linear model', m('ds-clean').idealSnr, (v) => v.toFixed(1) + ' dB'],
    ['note:ds-clean', 'shortfall', m('ds-clean').idealSnr - m('ds-clean').snr, (v) => v.toFixed(1) + ' dB'],
    ['note:ds-notch', 'pin level', run('ds-notch').generated.harmonics[0].pinDbfs, (v) => neg(v.toFixed(1)) + ' dBFS'],

    ['note:ds-offnotch', 'SNR', m('ds-offnotch').snr, (v) => v.toFixed(1) + ' dB'],
    ['note:ds-clock', 'SNR fall', null, () => m('ds-clock').snrClean.toFixed(1) + ' to ' + m('ds-clock').snr.toFixed(1) + ' dB'],
    ['note:ds-ref', 'SNR fall', null, () => m('ds-ref').snrClean.toFixed(1) + ' to ' + m('ds-ref').snr.toFixed(1) + ' dB']
  ];
  const missing = claims.filter(([where, , value, fmt]) => {
    const want = fmt(value);
    const hay = where === 'page' ? text : lab.presets[where.slice(5)].note;
    return !hay.includes(want);
  }).map(([where, what, value, fmt]) => where + ' — ' + what + ': expected “' + fmt(value) + '”');
  return [missing.length === 0, missing.length ? missing.join('; ') : claims.length + ' numbers found where their formula or scenario puts them'];
});

const failures = RESULTS.filter((r) => !r.ok);
console.log('\nADC integration: ' + (RESULTS.length - failures.length) + ' of ' + RESULTS.length
          + ' scenario regressions passed.');
if (failures.length) {
  /* Same shape the mutation harness reads, so a planted defect in what the page
     says can be required to fail THIS assertion and not merely turn the run red. */
  failures.forEach((r) => console.log('  x ' + r.name + ' — ' + r.detail));
  process.exit(1);
}
