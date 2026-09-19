#!/usr/bin/env node
'use strict';
// Second analytical tranche: helper checks and two replayable CDR cases.
const fs = require('fs'), path = require('path'), assert = require('assert');
const ROOT = path.resolve(__dirname, '..');
global.window = {matchMedia:()=>({matches:false,addEventListener(){}}),addEventListener(){},devicePixelRatio:1};
global.document = {documentElement:{},addEventListener(){},querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{},setAttribute(){},appendChild(){}})};
global.getComputedStyle = ()=>({getPropertyValue:()=>''});
for (const name of ['viz-kit','viz/cdr','viz/lab-channel','viz/pdn-extras'])
  eval(fs.readFileSync(path.join(ROOT,'js',name+'.js'),'utf8'));
const {kit:K, models:M} = window.SIPI;
const read = p => JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));
const manifest = read('docs/reference-experiments-next.json');
function evaluate(f) {
  const p = f.inputs;
  switch (f.kind) {
    case 'pad': {
      const s = K.cascadeS([{type:'series',r:p.seriesOhms},{type:'shunt',r:p.shuntOhms},{type:'series',r:p.seriesOhms}],p.frequencyHz,p.referenceOhms,8e9);
      return {s21Real:s.s21r,s21Imag:s.s21i,reflectionMagnitude:Math.hypot(s.s11r,s.s11i),transmittedPower:s.s21r**2+s.s21i**2};
    }
    case 'stub': {
      const at = divisor => K.cascadeS([{type:'stub',z:p.stubOhms,td:p.delaySeconds}],1/(divisor*p.delaySeconds),p.referenceOhms,8e9);
      const q = at(4), h = at(2), e = at(8);
      return {quarterWaveTransmission:Math.hypot(q.s21r,q.s21i),halfWaveTransmission:Math.hypot(h.s21r,h.s21i),eighthWaveTransmission:Math.hypot(e.s21r,e.s21i),quarterWaveReflection:Math.hypot(q.s11r,q.s11i)};
    }
    case 'series-rlc': {
      const w = 1/Math.sqrt(p.l*p.c), z = K.zBranch(p,w);
      return {resonantReal:z.re,resonantImag:z.im,halfFrequencyImag:K.zBranch(p,w/2).im,doubleFrequencyImag:K.zBranch(p,2*w).im};
    }
    case 'parallel-rl-rc': {
      const frequency = 1/(2*Math.PI*Math.sqrt(p.l*p.c));
      const at = r => {
        const a = K.abcdMul(K.sectionABCD({type:'shunt',r,l:p.l},frequency,8e9),K.sectionABCD({type:'shunt',r,c:p.c},frequency,8e9));
        const d = a.cr*a.cr+a.ci*a.ci;
        return {re:a.cr/d,im:-a.ci/d};
      };
      const z = at(p.r);
      return {impedanceReal:z.re,impedanceImag:z.im,doubledResistanceReal:at(2*p.r).re};
    }
    case 'cdr': {
      const g = M.cdr(p).generated, amp = p.jitterAmplitude/2;
      // Samples at theta=0 and pi/2 isolate imaginary and real transfer parts.
      return {hReal:g.phaseRecovered[15]/amp,hImag:g.phaseRecovered[0]/amp,eReal:g.phaseResidual[15]/amp,eImag:g.phaseResidual[0]/amp};
    }
    case 'two-port-sigma': {
      // Four tests on one matrix. Only the first is passivity; the card exists to
      // show what the other three do with a network that is provably lossless.
      const e = K.parseTouchstone(fs.readFileSync(path.join(ROOT,f.sourceFile),'utf8')).S[0];
      const m = z => Math.hypot(z.re,z.im);
      return {
        sigmaMax: K.sigmaMax2x2(e.s11,e.s12,e.s21,e.s22),
        symmetricShortcut: Math.max(Math.hypot(e.s11.re+e.s21.re,e.s11.im+e.s21.im),
                                    Math.hypot(e.s11.re-e.s21.re,e.s11.im-e.s21.im)),
        largestElement: Math.max(m(e.s11),m(e.s12),m(e.s21),m(e.s22)),
        columnNorm: Math.max(Math.hypot(m(e.s11),m(e.s21)),Math.hypot(m(e.s12),m(e.s22)))
      };
    }
    case 'two-bank-anti-resonance': {
      const branches = [
        {C:p.bigCapacitance,esr:p.bigEsr,esl:p.bigEsl,n:1,on:true},
        {C:p.smallCapacitance,esr:p.smallEsr,esl:p.smallEsl,n:1,on:true}
      ];
      const Y = f2 => { const w=2*Math.PI*f2; let gr=0,gi=0;
        branches.forEach(b=>{const zr=b.esr/b.n,zi=w*b.esl/b.n-1/(w*b.C*b.n),d=zr*zr+zi*zi;
          gr+=zr/d; gi+=-zi/d;});
        return {g:gr,b:gi}; };
      const srf = b => 1/(2*Math.PI*Math.sqrt((b.esl/b.n)*(b.C*b.n)));
      const fs2 = branches.map(srf).sort((a,b)=>a-b);
      // Strictly between the self-resonances: every SRF is also a susceptance zero,
      // and only this interval holds the resonance OF THE PAIR.
      let a=fs2[0]*1.02,c=fs2[1]*0.98;
      for (let k=0;k<200;k++){const mid=Math.sqrt(a*c); if(Y(a).b*Y(mid).b<=0) c=mid; else a=mid;}
      const zero=Math.sqrt(a*c), peak=M.antiResonancePeak(branches,p.sweepFrom,p.sweepTo).peak;
      return {selfResonanceBig:fs2[0],selfResonanceSmall:fs2[1],susceptanceZero:zero,
              peakFrequency:peak.f,resistanceAtCancellation:1/Y(zero).g};
    }
    case 'fractional-delay': {
      const R2 = M.labChannel({reach:p.reach,loss:p.loss,rate:p.rate,dz:50,dpos:45,dlen:0,
                               stub:0,tr:12,trTdr:12,eq:false});
      const imp = M.labChannelImpulse(R2,{full:true});
      const delay = p.reach*p.propagationDelay;
      const fraction = delay - Math.floor(delay/imp.dt)*imp.dt;
      let peakAt = 0;
      for (let n=0;n<imp.raw.length;n++) if (Math.abs(imp.raw[n])>Math.abs(imp.raw[peakAt])) peakAt=n;
      let sxy=0,sxx=0;
      for (const k of [1,2,3,4,5,6,7,8]) {
        let re=0,im=0;
        for (let n=0;n<imp.raw.length;n++){const ang=2*Math.PI*k*n/imp.raw.length;
          re+=imp.raw[n]*Math.cos(ang); im-=imp.raw[n]*Math.sin(ang);}
        sxy += k*-Math.atan2(im,re); sxx += k*k;
      }
      return {unitDcGain:imp.sumRaw,fractionInSamples:fraction/imp.dt,peakSample:peakAt,
              phaseSlopeSamples:(sxy/sxx)*imp.raw.length/(2*Math.PI)};
    }
    case 'pdn-shared-rl': {
      // The DC limit, taken through the public transient path with the currents
      // held flat so every inductive term is identically zero.
      const t = read(f.sourceFile);
      const n = t.grid.samples;
      const loads = t.loads.map(l=>({node:l.node,current:new Float64Array(n).fill(l.dc)}));
      const out = K.pdnMultiTransient(t.stages,loads,t.grid.dt,t.observe);
      // Each observation returns the per-load parts and their sum; the DC limit is
      // the settled end of the combined trace.
      const last = q => q.combined[q.combined.length-1];
      return {dcNode2:last(out[0]),dcNode1:last(out[1])};
    }
    default: throw Error('Unknown fixture kind '+f.kind);
  }
}
function failures(f) {
  const actual = evaluate(f);
  return f.checks.filter(c => !Number.isFinite(actual[c.metric]) || Math.abs(actual[c.metric]-c.expected)>c.absoluteTolerance);
}
assert.equal(manifest.schemaVersion,1);
assert.equal(manifest.version,'1.0');
const ids = new Set(), fixtures = [];
let count = 0;
for (const entry of manifest.experiments) {
  assert(!ids.has(entry.id)); ids.add(entry.id);
  assert(/^\/tests\/fixtures\/reference-next\/[a-z0-9-]+\.json$/.test(entry.input));
  const f = read(entry.input.slice(1)); fixtures.push(f);
  assert.equal(f.schemaVersion,1); assert.equal(f.id,entry.id);
  assert.equal(f.title,entry.title); assert.equal(f.availability,entry.availability);
  assert(entry.input.startsWith('/tests/fixtures/reference-next/'));
  assert(['helper-only','lab-scenario'].includes(f.availability));
  for (const key of Object.keys(f.inputs)) assert(f.inputUnits[key], 'missing unit '+key);
  for (const key of ['prediction','explanation','limitations','evidence']) assert(f[key]);
  assert.equal(f.evidence.type,'analytical');
  assert.equal(typeof f.evidence.provenance,'string');
  assert(fs.existsSync(path.join(ROOT,f.relatedPage.slice(1))));
  if (f.availability==='helper-only') assert(!f.scenario,'helper must not imply exact UI replay');
  else {
    const url = new URL(f.scenario,'https://sipi.work');
    assert.equal(url.pathname,f.relatedPage);
    const state = new URLSearchParams(url.hash.slice(1).replace(/;/g,'&'));
    assert.equal(state.get('lab'),'cdr');
    assert.equal(f.contractVersion,read('docs/model-types.json').cdr.version);
    assert.equal(state.get('v'),f.contractVersion);
    assert.equal(M.cdr(f.inputs).version,f.modelVersion,'CDR model version changed; review reference');
    for (const [key,param,scale] of [['cdr-fn','fn',1],['cdr-zeta','zeta',100],['cdr-margin','margin',100],['cdr-jitter-f','jitterFrequency',1],['cdr-jitter-a','jitterAmplitude',100]]) {
      assert(state.has(key)); assert.equal(Number(state.get(key)),f.inputs[param]*scale);
    }
  }
  assert(f.checks.length>0);
  for (const c of f.checks) assert(Number.isFinite(c.expected)&&Number.isFinite(c.absoluteTolerance)&&c.absoluteTolerance>0&&c.unit&&c.derivation);
  assert.deepEqual(failures(f),[],f.id+' numerical mismatch'); count += f.checks.length;
}
// Deliberate faults only touch this process; production files remain unchanged.
function detect(label, owner, key, wrap, id) {
  const original = owner[key];
  try {
    owner[key] = wrap(original);
    assert(failures(fixtures.find(f=>f.id===id)).length>0,'undetected fault: '+label);
  } finally { owner[key] = original; }
  console.log('Detected: '+label);
}
detect('wave amplitude doubled',K,'cascadeS',original=>(...args)=>{const s=original(...args);return {...s,s21r:2*s.s21r,s21i:2*s.s21i};},'matched-t-pad');
detect('stub delay doubled',K,'sectionABCD',original=>(s,...args)=>original(s.type==='stub'?{...s,td:2*s.td}:s,...args),'quarter-wave-open-stub');
detect('capacitor reactance sign reversed',K,'zBranch',original=>(b,w)=>{const z=original(b,w);return {...z,im:z.im+(b.c?2/(w*b.c):0)};},'series-rlc-cancellation');
detect('capacitive shunt susceptance sign reversed',K,'sectionABCD',original=>(s,...args)=>{const a=original(s,...args);return s.type==='shunt'&&s.c?{...a,ci:-a.ci}:a;},'parallel-reactance-cancellation');
detect('CDR residual subtracts magnitudes',M,'cdr',original=>p=>{const m=original(p),g=m.generated;g.phaseResidual=g.phaseIn.map((v,i)=>Math.abs(v)-Math.abs(g.phaseRecovered[i]));return m;},'cdr-high-frequency');
for (const f of fixtures) assert.deepEqual(failures(f),[],f.id+' not restored after faults');
console.log(`${fixtures.length} staged analytical fixtures: ${count} expectations pass; 5 deliberate faults detected.`);
