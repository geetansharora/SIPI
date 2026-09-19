#!/usr/bin/env node
/* Compact parameter-domain integration checks for the public flagship models.
 * This checks result hygiene across combined UI-control corners. It is not an
 * independent physics benchmark: those belong in check-models.js. */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

global.window = {
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  addEventListener() {}, removeEventListener() {}, devicePixelRatio: 1
};
global.document = {
  documentElement: {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} })
};
global.getComputedStyle = () => ({ getPropertyValue: () => '#000000' });
for (const file of ['js/viz-kit.js', 'js/viz/lab-waves.js', 'js/viz/lab-channel.js', 'js/viz/lab-pdn.js', 'js/viz/cdr.js']) {
  // Public browser modules intentionally install themselves on window.SIPI.
  // eslint-disable-next-line no-eval
  eval(fs.readFileSync(path.join(ROOT, file), 'utf8'));
}
const M = window.SIPI.models;
let checks = 0, refusals = 0;

function inspect(name, result) {
  checks++;
  if (!result || typeof result.status !== 'string') throw new Error(name + ': missing result/status');
  if (result.status !== 'ok') {
    refusals++;
    if (!result.why || result.measurements !== null) throw new Error(name + ': refusal lacks reason or exposes measurements');
    return;
  }
  if (!result.measurements) throw new Error(name + ': ok result lacks measurements');
  const allowed = new Set(result.mayBeInfinite || []);
  for (const [key, value] of Object.entries(result.measurements)) {
    if (typeof value !== 'number') continue;
    if (Number.isNaN(value) || (!Number.isFinite(value) && !allowed.has(key))) {
      throw new Error(name + ': non-finite measurement ' + key);
    }
  }
  for (const trace of result.traces || []) {
    if (!trace.x || !trace.x.values || !trace.y || trace.x.values.length !== trace.y.length) {
      throw new Error(name + ': malformed trace ' + (trace.id || '(unnamed)'));
    }
    if (![...trace.x.values, ...trace.y].every(Number.isFinite)) {
      throw new Error(name + ': non-finite trace ' + trace.id);
    }
  }
}

const waveBase = { Z0: 50, Rs: 10, RL: 50, open: false, tr: 60, len: 3, xp: 50 };
for (const Z0 of [25, 100]) for (const Rs of [2, 150]) for (const RL of [0, 200]) {
  const p = Object.assign({}, waveBase, { Z0, Rs, RL, len: Z0 === 25 ? 1 : 12,
                                          tr: Rs === 2 ? 10 : 500, xp: RL === 0 ? 0 : 100 });
  inspect(`labWaves Z0=${Z0} Rs=${Rs} RL=${RL}`, M.labWaves(p, 3 * p.len * 170));
}

const pdnBase = { rvrm: 4, fbw: 120, lplane: 900, lpkg: 350, cboard: 1, nboard: 20,
                  esr: 20, esl: 1100, cdie: 200, imax: 8, tr: 800, zt: 10 };
const pdnCorners = [
  { fbw: 10, nboard: 1, esr: 2, esl: 200, lplane: 100, lpkg: 50, cdie: 10, imax: 1, tr: 200, zt: 1 },
  { fbw: 800, nboard: 60, esr: 150, esl: 3000, lplane: 3000, lpkg: 1200, cdie: 600, imax: 40, tr: 20000, zt: 80 },
  { fbw: 10, nboard: 60, esr: 2, esl: 3000, lplane: 100, lpkg: 1200, cdie: 10, imax: 40, tr: 200, zt: 80 },
  { fbw: 800, nboard: 1, esr: 150, esl: 200, lplane: 3000, lpkg: 50, cdie: 600, imax: 1, tr: 20000, zt: 1 }
];
pdnCorners.forEach((p, i) => inspect('labPdn combined corner ' + (i + 1), M.labPdn(Object.assign({}, pdnBase, p))));

for (const fn of [1, 40]) for (const zeta of [0.15, 1.5]) for (const margin of [0.05, 0.6]) {
  inspect(`cdr fn=${fn} zeta=${zeta} margin=${margin}`, M.cdr({ fn, zeta, margin, ceiling: 20 }));
}

console.log(`ok ${checks} combined domain cases (${refusals} explicit refusals)`);

// Closed-form boundary cases, independent expected signs and amplitudes.
const assert = require('assert');
const K = window.SIPI.kit;
const arrival = (rl, open, rs = 10, time = 0) => M.labWavesArrival(
  K.line1D({ Z0: 50, Rs: rs, RL: rl, open, tr: 60, td: 510, vs: 1, nWave: 24 }),
  510, time, 3060);
assert(Math.abs(arrival(50, true).reflected - 5 / 6) < 1e-12, 'open returns positive incident');
assert(Math.abs(arrival(0, false).reflected + 5 / 6) < 1e-12, 'short returns negative incident');
assert.equal(arrival(50, false).reflected, 0, 'matched load absorbs');
assert.equal(arrival(50, false, 10, 510), null, 'matched load creates no returning arrival');
assert.equal(arrival(50, true, 50, 510).reflected, 0, 'matched source absorbs return');
assert.equal(arrival(50, true, 50, 1020), null, 'matched source creates no further wave');
assert(Math.abs(arrival(50, true, 10, 510).reflected + 5 / 9) < 1e-12, 'low source impedance inverts return');
assert.equal(arrival(50, true, 10, 3060), null, 'horizon ends prediction');
console.log('ok 8 next-arrival boundary checks');

const hp = { Z0: 50, Rs: 50, RL: 50, open: false, tr: 60, len: 3, xp: 50 };
const history = M.labWavesHistory(hp);
const ts = history.traces[0].x.values;
const closeEnergy = (actual, expected) => assert(Math.abs(actual - expected) < .002,
  `history ${actual} differs from closed-form ${expected}`);
// Smoothstep squared integrates to 13/35 over its unit support.
// Once filled, a doubly matched line stores a² Td/Z0 and dissipates at a²/Z0.
for (const i of [Math.floor(ts.length / 2), ts.length - 1]) {
  const u = ts[i] - 9 * hp.tr / 70;
  closeEnergy(history.traces[0].y[i], .01 * u);
  closeEnergy(history.traces[1].y[i], .005 * u);
  closeEnergy(history.traces[2].y[i], .005 * (u - 510));
  closeEnergy(history.traces[3].y[i], .005 * 510);
}
for (const [open, RL] of [[true, 50], [false, 0]]) {
  const h = M.labWavesHistory({ ...hp, open, RL, Rs: 10 });
  assert(h.traces[2].y.every(v => Math.abs(v) < 1e-12), 'ideal open/short dissipates no load energy');
  assert(h.maxResidualFraction < .01, 'history closure budget');
}
assert(history.traces.every(trace => trace.y.every(Number.isFinite)), 'finite history exports');
console.log('ok energy history: matched closed-form values, open/short limits and closure');


// Integration regression: attribution must reproduce the actual convolution,
// and raw comparison uses the same sample index, not a re-optimised phase.
const cp = {reach:8, loss:14, rate:16, dz:38, dpos:45, dlen:24, stub:0, tr:12, trTdr:12, eq:true};
for (const stub of [0, 30]) {
  const r = M.labChannel({...cp, stub});
  const raw = M.labChannel({...cp, stub, eq:false});
  for (const bit of [r.generated.measured.valid.from, 200, r.generated.measured.valid.to]) {
    const d = M.labChannelDecision(r, bit);
    assert(Math.abs(d.residual) < 1e-12, 'decision contributions reconstruct received sample');
    assert(Math.abs(d.main + d.isi - d.value) < 1e-12, 'desired plus ISI closes');
    assert(Math.abs(d.rawValue - raw.generated.measured.y[d.sample]) < 1e-12, 'raw comparison uses same time');
    assert.equal(d.correct, d.detected === d.transmitted, 'decision status');
  }
  assert.equal(M.labChannelDecision(r, -1), null, 'reject out-of-record decision');
}
console.log('ok channel decision reconstruction and raw same-time comparisons');


const sweepParams = {...cp};
const job = M.labChannelSweep(sweepParams, {nx:2, ny:2, x:{key:'stub',lo:0,hi:4}, y:{key:'loss',lo:4,hi:6}});
sweepParams.rate = 64;
while (!job.step()) {}
assert.equal(job.baseParams.rate, 16, 'sweep snapshots held settings');
for (const cell of job.cells) {
  const full = M.labChannel({...job.baseParams, stub:cell.x, loss:cell.y});
  assert(cell.ok && full.status === 'ok', 'loadable cell remains valid');
  assert(Math.abs(full.measurements.eyeHeight - cell.eye) < job.tolerance, 'selected-cell refinement budget');
}
console.log('ok frozen sweep settings and full-resolution cell comparisons');


// Analytical reference: a uniform, matched, lossless line has unity gain and
// exp(-j omega delay) phase. After the removed integer delay only the fraction remains.
const idealP = {...cp, loss:0, dz:50, dlen:0, stub:0, eq:false};
const idealR = M.labChannel(idealP);
const impulse = M.labChannelImpulse(idealR, {full:true});
assert(Math.abs(impulse.sumRaw - 1) < 1e-8, 'matched-line impulse has unit DC gain');
const delay = idealP.reach * 170e-12;
const fraction = delay - Math.floor(delay / impulse.dt) * impulse.dt;
for (const k of [1, 5, 17]) {
  let re = 0, im = 0;
  for (let n = 0; n < impulse.raw.length; n++) {
    const angle = 2 * Math.PI * k * n / impulse.raw.length;
    re += impulse.raw[n] * Math.cos(angle); im -= impulse.raw[n] * Math.sin(angle);
  }
  const phase = 2 * Math.PI * k * fraction / (impulse.raw.length * impulse.dt);
  assert(Math.abs(re - Math.cos(phase)) < 1e-8 && Math.abs(im + Math.sin(phase)) < 1e-8,
    'impulse reproduces analytical fractional-delay phase');
}
// Two different quantities, and the reason to keep them apart. The physical delay
// of this line is not a whole number of samples, so there is no sample that sits on
// it: the impulse peak can only ever be the nearest grid point, and asking it to
// equal the delay is asking the grid to be finer than it is. The phase slope of the
// same record recovers the off-grid value exactly, because phase is continuous in
// frequency where the impulse is discrete in time.
{
  const inSamples = fraction / impulse.dt;
  const nearest = Math.round(inSamples);
  let peakAt = 0;
  for (let n = 0; n < impulse.raw.length; n++) {
    if (Math.abs(impulse.raw[n]) > Math.abs(impulse.raw[peakAt])) peakAt = n;
  }
  // the phase slope over the low bins, which is the group delay in samples
  const bins = [1, 2, 3, 4, 5, 6, 7, 8];
  let sxy = 0, sxx = 0;
  for (const k of bins) {
    let re = 0, im = 0;
    for (let n = 0; n < impulse.raw.length; n++) {
      const a = 2 * Math.PI * k * n / impulse.raw.length;
      re += impulse.raw[n] * Math.cos(a); im -= impulse.raw[n] * Math.sin(a);
    }
    const ph = -Math.atan2(im, re);                     // unwrapped: these bins are inside one turn
    sxy += k * ph; sxx += k * k;
  }
  const slopeSamples = (sxy / sxx) * impulse.raw.length / (2 * Math.PI);

  assert(Math.abs(inSamples - nearest) > 0.05,
    'this reference delay is deliberately off-grid, so the distinction is testable');
  assert(peakAt === nearest,
    'the impulse peak is the nearest sample to the delay, not the delay');
  const peakError = Math.abs(peakAt - inSamples);
  const slopeError = Math.abs(slopeSamples - inSamples);
  assert(peakError > 0.05 && slopeError < 1e-6,
    'the peak-sample estimate is off by the grid, the phase slope is exact: '
    + peakError.toFixed(4) + ' vs ' + slopeError.toExponential(1) + ' samples');
  assert(slopeError * 100 < peakError,
    'so a group delay read from phase is orders of magnitude better than one read '
    + 'from the peak sample, and the two must not be compared to the same tolerance');
  console.log('ok fractional delay: peak sample off by ' + peakError.toFixed(4)
    + ' samples by construction; phase slope exact to ' + slopeError.toExponential(1));
}

const absoluteImpulse = M.labChannelImpulse(idealR, {full:true, absolute:true});
assert.strictEqual(absoluteImpulse.raw, impulse.raw, 'time labels do not recompute impulse');
assert.equal(absoluteImpulse.offset, idealR.origins.tdBulk, 'absolute labels restore removed delay');
assert.strictEqual(impulse.active, impulse.raw, 'CTLE off uses raw weights');
const boosted = M.labChannel({...cp});
const boostedView = M.labChannelImpulse(boosted, {full:true});
assert(boostedView.raw.every(v => v > boostedView.min && v < boostedView.max), 'raw impulse fits bounds');
assert(boostedView.active.every(v => v > boostedView.min && v < boostedView.max), 'active impulse fits bounds');
assert.equal(M.labChannelImpulse({status:'unsupported'}), null, 'refused impulse is unavailable');
console.log('ok impulse normalization, analytical phase, time labels and bounds');

for (const id of ['impulse', 'impulse-active', 'pulse'])
  assert.equal(idealR.traces.find(trace => trace.id === id).unit, '-', 'dimensionless kernel/SBR export units');

// A3: independent limits, reciprocity and a causal companion-model comparison.
{
  const stages=M.labPdn(pdnBase).generated.stages;
  const cols=K.pdnNodal(stages,0,[4,2]);
  assert(Math.abs(cols[0][4].re-.0078)<1e-12,'die DC series resistance');
  assert(Math.abs(cols[1][2].re-.005)<1e-12,'board DC series resistance');
  assert(Math.abs(cols[1][4].re-.005)<1e-12,'DC shared path transfer');
  for(const f of [1e3,1e6,7e6,1e9]) {
    const c=K.pdnNodal(stages,f,[4,2]), old=K.pdnLadder(stages,f);
    assert(Math.hypot(c[0][4].re-old.z.re,c[0][4].im-old.z.im)<1e-10,'nodal agrees with ladder reduction');
    assert(Math.hypot(c[0][2].re-c[1][4].re,c[0][2].im-c[1][4].im)<1e-10,'complex reciprocity');
  }
  assert.throws(()=>K.pdnNodal([{shunt:{r:0,l:0}}],0,[0]),/positive/,'ideal short refused');
  assert.throws(()=>K.pdnNodal([{shunt:{r:1,c:1}}],0,[0]),/Singular/,'floating DC refused');
  const n=4096,dt=1e-9;
  const cur=Float64Array.from({length:n},(_,i)=>Math.sin(2*Math.PI*16*i/n));
  const neg=Float64Array.from(cur,x=>-x);
  const both=K.pdnMultiTransient(stages,[{node:4,current:cur},{node:2,current:neg}],dt,[4,2]);
  assert(Math.max(...both[0].combined.map(Math.abs))>1e-5,'opposite currents at distinct nodes do not cancel');
  const cancel=K.pdnMultiTransient(stages,[{node:4,current:cur},{node:4,current:neg}],dt,[4]);
  assert(Math.max(...cancel[0].combined.map(Math.abs))<1e-12,'co-located opposite currents cancel');
  const single=K.pdnMultiTransient(stages,[{node:4,current:cur}],dt,[4]);
  const legacy=K.pdnTransient(stages,cur,dt);
  assert(Math.max(...legacy.map((v,i)=>Math.abs(v+single[0].combined[i])))<1e-9,'legacy positive droop equals negative signed rail');
  const ref=require('./pdn-reference.js');
  // RC limit independently known: current step at resistor/capacitor node.
  const rc=[{shunt:{r:1,l:0},series:null},{series:{r:1,l:0},shunt:{r:1,l:0,c:1e-6}}];
  const one=new Float64Array(20000).fill(1), h=1e-9;
  const response=ref.solve(rc,one,h);
  // Initial capacitor short through 1 ohm: 2 ohm source path || 1 ohm ESR;
  // final is -2 V, pole (2+1)*C, so v=-2+(4/3)*exp(-t/3us).
  assert(Math.abs(response[15000]-(-2+4/3*Math.exp(-15000*h/3e-6)))<2e-5,'reference solver analytical RC step');
  const pp={...pdnBase,imax2:3,tr2:800,startNs:786.4,widthNs:1835,start2Ns:1000,width2Ns:1000};
  const r=M.labPdn(pp), m=r.generated.multi;
  inspect('two-load assembled',r);
  for(let j=0;j<2;j++) {
    const vv=ref.solve(stages,m.loads[0].current,r.generated.dt,m.loads,j===0?4:2), q=m.nodes[j];
    let error=0,peak=0;
    for(let i=m.start;i<m.to;i++) {error=Math.max(error,Math.abs(vv[i]-(q.combined[i]-q.stats[2].base)));peak=Math.max(peak,Math.abs(vv[i]));}
    console.log('PDN reference node',j,'error',error,'peak',peak,'fraction',error/peak);
    assert(error/peak<.05,'two-load full waveform within 5% of reference peak excursion');
    const refDroop=-Math.min(...vv.slice(m.start,m.to));
    console.log('PDN reference droop error',j,(Math.abs(q.stats[2].droop-refDroop)/refDroop*100).toFixed(3)+'%');
    assert(Math.abs(q.stats[2].droop-refDroop)/refDroop<.02,'two-load droop within 2% of causal reference');
    for(let i=0;i<vv.length;i+=71) assert(Math.abs(q.combined[i]-q.parts[0][i]-q.parts[1][i])<1e-12,'signed superposition');
  }
  const fine=M.labPdn(pp,{dt:r.generated.dt/2,nt:r.generated.nt*2});
  assert(Math.abs(fine.generated.wave.t0*fine.generated.dt-r.generated.wave.t0*r.generated.dt)<1e-15,'refinement preserves physical onset');
  for(let j=0;j<2;j++) assert(Math.abs(fine.generated.multi.nodes[j].stats[2].droop-m.nodes[j].stats[2].droop)<.002,'two-load timestep convergence within 2 mV');
  assert(M.labPdn({...pp,imax2:NaN}).status==='unsupported','invalid second load refused');
  const longer=M.labPdn(pp,{dt:r.generated.dt,nt:r.generated.nt*2});
  for(let j=0;j<2;j++) {
    assert(longer.generated.multi.nodes[j].stats[2].pre===0&&m.nodes[j].stats[2].pre===0,'causal response has no wraparound');
    assert(Math.abs(longer.generated.multi.nodes[j].stats[2].droop-m.nodes[j].stats[2].droop)<.01*m.nodes[j].stats[2].droop,'record extension changes droop by under 1%');
  }
  const dcLoads=[{node:4,current:Float64Array.from({length:8192},(_,i)=>8*(.5-.5*Math.cos(Math.PI*Math.min(1,i/500))))},{node:2,current:Float64Array.from({length:8192},(_,i)=>3*(.5-.5*Math.cos(Math.PI*Math.min(1,i/500))))}];
  for(const node of [4,2]) {
    const dc=ref.solve(stages,dcLoads[0].current,20e-9,dcLoads,node);
    assert(Math.abs(dc[dc.length-1]+(node===4?.0774:.055))<1e-6,'independent two-load DC shared-resistance limit');
  }
  assert(M.labPdn(pp,{dt:1e-9,nt:1024}).status==='out-of-record','undersampled/short two-load record refused');
  const zero=M.labPdn({...pp,imax:0,imax2:0});
  assert(zero.generated.multi.nodes.every(q=>q.stats.every(st=>st.settled&&st.droop===0&&st.overshoot===0)),'zero-load settled zero response');
  console.log('ok two-load PDN: DC/RC limits, complex reciprocity, signs, cancellation, reference and refinement');
}

// Native-coordinate inspection: independently specified interpolation examples.
{
  const tr=K.trace('example','example','V','frequency','Hz',[1,10,100],[-1,1,3]);
  const nearest=K.traceInspector(tr), linear=K.traceInspector(tr,{policy:'linear'});
  assert(nearest.at(4).x===1,'nearest uses physical Hz, not log-axis distance');
  assert(linear.at(5.5).value===0,'linear native-coordinate zero crossing');
  assert(linear.at(55).value===2,'nonuniform frequency interpolation');
  assert(nearest.at(101).status==='out-of-range'&&nearest.at(NaN).status==='out-of-range','no endpoint clamping');
  assert(K.traceInspector({...tr,y:[-1,NaN,3]}).at(4).status==='gap','no interpolation over missing samples');
  const segments=K.traceInspector(tr,{policy:'linear',segments:[{from:0,to:1},{from:1,to:3}]});
  assert(segments.at(4).status==='gap'&&segments.at(10).status==='ok','declared gap boundaries');
  const complex=K.traceInspector(K.trace('z','z','ohm','frequency','Hz',[1,3],[-1,-1]),{policy:'linear',imaginary:[.1,-.1]});
  assert(complex.at(2).phaseDeg===180&&complex.at(2).magnitude===1,'Cartesian interpolation across phase wrap');
  const zero=K.traceInspector(K.trace('zero','zero','ohm','f','Hz',[1],[0]),{imaginary:[0]}).at(1);
  assert(zero.phaseDeg===null,'zero complex magnitude has no phase');
  assert.throws(()=>K.traceInspector(K.trace('p','phase','deg','f','Hz',[1,3],[179,-179]),{policy:'linear'}),'wrapped angle interpolation refused');
  assert(K.traceInspector(K.trace('empty','empty','V','x','s',[],[])).at(1).status==='out-of-range','empty trace refused');
  const result=M.labPdn(pdnBase), rows=result.generated.transfer;
  for(const row of rows.filter((_,i)=>i%37===0)) {
    const forward=row.columns[0][2],reverse=row.columns[1][4];
    assert(Math.hypot(forward.re-reverse.re,forward.im-reverse.im)<1e-10,'cached complex transfer reciprocity');
    const i=rows.indexOf(row), exported=result.traces.find(t=>t.id==='z-board-die-im');
    assert(exported.y[i]===forward.im && exported.unit==='ohm','native imaginary transfer export');
  }
  assert(result.traces.filter(t=>/^z-(die|board)-(die|board)-(re|im)$/.test(t.id)).length===8,'all four complex transfer pairs exported');
  const channel=M.labChannel(cp), delay=channel.traces.find(t=>t.id==='group-delay');
  assert(delay.unit==='s' && delay.x.unit==='Hz' && delay.y[4]===channel.generated.raw.sweep[4].gd,'native group delay export');
  console.log('ok native trace inspection, Cartesian phase, transfer spectra and delay export');
}
