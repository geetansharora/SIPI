#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const ROOT=path.resolve(__dirname,'..');
global.window={matchMedia:()=>({matches:false,addEventListener(){}}),addEventListener(){},devicePixelRatio:1};
global.document={documentElement:{},addEventListener(){},querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{},setAttribute(){},appendChild(){}})};
global.getComputedStyle=()=>({getPropertyValue:()=>''});
for(const name of ['viz-kit','viz/lab-pdn']) eval(fs.readFileSync(path.join(ROOT,'js',name+'.js'),'utf8'));
const {kit:K,models:M}=window.SIPI,ref=require('./pdn-reference.js');
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/pdn/two-load-corners.json')));
const budget=fixture.acceptance;
assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT,'docs/model-types.json'))).labPdn.version,fixture.contractVersion);
for(const key of Object.keys(fixture.base)) assert(fixture.units[key]);
function maximum(a){let m=0;for(const v of a)m=Math.max(m,Math.abs(v));return m;}
function pulse(p,which,n,dt){
  // Construct physical-time stimulus independently of production sample-index code.
  const suffix=which===0?'':'2';
  const start=p[which===0?'startNs':'start2Ns']*1e-9;
  const width=p[which===0?'widthNs':'width2Ns']*1e-9,edge=p['tr'+suffix]*1e-12;
  const rise=t=>t<=0?0:t>=edge?1:(1-Math.cos(Math.PI*t/edge))/2;
  return Float64Array.from({length:n},(_,i)=>p['imax'+suffix]*(rise(i*dt-start)-rise(i*dt-start-width)));
}
function reference(p,stages,n,dt,node){
  const loads=[{node:4,current:pulse(p,0,n,dt)},{node:2,current:pulse(p,1,n,dt)}];
  return ref.solve(stages,loads[0].current,dt,loads,node);
}
function compare(q,r,start,to,stride=1){
  let error=0,peak=0,droop=0;
  for(let i=start;i<to;i++) {const v=r[i*stride];error=Math.max(error,Math.abs(q.combined[i]-q.stats[2].base-v));peak=Math.max(peak,Math.abs(v));droop=Math.max(droop,-v);}
  return {waveform:error/peak,droop:Math.abs(q.stats[2].droop-droop)/droop};
}
const rows=[];
for(const c of fixture.cases){
  const p={...fixture.base,...c.params},base=M.labPdn(p),g=base.generated;
  assert(g&&g.multi,c.id+' available');assert.equal(base.version,fixture.modelVersion);
  const fine=M.labPdn(p,{dt:g.dt/2,nt:g.nt*2}).generated;
  const longer=M.labPdn(p,{dt:g.dt,nt:g.nt*2}).generated;
  const resolved=M.labPdn(p,{dt:g.dt/2,nt:g.nt*4}).generated;
  // Same duration for dt refinement; same dt for record extension. Both retain pulses.
  for(const candidate of [fine,longer]) for(let load=0;load<2;load++) {
    const a=load===0?g.wave:g.multi.second,b=load===0?candidate.wave:candidate.multi.second;
    assert(Math.abs(a.t0*g.dt-b.t0*candidate.dt)<1e-15);
    assert(Math.abs(a.fall*g.dt-b.fall*candidate.dt)<1e-15);
  }
  for(let j=0;j<2;j++) {
    const node=j===0?4:2,q=g.multi.nodes[j],r=reference(p,g.stages,g.multi.to*4,g.dt/4,node);
    const rf=reference(p,g.stages,g.multi.to*8,g.dt/8,node);
    const a=compare(q,rf,g.multi.start,g.multi.to,8);
    let refError=0,peak=0,dtError=0,windowError=0;
    for(let i=g.multi.start;i<g.multi.to;i++) {
      refError=Math.max(refError,Math.abs(r[4*i]-rf[8*i]));peak=Math.max(peak,Math.abs(rf[8*i]));
      dtError=Math.max(dtError,Math.abs(q.combined[i]-fine.multi.nodes[j].combined[2*i]));
      windowError=Math.max(windowError,Math.abs(q.combined[i]-longer.multi.nodes[j].combined[i]));
      assert(Math.abs(q.combined[i]-q.parts[0][i]-q.parts[1][i])<1e-12,'superposition');
    }
    const longError=compare(longer.multi.nodes[j],rf,g.multi.start,g.multi.to,8);
    const resolvedError=compare(resolved.multi.nodes[j],rf,g.multi.start*2,g.multi.to*2,4);
    const peakChange=Math.abs(q.stats[2].droop-fine.multi.nodes[j].stats[2].droop);
    const row={defaultWithinAccuracyBudget:a.waveform<budget.waveformFraction&&a.droop<budget.droopFraction,defaultPeakRefinementWithinBudget:peakChange<budget.timestepVolts,resolvedWaveform:resolvedError.waveform,resolvedDroop:resolvedError.droop,peakTimestepVolts:peakChange,id:c.id,node,waveform:a.waveform,droop:a.droop,referenceRefinement:refError/peak,timestepVolts:dtError,recordChangeVolts:windowError,longWaveform:longError.waveform,driftFraction:q.stats[2].fraction,settled:q.stats[2].settled};
    rows.push(row);console.log(JSON.stringify(row));
    assert(refError/peak<budget.referenceRefinementFraction,c.id+' reference refinement');
    assert(a.waveform<budget.waveformFraction,c.id+' production waveform accuracy');
    assert(a.droop<budget.droopFraction,c.id+' production droop accuracy');
    assert(peakChange<budget.timestepVolts,c.id+' peak timestep refinement');
    assert(windowError<1e-12,c.id+' causal record extension leaves prefix unchanged');
    assert(q.stats[2].pre===0,c.id+' no response before excitation');
    assert(resolvedError.waveform<budget.waveformFraction,c.id+' refined waveform accuracy');
    assert(resolvedError.droop<budget.droopFraction,c.id+' refined droop accuracy');
  }
}
if(process.env.PDN_EVIDENCE_PATH) fs.writeFileSync(process.env.PDN_EVIDENCE_PATH,JSON.stringify({fixture:'tests/fixtures/pdn/two-load-corners.json',rows},null,2)+'\n');


// Analytical periodic RL network: independent of the companion solver and FFT algebra.
const tone=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/pdn/shared-rl-tone.json')));
const n=tone.grid.samples,dt=tone.grid.dt,w=2*Math.PI*tone.grid.cycles/(n*dt);
const toneLoads=tone.loads.map(l=>({node:l.node,current:Float64Array.from({length:n},(_,i)=>l.dc+l.sin*Math.sin(w*i*dt)+l.cos*Math.cos(w*i*dt))}));
function toneError(){
  const result=K.pdnMultiTransient(tone.stages,toneLoads,dt,tone.observe);
  let error=0;
  result.forEach((q,j)=>{
    for(let i=0;i<n;i++) {
      let expected=0;
      tone.loads.forEach((l,k)=>{
        const angle=w*i*dt,I=l.dc+l.sin*Math.sin(angle)+l.cos*Math.cos(angle);
        const derivative=w*(l.sin*Math.cos(angle)-l.cos*Math.sin(angle)),z=tone.sharedPaths[j][k];
        expected-=z.r*I+z.l*derivative;
      });
      error=Math.max(error,Math.abs(q.combined[i]-expected));
    }
    const mean=q.combined.reduce((a,v)=>a+v,0)/n;
    error=Math.max(error,Math.abs(mean-tone.expectedDcVolts[j]));
  });
  return error;
}
assert(toneError()<tone.absoluteToleranceVolts,'analytical RL shared-path waveform and DC');
let faults=0;
function fault(label,owner,key,wrap){
  const original=owner[key];
  try {owner[key]=wrap(original);assert(toneError()>tone.absoluteToleranceVolts,'undetected '+label);faults++;}
  finally {owner[key]=original;}
  console.log('Detected PDN fault: '+label);
}
fault('withdrawal sign reversed',K,'pdnMultiTransient',original=>(...args)=>original(...args).map(q=>({...q,combined:Float64Array.from(q.combined,v=>-v)})));
fault('load nodes interchanged',K,'pdnMultiTransient',original=>(stages,loads,...rest)=>original(stages,loads.map((l,i)=>({...l,node:loads[1-i].node})),...rest));
fault('second load omitted',K,'pdnMultiTransient',original=>(stages,loads,...rest)=>original(stages,loads.slice(0,1),...rest));
fault('transfer reactance discarded',K,'pdnNodal',original=>(...args)=>original(...args).map(col=>col.map(z=>({...z,im:0}))));
assert(toneError()<tone.absoluteToleranceVolts,'fault cleanup');
// Cancellation is node-specific, independent of the default lab amplitudes.
const ac=Float64Array.from({length:n},(_,i)=>Math.sin(w*i*dt));
const opposite=Float64Array.from(ac,v=>-v);
const same=K.pdnMultiTransient(tone.stages,[{node:2,current:ac},{node:2,current:opposite}],dt,[2,1]);
assert(same.every(q=>maximum(q.combined)<1e-12),'co-located cancellation');
const different=K.pdnMultiTransient(tone.stages,[{node:2,current:ac},{node:1,current:opposite}],dt,[2,1]);
assert(maximum(different[1].combined)<1e-12&&maximum(different[0].combined)>.1,'shared upstream path cancels but downstream path remains');
for(const bad of [NaN,Infinity,-1]) assert.throws(()=>K.pdnMultiTransient(tone.stages,toneLoads,bad,tone.observe),/Invalid/);
assert.throws(()=>K.pdnMultiTransient(tone.stages,[{node:3,current:ac}],dt,[1]),/node/);
assert.throws(()=>K.pdnMultiTransient(tone.stages,[{node:1,current:Float64Array.of(0,NaN)}],dt,[1]),/Invalid/);
assert.throws(()=>K.pdnMultiTransient(tone.stages,[{node:1,current:ac},{node:2,current:ac.slice(1)}],dt,[1]),/Invalid/);
console.log(`PDN: ${fixture.cases.length} corners at two observations, refined causal references, analytical shared-path tone, and ${faults} detected faults passed. All six production-grid corners meet the declared budgets; this is not an exhaustive domain proof.`);

// Independent closed-form causal test: two-node RL / series-RLC network.
// Rpath=Lpath=Rbank=Lbank=2, C=1/4, I=t^2. KCL/KVL gives
// c''+c'+c=-4t-2t^2, c(0)=c'(0)=0; V=.5c-2t-t^2.
const exactStages=[{shunt:{r:1,l:1}},{series:{r:1,l:1},shunt:{r:2,l:2,c:.25}}];
const exactDt=.001,exactN=4096;
const quadratic=[{node:1,current:Float64Array.from({length:exactN},(_,i)=>(i*exactDt)**2),derivative:Float64Array.from({length:exactN},(_,i)=>2*i*exactDt)}];
function causalError(){
  const out=K.pdnCausalTransient(exactStages,quadratic,exactDt,[1])[0].combined;
  let error=0;
  for(let i=0;i<out.length;i++) {
    const t=i*exactDt,expected=-2*t*t-2*t+2-2*Math.exp(-t/2)*(Math.cos(Math.sqrt(3)*t/2)+Math.sin(Math.sqrt(3)*t/2)/Math.sqrt(3));
    error=Math.max(error,Math.abs(out[i]-expected));
  }
  return error;
}
assert(causalError()<2e-6,'causal closed-form quadratic withdrawal');
const dcStages=[{shunt:{r:1,l:1e-9}},{series:{r:2,l:2e-9},shunt:{r:1,l:1e-9,c:1e-9}},{series:{r:3,l:3e-9},shunt:{r:1,l:1e-9,c:1e-9}}];
const dcDt=1e-9,dcN=2048;
const dcLoads=[{node:2,amplitude:2},{node:1,amplitude:3}].map(l=>({node:l.node,
  current:Float64Array.from({length:dcN},(_,i)=>l.amplitude*(i>=32?1:(1-Math.cos(Math.PI*i/32))/2)),
  derivative:Float64Array.from({length:dcN},(_,i)=>i>=32?0:l.amplitude*Math.PI*Math.sin(Math.PI*i/32)/(64*dcDt))}));
function causalDcError(){
  const out=K.pdnCausalTransient(dcStages,dcLoads,dcDt,[2,1]);
  const expected=[[-12,-9,-21],[-6,-9,-15]];
  return Math.max(...out.flatMap((q,j)=>[...q.parts,q.combined].map((a,k)=>Math.abs(a[dcN-1]-expected[j][k]))));
}
assert(causalDcError()<1e-9,'causal two-load resistive shared-path DC limits');
function causalFault(label,wrap,evaluate,tolerance){
  const original=K.pdnCausalTransient;
  try {K.pdnCausalTransient=wrap(original);assert(evaluate()>tolerance,'undetected causal '+label);}
  finally {K.pdnCausalTransient=original;}
  console.log('Detected causal PDN fault: '+label);
}
causalFault('withdrawal sign',original=>(...args)=>original(...args).map(q=>({...q,combined:Float64Array.from(q.combined,v=>-v)})),causalError,2e-6);
causalFault('missing inductive input derivative',original=>(stages,loads,...args)=>original(stages,loads.map(l=>({...l,derivative:new Float64Array(l.current.length)})),...args),causalError,2e-6);
causalFault('swapped load nodes',original=>(stages,loads,...args)=>original(stages,loads.map((l,i)=>({...l,node:loads[1-i].node})),...args),causalDcError,1e-9);
causalFault('omitted second load',original=>(stages,loads,...args)=>original(stages,loads.map((l,i)=>i?{...l,current:new Float64Array(l.current.length),derivative:new Float64Array(l.current.length)}:l),...args),causalDcError,1e-9);
assert(causalError()<2e-6&&causalDcError()<1e-9,'causal fault restoration');
assert.throws(()=>K.pdnCausalTransient(exactStages,[{node:1,current:Float64Array.of(1,1),derivative:Float64Array.of(0,0)}],exactDt,[1]),/zero-state/);
assert.throws(()=>K.pdnCausalTransient(exactStages,quadratic,NaN,[1]),/Invalid/);
assert.throws(()=>K.pdnCausalTransient(exactStages,quadratic,exactDt,[2]),/Invalid/);
console.log('Causal PDN: closed-form trajectory, shared-path DC and 4 causal-path faults passed.');

for(const options of [{dt:NaN},{dt:0},{dt:-1},{nt:0},{nt:1000},{nt:Infinity},{method:'unknown'}])
  assert.equal(M.labPdn(fixture.base,options).status,'unsupported','bad numerical configuration refused');
for(const params of [{nboard:1.5},{esr:NaN},{cdie:0}])
  assert.equal(M.labPdn({...fixture.base,...params}).status,'unsupported','bad network value refused');
