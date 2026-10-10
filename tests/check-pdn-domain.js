#!/usr/bin/env node
'use strict';
/* Lab C across its control ranges, not at six chosen corners.
 *
 * tests/check-pdn-multi.js checks six hand-picked corners against the
 * independent reference. A corner list only answers the questions somebody
 * thought to ask, and on 10 Oct 2026 a seeded sweep across every control range
 * found the one nobody had: with a slow regulator, the overshoot after the load
 * releases peaked after the measurement window had closed, and the lab reported
 * a fraction of it -- 0.00 mV at the die for a rail that overshot by 367 mV.
 *
 * This keeps that sweep in the gate. For each seeded setting:
 *   1. accuracy   the die and board waveforms, droop and overshoot agree with
 *                 tests/pdn-reference.js (a trapezoidal companion solver sharing
 *                 no code with the model) run at an eighth of the model's step.
 *                 The reference is driven with the model's own DECLARED stimulus
 *                 -- start times and edges rounded to its grid -- because those
 *                 are the times it reports and exports; comparing against
 *                 unrounded times measures the rounding, not the solver (that
 *                 is what made the first run of this sweep read 19%).
 *   2. window     the reported droop and overshoot do not change when the record
 *                 is made four times longer. A measurement may not depend on how
 *                 long the record happened to be; before the ring-down it did.
 *
 * The full 240-setting run behind the numbers in docs/pdn-causal-model.md uses
 * the same code: PDN_DOMAIN_N=240 node tests/check-pdn-domain.js
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const ROOT = path.resolve(__dirname, '..');
global.window = { matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {}, devicePixelRatio: 1 };
global.document = { documentElement: {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) };
global.getComputedStyle = () => ({ getPropertyValue: () => '' });
for (const name of ['viz-kit', 'viz/lab-pdn']) eval(fs.readFileSync(path.join(ROOT, 'js', name + '.js'), 'utf8'));
const { models: M } = window.SIPI, ref = require('./pdn-reference.js');
const budget = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/pdn/two-load-corners.json'))).acceptance;

let seed = Number(process.env.PDN_DOMAIN_SEED || 11);
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a, b, step) => Math.round((a + rnd() * (b - a)) / step) * step;
// The lab's own control ranges (topics/labs/pdn-chain.html); edges are drawn
// down to 200 ps half the time, because fast edges are where the grid refines.
function setting() {
  const p = {
    rvrm: 4, cboard: 1, zt: 10,
    fbw: pick(10, 800, 10), lplane: pick(100, 3000, 50), nboard: Math.round(1 + rnd() * 59),
    esr: pick(2, 150, 2), esl: pick(200, 3000, 50), lpkg: pick(50, 1200, 25), cdie: pick(10, 600, 10),
    imax: Math.round(rnd() * 40), tr: pick(200, 20000, 200) * (rnd() < .5 ? .1 : 1),
    imax2: rnd() < .4 ? 0 : Math.round(rnd() * 40), tr2: pick(200, 20000, 200) * (rnd() < .5 ? .1 : 1),
    startNs: pick(100, 1500, 0.1), widthNs: pick(100, 2500, 1), start2Ns: pick(100, 1500, 0.1), width2Ns: pick(100, 2500, 1)
  };
  p.tr = Math.round(p.tr / 200) * 200 || 200; p.tr2 = Math.round(p.tr2 / 200) * 200 || 200;
  if (!p.imax && !p.imax2) p.imax = 5;
  return p;
}
// The model's declared stimulus, rebuilt in physical time from its reported grid.
function declared(p, which, w, d, n, h) {
  const s = which ? '2' : '', start = w.t0 * d, width = (w.fall - w.t0) * d;
  const edge = Math.max(2, Math.round(p['tr' + s] * 1e-12 / d)) * d;
  const rise = (t) => t <= 0 ? 0 : t >= edge ? 1 : (1 - Math.cos(Math.PI * t / edge)) / 2;
  return Float64Array.from({ length: n }, (_, i) => p['imax' + s] * (rise(i * h - start) - rise(i * h - start - width)));
}

const N = Number(process.env.PDN_DOMAIN_N || 24), worst = { wave: 0, droop: 0, over: 0 };
let late = 0;
for (let k = 0; k < N; k++) {
  const p = setting(), r = M.labPdn(Object.assign({}, p));
  assert.equal(r.status, 'ok', 'setting ' + k + ' measured: ' + (r.why || ''));
  const g = r.generated, h = g.dt / 8, n = g.multi.to * 8;
  const loads = [{ node: 4, current: declared(p, 0, g.wave, g.dt, n, h) }, { node: 2, current: declared(p, 1, g.multi.second, g.dt, n, h) }];
  g.multi.nodes.forEach((q, j) => {
    const v = ref.solve(g.stages, loads[0].current, h, loads, j ? 2 : 4);
    let err = 0, peak = 0, droop = 0, over = 0;
    for (let i = g.multi.start; i < g.multi.to; i++) {
      const x = v[8 * i];
      err = Math.max(err, Math.abs(q.combined[i] - x)); peak = Math.max(peak, Math.abs(x));
      droop = Math.max(droop, -x); over = Math.max(over, x);
    }
    // Compare in-window extremes only where the model's extreme is in the window.
    const st = q.stats[2], rel = (a, b) => Math.abs(a - b) / Math.max(b, 1e-15);
    worst.wave = Math.max(worst.wave, err / peak);
    if (!st.droopAfterWindow) worst.droop = Math.max(worst.droop, rel(st.droop, droop));
    if (!st.overshootAfterWindow && over > 1e-3 * peak) worst.over = Math.max(worst.over, rel(st.overshoot, over));
    if (st.droopAfterWindow || st.overshootAfterWindow) late++;
    assert(err / peak < budget.waveformFraction, `setting ${k} node ${j ? 'board' : 'die'} waveform ${(100 * err / peak).toFixed(3)}%`);
    if (!st.droopAfterWindow) assert(rel(st.droop, droop) < budget.droopFraction, `setting ${k} droop`);
  });
  /* The window check reads the longer record's samples directly rather than its
     reported measurement, which shares the code under test and the same fixed
     window: the response is zero-state, so its extremes are just the largest
     excursions anywhere in the record. A reported extreme may never be smaller
     than one the longer record contains, and where that record outlasts the
     ring-down the two must agree. */
  const longer = M.labPdn(Object.assign({}, p), { dt: g.dt, nt: g.nt * 4 }), span = (g.nt * 4 - 1) * g.dt;
  for (let j = 0; j < 2; j++) {
    const a = r.diagnostics.multi[j][2], trace = longer.generated.multi.nodes[j].combined;
    let droop = 0, over = 0;
    for (const x of trace) { droop = Math.max(droop, -x); over = Math.max(over, x); }
    const where = `setting ${k} node ${j ? 'board' : 'die'}`;
    assert(a.droop >= droop - 1e-6 && a.overshoot >= over - 1e-6,
      `${where}: a longer record holds a larger excursion than the one reported (overshoot ${(over * 1e3).toFixed(3)} mV against ${(a.overshoot * 1e3).toFixed(3)} mV reported)`);
    if (a.observedUntil <= span) assert(Math.abs(a.droop - droop) < 1e-6 && Math.abs(a.overshoot - over) < 1e-6,
      `${where}: the reported extremes differ from a record that outlasts the ring-down`);
  }
}
console.log(`PDN domain: ${N} seeded settings across the control ranges at both nodes. Worst against the independent `
  + `reference: waveform ${(100 * worst.wave).toFixed(3)}%, droop ${(100 * worst.droop).toFixed(3)}%, overshoot `
  + `${(100 * worst.over).toFixed(3)}%. ${late} node result(s) had an extreme after the plotted window; no reported `
  + `extreme is smaller than one a four-times-longer record contains.`);
