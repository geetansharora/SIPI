#!/usr/bin/env node
// Layout regression, not physics validation. Keep dense decade labels readable.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
global.window = { matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {} };
global.document = { documentElement: {}, addEventListener() {}, querySelector: () => null };
global.getComputedStyle = () => ({ getPropertyValue: () => '' });
eval(fs.readFileSync(path.join(__dirname, '../js/viz-kit.js'), 'utf8'));
const K = window.SIPI.kit;
const ticks = Array.from({ length: 7 }, (_, i) => 10 ** (i + 3));
let cases = 0;
for (const width of [160, 236, 320, 640, 1100]) {
  const rows = K.axisLabels(ticks, (v) => 56 + (Math.log10(v) - 3) / 6 * (width - 70),
    (v) => K.fmt.hz(v), (s) => s.length * 6.1, 2, width - 2);
  assert(rows.length >= 2, 'frequency span must keep both endpoints');
  assert.equal(rows[0].value, 1e3);
  assert.equal(rows[rows.length - 1].value, 1e9);
  rows.forEach((row, i) => {
    assert(row.left >= 2 && row.right <= width - 2, 'label fits canvas');
    assert(!i || row.left >= rows[i - 1].right + 8, 'label intervals must not overlap');
  });
  cases++;
}
/* The layout must not be able to change an answer. K.canvasHeight lets the lab
   workspace draw a plot shorter than its module asked for, and the one property
   that has to hold is that nothing measured depends on it: the same model, with an
   override applied and then cleared, must publish identical numbers, and the module
   must go on asking for its own height. Anything a height could change would show
   up here as a different result. */
{
  const models = ['viz/lab-waves.js', 'viz/lab-channel.js', 'viz/lab-pdn.js', 'viz/cdr.js',
                  'models/adc-model.js'];
  for (const m of models) eval(fs.readFileSync(path.join(__dirname, '../js', m), 'utf8'));
  const M = window.SIPI.models;

  const cv = { clientWidth: 400, style: {}, getContext: () => ({ setTransform() {}, clearRect() {} }) };
  const native = 260;
  const before = K.canvas(cv, native);
  K.canvasHeight.set(cv, 96);
  const overridden = K.canvas(cv, native);
  K.canvasHeight.clear(cv);
  const after = K.canvas(cv, native);

  assert.equal(before.h, native, 'a canvas with no override gets the height its module asked for');
  assert.equal(overridden.h, 96, 'an override is applied');
  assert.equal(after.h, native, 'clearing it restores that height exactly');
  assert.equal(K.canvasHeight.native(cv), native,
    'and the module goes on asking for its own height, so it never learns the layout exists');

  /* The same run, with a height override in force and with none, must agree to the
     last digit on every number it publishes. */
  const runs = {
    labChannel: () => M.labChannel({ reach: 8, loss: 14, rate: 16, dz: 38, dpos: 45, dlen: 24,
                                     stub: 0, tr: 12, trTdr: 12, eq: true }).measurements,
    adcLab: () => M.adcLab.run({ arch: 'sar', bits: 12, fs: 1e6, vref: 2.5, noiseUv: 0,
      inFreq: 10e3, inDbfs: -1, fmod: 256e3, osr: 128, aggAmp: 1.8, aggMode: 'free',
      aggFreq: 4.13e6, aggMultiple: 4, aggPpm: 20, aggPhase: 90, edge: 1e-9, path: 'input',
      couplingDb: -60, couplingType: 'flat', pathBw: 20e6, record: 12 }).measurements
  };
  for (const name of Object.keys(runs)) {
    K.canvasHeight.clear(cv);
    const plain = JSON.stringify(runs[name]());
    K.canvasHeight.set(cv, 96);
    const scaled = JSON.stringify(runs[name]());
    K.canvasHeight.clear(cv);
    assert.equal(scaled, plain, name + ': a plot height changed a published measurement');
  }
  console.log('Canvas height override: applied, cleared and restored exactly; '
    + Object.keys(runs).length + ' models publish identical numbers either way.');
}

console.log('Plot label layout: ' + cases + ' widths passed (synthetic font metrics; browser audit also required).');
