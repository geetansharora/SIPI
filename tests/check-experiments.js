#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const ROOT=path.resolve(__dirname,'..');
global.window={matchMedia:()=>({matches:false,addEventListener(){}}),addEventListener(){},devicePixelRatio:1};
global.document={documentElement:{},addEventListener(){},querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{},setAttribute(){},appendChild(){}})};
global.getComputedStyle=()=>({getPropertyValue:()=>''});
for(const name of ['viz-kit','viz/lab-waves','viz/lab-channel','viz/lab-pdn','viz/cdr'])eval(fs.readFileSync(path.join(ROOT,'js',name+'.js'),'utf8'));
const runner=require('./reference-experiment-runner.js');
const manifest=JSON.parse(fs.readFileSync(path.join(ROOT,'docs/reference-experiments.json')));
const contracts=JSON.parse(fs.readFileSync(path.join(ROOT,'docs/model-types.json')));
assert.equal(manifest.schemaVersion,1,'unsupported manifest schema');
assert(manifest.experiments.length>0,'empty reference manifest');
const ids=new Set();let checks=0;
for(const entry of manifest.experiments) {
  assert(!ids.has(entry.id),'duplicate experiment');ids.add(entry.id);
  assert(/^\/tests\/fixtures\/experiments\/[a-z0-9-]+\.json$/.test(entry.input),'unsafe fixture path');
  const fixture=JSON.parse(fs.readFileSync(path.join(ROOT,entry.input.slice(1))));
  assert.equal(fixture.schemaVersion,1,'unsupported fixture schema');assert.equal(fixture.model,entry.model);
  assert.equal(fixture.id,entry.id);assert.equal(fixture.modelVersion,entry.modelVersion);
  assert.equal(fixture.contractVersion,contracts[fixture.model].version,'contract changed; review fixture');
  for(const field of ['topology','planes','evidence','lesson','limitations','parameterUnits','stimulus'])assert(fixture[field],'missing '+field);
  for(const key of Object.keys(fixture.params))assert(fixture.parameterUnits[key],'missing parameter unit '+key);
  for(const c of fixture.checks)assert(Number.isFinite(c.expected)&&Number.isFinite(c.absoluteTolerance)&&c.absoluteTolerance>0&&c.unit&&c.derivation,'malformed golden check');
  const url=new URL(entry.scenario,'https://sipi.work');
  assert.equal(fixture.scenario,entry.scenario);assert.equal(url.origin,'https://sipi.work');
  const html=fs.readFileSync(path.join(ROOT,url.pathname.slice(1)),'utf8');
  const scenario=window.SIPI.kit.parseHash(url.hash);
  assert.equal(scenario.viz,fixture.model);assert.equal(scenario.version,fixture.contractVersion);
  for(const key of Object.keys(scenario.vals))assert(html.includes('id="'+key+'"'),'scenario control missing: '+key);
  const result=runner.run(fixture,window.SIPI);checks+=result.length;
  console.log('ok '+entry.id+' ('+result.length+' derived checks)');
}
// Comparator self-check only: this is not a production numerical mutation.
assert.throws(()=>runner.compare({id:'fault',checks:[{metric:'voltage',expected:1,absoluteTolerance:1e-6}]},{voltage:-1}),/exceeds/);
console.log(`ok ${ids.size} reference experiments, ${checks} analytical checks; fixture metadata and scenario targets valid`);
