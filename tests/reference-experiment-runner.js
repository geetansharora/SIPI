/* Shared Node/browser fixture evaluator. Golden values live in JSON and are
   derived in words there; this file only reads public production outputs. */
(function (host) {
  'use strict';
  function run(fixture, api, published) {
    const M=api.models,K=api.kit;
    const r=published || M[fixture.model](fixture.params,fixture.kind==='line'?fixture.timePs:undefined);
    if(r.status!=='ok')throw new Error(fixture.id+': model refused: '+r.why);
    if(r.version!==fixture.modelVersion)throw new Error(fixture.id+': model version changed; review the reference');
    let actual;
    if(fixture.kind==='line') {
      if(r.params.t!==fixture.timePs||r.view.xp!==100)throw new Error('Line observation time/plane mismatch');
      actual={gammaLoad:r.generated.raw.GL,gammaSource:r.generated.raw.GS,launchedVoltage:r.generated.raw.a0,
        loadVoltage:r.measurements.vFar,loadCurrent:r.measurements.iHere};
    } else if(fixture.kind==='channel') {
      const trace=id=>r.traces.find(t=>t.id===id);
      actual={maxInsertionDeviationDb:Math.max(...trace('il').y.map(Math.abs)),groupDelay:trace('group-delay').y,
        impulseSum:trace('impulse').y.reduce((sum,v)=>sum+v,0)};
    } else if(fixture.kind==='pdn-dc') {
      const z=K.pdnNodal(r.generated.stages,0,[4,2]);
      const loads=[{node:4,current:new Float64Array(16).fill(fixture.params.imax)},
        {node:2,current:new Float64Array(16).fill(fixture.params.imax2)}];
      const dc=K.pdnMultiTransient(r.generated.stages,loads,1e-9,[4,2]);
      actual={zDieDie:z[0][4].re,zBoardBoard:z[1][2].re,zDieBoard:z[1][4].re,zBoardDie:z[0][2].re,
        dieDeviation:Array.from(dc[0].combined),boardDeviation:Array.from(dc[1].combined)};
    } else if(fixture.kind==='cdr') {
      const g=r.generated;
      if(Math.abs(g.phaseTime[15]-1/(4*fixture.params.jitterFrequency*1e6))>1e-18)throw new Error('Quarter-period coordinate changed');
      actual={inputAtZero:g.phaseIn[0],recoveredAtZero:g.phaseRecovered[0],residualAtZero:g.phaseResidual[0],
        recoveredAtQuarter:g.phaseRecovered[15],residualAtQuarter:g.phaseResidual[15]};
    } else throw new Error('Unknown reference kind');
    return compare(fixture,actual);
  }
  function compare(fixture,actual) {
    return fixture.checks.map(check=>{
      const values=Array.isArray(actual[check.metric])?actual[check.metric]:[actual[check.metric]];
      if(!values.length||!values.every(Number.isFinite))throw new Error(fixture.id+': missing/nonfinite '+check.metric);
      const error=Math.max(...values.map(v=>Math.abs(v-check.expected)));
      if(error>check.absoluteTolerance)throw new Error(fixture.id+': '+check.metric+' error '+error+' exceeds '+check.absoluteTolerance);
      return {metric:check.metric,samples:values.length,maxAbsoluteError:error,unit:check.unit};
    });
  }
  function runStagedCdr(fixture, api, published) {
    if(fixture.kind!=='cdr'||fixture.availability!=='lab-scenario')throw new Error('not a replayable CDR reference');
    const r=published || api.models.cdr(fixture.inputs), g=r.generated, amp=fixture.inputs.jitterAmplitude/2;
    if(r.status!=='ok'||r.model!=='cdr'||r.version!==fixture.modelVersion)throw new Error('CDR model/version mismatch');
    if(Math.abs(g.phaseTime[15]-1/(4*fixture.inputs.jitterFrequency*1e6))>1e-18)
      throw new Error('CDR quarter-period coordinate changed');
    const traces=[['phase-input',g.phaseIn],['phase-recovered',g.phaseRecovered],['phase-residual',g.phaseResidual]];
    for(const [id,values] of traces) {
      const trace=r.traces.find(t=>t.id===id);
      if(!trace||trace.unit!=='UI'||trace.y.length!==values.length||
         trace.y.some((v,i)=>v!==values[i]))throw new Error('published phase trace mismatch: '+id);
    }
    return compare(fixture,{hReal:g.phaseRecovered[15]/amp,hImag:g.phaseRecovered[0]/amp,
      eReal:g.phaseResidual[15]/amp,eImag:g.phaseResidual[0]/amp});
  }
  const exported={run,runStagedCdr,compare};
  if(typeof module!=='undefined'&&module.exports)module.exports=exported;
  else host.ReferenceExperiments=exported;
})(typeof window==='undefined'?{}:window);
